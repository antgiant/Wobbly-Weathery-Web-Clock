// The LED panel's own overlay: the sunrise / sunset countdown card and the umbrella, drawn as whole LEDs.

import { engine } from './core.js';

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
function clockDigitRows(portrait, cols, rows, cardH) {
  const cs = document.getElementById('clock').style;
  const units = parseFloat(cs.getPropertyValue('--units')) || 7, nr = parseFloat(cs.getPropertyValue('--rows')) || 3;
  const free = rows * (1 - (cardH + 2) / rows);
  return portrait
    ? 1.16 * Math.min(0.93 * cols / 2, free * 0.95 / (nr * 1.16))
    : 1.16 * Math.min(0.93 * cols / units, free * 0.9 / 1.16);
}
const cardHeight = (sz, portrait) => 1 + (portrait ? sz.h + 1 + sz.h : sz.h) + 1 + 1 + 1;

const RAIN_ICON = {   // 9 x 7: an umbrella; the heavy-rain one has drops under the canopy
  umbrella: ['...###...', '.#######.', '#########', '....#....', '....#....', '....#....', '...##....'],
  slicker: ['...###...', '.#######.', '#########', '.#..#..#.', '....#....', '#..#..#..', '...##....'],
};

export function drawLedCard(st, leadMs, off = false, rain = null) {
  const clear = () => {
    if (!ledCardKey) return;
    ledCardKey = '';
    engine.setOverlay(null);
    if (document.body.style.getPropertyValue('--led-top')) {
      document.body.style.removeProperty('--led-top');
      window.dispatchEvent(new Event('clocklayout'));
    }
  };
  if (rain && rain.level === 'none') rain = null;
  const cw = engine.canvas.width, ch = engine.canvas.height;
  if (off || (!st && !rain) || !(cw > 0 && ch > 0)) { clear(); return; }
  const portrait = ch > cw;
  const cols = portrait ? 32 : 64, rows = portrait ? 64 : 32;

  // countdown card (see above): the size choice, the text, how much of the bar is left
  let sz = null, font = null, fh = 0, iw = 0, text = '', tw = 0, rise = false, cardH = 0, cardW = 0, x0 = 0, y0 = 1, innerW = 0, filled = 0;
  if (st) {
    sz = clockDigitRows(portrait, cols, rows, cardHeight(SIZES.big, portrait)) >= SIZES.big.h / (0.7 * 0.65) ? SIZES.big : SIZES.small;
    ({ font, h: fh, iw } = sz);
    const total = Math.ceil(Math.max(0, st.msLeft) / 1000);
    text = st.msLeft <= 0 ? 'NOW' : `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    tw = textWidth(font, text);
    rise = st.kind === 'sunrise';
    cardH = cardHeight(sz, portrait);
    cardW = Math.min(cols, 2 + (portrait ? Math.max(tw, iw) : iw + 2 + tw) + 2);
    x0 = Math.floor((cols - cardW) / 2);
    innerW = cardW - 2;
    filled = Math.round(Math.max(0, Math.min(1, st.msLeft / leadMs)) * innerW);
  }
  const key = `${st ? `${st.kind}|${text}|${filled}|${fh}` : '-'}|${rain ? rain.level : '-'}|${cols}x${rows}`;
  if (key === ledCardKey) return;
  ledCardKey = key;

  ledCard.width = cols; ledCard.height = rows;
  const c = ledCard.getContext('2d');
  c.clearRect(0, 0, cols, rows);
  const px = (x, y, col) => { c.fillStyle = col; c.fillRect(x, y, 1, 1); };
  const blit = (lines, x, y, col) => lines.forEach((line, j) => [...line].forEach((v, i) => { if (v !== '.') px(x + i, y + j, col); }));

  if (st) {
    c.fillStyle = '#000'; c.fillRect(x0, y0, cardW, cardH);
    const sun = rise ? '#ffd24a' : '#ff7a2e';
    const iconX = portrait ? x0 + 1 + Math.floor((innerW - iw) / 2) : x0 + 2, iconY = y0 + 1;
    const arrow = rise ? sz.arrow.up : sz.arrow.down;
    blit(arrow, iconX, iconY, '#fff');                                           // which way the sun is going
    blit(sz.sun, iconX, iconY + arrow.length, sun);                              // the sun ...
    blit([sz.horizon], iconX, iconY + arrow.length + sz.sun.length, '#cfd6ff');  // ... on the horizon
    const tx = portrait ? x0 + 1 + Math.floor((innerW - tw) / 2) : x0 + 2 + iw + 2, ty = portrait ? iconY + fh + 1 : iconY;
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
  const top = st ? String((cardH + 2) / rows) : '';
  if (document.body.style.getPropertyValue('--led-top') !== top) {
    if (top) document.body.style.setProperty('--led-top', top); else document.body.style.removeProperty('--led-top');
    window.dispatchEvent(new Event('clocklayout'));
  }
}

