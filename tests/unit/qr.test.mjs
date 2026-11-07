// The QR encoder (js/qr.js). The golden codes were decoded with an independent decoder (ZXing) when they were frozen: if the hash of a
// code changes, the encoder changed and must be decoded again (see the note in js/qr.js). Run: node tests/unit/qr.test.mjs
import crypto from 'crypto';
import { check, done } from '../lib/check.mjs';
const Q = await import('../../js/qr.js');
const hash = (m) => crypto.createHash('sha256').update(m.map((r) => r.map((x) => (x ? 1 : 0)).join('')).join('\n')).digest('hex').slice(0, 16);

// a repeatable text of n characters (the larger golden codes: every version 1 to 40, at L and M, with the largest and a middling payload, was decoded by OpenCV's QR decoder when they were frozen)
const mk = (n, seed) => { let s = seed; const a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~:/?#'; return Array.from({ length: n }, () => a[(s = (s * 1103515245 + 12345) & 0x7fffffff) % a.length]).join(''); };
const GOLD = [
  ['M', 'https://clock.wooleys.us/?c=AbCdEfGh12', 29, '957257497430565b'],
  ['M', 'https://clock.wooleys.us/?v=1&preset=bedside&hideSeconds=on&place=41.8781,-87.6298&kiosk=1', 41, 'e2be7904373a7710'],
  ['L', 'A', 21, 'f195dbbdf146dae0'],
  ['M', 'x'.repeat(140), 49, '3f5714c640f72495'],
  ['L', mk(300, 7), 61, '944ebd9dd0be0185'],
  ['M', mk(600, 9), 93, '35f3fc825bfccc60'],
  ['M', mk(2331, 11), 177, '8147239500405c52'],      // the largest at M (version 40)
  ['L', mk(2953, 13), 177, 'a04a932dec2ff818'],      // the largest at L
];
for (const [level, text, n, h] of GOLD) {
  const m = Q.render(text, level);
  check(`golden code (${level}, ${text.length} bytes, ${n} x ${n}) is unchanged since it was decoded by ZXing`, m && m.length === n && hash(m) === h, m ? `${m.length} ${hash(m)}` : 'null');
}

// structure, for every version and level
const text = (n) => 'a'.repeat(n);
for (const level of ['L', 'M']) {
  const cases = [1, 17, 40, 70, 100, 130, 160, 190, 300, 700, 1200, 2000, 2900].filter((n) => Q.fits(n, level));
  const ok = cases.every((len) => {
    const m = Q.render(text(len), level), n = m.length, v = (n - 17) / 4;
    const finder = (r0, c0) => { for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) { const want = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4); if (m[r0 + r][c0 + c] !== want) return false; } return true; };
    const timing = Array.from({ length: n - 16 }, (_, i) => i + 8).every((i) => m[6][i] === (i % 2 === 0) && m[i][6] === (i % 2 === 0));
    return Number.isInteger(v) && v >= 1 && v <= 40 && finder(0, 0) && finder(0, n - 7) && finder(n - 7, 0) && timing && m[n - 8][8] === true;
  });
  check(`level ${level}: sizes are 21 + 4(v-1), the three finder squares, the timing lines and the always-dark module are right`, ok);
}
check('the smallest version that fits is used, and capacity grows with the version (M: 14 bytes in v1, 26 in v2, 42 in v3)', Q.fits(14, 'M') === 1 && Q.fits(15, 'M') === 2 && Q.fits(26, 'M') === 2 && Q.fits(27, 'M') === 3 && Q.fits(42, 'M') === 3 && Q.fits(43, 'M') === 4 && Q.fits(17, 'L') === 1 && Q.fits(18, 'L') === 2);
check('text that is too long for version 40 gives null, not a broken code (2331 bytes at M, 2953 at L)', Q.render('z'.repeat(2332), 'M') === null && Q.render('z'.repeat(2331), 'M') !== null && Q.render('z'.repeat(2954), 'L') === null && Q.render('z'.repeat(2953), 'L') !== null);
check('a link over 210 characters (it used to give no code) now has one, in the version it needs', Q.render('z'.repeat(214), 'M') !== null && Q.fits(214, 'M') === 11 && Q.fits(300, 'M') === 13, `${Q.fits(214, 'M')} ${Q.fits(300, 'M')}`);
check('the capacity at every version matches the standard (data codewords: L 19, 34, 55 ... 2956; M 16, 28, 44 ... 2334, for versions 1, 2, 3 ... 40)', [[1, 'L', 17], [10, 'L', 271], [20, 'L', 858], [30, 'L', 1732], [40, 'L', 2953], [10, 'M', 213], [20, 'M', 666], [30, 'M', 1370], [40, 'M', 2331]].every(([v, lv, bytes]) => Q.fits(bytes, lv) === v && (Q.fits(bytes + 1, lv) > v || (v === 40 && Q.fits(bytes + 1, lv) === 0))), 'see the capacities');
check('the code depends only on the text (same text, same code; different text, different code)', hash(Q.render('abc', 'M')) === hash(Q.render('abc', 'M')) && hash(Q.render('abc', 'M')) !== hash(Q.render('abd', 'M')) && hash(Q.render('abc', 'M')) !== hash(Q.render('abc', 'L')));
check('non-ASCII text is encoded as UTF-8 bytes (an accented letter takes 2)', Q.fits(new TextEncoder().encode('é'.repeat(8)).length, 'M') === 2);
const svg = Q.toSvg('https://clock.wooleys.us/?c=AbCd', 'M');
check('the SVG has a quiet zone of 4 modules, a white background and one path of dark modules', /viewBox="0 0 37 37"/.test(svg) && svg.includes('fill="#fff"') && svg.includes('fill="#000"') && Q.toSvg('z'.repeat(3000)) === '' && Q.toSvg('z'.repeat(300)) !== '');
done();
