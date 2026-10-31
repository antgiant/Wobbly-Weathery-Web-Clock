// The world around the clock: location, live and historical weather, landscape, plants, the Christmas tree, quality,
// light pollution, and time travel.

import { conf, formatTemp } from '../config.js';
import { now } from '../simtime.js';
import { PRESETS, fetchLiveWeather, fetchMarine, CLEAR, fetchWeatherDay, weatherFromDay, fetchClimate } from './weather.js';
import { fetchDem, demSkyline, LANDSCAPES } from './landscape.js';
import Virgo from '../virgo/virgo.js';
import { fetchBiome, fallbackBiome, seasonFromClimate, paletteFor } from './biome.js';
import { generatePlants } from './plants.js';
import { estimateBortle, fetchPlaces } from './lightpollution.js';
import { isChristmasSeason } from '../season.js';
import { engine, glass, state, ov, num, DEFAULT_LAT, defaultLon, lsGet, lsSet, coarse, ymd, histActive, setStatus, cachedFetch, agoText } from './core.js';

export function bortleFromSettings() {
  const v = ov.lp ?? conf.lightPollution;
  if (v === 'off') return 0;
  if (v === 'auto') return state.lpLocal?.bortle ?? state.lpBortle;
  return Math.min(9, Math.max(1, parseInt(v, 10) || 3));
}

export function applyLocation() {
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


const tempText = (w) => (Number.isFinite(w.tempC) ? ` · ${formatTemp(w.tempC)}` : '');
export function applyWeather() {
  if (!engine) return;
  const mode = ov.weather ?? conf.weatherMode;
  let w = null;
  if (mode === 'live' && histActive()) {
    const hw = state.hist ? weatherFromDay(state.hist.data, now()) : null;
    w = hw || CLEAR;
    setStatus('weather', hw ? `Weather on ${hw.label}${tempText(hw)}` : (state.histError ? 'No weather record for that date, showing clear sky' : 'Loading the weather for that date…'));
  } else if (mode === 'live') {
    w = state.liveWeather || CLEAR;
    const age = Date.now() - state.weatherT;
    setStatus('weather', state.liveWeather
      ? `Live: ${state.liveWeather.label}${tempText(state.liveWeather)}${age > 40 * 60000 ? ` · saved ${agoText(age)} ago, refreshes when a connection is back` : ''}`
      : (navigator.onLine === false ? 'Offline: a clear sky until a connection is back' : 'Live weather not loaded yet, showing clear sky'));
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
export const dayLoad = { key: '', hour: -1, busy: false };
export async function syncTimeData() {
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

export function applyLandscapeCore() {
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
export function applyLandscape() { applyLandscapeCore(); applyPlants(); loadSea(); }

// Sea state for open water: real wave height / period / direction from the marine forecast, cached
// for 30 minutes; without it (offline, inland lake, API refusing) the waves grow from the wind speed.
let seaBusy = false;
export async function loadSea() {
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
    catch (e) { console.info('[sky] marine fetch failed:', e.message); state.needRetry = true; if (cached) m = cached.sea; }   // offline: the last sea state
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
export function currentBiome() {
  const lat = num(ov.lat ?? conf.location_latitude, DEFAULT_LAT), lon = num(ov.lon ?? conf.location_longitude, defaultLon());
  let b = state.biome || fallbackBiome(lat, lon);
  if (ov.biome && FORCED[ov.biome]) b = { ...b, region: b.region, conifer: false, tropical: false, ...FORCED[ov.biome] };
  if ((ov.landscape ?? conf.landscape) === 'desert') b = { ...b, kind: 'desert', conifer: false, tropical: false };
  return b;
}
// A lit Christmas tree from Thanksgiving to Christmas (the date the clock shows, so time travel works). It stands towards
// where the sun is at noon (a little to one side so it is not straight behind the digits), where the follow-the-sun
// view spends its day, and floats on the sea when the
// landscape is the ocean.
export function applyTree() {
  if (!engine) return;
  const on = ov.xmas != null ? ov.xmas === '1' : (conf.holidayTree !== false && isChristmasSeason(now()));
  const lat = num(ov.lat ?? conf.location_latitude, DEFAULT_LAT);
  engine.setTree({ on, az: (lat >= 0 ? 180 : 0) + (lat >= 0 ? 24 : -24), dist: 30, h: 10 });
}

export function applyPlants() {
  if (!engine) return;
  applyTree();
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
export function statusText() {
  const b = currentBiome(), t = engine?.s.landscape.type;
  const base = (document.getElementById('terrainStatus')?.dataset.base) || '';
  const bio = state.biome ? `Land cover: ${b.kind}${b.conifer ? ' (conifer)' : b.tropical ? ' (tropical)' : ''}` : 'Land cover: estimated from latitude';
  return [base, t === 'ocean' || t === 'city' ? (t === 'ocean' ? state.seaText : '') : bio].filter(Boolean).join(' · ');
}

export function applyQuality() {
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
  glass?.apply();                                         // the automatic clock style is flat colour while saving power
}

// Light pollution from the settlements around the spot (see lightpollution.js); the time-zone guess is the fallback.
let lpBusy = '';
export async function loadLightPollution(lat, lon) {
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
    } catch (e) { console.info('[sky] light pollution lookup failed:', e.message); state.needRetry = true; setStatus('lp', 'Estimated from the time zone (nearby towns could not be looked up)'); }
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
let fetchAbort = null;
export async function loadLiveData() {
  state.needRetry = false;                          // set again by any lookup that fails
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
      catch (e) { console.info('[sky] land cover fetch failed:', e.message); state.needRetry = true; }
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
      } catch (e) { if (e.name !== 'AbortError') { console.info('[sky] terrain fetch failed:', e.message); state.needRetry = true; } }
    }
    applyLandscape();
  }

  // weather: cached for 15 minutes
  if ((ov.weather ?? conf.weatherMode) === 'live') {
    const cached = lsGet('wx');
    const here = cached && cached.key === key;
    if (here && Date.now() - cached.t < 15 * 60000) {
      state.liveWeather = cached.weather; state.elevation = cached.elevation; state.weatherT = cached.t;
    } else {
      try {
        const r = await fetchLiveWeather(coarse(lat, 0.1), coarse(lon, 0.1), signal);
        state.liveWeather = r.weather; state.elevation = r.elevation; state.weatherT = Date.now();
        lsSet('wx', { key, t: state.weatherT, weather: r.weather, elevation: r.elevation });
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.info('[sky] weather fetch failed:', e.message);
        state.needRetry = true;
        // offline, or the service is down: the last weather we saw for this place beats a clear sky
        if (here) { state.liveWeather = cached.weather; state.elevation = cached.elevation; state.weatherT = cached.t; }
      }
    }
    applyLocation();
    applyWeather();
    applyLandscape();
  }
}
/** Fetch weather, terrain and land cover now (app.js repeats this every 15 minutes through the scheduler). */
export function scheduleLiveData() {
  loadLiveData();
}


// ------------------------------------------------------------ time travel --
export function applySim() {
  const on = document.getElementById('simEnabled')?.checked;
  const input = document.getElementById('simTime');
  if (!engine) return;
  if (!on) { engine.set({ sim: null }); syncTimeData(); applyPlants(); glass?.apply(); return; }
  let base = input?.value ? new Date(input.value) : new Date();
  if (isNaN(base)) base = new Date();
  engine.set({ sim: { base, startPerf: performance.now(), scale: num(conf.simSpeed, 1) } });
  syncTimeData();
  applyPlants();
  glass?.apply();                                         // the automatic clock style follows the date
}

