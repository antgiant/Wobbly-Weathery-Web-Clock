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

out('');
out('=== summary (copy everything above, plus these lines) ===');
out('SUMMARY ' + JSON.stringify(results));
out('=== done ===');
__done();
