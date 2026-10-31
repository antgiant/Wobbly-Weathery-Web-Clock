// The change-to-suite map (tests/impact.mjs) must cover every file of the app, and only name suites that exist.
// Run: node tests/unit/impact.test.mjs
import fs from 'fs';
import path from 'path';
import { check, done } from '../lib/check.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const { suitesFor, RULES, ALL_FAST } = await import('../../tests/impact.mjs');

const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const suites = new Set(fs.readdirSync(path.join(root, 'tests/browser')).map((f) => f.replace('.test.mjs', '')));
const files = ['index.html', 'styles.css', 'sw.js', 'manifest.webmanifest', ...walk('js'), ...walk('data'), ...walk('icons')].filter((f) => fs.existsSync(path.join(root, f)));
const unmatched = files.filter((f) => !RULES.some(([re]) => re.test(f)));
check('every file of the app matches a rule (so no new file is left untested)', unmatched.length === 0, unmatched.join(', '));

const named = new Set(); for (const [, what] of RULES) if (Array.isArray(what)) what.forEach((s) => named.add(s));
const missing = [...named, ...ALL_FAST].filter((s) => !suites.has(s));
check('every suite a rule names exists', missing.length === 0, missing.join(', '));
check('every fast-tier suite exists and says it is part of the quick check', ALL_FAST.every((s) => fs.readFileSync(path.join(root, `tests/browser/${s}.test.mjs`), 'utf8').includes("export const tier = 'fast'")));
check('a browser suite that exports tier fast is in the list', [...suites].every((s) => !fs.readFileSync(path.join(root, `tests/browser/${s}.test.mjs`), 'utf8').includes("export const tier = 'fast'") || ALL_FAST.includes(s)));

const one = suitesFor(['js/wind.js']);
check('wind.js: smoke, wind and clock only', !one.all && [...one.suites].sort().join() === 'clock,smoke,wind', one.suites.join());
check('the glass shader: sky, led, digitweather (and smoke)', ['sky', 'led', 'digitweather', 'smoke'].every((s) => suitesFor(['js/sky/glsl-scene.js']).suites.includes(s)));
check('the engine is a core file: the whole quick check', suitesFor(['js/sky/engine.js']).all && ALL_FAST.every((s) => suitesFor(['js/sky/engine.js']).suites.includes(s)));
check('a README or tool change runs only the smoke page', suitesFor(['README.md', 'tools/make-icons.mjs']).suites.join() === 'smoke');
check('editing a browser suite runs that suite', suitesFor(['tests/browser/christmas.test.mjs']).suites.includes('christmas'));
check('editing the test harness runs the whole quick check', suitesFor(['tests/lib/harness.mjs']).all);
done();
