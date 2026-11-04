//! Brightness: a day level and a night level, with sunset and sunrise as the transition. A port of `js/sky/dim.js`; the numbers must match.

/// Sun events around "now", epoch milliseconds; `NAN` for an event that does not exist (polar day or night).
#[derive(Clone, Copy, Debug)]
pub struct SunEvents {
    pub prev_rise: f64,
    pub prev_set: f64,
    pub next_rise: f64,
    pub next_set: f64,
}

impl SunEvents {
    pub const NONE: SunEvents = SunEvents { prev_rise: f64::NAN, prev_set: f64::NAN, next_rise: f64::NAN, next_set: f64::NAN };
}

fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// How much of the night level applies: 0 (the full day level) to 1 (the full night level).
/// `alt` is the sun's height in degrees, used only when there are no sun events. `minutes` is the width of the transition, centred on each event.
pub fn nightness(t: f64, ev: &SunEvents, alt: f64, minutes: f64) -> f64 {
    let half = minutes.max(1.0) * 30000.0;
    let evening = |s: f64| smooth(0.0, 1.0, (t - (s - half)) / (2.0 * half));
    let morning = |r: f64| smooth(0.0, 1.0, (t - (r - half)) / (2.0 * half));
    let (pr, ps, nr, ns) = (ev.prev_rise, ev.prev_set, ev.next_rise, ev.next_set);
    if !(pr.is_finite() || ps.is_finite() || nr.is_finite() || ns.is_finite()) {
        return if alt.is_finite() { 1.0 - smooth(-10.0, -3.0, alt) } else { 0.0 };
    }
    let last_was_set = ps.is_finite() && (!pr.is_finite() || ps > pr);
    if last_was_set {
        let e = evening(ps);
        let m = if nr.is_finite() { morning(nr) } else { 0.0 };
        return e.min(1.0 - m).clamp(0.0, 1.0);
    }
    let m = if pr.is_finite() { 1.0 - morning(pr) } else { 0.0 };
    let e = if ns.is_finite() { evening(ns) } else { 0.0 };
    m.max(e).clamp(0.0, 1.0)
}

/// A brightness setting as the page reads it: missing or not a number means no veil (1), and below 10% is 10%.
pub fn level(x: f64) -> f64 {
    if x.is_finite() { x.clamp(0.1, 1.0) } else { 1.0 }
}

/// The brightness now, 0.1 to 1: the day level, the night level, or between.
pub fn brightness_at(t: f64, ev: &SunEvents, alt: f64, day: f64, night: f64, minutes: f64) -> f64 {
    let (d, n) = (level(day), level(night));
    d + (n - d) * nightness(t, ev, alt, minutes)
}

/// True when the settings can ever darken the screen.
pub fn dimming_on(day: f64, night: f64) -> bool {
    [day, night].iter().any(|x| x.is_finite() && *x < 0.995)
}
