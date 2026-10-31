// The clock as glass.
//
// The SVG digits keep doing the layout and the morphing; this module rasterises
// them into a small coverage mask (only the clock's bounding box) and hands it
// to the sky engine, whose final pass turns it into liquid or stained glass that
// refracts the real sky behind it. The SVG itself is hidden (visibility, so it
// still lays out) while a glass style is active.
//
// Coloured tube: a glass tube lit from inside by LEDs, like a tube light. The tube itself is plain glass with
// no lines on it. Each digit is one line (its four curves end to end); a fixed number of lights sit at fixed
// fractions of that line's length, so laid flat they would be evenly spaced, and as the digit stretches and
// bends the lights stay at their spot along it. The lights are painted into the mask's colour channels
// (coverage stays in alpha), and the shader turns them into a glow inside the glass.

import { conf } from '../config.js';

const VB_W = 100, VB_H = 116, VB_Y0 = -8;      // viewBox of each digit svg: "0 -8 100 116"
const STROKE = 80 * 0.2;                        // stroke-width 80 under transform scale(0.2), in viewBox units
const LIGHTS = 18;                                // lights along each digit
const LED_COLORS = [[255, 40, 50], [255, 150, 20], [40, 240, 90], [20, 215, 255], [70, 90, 255], [240, 60, 215]];   // red orange green cyan blue magenta

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

export function initGlass(engine, getBasis) {
  const clock = document.getElementById('clock');
  const canvasEl = engine.canvas;
  const mask = document.createElement('canvas');
  const ctx = mask.getContext('2d');
  let raf = 0;

  // The LED panel is the normal picture, glass and all, averaged into pixels. With the solid style the
  // shader has to draw the digits itself (flat ink), because the SVG cannot be pixelated.
  const style = () => conf.clockStyle || 'solid';
  const led = () => conf.screenMode === 'led';
  const active = () => style() !== 'solid' || led();

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

  // Evenly spaced along the digit as one line, at fixed fractions of its length: the lights stick to their place
  // in the line while the digit moves. (The two colon dots are lines of their own, one light each.)
  function paintLights(s, lines) {
    const strokes = lines.filter(l => !l.dot), dots = lines.filter(l => l.dot);
    const segs = [];
    let total = 0;
    for (const l of strokes) for (let j = 1; j < l.pts.length; j++) {
      const len = Math.hypot(l.pts[j][0] - l.pts[j - 1][0], l.pts[j][1] - l.pts[j - 1][1]);
      if (len > 0) { segs.push({ a: l.pts[j - 1], b: l.pts[j], from: total, len }); total += len; }
    }
    const lights = [];
    if (total > 0) {
      let si = 0;
      for (let k = 0; k < LIGHTS; k++) {
        const t = ((k + 0.5) / LIGHTS) * total;
        while (si < segs.length - 1 && segs[si].from + segs[si].len < t) si++;
        const g = segs[si], u = Math.min(1, Math.max(0, (t - g.from) / g.len));
        lights.push({ x: g.a[0] + (g.b[0] - g.a[0]) * u, y: g.a[1] + (g.b[1] - g.a[1]) * u, c: (k + s.idx) % LED_COLORS.length });
      }
    }
    const R = total > 0 ? Math.max(70, (total / LIGHTS) * 1.15) : 70;
    dots.forEach((l, i) => {
      const m = l.pts[Math.floor(l.pts.length / 2)];
      lights.push({ x: m[0], y: m[1], c: (s.idx * 2 + i + 3) % LED_COLORS.length });
    });
    ctx.globalCompositeOperation = 'source-atop';                   // only ever paints inside the tube
    for (const L of lights) {
      const c = LED_COLORS[L.c], hot = c.map(v => Math.round(v + (255 - v) * 0.45));
      const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, R);
      g.addColorStop(0, `rgba(${hot[0]},${hot[1]},${hot[2]},1)`);
      g.addColorStop(0.22, `rgba(${c[0]},${c[1]},${c[2]},0.95)`);
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(L.x, L.y, R, 0, 6.2832); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
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
    ctx.lineJoin = 'round';                                          // rounded corners and ends, like the solid style

    for (const s of svgs) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.translate(s.ox - x0, s.oy - y0);
      ctx.scale(s.k * 0.2, s.k * 0.2);
      const lines = [];
      s.paths.forEach((p) => {
        const d = p.el.getAttribute('d');
        if (!d) return;
        if (stained) ctx.strokeStyle = '#000';                      // the tube: opaque, colourless until the lights are painted on
        ctx.lineWidth = 80; ctx.lineCap = 'round';
        ctx.stroke(new Path2D(d));
        if (stained) { const pts = flatten(d); if (pts.length >= 2) lines.push({ pts, dot: p.round }); }
      });
      if (stained) paintLights(s, lines);
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
    lightColor = col;
    let lx = -0.5, ly = 0.8;
    if (body) {
      const p = proj(body);
      const l = Math.hypot(p.x, p.y);
      if (l > 1e-3) { lx = p.x / l; ly = p.y / l; }
      else { lx = -0.4; ly = 0.9; }                                  // light is straight ahead / behind
    }
    const n = Math.hypot(lx, ly) || 1;
    engine.setGlass({ light: [lx / n, ly / n, strength], lightCol: col, glowCol: glowColor() });
  }

  // colour of the light inside liquid glass
  let lightColor = [1, 1, 1];
  const GLOWS = { warm: [1.0, 0.82, 0.55], white: [1, 1, 1], cool: [0.55, 0.78, 1.0] };
  function glowColor() {
    if (conf.glassGlowColor === 'follow') {                          // the colour of the sun or moon light, kept from going grey
      const m = Math.max(...lightColor);
      return lightColor.map(v => Math.min(1, v / m));
    }
    return GLOWS[conf.glassGlowColor] || GLOWS.warm;
  }
  // stained glass always glows a little, the slider only makes it brighter; liquid glass is unlit at 0
  const glowAmount = () => {
    const g = Math.min(1, Math.max(0, +conf.glassGlow || 0));
    return style() === 'stained' ? 0.55 + 0.45 * g : style() === 'glass' ? g : 0;
  };

  function apply() {
    const st = style();
    const on = active();
    document.body.dataset.clockstyle = on && st === 'solid' ? 'led' : st;
    document.body.dataset.screen = led() ? 'led' : 'normal';
    engine.glass.led.on = led();
    engine.setGlass({
      mode: st === 'glass' ? 1 : st === 'stained' ? 2 : led() ? 3 : 0,
      frost: Math.min(1, Math.max(0, +conf.glassFrost)),
      glow: glowAmount(),
      // each LED pixel averages digit and sky, which halves the contrast, so the panel asks for twice as much
      contrast: ({ off: 0, auto: 3, high: 4.5 }[conf.legibility] ?? 3) * (led() ? 2 : 1),
      glowCol: glowColor(),
    });
    if (on) { schedule(); updateLight(); }
  }

  /** Digit colour for the LED panel, from the same choice that colours the solid ink. */
  function setInk(rgb) { engine.setGlass({ ink: rgb }); }

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
  return { apply, updateLight, setInk };
}
