// Scene shaders: sky composite, stars, auto exposure, procedural noise.
//
// World frame everywhere: x = East, y = Up, z = North. Azimuth is measured
// from North towards East (dir = (sin az cos el, sin el, cos az cos el)).
// Luminance is carried in cd/m^2 until the final exposure + tonemap, so stars,
// clouds, the moon and the sky can all be balanced against each other
// physically (limiting magnitude, scotopic shift, moonlight ...).

import { ATMOS_COMMON, VERT_FULLSCREEN } from './glsl-atmosphere.js';
import { PORTABLE, MASK_LOD, SCENE_LOD } from './portable.js';

// ---------------------------------------------------------------- shared ---
// Sky radiance lookup used by the composite, the star vertex shader and the
// exposure pass.
export const SKY_LOOKUP = `
uniform sampler2D uTrans;
uniform sampler2D uSkySun;
uniform sampler2D uSkyMoon;
uniform vec2 uTransPx, uSkyPx;   // sizes of those tables, texels (an ES 2 GPU reads them with its own filtering)
uniform vec4 uSunA;       // sin(az), cos(az), elevation (rad), illuminance (lux)
uniform vec4 uMoonA;
uniform vec3 uNightLum;   // zenith luminance of airglow + zodiacal + starlight, cd/m^2
uniform vec3 uLPLum;      // zenith luminance of artificial sky glow, cd/m^2
uniform float uCamH;      // km above sea level

vec3 transmittance(float r, float mu) { return hdrTex(uTrans, transUv(r, mu), uTransPx); }

vec2 skyUv(float e, float cosPhi) {
  float phi = acos(clamp(cosPhi, -1.0, 1.0));
  float t = clamp((e + E0) / (0.5 * PI + E0), 0.0, 1.0);
  return vec2(sqrt(phi / PI), pow(t, 1.0 / 3.0));
}

vec3 skyLum(vec3 d) {
  float e = asin(clamp(d.y, -1.0, 1.0));
  vec2 h = d.xz;
  float hl = length(h);
  vec2 hn = hl > 1e-4 ? h / hl : vec2(0.0, 1.0);
  vec3 L = vec3(0.0);
  if (uSunA.w > 0.0)  L += hdrTex(uSkySun,  skyUv(e, dot(hn, uSunA.xy)), uSkyPx)  * (uSunA.w / SKYLUT_SCALE);
  if (uMoonA.w > 0.0) L += hdrTex(uSkyMoon, skyUv(e, dot(hn, uMoonA.xy)), uSkyPx) * (uMoonA.w / SKYLUT_SCALE);
  float ec = max(e, 0.0);
  float sz = cos(ec);
  float vr = 1.0 / sqrt(max(1.0 - 0.9693 * sz * sz, 0.04));   // van Rhijn airglow layer
  L += uNightLum * vr;
  L += uLPLum * (1.0 + 2.5 * pow(1.0 - sin(ec), 2.0));        // glow domes toward the horizon
  return L;
}
float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 sunTransAt(float h, float elev) {            // sunlight reaching height h above the camera
  float r = BOT + uCamH + h;
  float mu = sin(elev);
  return transmittance(r, mu) * earthShadow(r, mu);
}
`;


// Exposure + tone mapping shared by the scene and the plant sprites, so both look identical.
export const DISPLAY_FNS = `
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 srgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(0.0031308, c));
}
// Display adaptation is deliberately incomplete: a pure auto-exposure would make a moonlit night
// as bright as dusk. Compress the curve so the sky stays dark at night (but readable); boost lifts it.
float calcExpo(float La, float key, float boost) {
  float LaEff = pow(La, 0.8) * 4.95;                    // 4.95 = 3000^0.2: unity at a bright day sky
  return key / LaEff * mix(boost, 1.0, smoothstep(0.1, 300.0, La));
}
// L in cd/m^2 -> display sRGB. addRel is display-referred light (rain streaks).
vec3 toDisplay(vec3 L, float expo, vec3 addRel) {
  float Y = dot(L, vec3(0.2126, 0.7152, 0.0722));
  // mesopic range ~0.005..3 cd/m^2, judged on a log scale: rods take over below it
  float scot = 1.0 - smoothstep(-2.3, 0.5, log(max(Y, 1e-6)) / 2.302585);
  vec3 night = vec3(0.62, 0.82, 1.18) * Y;
  vec3 c = mix(L, night, scot * 0.75) * expo + addRel;
  vec3 x = c * 0.9;
  vec3 tm = aces(x);
  vec3 toe = x / (1.0 + x);                               // no toe crush: keeps night gradients readable
  return srgb(mix(toe, tm, smoothstep(0.02, 0.25, x)));
}
`;

// ------------------------------------------------- per-frame constants ---
// Values that are the same for every pixel (or depend only on the compass direction) are worked out once a frame in a tiny pass, FRAG_CONSTS, instead of at every pixel:
// texel 0 the zenith light, 1 the ambient light on the ground, 2 the sunlight reaching it, 3 the moonlight; then HAZE_N texels, one per compass direction, of the sky's colour
// just above the horizon (the haze that distant things fade into). Read by the scene programs and the plants.
export const CONSTS_N = 4, HAZE_N = 512;
export const CONSTS_LOOKUP = `
uniform sampler2D uConsts;
const float CONSTS_W = ${CONSTS_N + HAZE_N}.0;
const float CONSTS_SCALE = 16384.0;                // (these are absolute luminances, up to tens of thousands of cd/m^2: packed as value / CONSTS_SCALE, which is what the 8-bit packing's range holds)
vec3 constAt(float i) { return hdrFetch(uConsts, vec2((i + 0.5) / CONSTS_W, 0.5)) * CONSTS_SCALE; }
vec3 hazeAt(float az) {                            // az: compass direction as atan(x, z), -PI..PI
  float x = (az + PI) / (2.0 * PI) * ${HAZE_N}.0 - 0.5;
  float i = floor(x), f = x - i;
  return mix(constAt(${CONSTS_N}.0 + mod(i + ${HAZE_N}.0, ${HAZE_N}.0)), constAt(${CONSTS_N}.0 + mod(i + 1.0 + ${HAZE_N}.0, ${HAZE_N}.0)), f);
}
`;
export const FRAG_CONSTS = `#version 300 es
${ATMOS_COMMON}
${SKY_LOOKUP}
const float CONSTS_SCALE = 16384.0;                // (see constAt)
out vec4 oColor;
void main() {
  float i = floor(gl_FragCoord.x);
  vec3 v;
  if (i >= ${CONSTS_N}.0) {
    float a = ((i - ${CONSTS_N}.0 + 0.5) / ${HAZE_N}.0) * 2.0 * PI - PI;
    v = skyLum(normalize(vec3(sin(a), 0.012, cos(a))));
  } else {
    vec3 zen = skyLum(vec3(0.0, 1.0, 0.0));
    if (i < 0.5) v = zen;
    else if (i < 1.5) v = PI * (0.7 * zen + 0.3 * skyLum(normalize(vec3(uSunA.x * 0.866, 0.5, uSunA.y * 0.866))));
    else if (i < 2.5) v = sunTransAt(0.0, uSunA.z) * uSunA.w;
    else v = sunTransAt(0.0, uMoonA.z) * uMoonA.w;
  }
  oColor = hdrPack(v / CONSTS_SCALE);
}`;

// ----------------------------------------------------------------- noise ---
// (The noise is made here with integer arithmetic, which an OpenGL ES 2 GPU lacks: it loads the same picture from data/noise.bin, made by tools/make-noise.mjs.)
export const FRAG_NOISE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 oColor;
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336653u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float h2(ivec2 p, int period) {
  p = ivec2(((p.x % period) + period) % period, ((p.y % period) + period) % period);
  return float(pcg(uint(p.x) + pcg(uint(p.y) + 1013u))) / 4294967295.0;
}
float vnoise(vec2 p, int period) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = h2(i, period), b = h2(i + ivec2(1, 0), period);
  float c = h2(i + ivec2(0, 1), period), d = h2(i + ivec2(1, 1), period);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 uv, int period, int oct) {
  float amp = 0.5, sum = 0.0, norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    sum += amp * vnoise(uv * float(period), period);
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}
void main() {
  float r = fbm(vUv, 4, 5);
  float g = fbm(vUv + 0.37, 8, 4);
  float b = fbm(vUv + 0.71, 16, 3);
  float a = fbm(vUv + 0.13, 32, 2);
  oColor = vec4(r, g, b, a);
}`;

// ---- the noise texture's mip levels in one texture (OpenGL ES 2 GPUs cannot pick a mip level in a shader, so portable.js's noiseLod reads them from here) ----
// Each level is made from the one above it (a bilinear read at the middle of a 2x2 block is its average), then every level is copied into the atlas with a
// one-texel border that wraps round, so reading next to a tile's edge gives what REPEAT would.
export const FRAG_NOISE_DOWN = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uSize;      // size of the level being made, texels
out vec4 oColor;
void main() { oColor = texture(uSrc, (floor(gl_FragCoord.xy) + 0.5) / uSize); }`;

export const FRAG_ATLAS_PLACE = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uSize;      // size of the level, texels
uniform float uY;        // first row of its place in the atlas
uniform float uWrap;     // 1: the border wraps round (a tiling texture), 0: it repeats the edge texels
out vec4 oColor;
void main() {
  vec2 t = floor(gl_FragCoord.xy - vec2(0.0, uY)) - 1.0;          // the level's texel shown here (-1 and size are the border)
  t = uWrap > 0.5 ? mod(t + uSize, uSize) : clamp(t, vec2(0.0), uSize - 1.0);
  oColor = texture(uSrc, (t + 0.5) / uSize);
}`;

// ------------------------------------------------------------- exposure ----
// One pixel, RGBA32F: r = smoothed log(adaptation luminance), g = target log.
export const FRAG_ADAPT = `#version 300 es
${ATMOS_COMMON}
${SKY_LOOKUP}
uniform sampler2D uPrev;
uniform mat3 uCam;
uniform vec2 uTan;
uniform float uDt;
uniform float uSnap;
uniform float uTau;
uniform float uAdaptScale;   // overcast dims the sky relative to the clear-sky model
in vec2 vUv;
out vec4 oColor;
void main() {
  float sum = 0.0;
  const int NX = 8, NY = 6;
  for (int j = 0; j < NY; j++) {
    for (int i = 0; i < NX; i++) {
      vec2 q = vec2((float(i) + 0.5) / float(NX), (float(j) + 0.5) / float(NY)) * 1.7 - 0.85;
      vec3 d = uCam * normalize(vec3(q.x * uTan.x, q.y * uTan.y, 1.0));
      // adaptation follows the sky; terrain-covered pixels still sample sky above them
      d.y = max(d.y, 0.08);
      d = normalize(d);
      sum += log(max(lumaOf(skyLum(d)) * uAdaptScale, 1e-6));
    }
  }
  float target = sum / float(NX * NY);
  float prev = adaptLog(uPrev);
  float k = 1.0 - exp(-uDt / max(uTau, 1e-3));
  float cur = uSnap > 0.5 ? target : mix(prev, target, k);
  oColor = adaptPack(cur, target);
}`;

// ----------------------------------------------------------------- stars ---
export const VERT_STARS = `#version 300 es
${ATMOS_COMMON}
${SKY_LOOKUP}
in vec4 aStar;     // xyz unit vector (J2000, or world when uWorld=1), w = magnitude
in float aBV;      // B-V colour index (planets: pseudo B-V)
uniform mat3 uEqj;   // J2000 equatorial -> world
uniform mat3 uCam;   // world -> camera rows are right/up/forward (use transpose)
uniform vec2 uTan;
uniform float uWorld;
uniform float uPx;       // pixel scale relative to a 1080px tall target
uniform float uTime;
uniform float uTwinkle;
uniform float uStarGain;
uniform float uExtraK;   // extra extinction per airmass from aerosols, magnitudes
out vec4 vCol;

vec3 bvToRgb(float bv) {
  float T = 4600.0 * (1.0 / (0.92 * bv + 1.7) + 1.0 / (0.92 * bv + 0.62));
  float t = clamp(T, 1500.0, 40000.0) / 100.0;
  float r = t <= 66.0 ? 1.0 : clamp(1.29293 * pow(t - 60.0, -0.1332), 0.0, 1.0);
  float g = t <= 66.0 ? clamp(0.39008 * log(t) - 0.63184, 0.0, 1.0)
                      : clamp(1.12989 * pow(t - 60.0, -0.0755), 0.0, 1.0);
  float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.54321 * log(t - 10.0) - 1.19625, 0.0, 1.0));
  return mix(vec3(1.0), vec3(r, g, b), 0.65);
}

void main() {
  vec3 d = uWorld > 0.5 ? aStar.xyz : uEqj * aStar.xyz;
  // atmospheric refraction (Bennett), so stars sit where the refracted sun does
  float e = asin(clamp(d.y, -1.0, 1.0));
  float eDeg = degrees(e);
  float R = 0.0;
  if (eDeg > -1.5) R = radians(1.0 / tan(radians(eDeg + 7.31 / (eDeg + 4.4))) / 60.0);
  vec2 hz = d.xz;
  vec2 hn = normalize(hz + vec2(0.0, 1e-6));
  e += R;
  d = vec3(hn.x * cos(e), sin(e), hn.y * cos(e));

  vec3 c = transpose(uCam) * d;
  if (c.z <= 0.01 || d.y < -0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec4(0.0); return; }
  gl_Position = vec4(c.x / (c.z * uTan.x), c.y / (c.z * uTan.y), 0.0, 1.0);

  // limiting magnitude of the naked eye against the local sky brightness
  float Y = max(lumaOf(skyLum(d)), 1e-7);
  float sb = -2.5 * log(Y / 1.08e5) / log(10.0);                  // mag / arcsec^2
  float nelm = 7.93 - 5.0 * log(pow(10.0, 4.316 - sb / 5.0) + 1.0) / log(10.0) + 0.7;   // +0.7: screens beat a dark-adapted eye
  float s = max(sin(max(e, 0.0)), 0.0);
  float airmass = 1.0 / (s + 0.025 * exp(-11.0 * s));
  float m = aStar.w + (0.22 + uExtraK) * airmass;
  float delta = nelm - m;

  // scintillation, stronger near the horizon
  float tw = 1.0 + uTwinkle * (0.12 + 0.25 / airmass)
             * sin(uTime * (7.0 + 5.0 * fract(aStar.x * 91.7)) + aStar.y * 400.0);

  float a = clamp(0.5 + 0.5 * delta, 0.0, 1.0) * step(-0.4, delta);
  gl_PointSize = clamp((1.6 + 0.6 * max(delta, 0.0)) * uPx, 1.5, 16.0 * uPx);
  vCol = vec4(bvToRgb(aBV) * a * tw * uStarGain, a);
}`;

export const FRAG_STARS = `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 oColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  float f = exp(-r2 * 3.2) * (1.0 - smoothstep(0.7, 1.0, r2));
  oColor = vec4(vCol.rgb * f, 0.0);
}`;

// ----------------------------------------------------------------- blit ----
// Final pass: scene -> canvas, and the clock drawn as glass on top.
//
// The digits arrive as a coverage mask (white strokes, alpha channel) covering only
// the clock's bounding box. A blurred copy of the mask is the "thickness" of the
// glass; its gradient is the bevel normal. From that:
//   liquid glass  - refract the scene through the bevel (with a little dispersion),
//                   blur it by the frost amount through the scene's mip chain, add
//                   specular glints and a bright rim facing the real sun/moon, and
//                   a soft shadow on the sky behind. Optionally lit from inside: the
//                   thick middle of each stroke glows and a halo spills onto the sky
//   coloured tube - a plain glass tube with LEDs inside, like a tube light: evenly spaced lights of
//                   varying colours (placed by glass.js) glow through the glass, no lines on it
//   LED panel     - the whole picture sampled onto a 64x32 (or 32x64) grid of square
//                   pixels with black lines between them
const BLIT_SOURCE = `
precision highp float;
${PORTABLE}
${MASK_LOD}
${SCENE_LOD}
uniform float uTexW;       // width of uTex in texels
uniform vec4 uGlass;       // x frost 0..1, y mode (0 off, 1 liquid, 2 stained, 3 LED), z stroke width (canvas px), w time
uniform vec4 uMaskRect;    // clock bounding box in canvas uv, y down: x, y, w, h
uniform vec2 uMaskPx;      // mask texture size in texels
uniform vec2 uRes;         // canvas size in px
uniform vec3 uLight;       // xy: screen direction towards the light (y up), z: strength 0..1
uniform vec3 uLightCol;
uniform vec4 uGlow;        // x: light from inside the glass, 0..1; y: LED cell size in px when the LED panel is on (else 0)
uniform vec3 uGlowCol;     // colour of that light (liquid glass)
uniform vec3 uInk;         // flat ink colour (solid clock style while the LED panel is on)
uniform sampler2D uFull;       // full-size overlay (the pills on panels the tuned layout does not cover), straight alpha
uniform float uFullOn;
uniform float uContrast;   // strength of the readability outline and tone, 0 off .. 1
uniform vec4 uWx;          // weather on the digits: x snow settled on them 0..1, y rain on the glass 0..1, w time in seconds
uniform sampler2D uDrops;  // raindrops from drops.js, in the mask's place: r dark rim, g glint, b water
uniform float uDropsOn;
uniform sampler2D uGeo;    // (the ES 2 glass's passes)
uniform sampler2D uAura;
uniform sampler2D uEmit;
uniform sampler2D uHalo;
uniform sampler2D uPrev;   // the previous of the glass's passes (ES 2 runs the glass as body, weather and outline)
in vec2 vUv;
out vec4 oColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) { return vec2(hash21(p), hash21(p + 17.31)); }

vec2 maskUv(vec2 uv) { return (vec2(uv.x, 1.0 - uv.y) - uMaskRect.xy) / uMaskRect.zw; }
float maskA(vec2 uv, MaskLv v) { return maskAt(maskUv(uv), v).a; }       // the mask's coverage at a detail level (worked out once: maskLv)
float maskA0(vec2 uv) { return maskAt0(maskUv(uv)).a; }
float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 sceneAtL(vec2 uv, SceneLv v) { return sceneAt(uv, v).rgb; }

float linLum(vec3 c) { return dot(pow(max(c, 0.0), vec3(2.2)), vec3(0.2126, 0.7152, 0.0722)); }

// ---- readability ----
// The time has to stay readable on any sky and for any eyes. Colour-blind readers can still see differences in
// brightness, so this is about luminance, and it is done like the outline round subtitles, not by recolouring the
// glass: a thin outline hugs the digits, near-black where the sky behind it is bright and near-white where it is
// dark, so the edge of every digit beats the sky at least ~3.8:1 whatever that sky is. The outline's colour follows
// the sky smoothly, so where a horizon crosses a digit the top edge is dark and the bottom edge light, and the glass
// itself stays glass. On top of that the body is eased a little darker under a bright sky and a little lighter under
// a dark one, by a gentle amount that depends on the sky around the whole stroke, so it never flips inside a digit.
// uContrast is the strength: 0 off, 0.85 normal, 1 extra strong.
vec3 withOutline(vec3 outside, vec3 inside, float cover) {
  float k = uContrast;
  float cell = uGlow.y;                                    // LED cell size in px (0 when the LED panel is off)
  float t = max(uGlass.z * 0.085, 1.6);                    // outline width in canvas px: about 8% of the stroke
  if (cell > 0.0) t = max(t, cell);                        // on the LED panel never thinner than one LED
  float maskScale = uMaskPx.x / (uMaskRect.z * uRes.x);
  float m0 = maskA0(vUv);
  float mw = maskA(vUv, maskLv(max(log2(t * maskScale), 0.0)));
  float inner = m0 * (1.0 - smoothstep(0.55, 0.92, mw));   // inside the glyph, near its edge
  float outer = (1.0 - m0) * smoothstep(0.06, 0.5, mw);    // outside it, near its edge
  float texScale = uTexW / uRes.x;
  float Lb = linLum(sceneAtL(vUv, sceneLv(max(log2(max(uGlass.z * 0.15, t) * texScale), 0.0))));
  float pol = smoothstep(0.10, 0.26, Lb);                  // 1: bright sky behind, dark outline
  vec3 oc = mix(vec3(0.98, 0.98, 1.0), vec3(0.012), pol);
  vec3 o = mix(outside, oc, outer * k * 0.85);
  vec3 i = mix(inside, oc, inner * k * 0.6);
  return k < 0.01 ? mix(outside, inside, cover) : mix(o, i, cover);
}

// gentle, spatially smooth tone for the body of the glass
vec3 bodyTone(vec3 c, float stroke) {
  float Lbig = linLum(sceneAtL(vUv, sceneLv(max(log2(stroke * 2.5 * uTexW / uRes.x), 0.0))));
  float dark = smoothstep(0.22, 0.6, Lbig), light = 1.0 - smoothstep(0.03, 0.14, Lbig);
  c *= 1.0 - 0.38 * dark * uContrast;
  return mix(c, vec3(1.0), 0.22 * light * uContrast);
}


// ---- weather on the digits ----
// Snow settles on the upper edges of the digits as a lumpy cap (a few steps up from each pixel: if there is open air within
// the cap's depth above it, it is snow). Rain beads up on the glass, some of the beads slide down leaving a thin wet trail,
// and drops bounce off the top edges as tiny splashes. All of it is thin and stays on the edges or in small spots, and it goes
// on before the readability outline, so the outline still frames every digit.
float vnoise(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash21(vec2(i, 7.1)), hash21(vec2(i + 1.0, 7.1)), f); }

float snowCap(float stroke, float amount) {
  float lump = 0.7 + 0.6 * vnoise(gl_FragCoord.x / (stroke * 0.30));
  float depth = stroke * (0.06 + 0.24 * amount) * lump;           // canvas px: at most about 30% of the stroke
  float cap = 0.0;
  for (int k = 1; k <= 6; k++) {
    float f = float(k) / 6.0;
    float m = maskA0(vUv + vec2(0.0, depth * f / uRes.y));
    cap = max(cap, (1.0 - smoothstep(0.2, 0.8, m)) * (1.0 - 0.5 * f));
  }
  return amount < 0.01 ? 0.0 : cap;
}

vec3 snowOn(vec3 col, float cap, vec3 sky) {
  float L = lumaOf(sky);
  vec3 white = vec3(0.93, 0.96, 1.0) * (0.45 + 0.6 * smoothstep(0.02, 0.45, L));   // lit by the sky: dim at night
  white = mix(white, vec3(0.78, 0.86, 1.0) * white, smoothstep(0.55, 1.0, cap) * 0.5);   // a cool shade where it is thick
  return mix(col, white, smoothstep(0.0, 0.7, cap) * 0.92);
}

// beads and trails on the glass; returns (darken, highlight, refract amount, trail)
vec4 rainBeads(float stroke, float wet) {
  float cell = stroke * 0.42;
  vec2 p = gl_FragCoord.xy / cell;
  float dark = 0.0, hi = 0.0, refr = 0.0, trail = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = floor(p) + vec2(float(i), float(j));
      vec2 h = hash22(id);
      if (h.x > wet * 0.95) continue;
      vec2 c = id + 0.2 + 0.6 * hash22(id + 3.7);
      float r = 0.17 + 0.15 * h.y;
      float ph = fract(uWx.w * (0.03 + 0.05 * h.x) + h.y * 7.0);       // each bead's own slow cycle
      float slide = smoothstep(0.0, 0.18, ph) * 1.5 * step(0.55, h.y);  // some beads slide down, the rest sit
      float life = smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.92, 1.0, ph));
      vec2 cc = c - vec2(0.0, slide);
      vec2 q = p - cc;
      float d = length(q) / r;
      if (d < 1.2) {
        float inside = 1.0 - smoothstep(0.92, 1.0, d);
        dark = max(dark, smoothstep(0.62, 1.0, d) * inside * life);
        hi = max(hi, smoothstep(0.55, 0.0, length(q / r - uLight.xy * 0.42)) * inside * life);
        refr = max(refr, inside * life);
      }
      if (slide > 0.01 && abs(p.x - c.x) < r * 0.34 && p.y > cc.y && p.y < c.y + 0.1) {
        trail = max(trail, (1.0 - (p.y - cc.y) / (slide + 0.1)) * 0.5 * life);
      }
    }
  }
  return vec4(dark, hi, refr, trail);
}

vec3 rainOn(vec3 col, vec4 b, vec3 lightCol, vec3 skyHere) {
  col = mix(col, skyHere * 0.9, b.z * 0.55);                                    // the bead shows the sky, bent
  col *= 1.0 - 0.28 * b.x;                                                      // its rim is darker
  col += lightCol * b.y * 0.55;                                                 // and it catches the light
  col = mix(col, col * 0.9 + lightCol * 0.06, b.w);                             // a trail is a thin wet line
  return col;
}

// drops bouncing off the top edge of a digit: a few tiny flashes just above it, never the same place twice
float splash(float stroke, float rate) {
  float r = stroke * 0.12;
  float above = 1.0 - smoothstep(0.1, 0.4, maskA0(vUv));
  float below = maskA0(vUv - vec2(0.0, r * 0.7 / uRes.y));
  float edge = above * smoothstep(0.5, 0.95, below);
  float cx = floor(gl_FragCoord.x / (stroke * 0.18));
  float tt = floor(uWx.w * 6.0 + hash21(vec2(cx, 2.0)) * 5.0);
  float on = step(1.0 - rate * 0.45, hash21(vec2(cx, tt)));
  return rate < 0.02 ? 0.0 : edge * on * (0.6 + 0.4 * hash21(vec2(cx, tt + 9.0)));
}

// The final pass is built in three forms, so that a GPU only has to hold the one in use: no clock glass (a plain copy), the flat ink of the LED panel's solid style,
// and glass (liquid or stained).
void bodyOff() { oColor = vec4(texture(uTex, vUv).rgb, 1.0); }

void bodyInk() {                                             // flat ink: the LED panel has no glass here, but the digits still need drawing
  vec3 base = texture(uTex, vUv).rgb;
  {
    float cv = smoothstep(0.1, 0.9, maskA0(vUv));
    vec3 ink = uInk, bs = base;
    float stk = uGlass.z;
    if (cv > 0.02 && uWx.x > 0.01) ink = snowOn(ink, snowCap(stk, uWx.x), base);
    if (uWx.y > 0.01 && stk > 0.0) {
      if (cv > 0.02) {
        if (uDropsOn > 0.5) { vec4 dr = texture(uDrops, (vec2(vUv.x, 1.0 - vUv.y) - uMaskRect.xy) / uMaskRect.zw); ink = rainOn(ink, vec4(dr.r * 0.7, dr.g * 0.8, dr.b, 0.0), uLightCol, base); }
#ifndef WOBBLY_ES2
        else ink = rainOn(ink, rainBeads(stk, uWx.y) * vec4(0.7, 0.8, 0.0, 0.8), uLightCol, base);
#endif
      }
      bs += splash(stk, uWx.y) * vec3(0.8, 0.9, 1.0) * 0.55;
    }
    oColor = vec4(withOutline(bs, mix(bs, ink, cv), cv), 1.0);
  }
}

void bodyGlass() {
  vec3 base = texture(uTex, vUv).rgb;
  float mode = uGlass.y;
  vec2 px = 1.0 / uRes;
  float stroke = uGlass.z;                                  // canvas px
  float maskScale = uMaskPx.x / (uMaskRect.z * uRes.x);     // mask texels per canvas px
  float lodH = max(log2(stroke * 0.30 * maskScale), 0.0);
  MaskLv lvH = maskLv(lodH), lvS = maskLv(max(log2(stroke * 0.9 * maskScale), 0.0)), lvG = maskLv(max(log2(stroke * 1.5 * maskScale), 0.0));
  float glow = uGlow.x;
  bool stained = mode > 1.5;

  // soft shadow of the glass cast on the sky, away from the light
  vec2 sh = vUv - uLight.xy * stroke * 0.22 * px;
  float shadow = maskA(sh, lvS) * (0.10 + 0.20 * uLight.z) * (1.0 - 0.7 * glow);

  float cover = maskA0(vUv);
  float wide = maskA(vUv, lvS);
  float halo = glow > 0.002 ? maskA(vUv, lvG) : 0.0;     // light spilling out of the glass onto the sky
  oColor = vec4(base, 1.0);
  bool near = !(cover < 0.004 && wide < 0.004 && shadow < 0.004 && halo * glow < 0.004);   // (no early return: on the Pi Zero's driver the pixels that took it came out black)
  if (near) {

  // height field = blurred coverage; gradient = bevel
  float d = stroke * 0.22;
  vec2 dx = vec2(d * px.x, 0.0), dy = vec2(0.0, d * px.y);
  float h  = maskA(vUv, lvH);
  float gx = maskA(vUv + dx, lvH) - maskA(vUv - dx, lvH);
  float gy = maskA(vUv + dy, lvH) - maskA(vUv - dy, lvH);
  vec2 g = vec2(gx, gy);
  vec3 n = normalize(vec3(-g * 2.4, 1.0));
  float slope = length(g);

  vec3 Ldir = normalize(vec3(uLight.xy * 0.75, 0.7));
  vec3 Hv = normalize(Ldir + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, Hv), 0.0), 38.0) * uLight.z;
  float facing = max(dot(normalize(-g + 1e-5), uLight.xy), 0.0);      // 1 where the bevel faces the light
  float away = max(dot(normalize(g + 1e-5), uLight.xy), 0.0);
  float rim = smoothstep(0.02, 0.55, slope);
  float frost = uGlass.x;

  // Coloured tube: glass.js paints the lights into the mask's colour channels (alpha stays coverage), evenly
  // spaced along each digit and fixed to their place in it, so the colour here is how brightly each light
  // shines on this spot. The tube itself is plain glass; there are no lines on it.
  vec3 emit = uGlowCol;
  if (stained) {
    vec2 mUv = (vec2(vUv.x, 1.0 - vUv.y) - uMaskRect.xy) / uMaskRect.zw;
    vec4 mk = maskAt(mUv, maskLv(lodH * 0.5));                      // a little blur: glass spreads the light
    emit = min(mk.rgb / max(mk.a, 0.05), vec3(1.3));
  }

  // ---- liquid glass (stained glass is the same glass with a colour in it) ----
  vec2 off = n.xy * stroke * (0.9 + 0.8 * h) * px;                    // lens-like displacement
  SceneLv lvF = sceneLv(frost * 6.0);
  vec3 c;
  float disp = (1.0 - frost) * 0.10 + 0.015;
  c.r = sceneAtL(vUv + off * (1.0 + disp), lvF).r;
  c.g = sceneAtL(vUv + off, lvF).g;
  c.b = sceneAtL(vUv + off * (1.0 - disp), lvF).b;
  // frost: diffuse towards the local average sky colour and go milky; clear glass stays clear
  vec3 avg = sceneAtL(vUv, sceneLv(6.5));
  c = mix(c, mix(avg, c, 0.5), frost * 0.6);
  float lum = lumaOf(c);
  c = mix(c, vec3(lum), 0.12 * frost);
  c += uLightCol * (0.012 + 0.26 * frost * frost + 0.06 * frost) * (0.45 + 0.55 * uLight.z);
  c += (hash21(gl_FragCoord.xy) - 0.5) * 0.05 * frost;               // fine grain of etched glass
  c *= 1.0 - 0.10 * rim * away;                                       // bevel facing away from the light darkens

  // light from inside: brightest in the thick middle of the stroke, the bevelled edge stays glassy
  float core = smoothstep(0.10, 0.80, h);
  float inner = glow * (0.28 + 0.72 * core) * (1.0 - 0.45 * rim);
  if (stained) c *= mix(0.75, 1.0, smoothstep(0.30, 0.85, h));         // round tube: a little darker towards the sides
  vec3 lamp = emit * inner;
  if (stained) lamp *= 1.0 + 0.9 * pow(smoothstep(0.45, 0.98, h), 2.0);   // brightest down the middle of the tube
  c += lamp * (stained ? 1.15 : 0.80);
  if (!stained) c += emit * glow * 0.10 * (1.0 - frost * 0.4);        // faint all-over fill so thin strokes light up too

  // the body of the glass is made readable first; the glints and the rim go on top, so it still looks like glass
  if (!stained) c = bodyTone(c, stroke);                               // (a lit tube keeps its colours: the outline carries it)
  c += uLightCol * spec * mix(1.1, 0.35, frost) * (stained ? 0.7 : 1.0);   // frost scatters the glint into a soft sheen
  c += uLightCol * rim * facing * (0.30 + 0.45 * uLight.z) * mix(1.0, 0.65, frost) * (stained ? 0.8 : 1.0);
  c += uLightCol * rim * 0.05;
  c += uLightCol * exp(-pow((h - 0.62) * 5.0, 2.0)) * spec * 0.35 * (1.0 - frost);
  vec3 glass = min(c, vec3(1.6));
  if (cover > 0.02) {                                                  // snow and rain on the digits
    if (uWx.x > 0.01) glass = snowOn(glass, snowCap(stroke, uWx.x), base);
    if (uWx.y > 0.01) {
      if (uDropsOn > 0.5) {                                              // drops that run, merge and are shed with the digit (drops.js)
        vec4 dr = texture(uDrops, (vec2(vUv.x, 1.0 - vUv.y) - uMaskRect.xy) / uMaskRect.zw);
        glass = rainOn(glass, vec4(dr.r, dr.g, dr.b, 0.0), uLightCol, sceneAtL(vUv + vec2(0.0, stroke * 0.3) * px, sceneLv(1.0)));       // (a drop shows the sky upside down and shifted)
      }
#ifndef WOBBLY_ES2
      else glass = rainOn(glass, rainBeads(stroke, uWx.y), uLightCol, sceneAtL(vUv - (gl_FragCoord.xy / (stroke * 0.42) - floor(gl_FragCoord.xy / (stroke * 0.42)) - 0.5) * (stroke * 0.42) * px * 1.4, sceneLv(1.0)));
#endif
    }
  }

  // halo on the sky around lit glass
  vec3 shaded = base * (1.0 - shadow * (1.0 - cover));
  vec3 haloCol = uGlowCol;
  float haloK = 0.30;
  if (stained) {                                                      // the tube's lights colour the air around it
    vec4 hm = maskAt(maskUv(vUv), lvG);
    haloCol = hm.rgb / max(hm.a, 0.04); haloK = 0.85;
  }
  shaded += haloCol * halo * glow * (1.0 - cover) * haloK;
  if (uWx.y > 0.01) shaded += splash(stroke, uWx.y) * vec3(0.8, 0.9, 1.0) * 0.55;
  oColor = vec4(withOutline(shaded, glass, cover), 1.0);
  }
}

// The glass body of the ES 2 form, in the passes that make what it reads (ggeo: the height field and its slope, gaura: the shadow, halo and nearness, gemit/ghalo: a stained tube's colours), so that
// no one program has to hold every read of the mask and of the scene: a Pi Zero's driver could not fit them (it drew nothing).
void passGeo() {
  float stroke = uGlass.z;
  vec2 px = 1.0 / uRes;
  float maskScale = uMaskPx.x / (uMaskRect.z * uRes.x);
  MaskLv lvH = maskLv(max(log2(stroke * 0.30 * maskScale), 0.0));
  float d = stroke * 0.22;
  vec2 dx = vec2(d * px.x, 0.0), dy = vec2(0.0, d * px.y);
  float h  = maskA(vUv, lvH);
  float gx = maskA(vUv + dx, lvH) - maskA(vUv - dx, lvH);
  float gy = maskA(vUv + dy, lvH) - maskA(vUv - dy, lvH);
  oColor = vec4(h, gx * 0.5 + 0.5, gy * 0.5 + 0.5, maskA0(vUv));
}
void passAura() {
  float stroke = uGlass.z;
  vec2 px = 1.0 / uRes;
  float maskScale = uMaskPx.x / (uMaskRect.z * uRes.x);
  MaskLv lvS = maskLv(max(log2(stroke * 0.9 * maskScale), 0.0)), lvG = maskLv(max(log2(stroke * 1.5 * maskScale), 0.0));
  float glow = uGlow.x;
  vec2 sh = vUv - uLight.xy * stroke * 0.22 * px;
  float shadow = maskA(sh, lvS) * (0.10 + 0.20 * uLight.z) * (1.0 - 0.7 * glow);
  float halo = glow > 0.002 ? maskA(vUv, lvG) : 0.0;
  oColor = vec4(shadow, halo, maskA(vUv, lvS), 1.0);
}
void passEmit() {
  float maskScale = uMaskPx.x / (uMaskRect.z * uRes.x);
  vec4 mk = maskAt(maskUv(vUv), maskLv(max(log2(uGlass.z * 0.30 * maskScale), 0.0) * 0.5));
  oColor = vec4(min(mk.rgb / max(mk.a, 0.05), vec3(1.3)) / 1.3, 1.0);
}
void passHaloCol() {
  float maskScale = uMaskPx.x / (uMaskRect.z * uRes.x);
  vec4 hm = maskAt(maskUv(vUv), maskLv(max(log2(uGlass.z * 1.5 * maskScale), 0.0)));
  oColor = vec4(min(hm.rgb / max(hm.a, 0.04), vec3(1.5)) / 1.5, 1.0);
}
void bodyLit() {
  vec3 base = texture(uTex, vUv).rgb;
  float mode = uGlass.y;
  vec2 px = 1.0 / uRes;
  float stroke = uGlass.z;
  float glow = uGlow.x;
  bool stained = mode > 1.5;
  vec4 geo = texture(uGeo, vUv), au = texture(uAura, vUv);
  float cover = geo.a, h = geo.r, shadow = au.r, halo = au.g, wide = au.b;
  vec2 g = geo.gb * 2.0 - 1.0;
  oColor = vec4(base, 1.0);
  bool near = !(cover < 0.004 && wide < 0.004 && shadow < 0.004 && halo * glow < 0.004);
  if (near) {
  vec3 n = normalize(vec3(-g * 2.4, 1.0));
  float slope = length(g);

  vec3 Ldir = normalize(vec3(uLight.xy * 0.75, 0.7));
  vec3 Hv = normalize(Ldir + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, Hv), 0.0), 38.0) * uLight.z;
  float facing = max(dot(normalize(-g + 1e-5), uLight.xy), 0.0);      // 1 where the bevel faces the light
  float away = max(dot(normalize(g + 1e-5), uLight.xy), 0.0);
  float rim = smoothstep(0.02, 0.55, slope);
  float frost = uGlass.x;

  // Coloured tube: glass.js paints the lights into the mask's colour channels (alpha stays coverage), evenly
  // spaced along each digit and fixed to their place in it, so the colour here is how brightly each light
  // shines on this spot. The tube itself is plain glass; there are no lines on it.
  vec3 emit = stained ? texture(uEmit, vUv).rgb * 1.3 : uGlowCol;

  // ---- liquid glass (stained glass is the same glass with a colour in it) ----
  vec2 off = n.xy * stroke * (0.9 + 0.8 * h) * px;                    // lens-like displacement
  SceneLv lvF = sceneLv(frost * 6.0);
  vec3 c;
  float disp = (1.0 - frost) * 0.10 + 0.015;
  c.r = sceneAtL(vUv + off * (1.0 + disp), lvF).r;
  c.g = sceneAtL(vUv + off, lvF).g;
  c.b = sceneAtL(vUv + off * (1.0 - disp), lvF).b;
  // frost: diffuse towards the local average sky colour and go milky; clear glass stays clear
  vec3 avg = sceneAtL(vUv, sceneLv(6.5));
  c = mix(c, mix(avg, c, 0.5), frost * 0.6);
  float lum = lumaOf(c);
  c = mix(c, vec3(lum), 0.12 * frost);
  c += uLightCol * (0.012 + 0.26 * frost * frost + 0.06 * frost) * (0.45 + 0.55 * uLight.z);
  c += (hash21(gl_FragCoord.xy) - 0.5) * 0.05 * frost;               // fine grain of etched glass
  c *= 1.0 - 0.10 * rim * away;                                       // bevel facing away from the light darkens

  // light from inside: brightest in the thick middle of the stroke, the bevelled edge stays glassy
  float core = smoothstep(0.10, 0.80, h);
  float inner = glow * (0.28 + 0.72 * core) * (1.0 - 0.45 * rim);
  if (stained) c *= mix(0.75, 1.0, smoothstep(0.30, 0.85, h));         // round tube: a little darker towards the sides
  vec3 lamp = emit * inner;
  if (stained) lamp *= 1.0 + 0.9 * pow(smoothstep(0.45, 0.98, h), 2.0);   // brightest down the middle of the tube
  c += lamp * (stained ? 1.15 : 0.80);
  if (!stained) c += emit * glow * 0.10 * (1.0 - frost * 0.4);        // faint all-over fill so thin strokes light up too

  // the body of the glass is made readable first; the glints and the rim go on top, so it still looks like glass
  if (!stained) c = bodyTone(c, stroke);                               // (a lit tube keeps its colours: the outline carries it)
  c += uLightCol * spec * mix(1.1, 0.35, frost) * (stained ? 0.7 : 1.0);   // frost scatters the glint into a soft sheen
  c += uLightCol * rim * facing * (0.30 + 0.45 * uLight.z) * mix(1.0, 0.65, frost) * (stained ? 0.8 : 1.0);
  c += uLightCol * rim * 0.05;
  c += uLightCol * exp(-pow((h - 0.62) * 5.0, 2.0)) * spec * 0.35 * (1.0 - frost);
  vec3 glass = min(c, vec3(1.6));

  vec3 shaded = base * (1.0 - shadow * (1.0 - cover));
  vec3 haloCol = stained ? texture(uHalo, vUv).rgb * 1.5 : uGlowCol;
  shaded += haloCol * halo * glow * (1.0 - cover) * (stained ? 0.85 : 0.30);
  oColor = vec4(mix(shaded, glass, cover), 1.0);                       // (snow, rain and the outline are the next passes)
  }
}

// The ES 2 glass in passes (each small enough for a Pi Zero's GPU): the reads above, the body (BLIT_GBODY), then snow and rain on the digits, then the readability outline.
void bodyWx() {
  vec3 comp = texture(uPrev, vUv).rgb;
  float stroke = uGlass.z;
  float cover = maskA0(vUv);
  vec3 col = comp;
  if (cover > 0.02) {
    vec3 glass = comp;
    if (uWx.x > 0.01) glass = snowOn(glass, snowCap(stroke, uWx.x), texture(uTex, vUv).rgb);
    if (uWx.y > 0.01 && uDropsOn > 0.5) {
      vec4 dr = texture(uDrops, (vec2(vUv.x, 1.0 - vUv.y) - uMaskRect.xy) / uMaskRect.zw);
      glass = rainOn(glass, vec4(dr.r, dr.g, dr.b, 0.0), uLightCol, sceneAtL(vUv + vec2(0.0, stroke * 0.3) / uRes, sceneLv(1.0)));
    }
    col = mix(comp, glass, cover);
  }
  if (uWx.y > 0.01) col += splash(stroke, uWx.y) * vec3(0.8, 0.9, 1.0) * 0.55 * (1.0 - cover);
  oColor = vec4(col, 1.0);
}

void bodyOut() {
  vec3 comp = texture(uPrev, vUv).rgb;
  oColor = vec4(withOutline(comp, comp, maskA0(vUv)), 1.0);
}

void main() {
#if defined(BLIT_GLASS)
  bodyGlass();
#elif defined(BLIT_GBODY)
  bodyLit();
#elif defined(BLIT_GGEO)
  passGeo();
#elif defined(BLIT_GAURA)
  passAura();
#elif defined(BLIT_GEMIT)
  passEmit();
#elif defined(BLIT_GHALO)
  passHaloCol();
#elif defined(BLIT_GWX)
  bodyWx();
#elif defined(BLIT_GOUT)
  bodyOut();
#elif defined(BLIT_INK)
  bodyInk();
#else
  bodyOff();
#endif
  if (uFullOn > 0.5) {
    vec4 o = texture(uFull, vec2(vUv.x, 1.0 - vUv.y));
    oColor.rgb = mix(oColor.rgb, o.rgb, o.a);
  }
}`;
/**
 * The cheapest sky and ground (flatsky.js): from the view direction, a sky that is a gradient from the horizon to overhead and a ground that fades from its near colour to its far one
 * towards the horizon. uMode 0 draws the ground colour everywhere (under the real sky, which is drawn over it where there is no ridge), 1 the whole picture. The fourth channel is
 * the stars' sky-visibility, as in the real scene.
 */
export const FRAG_FLAT = `#version 300 es
precision highp float;
uniform mat3 uCam;
uniform vec2 uTan;
uniform vec3 uZen, uHor, uGN, uGF;
uniform float uMode;
in vec2 vUv;
out vec4 oColor;
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 d = normalize(uCam * normalize(vec3(ndc.x * uTan.x, ndc.y * uTan.y, 1.0)));
  float e = d.y;
  if (uMode > 0.5 && e >= 0.0) { oColor = vec4(mix(uHor, uZen, pow(clamp(e, 0.0, 1.0), 0.45)), 1.0); return; }
  oColor = vec4(mix(uGF, uGN, clamp(-e * 3.0, 0.0, 1.0)), 0.0);
}`;

/** The final pass: kind 'off' (no clock glass), 'ink' (flat ink on the LED panel's solid style) or 'glass'. */
export const fragBlit = (kind) => `#version 300 es\n#define BLIT_${kind.toUpperCase()} 1${BLIT_SOURCE}`;



// ---- LED panel: stars. A star is far smaller than an LED, so averaging a block of pixels loses it. This pass finds, for every LED,
// the brightest pixel in its block and how far it stands above the block's average (a star, the moon, a planet, a tree light),
// skipping the blocks the digits are on. It is derived from the normal picture, so a star shows here exactly when it shows there.
export const FRAG_LED_PEAK = `#version 300 es
precision highp float;
${PORTABLE}
${MASK_LOD}                // uMask: the digits
uniform sampler2D uComp;   // the normal picture, with mip levels
uniform vec2 uRes;         // canvas size in px
uniform vec4 uLed;         // x columns, y rows
uniform vec4 uMaskRect;
uniform vec2 uMaskPx;
uniform float uMaskOn;
out vec4 oColor;
float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  float cell = max(floor(min(uRes.x / uLed.x, uRes.y / uLed.y)), 2.0);
  vec2 panel = vec2(uLed.x, uLed.y) * cell;
  vec2 org = floor((uRes - panel) * 0.5);
  vec2 id = floor(gl_FragCoord.xy);
  vec2 base = org + id * cell;
  vec2 cuv = (base + 0.5 * cell) / uRes;
  if (uMaskOn > 0.5) {                                                      // the clock wins: no star on a digit
    vec2 m = (vec2(cuv.x, 1.0 - cuv.y) - uMaskRect.xy) / uMaskRect.zw;
    float lod = max(log2(cell * uMaskPx.x / (uMaskRect.z * uRes.x)), 0.0);
    if (maskAt(m, maskLv(lod)).a > 0.004) { oColor = vec4(0.0); return; }
  }
#ifdef WOBBLY_ES2
  vec3 sum = vec3(0.0);                                                     // no mip levels to average with: the block is summed below
#else
  float avg = lumaOf(textureLod(uComp, cuv, max(log2(cell), 0.0)).rgb);
#endif
  vec3 best = vec3(0.0);
  float top = 0.0;
  int n = int(cell);
  for (int j = 0; j < 40; j++) {
    if (j >= n) break;
    for (int i = 0; i < 40; i++) {
      if (i >= n) break;
      vec3 c = texel0(uComp, base + vec2(float(i), float(j)), uRes, cell).rgb;
#ifdef WOBBLY_ES2
      sum += c;
#endif
      float l = lumaOf(c);
      if (l > top) { top = l; best = c; }
    }
  }
#ifdef WOBBLY_ES2
  float avg = lumaOf(sum / float(n * n));
#endif
  oColor = vec4(best, clamp(top - avg, 0.0, 1.0));
}`;

// ---- LED panel on an OpenGL ES 2 GPU: the average of each LED's block (there are no mip levels to read it from), one texel per LED ----
export const FRAG_LED_AVG = `#version 300 es
precision highp float;
${PORTABLE}
uniform sampler2D uComp;
uniform vec2 uRes;
uniform vec4 uLed;
out vec4 oColor;
void main() {
  float cell = max(floor(min(uRes.x / uLed.x, uRes.y / uLed.y)), 2.0);
  vec2 org = floor((uRes - vec2(uLed.x, uLed.y) * cell) * 0.5);
  vec2 base = org + floor(gl_FragCoord.xy) * cell;
  vec3 sum = vec3(0.0);
  int n = int(cell);
  for (int j = 0; j < 40; j++) {
    if (j >= n) break;
    for (int i = 0; i < 40; i++) {
      if (i >= n) break;
      sum += texel0(uComp, base + vec2(float(i), float(j)), uRes, cell).rgb;
    }
  }
  oColor = vec4(sum / float(n * n), 1.0);
}`;

// ---- LED panel: the finished picture (glass and all) averaged into a grid of square pixels ----
export const FRAG_LED = `#version 300 es
precision highp float;
${PORTABLE}
uniform sampler2D uAvg;    // (OpenGL ES 2 only) each LED's block averaged, one texel per LED
uniform sampler2D uComp;   // the normal picture, with mip levels
uniform vec2 uRes;         // canvas size in px
uniform vec4 uLed;         // x columns, y rows, z gap as a fraction of a cell, w brightness
uniform sampler2D uOverlay;   // countdown card: one texel per LED, straight alpha
uniform float uOverlayOn;
uniform sampler2D uPeak;      // per LED: the brightest pixel of its block and how far it stands above the average (stars)
uniform float uStars;         // 0 off, 1 stars the normal picture shows, 2 as many as the sky allows, brighter
in vec2 vUv;
out vec4 oColor;
void main() {
  float cell = max(floor(min(uRes.x / uLed.x, uRes.y / uLed.y)), 2.0);      // whole pixels, so the lines stay crisp
  vec2 panel = vec2(uLed.x, uLed.y) * cell;
  vec2 org = floor((uRes - panel) * 0.5);
  vec2 p = gl_FragCoord.xy - org;
  if (p.x < 0.0 || p.y < 0.0 || p.x >= panel.x || p.y >= panel.y) { oColor = vec4(0.0, 0.0, 0.0, 1.0); return; }   // the bezel
  vec2 id = floor(p / cell);
  vec2 f = p / cell - id;
  vec2 e = min(f, 1.0 - f);
  float g = uLed.z * 0.5, aa = 0.9 / cell;
  float lit = smoothstep(g - aa, g + aa, e.x) * smoothstep(g - aa, g + aa, e.y);
  vec2 cuv = (org + (id + 0.5) * cell) / uRes;
#ifdef WOBBLY_ES2
  vec3 c = texture(uAvg, (id + 0.5) / uLed.xy).rgb;
#else
  vec3 c = textureLod(uComp, cuv, max(log2(cell), 0.0)).rgb;                // average the picture over the cell
#endif
  // LED panels are punchy: more saturation and contrast than the soft picture
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = pow(max(mix(vec3(l), c, 1.2), 0.0), vec3(1.08));
  if (uStars > 0.5) {                                                       // a star, the moon or a planet in this LED's block: light the LED
    vec4 pk = texel(uPeak, id, uLed.xy);
    float thr = uStars > 1.5 ? 0.06 : 0.14;
    float dark = 1.0 - smoothstep(0.12, 0.32, l);                           // not in daylight, not on a bright cloud
    float k = smoothstep(thr, thr * 2.0, pk.a) * dark;
    vec2 sz = uLed.xy;
    for (int dj = -1; dj <= 1; dj++) for (int di = -1; di <= 1; di++) {     // one star per neighbourhood: the brightest wins, so they read as stars and not as noise
      vec2 q = id + vec2(float(di), float(dj));
      if ((di != 0 || dj != 0) && q.x >= 0.0 && q.y >= 0.0 && q.x < sz.x && q.y < sz.y) {
        float a = texel(uPeak, q, sz).a;
        if (a > pk.a || (a == pk.a && (dj < 0 || (dj == 0 && di < 0)))) k = 0.0;
      }
    }
    c = mix(c, max(c, pk.rgb * (uStars > 1.5 ? 1.5 : 1.2) + vec3(0.04) * k), k);
  }
  if (uOverlayOn > 0.5) {                                                   // drawn per LED, after averaging, so its pixels stay whole LEDs
    vec4 o = texel(uOverlay, vec2(id.x, uLed.y - 1.0 - id.y), uLed.xy);
    c = mix(c, o.rgb, o.a);
  }
  oColor = vec4(c * (lit + 0.035) * uLed.w, 1.0);
}`;

// ------------------------------------------------------------- composite ---
// The sky, the ground and the weather are drawn by two programs into the same picture, because one program with all of it is too big for a small GPU (the Pi Zero's
// cannot fit it in its registers, and draws nothing). Each has the whole of what it needs and nothing else; they share the pieces below. The sky program draws every pixel
// that is not wholly terrain; the terrain program draws every pixel that is not wholly sky and blends over it by how much of the pixel is terrain (only the one-pixel
// edge of the skyline is both). To change the sky or the weather, change SCENE_SKY; the ground, SCENE_TERRAIN; what both need, SCENE_HEAD and SCENE_SETUP.
const SCENE_HEAD = `${ATMOS_COMMON}
${SKY_LOOKUP}
${DISPLAY_FNS}
${CONSTS_LOOKUP}
uniform sampler2D uMilky;
uniform sampler2D uMoonTex;
uniform sampler2D uNoise;
uniform sampler2D uSkyline;   // RGBA16F, 1 row: elevation of near/mid/far ridge per azimuth
uniform sampler2D uAdapt;

uniform vec2  uRes;
uniform mat3  uCam;           // camera -> world: columns right, up, forward
uniform vec2  uTan;           // tan(fov/2) horizontally, vertically
uniform mat3  uEqj;           // J2000 equatorial -> world
uniform vec3  uSunDir;
uniform vec3  uMoonDir;
uniform vec3  uMoonPole;      // lunar north pole, world
uniform float uMoonElon;      // sub-Earth selenographic longitude, rad
uniform float uMoonAngR;      // drawn angular radius, rad
uniform float uMoonLux;       // illuminance used to light the lunar surface (= sun)
uniform float uEarthshine;    // lux on the dark side
uniform float uSunDisc;       // disc brightness in display units (post exposure)
uniform float uSunAngR;
uniform float uMWLum;         // Milky Way peak luminance, cd/m^2
uniform float uKey;           // exposure key
uniform float uBoost;         // night brightness multiplier
uniform float uTime;          // seconds, for cloud drift / water
uniform vec3  uCover;         // cloud cover: low, mid, high 0..1
uniform float uCloudDark;     // 0..1 storm darkening
uniform vec2  uWind;          // km/s (east, north)
uniform float uVisKm;         // meteorological visibility
uniform float uFog;           // 0..1 ground fog
uniform float uPrecip;        // 0 none, 1 heavy
uniform float uSnow;          // 0 rain, 1 snow
uniform float uDpr;
uniform vec3  uGround;        // ground albedo
uniform vec3  uGround2;       // second ground colour (patches of dry / bare / different cover)
uniform float uWet;           // 0..1 wet ground (rain)
uniform vec4  uWaveA;         // wind sea: significant height m, period s, travel direction (x east, z north)
uniform vec4  uWaveB;         // swell, same layout
uniform vec4  uSea;           // wind speed m/s, foam amount 0..1, wind direction x, z
uniform float uSwellH;        // how far the swell lifts the horizon, rad
uniform float uLandType;      // 0 land, 1 ocean
uniform vec3  uHaze;          // atmospheric perspective for near/mid/far ridges
uniform float uEyeH;          // eye height above local ground, km
uniform float uDip;           // horizon dip, rad
uniform float uAdaptScale;
uniform float uFrame;
uniform float uDither;                 // how many steps of the 8-bit picture the dither spans (1 = one step either way)

in vec2 vUv;
out vec4 oColor;

const float SUN_LUX_MIN = 1.0;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float lodFor(float footprintM, float tileM) {
  return clamp(log2(max(footprintM / tileM * 256.0, 1.0)), 0.0, 8.0);
}


// per-pixel values shared by the terrain and sky shaders (assigned in setup)
float swellUp;
float La, expo, pixM, az, u;
vec3 sk, hdir, hazeL, zenL, ambLux, sunIg, moonIg;

vec3 gD;                 // this pixel's direction, how much of it is terrain (0 sky .. 1), and which terrain layer (setup())
float gCov;
int gLayer;
`;

const SCENE_CLOUDS = `// ---- clouds ----
float cloudShape(vec2 uv, float cover, float lod, float sharp) {
  vec4 n = noiseLod(uNoise, uv, lod);
  float base = n.r * 0.62 + n.g * 0.28 + n.b * 0.10;
  float th = mix(0.74, 0.02, pow(cover, 0.85));
  float d = smoothstep(th, th + sharp, base);
  // erode the edges with finer detail; thin edges lose more than the dense core
  float fine = noiseLod(uNoise, uv * 3.7 + 0.31, lod).b;
  return clamp(d - (1.0 - fine) * 0.35 * (1.0 - d), 0.0, 1.0);
}

// Returns premultiplied-ish (rgb radiance in cd/m^2, alpha).
vec4 cloudLayer(vec3 d, float cover, float H, float tile, vec2 stretch, float tau,
                float lowCover, vec3 ambLux, vec3 hazeL, float windMul) {
  if (cover < 0.01 || d.y <= 0.0) return vec4(0.0);
  float t = H / d.y;                                   // km along the ray
  vec2 xz = d.xz * t + uWind * (uTime * windMul);
  vec2 uv = xz / tile;
  uv = vec2(uv.x * stretch.x, uv.y * stretch.y);
  float pix = 2.0 * uTan.y / uRes.y;
  float lod = clamp(log2(max(t * pix / max(d.y, 0.02) / tile * 256.0, 1.0)), 0.0, 8.0);

  float sharp = mix(0.16, 0.30, cover);
  float dens = cloudShape(uv, cover, lod, sharp);
  float fade = smoothstep(0.0, 0.02, d.y);
  if (dens < 0.003 || fade < 0.003) return vec4(0.0);

  // sun-facing edges: compare against density a little way toward the sun
  vec2 sdir = normalize(uSunDir.xz + vec2(1e-5));
  float ds = cloudShape(uv + vec2(sdir.x * stretch.x, sdir.y * stretch.y) * 0.012, cover, lod, sharp);
  float lit = clamp(0.55 + (dens - ds) * 5.0, 0.0, 1.0);

  float thick = smoothstep(0.25, 1.0, dens);
  vec3 sunI  = sunTransAt(H, uSunA.z) * uSunA.w;
  vec3 moonI = sunTransAt(H, uMoonA.z) * uMoonA.w;

  float cs = dot(d, uSunDir);
  float fwd = miePhase(cs) * 0.12;                       // silver lining, strongest on thin edges
  float body = mix(1.0, 0.10, thick);                    // thick cloud passes almost no direct sun
  vec3 E = sunI * (0.30 + 0.70 * lit) * body
         + sunI * fwd * (1.0 - thick) * 0.5
         + moonI * (0.35 + 0.65 * lit) * body
         + mix(ambLux, vec3(lumaOf(ambLux)), 0.25 + 0.6 * thick) * mix(0.9, 0.5, thick);   // thick cloud scatters neutral light
  E *= 1.0 - 0.70 * uCloudDark;
  vec3 rad = 0.85 * E / PI;

  // aerial perspective toward the horizon
  float aer = 1.0 - exp(-t / max(uVisKm * 0.8, 1.0));
  rad = mix(rad, hazeL, clamp(aer, 0.0, 1.0));

  float a = (1.0 - exp(-dens * tau)) * fade;
  return vec4(rad, a);
}

`;

const SCENE_SKY = `// ---- moon ----
vec4 moonDisc(vec3 d, float expo) {
  float cm = dot(d, uMoonDir);
  float sr = sin(uMoonAngR);
  if (cm < cos(uMoonAngR * 1.25)) return vec4(0.0);
  vec3 up = abs(uMoonDir.y) > 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 rt = normalize(cross(up, uMoonDir));
  vec3 up2 = cross(uMoonDir, rt);
  vec2 q = vec2(dot(d, rt), dot(d, up2)) / sr;
  float r2 = dot(q, q);
  if (r2 > 1.5) return vec4(0.0);
  float cov = 1.0 - smoothstep(0.97, 1.0, sqrt(r2));
  if (cov <= 0.0) return vec4(0.0);
  float z = sqrt(max(0.0, 1.0 - r2));
  vec3 toObs = -uMoonDir;
  // flip x: looking at the moon from outside, +x of the image is toward 'rt'
  vec3 n = normalize(q.x * rt + q.y * up2 + z * toObs);

  // selenographic coordinates
  vec3 P = normalize(uMoonPole);
  float lat = asin(clamp(dot(n, P), -1.0, 1.0));
  vec3 S = toObs;
  vec3 Seq = normalize(S - P * dot(S, P));
  vec3 Eeq = normalize(cross(P, Seq));
  vec3 nEq = normalize(n - P * dot(n, P));
  float lam = atan(dot(nEq, Eeq), dot(nEq, Seq));
  float lon = uMoonElon + lam;
  vec2 tuv = vec2(0.5 + lon / (2.0 * PI), 0.5 - lat / PI);
  vec3 alb = texture(uMoonTex, tuv).rgb;
  alb = pow(alb, vec3(1.15)) * 0.30;     // normalise the texture to ~0.12 mean geometric albedo

  float mu0 = max(dot(n, uSunDir), 0.0);
  float mu = max(dot(n, toObs), 1e-3);
  float ls = mu0 / (mu0 + mu);           // Lommel-Seeliger: flat full-moon disc
  vec3 Ts = transmittance(BOT + uCamH, clamp(sin(uMoonA.z), -0.2, 1.0));
  vec3 phys = alb * (uMoonLux * 2.0 * ls + uEarthshine) / PI * Ts;
  // Physically the sunlit moon is ~3000 cd/m^2, which a night-time exposure would
  // blow out to a white blob. Cap it in display space so the maria stay visible;
  // in daylight the physical value is smaller than the cap and wins.
  vec3 cap = (alb / 0.1) * (2.0 * ls) * 0.85 * Ts / expo;
  return vec4(min(phys, cap + vec3(uEarthshine) * alb / PI), cov);
}

// Everything above the skyline. skyMask = how much of the sky is still open to stars.
vec3 shadeSky(vec3 d, out float skyMask) {
  vec3 L;
  skyMask = 1.0;
  L = skyLum(d);

  // Milky Way (equatorial map) behind everything, extinguished near the horizon
  vec3 eq = transpose(uEqj) * d;
  float ra = atan(eq.y, eq.x);
  float dec = asin(clamp(eq.z, -1.0, 1.0));
  vec2 muv = vec2(ra / (2.0 * PI), 0.5 - dec / PI);
  float mw = texture(uMilky, muv).r;
  float mott = noiseLod(uNoise, muv * vec2(10.0, 5.0), 1.5).g;
  mw = clamp(mw * (0.45 + 1.1 * mott), 0.0, 1.4);
  float sE = max(d.y, 0.0);
  float am = 1.0 / (sE + 0.025 * exp(-11.0 * sE));
  L += vec3(0.85, 0.92, 1.1) * mw * uMWLum * exp(-0.22 * am) * step(-0.01, d.y);

  // sun: disc + soft glare, tinted by the atmosphere's own transmittance
  float cs = dot(d, uSunDir);
  float angS = acos(clamp(cs, -1.0, 1.0));
  vec3 Ts = transmittance(BOT + uCamH, clamp(sin(uSunA.z), -0.2, 1.0));
  float limb = sqrt(max(0.0, 1.0 - pow(angS / uSunAngR, 2.0)));
  float disc = 1.0 - smoothstep(uSunAngR * 0.96, uSunAngR * 1.04, angS);
  float glare = 0.05 / (1.0 + pow(angS / (uSunAngR * 4.0), 2.0));
  float sunUp = smoothstep(-0.02, 0.01, uSunA.z);
  L += Ts * (uSunDisc / expo) * (disc * mix(0.62, 1.0, limb) + glare) * sunUp;

  // moon
  vec4 mo = moonDisc(d, expo);
  L += mo.rgb * mo.a;               // added on top: the air in front of the moon still glows
  skyMask *= 1.0 - mo.a;
  return L;
}

`;

const SCENE_TERRAIN = `// ---- terrain ----
vec3 terrainLit(vec3 albedo, vec3 n, vec3 sunI, vec3 moonI, vec3 ambLux) {
  float ns = max(dot(n, uSunDir), 0.0);
  float nm = max(dot(n, uMoonDir), 0.0);
  vec3 E = sunI * ns + moonI * nm + ambLux * (0.55 + 0.45 * n.y);
  return albedo * E / PI;
}

// Directional wave train (deep-water dispersion, wavelength = 1.56 T^2). Five components from the peak
// wavelength down to ~1/8 of it, spread over about +-45 degrees, so there are long faces and shorter
// chop riding on them. Returns surface slope and height. Components shorter than ~3 pixels fade out,
// which keeps the far sea from shimmering. The slope is exaggerated a little (visual gain): real
// swell is gentle, but at a grazing eye height small tilts swing the reflected sky a long way.
void waveTrain(vec4 W, vec2 p, float fp, out vec2 slope, out float hgt) {
  slope = vec2(0.0);
  hgt = 0.0;
  if (W.x < 0.02) return;
  float lam0 = 1.56 * W.y * W.y;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float f = 1.0 / (1.0 + 0.55 * fi * fi * 0.5 + 0.6 * fi);          // 1, 0.62, 0.39, 0.25, 0.17
    float ang = (hash12(vec2(fi, 4.0)) - 0.5) * (0.6 + 0.35 * fi);
    vec2 dv = vec2(W.z * cos(ang) - W.w * sin(ang), W.z * sin(ang) + W.w * cos(ang));
    float lam = lam0 * f;
    float k = 2.0 * PI / lam;
    float om = sqrt(9.81 * k);
    float fade = clamp(lam / (fp * 3.0) - 1.0, 0.0, 1.0);
    float a = W.x * 0.20 * pow(f, 1.15) * fade;
    float ph = k * dot(dv, p) - om * uTime + fi * 2.1;
    hgt += a * sin(ph);
    slope += dv * (a * k * cos(ph) * 2.4);
  }
}

// Terrain, water and city layers; layer 0 is the nearest. The sea and the land are one program, or (TERRAIN_LAND, TERRAIN_OCEAN: a small GPU's driver could not fit both) two,
// each of which leaves the other's pixels to the other.
bool oceanPixel(int layer, vec3 d) { return layer == 0 && d.y < -uDip + 0.0002 + swellUp && abs(uLandType - 1.0) < 0.1; }
vec3 shadeTerrain(int layer, vec3 d) {
  vec3 L = vec3(0.0);
  bool plane = layer == 0 && d.y < -uDip + 0.0002 + swellUp;
  if (plane && abs(uLandType - 1.0) < 0.1) {
#ifndef TERRAIN_LAND
    // ocean: Fresnel mix of the reflected sky and a dark body, wind-roughened glitter
    float tdist = uEyeH / max(-d.y, 1e-4);              // km to the water
    vec2 wp = d.xz * tdist * 1000.0;                    // metres
    float fp = pixM * tdist * 1000.0 / max(-d.y, 0.003);
    vec2 w1 = noiseLod(uNoise, wp / 61.0 + vec2(uTime * 0.012, uTime * 0.007), lodFor(fp, 61.0)).rg - 0.5;
    vec2 w2 = noiseLod(uNoise, wp / 17.0 - vec2(uTime * 0.025, 0.0), lodFor(fp, 17.0)).rg - 0.5;
    vec2 w3 = noiseLod(uNoise, wp / 4.3 + vec2(0.0, uTime * 0.05), lodFor(fp, 4.3)).rg - 0.5;
    vec2 w4 = noiseLod(uNoise, wp / 1.3 - vec2(uTime * 0.09, uTime * 0.03), lodFor(fp, 1.3)).rg - 0.5;
    // small ripples roughen with the wind and with rain; the real waves come from the wave trains
    float ripK = clamp(0.25 + uSea.x / 10.0, 0.25, 1.4) * (1.0 + 1.2 * uWet);
    vec2 slope = (w1 * 0.25 + w2 * 0.5 + w3 * 0.8 + w4 * 0.7) * 0.45 * ripK;
    vec2 sA, sB; float hA, hB;
    waveTrain(uWaveA, wp, fp, sA, hA);
    waveTrain(uWaveB, wp, fp, sB, hB);
    slope += sA + sB;
    vec3 nrm = normalize(vec3(slope.x, 1.0, slope.y));
    vec3 rd = reflect(d, nrm);
    rd.y = abs(rd.y);
    float F = 0.02 + 0.98 * pow(1.0 - clamp(dot(nrm, -d), 0.0, 1.0), 5.0);
    vec3 refl = skyLum(rd);
    // sun glitter: Gaussian lobe on the half vector (Cox-Munk style); a rougher sea widens the path
    vec3 hh = normalize(uSunDir - d);
    float sig2 = 0.004 + 0.0012 * uSea.x;
    float glint = exp(-(1.0 - clamp(dot(nrm, hh), 0.0, 1.0)) / sig2);
    vec3 Ts = transmittance(BOT + uCamH, clamp(sin(uSunA.z), -0.2, 1.0));
    refl += Ts * (uSunDisc / expo) * glint * 0.9 * step(0.0, uSunA.z + 0.02);
    vec3 body = vec3(0.010, 0.040, 0.055) * (sunIg * max(uSunDir.y, 0.0) + moonIg * max(uMoonDir.y, 0.0) + ambLux) / PI;
    L = mix(body, refl, F);
    // whitecaps on the steepest crests once the wind is up, with streaks blown along the wind
    float hgtN = (hA + hB) / max(0.45 * (uWaveA.x + uWaveB.x) + 0.05, 0.05);
    vec2 wdir = uSea.zw;
    float streak = noiseLod(uNoise, vec2(dot(wp, wdir) / 55.0, dot(wp, vec2(-wdir.y, wdir.x)) / 7.0), lodFor(fp, 7.0)).g;
    float fnoise = noiseLod(uNoise, wp / 3.1 + 0.37, lodFor(fp, 3.1)).b;
    float steep = length(sA + sB) * 7.0;                       // waves break where they are steep as well as high
    float foam = smoothstep(0.62, 1.05, 0.55 * hgtN + steep + (fnoise - 0.5) * 0.8 + (streak - 0.5) * 0.7) * uSea.y;
    foam *= mix(1.0, 0.55, smoothstep(2.0, 40.0, fp));        // far foam averages into a pale sheen instead of aliasing
    vec3 foamL = vec3(0.82, 0.86, 0.88) * (sunIg * max(uSunDir.y, 0.0) + moonIg * max(uMoonDir.y, 0.0) + ambLux) / PI;
    L = mix(L, foamL, foam);
    if (uWet > 0.05 && tdist < 0.05) {                          // raindrop rings
      vec2 rp = wp * 0.8;
      vec2 cell = floor(rp);
      vec2 fc = fract(rp) - 0.5 - (vec2(hash12(cell + 7.3), hash12(cell + 3.1)) - 0.5) * 0.5;
      float tt = fract(uTime * 0.9 + hash12(cell));
      float ring = exp(-pow((length(fc) - tt * 0.45) / 0.035, 2.0)) * (1.0 - tt);
      L += vec3(ring * 0.30 * uWet * (1.0 - smoothstep(0.02, 0.05, tdist)) / expo);
    }
    L = mix(L, hazeL, smoothstep(0.004, 0.0, -d.y - uDip) * 0.5);
#endif
  } else {
#ifndef TERRAIN_OCEAN
    float ridgeTop = layer == 0 ? sk.r : (layer == 1 ? sk.g : sk.b);
    float depthMix = layer == 0 ? 0.0 : (layer == 1 ? uHaze.y : uHaze.z);
    vec3 n;
    vec3 alb = uGround;
    vec3 emit = vec3(0.0);
    if (plane) {
      n = vec3(0.0, 1.0, 0.0);
      float tdist = uEyeH / max(-d.y, 1e-4);
      vec2 gp = d.xz * tdist * 1000.0;                  // metres
      float fp = pixM * tdist * 1000.0 / max(-d.y, 0.003);
      float sp = noiseLod(uNoise, gp / 6.0, lodFor(fp, 6.0)).b * 0.6 + noiseLod(uNoise, gp / 1.1, lodFor(fp, 1.1)).a * 0.4;
      float sm = exp(-tdist * 4.0);
      // patchy cover: two ground colours blended by large and medium scale noise
      float pa = noiseLod(uNoise, gp / 37.0 + 0.2, lodFor(fp, 37.0)).r;
      float pb = noiseLod(uNoise, gp / 9.0 + 0.6, lodFor(fp, 9.0)).g;
      alb = mix(uGround, uGround2, smoothstep(0.38, 0.62, pa * 0.7 + pb * 0.3));
      alb *= mix(1.0, 0.62 + 0.9 * sp, sm);
      alb = mix(alb, vec3(0.30, 0.28, 0.25), step(0.985, hash12(floor(gp * 7.0))) * sm * 0.55);   // pebbles
      // wet ground: darker, with a sky-reflecting sheen that grows toward grazing angles and in puddles
      float pud = smoothstep(0.55, 0.72, pb) * uWet;
      alb *= 1.0 - 0.35 * uWet;
      float cosv = max(-d.y, 0.0);
      float Fg = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
      emit += skyLum(vec3(d.x, -d.y, d.z)) * Fg * (0.14 * uWet + 0.5 * pud);
      if (uWet > 0.05 && tdist < 0.03) {                  // raindrop ripples close to the camera
        vec2 rp = gp * 0.8;
        vec2 cell = floor(rp);
        vec2 fc = fract(rp) - 0.5 - (vec2(hash12(cell + 7.3), hash12(cell + 3.1)) - 0.5) * 0.5;
        float tt = fract(uTime * 0.9 + hash12(cell));
        float ring = exp(-pow((length(fc) - tt * 0.45) / 0.035, 2.0)) * (1.0 - tt);
        emit += vec3(ring * 0.30 * uWet * (1.0 - smoothstep(0.01, 0.03, tdist)) / expo);
      }
      depthMix = clamp(tdist * 3.0, 0.0, 1.0) * uHaze.x + depthMix;
    } else {
      // ridge face: tilt the normal by the local skyline slope so slopes catch the sun differently
      float du = 6.0 / 2048.0;
      vec3 sl = skylineAt(uSkyline, u - du);
      vec3 sr = skylineAt(uSkyline, u + du);
      float dh = (layer == 0 ? sr.r - sl.r : (layer == 1 ? sr.g - sl.g : sr.b - sl.b)) / (2.0 * du * 2.0 * PI);
      vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), hdir));
      n = normalize(-hdir * 0.75 + vec3(0.0, 0.55, 0.0) - side * clamp(dh, -3.0, 3.0) * 0.6);
      float hz = clamp(d.y / max(ridgeTop, 0.004), 0.0, 1.0);          // 0 at the foot, 1 at the crest
      float rr = noiseLod(uNoise, vec2(az * 7.0, d.y * 70.0), 1.0).g;
      vec3 rock = vec3(0.26, 0.23, 0.20);
      alb = mix(alb, rock, smoothstep(0.25, 0.8, hz) * (0.4 + 0.6 * float(layer > 0)));
      alb *= 0.65 + 0.7 * rr;
      float snow = smoothstep(0.78, 0.92, hz + (rr - 0.5) * 0.25) * step(0.06, ridgeTop);
      alb = mix(alb, vec3(0.8, 0.82, 0.86), snow);
      depthMix *= mix(1.3, 0.65, hz);
      if (abs(uLandType - 2.0) < 0.1) {
        // city: dark blocks with lit windows after dusk
        alb = vec3(0.14, 0.14, 0.15) * (0.7 + 0.6 * rr);
        vec2 cell = floor(vec2(az * 2400.0, d.y * 2600.0));
        float lit = step(0.80, hash12(cell)) * step(0.35, hz * 0.0 + hash12(cell + 9.0));
        float night = 1.0 - smoothstep(-0.14, 0.01, uSunA.z);
        emit = vec3(1.0, 0.78, 0.45) * lit * night * 1.4 / expo * 0.35;
      }
    }
    vec3 lit = terrainLit(alb, n, sunIg, moonIg, ambLux) + emit;
    float fogK = clamp(uFog * (0.35 + 0.65 * float(layer + 1) / 3.0), 0.0, 1.0);
    L = mix(lit, hazeL, clamp(depthMix + fogK, 0.0, 1.0));
#endif
  }
  return L;
}

`;

// The values both programs start from: the direction, exposure, the skyline, which side of it the pixel is on, and the light that reaches the ground.
const SCENE_SETUP = `void setup() {
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  vec3 d = normalize(uCam * normalize(vec3(ndc.x * uTan.x, ndc.y * uTan.y, 1.0)));

  // Display adaptation is deliberately incomplete: a pure auto-exposure would make
  // a moonlit night as bright as dusk. Compress the curve so the sky stays dark at
  // night (but readable), and let the user lift it with uBoost.
  La = exp(adaptLog(uAdapt));
  expo = calcExpo(La, uKey, uBoost);

  pixM = 2.0 * uTan.y / uRes.y;                         // radians per pixel
  az = atan(d.x, d.z);
  u = az / (2.0 * PI) + 0.5;
  sk = skylineAt(uSkyline, u);             // near, mid, far ridge elevations (cumulative)
  // far swell crests rise and fall along the sea horizon
  swellUp = 0.0;
  if (abs(uLandType - 1.0) < 0.1) {
    swellUp = uSwellH * (0.55 + 0.45 * sin(az * 47.0 - uTime * 0.9) * (0.6 + 0.4 * sin(az * 13.0 + uTime * 0.5)));
    sk += vec3(swellUp);
  }

  int layer = -1;
  if (d.y < sk.r) layer = 0;
  else if (d.y < sk.g) layer = 1;
  else if (d.y < sk.b) layer = 2;

  hdir = normalize(vec3(d.x, 0.0, d.z) + vec3(1e-6, 0.0, 0.0));
  hazeL = hazeAt(az);                                   // these five are the same every frame for all pixels, or for all pixels in one direction: FRAG_CONSTS worked them out
  zenL = constAt(0.0);
  ambLux = constAt(1.0);
  sunIg  = constAt(2.0);
  moonIg = constAt(3.0);

  // Analytic antialiasing of the outermost silhouette (there is no MSAA here): within a
  // pixel of the skyline, shade both sides and blend by coverage.
  int topLayer = sk.b > sk.g ? 2 : (sk.g > sk.r ? 1 : 0);
  float edge = (sk.b - d.y) / pixM;                      // pixels below the silhouette
  // How much of the pixel is terrain: all of it below the silhouette, none above, a blend within a pixel of it. Sky and terrain are each shaded at most once (a GPU that
  // cannot skip work shades both only on that one-pixel edge; and each is in the program once, which matters on a small GPU: it has to fit it).
  float cov = (layer >= 0 && edge > 1.0) ? 1.0 : ((layer < 0 && edge < -1.0) ? 0.0 : clamp(edge + 0.5, 0.0, 1.0));
  gD = d; gCov = cov; gLayer = layer >= 0 ? layer : topLayer;
}

// Exposure, tonemap, the falling rain or snow, a little dither: the picture's colour for a luminance (cd/m^2), with alpha as its fourth channel.
vec4 finish(vec3 L, float alpha) {
  // ---------- precipitation overlay (screen space, display-referred) ----------
  vec3 rainRel = vec3(0.0);
  if (uPrecip > 0.01) {
    vec2 sp = gl_FragCoord.xy / uDpr;
    for (int k = 0; k < 2; k++) {
      float sc = k == 0 ? 1.0 : 0.6;
      float cellW = mix(5.0, 11.0, uSnow) / sc;
      float slant = (1.0 - uSnow) * 0.12;
      vec2 g = vec2(sp.x + sp.y * slant, sp.y);
      float cx = floor(g.x / cellW);
      float rnd = hash12(vec2(cx, float(k) * 17.0));
      float len = mix(46.0, 8.0, uSnow) * sc;
      float speed = mix(1100.0, 70.0, uSnow) * (0.75 + 0.5 * rnd) * sc;
      float y = fract((g.y + uTime * speed) / (len * 5.0) + rnd);       // position along the cycle
      float fx = fract(g.x / cellW) - 0.5;
      float on = step(1.0 - uPrecip * 0.8, hash12(vec2(cx, 3.3 + float(k))));
      float across = exp(-pow(fx * cellW / mix(0.55, 2.6, uSnow), 2.0));
      float along = uSnow > 0.5 ? exp(-pow((y - 0.5) * len * 5.0 / 3.0, 2.0))
                                : smoothstep(0.0, 0.2, y) * (1.0 - smoothstep(0.2, 0.2 + 1.0 / 5.0, y));
      rainRel += vec3(0.55, 0.6, 0.68) * across * along * on * 0.20 * sc;
    }
  }

  // ---------- exposure, scotopic shift, tonemap ----------
  vec3 c = toDisplay(L, expo, rainRel);
  // triangular dither avoids banding in the dark gradients
  float n1 = hash12(gl_FragCoord.xy + uFrame * 1.31);
  float n2 = hash12(gl_FragCoord.yx + uFrame * 2.17 + 11.0);
  c += (n1 + n2 - 1.0) * uDither / 255.0;

  return vec4(clamp(c, 0.0, 1.0), alpha);
}`;

/** The sky: everything above the skyline (and the sun, moon, stars' mask, clouds, fog). */
export const FRAG_SCENE_SKY = `#version 300 es
${SCENE_HEAD}
${SCENE_SKY}
${SCENE_SETUP}
void main() {
  setup();
  if (gCov >= 1.0) discard;                      // wholly terrain: the terrain program has it
  float m;
  vec3 L = shadeSky(gD, m);
  oColor = finish(L, m);                         // alpha: how much of the sky is open to stars
}`;

/**
 * One cloud layer (the three are the same program drawn three times with different numbers, high to low), blended over the sky by the layer's own coverage. Blending
 * happens on the finished picture rather than in brightness (a cloud's edge is a little darker than if the two were mixed before the tonemap), because a program with the
 * sky and three clouds in it is too big for a small GPU. The fourth channel, the stars' sky-visibility, shrinks by the cloud's coverage.
 */
export const FRAG_SCENE_CLOUD = `#version 300 es
${SCENE_HEAD}
${SCENE_CLOUDS}
${SCENE_SETUP}
uniform vec4 uCloudP;      // this layer: cover, height (km), tile (km), optical depth
uniform vec4 uCloudQ;      // stretch x, stretch y, how fast the wind moves it
void main() {
  setup();
  if (gCov >= 1.0) discard;
  vec4 c = cloudLayer(gD, uCloudP.x, uCloudP.y, uCloudP.z, uCloudQ.xy, uCloudP.w, uCover.x, ambLux, hazeL, uCloudQ.z);
  if (c.a < 0.003) discard;
  oColor = finish(c.rgb, c.a);
}`;

/** Fog: the haze colour over the sky by the fog's share (thick near the horizon). Drawn only when there is fog. */
export const FRAG_SCENE_FOG = `#version 300 es
${SCENE_HEAD}
${SCENE_SETUP}
void main() {
  setup();
  if (gCov >= 1.0) discard;
  float fogMix = max(0.75 * uFog * uFog, uFog * 0.92 * (1.0 - smoothstep(0.0, 0.25, gD.y)));
  oColor = finish(hazeL, fogMix);
}`;

/** The ground, water and city layers, blended over the sky by coverage (alpha: the share of the pixel that is terrain). */
const TERRAIN_MAIN = `${SCENE_HEAD}
${SCENE_TERRAIN}
${SCENE_SETUP}
void main() {
  setup();
  if (gCov <= 0.0) discard;                      // wholly sky
#if defined(TERRAIN_OCEAN)
  if (!oceanPixel(gLayer, gD)) discard;          // (the land program has the rest)
#elif defined(TERRAIN_LAND)
  if (oceanPixel(gLayer, gD)) discard;           // (the sea program has it)
#endif
  oColor = finish(shadeTerrain(gLayer, gD), gCov);
}`;
export const FRAG_SCENE_TERRAIN = `#version 300 es\n${TERRAIN_MAIN}`;
/** The ground in two programs for a small GPU: 'land' (everything but the sea) and 'ocean' (the sea; drawn only when the landscape is the sea). */
export const fragTerrain = (kind) => `#version 300 es\n#define TERRAIN_${kind.toUpperCase()} 1\n${TERRAIN_MAIN}`;

export { VERT_FULLSCREEN };
