// The settings file on the Raspberry Pi (`key = value` lines, the page's own setting names) -> the page's settings object.
//
// The file is the single source: the settings object is built from it on every start, from nothing, never on top of what the page saved the last time. So a setting that is
// removed from the file is back at its default after the next start; it cannot keep an old value secretly in the saved state (found on a real Pi: a time zone of UTC, saved once,
// outlived the file's lines for ever). Only `--conf JSON` (a base for tests and scripts) is laid under the file.

const ON = /^(on|true|yes|1)$/i, OFF = /^(off|false|no|0)$/i;

/**
 * @param {string} text   the settings file
 * @param {Array<{key:string, type:string}>} settings   the schema (to coerce each value by its setting's type)
 * @param {object} [base]   settings to start from (default: none)
 * @param {{ledCols?:number, ledRows?:number}} [opts]   the command line's LED panel size, which makes the output an LED panel
 */
export function confFromFile(text, settings, base = {}, opts = {}) {
  const specs = Object.fromEntries(settings.map((x) => [x.key, x]));
  const conf = { ...base };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/#.*/, '').trim(); const i = line.indexOf('='); if (i < 1) continue;
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim(), sp = specs[k];
    if (ON.test(v) && (!sp || sp.type === 'bool')) conf[k] = true;
    else if (OFF.test(v) && (!sp || sp.type === 'bool')) conf[k] = false;
    else if (sp && sp.type === 'number' || (!sp && v !== '' && !Number.isNaN(Number(v)))) conf[k] = Number(v);
    else conf[k] = v;
  }
  if ('location_latitude' in conf && 'location_longitude' in conf) { conf.locationChoice = 'manual'; conf.manualLocation = true; conf.preciseLocation = false; }      // a place in the file is a place chosen by hand
  if (opts.ledCols) { conf.screenMode = 'led'; conf.ledCols = opts.ledCols; conf.ledRows = opts.ledRows; }
  return conf;
}
