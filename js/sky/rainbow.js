// Rainbows, from the real conditions. A rainbow is sunlight turned back by raindrops: you see it in the part of the sky opposite the sun, as a ring 42 degrees from
// the point exactly opposite the sun (the antisolar point), red outside and violet inside, with a fainter second ring at 51 degrees, colours reversed. So it needs
//   - the sun low enough that the antisolar point is above the horizon, and high enough to shine: between a fraction of a degree and 42 degrees up (the higher the sun,
//     the less of the ring is above the horizon, until none is at 42);
//   - drops in the air: rain falling or just ending, but not a downpour (which hides the sun);
//   - the sun not hidden: broken cloud, not an overcast; and no fog.
// Pure logic: the engine multiplies the answer into the shader (uBow) and the shader draws the ring.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const PRIMARY_DEG = 42, SECONDARY_DEG = 51;

/**
 * @param {number} sunAltDeg the sun's height above the horizon, degrees
 * @param {{precip:number, cover:number[], fog:number, snowfall?:number}} w the weather being shown
 * @returns {number} 0 (no rainbow) .. 1 (a vivid one)
 */
export function rainbowStrength(sunAltDeg, w) {
  if (!w || !(sunAltDeg > 0.3 && sunAltDeg < PRIMARY_DEG)) return 0;
  const drops = smooth(w.precip || 0, 0.03, 0.15) * (1 - smooth(w.precip || 0, 0.6, 0.9));           // drops, but not a downpour
  const cover = w.cover || [0, 0, 0];
  const sunOpen = smooth(0.95 - Math.max(cover[0], 0.8 * cover[1], 0.6 * cover[2]), 0, 0.5);        // broken cloud lets the sun through; an overcast does not
  const height = smooth(sunAltDeg, 0.3, 4) * (1 - smooth(sunAltDeg, 30, PRIMARY_DEG));                // low sun: a tall, bright bow; near 42 degrees only a sliver
  return drops * sunOpen * height * (1 - clamp(w.fog || 0, 0, 1)) * (w.snowfall ? 0 : 1);
}

/** The angle (degrees from the antisolar point) of the top of the primary bow above the horizon, for the sun at `sunAltDeg`: where it peaks. */
export const bowTopAltitude = (sunAltDeg) => PRIMARY_DEG - sunAltDeg;
