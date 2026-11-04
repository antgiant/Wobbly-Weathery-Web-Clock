import { SkyEngine } from 'js/sky/engine.js';
try {
const [W, H] = [__args.w, __args.h];
const canvas = document.createElement('canvas');
canvas.clientWidth = W; canvas.clientHeight = H;
const e = new SkyEngine(canvas, { baseUrl: __root });
while (!e.assetsDone) await new Promise(r => setTimeout(r, 5));
e.set(JSON.parse(__args.state));
e.render(Date.parse(__args.time));
e.render(Date.parse(__args.time));
const gl = canvas.getContext('webgl2');
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
const px = new Uint8Array(W * H * 4);
gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
__writeppm(__args.out, W, H, px.buffer);
} catch (e) { console.error(String(e && e.stack || e)); }
__done();
