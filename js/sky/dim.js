// Brightness: a day level and a night level, with sunset and sunrise as the transition. A black veil over the whole page
// (on OLED screens black pixels are off, so it also saves power) takes away the difference: 100% is no veil. The level eases
// from the day brightness to the night brightness around sunset, and back around sunrise, over `brightnessTransition` minutes
// centred on the event (45 by default), on a smooth curve so nothing steps. Where the sun never sets or never rises there is no
// event to centre on, so the sun's height decides (night once it is 10 degrees down, day above 3 degrees down).
// The native version (see TODO.md) drives its panel brightness with the same numbers.

import { conf } from '../config.js';
import { now } from '../simtime.js';
import { engine } from './core.js';
import { getSunEvents } from './view.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/**
 * How much of the night level applies, 0 (full day level) .. 1 (full night level).
 * @param {number} t      now, epoch ms
 * @param {object} ev     {prevRise, prevSet, nextRise, nextSet} (Dates or null), as sunEvents() gives them
 * @param {number} alt    the sun's height now, degrees (used only when there are no events)
 * @param {number} minutes  width of the transition, centred on each sunset and sunrise
 */
export function nightness(t, ev, alt, minutes = 45) {
  const half = Math.max(1, minutes) * 30000;                              // half the transition, ms
  const ms = (d) => (d ? +d : NaN);
  const prevRise = ms(ev?.prevRise), prevSet = ms(ev?.prevSet), nextRise = ms(ev?.nextRise), nextSet = ms(ev?.nextSet);
  const evening = (s) => smooth(0, 1, (t - (s - half)) / (2 * half));      // 0 before the sunset's transition, 1 after it
  const morning = (r) => smooth(0, 1, (t - (r - half)) / (2 * half));      // 0 before the sunrise's transition, 1 after it (the day weight)
  const haveAny = [prevRise, prevSet, nextRise, nextSet].some(Number.isFinite);
  if (!haveAny) return Number.isFinite(alt) ? 1 - smooth(-10, -3, alt) : 0;   // polar day / night: the sun's height decides
  const lastWasSet = Number.isFinite(prevSet) && (!Number.isFinite(prevRise) || prevSet > prevRise);
  if (lastWasSet) {                                                         // it is night (or the sunset's transition is still running)
    const e = evening(prevSet);
    const m = Number.isFinite(nextRise) ? morning(nextRise) : 0;
    return clamp(Math.min(e, 1 - m), 0, 1);
  }
  const m = Number.isFinite(prevRise) ? 1 - morning(prevRise) : 0;          // the sunrise's transition may still be running
  const e = Number.isFinite(nextSet) ? evening(nextSet) : 0;
  return clamp(Math.max(m, e), 0, 1);
}

/** The brightness now, 0.1 .. 1: the day level, the night level, or between. */
export function brightnessAt(t, ev, alt, day, night, minutes) {
  const lvl = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? 1 : clamp(Number(x), 0.1, 1));      // missing or junk: no veil; below 10%: 10%
  const d = lvl(day), n = lvl(night);
  return d + (n - d) * nightness(t, ev, alt, minutes);
}

/** True when the settings can ever darken the screen. */
export const dimmingOn = (c = conf) => ['brightnessDay', 'brightnessNight'].some((k) => c[k] != null && c[k] !== '' && Number.isFinite(Number(c[k])) && Number(c[k]) < 0.995);

export function updateDim() {
  const el = document.getElementById('dimmer');
  if (!el) return;
  const d = now();
  let level = 1;
  if (dimmingOn()) level = brightnessAt(+d, getSunEvents(d).ev, engine?.sky?.sun?.alt, conf.brightnessDay, conf.brightnessNight, Number(conf.brightnessTransition) || 45);
  const a = 1 - level;
  el.style.opacity = a.toFixed(3);
  el.hidden = a < 0.005 && !el.dataset.fading;
}

export function initDim() {
  const el = document.getElementById('dimmer');
  if (el) el.addEventListener('transitionend', () => { if (parseFloat(el.style.opacity) < 0.005) el.hidden = true; });
  updateDim();
}
