//! Writes a PPM of the clock: `cargo run --example frame -- 64 32 12:34:56 out.ppm`
use wobbly_core::frame::{ppm, render};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (w, h): (usize, usize) = (a[1].parse().unwrap(), a[2].parse().unwrap());
    let rgb = render(&a[3], w, h, [30, 60, 140], [250, 170, 100], [255, 255, 255], 1.0);
    std::fs::write(&a[4], ppm(&rgb, w, h)).unwrap();
}
