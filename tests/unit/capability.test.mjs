// The capability ladder: the clock must always show the right time, so the engine gives things up in a fixed order until the cost fits, whatever the user chose.
// Run: node tests/unit/capability.test.mjs
import { check, done } from '../lib/check.mjs';
import { Capability, RUNGS, BUDGET } from '../../js/sky/capability.js';
import { LADDER, SHARP_LADDER } from '../../js/sky/governor.js';

/** A pretend machine: a redraw of the digits costs `fixed` + `perPx` per output pixel (x the level's output scale squared); a sky redraw costs `sceneBase` at the top level, scaled by the scene's size. */
function machine({ fixed = 45, perPx = 0.008, px = 160 * 90, sceneBase = 130, rungRelief = [1, 0.8, 0.6, 0.6, 0.6, 0.6, 0.3, 0.05] }) {
  return (c) => {
    const k = c.knobs, r = rungRelief[c.rung];
    const glass = fixed + perPx * px * k.outScale * k.outScale;
    const scene = sceneBase * (px * k.scale * k.scale) / (160 * 90) * r;
    return { glass: glass * (c.rung >= 3 ? 1 : r < 1 ? 0.9 : 1), scene };
  };
}
function run(cost, { profile = 'smooth', minutes = 90, rung = 0, pin = false, level } = {}) {
  const c = new Capability({ profile, rung, pin, level });
  let t = 0, last = { rung: c.rung, at: 0 }, log = [];
  while (t < minutes * 60000) {
    const m = cost(c);
    // digits redraw every frame while live, once a second on tick/seconds-off, once a minute on slow; the sky every few seconds / minutes
    const live = c.rung < 3;
    c.report(m.glass, 'glass', t);
    if (Math.floor(t / (live ? 6000 : 30000)) !== Math.floor((t - 1) / (live ? 6000 : 30000))) c.report(m.scene, 'scene', t);
    if (c.rung !== last.rung) { log.push([Math.round(t / 1000), c.rung]); last = { rung: c.rung, at: t }; }
    t += live ? Math.max(c.tickMs, m.glass) : c.rung < 5 ? 1000 : 60000;
  }
  return { c, log };
}

// a fast desktop stays on rung 0 and reaches the top resolution
{ const r = run(machine({ fixed: 3, perPx: 0.0003, sceneBase: 8 }), { minutes: 10 });
  check('a fast machine stays on the full rung', r.c.rung === 0, `rung ${r.c.rung}`);
  check('... at the top resolution level', r.c.level === LADDER.length - 1, `level ${r.c.level}`); }

// a Zero on a 720p display (the digits' passes over the whole screen: 7 s; the sky at a quarter of the size: 1.7 s) loses things in the stated order and settles on the slow clock
{ const px = 1280 * 720, zero = machine({ fixed: 45, perPx: 0.0075, px, sceneBase: 3300 * px / 113000 });
  const r = run(zero, { profile: 'sharp', minutes: 60 });
  check('the Zero on 720p ends on the slow clock (a redraw of 7 s fits a minute, not a second)', r.c.rung === 5, `rung ${r.c.rung} (${r.c.name})`);
  check('the rungs were given up in order, none skipped, and a rung that missed by a lot was not tried again within the hour', r.log.every(([, k], i) => k === (i ? r.log[i - 1][1] + 1 : 1)), JSON.stringify(r.log));
  check('the output size was never lowered on the way', r.c.knobs.outScale === 1);
  // limiting the glass passes to the digits (about a sixth of the screen) lets it keep a live clock with the seconds hidden
  const r2 = run(machine({ fixed: 45, perPx: 0.0075 / 6, px, sceneBase: 3300 * px / 113000 }), { profile: 'sharp', minutes: 60 });
  check('with the passes limited to the digits the same Zero holds the seconds-off rung', r2.c.rung === 4, `rung ${r2.c.rung}`); }
// the Zero on its 160 x 90 test picture holds a live clock (about 15 fps)
{ const r = run(machine({ fixed: 45, perPx: 0.0065, px: 160 * 90, sceneBase: 300 }), { minutes: 20 });
  check('the Zero at 160 x 90 stays on a live rung', r.c.rung <= 2, `rung ${r.c.rung}`); }

// a hopeless machine ends on the last rung and the clock still ticks (the knobs say what to draw)
{ const r = run(() => ({ glass: 60000, scene: 600000 }), { minutes: 120 });
  check('a hopeless machine ends on the last rung', r.c.rung === RUNGS.length - 1, `rung ${r.c.rung}`);
  const k = r.c.knobs;
  check('... with no landscape, no sky, no seconds, one picture a minute, nothing moving', !k.landscape && !k.sky && k.seconds === 'off' && k.cadence === 'minute' && !k.weather && !k.ambient); }

// each rung leaves exactly what it says
{ const c = new Capability({ rung: 0 }), seq = [];
  for (let i = 0; i < RUNGS.length; i++) { c.rung = i; const k = c.knobs; seq.push([k.weather, k.ambient, k.seconds, k.cadence, k.landscape, k.sky].join()); }
  check('the rungs take away weather, then ambient motion, then seconds (tick, off), then the cadence, landscape, sky',
    seq[0] === 'true,true,morph,live,true,true' && seq[1] === 'false,true,morph,live,true,true' && seq[2] === 'false,false,morph,live,true,true' && seq[3] === 'false,false,tick,live,true,true'
    && seq[4] === 'false,false,off,live,true,true' && seq[5] === 'false,false,off,minute,true,true' && seq[6] === 'false,false,off,minute,false,true' && seq[7] === 'false,false,off,minute,false,false', seq.join(' | ')); }

// a rung that was given up is tried again after a good while, and goes again at once if it still does not fit
{ const c = new Capability({ rung: 3, retryMs: 600000 });
  c.retryAt = 600000;
  check('the richer rung is tried again after the retry time', c.report(100, 'glass', 700000) && c.rung === 2);
  c.retryAt = 600000; c.rung = 3; c.report(100, 'glass', 100000);
  check('... and not before it', c.rung === 3); }

// resolution first: the rungs do not go while a lower resolution would still help
{ const c = new Capability({ level: 9 });
  for (let i = 0; i < 4; i++) c.report(200, 'glass', i * 100);
  check('with room to lower the resolution a rung does not go', c.rung === 0 && c.level < 9, `rung ${c.rung} level ${c.level}`); }

// the sharp ladder keeps the output size at every level (digits stay sharp on a display)
check('the sharp ladder never lowers the output size', SHARP_LADDER.every((k) => k.outScale === 1));
{ const c = new Capability({ profile: 'sharp', level: 4 });
  for (let i = 0; i < 40; i++) c.report(400, 'glass', i * 500);
  check('on the sharp ladder frames that cost too much lower only the sky', c.knobs.outScale === 1 && c.gov.level < 4, `level ${c.gov.level}`); }

// a pin (for measuring) holds everything, and a user setting has no say: the ladder reads costs, not settings
{ const c = new Capability({ pin: true, rung: 2 });
  for (let i = 0; i < 20; i++) c.report(9000, 'glass', i * 1000);
  check('a pinned ladder does not move', c.rung === 2); }

// the budgets are ordered: later rungs allow slower redraws
check('the budgets grow down the ladder', BUDGET[3].glass < BUDGET[4].glass && BUDGET[4].glass < BUDGET[5].glass && BUDGET[3].scene < BUDGET[4].scene && BUDGET[4].scene < BUDGET[5].scene);
// the lead for drawing the next minute ahead of time covers the slowest recent redraw
{ const c = new Capability({ rung: 5 }); c.report(7000, 'glass', 0); c.report(6000, 'glass', 1);
  check('the lead covers the slowest redraw with margin', c.leadMs >= 7000 * 1.4, `${c.leadMs} ms`); }
done();
