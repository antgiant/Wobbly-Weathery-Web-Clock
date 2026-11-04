//! Whole frames: the right size, the background at the corners, the time in the middle, and the same at LED and HDMI sizes.
use wobbly_core::frame::{fit, pieces, ppm, render};

const TOP: [u8; 3] = [10, 20, 30];
const BOTTOM: [u8; 3] = [200, 100, 50];
const INK: [u8; 3] = [255, 255, 255];

#[test]
fn pieces_are_digits_and_colons() {
    assert_eq!(pieces("12:05"), vec![Some(1), Some(2), None, Some(0), Some(5)]);
    assert_eq!(pieces("7:00:09").len(), 7);
}

#[test]
fn frames_have_the_right_size_and_background_corners() {
    for (w, h) in [(64usize, 32usize), (128, 64), (192, 64), (1920, 1080), (480, 800)] {
        let f = render("12:34", w, h, TOP, BOTTOM, INK, 1.0);
        assert_eq!(f.len(), w * h * 3, "{w}x{h}");
        assert_eq!(&f[0..3], &TOP, "{w}x{h} top-left");
        let last = (w * h - 1) * 3;
        assert_eq!(&f[last..last + 3], &BOTTOM, "{w}x{h} bottom-right");
        let lit = f.chunks(3).filter(|p| p[0] > 230 && p[1] > 230 && p[2] > 230).count();
        assert!(lit as f64 > (w * h) as f64 * 0.02, "{w}x{h}: only {lit} lit pixels");
        assert!((lit as f64) < (w * h) as f64 * 0.5, "{w}x{h}: too many lit pixels ({lit})");
    }
}

#[test]
fn the_time_fits_and_is_centred() {
    for text in ["1:23", "12:34", "12:34:56", "00:00"] {
        for (w, h) in [(64usize, 32usize), (1920, 1080), (400, 900)] {
            let (scale, left, top) = fit(text, w, h, 0.9);
            assert!(scale > 0.0 && left >= 0.0 && left < w as f64 * 0.5, "{text} {w}x{h}: left {left}");
            let f = render(text, w, h, [0, 0, 0], [0, 0, 0], INK, 1.0);
            let (mut minx, mut maxx) = (w, 0);
            for y in 0..h { for x in 0..w { if f[(y * w + x) * 3] > 128 { minx = minx.min(x); maxx = maxx.max(x); } } }
            assert!(minx <= maxx, "{text} {w}x{h}: nothing drawn");
            let margin_l = minx as f64; let margin_r = (w - 1 - maxx) as f64;
            assert!((margin_l - margin_r).abs() < w as f64 * 0.08 + 2.0, "{text} {w}x{h}: not centred ({margin_l} vs {margin_r}; top {top})");
        }
    }
}

#[test]
fn brightness_dims_everything_and_ppm_has_a_header() {
    let full = render("12:34", 64, 32, TOP, BOTTOM, INK, 1.0);
    let dim = render("12:34", 64, 32, TOP, BOTTOM, INK, 0.25);
    assert!(dim.iter().zip(&full).all(|(d, f)| (*d as f64 - *f as f64 * 0.25).abs() <= 1.0));
    let p = ppm(&full, 64, 32);
    assert!(p.starts_with(b"P6\n64 32\n255\n") && p.len() == 13 + full.len());
}
