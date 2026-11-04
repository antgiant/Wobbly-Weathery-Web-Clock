//! A picture of the clock for a moment and place: `cargo run --release --example scene -- 128 64 2026-06-21T23:30:00Z 40.7 -74 12:34 out.ppm`
use wobbly_core::frame::ppm;
use wobbly_core::scene::{render, Scene};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (w, h): (usize, usize) = (a[1].parse().unwrap(), a[2].parse().unwrap());
    let t: f64 = a[3].parse().unwrap_or_else(|_| parse_utc(&a[3]));
    let scene = Scene { lat: a[4].parse().unwrap(), lon: a[5].parse().unwrap(), brightness_night: 0.3, ..Scene::default() };
    std::fs::write(&a[7], ppm(&render(&scene, t, &a[6], w, h), w, h)).unwrap();
}
// "2026-06-21T23:30:00Z" -> epoch ms (no dependencies: days from civil)
fn parse_utc(s: &str) -> f64 {
    let n = |r: std::ops::Range<usize>| s[r].parse::<i64>().unwrap();
    let (y, m, d, hh, mm) = (n(0..4), n(5..7), n(8..10), n(11..13), n(14..16));
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400); let yoe = y2 - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    ((days * 86400 + hh * 3600 + mm * 60) * 1000) as f64
}
