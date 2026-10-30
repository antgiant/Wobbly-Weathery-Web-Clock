// Physically based atmosphere, precomputed into small lookup tables.
//
// Model: Hillaire, "A Scalable and Production Ready Sky and Atmosphere
// Rendering Technique" (EGSR 2020): Rayleigh + Mie + ozone medium, a
// transmittance LUT, a multiple-scattering LUT and a sky-view LUT. Unlike a
// per-pixel raymarch, the expensive part only reruns when the sun/moon has
// moved a meaningful amount (every few seconds), and drawing a frame is a
// single texture lookup per pixel.
//
// Differences from the paper's reference that matter for sunsets:
//  * the planet's shadow is tested at every sample (smoothly, using the sun's
//    angular radius), so the sky goes dark in the correct order after sunset
//    and the "belt of Venus" / earth shadow emerge naturally;
//  * the sky-view LUT is parameterised by (azimuth from the light, elevation
//    above the local horizon) with extra resolution at the horizon, and rays
//    just below the horizon are kept so ground haze can sample them.
//
// Units: kilometres. Radiometric unit: radiance per unit illuminance of the
// light source, so shaders multiply by the sun / moon illuminance in lux.

export const VERT_FULLSCREEN = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const ATMOS_COMMON = `
precision highp float;
precision highp sampler2D;

const float PI  = 3.14159265358979323846;
const float BOT = 6360.0;   // ground radius, km
const float TOP = 6460.0;   // top of atmosphere, km
const vec3  RAY_S = vec3(5.802e-3, 13.558e-3, 33.1e-3);   // 1/km
const float MIE_S = 3.996e-3;
const float MIE_A = 4.44e-3;
const vec3  OZO_A = vec3(0.650e-3, 1.881e-3, 0.085e-3);
const float SUN_ANG_R = 0.00465;   // sun angular radius, rad
const float E0 = 0.0698131701;     // sky-view LUT reaches 4 deg below the horizon

uniform float uMie;  // aerosol multiplier (1 = clean air, >1 = hazy)

// Nearest positive intersection with a sphere centred at the origin, or -1.
float raySphere(vec3 o, vec3 d, float r) {
  float b = dot(o, d);
  float c = dot(o, o) - r * r;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  float s = sqrt(disc);
  float t0 = -b - s, t1 = -b + s;
  if (t0 > 0.0) return t0;
  if (t1 > 0.0) return t1;
  return -1.0;
}

// Medium at height h (km): scattering and extinction coefficients.
void medium(float h, out vec3 scatR, out float scatM, out vec3 ext) {
  float dR = exp(-h / 8.0);
  float dM = exp(-h / 1.2) * uMie;
  float dO = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  scatR = RAY_S * dR;
  scatM = MIE_S * dM;
  ext = scatR + vec3(scatM + MIE_A * dM) + OZO_A * dO;
}

float rayleighPhase(float c) { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
float miePhase(float c) {
  const float g = 0.8;
  float num = (1.0 - g * g) * (1.0 + c * c);
  float den = (2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * c, 1e-4), 1.5);
  return 3.0 / (8.0 * PI) * num / den;
}

// Fraction of the solar disc not hidden by the planet, for a sample at radius
// r whose local up has cosine mu to the light.
float earthShadow(float r, float mu) {
  float muC = -sqrt(max(0.0, 1.0 - (BOT * BOT) / (r * r)));
  return smoothstep(muC - SUN_ANG_R, muC + SUN_ANG_R, mu);
}

// --- transmittance LUT parameterisation (Bruneton) ---
void transParams(vec2 uv, out float r, out float mu) {
  float H = sqrt(TOP * TOP - BOT * BOT);
  float rho = H * uv.y;
  r = sqrt(rho * rho + BOT * BOT);
  float dmin = TOP - r, dmax = rho + H;
  float d = dmin + uv.x * (dmax - dmin);
  mu = d == 0.0 ? 1.0 : (H * H - rho * rho - d * d) / (2.0 * r * d);
  mu = clamp(mu, -1.0, 1.0);
}
vec2 transUv(float r, float mu) {
  float H = sqrt(TOP * TOP - BOT * BOT);
  float rho = sqrt(max(r * r - BOT * BOT, 0.0));
  float disc = r * r * (mu * mu - 1.0) + TOP * TOP;
  float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  float dmin = TOP - r, dmax = rho + H;
  return vec2((d - dmin) / (dmax - dmin), rho / H);
}
`;

// ---- Pass 1: transmittance from (height, zenith cosine) to space ----
export const FRAG_TRANSMITTANCE = `#version 300 es
${ATMOS_COMMON}
in vec2 vUv;
out vec4 oColor;
void main() {
  float r, mu;
  transParams(vUv, r, mu);
  vec3 o = vec3(0.0, r, 0.0);
  vec3 d = vec3(sqrt(max(0.0, 1.0 - mu * mu)), mu, 0.0);
  float tTop = raySphere(o, d, TOP);
  const int N = 48;
  float dt = tTop / float(N);
  vec3 tau = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 p = o + d * ((float(i) + 0.5) * dt);
    vec3 sR; float sM; vec3 ext;
    medium(length(p) - BOT, sR, sM, ext);
    tau += ext * dt;
  }
  oColor = vec4(exp(-tau), 1.0);
}`;

// ---- Pass 2: multiple scattering (isotropic, infinite-order series) ----
export const FRAG_MULTISCATTER = `#version 300 es
${ATMOS_COMMON}
uniform sampler2D uTrans;
uniform float uGroundAlbedo;
in vec2 vUv;
out vec4 oColor;

vec3 trans(float r, float mu) { return texture(uTrans, transUv(r, mu)).rgb; }

void main() {
  float sunCos = vUv.x * 2.0 - 1.0;
  float r = BOT + clamp(vUv.y, 0.0, 1.0) * (TOP - BOT);
  r = max(r, BOT + 0.0005);
  vec3 sunDir = vec3(0.0, sunCos, sqrt(max(0.0, 1.0 - sunCos * sunCos)));
  vec3 o = vec3(0.0, r, 0.0);

  vec3 Lsum = vec3(0.0), fsum = vec3(0.0);
  const int NA = 8;   // 8 x 8 directions over the sphere
  for (int i = 0; i < NA; i++) {
    for (int j = 0; j < NA; j++) {
      float az = 2.0 * PI * (float(i) + 0.5) / float(NA);
      float cz = 1.0 - 2.0 * (float(j) + 0.5) / float(NA);
      float sz = sqrt(max(0.0, 1.0 - cz * cz));
      vec3 d = vec3(sz * cos(az), cz, sz * sin(az));

      float tTop = raySphere(o, d, TOP);
      float tGnd = raySphere(o, d, BOT);
      bool hitGround = tGnd > 0.0;
      float tMax = hitGround ? tGnd : tTop;

      const int NS = 20;
      float dt = tMax / float(NS);
      vec3 thr = vec3(1.0), Lr = vec3(0.0), fr = vec3(0.0);
      for (int s = 0; s < NS; s++) {
        vec3 p = o + d * ((float(s) + 0.5) * dt);
        float rr = length(p);
        vec3 sR; float sM; vec3 ext;
        medium(rr - BOT, sR, sM, ext);
        vec3 scat = sR + vec3(sM);
        vec3 stepT = exp(-ext * dt);
        float mu = dot(p / rr, sunDir);
        vec3 sunT = trans(rr, mu) * earthShadow(rr, mu);
        vec3 S = sunT * scat / (4.0 * PI);
        Lr += thr * (S - S * stepT) / ext;
        fr += thr * (scat - scat * stepT) / ext;
        thr *= stepT;
      }
      if (hitGround) {
        vec3 p = o + d * tMax;
        float rr = length(p);
        float mu = dot(p / rr, sunDir);
        vec3 sunT = trans(BOT, mu) * earthShadow(BOT, mu);
        // Lambertian ground radiance, expressed like the in-scattered terms
        Lr += thr * sunT * max(mu, 0.0) * uGroundAlbedo / PI / (4.0 * PI);
      }
      Lsum += Lr;
      fsum += fr;
    }
  }
  float inv = 1.0 / float(NA * NA);
  Lsum *= 4.0 * PI * inv;
  fsum *= inv;
  oColor = vec4(Lsum / (1.0 - fsum), 1.0);
}`;

// ---- Pass 3: sky-view LUT (one per light: sun, moon) ----
// x: sqrt(angle from the light's azimuth / pi)   y: cbrt of normalised elevation
export const FRAG_SKYVIEW = `#version 300 es
${ATMOS_COMMON}
uniform sampler2D uTrans;
uniform sampler2D uMS;
uniform float uElev;   // light elevation above the local horizon, rad
uniform float uCamH;   // camera height above sea level, km
in vec2 vUv;
out vec4 oColor;

vec3 trans(float r, float mu) { return texture(uTrans, transUv(r, mu)).rgb; }

void main() {
  float phi = PI * vUv.x * vUv.x;
  float t = vUv.y * vUv.y * vUv.y;
  float e = -E0 + t * (0.5 * PI + E0);

  vec3 o = vec3(0.0, BOT + max(uCamH, 0.002), 0.0);
  vec3 d = vec3(sin(phi) * cos(e), sin(e), cos(phi) * cos(e));
  vec3 sunDir = vec3(0.0, sin(uElev), cos(uElev));

  float tTop = raySphere(o, d, TOP);
  float tGnd = raySphere(o, d, BOT);
  float tMax = tGnd > 0.0 ? tGnd : tTop;

  float cosT = dot(d, sunDir);
  float pR = rayleighPhase(cosT), pM = miePhase(cosT);

  const int N = 48;
  vec3 L = vec3(0.0), thr = vec3(1.0);
  for (int i = 0; i < N; i++) {
    // quadratic spacing: dense near the camera where the air is thick
    float s0 = float(i) / float(N), s1 = float(i + 1) / float(N);
    float t0 = tMax * s0 * s0, t1 = tMax * s1 * s1;
    float dt = t1 - t0;
    vec3 p = o + d * (0.5 * (t0 + t1));
    float rr = length(p);
    vec3 sR; float sM; vec3 ext;
    medium(rr - BOT, sR, sM, ext);
    vec3 stepT = exp(-ext * dt);
    float mu = dot(p / rr, sunDir);
    vec3 sunT = trans(rr, mu) * earthShadow(rr, mu);
    vec2 msUv = vec2(mu * 0.5 + 0.5, clamp((rr - BOT) / (TOP - BOT), 0.0, 1.0));
    vec3 ms = texture(uMS, msUv).rgb;
    vec3 S = sunT * (sR * pR + vec3(sM * pM)) + ms * (sR + vec3(sM));
    L += thr * (S - S * stepT) / ext;
    thr *= stepT;
  }
  oColor = vec4(L, dot(thr, vec3(1.0 / 3.0)));
}`;
