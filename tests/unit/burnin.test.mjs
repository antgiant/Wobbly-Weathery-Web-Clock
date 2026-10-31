// The pure parts of anti burn-in: when it is on, the walk, and the size of a step. Run: node tests/unit/burnin.test.mjs
import { installDomStub } from '../lib/dom-stub.mjs';
import { check, done } from '../lib/check.mjs';
installDomStub({});
const { PATH, burnInOn, amplitude } = await import('../../js/sky/burnin.js');

check('on while the screen is kept on (Automatic)', burnInOn({ antiBurnIn: 'auto', keepAwake: true }));
check('off when the screen is not kept on (Automatic)', !burnInOn({ antiBurnIn: 'auto', keepAwake: false }));
check('"Always" ignores keep-awake', burnInOn({ antiBurnIn: 'on', keepAwake: false }));
check('"Never" ignores keep-awake', !burnInOn({ antiBurnIn: 'off', keepAwake: true }));
check('the default (Automatic) is on, because keeping the screen on is the default', burnInOn({ antiBurnIn: undefined, keepAwake: true }));

check('the walk visits nine different places and starts in the middle', new Set(PATH.map((p) => p.join())).size === 9 && PATH[0].join() === '0,0');
let ok = true; for (let i = 0; i < PATH.length; i++) { const a = PATH[i], b = PATH[(i + 1) % PATH.length]; if (Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) > 1) ok = false; }
check('each step moves at most one place in each direction (no jumps), including back to the start', ok);

check('a phone-sized screen steps about 4.7 px', Math.abs(amplitude(390, 100) - 4.68) < 0.01, String(amplitude(390, 100)));
check('a big screen never steps more than 10 px', amplitude(2000, 500) === 10);
check('a tiny screen still steps at least 3 px when there is room', amplitude(100, 100) === 3);
check('a step is never more than half the room to the edge (no cropping)', amplitude(1000, 8) === 4 && amplitude(390, 2) === 1);
check('no room, no step', amplitude(390, 0) === 0);
check('LED: whole LEDs only', amplitude(800, 100, 6) === 6 && amplitude(1600, 100, 6) === 6);
check('LED: a step of one LED needs room for it, otherwise none', amplitude(800, 5, 6) === 0 && amplitude(800, 12, 6) === 6);
done();
