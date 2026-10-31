// The LED panel's size and how the page is laid out for it. Pure functions (no DOM): testable in node.
//
// The visitor picks how many LEDs wide and tall the panel is. The classic 64 x 32 panel (and its upright twin, 32 x 64)
// has a hand-tuned layout: the digits are packed to fit the panel, stacked two to a row when it is tall, and the
// countdown is drawn in a pixel font. Other sizes use that same tuned layout where it works (a panel of at least 32 x 24
// LEDs, not more than 4 times longer than it is high). Anything outside that is shown exactly as the normal page, just
// turned into LEDs ("fit").

export const LED_PRESETS = [
  { id: '64x32', cols: 64, rows: 32, label: '64 × 32 (classic panel)' },
  { id: '32x64', cols: 32, rows: 64, label: '32 × 64 (classic, upright)' },
  { id: '96x48', cols: 96, rows: 48, label: '96 × 48' },
  { id: '128x64', cols: 128, rows: 64, label: '128 × 64' },
  { id: '64x64', cols: 64, rows: 64, label: '64 × 64 (square)' },
  { id: '128x32', cols: 128, rows: 32, label: '128 × 32 (long strip)' },
  { id: '32x32', cols: 32, rows: 32, label: '32 × 32' },
  { id: '32x16', cols: 32, rows: 16, label: '32 × 16 (small)' },
  { id: '16x16', cols: 16, rows: 16, label: '16 × 16 (tiny)' },
];
export const MIN_LEDS = 8, MAX_LEDS = 256, MIN_CELL_PX = 3;

const clampInt = (v, lo, hi, d) => { const n = v == null || v === '' ? NaN : Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/**
 * The grid actually drawn on a screen of cw x ch pixels: the chosen counts, turned on their side when `turn` is on and the
 * screen is the other way round, and shrunk (keeping its shape) if the LEDs would come out under 3 pixels.
 * @returns {{cols:number, rows:number, turned:boolean, shrunk:boolean}}
 */
export function gridFor(cols, rows, turn, cw, ch) {
  let c = clampInt(cols, MIN_LEDS, MAX_LEDS, 64), r = clampInt(rows, MIN_LEDS, MAX_LEDS, 32);
  let turned = false;
  if (turn && (c > r) !== (cw > ch) && c !== r) { [c, r] = [r, c]; turned = true; }
  let shrunk = false;
  const k = Math.min(cw / (MIN_CELL_PX * c), ch / (MIN_CELL_PX * r));
  if (k < 1) { c = Math.max(MIN_LEDS, Math.floor(c * k)); r = Math.max(MIN_LEDS, Math.floor(r * k)); shrunk = true; }
  return { cols: c, rows: r, turned, shrunk };
}

/** Whether the hand-tuned layout and pixel-font countdown work for this grid. */
export function isTuned(cols, rows) {
  const a = cols / rows;
  return cols >= 32 && rows >= 24 && a >= 0.25 && a <= 4;
}

/**
 * How the clock sits on a tuned panel: 'row' (all digits in one line) or 'stack' (hours, minutes, seconds one above the
 * other, two digits wide). Whichever gives the taller digits. A digit's box is 1.16 times as tall as wide.
 * @param {boolean} seconds  whether seconds are shown (3 stacked lines instead of 2; 5.16 digit widths in a row instead of 3.34)
 */
export function layoutFor(cols, rows, seconds = true) {
  const units = seconds ? 5.16 : 3.34, lines = seconds ? 3 : 2;
  const row = 1.16 * Math.min(0.93 * cols / units, 0.9 * rows / 1.16);
  const stack = 1.16 * Math.min(0.93 * cols / 2, 0.95 * rows / (lines * 1.16));
  return stack > row * 1.05 ? 'stack' : 'row';
}

/** Everything the page needs to know about the panel for this screen. mode: 'row' | 'stack' | 'fit'. */
export function panelFor(conf, cw, ch) {
  const g = gridFor(conf.ledCols, conf.ledRows, conf.ledTurn !== false, cw, ch);
  const tuned = isTuned(g.cols, g.rows);
  return { ...g, tuned, mode: tuned ? layoutFor(g.cols, g.rows, !conf.hideSeconds) : 'fit', aspect: g.cols / g.rows };
}

/** The preset id matching these counts (either way round), or 'custom'. */
export function presetIdFor(cols, rows) {
  const p = LED_PRESETS.find((x) => x.cols === cols && x.rows === rows) || LED_PRESETS.find((x) => x.cols === rows && x.rows === cols);
  return p ? p.id : 'custom';
}
