// Putting the row of digits in the middle of the screen (js/clocklayout.js centreMargin, used by clock.js and, through the same function, by the Raspberry Pi program).
// Before it the row sat 1 to 4% of the screen's width left of centre (a box 93% wide laid out from the left edge, a fixed 6% nudge for a hidden leading digit).
// Run: node tests/unit/clockcentre.test.mjs
import { check, done } from '../lib/check.mjs';
const { centreMargin, layoutClock } = await import('../../js/clocklayout.js');

// the svgs the page has, in document order: first hour digit, second, colon, minute tens, minute ones, colon, second tens, second ones
const items = (count, hiddenLead, seconds) => {
  const w = `calc(((100% + (7% * 3)) / ${count}) - ${hiddenLead ? '3%' : '1%'})`;
  return [0, 0, 1, 0, 0, 1, 0, 0].map((colon, i) => ({ colon: !!colon, hidden: (i === 0 && hiddenLead) || (!seconds && i >= 5), width: w, marginRight: '' }));
};
const cases = [['12:33, no seconds', 4, false, false], ['12:33, seconds', 6, false, true], ['2:33, no seconds', 3, true, false], ['2:33, seconds', 5, true, true]];
// the nominal ink centre of a row for a margin (the same sums centreMargin does, from the layout function itself)
const inkCentre = (its, margin) => {
  const { rects } = layoutClock({ vw: 100, vh: 100, items: its, marginLeft: margin + '%' });
  let l = Infinity, r = -Infinity;
  its.forEach((it, i) => { const b = rects[i]; if (!b || it.colon) return; l = Math.min(l, b[0] + 0.23 * b[2]); r = Math.max(r, b[0] + 0.695 * b[2]); });
  return (l + r) / 2;
};
for (const [label, c, h, s] of cases) {
  const its = items(c, h, s), m = centreMargin(its);
  check(`${label}: the margin it gives puts the row's ink exactly in the middle`, Math.abs(inkCentre(its, m) - 50) < 1e-6, `${m.toFixed(3)} -> ${inkCentre(its, m).toFixed(3)}`);
  check(`${label}: without it the row is clearly off centre (that was the fault)`, Math.abs(inkCentre(its, 0) - 50) > 1.5, `${inkCentre(its, 0).toFixed(2)}`);
}
check('a hidden leading digit asks for a larger margin than a shown one (the row is shorter, so it moves right)', centreMargin(items(3, true, false)) > centreMargin(items(4, false, false)) + 2);
check('the margin needs no screen size (it is a percentage of the width): the same for any window', (() => { const a = layoutClock({ vw: 100, vh: 100, items: items(4, false, false), marginLeft: '4%' }), b = layoutClock({ vw: 1920, vh: 1080, items: items(4, false, false), marginLeft: '4%' }); return a.rects.every((r, i) => !r || Math.abs(r[0] * 19.2 - b.rects[i][0]) < 1e-6); })());
check('a row with nothing to centre gives no margin', centreMargin([{ colon: true, hidden: false, width: '10%', marginRight: '' }]) === 0 && centreMargin([]) === 0);
done();
