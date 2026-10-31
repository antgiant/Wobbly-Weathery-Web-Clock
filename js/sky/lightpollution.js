// Light pollution (Bortle class) from the towns and cities actually around the observer.
//
// The time-zone estimate this replaces gives one number for a whole zone, which is wrong for most
// people (a farm and a city centre share a zone). Here the sky glow is summed from the surrounding
// settlements with Walker's law,
//
//     glow / natural sky brightness = 0.01 * P * d^-2.5      (P people, d km)
//
// which is the usual first estimate of how much a city brightens the sky towards it, and the total is mapped
// onto the Bortle scale. Settlements come from OpenStreetMap (Overpass, with population where mapped).
// It is an estimate: it knows nothing about the shape of the land, haze, or lit industry in the middle of nowhere.

const R_TOWNS_KM = 120, R_VILLAGES_KM = 12;
// population assumed when the map has none
const DEFAULT_POP = { city: 250000, town: 15000, village: 1200, hamlet: 150 };

/** Distance in km. */
export function haversine(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ratio of artificial to natural sky brightness at which each Bortle class begins (class 2 starts at the first)
const THRESHOLDS = [0.02, 0.07, 0.2, 0.55, 1.5, 4, 12, 40];

export function bortleFromRatio(r) {
  let b = 1;
  for (const t of THRESHOLDS) if (r >= t) b++;
  return b;
}

/**
 * @param {{lat:number, lon:number, place:string, population?:number}[]} places
 * @param {{urban?: boolean}} opt  urban: the satellite tile at the spot is built-up
 * @returns {{bortle:number, ratio:number, nearest:null|{name:string,km:number}}}
 */
export function estimateBortle(lat, lon, places, opt = {}) {
  let ratio = 0, nearest = null;
  for (const p of places) {
    const pop = Number.isFinite(p.population) && p.population > 0 ? p.population : (DEFAULT_POP[p.place] ?? 0);
    const d = haversine(lat, lon, p.lat, p.lon);
    if (d > R_TOWNS_KM) continue;
    ratio += 0.01 * pop * Math.pow(Math.max(d, 4), -2.5);        // inside a few km the law stops making sense: cap it
    if (p.place !== 'hamlet' && (!nearest || d < nearest.km)) nearest = { name: p.name || p.place, km: d };
  }
  let bortle = bortleFromRatio(ratio);
  if (opt.urban) bortle = Math.max(bortle, 7);                   // standing in a built-up area
  return { bortle, ratio, nearest };
}

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

export function overpassQuery(lat, lon) {
  return `[out:json][timeout:20];(node(around:${R_TOWNS_KM * 1000},${lat},${lon})[place~"^(city|town)$"];` +
    `node(around:${R_VILLAGES_KM * 1000},${lat},${lon})[place~"^(village|hamlet)$"];);out tags center 800;`;
}

export function parsePlaces(json) {
  return ((json && json.elements) || []).filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lon) && e.tags && e.tags.place)
    .map(e => ({ lat: e.lat, lon: e.lon, place: e.tags.place, name: e.tags.name, population: parseInt(String(e.tags.population || '').replace(/[ ,.]/g, ''), 10) }));
}

/** Settlements around a point, from the first Overpass server that answers. */
export async function fetchPlaces(lat, lon, signal) {
  let err = null;
  for (const url of ENDPOINTS) {
    try {
      const r = await fetch(`${url}?data=${encodeURIComponent(overpassQuery(lat, lon))}`, { signal });
      if (r.ok) return parsePlaces(await r.json());
      err = new Error('overpass HTTP ' + r.status);
    } catch (e) { if (e.name === 'AbortError') throw e; err = e; }
  }
  throw err || new Error('overpass failed');
}
