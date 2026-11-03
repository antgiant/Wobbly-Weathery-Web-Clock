// Brightness: a day level and a night level, with sunset and sunrise as the transition. Run: node tests/unit/dim.test.mjs
import { installDomStub } from '../lib/dom-stub.mjs';
import { check, done } from '../lib/check.mjs';
installDomStub({});
const { nightness, brightnessAt, dimmingOn } = await import('../../js/sky/dim.js');

const H = 3600e3;
// a day: sunrise at 06:00, sunset at 18:00 (epoch ms from a fixed midnight)
const D0 = Date.UTC(2026, 5, 21, 0, 0, 0), at = (h) => D0 + h * H;
const ev = (now) => {                                         // the events around `now`, as sunEvents() reports them
  const rise = [at(6 - 24), at(6), at(6 + 24)], set = [at(18 - 24), at(18), at(18 + 24)];
  return { prevRise: new Date(Math.max(...rise.filter((x) => x <= now))), prevSet: new Date(Math.max(...set.filter((x) => x <= now))), nextRise: new Date(Math.min(...rise.filter((x) => x > now))), nextSet: new Date(Math.min(...set.filter((x) => x > now))) };
};
const n = (h, minutes = 45) => nightness(at(h), ev(at(h)), 0, minutes);

check('noon: full day level (night weight 0)', n(12) === 0);
check('midnight: full night level (night weight 1)', n(0) === 1 && n(2) === 1 && n(23.9) === 1);
check('well before the sunset transition it is still day, well after it is night', n(17) === 0 && n(19) === 1);
check('at the moment of sunset it is exactly half way', Math.abs(n(18) - 0.5) < 1e-9, String(n(18)));
check('at the moment of sunrise it is exactly half way', Math.abs(n(6) - 0.5) < 1e-9, String(n(6)));
check('the transition is centred on sunset: a quarter of an hour before is less than half, after is more', n(17.75) < 0.5 && n(18.25) > 0.5);
check('the transition is 45 minutes wide by default: nothing before 17:37:30, full from 18:22:30', n(17.62) < 0.02 && n(18.38) > 0.98);
check('the width is a setting: with 2 hours it starts at 17:00 and ends at 19:00', n(17.1, 120) > 0 && n(16.9, 120) === 0 && n(19.05, 120) === 1 && n(18.9, 120) < 1);
let mono = true, prev = -1, jump = 0;
for (let m = 16.5 * 60; m <= 19.5 * 60; m += 1) { const v = nightness(at(m / 60), ev(at(m / 60)), 0, 45); if (v < prev - 1e-12) mono = false; jump = Math.max(jump, Math.abs(v - Math.max(prev, 0))); prev = v; }
check('through the evening it only ever goes up, smoothly (no step over a minute)', mono && jump < 0.05, `largest step per minute ${jump.toFixed(3)}`);
mono = true; prev = 2;
for (let m = 4.5 * 60; m <= 7.5 * 60; m += 1) { const v = nightness(at(m / 60), ev(at(m / 60)), 0, 45); if (v > prev + 1e-12) mono = false; prev = v; }
check('through the morning it only ever goes down', mono);
check('a short day (the transitions overlap) never goes outside 0..1', [0, 1, 2, 3, 4].every((k) => { const e2 = { prevRise: new Date(at(12)), prevSet: new Date(at(-3)), nextRise: new Date(at(36)), nextSet: new Date(at(13)) }; const v = nightness(at(12.5 + k * 0.1), e2, 0, 120); return v >= 0 && v <= 1; }));

// polar day and night: no events, the sun's height decides
check('no sunset ever (polar day): the sun high up is day', nightness(at(12), { prevRise: null, prevSet: null, nextRise: null, nextSet: null }, 30, 45) === 0);
check('no sunrise ever (polar night): the sun far down is night', nightness(at(12), { prevRise: null, prevSet: null, nextRise: null, nextSet: null }, -30, 45) === 1);
check('no events and no sun height yet: day (never dark by mistake)', nightness(at(12), null, NaN, 45) === 0);

// the brightness itself
const b = (h, day, night, mins) => brightnessAt(at(h), ev(at(h)), 0, day, night, mins);
check('day 100% and night 25%: noon is 1, midnight is 0.25, sunset is in between (0.625)', b(12, 1, 0.25) === 1 && b(0, 1, 0.25) === 0.25 && Math.abs(b(18, 1, 0.25) - 0.625) < 1e-9);
check('a dimmer day works too: day 60%, night 20%', Math.abs(b(12, 0.6, 0.2) - 0.6) < 1e-9 && Math.abs(b(0, 0.6, 0.2) - 0.2) < 1e-9);
check('a brighter night than day is allowed (night 100%, day 40%)', Math.abs(b(12, 0.4, 1) - 0.4) < 1e-9 && b(0, 0.4, 1) === 1);
check('the level never goes below 10% (a screen cannot be switched off by mistake)', b(0, 0, 0) === 0.1 && b(12, -5, 0.01) === 0.1 && Number.isFinite(b(0, 'x', 'y')));
check('junk or missing settings mean "no veil"', b(12, undefined, undefined) === 1 && b(0, NaN, null) === 1);

check('dimmingOn: off at 100 / 100, on when either level is lower', dimmingOn({ brightnessDay: 1, brightnessNight: 1 }) === false && dimmingOn({ brightnessDay: 1, brightnessNight: 0.5 }) && dimmingOn({ brightnessDay: 0.8, brightnessNight: 1 }));
done();
