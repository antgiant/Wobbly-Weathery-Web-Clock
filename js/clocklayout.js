// Where the clock's digits go, as a pure function (no DOM).
//
// The page lays the digits out with CSS (styles.css: a flex row, or on an LED panel a flex row / grid) plus a few inline styles
// that clock.js and config.js set. A program with no browser (the native host) has no CSS engine, so this module does the same
// sums from the same inputs. The browser test tests/browser/clocklayout.test.mjs compares it with the real page for many sizes
// and settings, so the two cannot drift apart unnoticed: when the CSS changes, that test says so.
//
// Boxes are the digits' svg boxes in viewport pixels, as getBoundingClientRect() reports them.

const ASPECT = 1.16;                    // an svg's height over its width (viewBox "0 -8 100 116")
// Where a digit's ink sits in its svg box, as fractions of the box's width (measured on the page's own digits: a 0, 2 or 3 starts at about 0.21 and ends at about 0.70; a 1 starts later, so a row that
// starts with a 1 sits a little left of its nominal centre). centreMargin uses these to put the ink of the row, not its boxes, in the middle of the screen.
const INK_L = 0.23, INK_R = 0.695;

/** Evaluates a CSS length: 12px, 40%, or calc(...) with + - * / and parentheses; a percentage is of `pct`. */
export function evalLength(s, pct) {
  s = String(s == null ? '' : s).trim();
  if (!s) return 0;
  const t = s.replace(/^calc/, '').match(/\d*\.?\d+(?:e[-+]?\d+)?%|\d*\.?\d+(?:px)?|[-+*/()]/gi) || [];
  let i = 0;
  const peek = () => t[i];
  function atom() {
    const x = t[i++];
    if (x === '(') { const v = expr(); i++; return v; }
    if (x === '-') return -atom();
    if (x === '+') return atom();
    return x.endsWith('%') ? parseFloat(x) / 100 * pct : parseFloat(x);
  }
  function term() { let v = atom(); while (peek() === '*' || peek() === '/') { const o = t[i++], r = atom(); v = o === '*' ? v * r : v / r; } return v; }
  function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const o = t[i++], r = term(); v = o === '+' ? v + r : v - r; } return v; }
  return expr();
}

/**
 * @param {object} o
 *   vw, vh         the viewport (the canvas) in px
 *   pillRoom       px the pills at the bottom take (--pill-room)
 *   burn           [x, y] the anti burn-in step in px
 *   marginLeft     #clock's inline margin-left ('' or centreMargin()'s percentage)
 *   led            null, or { mode: 'row' | 'stack' | 'fit', aspect, top, units, rows } (body[data-led] and the custom properties)
 *   items          the svgs in document order: { colon, hidden, width, marginRight, margin... }
 *                  width: the inline width ('' when none); marginRight: the inline margin-right ('' when none);
 *                  hundreds: the countdown's hundreds digit (shown first)
 * @returns {{ box: number[], rects: (number[]|null)[] }}   [x, y, w, h]; null for a hidden item
 */
export function layoutClock(o) {
  const { vw, vh } = o, pillRoom = o.pillRoom || 0, burn = o.burn || [0, 0], led = o.led && o.led.mode !== 'fit' ? o.led : null;
  const n = o.items.length;
  let cx, cy, cw, ch;
  const rects = new Array(n).fill(null);

  if (!led) {
    cw = 0.93 * vw; ch = 0.98 * vh - pillRoom;
    cx = evalLength(o.marginLeft, vw); cy = 0;
  } else {
    const pw = Math.min(vw, led.aspect * vh), ph = pw / led.aspect, top = led.top || 0;
    cw = pw * 0.93; ch = ph * (1 - top) * 0.98;
    cx = (vw - cw) / 2; cy = (vh - ph) / 2 + ph * (top + 0.01);
  }
  const box = [cx + burn[0], cy + burn[1], cw, ch];

  if (!led) {
    // a flex row, centred, items centred across; widths and margins in percent of the row's width
    const flow = [];
    o.items.forEach((it, i) => {
      if (it.hidden) return;
      const k = i + 1;
      let ml = 0, mr = 0;
      if (it.hundreds) { ml = 0; mr = -0.07 * cw; }
      else if (k % 3 === 2) ml = -0.07 * cw;
      else if (k % 3 === 0) { ml = -0.02 * cw; mr = -0.15 * cw; }
      if (it.marginRight) mr = evalLength(it.marginRight, cw);
      const w = it.width ? evalLength(it.width, cw) : 0.1917 * cw;        // the stylesheet's own width needs the digit count: clock.js always sets one
      flow.push({ i, ml, mr, w, order: it.hundreds ? -1 : 0 });
    });
    flow.sort((a, b) => a.order - b.order || a.i - b.i);
    let total = 0; for (const f of flow) total += f.ml + f.w + f.mr;
    let x = cx + (cw - total) / 2;
    for (const f of flow) {
      x += f.ml; const h = f.w * ASPECT;
      rects[f.i] = [x + burn[0], cy + (ch - h) / 2 + burn[1], f.w, h];
      x += f.w + f.mr;
    }
  } else if (led.mode === 'row') {
    const pw = Math.min(vw, led.aspect * vh), ph = pw / led.aspect, top = led.top || 0;
    const w = Math.min(pw * 0.93 / (led.units || 7), ph * (1 - top) * 0.9 / ASPECT);
    const flow = [];
    o.items.forEach((it, i) => {
      if (it.hidden) return;
      const k = i + 1, colon = k === 3 || k === 6;
      flow.push({ i, colon, ml: colon ? 0 : -0.12 * w, mr: colon ? -0.7 * w : -0.12 * w, order: it.hundreds ? -1 : 0 });
    });
    flow.sort((a, b) => a.order - b.order || a.i - b.i);
    let total = 0; for (const f of flow) total += f.ml + w + f.mr;
    let x = cx + (cw - total) / 2;
    for (const f of flow) {
      x += f.ml; const h = w * ASPECT;
      rects[f.i] = [x + (f.colon ? 0.054 * w : 0) + burn[0], cy + (ch - h) / 2 + burn[1], w, h];
      x += w + f.mr;
    }
  } else {   // stack: a two-column grid, the digits two to a row, rows centred
    const pw = Math.min(vw, led.aspect * vh), ph = pw / led.aspect, top = led.top || 0;
    const colW = cw / 2, w = Math.min(colW, ph * (1 - top) * 0.95 / ((led.rows || 3) * ASPECT)), h = w * ASPECT;
    const cell = { 1: [0, 0], 2: [0, 1], 4: [1, 0], 5: [1, 1], 7: [2, 0], 8: [2, 1] };
    const usedRows = new Set();
    o.items.forEach((it, i) => { const c = cell[i + 1]; if (c && !it.hidden) usedRows.add(c[0]); });
    const rows = [...usedRows].sort((a, b) => a - b), gridH = rows.length * h, y0 = cy + (ch - gridH) / 2;
    o.items.forEach((it, i) => {
      const c = cell[i + 1]; if (!c || it.hidden) return;
      rects[i] = [cx + c[1] * colW + (colW - w) / 2 + burn[0], y0 + rows.indexOf(c[0]) * h + burn[1], w, h];
    });
  }
  return { box, rects };
}

/**
 * The margin-left (a percentage of the screen's width) that puts the row of digits in the middle of the screen. The row is a box 93% of the width wide laid out from the left edge, and its digits
 * overlap by negative margins and start and end with different padding, so it is not centred by itself; this works out how far to move it from where the digits really are (items: as for layoutClock).
 * It depends only on how many digits there are and which are hidden, not on the screen's size, so the page sets it once per layout (clock.js updateSvgWidths) and the program with no CSS reads it back.
 */
export function centreMargin(items) {
  const { rects } = layoutClock({ vw: 100, vh: 100, items, marginLeft: '' });
  let l = Infinity, r = -Infinity;
  items.forEach((it, i) => { const b = rects[i]; if (!b || it.colon) return; l = Math.min(l, b[0] + INK_L * b[2]); r = Math.max(r, b[0] + INK_R * b[2]); });
  return Number.isFinite(l) ? 50 - (l + r) / 2 : 0;
}
