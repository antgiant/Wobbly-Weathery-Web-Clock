// Draws the app icons (icons/*.png) from the clock's own digit curves. Needs Playwright + Chromium.
// Run: node tools/make-icons.mjs
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(process.env.PW_DIR || '/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

// digit control points, copied from js/config.js (dd[1], dd[2])
const dd = {
  1: [138, 180, 226, 99, 230, 58, 243, 43, 256, 28, 252, 100, 253, 167, 254, 234, 254, 194, 255, 303, 256, 412, 254, 361, 255, 424],
  2: [104, 111, 152, 55, 208, 26, 271, 50, 334, 74, 360, 159, 336, 241, 312, 323, 136, 454, 120, 405, 104, 356, 327, 393, 373, 414],
};
const path = (c) => [0, 1, 2, 3].map((i) => { const k = i * 6; return `M ${c[k]} ${c[k + 1]} C ${c.slice(k + 2, k + 8).join(' ')}`; }).join(' ');

// pad: share of the icon kept clear all round (maskable icons are cropped to a circle / squircle: keep the art inside 80%)
const svg = (size, pad) => {
  const s = size, art = s * (1 - 2 * pad), dw = art * 0.5, k = dw / 520;       // each digit ~520 units wide incl. stroke
  const x0 = s * pad + art * 0.02, y0 = s * (0.5 - 0.30);
  const digit = (d, dx) => `<path transform="translate(${dx} ${y0}) scale(${k})" d="${path(dd[d])}" fill="none" stroke="#fff" stroke-width="86" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#241f63"/><stop offset=".55" stop-color="#7a5fb0"/><stop offset=".82" stop-color="#f09a6a"/><stop offset="1" stop-color="#ffd08a"/></linearGradient>
    <radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff6d6"/><stop offset=".45" stop-color="#ffd27a"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${s}" height="${s}" fill="url(#sky)"/>
  <circle cx="${s * 0.5}" cy="${s * 0.86}" r="${s * 0.34}" fill="url(#sun)"/>
  <rect y="${s * 0.86}" width="${s}" height="${s * 0.14}" fill="#1a1233"/>
  ${digit(1, x0 + art * 0.02)}${digit(2, x0 + art * 0.5)}
</svg>`;
};

const jobs = [['icon-192.png', 192, 0.08], ['icon-512.png', 512, 0.08], ['icon-maskable-512.png', 512, 0.2], ['apple-touch-icon.png', 180, 0.08], ['favicon-32.png', 32, 0.04]];
const b = await chromium.launch({ args: ['--no-sandbox'] });
for (const [name, size, pad] of jobs) {
  const page = await b.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg(size, pad)}</body>`);
  await page.screenshot({ path: `icons/${name}` });
  await page.close();
  console.log(name, fs.statSync(`icons/${name}`).size, 'bytes');
}
await b.close();
