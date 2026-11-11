// Severe weather notices: official watches and warnings for the clock's place, shown like the umbrella notice. Pure logic (parsing, classifying, choosing) plus one fetch.
//
// Source: the US National Weather Service, `alerts/active?point=lat,lon` (free, no key, open to web pages: CORS is `*`; it wants a User-Agent, which a browser sends
// itself and the Pi program sets). Other countries' services (Environment Canada, MeteoAlarm, ...) can be added as more `parse*` functions that return the same shape.
//
// An alert is { id, event, level, type, severity, urgency, headline, area, expires, other }:
//   level  'warning' (act now: a Warning or an Emergency) | 'watch' (conditions are right for it) | 'advisory' (be aware)
//   type   what icon to show: tornado thunderstorm flood hurricane winter wind heat cold fire dust smoke fog tsunami marine avalanche earthquake other
//   other  true for emergencies that are not weather (civil emergency, evacuation, child abduction ...): off unless asked for

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/** What an event name means: [pattern, type]. The first pattern that matches wins, so the order is the priority. */
const TYPES = [
  [/tornado/i, 'tornado'],
  [/tsunami/i, 'tsunami'],
  [/hurricane|typhoon|tropical (storm|cyclone|depression)|storm surge/i, 'hurricane'],
  [/severe thunderstorm|special marine|thunderstorm/i, 'thunderstorm'],
  [/flash flood|flood|coastal flood|lakeshore flood|river flood|dam break/i, 'flood'],
  [/blizzard|winter storm|ice storm|freezing rain|winter weather|snow squall|lake effect snow|heavy snow|sleet|snow/i, 'winter'],
  [/extreme cold|wind chill|hard freeze|freeze|frost/i, 'cold'],
  [/excessive heat|extreme heat|heat/i, 'heat'],
  [/dust storm|blowing dust|dust advisory/i, 'dust'],
  [/high wind|extreme wind|wind advisory|lake wind|brisk wind|gale|storm warning|hurricane force/i, 'wind'],
  [/red flag|fire weather|fire warning|wildfire/i, 'fire'],
  [/smoke|air quality|air stagnation|ashfall|volcano/i, 'smoke'],
  [/dense fog|dense smoke|freezing fog|fog/i, 'fog'],
  [/avalanche/i, 'avalanche'],
  [/earthquake/i, 'earthquake'],
  [/small craft|marine|rip current|beach hazard|surf|seas/i, 'marine'],
];
/** Emergencies that are not weather. */
const OTHER = /civil emergency|evacuation|child abduction|law enforcement|shelter in place|911 telephone|nuclear power|radiological|hazardous materials|local area emergency|amber|blue alert|civil danger|administrative message/i;

export const typeOf = (event) => { const e = clean(event); for (const [re, t] of TYPES) if (re.test(e)) return t; return 'other'; };
export const isOther = (event) => OTHER.test(clean(event));

/** warning | watch | advisory from the event name ("Tornado Warning", "Flood Watch", "Wind Advisory", "Tornado Emergency", "Special Weather Statement"). */
export function levelOf(event) {
  const e = clean(event);
  if (/emergency|warning/i.test(e)) return 'warning';
  if (/watch/i.test(e)) return 'watch';
  return 'advisory';                                          // advisories, statements, outlooks, alerts
}

const SEVERITY = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
const URGENCY = { Immediate: 3, Expected: 2, Future: 1, Past: 0, Unknown: 0 };
const TYPE_RANK = ['tornado', 'tsunami', 'hurricane', 'thunderstorm', 'flood', 'winter', 'wind', 'fire', 'dust', 'heat', 'cold', 'smoke', 'fog', 'avalanche', 'earthquake', 'marine', 'other'];

/** Alerts from an NWS `alerts/active` GeoJSON answer. Cancelled and expired ones are dropped by `choose`, not here. */
export function parseNws(json) {
  const feats = json && Array.isArray(json.features) ? json.features : [];
  const out = [];
  for (const f of feats) {
    const p = f && f.properties; if (!p) continue;
    const event = clean(p.event); if (!event) continue;
    const exp = Date.parse(p.ends || p.expires || ''), onset = Date.parse(p.onset || p.effective || '');
    out.push({
      id: clean(p.id || f.id || event + '|' + (p.sent || '')), event, level: levelOf(event), type: typeOf(event), other: isOther(event),
      severity: SEVERITY[p.severity] ?? 0, urgency: URGENCY[p.urgency] ?? 0,
      headline: clean(p.headline) || event, area: clean(p.areaDesc), expires: Number.isFinite(exp) ? exp : null, onset: Number.isFinite(onset) ? onset : null,
      cancelled: /^cancel/i.test(clean(p.messageType)) || /cancel/i.test(clean(p.status)) || p.status === 'Test' || p.status === 'Exercise',
    });
  }
  return out;
}

export const LEVELS = { off: [], warning: ['warning'], watch: ['warning', 'watch'], all: ['warning', 'watch', 'advisory'] };

/**
 * The alert to show, and how many there are. `levels` is a key of LEVELS; `other` allows the emergencies that are not weather.
 * Most urgent first: warning over watch over advisory, then severity, urgency, the kind of hazard (a tornado before a fog), and the one that ends last.
 * @returns {{top: object|null, count: number, all: object[]}}
 */
export function choose(alerts, { levels = 'watch', other = false } = {}, nowMs = Date.now()) {
  const want = LEVELS[levels] || LEVELS.watch;
  const live = (alerts || []).filter((a) => !a.cancelled && (a.expires == null || a.expires > nowMs) && (a.onset == null || a.onset - 3 * 3600e3 <= nowMs) && want.includes(a.level) && (other || !a.other));
  const order = (a) => [want.length - want.indexOf(a.level), a.severity, a.urgency, -TYPE_RANK.indexOf(a.type), a.expires ?? 0];
  live.sort((a, b) => { const x = order(a), y = order(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; });
  return { top: live[0] || null, count: live.length, all: live };
}

/** The words for a pill: "Tornado Warning" plus "+2 more" when there are others; and the headline for the long form. */
export function pillText(sel, nowMs = Date.now()) {
  const a = sel && sel.top; if (!a) return '';
  const until = a.expires ? ` until ${new Date(a.expires).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  void nowMs;
  return `${a.event}${until}${sel.count > 1 ? ` (+${sel.count - 1} more)` : ''}`;
}

/** Where the NWS can answer: the United States and its territories (a point outside gets a 404). A rough box, to save requests that cannot work. */
export function inNwsArea(lat, lon) {
  return (lat >= 17.5 && lat <= 72 && lon >= -180 && lon <= -64.5) || (lat >= 13 && lat <= 21 && lon >= 144 && lon <= 146.5) || (lat >= -15 && lat <= -10 && lon >= -171.5 && lon <= -168);
}

/** Active alerts at a point. Resolves to [] where the service has none or does not cover the point. */
export async function fetchNws(lat, lon, signal) {
  const r = await fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { signal, headers: { Accept: 'application/geo+json' } });
  if (r.status === 404 || r.status === 400) return [];
  if (!r.ok) throw new Error('alerts HTTP ' + r.status);
  return parseNws(await r.json());
}
