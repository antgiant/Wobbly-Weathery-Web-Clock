//! One tick of the clock: the time as text for a config, and the picture for a moment. What `wobbly-clock-run` calls once a second.

use crate::config::{parse_target, Config};
use crate::countdown::{groups_for, seconds_left, text_of};
use crate::scene::{self, Scene};
use crate::tz::Zone;

/// The zone a config asks for: its `timeZone`, else the system's (`/etc/localtime`), else UTC.
pub fn zone_for(c: &Config) -> Zone {
    if !c.time_zone.is_empty() { if let Ok(z) = Zone::load(&c.time_zone) { return z; } }
    Zone::load("/etc/localtime").unwrap_or_else(|_| Zone::fixed(0))
}

/// Where a countdown is: counting until the target, "done" from then to the end of that day (the digits show 00:00), then over (the clock shows the time again).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase { Counting, Done, Over }

/// The target as a UTC moment, in the clock's zone.
pub fn target_ms(c: &Config, zone: &Zone) -> Option<f64> {
    let (y, mo, d, h, mi) = parse_target(&c.timer_target)?;
    Some(zone.local_to_utc_ms(y, mo, d, h, mi))
}

pub fn phase_of(target_ms: f64, now_ms: f64, zone: &Zone) -> Phase {
    if now_ms < target_ms { return Phase::Counting; }
    // the end of the target's own day: the next local midnight
    let secs = (target_ms / 1000.0).floor() as i64;
    let local = secs + zone.offset_at(secs) as i64;
    let day = local.div_euclid(86400);
    let (y, m, d) = civil_from_days(day + 1);
    if now_ms < zone.local_to_utc_ms(y, m, d, 0, 0) { Phase::Done } else { Phase::Over }
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468; let era = z.div_euclid(146097); let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1; let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// What the digits show: the time, or in countdown mode the time left (days:hours:minutes:seconds, capped at 6 digits, 4 without seconds), 00:00 on the
/// day itself, and the time again after that day. A countdown with no valid target just shows the time.
pub fn display_text(c: &Config, zone: &Zone, utc_ms: f64) -> String {
    if c.clock_mode == "countdown" {
        if let Some(target) = target_ms(c, zone) {
            match phase_of(target, utc_ms, zone) {
                Phase::Counting => return text_of(&groups_for(seconds_left(target, utc_ms), !c.hide_seconds)),
                Phase::Done => return "00:00".into(),
                Phase::Over => {}
            }
        }
    }
    time_text(c, zone, utc_ms)
}

/// "13:05:09", "13:05", "1:05:09 " ... : 24-hour shows two digits for the hour; 12-hour drops the leading zero (the page hides that digit).
/// With the time zone left on auto the clock is 24-hour (a headless Pi has no locale to ask).
pub fn time_text(c: &Config, zone: &Zone, utc_ms: f64) -> String {
    let (h, m, s) = zone.wall_clock(utc_ms);
    let hour = if c.twenty_four_hour.unwrap_or(true) { format!("{h:02}") } else { format!("{}", if h % 12 == 0 { 12 } else { h % 12 }) };
    if c.hide_seconds { format!("{hour}:{m:02}") } else { format!("{hour}:{m:02}:{s:02}") }
}

/// The style in force: the user's choice, or while it is on "auto": liquid glass, with coloured lights from Thanksgiving to Christmas.
pub fn style_for(c: &Config, zone: &Zone, utc_ms: f64) -> &'static str {
    match c.clock_style.as_str() {
        "glass" => "glass", "stained" => "stained", "solid" => "solid",
        _ => {
            let secs = (utc_ms / 1000.0).floor() as i64;
            let (y, m, d) = civil_from_days((secs + zone.offset_at(secs) as i64).div_euclid(86400));
            if crate::season::is_christmas_season(y, m, d) { "stained" } else { "glass" }
        }
    }
}

pub fn scene_for(c: &Config, zone: &Zone, utc_ms: f64) -> Scene { scene_with(c, zone, utc_ms, None) }

/// The scene, with live weather if there is some (and the weather setting is "live").
pub fn scene_with(c: &Config, zone: &Zone, utc_ms: f64, live: Option<&crate::weather::Weather>) -> Scene {
    let wx = match (c.weather_mode.as_str(), live) { ("live", Some(l)) => l.clone(), ("live", None) => crate::weather::Weather::CLEAR, (m, _) => crate::weather::Weather::preset(m) };
    let look = if c.weather_mode == "live" { wx.mode().to_string() } else { c.weather_mode.clone() };
    Scene { lat: c.latitude, lon: c.longitude, brightness_day: c.brightness_day, brightness_night: c.brightness_night, transition_minutes: c.brightness_transition, weather: look, wx, digit_weather: c.digit_weather, sway: c.wind_sway.clone(),
        style: style_for(c, zone, utc_ms).into(), frost: c.glass_frost, glow: c.glass_glow, glow_color: c.glass_glow_color.clone(), ..Scene::default() }
}

/// The frame (RGB, `w` x `h`) for a moment.
pub fn frame(c: &Config, zone: &Zone, utc_ms: f64, w: usize, h: usize) -> Vec<u8> {
    scene::render(&scene_for(c, zone, utc_ms), utc_ms, &display_text(c, zone, utc_ms), w, h)
}

/// One clock: its settings, its zone, and the cached sky. Call `frame` once a second.
pub struct Clock { pub cfg: Config, pub zone: Zone, cache: scene::BackgroundCache, pub live: Option<crate::live::Live> }

impl Clock {
    pub fn new(cfg: Config) -> Clock { let zone = zone_for(&cfg); Clock { cfg, zone, cache: scene::BackgroundCache::default(), live: None } }
    pub fn frame(&mut self, utc_ms: f64, w: usize, h: usize) -> Vec<u8> {
        let sc = self.scene(utc_ms);
        scene::render_cached(&mut self.cache, &sc, utc_ms, &display_text(&self.cfg, &self.zone, utc_ms), w, h)
    }
    pub fn scene(&self, utc_ms: f64) -> Scene { let live = self.live.as_ref().and_then(|l| l.get()); scene_with(&self.cfg, &self.zone, utc_ms, live.as_ref()) }
    /// The panel brightness level (0.1 to 1) now.
    pub fn level(&self, utc_ms: f64) -> f64 { scene::brightness(&self.scene(utc_ms), utc_ms) }
}
