// Wind sway, the sky's side: measures the wind the sky is drawn with (weather.wind, towards east / north) against the way
// the screen looks, and hands wind.js the lean and gust size. clock.js bends the digits.
//   Off       the digits stand straight
//   Lean      the tops lean downwind by an amount that grows with the wind. Steady, so it costs nothing
//   Lean and gusts   the same, plus a slow flutter. The digits then redraw 15 times a second, so it is not used while saving power
//             (or when the device asks for reduced motion)

import { conf, lowPower, cap } from '../config.js';
import { sway, swayFor, windVector } from '../wind.js';
import { engine, controls } from './core.js';

let was = { mode: 'off', lean: 0, flutter: false };

export function updateWind() {
  const mode = conf.windSway === 'lean' || conf.windSway === 'full' ? conf.windSway : 'off';
  let lean = 0, gust = 0, flutter = false;
  if (mode !== 'off' && engine) {
    const w = engine.s.weather.wind || [0, 0];
    const v = windVector(w[0], w[1]);
    v.speed = v.speed * 1000 / 2;                                           // km/s at cloud level -> m/s at the ground (clouds move about twice as fast as the surface wind)
    const heading = controls?.lookDir?.az ?? 180;
    ({ lean, gust } = swayFor(v.speed, v.toAz, heading));
    flutter = mode === 'full' && cap.ambient && v.speed > 1.5 && !lowPower() && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }
  // ease towards the new lean so a change of weather or view is a lean, not a jump
  const next = mode === 'off' ? 0 : sway.mode === 'off' ? lean : sway.lean + (lean - sway.lean) * 0.5;
  const changed = mode !== was.mode || Math.abs(next - was.lean) > 0.4 || flutter !== was.flutter;
  sway.mode = mode; sway.lean = next; sway.gust = gust; sway.flutter = flutter;
  was = { mode, lean: next, flutter };
  if (changed) window.dispatchEvent(new Event('windchange'));
}

/** How often to look: each second while it is on (and once more to straighten up when it is switched off). */
export const windPeriod = () => (conf.windSway === 'lean' || conf.windSway === 'full' ? 1000 : (was.mode !== 'off' ? 500 : Infinity));
