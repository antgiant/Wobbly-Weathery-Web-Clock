// Bakes how each manual weather setting changes the sky, from the real page: at one moment (midday, 2026-06-21 16:00 UTC, New York) it measures the top
// of the sky, the horizon and the ground for every `weatherMode`, and writes each as a multiplier of the clear-sky colour to
//   native/core/src/weathertable.rs
// The native renderer has no live weather yet, so these are the manual settings (and "live" is treated as clear). Needs Chromium; run by hand.
//   node tools/native-weather.mjs
import fs from 'fs';
import path from 'path';
import { startHarness } from '../tests/lib/harness.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const W = 480, H = 270, WHEN = '2026-06-21T16:00:00Z';
// Full-width bands, so a cloud drifting through one corner does not decide the answer (this measures the look of the whole sky and ground).
const BANDS = { top: [[0.0, 1.0, 0.02, 0.22]], horizon: [[0.0, 1.0, 0.48, 0.61]], ground: [[0.0, 1.0, 0.8, 0.95]] };
const MODES = ['clear', 'partly', 'cloudy', 'overcast', 'rain', 'storm', 'snow', 'fog', 'haze'];
const STARS = { clear: 1, partly: 0.6, cloudy: 0.25, overcast: 0, rain: 0, storm: 0, snow: 0, fog: 0.05, haze: 0.5 };   // how much of the night's stars show through (a judgement, not measured)
const Hn = await startHarness();
const out = {};
for (const mode of MODES) {
  const h = await Hn.open({ query: `t=${WHEN}&speed=0`, width: W, height: H, conf: { clockStyle: 'solid', hideSeconds: true, weatherMode: mode, plants: false, landscape: 'flat', quality: 'low', holidayTree: false, viewMode: 'fixed' } });
  await h.page.addStyleTag({ content: '#clock, #settings, #alerts, .fab { display: none !important; }' });
  await h.page.waitForTimeout(1500);
  const buf = await h.page.screenshot();
  out[mode] = await h.page.evaluate(async ({ b64, bands, w, hh }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const res = {};
    for (const [k, rects] of Object.entries(bands)) {
      let r = 0, gg = 0, b = 0, n = 0;
      for (const [x0, x1, y0, y1] of rects) { const d = g.getImageData(Math.floor(x0 * w), Math.floor(y0 * hh), Math.max(1, Math.ceil((x1 - x0) * w)), Math.max(1, Math.ceil((y1 - y0) * hh))).data; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; } }
      res[k] = [r / n, gg / n, b / n];
    }
    return res;
  }, { b64: buf.toString('base64'), bands: BANDS, w: W, hh: H });
  await h.close();
}
await Hn.close();
const clear = out.clear, f = (v) => v.toFixed(3);
const rows = MODES.map((m) => {
  const mult = ['top', 'horizon', 'ground'].flatMap((b) => out[m][b].map((v, i) => Math.max(0, v / Math.max(1, clear[b][i]))));
  return `    ("${m}", [${mult.map(f).join(', ')}], ${Number(STARS[m]).toFixed(2)}),`;
});
fs.writeFileSync(path.join(root, 'native/core/src/weathertable.rs'), `//! How each manual weather setting changes the sky, baked from the web page by tools/native-weather.mjs (do not edit by hand; regenerate it).
//! Per setting: multipliers of the clear-sky colour for [top rgb, horizon rgb, ground rgb] measured at midday, and how much of the night's stars show
//! through (a judgement, not a measurement). Measured at 2026-06-21 16:00 UTC in New York.

pub const MODES: usize = ${MODES.length};
pub const WEATHER: [(&str, [f64; 9], f64); MODES] = [
${rows.join('\n')}
];
`);
console.log(MODES.map((m) => `${m}: top ${out[m].top.map((v) => Math.round(v)).join(',')}  horizon ${out[m].horizon.map((v) => Math.round(v)).join(',')}`).join('\n'));
