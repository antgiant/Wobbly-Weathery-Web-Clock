//! Where the finished frames go: the framebuffer (HDMI), an LED panel (through wobbly-matrix), or picture files (tests). The pictures arrive
//! from the page as RGBA read back from the OpenGL framebuffer (bottom row first); the panel and framebuffer code is the project's existing
//! (and tested) matrix mapping, gamma and byte conversions in wobbly-core.

use std::io::Write;
use wobbly_core::config::{self, Config};
use wobbly_core::matrix::{self, Layout};
use wobbly_core::output::{apply_gamma, gamma_table, hardware_brightness, parse_virtual_size, to_framebuffer, FbFormat};
use wobbly_core::sink::MatrixSink;

pub enum Kind {
    Ppm { dir: String },
    Fb { dev: String, fmt: FbFormat },
    Matrix { layout: Layout, panel: Option<MatrixSink>, dir: Option<String>, table: [u8; 256], cell: usize },
}
pub struct Out { pub kind: Kind, pub cfg: Config, n: usize }

fn read_fb(dev: &str) -> Result<FbFormat, String> {
    let name = dev.trim_start_matches("/dev/");
    let sys = |f: &str| std::fs::read_to_string(format!("/sys/class/graphics/{name}/{f}")).map_err(|e| format!("cannot read {name}/{f}: {e}"));
    let (width, height) = parse_virtual_size(&sys("virtual_size")?).ok_or("cannot read the framebuffer size")?;
    Ok(FbFormat { width, height, bits_per_pixel: sys("bits_per_pixel")?.trim().parse().map_err(|_| "bad bits_per_pixel")?, stride: sys("stride")?.trim().parse().map_err(|_| "bad stride")? })
}

/// LED cells are drawn this many pixels wide in the page's LED look (the page needs at least 2), and read back from the middle of each.
pub const CELL: usize = 4;

impl Out {
    /// Open the sink named by `--sink` (default: the config's `output`) and say what size the page should draw at.
    pub fn open(spec: Option<&str>, cfg_text: &str, size: (usize, usize)) -> Result<(Out, usize, usize), String> {
        let cfg = config::parse(cfg_text);
        let spec = spec.map(|s| s.to_string()).unwrap_or_else(|| if cfg.output == "matrix" { "matrix".into() } else { "fb".into() });
        let want_layout = spec == "matrix" || (cfg.output == "matrix" && spec.starts_with("ppm"));
        let layout = if want_layout {
            let p = if cfg.matrix_config.is_empty() { "/etc/wobbly-clock/matrix.cfg".to_string() } else { cfg.matrix_config.clone() };
            Some(matrix::parse(&std::fs::read_to_string(&p).map_err(|e| format!("{p}: {e}"))?)?)
        } else { None };
        if let Some(l) = layout {
            let (w, h) = (l.display_width * CELL, l.display_height * CELL);
            let table = gamma_table(cfg.gamma);
            let (panel, dir) = if let Some(d) = spec.strip_prefix("ppm:") { (None, Some(d.to_string())) } else { (Some(MatrixSink::spawn(&l, &cfg.led)?), None) };
            return Ok((Out { kind: Kind::Matrix { layout: l, panel, dir, table, cell: CELL }, cfg, n: 0 }, w, h));
        }
        if let Some(d) = spec.strip_prefix("ppm:") { return Ok((Out { kind: Kind::Ppm { dir: d.to_string() }, cfg, n: 0 }, size.0, size.1)); }
        if let Some(rest) = spec.strip_prefix("fb") {
            let dev = rest.strip_prefix(':').unwrap_or("/dev/fb0").to_string();
            let fmt = read_fb(&dev)?; let (w, h) = (fmt.width, fmt.height);
            return Ok((Out { kind: Kind::Fb { dev, fmt }, cfg, n: 0 }, w, h));
        }
        Err(format!("unknown sink \"{spec}\" (fb[:DEV], ppm:DIR or matrix)"))
    }

    /// One frame: RGBA, `w` x `h`, bottom row first (as read from OpenGL); `level` is the brightness 0..1 (the night dimming).
    pub fn present(&mut self, w: usize, h: usize, rgba: &[u8], level: f64) -> Result<(), String> {
        let at = |x: usize, y: usize, c: usize| rgba[(((h - 1 - y) * w + x) * 4) + c];       // top-down
        let n = self.n; self.n += 1;
        match &mut self.kind {
            Kind::Ppm { dir } => {
                std::fs::create_dir_all(&*dir).map_err(|e| e.to_string())?;
                let mut o = format!("P6\n{w} {h}\n255\n").into_bytes();
                for y in 0..h { for x in 0..w { for c in 0..3 { o.push(at(x, y, c)); } } }
                std::fs::write(format!("{dir}/frame-{n:04}.ppm"), o).map_err(|e| e.to_string())?;
                std::fs::write(format!("{dir}/brightness-{n:04}.txt"), format!("{:.3}\n", level)).map_err(|e| e.to_string())
            }
            Kind::Fb { dev, fmt } => {
                let mut rgb = Vec::with_capacity(w * h * 3);
                for y in 0..h { for x in 0..w { for c in 0..3 { rgb.push((at(x, y, c) as f64 * level).round() as u8); } } }     // dimming: the framebuffer has no other way
                let bytes = to_framebuffer(&rgb, fmt)?;
                let mut f = std::fs::OpenOptions::new().write(true).open(&*dev).map_err(|e| format!("{dev}: {e}"))?;
                f.write_all(&bytes).map_err(|e| e.to_string())
            }
            Kind::Matrix { layout, panel, dir, table, cell } => {
                let (dw, dh) = (layout.display_width, layout.display_height);
                let mut rgb = Vec::with_capacity(dw * dh * 3);
                for ly in 0..dh { for lx in 0..dw { for c in 0..3 { rgb.push(at(lx * *cell + *cell / 2, ly * *cell + *cell / 2, c)); } } }   // the middle of each LED cell
                apply_gamma(&mut rgb, table);
                let canvas = layout.map_frame(&rgb); let (cw, ch) = layout.canvas_size();
                if let Some(d) = dir {
                    std::fs::create_dir_all(&*d).map_err(|e| e.to_string())?;
                    let mut o = format!("P6\n{cw} {ch}\n255\n").into_bytes(); o.extend_from_slice(&canvas);
                    std::fs::write(format!("{d}/canvas-{n:04}.ppm"), o).map_err(|e| e.to_string())?;
                    std::fs::write(format!("{d}/brightness-{n:04}.txt"), format!("{}\n", hardware_brightness(level))).map_err(|e| e.to_string())
                } else if let Some(p) = panel.as_mut() { p.send(&canvas, cw, ch, hardware_brightness(level)) } else { Ok(()) }
            }
        }
    }

    /// Close the panel program (the panel goes dark).
    pub fn finish(self) { if let Kind::Matrix { panel: Some(p), .. } = self.kind { let _ = p.finish(); } }
}
