// Night dimming: a black veil over the whole page that comes in as the sun goes down and lifts at dawn, for a bedside
// clock that does not light the room. On OLED screens black pixels are off, so the veil also saves power.
//   Off       never
//   Dim at night   fades in between civil twilight (sun 3 degrees down) and night (10 degrees down), out again at dawn
//   Always dim     all the time (a dark room by day)
// "How dark" is how much of the light is taken away at full dimming.

import { conf } from '../config.js';
import { engine } from './core.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** 0 (no dimming) .. 1 (full), for the current sky. */
export function dimAmount(mode, sunAlt) {
  if (mode === 'on') return 1;
  if (mode !== 'auto' || !Number.isFinite(sunAlt)) return 0;
  return 1 - smooth(-10, -3, sunAlt);              // 0 in daylight and twilight, 1 once the sun is 10 degrees down
}

export function updateDim() {
  const el = document.getElementById('dimmer');
  if (!el) return;
  const level = Math.min(0.92, Math.max(0.1, Number(conf.nightDimLevel) || 0.6));
  const a = dimAmount(conf.nightDim, engine?.sky?.sun?.alt) * level;
  el.style.opacity = a.toFixed(3);
  el.hidden = a < 0.005 && !el.dataset.fading;
}

export function initDim() {
  const el = document.getElementById('dimmer');
  if (el) el.addEventListener('transitionend', () => { if (parseFloat(el.style.opacity) < 0.005) el.hidden = true; });
  updateDim();
}
