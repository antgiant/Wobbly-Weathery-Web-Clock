// Checks the sunrise / sunset countdown and the follow-the-sun camera. Run: node tools/test-sunpath.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
globalThis.Astronomy = require('../js/vendor/astronomy.browser.min.js');
const { sunEvents, countdownState, followHeading, headingForSunAt, sunHorizon } = await import('../js/sky/sunpath.js');
let fails = 0;
const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + ' ' + x); if (!ok) fails++; };

// screen x of the sun for a camera: inverse of headingForSunAt, so the test does not just repeat the solver
const P = 12, fov = 80, aspect = 16 / 9, tanX = Math.tan(fov * Math.PI / 360);
const screenXOf = (az, alt, H) => {
  const d = [Math.sin(az * Math.PI / 180) * Math.cos(alt * Math.PI / 180), Math.sin(alt * Math.PI / 180), Math.cos(az * Math.PI / 180) * Math.cos(alt * Math.PI / 180)];
  const h = H * Math.PI / 180, p = P * Math.PI / 180;
  const cx = d[0] * Math.cos(h) - d[2] * Math.sin(h);
  const cz = d[0] * Math.sin(h) * Math.cos(p) + d[1] * Math.sin(p) + d[2] * Math.cos(h) * Math.cos(p);
  return (cx / (cz * tanX) * 0.5 + 0.5);
};
const view = { pitch: P, tanX };
const sunX = (date, lat, lon) => {
  const H = followHeading(date, lat, lon, 0, view);
  const s = sunHorizon(date, new Astronomy.Observer(lat, lon, 0));
  return { x: screenXOf(s.azimuth, s.altitude, H), H, s };
};

for (const [name, lat, lon, day] of [['New York equinox', 40.7, -74, '2026-03-20'], ['New York June', 40.7, -74, '2026-06-21'], ['New York December', 40.7, -74, '2026-12-21'], ['Sydney equinox (southern)', -33.9, 151.2, '2026-03-20'], ['Quito (near the equator)', -0.2, -78.5, '2026-06-21']]) {
  const noon = new Date(day + 'T12:00:00Z');
  const ev = sunEvents(noon, lat, lon, 0);
  // use the real events of the local day around the instant
  // one whole day: the sunrise and the sunset that follows it
  const rise = ev.nextSet < ev.nextRise ? ev.prevRise : ev.nextRise;
  const set = sunEvents(new Date(+rise + 3600e3), lat, lon, 0).nextSet;
  const eps = 2 * 60000;
  const a = sunX(new Date(+rise + eps), lat, lon), b = sunX(new Date(+set - eps), lat, lon);
  check(`${name}: sun starts in the right quarter`, a.x > 0.6 && a.x < 0.93, `x=${a.x.toFixed(2)}`);
  check(`${name}: sun ends in the left quarter`, b.x > 0.07 && b.x < 0.4, `x=${b.x.toFixed(2)}`);
  // moves steadily right to left through the day
  let prev = 2, mono = true, jump = 0;
  for (let t = +rise + eps; t < +set - eps; t += 20 * 60000) { const { x } = sunX(new Date(t), lat, lon); if (x > prev + 0.01) mono = false; jump = Math.max(jump, Math.abs(prev - x) < 1 ? Math.abs(prev - x) : 0); prev = x; }
  check(`${name}: sun only ever moves right to left`, mono);
  check(`${name}: no jumps (largest step in 20 min ${jump.toFixed(3)})`, jump < 0.08);
}
// seasons: the sun starts further right in summer than in winter (northern hemisphere)
{
  const f = (day) => { const noon = new Date(day + 'T12:00:00Z'), ev = sunEvents(noon, 40.7, -74, 0); const r = ev.nextSet < ev.nextRise ? ev.prevRise : ev.nextRise; return sunX(new Date(+r + 120000), 40.7, -74).x; };
  const jun = f('2026-06-21'), dec = f('2026-12-21');
  check('seasons show: summer sunrise starts further right than winter', jun > dec + 0.05, `june ${jun.toFixed(2)} vs december ${dec.toFixed(2)}`);
}
// the view never tilts: pitch is not an output, and the heading is continuous across sunset and sunrise
{
  const lat = 40.7, lon = -74; const noon = new Date('2026-09-10T16:00:00Z'); const ev = sunEvents(noon, lat, lon, 0);
  const set = ev.nextSet, rise = ev.nextRise;
  const before = followHeading(new Date(+set - 5000), lat, lon, 0, view), after = followHeading(new Date(+set + 5000), lat, lon, 0, view);
  check('continuous through sunset', Math.abs(((before - after + 540) % 360) - 180) < 0.5, `${before.toFixed(2)} -> ${after.toFixed(2)}`);
  const evN = sunEvents(new Date(+set + 3600e3), lat, lon, 0);
  const bR = followHeading(new Date(+evN.nextRise - 5000), lat, lon, 0, view), aR = followHeading(new Date(+evN.nextRise + 5000), lat, lon, 0, view);
  check('continuous through sunrise', Math.abs(((bR - aR + 540) % 360) - 180) < 0.5, `${bR.toFixed(2)} -> ${aR.toFixed(2)}`);
}
// polar: no sunset in midsummer at 78N -> centred on the sun, no crash
{
  const h = followHeading(new Date('2026-06-21T12:00:00Z'), 78, 15, 0, view);
  check('polar day does not crash', Number.isFinite(h), h.toFixed(1));
  const s = sunHorizon(new Date('2026-06-21T12:00:00Z'), new Astronomy.Observer(78, 15, 0));
  check('polar day keeps the sun centred', Math.abs(screenXOf(s.azimuth, s.altitude, h) - 0.5) < 0.02);
}
// countdown
{
  const lat = 40.7, lon = -74, noon = new Date('2026-06-21T12:00:00Z'), ev = sunEvents(noon, lat, lon, 0);
  const set = +ev.nextSet;
  const c = (dt, mode = 'both', lead = 20) => countdownState(sunEvents(new Date(set + dt), lat, lon, 0), set + dt, mode, lead);
  check('no countdown 25 minutes before', c(-25 * 60000) === null);
  const c19 = c(-19 * 60000);
  check('countdown starts inside 20 minutes', c19 && c19.kind === 'sunset' && Math.abs(c19.msLeft - 19 * 60000) < 1000, JSON.stringify(c19));
  check('lead time is honoured (10 min: nothing at 15)', c(-15 * 60000, 'both', 10) === null);
  check('"sunrise only" ignores the sunset', c(-5 * 60000, 'sunrise') === null);
  const now = c(30000);
  check('shows "now" for the first minute after', now && now.msLeft < 0 && now.kind === 'sunset');
  check('gone 2 minutes after', c(120000) === null);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
