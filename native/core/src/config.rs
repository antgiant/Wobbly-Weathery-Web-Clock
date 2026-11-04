//! The settings file the Node command line writes (`key = value`, `#` comments, the web page's names): the keys the renderer reads, with the same
//! defaults as schema/settings.js. Unknown keys are ignored here (the command line owns them), bad values are reported with their line.

use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct Config {
    pub latitude: f64,
    pub longitude: f64,
    pub time_zone: String,
    /// `None` is "auto"
    pub twenty_four_hour: Option<bool>,
    pub hide_seconds: bool,
    /// a manual weather setting; "live" (the default) is clear for now
    pub weather_mode: String,
    /// "time" or "countdown"
    pub clock_mode: String,
    /// a datetime-local value, "2026-12-25T08:00", in the clock's time zone
    pub timer_target: String,
    pub brightness_day: f64,
    pub brightness_night: f64,
    pub brightness_transition: f64,
    pub output: String,
    pub matrix_config: String,
    pub gamma: f64,
    pub led: LedOptions,
    pub errors: Vec<String>,
}

/// The hzeller library's options (names without the `--`).
#[derive(Clone, Debug)]
pub struct LedOptions { pub gpio_mapping: String, pub slowdown_gpio: u32, pub pwm_bits: u32, pub pwm_lsb_nanoseconds: u32, pub rgb_sequence: String, pub panel_type: String, pub multiplexing: u32, pub row_addr_type: u32 }

impl Default for Config {
    fn default() -> Self {
        Config { latitude: 0.0, longitude: 0.0, time_zone: String::new(), twenty_four_hour: None, hide_seconds: false, weather_mode: "live".into(), clock_mode: "time".into(), timer_target: String::new(), brightness_day: 1.0, brightness_night: 1.0, brightness_transition: 45.0,
            output: "hdmi".into(), matrix_config: String::new(), gamma: 2.2,
            led: LedOptions { gpio_mapping: "regular".into(), slowdown_gpio: 1, pwm_bits: 11, pwm_lsb_nanoseconds: 130, rgb_sequence: "RGB".into(), panel_type: String::new(), multiplexing: 0, row_addr_type: 0 },
            errors: vec![] }
    }
}

fn bool_of(v: &str) -> Option<bool> { match v.to_ascii_lowercase().as_str() { "on" | "true" | "yes" | "1" => Some(true), "off" | "false" | "no" | "0" => Some(false), _ => None } }

/// "2026-12-25T08:00" -> (year, month, day, hour, minute), checked for sensible ranges.
pub fn parse_target(v: &str) -> Option<(i64, i64, i64, i64, i64)> {
    let b = v.as_bytes();
    if b.len() != 16 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' { return None; }
    let n = |r: std::ops::Range<usize>| v[r].parse::<i64>().ok();
    let (y, mo, d, h, mi) = (n(0..4)?, n(5..7)?, n(8..10)?, n(11..13)?, n(14..16)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 { return None; }
    Some((y, mo, d, h, mi))
}

pub fn parse(text: &str) -> Config {
    let mut map: HashMap<String, (usize, String)> = HashMap::new();
    let mut errors = vec![];
    for (i, raw) in text.lines().enumerate() {
        let line = raw.split(" #").next().unwrap_or("").trim();
        if line.is_empty() || line.starts_with('#') { continue; }
        match line.split_once('=') { Some((k, v)) => { map.insert(k.trim().to_string(), (i + 1, v.trim().to_string())); } None => errors.push(format!("line {}: expected \"key = value\"", i + 1)) }
    }
    let mut c = Config::default();
    let num = |k: &str, lo: f64, hi: f64, into: &mut f64, errors: &mut Vec<String>| { if let Some((l, v)) = map.get(k) { match v.parse::<f64>() { Ok(x) if x >= lo && x <= hi => *into = x, _ => errors.push(format!("line {l}: {k} is a number from {lo} to {hi}, not \"{v}\"")) } } };
    num("location_latitude", -90.0, 90.0, &mut c.latitude, &mut errors);
    num("location_longitude", -180.0, 180.0, &mut c.longitude, &mut errors);
    num("brightnessDay", 0.0, 1.0, &mut c.brightness_day, &mut errors);
    num("brightnessNight", 0.0, 1.0, &mut c.brightness_night, &mut errors);
    num("brightnessTransition", 1.0, 600.0, &mut c.brightness_transition, &mut errors);
    num("gamma", 1.0, 3.0, &mut c.gamma, &mut errors);
    let int = |k: &str, lo: u32, hi: u32, into: &mut u32, errors: &mut Vec<String>| { if let Some((l, v)) = map.get(k) { match v.parse::<u32>() { Ok(x) if x >= lo && x <= hi => *into = x, _ => errors.push(format!("line {l}: {k} is a whole number from {lo} to {hi}, not \"{v}\"")) } } };
    int("ledSlowdownGpio", 0, 4, &mut c.led.slowdown_gpio, &mut errors);
    int("ledPwmBits", 1, 11, &mut c.led.pwm_bits, &mut errors);
    int("ledPwmLsbNanoseconds", 50, 3000, &mut c.led.pwm_lsb_nanoseconds, &mut errors);
    int("ledMultiplexing", 0, 17, &mut c.led.multiplexing, &mut errors);
    int("ledRowAddrType", 0, 5, &mut c.led.row_addr_type, &mut errors);
    if let Some((l, v)) = map.get("hideSeconds") { match bool_of(v) { Some(b) => c.hide_seconds = b, None => errors.push(format!("line {l}: hideSeconds is on or off, not \"{v}\"")) } }
    if let Some((l, v)) = map.get("twentyFourHourClock") { match v.as_str() { "auto" => c.twenty_four_hour = None, x => match bool_of(x) { Some(b) => c.twenty_four_hour = Some(b), None => errors.push(format!("line {l}: twentyFourHourClock is auto, on or off, not \"{v}\"")) } } }
    if let Some((l, v)) = map.get("clockMode") { if v == "time" || v == "countdown" { c.clock_mode = v.clone() } else { errors.push(format!("line {l}: clockMode is time or countdown, not \"{v}\"")) } }
    if let Some((l, v)) = map.get("timerTarget") { if v.is_empty() || parse_target(v).is_some() { c.timer_target = v.clone() } else { errors.push(format!("line {l}: timerTarget looks like 2026-12-25T08:00, not \"{v}\"")) } }
    if let Some((l, v)) = map.get("weatherMode") { if v == "live" || crate::weather::known(v) { c.weather_mode = v.clone() } else { errors.push(format!("line {l}: weatherMode is live, clear, partly, cloudy, overcast, rain, storm, snow, fog or haze, not \"{v}\"")) } }
    if let Some((l, v)) = map.get("output") { if v == "hdmi" || v == "matrix" { c.output = v.clone() } else { errors.push(format!("line {l}: output is hdmi or matrix, not \"{v}\"")) } }
    if let Some((l, v)) = map.get("ledGpioMapping") { if ["regular", "adafruit-hat", "adafruit-hat-pwm"].contains(&v.as_str()) { c.led.gpio_mapping = v.clone() } else { errors.push(format!("line {l}: ledGpioMapping is regular, adafruit-hat or adafruit-hat-pwm, not \"{v}\"")) } }
    for (k, into) in [("timeZone", &mut c.time_zone), ("matrixConfig", &mut c.matrix_config), ("ledRgbSequence", &mut c.led.rgb_sequence), ("ledPanelType", &mut c.led.panel_type)] { if let Some((_, v)) = map.get(k) { *into = v.clone(); } }
    c.errors = errors;
    c
}
