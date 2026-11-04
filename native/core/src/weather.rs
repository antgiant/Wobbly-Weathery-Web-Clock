//! The manual weather settings on the sky: each one's measured look at midday (`weathertable.rs`, baked from the web page by tools/native-weather.mjs)
//! applied in proportion to the daylight, so dusk and night keep their own colours. There is no live weather in the native renderer yet: "live" is clear.

use crate::sky::{Rgb, SkyColors};
use crate::weathertable::WEATHER;

fn smooth(a: f64, b: f64, x: f64) -> f64 { let t = ((x - a) / (b - a)).clamp(0.0, 1.0); t * t * (3.0 - 2.0 * t) }

/// The names this knows. Anything else (including "live") is clear.
pub fn known(mode: &str) -> bool { WEATHER.iter().any(|(m, _, _)| *m == mode) }

fn entry(mode: &str) -> &'static (&'static str, [f64; 9], f64) { WEATHER.iter().find(|(m, _, _)| *m == mode).unwrap_or(&WEATHER[0]) }

/// How much daylight there is for a sun height: 0 at night and in deep twilight, 1 in full day.
pub fn daylight(alt: f64) -> f64 { smooth(-4.0, 12.0, alt) }

/// The sky and ground colours for a weather setting.
pub fn apply(c: &SkyColors, mode: &str, alt: f64) -> SkyColors {
    let (_, m, _) = entry(mode);
    let d = daylight(alt);
    let go = |col: Rgb, k: usize| -> Rgb { [0, 1, 2].map(|i| (col[i] * (1.0 + (m[k + i] - 1.0) * d)).clamp(0.0, 255.0)) };
    SkyColors { top: go(c.top, 0), horizon: go(c.horizon, 3), ground: go(c.ground, 6) }
}

/// How much of the stars show through this weather (1 clear, 0 overcast).
pub fn star_visibility(mode: &str) -> f64 { entry(mode).2 }
