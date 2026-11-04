//! Wind and weather on the digits.
use wobbly_core::effects::{apply, for_weather, Fx, NONE};
use wobbly_core::frame::{field_text_bent, text_bbox_bent};
use wobbly_core::scene::{bends_for, render, Scene};
use wobbly_core::weather::Weather;

const DAY: f64 = 1_782_057_600_000.0;      // 2026-06-21T16:00:00Z
const W: usize = 480;
const H: usize = 270;

fn scene(style: &str, mode: &str) -> Scene { Scene { style: style.into(), weather: mode.into(), wx: Weather::preset(mode), ..Scene::default() } }
/// the mean x of the lit pixels in a band of rows, for a solid white-ink picture (so where the ink is, not what it looks like)
fn ink_x(f: &[u8], bg: &[u8], y0: usize, y1: usize) -> f64 {
    let (mut s, mut n) = (0.0f64, 0.0f64);
    for y in y0..y1 { for x in 0..W { let i = (y * W + x) * 3; if (0..3).map(|k| (f[i + k] as i32 - bg[i + k] as i32).abs()).sum::<i32>() > 150 { s += x as f64; n += 1.0; } } }
    s / n.max(1.0)
}

#[test]
fn the_weather_fx_follow_the_weather() {
    assert_eq!(for_weather(&Weather::preset("clear")), NONE);
    assert_eq!(for_weather(&Weather::preset("fog")), NONE);
    let rain = for_weather(&Weather::preset("rain")); let storm = for_weather(&Weather::preset("storm")); let snow = for_weather(&Weather::preset("snow"));
    assert!(rain.rain > 0.5 && rain.snow == 0.0 && storm.rain > rain.rain && snow.snow > 0.5 && snow.rain == 0.0);
}

#[test]
fn wind_leans_the_digits_the_way_it_blows_and_not_when_calm() {
    let still = scene("solid", "storm");
    let bg = render(&Scene { sway: "off".into(), ..still.clone() }, DAY, "", W, H);
    let straight = render(&Scene { sway: "off".into(), digit_weather: false, ..still.clone() }, DAY, "11:11", W, H);
    // a gale from the west blows towards the east; with the screen looking at heading 180 + the follow-sun offset, "across" is some fraction: try both ways
    let mut east = Scene { sway: "lean".into(), digit_weather: false, ..still.clone() };
    east.wx.wind = [0.04, 0.0];
    let mut west = east.clone(); west.wx.wind = [-0.04, 0.0];
    let (be, bw) = (bends_for(&east, DAY, "11:11"), bends_for(&west, DAY, "11:11"));
    assert_eq!(be.len(), 4);
    assert!(be[0] * bw[0] < 0.0 || (be[0] == 0.0 && bw[0] == 0.0), "opposite winds lean opposite ways: {be:?} {bw:?}");
    assert!(be.iter().all(|b| b.abs() <= 90.0 + 1e-9), "never more than the maximum lean: {be:?}");
    if be[0].abs() > 5.0 {
        let a = render(&east, DAY, "11:11", W, H);
        let b = render(&west, DAY, "11:11", W, H);
        // the top of the digits moves with the lean, the bottom stays put
        let (top_s, top_e, top_w) = (ink_x(&straight, &bg, 60, 90), ink_x(&a, &bg, 60, 90), ink_x(&b, &bg, 60, 90));
        let (bot_s, bot_e, bot_w) = (ink_x(&straight, &bg, 150, 170), ink_x(&a, &bg, 150, 170), ink_x(&b, &bg, 150, 170));
        assert!((top_e - top_w).abs() > 3.0 && (top_e - top_s) * (top_w - top_s) < 0.0, "the tops lean apart: {top_e:.1} {top_w:.1} against {top_s:.1}");
        assert!((bot_e - bot_s).abs() < (top_e - top_s).abs() && (bot_w - bot_s).abs() < (top_w - top_s).abs(), "the bottoms stay: {bot_e:.1} {bot_w:.1} against {bot_s:.1}");
    }
    let mut calm = east.clone(); calm.wx.wind = [0.0, 0.0];
    assert!(bends_for(&calm, DAY, "11:11").iter().all(|b| *b == 0.0), "no wind, no lean");
    assert!(bends_for(&Scene { sway: "off".into(), ..east.clone() }, DAY, "11:11").is_empty());
}

#[test]
fn gusts_flutter_in_full_mode_only() {
    let mut s = Scene { sway: "lean".into(), ..Scene::default() };
    s.wx.wind = [0.03, 0.0];
    let steady = bends_for(&s, DAY, "12:34");
    let later = bends_for(&s, DAY + 3300.0, "12:34");
    assert!(steady.iter().zip(&later).all(|(a, b)| (a - b).abs() < 0.5), "lean alone does not flutter (the heading drifts a fraction of a degree as the sun moves): {steady:?} {later:?}");
    s.sway = "full".into();
    let (a, b) = (bends_for(&s, DAY, "12:34"), bends_for(&s, DAY + 3300.0, "12:34"));
    assert!(a != b, "gusts change from moment to moment");
    assert!(a.iter().zip(&b).all(|(x, y)| (x - y).abs() < 2.0 * 18.0 + 1e-9), "by no more than the gust size");
    assert!(a.windows(2).any(|w| (w[0] - w[1]).abs() > 1.0), "each digit has its own phase");
}

#[test]
fn bent_text_fits_its_rectangle() {
    let (x0, _, x1, _) = text_bbox_bent("12:34", W, H, 0.9, 80.0, 108.0);
    let (a0, _, a1, _) = text_bbox_bent("12:34", W, H, 0.9, 80.0, 0.0);
    assert!(x0 <= a0 && x1 >= a1 && (a0 - x0 > 0 || a0 == 0));
    let (f, origin, _) = field_text_bent("12:34", W, H, 0.9, &[90.0, 90.0, 90.0, 90.0]);
    assert!(origin.0 + f.w <= W && origin.1 + f.h <= H);
}

#[test]
fn snow_caps_the_tops_and_rain_beads_sit_on_the_glass() {
    let clear = render(&scene("glass", "clear"), DAY, "12:34", W, H);
    let snow = render(&scene("glass", "snow"), DAY, "12:34", W, H);
    let rain = render(&scene("glass", "rain"), DAY, "12:34", W, H);
    let off = render(&Scene { digit_weather: false, ..scene("glass", "snow") }, DAY, "12:34", W, H);
    // digitWeather off: the snow is in the sky only, never on the digits
    let (field, origin, _) = field_text_bent("12:34", W, H, 0.9, &[]);
    let inside = |x: usize, y: usize| x >= origin.0 && y >= origin.1 && x - origin.0 < field.w && y - origin.1 < field.h && field.any(x - origin.0, y - origin.1);
    let white = |f: &[u8], i: usize| f[i] > 235 && f[i + 1] > 235 && f[i + 2] > 235;
    let (mut caps, mut caps_off, mut caps_clear) = (0, 0, 0);
    for y in 0..H { for x in 0..W { if inside(x, y) { let i = (y * W + x) * 3; if white(&snow, i) { caps += 1; } if white(&off, i) { caps_off += 1; } if white(&clear, i) { caps_clear += 1; } } } }
    assert!(caps > caps_clear + 40 && caps > caps_off + 40, "snow settles on the digits: {caps} white pixels, {caps_off} with digitWeather off, {caps_clear} when clear");
    // beads: many small local changes inside the digits, compared with the same glass in clear weather
    let changed = (0..W * H).filter(|&i| inside(i % W, i / W) && (0..3).map(|k| (rain[i * 3 + k] as i32 - clear[i * 3 + k] as i32).abs()).sum::<i32>() > 30).count();
    assert!(changed > 60, "rain beads on the glass: {changed} pixels differ from the clear picture");
    // and it is the same picture for the same second
    assert!(render(&scene("glass", "rain"), DAY, "12:34", W, H) == rain);
}

#[test]
fn the_effect_amounts_are_bounded_and_apply_is_safe_on_an_empty_field() {
    let (field, origin, half) = field_text_bent("1", 64, 32, 0.9, &[]);
    let mut buf = vec![100.0f32; 64 * 32 * 3];
    apply(&mut buf, 64, &field, origin, half, Fx { snow: 1.0, rain: 1.0 }, 3);
    assert!(buf.iter().all(|v| (0.0..=255.5).contains(v)));
    let mut same = vec![100.0f32; 64 * 32 * 3];
    apply(&mut same, 64, &field, origin, half, NONE, 3);
    assert!(same.iter().all(|v| *v == 100.0));
}
