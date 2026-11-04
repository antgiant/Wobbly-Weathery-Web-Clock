//! Gamma, panel brightness and framebuffer bytes.
use wobbly_core::output::*;

#[test]
fn gamma_is_a_monotone_curve_with_fixed_ends() {
    let t = gamma_table(2.2);
    assert_eq!((t[0], t[255]), (0, 255));
    assert!(t.windows(2).all(|w| w[0] <= w[1]));
    assert!(t[128] < 70 && t[128] > 50, "mid grey should land near 56: {}", t[128]);
    assert_eq!(gamma_table(1.0)[77], 77);
    let mut px = [0u8, 128, 255]; apply_gamma(&mut px, &t); assert_eq!(px, [0, t[128], 255]);
}

#[test]
fn panel_brightness_is_a_percentage_never_zero() {
    assert_eq!((hardware_brightness(1.0), hardware_brightness(0.25), hardware_brightness(0.1), hardware_brightness(0.0)), (100, 25, 10, 1));
}

#[test]
fn framebuffer_bytes_for_each_depth() {
    let rgb = [10u8, 20, 30, 200, 100, 50];                                     // two pixels in a row
    let f32 = to_framebuffer(&rgb, &FbFormat { width: 2, height: 1, bits_per_pixel: 32, stride: 8 }).unwrap();
    assert_eq!(f32, vec![30, 20, 10, 0, 50, 100, 200, 0]);
    let f24 = to_framebuffer(&rgb, &FbFormat { width: 2, height: 1, bits_per_pixel: 24, stride: 6 }).unwrap();
    assert_eq!(f24, vec![30, 20, 10, 50, 100, 200]);
    let f16 = to_framebuffer(&[255, 255, 255, 255, 0, 0], &FbFormat { width: 2, height: 1, bits_per_pixel: 16, stride: 4 }).unwrap();
    assert_eq!(f16, vec![0xff, 0xff, 0x00, 0xf8]);                              // white, then pure red (0xF800) little endian
}

#[test]
fn the_stride_pads_rows_and_bad_input_is_refused() {
    let rgb = vec![1u8; 2 * 2 * 3];
    let out = to_framebuffer(&rgb, &FbFormat { width: 2, height: 2, bits_per_pixel: 32, stride: 12 }).unwrap();
    assert_eq!(out.len(), 24);
    assert_eq!(&out[8..12], &[0, 0, 0, 0], "padding stays zero");
    assert!(to_framebuffer(&rgb, &FbFormat { width: 2, height: 2, bits_per_pixel: 8, stride: 2 }).is_err());
    assert!(to_framebuffer(&rgb, &FbFormat { width: 3, height: 2, bits_per_pixel: 32, stride: 12 }).is_err());
    assert!(to_framebuffer(&rgb, &FbFormat { width: 2, height: 2, bits_per_pixel: 32, stride: 4 }).is_err());
    assert_eq!(parse_virtual_size("1920,1080\n"), Some((1920, 1080)));
    assert_eq!(parse_virtual_size("nonsense"), None);
}

#[test]
fn enlarging_keeps_size_colour_and_corners() {
    let small = vec![10u8, 20, 30, 200, 100, 50, 90, 80, 70, 1, 2, 3];       // 2 x 2
    let big = upscale(&small, 2, 2, 6, 6);
    assert_eq!(big.len(), 6 * 6 * 3);
    assert_eq!(&big[0..3], &[10, 20, 30], "the top-left corner is the top-left pixel");
    assert_eq!(&big[(5 * 6 + 5) * 3..(5 * 6 + 5) * 3 + 3], &[1, 2, 3], "and the bottom-right corner is the bottom-right pixel");
    assert_eq!(upscale(&small, 2, 2, 2, 2), small, "no change at the same size");
    let flat = vec![77u8; 4 * 4 * 3];
    assert!(upscale(&flat, 4, 4, 16, 9).iter().all(|v| *v == 77), "a flat picture stays flat");
    let mid = &big[(3 * 6 + 2) * 3..(3 * 6 + 2) * 3 + 3];
    assert!(mid[0] > 1 && mid[0] < 200, "between the corners the colours blend: {mid:?}");
}

#[test]
fn the_render_size_follows_how_long_a_frame_takes() {
    assert_eq!(next_scale(1, 0.2, 0.4, 1), 1, "fast enough: stay");
    assert_eq!(next_scale(1, 0.8, 0.4, 1), 2, "twice too slow: half size gives a quarter of the work");
    assert_eq!(next_scale(1, 4.0, 0.4, 1), 4, "ten times too slow: a quarter size is 1/16 of the work, so 4");
    assert!(next_scale(1, 400.0, 0.4, 1) <= 8, "never smaller than an eighth");
    assert_eq!(next_scale(2, 0.5, 0.4, 1), 3, "already at 2 and still slow: go on");
    assert_eq!(next_scale(1, 0.01, 0.4, 3), 3, "the user's minimum wins");
    assert_eq!(scaled_size(1920, 1080, 4), (480, 270));
    assert_eq!(scaled_size(40, 30, 8), (32, 18), "never absurdly small");
}
