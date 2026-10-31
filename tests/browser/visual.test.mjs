// Picture regression: a handful of fixed scenes compared with saved baselines (tests/visual/baseline/*.png).
// Rendering is software WebGL, so small differences between machines are expected: a scene fails only when more than
// 3% of its pixels differ clearly, or the average difference is above 1%. VISUAL=warn reports instead of failing (CI uses it
// until baselines have been made on the CI machine). UPDATE_BASELINES=1 rewrites the baselines from the current pictures.
import fs from 'fs';
import path from 'path';
import { nextSunset, at } from '../lib/astro.mjs';
export const name = 'visual';

const here = path.dirname(new URL(import.meta.url).pathname);
const BASE = path.join(here, '..', 'visual', 'baseline');
const OUT = process.env.TEST_ARTIFACTS ? path.join(process.env.TEST_ARTIFACTS, 'visual') : path.join(here, '..', 'visual', '__actual__');

const sunset = nextSunset('2026-06-21T12:00:00Z');
const still = { weatherMode: 'clear', plants: false, cloudMotion: 0, twentyFourHourClock: true, nightBrightness: 1.4 };
const scenes = [
  { id: 'day-glass', query: 't=2026-06-21T17:00:00Z&speed=0&az=190&pitch=8', conf: { clockStyle: 'glass' }, w: 400, h: 300 },
  { id: 'dusk-tube', query: 't=2026-06-22T00:50:00Z&speed=0&az=250&pitch=8', conf: { clockStyle: 'stained' }, w: 400, h: 300 },
  { id: 'night-solid', query: 't=2026-06-21T05:30:00Z&speed=0&az=190&pitch=8', conf: { clockStyle: 'solid' }, w: 400, h: 300 },
  { id: 'day-solid', query: 't=2026-06-21T17:00:00Z&speed=0&az=190&pitch=8', conf: { clockStyle: 'solid' }, w: 400, h: 300 },
  { id: 'led-classic', query: `t=${at(sunset, -270e3)}&speed=0&az=250&pitch=8`, conf: { clockStyle: 'solid', screenMode: 'led', countdown: 'both' }, w: 640, h: 340 },
  { id: 'led-upright', query: `t=${at(sunset, -270e3)}&speed=0&az=250&pitch=8`, conf: { clockStyle: 'solid', screenMode: 'led', countdown: 'both' }, w: 300, h: 600 },
  { id: 'xmas-land', query: 't=2026-12-10T22:30:00Z&speed=0&az=190&pitch=8', conf: { clockStyle: 'auto' }, w: 400, h: 300 },
];

export async function run(t) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(BASE, { recursive: true });
  const strict = process.env.VISUAL !== 'warn';
  for (const s of scenes) {
    const h = await t.open({ query: s.query, width: s.w, height: s.h, conf: { ...still, ...s.conf } });
    await h.page.addStyleTag({ content: '#settings, .fab, #wakeBanner { visibility: hidden !important }' });   // they fade on a timer: keep them out of the pictures
    await h.settle(2800);
    const buf = await h.page.screenshot();
    fs.writeFileSync(path.join(OUT, s.id + '.png'), buf);
    const file = path.join(BASE, s.id + '.png');
    if (process.env.UPDATE_BASELINES) { fs.writeFileSync(file, buf); t.check(`${s.id}: baseline written`, true); await h.close(); continue; }
    if (!fs.existsSync(file)) { t.warn(`${s.id}: no baseline yet (run UPDATE_BASELINES=1 node tests/run.mjs browser visual)`); await h.close(); continue; }
    const d = await t.diff(h.page, buf, fs.readFileSync(file), 24);
    const ok = d.size && d.share < 0.03 && d.mean < 0.01;
    const msg = d.size ? `${(d.share * 100).toFixed(2)}% of pixels differ, mean ${(d.mean * 100).toFixed(2)}%` : 'the picture has a different size';
    if (ok) t.check(`${s.id}: matches its baseline (${msg})`, true);
    else if (strict) t.check(`${s.id}: matches its baseline`, false, msg + `; actual saved to ${path.relative(process.cwd(), path.join(OUT, s.id + '.png'))}`);
    else t.warn(`${s.id}: differs from its baseline`, msg);
    t.check(`${s.id}: no script errors`, h.errors.length === 0, h.errors.join(' | '));
    await h.close();
  }
}
