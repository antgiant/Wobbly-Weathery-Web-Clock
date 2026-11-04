// Compares two PPM frames. Prints mean/max channel difference and the share of pixels differing by more than a tolerance.
// usage: node ppm-diff.mjs a.ppm b.ppm [tolerance=8] [diff.ppm] [--max-mean N] [--max-over PERCENT]   (exits 1 when a limit is exceeded)
import fs from 'fs';
const rd = (f) => { const b = fs.readFileSync(f); let p = 0, t = []; while (t.length < 4) { let s = p; while (b[p] > 32) p++; t.push(b.toString('latin1', s, p)); p++; } return { w: +t[1], h: +t[2], d: b.subarray(p) }; };
const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf(k); return i < 0 ? null : +argv.splice(i, 2)[1]; };
const maxMean = opt('--max-mean'), maxOver = opt('--max-over');
const [fa, fb, tol = '8', fd] = argv;
const A = rd(fa), B = rd(fb);
if (A.w !== B.w || A.h !== B.h) { console.error('size differs'); process.exit(2); }
let sum = 0, max = 0, bad = 0; const n = A.w * A.h; const diff = Buffer.alloc(n * 3);
for (let i = 0; i < n; i++) { let m = 0; for (let c = 0; c < 3; c++) { const d = Math.abs(A.d[i * 3 + c] - B.d[i * 3 + c]); sum += d; m = Math.max(m, d); diff[i * 3 + c] = Math.min(255, d * 8); } max = Math.max(max, m); if (m > +tol) bad++; }
const mean = sum / (n * 3), over = bad / n * 100;
console.log(JSON.stringify({ mean: +mean.toFixed(3), max, over: +over.toFixed(2) + '%' }));
if ((maxMean != null && mean > maxMean) || (maxOver != null && over > maxOver)) { console.error('frames differ more than allowed'); process.exitCode = 1; }
if (fd) fs.writeFileSync(fd, Buffer.concat([Buffer.from(`P6\n${A.w} ${A.h}\n255\n`), diff]));
