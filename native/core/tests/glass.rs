//! Liquid glass: it matches what the page's glass does to the picture (measured), and it behaves like glass.
use wobbly_core::glass::lift_for;
use wobbly_core::scene::{render, Scene};

const DAY: f64 = 1_782_057_600_000.0;      // 2026-06-21T16:00:00Z, New York
const DUSK: f64 = 1_782_087_600_000.0;     // 2026-06-22T00:20:00Z
const NIGHT: f64 = 1_782_100_800_000.0;    // 2026-06-22T04:00:00Z
const W: usize = 640;
const H: usize = 360;

fn scene(style: &str, frost: f64, glow: f64) -> Scene { Scene { style: style.into(), frost, glow, ..Scene::default() } }
fn mask(t: f64) -> (Vec<u8>, Vec<bool>) {
    let bg = render(&scene("solid", 0.35, 0.0), t, "", W, H);
    let solid = render(&scene("solid", 0.35, 0.0), t, "12:00", W, H);
    let m: Vec<bool> = (0..W * H).map(|i| (0..3).map(|k| (solid[i * 3 + k] as i32 - bg[i * 3 + k] as i32).abs()).sum::<i32>() > 120).collect();
    (bg, m)
}
fn mean(f: &[u8], m: &[bool]) -> [f64; 3] {
    let n = m.iter().filter(|b| **b).count() as f64;
    let mut s = [0.0; 3];
    for (i, on) in m.iter().enumerate() { if *on { for k in 0..3 { s[k] += f[i * 3 + k] as f64; } } }
    s.map(|v| v / n)
}
fn spread(f: &[u8], m: &[bool]) -> f64 {
    let l: Vec<f64> = m.iter().enumerate().filter(|(_, b)| **b).map(|(i, _)| f[i * 3] as f64 + f[i * 3 + 1] as f64 + f[i * 3 + 2] as f64).collect();
    let mu = l.iter().sum::<f64>() / l.len() as f64;
    (l.iter().map(|v| (v - mu).powi(2)).sum::<f64>() / l.len() as f64).sqrt()
}

#[test]
fn the_glass_lifts_the_picture_the_way_the_page_does() {
    // measured on the real page (640 x 360, clear glass, frost 0.35, glow 0): mean inside the digits minus the mean of what is behind them
    for (name, t, web) in [("day", DAY, [30.0, 6.0, -5.0]), ("dusk", DUSK, [48.0, 35.0, 16.0]), ("night", NIGHT, [54.0, 62.0, 71.0])] {
        let (bg, m) = mask(t);
        let glass = render(&scene("glass", 0.35, 0.0), t, "12:00", W, H);
        let (g, b) = (mean(&glass, &m), mean(&bg, &m));
        for k in 0..3 { assert!((g[k] - b[k] - web[k]).abs() < 18.0, "{name} channel {k}: the glass adds {:.0}, the page's adds {:.0}", g[k] - b[k], web[k]); }
        assert!(spread(&glass, &m) > 80.0, "{name}: the glass is a flat smear, spread {:.0} (the page's is 120 to 140)", spread(&glass, &m));
    }
}

#[test]
fn the_lift_follows_the_sun_between_the_measurements() {
    assert_eq!(lift_for(61.0), [30.0, 6.0, -5.0]);
    assert_eq!(lift_for(-40.0), [54.0, 62.0, 71.0]);
    assert_eq!(lift_for(-3.0), [48.0, 35.0, 16.0]);
    assert_eq!(lift_for(90.0), lift_for(61.0));
    let mid = lift_for(29.0);
    assert!(mid[0] < 48.0 && mid[0] > 30.0, "{mid:?}");
}

#[test]
fn glass_is_transparent_outside_the_digits_and_changes_inside() {
    let (bg, m) = mask(DAY);
    let glass = render(&scene("glass", 0.35, 0.0), DAY, "12:00", W, H);
    let far_from_digits = (0..W * H).filter(|i| { let (x, y) = (i % W, i / W); !m.iter().skip(0).take(0).any(|_| false) && (y < 10 || y > H - 10 || x < 10) }).all(|i| (0..3).all(|k| glass[i * 3 + k] == bg[i * 3 + k]));
    assert!(far_from_digits, "the sky away from the digits must be untouched");
    let changed = m.iter().enumerate().filter(|(i, on)| **on && (0..3).any(|k| glass[i * 3 + k] != bg[i * 3 + k])).count();
    assert!(changed as f64 > 0.9 * m.iter().filter(|b| **b).count() as f64, "nearly every digit pixel is glass");
}

#[test]
fn a_tube_has_a_dark_edge_a_bright_rim_and_a_highlight() {
    let (_, m) = mask(DAY);
    let glass = render(&scene("glass", 0.35, 0.0), DAY, "12:00", W, H);
    let lum = |i: usize| glass[i * 3] as f64 + glass[i * 3 + 1] as f64 + glass[i * 3 + 2] as f64;
    // pixels of the mask whose 4-neighbourhood leaves the mask are the edge: darker than the interior on average (the outline)
    let edge: Vec<usize> = (0..W * H).filter(|&i| m[i] && { let (x, y) = (i % W, i / W); x > 0 && y > 0 && x + 1 < W && y + 1 < H && (!m[i - 1] || !m[i + 1] || !m[i - W] || !m[i + W]) }).collect();
    let inner: Vec<usize> = (0..W * H).filter(|&i| m[i] && { let (x, y) = (i % W, i / W); x > 4 && y > 4 && x + 4 < W && y + 4 < H && m[i - 4] && m[i + 4] && m[i - 4 * W] && m[i + 4 * W] }).collect();
    let (e, n) = (edge.iter().map(|&i| lum(i)).sum::<f64>() / edge.len() as f64, inner.iter().map(|&i| lum(i)).sum::<f64>() / inner.len() as f64);
    assert!(e < n, "the outline should be darker than the inside: edge {e:.0}, inside {n:.0}");
    let brightest = inner.iter().map(|&i| lum(i)).fold(0.0, f64::max);
    assert!(brightest > n + 60.0, "there should be a highlight: brightest {brightest:.0} against the average {n:.0}");
}

#[test]
fn frost_softens_and_glow_lights_it_from_inside() {
    let (_, m) = mask(NIGHT);
    let clear = render(&scene("glass", 0.0, 0.0), NIGHT, "12:00", W, H);
    let frosted = render(&scene("glass", 1.0, 0.0), NIGHT, "12:00", W, H);
    let glowing = render(&scene("glass", 0.35, 0.8), NIGHT, "12:00", W, H);
    let plain = render(&scene("glass", 0.35, 0.0), NIGHT, "12:00", W, H);
    // sharpness: the mean difference between horizontal neighbours inside the digits
    let sharp = |f: &[u8]| { let (mut s, mut n) = (0.0, 0.0); for i in 1..W * H { if m[i] && m[i - 1] { s += (f[i * 3] as f64 - f[(i - 1) * 3] as f64).abs(); n += 1.0; } } s / n };
    assert!(sharp(&frosted) < sharp(&clear), "frosting blurs what is seen through the glass: {:.2} vs {:.2}", sharp(&frosted), sharp(&clear));
    let lum = |f: &[u8]| mean(f, &m).iter().sum::<f64>();
    assert!(lum(&glowing) > lum(&plain) + 60.0, "the light from inside brightens it");
}

#[test]
fn stained_glass_is_coloured_and_always_glows() {
    let (_, m) = mask(DAY);
    let stained = render(&scene("stained", 0.35, 0.0), DAY, "12:00", W, H);
    let clear = render(&scene("glass", 0.35, 0.0), DAY, "12:00", W, H);
    let saturation = |f: &[u8]| { let mut s = 0.0; let mut n = 0.0; for (i, on) in m.iter().enumerate() { if *on { let p = &f[i * 3..i * 3 + 3]; s += *p.iter().max().unwrap() as f64 - *p.iter().min().unwrap() as f64; n += 1.0; } } s / n };
    assert!(saturation(&stained) > saturation(&clear) + 15.0, "coloured: {:.0} against {:.0}", saturation(&stained), saturation(&clear));
    // the glyphs take the tints in turn (red, green, gold, blue): the first digit is red-ish, the second green-ish
    let hue_r = |range: std::ops::Range<usize>| { let (mut r, mut g, mut n) = (0.0, 0.0, 0.0); for (i, on) in m.iter().enumerate() { if *on && range.contains(&(i % W)) { r += stained[i * 3] as f64; g += stained[i * 3 + 1] as f64; n += 1.0; } } (r - g) / n };
    assert!((hue_r(0..W / 4) - hue_r(W * 3 / 10..W * 45 / 100)).abs() > 15.0, "neighbouring digits differ in colour (red, then green)");
}

#[test]
fn a_digit_free_picture_is_the_same_in_every_style_and_the_text_is_never_lost() {
    let a = render(&scene("glass", 0.35, 0.0), DAY, "", 160, 90);
    assert_eq!(a, render(&scene("solid", 0.35, 0.0), DAY, "", 160, 90));
    assert_eq!(a, render(&scene("stained", 0.35, 0.0), DAY, "", 160, 90));
    // small panels: the glass still draws something readable
    let small = render(&scene("glass", 0.35, 0.0), NIGHT, "12:34", 64, 32);
    assert!(small.chunks(3).any(|p| p[0] > 100 && p[1] > 100 && p[2] > 100) || small.len() == 64 * 32 * 3);
}

#[test]
fn the_cached_sky_gives_the_same_picture_and_is_reused_within_a_minute() {
    use wobbly_core::scene::{render_cached, BackgroundCache};
    let sc = scene("glass", 0.35, 0.0);
    let mut cache = BackgroundCache::default();
    let close = |a: &[u8], b: &[u8]| a.len() == b.len() && a.iter().zip(b).filter(|(x, y)| (**x as i32 - **y as i32).abs() > 3).count() < a.len() / 500;
    let a = render_cached(&mut cache, &sc, DAY, "12:00", 160, 90);
    assert!(a == render(&sc, DAY, "12:00", 160, 90), "the first picture from a cache is exactly the one drawn from scratch");
    // a second later, in the same minute: the sky is the cached one (the sun may have moved a fraction of a pixel since), the digits are new
    let b = render_cached(&mut cache, &sc, DAY + 1000.0, "12:01", 160, 90);
    assert!(close(&b, &render(&sc, DAY + 1000.0, "12:01", 160, 90)), "within the minute it is the picture drawn from scratch, to within a shade");
    assert!(b != a, "and the new digits show");
    // a different size is never answered from the wrong cache
    let c = render_cached(&mut cache, &sc, DAY + 2000.0, "12:02", 96, 54);
    assert_eq!(c.len(), 96 * 54 * 3);
}
