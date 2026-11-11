// Seasonal foliage: leaf cover, new green and autumn colour through the year, by place (js/sky/biome.js `foliage`). Run: node tests/unit/foliage.test.mjs
import { check, done } from '../lib/check.mjs';
const { foliage, paletteFor } = await import('../../js/sky/biome.js');
const at = (s) => new Date(s + 'T12:00:00Z');
const forest = { kind: 'forest' };
const NY = 40.7, MEL = -37.8, OSLO = 59.9, SING = 1.3, PHX = 33.4;

const ny = (s, c) => foliage(at(s), NY, forest, c);
check('New York: bare in January, buds in early April, in leaf by late May, full in July', ny('2026-01-15').cover === 0 && ny('2026-04-05').cover < 0.15 && ny('2026-05-28').cover > 0.95 && ny('2026-07-15').cover === 1 && ny('2026-07-15').autumn === 0);
check('New York: green in September, turning through October, mostly bare by late November, bare by Christmas', ny('2026-09-05').autumn < 0.15 && ny('2026-10-15').autumn > 0.5 && ny('2026-10-15').cover > 0.5 && ny('2026-11-25').cover < 0.35 && ny('2026-12-22').cover === 0);
check('new leaves are bright in spring only', ny('2026-05-10').fresh > 0.5 && ny('2026-08-01').fresh === 0 && ny('2026-01-15').fresh === 0);
check('a gradual change, not four jumps: leaf cover rises through April and May without a step (no day-to-day change above 8%)', (() => { let prev = ny('2026-03-25').cover, worst = 0; for (let d = 0; d < 80; d++) { const c = foliage(new Date(Date.UTC(2026, 2, 25 + d, 12)), NY, forest).cover; worst = Math.max(worst, Math.abs(c - prev)); prev = c; } return worst < 0.08; })());
check('the cover only goes up in spring and only down in autumn (never wobbles)', (() => { let up = true, down = true, p = ny('2026-03-01').cover; for (let d = 1; d < 120; d++) { const c = foliage(new Date(Date.UTC(2026, 2, 1 + d, 12)), NY, forest).cover; if (c < p - 1e-9) up = false; p = c; } p = ny('2026-09-15').cover; for (let d = 1; d < 120; d++) { const c = foliage(new Date(Date.UTC(2026, 8, 15 + d, 12)), NY, forest).cover; if (c > p + 1e-9) down = false; p = c; } return up && down; })());
check('the southern hemisphere is half a year on: Melbourne bare in July, full in January, turning in April', foliage(at('2026-07-15'), MEL, forest).cover < 0.1 && foliage(at('2026-01-15'), MEL, forest).cover === 1 && foliage(at('2026-04-15'), MEL, forest).autumn > 0.5);
check('further north leaves open later and fall earlier: Oslo is bare when New York is in leaf, in late April and again in early November', foliage(at('2026-05-05'), OSLO, forest).cover < ny('2026-05-05').cover && foliage(at('2026-10-25'), OSLO, forest).cover < ny('2026-10-25').cover);
check('the tropics, the desert and snow have no leaf season', [foliage(at('2026-01-15'), SING, forest), foliage(at('2026-07-15'), SING, forest), foliage(at('2026-01-15'), PHX, { kind: 'desert' }), foliage(at('2026-01-15'), NY, { kind: 'snow' }), foliage(at('2026-01-15'), NY, { tropical: true, kind: 'forest' })].every((f) => f.cover === 1 && f.autumn === 0));
check('the subtropics keep most of their leaves through a mild winter (at least 70% in January)', foliage(at('2026-01-15'), 30, forest).cover >= 0.7 && foliage(at('2026-01-15'), 30, forest).cover < 1.0001);
check('a warm spell in March opens leaves early, a cold April holds them back', ny('2026-03-25', { t15: 16, tPrev: 6 }).cover > ny('2026-03-25').cover + 0.2 && ny('2026-04-25', { t15: 1, tPrev: 3 }).cover < ny('2026-04-25').cover);
check('a cold snap in September turns and drops leaves early; a warm autumn lets them stay', ny('2026-09-25', { t15: 2, tPrev: 14 }).autumn > ny('2026-09-25').autumn + 0.3 && ny('2026-10-20', { t15: 16, tPrev: 15 }).cover >= ny('2026-10-20').cover - 1e-9);
check('everything is within 0 to 1, whatever the day, place or weather', (() => { for (const lat of [-60, -37.8, -10, 0, 25, 33, 40.7, 52, 70]) for (let m = 0; m < 12; m++) for (const c of [null, { t15: -10, tPrev: 0 }, { t15: 30, tPrev: 20 }]) { const f = foliage(new Date(Date.UTC(2026, m, 15, 12)), lat, forest, c); if (![f.cover, f.autumn, f.fresh].every((v) => v >= 0 && v <= 1 && Number.isFinite(v))) return false; } return true; })());
check('rubbish climate is ignored', ny('2026-05-05', { t15: NaN, tPrev: null }).cover === ny('2026-05-05').cover);

// the palette follows the leaves
const lf = (s) => paletteFor(forest, 'summer', 0, null, foliage(at(s), NY, forest)).leaf;
const summer = lf('2026-07-15'), autumn = lf('2026-10-20'), winter = lf('2026-01-15'), spring = lf('2026-05-12');
check('palette: summer green, new green brighter, autumn red-orange, winter bare brown', summer[1] > summer[0] && spring[1] > summer[1] && autumn[0] > autumn[1] && winter[0] > winter[1] * 0.9 && Math.abs(winter[0] - 0.13) < 0.02);
check('palette: the leaf cover goes to the shader (1 in summer, 0 in winter); without foliage it is 1 and the colours are as before', paletteFor(forest, 'summer', 0, null, foliage(at('2026-07-15'), NY, forest)).leafCover === 1 && paletteFor(forest, 'winter', 0, null, foliage(at('2026-01-15'), NY, forest)).leafCover === 0 && paletteFor(forest, 'autumn').leafCover === 1 && JSON.stringify(paletteFor(forest, 'autumn').leaf) === JSON.stringify([0.35, 0.16, 0.04]));
done();
