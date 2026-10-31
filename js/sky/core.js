// Shared state and small helpers for the sky modules (app, view, data, appearance, alerts, ledcard, bindings).
// `engine`, `controls` and `glass` are live bindings: they are created once by app.js (setEngine / setControls /
// setGlass) and every module that imports them sees the current value.

import { conf } from '../config.js';
import { getSim, now } from '../simtime.js';

export const canvas = document.getElementById('sky');
export let engine = null;
export let controls = null;
export let glass = null;
export const setEngine = (e) => { engine = e; };
export const setControls = (c) => { controls = c; };
export const setGlass = (g) => { glass = g; };

const statusEls = {
  terrain: document.getElementById('terrainStatus'),
  weather: document.getElementById('weatherStatus'),
  sky: document.getElementById('skyStatus'),
  lp: document.getElementById('lpStatus'),
};
export const setStatus = (k, t) => { if (statusEls[k]) { if (k === 'terrain' && !t.includes('Land cover') && !t.includes('Sea:')) statusEls[k].dataset.base = t; statusEls[k].textContent = t; } };

export const state = { needRetry: false, weatherT: 0, seaText: '', liveWeather: null, elevation: null, dem: null, lpBortle: 3, lpLocal: null, biome: null };
export const ov = {};                      // deep-link overrides (never written to localStorage)
export const DEG = Math.PI / 180;
export const num = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
// unknown time zone (e.g. plain "UTC"): guess a longitude from the UTC offset, 15 degrees per hour
export const DEFAULT_LAT = 40;
export const defaultLon = () => Math.max(-180, Math.min(180, -new Date().getTimezoneOffset() / 4));
export const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } };

// Weather and terrain services get a rounded position (about 11 km for weather, 5 km for terrain), never the exact
// one, unless the user turned that off. Everything that is drawn still uses the exact position, locally.
export const coarse = (v, step) => (conf.coarseLookups === false ? v : Math.round(v / step) * step);
export const ymd = (d) => d.toISOString().slice(0, 10);
// time travel far from now: the weather should be what it was (or will be) then
export const histActive = () => !!getSim() && Math.abs(+now() - Date.now()) > 2 * 3600e3;

/**
 * A fetched value cached on the device for `ttlMs`. When the fetch fails (offline, or the service is down) the last
 * saved value, however old, is used instead of nothing, and `state.needRetry` asks for another try soon.
 */
export async function cachedFetch(key, ttlMs, fetcher) {
  const c = lsGet(key);
  if (c && Date.now() - c.t < ttlMs) return c.v;
  try {
    const v = await fetcher();
    lsSet(key, { t: Date.now(), v });
    return v;
  } catch (e) {
    state.needRetry = true;
    if (c) return c.v;
    throw e;
  }
}

/** "5 min", "3 h", "2 days": how long ago, for status lines. */
export function agoText(ms) {
  const m = Math.round(ms / 60000);
  return m < 90 ? `${Math.max(1, m)} min` : m < 36 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
}

// -------------------------------------------------------------- toast ----
const toastEl = document.getElementById('toast');
let toastTimer = 0;
export function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4000);
}

