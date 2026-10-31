// Wind sway maths: which way the digits lean, how far, and that the bottom stays put. Run: node tests/unit/wind.test.mjs
import { check, done } from '../lib/check.mjs';
const W = await import('../../js/wind.js');
const { swayFor, windVector, strength, flutter, weight, bend, sway, topOffset, MAX_LEAN, MAX_GUST, GALE, Y_TOP, Y_BOT } = W;

check('calm: no lean, no gusts', swayFor(0, 90, 0).lean === 0 && swayFor(0, 90, 0).gust === 0);
check('strength grows with the wind and stops at a gale', strength(2) < strength(8) && strength(8) < strength(18) && strength(18) === 1 && strength(40) === 1);
check('a light breeze (3 m/s) already leans a visible amount (a third of the full lean)', swayFor(3, 90, 0).lean > MAX_LEAN * 0.3);
// looking north: wind towards the east pushes the tops right, towards the west pushes them left
check('looking north, a wind blowing east leans the digits to the right', swayFor(10, 90, 0).lean > 0);
check('looking north, a wind blowing west leans them to the left', swayFor(10, 270, 0).lean < 0);
check('the same wind seen looking south leans the other way', Math.sign(swayFor(10, 90, 180).lean) === -Math.sign(swayFor(10, 90, 0).lean));
check('wind straight towards or away from the viewer gives no sideways lean', Math.abs(swayFor(10, 0, 0).lean) < 1e-9 && Math.abs(swayFor(10, 180, 0).lean) < 1e-9);
check('...but it still gusts', swayFor(10, 0, 0).gust > 0);
check('turning to face the wind: heading 90 and wind to the east is head-on', Math.abs(swayFor(10, 90, 90).lean) < 1e-9);
check('across the wind the lean is the full lean for that speed', Math.abs(Math.abs(swayFor(GALE, 90, 0).lean) - MAX_LEAN) < 1e-9);
check('lean and gusts together never exceed the cap that keeps the time readable', [0, 2, 5, 10, 18, 30, 60].every((v) => [0, 45, 90, 135, 180, 270].every((h) => { const s = swayFor(v, 90, h); return Math.abs(s.lean) + s.gust <= MAX_LEAN + MAX_GUST + 1e-9; })));
const deg = (x) => Math.atan(x / (Y_BOT - Y_TOP)) * 180 / Math.PI;
check('the steady lean is at most about 12 degrees of slope over a digit, and with a full gust under 15 (about like italics, readable)', deg(MAX_LEAN) < 12.5 && deg(MAX_LEAN + MAX_GUST) < 15, `${deg(MAX_LEAN).toFixed(1)} / ${deg(MAX_LEAN + MAX_GUST).toFixed(1)}`);

const v = windVector(0.01, 0);
check('windVector: blowing east is bearing 90, north is 0, west 270, south 180', Math.abs(v.toAz - 90) < 1e-9 && windVector(0, 1).toAz === 0 && Math.abs(windVector(-1, 0).toAz - 270) < 1e-9 && Math.abs(windVector(0, -1).toAz - 180) < 1e-9);

check('weight: the bottom of a digit does not move, the top takes the whole push', weight(Y_BOT) === 0 && weight(Y_BOT + 80) === 0 && weight(Y_TOP) === 1 && weight(Y_TOP - 80) === 1);
check('weight rises smoothly from bottom to top', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].every((i) => weight(Y_BOT - i * 42) <= weight(Y_BOT - (i + 1) * 42)));
const pts = [100, 450, 200, 300, 300, 200, 250, 30];
const b = bend(pts, 50);
check('bend: a point on the baseline stays where it is', b[0] === 100 && b[1] === 450);
check('bend: higher points move further, the top by the full amount', b[2] - 200 > 0 && b[4] - 300 > b[2] - 200 && Math.abs(b[6] - 250 - 50) < 0.11);
check('bend: heights never change', b[1] === 450 && b[3] === 300 && b[5] === 200 && b[7] === 30);
check('bend by nothing returns the digit as it was', bend(pts, 0) === pts);

let worst = 0; for (let t = 0; t < 600000; t += 137) for (const ph of [0.4, 2.1, 3.7, 5.2]) worst = Math.max(worst, Math.abs(flutter(t, ph)));
check('the gust factor stays within -1 .. 1', worst <= 1 + 1e-9, worst.toFixed(3));
check('digits flutter out of step (different phases differ)', Math.abs(flutter(5000, 0.4) - flutter(5000, 3.7)) > 0.05);
sway.mode = 'full'; sway.lean = 40; sway.gust = 15; sway.flutter = false;
check('lean only: the offset is the lean, steady', topOffset(1234, 1) === 40 && topOffset(98765, 4) === 40);
sway.flutter = true;
check('with gusts the offset moves around the lean by at most the gust size', [0, 700, 1500, 3100, 9999].every((t) => Math.abs(topOffset(t, 2) - 40) <= 15 + 1e-9) && topOffset(0, 2) !== topOffset(700, 2));
done();
