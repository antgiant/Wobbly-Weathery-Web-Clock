// Lightning timing and the flash envelope (js/sky/lightning.js). Run: node tests/unit/lightning.test.mjs
import { check, done } from '../lib/check.mjs';
const { Lightning, envelope, nextGap, MIN_GAP, FLASH_LENGTH } = await import('../../js/sky/lightning.js');

check('the envelope is 0 before a strike, 1 at its peak, and 0 after the flash', envelope(-0.1) === 0 && envelope(0.025) > 0.99 && envelope(FLASH_LENGTH + 0.01) === 0 && envelope(0.5) < 0.2);
check('a weaker second pulse comes after the first has died away', envelope(0.38 + 0.03) > 0.4 && envelope(0.38 + 0.03) < 0.6 && envelope(0.3) < 0.1);
let max = 0; for (let t = -0.1; t < 1.1; t += 0.001) max = Math.max(max, envelope(t)); check('never brighter than 1', max <= 1 && max > 0.99);
check('never more than two flashes in a second (a rising pulse above half brightness)', (() => { let n = 0, up = false; for (let t = 0; t < 1; t += 0.002) { const hi = envelope(t) > 0.4; if (hi && !up) n++; up = hi; } return n <= 2; })());
check('a gap is never under MIN_GAP, shorter in a fiercer storm', (() => { let a = 0, b = 0; for (let i = 0; i < 400; i++) { const r = i / 400; if (nextGap(0.3, r) < MIN_GAP || nextGap(1, r) < MIN_GAP) return false; a += nextGap(0.3, r); b += nextGap(1, r); } return b < a; })());

const l = new Lightning(5);
check('no rate, no flashes, ever', [0, 1, 50, 5000].every((t) => l.update(t, 0).flash === 0));
let strikes = 0, last = -1e9, minGap = 1e9, peak = 0, boltFrames = 0, flashes = 0, prev = 0;
const s = new Lightning(9);
for (let t = 0; t < 1800; t += 0.05) {
  const r = s.update(t, 0.8);
  if (s.last !== last) { strikes++; if (last > -1e8) minGap = Math.min(minGap, s.last - last); last = s.last; }
  peak = Math.max(peak, r.flash); if (r.bolt) boltFrames++;
  if (r.flash > 0.4 && prev <= 0.4) flashes++; prev = r.flash;
}
check('a storm of 0.8 strikes about every 5 to 15 s over half an hour', strikes > 100 && strikes < 340, String(strikes));
check('no two strikes closer than MIN_GAP', minGap >= MIN_GAP, String(minGap));
check('the flashes reach full brightness and the bolt shows during the first moments of each', peak > 0.9 && boltFrames > strikes && boltFrames < strikes * 6);
check('at most about two flashes a second at any time (a rising edge above 0.4)', flashes <= strikes * 2 + 2, `${flashes} flashes in ${strikes} strikes`);
const a = new Lightning(3), b = new Lightning(3); let same = true; for (let t = 0; t < 200; t += 0.1) if (JSON.stringify(a.update(t, 0.6)) !== JSON.stringify(b.update(t, 0.6))) same = false;
check('the same seed gives the same storm (tests)', same);
check('the bolt is somewhere on the screen', (() => { const q = new Lightning(2); for (let t = 0; t < 100; t += 0.02) { const r = q.update(t, 1); if (r.bolt) return r.bolt.x >= 0.1 && r.bolt.x <= 0.9 && r.bolt.bottom >= 0.3 && r.bolt.bottom <= 0.55 && r.bolt.a > 0 && r.bolt.a <= 1; } return false; })());
done();
