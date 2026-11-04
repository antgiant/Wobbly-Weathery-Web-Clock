//! The whole picture for a moment and a place: the sun decides the sky colours and the brightness, the time is drawn over it.

use crate::dim::{brightness_at, SunEvents};
use crate::frame::{draw_text, draw_text_stroked};
use crate::digits::STROKE;
use crate::sky::{at_row, colors_at, Rgb, SkyColors};
use crate::sun;

/// Everything that decides how the picture looks.
#[derive(Clone, Debug)]
pub struct Scene {
    pub lat: f64,
    pub lon: f64,
    /// where the horizon is, as a fraction of the height (the page puts it near 0.63)
    pub horizon: f64,
    pub brightness_day: f64,
    pub brightness_night: f64,
    pub transition_minutes: f64,
}

impl Default for Scene {
    fn default() -> Self { Scene { lat: 40.7, lon: -74.0, horizon: 0.63, brightness_day: 1.0, brightness_night: 1.0, transition_minutes: 45.0 } }
}

const WHITE: Rgb = [255.0, 255.0, 255.0];
const NAVY: Rgb = [20.0, 30.0, 70.0];

/// WCAG-style contrast ratio between two colours (1 to 21), from their relative luminance.
pub fn contrast(a: Rgb, b: Rgb) -> f64 {
    let rel = |c: Rgb| { let l = |v: f64| { let v = v / 255.0; if v <= 0.03928 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) } }; 0.2126 * l(c[0]) + 0.7152 * l(c[1]) + 0.0722 * l(c[2]) };
    let (x, y) = (rel(a), rel(b));
    (x.max(y) + 0.05) / (x.min(y) + 0.05)
}

/// The ink: white or dark navy, whichever reads better over the worst part of the sky the digits cover (the page keeps the time readable
/// the same way). The digits fill about the 15% to 75% band of the height.
pub fn ink_for(colors: &SkyColors, horizon: f64) -> Rgb { legibility(colors, horizon).0 }

/// The ink, and a halo colour to draw behind it when neither ink reaches a contrast of 3 to 1 everywhere the digits are (a sky that runs from
/// dark to bright across the digits, as at twilight): the halo is the other ink, so the edge of every digit has contrast whatever is behind it.
pub fn legibility(colors: &SkyColors, horizon: f64) -> (Rgb, Option<Rgb>) {
    let rows: Vec<Rgb> = (0..=12).map(|i| at_row(colors, (0.15 + 0.6 * i as f64 / 12.0) * 100.0, 100.0, horizon)).collect();
    let worst = |ink: Rgb| rows.iter().map(|r| contrast(ink, *r)).fold(f64::MAX, f64::min);
    let (w, n) = (worst(WHITE), worst(NAVY));
    let (ink, other, best) = if w >= n { (WHITE, NAVY, w) } else { (NAVY, WHITE, n) };
    (ink, if best < 3.0 { Some(other) } else { None })
}

/// The brightness (0.1 to 1) at this moment for this place.
pub fn brightness(scene: &Scene, t_ms: f64) -> f64 {
    let ev: SunEvents = sun::events(t_ms, scene.lat, scene.lon);
    brightness_at(t_ms, &ev, sun::altitude(t_ms, scene.lat, scene.lon), scene.brightness_day, scene.brightness_night, scene.transition_minutes)
}

/// RGB bytes, `w` x `h`: the sky for the sun's height, the time over it, dimmed by the day/night brightness.
pub fn render(scene: &Scene, t_ms: f64, text: &str, w: usize, h: usize) -> Vec<u8> {
    let alt = sun::altitude(t_ms, scene.lat, scene.lon);
    let colors = colors_at(alt);
    let (ink, halo) = legibility(&colors, scene.horizon);
    let cov = draw_text(text, w, h, 0.9);
    let halo_cov = halo.map(|_| draw_text_stroked(text, w, h, 0.9, STROKE * 1.45));
    let level = brightness(scene, t_ms);
    let mut out = Vec::with_capacity(w * h * 3);
    for y in 0..h {
        let bg = at_row(&colors, y as f64 + 0.5, h as f64, scene.horizon);
        for x in 0..w {
            let c = cov.at(x, y) as f64;
            let mut base = bg;
            if let (Some(hc), Some(hv)) = (&halo_cov, halo) { let a = hc.at(x, y) as f64 * 0.75; base = [0, 1, 2].map(|k| bg[k] + (hv[k] - bg[k]) * a); }
            for k in 0..3 { out.push(((base[k] + (ink[k] - base[k]) * c) * level).round().clamp(0.0, 255.0) as u8); }
        }
    }
    out
}
