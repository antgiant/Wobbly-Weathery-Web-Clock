// Performance standards. Budgets are about 2.5 to 4 times what a slow machine with software WebGL measures, so they
// stay quiet about noise and speak up when something gets several times worse (a heavier first load, a blocked
// main thread, a leak, a render that no longer sleeps).
// Set PERF=print to list every measurement as well.
export const name = 'perf';

const BUDGET = {
  firstLoadKB: 900,          // everything the page downloads on a first visit (the astronomy library alone is 116 KB)
  firstLoadRequests: 60,
  readyMs: 12000,            // navigation start to the loading screen going away (software rendering, shaders compiled on the CPU)
  initMs: 1500,              // navigation start to the page's own code starting
  longestTaskMs: 1500,       // longest single block of main-thread work after the page is ready
  animatedFps: 18,           // an animated sky (clouds, water, plants) is capped at 15 pictures a second
  stillFps: 2,               // a truly still sky redraws about once a second: the render loop must sleep between pictures
  heapGrowthMB: 12,          // JS heap growth over 20 s of fast time travel (after a collection)
  morphTaskMs: 600,          // one frame of the digits morphing
};

const note = (label, v) => { if (process.env.PERF === 'print' || process.env.VERBOSE) console.log(`      perf ${label}: ${typeof v === 'number' ? Math.round(v * 100) / 100 : v}`); };

const observe = () => {
  window.__tasks = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__tasks.push({ s: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch (_) { /* no long-task support */ }
};

export async function run(t) {
  // ---- a first visit: what is downloaded, and how soon the page is real ----
  let bytes = 0, requests = 0;
  const h = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0', init: observe, load: false, conf: { clockStyle: 'auto', plants: true } });
  h.page.on('response', async (r) => {
    if (!r.url().startsWith(h.url.split('/?')[0])) return;
    requests++;
    try { bytes += (await r.body()).length; } catch (_) { /* redirected */ }
  });
  await h.page.goto(h.url);
  await h.ready(60000);
  await h.page.waitForTimeout(1500);
  const marks = await h.page.evaluate(() => Object.fromEntries(performance.getEntriesByType('mark').map((m) => [m.name, Math.round(m.startTime)])));
  note('marks', JSON.stringify(marks));
  note('first load KB', bytes / 1024); note('requests', requests);
  t.check(`first visit downloads under ${BUDGET.firstLoadKB} KB`, bytes / 1024 < BUDGET.firstLoadKB, `${(bytes / 1024).toFixed(0)} KB`);
  t.check(`first visit makes under ${BUDGET.firstLoadRequests} requests to the site`, requests < BUDGET.firstLoadRequests, `${requests}`);
  t.check(`the page's own code starts within ${BUDGET.initMs} ms`, marks['app:init'] != null && marks['app:init'] < BUDGET.initMs, `${marks['app:init']} ms`);
  t.check(`the loading screen goes within ${BUDGET.readyMs} ms of navigation`, marks['app:ready'] != null && marks['app:ready'] < BUDGET.readyMs, `${marks['app:ready']} ms`);
  t.check('the stages happen in order: init, shaders, first picture, loading screen gone', ['app:init', 'sky:programs-compiled', 'sky:first-render-end', 'app:ready'].every((k, i, a) => marks[k] != null && (i === 0 || marks[k] >= marks[a[i - 1]])), JSON.stringify(marks));

  // ---- the main thread afterwards: no long blocks, mostly asleep ----
  await h.page.evaluate(() => { window.__tasks = []; window.__t0 = performance.now(); window.__f0 = window.__frames; });
  await h.page.waitForTimeout(8000);
  const quiet = await h.page.evaluate(() => ({ tasks: window.__tasks, span: performance.now() - window.__t0, frames: window.__frames - window.__f0 }));
  const longest = Math.max(0, ...quiet.tasks.map((x) => x.d)), fps = quiet.frames / (quiet.span / 1000);
  note('longest task ms', longest); note('still frames per second', fps);
  t.check(`no single block of work over ${BUDGET.longestTaskMs} ms once the page is ready`, longest < BUDGET.longestTaskMs, `${longest.toFixed(0)} ms`);
  t.check(`an animated sky never draws more than ${BUDGET.animatedFps} pictures a second`, fps < BUDGET.animatedFps, `${fps.toFixed(2)} per second`);

  // ---- a digit morphing is one cheap frame, not a stall ----
  await h.page.evaluate(() => { window.__tasks = []; });
  await h.page.evaluate(() => window.__sky.set({ sim: { base: new Date('2026-06-21T17:00:57Z'), startPerf: performance.now(), scale: 1 } }));
  await h.page.waitForTimeout(6000);
  const morph = await h.page.evaluate(() => Math.max(0, ...window.__tasks.map((x) => x.d)));
  note('longest task over a minute turn ms', morph);
  t.check(`the minute turning never blocks the page for over ${BUDGET.morphTaskMs} ms`, morph < BUDGET.morphTaskMs, `${morph.toFixed(0)} ms`);
  t.check('and nothing went wrong along the way', h.errors.length === 0, h.errors.join(' | '));
  await h.close();

  // ---- a still sky sleeps ----
  const q = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0&landscape=hills', conf: { clockStyle: 'solid', hideSeconds: true, cloudMotion: 0, weatherMode: 'clear', plants: false } });
  await q.page.waitForTimeout(3000);
  const f0 = await q.page.evaluate(() => window.__frames);
  await q.page.waitForTimeout(8000);
  const stillFps = (await q.page.evaluate(() => window.__frames) - f0) / 8;
  note('still sky pictures per second', stillFps);
  t.check(`a still sky draws under ${BUDGET.stillFps} pictures a second`, stillFps < BUDGET.stillFps, `${stillFps.toFixed(2)} per second`);
  await q.close();

  // ---- memory: fast time travel for a while must not keep growing the heap ----
  const m = await t.open({ query: 't=2026-06-21T12:00:00Z&speed=600', conf: { clockStyle: 'solid' } });
  const heap = async () => {
    const cdp = await m.ctx.newCDPSession(m.page);
    await cdp.send('HeapProfiler.collectGarbage');
    const { usedSize } = await cdp.send('Runtime.getHeapUsage');
    await cdp.detach();
    return usedSize / 1048576;
  };
  await m.page.waitForTimeout(3000);
  const before = await heap();
  await m.page.waitForTimeout(20000);
  const after = await heap();
  note('heap MB', `${before.toFixed(1)} -> ${after.toFixed(1)}`);
  t.check(`20 s of fast time travel grows the heap by under ${BUDGET.heapGrowthMB} MB`, after - before < BUDGET.heapGrowthMB, `${before.toFixed(1)} -> ${after.toFixed(1)} MB`);
  await m.close();
}
