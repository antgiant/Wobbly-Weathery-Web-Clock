//! Wind sway: the digits lean in the wind like palm trees, the bottom fixed and the top moving. A port of js/wind.js, in the digits' own path units
//! (a digit is about 333 wide and 420 tall; its stroke is 80 thick).

pub const MAX_LEAN: f64 = 90.0;
pub const MAX_GUST: f64 = 18.0;
pub const GALE: f64 = 18.0;
pub const Y_TOP: f64 = 30.0;
pub const Y_BOT: f64 = 450.0;

fn wrap180(d: f64) -> f64 { (d + 540.0).rem_euclid(360.0) - 180.0 }

/// How strong the wind is, 0 (calm) to 1 (a gale), eased so a light breeze already shows.
pub fn strength(speed: f64) -> f64 { (speed.max(0.0) / GALE).min(1.0).sqrt() }

/// (lean, gust): the lean pushes the tops of the digits to the right of the screen when positive. `to_az` is the bearing the wind blows towards,
/// `heading` the bearing the screen looks at.
pub fn sway_for(speed: f64, to_az: f64, heading: f64) -> (f64, f64) {
    let s = strength(speed);
    let across = wrap180(to_az - heading).to_radians().sin();
    (MAX_LEAN * s * across, MAX_GUST * s)
}

/// The gust factor, -1 to 1: two slow sines that never quite repeat, offset by the digit's `phase`.
pub fn flutter(t_ms: f64, phase: f64) -> f64 {
    let t = t_ms / 1000.0;
    0.6 * (2.0 * std::f64::consts::PI * 0.31 * t + phase).sin() + 0.4 * (2.0 * std::f64::consts::PI * 0.83 * t + 1.7 * phase + 0.6).sin()
}

/// 0 at the bottom of the digit, 1 at the top: how much of the push a point at height `y` takes (it bends, it does not slide).
pub fn weight(y: f64) -> f64 { ((Y_BOT - y) / (Y_BOT - Y_TOP)).clamp(0.0, 1.0).powf(1.6) }

/// Bend a digit's control points by `dx` at the top.
pub fn bend(points: &[f64; 26], dx: f64) -> [f64; 26] {
    if dx == 0.0 { return *points; }
    let mut out = *points;
    for i in (0..26).step_by(2) { out[i] = ((points[i] + dx * weight(points[i + 1])) * 10.0).round() / 10.0; }
    out
}
