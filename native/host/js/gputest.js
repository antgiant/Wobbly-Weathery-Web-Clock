// wobbly-clock-run --gpu-test: what can this GPU do for the clock, on the OpenGL ES 2 path (the Raspberry Pi Zero, 1 and 3 have only that)?
// It answers, with numbers: what the driver offers, which render targets work, how big a shader it accepts, how fast it draws, whether bright
// colours survive being packed into 8 bits, whether the engine's real shaders get through a mechanical translation, and what instancing and
// vertex arrays are available. Everything is printed as it happens; send all of it back.

const g = (n, ...a) => __gl(n, ...a);
const out = (s = '') => __print(s);
const t = () => __now();
const GL = { VERSION: 0x1F02, RENDERER: 0x1F01, VENDOR: 0x1F00, EXTENSIONS: 0x1F03, SL_VERSION: 0x8B8C, FRAGMENT: 0x8B30, VERTEX: 0x8B31, COMPILE: 0x8B81, LINK: 0x8B82, TEX2D: 0xDE1, RGBA: 0x1908, UBYTE: 0x1401, FLOAT: 0x1406, HALF: 0x8D61, FB: 0x8D40, COLOR0: 0x8CE0, COMPLETE: 0x8CD5, ARRAY: 0x8892, STATIC: 0x88E4, TRI: 4, NEAREST: 0x2600, LINEAR: 0x2601, MINF: 0x2801, MAGF: 0x2800, WS: 0x2802, WT: 0x2803, CLAMP: 0x812F };
const status = { 0x8CD5: 'complete', 0x8CD6: 'incomplete attachment', 0x8CD7: 'missing attachment', 0x8CD9: 'incomplete dimensions', 0x8CDD: 'unsupported' };
const fmt = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : ms.toFixed(1) + ' ms');
const results = {};

out('=== wobbly-clock GPU test ===');
const ver = String(g('getString', GL.VERSION)), rend = String(g('getString', GL.RENDERER)), vend = String(g('getString', GL.VENDOR));
const exts = String(g('getString', GL.EXTENSIONS)).split(/\s+/).filter(Boolean);
out('GL_VERSION:  ' + ver); out('GL_RENDERER: ' + rend); out('GL_VENDOR:   ' + vend);
out('GLSL:        ' + String(g('getString', GL.SL_VERSION)));
results.renderer = rend; results.version = ver;
if (/llvmpipe|softpipe|swrast/i.test(rend)) {
  out('');
  out('!!! THIS IS THE CPU RENDERER, NOT THE GPU. The numbers below say nothing about the Pi\'s GPU. Usually the GPU driver is not switched on or not allowed:');
  out('!!!   1. In /boot/config.txt (or /boot/firmware/config.txt) there must be a line   dtoverlay=vc4-kms-v3d   (then reboot);');
  out('!!!   2. look at   ls -l /dev/dri   (there should be card0 and renderD128), and try again with   sudo wobbly-clock-run --gpu-test;');
  out('!!!   3. send me those two things as well.');
}
const has = (e) => exts.includes(e) || exts.includes('GL_' + e);
out('');
out('--- limits ---');
const lim = (name, p) => { const v = g('getIntegerv', p, 1); out(name.padEnd(34) + v); return +v; };
lim('MAX_TEXTURE_SIZE', 0x0D33); lim('MAX_RENDERBUFFER_SIZE', 0x84E8); lim('MAX_TEXTURE_IMAGE_UNITS', 0x8872);
lim('MAX_VERTEX_ATTRIBS', 0x8869); lim('MAX_VARYING_VECTORS', 0x8DFC); lim('MAX_VERTEX_UNIFORM_VECTORS', 0x8DFB); lim('MAX_FRAGMENT_UNIFORM_VECTORS', 0x8DFD);
for (const [n, p] of [['highp float', 0x8DF2], ['mediump float', 0x8DF1], ['highp int', 0x8DF5], ['mediump int', 0x8DF4]]) out(('fragment ' + n + ' (range min,max, precision bits)').padEnd(56) + g('getShaderPrecisionFormat', GL.FRAGMENT, p));
out('');
out('--- extensions that matter ---');
const want = ['OES_texture_float', 'OES_texture_half_float', 'OES_texture_float_linear', 'OES_texture_half_float_linear', 'EXT_color_buffer_half_float', 'WEBGL_color_buffer_float', 'EXT_color_buffer_float',
  'EXT_shader_texture_lod', 'OES_standard_derivatives', 'EXT_instanced_arrays', 'ANGLE_instanced_arrays', 'OES_vertex_array_object', 'EXT_frag_depth', 'OES_element_index_uint', 'EXT_blend_minmax', 'OES_depth_texture', 'EXT_texture_filter_anisotropic', 'OES_fbo_render_mipmap', 'EXT_draw_buffers', 'OES_rgb8_rgba8', 'OES_packed_depth_stencil', 'OES_texture_npot'];
for (const e of want) out(e.padEnd(34) + (has(e) ? 'yes' : 'NO'));
results.ext = Object.fromEntries(want.map((e) => [e, has(e)]));
out('(all ' + exts.length + ' extensions: ' + exts.join(' ') + ')');

// ---- helpers ----
let quad;
function setup() { quad = g('createBuffer'); g('bindBuffer', GL.ARRAY, quad); g('bufferData', GL.ARRAY, new Float32Array([-1, -1, 3, -1, -1, 3]).buffer, GL.STATIC); }
const VS = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
function program(fs, vs = VS) {
  const t0 = t(); const log = [];
  const mk = (type, src) => { const s = g('createShader', type); g('shaderSource', s, src); g('compileShader', s); const ok = g('getShaderParameter', s, GL.COMPILE) !== 0; if (!ok) log.push(String(g('getShaderInfoLog', s))); return { s, ok }; };
  const v = mk(GL.VERTEX, vs), f = mk(GL.FRAGMENT, fs);
  if (!v.ok || !f.ok) return { ok: false, log: log.join('\n'), ms: t() - t0 };
  const p = g('createProgram'); g('attachShader', p, v.s); g('attachShader', p, f.s); g('bindAttribLocation', p, 0, 'aPos'); g('linkProgram', p);
  const ok = g('getProgramParameter', p, GL.LINK) !== 0;
  return { ok, p, log: ok ? '' : String(g('getProgramInfoLog', p)), ms: t() - t0 };
}
function target(w, h, type = GL.UBYTE, filter = GL.NEAREST) {
  const tex = g('createTexture'); g('bindTexture', GL.TEX2D, tex); g('texImage2D', GL.TEX2D, 0, GL.RGBA, w, h, 0, GL.RGBA, type, null);
  for (const [k, v] of [[GL.MINF, filter], [GL.MAGF, filter], [GL.WS, GL.CLAMP], [GL.WT, GL.CLAMP]]) g('texParameteri', GL.TEX2D, k, v);
  const fbo = g('createFramebuffer'); g('bindFramebuffer', GL.FB, fbo); g('framebufferTexture2D', GL.FB, GL.COLOR0, GL.TEX2D, tex, 0);
  const st = g('checkFramebufferStatus', GL.FB);
  return { tex, fbo, w, h, st, ok: st === GL.COMPLETE };
}
function draw(p, tg) { g('bindFramebuffer', GL.FB, tg.fbo); g('viewport', 0, 0, tg.w, tg.h); g('useProgram', p); g('bindBuffer', GL.ARRAY, quad); g('enableVertexAttribArray', 0); g('vertexAttribPointer', 0, 2, GL.FLOAT, 0, 0, 0); g('drawArrays', GL.TRI, 0, 3); }
const first = (s, n = 3) => String(s).split('\n').filter((l) => /error/i.test(l)).slice(0, n).join('\n      ');
setup();

// ---- render targets ----
out('');
out('--- render targets (can a draw go into this kind of texture?) ---');
for (const [name, type, ext] of [['RGBA 8-bit', GL.UBYTE, true], ['RGBA half float', GL.HALF, has('OES_texture_half_float')], ['RGBA float', GL.FLOAT, has('OES_texture_float')]]) {
  if (!ext) { out(name.padEnd(22) + 'texture type not offered by the driver'); results['rt ' + name] = 'not offered'; continue; }
  const tg = target(16, 16, type); const err = g('getError');
  out(name.padEnd(22) + (status[tg.st] || tg.st) + (err ? ' (GL error 0x' + err.toString(16) + ')' : ''));
  results['rt ' + name] = tg.ok;
}

// ---- how big a shader will it accept? ----
out('');
out('--- shader size limits (constant-bound loops, as OpenGL ES 2 requires) ---');
const alu = (n) => `precision highp float; varying vec2 vUv; void main(){ float a = vUv.x, b = vUv.y, s = 0.0; for (int i = 0; i < ${n}; i++) { float f = float(i); a = a * 0.97 + sin(b * 3.1 + f) * 0.1; b = b * 0.95 + exp(-a * a) * 0.2; s += a * b; } gl_FragColor = vec4(fract(s), a, b, 1.0); }`;
const texf = (n) => `precision highp float; varying vec2 vUv; uniform sampler2D uTex; void main(){ vec4 c = vec4(0.0); vec2 p = vUv; for (int i = 0; i < ${n}; i++) { c += texture2D(uTex, fract(p + c.rg * 0.1)); p += vec2(0.013, 0.007); } gl_FragColor = c / ${n}.0; }`;
const aluProgs = {};
for (const n of [8, 16, 32, 64, 128, 256, 512]) {
  const r = program(alu(n)); out(('ALU loop x' + n).padEnd(22) + (r.ok ? 'compiles in ' + fmt(r.ms) : 'FAILS: ' + first(r.log, 2))); results['alu ' + n] = r.ok; if (r.ok) aluProgs[n] = r.p;
}
const texProgs = {};
for (const n of [4, 16, 32, 64, 128]) {
  const r = program(texf(n)); out(('texture reads x' + n).padEnd(22) + (r.ok ? 'compiles in ' + fmt(r.ms) : 'FAILS: ' + first(r.log, 2))); results['tex ' + n] = r.ok; if (r.ok) texProgs[n] = r.p;
}

// ---- speed ----
out('');
out('--- speed (a full-screen pass into an 8-bit texture, glFinish after each; per pass) ---');
function time(p, tg, runs = 4) { draw(p, tg); g('finish'); const t0 = t(); for (let i = 0; i < runs; i++) { draw(p, tg); g('finish'); } return (t() - t0) / runs; }
const small = target(128, 72), big = target(512, 288), lutSize = target(256, 192);
const tex = target(64, 64); g('bindFramebuffer', GL.FB, 0);
const noise = new Uint8Array(64 * 64 * 4); for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761 >>> 24) & 255;
g('bindTexture', GL.TEX2D, tex.tex); g('texImage2D', GL.TEX2D, 0, GL.RGBA, 64, 64, 0, GL.RGBA, GL.UBYTE, noise.buffer);
for (const [n, p] of Object.entries(aluProgs)) {
  if (+n > 128) continue;
  const a = time(p, small), b = time(p, big);
  out(('ALU loop x' + n).padEnd(22) + '128x72: ' + fmt(a).padStart(10) + '   512x288: ' + fmt(b).padStart(10) + '   = ' + (512 * 288 / 1e6 / (b / 1000)).toFixed(2) + ' Mpixel/s');
  results['alu speed ' + n] = { small: a, big: b };
}
for (const [n, p] of Object.entries(texProgs)) {
  if (+n > 64) continue;
  g('bindTexture', GL.TEX2D, tex.tex); g('useProgram', p); g('uniform1i', g('getUniformLocation', p, 'uTex'), 0);
  const a = time(p, small), b = time(p, big);
  out(('texture reads x' + n).padEnd(22) + '128x72: ' + fmt(a).padStart(10) + '   512x288: ' + fmt(b).padStart(10));
  results['tex speed ' + n] = { small: a, big: b };
}
{ const t0 = t(); g('bindFramebuffer', GL.FB, big.fbo); const px = g('readPixels', 0, 0, 512, 288, GL.RGBA, GL.UBYTE); out('readPixels 512x288'.padEnd(22) + fmt(t() - t0)); }
{ const d = new Uint8Array(256 * 192 * 4); const t0 = t(); g('bindTexture', GL.TEX2D, lutSize.tex); g('texImage2D', GL.TEX2D, 0, GL.RGBA, 256, 192, 0, GL.RGBA, GL.UBYTE, d.buffer); g('finish'); out('upload 256x192 texture'.padEnd(22) + fmt(t() - t0)); }
{ const p = aluProgs[8]; draw(p, small); g('finish'); const t0 = t(); for (let i = 0; i < 100; i++) draw(p, small); g('finish'); out('100 tiny draw calls'.padEnd(22) + fmt(t() - t0)); }

// ---- packing bright colours into 8 bits ----
out('');
out('--- packing brightness into an 8-bit RGBA texture (what the Pi needs, since float targets are missing) ---');
for (const prec of ['highp', 'mediump']) {
  const fs = `precision ${prec} float; varying vec2 vUv; void main(){ float v = pow(10.0, -4.0 + 8.0 * vUv.x); float l = (log2(v) + 13.4) / 26.8; float x = clamp(l, 0.0, 1.0) * 16777215.0; float r = floor(x / 65536.0); float gch = floor((x - r * 65536.0) / 256.0); float b = x - r * 65536.0 - gch * 256.0; gl_FragColor = vec4(r / 255.0, gch / 255.0, floor(b) / 255.0, 1.0); }`;
  const r = program(fs); if (!r.ok) { out(prec.padEnd(8) + 'does not compile: ' + first(r.log)); continue; }
  const w = 256, tg = target(w, 1); draw(r.p, tg); g('finish'); const px = new Uint8Array(g('readPixels', 0, 0, w, 1, GL.RGBA, GL.UBYTE));
  let max = 0, sum = 0;
  for (let i = 0; i < w; i++) { const v = Math.pow(10, -4 + 8 * ((i + 0.5) / w)); const x = px[i * 4] * 65536 + px[i * 4 + 1] * 256 + px[i * 4 + 2]; const d = Math.pow(2, (x / 16777215) * 26.8 - 13.4); const e = Math.abs(d - v) / v; max = Math.max(max, e); sum += e; }
  out(prec.padEnd(8) + 'values from 0.0001 to 10000, round trip relative error: mean ' + (100 * sum / w).toFixed(3) + ' %, worst ' + (100 * max).toFixed(3) + ' %'); results['pack ' + prec] = { mean: sum / w, worst: max };
}

// ---- the engine's own shaders, in the ES 2 form the program uses on this kind of GPU (js/sky/portable.js), compiled AND linked here ----
out('');
out('--- the engine\'s real shaders: the OpenGL ES 2 form (GLSL ES 1.00), compiled and linked by this driver ---');
{
  const A = await import('js/sky/glsl-atmosphere.js'), S = await import('js/sky/glsl-scene.js'), P = await import('js/sky/glsl-plants.js'), M = await import('js/sky/glsl-mask.js');
  const { toES1 } = await import('js/sky/portable.js');
  const pairs = [
    ['transmittance', A.VERT_FULLSCREEN, A.FRAG_TRANSMITTANCE], ['multiscatter', A.VERT_FULLSCREEN, A.FRAG_MULTISCATTER], ['skyview', A.VERT_FULLSCREEN, A.FRAG_SKYVIEW],
    ['noise (mips)', S.VERT_FULLSCREEN, S.FRAG_NOISE_DOWN], ['mip atlas', S.VERT_FULLSCREEN, S.FRAG_ATLAS_PLACE], ['exposure', S.VERT_FULLSCREEN, S.FRAG_ADAPT],
    ['scene (sky, ground, clouds)', S.VERT_FULLSCREEN, S.FRAG_SCENE], ['glass and final picture', S.VERT_FULLSCREEN, S.FRAG_BLIT],
    ['stars', S.VERT_STARS, S.FRAG_STARS], ['plants', P.VERT_PLANTS, P.FRAG_PLANTS],
    ['LED panel', S.VERT_FULLSCREEN, S.FRAG_LED], ['LED stars', S.VERT_FULLSCREEN, S.FRAG_LED_PEAK], ['LED averages', S.VERT_FULLSCREEN, S.FRAG_LED_AVG],
    ['glass strokes', M.VERT_STROKE, M.FRAG_STROKE], ['glass lights', M.VERT_LIGHT, M.FRAG_LIGHT], ['raindrops', M.VERT_DROP, M.FRAG_DROP], ['rain trails', M.VERT_TRAIL, M.FRAG_TRAIL],
  ];
  let failed = 0; const real = {};
  for (const [name, vs, fs] of pairs) {
    const t0 = t();
    const sh = (type, src) => { const x = g('createShader', type); g('shaderSource', x, src); g('compileShader', x); return { x, ok: g('getShaderParameter', x, GL.COMPILE) !== 0 }; };
    const v = sh(GL.VERTEX, toES1(vs, 'vertex').src), f = sh(GL.FRAGMENT, toES1(fs, 'fragment').src);
    let ok = v.ok && f.ok, why = '';
    if (!v.ok) why += ' vertex: ' + first(String(g('getShaderInfoLog', v.x)), 2);
    if (!f.ok) why += ' fragment: ' + first(String(g('getShaderInfoLog', f.x)), 2);
    if (ok) { const pr = g('createProgram'); g('attachShader', pr, v.x); g('attachShader', pr, f.x); g('linkProgram', pr); ok = g('getProgramParameter', pr, GL.LINK) !== 0; if (!ok) why = ' link: ' + first(String(g('getProgramInfoLog', pr)), 2); }
    out(name.padEnd(30) + (ok ? 'OK (' + fmt(t() - t0) + ')' : 'FAILS' + why.slice(0, 400)));
    real[name] = ok; if (!ok) failed++;
  }
  out(failed ? failed + ' of ' + pairs.length + ' shaders do not build on this GPU: send this whole output' : 'all ' + pairs.length + ' shaders build on this GPU');
  results.engineShaders = real;
  lim('MAX_VERTEX_TEXTURE_IMAGE_UNITS (stars and plants read the sky tables in their vertex shaders)', 0x8B4C);
}

out('');
out('--- instancing and vertex arrays (the plants, and the engine\'s vertex-array use) ---');
out('EXT_instanced_arrays / ANGLE_instanced_arrays: ' + (has('EXT_instanced_arrays') || has('ANGLE_instanced_arrays') ? 'yes' : 'NO (the driver lists no such extension; its function names exist but are empty stubs)'));
out('OES_vertex_array_object: ' + (has('OES_vertex_array_object') ? 'yes' : 'NO'));

// ---- do the ES 2 helpers compute what they should on this GPU, and where does the engine's picture go wrong? ----
out('');
out('--- the ES 2 helpers, on this GPU, against the same numbers worked out here ---');
try {
  const { PORTABLE, toES1, packSkyline } = await import('js/sky/portable.js');
  const { VERT_FULLSCREEN } = await import('js/sky/glsl-atmosphere.js');
  const FS = `#version 300 es
precision highp float;
${PORTABLE}
uniform vec3 uIn; uniform sampler2D uTex; uniform vec2 uPx; uniform float uMode;
in vec2 vUv;
out vec4 oColor;
vec4 enc16(float v) { float q = floor(clamp(v, 0.0, 1.0) * 65535.0 + 0.5); float h = floor(q / 256.0); return vec4(h, q - h * 256.0, 0.0, 0.0) / 255.0; }
void main() {
  if (uMode < 0.5) oColor = hdrPack(uIn);
  else if (uMode < 1.5) oColor = hdrPack(hdrTex(uTex, vUv, uPx));
  else { vec3 s = skylineAt(uTex, vUv.x); vec4 a = enc16((s.r + 1.5) / 4.0), b = enc16((s.g + 1.5) / 4.0); oColor = vec4(a.x, a.y, b.x, b.y); }
}`;
  const mkS = (type, src) => { const x = g('createShader', type); g('shaderSource', x, src); g('compileShader', x); if (g('getShaderParameter', x, GL.COMPILE) === 0) throw new Error(String(g('getShaderInfoLog', x))); return x; };
  const pr = g('createProgram'); g('attachShader', pr, mkS(GL.VERTEX, toES1(VERT_FULLSCREEN, 'vertex').src)); g('attachShader', pr, mkS(GL.FRAGMENT, toES1(FS, 'fragment').src));
  g('bindAttribLocation', pr, 0, 'aVid'); g('linkProgram', pr); g('useProgram', pr);
  const vbuf = g('createBuffer'); g('bindBuffer', 0x8892, vbuf); g('bufferData', 0x8892, new Float32Array([0, 1, 2]).buffer, 0x88E4);
  const vao = g('createVertexArray'); g('bindVertexArray', vao); g('enableVertexAttribArray', 0); g('vertexAttribPointer', 0, 1, 0x1406, 0, 0, 0);
  const U = (n) => g('getUniformLocation', pr, n);
  const fb = g('createFramebuffer'), ot = g('createTexture');
  const run = (w, mode, setup) => {                                            // draws a w x 1 picture, returns its bytes
    g('activeTexture', 0x84C1);                                                // (unit 1 for the picture being drawn, unit 0 for the texture being read)
    g('bindTexture', GL.TEX2D, ot); g('texImage2D', GL.TEX2D, 0, GL.RGBA, w, 1, 0, GL.RGBA, GL.UBYTE, null); g('texParameteri', GL.TEX2D, 0x2801, 0x2600); g('texParameteri', GL.TEX2D, 0x2800, 0x2600);
    g('bindFramebuffer', 0x8D40, fb); g('framebufferTexture2D', 0x8D40, 0x8CE0, GL.TEX2D, ot, 0); g('viewport', 0, 0, w, 1);
    g('uniform1f', U('uMode'), mode); if (setup) setup();
    g('activeTexture', 0x84C0);
    g('drawArrays', 4, 0, 3); return new Uint8Array(g('readPixels', 0, 0, w, 1, GL.RGBA, GL.UBYTE));
  };
  // the same packing in doubles
  const LO = -30, HI = 6;
  const pack = (c) => { const S = c[0] + c[1] + c[2], l = Math.min(1, Math.max(0, (Math.log2(Math.max(S, 1e-12)) - LO) / (HI - LO))), L = Math.round(l * 4095), P = Math.round(c[0] / S * 1023), Q = Math.round(c[2] / S * 1023);
    const A = Math.floor(L / 16), Ph = Math.floor(P / 64), Qh = Math.floor(Q / 256); return [Q - Qh * 256, (P - Ph * 64) * 4 + Qh, (L - A * 16) * 16 + Ph, A]; };
  const unpack = (b) => { const Bh = Math.floor(b[2] / 16), Gh = Math.floor(b[1] / 4), L = b[3] * 16 + Bh, P = (b[2] - Bh * 16) * 64 + Gh, Q = (b[1] - Gh * 4) * 256 + b[0], S = 2 ** (LO + (HI - LO) * L / 4095), p = P / 1023, q = Q / 1023; return [S * p, S * Math.max(1 - p - q, 0), S * q]; };
  let bad = 0;
  for (const c of [[0.0453, 0.0954, 0.233], [0.863, 0.664, 0.784], [3.1e-4, 8e-4, 1.2e-3], [1.2, 0.4, 0.05], [2e-7, 3e-7, 5e-7]]) {
    const got = run(1, 0, () => g('uniform3f', U('uIn'), c[0], c[1], c[2])), want = pack(c);
    const dec = unpack(Array.from(got)), err = Math.max(...dec.map((v, i) => Math.abs(v - c[i]) / c[i]));
    const ok = err < 0.02; if (!ok) bad++;
    out('hdrPack ' + c.join(' ') + ' -> bytes ' + Array.from(got).join(',') + ' (here: ' + want.join(',') + '), decoded back within ' + (err * 100).toFixed(2) + ' % ' + (ok ? 'OK' : 'WRONG'));
  }
  // hdrTex: a 4 x 1 texture of packed colours, read between texels
  const vals = [[0.01, 0.02, 0.05], [0.04, 0.09, 0.2], [0.8, 0.6, 0.7], [0.1, 0.1, 0.1]];
  const tb = new Uint8Array(16); vals.forEach((c, i) => tb.set(pack(c), i * 4));
  const tt = g('createTexture'); g('activeTexture', 0x84C0); g('bindTexture', GL.TEX2D, tt); g('texImage2D', GL.TEX2D, 0, GL.RGBA, 4, 1, 0, GL.RGBA, GL.UBYTE, tb.buffer);
  for (const p of [0x2801, 0x2800]) g('texParameteri', GL.TEX2D, p, 0x2600); g('texParameteri', GL.TEX2D, 0x2802, 0x812F); g('texParameteri', GL.TEX2D, 0x2803, 0x812F);
  const got = run(8, 1, () => { g('uniform1i', U('uTex'), 0); g('uniform2f', U('uPx'), 4, 1); });
  let worst = 0;
  for (let i = 0; i < 8; i++) {                                                // pixel i reads at u = (i + 0.5) / 8
    const x = (i + 0.5) / 8 * 4 - 0.5, fl = Math.floor(x), i0 = Math.min(3, Math.max(0, fl)), i1 = Math.min(3, Math.max(0, fl + 1)), f = x - fl;
    const want = vals[i0].map((v, k) => v + (vals[i1][k] - v) * f), dec = unpack(Array.from(got.slice(i * 4, i * 4 + 4)));
    worst = Math.max(worst, ...dec.map((v, k) => Math.abs(v - want[k]) / want[k]));
    if (i < 3) out('  hdrTex at u=' + ((i + 0.5) / 8).toFixed(4) + ' = ' + dec.map((v) => v.toPrecision(3)).join(' ') + ' (here: ' + want.map((v) => v.toPrecision(3)).join(' ') + ')');
  }
  if (worst > 0.03) bad++;
  out('hdrTex (the hand-made bilinear read) at 8 positions: worst error ' + (worst * 100).toFixed(2) + ' % ' + (worst > 0.03 ? 'WRONG' : 'OK'));
  // skylineAt: a ramp of 2048 bins
  const N = 2048, sk = new Float32Array(N * 4); for (let i = 0; i < N; i++) { sk[i * 4] = -0.001 + 0.3 * i / N; sk[i * 4 + 1] = 0.05 + 0.2 * i / N; sk[i * 4 + 2] = 0.1; }
  const st = g('createTexture'); g('bindTexture', GL.TEX2D, st); g('texImage2D', GL.TEX2D, 0, GL.RGBA, N, 2, 0, GL.RGBA, GL.UBYTE, packSkyline(sk, N).buffer);
  for (const p of [0x2801, 0x2800]) g('texParameteri', GL.TEX2D, p, 0x2600); g('texParameteri', GL.TEX2D, 0x2802, 0x812F); g('texParameteri', GL.TEX2D, 0x2803, 0x812F);
  const gs = run(8, 2, () => g('uniform1i', U('uTex'), 0));
  let sw = 0;
  for (let i = 0; i < 8; i++) {
    const u = (i + 0.5) / 8, x = u * N - 0.5, a = Math.floor(x), f = x - a, ia = (a + N) % N, ib = (a + 1 + N) % N;
    const wantR = sk[ia * 4] + (sk[ib * 4] - sk[ia * 4]) * f, gotR = ((gs[i * 4] * 256 + gs[i * 4 + 1]) / 65535) * 4 - 1.5;
    sw = Math.max(sw, Math.abs(gotR - wantR));
    if (i < 3) out('  skylineAt(' + u.toFixed(4) + ').r = ' + gotR.toFixed(4) + ' (here: ' + wantR.toFixed(4) + ')');
  }
  if (sw > 0.002) bad++;
  out('skylineAt (the two-row ridge heights): worst error ' + sw.toFixed(5) + ' rad ' + (sw > 0.002 ? 'WRONG' : 'OK'));
  out(bad ? bad + ' helper checks are WRONG on this GPU' : 'the helpers agree with the numbers worked out here');
  results.helpersWrong = bad;
} catch (e) { out('helper check failed: ' + (e && e.message || e)); }

out('');
out('--- the engine on this GPU, step by step (the first scene takes minutes: the driver compiles the big shader) ---');
try {
  const { SkyEngine } = await import('js/sky/engine.js');
  const W = 96, H = 54, canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H; canvas.clientWidth = W; canvas.clientHeight = H;
  const e = new SkyEngine(canvas, { baseUrl: __root });
  out('engine path: ' + (e.es2 ? 'OpenGL ES 2 (packed tables)' : 'OpenGL ES 3'));
  while (!e.assetsDone) await new Promise((r) => setTimeout(r, 20));
  try {                                                                           // the noise atlas: read at two detail levels, against the same read worked out from data/noise.bin
    const { PORTABLE, toES1 } = await import('js/sky/portable.js'), { VERT_FULLSCREEN } = await import('js/sky/glsl-atmosphere.js');
    const FSN = `#version 300 es
precision highp float;
${PORTABLE}
uniform sampler2D uTex;
uniform float uLod;
in vec2 vUv;
out vec4 oColor;
void main() { oColor = noiseLod(uTex, vec2(vUv.x * 3.7 + 0.21, 0.37 + vUv.y * 0.1), uLod); }`;
    const mk = (type, src) => { const x = g('createShader', type); g('shaderSource', x, src); g('compileShader', x); if (g('getShaderParameter', x, GL.COMPILE) === 0) throw new Error(String(g('getShaderInfoLog', x))); return x; };
    const pn = g('createProgram'); g('attachShader', pn, mk(GL.VERTEX, toES1(VERT_FULLSCREEN, 'vertex').src)); g('attachShader', pn, mk(GL.FRAGMENT, toES1(FSN, 'fragment').src));
    g('bindAttribLocation', pn, 0, 'aVid'); g('linkProgram', pn); g('useProgram', pn);
    const vb = g('createBuffer'); g('bindBuffer', 0x8892, vb); g('bufferData', 0x8892, new Float32Array([0, 1, 2]).buffer, 0x88E4);
    const va = g('createVertexArray'); g('bindVertexArray', va); g('enableVertexAttribArray', 0); g('vertexAttribPointer', 0, 1, 0x1406, 0, 0, 0);
    const fb2 = g('createFramebuffer'), ot2 = g('createTexture');
    g('activeTexture', 0x84C1); g('bindTexture', GL.TEX2D, ot2); g('texImage2D', GL.TEX2D, 0, GL.RGBA, 8, 1, 0, GL.RGBA, GL.UBYTE, null); g('texParameteri', GL.TEX2D, 0x2801, 0x2600); g('texParameteri', GL.TEX2D, 0x2800, 0x2600);
    g('bindFramebuffer', 0x8D40, fb2); g('framebufferTexture2D', 0x8D40, 0x8CE0, GL.TEX2D, ot2, 0); g('viewport', 0, 0, 8, 1);
    g('activeTexture', 0x84C0); g('bindTexture', GL.TEX2D, e.tNoise.tex.id);
    g('uniform1i', g('getUniformLocation', pn, 'uTex'), 0);
    const file = new Uint8Array(__readfile(__root + '/data/noise.bin'));
    const lvl = (k) => { const s = 256 >> k, out = new Float64Array(s * s * 4), b = 1 << k; for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) for (let c = 0; c < 4; c++) { let t = 0; for (let j = 0; j < b; j++) for (let i = 0; i < b; i++) t += file[(((y * b + j) * 256) + x * b + i) * 4 + c]; out[(y * s + x) * 4 + c] = t / (b * b); } return { s, d: out }; };
    for (const k of [0, 3]) {
      g('uniform1f', g('getUniformLocation', pn, 'uLod'), k); g('drawArrays', 4, 0, 3);
      const got = new Uint8Array(g('readPixels', 0, 0, 8, 1, GL.RGBA, GL.UBYTE)), L = lvl(k); let worst = 0;
      for (let i = 0; i < 8; i++) {
        const u = ((i + 0.5) / 8) * 3.7 + 0.21, v = 0.37 + 0.05, fx = (u - Math.floor(u)) * L.s - 0.5, fy = (v - Math.floor(v)) * L.s - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0, w = (n) => ((n % L.s) + L.s) % L.s;
        if (i === 0 && k === 0) out('  noise.bin read at u=' + u.toFixed(3) + ' v=' + v.toFixed(3) + ': got ' + Array.from(got.slice(0, 4)).join(',') + ', noise.bin says ' + [0, 1, 2, 3].map((c) => file[(((Math.floor((v - Math.floor(v)) * 256)) * 256) + Math.floor((u - Math.floor(u)) * 256)) * 4 + c]).join(','));
        for (let c = 0; c < 4; c++) { const at = (x, y) => L.d[(w(y) * L.s + w(x)) * 4 + c]; const want = (at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax) * (1 - ay) + (at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax) * ay; worst = Math.max(worst, Math.abs(got[i * 4 + c] - want)); }
      }
      out('noiseLod level ' + k + ' (the mip atlas): worst difference from the same read worked out from noise.bin: ' + worst.toFixed(1) + ' of 255 ' + (worst > 6 ? 'WRONG' : 'OK'));
    }
  } catch (err) { out('noise atlas check failed: ' + (err && err.message || err)); }
  const tm = Date.parse('2026-06-21T17:00:00Z');
  const screen = () => { const gl2 = canvas.getContext('webgl2'); gl2.bindFramebuffer(gl2.FRAMEBUFFER, null); const px = new Uint8Array(W * H * 4); gl2.readPixels(0, 0, W, H, gl2.RGBA, gl2.UNSIGNED_BYTE, px); let r = 0, gg = 0, b = 0; for (let i = 0; i < px.length; i += 4) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; } const n = px.length / 4; return Math.round(r / n) + ',' + Math.round(gg / n) + ',' + Math.round(b / n); };
  for (const [name, type] of [['flat ground, clear sky', 'flat'], ['hills', 'hills']]) {
    e.setLandscapeType(type, 1);
    e.set({ sim: { base: new Date(tm), startPerf: performance.now(), scale: 0 }, weather: { cover: [0, 0, 0], precip: 0, snowfall: 0, fog: 0, visKm: 30, wind: [0, 0], cloudDark: 0, aod: 0.1, snowCover: 0 } });
    const t0 = performance.now(); e.render(tm); e.render(tm);
    out(name + ': ' + e.diagnose() + '; on screen (with glass off) ' + screen() + '   [' + ((performance.now() - t0) / 1000).toFixed(1) + ' s]');
  }
} catch (e) { out('engine check failed: ' + (e && (e.stack || e.message) || e)); }

out('');
out('=== summary (copy everything above, plus these lines) ===');
out('SUMMARY ' + JSON.stringify(results));
out('=== done ===');
__done();
