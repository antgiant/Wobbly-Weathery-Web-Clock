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
  rain:     { ...CLEAR, cover: [1, 0.9, 0.6], cloudDark: 0.8, precip: 0.55, visKm: 6, label: 'Rain' },
  storm:    { ...CLEAR, cover: [1, 1, 0.7], cloudDark: 1, precip: 0.95, visKm: 4, wind: [0.01, 0.004], label: 'Thunderstorm' },
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

  const visKm = Number.isFinite(cur.visibility) ? clamp(cur.visibility / 1000, 0.2, 80) : 40;
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
  w.label = 'Live' + (cur.temperature_2m != null ? ` · ${Math.round(cur.temperature_2m)}°C` : '');
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
