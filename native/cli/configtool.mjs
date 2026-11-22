// `wobbly-clock config`: the web Settings drawer in a terminal. It walks the same tabs (Presets first), shows each setting's value, changes it with the keys, resets it to its
// default, and writes the conf file, the one source of the clock's settings (a setting set back to its default is dropped from the file, so it is at its default after the next
// start). The list of settings, their types, options, ranges and which machines can do them all come from the schema and `gate`, so this and the web drawer cannot drift apart.
// Everything outside is passed in (`io`: ask, say, exec, fetchJson), so it is tested with scripted answers.
import { SETTINGS } from '../../schema/settings.js';
import { PRESET_LIST } from '../../schema/presets.js';
import { DEFAULT_CONFIG, EXTRA, spec, parseValue, setValue, applyPreset, showValue } from './config.mjs';
import { gate } from './hardware.mjs';

export const TABS = [['presets', 'Presets'], ['clock', 'Clock'], ['scene', 'Scene'], ['weather', 'Weather'], ['extras', 'Extras'], ['place', 'Place'], ['panel', 'Output and panel']];
const PANEL_KEYS = Object.keys(EXTRA).filter((k) => !/^location_/.test(k));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isDefault = (config, k) => same(config[k], DEFAULT_CONFIG[k]);

const keysOf = (tab, advanced) => (tab === 'panel' ? PANEL_KEYS : tab === 'place' ? ['location_latitude', 'location_longitude', ...SETTINGS.filter((s) => s.tab === 'place').map((s) => s.key)] : SETTINGS.filter((s) => s.tab === tab && (advanced || !s.advanced)).map((s) => s.key));
const labelOf = (k) => (spec(k) && spec(k).label) || k;

/** A line asking what to do; returns what was typed, trimmed. A closed input (nothing more to read) is 'q'. */
async function line(io, q) { const a = await io.ask(q); return a == null ? 'q' : String(a).trim(); }

async function pick(io, say, question, options, def = null) {
  say(question); options.forEach((o, i) => say(`  ${i + 1}) ${o}`));
  for (let tries = 0; tries < 3; tries++) {
    const a = await line(io, def == null ? '> ' : `[${def + 1}] `);
    if (a === '' && def != null) return def;
    if (a === 'b' || a === 'q') return -1;
    const n = Number(a) - 1; if (Number.isInteger(n) && n >= 0 && n < options.length) return n;
    say(`  Please answer 1 to ${options.length}, or b to go back.`);
  }
  return -1;
}

/** Ask for a new value of one setting. Returns the new config (unchanged when the answer is back, or the machine cannot do it). */
async function editSetting(io, say, config, key, profile) {
  const s = spec(key), cur = config[key], def = DEFAULT_CONFIG[key];
  say('', `${labelOf(key)} (${key}), now ${showValue(cur)}${isDefault(config, key) ? ' (the default)' : `, default ${showValue(def)}`}`);
  if (s.doc) say(`  ${s.doc}`);
  let text = null;
  const resetWord = `reset to the default (${showValue(def)})`;
  if (s.type === 'bool' || s.type === 'tri') {
    const opts = s.type === 'tri' ? ['auto', 'on', 'off'] : ['on', 'off'];
    const i = await pick(io, say, 'Choose:', [...opts, resetWord]); if (i < 0) return config;
    text = i === opts.length ? showValue(def) : opts[i];
  } else if (s.type === 'enum') {
    const i = await pick(io, say, 'Choose:', [...s.options.map(String), resetWord]); if (i < 0) return config;
    text = i === s.options.length ? showValue(def) : String(s.options[i]);
  } else {
    const hint = s.type === 'number' ? `a number from ${s.min} to ${s.max}` : s.type === 'datetime' ? 'like 2026-12-25T08:00, or - for none' : `text${s.max ? ` of up to ${s.max} characters` : ''}`;
    const a = await line(io, `New value (${hint}; d = default, b = back): `);
    if (a === 'b' || a === 'q' || a === '') return config;
    text = a === 'd' ? showValue(def) : a === '-' ? '' : a;
  }
  try { const next = setValue(config, key, text, profile); say(`${key} = ${showValue(next[key])}`); return next; }
  catch (err) { say(`  ${err.message}`); return config; }
}

/** Where is the clock: by name, by the network address (asks first), or the numbers. Returns the new config. */
async function editPlace(io, say, config, profile) {
  for (;;) {
    say('', `Place: latitude ${showValue(config.location_latitude)}, longitude ${showValue(config.location_longitude)}, time zone ${config.timeZone || '(the Pi\'s own)'}`);
    const i = await pick(io, say, 'What do you want to do?', ['Search for a place by name', 'Estimate it from this Pi\'s network address', 'Type the latitude and longitude', 'Set the time zone', 'Other place settings', 'Back']);
    if (i < 0 || i === 5) return config;
    if (i === 0) {
      const q = await line(io, 'Place name (a city, for example "Chicago"): ');
      if (!q || q === 'b' || q === 'q') continue;
      if (!io.fetchJson) { say('  This machine cannot look places up.'); continue; }
      say('  (This sends the name you typed to open-meteo.com.)');
      let res = null; try { res = await io.fetchJson(`https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=${encodeURIComponent(q)}`); } catch (e) { say(`  The search failed: ${e.message}`); continue; }
      const found = (res && res.results) || [];
      if (!found.length) { say('  Nothing found. Try another name.'); continue; }
      const j = await pick(io, say, 'Which one?', found.map((r) => `${r.name}${r.admin1 ? ', ' + r.admin1 : ''}, ${r.country || ''} (${r.latitude.toFixed(2)}, ${r.longitude.toFixed(2)}${r.timezone ? ', ' + r.timezone : ''})`));
      if (j < 0) continue;
      const r = found[j];
      config = { ...config, location_latitude: Math.round(r.latitude * 1e4) / 1e4, location_longitude: Math.round(r.longitude * 1e4) / 1e4, manualLocation: true, ...(r.timezone ? { timeZone: r.timezone } : {}) };
      say(`  Set to ${r.name}.`);
    } else if (i === 1) {
      say('  This asks get.geojs.io where this Pi\'s public network address is. Nothing is sent without your yes, and the address is only used for this one question.');
      if (!/^y/i.test(await line(io, '  Allow it? (y/N) '))) { say('  Not asked.'); continue; }
      if (!io.fetchJson) { say('  This machine cannot look places up.'); continue; }
      let r = null; try { r = await io.fetchJson('https://get.geojs.io/v1/ip/geo.json'); } catch (e) { say(`  The estimate failed: ${e.message}`); continue; }
      const la = Number(r && r.latitude), lo = Number(r && r.longitude);
      if (!Number.isFinite(la) || !Number.isFinite(lo)) { say('  No estimate came back.'); continue; }
      say(`  Estimated: ${r.city || 'your area'} (${la.toFixed(2)}, ${lo.toFixed(2)}${r.timezone ? ', ' + r.timezone : ''}). It is rough: the address of your provider, not of your house.`);
      if (!/^y/i.test(await line(io, '  Use it? (Y/n) ').then((a) => (a === '' ? 'y' : a)))) continue;
      config = { ...config, location_latitude: Math.round(la * 100) / 100, location_longitude: Math.round(lo * 100) / 100, manualLocation: true, ...(r.timezone ? { timeZone: r.timezone } : {}) };
    } else if (i === 2) {
      const la = await line(io, 'Latitude (-90 to 90, north is positive): '), lo = await line(io, 'Longitude (-180 to 180, east is positive): ');
      try { config = { ...config, location_latitude: parseValue('location_latitude', la), location_longitude: parseValue('location_longitude', lo), manualLocation: true }; } catch (e) { say(`  ${e.message}`); }
    } else if (i === 3) config = await editSetting(io, say, config, 'timeZone', profile);
    else config = await editTab(io, say, config, 'place', false, profile, ['location_latitude', 'location_longitude', 'timeZone']);
  }
}

async function editTab(io, say, config, tab, advanced, profile, skip = []) {
  for (;;) {
    const keys = keysOf(tab, advanced).filter((k) => !skip.includes(k));
    say('', `${TABS.find((t) => t[0] === tab)[1]}${advanced ? ' (advanced settings shown)' : ''}`);
    const rows = keys.map((k) => { const g = profile ? gate(k, config[k], profile) : { ok: true }; return `${labelOf(k)}: ${showValue(config[k])}${isDefault(config, k) ? '' : '  *'}${g.ok ? '' : `  (not on this machine: ${g.reason})`}`; });
    const i = await pick(io, say, 'Which setting? (* = changed from the default; b = back)', rows);
    if (i < 0) return config;
    config = await editSetting(io, say, config, keys[i], profile);
  }
}

async function editPresets(io, say, config) {
  const i = await pick(io, say, 'Presets: a starting point for the look (it changes only the settings a preset covers).', PRESET_LIST.map((p) => `${p.name || p.id}: ${p.note}`));
  if (i < 0) return config;
  const p = PRESET_LIST[i];
  if (!/^y/i.test(await line(io, `Apply "${p.name || p.id}"? (y/N) `))) return config;
  say(`Applied ${p.name || p.id}.`);
  return applyPreset(config, p.id);
}

/**
 * The whole tool. Returns { config, save } (save: the user chose to keep the changes), after asking about restarting the clock when io.exec is there.
 * @param {{ask:Function, exec?:Function, fetchJson?:Function}} io
 */
export async function configTool(io, say, config, profile, confPath) {
  say(`Wobbly clock settings (${confPath}). Pick a number; b goes back, q quits.`);
  const start = config;
  let advanced = false;
  for (let guard = 0; guard < 500; guard++) {
    const changedCount = Object.keys(DEFAULT_CONFIG).filter((k) => !same(config[k], start[k])).length;
    const menu = [...TABS.map((t) => t[1]), `Advanced settings: ${advanced ? 'shown' : 'hidden'} (change)`, `Save${changedCount ? ` ${changedCount} change${changedCount > 1 ? 's' : ''}` : ''} and finish`, 'Quit without saving'];
    const i = await pick(io, say, '', menu);
    if (i === -1 || i === menu.length - 1) {
      if (changedCount && /^y/i.test(await line(io, `Save the ${changedCount} change${changedCount > 1 ? 's' : ''} first? (y/N) `))) return finish(io, say, config, true);
      say('Nothing saved.'); return { config: start, save: false };
    }
    if (i === menu.length - 2) return finish(io, say, config, changedCount > 0);
    if (i === TABS.length) { advanced = !advanced; continue; }
    const tab = TABS[i][0];
    if (tab === 'presets') config = await editPresets(io, say, config);
    else if (tab === 'place') config = await editPlace(io, say, config, profile);
    else config = await editTab(io, say, config, tab, advanced, profile);
  }
  return { config: start, save: false };
}

async function finish(io, say, config, save) {
  if (!save) { say('No changes.'); return { config, save: false }; }
  return { config, save: true, askRestart: true };
}
