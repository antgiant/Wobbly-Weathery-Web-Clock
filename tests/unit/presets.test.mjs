// Presets must only set settings that exist, be applicable through the panel's controls, and be recognised when active.
// Run: node tests/unit/presets.test.mjs
import fs from 'fs';
import path from 'path';
import { installDomStub } from '../lib/dom-stub.mjs';
import { check, done } from '../lib/check.mjs';
installDomStub({});
const { PRESETS, APPEARANCE_KEYS, matches, applyConfPatch } = await import('../../js/sky/presets.js');
const { DEFAULTS, conf } = await import('../../js/config.js');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

check('there are presets and each has a name, a note and a patch', PRESETS.length >= 5 && PRESETS.every((p) => p.id && p.name && p.note && p.patch));
check('preset ids are unique', new Set(PRESETS.map((p) => p.id)).size === PRESETS.length);
const unknown = PRESETS.flatMap((p) => Object.keys(p.patch).filter((k) => !(k in DEFAULTS)).map((k) => `${p.id}.${k}`));
check('presets only set settings that exist', unknown.length === 0, unknown.join(', '));
const noControl = APPEARANCE_KEYS.filter((k) => !ids.has(k));
check('every setting a preset or reset touches has a control in the panel (so its handler runs)', noControl.length === 0, noControl.join(', '));
const standard = PRESETS.find((p) => p.id === 'standard');
check('"Standard" is exactly the defaults for those settings', APPEARANCE_KEYS.every((k) => standard.patch[k] === DEFAULTS[k]));
check('no preset turns on something that costs a lot while claiming to save power', !('quality' in PRESETS.find((p) => p.id === 'saver').patch) || PRESETS.find((p) => p.id === 'saver').patch.quality === 'low');
const keysOf = (p) => Object.keys(p.patch).sort().join();
check('every preset sets the same settings (so applying one fully replaces another)', PRESETS.every((p) => keysOf(p) === keysOf(standard)));

// matching: the card of the preset in use is ticked
const current = { ...DEFAULTS };
check('matches(): the defaults match "Standard"', matches(standard.patch, current));
const bedside = PRESETS.find((p) => p.id === 'bedside');
check('matches(): the defaults do not match "Bedside"', !matches(bedside.patch, current));
check('matches(): numbers compare as numbers (0.75 vs "0.75")', matches({ nightDimLevel: 0.75 }, { nightDimLevel: '0.75' }));
check('matches(): changing one setting un-ticks the card', !matches(standard.patch, { ...current, glassGlow: 0.5 }));

// applying with no controls on the page only saves the settings (the stub has no elements)
applyConfPatch({ hideSeconds: true, nightDim: 'auto' });
check('applyConfPatch saves settings that have no control on the page', conf.hideSeconds === true && conf.nightDim === 'auto');
done();
