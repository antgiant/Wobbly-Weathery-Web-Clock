// Skyline profiles: three ridge layers (near / mid / far) as elevation angles
// (radians above the local horizontal) for 2048 azimuth bins, azimuth running
// from -180 deg (bin 0) to +180 deg. Layers are cumulative: each is at least
// as high as the one in front of it, which is how the shader picks the
// nearest layer covering a pixel.

const N = 2048;

// mulberry32: tiny seeded PRNG so a given place always gets the same skyline
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// periodic 1-D value noise over the azimuth circle
function circularNoise(rand, cells) {
  const v = Array.from({ length: cells }, () => rand());
  return (u) => {                       // u in [0,1)
    const x = u * cells;
    const i = Math.floor(x), f = x - i;
    const s = f * f * (3 - 2 * f);
    return v[i % cells] * (1 - s) + v[(i + 1) % cells] * s;
  };
}
function fbm(rand, baseCells, octaves) {
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(circularNoise(rand, baseCells << o));
  return (u) => {
    let a = 0.5, s = 0, n = 0;
    for (let o = 0; o < octaves; o++) { s += a * layers[o](u); n += a; a *= 0.5; }
    return s / n;
  };
}

export const LANDSCAPES = {
  flat:      { label: 'Flat plain',  albedo: [0.13, 0.17, 0.08], haze: [0.35, 0.0, 0.0],  ocean: false },
  ocean:     { label: 'Ocean',       albedo: [0.02, 0.05, 0.07], haze: [0.0, 0.0, 0.0],   ocean: true  },
  hills:     { label: 'Rolling hills', albedo: [0.12, 0.17, 0.07], haze: [0.35, 0.30, 0.55], ocean: false },
  mountains: { label: 'Mountains',   albedo: [0.12, 0.15, 0.09], haze: [0.30, 0.28, 0.60], ocean: false },
  desert:    { label: 'Desert',      albedo: [0.36, 0.27, 0.17], haze: [0.35, 0.28, 0.55], ocean: false },
  city:      { label: 'City',        albedo: [0.14, 0.14, 0.15], haze: [0.30, 0.35, 0.60], ocean: false },
};

/** Horizon dip in radians for an eye `h` km above the surface (with standard refraction). */
export function horizonDip(hKm) {
  return Math.sqrt(2 * Math.max(hKm, 0) / 6371) * 0.93;
}

function fill(fn) {
  const a = new Float32Array(N);
  for (let i = 0; i < N; i++) a[i] = fn(i / N);
  return a;
}

function pack(near, mid, far) {
  const out = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const r = near[i];
    const g = Math.max(mid[i], r);
    const b = Math.max(far[i], g);
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 0;
  }
  return out;
}


/**
 * A city's skyline, in degrees above the horizon for each of the N azimuth bins: the nearer layer is low and mid-rise (rows of ordinary buildings in uneven districts: ragged
 * heights, gaps, the odd taller block), the farther layer is downtown: two to four clusters of towers that stand tallest at the middle of the cluster, a few with setbacks (the top
 * narrower than the base) and a spire or antenna on some, with open sky between the clusters.
 * Pure: the same `rand` gives the same city. Exported for tests.
 * @returns {{near: Float32Array, far: Float32Array}}
 */
export function citySkyline(rand) {
  const near = new Float32Array(N).fill(0.25), far = new Float32Array(N).fill(0.4);
  const bin = (u) => Math.floor(((u % 1) + 1) % 1 * N);
  const put = (arr, u0, u1, h) => { for (let i = bin(u0), n = Math.max(1, Math.round((u1 - u0) * N)); n > 0; n--, i = (i + 1) % N) if (arr[i] < h) arr[i] = h; };
  const dens = fbm(rand, 7, 3);                                          // districts: dense mid-rise here, low-rise and open there
  for (let u = 0; u < 1;) {
    const w = 0.003 + rand() * 0.014, d = dens(u);
    if (rand() < 0.1 + 0.3 * (1 - d)) { u += w * (0.5 + rand()); continue; }              // a gap: a street, a park, a car park
    const h = 0.3 + (0.6 + 2.6 * d * d) * (0.3 + 0.7 * rand()) + (rand() < 0.06 ? 1.2 + 1.5 * rand() : 0);
    put(near, u, u + w, h);
    if (h > 1.6 && rand() < 0.3) put(near, u + w * 0.2, u + w * 0.8, h + 0.25 + 0.4 * rand());     // a plant room on the roof
    u += w * (1 + 0.15 * rand());
  }
  const clusters = 2 + Math.floor(rand() * 3);
  for (let c = 0; c < clusters; c++) {
    const centre = rand(), spread = 0.025 + 0.05 * rand(), tall = 4.0 + 5.0 * rand(), count = 8 + Math.floor(rand() * 14);
    for (let k = 0; k < count; k++) {
      const off = (rand() + rand() + rand() - 1.5) * spread * 1.6, close = Math.exp(-(off * off) / (2 * (spread * 0.55) ** 2));      // taller toward the middle of the cluster
      const w = 0.0025 + rand() * 0.006, u0 = centre + off - w / 2, h = 1.2 + tall * close * (0.45 + 0.55 * rand());
      put(far, u0, u0 + w, h);
      if (h > 4 && rand() < 0.45) { put(far, u0 + w * 0.18, u0 + w * 0.82, h + 0.35 + 0.35 * rand()); if (rand() < 0.5) put(far, u0 + w * 0.32, u0 + w * 0.68, h + 0.7 + 0.5 * rand()); }   // setbacks: the top steps in
      if (h > 4.5 && rand() < 0.3) put(far, u0 + w * 0.47, u0 + w * 0.53 + 0.0004, h + 0.9 + 1.2 * rand());                                                                                   // a spire or an antenna
    }
  }
  return { near, far };
}

/**
 * Procedural skyline for a landscape type.
 * @returns {{data: Float32Array, albedo: number[], haze: number[], ocean: boolean}}
 */
export function proceduralSkyline(type, eyeKm, seed = 1) {
  const spec = LANDSCAPES[type] || LANDSCAPES.flat;
  const dip = horizonDip(eyeKm);
  const rand = rng(seed * 7919 + 13);
  const D = Math.PI / 180;
  const ground = fill(() => -dip);                      // plane / water below the horizon
  const none = fill(() => -1.5);                        // never selected

  let data;
  switch (type) {
    case 'hills': {
      const n1 = fbm(rand, 5, 4), n2 = fbm(rand, 4, 5);
      data = pack(ground,
        fill(u => (0.8 + 2.2 * n1(u)) * D),
        fill(u => (1.8 + 4.0 * n2(u)) * D));
      break;
    }
    case 'mountains': {
      const n1 = fbm(rand, 6, 5), n2 = fbm(rand, 5, 6);
      const ridge = (n) => (u) => { const v = n(u); return 1 - Math.abs(2 * v - 1); };   // jagged crests
      const r1 = ridge(n1), r2 = ridge(n2);
      data = pack(ground,
        fill(u => (1.0 + 7.0 * Math.pow(r1(u), 1.6)) * D),
        fill(u => (3.0 + 12.0 * Math.pow(r2(u), 1.8)) * D));
      break;
    }
    case 'desert': {
      const n1 = fbm(rand, 7, 3);
      data = pack(ground, fill(u => (0.3 + 1.4 * n1(u)) * D), none);
      break;
    }
    case 'city': {
      const { near, far } = citySkyline(rand);
      data = pack(ground, near.map((h) => h * D), far.map((h) => h * D));
      break;
    }
    default:
      data = pack(ground, none, none);
  }
  return { data, albedo: spec.albedo, haze: spec.haze, ocean: spec.ocean };
}

// ---------------------------------------------------------------------------
// Real terrain from a public elevation service.
//
// Open-Meteo's elevation endpoint (Copernicus 90 m DEM, CORS-enabled, no key)
// accepts up to 100 coordinates per request, so we sample 32 azimuths x 3
// distances and turn them into silhouette angles, subtracting earth curvature
// (with standard refraction).

export const DEM_AZIMUTHS = 32;
export const DEM_DISTANCES_KM = [3, 12, 40];

export function demSamplePoints(lat, lon) {
  const lats = [], lons = [];
  const R = 6371;
  for (let a = 0; a < DEM_AZIMUTHS; a++) {
    const az = (a / DEM_AZIMUTHS) * 2 * Math.PI - Math.PI;
    for (const dist of DEM_DISTANCES_KM) {
      const ang = dist / R;
      const la1 = lat * Math.PI / 180, lo1 = lon * Math.PI / 180;
      const la2 = Math.asin(Math.sin(la1) * Math.cos(ang) + Math.cos(la1) * Math.sin(ang) * Math.cos(az));
      const lo2 = lo1 + Math.atan2(Math.sin(az) * Math.sin(ang) * Math.cos(la1), Math.cos(ang) - Math.sin(la1) * Math.sin(la2));
      lats.push(+(la2 * 180 / Math.PI).toFixed(4));
      lons.push(+(((lo2 * 180 / Math.PI + 540) % 360) - 180).toFixed(4));
    }
  }
  return { lats, lons };
}

export async function fetchDem(lat, lon, signal) {
  const { lats, lons } = demSamplePoints(lat, lon);
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(',')}&longitude=${lons.join(',')}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('elevation HTTP ' + res.status);
  const j = await res.json();
  if (!Array.isArray(j.elevation) || j.elevation.length !== lats.length) throw new Error('bad elevation payload');
  return j.elevation;
}

/**
 * Convert DEM samples into a skyline.
 * @param {number[]} elev   metres, layout [az0 d0, az0 d1, az0 d2, az1 d0, ...]
 * @param {number} eyeElevM metres above sea level of the observer (ground + eye)
 */
export function demSkyline(elev, eyeElevM) {
  const dip = horizonDip(eyeElevM / 1000);
  const R = 6371, k = 0.87;                      // refraction-corrected curvature
  const angles = [0, 1, 2].map(() => new Array(DEM_AZIMUTHS).fill(0));
  // elevation angle of each terrain sample above the observer's local horizontal
  for (let di = 0; di < 3; di++) {
    for (let a = 0; a < DEM_AZIMUTHS; a++) {
      const dist = DEM_DISTANCES_KM[di] * 1000;
      const h = Number.isFinite(elev[a * 3 + di]) ? elev[a * 3 + di] : 0;
      const drop = (dist * dist) / (2 * R * 1000) * k;      // metres the surface falls away
      angles[di][a] = Math.atan2(h - drop - eyeElevM, dist);
    }
  }
  const smooth = (arr) => (u) => {                // cosine interpolation around the circle
    const x = u * DEM_AZIMUTHS, i = Math.floor(x), f = x - i;
    const s = (1 - Math.cos(f * Math.PI)) / 2;
    return arr[i % DEM_AZIMUTHS] * (1 - s) + arr[(i + 1) % DEM_AZIMUTHS] * s;
  };
  const rand = rng(4242);
  const jitter = fbm(rand, 16, 4);
  const profile = (di) => {
    const f = smooth(angles[di]);
    return fill(u => {
      const base = Math.max(f(u), -dip);
      // add fine ridge detail proportional to how high the terrain stands
      return base + Math.max(base, 0) * 0.35 * (jitter(u) - 0.5);
    });
  };
  const n3 = profile(0), n12 = profile(1), n40 = profile(2);
  // the 3 km sample becomes the nearest solid layer when it rises above the plane
  const nearLayer = fill(u => 0);
  for (let i = 0; i < N; i++) nearLayer[i] = Math.max(-dip, n3[i]);
  const allFlat = angles.every(l => l.every(v => v <= 0.0005));
  const maxElevM = Math.max(...elev.filter(Number.isFinite));
  const sea = elev.every(v => !Number.isFinite(v) || v <= 0.5) && eyeElevM <= 5;
  const data = pack(nearLayer, n12, n40);
  return { data, albedo: LANDSCAPES.hills.albedo, haze: [0.3, 0.35, 0.6], ocean: sea, allFlat, maxElevM };
}

export const SKYLINE_BINS = N;
