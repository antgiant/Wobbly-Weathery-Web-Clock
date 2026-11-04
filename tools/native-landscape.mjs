// Bakes how each landscape setting colours the ground, from the real page: the mean colour of the ground (full width, the lower part of the picture) for every
// landscape at midday and at night, as a multiplier of the flat ground's colour at the same moment, written to
//   native/core/src/landtable.rs
// (The silhouettes of hills, mountains and the city are drawn procedurally by native/core/src/landscape.rs; their heights were read off the page's pictures.)
// Needs Chromium; run by hand.   node tools/native-landscape.mjs
import fs from 'fs';
import path from 'path';
import { startHarness } from '../tests/lib/harness.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const W = 640, H = 360, LANDS = ['flat', 'hills', 'mountains', 'desert', 'ocean', 'city'], TIMES = { day: '2026-06-21T16:00:00Z', night: '2026-06-22T04:00:00Z' };
const Hn = await startHarness();
const got = {};
for (const [tname, when] of Object.entries(TIMES)) for (const land of LANDS) {
  const h = await Hn.open({ query: `t=${when}&speed=0`, width: W, height: H, conf: { clockStyle: 'solid', hideSeconds: true, weatherMode: 'clear', plants: false, landscape: land, quality: 'high', holidayTree: false, viewMode: 'fixed' } });
  await h.page.addStyleTag({ content: '#clock, #settings, #alerts, .fab { display: none !important; }' });
  await h.page.waitForTimeout(2200);
  const buf = await h.page.screenshot();
  got[`${tname}/${land}`] = await h.page.evaluate(async ({ b64, w, hh }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = w; c.height = hh; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, Math.floor(hh * 0.8), w, Math.floor(hh * 0.15)).data; let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    return [r / n, gg / n, b / n];
  }, { b64: buf.toString('base64'), w: W, hh: H });
  await h.close();
}
await Hn.close();
const f = (v) => v.toFixed(3);
const rows = LANDS.map((l) => `    ("${l}", [${[0, 1, 2].map((i) => f(got[`day/${l}`][i] / got['day/flat'][i])).join(', ')}], [${[0, 1, 2].map((i) => f(got[`night/${l}`][i] / Math.max(1, got['night/flat'][i]))).join(', ')}]),`);
fs.writeFileSync(path.join(root, 'native/core/src/landtable.rs'), `//! How each landscape colours the ground, baked from the web page by tools/native-landscape.mjs (do not edit by hand; regenerate it).
//! Per landscape: multipliers of the flat ground's colour at midday and at night (mean colour of the lower part of the picture).

pub const LANDS: usize = ${LANDS.length};
pub const GROUND: [(&str, [f64; 3], [f64; 3]); LANDS] = [
${rows.join('\n')}
];
`);
console.log(Object.entries(got).map(([k, v]) => `${k}: ${v.map((x) => Math.round(x)).join(',')}`).join('\n'));
