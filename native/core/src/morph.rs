//! The digit morph: the page's easing (`easeInOutBack`) and the blend of two digit shapes. A port of `ease` and `morph` in js/clock.js.

use crate::digits::{DIGITS, POINTS};

/// `easeInOutBack` (Robert Penner), the page's default `conf.easing`: eases `t` of `d` steps from 0 to 1, with a small overshoot.
pub fn ease_in_out_back(t: f64, d: f64) -> f64 {
    let mut s = 1.70158;
    let mut t = t / (d / 2.0);
    if t < 1.0 {
        s *= 1.525;
        return 0.5 * (t * t * ((s + 1.0) * t - s));
    }
    t -= 2.0;
    s *= 1.525;
    0.5 * (t * t * ((s + 1.0) * t + s) + 2.0)
}

/// Blend digit `a` into digit `b`: step 0 is `a`, step `steps` is `b`.
pub fn morph(a: &[f64; POINTS], b: &[f64; POINTS], step: f64, steps: f64) -> [f64; POINTS] {
    let e = ease_in_out_back(step, steps);
    let mut out = [0.0; POINTS];
    for i in 0..POINTS { out[i] = a[i] + e * (b[i] - a[i]); }
    out
}

pub fn digit(n: usize) -> &'static [f64; POINTS] { &DIGITS[n % 10] }
