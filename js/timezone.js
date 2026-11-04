// "Show the time at that place": the digits (and the times in alerts) show a chosen IANA time zone instead of the device's own. Everything
// else (the sky, sunrise and sunset) already works from the place and an absolute time, so only what is read off the clock changes.
import { conf } from './config.js';

const formatters = new Map();
export function validZone(zone) {
  if (!zone || typeof zone !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch (_) { return false; }
}
export const zoneActive = () => validZone(conf.timeZone);

/** Hours (0-23), minutes and seconds on the wall clock of the zone (the device's own when none is set). */
export function wallTime(date, zone = conf.timeZone) {
  if (!validZone(zone)) return { h: date.getHours(), m: date.getMinutes(), s: date.getSeconds() };
  let f = formatters.get(zone);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' }); formatters.set(zone, f); }
  const p = {}; for (const x of f.formatToParts(date)) p[x.type] = Number(x.value);
  return { h: p.hour % 24, m: p.minute, s: p.second };
}

/** Options to add to toLocaleTimeString so a time is shown in the chosen zone. */
export const zoneOptions = () => (zoneActive() ? { timeZone: conf.timeZone } : {});
