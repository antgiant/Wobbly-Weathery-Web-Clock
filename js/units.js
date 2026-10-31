// Regional defaults: 12/24-hour time and temperature units. Pure functions, so they can be tested in node.

/** 24-hour time when the user chose (true / false), otherwise whatever the browser's locale uses. */
export function hour24(pref) {
  if (typeof pref === 'boolean') return pref;
  try {
    const o = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
    if (o.hourCycle) return o.hourCycle === 'h23' || o.hourCycle === 'h24';
    return !o.hour12;
  } catch (_) { return true; }
}

// Fahrenheit: the US and its territories, Liberia, Myanmar, the Bahamas, Belize, the Cayman Islands, Palau, Micronesia, Marshall Islands.
const F_REGIONS = ['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH'];

/** 'c' or 'f': the user's choice, else by the region of the browser's language. */
export function unitFor(pref, language) {
  if (pref === 'c' || pref === 'f') return pref;
  let region = '';
  try { region = new Intl.Locale(language || (typeof navigator !== 'undefined' && navigator.language) || 'en-US').maximize().region || ''; } catch (_) { /* old browser */ }
  return F_REGIONS.includes(region) ? 'f' : 'c';
}

export const formatTempIn = (c, unit) => (unit === 'f' ? `${Math.round(c * 9 / 5 + 32)}°F` : `${Math.round(c)}°C`);
