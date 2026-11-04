//! The settings file, the time as text, and the program end to end (HDMI to a ppm, an LED panel to a canvas).
use std::process::Command;
use wobbly_core::clock::time_text;
use wobbly_core::config::{parse, Config};
use wobbly_core::tz::Zone;

#[test]
fn reads_the_file_the_node_command_line_wrote() {
    let c = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/config_node.conf")).unwrap());
    assert!(c.errors.is_empty(), "{:?}", c.errors);
    assert_eq!((c.latitude, c.longitude), (41.88, -87.63));
    assert_eq!((c.brightness_day, c.brightness_night, c.brightness_transition), (0.9, 0.3, 60.0));
    assert!(c.hide_seconds && c.twenty_four_hour == Some(false) && c.output == "matrix");
    assert_eq!((c.time_zone.as_str(), c.matrix_config.as_str()), ("America/Chicago", "/etc/wobbly-clock/matrix.cfg"));
}

#[test]
fn defaults_match_the_schema_and_mistakes_are_reported_with_their_line() {
    let d = Config::default();
    assert_eq!((d.brightness_day, d.brightness_night, d.brightness_transition, d.gamma, d.output.as_str()), (1.0, 1.0, 45.0, 2.2, "hdmi"));
    assert_eq!((d.led.pwm_bits, d.led.slowdown_gpio, d.led.pwm_lsb_nanoseconds, d.led.rgb_sequence.as_str(), d.led.gpio_mapping.as_str()), (11, 1, 130, "RGB", "regular"));
    let c = parse("# c\nhideSeconds = maybe\nbrightnessNight = 2\nledPwmBits = 12\noutput = vga\nnonsense\nlocation_latitude = 41.5\n");
    assert_eq!(c.errors.len(), 5, "{:?}", c.errors);
    for line in ["line 2:", "line 3:", "line 4:", "line 5:", "line 6: expected"] { assert!(c.errors.iter().any(|e| e.starts_with(line)), "no error for {line}: {:?}", c.errors); }
    assert_eq!(c.latitude, 41.5, "the good line still counts");
}

#[test]
fn the_time_as_text() {
    let utc = Zone::fixed(0);
    let t = |h: u32, m: u32, s: u32| ((h * 3600 + m * 60 + s) as f64) * 1000.0;
    let h24 = Config { twenty_four_hour: Some(true), ..Config::default() };
    let h12 = Config { twenty_four_hour: Some(false), ..Config::default() };
    let hidden = Config { hide_seconds: true, ..h12.clone() };
    assert_eq!(time_text(&h24, &utc, t(13, 5, 9)), "13:05:09");
    assert_eq!(time_text(&h24, &utc, t(5, 5, 9)), "05:05:09");
    assert_eq!(time_text(&h12, &utc, t(13, 5, 9)), "1:05:09");
    assert_eq!(time_text(&h12, &utc, t(0, 30, 0)), "12:30:00");
    assert_eq!(time_text(&h12, &utc, t(12, 0, 0)), "12:00:00");
    assert_eq!(time_text(&hidden, &utc, t(22, 7, 59)), "10:07");
    assert_eq!(time_text(&Config::default(), &Zone::fixed(3600), t(23, 30, 0)), "00:30:00", "auto is 24-hour, in the zone's own time");
}

fn tmp(name: &str) -> std::path::PathBuf { let d = std::env::temp_dir().join(format!("wobbly-{name}-{}", std::process::id())); let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap(); d }
const BIN: &str = env!("CARGO_BIN_EXE_wobbly-clock-run");

#[test]
fn the_program_writes_frames_for_a_screen() {
    let dir = tmp("hdmi");
    let conf = dir.join("c.conf");
    std::fs::write(&conf, "location_latitude = 40.7\nlocation_longitude = -74\ntimeZone = UTC\ntwentyFourHourClock = on\n").unwrap();
    let out = Command::new(BIN).args(["--config", conf.to_str().unwrap(), "--sink", &format!("ppm:{}", dir.join("out").display()), "--size", "96x48", "--frames", "2", "--at", "1782057600000"]).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let f0 = std::fs::read(dir.join("out/frame-0000.ppm")).unwrap();
    let f1 = std::fs::read(dir.join("out/frame-0001.ppm")).unwrap();
    assert!(f0.starts_with(b"P6\n96 48\n255\n") && f0.len() == 13 + 96 * 48 * 3);
    assert_ne!(f0, f1, "the second frame is a second later, so the digits differ");
}

#[test]
fn the_program_writes_a_canvas_for_an_led_panel() {
    let dir = tmp("led");
    std::fs::write(dir.join("matrix.cfg"), std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/matrix/snake.cfg")).unwrap()).unwrap();
    let conf = dir.join("c.conf");
    std::fs::write(&conf, format!("output = matrix\nmatrixConfig = {}\nlocation_latitude = 40.7\nlocation_longitude = -74\ntimeZone = UTC\nbrightnessNight = 0.2\n", dir.join("matrix.cfg").display())).unwrap();
    // 04:00 UTC on 2026-06-22 is midnight in New York: the night level (20%) goes to the panel's brightness, the picture stays at full values
    let out = Command::new(BIN).args(["--config", conf.to_str().unwrap(), "--sink", &format!("ppm:{}", dir.join("out").display()), "--frames", "1", "--at", "1782100800000"]).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let canvas = std::fs::read(dir.join("out/canvas-0000.ppm")).unwrap();
    assert!(canvas.starts_with(b"P6\n128 32\n255\n"), "a 2 x 2 snake of 32 x 32 panels is a 128 x 32 canvas");
    assert_eq!(std::fs::read_to_string(dir.join("out/brightness-0000.txt")).unwrap().trim(), "20");
    assert!(canvas.iter().skip(13).any(|v| *v > 100), "the picture is not dimmed in software");
}

#[test]
fn the_program_reports_bad_input_and_a_missing_panel_driver() {
    let dir = tmp("bad");
    let conf = dir.join("c.conf");
    std::fs::write(&conf, "output = matrix\nmatrixConfig = /nonexistent/matrix.cfg\n").unwrap();
    let out = Command::new(BIN).args(["--config", conf.to_str().unwrap(), "--frames", "1"]).output().unwrap();
    assert!(!out.status.success() && String::from_utf8_lossy(&out.stderr).contains("matrix.cfg"));
    std::fs::write(&conf, "hideSeconds = maybe\n").unwrap();
    let out = Command::new(BIN).args(["--config", conf.to_str().unwrap(), "--sink", &format!("ppm:{}", dir.join("o").display()), "--frames", "1", "--at", "0"]).output().unwrap();
    assert!(out.status.success() && String::from_utf8_lossy(&out.stderr).contains("line 1"), "a bad value is reported but the clock still runs");
    let out = Command::new(BIN).args(["--help"]).output().unwrap();
    assert!(String::from_utf8_lossy(&out.stdout).contains("usage"));
}

#[test]
fn the_panel_program_gets_the_librarys_flags_and_frames() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tmp("sink");
    // a stand-in for wobbly-matrix: records its arguments, and what arrives on standard input
    let fake = dir.join("fake-matrix");
    std::fs::write(&fake, format!("#!/bin/sh\necho \"$@\" > {d}/args\ncat > {d}/stdin\n", d = dir.display())).unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::write(dir.join("matrix.cfg"), std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/matrix/snake.cfg")).unwrap()).unwrap();
    let conf = dir.join("c.conf");
    std::fs::write(&conf, format!("output = matrix\nmatrixConfig = {}\nlocation_latitude = 40.7\nlocation_longitude = -74\ntimeZone = UTC\nbrightnessNight = 0.5\nledSlowdownGpio = 3\nledRgbSequence = RBG\nledGpioMapping = adafruit-hat\nledPanelType = FM6126A\n", dir.join("matrix.cfg").display())).unwrap();
    let out = Command::new(BIN).env("WOBBLY_MATRIX_BIN", &fake).args(["--config", conf.to_str().unwrap(), "--sink", "matrix", "--frames", "2", "--at", "1782100800000"]).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let args = std::fs::read_to_string(dir.join("args")).unwrap();
    for want in ["--led-rows=32", "--led-cols=32", "--led-chain=4", "--led-parallel=1", "--led-gpio-mapping=adafruit-hat", "--led-slowdown-gpio=3", "--led-rgb-sequence=RBG", "--led-panel-type=FM6126A", "--led-pwm-bits=11"] {
        assert!(args.contains(want), "missing {want} in: {args}");
    }
    let stdin = std::fs::read(dir.join("stdin")).unwrap();
    let head = b"128 32 50\n";
    assert!(stdin.starts_with(head), "the first frame says its size and the panel brightness: {:?}", String::from_utf8_lossy(&stdin[..12.min(stdin.len())]));
    assert_eq!(stdin.len(), 2 * (head.len() + 128 * 32 * 3), "two frames of exactly the canvas size");
}

#[test]
fn a_missing_panel_program_says_how_to_get_it() {
    let dir = tmp("nosink");
    std::fs::write(dir.join("matrix.cfg"), std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/matrix/row.cfg")).unwrap()).unwrap();
    let conf = dir.join("c.conf");
    std::fs::write(&conf, format!("output = matrix\nmatrixConfig = {}\n", dir.join("matrix.cfg").display())).unwrap();
    let out = Command::new(BIN).env("WOBBLY_MATRIX_BIN", "/nonexistent/wobbly-matrix").args(["--config", conf.to_str().unwrap(), "--frames", "1"]).output().unwrap();
    assert!(!out.status.success() && String::from_utf8_lossy(&out.stderr).contains("native/matrix-sink"), "{}", String::from_utf8_lossy(&out.stderr));
}
