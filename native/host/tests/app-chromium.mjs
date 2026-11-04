// The real page in Chromium, frozen at a moment, with only the sky canvas visible; writes the canvas as a PPM (see boot.js for the native side).
// usage: node app-chromium.mjs out.ppm [w h] [search]
import http from 'http'; import fs from 'fs'; import path from 'path';
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const [out, w = '480', h = '270', search = 't=2026-06-21T17:00:00Z&speed=0&lat=40.7&lon=-74&weather=clear', conf = ''] = process.argv.slice(2);
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json' };
const srv = http.createServer((q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html';
  const f = path.join(root, u); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); }
  r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(fs.readFileSync(f));
}).listen(0);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, timezoneId: 'UTC', locale: 'en-US', serviceWorkers: 'block' });
await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort('internetdisconnected'));
const pg = await ctx.newPage();
if (conf) await pg.addInitScript((c) => { try { localStorage.setItem('conf', c); } catch (_) { /* ignore */ } }, conf);
await pg.addInitScript(() => { let a = 1; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
pg.on('pageerror', (e) => console.error('page error:', e.message));
await pg.goto(`http://localhost:${srv.address().port}/?${search}`);
await pg.waitForFunction(() => document.body.classList.contains('ready') && (window.__frames || 0) >= 2, null, { timeout: 60000 });
await pg.waitForTimeout(800);
await pg.addStyleTag({ content: 'body > *:not(#sky) { visibility: hidden !important; } #loading, .loading { display: none !important; }' });
await pg.waitForTimeout(300);
const shot = await pg.locator('#sky').screenshot();
const px = await pg.evaluate(async (b64) => {            // decode the PNG with the browser itself (no image library needed)
  const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  return { w: im.width, h: im.height, d: Array.from(x.getImageData(0, 0, im.width, im.height).data) };
}, shot.toString('base64'));
await b.close(); srv.close();
const rows = [Buffer.from(`P6\n${px.w} ${px.h}\n255\n`)];
for (let y = 0; y < px.h; y++) { const row = Buffer.alloc(px.w * 3); for (let x = 0; x < px.w; x++) { const i = (y * px.w + x) * 4; row[x * 3] = px.d[i]; row[x * 3 + 1] = px.d[i + 1]; row[x * 3 + 2] = px.d[i + 2]; } rows.push(row); }
fs.writeFileSync(out, Buffer.concat(rows));
