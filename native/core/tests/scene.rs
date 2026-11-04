//! The scene: noon is bright and blue-ish, midnight is dark, the night brightness setting dims, the time stays readable.
use wobbly_core::scene::{brightness, render, Scene};

const JUNE_NOON_NYC: f64 = 1_782_057_600_000.0;                                // 2026-06-21T16:00:00Z, just before local noon in New York
const JUNE_MIDNIGHT_NYC: f64 = 1_782_100_800_000.0;                            // 2026-06-22T04:00:00Z, local midnight

fn mean_lum(f: &[u8]) -> f64 { f.chunks(3).map(|p| 0.3 * p[0] as f64 + 0.59 * p[1] as f64 + 0.11 * p[2] as f64).sum::<f64>() / (f.len() / 3) as f64 }

#[test]
fn noon_is_brighter_than_midnight_and_sizes_are_right() {
    let s = Scene::default();
    let (noon, night) = (render(&s, JUNE_NOON_NYC, "12:00", 128, 64), render(&s, JUNE_MIDNIGHT_NYC, "12:00", 128, 64));
    assert_eq!(noon.len(), 128 * 64 * 3);
    assert!(mean_lum(&noon) > mean_lum(&night) + 40.0, "{} vs {}", mean_lum(&noon), mean_lum(&night));
}

#[test]
fn the_night_brightness_dims_the_night_but_not_the_day() {
    let s = Scene { brightness_night: 0.25, ..Scene::default() };
    assert!((brightness(&s, JUNE_NOON_NYC) - 1.0).abs() < 1e-9);
    assert!((brightness(&s, JUNE_MIDNIGHT_NYC) - 0.25).abs() < 1e-9);
    let (day_full, night_dim) = (render(&Scene::default(), JUNE_MIDNIGHT_NYC, "12:00", 64, 32), render(&s, JUNE_MIDNIGHT_NYC, "12:00", 64, 32));
    assert!(mean_lum(&night_dim) < mean_lum(&day_full) * 0.3 + 1.0);
}

#[test]
fn brightness_eases_through_sunset() {
    let s = Scene { brightness_night: 0.2, ..Scene::default() };
    // the sunset of 2026-06-21 in New York (00:30:38 UTC the next day, from the astronomy library); walk across it
    let sunset = 1_782_088_238_648.0;
    let before = brightness(&s, sunset - 60.0 * 60_000.0);
    let at = brightness(&s, sunset);
    let after = brightness(&s, sunset + 60.0 * 60_000.0);
    assert!(before > at && at > after, "{before} {at} {after}");
    assert!((before - 1.0).abs() < 1e-6 && (after - 0.2).abs() < 1e-6);
}

#[test]
fn the_time_stays_readable_at_every_sun_height() {
    use wobbly_core::scene::{contrast, legibility};
    use wobbly_core::sky::{at_row, colors_at};
    for alt in (-30..=70).step_by(2) {
        let c = colors_at(alt as f64);
        let (ink, halo) = legibility(&c, 0.63);
        let worst = (0..=12).map(|i| contrast(ink, at_row(&c, 15.0 + 60.0 * i as f64 / 12.0, 100.0, 0.63))).fold(f64::MAX, f64::min);
        // either the ink alone has contrast 3 to 1 everywhere the digits are, or a halo of the other ink is drawn behind it
        assert!(worst >= 3.0 || halo.is_some(), "sun at {alt} degrees: worst contrast {worst:.2}, no halo");
        if let Some(h) = halo { assert!(contrast(ink, h) > 8.0, "the halo must differ strongly from the ink"); }
    }
    // a bright sky above a dark ground (low sun) has no single good ink across the horizon, so it gets a halo; high sun and deep night do not
    assert!(legibility(&colors_at(60.0), 0.63).1.is_none() && legibility(&colors_at(-25.0), 0.63).1.is_none());
    assert!(legibility(&colors_at(5.0), 0.63).1.is_some());
    assert!(contrast([0.0; 3], [255.0; 3]) > 20.0 && (contrast([9.0; 3], [9.0; 3]) - 1.0).abs() < 1e-9);
}

#[test]
fn a_halo_is_drawn_when_needed() {
    // the sun about 6 degrees down in New York in the evening: 2026-06-22T01:05:00Z
    let t = 1782090300000.0;
    let alt = wobbly_core::sun::altitude(t, 40.7, -74.0);
    assert!(alt < -3.0 && alt > -9.0, "the moment should be twilight, the sun is at {alt}");
    assert!(wobbly_core::scene::legibility(&wobbly_core::sky::colors_at(alt), 0.63).1.is_some());
    let s = Scene { brightness_night: 1.0, ..Scene::default() };
    let f = render(&s, t, "12:34", 128, 64);
    let navy = f.chunks(3).filter(|p| (p[2] as i32) > (p[0] as i32) + 20 && p[0] < 80 && p[1] < 80 && p[2] < 140).count();
    let white = f.chunks(3).filter(|p| p[0] > 235 && p[1] > 235 && p[2] > 235).count();
    assert!(white > 100 && navy > 100, "white {white}, navy {navy}");
}
