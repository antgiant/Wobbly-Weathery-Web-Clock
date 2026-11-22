// Ice and sand that build up and fade (js/sky/accumulate.js). Run: node tests/unit/accumulate.test.mjs
import { check, done } from '../lib/check.mjs';
const { Accumulator } = await import('../../js/sky/accumulate.js');
const run = (a, amount, secs, dt = 1) => { let l = a.level; for (let t = 0; t < secs; t += dt) l = a.step(amount, dt); return l; };

let a = new Accumulator({ rise: 1 / 900, fall: 1 / 1500, start: 0.6 });
check('nothing yet: level 0, and no weather keeps it 0', a.level === 0 && run(a, 0, 600) === 0);
const first = a.step(1, 1);
check('a page that opens on freezing rain starts part way (it has been going a while) and keeps building', first > 0.55 && first < 0.65 && run(a, 1, 300) > first);
check('it reaches the full level in the end and never goes above what the weather makes', run(a, 1, 1200) === 1 && (() => { const b = new Accumulator({ rise: 1 / 900, fall: 1 / 1500 }); run(b, 0.4, 5000); return Math.abs(b.level - 0.4) < 1e-9; })());
check('when the weather stops it melts or blows away slowly, in about 25 minutes, and is gone', (() => { const b = new Accumulator({ rise: 1 / 900, fall: 1 / 1500 }); run(b, 1, 1500); const l0 = b.level; const l5 = run(b, 0, 300); const l30 = run(b, 0, 1500); return l0 === 1 && l5 > 0.7 && l5 < 0.9 && l30 === 0; })());
check('a gap of hours counts as ten minutes at most (a tab that slept)', (() => { const b = new Accumulator({ rise: 1 / 900, fall: 1 / 1500, start: 0 }); b.step(1, 1); const l = b.step(1, 86400); return l < 0.8; })());
check('after it has gone, new weather starts it part way again', (() => { const b = new Accumulator({ rise: 1 / 900, fall: 1 / 1500 }); run(b, 1, 100); run(b, 0, 3000); return b.level === 0 && b.step(1, 1) > 0.55; })());
check('rubbish in gives a sane level out', (() => { const b = new Accumulator({ rise: 1 / 900, fall: 1 / 1500 }); return [b.step(NaN, NaN), b.step(undefined, 1), b.step(5, 1)].every((v) => v >= 0 && v <= 1); })());
done();
