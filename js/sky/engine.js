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

import {
  VERT_FULLSCREEN, FRAG_TRANSMITTANCE, FRAG_MULTISCATTER, FRAG_SKYVIEW,
} from './glsl-atmosphere.js';
import {
  FRAG_NOISE, FRAG_ADAPT, VERT_STARS, FRAG_STARS, FRAG_BLIT, FRAG_LED, FRAG_SCENE,
} from './glsl-scene.js';
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
  constructor(canvas, { baseUrl = '.' } = {}) {
    this.canvas = canvas;
    this.baseUrl = baseUrl;
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    const ext = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    if (!ext) throw new Error('Floating-point render targets are not supported');

    this.s = {
      lat: 40.7, lon: -74.0, elevM: 0, eyeM: 1.7,
      view: { heading: 180, pitch: 12, fov: 80, basis: null },
      weather: { ...CLEAR },
      mie: 2.0,
      quality: 'auto', scale: 0.75, maxDpr: 2,
      bodySize: 2.0, nightBoost: 1.0, bortle: 3, cloudMotion: 1, twinkle: true,
      fps: 15, reducedMotion: false,
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
    this.exposure = { adaptSnap: true };
    this._init();
  }

  // ------------------------------------------------------------- setup ----
  // Shaders are compiled and linked without asking how it went: asking forces the page to wait for the driver. With
  // KHR_parallel_shader_compile the driver builds all of them side by side on other threads while the page carries on,
  // and the result is checked the first time a program is used (_ready). (Measured with a software renderer the total
  // time is the same whichever way it is done; on a GPU driver it keeps the main thread free while they build.)
  _program(vs, fs, attribs) {
    const gl = this.gl, p = gl.createProgram();
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
  _use(P) { this._ready(P); this.gl.useProgram(P.prog); this._cur = P; }
  _1f(n, v) { this.gl.uniform1f(this._u(this._cur, n), v); }
  _1i(n, v) { this.gl.uniform1i(this._u(this._cur, n), v); }
  _2f(n, a, b) { this.gl.uniform2f(this._u(this._cur, n), a, b); }
  _3f(n, v) { this.gl.uniform3f(this._u(this._cur, n), v[0], v[1], v[2]); }
  _4f(n, a, b, c, d) { this.gl.uniform4f(this._u(this._cur, n), a, b, c, d); }
  _m3(n, m) { this.gl.uniformMatrix3fv(this._u(this._cur, n), false, m); }

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

    this.pTrans = this._program(VERT_FULLSCREEN, FRAG_TRANSMITTANCE);
    this.pMS = this._program(VERT_FULLSCREEN, FRAG_MULTISCATTER);
    this.pSkyView = this._program(VERT_FULLSCREEN, FRAG_SKYVIEW);
    this.pNoise = this._program(VERT_FULLSCREEN, FRAG_NOISE);
    this.pAdapt = this._program(VERT_FULLSCREEN, FRAG_ADAPT);
    this.pScene = this._program(VERT_FULLSCREEN, FRAG_SCENE);
    this.pBlit = this._program(VERT_FULLSCREEN, FRAG_BLIT);
    performance.mark('sky:programs-compiled');
    this.pLed = this._program(VERT_FULLSCREEN, FRAG_LED);
    this.pStars = this._program(VERT_STARS, FRAG_STARS, { aStar: 0, aBV: 1 });
    this.pPlants = this._program(VERT_PLANTS, FRAG_PLANTS, { aInst: 0, aSeed: 1 });

    const F = gl.RGBA16F, RGBA = gl.RGBA, HF = gl.HALF_FLOAT;
    this.tTrans = this._target(TRANS_W, TRANS_H, F, RGBA, HF);
    this.tMS = this._target(MS_SIZE, MS_SIZE, F, RGBA, HF);
    this.tSkySun = this._target(SKY_W, SKY_H, F, RGBA, HF);
    this.tSkyMoon = this._target(SKY_W, SKY_H, F, RGBA, HF);
    this.tAdapt = [this._target(1, 1, F, RGBA, HF, gl.NEAREST), this._target(1, 1, F, RGBA, HF, gl.NEAREST)];
    this.adaptIdx = 0;

    // procedural tileable noise (clouds, water, ground speckle), with mips
    this.tNoise = this._target(256, 256, gl.RGBA8, RGBA, gl.UNSIGNED_BYTE, gl.LINEAR_MIPMAP_LINEAR, gl.REPEAT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tNoise.fbo);
    gl.viewport(0, 0, 256, 256);
    this._use(this.pNoise);
    gl.bindVertexArray(this.vaoEmpty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, this.tNoise.tex);
    gl.generateMipmap(gl.TEXTURE_2D);

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
    gl.texImage2D(gl.TEXTURE_2D, 0, F, SKYLINE_BINS, 1, 0, RGBA, gl.FLOAT, new Float32Array(SKYLINE_BINS * 4).fill(-1));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
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
    gl.bindVertexArray(this.vaoPlants);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.plantBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16); gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    // the Christmas tree: two instances of the plant sprite (the tree, and its reflection when it floats on the sea)
    this.treeBuf = gl.createBuffer();
    this.vaoTree = gl.createVertexArray();
    gl.bindVertexArray(this.vaoTree);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.treeBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16); gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
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
    this.glass = { mode: 0, frost: 0.35, contrast: 3, glow: 0, glowCol: [1, 0.85, 0.6], led: { on: false, cols: 64, rows: 32, gap: 0.16, brightness: 1 }, overlay: false, ink: [0.96, 0.97, 1], stroke: 30, light: [-0.5, 0.8, 0.6], lightCol: [1, 1, 1], rect: [0, 0, 1, 1], maskW: 1, maskH: 1, hasMask: false };
    this.overlayTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.maskTex = gl.createTexture();
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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, SKYLINE_BINS, 1, 0, gl.RGBA, gl.FLOAT, l.skyline);
  }

  _resetScale() {
    const q = this.s.quality;
    this.s.scale = q === 'low' ? 0.5 : q === 'medium' ? 0.75 : q === 'high' ? 1.0 : 0.75;
  }

  get now() { return simNow(); }

  onFrame(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

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
    if (this._animated()) return 1000 / this.s.fps;
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
    const wait = this._dirty || this._fast ? 0 : Math.max(0, this.interval() - (performance.now() - this.lastRender));
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
    const cw = Math.max(2, Math.floor(this.canvas.clientWidth * dpr));
    const ch = Math.max(2, Math.floor(this.canvas.clientHeight * dpr));
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

    // ---- scene ----
    const T = this.sceneTarget;
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
    gl.viewport(0, 0, T.w, T.h);
    this._use(this.pScene);
    this._1f('uMie', s.mie);
    this._bindSkyUniforms(sky, sunAz, sunAlt, sunLux, moonAz, moonAlt, moonLux, natural, lp, camH);
    this._1i('uMilky', 4); this._bind(4, this.texMilky);
    this._1i('uMoonTex', 5); this._bind(5, this.texMoon);
    this._1i('uNoise', 6); this._bind(6, this.tNoise.tex);
    this._1i('uSkyline', 7); this._bind(7, this.texSkyline);
    this._1i('uAdapt', 8); this._bind(8, this.tAdapt[this.adaptIdx].tex);
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
    this._1f('uFrame', this.frameNo++ % 1024);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

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
  }

  /** Scene -> canvas, with the glass clock. `scene` is true right after the scene was redrawn. */
  _blit(scene) {
    const gl = this.gl, T = this.sceneTarget, g = this.glass;
    if (!T) return;
    const cw = this.canvas.width, ch = this.canvas.height;
    const glassOn = g.mode > 0 && g.hasMask;
    gl.disable(gl.BLEND);
    gl.bindTexture(gl.TEXTURE_2D, T.tex);
    if (glassOn) {
      if (scene) gl.generateMipmap(gl.TEXTURE_2D);          // frosting blurs through the mip chain
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    const led = g.led.on;
    if (led) this._ensureComp(cw, ch);
    gl.bindFramebuffer(gl.FRAMEBUFFER, led ? this.compTarget.fbo : null);
    gl.viewport(0, 0, cw, ch);
    this._use(this.pBlit);
    this._1i('uTex', 0); this._bind(0, T.tex);
    this._1i('uMask', 1); this._bind(1, this.maskTex);
    const dpr = cw / Math.max(1, this.canvas.clientWidth);
    this._4f('uGlass', g.frost, glassOn ? g.mode : 0, g.stroke * dpr, 0);
    this._4f('uMaskRect', g.rect[0], g.rect[1], g.rect[2], g.rect[3]);
    this._2f('uMaskPx', g.maskW, g.maskH);
    this._2f('uRes', cw, ch);
    this._3f('uLight', g.light);
    this._3f('uLightCol', g.lightCol);
    const portraitLed = ch > cw;
    this._4f('uGlow', g.glow, led ? Math.max(2, Math.floor(Math.min(cw / (portraitLed ? g.led.rows : g.led.cols), ch / (portraitLed ? g.led.cols : g.led.rows)))) : 0, 0, 0);
    this._3f('uGlowCol', g.glowCol);
    this._3f('uInk', g.ink);
    this._1f('uContrast', g.contrast);
    gl.bindVertexArray(this.vaoEmpty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (led) this._ledPass(cw, ch);
  }

  _ensureComp(w, h) {
    const gl = this.gl;
    if (this.compTarget && this.compTarget.w === w && this.compTarget.h === h) return;
    if (this.compTarget) { gl.deleteTexture(this.compTarget.tex); gl.deleteFramebuffer(this.compTarget.fbo); }
    this.compTarget = this._target(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
  }

  /** The finished picture -> a grid of square pixels with black lines between them (64x32, or 32x64 when upright). */
  _ledPass(cw, ch) {
    const gl = this.gl, L = this.glass.led, C = this.compTarget;
    gl.bindTexture(gl.TEXTURE_2D, C.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    this._use(this.pLed);
    this._1i('uComp', 0); this._bind(0, C.tex);
    this._2f('uRes', cw, ch);
    const portrait = ch > cw;
    this._4f('uLed', portrait ? L.rows : L.cols, portrait ? L.cols : L.rows, L.gap, L.brightness);
    this._1i('uOverlay', 1); this._bind(1, this.overlayTex);
    this._1f('uOverlayOn', this.glass.overlay ? 1 : 0);
    gl.bindVertexArray(this.vaoEmpty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    g.rect = rect; g.maskW = canvas.width; g.maskH = canvas.height; g.stroke = strokeCssPx; g.hasMask = true;
    this.redrawGlass();
  }

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
    if (!this._snap || this._snap.w !== w || this._snap.h !== h) this._snap = this._target(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._snap.fbo);
    gl.blitFramebuffer(0, 0, T.w, T.h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._snap.fbo);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);   // GL rows run bottom to top
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
  }

  /** Cheap repaint: only the final pass, reusing the last scene. */
  redrawGlass() {
    if (!this.sceneTarget) { this.dirty = true; return; }
    this._blit(!this._mipsValid && this.glass.mode > 0);
    if (this.glass.mode > 0) this._mipsValid = true;
  }

  _bindSkyUniforms(sky, sunAz, sunAlt, sunLux, moonAz, moonAlt, moonLux, natural, lp, camH) {
    this._1i('uTrans', 0); this._bind(0, this.tTrans.tex);
    this._1i('uSkySun', 2); this._bind(2, this.tSkySun.tex);
    this._1i('uSkyMoon', 3); this._bind(3, this.tSkyMoon.tex);
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
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
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
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x, z, t.h, 10, 0.37, 0.5, x, z, t.h, 11, 0.37, 0.5]), gl.STATIC_DRAW);
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
    if (plantsOn) {
      gl.bindVertexArray(this.vaoPlants);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, p.count);
    }
    if (treeOn) {                                   // the tree last, it is nearer than most plants; on the sea its reflection goes with it
      gl.bindVertexArray(this.vaoTree);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, s.landscape.ocean ? 2 : 1);
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
    gl.drawArrays(gl.POINTS, 0, this.starCount);

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
    if (s.quality !== 'auto') return;
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
