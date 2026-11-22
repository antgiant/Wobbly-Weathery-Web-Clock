// The pills on the Raspberry Pi program (native/host/js/pills.js): where they go and how big they are, with a stand-in 2D canvas (the real one is native).
// Run: node tests/unit/pills.test.mjs
import { check, done } from '../lib/check.mjs';

const mkCtx = () => {
  const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '', globalAlpha: 1, textAlign: 'left', _font: '', texts: [] };
  Object.defineProperty(ctx, 'font', { get() { return ctx._font; }, set(v) { ctx._font = v; } });
  ctx.measureText = (t) => ({ width: (+/(\d+(?:\.\d+)?)px/.exec(ctx._font)[1]) * 0.55 * String(t).length });
  ctx.fillText = (t) => { ctx.texts.push(t); };
  for (const m of ['beginPath', 'moveTo', 'lineTo', 'arc', 'closePath', 'fill', 'stroke', 'roundRect', 'clearRect', 'save', 'restore', 'translate', 'scale']) ctx[m] = (...a) => { if (m === 'stroke' || m === 'fill') ctx.paths.push([m, a[0] && a[0].d]); };
  ctx.paths = [];
  return ctx;
};
let canvasCount = 0;
globalThis.document = { createElement: () => { canvasCount++; const c = { width: 300, height: 150, _id: 1, _ensure() {} }; const x = mkCtx(); c.getContext = () => x; c.ctx = x; return c; } };
globalThis.Path2D = class { constructor(d) { this.d = d; } };
globalThis.__c2d_read = (id, x, y, w, h) => new ArrayBuffer(w * h * 4);

const P = await import('../../native/host/js/pills.js');
const none = () => { for (const k of ['sun', 'rain', 'timer', 'severe']) P.setPill(k, null); };

none();
check('no pill shows: nothing is painted', P.paintPills(1280, 720) === null && !P.pillsVisible());
check('setting a pill reports a change, the same again does not, hiding does', P.setPill('rain', { level: 'umbrella', text: 'Umbrella: rain now' }) && !P.setPill('rain', { level: 'umbrella', text: 'Umbrella: rain now' }) && P.setPill('rain', null) && !P.pillsVisible());
check('an unknown pill is ignored', P.setPill('nonsense', { a: 1 }) === false);

// one rain pill on a landscape screen: inside the picture, centred, near the bottom
P.setPill('rain', { level: 'umbrella', text: 'Umbrella: rain now' });
let r = P.paintPills(1280, 720);
check('a pill is painted inside the picture', r && r.x >= 0 && r.y >= 0 && r.x + r.w <= 1280 && r.y + r.h <= 720, JSON.stringify(r && [r.x, r.y, r.w, r.h]));
check('on a landscape screen it sits low and about in the middle', r.y + r.h > 720 * 0.8 && Math.abs(r.x + r.w / 2 - 640) < 120, `${r.x + r.w / 2}`);
check('its picture has w x h x 4 bytes', r.rgba.byteLength === r.w * r.h * 4);
check('the same state is not painted twice (the cached picture comes back)', P.paintPills(1280, 720) === r);

// the sun countdown: with the time left it is wider than without; the digits keep their widths (a pill that does not shake every second)
none(); P.setPill('sun', { kind: 'sunset', body: 'sun', name: 'Sunset', left: '09:12' });
const a = P.paintPills(1280, 720); P.setPill('sun', { kind: 'sunset', body: 'sun', name: 'Sunset', left: '10:00' }); const b = P.paintPills(1280, 720);
P.setPill('sun', { kind: 'sunset', body: 'sun', name: 'Sunset', left: null }); const c = P.paintPills(1280, 720);
check('the countdown pill keeps its size as the seconds change', a.w === b.w && a.h === b.h, `${a.w} vs ${b.w}`);
check('the pill is smaller once the time has come (no time left to show)', c.w < a.w, `${c.w} < ${a.w}`);
check('the moon pill (a moonrise or moonset) is painted too', (P.setPill('sun', { kind: 'sunrise', body: 'moon', name: 'Moonrise', left: '03:00' }), P.paintPills(1280, 720) !== null));

// all three: landscape puts them in a row (wrapping when the row is full), upright stacks them
none();
P.setPill('sun', { kind: 'sunset', body: 'sun', name: 'Sunset', left: '09:12' }); P.setPill('rain', { level: 'slicker', text: 'Slicker weather: rain now' }); P.setPill('timer', 'New Year’s Eve party at the lake house · days:hours');
const land = P.paintPills(1280, 720), up = P.paintPills(720, 1280);
check('upright, three pills take more height than landscape (a column, not a row)', up.h > land.h, `${up.h} vs ${land.h}`);
check('upright stays inside the screen', up.x >= 0 && up.x + up.w <= 720 && up.y >= 0 && up.y + up.h <= 1280, JSON.stringify([up.x, up.y, up.w, up.h]));
check('landscape stays between the corner buttons (not under the settings button on the right)', land.x + land.w <= 1280 - (0.05 * 1280 + 64 + 12), `${land.x + land.w}`);

// a long name wraps instead of running off the screen
none(); P.setPill('timer', 'x'.repeat(10) + ' ' + 'word '.repeat(60));
const long = P.paintPills(640, 480); P.setPill('timer', 'short');
const short = P.paintPills(640, 480);
check('a long timer name wraps onto lines inside the screen', long.w <= 640 && long.h > short.h * 2 && long.x >= 0, `${long.w}x${long.h} vs ${short.w}x${short.h}`);

// a bigger screen scales the pills (a 4K screen would use a device pixel ratio of 2)
none(); P.setPill('rain', { level: 'umbrella', text: 'Umbrella: rain now' });
const small = P.paintPills(1920, 1080), big = P.paintPills(3840, 2160);
check('on a 4K screen the pills are about twice as big as on 1080p', big.w > small.w * 1.7 && big.w < small.w * 2.3, `${big.w} vs ${small.w}`);
check('painting reuses one canvas', canvasCount === 1, `${canvasCount} canvases`);
// ---- the severe weather notice: first, in its level's colour, wraps, and comes and goes like the others ----
{
  none();
  check('a severe notice is a pill like the others (shown, hidden, reported)', P.setPill('severe', { level: 'warning', type: 'tornado', text: 'Tornado Warning until 4:15 PM (+1 more)' }) && P.pillsVisible() && !P.setPill('severe', { level: 'warning', type: 'tornado', text: 'Tornado Warning until 4:15 PM (+1 more)' }) && P.setPill('severe', null) && !P.pillsVisible());
  P.setPill('severe', { level: 'warning', type: 'tornado', text: 'Tornado Warning until 4:15 PM' });
  const one = P.paintPills(1280, 720); P.setPill('rain', { level: 'umbrella', text: 'Umbrella: rain now' }); const two = P.paintPills(1280, 720);
  check('it is painted inside the picture, low and about in the middle', one && one.x >= 0 && one.x + one.w <= 1280 && one.y + one.h > 720 * 0.8 && Math.abs(one.x + one.w / 2 - 640) < 120);
  check('with another pill the picture is bigger (both show; the page hides the umbrella itself)', two.w > one.w || two.h > one.h);
  none(); P.setPill('severe', { level: 'watch', type: 'flood', text: 'Flash Flood Watch for the whole of a very large county and the ones next to it until tomorrow evening at 8:00 PM' });
  const wide = P.paintPills(1280, 720), tall = P.paintPills(720, 1280);
  check('a long headline wraps instead of running off the screen, on a landscape and an upright screen', wide && wide.w <= 1280 && tall && tall.w <= 720 && tall.h > 30);
  check('a watch and a warning differ in colour (the notice is cached per state, so they are painted apart)', (() => { none(); P.setPill('severe', { level: 'watch', text: 'Flood Watch' }); const w = P.paintPills(1280, 720); P.setPill('severe', { level: 'warning', text: 'Flood Watch' }); return P.paintPills(1280, 720) !== w; })());
  none();
}


// ---- each hazard has its own drawing, the page's (SEV_ICON, sent as `icon`), filled for a warning and an outline otherwise ----
{
  const { SEV_ICON } = await import('../../js/sky/severe.js');
  check('every kind of hazard has a drawing of its own in the shared table', ['tornado', 'thunderstorm', 'flood', 'hurricane', 'winter', 'wind', 'heat', 'cold', 'fire', 'dust', 'smoke', 'fog', 'tsunami', 'marine', 'avalanche', 'earthquake', 'other'].every((t) => typeof SEV_ICON[t] === 'string' && SEV_ICON[t].length > 10) && new Set(Object.values(SEV_ICON)).size === Object.keys(SEV_ICON).length);
  const run = (level, icon) => { none(); P.setPill('severe', { level, type: 't', icon, text: 'Tornado Warning' }); document.createElement('canvas'); return P.paintPills(1280, 720); };
  const a = run('warning', SEV_ICON.tornado), b = run('warning', SEV_ICON.flood), c = run('warning', undefined);
  check('a different hazard drawing is a different picture (the cache is keyed on the whole state); no drawing still paints the warning sign', a !== b && c && c.w === a.w);
  none();
}
done();
