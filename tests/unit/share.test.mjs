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
done();
