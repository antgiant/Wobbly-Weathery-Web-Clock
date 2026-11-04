import { SkyEngine } from 'js/sky/engine.js';
try {
const [W, H] = [__args.w, __args.h];
const canvas = document.createElement('canvas');
canvas.clientWidth = W; canvas.clientHeight = H;
const e = new SkyEngine(canvas, { baseUrl: __root });
while (!e.assetsDone) await new Promise(r => setTimeout(r, 5));
e.set({ sim: { base: new Date(__args.time), startPerf: performance.now(), scale: 0 }, ...JSON.parse(__args.state) });      // the moment is fixed (the engine otherwise shows the real time of day, and the picture would depend on when the test runs)
e.render(Date.parse(__args.time));
e.render(Date.parse(__args.time));
const gl = canvas.getContext('webgl2');
console.log('GL error after render: 0x' + gl.getError().toString(16));
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
const px = new Uint8Array(W * H * 4);
gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
__writeppm(__args.out, W, H, px.buffer);
} catch (e) { console.error(String(e && e.stack || e)); }
__done();
