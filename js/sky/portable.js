// One set of shaders for two kinds of GPU.
//
// The shaders are written in GLSL ES 3.00 (browsers, Pi 4 and 5). OpenGL ES 2 GPUs (Pi Zero, Zero 2, Pi 1-3: VideoCore IV) lack what that needs: float render targets,
// textureLod, texelFetch, derivatives, instancing, integers in shaders. So the engine's shaders call a few helper functions (below) for everything that differs, and
// `toES1` turns a shader into GLSL ES 1.00 where the helpers have their ES 2 versions (`#ifdef WOBBLY_ES2`). On ES 3 the helpers are the plain calls, so the picture
// there is the one it always was; on ES 2 the same maths is done with packed 8-bit textures and a few extra texture reads.
//
// What the ES 2 versions do:
//   * HDR lookup tables (transmittance, multiple scattering, sky view): 8-bit RGBA holds 12 bits of log brightness and 10 bits for each of two colour ratios;
//     reading takes the four neighbouring texels and blends them after unpacking (`hdrTex`), exactly what the hardware did with half floats.
//   * the exposure texel: 24 bits of the log adaptation luminance in three bytes.
//   * the noise texture: its mip levels are laid out one under the other in one texture (each with a one-texel wrapped border), and `noiseLod` blends two levels.
//   * the glass pass's scene and mask textures: their mip levels are separate textures (scene) or one texture with the levels stacked (mask), made by engine.js, and two
//     levels are blended in the shader. (A bias on the level the GPU picks by itself would be simpler, but that level comes from the neighbouring pixels' values, which a pixel
//     that has left the shader early does not supply: it goes wrong along the edge of what the shader skips.)
//   * the skyline: 16 bits per ridge in two rows (high bytes, low bytes), blended by hand (`skylineAt`).

import { SKYLINE_BINS } from './landscape.js';

export const NOISE_SIZE = 256;
export const NOISE_LEVELS = 9;                                  // 256 .. 1
/** Rows of the noise atlas: level k is (size k + 2) rows with a wrapped one-texel border. */
export const NOISE_ATLAS = (() => {
  const levels = []; let y = 0;
  for (let k = 0; k < NOISE_LEVELS; k++) { const s = NOISE_SIZE >> k; levels.push({ k, s, y }); y += s + 2; }
  return { w: NOISE_SIZE + 2, h: y, levels };
})();
/** Range of the packed skyline heights (radians). */
export const SKYLINE_PACK = { off: 1.5, range: 4.0 };

/** GLSL: the helpers. Included by every shader that needs one (after the float precision line). */
export const PORTABLE = `
const float HDR_LO = -30.0, HDR_HI = 6.0;
#ifdef WOBBLY_ES2
mat3 transpose(mat3 m) { return mat3(m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]); }

// ---- HDR colour in 8-bit RGBA: 12 bits log brightness, 10 + 10 bits colour ratios ----
vec4 hdrPack(vec3 c) {
  float s = c.r + c.g + c.b;
  float l = clamp((log2(max(s, 1e-12)) - HDR_LO) / (HDR_HI - HDR_LO), 0.0, 1.0);
  float L = floor(l * 4095.0 + 0.5);
  vec2 pq = s > 1e-12 ? clamp(vec2(c.r, c.b) / s, 0.0, 1.0) : vec2(0.3333, 0.3333);
  float P = floor(pq.x * 1023.0 + 0.5), Q = floor(pq.y * 1023.0 + 0.5);
  float A = floor(L / 16.0);
  float Ph = floor(P / 64.0), Qh = floor(Q / 256.0);
  float B = (L - A * 16.0) * 16.0 + Ph;
  float G = (P - Ph * 64.0) * 4.0 + Qh;
  float R = Q - Qh * 256.0;
  return vec4(R, G, B, A) / 255.0;
}
vec3 hdrDecode(vec4 t) {
  vec4 b = floor(t * 255.0 + 0.5);
  float Bh = floor(b.z / 16.0), Gh = floor(b.y / 4.0);
  float L = b.w * 16.0 + Bh;
  float P = (b.z - Bh * 16.0) * 64.0 + Gh;
  float Q = (b.y - Gh * 4.0) * 256.0 + b.x;
  float s = exp2(HDR_LO + (HDR_HI - HDR_LO) * L / 4095.0);
  float p = P / 1023.0, q = Q / 1023.0;
  return s * vec3(p, max(1.0 - p - q, 0.0), q);
}
vec3 hdrRaw(vec4 t) {                                                    // the three numbers inside a packed texel: log brightness (12 bits), the two colour ratios (10 bits each)
  vec4 b = floor(t * 255.0 + 0.5);
  float Bh = floor(b.z / 16.0), Gh = floor(b.y / 4.0);
  return vec3(b.w * 16.0 + Bh, (b.z - Bh * 16.0) * 64.0 + Gh, (b.y - Gh * 4.0) * 256.0 + b.x);
}
// The four neighbouring texels are blended as those numbers (brightness in the log, a geometric blend) and unpacked once: a quarter of the arithmetic of unpacking each.
vec3 hdrTex(sampler2D s, vec2 uv, vec2 px) {
  vec2 p = uv * px - 0.5;
  vec2 i = floor(p), f = p - i;
  vec2 lo = clamp(i, vec2(0.0), px - 1.0), hi = clamp(i + 1.0, vec2(0.0), px - 1.0);
  vec3 a = hdrRaw(texture(s, (lo + 0.5) / px));
  vec3 b = hdrRaw(texture(s, (vec2(hi.x, lo.y) + 0.5) / px));
  vec3 c = hdrRaw(texture(s, (vec2(lo.x, hi.y) + 0.5) / px));
  vec3 d = hdrRaw(texture(s, (hi + 0.5) / px));
  vec3 m = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  float S = exp2(HDR_LO + (HDR_HI - HDR_LO) * m.x / 4095.0), pp = m.y / 1023.0, qq = m.z / 1023.0;
  return S * vec3(pp, max(1.0 - pp - qq, 0.0), qq);
}
// ---- the exposure: one texel, the log adaptation luminance in three bytes ----
vec4 adaptPack(float a, float target) {
  float q = floor((clamp(a, -32.0, 31.99) + 32.0) / 64.0 * 16777215.0 + 0.5);
  float r = floor(q / 65536.0), g = floor((q - r * 65536.0) / 256.0);
  return vec4(r, g, q - r * 65536.0 - g * 256.0, 255.0) / 255.0;
}
float adaptLog(sampler2D s) {
  vec4 b = floor(texture(s, vec2(0.5)) * 255.0 + 0.5);
  return (b.x * 65536.0 + b.y * 256.0 + b.z) / 16777215.0 * 64.0 - 32.0;
}
// ---- the noise: its mip levels in one texture ----
vec2 noiseLevel(float k) {                                              // size and first row of level k: closed forms, rounded (exp2 on a small GPU is not exact)
  float e = exp2(-k);
  return vec2(floor(256.0 * e + 0.5), floor(512.0 * (1.0 - e) + 2.0 * k + 0.5));
}
vec4 noiseTap(sampler2D s, vec2 uv, float k) {
  vec2 lv = noiseLevel(k);
  vec2 p = vec2(1.0 + fract(uv.x) * lv.x, lv.y + 1.0 + fract(uv.y) * lv.x);
  return texture(s, p / vec2(${NOISE_ATLAS.w}.0, ${NOISE_ATLAS.h}.0));
}
vec4 noiseLod(sampler2D s, vec2 uv, float lod) {
  lod = clamp(lod, 0.0, ${NOISE_LEVELS - 1}.0);
  float l0 = floor(lod);
  return mix(noiseTap(s, uv, l0), noiseTap(s, uv, min(l0 + 1.0, ${NOISE_LEVELS - 1}.0)), lod - l0);
}
// ---- the skyline: 16 bits per ridge in two rows ----
const float SKY_N = ${SKYLINE_BINS}.0;
vec3 skylineTexel(sampler2D s, float i) {
  float x = (i + 0.5) / SKY_N;
  vec3 hi = floor(texture(s, vec2(x, 0.25)).rgb * 255.0 + 0.5), lo = floor(texture(s, vec2(x, 0.75)).rgb * 255.0 + 0.5);
  return (hi * 256.0 + lo) / 65535.0 * ${SKYLINE_PACK.range.toFixed(1)} - ${SKYLINE_PACK.off.toFixed(1)};
}
vec3 skylineAt(sampler2D s, float u) {
  float x = fract(u) * SKY_N - 0.5;
  float i = floor(x), f = x - i;
  float a = mod(i + SKY_N, SKY_N), b = mod(i + 1.0 + SKY_N, SKY_N);
  return mix(skylineTexel(s, a), skylineTexel(s, b), f);
}
// ---- a whole texel by its position (the texture is NEAREST filtered and has no mip levels) ----
vec4 texel(sampler2D s, vec2 ij, vec2 size) { return texture(s, (floor(ij) + 0.5) / size); }
vec3 hdrFetch(sampler2D s, vec2 uv) { return hdrDecode(texture(s, uv)); }                    // one packed texel, not blended (the texture is NEAREST filtered)
vec4 texel0(sampler2D s, vec2 ij, vec2 size, float rho) { return texture(s, (floor(ij) + 0.5) / size); }       // (the texture has no mip levels here, so no level is chosen)
#else
vec4 hdrPack(vec3 c) { return vec4(c, 1.0); }
vec3 hdrFetch(sampler2D s, vec2 uv) { return texture(s, uv).rgb; }
vec3 hdrTex(sampler2D s, vec2 uv, vec2 px) { return texture(s, uv).rgb; }
vec4 adaptPack(float a, float target) { return vec4(a, target, 0.0, 1.0); }
float adaptLog(sampler2D s) { return texelFetch(s, ivec2(0), 0).r; }
vec4 noiseLod(sampler2D s, vec2 uv, float lod) { return textureLod(s, uv, lod); }
vec3 skylineAt(sampler2D s, float u) { return texture(s, vec2(u, 0.5)).rgb; }
vec4 texel(sampler2D s, vec2 ij, vec2 size) { return texelFetch(s, ivec2(ij), 0); }
vec4 texel0(sampler2D s, vec2 ij, vec2 size, float rho) { return texelFetch(s, ivec2(ij), 0); }
#endif
`;

/**
 * GLSL: reading a texture at a chosen detail level where the shader cannot (OpenGL ES 2). `name` is 'mask' or 'scene', `base` the level-0 sampler.
 * On ES 3 the texture's own mip chain: the "level" is just a float. On ES 2 level 0 is `base` and levels 1 to 7 are stacked in one texture, `u<Name>Mips`, each with a border of
 * its own edge texels (engine.js `_mipAtlas`); `u<Name>LvK` = width, height, first row of level K. A level (two neighbouring ones and a weight) is worked out ONCE for a
 * given detail (`<name>Lv(lod)`; the details the glass pass uses are the same for every pixel) and then each read (`<name>At(uv, lv)`) is two texture reads and almost no arithmetic.
 */
export const mipAtlasGlsl = (name, base) => {
  const N = name[0].toUpperCase() + name.slice(1), A = `u${N}Mips`;
  return `
uniform sampler2D ${base};
#ifdef WOBBLY_ES2
uniform sampler2D ${A};
uniform vec2 ${A}Px;
uniform vec4 u${N}Lv1, u${N}Lv2, u${N}Lv3, u${N}Lv4, u${N}Lv5, u${N}Lv6, u${N}Lv7;
struct ${N}Lv { vec4 a; vec4 b; float w; };
vec4 ${name}Geom(float k) {
  vec4 L = vec4(0.0);
  if (k > 0.5) L = u${N}Lv1;
  if (k > 1.5) L = u${N}Lv2;
  if (k > 2.5) L = u${N}Lv3;
  if (k > 3.5) L = u${N}Lv4;
  if (k > 4.5) L = u${N}Lv5;
  if (k > 5.5) L = u${N}Lv6;
  if (k > 6.5) L = u${N}Lv7;
  return L;
}
${N}Lv ${name}Lv(float lod) {
  lod = clamp(lod, 0.0, 7.0);
  float l0 = floor(lod);
  ${N}Lv r;
  r.a = ${name}Geom(l0); r.b = ${name}Geom(min(l0 + 1.0, 7.0)); r.w = lod - l0;
  return r;
}
vec4 ${name}Tap(vec4 g, vec2 uv) { return texture(${A}, vec2(1.0 + clamp(uv.x, 0.0, 1.0) * g.x, g.z + 1.0 + clamp(uv.y, 0.0, 1.0) * g.y) / ${A}Px); }
vec4 ${name}At(vec2 uv, ${N}Lv v) {
  vec4 a = texture(${base}, uv);
  if (v.a.x > 0.5) a = ${name}Tap(v.a, uv);
  return mix(a, ${name}Tap(v.b, uv), v.w);
}
vec4 ${name}At0(vec2 uv) { return texture(${base}, uv); }
#else
struct ${N}Lv { float lod; };
${N}Lv ${name}Lv(float lod) { return ${N}Lv(lod); }
vec4 ${name}At(vec2 uv, ${N}Lv v) { return textureLod(${base}, uv, v.lod); }
vec4 ${name}At0(vec2 uv) { return textureLod(${base}, uv, 0.0); }
#endif
`;
};
export const MASK_LOD = mipAtlasGlsl('mask', 'uMask');
export const SCENE_LOD = mipAtlasGlsl('scene', 'uTex');

/** The packed skyline texture (2 rows x BINS, RGBA8) from the engine's floats (4 per bin: near, mid, far ridge, unused). */
export function packSkyline(data, bins = SKYLINE_BINS) {
  const out = new Uint8Array(bins * 2 * 4);
  for (let i = 0; i < bins; i++) {
    for (let c = 0; c < 3; c++) {
      const q = Math.max(0, Math.min(65535, Math.round((data[i * 4 + c] + SKYLINE_PACK.off) / SKYLINE_PACK.range * 65535)));
      out[i * 4 + c] = q >> 8; out[(bins + i) * 4 + c] = q & 255;
    }
    out[i * 4 + 3] = 255; out[(bins + i) * 4 + 3] = 255;
  }
  return out;
}

/**
 * GLSL ES 3.00 source -> GLSL ES 1.00 source. The engine's shaders are written so that this is mechanical: the differences go through the helpers above.
 * `usesVid` says the vertex shader needs the vertex number as an attribute (`aVid`): ES 2 has no gl_VertexID.
 */
export function toES1(src, stage) {
  let o = src.replace(/^#version 300 es\s*/m, '');
  const usesVid = /\bgl_VertexID\b/.test(o);
  o = o.replace(/\blayout\s*\([^)]*\)\s*/g, '');
  if (stage === 'fragment') {
    o = o.replace(/\bout\s+(?:highp\s+|mediump\s+|lowp\s+)?vec4\s+(\w+)\s*;/, (m, n) => `#define ${n} gl_FragColor\n`);
    o = o.replace(/\b(?:flat\s+)?in\s+((?:highp\s+|mediump\s+|lowp\s+)?(?:float|vec[234]|mat[234]))\s+([\w\s,]+);/g, 'varying $1 $2;');
  } else {
    o = o.replace(/\bin\s+((?:highp\s+|mediump\s+|lowp\s+)?(?:float|vec[234]|mat[234]))\s+([\w\s,]+);/g, 'attribute $1 $2;');
    o = o.replace(/\b(?:flat\s+)?out\s+((?:highp\s+|mediump\s+|lowp\s+)?(?:float|vec[234]|mat[234]))\s+([\w\s,]+);/g, 'varying $1 $2;');
    if (usesVid) o = o.replace(/\bgl_VertexID\b/g, 'int(aVid + 0.5)');
  }
  o = o.replace(/\btexture\s*\(/g, 'texture2D(');
  o = o.replace(/^\s*precision\s+(?:highp|mediump|lowp)\s+(?:int|sampler\w+)\s*;\s*$/gm, '');
  const head = '#version 100\n#define WOBBLY_ES2 1\n' + (stage === 'vertex' ? '#define WOBBLY_VERT 1\n' : '') + (stage === 'vertex' && usesVid ? 'attribute float aVid;\n' : '');
  return { src: head + o, usesVid };
}

/** Constructs that GLSL ES 1.00 does not have, left in a (translated) source outside the ES 3 branches; empty when the shader is clean. For tests. */
export function es1Problems(src) {
  // drop the branches the ES 1.00 driver would not see
  const lines = src.split('\n'); const keep = []; const stack = [];
  for (const ln of lines) {
    const t = ln.trim();
    if (/^#ifdef\s+WOBBLY_ES2/.test(t)) { stack.push(true); continue; }
    if (/^#ifndef\s+WOBBLY_ES2/.test(t)) { stack.push(false); continue; }
    if (/^#if\b|^#ifdef\b|^#ifndef\b/.test(t)) { stack.push(null); continue; }
    if (/^#else\b/.test(t)) { if (stack.length && stack[stack.length - 1] !== null) stack[stack.length - 1] = !stack[stack.length - 1]; continue; }
    if (/^#endif\b/.test(t)) { stack.pop(); continue; }
    if (stack.every((x) => x !== false)) keep.push(ln);
  }
  const body = keep.join('\n').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [];
  const test = (re, name) => { const m = body.match(re); if (m) bad.push(`${name} x${m.length}`); };
  test(/\buint\b|\buvec\d\b/g, 'unsigned integers');
  test(/\bivec\d\b/g, 'integer vectors');
  test(/\btexelFetch\s*\(|\btextureSize\s*\(|\btextureLod\s*\(|\btextureGrad\s*\(/g, 'ES 3 texture functions');
  test(/\bdFd[xy]\s*\(|\bfwidth\s*\(/g, 'derivatives');
  test(/\bflat\b|\bswitch\b|\bgl_InstanceID\b|\bgl_VertexID\b/g, 'flat/switch/instance id');
  test(/<<|>>/g, 'shifts');
  test(/[A-Za-z0-9_)\]]\s%\s[A-Za-z0-9_(]/g, 'modulo');
  test(/\b(?:float|vec[234]|int)\s+\w+\s*\[[^\]]*\]\s*=|\b(?:float|vec[234])\s*\[\s*\d*\s*\]\s*\(/g, 'array initialisers');
  test(/\b(?:inverse|round|roundEven|trunc|sinh|cosh|tanh|asinh|acosh|atanh|isnan|isinf|outerProduct|determinant|floatBitsToUint|uintBitsToFloat|bitCount)\s*\(/g, 'ES 3 functions');
  test(/\b(?:input|output|half|fixed|long|short|double|sample|unsigned)\b\s*[=;,)]/g, 'words reserved in ES 1.00');
  return bad;
}
