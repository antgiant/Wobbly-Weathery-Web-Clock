// The built-in city list (js/cities.js): sane coordinates and time zones, searchable without a connection. Run: node tests/unit/cities.test.mjs
import { check, done } from '../lib/check.mjs';
import { installDomStub } from '../lib/dom-stub.mjs';
installDomStub({});
const { CITIES, findCities } = await import('../../js/cities.js');
const { validZone } = await import('../../js/timezone.js');

check('the list has a few hundred names at most (it is kept small for the page-size budget) and no repeats', CITIES.length >= 100 && CITIES.length < 250 && new Set(CITIES.map((c) => c[0] + c[1])).size === CITIES.length, String(CITIES.length));
check('every entry has a name, a country, coordinates on Earth and a real time zone', CITIES.every((c) => c[0] && c[1] && Math.abs(c[2]) <= 90 && Math.abs(c[3]) <= 180 && validZone(c[4])), CITIES.filter((c) => !validZone(c[4])).map((c) => c[0] + ':' + c[4]).join());
// longitude and time zone must roughly agree: solar time is within about 3 hours of the zone's clock (political zones stretch, so this is loose)
const offsetHours = (zone, at = new Date('2026-03-01T12:00:00Z')) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', hour: 'numeric', minute: 'numeric', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(at).map((x) => [x.type, Number(x.value)])); return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - at.getTime()) / 3600e3; };
const odd = CITIES.filter((c) => Math.abs(offsetHours(c[4]) - c[3] / 15) > 3.5);
check('every city\'s longitude agrees with its time zone to within 3.5 hours (catches swapped signs and wrong zones)', odd.length === 0, odd.map((c) => `${c[0]} lon ${c[3]} ${c[4]} ${offsetHours(c[4])}`).join('; '));
const at = (name) => CITIES.find((c) => c[0] === name);
check('a few well-known places are where they should be', Math.abs(at('London')[2] - 51.5) < 0.2 && Math.abs(at('Sydney')[3] - 151.2) < 0.2 && at('Sydney')[2] < 0 && at('New York')[3] < 0 && Math.abs(at('Reykjavik')[2] - 64.15) < 0.05 && at('Tokyo')[4] === 'Asia/Tokyo' && at('Chicago')[4] === 'America/Chicago');
check('search finds a city by its first letters, ignoring case and accents, best match first', findCities('chic')[0][0] === 'Chicago' && findCities('SYD')[0][0] === 'Sydney' && findCities('sao')[0][0] === 'Sao Paulo' && findCities('new')[0][0] === 'New Orleans' || findCities('new')[0][0] === 'New York');
check('search also matches a later word and the country name, and is limited', findCities('angeles').some((c) => c[0] === 'Los Angeles') && findCities('japan').length === 3 && findCities('united', 4).length === 4);
check('too short or unknown gives nothing', findCities('a').length === 0 && findCities('').length === 0 && findCities('zzzzzz').length === 0);
done();
