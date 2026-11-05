// data/noise.bin (made in doubles by tools/make-noise.mjs) against the noise this GPU makes with FRAG_NOISE: they must agree to a few of 255.
import * as S from 'js/sky/glsl-scene.js';
const g = (n, ...a) => __gl(n, ...a);
const sh = (type, src) => { const s = g('createShader', type); g('shaderSource', s, src); g('compileShader', s); if (g('getShaderParameter', s, 0x8B81) === 0) throw new Error(String(g('getShaderInfoLog', s))); return s; };
const p = g('createProgram'); g('attachShader', p, sh(0x8B31, S.VERT_FULLSCREEN)); g('attachShader', p, sh(0x8B30, S.FRAG_NOISE)); g('linkProgram', p);
const tex = g('createTexture'); g('bindTexture', 0xDE1, tex); g('texImage2D', 0xDE1, 0, 0x8058, 256, 256, 0, 0x1908, 0x1401, null); g('texParameteri', 0xDE1, 0x2801, 0x2601);
const fbo = g('createFramebuffer'); g('bindFramebuffer', 0x8D40, fbo); g('framebufferTexture2D', 0x8D40, 0x8CE0, 0xDE1, tex, 0);
g('viewport', 0, 0, 256, 256); g('useProgram', p); const vao = g('createVertexArray'); g('bindVertexArray', vao); g('drawArrays', 4, 0, 3);
__print('fbo status ' + g('checkFramebufferStatus', 0x8D40).toString(16) + ' err ' + g('getError'));
const gpu = new Uint8Array(g('readPixels', 0, 0, 256, 256, 0x1908, 0x1401)), file = new Uint8Array(__readfile(__root + '/data/noise.bin'));
__print('gpu ' + Array.from(gpu.slice(0, 12)).join(',') + '  file ' + Array.from(file.slice(0, 12)).join(',') + ' len ' + gpu.length + '/' + file.length);
let max = 0, sum = 0; for (let i = 0; i < gpu.length; i++) { const d = Math.abs(gpu[i] - file[i]); if (d > max) max = d; sum += d; }
__print('noise.bin vs the GPU: mean difference ' + (sum / gpu.length).toFixed(3) + ', largest ' + max + ' (of 255)');
if (max > 3) throw new Error('data/noise.bin does not match the shader (run node tools/make-noise.mjs)');
