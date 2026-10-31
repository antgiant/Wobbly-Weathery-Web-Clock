// Glue between the settings (conf), the sky engine and the page.

import { conf, formatTemp } from '../config.js';
import { setSim, getSim, now } from '../simtime.js';
import { SkyEngine } from './engine.js';
import { Controls } from './controls.js';
import { PRESETS, fetchLiveWeather, fetchMarine, mapMarine, CLEAR, fetchWeatherDay, weatherFromDay, fetchClimate } from './weather.js';
import { fetchDem, demSkyline, LANDSCAPES } from './landscape.js';
import Virgo from '../virgo/virgo.js';
import { initGlass } from './glass.js';
import { fetchBiome, fallbackBiome, classify, seasonOf, seasonFromClimate, paletteFor } from './biome.js';
import { generatePlants } from './plants.js';
import { estimateBortle, fetchPlaces } from './lightpollution.js';
import { sunEvents, countdownState, followHeading } from './sunpath.js';

const canvas = document.getElementById('sky');
const statusEls = {
  terrain: document.getElementById('terrainStatus'),
  weather: document.getElementById('weatherStatus'),
  sky: document.getElementById('skyStatus'),
  lp: document.getElementById('lpStatus'),
};
const setStatus = (k, t) => { if (statusEls[k]) { if (k === 'terrain' && !t.includes('Land cover') && !t.includes('Sea:')) statusEls[k].dataset.base = t; statusEls[k].textContent = t; } };

let engine = null;
let controls = null;
let glass = null;
const state = { seaText: '', liveWeather: null, elevation: null, dem: null, lpBortle: 3, lpLocal: null, biome: null };
const ov = {};                      // deep-link overrides (never written to localStorage)
const DEG = Math.PI / 180;
const num = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
// unknown time zone (e.g. plain "UTC"): guess a longitude from the UTC offset, 15 degrees per hour
const DEFAULT_LAT = 40;
const defaultLon = () => Math.max(-180, Math.min(180, -new Date().getTimezoneOffset() / 4));
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } };

// Weather and terrain services get a rounded position (about 11 km for weather, 5 km for terrain), never the exact
// one, unless the user turned that off. Everything that is drawn still uses the exact position, locally.
const coarse = (v, step) => (conf.coarseLookups === false ? v : Math.round(v / step) * step);
const ymd = (d) => d.toISOString().slice(0, 10);
// time travel far from now: the weather should be what it was (or will be) then
const histActive = () => !!getSim() && Math.abs(+now() - Date.now()) > 2 * 3600e3;

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
  if (v === 'auto') return state.lpLocal?.bortle ?? state.lpBortle;
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

// Bottom edge of the clock digits, in canvas CSS pixels (digit glyphs end at the bottom of their viewBox).
function clockBottom() {
  const cr = canvas.getBoundingClientRect();
  let bottom = -Infinity, digitH = 0;
  document.querySelectorAll('#clock svg').forEach((el) => {
    if (getComputedStyle(el).display === 'none') return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const k = Math.min(r.width / 100, r.height / 116);
    bottom = Math.max(bottom, r.top + (r.height - 116 * k) / 2 + 116 * k - cr.top);
    digitH = Math.max(digitH, 116 * k);
  });
  return Number.isFinite(bottom) ? { bottom, dh: digitH, h: cr.height, w: cr.width } : null;
}

// Tilt the camera so the horizon lands exactly on the bottom of the digits. In a rectilinear view the
// horizon is a straight line at ndc_y = -tan(pitch) / tan(fovY / 2), so solve for the pitch.
function pitchForHorizonAtClockBottom(fovDeg) {
  const m = clockBottom();
  if (!m || !m.h) return null;
  // the horizon crosses the digits this far up from their bottom edge, so the glass shows ground
  const frac = Math.max(0, Math.min(0.8, num(conf.horizonInDigits, 0.3)));
  const ndc = 1 - 2 * (m.bottom - frac * m.dh) / m.h;
  const t = Math.tan(fovDeg * Math.PI / 360), aspect = m.w / m.h;
  const ty = aspect >= 1 ? t / aspect : t;
  const p = Math.atan(-ndc * ty) * 180 / Math.PI;
  return Math.max(-10, Math.min(80, p));
}

// Sunrise and sunset times are searched for once per bracket (between two events) rather than on every tick.
const evCache = { key: '', at: 0, ev: null };
function getSunEvents(date) {
  const lat = num(ov.lat ?? conf.location_latitude, DEFAULT_LAT), lon = num(ov.lon ?? conf.location_longitude, defaultLon());
  const elev = engine?.s.elevM || 0, key = `${lat.toFixed(3)},${lon.toFixed(3)},${Math.round(elev)}`;
  const t = +date, c = evCache.ev;
  const fresh = c && evCache.key === key && Math.abs(t - evCache.at) < 12 * 3600e3
    && t >= Math.max(+(c.prevRise || 0), +(c.prevSet || 0)) && t < Math.min(+(c.nextRise || Infinity), +(c.nextSet || Infinity));
  if (!fresh) { evCache.ev = sunEvents(date, lat, lon, elev); evCache.key = key; evCache.at = t; }
  return { ev: evCache.ev, lat, lon, elev };
}

// "the default view": the clock view, or look-around that has not been dragged away from where it started
const atDefault = () => controls?.mode === 'fixed' || (controls?.mode === 'drag' && !controls.userMoved);
const followActive = () => !!conf.followSun && atDefault() && ov.az == null;

function applyView() {
  if (!controls) return;
  const fov = num(conf.viewFov, 80);
  let pitch = num(ov.pitch ?? conf.viewPitch, 12);
  if (controls.mode === 'drag' && controls.userMoved) { controls.setView({ fov }); return; }   // the user's view is theirs
  const auto = ov.pitch == null && conf.viewPitchAuto && atDefault();
  if (auto) pitch = pitchForHorizonAtClockBottom(fov) ?? pitch;
  const slider = document.getElementById('viewPitch');
  if (slider) { slider.disabled = !!(ov.pitch == null && conf.viewPitchAuto); if (auto) { slider.value = Math.round(pitch); const o = document.getElementById('viewPitchOut'); if (o) o.textContent = Math.round(pitch); } }
  let heading = num(ov.az ?? conf.viewHeading, 180);
  const follow = followActive();
  if (follow) {
    // never touches the pitch: only the heading follows the sun, so the sun stays put up and down
    const d = now(), { ev, lat, lon, elev } = getSunEvents(d);
    const t = Math.tan(fov * Math.PI / 360), aspect = window.innerWidth / Math.max(1, window.innerHeight);
    heading = followHeading(d, lat, lon, elev, { pitch, tanX: aspect >= 1 ? t : t * aspect }, ev);
  }
  const hs = document.getElementById('viewHeading');
  if (hs) { hs.disabled = follow; if (follow) { hs.value = Math.round(heading); const o = document.getElementById('viewHeadingOut'); if (o) o.textContent = Math.round(heading); } }
  controls.setView({ heading, pitch, fov });
}

const tempText = (w) => (Number.isFinite(w.tempC) ? ` · ${formatTemp(w.tempC)}` : '');
function applyWeather() {
  if (!engine) return;
  const mode = ov.weather ?? conf.weatherMode;
  let w = null;
  if (mode === 'live' && histActive()) {
    const hw = state.hist ? weatherFromDay(state.hist.data, now()) : null;
    w = hw || CLEAR;
    setStatus('weather', hw ? `Weather on ${hw.label}${tempText(hw)}` : (state.histError ? 'No weather record for that date, showing clear sky' : 'Loading the weather for that date…'));
  } else if (mode === 'live') {
    w = state.liveWeather || CLEAR;
    setStatus('weather', state.liveWeather ? `Live: ${state.liveWeather.label}${tempText(state.liveWeather)}` : 'Live weather not loaded yet, showing clear sky');
  } else {
    w = PRESETS[mode] || CLEAR;
    setStatus('weather', `Manual: ${w.label}`);
  }
  // aerosol optical depth -> Mie multiplier (the model's clean-air baseline is ~0.01 AOD)
  const mie = Math.min(12, 1 + 12 * (w.aod ?? 0.12));
  engine.set({ weather: w, mie });
  applyPlants();
}

// ----------------------------------------------- time-dependent data (history, seasons) --
// One day of hourly weather for the time-travel date, and the last month's warmth for the seasons. Both are
// cached on the device; they only change when the (simulated) date does.
const dayLoad = { key: '', hour: -1, busy: false };
async function cachedFetch(key, ttlMs, fetcher) {
  const c = lsGet(key);
  if (c && Date.now() - c.t < ttlMs) return c.v;
  const v = await fetcher();
  lsSet(key, { t: Date.now(), v });
  return v;
}
async function syncTimeData() {
  if (!engine || dayLoad.busy) return;
  const d = now(), hist = histActive() && (ov.weather ?? conf.weatherMode) === 'live';
  const lat0 = num(ov.lat ?? conf.location_latitude, NaN), lon0 = num(ov.lon ?? conf.location_longitude, NaN);
  if (!Number.isFinite(lat0) || !Number.isFinite(lon0) || (lat0 === -1 && lon0 === -1)) return;
  const lat = coarse(lat0, 0.1), lon = coarse(lon0, 0.1);
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${ymd(d)},${hist ? 'h' : 'l'}`;
  if (key === dayLoad.key) {                                   // same day: only the hour moves
    if (hist && d.getUTCHours() !== dayLoad.hour) { dayLoad.hour = d.getUTCHours(); applyWeather(); }
    return;
  }
  dayLoad.busy = true;
  try {
    // weather of that day
    if (hist) {
      state.histError = false;
      try {
        const data = await cachedFetch(`wxh:${lat.toFixed(1)},${lon.toFixed(1)},${ymd(d)}`, 30 * 86400e3, () => fetchWeatherDay(lat, lon, d));
        state.hist = data ? { data } : null; state.histError = !data;
        if (data && data.elevation != null && state.elevation == null) state.elevation = data.elevation;
      } catch (e) { state.hist = null; state.histError = true; console.info('[sky] weather history failed:', e.message); }
    } else state.hist = null;
    // the season the plants are in
    try {
      const c = await cachedFetch(`clim:${lat.toFixed(1)},${lon.toFixed(1)},${ymd(d)}`, 30 * 86400e3, () => fetchClimate(lat, lon, d));
      state.climate = c;
    } catch (e) { state.climate = null; console.info('[sky] climate fetch failed:', e.message); }
    dayLoad.key = key; dayLoad.hour = d.getUTCHours();
  } finally { dayLoad.busy = false; }
  applyWeather();
}

function applyLandscapeCore() {
  if (!engine) return;
  const type = ov.landscape ?? conf.landscape;
  const eyeM = (engine.s.elevM || 0) + engine.s.eyeM;
  if (type === 'auto') {
    if (state.dem) {
      const sk = demSkyline(state.dem, eyeM);
      const sea = sk.ocean || state.biome?.kind === 'water';
      const t = sea ? 'ocean' : (sk.maxElevM > 400 ? 'mountains' : 'hills');
      const spec = LANDSCAPES[t];
      engine.set({ landscape: { type: t, skyline: sk.data, albedo: spec.albedo, haze: sk.haze, ocean: sea } });
      setStatus('terrain', sea ? 'Real terrain: open water' : `Real terrain from elevation data (peaks to ${Math.round(sk.maxElevM)} m)`);
      return;
    }
    engine.setLandscapeType(state.biome?.kind === 'water' ? 'ocean' : 'hills', seedFromLocation());
    setStatus('terrain', 'Estimating (elevation data not loaded)');
    return;
  }
  engine.setLandscapeType(type, seedFromLocation());
  setStatus('terrain', LANDSCAPES[type]?.label || type);
}
function applyLandscape() { applyLandscapeCore(); applyPlants(); loadSea(); }

// Sea state for open water: real wave height / period / direction from the marine forecast, cached
// for 30 minutes; without it (offline, inland lake, API refusing) the waves grow from the wind speed.
let seaBusy = false;
async function loadSea() {
  if (!engine) return;
  if (!engine.s.landscape.ocean) { state.seaText = ''; if (engine.s.sea) engine.set({ sea: null }); return; }
  if (ov.waves) {                                              // ?waves=2.5x9 : height m x period s
    const [h, t] = ov.waves.split('x').map(parseFloat);
    const d = [Math.sin(1.2), Math.cos(1.2)];
    engine.set({ sea: { windHs: h || 1, windTp: t || 7, windDir: d, swellHs: 0, swellTp: 9, swellDir: d } });
    state.seaText = `Sea: ${h} m waves (forced)`; setStatus('terrain', statusText()); return;
  }
  if ((ov.weather ?? conf.weatherMode) !== 'live') { state.seaText = 'Sea: waves follow the chosen weather'; engine.set({ sea: null }); setStatus('terrain', statusText()); return; }
  const lat = num(ov.lat ?? conf.location_latitude, DEFAULT_LAT), lon = num(ov.lon ?? conf.location_longitude, defaultLon());
  const key = `marine:${lat.toFixed(1)},${lon.toFixed(1)}`;
  let m = null;
  const cached = lsGet(key);
  if (cached && Date.now() - cached.t < 30 * 60000) m = cached.sea;
  else if (!seaBusy) {
    seaBusy = true;
    try { m = await fetchMarine(coarse(lat, 0.1), coarse(lon, 0.1)); lsSet(key, { t: Date.now(), sea: m }); }
    catch (e) { console.info('[sky] marine fetch failed:', e.message); }
    seaBusy = false;
  }
  state.seaText = m ? `Sea: ${m.label} (live)` : 'Sea: waves grown from the wind (no marine data here)';
  engine.set({ sea: m });
  setStatus('terrain', statusText());
}
const seedFromLocation = () => Math.abs(Math.round(num(conf.location_latitude, 0) * 10 + num(conf.location_longitude, 0) * 7)) + 1;

// ------------------------------------------------------------ vegetation ----
// Ground colours and plants follow the biome (from satellite imagery, or latitude rules offline), the
// season (date + hemisphere) and the weather (snow cover). Cities and open water get none.
const FORCED = {   // ?biome= deep-link values
  conifer: { kind: 'forest', conifer: true }, forest: { kind: 'forest' }, tropical: { kind: 'forest', tropical: true },
  grass: { kind: 'grass' }, steppe: { kind: 'steppe' }, desert: { kind: 'desert' }, tundra: { kind: 'tundra' }, urban: { kind: 'urban' }, snow: { kind: 'snow' },
};
function currentBiome() {
  const lat = num(ov.lat ?? conf.location_latitude, DEFAULT_LAT), lon = num(ov.lon ?? conf.location_longitude, defaultLon());
  let b = state.biome || fallbackBiome(lat, lon);
  if (ov.biome && FORCED[ov.biome]) b = { ...b, region: b.region, conifer: false, tropical: false, ...FORCED[ov.biome] };
  if ((ov.landscape ?? conf.landscape) === 'desert') b = { ...b, kind: 'desert', conifer: false, tropical: false };
  return b;
}
function applyPlants() {
  if (!engine) return;
  const type = engine.s.landscape.type, water = engine.s.landscape.ocean || type === 'ocean';
  const b = currentBiome();
  const on = !!conf.plants && !water && type !== 'city' && b.kind !== 'water';
  const season = seasonFromClimate(now(), b.lat ?? num(conf.location_latitude, DEFAULT_LAT), b, state.climate);
  const w = engine.s.weather;
  const pal = paletteFor(b, season, w.snowCover || 0, b.rgb);
  // ground colours follow the biome too (the ocean keeps its own water shading)
  if (!water && type !== 'city') engine.set({ ground: { g1: pal.ground, g2: pal.ground2 } });
  else engine.set({ ground: null });
  const q = engine.s.quality;
  const count = q === 'low' ? 450 : q === 'high' ? 1500 : 1000;
  const seed = seedFromLocation();
  const key = `${b.kind}|${b.conifer}|${b.tropical}|${b.region}|${season}|${count}|${seed}`;
  if (on && key !== state.plantKey) {
    state.plantKey = key;
    engine.setPlants({ ...generatePlants(b, { count, seed, season }), palette: pal, on });
  } else engine.setPlants({ palette: pal, on });
  setStatus('terrain', statusText());
}
function statusText() {
  const b = currentBiome(), t = engine?.s.landscape.type;
  const base = (document.getElementById('terrainStatus')?.dataset.base) || '';
  const bio = state.biome ? `Land cover: ${b.kind}${b.conifer ? ' (conifer)' : b.tropical ? ' (tropical)' : ''}` : 'Land cover: estimated from latitude';
  return [base, t === 'ocean' || t === 'city' ? (t === 'ocean' ? state.seaText : '') : bio].filter(Boolean).join(' · ');
}

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
  applyPlants();
}

// Light pollution from the settlements around the spot (see lightpollution.js); the time-zone guess is the fallback.
let lpBusy = '';
async function loadLightPollution(lat, lon) {
  const clat = coarse(lat, 0.05), clon = coarse(lon, 0.05), key = `lp2:${clat.toFixed(2)},${clon.toFixed(2)}`;
  const urban = state.biome?.kind === 'urban';
  let est = lsGet(key);
  if (!est && lpBusy !== key) {
    lpBusy = key;
    try {
      const places = await fetchPlaces(clat, clon);
      const r = estimateBortle(clat, clon, places);
      est = { bortle: r.bortle, nearest: r.nearest, n: places.length };
      lsSet(key, est);
    } catch (e) { console.info('[sky] light pollution lookup failed:', e.message); setStatus('lp', 'Estimated from the time zone (nearby towns could not be looked up)'); }
    lpBusy = '';
  }
  if (!est) return;
  const b = urban ? Math.max(est.bortle, 7) : est.bortle;
  state.lpLocal = { bortle: b };
  const near = est.nearest ? ` · nearest ${est.nearest.name}, ${Math.round(est.nearest.km)} km` : ' · no towns nearby';
  setStatus('lp', `Estimated Bortle ${b} from the towns around you${near}`);
  applyLocation(); applyQuality();
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

  loadLightPollution(lat, lon);

  // land cover: one small satellite tile, cached for good
  if (!ov.biome) {
    const bioKey = `biome:${lat.toFixed(2)},${lon.toFixed(2)}`;
    let bio = lsGet(bioKey);
    if (!bio) {
      try { bio = await fetchBiome(lat, lon, state.elevation ?? 0); lsSet(bioKey, bio); }
      catch (e) { console.info('[sky] land cover fetch failed:', e.message); }
    }
    if (bio) { state.biome = bio; applyLandscape(); loadLightPollution(lat, lon); }
  }

  // terrain: cached for good, it does not change
  if ((ov.landscape ?? conf.landscape) === 'auto') {
    const demKey = `dem:${lat.toFixed(2)},${lon.toFixed(2)}`;
    state.dem = lsGet(demKey);
    if (!state.dem) {
      try {
        state.dem = await fetchDem(coarse(lat, 0.05), coarse(lon, 0.05), signal);
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
        const r = await fetchLiveWeather(coarse(lat, 0.1), coarse(lon, 0.1), signal);
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
// Solid ink: pick whichever of light or dark ink has the better worst-case brightness contrast (WCAG ratio, so it
// holds for colour-blind eyes too) against the sky behind the digits, and ring it with a halo of the opposite
// tone so it still reads where the sky changes from bright to dark behind it.
const lin = (v) => Math.pow(Math.max(0, v), 2.2);
const relLum = (p) => 0.2126 * lin(p.r) + 0.7152 * lin(p.g) + 0.0722 * lin(p.b);
const INK = { light: { css: '#f4f7ff', rgb: [0.96, 0.97, 1], L: 0.93, halo: 'rgba(5,10,30,0.55)' }, dark: { css: '#0a163c', rgb: [0.03, 0.06, 0.18], L: 0.009, halo: 'rgba(255,255,255,0.55)' } };
async function updateClockColor() {
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
  const look = controls.lookDir;
  const m = 26;                                     // keep edge labels this far inside the screen
  const edge = (x, y, text) => {                    // labels hug the edge they are pinned to instead of sticking out of the screen
    const side = x <= m ? 'l' : x >= w - m ? 'r' : 'c';
    const px = side === 'l' ? 8 : side === 'r' ? w - 8 : x;
    return `<span class="lbl edge ${side}" style="left:${px.toFixed(0)}px;top:${y.toFixed(0)}px">${text}</span>`;
  };
  const fovV = 2 * Math.atan(tan[1]) / DEG;
  for (const it of items) {
    if (it.minor && it.alt < 0) continue;
    const d = it.dir;
    const cx = d[0] * b.right[0] + d[1] * b.right[1] + d[2] * b.right[2];
    const cy = d[0] * b.up[0] + d[1] * b.up[1] + d[2] * b.up[2];
    const cz = d[0] * b.forward[0] + d[1] * b.forward[1] + d[2] * b.forward[2];
    const below = it.alt < 0 ? ' (below horizon)' : '';
    const cls = it.minor ? ' minor' : '';
    if (cz > 0.05) {
      const x = (cx / (cz * tan[0]) * 0.5 + 0.5) * w, y = (0.5 - cy / (cz * tan[1]) * 0.5) * h;
      if (x > -20 && x < w + 20 && y > -20 && y < h + 20) {
        html.push(`<span class="lbl${cls}" style="left:${x.toFixed(0)}px;top:${(y + 14).toFixed(0)}px">${it.name}${below}</span>`);
        continue;
      }
      if (!it.minor) {                              // in front but off screen: pin it to the nearest edge, where it really is
        const ex = Math.min(w - m, Math.max(m, x)), ey = Math.min(h - m, Math.max(m, y));
        const arrow = x < 0 ? '◀ ' : x > w ? '' : '';
        const tail = x > w ? ' ▶' : '';
        const vert = y < 0 ? '▲ ' : y > h ? '▼ ' : '';
        html.push(edge(ex, ey, `${arrow}${vert}${it.name}${below} ${Math.round(it.alt)}°${tail}`));
      }
      continue;
    }
    if (!it.minor) {
      // Behind the camera. Projecting it would put an object that is below the horizon near the top of the
      // screen whenever the view is tilted up, so place it by what it really is: which way to turn
      // (left / right) and how far above or below where you are looking (altitude difference).
      const right = cx >= 0;
      const dv = it.alt - look.alt;
      const f = Math.max(-1, Math.min(1, dv / Math.max(fovV, 30)));
      const ey = h / 2 - f * (h / 2 - m);
      const ex = right ? w - m : m;
      html.push(edge(ex, ey, `${right ? '' : '◀ '}${it.name}${below} ${Math.round(it.alt)}°${right ? ' ▶' : ''}`));
    }
  }
  const card = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(look.az / 45) % 8];
  html.push(`<div class="readout">${card} ${Math.round(look.az)}° · ${look.alt >= 0 ? '+' : ''}${Math.round(look.alt)}°</div>`);
  hud.innerHTML = html.join('');
}

// ------------------------------------------------------------ time travel --
function applySim() {
  const on = document.getElementById('simEnabled')?.checked;
  const input = document.getElementById('simTime');
  if (!engine) return;
  if (!on) { engine.set({ sim: null }); syncTimeData(); applyPlants(); return; }
  let base = input?.value ? new Date(input.value) : new Date();
  if (isNaN(base)) base = new Date();
  engine.set({ sim: { base, startPerf: performance.now(), scale: num(conf.simSpeed, 1) } });
  syncTimeData();
  applyPlants();
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

// ------------------------------------------------------ countdown / readout --
// On the LED panel the countdown cannot be a page overlay, so it is painted into the picture before the
// pixels are taken: a sun on the horizon with an arrow (up = sunrise, down = sunset), the time left in big
// digits, and a bar that runs down to nothing. It goes in whichever strip above or below the clock is
// bigger, and shrinks to fit, so it never covers the time.
const ledCard = window.__ledCard = document.createElement('canvas');
let ledCardKey = '';

/** Top and bottom of the digits as fractions of the canvas height (y down), or null. */
function clockSpan() {
  const m = clockBottom();
  if (!m) return null;
  let top = Infinity;
  document.querySelectorAll('#clock svg').forEach((el) => {
    if (getComputedStyle(el).display === 'none') return;
    const r = el.getBoundingClientRect();
    if (r.width < 1) return;
    const k = Math.min(r.width / 100, r.height / 116);
    top = Math.min(top, r.top + (r.height - 116 * k) / 2 - canvas.getBoundingClientRect().top);
  });
  return Number.isFinite(top) ? { top: Math.max(0, top) / m.h, bottom: m.bottom / m.h } : null;
}

function drawLedCard(st, leadMs) {
  const cw = engine.canvas.width, ch = engine.canvas.height;
  if (!st || !(cw > 0 && ch > 0)) { if (ledCardKey) { ledCardKey = ''; engine.setOverlay(null); } return; }
  const W = 384, H = Math.max(2, Math.round(W * ch / cw));
  const total = Math.ceil(Math.max(0, st.msLeft) / 1000);
  const text = st.msLeft <= 0 ? 'NOW' : `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

  // the free strip above or below the digits
  const span = clockSpan() || { top: 0.34, bottom: 0.66 };
  const pad = 0.025;
  const above = span.top - 2 * pad, below = 1 - span.bottom - 2 * pad;
  const wide = W > H;
  const want = wide ? 0.42 : 0.25;
  const useTop = above >= below;
  const room = Math.max(above, below);
  const hFrac = Math.min(want, room);
  if (hFrac < 0.09) { if (ledCardKey) { ledCardKey = ''; engine.setOverlay(null); } return; }   // no room that would be legible
  const yFrac = useTop ? pad + (room - hFrac) / 2 : span.bottom + pad + (room - hFrac) / 2;

  const x = wide ? W * 0.12 : W * 0.05, y = H * yFrac, w = wide ? W * 0.76 : W * 0.9, h = H * hFrac;
  const key = `${st.kind}|${text}|${W}x${H}|${y.toFixed(0)}|${h.toFixed(0)}`;
  if (key === ledCardKey) return;
  ledCardKey = key;
  ledCard.width = W; ledCard.height = H;
  const c = ledCard.getContext('2d');
  c.clearRect(0, 0, W, H);
  const rise = st.kind === 'sunrise', col = rise ? '#ffd24a' : '#ff7a2e';
  c.fillStyle = 'rgba(0,0,0,0.9)';
  c.beginPath(); c.roundRect(x, y, w, h, Math.min(w, h) * 0.12); c.fill();
  // icon on the left of the time when the card is wide, above it when it is not
  const sideBySide = w / h > 2.2;
  const ib = sideBySide ? { x: x, y: y, w: w * 0.3, h: h } : { x: x, y: y, w: w, h: h * 0.42 };
  const tb = sideBySide ? { x: x + w * 0.3, y: y, w: w * 0.7, h: h * 0.9 } : { x: x, y: y + h * 0.4, w: w, h: h * 0.52 };
  const cx = ib.x + ib.w / 2, r = Math.min(ib.w, ib.h) * 0.3, hy = ib.y + ib.h * 0.72;
  c.fillStyle = col; c.beginPath(); c.arc(cx, hy, r, Math.PI, 0); c.fill();          // half sun on the horizon
  c.strokeStyle = '#fff'; c.lineWidth = Math.max(2, r * 0.18); c.lineCap = 'round';
  c.beginPath(); c.moveTo(cx - r * 1.6, hy); c.lineTo(cx + r * 1.6, hy); c.stroke();  // horizon
  const ay = hy - r * 1.55, d = rise ? -1 : 1;                                       // arrow above it
  c.fillStyle = '#fff'; c.beginPath();
  c.moveTo(cx, ay + d * r * 0.55); c.lineTo(cx - r * 0.5, ay - d * r * 0.35); c.lineTo(cx + r * 0.5, ay - d * r * 0.35); c.closePath(); c.fill();
  // time, as large as the box allows
  let fs = tb.h;
  c.font = `800 ${fs}px ui-monospace, Menlo, Consolas, monospace`;
  const tw = c.measureText(text).width; if (tw > tb.w * 0.94) fs *= tb.w * 0.94 / tw;
  c.font = `800 ${fs}px ui-monospace, Menlo, Consolas, monospace`;
  c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, tb.x + tb.w / 2, tb.y + tb.h / 2 + fs * 0.04);
  // remaining time as a bar
  const frac = Math.max(0, Math.min(1, st.msLeft / leadMs));
  c.fillStyle = col; c.fillRect(x + w * 0.06, y + h - h * 0.08, (w * 0.88) * frac, h * 0.045);
  engine.setOverlay(ledCard);
}

function updateCountdown() {
  const el = document.getElementById('sunCountdown');
  if (!el || !engine) return;
  const mode = conf.countdown, led = conf.screenMode === 'led';
  if (!mode || mode === 'off') { el.hidden = true; if (led) drawLedCard(null); return; }
  const d = now();
  const lead = num(conf.countdownLead, 20);
  const st = countdownState(getSunEvents(d).ev, +d, mode, lead);
  if (led) { el.hidden = true; drawLedCard(st, lead * 60000); return; }
  if (ledCardKey) drawLedCard(null);
  if (!st) { el.hidden = true; return; }
  const rise = st.kind === 'sunrise', name = rise ? 'Sunrise' : 'Sunset';
  const total = Math.ceil(Math.max(0, st.msLeft) / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0'), ss = String(total % 60).padStart(2, '0');
  const html = st.msLeft <= 0
    ? `<span class="icon" aria-hidden="true">☀</span><span class="what">${name}</span>`
    : `<span class="icon" aria-hidden="true">${rise ? '☀↑' : '☀↓'}</span><span class="what">${name} in</span><span class="time">${mm}:${ss}</span>`;
  if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
  el.dataset.kind = st.kind;
  el.hidden = false;
}

// Raw sensor numbers, for working out what a device does (Settings -> View -> Motion sensor fixes).
function updateVrReadout() {
  let el = document.getElementById('vrReadout');
  if (!conf.vrDebug) { if (el) el.hidden = true; return; }
  if (!el) { el = document.createElement('pre'); el.id = 'vrReadout'; document.body.appendChild(el); }
  const d = controls?.debug;
  const f = (v) => (typeof v === 'number' ? v.toFixed(1) : '-');
  el.hidden = false;
  el.textContent = d
    ? `alpha ${f(d.a)}  beta ${f(d.b)}  gamma ${f(d.g)}\nscreen angle ${d.screenAngle}${controls.ignoreScreenAngle ? ' (ignored)' : ''}  absolute ${d.abs}\ncompass ${f(d.compass)}  offset ${f(d.off)}  ref ${d.mode}${conf.compassRef === 'auto' ? ' (auto)' : ''}\nview ${f(controls.lookDir.az)}  ${f(controls.lookDir.alt)}`
    : 'no sensor readings yet (VR look-around must be on)';
}

function applySensorFixes() {
  if (!controls) return;
  controls.ignoreScreenAngle = conf.sensorRotation === 'ignore';
  controls.compass.force = conf.compassRef === 'cam' || conf.compassRef === 'top' ? conf.compassRef : 'auto';
}

// ------------------------------------------------------------------ init --
export function refreshSky() {                 // kept for older callers: location / settings changed
  applyLocation(); scheduleLiveData();
}

let baseMode = 'drag';                         // the mode "default view" returns to (never VR)
export async function setViewMode(mode) {
  const ok = await controls.setMode(mode);
  if (ok && mode !== 'look') baseMode = mode;
  conf.viewMode = ok ? mode : conf.viewMode === 'look' ? 'drag' : conf.viewMode;
  document.body.dataset.view = controls.mode;
  document.getElementById('viewMode').value = controls.mode;
  applyView();
  document.getElementById('vrButton')?.setAttribute('aria-pressed', String(controls.mode === 'look'));
  updateHomeButton();
  return ok;
}

function updateHomeButton() {
  const b = document.getElementById('homeButton');
  if (b && controls) b.dataset.atDefault = String(controls.mode !== 'look' && atDefault());
}

/** Back to the default framing: out of VR, undo any dragging / zooming, and the sun-following view again. */
export async function returnToDefaultView() {
  if (controls.mode === 'look') await setViewMode(baseMode);
  controls.userMoved = false;
  controls.yawOffset = 0;
  applyView();
  updateHomeButton();
}

function init() {
  try {
    engine = new SkyEngine(canvas, { baseUrl: '.' });
  } catch (e) {
    startFallback(e.message);
    return;
  }
  window.__sky = engine;                         // handy for debugging / tests
  controls = new Controls(engine, { onToast: toast, onChange: () => { glass?.updateLight(); }, onUserMove: () => updateHomeButton(), onReset: () => returnToDefaultView() });
  window.__controls = controls;
  glass = initGlass(engine, () => engine._basis());

  applyQuality(); applyLocation(); applyView(); applyWeather(); applyLandscape();
  engine.start();
  engine.onFrame(() => { window.__frames = (window.__frames || 0) + 1; });

  // periodic UI-facing work, decoupled from the render loop
  setInterval(updateClockColor, 3000);
  setInterval(updateFavicon, 60000);
  setInterval(() => { updateHud(); updateVrReadout(); }, 250);
  setInterval(updateCountdown, 500);
  setInterval(syncTimeData, 4000);
  setInterval(() => { if (followActive()) applyView(); }, 1000);     // the sun moves 15 degrees an hour
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
  bindRange('glassGlow', 'glassGlow', () => glass.apply(), 'glassGlowOut');
  bindSelect('glassGlowColor', 'glassGlowColor', () => glass.apply());
  bindSelect('tempUnit', 'tempUnit', applyWeather);
  $('coarseLookups').checked = conf.coarseLookups !== false;
  $('coarseLookups').addEventListener('change', (e) => { conf.coarseLookups = e.target.checked; dayLoad.key = ''; scheduleLiveData(); syncTimeData(); });
  bindSelect('legibility', 'legibility', () => { glass.apply(); updateClockColor(); });
  bindSelect('screenMode', 'screenMode', () => { glass.apply(); updateClockColor(); updateCountdown(); engine.dirty = true; });
  bindSelect('countdown', 'countdown', updateCountdown);
  bindSelect('countdownLead', 'countdownLead', updateCountdown, parseFloat);
  bindSelect('sensorRotation', 'sensorRotation', applySensorFixes);
  bindSelect('compassRef', 'compassRef', applySensorFixes);
  applySensorFixes();
  $('vrDebug').checked = !!conf.vrDebug;
  $('vrDebug').addEventListener('change', (e) => { conf.vrDebug = e.target.checked; updateVrReadout(); });
  $('followSun').checked = !!conf.followSun;
  $('followSun').addEventListener('change', (e) => { conf.followSun = e.target.checked; applyView(); });
  bindRange('nightBrightness', 'nightBrightness', applyQuality, 'nightBrightnessOut');
  bindRange('viewHeading', 'viewHeading', applyView, 'viewHeadingOut');
  bindRange('viewPitch', 'viewPitch', applyView, 'viewPitchOut');
  bindRange('viewFov', 'viewFov', applyView, 'viewFovOut');
  $('plants').checked = !!conf.plants;
  $('plants').addEventListener('change', (e) => { conf.plants = e.target.checked; applyPlants(); });
  bindRange('horizonInDigits', 'horizonInDigits', applyView, 'horizonInDigitsOut');
  $('viewPitchAuto').checked = !!conf.viewPitchAuto;
  $('viewPitchAuto').addEventListener('change', (e) => { conf.viewPitchAuto = e.target.checked; applyView(); });
  // the clock's size follows the window, so keep the horizon pinned to it
  // Only the fixed clock view is re-aligned automatically. In drag / VR modes the view belongs to the user:
  // a phone's toolbar collapsing fires resize events mid-drag and must not snap the view back.
  const realign = () => { if (atDefault()) applyView(); };
  window.addEventListener('resize', realign);
  window.addEventListener('clocklayout', realign);
  $('showLabels').checked = !!conf.showLabels;
  $('showLabels').addEventListener('change', (e) => { conf.showLabels = e.target.checked; updateHud(); });

  // never auto-start the sensors on load: VR falls back to look-around (the default)
  if (conf.viewMode === 'look') conf.viewMode = 'drag';
  $('viewMode').value = conf.viewMode;
  $('viewMode').addEventListener('change', (e) => setViewMode(e.target.value));
  baseMode = conf.viewMode;
  if (conf.viewMode === 'drag') setViewMode('drag');

  $('homeButton').addEventListener('click', () => returnToDefaultView());
  updateHomeButton();
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
  if (q.has('biome')) ov.biome = q.get('biome');
  if (q.has('waves')) ov.waves = q.get('waves');
  if (q.has('lat') && q.has('lon')) { ov.lat = num(q.get('lat'), 40); ov.lon = num(q.get('lon'), -74); }
  if (q.has('t')) {
    const base = new Date(q.get('t'));
    if (!isNaN(base)) { simEn.checked = true; simTime.value = toLocalInput(base); engine.set({ sim: { base, startPerf: performance.now(), scale: num(q.get('speed'), 0) } }); syncTimeData(); }
  }
  if (Object.keys(ov).length) { applyQuality(); applyLocation(); applyView(); applyWeather(); applyLandscape(); }
  scheduleLiveData();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

export { getSim };
