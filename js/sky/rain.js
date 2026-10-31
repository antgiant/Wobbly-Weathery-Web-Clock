// "Do I need an umbrella today?" from the hourly rain forecast. Pure logic plus one fetch.
//
//   umbrella  at least 1 mm (0.04 in) falls in the rest of the day (until 11 pm), in hours that are likely wet
//   slicker   8 mm (0.3 in) or more in the rest of the day, or any single hour of 2.5 mm or more: a downpour,
//             where an umbrella is not enough
//
// "Likely wet" means an hour with at least 0.2 mm and, when the forecast gives a probability, at least 30%.
// Drizzle that adds up to less than a millimetre is not worth carrying anything for.

const HOUR = 3600e3;
export const UMBRELLA_MM = 1, SLICKER_MM = 8, SLICKER_HOUR_MM = 2.5, WET_HOUR_MM = 0.2, WET_PROB = 30;

/**
 * @param {{t:number, mm:number, prob?:number|null, snow?:number}[]} hours  t = start of the hour (ms, UTC); snow in cm
 * @param {number} nowMs
 * @param {number} offsetSec  the place's UTC offset, for "the rest of the day"
 * @returns {{level:'none'|'umbrella'|'slicker', kind:'rain'|'snow', totalMm:number, peakMm:number, from:number|null, to:number|null, raining:boolean}}
 */
export function assessRain(hours, nowMs, offsetSec = 0) {
  const localNow = nowMs + offsetSec * 1000;
  const endMs = Math.floor(localNow / 86400e3) * 86400e3 + 23 * HOUR - offsetSec * 1000;     // 11 pm, local
  let total = 0, peak = 0, from = null, to = null, snow = 0, raining = false;
  for (const h of hours) {
    const end = h.t + HOUR;
    if (end <= nowMs || h.t >= endMs) continue;
    const mm = Number.isFinite(h.mm) ? h.mm : 0;
    const wet = mm >= WET_HOUR_MM && (h.prob == null || !Number.isFinite(h.prob) || h.prob >= WET_PROB);
    if (!wet) continue;
    const left = Math.min(1, (end - Math.max(nowMs, h.t)) / HOUR);            // the part of this hour still to come
    total += mm * left;
    peak = Math.max(peak, mm);
    snow += (h.snow || 0) * left;                                            // cm of snow: about 1 mm of water per cm
    if (from == null || h.t < from) from = Math.max(h.t, nowMs);
    if (to == null || end > to) to = Math.min(end, endMs);
    if (h.t <= nowMs && nowMs < end) raining = true;
  }
  const level = total >= SLICKER_MM || peak >= SLICKER_HOUR_MM ? 'slicker' : total >= UMBRELLA_MM ? 'umbrella' : 'none';
  const kind = total > 0 && snow / Math.max(total, 1e-6) > 0.5 ? 'snow' : 'rain';
  return { level, kind, totalMm: total, peakMm: peak, from: level === 'none' ? null : from, to: level === 'none' ? null : to, raining: level !== 'none' && raining };
}

/** Hourly blocks from an Open-Meteo `hourly` object (times local to the place; give utc_offset_seconds). */
export function hoursFromHourly(h, offsetSec = 0) {
  if (!h || !h.time) return [];
  return h.time.map((s, i) => ({
    t: Date.parse(s + ':00Z') - offsetSec * 1000,
    mm: h.precipitation ? h.precipitation[i] : 0,
    prob: h.precipitation_probability ? h.precipitation_probability[i] : null,
    snow: h.snowfall ? h.snowfall[i] : 0,
  }));
}

/** Today and tomorrow, hourly. */
export async function fetchRainHours(lat, lon, signal) {
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation,precipitation_probability,snowfall&forecast_days=2&timezone=auto`, { signal });
  if (!r.ok) throw new Error('rain HTTP ' + r.status);
  const j = await r.json();
  const off = j.utc_offset_seconds || 0;
  return { offset: off, hours: hoursFromHourly(j.hourly, off) };
}
