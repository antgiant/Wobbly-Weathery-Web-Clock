// Every shader of the engine, translated to GLSL ES 1.00, compiled and linked by the GL driver here (llvmpipe in CI; the Pi's driver with --gpu-test).
// Prints one line per shader; exits with an error when any fails. Used by CI as a stand-in for an OpenGL ES 2 GPU's compiler.
import * as A from 'js/sky/glsl-atmosphere.js';
import * as S from 'js/sky/glsl-scene.js';
import * as P from 'js/sky/glsl-plants.js';
import * as M from 'js/sky/glsl-mask.js';
import { toES1 } from 'js/sky/portable.js';
const g = (n, ...a) => __gl(n, ...a);
const COMPILE = 0x8B81, FRAG = 0x8B30, VERT = 0x8B31;
const mk = (type, src) => { const s = g('createShader', type); g('shaderSource', s, src); g('compileShader', s); const ok = g('getShaderParameter', s, COMPILE) !== 0; return { s, ok, log: ok ? '' : String(g('getShaderInfoLog', s)) }; };
const pairs = [
  ['transmittance', A.VERT_FULLSCREEN, A.FRAG_TRANSMITTANCE], ['multiscatter', A.VERT_FULLSCREEN, A.FRAG_MULTISCATTER], ['skyview', A.VERT_FULLSCREEN, A.FRAG_SKYVIEW],
  ['noisedown', S.VERT_FULLSCREEN, S.FRAG_NOISE_DOWN], ['atlasplace', S.VERT_FULLSCREEN, S.FRAG_ATLAS_PLACE], ['adapt', S.VERT_FULLSCREEN, S.FRAG_ADAPT], ['sky', S.VERT_FULLSCREEN, S.FRAG_SCENE_SKY], ['terrain', S.VERT_FULLSCREEN, S.FRAG_SCENE_TERRAIN], ['blit: off', S.VERT_FULLSCREEN, S.fragBlit('off')], ['blit: ink', S.VERT_FULLSCREEN, S.fragBlit('ink')], ['blit: glass', S.VERT_FULLSCREEN, S.fragBlit('glass')],
  ['led', S.VERT_FULLSCREEN, S.FRAG_LED], ['ledpeak', S.VERT_FULLSCREEN, S.FRAG_LED_PEAK], ['ledavg', S.VERT_FULLSCREEN, S.FRAG_LED_AVG],
  ['stars', S.VERT_STARS, S.FRAG_STARS], ['plants', P.VERT_PLANTS, P.FRAG_PLANTS],
  ['stroke', M.VERT_STROKE, M.FRAG_STROKE], ['light', M.VERT_LIGHT, M.FRAG_LIGHT], ['drop', M.VERT_DROP, M.FRAG_DROP], ['trail', M.VERT_TRAIL, M.FRAG_TRAIL],
];
let bad = 0;
for (const [name, vs, fs] of pairs) {
  const t0 = __now();
  const v = mk(VERT, toES1(vs, 'vertex').src), f = mk(FRAG, toES1(fs, 'fragment').src);
  let msg = v.ok && f.ok ? 'ok' : 'FAILED';
  if (!v.ok) msg += '\n  vertex: ' + v.log.split('\n').slice(0, 6).join('\n          ');
  if (!f.ok) msg += '\n  fragment: ' + f.log.split('\n').slice(0, 6).join('\n            ');
  if (!(v.ok && f.ok)) bad++;
  __print('es1 ' + name + ' (' + (__now() - t0).toFixed(0) + ' ms): ' + msg);
}
if (bad) throw new Error(bad + ' shaders failed to compile as GLSL ES 1.00');
__print('all ' + pairs.length + ' shaders compile as GLSL ES 1.00');
__done();
