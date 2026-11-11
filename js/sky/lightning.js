// Lightning: when it strikes and how the sky flashes. Pure logic (no GL, no DOM); the engine asks `update(nowSeconds, rate)` every frame it draws and
// hands the answer to the shaders (uFlash lifts the whole picture, uBolt draws a jagged bolt for the first strike of a flash).
//
// rate 0..1 is how active the storm is (js/sky/weather.js `lightning`): 0 none, about 0.5 a strike every 15 s, 1 a strike every 5 s. Strikes are random (a
// Poisson process with a floor: never closer than 3 s together).
//
// Safety: a flash is one bright pulse and, 0.38 s later, one weaker one, never more than two in a second and never a second flash within 3 s. That is well inside
// the guideline of at most three flashes in any second (WCAG 2.3.1), so the clock is safe to leave on for people sensitive to flashing. The engine also draws none
// at all when the page asks for reduced motion.

export const MIN_GAP = 3;                  // seconds between strikes, at the very least
export const FLASH_LENGTH = 0.9;           // seconds a flash lasts, all of it

/** Seconds until the next strike for a storm of this activity (rand in [0, 1)): the mean is 25 s at rate 0.2 down to 5 s at rate 1, never under MIN_GAP. */
export function nextGap(rate, rand) {
  const mean = 5 + 20 * Math.pow(1 - Math.min(1, Math.max(0, rate)), 2.2) * 1.25;
  return MIN_GAP + (-Math.log(1 - rand * 0.9999)) * Math.max(0.5, mean - MIN_GAP);
}

/** The brightness of the sky `dt` seconds after a strike, 0..1: a sharp rise and fall at once, a weaker second pulse at 0.38 s, then dark. */
export function envelope(dt) {
  if (dt < 0 || dt > FLASH_LENGTH) return 0;
  const pulse = (t0, rise, fall, peak) => { const x = dt - t0; return x < 0 ? 0 : x < rise ? peak * (x / rise) : peak * Math.exp(-(x - rise) / fall); };
  const e = Math.max(pulse(0, 0.025, 0.09, 1), pulse(0.38, 0.03, 0.08, 0.55)) * (dt > 0.7 ? Math.max(0, (FLASH_LENGTH - dt) / (FLASH_LENGTH - 0.7)) : 1);
  return Math.min(1, e);
}

function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class Lightning {
  constructor(seed = 1) { this.rand = rng(seed); this.next = null; this.last = -1e9; this.bolt = { x: 0.5, seed: 1, bottom: 0.4 }; }
  /**
   * @param {number} now   seconds (any steady clock)
   * @param {number} rate  0..1 (0 = none)
   * @returns {{flash:number, bolt:null|{x:number, seed:number, bottom:number, a:number}}} flash 0..1; bolt: where it is on the screen (x 0..1 across, bottom: how low it reaches, 0..1 up from the bottom) while the first pulse lasts
   */
  update(now, rate) {
    if (!(rate > 0.01)) { this.next = null; return { flash: 0, bolt: null }; }
    if (this.next == null) this.next = now + MIN_GAP + this.rand() * nextGap(rate, this.rand());       // the first strike is not at once
    if (now >= this.next) {
      this.last = this.next; this.next = this.last + nextGap(rate, this.rand());
      this.bolt = { x: 0.1 + 0.8 * this.rand(), seed: Math.floor(this.rand() * 1000) + 1, bottom: 0.3 + 0.25 * this.rand() };
    }
    const dt = now - this.last, flash = envelope(dt) * (0.55 + 0.45 * Math.min(1, rate * 1.3));
    const a = dt >= 0 && dt < 0.2 ? Math.exp(-dt / 0.07) : 0;                       // the bolt itself is brief
    return { flash, bolt: a > 0.02 ? { ...this.bolt, a } : null };
  }
}
