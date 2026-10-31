// Looks that follow the sky: the loading screen, the no-WebGL fallback, the clock ink colour and the favicon.

import { conf } from '../config.js';
import { now } from '../simtime.js';
import { every } from './scheduler.js';
import { canvas, engine, glass, num, DEFAULT_LAT, defaultLon, lsSet, setStatus } from './core.js';

// The loading screen goes once there is a real picture: the first frame is drawn with the stars, Milky Way and
// moon loaded, and the glass (if any) has its mask. Never waits more than a few seconds.
export function markReady() {
  if (document.body.classList.contains('ready')) return;
  document.body.classList.add('ready');
  performance.mark('app:ready');
  const l = document.getElementById('loading');
  if (l) { l.classList.add('done'); setTimeout(() => l.remove(), 700); }
}


// -------------------------------------------------------------- fallback --
// Without WebGL2 float targets we still show a plausible gradient.
export function startFallback(reason) {
  console.warn('[sky] falling back to gradient:', reason);
  document.body.classList.add('no-webgl');
  markReady();
  setStatus('sky', 'Basic gradient (WebGL2 unavailable)');
  const A = globalThis.Astronomy;
  const stops = [  // sun altitude -> top / horizon colour
    [-18, [4, 6, 16], [8, 12, 28]], [-9, [16, 24, 64], [60, 50, 90]], [-3, [48, 62, 130], [220, 130, 100]],
    [3, [90, 130, 200], [250, 190, 140]], [15, [80, 150, 225], [180, 215, 245]], [90, [60, 130, 225], [170, 210, 245]],
  ];
  const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const paint = () => {
    let alt = 20;
    try {
      const obs = new A.Observer(num(conf.location_latitude, DEFAULT_LAT), num(conf.location_longitude, defaultLon()), 0);
      const t = A.MakeTime(now()); const eq = A.Equator('Sun', t, obs, true, true);
      alt = A.Horizon(t, obs, eq.ra, eq.dec, 'normal').altitude;
    } catch (_) { /* keep default */ }
    let i = 0; while (i < stops.length - 2 && alt > stops[i + 1][0]) i++;
    const k = Math.min(1, Math.max(0, (alt - stops[i][0]) / (stops[i + 1][0] - stops[i][0])));
    const top = lerp(stops[i][1], stops[i + 1][1], k), hor = lerp(stops[i][2], stops[i + 1][2], k);
    document.body.style.background = `linear-gradient(rgb(${top}), rgb(${hor}))`;
    canvas.style.display = 'none';
  };
  paint(); every('fallback', paint, 30000);
}


// -------------------------------------------------------------- appearance --
// Solid ink: pick whichever of light or dark ink has the better worst-case brightness contrast (WCAG ratio, so it
// holds for colour-blind eyes too) against the sky behind the digits, and ring it with a halo of the opposite
// tone so it still reads where the sky changes from bright to dark behind it.
const lin = (v) => Math.pow(Math.max(0, v), 2.2);
const relLum = (p) => 0.2126 * lin(p.r) + 0.7152 * lin(p.g) + 0.0722 * lin(p.b);
const INK = { light: { css: '#f4f7ff', rgb: [0.96, 0.97, 1], L: 0.93, halo: 'rgba(5,10,30,0.55)' }, dark: { css: '#0a163c', rgb: [0.03, 0.06, 0.18], L: 0.009, halo: 'rgba(255,255,255,0.55)' } };
export async function updateClockColor() {
  const root = document.documentElement;
  const mode = conf.clockColor, haloOn = conf.legibility !== 'off';
  const setInk = (css, rgb, halo) => {
    root.style.setProperty('--clock-stroke', css);
    root.style.setProperty('--clock-halo', haloOn ? halo : 'transparent');
    glass?.setInk(rgb);
  };
  if (mode === 'classic') { setInk('blue', [0.05, 0.1, 1], 'rgba(255,255,255,0.7)'); return; }
  if (mode === 'white') { setInk('#f4f7ff', [0.96, 0.97, 1], INK.light.halo); return; }
  if (document.hidden) return;
  const px = await engine?.samplePixels([[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.4], [0.5, 0.6], [0.12, 0.5], [0.88, 0.5]]);
  if (!px) return;
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const worst = (ink) => Math.min(...px.map((p) => ratio(relLum(p), ink.L)));
  const cur = root.dataset.ink === 'dark' ? 'dark' : 'light';
  const other = cur === 'dark' ? 'light' : 'dark';
  const pick = worst(INK[other]) > worst(INK[cur]) * 1.2 ? other : cur;      // hysteresis: avoid flicker around the crossover
  root.dataset.ink = pick;
  setInk(INK[pick].css, INK[pick].rgb, INK[pick].halo);
}

export async function updateFavicon() {
  if (document.hidden) return;
  const px = await engine?.samplePixels([[0.5, 0.92], [0.5, 0.35]]);
  if (!px) return;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 32);
  const css = (p) => `rgb(${Math.round(p.r * 255)},${Math.round(p.g * 255)},${Math.round(p.b * 255)})`;
  g.addColorStop(0, css(px[0])); g.addColorStop(1, css(px[1]));
  ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
  let link = document.querySelector("link[rel~='icon']");
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.href = c.toDataURL('image/png');
  lsSet('lastsky', [css(px[0]), css(px[1])]);          // painted behind the loading screen next time
  saveSnapshot();
}


// What the next launch shows behind the loading screen: the sky as it last looked (a ~3 KB picture; not the clock, which
// would show an old time). Kept up to date once a minute and when the page is left.
export function saveSnapshot() {
  if (!engine || !canvas.width) return;
  try {
    const c = engine.snapshot(40, Math.max(16, Math.round(40 * canvas.height / canvas.width)));
    if (c) lsSet('lastsky2', { t: Date.now(), url: c.toDataURL('image/jpeg', 0.6) });
  } catch (_) { /* a browser that will not read the frame back: the colour gradient is used instead */ }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) saveSnapshot(); });
