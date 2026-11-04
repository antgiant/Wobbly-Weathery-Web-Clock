//! Countdown digits: days:hours:minutes:seconds capped at 6 digits with seconds shown, 4 without. A port of `js/countdown.js`.

pub const MAX_DIGITS_WITH_SECONDS: usize = 6;
pub const MAX_DIGITS_WITHOUT_SECONDS: usize = 4;

/// Whole seconds left (never below 0), counting up to the next whole second so it ticks when the clock's seconds do.
pub fn seconds_left(target_ms: f64, now_ms: f64) -> u64 {
    ((target_ms - now_ms) / 1000.0).ceil().max(0.0) as u64
}

/// The groups of digits to show: 1 to 3 groups, e.g. `[[1,2],[0,5],[3,0]]` for 12:05:30.
pub fn groups_for(secs: u64, show_seconds: bool) -> Vec<Vec<u8>> {
    let (d, h, m, s) = (secs / 86400, secs % 86400 / 3600, secs % 3600 / 60, secs % 60);
    let nums: Vec<(u64, usize)> = if show_seconds {
        if d >= 100 { vec![(d, 1), (h, 2)] } else if d >= 1 { vec![(d, 1), (h, 2), (m, 2)] } else { vec![(h, 1), (m, 2), (s, 2)] }
    } else if d >= 100 { vec![(d, 1)] } else if d >= 1 { vec![(d, 1), (h, 2)] } else { vec![(h, 1), (m, 2)] };
    nums.into_iter()
        .map(|(n, pad)| format!("{:0width$}", n, width = pad).bytes().map(|b| b - b'0').collect())
        .collect()
}

/// "12:05:30"
pub fn text_of(groups: &[Vec<u8>]) -> String {
    groups.iter().map(|g| g.iter().map(|d| d.to_string()).collect::<String>()).collect::<Vec<_>>().join(":")
}

/// Which digit slots are on screen, and what they show (x = hundreds of days; h, m, s = the three numbers).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Slots {
    pub x: [u8; 2],
    pub h: [u8; 2],
    pub m: [u8; 2],
    pub s: [u8; 2],
    /// x, h0, m, s on screen
    pub show: [bool; 4],
}

pub fn slots_for(secs: u64, show_seconds: bool) -> Slots {
    let g = groups_for(secs, show_seconds);
    let mut out = Slots { x: [0, 0], h: [0, 0], m: [0, 0], s: [0, 0], show: [false; 4] };
    let first = &g[0];
    match first.len() {
        3 => { out.x[0] = first[0]; out.h = [first[1], first[2]]; out.show[0] = true; out.show[1] = true; }
        2 => { out.h = [first[0], first[1]]; out.show[1] = true; }
        _ => out.h = [0, first[0]],
    }
    if let Some(m) = g.get(1) { out.m = [m[0], m[1]]; out.show[2] = true; }
    if let Some(s) = g.get(2) { out.s = [s[0], s[1]]; out.show[3] = true; }
    out
}

/// The caption's units: "days:hours:minutes", "hours:minutes:seconds" ...
pub fn units_for(secs: u64, show_seconds: bool) -> &'static str {
    let d = secs / 86400;
    if show_seconds {
        if d >= 100 { "days:hours" } else if d >= 1 { "days:hours:minutes" } else { "hours:minutes:seconds" }
    } else if d >= 100 { "days" } else if d >= 1 { "days:hours" } else { "hours:minutes" }
}
