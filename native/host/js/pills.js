// The pills on the Raspberry Pi: the sunrise / sunset countdown, the umbrella (rain) alert and the countdown's name. In a browser they are HTML capsules at the bottom of the page;
// this program has no HTML layout, so they are painted here with the 2D canvas (text: native/host/src/main.rs, Inter Medium) and blended onto the picture after it is read back from
// the GPU (boot.js). What they say comes from the page itself: js/sky/alerts.js and js/clock.js call __pillSet(kind, value) beside the HTML they fill (a browser has no __pillSet).
// The look follows styles.css (#sunCountdown, #rainAlertPill, #timerPill): sizes in CSS pixels scaled up on screens wider than 1920 (a phone or a 4K screen would use the device pixel ratio).

const state = { sun: null, rain: null, timer: null, severe: null };
let canvas = null;

/** Sets what one pill says (null: hidden). Returns true when that changed anything. */
export function setPill(kind, value) {
  if (!(kind in state)) return false;
  const v = value === undefined ? null : value;
  if (JSON.stringify(state[kind]) === JSON.stringify(v)) return false;
  state[kind] = v;
  return true;
}
export const pillsVisible = () => !!(state.sun || state.rain || state.timer || state.severe);
export const pillState = () => state;

const clamp = (lo, x, hi) => Math.max(lo, Math.min(hi, x));
const BG = 'rgba(10,16,32,0.62)', BG_TIMER = 'rgba(15,18,32,0.7)', BORDER = 'rgba(255,255,255,0.32)';
const SUN_COL = { sunrise: '#ffd27a', sunset: '#ff9a5c' }, RAIN_COL = { umbrella: '#7fd4ff', slicker: '#ffd24a' }, SEV_COL = { watch: '#ffb300', warning: '#ff4a3d', advisory: '#7fd4ff' };

function font(ctx, px) { ctx.font = `600 ${px}px Inter`; }
const width = (ctx, px, text) => { font(ctx, px); return ctx.measureText(text).width; };

/** Breaks text into lines no wider than maxW (words are kept whole; a word longer than the line is cut). */
function wrap(ctx, px, text, maxW) {
  const lines = []; let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const t = line ? line + ' ' + word : word;
    if (width(ctx, px, t) <= maxW || !line) {
      if (width(ctx, px, t) > maxW) {                      // one word wider than the line: cut it
        let cut = '';
        for (const ch of t) { if (width(ctx, px, cut + ch) > maxW && cut) { lines.push(cut); cut = ''; } cut += ch; }
        line = cut;
      } else line = t;
    } else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function shadowText(ctx, t, x, y, color, alpha = 1) {
  ctx.globalAlpha = 0.6 * alpha; ctx.fillStyle = '#000'; ctx.fillText(t, x, y + 1);
  ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fillText(t, x, y);
  ctx.globalAlpha = 1;
}

function sunIcon(ctx, cx, cy, fs, color) {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.5, fs * 0.08);
  ctx.beginPath(); ctx.arc(cx, cy, fs * 0.24, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, r0 = fs * 0.36, r1 = fs * 0.5;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
  }
}
function moonIcon(ctx, cx, cy, fs, color) {                // a crescent: the long way round an outer circle, back along a smaller bulge
  const R = fs * 0.36, phi = 75 * Math.PI / 180, h = R * Math.sin(phi), r2 = fs * 0.38, tx = cx + R * Math.cos(phi);
  const icx = tx + Math.sqrt(r2 * r2 - h * h), a = Math.asin(h / r2);
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(tx, cy - h); ctx.arc(cx, cy, R, -phi, phi, true);
  ctx.arc(icx, cy, r2, Math.PI - a, Math.PI + a, false); ctx.closePath(); ctx.fill();
}
function umbrellaIcon(ctx, x, y, box, level, color) {       // the page's own drawing (alerts.js SVG_UMBRELLA / SVG_SLICKER), 24 units to the box
  const k = box / 24, top = level === 'slicker' ? 11 : 12;
  ctx.strokeStyle = color; ctx.lineWidth = 1.8 * k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x + 3 * k, y + top * k); ctx.arc(x + 12 * k, y + top * k, 9 * k, Math.PI, Math.PI * 2, false); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 12 * k, y + top * k); ctx.lineTo(x + 12 * k, y + (level === 'slicker' ? 15.5 : 18.5) * k);
  ctx.arc(x + 14 * k, y + (level === 'slicker' ? 15.5 : 18.5) * k, 2 * k, Math.PI, 0, true); ctx.stroke();
  if (level === 'slicker') for (const [a, b, c, d] of [[5, 15, -1, 2.5], [9, 17, -1, 2.5], [18, 17, -1, 2.5], [7, 21, -0.6, 1.5]]) { ctx.beginPath(); ctx.moveTo(x + a * k, y + b * k); ctx.lineTo(x + (a + c) * k, y + (b + d) * k); ctx.stroke(); }
}

/** A warning triangle with an exclamation mark: an outline for a watch or an advisory, solid for a warning (the page draws a picture for each kind of hazard; here one sign serves all). */
function severeIcon(ctx, x, y, box, level, color) {
  const k = box / 24;
  ctx.lineWidth = 1.8 * k; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = level === 'warning' ? '#fff' : color; ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x + 12 * k, y + 3 * k); ctx.lineTo(x + 22 * k, y + 21 * k); ctx.lineTo(x + 2 * k, y + 21 * k); ctx.closePath();
  if (level === 'warning') ctx.fill(); ctx.stroke();
  ctx.strokeStyle = level === 'warning' ? '#fff' : color;
  ctx.beginPath(); ctx.moveTo(x + 12 * k, y + 10 * k); ctx.lineTo(x + 12 * k, y + 15 * k); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 12 * k, y + 18 * k); ctx.lineTo(x + 12 * k, y + 18.1 * k); ctx.stroke();
}

/** The pills as pictures: [{ w, h, border, bg, paint(ctx, x, y) }] in the page's order (sun, rain, timer), laid out for a screen of W x H. */
function build(ctx, W, H) {
  const k = Math.max(1, W / 1920), vw = W / 100, land = W >= H, out = [];
  const avail = land ? W - (0.05 * W + 132 * k) - (0.05 * W + Math.max(0.05 * W, 44 * k) + 12 * k) : W - 32 * k;
  const maxW = Math.max(120, avail);
  const v = state.severe;
  if (v) {                                                   // a severe weather notice comes first, in the colour of its level (watch amber, warning red)
    const fs = clamp(14.4 * k, 3.2 * vw, 19.6 * k), box = 1.7 * fs, padL = 0.7 * fs, padR = fs, padY = 0.4 * fs, gap = 0.5 * fs, lh = fs * 1.2, col = SEV_COL[v.level] || SEV_COL.watch;
    const lines = wrap(ctx, fs, v.text, maxW - padL - padR - box - gap), tw = Math.max(...lines.map((l) => width(ctx, fs, l)));
    const w = padL + box + gap + tw + padR, h = Math.round(Math.max(box, lines.length * lh) + padY * 2);
    out.push({
      w, h, border: true, borderColor: col, borderWidth: 2, bg: v.level === 'warning' ? 'rgba(60,10,10,0.7)' : BG,
      paint(c, x, y) {
        severeIcon(c, x + padL, y + (h - box) / 2, box, v.level, col);
        font(c, fs); c.textAlign = 'left';
        lines.forEach((l, i) => shadowText(c, l, x + padL + box + gap + (tw - width(c, fs, l)) / 2, y + (h - lines.length * lh) / 2 + lh * i + fs * 0.98, '#fff'));
      },
    });
  }
  const s = state.sun;
  if (s) {
    const fs = clamp(16 * k, 3.8 * vw, 28.8 * k), tfs = fs * 1.4, padX = 1.3 * fs, padY = 0.55 * fs, gap = 0.6 * fs;
    const iconW = fs * 1.1, arrowW = width(ctx, fs, '↑'), what = s.left ? `${s.name} in` : s.name;
    const whatW = width(ctx, fs, what), cell = width(ctx, tfs, '0'), colon = width(ctx, tfs, ':');
    const timeW = s.left ? [...s.left].reduce((a, ch) => a + (ch === ':' ? colon : cell), 0) : 0;
    const w = padX * 2 + iconW + (s.left ? arrowW : 0) + gap + whatW + (s.left ? gap + timeW : 0), h = Math.round(tfs * 1.1 + padY * 2);
    out.push({
      w, h, border: true, bg: BG,
      paint(c, x, y) {
        const base = y + h / 2 + tfs * 0.32, col = SUN_COL[s.kind] || '#fff';
        const cx = x + padX + iconW / 2, cy = y + h / 2 - fs * 0.05;
        if (s.body === 'moon') moonIcon(c, cx, cy, fs, col); else sunIcon(c, cx, cy, fs * 0.9, col);
        let px = x + padX + iconW;
        if (s.left) { font(c, fs); c.textAlign = 'left'; shadowText(c, s.kind === 'sunrise' ? '↑' : '↓', px, base, col); px += arrowW; }
        px += gap; font(c, fs); c.textAlign = 'left'; shadowText(c, what, px, base, '#fff', 0.88); px += whatW;
        if (s.left) { px += gap; font(c, tfs); for (const ch of s.left) { const cw = ch === ':' ? colon : cell; c.textAlign = 'left'; shadowText(c, ch, px + (cw - width(c, tfs, ch)) / 2, base, '#fff'); px += cw; } }
      },
    });
  }
  const r = state.rain;
  if (r) {
    const fs = clamp(13.6 * k, 3 * vw, 18.4 * k), box = 1.6 * fs, padL = 0.7 * fs, padR = fs, padY = 0.4 * fs, gap = 0.5 * fs, lh = fs * 1.2;
    const lines = wrap(ctx, fs, r.text, maxW - padL - padR - box - gap), tw = Math.max(...lines.map((l) => width(ctx, fs, l)));
    const w = padL + box + gap + tw + padR, h = Math.round(Math.max(box, lines.length * lh) + padY * 2);
    out.push({
      w, h, border: true, bg: BG,
      paint(c, x, y) {
        umbrellaIcon(c, x + padL, y + (h - box) / 2, box, r.level, RAIN_COL[r.level] || '#7fd4ff');
        font(c, fs); c.textAlign = 'left';
        lines.forEach((l, i) => shadowText(c, l, x + padL + box + gap + (tw - width(c, fs, l)) / 2, y + (h - lines.length * lh) / 2 + lh * i + fs * 0.98, '#fff'));
      },
    });
  }
  const t = state.timer;
  if (t) {
    const fs = 15.2 * k, padX = 12 * k, padY = 6 * k, lh = fs * 1.2;
    const lines = wrap(ctx, fs, t, maxW - padX * 2), tw = Math.max(...lines.map((l) => width(ctx, fs, l)));
    const w = tw + padX * 2, h = Math.round(lines.length * lh + padY * 2);
    out.push({
      w, h, border: false, bg: BG_TIMER,
      paint(c, x, y) { font(c, fs); c.textAlign = 'left'; lines.forEach((l, i) => shadowText(c, l, x + padX + (tw - width(c, fs, l)) / 2, y + padY + lh * i + fs * 0.98, '#fff')); },
    });
  }
  return { out, land, k, maxW };
}

/**
 * Paints the pills for a screen of W x H. Returns { x, y, w, h, rgba } (straight alpha, top row first; x, y from the top left) or null when no pill shows.
 * Where they go (styles.css #alerts): upright, a column above the corner buttons; landscape, a row at the bottom between the buttons (wrapping onto more rows).
 */
let cache = null;
export function paintPills(W, H) {
  if (!pillsVisible()) return null;
  const key = W + 'x' + H + JSON.stringify(state);
  if (cache && cache.key === key) return cache.value;
  const value = paint(W, H); cache = { key, value };
  return value;
}
function paint(W, H) {
  canvas ||= document.createElement('canvas');
  const probe = canvas.getContext('2d');
  const { out, land, k, maxW } = build(probe, W, H);
  if (!out.length) return null;
  const rows = [], gap = 8 * k;
  if (land) { let row = [], rw = 0; for (const p of out) { if (row.length && rw + gap + p.w > maxW) { rows.push(row); row = []; rw = 0; } row.push(p); rw += (row.length > 1 ? gap : 0) + p.w; } if (row.length) rows.push(row); }
  else for (const p of out) rows.push([p]);
  const rowW = (r) => r.reduce((a, p) => a + p.w, 0) + gap * (r.length - 1), rowH = (r) => Math.max(...r.map((p) => p.h));
  const bw = Math.ceil(Math.max(...rows.map(rowW))) + 4, bh = Math.ceil(rows.reduce((a, r) => a + rowH(r), 0) + gap * (rows.length - 1)) + 4;
  const bottom = land ? H - Math.max(0.05 * H, 0) : H - Math.max(0.05 * H, 0) - 64 * k;
  const leftPad = land ? 0.05 * W + 132 * k : 16 * k, rightPad = land ? 0.05 * W + Math.max(0.05 * W, 44 * k) + 12 * k : 16 * k;
  const cxMid = leftPad + (W - leftPad - rightPad) / 2;
  const ox = Math.max(0, Math.round(cxMid - bw / 2)), oy = Math.max(0, Math.round(bottom - bh));
  canvas.width = bw; canvas.height = bh;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, bw, bh);
  let y = 2;
  for (const r of rows) {
    const h = rowH(r); let x = 2 + (bw - 4 - rowW(r)) / 2;
    for (const p of r) {
      const py = y + h - p.h;                                  // (align-items: flex-end)
      c.beginPath(); c.roundRect(x, py, p.w, p.h, p.h / 2); c.fillStyle = p.bg; c.fill();
      if (p.border) { const bwid = p.borderWidth || 1; c.beginPath(); c.roundRect(x + bwid / 2, py + bwid / 2, p.w - bwid, p.h - bwid, p.h / 2); c.strokeStyle = p.borderColor || BORDER; c.lineWidth = bwid; c.stroke(); }
      p.paint(c, x, py);
      x += p.w + gap;
    }
    y += h + gap;
  }
  canvas._ensure();
  return { x: ox, y: oy, w: bw, h: bh, rgba: __c2d_read(canvas._id, 0, 0, bw, bh) };
}
