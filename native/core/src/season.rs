//! The Christmas season: from US Thanksgiving (the fourth Thursday of November) to Christmas Day, in the calendar the clock is showing. A port of js/season.js.

use crate::tz::days_from_civil;

/// 0 = Sunday .. 6 = Saturday, for a civil date.
fn weekday(y: i64, m: i64, d: i64) -> i64 { (days_from_civil(y, m, d) + 4).rem_euclid(7) }

/// The day of the month of the fourth Thursday of November.
pub fn thanksgiving_day(year: i64) -> i64 { 1 + (4 - weekday(year, 11, 1) + 7) % 7 + 21 }

/// True from Thanksgiving through December 25.
pub fn is_christmas_season(year: i64, month: i64, day: i64) -> bool {
    if month == 12 { return day <= 25; }
    month == 11 && day >= thanksgiving_day(year)
}
