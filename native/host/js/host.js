// The browser surface the sky engine expects, on top of a handful of native calls. This file is the whole "browser": no DOM, no layout.
// Natives (provided by the Rust host): __gl, __readfile, __readtext, __decode, __now, __print.
const G = globalThis;
G.window = G;
G.self = G;
G.devicePixelRatio = 1;
G.location = { search: '', href: 'file://' + (G.__root || '') + '/index.html', hash: '' };
G.navigator = { userAgent: 'wobbly-host', hardwareConcurrency: 4 };
G.console = { log: (...a) => __print(a.join(' ')), warn: (...a) => __print('warn: ' + a.join(' ')), error: (...a) => __print('error: ' + a.join(' ')), info: () => {}, debug: () => {} };
const t0 = __now();
G.performance = { now: () => __now() - t0, mark(n) { if (G.__args && G.__args.timing) __print('[' + Math.round(__now() - t0) + ' ms] ' + n); }, measure() {} };

// ---- timers, pumped by the host ------------------------------------------------------------------------------------
let timers = [], tid = 1;
G.setTimeout = (fn, ms = 0, ...a) => { const id = tid++; timers.push({ id, at: __now() + ms, fn: () => fn(...a), src: fn }); return id; };
G.clearTimeout = (id) => { timers = timers.filter(t => t.id !== id); };
G.setInterval = (fn, ms) => { const id = tid++; const re = () => { timers.push({ id, at: __now() + ms, fn: () => { re(); fn(); }, src: fn }); }; re(); return id; };
G.clearInterval = G.clearTimeout;
G.requestAnimationFrame = (fn) => { const id = tid++; timers.push({ id, at: __now(), fn: () => fn(performance.now()), src: fn }); return id; };
G.cancelAnimationFrame = G.clearTimeout;
// --profile: the time each kind of timer callback takes (named by the start of its source), so the page's own work shows up besides the GPU's
const timerTime = {};
G.__timerTime = timerTime;
G.__pump = () => {
  const now = __now(); const due = timers.filter(t => t.at <= now); timers = timers.filter(t => t.at > now);
  if (G.__args && G.__args.profile) due.forEach(t => { const t0 = __now(); t.fn(); const sf = t.src || t.fn; const k = (sf.name ? sf.name + ': ' : '') + String(sf).replace(/\s+/g, ' ').slice(0, 90); const e = timerTime[k] || (timerTime[k] = { ms: 0, n: 0 }); e.ms += __now() - t0; e.n++; });
  else due.forEach(t => t.fn());
  return timers.length;
};

// ---- files and images ----------------------------------------------------------------------------------------------
const resolve = (u) => String(u).replace(/^file:\/\//, '');
G.fetch = async (url) => {
  const p = resolve(url);
  let buf; try { buf = __readfile(p); } catch (e) { return { ok: false, status: 404, arrayBuffer: async () => { throw e; }, json: async () => { throw e; }, text: async () => { throw e; } }; }
  return { ok: true, status: 200, arrayBuffer: async () => buf, text: async () => __readtext(p), json: async () => JSON.parse(__readtext(p)) };
};
G.Image = class {
  set src(v) { try { const d = __decode(resolve(v)); this.width = d.w; this.height = d.h; this._rgba = d.data; this.complete = true; setTimeout(() => this.onload && this.onload(), 0); } catch (e) { setTimeout(() => this.onerror && this.onerror(e), 0); } }
};
G.ImageData = class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };
G.URL = class { constructor(p, base) { let b = base ? String(base.href || base) : ''; this.href = /^([a-z]+:|\/)/i.test(p) ? p : b.replace(/[^/]*$/, '') + p; this.href = this.href.replace(/\/\.\//g, '/'); } };
G.document = {
  hidden: false,
  baseURI: 'file://' + (G.__root || '') + '/index.html',
  addEventListener() {}, removeEventListener() {},
  createElement(tag) { if (tag === 'canvas') return new Canvas(); throw new Error('createElement ' + tag); },
};
G.addEventListener = () => {}; G.removeEventListener = () => {};

// ---- 2D canvas (drawn natively by tiny-skia; this keeps the style state and sends each drawing call with the style resolved) --------
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0], red: [255, 0, 0, 1], green: [0, 128, 0, 1], blue: [0, 0, 255, 1] };
function parseColor(c) {
  if (Array.isArray(c)) return c;
  c = String(c).trim().toLowerCase();
  if (NAMED[c]) return NAMED[c];
  let m = c.match(/^#([0-9a-f]{3,8})$/);
  if (m) { let h = m[1]; if (h.length <= 4) h = h.split('').map(x => x + x).join(''); const n = (i) => parseInt(h.slice(i, i + 2), 16); return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]; }
  m = c.match(/^rgba?\(([^)]*)\)$/);
  if (m) { const p = m[1].split(/[,\s/]+/).filter(Boolean).map(x => x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x)); return [p[0], p[1], p[2], p.length > 3 ? p[3] / (m[1].includes('%') ? 2.55 : 1) : 1]; }
  return [0, 0, 0, 1];
}
const c01 = (c) => [c[0] / 255, c[1] / 255, c[2] / 255, c[3]];
class Gradient { constructor(o) { Object.assign(this, o); this.stops = []; } addColorStop(off, col) { this.stops.push([off, c01(parseColor(col))]); } }
G.Path2D = class { constructor(d) { this.d = typeof d === 'string' ? d : null; this.cmds = []; } };
const isCanvas = (o) => !!o && typeof o._ensure === 'function';
const srcPixels = (im) => isCanvas(im) ? (im._ensure(), { w: im.width, h: im.height, data: __c2d_read(im._id, 0, 0, im.width, im.height) }) : { w: im.width, h: im.height, data: im._rgba };
class Ctx2D {
  constructor(canvas) {
    this.canvas = canvas; this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1; this.lineCap = 'butt'; this.lineJoin = 'miter'; this.miterLimit = 10;
    this.globalAlpha = 1; this.globalCompositeOperation = 'source-over'; this.font = '10px sans-serif'; this.textBaseline = 'alphabetic'; this.textAlign = 'start';
    this.imageSmoothingEnabled = true; this._path = []; this._stack = [];
  }
  _c(op, arg, buf) { this.canvas._ensure(); __c2d_call(this.canvas._id, op, JSON.stringify(arg), buf); }
  _paint(st) { if (st instanceof Gradient) return st.kind === 'lin' ? { k: 'lin', x0: st.x0, y0: st.y0, x1: st.x1, y1: st.y1, stops: st.stops } : { k: 'rad', x0: st.x0, y0: st.y0, r0: st.r0, x1: st.x1, y1: st.y1, r1: st.r1, stops: st.stops }; return { k: 'color', c: c01(parseColor(st)) }; }
  save() { this._stack.push({ fs: this.fillStyle, ss: this.strokeStyle, lw: this.lineWidth, lc: this.lineCap, lj: this.lineJoin, ga: this.globalAlpha, gc: this.globalCompositeOperation }); this._c('save', {}); }
  restore() { const s = this._stack.pop(); if (s) { this.fillStyle = s.fs; this.strokeStyle = s.ss; this.lineWidth = s.lw; this.lineCap = s.lc; this.lineJoin = s.lj; this.globalAlpha = s.ga; this.globalCompositeOperation = s.gc; } this._c('restore', {}); }
  setTransform(a, b, c, d, e, f) { if (typeof a === 'object') ({ a, b, c, d, e, f } = a); this._c('setTransform', { a, b, c, d, e, f }); }
  resetTransform() { this.setTransform(1, 0, 0, 1, 0, 0); }
  transform(a, b, c, d, e, f) { this._c('transform', { a, b, c, d, e, f }); }
  translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
  scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
  rotate(r) { const c = Math.cos(r), s = Math.sin(r); this.transform(c, s, -s, c, 0, 0); }
  clearRect(x, y, w, h) { this._c('clearRect', { x, y, w, h }); }
  fillRect(x, y, w, h) { this._c('fillRect', { x, y, w, h, paint: this._paint(this.fillStyle), alpha: this.globalAlpha, op: this.globalCompositeOperation }); }
  strokeRect(x, y, w, h) { this._c('stroke', { path: [['rect', x, y, w, h]], paint: this._paint(this.strokeStyle), alpha: this.globalAlpha, op: this.globalCompositeOperation, lineWidth: this.lineWidth, cap: this.lineCap, join: this.lineJoin }); }
  beginPath() { this._path = []; }
  closePath() { this._path.push(['Z']); }
  moveTo(x, y) { this._path.push(['M', x, y]); }
  lineTo(x, y) { this._path.push(['L', x, y]); }
  bezierCurveTo(a, b, c, d, e, f) { this._path.push(['C', a, b, c, d, e, f]); }
  quadraticCurveTo(a, b, c, d) { this._path.push(['Q', a, b, c, d]); }
  arc(x, y, r, a0, a1, ccw) { this._path.push(['arc', x, y, r, a0, a1, !!ccw]); }
  rect(x, y, w, h) { this._path.push(['rect', x, y, w, h]); }
  roundRect(x, y, w, h, r) { this._path.push(['roundRect', x, y, w, h, Array.isArray(r) ? r[0] : r]); }
  _draw(op, p, rule) {
    const o = { paint: this._paint(op === 'fill' ? this.fillStyle : this.strokeStyle), alpha: this.globalAlpha, op: this.globalCompositeOperation, lineWidth: this.lineWidth, cap: this.lineCap, join: this.lineJoin, miter: this.miterLimit, rule };
    if (p instanceof Path2D) { if (p.d) o.d = p.d; else o.path = p.cmds; } else o.path = this._path;
    this._c(op, o);
  }
  fill(p, rule) { if (typeof p === 'string') { rule = p; p = undefined; } this._draw('fill', p, rule); }
  stroke(p) { this._draw('stroke', p); }
  createLinearGradient(x0, y0, x1, y1) { return new Gradient({ kind: 'lin', x0, y0, x1, y1 }); }
  createRadialGradient(x0, y0, r0, x1, y1, r1) { return new Gradient({ kind: 'rad', x0, y0, r0, x1, y1, r1 }); }
  drawImage(im, a, b, c, d, e, f, g, h) {
    const s = srcPixels(im); let cx = 0, cy = 0, cw = s.w, ch = s.h, dx, dy, dw = s.w, dh = s.h;
    if (g !== undefined) { [cx, cy, cw, ch, dx, dy, dw, dh] = [a, b, c, d, e, f, g, h]; } else if (c !== undefined) { [dx, dy, dw, dh] = [a, b, c, d]; } else { dx = a; dy = b; }
    this._c('drawImage', { sw: s.w, sh: s.h, cx, cy, cw, ch, dx, dy, dw, dh, alpha: this.globalAlpha, op: this.globalCompositeOperation }, s.data);
  }
  getImageData(x, y, w, h) { this.canvas._ensure(); const id = new ImageData(w, h); id.data.set(new Uint8Array(__c2d_read(this.canvas._id, x, y, w, h))); return id; }
  createImageData(w, h) { return new ImageData(w, h); }
  putImageData(img, x, y) { this._c('putImageData', { w: img.width, h: img.height, x, y }, img.data.buffer.slice(img.data.byteOffset, img.data.byteOffset + img.data.byteLength)); }
  measureText(t) { const m = /(\d+(?:\.\d+)?)px/.exec(this.font); return { width: String(t).length * (m ? +m[1] : 10) * 0.56 }; }   // no text engine yet: an estimate
  fillText() {} strokeText() {} clip() {} setLineDash() {}
}

// ---- --profile: where the CPU time goes besides drawing (the 2D canvas natives are timed here; the engine's calls in boot.js) ----
G.__pt = {}; G.__glClock = 0;                                                                       // (the time spent inside GL calls so far: a phase's own JavaScript is its time less this)
// Every method of an object, timed by itself: the time inside it less the time inside the methods it calls (the "stack" keeps what each call's callees took), split into its own JavaScript and the GL calls it makes
// itself. The tiny helpers (uniform setters and the like) are only counted: timing them would cost more than they do.
G.__whyMap = {}; G.__why = (k) => { G.__whyMap[k] = (G.__whyMap[k] || 0) + 1; };           // what asked for work (the page says so when it is profiled): counted, printed with the profile
G.__whyDump = () => { const rows = Object.entries(G.__whyMap).sort((a, b) => b[1] - a[1]); __print('--- what asked for work since the last report (count, who) ---'); for (const [k, v] of rows) __print(String(v).padStart(8) + '  ' + k); for (const k in G.__whyMap) delete G.__whyMap[k]; };
G.__fn = {}; const fnStack = [];
G.__wrapFns = (obj, prefix, tiny) => {
  const seen = new Set();
  for (let o = obj; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const k of Object.getOwnPropertyNames(o)) {
    if (seen.has(k) || k === 'constructor') continue; seen.add(k);
    const d = Object.getOwnPropertyDescriptor(o, k); if (!d || typeof d.value !== 'function') continue;
    const f = obj[k], name = prefix + k;
    if (tiny && tiny.test(k)) { obj[k] = function (...a) { const e = G.__fn[name] || (G.__fn[name] = { n: 0, js: 0, gl: 0 }); e.n++; return f.apply(this, a); }; continue; }
    obj[k] = function (...a) {
      const fr = { c: 0, g: 0 }, t = performance.now(), g0 = G.__glClock; fnStack.push(fr);
      try { return f.apply(this, a); } finally {
        fnStack.pop(); const dt = performance.now() - t, dg = G.__glClock - g0, e = G.__fn[name] || (G.__fn[name] = { n: 0, js: 0, gl: 0 });
        e.n++; e.js += dt - fr.c - (dg - fr.g); e.gl += dg - fr.g; const up = fnStack[fnStack.length - 1]; if (up) { up.c += dt; up.g += dg; }
      }
    };
  }
};
G.__fnDump = () => {
  const rows = Object.entries(G.__fn).sort((x, y) => (y[1].js + y[1].gl) - (x[1].js + x[1].gl)).slice(0, 16);
  __print('--- engine methods, each by itself (own JavaScript ms, own GL ms, calls) ---');
  for (const [k, v] of rows) __print(String(Math.round(v.js * 10) / 10).padStart(8) + '  ' + String(Math.round(v.gl * 10) / 10).padStart(6) + '  x' + String(v.n).padEnd(5) + k);
  const tiny = Object.entries(G.__fn).filter(([, v]) => v.js === 0 && v.gl === 0).sort((x, y) => y[1].n - x[1].n).slice(0, 6);
  if (tiny.length) __print('  helper calls (counted, not timed): ' + tiny.map(([k, v]) => k + ' x' + v.n).join(', '));
  for (const k in G.__fn) delete G.__fn[k];
};
G.__tp = (k, t0) => { G.__pt[k] = (G.__pt[k] || 0) + performance.now() - t0; };           // (the page's own code adds its phases here when it is profiled)
if (G.__args && G.__args.profile) {
  for (const k of ['__c2d_call', '__c2d_read']) { const f = G[k]; G[k] = (...a) => { const t = __now(); const r = f(...a); G.__pt['2D canvas (tiny-skia)'] = (G.__pt['2D canvas (tiny-skia)'] || 0) + __now() - t; return r; }; }
}

// ---- WebGL2 over the native dispatcher -----------------------------------------------------------------------------
const C = { DEPTH_BUFFER_BIT: 0x100, COLOR_BUFFER_BIT: 0x4000, POINTS: 0, TRIANGLES: 4, ZERO: 0, ONE: 1, SRC_ALPHA: 0x302, ONE_MINUS_SRC_ALPHA: 0x303, DST_ALPHA: 0x304, BLEND: 0xBE2,
  TEXTURE_2D: 0xDE1, UNSIGNED_BYTE: 0x1401, FLOAT: 0x1406, HALF_FLOAT: 0x140B, RGBA: 0x1908, RGBA8: 0x8058, RGBA16F: 0x881A, RGBA32F: 0x8814,
  NEAREST: 0x2600, LINEAR: 0x2601, LINEAR_MIPMAP_LINEAR: 0x2703, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_MIN_FILTER: 0x2801, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
  REPEAT: 0x2901, CLAMP_TO_EDGE: 0x812F, TEXTURE0: 0x84C0, ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88E4, DYNAMIC_DRAW: 0x88E8, STREAM_READ: 0x88E1,
  PIXEL_PACK_BUFFER: 0x88EB, FRAMEBUFFER: 0x8D40, READ_FRAMEBUFFER: 0x8CA8, DRAW_FRAMEBUFFER: 0x8CA9, COLOR_ATTACHMENT0: 0x8CE0, FRAMEBUFFER_COMPLETE: 0x8CD5,
  FRAGMENT_SHADER: 0x8B30, VERTEX_SHADER: 0x8B31, COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82, SYNC_GPU_COMMANDS_COMPLETE: 0x9117, TIMEOUT_EXPIRED: 0x911B,
  MAX: 0x8008, MIN: 0x8007, FUNC_ADD: 0x8006, SRC_COLOR: 0x300, ONE_MINUS_DST_ALPHA: 0x305,
  UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241 };
const idOf = (o) => (o ? o.id : 0);
const buf = (v) => (v && v.buffer ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v);

function makeGL(canvas) {
  const gl = Object.create(C);
  const screen = { w: 0, h: 0, fbo: 0, tex: 0 };
  const call = (n, ...a) => __gl(n, ...a);
  const es2 = __gl('isES2') === 1;
  const ensureScreen = () => {
    if (screen.w === canvas.width && screen.h === canvas.height && screen.fbo) return;
    // a new size gets a new texture and a new framebuffer (a GPU driver may keep the old size of a framebuffer whose texture is re-specified)
    if (screen.fbo) { call('bindFramebuffer', C.FRAMEBUFFER, 0); call('deleteFramebuffer', screen.fbo); call('deleteTexture', screen.tex); }
    screen.fbo = call('createFramebuffer'); screen.tex = call('createTexture');
    call('bindTexture', C.TEXTURE_2D, screen.tex);
    call('texImage2D', C.TEXTURE_2D, 0, C.RGBA8, canvas.width, canvas.height, 0, C.RGBA, C.UNSIGNED_BYTE, null);
    call('texParameteri', C.TEXTURE_2D, C.TEXTURE_MIN_FILTER, C.LINEAR);
    call('bindFramebuffer', C.FRAMEBUFFER, screen.fbo);
    call('framebufferTexture2D', C.FRAMEBUFFER, C.COLOR_ATTACHMENT0, C.TEXTURE_2D, screen.tex, 0);
    screen.w = canvas.width; screen.h = canvas.height;
  };
  const wrapNew = (n) => () => ({ id: call(n) });
  Object.assign(gl, {
    canvas, drawingBufferWidth: canvas.width, drawingBufferHeight: canvas.height,
    // an OpenGL ES 2 GPU has no float render targets: saying so makes the engine take its ES 2 path (packed 8-bit tables, no instancing, portable.js)
    getExtension: (n) => (n === 'KHR_parallel_shader_compile' || (!es2 && (n === 'EXT_color_buffer_float' || n === 'EXT_color_buffer_half_float'))) ? {} : null,
    createTexture: wrapNew('createTexture'), createBuffer: wrapNew('createBuffer'), createFramebuffer: wrapNew('createFramebuffer'), createVertexArray: wrapNew('createVertexArray'),
    createProgram: wrapNew('createProgram'), createShader: (t) => ({ id: call('createShader', t) }),
    deleteTexture: (o) => call('deleteTexture', idOf(o)), deleteBuffer: (o) => call('deleteBuffer', idOf(o)), deleteFramebuffer: (o) => call('deleteFramebuffer', idOf(o)),
    shaderSource: (s, src) => call('shaderSource', s.id, src), compileShader: (s) => call('compileShader', s.id),
    getShaderParameter: (s, p) => { const v = call('getShaderParameter', s.id, p); return p === C.COMPILE_STATUS ? v !== 0 : v; },
    getShaderInfoLog: (s) => call('getShaderInfoLog', s.id),
    attachShader: (p, s) => call('attachShader', p.id, s.id), bindAttribLocation: (p, i, n) => call('bindAttribLocation', p.id, i, n), linkProgram: (p) => call('linkProgram', p.id),
    getProgramParameter: (p, q) => { const v = call('getProgramParameter', p.id, q); return q === C.LINK_STATUS ? v !== 0 : v; },
    getProgramInfoLog: (p) => call('getProgramInfoLog', p.id), useProgram: (p) => call('useProgram', idOf(p)),
    getUniformLocation: (p, n) => { const l = call('getUniformLocation', p.id, n); return l < 0 ? null : { loc: l }; },
    uniform1i: (l, a) => l && call('uniform1i', l.loc, a), uniform1f: (l, a) => l && call('uniform1f', l.loc, a), uniform2f: (l, a, b) => l && call('uniform2f', l.loc, a, b),
    uniform3f: (l, a, b, c) => l && call('uniform3f', l.loc, a, b, c), uniform4f: (l, a, b, c, d) => l && call('uniform4f', l.loc, a, b, c, d),
    uniformMatrix3fv: (l, t, m) => l && call('uniformMatrix3fv', l.loc, t, buf(m instanceof Float32Array ? m : new Float32Array(m))),
    texImage2D(target, level, internal, a, b, c, d, e, f) {
      if (f === undefined) {                       // (target, level, internal, format, type, source)
        const src = c; if (isCanvas(src)) { const p = srcPixels(src); return call('texImage2D', target, level, internal, p.w, p.h, 0, a, b, p.data); }
        if (src && src._rgba) return call('texImage2D', target, level, internal, src.width, src.height, 0, a, b, src._rgba);
        return call('texImage2D', target, level, internal, 1, 1, 0, a, b, new Uint8Array(4).buffer);   // a canvas with no 2D pixels yet
      }
      return call('texImage2D', target, level, internal, a, b, c, d, e, f === null ? null : buf(f));
    },
    texParameteri: (...a) => call('texParameteri', ...a), generateMipmap: (t) => call('generateMipmap', t), activeTexture: (t) => call('activeTexture', t),
    bindTexture: (t, o) => call('bindTexture', t, idOf(o)),
    bindFramebuffer: (t, o) => { if (!o) { ensureScreen(); call('bindFramebuffer', t, screen.fbo); } else call('bindFramebuffer', t, o.id); },
    framebufferTexture2D: (t, a, tt, tex, l) => call('framebufferTexture2D', t, a, tt, idOf(tex), l), checkFramebufferStatus: (t) => call('checkFramebufferStatus', t),
    bindBuffer: (t, o) => call('bindBuffer', t, idOf(o)), bufferData: (t, d, u) => call('bufferData', t, typeof d === 'number' ? d : buf(d), u), getBufferSubData: (t, off, out) => { const ab = call('getBufferSubData', t, off, out.byteLength); new Uint8Array(out.buffer, out.byteOffset, out.byteLength).set(new Uint8Array(ab)); },
    bindVertexArray: (o) => call('bindVertexArray', idOf(o)),
    enableVertexAttribArray: (i) => call('enableVertexAttribArray', i), vertexAttribPointer: (...a) => call('vertexAttribPointer', ...a), vertexAttribDivisor: (i, d) => call('vertexAttribDivisor', i, d),
    drawArrays: (...a) => call('drawArrays', ...a), drawArraysInstanced: (...a) => call('drawArraysInstanced', ...a), viewport: (...a) => call('viewport', ...a),
    blendEquation: (m) => call('blendEquation', m), blendFunc: (a, b) => call('blendFunc', a, b), clearColor: (r, g, b, a) => call('clearColor', r, g, b, a), clear: (m) => call('clear', m),
    enable: (c) => call('enable', c), disable: (c) => call('disable', c), blendFuncSeparate: (...a) => call('blendFuncSeparate', ...a), pixelStorei: (p, v) => call('pixelStorei', p, v),
    readPixels(x, y, w, h, fmt, type, dst) {
      if (typeof dst === 'number') return call('readPixels', x, y, w, h, fmt, type, dst);
      const ab = call('readPixels', x, y, w, h, fmt, type); new Uint8Array(dst.buffer, dst.byteOffset, dst.byteLength).set(new Uint8Array(ab));
    },
    blitFramebuffer: (...a) => call('blitFramebuffer', ...a), flush: () => call('flush'), finish: () => call('finish'),
    fenceSync: (c, f) => call('fenceSync', c, f), clientWaitSync: (s, f, t) => call('clientWaitSync', s, f, t), deleteSync: (s) => call('deleteSync', s),
    getError: () => call('getError'),
    _screenSize: () => ensureScreen(),
  });
  if (G.__args && G.__args.profile) {
    const prof = G.__prof = {}; let cur = 0; const names = {}, srcs = {};
    const useP = gl.useProgram, shSrc = gl.shaderSource, attach = gl.attachShader;
    gl.shaderSource = (s, src) => { srcs[s.id] = src; return shSrc(s, src); };
    gl.attachShader = (p, s) => { if (srcs[s.id] && s.id) { const m = /\n(?:\/\/\s*)?(?:uniform|float|in|out)[^\n]*\n/.exec(srcs[s.id]); (names[p.id] ||= []).push(srcs[s.id].length); } return attach(p, s); };
    gl.useProgram = (p) => { cur = p ? p.id : 0; return useP(p); };
    for (const k of ['drawArrays', 'drawArraysInstanced', 'generateMipmap', 'texImage2D', 'readPixels', 'blitFramebuffer']) {
      const f = gl[k]; gl[k] = (...a) => { const t = __now(); const r = f(...a); call('finish'); const d = __now() - t; const key = k + (k.startsWith('draw') ? ' prog' + cur + ' (' + (names[cur] || []).join('+') + ' chars)' : ''); const e = (prof[key] ||= { n: 0, ms: 0 }); e.n++; e.ms += d; return r; };
    }
    const byName = G.__glByName = {};                                                                  // every GL call by function name: how many, and how long they take (the heavy ones are the ones a driver does work for)
    for (const k of Object.keys(gl)) { const f = gl[k]; if (typeof f !== 'function' || k === 'canvas' || /^(_|get(Extension|ShaderInfoLog|ProgramInfoLog|ShaderParameter|ProgramParameter|UniformLocation)$)/.test(k)) continue;
      gl[k] = (...a) => { const t = __now(); const r = f(...a); const e = byName[k] || (byName[k] = { n: 0, ms: 0 }); e.n++; const d = __now() - t; e.ms += d; G.__glClock += d; return r; }; }
    const bumps = {}; G.__bumpLog = (k, el) => { const n = k + ' on ' + (el ? (el.id || el.localName) : '?'); bumps[n] = (bumps[n] || 0) + 1; };
    G.__profDump = () => { const pt = G.__pt; { const rows = Object.entries(bumps).sort((x, y) => y[1] - x[1]).slice(0, 6); if (rows.length) { __print('--- page changes that make the layout be worked out again (count, change) ---'); for (const [k, v] of rows) __print(String(v).padStart(8) + '  ' + k); } for (const k in bumps) delete bumps[k]; } { const rows = Object.entries(G.__timerTime).sort((x, y) => y[1].ms - x[1].ms).slice(0, 8); if (rows.length) { __print('--- timer callbacks since the last dump (ms, count, start of source) ---'); for (const [k, v] of rows) __print(String(Math.round(v.ms)).padStart(8) + '  x' + String(v.n).padEnd(4) + k); } for (const k in G.__timerTime) delete G.__timerTime[k]; } G.__whyDump(); G.__fnDump(); __print('--- CPU time besides drawing, this frame ---'); for (const k in pt) { __print(String(Math.round(pt[k])).padStart(8) + '  ' + k); delete pt[k]; }; const rows = Object.entries(prof).sort((a, b) => b[1].ms - a[1].ms).slice(0, 14); { const rows2 = Object.entries(G.__glByName).sort((a, b) => b[1].ms - a[1].ms).slice(0, 10); __print('--- GL calls by function (ms, count) ---'); rows2.forEach(([k, v]) => __print(String(Math.round(v.ms * 10) / 10).padStart(8) + '  x' + String(v.n).padEnd(5) + k)); for (const k in G.__glByName) delete G.__glByName[k]; } __print('--- GL time by call (ms, count) ---'); rows.forEach(([k, v]) => __print(String(Math.round(v.ms)).padStart(8) + '  x' + String(v.n).padEnd(5) + k)); for (const k in prof) delete prof[k]; };
  }
  if (G.__args && (G.__args.timing || G.__args.profile)) {
    // Which shader the driver could not fit into its registers: the first draw of each program (that is when the driver builds it) is timed, and the driver's complaints counted around it.
    const labels = {}, lens = {}, seen = {}, srcLen = {}; let cur = 0;
    const shSrc = gl.shaderSource, attach = gl.attachShader, useP = gl.useProgram;
    gl.__label = (p, n) => { labels[p.id !== undefined ? p.id : p] = n; };
    gl.shaderSource = (s, src) => { srcLen[s.id] = src.length; return shSrc(s, src); };
    gl.attachShader = (p, s) => { (lens[p.id] ||= []).push(srcLen[s.id] || 0); return attach(p, s); };
    gl.useProgram = (p) => { cur = p ? p.id : 0; return useP(p); };
    G.__shaderReport = [];
    for (const k of ['drawArrays', 'drawArraysInstanced']) {
      const f = gl[k];
      gl[k] = (...a) => {
        if (seen[cur] || !cur) return f(...a);
        seen[cur] = 1;
        const before = call('regFails'), t = __now(); const r = f(...a); call('finish');
        const ms = Math.round(__now() - t); const t2 = __now(); while (__now() - t2 < 40) { /* the driver's messages come through a pipe: give them a moment */ }
        const n = call('regFails') - before;
        const line = '[shader] ' + (labels[cur] || 'program ' + cur) + ' (' + (lens[cur] || []).join('+') + ' chars): first draw ' + ms + ' ms' + (n ? ', THE DRIVER COULD NOT FIT IT INTO ITS REGISTERS (' + n + (n > 1 ? ' times' : ' time') + ')' : '');
        G.__shaderReport.push(line); __print(line);
        return r;
      };
    }
  }
  return gl;
}

// a canvas whose script object is gone gives its pixels back (a clock that runs for years makes a few canvases a minute)
const canvasRegistry = new FinalizationRegistry((id) => __c2d_free(id));
class Canvas {
  constructor() { this._w = 300; this._h = 150; this._id = -1; this.clientWidth = 300; this.clientHeight = 150; this.style = {}; }
  _ensure() { if (this._id < 0) { this._id = __c2d_new(this._w, this._h); canvasRegistry.register(this, this._id); } }
  get width() { return this._w; } get height() { return this._h; }
  set width(v) { this._w = v | 0; if (this._id >= 0) __c2d_resize(this._id, this._w, this._h); }
  set height(v) { this._h = v | 0; if (this._id >= 0) __c2d_resize(this._id, this._w, this._h); }
  getContext(type) {
    if (type === 'webgl2') return (this._gl ||= makeGL(this));
    if (type === '2d') return (this._2d ||= new Ctx2D(this));
    return null;
  }
  toDataURL() { return 'data:,'; }
}
G.HTMLCanvasElement = Canvas;

// ---- the vendored astronomy library, as the page has it ------------------------------------------------------------
{ const mod = { exports: {} }; new Function('module', 'exports', __readtext(__root + '/js/vendor/astronomy.browser.min.js'))(mod, mod.exports); G.Astronomy = mod.exports; }
