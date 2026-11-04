// The settings schema (schema/settings.js, schema/presets.js): well formed, every default and preset value valid, the generated JSON
// current, and compatible with the frozen share-link table. (Every control in the page is checked against it in the browser:
// tests/browser/options.test.mjs.) Run: node tests/unit/schema.test.mjs
import fs from 'fs';
import path from 'path';
import { check, done } from '../lib/check.mjs';
import { installDomStub } from '../lib/dom-stub.mjs';
installDomStub({});
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const { SETTINGS, SETTING_DEFAULTS, PRESET_KEYS } = await import('../../schema/settings.js');
const { PRESET_LIST } = await import('../../schema/presets.js');
const { SETTINGS_V1 } = await import('../../js/share.js');
const { DEFAULTS } = await import('../../js/config.js');
const { render } = await import('../../tools/schema-json.mjs');

const TYPES = ['bool', 'tri', 'enum', 'number', 'text', 'datetime'], TABS = ['presets', 'clock', 'scene', 'weather', 'extras', 'place'];
check('every setting has a unique key, a known type, a tab, a label and a default', new Set(SETTINGS.map((s) => s.key)).size === SETTINGS.length && SETTINGS.every((s) => s.key && TYPES.includes(s.type) && TABS.includes(s.tab) && s.label && 'default' in s && typeof s.advanced === 'boolean'), SETTINGS.filter((s) => !(TYPES.includes(s.type) && TABS.includes(s.tab) && s.label)).map((s) => s.key).join());
const valid = (s, v) => {
  switch (s.type) {
    case 'bool': return typeof v === 'boolean';
    case 'tri': return v === null || typeof v === 'boolean';
    case 'enum': return s.options.some((o) => String(o) === String(v));
    case 'number': { const q = (v - s.min) / s.step; return Number.isFinite(v) && v >= s.min - 1e-9 && v <= s.max + 1e-9 && Math.abs(q - Math.round(q)) < 1e-6; }
    case 'text': return typeof v === 'string' && v.length <= s.max;
    case 'datetime': return v === '' || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v);
  }
  return false;
};
check('every default is a valid value for its own type, options and range', SETTINGS.every((s) => valid(s, s.default)), SETTINGS.filter((s) => !valid(s, s.default)).map((s) => `${s.key}=${JSON.stringify(s.default)}`).join(', '));
check('enums list at least two options with no repeats; numbers have min < max and a step', SETTINGS.every((s) => (s.type !== 'enum' || (s.options.length >= 2 && new Set(s.options).size === s.options.length)) && (s.type !== 'number' || (s.min < s.max && s.step > 0))));
check('the page\'s defaults are the schema\'s (config.js reads them from it)', SETTINGS.every((s) => JSON.stringify(DEFAULTS[s.key]) === JSON.stringify(s.default)) && JSON.stringify(SETTING_DEFAULTS) === JSON.stringify(Object.fromEntries(SETTINGS.map((s) => [s.key, s.default]))));

// presets
check('presets have unique ids, names and notes, and the first is Standard (no differences)', new Set(PRESET_LIST.map((p) => p.id)).size === PRESET_LIST.length && PRESET_LIST.every((p) => p.id && p.name && p.note) && PRESET_LIST[0].id === 'standard' && Object.keys(PRESET_LIST[0].set).length === 0);
check('a preset only sets settings the presets and Reset own (marked `preset`), with valid values', PRESET_LIST.every((p) => Object.entries(p.set).every(([k, v]) => PRESET_KEYS.includes(k) && valid(SETTINGS.find((s) => s.key === k), v))), PRESET_LIST.flatMap((p) => Object.entries(p.set).filter(([k, v]) => !PRESET_KEYS.includes(k) || !valid(SETTINGS.find((s) => s.key === k) || { type: 'x' }, v)).map(([k]) => `${p.id}.${k}`)).join());
check('the settings no preset may touch (labels, what the countdown counts down to, units, 24-hour time, location) are not marked `preset`', ['showLabels', 'countdownKind', 'tempUnit', 'twentyFourHourClock', 'manualLocation', 'preciseLocation'].every((k) => !PRESET_KEYS.includes(k)));

// the generated JSON for the native version
check('schema/settings.json is current (run npm run schema if not)', fs.readFileSync(path.join(root, 'schema/settings.json'), 'utf8') === render());
const json = JSON.parse(fs.readFileSync(path.join(root, 'schema/settings.json'), 'utf8'));
check('the JSON has every setting and preset, as plain data', json.settings.length === SETTINGS.length && json.presets.length === PRESET_LIST.length && json.presets.every((p, i) => p.id === PRESET_LIST[i].id));

// share links: the frozen version-1 table must stay compatible with the live schema
const KIND = { b: 'bool', tri: 'tri', e: 'enum', n: 'number', t: 'text', d: 'datetime' };
const bad = [];
for (const r of SETTINGS_V1) {
  const s = SETTINGS.find((x) => x.key === r[0]);
  if (!s) { bad.push(`${r[0]}: gone from the schema`); continue; }
  if (KIND[r[1]] !== s.type) bad.push(`${r[0]}: type ${KIND[r[1]]} -> ${s.type}`);
  if (!s.shareable) bad.push(`${r[0]}: no longer shareable`);
  if (r[1] === 'e' && !r[3].every((o, i) => String(s.options[i]) === String(o))) bad.push(`${r[0]}: the first options changed (only appending is allowed)`);
  if (r[1] === 'n' && !(s.min <= r[3] && s.max >= r[4] && Math.abs(s.step - r[5]) < 1e-9)) bad.push(`${r[0]}: range or step changed`);
}
check('the frozen share-link table (version 1) is still compatible with the schema: same keys and types, options only appended, ranges not narrowed', bad.length === 0, bad.join('; '));
check('every shareable setting is in the share table, or a new version of it is needed (add it to a version 2 of js/share.js)', SETTINGS.filter((s) => s.shareable).every((s) => SETTINGS_V1.some((r) => r[0] === s.key)), SETTINGS.filter((s) => s.shareable && !SETTINGS_V1.some((r) => r[0] === s.key)).map((s) => s.key).join());
done();
