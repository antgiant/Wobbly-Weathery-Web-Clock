// View controls.
//
//   fixed  the clock view: heading / pitch / fov come from settings, no gestures
//   drag   look around with mouse / touch drag, wheel or pinch to zoom
//   look   "VR" magic-window: the phone's orientation sensors steer the camera;
//          dragging nudges the heading (calibration), pinch zooms
//
// World frame matches the renderer: x = East, y = Up, z = North.

const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Rotate v about the world up axis (+y) by `ang` (positive = towards East when facing North). */
function yawAboutUp(v, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

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

export class Controls {
  /**
   * @param {import('./engine.js').SkyEngine} engine
   * @param {object} opt  { onMode(mode), onToast(msg), onChange() }
   */
  constructor(engine, opt = {}) {
    this.engine = engine;
    this.opt = opt;
    this.mode = 'fixed';
    this.heading = 180; this.pitch = 12; this.fov = 80;
    this.yawOffset = 0;                 // look mode: user calibration, radians
    this.compassOffset = 0;             // iOS relative-alpha -> absolute, degrees
    this.haveCompass = false;
    this.sensor = null;                 // smoothed basis
    this.pointers = new Map();
    this.pinch0 = 0; this.fov0 = 0;
    this.idleTimer = 0;
    this._bindPointer();
  }

  setView({ heading, pitch, fov }) {
    if (heading != null) this.heading = heading;
    if (pitch != null) this.pitch = pitch;
    if (fov != null) this.fov = fov;
    this._push();
  }

  _push() {
    const s = this.engine.s;
    this.heading = ((this.heading % 360) + 360) % 360;
    this.pitch = clamp(this.pitch, -89, 89);
    this.fov = clamp(this.fov, 25, 120);
    if (this.mode === 'look' && this.sensor) {
      const b = this.sensor;
      const f = yawAboutUp(b.forward, this.yawOffset), r = yawAboutUp(b.right, this.yawOffset), u = yawAboutUp(b.up, this.yawOffset);
      this.engine.set({ view: { basis: { right: r, up: u, forward: f }, fov: this.fov } });
    } else {
      this.engine.set({ view: { heading: this.heading, pitch: this.pitch, fov: this.fov, basis: null } });
    }
    this.engine.fast = this.mode !== 'fixed' && (this.mode === 'look' || this.pointers.size > 0 || performance.now() - this.lastInput < 1200);
    this.opt.onChange?.();
  }

  // --------------------------------------------------------- modes -------
  async setMode(mode) {
    if (mode === this.mode) return true;
    if (mode === 'look') {
      const ok = await this._startSensors();
      if (!ok) { this.opt.onToast?.('Motion sensors are unavailable or permission was denied'); return false; }
    } else {
      this._stopSensors();
    }
    this.mode = mode;
    this.yawOffset = 0;
    if (mode !== 'look') this.sensor = null;
    this.opt.onMode?.(mode);
    this.engine.fast = mode === 'look';
    this._push();
    return true;
  }

  // ------------------------------------------------------- pointer -------
  _bindPointer() {
    this.lastInput = 0;
    const el = window;
    const ignore = (e) => e.target.closest?.('.modal, #settings, .fab, #hud button, input, select, button, a');
    el.addEventListener('pointerdown', (e) => {
      if (this.mode === 'fixed' || ignore(e)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) { this.pinch0 = this._pinchDist(); this.fov0 = this.fov; }
      this.engine.fast = true;
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      this.lastInput = performance.now();
      if (this.pointers.size === 2) {
        const d = this._pinchDist();
        if (this.pinch0 > 0) this.fov = this.fov0 * (this.pinch0 / d);
      } else {
        // drag the sky: grab-and-pull, scaled by the field of view so it tracks the finger
        const perPx = this.fov / Math.max(window.innerWidth, window.innerHeight);
        if (this.mode === 'look') this.yawOffset += dx * perPx * DEG;
        else { this.heading -= dx * perPx; this.pitch += dy * perPx; }
      }
      this._push();
    });
    const up = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch0 = 0;
      if (this.mode !== 'look') setTimeout(() => this._push(), 1300);   // drop back to the low-power cadence
      this._push();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
      if (this.mode === 'fixed' || ignore(e)) return;
      this.fov *= Math.exp(e.deltaY * 0.001);
      this.lastInput = performance.now();
      this._push();
      setTimeout(() => this._push(), 1300);
    }, { passive: true });
    el.addEventListener('dblclick', (e) => {
      if (this.mode !== 'drag' || ignore(e)) return;
      this.setView({ heading: this.engine.s.view.heading, pitch: 12, fov: 80 });
    });
  }
  _pinchDist() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  // ------------------------------------------------------ sensors -------
  async _startSensors() {
    if (typeof DeviceOrientationEvent === 'undefined') return false;
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return false;
      } catch (_) { return false; }
    }
    this._onOri = (e) => this._handleOrientation(e);
    this._gotAbsolute = false;
    // Android Chrome exposes true-north referenced angles separately
    window.addEventListener('deviceorientationabsolute', this._onOriAbs = (e) => { this._gotAbsolute = true; this._handleOrientation(e, true); }, true);
    window.addEventListener('deviceorientation', this._onOri, true);
    // if no event arrives soon there is no sensor (desktop browsers fire one null event)
    return await new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve(false); } }, 1500);
      this._firstCb = () => { if (!done) { done = true; clearTimeout(t); resolve(true); } };
    });
  }
  _stopSensors() {
    if (this._onOri) window.removeEventListener('deviceorientation', this._onOri, true);
    if (this._onOriAbs) window.removeEventListener('deviceorientationabsolute', this._onOriAbs, true);
    this._onOri = this._onOriAbs = null;
  }

  _handleOrientation(e, absoluteEvent = false) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    if (!absoluteEvent && this._gotAbsolute) return;          // prefer the absolute stream when present
    this._firstCb?.(); this._firstCb = null;
    const screenAngle = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;

    let alpha = e.alpha;
    const absolute = absoluteEvent || e.absolute === true;
    if (!absolute && typeof e.webkitCompassHeading === 'number') {
      // iOS: alpha is relative to wherever the page started; calibrate it against the compass
      const probe = basisFromOrientation(alpha, e.beta, e.gamma, screenAngle);
      const f = probe.forward;
      const flat = Math.abs(f[1]) > 0.85;                     // looking steeply up/down: compass ill-defined
      if (!flat) {
        const camHeading = (Math.atan2(f[0], f[2]) / DEG + 360) % 360;
        let diff = e.webkitCompassHeading - camHeading;       // what to add to the relative heading
        diff = ((diff + 540) % 360) - 180;
        this.compassOffset = this.haveCompass ? this.compassOffset + diff * 0.08 : diff;
        this.haveCompass = true;
      }
      alpha = alpha - this.compassOffset;                     // alpha grows counter-clockwise; heading clockwise
    }
    const b = basisFromOrientation(alpha, e.beta, e.gamma, screenAngle);

    // light nlerp smoothing: tames sensor jitter without adding perceptible lag
    if (!this.sensor) this.sensor = b;
    else {
      const k = 0.45, s = this.sensor;
      const mix = (p, q) => norm(add(scale(p, 1 - k), scale(q, k)));
      this.sensor = { right: mix(s.right, b.right), up: mix(s.up, b.up), forward: mix(s.forward, b.forward) };
      // re-orthogonalise
      const f = this.sensor.forward;
      const r = norm(cross(this.sensor.up, f)); const u = cross(f, r);
      this.sensor = { right: r, up: u, forward: f };
    }
    if (this.mode === 'look') this._push();
    else this._pendingLook = true;
  }

  /** Current look direction for the HUD. */
  get lookDir() {
    const b = this.engine._basis();
    const f = b.forward;
    return { az: (Math.atan2(f[0], f[2]) / DEG + 360) % 360, alt: Math.asin(clamp(f[1], -1, 1)) / DEG };
  }
}

export { yawAboutUp };
