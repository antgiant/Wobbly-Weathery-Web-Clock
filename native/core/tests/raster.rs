//! The rasteriser draws sensible digits: inside their box, the right weight, one stroke wide, and they morph.
use wobbly_core::morph::{digit, morph};
use wobbly_core::raster::{draw_digit, Coverage};

fn drawn(n: usize, scale: f64) -> Coverage {
    // the page's digit box: viewBox 0 -8 100 116 at scale 0.2 is digit space x 0..500, y -40..580
    let (w, h) = ((500.0 * scale) as usize + 4, (620.0 * scale) as usize + 4);
    let mut c = Coverage::new(w, h);
    draw_digit(&mut c, digit(n), 2.0, 2.0 + 40.0 * scale, scale);
    c
}

#[test]
fn every_digit_is_drawn_inside_its_box_with_some_weight() {
    for n in 0..10 {
        let c = drawn(n, 0.2);
        let s = c.sum();
        assert!(s > 150.0 && s < 0.6 * (c.w * c.h) as f32, "digit {n}: coverage {s}");
        for x in 0..c.w { assert!(c.at(x, 0) == 0.0 && c.at(x, c.h - 1) == 0.0, "digit {n} touches the top or bottom edge"); }
    }
}

#[test]
fn a_one_is_lighter_than_an_eight_and_edges_are_soft() {
    let (one, eight) = (drawn(1, 0.2).sum(), drawn(8, 0.2).sum());
    assert!(one < eight, "1: {one}, 8: {eight}");
    let c = drawn(8, 0.2);
    assert!(c.data.iter().any(|v| *v > 0.0 && *v < 1.0), "no anti-aliased edge pixels");
    assert!(c.data.iter().any(|v| *v == 1.0), "no solid pixels");
}

#[test]
fn the_stroke_is_80_wide_at_any_scale() {
    // digit 1 is nearly a vertical bar: a horizontal slice through its middle should be about 80 * scale wide
    for scale in [0.1, 0.2, 0.4] {
        let c = drawn(1, scale);
        let y = ((300.0 + 40.0) * scale) as usize;
        let width: f32 = (0..c.w).map(|x| c.at(x, y)).sum();
        let want = (80.0 * scale) as f32;
        assert!((width - want).abs() < want * 0.35 + 1.5, "scale {scale}: slice {width}, want about {want}");
    }
}

#[test]
fn a_morph_goes_from_one_digit_to_the_other() {
    let (a, b) = (digit(2), digit(3));
    assert_eq!(morph(a, b, 0.0, 15.0), *a);
    let end = morph(a, b, 15.0, 15.0);
    for i in 0..26 { assert!((end[i] - b[i]).abs() < 1e-9); }
    let mut mid = Coverage::new(120, 120);
    draw_digit(&mut mid, &morph(a, b, 7.0, 15.0), 2.0, 2.0, 0.2);
    assert!(mid.sum() > 100.0);
}
