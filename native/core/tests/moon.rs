//! The moon on the picture: where the page draws it (measured), the phase, and that it is drawn.
use wobbly_core::disc::moon_position;
use wobbly_core::moon::{disc, illumination, position};
use wobbly_core::scene::{render, Scene};

// 2026-11-18T02:00:00Z, New York: the astronomy library puts the moon 27.0 degrees up at bearing 224.5, 56% lit; the page, with the clock hidden at 640 x 360,
// drew it at x 0.634, y 0.108 (the brightest small blob in the sky).
const NOV18: f64 = 1_794_967_200_000.0;

#[test]
fn the_moon_is_where_the_page_draws_it() {
    let (alt, az) = position(NOV18, 40.7, -74.0);
    assert!((alt - 27.0).abs() < 0.6 && (az - 224.5).abs() < 1.0, "{alt} {az}");
    assert!((illumination(NOV18) - 0.56).abs() < 0.02);
    let (x, y, _, k) = moon_position(NOV18, 40.7, -74.0, 0.63, 16.0 / 9.0).expect("the moon is in the picture");
    assert!((x - 0.635).abs() < 0.08 && (y - 0.107).abs() < 0.06, "predicted {x:.3}, {y:.3} against the page's 0.635, 0.107");
    assert!((k - 0.56).abs() < 0.02);
    // an hour later (alt 18.6, bearing 237.2) the page drew it at x 0.944, y 0.174: the camera has turned back a little during the night
    let (x2, y2, _, _) = moon_position(NOV18 + 3_600_000.0, 40.7, -74.0, 0.63, 16.0 / 9.0).expect("still in the picture, near the right edge");
    assert!((x2 - 0.944).abs() < 0.09 && (y2 - 0.174).abs() < 0.06, "predicted {x2:.3}, {y2:.3} against the page's 0.944, 0.174");
}

#[test]
fn below_the_horizon_or_off_the_side_there_is_no_moon_on_the_picture() {
    // 2026-11-18T14:00Z: the moon has set for New York (it is about 10 hours after the 02:00 position)
    let t = NOV18 + 12.0 * 3_600_000.0;
    let (alt, _) = position(t, 40.7, -74.0);
    assert!(alt < 0.0, "{alt}");
    assert!(moon_position(t, 40.7, -74.0, 0.63, 16.0 / 9.0).is_none());
}

#[test]
fn the_phase_lights_the_right_side() {
    // a moon of radius 20 whose bright side faces right (+x on the screen), at several phases
    let lit = |k: f64, dx: f64| disc(dx, 0.0, 20.0, 1.0, 0.0, k).1;
    assert!(lit(1.0, -15.0) > 0.9 && lit(1.0, 15.0) > 0.9, "full: both sides lit");
    assert!(lit(0.0, -15.0) < 0.2 && lit(0.0, 15.0) < 0.2, "new: dark (only earthshine)");
    assert!(lit(0.5, 15.0) > 0.8 && lit(0.5, -15.0) < 0.2, "half: the sun side only");
    assert!(lit(0.2, 17.0) > lit(0.2, -17.0) + 0.3, "a crescent: lit on the sun side");
    assert!(lit(0.8, -10.0) > 0.6, "gibbous: most of it lit, even a little to the dark side");
    assert_eq!(disc(40.0, 0.0, 20.0, 1.0, 0.0, 1.0), (0.0, 0.0), "nothing outside the disc");
    let up = disc(0.0, -15.0, 20.0, 0.0, -1.0, 0.5).1;
    assert!(up > 0.8 && disc(0.0, 15.0, 20.0, 0.0, -1.0, 0.5).1 < 0.2, "the bright side can face up: {up}");
}

#[test]
fn the_picture_shows_the_moon() {
    let (w, h) = (320usize, 180usize);
    let sc = Scene { ..Scene::default() };
    let f = render(&sc, NOV18, "", w, h);
    let (x, y, _, _) = moon_position(NOV18, 40.7, -74.0, 0.63, w as f64 / h as f64).unwrap();
    let (px, py) = ((x * w as f64) as usize, (y * h as f64) as usize);
    let lum = |xx: usize, yy: usize| { let i = (yy * w + xx) * 3; f[i] as u32 + f[i + 1] as u32 + f[i + 2] as u32 };
    let best = (py.saturating_sub(3)..=(py + 3).min(h - 1)).flat_map(|yy| (px.saturating_sub(3)..=(px + 3).min(w - 1)).map(move |xx| (xx, yy))).map(|(xx, yy)| lum(xx, yy)).max().unwrap();
    assert!(best > 560, "the moon should be a bright disc where it is predicted: {best}");
    assert!(lum(w / 2, 3) < best - 100, "against the dark sky");
}
