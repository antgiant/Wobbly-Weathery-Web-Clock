// Severe weather notices: official watches and warnings for the clock's place, shown like the umbrella notice. Pure logic (parsing, classifying, choosing) plus one fetch.
//
// Sources: Germany's DWD (through Bright Sky), the US National Weather Service, `alerts/active?point=lat,lon` (free, no key, open to web pages: CORS is `*`; it wants a User-Agent, which a browser sends
// itself and the Pi program sets), and Environment Canada's `weather-alerts` collection (OGC API, also CORS `*`, asked by a small box round the place). Other countries' services
// (MeteoAlarm, ...) can be added as more `parse*` functions that return the same shape.
//
// An alert is { id, event, level, type, severity, urgency, headline, area, expires, other }:
//   level  'warning' (act now: a Warning or an Emergency) | 'watch' (conditions are right for it) | 'advisory' (be aware)
//   type   what icon to show: tornado thunderstorm flood hurricane winter wind heat cold fire dust smoke fog tsunami marine avalanche earthquake other
//   other  true for emergencies that are not weather (civil emergency, evacuation, child abduction ...): off unless asked for

/** One drawing (an SVG path in a 24 x 24 box, drawn with a 1.8 wide round stroke) for each kind of hazard: the page's pill and the Raspberry Pi's pill draw the same. */
export const SEV_ICON = {
  tornado: 'M3 4h18M5 8h14M8 12h9M10 16h5M12 20h1',
  thunderstorm: 'M7 15a4 4 0 0 1 .8-7.9A5.2 5.2 0 0 1 17.6 8 3.6 3.6 0 0 1 17 15M13 11l-3 5h4l-2 5',
  flood: 'M2 14c2-2 3-2 5 0c2 2 3 2 5 0c2-2 3-2 5 0c2 2 3 2 5 0M2 19c2-2 3-2 5 0c2 2 3 2 5 0c2-2 3-2 5 0c2 2 3 2 5 0M12 3v7M9 7l3 3 3-3',
  hurricane: 'M12 9a3 3 0 1 0 .01 0M12 3a9 9 0 0 1 9 9M12 21a9 9 0 0 1-9-9',
  winter: 'M12 2v20M3.4 7l17.2 10M3.4 17L20.6 7M9 4l3 2 3-2M9 20l3-2 3 2',
  wind: 'M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8',
  heat: 'M12 8a4 4 0 1 0 .01 0M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
  cold: 'M10 4a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0zM12 8v7',
  fire: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z',
  dust: 'M3 7h13a2.5 2.5 0 1 0-2.5-2.5M3 12h18M3 17h12a2.5 2.5 0 1 1-2.5 2.5',
  smoke: 'M5 20c-2-3 1-5 0-8s2-4 2-7M12 20c-2-3 1-5 0-8s2-4 2-7M19 20c-2-3 1-5 0-8s2-4 2-7',
  fog: 'M3 8h18M5 12h14M3 16h18M7 20h10',
  tsunami: 'M2 19c3-8 7-12 12-12-2 3-1 6 3 7 2 .5 3 2 5 5M2 19h20',
  marine: 'M3 15h18l-2 5H5zM12 3v12M12 4l6 9h-6',
  avalanche: 'M2 20L9 7l4 6 3-4 6 11z',
  earthquake: 'M2 12h4l2-6 4 12 3-9 2 3h5',
  other: 'M12 3L2 21h20zM12 10v5M12 18v.5',
};

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/** What an event name means: [pattern, type]. The first pattern that matches wins, so the order is the priority. */
const TYPES = [
  [/tornado/i, 'tornado'],
  [/tsunami/i, 'tsunami'],
  [/hurricane|typhoon|tropical (storm|cyclone|depression)|storm surge/i, 'hurricane'],
  [/severe thunderstorm|special marine|thunderstorm/i, 'thunderstorm'],
  [/flash flood|flood|coastal flood|lakeshore flood|river flood|dam break|rainfall|heavy rain/i, 'flood'],
  [/blizzard|winter storm|ice storm|freezing rain|winter weather|snow squall|lake effect snow|heavy snow|sleet|snow|black ice|slippery|glaze/i, 'winter'],
  [/extreme cold|wind chill|hard freeze|freeze|frost/i, 'cold'],
  [/excessive heat|extreme heat|heat/i, 'heat'],
  [/dust storm|blowing dust|dust advisory/i, 'dust'],
  [/high wind|extreme wind|wind advisory|lake wind|brisk wind|gale|gust|storm warning|hurricane force/i, 'wind'],
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

// ---- Environment Canada (api.weather.gc.ca, collection weather-alerts) ----
const EC_COLOUR = { red: 4, orange: 3, yellow: 2 };
const titleCase = (t) => clean(t).replace(/\b([a-z])/g, (m) => m.toUpperCase());

/** Alerts from an Environment Canada `weather-alerts/items` answer: warning / watch / advisory / statement, red / orange / yellow / grey risk, until the event ends. An alert whose status says it ended is cancelled. */
export function parseEc(json) {
  const feats = json && Array.isArray(json.features) ? json.features : [];
  const out = [];
  for (const f of feats) {
    const p = f && f.properties; if (!p) continue;
    const name = clean(p.alert_name_en); if (!name) continue;
    const event = titleCase(name), kind = clean(p.alert_type).toLowerCase();
    const end = Date.parse(p.event_end_datetime || p.expiration_datetime || ''), exp = Date.parse(p.expiration_datetime || ''), onset = Date.parse(p.validity_datetime || p.publication_datetime || '');
    const level = kind === 'warning' ? 'warning' : kind === 'watch' ? 'watch' : 'advisory';           // advisories, statements and endings
    const text = clean(p.alert_text_en);
    out.push({
      id: clean(p.feature_id) || `${event}|${p.publication_datetime || ''}`, event, level, type: typeOf(name), other: false,
      severity: EC_COLOUR[clean(p.risk_colour_en).toLowerCase()] ?? (level === 'warning' ? 3 : level === 'watch' ? 2 : 1), urgency: level === 'warning' ? 3 : 2,
      headline: `${event}${p.feature_name_en ? ' for ' + clean(p.feature_name_en) : ''}`, area: clean(p.feature_name_en), text,
      expires: Number.isFinite(end) ? end : Number.isFinite(exp) ? exp : null, onset: Number.isFinite(onset) ? onset : null,
      cancelled: /^ended$|cancel/i.test(clean(p.status_en)) || kind === 'ended',
    });
  }
  return out;
}

// ---- Germany: the DWD's warnings through Bright Sky (api.brightsky.dev/alerts?lat&lon: free, no key, CORS open, answers for the point itself) ----
const DWD_SEVERITY = { minor: 1, moderate: 2, severe: 3, extreme: 4 };
/** Alerts from a Bright Sky `alerts` answer. The DWD's four levels: minor is an advisory (weather to be aware of), moderate a watch (marked weather: prepare), severe and extreme (Unwetter) a warning. A pre-information ("Vorabinformation") is a watch at most. Only status "actual" counts. */
export function parseDwd(json) {
  const list = json && Array.isArray(json.alerts) ? json.alerts : [];
  const out = [];
  for (const p of list) {
    if (!p) continue;
    const name = clean(p.event_en || p.event_de); if (!name) continue;
    const sev = DWD_SEVERITY[clean(p.severity).toLowerCase()] ?? 1, pre = /preliminary|vorab/i.test(`${p.headline_en} ${p.headline_de}`);
    const level = sev >= 3 && !pre ? 'warning' : sev === 2 || pre && sev >= 2 ? 'watch' : 'advisory';
    const exp = Date.parse(p.expires || ''), onset = Date.parse(p.onset || p.effective || '');
    out.push({
      id: String(p.alert_id || p.id || name), event: `${titleCase(name)} ${level === 'warning' ? 'Warning' : level === 'watch' ? 'Watch' : 'Advisory'}`, level, type: typeOf(name), other: false,
      severity: sev, urgency: /immediate/i.test(clean(p.urgency)) ? 3 : 2, headline: clean(p.headline_en || p.headline_de) || name, area: '', text: clean(p.description_en || p.description_de),
      expires: Number.isFinite(exp) ? exp : null, onset: Number.isFinite(onset) ? onset : null, cancelled: clean(p.status).toLowerCase() !== 'actual',
    });
  }
  return out;
}
// ---- MeteoAlarm (feeds.meteoalarm.org: the European warning feeds, one per country) ----
// Only for the countries whose feed carries the areas as polygons (the United Kingdom, the Netherlands, Norway, Sweden, Estonia, Luxembourg, Slovenia, Iceland): the others name
// their areas by a code only (EMMA_ID, NUTS), and turning a code into a place needs a boundary data set we do not have. The feeds send no CORS headers, so only the Raspberry Pi's
// program (which fetches through curl) can read them: a web page leaves them out.
export const MA_COUNTRIES = [
  ['united-kingdom', 49.8, 60.9, -8.7, 1.8], ['netherlands', 50.7, 53.6, 3.3, 7.3], ['norway', 57.9, 71.3, 4.4, 31.3], ['sweden', 55.3, 69.1, 10.9, 24.2],
  ['estonia', 57.5, 59.7, 21.7, 28.3], ['luxembourg', 49.4, 50.2, 5.7, 6.6], ['slovenia', 45.4, 46.9, 13.3, 16.6], ['iceland', 63.3, 66.6, -24.6, -13.4],
];
export const maCountries = (lat, lon) => MA_COUNTRIES.filter((c) => lat >= c[1] && lat <= c[2] && lon >= c[3] && lon <= c[4]).map((c) => c[0]);
/** The Raspberry Pi's program says so by having `__pillSet`; a web page has not (and its browser would refuse the feeds). */
export const maUsable = () => typeof globalThis.__pillSet === 'function';

/** Is the point inside a polygon given as the feed writes it: "lat,lon lat,lon ..."? (Ray casting.) */
export function inPolygon(lat, lon, poly) {
  const pts = String(poly || '').trim().split(/\s+/).map((p) => p.split(',').map(Number)).filter((q) => q.length === 2 && q.every(Number.isFinite));
  if (pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, xi] = pts[i], [yj, xj] = pts[j];
    if ((xi > lon) !== (xj > lon) && lat < ((yj - yi) * (lon - xi)) / (xj - xi) + yi) inside = !inside;
  }
  return inside;
}
const MA_TYPES = { 1: 'wind', 2: 'winter', 3: 'thunderstorm', 4: 'fog', 5: 'heat', 6: 'cold', 7: 'marine', 8: 'fire', 9: 'avalanche', 10: 'flood', 11: 'flood', 12: 'flood', 13: 'flood' };
const MA_LEVEL = { 2: 'advisory', 3: 'watch', 4: 'warning' };       // yellow: be aware; orange: be prepared; red: take action
const maParam = (info, name) => { const ps = Array.isArray(info.parameter) ? info.parameter : info.parameter ? [info.parameter] : []; const p = ps.find((x) => x && x.valueName === name); return p ? String(p.value) : ''; };

/** Alerts at a point from a MeteoAlarm country feed (`{warnings: [{alert: {status, info: [...]}}]}`): the warnings whose polygon holds the point. Yellow is an advisory, orange a watch, red a warning. */
export function parseMeteoAlarm(json, lat, lon) {
  const out = [];
  for (const w of json && Array.isArray(json.warnings) ? json.warnings : []) {
    const al = w && w.alert; if (!al || clean(al.status).toLowerCase() !== 'actual') continue;
    const infos = Array.isArray(al.info) ? al.info : al.info ? [al.info] : [];
    const info = infos.find((i) => /^en/i.test(clean(i.language))) || infos[0]; if (!info) continue;
    const areas = Array.isArray(info.area) ? info.area : info.area ? [info.area] : [];
    const hit = areas.find((a) => (Array.isArray(a.polygon) ? a.polygon : a.polygon ? [a.polygon] : []).some((poly) => inPolygon(lat, lon, poly)));
    if (!hit) continue;
    const lv = Number((maParam(info, 'awareness_level').match(/^\s*(\d)/) || [])[1]), kind = Number((maParam(info, 'awareness_type').match(/^\s*(\d+)/) || [])[1]);
    const level = MA_LEVEL[lv]; if (!level) continue;                                    // green (1) is not a warning
    const exp = Date.parse(info.expires || ''), onset = Date.parse(info.onset || info.effective || '');
    const label = clean(maParam(info, 'awareness_type').split(';')[1]) || clean(info.event) || 'Weather';
    out.push({
      id: String(al.identifier || al.sent || label), event: `${titleCase(label)} ${level === 'warning' ? 'Warning' : level === 'watch' ? 'Watch' : 'Advisory'}`, level, type: MA_TYPES[kind] || typeOf(label), other: false,
      severity: lv, urgency: /immediate/i.test(clean(info.urgency)) ? 3 : 2, headline: clean(info.headline) || label, area: clean(hit.areaDesc), text: clean(info.description),
      expires: Number.isFinite(exp) ? exp : null, onset: Number.isFinite(onset) ? onset : null, cancelled: /cancel/i.test(clean(al.msgType)),
    });
  }
  return out;
}
export async function fetchMeteoAlarm(lat, lon, signal) {
  const res = await Promise.allSettled(maCountries(lat, lon).map(async (c) => {
    const r = await fetch(`https://feeds.meteoalarm.org/api/v1/warnings/feeds-${c}`, { signal });
    if (!r.ok) throw new Error('alerts HTTP ' + r.status);
    return parseMeteoAlarm(await r.json(), lat, lon);
  }));
  if (res.length && res.every((r) => r.status === 'rejected')) throw res[0].reason;
  return res.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

/** Germany (a rough box: the answer for a point outside is empty). */
export function inDwdArea(lat, lon) { return lat >= 47.2 && lat <= 55.1 && lon >= 5.8 && lon <= 15.1; }
export async function fetchDwd(lat, lon, signal) {
  const r = await fetch(`https://api.brightsky.dev/alerts?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`, { signal });
  if (r.status === 404 || r.status === 400) return [];
  if (!r.ok) throw new Error('alerts HTTP ' + r.status);
  return parseDwd(await r.json());
}

/** Canada, with the United States' border region (a rough box, to save requests that cannot work). */
export function inEcArea(lat, lon) { return lat >= 41.6 && lat <= 83.5 && lon >= -141.1 && lon <= -52; }

/** Environment Canada's active alerts for a point (a box of 0.02 degree round it: the answer holds every alert whose area touches it). */
export async function fetchEc(lat, lon, signal) {
  const d = 0.01, bbox = [lon - d, lat - d, lon + d, lat + d].map((v) => v.toFixed(4)).join(',');
  const r = await fetch(`https://api.weather.gc.ca/collections/weather-alerts/items?f=json&lang=en&limit=50&bbox=${bbox}`, { signal });
  if (r.status === 404 || r.status === 400) return [];
  if (!r.ok) throw new Error('alerts HTTP ' + r.status);
  return parseEc(await r.json());
}

/** Anywhere a service is wired in. */
export const inAlertArea = (lat, lon) => inNwsArea(lat, lon) || inEcArea(lat, lon) || inDwdArea(lat, lon) || (maUsable() && maCountries(lat, lon).length > 0);

/** Alerts from every service that covers the point, together (a point near the border may be in two). One service failing does not hide the other's alerts unless both fail. */
export async function fetchAlerts(lat, lon, signal) {
  const jobs = [];
  if (inNwsArea(lat, lon)) jobs.push(fetchNws(lat, lon, signal));
  if (inEcArea(lat, lon)) jobs.push(fetchEc(lat, lon, signal));
  if (inDwdArea(lat, lon)) jobs.push(fetchDwd(lat, lon, signal));
  if (maUsable() && maCountries(lat, lon).length) jobs.push(fetchMeteoAlarm(lat, lon, signal));
  const res = await Promise.allSettled(jobs);
  if (res.length && res.every((r) => r.status === 'rejected')) throw res[0].reason;
  return res.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

/** Where the NWS can answer: the United States and its territories (a point outside gets a 404). A rough box, to save requests that cannot work. */
export function inNwsArea(lat, lon) {
  return (lat >= 24 && lat <= 49.6 && lon >= -125 && lon <= -66.5)          // the 48 states
    || (lat >= 51 && lat <= 72 && lon >= -180 && lon <= -141) || (lat >= 54.6 && lat <= 60.4 && lon > -141 && lon <= -130) || (lat >= 51 && lat <= 54 && lon >= 172 && lon <= 180)           // Alaska (with its panhandle) and the Aleutians
    || (lat >= 18.5 && lat <= 22.5 && lon >= -161 && lon <= -154)             // Hawaii
    || (lat >= 17.5 && lat <= 18.8 && lon >= -68 && lon <= -64.5)             // Puerto Rico and the Virgin Islands
    || (lat >= 13 && lat <= 21 && lon >= 144 && lon <= 146.5)                 // Guam and the Marianas
    || (lat >= -15 && lat <= -10 && lon >= -171.5 && lon <= -168);            // American Samoa
}

/** Active alerts at a point. Resolves to [] where the service has none or does not cover the point. */
export async function fetchNws(lat, lon, signal) {
  const r = await fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { signal, headers: { Accept: 'application/geo+json' } });
  if (r.status === 404 || r.status === 400) return [];
  if (!r.ok) throw new Error('alerts HTTP ' + r.status);
  return parseNws(await r.json());
}
