// Wind sway: the digits lean in the wind like palm trees, the bottom fixed and the top moving, so a glance shows the
// rough strength and which way it blows. Pure maths (no DOM), shared by the sky code that measures the wind and by clock.js
// that bends the digits.
//
// Units are the digits' own path units (a digit is about 333 wide and 420 tall; its stroke is 80 thick).
//   Lean   steady: the top moves downwind by up to MAX_LEAN as the wind goes from calm to a gale (about 12 degrees of slope).
//          Only the part of the wind across the screen shows as lean (wind towards or away from the viewer cannot lean sideways).
//   Gusts  a slow, uneven flutter of up to MAX_GUST either side of the lean, a different phase for every digit.
// The total top displacement never exceeds MAX_LEAN + MAX_GUST, so the time stays readable.

export const MAX_LEAN = 90, MAX_GUST = 18, GALE = 18;          // GALE: m/s at which the lean is at its full size
export const Y_TOP = 30, Y_BOT = 450;                          // top and bottom of a digit's ink

/** The sway state the clock reads. mode: off | lean | full. */
export const sway = { mode: 'off', lean: 0, gust: 0, flutter: false };

const wrap180 = (d) => ((d + 540) % 360) - 180;

/** How strong the wind is, 0 (calm) to 1 (a gale), eased so a light breeze already shows. */
export const strength = (speed) => Math.sqrt(Math.min(1, Math.max(0, speed) / GALE));

/**
 * @param {number} speed       surface wind speed, m/s
 * @param {number} toAz        compass bearing the wind blows TOWARDS, degrees from north
 * @param {number} heading     compass bearing the screen looks at
 * @returns {{lean: number, gust: number}}  lean > 0 pushes the tops of the digits to the right of the screen
 */
export function swayFor(speed, toAz, heading) {
  const s = strength(speed);
  const across = Math.sin(wrap180(toAz - heading) * Math.PI / 180);       // +1: blowing to the screen's right
  return { lean: MAX_LEAN * s * across, gust: MAX_GUST * s };
}

/** Wind blowing towards (east, north) in any unit: its speed and the bearing it blows towards. */
export function windVector(east, north) {
  return { speed: Math.hypot(east, north), toAz: (Math.atan2(east, north) * 180 / Math.PI + 360) % 360 };
}

/** The gust factor, -1 .. 1: two slow sines that never quite repeat, offset by the digit's `phase`. */
export function flutter(tMs, phase) {
  const t = tMs / 1000;
  return 0.6 * Math.sin(2 * Math.PI * 0.31 * t + phase) + 0.4 * Math.sin(2 * Math.PI * 0.83 * t + 1.7 * phase + 0.6);
}

/** How far the top of a digit is pushed right (path units) at time tMs. */
export function topOffset(tMs, phase) {
  return sway.lean + (sway.flutter ? sway.gust * flutter(tMs, phase) : 0);
}

/** 0 at the bottom of the digit, 1 at the top: how much of the push a point at height y takes (it bends, it does not slide). */
export const weight = (y) => Math.pow(Math.min(1, Math.max(0, (Y_BOT - y) / (Y_BOT - Y_TOP))), 1.6);

/** Bend a digit's control points (a flat [x0, y0, x1, y1, ...] list) by `dx` at the top. */
export function bend(points, dx) {
  if (!dx) return points;
  const out = points.slice();
  for (let i = 0; i < out.length; i += 2) out[i] = Math.round((out[i] + dx * weight(out[i + 1])) * 10) / 10;
  return out;
}
