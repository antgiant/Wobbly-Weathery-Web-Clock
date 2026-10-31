// The installed / offline app: the service worker stores everything, the page opens with no network, saved weather is
// used and labelled, and everything catches up by itself when the connection returns.
export const name = 'offline';

const st = (page) => page.evaluate(() => ({ weather: document.getElementById('weatherStatus').textContent, offline: document.getElementById('offlineStatus').textContent }));

export async function run(t) {
  const g = await t.open({ sw: true, conf: { weatherMode: 'live', clockStyle: 'solid', twentyFourHourClock: true } });
  await g.page.evaluate(() => navigator.serviceWorker.ready);
  await g.page.waitForFunction(() => /Saved on this device/.test(document.getElementById('offlineStatus').textContent), null, { timeout: 40000 }).catch(() => {});
  await g.settle(2500);
  const online = await st(g.page);
  t.check('online: the service worker has saved the whole app ("Saved on this device (N files)")', /Saved on this device \((\d+) files\)/.test(online.offline), online.offline);
  const files = +(online.offline.match(/\((\d+) files\)/) || [])[1];
  t.check('and it saved every file the precache list names (more than 50)', files > 50, String(files));
  t.check('online: live weather is shown', /^Live: Live/.test(online.weather), online.weather);
  const cached = await g.page.evaluate(async () => { const k = (await caches.keys()).find((x) => x.startsWith('wwwc-')); const c = await caches.open(k); const keys = (await c.keys()).map((r) => new URL(r.url).pathname); return { name: k, js: keys.filter((p) => p.endsWith('.js')).length, has: (p) => keys.includes(p), keys }; }).catch(() => null);
  t.check('the cache has the page, the stars and the engine', cached && ['/index.html', '/data/stars.bin', '/js/sky/engine.js', '/styles.css', '/manifest.webmanifest'].every((p) => cached.keys.includes(p)), cached && cached.name);

  // five hours later with no connection: the weather and the forecast are "old"
  await g.page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k === 'wx' || k.startsWith('rain:') || k.startsWith('marine:')) { const o = JSON.parse(localStorage[k]); o.t -= 5 * 3600e3; localStorage[k] = JSON.stringify(o); } });
  await g.ctx.setOffline(true);
  g.net.up = false;
  g.errors.length = 0;
  await g.page.goto(g.url).catch(() => {});
  await g.ready().catch(() => {});
  await g.settle(3500);
  const off = await st(g.page);
  const alive = await g.page.evaluate(() => ({ ready: document.body.classList.contains('ready'), frames: window.__frames, title: document.title }));
  t.check('offline reload: the app opens from the device and draws frames', alive.ready && alive.frames >= 1, JSON.stringify(alive));
  t.check('offline: the clock still runs', /^\d{1,2}:\d{2}/.test(alive.title), alive.title);
  t.check('offline: the last saved weather is used, and the status says how old it is', /Live: Live · \d+°F · saved 5 h ago/.test(off.weather), off.weather);
  t.check('offline: the offline note explains what keeps working', /offline now/.test(off.offline) && /clock, sun, moon and stars keep working/.test(off.offline), off.offline);
  t.check('offline: no script errors', g.errors.length === 0, g.errors.join(' | '));

  // the connection returns: fresh weather arrives by itself
  g.net.calls.length = 0;
  await g.ctx.setOffline(false);
  g.net.up = true;
  await g.page.waitForFunction(() => !/saved \d+ h ago/.test(document.getElementById('weatherStatus').textContent) && /^Live: Live/.test(document.getElementById('weatherStatus').textContent), null, { timeout: 15000 }).catch(() => {});
  const back = await st(g.page);
  t.check('back online: the weather refreshes by itself (the "saved ... ago" note goes)', /^Live: Live · \d+°F$/.test(back.weather), back.weather);
  t.check('back online: it asked the weather service again', g.net.calls.some((u) => /forecast/.test(u)), g.net.calls.length + ' calls');
  t.check('back online: the offline note no longer says "offline now"', !/offline now/.test(back.offline), back.offline);
  await g.close();
}
