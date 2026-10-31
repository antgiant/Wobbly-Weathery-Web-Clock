// The Christmas season: from US Thanksgiving (the fourth Thursday of November) to Christmas Day, in the viewer's
// own calendar (the date the clock is showing, so time travel works). Pure functions: testable in node.

/** Day of the month of the fourth Thursday of November. */
export function thanksgivingDay(year) {
  const first = new Date(year, 10, 1).getDay();            // 0 Sunday .. 6 Saturday
  return 1 + ((4 - first + 7) % 7) + 21;
}

/** True from Thanksgiving through December 25 (local time of `date`). */
export function isChristmasSeason(date) {
  const m = date.getMonth(), d = date.getDate();
  if (m === 11) return d <= 25;
  return m === 10 && d >= thanksgivingDay(date.getFullYear());
}
