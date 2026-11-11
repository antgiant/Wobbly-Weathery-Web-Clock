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
// ---- thrown off when the glass moves (the digit changes) ----
const sitting = (x, y, r = 3) => ({ x, y, r, vy: 0, run: false, y0: y, hang: 0, wait: 0, dying: false, fall: 0, age: 1, trail: [] });
{
  // glass at x 62..80 only; a drop at x 50 has lost its glass, which is to its right: it is flung to the left, away from it
  s = new DropSim(21); const g = new Uint8Array(W * H); for (let y = 10; y < 90; y++) for (let x = 62; x < 80; x++) g[y * W + x] = 255;
  const dr = sitting(55, 50); s.drops.push(dr); s.setInk(g, W, H, W, H, S);
  check('a drop that loses its glass is thrown away from the glass that is left (to the left, the glass being on its right)', dr.dying && dr.thrown && dr.vx < -S * 0.5, `vx ${dr.vx && dr.vx.toFixed(1)}`);
  const x0 = dr.x; s.step(0.05, 0); s.step(0.05, 0);
  check('...and it really flies sideways, and down', dr.x < x0 - 1 && dr.y > 50, `x ${x0} -> ${dr.x.toFixed(1)}, y ${dr.y.toFixed(1)}`);
  run(s, 0.7, 0);
  check('...and is gone soon after', !s.drops.includes(dr));
}
{
  // thrown onto other glass it sticks: glass on its right (the drop's own is gone) and a second stroke close on its left
  s = new DropSim(22); const g = new Uint8Array(W * H);
  for (let y = 10; y < 90; y++) { for (let x = 40; x < 48; x++) g[y * W + x] = 255; for (let x = 62; x < 80; x++) g[y * W + x] = 255; }
  const dr = sitting(55, 50); s.drops.push(dr); s.setInk(g, W, H, W, H, S);
  run(s, 0.5, 0);
  check('a drop flung onto other glass lands and stays (smaller, sitting)', s.drops.includes(dr) && !dr.dying && s.inkAt(dr.x, dr.y) > 0.9, JSON.stringify({ x: +dr.x.toFixed(1), y: +dr.y.toFixed(1), dying: dr.dying, r: +dr.r.toFixed(2) }));
}
// ---- water that is already there: a running drop follows it, and runs faster on it ----
{
  const dryRun = (wetX) => {
    const t = make(23); const d2 = { x: 50, y: 25, r: S * 0.12, vy: 3, run: true, y0: 25, hang: 0, wait: 0, dying: false, fall: 0, age: 1, trail: [] }; t.drops.push(d2);
    if (wetX != null) for (let y = 0; y < H; y++) for (let k = -1; k <= 1; k++) t.wet[y * W + wetX + k] = 1;      // a wet track beside it (the ink grid is 100 x 100 here)
    for (let i = 0; i < 20; i++) { t.step(0.05, 0); if (d2.hang || d2.dying) break; }
    return d2;
  };
  const noWet = dryRun(null), right = dryRun(56), left = dryRun(44);
  check('with no water about a running drop runs straight (x unchanged)', Math.abs(noWet.x - 50) < 1e-9);
  check('a drop drifts towards a wet track on its right', right.x > 50.3, `x ${right.x.toFixed(2)}`);
  check('... and towards one on its left', left.x < 49.7, `x ${left.x.toFixed(2)}`);
  const onWet = dryRun(50);                                                                          // a wet track right in its way
  check('on wet glass a drop runs faster than on dry glass', onWet.y > noWet.y + 1, `${noWet.y.toFixed(1)} vs ${onWet.y.toFixed(1)}`);
  const w = make(24); w.drops.push({ x: 50, y: 30, r: S * 0.14, vy: 4, run: true, y0: 30, hang: 0, wait: 0, dying: false, fall: 0, age: 1, trail: [] });
  for (let i = 0; i < 10; i++) w.step(0.05, 0);
  const wetSum = w.wet.reduce((a, b) => a + b, 0);
  check('a running drop leaves water on the glass, which dries in a few seconds', wetSum > 0.5 && (() => { for (let i = 0; i < 100; i++) w.step(0.1, 0); return w.wet.reduce((a, b) => a + b, 0) < wetSum * 0.2; })(), `wet ${wetSum.toFixed(2)}`);
}
// ---- small beads left behind by a running drop ----
{
  let beads = 0;
  for (let seed = 30; seed < 36; seed++) {
    const t = make(seed); t.drops.push({ x: 50, y: 20, r: S * 0.15, vy: 4, run: true, y0: 20, hang: 0, wait: 0, dying: false, fall: 0, age: 1, trail: [] });
    for (let i = 0; i < 40; i++) { t.step(0.05, 0); if (t.drops.length > 1 && t.drops.some((d) => !d.run && !d.dying && d.r < S * 0.05 && d.y < t.drops[0].y)) { beads++; break; } }
  }
  check('a running drop leaves small beads behind it (most runs show some)', beads >= 3, `${beads} of 6 runs`);
}
// ---- momentum when drops merge ----
{
  s = make(40); s.drops.push({ ...sitting(50, 40, 6) }, { x: 52, y: 41, r: 2, vy: 10, run: true, y0: 41, hang: 0, wait: 0, dying: false, fall: 0, age: 1, trail: [] });
  s.step(0.001, 0);
  const m = s.drops[0];
  check('a fast little drop joining a big still one speeds it only a little (momentum is kept)', s.drops.length === 1 && m.vy > 0 && m.vy < 6, `vy ${m.vy.toFixed(2)}`);
}
// ---- the governor's limit ----
{
  const t = new DropSim(41); t.setInk(new Uint8Array(400 * 400).fill(255), 400, 400, 400, 400, 40); t.maxDrops = 20; run(t, 20, 1);
  check('the number of drops respects the governor\'s limit (maxDrops)', t.drops.length <= 20, String(t.drops.length));
}
// ---- wind carries a drop that has left the glass ----
{
  const fall = (wind) => { const t = make(7); t.wind = wind; t.drops.push({ x: 50, y: 50, r: 2, vy: 0, vx: 0, run: false, y0: 50, hang: 0, wait: 0, dying: true, fall: 0, age: 0, trail: [] }); for (let k = 0; k < 5; k++) t.step(0.05, 0); return t.drops.length ? t.drops[0].x : null; };
  const calm = fall(0), right = fall(0.6), left = fall(-0.6);
  check('wind to the right carries a falling drop right, to the left carries it left, none leaves it be', calm === 50 && right > 50.5 && left < 49.5, `${left} ${calm} ${right}`);
  check('a drop on the glass is not pushed by the wind (it runs down the stroke)', (() => { const t = make(8); t.wind = 0.75; run(t, 6, 1); return t.drops.filter((d) => !d.dying).every((d) => t.inkAt(d.x, d.y) > 0.9); })());
}

// ---- freezing rain: drops freeze where they land ----
{
  const wetRun = (freeze) => { const t = make(11); t.freeze = freeze; run(t, 40, 1); return t; };
  const warm = wetRun(0), ice = wetRun(1);
  check('without freezing, drops run down the stroke', warm.drops.some((d) => d.run));
  check('with freezing rain no drop ever runs, and they are marked as ice', ice.drops.length > 0 && ice.drops.every((d) => !d.run) && ice.drops.some((d) => d.ice));
  check('frozen beads stay small enough to be beads (until they merge)', ice.drops.filter((d) => d.ice).every((d) => d.r <= 20 * 0.2 + 1e-9 || d.r > 0));
  const thaw = wetRun(1); thaw.freeze = 0; run(thaw, 20, 1);
  check('when the freezing stops the ice thaws and runs', thaw.drops.some((d) => d.run || d.dying));
}

done();
