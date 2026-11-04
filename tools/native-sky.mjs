// Bakes the native sky from the web page: opens the real page at a series of moments, measures the mean colour of three bands of the picture
// (the top of the sky, the sky just above the horizon, the ground) and writes them against the sun's height, as
//   native/core/src/skytable.rs        the lookup table the native renderer interpolates (June evening and day at 40.7N 74W)
//   native/core/tests/sky_golden.tsv   held-out moments (a March morning) the table must reproduce within a tolerance
// This needs Chromium (software WebGL) and takes a few minutes: run it by hand when the web look changes, then `cargo test` in native/core.
//   node tools/native-sky.mjs
import fs from 'fs';
import path from 'path';
import '../tests/lib/astronomy.mjs';
import { startHarness } from '../tests/lib/harness.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LAT = 40.7, LON = -74, W = 480, H = 270;
const obs = new Astronomy.Observer(LAT, LON, 0);
const altOf = (date) => { const t = Astronomy.MakeTime(date), eq = Astronomy.Equator('Sun', t, obs, true, true); return Astronomy.Horizon(t, obs, eq.ra, eq.dec, null).altitude; };

// Rectangles (x0 x1 y0 y1, fractions of the screen) averaged for each band. The clock is hidden while measuring, and each band takes both sides of the
// screen (the sun is drawn on the left in the evening and on the right in the morning, so one side alone would tell the two apart).
const BANDS = {
  top: [[0.05, 0.12, 0.02, 0.08], [0.88, 0.95, 0.02, 0.08], [0.45, 0.55, 0.02, 0.08]],
  horizon: [[0.05, 0.12, 0.56, 0.61], [0.88, 0.95, 0.56, 0.61], [0.45, 0.55, 0.56, 0.61]],
  ground: [[0.05, 0.12, 0.82, 0.95], [0.88, 0.95, 0.82, 0.95], [0.45, 0.55, 0.82, 0.95]],
};
async function sample(h) {
  const buf = await h.page.screenshot();
  return h.page.evaluate(async ({ b64, bands, w, hh }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const out = {};
    for (const [k, rects] of Object.entries(bands)) {
      let r = 0, gg = 0, b = 0, n = 0;
      for (const [x0, x1, y0, y1] of rects) {
        const d = g.getImageData(Math.floor(x0 * w), Math.floor(y0 * hh), Math.max(1, Math.ceil((x1 - x0) * w)), Math.max(1, Math.ceil((y1 - y0) * hh))).data;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
      }
      out[k] = [r / n, gg / n, b / n];
    }
    return out;
  }, { b64: buf.toString('base64'), bands: BANDS, w: W, hh: H });
}
const H0 = await startHarness();
async function at(iso) {
  const h = await H0.open({ query: `t=${iso}&speed=0`, width: W, height: H, conf: { clockStyle: 'solid', hideSeconds: true, weatherMode: 'clear', plants: false, landscape: 'flat', quality: 'low', holidayTree: false, viewMode: 'fixed', clockColor: 'white' } });
  await h.page.addStyleTag({ content: '#clock, #settings, #alerts, .fab { display: none !important; }' });
  await h.page.waitForTimeout(900);
  const s = await sample(h); await h.close();
  return { iso, alt: altOf(new Date(iso)), ...s };
}
const times = (day, fromH, toH, stepMin) => { const out = []; for (let m = fromH * 60; m <= toH * 60; m += stepMin) out.push(new Date(Date.UTC(day[0], day[1] - 1, day[2], 0, m)).toISOString()); return out; };
const build = [...times([2026, 6, 21], 15, 30.6, 20)];                 // 15:00 UTC to 06:36 next day: afternoon, sunset, dusk, night
const held = [...times([2026, 3, 20], 8.4, 15.5, 45)];                  // a March morning to noon (sun rising: the other side of the day)
const rows = []; for (const t of build) rows.push(await at(t));
const test = []; for (const t of held) test.push(await at(t));
await H0.close();

// bin the build samples by sun height (2 degree bins, mean), sorted from the lowest sun up
const bins = new Map();
for (const r of rows) { const k = Math.round(r.alt / 2) * 2; (bins.get(k) || bins.set(k, []).get(k)).push(r); }
const mean = (a, key, i) => a.reduce((s, r) => s + r[key][i], 0) / a.length;
const table = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([k, a]) => ({ alt: a.reduce((s, r) => s + r.alt, 0) / a.length, top: [0, 1, 2].map((i) => mean(a, 'top', i)), horizon: [0, 1, 2].map((i) => mean(a, 'horizon', i)), ground: [0, 1, 2].map((i) => mean(a, 'ground', i)) }));
const f = (v) => v.map((x) => x.toFixed(1)).join(', ');
const rs = `//! The sky's colours against the sun's height, baked from the web page by tools/native-sky.mjs (do not edit by hand; regenerate it).
//! Mean colour of the top of the sky, the sky just above the horizon and the ground, from the real page (clear weather, flat ground) at
//! 40.7 N 74 W on 2021-06-21 style evenings; the renderer interpolates between rows. [altitude degrees, top rgb, horizon rgb, ground rgb]

pub const ROWS: usize = ${table.length};
pub const SKY: [[f64; 10]; ROWS] = [
${table.map((r) => `    [${r.alt.toFixed(2)}, ${f(r.top)}, ${f(r.horizon)}, ${f(r.ground)}],`).join('\n')}
];
`;
fs.writeFileSync(path.join(root, 'native/core/src/skytable.rs'), rs);
fs.writeFileSync(path.join(root, 'native/core/tests/sky_golden.tsv'), ['# Held-out moments measured on the web page by tools/native-sky.mjs: altitude, then top, horizon, ground mean rgb.', ...test.map((r) => ['sky', r.alt.toFixed(3), ...r.top.map((x) => x.toFixed(2)), ...r.horizon.map((x) => x.toFixed(2)), ...r.ground.map((x) => x.toFixed(2))].join('\t'))].join('\n') + '\n');
console.log(`wrote skytable.rs (${table.length} rows from ${rows.length} samples) and sky_golden.tsv (${test.length} held-out)`);
