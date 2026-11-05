// The quality governor: it must keep frames inside the floor (15 fps) and ceiling (60 fps) by moving along the quality ladder, settle (not flap),
// reach the top on a fast machine and the bottom on a hopeless one, and recover when the machine speeds up or slows down.
// Run: node tests/unit/governor.test.mjs
import { check, done } from '../lib/check.mjs';
import { Governor, LADDER } from '../../js/sky/governor.js';

/** A pretend machine: a frame at a level costs `base` ms at the top level, scaled by that level's pixel work, plus a little fixed cost. */
function run(base, seconds = 120, { start, change } = {}) {
  const g = new Governor({ level: start });
  let t = 0, levels = [], costNow = base;
  while (t < seconds * 1000) {
    if (change && t >= change.at) costNow = change.base;
    const cost = costNow * g.work(g.level) / g.work(LADDER.length - 1) + 1.5;
    g.report(cost, t);
    t += Math.max(g.tickMs, cost);                      // a frame takes at least its cost
    levels.push(g.level);
  }
  return { g, levels, final: g.level, cost: costNow * g.work(g.level) / g.work(LADDER.length - 1) + 1.5 };
}
const budget = new Governor().budgetMs;

for (const [name, base] of [['a fast desktop', 3], ['a Pi 4', 25], ['a Pi 3', 120], ['a Pi Zero with a GPU', 250], ['the Zero on its CPU', 9000]]) {
  const r = run(base);
  const tail = r.levels.slice(-200);
  const flaps = tail.filter((l, i) => i && l !== tail[i - 1]).length;
  const fits = r.cost <= budget;
  check(`${name}: settles on a level whose frames fit the floor (or the lowest level)`, fits || r.final === 0, `level ${r.final}, cost ${r.cost.toFixed(1)} ms, budget ${budget.toFixed(1)}`);
  check(`${name}: does not flap once settled`, flaps <= 2, `${flaps} changes in the last ${tail.length} frames`);
  check(`${name}: the tick period stays between the ceiling and the floor`, r.g.tickMs >= 1000 / 60 - 1e-9 && r.g.tickMs <= 1000 / 15 + 1e-9, `${r.g.tickMs.toFixed(1)} ms`);
}
check('a fast desktop reaches the top of the ladder', run(3).final === LADDER.length - 1);
check('a hopeless machine ends at the bottom', run(9000).final === 0);
check('a fast machine ticks at the ceiling (60 fps)', Math.abs(run(3).g.tickMs - 1000 / 60) < 0.5, `${run(3).g.tickMs.toFixed(2)} ms`);
check('a slower machine climbs less far than a faster one', run(25).final > run(120).final && run(120).final > run(250).final, [run(25).final, run(120).final, run(250).final].join(' > '));

// the machine changes: something else starts using the CPU, later stops
const slowed = run(10, 200, { start: LADDER.length - 1, change: { at: 20000, base: 300 } });
check('when the machine gets busy the governor steps down until frames fit', slowed.cost <= budget || slowed.final === 0, `level ${slowed.final}, cost ${slowed.cost.toFixed(1)}`);
const recovered = (() => {
  const g = new Governor({ level: 0 }); let t = 0, costNow = 300;
  for (let i = 0; i < 4000 && t < 400000; i++) {
    if (t > 60000) costNow = 10;
    const cost = costNow * g.work(g.level) / g.work(LADDER.length - 1) + 1.5; g.report(cost, t); t += Math.max(g.tickMs, cost);
  }
  return g.level;
})();
check('when the machine is free again the governor climbs back up', recovered >= LADDER.length - 3, `level ${recovered}`);

// a single slow frame (a garbage collection, a compile) must not drop quality
{
  const g = new Governor({ level: 7 }); let t = 0;
  for (let i = 0; i < 200; i++) { g.report(i === 100 ? 400 : 10, t); t += 20; }
  check('one slow frame among fast ones does not change the level', g.level >= 7, `level ${g.level}`);
}
check('the ladder only ever gets better with each level', LADDER.every((k, i) => !i || (k.outScale >= LADDER[i - 1].outScale && k.scale >= LADDER[i - 1].scale && k.drops >= LADDER[i - 1].drops && k.skyMs <= LADDER[i - 1].skyMs)));
done();
