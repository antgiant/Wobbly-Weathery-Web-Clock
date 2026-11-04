//! Getting a frame onto a screen: gamma for LED panels, and the framebuffer bytes for HDMI. Pure conversions; the devices themselves are opened by the program.

/// A gamma lookup table: LED panels are linear in light and the eye is not, so a picture made for a screen looks too bright and washed out on a
/// panel unless it is bent by about 2.2.
pub fn gamma_table(gamma: f64) -> [u8; 256] {
    let mut t = [0u8; 256];
    for (i, v) in t.iter_mut().enumerate() { *v = (255.0 * (i as f64 / 255.0).powf(gamma)).round() as u8; }
    t
}

/// Apply a gamma table to RGB bytes in place.
pub fn apply_gamma(rgb: &mut [u8], table: &[u8; 256]) { for v in rgb.iter_mut() { *v = table[*v as usize]; } }

/// The panel's hardware brightness (the library's `led-brightness`, 1 to 100) for a brightness level 0..1. Dimming by the panel's own PWM keeps all
/// the colour steps; dimming the pixels would throw most of them away at 10%.
pub fn hardware_brightness(level: f64) -> u8 { (level.clamp(0.01, 1.0) * 100.0).round().max(1.0) as u8 }

/// What the kernel framebuffer looks like (read from /sys/class/graphics/fb0: `bits_per_pixel`, `stride`, `virtual_size`).
#[derive(Clone, Copy, Debug)]
pub struct FbFormat { pub width: usize, pub height: usize, pub bits_per_pixel: usize, pub stride: usize }

/// RGB bytes (`width` x `height`) -> framebuffer bytes: 32 bits as B, G, R, X (the usual XRGB8888), 24 as B, G, R, 16 as RGB565 (little endian).
pub fn to_framebuffer(rgb: &[u8], fb: &FbFormat) -> Result<Vec<u8>, String> {
    if rgb.len() != fb.width * fb.height * 3 { return Err(format!("frame is {} bytes, the screen needs {}", rgb.len(), fb.width * fb.height * 3)); }
    let bytes = match fb.bits_per_pixel { 32 => 4, 24 => 3, 16 => 2, n => return Err(format!("{n} bits per pixel is not supported (32, 24 and 16 are)")) };
    if fb.stride < fb.width * bytes { return Err("the stride is smaller than a row".into()); }
    let mut out = vec![0u8; fb.stride * fb.height];
    for y in 0..fb.height {
        for x in 0..fb.width {
            let (r, g, b) = { let s = (y * fb.width + x) * 3; (rgb[s], rgb[s + 1], rgb[s + 2]) };
            let o = y * fb.stride + x * bytes;
            match fb.bits_per_pixel {
                32 => { out[o] = b; out[o + 1] = g; out[o + 2] = r; out[o + 3] = 0; }
                24 => { out[o] = b; out[o + 1] = g; out[o + 2] = r; }
                _ => { let v = ((r as u16 >> 3) << 11) | ((g as u16 >> 2) << 5) | (b as u16 >> 3); out[o] = (v & 0xff) as u8; out[o + 1] = (v >> 8) as u8; }
            }
        }
    }
    Ok(out)
}

/// Parse /sys/class/graphics/fb0/virtual_size ("1920,1080").
pub fn parse_virtual_size(s: &str) -> Option<(usize, usize)> {
    let (w, h) = s.trim().split_once(',')?;
    Some((w.trim().parse().ok()?, h.trim().parse().ok()?))
}

/// Enlarge an RGB picture (`w` x `h`) to `fw` x `fh` with bilinear filtering: the renderer draws smaller on a slow machine and the screen gets this.
pub fn upscale(rgb: &[u8], w: usize, h: usize, fw: usize, fh: usize) -> Vec<u8> {
    if (w, h) == (fw, fh) { return rgb.to_vec(); }
    let mut out = Vec::with_capacity(fw * fh * 3);
    let (sx, sy) = (w as f64 / fw as f64, h as f64 / fh as f64);
    for y in 0..fh {
        let fy = ((y as f64 + 0.5) * sy - 0.5).clamp(0.0, (h - 1) as f64);
        let (y0, ty) = (fy.floor() as usize, fy - fy.floor());
        let y1 = (y0 + 1).min(h - 1);
        for x in 0..fw {
            let fx = ((x as f64 + 0.5) * sx - 0.5).clamp(0.0, (w - 1) as f64);
            let (x0, tx) = (fx.floor() as usize, fx - fx.floor());
            let x1 = (x0 + 1).min(w - 1);
            for c in 0..3 {
                let p = |xx: usize, yy: usize| rgb[(yy * w + xx) * 3 + c] as f64;
                let v = (p(x0, y0) * (1.0 - tx) + p(x1, y0) * tx) * (1.0 - ty) + (p(x0, y1) * (1.0 - tx) + p(x1, y1) * tx) * ty;
                out.push(v.round() as u8);
            }
        }
    }
    out
}

/// The render size for a screen of `fw` x `fh` when each frame took `last_secs` at the scale used (1 = full size, 2 = half each way ...): the next scale up
/// when a frame takes more than `budget_secs`, never below `min_scale` (the user's setting). Frame time falls with the square of the scale.
pub fn next_scale(scale: usize, last_secs: f64, budget_secs: f64, min_scale: usize) -> usize {
    let mut s = scale.max(min_scale).max(1);
    while s < 8 && last_secs * ((scale as f64) / (s as f64)).powi(2) > budget_secs { s += 1; }
    s
}

/// A render size from a screen size and a scale (never under 32 x 18).
pub fn scaled_size(fw: usize, fh: usize, scale: usize) -> (usize, usize) { ((fw / scale.max(1)).max(32), (fh / scale.max(1)).max(18)) }
