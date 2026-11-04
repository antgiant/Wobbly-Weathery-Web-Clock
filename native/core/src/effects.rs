//! Weather on the digits: snow settling on the surfaces that face up, and rain beads sitting on the glass. The page runs a drop simulation; this is the
//! still picture of it for each second: snow capped by the tube's normal, and beads placed with a seeded random number generator (so frames compare).

use crate::raster::Field;
use crate::weather::Weather;

/// How much snow and rain the digits wear, each 0..1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fx { pub snow: f64, pub rain: f64 }

pub const NONE: Fx = Fx { snow: 0.0, rain: 0.0 };

fn clamp01(x: f64) -> f64 { x.clamp(0.0, 1.0) }

/// What the weather puts on the digits: caps of snow while it snows, beads of water while it rains.
pub fn for_weather(w: &Weather) -> Fx {
    if w.precip <= 0.05 { return NONE; }
    if w.snowfall > 0.5 { Fx { snow: clamp01(w.precip * 1.8), rain: 0.0 } } else { Fx { snow: 0.0, rain: clamp01(w.precip * 1.2) } }
}

fn smooth(a: f64, b: f64, x: f64) -> f64 { let t = ((x - a) / (b - a)).clamp(0.0, 1.0); t * t * (3.0 - 2.0 * t) }

/// A small hash to 0..1 from two integers.
fn hash(a: u64, b: u64) -> f64 {
    let mut z = a.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ b.wrapping_mul(0xC2B2_AE3D_27D4_EB4F);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
}

/// Draw the weather onto `out` (float RGB, `w` x `h`) over the digits of `field` (its rectangle starts at `origin`). `seed` changes the beads (it is the
/// time in seconds divided by a few: the beads settle and change slowly).
pub fn apply(out: &mut [f32], w: usize, field: &Field, origin: (usize, usize), half: f64, fx: Fx, seed: u64) {
    if fx.snow <= 0.0 && fx.rain <= 0.0 { return; }
    let (ox, oy) = origin;
    let blend = |out: &mut [f32], x: usize, y: usize, col: [f64; 3], a: f64| {
        let o = ((y + oy) * w + x + ox) * 3;
        for c in 0..3 { out[o + c] = (out[o + c] as f64 * (1.0 - a) + col[c] * a) as f32; }
    };
    if fx.snow > 0.0 {
        for y in 0..field.h { for x in 0..field.w {
            if !field.any(x, y) { continue; }
            let cov = field.coverage(x, y, half);
            if cov <= 0.0 { continue; }
            let i = y * field.w + x;
            let r = (field.dist[i] as f64 / half).min(1.0);
            let up = -(field.uy[i] as f64) * r;                       // how much this part of the tube faces up
            let lumpy = 0.7 + 0.3 * hash(((x + ox) / 3) as u64, ((y + oy) / 3) as u64 ^ 77);
            let cap = smooth(0.08, 0.45, up * lumpy + 0.12 * (lumpy - 0.85)) * fx.snow.sqrt();
            if cap > 0.0 { let shade = 0.88 + 0.12 * (1.0 - r * r).max(0.0).sqrt(); blend(out, x, y, [250.0 * shade, 252.0 * shade, 255.0 * shade], cap * cov); }
        } }
    }
    if fx.rain > 0.0 {
        let inside: usize = field.dist.iter().filter(|d| **d <= (half * 0.6) as f32).count();
        let rb = (0.24 * half).max(1.0);
        let n = (fx.rain * inside as f64 / (std::f64::consts::PI * rb * rb * 14.0)) as usize;
        let mut placed = 0usize;
        let mut k = 0u64;
        while placed < n && k < (n as u64 + 1) * 8 {
            let (bx, by) = ((hash(seed, k * 3) * field.w as f64) as usize, (hash(seed, k * 3 + 1) * field.h as f64) as usize);
            let r = rb * (0.7 + 0.6 * hash(seed, k * 3 + 2));
            k += 1;
            if bx >= field.w || by >= field.h || !field.any(bx, by) || field.dist[by * field.w + bx] as f64 > half * 0.62 { continue; }
            placed += 1;
            for yy in (by as f64 - r - 1.0).floor().max(0.0) as usize..((by as f64 + r + 1.0).ceil() as usize).min(field.h) {
                for xx in (bx as f64 - r - 1.0).floor().max(0.0) as usize..((bx as f64 + r + 1.0).ceil() as usize).min(field.w) {
                    let (dx, dy) = (xx as f64 + 0.5 - bx as f64, yy as f64 + 0.5 - by as f64);
                    let d = (dx * dx + dy * dy).sqrt();
                    let edge = (r + 0.5 - d).clamp(0.0, 1.0);
                    if edge <= 0.0 || !field.any(xx, yy) { continue; }
                    let o = ((yy + oy) * w + xx + ox) * 3;
                    let (u, v) = (dx / r, dy / r);
                    let lens = 1.0 - (u * u + v * v);                                   // brighter toward the middle of the bead
                    let spec = if u + v < -0.55 && d < 0.65 * r { 0.55 } else { 0.0 };    // the highlight, upper left
                    let rim = if d > 0.62 * r && u + v > 0.2 { 0.35 } else { 0.0 };       // the shadow side, lower right
                    for c in 0..3 {
                        let base = out[o + c] as f64;
                        let lit = base + (255.0 - base) * (0.16 * lens + spec);
                        let val = lit * (1.0 - rim);
                        out[o + c] = (base * (1.0 - edge) + val * edge) as f32;
                    }
                }
            }
        }
    }
}
