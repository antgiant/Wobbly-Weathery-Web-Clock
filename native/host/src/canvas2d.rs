//! The 2D canvas the engine's helpers draw on (the glass mask, the LED card), drawn by tiny-skia (a Rust port of Skia, the library Chromium draws
//! its canvases with). JavaScript keeps the style state (colours, line width ...) and sends each drawing call with the style resolved, as JSON.

use serde_json::Value;
use std::cell::RefCell;
use tiny_skia::*;

pub struct Canvas { pub pm: Pixmap, stack: Vec<Transform>, ts: Transform }

thread_local! { static CANVASES: RefCell<Vec<Canvas>> = RefCell::new(Vec::new()); }

pub fn create(w: u32, h: u32) -> usize {
    CANVASES.with(|c| { let mut c = c.borrow_mut(); c.push(Canvas { pm: Pixmap::new(w.max(1), h.max(1)).unwrap(), stack: vec![], ts: Transform::identity() }); c.len() - 1 })
}
pub fn resize(id: usize, w: u32, h: u32) { CANVASES.with(|c| { let mut c = c.borrow_mut(); let k = &mut c[id]; k.pm = Pixmap::new(w.max(1), h.max(1)).unwrap(); k.stack.clear(); k.ts = Transform::identity(); }); }

/// Straight (not premultiplied) RGBA of a region, as getImageData and a texture upload want it.
pub fn read(id: usize, x: i32, y: i32, w: u32, h: u32) -> Vec<u8> {
    CANVASES.with(|c| {
        let c = c.borrow(); let pm = &c[id].pm; let mut out = vec![0u8; (w * h * 4) as usize];
        for j in 0..h as i32 { for i in 0..w as i32 {
            let (sx, sy) = (x + i, y + j);
            if sx < 0 || sy < 0 || sx >= pm.width() as i32 || sy >= pm.height() as i32 { continue; }
            let p = pm.pixel(sx as u32, sy as u32).unwrap().demultiply();
            let o = ((j as u32 * w + i as u32) * 4) as usize;
            out[o] = p.red(); out[o + 1] = p.green(); out[o + 2] = p.blue(); out[o + 3] = p.alpha();
        } }
        out
    })
}

fn num(v: &Value, k: &str) -> f32 { v.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0) as f32 }
fn color(a: &Value) -> Color {
    let g = |i: usize| a.get(i).and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
    Color::from_rgba(g(0).clamp(0.0, 1.0), g(1).clamp(0.0, 1.0), g(2).clamp(0.0, 1.0), g(3).clamp(0.0, 1.0)).unwrap()
}
fn blend(name: &str) -> BlendMode {
    match name {
        "source-atop" => BlendMode::SourceAtop, "destination-out" => BlendMode::DestinationOut, "copy" => BlendMode::Source, "lighter" => BlendMode::Plus,
        "multiply" => BlendMode::Multiply, "screen" => BlendMode::Screen, "destination-over" => BlendMode::DestinationOver, "destination-in" => BlendMode::DestinationIn,
        "source-in" => BlendMode::SourceIn, "source-out" => BlendMode::SourceOut, "xor" => BlendMode::Xor, "destination-atop" => BlendMode::DestinationAtop,
        "overlay" => BlendMode::Overlay, "darken" => BlendMode::Darken, "lighten" => BlendMode::Lighten, _ => BlendMode::SourceOver,
    }
}
fn shader(p: &Value, alpha: f32) -> Shader<'static> {
    let stops = |p: &Value| -> Vec<GradientStop> {
        p["stops"].as_array().map(|a| a.iter().map(|s| { let mut c = color(&s[1]); c.apply_opacity(alpha); GradientStop::new(s[0].as_f64().unwrap_or(0.0) as f32, c) }).collect()).unwrap_or_default()
    };
    match p["k"].as_str().unwrap_or("color") {
        "lin" => LinearGradient::new(Point::from_xy(num(p, "x0"), num(p, "y0")), Point::from_xy(num(p, "x1"), num(p, "y1")), stops(p), SpreadMode::Pad, Transform::identity()).unwrap_or(Shader::SolidColor(Color::TRANSPARENT)),
        "rad" => {
            // canvas radial gradients run between two circles; with the inner radius 0 (all the page uses) this is a plain radial gradient
            let (r0, r1) = (num(p, "r0"), num(p, "r1"));
            if r1 <= 0.0 { return Shader::SolidColor(Color::TRANSPARENT); }
            let _ = r0;
            RadialGradient::new(Point::from_xy(num(p, "x1"), num(p, "y1")), Point::from_xy(num(p, "x1"), num(p, "y1")), r1, stops(p), SpreadMode::Pad, Transform::identity()).unwrap_or(Shader::SolidColor(Color::TRANSPARENT))
        }
        _ => { let mut c = color(&p["c"]); c.apply_opacity(alpha); Shader::SolidColor(c) }
    }
}

// ---- paths: a list of commands from JS (and SVG path strings) -------------------------------------------------------
fn svg_path(d: &str) -> Vec<Value> {
    let mut out = vec![]; let mut tok: Vec<String> = vec![]; let mut cur = String::new();
    let flush = |cur: &mut String, tok: &mut Vec<String>| { if !cur.is_empty() { tok.push(std::mem::take(cur)); } };
    let cs: Vec<char> = d.chars().collect(); let mut i = 0;
    while i < cs.len() {
        let c = cs[i];
        if c.is_ascii_alphabetic() && c != 'e' && c != 'E' { flush(&mut cur, &mut tok); tok.push(c.to_string()); }
        else if c == ',' || c.is_whitespace() { flush(&mut cur, &mut tok); }
        else if c == '-' && !cur.is_empty() && !cur.ends_with('e') && !cur.ends_with('E') { flush(&mut cur, &mut tok); cur.push(c); }
        else if c == '.' && cur.contains('.') { flush(&mut cur, &mut tok); cur.push(c); }
        else { cur.push(c); }
        i += 1;
    }
    flush(&mut cur, &mut tok);
    let (mut k, mut cmd, mut cx, mut cy, mut sx, mut sy) = (0usize, 'M', 0f64, 0f64, 0f64, 0f64);
    let n = |k: &mut usize| -> f64 { let v = tok.get(*k).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0); *k += 1; v };
    while k < tok.len() {
        if tok[k].len() == 1 && tok[k].chars().next().unwrap().is_ascii_alphabetic() { cmd = tok[k].chars().next().unwrap(); k += 1; if cmd == 'Z' || cmd == 'z' { out.push(serde_json::json!(["Z"])); cx = sx; cy = sy; continue; } }
        let rel = cmd.is_ascii_lowercase(); let (ox, oy) = if rel { (cx, cy) } else { (0.0, 0.0) };
        match cmd.to_ascii_uppercase() {
            'M' => { let (x, y) = (n(&mut k) + ox, n(&mut k) + oy); out.push(serde_json::json!(["M", x, y])); cx = x; cy = y; sx = x; sy = y; cmd = if rel { 'l' } else { 'L' }; }
            'L' => { let (x, y) = (n(&mut k) + ox, n(&mut k) + oy); out.push(serde_json::json!(["L", x, y])); cx = x; cy = y; }
            'H' => { let x = n(&mut k) + ox; out.push(serde_json::json!(["L", x, cy])); cx = x; }
            'V' => { let y = n(&mut k) + oy; out.push(serde_json::json!(["L", cx, y])); cy = y; }
            'C' => { let v: Vec<f64> = (0..6).map(|j| n(&mut k) + if j % 2 == 0 { ox } else { oy }).collect(); out.push(serde_json::json!(["C", v[0], v[1], v[2], v[3], v[4], v[5]])); cx = v[4]; cy = v[5]; }
            'Q' => { let v: Vec<f64> = (0..4).map(|j| n(&mut k) + if j % 2 == 0 { ox } else { oy }).collect(); out.push(serde_json::json!(["Q", v[0], v[1], v[2], v[3]])); cx = v[2]; cy = v[3]; }
            _ => { k += 1; }
        }
    }
    out
}
fn build(cmds: &[Value]) -> Option<Path> {
    let mut pb = PathBuilder::new();
    let f = |c: &Value, i: usize| c.get(i).and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
    for c in cmds {
        match c[0].as_str().unwrap_or("") {
            "M" => pb.move_to(f(c, 1), f(c, 2)),
            "L" => pb.line_to(f(c, 1), f(c, 2)),
            "C" => pb.cubic_to(f(c, 1), f(c, 2), f(c, 3), f(c, 4), f(c, 5), f(c, 6)),
            "Q" => pb.quad_to(f(c, 1), f(c, 2), f(c, 3), f(c, 4)),
            "Z" => pb.close(),
            "rect" => { if let Some(r) = Rect::from_xywh(f(c, 1), f(c, 2), f(c, 3), f(c, 4)) { pb.push_rect(r); } }
            "arc" => {   // x, y, r, a0, a1, ccw  (a full circle or an arc, as cubic segments)
                let (x, y, r, a0, mut a1) = (f(c, 1), f(c, 2), f(c, 3), f(c, 4), f(c, 5)); let ccw = c.get(6).and_then(|v| v.as_bool()).unwrap_or(false);
                let tau = std::f32::consts::TAU;
                if !ccw && a1 - a0 >= tau { a1 = a0 + tau; } else if ccw && a0 - a1 >= tau { a1 = a0 - tau; }
                let mut sweep = a1 - a0;
                if !ccw && sweep < 0.0 { sweep = sweep.rem_euclid(tau); } else if ccw && sweep > 0.0 { sweep = -((-sweep).rem_euclid(tau)); }
                let segs = (sweep.abs() / (std::f32::consts::FRAC_PI_2)).ceil().max(1.0) as i32; let step = sweep / segs as f32;
                let k = 4.0 / 3.0 * (step / 4.0).tan();
                let (mut a, p0) = (a0, (x + r * a0.cos(), y + r * a0.sin()));
                if pb.is_empty() { pb.move_to(p0.0, p0.1); } else { pb.line_to(p0.0, p0.1); }
                for _ in 0..segs {
                    let (c0, s0, c1, s1) = (a.cos(), a.sin(), (a + step).cos(), (a + step).sin());
                    pb.cubic_to(x + r * (c0 - k * s0), y + r * (s0 + k * c0), x + r * (c1 + k * s1), y + r * (s1 - k * c1), x + r * c1, y + r * s1);
                    a += step;
                }
            }
            "roundRect" => {
                let (x, y, w, h) = (f(c, 1), f(c, 2), f(c, 3), f(c, 4)); let r = f(c, 5).min(w.abs() / 2.0).min(h.abs() / 2.0); let k = r * 0.5522847;
                pb.move_to(x + r, y); pb.line_to(x + w - r, y); pb.cubic_to(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
                pb.line_to(x + w, y + h - r); pb.cubic_to(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
                pb.line_to(x + r, y + h); pb.cubic_to(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
                pb.line_to(x, y + r); pb.cubic_to(x, y + r - k, x + r - k, y, x + r, y); pb.close();
            }
            _ => {}
        }
    }
    pb.finish()
}

/// One call from JS: `op` and a JSON argument (style already resolved), plus an optional pixel buffer (drawImage / putImageData).
pub fn call(id: usize, op: &str, arg: &str, buf: Option<Vec<u8>>) -> Option<Vec<u8>> {
    let a: Value = serde_json::from_str(arg).unwrap_or(Value::Null);
    CANVASES.with(|cs| {
        let mut cs = cs.borrow_mut(); let cv = &mut cs[id];
        match op {
            "save" => cv.stack.push(cv.ts),
            "restore" => { if let Some(t) = cv.stack.pop() { cv.ts = t; } }
            "setTransform" => cv.ts = Transform::from_row(num(&a, "a"), num(&a, "b"), num(&a, "c"), num(&a, "d"), num(&a, "e"), num(&a, "f")),
            "transform" => { let t = Transform::from_row(num(&a, "a"), num(&a, "b"), num(&a, "c"), num(&a, "d"), num(&a, "e"), num(&a, "f")); cv.ts = cv.ts.pre_concat(t); }
            "clearRect" => {
                if let Some(r) = Rect::from_xywh(num(&a, "x"), num(&a, "y"), num(&a, "w"), num(&a, "h")) {
                    let mut p = Paint::default(); p.blend_mode = BlendMode::Clear; p.anti_alias = false;
                    cv.pm.fill_rect(r, &p, cv.ts, None);
                }
            }
            "fill" | "stroke" | "fillRect" => {
                let alpha = a.get("alpha").and_then(|x| x.as_f64()).unwrap_or(1.0) as f32;
                let mut paint = Paint::default(); paint.shader = shader(&a["paint"], alpha); paint.anti_alias = true;
                paint.blend_mode = blend(a["op"].as_str().unwrap_or("source-over"));
                let path = if op == "fillRect" { build(&[serde_json::json!(["rect", num(&a, "x"), num(&a, "y"), num(&a, "w"), num(&a, "h")])]) }
                           else if let Some(d) = a["d"].as_str() { build(&svg_path(d)) } else { build(a["path"].as_array().map(|v| v.as_slice()).unwrap_or(&[])) };
                if let Some(p) = path {
                    if op == "stroke" {
                        let mut st = Stroke::default(); st.width = num(&a, "lineWidth").max(0.0);
                        st.line_cap = match a["cap"].as_str() { Some("round") => LineCap::Round, Some("square") => LineCap::Square, _ => LineCap::Butt };
                        st.line_join = match a["join"].as_str() { Some("round") => LineJoin::Round, Some("bevel") => LineJoin::Bevel, _ => LineJoin::Miter };
                        if let Some(m) = a.get("miter").and_then(|x| x.as_f64()) { st.miter_limit = m as f32; }
                        cv.pm.stroke_path(&p, &paint, &st, cv.ts, None);
                    } else {
                        let rule = if a["rule"].as_str() == Some("evenodd") { FillRule::EvenOdd } else { FillRule::Winding };
                        cv.pm.fill_path(&p, &paint, rule, cv.ts, None);
                    }
                }
            }
            "drawImage" => {
                // buf: straight RGBA of the source (w x h in the JSON); destination rectangle dx, dy, dw, dh in canvas units; optional source crop
                let (sw, sh) = (a["sw"].as_u64().unwrap_or(0) as u32, a["sh"].as_u64().unwrap_or(0) as u32);
                if let (Some(b), true) = (buf, sw > 0 && sh > 0) {
                    let mut src = Pixmap::new(sw, sh).unwrap();
                    for (i, px) in b.chunks_exact(4).enumerate() { if let Some(c) = ColorU8::from_rgba(px[0], px[1], px[2], px[3]).premultiply().into() { src.pixels_mut()[i] = c; } }
                    let (cx, cy, cw, ch) = (num(&a, "cx"), num(&a, "cy"), num(&a, "cw"), num(&a, "ch"));
                    let (dx, dy, dw, dh) = (num(&a, "dx"), num(&a, "dy"), num(&a, "dw"), num(&a, "dh"));
                    if cw > 0.0 && ch > 0.0 && dw != 0.0 && dh != 0.0 {
                        let alpha = a.get("alpha").and_then(|x| x.as_f64()).unwrap_or(1.0) as f32;
                        let m = Transform::from_translate(dx, dy).pre_scale(dw / cw, dh / ch).pre_translate(-cx, -cy);
                        let mut paint = Paint::default(); paint.blend_mode = blend(a["op"].as_str().unwrap_or("source-over"));
                        let q = if dw.abs() < cw || dh.abs() < ch { FilterQuality::Bilinear } else { FilterQuality::Bilinear };
                        paint.shader = Pattern::new(src.as_ref(), SpreadMode::Pad, q, alpha, m);
                        if let Some(r) = Rect::from_xywh(dx.min(dx + dw), dy.min(dy + dh), dw.abs(), dh.abs()) { cv.pm.fill_rect(r, &paint, cv.ts, None); }
                    }
                }
            }
            "putImageData" => {
                if let Some(b) = buf { let (w, h, x, y) = (a["w"].as_i64().unwrap_or(0) as i32, a["h"].as_i64().unwrap_or(0) as i32, a["x"].as_i64().unwrap_or(0) as i32, a["y"].as_i64().unwrap_or(0) as i32);
                    let (cw, ch) = (cv.pm.width() as i32, cv.pm.height() as i32);
                    for j in 0..h { for i in 0..w { let (px, py) = (x + i, y + j); if px < 0 || py < 0 || px >= cw || py >= ch { continue; }
                        let o = ((j * w + i) * 4) as usize; let c = ColorU8::from_rgba(b[o], b[o + 1], b[o + 2], b[o + 3]).premultiply();
                        cv.pm.pixels_mut()[(py * cw + px) as usize] = c; } } }
            }
            _ => {}
        }
        None
    })
}
