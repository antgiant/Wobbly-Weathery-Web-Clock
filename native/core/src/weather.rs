//! The manual weather settings on the sky: each one's measured look at midday (`weathertable.rs`, baked from the web page by tools/native-weather.mjs)
//! applied in proportion to the daylight, so dusk and night keep their own colours. There is no live weather in the native renderer yet: "live" is clear.

use crate::sky::{Rgb, SkyColors};
use crate::weathertable::WEATHER;

fn smooth(a: f64, b: f64, x: f64) -> f64 { let t = ((x - a) / (b - a)).clamp(0.0, 1.0); t * t * (3.0 - 2.0 * t) }

/// The names this knows. Anything else (including "live") is clear.
pub fn known(mode: &str) -> bool { WEATHER.iter().any(|(m, _, _)| *m == mode) }

fn entry(mode: &str) -> &'static (&'static str, [f64; 9], f64) { WEATHER.iter().find(|(m, _, _)| *m == mode).unwrap_or(&WEATHER[0]) }

/// How much daylight there is for a sun height: 0 at night and in deep twilight, 1 in full day.
pub fn daylight(alt: f64) -> f64 { smooth(-4.0, 12.0, alt) }

/// The sky and ground colours for a weather setting.
pub fn apply(c: &SkyColors, mode: &str, alt: f64) -> SkyColors {
    let (_, m, _) = entry(mode);
    let d = daylight(alt);
    let go = |col: Rgb, k: usize| -> Rgb { [0, 1, 2].map(|i| (col[i] * (1.0 + (m[k + i] - 1.0) * d)).clamp(0.0, 255.0)) };
    SkyColors { top: go(c.top, 0), horizon: go(c.horizon, 3), ground: go(c.ground, 6) }
}

/// How much of the stars show through this weather (1 clear, 0 overcast).
pub fn star_visibility(mode: &str) -> f64 { entry(mode).2 }

// ---------------------------------------------------------------------------------------------------- the weather itself

/// What the weather is, as the page models it (js/sky/weather.js): cloud cover (low, mid, high) 0..1, precipitation 0..1, whether it is snow, how stormy
/// the cloud is, visibility, fog, the wind at cloud level (km/s towards east and north), haze, snow on the ground, and the temperature.
#[derive(Clone, Debug, PartialEq)]
pub struct Weather {
    pub cover: [f64; 3], pub precip: f64, pub snowfall: f64, pub cloud_dark: f64, pub vis_km: f64, pub fog: f64,
    pub wind: [f64; 2], pub aod: f64, pub snow_cover: f64, pub temp_c: f64,
}

impl Weather {
    pub const CLEAR: Weather = Weather { cover: [0.0; 3], precip: 0.0, snowfall: 0.0, cloud_dark: 0.0, vis_km: 40.0, fog: 0.0, wind: [0.004, 0.002], aod: 0.12, snow_cover: 0.0, temp_c: f64::NAN };

    /// One of the page's manual settings; unknown names (and "live") are clear.
    pub fn preset(mode: &str) -> Weather {
        let c = Weather::CLEAR;
        match mode {
            "partly" => Weather { cover: [0.38, 0.18, 0.25], ..c },
            "cloudy" => Weather { cover: [0.7, 0.5, 0.4], cloud_dark: 0.15, vis_km: 25.0, ..c },
            "overcast" => Weather { cover: [1.0, 0.8, 0.5], cloud_dark: 0.45, vis_km: 15.0, ..c },
            "rain" => Weather { cover: [1.0, 0.9, 0.6], cloud_dark: 0.8, precip: 0.55, vis_km: 6.0, wind: [0.008, 0.003], ..c },
            "storm" => Weather { cover: [1.0, 1.0, 0.7], cloud_dark: 1.0, precip: 0.95, vis_km: 4.0, wind: [0.02, 0.008], ..c },
            "snow" => Weather { cover: [0.95, 0.8, 0.5], cloud_dark: 0.3, precip: 0.5, snowfall: 1.0, vis_km: 4.0, snow_cover: 1.0, ..c },
            "fog" => Weather { fog: 0.85, vis_km: 0.6, ..c },
            "haze" => Weather { cover: [0.1, 0.05, 0.1], aod: 0.9, vis_km: 8.0, ..c },
            _ => c,
        }
    }

    /// The nearest manual setting, for the sky colours (which were measured for those): the weather's look in a word.
    pub fn mode(&self) -> &'static str {
        let total = self.cover[0].max(self.cover[1]).max(self.cover[2]);
        if self.fog >= 0.5 { "fog" }
        else if self.snowfall > 0.5 && self.precip > 0.1 { "snow" }
        else if self.precip >= 0.75 { "storm" }
        else if self.precip > 0.1 { "rain" }
        else if self.cover[0] >= 0.85 { "overcast" }
        else if self.cover[0] >= 0.55 { "cloudy" }
        else if self.aod >= 0.5 && self.vis_km < 12.0 { "haze" }
        else if total >= 0.3 { "partly" }
        else { "clear" }
    }

    /// The speed of the wind at the ground (m/s) and the compass bearing it blows towards (the page: clouds move about twice as fast as the surface wind).
    pub fn ground_wind(&self) -> (f64, f64) {
        let speed = self.wind[0].hypot(self.wind[1]) * 1000.0 / 2.0;
        let to = (self.wind[0].atan2(self.wind[1]).to_degrees() + 360.0).rem_euclid(360.0);
        (speed, to)
    }
}

fn clamp(x: f64, a: f64, b: f64) -> f64 { x.min(b).max(a) }

/// The numbers in the `"current": { ... }` block of an Open-Meteo answer (strings and nulls are left out).
pub fn current_block(json: &str) -> std::collections::HashMap<String, f64> {
    let mut out = std::collections::HashMap::new();
    let Some(at) = json.find("\"current\"") else { return out };
    let rest = &json[at..];
    let Some(open) = rest.find('{') else { return out };
    let Some(close) = rest[open..].find('}') else { return out };
    for pair in rest[open + 1..open + close].split(',') {
        if let Some((k, v)) = pair.split_once(':') {
            if let Ok(n) = v.trim().parse::<f64>() { out.insert(k.trim().trim_matches('"').to_string(), n); }
        }
    }
    out
}

/// The page's `mapOpenMeteo`: Open-Meteo's current conditions to a `Weather`.
pub fn from_open_meteo(cur: &std::collections::HashMap<String, f64>) -> Weather {
    let g = |k: &str| cur.get(k).copied();
    let pct = |v: Option<f64>| v.map_or(0.0, |x| clamp(x / 100.0, 0.0, 1.0));
    let mut w = Weather { wind: Weather::CLEAR.wind, ..Weather::CLEAR };
    w.cover = [pct(g("cloud_cover_low")), pct(g("cloud_cover_mid")), pct(g("cloud_cover_high"))];
    if w.cover.iter().all(|v| *v == 0.0) { if let Some(c) = g("cloud_cover") { w.cover[0] = clamp(c / 100.0, 0.0, 1.0) * 0.9; } }
    let rain = g("rain").unwrap_or(0.0) + g("showers").unwrap_or(0.0);
    let snow = g("snowfall").unwrap_or(0.0);
    let precip_mm = g("precipitation").unwrap_or(0.0);
    w.precip = clamp((precip_mm / 6.0).max(snow / 3.0), 0.0, 1.0);
    w.snowfall = if snow > 0.0 && snow * 1.2 >= rain { 1.0 } else { 0.0 };
    let code = g("weather_code").unwrap_or(0.0);
    let (stormy, wet) = (code >= 95.0, w.precip > 0.05);
    w.cloud_dark = clamp((if wet { 0.35 } else { 0.0 }) + w.precip * 0.6 + (if stormy { 0.4 } else { 0.0 }) + w.cover[0] * 0.15, 0.0, 1.0);
    let vis = match g("visibility") { Some(v) => clamp(v / 1000.0, 0.2, 80.0), None => clamp(30.0 - 26.0 * w.precip, 4.0, 30.0) };
    w.vis_km = vis;
    w.fog = clamp(1.0 - (vis - 0.3) / 6.0, 0.0, 1.0).powf(1.5);
    if code == 45.0 || code == 48.0 { w.fog = w.fog.max(0.7); }
    if let Some(sp) = g("wind_speed_10m") {
        let s = sp * 2.0 / 1000.0;
        let dir = g("wind_direction_10m").unwrap_or(0.0).to_radians();
        w.wind = [-dir.sin() * s, -dir.cos() * s];
    }
    w.snow_cover = clamp(g("snow_depth").unwrap_or(0.0) / 0.03, 0.0, 1.0);
    w.temp_c = g("temperature_2m").unwrap_or(f64::NAN);
    w
}
