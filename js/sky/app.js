// Glue between the settings (conf), the sky engine and the page.

import { conf } from '../config.js';
import { setSim, getSim, now } from '../simtime.js';
import { SkyEngine } from './engine.js';
import { Controls } from './controls.js';
import { PRESETS, fetchLiveWeather, CLEAR } from './weather.js';
import { fetchDem, demSkyline, LANDSCAPES } from './landscape.js';
import Virgo from '../virgo/virgo.js';
import { initGlass } from './glass.js';

const canvas = document.getElementById('sky');
const statusEls = {
  terrain: document.getElementById('terrainStatus'),
  weather: document.getElementById('weatherStatus'),
  sky: document.getElementById('skyStatus'),
};
const setStatus = (k, t) => { if (statusEls[k]) statusEls[k].textContent = t; };

let engine = null;
let controls = null;
let glass = null;
const state = { liveWeather: null, elevation: null, dem: null, lpBortle: 3 };
const ov = {};                      // deep-link overrides (never written to localStorage)
const num = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
// unknown time zone (e.g. plain "UTC"): guess a longitude from the UTC offset, 15 degrees per hour
const DEFAULT_LAT = 40;
const defaultLon = () => Math.max(-180, Math.min(180, -new Date().getTimezoneOffset() / 4));
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } };

// -------------------------------------------------------------- fallback --
// Without WebGL2 float targets we still show a plausible gradient.
function startFallback(reason) {
  console.warn('[sky] falling back to gradient:', reason);
  document.body.classList.add('no-webgl');
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
  paint(); setInterval(paint, 30000);
}

// ---------------------------------------------------------------- helpers --
function currentSun() { return engine?.sky?.sun; }

function bortleFromSettings() {
  const v = ov.lp ?? conf.lightPollution;
  if (v === 'off') return 0;
  if (v === 'auto') return state.lpBortle;
  return Math.min(9, Math.max(1, parseInt(v, 10) || 3));
}

function applyLocation() {
  if (!engine) return;
  const lat = num(ov.lat ?? conf.location_latitude, DEFAULT_LAT), lon = num(ov.lon ?? conf.location_longitude, defaultLon());
  // GPS altitude only counts when precise location is on and the browser actually reported one
  // (conf stores -1 as "never set"); otherwise use the elevation the weather service reported
  const gpsAlt = num(conf.location_altitude, NaN);
  const haveGpsAlt = conf.preciseLocation && Number.isFinite(gpsAlt) && gpsAlt !== -1 && gpsAlt > -400;
  const elevM = haveGpsAlt ? gpsAlt : (state.elevation ?? 0);
  // time-zone derived light pollution (Bortle) when the user left it on auto
  try {
    const z = Virgo.getLocation();
    if (z && Number.isFinite(z.lightPollution)) state.lpBortle = z.lightPollution;
  } catch (_) { /* ignore */ }
  engine.set({ lat, lon, elevM, bortle: bortleFromSettings() });
}

function applyView() {
  if (!controls) return;
  controls.setView({ heading: num(ov.az ?? conf.viewHeading, 180), pitch: num(ov.pitch ?? conf.viewPitch, 12), fov: num(conf.viewFov, 80) });
}

function applyWeather() {
  if (!engine) return;
  const mode = ov.weather ?? conf.weatherMode;
  let w = null;
  if (mode === 'live') {
    w = state.liveWeather || CLEAR;
    setStatus('weather', state.liveWeather ? `Live: ${state.liveWeather.label}` : 'Live weather not loaded yet, showing clear sky');
  } else {
    w = PRESETS[mode] || CLEAR;
    setStatus('weather', `Manual: ${w.label}`);
  }
  // aerosol optical depth -> Mie multiplier (the model's clean-air baseline is ~0.01 AOD)
  const mie = Math.min(12, 1 + 12 * (w.aod ?? 0.12));
  engine.set({ weather: w, mie });
}

function applyLandscape() {
  if (!engine) return;
  const type = ov.landscape ?? conf.landscape;
  const eyeM = (engine.s.elevM || 0) + engine.s.eyeM;
  if (type === 'auto') {
    if (state.dem) {
      const sk = demSkyline(state.dem, eyeM);
      const t = sk.ocean ? 'ocean' : (sk.maxElevM > 400 ? 'mountains' : 'hills');
      const spec = LANDSCAPES[t];
      engine.set({ landscape: { type: t, skyline: sk.data, albedo: spec.albedo, haze: sk.haze, ocean: sk.ocean } });
      setStatus('terrain', sk.ocean ? 'Real terrain: open water' : `Real terrain from elevation data (peaks to ${Math.round(sk.maxElevM)} m)`);
      return;
    }
    engine.setLandscapeType('hills', seedFromLocation());
    setStatus('terrain', 'Estimating (elevation data not loaded)');
    return;
  }
  engine.setLandscapeType(type, seedFromLocation());
  setStatus('terrain', LANDSCAPES[type]?.label || type);
}
const seedFromLocation = () => Math.abs(Math.round(num(conf.location_latitude, 0) * 10 + num(conf.location_longitude, 0) * 7)) + 1;

function applyQuality() {
  if (!engine) return;
  const rm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  engine.set({
    quality: conf.quality,
    bodySize: num(conf.bodySize, 2),
    nightBoost: num(conf.nightBrightness, 1.4),
    cloudMotion: num(conf.cloudMotion, 1),
    reducedMotion: !!rm,
    twinkle: false,                        // saves power: twinkle forces a redraw every frame all night
    fps: conf.quality === 'low' ? 8 : 15,
    bortle: bortleFromSettings(),
  });
  engine._resetScale();
}

// -------------------------------------------------------- live data fetch --
let fetchTimer = 0, fetchAbort = null;
async function loadLiveData() {
  const lat = num(ov.lat ?? conf.location_latitude, NaN), lon = num(ov.lon ?? conf.location_longitude, NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === -1 && lon === -1) return;
  fetchAbort?.abort();
  fetchAbort = new AbortController();
  const signal = fetchAbort.signal;
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;

  // terrain: cached for good, it does not change
  if ((ov.landscape ?? conf.landscape) === 'auto') {
    const demKey = `dem:${lat.toFixed(2)},${lon.toFixed(2)}`;
    state.dem = lsGet(demKey);
    if (!state.dem) {
      try {
        state.dem = await fetchDem(lat, lon, signal);
        lsSet(demKey, state.dem);
      } catch (e) { if (e.name !== 'AbortError') console.info('[sky] terrain fetch failed:', e.message); }
    }
    applyLandscape();
  }

  // weather: cached for 15 minutes
  if ((ov.weather ?? conf.weatherMode) === 'live') {
    const cached = lsGet('wx');
    if (cached && cached.key === key && Date.now() - cached.t < 15 * 60000) {
      state.liveWeather = cached.weather; state.elevation = cached.elevation;
    } else {
      try {
        const r = await fetchLiveWeather(lat, lon, signal);
        state.liveWeather = r.weather; state.elevation = r.elevation;
        lsSet('wx', { key, t: Date.now(), weather: r.weather, elevation: r.elevation });
      } catch (e) { if (e.name !== 'AbortError') console.info('[sky] weather fetch failed:', e.message); }
    }
    applyLocation();
    applyWeather();
    applyLandscape();
  }
}
function scheduleLiveData() {
  clearInterval(fetchTimer);
  fetchTimer = setInterval(loadLiveData, 15 * 60000);
  loadLiveData();
}

// -------------------------------------------------------------- appearance --
let lastLum = 0.3;
async function updateClockColor() {
  const root = document.documentElement;
  const mode = conf.clockColor;
  if (mode === 'classic') { root.style.setProperty('--clock-stroke', 'blue'); return; }
  if (mode === 'white') { root.style.setProperty('--clock-stroke', '#f4f7ff'); return; }
  if (document.hidden) return;
  const px = await engine?.samplePixels([[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.4], [0.5, 0.6]]);
  if (!px) return;
  const lum = px.reduce((a, p) => a + p.lum, 0) / px.length;
  lastLum = lastLum * 0.5 + lum * 0.5;
  // dark ink on a bright sky, light ink on a dark one; hysteresis avoids flicker
  const dark = lastLum > (root.dataset.ink === 'dark' ? 0.42 : 0.5);
  root.dataset.ink = dark ? 'dark' : 'light';
  root.style.setProperty('--clock-stroke', dark ? '#0a163c' : '#f4f7ff');
}

async function updateFavicon() {
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
}

// ------------------------------------------------------------------- HUD --
const hud = document.getElementById('hud');
function updateHud() {
  if (!hud || !engine?.sky) return;
  const show = conf.showLabels || conf.viewMode === 'look';
  hud.hidden = !show;
  if (!show) return;
  const b = engine._basis();
  const w = window.innerWidth, h = window.innerHeight;
  const aspect = w / h, t = Math.tan(engine.s.view.fov * Math.PI / 360);
  const tan = aspect >= 1 ? [t, t / aspect] : [t * aspect, t];
  const items = [
    { name: '☀ Sun', dir: engine.sky.sun.dir, alt: engine.sky.sun.alt },
    { name: '☾ Moon', dir: engine.sky.moon.dir, alt: engine.sky.moon.alt },
    ...engine.sky.planets.map(p => ({ name: p.name, dir: p.dir, alt: p.alt, minor: true })),
  ];
  const html = [];
  for (const it of items) {
    if (it.minor && it.alt < 0) continue;
    const d = it.dir;
    const cx = d[0] * b.right[0] + d[1] * b.right[1] + d[2] * b.right[2];
    const cy = d[0] * b.up[0] + d[1] * b.up[1] + d[2] * b.up[2];
    const cz = d[0] * b.forward[0] + d[1] * b.forward[1] + d[2] * b.forward[2];
    const below = it.alt < 0 ? ' (below horizon)' : '';
    if (cz > 0.05) {
      const x = (cx / (cz * tan[0]) * 0.5 + 0.5) * w, y = (0.5 - cy / (cz * tan[1]) * 0.5) * h;
      if (x > -20 && x < w + 20 && y > -20 && y < h + 20) {
        html.push(`<span class="lbl${it.minor ? ' minor' : ''}" style="left:${x.toFixed(0)}px;top:${(y + 14).toFixed(0)}px">${it.name}${below}</span>`);
        continue;
      }
    }
    if (!it.minor) {                     // off-screen: arrow at the screen edge pointing the way
      const ang = Math.atan2(-cy, cx) ;
      const r = Math.min(w, h) * 0.42;
      const x = w / 2 + Math.cos(ang) * r, y = h / 2 + Math.sin(ang) * r;
      html.push(`<span class="lbl edge" style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px">${it.name}${below} ${Math.round(it.alt)}°</span>`);
    }
  }
  const look = controls.lookDir;
  const card = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(look.az / 45) % 8];
  html.push(`<div class="readout">${card} ${Math.round(look.az)}° · ${look.alt >= 0 ? '+' : ''}${Math.round(look.alt)}°</div>`);
  hud.innerHTML = html.join('');
}

// ------------------------------------------------------------ time travel --
function applySim() {
  const on = document.getElementById('simEnabled')?.checked;
  const input = document.getElementById('simTime');
  if (!engine) return;
  if (!on) { engine.set({ sim: null }); return; }
  let base = input?.value ? new Date(input.value) : new Date();
  if (isNaN(base)) base = new Date();
  engine.set({ sim: { base, startPerf: performance.now(), scale: num(conf.simSpeed, 1) } });
}

// -------------------------------------------------------------- toast ----
const toastEl = document.getElementById('toast');
let toastTimer = 0;
function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4000);
}

// ------------------------------------------------------------------ init --
export function refreshSky() {                 // kept for older callers: location / settings changed
  applyLocation(); scheduleLiveData();
}

export async function setViewMode(mode) {
  const ok = await controls.setMode(mode);
  conf.viewMode = ok ? mode : conf.viewMode === 'look' ? 'fixed' : conf.viewMode;
  document.body.dataset.view = controls.mode;
  document.getElementById('viewMode').value = controls.mode;
  document.getElementById('vrButton')?.setAttribute('aria-pressed', String(controls.mode === 'look'));
  return ok;
}

function init() {
  try {
    engine = new SkyEngine(canvas, { baseUrl: '.' });
  } catch (e) {
    startFallback(e.message);
    return;
  }
  window.__sky = engine;                         // handy for debugging / tests
  controls = new Controls(engine, { onToast: toast, onChange: () => { glass?.updateLight(); } });
  window.__controls = controls;
  glass = initGlass(engine, () => engine._basis());

  applyQuality(); applyLocation(); applyView(); applyWeather(); applyLandscape();
  engine.start();
  engine.onFrame(() => { window.__frames = (window.__frames || 0) + 1; });

  // periodic UI-facing work, decoupled from the render loop
  setInterval(updateClockColor, 3000);
  setInterval(updateFavicon, 60000);
  setInterval(updateHud, 250);
  setTimeout(() => { updateClockColor(); updateFavicon(); }, 1200);

  // ---- wire settings controls ----
  const $ = (id) => document.getElementById(id);
  const bindSelect = (id, key, after, parse) => {
    const el = $(id); if (!el) return;
    el.value = String(conf[key]);
    el.addEventListener('change', () => { conf[key] = parse ? parse(el.value) : el.value; after?.(); });
  };
  const bindRange = (id, key, after, outId) => {
    const el = $(id); if (!el) return;
    el.value = conf[key];
    const out = outId && $(outId);
    const sync = () => { if (out) out.textContent = el.value; };
    sync();
    el.addEventListener('input', () => { conf[key] = parseFloat(el.value); sync(); after?.(); });
  };

  bindSelect('quality', 'quality', applyQuality);
  bindSelect('landscape', 'landscape', () => { scheduleLiveData(); applyLandscape(); });
  bindSelect('weatherMode', 'weatherMode', () => { applyWeather(); scheduleLiveData(); });
  bindSelect('lightPollution', 'lightPollution', () => { applyQuality(); });
  bindSelect('bodySize', 'bodySize', applyQuality, parseFloat);
  bindSelect('cloudMotion', 'cloudMotion', applyQuality, parseFloat);
  bindSelect('clockColor', 'clockColor', updateClockColor);
  bindSelect('clockStyle', 'clockStyle', () => { glass.apply(); updateClockColor(); });
  bindRange('glassFrost', 'glassFrost', () => glass.apply(), 'glassFrostOut');
  bindRange('nightBrightness', 'nightBrightness', applyQuality, 'nightBrightnessOut');
  bindRange('viewHeading', 'viewHeading', applyView, 'viewHeadingOut');
  bindRange('viewPitch', 'viewPitch', applyView, 'viewPitchOut');
  bindRange('viewFov', 'viewFov', applyView, 'viewFovOut');
  $('showLabels').checked = !!conf.showLabels;
  $('showLabels').addEventListener('change', (e) => { conf.showLabels = e.target.checked; updateHud(); });

  $('viewMode').value = conf.viewMode === 'look' ? 'fixed' : conf.viewMode;   // never auto-start sensors on load
  $('viewMode').addEventListener('change', (e) => setViewMode(e.target.value));
  if (conf.viewMode === 'drag') setViewMode('drag');
  else conf.viewMode = 'fixed';

  const vr = $('vrButton');
  if (vr) {
    const hasSensors = typeof DeviceOrientationEvent !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
    vr.hidden = !hasSensors;
    vr.addEventListener('click', () => setViewMode(controls.mode === 'look' ? (conf.viewMode === 'drag' ? 'drag' : 'fixed') : 'look'));
  }

  // time travel
  const simEn = $('simEnabled'), simTime = $('simTime'), simSpeed = $('simSpeed');
  const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  simTime.value = toLocalInput(new Date());
  simSpeed.value = String(conf.simSpeed);
  simEn.checked = false;
  simEn.addEventListener('change', () => { if (simEn.checked) simTime.value = toLocalInput(now()); applySim(); });
  simTime.addEventListener('change', () => { simEn.checked = true; applySim(); });
  simSpeed.addEventListener('change', () => { conf.simSpeed = parseFloat(simSpeed.value); if (simEn.checked) { simTime.value = toLocalInput(now()); applySim(); } });
  $('simNow').addEventListener('click', () => { simEn.checked = false; applySim(); });

  window.addEventListener('locationchange', () => { applyLocation(); scheduleLiveData(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) engine.dirty = true; });
  window.addEventListener('resize', () => { engine.dirty = true; });

  // dev / test deep links (not persisted):
  //   ?t=2026-06-21T20:30:00Z&speed=60&az=280&pitch=10&weather=storm&landscape=ocean&lat=40.7&lon=-74
  const q = new URLSearchParams(location.search);
  if (q.has('weather')) ov.weather = q.get('weather');
  if (q.has('landscape')) ov.landscape = q.get('landscape');
  if (q.has('az')) ov.az = num(q.get('az'), 180);
  if (q.has('pitch')) ov.pitch = num(q.get('pitch'), 12);
  if (q.has('lp')) ov.lp = q.get('lp');
  if (q.has('lat') && q.has('lon')) { ov.lat = num(q.get('lat'), 40); ov.lon = num(q.get('lon'), -74); }
  if (q.has('t')) {
    const base = new Date(q.get('t'));
    if (!isNaN(base)) { simEn.checked = true; simTime.value = toLocalInput(base); engine.set({ sim: { base, startPerf: performance.now(), scale: num(q.get('speed'), 0) } }); }
  }
  if (Object.keys(ov).length) { applyQuality(); applyLocation(); applyView(); applyWeather(); applyLandscape(); }
  scheduleLiveData();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

export { getSim };
