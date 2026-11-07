//! wobbly-host: runs the real sky engine (JavaScript + GLSL, the same files the web page uses) with no browser.
//! Spike usage: wobbly-host <repo-root> <out.ppm> [width height] [time-iso] [state-json]

mod canvas2d;
mod egl;
mod gl;
mod out;
mod webfiles { include!(concat!(env!("OUT_DIR"), "/web_files.rs")); }

use rquickjs::loader::{Loader, Resolver};
use rquickjs::{ArrayBuffer, Context, Ctx, Function, Module, Object, Result, Runtime, Value};
use rquickjs::function::Rest;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

/// Milliseconds since start at which the program last showed signs of life (the loop turning, a GL call returning); the watchdog thread reads it.
static ALIVE_MS: AtomicU64 = AtomicU64::new(0);
static LAST_PRESENT_MS: AtomicU64 = AtomicU64::new(0);
static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
fn since_start_ms() -> u64 { START.get_or_init(Instant::now).elapsed().as_millis() as u64 }
fn beat() { ALIVE_MS.store(since_start_ms(), Ordering::Relaxed); }

/// systemd's watchdog (Type=notify, WatchdogSec): tell it we are ready and, every minute, that we are well: the loop is turning and pictures keep coming.
/// A program that hangs (a GPU that stops answering, a loop that never ends) stops sending, and systemd restarts it.
fn start_watchdog() {
    use std::os::unix::net::UnixDatagram;
    let Ok(path) = std::env::var("NOTIFY_SOCKET") else { return };
    std::thread::spawn(move || {
        let sock = match UnixDatagram::unbound() { Ok(s) => s, Err(_) => return };
        let send = |msg: &str| {
            if let Some(rest) = path.strip_prefix('@') {
                #[cfg(target_os = "linux")] { use std::os::linux::net::SocketAddrExt; if let Ok(a) = std::os::unix::net::SocketAddr::from_abstract_name(rest.as_bytes()) { let _ = sock.send_to_addr(msg.as_bytes(), &a); } }
            } else { let _ = sock.send_to(msg.as_bytes(), &path); }
        };
        send("READY=1\nSTATUS=starting");
        loop {
            std::thread::sleep(std::time::Duration::from_secs(30));
            let now = since_start_ms();
            let alive = now.saturating_sub(ALIVE_MS.load(Ordering::Relaxed)) < 400_000;                 // the loop has turned in the last ~7 minutes (a first start on a Pi Zero compiles for minutes)
            let lp = LAST_PRESENT_MS.load(Ordering::Relaxed);
            let pictures = if lp == 0 { now < 900_000 } else { now.saturating_sub(lp) < 300_000 };       // and pictures are still being made
            if alive && pictures { send("WATCHDOG=1"); }
        }
    });
}

/// The host's own JavaScript is part of the program (WOBBLY_HOST_JS=dir uses files from a folder instead, for working on them).
const EMBED: &[(&str, &str)] = &[
    ("host/host.js", include_str!("../js/host.js")), ("host/dom.js", include_str!("../js/dom.js")),
    ("host/polyfills.js", include_str!("../js/polyfills.js")), ("host/boot.js", include_str!("../js/boot.js")),
    ("host/gputest.js", include_str!("../js/gputest.js")),
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
    static WEB_ON_DISK: std::cell::Cell<bool> = std::cell::Cell::new(true);
    static WARP: std::cell::Cell<f64> = std::cell::Cell::new(1.0);        // soak tests: time runs this many times faster for every timer in the page
    static LAST_PRESENT: std::cell::Cell<Option<Instant>> = std::cell::Cell::new(None);
    static PRESENTS: std::cell::Cell<u64> = std::cell::Cell::new(0);
    static DONE: std::cell::Cell<bool> = std::cell::Cell::new(false);
    static T0: std::cell::Cell<Option<Instant>> = std::cell::Cell::new(None);
}
/// The page's files: from a folder (`--web DIR`, and the tests), or the copy inside the program (the root is then the made-up folder "/web").
fn vfs_read(p: &str) -> Option<Vec<u8>> {
    let (root, on_disk) = ROOT.with(|r| (r.borrow().to_string_lossy().to_string(), WEB_ON_DISK.with(|d| d.get())));
    let rel = p.strip_prefix(root.as_str()).map(|r| r.trim_start_matches('/')).unwrap_or_else(|| p.trim_start_matches('/'));
    if on_disk { std::fs::read(Path::new(&root).join(rel)).ok().or_else(|| if Path::new(p).is_absolute() { std::fs::read(p).ok() } else { None }) }
    else { webfiles::WEB.iter().find(|(k, _)| *k == rel).map(|(_, v)| v.to_vec()) }
}
fn vfs_exists(rel: &str) -> bool { vfs_read(rel).is_some() }
fn throw<'js>(ctx: &Ctx<'js>, m: String) -> rquickjs::Error { rquickjs::Exception::throw_message(ctx, &m) }
fn n_gl<'js>(ctx: Ctx<'js>, name: String, args: Rest<Value<'js>>) -> Result<Value<'js>> { let g = GL.with(|g| g.borrow().clone().unwrap()); let r = g.call(&ctx, &name, &args.0); beat(); r }
fn n_now() -> f64 { T0.with(|t| t.get().unwrap().elapsed().as_secs_f64() * 1000.0) * WARP.with(|w| w.get()) }
fn n_readfile<'js>(ctx: Ctx<'js>, p: String) -> Result<ArrayBuffer<'js>> {
    let b = vfs_read(&p).ok_or_else(|| throw(&ctx, format!("{p}: not found")))?; ArrayBuffer::new_copy(ctx.clone(), b)
}
fn n_readtext<'js>(ctx: Ctx<'js>, p: String) -> Result<String> { let b = vfs_read(&p).ok_or_else(|| throw(&ctx, format!("{p}: not found")))?; String::from_utf8(b).map_err(|_| throw(&ctx, format!("{p}: not text"))) }
fn n_decode<'js>(ctx: Ctx<'js>, p: String) -> Result<Object<'js>> {
    let bytes = vfs_read(&p).ok_or_else(|| throw(&ctx, format!("{p}: not found")))?;
    let img = image::load_from_memory(&bytes).map_err(|e| throw(&ctx, format!("{p}: {e}")))?.to_rgba8();
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
/// The zone to use from what the system says, in order: TZ, /etc/timezone's text (Debian), where /etc/localtime points. The first that names a zone this program knows; "" when none.
fn pick_zone(tz: Option<&str>, timezone_file: Option<&str>, localtime_link: Option<&str>) -> String {
    let ok = |z: &str| !z.is_empty() && z.parse::<chrono_tz::Tz>().is_ok();
    if let Some(z) = tz { let z = z.trim_start_matches(':'); if ok(z) { return z.to_string(); } }
    if let Some(t) = timezone_file { let z = t.trim(); if ok(z) { return z.to_string(); } }
    if let Some(p) = localtime_link { if let Some(i) = p.find("zoneinfo/") { let z = &p[i + 9..]; if ok(z) { return z.to_string(); } } }
    String::new()
}
/// The Pi's own time zone (what `timedatectl` shows).
fn n_syszone() -> String {
    let link = std::fs::read_link("/etc/localtime").ok().map(|p| p.to_string_lossy().to_string());
    pick_zone(std::env::var("TZ").ok().as_deref(), std::fs::read_to_string("/etc/timezone").ok().as_deref(), link.as_deref())
}
#[cfg(test)]
mod zone_tests {
    use super::pick_zone;
    #[test]
    fn the_zone_comes_from_the_first_source_that_names_one() {
        assert_eq!(pick_zone(Some("America/New_York"), Some("Europe/Paris\n"), None), "America/New_York");
        assert_eq!(pick_zone(Some(":Europe/Paris"), None, None), "Europe/Paris");
        assert_eq!(pick_zone(None, Some("America/Chicago\n"), Some("/usr/share/zoneinfo/Asia/Tokyo")), "America/Chicago");
        assert_eq!(pick_zone(None, None, Some("/usr/share/zoneinfo/Asia/Tokyo")), "Asia/Tokyo");
        assert_eq!(pick_zone(Some("Bogus/Zone"), Some(""), Some("../zoneinfo/America/Denver")), "America/Denver");
        assert_eq!(pick_zone(None, None, None), "");
        assert_eq!(pick_zone(Some(""), Some("garbage"), Some("/etc/foo")), "");
    }
}
fn n_tzlist() -> Vec<String> { chrono_tz::TZ_VARIANTS.iter().map(|t| t.name().to_string()).collect() }

// ---- storage: the page's localStorage, kept in one JSON file -----------------------------------------------------------------
thread_local! { static STORE: std::cell::RefCell<Option<PathBuf>> = std::cell::RefCell::new(None); }
fn n_store_read() -> String { STORE.with(|p| p.borrow().as_ref().and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_else(|| "{}".into())) }
fn n_store_write(json: String) { STORE.with(|p| { if let Some(p) = p.borrow().as_ref() { let tmp = p.with_extension("tmp"); if std::fs::write(&tmp, json).is_ok() { let _ = std::fs::rename(&tmp, p); } } }) }

// ---- network: curl in a thread, polled from the loop (the page's fetch) --------------------------------------------------------
type Reply = Option<(i32, Vec<u8>)>;
thread_local! { static HTTP: std::cell::RefCell<std::collections::HashMap<usize, std::sync::mpsc::Receiver<Reply>>> = std::cell::RefCell::new(std::collections::HashMap::new()); static HTTP_N: std::cell::Cell<usize> = std::cell::Cell::new(0); }
fn n_http_start(url: String) -> usize {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let out = std::process::Command::new("curl").args(["-sS", "-L", "--max-time", "20", "-w", "\n%{http_code}", &url]).output();
        let r = out.ok().filter(|o| o.status.success()).and_then(|o| { let b = o.stdout; let i = b.iter().rposition(|&c| c == b'\n')?; let code = std::str::from_utf8(&b[i + 1..]).ok()?.trim().parse::<i32>().ok()?; Some((code, b[..i].to_vec())) });
        let _ = tx.send(r);
    });
    let id = HTTP_N.with(|n| { n.set(n.get() + 1); n.get() });
    HTTP.with(|h| h.borrow_mut().insert(id, rx));
    id
}
/// undefined while pending; { status, data } (status 0 = could not connect) when done
fn n_http_poll<'js>(ctx: Ctx<'js>, id: usize) -> Result<Value<'js>> {
    let r = HTTP.with(|h| { let mut h = h.borrow_mut(); let got = h.get(&id).and_then(|rx| rx.try_recv().ok()); if got.is_some() { h.remove(&id); } got });      // an answer is delivered once, and forgotten
    match r {
        None => Ok(Value::new_undefined(ctx.clone())),
        Some(rep) => { let o = Object::new(ctx.clone())?; match rep { Some((c, b)) => { o.set("status", c)?; o.set("data", ArrayBuffer::new_copy(ctx.clone(), b)?)?; } None => { o.set("status", 0)?; o.set("data", ArrayBuffer::new_copy(ctx.clone(), Vec::<u8>::new())?)?; } } Ok(o.into_value()) }
    }
}

/// The page hands over a finished frame: RGBA from glReadPixels (bottom row first) and the brightness level.
fn n_present<'js>(ctx: Ctx<'js>, w: usize, h: usize, ab: ArrayBuffer<'js>, level: f64) -> Result<()> {
    let px = ab.as_bytes().ok_or_else(|| throw(&ctx, "no bytes".into()))?;
    LAST_PRESENT.with(|l| l.set(Some(Instant::now()))); PRESENTS.with(|p| p.set(p.get() + 1)); LAST_PRESENT_MS.store(since_start_ms(), Ordering::Relaxed);
    OUT.with(|o| match o.borrow_mut().as_mut() { Some(out) => out.present(w, h, px, level).map_err(|e| throw(&ctx, e)), None => Ok(()) })
}

fn n_c2d_new(w: u32, h: u32) -> usize { canvas2d::create(w, h) }
fn n_c2d_free(id: usize) { canvas2d::free(id) }
fn n_c2d_count() -> usize { canvas2d::count() }
/// Resident memory of this program in MB (Linux), or 0.
fn rss_mb() -> f64 { std::fs::read_to_string("/proc/self/statm").ok().and_then(|s| s.split_whitespace().nth(1).and_then(|v| v.parse::<f64>().ok())).map(|p| p * 4096.0 / 1048576.0).unwrap_or(0.0) }
fn n_rss() -> f64 { rss_mb() }
/// The CPU time this program has used so far, "user,system" in ms (Linux; the kernel counts it in 10 ms ticks): set against the wall clock it says whether a run is waiting (for the GPU, a timer) or computing,
/// and the system part is the driver's own work.
fn n_cpu() -> String {
    let t = std::fs::read_to_string("/proc/self/stat").unwrap_or_default();
    let f: Vec<&str> = t.rsplit(')').next().unwrap_or("").split_whitespace().collect();
    let g = |i: usize| f.get(i).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0) * 10.0;
    format!("{},{}", g(11), g(12))
}
fn n_exit(code: i32) { OUT.with(|o| if let Some(x) = o.borrow_mut().take() { x.finish(); }); leave(code) }
fn n_presents() -> f64 { PRESENTS.with(|p| p.get()) as f64 }
fn n_c2d_resize(id: usize, w: u32, h: u32) { canvas2d::resize(id, w, h) }
fn n_c2d_call<'js>(id: usize, op: String, arg: String, buf: Option<ArrayBuffer<'js>>) -> Result<()> {
    let b = buf.and_then(|b| b.as_bytes().map(|x| x.to_vec()));
    canvas2d::call(id, &op, &arg, b); Ok(())
}
fn n_c2d_read<'js>(ctx: Ctx<'js>, id: usize, x: i32, y: i32, w: u32, h: u32) -> Result<ArrayBuffer<'js>> { ArrayBuffer::new_copy(ctx.clone(), canvas2d::read(id, x, y, w, h)) }

struct Res;
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
        if embedded(&rel).is_some() || vfs_exists(&rel) { Ok(rel) } else { Err(rquickjs::Error::new_resolving(base, name)) }
    }
}
struct Load;
impl Loader for Load {
    fn load<'js>(&mut self, ctx: &Ctx<'js>, name: &str) -> Result<Module<'js, rquickjs::module::Declared>> {
        let src = match embedded(name) { Some(t) => t, None => String::from_utf8(vfs_read(name).ok_or_else(|| rquickjs::Error::new_loading(name))?).map_err(|_| rquickjs::Error::new_loading(name))? };
        Module::declare(ctx.clone(), name, src)
    }
}

/// Start this program again with Mesa's software renderer (the environment must be set before the driver loads).
fn reexec_software() -> ! {
    use std::os::unix::process::CommandExt;
    { extern "C" { fn dup2(a: i32, b: i32) -> i32; } let o = ORIG_STDERR.load(std::sync::atomic::Ordering::Relaxed); if o >= 0 { unsafe { dup2(o, 2); } std::thread::sleep(std::time::Duration::from_millis(80)); } }      // (the new program must get the real stderr, not our filter's pipe; and the filter is given a moment to pass on what it holds)
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("wobbly-clock-run"));
    let err = std::process::Command::new(exe).args(std::env::args().skip(1)).env("WOBBLY_SOFTWARE", "1").env("LIBGL_ALWAYS_SOFTWARE", "1").env("GALLIUM_DRIVER", std::env::var("GALLIUM_DRIVER").unwrap_or_else(|_| "llvmpipe".into())).exec();
    eprintln!("wobbly-clock-run: cannot restart with software rendering: {err}"); leave(1)
}

fn usage(code: i32) -> ! {
    let text = format!("wobbly-clock-run: shows the clock (the web page's own code, run without a browser)\n\
usage: wobbly-clock-run [--config FILE] [--web DIR] [--sink fb[:DEV]|ppm:DIR|matrix] [--size WxH] [--frames N] [--at EPOCH_MS]\n\
  --config FILE   the settings file (default /etc/wobbly-clock/wobbly-clock.conf)\n\
  --web DIR       use the page's files from this folder instead of the copy inside the program (for working on the page)\n\
  --sink          where frames go (default: the config's output: hdmi = fb, matrix = the LED panel)\n\
  --gpu-test      probe this GPU on the OpenGL ES 2 path and print what it can do (for the Pi Zero, 1 and 3)\n\
  --software      draw on the CPU (Mesa llvmpipe); chosen automatically when there is no GPU context at all\n\
  --es2           take the OpenGL ES 2 path (the Pi Zero and 3) on any GPU, for tests; chosen automatically when the GPU has no OpenGL ES 3\n\
  --size WxH      the picture size for the ppm sink; --frames N stop after N frames; --at EPOCH_MS pretend it is this moment\n\
tests: wobbly-clock-run <repo-root> <out.ppm> [--app] [--w=N --h=N --search=... --conf=JSON ...]");
    if code == 0 { println!("{text}"); } else { eprintln!("{text}"); }
    leave(code)
}

/// The GPU driver on a Pi Zero or 3 (Mesa's VC4) prints a whole shader, hundreds of thousands of lines, whenever it cannot fit one into its registers and tries again another
/// way. That goes through here (stderr is a pipe for the program's own lifetime): the lines of such a dump are dropped and one line says it happened; everything else is
/// passed on as it came. WOBBLY_RAW_STDERR=1 turns this off.
static ORIG_STDERR: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(-1);
/// How many times the driver said it could not fit a shader into its registers (the filter counts them; the page asks, to say which shader it was).
pub static REG_FAILS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
/// Ends the program. If stderr was put through the filter below, the real one is put back and the filter is given a moment to pass on what it holds.
fn leave(code: i32) -> ! {
    extern "C" { fn dup2(a: i32, b: i32) -> i32; }
    let o = ORIG_STDERR.load(std::sync::atomic::Ordering::Relaxed);
    if o >= 0 { unsafe { dup2(o, 2); } std::thread::sleep(std::time::Duration::from_millis(60)); }
    std::process::exit(code)
}
fn quiet_driver_noise() {
    use std::io::{BufRead, BufReader, Write};
    use std::os::unix::io::FromRawFd;
    extern "C" { fn pipe(fds: *mut i32) -> i32; fn dup(fd: i32) -> i32; fn dup2(a: i32, b: i32) -> i32; }
    if std::env::var("WOBBLY_RAW_STDERR").is_ok() { return; }
    unsafe {
        let mut fds = [0i32; 2];
        if pipe(fds.as_mut_ptr()) != 0 { return; }
        let orig = dup(2);
        if orig < 0 || dup2(fds[1], 2) < 0 { return; }
        ORIG_STDERR.store(dup(orig), std::sync::atomic::Ordering::Relaxed);          // (a second copy of the real stderr for leave(): the filter owns `orig`)
        let reader = std::fs::File::from_raw_fd(fds[0]);
        let mut out = std::fs::File::from_raw_fd(orig);
        std::thread::spawn(move || {
            let mut dump = false; let mut hidden = 0u64;
            for line in BufReader::new(reader).split(b'\n').flatten() {
                let t = String::from_utf8_lossy(&line);
                let is_dump = t.starts_with("Failed to register allocate") || (dump && (t.is_empty() || t.starts_with(' ') || t.starts_with('\t') || t.starts_with("BLOCK") || t.starts_with("->") || t.starts_with(|c: char| c.is_ascii_digit()) || t.starts_with("temp") || t.starts_with("Spill")));
                if is_dump {
                    if t.starts_with("Failed to register allocate") { REG_FAILS.fetch_add(1, std::sync::atomic::Ordering::Relaxed); let _ = writeln!(out, "wobbly-clock-run: the GPU driver could not fit a shader into its registers and is trying another way (its listing is not shown; set WOBBLY_RAW_STDERR=1 to see it)"); }
                    dump = true; hidden += 1; continue;
                }
                dump = false;
                let _ = out.write_all(&line); let _ = out.write_all(b"\n");
            }
            let _ = hidden;
        });
    }
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    if argv.iter().any(|x| x == "--help" || x == "-h") { usage(0); }
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
    let gpu_test = argv.iter().any(|x| x == "--gpu-test");
    let run_mode = !legacy && !gpu_test;
    START.get_or_init(Instant::now);
    let a: Vec<String> = std::iter::once("wobbly".to_string()).chain(pos.into_iter()).collect();
    if legacy && a.len() < 3 { usage(2); }
    let (root, out_path): (PathBuf, String) = if gpu_test { WEB_ON_DISK.with(|d| d.set(false)); (PathBuf::from("/web"), String::new()) } else if legacy {
        (std::fs::canonicalize(&a[1]).expect("repo root"), a[2].clone())
    } else {
        match fl("web").or_else(|| std::env::var("WOBBLY_WEB").ok()) {
            Some(web) => (std::fs::canonicalize(&web).unwrap_or_else(|e| { eprintln!("wobbly-clock-run: the page's files are not at {web}: {e}"); leave(1) }), String::new()),
            None => { WEB_ON_DISK.with(|d| d.set(false)); (PathBuf::from("/web"), String::new()) }       // the copy inside the program
        }
    };
    let mut w: u32 = a.get(3).and_then(|s| s.parse().ok()).or(fl("w").and_then(|v| v.parse().ok())).unwrap_or(480);
    let mut h: u32 = a.get(4).and_then(|s| s.parse().ok()).or(fl("h").and_then(|v| v.parse().ok())).unwrap_or(270);
    let time = a.get(5).cloned().unwrap_or("2026-06-21T20:30:00Z".into());
    let state = a.get(6).cloned().unwrap_or("{}".into());
    if let Some(wp) = fl("timewarp").and_then(|v| v.parse::<f64>().ok()) { WARP.with(|w| w.set(wp.max(1.0))); }       // soak tests: every timer of the page runs this many times faster
    // run mode: the settings file and the output
    let mut cfg_text = String::new();
    let mut led: Option<(usize, usize)> = None;
    if run_mode {
        let cp = fl("config").unwrap_or_else(|| "/etc/wobbly-clock/wobbly-clock.conf".into());
        cfg_text = std::fs::read_to_string(&cp).unwrap_or_default();       // no file: the defaults (the setup command writes one)
        let size = fl("size").and_then(|s| s.split_once('x').map(|(a, b)| (a.parse().unwrap_or(480), b.parse().unwrap_or(270)))).unwrap_or((480usize, 270usize));
        let (o, ow, oh) = out::Out::open(fl("sink").as_deref(), &cfg_text, size).unwrap_or_else(|e| { eprintln!("wobbly-clock-run: {e}"); leave(1) });
        OUT.with(|x| *x.borrow_mut() = Some(o));
        start_watchdog();
        w = ow as u32; h = oh as u32;
        if let Some(out::Kind::Matrix { layout, cell, .. }) = OUT.with(|x| x.borrow().as_ref().map(|o| match &o.kind { out::Kind::Matrix { layout, cell, .. } => out::Kind::Matrix { layout: layout.clone(), panel: None, dir: None, table: [0; 256], cell: *cell }, _ => out::Kind::Ppm { dir: String::new() } })) { led = Some((layout.display_width, layout.display_height)); let _ = cell; }
        for e in &OUT.with(|x| x.borrow().as_ref().map(|o| o.cfg.errors.clone()).unwrap_or_default()) { eprintln!("wobbly-clock-run: {e}"); }
    }

    // The page's shaders need OpenGL ES 3. The Raspberry Pi 4 and 5 have it in hardware; the Pi 3, the Zero 2 and the Zero have only ES 2, and for them
    // Mesa's software renderer (llvmpipe) provides ES 3 on the CPU: slower, but the same picture. Software rendering is also chosen with --software.
    let force_software = flags.iter().any(|(k, _)| k == "software");
    if force_software && std::env::var("WOBBLY_SOFTWARE").is_err() { reexec_software(); }
    quiet_driver_noise();
    let opened = if gpu_test { egl::Egl::open(2) } else if std::env::var("WOBBLY_FAKE_NO_ES3").is_ok() && std::env::var("WOBBLY_SOFTWARE").is_err() { Err("simulated: no EGL configuration for OpenGL ES 3".to_string()) } else { egl::Egl::open(3) };   // (the variable is for the test of the fallback)
    // No ES 3: the Pi Zero (all models), 1, 2 and 3 have OpenGL ES 2 in hardware, and the page's shaders run there in their ES 2 form (js/sky/portable.js). Only when there is
    // no GPU context at all does the program fall back to the CPU renderer. (WOBBLY_FAKE_NO_ES3 tests that fallback; --es2 makes any GPU take the ES 2 path.)
    let egl = match opened {
        Ok(e) => e,
        Err(e) => {
            if std::env::var("WOBBLY_SOFTWARE").is_err() && !e.contains("libEGL") {
                let try_es2 = !gpu_test && std::env::var("WOBBLY_FAKE_NO_ES3").is_err() && std::env::var("WOBBLY_NO_ES2").is_err();
                match if try_es2 { egl::Egl::open(2) } else { Err("not tried".to_string()) } {
                    Ok(e2) => { eprintln!("wobbly-clock-run: no OpenGL ES 3 on this GPU ({e}): using its OpenGL ES 2 (the page's shaders in their ES 2 form)"); e2 }
                    Err(e2) => { eprintln!("wobbly-clock-run: no OpenGL ES 3 on this GPU ({e}), and ES 2 gives: {e2}: drawing on the CPU instead (slower)"); reexec_software(); }
                }
            } else { eprintln!("wobbly-clock-run: {e}"); leave(1) }
        }
    };
    let gl = Rc::new(gl::Gl::new(egl));
    if flags.iter().any(|(k, _)| k == "es2") { gl.set_es2(true); }
    let rt = Runtime::new().unwrap();
    rt.set_memory_limit(512 << 20);
    if let Some(mb) = std::env::var("WOBBLY_GC_MB").ok().and_then(|v| v.parse::<usize>().ok()) { rt.set_gc_threshold(mb << 20); eprintln!("wobbly-clock-run: the JavaScript heap is collected after every {mb} MB of new memory (WOBBLY_GC_MB)"); }
    rt.set_max_stack_size(4 << 20);
    rt.set_loader(Res, Load);
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
        g.set("__cpu", Function::new(ctx.clone(), n_cpu)).unwrap();
        g.set("__qjsgc", Function::new(ctx.clone(), |c: Ctx<'_>| { let t = Instant::now(); c.run_gc(); t.elapsed().as_secs_f64() * 1000.0 })).unwrap();
        g.set("__readfile", Function::new(ctx.clone(), n_readfile)).unwrap();
        g.set("__readtext", Function::new(ctx.clone(), n_readtext)).unwrap();
        g.set("__decode", Function::new(ctx.clone(), n_decode)).unwrap();
        g.set("__writeppm", Function::new(ctx.clone(), n_writeppm)).unwrap();
        g.set("__c2d_new", Function::new(ctx.clone(), n_c2d_new)).unwrap();
        g.set("__c2d_resize", Function::new(ctx.clone(), n_c2d_resize)).unwrap();
        g.set("__c2d_free", Function::new(ctx.clone(), n_c2d_free)).unwrap();
        g.set("__c2d_count", Function::new(ctx.clone(), n_c2d_count)).unwrap();
        g.set("__rss", Function::new(ctx.clone(), n_rss)).unwrap();
        g.set("__exit", Function::new(ctx.clone(), n_exit)).unwrap();
        g.set("__presents", Function::new(ctx.clone(), n_presents)).unwrap();
        g.set("__c2d_call", Function::new(ctx.clone(), n_c2d_call)).unwrap();
        g.set("__c2d_read", Function::new(ctx.clone(), n_c2d_read)).unwrap();
        g.set("__tzoffset", Function::new(ctx.clone(), n_tzoffset)).unwrap();
        g.set("__tzlist", Function::new(ctx.clone(), n_tzlist)).unwrap();
        g.set("__syszone", Function::new(ctx.clone(), n_syszone)).unwrap();
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
        if let Err(e) = ctx.eval::<(), _>(host) { eprintln!("host.js: {}", describe(&ctx, e)); leave(1); }
        let (mod_name, spike) = if gpu_test { ("host/gputest.js".to_string(), embedded("host/gputest.js").unwrap()) } else if run_mode || fl("app").is_some() { ("host/boot.js".to_string(), embedded("host/boot.js").unwrap()) } else {
            let script_path = std::env::var("WOBBLY_SCRIPT").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("native/host/js/spike.js"));
            let full = if script_path.is_absolute() { script_path.clone() } else if root.join(&script_path).exists() { root.join(&script_path) } else { std::env::current_dir().unwrap().join(&script_path) };
            let src = std::fs::read_to_string(&full).unwrap_or_else(|e| { eprintln!("{}: {e}", full.display()); leave(1) });
            let full = std::fs::canonicalize(&full).unwrap_or(full);
            (full.strip_prefix(&root).map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|_| "script.js".into()), src)
        };
        match Module::evaluate(ctx.clone(), mod_name, spike) { Ok(p) => { MAIN_PROMISE.with(|m| *m.borrow_mut() = Some(rquickjs::Persistent::save(&ctx, p))); } Err(e) => { eprintln!("script: {}", describe(&ctx, e)); leave(1); } }
    });

    // run promise jobs and timers until the script says it is done
    let started = Instant::now();
    while !DONE.with(|d| d.get()) {
        loop { match rt.execute_pending_job() { Ok(true) => {}, Ok(false) => break, Err(e) => { ctx.with(|c| eprintln!("job error: {}", describe(&c, rquickjs::Error::Exception)));  let _ = e; leave(1) } } }
        beat();
        ctx.with(|c| { let _ = c.globals().get::<_, Function>("__pump").and_then(|f| f.call::<_, ()>(())); });
        let failed = ctx.with(|c| MAIN_PROMISE.with(|m| { let p = m.borrow().clone()?; let p = p.restore(&c).ok()?; match p.result::<Value>() { Some(Err(e)) => Some(describe(&c, e)), _ => None } }));
        if let Some(e) = failed { eprintln!("script failed: {e}"); leave(1); }
        if !run_mode && started.elapsed().as_secs() > 120 { eprintln!("timeout"); leave(1); }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    OUT.with(|o| if let Some(x) = o.borrow_mut().take() { x.finish(); });
    if !run_mode { eprintln!("rendered {w}x{h} to {out_path} in {:.1}s", started.elapsed().as_secs_f64()); }
    leave(0);   // (skips freeing the JS heap: the page's objects reference each other)
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
