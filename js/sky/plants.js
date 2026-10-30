// Plant placement. Instances are [x east m, z north m, height m, type, seed, variant], sorted far to near
// (the camera only turns, so one sort is enough for alpha blending). See glsl-plants.js for the types.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T = { GRASS: 0, SHRUB: 1, BROAD: 2, CONIFER: 3, CACTUS: 4, DRY: 5, FLOWER: 6, ROCK: 7, PALM: 8, ACACIA: 9 };

// [type, weight, rMin, rMax, hMin, hMax]
function species(b, season) {
  const flowers = season === 'spring' || season === 'summer';
  switch (b.kind) {
    case 'forest':
      if (b.tropical) return [[T.PALM, .08, 30, 130, 6, 14], [T.BROAD, .16, 34, 150, 8, 18], [T.SHRUB, .12, 9, 70, .6, 1.4], [T.GRASS, .50, 3, 40, .35, .8], [T.ROCK, .02, 4, 50, .2, .5], [T.DRY, .12, 3, 30, .2, .4]];
      if (b.conifer) return [[T.CONIFER, .26, 30, 160, 8, 20], [T.SHRUB, .08, 9, 70, .5, 1.2], [T.GRASS, .30, 3, 35, .25, .6], [T.DRY, .22, 3, 30, .2, .4], [T.ROCK, .05, 4, 50, .2, .6], [T.BROAD, .09, 35, 150, 7, 14]];
      return [[T.BROAD, .22, 32, 160, 7, 16], [T.SHRUB, .10, 9, 70, .6, 1.4], [T.GRASS, .38, 3, 35, .3, .7], [T.DRY, .17, 3, 30, .2, .4], [T.ROCK, .05, 4, 50, .2, .6], [T.CONIFER, .08, 38, 150, 8, 16]];
    case 'steppe':
      return [[T.DRY, .50, 3, 50, .2, .45], [T.GRASS, .15, 3, 40, .2, .45], [T.SHRUB, .12, 6, 100, .5, 1.1], [T.ROCK, .07, 4, 70, .2, .6], [T.BROAD, .02, 40, 150, 4, 8]];
    case 'desert':
      if (b.region === 'americas') return [[T.CACTUS, .08, 14, 130, 2, 5], [T.SHRUB, .20, 3, 80, .5, 1], [T.DRY, .40, 3, 50, .15, .35], [T.ROCK, .22, 8, 80, .15, .6]];
      if (b.region === 'africa' || b.region === 'oceania') return [[T.ACACIA, .05, 30, 150, 4, 8], [T.DRY, .50, 3, 50, .15, .35], [T.SHRUB, .15, 4, 80, .4, .9], [T.ROCK, .26, 8, 80, .15, .6]];
      return [[T.DRY, .50, 3, 50, .15, .35], [T.SHRUB, .20, 4, 80, .4, .9], [T.ROCK, .26, 8, 80, .15, .6]];
    case 'tundra':
      return [[T.DRY, .40, 3, 40, .1, .25], [T.GRASS, .20, 3, 40, .12, .3], [T.ROCK, .22, 8, 80, .15, .5], [T.SHRUB, .10, 5, 60, .3, .6]];
    case 'urban':
      return [[T.GRASS, .55, 3, 35, .15, .35], [T.BROAD, .15, 25, 120, 6, 14], [T.SHRUB, .16, 4, 60, .6, 1.3], [T.CONIFER, .04, 20, 120, 6, 12], [T.ROCK, .02, 4, 40, .2, .4]];
    case 'snow':
      return [[T.ROCK, .8, 6, 80, .2, .8], [T.DRY, .2, 3, 30, .1, .2]];
    default:                                                                                 // grass
      return [[T.GRASS, .46, 3, 45, .25, .55], [flowers ? T.FLOWER : T.GRASS, .12, 3, 30, .3, .6], [T.DRY, .16, 3, 40, .2, .4], [T.SHRUB, .07, 9, 90, .6, 1.4], [T.BROAD, .06, 30, 150, 5, 13], [T.ROCK, .03, 4, 60, .2, .6], [T.DRY, .09, 3, 40, .2, .4]];
  }
}

/**
 * @param {object} biome  from biome.js
 * @param {{count:number, seed:number, season:string}} opt
 * @returns {{data: Float32Array, count: number}}
 */
export function generatePlants(biome, { count, seed, season }) {
  const rand = rng(seed * 2654435761 + 99);
  const sp = species(biome, season);
  const total = sp.reduce((a, s) => a + s[1], 0);
  const n = Math.round(count * (biome.kind === 'snow' ? 0.3 : biome.kind === 'desert' ? 0.7 : 1));
  const items = [];
  for (let i = 0; i < n; i++) {
    let pick = rand() * total, s = sp[0];
    for (const c of sp) { if ((pick -= c[1]) <= 0) { s = c; break; } }
    const r = s[2] * Math.pow(s[3] / s[2], rand());             // log-uniform: plenty close up, thinning out
    const ang = rand() * Math.PI * 2;
    items.push({ x: Math.sin(ang) * r, z: Math.cos(ang) * r, h: s[4] + (s[5] - s[4]) * rand(), t: s[0], a: rand(), b: rand(), r });
  }
  items.sort((p, q) => q.r - p.r);                              // far to near
  const data = new Float32Array(items.length * 6);
  items.forEach((p, i) => data.set([p.x, p.z, p.h, p.t, p.a, p.b], i * 6));
  return { data, count: items.length };
}
