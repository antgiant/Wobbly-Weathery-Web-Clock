// Things that build up while the weather makes them and fade when it stops: the sheet of ice on the ground and the digits while freezing rain falls and the sand drifted by a
// dust storm. A level 0..1 that rises at its own rate towards 1 while the weather makes it and falls at its own rate towards 0 when it does not. Pure; the engine steps it each frame.

export class Accumulator {
  /** @param {{rise:number, fall:number, start?:number}} o  rise / fall: how much of the whole it gains / loses a second; start: the level when the weather is first seen going (the page has just opened: it has been going a while) */
  constructor({ rise, fall, start = 0.6 }) { this.rise = rise; this.fall = fall; this.start = start; this.level = 0; this.seen = false; }
  /** Move on `dtSec` seconds with the weather making `amount` (0 none .. 1 full) of it. Returns the level. */
  step(amount, dtSec) {
    const dt = Math.min(Math.max(dtSec || 0, 0), 600);                          // a long gap (a sleeping tab) counts as ten minutes at most
    const a = Math.min(1, Math.max(0, amount || 0));
    if (!this.seen && a > 0.05) { this.seen = true; this.level = Math.max(this.level, this.start * a); }
    if (a > 0.02) this.level = Math.min(a, this.level + this.rise * a * dt);            // it rises towards what the weather can make, never above it
    else this.level = Math.max(0, this.level - this.fall * dt);
    if (this.level < 0.002) { this.level = 0; if (a <= 0.02) this.seen = false; }
    return this.level;
  }
}
