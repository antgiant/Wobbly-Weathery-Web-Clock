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

import { conf, clockStyleNow } from '../config.js';
import { getSim } from '../simtime.js';
import { every } from './scheduler.js';
import { DropSim, drawDrops, dropGeometry } from './drops.js';
import { applyLedPanel } from './ledpanel.js';

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

  // ---- raindrops (drops.js): a simulation on the digits' ink, drawn into a canvas the size of the mask ----
  const sim = window.__drops = new DropSim((Date.now() & 0xffff) + 1);        // (window.__drops: for the tests)
  const dropCanvas = document.createElement('canvas'), dropCtx = dropCanvas.getContext('2d');
  const inkCanvas = document.createElement('canvas'), inkCtx = inkCanvas.getContext('2d', { willReadFrequently: true });
  let inkStale = true, inkStroke = 30, lastDropT = 0;
  function refreshInk() {                                          // the digits' alpha, as a small grid for the simulation
    inkStale = false;
    const gw = Math.min(96, mW), gh = Math.max(2, Math.round(gw * mH / mW));
    if (inkCanvas.width !== gw || inkCanvas.height !== gh) { inkCanvas.width = gw; inkCanvas.height = gh; }
    inkCtx.clearRect(0, 0, gw, gh);
    if (lastPolys) {                                                // the glass was drawn on the GPU: the physics needs only a coarse picture, drawn here from the same polylines
      const q = gw / mW; inkCtx.strokeStyle = '#fff'; inkCtx.lineCap = 'round'; inkCtx.lineJoin = 'round';
      for (const pl of lastPolys) { inkCtx.lineWidth = Math.max(1, 2 * pl.r * q); inkCtx.beginPath(); for (let i = 0; i < pl.pts.length; i += 2) (i ? inkCtx.lineTo(pl.pts[i] * q, pl.pts[i + 1] * q) : inkCtx.moveTo(pl.pts[i] * q, pl.pts[i + 1] * q)); inkCtx.stroke(); }
    } else inkCtx.drawImage(mask, 0, 0, gw, gh);
    const px = inkCtx.getImageData(0, 0, gw, gh).data, grid = new Uint8Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = px[i * 4 + 3];
    sim.setInk(grid, gw, gh, mW, mH, inkStroke);
  }
  function stepDrops() {                                           // once per rendered frame while it rains
    const rain = engine.wx ? engine.wx.rain : 0;
    if (!active() || !engine.glass.hasMask || (rain <= 0.01 && !sim.drops.length)) { sim.drops.length = 0; engine.clearGlassDrops(); lastDropT = 0; return; }
    const t = performance.now(), dt = lastDropT ? (t - lastDropT) / 1000 : 0.016;
    lastDropT = t;
    if (inkStale) refreshInk();
    if (engine.knobs) sim.maxDrops = engine.knobs.drops;               // the quality governor's limit
    sim.step(dt, rain);
    const L = engine.glass.light || [-0.5, 0.8, 0.6];
    if (engine.canDrawMask && !window.__canvasMask) {                // the GPU draws the drops (glsl-mask.js); the CPU only lists them
      engine.setGlassDropsGeometry({ w: mW, h: mH, ...dropGeometry(sim, [L[0], L[1]]) });
      return;
    }
    if (dropCanvas.width !== mW || dropCanvas.height !== mH) { dropCanvas.width = mW; dropCanvas.height = mH; }
    drawDrops(dropCtx, sim, [L[0], L[1]]);
    engine.setGlassDrops(dropCanvas);
  }

  let raf = 0;
  let mW = 1, mH = 1;                                              // the mask's size in pixels (the canvas path resizes `mask` to it; the GPU path has no canvas)
  let lastPolys = null;                                            // the last drawn digits as polylines in mask pixels (GPU path), for the drops' coarse ink

  // The LED panel is the normal picture, glass and all, averaged into pixels. With the solid style the
  // shader has to draw the digits itself (flat ink), because the SVG cannot be pixelated.
  const style = () => clockStyleNow();
  const led = () => conf.screenMode === 'led';
  const active = () => style() !== 'solid' || led();

  // Positions are measured against the canvas's own rectangle on every redraw, so scrolling,
  // zooming or a changing mobile toolbar can never leave the glass at a stale position.
  let measured = null, measuredV = -1;
  function measure() {
    const v = window.__domVersion;                                   // (the Pi's DOM numbers its changes: nothing changed since the last answer, so it still holds. A browser has no such number.)
    if (v !== undefined && measured && v === measuredV) return measured;
    measured = measureNow(); measuredV = v;
    return measured;
  }
  function measureNow() {
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
    const scale = Math.min(window.devicePixelRatio || 1, 1.5, engine.maxTexture / Math.max(1, x1 - x0, y1 - y0));       // (and the mask is no bigger than the GPU's biggest texture)
    const mw = Math.max(2, Math.round((x1 - x0) * scale)), mh = Math.max(2, Math.round((y1 - y0) * scale));
    return { svgs, x0, y0, scale, strokePx, mw, mh, rect: [x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H] };
  }

  // Evenly spaced along the digit as one line, at fixed fractions of its length: the lights stick to their place
  // in the line while the digit moves. (The two colon dots are lines of their own, one light each.)
  // Returns the lights in path units ({x, y, c: colour index}) and the radius of each.
  function computeLights(s, lines) {
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
    return { lights, R };
  }

  function paintLights(s, lines) {
    const { lights, R } = computeLights(s, lines);
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

  // The same picture as vertices for the GPU (glsl-mask.js): every digit's polylines in mask pixels, as quads around each segment, and a quad per light.
  // This runs for every frame a digit moves, so it is written for a slow CPU (a Pi Zero's JavaScript is about 40 times slower than a laptop's): the curves come
  // as numbers from the clock (clock.js keeps them beside the path string), the quads are written straight into one reused typed array, and a curve that is small on
  // the screen is cut into fewer pieces.
  let sbuf = new Float32Array(8192);
  const flatCache = new Map();                                     // path string -> polyline in path units, for the paths that never change (the colon's dots)
  function curvePx(c, k0, kk, ox, oy) {                              // a cubic's points in mask pixels: [x, y, x, y, ...]
    const x0 = c[k0], y0 = c[k0 + 1], x1 = c[k0 + 2], y1 = c[k0 + 3], x2 = c[k0 + 4], y2 = c[k0 + 5], x3 = c[k0 + 6], y3 = c[k0 + 7];
    const len = (Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2)) * kk;
    const n = Math.max(3, Math.min(14, Math.ceil(Math.sqrt(len) * 0.8)));
    const out = new Array(2 * (n + 1));
    out[0] = ox + x0 * kk; out[1] = oy + y0 * kk;
    for (let j = 1; j <= n; j++) {
      const u = j / n, v = 1 - u, a = v * v * v, b = 3 * v * v * u, d = 3 * v * u * u, e = u * u * u;
      out[2 * j] = ox + (a * x0 + b * x1 + d * x2 + e * x3) * kk; out[2 * j + 1] = oy + (a * y0 + b * y1 + d * y2 + e * y3) * kk;
    }
    return out;
  }
  function geometry(L, stained) {
    const lights = [], polys = [];
    let n = 0;                                                       // floats written into sbuf
    for (const s of L.svgs) {
      const kk = s.k * 0.2 * L.scale, ox = (s.ox - L.x0) * L.scale, oy = (s.oy - L.y0) * L.scale, r = 8 * s.k * L.scale;    // 80 path units wide
      const lines = [];
      for (const p of s.paths) {
        const el = p.el;
        let px, pts = null;                                          // px: the polyline in mask pixels; pts (only for the lights): in path units, as pairs
        if (el.__c && el.__ck !== undefined && el.__d !== undefined) px = curvePx(el.__c, el.__ck, kk, ox, oy);
        else {
          const d = el.getAttribute('d');
          if (!d) continue;
          let f = flatCache.get(d);
          if (!f) { f = flatten(d); flatCache.set(d, f); if (flatCache.size > 64) flatCache.clear(); }
          if (!f.length) continue;
          px = new Array(f.length * 2);
          for (let i = 0; i < f.length; i++) { px[2 * i] = ox + f[i][0] * kk; px[2 * i + 1] = oy + f[i][1] * kk; }
          pts = f;
        }
        const np = px.length / 2;
        polys.push({ pts: px, r });
        if (n + np * 42 > sbuf.length) { const nb = new Float32Array(Math.max(sbuf.length * 2, n + np * 42)); nb.set(sbuf.subarray(0, n)); sbuf = nb; }
        for (let i = 0; i < np; i++) {
          if (i === np - 1 && i > 0) break;                          // (a single point is a dot)
          const ax = px[2 * i], ay = px[2 * i + 1], j = i + 1 < np ? i + 1 : i, bx = px[2 * j], by = px[2 * j + 1];
          const x0 = (ax < bx ? ax : bx) - r - 1, y0 = (ay < by ? ay : by) - r - 1, x1 = (ax > bx ? ax : bx) + r + 1, y1 = (ay > by ? ay : by) + r + 1;
          for (let q = 0; q < 6; q++) {                              // two triangles: (x0,y0) (x1,y0) (x0,y1)  (x1,y0) (x1,y1) (x0,y1)
            sbuf[n] = q === 0 || q === 2 || q === 5 ? x0 : x1; sbuf[n + 1] = q === 0 || q === 1 || q === 3 ? y0 : y1;
            sbuf[n + 2] = ax; sbuf[n + 3] = ay; sbuf[n + 4] = bx; sbuf[n + 5] = by; sbuf[n + 6] = r; n += 7;
          }
        }
        if (stained && np >= 2) {
          if (!pts) { pts = []; const m = px.length / 2; for (let i = 0; i < m; i++) pts.push([(px[2 * i] - ox) / kk, (px[2 * i + 1] - oy) / kk]); }
          lines.push({ pts, dot: p.round });
        }
      }
      if (stained) {
        const { lights: ls, R } = computeLights(s, lines), rp = R * kk;
        for (const l of ls) {
          const c = LED_COLORS[l.c], cx = ox + l.x * kk, cy = oy + l.y * kk;
          for (const [x, y] of [[cx - rp, cy - rp], [cx + rp, cy - rp], [cx - rp, cy + rp], [cx + rp, cy - rp], [cx + rp, cy + rp], [cx - rp, cy + rp]]) lights.push(x, y, cx, cy, rp, c[0] / 255, c[1] / 255, c[2] / 255);
        }
      }
    }
    return { strokes: sbuf.subarray(0, n), lights: new Float32Array(lights), polys };
  }

  /** Where the strokes are, in canvas uv (y down: x0, y0, x1, y1), with their widths: the glass passes need run only there. Null when there are none. */
  function boundsOf(geo, L) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const scan = (a, stride, rIdx) => { if (!a) return; for (let i = 0; i + 1 < a.length; i += stride) { const r = rIdx >= 0 ? a[i + rIdx] || 0 : 0; x0 = Math.min(x0, a[i] - r); x1 = Math.max(x1, a[i] + r); y0 = Math.min(y0, a[i + 1] - r); y1 = Math.max(y1, a[i + 1] + r); } };
    scan(geo.strokes, 7, 6); scan(geo.lights, 8, -1);
    if (!(x1 > x0 && y1 > y0)) return null;
    const u = (x) => L.rect[0] + (x / L.mw) * L.rect[2], v = (y) => L.rect[1] + (y / L.mh) * L.rect[3];
    return [Math.max(0, u(x0)), Math.max(0, v(y0)), Math.min(1, u(x1)), Math.min(1, v(y1))];
  }

  function draw() {
    raf = 0;
    if (!active()) return;
    if (engine.markWork) engine.markWork();                                                // (a frame's cost starts here: the quality governor adds up the whole of it)
    const tp = window.__tp, tt = tp && performance.now();             // (the native host's --profile adds up the phases)
    const L = measure();
    if (tp) tp('page glass.draw: measure', tt);
    if (!L) return;
    const { svgs, x0, y0, scale } = L;
    const stained = style() === 'stained';
    mW = L.mw; mH = L.mh;
    if (engine.canDrawMask && !window.__canvasMask) {              // the GPU draws the strokes (glsl-mask.js); the CPU only lists the geometry
      const tg = tp && performance.now();
      const geo = geometry(L, stained);
      if (tp) tp('page glass.draw: geometry (the strokes as lists)', tg);
      lastPolys = geo.polys;
      inkStroke = L.strokePx * L.scale; inkStale = true;
      engine.setGlassGeometry({ w: L.mw, h: L.mh, rect: L.rect, strokeCssPx: L.strokePx, strokes: geo.strokes, lights: geo.lights, black: stained, bounds: boundsOf(geo, L) });
      return;
    }
    lastPolys = null;
    if (mask.width !== L.mw || mask.height !== L.mh) { mask.width = L.mw; mask.height = L.mh; }
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
    inkStroke = L.strokePx * L.scale; inkStale = true;               // the digits changed: the drops look at the new glass at the next step
    engine.setGlassMask(mask, L.rect, L.strokePx);
  }
  const schedule = (why) => { if (window.__why) window.__why('glass redraw asked for by: ' + (typeof why === 'string' ? why : why && why.type ? 'event ' + why.type : '?')); if (!raf) raf = requestAnimationFrame(draw); };

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
    engine.glass.led.stars = conf.ledStars === 'off' ? 0 : conf.ledStars === 'always' ? 2 : 1;      // the LED panel keeps the stars the averaging would lose
    applyLedPanel();                                   // size and layout of the LED panel (or clear them when it is off)
    engine.setGlass({
      mode: st === 'glass' ? 1 : st === 'stained' ? 2 : led() ? 3 : 0,
      frost: Math.min(1, Math.max(0, +conf.glassFrost)),
      glow: glowAmount(),
      contrast: { off: 0, auto: 0.85, high: 1 }[conf.legibility] ?? 0.85,
      glowCol: glowColor(),
    });
    if (on) { schedule('apply (settings)'); updateLight(); }
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
  let lastStyle = style();
  every('glass-style', () => { if (style() !== lastStyle) { lastStyle = style(); apply(); } }, () => (getSim() ? 4000 : 60000));   // the season (or time travel) changed the automatic style
  every('glass-light', () => { updateLight(); if (active()) schedule('the light timer'); }, () => (active() ? (engine.knobs && engine.knobs.cadence === 'minute' ? 60000 : engine.knobs && engine.knobs.seconds === 'off' ? 10000 : 1000) : Infinity));       // (the ladder slows it on the slow rungs)   // the light moves with the sun; also re-measures the digits
  engine.onFrame(() => { if (active() && !engine._lightInit) { engine._lightInit = true; updateLight(); } });
  engine.onFrame(stepDrops);
  apply();
  return { apply, updateLight, setInk };
}
