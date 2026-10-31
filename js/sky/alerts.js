// The two indicators: the sunrise / sunset countdown and the (optional) umbrella / slicker alert. Each is a pill on
// the page, or, on the LED panel, drawn by ledcard.js.

import { conf, use24h, tempUnit } from '../config.js';
import { now, getSim } from '../simtime.js';
import { countdownState } from './sunpath.js';
import { assessRain, fetchRainHours } from './rain.js';
import { engine, state, ov, num, coarse, histActive, cachedFetch } from './core.js';
import { getSunEvents } from './view.js';
import { drawLedCard } from './ledcard.js';

// ------------------------------------------------------------- umbrella alert --
// Off by default. With live weather it reads the hourly forecast for the rest of the day (see rain.js); with a
// manual weather it follows the preset; with time travel it uses the recorded / forecast day.
export const rainState = { a: null, key: '', busy: false, data: null };
const SVG_UMBRELLA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v6.5a2 2 0 0 0 4 0"/></svg>';
const SVG_SLICKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11a9 9 0 0 1 18 0z"/><path d="M12 11v4.5a2 2 0 0 0 4 0"/><path d="M5 15l-1 2.5M9 17l-1 2.5M18 17l-1 2.5M7 21l-.6 1.5"/></svg>';

export function rainText(a) {
  const at = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', ...(use24h() ? { hour12: false, minute: '2-digit' } : { hour12: true }) });
  const what = a.kind === 'snow' ? 'snow' : 'rain';
  const amount = a.totalMm == null ? '' : tempUnit() === 'f' ? ` · ${(a.totalMm / 25.4).toFixed(a.totalMm / 25.4 < 1 ? 2 : 1)} in` : ` · ${a.totalMm < 10 ? a.totalMm.toFixed(1) : Math.round(a.totalMm)} mm`;
  const span = a.from == null ? '' : a.raining ? `, until ${at(a.to)}` : `, ${at(a.from)} to ${at(a.to)}`;
  const lead = a.level === 'slicker' ? (a.kind === 'snow' ? 'Heavy snow: dress for it' : 'Slicker weather') : (a.kind === 'snow' ? 'Snow' : 'Umbrella');
  return `${lead}${a.raining ? `: ${what} now` : a.from != null ? `: ${what}` : ''}${span}${amount}`;
}

export async function updateRain() {
  if (!engine) return;
  const pill = document.getElementById('rainAlertPill'), status = document.getElementById('rainStatus');
  let a = null;
  if (conf.rainAlert) {
    const mode = ov.weather ?? conf.weatherMode;
    if (mode !== 'live') {
      const kind = mode === 'snow' ? 'snow' : 'rain';
      a = mode === 'storm' ? { level: 'slicker', kind, totalMm: null, from: null, to: null, raining: true }
        : (mode === 'rain' || mode === 'snow') ? { level: 'umbrella', kind, totalMm: null, from: null, to: null, raining: true } : { level: 'none' };
    } else {
      const d = now();
      if (histActive()) {
        const day = state.hist?.data;
        a = assessRain(day ? day.hours.map((h, i) => ({ t: Date.parse(day.day + 'T00:00:00Z') + i * 3600e3, mm: h.precipitation, prob: h.precipitation_probability ?? null, snow: h.snowfall })) : [], +d, 0);
      } else {
        const lat0 = num(ov.lat ?? conf.location_latitude, NaN), lon0 = num(ov.lon ?? conf.location_longitude, NaN);
        if (Number.isFinite(lat0) && Number.isFinite(lon0) && !(lat0 === -1 && lon0 === -1)) {
          const lat = coarse(lat0, 0.1), lon = coarse(lon0, 0.1), key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
          if (!rainState.busy) {                                  // cachedFetch returns the saved forecast until it is 30 min old, then asks again
            rainState.busy = true;
            try { rainState.data = await cachedFetch(`rain:${key}`, 30 * 60000, () => fetchRainHours(lat, lon)); rainState.key = key; }
            catch (e) { console.info('[sky] rain forecast failed:', e.message); if (rainState.key !== key) rainState.data = null; }
            rainState.busy = false;
          }
          if (rainState.data) a = assessRain(rainState.data.hours, +d, rainState.data.offset);
        }
      }
    }
  }
  rainState.a = a;
  const show = !!a && a.level !== 'none';
  if (pill) {
    pill.hidden = !show;
    if (show) {
      pill.dataset.level = a.level;
      const html = (a.level === 'slicker' ? SVG_SLICKER : SVG_UMBRELLA) + `<span>${rainText(a)}</span>`;
      if (pill.dataset.html !== html) { pill.dataset.html = html; pill.innerHTML = html; }
    }
  }
  if (status) status.textContent = !conf.rainAlert ? '' : !a ? 'Waiting for the forecast…' : show ? rainText(a) : 'No rain worth an umbrella before 11 pm.';
  if (conf.screenMode === 'led') updateCountdown();                          // the LED panel draws the umbrella itself
}

let showing = false;
/** How often the countdown needs looking at: every half second while it is on screen (or time is running fast), rarely otherwise. */
export function countdownPeriod() {
  if (!conf.countdown || conf.countdown === 'off') return Infinity;
  return showing || (getSim()?.scale || 0) > 1 ? 500 : 15000;
}

export function updateCountdown() {
  const el = document.getElementById('sunCountdown');
  if (!el || !engine) return;
  const mode = conf.countdown, led = conf.screenMode === 'led';
  if (!mode || mode === 'off') { showing = false; el.hidden = true; if (led) drawLedCard(null, 0, false, rainState.a); return; }
  const d = now();
  const lead = num(conf.countdownLead, 20);
  const st = countdownState(getSunEvents(d).ev, +d, mode, lead);
  showing = !!st;
  if (led) { el.hidden = true; drawLedCard(st, lead * 60000, false, rainState.a); return; }
  drawLedCard(null, 0, true);
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

