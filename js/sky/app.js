// Glue between the settings (conf), the sky engine and the page: creates the engine, wires everything up, and
// registers the page's periodic jobs with the one shared scheduler. The work itself is in the sibling modules:
//   core.js        shared state and helpers          view.js        camera, follow-the-sun, labels, return button
//   data.js        location, weather, plants, tree   appearance.js  loading screen, fallback, ink colour, favicon
//   alerts.js      countdown and umbrella            ledcard.js     the LED panel's overlay
//   bindings.js    settings controls                 presets.js     presets, reset to defaults
//   dim.js         night dimming                     scheduler.js   the single timer

import { conf, clockStyleNow } from '../config.js';
import { getSim } from '../simtime.js';
import { SkyEngine } from './engine.js';
import { Controls } from './controls.js';
import { initGlass } from './glass.js';
import { canvas, engine, controls, setEngine, setControls, setGlass, ov, num, toast, state } from './core.js';
import { applyQuality, applyLocation, applyWeather, applyLandscape, applyPlants, applyTree, syncTimeData, scheduleLiveData, loadLiveData, dayLoad } from './data.js';
import { applyView, atDefault, followActive, updateHud, updateVrReadout, updateHomeButton, returnToDefaultView } from './view.js';
import { markReady, startFallback, updateClockColor, updateFavicon } from './appearance.js';
import { updateCountdown, updateRain, countdownPeriod } from './alerts.js';
import { bindSettings } from './bindings.js';
import { initDim, updateDim } from './dim.js';
import { initPresets } from './presets.js';
import { every } from './scheduler.js';

const simActive = () => !!getSim();
const simFast = () => (getSim()?.scale || 1) > 1;

function init() {
  try {
    setEngine(new SkyEngine(canvas, { baseUrl: '.' }));
  } catch (e) {
    startFallback(e.message);
    return;
  }
  window.__sky = engine;                         // handy for debugging / tests
  setControls(new Controls(engine, { onToast: toast, onChange: () => { glassRef?.updateLight(); }, onUserMove: () => updateHomeButton(), onReset: () => returnToDefaultView() }));
  window.__controls = controls;
  const glassRef = initGlass(engine, () => engine._basis());
  setGlass(glassRef);

  applyQuality(); applyLocation(); applyView(); applyWeather(); applyLandscape();
  engine.start();
  engine.onFrame(() => { window.__frames = (window.__frames || 0) + 1; });

  const { simEn, simTime, toLocalInput } = bindSettings();
  initPresets();
  initDim();

  // dev / test deep links (not persisted):
  //   ?t=2026-06-21T20:30:00Z&speed=60&az=280&pitch=10&weather=storm&landscape=ocean&lat=40.7&lon=-74
  const q = new URLSearchParams(location.search);
  if (q.has('weather')) ov.weather = q.get('weather');
  if (q.has('landscape')) ov.landscape = q.get('landscape');
  if (q.has('az')) ov.az = num(q.get('az'), 180);
  if (q.has('pitch')) ov.pitch = num(q.get('pitch'), 12);
  if (q.has('lp')) ov.lp = q.get('lp');
  if (q.has('biome')) ov.biome = q.get('biome');
  if (q.has('xmas')) ov.xmas = q.get('xmas');            // 1 / 0: force the Christmas tree on / off
  if (q.has('waves')) ov.waves = q.get('waves');
  if (q.has('lat') && q.has('lon')) { ov.lat = num(q.get('lat'), 40); ov.lon = num(q.get('lon'), -74); }
  if (q.has('t')) {
    const base = new Date(q.get('t'));
    if (!isNaN(base)) { simEn.checked = true; simTime.value = toLocalInput(base); engine.set({ sim: { base, startPerf: performance.now(), scale: num(q.get('speed'), 0) } }); syncTimeData(); }
  }
  if (Object.keys(ov).length) { applyQuality(); applyLocation(); applyView(); applyWeather(); applyLandscape(); }
  scheduleLiveData();

  // ---- the page's periodic work: one scheduler, and a period of Infinity while a job has nothing to do ----
  const t0 = performance.now();
  let ready = false;
  every('ready', () => {                                                   // the loading screen goes when there is a real picture
    const solid = clockStyleNow() === 'solid' && conf.screenMode !== 'led';
    if ((window.__frames >= 1 && engine.assetsDone && (solid || engine.glass.hasMask)) || performance.now() - t0 > 8000) { ready = true; markReady(); }
  }, () => (ready ? Infinity : 80));
  every('live', loadLiveData, 15 * 60000);                                 // weather, terrain, land cover
  every('live-retry', loadLiveData, () => (state.needRetry && navigator.onLine !== false ? 60000 : Infinity));   // a lookup failed: try again soon
  // the connection came back: bring in everything that could not be fetched, at once
  window.addEventListener('online', () => { dayLoad.key = ''; scheduleLiveData(); syncTimeData(); updateRain(); });
  window.addEventListener('offline', () => applyWeather());               // the status line says "offline"
  every('timedata', syncTimeData, () => (simActive() ? 4000 : 60000));     // history and seasons follow the (simulated) date
  every('tree', applyTree, () => (simActive() ? 4000 : 60000));            // Thanksgiving arrives, or time travel moves the date
  every('follow', applyView, () => (followActive() ? (simFast() ? 1000 : 15000) : Infinity));   // the sun moves 15 degrees an hour
  every('ink', updateClockColor, () => ((clockStyleNow() === 'solid' || conf.screenMode === 'led') && conf.clockColor === 'auto' ? 3000 : 30000), 1200);
  every('favicon', updateFavicon, 60000, 1200);
  every('hud', () => { updateHud(); updateVrReadout(); }, () => (conf.showLabels || controls?.mode === 'look' || conf.vrDebug ? 250 : Infinity));
  every('countdown', updateCountdown, countdownPeriod);
  every('rain', updateRain, () => (conf.rainAlert ? 60000 : Infinity), 2500);
  every('dim', updateDim, () => (conf.nightDim && conf.nightDim !== 'off' ? (simFast() ? 1000 : 20000) : Infinity), 500);
  window.addEventListener('resize', () => { if (atDefault()) applyView(); });
  void applyPlants;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
