// Connects the settings panel's controls to the sky: each control shows its saved value and, when changed,
// saves it and applies it. (Presets reuse this: they set the controls and fire their events, see presets.js.)

import { conf } from '../config.js';
import { now } from '../simtime.js';
import { engine, controls, glass } from './core.js';
import { applyQuality, applyLandscape, applyWeather, applyPlants, applyTree, applyLocation, applySim, syncTimeData, scheduleLiveData, dayLoad } from './data.js';
import { applyView, atDefault, updateHud, updateVrReadout, applySensorFixes, setViewMode, setBaseMode, returnToDefaultView, updateHomeButton } from './view.js';
import { updateClockColor } from './appearance.js';
import { updateCountdown, updateRain } from './alerts.js';
import { updateDim } from './dim.js';
import { applyLedPanel } from './ledpanel.js';
import { LED_PRESETS, MIN_LEDS, MAX_LEDS, presetIdFor } from './ledgrid.js';

/** @returns {{simEn: HTMLInputElement, simTime: HTMLInputElement, toLocalInput: (d: Date) => string}} handles the deep links need */
export function bindSettings() {
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
  bindSelect('nightDim', 'nightDim', updateDim);
  bindRange('nightDimLevel', 'nightDimLevel', updateDim, 'nightDimLevelOut');
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
  bindSelect('tempUnit', 'tempUnit', () => { applyWeather(); updateRain(); });
  $('rainAlert').checked = !!conf.rainAlert;
  $('rainAlert').addEventListener('change', (e) => { conf.rainAlert = e.target.checked; updateRain(); });
  $('holidayTree').checked = conf.holidayTree !== false;
  $('holidayTree').addEventListener('change', (e) => { conf.holidayTree = e.target.checked; applyTree(); });
  $('coarseLookups').checked = conf.coarseLookups !== false;
  $('coarseLookups').addEventListener('change', (e) => { conf.coarseLookups = e.target.checked; dayLoad.key = ''; scheduleLiveData(); syncTimeData(); });
  bindSelect('legibility', 'legibility', () => { glass.apply(); updateClockColor(); });
  bindSelect('screenMode', 'screenMode', () => { glass.apply(); updateClockColor(); updateCountdown(); engine.dirty = true; });
  // LED panel size: a preset shortcut and the two counts
  const ledSel = $('ledPreset');
  ledSel.innerHTML = LED_PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('') + '<option value="custom">Custom</option>';
  const syncLed = () => { ledSel.value = presetIdFor(conf.ledCols, conf.ledRows); $('ledCols').value = conf.ledCols; $('ledRows').value = conf.ledRows; };
  syncLed();
  ledSel.addEventListener('change', () => {
    const p = LED_PRESETS.find((x) => x.id === ledSel.value);
    if (p) { conf.ledCols = p.cols; conf.ledRows = p.rows; syncLed(); applyLedPanel(); }
  });
  for (const [id, key] of [['ledCols', 'ledCols'], ['ledRows', 'ledRows']]) {
    $(id).addEventListener('change', () => {
      const n = Math.round(Number($(id).value));
      conf[key] = Number.isFinite(n) ? Math.min(MAX_LEDS, Math.max(MIN_LEDS, n)) : conf[key];
      syncLed(); applyLedPanel(); updateCountdown();
    });
  }
  $('ledTurn').checked = conf.ledTurn !== false;
  $('ledTurn').addEventListener('change', (e) => { conf.ledTurn = e.target.checked; applyLedPanel(); updateCountdown(); });
  bindSelect('countdown', 'countdown', updateCountdown);
  bindSelect('countdownKind', 'countdownKind', updateCountdown);
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
  setBaseMode(conf.viewMode);
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
  return { simEn, simTime, toLocalInput };
}
