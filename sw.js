// Offline / repeat-visit cache. Everything the page needs is stored on first visit (so it also works offline and as an
// installed app), and from then on files are served from the device at once and refreshed in the background
// (stale-while-revalidate): a returning visit does not wait for the network. Other origins (weather, terrain,
// satellite tiles) are never touched. A change you deploy shows up on the visit after next; bump VERSION to
// make old caches go.
const VERSION = 'v10';
const CACHE = 'wwwc-' + VERSION;
const opened = () => (opened.p || (opened.p = caches.open(CACHE)));     // one handle for all requests: opening it each time is the slow part of a cached start

// keep in step with the files of the app: tools/test-pwa.mjs checks that every script and data file is listed
const PRECACHE = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'data/stars.bin', 'data/milkyway.png', 'data/moon.jpg',
  'js/vendor/astronomy.browser.min.js',
  'js/index.js', 'js/clock.js', 'js/config.js', 'js/easing.js', 'js/install.js', 'js/offline.js', 'js/location.js', 'js/season.js', 'js/countdown.js', 'js/settings_gear.js', 'js/simtime.js', 'js/units.js', 'js/wakelock.js', 'js/wind.js',
  'js/virgo/virgo.js', 'js/virgo/lib/timezone_centroids.js', 'js/virgo/lib/timezone_links.js',
  'js/sky/alerts.js', 'js/sky/app.js', 'js/sky/appearance.js', 'js/sky/astro.js', 'js/sky/bindings.js', 'js/sky/biome.js', 'js/sky/controls.js', 'js/sky/core.js',
  'js/sky/data.js', 'js/sky/dim.js', 'js/sky/engine.js', 'js/sky/glass.js', 'js/sky/glsl-atmosphere.js', 'js/sky/glsl-plants.js', 'js/sky/glsl-scene.js',
  'js/sky/burnin.js', 'js/sky/windsway.js', 'js/sky/landscape.js', 'js/sky/ledcard.js', 'js/sky/ledgrid.js', 'js/sky/ledpanel.js', 'js/sky/lightpollution.js', 'js/sky/orientation.js', 'js/sky/plants.js', 'js/sky/presets.js', 'js/sky/rain.js',
  'js/sky/scheduler.js', 'js/sky/sunpath.js', 'js/sky/view.js', 'js/sky/weather.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // one failed file (a flaky connection) must not stop the rest from being stored
    await Promise.allSettled(PRECACHE.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('wwwc-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Whether the server's copy is different from the saved one (by ETag, else Last-Modified, else length).
function changed(saved, fresh) {
  for (const h of ['etag', 'last-modified', 'content-length']) {
    const a = saved.headers.get(h), b = fresh.headers.get(h);
    if (a && b) return a !== b;
  }
  return false;
}
// Tell the open pages, so they can offer "a new version is ready" (the page itself was served from the saved copy).
function tellPages() {
  self.clients.matchAll({ includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'updated' })));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await opened();
    // the page itself is the same file whatever the ?query (deep links, tests)
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    const fresh = fetch(req).then((r) => {
      if (r && r.ok) {
        if (hit && changed(hit, r) && /\.(js|css|html|webmanifest)$|\/$/.test(url.pathname)) tellPages();   // a newer version of the app is now saved: the page on screen is the old one
        cache.put(req, r.clone());
      }
      return r;
    }).catch(() => hit);
    return hit || fresh;
  })());
});

// The page asks how much is saved ('status') and can ask for the missing files to be fetched ('ensure', e.g. when the
// connection comes back after a flaky first visit) or for everything to be fetched again ('refresh'); the answer is {cached, total}.
self.addEventListener('message', (e) => {
  const type = e.data && e.data.type;
  const port = e.ports && e.ports[0];
  if (type !== 'status' && type !== 'ensure' && type !== 'refresh') return;
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 'refresh': fetch every file again from the network, whatever is saved (the button in Settings, for an installed app that cannot be pulled down to reload)
    if (type === 'refresh') await Promise.allSettled(PRECACHE.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    if (type === 'ensure') await Promise.allSettled(PRECACHE.map(async (u) => { if (!(await cache.match(u))) await cache.add(new Request(u, { cache: 'reload' })); }));
    const have = (await Promise.all(PRECACHE.map((u) => cache.match(u)))).filter(Boolean).length;
    if (port) port.postMessage({ cached: have, total: PRECACHE.length });
  })());
});
