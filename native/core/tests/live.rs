//! Live weather: the request, the answer mapped like the page maps it, failures kept quiet, and the whole program using it (with a stand-in for curl).
use std::os::unix::fs::PermissionsExt;
use std::process::Command;
use wobbly_core::live::{fetch_weather, forecast_url, Live};

fn tmp(name: &str) -> std::path::PathBuf { let d = std::env::temp_dir().join(format!("wobbly-{name}-{}", std::process::id())); let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap(); d }
/// a stand-in for curl: records its arguments and prints the fixture (or fails)
fn fake_curl(dir: &std::path::Path, body: Option<&str>) -> std::path::PathBuf {
    let p = dir.join("curl");
    let script = match body { Some(f) => format!("#!/bin/sh\necho \"$@\" >> {d}/curl.log\ncat {f}\n", d = dir.display()), None => format!("#!/bin/sh\necho \"$@\" >> {d}/curl.log\necho 'curl: (6) Could not resolve host' >&2\nexit 6\n", d = dir.display()) };
    std::fs::write(&p, script).unwrap();
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
    p
}
const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/rain.json");

#[test]
fn the_request_is_the_pages() {
    let u = forecast_url(40.7128, -74.006);
    assert!(u.starts_with("https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current="), "{u}");
    for f in ["weather_code", "cloud_cover_low", "wind_speed_10m", "wind_direction_10m", "snowfall", "visibility"] { assert!(u.contains(f), "{f}"); }
    assert!(u.contains("wind_speed_unit=ms"), "metres per second, as the page asks");
}

#[test]
fn the_answer_is_mapped_like_the_page_maps_it_and_failures_are_reported() {
    let dir = tmp("live1");
    // serialised with the other env-var tests in this file by using one process-wide lock
    let _g = LOCK.lock().unwrap();
    std::env::set_var("WOBBLY_CURL", fake_curl(&dir, Some(FIXTURE)));
    let w = fetch_weather(40.7, -74.0).unwrap();
    assert!(w.precip > 0.6 && w.snowfall == 0.0 && w.cover[0] == 1.0 && (w.temp_c - 14.2).abs() < 1e-9, "{w:?}");
    assert_eq!(w.mode(), "storm".replace("storm", if w.precip >= 0.75 { "storm" } else { "rain" }));
    let (speed, to) = w.ground_wind();
    assert!((speed - 8.5).abs() < 1e-9 && (to - 70.0).abs() < 0.1, "wind from 250 degrees blows towards 70: {speed} {to}");
    let log = std::fs::read_to_string(dir.join("curl.log")).unwrap();
    assert!(log.contains("--fail") && log.contains("-m 20") && log.contains("latitude=40.70"), "{log}");
    std::env::set_var("WOBBLY_CURL", fake_curl(&dir, None));
    assert!(fetch_weather(1.0, 1.0).unwrap_err().contains("curl failed"));
    std::env::set_var("WOBBLY_CURL", "/nonexistent/curl");
    assert!(fetch_weather(1.0, 1.0).unwrap_err().contains("install curl"));
    std::env::remove_var("WOBBLY_CURL");
}

static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[test]
fn a_garbled_answer_is_an_error_not_a_clear_sky() {
    let dir = tmp("live2");
    let _g = LOCK.lock().unwrap();
    let junk = dir.join("junk.json"); std::fs::write(&junk, "<html>captive portal</html>").unwrap();
    std::env::set_var("WOBBLY_CURL", fake_curl(&dir, Some(junk.to_str().unwrap())));
    assert!(fetch_weather(1.0, 1.0).unwrap_err().contains("no current conditions"));
    std::env::remove_var("WOBBLY_CURL");
    let live = Live::default();
    assert!(live.get().is_none());
    live.set(wobbly_core::weather::Weather::preset("snow"));
    assert_eq!(live.get().unwrap().mode(), "snow");
}

#[test]
fn the_program_draws_the_live_weather() {
    let dir = tmp("live3");
    let curl = fake_curl(&dir, Some(FIXTURE));
    std::fs::write(dir.join("c.conf"), "weatherMode = live\nlocation_latitude = 40.7\nlocation_longitude = -74\ntimeZone = UTC\nclockStyle = glass\nwindSway = lean\n").unwrap();
    let run = |curl: &std::path::Path, out: &str| {
        let r = Command::new(env!("CARGO_BIN_EXE_wobbly-clock-run")).env("WOBBLY_CURL", curl).args(["--config", dir.join("c.conf").to_str().unwrap(), "--sink", &format!("ppm:{}", dir.join(out).display()), "--size", "320x180", "--frames", "1", "--at", "1782057600000"]).output().unwrap();
        assert!(r.status.success(), "{}", String::from_utf8_lossy(&r.stderr));
        (std::fs::read(dir.join(out).join("frame-0000.ppm")).unwrap(), String::from_utf8_lossy(&r.stderr).to_string())
    };
    let (rainy, _) = run(&curl, "rainy");
    // no network: live weather is clear (and the program says why on its error output)
    let broken = fake_curl(&tmp("live3b"), None);
    let (clear, err) = run(&broken, "clear");
    assert!(err.contains("live weather"), "{err}");
    assert!(rainy != clear, "rain and cloud change the picture");
    let lum = |f: &[u8]| { let at = f.windows(4).position(|w| w == b"255\n").unwrap() + 4; f[at..].chunks_exact(3).map(|p| p[0] as u64 + p[1] as u64 + p[2] as u64).sum::<u64>() };
    assert!(lum(&rainy) != lum(&clear));
}
