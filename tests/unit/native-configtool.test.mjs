// `wobbly-clock config`, the web Settings drawer in a terminal, driven by scripted answers (native/cli/configtool.mjs, main.mjs). Run: node tests/unit/native-configtool.test.mjs
import { check, done } from '../lib/check.mjs';
const M = await import('../../native/cli/main.mjs');
const H = await import('../../native/cli/hardware.mjs');
const C = await import('../../native/cli/config.mjs');
const { TABS } = await import('../../native/cli/configtool.mjs');
const { SETTINGS } = await import('../../schema/settings.js');

const CONF = '/etc/wobbly-clock/wobbly-clock.conf';
function world(answers, { profile = 'pi-4', files = {}, fetch = null } = {}) {
  const w = { files, asked: [], said: [], calls: [] };
  w.io = {
    read: (f) => (f in files ? files[f] : null), write: (f, t) => { files[f] = t; },
    profile: (output) => ({ ...H.PROFILES[profile], output, sensors: false }),
    exec(cmd, args) { w.calls.push([cmd, ...args]); return 0; }, capture: () => ({ code: 0, out: '' }),
    ask: async (q) => { w.asked.push(q); return answers.length ? answers.shift() : null; },
    say: (...a) => w.said.push(...a),
    fetchJson: fetch,
  };
  return w;
}
const go = (w) => M.run(['config'], w.io);
const text = (w) => w.said.join('\n');
const conf = (w) => C.parseFile(w.files[CONF] || '').config;
// menu numbers: tabs 1..7 (presets clock scene weather extras place panel), 8 advanced, 9 save, 10 quit
const T = { presets: '1', clock: '2', scene: '3', weather: '4', extras: '5', place: '6', panel: '7' }, ADV = '8', SAVE = '9', QUIT = '10';
const keysIn = (tab, adv = false) => SETTINGS.filter((s) => s.tab === tab && (adv || !s.advanced)).map((s) => s.key);

check('the tool walks the same tabs as the web drawer, in the same order, Presets first, plus the output and panel', TABS.slice(0, 6).map((t) => t[0]).join() === 'presets,clock,scene,weather,extras,place' && TABS[6][0] === 'panel');

// a bool: hideSeconds in the Clock tab, turned on, saved, restart answered yes
let w = world([T.clock, String(keysIn('clock').indexOf('hideSeconds') + 1), '1', 'b', SAVE, 'y']);
let r = await go(w);
check('changing a setting and saving writes the conf file', r.code === 0 && /hideSeconds = on/.test(w.files[CONF]) && /Saved/.test(text(w)), text(w).slice(-300));
check('and offers to restart the clock, which does it on a yes', w.calls.some((c) => c.join(' ') === 'systemctl restart wobbly-clock') && /Restarted/.test(text(w)));
check('every question has its menu printed as it is asked (lines come out one at a time, not at the end)', text(w).includes('1) Presets') && text(w).includes('Clock') && r.out === '');

// quitting without saving writes nothing
w = world([T.clock, String(keysIn('clock').indexOf('hideSeconds') + 1), '1', 'b', QUIT, 'n']); r = await go(w);
check('quitting without saving changes nothing in the file (and asks first when there were changes)', !(CONF in w.files) && /Nothing saved/.test(text(w)) && w.asked.some((q) => /Save the 1 change first/.test(q)));
w = world(['q']); r = await go(w);
check('q at the first menu with nothing changed just ends', r.code === 0 && !(CONF in w.files));

// an enum, a number, a reset to default
const files = { [CONF]: 'hideSeconds = on\nbrightnessNight = 0.4\nweatherMode = rain\n' };
w = world([T.weather, String(keysIn('weather').indexOf('weatherMode') + 1), String(C.spec('weatherMode').options.length + 1), 'b', SAVE, 'n'], { files }); r = await go(w);
check('"reset to the default" drops the setting from the file (the file is the only source: it is then at its default after the next start)', !/weatherMode/.test(w.files[CONF]) && /hideSeconds = on/.test(w.files[CONF]) && /brightnessNight = 0.4/.test(w.files[CONF]));
check('answering no to the restart says it will use them next start', /next time it starts/.test(text(w)) && w.calls.length === 0);

w = world([T.weather, String(keysIn('weather').indexOf('weatherMode') + 1), String(C.spec('weatherMode').options.indexOf('hail') + 1), 'b', SAVE, 'n']); await go(w);
check('an option picked from the list is saved by name (weatherMode = hail)', /weatherMode = hail/.test(w.files[CONF]));

// advanced settings are hidden until asked for
{
  const adv = SETTINGS.find((s) => s.tab === 'clock' && s.advanced), simple = SETTINGS.find((s) => s.tab === 'clock' && !s.advanced);
  w = world([T.clock, 'b', 'q', 'n']); await go(w);
  check('the Clock tab lists the simple settings and not the advanced ones', text(w).includes(simple.label) && !text(w).includes(adv.label));
  w = world([ADV, T.clock, 'b', 'q', 'n']); await go(w);
  check('after the Advanced switch it lists them too, and the switch says what it shows', text(w).includes(adv.label) && text(w).includes('Advanced settings: hidden') && text(w).includes('(advanced settings shown)'));
}
{
  const key = SETTINGS.find((s) => s.type === 'number' && !s.advanced && s.tab !== 'place');
  const idx = keysIn(key.tab).indexOf(key.key) + 1, tab = String(TABS.findIndex((t) => t[0] === key.tab) + 1);
  w = world([tab, String(idx), String(key.max * 100 + 7), String(idx), String(key.max), 'b', SAVE, 'n']); await go(w);
  check(`a number out of range is refused with the reason, then a good one is saved (${key.key})`, /is a number from/.test(text(w)) && new RegExp(`${key.key} = ${key.max}`).test(w.files[CONF] || ''), text(w).slice(-400));
}

// a preset
w = world([T.presets, '2', 'y', SAVE, 'n']); await go(w);
check('choosing a preset applies it (after a yes) and it is saved', /Applied/.test(text(w)) && Object.keys(conf(w)).length > 0 && (w.files[CONF] || '').split('\n').length > 2, w.files[CONF]);
w = world([T.presets, '2', 'n', SAVE]); await go(w);
check('a preset answered no changes nothing', !(CONF in w.files));

// the machine cannot do it: the same gate as `set`
w = world([ADV, T.scene, 'b', 'q', 'n'], { profile: 'pi-zero' }); await go(w);
check('settings the machine cannot do are marked as such in the list (a Pi Zero, advanced shown)', /not on this machine: .*needs/.test(text(w)), text(w).slice(0, 200));
{
  const gated = SETTINGS.find((s) => s.requires && s.tab !== 'place' && (() => { try { C.setValue(C.DEFAULT_CONFIG, s.key, s.type === 'bool' ? 'on' : String(s.options ? s.options[1] : 1), H.PROFILES['pi-zero']); return false; } catch (e) { return /needs/.test(e.message); } })());
  if (gated) {
    const tab = String(TABS.findIndex((t) => t[0] === gated.tab) + 1), idx = SETTINGS.filter((s) => s.tab === gated.tab).map((s) => s.key).indexOf(gated.key) + 1;
    w = world([ADV, tab, String(idx), gated.type === 'bool' ? '1' : '2', 'b', 'b', QUIT, 'n'], { profile: 'pi-zero' }); await go(w);
    check(`a Pi Zero is refused ${gated.key} with the reason, and the value stays`, /needs/.test(text(w)) && !(CONF in w.files), text(w).slice(-300));
  } else check('(no gated setting found to try)', true);
}

// the place: by name (a fake geocoder), by the network address (only after a yes), by the numbers
const geo = async (url) => {
  if (/geocoding-api/.test(url)) return { results: [{ name: 'Chicago', admin1: 'Illinois', country: 'United States', latitude: 41.85003, longitude: -87.65005, timezone: 'America/Chicago' }, { name: 'Chicago Heights', admin1: 'Illinois', country: 'United States', latitude: 41.5, longitude: -87.6, timezone: 'America/Chicago' }] };
  if (/geojs/.test(url)) return { latitude: '51.51', longitude: '-0.13', city: 'London', timezone: 'Europe/London' };
  throw new Error('unexpected ' + url);
};
w = world([T.place, '1', 'Chicago', '1', '6', SAVE, 'n'], { fetch: geo }); await go(w);
check('place by name: searches, lists the matches, sets latitude, longitude and the time zone', /location_latitude = 41.85/.test(w.files[CONF]) && /location_longitude = -87.65/.test(w.files[CONF]) && /timeZone = America\/Chicago/.test(w.files[CONF]) && /sends the name you typed/.test(text(w)), w.files[CONF]);
let asked = []; w = world([T.place, '2', 'n', '6', QUIT, 'n'], { fetch: async (u) => { asked.push(u); return geo(u); } }); await go(w);
check('place by the network address: nothing is asked of the service without a yes', asked.length === 0 && /Not asked/.test(text(w)) && !(CONF in w.files));
asked = []; w = world([T.place, '2', 'y', 'y', '6', SAVE, 'n'], { fetch: async (u) => { asked.push(u); return geo(u); } }); await go(w);
check('with a yes it asks once, shows the estimate as rough, and (after another yes) sets place and zone', asked.length === 1 && /rough/.test(text(w)) && /location_latitude = 51.51/.test(w.files[CONF]) && /timeZone = Europe\/London/.test(w.files[CONF]), w.files[CONF]);
w = world([T.place, '3', '48.86', '2.35', '6', SAVE, 'n']); await go(w);
check('place by the numbers', /location_latitude = 48.86/.test(w.files[CONF]) && /location_longitude = 2.35/.test(w.files[CONF]));
w = world([T.place, '3', '95', '2.35', '6', QUIT, 'n']); await go(w);
check('a latitude out of range is refused, nothing set', /number from -90 to 90/.test(text(w)) && !(CONF in w.files));
w = world([T.place, '1', 'Nowhere', '6', QUIT, 'n'], { fetch: async () => ({ results: [] }) }); await go(w);
check('a search with no match says so', /Nothing found/.test(text(w)));
w = world([T.place, '1', 'x', '6', QUIT, 'n'], { fetch: async () => { throw new Error('curl: no route'); } }); await go(w);
check('a failed lookup says why and leaves things as they were', /The search failed: curl: no route/.test(text(w)) && !(CONF in w.files));

// no terminal: a clear message
w = world([]); w.io.ask = null; r = await go(w);
check('without a terminal it says so (exit 2)', r.code === 2 && /terminal/.test(r.err));
// a closed input (ctrl-D) ends cleanly
w = world([]); r = await go(w);
check('a closed input ends the tool without saving or looping', r.code === 0 && !(CONF in w.files));
done();
