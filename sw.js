// Offline / repeat-visit cache: files from this site are served from the device at once and refreshed in the
// background (stale-while-revalidate), so a returning visit does not wait for the network. Other origins
// (weather, terrain, satellite tiles) are never touched. A change you deploy shows up on the visit after next.
const CACHE = 'wwwc-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // the page itself is the same file whatever the ?query (deep links, tests)
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    const fresh = fetch(req).then((r) => { if (r && r.ok) cache.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || fresh;
  })());
});
