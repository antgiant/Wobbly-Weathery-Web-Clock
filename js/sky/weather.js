// Weather -> renderer parameters.
//
// Live data comes from Open-Meteo (free, no key, CORS enabled, so it works
// from a static GitHub Pages site):
//   forecast:    cloud cover per layer, precipitation, snow depth, visibility, wind
//   air-quality: aerosol optical depth, which drives the Mie (haze) scattering
// Everything degrades gracefully: any failure just keeps the previous / clear
// defaults.

export const CLEAR = {
  cover: [0, 0, 0],        // low, mid, high cloud fraction 0..1
  precip: 0,               // 0..1 intensity
  snowfall: 0,             // 1 when the precipitation is snow
  cloudDark: 0,            // 0..1 storm darkening
  visKm: 40,
  fog: 0,
  wind: [0.004, 0.002],    // km/s at cloud level (east, north)
  aod: 0.12,
  snowCover: 0,            // 0..1 snow on the ground
  tempC: null,
  label: 'Clear',
};

export const PRESETS = {
  clear:    { ...CLEAR, label: 'Clear' },
  partly:   { ...CLEAR, cover: [0.38, 0.18, 0.25], label: 'Partly cloudy' },
  cloudy:   { ...CLEAR, cover: [0.7, 0.5, 0.4], cloudDark: 0.15, visKm: 25, label: 'Mostly cloudy' },
  overcast: { ...CLEAR, cover: [1, 0.8, 0.5], cloudDark: 0.45, visKm: 15, label: 'Overcast' },
  rain:     { ...CLEAR, cover: [1, 0.9, 0.6], cloudDark: 0.8, precip: 0.55, visKm: 6, wind: [0.008, 0.003], label: 'Rain' },
  storm:    { ...CLEAR, cover: [1, 1, 0.7], cloudDark: 1, precip: 0.95, visKm: 4, wind: [0.02, 0.008], label: 'Thunderstorm' },
  snow:     { ...CLEAR, cover: [0.95, 0.8, 0.5], cloudDark: 0.3, precip: 0.5, snowfall: 1, visKm: 4, snowCover: 1, label: 'Snow' },
  fog:      { ...CLEAR, cover: [0, 0, 0], fog: 0.85, visKm: 0.6, label: 'Fog' },
  haze:     { ...CLEAR, cover: [0.1, 0.05, 0.1], aod: 0.9, visKm: 8, label: 'Smoky haze' },
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Map an Open-Meteo `current` block (+ optional air-quality block) to renderer params. */
export function mapOpenMeteo(cur, air) {
  const w = { ...CLEAR, cover: [0, 0, 0], wind: [...CLEAR.wind], label: 'Live' };
  const pct = (v) => (Number.isFinite(v) ? clamp(v / 100, 0, 1) : 0);
  w.cover = [pct(cur.cloud_cover_low), pct(cur.cloud_cover_mid), pct(cur.cloud_cover_high)];
  // total cover reported without a breakdown: spread it over the low layer
  if (w.cover.every(v => v === 0) && Number.isFinite(cur.cloud_cover)) w.cover[0] = pct(cur.cloud_cover) * 0.9;

  const rain = (cur.rain || 0) + (cur.showers || 0);
  const snow = cur.snowfall || 0;                    // cm per hour
  const precipMm = (cur.precipitation || 0);
  w.precip = clamp(Math.max(precipMm / 6, snow / 3), 0, 1);
  w.snowfall = snow > 0 && snow * 1.2 >= rain ? 1 : 0;

  const code = cur.weather_code;
  const stormy = code >= 95;
  const wet = w.precip > 0.05;
  w.cloudDark = clamp((wet ? 0.35 : 0) + w.precip * 0.6 + (stormy ? 0.4 : 0) + w.cover[0] * 0.15, 0, 1);

  // the historical archive has no visibility: guess it from the rain or snow
  const visKm = Number.isFinite(cur.visibility) ? clamp(cur.visibility / 1000, 0.2, 80) : clamp(30 - 26 * w.precip, 4, 30);
  w.visKm = visKm;
  w.fog = clamp(1 - (visKm - 0.3) / 6, 0, 1);
  w.fog = Math.pow(w.fog, 1.5);
  if (code === 45 || code === 48) w.fog = Math.max(w.fog, 0.7);

  // wind blows *from* wind_direction_10m; clouds move ~2x faster than the surface wind
  if (Number.isFinite(cur.wind_speed_10m)) {
    const sp = cur.wind_speed_10m * 2 / 1000;       // km/s
    const dir = (cur.wind_direction_10m || 0) * Math.PI / 180;
    w.wind = [-Math.sin(dir) * sp, -Math.cos(dir) * sp];
  }
  w.snowCover = clamp((cur.snow_depth || 0) / 0.03, 0, 1);
  w.tempC = cur.temperature_2m ?? null;

  if (air && Number.isFinite(air.aerosol_optical_depth)) w.aod = clamp(air.aerosol_optical_depth, 0.01, 3);
  w.label = 'Live';
  return w;
}

export async function fetchLiveWeather(lat, lon, signal) {
  const base = 'https://api.open-meteo.com/v1/forecast';
  const vars = [
    'temperature_2m', 'precipitation', 'rain', 'showers', 'snowfall', 'snow_depth', 'weather_code',
    'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
    'visibility', 'wind_speed_10m', 'wind_direction_10m',
  ].join(',');
  const f = await fetch(`${base}?latitude=${lat}&longitude=${lon}&current=${vars}&wind_speed_unit=ms&timezone=auto`, { signal });
  if (!f.ok) throw new Error('weather HTTP ' + f.status);
  const fj = await f.json();

  let air = null;
  try {
    const a = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=aerosol_optical_depth`, { signal });
    if (a.ok) air = (await a.json()).current;
  } catch (_) { /* aerosol data is optional */ }

  return { weather: mapOpenMeteo(fj.current || {}, air), elevation: Number.isFinite(fj.elevation) ? fj.elevation : null };
}

/**
 * Sea state from Open-Meteo's marine forecast (open water only; inland / unsupported points return
 * nothing). Directions come back as where the waves arrive FROM; the renderer wants where they travel TO.
 * @returns {Promise<null|{windHs:number,windTp:number,windDir:number[],swellHs:number,swellTp:number,swellDir:number[],label:string}>}
 */
export async function fetchMarine(lat, lon, signal) {
  const vars = ['wave_height', 'wave_direction', 'wave_period', 'wind_wave_height', 'wind_wave_direction', 'wind_wave_period',
    'swell_wave_height', 'swell_wave_direction', 'swell_wave_period'].join(',');
  const r = await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=${vars}&timezone=auto`, { signal });
  if (!r.ok) throw new Error('marine HTTP ' + r.status);
  return mapMarine((await r.json()).current);
}

export function mapMarine(c) {
  const ok = (v) => Number.isFinite(v);
  if (!c || !ok(c.wave_height)) return null;
  const to = (fromDeg) => { const a = (((ok(fromDeg) ? fromDeg : 0) + 180) * Math.PI) / 180; return [Math.sin(a), Math.cos(a)]; };
  const windHs = ok(c.wind_wave_height) ? c.wind_wave_height : c.wave_height;
  const swellHs = ok(c.swell_wave_height) ? c.swell_wave_height : 0;
  const per = (p, hs) => (ok(p) && p > 1 ? p : 3.9 * Math.sqrt(Math.max(hs, 0.05)) + 1);
  return {
    windHs, windTp: per(c.wind_wave_period, windHs), windDir: to(ok(c.wind_wave_direction) ? c.wind_wave_direction : c.wave_direction),
    swellHs, swellTp: per(c.swell_wave_period, swellHs) < 4 ? 9 : per(c.swell_wave_period, swellHs), swellDir: to(ok(c.swell_wave_direction) ? c.swell_wave_direction : c.wave_direction),
    label: `${c.wave_height.toFixed(1)} m waves` + (ok(c.wave_period) ? ` every ${Math.round(c.wave_period)} s` : ''),
  };
}

// ------------------------------------------------------------ the past / future --
// With time travel on, the weather should be what it was (or is forecast to be) at that moment, not what it
// is now. Open-Meteo's forecast service holds the last ~3 months and the next 16 days at hourly resolution;
// older dates come from its ERA5 archive (which has no visibility or showers).

const HOURLY_FORECAST = ['temperature_2m', 'precipitation', 'rain', 'showers', 'snowfall', 'snow_depth', 'weather_code',
  'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'visibility', 'wind_speed_10m', 'wind_direction_10m'];
const HOURLY_ARCHIVE = HOURLY_FORECAST.filter(v => v !== 'visibility' && v !== 'showers');
const DAY = 86400e3;
const ymd = (d) => d.toISOString().slice(0, 10);

/** Which service holds this date, or null when it is too far ahead for any forecast. */
export function serviceFor(date, nowMs = Date.now()) {
  const days = (nowMs - +date) / DAY;
  if (days < -15) return null;
  return days <= 85 ? 'forecast' : 'archive';
}
const baseOf = (svc) => (svc === 'forecast' ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive');

/** All 24 hours (UTC) of the day containing `date`: an array of `current`-shaped blocks. */
export async function fetchWeatherDay(lat, lon, date, signal) {
  const svc = serviceFor(date);
  if (!svc) return null;
  const day = ymd(date);
  const vars = (svc === 'forecast' ? HOURLY_FORECAST : HOURLY_ARCHIVE).join(',');
  const r = await fetch(`${baseOf(svc)}?latitude=${lat}&longitude=${lon}&hourly=${vars}&start_date=${day}&end_date=${day}&wind_speed_unit=ms&timezone=GMT`, { signal });
  if (!r.ok) throw new Error('history HTTP ' + r.status);
  const j = await r.json();
  return { day, hours: hoursOf(j.hourly), elevation: Number.isFinite(j.elevation) ? j.elevation : null };
}

export function hoursOf(h) {
  if (!h || !h.time) return [];
  return h.time.map((t, i) => { const o = { time: t }; for (const k of Object.keys(h)) if (k !== 'time') o[k] = h[k][i]; return o; });
}

/** Renderer weather for an hour of a fetched day (nearest hour). */
export function weatherFromDay(dayData, date) {
  if (!dayData || !dayData.hours.length) return null;
  const hr = Math.min(dayData.hours.length - 1, Math.max(0, Math.round(date.getUTCHours() + date.getUTCMinutes() / 60)));
  const w = mapOpenMeteo(dayData.hours[hr], null);
  w.label = `${dayData.day} ${String(hr).padStart(2, '0')}:00 UTC`;
  return w;
}

/**
 * How warm the last month has been, for the seasons: mean temperature of the last 15 days and of the 15 before.
 * @returns {Promise<null|{t15:number,tPrev:number|null}>}
 */
export async function fetchClimate(lat, lon, date, signal) {
  const svc = serviceFor(date);
  if (!svc) return null;
  const end = svc === 'archive' ? new Date(Math.min(+date, Date.now() - 7 * DAY)) : new Date(Math.min(+date, Date.now()));
  const start = new Date(+end - 29 * DAY);
  const r = await fetch(`${baseOf(svc)}?latitude=${lat}&longitude=${lon}&daily=temperature_2m_mean&start_date=${ymd(start)}&end_date=${ymd(end)}&timezone=GMT`, { signal });
  if (!r.ok) throw new Error('climate HTTP ' + r.status);
  return climateOf(((await r.json()).daily || {}).temperature_2m_mean);
}

export function climateOf(daily) {
  const v = (daily || []).filter(Number.isFinite);
  if (v.length < 8) return null;
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const recent = v.slice(-15), earlier = v.slice(0, Math.max(0, v.length - 15));
  return { t15: mean(recent), tPrev: earlier.length >= 5 ? mean(earlier) : null };
}
