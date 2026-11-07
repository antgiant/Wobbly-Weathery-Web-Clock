// The pills on the Pi (native/host/js/pills.js): the program said where it painted them ("pills: x,y,w,h"); in the last picture that rectangle must hold the pills' near-white
// text on a dark capsule, and lie inside the picture. Usage: node pills-check.mjs <log> <frame.ppm>
import fs from 'fs';
const [log, ppm] = process.argv.slice(2);
const lines = fs.readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith('pills: '));
if (!lines.length) { console.error('no "pills:" line in the log: the pills were never painted'); process.exit(1); }
const [x, y, w, h] = /pills: (\d+),(\d+),(\d+),(\d+)/.exec(lines[lines.length - 1]).slice(1).map(Number);
const buf = fs.readFileSync(ppm);
const head = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(buf.subarray(0, 40).toString('latin1'));
const W = +head[1], H = +head[2], data = buf.subarray(head[0].length);
if (x < 0 || y < 0 || x + w > W || y + h > H) { console.error(`the pills' rectangle ${x},${y},${w},${h} is outside the ${W}x${H} picture`); process.exit(1); }
let white = 0, dark = 0;
for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
  const o = (j * W + i) * 3, l = (data[o] + data[o + 1] + data[o + 2]) / 3;
  if (l > 225) white++; else if (l < 70) dark++;
}
console.log(`pills at ${x},${y} ${w}x${h} in ${W}x${H}: ${white} text pixels, ${dark} dark pixels`);
if (white < 150) { console.error('too little text in the pills\' rectangle'); process.exit(1); }
if (dark < w * h * 0.15) { console.error('the pills\' rectangle is not dark: no capsule behind the text'); process.exit(1); }
console.log('the pills are in the picture');
