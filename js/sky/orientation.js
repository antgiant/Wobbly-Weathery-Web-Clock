// Device orientation maths for the VR look-around mode (pure functions, no DOM, testable in node).
//
// World frame matches the renderer: x = East, y = Up, z = North. Azimuth is measured from North
// towards East.

const DEG = Math.PI / 180;
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const wrap180 = (d) => ((d + 540) % 360) - 180;
const azimuthOf = (v) => (Math.atan2(v[0], v[2]) / DEG + 360) % 360;

/**
 * W3C DeviceOrientation (alpha, beta, gamma, degrees) + screen angle ->
 * camera basis in the world frame. Back camera looks out of the screen's back.
 */
export function basisFromOrientation(alphaDeg, betaDeg, gammaDeg, screenAngleDeg) {
  const a = alphaDeg * DEG, b = betaDeg * DEG, g = gammaDeg * DEG;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  // R = Rz(alpha) * Rx(beta) * Ry(gamma); columns are the device axes in the Earth frame (E, N, U)
  const X = [ca * cg - sa * sb * sg, sa * cg + ca * sb * sg, -cb * sg];
  const Y = [-sa * cb, ca * cb, sb];
  const Z = [ca * sg + sa * sb * cg, sa * sg - ca * sb * cg, cb * cg];
  const enuToWorld = (v) => [v[0], v[2], v[1]];
  let right = enuToWorld(X), up = enuToWorld(Y);
  const fwd = enuToWorld(scale(Z, -1));
  const th = screenAngleDeg * DEG, c = Math.cos(th), s = Math.sin(th);
  const r2 = add(scale(right, c), scale(up, -s));
  const u2 = add(scale(right, s), scale(up, c));
  return { right: r2, up: u2, forward: fwd };
}

/** Angle the screen content is rotated from the device's natural (portrait) orientation, degrees. */
export function screenAngleNow() {
  const so = typeof screen !== 'undefined' ? screen.orientation : null;
  if (so && typeof so.angle === 'number') return so.angle;
  if (typeof window !== 'undefined' && typeof window.orientation === 'number') return (window.orientation + 360) % 360;
  return 0;
}

/**
 * iOS gives alpha relative to wherever the page started, plus `webkitCompassHeading`. This works out the
 * constant that turns the relative alpha into an absolute one.
 *
 * Two things make that harder than it looks:
 *  - the offset is a property of the sensor frame, so it must be estimated from the RAW alpha. (Feeding the
 *    already-corrected alpha back in and adding the residual again makes it grow on every event, which
 *    is what used to spin the world.)
 *  - nobody documents which axis the heading follows once the device is held upright in landscape: the
 *    direction the camera faces, or the direction the device's top edge points (which is 90 degrees away).
 *    Rather than guess, both readings are tracked, and the one that gives a steady offset while the device
 *    moves is used. Pure turning cannot tell them apart (they differ by a constant), so mostly the portrait / landscape
 *    guess decides: portrait uses the camera, landscape the top edge. `force` overrides it from Settings.
 */
export class CompassCalibrator {
  constructor() { this.force = 'auto'; this.reset(); }
  reset() {
    this.h = { cam: { x: 0, y: 0, w: 0 }, top: { x: 0, y: 0, w: 0 } };
    this.n = 0;
  }
  _push(k, off) {
    const d = 0.997, r = off * DEG, s = this.h[k];
    s.x = s.x * d + Math.cos(r); s.y = s.y * d + Math.sin(r); s.w = s.w * d + 1;
  }
  _conc(k) { const s = this.h[k]; return s.w > 0 ? Math.hypot(s.x, s.y) / s.w : 0; }
  _off(k) { const s = this.h[k]; return Math.atan2(s.y, s.x) / DEG; }

  /** Which reading is in use: 'cam' or 'top'. */
  mode(screenAngle = 0) {
    if (this.force === 'cam' || this.force === 'top') return this.force;
    const a = this.h.cam.w > 30 ? this._conc('cam') : 0, b = this.h.top.w > 30 ? this._conc('top') : 0;
    if (this.n > 90 && Math.abs(a - b) > 0.04) return a > b ? 'cam' : 'top';
    return (screenAngle % 180 === 0) ? 'cam' : 'top';
  }

  /**
   * @param {number} alpha raw alpha, degrees
   * @param {number} compass webkitCompassHeading, degrees clockwise from north
   * @returns {number|null} degrees to SUBTRACT from the raw alpha, or null while the device is too flat to say
   */
  update(alpha, beta, gamma, compass, screenAngle = 0) {
    const b = basisFromOrientation(alpha, beta, gamma, 0);   // right = device X, up = device Y, forward = -Z
    let used = false;
    if (Math.abs(b.forward[1]) < 0.7) { this._push('cam', wrap180(compass - azimuthOf(b.forward))); used = true; }
    if (Math.abs(b.up[1]) < 0.6) { this._push('top', wrap180(compass - azimuthOf(b.up))); used = true; }
    if (used) this.n++;
    if (this.n < 3) return null;
    const m = this.mode(screenAngle);
    return this._off(m);
  }
}
