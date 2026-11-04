//! The whole picture for a moment and a place: the sun decides the sky colours and the brightness, the time is drawn over it.

use crate::dim::{brightness_at, SunEvents};
use crate::frame::{draw_text_bent, field_text_bent};
use crate::glass::{self, GlassStyle};
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
    /// a manual weather setting ("clear", "overcast", ...); anything else is clear
    pub weather: String,
    /// how the digits are drawn: "solid" (flat ink), "glass" (liquid glass) or "stained" (coloured glass, lit from inside)
    pub style: String,
    /// glass: how frosted (0 clear .. 1 heavily frosted), and the light from inside (0 .. 1)
    pub frost: f64,
    pub glow: f64,
    /// glass: "warm", "white", "cool" or "follow" (the sun or moon light)
    pub glow_color: String,
    /// the full weather (for the wind and what lands on the digits); `weather` above is its look in a word
    pub wx: crate::weather::Weather,
    /// rain and snow on the digits (the page's `digitWeather`)
    pub digit_weather: bool,
    /// wind sway: "off", "lean" or "full"
    pub sway: String,
    /// "flat", "hills", "mountains", "desert", "ocean" or "city" ("auto" is flat)
    pub landscape: String,
}

impl Default for Scene {
    fn default() -> Self { Scene { lat: 40.7, lon: -74.0, horizon: 0.63, brightness_day: 1.0, brightness_night: 1.0, transition_minutes: 45.0, weather: "clear".into(), style: "solid".into(), frost: 0.35, glow: 0.0, glow_color: "follow".into(), wx: crate::weather::Weather::CLEAR, digit_weather: true, sway: "off".into(), landscape: "flat".into() } }
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

/// The picture without the time: sky, ground, the sun, stars. Float RGB (`w` x `h` x 3), plus the sky colours and the sun's height.
pub fn background(scene: &Scene, t_ms: f64, w: usize, h: usize) -> (Vec<f32>, SkyColors, f64) {
    let alt = sun::altitude(t_ms, scene.lat, scene.lon);
    let colors = crate::weather::apply(&colors_at(alt), &scene.weather, alt);
    let sky_px = (scene.horizon * h as f64) as usize;
    let seen = crate::stars::visibility(alt) * crate::weather::star_visibility(&scene.weather);
    let mut starlight = vec![0.0f64; if seen > 0.02 { w * h } else { 0 }];
    if seen > 0.02 { for s in crate::stars::field(w, h, sky_px) { starlight[s.y * w + s.x] = s.brightness * seen; } }
    // the sun: a small warm disc with a glow, in the sky only
    let sun_disc = crate::disc::sun_position_in(t_ms, scene.lat, scene.lon, scene.horizon, w as f64 / h as f64).map(|(x, y)| (x * w as f64, y * h as f64, (0.006 * w as f64).max(1.0)));
    // the moon: a disc, lit as much as it is, its bright side towards the sun; faint by day
    let moon = crate::disc::moon_position(t_ms, scene.lat, scene.lon, scene.horizon, w as f64 / h as f64).map(|(x, y, dir, k)| (x * w as f64, y * h as f64, (0.006 * w as f64).max(1.5), dir, k));
    let day = crate::weather::daylight(alt);
    // the landscape: the ground takes the landscape's colour; hills, mountains, a skyline or dunes stand on the horizon
    let land = scene.landscape.as_str();
    let mult = crate::landscape::ground_mult(land, crate::weather::daylight(alt));
    let ground = [0, 1, 2].map(|k| (colors.ground[k] * mult[k]).clamp(0.0, 255.0));
    let haze = |k: usize, tint: f64| colors.horizon[k] + (ground[k] - colors.horizon[k]) * tint;
    let silhouette: Vec<(usize, f64)> = (0..w).map(|x| { let (hh, snow) = crate::landscape::profile(land, (x as f64 + 0.5) / w as f64); ((hh * h as f64).round() as usize, snow) }).collect();
    let mut out = Vec::with_capacity(w * h * 3);
    for y in 0..h {
        let mut bg = at_row(&colors, y as f64 + 0.5, h as f64, scene.horizon);
        if y >= sky_px { bg = ground; }
        for x in 0..w {
            let mut base = bg;
            if y >= sky_px && land == "ocean" { let depth = (y - sky_px) as f64 / (h - sky_px).max(1) as f64; let f = crate::landscape::wave(x as f64 / w as f64, depth, t_ms / 1000.0); let sky_tint = colors.horizon; base = [0, 1, 2].map(|k| (ground[k] * f + sky_tint[k] * 0.15 * (1.0 - depth)).clamp(0.0, 255.0)); }
            let (sh, snow) = silhouette[x];
            if sh > 0 && y < sky_px && y + sh >= sky_px {
                let top = sky_px - sh;
                let tint = if land == "city" { 0.62 } else { 0.5 };
                let mut col = [haze(0, tint), haze(1, tint), haze(2, tint)];
                if snow > 0.0 && (y - top) as f64 <= snow * sh as f64 { col = [0, 1, 2].map(|k| col[k] + ([232.0, 236.0, 248.0][k] - col[k]).max(0.0) * 0.8); }
                base = col;
            }
            if let Some((cx, cy, r)) = sun_disc { if y < sky_px { let a = crate::disc::weight(x as f64 + 0.5 - cx, y as f64 + 0.5 - cy, r); if a > 0.0 { base = [0, 1, 2].map(|k| bg[k] + ([255.0, 248.0, 225.0][k] - bg[k]) * a); } } }
            if let Some((cx, cy, r, dir, k)) = moon { if y < sky_px + 2 { let (edge, lit) = crate::moon::disc(x as f64 + 0.5 - cx, y as f64 + 0.5 - cy, r, dir.0, dir.1, k); if edge > 0.0 { let a = (lit * (1.0 - 0.55 * day)).clamp(0.0, 1.0); let under = base; base = [0, 1, 2].map(|c| under[c] + ([232.0, 234.0, 240.0][c] - under[c]) * a); } } }
            if !starlight.is_empty() { let a = starlight[y * w + x]; if a > 0.0 { let under = base; base = [0, 1, 2].map(|k| under[k] + (235.0 - under[k]).max(0.0) * a); } }
            out.extend(base.iter().map(|v| *v as f32));
        }
    }
    (out, colors, alt)
}

/// Flat ink over the background, with a halo of the other ink when neither reads everywhere.
fn solid(bg: &[f32], text: &str, w: usize, h: usize, colors: &SkyColors, horizon: f64, bends: &[f64]) -> Vec<f32> {
    let (ink, halo) = legibility(colors, horizon);
    let cov = draw_text_bent(text, w, h, 0.9, STROKE, bends);
    let halo_cov = halo.map(|_| draw_text_bent(text, w, h, 0.9, STROKE * 1.45, bends));
    let mut out = bg.to_vec();
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) * 3;
            let mut base = [out[i] as f64, out[i + 1] as f64, out[i + 2] as f64];
            if let (Some(hc), Some(hv)) = (&halo_cov, halo) { let a = hc.at(x, y) as f64 * 0.75; let under = base; base = [0, 1, 2].map(|k| under[k] + (hv[k] - under[k]) * a); }
            let c = cov.at(x, y) as f64;
            for k in 0..3 { out[i + k] = (base[k] + (ink[k] - base[k]) * c) as f32; }
        }
    }
    out
}

/// The tints of stained glass (Christmas lights): red, green, gold, blue, taken in turn along the digits.
pub const STAINED: [Rgb; 4] = [[225.0, 45.0, 45.0], [45.0, 175.0, 80.0], [250.0, 205.0, 70.0], [70.0, 125.0, 235.0]];

fn glass_style(scene: &Scene, alt: f64, centers: Vec<f64>) -> GlassStyle {
    let day = crate::weather::daylight(alt);
    let sunlight = [255.0, 245.0, 215.0];
    let moonlight = [150.0, 165.0, 205.0];
    let light = [0, 1, 2].map(|k| moonlight[k] + (sunlight[k] - moonlight[k]) * day);
    let glow_color = match scene.glow_color.as_str() { "warm" => [255.0, 214.0, 150.0], "white" => [255.0, 255.0, 255.0], "cool" => [190.0, 220.0, 255.0], _ => [0, 1, 2].map(|k| (light[k] + 255.0) / 2.0) };
    let stained = scene.style == "stained";
    GlassStyle { frost: scene.frost.clamp(0.0, 1.0), glow: if stained { scene.glow.max(0.25) } else { scene.glow.clamp(0.0, 1.0) }, glow_color, tint: if stained { Some(STAINED.to_vec()) } else { None }, light, lift: glass::lift_for(alt), centers }
}

/// How far the wind bends each digit at the top, in path units, left to right (empty when the wind does not move them): a steady lean downwind, and in
/// "full" mode a gust that differs per digit (js/wind.js and the digit phases of js/clock.js).
pub fn bends_for(scene: &Scene, t_ms: f64, text: &str) -> Vec<f64> {
    if scene.sway != "lean" && scene.sway != "full" { return vec![]; }
    let (speed, to_az) = scene.wx.ground_wind();
    let heading = crate::disc::heading_for(t_ms, scene.lat, scene.lon, scene.horizon, 16.0 / 9.0);
    let (lean, gust) = crate::wind::sway_for(speed, to_az, heading);
    const PHASE: [f64; 6] = [0.4, 2.1, 3.7, 5.2, 1.3, 4.4];                 // h0 h1 m0 m1 s0 s1
    let n = crate::frame::pieces(text).iter().filter(|p| p.is_some()).count();
    (0..n).map(|i| lean + if scene.sway == "full" && speed > 1.5 { gust * crate::wind::flutter(t_ms, PHASE[(6usize.saturating_sub(n) + i).min(5)]) } else { 0.0 }).collect()
}

/// The sky changes slowly, so it is drawn once a minute and reused for the seconds in between (the digits are drawn every time).
#[derive(Default)]
pub struct BackgroundCache { key: Option<(usize, usize, i64, String, String)>, bg: Vec<f32>, colors: Option<SkyColors>, alt: f64 }

/// Like `render`, but reuses the sky from the cache when it is less than a minute old (and the size and settings are the same).
pub fn render_cached(cache: &mut BackgroundCache, scene: &Scene, t_ms: f64, text: &str, w: usize, h: usize) -> Vec<u8> {
    let key = (w, h, (t_ms / 60_000.0).floor() as i64, scene.weather.clone(), format!("{:.4},{:.4},{:.3}", scene.lat, scene.lon, scene.horizon));
    if cache.key.as_ref() != Some(&key) {
        let (bg, colors, alt) = background(scene, t_ms, w, h);
        *cache = BackgroundCache { key: Some(key), bg, colors: Some(colors), alt };
    }
    let (bg, colors, alt) = (cache.bg.clone(), cache.colors.unwrap(), cache.alt);
    finish(scene, t_ms, text, w, h, bg, colors, alt)
}

/// RGB bytes, `w` x `h`: the sky for the sun's height, the time over it in the chosen style, dimmed by the day/night brightness.
pub fn render(scene: &Scene, t_ms: f64, text: &str, w: usize, h: usize) -> Vec<u8> {
    let (bg, colors, alt) = background(scene, t_ms, w, h);
    finish(scene, t_ms, text, w, h, bg, colors, alt)
}

fn finish(scene: &Scene, t_ms: f64, text: &str, w: usize, h: usize, bg: Vec<f32>, colors: SkyColors, alt: f64) -> Vec<u8> {
    let level = brightness(scene, t_ms);
    let bends = bends_for(scene, t_ms, text);
    let fx = if scene.digit_weather && !text.is_empty() { crate::effects::for_weather(&scene.wx) } else { crate::effects::NONE };
    let styled = (scene.style == "glass" || scene.style == "stained") && !text.is_empty();
    let mut frame = if styled {
        let (field, origin, half) = field_text_bent(text, w, h, 0.9, &bends);
        let mut out = bg.clone();
        glass::apply(&bg, &mut out, w, h, &field, origin, half, &colors, &glass_style(scene, alt, crate::frame::glyph_centers(text, w, h, 0.9)));
        if fx != crate::effects::NONE { crate::effects::apply(&mut out, w, &field, origin, half, fx, (t_ms / 7000.0) as u64); }
        out
    } else if text.is_empty() { bg } else {
        let mut out = solid(&bg, text, w, h, &colors, scene.horizon, &bends);
        if fx != crate::effects::NONE { let (field, origin, half) = field_text_bent(text, w, h, 0.9, &bends); crate::effects::apply(&mut out, w, &field, origin, half, fx, (t_ms / 7000.0) as u64); }
        out
    };
    let _ = &mut frame;
    frame.iter().map(|v| (*v as f64 * level).round().clamp(0.0, 255.0) as u8).collect()
}
