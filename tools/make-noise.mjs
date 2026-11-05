// Makes data/noise.bin: the 256 x 256 RGBA noise texture (clouds, water, ground speckle) that the sky shader makes on the GPU with integer arithmetic
// (FRAG_NOISE in js/sky/glsl-scene.js: a PCG hash, value noise, fractal sums, tileable). An OpenGL ES 2 GPU (Pi Zero, 3) has no integer arithmetic, so it loads this
// file instead, and gets the same picture. The same maths, in doubles here and floats there: `native/host/tests/noise-check.js` compares the two (a few of 255 at most).
//   node tools/make-noise.mjs
import { writeFileSync } from 'node:fs';
const N = 256;
const pcg = (v) => {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336653) >>> 0;
  const w = Math.imul((((s >>> ((s >>> 28) + 4)) ^ s) >>> 0), 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
};
const wrap = (x, p) => ((x % p) + p) % p;
const h2 = (x, y, period) => pcg((wrap(x, period) + pcg((wrap(y, period) + 1013) >>> 0)) >>> 0) / 4294967295;
const vnoise = (px, py, period) => {
  const ix = Math.floor(px), iy = Math.floor(py);
  let fx = px - ix, fy = py - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy, period), b = h2(ix + 1, iy, period), c = h2(ix, iy + 1, period), d = h2(ix + 1, iy + 1, period);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
};
const fbm = (u, v, period, oct) => {
  let amp = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += amp * vnoise(u * period, v * period, period); norm += amp; amp *= 0.5; period *= 2; }
  return sum / norm;
};
const out = new Uint8Array(N * N * 4);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const u = (i + 0.5) / N, v = (j + 0.5) / N, o = (j * N + i) * 4;
  out[o] = Math.round(fbm(u, v, 4, 5) * 255);
  out[o + 1] = Math.round(fbm(u + 0.37, v + 0.37, 8, 4) * 255);
  out[o + 2] = Math.round(fbm(u + 0.71, v + 0.71, 16, 3) * 255);
  out[o + 3] = Math.round(fbm(u + 0.13, v + 0.13, 32, 2) * 255);
}
writeFileSync(new URL('../data/noise.bin', import.meta.url), out);
console.log('data/noise.bin', out.length, 'bytes');
