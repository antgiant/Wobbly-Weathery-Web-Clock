//! A deterministic star field: the same stars every night and on every machine (so frames can be compared), fading in as the sky darkens.
//! Stars are single pixels of varying brightness, a few per thousand pixels so that an LED panel does not look noisy.

/// A small hash to a float in 0..1 (SplitMix-style), from a seed and an index.
fn unit(seed: u64, i: u64) -> f64 {
    let mut z = seed.wrapping_add(i.wrapping_mul(0x9E37_79B9_7F4A_7C15));
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
}

fn smooth(a: f64, b: f64, x: f64) -> f64 { let t = ((x - a) / (b - a)).clamp(0.0, 1.0); t * t * (3.0 - 2.0 * t) }

/// How visible stars are for a sun height: none by day and in twilight, all of them in the dark (astronomical night is below -18; they start to
/// come out around -6).
pub fn visibility(alt: f64) -> f64 { 1.0 - smooth(-18.0, -6.0, alt) }

/// One star: where (pixel), and how bright (0..1) at most.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Star { pub x: usize, pub y: usize, pub brightness: f64 }

/// The stars for a picture `w` x `h` whose sky fills the top `sky_height` pixels: about 4 per thousand pixels, brighter ones rarer.
pub fn field(w: usize, h: usize, sky_height: usize) -> Vec<Star> {
    let _ = h;
    let n = (w * sky_height) as f64 * 0.004;
    (0..n.round() as u64).map(|i| {
        let (x, y) = ((unit(1, i) * w as f64) as usize, (unit(2, i) * sky_height as f64) as usize);
        let m = unit(3, i);
        Star { x: x.min(w - 1), y: y.min(sky_height.saturating_sub(1)), brightness: (0.55 + 0.45 * m * m * m).min(1.0) }
    }).collect()
}
