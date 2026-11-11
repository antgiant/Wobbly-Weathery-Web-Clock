// When a rainbow shows (js/sky/rainbow.js). Run: node tests/unit/rainbow.test.mjs
import { check, done } from '../lib/check.mjs';
const { rainbowStrength, bowTopAltitude, PRIMARY_DEG } = await import('../../js/sky/rainbow.js');
const shower = { precip: 0.3, cover: [0.4, 0.3, 0.2], fog: 0, snowfall: 0 };

check('a shower with the sun out and low makes a vivid rainbow', rainbowStrength(15, shower) > 0.8, String(rainbowStrength(15, shower)));
check('no rain, no rainbow (a dry sky has no drops)', rainbowStrength(15, { ...shower, precip: 0 }) === 0);
check('an overcast hides the sun: no rainbow', rainbowStrength(15, { ...shower, cover: [1, 0.8, 0.5] }) === 0);
check('a downpour hides the sun too', rainbowStrength(15, { ...shower, precip: 0.95 }) === 0);
check('fog and snow make none', rainbowStrength(15, { ...shower, fog: 1 }) === 0 && rainbowStrength(15, { ...shower, snowfall: 1 }) === 0);
check('the sun below the horizon or above 42 degrees: none (the ring is below the horizon)', rainbowStrength(-5, shower) === 0 && rainbowStrength(0.1, shower) === 0 && rainbowStrength(42, shower) === 0 && rainbowStrength(60, shower) === 0);
check('the lower the sun, the more of a bow: stronger at 10 degrees than at 38', rainbowStrength(10, shower) > rainbowStrength(38, shower));
check('it fades in as the sun clears the horizon and out as it nears 42 degrees', rainbowStrength(1, shower) < rainbowStrength(6, shower) && rainbowStrength(36, shower) < rainbowStrength(25, shower));
check('a little rain is enough, more cloud means a weaker bow, never above 1 or below 0', (() => { const a = rainbowStrength(15, { ...shower, precip: 0.06 }), b = rainbowStrength(15, { ...shower, cover: [0.6, 0.3, 0.2] }), c = rainbowStrength(15, shower); return a > 0 && b < c && [a, b, c].every((v) => v >= 0 && v <= 1); })());
check('the top of the bow stands 42 degrees minus the sun\'s height above the horizon', bowTopAltitude(10) === 32 && bowTopAltitude(0) === PRIMARY_DEG);
check('missing weather fields mean none, not a crash', rainbowStrength(15, null) === 0 && rainbowStrength(15, {}) === 0);
done();
