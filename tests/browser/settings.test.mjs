// The settings panel: opens on the presets, presets and reset work through the real controls, tabs and Simple / Advanced.
export const name = 'settings';

const open = (page) => page.evaluate(() => document.getElementById('settings').dispatchEvent(new MouseEvent('click', { bubbles: true })));
const conf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('conf')));

export async function run(t) {
  const h = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0', width: 390, height: 844, touch: true, conf: { clockStyle: 'glass' } });
  const { page } = h;
  await open(page);
  await page.waitForTimeout(400);
  t.check('settings open on the Presets tab', await page.evaluate(() => document.querySelector('.tab[aria-selected="true"]').dataset.tab) === 'presets');
  t.check('there are seven presets, each a button with a name and a note', await page.evaluate(() => [...document.querySelectorAll('#presetList .preset')].filter((b) => b.querySelector('strong') && b.querySelector('small')).length) === 7);
  t.check('the tab order starts with Presets', await page.evaluate(() => [...document.querySelectorAll('.tab')].map((x) => x.dataset.tab).join()) === 'presets,clock,scene,view,display,place');
  t.check('on a phone the panel is a bottom sheet (anchored to the bottom edge)', await page.evaluate(() => { const r = document.querySelector('.modal__content').getBoundingClientRect(); return Math.abs(r.bottom - innerHeight) < 2 && r.width >= innerWidth - 2; }));
  t.check('Simple / Advanced sits below the tabs: along the bottom edge on a phone', await page.evaluate(() => { const a = document.querySelector('.tab').getBoundingClientRect(), b = document.querySelector('.levelbar').getBoundingClientRect(); return b.top > a.bottom; }));
  const small = await page.evaluate(() => [...document.querySelectorAll('.modal button, .modal select, .modal input[type=number]')].filter((e) => e.offsetParent && (e.getBoundingClientRect().height < 36)).map((e) => e.id || e.className));
  t.check('every visible control is at least 36 px tall (touch targets)', small.length === 0, small.join(', '));

  // a preset sets the real controls
  await page.click('.preset[data-preset="bedside"]');
  await page.waitForTimeout(500);
  let c = await conf(page);
  t.check('Bedside saved its settings (no seconds, dimming at night, soft glass)', c.hideSeconds === true && c.nightDim === 'auto' && c.nightDimLevel === 0.75 && c.glassFrost === 0.55, JSON.stringify({ hs: c.hideSeconds, nd: c.nightDim, fr: c.glassFrost }));
  t.check('its card is ticked, no other', await page.evaluate(() => [...document.querySelectorAll('.preset[aria-pressed="true"]')].map((b) => b.dataset.preset).join()) === 'bedside');
  t.check('the other tabs follow: "Hide seconds" is on, and the clock really lost its seconds', await page.evaluate(() => document.getElementById('hideSeconds').checked && getComputedStyle(document.querySelector('#clock .seconds')).display === 'none'));
  await page.selectOption('#nightDim', 'off', { force: true }).catch(() => {});
  await page.evaluate(() => { const e = document.getElementById('nightDim'); e.value = 'off'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(300);
  t.check('changing one setting un-ticks the preset', await page.evaluate(() => document.querySelectorAll('.preset[aria-pressed="true"]').length) === 0);

  // reset
  const before = await conf(page);
  page.on('dialog', (d) => d.accept());
  await page.click('#resetAll');
  await page.waitForTimeout(600);
  c = await conf(page);
  t.check('Reset puts the settings back (seconds shown, no dimming, automatic style)', c.hideSeconds === false && c.nightDim === 'off' && c.clockStyle === 'auto' && c.glassFrost === 0.35);
  t.check('Reset keeps the location and the first-run choice', c.location_latitude === before.location_latitude && c.location_longitude === before.location_longitude && c.locationChoice === 'estimated');
  t.check('after a reset "Standard" is the ticked preset', await page.evaluate(() => [...document.querySelectorAll('.preset[aria-pressed="true"]')].map((b) => b.dataset.preset).join()) === 'standard');

  // tabs: keyboard
  await page.focus('.tab[aria-selected="true"]');
  await page.keyboard.press('ArrowRight');
  t.check('arrow keys move between tabs (Presets -> Clock) and show its panel', await page.evaluate(() => document.querySelector('.tab[aria-selected="true"]').dataset.tab === 'clock' && !document.getElementById('panel-clock').hidden && document.getElementById('panel-presets').hidden));
  await page.keyboard.press('End');
  t.check('End goes to the last tab', await page.evaluate(() => document.querySelector('.tab[aria-selected="true"]').dataset.tab) === 'place');

  // Simple / Advanced
  await page.click('.tab[data-tab="clock"]');
  const adv = () => page.evaluate(() => { const g = document.querySelector('#panel-clock .group.adv'); return g && getComputedStyle(g).display; });
  t.check('Simple: advanced groups are hidden', await adv() === 'none');
  await page.click('.seg__btn[data-level="advanced"]');
  t.check('Advanced: they show, in a visibly different (amber, dashed) style', await adv() !== 'none' && await page.evaluate(() => getComputedStyle(document.querySelector('#panel-clock .group.adv')).borderStyle.includes('dashed')));
  await page.click('.seg__btn[data-level="simple"]');

  // closing
  await page.keyboard.press('Escape');
  t.check('Escape closes the panel', await page.evaluate(() => document.getElementById('settingsModal').hidden));
  await open(page);
  t.check('it reopens on the tab you were on (the page remembers it for the visit)', await page.evaluate(() => document.querySelector('.tab[aria-selected="true"]').dataset.tab) === 'clock');
  t.check('no script errors while using the panel', h.errors.length === 0, h.errors.join(' | '));
  await h.close();

  // wide screens: a side drawer, with the sky still visible
  const d = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0', width: 1200, height: 700 });
  await open(d.page);
  await d.page.waitForTimeout(400);
  t.check('on a wide screen the panel is a side drawer at most 440 px wide', await d.page.evaluate(() => { const r = document.querySelector('.modal__content').getBoundingClientRect(); return r.width <= 441 && Math.abs(r.right - innerWidth) < 2 && r.top < 2; }));
  t.check('the tabs are above Simple / Advanced there', await d.page.evaluate(() => document.querySelector('.tab').getBoundingClientRect().bottom <= document.querySelector('.levelbar').getBoundingClientRect().top + 1));
  await d.close();
}
