//! One tick of the clock: the time as text for a config, and the picture for a moment. What `wobbly-clock-run` calls once a second.

use crate::config::Config;
use crate::scene::{self, Scene};
use crate::tz::Zone;

/// The zone a config asks for: its `timeZone`, else the system's (`/etc/localtime`), else UTC.
pub fn zone_for(c: &Config) -> Zone {
    if !c.time_zone.is_empty() { if let Ok(z) = Zone::load(&c.time_zone) { return z; } }
    Zone::load("/etc/localtime").unwrap_or_else(|_| Zone::fixed(0))
}

/// "13:05:09", "13:05", "1:05:09 " ... : 24-hour shows two digits for the hour; 12-hour drops the leading zero (the page hides that digit).
/// With the time zone left on auto the clock is 24-hour (a headless Pi has no locale to ask).
pub fn time_text(c: &Config, zone: &Zone, utc_ms: f64) -> String {
    let (h, m, s) = zone.wall_clock(utc_ms);
    let hour = if c.twenty_four_hour.unwrap_or(true) { format!("{h:02}") } else { format!("{}", if h % 12 == 0 { 12 } else { h % 12 }) };
    if c.hide_seconds { format!("{hour}:{m:02}") } else { format!("{hour}:{m:02}:{s:02}") }
}

pub fn scene_for(c: &Config) -> Scene {
    Scene { lat: c.latitude, lon: c.longitude, brightness_day: c.brightness_day, brightness_night: c.brightness_night, transition_minutes: c.brightness_transition, ..Scene::default() }
}

/// The frame (RGB, `w` x `h`) for a moment.
pub fn frame(c: &Config, zone: &Zone, utc_ms: f64, w: usize, h: usize) -> Vec<u8> {
    scene::render(&scene_for(c), utc_ms, &time_text(c, zone, utc_ms), w, h)
}
