// When a kiosk reloads itself to update: in the quiet hour, not the moment an update is found (js/quiet.js). Run: node tests/unit/quiet.test.mjs
import { check, done } from '../lib/check.mjs';
const { msUntilQuiet, QUIET_HOUR } = await import('../../js/quiet.js');
const at = (h, m = 0, s = 0, day = 5) => new Date(2026, 10, day, h, m, s).getTime();
check('the quiet hour is 3 at night', QUIET_HOUR === 3);
check('found at 14:00: it waits until 3 the next morning (13 hours and a second)', msUntilQuiet(at(14)) === 13 * 3600e3 + 1000);
check('found at 2:59:30: it waits for 3:00', msUntilQuiet(at(2, 59, 30)) === 30e3 + 1000);
check('found at 3:00 or later in the quiet hour: it reloads at the next minute turn', msUntilQuiet(at(3, 20, 15)) <= 61000 && msUntilQuiet(at(3, 20, 15)) > 40000 && msUntilQuiet(at(3, 20, 15)) % 1 === 0);
check('found at 4:00: not the quiet hour any more, so tomorrow at 3 (23 hours)', msUntilQuiet(at(4)) === 23 * 3600e3 + 1000);
check('it is never more than a day and a minute, and never negative, at any minute of the day', Array.from({ length: 1440 }, (_, i) => msUntilQuiet(at(0, i))).every((ms) => ms > 0 && ms <= 24 * 3600e3 + 1000));
check('another hour can be given', msUntilQuiet(at(10), 12) === 2 * 3600e3 + 1000);
done();
