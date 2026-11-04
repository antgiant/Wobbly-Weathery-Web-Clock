// A small QR code encoder for share links: byte mode, versions 1 to 10, error correction L or M, the mask chosen by the standard's
// penalty score. Pure functions, no DOM (render() returns rows of booleans). A short link fits version 3; a readable one version 5 to 8.
// Checked by decoding its output with an independent decoder (tests/unit/qr.test.mjs holds golden codes made that way).

// [error-correction codewords per block, blocks in group 1, data codewords each, blocks in group 2, data codewords each], per version 1..10
const TABLE = {
  L: [[7, 1, 19], [10, 1, 34], [15, 1, 55], [20, 1, 80], [26, 1, 108], [18, 2, 68], [20, 2, 78], [24, 2, 97], [30, 2, 116], [18, 2, 68, 2, 69]],
  M: [[10, 1, 16], [16, 1, 28], [26, 1, 44], [18, 2, 32], [24, 2, 43], [16, 4, 27], [18, 4, 31], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]],
};
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const FORMAT_BITS = { L: 1, M: 0 };

// ---- Reed-Solomon over GF(256) (x^8 + x^4 + x^3 + x^2 + 1) ----
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function generator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) { const next = new Array(g.length + 1).fill(0); g.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]); }); g = next; }
  return g;
}
function remainder(data, n) {
  const g = generator(n), r = new Array(n).fill(0);
  for (const d of data) { const f = d ^ r.shift(); r.push(0); if (f) g.slice(1).forEach((c, j) => { r[j] ^= mul(c, f); }); }
  return r;
}

const capacity = (level, v) => { const [, b1, d1, b2 = 0, d2 = 0] = TABLE[level][v - 1]; return b1 * d1 + b2 * d2; };
/** The smallest version (1 to 10) that holds `bytes` bytes at this level, or 0 when none does. */
export function fits(nbytes, level = 'M') {
  for (let v = 1; v <= 10; v++) if (capacity(level, v) * 8 >= 4 + (v < 10 ? 8 : 16) + nbytes * 8) return v;
  return 0;
}

function codewords(bytes, level, v) {
  const bits = [], put = (x, n) => { for (let i = n - 1; i >= 0; i--) bits.push((x >> i) & 1); };
  put(0b0100, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
  const total = capacity(level, v) * 8;
  put(0, Math.min(4, total - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < total; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  const [ec, b1, d1, b2 = 0, d2 = 0] = TABLE[level][v - 1], blocks = [];
  let at = 0;
  for (let i = 0; i < b1 + b2; i++) { const n = i < b1 ? d1 : d2, d = data.slice(at, at + n); at += n; blocks.push({ d, e: remainder(d, ec) }); }
  const out = [], longest = Math.max(d1, d2);
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

// ---- the grid ----
function blank(v) {
  const n = 17 + 4 * v, cell = Array.from({ length: n }, () => new Array(n).fill(false)), fixed = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (r, c, dark) => { if (r >= 0 && c >= 0 && r < n && c < n) { cell[r][c] = dark; fixed[r][c] = true; } };
  const finder = (r0, c0) => { for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) { const edge = r === 0 || r === 6 || c === 0 || c === 6, core = r >= 2 && r <= 4 && c >= 2 && c <= 4; set(r0 + r, c0 + c, r >= 0 && r <= 6 && c >= 0 && c <= 6 && (edge || core)); } };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const pos = ALIGN[v - 1];
  for (const r of pos) for (const c of pos) { if ((r === 6 && c === 6) || (r === 6 && c === pos[pos.length - 1]) || (c === 6 && r === pos[pos.length - 1])) continue; for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1); }
  for (let i = 0; i < 9; i++) { fixed[8][i] = true; fixed[i][8] = true; }         // format areas (filled later)
  for (let i = 0; i < 8; i++) { fixed[8][n - 1 - i] = true; fixed[n - 1 - i][8] = true; }
  set(n - 8, 8, true);                                                             // the always-dark module
  if (v >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { fixed[i][n - 11 + j] = true; fixed[n - 11 + j][i] = true; }
  return { n, cell, fixed };
}
const bch = (value, poly, bitsLen) => { let x = value << bitsLen; const top = poly.toString(2).length; for (let i = x.toString(2).length - top; i >= 0; i--) if ((x >> (i + top - 1)) & 1) x ^= poly << i; return x; };
const MASKS = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0, (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];

function place(g, v, words, level, mask) {
  const { n, fixed } = g, cell = g.cell.map((row) => row.slice()), bits = [];
  for (const w of words) for (let i = 7; i >= 0; i--) bits.push((w >> i) & 1);
  if (v >= 2 && v <= 6) for (let i = 0; i < 7; i++) bits.push(0);
  let k = 0, up = true;
  for (let c = n - 1; c > 0; c -= 2) {
    if (c === 6) c = 5;
    for (let i = 0; i < n; i++) for (let dc = 0; dc < 2; dc++) {
      const r = up ? n - 1 - i : i, x = c - dc;
      if (fixed[r][x]) continue;
      const dark = k < bits.length ? bits[k++] === 1 : false;
      cell[r][x] = dark !== MASKS[mask](r, x);
    }
    up = !up;
  }
  const data = (FORMAT_BITS[level] << 3) | mask, fmt = ((data << 10) | bch(data, 0x537, 10)) ^ 0x5412;
  const bit = (i) => ((fmt >> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) cell[i][8] = bit(i);                                // the copy round the top-left finder
  cell[7][8] = bit(6); cell[8][8] = bit(7); cell[8][7] = bit(8);
  for (let i = 9; i < 15; i++) cell[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) cell[8][n - 1 - i] = bit(i);                         // the copy split between the other two finders
  for (let i = 8; i < 15; i++) cell[n - 15 + i][8] = bit(i);
  cell[n - 8][8] = true;
  if (v >= 7) {
    const info = (v << 12) | bch(v, 0x1f25, 12);
    for (let i = 0; i < 18; i++) { const b = ((info >> i) & 1) === 1, a = Math.floor(i / 3), c = n - 11 + (i % 3); cell[a][c] = b; cell[c][a] = b; }
  }
  return cell;
}

function penalty(m) {
  const n = m.length; let p = 0;
  const runs = (line) => { let s = 0, run = 1; for (let i = 1; i <= n; i++) { if (i < n && line[i] === line[i - 1]) run++; else { if (run >= 5) s += run - 2; run = 1; } } return s; };
  for (let i = 0; i < n; i++) { p += runs(m[i]); p += runs(m.map((row) => row[i])); }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) p += 3;
  const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], rev = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const has = (line, i, q) => q.every((b, j) => (line[i + j] ? 1 : 0) === b);
  for (let i = 0; i < n; i++) { const col = m.map((row) => row[i]); for (let j = 0; j + 11 <= n; j++) { if (has(m[i], j, pat) || has(m[i], j, rev)) p += 40; if (has(col, j, pat) || has(col, j, rev)) p += 40; } }
  const dark = m.flat().filter(Boolean).length, pct = (dark * 100) / (n * n);
  return p + Math.floor(Math.abs(pct - 50) / 5) * 10;
}

/** @returns {boolean[][]|null} rows of modules (true = dark), without the quiet zone; null when the text is too long (more than ~210 bytes). */
export function render(text, level = 'M') {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  const v = fits(bytes.length, level);
  if (!v) return null;
  const g = blank(v), words = codewords(bytes, level, v);
  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) { const m = place(g, v, words, level, mask), s = penalty(m); if (s < bestScore) { bestScore = s; best = m; } }
  return best;
}

/** An SVG string for the code (with the 4-module quiet zone), for the page and for tests. */
export function toSvg(text, level = 'M', px = 4) {
  const m = render(text, level); if (!m) return '';
  const n = m.length + 8, d = [];
  m.forEach((row, r) => { let c = 0; while (c < row.length) { if (row[c]) { let e = c; while (e < row.length && row[e]) e++; d.push(`M${c + 4} ${r + 4}h${e - c}v1h-${e - c}z`); c = e; } else c++; } });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * px}" height="${n * px}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d.join('')}" fill="#000"/></svg>`;
}
