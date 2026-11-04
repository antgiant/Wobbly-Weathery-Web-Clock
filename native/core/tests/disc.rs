//! The sun disc: where the page puts it (measured), and that it is drawn.
use wobbly_core::disc::{sun_position, sun_position_in, weight};
use wobbly_core::scene::{render, Scene};

// 2026-06-21 in New York: sunrise 09:25:04 UTC, sunset 00:30:38 UTC the next day (the astronomy library). The page keeps the sun a quarter of the way in from the
// right at sunrise and from the left at sunset, following its real bearing (js/sky/sunpath.js screenX): in June the sun rises well to the north of east, so it
// starts near x 0.84 and ends near 0.16.
const RISE: f64 = 1_782_033_904_263.0;
const SET: f64 = 1_782_088_238_647.0;

#[test]
fn the_sun_travels_right_to_left_by_the_pages_rule() {
    let at = |frac: f64| RISE + frac * (SET - RISE);
    let x = |frac: f64| sun_position(at(frac), 40.7, -74.0, 0.63).map(|p| p.0);
    let (rise, set) = (x(0.002).unwrap(), x(0.998).unwrap());
    assert!((rise - 0.84).abs() < 0.04 && (set - 0.16).abs() < 0.04, "sunrise {rise:.3}, sunset {set:.3}");
    let path: Vec<f64> = [0.002, 0.05, 0.12, 0.2, 0.3].iter().filter_map(|f| x(*f)).collect();
    assert!(path.len() >= 3 && path.windows(2).all(|w| w[1] < w[0]), "it moves steadily to the left: {path:?}");
    let (_, y_rise) = sun_position(at(0.002), 40.7, -74.0, 0.63).unwrap();
    assert!((y_rise - 0.63).abs() < 0.03, "at the horizon at sunrise: {y_rise}");
    let (_, y_up) = sun_position(at(0.12), 40.7, -74.0, 0.63).unwrap();
    assert!(y_up < 0.4 && y_up > 0.1, "about 18 degrees up is well above the horizon: {y_up}");
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
    let (fx, fy) = sun_position_in(t, 40.7, -74.0, 0.63, w as f64 / h as f64).unwrap();
    let (px, py) = ((fx * w as f64) as usize, (fy * h as f64) as usize);      // the pixel the disc is centred in
    let lum = |x: usize, y: usize| { let i = (y * w + x) * 3; f[i] as u32 + f[i + 1] as u32 + f[i + 2] as u32 };
    let core = lum(px, py);
    assert!(core > 650, "the disc should be nearly white warm: {core}");
    assert!(core > lum(px.saturating_sub(40), py) + 60, "and brighter than the sky beside it");
    assert!(lum(w / 2, h - 3) < core, "and nothing like it down on the ground");
}
