import { conf } from '../config.js';
import { getPosition } from "./suncalc/suncalc.js";

const canvas = document.getElementById('sky');
const gl = canvas.getContext('webgl2', {
  antialias: false,
  premultipliedAlpha: false,
  alpha: false,
  depth: false,
  stencil: false,
  powerPreference: 'high-performance',
});
if (!gl) throw new Error('WebGL2 is required');

// ---- HiDPI resize ----
const dpr = Math.min(window.devicePixelRatio || 1, 2);

export function resize() {
  const w = Math.floor(innerWidth * dpr);
  const h = Math.floor(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }
}
addEventListener('resize', resize, { passive: true });
resize();

// ---- Shaders ----
const vert = `#version 300 es
  // Fullscreen triangle using gl_VertexID trick
  void main(){
    const vec2 p[3] = vec2[3](
      vec2(-1.0, -1.0),
      vec2( 3.0, -1.0),
      vec2(-1.0,  3.0)
    );
    gl_Position = vec4(p[gl_VertexID], 0.0, 1.0);
  }`;

const frag = `#version 300 es
  precision highp float;

  out vec4 oColor;

  // Common uniforms
  uniform vec2  uResolution;    // canvas size in pixels
  uniform float uFovDeg;        // vertical FOV (degrees)
  uniform float uCameraAltMeters; // camera altitude above sea level (meters)
  uniform float uAzimuthDeg; // camera azimuth (degrees)
  uniform float uPitchDeg;   // camera pitch (degrees, +up/-down)
  uniform float uSunAngle; // Sun angle (radians)
  // Atmosphere parameters (match your JS constants)
  uniform float uGroundRadius;        // meters
  uniform float uTopRadius;           // meters
  uniform float uRayleighScaleHeight; // meters
  uniform float uMieScaleHeight;      // meters

  uniform vec3  uBetaR;   // Rayleigh scatter coeff per-channel (m^-1)
  uniform float uBetaM;   // Mie scatter (m^-1)   (scattering)
  uniform float uBetaMAbs;// Mie absorb  (m^-1)   (absorption)
  uniform vec3  uOzoneAbs;// Ozone absorb per-channel (m^-1)

  uniform float uSunIntensity; // SUN_INTENSITY
  uniform float uExposure;     // EXPOSURE
  uniform float uGamma;        // GAMMA
  uniform float uSunsetBias;   // SUNSET_BIAS_STRENGTH
  uniform int   uSamples;      // march steps (e.g., 32)

  // ------------- Helpers -------------
  float PI = 3.141592653589793;
  float saturate(float x){ return clamp(x, 0.0, 1.0); }
  vec3  saturate(vec3 v){ return clamp(v, vec3(0.0), vec3(1.0)); }

  // ACES (Narkowicz fit)
  vec3 aces(vec3 x){
    const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
    return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
  }

  // Gentle sunset hue tweak (ported from your JS)
  vec3 applySunsetBias(vec3 rgb, float k){
    float lum = 0.2126*rgb.r + 0.7152*rgb.g + 0.0722*rgb.b; // sRGB rel. luminance
    float w = 1.0 / (1.0 + 2.0 * lum); // higher near horizon/twilight
    float rb = 1.0 + 0.5 * k * w; // boost red
    float gb = 1.0 - 0.5 * k * w; // suppress green
    float bb = 1.0 + 1.0 * k * w; // boost blue
    return vec3(max(0.0, rgb.r * rb), max(0.0, rgb.g * gb), max(0.0, rgb.b * bb));
  }

  // Phase functions
  float rayleighPhase(float angle){
    float c = cos(angle);
    return (3.0 * (1.0 + c*c)) / (16.0 * PI);
  }
  float miePhase(float angle){
    // Cornette–Shanks-ish with g=0.8 like your JS
    float g = 0.8;
    float c = cos(angle);
    float num = (1.0 - g*g) * (1.0 + c*c);
    float den = (2.0 + g*g) * pow(1.0 + g*g - 2.0*g*c, 1.5);
    return (3.0/(8.0*PI)) * num / den;
  }

  // Ray/sphere: distance to exit (far) intersection, -1 if none
  float intersectSphere(vec3 p, vec3 d, float r){
    float b = dot(p, d);
    float c = dot(p, p) - r*r;
    float disc = b*b - c;
    if (disc < 0.0) return -1.0;
    float s = sqrt(disc);
    float t = -b - s;
    if (t < 0.0) t = -b + s;
    return (t < 0.0) ? -1.0 : t;
  }

  // Beer-Lambert for vectors
  vec3 vexp(vec3 x){ return vec3(exp(x.x), exp(x.y), exp(x.z)); }

  // Your fixed-step optical depth approximation with ozone
  vec3 computeTransmittance(float height, float angle){
    vec3 ro = vec3(0.0, uGroundRadius + height, 0.0);
    vec3 rd = vec3(sin(angle), cos(angle), 0.0);

    float distance = intersectSphere(ro, rd, uTopRadius);
    if (distance <= 0.0) return vec3(1.0);

    float seg = distance / float(uSamples);
    float t   = 0.5 * seg;

    float odR = 0.0; // Rayleigh
    float odM = 0.0; // Mie
    float odO = 0.0; // Ozone

    // Unrolled upper bound for driver friendliness
    for (int i=0; i<1024; ++i){
      if (i >= uSamples) break;

      vec3 pos = ro + rd * t;
      float h = length(pos) - uGroundRadius;

      float dR = exp(-h / uRayleighScaleHeight);
      float dM = exp(-h / uMieScaleHeight);
      odR += dR * seg;
      odM += dM * seg;

      // Triangular ozone layer centered at 25 km, width 30 km
      float ozoneDensity = 1.0 - min(abs(h - 25000.0) / 15000.0, 1.0);
      odO += ozoneDensity * seg;

      t += seg;
    }

    vec3 tauR = uBetaR * odR;
    vec3 tauM = vec3(uBetaMAbs * odM); // absorption portion
    vec3 tauO = uOzoneAbs * odO;

    // Total optical depth -> transmittance
    return vexp(-(tauR + tauM + tauO));
  }

  void main(){
    // Pixel → view ray through a simple pinhole camera
    vec2 uv  = (gl_FragCoord.xy + 0.5) / uResolution; // [0,1]
    vec2 ndc = uv * 2.0 - 1.0; // [-1,1]
    
    float fovRad = radians(uFovDeg);
    float focalZ = 1.0 / tan(0.5 * fovRad);

    // Camera at ground level, +Y up
    vec3 ro = vec3(0.0, uGroundRadius + uCameraAltMeters, 0.0);
    // Camera basis from azimuth (point forward along compass bearing)
    float az = radians(uAzimuthDeg);

    // World up
    vec3 worldUp = vec3(0.0, 1.0, 0.0);

    // Angles
    float yaw = radians(uAzimuthDeg + 180.0); // compass heading in degrees
    float pitch = radians(uPitchDeg); // fixed pitch in degrees

    // Forward built from yaw (around Y) and pitch (around X in camera space)
    vec3 forward = normalize(vec3(
      sin(yaw) * cos(pitch), // x
      sin(pitch), // y
      cos(yaw) * cos(pitch) // z
));

    // Orthonormal basis
    vec3 right = normalize(cross(forward, worldUp));
    vec3 up = normalize(cross(right, forward));

    vec3 rd = normalize(forward * focalZ + right * ndc.x + up * ndc.y);

    // Sun direction from altitude (in X–Y plane by default)
    vec3 sunDir = normalize(vec3(cos(uSunAngle), sin(uSunAngle), 0.0));
    // Exit to top-of-atmosphere along view ray
    float tExitTop = intersectSphere(ro, rd, uTopRadius);
    if (tExitTop <= 0.0){
      oColor = vec4(0.0);
      return;
    }

    // Precompute camera->space transmittance like your JS
    float roR = length(ro);
    bool pointingDown = dot(ro, rd) / roR < 0.0;
    float startHeight = uCameraAltMeters; // camera alt above sea level
    float startRayCos = clamp(dot(ro / roR, rd), -1.0, 1.0);
    float startRayAngle = acos(abs(startRayCos));
    vec3 T_cam_space = computeTransmittance(startHeight, startRayAngle);

    // March along the view ray
    int   N   = uSamples;
    float seg = tExitTop / float(N);
    float t   = 0.5 * seg;

    vec3 inscattered = vec3(0.0);

    for (int j=0; j<1024; ++j){
      if (j >= N) break;

      vec3 p = ro + rd * t;
      float r = length(p);
      vec3 upU = p / r;
      float h = r - uGroundRadius;

      float viewCos = clamp(dot(upU, rd), -1.0, 1.0);
      float sunCos  = clamp(dot(upU, sunDir), -1.0, 1.0);
      float viewAng = acos(abs(viewCos));
      float sunAng  = acos(sunCos);

      // camera → sample transmittance
      vec3 T_to_space     = computeTransmittance(h, viewAng);
      vec3 T_cam_sample   = pointingDown ? (T_to_space / T_cam_space)
                                         : (T_cam_space / T_to_space);

      // sample → sun transmittance
      vec3 T_light = computeTransmittance(h, sunAng);

      // local densities
      float densityR = exp(-h / uRayleighScaleHeight);
      float densityM = exp(-h / uMieScaleHeight);

      // phase functions wrt view/sun
      float sunViewCos = clamp(dot(sunDir, rd), -1.0, 1.0);
      float sunViewAng = acos(sunViewCos);
      float phaseR = rayleighPhase(sunViewAng);
      float phaseM = miePhase(sunViewAng);

      // single scattering
      vec3 scattered = T_light * (uBetaR * densityR * phaseR
                         + vec3(uBetaM * densityM * phaseM));

      inscattered += T_cam_sample * scattered * seg;

      t += seg;
    }

    vec3 color = inscattered * uSunIntensity;

    // Post: exposure -> gentle sunset bias -> ACES -> gamma
    color *= uExposure;
    color  = applySunsetBias(color, uSunsetBias);
    color  = aces(color);
    color  = pow(color, vec3(1.0 / uGamma));

    oColor = vec4(saturate(color), 1.0);
  }`;

// ---- Program creation ----
function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s) || '(no log)';
    gl.deleteShader(s);
    throw new Error(`Shader compile error:\n${info}`);
  }
  return s;
}

function link(vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog) || '(no log)';
    gl.deleteProgram(prog);
    throw new Error(`Program link error:\n${info}`);
  }
  return prog;
}

const prog = link(compile(gl.VERTEX_SHADER, vert), compile(gl.FRAGMENT_SHADER, frag));
gl.useProgram(prog);
const vao = gl.createVertexArray();
gl.bindVertexArray(vao);

// ---- Uniform helpers ----
const U = (name) => gl.getUniformLocation(prog, name);

// ---- Set static uniforms (copying the constants you posted) ----
gl.uniform1f(U('uFovDeg'), 75.0);

gl.uniform1f(U('uGroundRadius'), 6360e3);
gl.uniform1f(U('uTopRadius'), 6460e3);
gl.uniform1f(U('uRayleighScaleHeight'), 8000.0);
gl.uniform1f(U('uMieScaleHeight'), 1200.0);

gl.uniform3f(U('uBetaR'), 5.802e-6, 13.558e-6, 33.1e-6);
gl.uniform1f(U('uBetaM'), 3.996e-6);
gl.uniform1f(U('uBetaMAbs'), 4.44e-6);
gl.uniform3f(U('uOzoneAbs'), 0.65e-6, 1.881e-6, 0.085e-6);

gl.uniform1f(U('uSunIntensity'), 1.0);
gl.uniform1f(U('uExposure'), 25.0);
gl.uniform1f(U('uGamma'), 2.2);
gl.uniform1f(U('uSunsetBias'), 0.1);

gl.uniform1i(U('uSamples'), 32);

// ---- Dynamic state ----
let altitude = 0.35; // radians
let azimuthDeg = 0.0; // degrees

// ---- Draw loop ----
function draw() {
  const now = new Date();
  const sunPos = getPosition(
    now,
    parseFloat(conf.location_latitude),
    parseFloat(conf.location_longitude),
  );
  
  // Pull values from global 'conf' each frame
  const camAltMeters = conf.location_altitude; // meters
  const camAzimuth = conf.location_heading; // degrees
  const sunAngleRad = sunPos.altitude; // radians (fallback)
  
  // Set uniforms
  gl.uniform2f(U('uResolution'), canvas.width, canvas.height);
  gl.uniform1f(U('uCameraAltMeters'), camAltMeters);
  gl.uniform1f(U('uAzimuthDeg'), camAzimuth);
  gl.uniform1f(U('uPitchDeg'),        37.5); 
  gl.uniform1f(U('uSunAngle'), sunAngleRad);
  
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function tick() {
  draw();
  requestAnimationFrame(tick);
}
tick();