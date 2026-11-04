//! Local time must match the JavaScript engine (Intl) for the zones the page can show, around daylight-saving changes, with the real zoneinfo
//! files and with just the POSIX rule (the way slim zoneinfo files describe every year after the last change).
use wobbly_core::tz::Zone;

fn vectors() -> Vec<(String, i64, (u32, u32, u32))> {
    let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden.tsv")).unwrap();
    text.lines().filter(|l| l.starts_with("tz\t")).map(|l| {
        let c: Vec<&str> = l.split('\t').collect(); let h: Vec<u32> = c[3].split(',').map(|x| x.parse().unwrap()).collect();
        (c[1].to_string(), c[2].parse().unwrap(), (h[0], h[1], h[2]))
    }).collect()
}

#[test]
fn the_zoneinfo_files_agree_with_intl() {
    let v = vectors(); assert!(v.len() > 200);
    let mut missing = 0;
    for (zone, secs, want) in &v {
        let Ok(z) = Zone::load(zone) else { missing += 1; continue };
        assert_eq!(z.wall_clock(*secs as f64 * 1000.0), *want, "{zone} at {secs}");
    }
    assert!(missing < v.len() / 4, "the machine has too few zoneinfo files to test ({missing} missing)");
}

#[test]
fn the_posix_rule_alone_agrees_with_intl_from_2008() {
    // current rules: every year after 2007 for the US zones, 2008 onward for Sydney, 2012 for Auckland (checked from 2015)
    let rules = [("America/New_York", "EST5EDT,M3.2.0,M11.1.0"), ("America/Los_Angeles", "PST8PDT,M3.2.0,M11.1.0"), ("Europe/London", "GMT0BST,M3.5.0/1,M10.5.0"), ("Europe/Paris", "CET-1CEST,M3.5.0,M10.5.0/3"),
        ("Australia/Sydney", "AEST-10AEDT,M10.1.0,M4.1.0/3"), ("Pacific/Auckland", "NZST-12NZDT,M9.5.0,M4.1.0/3"), ("Asia/Kolkata", "IST-5:30"), ("Asia/Kathmandu", "<+0545>-5:45"), ("Asia/Tokyo", "JST-9"), ("America/Phoenix", "MST7"), ("UTC", "UTC0")];
    let mut n = 0;
    for (zone, secs, want) in vectors() {
        if secs < 1_420_070_400 { continue; }                    // 2015 on
        let Some((_, rule)) = rules.iter().find(|(z, _)| *z == zone) else { continue };
        let z = Zone::from_posix(rule).unwrap_or_else(|| panic!("cannot parse {rule}"));
        assert_eq!(z.wall_clock(secs as f64 * 1000.0), want, "{zone} ({rule}) at {secs}");
        n += 1;
    }
    assert!(n > 100, "only {n} checks");
}

#[test]
fn a_fixed_zone_and_midnight() {
    let z = Zone::fixed(-5 * 3600);
    assert_eq!(z.wall_clock(0.0), (19, 0, 0));
    assert_eq!(Zone::fixed(0).wall_clock(86_399_000.0), (23, 59, 59));
    assert_eq!(Zone::fixed(3600).wall_clock(-1000.0), (0, 59, 59));
    assert!(Zone::parse(b"not a zone file at all, just text of some length........").is_err());
}
