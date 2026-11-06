// Glue between the settings (conf), the sky engine and the page: creates the engine, wires everything up, and
// registers the page's periodic jobs with the one shared scheduler. The work itself is in the sibling modules:
//   core.js        shared state and helpers          view.js        camera, follow-the-sun, labels, return button
//   data.js        location, weather, plants, tree   appearance.js  loading screen, fallback, ink colour, favicon
//   alerts.js      countdown and umbrella            ledcard.js     the LED panel's overlay
//   bindings.js    settings controls                 presets.js     presets, reset to defaults
//   dim.js         night dimming                     scheduler.js   the single timer

import { conf, clockStyleNow, lowPower, vars, cap, adjustTimeSize } from '../config.js';
import { getSim } from '../simtime.js';
import { SkyEngine } from './engine.js';
import { RUNG_OF } from './capability.js';
import { applyLadderUi } from './ladderui.js';
import { Controls } from './controls.js';
import { initGlass } from './glass.js';
import { canvas, engine, controls, setEngine, setControls, setGlass, ov, num, toast, state } from './core.js';
import { applyQuality, applyLocation, applyWeather, applyLandscape, applyPlants, applyTree, syncTimeData, scheduleLiveData, loadLiveData, dayLoad } from './data.js';
import { applyView, atDefault, followActive, updateHud, updateVrReadout, updateHomeButton, returnToDefaultView } from './view.js';
import { markReady, startFallback, updateClockColor, updateFavicon } from './appearance.js';
import { updateCountdown, updateRain, countdownPeriod } from './alerts.js';
import { bindSettings } from './bindings.js';
import { initDim, updateDim, dimmingOn } from './dim.js';
import { initPresets } from './presets.js';
import { updateBurnIn, burnInPeriod, toNextMinute } from './burnin.js';
import { updateWind, windPeriod } from './windsway.js';
import { initPillRoom } from './pillroom.js';
import { initShare } from './sharebox.js';
import { every } from './scheduler.js';

const simActive = () => !!getSim();
const simFast = () => (getSim()?.scale || 1) > 1;

function init() {
  performance.mark('app:init');
  try {
    {
      const qs = new URLSearchParams(location.search), n = (k, d) => (Number.isFinite(parseFloat(qs.get(k))) ? parseFloat(qs.get(k)) : d);
      // The capability ladder (js/sky/capability.js) is on by default and holds the clock right whatever the device: the 'adapt' setting can turn it off or hold it at a step. The address outranks
      // the setting: ?gov=0 off, ?gov=1 on (also for automation: a browser driven by a test (navigator.webdriver) runs without it unless ?gov=1, so the tests see everything they ask for);
      // ?minfps (15) and ?maxfps (60) bound the frames (a browser starts at the top resolution and steps down if it must; the Raspberry Pi program starts in the middle and climbs), ?level= starts the resolution somewhere, ?rung= on a rung, ?pin holds both, ?detail=sharp|smooth (a display keeps its size and
      // draws the sky smaller; the whole picture may shrink on a small panel)
      const adapt = conf.adapt || 'auto', gv = qs.get('gov'), hold = adapt in RUNG_OF;
      const on = gv !== null ? gv !== '0' : adapt !== 'off' && !navigator.webdriver;
      const profile = qs.get('detail') === 'sharp' ? 'sharp' : qs.get('detail') === 'smooth' ? 'smooth' : conf.detail === 'smooth' ? 'smooth' : 'sharp';
      setEngine(new SkyEngine(canvas, { baseUrl: '.', lutScale: n('lut', 1), es2: qs.has('es2'), governor: on ? { floorFps: n('minfps', 15), ceilFps: n('maxfps', 60), level: qs.has('level') ? n('level', 5) : typeof window.__present === 'function' ? undefined : 99, pin: qs.has('pin') || (hold && gv === null), rung: qs.has('rung') ? n('rung', 0) : hold && gv === null ? RUNG_OF[adapt] : 0, profile } : false }));
    }
  } catch (e) {
    startFallback(e.message);
    return;
  }
  performance.mark('sky:engine-created');
  { const d = parseFloat(new URLSearchParams(location.search).get('dpr')); if (d > 0) engine.set({ forceDpr: Math.min(d, 6) }); }     // ?dpr=3: draw at more than twice the screen's pixels (to see what a bigger screen would cost)
  engine.noScissor = new URLSearchParams(location.search).has('noscissor');          // (to compare the pictures with and without limiting the glass passes to the digits)
  engine.autoProbe = typeof window.__present !== 'function';          // a browser reads one pixel back now and then to learn what a frame truly costs (the Raspberry Pi program measures its own)
  engine.onTick = (ms) => { vars.tick = engine.autoProbe ? Math.max(ms, 1000 / conf.steps) : ms; if (engine.gov) cap.lead = engine.gov.leadMs; };           // the clock ticks as fast as the governor says the frames allow (a browser: never faster than its own steps setting)
  engine.onKnobs = (k) => {                                  // the capability ladder moved (or was taken away): what the hardware can handle outranks the settings
    const ps = document.getElementById('perfStatus'), held = (conf.adapt || 'auto') !== 'auto' && (conf.adapt in RUNG_OF);
    const was = { s: cap.seconds, c: cap.cadence, w: cap.weather, a: cap.ambient };
    if (!k) {                                                // no ladder: everything the settings say
      cap.seconds = 'morph'; cap.cadence = 'live'; cap.ahead = false; cap.weather = true; cap.ambient = true; cap.lead = 0; vars.tick = 0;
      if (ps) ps.textContent = 'Adapting is off: everything you chose is drawn, even if this device cannot keep up.';
    } else {
      if (ps) ps.textContent = k.rung > 0 ? 'Right now: ' + engine.gov.name + ' (' + engine.gov.why + (held ? '; held by Adapt to this device' : '') + '). The clock must show the right time, so what is given up cannot be switched back on below.' : 'Right now: everything this device can show.';
      cap.seconds = k.seconds; cap.cadence = k.cadence; cap.ahead = !!k.ahead; cap.weather = k.weather; cap.ambient = k.ambient; cap.lead = engine.gov ? engine.gov.leadMs : 0;
    }
    applyLadderUi(k, held);
    if (was.a !== cap.ambient) updateWind();
    if (was.s !== cap.seconds || was.c !== cap.cadence) { adjustTimeSize(); window.dispatchEvent(new Event('capchange')); window.dispatchEvent(new Event('clocklayout')); }
  };
  engine.onKnobs(engine.gov ? engine.knobs : null);               // (says where it stands from the start)
  window.__sky = engine;                         // handy for debugging / tests
  {                                                            // ?stats: frames a second and the picture's size, tap to copy (?stats=0 turns it off; once asked for, it comes back on this device's next visits)
    let want = false;
    let mode = ''; try { const v = new URLSearchParams(location.search).get('stats'); if (v === '0') localStorage.removeItem('stats'); else if (v !== null) localStorage.setItem('stats', v || '1'); mode = localStorage.getItem('stats') || ''; want = !!mode; } catch (_) { mode = new URLSearchParams(location.search).get('stats'); want = mode !== null; }
    if (want) {
      const note = document.createElement('div');                // (shown at once, so a missing read-out says whether this code ran at all)
      note.style.cssText = 'position:fixed;left:6px;top:6px;z-index:99999;padding:4px 8px;border-radius:6px;background:rgba(0,0,0,.7);color:#9f9;font:11px ui-monospace,Menlo,monospace';
      note.textContent = 'stats: loading...'; document.body.appendChild(note);
      import('./stats.js').then((m) => { note.remove(); m.initStats(engine, canvas, mode); }).catch((e) => { note.style.color = '#f99'; note.textContent = 'stats failed: ' + (e && e.message || e); });
    }
  }
  setControls(new Controls(engine, { onToast: toast, onChange: () => { glassRef?.updateLight(); }, onUserMove: () => updateHomeButton(), onReset: () => returnToDefaultView() }));
  window.__controls = controls;
  const glassRef = initGlass(engine, () => engine._basis());
  setGlass(glassRef);

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
  let simBase = null;
  if (q.has('t')) {
    const base = new Date(q.get('t'));
    if (!isNaN(base)) { simBase = base; engine.set({ sim: { base, startPerf: performance.now(), scale: num(q.get('speed'), 0) } }); }
  }

  // The first frame needs only the sky itself. Wiring the settings panel, presets and the rest waits until that frame
  // is on screen, so none of it delays it.
  applyQuality(); applyLocation(); applyView(); applyWeather(); applyLandscape();
  engine.start();
  engine.onFrame(() => { window.__frames = (window.__frames || 0) + 1; });
  scheduleLiveData();
  if (simBase) { syncTimeData(); glassRef.apply(); }          // the clock style (and the season) follow the date being shown

  const finishSetup = () => {
    const { simEn, simTime, toLocalInput } = bindSettings();
    initPresets();
    initDim();
    initPillRoom();
    initShare();
    if (simBase) { simEn.checked = true; simTime.value = toLocalInput(simBase); }
    performance.mark('app:setup-done');
  };
  let setUp = false;
  const once = () => { if (setUp) return; setUp = true; setTimeout(finishSetup, 0); };
  engine.onFrame(once);
  setTimeout(once, 1500);                                  // even if no frame comes (hidden tab), do it

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
  window.addEventListener('powerchange', () => { engine.set({ lowPower: lowPower() }); glassRef.apply(); });       // the battery ran low (or was plugged in): the automatic clock style follows
  window.addEventListener('offline', () => applyWeather());               // the status line says "offline"
  every('timedata', syncTimeData, () => (simActive() ? 4000 : 60000));     // history and seasons follow the (simulated) date
  every('tree', applyTree, () => (simActive() ? 4000 : 60000));            // Thanksgiving arrives, or time travel moves the date
  every('follow', applyView, () => (followActive() ? (simFast() ? 1000 : 15000) : Infinity));   // the sun moves 15 degrees an hour
  every('ink', updateClockColor, () => ((clockStyleNow() === 'solid' || conf.screenMode === 'led') && conf.clockColor === 'auto' ? 3000 : 30000), 1200);
  every('favicon', updateFavicon, 60000, 1200);
  every('hud', () => { updateHud(); updateVrReadout(); }, () => (conf.showLabels || controls?.mode === 'look' || conf.vrDebug ? 250 : Infinity));
  every('countdown', updateCountdown, countdownPeriod, 600);                  // first look soon after start: a countdown may already be running
  every('rain', updateRain, () => (conf.rainAlert ? 60000 : Infinity), 2500);
  every('wind', updateWind, windPeriod, 700);                                 // the digits lean in the wind (when switched on)
  every('burnin', updateBurnIn, burnInPeriod, toNextMinute());                // anti burn-in: a tiny step once a minute while the screen is kept on
  every('dim', updateDim, () => (dimmingOn() ? (simFast() ? 1000 : 20000) : (document.getElementById('dimmer')?.hidden === false ? 2000 : Infinity)), 500);
  window.addEventListener('resize', () => { if (atDefault()) applyView(); });
  void applyPlants;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
