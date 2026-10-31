// Sunrise / sunset times for the tests, from the same astronomy library and code the page uses.
import path from 'path';
import './astronomy.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const { sunEvents } = await import(path.join(root, 'js/sky/sunpath.js'));
export { sunEvents };
/** The first sunset after the given instant. */
export const nextSunset = (iso, lat = 40.7, lon = -74) => sunEvents(new Date(iso), lat, lon, 0).nextSet;
export const nextSunrise = (iso, lat = 40.7, lon = -74) => sunEvents(new Date(iso), lat, lon, 0).nextRise;
/** ISO string `ms` milliseconds from a Date. */
export const at = (d, ms) => new Date(+d + ms).toISOString().replace(/\.\d+Z$/, 'Z');
