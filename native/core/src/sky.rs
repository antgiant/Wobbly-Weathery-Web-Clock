//! The sky's colour from the sun's height: a lookup table baked from the web page (`skytable.rs`, made by tools/native-sky.mjs), interpolated.
//! This stands in for the page's ray-marched atmosphere on machines that cannot run it: a clear sky in a city with its light pollution.
//! Weather, the sun and moon discs, stars and clouds are layered on top by the renderer, not here.

use crate::skytable::{ROWS, SKY};

pub type Rgb = [f64; 3];

/// The three colours the renderer needs for a sun height (degrees): the top of the sky, the sky at the horizon, the ground.
#[derive(Clone, Copy, Debug)]
pub struct SkyColors { pub top: Rgb, pub horizon: Rgb, pub ground: Rgb }

pub fn colors_at(alt: f64) -> SkyColors {
    let a = alt.clamp(SKY[0][0], SKY[ROWS - 1][0]);
    let mut i = 0;
    while i + 2 < ROWS && SKY[i + 1][0] < a { i += 1; }
    let (lo, hi) = (&SKY[i], &SKY[i + 1]);
    let t = if hi[0] > lo[0] { ((a - lo[0]) / (hi[0] - lo[0])).clamp(0.0, 1.0) } else { 0.0 };
    let mix = |k: usize| -> Rgb { [0, 1, 2].map(|c| lo[k + c] + (hi[k + c] - lo[k + c]) * t) };
    SkyColors { top: mix(1), horizon: mix(4), ground: mix(7) }
}

/// The sky colour at screen row `y` of `h`, where the horizon is at `horizon_y` (0..1 of the height): a gradient from the top colour to the
/// horizon colour above it, and the ground colour below it.
pub fn at_row(c: &SkyColors, y: f64, h: f64, horizon_y: f64) -> Rgb {
    let v = y / h;
    if v >= horizon_y { return c.ground; }
    let t = (v / horizon_y).clamp(0.0, 1.0);
    let t = t * t * (3.0 - 2.0 * t);                                     // eases toward the horizon colour
    [0, 1, 2].map(|k| c.top[k] + (c.horizon[k] - c.top[k]) * t)
}
