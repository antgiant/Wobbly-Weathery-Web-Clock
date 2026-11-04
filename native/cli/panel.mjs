// LED panel layout: read and write rpi-fb-matrix's matrix.cfg (libconfig), work out the grid from plain answers (panel size, how many
// across and down, where the cable goes in, how the panels are wired), check it, and draw it. Pure functions, tested in
// tests/unit/native-panel.test.mjs. The names are the file's own: display_width, panel_width, chain_length, parallel_count, panels, crop_origin.

const GPIO_SLOWDOWN_NOTE = 'faster Pis (3 and later) usually need led-slowdown-gpio 1 to 4';

// ---- reading and writing matrix.cfg ----
export function parseMatrixCfg(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '').replace(/#.*$/, '')).join('\n');
  const num = (name) => { const m = new RegExp(`(^|[\\s;])${name}\\s*=\\s*(-?\\d+)\\s*;`).exec(src); return m ? Number(m[2]) : undefined; };
  const cfg = {
    displayWidth: num('display_width'), displayHeight: num('display_height'), panelWidth: num('panel_width'), panelHeight: num('panel_height'),
    chainLength: num('chain_length'), parallelCount: num('parallel_count') ?? 1, panels: [], cropOrigin: null,
  };
  const pm = /panels\s*=\s*\(([\s\S]*?)\)\s*(?=crop_origin|$)/.exec(src.replace(/;\s*$/m, ''));
  if (pm) {
    const body = pm[1];
    // rows are the top-level ( ... ) groups; each holds { order = n; rotate = n; parallel = n; } entries
    const rows = []; let depth = 0, cur = '';
    for (const ch of body) { if (ch === '(') { depth++; if (depth === 1) { cur = ''; continue; } } if (ch === ')') { depth--; if (depth === 0) { rows.push(cur); continue; } } if (depth >= 1) cur += ch; }
    cfg.panels = rows.map((r) => [...r.matchAll(/\{([^}]*)\}/g)].map((m) => {
      const f = (k) => { const x = new RegExp(`${k}\\s*=\\s*(-?\\d+)`).exec(m[1]); return x ? Number(x[1]) : undefined; };
      return { order: f('order') ?? 0, rotate: f('rotate') ?? 0, parallel: f('parallel') ?? 0 };
    }));
  }
  const c = /crop_origin\s*=\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/.exec(src);
  if (c) cfg.cropOrigin = [Number(c[1]), Number(c[2])];
  return cfg;
}

export function writeMatrixCfg(cfg, note = '// Written by wobbly-clock. Same format as rpi-fb-matrix\'s matrix.cfg.') {
  const pad = (n, w) => String(n).padStart(w);
  const rows = cfg.panels.map((row) => `  ( ${row.map((p) => `{ order = ${p.order}; rotate = ${pad(p.rotate, 3)};${p.parallel ? ` parallel = ${p.parallel};` : ''} }`).join(', ')} )`);
  return `${note}\ndisplay_width = ${cfg.displayWidth};\ndisplay_height = ${cfg.displayHeight};\npanel_width = ${cfg.panelWidth};\npanel_height = ${cfg.panelHeight};\n` +
    `chain_length = ${cfg.chainLength};\nparallel_count = ${cfg.parallelCount};\npanels = (\n${rows.join(',\n')}\n)\n${cfg.cropOrigin ? `crop_origin = (${cfg.cropOrigin[0]}, ${cfg.cropOrigin[1]})\n` : '//crop_origin = (0, 0)\n'}`;
}

// ---- from answers ----
export const PANEL_SIZES = [[32, 16], [32, 32], [64, 32], [64, 64]];
export const WIRINGS = {
  row: 'one row, left to right or right to left',
  column: 'one column, top to bottom or bottom to top',
  'snake-across': 'snake across then down (each row runs the opposite way to the one above)',
  'snake-down': 'snake down then across (each column runs the opposite way to the one beside it)',
  'rows-same-side': 'every row starts at the same side (a cable runs back each time)',
  'columns-same-side': 'every column starts at the same end (a cable runs back each time)',
};
export const CORNERS = { 'top-left': 'tl', 'top-right': 'tr', 'bottom-left': 'bl', 'bottom-right': 'br' };

/** answers: { panelWidth, panelHeight, across, down, entry: 'top-right'..., wiring: key of WIRINGS, parallel } -> a full config */
export function fromAnswers(a) {
  const { panelWidth, panelHeight, across, down } = a, wiring = a.wiring || 'row', entry = CORNERS[a.entry] || 'tl';
  const top = entry[0] === 't', left = entry[1] === 'l';
  const grid = Array.from({ length: down }, () => Array(across).fill(null));
  let order = 0;
  const horizontal = !/column|snake-down/.test(wiring);
  const lines = horizontal ? down : across, steps = horizontal ? across : down;
  for (let l = 0; l < lines; l++) {
    const reversed = /snake/.test(wiring) && l % 2 === 1;
    for (let s = 0; s < steps; s++) {
      const along = reversed ? steps - 1 - s : s;               // 0 = nearest the entry side
      const across_ = l;                                         // 0 = nearest the entry edge
      const col = horizontal ? (left ? along : across - 1 - along) : (left ? across_ : across - 1 - across_);
      const row = horizontal ? (top ? across_ : down - 1 - across_) : (top ? along : down - 1 - along);
      // rotation: panels run the way the cable first goes: 0 (rows) or 90 (columns); a reversed run is turned half a turn
      grid[row][col] = { order: order++, rotate: ((horizontal ? 0 : 90) + (reversed ? 180 : 0)) % 360, parallel: 0 };
    }
  }
  const parallel = Math.max(1, a.parallel || 1);
  // parallel chains split the grid by rows (chain 0 the top rows ...)
  if (parallel > 1) {
    const per = Math.ceil(down / parallel);
    for (let r = 0; r < down; r++) for (let c = 0; c < across; c++) grid[r][c].parallel = Math.min(parallel - 1, Math.floor(r / per));
    for (let p = 0; p < parallel; p++) { let o = 0; for (const [r, c] of cells(grid, down, across, wiring, entry)) if (grid[r][c].parallel === p) grid[r][c].order = o++; }
  }
  return {
    displayWidth: panelWidth * across, displayHeight: panelHeight * down, panelWidth, panelHeight,
    chainLength: parallel > 1 ? Math.max(...Array.from({ length: parallel }, (_, p) => grid.flat().filter((x) => x.parallel === p).length)) : across * down,
    parallelCount: parallel, panels: grid, cropOrigin: null,
  };
}
// cells in chain order for the wiring (only used to renumber parallel chains)
function cells(grid, down, across) {
  const all = []; for (let r = 0; r < down; r++) for (let c = 0; c < across; c++) all.push([r, c]);
  return all.sort((x, y) => grid[x[0]][x[1]].order - grid[y[0]][y[1]].order || x[0] - y[0] || x[1] - y[1]);
}

// ---- checking ----
/** Problems in words, each with a likely fix. p = the hardware profile (optional); gpioMapping = 'regular' | 'adafruit-hat' | 'adafruit-hat-pwm' */
export function validate(cfg, p, gpioMapping = 'regular') {
  const out = [], bad = (msg, fix) => out.push(fix ? `${msg} ${fix}` : msg);
  if (![8, 16, 32, 64].includes(cfg.panelHeight)) bad(`panel_height is ${cfg.panelHeight}, but panels are 8, 16, 32 or 64 high.`, 'Check the label on the back of the panel.');
  if (!(cfg.panelWidth > 0) || cfg.displayWidth % cfg.panelWidth) bad(`display_width (${cfg.displayWidth}) is not a multiple of panel_width (${cfg.panelWidth}).`, `Try ${Math.round(cfg.displayWidth / cfg.panelWidth) * cfg.panelWidth}.`);
  if (!(cfg.panelHeight > 0) || cfg.displayHeight % cfg.panelHeight) bad(`display_height (${cfg.displayHeight}) is not a multiple of panel_height (${cfg.panelHeight}).`, `Try ${Math.round(cfg.displayHeight / cfg.panelHeight) * cfg.panelHeight}.`);
  const down = cfg.displayHeight / cfg.panelHeight, across = cfg.displayWidth / cfg.panelWidth;
  if (cfg.panels.length !== down || cfg.panels.some((r) => r.length !== across)) bad(`the panels grid is ${cfg.panels[0]?.length ?? 0} across by ${cfg.panels.length} down, but the display needs ${across} by ${down}.`, 'Run wobbly-clock setup again, or fix the grid by hand.');
  if (cfg.parallelCount > 1 && /hat/.test(gpioMapping)) bad(`the Adafruit HAT drives one chain, but parallel_count is ${cfg.parallelCount}.`, 'Use one chain, or the "regular" wiring on a Pi 2 or later.');
  if (cfg.parallelCount > 3) bad(`parallel_count is ${cfg.parallelCount}; the library supports up to 3.`);
  if (p && cfg.parallelCount > 1 && p.arch === 'armv6l') bad(`${p.name} only has the pins for one chain, but parallel_count is ${cfg.parallelCount}.`, 'Use one longer chain.');
  const chains = new Map();
  for (const row of cfg.panels) for (const t of row) { const k = t.parallel || 0; (chains.get(k) || chains.set(k, []).get(k)).push(t.order); }
  for (const [k, orders] of chains) {
    const sorted = [...orders].sort((a, b) => a - b);
    if (sorted.some((o, i) => o !== i)) bad(`chain ${k} does not number its panels 0, 1, 2 ... in a row (${sorted.join(', ')}).`, 'Each panel needs its own position along the chain.');
  }
  const longest = Math.max(0, ...[...chains.values()].map((o) => o.length));
  if (cfg.chainLength !== longest && cfg.panels.length) bad(`chain_length is ${cfg.chainLength}, but the longest chain has ${longest} panels.`, `Use ${longest}.`);
  if (cfg.panels.flat().some((t) => ![0, 90, 180, 270].includes(t.rotate))) bad('a panel has a rotation that is not 0, 90, 180 or 270.');
  return out;
}

export function totals(cfg) {
  const n = cfg.panels.flat().length;
  return `${cfg.displayWidth} x ${cfg.displayHeight} pixels, ${n} panel${n === 1 ? '' : 's'} of ${cfg.panelWidth} x ${cfg.panelHeight}, ` +
    (cfg.parallelCount > 1 ? `${cfg.parallelCount} parallel chains of up to ${cfg.chainLength}` : `one chain of ${cfg.chainLength}`);
}

/** The layout as text: each panel's order and rotation, arrows for the direction along the chain, "from the Pi" on the first. */
export function draw(cfg) {
  const lines = [], rows = cfg.panels, W = 12;
  const at = (r, c) => rows[r]?.[c];
  const adjacent = (a, b) => a && b && (a.parallel || 0) === (b.parallel || 0) && Math.abs(a.order - b.order) === 1;
  for (let r = 0; r < rows.length; r++) {
    const top = [], mid1 = [], mid2 = [], bot = [];
    for (let c = 0; c < rows[r].length; c++) {
      const t = rows[r][c], right = at(r, c + 1);
      top.push(' ' + '_'.repeat(W) + ' ');
      mid1.push('|' + `order ${t.order}`.padEnd(W - (t.order === 0 ? 0 : 0)).slice(0, W) + '|');
      mid2.push('|' + `rot ${t.rotate}`.padEnd(W).slice(0, W) + '|');
      bot.push('|' + '_'.repeat(W) + '|');
      const gap = adjacent(t, right) ? (right.order > t.order ? '=>' : '<=') : '  ';
      for (const arr of [top, mid1, mid2, bot]) arr.push(arr === mid1 ? gap : '  ');
    }
    lines.push(top.join(''), mid1.join(''), mid2.join(''), bot.join(''));
    if (r < rows.length - 1) {
      const gaps = rows[r].map((t, c) => { const below = at(r + 1, c); return adjacent(t, below) ? (below.order > t.order ? 'v' : '^') : ' '; });
      lines.push(gaps.map((g) => ' '.repeat(Math.floor(W / 2)) + g + ' '.repeat(W + 4 - Math.floor(W / 2) - 1)).join('').trimEnd());
    }
  }
  const start = rows.flat().findIndex((t) => t.order === 0 && !(t.parallel || 0));
  if (start >= 0) lines.push('', `The chain starts at the panel marked "order 0" (the cable from the Pi goes in there).`);
  return lines.join('\n');
}
export const notes = { GPIO_SLOWDOWN_NOTE };
