// The LED panel's own overlay: the sunrise / sunset countdown card and the umbrella, drawn as whole LEDs.

import { engine } from './core.js';
import { ledPanel } from './ledpanel.js';

// On the LED panel the countdown cannot be a page overlay, so it is drawn as LEDs: a card the size of the LED grid
// (one canvas pixel = one LED), painted with a 5x7 pixel font so every glyph lands on whole LEDs. The card sits
// along the top edge and the clock is laid out in what is left (--led-top, read by styles.css), so it never
// covers the time. Landscape (64x32): sun icon left, time right. Upright (32x64): icon above, time below.
const ledCard = window.__ledCard = document.createElement('canvas');
let ledCardKey = '';

const FONT = {   // 5 wide x 7 tall, one string per row ('#' lit)
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ':': ['.', '#', '.', '.', '.', '#', '.'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
};
// Two sizes. The countdown must always be clearly smaller than the clock's own digits. The ink of a digit is about
// 70% of its box (measured on the panel), and the countdown may be at most 65% of that, so the big font (7 rows)
// needs a digit box of 7 / (0.7 * 0.65) = 15.4 rows or more; otherwise the small one (5 rows) is used.
const FONT3 = {
  '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#.', '##.', '.#.', '.#.', '###'], '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'], '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'], '7': ['###', '..#', '.#.', '.#.', '.#.'], '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'], ':': ['.', '#', '.', '#', '.'],
  N: ['#.#', '###', '###', '#.#', '#.#'], O: ['###', '#.#', '#.#', '#.#', '###'], W: ['#.#', '#.#', '###', '###', '#.#'],
};
const SIZES = {
  big: { font: FONT, h: 7, iw: 9,
    arrow: { up: ['....#....', '...###...', '..#####..'], down: ['..#####..', '...###...', '....#....'] },
    sun: ['...###...', '..#####..', '.#######.'], horizon: '#########' },
  small: { font: FONT3, h: 5, iw: 7,
    arrow: { up: ['...#...', '..###..'], down: ['..###..', '...#...'] },
    sun: ['..###..', '.#####.'], horizon: '#######' },
};

const textWidth = (font, t) => [...t].reduce((w, ch) => w + font[ch][0].length + 1, -1);

/** Rows tall the clock's digit boxes end up, given a card of cardH rows (same maths as the LED rules in styles.css). */
function clockDigitRows(stack, cols, rows, cardH) {
  const cs = document.getElementById('clock').style;
  const units = parseFloat(cs.getPropertyValue('--units')) || 7, nr = parseFloat(cs.getPropertyValue('--rows')) || 3;
  const free = rows * (1 - (cardH + 2) / rows);
  return stack
    ? 1.16 * Math.min(0.93 * cols / 2, free * 0.95 / (nr * 1.16))
    : 1.16 * Math.min(0.93 * cols / units, free * 0.9 / 1.16);
}
const cardHeight = (sz, stacked) => 1 + (stacked ? sz.h + 1 + sz.h : sz.h) + 1 + 1 + 1;

const RAIN_ICON = {   // 9 x 7: an umbrella; the heavy-rain one has drops under the canopy
  umbrella: ['...###...', '.#######.', '#########', '....#....', '....#....', '....#....', '...##....'],
  slicker: ['...###...', '.#######.', '#########', '.#..#..#.', '....#....', '#..#..#..', '...##....'],
};

const clearPixel = () => {
  if (!ledCardKey) return;
  ledCardKey = '';
  engine.setOverlay(null);
  if (document.body.style.getPropertyValue('--led-top')) {
    document.body.style.removeProperty('--led-top');
    window.dispatchEvent(new Event('clocklayout'));
  }
};
const clearFit = () => { if (fitKey) { fitKey = ''; engine.setOverlayFull(null); } };

const timeText = (st) => {
  const total = Math.ceil(Math.max(0, st.msLeft) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * Draws the countdown card and the umbrella for the panel on screen. `off` removes them. On a panel the tuned layout
 * covers they are pixel art on whole LEDs; on any other they are the normal pills, made of LEDs like everything else.
 */
export function drawLedCard(st, leadMs, off = false, rain = null) {
  const panel = ledPanel();
  if (rain && rain.level === 'none') rain = null;
  if (!panel || off || (!st && !rain)) { clearPixel(); clearFit(); return; }
  if (panel.mode === 'fit') { clearPixel(); drawFit(st, rain); return; }
  clearFit();
  const { cols, rows } = panel, stack = panel.mode === 'stack';

  // countdown card: which size, side by side or stacked, the text, how much of the bar is left
  let P = null, text = '', rise = false, filled = 0;
  if (st) {
    text = st.msLeft <= 0 ? 'NOW' : timeText(st);
    rise = st.kind === 'sunrise';
    const plan = (sz) => {
      const tw = textWidth(sz.font, text);
      const stacked = cols <= 32 || 2 + sz.iw + 2 + tw + 2 > cols;            // a 32-wide panel (the classic upright one), or icon and time do not fit across: icon above the time
      return { sz, tw, stacked, cardH: cardHeight(sz, stacked), cardW: Math.min(cols, 2 + (stacked ? Math.max(tw, sz.iw) : sz.iw + 2 + tw) + 2) };
    };
    P = plan(SIZES.big);
    const bigOk = clockDigitRows(stack, cols, rows, P.cardH) >= SIZES.big.h / (0.7 * 0.65) && P.cardH + 2 <= rows * 0.6;
    if (!bigOk) P = plan(SIZES.small);
    if (P.cardH + 2 > rows * 0.6 || P.tw + 2 > cols) P = null;                  // no room that would leave the clock readable
    if (P) filled = Math.round(Math.max(0, Math.min(1, st.msLeft / leadMs)) * (P.cardW - 2));
  }
  const key = `${P ? `${st.kind}|${text}|${filled}|${P.sz.h}` : '-'}|${rain ? rain.level : '-'}|${cols}x${rows}`;
  if (key === ledCardKey) return;
  ledCardKey = key;

  ledCard.width = cols; ledCard.height = rows;
  const c = ledCard.getContext('2d');
  c.clearRect(0, 0, cols, rows);
  const px = (x, y, col) => { c.fillStyle = col; c.fillRect(x, y, 1, 1); };
  const blit = (lines, x, y, col) => lines.forEach((line, j) => [...line].forEach((v, i) => { if (v !== '.') px(x + i, y + j, col); }));

  if (P) {
    const { sz, tw, stacked, cardH, cardW } = P, { font, h: fh, iw } = sz;
    const x0 = Math.floor((cols - cardW) / 2), y0 = 1, innerW = cardW - 2;
    c.fillStyle = '#000'; c.fillRect(x0, y0, cardW, cardH);
    const sun = rise ? '#ffd24a' : '#ff7a2e';
    const iconX = stacked ? x0 + 1 + Math.floor((innerW - iw) / 2) : x0 + 2, iconY = y0 + 1;
    const arrow = rise ? sz.arrow.up : sz.arrow.down;
    blit(arrow, iconX, iconY, '#fff');                                           // which way the sun is going
    blit(sz.sun, iconX, iconY + arrow.length, sun);                              // the sun ...
    blit([sz.horizon], iconX, iconY + arrow.length + sz.sun.length, '#cfd6ff');  // ... on the horizon
    const tx = stacked ? x0 + 1 + Math.floor((innerW - tw) / 2) : x0 + 2 + iw + 2, ty = stacked ? iconY + fh + 1 : iconY;
    let pen = tx;
    for (const chr of text) { blit(font[chr], pen, ty, '#fff'); pen += font[chr][0].length + 1; }
    // time left as a row of LEDs that burns down
    for (let i = 0; i < filled; i++) px(x0 + 1 + i, y0 + cardH - 2, sun);
  }
  if (rain) {                                                                    // the umbrella, bottom left
    c.fillStyle = '#000'; c.fillRect(0, rows - 9, 11, 9);
    blit(RAIN_ICON[rain.level], 1, rows - 8, rain.level === 'slicker' ? '#ffd24a' : '#7fd4ff');
  }
  engine.setOverlay(ledCard);
  // the clock gets whatever is below the countdown card
  const top = P ? String((P.cardH + 2) / rows) : '';
  if (document.body.style.getPropertyValue('--led-top') !== top) {
    if (top) document.body.style.setProperty('--led-top', top); else document.body.style.removeProperty('--led-top');
    window.dispatchEvent(new Event('clocklayout'));
  }
}

// ---- panels the tuned layout does not cover: the normal pills, drawn full size and turned into LEDs with the picture ----
const fitCard = window.__fitCard = document.createElement('canvas');
let fitKey = '';

function pill(c, cx, top, parts, s) {
  const pad = 14 * s, gap = 8 * s;
  const widths = parts.map((p) => { c.font = p.font(s); return c.measureText(p.t).width; });
  const w = widths.reduce((a, b) => a + b, 0) + gap * (parts.length - 1) + 2 * pad, h = Math.max(...parts.map((p) => p.size * s)) * 1.7;
  const x = cx - w / 2;
  c.fillStyle = 'rgba(10,16,32,0.55)'; c.strokeStyle = 'rgba(255,255,255,0.32)'; c.lineWidth = Math.max(1, s);
  c.beginPath(); c.roundRect(x, top, w, h, h / 2); c.fill(); c.stroke();
  let px = x + pad;
  c.textBaseline = 'middle';
  parts.forEach((p, i) => { c.font = p.font(s); c.fillStyle = p.color; c.fillText(p.t, px, top + h / 2 + 1 * s); px += widths[i] + gap; });
  return top + h + 8 * s;
}

function drawFit(st, rain) {
  const W = Math.round(engine.canvas.width / 2), H = Math.round(engine.canvas.height / 2);
  const key = `${st ? `${st.kind}|${timeText(st)}|${st.msLeft <= 0}` : '-'}|${rain ? rain.text : '-'}|${W}x${H}`;
  if (key === fitKey) return;
  fitKey = key;
  fitCard.width = W; fitCard.height = H;
  const c = fitCard.getContext('2d'), s = W / 390;
  c.clearRect(0, 0, W, H);
  let y = Math.max(H * 0.07, 14 * s);
  const f = (size, weight = 600) => (k) => `${weight} ${size * k}px system-ui, sans-serif`;
  if (st) {
    const rise = st.kind === 'sunrise', col = rise ? '#ffd27a' : '#ff9a5c', name = rise ? 'Sunrise' : 'Sunset';
    const parts = st.msLeft <= 0
      ? [{ t: rise ? '☀↑' : '☀↓', color: col, font: f(20), size: 20 }, { t: name, color: '#fff', font: f(20), size: 20 }]
      : [{ t: rise ? '☀↑' : '☀↓', color: col, font: f(20), size: 20 }, { t: `${name} in`, color: 'rgba(255,255,255,0.88)', font: f(20), size: 20 }, { t: timeText(st), color: '#fff', font: f(28), size: 28 }];
    y = pill(c, W / 2, y, parts, s);
  }
  if (rain) {
    const col = rain.level === 'slicker' ? '#ffd24a' : '#7fd4ff';
    pill(c, W / 2, y, [{ t: '☂', color: col, font: f(18), size: 18 }, { t: rain.text || (rain.level === 'slicker' ? 'Slicker weather' : 'Umbrella'), color: '#fff', font: f(15), size: 15 }], s);
  }
  engine.setOverlayFull(fitCard);
}
