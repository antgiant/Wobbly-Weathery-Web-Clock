//! The sun's disc on the picture: where it is on the screen, and how it is drawn. The page's "follow the sun" view keeps the horizon at about 63% of the
//! height and the sun rising on the right and setting on the left; this reproduces what it measured (see the numbers in tests/disc.rs), not a model of
//! the camera.

use crate::sun;

/// The camera the page looks through, fitted to where it drew the sun and the moon: a pinhole camera whose half-width in tangent terms is `TAN_X` for a
/// picture at least as wide as tall (the page's 80 degree field of view), pitched up just enough to put the horizon at `horizon` of the height.
const TAN_X: f64 = 0.8390996;                                                       // tan 40 degrees: the page's 80 degree field of view

/// Where a point of the sky (compass bearing `az`, height `alt`, degrees) is on the picture for a camera looking at bearing `heading`: fractions of the
/// width and height, or None when it is behind the camera. The horizon is at `horizon` (0..1 of the height) straight ahead.
pub fn project(az: f64, alt: f64, heading: f64, horizon: f64, aspect: f64) -> Option<(f64, f64)> {
    let (tan_x, tan_y) = if aspect >= 1.0 { (TAN_X, TAN_X / aspect) } else { (TAN_X * aspect, TAN_X) };
    let pitch = ((horizon - 0.5) * 2.0 * tan_y).atan();
    let d = ((az - heading + 540.0).rem_euclid(360.0) - 180.0).to_radians();
    let a = alt.to_radians();
    let cx = a.cos() * d.sin();
    let cy = a.sin() * pitch.cos() - a.cos() * d.cos() * pitch.sin();
    let cz = a.sin() * pitch.sin() + a.cos() * d.cos() * pitch.cos();
    if cz <= 0.05 { return None; }
    Some((0.5 + cx / (cz * 2.0 * tan_x), 0.5 - cy / (cz * 2.0 * tan_y)))
}

/// The pitch (degrees) that puts the horizon at `horizon` of the picture's height, as the page works it out, for a picture of this shape.
pub fn pitch_for(horizon: f64, aspect: f64) -> f64 {
    let tan_y = if aspect >= 1.0 { TAN_X / aspect } else { TAN_X };
    ((horizon - 0.5) * 2.0 * tan_y).atan().to_degrees()
}

/// The camera's compass heading in the "follow the sun" view, for a picture of this shape.
pub fn heading_for(t_ms: f64, lat: f64, lon: f64, horizon: f64, aspect: f64) -> f64 {
    let tan_x = if aspect >= 1.0 { TAN_X } else { TAN_X * aspect };
    crate::follow::follow_heading(t_ms, lat, lon, pitch_for(horizon, aspect), tan_x)
}

/// Where the sun is on the picture, as fractions of the width and height (x to the right, y down), or None when it is below the horizon or off the
/// top of the picture.
pub fn sun_position(t_ms: f64, lat: f64, lon: f64, horizon: f64) -> Option<(f64, f64)> { sun_position_in(t_ms, lat, lon, horizon, 16.0 / 9.0) }

/// The same for a picture of a given width over height.
pub fn sun_position_in(t_ms: f64, lat: f64, lon: f64, horizon: f64, aspect: f64) -> Option<(f64, f64)> {
    let (alt, az) = sun::position(t_ms, lat, lon);
    if alt < sun::RISE_SET_ALTITUDE { return None; }
    let heading = heading_for(t_ms, lat, lon, horizon, aspect);
    let (x, y) = project(az, alt, heading, horizon, aspect)?;
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

/// Where the moon is on the picture (fractions of the width and height), or None when it is below the horizon or out of the picture, with the unit
/// direction on the screen towards the sun (which side of the moon is lit) and the lit fraction.
pub fn moon_position(t_ms: f64, lat: f64, lon: f64, horizon: f64, aspect: f64) -> Option<(f64, f64, (f64, f64), f64)> {
    let (alt, az) = crate::moon::position(t_ms, lat, lon);
    if alt < -0.5 { return None; }
    let heading = heading_for(t_ms, lat, lon, horizon, aspect);
    let (x, y) = project(az, alt, heading, horizon, aspect)?;
    if !(-0.02..=1.02).contains(&x) || !(-0.02..=1.02).contains(&y) { return None; }
    let (salt, saz) = sun::position(t_ms, lat, lon);
    // the sun's direction as seen from the moon on the screen: the difference in bearing (across) and in height (up is negative y)
    let across = ((saz - az + 540.0).rem_euclid(360.0) - 180.0) * alt.to_radians().cos();
    let up = salt - alt;
    let n = (across * across + up * up).sqrt().max(1e-9);
    Some((x, y, (across / n, -up / n), crate::moon::illumination(t_ms)))
}
