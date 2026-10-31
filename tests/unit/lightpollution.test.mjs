// Run: node tests/unit/lightpollution.mjs
import { estimateBortle, bortleFromRatio, parsePlaces, haversine } from '../../js/sky/lightpollution.js';
let fails = 0;
const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + ' ' + x); if (!ok) fails++; };
const city = (lat, lon, population, place = 'city') => ({ lat, lon, place, population });
check('haversine: 1 degree of latitude is ~111 km', Math.abs(haversine(0, 0, 1, 0) - 111.2) < 0.5);
check('nothing around -> Bortle 1', estimateBortle(40, -100, []).bortle === 1);
const nyc = estimateBortle(40.75, -73.98, [city(40.71, -74.0, 8300000)]);
check('city centre is Bortle 9', nyc.bortle === 9, JSON.stringify(nyc));
// a farm 60 km out from a city of a million
const farm = estimateBortle(0.54, 0, [city(0, 0, 1000000)]);
check('60 km from a million people is rural-suburban (3-5)', farm.bortle >= 3 && farm.bortle <= 5, `B${farm.bortle} ratio ${farm.ratio.toFixed(2)}`);
const far = estimateBortle(0, 1.0, [city(0, 0, 1000000)]);
check('110 km from the same city is darker than 60 km', far.bortle < farm.bortle, `B${far.bortle} vs B${farm.bortle}`);
const village = estimateBortle(0, 0.05, [{ lat: 0, lon: 0, place: 'village' }]);
check('next to a village in the country is dark (<=3)', village.bortle <= 3, `B${village.bortle}`);
check('inside a built-up area is at least 7', estimateBortle(0, 0, [], { urban: true }).bortle === 7);
check('more population = brighter', estimateBortle(0, 0.3, [city(0, 0, 2e6)]).bortle >= estimateBortle(0, 0.3, [city(0, 0, 2e5)]).bortle);
check('mapped population beats the default', estimateBortle(0, 0.3, [city(0, 0, 3000)]).bortle < estimateBortle(0, 0.3, [{ lat: 0, lon: 0, place: 'city' }]).bortle);
check('classes are monotonic in the ratio', [0, 0.01, 0.1, 0.3, 1, 3, 8, 20, 100].map(bortleFromRatio).every((b, i, a) => i === 0 || b >= a[i - 1]));
check('ratio range covers 1..9', bortleFromRatio(0) === 1 && bortleFromRatio(1e4) === 9);
const parsed = parsePlaces({ elements: [{ lat: 1, lon: 2, tags: { place: 'town', name: 'A', population: '12 500' } }, { lat: 1, lon: 2, tags: { highway: 'x' } }, { type: 'relation', tags: { place: 'city' } }] });
check('parses Overpass output (population with spaces, skips junk)', parsed.length === 1 && parsed[0].population === 12500);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
