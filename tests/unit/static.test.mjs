// Consistency between the page and the scripts: catches the typo class of bug that no test would otherwise notice
// (an element id the script looks for that does not exist, a setting read under a name that was never defined).
// Run: node tests/unit/static.test.mjs
import fs from 'fs';
import path from 'path';
import { installDomStub } from '../lib/dom-stub.mjs';
import { check, done } from '../lib/check.mjs';
installDomStub({});
const { DEFAULTS } = await import('../../js/config.js');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const html = read('index.html');
const scripts = [...walk('js').filter((f) => f.endsWith('.js') && !f.includes('vendor')), 'sw.js'];

// ---- ids ----
const idList = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const ids = new Set(idList);
const dup = idList.filter((x, i) => idList.indexOf(x) !== i);
check('every id in index.html is unique', dup.length === 0, dup.join(', '));
const made = new Set(['vrReadout', 'fitCard']);                                   // elements the scripts create themselves
const missing = [];
for (const f of scripts) {
  const src = read(f);
  for (const m of src.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)|\$\(\s*['"]([^'"]+)['"]\s*\)|bind(?:Select|Range)\(\s*['"]([^'"]+)['"]/g)) {
    const id = m[1] || m[2] || m[3];
    if (!ids.has(id) && !made.has(id)) missing.push(`${f}: #${id}`);
  }
}
check('every element id a script looks up exists in index.html', missing.length === 0, missing.join('; '));
const labels = [...html.matchAll(/\sfor="([^"]+)"/g)].map((m) => m[1]).filter((x) => !ids.has(x));
check('every label points at a control that exists', labels.length === 0, labels.join(', '));
const aria = [...html.matchAll(/aria-controls="([^"]+)"|aria-labelledby="([^"]+)"/g)].map((m) => m[1] || m[2]).filter((x) => !ids.has(x));
check('every aria-controls / aria-labelledby points at an id that exists', aria.length === 0, aria.join(', '));
const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]);
const panels = [...html.matchAll(/data-panel="([^"]+)"/g)].map((m) => m[1]);
check('every settings tab has a panel and every panel a tab', tabs.length === panels.length && tabs.every((t) => panels.includes(t)), `${tabs} / ${panels}`);

// ---- settings ----
const known = new Set([...Object.keys(DEFAULTS), 'location_latitude']);
const bad = [];
for (const f of scripts.filter((f) => f !== 'sw.js')) {
  for (const m of read(f).matchAll(/\bconf\.([A-Za-z_]\w*)/g)) if (!known.has(m[1])) bad.push(`${f}: conf.${m[1]}`);
}
check('every setting read or written as conf.x is defined in DEFAULTS', bad.length === 0, [...new Set(bad)].join('; '));
const controlsNoDefault = [...html.matchAll(/<(?:select|input)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]).filter((id) => !(id in DEFAULTS) && !['simEnabled', 'simTime', 'simSpeed', 'ledPreset', 'easing'].includes(id));
check('every settings control is a saved setting (or one of the known exceptions)', controlsNoDefault.length === 0, controlsNoDefault.join(', '));
const sels = [...html.matchAll(/<select id="([^"]+)">([\s\S]*?)<\/select>/g)];
const badDefaults = sels.filter(([, id, body]) => id in DEFAULTS && DEFAULTS[id] !== null && body.includes('<option') && !new RegExp(`value="${String(DEFAULTS[id]).replace('.', '\\.')}"`).test(body)).map(([, id]) => `${id}=${DEFAULTS[id]}`);
check('every drop-down offers its default value', badDefaults.length === 0, badDefaults.join(', '));

// ---- page hygiene ----
check('no console.log left in the scripts', scripts.every((f) => !/\bconsole\.log\(/.test(read(f).replace(/globalThis\.__confDebug\)\s*console\.log/g, ''))));
check('no leftover debugger statements', scripts.every((f) => !/\bdebugger\b/.test(read(f))));
check('index.html declares a viewport, a title and a language', /<meta name="viewport"/.test(html) && /<title>/.test(html) && /<html lang=/.test(html));
check('the settings dialog is labelled and modal', /role="dialog"[^>]*aria-modal="true"/.test(html));
done();
