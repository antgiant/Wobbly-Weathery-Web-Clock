// The page starts, draws the sky and the clock, and says nothing is wrong.
export const name = 'smoke';

export async function run(t) {
  const h = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0', conf: { clockStyle: 'glass' } });
  await h.settle(1500);
  const s = await h.page.evaluate(() => ({
    frames: window.__frames, ready: document.body.classList.contains('ready'), loading: !!document.getElementById('loading'),
    canvas: [document.getElementById('sky').width, document.getElementById('sky').height], title: document.title,
    webgl: !!window.__sky && !!window.__sky.gl, firstPath: document.getElementById('h0p0') && document.getElementById('h0p0').getAttribute('d'),
    marks: performance.getEntriesByType('mark').map((m) => m.name),
  }));
  t.check('the page reaches "ready" and draws frames', s.ready && s.frames >= 1, `frames=${s.frames}`);
  t.check('the loading screen is removed once ready', s.loading === false);
  t.check('WebGL2 is running (not the no-WebGL fallback)', s.webgl && !(await h.page.evaluate(() => document.body.classList.contains('no-webgl'))));
  t.check('the canvas fills the screen', s.canvas[0] === 420 && s.canvas[1] === 800, JSON.stringify(s.canvas));
  t.check('the tab title is the time (12-hour clock in an en-US browser)', /^\d{1,2}:\d{2}:\d{2}$/.test(s.title), s.title);
  t.check('the digits are drawn, not the crossed lines they start as', s.firstPath && !/M 0 0 L 400 500/.test(s.firstPath), s.firstPath);
  t.check('the startup timeline marks exist (for ?perf)', ['app:init', 'sky:first-render-end', 'app:ready'].every((m) => s.marks.includes(m)));
  t.check('no script errors, no failed requests for the app\'s own files', h.errors.length === 0 && h.failed.length === 0, [...h.errors, ...h.failed].join(' | '));
  const buf = await h.shot('smoke');
  const sd = await t.analyze(h.page, buf, ({ mean, w, h }) => { const m = mean(0, 0, w, h); const top = mean(0, 0, w, h * 0.2); const low = mean(0, h * 0.8, w, h * 0.2); return { lum: m.lum, top: top.lum, low: low.lum }; });
  t.check('the picture is not blank, and a daytime sky is bright', sd.top > 0.35, JSON.stringify(sd));
  await h.close();

  // while loading, the digits must not show (they start as crossed lines) and the loading screen is up
  const l = await t.open({ query: 't=2026-06-21T17:00:00Z', load: false });
  await l.ctx.route('**/js/index.js', (r) => r.abort());
  await l.page.goto(l.url).catch(() => {});
  await l.page.waitForTimeout(400);
  const ls = await l.page.evaluate(() => ({ clock: getComputedStyle(document.getElementById('clock')).visibility, loading: getComputedStyle(document.getElementById('loading')).display, ready: document.body.classList.contains('ready') }));
  t.check('before the first frame: loading screen up, digits hidden', ls.ready === false && ls.loading !== 'none' && ls.clock === 'hidden', JSON.stringify(ls));
  await l.close();
}
