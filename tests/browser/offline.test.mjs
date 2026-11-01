// The installed / offline app: the service worker stores everything, the page opens with no network, saved weather is
// used and labelled, and everything catches up by itself when the connection returns.
export const name = 'offline';
export const tier = 'fast';          // part of the quick check (npm test); the suite does only its core when t.quick is set

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

  // "Update and reload": a changed file on the server arrives at once, not a launch later
  const stale = await g.page.evaluate(async () => { const k = (await caches.keys()).find((x) => x.startsWith('wwwc-')); const c = await caches.open(k); await c.put('/data/refresh-probe.txt', new Response('old')); await c.put('/js/wind.js', new Response('// an old copy', { headers: { 'content-type': 'text/javascript' } })); return (await (await c.match('/js/wind.js')).text()).length; });
  t.check('(set up) the saved copy of a file is now stale', stale < 30, String(stale));
  await g.page.evaluate(() => document.getElementById('settings').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await g.page.waitForTimeout(300);
  t.check('the Update and reload button is in the Offline block, last in the panel', await g.page.evaluate(() => { const b = document.getElementById('refreshApp'); const groups = [...document.querySelectorAll('#panel-presets .group')]; return !!b && groups[groups.length - 1].contains(b); }));
  const nav = g.page.waitForNavigation({ timeout: 30000 }).catch(() => null);
  await g.page.evaluate(() => document.getElementById('refreshApp').click());
  await nav;
  await g.page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 60000 }).catch(() => {});
  const fresh = await g.page.evaluate(async () => { const k = (await caches.keys()).find((x) => x.startsWith('wwwc-')); const c = await caches.open(k); return (await (await c.match('/js/wind.js')).text()).length; });
  t.check('pressing it re-fetched the stale file from the server and reloaded the page', fresh > 1000, `${fresh} bytes`);

  // a newer version on the server than the saved one: the page offers to update (and never reloads by itself)
  t.check('(set up) no update banner while the saved copy matches the server', await g.page.evaluate(() => document.getElementById('updateBanner').hidden));
  await g.page.evaluate(async () => { const k = (await caches.keys()).find((x) => x.startsWith('wwwc-')); const c = await caches.open(k); await c.put('/js/wind.js', new Response('// the old version', { headers: { 'content-type': 'text/javascript', etag: '"an-older-version"' } })); });
  await g.page.evaluate(() => fetch('/js/wind.js').then((r) => r.text()));          // the page asks for a file: the saved copy is answered, the server's is fetched behind it
  await g.page.waitForFunction(() => !document.getElementById('updateBanner').hidden, null, { timeout: 15000 }).catch(() => {});
  t.check('when the server has a different copy of a file, the page shows "A new version is ready: tap to update"', await g.page.evaluate(() => { const b = document.getElementById('updateBanner'); return !b.hidden && /new version/i.test(b.textContent); }));
  const url0 = g.page.url();
  await g.page.waitForTimeout(1500);
  t.check('and it did not reload by itself', g.page.url() === url0 && await g.page.evaluate(() => !document.getElementById('updateBanner').hidden));

  // the version: one definite answer to "which copy is this?"
  const ver = await g.page.evaluate(async () => { const m = await import('/js/version.js').catch(() => null); void m; return { v: window.__version, line: document.getElementById('versionLine').textContent, dataset: document.documentElement.dataset.version }; });
  const stamp = await g.page.evaluate(() => fetch('/js/version.js', { cache: 'no-store' }).then((r) => r.text()));
  const file = { number: +/number: (\d+)/.exec(stamp)[1], hash: /hash: '([0-9a-f]+)'/.exec(stamp)[1] };
  t.check('the running copy knows its version, and it is the one in js/version.js', ver.v && ver.v.number === file.number && ver.v.hash === file.hash, JSON.stringify({ ...ver, file }));
  t.check('Settings -> Presets -> About says the version number, the hash and the build date', new RegExp(`Version ${file.number} \\(${file.hash}\\), built \\d{4}-\\d{2}-\\d{2}`).test(ver.line), ver.line);
  await g.page.evaluate(() => document.getElementById('settings').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await g.page.waitForFunction(() => /up to date|newer|differs|Could not/.test(document.getElementById('versionNewest').textContent), null, { timeout: 15000 }).catch(() => {});
  t.check('and it checks the server: "the server has the same version: you are up to date"', /same version \(\d+\): you are up to date/.test(await g.page.evaluate(() => document.getElementById('versionNewest').textContent)));
  // the server moves on (a newer number): About says so, and offers the update
  await g.page.evaluate((n) => { const real = window.fetch.bind(window); window.fetch = (u, o) => (/js\/version\.js/.test(String(u)) ? Promise.resolve(new Response(`globalThis.APP_VERSION = { number: ${n}, hash: 'deadbeef', built: '2099-01-01' };`)) : real(u, o)); }, file.number + 5);   // the server has moved on
  await g.page.evaluate(() => document.getElementById('settings').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await g.page.waitForFunction((n) => new RegExp(`newer version: ${n}`).test(document.getElementById('versionNewest').textContent), file.number + 5, { timeout: 15000 }).catch(() => {});
  const newest = await g.page.evaluate(() => ({ text: document.getElementById('versionNewest').textContent, banner: !document.getElementById('updateBanner').hidden }));
  t.check('when the server has a higher number, About names it and the update banner appears', new RegExp(`newer version: ${file.number + 5} \\(deadbeef\\)`).test(newest.text) && newest.banner, JSON.stringify(newest));
  await g.close();
}
