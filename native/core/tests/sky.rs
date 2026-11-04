//! The baked sky reproduces the web page at moments it was NOT baked from (a March morning; the table came from June evenings), and behaves.
use wobbly_core::sky::{at_row, colors_at};

fn f(s: &str) -> f64 { s.parse().unwrap() }

#[test]
fn matches_held_out_moments_from_the_web_page() {
    let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/sky_golden.tsv")).unwrap();
    let mut n = 0;
    for line in text.lines().filter(|l| l.starts_with("sky\t")) {
        let c: Vec<&str> = line.split('\t').collect();
        let got = colors_at(f(c[1]));
        for (name, col, want) in [("top", got.top, [f(c[2]), f(c[3]), f(c[4])]), ("horizon", got.horizon, [f(c[5]), f(c[6]), f(c[7])]), ("ground", got.ground, [f(c[8]), f(c[9]), f(c[10])])] {
            for k in 0..3 { assert!((col[k] - want[k]).abs() < 32.0, "alt {} {name}[{k}]: {} vs the page's {} ({line})", c[1], col[k], want[k]); }
        }
        n += 1;
    }
    assert!(n >= 8, "only {n} held-out moments");
}

#[test]
fn day_is_bluer_and_brighter_than_night_and_values_are_colours() {
    let (day, night) = (colors_at(45.0), colors_at(-30.0));
    let lum = |c: [f64; 3]| 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    assert!(lum(day.horizon) > lum(night.horizon) + 60.0 && lum(day.top) > lum(night.top));
    assert!(day.top[2] > day.top[0], "a day sky is blue");
    for alt in [-90.0, -30.0, -10.0, 0.0, 10.0, 45.0, 90.0] {
        let c = colors_at(alt);
        for col in [c.top, c.horizon, c.ground] { assert!(col.iter().all(|v| (0.0..=255.0).contains(v)), "alt {alt}: {col:?}"); }
    }
}

#[test]
fn the_gradient_runs_from_top_to_horizon_then_ground() {
    let c = colors_at(30.0);
    assert_eq!(at_row(&c, 0.0, 100.0, 0.6), c.top);
    assert_eq!(at_row(&c, 80.0, 100.0, 0.6), c.ground);
    let near = at_row(&c, 59.0, 100.0, 0.6);
    for k in 0..3 { assert!((near[k] - c.horizon[k]).abs() < 6.0); }
}
