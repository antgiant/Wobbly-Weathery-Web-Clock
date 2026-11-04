// Compares two PPM frames. Prints mean/max channel difference and the share of pixels differing by more than a tolerance.
// usage: node ppm-diff.mjs a.ppm b.ppm [tolerance=8] [diff.ppm]
import fs from 'fs';
const rd = (f) => { const b = fs.readFileSync(f); let p = 0, t = []; while (t.length < 4) { let s = p; while (b[p] > 32) p++; t.push(b.toString('latin1', s, p)); p++; } return { w: +t[1], h: +t[2], d: b.subarray(p) }; };
const [fa, fb, tol = '8', fd] = process.argv.slice(2);
const A = rd(fa), B = rd(fb);
if (A.w !== B.w || A.h !== B.h) { console.error('size differs'); process.exit(2); }
let sum = 0, max = 0, bad = 0; const n = A.w * A.h; const diff = Buffer.alloc(n * 3);
for (let i = 0; i < n; i++) { let m = 0; for (let c = 0; c < 3; c++) { const d = Math.abs(A.d[i * 3 + c] - B.d[i * 3 + c]); sum += d; m = Math.max(m, d); diff[i * 3 + c] = Math.min(255, d * 8); } max = Math.max(max, m); if (m > +tol) bad++; }
console.log(JSON.stringify({ mean: +(sum / (n * 3)).toFixed(3), max, over: +(bad / n * 100).toFixed(2) + '%' }));
if (fd) fs.writeFileSync(fd, Buffer.concat([Buffer.from(`P6\n${A.w} ${A.h}\n255\n`), diff]));
