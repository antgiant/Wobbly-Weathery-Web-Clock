// The quality governor: keeps the clock between a floor and a ceiling of frames per second by raising or lowering quality.
//
// A frame has a cost (milliseconds to make it, measured by the host). The governor owns a ladder of quality levels, from the cheapest picture that
// still looks right up to the best one, and moves along it: down quickly when frames cost more than the floor allows (15 fps = 66.7 ms; it aims for
// 80% of that), up slowly and only when the next level is predicted to fit, never faster than the ceiling needs (60 fps = 16.7 ms between frames).
// It also says how often to tick: as fast as the frames allow, within [1000 / ceiling, 1000 / floor].
//
// Pure maths: no DOM, no GL, no clock of its own (the caller passes the time), so it is tested in node.

/** Each level: the knobs it sets. Drawing cost is roughly proportional to outScale^2 (the final pass runs on every output pixel) plus the sky's share. */
export const LADDER = [
  { outScale: 0.20, scale: 0.35, skyMs: 6000, stars: 0.15, drops: 24, lut: 0.25 },
  { outScale: 0.25, scale: 0.40, skyMs: 5000, stars: 0.25, drops: 32, lut: 0.25 },
  { outScale: 0.33, scale: 0.45, skyMs: 4000, stars: 0.35, drops: 48, lut: 0.25 },
  { outScale: 0.42, scale: 0.50, skyMs: 3000, stars: 0.50, drops: 64, lut: 0.35 },
  { outScale: 0.50, scale: 0.55, skyMs: 2500, stars: 0.60, drops: 80, lut: 0.50 },
  { outScale: 0.60, scale: 0.65, skyMs: 2000, stars: 0.70, drops: 96, lut: 0.50 },
  { outScale: 0.70, scale: 0.75, skyMs: 1500, stars: 0.80, drops: 112, lut: 0.75 },
  { outScale: 0.80, scale: 0.85, skyMs: 1200, stars: 0.90, drops: 128, lut: 0.75 },
  { outScale: 0.90, scale: 0.95, skyMs: 1000, stars: 1.00, drops: 144, lut: 1.00 },
  { outScale: 1.00, scale: 1.00, skyMs: 1000, stars: 1.00, drops: 160, lut: 1.00 },
];

export class Governor {
  /**
   * @param {{floorFps?:number, ceilFps?:number, level?:number, ladder?:object[], headroom?:number}} o
   *   headroom: the share of the floor's frame time a frame may use (0.8 leaves a fifth for everything the measurement misses)
   */
  constructor({ floorFps = 15, ceilFps = 60, level, ladder = LADDER, headroom = 0.8, pin = false } = {}) {
    this.pin = !!pin;                       // never move from the starting level (to measure one level, or to compare two runs)
    this.ladder = ladder; this.floorFps = floorFps; this.ceilFps = ceilFps; this.headroom = headroom;
    this.level = level == null ? Math.floor(ladder.length / 2) : Math.max(0, Math.min(ladder.length - 1, level));
    this.cost = null;                     // smoothed cost of one frame at the current level, ms
    this.samples = 0;
    this.stableSince = 0;                 // when the cost last became comfortably low (ms), 0 = not now
    this.blockedUntil = 0;                // after a step down, no step up for a while (stops flapping)
    this.changes = 0;
  }

  get knobs() { return this.ladder[this.level]; }
  get budgetMs() { return (1000 / this.floorFps) * this.headroom; }
  /** The pixel-work of a level, for predicting what another level would cost. */
  work(l) { const k = this.ladder[l]; return k.outScale * k.outScale * 0.8 + k.scale * k.scale * 0.2; }
  /** How long to wait between frames while something moves: as fast as the frames allow, between the ceiling and the floor. */
  get tickMs() {
    const lo = 1000 / this.ceilFps, hi = 1000 / this.floorFps;
    return Math.min(hi, Math.max(lo, (this.cost == null ? hi : this.cost * 1.15)));
  }

  /**
   * One frame was made in `costMs` (at the knobs the governor had set), now = a monotonic time in ms.
   * Returns true when the level changed (the caller applies `knobs`).
   */
  report(costMs, now) {
    if (!(costMs >= 0)) return false;
    // a single freak frame (a collection, a shader compile) is limited to 2.5 times what frames cost so far, so it cannot move the average far;
    // a machine that really got slower still gets there in a few frames
    const sample = this.cost == null ? costMs : Math.min(costMs, Math.max(this.cost * 2.5, 8));
    this.cost = this.cost == null ? sample : this.cost + (sample - this.cost) * 0.25;
    this.samples++;
    if (this.pin) return false;
    if (this.samples < 4) return false;                       // let the first frames (compiles, caches) pass
    const budget = this.budgetMs;
    // down: the frames are too slow now. By how much decides how far: twice too slow, two steps.
    if (this.cost > budget && this.level > 0) {
      let steps = 1;
      while (this.level - steps > 0 && this.cost * this.work(this.level - steps) / this.work(this.level) > budget) steps++;
      this._move(this.level - steps, now, 8000);
      return true;
    }
    // up: only when the next level is predicted to fit with room to spare, and it has been calm for a while. Far below the budget, two steps at a time.
    if (this.level < this.ladder.length - 1) {
      const fits = (l) => this.cost * this.work(l) / this.work(this.level) < budget * 0.85;
      if (fits(this.level + 1) && now >= this.blockedUntil) {
        if (!this.stableSince) this.stableSince = now;
        if (now - this.stableSince >= 2000) { this._move(this.level + (this.level + 2 < this.ladder.length && fits(this.level + 2) ? 2 : 1), now, 0); return true; }
      } else this.stableSince = 0;
    }
    return false;
  }

  _move(level, now, block) {
    this.level = level; this.changes++;
    this.cost = null; this.samples = 0; this.stableSince = 0;
    this.blockedUntil = block ? now + block : this.blockedUntil;
  }
}
