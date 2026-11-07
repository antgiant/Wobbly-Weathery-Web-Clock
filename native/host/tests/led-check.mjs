// An LED panel and the pills (native/host/js/pills.js): the panel draws the countdown and the umbrella itself, as whole LEDs (js/sky/ledcard.js), so the program must paint no pill on its picture.
// Usage: node led-check.mjs <log> <canvas.ppm>   (the last picture of a run with output = matrix, a countdown near sunset, the rain alert and the countdown's name all on)
import fs from 'fs';
const [log, ppm] = process.argv.slice(2);
if (/^pills: /m.test(fs.readFileSync(log, 'utf8'))) { console.error('pills were painted on an LED panel\'s picture'); process.exit(1); }
const buf = fs.readFileSync(ppm), head = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(buf.subarray(0, 40).toString('latin1'));
const W = +head[1], H = +head[2], px = buf.subarray(head[0].length);
let umbrella = 0, sun = 0;
for (let i = 0; i < W * H; i++) {
  const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
  if (r < 100 && g > 150 && b > 230) umbrella++;                 // the umbrella's light blue (the rain-tinted sky is a deeper blue)
  if (r > 200 && g < 110 && b < 60) sun++;                       // the sunset card's red-orange
}
console.log(`LED picture ${W}x${H}: ${umbrella} umbrella pixels, ${sun} sun-card pixels, no pills`);
if (umbrella < 15) { console.error('the umbrella (the rain alert as LEDs) is missing'); process.exit(1); }
if (sun < 5) { console.error('the sunset card is missing'); process.exit(1); }
console.log('the LED card is drawn and no pill is painted over it');
