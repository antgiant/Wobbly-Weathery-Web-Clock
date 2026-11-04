// The native program's configuration: the web page's setting names, values and defaults (schema/settings.js), a plain `key = value` file,
// presets and share links. Pure functions (no file or screen access) so they are tested without a Pi.
import { SETTINGS, SETTING_DEFAULTS } from '../../schema/settings.js';
import { PRESET_LIST } from '../../schema/presets.js';
import { fromSearch } from '../../js/share.js';
import { gate } from './hardware.mjs';

// Settings the native program has that the web page keeps elsewhere: the place, the output, and sign (kiosk) mode.
export const EXTRA = {
  location_latitude: { type: 'number', default: 0, min: -90, max: 90, step: 0.0001, label: 'Latitude' },
  location_longitude: { type: 'number', default: 0, min: -180, max: 180, step: 0.0001, label: 'Longitude' },
  kiosk: { type: 'bool', default: false, label: 'Sign mode' },
  output: { type: 'enum', default: 'hdmi', options: ['hdmi', 'matrix'], label: 'Output' },
  matrixConfig: { type: 'text', default: '', max: 120, label: 'Panel layout file (matrix.cfg)' },
  renderScale: { type: 'number', default: 0, min: 0, max: 8, step: 1, label: 'Draw HDMI this many times smaller (0 = automatic: smaller when a frame takes too long)' },
  gamma: { type: 'number', default: 2.2, min: 1, max: 3, step: 0.1, label: 'Gamma for LED panels' },
  ledGpioMapping: { type: 'enum', default: 'regular', options: ['regular', 'adafruit-hat', 'adafruit-hat-pwm'], label: 'How the panels are wired to the Pi (led-gpio-mapping)' },
  ledSlowdownGpio: { type: 'number', default: 1, min: 0, max: 4, step: 1, label: 'GPIO slowdown (led-slowdown-gpio): 1 to 4 on a Pi 3 and later' },
  ledPwmBits: { type: 'number', default: 11, min: 1, max: 11, step: 1, label: 'Colour depth in bits (led-pwm-bits)' },
  ledPwmLsbNanoseconds: { type: 'number', default: 130, min: 50, max: 3000, step: 10, label: 'Shortest pulse in nanoseconds (led-pwm-lsb-nanoseconds)' },
  ledRgbSequence: { type: 'text', default: 'RGB', max: 3, label: 'Colour order of the panel (led-rgb-sequence)' },
  ledPanelType: { type: 'text', default: '', max: 12, label: 'Panel chip (led-panel-type), for example FM6126A' },
  ledMultiplexing: { type: 'number', default: 0, min: 0, max: 17, step: 1, label: 'Row multiplexing (led-multiplexing)' },
  ledRowAddrType: { type: 'number', default: 0, min: 0, max: 5, step: 1, label: 'Row address type (led-row-addr-type)' },
};
export const DEFAULT_CONFIG = { ...SETTING_DEFAULTS, ...Object.fromEntries(Object.entries(EXTRA).map(([k, v]) => [k, v.default])) };
export const spec = (key) => SETTINGS.find((s) => s.key === key) || (EXTRA[key] && { key, ...EXTRA[key] });
const nearest = (list, word) => list.filter((k) => k.toLowerCase().includes(word.toLowerCase())).slice(0, 4);

/** "on"/"off", numbers and option names as typed -> the stored value; throws a sentence saying what is wrong. */
export function parseValue(key, text) {
  const s = spec(key);
  if (!s) { const near = nearest([...SETTINGS.map((x) => x.key), ...Object.keys(EXTRA)], key); throw new Error(`no such setting "${key}"${near.length ? ` (did you mean ${near.join(', ')}?)` : ''}`); }
  const t = String(text).trim();
  switch (s.type) {
    case 'bool': if (/^(on|true|yes|1)$/i.test(t)) return true; if (/^(off|false|no|0)$/i.test(t)) return false; throw new Error(`${key} is on or off, not "${t}"`);
    case 'tri': if (/^(auto|null|default)$/i.test(t)) return null; if (/^(on|true|yes|1)$/i.test(t)) return true; if (/^(off|false|no|0)$/i.test(t)) return false; throw new Error(`${key} is auto, on or off, not "${t}"`);
    case 'enum': { const hit = s.options.find((o) => String(o).toLowerCase() === t.toLowerCase()); if (hit === undefined) throw new Error(`${key} is one of ${s.options.join(', ')}, not "${t}"`); return typeof s.default === 'number' ? Number(hit) : hit; }
    case 'number': { const n = Number(t); if (!Number.isFinite(n) || n < s.min - 1e-9 || n > s.max + 1e-9) throw new Error(`${key} is a number from ${s.min} to ${s.max}, not "${t}"`); return n; }
    case 'text': if (t.length > s.max) throw new Error(`${key} is at most ${s.max} characters`); return t;
    case 'datetime': if (t !== '' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) throw new Error(`${key} looks like 2026-12-25T08:00`); return t;
  }
  throw new Error(`unknown type for ${key}`);
}

/** Set one setting. Throws the reason when the machine cannot do it. Returns a new config. */
export function setValue(config, key, text, profile) {
  const value = parseValue(key, text);
  if (profile) { const g = gate(key, value, profile); if (!g.ok) throw new Error(g.reason); }
  return { ...config, [key]: value };
}

export const presetIds = () => PRESET_LIST.map((p) => p.id);
export function applyPreset(config, id) {
  const p = PRESET_LIST.find((x) => x.id === id);
  if (!p) throw new Error(`no such preset "${id}" (try ${presetIds().join(', ')})`);
  const base = { ...config };
  for (const s of SETTINGS) if (s.preset) base[s.key] = s.default;
  return { ...base, ...p.set };
}

/** A share link (short ?c=... or readable) or just its query: the setup it describes, applied to the config. Never saves anything itself. */
export function applyLink(config, link) {
  const q = String(link).includes('?') ? String(link).slice(String(link).indexOf('?')) : (String(link).startsWith('c=') ? `?${link}` : link);
  const setup = fromSearch(q);
  if (!setup) throw new Error('that is not a link this version understands');
  const out = { ...config, ...setup.settings, kiosk: !!setup.kiosk };
  if (setup.timeZone) out.timeZone = setup.timeZone;                 // a link made for a sign in another city carries that city's time zone
  if (setup.place) { out.manualLocation = true; out.location_latitude = setup.place.lat; out.location_longitude = setup.place.lon; }
  return out;
}

// ---- the file: `key = value`, '#' comments, only what differs from the defaults is written ----
const show = (v) => (v === null ? 'auto' : typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));
export function serialize(config, header = '# wobbly-clock settings: the same names and values as the web page (see wobbly-clock.conf(5)).') {
  const lines = [header];
  for (const k of Object.keys(DEFAULT_CONFIG)) if (k in config && JSON.stringify(config[k]) !== JSON.stringify(DEFAULT_CONFIG[k])) lines.push(`${k} = ${show(config[k])}`);
  return lines.join('\n') + '\n';
}
export function parseFile(text) {
  let config = { ...DEFAULT_CONFIG };
  const errors = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) return;
    const m = /^([A-Za-z_][\w]*)\s*=\s*(.*)$/.exec(line);
    if (!m) { errors.push(`line ${i + 1}: expected "key = value"`); return; }
    try { config[m[1]] = parseValue(m[1], m[2]); } catch (e) { errors.push(`line ${i + 1}: ${e.message}`); }
  });
  return { config, errors };
}
export const diff = (config) => Object.keys(DEFAULT_CONFIG).filter((k) => k in config && JSON.stringify(config[k]) !== JSON.stringify(DEFAULT_CONFIG[k])).map((k) => [k, config[k]]);
export const showValue = show;
