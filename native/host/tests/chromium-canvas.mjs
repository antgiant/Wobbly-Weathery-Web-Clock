// The same drawing (canvas-case.js) in Chromium, composited over white, as a PPM.
import http from 'http'; import fs from 'fs'; import path from 'path';
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const out = process.argv[2];
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/p.html') { r.setHeader('content-type', 'text/html'); return r.end('<!doctype html><body>'); }
  const f = path.join(root, u); if (!f.startsWith(root) || !fs.existsSync(f)) { r.statusCode = 404; return r.end(); }
  r.setHeader('content-type', 'text/javascript'); r.end(fs.readFileSync(f));
}).listen(0);
const b = await chromium.launch();
const pg = await b.newPage();
await pg.goto(`http://localhost:${srv.address().port}/p.html`);
const r = await pg.evaluate(async () => { const { draw } = await import('/native/host/tests/canvas-case.js'); const r = draw(document); return { w: r.w, h: r.h, data: Array.from(r.data) }; });
const rows = [Buffer.from(`P6\n${r.w} ${r.h}\n255\n`)];
for (let y = 0; y < r.h; y++) { const row = Buffer.alloc(r.w * 3); for (let x = 0; x < r.w; x++) { const i = (y * r.w + x) * 4, a = r.data[i + 3] / 255; for (let c = 0; c < 3; c++) row[x * 3 + c] = Math.round(r.data[i + c] * a + 255 * (1 - a)); } rows.push(row); }
fs.writeFileSync(out, Buffer.concat(rows));
await b.close(); srv.close();
