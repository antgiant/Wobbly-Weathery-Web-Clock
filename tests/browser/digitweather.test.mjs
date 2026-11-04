// Rain and snow on the digits: snow settles on the top edges, rain beads on the glass; only in the glass styles, only
// while it is raining or snowing, switchable, edge-thin, and the time stays readable.
export const name = 'digitweather';
export const covers = 'Rain beads and snow caps on the digits (glass, tube, LED), switching, shader compiles';
export const tier = 'fast';          // part of the quick check (npm test); the suite does only its core when t.quick is set

const wx = (page) => page.evaluate(() => ({ ...window.__sky.wx }));
const GLASS = { clockStyle: 'glass', hideSeconds: false, followSun: false, glassFrost: 0.3 };
const open = (t, weather, conf = {}, extra = '') => t.open({ fast: true, query: `t=2026-12-10T17:08:25Z&speed=0&weather=${weather}${extra}`, conf: { ...GLASS, ...conf }, width: 420, height: 700 });

// bounding box of the digits (from the page's own layout), and a screenshot
const box = (page) => page.evaluate(() => { const r = [...document.querySelectorAll('#clock svg')].filter((e) => getComputedStyle(e).display !== 'none' && e.querySelector('path[id]')).map((e) => e.getBoundingClientRect()); return { x0: Math.min(...r.map((a) => a.left)), y0: Math.min(...r.map((a) => a.top)), x1: Math.max(...r.map((a) => a.right)), y1: Math.max(...r.map((a) => a.bottom)) }; });

async function onOff(t, weather, conf, thr) {
  const a = await open(t, weather, { ...conf, digitWeather: 'on' }), b = await open(t, weather, { ...conf, digitWeather: 'off' }), c = await open(t, weather, { ...conf, digitWeather: 'off' });
  await a.settle(1500); await b.settle(1500); await c.settle(1500);
  const bx = await box(a.page);
  const sa = await a.shot(`digitweather-${weather}-on`), sb = await b.shot(`digitweather-${weather}-off`), sc = await c.shot();
  // inside the clock's box: how many pixels differ with the effect on, against two pages with it off (the falling flakes and streaks differ every time: that is the noise to beat)
  const eff = await t.diffBox(a.page, sa, sb, thr, bx, 4), noise = await t.diffBox(a.page, sb, sc, thr, bx, 4);
  const wa = await wx(a.page), wb = await wx(b.page);
  const errors = [...a.errors, ...b.errors, ...c.errors];
  await a.close(); await b.close(); await c.close();
  return { eff: eff.inside, noise: noise.inside, wa, wb, errors };
}

export async function run(t) {
  if (t.quick) {                                                      // the quick check: rain on the glass, snow on the LED panel (the shader compiles and draws both), nothing else
    for (const [weather, conf, key] of [['rain', {}, 'rain'], ['snow', { clockStyle: 'solid', screenMode: 'led', ledCols: 64, ledRows: 32 }, 'snow']]) {
      const h = await open(t, weather, conf);
      await h.settle(900);
      const w = await wx(h.page);
      t.check(`${weather}${conf.clockStyle ? ' (' + conf.clockStyle + (conf.screenMode ? ', LED' : '') + ')' : ''}: the digits carry ${key}, no errors`, w[key] > 0.2 && h.errors.length === 0, `${JSON.stringify(w)} ${h.errors.join(' | ')}`);
      await h.close();
    }
    return;
  }
  // ---- snow ----
  let r = await onOff(t, 'snow', {}, 28);                 // snow is white on a pale sky: a low threshold
  t.check('snowing: the digits carry snow (the effect is on, and only snow)', r.wa.snow > 0.2 && r.wa.rain === 0, JSON.stringify(r.wa));
  t.check('with the setting off there is nothing on the digits', r.wb.snow === 0 && r.wb.rain === 0, JSON.stringify(r.wb));
  t.check('snow changes the digits: clearly more pixels differ in the clock\'s box with it on than between two pages with it off', r.eff > r.noise + 150, `${r.eff} px vs noise ${r.noise}`);
  t.check('snow: no errors', r.errors.length === 0, r.errors.join(' | '));

  // ---- rain: the drops are a simulation (below), so here only that raining makes the digits wet and is drawn without errors ----
  const wet = await open(t, 'rain');
  await wet.settle(2500);
  const ww = await wx(wet.page), dropsOn = await wet.page.evaluate(() => window.__sky.glass.dropsOn && window.__drops.drops.length > 0);
  t.check('raining: the digits are wet (and not snowy), and the drop simulation has drops on the glass', ww.rain > 0.2 && ww.snow === 0 && dropsOn, JSON.stringify({ ww, dropsOn }));
  t.check('rain: no errors', wet.errors.length === 0, wet.errors.join(' | '));
  r = { wa: ww };
  await wet.close();

  // ---- the stronger the weather the more: a storm is wetter than a shower ----
  const st = await open(t, 'storm');
  const ws = await wx(st.page);
  t.check('a thunderstorm wets the digits more than rain does', ws.rain > r.wa.rain, `${ws.rain.toFixed(2)} vs ${r.wa.rain.toFixed(2)}`);
  await st.close();

  // ---- dry weather: nothing ----
  const clear = await open(t, 'clear');
  t.check('clear sky: nothing on the digits', JSON.stringify(await wx(clear.page)) === JSON.stringify({ snow: 0, rain: 0 }));
  await clear.close();

  // ---- the coloured tube and the LED panel get it too; flat colour is left alone ----
  const tube = await open(t, 'snow', { clockStyle: 'stained' });
  t.check('coloured tube: snow on it too', (await wx(tube.page)).snow > 0.2 && tube.errors.length === 0, tube.errors.join(' | '));
  await tube.close();
  const led = await open(t, 'snow', { clockStyle: 'solid', screenMode: 'led', ledCols: 64, ledRows: 32 });
  await led.settle(1200);
  t.check('LED panel: snow on it too, and no errors', (await wx(led.page)).snow > 0.2 && led.errors.length === 0, led.errors.join(' | '));
  await led.close();

  // ---- switching it in the settings ----
  const s = await open(t, 'snow', {});
  await s.page.evaluate(() => document.getElementById('settings').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await s.page.waitForTimeout(400);
  await s.page.evaluate(() => { const e = document.getElementById('digitWeather'); e.value = 'off'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await s.page.waitForTimeout(1500);
  t.check('choosing Off in settings clears it at once', (await wx(s.page)).snow === 0);
  await s.page.evaluate(() => { const e = document.getElementById('digitWeather'); e.value = 'on'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await s.page.waitForTimeout(1500);
  t.check('and On brings it back', (await wx(s.page)).snow > 0.2);
  await s.close();

  // ---- raindrops: a simulation, not a pattern (js/sky/drops.js) ----
  const rd = await t.open({ fast: true, query: 't=2026-12-10T17:08:50Z&speed=1&weather=rain', conf: { ...GLASS, hideSeconds: false }, width: 420, height: 700 });
  await rd.page.waitForTimeout(9000);
  const snap = () => rd.page.evaluate(() => { const s = window.__drops; return { n: s.drops.length, onGlass: s.drops.filter((d) => !d.dying).every((d) => s.inkAt(d.x, d.y) > 0.25), running: s.drops.filter((d) => d.run).length, big: Math.max(0, ...s.drops.map((d) => d.r)), text: document.title, dying: s.drops.filter((d) => d.dying).length }; });
  const a = await snap();
  t.check('rain forms drops on the digits (a simulation is running), and every one is on the glass', a.n > 5 && a.onGlass, JSON.stringify(a));
  // follow single drops for a while: they only ever move down, and they grow before they run
  const trk = await rd.page.evaluate(async () => {
    const s = window.__drops, seen = new Map(); let upward = 0, ran = 0, grew = 0;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      for (const d of s.drops) { if (d.dying) continue; const p = seen.get(d); if (p) { if (d.run && d.y < p.y - 0.01 && Math.abs(d.r - p.r) < 0.01) upward++; if (d.run && d.y > p.y + 0.01) ran++; if (!d.run && d.r > p.r + 1e-6) grew++; } seen.set(d, { y: d.y, r: d.r }); }
    }
    return { upward, ran, grew, count: s.drops.length };
  });
  t.check('drops run down (never up) and sitting drops grow', trk.ran > 0 && trk.upward === 0 && trk.grew > 0, JSON.stringify(trk));
  // the digits change under the drops (12:08:50 -> 12:09:00 at speed 1): drops that lose their glass are shed, none is left on empty glass
  await rd.page.waitForFunction(() => /^12:09/.test(document.title), null, { timeout: 40000 }).catch(() => {});
  await rd.page.waitForTimeout(1200);
  const b = await snap();
  t.check('after the digit changed, no live drop sits where there is no glass', b.onGlass, JSON.stringify(b));
  t.check('rain drops: no errors', rd.errors.length === 0, rd.errors.join(' | '));
  await rd.close();
}
