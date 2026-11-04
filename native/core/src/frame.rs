//! A frame of the clock: the time laid out and drawn over a background, as RGB bytes. The sky behind will come from the sky model; for now
//! the background is a vertical gradient, which is all the digits need to be checked at any size (a 64 x 32 panel up to 4K).

use crate::digits::STROKE;
use crate::morph::digit;
use crate::wind::bend;
use crate::raster::{draw_digit_stroked, field_digit, field_dot, Coverage, Field};

pub type Rgb = [u8; 3];

/// Width of a digit slot and of a colon slot, in digit space (the page's digit box is 500 wide; a colon is narrower).
const DIGIT_W: f64 = 440.0;
const COLON_W: f64 = 220.0;
/// Height of the digit area in digit space: the digits run about y 20 to 520 and the stroke adds half its width.
const TOP: f64 = -40.0;
const HEIGHT: f64 = 620.0;

/// The pieces of "HH:MM:SS" (or "H:MM") as drawn: Some(digit) or None for a colon.
pub fn pieces(text: &str) -> Vec<Option<usize>> {
    text.chars().filter_map(|c| if c == ':' { Some(None) } else { c.to_digit(10).map(|d| Some(d as usize)) }).collect()
}

/// Where the text goes: the scale, and the left and top in pixels so it is centred in `w` x `h` and fits within `fill` of each (0..1).
pub fn fit(text: &str, w: usize, h: usize, fill: f64) -> (f64, f64, f64) {
    let total: f64 = pieces(text).iter().map(|p| if p.is_some() { DIGIT_W } else { COLON_W }).sum();
    let scale = (w as f64 * fill / total).min(h as f64 * fill / HEIGHT);
    ((scale), (w as f64 - total * scale) / 2.0, (h as f64 - HEIGHT * scale) / 2.0 - TOP * scale)
}

/// Draw the time into a coverage buffer.
pub fn draw_text(text: &str, w: usize, h: usize, fill: f64) -> Coverage { draw_text_stroked(text, w, h, fill, STROKE) }

/// The same with a wider (or narrower) stroke, in digit space: a halo behind the time is the time drawn wider.
pub fn draw_text_stroked(text: &str, w: usize, h: usize, fill: f64, stroke: f64) -> Coverage { draw_text_bent(text, w, h, fill, stroke, &[]) }

/// The same with each digit bent at the top by `bends[i]` path units (the wind), in the order the digits appear; fewer entries than digits means no bend.
pub fn draw_text_bent(text: &str, w: usize, h: usize, fill: f64, stroke: f64, bends: &[f64]) -> Coverage {
    let mut cov = Coverage::new(w, h);
    let (scale, left, top) = fit(text, w, h, fill);
    let mut x = left;
    let mut di = 0;
    for p in pieces(text) {
        match p {
            Some(d) => { let pts = bend(digit(d), bends.get(di).copied().unwrap_or(0.0)); di += 1; draw_digit_stroked(&mut cov, &pts, x - 20.0 * scale + 10.0 * scale, top, scale, stroke); x += DIGIT_W * scale; }
            None => {
                // two round dots, STROKE wide, level with the upper and lower thirds of the digits
                for cy in [190.0, 350.0] {
                    let (cx, r) = (x + COLON_W * scale / 2.0, stroke * scale / 2.0);
                    let (px, py) = (cx, top + cy * scale);
                    for yy in (py - r - 1.0).floor().max(0.0) as usize..((py + r + 1.0).ceil() as usize).min(h) {
                        for xx in (px - r - 1.0).floor().max(0.0) as usize..((px + r + 1.0).ceil() as usize).min(w) {
                            let d = (((xx as f64 + 0.5 - px).powi(2) + (yy as f64 + 0.5 - py).powi(2))).sqrt();
                            let c = (r + 0.5 - d).clamp(0.0, 1.0) as f32;
                            let i = yy * w + xx;
                            if c > cov.data[i] { cov.data[i] = c; }
                        }
                    }
                }
                x += COLON_W * scale;
            }
        }
    }
    cov
}

fn lerp(a: Rgb, b: Rgb, t: f64) -> Rgb { [0, 1, 2].map(|i| (a[i] as f64 + (b[i] as f64 - a[i] as f64) * t).round() as u8) }

/// The frame: background gradient from `top` to `bottom`, the time in `ink`. `brightness` (0..1) dims everything, as the panel's brightness does.
pub fn render(text: &str, w: usize, h: usize, top: Rgb, bottom: Rgb, ink: Rgb, brightness: f64) -> Vec<u8> {
    let cov = draw_text(text, w, h, 0.9);
    let mut out = Vec::with_capacity(w * h * 3);
    for y in 0..h {
        let bg = lerp(top, bottom, y as f64 / (h.max(2) - 1) as f64);
        for x in 0..w {
            let px = lerp(bg, ink, cov.at(x, y) as f64);
            out.extend(px.iter().map(|v| (*v as f64 * brightness).round() as u8));
        }
    }
    out
}

/// A binary PPM (P6) of RGB bytes, to look at a frame in any image viewer.
pub fn ppm(rgb: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut out = format!("P6\n{w} {h}\n255\n").into_bytes();
    out.extend_from_slice(rgb);
    out
}

/// The same layout as `draw_text`, as a distance field (see `raster::Field`) for the glass shading. `half_px` is returned too: half the stroke, in pixels.
pub fn field_text(text: &str, w: usize, h: usize, fill: f64) -> (Field, f64) {
    let mut f = Field::new(w, h);
    let (scale, left, top) = fit(text, w, h, fill);
    let half = STROKE * scale / 2.0;
    let reach = half + 1.0;
    let mut x = left;
    for p in pieces(text) {
        match p {
            Some(d) => { field_digit(&mut f, digit(d), x - 20.0 * scale + 10.0 * scale, top, scale, reach); x += DIGIT_W * scale; }
            None => { for cy in [190.0, 350.0] { field_dot(&mut f, x + COLON_W * scale / 2.0, top + cy * scale, reach); } x += COLON_W * scale; }
        }
    }
    (f, half)
}

/// The x position (pixels) of the middle of each glyph (digit or colon), left to right: stained glass tints a glyph as a whole.
pub fn glyph_centers(text: &str, w: usize, h: usize, fill: f64) -> Vec<f64> {
    let (scale, left, _) = fit(text, w, h, fill);
    let mut x = left; let mut out = vec![];
    for p in pieces(text) { let wd = if p.is_some() { DIGIT_W } else { COLON_W } * scale; out.push(x + wd / 2.0); x += wd; }
    out
}

/// The rectangle (x0, y0, x1, y1, in pixels, clipped to the picture) the time can touch with a stroke of `stroke` in digit space: everything outside it is
/// untouched, so shading only needs to look here.
pub fn text_bbox(text: &str, w: usize, h: usize, fill: f64, stroke: f64) -> (usize, usize, usize, usize) { text_bbox_bent(text, w, h, fill, stroke, 0.0) }

/// The same, wider by the largest bend (path units) the digits may take.
pub fn text_bbox_bent(text: &str, w: usize, h: usize, fill: f64, stroke: f64, max_bend: f64) -> (usize, usize, usize, usize) {
    let (scale, left, top) = fit(text, w, h, fill);
    let total: f64 = pieces(text).iter().map(|p| if p.is_some() { DIGIT_W } else { COLON_W }).sum();
    let pad = stroke * scale / 2.0 + 3.0 + max_bend.abs() * scale;
    let (x0, y0) = ((left - 30.0 * scale - pad).floor().max(0.0), (top - pad).floor().max(0.0));
    let (x1, y1) = ((left + total * scale + 30.0 * scale + pad).ceil().min(w as f64), (top + 560.0 * scale + pad).ceil().min(h as f64));
    (x0 as usize, y0 as usize, x1.max(x0) as usize, y1.max(y0) as usize)
}

/// Like `field_text`, but the field covers only the time's own rectangle: returns it with the rectangle's top-left corner in the picture.
pub fn field_text_region(text: &str, w: usize, h: usize, fill: f64) -> (Field, (usize, usize), f64) { field_text_bent(text, w, h, fill, &[]) }

/// The same with each digit bent by `bends[i]` (path units) at the top.
pub fn field_text_bent(text: &str, w: usize, h: usize, fill: f64, bends: &[f64]) -> (Field, (usize, usize), f64) {
    let (scale, left, top) = fit(text, w, h, fill);
    let half = STROKE * scale / 2.0;
    let max_bend = bends.iter().fold(0.0f64, |m, b| m.max(b.abs()));
    let (x0, y0, x1, y1) = text_bbox_bent(text, w, h, fill, STROKE, max_bend);
    let mut f = Field::new((x1 - x0).max(1), (y1 - y0).max(1));
    let (ox, oy) = (x0 as f64, y0 as f64);
    let reach = half + 1.0;
    let mut x = left;
    let mut di = 0;
    for p in pieces(text) {
        match p {
            Some(d) => { let pts = bend(digit(d), bends.get(di).copied().unwrap_or(0.0)); di += 1; field_digit(&mut f, &pts, x - 20.0 * scale + 10.0 * scale - ox, top - oy, scale, reach); x += DIGIT_W * scale; }
            None => { for cy in [190.0, 350.0] { field_dot(&mut f, x + COLON_W * scale / 2.0 - ox, top + cy * scale - oy, reach); } x += COLON_W * scale; }
        }
    }
    (f, (x0, y0), half)
}
