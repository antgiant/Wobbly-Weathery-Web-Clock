//! A picture of the clock for a moment and place: `cargo run --release --example scene -- 128 64 2026-06-21T23:30:00Z 40.7 -74 12:34 out.ppm [weather]`
use wobbly_core::frame::ppm;
use wobbly_core::scene::{render, Scene};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (w, h): (usize, usize) = (a[1].parse().unwrap(), a[2].parse().unwrap());
    let t: f64 = a[3].parse().unwrap_or_else(|_| parse_utc(&a[3]));
    let scene = Scene { lat: a[4].parse().unwrap(), lon: a[5].parse().unwrap(), brightness_night: 0.6, weather: a.get(8).cloned().unwrap_or_else(|| "clear".into()), ..Scene::default() };
    std::fs::write(&a[7], ppm(&render(&scene, t, &a[6], w, h), w, h)).unwrap();
}
// "2026-06-21T23:30:00Z" -> epoch ms (no dependencies)
fn parse_utc(s: &str) -> f64 {
    let n = |r: std::ops::Range<usize>| s[r].parse::<i64>().unwrap();
    (wobbly_core::tz::days_from_civil(n(0..4), n(5..7), n(8..10)) * 86400 + n(11..13) * 3600 + n(14..16) * 60) as f64 * 1000.0
}
