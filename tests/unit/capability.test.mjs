// The capability ladder: the clock must always show the right time, so the engine gives things up in a fixed order until the cost fits, whatever the user chose.
// Run: node tests/unit/capability.test.mjs
import { check, done } from '../lib/check.mjs';
import { Capability, RUNGS, BUDGET } from '../../js/sky/capability.js';
import { LADDER, SHARP_LADDER } from '../../js/sky/governor.js';

const R = (name) => RUNGS.indexOf(name);
/** What a rung saves: the digits' glass costs 1 until the solid digits (about an eighth), the sky and ground cost 1 until their flat forms. */
const GLASS = (r) => (r >= R('solid digits') ? 0.13 : r >= R('weather') ? 0.95 : 1);
const SCENE = (r) => (r >= R('gradient sky') ? 0.02 : r >= R('flat ground') ? 0.3 : r >= R('ambient') ? 0.6 : r >= R('weather') ? 0.8 : 1);
/** A pretend machine: a redraw of the digits costs `fixed` + `perPx` per output pixel (x the level's output scale squared) at the glass rungs; a sky redraw costs `sceneBase` at the top level, scaled by the scene's size. */
function machine({ fixed = 45, perPx = 0.008, px = 160 * 90, sceneBase = 130 }) {
  return (c) => {
    const k = c.knobs, r = c.rung;
    return { glass: (fixed + perPx * px * k.outScale * k.outScale) * GLASS(r), scene: sceneBase * (px * k.scale * k.scale) / (160 * 90) * SCENE(r) };
  };
}
function run(cost, { profile = 'smooth', minutes = 90, rung = 0, pin = false, level } = {}) {
  const c = new Capability({ profile, rung, pin, level });
  let t = 0, last = c.rung, log = [];
  while (t < minutes * 60000) {
    const m = cost(c);
    const live = c.rung < R('seconds off');
    c.report(m.glass, 'glass', t);
    if (Math.floor(t / (live ? 6000 : 30000)) !== Math.floor((t - 1) / (live ? 6000 : 30000))) c.report(m.scene, 'scene', t);
    if (c.rung !== last) { log.push([Math.round(t / 1000), c.rung]); last = c.rung; }
    t += live ? Math.max(c.tickMs, m.glass) : c.rung < R('slow clock') ? 1000 : 60000;
  }
  return { c, log };
}
const inOrder = (log) => log.every(([, k], i) => k === (i ? log[i - 1][1] + 1 : 1));

// the order, and what each rung leaves
{ const c = new Capability({ rung: 0 }), seq = [];
  for (let i = 0; i < RUNGS.length; i++) { c.rung = i; const k = c.knobs; seq.push([k.weather, k.ambient, k.seconds, k.cadence, k.glass, k.landscape, k.sky].join()); }
  check('the rungs go in the order: weather, ambient motion, seconds (tick, off), the cadence, then glass, landscape, sky', JSON.stringify(RUNGS) === JSON.stringify(['full', 'weather', 'ambient', 'tick', 'seconds off', 'slow clock', 'solid digits', 'flat ground', 'gradient sky', 'smaller picture', 'smallest picture']));
  check('the seconds go before the glass and the real sky and ground do', R('tick') < R('solid digits') && R('seconds off') < R('solid digits') && R('slow clock') < R('solid digits') && R('seconds off') < R('flat ground') && R('seconds off') < R('gradient sky'));
  check('each rung takes exactly one more thing away (the last two shrink the picture)',
    seq[0] === 'true,true,morph,live,true,true,true' && seq[1] === 'false,true,morph,live,true,true,true' && seq[2] === 'false,false,morph,live,true,true,true' && seq[3] === 'false,false,tick,live,true,true,true'
    && seq[4] === 'false,false,off,live,true,true,true' && seq[5] === 'false,false,off,minute,true,true,true' && seq[6] === 'false,false,off,minute,false,true,true' && seq[7] === 'false,false,off,minute,false,false,true'
    && seq[8] === 'false,false,off,minute,false,false,false', seq.join(' | ')); }

// a fast desktop stays on rung 0 and reaches the top resolution
{ const r = run(machine({ fixed: 3, perPx: 0.0003, sceneBase: 8 }), { minutes: 10 });
  check('a fast machine stays on the full rung', r.c.rung === 0, `rung ${r.c.rung}`);
  check('... at the top resolution level', r.c.level === LADDER.length - 1, `level ${r.c.level}`); }

// a Zero on a 720p display (the digits' passes over the screen: 7 s; the sky at a quarter of the size: 1.7 s): the seconds go first and the clock settles on the slow clock with the glass and the real sky kept
{ const px = 1280 * 720, zero = machine({ fixed: 45, perPx: 0.0075, px, sceneBase: 3300 * px / 113000 });
  const r = run(zero, { profile: 'sharp', minutes: 60 });
  check('the Zero on 720p gives up the seconds and settles on the slow clock, keeping its glass, ground and sky', r.c.rung === R('slow clock'), `rung ${r.c.rung} (${r.c.name})`);
  const k = r.c.knobs;
  check('... the picture is as rich as the full one (glass, landscape, sky) and not smaller', k.glass && k.landscape && k.sky && k.outScale === 1);
  check('the rungs were given up in order, none skipped, and a rung that missed by a lot was not tried again within the hour', inOrder(r.log), JSON.stringify(r.log)); }
// a Zero on 1080p: the digits' passes take 17 s: a minute is enough to draw the next picture ahead, so the slow clock holds at full size
{ const px = 1920 * 1080, r = run(machine({ fixed: 45, perPx: 0.0075 * 0.68, px, sceneBase: 3300 * px / 113000 }), { profile: 'sharp', minutes: 90 });
  check('the Zero on 1080p holds the slow clock at full size (a 14 s redraw is drawn ahead of the minute)', r.c.rung === R('slow clock') && r.c.knobs.outScale === 1 && r.c.knobs.glass, `rung ${r.c.rung}, outScale ${r.c.knobs.outScale}`); }
// a machine whose picture takes more than a minute even on the slow clock loses the glass, then the landscape, then the sky, before the picture shrinks
{ const r = run((c) => ({ glass: c.rung >= R('solid digits') ? 30000 : 90000, scene: c.rung >= R('gradient sky') ? 1000 : c.rung >= R('flat ground') ? 30000 : 90000 }), { minutes: 300 });
  check('a picture that takes 90 s goes solid, then flat ground (the sky then takes 30 s, which fits), in that order and no further', inOrder(r.log) && r.c.rung === R('flat ground'), JSON.stringify(r.log) + ' rung ' + r.c.rung); }
// the Zero on its 160 x 90 test picture holds a live clock (about 15 fps) with at most the cheap looks given up
{ const r = run(machine({ fixed: 45, perPx: 0.0065, px: 160 * 90, sceneBase: 300 }), { minutes: 20 });
  check('the Zero at 160 x 90 stays on a live rung before the seconds', r.c.rung <= R('tick'), `rung ${r.c.rung}`); }

// a hopeless machine ends on the last rung and the clock still ticks (the knobs say what to draw)
{ const r = run(() => ({ glass: 60000, scene: 600000 }), { minutes: 120 });
  check('a hopeless machine ends on the last rung', r.c.rung === RUNGS.length - 1, `rung ${r.c.rung}`);
  const k = r.c.knobs;
  check('... with the smallest picture', k.outScale <= 0.25, `outScale ${k.outScale}`);
  check('... flat everything, no seconds, one picture a minute, nothing moving', !k.glass && !k.landscape && !k.sky && k.seconds === 'off' && k.cadence === 'minute' && !k.weather && !k.ambient); }

// a rung that was given up is tried again after a good while, and goes again at once if it still does not fit
{ const c = new Capability({ rung: R('tick'), retryMs: 600000 });
  c.retryAt = 600000;
  check('the richer rung is tried again after the retry time', c.report(100, 'glass', 700000) && c.rung === R('tick') - 1);
  c.retryAt = 600000; c.rung = R('tick'); c.report(100, 'glass', 100000);
  check('... and not before it', c.rung === R('tick')); }

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
check('the budgets grow down the ladder', BUDGET[R('tick')].glass < BUDGET[R('seconds off')].glass && BUDGET[R('seconds off')].glass < BUDGET[R('slow clock')].glass && BUDGET[R('tick')].scene < BUDGET[R('seconds off')].scene && BUDGET[R('seconds off')].scene < BUDGET[R('slow clock')].scene);
// the lead for drawing the next minute ahead of time covers the slowest recent redraw
{ const c = new Capability({ rung: R('slow clock') }); c.report(7000, 'glass', 0); c.report(6000, 'glass', 1);
  check('the lead covers the slowest redraw with margin', c.leadMs >= 7000 * 1.4, `${c.leadMs} ms`); }
done();
