// Saved settings: defaults, the one-time migration of old defaults, and the "until the user chooses" behaviours.
// Run: node tests/unit/config.test.mjs
import { installDomStub, importFresh } from '../lib/dom-stub.mjs';
import { check, done } from '../lib/check.mjs';

// ---- settings saved by an old version (before the defaults changed) ----
installDomStub({ storage: { conf: { confVersion: 0, twentyFourHourClock: true, clockStyle: 'glass', viewMode: 'fixed', keepAwake: false, followSun: false, glassGlowColor: 'warm', location_latitude: 12.3, location_longitude: 45.6, easing: 'easeInOutBack', hideSeconds: true } } });
let m = await importFresh('../../js/config.js');
let c = m.conf;
check('migration: 24-hour time goes back to "follow the browser" (null)', c.twentyFourHourClock === null);
check('migration: liquid glass (the old default) becomes Automatic', c.clockStyle === 'auto');
check('migration: look-around view, keep awake, follow the sun, follow-the-light glow', c.viewMode === 'drag' && c.keepAwake === true && c.followSun === true && c.glassGlowColor === 'follow');
check('migration keeps what the user did set (location, hide seconds)', c.location_latitude === 12.3 && c.location_longitude === 45.6 && c.hideSeconds === true);
check('migration records the version, so it runs once', c.confVersion === m.DEFAULTS.confVersion || c.confVersion >= 3);
check('settings are saved back to storage', JSON.parse(localStorage.getItem('conf')).clockStyle === 'auto');

// a user who chose a non-default style keeps it
installDomStub({ storage: { conf: { confVersion: 0, clockStyle: 'solid' } } });
m = await importFresh('../../js/config.js');
check('migration leaves an explicit style choice alone', m.conf.clockStyle === 'solid');

// ---- a fresh visitor ----
installDomStub({});
m = await importFresh('../../js/config.js');
c = m.conf;
check('fresh: look-around, follow the sun, screen kept on, glow follows the light', c.viewMode === 'drag' && c.followSun === true && c.keepAwake === true && c.glassGlowColor === 'follow');
check('fresh: automatic clock style, 24h and units not chosen yet', c.clockStyle === 'auto' && c.twentyFourHourClock === null && c.tempUnit === 'auto');
check('fresh: umbrella alert and night dimming are off', c.rainAlert === false && c.nightDim === 'off');
check('fresh: classic 64 x 32 LED panel, turning on', c.ledCols === 64 && c.ledRows === 32 && c.ledTurn === true);
check('fresh: not asked about location yet', c.locationChoice === null);
check('fresh: exact position is not shared (coarse lookups on)', c.coarseLookups === true);

// ---- 12 / 24 hour ----
check('explicit 12-hour choice wins', (c.twentyFourHourClock = false, m.use24h() === false));
check('explicit 24-hour choice wins', (c.twentyFourHourClock = true, m.use24h() === true));
c.twentyFourHourClock = null;
const o = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
check('not chosen: follows the locale of the machine', m.use24h() === (o.hourCycle ? o.hourCycle === 'h23' || o.hourCycle === 'h24' : !o.hour12));
installDomStub({ language: 'en-GB' });
// Intl uses the process locale, not navigator, so only the explicit path is asserted above; units use navigator.language:
m = await importFresh('../../js/config.js');
check('temperature unit: en-GB -> Celsius', m.tempUnit() === 'c');
installDomStub({ language: 'en-US' });
m = await importFresh('../../js/config.js');
check('temperature unit: en-US -> Fahrenheit', m.tempUnit() === 'f' && m.formatTemp(20) === '68°F');
m.conf.tempUnit = 'c';
check('temperature unit: explicit choice wins', m.tempUnit() === 'c' && m.formatTemp(20) === '20°C');

// ---- the automatic clock style: coloured lights from Thanksgiving to Christmas ----
const { setSim } = await import('../../js/simtime.js');
m.conf.clockStyle = 'auto';
setSim({ base: new Date(2026, 6, 4, 12), startPerf: performance.now(), scale: 0 });
check('July: Automatic is liquid glass', m.clockStyleNow() === 'glass');
setSim({ base: new Date(2026, 11, 10, 12), startPerf: performance.now(), scale: 0 });
check('December 10: Automatic is the coloured tube', m.clockStyleNow() === 'stained');
m.conf.clockStyle = 'solid';
check('December 10 with solid ink chosen: the choice wins', m.clockStyleNow() === 'solid');
m.conf.clockStyle = 'glass';
check('December 10 with liquid glass chosen: the choice wins', m.clockStyleNow() === 'glass');

// ---- Automatic and power: flat colour while saving power, glass and coloured tube otherwise ----
m.conf.clockStyle = 'auto'; m.conf.quality = 'medium';
setSim({ base: new Date(2026, 6, 4, 12), startPerf: performance.now(), scale: 0 });
check('power: July, normal quality: Automatic is liquid glass', m.clockStyleNow() === 'glass');
m.conf.quality = 'low';
check('power: July with Battery saver quality: Automatic is flat colour', m.clockStyleNow() === 'solid');
setSim({ base: new Date(2026, 11, 10, 12), startPerf: performance.now(), scale: 0 });
check('power: December with Battery saver quality: the coloured tube is flat colour too', m.clockStyleNow() === 'solid');
m.conf.quality = 'medium'; m.power.battery = true;
check('power: a low, unplugged battery does the same', m.clockStyleNow() === 'solid');
m.conf.clockStyle = 'glass';
check('power: an explicit choice of liquid glass is always kept', m.clockStyleNow() === 'glass');
m.power.battery = false; m.conf.clockStyle = 'auto';
check('power: plugged in again, December: the coloured tube returns', m.clockStyleNow() === 'stained');
done();
