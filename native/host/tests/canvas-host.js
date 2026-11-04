import { draw } from 'native/host/tests/canvas-case.js';
const r = draw(document);
const px = new Uint8Array(r.w * r.h * 4);
for (let i = 0; i < r.w * r.h; i++) { const a = r.data[i * 4 + 3] / 255; for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.round(r.data[i * 4 + c] * a + 255 * (1 - a)); px[i * 4 + 3] = 255; }
// __writeppm writes GL's bottom-up rows; flip first so the file is the picture
const flip = new Uint8Array(px.length); for (let y = 0; y < r.h; y++) flip.set(px.subarray(y * r.w * 4, (y + 1) * r.w * 4), (r.h - 1 - y) * r.w * 4);
__writeppm(__args.out, r.w, r.h, flip.buffer);
__done();
