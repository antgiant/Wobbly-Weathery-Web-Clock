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

import { Governor } from './governor.js';
import { VERT_STROKE, FRAG_STROKE, VERT_LIGHT, FRAG_LIGHT, VERT_DROP, FRAG_DROP, VERT_TRAIL, FRAG_TRAIL } from './glsl-mask.js';
import {
  VERT_FULLSCREEN, FRAG_TRANSMITTANCE, FRAG_MULTISCATTER, FRAG_SKYVIEW,
} from './glsl-atmosphere.js';
import {
  FRAG_NOISE, FRAG_NOISE_DOWN, FRAG_ATLAS_PLACE, FRAG_ADAPT, VERT_STARS, FRAG_STARS, fragBlit, FRAG_LED, FRAG_LED_PEAK, FRAG_LED_AVG, FRAG_SCENE_SKY, FRAG_SCENE_TERRAIN, FRAG_CONSTS, CONSTS_N, HAZE_N,
} from './glsl-scene.js';
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
    this.gov = governor ? new Governor(typeof governor === 'object' ? governor : {}) : null;
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
      quality: 'auto', scale: 0.75, maxDpr: 2,
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
    if (!(name in P.locs)) P.locs[name] = this.gl.getUniformLocation(P.prog, name);
    return P.locs[name];
  }
  /** The final pass in its form for what is on the screen: 'off' (no clock glass), 'ink' (the LED panel's flat ink) or 'glass'; each made the first time it is needed. */
  _blitProgram(kind) { return this.pBlits[kind] || (this.pBlits[kind] = this._program(VERT_FULLSCREEN, fragBlit(kind))); }
  _use(P) { this._ready(P); this.gl.useProgram(P.prog); this._cur = P; }
  // Uniform setters. A program keeps its uniforms between draws, so a value that has not changed is not sent again: most of the hundreds of values set for a
  // frame are the same as the last frame's, and on a slow machine each call across to the driver costs. (`vals` holds what each program was last given.)
  _same(n, a) {
    const P = this._cur, c = P.vals || (P.vals = {}), o = c[n];
    if (o !== undefined) { let eq = o.length === a.length; for (let i = 0; eq && i < a.length; i++) if (o[i] !== a[i]) eq = false; if (eq) return true; }
    c[n] = a; return false;
  }
  _1f(n, v) { if (!this._same(n, [v])) this.gl.uniform1f(this._u(this._cur, n), v); }
  _1i(n, v) { if (!this._same(n, [v])) this.gl.uniform1i(this._u(this._cur, n), v); }
  _2f(n, a, b) { if (!this._same(n, [a, b])) this.gl.uniform2f(this._u(this._cur, n), a, b); }
  _3f(n, v) { if (!this._same(n, [v[0], v[1], v[2]])) this.gl.uniform3f(this._u(this._cur, n), v[0], v[1], v[2]); }
  _4f(n, a, b, c, d) { if (!this._same(n, [a, b, c, d])) this.gl.uniform4f(this._u(this._cur, n), a, b, c, d); }
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
    this.pSceneTerrain = this._program(VERT_FULLSCREEN, FRAG_SCENE_TERRAIN);
    this.pBlits = {};                                            // the final pass in the form that is needed (_blitProgram)
    performance.mark('sky:programs-compiled');
    this.pLed = this._program(VERT_FULLSCREEN, FRAG_LED);
    this.pLedPeak = this._program(VERT_FULLSCREEN, FRAG_LED_PEAK);
    this.pLedAvg = this.es2 ? this._program(VERT_FULLSCREEN, FRAG_LED_AVG) : null;
    this.pStars = this._program(VERT_STARS, FRAG_STARS, { aStar: 0, aBV: 1 });
    this.pPlants = this._program(VERT_PLANTS, FRAG_PLANTS, { aInst: 0, aSeed: 1 });

    // the tables: half floats, or (OpenGL ES 2) 8-bit textures with the colour packed in (portable.js), read texel by texel, so never filtered by the hardware
    const es2 = this.es2, F = es2 ? gl.RGBA8 : gl.RGBA16F, RGBA = gl.RGBA, HF = es2 ? gl.UNSIGNED_BYTE : gl.HALF_FLOAT, LF = es2 ? gl.NEAREST : gl.LINEAR;
    const ls = this.lutScale, sc = (v, min) => Math.max(min, Math.round(v * ls));
    this.tTrans = this._target(sc(TRANS_W, 64), sc(TRANS_H, 16), F, RGBA, HF, LF);
    this.tMS = this._target(sc(MS_SIZE, 8), sc(MS_SIZE, 8), F, RGBA, HF, LF);
    this.tSkySun = this._target(sc(SKY_W, 64), sc(SKY_H, 48), F, RGBA, HF, LF);
    this.tSkyMoon = this._target(sc(SKY_W, 64), sc(SKY_H, 48), F, RGBA, HF, LF);
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
    if ('quality' in patch) this._resetScale();
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
    if (g.report(kind === 'scene' ? costMs * 0.25 : costMs, performance.now())) this.applyKnobs();
    if (this.onTick) this.onTick(g.tickMs);
  }
  /** Puts the governor's current level into effect. */
  applyKnobs() {
    const g = this.gov; if (!g) return;
    const k = g.knobs;
    this.s.scale = k.scale;
    this.s.outScale = this.glass.led.on ? 1 : k.outScale;          // an LED panel needs its cells at the size they are read back
    this.starFrac = k.stars;
    this.knobs = k;
    this.dirty = true;
  }
  onFrame(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /** Called after anything changed what is on the canvas: a full render, or only the glass pass (a digit moved). A host that has to copy frames somewhere (the Pi) listens to this. */
  onPresent(fn) { this.presenters.add(fn); return () => this.presenters.delete(fn); }
  _presented(kind) { for (const fn of this.presenters) fn(this, kind); }

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

  _animated() {
    const s = this.s, w = s.weather;
    if (s.reducedMotion) return false;
    const clouds = s.cloudMotion > 0 && (w.cover[0] > 0.02 || w.cover[1] > 0.02 || w.cover[2] > 0.02);
    const water = s.landscape.ocean;
    const rain = w.precip > 0.01;
    const night = this.sky && this.sky.sun.alt < -6 && s.twinkle;
    const wind = s.plants.on && s.plants.count > 0 && s.cloudMotion > 0;      // plants sway
    const lights = this.s.tree.on;                    // the tree's bulbs twinkle
    return clouds || water || rain || night || wind || lights;
  }

  interval() {
    const sim = getSim();
    if (this.fast || (sim && sim.scale > 1)) return 0;
    if (this.gov) { const k = this.gov.knobs; return this._animated() ? Math.max(1000 / this.s.fps, k.skyMs * 0.25) : k.skyMs; }     // the governor decides how often the sky is redrawn
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

  _schedule() {
    if (!this._running || this._raf || this._to || document.hidden) return;   // hidden: visibilitychange wakes us
    let wait = this._dirty || this._fast ? 0 : Math.max(0, this.interval() - (performance.now() - this.lastRender));
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
    const gl = this.gl, s = this.s;
    const firstRender = !this._rendered;
    if (firstRender) performance.mark('sky:first-render-start');
    const perfNow = performance.now();

    // canvas / scene size
    const dpr = Math.min(window.devicePixelRatio || 1, s.maxDpr);
    const out = this.glass.led.on || this.s.outScale == null ? 1 : this.s.outScale;       // the output's own size, below 1 when the governor saves work (the screen enlarges it)
    const cw = Math.max(2, Math.floor(this.canvas.clientWidth * dpr * out));
    const ch = Math.max(2, Math.floor(this.canvas.clientHeight * dpr * out));
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    const rw = Math.max(2, Math.round(cw * s.scale)), rh = Math.max(2, Math.round(ch * s.scale));
    this._ensureScene(rw, rh);

    const jumped = this._updateAstro(perfNow, this.dirty && this.lastAstro < 0);
    const sky = this.sky;
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
    this._1f('uPrecip', w.precip);
    this._1f('uSnow', w.snowfall);
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
    };
    gl.disable(gl.BLEND);
    this._use(this.pSceneSky); setScene();                    // every pixel that is not wholly terrain
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND);                                      // the ground, over it by coverage; the fourth channel (the stars' sky-visibility) shrinks by the same share
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    this._use(this.pSceneTerrain); setScene();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
    if (glassOn && this.es2 && (scene || !(this.mipState && this.mipState.scene) || this.mipState.scene.src !== T)) { this._mipAtlas('scene', T.tex, T.w, T.h); this.mipState.scene.src = T; }
    const led = g.led.on;
    if (led) this._ensureComp(cw, ch);
    gl.bindFramebuffer(gl.FRAMEBUFFER, led ? this.compTarget.fbo : null);
    gl.viewport(0, 0, cw, ch);
    this._use(this._blitProgram(!glassOn ? 'off' : g.mode > 2.5 ? 'ink' : 'glass'));
    this._1i('uTex', 0); this._bind(0, T.tex);
    this._1f('uTexW', T.w);
    if (glassOn && this.es2) this._bindMipAtlas('scene', 5);
    this._1i('uMask', 1); this._bind(1, this.maskTex);
    if (glassOn && this.es2) this._bindMipAtlas('mask', 6);
    const dpr = cw / Math.max(1, this.canvas.clientWidth);
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
    {                                                                  // snow and rain on the digits: from the weather being drawn
      const w = this.s.weather, on = this.s.digitWeather !== false && !this.s.reducedMotion;
      const snowRate = (w.precip || 0) * (w.snowfall || 0), rainRate = (w.precip || 0) * (1 - (w.snowfall || 0));
      this.wx = { snow: on ? Math.min(1, snowRate * 1.4) : 0, rain: on ? Math.min(1, rainRate * 1.3) : 0 };       // (read by the tests)
      this._4f('uWx', this.wx.snow, this.wx.rain, 0, (performance.now() / 1000) % 3600);
    }
    this._1i('uDrops', 4); this._bind(4, this.dropsTex);
    this._1f('uDropsOn', g.dropsOn ? 1 : 0);
    this._1i('uFull', 3); this._bind(3, this.overlayFullTex);
    this._1f('uFullOn', led && g.overlayFull ? 1 : 0);
    gl.bindVertexArray(this.vaoEmpty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (led) this._ledPass(cw, ch);
  }

  /**
   * ES 2: the mip levels 1..7 of a texture stacked in one texture (each with a border of its own edge texels), the way portable.js's mipAtlasGlsl reads them.
   * Each level is a bilinear read of the one above (the average of 2x2 texels), made in textures of their own and then copied into the stack. `kind` is 'mask' or
   * 'scene'; `src` is the texture's WebGL object, w x h its size.
   */
  _mipAtlas(kind, src, w, h) {
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
    for (const m of st.levels) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, m.fbo); gl.viewport(0, 0, m.w, m.h);
      this._1i('uSrc', 0); this._bind(0, from); this._2f('uSize', m.w, m.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      from = m.tex;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.atlas.fbo);
    this._use(this.pAtlasPlace);
    this._1i('uSrc', 0); this._1f('uWrap', 0);
    for (const m of st.levels) {
      gl.viewport(0, m.y, m.w + 2, m.h + 2);
      this._bind(0, m.tex); this._2f('uSize', m.w, m.h); this._1f('uY', m.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
  /** Sets the current program's uniforms for a texture's mip atlas, and binds the atlas at `unit`. */
  _bindMipAtlas(kind, unit) {
    const st = this.mipState && this.mipState[kind];
    if (!st) return;
    const N = kind[0].toUpperCase() + kind.slice(1);
    this._1i('u' + N + 'Mips', unit); this._bind(unit, st.atlas.tex);
    this._2f('u' + N + 'MipsPx', st.atlas.w, st.atlas.h);
    st.levels.forEach((m, i) => this._4f('u' + N + 'Lv' + (i + 1), m.w, m.h, m.y, 0));
  }

  _ensureComp(w, h) {
    const gl = this.gl;
    if (this.compTarget && this.compTarget.w === w && this.compTarget.h === h) return;
    if (this.compTarget) { gl.deleteTexture(this.compTarget.tex); gl.deleteFramebuffer(this.compTarget.fbo); }
    this.compTarget = this._target(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
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
    const gl = this.gl, g = this.glass;
    this.maskTex = this.maskTexCanvas;                  // (setGlassGeometry draws into a texture of its own)
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.es2 ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.es2) this._mipAtlas('mask', this.maskTex, canvas.width, canvas.height);
    else gl.generateMipmap(gl.TEXTURE_2D);
    g.rect = rect; g.maskW = canvas.width; g.maskH = canvas.height; g.stroke = strokeCssPx; g.hasMask = true;
    this.redrawGlass();
  }

  /**
   * The glass mask drawn on the GPU (glsl-mask.js) from the digits' geometry, instead of a 2D canvas stroked by the CPU and uploaded.
   * `strokes`: 6 vertices per segment, 7 floats each (x, y, ax, ay, bx, by, r); `lights`: 6 vertices per light, 8 floats each (x, y, cx, cy, radius, r, g, b);
   * all in mask pixels. `black` strokes (the coloured tube) are black, the glass styles white. Same arguments as setGlassMask otherwise.
   */
  setGlassGeometry({ w, h, rect, strokeCssPx, strokes, lights, black }) {
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
    if (this.es2) this._mipAtlas('mask', T.tex, w, h);
    else { gl.bindTexture(gl.TEXTURE_2D, T.tex); gl.generateMipmap(gl.TEXTURE_2D); }
    g.rect = rect; g.maskW = w; g.maskH = h; g.stroke = strokeCssPx; g.hasMask = true;
    this.redrawGlass();
  }

  /**
   * The raindrops drawn on the GPU (glsl-mask.js) from dropGeometry()'s vertex lists, into a picture the size of the glass mask. Picked up by the next draw,
   * like setGlassDrops (which does the same from a canvas).
   */
  setGlassDropsGeometry({ w, h, drops, trails }) {
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
      if (!this._snap || this._snap.w !== w || this._snap.h !== h) this._snap = this._target(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._snap.fbo);
      gl.blitFramebuffer(0, 0, T.w, T.h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._snap.fbo);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);   // GL rows run bottom to top
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
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
      o += ', sky table centre ' + hdr(sk, ((this.tSkySun.h >> 1) * this.tSkySun.w + (this.tSkySun.w >> 1)) * 4) + ', transmittance centre ' + hdr(tr, ((this.tTrans.h >> 1) * this.tTrans.w + (this.tTrans.w >> 1)) * 4);
    } else { const a = rd(ad); o += ' (ES 3: tables are half floats)'; void a; }
    return o;
  }

  /** Cheap repaint: only the final pass, reusing the last scene. */
  redrawGlass() {
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
    const plantsOn = p.on && p.count && p.palette && !s.landscape.ocean, treeOn = s.tree.on;
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
    this._1f('uStarGain', 1.0);
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
