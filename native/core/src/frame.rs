//! A frame of the clock: the time laid out and drawn over a background, as RGB bytes. The sky behind will come from the sky model; for now
//! the background is a vertical gradient, which is all the digits need to be checked at any size (a 64 x 32 panel up to 4K).

use crate::digits::STROKE;
use crate::morph::digit;
use crate::raster::{draw_digit_stroked, Coverage};

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
pub fn draw_text_stroked(text: &str, w: usize, h: usize, fill: f64, stroke: f64) -> Coverage {
    let mut cov = Coverage::new(w, h);
    let (scale, left, top) = fit(text, w, h, fill);
    let mut x = left;
    for p in pieces(text) {
        match p {
            Some(d) => { draw_digit_stroked(&mut cov, digit(d), x - 20.0 * scale + 10.0 * scale, top, scale, stroke); x += DIGIT_W * scale; }
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
