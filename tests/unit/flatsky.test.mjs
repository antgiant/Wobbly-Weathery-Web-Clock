// The cheapest sky and ground (the capability ladder's last looks): colours from the sun's height, smooth, dark at night, grey under cloud.
// Run: node tests/unit/flatsky.test.mjs
import { check, done } from '../lib/check.mjs';
import { flatPalette } from '../../js/sky/flatsky.js';

const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const ok = (p) => ['zenith', 'horizon', 'groundNear', 'groundFar'].every((k) => p[k].length === 3 && p[k].every((v) => v >= 0 && v <= 1.0001));
const day = flatPalette(40), night = flatPalette(-30), dusk = flatPalette(-3);
check('every colour is a display colour at every sun height', [-90, -30, -18, -12, -6, -1, 0, 6, 20, 90].every((a) => ok(flatPalette(a, 0.5, 0.5))));
check('the day sky is brighter than the night sky, overhead and at the horizon', luma(day.zenith) > 8 * luma(night.zenith) && luma(day.horizon) > 8 * luma(night.horizon));
check('the day ground is brighter than the night ground', luma(day.groundNear) > 6 * luma(night.groundNear));
check('overhead is bluer than the horizon by day, and the horizon is warm at sunrise', day.zenith[2] > day.zenith[0] && dusk.horizon[0] > dusk.horizon[2]);
check('the sky changes smoothly with the sun (no step larger than a few percent per degree)', (() => { let worst = 0, p = flatPalette(-20); for (let a = -19.5; a <= 30; a += 0.5) { const q = flatPalette(a); for (const k of ['zenith', 'horizon', 'groundNear']) for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(q[k][i] - p[k][i])); p = q; } return worst < 0.09; })());
const clear = flatPalette(30, 0), over = flatPalette(30, 1);
const spread = (c) => Math.max(...c) - Math.min(...c);
check('cloud cover greys and darkens the sky', spread(over.zenith) < spread(clear.zenith) && luma(over.zenith) < luma(clear.zenith));
check('rain darkens it further', luma(flatPalette(30, 1, 1).zenith) < luma(over.zenith));
check('the ground fades towards the haze at the horizon (the far colour is not the near one)', day.groundFar.some((v, i) => Math.abs(v - day.groundNear[i]) > 0.02));
done();
