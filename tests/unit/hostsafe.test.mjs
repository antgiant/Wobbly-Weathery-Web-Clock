// The page's scripts also run in the Raspberry Pi program, which has no browser around them. A bare `addEventListener(...)` at the top of a module is called with no `this` there and
// stops the whole program ("cannot read property '_l' of undefined"): it must be `window.addEventListener(...)` (found 2026-11-11 after the automatic update code did it).
// Run: node tests/unit/hostsafe.test.mjs
import fs from 'fs';
import path from 'path';
import { check, done } from '../lib/check.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk('js').filter((f) => f.endsWith('.js') && !/vendor|virgo/.test(f));
const bad = [];
for (const f of files) {
  const lines = fs.readFileSync(path.join(root, f), 'utf8').split('\n');
  lines.forEach((l, i) => { if (/^(addEventListener|removeEventListener|dispatchEvent)\(/.test(l)) bad.push(`${f}:${i + 1}`); });
}
check(`no module calls addEventListener, removeEventListener or dispatchEvent bare at its top level (${files.length} files)`, bad.length === 0, bad.join(', '));
done();
