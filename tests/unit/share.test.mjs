// Share links (js/share.js): the codec round-trips, stays short, never changes meaning, and shrugs off rubbish.
// Run: node tests/unit/share.test.mjs
import { check, done } from '../lib/check.mjs';
import { rng } from '../../js/sky/drops.js';
import { installDomStub } from '../lib/dom-stub.mjs';
installDomStub({});
const S = await import('../../js/share.js');
const { DEFAULTS } = await import('../../js/config.js');
const { SETTINGS_V1, BASES_V1, encodeShort, decodeShort, encodeReadable, decodeReadable, fromSearch, normalise, toLink, describe, setupFromConf, clean } = S;

check('every setting in the table is a real setting of the app', SETTINGS_V1.every((r) => r[0] in DEFAULTS), SETTINGS_V1.filter((r) => !(r[0] in DEFAULTS)).map((r) => r[0]).join());
check('the table has unique keys (the number of a setting is its position, for ever)', new Set(SETTINGS_V1.map((r) => r[0])).size === SETTINGS_V1.length);
check('there are at most 128 settings (a setting number is 7 bits) and at most 16 presets (4 bits)', SETTINGS_V1.length <= 128 && BASES_V1.length <= 16, `${SETTINGS_V1.length} / ${BASES_V1.length}`);
check('every preset only changes settings in the table', BASES_V1.every((b) => Object.keys(b[2]).every((k) => SETTINGS_V1.some((r) => r[0] === k))));
check('the first preset is Standard (no changes)', BASES_V1[0][0] === 'standard' && Object.keys(BASES_V1[0][2]).length === 0);

// ---- frozen links: these must decode to the same setups for ever (add to this list, never edit it) ----
const golden = [
  ['EAA', { base: 'standard', place: null, kiosk: false, diff: {} }],
  ['EEA', { base: 'bedside', place: null, kiosk: false, diff: { clockStyle: 'glass', glassFrost: 0.55, glassGlow: 0.35, hideSeconds: true, quality: 'medium', cloudMotion: 0.25, brightnessNight: 0.25 } }],
  ['HEBdx6yDXvQ', { base: 'bedside', place: { lat: 41.8781, lon: -87.6298 }, kiosk: true, diff: { hideSeconds: true, clockStyle: 'glass', glassFrost: 0.55, glassGlow: 0.35, quality: 'medium', cloudMotion: 0.25, brightnessNight: 0.25 } }],
  ['EAUAQUGGxGIAQOkN7Y0sjC8mFP1EZJSvCY4', { base: 'standard', place: null, kiosk: false, diff: { twentyFourHourClock: true, clockMode: 'countdown', timerTarget: '2026-12-25T08:00', timerLabel: 'Holiday', weatherMode: 'rain', countdownKind: 'moon', brightnessNight: 0.4, screenMode: 'led', ledCols: 128, ledRows: 64 } }],
];
for (const [link, want] of golden) {
  const d = decodeShort(link), def = normalise({}), diff = {};
  if (d) for (const k in d.settings) if (JSON.stringify(d.settings[k]) !== JSON.stringify(def[k])) diff[k] = d.settings[k];
  check(`frozen link ${link.slice(0, 14)}${link.length > 14 ? '...' : ''} still means the same`, d && d.base === want.base && d.kiosk === want.kiosk && JSON.stringify(d.place) === JSON.stringify(want.place) && JSON.stringify(Object.entries(diff).sort()) === JSON.stringify(Object.entries(want.diff).sort()), JSON.stringify({ d: d && { base: d.base, place: d.place, kiosk: d.kiosk }, diff }));
}

// ---- length ----
check('every preset on its own is 3 characters', BASES_V1.every((b) => encodeShort({ settings: b[2] }).length === 3), BASES_V1.map((b) => encodeShort({ settings: b[2] })).join(' '));
const five = { settings: { ...BASES_V1[1][2], countdown: 'both', rainAlert: true, windSway: 'lean', brightnessNight: 0.45, ledStars: 'off' } };
check('a preset and five changes is at most 16 characters', encodeShort(five).length <= 16, `${encodeShort(five).length}: ${encodeShort(five)}`);
check('the whole link (an address of 30 characters) with five changes is well under 60', toLink(five, 'https://clock.wooleys.us/', 'short').length < 60, toLink(five, 'https://clock.wooleys.us/', 'short'));
check('a place adds about 8 characters', encodeShort({ settings: {}, place: { lat: 41.8781, lon: -87.6298 } }).length - encodeShort({ settings: {} }).length <= 8);
check('the link is only the characters that are safe in a URL', /^[A-Za-z0-9_-]+$/.test(encodeShort(five)));

// ---- round trip over many random setups ----
const r = rng(2026);
const pick = (a) => a[Math.floor(r() * a.length)];
const randomValue = (row) => {
  const t = row[1];
  if (t === 'b') return r() < 0.5;
  if (t === 'tri') return pick([null, true, false]);
  if (t === 'e') { const o = pick(row[3]); return typeof row[2] === 'number' ? Number(o) : o; }
  if (t === 'n') return row[3] + Math.floor(r() * (Math.round((row[4] - row[3]) / row[5]) + 1)) * row[5];
  if (t === 't') return pick(['', 'Launch', 'Birthday party', 'Café ☕', 'x'.repeat(40)]);
  if (t === 'd') return pick(['', '2026-12-25T08:00', '2031-01-01T00:00', '2026-06-21T23:59']);
};
let bad = '', n = 0;
for (let i = 0; i < 400 && !bad; i++) {
  const settings = {}; for (const row of SETTINGS_V1) if (r() < 0.35) settings[row[0]] = randomValue(row);
  const setup = { settings, place: r() < 0.5 ? { lat: Math.round((r() * 180 - 90) * 1e4) / 1e4, lon: Math.round((r() * 360 - 180) * 1e4) / 1e4 } : null, kiosk: r() < 0.5 };
  const want = normalise(settings), got = decodeShort(encodeShort(setup));
  if (!got) { bad = `no decode for ${JSON.stringify(setup)}`; break; }
  for (const row of SETTINGS_V1) if (JSON.stringify(got.settings[row[0]]) !== JSON.stringify(want[row[0]])) { bad = `${row[0]}: ${JSON.stringify(want[row[0]])} -> ${JSON.stringify(got.settings[row[0]])}`; break; }
  if (!bad && (got.kiosk !== setup.kiosk || (!!got.place !== !!setup.place) || (setup.place && (Math.abs(got.place.lat - setup.place.lat) > 1.1e-4 || Math.abs(got.place.lon - setup.place.lon) > 1.1e-4)))) bad = `place or kiosk: ${JSON.stringify(setup)} -> ${JSON.stringify(got)}`;
  const rd = decodeReadable(encodeReadable(setup));
  if (!bad && (!rd || rd.kiosk !== setup.kiosk || SETTINGS_V1.some((row) => JSON.stringify(rd.settings[row[0]]) !== JSON.stringify(want[row[0]])))) bad = `readable: ${JSON.stringify(setup).slice(0, 200)}`;
  n++;
}
check(`${n} random setups: short link and readable link both decode to exactly what was encoded`, !bad && n === 400, bad);
check('the readable link and the short link of one setup decode to the same setup', (() => { const a = decodeShort(encodeShort(five)), b = decodeReadable(encodeReadable(five)); return JSON.stringify(a.settings) === JSON.stringify(b.settings); })());
check('tri-state 24-hour time: auto, on, off all survive', [null, true, false].every((v) => decodeShort(encodeShort({ settings: { twentyFourHourClock: v } })).settings.twentyFourHourClock === v && decodeReadable(encodeReadable({ settings: { twentyFourHourClock: v } })).settings.twentyFourHourClock === v));
check('a countdown date and name survive, with accents', (() => { const d = decodeShort(encodeShort({ settings: { clockMode: 'countdown', timerTarget: '2027-02-14T19:30', timerLabel: 'Café ☕' } })); return d.settings.timerTarget === '2027-02-14T19:30' && d.settings.timerLabel === 'Café ☕'; })());
check('numbers snap to the control\'s own step (0.553 becomes 0.55)', decodeShort(encodeShort({ settings: { glassFrost: 0.553 } })).settings.glassFrost === 0.55);

// ---- the readable form ----
const rdl = encodeReadable({ settings: { ...BASES_V1[1][2], countdown: 'both' }, place: { lat: 41.8781, lon: -87.6298 }, kiosk: true });
check('readable: real names and values a person can read', /^v=1&preset=bedside&countdown=both&place=41\.8781,-87\.6298&kiosk=1$/.test(rdl), rdl);
check('readable: a person can write one by hand ("preset=bedside&hideSeconds=off") and the change wins over the preset', (() => { const d = decodeReadable('?preset=bedside&hideSeconds=off&brightnessNight=0.6'); return d.settings.hideSeconds === false && d.settings.brightnessNight === 0.6 && d.settings.clockStyle === 'glass'; })());
check('readable: on / off / true / false / 1 / 0 are all understood for switches', ['on', 'true', '1'].every((v) => decodeReadable(`?preset=standard&rainAlert=${v}`).settings.rainAlert === true) && ['off', 'false', '0'].every((v) => decodeReadable(`?preset=standard&holidayTree=${v}`).settings.holidayTree === false));
check('fromSearch: both forms, and ordinary addresses are not links', fromSearch('?c=EEA').base === 'bedside' && fromSearch('?preset=led').base === 'led' && fromSearch('?lat=40.7&lon=-74&t=2026-06-21T12:00:00Z') === null && fromSearch('') === null && fromSearch('?weather=storm&az=90') === null);
check('kiosk alone is enough to be a link', fromSearch('?kiosk=1').kiosk === true);

// ---- rubbish ----
check('short: empty, absurdly long, wrong characters, truncated, wrong version: all ignored (null)', [decodeShort(''), decodeShort(null), decodeShort('A'.repeat(5000)), decodeShort('!!!'), decodeShort('E'), decodeShort('FAA'), decodeShort('zzzzzz')].every((x) => x === null || (x && typeof x.base === 'string')) && decodeShort('') === null && decodeShort('A'.repeat(5000)) === null && decodeShort('!!!') === null && decodeShort('FAA') === null);
check('short: a link cut off in the middle is ignored, not half applied', (() => { const full = encodeShort(five); return decodeShort(full.slice(0, 5)) === null; })());
check('short: a base preset or setting number that does not exist is ignored', decodeShort('EkA') === null);
check('readable: an unknown preset falls back to Standard; unknown keys and junk values are ignored or clamped', (() => { const d = decodeReadable('?preset=nonsense&bogus=1&clockStyle=<script>&glassFrost=99&ledCols=-5&quality=ultra'); return d.base === 'standard' && d.settings.clockStyle === 'auto' && d.settings.glassFrost === 1 && d.settings.ledCols === 8 && d.settings.quality === 'auto' && !('bogus' in d.settings); })());
check('readable: text has no markup or control characters, and is cut to 40 characters', (() => { const d = decodeReadable('?preset=standard&timerLabel=' + encodeURIComponent('<b>hi</b>\u0007' + 'x'.repeat(80))); return !/[<>\u0007]/.test(d.settings.timerLabel) && d.settings.timerLabel.length <= 40; })());
check('readable: a place out of range or malformed is ignored', decodeReadable('?preset=standard&place=95,10').place === null && decodeReadable('?preset=standard&place=here').place === null && decodeReadable('?preset=standard&place=45.5,-122.6').place.lat === 45.5);
check('readable: a version this page does not know is ignored', decodeReadable('?v=7&preset=bedside') === null);
check('clean() keeps a number to its range and an option to its list', clean('glassFrost', 5) === 1 && clean('glassFrost', -1) === 0 && clean('clockStyle', 'nope') === 'auto' && clean('timerTarget', 'tomorrow') === '' && clean('nosuchsetting', 1) === undefined);

// ---- from the live settings, and in words ----
const live = setupFromConf({ ...DEFAULTS, hideSeconds: true, manualLocation: true, location_latitude: 41.87811, location_longitude: -87.62979 }, true);
check('setupFromConf: reads the settings, takes a place only when it was set by hand, rounds it to 0.0001, carries kiosk', live.settings.hideSeconds === true && live.place.lat === 41.8781 && live.place.lon === -87.6298 && live.kiosk === true && setupFromConf({ ...DEFAULTS }).place === null);
const words = describe(live);
check('describe: says the preset, the change, the place and kiosk mode in words', /preset/.test(words) && /seconds hidden/.test(words) && /41\.8781/.test(words) && /kiosk/.test(words), words);
check('describe: a setup with no place says it is estimated from the time zone', /estimated from the time zone/.test(describe(setupFromConf({ ...DEFAULTS }))));

// ---- version 2: a time zone to show the time in (version 1 links are untouched) ----
const withZone = { settings: { hideSeconds: true }, place: { lat: 35.6762, lon: 139.6503 }, kiosk: true, timeZone: 'Asia/Tokyo' };
const noZone = { ...withZone, timeZone: '' };
check('a link without a time zone is still written as version 1 (the same bytes as before, so old links and golden links stay valid)', encodeShort(noZone) === encodeShort({ ...noZone, timeZone: undefined }) && decodeShort(encodeShort(noZone)).timeZone === '' && /^v=1&/.test(encodeReadable(noZone)) && !/tz=/.test(encodeReadable(noZone)));
for (const form of ['short', 'readable']) {
  const link = toLink(withZone, 'https://x.example/', form), back = fromSearch(link.slice(link.indexOf('?')));
  check(`a ${form} link round-trips a time zone, with the place and kiosk mode`, back && back.timeZone === 'Asia/Tokyo' && back.kiosk && Math.abs(back.place.lat - 35.6762) < 1e-3 && back.settings.hideSeconds === true, link);
}
check('a time zone costs 7 bits a letter plus 6 for its length: Asia/Tokyo adds 13 characters (a zone is optional, and rare)', encodeShort(withZone).length - encodeShort(noZone).length === Math.ceil((6 + 7 * 10) / 6) || Math.abs(encodeShort(withZone).length - encodeShort(noZone).length - 13) <= 1, `${encodeShort(noZone).length} -> ${encodeShort(withZone).length}`);
check('zones with digits, plus signs and three parts survive; rubbish does not', ['Etc/GMT+5', 'America/Argentina/Buenos_Aires', 'America/Port-au-Prince', 'UTC'].every((z) => decodeShort(encodeShort({ ...noZone, timeZone: z })).timeZone === z) && ['', '../../etc', 'a b', '<script>', 'x'.repeat(41), '/Paris'].every((z) => S.cleanZone(z) === ''));
check('a time zone in a link that is not valid is dropped, not trusted', fromSearch('?v=2&preset=standard&tz=%3Cb%3E').timeZone === '' && decodeShort(encodeShort({ ...noZone, timeZone: '<b>' })).timeZone === '');
check('describe says which zone the time is shown for; setupFromConf carries the setting', /time shown for America\/New York/.test(describe({ ...noZone, timeZone: 'America/New_York' })) && setupFromConf({ ...DEFAULTS, timeZone: 'Europe/Paris' }).timeZone === 'Europe/Paris' && setupFromConf({ ...DEFAULTS, timeZone: 'nope nope' }).timeZone === '');
check('the version after 2 is still refused, so a future format is never misread', decodeShort('Q') === null && fromSearch('?v=3&preset=standard') === null);

// ---- the wall clock of a zone (js/timezone.js) ----
const { wallTime, validZone } = await import('../../js/timezone.js');
const at = new Date('2026-06-21T17:00:00Z');
const w = (z) => { const r = wallTime(at, z); return `${r.h}:${r.m}:${r.s}`; };
check('wallTime: 17:00 UTC is 2:00 in Tokyo, 19:00 in Paris, 13:00 in New York, 22:30 in Delhi (half-hour zone), 0:00 in Kathmandu-style quarter hours', w('Asia/Tokyo') === '2:0:0' && w('Europe/Paris') === '19:0:0' && w('America/New_York') === '13:0:0' && w('Asia/Kolkata') === '22:30:0' && w('Asia/Kathmandu') === '22:45:0');
check('wallTime: midnight is hour 0, never 24', wallTime(new Date('2026-06-21T15:00:00Z'), 'Asia/Tokyo').h === 0);
check('wallTime: daylight saving is applied (New York is 12:00 at 16:00 UTC in June, 11:00 in January)', wallTime(new Date('2026-06-21T16:00:00Z'), 'America/New_York').h === 12 && wallTime(new Date('2026-01-21T16:00:00Z'), 'America/New_York').h === 11);
check('validZone: real names yes, rubbish and empty no', validZone('Pacific/Auckland') && !validZone('Mars/Olympus') && !validZone('') && !validZone(null) && !validZone(5));
check('with no zone set, wallTime is the device\'s own clock', (() => { const d = new Date(); const r = wallTime(d, ''); return r.h === d.getHours() && r.m === d.getMinutes(); })());

// ---- converting a pasted link, and the friendlier names a person may type ----
const conv = S.convertLink;
const sample = { settings: { hideSeconds: true, brightnessNight: 0.3 }, place: { lat: 41.8781, lon: -87.6298 }, kiosk: false, timeZone: '' };
const shortLink = toLink(sample, 'https://clock.example/app/', 'short'), readLink = toLink(sample, 'https://clock.example/app/', 'readable');
const c1 = conv(shortLink), c2 = conv(readLink);
check('a pasted short link gives the readable form with the same address, and says what it does', c1.form === 'short' && c1.readable === readLink && c1.short === shortLink && /seconds hidden/.test(c1.describe));
check('a pasted readable link gives the short form', c2.form === 'readable' && c2.short === shortLink && c2.readable === readLink);
check('just the query, with or without the question mark, works (the address then comes from the page)', conv('c=' + encodeShort(sample), 'https://p/').short === 'https://p/?c=' + encodeShort(sample) && conv('?preset=bedside&kiosk=1', 'https://p/').short.startsWith('https://p/?c=') && conv('preset=bedside', 'https://p/') !== null);
check('rubbish, an empty string and an ordinary address all give null', conv('hello') === null && conv('') === null && conv(null) === null && conv('https://clock.example/') === null && conv('https://x/?c=!!!') === null);
check('converting back and forth is stable', conv(conv(shortLink).readable).short === shortLink);
const alias = (q) => fromSearch('?preset=standard&' + q);
check('friendly names are understood: weather, style, night, day, sign, timezone', alias('weather=rain').settings.weatherMode === 'rain' && alias('style=solid').settings.clockStyle === 'solid' && alias('night=0.3').settings.brightnessNight === 0.3 && alias('day=0.8').settings.brightnessDay === 0.8 && alias('sign=1').kiosk === true && alias('timezone=Asia/Tokyo').timeZone === 'Asia/Tokyo');
check('seconds=off means hideSeconds on, led=on means the LED look', alias('seconds=off').settings.hideSeconds === true && alias('seconds=on').settings.hideSeconds === false && alias('led=on').settings.screenMode === 'led' && alias('led=off').settings.screenMode === 'normal');
check('the real name wins when both are given, and a wrong value is cleaned like any other', alias('weather=rain&weatherMode=snow').settings.weatherMode === 'snow' && alias('weather=hurricane').settings.weatherMode === 'live');
check('the readable form still always writes the real names', !/[?&](weather|style|night|day|sign|seconds|led)=/.test(encodeReadable({ settings: { weatherMode: 'rain', clockStyle: 'solid', brightnessNight: 0.3, hideSeconds: true, screenMode: 'led' }, kiosk: true })));

// ---- version 3: a place from the built-in city list travels as its number ----
const { CITIES } = await import('../../js/cities.js');
const crypto = await import('crypto');
check('the first 128 cities of the built-in list are frozen: their order and values never change (new ones are only appended)', S.CITIES_FROZEN === 128 && crypto.createHash('sha256').update(JSON.stringify(CITIES.slice(0, S.CITIES_FROZEN))).digest('hex') === 'd7310b0d1f10c37a5549bfea817f484ddaed4ef212add3632c2e9193c6807e40', 'if this fails the list was edited: revert the edit, and append instead');
check('a link for a city of the list uses version 3, with no coordinates and no zone text', (() => { const link = encodeShort({ settings: { hideSeconds: true }, place: { lat: 41.85, lon: -87.65 }, placeName: 'Chicago, United States', kiosk: true, timeZone: 'America/Chicago' }); const b = decodeShort(link); return b && b.placeName === 'Chicago, United States' && b.timeZone === 'America/Chicago' && Math.abs(b.place.lat - 41.88) < 1e-9 && b.kiosk && b.settings.hideSeconds === true; })());
const chicagoByNumber = encodeShort({ settings: { hideSeconds: true }, place: { lat: 41.85, lon: -87.65 }, placeName: 'Chicago, United States', timeZone: 'America/Chicago' });
const chicagoByCoordinates = encodeShort({ settings: { hideSeconds: true }, place: { lat: 41.85, lon: -87.65 }, timeZone: 'America/Chicago' });
check('as a number the place and its zone cost about 19 characters less than coordinates and a zone name', chicagoByCoordinates.length - chicagoByNumber.length >= 15, `${chicagoByCoordinates.length} -> ${chicagoByNumber.length}`);
check('every city of the list round-trips by number, with its own place and zone', CITIES.every((c, i) => { const b = decodeShort(encodeShort({ settings: {}, place: { lat: c[2], lon: c[3] }, placeName: `${c[0]}, ${c[1]}` })); return b && b.place.lat === c[2] && b.place.lon === c[3] && b.timeZone === c[4] && b.placeName === `${c[0]}, ${c[1]}`; }));
check('a place that is not that city (more than 0.2 degree away, or another name, or a different zone chosen) is sent as coordinates, so nothing is changed silently', (() => {
  const far = decodeShort(encodeShort({ settings: {}, place: { lat: 45.0, lon: -87.65 }, placeName: 'Chicago, United States' }));
  const renamed = decodeShort(encodeShort({ settings: {}, place: { lat: 41.88, lon: -87.63 }, placeName: 'Somewhere else' }));
  const zone = decodeShort(encodeShort({ settings: {}, place: { lat: 41.88, lon: -87.63 }, placeName: 'Chicago, United States', timeZone: 'Europe/Paris' }));
  return Math.abs(far.place.lat - 45.0) < 1e-3 && !far.placeName && Math.abs(renamed.place.lat - 41.88) < 1e-3 && !renamed.placeName && zone.timeZone === 'Europe/Paris' && !zone.placeName;
})());
check('a city number outside the frozen list is not a link of ours (a future list cannot be misread)', (() => { const w = decodeShort('Q'); return w === null; })());
check('old links are untouched: a link with coordinates and a zone is still version 2, one with neither still version 1', decodeShort(encodeShort({ settings: {}, place: { lat: 35.6762, lon: 139.6503 }, timeZone: 'Asia/Tokyo' })).timeZone === 'Asia/Tokyo' && decodeShort(encodeShort({ settings: {}, place: { lat: 35.68, lon: 139.65 } })).timeZone === '');
check('the readable form takes a city by name: ?preset=bedside&city=Chicago gives its place and zone; the full name and a place parameter also work', (() => {
  const a = fromSearch('?preset=bedside&city=Chicago'), b = fromSearch('?preset=bedside&city=chicago,united%20states'), c = fromSearch('?preset=bedside&city=Chicago&place=10,20');
  return a.place.lat === 41.88 && a.timeZone === 'America/Chicago' && b.place.lon === -87.63 && c.place.lat === 10 && c.timeZone === 'America/Chicago' && fromSearch('?preset=bedside&city=Nowhereville').place === null;
})());
check('a link by city number says the city in words', /place Chicago, United States/.test(describe({ settings: {}, place: { lat: 41.88, lon: -87.63 }, placeName: 'Chicago, United States', timeZone: 'America/Chicago' })) && /place 41\.85, -87\.65/.test(describe({ settings: {}, place: { lat: 41.85, lon: -87.65 }, placeName: 'Chicago' })));
check('setupFromConf carries the name of a place set by hand', setupFromConf({ ...DEFAULTS, manualLocation: true, location_latitude: 41.88, location_longitude: -87.63, location_name: 'Chicago, United States' }).placeName === 'Chicago, United States' && setupFromConf({ ...DEFAULTS }).placeName === undefined);
done();
