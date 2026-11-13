// The two indicators: the sunrise / sunset countdown and the (optional) umbrella / slicker alert. Each is a pill on
// the page, or, on the LED panel, drawn by ledcard.js.

import { conf, use24h, tempUnit } from '../config.js';
import { now, getSim } from '../simtime.js';
import { zoneOptions } from '../timezone.js';
import { countdownState } from './sunpath.js';
import { assessRain, fetchRainHours } from './rain.js';
import { choose, pillText, fetchAlerts, inAlertArea, SEV_ICON } from './severe.js';
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
  const at = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', ...zoneOptions(), ...(use24h() ? { hour12: false, minute: '2-digit' } : { hour12: true }) });
  const what = a.what || (a.kind === 'snow' ? 'snow' : 'rain');           // (`what` names the odd kinds: sleet, freezing rain, hail)
  const amount = a.totalMm == null ? '' : tempUnit() === 'f' ? ` · ${(a.totalMm / 25.4).toFixed(a.totalMm / 25.4 < 1 ? 2 : 1)} in` : ` · ${a.totalMm < 10 ? a.totalMm.toFixed(1) : Math.round(a.totalMm)} mm`;
  const span = a.from == null ? '' : a.raining ? `, until ${at(a.to)}` : `, ${at(a.from)} to ${at(a.to)}`;
  const lead = a.what === 'freezing rain' ? 'Ice: stay in if you can' : a.what === 'hail' ? 'Hail: take cover' : a.what === 'sleet' ? 'Sleet: umbrella and boots'
    : a.level === 'slicker' ? (a.kind === 'snow' ? 'Heavy snow: dress for it' : 'Slicker weather') : (a.kind === 'snow' ? 'Snow' : 'Umbrella');
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
        : mode === 'freezing' ? { level: 'slicker', kind, what: 'freezing rain', totalMm: null, from: null, to: null, raining: true }
        : mode === 'hail' ? { level: 'slicker', kind, what: 'hail', totalMm: null, from: null, to: null, raining: true }
        : mode === 'sleet' ? { level: 'umbrella', kind, what: 'sleet', totalMm: null, from: null, to: null, raining: true }
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
  if (a && a.level !== 'none') a.text = rainText(a);
  rainState.a = a;
  const show = !!a && a.level !== 'none';
  const severeUp = !!(severeState.sel && severeState.sel.top);              // a severe weather notice takes the place of the umbrella
  if (pill) {
    pill.hidden = !show || severeUp;
    if (show) {
      pill.dataset.level = a.level;
      const html = (a.level === 'slicker' ? SVG_SLICKER : SVG_UMBRELLA) + `<span>${rainText(a)}</span>`;
      if (pill.dataset.html !== html) { pill.dataset.html = html; pill.innerHTML = html; }
    }
  }
  if (window.__pillSet) window.__pillSet('rain', show && !severeUp ? { level: a.level, text: rainText(a) } : null);       // (the Raspberry Pi program draws the pills itself: native/host/js/pills.js)
  if (status) status.textContent = !conf.rainAlert ? '' : !a ? 'Waiting for the forecast…' : show ? rainText(a) : 'No rain worth an umbrella before 11 pm.';
  if (conf.screenMode === 'led') updateCountdown();                          // the LED panel draws the umbrella itself
}


// ------------------------------------------------------------- severe weather notices --
// Official watches and warnings for the place (js/sky/severe.js; the US National Weather Service), polled about once a minute: a pill in the page, an icon on the
// Raspberry Pi's screen, and the umbrella alert steps aside while one shows. A notice goes when the alert ends or is cancelled (the next poll, or its own end time).
export const severeState = { alerts: [], t: 0, sel: null, busy: false, key: '', error: false };
const sevIcon = (type) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SEV_ICON[type] || SEV_ICON.other}"/></svg>`;

/** What the LED panel's corner shows: a severe weather notice if there is one, else the umbrella (the card draws either with its own icon). */
const ledNotice = () => { const a = severeState.sel && severeState.sel.top; return a ? { level: 'sev' + a.level, hazard: a.type, text: pillText(severeState.sel) } : rainState.a; };

/** Decide what the notice shows from the alerts we hold, and show it (page pill, Pi pill, status line). */
export function updateSevere() {
  const pill = document.getElementById('severePill'), status = document.getElementById('severeStatus');
  const sel = !engine || conf.severeAlerts === 'off' || histActive() ? { top: null, count: 0, all: [] } : choose(severeState.alerts, { levels: conf.severeAlerts, other: !!conf.severeOther }, Date.now());
  const changed = (!!severeState.sel?.top) !== (!!sel.top);
  severeState.sel = sel;
  const a = sel.top, text = a ? pillText(sel) : '';
  if (pill) {
    pill.hidden = !a;
    if (a) {
      pill.dataset.level = a.level; pill.title = a.headline;
      const html = sevIcon(a.type) + `<span>${text}</span>`;
      if (pill.dataset.html !== html) { pill.dataset.html = html; pill.innerHTML = html; }
    }
  }
  if (window.__pillSet) window.__pillSet('severe', a ? { level: a.level, type: a.type, icon: SEV_ICON[a.type] || SEV_ICON.other, text, headline: a.headline } : null);       // (the Raspberry Pi program draws the pills itself: native/host/js/pills.js)
  if (status) {
    const lat = num(ov.lat ?? conf.location_latitude, NaN), lon = num(ov.lon ?? conf.location_longitude, NaN);
    status.textContent = conf.severeAlerts === 'off' ? '' : Number.isFinite(lat) && Number.isFinite(lon) && !inAlertArea(lat, lon) ? 'Alerts come from the US National Weather Service and Environment Canada: this place is outside both.'
      : severeState.error && !severeState.t ? 'Could not reach the weather alert service.' : a ? `${a.headline}${sel.count > 1 ? ` (+${sel.count - 1} more)` : ''}` : severeState.t ? 'No alerts for your place.' : 'Checking for alerts…';
  }
  if (changed) updateRain();                                                    // the umbrella steps aside, or comes back
  if (conf.screenMode === 'led') updateCountdown();                             // the LED panel draws the notice itself
}

/** Ask the service now (the page's scheduler does this every minute). Keeps the last answer for up to 15 minutes when a lookup fails. */
export async function loadSevere() {
  if (!engine || severeState.busy) return;
  if (ov.severe) {                                                                    // ?severe=type:level: a pretend notice (no lookup), for screenshots and tests
    const [type, level] = String(ov.severe).split(':');
    const names = { warning: 'Warning', watch: 'Watch', advisory: 'Advisory' }, lv = names[level] ? level : 'warning', ty = SEV_ICON[type] ? type : 'other';
    severeState.alerts = [{ id: 'pretend', event: `${ty[0].toUpperCase()}${ty.slice(1)} ${names[lv]}`, level: lv, type: ty, other: false, severity: 3, urgency: 3, headline: `A pretend ${ty} ${lv}`, area: '', expires: null, onset: null, cancelled: false }];
    severeState.t = Date.now(); updateSevere(); return;
  }
  if (conf.severeAlerts === 'off' || histActive()) { severeState.alerts = []; updateSevere(); return; }
  const lat0 = num(ov.lat ?? conf.location_latitude, NaN), lon0 = num(ov.lon ?? conf.location_longitude, NaN);
  if (!Number.isFinite(lat0) || !Number.isFinite(lon0) || (lat0 === -1 && lon0 === -1) || !inAlertArea(lat0, lon0)) { severeState.alerts = []; severeState.t = 0; updateSevere(); return; }
  severeState.busy = true;
  try { severeState.alerts = await fetchAlerts(coarse(lat0, 0.05), coarse(lon0, 0.05)); severeState.t = Date.now(); severeState.error = false; }
  catch (e) { console.info('[sky] severe weather lookup failed:', e.message); severeState.error = true; if (Date.now() - severeState.t > 15 * 60000) { severeState.alerts = []; severeState.t = 0; } }
  severeState.busy = false;
  updateSevere();
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
  const sunPill = (v) => { if (window.__pillSet) window.__pillSet('sun', v); };
  if (!mode || mode === 'off') { sunPill(null); showing = false; el.hidden = true; if (led) drawLedCard(null, 0, false, ledNotice()); return; }
  const d = now();
  const lead = num(conf.countdownLead, 20);
  const kind = conf.countdownKind || 'sun';
  const st = countdownState(getSunEvents(d, kind).ev, +d, mode, lead, kind);
  showing = !!st;
  if (led) { el.hidden = true; drawLedCard(st, lead * 60000, false, ledNotice()); return; }
  drawLedCard(null, 0, true);
  if (!st) { sunPill(null); el.hidden = true; return; }
  const rise = st.kind === 'sunrise', name = st.name, glyph = st.body === 'moon' ? '☾' : '☀';
  const total = Math.ceil(Math.max(0, st.msLeft) / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0'), ss = String(total % 60).padStart(2, '0');
  const html = st.msLeft <= 0
    ? `<span class="icon" aria-hidden="true">${glyph}</span><span class="what">${name}</span>`
    : `<span class="icon" aria-hidden="true">${glyph}${rise ? '↑' : '↓'}</span><span class="what">${name} in</span><span class="time">${mm}:${ss}</span>`;
  sunPill({ kind: st.kind, body: st.body, name, left: st.msLeft <= 0 ? null : mm + ':' + ss });
  if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
  el.dataset.kind = st.kind;
  el.dataset.body = st.body;
  el.hidden = false;
}

