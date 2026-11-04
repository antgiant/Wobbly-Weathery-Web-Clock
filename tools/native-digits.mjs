// Writes native/core/src/digits.rs from the digit shapes in js/config.js (`dd`), so the native clock draws the same ten digits.
//   node tools/native-digits.mjs            write it        node tools/native-digits.mjs --check   fail if out of date
import fs from 'fs';
import path from 'path';
import { installDomStub } from '../tests/lib/dom-stub.mjs';
installDomStub({});
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { dd } = await import('../js/config.js');
const rows = dd.map((d, i) => `    // ${i}\n    [${d.map((v) => Number(v).toFixed(1)).join(', ')}],`).join('\n');
const text = `//! The ten digit shapes, generated from \`dd\` in js/config.js by tools/native-digits.mjs: do not edit.
//! Each is 26 numbers: a start point (x, y) then four cubic Bezier curves (two control points and an end point each), in a
//! coordinate space of about 400 x 500. The page draws them with a stroke 80 wide (styles.css).

pub const DIGIT_COUNT: usize = ${dd.length};
pub const POINTS: usize = 26;
pub const STROKE: f64 = 80.0;

pub const DIGITS: [[f64; POINTS]; DIGIT_COUNT] = [
${rows}
];
`;
const out = path.join(root, 'native/core/src/digits.rs');
if (process.argv.includes('--check')) {
  const have = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (have !== text) { console.error('native/core/src/digits.rs is out of date: run node tools/native-digits.mjs'); process.exit(1); }
  console.log('digit shapes are current');
} else { fs.writeFileSync(out, text); console.log('wrote native/core/src/digits.rs'); }
