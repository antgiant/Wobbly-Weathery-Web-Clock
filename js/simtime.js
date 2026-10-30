// One shared notion of "now", so the clock digits and the sky stay in sync when
// the user time-travels (or when a test pins the time).
let sim = null;

/** @param {null | {base: Date, startPerf: number, scale: number}} s */
export function setSim(s) { sim = s; }
export function getSim() { return sim; }

export function now() {
  if (!sim) return new Date();
  return new Date(sim.base.getTime() + (performance.now() - sim.startPerf) * sim.scale);
}
