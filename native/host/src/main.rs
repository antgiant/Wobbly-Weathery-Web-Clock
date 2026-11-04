//! wobbly-host: runs the real sky engine (JavaScript + GLSL, the same files the web page uses) with no browser.
//! Spike usage: wobbly-host <repo-root> <out.ppm> [width height] [time-iso] [state-json]

mod canvas2d;
mod egl;
mod gl;
mod out;

use rquickjs::loader::{Loader, Resolver};
use rquickjs::{ArrayBuffer, Context, Ctx, Function, Module, Object, Result, Runtime, Value};
use rquickjs::function::Rest;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::Instant;

/// The host's own JavaScript is part of the program (WOBBLY_HOST_JS=dir uses files from a folder instead, for working on them).
const EMBED: &[(&str, &str)] = &[
    ("host/host.js", include_str!("../js/host.js")), ("host/dom.js", include_str!("../js/dom.js")),
    ("host/polyfills.js", include_str!("../js/polyfills.js")), ("host/boot.js", include_str!("../js/boot.js")),
];
fn embedded(name: &str) -> Option<String> {
    let (n, _) = EMBED.iter().find(|(k, _)| *k == name)?.clone();
    if let Ok(d) = std::env::var("WOBBLY_HOST_JS") { if let Ok(t) = std::fs::read_to_string(Path::new(&d).join(n.trim_start_matches("host/"))) { return Some(t); } }
    EMBED.iter().find(|(k, _)| *k == name).map(|(_, v)| v.to_string())
}

thread_local! {
    static OUT: std::cell::RefCell<Option<out::Out>> = std::cell::RefCell::new(None);
    static MAIN_PROMISE: std::cell::RefCell<Option<rquickjs::Persistent<rquickjs::Promise<'static>>>> = std::cell::RefCell::new(None);
    static GL: std::cell::RefCell<Option<Rc<gl::Gl>>> = std::cell::RefCell::new(None);
    static ROOT: std::cell::RefCell<PathBuf> = std::cell::RefCell::new(PathBuf::new());
    static DONE: std::cell::Cell<bool> = std::cell::Cell::new(false);
    static T0: std::cell::Cell<Option<Instant>> = std::cell::Cell::new(None);
}
fn path_of(p: &str) -> PathBuf { if Path::new(p).is_absolute() { PathBuf::from(p) } else { ROOT.with(|r| r.borrow().join(p)) } }
fn throw<'js>(ctx: &Ctx<'js>, m: String) -> rquickjs::Error { rquickjs::Exception::throw_message(ctx, &m) }
fn n_gl<'js>(ctx: Ctx<'js>, name: String, args: Rest<Value<'js>>) -> Result<Value<'js>> { let g = GL.with(|g| g.borrow().clone().unwrap()); g.call(&ctx, &name, &args.0) }
fn n_now() -> f64 { T0.with(|t| t.get().unwrap().elapsed().as_secs_f64() * 1000.0) }
fn n_readfile<'js>(ctx: Ctx<'js>, p: String) -> Result<ArrayBuffer<'js>> {
    let full = path_of(&p); let b = std::fs::read(&full).map_err(|e| throw(&ctx, format!("{}: {e}", full.display())))?; ArrayBuffer::new_copy(ctx.clone(), b)
}
fn n_readtext<'js>(ctx: Ctx<'js>, p: String) -> Result<String> { let full = path_of(&p); std::fs::read_to_string(&full).map_err(|e| throw(&ctx, format!("{}: {e}", full.display()))) }
fn n_decode<'js>(ctx: Ctx<'js>, p: String) -> Result<Object<'js>> {
    let full = path_of(&p);
    let img = image::open(&full).map_err(|e| throw(&ctx, format!("{}: {e}", full.display())))?.to_rgba8();
    let o = Object::new(ctx.clone())?;
    o.set("w", img.width())?; o.set("h", img.height())?;
    o.set("data", ArrayBuffer::new_copy(ctx.clone(), img.into_raw())?)?;
    Ok(o)
}
fn n_writeppm<'js>(ctx: Ctx<'js>, p: String, w: u32, h: u32, ab: ArrayBuffer<'js>) -> Result<()> {
    let px = ab.as_bytes().ok_or_else(|| throw(&ctx, "no bytes".into()))?;
    let mut o = format!("P6\n{w} {h}\n255\n").into_bytes();
    for y in (0..h as usize).rev() { for x in 0..w as usize { let i = (y * w as usize + x) * 4; o.extend_from_slice(&px[i..i + 3]); } }   // GL rows run bottom to top
    std::fs::write(&p, o).map_err(|e| throw(&ctx, e.to_string()))
}

// ---- time zones (the engine's Intl is not in QuickJS): offsets from the embedded tz database --------------------------------------
fn n_tzoffset(zone: String, ms: f64) -> f64 {
    use chrono::{Offset, TimeZone};
    match zone.parse::<chrono_tz::Tz>() {
        Ok(tz) => match chrono::Utc.timestamp_millis_opt(ms as i64).single() { Some(t) => tz.offset_from_utc_datetime(&t.naive_utc()).fix().local_minus_utc() as f64 / 60.0, None => f64::NAN },
        Err(_) => f64::NAN,
    }
}
fn n_tzlist() -> Vec<String> { chrono_tz::TZ_VARIANTS.iter().map(|t| t.name().to_string()).collect() }

// ---- storage: the page's localStorage, kept in one JSON file -----------------------------------------------------------------
thread_local! { static STORE: std::cell::RefCell<Option<PathBuf>> = std::cell::RefCell::new(None); }
fn n_store_read() -> String { STORE.with(|p| p.borrow().as_ref().and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_else(|| "{}".into())) }
fn n_store_write(json: String) { STORE.with(|p| { if let Some(p) = p.borrow().as_ref() { let tmp = p.with_extension("tmp"); if std::fs::write(&tmp, json).is_ok() { let _ = std::fs::rename(&tmp, p); } } }) }

// ---- network: curl in a thread, polled from the loop (the page's fetch) --------------------------------------------------------
type Reply = Option<(i32, Vec<u8>)>;
thread_local! { static HTTP: std::cell::RefCell<Vec<std::sync::mpsc::Receiver<Reply>>> = std::cell::RefCell::new(Vec::new()); }
fn n_http_start(url: String) -> usize {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let out = std::process::Command::new("curl").args(["-sS", "-L", "--max-time", "20", "-w", "\n%{http_code}", &url]).output();
        let r = out.ok().filter(|o| o.status.success()).and_then(|o| { let b = o.stdout; let i = b.iter().rposition(|&c| c == b'\n')?; let code = std::str::from_utf8(&b[i + 1..]).ok()?.trim().parse::<i32>().ok()?; Some((code, b[..i].to_vec())) });
        let _ = tx.send(r);
    });
    HTTP.with(|h| { let mut h = h.borrow_mut(); h.push(rx); h.len() - 1 })
}
/// undefined while pending; { status, data } (status 0 = could not connect) when done
fn n_http_poll<'js>(ctx: Ctx<'js>, id: usize) -> Result<Value<'js>> {
    let r = HTTP.with(|h| h.borrow().get(id).and_then(|rx| rx.try_recv().ok()));
    match r {
        None => Ok(Value::new_undefined(ctx.clone())),
        Some(rep) => { let o = Object::new(ctx.clone())?; match rep { Some((c, b)) => { o.set("status", c)?; o.set("data", ArrayBuffer::new_copy(ctx.clone(), b)?)?; } None => { o.set("status", 0)?; o.set("data", ArrayBuffer::new_copy(ctx.clone(), Vec::<u8>::new())?)?; } } Ok(o.into_value()) }
    }
}

/// The page hands over a finished frame: RGBA from glReadPixels (bottom row first) and the brightness level.
fn n_present<'js>(ctx: Ctx<'js>, w: usize, h: usize, ab: ArrayBuffer<'js>, level: f64) -> Result<()> {
    let px = ab.as_bytes().ok_or_else(|| throw(&ctx, "no bytes".into()))?;
    OUT.with(|o| match o.borrow_mut().as_mut() { Some(out) => out.present(w, h, px, level).map_err(|e| throw(&ctx, e)), None => Ok(()) })
}

fn n_c2d_new(w: u32, h: u32) -> usize { canvas2d::create(w, h) }
fn n_c2d_resize(id: usize, w: u32, h: u32) { canvas2d::resize(id, w, h) }
fn n_c2d_call<'js>(id: usize, op: String, arg: String, buf: Option<ArrayBuffer<'js>>) -> Result<()> {
    let b = buf.and_then(|b| b.as_bytes().map(|x| x.to_vec()));
    canvas2d::call(id, &op, &arg, b); Ok(())
}
fn n_c2d_read<'js>(ctx: Ctx<'js>, id: usize, x: i32, y: i32, w: u32, h: u32) -> Result<ArrayBuffer<'js>> { ArrayBuffer::new_copy(ctx.clone(), canvas2d::read(id, x, y, w, h)) }

struct Res { root: PathBuf }
impl Resolver for Res {
    fn resolve<'js>(&mut self, _c: &Ctx<'js>, base: &str, name: &str) -> Result<String> {
        let joined = if name.starts_with("./") || name.starts_with("../") {
            let dir = Path::new(base).parent().unwrap_or(Path::new(""));
            dir.join(name)
        } else { PathBuf::from(name) };
        // normalise "a/b/../c"
        let mut out: Vec<String> = vec![];
        for part in joined.components() {
            match part.as_os_str().to_str().unwrap_or("") { "." => {}, ".." => { out.pop(); }, s => out.push(s.to_string()) }
        }
        let rel = out.join("/");
        if embedded(&rel).is_some() || self.root.join(&rel).exists() { Ok(rel) } else { Err(rquickjs::Error::new_resolving(base, name)) }
    }
}
struct Load { root: PathBuf }
impl Loader for Load {
    fn load<'js>(&mut self, ctx: &Ctx<'js>, name: &str) -> Result<Module<'js, rquickjs::module::Declared>> {
        let src = match embedded(name) { Some(t) => t, None => std::fs::read_to_string(self.root.join(name)).map_err(|_| rquickjs::Error::new_loading(name))? };
        Module::declare(ctx.clone(), name, src)
    }
}

fn usage() -> ! {
    eprintln!("wobbly-clock-run: shows the clock (the web page's own code, run without a browser)\n\
usage: wobbly-clock-run [--config FILE] [--web DIR] [--sink fb[:DEV]|ppm:DIR|matrix] [--size WxH] [--frames N] [--at EPOCH_MS]\n\
  --config FILE   the settings file (default /etc/wobbly-clock/wobbly-clock.conf)\n\
  --web DIR       the page's files (default $WOBBLY_WEB, /usr/share/wobbly-clock/web, or the current folder)\n\
  --sink          where frames go (default: the config's output: hdmi = fb, matrix = the LED panel)\n\
  --size WxH      the picture size for the ppm sink; --frames N stop after N frames; --at EPOCH_MS pretend it is this moment\n\
tests: wobbly-clock-run <repo-root> <out.ppm> [--app] [--w=N --h=N --search=... --conf=JSON ...]");
    std::process::exit(2)
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    if argv.iter().any(|x| x == "--help" || x == "-h") { usage(); }
    if argv.iter().any(|x| x == "--version" || x == "-V") { println!("wobbly-clock-run {}", env!("CARGO_PKG_VERSION")); return; }
    let legacy = argv.first().map_or(false, |x| !x.starts_with('-'));
    let mut flags: Vec<(String, String)> = vec![];
    let mut pos: Vec<String> = vec![];
    let mut i = 0;
    while i < argv.len() {
        let x = &argv[i];
        if let Some(f) = x.strip_prefix("--") {
            if let Some((k, v)) = f.split_once('=') { flags.push((k.to_string(), v.to_string())); }
            else if !legacy && i + 1 < argv.len() && !argv[i + 1].starts_with("--") && f != "app" { flags.push((f.to_string(), argv[i + 1].clone())); i += 1; }
            else { flags.push((f.to_string(), "1".into())); }
        } else { pos.push(x.clone()); }
        i += 1;
    }
    let fl = |k: &str| flags.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
    let run_mode = !legacy;
    let a: Vec<String> = std::iter::once("wobbly".to_string()).chain(pos.into_iter()).collect();
    if legacy && a.len() < 3 { usage(); }
    let (root, out_path): (PathBuf, String) = if legacy {
        (std::fs::canonicalize(&a[1]).expect("repo root"), a[2].clone())
    } else {
        let web = fl("web").or_else(|| std::env::var("WOBBLY_WEB").ok()).or_else(|| Path::new("/usr/share/wobbly-clock/web").join("index.html").exists().then(|| "/usr/share/wobbly-clock/web".to_string())).unwrap_or_else(|| ".".into());
        (std::fs::canonicalize(&web).unwrap_or_else(|e| { eprintln!("wobbly-clock-run: the page's files are not at {web}: {e}"); std::process::exit(1) }), String::new())
    };
    let mut w: u32 = a.get(3).and_then(|s| s.parse().ok()).or(fl("w").and_then(|v| v.parse().ok())).unwrap_or(480);
    let mut h: u32 = a.get(4).and_then(|s| s.parse().ok()).or(fl("h").and_then(|v| v.parse().ok())).unwrap_or(270);
    let time = a.get(5).cloned().unwrap_or("2026-06-21T20:30:00Z".into());
    let state = a.get(6).cloned().unwrap_or("{}".into());
    // run mode: the settings file and the output
    let mut cfg_text = String::new();
    let mut led: Option<(usize, usize)> = None;
    if run_mode {
        let cp = fl("config").unwrap_or_else(|| "/etc/wobbly-clock/wobbly-clock.conf".into());
        cfg_text = std::fs::read_to_string(&cp).unwrap_or_default();       // no file: the defaults (the setup command writes one)
        let size = fl("size").and_then(|s| s.split_once('x').map(|(a, b)| (a.parse().unwrap_or(480), b.parse().unwrap_or(270)))).unwrap_or((480usize, 270usize));
        let (o, ow, oh) = out::Out::open(fl("sink").as_deref(), &cfg_text, size).unwrap_or_else(|e| { eprintln!("wobbly-clock-run: {e}"); std::process::exit(1) });
        OUT.with(|x| *x.borrow_mut() = Some(o));
        w = ow as u32; h = oh as u32;
        if let Some(out::Kind::Matrix { layout, cell, .. }) = OUT.with(|x| x.borrow().as_ref().map(|o| match &o.kind { out::Kind::Matrix { layout, cell, .. } => out::Kind::Matrix { layout: layout.clone(), panel: None, dir: None, table: [0; 256], cell: *cell }, _ => out::Kind::Ppm { dir: String::new() } })) { led = Some((layout.display_width, layout.display_height)); let _ = cell; }
        for e in &OUT.with(|x| x.borrow().as_ref().map(|o| o.cfg.errors.clone()).unwrap_or_default()) { eprintln!("wobbly-clock-run: {e}"); }
    }

    let egl = egl::Egl::open(3).unwrap_or_else(|e| { eprintln!("{e}"); std::process::exit(1) });
    let gl = Rc::new(gl::Gl::new(egl));
    let rt = Runtime::new().unwrap();
    rt.set_memory_limit(512 << 20);
    rt.set_max_stack_size(4 << 20);
    rt.set_loader(Res { root: root.clone() }, Load { root: root.clone() });
    let ctx = Context::full(&rt).unwrap();
    T0.with(|t| t.set(Some(Instant::now())));
    if let Ok(p) = std::env::var("WOBBLY_STORE") { STORE.with(|s| *s.borrow_mut() = Some(PathBuf::from(p))); }
    GL.with(|g| *g.borrow_mut() = Some(gl.clone()));
    ROOT.with(|r| *r.borrow_mut() = root.clone());

    ctx.with(|ctx| {
        let g = ctx.globals();
        g.set("__gl", Function::new(ctx.clone(), n_gl)).unwrap();
        g.set("__now", Function::new(ctx.clone(), n_now)).unwrap();
        g.set("__print", Function::new(ctx.clone(), |s: String| eprintln!("{s}"))).unwrap();
        g.set("__readfile", Function::new(ctx.clone(), n_readfile)).unwrap();
        g.set("__readtext", Function::new(ctx.clone(), n_readtext)).unwrap();
        g.set("__decode", Function::new(ctx.clone(), n_decode)).unwrap();
        g.set("__writeppm", Function::new(ctx.clone(), n_writeppm)).unwrap();
        g.set("__c2d_new", Function::new(ctx.clone(), n_c2d_new)).unwrap();
        g.set("__c2d_resize", Function::new(ctx.clone(), n_c2d_resize)).unwrap();
        g.set("__c2d_call", Function::new(ctx.clone(), n_c2d_call)).unwrap();
        g.set("__c2d_read", Function::new(ctx.clone(), n_c2d_read)).unwrap();
        g.set("__tzoffset", Function::new(ctx.clone(), n_tzoffset)).unwrap();
        g.set("__tzlist", Function::new(ctx.clone(), n_tzlist)).unwrap();
        g.set("__store_read", Function::new(ctx.clone(), n_store_read)).unwrap();
        g.set("__store_write", Function::new(ctx.clone(), n_store_write)).unwrap();
        g.set("__http_start", Function::new(ctx.clone(), n_http_start)).unwrap();
        g.set("__http_poll", Function::new(ctx.clone(), n_http_poll)).unwrap();
        g.set("__present", Function::new(ctx.clone(), n_present)).unwrap();
        g.set("__done", Function::new(ctx.clone(), || DONE.with(|d| d.set(true)))).unwrap();
        g.set("__root", root.to_string_lossy().to_string()).unwrap();
        let args = Object::new(ctx.clone()).unwrap();
        args.set("w", w).unwrap(); args.set("h", h).unwrap(); args.set("out", out_path.clone()).unwrap(); args.set("time", time.clone()).unwrap(); args.set("state", state.clone()).unwrap();
        for (k, v) in &flags { match v.parse::<f64>() { Ok(n) if !v.is_empty() && !k.ends_with("search") && k != "time" && k != "state" && k != "tz" => { args.set(k.as_str(), n).unwrap(); } _ => { args.set(k.as_str(), v.as_str()).unwrap(); } } }
        if let Some((c, r)) = led { args.set("ledCols", c).unwrap(); args.set("ledRows", r).unwrap(); }
        if run_mode { args.set("app", 1).unwrap(); args.set("config", cfg_text.clone()).unwrap(); args.set("present", 1).unwrap(); }
        if fl("app").is_some() { args.set("app", 1).unwrap(); }
        g.set("__args", args).unwrap();
        eprintln!("GL: {} / {}", gl.version(), (|| { let v = gl.call(&ctx, "getString", &[Value::new_int(ctx.clone(), 0x1F01)]).ok().and_then(|v| v.as_string().and_then(|s| s.to_string().ok())); v.unwrap_or_default() })());

        let host = embedded("host/host.js").expect("host.js");
        if let Err(e) = ctx.eval::<(), _>(host) { eprintln!("host.js: {}", describe(&ctx, e)); std::process::exit(1); }
        let (mod_name, spike) = if run_mode || fl("app").is_some() { ("host/boot.js".to_string(), embedded("host/boot.js").unwrap()) } else {
            let script_path = std::env::var("WOBBLY_SCRIPT").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("native/host/js/spike.js"));
            let full = if script_path.is_absolute() { script_path.clone() } else if root.join(&script_path).exists() { root.join(&script_path) } else { std::env::current_dir().unwrap().join(&script_path) };
            let src = std::fs::read_to_string(&full).unwrap_or_else(|e| { eprintln!("{}: {e}", full.display()); std::process::exit(1) });
            let full = std::fs::canonicalize(&full).unwrap_or(full);
            (full.strip_prefix(&root).map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|_| "script.js".into()), src)
        };
        match Module::evaluate(ctx.clone(), mod_name, spike) { Ok(p) => { MAIN_PROMISE.with(|m| *m.borrow_mut() = Some(rquickjs::Persistent::save(&ctx, p))); } Err(e) => { eprintln!("script: {}", describe(&ctx, e)); std::process::exit(1); } }
    });

    // run promise jobs and timers until the script says it is done
    let started = Instant::now();
    while !DONE.with(|d| d.get()) {
        loop { match rt.execute_pending_job() { Ok(true) => {}, Ok(false) => break, Err(e) => { ctx.with(|c| eprintln!("job error: {}", describe(&c, rquickjs::Error::Exception)));  let _ = e; std::process::exit(1) } } }
        ctx.with(|c| { let _ = c.globals().get::<_, Function>("__pump").and_then(|f| f.call::<_, ()>(())); });
        let failed = ctx.with(|c| MAIN_PROMISE.with(|m| { let p = m.borrow().clone()?; let p = p.restore(&c).ok()?; match p.result::<Value>() { Some(Err(e)) => Some(describe(&c, e)), _ => None } }));
        if let Some(e) = failed { eprintln!("script failed: {e}"); std::process::exit(1); }
        if !run_mode && started.elapsed().as_secs() > 120 { eprintln!("timeout"); std::process::exit(1); }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    OUT.with(|o| if let Some(x) = o.borrow_mut().take() { x.finish(); });
    if !run_mode { eprintln!("rendered {w}x{h} to {out_path} in {:.1}s", started.elapsed().as_secs_f64()); }
    std::process::exit(0);   // (skips freeing the JS heap: the page's objects reference each other)
}

fn describe(ctx: &Ctx<'_>, e: rquickjs::Error) -> String {
    if matches!(e, rquickjs::Error::Exception) {
        let v = ctx.catch();
        if let Some(o) = v.as_object() {
            let m: String = o.get("message").unwrap_or_default(); let s: String = o.get("stack").unwrap_or_default();
            return format!("{m}\n{s}");
        }
        return format!("{v:?}");
    }
    e.to_string()
}
