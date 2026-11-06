// Size standards: what the installed app has to download, and the biggest single files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from '../lib/check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUDGET = { precacheKB: 1500, ownScriptKB: 530,   // was 525: the profile counters, the governor pin and the sky table scale (about 4 KB); was 520: the ?stats read-out (about 3 KB, fetched only when asked for); was 510: the ES 2 glass in small passes (heights, shadow, tube colours, body, weather, outline: about 5 KB, so a Pi Zero's driver can fit each); was 495: the shaders split into small programs and the once-a-frame light pass (about 6 KB); was 470: the ES 2 form of the shaders (translator, packed tables, helpers: about 20 KB) lets the Pi Zero and Pi 3 draw on their GPUs with the same files; was 450: the quality governor, the GPU-drawn glass mask and raindrops (about 20 KB) let the Pi draw at 15 to 60 fps; was 420 before: the QR code, the city list, time zones and share links v2/v3 added about 45 KB of features
   largestFileKB: 130, cssKB: 80 };

const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const list = sw.slice(sw.indexOf('const PRECACHE = ['), sw.indexOf('];', sw.indexOf('const PRECACHE')));
const files = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u)).map((u) => u.replace(/^\.\//, '').replace(/\?.*$/, '')).filter((u) => u && u !== '/');
const size = (f) => { try { return fs.statSync(path.join(root, f)).size; } catch { return 0; } };
const kb = (n) => (n / 1024).toFixed(0);

const total = files.reduce((a, f) => a + size(f), 0);
check(`the offline download list is not empty (${files.length} files)`, files.length > 20);
check(`everything the installed app downloads is under ${BUDGET.precacheKB} KB`, total / 1024 < BUDGET.precacheKB, `${kb(total)} KB`);

const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const js = walk('js').filter((f) => f.endsWith('.js'));
const own = js.filter((f) => !/vendor|virgo/.test(f)).reduce((a, f) => a + size(f), 0);
check(`the page's own scripts are under ${BUDGET.ownScriptKB} KB`, own / 1024 < BUDGET.ownScriptKB, `${kb(own)} KB`);
const big = js.filter((f) => !/vendor|virgo/.test(f)).map((f) => [f, size(f)]).sort((a, b) => b[1] - a[1])[0];
check(`no single script of ours is over ${BUDGET.largestFileKB} KB (${big[0]})`, big[1] / 1024 < BUDGET.largestFileKB, `${kb(big[1])} KB`);
check(`the stylesheet is under ${BUDGET.cssKB} KB`, size('styles.css') / 1024 < BUDGET.cssKB, `${kb(size('styles.css'))} KB`);
const png = walk('.').filter((f) => /\.(png|jpg|webp)$/.test(f) && !/node_modules|tests|\.git/.test(f)).reduce((a, f) => a + size(f), 0);
check('images and icons together stay under 600 KB', png / 1024 < 600, `${kb(png)} KB`);
done();
