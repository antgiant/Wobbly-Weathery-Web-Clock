// Checks the installable-app pieces: the manifest, the icons, and that the service worker stores every file the page uses.
// Run: node tests/unit/pwa.mjs
import fs from 'fs';
import path from 'path';
let fails = 0;
const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + ' ' + x); if (!ok) fails++; };
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const m = JSON.parse(read('manifest.webmanifest'));
check('manifest has a name, short name and start url', m.name && m.short_name && m.start_url === './');
check('display is standalone', m.display === 'standalone');
check('theme and background colours set', /^#/.test(m.theme_color) && /^#/.test(m.background_color));
const pngSize = (f) => { const b = fs.readFileSync(path.join(root, f)); return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20); };
for (const i of m.icons) check(`icon ${i.src} exists and is ${i.sizes}`, fs.existsSync(path.join(root, i.src)) && pngSize(i.src) === i.sizes, fs.existsSync(path.join(root, i.src)) ? pngSize(i.src) : 'missing');
check('has a 192 and a 512 icon, and a maskable one', ['192x192', '512x512'].every((s) => m.icons.some((i) => i.sizes === s)) && m.icons.some((i) => i.purpose === 'maskable'));
const html = read('index.html');
check('index.html links the manifest', /rel="manifest" href="manifest.webmanifest"/.test(html));
check('index.html has an apple touch icon', /rel="apple-touch-icon" href="icons\/apple-touch-icon.png"/.test(html) && pngSize('icons/apple-touch-icon.png') === '180x180');
check('iOS standalone meta set', /apple-mobile-web-app-capable/.test(html));

// every script and data file the page can load is in the service worker's list
const sw = read('sw.js');
const listed = new Set([...sw.matchAll(/'([^']+)'/g)].map((x) => x[1]));
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = [...walk('js'), ...walk('data')].filter((f) => /\.(js|bin|png|jpg)$/.test(f));
const missing = files.filter((f) => !listed.has(f));
check('service worker precaches every script and data file', missing.length === 0, missing.join(', '));
const stale = [...listed].filter((f) => /^(js|data|icons)\//.test(f) && !fs.existsSync(path.join(root, f)));
check('service worker lists no file that does not exist', stale.length === 0, stale.join(', '));
check('index.html preloads every sky module', walk('js/sky').filter((f) => f.endsWith('.js')).every((f) => html.includes(`href="${f}"`)));
// every relative import resolves
let bad = [];
for (const f of walk('js').filter((f) => f.endsWith('.js') && !f.includes('vendor'))) {
  for (const x of read(f).matchAll(/from\s+'(\.[^']+)'|import\s+'(\.[^']+)'/g)) {
    const t = path.join(path.dirname(f), x[1] || x[2]);
    if (!fs.existsSync(path.join(root, t))) bad.push(`${f} -> ${t}`);
  }
}
check('every import resolves to a file', bad.length === 0, bad.join('; '));
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
