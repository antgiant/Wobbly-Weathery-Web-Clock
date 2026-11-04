//! Live weather from Open-Meteo (free, no key), the same service and fields the web page uses. The program has no TLS of its own: it runs `curl`
//! (installed on Raspberry Pi OS Lite; `WOBBLY_CURL` names another program, which the tests use). The first fetch happens before the first frame; after that a
//! thread refreshes every ten minutes, keeping the last good answer when a fetch fails.

use crate::weather::{current_block, from_open_meteo, Weather};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const FIELDS: &str = "temperature_2m,precipitation,rain,showers,snowfall,snow_depth,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,wind_speed_10m,wind_direction_10m";

pub fn forecast_url(lat: f64, lon: f64) -> String {
    format!("https://api.open-meteo.com/v1/forecast?latitude={lat:.2}&longitude={lon:.2}&current={FIELDS}&wind_speed_unit=ms&timezone=auto")
}

/// Run curl on a URL; the body, or what went wrong.
pub fn fetch(url: &str) -> Result<String, String> {
    let bin = std::env::var("WOBBLY_CURL").unwrap_or_else(|_| "curl".into());
    let out = Command::new(&bin).args(["-sS", "--fail", "-m", "20", url]).output().map_err(|e| format!("cannot run {bin}: {e} (install curl for live weather)"))?;
    if !out.status.success() { return Err(format!("{bin} failed: {}", String::from_utf8_lossy(&out.stderr).trim())); }
    String::from_utf8(out.stdout).map_err(|_| "the weather answer is not text".to_string())
}

/// The weather at a place now, or why not. A coordinate is rounded to 0.01 degree (about 1 km) in the request, as the page rounds what it sends.
pub fn fetch_weather(lat: f64, lon: f64) -> Result<Weather, String> {
    let body = fetch(&forecast_url(lat, lon))?;
    let cur = current_block(&body);
    if cur.is_empty() { return Err("the weather answer has no current conditions".into()); }
    Ok(from_open_meteo(&cur))
}

/// The latest weather, shared with the thread that refreshes it.
#[derive(Clone, Default)]
pub struct Live(Arc<Mutex<Option<Weather>>>);

impl Live {
    pub fn get(&self) -> Option<Weather> { self.0.lock().ok().and_then(|g| g.clone()) }
    pub fn set(&self, w: Weather) { if let Ok(mut g) = self.0.lock() { *g = Some(w); } }

    /// Fetch once now (a failure is reported, not fatal), then refresh in the background every `every` (a minute sooner after a failure).
    pub fn start(lat: f64, lon: f64, every: Duration) -> Live {
        let live = Live::default();
        let first = fetch_weather(lat, lon);
        match first { Ok(w) => live.set(w), Err(e) => eprintln!("wobbly-clock-run: live weather: {e}") }
        let shared = live.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(every);
            match fetch_weather(lat, lon) { Ok(w) => shared.set(w), Err(e) => { eprintln!("wobbly-clock-run: live weather: {e}"); std::thread::sleep(Duration::from_secs(60)); } }
        });
        live
    }
}
