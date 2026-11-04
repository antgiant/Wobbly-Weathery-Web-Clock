//! The landscape: the colour of the ground (baked from the page, `landtable.rs`) and the silhouette on the horizon (hills, snow-capped mountains, a city's
//! blocks, low dunes), drawn procedurally from seeded noise so the same place looks the same every time. The heights were read off the page's pictures.
//! "auto" (the page picks real terrain from elevation data) is flat here: the native program has no terrain data.

use crate::landtable::GROUND;

pub fn known(name: &str) -> bool { GROUND.iter().any(|(n, _, _)| *n == name) }

fn smooth(a: f64, b: f64, x: f64) -> f64 { let t = ((x - a) / (b - a)).clamp(0.0, 1.0); t * t * (3.0 - 2.0 * t) }

fn hash(i: i64, seed: u64) -> f64 {
    let mut z = (i as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ seed.wrapping_mul(0xC2B2_AE3D_27D4_EB4F);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
}

/// Smooth value noise, 0..1, with `x` in noise units (one new random value per unit).
fn vnoise(x: f64, seed: u64) -> f64 {
    let i = x.floor();
    let (a, b) = (hash(i as i64, seed), hash(i as i64 + 1, seed));
    let t = x - i;
    a + (b - a) * (t * t * (3.0 - 2.0 * t))
}

/// The multiplier of the flat ground's colour for a landscape, by how much daylight there is (0 night, 1 day).
pub fn ground_mult(name: &str, daylight: f64) -> [f64; 3] {
    let (_, day, night) = GROUND.iter().find(|(n, _, _)| *n == name).unwrap_or(&GROUND[0]);
    [0, 1, 2].map(|c| night[c] + (day[c] - night[c]) * daylight)
}

/// The silhouette at horizontal position `x` (0..1 across the picture): its height as a fraction of the picture's height above the horizon, and how much of
/// the top of it is snow (0..1 of its height). `name` is the landscape.
pub fn profile(name: &str, x: f64) -> (f64, f64) {
    match name {
        "hills" => (0.022 + 0.045 * (0.7 * vnoise(x * 3.0, 11) + 0.3 * vnoise(x * 8.0 + 3.0, 12)), 0.0),
        "mountains" => {
            let ridge = vnoise(x * 2.4, 21);
            let sharp = 1.0 - (2.0 * vnoise(x * 5.0 + 9.0, 22) - 1.0).abs();            // peaks rather than bumps
            let h = 0.09 + 0.17 * (0.55 * ridge + 0.45 * sharp * ridge) + 0.03 * vnoise(x * 17.0, 23);
            (h, 0.12 + 0.4 * smooth(0.14, 0.3, h))
        }
        "desert" => (0.006 + 0.01 * vnoise(x * 2.0, 31), 0.0),
        "city" => {
            // blocks: each a slice of the width with its own height; most low, a few tall
            let cell = (x * 38.0).floor();
            let (w_roll, h_roll) = (hash(cell as i64, 41), hash(cell as i64, 42));
            let tall = if hash(cell as i64, 43) > 0.9 { 0.07 } else { 0.0 };
            if w_roll < 0.12 { (0.0, 0.0) } else { (0.012 + 0.05 * h_roll * h_roll + tall, 0.0) }
        }
        _ => (0.0, 0.0),
    }
}

/// How rough the water is at a point of the sea: a brightness factor around 1, by position in the picture (`x` across, `depth` 0 at the horizon to 1 at the
/// bottom). Waves are long and thin near the horizon and broad near the viewer.
pub fn wave(x: f64, depth: f64, t_secs: f64) -> f64 {
    let d = depth.max(0.02);
    let (u, v) = (x * 6.0 / d.sqrt() + t_secs * 0.05, d * 40.0 * (1.0 + d) + t_secs * 0.2);
    1.0 + 0.22 * (vnoise(u, 51) * vnoise(v, 52) - 0.25) * 2.0 * d.sqrt() + 0.08 * (vnoise(u * 2.3 + 7.0, 53) - 0.5)
}
