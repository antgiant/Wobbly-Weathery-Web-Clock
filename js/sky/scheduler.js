// One timer for all the periodic work of the page.
//
// The page used to run eleven setIntervals (colour sampling, favicon, labels, countdown, history, rain, tree, follow,
// ...), most of them waking the phone several times a second even when there was nothing to do. Now every job is
// registered here with a period that can be a function, and returns Infinity (or 0) while the job has nothing to do
// (labels off, no countdown, rain alert off, ...). One setTimeout sleeps until the next job is due; it is capped
// at 5 s so a changed setting is noticed, and it does not run at all while the page is hidden.

const jobs = [];
let timer = 0;
const CAP_MS = 5000;

const periodOf = (j) => (typeof j.period === 'function' ? j.period() : j.period);
const active = (p) => Number.isFinite(p) && p > 0;

function arm() {
  clearTimeout(timer);
  timer = 0;
  if (document.hidden || !jobs.length) return;
  const t = performance.now();
  let wait = CAP_MS;
  for (const j of jobs) {
    const p = periodOf(j);
    if (active(p)) wait = Math.min(wait, j.last + p - t);
  }
  timer = setTimeout(run, Math.max(50, wait));
}

function run() {
  timer = 0;
  const t = performance.now();
  for (const j of jobs) {
    const p = periodOf(j);
    if (!active(p) || t - j.last < p - 5) continue;
    j.last = t;
    try {
      const r = j.fn();
      if (r && typeof r.catch === 'function') r.catch((e) => console.warn('[sky] job', j.name, e));
    } catch (e) { console.warn('[sky] job', j.name, e); }
  }
  arm();
}

/**
 * @param {string} name
 * @param {() => any} fn
 * @param {number | (() => number)} period  ms between runs; a function is asked every time (Infinity = nothing to do now)
 * @param {number} [first]  ms until the first run (default: one period)
 */
export function every(name, fn, period, first) {
  const p = typeof period === 'function' ? period() : period;
  const f = first ?? (active(p) ? p : 0);
  jobs.push({ name, fn, period, last: performance.now() - (active(p) ? p : 0) + f });
  arm();
}

/** Run a job now (a setting changed and its period just went from "never" to something). */
export function poke(name) {
  const j = jobs.find((x) => x.name === name);
  if (j) { j.last = -Infinity; clearTimeout(timer); timer = setTimeout(run, 0); }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(timer); timer = 0; }
  else run();                                         // catch up on whatever came due while hidden
});
