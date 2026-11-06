// The cheapest pictures of the capability ladder (capability.js): a sky that is a simple gradient and a ground that is a flat colour fading with distance, both from the sun's height.
// No tables, no clouds, no stars, no ridges: a handful of numbers a frame. Pure maths, so it is tested in node; the colours are display (sRGB) values, 0..1.

/** Key colours by the sun's height in degrees: the sky overhead and at the horizon. Between two keys they are blended. */
const KEYS = [
  [-18, [0.008, 0.010, 0.028], [0.012, 0.015, 0.040]],
  [-12, [0.020, 0.030, 0.090], [0.060, 0.060, 0.150]],
  [-6, [0.060, 0.100, 0.260], [0.360, 0.250, 0.340]],
  [-1, [0.150, 0.240, 0.480], [0.900, 0.520, 0.380]],
  [6, [0.200, 0.380, 0.720], [0.780, 0.700, 0.700]],
  [20, [0.220, 0.440, 0.820], [0.640, 0.790, 0.950]],
];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * @param {number} sunAlt  the sun's height, degrees
 * @param {number} cover   the sky's cloud cover 0..1 (the thickest layer): greys and darkens the sky
 * @param {number} precip  rain or snow 0..1: darker still
 * @param {number[]} albedo  the ground's colour (the landscape's), linear 0..1
 * @returns {{zenith:number[], horizon:number[], groundNear:number[], groundFar:number[]}}
 */
export function flatPalette(sunAlt, cover = 0, precip = 0, albedo = [0.3, 0.28, 0.22]) {
  let i = 0;
  while (i < KEYS.length - 2 && sunAlt > KEYS[i + 1][0]) i++;
  const [a0, z0, h0] = KEYS[i], [a1, z1, h1] = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (sunAlt - a0) / (a1 - a0)));
  let zenith = mix3(z0, z1, t), horizon = mix3(h0, h1, t);
  const grey = Math.min(1, cover * 0.75 + precip * 0.2), dark = 1 - 0.28 * cover - 0.25 * precip;
  zenith = mix3(zenith, [luma(zenith), luma(zenith), luma(zenith)], grey).map((v) => v * dark);
  horizon = mix3(horizon, [luma(horizon), luma(horizon), luma(horizon)], grey * 0.8).map((v) => v * dark);
  const lit = 0.03 + 0.52 * smooth(-10, 14, sunAlt) * (1 - 0.35 * cover);          // how much of the day's light the ground has
  const groundNear = albedo.map((c) => Math.min(1, Math.max(0, c * lit * 2.6)));
  const groundFar = mix3(groundNear, horizon.map((v) => v * 0.45), 0.55);           // the ground fades towards the haze at the horizon
  return { zenith, horizon, groundNear, groundFar };
}
