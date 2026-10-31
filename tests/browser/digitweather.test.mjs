// Rain and snow on the digits: snow settles on the top edges, rain beads on the glass; only in the glass styles, only
// while it is raining or snowing, switchable, edge-thin, and the time stays readable.
export const name = 'digitweather';

const wx = (page) => page.evaluate(() => ({ ...window.__sky.wx }));
const GLASS = { clockStyle: 'glass', hideSeconds: false, followSun: false, glassFrost: 0.3 };
const open = (t, weather, conf = {}, extra = '') => t.open({ query: `t=2026-12-10T17:08:25Z&speed=0&weather=${weather}${extra}`, conf: { ...GLASS, ...conf }, width: 420, height: 700 });

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
  // ---- snow ----
  let r = await onOff(t, 'snow', {}, 28);                 // snow is white on a pale sky: a low threshold
  t.check('snowing: the digits carry snow (the effect is on, and only snow)', r.wa.snow > 0.2 && r.wa.rain === 0, JSON.stringify(r.wa));
  t.check('with the setting off there is nothing on the digits', r.wb.snow === 0 && r.wb.rain === 0, JSON.stringify(r.wb));
  t.check('snow changes the digits: far more pixels differ in the clock\'s box with it on than between two pages with it off', r.eff > r.noise * 2 + 150, `${r.eff} px vs noise ${r.noise}`);
  t.check('snow: no errors', r.errors.length === 0, r.errors.join(' | '));

  // ---- rain ----
  r = await onOff(t, 'rain', {}, 45);                     // beads are darker rims and bright glints: a higher one keeps the thin streaks out
  t.check('raining: the digits are wet (and not snowy)', r.wa.rain > 0.2 && r.wa.snow === 0, JSON.stringify(r.wa));
  // falling streaks differ from page to page and drown the beads in a pixel count, so for rain the picture check is only that beads show at all; the uniform above is the precise check
  t.check('rain beads show on the digits (some pixels in the clock\'s box differ with the effect on)', r.eff > 40, `${r.eff} px (streak noise ${r.noise})`);
  t.check('rain: no errors', r.errors.length === 0, r.errors.join(' | '));

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
}
