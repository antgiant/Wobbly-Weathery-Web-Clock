//! The sun disc: where the page puts it (measured), and that it is drawn.
use wobbly_core::disc::{sun_position, weight};
use wobbly_core::scene::{render, Scene};

// 2026-06-21 in New York: sunrise 09:25:04 UTC, sunset 00:30:38 UTC the next day (the astronomy library). The page, with the clock hidden and clear
// weather at 480 x 270, drew its sun disc at these places (tools/native-sky.mjs style sampling; the disc is a ~24 pixel blob, brightest pixels):
//   17.9 degrees up on the morning side: x 0.793, y 0.256     17.9 degrees up on the evening side: x 0.205, y 0.256
const RISE: f64 = 1_782_033_904_263.0;
const SET: f64 = 1_782_088_238_647.0;

#[test]
fn the_sun_is_where_the_page_draws_it() {
    let at = |frac: f64| RISE + frac * (SET - RISE);
    let (mx, my) = sun_position(at(0.12), 40.7, -74.0, 0.63).unwrap();
    assert!((mx - 0.793).abs() < 0.05 && (my - 0.256).abs() < 0.03, "morning: {mx}, {my}");
    let (ex, ey) = sun_position(at(0.88), 40.7, -74.0, 0.63).unwrap();
    assert!((ex - 0.205).abs() < 0.05 && (ey - 0.256).abs() < 0.03, "evening: {ex}, {ey}");
    let (rx, ry) = sun_position(at(0.001), 40.7, -74.0, 0.63).unwrap();
    assert!(rx > 0.8 && (ry - 0.63).abs() < 0.03, "sunrise is at the right-hand horizon: {rx}, {ry}");
    let (sx, sy) = sun_position(at(0.999), 40.7, -74.0, 0.63).unwrap();
    assert!(sx < 0.2 && (sy - 0.63).abs() < 0.03, "sunset is at the left-hand horizon: {sx}, {sy}");
}

#[test]
fn not_drawn_when_it_is_down_or_overhead() {
    assert!(sun_position(RISE - 3_600_000.0, 40.7, -74.0, 0.63).is_none(), "an hour before sunrise");
    assert!(sun_position(SET + 3_600_000.0, 40.7, -74.0, 0.63).is_none(), "an hour after sunset");
    assert!(sun_position((RISE + SET) / 2.0, 40.7, -74.0, 0.63).is_none(), "the sun is above the top of the picture at midday in June (73 degrees up)");
}

#[test]
fn the_disc_has_a_core_an_edge_and_a_glow() {
    assert_eq!(weight(0.0, 0.0, 3.0), 1.0);
    assert!(weight(3.4, 0.0, 3.0) > 0.0 && weight(3.4, 0.0, 3.0) < 1.0, "a soft edge");
    assert!(weight(10.0, 0.0, 3.0) > 0.0 && weight(10.0, 0.0, 3.0) < 0.3, "a faint glow");
    assert!(weight(200.0, 0.0, 3.0) < 1e-6, "nothing far away");
}

#[test]
fn the_picture_shows_the_sun_where_it_should_be() {
    let t = RISE + 0.12 * (SET - RISE);
    let (w, h) = (192usize, 108usize);
    let f = render(&Scene::default(), t, "", w, h);
    let (fx, fy) = sun_position(t, 40.7, -74.0, 0.63).unwrap();
    let (px, py) = ((fx * w as f64) as usize, (fy * h as f64) as usize);      // the pixel the disc is centred in
    let lum = |x: usize, y: usize| { let i = (y * w + x) * 3; f[i] as u32 + f[i + 1] as u32 + f[i + 2] as u32 };
    let core = lum(px, py);
    assert!(core > 650, "the disc should be nearly white warm: {core}");
    assert!(core > lum(px.saturating_sub(40), py) + 60, "and brighter than the sky beside it");
    assert!(lum(w / 2, h - 3) < core, "and nothing like it down on the ground");
}
