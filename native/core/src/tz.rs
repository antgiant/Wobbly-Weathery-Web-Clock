//! Local time with no browser and no libc: the UTC offset of a time zone at a moment, from the system's zoneinfo (TZif) files. Reads the 64-bit
//! block and the POSIX rule at the end ("EST5EDT,M3.2.0,M11.1.0") that current ("slim") files use for every year after the last listed change.

#[derive(Clone, Debug)]
pub struct Zone { transitions: Vec<(i64, usize)>, types: Vec<(i32, bool)>, rule: Option<Rule> }

#[derive(Clone, Debug)]
struct Rule { std: i32, dst: Option<(i32, Change, Change)> }
#[derive(Clone, Copy, Debug)]
struct Change { month: u32, week: u32, day: u32, secs: i64 }

fn be32(b: &[u8], i: usize) -> i64 { i32::from_be_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]) as i64 }
fn be64(b: &[u8], i: usize) -> i64 { i64::from_be_bytes(b[i..i + 8].try_into().unwrap()) }

fn parse_offset(s: &str) -> Option<(i32, usize)> {      // "[+-]hh[:mm[:ss]]" -> seconds, and how many bytes were used
    let b = s.as_bytes(); let mut i = 0; let mut sign = 1;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') { if b[i] == b'-' { sign = -1; } i += 1; }
    let mut parts = [0i32; 3]; let mut k = 0;
    loop {
        let st = i; while i < b.len() && b[i].is_ascii_digit() { i += 1; }
        if st == i { return None; }
        parts[k] = s[st..i].parse().ok()?; k += 1;
        if k < 3 && i < b.len() && b[i] == b':' { i += 1; } else { break; }
    }
    Some((sign * (parts[0] * 3600 + parts[1] * 60 + parts[2]), i))
}
fn skip_name(s: &str) -> usize {                         // "EST" or "<+0530>"
    if s.starts_with('<') { s.find('>').map(|i| i + 1).unwrap_or(s.len()) } else { s.chars().take_while(|c| c.is_ascii_alphabetic()).count() }
}
fn parse_change(s: &str) -> Option<Change> {             // "M3.2.0[/time]"
    let (rule, time) = s.split_once('/').map(|(a, b)| (a, Some(b))).unwrap_or((s, None));
    let m = rule.strip_prefix('M')?; let mut it = m.split('.');
    let (month, week, day) = (it.next()?.parse().ok()?, it.next()?.parse().ok()?, it.next()?.parse().ok()?);
    let secs = match time { Some(t) => parse_offset(t)?.0 as i64, None => 7200 };
    Some(Change { month, week, day, secs })
}
fn parse_rule(s: &str) -> Option<Rule> {
    let n = skip_name(s); let (std_off, used) = parse_offset(&s[n..])?; let std = -std_off;     // POSIX offsets are west-positive
    let rest = &s[n + used..];
    if rest.is_empty() { return Some(Rule { std, dst: None }); }
    let n2 = skip_name(rest); let after = &rest[n2..];
    let (dst, tail) = match parse_offset(after) { Some((o, u)) if !after.starts_with(',') => (-o, &after[u..]), _ => (std + 3600, after) };
    let tail = tail.strip_prefix(',')?; let (a, b) = tail.split_once(',')?;
    Some(Rule { std, dst: Some((dst, parse_change(a)?, parse_change(b)?)) })
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y }; let era = y.div_euclid(400); let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1; let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}
fn year_of(t: i64) -> i64 { let z = t.div_euclid(86400) + 719468; let era = z.div_euclid(146097); let doe = z - era * 146097; let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; let y = yoe + era * 400; let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); let mp = (5 * doy + 2) / 153; let m = if mp < 10 { mp + 3 } else { mp - 9 }; if m <= 2 { y + 1 } else { y } }
/// The UTC seconds of a rule's change in a year, given the offset in force before it.
fn change_at(c: &Change, year: i64, offset: i32) -> i64 {
    let first = days_from_civil(year, c.month as i64, 1);
    let wd = (first + 4).rem_euclid(7);                                   // 0 = Sunday (1970-01-01 was a Thursday)
    let mut day = first + (c.day as i64 - wd).rem_euclid(7) + 7 * (c.week as i64 - 1);
    let next_month = if c.month == 12 { days_from_civil(year + 1, 1, 1) } else { days_from_civil(year, c.month as i64 + 1, 1) };
    while day >= next_month { day -= 7; }                                 // week 5 means the last one
    day * 86400 + c.secs - offset as i64
}

impl Rule {
    fn offset_at(&self, t: i64) -> i32 {
        let Some((dst, start, end)) = &self.dst else { return self.std };
        let y = year_of(t + self.std as i64);
        let (s, e) = (change_at(start, y, self.std), change_at(end, y, *dst));
        let in_dst = if s < e { t >= s && t < e } else { t >= s || t < e };      // southern hemisphere: DST spans the new year
        if in_dst { *dst } else { self.std }
    }
}

impl Zone {
    pub fn parse(b: &[u8]) -> Result<Zone, String> {
        if b.len() < 44 || &b[0..4] != b"TZif" { return Err("not a TZif file".into()); }
        let v = b[4];
        let counts = |at: usize| -> [usize; 6] { let mut c = [0usize; 6]; for (i, x) in c.iter_mut().enumerate() { *x = be32(b, at + 20 + i * 4) as usize; } c };
        let c1 = counts(0);                                     // isutcnt, isstdcnt, leapcnt, timecnt, typecnt, charcnt
        let (start, tsize) = if v >= b'2' { (44 + c1[3] * 4 + c1[3] + c1[4] * 6 + c1[5] + c1[2] * 8 + c1[1] + c1[0], 8) } else { (0, 4) };
        let c = counts(start); let mut p = start + 44;
        let (timecnt, typecnt, charcnt, leapcnt, isstd, isut) = (c[3], c[4], c[5], c[2], c[1], c[0]);
        let times: Vec<i64> = (0..timecnt).map(|i| if tsize == 8 { be64(b, p + i * 8) } else { be32(b, p + i * 4) }).collect(); p += timecnt * tsize;
        let idx: Vec<usize> = (0..timecnt).map(|i| b[p + i] as usize).collect(); p += timecnt;
        let types: Vec<(i32, bool)> = (0..typecnt).map(|i| (be32(b, p + i * 6) as i32, b[p + i * 6 + 4] != 0)).collect(); p += typecnt * 6 + charcnt + leapcnt * (tsize + 4) + isstd + isut;
        let rule = if tsize == 8 && p < b.len() && b[p] == b'\n' { let end = b[p + 1..].iter().position(|x| *x == b'\n').map(|i| p + 1 + i).unwrap_or(b.len()); std::str::from_utf8(&b[p + 1..end]).ok().and_then(parse_rule) } else { None };
        Ok(Zone { transitions: times.into_iter().zip(idx).collect(), types, rule })
    }

    pub fn load(name_or_path: &str) -> Result<Zone, String> {
        let path = if name_or_path.starts_with('/') { name_or_path.to_string() } else { format!("/usr/share/zoneinfo/{name_or_path}") };
        Zone::parse(&std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?)
    }

    /// A zone from a POSIX rule alone, like "EST5EDT,M3.2.0,M11.1.0" (what a slim zoneinfo file ends with).
    pub fn from_posix(rule: &str) -> Option<Zone> { Some(Zone { transitions: vec![], types: vec![], rule: Some(parse_rule(rule)?) }) }

    /// A fixed offset, for tests and for a machine with no zoneinfo.
    pub fn fixed(offset_secs: i32) -> Zone { Zone { transitions: vec![], types: vec![(offset_secs, false)], rule: None } }

    /// Seconds to add to UTC to get the local time at `utc_secs`.
    pub fn offset_at(&self, utc_secs: i64) -> i32 {
        match self.transitions.last() {
            Some((last, _)) if utc_secs >= *last => match &self.rule { Some(r) => r.offset_at(utc_secs), None => self.types[self.transitions.last().unwrap().1].0 },
            Some(_) => {
                let i = self.transitions.partition_point(|(t, _)| *t <= utc_secs);
                if i == 0 { self.types.iter().find(|t| !t.1).unwrap_or(&self.types[0]).0 } else { self.types[self.transitions[i - 1].1].0 }
            }
            None => match &self.rule { Some(r) => r.offset_at(utc_secs), None => self.types.first().map(|t| t.0).unwrap_or(0) },
        }
    }

    /// (hour, minute, second) on the local wall clock.
    pub fn wall_clock(&self, utc_ms: f64) -> (u32, u32, u32) {
        let secs = (utc_ms / 1000.0).floor() as i64;
        let local = secs + self.offset_at(secs) as i64;
        let day_secs = local.rem_euclid(86400);
        ((day_secs / 3600) as u32, (day_secs % 3600 / 60) as u32, (day_secs % 60) as u32)
    }
}
