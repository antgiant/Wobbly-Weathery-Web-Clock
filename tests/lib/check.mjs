// The tiny assertion helper every unit test uses: prints PASS / FAIL lines and exits non-zero if anything failed.
let fails = 0, total = 0;
export const check = (name, ok, extra = '') => { total++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!ok) fails++; };
export const done = () => { console.log(fails ? `${fails} FAILED of ${total}` : 'all passed'); process.exit(fails ? 1 : 0); };
