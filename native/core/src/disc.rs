//! The sun's disc on the picture: where it is on the screen, and how it is drawn. The page's "follow the sun" view keeps the horizon at about 63% of the
//! height and the sun rising on the right and setting on the left; this reproduces what it measured (see the numbers in tests/disc.rs), not a model of
//! the camera.

use crate::dim::SunEvents;
use crate::sun;

/// Screen height covered per degree of sun height, as a fraction of the picture (the page shows about 30 degrees above the horizon).
const PER_DEGREE: f64 = 0.0209;

/// Where the sun is on the picture, as fractions of the width and height (x to the right, y down), or None when it is below the horizon or off the
/// top of the picture.
pub fn sun_position(t_ms: f64, lat: f64, lon: f64, horizon: f64) -> Option<(f64, f64)> {
    let alt = sun::altitude(t_ms, lat, lon);
    if alt < sun::RISE_SET_ALTITUDE { return None; }
    let ev: SunEvents = sun::events(t_ms, lat, lon);
    // how far through the day it is: 0 at sunrise, 1 at sunset (halfway when the sun never rises or sets)
    let frac = if ev.prev_rise.is_finite() && ev.next_set.is_finite() && ev.next_set > ev.prev_rise { ((t_ms - ev.prev_rise) / (ev.next_set - ev.prev_rise)).clamp(0.0, 1.0) } else { 0.5 };
    let x = 0.5 + 0.35 * (std::f64::consts::PI * frac).cos();
    let y = horizon - alt * PER_DEGREE;
    if y < -0.02 { None } else { Some((x, y)) }
}

/// The disc's weight at a pixel `dx`, `dy` (pixels) from its centre, for a disc of radius `r` pixels: 1 inside the disc, a one-pixel soft edge, and a faint
/// glow around it. 0 far away.
pub fn weight(dx: f64, dy: f64, r: f64) -> f64 {
    let d = (dx * dx + dy * dy).sqrt();
    let core = (r + 0.5 - d).clamp(0.0, 1.0);
    let g = d / (7.0 * r);
    let glow = 0.3 * (-g * g).exp();
    core.max(glow)
}

/// The compass bearing the screen looks at in the "follow the sun" view: the sun is kept where `sun_position` puts it, so the heading is the sun's own
/// bearing less its screen offset (the page's horizontal field of view is about 80 degrees). By night the screen goes on turning at the pace the sun
/// would, so the heading stays continuous. 180 (south) where there is no sunrise or sunset to measure from.
pub fn follow_heading(t_ms: f64, lat: f64, lon: f64) -> f64 {
    let ev: SunEvents = sun::events(t_ms, lat, lon);
    let (alt, az) = sun::position(t_ms, lat, lon);
    let frac = if alt >= sun::RISE_SET_ALTITUDE && ev.prev_rise.is_finite() && ev.next_set.is_finite() && ev.next_set > ev.prev_rise { Some(((t_ms - ev.prev_rise) / (ev.next_set - ev.prev_rise)).clamp(0.0, 1.0)) }
        else if alt < sun::RISE_SET_ALTITUDE && ev.prev_set.is_finite() && ev.next_rise.is_finite() && ev.next_rise > ev.prev_set { Some(1.0 + ((t_ms - ev.prev_set) / (ev.next_rise - ev.prev_set)).clamp(0.0, 1.0)) }
        else { None };
    match frac { Some(f) => (az - (0.5 + 0.35 * (std::f64::consts::PI * f).cos() - 0.5) * 80.0).rem_euclid(360.0), None => 180.0 }
}
