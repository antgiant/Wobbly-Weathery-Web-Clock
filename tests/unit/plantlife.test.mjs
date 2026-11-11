// Plant life by place: Mediterranean, savanna and alpine biomes, palms in warm places, evergreen broadleaf trees (js/sky/biome.js, js/sky/plants.js). Run: node tests/unit/plantlife.test.mjs
import { check, done } from '../lib/check.mjs';
const B = await import('../../js/sky/biome.js');
const P = await import('../../js/sky/plants.js');
const GREEN = [80, 100, 70];                                          // a green tile: classify() calls it grass at these places
const at = (lat, lon, elev = 0, rgb = GREEN) => B.classify(rgb, 12, lat, lon, elev);
const T = { GRASS: 0, SHRUB: 1, BROAD: 2, CONIFER: 3, CACTUS: 4, DRY: 5, FLOWER: 6, ROCK: 7, PALM: 8, ACACIA: 9 };
const share = (b, type, season = 'summer') => { const sp = P.species(b, season), tot = sp.reduce((a, r) => a + r[1], 0); return sp.filter((r) => r[0] === type).reduce((a, r) => a + r[1], 0) / tot; };

const athens = at(37.98, 23.73), la = at(34.05, -118.24), london = at(51.5, -0.12), nairobi = at(-1.29, 36.82), sydney = at(-33.87, 151.2), chicago = at(41.9, -87.6);
check('the Mediterranean basin, California, Chile, the Cape and southern Australia are Mediterranean; London, Chicago and Nairobi are not', athens.mediterranean && la.mediterranean && at(-33.4, -70.6).mediterranean && at(-34, 18.5).mediterranean && at(-34.9, 138.6).mediterranean && !london.mediterranean && !chicago.mediterranean && !nairobi.mediterranean);
check('Mediterranean plants are scrub and dry grass with cypress and pine, and few broadleaf trees', share(athens, T.SHRUB) > 0.2 && share(athens, T.DRY) > 0.25 && share(athens, T.CONIFER) > 0.05 && share(athens, T.BROAD) <= 0.06 && share(athens, T.CACTUS) === 0);
check('the tropical grassland of Africa and Australia is savanna: acacias, dry grass, few other trees; a northern grass is not', nairobi.savanna && at(-15, 133).savanna && !chicago.savanna && share(nairobi, T.ACACIA) > 0.02 && share(nairobi, T.DRY) > 0.4 && share(nairobi, T.BROAD) <= 0.03);
check('above the tree line it is alpine: the Alps at 2800 m and the Himalaya at 4500 m, but Denver at 1600 m and Mexico City at 2240 m are not', at(46.5, 8, 2800).alpine && at(28, 86, 4500).alpine && !at(39.7, -105, 1600).alpine && !at(19.4, -99.1, 2240).alpine && !at(46.5, 8, 800).alpine);
check('alpine plants are meadow, flowers and rock: no broadleaf trees, almost no conifers, and the rock is the most common', (() => { const a = at(46.5, 8, 2800); return share(a, T.BROAD) === 0 && share(a, T.CONIFER) < 0.05 && share(a, T.ROCK) > 0.25; })());
check('the tree line falls with latitude (about 2250 m in the Alps, 1300 at 70 degrees) and never below 0', B.treeline(0) === 4100 && Math.abs(B.treeline(46) - 2260) < 1 && Math.abs(B.treeline(70) - 1300) < 1 && B.treeline(89) >= 0);
check('palms stand in warm cities and grassland (under 32 degrees), not in London or Chicago, nor above the trees', share(at(25.8, -80.2), T.PALM) > 0 && share({ ...at(25.8, -80.2), kind: 'urban' }, T.PALM) > 0 && share(chicago, T.PALM) === 0 && share(london, T.PALM) === 0 && share(at(28, 86, 4500), T.PALM) === 0);
check('every list of species has weights and size ranges that make sense, in every biome and season', (() => { for (const b of [athens, la, london, nairobi, sydney, chicago, at(46.5, 8, 2800), at(25.8, -80.2), { kind: 'desert', region: 'americas', lat: 33 }, { kind: 'tundra', lat: 70 }, { kind: 'snow', lat: 80 }, { kind: 'urban', lat: 40 }, { kind: 'forest', conifer: true, lat: 60 }, { kind: 'forest', tropical: true, lat: 3 }, { kind: 'steppe', lat: 45 }]) for (const season of ['spring', 'summer', 'autumn', 'winter']) { const sp = P.species(b, season); if (!sp.length || !sp.every((r) => r[1] > 0 && r[2] > 0 && r[3] > r[2] && r[4] > 0 && r[5] >= r[4])) return false; } return true; })());
check('plants are generated for the new biomes (right count, far to near)', (() => { for (const b of [athens, nairobi, at(46.5, 8, 2800)]) { const g = P.generatePlants(b, { count: 500, seed: 3, season: 'summer' }); if (g.count !== 500 || g.data.length !== 3000) return false; for (let i = 1; i < g.count; i++) if (Math.hypot(g.data[i * 6], g.data[i * 6 + 1]) > Math.hypot(g.data[(i - 1) * 6], g.data[(i - 1) * 6 + 1]) + 1e-6) return false; } return true; })());

// leaves: the evergreen broadleaf trees keep theirs
const fol = (b, lat, m) => B.foliage(new Date(Date.UTC(2026, m, 15, 12)), lat, b);
check('eucalyptus, olive and rainforest trees stay in leaf all year: Sydney, Athens, LA, the tropics; Chicago bares in January', [sydney, athens, la, { ...chicago, tropical: true }].every((b, i) => [0, 6].every((m) => fol(b, [-33.87, 37.98, 34.05, 5][i], m).cover === 1)) && fol(chicago, 41.9, 0).cover === 0);
const pal = (b, season) => B.paletteFor(b, season, 0, null, B.foliage(new Date(Date.UTC(2026, 0, 15, 12)), b.lat, b)).leaf;
check('their leaf colour is their own: olive for the Mediterranean, grey-green for Australia, and the same in every season', JSON.stringify(pal(athens, 'winter')) === JSON.stringify(pal(athens, 'summer')) && pal(athens, 'summer')[1] > pal(athens, 'summer')[0] && pal(sydney, 'summer')[2] > pal(chicago, 'summer')[2]);
check('the old behaviour is kept where nothing new applies (a green forest in Ohio has the same trees as before)', (() => { const o = at(40, -83, 300, [30, 40, 25]); return o.kind === 'forest' && !o.mediterranean && !o.savanna && !o.alpine && share(o, T.BROAD) > 0.2; })());
done();
