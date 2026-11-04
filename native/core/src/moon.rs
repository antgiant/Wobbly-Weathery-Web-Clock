//! The moon: where it is, how much of it is lit, and how it is drawn. A low-precision lunar position (Meeus's main terms, good to about 0.2 degree, with
//! the parallax of the observer: the moon is near enough that it matters), checked against the astronomy library the web page uses.

const D2R: f64 = std::f64::consts::PI / 180.0;

fn days_since_j2000(t_ms: f64) -> f64 { t_ms / 86_400_000.0 + 2_440_587.5 - 2_451_545.0 }

/// The moon's ecliptic longitude and latitude (radians) and its distance (km).
fn ecliptic(d: f64) -> (f64, f64, f64) {
    let l = 218.316 + 13.176396 * d;
    let m = (134.963 + 13.064993 * d) * D2R;
    let f = (93.272 + 13.229350 * d) * D2R;
    let dd = (297.850 + 12.190749 * d) * D2R;
    let ms = (357.529 + 0.98560028 * d) * D2R;
    let lon = l + 6.289 * m.sin() + 1.274 * (2.0 * dd - m).sin() + 0.658 * (2.0 * dd).sin() + 0.214 * (2.0 * m).sin() - 0.186 * ms.sin() - 0.114 * (2.0 * f).sin();
    let lat = 5.128 * f.sin() + 0.281 * (m + f).sin() + 0.278 * (m - f).sin() + 0.173 * (2.0 * dd - f).sin();
    (lon.rem_euclid(360.0) * D2R, lat * D2R, 385_001.0 - 20_905.0 * m.cos() - 3_699.0 * (2.0 * dd - m).cos())
}

/// Height and bearing (degrees, bearing from north clockwise) of the moon's centre as seen from the place, geometric (no refraction), with parallax.
pub fn position(t_ms: f64, lat: f64, lon: f64) -> (f64, f64) {
    let d = days_since_j2000(t_ms);
    let (elon, elat, dist) = ecliptic(d);
    let eps = (23.439 - 0.0000004 * d) * D2R;
    let ra = (elon.sin() * eps.cos() - elat.tan() * eps.sin()).atan2(elon.cos());
    let dec = (elat.sin() * eps.cos() + elat.cos() * eps.sin() * elon.sin()).asin();
    let gmst = (280.46061837 + 360.98564736629 * d).rem_euclid(360.0);
    let h = (gmst + lon) * D2R - ra;
    let phi = lat * D2R;
    let alt = (phi.sin() * dec.sin() + phi.cos() * dec.cos() * h.cos()).asin();
    let az = h.sin().atan2(h.cos() * phi.sin() - dec.tan() * phi.cos()) + std::f64::consts::PI;
    let parallax = (6378.14 / dist).asin();                                 // horizontal parallax: the observer is not at the centre of the Earth
    let alt_topo = alt - parallax * alt.cos();
    (alt_topo / D2R, (az / D2R).rem_euclid(360.0))
}

/// The lit fraction of the moon's disc, 0 (new) to 1 (full), from the angle between the moon and the sun.
pub fn illumination(t_ms: f64) -> f64 {
    let d = days_since_j2000(t_ms);
    let (mlon, mlat, _) = ecliptic(d);
    let g = (357.528 + 0.9856003 * d) * D2R;
    let slon = (280.460 + 0.9856474 * d + 1.915 * g.sin() + 0.020 * (2.0 * g).sin()).rem_euclid(360.0) * D2R;
    let cos_psi = mlat.cos() * (mlon - slon).cos();                         // the angle between them, as seen from the Earth
    (1.0 - cos_psi) / 2.0
}

/// The moon's disc weight at a pixel offset (`dx`, `dy`, pixels) from its centre: 0 outside, and inside the lit amount 0..1 for a moon of radius `r`
/// pixels whose bright side faces the unit direction (`sx`, `sy`) on the screen, with `k` of the disc lit. Earthshine keeps the dark side faintly there.
pub fn disc(dx: f64, dy: f64, r: f64, sx: f64, sy: f64, k: f64) -> (f64, f64) {
    let d = (dx * dx + dy * dy).sqrt();
    let edge = (r + 0.5 - d).clamp(0.0, 1.0);
    if edge <= 0.0 { return (0.0, 0.0); }
    let (u, v) = ((dx / r).clamp(-1.0, 1.0), (dy / r).clamp(-1.0, 1.0));
    let nz = (1.0 - (u * u + v * v).min(1.0)).sqrt();
    let cos_phi = 2.0 * k - 1.0;                                            // the phase angle's cosine: 1 full, -1 new
    let sin_phi = (1.0 - cos_phi * cos_phi).max(0.0).sqrt();
    let lit = u * sx * sin_phi + v * sy * sin_phi + nz * cos_phi;           // the surface normal against the direction of the sun
    let t = ((lit + 0.04) / 0.12).clamp(0.0, 1.0);
    (edge, (0.10 + 0.90 * t * t * (3.0 - 2.0 * t)) * edge)
}
