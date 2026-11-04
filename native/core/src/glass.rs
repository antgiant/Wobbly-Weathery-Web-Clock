//! Liquid glass, in software. Each digit stroke is a round transparent tube: the picture behind it is refracted (a cylinder flips it) and a little
//! frosted, the rim reflects the sky (more at grazing angles), a highlight runs along the upper-left, a thin dark line marks the edge, and "light from
//! inside" fills it with a glow. The web page does this with a shader; this does it on the CPU, once a second, for the digits only.

use crate::raster::Field;
use crate::sky::SkyColors;

pub type Rgb = [f64; 3];

/// How the glass looks. `tint`: stained glass colours each digit (`None` for clear glass).
#[derive(Clone, Debug)]
pub struct GlassStyle {
    pub frost: f64,
    pub glow: f64,
    pub glow_color: Rgb,
    pub tint: Option<Vec<Rgb>>,
    /// for stained glass: the x position of each glyph's middle (pixels), so each glyph is tinted whole
    pub centers: Vec<f64>,
    /// the colour of the light on the glass (the sun, or the moon)
    pub light: Rgb,
    /// how much the glass lifts what is seen through it (see `lift_for`)
    pub lift: Rgb,
}

/// How much the page's glass lifts the colours seen through it, per channel, by the sun's height. Measured on the real page (mean colour inside the digits,
/// clear glass, frost 0.35, glow 0, minus the mean of what is behind them): +(30, 6, -5) at midday, +(48, 35, 16) at dusk, +(54, 62, 71) at night.
/// Interpolated by the sun's height between 61, -3 and -40 degrees.
pub fn lift_for(alt: f64) -> Rgb {
    const ANCHORS: [(f64, Rgb); 3] = [(-40.0, [54.0, 62.0, 71.0]), (-3.0, [48.0, 35.0, 16.0]), (61.0, [30.0, 6.0, -5.0])];
    let a = alt.clamp(-40.0, 61.0);
    let (lo, hi) = if a < -3.0 { (&ANCHORS[0], &ANCHORS[1]) } else { (&ANCHORS[1], &ANCHORS[2]) };
    let t = (a - lo.0) / (hi.0 - lo.0);
    [0, 1, 2].map(|c| lo.1[c] + (hi.1[c] - lo.1[c]) * t)
}

/// A box blur of a float RGB buffer, `r` pixels each way (two passes, so it is cheap and smooth enough for frosting).
pub fn blur(src: &[f32], w: usize, h: usize, r: usize) -> Vec<f32> {
    if r == 0 { return src.to_vec(); }
    let pass = |inp: &[f32], horizontal: bool| -> Vec<f32> {
        let mut out = vec![0.0f32; inp.len()];
        let (len, lines) = if horizontal { (w, h) } else { (h, w) };
        for line in 0..lines {
            let at = |i: usize| -> usize { if horizontal { (line * w + i) * 3 } else { (i * w + line) * 3 } };
            for c in 0..3 {
                let mut sum = 0.0f32; let mut count = 0.0f32;
                for i in 0..r.min(len) { sum += inp[at(i) + c]; count += 1.0; }
                for i in 0..len {
                    if i + r < len { sum += inp[at(i + r) + c]; count += 1.0; }
                    if i > r { sum -= inp[at(i - r - 1) + c]; count -= 1.0; }
                    out[at(i) + c] = sum / count;
                }
            }
        }
        out
    };
    pass(&pass(src, true), false)
}

fn sample(img: &[f32], w: usize, h: usize, x: f64, y: f64) -> Rgb {
    let (x, y) = (x.clamp(0.0, w as f64 - 1.001), y.clamp(0.0, h as f64 - 1.001));
    let (x0, y0) = (x.floor() as usize, y.floor() as usize);
    let (fx, fy) = (x - x0 as f64, y - y0 as f64);
    let px = |xx: usize, yy: usize, c: usize| img[(yy * w + xx) * 3 + c] as f64;
    [0, 1, 2].map(|c| (px(x0, y0, c) * (1.0 - fx) + px(x0 + 1, y0, c) * fx) * (1.0 - fy) + (px(x0, y0 + 1, c) * (1.0 - fx) + px(x0 + 1, y0 + 1, c) * fx) * fy)
}

fn smooth(a: f64, b: f64, x: f64) -> f64 { let t = ((x - a) / (b - a)).clamp(0.0, 1.0); t * t * (3.0 - 2.0 * t) }
fn mix(a: Rgb, b: Rgb, t: f64) -> Rgb { [0, 1, 2].map(|i| a[i] + (b[i] - a[i]) * t) }

/// What a tube's surface reflects, by the way it faces: up reflects the sky overhead, level the horizon, down the ground. `ny` is the surface normal's
/// vertical part in screen terms (negative = facing up).
fn environment(c: &SkyColors, ny: f64) -> Rgb {
    if ny < 0.0 { mix(c.horizon, c.top, (-ny).min(1.0)) } else { mix(c.horizon, c.ground, ny.min(1.0)) }
}

/// Shade the digits onto `bg` (float RGB, `w` x `h`): returns nothing, the glass is drawn into `out` (a copy of `bg`, changed only inside the field's
/// rectangle, whose top-left corner is `origin` in the picture). `half` is half the stroke width in pixels, `colors` the sky for the reflections.
pub fn apply(bg: &[f32], out: &mut [f32], w: usize, h: usize, field: &Field, origin: (usize, usize), half: f64, colors: &SkyColors, style: &GlassStyle) {
    let (ox, oy) = origin;
    // the frosted picture: the field's rectangle only (it reaches a stroke's width beyond every digit, which is as far as the refraction looks)
    let (rw, rh) = (field.w, field.h);
    let mut region = Vec::with_capacity(rw * rh * 3);
    for y in 0..rh { let row = ((oy + y) * w + ox) * 3; region.extend_from_slice(&bg[row..row + rw * 3]); }
    let frost_px = ((style.frost * half * 0.55).round() as usize).min(half as usize);
    let soft = blur(&region, rw, rh, frost_px.max(1));
    let l = { let v = (-0.45f64, -0.6f64, 0.66f64); let n = (v.0 * v.0 + v.1 * v.1 + v.2 * v.2).sqrt(); (v.0 / n, v.1 / n, v.2 / n) };
    for fy in 0..rh {
        for fx in 0..rw {
            if !field.any(fx, fy) { continue; }
            let cov = field.coverage(fx, fy, half);
            if cov <= 0.0 { continue; }
            let (x, y) = (fx + ox, fy + oy);
            let i = fy * rw + fx;
            let r = (field.dist[i] as f64 / half).min(1.0);
            let nz = (1.0 - r * r).max(0.0).sqrt();
            let (ux, uy) = (field.ux[i] as f64, field.uy[i] as f64);
            let n = (ux * r, uy * r, nz);
            // the picture behind, refracted: a cylinder lens flips it, so the sample comes from across the tube
            let k = 1.25 * half * r;
            let (sx, sy) = (x as f64 + 0.5 - ux * k, y as f64 + 0.5 - uy * k);
            let sharp = sample(bg, w, h, sx, sy);
            let blurry = sample(&soft, rw, rh, sx - ox as f64, sy - oy as f64);
            let seen = mix(sharp, blurry, (style.frost * 1.6).min(1.0));
            let absorb = 0.92 + 0.08 * nz;
            let mut col = [0, 1, 2].map(|c| seen[c] * absorb + style.lift[c] * 1.45 * (0.7 + 0.3 * (1.0 - nz)));
            if let Some(tints) = &style.tint {
                let gi = style.centers.iter().enumerate().min_by(|a, b| (a.1 - x as f64).abs().partial_cmp(&(b.1 - x as f64).abs()).unwrap()).map(|(i, _)| i).unwrap_or(0);
                let t = tints[gi % tints.len()];
                col = [0, 1, 2].map(|c| col[c] * (0.35 + 0.65 * t[c] / 255.0) + t[c] * 0.30);
            }
            let fresnel = 0.03 + 0.97 * (1.0 - nz).powi(4);
            col = mix(col, environment(colors, n.1), fresnel);
            let spec = (n.0 * l.0 + n.1 * l.1 + n.2 * l.2).max(0.0);
            let hi = spec.powi(28) * 1.1 + spec.powi(6) * 0.15;
            col = [0, 1, 2].map(|c| col[c] + style.light[c] * hi);
            if style.glow > 0.0 { let g = style.glow * (0.35 + 0.65 * nz); col = mix(col, style.glow_color, g * 0.85); }
            let edge = smooth(0.88, 1.0, r);
            col = col.map(|v| v * (1.0 - 0.55 * edge));
            let o = (y * w + x) * 3;
            for c in 0..3 { out[o + c] = (bg[o + c] as f64 * (1.0 - cov) + col[c].clamp(0.0, 255.0) * cov) as f32; }
        }
    }
}
