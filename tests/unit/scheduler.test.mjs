// The one shared timer: jobs run on their period, a period of Infinity means "nothing to do", and a hidden page runs nothing.
// Run: node tests/unit/scheduler.test.mjs
import { installDomStub } from '../lib/dom-stub.mjs';
import { check, done } from '../lib/check.mjs';
installDomStub({});
let visHandler = null;
document.addEventListener = (t, f) => { if (t === 'visibilitychange') visHandler = f; };
console.warn = () => {};                                  // the jobs that fail on purpose would otherwise print
const { every, poke } = await import('../../js/sky/scheduler.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let a = 0, b = 0, c = 0, d = 0, thrown = 0;
every('fast', () => { a++; }, 120, 20);
every('never', () => { b++; }, Infinity);
let on = false;
every('switch', () => { c++; }, () => (on ? 100 : Infinity));
every('boom', () => { thrown++; throw new Error('a job failing must not stop the others'); }, 150, 30);
every('async', async () => { d++; throw new Error('a rejected promise must not stop the others'); }, 150, 30);

await wait(700);
check('a job runs repeatedly on its period (~5 times in 700 ms at 120 ms)', a >= 3 && a <= 8, `ran ${a} times`);
check('a job whose period is Infinity never runs', b === 0);
check('a job that is switched off does not run', c === 0);
check('a throwing job keeps running and does not stop the others', thrown >= 2 && a >= 3);
check('a rejecting job keeps running too', d >= 2);

on = true; poke('switch');
await wait(450);
check('poke() runs a job at once, and once switched on it keeps its period', c >= 3, `ran ${c} times`);
on = false;

// a hidden page runs nothing
document.hidden = true; visHandler && visHandler();
const before = a;
await wait(500);
check('nothing runs while the page is hidden', a === before, `${before} -> ${a}`);
document.hidden = false; visHandler && visHandler();
await wait(200);
check('and jobs catch up the moment it is visible again', a > before);
done();
