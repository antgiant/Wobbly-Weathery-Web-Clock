//! wobbly-clock-run: shows the clock. `wobbly-clock-run --config /etc/wobbly-clock/wobbly-clock.conf` (what the systemd service runs).
//!   --sink fb[:/dev/fb0] | ppm:<dir> | matrix     where the picture goes (default: the config's `output`: hdmi = fb, matrix = the LED panel)
//!   --size WxH            the picture size for the ppm sink (the framebuffer and the panel have their own)
//!   --frames N            stop after N frames (for tests); --at <epoch-ms>  pretend it is this moment
use std::io::Write;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use wobbly_core::clock::Clock;
use wobbly_core::config;
use wobbly_core::frame::ppm;
use wobbly_core::matrix;
use wobbly_core::output::{apply_gamma, gamma_table, hardware_brightness, next_scale, parse_virtual_size, scaled_size, to_framebuffer, upscale, FbFormat};
use wobbly_core::sink::MatrixSink;

fn arg(a: &[String], name: &str) -> Option<String> { a.iter().position(|x| x == name).and_then(|i| a.get(i + 1).cloned()) }

fn now_ms() -> f64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0) }

fn read_fb(dev: &str) -> Result<FbFormat, String> {
    let name = dev.trim_start_matches("/dev/");
    let sys = |f: &str| std::fs::read_to_string(format!("/sys/class/graphics/{name}/{f}")).map_err(|e| format!("cannot read {name}/{f}: {e}"));
    let (width, height) = parse_virtual_size(&sys("virtual_size")?).ok_or("cannot read the framebuffer size")?;
    Ok(FbFormat { width, height, bits_per_pixel: sys("bits_per_pixel")?.trim().parse().map_err(|_| "bad bits_per_pixel")?, stride: sys("stride")?.trim().parse().map_err(|_| "bad stride")? })
}

fn run() -> Result<(), String> {
    let a: Vec<String> = std::env::args().skip(1).collect();
    if a.iter().any(|x| x == "--version" || x == "-V") { println!("wobbly-clock-run {}", env!("CARGO_PKG_VERSION")); return Ok(()); }
    if a.iter().any(|x| x == "--help" || x == "-h") { println!("usage: wobbly-clock-run --config FILE [--sink fb[:DEV]|ppm:DIR|matrix] [--size WxH] [--frames N] [--at EPOCH_MS]"); return Ok(()); }
    let cfg_path = arg(&a, "--config").unwrap_or_else(|| "/etc/wobbly-clock/wobbly-clock.conf".into());
    let text = std::fs::read_to_string(&cfg_path).unwrap_or_default();       // no file: the defaults (the setup command writes one)
    let cfg = config::parse(&text);
    for e in &cfg.errors { eprintln!("{cfg_path}: {e}"); }
    let fixed_at: Option<f64> = arg(&a, "--at").and_then(|x| x.parse().ok());
    let mut clock = Clock::new(cfg.clone());
    // live weather: the first answer before the first frame, then refreshed in the background
    let live = if cfg.weather_mode == "live" && (fixed_at.is_none() || std::env::var("WOBBLY_CURL").is_ok()) { Some(wobbly_core::live::Live::start(cfg.latitude, cfg.longitude, Duration::from_secs(600))) } else { None };
    clock.live = live.clone();
    let sink = arg(&a, "--sink").unwrap_or_else(|| if cfg.output == "matrix" { "matrix".into() } else { "fb".into() });
    let frames: Option<usize> = arg(&a, "--frames").and_then(|x| x.parse().ok());
    let (w, h) = arg(&a, "--size").and_then(|s| s.split_once('x').map(|(w, h)| (w.parse().unwrap_or(128), h.parse().unwrap_or(64)))).unwrap_or((128, 64));

    let layout = if sink == "matrix" || cfg.output == "matrix" && sink.starts_with("ppm") {
        let p = if cfg.matrix_config.is_empty() { "/etc/wobbly-clock/matrix.cfg".to_string() } else { cfg.matrix_config.clone() };
        Some(matrix::parse(&std::fs::read_to_string(&p).map_err(|e| format!("{p}: {e}"))?)?)
    } else { None };
    let fb_dev = sink.strip_prefix("fb").map(|r| r.strip_prefix(':').unwrap_or("/dev/fb0").to_string());
    let fb = match &fb_dev { Some(d) => Some(read_fb(d)?), None => None };
    let table = gamma_table(cfg.gamma);
    let mut panel = match (&layout, sink.as_str()) { (Some(l), "matrix") => Some(MatrixSink::spawn(l, &cfg.led)?), _ => None };
    let mut n = 0usize;
    let start = std::time::Instant::now();
    // HDMI on a slow machine: draw smaller and enlarge when a frame takes too long (a Pi Zero cannot draw 1080p glass every second); `renderScale` forces it
    let mut scale = (cfg.render_scale as usize).max(1);
    loop {
        let t = fixed_at.unwrap_or_else(now_ms) + if fixed_at.is_some() { n as f64 * 1000.0 } else { 0.0 };
        let began = std::time::Instant::now();
        if let Some(l) = &layout {
            // an LED panel: the picture at full values, gamma for the panel, the brightness through the panel's own PWM (see output.rs)
            let level = clock.level(t);
            let full = { let mut c = Clock::new(wobbly_core::config::Config { brightness_day: 1.0, brightness_night: 1.0, ..cfg.clone() }); c.frame(t, l.display_width, l.display_height) };
            let mut rgb = full; apply_gamma(&mut rgb, &table);
            let canvas = l.map_frame(&rgb);
            if let Some(dir) = sink.strip_prefix("ppm:") {
                let (cw, ch) = l.canvas_size();
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
                std::fs::write(format!("{dir}/canvas-{n:04}.ppm"), ppm(&canvas, cw, ch)).map_err(|e| e.to_string())?;
                std::fs::write(format!("{dir}/brightness-{n:04}.txt"), format!("{}\n", hardware_brightness(level))).map_err(|e| e.to_string())?;
            } else if let Some(p) = panel.as_mut() {
                let (cw, ch) = l.canvas_size();
                p.send(&canvas, cw, ch, hardware_brightness(level))?;
            } else { return Err(format!("unknown sink \"{sink}\"")); }
        } else if let (Some(d), Some(f)) = (&fb_dev, &fb) {
            let (rw, rh) = scaled_size(f.width, f.height, scale);
            let small = clock.frame(t, rw, rh);
            let rgb = upscale(&small, rw, rh, f.width, f.height);
            let bytes = to_framebuffer(&rgb, f)?;
            let mut file = std::fs::OpenOptions::new().write(true).open(d).map_err(|e| format!("{d}: {e}"))?;
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            if cfg.render_scale == 0 { let s = next_scale(scale, began.elapsed().as_secs_f64(), 0.4, 1); if s != scale { eprintln!("wobbly-clock-run: a frame took {:.2} s; drawing {s} times smaller (set renderScale to choose)", began.elapsed().as_secs_f64()); scale = s; } }
        } else if let Some(dir) = sink.strip_prefix("ppm:") {
            let rgb = clock.frame(t, w, h);
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            std::fs::write(format!("{dir}/frame-{n:04}.ppm"), ppm(&rgb, w, h)).map_err(|e| e.to_string())?;
        } else { return Err(format!("unknown sink \"{sink}\"")); }
        n += 1;
        if frames.map_or(false, |m| n >= m) { if let Some(p) = panel.take() { p.finish()?; } return Ok(()); }
        let next = Duration::from_millis(1000) - Duration::from_millis((start.elapsed().as_millis() % 1000) as u64);   // the next whole second
        std::thread::sleep(next);
    }
}

fn main() { if let Err(e) = run() { eprintln!("wobbly-clock-run: {e}"); std::process::exit(1); } }
