// What kind of land is this? One satellite tile (EOX Sentinel-2 cloudless, ~1-20 KB, sent with
// CORS headers so a static site can read its pixels) around the location is enough to tell
// desert from forest from farmland from snow, and a few geographic rules pick the plants.
// Season comes from the date and hemisphere. Everything falls back to latitude rules offline.
//
// Imagery: Sentinel-2 cloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel
// data), https://s2maps.eu, licensed CC BY-NC-SA 4.0: fine for a personal clock, check the terms
// before using it commercially.

const Z = 10;                       // ~153 m per pixel at the equator; a tile is ~39 km wide
const HALF = 8;                     // sample a (2*HALF+1)^2 pixel window, about 2.5 km across

export const BIOMES = ['forest', 'grass', 'steppe', 'desert', 'tundra', 'urban', 'snow', 'water'];

function tileOf(lat, lon) {
  const n = 2 ** Z, r = lat * Math.PI / 180;
  const x = (lon + 180) / 360 * n;
  const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  return { tx: Math.floor(x), ty: Math.floor(y), fx: x - Math.floor(x), fy: y - Math.floor(y) };
}

const region = (lat, lon) =>
  lon > -125 && lon < -30 ? 'americas' : (lon > 110 && lon < 160 && lat < 0) ? 'oceania' : (lon > -20 && lon < 60 && Math.abs(lat) < 35) ? 'africa' : 'other';

/**
 * Decide the biome from the mean tile colour in a window (0-255), its texture (stddev) and where on Earth.
 * Thresholds were tuned on real tiles from 20 places (Sahara, Namib, Outback, Amazon, boreal Canada,
 * Oregon, Alps, Greenland, ocean, NYC, Iowa, Kansas, Colorado, Tuscany, Highlands, Siberia ...).
 */
export function classify(rgb, sd, lat, lon, elevM = 0) {
  const [r, g, b] = rgb, V = (r + g + b) / 3, rb = r - b, gr = g - (r + b) / 2;
  let kind;
  if (V > 190 && Math.max(r, g, b) - Math.min(r, g, b) < 30) kind = 'snow';
  else if (b > r + 8 && b >= g - 3 && V < 75) kind = 'water';
  else if (rb > 45 && V > 80) kind = 'desert';
  else if (V < 38) kind = 'forest';
  else if (sd > 20 && gr < 10 && rb < 16 && V > 50 && V < 100) kind = 'urban';
  else if (Math.abs(lat) > 52 && gr < 16) kind = 'tundra';
  else if (gr >= 14) kind = 'grass';
  else kind = 'steppe';
  // dry mountain slopes with some relief are usually conifer forest
  if ((kind === 'steppe' || kind === 'grass') && elevM > 1200 && V < 80 && Math.abs(lat) < 60) kind = 'forest';
  return finish(kind, V, lat, lon, elevM);
}

function finish(kind, V, lat, lon, elevM) {
  const tropical = Math.abs(lat) < 23.5 && (kind === 'forest' || kind === 'grass');
  const conifer = kind === 'forest' && !tropical && (Math.abs(lat) > 50 || elevM > 1500 || V < 20);
  return { kind, conifer, tropical, region: region(lat, lon), lat, lon };
}

/** Latitude-only guess for when the tile cannot be fetched. */
export function fallbackBiome(lat, lon) {
  const a = Math.abs(lat);
  return finish(a > 66 ? 'tundra' : a > 52 ? 'forest' : 'grass', 50, lat, lon, 0);
}

function loadImage(url, ms = 8000) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    const t = setTimeout(() => reject(new Error('tile timeout')), ms);
    im.onload = () => { clearTimeout(t); resolve(im); };
    im.onerror = () => { clearTimeout(t); reject(new Error('tile failed')); };
    im.src = url;
  });
}

export async function fetchBiome(lat, lon, elevM = 0) {
  const { tx, ty, fx, fy } = tileOf(lat, lon);
  const im = await loadImage(`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/${Z}/${ty}/${tx}.jpg`);
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(im, 0, 0);
  const cx = Math.floor(fx * W), cy = Math.floor(fy * H);
  const x0 = Math.max(0, cx - HALF), y0 = Math.max(0, cy - HALF);
  const w = Math.min(W - x0, 2 * HALF + 1), h = Math.min(H - y0, 2 * HALF + 1);
  const d = ctx.getImageData(x0, y0, w, h).data;
  const n = w * h, m = [0, 0, 0];
  for (let i = 0; i < n; i++) { m[0] += d[i * 4]; m[1] += d[i * 4 + 1]; m[2] += d[i * 4 + 2]; }
  m.forEach((v, i) => { m[i] = v / n; });
  const mean = (m[0] + m[1] + m[2]) / 3;
  let acc = 0;
  for (let i = 0; i < n; i++) { const v = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3; acc += (v - mean) ** 2; }
  const b = classify(m, Math.sqrt(acc / n), lat, lon, elevM);
  b.rgb = m.map(Math.round);
  return b;
}

// ---------------------------------------------------------------- season ----
/** 'spring' | 'summer' | 'autumn' | 'winter' (the tropics are always 'summer'). */
export function seasonOf(date, lat, biome) {
  if (Math.abs(lat) < 23.5 || (biome && biome.tropical)) return 'summer';
  const m = (date.getUTCMonth() + (lat < 0 ? 6 : 0)) % 12;
  const s = m >= 2 && m <= 3 ? 'spring' : m >= 4 && m <= 8 ? 'summer' : m >= 9 && m <= 10 ? 'autumn' : 'winter';
  if (Math.abs(lat) < 35 && s === 'winter') return 'autumn';          // mild subtropical winters
  return s;
}

// --------------------------------------------------------------- palette ----
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const SNOW = [0.80, 0.82, 0.86];

/** Colours (linear-ish albedo) for the ground and the plant sprites. */
export function paletteFor(biome, season, snowCover = 0, sat = null) {
  const k = biome.kind;
  const grass = { spring: [0.14, 0.26, 0.08], summer: [0.10, 0.20, 0.06], autumn: [0.22, 0.20, 0.07], winter: [0.26, 0.22, 0.12] }[season];
  const leaf = { spring: [0.12, 0.24, 0.06], summer: [0.06, 0.14, 0.04], autumn: [0.35, 0.16, 0.04], winter: [0.13, 0.10, 0.07] }[season];
  let g1, g2, gr = grass, lf = biome.tropical ? [0.05, 0.16, 0.05] : leaf;
  const dry = [0.30, 0.26, 0.12], conifer = [0.03, 0.09, 0.05];
  const rock = k === 'desert' ? [0.36, 0.27, 0.20] : [0.28, 0.26, 0.24];
  switch (k) {
    case 'forest': g1 = [0.07, 0.09, 0.04]; g2 = [0.10, 0.08, 0.05]; break;           // leaf litter
    case 'steppe': g1 = [0.20, 0.18, 0.09]; g2 = [0.27, 0.22, 0.12]; gr = mix(grass, dry, 0.55); break;
    case 'desert': g1 = [0.40, 0.30, 0.18]; g2 = [0.34, 0.24, 0.14]; gr = [0.26, 0.24, 0.10]; break;
    case 'tundra': g1 = [0.14, 0.14, 0.08]; g2 = [0.18, 0.15, 0.11]; gr = mix(grass, [0.2, 0.18, 0.1], 0.5); break;
    case 'urban':  g1 = [0.13, 0.14, 0.08]; g2 = [0.18, 0.18, 0.15]; break;
    case 'snow':   g1 = SNOW; g2 = SNOW; break;
    default:       g1 = mix(grass, [0.0, 0.0, 0.0], 0.45); g2 = mix(grass, [0.1, 0.1, 0.06], 0.1);   // grass
  }
  if (k === 'grass' || k === 'urban') { g1 = mix(g1, grass, 0.35); }
  if (sat && k === 'desert') {                                                       // let the real sand colour through
    const lin = sat.map(v => Math.pow(v / 255, 2.2) * 0.9);
    g1 = mix(g1, lin, 0.3); g2 = mix(g2, lin, 0.2);
  }
  const s = Math.max(0, Math.min(1, snowCover));
  return {
    ground: mix(g1, SNOW, s * 0.9), ground2: mix(g2, SNOW, s * 0.8),
    grass: mix(gr, SNOW, s * 0.5), leaf: mix(lf, SNOW, s * 0.4), conifer: mix(conifer, SNOW, s * 0.3), dry: mix(dry, SNOW, s * 0.5), rock,
    snow: s,
  };
}
