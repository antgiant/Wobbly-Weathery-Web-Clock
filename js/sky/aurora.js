// Aurora, from the real conditions: where the place is in the Earth's magnetic field, how disturbed the field is now (NOAA's planetary K index, "Kp"), how dark
// the sky is and how clear. Pure logic plus one small fetch; the sky shader draws the curtains (js/sky/glsl-scene.js, uAur).
//
// The aurora lives in an oval round each magnetic pole. When the field is quiet (Kp 0) the oval's equator-ward edge lies near 66 degrees of magnetic latitude;
// each step of Kp moves it about 2 degrees toward the equator (Kp 9, a great storm, about 48). From just inside the edge you see a low glow toward the pole; from
// well inside, curtains overhead.

const RAD = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** The north geomagnetic (dipole) pole, about 2025: 80.7 N, 72.7 W. It drifts a few tenths of a degree a year, which does not matter here. */
export const POLE = { lat: 80.7, lon: -72.7 };

/** Magnetic latitude (degrees, + north) of a place, by the tilted dipole model. */
export function geomagneticLatitude(lat, lon) {
  const s = Math.sin(lat * RAD) * Math.sin(POLE.lat * RAD) + Math.cos(lat * RAD) * Math.cos(POLE.lat * RAD) * Math.cos((lon - POLE.lon) * RAD);
  return Math.asin(clamp(s, -1, 1)) / RAD;
}

/** The compass bearing (degrees from north, clockwise) from a place toward its own magnetic pole: the pole of the hemisphere (north, or the south pole's antipode). */
export function poleBearing(lat, lon) {
  const south = lat < 0, tLat = south ? -POLE.lat : POLE.lat, tLon = south ? POLE.lon + 180 : POLE.lon;
  const f1 = lat * RAD, f2 = tLat * RAD, dl = (tLon - lon) * RAD;
  const y = Math.sin(dl) * Math.cos(f2), x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Magnetic latitude of the oval's equator-ward edge for a Kp (0 to 9). */
export const ovalEdge = (kp) => 66 - 2 * clamp(kp, 0, 9);

/**
 * How visible an aurora is, 0..1, and where in the sky: `height` 0 = on the horizon toward the pole, 1 = overhead.
 * @param {{lat:number, lon:number, kp:number|null, sunAlt:number, cover?:number[], fog?:number}} o  sunAlt in degrees
 */
export function auroraView({ lat, lon, kp, sunAlt, cover = [0, 0, 0], fog = 0 }) {
  if (!Number.isFinite(kp) || !Number.isFinite(lat) || !Number.isFinite(lon)) return { strength: 0, height: 0, bearing: 0 };
  const mlat = Math.abs(geomagneticLatitude(lat, lon)), inside = mlat - ovalEdge(kp);             // degrees poleward of the edge: > 0 means the oval is overhead or nearer the pole than the edge
  const near = smooth(inside, -4, 6);                                                              // a little south of the edge you still see it low in the north; deep inside it is strong
  const dark = smooth(-sunAlt, 12, 18);                                                            // twilight over: astronomical night is best
  const clear = 1 - clamp(Math.max(cover[0], cover[1] * 0.9, cover[2] * 0.5), 0, 1) * 0.95;      // cloud hides it; high thin cloud only a little
  const strength = near * dark * clear * (1 - clamp(fog, 0, 1));
  return { strength, height: smooth(inside, 0, 5), bearing: poleBearing(lat, lon) };               // just inside the edge it hugs the horizon, 5 degrees in the oval is overhead
}

/** The latest Kp in NOAA's planetary K index forecast file (observed, estimated and predicted values, 3 hours apart): the last entry that is not in the future. */
export function kpFromForecast(rows, nowMs = Date.now()) {
  if (!Array.isArray(rows)) return null;
  let best = null;
  for (const r of rows) {
    const t = Date.parse(`${r && r.time_tag}Z`), k = Number(r && (r.kp ?? r.Kp));
    if (Number.isFinite(t) && Number.isFinite(k) && t <= nowMs && (!best || t > best.t)) best = { t, k };
  }
  return best && nowMs - best.t < 12 * 3600e3 ? best.k : null;
}

/** NOAA SWPC, which allows requests from a web page (CORS) and from the Pi. */
export async function fetchKp(signal) {
  const r = await fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json', { signal });
  if (!r.ok) throw new Error('kp HTTP ' + r.status);
  return kpFromForecast(await r.json());
}
