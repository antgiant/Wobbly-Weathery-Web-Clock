// Countdown mode: the clock's digits show the time left to a date, as days:hours:minutes:seconds.
//
// There are never more than 6 digits on screen with the seconds shown, or 4 with them hidden, so the biggest units that
// fit are shown and the rest left off:
//   seconds shown    under a day:  hours:minutes:seconds        (H:MM:SS, 5 to 6 digits)
//                    a day or more: days:hours:minutes          (D:HH:MM, up to 6; the seconds do not fit)
//                    100 days or more: days:hours               (DDD:HH)
//   seconds hidden   under a day:  hours:minutes                (H:MM)
//                    a day or more: days:hours                  (D:HH, up to 4)
//                    100 days or more: days                     (DDD)
// The first number is written without a leading zero, every other one has two digits. Pure functions, no DOM.

export const MAX_DIGITS = { withSeconds: 6, withoutSeconds: 4 };

/** Whole seconds left (never below 0). `targetMs` and `nowMs` are epoch milliseconds; the answer counts up to the next whole second, so it ticks when the clock's seconds do. */
export const secondsLeft = (targetMs, nowMs) => Math.max(0, Math.ceil((targetMs - nowMs) / 1000));

/** The groups of digits to show for `secs` seconds left: an array of 1 to 3 arrays of digit numbers, e.g. [[1,2],[0,5],[3,0]] for 12:05:30. */
export function groupsFor(secs, showSeconds) {
  secs = Math.max(0, Math.floor(secs));
  const d = Math.floor(secs / 86400), h = Math.floor(secs % 86400 / 3600), m = Math.floor(secs % 3600 / 60), s = secs % 60;
  const digits = (n, pad) => String(n).padStart(pad, '0').split('').map(Number);
  let nums;
  if (showSeconds) nums = d >= 100 ? [[d, 1], [h, 2]] : d >= 1 ? [[d, 1], [h, 2], [m, 2]] : [[h, 1], [m, 2], [s, 2]];
  else nums = d >= 100 ? [[d, 1]] : d >= 1 ? [[d, 1], [h, 2]] : [[h, 1], [m, 2]];
  return nums.map(([n, pad]) => digits(n, pad));
}

/** The text of a groups array, "12:05:30". */
export const textOf = (groups) => groups.map((g) => g.join('')).join(':');

/**
 * What the clock's digit slots should show. Slots: x (a third digit of the first number: hundreds of days), h0 h1 (the first
 * number), m0 m1 (the second), s0 s1 (the third). `show` says which are on the screen.
 */
export function slotsFor(secs, showSeconds) {
  const g = groupsFor(secs, showSeconds);
  const first = g[0], out = { x: [0, 0], h: [0, 0], m: [0, 0], s: [0, 0], show: { x: false, h0: false, m: false, s: false } };
  if (first.length === 3) { out.x[0] = first[0]; out.h = [first[1], first[2]]; out.show.x = true; out.show.h0 = true; }
  else if (first.length === 2) { out.h = [first[0], first[1]]; out.show.h0 = true; }
  else out.h = [0, first[0]];
  if (g[1]) { out.m = g[1]; out.show.m = true; }
  if (g[2]) { out.s = g[2]; out.show.s = true; }
  return out;
}

/** "2026-12-25T08:00" (a datetime-local value, the viewer's own time zone) -> epoch ms, or NaN. */
export function parseTarget(value) {
  if (!value) return NaN;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/** The next local midnight after `nowMs`, as a datetime-local value (what a new countdown starts with). */
export function defaultTarget(nowMs) {
  const d = new Date(nowMs);
  d.setHours(24, 0, 0, 0);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Which units the digits are, for the caption: "d:h:m", "h:m:s", "d:h" ... (the same choice groupsFor makes). */
export function unitsFor(secs, showSeconds) {
  const d = Math.floor(Math.max(0, secs) / 86400);
  if (showSeconds) return d >= 100 ? 'days:hours' : d >= 1 ? 'days:hours:minutes' : 'hours:minutes:seconds';
  return d >= 100 ? 'days' : d >= 1 ? 'days:hours' : 'hours:minutes';
}

/**
 * Where a countdown is: 'counting' until the target, 'done' from the target to the end of that day (local time), which shows
 * 00:00, and 'over' after that, when the clock goes back to showing the time.
 */
export function phaseOf(targetMs, nowMs) {
  if (nowMs < targetMs) return 'counting';
  const end = new Date(targetMs);
  end.setHours(24, 0, 0, 0);                                   // the next local midnight (a target at exactly 00:00 counts as that day)
  return nowMs < end.getTime() ? 'done' : 'over';
}

/** The digit slots for the finished state: 00:00. */
export const doneSlots = () => ({ x: [0, 0], h: [0, 0], m: [0, 0], s: [0, 0], show: { x: false, h0: true, m: true, s: false } });
