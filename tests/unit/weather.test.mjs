// Historical weather mapping and weather-driven seasons. Run: node tests/unit/weather.mjs
import { serviceFor, hoursOf, weatherFromDay, climateOf } from '../../js/sky/weather.js';
import { seasonFromClimate } from '../../js/sky/biome.js';
import { unitFor, hour24 } from '../../js/units.js';
let fails = 0;
const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + ' ' + x); if (!ok) fails++; };
const now = Date.parse('2026-10-31T12:00:00Z');
check('last week -> forecast service', serviceFor(new Date('2026-10-20T00:00:00Z'), now) === 'forecast');
check('three years ago -> archive', serviceFor(new Date('2023-07-04T00:00:00Z'), now) === 'archive');
check('next week -> forecast service', serviceFor(new Date('2026-11-05T00:00:00Z'), now) === 'forecast');
check('a year ahead -> no data', serviceFor(new Date('2027-10-31T00:00:00Z'), now) === null);

const hourly = { time: Array.from({ length: 24 }, (_, i) => `2023-07-04T${String(i).padStart(2, '0')}:00`),
  temperature_2m: Array.from({ length: 24 }, (_, i) => 20 + i / 4), cloud_cover_low: Array(24).fill(0).map((_, i) => (i === 15 ? 100 : 10)),
  cloud_cover_mid: Array(24).fill(0), cloud_cover_high: Array(24).fill(0), precipitation: Array(24).fill(0).map((_, i) => (i === 15 ? 4 : 0)),
  rain: Array(24).fill(0).map((_, i) => (i === 15 ? 4 : 0)), weather_code: Array(24).fill(1), wind_speed_10m: Array(24).fill(3), wind_direction_10m: Array(24).fill(270) };
const day = { day: '2023-07-04', hours: hoursOf(hourly) };
check('24 hours', day.hours.length === 24);
const w15 = weatherFromDay(day, new Date('2023-07-04T15:10:00Z')), w03 = weatherFromDay(day, new Date('2023-07-04T03:00:00Z'));
check('rainy hour is cloudy and wet', w15.cover[0] === 1 && w15.precip > 0.5, JSON.stringify([w15.cover, w15.precip]));
check('quiet hour is clear-ish and dry', w03.cover[0] === 0.1 && w03.precip === 0);
check('no visibility data: rain lowers it', w15.visKm < w03.visKm, `${w15.visKm} < ${w03.visKm}`);
check('temperature carried', Math.abs(w15.tempC - 23.75) < 1e-9);

const apr = new Date('2026-04-10T00:00:00Z'), jul = new Date('2026-07-10T00:00:00Z'), jan = new Date('2026-01-15T00:00:00Z');
check('calendar only: April is spring', seasonFromClimate(apr, 45, null, null) === 'spring');
check('warm spell: a hot April is already summer', seasonFromClimate(apr, 45, null, { t15: 18, tPrev: 12 }) === 'summer');
check('cold April stays winter-ish', seasonFromClimate(apr, 45, null, { t15: 0.5, tPrev: -3 }) === 'winter');
check('cool rising April is spring', seasonFromClimate(apr, 45, null, { t15: 8, tPrev: 4 }) === 'spring');
check('cool spell in July is still summer', seasonFromClimate(jul, 45, null, { t15: 11, tPrev: 15 }) === 'summer');
check('falling 10C in October-ish is autumn', seasonFromClimate(new Date('2026-10-20T00:00:00Z'), 45, null, { t15: 10, tPrev: 14 }) === 'autumn');
check('warm January spell is spring, not summer', seasonFromClimate(jan, 45, null, { t15: 17, tPrev: 15 }) === 'spring');
check('tropics ignore it', seasonFromClimate(apr, 5, null, { t15: 0, tPrev: 0 }) === 'summer');
check('southern hemisphere flips the calendar', seasonFromClimate(new Date('2026-10-10T00:00:00Z'), -35, null, null) === 'spring');
check('climate needs a month of data', climateOf([1, 2, 3]) === null && climateOf(Array(30).fill(10)).t15 === 10);

const nav = (lang) => unitFor('auto', lang);
check('en-US uses Fahrenheit', nav('en-US') === 'f');
check('en-GB uses Celsius', nav('en-GB') === 'c');
check('plain "en" is treated as US English', nav('en') === 'f');
check('de-DE uses Celsius', nav('de-DE') === 'c');
check('a chosen unit wins over the region', unitFor('c', 'en-US') === 'c' && unitFor('f', 'de-DE') === 'f');
check('a chosen 24-hour setting wins', hour24(true) === true && hour24(false) === false);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
