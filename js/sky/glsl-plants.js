// Plants: a few hundred to ~1500 instanced, camera-facing sprites standing on the ground plane.
//
// Cheap on purpose: one instanced draw, 6 vertices per plant, shapes are procedural (no textures,
// no geometry), wind is a vertex-shader sway, and the lighting comes from the same sky tables as
// everything else. Instances are sorted far to near once, because the camera only rotates.
//
// Types: 0 grass tuft, 1 shrub, 2 broadleaf tree, 3 conifer, 4 cactus, 5 dry tuft, 6 flowering
//        meadow tuft, 7 rock, 8 palm, 9 acacia (flat-topped tree)

import { ATMOS_COMMON } from './glsl-atmosphere.js';
import { SKY_LOOKUP, DISPLAY_FNS } from './glsl-scene.js';

export const VERT_PLANTS = `#version 300 es
${ATMOS_COMMON}
${SKY_LOOKUP}
${DISPLAY_FNS}
in vec4 aInst;        // x east (m), z north (m), height (m), type
in vec2 aSeed;        // random 0..1, variant 0..1
uniform sampler2D uAdapt;
uniform mat3 uCam;    // camera -> world (columns right, up, forward)
uniform vec2 uTan;
uniform vec3 uSunDir;
uniform float uEyeM;
uniform float uTime;
uniform vec2 uWind;   // km/s at cloud height (east, north)
uniform float uKey, uBoost, uWet, uFogDens;
out vec4 vInst;
out vec2 vUv;
out vec2 vSeed;
out vec3 vSunL, vAmbL, vHaze;
out vec2 vSunSide;
out float vFog, vExpo;

const vec2 CORNER[6] = vec2[6](vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 1.0));

float aspectOf(int t) {
  if (t == 0 || t == 5 || t == 6) return 1.1;
  if (t == 1) return 1.3;
  if (t == 2) return 0.95;
  if (t == 3) return 0.55;
  if (t == 4) return 0.8;
  if (t == 7) return 1.5;
  if (t == 8) return 1.0;
  return 1.6;                                           // acacia
}
// how much of the plant moves in the wind (grass much, trunks barely)
float flexOf(int t) {
  if (t == 0 || t == 5 || t == 6) return 1.0;
  if (t == 1) return 0.45;
  if (t == 8) return 0.55;
  if (t == 2 || t == 9) return 0.32;
  if (t == 3) return 0.16;
  return 0.0;
}

void main() {
  vec2 c = CORNER[gl_VertexID];
  int type = int(aInst.w + 0.5);
  vec3 base = vec3(aInst.x, -uEyeM, aInst.y);
  float dist = max(length(base.xz), 0.5);
  vec3 dh = vec3(base.x, 0.0, base.z) / dist;
  vec3 right = vec3(dh.z, 0.0, -dh.x);                  // billboards turn about the vertical axis only
  float h = aInst.z, w = h * aspectOf(type);

  // wind: steady lean + gusts + a per-plant flutter; rain weighs everything down a little
  float spd = length(uWind) * 500.0;                    // surface m/s (cloud-level wind is ~2x)
  vec2 wd = uWind / max(length(uWind), 1e-6);
  float gust = 0.55 + 0.45 * sin(uTime * 0.6 + aInst.x * 0.05 + aInst.y * 0.07);
  float flutter = 0.65 + 0.35 * sin(uTime * (2.2 + aSeed.x * 1.6) + aSeed.x * 40.0 + aInst.x * 0.31);
  float amp = (0.14 + 0.08 * spd * gust + 0.05 * uWet) * flexOf(type);
  float along = dot(wd, vec2(right.x, right.z));       // wind direction as seen across the screen
  float lean = amp * h * (0.45 * flutter + 0.55 * along * gust + 0.25) * c.y * c.y;

  // cull whole plants, never single corners: a quad with some corners behind the camera projects to a smear
  vec3 cb = transpose(uCam) * base;                       // base centre in camera space
  vec3 ct = transpose(uCam) * (base + vec3(0.0, h, 0.0));
  float zmin = min(cb.z, ct.z);
  float halfW = 0.5 * w + amp * h;
  if (zmin < 2.0 || abs(cb.x / (cb.z * uTan.x)) - halfW / (cb.z * uTan.x) > 1.0) { gl_Position = vec4(3.0, 3.0, 3.0, 1.0); vUv = vec2(0.0); return; }

  vec3 P = base + right * ((c.x - 0.5) * w + lean) + vec3(0.0, c.y * h - abs(lean) * 0.18 * c.y, 0.0);
  vec3 cam = transpose(uCam) * P;
  cam.z = max(cam.z, 0.5);
  vec2 ndc = vec2(cam.x / (cam.z * uTan.x), cam.y / (cam.z * uTan.y));
  gl_Position = vec4(ndc, 0.0, 1.0);

  vUv = c;
  vInst = aInst;
  vSeed = aSeed;

  // light arriving at the plant, in cd/m^2-per-steradian-ish units like the terrain uses
  vec3 sunUpDir = normalize(vec3(uSunA.x * 0.866, 0.5, uSunA.y * 0.866));
  vec3 zen = skyLum(vec3(0.0, 1.0, 0.0));
  vAmbL = PI * (0.7 * zen + 0.3 * skyLum(sunUpDir));
  float rs = BOT + uCamH, mus = sin(uSunA.z), rm = BOT + uCamH, mum = sin(uMoonA.z);
  vec3 moonI = transmittance(rm, mum) * earthShadow(rm, mum) * uMoonA.w;
  vSunL = transmittance(rs, mus) * earthShadow(rs, mus) * uSunA.w + moonI * 0.0;
  vSunL += moonI;                                       // moonlight picks out plants at night
  vHaze = skyLum(normalize(vec3(dh.x, 0.012, dh.z)));
  vec3 sc = transpose(uCam) * uSunDir;                  // sun in camera space: x across the screen, z in front
  vSunSide = sc.xz;
  vFog = 1.0 - exp(-dist * uFogDens);
  vExpo = calcExpo(exp(texelFetch(uAdapt, ivec2(0), 0).r), uKey, uBoost);
}`;

export const FRAG_PLANTS = `#version 300 es
precision highp float;
${DISPLAY_FNS}
in vec4 vInst;
in vec2 vUv;
in vec2 vSeed;
in vec3 vSunL, vAmbL, vHaze;
in vec2 vSunSide;
in float vFog, vExpo;
uniform vec3 uLeaf, uConifer, uGrass, uDry, uRock;
uniform float uSnowCover, uWet;
out vec4 oColor;

float hh(float a, float b) { return fract(sin(a * 127.1 + b * 311.7) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hh(i.x, i.y), hh(i.x + 1.0, i.y), f.x), mix(hh(i.x, i.y + 1.0), hh(i.x + 1.0, i.y + 1.0), f.x), f.y);
}
float cover(float d, float aa) { return smoothstep(aa, -aa, d); }

// one tapering, leaning blade
float blade(vec2 uv, float bx, float lean, float hgt, float wid, float aa) {
  float x = bx + lean * uv.y * uv.y;
  float w = wid * (1.0 - uv.y / hgt);
  if (uv.y > hgt || w <= 0.0) return 0.0;
  return smoothstep(w + aa, max(w - aa, 0.0), abs(uv.x - x));
}
float tuft(vec2 uv, float seed, float aa, int n, float wid) {
  float a = 0.0;
  for (int k = 0; k < 8; k++) {
    if (k >= n) break;
    float fk = float(k);
    float bx = 0.12 + 0.76 * hh(seed, fk);
    float lean = (hh(seed, fk + 9.0) - 0.5) * 0.7;
    float hgt = 0.5 + 0.5 * hh(seed, fk + 17.0);
    a = max(a, blade(uv, bx, lean, hgt, wid, aa));
  }
  return a;
}
float blob(vec2 uv, vec2 c, vec2 r, float seed, float aa) {
  float n = vn(uv * 7.0 + seed * 20.0) - 0.5;
  return cover(length((uv - c) / r) - 1.0 + n * 0.45, aa * 3.0);
}

void main() {
  int type = int(vInst.w + 0.5);
  vec2 uv = vUv;
  float seed = vSeed.x, vari = vSeed.y;
  float aa = max(fwidth(uv.x), fwidth(uv.y)) * 0.9 + 1e-4;
  float a = 0.0;
  vec3 col = uGrass;
  float shadeLow = 0.0;                                  // 1 = ambient-occluded at the base

  if (type == 0 || type == 5 || type == 6) {
    a = tuft(uv, seed * 31.0, aa, type == 5 ? 4 : 7, type == 5 ? 0.08 : 0.055);
    col = type == 5 ? uDry : mix(uGrass, uDry, vari * 0.35);
    shadeLow = 0.45;
    if (type == 6) {                                      // meadow flowers on a few stems
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float bx = 0.2 + 0.6 * hh(seed * 31.0, fk * 3.0 + 1.0);
        float fy = 0.62 + 0.3 * hh(seed * 31.0, fk * 3.0 + 2.0);
        float f = cover(length((uv - vec2(bx, fy)) * vec2(1.0, 1.0)) - 0.065, aa * 1.5);
        vec3 fc = hh(seed, fk) < 0.5 ? vec3(0.95, 0.9, 0.35) : (hh(seed, fk) < 0.75 ? vec3(0.95, 0.95, 0.95) : vec3(0.85, 0.35, 0.65));
        col = mix(col, fc, f);
        a = max(a, f);
      }
    }
  } else if (type == 1) {                                 // shrub
    a = max(blob(uv, vec2(0.5, 0.4), vec2(0.5, 0.38), seed, aa), blob(uv, vec2(0.28, 0.3), vec2(0.28, 0.26), seed + 3.0, aa));
    col = mix(uLeaf, uGrass, 0.4 + 0.4 * vari) * (0.75 + 0.5 * vn(uv * 9.0 + seed * 7.0));
    shadeLow = 0.5;
  } else if (type == 2 || type == 8 || type == 9) {       // broadleaf / palm / acacia
    float trunk = step(abs(uv.x - 0.5 - (type == 8 ? 0.06 * (uv.y - 0.3) : 0.0)), type == 8 ? 0.028 : (type == 9 ? 0.03 : 0.04)) * step(uv.y, type == 9 ? 0.72 : 0.5);
    float crown = 0.0;
    vec3 leaf = mix(uLeaf, uGrass, 0.25 * vari);
    if (type == 2) {
      crown = max(blob(uv, vec2(0.5, 0.68), vec2(0.34, 0.30), seed, aa),
              max(blob(uv, vec2(0.33, 0.58), vec2(0.22, 0.2), seed + 2.0, aa), blob(uv, vec2(0.67, 0.6), vec2(0.22, 0.2), seed + 5.0, aa)));
      leaf *= 0.7 + 0.6 * vn(uv * 11.0 + seed * 9.0);
    } else if (type == 9) {
      crown = max(blob(uv, vec2(0.5, 0.82), vec2(0.5, 0.11), seed, aa), blob(uv, vec2(0.3, 0.74), vec2(0.26, 0.07), seed + 4.0, aa));
      leaf *= 0.8 + 0.4 * vn(uv * 12.0 + seed * 9.0);
    } else {                                              // palm: drooping fronds out of the crown
      vec2 q = uv - vec2(0.53, 0.80);
      for (int k = 0; k < 6; k++) {
        float fk = float(k);
        float sd = (k % 2 == 0) ? 1.0 : -1.0;
        float s = q.x * sd / (0.30 + 0.16 * hh(seed, fk));
        float rise = 0.20 + 0.16 * hh(seed, fk + 5.0);
        float droop = 0.30 + 0.35 * hh(seed, fk + 9.0);
        if (s > 0.0 && s < 1.0) {
          float yc = rise * s - droop * s * s;
          crown = max(crown, cover(abs(q.y - yc) - 0.030 * (1.0 - 0.6 * s), aa * 2.0));
        }
      }
      crown = max(crown, cover(abs(q.x) - 0.02, aa) * step(0.0, q.y) * step(q.y, 0.1));
      leaf = mix(uLeaf, vec3(0.2, 0.5, 0.15), 0.5);
    }
    a = max(crown, trunk);
    col = crown > 0.0 ? leaf : vec3(0.20, 0.14, 0.09);
    shadeLow = 0.35;
  } else if (type == 3) {                                 // conifer: ragged stacked cones
    float v = uv.y;
    float wdt = 0.40 * (1.0 - (v - 0.08) / 0.92) * (1.0 + 0.22 * sin(v * 34.0 + seed * 6.0));
    a = step(0.08, v) * cover(abs(uv.x - 0.5) - wdt, aa * 2.0) + step(abs(uv.x - 0.5), 0.025) * step(v, 0.1);
    a = clamp(a, 0.0, 1.0);
    col = uConifer * (0.7 + 0.5 * vn(uv * vec2(8.0, 14.0) + seed * 5.0));
    shadeLow = 0.4;
  } else if (type == 4) {                                 // cactus with two arms
    float body = cover(abs(uv.x - 0.5) - 0.085, aa) * step(uv.y, 0.93) + cover(length((uv - vec2(0.5, 0.93)) * vec2(1.0, 1.0)) - 0.085, aa);
    float armL = cover(abs(uv.y - 0.42) - 0.065, aa) * step(0.22, uv.x) * step(uv.x, 0.5) + cover(abs(uv.x - 0.24) - 0.065, aa) * step(0.4, uv.y) * step(uv.y, 0.7);
    float armR = cover(abs(uv.y - 0.55) - 0.065, aa) * step(0.5, uv.x) * step(uv.x, 0.78) + cover(abs(uv.x - 0.76) - 0.065, aa) * step(0.52, uv.y) * step(uv.y, 0.8);
    a = clamp(body + armL * step(0.5, seed) + armR * step(0.25, seed), 0.0, 1.0);
    col = mix(vec3(0.07, 0.17, 0.09), vec3(0.11, 0.22, 0.10), 0.5 + 0.5 * sin(uv.x * 60.0));
    shadeLow = 0.25;
  } else {                                                // rock
    float n = vn(uv * 5.0 + seed * 11.0);
    a = cover(length((uv - vec2(0.5, 0.32)) / vec2(0.5, 0.34 + 0.1 * n)) - 1.0, aa * 2.0) * step(0.0, uv.y);
    col = uRock * (0.65 + 0.6 * vn(uv * 14.0 + seed * 3.0)) * (0.7 + 0.5 * uv.y);
    shadeLow = 0.2;
  }
  if (a < 0.02) discard;

  // snow settles on the upper parts of plants and rocks
  float snow = uSnowCover * smoothstep(0.1, 0.55, uv.y + 0.2 * (hh(seed, 3.0) - 0.5)) * (type == 3 ? 0.55 : 0.9);
  col = mix(col, vec3(0.82, 0.85, 0.9), snow);
  col *= 1.0 - 0.3 * uWet;

  // lighting: the lit side faces the sun on screen; plants against the sun are mostly silhouettes
  float side = clamp(0.5 + 0.5 * vSunSide.x * (uv.x * 2.0 - 1.0) * 1.8, 0.0, 1.0);
  float backlit = smoothstep(0.15, 0.95, vSunSide.y);
  float sunTerm = mix(mix(0.35, 1.0, side), 0.18, backlit * 0.7);
  float ao = 1.0 - shadeLow * (1.0 - smoothstep(0.0, 0.6, uv.y));
  vec3 L = col * ao * (vSunL * sunTerm + vAmbL) / 3.14159265;
  L = mix(L, vHaze, vFog);
  oColor = vec4(toDisplay(L, vExpo, vec3(0.0)), a);
}`;
