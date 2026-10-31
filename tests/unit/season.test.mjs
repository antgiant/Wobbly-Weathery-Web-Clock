// Run: node tests/unit/season.mjs
import { thanksgivingDay, isChristmasSeason } from '../../js/season.js';
let fails = 0;
const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + ' ' + x); if (!ok) fails++; };
const known = { 2023: 23, 2024: 28, 2025: 27, 2026: 26, 2027: 25, 2028: 23 };   // Thanksgiving dates
for (const [y, d] of Object.entries(known)) check(`Thanksgiving ${y} is Nov ${d}`, thanksgivingDay(+y) === d, `got ${thanksgivingDay(+y)}`);
const on = (y, m, d) => isChristmasSeason(new Date(y, m - 1, d, 12));
check('the day before Thanksgiving: off', !on(2026, 11, 25));
check('Thanksgiving itself: on', on(2026, 11, 26));
check('Dec 1: on', on(2026, 12, 1));
check('Christmas Day: on', on(2026, 12, 25));
check('Dec 26: off', !on(2026, 12, 26));
check('January: off', !on(2027, 1, 5));
check('summer: off', !on(2026, 7, 4));
check('early November: off', !on(2026, 11, 2));
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
