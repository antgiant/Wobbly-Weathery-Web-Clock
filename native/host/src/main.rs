//! wobbly-host: runs the real sky engine (JavaScript + GLSL, the same files the web page uses) with no browser.
//! Spike usage: wobbly-host <repo-root> <out.ppm> [width height] [time-iso] [state-json]

mod egl;
mod gl;

use rquickjs::loader::{Loader, Resolver};
use rquickjs::{ArrayBuffer, Context, Ctx, Function, Module, Object, Result, Runtime, Value};
use rquickjs::function::Rest;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::Instant;

thread_local! {
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
        if self.root.join(&rel).exists() { Ok(rel) } else { Err(rquickjs::Error::new_resolving(base, name)) }
    }
}
struct Load { root: PathBuf }
impl Loader for Load {
    fn load<'js>(&mut self, ctx: &Ctx<'js>, name: &str) -> Result<Module<'js, rquickjs::module::Declared>> {
        let src = std::fs::read_to_string(self.root.join(name)).map_err(|_| rquickjs::Error::new_loading(name))?;
        Module::declare(ctx.clone(), name, src)
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() < 3 { eprintln!("usage: wobbly-host <repo-root> <out.ppm> [w h] [time] [state-json]"); std::process::exit(2); }
    let root = std::fs::canonicalize(&a[1]).expect("repo root");
    let out = a[2].clone();
    let w: u32 = a.get(3).and_then(|s| s.parse().ok()).unwrap_or(480);
    let h: u32 = a.get(4).and_then(|s| s.parse().ok()).unwrap_or(270);
    let time = a.get(5).cloned().unwrap_or("2026-06-21T20:30:00Z".into());
    let state = a.get(6).cloned().unwrap_or("{}".into());

    let egl = egl::Egl::open(3).unwrap_or_else(|e| { eprintln!("{e}"); std::process::exit(1) });
    let gl = Rc::new(gl::Gl::new(egl));
    let rt = Runtime::new().unwrap();
    rt.set_memory_limit(512 << 20);
    rt.set_max_stack_size(4 << 20);
    rt.set_loader(Res { root: root.clone() }, Load { root: root.clone() });
    let ctx = Context::full(&rt).unwrap();
    T0.with(|t| t.set(Some(Instant::now())));
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
        g.set("__done", Function::new(ctx.clone(), || DONE.with(|d| d.set(true)))).unwrap();
        g.set("__root", root.to_string_lossy().to_string()).unwrap();
        let args = Object::new(ctx.clone()).unwrap();
        args.set("w", w).unwrap(); args.set("h", h).unwrap(); args.set("out", out.clone()).unwrap(); args.set("time", time.clone()).unwrap(); args.set("state", state.clone()).unwrap();
        g.set("__args", args).unwrap();
        eprintln!("GL: {} / {}", gl.version(), (|| { let v = gl.call(&ctx, "getString", &[Value::new_int(ctx.clone(), 0x1F01)]).ok().and_then(|v| v.as_string().and_then(|s| s.to_string().ok())); v.unwrap_or_default() })());

        let host = std::fs::read_to_string(root.join("native/host/js/host.js")).expect("host.js");
        if let Err(e) = ctx.eval::<(), _>(host) { eprintln!("host.js: {}", describe(&ctx, e)); std::process::exit(1); }
        let spike = std::fs::read_to_string(std::env::var("WOBBLY_SCRIPT").map(PathBuf::from).unwrap_or_else(|_| root.join("native/host/js/spike.js"))).expect("spike.js");
        match Module::evaluate(ctx.clone(), "spike", spike) { Ok(p) => { let _ = p; } Err(e) => { eprintln!("spike: {}", describe(&ctx, e)); std::process::exit(1); } }
    });

    // run promise jobs and timers until the script says it is done
    let started = Instant::now();
    while !DONE.with(|d| d.get()) {
        loop { match rt.execute_pending_job() { Ok(true) => {}, Ok(false) => break, Err(e) => { ctx.with(|c| eprintln!("job error: {}", describe(&c, rquickjs::Error::Exception)));  let _ = e; std::process::exit(1) } } }
        ctx.with(|c| { let _ = c.globals().get::<_, Function>("__pump").and_then(|f| f.call::<_, ()>(())); });
        if started.elapsed().as_secs() > 120 { eprintln!("timeout"); std::process::exit(1); }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    eprintln!("rendered {w}x{h} to {out} in {:.1}s", started.elapsed().as_secs_f64());
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
