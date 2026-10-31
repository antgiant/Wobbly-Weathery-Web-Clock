// Scene shaders: sky composite, stars, auto exposure, procedural noise.
//
// World frame everywhere: x = East, y = Up, z = North. Azimuth is measured
// from North towards East (dir = (sin az cos el, sin el, cos az cos el)).
// Luminance is carried in cd/m^2 until the final exposure + tonemap, so stars,
// clouds, the moon and the sky can all be balanced against each other
// physically (limiting magnitude, scotopic shift, moonlight ...).

import { ATMOS_COMMON, VERT_FULLSCREEN } from './glsl-atmosphere.js';

// ---------------------------------------------------------------- shared ---
// Sky radiance lookup used by the composite, the star vertex shader and the
// exposure pass.
export const SKY_LOOKUP = `
uniform sampler2D uTrans;
uniform sampler2D uSkySun;
uniform sampler2D uSkyMoon;
uniform vec4 uSunA;       // sin(az), cos(az), elevation (rad), illuminance (lux)
uniform vec4 uMoonA;
uniform vec3 uNightLum;   // zenith luminance of airglow + zodiacal + starlight, cd/m^2
uniform vec3 uLPLum;      // zenith luminance of artificial sky glow, cd/m^2
uniform float uCamH;      // km above sea level

vec3 transmittance(float r, float mu) { return texture(uTrans, transUv(r, mu)).rgb; }

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
  if (uSunA.w > 0.0)  L += texture(uSkySun,  skyUv(e, dot(hn, uSunA.xy))).rgb  * uSunA.w;
  if (uMoonA.w > 0.0) L += texture(uSkyMoon, skyUv(e, dot(hn, uMoonA.xy))).rgb * uMoonA.w;
  float ec = max(e, 0.0);
  float sz = cos(ec);
  float vr = 1.0 / sqrt(max(1.0 - 0.9693 * sz * sz, 0.04));   // van Rhijn airglow layer
  L += uNightLum * vr;
  L += uLPLum * (1.0 + 2.5 * pow(1.0 - sin(ec), 2.0));        // glow domes toward the horizon
  return L;
}
float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
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

// ----------------------------------------------------------------- noise ---
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
  float prev = texelFetch(uPrev, ivec2(0), 0).r;
  float k = 1.0 - exp(-uDt / max(uTau, 1e-3));
  float cur = uSnap > 0.5 ? target : mix(prev, target, k);
  oColor = vec4(cur, target, 0.0, 1.0);
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
export const FRAG_BLIT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uMask;
uniform vec4 uGlass;       // x frost 0..1, y mode (0 off, 1 liquid, 2 stained, 3 LED), z stroke width (canvas px), w time
uniform vec4 uMaskRect;    // clock bounding box in canvas uv, y down: x, y, w, h
uniform vec2 uMaskPx;      // mask texture size in texels
uniform vec2 uRes;         // canvas size in px
uniform vec3 uLight;       // xy: screen direction towards the light (y up), z: strength 0..1
uniform vec3 uLightCol;
uniform vec4 uGlow;        // x: light from inside the glass, 0..1
uniform vec3 uGlowCol;     // colour of that light (liquid glass)
uniform vec3 uInk;         // flat ink colour (solid clock style while the LED panel is on)
uniform float uContrast;   // least luminance contrast ratio between the digits and the sky around them (0 = off)
in vec2 vUv;
out vec4 oColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) { return vec2(hash21(p), hash21(p + 17.31)); }

float maskAt(vec2 uv, float lod) {
  vec2 m = (vec2(uv.x, 1.0 - uv.y) - uMaskRect.xy) / uMaskRect.zw;
  return textureLod(uMask, m, lod).a;
}
float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 sceneAt(vec2 uv, float lod) { return textureLod(uTex, uv, lod).rgb; }

float linLum(vec3 c) { return dot(pow(max(c, 0.0), vec3(2.2)), vec3(0.2126, 0.7152, 0.0722)); }

// The time must stay readable on any sky and for any eyes. Colour-blind readers can still see differences in
// brightness, so the guarantee is about luminance: compared with the sky next to each pixel (four samples a stroke
// away plus the sky under it), the glass is pushed lighter or darker, whichever is closer and possible, until
// the contrast ratio (the WCAG one) reaches uContrast. Hue is kept as far as the brightness allows.
vec3 ensureContrast(vec3 c, vec2 uv, float stroke, bool allowLighter) {
  if (uContrast < 1.01) return c;
  vec2 px = 1.0 / uRes;
  float lod = max(log2(stroke * 0.4 * float(textureSize(uTex, 0).x) / uRes.x), 0.0);
  float r = stroke * 0.95;
  float l0 = linLum(sceneAt(uv, lod));
  float l1 = linLum(sceneAt(uv + vec2(r * px.x, 0.0), lod));
  float l2 = linLum(sceneAt(uv - vec2(r * px.x, 0.0), lod));
  float l3 = linLum(sceneAt(uv + vec2(0.0, r * px.y), lod));
  float l4 = linLum(sceneAt(uv - vec2(0.0, r * px.y), lod));
  float hiL = max(max(max(l0, l1), max(l2, l3)), l4), loL = min(min(min(l0, l1), min(l2, l3)), l4);
  float R = uContrast;
  c = clamp(c, 0.0, 1.0);
  float Lg = linLum(c);
  float hiN = R * (hiL + 0.05) - 0.05;           // brightness needed to beat the brightest sky nearby by lighter
  float loN = (loL + 0.05) / R - 0.05;           // brightness allowed to beat the darkest sky nearby by darker
  if (Lg >= hiN || Lg <= loN) return c;           // already readable
  bool canHi = hiN <= 1.0, canLo = loN >= 0.0;
  bool lighter;
  if (canHi && canLo) lighter = (hiN - Lg) < (Lg - loN);
  else if (canHi) lighter = true;
  else if (canLo) lighter = false;
  else lighter = (1.05 / (hiL + 0.05)) > ((loL + 0.05) / 0.05);     // sky spans bright and dark: take the better ratio
  if (lighter && !allowLighter) { if (canLo) lighter = false; else return c; }   // a lit tube keeps its colours: no washing it out to white
  vec3 lin = pow(c, vec3(2.2));
  if (lighter) lin = mix(lin, vec3(1.0), clamp((min(hiN, 1.0) - Lg) / max(1.0 - Lg, 1e-3), 0.0, 1.0));
  else lin *= clamp(max(loN, 0.0) / max(Lg, 1e-4), 0.0, 1.0);
  return pow(lin, vec3(1.0 / 2.2));
}

void body() {
  vec3 base = texture(uTex, vUv).rgb;
  float mode = uGlass.y;
  if (mode < 0.5) { oColor = vec4(base, 1.0); return; }
  if (mode > 2.5) {                                          // flat ink: the LED panel has no glass here, but the digits still need drawing
    float cv = smoothstep(0.1, 0.9, maskAt(vUv, 0.0));
    oColor = vec4(mix(base, ensureContrast(uInk, vUv, uGlass.z, true), cv), 1.0);
    return;
  }

  vec2 px = 1.0 / uRes;
  float stroke = uGlass.z;                                  // canvas px
  float maskScale = uMaskPx.x / (uMaskRect.z * uRes.x);     // mask texels per canvas px
  float lodH = max(log2(stroke * 0.30 * maskScale), 0.0);
  float lodS = max(log2(stroke * 0.9 * maskScale), 0.0);
  float lodG = max(log2(stroke * 1.5 * maskScale), 0.0);
  float glow = uGlow.x;
  bool stained = mode > 1.5;

  // soft shadow of the glass cast on the sky, away from the light
  vec2 sh = vUv - uLight.xy * stroke * 0.22 * px;
  float shadow = maskAt(sh, lodS) * (0.10 + 0.20 * uLight.z) * (1.0 - 0.7 * glow);

  float cover = maskAt(vUv, 0.0);
  float wide = maskAt(vUv, lodS);
  float halo = glow > 0.002 ? maskAt(vUv, lodG) : 0.0;     // light spilling out of the glass onto the sky
  if (cover < 0.004 && wide < 0.004 && shadow < 0.004 && halo * glow < 0.004) { oColor = vec4(base, 1.0); return; }

  // height field = blurred coverage; gradient = bevel
  float d = stroke * 0.22;
  vec2 dx = vec2(d * px.x, 0.0), dy = vec2(0.0, d * px.y);
  float h  = maskAt(vUv, lodH);
  float gx = maskAt(vUv + dx, lodH) - maskAt(vUv - dx, lodH);
  float gy = maskAt(vUv + dy, lodH) - maskAt(vUv - dy, lodH);
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
    vec4 mk = textureLod(uMask, mUv, lodH * 0.5);                      // a little blur: glass spreads the light
    emit = min(mk.rgb / max(mk.a, 0.05), vec3(1.3));
  }

  // ---- liquid glass (stained glass is the same glass with a colour in it) ----
  vec2 off = n.xy * stroke * (0.9 + 0.8 * h) * px;                    // lens-like displacement
  float lodF = frost * 6.0;
  vec3 c;
  float disp = (1.0 - frost) * 0.10 + 0.015;
  c.r = sceneAt(vUv + off * (1.0 + disp), lodF).r;
  c.g = sceneAt(vUv + off, lodF).g;
  c.b = sceneAt(vUv + off * (1.0 - disp), lodF).b;
  // frost: diffuse towards the local average sky colour and go milky; clear glass stays clear
  vec3 avg = sceneAt(vUv, 6.5);
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
  if (stained) c = ensureContrast(c, vUv, stroke, false);              // against a bright sky the glass darkens; against a dark one the lights themselves carry it
  vec3 lamp = emit * inner;
  if (stained) lamp *= 1.0 + 0.9 * pow(smoothstep(0.45, 0.98, h), 2.0);   // brightest down the middle of the tube
  c += lamp * (stained ? 1.15 : 0.80);
  if (!stained) c += emit * glow * 0.10 * (1.0 - frost * 0.4);        // faint all-over fill so thin strokes light up too

  // the body of the glass is made readable first; the glints and the rim go on top, so it still looks like glass
  if (!stained) c = ensureContrast(c, vUv, stroke, true);
  c += uLightCol * spec * mix(1.1, 0.35, frost) * (stained ? 0.7 : 1.0);   // frost scatters the glint into a soft sheen
  c += uLightCol * rim * facing * (0.30 + 0.45 * uLight.z) * mix(1.0, 0.65, frost) * (stained ? 0.8 : 1.0);
  c += uLightCol * rim * 0.05;
  c += uLightCol * exp(-pow((h - 0.62) * 5.0, 2.0)) * spec * 0.35 * (1.0 - frost);
  vec3 glass = min(c, vec3(1.6));

  // halo on the sky around lit glass
  vec3 shaded = base * (1.0 - shadow * (1.0 - cover));
  vec3 haloCol = uGlowCol;
  float haloK = 0.30;
  if (stained) {                                                      // the tube's lights colour the air around it
    vec4 hm = textureLod(uMask, (vec2(vUv.x, 1.0 - vUv.y) - uMaskRect.xy) / uMaskRect.zw, lodG);
    haloCol = hm.rgb / max(hm.a, 0.04); haloK = 0.85;
  }
  shaded += haloCol * halo * glow * (1.0 - cover) * haloK;

  oColor = vec4(mix(shaded, glass, cover), 1.0);
}

void main() {
  body();
}`;

// ---- LED panel: the finished picture (glass and all) averaged into a grid of square pixels ----
export const FRAG_LED = `#version 300 es
precision highp float;
uniform sampler2D uComp;   // the normal picture, with mip levels
uniform vec2 uRes;         // canvas size in px
uniform vec4 uLed;         // x columns, y rows, z gap as a fraction of a cell, w brightness
uniform sampler2D uOverlay;   // countdown card: one texel per LED, straight alpha
uniform float uOverlayOn;
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
  vec3 c = textureLod(uComp, cuv, max(log2(cell), 0.0)).rgb;                // average the picture over the cell
  // LED panels are punchy: more saturation and contrast than the soft picture
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = pow(max(mix(vec3(l), c, 1.2), 0.0), vec3(1.08));
  if (uOverlayOn > 0.5) {                                                   // drawn per LED, after averaging, so its pixels stay whole LEDs
    vec4 o = texelFetch(uOverlay, ivec2(int(id.x), int(uLed.y - 1.0 - id.y)), 0);
    c = mix(c, o.rgb, o.a);
  }
  oColor = vec4(c * (lit + 0.035) * uLed.w, 1.0);
}`;

// ------------------------------------------------------------- composite ---
export const FRAG_SCENE = `#version 300 es
${ATMOS_COMMON}
${SKY_LOOKUP}
${DISPLAY_FNS}
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

// ---- atmosphere helpers ----
vec3 sunTransAt(float h, float elev) {            // sunlight reaching height h above the camera
  float r = BOT + uCamH + h;
  float mu = sin(elev);
  return transmittance(r, mu) * earthShadow(r, mu);
}

// ---- clouds ----
float cloudShape(vec2 uv, float cover, float lod, float sharp) {
  vec4 n = textureLod(uNoise, uv, lod);
  float base = n.r * 0.62 + n.g * 0.28 + n.b * 0.10;
  float th = mix(0.74, 0.02, pow(cover, 0.85));
  float d = smoothstep(th, th + sharp, base);
  // erode the edges with finer detail; thin edges lose more than the dense core
  float fine = textureLod(uNoise, uv * 3.7 + 0.31, lod).b;
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

// ---- moon ----
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

// ---- terrain ----
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

// per-pixel values shared by the terrain and sky shaders (assigned in main)
float swellUp;
float La, expo, pixM, az, u;
vec3 sk, hdir, hazeL, zenL, ambLux, sunIg, moonIg;

// Terrain, water and city layers; layer 0 is the nearest.
vec3 shadeTerrain(int layer, vec3 d) {
  vec3 L;
  bool plane = layer == 0 && d.y < -uDip + 0.0002 + swellUp;
  if (plane && abs(uLandType - 1.0) < 0.1) {
    // ocean: Fresnel mix of the reflected sky and a dark body, wind-roughened glitter
    float tdist = uEyeH / max(-d.y, 1e-4);              // km to the water
    vec2 wp = d.xz * tdist * 1000.0;                    // metres
    float fp = pixM * tdist * 1000.0 / max(-d.y, 0.003);
    vec2 w1 = textureLod(uNoise, wp / 61.0 + vec2(uTime * 0.012, uTime * 0.007), lodFor(fp, 61.0)).rg - 0.5;
    vec2 w2 = textureLod(uNoise, wp / 17.0 - vec2(uTime * 0.025, 0.0), lodFor(fp, 17.0)).rg - 0.5;
    vec2 w3 = textureLod(uNoise, wp / 4.3 + vec2(0.0, uTime * 0.05), lodFor(fp, 4.3)).rg - 0.5;
    vec2 w4 = textureLod(uNoise, wp / 1.3 - vec2(uTime * 0.09, uTime * 0.03), lodFor(fp, 1.3)).rg - 0.5;
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
    float streak = textureLod(uNoise, vec2(dot(wp, wdir) / 55.0, dot(wp, vec2(-wdir.y, wdir.x)) / 7.0), lodFor(fp, 7.0)).g;
    float fnoise = textureLod(uNoise, wp / 3.1 + 0.37, lodFor(fp, 3.1)).b;
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
  } else {
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
      float sp = textureLod(uNoise, gp / 6.0, lodFor(fp, 6.0)).b * 0.6 + textureLod(uNoise, gp / 1.1, lodFor(fp, 1.1)).a * 0.4;
      float sm = exp(-tdist * 4.0);
      // patchy cover: two ground colours blended by large and medium scale noise
      float pa = textureLod(uNoise, gp / 37.0 + 0.2, lodFor(fp, 37.0)).r;
      float pb = textureLod(uNoise, gp / 9.0 + 0.6, lodFor(fp, 9.0)).g;
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
      vec3 sl = texture(uSkyline, vec2(u - du, 0.5)).rgb;
      vec3 sr = texture(uSkyline, vec2(u + du, 0.5)).rgb;
      float dh = (layer == 0 ? sr.r - sl.r : (layer == 1 ? sr.g - sl.g : sr.b - sl.b)) / (2.0 * du * 2.0 * PI);
      vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), hdir));
      n = normalize(-hdir * 0.75 + vec3(0.0, 0.55, 0.0) - side * clamp(dh, -3.0, 3.0) * 0.6);
      float hz = clamp(d.y / max(ridgeTop, 0.004), 0.0, 1.0);          // 0 at the foot, 1 at the crest
      float rr = textureLod(uNoise, vec2(az * 7.0, d.y * 70.0), 1.0).g;
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
  }
  return L;
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
  float mott = textureLod(uNoise, muv * vec2(10.0, 5.0), 1.5).g;
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

  // clouds, high to low
  vec3 wd = vec3(uWind.x, 0.0, uWind.y);
  float cc = 0.0;
  vec4 cH = cloudLayer(d, uCover.z, 9.5, 120.0, vec2(1.0, 0.32), 1.1, uCover.x, ambLux, hazeL, 1.6);
  L = mix(L, cH.rgb, cH.a);
  vec4 cM = cloudLayer(d, uCover.y, 5.0, 70.0, vec2(1.0, 0.8), 2.4, uCover.x, ambLux, hazeL, 1.2);
  L = mix(L, cM.rgb, cM.a);
  vec4 cL = cloudLayer(d, uCover.x, 1.8, 40.0, vec2(1.0, 1.0), 5.0, uCover.x, ambLux, hazeL, 1.0);
  L = mix(L, cL.rgb, cL.a);
  skyMask *= (1.0 - cH.a * 0.9) * (1.0 - cM.a) * (1.0 - cL.a);

  // fog
  float fogMix = max(0.75 * uFog * uFog, uFog * 0.92 * (1.0 - smoothstep(0.0, 0.25, d.y)));
  L = mix(L, hazeL, fogMix);
  skyMask *= 1.0 - fogMix;
  return L;
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  vec3 d = normalize(uCam * normalize(vec3(ndc.x * uTan.x, ndc.y * uTan.y, 1.0)));

  // Display adaptation is deliberately incomplete: a pure auto-exposure would make
  // a moonlit night as bright as dusk. Compress the curve so the sky stays dark at
  // night (but readable), and let the user lift it with uBoost.
  La = exp(texelFetch(uAdapt, ivec2(0), 0).r);
  expo = calcExpo(La, uKey, uBoost);

  pixM = 2.0 * uTan.y / uRes.y;                         // radians per pixel
  az = atan(d.x, d.z);
  u = az / (2.0 * PI) + 0.5;
  sk = texture(uSkyline, vec2(u, 0.5)).rgb;             // near, mid, far ridge elevations (cumulative)
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
  hazeL = skyLum(normalize(vec3(hdir.x, 0.012, hdir.z)));
  zenL = skyLum(vec3(0.0, 1.0, 0.0));
  vec3 sunUpDir = normalize(vec3(uSunA.x * 0.866, 0.5, uSunA.y * 0.866));
  ambLux = PI * (0.7 * zenL + 0.3 * skyLum(sunUpDir));
  sunIg  = sunTransAt(0.0, uSunA.z) * uSunA.w;
  moonIg = sunTransAt(0.0, uMoonA.z) * uMoonA.w;

  // Analytic antialiasing of the outermost silhouette (there is no MSAA here): within a
  // pixel of the skyline, shade both sides and blend by coverage.
  int topLayer = sk.b > sk.g ? 2 : (sk.g > sk.r ? 1 : 0);
  float edge = (sk.b - d.y) / pixM;                      // pixels below the silhouette
  vec3 L;
  float skyMask;
  if (layer >= 0 && edge > 1.0) {
    L = shadeTerrain(layer, d);
    skyMask = 0.0;
  } else if (layer < 0 && edge < -1.0) {
    L = shadeSky(d, skyMask);
  } else {
    float cov = clamp(edge + 0.5, 0.0, 1.0);
    float m;
    vec3 Ls = shadeSky(d, m);
    vec3 Lt = shadeTerrain(layer >= 0 ? layer : topLayer, d);
    L = mix(Ls, Lt, cov);
    skyMask = m * (1.0 - cov);
  }

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
  c += (n1 + n2 - 1.0) / 255.0;

  oColor = vec4(clamp(c, 0.0, 1.0), skyMask);
}`;

export { VERT_FULLSCREEN };
