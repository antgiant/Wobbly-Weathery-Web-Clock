//! Landscapes: ground colours the way the page has them, silhouettes of the right character, and a picture that differs.
use wobbly_core::landscape::{ground_mult, known, profile, wave};
use wobbly_core::scene::{render, Scene};

const DAY: f64 = 1_782_057_600_000.0;
const NIGHT: f64 = 1_782_100_800_000.0;
const W: usize = 320;
const H: usize = 180;

fn scene(land: &str) -> Scene { Scene { landscape: land.into(), ..Scene::default() } }
fn ground_mean(f: &[u8]) -> [f64; 3] {
    let (y0, y1) = ((H as f64 * 0.8) as usize, (H as f64 * 0.95) as usize);
    let mut s = [0.0; 3]; let mut n = 0.0;
    for y in y0..y1 { for x in 0..W { for k in 0..3 { s[k] += f[(y * W + x) * 3 + k] as f64; } n += 1.0; } }
    s.map(|v| v / n)
}

#[test]
fn ground_colours_follow_what_the_page_measured() {
    let flat = ground_mean(&render(&scene("flat"), DAY, "", W, H));
    for land in ["desert", "ocean", "city"] {
        let m = ground_mult(land, 1.0);
        let got = ground_mean(&render(&scene(land), DAY, "", W, H));
        for k in 0..3 { assert!((got[k] / flat[k] - m[k]).abs() < 0.35 * m[k].max(1.0), "{land} channel {k}: {} against {}", got[k] / flat[k], m[k]); }
    }
    // the page's midday desert is sand (red over blue), its ocean is blue, its flat ground is green
    let d = ground_mean(&render(&scene("desert"), DAY, "", W, H));
    let o = ground_mean(&render(&scene("ocean"), DAY, "", W, H));
    assert!(d[0] > d[2] && o[2] > o[0] && flat[1] > flat[0]);
    assert!(ground_mult("hills", 1.0) == [1.0, 1.0, 1.0] && ground_mult("nonsense", 1.0) == [1.0, 1.0, 1.0], "unknown is flat");
    assert!(ground_mult("desert", 0.0) != ground_mult("desert", 1.0), "night has its own measurement");
}

#[test]
fn silhouettes_have_the_right_character() {
    let heights = |name: &str| -> Vec<f64> { (0..400).map(|i| profile(name, (i as f64 + 0.5) / 400.0).0).collect() };
    let (hills, mountains, desert, city, flat, ocean) = (heights("hills"), heights("mountains"), heights("desert"), heights("city"), heights("flat"), heights("ocean"));
    let m = |v: &Vec<f64>| v.iter().sum::<f64>() / v.len() as f64;
    let mx = |v: &Vec<f64>| v.iter().cloned().fold(0.0, f64::max);
    assert!(flat.iter().chain(ocean.iter()).all(|h| *h == 0.0), "flat ground and the sea have no skyline");
    assert!(m(&mountains) > 1.8 * m(&hills) && mx(&mountains) > 0.18 && mx(&hills) < 0.09, "mountains stand much higher than hills: {:.3} against {:.3}", m(&mountains), m(&hills));
    assert!(mx(&desert) < 0.02, "dunes are low");
    assert!(mx(&city) > 0.06 && mx(&city) < 0.15 && m(&city) < 0.05, "a city is mostly low blocks with a few tall ones");
    let jumps = |v: &Vec<f64>| v.windows(2).filter(|w| (w[0] - w[1]).abs() > 0.01).count();
    assert!(jumps(&city) > 10 && jumps(&hills) == 0 && jumps(&mountains) == 0, "a skyline has square edges, hills do not: {} / {} / {}", jumps(&city), jumps(&hills), jumps(&mountains));
    assert_eq!(heights("hills"), hills, "the same every time");
    // snow only on mountains, only near the top
    assert!((0..400).any(|i| profile("mountains", i as f64 / 400.0).1 > 0.25) && (0..400).all(|i| profile("hills", i as f64 / 400.0).1 == 0.0 && profile("city", i as f64 / 400.0).1 == 0.0));
    assert!((0..400).all(|i| profile("mountains", i as f64 / 400.0).1 <= 0.55));
}

#[test]
fn the_sea_has_waves_and_every_landscape_looks_different() {
    let vals: Vec<f64> = (0..200).map(|i| wave(i as f64 / 200.0, 0.5, 10.0)).collect();
    let (lo, hi) = (vals.iter().cloned().fold(9.0, f64::min), vals.iter().cloned().fold(0.0, f64::max));
    assert!(lo > 0.6 && hi < 1.5 && hi - lo > 0.1, "waves vary but stay in range: {lo:.2}..{hi:.2}");
    let pics: Vec<Vec<u8>> = ["flat", "hills", "mountains", "desert", "ocean", "city"].iter().map(|l| render(&scene(l), DAY, "", W, H)).collect();
    for i in 0..pics.len() { for j in i + 1..pics.len() { assert!(pics[i] != pics[j], "landscapes {i} and {j} look the same"); } }
    assert!(known("city") && known("flat") && !known("auto") && !known("moonbase"));
}

#[test]
fn mountains_at_night_stay_dark_and_the_sky_above_them_is_untouched() {
    let day = render(&scene("mountains"), DAY, "", W, H);
    let night = render(&scene("mountains"), NIGHT, "", W, H);
    let lum = |f: &[u8], x: usize, y: usize| { let i = (y * W + x) * 3; f[i] as u32 + f[i + 1] as u32 + f[i + 2] as u32 };
    let sky_px = (0.63 * H as f64) as usize;
    let ridge_y = sky_px - 12;
    assert!(lum(&night, W / 2, ridge_y) < lum(&day, W / 2, ridge_y), "the ridge is darker at night");
    assert_eq!(lum(&render(&scene("flat"), DAY, "", W, H), 5, 3), lum(&day, 5, 3), "the top of the sky does not depend on the landscape");
}
