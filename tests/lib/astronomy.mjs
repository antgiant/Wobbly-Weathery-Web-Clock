// Loads the vendored astronomy-engine (a UMD browser build) into node as globalThis.Astronomy, as the page has it.
// (require() cannot be used: package.json says "type": "module", which makes node treat every .js file as an ES module.)
import fs from 'fs';
import path from 'path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
if (!globalThis.Astronomy) {
  const src = fs.readFileSync(path.join(root, 'js/vendor/astronomy.browser.min.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  globalThis.Astronomy = mod.exports;
}
export default globalThis.Astronomy;
