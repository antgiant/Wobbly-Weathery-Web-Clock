// The Pi's settings file is the only source of its settings (native/host/js/confile.js). Run: node tests/unit/native-conffile.test.mjs
import { check, done } from '../lib/check.mjs';
const { confFromFile } = await import('../../native/host/js/confile.js');
const { SETTINGS } = await import('../../schema/settings.js');

const a = confFromFile('timeZone = America/New_York\nlocation_latitude = 40.7\nlocation_longitude = -74\nhideSeconds = on\nbrightnessNight = 0.4\n', SETTINGS);
check('each line is coerced by its setting\'s type (text, number, on/off)', a.timeZone === 'America/New_York' && a.location_latitude === 40.7 && a.hideSeconds === true && a.brightnessNight === 0.4);
check('a place in the file is a place chosen by hand', a.manualLocation === true && a.locationChoice === 'manual' && a.preciseLocation === false);

// the bug found on the real Pi: a setting once in the file stayed for ever. Built from nothing each start, the file decides.
const first = confFromFile('timeZone = UTC\nhideSeconds = on\n', SETTINGS);
const second = confFromFile('hideSeconds = on\n', SETTINGS);          // the timeZone line was removed
check('a setting removed from the file is gone at the next start (not kept from the last one)', first.timeZone === 'UTC' && !('timeZone' in second) && second.hideSeconds === true);
check('so it is back at its default (the page fills in what the object lacks)', second.timeZone === undefined && SETTINGS.find((s) => s.key === 'timeZone').default === '');
check('a setting changed in the file changes', confFromFile('timeZone = Asia/Tokyo\n', SETTINGS).timeZone === 'Asia/Tokyo');
check('comments, blank lines and rubbish are ignored; a # after a value is a comment', (() => { const c = confFromFile('# a comment\n\nnonsense\ntimeZone = Europe/Paris   # my zone\n = x\n', SETTINGS); return c.timeZone === 'Europe/Paris' && Object.keys(c).length === 1; })());
check('--conf is only a base laid under the file: the file wins, other keys stay', (() => { const c = confFromFile('timeZone = Asia/Tokyo\n', SETTINGS, { timeZone: 'UTC', quality: 'low' }); return c.timeZone === 'Asia/Tokyo' && c.quality === 'low'; })());
check('the command line\'s LED panel size makes an LED panel', (() => { const c = confFromFile('', SETTINGS, {}, { ledCols: 64, ledRows: 32 }); return c.screenMode === 'led' && c.ledCols === 64 && c.ledRows === 32; })());
check('an empty or missing file is an empty object (every default)', Object.keys(confFromFile('', SETTINGS)).length === 0 && Object.keys(confFromFile(undefined, SETTINGS)).length === 0);
check('words a bool setting takes: on, true, yes, 1, off, false, no, 0', ['on', 'true', 'yes', '1'].every((v) => confFromFile(`hideSeconds = ${v}\n`, SETTINGS).hideSeconds === true) && ['off', 'false', 'no', '0'].every((v) => confFromFile(`hideSeconds = ${v}\n`, SETTINGS).hideSeconds === false));
done();
