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
G.performance = { now: () => __now() - t0, mark() {}, measure() {} };

// ---- timers, pumped by the host ------------------------------------------------------------------------------------
let timers = [], tid = 1;
G.setTimeout = (fn, ms = 0, ...a) => { const id = tid++; timers.push({ id, at: __now() + ms, fn: () => fn(...a) }); return id; };
G.clearTimeout = (id) => { timers = timers.filter(t => t.id !== id); };
G.setInterval = (fn, ms) => { const id = tid++; const re = () => { timers.push({ id, at: __now() + ms, fn: () => { re(); fn(); } }); }; re(); return id; };
G.clearInterval = G.clearTimeout;
G.requestAnimationFrame = (fn) => G.setTimeout(() => fn(performance.now()), 0);
G.cancelAnimationFrame = G.clearTimeout;
G.__pump = () => { const now = __now(); const due = timers.filter(t => t.at <= now); timers = timers.filter(t => t.at > now); due.forEach(t => t.fn()); return timers.length; };

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

// ---- 2D canvas: not yet (a later step draws it with Cairo); calls are accepted and ignored ---------------------------
const noop2d = new Proxy({}, { get: (t, k) => k === 'canvas' ? undefined : (k in t ? t[k] : (...a) => (k.startsWith('create') ? { addColorStop() {} } : k === 'measureText' ? { width: 0 } : undefined)), set: (t, k, v) => { t[k] = v; return true; } });

// ---- WebGL2 over the native dispatcher -----------------------------------------------------------------------------
const C = { DEPTH_BUFFER_BIT: 0x100, COLOR_BUFFER_BIT: 0x4000, POINTS: 0, TRIANGLES: 4, ZERO: 0, ONE: 1, SRC_ALPHA: 0x302, ONE_MINUS_SRC_ALPHA: 0x303, DST_ALPHA: 0x304, BLEND: 0xBE2,
  TEXTURE_2D: 0xDE1, UNSIGNED_BYTE: 0x1401, FLOAT: 0x1406, HALF_FLOAT: 0x140B, RGBA: 0x1908, RGBA8: 0x8058, RGBA16F: 0x881A,
  NEAREST: 0x2600, LINEAR: 0x2601, LINEAR_MIPMAP_LINEAR: 0x2703, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_MIN_FILTER: 0x2801, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
  REPEAT: 0x2901, CLAMP_TO_EDGE: 0x812F, TEXTURE0: 0x84C0, ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88E4, DYNAMIC_DRAW: 0x88E8, STREAM_READ: 0x88E1,
  PIXEL_PACK_BUFFER: 0x88EB, FRAMEBUFFER: 0x8D40, READ_FRAMEBUFFER: 0x8CA8, DRAW_FRAMEBUFFER: 0x8CA9, COLOR_ATTACHMENT0: 0x8CE0, FRAMEBUFFER_COMPLETE: 0x8CD5,
  FRAGMENT_SHADER: 0x8B30, VERTEX_SHADER: 0x8B31, COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82, SYNC_GPU_COMMANDS_COMPLETE: 0x9117, TIMEOUT_EXPIRED: 0x911B,
  UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241 };
const idOf = (o) => (o ? o.id : 0);
const buf = (v) => (v && v.buffer ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v);

function makeGL(canvas) {
  const gl = Object.create(C);
  const screen = { w: 0, h: 0, fbo: 0, tex: 0 };
  const call = (n, ...a) => __gl(n, ...a);
  const ensureScreen = () => {
    if (screen.w === canvas.width && screen.h === canvas.height && screen.fbo) return;
    if (!screen.fbo) { screen.fbo = call('createFramebuffer'); screen.tex = call('createTexture'); }
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
    getExtension: (n) => (n === 'EXT_color_buffer_float' || n === 'EXT_color_buffer_half_float' || n === 'KHR_parallel_shader_compile') ? {} : null,
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
        const src = c; if (src && src._rgba) return call('texImage2D', target, level, internal, src.width, src.height, 0, a, b, src._rgba);
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
  return gl;
}

class Canvas {
  constructor() { this.width = 300; this.height = 150; this.clientWidth = 300; this.clientHeight = 150; this.style = {}; }
  getContext(type) {
    if (type === 'webgl2') return (this._gl ||= makeGL(this));
    if (type === '2d') return (this._2d ||= noop2d);
    return null;
  }
}
G.HTMLCanvasElement = Canvas;

// ---- the vendored astronomy library, as the page has it ------------------------------------------------------------
{ const mod = { exports: {} }; new Function('module', 'exports', __readtext(__root + '/js/vendor/astronomy.browser.min.js'))(mod, mod.exports); G.Astronomy = mod.exports; }
