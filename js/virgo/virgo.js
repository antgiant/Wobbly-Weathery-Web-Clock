// ESM JSON imports (modern browsers)
import timezoneCentroids from './lib/timezone_centroids.js';
import timezoneLinks from './lib/timezone_links.js';

export class Virgo {
  static toRadians(degrees) { return degrees * (Math.PI / 180); }

  static getLocation(timeZone) {
    const defaultTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const selectedTimeZone = timeZone || defaultTimeZone;
    if (Object.keys(timezoneCentroids).includes(selectedTimeZone)) {
      return this.timezoneCentroids[selectedTimeZone];
    } else if (Object.keys(timezoneLinks).includes(selectedTimeZone)) {
      console.info(`Time zone '${selectedTimeZone}' links to ${timezoneLinks[selectedTimeZone]}`);
      return this.timezoneCentroids[timezoneLinks[selectedTimeZone]];
    } else {
      console.warn(`Time zone '${selectedTimeZone}' is not supported. Location not found.`);
      return { latitude: Infinity, longitude: Infinity, lightPollution: 4 };
    }
  }

  static getDistances(params) {
    const radius = 6371; // km
    const distances = [];
    let origin;
    if (!params?.from) {
      origin = this.getLocation();
    } else if (typeof params.from === 'string') {
      origin = this.getLocation(params.from);
    } else {
      origin = params.from;
    }
    for (let destination of params.to) {
      if (typeof destination === 'string') destination = this.getLocation(destination);
      const deltaLat = this.toRadians(destination.latitude - origin.latitude);
      const deltaLon = this.toRadians(destination.longitude - origin.longitude);
      const distanceFactor =
        Math.sin(deltaLat / 2) ** 2 +
        Math.cos(this.toRadians(origin.latitude)) *
          Math.cos(this.toRadians(destination.latitude)) *
          Math.sin(deltaLon / 2) ** 2;
      const arc = 2 * Math.atan2(Math.sqrt(distanceFactor), Math.sqrt(1 - distanceFactor));
      distances.push(radius * arc);
    }
    return distances;
  }
}
Virgo.timezoneCentroids = timezoneCentroids;

export default Virgo;