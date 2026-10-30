// The clock as glass.
//
// The SVG digits keep doing the layout and the morphing; this module rasterises
// them into a small coverage mask (only the clock's bounding box) and hands it
// to the sky engine, whose final pass turns it into liquid or stained glass that
// refracts the real sky behind it. The SVG itself is hidden (visibility, so it
// still lays out) while a glass style is active.

import { conf } from '../config.js';

const VB_W = 100, VB_H = 116, VB_Y0 = -8;      // viewBox of each digit svg: "0 -8 100 116"
const STROKE = 80 * 0.2;                        // stroke-width 80 under transform scale(0.2), in viewBox units
const DEG = Math.PI / 180;

export function initGlass(engine, getBasis) {
  const clock = document.getElementById('clock');
  const mask = document.createElement('canvas');
  const ctx = mask.getContext('2d');
  let layout = null;                             // { svgs:[{el, ox, oy, k}], rect, stroke, scale }
  let raf = 0;

  const style = () => (engine && conf.clockStyle) || 'solid';
  const active = () => style() === 'glass' || style() === 'stained';

  function measure() {
    const W = window.innerWidth, H = window.innerHeight;
    const svgs = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, strokePx = 0;
    for (const el of clock.querySelectorAll('svg')) {
      if (getComputedStyle(el).display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const k = Math.min(r.width / VB_W, r.height / VB_H);          // preserveAspectRatio meet
      const ox = r.left + (r.width - VB_W * k) / 2, oy = r.top + (r.height - VB_H * k) / 2;
      svgs.push({ el, ox, oy: oy - VB_Y0 * k, k, paths: [...el.querySelectorAll('path')].map(p => ({ el: p, round: p.getAttribute('stroke-linecap') === 'round' })) });
      strokePx = Math.max(strokePx, STROKE * k);
      x0 = Math.min(x0, ox); y0 = Math.min(y0, oy); x1 = Math.max(x1, ox + VB_W * k); y1 = Math.max(y1, oy + VB_H * k);
    }
    if (!svgs.length) { layout = null; return; }
    const pad = strokePx * 1.6 + 8;                                  // room for the shadow and blur
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W, x1 + pad); y1 = Math.min(H, y1 + pad);
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    mask.width = Math.max(2, Math.round((x1 - x0) * scale));
    mask.height = Math.max(2, Math.round((y1 - y0) * scale));
    layout = { svgs, x0, y0, scale, strokePx, rect: [x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H] };
  }

  function draw() {
    raf = 0;
    if (!active()) return;
    if (!layout) measure();
    if (!layout) return;
    const { svgs, x0, y0, scale } = layout;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, mask.width, mask.height);
    ctx.strokeStyle = '#fff';
    ctx.lineJoin = 'miter'; ctx.miterLimit = 4;                      // SVG defaults
    for (const s of svgs) {
      for (const p of s.paths) {
        const d = p.el.getAttribute('d');
        if (!d) continue;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.translate(s.ox - x0, s.oy - y0);
        ctx.scale(s.k * 0.2, s.k * 0.2);
        ctx.lineWidth = 80;
        ctx.lineCap = p.round ? 'round' : 'butt';
        ctx.stroke(new Path2D(d));
      }
    }
    engine.setGlassMask(mask, layout.rect, layout.strokePx);
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };

  // ---- light: where the sun (or moon) is on screen decides where the glass glints ----
  function updateLight() {
    if (!active() || !engine.sky) return;
    const sky = engine.sky, b = getBasis();
    const pick = (body) => {
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
      const p = pick(body);
      const l = Math.hypot(p.x, p.y);
      if (l > 1e-3) { lx = p.x / l; ly = p.y / l; }
      else { lx = -0.4; ly = 0.9; }                                  // light is straight ahead / behind
    }
    const n = Math.hypot(lx, ly) || 1;
    engine.setGlass({ light: [lx / n, ly / n, strength], lightCol: col });
  }
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  function apply() {
    const st = style();
    document.body.dataset.clockstyle = engine && (st === 'glass' || st === 'stained') ? st : 'solid';
    engine.setGlass({ mode: st === 'glass' ? 1 : st === 'stained' ? 2 : 0, frost: Math.min(1, Math.max(0, +conf.glassFrost)) });
    if (active()) { layout = null; schedule(); updateLight(); }
  }

  window.addEventListener('clockchange', schedule);
  window.addEventListener('clocklayout', () => { layout = null; schedule(); });
  window.addEventListener('resize', () => { layout = null; schedule(); });
  setInterval(updateLight, 1000);
  engine.onFrame(() => { if (active() && !engine._lightInit) { engine._lightInit = true; updateLight(); } });
  apply();
  return { apply, updateLight };
}
