// The city skyline: districts of low and mid-rise, downtown clusters of towers with setbacks and spires, gaps between (js/sky/landscape.js). Run: node tests/unit/city.test.mjs
import { check, done } from '../lib/check.mjs';
const { citySkyline, proceduralSkyline } = await import('../../js/sky/landscape.js');
const N = 2048;
const city = (seed) => proceduralSkyline('city', 0.002, seed);
const mulberry = (s) => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const a = citySkyline(mulberry(5)), b = citySkyline(mulberry(5)), c = citySkyline(mulberry(6));
check('the same seed gives the same city, another seed another', a.near.every((v, i) => v === b.near[i]) && a.far.every((v, i) => v === b.far[i]) && a.far.some((v, i) => v !== c.far[i]));
check('every height is a finite number above the horizon', [a.near, a.far].every((l) => l.length === N && l.every((v) => Number.isFinite(v) && v > 0)));
const stats = (l) => { const max = Math.max(...l), sorted = [...l].sort((x, y) => x - y); return { max, med: sorted[N >> 1] }; };
const sn = stats(a.near), sf = stats(a.far);
check('the near layer is low and mid-rise (nothing over 8 degrees, a median under 3)', sn.max < 8 && sn.med < 3, JSON.stringify(sn));
check('downtown towers stand taller than the near buildings (over 5 degrees at the top), with sky between the clusters (a median under 2.5)', sf.max > 5 && sf.max < 14 && sf.med < 2.5, JSON.stringify(sf));
const runs = (l, thr) => { let n = 0, up = false; for (let i = 0; i < N; i++) { const hi = l[i] > thr; if (hi && !up) n++; up = hi; } return n; };
check('downtown is clusters: a handful of separate groups of towers, not one wall and not a hundred scraps', (() => { const r = runs(a.far, 3.2); return r >= 2 && r <= 40; })(), String(runs(a.far, 3.2)));
check('the tall towers are tall in one or two places (clusters), not evenly spread: the tallest tenth of the circle holds more than a third of the towers over 4 degrees', (() => { const hi = []; for (let i = 0; i < N; i++) if (a.far[i] > 4) hi.push(i); if (hi.length < 30) return false; let best = 0; for (let s0 = 0; s0 < N; s0 += 16) best = Math.max(best, hi.filter((i) => ((i - s0 + N) % N) < N / 10).length); return best > hi.length / 3; })());
check('some buildings have setbacks and spires: many distinct heights step up inside the tallest towers, and some narrow peaks rise above their surroundings', (() => { let steps = 0; for (let i = 1; i < N - 1; i++) { if (a.far[i] > 4 && Math.abs(a.far[i] - a.far[i - 1]) > 0.25 && Math.abs(a.far[i] - a.far[i - 1]) < 2) steps++; } return steps > 8; })());
check('the near layer has gaps: heights vary a lot from building to building (many different values)', new Set(Array.from(a.near, (v) => v.toFixed(2))).size > 40);

// the packed profile the shader reads: ground, near buildings, downtown; each at least as high as the one in front
const d = city(1).data;
check('the packed city has 4 floats a bin and each layer at least as high as the one before it', d.length === N * 4 && (() => { for (let i = 0; i < N; i++) if (d[i * 4 + 1] < d[i * 4] || d[i * 4 + 2] < d[i * 4 + 1]) return false; return true; })());
check('different places get different cities (the seed is the place)', city(1).data.some((v, i) => v !== city(2).data[i]));
check('other landscapes are untouched (hills still build)', proceduralSkyline('hills', 0.002, 1).data.length === N * 4);
done();
