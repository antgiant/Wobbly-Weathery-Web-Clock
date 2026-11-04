//! Where the sun is, and when it rises and sets. A low-precision solar position (the Astronomical Almanac's, good to about 0.01 degree
//! for the years around now), which is far finer than a clock sky needs. Checked against the astronomy library the web page uses
//! (`sunpos` and `sunevents` vectors in tests/golden.tsv).

use crate::dim::SunEvents;

const RAD: f64 = std::f64::consts::PI / 180.0;
/// The sun's centre this far below the horizon is when its upper edge touches it, with average refraction: the page's sunrise and sunset.
pub const RISE_SET_ALTITUDE: f64 = -0.8333;

/// Altitude and azimuth in degrees (azimuth from north, clockwise) of the sun's centre, geometric (no refraction).
pub fn position(t_ms: f64, lat: f64, lon: f64) -> (f64, f64) {
    let n = t_ms / 86_400_000.0 + 2_440_587.5 - 2_451_545.0;           // days since J2000
    let l = (280.460 + 0.9856474 * n).rem_euclid(360.0);
    let g = (357.528 + 0.9856003 * n).rem_euclid(360.0) * RAD;
    let lambda = (l + 1.915 * g.sin() + 0.020 * (2.0 * g).sin()) * RAD;
    let eps = (23.439 - 0.0000004 * n) * RAD;
    let ra = (eps.cos() * lambda.sin()).atan2(lambda.cos());
    let dec = (eps.sin() * lambda.sin()).asin();
    let gmst = (280.46061837 + 360.98564736629 * n).rem_euclid(360.0);
    let h = ((gmst + lon) * RAD) - ra;
    let phi = lat * RAD;
    let alt = (phi.sin() * dec.sin() + phi.cos() * dec.cos() * h.cos()).asin();
    let az = h.sin().atan2(h.cos() * phi.sin() - dec.tan() * phi.cos()) + std::f64::consts::PI;
    (alt / RAD, (az / RAD).rem_euclid(360.0))
}

pub fn altitude(t_ms: f64, lat: f64, lon: f64) -> f64 { position(t_ms, lat, lon).0 }

/// The last and next sunrise and sunset within 1.6 days either way of `t_ms` (like the page's search); `NAN` where there is none.
pub fn events(t_ms: f64, lat: f64, lon: f64) -> SunEvents {
    const STEP: f64 = 600_000.0;                                        // 10 minutes
    const SPAN: f64 = 1.6 * 86_400_000.0;
    let f = |t: f64| altitude(t, lat, lon) - RISE_SET_ALTITUDE;
    let cross = |a: f64, b: f64| -> f64 {                               // the time between a and b where f changes sign
        let (mut lo, mut hi) = (a, b);
        let rising = f(a) < 0.0;
        for _ in 0..40 {
            let mid = 0.5 * (lo + hi);
            if (f(mid) < 0.0) == rising { lo = mid } else { hi = mid }
        }
        0.5 * (lo + hi)
    };
    let mut out = SunEvents::NONE;
    // walk back from now, then forward, to the first crossing of each kind
    let (mut t, mut prev) = (t_ms, f(t_ms));
    while t_ms - t < SPAN && (out.prev_rise.is_nan() || out.prev_set.is_nan()) {
        let (u, cur) = (t - STEP, f(t - STEP));
        if (cur < 0.0) != (prev < 0.0) {
            let e = cross(u, t);
            if prev >= 0.0 { if out.prev_rise.is_nan() { out.prev_rise = e } } else if out.prev_set.is_nan() { out.prev_set = e }
        }
        t = u; prev = cur;
    }
    let (mut t, mut prev) = (t_ms, f(t_ms));
    while t - t_ms < SPAN && (out.next_rise.is_nan() || out.next_set.is_nan()) {
        let (u, cur) = (t + STEP, f(t + STEP));
        if (cur < 0.0) != (prev < 0.0) {
            let e = cross(t, u);
            if cur >= 0.0 { if out.next_rise.is_nan() { out.next_rise = e } } else if out.next_set.is_nan() { out.next_set = e }
        }
        t = u; prev = cur;
    }
    out
}
