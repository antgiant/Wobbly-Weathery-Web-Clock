// Aurora: magnetic latitude, the oval's edge, when it is seen and where (js/sky/aurora.js). Run: node tests/unit/aurora.test.mjs
import { check, done } from '../lib/check.mjs';
const { geomagneticLatitude, poleBearing, ovalEdge, auroraView, kpFromForecast } = await import('../../js/sky/aurora.js');
const near = (a, b, e) => Math.abs(a - b) <= e;

check('the magnetic pole is at 90 degrees magnetic latitude, the geographic pole is not', near(geomagneticLatitude(80.7, -72.7), 90, 0.01) && near(geomagneticLatitude(90, 0), 80.7, 0.1));
check('known places (dipole model, to a degree or two): Fairbanks about 65 N magnetic, Chicago 51, London 53, Tromso 67, Sydney -40 (a dipole is a little off the real field, which has Sydney at -45)', near(geomagneticLatitude(64.8, -147.7), 65.6, 1) && near(geomagneticLatitude(41.9, -87.6), 50.8, 1) && near(geomagneticLatitude(51.5, -0.1), 53.4, 1) && near(geomagneticLatitude(69.65, 18.96), 67.5, 1) && near(geomagneticLatitude(-33.9, 151.2), -40.3, 1));
check('the southern hemisphere is negative, the same distance from the other pole', geomagneticLatitude(-41.9, 92.7) < -50);
check('from Chicago the pole is about north (a little west of it); from London about north-west', (() => { const c = poleBearing(41.9, -87.6), l = poleBearing(51.5, -0.1); return (c > 340 || c < 10) && l > 270 && l < 360; })());
check('from the southern hemisphere the bearing is toward the south pole region', (() => { const b = poleBearing(-33.9, 151.2); return b > 120 && b < 240; })());
check('the oval\'s edge is 66 degrees when the field is quiet and 48 in a great storm', ovalEdge(0) === 66 && ovalEdge(9) === 48 && ovalEdge(5) === 56);

const dark = { sunAlt: -30, cover: [0, 0, 0] };
const fb = { lat: 64.8, lon: -147.7, kp: 4, ...dark };
check('Fairbanks on a clear night: a strong aurora, high in the sky (and still some at Kp 0)', auroraView(fb).strength > 0.9 && auroraView(fb).height > 0.7 && auroraView({ ...fb, kp: 0 }).strength > 0.2, JSON.stringify(auroraView(fb)));
check('Chicago on a quiet night: nothing', auroraView({ lat: 41.9, lon: -87.6, kp: 2, ...dark }).strength === 0);
check('Chicago needs a storm: Kp 5 nothing, Kp 7 a little, Kp 8 some, low in the north; Kp 9 more', (() => { const v = (kp) => auroraView({ lat: 41.9, lon: -87.6, kp, ...dark }); return v(5).strength === 0 && v(7).strength < v(8).strength && v(8).strength > 0.3 && v(8).height < 0.3 && v(9).strength > v(8).strength; })());
check('the stronger the storm the more it is seen, at one place', [0, 3, 5, 7, 9].map((kp) => auroraView({ lat: 50, lon: -100, kp, ...dark }).strength).every((v, i, a) => i === 0 || v >= a[i - 1]));
check('daylight and twilight: none; deep night full', auroraView({ ...fb, sunAlt: 10 }).strength === 0 && auroraView({ ...fb, sunAlt: -6 }).strength === 0 && auroraView({ ...fb, sunAlt: -18 }).strength > 0.9);
check('cloud hides it, thin high cloud only dims it, fog hides it', auroraView({ ...fb, cover: [1, 1, 1] }).strength < 0.1 && auroraView({ ...fb, cover: [0, 0, 0.8] }).strength > 0.5 && auroraView({ ...fb, fog: 1 }).strength === 0);
check('no Kp, no aurora (and no crash on rubbish)', auroraView({ ...fb, kp: null }).strength === 0 && auroraView({ lat: NaN, lon: 0, kp: 5, ...dark }).strength === 0);

const now = Date.parse('2026-11-10T22:30:00Z');
const rows = [{ time_tag: '2026-11-10T18:00:00', kp: 2.33 }, { time_tag: '2026-11-10T21:00:00', kp: 4.67 }, { time_tag: '2026-11-11T00:00:00', kp: 6 }, { time_tag: '2026-11-11T03:00:00', kp: 7 }];
check('Kp: the latest entry that is not in the future', kpFromForecast(rows, now) === 4.67);
check('Kp: old data (more than 12 hours) is not used, rubbish gives null', kpFromForecast(rows, now + 30 * 3600e3) === null && kpFromForecast(null) === null && kpFromForecast([{ time_tag: 'x', kp: 'y' }], now) === null);
check('Kp: the older file format (Kp with a capital) is read too', kpFromForecast([{ time_tag: '2026-11-10T21:00:00', Kp: 3.33 }], now) === 3.33);
done();
