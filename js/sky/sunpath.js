// Sunrise / sunset times, the countdown to them, and the "follow the sun" camera.
//
// World frame matches the renderer: x = East, y = Up, z = North, azimuth from North towards East.
// Rise and set are the usual definition (upper limb on the horizon, standard refraction), so they
// match an almanac. They do not know about hills: with real terrain the sun disappears a little earlier.

const A = globalThis.Astronomy;
const DEG = Math.PI / 180;
const wrap180 = (d) => ((d + 540) % 360) - 180;
const lerpAngle = (a, b, u) => a + wrap180(b - a) * u;

function observer(lat, lon, elevM) { return new A.Observer(lat, lon, elevM || 0); }

/** Sun azimuth / altitude (degrees, refraction included) for a Date. */
export function sunHorizon(date, obs) {
  const t = A.MakeTime(date);
  const eq = A.Equator('Sun', t, obs, true, true);
  return A.Horizon(t, obs, eq.ra, eq.dec, 'normal');
}

const dirOf = (az, alt) => [Math.sin(az * DEG) * Math.cos(alt * DEG), Math.sin(alt * DEG), Math.cos(az * DEG) * Math.cos(alt * DEG)];

/**
 * What the countdown can count down to. Each has a morning ("rise") and an evening ("set") event.
 *   sun        sunrise and sunset (upper limb on the horizon)
 *   golden     the start of golden hour: the sun at -4 degrees rising, and at +6 degrees falling
 *   civil, nautical, astro   dawn and dusk, the sun at -6, -12 and -18 degrees
 *   moon       moonrise and moonset
 */
export const EVENT_KINDS = {
  sun: { rise: 'Sunrise', set: 'Sunset', body: 'sun' },
  golden: { rise: 'Golden hour', set: 'Golden hour', body: 'sun', alt: { rise: -4, set: 6 } },
  civil: { rise: 'Civil dawn', set: 'Civil dusk', body: 'sun', alt: { rise: -6, set: -6 } },
  nautical: { rise: 'Nautical dawn', set: 'Nautical dusk', body: 'sun', alt: { rise: -12, set: -12 } },
  astro: { rise: 'Astronomical dawn', set: 'Astronomical dusk', body: 'sun', alt: { rise: -18, set: -18 } },
  moon: { rise: 'Moonrise', set: 'Moonset', body: 'moon' },
};

/**
 * The events around `date`: the last and the next of each of the morning and evening kind (null near the poles, where
 * there may be none for months, or when the sun never gets that far below the horizon).
 */
export function sunEvents(date, lat, lon, elevM, type = 'sun') {
  const obs = observer(lat, lon, elevM), t = A.MakeTime(date), k = EVENT_KINDS[type] || EVENT_KINDS.sun;
  const find = (dir, limit) => {
    try {
      if (k.body === 'moon') { const r = A.SearchRiseSet('Moon', obs, dir, t, limit); return r ? r.date : null; }
      if (k.alt) { const r = A.SearchAltitude('Sun', obs, dir, t, limit, k.alt[dir > 0 ? 'rise' : 'set']); return r ? r.date : null; }
      const r = A.SearchRiseSet('Sun', obs, dir, t, limit); return r ? r.date : null;
    } catch (_) { return null; }
  };
  return {
    prevRise: find(+1, -1.6), prevSet: find(-1, -1.6),
    nextRise: find(+1, 1.6), nextSet: find(-1, 1.6),
  };
}

/**
 * Which countdown to show, if any.
 * @param {'both'|'sunrise'|'sunset'} mode
 * @param {string} [type]  a key of EVENT_KINDS
 * @returns {null | {kind: 'sunrise'|'sunset', msLeft: number, name: string, body: 'sun'|'moon'}}  kind is the morning or evening one; msLeft <= 0 for the first minute after the event
 */
export function countdownState(ev, nowMs, mode, leadMin, type = 'sun') {
  const k = EVENT_KINDS[type] || EVENT_KINDS.sun;
  const want = (k) => mode === 'both' || mode === k;
  let best = null;
  const consider = (kind, date, sign) => {
    if (!date || !want(kind)) return;
    const left = (date.getTime() - nowMs);
    if (sign > 0 ? (left < 0 || left > leadMin * 60000) : (left > 0 || left < -60000)) return;   // upcoming, or just happened
    if (!best || Math.abs(left) < Math.abs(best.msLeft)) best = { kind, msLeft: left, name: kind === 'sunrise' ? k.rise : k.set, body: k.body };
  };
  consider('sunrise', ev.nextRise, +1); consider('sunset', ev.nextSet, +1);
  consider('sunrise', ev.prevRise, -1); consider('sunset', ev.prevSet, -1);
  return best;
}

// ------------------------------------------------------------ follow the sun --

/** Sun azimuth at solar noon on the day that runs from `rise` (a Date), and which way the sun turns that day. */
function dayFrame(rise, obs) {
  const noon = A.SearchHourAngle('Sun', obs, 0, A.MakeTime(rise));
  const noonAz = noon.hor.azimuth;
  const riseAz = sunHorizon(rise, obs).azimuth;
  return { noonAz, dir: wrap180(noonAz - riseAz) >= 0 ? 1 : -1 };       // +1: clockwise (northern hemisphere, facing south)
}

/**
 * Where on the screen the sun should be, 0 = left edge, 1 = right edge.
 *
 * Sunrise lands a quarter of the way in from the right and sunset a quarter in from the left, whichever hemisphere you
 * are in, so the sun always travels right to left like the east -> west of a map. The position follows the
 * sun's real azimuth, measured from where it is at noon, so the seasons show: in summer the sun rises
 * further round to the north and starts nearer the right edge, in winter it starts nearer the middle.
 */
function screenX(az, frame) {
  const p = frame.dir * wrap180(az - frame.noonAz);                     // negative in the morning, positive in the evening
  return Math.min(0.9, Math.max(0.1, 0.5 - p / 360));
}

/** Heading that puts a sun at (az, alt) at horizontal screen position x, for a camera with a given pitch and field of view. */
export function headingForSunAt(az, alt, x, pitchDeg, tanX) {
  const d = dirOf(az, alt), P = pitchDeg * DEG, target = (2 * x - 1);
  const ndc = (H) => {
    const h = H * DEG;
    const cx = d[0] * Math.cos(h) - d[2] * Math.sin(h);
    const cz = d[0] * Math.sin(h) * Math.cos(P) + d[1] * Math.sin(P) + d[2] * Math.cos(h) * Math.cos(P);
    return cz > 1e-4 ? cx / (cz * tanX) : (cx >= 0 ? 1e3 : -1e3);
  };
  let lo = az - 88, hi = az + 88;                                      // ndc falls as the camera turns towards the sun
  for (let i = 0; i < 44; i++) {
    const mid = (lo + hi) / 2;
    if (ndc(mid) > target) lo = mid; else hi = mid;
  }
  return ((lo + hi) / 2 + 360) % 360;
}

/**
 * Camera heading for "follow the sun". By day the sun slides from the right quarter to the left quarter. At
 * night the camera turns back, unhurried, from the sunset framing to the next sunrise one.
 * @param {Date} date
 * @param {{pitch: number, tanX: number}} view  tanX: tangent of half the horizontal field of view
 * @param {object} [ev]  sunEvents() for this moment, to avoid searching again
 */
export function followHeading(date, lat, lon, elevM, view, ev) {
  const obs = observer(lat, lon, elevM);
  ev = ev || sunEvents(date, lat, lon, elevM);
  const now = sunHorizon(date, obs);
  const centred = () => headingForSunAt(now.azimuth, now.altitude, 0.5, view.pitch, view.tanX);   // polar day / night: just stay with the sun
  const { prevRise, prevSet, nextRise, nextSet } = ev;
  try {
    const day = nextSet && (!nextRise || nextSet < nextRise);
    if (day) {
      if (!prevRise) return centred();
      return headingForSunAt(now.azimuth, now.altitude, screenX(now.azimuth, dayFrame(prevRise, obs)), view.pitch, view.tanX);
    }
    if (!prevSet || !nextRise) return centred();
    // the framing at the last sunset (that day started at the rise before it) ...
    const dayRise = A.SearchRiseSet('Sun', obs, +1, A.MakeTime(prevSet), -1.6);
    const sHor = sunHorizon(prevSet, obs);
    const hSet = dayRise ? headingForSunAt(sHor.azimuth, sHor.altitude, screenX(sHor.azimuth, dayFrame(dayRise.date, obs)), view.pitch, view.tanX) : null;
    // ... and at the coming sunrise
    const rHor = sunHorizon(nextRise, obs);
    const hRise = headingForSunAt(rHor.azimuth, rHor.altitude, screenX(rHor.azimuth, dayFrame(nextRise, obs)), view.pitch, view.tanX);
    if (hSet == null) return hRise;
    const u = Math.min(1, Math.max(0, (date - prevSet) / (nextRise - prevSet)));
    return (lerpAngle(hSet, hRise, u) + 360) % 360;
  } catch (_) {
    return centred();
  }
}
