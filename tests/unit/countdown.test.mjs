// Countdown digits: which units show, never more than 6 digits (seconds shown) or 4 (hidden). Run: node tests/unit/countdown.test.mjs
import { check, done } from '../lib/check.mjs';
const { groupsFor, textOf, slotsFor, secondsLeft, parseTarget, defaultTarget, unitsFor, MAX_DIGITS } = await import('../../js/countdown.js');
const D = 86400, H = 3600, M = 60;
const t = (secs, sec) => textOf(groupsFor(secs, sec));

check('under a day, seconds shown: hours:minutes:seconds, the hours without a leading zero', t(5 * H + 4 * M + 3, true) === '5:04:03' && t(23 * H + 59 * M + 59, true) === '23:59:59' && t(0, true) === '0:00:00');
check('a day or more, seconds shown: days:hours:minutes (the seconds do not fit)', t(3 * D + 4 * H + 5 * M + 6, true) === '3:04:05' && t(45 * D + 23 * H + 59 * M, true) === '45:23:59' && t(99 * D + 1 * H + 2 * M, true) === '99:01:02');
check('100 days or more, seconds shown: days:hours', t(123 * D + 5 * H + 6 * M, true) === '123:05' && t(999 * D, true) === '999:00');
check('under a day, seconds hidden: hours:minutes', t(5 * H + 4 * M + 3, false) === '5:04' && t(0, false) === '0:00' && t(23 * H + 59 * M, false) === '23:59');
check('a day or more, seconds hidden: days:hours', t(3 * D + 4 * H + 5 * M, false) === '3:04' && t(99 * D + 23 * H, false) === '99:23');
check('100 days or more, seconds hidden: just the days', t(123 * D + 5 * H, false) === '123' && t(365 * D, false) === '365');

const digits = (g) => g.reduce((n, x) => n + x.length, 0);
let worstOn = 0, worstOff = 0, bad = '';
for (const secs of [0, 1, 59, 60, 3599, 3600, 86399, 86400, 86400 + 1, 9 * D, 10 * D, 99 * D + 86399, 100 * D, 365 * D, 999 * D + 86399, 5000 * D]) {
  worstOn = Math.max(worstOn, digits(groupsFor(secs, true))); worstOff = Math.max(worstOff, digits(groupsFor(secs, false)));
}
for (let secs = 0; secs < 400 * D; secs += 7919 * 3) { const a = digits(groupsFor(secs, true)), b = digits(groupsFor(secs, false)); if (a > 6 || b > 4) bad = `${secs}: ${a}/${b}`; }
check(`never more than ${MAX_DIGITS.withSeconds} digits with the seconds shown (worst ${worstOn})`, worstOn <= MAX_DIGITS.withSeconds && !bad, bad);
check(`never more than ${MAX_DIGITS.withoutSeconds} digits with the seconds hidden (worst ${worstOff})`, worstOff <= MAX_DIGITS.withoutSeconds && !bad, bad);
check('every number after the first has two digits', [0, 61, 4000, 90000, 9000000].every((s) => groupsFor(s, true).slice(1).every((g) => g.length === 2) && groupsFor(s, false).slice(1).every((g) => g.length === 2)));

const sl = slotsFor(3 * D + 4 * H + 5 * M, true);
check('slots: 3:04:05 shows the second digit slot of the first group, the minutes group and the seconds group, no hundreds', !sl.show.x && !sl.show.h0 && sl.show.m && sl.show.s && sl.h[1] === 3 && sl.m.join() === '0,4' && sl.s.join() === '0,5');
const s2 = slotsFor(123 * D + 5 * H, true);
check('slots: 123:05 uses the hundreds slot, both first digits, one more group and no seconds', s2.show.x && s2.show.h0 && s2.show.m && !s2.show.s && s2.x[0] === 1 && s2.h.join() === '2,3' && s2.m.join() === '0,5');
const s3 = slotsFor(365 * D, false);
check('slots: 365 alone has no minutes group and no seconds group', s3.show.x && s3.show.h0 && !s3.show.m && !s3.show.s && s3.x[0] === 3 && s3.h.join() === '6,5');
const s4 = slotsFor(45 * D + 5 * H, false);
check('slots: 45:05 shows two digits then a group', !s4.show.x && s4.show.h0 && s4.show.m && !s4.show.s);

check('secondsLeft counts up to the next whole second and never goes negative', secondsLeft(10000, 0) === 10 && secondsLeft(10000, 1) === 10 && secondsLeft(10000, 9999) === 1 && secondsLeft(10000, 10000) === 0 && secondsLeft(10000, 99999) === 0);
check('the digits tick when the clock\'s seconds do (every whole second)', secondsLeft(60000, 500) === 60 && secondsLeft(60000, 1000) === 59);
check('parseTarget reads a datetime-local value, and rejects nothing and rubbish', Number.isFinite(parseTarget('2026-12-25T08:00')) && Number.isNaN(parseTarget('')) && Number.isNaN(parseTarget('soon')));
check('a new countdown starts at the next local midnight', (() => { const v = defaultTarget(new Date(2026, 5, 21, 15, 30).getTime()); return v === '2026-06-22T00:00'; })());
check('the caption names the units shown', unitsFor(5 * H, true) === 'hours:minutes:seconds' && unitsFor(5 * D, true) === 'days:hours:minutes' && unitsFor(200 * D, true) === 'days:hours' && unitsFor(5 * H, false) === 'hours:minutes' && unitsFor(5 * D, false) === 'days:hours' && unitsFor(200 * D, false) === 'days');
done();
