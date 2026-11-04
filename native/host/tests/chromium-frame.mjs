// Renders the same moment as the native host in Chromium (software WebGL) and writes a PPM, so the two can be compared.
// usage: node chromium-frame.mjs <out.ppm> [w h] [time-iso] [state-json]
import http from 'http'; import fs from 'fs'; import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const [out, w = '480', h = '270', time = '2026-06-21T20:30:00Z', state = '{}'] = process.argv.slice(2);
const types = { '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/frame.html') { r.setHeader('content-type', 'text/html'); return r.end('<!doctype html><script src="/js/vendor/astronomy.browser.min.js"></script><body><canvas id=c></canvas>'); }
  const f = path.join(root, u); if (!f.startsWith(root) || !fs.existsSync(f)) { r.statusCode = 404; return r.end(); }
  r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(fs.readFileSync(f));
}).listen(0);
const port = srv.address().port;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: +w, height: +h } });
pg.on('pageerror', e => console.error('page error:', e.message));
await pg.goto(`http://localhost:${port}/frame.html`);
const bytes = await pg.evaluate(async ({ w, h, time, state }) => {
  const { SkyEngine } = await import('/js/sky/engine.js');
  const c = document.getElementById('c'); c.style.cssText = `width:${w}px;height:${h}px;display:block`;
  const e = new SkyEngine(c, { baseUrl: '.' });
  while (!e.assetsDone) await new Promise(r => setTimeout(r, 5));
  e.set({ sim: { base: new Date(time), startPerf: performance.now(), scale: 0 }, ...JSON.parse(state) }); const t = Date.parse(time);
  e.render(t); e.render(t);
  const gl = c.getContext('webgl2'); const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return Array.from(px);
}, { w: +w, h: +h, time, state });
const px = Buffer.from(bytes); const o = [Buffer.from(`P6\n${w} ${h}\n255\n`)]; const rows = [];
for (let y = h - 1; y >= 0; y--) { const row = Buffer.alloc(w * 3); for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; row[x * 3] = px[i]; row[x * 3 + 1] = px[i + 1]; row[x * 3 + 2] = px[i + 2]; } rows.push(row); }
fs.writeFileSync(out, Buffer.concat([...o, ...rows]));
await b.close(); srv.close();
