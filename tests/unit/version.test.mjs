// The version stamp (js/version.js) must describe the files as they are now, and the pieces that use it must be wired up.
// If this fails, run: npm run stamp   Run: node tests/unit/version.test.mjs
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { check, done } from '../lib/check.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const { hashOfApp, readVersion, appFiles } = await import('../../tools/stamp.mjs');
const v = readVersion();

check('js/version.js has a number, a hash and a date', v.number >= 1 && /^[0-9a-f]{8}$/.test(v.hash) && /^\d{4}-\d{2}-\d{2}$/.test(v.built), JSON.stringify(v));
check('the stamp is current: its hash is the hash of the files as they are now (run npm run stamp if not)', v.hash === hashOfApp(), `${v.hash} vs ${hashOfApp()}`);
check('the hash covers the app: scripts, styles, page, data and the service worker, but not version.js itself', appFiles().includes('sw.js') && appFiles().includes('index.html') && appFiles().includes('js/clock.js') && appFiles().includes('data/stars.bin') && !appFiles().includes('js/version.js'));
const a = hashOfApp();
check('the hash is stable (the same files give the same hash)', a === hashOfApp());

// changing any file changes the hash, and putting it back restores it
const probe = path.join(root, 'styles.css'), orig = fs.readFileSync(probe);
fs.appendFileSync(probe, '\n/* probe */');
const changed = hashOfApp();
fs.writeFileSync(probe, orig);
check('any change to a file changes the hash; restoring it restores the hash', changed !== a && hashOfApp() === a);

const out = execFileSync(process.execPath, [path.join(root, 'tools/stamp.mjs'), '--check'], { encoding: 'utf8' });
check('"node tools/stamp.mjs --check" passes when current', /is current/.test(out));

const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
check('the service worker loads the stamp and names its cache after it (a new version starts a clean cache)', /importScripts\('js\/version\.js'\)/.test(sw) && /const CACHE = 'wwwc-' \+ VERSION/.test(sw) && /APP_VERSION\.number/.test(sw) && /APP_VERSION\.hash/.test(sw));
check('the service worker saves version.js with the rest', /'js\/version\.js'/.test(sw));
check('the page loads the stamp before the app, as a plain script', /<script src="js\/version\.js"><\/script>/.test(html) && html.indexOf('js/version.js') < html.indexOf('js/index.js'));
check('Settings -> Presets has an About block with the version line', /id="versionLine"/.test(html) && /<h3>About<\/h3>/.test(html));
done();
