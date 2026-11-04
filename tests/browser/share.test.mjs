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

  // opened on an ordinary screen: a banner offers "Use this setup" or "Just look"
  h = await open(t, `c=${S.encodeShort({ settings: { hideSeconds: true, quality: 'low', brightnessNight: 0.4 }, place: { lat: 48.8566, lon: 2.3522 }, timeZone: 'Europe/Paris' })}`);
  t.check('a shared link on an ordinary screen shows a banner saying what it is, with Use this setup and Just look', await h.page.evaluate(() => { const b = document.getElementById('sharedBanner'); return !b.hidden && /Showing a shared setup/.test(b.textContent) && /48\.8566/.test(b.textContent) && /Paris/.test(b.textContent) && !!document.getElementById('sharedUse') && !!document.getElementById('sharedLook'); }));
  t.check('and its time zone is applied: the digits show Paris time (12:00 UTC is 14:00 there)', (await cfg(h.page)).timeZone === 'Europe/Paris' && /^(14|2):/.test(await h.page.title()), await h.page.title());
  await h.page.click('#sharedLook');
  t.check('Just look hides the banner and keeps nothing', await h.page.evaluate(() => document.getElementById('sharedBanner').hidden && localStorage.getItem('conf') === null));
  await h.page.reload(); await h.ready(); await h.page.waitForTimeout(500);
  await h.page.click('#sharedUse');
  await h.page.waitForURL((u) => !u.search || !/[?&]c=/.test(u.search), { timeout: 8000 }).catch(() => {});
  await h.ready(); await h.page.waitForTimeout(600);
  const kept = await h.page.evaluate(() => JSON.parse(localStorage.getItem('conf') || 'null'));
  t.check('Use this setup saves it on this device (with the place and time zone) and goes to the plain address', kept && kept.hideSeconds === true && kept.quality === 'low' && kept.brightnessNight === 0.4 && kept.manualLocation === true && Math.abs(kept.location_latitude - 48.8566) < 1e-6 && kept.timeZone === 'Europe/Paris' && !/[?&]c=/.test(await h.page.evaluate(() => location.search)) && kept.confVersion >= 4, JSON.stringify(kept)?.slice(0, 200));
  t.check('and the banner is gone, since the page is no longer showing a shared setup', await h.page.evaluate(() => document.getElementById('sharedBanner').hidden));
  await h.close();
  // a kiosk link never shows the banner (nobody can tap it)
  h = await open(t, `c=${short}`);
  t.check('a kiosk link shows no banner', await h.page.evaluate(() => getComputedStyle(document.getElementById('sharedBanner')).display === 'none'));
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

  // the QR code, the length limit and the converter in the Share box
  h = await t.open({ width: 420, height: 800, conf: { clockStyle: 'solid', hideSeconds: true }, query: 'lat=&t=2026-06-21T12:00:00Z&speed=0' });
  await h.page.evaluate(() => document.getElementById('settings').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await h.page.waitForTimeout(700);
  let q = await h.page.evaluate(() => ({ svg: !!document.querySelector('#shareQr svg'), paths: document.querySelectorAll('#shareQr path').length, note: document.getElementById('shareQrNote').textContent }));
  t.check('a QR code of the short link is drawn, with a note', q.svg && q.paths === 1 && /Scan it/.test(q.note), JSON.stringify(q));
  const setv = (id, v, ev = 'input') => h.page.evaluate(([i, x, e]) => { const el = document.getElementById(i); el.value = x; el.dispatchEvent(new Event(e, { bubbles: true })); }, [id, v, ev]);
  const drawn = await h.page.evaluate(() => document.querySelector('#shareQr path').getAttribute('d'));
  t.check('the code drawn is the code of the link in the box (same modules)', drawn === await h.page.evaluate(async () => { const m = await import('/js/qr.js'); return new DOMParser().parseFromString(m.toSvg(document.getElementById('shareShort').value, 'M', 1), 'image/svg+xml').querySelector('path').getAttribute('d'); }));
  await setv('shareQrForm', 'readable', 'change');
  await h.page.waitForTimeout(300);
  const readableLen = await h.page.evaluate(() => document.getElementById('shareReadable').value.length);
  t.check('choosing the readable link redraws it, or says it is too long for a code', await h.page.evaluate(() => document.getElementById('shareQr').innerHTML !== '') === (readableLen <= 213) && (readableLen <= 213 || /too long for a QR code/.test(await h.page.evaluate(() => document.getElementById('shareQrNote').textContent))), String(readableLen));
  await setv('shareLimit', '30'); await h.page.waitForTimeout(300);
  t.check('a length limit is checked against both links, saying what fits', /too long/.test(await h.page.evaluate(() => document.getElementById('shareLimitNote').textContent)), await h.page.evaluate(() => document.getElementById('shareLimitNote').textContent));
  await setv('shareLimit', '2000'); await h.page.waitForTimeout(300);
  t.check('and says both fit when they do', /Both links fit/.test(await h.page.evaluate(() => document.getElementById('shareLimitNote').textContent)));
  const sh = await h.page.evaluate(() => document.getElementById('shareShort').value);
  await setv('shareConvert', sh); await h.page.waitForTimeout(200);
  let conv = await h.page.evaluate(() => document.getElementById('shareConvertOut').textContent);
  t.check('pasting a short link shows what it does and the readable form', /seconds hidden/.test(conv) && /Readable: .*\?v=1&preset=/.test(conv), conv);
  const rd = await h.page.evaluate(() => document.getElementById('shareReadable').value);
  await setv('shareConvert', rd.slice(rd.indexOf('?') + 1)); await h.page.waitForTimeout(200);
  conv = await h.page.evaluate(() => document.getElementById('shareConvertOut').textContent);
  t.check('pasting just the readable query (no address) shows the short form', /Short: .*\?c=/.test(conv), conv);
  await setv('shareConvert', 'hello'); await h.page.waitForTimeout(200);
  t.check('pasting something else says so', /not a link this clock understands/.test(await h.page.evaluate(() => document.getElementById('shareConvertOut').textContent)));
  t.check('share box: no errors', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}
