//! The settings file the program reads (the same `key = value` file the Node command line writes).
use wobbly_core::config::{parse, Config};

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
