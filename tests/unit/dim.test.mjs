// Night dimming amounts. Run: node tests/unit/dim.test.mjs
import { installDomStub } from '../lib/dom-stub.mjs';
import { check, done } from '../lib/check.mjs';
installDomStub({});
const { dimAmount } = await import('../../js/sky/dim.js');

check('"never": no dimming at any time', [-30, -10, 0, 40].every((a) => dimAmount('off', a) === 0));
check('"always": full dimming even at noon', dimAmount('on', 60) === 1);
check('auto: none in daylight and in twilight up to -3 degrees', dimAmount('auto', 30) === 0 && dimAmount('auto', 0) === 0 && dimAmount('auto', -3) === 0);
check('auto: full once the sun is 10 degrees down', dimAmount('auto', -10) === 1 && dimAmount('auto', -40) === 1);
check('auto: eases in between (monotonic, 0 < x < 1 at -6.5)', dimAmount('auto', -6.5) > 0.4 && dimAmount('auto', -6.5) < 0.6);
let prev = -1, mono = true;
for (let a = 5; a >= -15; a -= 0.5) { const d = dimAmount('auto', a); if (d < prev - 1e-12) mono = false; prev = d; }
check('auto: never lightens as the sun sinks', mono);
check('unknown sun (no sky yet): no dimming', dimAmount('auto', undefined) === 0 && dimAmount('auto', NaN) === 0);
check('junk mode: no dimming', dimAmount('maybe', -20) === 0);
done();
