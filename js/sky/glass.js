// The clock as glass.
//
// The SVG digits keep doing the layout and the morphing; this module rasterises
// them into a small coverage mask (only the clock's bounding box) and hands it
// to the sky engine, whose final pass turns it into liquid or stained glass that
// refracts the real sky behind it. The SVG itself is hidden (visibility, so it
// still lays out) while a glass style is active.
//
// Stained glass: each stroke is cut into pieces along its length and each piece
// into an inner and an outer lane. Every lane is filled with an id colour that
// the shader turns into a jewel tone, and lead lines appear where ids change.
// The pieces are slices of the live curves, so the leading stretches and bends
// with the digit as it morphs instead of sitting still on the screen.

import { conf } from '../config.js';

const VB_W = 100, VB_H = 116, VB_Y0 = -8;      // viewBox of each digit svg: "0 -8 100 116"
const STROKE = 80 * 0.2;                        // stroke-width 80 under transform scale(0.2), in viewBox units
const PIECES = 3;                               // panes along each stroke
const OVERLAP = 5;                              // path units of overlap so pieces leave no anti-aliasing seams

// ---- path -> polyline (handles the M / L / C commands the clock produces) ----
function flatten(d) {
  const t = d.match(/[MLC]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  const pts = [];
  let i = 0, cmd = '', cx = 0, cy = 0;
  const num = () => parseFloat(t[i++]);
  while (i < t.length) {
    if (/[MLC]/i.test(t[i])) cmd = t[i++].toUpperCase();
    if (cmd === 'M' || cmd === 'L') { cx = num(); cy = num(); pts.push([cx, cy]); if (cmd === 'M') cmd = 'L'; }
    else if (cmd === 'C') {
      const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
      for (let k = 1; k <= 14; k++) {
        const u = k / 14, v = 1 - u;
        pts.push([v * v * v * cx + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x,
                  v * v * v * cy + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y]);
      }
      cx = x; cy = y;
    } else break;
  }
  return pts;
}

/** Sub-polyline between arc lengths a..b. */
function slice(pts, cum, a, b) {
  const out = [];
  const at = (s) => {
    let j = 1;
    while (j < cum.length - 1 && cum[j] < s) j++;
    const seg = cum[j] - cum[j - 1] || 1, u = Math.min(1, Math.max(0, (s - cum[j - 1]) / seg));
    return [pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * u, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * u];
  };
  out.push(at(a));
  for (let j = 1; j < pts.length - 1; j++) if (cum[j] > a && cum[j] < b) out.push(pts[j]);
  out.push(at(b));
  return out;
}

const hash = (a, b, c, d) => {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647 + d * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
// id colour: red channel = palette index (x40 + 20), green = per-pane brightness
const idColor = (k, shade) => `rgb(${Math.floor(k * 6) * 40 + 20},${Math.round(shade * 255)},0)`;

export function initGlass(engine, getBasis) {
  const clock = document.getElementById('clock');
  const canvasEl = engine.canvas;
  const mask = document.createElement('canvas');
  const ctx = mask.getContext('2d');
  let raf = 0;

  const style = () => conf.clockStyle || 'solid';
  const active = () => style() === 'glass' || style() === 'stained';

  // Positions are measured against the canvas's own rectangle on every redraw, so scrolling,
  // zooming or a changing mobile toolbar can never leave the glass at a stale position.
  function measure() {
    const cr = canvasEl.getBoundingClientRect();
    const W = cr.width, H = cr.height;
    const svgs = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, strokePx = 0;
    clock.querySelectorAll('svg').forEach((el, idx) => {
      if (getComputedStyle(el).display === 'none') return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const k = Math.min(r.width / VB_W, r.height / VB_H);          // preserveAspectRatio meet
      const ox = r.left - cr.left + (r.width - VB_W * k) / 2, oy = r.top - cr.top + (r.height - VB_H * k) / 2;
      svgs.push({ idx, ox, oy: oy - VB_Y0 * k, k, paths: [...el.querySelectorAll('path')].map(p => ({ el: p, round: p.getAttribute('stroke-linecap') === 'round' })) });
      strokePx = Math.max(strokePx, STROKE * k);
      x0 = Math.min(x0, ox); y0 = Math.min(y0, oy); x1 = Math.max(x1, ox + VB_W * k); y1 = Math.max(y1, oy + VB_H * k);
    });
    if (!svgs.length || !W || !H) return null;
    const pad = strokePx * 1.6 + 8;                                  // room for the shadow and blur
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W, x1 + pad); y1 = Math.min(H, y1 + pad);
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    const mw = Math.max(2, Math.round((x1 - x0) * scale)), mh = Math.max(2, Math.round((y1 - y0) * scale));
    if (mask.width !== mw || mask.height !== mh) { mask.width = mw; mask.height = mh; }
    return { svgs, x0, y0, scale, strokePx, rect: [x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H] };
  }

  function draw() {
    raf = 0;
    if (!active()) return;
    const L = measure();
    if (!L) return;
    const { svgs, x0, y0, scale } = L;
    const stained = style() === 'stained';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, mask.width, mask.height);
    ctx.strokeStyle = '#fff';
    ctx.lineJoin = 'miter'; ctx.miterLimit = 4;                      // SVG defaults

    const strokePath = (pts, lineWidth, cap) => {
      ctx.lineWidth = lineWidth; ctx.lineCap = cap;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
      if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
      ctx.stroke();
    };

    for (const s of svgs) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.translate(s.ox - x0, s.oy - y0);
      ctx.scale(s.k * 0.2, s.k * 0.2);
      s.paths.forEach((p, pi) => {
        const d = p.el.getAttribute('d');
        if (!d) return;
        if (!stained) { ctx.lineWidth = 80; ctx.lineCap = p.round ? 'round' : 'butt'; ctx.stroke(new Path2D(d)); return; }

        const pts = flatten(d);
        if (pts.length < 2) return;
        const cum = [0];
        for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
        const len = cum[cum.length - 1];
        const n = p.round ? 1 : PIECES;                              // the colon dots stay a single pane
        // outer lanes first, then the inner lanes on top, so every pane is bordered by lead
        for (let lane = 0; lane < 2; lane++) {
          for (let j = 0; j < n; j++) {
            const a = Math.max(0, (j / n) * len - (j ? OVERLAP : 0)), b = Math.min(len, ((j + 1) / n) * len + (j < n - 1 ? OVERLAP : 0));
            const pc = slice(pts, cum, a, b);
            ctx.strokeStyle = idColor(hash(s.idx, pi, j, lane), hash(j, pi, s.idx, lane + 7));
            strokePath(pc, lane === 0 ? 80 : 44, p.round ? 'round' : 'butt');
          }
        }
      });
    }
    engine.setGlassMask(mask, L.rect, L.strokePx);
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };

  // ---- light: where the sun (or moon) is on screen decides where the glass glints ----
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function updateLight() {
    if (!active() || !engine.sky) return;
    const sky = engine.sky, b = getBasis();
    const proj = (body) => {
      const d = body.dir;
      return { x: d[0] * b.right[0] + d[1] * b.right[1] + d[2] * b.right[2], y: d[0] * b.up[0] + d[1] * b.up[1] + d[2] * b.up[2] };
    };
    const sunAlt = sky.sun.alt, moonAlt = sky.moon.alt;
    let body = null, strength = 0.18;                                // dim ambient light from the upper left by default
    let col = [1, 1, 1];
    if (sunAlt > -4) {
      body = sky.sun;
      strength = Math.min(1, 0.25 + 0.75 * smooth(-4, 8, sunAlt));
      const warm = 1 - smooth(0, 25, sunAlt);                        // low sun is orange
      col = [1, 1 - 0.40 * warm, 1 - 0.75 * warm];
    } else if (moonAlt > 0) {
      body = sky.moon;
      strength = 0.15 + 0.35 * sky.moon.fraction;
      col = [0.80, 0.88, 1.0];
    }
    let lx = -0.5, ly = 0.8;
    if (body) {
      const p = proj(body);
      const l = Math.hypot(p.x, p.y);
      if (l > 1e-3) { lx = p.x / l; ly = p.y / l; }
      else { lx = -0.4; ly = 0.9; }                                  // light is straight ahead / behind
    }
    const n = Math.hypot(lx, ly) || 1;
    engine.setGlass({ light: [lx / n, ly / n, strength], lightCol: col });
  }

  function apply() {
    const st = style();
    const on = st === 'glass' || st === 'stained';
    document.body.dataset.clockstyle = on ? st : 'solid';
    engine.setGlass({ mode: st === 'glass' ? 1 : st === 'stained' ? 2 : 0, frost: Math.min(1, Math.max(0, +conf.glassFrost)) });
    if (on) { schedule(); updateLight(); }
  }

  window.addEventListener('clockchange', schedule);
  window.addEventListener('clocklayout', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('orientationchange', schedule);
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', schedule);
    visualViewport.addEventListener('scroll', schedule);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  setInterval(() => { updateLight(); if (active()) schedule(); }, 1000);    // belt and braces: re-measure once a second
  engine.onFrame(() => { if (active() && !engine._lightInit) { engine._lightInit = true; updateLight(); } });
  apply();
  return { apply, updateLight };
}
