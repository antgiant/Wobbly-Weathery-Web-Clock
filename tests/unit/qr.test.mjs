// The QR encoder (js/qr.js). The golden codes were decoded with an independent decoder (ZXing) when they were frozen: if the hash of a
// code changes, the encoder changed and must be decoded again (see the note in js/qr.js). Run: node tests/unit/qr.test.mjs
import crypto from 'crypto';
import { check, done } from '../lib/check.mjs';
const Q = await import('../../js/qr.js');
const hash = (m) => crypto.createHash('sha256').update(m.map((r) => r.map((x) => (x ? 1 : 0)).join('')).join('\n')).digest('hex').slice(0, 16);

const GOLD = [
  ['M', 'https://clock.wooleys.us/?c=AbCdEfGh12', 29, '957257497430565b'],
  ['M', 'https://clock.wooleys.us/?v=1&preset=bedside&hideSeconds=on&place=41.8781,-87.6298&kiosk=1', 41, 'e2be7904373a7710'],
  ['L', 'A', 21, 'f195dbbdf146dae0'],
  ['M', 'x'.repeat(140), 49, '3f5714c640f72495'],
];
for (const [level, text, n, h] of GOLD) {
  const m = Q.render(text, level);
  check(`golden code (${level}, ${text.length} bytes, ${n} x ${n}) is unchanged since it was decoded by ZXing`, m && m.length === n && hash(m) === h, m ? `${m.length} ${hash(m)}` : 'null');
}

// structure, for every version and level
const text = (n) => 'a'.repeat(n);
for (const level of ['L', 'M']) {
  const cases = [1, 17, 40, 70, 100, 130, 160, 190].filter((n) => Q.fits(n, level));
  const ok = cases.every((len) => {
    const m = Q.render(text(len), level), n = m.length, v = (n - 17) / 4;
    const finder = (r0, c0) => { for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) { const want = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4); if (m[r0 + r][c0 + c] !== want) return false; } return true; };
    const timing = Array.from({ length: n - 16 }, (_, i) => i + 8).every((i) => m[6][i] === (i % 2 === 0) && m[i][6] === (i % 2 === 0));
    return Number.isInteger(v) && v >= 1 && v <= 10 && finder(0, 0) && finder(0, n - 7) && finder(n - 7, 0) && timing && m[n - 8][8] === true;
  });
  check(`level ${level}: sizes are 21 + 4(v-1), the three finder squares, the timing lines and the always-dark module are right`, ok);
}
check('the smallest version that fits is used, and capacity grows with the version (M: 14 bytes in v1, 26 in v2, 42 in v3)', Q.fits(14, 'M') === 1 && Q.fits(15, 'M') === 2 && Q.fits(26, 'M') === 2 && Q.fits(27, 'M') === 3 && Q.fits(42, 'M') === 3 && Q.fits(43, 'M') === 4 && Q.fits(17, 'L') === 1 && Q.fits(18, 'L') === 2);
check('text that is too long for version 10 gives null, not a broken code', Q.render('z'.repeat(300), 'M') === null && Q.render('z'.repeat(214), 'M') === null && Q.render('z'.repeat(213), 'M') !== null);
check('the code depends only on the text (same text, same code; different text, different code)', hash(Q.render('abc', 'M')) === hash(Q.render('abc', 'M')) && hash(Q.render('abc', 'M')) !== hash(Q.render('abd', 'M')) && hash(Q.render('abc', 'M')) !== hash(Q.render('abc', 'L')));
check('non-ASCII text is encoded as UTF-8 bytes (an accented letter takes 2)', Q.fits(new TextEncoder().encode('é'.repeat(8)).length, 'M') === 2);
const svg = Q.toSvg('https://clock.wooleys.us/?c=AbCd', 'M');
check('the SVG has a quiet zone of 4 modules, a white background and one path of dark modules', /viewBox="0 0 37 37"/.test(svg) && svg.includes('fill="#fff"') && svg.includes('fill="#000"') && Q.toSvg('z'.repeat(300)) === '');
done();
