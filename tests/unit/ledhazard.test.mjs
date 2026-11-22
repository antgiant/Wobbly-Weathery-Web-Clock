// The 9 x 7 LED pictures of the severe weather hazards (js/sky/ledcard.js HAZARD_ICON). Run: node tests/unit/ledhazard.test.mjs
import { check, done } from '../lib/check.mjs';
import { installDomStub } from '../lib/dom-stub.mjs';
installDomStub({});
const { HAZARD_ICON } = await import('../../js/sky/ledcard.js');
const { SEV_ICON } = await import('../../js/sky/severe.js');
const types = Object.keys(SEV_ICON).filter((t) => t !== 'other');
check('every hazard of the pill table has an LED picture (the other is the warning triangle)', types.every((t) => Array.isArray(HAZARD_ICON[t])) && Object.keys(HAZARD_ICON).length === types.length);
check('each is 9 wide and 7 tall, drawn with # and . only, with enough lit LEDs to read (at least 10) and not a block (under 50)', Object.values(HAZARD_ICON).every((p) => p.length === 7 && p.every((r) => /^[#.]{9}$/.test(r)) && p.join('').split('#').length - 1 >= 10 && p.join('').split('#').length - 1 < 50));
check('they differ from one another', new Set(Object.values(HAZARD_ICON).map((p) => p.join('/'))).size === types.length);
done();
