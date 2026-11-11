// Realtime sky renderer.
//
// Frame structure (all WebGL2):
//   static, rebuilt only when the sun/moon/air actually change:
//     transmittance LUT -> multiple-scattering LUT -> sky-view LUT(sun), sky-view LUT(moon)
//   per frame:
//     1x1 auto-exposure -> scene (sky, sun, moon, milky way, clouds, terrain) at
//     a dynamic render scale -> stars/planets (point sprites, masked by scene
//     alpha) -> blit to the canvas.
// Rendering is throttled: a still sky redraws about once a second, an animated
// one (drifting clouds, water, twinkle) ~15 fps, and look-around modes run at
// the display rate with the render scale adapting to hold the frame rate.

import { Capability, RUNG_OF, quietFor } from './capability.js';
import { VERT_STROKE, FRAG_STROKE, VERT_LIGHT, FRAG_LIGHT, VERT_DROP, FRAG_DROP, VERT_TRAIL, FRAG_TRAIL } from './glsl-mask.js';
import {
  VERT_FULLSCREEN, FRAG_TRANSMITTANCE, FRAG_MULTISCATTER, FRAG_SKYVIEW,
} from './glsl-atmosphere.js';
import {
  FRAG_NOISE, FRAG_NOISE_DOWN, FRAG_ATLAS_PLACE, FRAG_ADAPT, VERT_STARS, FRAG_STARS, fragBlit, FRAG_LED, FRAG_LED_PEAK, FRAG_LED_AVG, FRAG_SCENE_SKY, FRAG_SCENE_CLOUD, FRAG_SCENE_FOG, FRAG_SCENE_TERRAIN, fragTerrain, FRAG_CONSTS, CONSTS_N, HAZE_N, FRAG_FLAT,
} from './glsl-scene.js';
import { flatPalette } from './flatsky.js';
import { toES1, packSkyline, NOISE_ATLAS } from './portable.js';
import { VERT_PLANTS, FRAG_PLANTS } from './glsl-plants.js';
import { computeSky, DEG } from './astro.js';
import { proceduralSkyline, horizonDip, SKYLINE_BINS, LANDSCAPES } from './landscape.js';
import { CLEAR } from './weather.js';
import { now as simNow, setSim, getSim } from '../simtime.js';

const TRANS_W = 256, TRANS_H = 64;
const MS_SIZE = 32;
const SKY_W = 256, SKY_H = 192;

// Bortle class -> artificial zenith sky glow (cd/m^2); see Zeus-Rises light pollution notes
const BORTLE_LUM = [0, 5e-5, 1.9e-4, 5.7e-4, 1.8e-3, 5.7e-3, 1.8e-2, 5.7e-2, 1.8e-1, 5e-1];
const NIGHT_TINT = [0.55, 0.75, 1.0];
const LP_TINT = [1.0, 0.62, 0.30];
const lumaOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export class SkyEngine {
  constructor(canvas, { baseUrl = '.', lutScale = 1, governor = false, es2 = false } = {}) {
    this.canvas = canvas;
    this.baseUrl = baseUrl;
    // The quality governor (governor.js), when asked for: keeps frames between a floor and a ceiling by moving along a ladder of quality levels.
    // Off by default (the page then behaves as it always did); the Pi's program switches it on.
    this.gov = governor ? new Capability(typeof governor === 'object' ? governor : {}) : null;
    this.onTick = null;                                   // (ms) => void: how long the clock should wait between frames while something moves
    if (this.gov) lutScale = this.gov.knobs.lut;
    this.lutScale = Math.min(1, Math.max(0.1, lutScale));       // the sky tables' size: 1 is full; a slow machine (a CPU doing the drawing) asks for less, at the cost of finer detail in the sky's colour gradients
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    // An OpenGL ES 2 GPU (Pi Zero, Zero 2, Pi 1-3) has no float render targets, no mip-level choice in shaders, no instancing: the same shaders are translated
    // to GLSL ES 1.00 and the tables are packed into 8-bit textures (portable.js). `es2: true` takes that path on any GPU (for tests).
    const ext = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    this.es2 = !!es2 || !ext;

    this.s = {
      lat: 40.7, lon: -74.0, elevM: 0, eyeM: 1.7,
      view: { heading: 180, pitch: 12, fov: 80, basis: null },
      weather: { ...CLEAR },
      mie: 2.0,
      quality: 'auto', scale: 0.75, maxDpr: 2, forceDpr: 0,
      bodySize: 2.0, nightBoost: 1.0, bortle: 3, cloudMotion: 1, twinkle: true,
      fps: 15, reducedMotion: false, lowPower: false, digitWeather: true,
      landscape: { type: 'hills', skyline: null, albedo: [0.12, 0.17, 0.07], haze: [0.35, 0.3, 0.55], ocean: false, seed: 1 },
      snowCover: 0,
      sea: null,                    // marine forecast {windHs, windTp, windDir, swellHs, swellTp, swellDir} or null: derive from the wind
      ground: null,                 // { g1, g2 } ground colours from the biome / season; null = landscape default
      plants: { on: false, count: 0, palette: null },
      tree: { on: false, az: 180, dist: 42, h: 13 },      // the Christmas tree (see setTree)
    };
    this.dirty = true;
    this.lutDirty = true;
    this.staticDirty = true;        // transmittance + multiscatter (depend on air + albedo)
    this.assets = { stars: false, moon: false, milky: false };
    this.sky = null;                // latest ephemeris
    this.lastAstro = -1e9;
    this.lastPlanets = -1e9;
    this.lutState = { sunAlt: 9, moonAlt: 9, camH: -1, mie: -1 };
    this.frameNo = 0;
    this.ditherScale = (() => { try { const v = parseFloat(new URLSearchParams(location.search).get('dither')); return Number.isFinite(v) ? Math.max(0, Math.min(6, v)) : 1; } catch (_) { return 1; } })();     // ?dither=n: to try a wider or no dither (a host without a page address keeps 1)
    this.lastRender = 0;
    this.perf = { acc: 0, n: 0, last: 0 };
    this.fast = false;              // look-around / drag: render every display frame
    this.listeners = new Set();
    this.presenters = new Set();
    this.exposure = { adaptSnap: true };
    this._init();
    if (this.gov) this.applyKnobs();
  }

  // ------------------------------------------------------------- setup ----
  // Shaders are compiled and linked without asking how it went: asking forces the page to wait for the driver. With
  // KHR_parallel_shader_compile the driver builds all of them side by side on other threads while the page carries on,
  // and the result is checked the first time a program is used (_ready). (Measured with a software renderer the total
  // time is the same whichever way it is done; on a GPU driver it keeps the main thread free while they build.)
  _program(vs, fs, attribs) {
    const gl = this.gl, p = gl.createProgram();
    if (this.es2) {
      const v = toES1(vs, 'vertex'), f = toES1(fs, 'fragment');
      vs = v.src; fs = f.src;
      if (v.usesVid) { attribs = { ...(attribs || {}) }; attribs.aVid = Object.keys(attribs).length; }       // no gl_VertexID: the vertex number comes from a buffer
    }
    const shaders = [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].map(([type, src]) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      gl.attachShader(p, sh);
      return { sh, src };
    });
    if (attribs) for (const [name, idx] of Object.entries(attribs)) gl.bindAttribLocation(p, idx, name);
    gl.linkProgram(p);
    return { prog: p, locs: {}, shaders, checked: false };
  }
  _ready(P) {
    if (P.checked) return;
    const gl = this.gl;
    if (!gl.getProgramParameter(P.prog, gl.LINK_STATUS)) {
      let msg = 'Link failed: ' + gl.getProgramInfoLog(P.prog);
      for (const { sh, src } of P.shaders) {
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) msg += '\nShader compile failed:\n' + gl.getShaderInfoLog(sh) + '\n--- source ---\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
      }
      throw new Error(msg);
    }
    P.checked = true;
    P.shaders = null;
  }
  _u(P, name) {
    const l = P.locs[name];
    if (l !== undefined) return l;
    return (P.locs[name] = this.gl.getUniformLocation(P.prog, name));
  }
  /** The final pass in its form for what is on the screen: 'off' (no clock glass), 'ink' (the LED panel's flat ink) or 'glass'; each made the first time it is needed. */
  _blitProgram(kind) { return this.pBlits[kind] || (this.pBlits[kind] = this._program(VERT_FULLSCREEN, fragBlit(kind))); }
  _use(P) {
    this._ready(P); this.gl.useProgram(P.prog); this._cur = P;
    if (P.label === undefined) {                                        // the first use: a name for the log (which shader is which)
      P.label = '?';
      for (const k of Object.keys(this)) { if (k === '_cur') continue; const v = this[k]; if (v === P) { P.label = k.replace(/^p(?=[A-Z])/, ''); break; } if (k === 'pBlits') for (const b of Object.keys(v)) if (v[b] === P) P.label = 'final pass: ' + b; }
      if (this.gl.__label) this.gl.__label(P.prog, P.label);
    }
  }
  // Uniform setters. A program keeps its uniforms between draws, so a value that has not changed is not sent again: most of the hundreds of values set for a
  // frame are the same as the last frame's, and on a slow machine each call across to the driver costs. (`vals` holds what each program was last given.)
  // (They allocate nothing: the last values live in an array per name that is changed in place. On a Pi Zero a frame sets some three hundred uniforms, and a temporary array each was a third of
  // the time they took.) `_same` stays for a caller with its own array.
  _same(n, a) {
    const P = this._cur, c = P.vals || (P.vals = {}), o = c[n];
    if (o !== undefined) { let eq = o.length === a.length; for (let i = 0; eq && i < a.length; i++) if (o[i] !== a[i]) eq = false; if (eq) return true; }
    c[n] = a; return false;
  }
  _1f(n, v) { const P = this._cur, c = P.vals || (P.vals = {}), o = c[n]; if (o !== undefined) { if (o[0] === v) return; o[0] = v; } else c[n] = [v]; this.gl.uniform1f(this._u(P, n), v); }
  _1i(n, v) { const P = this._cur, c = P.vals || (P.vals = {}), o = c[n]; if (o !== undefined) { if (o[0] === v) return; o[0] = v; } else c[n] = [v]; this.gl.uniform1i(this._u(P, n), v); }
  _2f(n, a, b) { const P = this._cur, c = P.vals || (P.vals = {}), o = c[n]; if (o !== undefined) { if (o[0] === a && o[1] === b) return; o[0] = a; o[1] = b; } else c[n] = [a, b]; this.gl.uniform2f(this._u(P, n), a, b); }
  _3f(n, v) { const P = this._cur, c = P.vals || (P.vals = {}), o = c[n]; if (o !== undefined) { if (o[0] === v[0] && o[1] === v[1] && o[2] === v[2]) return; o[0] = v[0]; o[1] = v[1]; o[2] = v[2]; } else c[n] = [v[0], v[1], v[2]]; this.gl.uniform3f(this._u(P, n), v[0], v[1], v[2]); }
  _4f(n, a, b, d, e) { const P = this._cur, c = P.vals || (P.vals = {}), o = c[n]; if (o !== undefined) { if (o[0] === a && o[1] === b && o[2] === d && o[3] === e) return; o[0] = a; o[1] = b; o[2] = d; o[3] = e; } else c[n] = [a, b, d, e]; this.gl.uniform4f(this._u(P, n), a, b, d, e); }
  _m3(n, m) { if (!this._same(n, Array.from(m))) this.gl.uniformMatrix3fv(this._u(this._cur, n), false, m); }

  /**
   * The vertex layout of a plant sprite buffer. One instance = [x z height type | seed variant], advanced per instance; a GPU without instancing (OpenGL ES 2)
   * gets the same data once per corner instead (`_expand`), with the corner number as a third attribute.
   */
  _instanceAttribs(vao, buf) {
    const gl = this.gl;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    if (this.es2) {
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 28, 16);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
    } else {
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0); gl.vertexAttribDivisor(0, 1);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16); gl.vertexAttribDivisor(1, 1);
    }
    gl.bindVertexArray(null);
  }
  /** Instances (6 floats each) -> six vertices each (7 floats: the instance and the corner number), for a GPU that cannot draw instances. */
  _expand(data, count) {
    const out = new Float32Array(count * 6 * 7);
    for (let i = 0; i < count; i++) for (let c = 0; c < 6; c++) {
      const o = (i * 6 + c) * 7;
      for (let j = 0; j < 6; j++) out[o + j] = data[i * 6 + j];
      out[o + 6] = c;
    }
    return out;
  }
  /** Draws `count` plant sprites from the bound sprite buffer. */
  _drawSprites(count) {
    const gl = this.gl;
    if (this.es2) gl.drawArrays(gl.TRIANGLES, 0, 6 * count);
    else gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
  }

  _target(w, h, internal, format, type, filter = this.gl.LINEAR, wrap = this.gl.CLAMP_TO_EDGE) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplete');
    return { tex, fbo, w, h };
  }
  _bind(unit, tex) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }

  _init() {
    const gl = this.gl;
    gl.getExtension('KHR_parallel_shader_compile');                    // opt in: compiles then run on other threads
    this.vaoEmpty = gl.createVertexArray();
    if (this.es2) {                                                    // vertex numbers 0..5 as an attribute (the shaders' aVid)
      this.vidBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vidBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 2, 3, 4, 5]), gl.STATIC_DRAW);
      gl.bindVertexArray(this.vaoEmpty);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }

    this.pTrans = this._program(VERT_FULLSCREEN, FRAG_TRANSMITTANCE);
    this.pMS = this._program(VERT_FULLSCREEN, FRAG_MULTISCATTER);
    this.pSkyView = this._program(VERT_FULLSCREEN, FRAG_SKYVIEW);
    this.pNoise = this.es2 ? null : this._program(VERT_FULLSCREEN, FRAG_NOISE);          // (an ES 2 GPU has no integer arithmetic: data/noise.bin has the same picture)
    this.pAdapt = this._program(VERT_FULLSCREEN, FRAG_ADAPT);
    this.pConsts = this._program(VERT_FULLSCREEN, FRAG_CONSTS);
    this.pSceneSky = this._program(VERT_FULLSCREEN, FRAG_SCENE_SKY);          // the sky and the ground are two programs into one picture (glsl-scene.js: one is too big for a small GPU)
    this.pSceneCloud = this._program(VERT_FULLSCREEN, FRAG_SCENE_CLOUD);        // one cloud layer, drawn up to three times
    this.pSceneFog = this._program(VERT_FULLSCREEN, FRAG_SCENE_FOG);
    this.pSceneTerrain = this._program(VERT_FULLSCREEN, this.es2 ? fragTerrain('land') : FRAG_SCENE_TERRAIN);          // (a small GPU gets the sea as a program of its own)
    this.pBlits = {};                                            // the final pass in the form that is needed (_blitProgram)
    performance.mark('sky:programs-compiled');
    this.pLed = this._program(VERT_FULLSCREEN, FRAG_LED);
    this.pLedPeak = this._program(VERT_FULLSCREEN, FRAG_LED_PEAK);
    this.pLedAvg = this.es2 ? this._program(VERT_FULLSCREEN, FRAG_LED_AVG) : null;
    this.pStars = this._program(VERT_STARS, FRAG_STARS, { aStar: 0, aBV: 1 });
    this.pPlants = this._program(VERT_PLANTS, FRAG_PLANTS, { aInst: 0, aSeed: 1 });

    // the tables: half floats, or (OpenGL ES 2) 8-bit textures with the colour packed in (portable.js), read texel by texel, so never filtered by the hardware
    const es2 = this.es2, F = es2 ? gl.RGBA8 : gl.RGBA16F, RGBA = gl.RGBA, HF = es2 ? gl.UNSIGNED_BYTE : gl.HALF_FLOAT;
    const ls = this.lutScale, sc = (v, min) => Math.max(min, Math.round(v * ls));
    // The brightness tables (transmittance, multiple scattering, sky view): full floats where the GPU can draw into them (a half float has nothing between 0 and 6e-5 on some GPUs, and the
    // twilight sky lives there), and always read texel by texel (portable.js hdrTex), never filtered by the hardware.
    const f32 = !es2 && !!gl.getExtension('EXT_color_buffer_float');
    const TF = es2 ? F : f32 ? gl.RGBA32F : gl.RGBA16F, TT = es2 ? HF : f32 ? gl.FLOAT : gl.HALF_FLOAT, TL = gl.NEAREST;
    this.tTrans = this._target(sc(TRANS_W, 64), sc(TRANS_H, 16), TF, RGBA, TT, TL);
    this.tMS = this._target(sc(MS_SIZE, 8), sc(MS_SIZE, 8), TF, RGBA, TT, TL);
    this.tSkySun = this._target(sc(SKY_W, 64), sc(SKY_H, 48), TF, RGBA, TT, TL);
    this.tSkyMoon = this._target(sc(SKY_W, 64), sc(SKY_H, 48), TF, RGBA, TT, TL);
    this.tConsts = this._target(CONSTS_N + HAZE_N, 1, F, RGBA, HF, gl.NEAREST);         // the values that are the same for every pixel (glsl-scene.js: FRAG_CONSTS)
    this.tAdapt = [this._target(1, 1, F, RGBA, HF, gl.NEAREST), this._target(1, 1, F, RGBA, HF, gl.NEAREST)];
    this.adaptIdx = 0;

    // procedural tileable noise (clouds, water, ground speckle), with mips
    if (es2) this.tNoise = this._target(NOISE_ATLAS.w, NOISE_ATLAS.h, gl.RGBA8, RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, gl.CLAMP_TO_EDGE);      // filled when the file has arrived (_noiseAtlas)
    else {
      this.tNoise = this._target(256, 256, gl.RGBA8, RGBA, gl.UNSIGNED_BYTE, gl.LINEAR_MIPMAP_LINEAR, gl.REPEAT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.tNoise.fbo);
      gl.viewport(0, 0, 256, 256);
      this._use(this.pNoise);
      gl.bindVertexArray(this.vaoEmpty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, this.tNoise.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    // textures filled asynchronously
    const mk = (wrapS) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.texMilky = mk(gl.REPEAT);
    this.texMoon = mk(gl.CLAMP_TO_EDGE);

    this.texSkyline = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texSkyline);
    this._skylineData(new Float32Array(SKYLINE_BINS * 4).fill(-1));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, es2 ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, es2 ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, es2 ? gl.CLAMP_TO_EDGE : gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // stars: [x y z mag bv] per vertex
    this.starBuf = gl.createBuffer();
    this.starCount = 0;
    this.planetBuf = gl.createBuffer();
    this.planetCount = 0;
    this.vaoStars = gl.createVertexArray();
    this.vaoPlanets = gl.createVertexArray();
    // plants: one instance = [x z height type | seed variant], advanced per instance
    this.plantBuf = gl.createBuffer();
    this.vaoPlants = gl.createVertexArray();
    this._instanceAttribs(this.vaoPlants, this.plantBuf);
    // the Christmas tree: two instances of the plant sprite (the tree, and its reflection when it floats on the sea)
    this.treeBuf = gl.createBuffer();
    this.vaoTree = gl.createVertexArray();
    this._instanceAttribs(this.vaoTree, this.treeBuf);
    for (const [vao, buf] of [[this.vaoStars, this.starBuf], [this.vaoPlanets, this.planetBuf]]) {
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
    }
    gl.bindVertexArray(null);

    this.sceneTarget = null;
    this.glass = { mode: 0, frost: 0.35, contrast: 3, glow: 0, glowCol: [1, 0.85, 0.6], led: { on: false, cols: 64, rows: 32, gap: 0.16, brightness: 1, stars: 1 }, overlay: false, overlayFull: false, dropsOn: false, ink: [0.96, 0.97, 1], stroke: 30, light: [-0.5, 0.8, 0.6], lightCol: [1, 1, 1], rect: [0, 0, 1, 1], maskW: 1, maskH: 1, hasMask: false };
    this.overlayTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.overlayFullTex = gl.createTexture();                  // full-size overlay for panels the tuned layout does not cover
    gl.bindTexture(gl.TEXTURE_2D, this.overlayFullTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.dropsTex = this.dropsTexCanvas = gl.createTexture();             // raindrops on the digits (drops.js), same shape and place as the mask
    gl.bindTexture(gl.TEXTURE_2D, this.dropsTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.canDrawMask = true;                       // setGlassGeometry works (glass.js uses it unless told not to)
    this.maskTex = this.maskTexCanvas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this._applySkyline();
    this._loadAssets();
  }

  async _loadAssets() {
    const gl = this.gl;
    const url = (p) => new URL(p, new URL(this.baseUrl + '/', document.baseURI)).href;
    const img = (p) => new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('failed to load ' + p));
      im.src = url(p);
    });
    const tasks = [
      this.es2 ? fetch(url('data/noise.bin')).then(r => r.arrayBuffer()).then(buf => { this._noiseAtlas(new Uint8Array(buf)); this.assets.noise = true; }) : Promise.resolve(),
      fetch(url('data/stars.bin')).then(r => r.arrayBuffer()).then(buf => {
        const n = buf.byteLength / 6, dv = new DataView(buf), out = new Float32Array(n * 5);
        for (let i = 0; i < n; i++) {
          const ra = dv.getUint16(i * 6, true) / 65535 * 2 * Math.PI;
          const dec = (dv.getUint16(i * 6 + 2, true) / 65535 - 0.5) * Math.PI;
          const mag = dv.getUint8(i * 6 + 4) / 20 - 2, bv = dv.getUint8(i * 6 + 5) / 100 - 0.5;
          out[i * 5] = Math.cos(dec) * Math.cos(ra);
          out[i * 5 + 1] = Math.cos(dec) * Math.sin(ra);
          out[i * 5 + 2] = Math.sin(dec);
          out[i * 5 + 3] = mag; out[i * 5 + 4] = bv;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuf);
        gl.bufferData(gl.ARRAY_BUFFER, out, gl.STATIC_DRAW);
        this.starCount = n;
        this.assets.stars = true;
      }),
      img('data/milkyway.png').then(im => {
        gl.bindTexture(gl.TEXTURE_2D, this.texMilky);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        this.assets.milky = true;
      }),
      img('data/moon.jpg').then(im => {
        gl.bindTexture(gl.TEXTURE_2D, this.texMoon);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        this.assets.moon = true;
      }),
    ];
    const results = await Promise.allSettled(tasks);
    results.filter(r => r.status === 'rejected').forEach(r => console.warn('[sky] asset:', r.reason));
    this.dirty = true;
    this.assetsDone = true;
    performance.mark('sky:assets-done');
  }

  // ------------------------------------------------------------ state ----
  /** Merge a partial state object. Nested objects (view, weather, landscape) are merged shallowly. */
  set(patch) {
    const s = this.s;
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'sim') setSim(v);
      else if (['view', 'landscape', 'plants'].includes(k)) s[k] = { ...s[k], ...v };
      else s[k] = v;
    }
    if ('lat' in patch || 'lon' in patch || 'elevM' in patch || 'sim' in patch) { this.lastAstro = -1e9; this.lastPlanets = -1e9; this.exposure.adaptSnap = true; }
    if ('weather' in patch || 'mie' in patch) this.staticDirty = true;
    if ('elevM' in patch || 'eyeM' in patch) this.lutDirty = true;
    if ('landscape' in patch) this._applySkyline();
    if ('quality' in patch) { this._resetScale(); if (this.gov) this.applyKnobs(); }
    this.dirty = true;
  }

  setLandscapeType(type, seed) {
    const sk = proceduralSkyline(type, (this.s.eyeM) / 1000, seed ?? this.s.landscape.seed);
    this.set({ landscape: { type, skyline: sk.data, albedo: sk.albedo, haze: sk.haze, ocean: sk.ocean, seed: seed ?? this.s.landscape.seed } });
  }

  _applySkyline() {
    const gl = this.gl, l = this.s.landscape;
    if (!l.skyline) {
      const sk = proceduralSkyline(l.type, this.s.eyeM / 1000, l.seed);
      l.skyline = sk.data; l.albedo = sk.albedo; l.haze = sk.haze; l.ocean = sk.ocean;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texSkyline);
    this._skylineData(l.skyline);
  }

  /** Uploads the skyline (4 floats per azimuth bin) into the bound texture: half floats, or packed into two rows of bytes on an ES 2 GPU. */
  _skylineData(data) {
    const gl = this.gl;
    if (this.es2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SKYLINE_BINS, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, packSkyline(data));
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, SKYLINE_BINS, 1, 0, gl.RGBA, gl.FLOAT, data);
  }

  /** ES 2: the noise texture (256 x 256 x RGBA, data/noise.bin) with its mip levels laid out in one texture (see FRAG_NOISE_PLACE). */
  _noiseAtlas(bytes) {
    const gl = this.gl, N = NOISE_ATLAS;
    this.pNoiseDown = this.pNoiseDown || this._program(VERT_FULLSCREEN, FRAG_NOISE_DOWN);
    this.pAtlasPlace = this.pAtlasPlace || this._program(VERT_FULLSCREEN, FRAG_ATLAS_PLACE);
    const levels = N.levels.map(({ s }) => this._target(s, s, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, gl.REPEAT));
    gl.bindTexture(gl.TEXTURE_2D, levels[0].tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.bindVertexArray(this.vaoEmpty);
    this._use(this.pNoiseDown);
    for (let k = 1; k < levels.length; k++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, levels[k].fbo); gl.viewport(0, 0, levels[k].w, levels[k].h);
      this._1i('uSrc', 0); this._bind(0, levels[k - 1].tex); this._2f('uSize', levels[k].w, levels[k].h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tNoise.fbo);
    this._use(this.pAtlasPlace);
    this._1i('uSrc', 0); this._1f('uWrap', 1);
    for (const { k, s, y } of N.levels) {
      gl.viewport(0, y, s + 2, s + 2);
      this._bind(0, levels[k].tex); this._2f('uSize', s, s); this._1f('uY', y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);
    for (const l of levels) { gl.deleteTexture(l.tex); gl.deleteFramebuffer(l.fbo); }
  }

  _resetScale() {
    const q = this.s.quality;
    this.s.scale = q === 'low' ? 0.5 : q === 'medium' ? 0.75 : q === 'high' ? 1.0 : 0.75;
  }

  get now() { return simNow(); }

  /**
   * The host says what a frame cost to make and show (ms; a host that copies frames out measures this; a browser cannot). `kind` is 'glass' (only the
   * digits moved) or 'scene' (the sky was redrawn too: it happens rarely, so a hitch of four frames' worth counts as one).
   */
  reportFrame(costMs, kind = 'glass') {
    const g = this.gov; if (!g) return;
    if (g.report(costMs, kind, performance.now())) this.applyKnobs();
    if (this.onTick) this.onTick(g.tickMs);
  }
  /** Puts the governor's current level into effect. */
  applyKnobs() {
    const g = this.gov; if (!g) return;
    const k = g.knobs;
    this.s.scale = Math.min(k.scale, { low: 0.5, medium: 0.75 }[this.s.quality] || 1);          // (the Quality setting still caps the sky's size: Low and Medium are smaller than the ladder's top)
    this.s.outScale = this.glass.led.on ? 1 : k.outScale;          // an LED panel needs its cells at the size they are read back
    this.starFrac = k.stars;
    if (this.knobs && this.knobs.glass === false && k.glass !== false) this._mipsStale = true;            // the glass is back: its tables are rebuilt
    this.knobs = k;
    if (this.onKnobs) this.onKnobs(k);                // the page: seconds, the clock's rhythm, the light timer
    this.dirty = true;
  }
  onFrame(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /** Called after anything changed what is on the canvas: a full render, or only the glass pass (a digit moved). A host that has to copy frames somewhere (the Pi) listens to this. */
  onPresent(fn) { this.presenters.add(fn); return () => this.presenters.delete(fn); }
  /** Called at the start of any work that ends in a picture (the page's glass drawing, a full render): the first call since the last picture is when this frame's cost starts. */
  markWork() { if (this._work0 == null) this._work0 = performance.now(); }
  _presented(kind) {
    const since = this._work0; this._work0 = null;
    for (const fn of this.presenters) fn(this, kind, since);
    if (this.autoProbe && this.gov && !document.hidden) this._probe(kind, since);
  }
  /**
   * A browser cannot be asked what a frame cost: its GL calls return before the GPU is done (Safari's finish does not even wait). So now and then, once a second (and for a sky
   * redraw, once in five seconds), one pixel is read back: that waits for everything queued, and the time since the work began is the frame's true cost, which goes to the ladder.
   * The Raspberry Pi program measures its own (it reads every picture back), so it leaves this off.
   */
  _probe(kind, since) {
    const now = performance.now(), gl = this.gl;
    const due = kind === 'scene' ? now - (this._probeScene || -1e9) >= 5000 || now - (this._probeAt || -1e9) >= 1000 : now - (this._probeAt || -1e9) >= 1000;
    if (!due) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this._probePx || (this._probePx = new Uint8Array(4)));
    const cost = performance.now() - (since != null && now - since < 5000 ? since : now);
    this._probeAt = now; if (kind === 'scene') this._probeScene = now;
    this.reportFrame(cost, kind);
  }

  /**
   * The 'adapt' setting at run time: 'auto' takes the capability ladder on, 'off' takes it away (everything the settings say), a rung name holds it at that step (and the ones before).
   * `profile` is 'sharp' (the picture keeps its size) or 'smooth' (the whole picture may shrink).
   */
  setAdapt(mode, profile) {
    if (mode === 'off') {
      this.gov = null; this.knobs = undefined;
      this.s.outScale = 1; this._resetScale();
      if (this.onKnobs) this.onKnobs(null);
      this.dirty = true;
      return;
    }
    this._profile = profile || this._profile || 'sharp';
    const hold = mode in RUNG_OF;
    this.gov = new Capability({ profile: this._profile, ...(hold ? { rung: RUNG_OF[mode], pin: true } : {}) });
    this.applyKnobs();
  }

  // ----------------------------------------------------------- astronomy ---
  _updateAstro(perfNow, force) {
    const s = this.s, sim = getSim(), scaled = sim && sim.scale > 1;
    const interval = scaled ? 0 : 1000;
    if (!force && perfNow - this.lastAstro < interval && this.sky) return false;
    const needPlanets = scaled || perfNow - this.lastPlanets > 10000 || !this.sky;
    const date = this.now;
    const sky = computeSky(date, s.lat, s.lon, s.elevM, { planets: needPlanets });
    if (!needPlanets && this.sky) sky.planets = this.sky.planets;
    else this.lastPlanets = perfNow;
    this.sky = sky;
    this.lastAstro = perfNow;
    return true;
  }

  // -------------------------------------------------------------- LUTs ----
  _runPass(target, P) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    this._use(P);
    gl.bindVertexArray(this.vaoEmpty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _updateLuts() {
    const gl = this.gl, s = this.s, sky = this.sky;
    const camH = Math.max((s.elevM + s.eyeM) / 1000, 0.002);
    const mie = Math.max(0.2, s.mie);
    const st = this.lutState;
    gl.disable(gl.BLEND);

    if (this.staticDirty || st.mie !== mie) {
      this._use(this.pTrans);
      this._1f('uMie', mie);
      this._runPass(this.tTrans, this.pTrans);
      this._use(this.pMS);
      this._1f('uMie', mie);
      this._1f('uGroundAlbedo', 0.3);
      this._1i('uTrans', 0);
      this._2f('uTransPx', this.tTrans.w, this.tTrans.h);
      this._bind(0, this.tTrans.tex);
      this._runPass(this.tMS, this.pMS);
      this.staticDirty = false;
      st.mie = mie;
      st.sunAlt = 9; st.moonAlt = 9;          // force the view LUTs too
    }

    const sunAlt = sky.sun.alt * DEG;
    const moonAlt = sky.moon.alt * DEG;
    const sunNeeded = sky.sun.alt > -20;
    const moonNeeded = sky.moon.alt > -8 && sky.moon.lux > 0;
    const camChanged = Math.abs(st.camH - camH) > 1e-4;

    const runView = (target, elev) => {
      this._use(this.pSkyView);
      this._1f('uMie', mie);
      this._1f('uElev', elev);
      this._1f('uCamH', camH);
      this._1i('uTrans', 0); this._1i('uMS', 1);
      this._2f('uTransPx', this.tTrans.w, this.tTrans.h); this._2f('uMSPx', this.tMS.w, this.tMS.h);
      this._bind(0, this.tTrans.tex); this._bind(1, this.tMS.tex);
      this._runPass(target, this.pSkyView);
    };
    // fine thresholds: ~0.02 deg for the sun keeps the terminator glow smooth
    if (sunNeeded && (camChanged || Math.abs(sunAlt - st.sunAlt) > 0.00035)) { runView(this.tSkySun, sunAlt); st.sunAlt = sunAlt; }
    if (moonNeeded && (camChanged || Math.abs(moonAlt - st.moonAlt) > 0.0017)) { runView(this.tSkyMoon, moonAlt); st.moonAlt = moonAlt; }
    st.camH = camH;
    this.camH = camH;
  }

  // ---------------------------------------------------------------- view ---
  _basis() {
    const v = this.s.view;
    if (v.basis) return v.basis;                 // { right, up, forward } in world coordinates
    const h = v.heading * DEG, p = v.pitch * DEG;
    const fwd = [Math.sin(h) * Math.cos(p), Math.sin(p), Math.cos(h) * Math.cos(p)];
    const right = norm3(cross([0, 1, 0], fwd));
    const up = cross(fwd, right);
    return { right, up, forward: fwd };
  }

  _camera(w, h) {
    const b = this._basis();
    const mat = new Float32Array([...b.right, ...b.up, ...b.forward]);
    const aspect = w / h, t = Math.tan(this.s.view.fov * DEG / 2);
    const tan = aspect >= 1 ? [t, t / aspect] : [t * aspect, t];
    return { mat, tan };
  }

  // -------------------------------------------------------------- render ---
  _ensureScene(w, h) {
    const gl = this.gl;
    if (this.sceneTarget && this.sceneTarget.w === w && this.sceneTarget.h === h) return;
    if (this.sceneTarget) { gl.deleteTexture(this.sceneTarget.tex); gl.deleteFramebuffer(this.sceneTarget.fbo); }
    this.sceneTarget = this._target(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
  }

  /** The biggest texture (and so picture) this GPU makes, px. */
  get maxTexture() { if (!this._maxTex) { let m = 0; try { m = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) | 0; } catch (_) { /* unknown: a safe size */ } this._maxTex = m >= 256 ? m : 4096; } return this._maxTex; }

  _animated() {
    const s = this.s, w = s.weather;
    if (s.reducedMotion) return false;
    const K = this.knobs, weatherOn = !K || K.weather, ambientOn = !K || K.ambient;      // (the capability ladder: what the hardware can handle outranks the settings)
    const clouds = ambientOn && s.cloudMotion > 0 && (w.cover[0] > 0.02 || w.cover[1] > 0.02 || w.cover[2] > 0.02);
    const water = ambientOn && s.landscape.ocean;
    const rain = weatherOn && w.precip > 0.01;
    const night = ambientOn && this.sky && this.sky.sun.alt < -6 && s.twinkle;
    const wind = ambientOn && s.plants.on && s.plants.count > 0 && s.cloudMotion > 0;      // plants sway
    const lights = ambientOn && this.s.tree.on;                    // the tree's bulbs twinkle
    return clouds || water || rain || night || wind || lights;
  }

  interval() {
    const sim = getSim();
    if (this.fast || (sim && sim.scale > 1)) return 0;
    if (this.gov) { const k = this.gov.knobs; return this._animated() ? Math.min(this.gov.tickMs, k.skyMs) : k.skyMs; }     // the governor decides how often a still sky is redrawn; a moving one (sway, clouds, water) is drawn as fast as the measured frame cost allows, 60 a second at best (the governor's tickMs), never slowed by the still sky's
    if (this._animated()) return this.s.lowPower ? 900 : 1000 / this.s.fps;    // saving power: an animated scene (the sea) redraws only with the clock's tick, once a second
    return 1000;
  }

  // ---- the loop ----
  // Not a constant 60 Hz requestAnimationFrame: when the sky is still the page sleeps on a timer until the next redraw
  // is due (about once a second), and only asks for animation frames while a frame is actually wanted. Anything that
  // marks the scene dirty, or turns on `fast`, wakes it at once.
  get dirty() { return this._dirty; }
  set dirty(v) { this._dirty = v; if (v) this._wake(); }
  get fast() { return this._fast; }
  set fast(v) { const was = this._fast; this._fast = v; if (v && !was) this._wake(); }

  /** Draws if a frame is due. */
  tick(t) {
    if (this.dirty || t - this.lastRender >= this.interval()) {
      if (!this.dirty && this._quietFor()) return;       // a sky redraw that could still be running when the minute turns waits until after it
      this.lastRender = t;
      this.render(t);
    }
  }

  _frame = (t) => {
    this._raf = 0;
    if (!this._running) return;
    if (!document.hidden) this.tick(t);
    this._schedule();
  };

  /**
   * The time must be right when the minute turns, whatever the hardware: on the rungs that show no seconds, a sky redraw (seconds long on a Pi Zero, and it cannot be interrupted)
   * is not started where it could still be running at the minute, with room for the digits' own redraw after it. Returns how long to wait (ms; 0: no need).
   */
  _quietFor() {
    const K = this.knobs, g = this.gov;
    if (!K || !K.ahead || !g || !g.worst || !this.sceneTarget || getSim()) return 0;
    return quietFor(60000 - (this.now.getTime() % 60000), g.worst('scene'), g.leadMs);
  }

  _schedule() {
    if (!this._running || this._raf || this._to || document.hidden) return;   // hidden: visibilitychange wakes us
    let wait = this._dirty || this._fast ? 0 : Math.max(0, this.interval() - (performance.now() - this.lastRender));
    if (!this._dirty && !this._fast) { const q = this._quietFor(); if (q) wait = Math.max(wait, q); }
    if (wait > 0 && this.s.lowPower && this._animated()) wait = Math.max(wait, 1000 - (this.now.getTime() % 1000) + 25);   // ... and just after the second turns, when the digits change too
    if (wait <= 4) this._raf = requestAnimationFrame(this._frame);
    else this._to = setTimeout(() => { this._to = 0; this._raf = requestAnimationFrame(this._frame); }, wait);
  }

  _wake() {
    if (!this._running || document.hidden) return;
    if (this._to) { clearTimeout(this._to); this._to = 0; }
    this._schedule();
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._onVis = () => { if (!document.hidden) this._wake(); };
    document.addEventListener('visibilitychange', this._onVis);
    this._schedule();
  }
  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf); clearTimeout(this._to);
    this._raf = this._to = 0;
    document.removeEventListener('visibilitychange', this._onVis);
  }

  render(t) {
    this.markWork();
    const gl = this.gl, s = this.s;
    const firstRender = !this._rendered;
    if (firstRender) performance.mark('sky:first-render-start');
    const perfNow = performance.now();

    // canvas / scene size
    const dpr = s.forceDpr || Math.min(window.devicePixelRatio || 1, s.maxDpr);       // (forceDpr: ?dpr=n, a test of what a bigger screen would cost)
    let out = this.glass.led.on || this.s.outScale == null ? 1 : this.s.outScale;       // the output's own size, below 1 when the governor saves work (the screen enlarges it)
    { const big = Math.max(this.canvas.clientWidth, this.canvas.clientHeight) * dpr * out; if (big > this.maxTexture) out *= this.maxTexture / big; }       // (no picture larger than the GPU's biggest texture: a Pi Zero's is 2048; the screen enlarges it)
    const cw = Math.max(2, Math.floor(this.canvas.clientWidth * dpr * out));
    const ch = Math.max(2, Math.floor(this.canvas.clientHeight * dpr * out));
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    const rw = Math.max(2, Math.round(cw * s.scale)), rh = Math.max(2, Math.round(ch * s.scale));
    this._ensureScene(rw, rh);

    const jumped = this._updateAstro(perfNow, this.dirty && this.lastAstro < 0);
    const sky = this.sky;
    const K = this.knobs;                                         // what the capability ladder leaves (undefined without a governor: everything)
    if (K && !K.sky) return this._renderFlat(rw, rh, sky, firstRender, perfNow);
    this._updateLuts();

    // ---- derived lighting ----
    const sunAlt = sky.sun.alt * DEG, moonAlt = sky.moon.alt * DEG;
    const sunLux = sky.sun.alt > -20 ? sky.sun.lux : 0;
    const moonVisible = sky.moon.alt > -8 && sky.moon.lux > 0;
    const moonLux = moonVisible ? sky.moon.lux : 0;
    const sunAz = sky.sun.az * DEG, moonAz = sky.moon.az * DEG;

    const natural = NIGHT_TINT.map(c => c * 2.2e-4 / lumaOf(NIGHT_TINT));
    const lpL = BORTLE_LUM[Math.min(9, Math.max(1, Math.round(s.bortle)))] * (s.bortle > 0 ? 1 : 0);
    const lp = LP_TINT.map(c => c * lpL / lumaOf(LP_TINT));

    const w = s.weather;
    const lowC = w.cover[0];
    const adaptScale = 1 + 0.2 * lowC - 0.45 * w.cloudDark * lowC;
    const cam = this._camera(rw, rh);
    const camH = this.camH ?? Math.max((s.elevM + s.eyeM) / 1000, 0.002);
    const land = s.landscape;
    const ground = s.ground ? s.ground.g1 : land.albedo.map((c) => c + (0.82 - c) * w.snowCover);
    const ground2 = s.ground ? s.ground.g2 : ground;
    const dtSec = Math.min(2, Math.max(0.001, (perfNow - (this._lastAdapt || perfNow)) / 1000));
    this._lastAdapt = perfNow;
    const eyeKm = s.eyeM / 1000;
    const dip = horizonDip(Math.max(s.elevM / 1000, 0) + eyeKm);

    gl.disable(gl.BLEND);
    // ---- 1x1 auto exposure ----
    {
      const prev = this.tAdapt[this.adaptIdx], next = this.tAdapt[1 - this.adaptIdx];
      this._use(this.pAdapt);
      this._1f('uMie', s.mie);
      this._bindSkyUniforms(sky, sunAz, sunAlt, sunLux, moonAz, moonAlt, moonLux, natural, lp, camH);
      this._m3('uCam', cam.mat); this._2f('uTan', cam.tan[0], cam.tan[1]);
      this._1f('uDt', dtSec);
      const sim = getSim();
      this._1f('uSnap', this.exposure.adaptSnap || (jumped && sim && sim.scale > 60) ? 1 : 0);
      this._1f('uTau', 1.2);
      this._1f('uAdaptScale', adaptScale);
      this._1i('uPrev', 9);
      this._bind(9, prev.tex);
      this._runPass(next, this.pAdapt);
      this.adaptIdx = 1 - this.adaptIdx;
      this.exposure.adaptSnap = false;
    }

    // ---- the light that is the same for every pixel, once instead of at every one ----
    {
      this._use(this.pConsts);
      this._1f('uMie', s.mie);
      this._bindSkyUniforms(sky, sunAz, sunAlt, sunLux, moonAz, moonAlt, moonLux, natural, lp, camH);
      this._runPass(this.tConsts, this.pConsts);
    }

    // ---- scene ----
    const T = this.sceneTarget;
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
    gl.viewport(0, 0, T.w, T.h);
    const frameNo = this.frameNo++ % 1024;
    const setScene = () => {                                  // the same uniforms for both programs
    this._1f('uMie', s.mie);
    this._bindSkyUniforms(sky, sunAz, sunAlt, sunLux, moonAz, moonAlt, moonLux, natural, lp, camH);
    this._1i('uMilky', 4); this._bind(4, this.texMilky);
    this._1i('uMoonTex', 5); this._bind(5, this.texMoon);
    this._1i('uNoise', 6); this._bind(6, this.tNoise.tex);
    this._1i('uSkyline', 7); this._bind(7, this.texSkyline);
    this._1i('uAdapt', 8); this._bind(8, this.tAdapt[this.adaptIdx].tex);
    this._1i('uConsts', 10); this._bind(10, this.tConsts.tex);
    this._2f('uRes', T.w, T.h);
    this._m3('uCam', cam.mat); this._2f('uTan', cam.tan[0], cam.tan[1]);
    this._m3('uEqj', sky.eqj);
    this._3f('uSunDir', sky.sun.dir);
    this._3f('uMoonDir', sky.moon.dir);
    this._3f('uMoonPole', sky.moon.pole);
    this._1f('uMoonElon', sky.moon.elon);
    this._1f('uMoonAngR', sky.moon.angR * s.bodySize);
    this._1f('uMoonLux', sky.sun.lux);
    this._1f('uEarthshine', 0.0035 * (1 - sky.moon.fraction));
    this._1f('uSunDisc', 3.5);
    this._1f('uSunAngR', 0.00465 * s.bodySize);
    this._1f('uMWLum', 8e-4);
    this._1f('uKey', 0.36);
    this._1f('uBoost', Math.max(0.2, s.nightBoost));
    this._1f('uTime', (perfNow / 1000) % 100000 * (s.cloudMotion === 0 ? 0 : s.cloudMotion));
    this._3f('uCover', w.cover);
    this._1f('uCloudDark', w.cloudDark);
    this._2f('uWind', w.wind[0], w.wind[1]);
    this._1f('uVisKm', w.visKm);
    this._1f('uFog', w.fog);
    this._1f('uPrecip', !K || K.weather ? w.precip : 0);
    this._1f('uSnow', !K || K.weather ? w.snowfall : 0);
    {                                                                                        // wind leans the falling rain and carries the snow: the sideways part of the surface wind, across the view
      const ws = w.windMs || 0, wl = Math.hypot(w.wind[0], w.wind[1]) || 1;
      const sideways = ws > 0 ? (w.wind[0] / wl * cam.mat[0] + w.wind[1] / wl * cam.mat[2]) * ws : 0;           // m/s toward screen right (cam.mat columns: right, up, forward; x east, z north)
      const t = (perfNow / 1000) % 100000 * (s.cloudMotion === 0 ? 0 : s.cloudMotion), gustiness = ws > 0 ? Math.max(0, (w.gust || ws) - ws) / Math.max(w.gust || ws, 1) : 0;
      const gust = 1 + gustiness * (0.7 * Math.sin(t * 1.7) + 0.5 * Math.sin(t * 4.3 + 1));               // (gusts come and go; none in steady wind)
      const lean = Math.max(-0.75, Math.min(0.75, sideways * 0.04 * gust));
      this.lean = { on: ws > 0, v: lean };                                                                  // (the glass drops read it: glass.js)
      this._1f('uLeanOn', ws > 0 ? 1 : 0); this._1f('uLean', lean);
    }
    this._1f('uDpr', T.h / Math.max(1, this.canvas.clientHeight));
    this._3f('uGround', ground);
    this._3f('uGround2', ground2);
    this._1f('uWet', Math.min(1, w.precip * (1 - w.snowfall)));
    // sea state: real marine data when we have it, otherwise grown from the wind (fully developed sea, damped for fetch)
    if (land.ocean) {
      const m = s.sea, U = Math.hypot(w.wind[0], w.wind[1]) * 500, wl = Math.hypot(w.wind[0], w.wind[1]) || 1;
      const wd = [w.wind[0] / wl, w.wind[1] / wl];
      const hsW = m ? m.windHs : Math.min(0.0246 * U * U * 0.7, 7);
      const tW = m ? m.windTp : 3.9 * Math.sqrt(Math.max(hsW, 0.05)) + 1;
      const dW = m ? m.windDir : wd, dS = m ? m.swellDir : wd;
      const hsS = m ? m.swellHs : 0, tS = m ? m.swellTp : 9;
      const foamK = Math.min(1, Math.max(0, (Math.max(U, hsW * 4.2) - 5.5) / 5.5));
      this._4f('uWaveA', hsW, tW, dW[0], dW[1]);
      this._4f('uWaveB', hsS, tS, dS[0], dS[1]);
      this._4f('uSea', U, foamK * foamK * (3 - 2 * foamK), wd[0], wd[1]);
      this._1f('uSwellH', Math.min(0.5 * (hsW + hsS) / 110, 0.010));
    } else {
      this._4f('uWaveA', 0, 5, 1, 0); this._4f('uWaveB', 0, 9, 1, 0); this._4f('uSea', 0, 0, 1, 0); this._1f('uSwellH', 0);
    }
    this._1f('uLandType', land.ocean ? 1 : (land.type === 'city' ? 2 : 0));
    this._3f('uHaze', land.haze.map(v => v * (0.6 + 0.4 * Math.min(1, 25 / w.visKm))));
    this._1f('uEyeH', eyeKm);
    this._1f('uDip', dip);
    this._1f('uAdaptScale', adaptScale);
    this._1f('uFrame', frameNo);
    this._1f('uDither', this.ditherScale);
    };
    gl.disable(gl.BLEND);
    if (K && !K.landscape) this._drawFlat(cam, sky, 0);       // no landscape: the ground is a colour fading towards the horizon (the sky program leaves it alone where the ridges are)
    this._use(this.pSceneSky); setScene();                    // every pixel that is not wholly terrain
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND);                                      // everything after the sky goes over it by its own coverage; the fourth channel (the stars' sky-visibility) shrinks by the same share
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    for (const [cov, height, tile, sx, sy, tau, wind] of [[w.cover[2], 9.5, 120, 1, 0.32, 1.1, 1.6], [w.cover[1], 5.0, 70, 1, 0.8, 2.4, 1.2], [w.cover[0], 1.8, 40, 1, 1, 5.0, 1.0]]) {      // clouds, high to low
      if (!(cov >= 0.01)) continue;
      this._use(this.pSceneCloud); setScene();
      this._4f('uCloudP', cov, height, tile, tau); this._4f('uCloudQ', sx, sy, wind, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (w.fog > 0.005) { this._use(this.pSceneFog); setScene(); gl.drawArrays(gl.TRIANGLES, 0, 3); }
    if (!K || K.landscape) {
    this._use(this.pSceneTerrain); setScene();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.es2 && land.ocean) {
      this.pSceneOcean = this.pSceneOcean || this._program(VERT_FULLSCREEN, fragTerrain('ocean'));
      this._use(this.pSceneOcean); setScene();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    }
    gl.disable(gl.BLEND);

    // ---- plants: alpha-blended sprites that also knock the stars' visibility mask down ----
    this._drawPlants(sky, sunAz, sunAlt, sunLux, moonAz, moonAlt, moonLux, natural, lp, camH, cam, perfNow, w, eyeKm);

    // ---- stars + planets: additive, weighted by the scene's sky-visibility alpha ----
    this._drawStars(sky, sunAz, sunAlt, sunLux, moonAz, moonAlt, moonLux, natural, lp, camH, cam, T, perfNow, w);

    // ---- blit (+ glass clock) ----
    this._blit(true);
    this._mipsValid = this.glass.mode > 0 && this.glass.hasMask;

    this.dirty = false;
    if (firstRender) {
      this._rendered = true;
      if (/[?&]perf\b/.test(location.search)) gl.finish();               // ?perf: wait for the GPU, so the mark below is when the frame is really done
      performance.mark('sky:first-render-end');
    }
    this._autoScale(perfNow);
    for (const fn of this.listeners) fn(this);
    this._presented('scene');
  }

  /** One cheap pass of the flat sky and ground (flatsky.js): mode 0 the ground colour everywhere, 1 the whole picture. The scene's target must be bound. */
  _drawFlat(cam, sky, mode) {
    const gl = this.gl, s = this.s, w = s.weather;
    if (!this.pFlat) this.pFlat = this._program(VERT_FULLSCREEN, FRAG_FLAT);
    const pal = flatPalette(sky.sun.alt, Math.max(w.cover[0], w.cover[1], w.cover[2]), w.precip || 0, s.landscape.albedo);
    gl.disable(gl.BLEND);
    this._use(this.pFlat);
    this._m3('uCam', cam.mat); this._2f('uTan', cam.tan[0], cam.tan[1]);
    this._3f('uZen', pal.zenith); this._3f('uHor', pal.horizon); this._3f('uGN', pal.groundNear); this._3f('uGF', pal.groundFar);
    this._1f('uMode', mode);
    gl.bindVertexArray(this.vaoEmpty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * A rung of the capability ladder: no sky. The scene is a gradient sky over a fading ground (flatsky.js), from the sun's height and the weather's cover, and the digits go over it
   * as always. No tables, no shaders of the sky: the cost is the flat pass and the final passes.
   */
  _renderFlat(rw, rh, sky, firstRender, perfNow) {
    const gl = this.gl, T = this.sceneTarget;
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo); gl.viewport(0, 0, T.w, T.h);
    this._drawFlat(this._camera(rw, rh), sky, 1);
    this._blit(true);
    this._mipsValid = this.glass.mode > 0 && this.glass.hasMask;
    this.dirty = false;
    if (firstRender) { this._rendered = true; performance.mark('sky:first-render-end'); }
    for (const fn of this.listeners) fn(this);
    this._presented('scene');
  }

  /** Scene -> canvas, with the glass clock. `scene` is true right after the scene was redrawn. */
  _blit(scene) {
    const gl = this.gl, T = this.sceneTarget, g = this.glass;
    if (!T) return;
    const cw = this.canvas.width, ch = this.canvas.height;
    const glassOn = g.mode > 0 && g.hasMask;
    gl.disable(gl.BLEND);
    gl.bindTexture(gl.TEXTURE_2D, T.tex);
    if (glassOn && !this.es2) {
      if (scene) gl.generateMipmap(gl.TEXTURE_2D);          // frosting blurs through the mip chain
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    if (glassOn && this.es2 && !(this.knobs && this.knobs.glass === false) && (scene || this._mipsStale || !(this.mipState && this.mipState.scene) || this.mipState.scene.src !== T)) { this._mipAtlas('scene', T.tex, T.w, T.h); this.mipState.scene.src = T; this._mipsStale = false; }
    const led = g.led.on;
    if (led) this._ensureComp(cw, ch);
    {                                                                  // snow and rain on the digits: from the weather being drawn
      const w = this.s.weather, on = this.s.digitWeather !== false && !this.s.reducedMotion && (!this.knobs || this.knobs.weather);
      const snowRate = (w.precip || 0) * (w.snowfall || 0), rainRate = (w.precip || 0) * (1 - (w.snowfall || 0));
      this.wx = { snow: on ? Math.min(1, snowRate * 1.4) : 0, rain: on ? Math.min(1, rainRate * 1.3) : 0 };       // (read by the tests)
    }
    // An ES 2 GPU gets the glass as small programs, each reading what the ones before made (a Pi Zero's driver could not fit the whole glass in one: it drew nothing): the height field and
    // slope (ggeo), the shadow and halo (gaura), for stained glass the tube's colours (gemit, ghalo), the body (gbody), snow and rain when there are any (gwx), the outline (gout).
    const solid = glassOn && this.knobs && this.knobs.glass === false;       // the capability ladder: solid digits, one cheap pass (no glass: no tables of the scene or the mask)
    const kind = !glassOn ? 'off' : solid || g.mode > 2.5 ? 'ink' : 'glass';
    const stained = g.mode > 1.5 && g.mode <= 2.5;
    const passes = this.es2 && kind === 'glass' ? ['ggeo', 'gaura', ...(stained ? ['gemit', 'ghalo'] : []), 'gbody', ...(this.wx.snow > 0.01 || this.wx.rain > 0.01 ? ['gwx'] : []), 'gout'] : [kind];
    if (passes.length > 1) { this._ensurePing(cw, ch); this._ensureGlassT(cw, ch); }
    const dpr = cw / Math.max(1, this.canvas.clientWidth);
    // The digits are a sixth of the picture: with a governor the glass passes (the expensive ones) run only over their rectangle (and a margin for the halo and the frosting), after one
    // cheap copy of the scene over everything. On a large display of a slow GPU that is the difference between seconds and a fraction of a second.
    let sc = null;
    const b = g.bounds;
    if (this.knobs && glassOn && !led && b && kind !== 'off' && !this.noScissor) {
      const m = Math.ceil(Math.max(12, g.stroke * dpr * 2.5));
      const x0 = Math.max(0, Math.floor(b[0] * cw) - m), x1 = Math.min(cw, Math.ceil(b[2] * cw) + m), y0 = Math.max(0, Math.floor(b[1] * ch) - m), y1 = Math.min(ch, Math.ceil(b[3] * ch) + m);
      if (x1 > x0 && y1 > y0 && (x1 - x0) * (y1 - y0) < 0.8 * cw * ch) {
        sc = [x0, ch - y1, x1 - x0, y1 - y0];
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, cw, ch);
        this._use(this._blitProgram('off'));
        this._blitUniforms(T, false, led, cw, ch, dpr, null, true);
        gl.bindVertexArray(this.vaoEmpty);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.enable(gl.SCISSOR_TEST); gl.scissor(sc[0], sc[1], sc[2], sc[3]);
      }
    }
    this.scissored = sc;                                                    // (for the tests and the profile)
    let prev = null, n = 0;
    for (const pass of passes) {
      const last = pass === passes[passes.length - 1];
      const own = passes.length > 1 && this.glassT[pass];                // a pass that makes an input of a later one
      const out = last ? (led ? this.compTarget : null) : own || this.pingT[n++ % 2];
      gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fbo : null);
      gl.viewport(0, 0, cw, ch);
      this._use(this._blitProgram(pass));
      this._blitUniforms(T, glassOn, led, cw, ch, dpr, prev, last);
      this._bindGlassInputs(pass);
      gl.bindVertexArray(this.vaoEmpty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!own) prev = out;
    }
    if (sc) gl.disable(gl.SCISSOR_TEST);
    if (led) this._ledPass(cw, ch);
  }

  _ensureGlassT(w, h) {
    const gl = this.gl;
    if (this.glassT && this.glassT.w === w && this.glassT.h === h) return;
    if (this.glassT) for (const k of ['ggeo', 'gaura', 'gemit', 'ghalo']) { gl.deleteTexture(this.glassT[k].tex); gl.deleteFramebuffer(this.glassT[k].fbo); }
    this.glassT = { w, h };
    for (const k of ['ggeo', 'gaura', 'gemit', 'ghalo']) this.glassT[k] = this._target(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
  }
  /** The body pass reads what the passes before it made (units 1 to 4: nothing else it reads is on them). */
  _bindGlassInputs(pass) {
    if (pass !== 'gbody' || !this.glassT) return;
    const G = this.glassT;
    this._1i('uGeo', 1); this._bind(1, G.ggeo.tex); this._1i('uAura', 2); this._bind(2, G.gaura.tex);
    this._1i('uEmit', 3); this._bind(3, G.gemit.tex); this._1i('uHalo', 4); this._bind(4, G.ghalo.tex);
  }

  /** The uniforms and textures of a final pass (the program is already in use); `prev` is the picture the pass before it made. */
  _blitUniforms(T, glassOn, led, cw, ch, dpr, prev, last, prevUnit = 7) {
    const g = this.glass;
    this._1i('uTex', 0); this._bind(0, T.tex);
    this._1f('uTexW', T.w);
    if (glassOn && this.es2) this._bindMipAtlas('scene', 5);
    this._1i('uMask', 1); this._bind(1, this.maskTex);
    if (glassOn && this.es2) this._bindMipAtlas('mask', 6);
    this._4f('uGlass', g.frost, glassOn ? g.mode : 0, g.stroke * dpr, 0);
    this._4f('uMaskRect', g.rect[0], g.rect[1], g.rect[2], g.rect[3]);
    this._2f('uMaskPx', g.maskW, g.maskH);
    this._2f('uRes', cw, ch);
    this._3f('uLight', g.light);
    this._3f('uLightCol', g.lightCol);
    this._4f('uGlow', g.glow, led ? Math.max(2, Math.floor(Math.min(cw / g.led.cols, ch / g.led.rows))) : 0, 0, 0);
    this._3f('uGlowCol', g.glowCol);
    this._3f('uInk', g.ink);
    this._1f('uContrast', g.contrast);
    this._4f('uWx', this.wx.snow, this.wx.rain, 0, (performance.now() / 1000) % 3600);
    this._1i('uDrops', 4); this._bind(4, this.dropsTex);
    this._1f('uDropsOn', g.dropsOn ? 1 : 0);
    this._1i('uFull', 3); this._bind(3, this.overlayFullTex);
    this._1f('uFullOn', last && led && g.overlayFull ? 1 : 0);
    this._1i('uPrev', prevUnit); if (prev) this._bind(prevUnit, prev.tex);
  }

  /**
   * ES 2: the mip levels 1..7 of a texture stacked in one texture (each with a border of its own edge texels), the way portable.js's mipAtlasGlsl reads them.
   * Each level is a bilinear read of the one above (the average of 2x2 texels), made in textures of their own and then copied into the stack. `kind` is 'mask' or
   * 'scene'; `src` is the texture's WebGL object, w x h its size.
   */
  _mipAtlas(kind, src, w, h, count = 7) {
    const gl = this.gl;
    const all = this.mipState || (this.mipState = {});
    let st = all[kind];
    if (!st || st.w !== w || st.h !== h) {
      if (st) { for (const l of st.levels) { gl.deleteTexture(l.tex); gl.deleteFramebuffer(l.fbo); } gl.deleteTexture(st.atlas.tex); gl.deleteFramebuffer(st.atlas.fbo); }
      const levels = []; let lw = w, lh = h, y = 0;
      for (let k = 1; k <= 7; k++) { lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1); const t = this._target(lw, lh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE); t.y = y; levels.push(t); y += lh + 2; }
      const atlas = this._target(levels[0].w + 2, y, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      st = all[kind] = { w, h, levels, atlas };
    }
    if (!this.pNoiseDown) this.pNoiseDown = this._program(VERT_FULLSCREEN, FRAG_NOISE_DOWN);
    if (!this.pAtlasPlace) this.pAtlasPlace = this._program(VERT_FULLSCREEN, FRAG_ATLAS_PLACE);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vaoEmpty);
    this._use(this.pNoiseDown);
    let from = src;
    const used = count < 7 ? st.levels.slice(0, count) : st.levels;               // (a level the shader cannot ask for is not built: each is two jobs for the GPU)
    for (const m of used) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, m.fbo); gl.viewport(0, 0, m.w, m.h);
      this._1i('uSrc', 0); this._bind(0, from); this._2f('uSize', m.w, m.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      from = m.tex;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.atlas.fbo);
    this._use(this.pAtlasPlace);
    this._1i('uSrc', 0); this._1f('uWrap', 0);
    for (const m of used) {
      gl.viewport(0, m.y, m.w + 2, m.h + 2);
      this._bind(0, m.tex); this._2f('uSize', m.w, m.h); this._1f('uY', m.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
  /** Sets the current program's uniforms for a texture's mip atlas, and binds the atlas at `unit`. */
  _bindMipAtlas(kind, unit) {
    const st = this.mipState && this.mipState[kind];
    if (!st) return;
    if (!st.names) {                                                    // (the uniforms' names, made once: a string put together per level and per pass was a good part of a frame on a slow machine)
      const N = kind[0].toUpperCase() + kind.slice(1);
      st.names = { mips: 'u' + N + 'Mips', px: 'u' + N + 'MipsPx', lv: st.levels.map((_, i) => 'u' + N + 'Lv' + (i + 1)) };
    }
    this._1i(st.names.mips, unit); this._bind(unit, st.atlas.tex);
    this._2f(st.names.px, st.atlas.w, st.atlas.h);
    for (let i = 0; i < st.levels.length; i++) { const m = st.levels[i]; this._4f(st.names.lv[i], m.w, m.h, m.y, 0); }
  }

  /**
   * How many of the glass mask's mip levels the final passes can read (the rest need not be built). The coarsest blur they ask for is the halo, 1.5 strokes wide, or the outline,
   * which is never thinner than one LED cell: in mask texels, its logarithm to base 2; a read takes that level and the next.
   */
  _maskLevels(w, rect, strokeCssPx) {
    const g = this.glass, cw = this.canvas.width, ch = this.canvas.height;
    const dpr = cw / Math.max(1, this.canvas.clientWidth);
    const cell = g.led.on ? Math.max(2, Math.floor(Math.min(cw / g.led.cols, ch / g.led.rows))) : 0;
    const maskScale = w / Math.max(1e-6, rect[2] * cw);                      // mask texels to a canvas pixel
    const px = Math.max(1.5 * strokeCssPx * dpr, cell, 1.6);
    return Math.max(1, Math.min(7, Math.ceil(Math.log2(Math.max(1, px * maskScale))) + 1));
  }

  _ensureComp(w, h) {
    const gl = this.gl;
    if (this.compTarget && this.compTarget.w === w && this.compTarget.h === h) return;
    if (this.compTarget) { gl.deleteTexture(this.compTarget.tex); gl.deleteFramebuffer(this.compTarget.fbo); }
    this.compTarget = this._target(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
  }

  _ensurePing(w, h) {
    const gl = this.gl;
    if (this.pingT && this.pingT[0].w === w && this.pingT[0].h === h) return;
    if (this.pingT) for (const t of this.pingT) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    this.pingT = [0, 1].map(() => this._target(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE));
  }

  _ensurePeak(w, h) {
    const gl = this.gl;
    if (this.peakTarget && this.peakTarget.w === w && this.peakTarget.h === h) return;
    if (this.peakTarget) { gl.deleteTexture(this.peakTarget.tex); gl.deleteFramebuffer(this.peakTarget.fbo); }
    this.peakTarget = this._target(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);       // one texel per LED: read back exactly
  }

  _ensureAvg(w, h) {
    const gl = this.gl;
    if (this.avgTarget && this.avgTarget.w === w && this.avgTarget.h === h) return;
    if (this.avgTarget) { gl.deleteTexture(this.avgTarget.tex); gl.deleteFramebuffer(this.avgTarget.fbo); }
    this.avgTarget = this._target(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
  }

  /** The finished picture -> a grid of square pixels with black lines between them (64x32, or 32x64 when upright). */
  _ledPass(cw, ch) {
    const gl = this.gl, L = this.glass.led, C = this.compTarget;
    gl.bindTexture(gl.TEXTURE_2D, C.tex);
    if (!this.es2) {                                            // (an ES 2 GPU reads single texels and adds them up itself)
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
    if (this.es2) {                                             // each LED's block averaged into a cols x rows picture
      this._ensureAvg(L.cols, L.rows);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.avgTarget.fbo);
      gl.viewport(0, 0, L.cols, L.rows);
      this._use(this.pLedAvg);
      this._1i('uComp', 0); this._bind(0, C.tex);
      this._2f('uRes', cw, ch);
      this._4f('uLed', L.cols, L.rows, 0, 0);
      gl.bindVertexArray(this.vaoEmpty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // stars: the brightest pixel of each LED's block, in a tiny cols x rows picture the LED shader then reads
    const g = this.glass;
    if (L.stars) {
      this._ensurePeak(L.cols, L.rows);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.peakTarget.fbo);
      gl.viewport(0, 0, L.cols, L.rows);
      this._use(this.pLedPeak);
      this._1i('uComp', 0); this._bind(0, C.tex);
      this._1i('uMask', 2); this._bind(2, this.maskTex);
      if (g.hasMask && g.mode > 0 && this.es2) this._bindMipAtlas('mask', 3);
      this._2f('uRes', cw, ch);
      this._4f('uLed', L.cols, L.rows, 0, 0);
      this._4f('uMaskRect', g.rect[0], g.rect[1], g.rect[2], g.rect[3]);
      this._2f('uMaskPx', g.maskW, g.maskH);
      this._1f('uMaskOn', g.hasMask && g.mode > 0 ? 1 : 0);
      gl.bindVertexArray(this.vaoEmpty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    this._use(this.pLed);
    this._1i('uComp', 0); this._bind(0, C.tex);
    if (this.es2) { this._1i('uAvg', 4); this._bind(4, this.avgTarget.tex); }
    this._1i('uPeak', 3); this._bind(3, L.stars ? this.peakTarget.tex : C.tex);
    this._1f('uStars', L.stars || 0);
    this._2f('uRes', cw, ch);
    this._4f('uLed', L.cols, L.rows, L.gap, L.brightness);       // the grid already turned to match the screen (ledpanel.js)
    this._1i('uOverlay', 1); this._bind(1, this.overlayTex);
    this._1f('uOverlayOn', this.glass.overlay ? 1 : 0);
    gl.bindVertexArray(this.vaoEmpty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** A picture covering the whole screen, drawn over the scene before the LED pixels are taken (the pills, on panels the tuned layout does not cover). */
  setOverlayFull(canvas) {
    const gl = this.gl;
    if (canvas) {
      gl.bindTexture(gl.TEXTURE_2D, this.overlayFullTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    }
    this.glass.overlayFull = !!canvas;
    this.redrawGlass();
  }

  /** Picture drawn over the scene before the LED pixels are taken (the countdown card); null removes it. */
  setOverlay(canvas) {
    const gl = this.gl;
    if (canvas) {
      gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);       // one texel per LED: no smoothing
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    this.glass.overlay = !!canvas;
    this.redrawGlass();
  }

  /** Clock glyph mask (alpha channel) covering rect = [x, y, w, h] in canvas uv, y down. */
  setGlassMask(canvas, rect, strokeCssPx) {
    this.markWork();
    const gl = this.gl, g = this.glass;
    this.maskTex = this.maskTexCanvas;                  // (setGlassGeometry draws into a texture of its own)
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.es2 ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.es2) this._mipAtlas('mask', this.maskTex, canvas.width, canvas.height, this._maskLevels(canvas.width, rect, strokeCssPx));
    else gl.generateMipmap(gl.TEXTURE_2D);
    g.rect = rect; g.maskW = canvas.width; g.maskH = canvas.height; g.stroke = strokeCssPx; g.hasMask = true;
    this.redrawGlass();
  }

  /**
   * The glass mask drawn on the GPU (glsl-mask.js) from the digits' geometry, instead of a 2D canvas stroked by the CPU and uploaded.
   * `strokes`: 6 vertices per segment, 7 floats each (x, y, ax, ay, bx, by, r); `lights`: 6 vertices per light, 8 floats each (x, y, cx, cy, radius, r, g, b);
   * all in mask pixels. `black` strokes (the coloured tube) are black, the glass styles white. Same arguments as setGlassMask otherwise.
   */
  setGlassGeometry({ w, h, rect, strokeCssPx, strokes, lights, black, bounds }) {
    this.markWork();
    this.glass.bounds = bounds || null;                                  // where the digits are (canvas uv, y down: x0, y0, x1, y1): the final passes can be limited to it
    const gl = this.gl, g = this.glass;
    if (!this.pStroke) {                                                    // compiled the first time it is needed (a slow machine need not wait for it at start-up)
      this.pStroke = this._program(VERT_STROKE, FRAG_STROKE, { aPos: 0, aSeg: 1, aR: 2 });
      this.pLight = this._program(VERT_LIGHT, FRAG_LIGHT, { aPos: 0, aLight: 1, aCol: 2 });
      this.maskBuf = gl.createBuffer();
      this.vaoStroke = gl.createVertexArray(); this.vaoLight = gl.createVertexArray();
    }
    if (!this.maskTarget || this.maskTarget.w !== w || this.maskTarget.h !== h) {
      if (this.maskTarget) { gl.deleteTexture(this.maskTarget.tex); gl.deleteFramebuffer(this.maskTarget.fbo); }
      this.maskTarget = this._target(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.es2 ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR, gl.CLAMP_TO_EDGE);
      this.maskTex = this.maskTarget.tex;
    }
    const T = this.maskTarget;
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.maskBuf);
    if (strokes.length) {                                                  // the strokes: the union (MAX) of every segment's capsule
      gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
      this._use(this.pStroke); this._2f('uSize', w, h); this._3f('uCol', black ? [0, 0, 0] : [1, 1, 1]);
      gl.bindVertexArray(this.vaoStroke);
      gl.bufferData(gl.ARRAY_BUFFER, strokes, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 8);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
      gl.drawArrays(gl.TRIANGLES, 0, strokes.length / 7);
    }
    if (lights && lights.length) {                                         // the tube's lights, only where the tube is (source-atop)
      gl.blendEquation(gl.FUNC_ADD); gl.blendFuncSeparate(gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      this._use(this.pLight); this._2f('uSize', w, h);
      gl.bindVertexArray(this.vaoLight);
      gl.bufferData(gl.ARRAY_BUFFER, lights, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 8);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 20);
      gl.drawArrays(gl.TRIANGLES, 0, lights.length / 8);
    }
    gl.bindVertexArray(null);
    gl.blendEquation(gl.FUNC_ADD); gl.disable(gl.BLEND);
    if (this.es2 && !(this.knobs && this.knobs.glass === false)) this._mipAtlas('mask', T.tex, w, h, this._maskLevels(w, rect, strokeCssPx));
    else { gl.bindTexture(gl.TEXTURE_2D, T.tex); gl.generateMipmap(gl.TEXTURE_2D); }
    g.rect = rect; g.maskW = w; g.maskH = h; g.stroke = strokeCssPx; g.hasMask = true;
    this.redrawGlass();
  }

  /**
   * The raindrops drawn on the GPU (glsl-mask.js) from dropGeometry()'s vertex lists, into a picture the size of the glass mask. Picked up by the next draw,
   * like setGlassDrops (which does the same from a canvas).
   */
  setGlassDropsGeometry({ w, h, drops, trails }) {
    this.markWork();
    const gl = this.gl;
    if (!this.pDrop) {
      this.pDrop = this._program(VERT_DROP, FRAG_DROP, { aPos: 0, aD: 1, aL: 2 });
      this.pTrail = this._program(VERT_TRAIL, FRAG_TRAIL, { aPos: 0, aSeg: 1, aW: 2 });
      this.dropBuf = gl.createBuffer(); this.vaoDrop = gl.createVertexArray(); this.vaoTrail = gl.createVertexArray();
    }
    if (!this.dropsTarget || this.dropsTarget.w !== w || this.dropsTarget.h !== h) {
      if (this.dropsTarget) { gl.deleteTexture(this.dropsTarget.tex); gl.deleteFramebuffer(this.dropsTarget.fbo); }
      this.dropsTarget = this._target(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, gl.CLAMP_TO_EDGE);
    }
    const T = this.dropsTarget;
    this.dropsTex = T.tex;
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);       // the channels add up where drops and trails overlap
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dropBuf);
    const run = (P, vao, data, f1, f2) => {
      if (!data.length) return;
      this._use(P); this._2f('uSize', w, h);
      gl.bindVertexArray(vao);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 8);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
      gl.drawArrays(gl.TRIANGLES, 0, data.length / 8);
    };
    run(this.pTrail, this.vaoTrail, trails);
    run(this.pDrop, this.vaoDrop, drops);
    gl.bindVertexArray(null); gl.disable(gl.BLEND);
    this.glass.dropsOn = true;
  }

  /** The raindrops (a canvas the size of the glass mask, drawn by drops.js). Picked up by the next draw; does not redraw by itself. */
  setGlassDrops(canvas) {
    const gl = this.gl;
    this.dropsTex = this.dropsTexCanvas;
    gl.bindTexture(gl.TEXTURE_2D, this.dropsTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    this.glass.dropsOn = true;
  }
  clearGlassDrops() { if (this.glass.dropsOn) { this.glass.dropsOn = false; this.redrawGlass(); } }

  /** Updates glass settings ({mode, frost, light, lightCol}) and redraws without re-rendering the sky. */
  setGlass(patch) {
    this.markWork();
    Object.assign(this.glass, patch);
    this.redrawGlass();
  }

  /**
   * A tiny picture of the sky as it looks now (no clock, no glass), as a canvas w x h. Saved by the page, it is what the
   * next launch shows behind the loading screen, so the sky is there the instant the page paints.
   */
  snapshot(w, h) {
    const gl = this.gl, T = this.sceneTarget;
    if (!T) return null;
    const px = new Uint8Array(w * h * 4);
    if (this.es2) {                                                    // no blit: read the whole picture and shrink it here (by averaging blocks)
      const full = new Uint8Array(T.w * T.h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
      gl.readPixels(0, 0, T.w, T.h, gl.RGBA, gl.UNSIGNED_BYTE, full);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (let y = 0; y < h; y++) {
        const y0 = Math.floor(y * T.h / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * T.h / h));
        for (let x = 0; x < w; x++) {
          const x0 = Math.floor(x * T.w / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * T.w / w));
          const acc = [0, 0, 0, 0]; let n = 0;
          for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const o = (yy * T.w + xx) * 4; acc[0] += full[o]; acc[1] += full[o + 1]; acc[2] += full[o + 2]; acc[3] += full[o + 3]; n++; }
          const o = (y * w + x) * 4; px[o] = acc[0] / n; px[o + 1] = acc[1] / n; px[o + 2] = acc[2] / n; px[o + 3] = acc[3] / n;
        }
      }
    } else {
      if (!this._snap || this._snap.w !== w || this._snap.h !== h) { if (this._snap) { gl.deleteTexture(this._snap.tex); gl.deleteFramebuffer(this._snap.fbo); } this._snap = this._target(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE); }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._snap.fbo);
      gl.blitFramebuffer(0, 0, T.w, T.h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._snap.fbo);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    const c = this._snapCanvas || (this._snapCanvas = document.createElement('canvas')); c.width = w; c.height = h;       // (used again: see updateFavicon)
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);   // GL rows run bottom to top
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
  }

  /** Where the scene and the finished picture are dark (for the Pi's timing log): two small maps (. dark, + middling, # bright) and what the final pass is doing. */
  maps() {
    const gl = this.gl, T = this.sceneTarget, g = this.glass;
    if (!T) return 'no scene yet';
    const grid = (px, w, h) => { const out = []; for (let r = 0; r < 12; r++) { let line = ''; for (let c = 0; c < 32; c++) { const x = Math.min(w - 1, Math.floor((c + 0.5) * w / 32)), y = Math.min(h - 1, Math.floor((11.5 - r) * h / 12)), i = (y * w + x) * 4, v = px[i] + px[i + 1] + px[i + 2]; line += v < 12 ? '.' : v < 200 ? '+' : '#'; } out.push(line); } return out.join('\n'); };
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo); const a = new Uint8Array(T.w * T.h * 4); gl.readPixels(0, 0, T.w, T.h, gl.RGBA, gl.UNSIGNED_BYTE, a);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); const cw = this.canvas.width, ch = this.canvas.height, b = new Uint8Array(cw * ch * 4); gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, b);
    let mk = 'no mask texture';
    const M = this.maskTarget;
    if (M) { gl.bindFramebuffer(gl.FRAMEBUFFER, M.fbo); const m = new Uint8Array(M.w * M.h * 4); gl.readPixels(0, 0, M.w, M.h, gl.RGBA, gl.UNSIGNED_BYTE, m); gl.bindFramebuffer(gl.FRAMEBUFFER, null); let lit = 0; for (let i = 3; i < m.length; i += 4) if (m[i] > 40) lit++; mk = 'mask ' + M.w + 'x' + M.h + ': ' + lit + ' px covered (' + (100 * lit / (M.w * M.h)).toFixed(1) + '%), rect ' + g.rect.map((v) => v.toFixed(2)).join(','); }
    let probe = '';
    const err0 = gl.getError();
    try {                                                              // two experiments on the screen: is every pixel of it paintable, and does a plain copy of the scene fill it?
      gl.disable(gl.BLEND); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, cw, ch);
      gl.clearColor(1, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      const c = new Uint8Array(cw * ch * 4); gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, c);
      let lit = 0, xs = 0, ys = 0; for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const i = (y * cw + x) * 4; if (c[i] > 200 && c[i + 2] > 200) { lit++; if (x + 1 > xs) xs = x + 1; if (y + 1 > ys) ys = y + 1; } }
      probe = '\nclear test: ' + lit + ' of ' + cw * ch + ' px painted (reaches ' + xs + ' x ' + ys + ')';
      gl.bindTexture(gl.TEXTURE_2D, T.tex);
      this._use(this._blitProgram('off')); this._1i('uTex', 0); this._bind(0, T.tex); this._1f('uTexW', T.w); this._1f('uFullOn', 0);
      gl.bindVertexArray(this.vaoEmpty); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const d = new Uint8Array(cw * ch * 4); gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, d);
      if (this.es2 && g.mode > 0 && g.hasMask && this.pingT) {
        const dpr = cw / Math.max(1, this.canvas.clientWidth), led = g.led.on;
        const draw = (k, fbo, prev, unit) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, cw, ch); gl.clearColor(1, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); this._use(this._blitProgram(k)); this._blitUniforms(T, true, led, cw, ch, dpr, prev, true, unit); this._bindGlassInputs(k); gl.bindVertexArray(this.vaoEmpty); gl.drawArrays(gl.TRIANGLES, 0, 3); };
        const shot = () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); const e = new Uint8Array(cw * ch * 4); gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, e); let un = 0; for (let i = 0; i < e.length; i += 4) if (e[i] === 255 && e[i + 1] === 0 && e[i + 2] === 255) un++; return grid(e, cw, ch) + '\n(' + un + ' of ' + cw * ch + ' px were never drawn on)'; };
        this._ensureGlassT(cw, ch);
        for (const k of ['ggeo', 'gaura', 'gbody']) { draw(k, null, this.pingT[0], 7); probe += '\nexperiment the pass ' + k + ' straight to the screen:\n' + shot(); }
      }
      probe += '\nplain copy of the scene on the screen:\n' + grid(d, cw, ch) + '\nGL error before the probe ' + err0 + ', after ' + gl.getError();
    } catch (e) { probe += '\nprobe failed: ' + e; }
    return mk + '\nfinal pass: ' + (!(g.mode > 0 && g.hasMask) ? 'off (no glass: mode ' + g.mode + ', mask ' + g.hasMask + ')' : g.mode > 2.5 ? 'ink' : 'glass') + '; scene ' + T.w + 'x' + T.h + ' (top row first):\n' + grid(a, T.w, T.h) + '\nscreen ' + cw + 'x' + ch + ':\n' + grid(b, cw, ch) + probe;
  }

  /** One line about what the GPU made so far (for the Pi's timing log, to tell a black screen from a dark sky): the scene's average colour, the exposure and, on ES 2, the packed tables decoded. */
  diagnose() {
    const gl = this.gl, T = this.sceneTarget;
    if (!T) return 'no scene yet';
    const rd = (t) => { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); const px = new Uint8Array(t.w * t.h * 4); gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return px; };
    const mean = (px) => { const m = [0, 0, 0, 0]; for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 4; c++) m[c] += px[i + c]; return m.map((v) => Math.round(v / (px.length / 4))).join(','); };
    const hdr = (px, i) => { const R = px[i], G = px[i + 1], B = px[i + 2], A = px[i + 3], Bh = Math.floor(B / 16), Gh = Math.floor(G / 4); const L = A * 16 + Bh, P = (B - Bh * 16) * 64 + Gh, Q = (G - Gh * 4) * 256 + R; const sum = 2 ** (-30 + 36 * L / 4095), p = P / 1023, q = Q / 1023; return [sum * p, sum * Math.max(1 - p - q, 0), sum * q].map((v) => v.toPrecision(3)).join(' '); };
    let o = 'scene ' + T.w + 'x' + T.h + ' average rgba ' + mean(rd(T)) + ', sun at ' + (this.sky ? this.sky.sun.alt.toFixed(1) : '?') + ' deg';
    const ad = this.tAdapt[this.adaptIdx];
    if (this.es2) {
      const a = rd(ad); o += ', exposure log ' + ((a[0] * 65536 + a[1] * 256 + a[2]) / 16777215 * 64 - 32).toFixed(2);
      const cs = rd(this.tConsts), big = (t) => t.split(' ').map((v) => (+v * 16384).toPrecision(3)).join(' '); o += ', light (cd/m2) zenith ' + big(hdr(cs, 0)) + ' | ambient ' + big(hdr(cs, 4)) + ' | sun ' + big(hdr(cs, 8)) + ' | moon ' + big(hdr(cs, 12)) + ' | haze north ' + big(hdr(cs, (CONSTS_N + HAZE_N / 2) * 4));
      const sk = rd(this.tSkySun), tr = rd(this.tTrans);
      { const ms = rd(this.tMS), T2 = this.tTrans; o += ', MS centre ' + hdr(ms, ((this.tMS.h >> 1) * this.tMS.w + (this.tMS.w >> 1)) * 4) + ', trans row 0 ' + hdr(tr, (T2.w >> 1) * 4) + ', trans row 1/8 ' + hdr(tr, ((T2.h >> 3) * T2.w + (T2.w >> 1)) * 4) + ', trans col 3/4 mid ' + hdr(tr, ((T2.h >> 1) * T2.w + (3 * T2.w >> 2)) * 4); }
      o += ', sky table row 1/4 ' + hdr(sk, ((this.tSkySun.h >> 2) * this.tSkySun.w + (this.tSkySun.w >> 1)) * 4) + ', sky table centre ' + hdr(sk, ((this.tSkySun.h >> 1) * this.tSkySun.w + (this.tSkySun.w >> 1)) * 4) + ', transmittance centre ' + hdr(tr, ((this.tTrans.h >> 1) * this.tTrans.w + (this.tTrans.w >> 1)) * 4);
    } else {
      const rf = (t) => { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); const px = new Float32Array(t.w * t.h * 4); gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return px; };
      const a = rf(ad), cs = rf(this.tConsts), f = (px, i) => [px[i], px[i + 1], px[i + 2]].map((v) => v.toPrecision(3)).join(' ');
      const sk = rf(this.tSkySun), tr = rf(this.tTrans); o += ', sky table centre ' + f(sk, ((this.tSkySun.h >> 1) * this.tSkySun.w + (this.tSkySun.w >> 1)) * 4) + ', sky table row 1/4 ' + f(sk, ((this.tSkySun.h >> 2) * this.tSkySun.w + (this.tSkySun.w >> 1)) * 4) + ', transmittance centre ' + f(tr, ((this.tTrans.h >> 1) * this.tTrans.w + (this.tTrans.w >> 1)) * 4) + ', MS centre ' + f(rf(this.tMS), ((this.tMS.h >> 1) * this.tMS.w + (this.tMS.w >> 1)) * 4) + ', trans row 0 ' + f(tr, (this.tTrans.w >> 1) * 4) + ', trans row 1/8 ' + f(tr, ((this.tTrans.h >> 3) * this.tTrans.w + (this.tTrans.w >> 1)) * 4) + ', trans col 3/4 mid ' + f(tr, ((this.tTrans.h >> 1) * this.tTrans.w + (3 * this.tTrans.w >> 2)) * 4);
      o += ', exposure log ' + a[0].toFixed(2) + ', light (cd/m2) zenith ' + f(cs, 0) + ' | ambient ' + f(cs, 4) + ' | sun ' + f(cs, 8) + ' | moon ' + f(cs, 12);
    }
    return o;
  }

  /** Cheap repaint: only the final pass, reusing the last scene. */
  redrawGlass() {
    this.markWork();
    if (!this.sceneTarget) { this.dirty = true; return; }
    this._blit(!this._mipsValid && this.glass.mode > 0);
    if (this.glass.mode > 0) this._mipsValid = true;
    this._presented('glass');
  }

  _bindSkyUniforms(sky, sunAz, sunAlt, sunLux, moonAz, moonAlt, moonLux, natural, lp, camH) {
    this._1i('uTrans', 0); this._bind(0, this.tTrans.tex);
    this._1i('uSkySun', 2); this._bind(2, this.tSkySun.tex);
    this._1i('uSkyMoon', 3); this._bind(3, this.tSkyMoon.tex);
    this._2f('uTransPx', this.tTrans.w, this.tTrans.h); this._2f('uSkyPx', this.tSkySun.w, this.tSkySun.h);
    this._4f('uSunA', Math.sin(sunAz), Math.cos(sunAz), sunAlt, sunLux);
    this._4f('uMoonA', Math.sin(moonAz), Math.cos(moonAz), moonAlt, moonLux);
    this._3f('uNightLum', natural);
    this._3f('uLPLum', lp);
    this._1f('uCamH', camH);
  }

  /** @param {Float32Array} data 6 floats per plant; palette from biome.paletteFor */
  setPlants({ data, count, palette, on }) {
    const gl = this.gl, p = this.s.plants;
    if (data) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.plantBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.es2 ? this._expand(data, count) : data, gl.STATIC_DRAW);
      p.count = count;
    }
    if (palette) p.palette = palette;
    if (on !== undefined) p.on = on;
    this.dirty = true;
  }

  /** Christmas tree standing `dist` m away towards compass bearing `az` degrees, `h` m tall; floats on the sea when the landscape is ocean. */
  setTree({ on, az, dist, h }) {
    const gl = this.gl, t = this.s.tree;
    if (on !== undefined) t.on = on;
    if (az != null) t.az = az;
    if (dist != null) t.dist = dist;
    if (h != null) t.h = h;
    const x = Math.sin(t.az * DEG) * t.dist, z = Math.cos(t.az * DEG) * t.dist;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.treeBuf);
    const tree = new Float32Array([x, z, t.h, 10, 0.37, 0.5, x, z, t.h, 11, 0.37, 0.5]);
    gl.bufferData(gl.ARRAY_BUFFER, this.es2 ? this._expand(tree, 2) : tree, gl.STATIC_DRAW);
    this.dirty = true;
  }

  _drawPlants(sky, sunAz, sunAlt, sunLux, moonAz, moonAlt, moonLux, natural, lp, camH, cam, perfNow, w, eyeKm) {
    const gl = this.gl, s = this.s, p = s.plants;
    const K = this.knobs, plantsOn = (!K || K.landscape) && p.on && p.count && p.palette && !s.landscape.ocean, treeOn = (!K || K.landscape) && s.tree.on;
    if (!plantsOn && !treeOn) return;
    const pal = p.palette || { leaf: [0.06, 0.14, 0.04], conifer: [0.03, 0.09, 0.05], grass: [0.1, 0.2, 0.06], dry: [0.3, 0.26, 0.12], rock: [0.28, 0.26, 0.24], snow: 0 };
    gl.enable(gl.BLEND);
    // colour: normal alpha blend; alpha channel: dst *= (1 - src) so stars are hidden behind plants
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    this._use(this.pPlants);
    this._1f('uMie', s.mie);
    this._bindSkyUniforms(sky, sunAz, sunAlt, sunLux, moonAz, moonAlt, moonLux, natural, lp, camH);
    this._1i('uAdapt', 8);
    this._1i('uConsts', 10); this._bind(10, this.tConsts.tex);
    this._m3('uCam', cam.mat);
    this._2f('uTan', cam.tan[0], cam.tan[1]);
    this._3f('uSunDir', sky.sun.dir);
    this._1f('uEyeM', s.eyeM);
    this._1f('uTime', (perfNow / 1000) % 100000 * (s.cloudMotion === 0 ? 0 : s.cloudMotion));
    this._2f('uWind', w.wind[0], w.wind[1]);
    this._1f('uKey', 0.36);
    this._1f('uBoost', Math.max(0.2, s.nightBoost));
    this._1f('uWet', Math.min(1, w.precip * (1 - w.snowfall)));
    this._1f('uFogDens', w.fog * 0.025 + 1 / (Math.max(w.visKm, 0.3) * 1000));
    this._3f('uLeaf', pal.leaf); this._3f('uConifer', pal.conifer); this._3f('uGrass', pal.grass);
    this._3f('uDry', pal.dry); this._3f('uRock', pal.rock);
    this._1f('uSnowCover', Math.max(pal.snow || 0, w.snowCover));
    this._1f('uOcean', s.landscape.ocean ? 1 : 0);
    this._2f('uResPx', this.sceneTarget.w, this.sceneTarget.h);
    if (plantsOn) {
      gl.bindVertexArray(this.vaoPlants);
      this._drawSprites(p.count);
    }
    if (treeOn) {                                   // the tree last, it is nearer than most plants; on the sea its reflection goes with it
      gl.bindVertexArray(this.vaoTree);
      this._drawSprites(s.landscape.ocean ? 2 : 1);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  _drawStars(sky, sunAz, sunAlt, sunLux, moonAz, moonAlt, moonLux, natural, lp, camH, cam, T, perfNow, w) {
    const gl = this.gl;
    if (sky.sun.alt > 4) return;                  // the sun drowns every star: skip the work
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.DST_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
    this._use(this.pStars);
    this._1f('uMie', this.s.mie);
    this._bindSkyUniforms(sky, sunAz, sunAlt, sunLux, moonAz, moonAlt, moonLux, natural, lp, camH);
    this._m3('uEqj', sky.eqj);
    this._m3('uCam', cam.mat);
    this._2f('uTan', cam.tan[0], cam.tan[1]);
    this._1f('uPx', T.h / 1080);
    this._1f('uTime', perfNow / 1000 % 3600);
    this._1f('uTwinkle', this.s.twinkle && !this.s.reducedMotion ? 1 : 0);
    // A star sprite is never smaller than a pixel and keeps its brightness, so on the tiny scene of a Pi at its lowest quality level (11 x 6 pixels) every visible star was a pixel-sized
    // spot and together they made a white haze at night. With the governor on, the brightness follows the sprite's share of the picture (the same total light), for scenes under 135 pixels high.
    this._1f('uStarGain', this.gov ? Math.min(1, (T.h / 135) ** 2) : 1.0);
    this._1f('uExtraK', Math.max(0, (w.aod - 0.12) * 1.1));
    this._1f('uWorld', 0);
    gl.bindVertexArray(this.vaoStars);
    gl.drawArrays(gl.POINTS, 0, Math.max(1, Math.floor(this.starCount * (this.starFrac == null ? 1 : this.starFrac))));      // (the file is brightest first: fewer stars are the brightest ones)

    if (sky.planets.length) {
      const data = new Float32Array(sky.planets.length * 5);
      sky.planets.forEach((p, i) => { data.set([p.dir[0], p.dir[1], p.dir[2], p.mag, p.bv], i * 5); });
      gl.bindBuffer(gl.ARRAY_BUFFER, this.planetBuf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      this._1f('uWorld', 1);
      gl.bindVertexArray(this.vaoPlanets);
      gl.drawArrays(gl.POINTS, 0, sky.planets.length);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  // ------------------------------------------------ adaptive resolution ----
  _autoScale(perfNow) {
    const s = this.s, p = this.perf;
    if (s.quality !== 'auto' || this.gov) return;           // (the governor, when there is one, owns the scale)
    if (p.last) {
      const dt = perfNow - p.last;
      const target = this.fast ? 1000 / 58 : this.interval() || 16.7;
      // only judge frames rendered back to back (not idle gaps)
      if (dt < target * 3) { p.acc += dt / target; p.n++; }
      if (p.n >= 20) {
        const ratio = p.acc / p.n;
        if (ratio > 1.45 && s.scale > 0.4) s.scale = Math.max(0.4, s.scale * 0.85);
        else if (ratio < 1.12 && s.scale < 1.0) s.scale = Math.min(1.0, s.scale * 1.06);
        p.acc = 0; p.n = 0;
      }
    }
    p.last = perfNow;
  }

  // ------------------------------------------------------- UI helpers ------
  /**
   * Reads a few scene pixels without stalling the GPU: the copy goes into a pixel-pack
   * buffer and is collected once a fence says it is done. Points are normalised (x, y), y up.
   * @returns {Promise<{r:number,g:number,b:number,lum:number}[]|null>}
   */
  samplePixels(points) {
    const gl = this.gl, T = this.sceneTarget;
    if (!T) return Promise.resolve(null);
    const n = points.length, buf = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, n * 4, gl.STREAM_READ);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
    points.forEach(([x, y], i) => {
      gl.readPixels(Math.min(T.w - 1, Math.floor(x * T.w)), Math.min(T.h - 1, Math.floor(y * T.h)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, i * 4);
    });
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    return new Promise((resolve) => {
      const poll = () => {
        const st = gl.clientWaitSync(sync, 0, 0);
        if (st === gl.TIMEOUT_EXPIRED) { setTimeout(poll, 40); return; }
        gl.deleteSync(sync);
        const out = new Uint8Array(n * 4);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.deleteBuffer(buf);
        resolve(points.map((_, i) => {
          const r = out[i * 4] / 255, g = out[i * 4 + 1] / 255, b = out[i * 4 + 2] / 255;
          return { r, g, b, lum: 0.2126 * r + 0.7152 * g + 0.0722 * b };
        }));
      };
      poll();
    });
  }

  get info() {
    const sky = this.sky;
    return sky && {
      sunAlt: sky.sun.alt, sunAz: sky.sun.az, moonAlt: sky.moon.alt, moonAz: sky.moon.az,
      moonFraction: sky.moon.fraction, scale: this.s.scale,
    };
  }
}

export { LANDSCAPES };
