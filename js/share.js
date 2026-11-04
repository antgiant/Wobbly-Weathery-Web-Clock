// Share links: the current setup as a link, for a screen nobody can touch (a digital sign, a kiosk browser). Pure functions, no DOM.
//
// Two forms of the same link, which decode to exactly the same setup:
//   short      ?c=AbCd...       bit-packed, as short as it can be (a preset alone is 3 characters, a preset and five changes about 12)
//   readable   ?v=1&preset=bedside&hideSeconds=on&place=41.88,-87.63&kiosk=1     real names, for a person to read, edit and explain
//
// The short form is a preset (the closest of the ones below) plus the settings that differ from it: each change is the setting's
// number in the table below (7 bits) and its value (1 to 7 bits), then a place (two numbers, if the setup has one) is packed on the end.
//
// FROZEN. Version 1 of the table and of the presets below must never change: a link that says "preset 5 plus these changes" has to mean
// the same thing for ever. New settings are only ever appended (to a new version); a preset is never edited (a changed preset is a new
// entry in the next version). Old links decode with the table they were made with, and settings added later keep their defaults.
// tests/unit/share.test.mjs holds golden links that must keep decoding to the same setups.

import { CITIES } from './cities.js';

export const VERSION = 1;
/** Version 2 is version 1 plus one optional field at the end: the time zone to show the time in. A link without it is still written as version 1,
 *  so every link ever made (and the golden links in the tests) is unchanged; only a link that carries a time zone says 2. */
export const VERSION_TZ = 2;
/** Version 3: a place picked from the built-in city list (js/cities.js) travels as the city's number (8 bits instead of 45), and its time zone comes with it.
 *  The list is FROZEN in order: entries 0 to CITIES_FROZEN-1 never change or move (tests/unit/share.test.mjs pins them); new cities are only appended. */
export const VERSION_CITY = 3;
export const CITIES_FROZEN = 128;
const ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;
export const cleanZone = (z) => (typeof z === 'string' && z.length <= 40 && ZONE.test(z) ? z : '');

/** The number of a frozen-list city whose name ("Chicago, United States") is `name` and which lies within 0.2 degree of `place`, or -1. */
export function cityIndex(name, place) {
  if (!name || !place) return -1;
  const i = CITIES.findIndex((c, k) => k < CITIES_FROZEN && `${c[0]}, ${c[1]}` === name);
  return i >= 0 && Math.abs(CITIES[i][2] - place.lat) < 0.2 && Math.abs(CITIES[i][3] - place.lon) < 0.2 ? i : -1;
}
const cityPlace = (i) => ({ lat: CITIES[i][2], lon: CITIES[i][3] });

/** The settings a link can carry: [key, type, default, ...]. b: on/off. tri: auto/on/off. e: one of the options. n: a number (min, max, step). t: text. d: a date and time. */
export const SETTINGS_V1 = [
  ['twentyFourHourClock', 'tri', null],
  ['hideSeconds', 'b', false],
  ['clockMode', 'e', "time", ["time", "countdown"]],
  ['timerTarget', 'd', ""],
  ['timerLabel', 't', ""],
  ['clockStyle', 'e', "auto", ["auto", "glass", "stained", "solid"]],
  ['glassFrost', 'n', 0.35, 0, 1, 0.01],
  ['glassGlow', 'n', 0, 0, 1, 0.01],
  ['legibility', 'e', "auto", ["auto", "high", "off"]],
  ['glassGlowColor', 'e', "follow", ["warm", "white", "cool", "follow"]],
  ['clockColor', 'e', "auto", ["auto", "classic", "white"]],
  ['landscape', 'e', "auto", ["auto", "flat", "hills", "mountains", "desert", "ocean", "city"]],
  ['holidayTree', 'b', true],
  ['plants', 'b', true],
  ['quality', 'e', "auto", ["auto", "low", "medium", "high"]],
  ['bodySize', 'e', 2, ["1", "2", "3"]],
  ['nightBrightness', 'n', 1.4, 0.5, 4, 0.1],
  ['viewMode', 'e', "drag", ["fixed", "drag", "look"]],
  ['followSun', 'b', true],
  ['viewHeading', 'n', 180, 0, 359, 1],
  ['viewPitchAuto', 'b', true],
  ['horizonInDigits', 'n', 0.3, 0, 0.8, 0.05],
  ['viewPitch', 'n', 12, -10, 80, 1],
  ['viewFov', 'n', 80, 30, 110, 1],
  ['weatherMode', 'e', "live", ["live", "clear", "partly", "cloudy", "overcast", "rain", "storm", "snow", "fog", "haze"]],
  ['tempUnit', 'e', "auto", ["auto", "c", "f"]],
  ['cloudMotion', 'e', 1, ["1", "0.25", "0"]],
  ['rainAlert', 'b', false],
  ['digitWeather', 'e', "on", ["on", "off"]],
  ['windSway', 'e', "off", ["off", "lean", "full"]],
  ['countdown', 'e', "off", ["off", "both", "sunrise", "sunset"]],
  ['countdownKind', 'e', "sun", ["sun", "golden", "civil", "nautical", "astro", "moon"]],
  ['countdownLead', 'e', 20, ["10", "15", "20", "30"]],
  ['brightnessDay', 'n', 1, 0.1, 1, 0.05],
  ['brightnessNight', 'n', 1, 0.1, 1, 0.05],
  ['brightnessTransition', 'e', 45, ["15", "30", "45", "60", "90", "120"]],
  ['screenMode', 'e', "normal", ["normal", "led"]],
  ['ledCols', 'n', 64, 8, 256, 1],
  ['ledRows', 'n', 32, 8, 256, 1],
  ['ledStars', 'e', "auto", ["auto", "always", "off"]],
  ['ledTurn', 'b', true],
  ['keepAwake', 'b', true],
  ['antiBurnIn', 'e', "auto", ["auto", "on", "off"]],
];

/** The presets a link can be "close to": [id, name, the settings that differ from the defaults]. */
export const BASES_V1 = [
  ['standard', 'Standard', {}],
  ['bedside', 'Bedside', {"clockStyle":"glass","glassFrost":0.55,"glassGlow":0.35,"hideSeconds":true,"quality":"medium","cloudMotion":0.25,"brightnessNight":0.25}],
  ['sunwatch', 'Sunset watcher', {"glassGlow":0.2,"countdown":"both"}],
  ['led', 'LED panel', {"quality":"low","cloudMotion":0.25,"countdown":"both","screenMode":"led","brightnessNight":0.5}],
  ['weather', 'Weather watch', {"countdown":"both","rainAlert":true}],
  ['everyday', 'Everyday', {"glassFrost":0.55,"glassGlow":0.35,"hideSeconds":true,"quality":"medium","cloudMotion":0.25,"countdown":"both","rainAlert":true,"brightnessNight":0.25}],
  ['everyday-saver', 'Everyday, power saver', {"glassFrost":0.55,"hideSeconds":true,"quality":"low","cloudMotion":0,"plants":false,"countdown":"both","screenMode":"led","rainAlert":true,"brightnessNight":0.3}],
  ['showcase', 'Showcase', {"clockStyle":"glass","glassFrost":0.25,"glassGlow":0.45,"quality":"high"}],
  ['saver', 'Battery saver', {"clockStyle":"solid","quality":"low","cloudMotion":0,"plants":false,"brightnessNight":0.3,"keepAwake":false}]
];

// ---------------------------------------------------------------------------------------------------- bits
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
class Writer {
  constructor() { this.bits = []; }
  put(v, n) { for (let i = n - 1; i >= 0; i--) this.bits.push(Math.floor(v / 2 ** i) % 2); }
  text() { let s = ''; for (let i = 0; i < this.bits.length; i += 6) { let x = 0; for (let j = 0; j < 6; j++) x = x * 2 + (this.bits[i + j] || 0); s += B64[x]; } return s; }
}
class Reader {
  constructor(str) { this.bits = []; for (const ch of str) { const x = B64.indexOf(ch); if (x < 0) throw new Error('bad character'); for (let i = 5; i >= 0; i--) this.bits.push((x >> i) & 1); } this.pos = 0; }
  get(n) { if (this.pos + n > this.bits.length) throw new Error('short'); let v = 0; for (let i = 0; i < n; i++) v = v * 2 + this.bits[this.pos++]; return v; }
}
const log2up = (n) => Math.max(1, Math.ceil(Math.log2(n)));

// ---------------------------------------------------------------------------------------------------- values
const same = (a, b) => (typeof a === 'number' || typeof b === 'number' ? Math.abs(Number(a) - Number(b)) < 1e-9 : a === b);
const DEF = Object.fromEntries(SETTINGS_V1.map((r) => [r[0], r[2]]));
const spec = (key) => SETTINGS_V1.find((r) => r[0] === key);

const triIndex = (v) => (v === true ? 1 : v === false ? 2 : 0);
const triValue = (i) => [null, true, false][i];
const MIN_2000 = Date.UTC(2000, 0, 1) / 60000;
const dateToMinutes = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 - MIN_2000) : NaN; };
const minutesToDate = (n) => { const d = new Date((n + MIN_2000) * 60000), p = (x) => String(x).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const steps = (r) => Math.round((r[4] - r[3]) / r[5]);
const decimals = (step) => (String(step).split('.')[1] || '').length;

/** Clamp a value to what the setting allows (an option of the list, a number in range, text of a sensible length). */
export function clean(key, v) {
  const r = spec(key); if (!r) return undefined;
  const t = r[1];
  if (t === 'b') return v === true || v === 'true' || v === 'on' || v === 1 || v === '1' ? true : v === false || v === 'false' || v === 'off' || v === 0 || v === '0' ? false : r[2];
  if (t === 'tri') return v === true || v === 'true' || v === 'on' ? true : v === false || v === 'false' || v === 'off' ? false : null;
  if (t === 'e') { const o = r[3].find((x) => String(x) === String(v)); return o === undefined ? r[2] : (typeof r[2] === 'number' ? Number(o) : o); }
  if (t === 'n') { const n = Number(v); if (!Number.isFinite(n)) return r[2]; const q = Math.min(steps(r), Math.max(0, Math.round((n - r[3]) / r[5]))); return Number((r[3] + q * r[5]).toFixed(decimals(r[5]) + 1)); }
  if (t === 't') return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').slice(0, 40);
  if (t === 'd') return Number.isFinite(dateToMinutes(v)) && dateToMinutes(v) >= 0 && dateToMinutes(v) < 2 ** 28 ? minutesToDate(dateToMinutes(v)) : '';
  return r[2];
}

function putValue(w, r, v) {
  const t = r[1];
  if (t === 'b') w.put(v ? 1 : 0, 1);
  else if (t === 'tri') w.put(triIndex(v), 2);
  else if (t === 'e') w.put(Math.max(0, r[3].findIndex((x) => String(x) === String(v))), log2up(r[3].length));
  else if (t === 'n') w.put(Math.min(steps(r), Math.max(0, Math.round((Number(v) - r[3]) / r[5]))), log2up(steps(r) + 1));
  else if (t === 't') { const bytes = new TextEncoder().encode(String(v)).slice(0, 120); w.put(bytes.length, 7); for (const b of bytes) w.put(b, 8); }
  else if (t === 'd') w.put(Math.max(0, dateToMinutes(v)), 28);
}
function getValue(rd, r) {
  const t = r[1];
  if (t === 'b') return rd.get(1) === 1;
  if (t === 'tri') { const i = rd.get(2); if (i > 2) throw new Error('bad'); return triValue(i); }
  if (t === 'e') { const i = rd.get(log2up(r[3].length)); if (i >= r[3].length) throw new Error('bad'); return typeof r[2] === 'number' ? Number(r[3][i]) : r[3][i]; }
  if (t === 'n') { const q = rd.get(log2up(steps(r) + 1)); return clean(r[0], r[3] + Math.min(q, steps(r)) * r[5]); }
  if (t === 't') { const n = rd.get(7); const bytes = []; for (let i = 0; i < n; i++) bytes.push(rd.get(8)); return clean(r[0], new TextDecoder().decode(new Uint8Array(bytes))); }
  if (t === 'd') return clean(r[0], minutesToDate(rd.get(28)));
  throw new Error('bad type');
}
const baseSettings = (i) => ({ ...DEF, ...BASES_V1[i][2] });

/** Full settings (every key of the table) from whatever keys a setup has: the rest are the defaults. */
export function normalise(settings = {}) {
  const out = {};
  for (const r of SETTINGS_V1) out[r[0]] = r[0] in settings ? clean(r[0], settings[r[0]]) : r[2];
  return out;
}

// ---------------------------------------------------------------------------------------------------- the short form
/**
 * @param {{settings: object, place?: {lat: number, lon: number}|null, kiosk?: boolean}} setup
 * @returns {string} the part after "c="
 */
export function encodeShort(setup) {
  const s = normalise(setup.settings);
  let best = null;
  for (let b = 0; b < BASES_V1.length; b++) {                       // the preset with the fewest differences (and so the shortest link)
    const base = baseSettings(b), diffs = [];
    SETTINGS_V1.forEach((r, i) => { if (!same(s[r[0]], base[r[0]])) diffs.push(i); });
    const w = new Writer(); writeSetup(w, b, diffs, s, setup);
    if (!best || w.bits.length < best.length) best = w.bits;
  }
  const w = new Writer(); w.bits = best; return w.text();
}
function writeSetup(w, base, diffs, s, setup) {
  const city = cityIndex(setup.placeName, setup.place), usable = city >= 0 && (!cleanZone(setup.timeZone) || setup.timeZone === CITIES[city][4]);
  if (usable) {                                                        // version 3: the place is a city of the frozen list
    w.put(VERSION_CITY, 4); w.put(setup.kiosk ? 1 : 0, 1); w.put(1, 1); w.put(base, 4); w.put(diffs.length, 7);
    for (const i of diffs) { w.put(i, 7); putValue(w, SETTINGS_V1[i], s[SETTINGS_V1[i][0]]); }
    w.put(city, 8);
    return;
  }
  w.put(cleanZone(setup.timeZone) ? VERSION_TZ : VERSION, 4); w.put(setup.kiosk ? 1 : 0, 1); w.put(setup.place ? 1 : 0, 1); w.put(base, 4); w.put(diffs.length, 7);
  for (const i of diffs) { w.put(i, 7); putValue(w, SETTINGS_V1[i], s[SETTINGS_V1[i][0]]); }
  if (setup.place) { w.put(Math.round((Math.min(90, Math.max(-90, setup.place.lat)) + 90) / 180 * 4194303), 22); w.put(Math.round((Math.min(180, Math.max(-180, setup.place.lon)) + 180) / 360 * 8388607), 23); }
  const zone = cleanZone(setup.timeZone);
  if (zone) { w.put(zone.length, 6); for (const ch of zone) w.put(ch.charCodeAt(0), 7); }
}

/** @returns {{settings: object, place: object|null, kiosk: boolean, base: string}|null} null when it is not a link of ours. */
export function decodeShort(str) {
  try {
    if (typeof str !== 'string' || !str || str.length > 4000) return null;
    const rd = new Reader(str);
    const version = rd.get(4);
    if (version !== VERSION && version !== VERSION_TZ && version !== VERSION_CITY) return null;  // a newer version than this page knows: not understood
    const kiosk = rd.get(1) === 1, hasPlace = rd.get(1) === 1, base = rd.get(4), count = rd.get(7);
    if (base >= BASES_V1.length) return null;
    const settings = baseSettings(base);
    for (let k = 0; k < count; k++) { const i = rd.get(7); if (i >= SETTINGS_V1.length) return null; settings[SETTINGS_V1[i][0]] = getValue(rd, SETTINGS_V1[i]); }
    let place = null;
    if (version === VERSION_CITY) {
      const c = rd.get(8); if (c >= CITIES_FROZEN || !CITIES[c]) return null;
      return { settings, place: cityPlace(c), kiosk, base: BASES_V1[base][0], timeZone: CITIES[c][4], placeName: `${CITIES[c][0]}, ${CITIES[c][1]}` };
    }
    if (hasPlace) { const la = rd.get(22) / 4194303 * 180 - 90, lo = rd.get(23) / 8388607 * 360 - 180; place = { lat: Math.round(la * 1e4) / 1e4, lon: Math.round(lo * 1e4) / 1e4 }; }
    let timeZone = '';
    if (version === VERSION_TZ) { const n = rd.get(6); let z = ''; for (let i = 0; i < n; i++) z += String.fromCharCode(rd.get(7)); timeZone = cleanZone(z); }
    return { settings, place, kiosk, base: BASES_V1[base][0], timeZone };
  } catch (_) { return null; }
}

// ---------------------------------------------------------------------------------------------------- the readable form
const showValue = (r, v) => (r[1] === 'b' ? (v ? 'on' : 'off') : r[1] === 'tri' ? (v === true ? 'on' : v === false ? 'off' : 'auto') : String(v));
const readValue = (r, text) => (r[1] === 'tri' ? (text === 'auto' ? null : clean(r[0], text)) : clean(r[0], text));
const PLACE = /^(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/;

/** @returns {string} the query without the "?": v=1&preset=...&key=value... (only what differs from the preset) */
export function encodeReadable(setup) {
  const s = normalise(setup.settings);
  let bi = 0, fewest = Infinity;
  BASES_V1.forEach((b, i) => { const base = baseSettings(i); const n = SETTINGS_V1.filter((r) => !same(s[r[0]], base[r[0]])).length; if (n < fewest) { fewest = n; bi = i; } });
  const base = baseSettings(bi), zone = cleanZone(setup.timeZone), parts = [`v=${zone ? VERSION_TZ : VERSION}`, `preset=${BASES_V1[bi][0]}`];
  for (const r of SETTINGS_V1) if (!same(s[r[0]], base[r[0]])) parts.push(`${r[0]}=${encodeURIComponent(showValue(r, s[r[0]]))}`);
  if (setup.place) parts.push(`place=${setup.place.lat},${setup.place.lon}`);
  if (zone) parts.push(`tz=${encodeURIComponent(zone)}`);
  if (setup.kiosk) parts.push('kiosk=1');
  return parts.join('&');
}

// Friendlier names a person might type in a readable link. They are only read, never written (the readable form always writes the real names).
const ALIASES = { weather: 'weatherMode', style: 'clockStyle', night: 'brightnessNight', day: 'brightnessDay', timezone: 'tz', sign: 'kiosk', transition: 'brightnessTransition', frost: 'glassFrost', glow: 'glassGlow' };
const onOff = (v) => (/^(1|on|true|yes)$/i.test(v) ? true : /^(0|off|false|no)$/i.test(v) ? false : null);
function withAliases(search) {
  const q = new URLSearchParams(search);
  for (const [alias, real] of Object.entries(ALIASES)) if (q.has(alias) && !q.has(real)) q.set(real, q.get(alias));
  if (q.has('seconds') && !q.has('hideSeconds') && onOff(q.get('seconds')) !== null) q.set('hideSeconds', onOff(q.get('seconds')) ? 'off' : 'on');   // seconds=off is hideSeconds=on
  if (q.has('led') && !q.has('screenMode') && onOff(q.get('led')) !== null) q.set('screenMode', onOff(q.get('led')) ? 'led' : 'normal');
  return q;
}

/** @returns {{settings, place, kiosk, base}|null} */
export function decodeReadable(search) {
  try {
    const q = withAliases(search);
    if (!q.has('preset') && !q.has('kiosk')) return null;
    if (q.has('v') && Number(q.get('v')) !== VERSION && Number(q.get('v')) !== VERSION_TZ) return null;
    let bi = BASES_V1.findIndex((b) => b[0] === q.get('preset'));
    if (bi < 0) bi = 0;
    const settings = baseSettings(bi);
    for (const r of SETTINGS_V1) if (q.has(r[0])) settings[r[0]] = readValue(r, q.get(r[0]));
    let place = null;
    const m = PLACE.exec((q.get('place') || '').trim());
    if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) place = { lat: Math.round(+m[1] * 1e4) / 1e4, lon: Math.round(+m[2] * 1e4) / 1e4 };
    // a person can name a city instead (?city=Chicago, or city=Chicago,United States): its place and time zone come from the built-in list
    let cityZone = '', cityName = '';
    if (q.has('city')) {
      const want = q.get('city').trim().toLowerCase(), k = CITIES.findIndex((c, i) => i < CITIES_FROZEN && (c[0].toLowerCase() === want || `${c[0]}, ${c[1]}`.toLowerCase() === want || `${c[0]},${c[1]}`.toLowerCase() === want));
      if (k >= 0) { if (!place) place = cityPlace(k); cityZone = CITIES[k][4]; cityName = `${CITIES[k][0]}, ${CITIES[k][1]}`; }
    }
    return { settings, place, kiosk: q.get('kiosk') === '1' || q.get('kiosk') === 'on' || q.get('kiosk') === 'true', base: BASES_V1[bi][0], timeZone: cleanZone(q.get('tz') || '') || cityZone, ...(cityName ? { placeName: cityName } : {}) };
  } catch (_) { return null; }
}

/** The setup a page address asks for, in either form, or null when it is an ordinary address. */
export function fromSearch(search) {
  const q = new URLSearchParams(search);
  if (q.has('c')) return decodeShort(q.get('c'));
  return decodeReadable(search);
}

/**
 * Whatever a person pastes (a link in either form, with or without the address): both forms of it, in words, or null when it is not ours.
 * @returns {{setup, short: string, readable: string, form: 'short'|'readable', describe: string}|null}
 */
export function convertLink(text, fallbackBase = 'https://example.invalid/') {
  const t = String(text || '').trim();
  if (!t) return null;
  const at = t.indexOf('?'), search = at >= 0 ? t.slice(at) : (/^(c|v|preset|kiosk)=/.test(t) ? `?${t}` : '');
  const setup = search ? fromSearch(search) : null;
  if (!setup) return null;
  const base = at > 0 ? t.slice(0, at) : fallbackBase, form = new URLSearchParams(search).has('c') ? 'short' : 'readable';
  return { setup, form, short: toLink(setup, base, 'short'), readable: toLink(setup, base, 'readable'), describe: describe(setup) };
}

/** Setup from the live settings (a conf-like object). `kiosk` is the choice made when sharing. */
export function setupFromConf(conf, kiosk = false) {
  const settings = {}; for (const r of SETTINGS_V1) settings[r[0]] = conf[r[0]] === undefined ? r[2] : conf[r[0]];
  const place = conf.manualLocation && Number.isFinite(Number(conf.location_latitude)) && Number.isFinite(Number(conf.location_longitude)) ? { lat: Math.round(Number(conf.location_latitude) * 1e4) / 1e4, lon: Math.round(Number(conf.location_longitude) * 1e4) / 1e4 } : null;
  return { settings: normalise(settings), place, kiosk: !!kiosk, timeZone: cleanZone(conf.timeZone), ...(place && conf.location_name ? { placeName: String(conf.location_name) } : {}) };
}

/** @param {'short'|'readable'} form */
export function toLink(setup, base, form = 'short') {
  const origin = String(base).split('?')[0].split('#')[0];
  return form === 'short' ? `${origin}?c=${encodeShort(setup)}` : `${origin}?${encodeReadable(setup)}`;
}

/** A sentence saying what a link does, so it can be checked before it goes to a sign. */
export function describe(setup) {
  const s = normalise(setup.settings);
  let bi = 0, fewest = Infinity;
  BASES_V1.forEach((b, i) => { const base = baseSettings(i); const n = SETTINGS_V1.filter((r) => !same(s[r[0]], base[r[0]])).length; if (n < fewest) { fewest = n; bi = i; } });
  const base = baseSettings(bi), bits = [];
  bits.push(`${BASES_V1[bi][1]} preset${fewest ? ` with ${fewest} change${fewest === 1 ? '' : 's'}` : ''}`);
  if (s.hideSeconds) bits.push('seconds hidden');
  if (s.clockMode === 'countdown') bits.push(`counting down to ${s.timerTarget.replace('T', ' ')}${s.timerLabel ? ` (${s.timerLabel})` : ''}`);
  if (s.screenMode === 'led') bits.push(`LED panel ${s.ledCols} x ${s.ledRows}`);
  if (!same(s.brightnessNight, base.brightnessNight) || !same(s.brightnessDay, base.brightnessDay)) bits.push(`brightness ${Math.round(s.brightnessDay * 100)}% by day, ${Math.round(s.brightnessNight * 100)}% at night`);
  bits.push(setup.place ? `place ${setup.placeName && cityIndex(setup.placeName, setup.place) >= 0 ? setup.placeName : `${setup.place.lat}, ${setup.place.lon}`}` : 'place estimated from the time zone');
  if (cleanZone(setup.timeZone)) bits.push(`time shown for ${setup.timeZone.replace(/_/g, ' ')}`);
  if (setup.kiosk) bits.push('kiosk mode (no controls)');
  return bits.join(', ');
}
