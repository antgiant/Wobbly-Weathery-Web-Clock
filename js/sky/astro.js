// Ephemeris glue around astronomy-engine (MIT, vendored in js/vendor).
//
// Everything is returned in the renderer's world frame: x = East, y = Up,
// z = North, azimuth measured from North towards East.

const A = globalThis.Astronomy;
if (!A) throw new Error('astronomy-engine failed to load');

const DEG = Math.PI / 180;
const SUN_LUX = 1.06e5;                 // illuminance of the full sun at the top of the atmosphere
const LUX_AT_MAG = (mag) => Math.pow(10, -0.4 * (mag + 14.18));

const PLANETS = [
  { name: 'Mercury', body: 'Mercury', bv: 0.95 },
  { name: 'Venus',   body: 'Venus',   bv: 0.82 },
  { name: 'Mars',    body: 'Mars',    bv: 1.55 },
  { name: 'Jupiter', body: 'Jupiter', bv: 0.88 },
  { name: 'Saturn',  body: 'Saturn',  bv: 1.05 },
];

// astronomy-engine horizon frame is (North, West, Zenith)
const horToWorld = (v) => [-v.y, v.z, v.x];

function dirFromAzAlt(azDeg, altDeg) {
  const az = azDeg * DEG, el = altDeg * DEG;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}

function bodyHorizon(body, time, obs) {
  const eq = A.Equator(body, time, obs, true, true);
  const hor = A.Horizon(time, obs, eq.ra, eq.dec, 'normal');   // includes refraction
  return hor;
}

/**
 * @param {Date} date
 * @param {number} lat  degrees
 * @param {number} lon  degrees east
 * @param {number} elevM metres above sea level
 * @param {{planets?: boolean}} opt
 */
export function computeSky(date, lat, lon, elevM, opt = {}) {
  const obs = new A.Observer(lat, lon, elevM);
  const time = A.MakeTime(date);

  // J2000 equatorial -> world, as a column-major mat3 for GLSL
  const rot = A.Rotation_EQJ_HOR(time, obs);
  const col = (x, y, z) => horToWorld(A.RotateVector(rot, new A.Vector(x, y, z, time)));
  const cx = col(1, 0, 0), cy = col(0, 1, 0), cz = col(0, 0, 1);
  const eqj = new Float32Array([...cx, ...cy, ...cz]);

  const sunH = bodyHorizon('Sun', time, obs);
  const moonH = bodyHorizon('Moon', time, obs);
  const lib = A.Libration(date);
  const ill = A.Illumination('Moon', time);

  // lunar north pole (IAU), rotated into the world frame
  const pa = 269.9949 * DEG, pd = 66.5392 * DEG;
  const pole = col(Math.cos(pd) * Math.cos(pa), Math.cos(pd) * Math.sin(pa), Math.sin(pd));

  const out = {
    date,
    eqj,
    sun: {
      az: sunH.azimuth, alt: sunH.altitude,
      dir: dirFromAzAlt(sunH.azimuth, sunH.altitude),
      lux: SUN_LUX,
    },
    moon: {
      az: moonH.azimuth, alt: moonH.altitude,
      dir: dirFromAzAlt(moonH.azimuth, moonH.altitude),
      mag: ill.mag,
      fraction: ill.phase_fraction,
      lux: LUX_AT_MAG(ill.mag),
      angR: (lib.diam_deg / 2) * DEG,
      elon: lib.elon * DEG,
      pole,
    },
    planets: [],
  };

  if (opt.planets !== false) {
    for (const p of PLANETS) {
      const h = bodyHorizon(p.body, time, obs);
      const m = A.Illumination(p.body, time).mag;
      out.planets.push({ name: p.name, az: h.azimuth, alt: h.altitude, dir: dirFromAzAlt(h.azimuth, h.altitude), mag: m, bv: p.bv });
    }
  }
  return out;
}

export { SUN_LUX, DEG };
