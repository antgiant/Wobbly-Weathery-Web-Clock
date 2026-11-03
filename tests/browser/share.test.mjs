// Share links: opening one applies the setup for this load only (nothing saved), a kiosk link has no controls or questions, both forms
// work, and the Share this setup box makes links that open to the same setup.
export const name = 'share';
export const covers = 'Share links (short and readable): applied but never saved, kiosk mode (no controls, no questions), place from the link, the Share box round trip';
export const tier = 'fast';          // part of the quick check (npm test); the suite does only its core when t.quick is set

const cfg = (page) => page.evaluate(async () => { const m = await import('/js/config.js'); return { ...m.conf }; });
const open = (t, search, o = {}) => t.open({ seedConf: false, load: false, width: 420, height: 800, ...o }).then(async (h) => { await h.page.goto(`${h.url.split('/?')[0]}/?lat=&${search}&t=2026-06-21T12:00:00Z&speed=0`); await h.ready(); await h.page.waitForTimeout(800); return h; });

export async function run(t) {
  const S = await import('../../js/share.js');
  const setup = { settings: { ...S.BASES_V1[1][2], clockStyle: 'solid', countdown: 'both' }, place: { lat: 41.8781, lon: -87.6298 }, kiosk: true };
  const short = S.encodeShort(setup), readable = S.encodeReadable(setup);

  // a kiosk link, short form
  let h = await open(t, `c=${short}`);
  let c = await cfg(h.page);
  t.check('a shared link applies its settings (the Bedside preset, solid ink, countdown on)', c.hideSeconds === true && c.brightnessNight === 0.25 && c.clockStyle === 'solid' && c.countdown === 'both' && c.kiosk === true, JSON.stringify({ hs: c.hideSeconds, bn: c.brightnessNight, cs: c.clockStyle, k: c.kiosk }));
  t.check('and its place: Chicago, set by hand', c.manualLocation === true && Math.abs(c.location_latitude - 41.8781) < 1e-6 && Math.abs(c.location_longitude + 87.6298) < 1e-6 && await h.page.evaluate(() => Math.abs(window.__sky.s.lat - 41.8781) < 0.01));
  t.check('nothing was saved: the browser\'s own settings are untouched (none stored)', await h.page.evaluate(() => localStorage.getItem('conf')) === null);
  const k = await h.page.evaluate(() => ({ kiosk: document.documentElement.dataset.kiosk, gear: getComputedStyle(document.getElementById('settings')).display, welcome: getComputedStyle(document.getElementById('welcome')).display, wake: getComputedStyle(document.getElementById('wakeBanner')).display, modal: getComputedStyle(document.getElementById('settingsModal')).display, update: getComputedStyle(document.getElementById('updateBanner')).display, fab: [...document.querySelectorAll('.fab')].every((e) => getComputedStyle(e).display === 'none'), toast: getComputedStyle(document.getElementById('toast')).display }));
  t.check('kiosk: no settings button, no first-run question, no banners, no round buttons, no settings panel', k.kiosk === '1' && k.gear === 'none' && k.welcome === 'none' && k.wake === 'none' && k.modal === 'none' && k.update === 'none' && k.fab && k.toast === 'none', JSON.stringify(k));
  t.check('kiosk: the view is fixed (nobody can drag a sign)', c.viewMode === 'fixed' && await h.page.evaluate(() => window.__controls.mode === 'fixed'));
  t.check('kiosk: the clock runs (seconds hidden, digits drawn) and there are no errors', await h.page.evaluate(() => window.__frames > 0 && /^\d{1,2}:\d\d$/.test(document.title)) && h.errors.length === 0, `${await h.page.title()} ${h.errors.join(' | ')}`);
  await h.page.reload(); await h.ready(); await h.page.waitForTimeout(500);
  t.check('a reload applies it again (the address is the setup), still nothing stored', (await cfg(h.page)).kiosk === true && await h.page.evaluate(() => localStorage.getItem('conf')) === null);
  await h.close();

  // the readable form of the same setup
  h = await open(t, readable);
  const c2 = await cfg(h.page);
  t.check('the readable link of the same setup applies the same settings, place and kiosk mode', c2.hideSeconds === true && c2.brightnessNight === 0.25 && c2.clockStyle === 'solid' && c2.countdown === 'both' && c2.kiosk === true && c2.manualLocation === true && Math.abs(c2.location_latitude - 41.8781) < 1e-6, JSON.stringify({ hs: c2.hideSeconds, k: c2.kiosk, lat: c2.location_latitude }));
  await h.close();

  // a link without the kiosk switch and without a place
  h = await open(t, `c=${S.encodeShort({ settings: { hideSeconds: true, quality: 'low' } })}`);
  c = await cfg(h.page);
  t.check('a link with no place estimates it from the time zone and does not ask the first-run question', c.manualLocation === false && c.locationChoice === 'estimated' && await h.page.evaluate(() => document.getElementById('welcome').hidden));
  t.check('without the kiosk switch the controls are there', await h.page.evaluate(() => getComputedStyle(document.getElementById('settings')).display !== 'none' && !document.documentElement.dataset.kiosk));
  await h.page.evaluate(async () => { const m = await import('/js/config.js'); m.conf.hideSeconds = false; });
  t.check('a change made on a screen opened from a link is not stored either', await h.page.evaluate(() => localStorage.getItem('conf')) === null);
  await h.close();

  // an ordinary address is not a link: the normal behaviour, settings stored
  h = await t.open({ width: 420, height: 800 });
  t.check('an ordinary address (no link) stores settings as always', await h.page.evaluate(() => !!localStorage.getItem('conf')) && !(await cfg(h.page)).kiosk);
  await h.close();

  if (t.quick) return;                                              // the quick check stops here

  // the Share this setup box: links made by the page open to the same setup
  h = await t.open({ width: 420, height: 800, conf: { clockStyle: 'solid', hideSeconds: true, brightnessNight: 0.3, rainAlert: true, manualLocation: true, location_latitude: -33.8688, location_longitude: 151.2093, locationChoice: 'manual' }, query: 'lat=&t=2026-06-21T12:00:00Z&speed=0' });
  await h.page.evaluate(() => document.getElementById('settings').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await h.page.waitForTimeout(700);
  const box = () => h.page.evaluate(() => ({ short: document.getElementById('shareShort').value, readable: document.getElementById('shareReadable').value, sl: document.getElementById('shareShortLen').textContent, rl: document.getElementById('shareReadableLen').textContent, words: document.getElementById('shareDescribe').textContent, note: document.getElementById('shareNote').textContent }));
  let b = await box();
  t.check('the box shows a short link and a readable link, with their lengths', /\?c=[A-Za-z0-9_-]+$/.test(b.short) && /\?v=1&preset=/.test(b.readable) && b.sl === `${b.short.length} characters` && b.rl === `${b.readable.length} characters`, JSON.stringify(b));
  t.check('the short link is much shorter than the readable one and under 80 characters in all', b.short.length < 80 && b.short.length < b.readable.length, `${b.short.length} vs ${b.readable.length}`);
  t.check('a sentence says what the link will do (seconds hidden, the place, no kiosk)', /seconds hidden/.test(b.words) && /-33\.8688/.test(b.words) && !/kiosk/.test(b.words) && b.note === '', b.words);
  await h.page.evaluate(() => { const e = document.getElementById('shareKiosk'); e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await h.page.waitForTimeout(300);
  const bk = await box();
  t.check('turning on Kiosk mode changes both links and the sentence', bk.short !== b.short && bk.readable !== b.readable && /kiosk=1/.test(bk.readable) && /kiosk mode/.test(bk.words));
  await h.page.evaluate(() => { const e = document.getElementById('brightnessNight'); e.value = '0.5'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await h.page.waitForTimeout(500);
  const bc = await box();
  t.check('changing a setting changes the link', bc.short !== bk.short && /brightnessNight=0\.5/.test(bc.readable), bc.readable);
  const url = new URL(bc.short), url2 = new URL(bc.readable);
  await h.close();
  for (const [label, u] of [['short', url], ['readable', url2]]) {
    const o = await open(t, u.search.slice(1));
    const cc = await cfg(o.page);
    t.check(`opening the ${label} link the box made gives the same setup (seconds hidden, night 50%, rain alert, Sydney, kiosk)`, cc.hideSeconds === true && cc.brightnessNight === 0.5 && cc.rainAlert === true && cc.kiosk === true && Math.abs(cc.location_latitude + 33.8688) < 1e-6 && Math.abs(cc.location_longitude - 151.2093) < 1e-6, JSON.stringify({ hs: cc.hideSeconds, bn: cc.brightnessNight, k: cc.kiosk, lat: cc.location_latitude }));
    await o.close();
  }

  // copying: the link goes on the clipboard (or is selected), and the page says so
  h = await t.open({ width: 420, height: 800, query: 'lat=&t=2026-06-21T12:00:00Z&speed=0', context: { permissions: ['clipboard-read', 'clipboard-write'] } });
  await h.page.evaluate(() => document.getElementById('settings').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await h.page.waitForTimeout(600);
  await h.page.evaluate(() => document.getElementById('shareCopyShort').click());
  await h.page.waitForTimeout(500);
  t.check('Copy says the link was copied', /copied/i.test(await h.page.evaluate(() => document.getElementById('toast').textContent)));
  t.check('no place set: the box says the screen will estimate it, and where to set one', /time zone/.test(await h.page.evaluate(() => document.getElementById('shareNote').textContent)));
  t.check('share: no errors', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}
