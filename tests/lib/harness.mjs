// Browser test harness: a static server, one headless Chromium (software WebGL), and `open()` which gives each test a
// fresh page with the outside world mocked (weather, terrain, towns) so tests are fast, offline and repeatable.

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { startServer } from './server.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

async function loadPlaywright() {
  try { return await import('playwright'); } catch (_) { /* not installed in the project: try a global install */ }
  const dirs = [process.env.PW_DIR, '/opt/node22/lib/node_modules/', '/usr/lib/node_modules/', '/usr/local/lib/node_modules/'].filter(Boolean);
  for (const d of dirs) { try { return createRequire(path.join(d, 'x'))('playwright'); } catch (_) { /* next */ } }
  throw new Error('Playwright is not installed: run `npm ci` (and `npx playwright install chromium`)');
}

const CORS = { 'access-control-allow-origin': '*' };
const json = (body, status = 200) => ({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });

/** What the mocked weather services answer. Tests can change `net` (up / down) and `weather` to see how the page reacts. */
export function makeNet() {
  return {
    up: true,
    weather: { temperature_2m: 12, cloud_cover_low: 30, cloud_cover_mid: 10, cloud_cover_high: 10, precipitation: 0, rain: 0, weather_code: 2, wind_speed_10m: 4, wind_direction_10m: 200, visibility: 24000 },
    now: null,                                                          // the page's pretended "now", when a test fixes it
    rainHours: (hour) => (hour >= 15 && hour <= 17 ? 1.2 : 0),         // mm per UTC hour: a 3-hour afternoon shower by default
    calls: [],
  };
}

async function installMocks(ctx, net) {
  await ctx.route(/open-meteo\.com/, (r) => {
    const u = r.request().url();
    net.calls.push(u);
    if (!net.up) return r.abort('internetdisconnected');
    if (u.includes('air-quality')) return r.fulfill(json({ current: { aerosol_optical_depth: 0.1 } }));
    if (u.includes('marine')) return r.fulfill(json({}, 400));
    if (u.includes('hourly=precipitation,precipitation_probability')) {
      const times = [], p = [], pr = [], sn = [];
      const d0 = new Date(net.now || Date.now()); d0.setUTCHours(0, 0, 0, 0);
      for (let i = 0; i < 48; i++) { times.push(new Date(+d0 + i * 3600e3).toISOString().slice(0, 16)); const mm = net.rainHours(i % 24); p.push(mm); pr.push(mm ? 80 : 5); sn.push(0); }
      return r.fulfill(json({ utc_offset_seconds: 0, hourly: { time: times, precipitation: p, precipitation_probability: pr, snowfall: sn } }));
    }
    if (u.includes('daily=temperature_2m_mean')) return r.fulfill(json({ daily: { temperature_2m_mean: Array.from({ length: 30 }, () => 14) } }));
    if (u.includes('hourly=')) {                                          // a whole recorded day
      const times = Array.from({ length: 24 }, (_, i) => `2024-01-15T${String(i).padStart(2, '0')}:00`);
      return r.fulfill(json({ elevation: 20, hourly: { time: times, temperature_2m: times.map(() => 5), cloud_cover_low: times.map(() => 40), cloud_cover_mid: times.map(() => 0), cloud_cover_high: times.map(() => 0), precipitation: times.map(() => 0), weather_code: times.map(() => 3), wind_speed_10m: times.map(() => 3), wind_direction_10m: times.map(() => 200) } }));
    }
    return r.fulfill(json({ elevation: 30, current: net.weather }));
  });
  await ctx.route(/overpass/, (r) => (net.up
    ? r.fulfill(json({ elements: [{ type: 'node', lat: 40.71, lon: -74.0, tags: { place: 'city', name: 'Testville', population: '8000000' } }] }))
    : r.abort('internetdisconnected')));
  await ctx.route(/tiles\.maps\.eox\.at|elevation-api|archive-api\.open-meteo/, (r) => r.abort('blockedbyclient'));      // land cover and terrain: the page falls back
}

export async function startHarness({ headless = true } = {}) {
  const pw = await loadPlaywright();
  const { chromium } = pw.chromium ? pw : pw.default;
  const srv = await startServer(root);
  // Software WebGL2: the flag that provides it differs between Chromium builds, so try the known ones until a canvas gets a context.
  const flagSets = [['--use-gl=swiftshader', '--enable-unsafe-swiftshader'], ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'], ['--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader']];
  let browser = null;
  for (const flags of flagSets) {
    const b = await chromium.launch({ headless, args: [...flags, '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
    const p = await b.newPage();
    const ok = await p.evaluate(() => !!document.createElement('canvas').getContext('webgl2')).catch(() => false);
    await p.close();
    if (ok) { browser = b; break; }
    await b.close();
  }
  if (!browser) { await srv.close(); throw new Error('this Chromium has no software WebGL2 (tried swiftshader flags): the page cannot draw its sky'); }
  const opened = [];

  /**
   * A fresh page. Options: query (added to the address), conf (saved settings), width / height, locale, timezone,
   * colorScheme, sw (allow the service worker), mocks (default true), seedConf (false: leave storage empty), net,
   * fixedTime (freeze the page's clock at this instant: the real "now" without the time-travel code path).
   */
  async function open(o = {}) {
    const net = o.net || makeNet();
    const ctx = await browser.newContext({
      viewport: { width: o.width || 420, height: o.height || 800 }, deviceScaleFactor: 1, locale: o.locale || 'en-US', timezoneId: o.timezone || 'America/New_York',
      colorScheme: o.colorScheme || 'dark', hasTouch: !!o.touch, serviceWorkers: o.sw ? 'allow' : 'block', permissions: [], ...(o.context || {}),
    });
    if (o.mocks !== false) await installMocks(ctx, net);
    const page = await ctx.newPage();
    if (o.fixedTime) { await page.clock.setFixedTime(new Date(o.fixedTime)); net.now = new Date(o.fixedTime); }     // the page's Date is frozen: a pretend "now" without time travel
    const errors = [], failed = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errors.push('console.error: ' + m.text()); });
    page.on('requestfailed', (r) => { if (r.url().startsWith(srv.url)) failed.push(r.url().replace(srv.url, '')); });
    const base = { location_latitude: 40.7, location_longitude: -74, locationChoice: 'estimated', confVersion: 99, keepAwake: false, weatherMode: 'clear', plants: false, ...(o.conf || {}) };
    if (o.seedConf !== false) await page.addInitScript((c) => { if (!localStorage.getItem('conf')) localStorage.setItem('conf', JSON.stringify(c)); }, base);
    if (o.init) await page.addInitScript(o.init);
    const q = o.query || '';
    const url = `${srv.url}/?${/\blat=/.test(q) ? '' : 'lat=40.7&lon=-74&'}${o.sw ? 'sw=1&' : ''}${q}`;
    const h = {
      page, ctx, net, errors, failed, url,
      ready: (timeout = 90000) => page.waitForFunction(() => document.body.classList.contains('ready') && window.__frames >= 1, null, { timeout }),
      goto: (u = url) => page.goto(u),
      /** Wait for the page's own periodic work (the countdown, rain alert ... start 0.6 to 2.5 s after load). */
      settle: (ms = 3200) => page.waitForTimeout(ms),
      shot: async (name) => { const buf = await page.screenshot(); if (name && process.env.TEST_ARTIFACTS) { fs.mkdirSync(process.env.TEST_ARTIFACTS, { recursive: true }); fs.writeFileSync(path.join(process.env.TEST_ARTIFACTS, name + '.png'), buf); } return buf; },
      close: async () => { await ctx.close(); },
    };
    opened.push(h);
    if (o.load !== false) { await page.goto(url); if (o.wait !== false) await h.ready(); }
    return h;
  }

  /**
   * Run code on pixels of a screenshot (a PNG buffer). `fn` receives {w, h, at(x, y) -> [r,g,b], lum(x, y) -> 0..1, mean(x, y, w, h) -> {lum, r, g, b}}.
   */
  async function analyze(page, buf, fn) {
    return page.evaluate(async ({ b64, src }) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data, w = c.width, h = c.height;
      const at = (x, y) => { const i = (Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))) * 4; return [d[i], d[i + 1], d[i + 2]]; };
      const lum = (x, y) => { const p = at(x, y); return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255; };
      const mean = (x0, y0, rw, rh) => { let r = 0, gg = 0, b = 0, n = 0; for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, y0 + rh); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, x0 + rw); x++) { const i = (y * w + x) * 4; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; } n = n || 1; return { r: r / n, g: gg / n, b: b / n, lum: (0.2126 * r + 0.7152 * gg + 0.0722 * b) / n / 255 }; };
      return new Function('api', `return (${src})(api)`)({ w, h, at, lum, mean });
    }, { b64: buf.toString('base64'), src: fn.toString() });
  }

  /** How different two screenshots (PNG buffers) are: the share of pixels that differ by more than `threshold` (0..255 per channel), and where. */
  async function diff(page, a, b, threshold = 40) {
    return page.evaluate(async ({ a64, b64, threshold }) => {
      const load = async (s) => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(i, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
      const A = await load(a64), B = await load(b64);
      if (A.width !== B.width || A.height !== B.height) return { size: false };
      let n = 0, sum = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let i = 0; i < A.data.length; i += 4) {
        const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
        sum += (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2])) / 3;
        if (d > threshold) { n++; const p = i / 4, x = p % A.width, y = Math.floor(p / A.width); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      }
      const px = A.width * A.height;
      return { size: true, share: n / px, mean: sum / px / 255, count: n, box: n ? [x0, y0, x1, y1] : null };
    }, { a64: a.toString('base64'), b64: b.toString('base64'), threshold });
  }

  return { open, analyze, diff, url: srv.url, root, browser, close: async () => { for (const h of opened) { try { await h.ctx.close(); } catch (_) { /* gone */ } } await browser.close(); await srv.close(); } };
}
