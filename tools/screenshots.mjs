// Takes the pictures in README.md's gallery (docs/images/*.jpg) with the same headless Chromium the tests use, at fixed times and places so they can be made again whenever the look
// changes: node tools/screenshots.mjs [outdir]. Pretend weather and no network (the tests' mocked services), so the same command gives the same pictures.
import fs from 'fs';
import path from 'path';
import { startHarness } from '../tests/lib/harness.mjs';

const out = path.resolve(process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'docs', 'images'));
fs.mkdirSync(out, { recursive: true });
const NY = 'lat=40.7&lon=-74', FAIRBANKS = 'lat=64.8&lon=-147.7';
const W = 960, H = 540;

// name, query (time and place, view), saved settings, extra work in the page
const shots = [
  ['day', `t=2026-06-21T17:00:00Z&speed=0&${NY}&az=180&pitch=14`, { clockStyle: 'glass', weatherMode: 'partly', plants: true, hideSeconds: true }],
  ['dusk', `t=2026-06-22T00:25:00Z&speed=0&${NY}&az=290&pitch=8`, { clockStyle: 'glass', weatherMode: 'partly', plants: true, hideSeconds: true }],
  ['night', `t=2026-06-22T05:30:00Z&speed=0&${NY}&az=200&pitch=25`, { clockStyle: 'glass', weatherMode: 'clear', plants: true, hideSeconds: true }],
  ['rain', `t=2026-06-21T17:00:00Z&speed=0&${NY}&az=0&pitch=12`, { clockStyle: 'glass', weatherMode: 'rain', plants: true, hideSeconds: true, rainAlert: true }],
  ['snow', `t=2026-12-10T17:08:25Z&speed=0&${NY}&az=0&pitch=12`, { clockStyle: 'glass', weatherMode: 'snow', plants: true, hideSeconds: true }],
  ['storm', `t=2026-06-21T22:00:00Z&speed=0&${NY}&az=0&pitch=12`, { clockStyle: 'glass', weatherMode: 'storm', plants: true, hideSeconds: true }, () => { window.__sky.lightning.update = () => ({ flash: 0.55, bolt: { x: 0.28, seed: 7, bottom: 0.4, a: 1 } }); }],
  ['rainbow', `t=2026-12-10T21:00:00Z&speed=0&${NY}&az=48&pitch=10`, { clockStyle: 'glass', weatherMode: 'partly', plants: true, hideSeconds: true }, () => { window.__sky.s.bow = 1; }],
  ['aurora', `t=2026-12-10T10:00:00Z&speed=0&${FAIRBANKS}&kp=5&az=22&pitch=20`, { clockStyle: 'glass', weatherMode: 'clear', plants: true, hideSeconds: true }],
  ['style-solid', `t=2026-06-21T17:00:00Z&speed=0&${NY}&az=180&pitch=14`, { clockStyle: 'solid', weatherMode: 'partly', plants: true, hideSeconds: true }],
  ['style-stained', `t=2026-06-21T17:00:00Z&speed=0&${NY}&az=180&pitch=14`, { clockStyle: 'stained', weatherMode: 'partly', plants: true, hideSeconds: true }],
  ['led-64x32', `t=2026-06-22T00:00:00Z&speed=0&${NY}&az=290&pitch=8`, { clockStyle: 'solid', weatherMode: 'rain', rainAlert: true, screenMode: 'led', ledCols: 64, ledRows: 32, countdown: 'both', twentyFourHourClock: true }],
  ['settings', `t=2026-06-21T17:00:00Z&speed=0&${NY}&az=180&pitch=14`, { clockStyle: 'glass', weatherMode: 'partly', plants: true, hideSeconds: true }, async (page) => { await page.evaluate(() => document.getElementById('settings').dispatchEvent(new MouseEvent('click', { bubbles: true }))); await page.waitForTimeout(800); }],
];

const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const h = await startHarness();
let total = 0;
try {
  for (const [name, query, conf, work] of shots) {
    if (only && !only.has(name)) continue;
    const p = await h.open({ query, conf, width: W, height: H, fast: true });
    await p.ready();
    await p.settle(3500);
    if (work) { if (work.constructor.name === 'AsyncFunction') await work(p.page); else await p.page.evaluate(work); await p.page.waitForTimeout(900); }
    const buf = await p.page.screenshot({ type: 'jpeg', quality: 80 });
    const file = path.join(out, `${name}.jpg`);
    fs.writeFileSync(file, buf); total += buf.length;
    console.log(`${name.padEnd(14)} ${(buf.length / 1024).toFixed(0).padStart(4)} KB  ${path.relative(process.cwd(), file)}`);
    await p.close();
  }
} finally { await h.close(); }
console.log(`${(total / 1024).toFixed(0)} KB in all`);
