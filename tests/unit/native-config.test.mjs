// The native configuration: the web page's settings by name, a plain file, presets and share links (native/cli/config.mjs).
import { check, done } from '../lib/check.mjs';
const C = await import('../../native/cli/config.mjs');
const { SETTINGS } = await import('../../schema/settings.js');
const { PRESET_LIST } = await import('../../schema/presets.js');
const S = await import('../../js/share.js');
const D = C.DEFAULT_CONFIG;
const throws = (f) => { try { f(); return null; } catch (e) { return e.message; } };

check('the native defaults are the web page\'s', SETTINGS.every((s) => JSON.stringify(D[s.key]) === JSON.stringify(s.default)));
check('values are typed like the page: on/off, auto, options (numbers stay numbers), ranges', C.parseValue('hideSeconds', 'on') === true && C.parseValue('hideSeconds', 'No') === false && C.parseValue('twentyFourHourClock', 'auto') === null && C.parseValue('cloudMotion', '0.25') === 0.25 && C.parseValue('glassFrost', '0.5') === 0.5 && C.parseValue('clockStyle', 'GLASS') === 'glass');
check('bad values say what is wrong', /on or off/.test(throws(() => C.parseValue('hideSeconds', 'maybe'))) && /one of auto, glass/.test(throws(() => C.parseValue('clockStyle', 'x'))) && /from 0 to 1/.test(throws(() => C.parseValue('glassFrost', '2'))) && /looks like/.test(throws(() => C.parseValue('timerTarget', 'tomorrow'))));
check('a mistyped setting name suggests the real one', /did you mean clockStyle/.test(throws(() => C.parseValue('clockStyl', 'glass'))));
check('every setting accepts its own default written as text', SETTINGS.every((s) => throws(() => C.parseValue(s.key, s.type === 'tri' && s.default === null ? 'auto' : typeof s.default === 'boolean' ? (s.default ? 'on' : 'off') : String(s.default))) === null));

// the file
const cfg = { ...D, hideSeconds: true, clockStyle: 'glass', glassFrost: 0.55, twentyFourHourClock: null, timerLabel: 'New Year' };
const text = C.serialize(cfg);
check('the file lists only what differs from the defaults, one per line', text.split('\n').filter((l) => l && !l.startsWith('#')).sort().join('|') === 'clockStyle = glass|glassFrost = 0.55|hideSeconds = on|timerLabel = New Year');
const back = C.parseFile(text);
check('writing then reading gives the same configuration', JSON.stringify(back.config) === JSON.stringify(cfg) && back.errors.length === 0);
const bad = C.parseFile('# c\nhideSeconds = on  # trailing\nclockStyle = purple\nnonsense\nfoo = 1\n');
check('a file with mistakes keeps the good lines and reports each bad one with its line number', bad.config.hideSeconds === true && bad.errors.length === 3 && /^line 3:/.test(bad.errors[0]) && /^line 4: expected/.test(bad.errors[1]) && /^line 5: no such setting/.test(bad.errors[2]), bad.errors.join(' | '));
check('every setting in a full dump round-trips through the file format', (() => { const all = { ...D }; for (const s of SETTINGS) if (s.type === 'bool') all[s.key] = !s.default; const r = C.parseFile(C.serialize(all)); return JSON.stringify(r.config) === JSON.stringify(all) && !r.errors.length; })());

// presets
check('every preset applies, and gives what the web page gives', PRESET_LIST.every((p) => { const r = C.applyPreset(D, p.id); return Object.entries(p.set).every(([k, v]) => r[k] === v); }));
check('a preset resets the look first, and leaves the place, the labels and the units alone', (() => { const r = C.applyPreset({ ...D, clockStyle: 'stained', tempUnit: 'f', showLabels: true, location_latitude: 12.5 }, 'standard'); return r.clockStyle === D.clockStyle && r.tempUnit === 'f' && r.showLabels === true && r.location_latitude === 12.5; })());
check('an unknown preset lists the real ones', /try standard, bedside/.test(throws(() => C.applyPreset(D, 'nope'))));

// share links
const setup = { settings: S.normalise({ ...Object.fromEntries(S.SETTINGS_V1.map((r) => [r[0], r[2]])), hideSeconds: true, clockStyle: 'stained', brightnessNight: 0.3 }), place: { lat: 41.0214, lon: -74.5 }, kiosk: true };
for (const form of ['short', 'readable']) {
  const link = S.toLink(setup, 'https://clock.wooleys.us/', form);
  const r = C.applyLink(D, link);
  check(`a ${form} share link applies the same settings, place and sign mode`, r.hideSeconds === true && r.clockStyle === 'stained' && Math.abs(r.brightnessNight - 0.3) < 0.051 && r.kiosk === true && r.manualLocation === true && Math.abs(r.location_latitude - 41.0214) < 1e-3 && Math.abs(r.location_longitude + 74.5) < 1e-3, link);
}
check('a link given as just its query (c=...) also works, and rubbish is refused', C.applyLink(D, 'c=' + S.encodeShort(setup)).hideSeconds === true && !!throws(() => C.applyLink(D, 'https://x/?c=!!!')));
check('a link sets what links carry (even back to a default) and leaves what they never carry alone', (() => { const r = C.applyLink({ ...D, tempUnit: 'f', showLabels: true, preciseLocation: true }, S.toLink(setup, 'https://x/', 'short')); return r.tempUnit === 'auto' && r.showLabels === true && r.preciseLocation === true; })());
done();
