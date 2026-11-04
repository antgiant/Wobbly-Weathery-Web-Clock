//! Drawing a digit: its four Bezier curves, flattened and stroked with round caps and joins, as coverage 0..1 on a grid. This is what the
//! HDMI and LED outputs colour (with the sky behind). It is a plain software rasteriser: small, exact enough for a clock, and light on a Pi Zero.

use crate::digits::{POINTS, STROKE};

/// A coverage buffer, `w` x `h`, values 0..1.
pub struct Coverage { pub w: usize, pub h: usize, pub data: Vec<f32> }

impl Coverage {
    pub fn new(w: usize, h: usize) -> Self { Coverage { w, h, data: vec![0.0; w * h] } }
    pub fn at(&self, x: usize, y: usize) -> f32 { self.data[y * self.w + x] }
    pub fn sum(&self) -> f32 { self.data.iter().sum() }
}

fn cubic(p: [(f64, f64); 4], t: f64) -> (f64, f64) {
    let u = 1.0 - t;
    let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
    (a * p[0].0 + b * p[1].0 + c * p[2].0 + d * p[3].0, a * p[0].1 + b * p[1].1 + c * p[2].1 + d * p[3].1)
}

/// The digit's curves as one polyline in digit space (about 400 x 500).
pub fn flatten(d: &[f64; POINTS], per_curve: usize) -> Vec<(f64, f64)> {
    let mut pts = vec![(d[0], d[1])];
    for c in 0..4 {
        let k = 2 + c * 6;
        let start = if c == 0 { (d[0], d[1]) } else { (d[k - 2], d[k - 1]) };
        let seg = [start, (d[k], d[k + 1]), (d[k + 2], d[k + 3]), (d[k + 4], d[k + 5])];
        for i in 1..=per_curve { pts.push(cubic(seg, i as f64 / per_curve as f64)); }
    }
    pts
}

fn dist_to_segment(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let len2 = dx * dx + dy * dy;
    let t = if len2 == 0.0 { 0.0 } else { (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / len2).clamp(0.0, 1.0) };
    let (cx, cy) = (a.0 + t * dx, a.1 + t * dy);
    ((p.0 - cx).powi(2) + (p.1 - cy).powi(2)).sqrt()
}

/// Add the digit to `cov`: digit space is scaled by `scale` and moved by (`x0`, `y0`) pixels; the stroke is `STROKE * scale` wide.
/// Edges are anti-aliased over one pixel. Coverage of overlapping strokes is the larger of the two, never more than 1.
pub fn draw_digit(cov: &mut Coverage, d: &[f64; POINTS], x0: f64, y0: f64, scale: f64) {
    draw_digit_stroked(cov, d, x0, y0, scale, STROKE);
}

/// The same with a chosen stroke width in digit space (a halo is the digit drawn wider).
pub fn draw_digit_stroked(cov: &mut Coverage, d: &[f64; POINTS], x0: f64, y0: f64, scale: f64, stroke: f64) {
    let pts: Vec<(f64, f64)> = flatten(d, 24).into_iter().map(|(x, y)| (x0 + x * scale, y0 + y * scale)).collect();
    let half = stroke * scale / 2.0;
    // Each short segment only touches the pixels near it, so loop over its own box, not the whole digit's: the coverage at a pixel is the
    // largest over the segments, which is the same as using the nearest one.
    for w in pts.windows(2) {
        let (a, b) = (w[0], w[1]);
        let reach = half + 1.0;
        let xa = (a.0.min(b.0) - reach).floor().max(0.0) as usize;
        let xb = ((a.0.max(b.0) + reach).ceil().min(cov.w as f64)).max(0.0) as usize;
        let ya = (a.1.min(b.1) - reach).floor().max(0.0) as usize;
        let yb = ((a.1.max(b.1) + reach).ceil().min(cov.h as f64)).max(0.0) as usize;
        for y in ya..yb {
            for x in xa..xb {
                let d = dist_to_segment((x as f64 + 0.5, y as f64 + 0.5), a, b);
                let c = (half + 0.5 - d).clamp(0.0, 1.0) as f32;
                let i = y * cov.w + x;
                if c > cov.data[i] { cov.data[i] = c; }
            }
        }
    }
}

/// For every pixel near a stroke: the distance to the stroke's centreline and the direction (unit vector) from the nearest centreline point to the pixel.
/// This is what a tube needs: the distance says how far across the tube the pixel is, the direction which way its surface faces.
pub struct Field { pub w: usize, pub h: usize, pub dist: Vec<f32>, pub ux: Vec<f32>, pub uy: Vec<f32> }

impl Field {
    pub fn new(w: usize, h: usize) -> Self { Field { w, h, dist: vec![f32::MAX; w * h], ux: vec![0.0; w * h], uy: vec![0.0; w * h] } }

    fn offer(&mut self, x: usize, y: usize, d: f64, ux: f64, uy: f64) {
        let i = y * self.w + x;
        if (d as f32) < self.dist[i] { self.dist[i] = d as f32; self.ux[i] = ux as f32; self.uy[i] = uy as f32; }
    }

    /// Coverage 0..1 of a stroke of `half` pixels each side, anti-aliased over one pixel.
    pub fn coverage(&self, x: usize, y: usize, half: f64) -> f64 { (half + 0.5 - self.dist[y * self.w + x] as f64).clamp(0.0, 1.0) }
    pub fn any(&self, x: usize, y: usize) -> bool { self.dist[y * self.w + x] != f32::MAX }
}

fn nearest_on_segment(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> ((f64, f64), f64) {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let len2 = dx * dx + dy * dy;
    let t = if len2 == 0.0 { 0.0 } else { (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / len2).clamp(0.0, 1.0) };
    let c = (a.0 + t * dx, a.1 + t * dy);
    (c, ((p.0 - c.0).powi(2) + (p.1 - c.1).powi(2)).sqrt())
}

/// Add a digit's strokes to a field (`reach` pixels around each segment are looked at: use at least half the stroke width plus a pixel).
pub fn field_digit(f: &mut Field, d: &[f64; POINTS], x0: f64, y0: f64, scale: f64, reach: f64) {
    let pts: Vec<(f64, f64)> = flatten(d, 24).into_iter().map(|(x, y)| (x0 + x * scale, y0 + y * scale)).collect();
    for w in pts.windows(2) {
        let (a, b) = (w[0], w[1]);
        let xa = (a.0.min(b.0) - reach).floor().max(0.0) as usize;
        let xb = ((a.0.max(b.0) + reach).ceil().min(f.w as f64)).max(0.0) as usize;
        let ya = (a.1.min(b.1) - reach).floor().max(0.0) as usize;
        let yb = ((a.1.max(b.1) + reach).ceil().min(f.h as f64)).max(0.0) as usize;
        for y in ya..yb {
            for x in xa..xb {
                let p = (x as f64 + 0.5, y as f64 + 0.5);
                let (c, dist) = nearest_on_segment(p, a, b);
                if dist <= reach { let (ux, uy) = if dist > 1e-9 { ((p.0 - c.0) / dist, (p.1 - c.1) / dist) } else { (0.0, -1.0) }; f.offer(x, y, dist, ux, uy); }
            }
        }
    }
}

/// A round dot (the colon): centre (cx, cy), reaching `reach` pixels.
pub fn field_dot(f: &mut Field, cx: f64, cy: f64, reach: f64) {
    for y in (cy - reach - 1.0).floor().max(0.0) as usize..((cy + reach + 1.0).ceil() as usize).min(f.h) {
        for x in (cx - reach - 1.0).floor().max(0.0) as usize..((cx + reach + 1.0).ceil() as usize).min(f.w) {
            let (dx, dy) = (x as f64 + 0.5 - cx, y as f64 + 0.5 - cy);
            let d = (dx * dx + dy * dy).sqrt();
            if d <= reach { let (ux, uy) = if d > 1e-9 { (dx / d, dy / d) } else { (0.0, -1.0) }; f.offer(x, y, d, ux, uy); }
        }
    }
}
