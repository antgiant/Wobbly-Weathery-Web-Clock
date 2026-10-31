// Presets: one tap sets up the clock for a purpose. A preset is just a set of settings (conf keys). Applying one sets
// each setting's control and fires its event, so it goes through exactly the code a person changing that control would,
// and the other tabs stay in step.

import { conf, DEFAULTS, use24h } from '../config.js';
import { toast } from './core.js';

/** The settings that "Standard" sets and that a reset restores. Location, first-run choice and panel state are never touched. */
export const APPEARANCE_KEYS = ['clockStyle', 'glassFrost', 'glassGlow', 'glassGlowColor', 'legibility', 'clockColor', 'hideSeconds',
  'quality', 'cloudMotion', 'plants', 'holidayTree', 'showLabels', 'countdown', 'countdownLead', 'screenMode', 'ledCols', 'ledRows', 'ledTurn', 'rainAlert',
  'nightDim', 'nightDimLevel', 'followSun', 'viewMode', 'keepAwake', 'weatherMode', 'landscape'];

const standard = Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, DEFAULTS[k]]));

export const PRESETS = [
  { id: 'standard', name: 'Standard', note: 'The default look: liquid glass, a live sky, following the sun.', patch: standard },
  { id: 'bedside', name: 'Bedside', note: 'Calm and dim at night: no seconds, soft glow, slow clouds, screen stays on.',
    patch: { ...standard, hideSeconds: true, clockStyle: 'glass', glassFrost: 0.55, glassGlow: 0.35, cloudMotion: 0.25, quality: 'medium', nightDim: 'auto', nightDimLevel: 0.75, keepAwake: true } },
  { id: 'sunwatch', name: 'Sunset watcher', note: 'Countdowns to sunrise and sunset, and labels on the sun, moon and planets.',
    patch: { ...standard, countdown: 'both', countdownLead: 20, showLabels: true, glassGlow: 0.2 } },
  { id: 'led', name: 'LED panel', note: '64 × 32 LED matrix with the countdown in pixels. Light on the battery.',
    patch: { ...standard, screenMode: 'led', countdown: 'both', quality: 'low', cloudMotion: 0.25, nightDim: 'auto', nightDimLevel: 0.5 } },
  { id: 'weather', name: 'Weather watch', note: 'Umbrella alert and sunrise / sunset countdowns.',
    patch: { ...standard, rainAlert: true, countdown: 'both', countdownLead: 20 } },
  { id: 'showcase', name: 'Showcase', note: 'Everything turned up: high quality, glowing glass, moving clouds.',
    patch: { ...standard, quality: 'high', clockStyle: 'glass', glassFrost: 0.25, glassGlow: 0.45, cloudMotion: 1 } },
  { id: 'saver', name: 'Battery saver', note: 'Still sky, flat ink, no plants, dimmed at night, screen not forced on.',
    patch: { ...standard, quality: 'low', cloudMotion: 0, plants: false, clockStyle: 'solid', glassGlow: 0, keepAwake: false, nightDim: 'auto', nightDimLevel: 0.7 } },
];

const same = (a, b) => (typeof a === 'number' || typeof b === 'number' ? Math.abs(Number(a) - Number(b)) < 1e-9 : a === b);

/** True when every setting of the preset has its value (so the card can show as the one in use). */
export function matches(patch, current = conf) {
  return Object.entries(patch).every(([k, v]) => same(current[k], v));
}

/** Set settings through their controls (so every handler runs). Settings with no control are just saved. */
export function applyConfPatch(patch) {
  for (const [key, value] of Object.entries(patch)) {
    const el = document.getElementById(key);
    if (!el) { conf[key] = value; continue; }
    if (el.type === 'checkbox') {
      el.checked = !!value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.type === 'range') {
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      el.value = String(value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

function resetAll() {
  if (!confirm('Put every setting back to how it was the first time? Your location is kept.')) return;
  applyConfPatch(standard);
  // the other settings that have defaults: units follow the region again, 24-hour time follows the browser
  conf.tempUnit = DEFAULTS.tempUnit;
  const t = document.getElementById('tempUnit'); if (t) { t.value = 'auto'; t.dispatchEvent(new Event('change', { bubbles: true })); }
  conf.twentyFourHourClock = null;
  const h = document.getElementById('twentyFourHourClock'); if (h) h.checked = use24h();
  for (const [id, v] of [['clockStyle', 'auto'], ['legibility', 'auto'], ['bodySize', DEFAULTS.bodySize], ['nightBrightness', DEFAULTS.nightBrightness], ['lightPollution', 'auto']]) {
    const el = document.getElementById(id); if (!el) continue;
    el.value = String(v); el.dispatchEvent(new Event(el.type === 'range' ? 'input' : 'change', { bubbles: true }));
  }
  toast('All settings reset');
  render();
}

let list = null;
function render() {
  if (!list) return;
  list.querySelectorAll('.preset').forEach((b) => {
    const p = PRESETS.find((x) => x.id === b.dataset.preset);
    b.setAttribute('aria-pressed', String(!!p && matches(p.patch)));
  });
}

export function initPresets() {
  list = document.getElementById('presetList');
  if (!list) return;
  list.innerHTML = PRESETS.map((p) => `<button type="button" class="preset" data-preset="${p.id}" aria-pressed="false"><strong>${p.name}</strong><small>${p.note}</small></button>`).join('');
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.preset');
    if (!b) return;
    const p = PRESETS.find((x) => x.id === b.dataset.preset);
    applyConfPatch(p.patch);
    toast(`${p.name} applied`);
    render();
  });
  document.getElementById('resetAll')?.addEventListener('click', resetAll);
  render();
  // the card of the preset in use follows changes made anywhere in the panel
  document.getElementById('settingsModal')?.addEventListener('change', () => setTimeout(render, 0));
  document.getElementById('settingsModal')?.addEventListener('input', () => setTimeout(render, 0));
}
