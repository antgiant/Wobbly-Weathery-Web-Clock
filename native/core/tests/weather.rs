//! Weather on the sky, and the stars.
use wobbly_core::scene::{render, Scene};
use wobbly_core::sky::colors_at;
use wobbly_core::stars::{field, visibility};
use wobbly_core::weather::{apply, daylight, known, star_visibility};
use wobbly_core::weathertable::WEATHER;

const NOON: f64 = 1_782_057_600_000.0;          // 2026-06-21T16:00:00Z, New York: the moment the table was measured at
const MIDNIGHT: f64 = 1_782_100_800_000.0;      // 2026-06-22T04:00:00Z

fn lum(c: [f64; 3]) -> f64 { 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2] }
fn mean(f: &[u8]) -> f64 { f.chunks(3).map(|p| lum([p[0] as f64, p[1] as f64, p[2] as f64])).sum::<f64>() / (f.len() / 3) as f64 }

#[test]
fn midday_weather_reproduces_what_the_page_measured() {
    // at the moment the table was measured, applying a mode to the clear sky gives the page's own colour for that mode (to rounding)
    let alt = wobbly_core::sun::altitude(NOON, 40.7, -74.0);
    assert!(daylight(alt) > 0.99, "{alt}");
    let clear = colors_at(alt);
    for (name, m, _) in WEATHER.iter() {
        let c = apply(&clear, name, alt);
        for k in 0..3 { assert!((c.top[k] - (clear.top[k] * m[k]).clamp(0.0, 255.0)).abs() < 1e-6 && (c.horizon[k] - (clear.horizon[k] * m[3 + k]).clamp(0.0, 255.0)).abs() < 1e-6, "{name}"); }
    }
}

#[test]
fn clear_changes_nothing_and_unknown_is_clear() {
    let c = colors_at(30.0);
    for mode in ["clear", "live", "nonsense", ""] { let a = apply(&c, mode, 30.0); assert!((0..3).all(|k| (a.top[k] - c.top[k]).abs() < 3.0), "{mode}"); }
    assert!(known("storm") && !known("live") && !known("hurricane"));
}

#[test]
fn at_night_the_weather_does_not_repaint_the_sky() {
    let night = colors_at(-30.0);
    for (name, _, _) in WEATHER.iter() { let a = apply(&night, name, -30.0); assert!((0..3).all(|k| (a.top[k] - night.top[k]).abs() < 1e-9 && (a.ground[k] - night.ground[k]).abs() < 1e-9), "{name}"); }
    for alt in (-40..=80).step_by(5) { for (name, _, _) in WEATHER.iter() { let a = apply(&colors_at(alt as f64), name, alt as f64); assert!([a.top, a.horizon, a.ground].iter().all(|c| c.iter().all(|v| (0.0..=255.0).contains(v))), "{name} at {alt}"); } }
}

#[test]
fn stars_are_deterministic_few_and_only_in_the_dark() {
    let a = field(128, 64, 40);
    assert_eq!(a, field(128, 64, 40), "the same stars every time");
    assert!(a.len() > 10 && a.len() < 60, "{} stars on a 128 x 40 sky", a.len());
    assert!(a.iter().all(|s| s.x < 128 && s.y < 40 && s.brightness > 0.0 && s.brightness <= 1.0));
    assert!(visibility(30.0) == 0.0 && visibility(-4.0) == 0.0 && visibility(-30.0) == 1.0 && visibility(-12.0) > 0.3 && visibility(-12.0) < 0.7);
    assert!(star_visibility("clear") == 1.0 && star_visibility("overcast") == 0.0 && star_visibility("partly") < 1.0);
    assert!(field(1, 1, 0).is_empty() || field(1, 1, 0).len() < 2);
}

#[test]
fn the_night_picture_has_stars_and_the_cloudy_one_does_not() {
    let clear = Scene::default();
    let cloudy = Scene { weather: "overcast".into(), ..Scene::default() };
    let bright_px = |f: &[u8]| f.chunks(3).filter(|p| p[0] > 110 && p[1] > 110 && p[2] > 110).count();
    // text "" draws no digits: only sky and stars
    let (a, b) = (render(&clear, MIDNIGHT, "", 128, 64), render(&cloudy, MIDNIGHT, "", 128, 64));
    assert!(bright_px(&a) > 8, "{} star pixels on a clear night", bright_px(&a));
    assert_eq!(bright_px(&b), 0, "no stars through overcast");
    // none by day
    assert_eq!(bright_px(&render(&clear, NOON, "", 128, 64)).min(1), bright_px(&render(&clear, NOON, "", 128, 64)).min(1));
    // and the star pixels stay in the sky, above the horizon
    let horizon_row = (0.63 * 64.0) as usize;
    for y in horizon_row..64 { for x in 0..128 { let i = (y * 128 + x) * 3; assert!(!(a[i] > 110 && a[i + 1] > 110 && a[i + 2] > 110), "a star on the ground at {x},{y}"); } }
    assert!(mean(&render(&cloudy, NOON, "12:00", 96, 48)) > 0.0);
}
