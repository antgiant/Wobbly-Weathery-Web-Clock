// Where settings live (Simple or Advanced), the automatic clock style on battery saver, the iPhone install walkthrough,
// the other things to count down to, and the Everyday presets.
import { sunEvents, at } from '../lib/astro.mjs';
export const name = 'options';

const open = (page) => page.evaluate(() => document.getElementById('settings').dispatchEvent(new MouseEvent('click', { bubbles: true })));
const style = (page) => page.evaluate(() => document.body.dataset.clockstyle);
const pill = (page) => page.evaluate(() => { const e = document.getElementById('sunCountdown'); return e.hidden ? null : e.textContent.replace(/\s+/g, ' ').trim(); });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

export async function run(t) {
  // ---- Simple and Advanced ----
  let h = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0', width: 420, height: 800 });
  await open(h.page);
  await h.page.waitForTimeout(400);
  const shown = (id) => h.page.evaluate((i) => { const e = document.getElementById(i); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; }, id);
  const moved = ['tempUnit', 'showLabels', 'screenMode', 'countdownKind'];
  const tabOf = { tempUnit: 'scene', showLabels: 'view', screenMode: 'display', countdownKind: 'display' };
  for (const id of moved) {
    await h.page.click(`.tab[data-tab="${tabOf[id]}"]`);
    t.check(`Simple: ${id} is not shown`, !(await shown(id)));
  }
  await h.page.click('.seg__btn[data-level="advanced"]');
  for (const id of moved) {
    await h.page.click(`.tab[data-tab="${tabOf[id]}"]`);
    t.check(`Advanced: ${id} is shown`, await shown(id));
  }
  await h.page.click('.seg__btn[data-level="simple"]');
  await h.page.click('.tab[data-tab="presets"]');
  t.check('Presets panel: the Offline block is the last one', await h.page.evaluate(() => { const g = [...document.querySelectorAll('#panel-presets .group')]; return g[g.length - 1].querySelector('#offlineStatus') !== null; }));
  t.check('no preset card mentions labels', await h.page.evaluate(() => ![...document.querySelectorAll('#presetList .preset')].some((b) => /label/i.test(b.textContent))));
  await h.close();

  // ---- Everyday presets, applied through the real controls ----
  h = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0', width: 420, height: 800, conf: { showLabels: true, countdownKind: 'moon' } });
  await open(h.page);
  await h.page.waitForTimeout(400);
  await h.page.click('.preset[data-preset="everyday"]');
  await h.page.waitForTimeout(500);
  let c = await h.page.evaluate(() => JSON.parse(localStorage.getItem('conf')));
  t.check('Everyday: no seconds, dims at night, umbrella alert, countdowns, screen on, automatic digits', c.hideSeconds === true && c.nightDim === 'auto' && c.rainAlert === true && c.countdown === 'both' && c.keepAwake === true && c.clockStyle === 'auto' && c.screenMode === 'normal');
  t.check('and it leaves the labels and the countdown kind as the person chose them', c.showLabels === true && c.countdownKind === 'moon');
  await h.page.click('.preset[data-preset="everyday-saver"]');
  await h.page.waitForTimeout(800);
  c = await h.page.evaluate(() => JSON.parse(localStorage.getItem('conf')));
  t.check('Everyday, power saver: LED panel, low quality, still sky, no plants, screen still on', c.screenMode === 'led' && c.quality === 'low' && c.cloudMotion === 0 && c.plants === false && c.keepAwake === true && c.rainAlert === true);
  t.check('its card shows as the one in use', await h.page.evaluate(() => document.querySelector('.preset[data-preset="everyday-saver"]').getAttribute('aria-pressed') === 'true'));
  t.check('the page really is an LED panel now, and the automatic style is flat colour', await h.page.evaluate(() => document.body.dataset.led !== undefined && document.body.dataset.clockstyle === 'led'));
  t.check('no errors', h.errors.length === 0, h.errors.join(' | '));
  await h.close();

  // ---- the automatic digit style ----
  for (const [when, quality, expect, label] of [
    ['2026-07-04T17:00:00Z', 'medium', 'glass', 'July'],
    ['2026-07-04T17:00:00Z', 'low', 'solid', 'July on battery saver'],
    ['2026-12-10T17:00:00Z', 'medium', 'stained', 'December'],
    ['2026-12-10T17:00:00Z', 'low', 'solid', 'December on battery saver'],
  ]) {
    h = await t.open({ query: `t=${when}&speed=0`, conf: { clockStyle: 'auto', quality } });
    const s = await style(h.page);
    t.check(`Automatic, ${label}: ${expect === 'glass' ? 'liquid glass' : expect === 'stained' ? 'coloured lights' : 'flat colour'}`, s === expect, s);
    await h.close();
  }
  h = await t.open({ query: 't=2026-07-04T17:00:00Z&speed=0', conf: { clockStyle: 'auto', quality: 'medium' } });
  await open(h.page);
  await h.page.waitForTimeout(400);
  await h.page.evaluate(() => { const q = document.getElementById('quality'); q.value = 'low'; q.dispatchEvent(new Event('change', { bubbles: true })); });
  await h.page.waitForTimeout(600);
  t.check('choosing Low quality turns Automatic into flat colour at once, and Medium brings the glass back', (await style(h.page)) === 'solid' && await h.page.evaluate(async () => { const q = document.getElementById('quality'); q.value = 'medium'; q.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((r) => setTimeout(r, 600)); return document.body.dataset.clockstyle === 'glass'; }));
  await h.page.evaluate(() => { window.dispatchEvent(new Event('powerchange')); });
  t.check('a power change event is harmless', h.errors.length === 0);
  await h.close();

  // ---- the iPhone install walkthrough ----
  h = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0', width: 390, height: 844, touch: true, context: { userAgent: IPHONE, isMobile: true } });
  await open(h.page);
  await h.page.waitForTimeout(500);
  const btn = () => h.page.evaluate(() => { const b = document.getElementById('installButton'), g = document.getElementById('installGroup'); return { group: !g.hidden, button: !b.hidden, text: b.textContent }; });
  const b0 = await btn();
  t.check('on an iPhone the Install block shows a "Show me how" button (it used to be a line of text)', b0.group && b0.button && /show me how/i.test(b0.text), JSON.stringify(b0));
  t.check('the walkthrough is closed to begin with', await h.page.evaluate(() => document.getElementById('installModal').hidden));
  await h.page.click('#installButton');
  await h.page.waitForTimeout(300);
  const dlg = await h.page.evaluate(() => { const m = document.getElementById('installModal'), r = m.querySelector('.welcome__card').getBoundingClientRect(); return { open: !m.hidden, steps: m.querySelectorAll('.steps li').length, text: m.textContent, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; });
  t.check('clicking it opens a dialog with three steps: Share, Add to Home Screen, Add', dlg.open && dlg.steps === 3 && /Share/.test(dlg.text) && /Add to Home Screen/.test(dlg.text) && /“Add”/.test(dlg.text), JSON.stringify({ ...dlg, text: undefined }));
  t.check('the dialog fits the phone screen', dlg.inside);
  await h.page.click('#installDone');
  t.check('"Got it" closes it', await h.page.evaluate(() => document.getElementById('installModal').hidden));
  await h.page.click('#installButton');
  await h.page.keyboard.press('Escape');
  t.check('Escape closes it too', await h.page.evaluate(() => document.getElementById('installModal').hidden));
  await h.close();
  h = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0', width: 1000, height: 700 });
  t.check('on a desktop browser with no install prompt the Install block stays hidden', await h.page.evaluate(() => document.getElementById('installGroup').hidden));
  await h.close();

  // ---- what to count down to ----
  const civil = sunEvents(new Date('2026-06-21T12:00:00Z'), 40.7, -74, 0, 'civil').nextSet;
  h = await t.open({ query: `t=${at(civil, -4 * 60e3 - 30e3)}&speed=0`, conf: { countdown: 'both', countdownKind: 'civil', countdownLead: 20, clockStyle: 'solid' } });
  await h.settle(1800);
  let p = await pill(h.page);
  t.check('four minutes before civil dusk the pill says "Civil dusk in 04:..."', p && /Civil dusk in\s*0?[34]:\d\d/.test(p), String(p));
  await h.close();
  const moon = sunEvents(new Date('2026-06-21T12:00:00Z'), 40.7, -74, 0, 'moon').nextRise;
  h = await t.open({ query: `t=${at(moon, -3 * 60e3)}&speed=0`, conf: { countdown: 'both', countdownKind: 'moon', countdownLead: 20, clockStyle: 'solid' } });
  await h.settle(1800);
  p = await pill(h.page);
  t.check('three minutes before moonrise the pill says "Moonrise in 0x:xx" with a moon', p && /Moonrise in\s*0?[23]:\d\d/.test(p) && /☾/.test(p), String(p));
  t.check('and the pill is marked as a moon one', await h.page.evaluate(() => document.getElementById('sunCountdown').dataset.body) === 'moon');
  await h.close();
  const gold = sunEvents(new Date('2026-06-21T12:00:00Z'), 40.7, -74, 0, 'golden').nextSet;
  h = await t.open({ query: `t=${at(gold, -2 * 60e3)}&speed=0`, conf: { countdown: 'sunset', countdownKind: 'golden', countdownLead: 20, clockStyle: 'solid' } });
  await h.settle(1800);
  p = await pill(h.page);
  t.check('two minutes before golden hour: "Golden hour in 01:..."', p && /Golden hour in\s*0?[12]:\d\d/.test(p), String(p));
  await h.close();
  // on the LED panel the same countdown is drawn as pixels with a moon
  h = await t.open({ query: `t=${at(moon, -3 * 60e3)}&speed=0`, width: 800, height: 500, conf: { countdown: 'both', countdownKind: 'moon', countdownLead: 20, screenMode: 'led', ledCols: 64, ledRows: 32, clockStyle: 'solid' } });
  await h.settle(2500);
  t.check('LED panel: the moonrise countdown is a pixel card (and the panel is not blank)', await h.page.evaluate(() => window.__sky.glass.overlay === true));
  t.check('LED panel: no errors', h.errors.length === 0, h.errors.join(' | '));
  await h.close();

  // ---- anti burn-in: the digits step round a small square once a minute while the screen is kept on ----
  const walk = async (h) => h.page.evaluate(async () => {
    const m = await import('/js/sky/burnin.js');
    const out = [];
    for (let i = 0; i < 10; i++) {
      m.updateBurnIn();
      const clock = document.getElementById('clock'), svgs = [...clock.querySelectorAll('svg')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.getBoundingClientRect());
      out.push({ x: parseFloat(document.documentElement.style.getPropertyValue('--burn-x')) || 0, y: parseFloat(document.documentElement.style.getPropertyValue('--burn-y')) || 0,
        left: Math.min(...svgs.map((r) => r.left)), right: Math.max(...svgs.map((r) => r.right)), top: Math.min(...svgs.map((r) => r.top)), bottom: Math.max(...svgs.map((r) => r.bottom)), tx: new DOMMatrix(getComputedStyle(clock).transform).m41 });
    }
    return { out, w: innerWidth, h: innerHeight };
  });
  h = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0', width: 420, height: 800, conf: { keepAwake: true, clockStyle: 'solid' } });
  let b = await walk(h);
  const places = new Set(b.out.map((o) => `${o.x},${o.y}`));
  t.check('keep-awake on: the digits visit nine places in ten steps and come back to the first', places.size === 9 && b.out[0].x === b.out[9].x && b.out[0].y === b.out[9].y, [...places].join(' | '));
  t.check('no step is more than 10 px, and the page really moves by it', b.out.every((o) => Math.abs(o.x) <= 10 && Math.abs(o.y) <= 10 && Math.abs(o.tx - o.x) < 0.01) && b.out.some((o) => o.x !== 0));
  t.check('the digits stay on the screen at every step', b.out.every((o) => o.left >= 0 && o.right <= b.w && o.top >= 0 && o.bottom <= b.h));
  await h.page.waitForTimeout(300);
  t.check('and nothing went wrong', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
  for (const [label, cf] of [['Never', { keepAwake: true, antiBurnIn: 'off' }], ['Automatic with the screen not kept on', { keepAwake: false }]]) {
    h = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0', width: 420, height: 800, conf: { clockStyle: 'solid', ...cf } });
    b = await walk(h);
    t.check(`${label}: the digits never move`, b.out.every((o) => o.x === 0 && o.y === 0 && o.tx === 0));
    await h.close();
  }
  h = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0', width: 420, height: 800, conf: { keepAwake: false, antiBurnIn: 'on', clockStyle: 'solid' } });
  b = await walk(h);
  t.check('Always: it moves even when the screen is not kept on', b.out.some((o) => o.x !== 0));
  await h.page.evaluate(() => { const s = document.getElementById('antiBurnIn'); s.value = 'off'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await h.page.waitForTimeout(300);
  t.check('switching it off puts the digits back in the middle at once', await h.page.evaluate(() => document.documentElement.style.getPropertyValue('--burn-x') === '0px' && document.documentElement.style.getPropertyValue('--burn-y') === '0px'));
  await h.close();
  h = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0', width: 800, height: 500, conf: { keepAwake: true, screenMode: 'led', ledCols: 64, ledRows: 32, clockStyle: 'solid' } });
  b = await walk(h);
  const cell = await h.page.evaluate(() => { const p = window.__sky.glass.led; return Math.min(window.__sky.canvas.clientWidth / p.cols, window.__sky.canvas.clientHeight / p.rows); });
  t.check('LED panel: every step is a whole number of LEDs', b.out.every((o) => Math.abs(o.x / cell - Math.round(o.x / cell)) < 0.02 && Math.abs(o.y / cell - Math.round(o.y / cell)) < 0.02), `cell ${cell.toFixed(2)} px: ${[...new Set(b.out.map((o) => `${o.x},${o.y}`))].join(' | ')}`);
  t.check('LED panel: the digits stay on the screen', b.out.every((o) => o.left >= 0 && o.right <= b.w && o.top >= 0 && o.bottom <= b.h));
  t.check('LED panel: no errors', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}
