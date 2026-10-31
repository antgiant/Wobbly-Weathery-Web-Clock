// Run: node tools/test-rain.mjs
import { assessRain, hoursFromHourly } from '../js/sky/rain.js';
let fails = 0;
const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + ' ' + x); if (!ok) fails++; };
const H = 3600e3, day = Date.parse('2026-06-10T00:00:00Z');       // offset 0: UTC is local
const at = (h) => day + h * H;
const mk = (spec) => Array.from({ length: 48 }, (_, i) => ({ t: at(i), mm: spec[i % 24] ?? 0, prob: 70 }));
const none = mk([]);
check('dry day: none', assessRain(none, at(8)).level === 'none');
const drizzle = mk(Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i, 0.1])));
check('all-day drizzle under 0.2 mm an hour: none', assessRain(drizzle, at(8)).level === 'none');
const shower = mk({ 15: 1.2, 16: 0.8 });
const a = assessRain(shower, at(8));
check('a 2 mm afternoon shower: umbrella', a.level === 'umbrella' && Math.abs(a.totalMm - 2) < 1e-9, JSON.stringify(a));
check('says when: 3 pm to 5 pm', a.from === at(15) && a.to === at(17));
check('not raining yet at 8 am', a.raining === false);
check('raining now at 3:30 pm', assessRain(shower, at(15.5)).raining === true);
check('the shower is over at 6 pm: none', assessRain(shower, at(18)).level === 'none');
check('half the hour left counts half: 3:30 pm sees 0.6 + 0.8', Math.abs(assessRain(shower, at(15.5)).totalMm - 1.4) < 1e-9);
check('0.9 mm total is not worth it', assessRain(mk({ 15: 0.5, 16: 0.4 }), at(8)).level === 'none');
check('a downpour hour (3 mm): slicker', assessRain(mk({ 14: 3 }), at(8)).level === 'slicker');
check('steady rain adding to 9 mm: slicker', assessRain(mk({ 9: 1.5, 10: 1.5, 11: 1.5, 12: 1.5, 13: 1.5, 14: 1.5 }), at(8)).level === 'slicker');
check('unlikely rain is ignored (prob 10%)', assessRain(mk({ 15: 5 }).map(h => ({ ...h, prob: 10 })), at(8)).level === 'none');
check('no probability given (archive): trusts the amount', assessRain(mk({ 15: 3 }).map(h => ({ ...h, prob: null })), at(8)).level === 'slicker');
check('rain after 11 pm does not count', assessRain(mk({ 23: 5 }), at(8)).level === 'none');
check('rain tomorrow does not count', assessRain(mk({}).map((h, i) => (i === 30 ? { ...h, mm: 6 } : h)), at(8)).level === 'none');
check('snow is called snow', assessRain(mk({ 15: 2 }).map(h => ({ ...h, snow: h.mm ? 2 : 0 })), at(8)).kind === 'snow');
// the day ends at 11 pm in the place's own time: +10 h
const syd = (h) => day + h * H - 10 * H;                           // local hour h in a UTC+10 place
const sydHours = Array.from({ length: 48 }, (_, i) => ({ t: syd(i), mm: i === 22 ? 4 : 0, prob: 80 }));
check('local 11 pm cut-off uses the place\'s offset', assessRain(sydHours, syd(20), 10 * 3600).level === 'slicker' && assessRain(sydHours.map((h, i) => ({ ...h, mm: i === 23 ? 4 : 0 })), syd(20), 10 * 3600).level === 'none');
const parsed = hoursFromHourly({ time: ['2026-06-10T14:00'], precipitation: [2], precipitation_probability: [60], snowfall: [0] }, 3600);
check('parses Open-Meteo local times with the offset', parsed[0].t === Date.parse('2026-06-10T13:00:00Z') && parsed[0].mm === 2);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
