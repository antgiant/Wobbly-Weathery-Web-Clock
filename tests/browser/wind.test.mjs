// Wind sway: the digits lean downwind (bottom fixed, top moved), off by default, no gusts while saving power, readable.
import { MAX_LEAN, MAX_GUST } from '../../js/wind.js';
export const name = 'wind';
export const covers = 'Wind sway: lean direction and size, readable cap, gusts, power saving, live switching';
export const tier = 'fast';          // part of the quick check (npm test); the suite does only its core when t.quick is set

// the control points of every visible digit path, as [[x, y], ...] per digit id
const digits = (page) => page.evaluate(() => {
  const out = {};
  for (const id of ['h1', 'm0', 'm1', 's0', 's1']) {
    const pts = [];
    for (let i = 0; i < 4; i++) { const d = document.getElementById(`${id}p${i}`)?.getAttribute('d') || ''; const n = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number); for (let k = 0; k + 1 < n.length; k += 2) pts.push([n[k], n[k + 1]]); }
    out[id] = pts;
  }
  return out;
});
const lean = (pts) => { const top = pts.filter((p) => p[1] < 150), bot = pts.filter((p) => p[1] > 380); const m = (a) => a.reduce((s, p) => s + p[0], 0) / (a.length || 1); return top.length && bot.length ? m(top) - m(bot) : 0; };
const meanLean = (d) => Object.values(d).reduce((s, p) => s + lean(p), 0) / Object.keys(d).length;
const STILL = { clockStyle: 'solid', hideSeconds: false, followSun: false };

export async function run(t) {
  const q = (az, conf, weather = 'storm', extra = '') => t.open({ fast: true, query: `t=2026-06-21T17:08:25Z&speed=0&weather=${weather}&az=${az}${extra}`, conf: { ...STILL, ...conf }, width: 420, height: 700 });

  let h = await q(0, {});
  t.check('off by default: nothing is bent', (await h.page.evaluate(async () => (await import('/js/wind.js')).sway.mode)) === 'off');
  await h.settle(1500);
  const straight = await digits(h.page);
  const base = meanLean(straight);
  await h.close();

  h = await q(0, { windSway: 'lean' });
  await h.settle(3000);
  const north = await digits(h.page);
  const st = await h.page.evaluate(async () => { const { sway } = await import('/js/wind.js'); return { ...sway }; });
  t.check('storm wind (towards the east-north-east) seen looking north: the tops lean right', meanLean(north) - base > 10, `${(meanLean(north) - base).toFixed(1)} units`);
  t.check('lean-only mode has no gusts (the digits are not redrawn all the time)', st.mode === 'lean' && st.flutter === false);
  const dots = await h.page.evaluate(() => [...document.querySelectorAll('#clock svg')].filter((e) => !e.querySelector('path[id]')).flatMap((e) => [...e.querySelectorAll('path')].map((p) => (p.getAttribute('d').match(/-?\d+(\.\d+)?/g) || []).map(Number))));
  t.check('the colon leans with the digits: the top dot moves downwind, more than the bottom one, and neither moves up or down', dots.length >= 2 && dots.every((d) => d.length >= 8 && d[1] === d[3] && d[5] === d[7]) && dots.filter((d) => d[1] < 200).every((d) => d[0] > 49) && dots.filter((d) => d[1] > 300).every((d) => d[0] >= 48) && Math.min(...dots.filter((d) => d[1] < 200).map((d) => d[0])) > Math.max(...dots.filter((d) => d[1] > 300).map((d) => d[0])), JSON.stringify(dots));
  const moved = Object.entries(north).map(([k, p]) => Math.max(...p.map((pt, i) => Math.abs(pt[0] - straight[k][i][0]))));
  t.check(`no control point moves more than the cap (${MAX_LEAN + MAX_GUST} units): the time stays readable`, Math.max(...moved) <= MAX_LEAN + MAX_GUST + 0.5, moved.map((x) => x.toFixed(0)).join(' '));
  t.check('the bottom of every digit stays where it was', Object.entries(north).every(([k, p]) => p.every((pt, i) => straight[k][i][1] !== pt[1] ? false : (pt[1] < 440 || Math.abs(pt[0] - straight[k][i][0]) < 1))));
  t.check('the heights are untouched (only sideways)', Object.entries(north).every(([k, p]) => p.every((pt, i) => pt[1] === straight[k][i][1])));
  const shot = await h.shot('wind-lean-north');
  const ink = await t.analyze(h.page, shot, ({ w, h: hh, lum }) => { let n = 0; for (let y = Math.floor(hh * 0.3); y < hh * 0.65; y += 2) for (let x = 0; x < w; x += 2) if (lum(x, y) < 0.25) n++; return n; });
  t.check('the digits are still drawn, dark and solid, on the picture', ink > 300, `${ink} dark samples`);
  t.check('no errors', h.errors.length === 0, h.errors.join(' | '));
  await h.close();

  h = await q(180, { windSway: 'lean' });
  await h.settle(3000);
  const south = meanLean(await digits(h.page));
  t.check('the same wind seen looking south: the tops lean left', south - base < -10, `${(south - base).toFixed(1)} units`);
  t.check('and it is the mirror of the first (equal and opposite)', Math.abs((south - base) + (meanLean(north) - base)) < 4);
  await h.close();
  if (t.quick) return;                                              // the quick check stops here: the rest is in the full run

  h = await q(0, { windSway: 'lean' }, 'clear');
  await h.settle(2500);
  const calm = meanLean(await digits(h.page));
  t.check('a clear sky has only a light wind: a much smaller lean than the storm', Math.abs(calm - base) < Math.abs(meanLean(north) - base) * 0.8, `${(calm - base).toFixed(1)} vs ${(meanLean(north) - base).toFixed(1)}`);
  await h.close();

  h = await q(90, { windSway: 'lean' });
  await h.settle(3000);
  t.check('looking straight into a wind that blows towards the east-north-east: almost no sideways lean (it is mostly head-on)', Math.abs(meanLean(await digits(h.page)) - base) < Math.abs(meanLean(north) - base) * 0.6);
  await h.close();

  // gusts: the digits keep moving, but not while saving power
  h = await q(0, { windSway: 'full' });
  await h.settle(2500);
  const a = await digits(h.page); let b = a;
  for (let i = 0; i < 24 && JSON.stringify(a.m0) === JSON.stringify(b.m0); i++) { await h.page.waitForTimeout(500); b = await digits(h.page); }      // (a slow machine takes longer than a second to draw the next shape: wait for it, up to twelve seconds)
  t.check('lean and gusts: the digits flutter (the shapes change from second to second even when the minute does not)', JSON.stringify(a.m0) !== JSON.stringify(b.m0));
  const fl = await h.page.evaluate(async () => (await import('/js/wind.js')).sway.flutter);
  t.check('gusts are on in a storm at normal power', fl === true);
  await h.close();
  h = await q(0, { windSway: 'full', quality: 'low' });
  await h.settle(2500);
  const fl2 = await h.page.evaluate(async () => { const { sway } = await import('/js/wind.js'); return { flutter: sway.flutter, lean: sway.lean }; });
  t.check('saving power: no gusts, but the steady lean stays (it costs nothing)', fl2.flutter === false && Math.abs(fl2.lean) > 10, JSON.stringify(fl2));
  await h.close();

  // switching in the settings, live, and back
  h = await q(0, {});
  await h.page.evaluate(() => document.getElementById('settings').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await h.page.waitForTimeout(400);
  await h.page.evaluate(() => { const s = document.getElementById('windSway'); s.value = 'lean'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await h.page.waitForTimeout(1800);
  t.check('choosing "Lean" in settings bends the digits at once', meanLean(await digits(h.page)) - base > 10);
  await h.page.evaluate(() => { const s = document.getElementById('windSway'); s.value = 'off'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await h.page.waitForTimeout(1800);
  t.check('choosing "Off" stands them straight again', Math.abs(meanLean(await digits(h.page)) - base) < 1);
  t.check('and the colon stands straight again too (its dots back where they started)', await h.page.evaluate(() => [...document.querySelectorAll('#clock svg')].filter((e) => !e.querySelector('path[id]')).flatMap((e) => [...e.querySelectorAll('path')].map((p) => p.getAttribute('d'))).every((d) => /^M\s*48 /.test(d))));
  t.check('no errors', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}
