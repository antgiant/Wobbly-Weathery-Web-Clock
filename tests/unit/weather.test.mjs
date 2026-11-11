// Historical weather mapping and weather-driven seasons. Run: node tests/unit/weather.mjs
import { serviceFor, hoursOf, weatherFromDay, climateOf, mapOpenMeteo, PRESETS, CLEAR, MODES } from '../../js/sky/weather.js';
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

// ---- the wider weather model: sleet, freezing rain, hail, lightning, rime, dust, gusts ----
{
  const m = (cur, air) => mapOpenMeteo({ temperature_2m: 10, ...cur }, air);
  const fr = m({ weather_code: 67, rain: 2, precipitation: 2, temperature_2m: -2 }), dr = m({ weather_code: 56, precipitation: 0.5, rain: 0.5 });
  check('freezing rain (67) and drizzle (56, 57) are marked', fr.freezing === 1 && dr.freezing === 0.4 && m({ weather_code: 57, rain: 1, precipitation: 1 }).freezing === 0.7 && m({ weather_code: 66, rain: 1, precipitation: 1 }).freezing === 0.7 && m({ weather_code: 61, rain: 1, precipitation: 1 }).freezing === 0);
  check('hail comes with thunderstorm codes 96 and 99 only', m({ weather_code: 99, rain: 4, precipitation: 4 }).hail === 1 && m({ weather_code: 96, rain: 4, precipitation: 4 }).hail === 0.5 && m({ weather_code: 95, rain: 4, precipitation: 4 }).hail === 0);
  const mixed = m({ rain: 1, snowfall: 0.8333333, precipitation: 2 }), pure = m({ rain: 2, precipitation: 2 }), snowy = m({ snowfall: 2, precipitation: 2.4 });
  check('sleet is rain and snow together: equal parts give 1, none of one kind gives 0', Math.abs(mixed.sleet - 1) < 1e-3 && pure.sleet === 0 && snowy.sleet === 0, `${mixed.sleet}`);
  check('lightning: 95 half, 96 0.7, 99 all; none in fair weather', m({ weather_code: 95 }).lightning === 0.5 && m({ weather_code: 96 }).lightning === 0.7 && m({ weather_code: 99 }).lightning === 1 && m({ weather_code: 1 }).lightning === 0);
  check('lightning from CAPE needs rain as well (energy alone is a hot dry day)', m({ cape: 3500, rain: 0, precipitation: 0 }).lightning === 0 && m({ cape: 3500, rain: 4, precipitation: 4 }).lightning > 0.5 && m({ cape: 300, rain: 4, precipitation: 4 }).lightning === 0);
  check('CAPE is kept (null when the forecast has none)', m({ cape: 1200 }).cape === 1200 && m({}).cape === null);
  check('rime: weather code 48, or fog below freezing; plain fog is not rime', m({ weather_code: 48 }).rime === 1 && m({ visibility: 200, temperature_2m: -4 }).rime === 0.6 && m({ visibility: 200, temperature_2m: 8 }).rime === 0 && m({ weather_code: 48 }).fog >= 0.8);
  check('dust from the air-quality service: 50 ug/m3 nothing, 500 a storm, in between scales', m({}, { dust: 50 }).dust === 0 && m({}, { dust: 500 }).dust === 1 && Math.abs(m({}, { dust: 275 }).dust - 0.5) < 1e-9 && m({}, null).dust === 0 && m({}, { dust: 9 }).dust === 0);
  check('a dust storm is thick brown haze: less to see, more aerosol; clean air changes nothing', (() => { const d = m({}, { dust: 500, aerosol_optical_depth: 0.1 }), c = m({}, { dust: 9, aerosol_optical_depth: 0.1 }); return d.visKm <= 2 && d.aod >= 1.4 && c.visKm >= 25 && Math.abs(c.aod - 0.1) < 1e-9; })());
  const g = m({ wind_speed_10m: 6, wind_gusts_10m: 15 });
  check('wind: mean and gusts at the surface in m/s; gusts never below the mean; none given means calm', g.windMs === 6 && g.gust === 15 && m({ wind_speed_10m: 6 }).gust === 6 && m({}).windMs === 0 && m({ wind_speed_10m: 9, wind_gusts_10m: 4 }).gust === 9);
  check('every preset has every field of the clear sky (nothing undefined for the renderer)', Object.entries(PRESETS).every(([, p]) => Object.keys(CLEAR).every((k) => k in p)));
  check('the setting\'s manual choices are the presets, in the setting\'s own order, live first', MODES.join() === 'clear,partly,cloudy,overcast,rain,storm,snow,fog,haze,sleet,freezing,hail,dust,rime,windy');
  check('the new presets say what they are', PRESETS.sleet.sleet > 0 && PRESETS.freezing.freezing === 1 && PRESETS.hail.hail > 0 && PRESETS.dust.dust > 0.5 && PRESETS.rime.rime === 1 && PRESETS.windy.gust > 15 && PRESETS.storm.lightning > 0);
}

const nav = (lang) => unitFor('auto', lang);
check('en-US uses Fahrenheit', nav('en-US') === 'f');
check('en-GB uses Celsius', nav('en-GB') === 'c');
check('plain "en" is treated as US English', nav('en') === 'f');
check('de-DE uses Celsius', nav('de-DE') === 'c');
check('a chosen unit wins over the region', unitFor('c', 'en-US') === 'c' && unitFor('f', 'de-DE') === 'f');
check('a chosen 24-hour setting wins', hour24(true) === true && hour24(false) === false);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
