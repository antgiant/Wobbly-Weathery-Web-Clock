//! "Follow the sun": the camera heading the page turns to so the sun stays in the right place on the screen. A port of `followHeading` in js/sky/sunpath.js.
//! By day the sun slides from the right quarter of the screen to the left, following its real bearing (so the seasons show); at night the camera turns
//! back, unhurried, from the sunset framing to the next sunrise one.

use crate::dim::SunEvents;
use crate::sun;

const DEG: f64 = std::f64::consts::PI / 180.0;

fn wrap180(d: f64) -> f64 { (d + 540.0).rem_euclid(360.0) - 180.0 }

/// The sun's bearing at solar noon on the day that starts at `rise`, and which way it turns that day (+1 clockwise, as in the northern hemisphere facing south).
struct Frame { noon_az: f64, dir: f64 }

fn day_frame(rise: f64, lat: f64, lon: f64) -> Frame {
    // solar noon: the highest the sun gets in the day after the rise (a golden-section search over the next 16 hours)
    let alt = |t: f64| sun::altitude(t, lat, lon);
    let (mut a, mut b) = (rise, rise + 16.0 * 3_600_000.0);
    let g = 0.618_033_988_75;
    for _ in 0..60 { let (c, d) = (b - g * (b - a), a + g * (b - a)); if alt(c) > alt(d) { b = d } else { a = c } }
    let noon = 0.5 * (a + b);
    let noon_az = sun::position(noon, lat, lon).1;
    let rise_az = sun::position(rise, lat, lon).1;
    Frame { noon_az, dir: if wrap180(noon_az - rise_az) >= 0.0 { 1.0 } else { -1.0 } }
}

/// Where on the screen the sun should be, 0 = left edge, 1 = right edge: sunrise a quarter of the way in from the right and sunset a quarter in from the left.
fn screen_x(az: f64, f: &Frame) -> f64 { let p = f.dir * wrap180(az - f.noon_az); (0.5 - p / 360.0).clamp(0.1, 0.9) }

fn dir_of(az: f64, alt: f64) -> [f64; 3] { [(az * DEG).sin() * (alt * DEG).cos(), (alt * DEG).sin(), (az * DEG).cos() * (alt * DEG).cos()] }

/// The heading that puts a sun at (`az`, `alt`) at screen position `x` (0..1) for a camera with the given pitch (degrees) and half-width tangent.
pub fn heading_for_sun_at(az: f64, alt: f64, x: f64, pitch_deg: f64, tan_x: f64) -> f64 {
    let (d, p, target) = (dir_of(az, alt), pitch_deg * DEG, 2.0 * x - 1.0);
    let ndc = |h_deg: f64| {
        let h = h_deg * DEG;
        let cx = d[0] * h.cos() - d[2] * h.sin();
        let cz = d[0] * h.sin() * p.cos() + d[1] * p.sin() + d[2] * h.cos() * p.cos();
        if cz > 1e-4 { cx / (cz * tan_x) } else if cx >= 0.0 { 1e3 } else { -1e3 }
    };
    let (mut lo, mut hi) = (az - 88.0, az + 88.0);
    for _ in 0..44 { let mid = 0.5 * (lo + hi); if ndc(mid) > target { lo = mid } else { hi = mid } }
    (0.5 * (lo + hi) + 360.0).rem_euclid(360.0)
}

fn lerp_angle(a: f64, b: f64, t: f64) -> f64 { a + wrap180(b - a) * t }

/// The camera heading (degrees) for a moment and a place.
pub fn follow_heading(t_ms: f64, lat: f64, lon: f64, pitch_deg: f64, tan_x: f64) -> f64 {
    let ev: SunEvents = sun::events(t_ms, lat, lon);
    let (alt, az) = sun::position(t_ms, lat, lon);
    let centred = || heading_for_sun_at(az, alt, 0.5, pitch_deg, tan_x);
    let some = |v: f64| if v.is_finite() { Some(v) } else { None };
    let (prev_rise, prev_set, next_rise, next_set) = (some(ev.prev_rise), some(ev.prev_set), some(ev.next_rise), some(ev.next_set));
    let day = next_set.is_some() && (next_rise.is_none() || next_set.unwrap() < next_rise.unwrap());
    if day {
        let Some(pr) = prev_rise else { return centred() };
        return heading_for_sun_at(az, alt, screen_x(az, &day_frame(pr, lat, lon)), pitch_deg, tan_x);
    }
    let (Some(ps), Some(nr)) = (prev_set, next_rise) else { return centred() };
    // the framing at the last sunset (that day started at the rise before it) ...
    let day_rise = sun::events(ps - 1.0, lat, lon).prev_rise;
    let (s_alt, s_az) = sun::position(ps, lat, lon);
    let h_set = if day_rise.is_finite() { Some(heading_for_sun_at(s_az, s_alt, screen_x(s_az, &day_frame(day_rise, lat, lon)), pitch_deg, tan_x)) } else { None };
    // ... and at the coming sunrise
    let (r_alt, r_az) = sun::position(nr, lat, lon);
    let h_rise = heading_for_sun_at(r_az, r_alt, screen_x(r_az, &day_frame(nr, lat, lon)), pitch_deg, tan_x);
    let Some(h_set) = h_set else { return h_rise };
    let u = ((t_ms - ps) / (nr - ps)).clamp(0.0, 1.0);
    (lerp_angle(h_set, h_rise, u) + 360.0).rem_euclid(360.0)
}
