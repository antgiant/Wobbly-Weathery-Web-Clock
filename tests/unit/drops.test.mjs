// Raindrops on the digits: how drops form, grow, run, merge and are shed. Run: node tests/unit/drops.test.mjs
import { check, done } from '../lib/check.mjs';
const { DropSim, MAX_DROPS } = await import('../../js/sky/drops.js');

const W = 100, H = 100, S = 20;                               // a mask 100 x 100 with one vertical stroke 20 wide, x 40..60, y 10..90
const stroke = () => { const g = new Uint8Array(W * H); for (let y = 10; y < 90; y++) for (let x = 40; x < 60; x++) g[y * W + x] = 255; return g; };
const make = (seed = 1) => { const s = new DropSim(seed); s.setInk(stroke(), W, H, W, H, S); return s; };
const run = (s, secs, rain, dt = 0.05) => { for (let t = 0; t < secs; t += dt) s.step(dt, rain); return s; };

let s = make();
run(s, 3, 0);
check('no rain, no drops', s.drops.length === 0);

s = make(); run(s, 1, 0.8);
check('rain makes drops', s.drops.length > 0, String(s.drops.length));
check('every new drop is on the glass (never on empty space, never on an edge)', s.drops.every((d) => s.inkAt(d.x, d.y) > 0.9 && d.x > 41 && d.x < 59));

// a drop sits and grows
s = make(2); run(s, 0.3, 1);
const first = s.drops.find((d) => !d.run);
const r0 = first && first.r;
run(s, 0.3, 1);
check('a sitting drop grows while it rains', first && (first.run || first.r > r0), `${r0} -> ${first && first.r}`);

// drops run down, only down, leaving a trail
s = make(3); let sawRun = false, trailAbove = false;
for (let t = 0; t < 40; t += 0.05) {
  s.step(0.05, 1);
  for (const d of s.drops) { if (d.dying) continue; if (d.run) { sawRun = true; if (d.trail.length > 2 && d.trail.every((p) => p[1] <= d.y + 1e-6)) trailAbove = true; } }
}
check('in heavy rain, drops get heavy enough to run', sawRun);
check('a running drop has a wet trail above it', trailAbove);
check('(heavy rain, drops merge, so a drop can shift towards the one it swallowed: see the single-drop checks below for straight runs)', true);
// monotone downward while running (a merge moves a drop to the weighted middle, so follow single drops with no merge)
s = make(4); const d = { x: 50, y: 30, r: S * 0.16, vy: 3, run: true, y0: 30, hang: 0, wait: 0, dying: false, fall: 0, age: 1, trail: [] }; s.drops.push(d);
let prevY = d.y, monotone = true; const dx0 = d.x; for (let t = 0; t < 3; t += 0.05) { s.step(0.05, 0); if (d.y < prevY - 1e-9) monotone = false; prevY = d.y; if (d.hang || d.dying) break; }
check('a running drop only ever moves down, and straight down (x does not change)', monotone && d.y > 30 && d.x === dx0, `y ${d.y.toFixed(1)}`);
check('it speeds up as it goes (gravity), within a limit', d.vy > 3 || d.hang > 0 || d.dying);

// it runs off the end of the stroke: hangs, then falls and is gone
s = make(5); const e = { x: 50, y: 70, r: S * 0.16, vy: 8, run: true, y0: 70, hang: 0, wait: 0, dying: false, fall: 0, age: 1, trail: [] }; s.drops.push(e);
let hung = false; for (let t = 0; t < 6; t += 0.05) { s.step(0.05, 0); if (e.hang) hung = true; if (!s.drops.includes(e)) break; }
check('at the bottom of the stroke the drop hangs for a moment, then falls away', hung && !s.drops.includes(e));
check('nothing ever runs below the bottom of the stroke (y 90) before it is shed', (() => { s = make(6); const f = { x: 50, y: 80, r: S * 0.16, vy: 9, run: true, y0: 80, hang: 0, wait: 0, dying: false, fall: 0, age: 1, trail: [] }; s.drops.push(f); let worst = 0; for (let t = 0; t < 1.5; t += 0.02) { s.step(0.02, 0); if (!f.dying) worst = Math.max(worst, f.y); } return worst <= 90.01; })());

// merging
s = make(7); s.drops.push({ x: 50, y: 40, r: 3, vy: 0, run: false, y0: 40, hang: 0, wait: 0, dying: false, fall: 0, age: 0, trail: [] }, { x: 52, y: 41, r: 2, vy: 0, run: false, y0: 41, hang: 0, wait: 0, dying: false, fall: 0, age: 0, trail: [] });
s.step(0.01, 0);
check('two drops that touch become one, with the water of both (area adds: r = sqrt(9 + 4))', s.drops.length === 1 && Math.abs(s.drops[0].r - Math.sqrt(13)) < 0.2, JSON.stringify(s.drops.map((x) => +x.r.toFixed(2))));

// the digit changes: drops that lose their glass are shed
s = make(8); run(s, 2, 1);
const before = s.drops.length;
s.setInk(new Uint8Array(W * H), W, H, W, H, S);                         // the stroke is gone
check('(set up) there were drops', before > 0);
check('when the glass moves away from under them the drops are shed (marked at once)', s.drops.every((x) => x.dying));
run(s, 0.6, 0);
check('and they are gone within half a second, none left floating where there is no glass', s.drops.length === 0, String(s.drops.length));
// only the drops on the vanished part go
s = make(9); run(s, 2, 1);
const g2 = stroke(); for (let y = 10; y < 50; y++) for (let x = 40; x < 60; x++) g2[y * W + x] = 0;          // the top half of the stroke goes
s.setInk(g2, W, H, W, H, S);
const top = s.drops.filter((x) => x.y < 50), bottom = s.drops.filter((x) => x.y >= 50 && !x.dying);
check('after a change only the drops over the vanished part are shed; the rest stay', top.every((x) => x.dying) && bottom.every((x) => !x.dying));

// more rain, more drops; capped
const few = make(10), many = make(10); run(few, 3, 0.15); run(many, 3, 1);
check('heavier rain carries more drops', many.drops.length > few.drops.length, `${few.drops.length} vs ${many.drops.length}`);
const big = new DropSim(11); big.setInk(new Uint8Array(400 * 400).fill(255), 400, 400, 400, 400, 40); run(big, 20, 1);
check(`never more than ${MAX_DROPS} drops, however much glass`, big.drops.length <= MAX_DROPS, String(big.drops.length));

// determinism and time steps
const a = make(12), b = make(12); run(a, 5, 0.7); run(b, 5, 0.7);
check('the same seed gives the same rain', JSON.stringify(a.drops.map((x) => [x.x, x.y, x.r])) === JSON.stringify(b.drops.map((x) => [x.x, x.y, x.r])));
const big1 = make(13); big1.drops.push({ x: 50, y: 20, r: S * 0.16, vy: 10, run: true, y0: 20, hang: 0, wait: 0, dying: false, fall: 0, age: 1, trail: [] });
const y1 = big1.drops[0].y; big1.step(10, 0);
check('a very long frame moves a drop only as far as a short one (no teleporting)', big1.drops[0].y - y1 < 5, `${(big1.drops[0].y - y1).toFixed(1)} px`);
check('with no ink at all nothing is made and nothing breaks', (() => { const z = new DropSim(1); z.step(0.1, 1); z.setInk(new Uint8Array(4), 2, 2, 10, 10, 10); z.step(0.1, 1); return z.drops.length === 0; })());
done();
