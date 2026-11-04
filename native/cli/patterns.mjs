// Test patterns for `wobbly-clock test`: frames of RGB bytes (width x height x 3) for the colour bars, the "identify" pattern that numbers
// every panel, a brightness sweep and a border box. Pure functions, so they are tested without any panel or screen.
const FONT = { // 3 x 5 digits
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111',
};
export const frame = (w, h) => ({ w, h, data: new Uint8Array(w * h * 3) });
const px = (f, x, y, [r, g, b]) => { if (x >= 0 && y >= 0 && x < f.w && y < f.h) { const i = (y * f.w + x) * 3; f.data[i] = r; f.data[i + 1] = g; f.data[i + 2] = b; } };
const rect = (f, x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px(f, x, y, c); };
function digit(f, d, x0, y0, scale, c) {
  const g = FONT[d]; for (let i = 0; i < 15; i++) if (g[i] === '1') rect(f, x0 + (i % 3) * scale, y0 + Math.floor(i / 3) * scale, x0 + (i % 3 + 1) * scale, y0 + (Math.floor(i / 3) + 1) * scale, c);
}
function number(f, n, x0, y0, scale, c) { String(n).split('').forEach((ch, i) => digit(f, ch, x0 + i * 4 * scale, y0, scale, c)); }

export const BARS = [[255, 255, 255], [255, 255, 0], [0, 255, 255], [0, 255, 0], [255, 0, 255], [255, 0, 0], [0, 0, 255], [0, 0, 0]];

/** Colour bars on the top two thirds (wrong colour order shows at once), a grey ramp on the bottom third (gamma and banding). */
export function bars(w, h) {
  const f = frame(w, h);
  for (let x = 0; x < w; x++) {
    const c = BARS[Math.min(7, Math.floor((x * 8) / w))];
    for (let y = 0; y < Math.ceil(h * 2 / 3); y++) px(f, x, y, c);
    const v = Math.round((x / Math.max(1, w - 1)) * 255);
    for (let y = Math.ceil(h * 2 / 3); y < h; y++) px(f, x, y, [v, v, v]);
  }
  return f;
}

/** Every panel in its own colour with its chain position, a bright mark in its top-left corner (finds wrong rotation and chain order). */
export function identify(cfg) {
  const f = frame(cfg.displayWidth, cfg.displayHeight), hues = [[255, 64, 64], [64, 255, 64], [64, 64, 255], [255, 255, 64], [255, 64, 255], [64, 255, 255], [255, 160, 64], [160, 64, 255]];
  cfg.panels.forEach((row, r) => row.forEach((t, c) => {
    const x0 = c * cfg.panelWidth, y0 = r * cfg.panelHeight, col = hues[((t.parallel || 0) * 4 + t.order) % hues.length];
    rect(f, x0, y0, x0 + cfg.panelWidth, y0 + cfg.panelHeight, col.map((v) => v >> 2));
    rect(f, x0, y0, x0 + 3, y0 + 3, [255, 255, 255]);                                  // the top-left corner of the tile
    const scale = cfg.panelHeight >= 32 ? 3 : 1;
    number(f, t.order, x0 + 5, y0 + 2, scale, col);
  }));
  return f;
}

/** White at a level (0..1): for the brightness sweep. */
export function level(w, h, v) { const f = frame(w, h), n = Math.round(v * 255); rect(f, 0, 0, w, h, [n, n, n]); return f; }

/** A one-pixel white box on the very edge (is every edge row and column lit?). */
export function border(w, h) {
  const f = frame(w, h), c = [255, 255, 255];
  rect(f, 0, 0, w, 1, c); rect(f, 0, h - 1, w, h, c); rect(f, 0, 0, 1, h, c); rect(f, w - 1, 0, w, h, c);
  return f;
}

/** The whole test: what to show, for how long, and what each should look like. */
export function sequence(cfg) {
  const w = cfg.displayWidth, h = cfg.displayHeight;
  return [
    { name: 'colour bars and grey ramp', seconds: 4, frame: () => bars(w, h), expect: 'White, yellow, cyan, green, magenta, red, blue, black left to right, then a smooth grey ramp. Other colours: the colour order (led-rgb-sequence) is wrong.' },
    { name: 'identify the panels', seconds: 6, frame: () => identify(cfg), expect: 'Each panel shows its chain position in its own colour, upright, with a white square in its top-left corner. Upside down or sideways: fix rotate. Numbers out of order: fix the wiring answer.' },
    { name: 'brightness sweep', seconds: 5, frame: (t) => level(w, h, Math.min(1, t / 5)), expect: 'Black rising smoothly to white. Steps or flicker: led-pwm-bits, or the power supply is too small.' },
    { name: 'border box', seconds: 3, frame: () => border(w, h), expect: 'A one-pixel white line round the whole display. A missing side: the size is wrong.' },
  ];
}
