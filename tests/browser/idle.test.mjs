// Power: a still sky should leave the phone alone. Counts timer callbacks and animation frames while nothing happens.
export const name = 'idle';
export const covers = 'Power: wake-ups per second with a still sky, seconds hidden/shown, hidden tab';

const count = () => {
  window.__w = { t: 0, i: 0, r: 0 };
  const st = window.setTimeout, si = window.setInterval, raf = window.requestAnimationFrame;
  window.setTimeout = (f, d, ...a) => st(() => { window.__w.t++; f(...a); }, d);
  window.setInterval = (f, d, ...a) => si(() => { window.__w.i++; f(...a); }, d);
  window.requestAnimationFrame = (f) => raf((x) => { window.__w.r++; f(x); });
};

async function wakeups(t, conf, seconds = 8) {
  const h = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0', conf, init: count, width: 400, height: 700 });
  await h.page.waitForTimeout(4000);                                        // startup work done
  await h.page.evaluate(() => { window.__w = { t: 0, i: 0, r: 0 }; });
  await h.page.waitForTimeout(seconds * 1000);
  const w = await h.page.evaluate(() => window.__w);
  await h.close();
  return { ...w, perSecond: (w.t + w.i + w.r) / seconds };
}

export async function run(t) {
  const still = await wakeups(t, { clockStyle: 'solid', hideSeconds: true, cloudMotion: 0, weatherMode: 'clear', plants: false });
  t.check('a still sky with the seconds hidden wakes the page under 20 times a second (it was about 80 before the single scheduler)', still.perSecond < 20, `${still.perSecond.toFixed(1)} per second (timeouts ${still.t}, intervals ${still.i}, frames ${still.r})`);
  t.check('and there are no setInterval callbacks at all (the page uses one scheduler)', still.i === 0, `intervals ${still.i}`);
  const seconds = await wakeups(t, { clockStyle: 'solid', hideSeconds: false, cloudMotion: 0, weatherMode: 'clear', plants: false });
  t.check('with the seconds shown it ticks only as fast as the digits move (under 45 a second)', seconds.perSecond < 45, `${seconds.perSecond.toFixed(1)} per second`);
  t.check('hiding the seconds really saves wake-ups', still.perSecond < seconds.perSecond * 0.85, `${still.perSecond.toFixed(1)} vs ${seconds.perSecond.toFixed(1)}`);
  const hidden = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0', conf: { clockStyle: 'solid' }, init: count });
  await hidden.page.waitForTimeout(3000);
  await hidden.page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await hidden.page.waitForTimeout(1200);
  await hidden.page.evaluate(() => { window.__w = { t: 0, i: 0, r: 0 }; });
  await hidden.page.waitForTimeout(4000);
  const hw = await hidden.page.evaluate(() => window.__w);
  t.check('a hidden page does (almost) nothing: under 3 wake-ups in 4 seconds', hw.t + hw.i + hw.r <= 3, JSON.stringify(hw));
  await hidden.close();

  // the glass clock with the seconds hidden: the light timer and the layout events used to redraw the glass twice a second for nothing (the same digits in the same place)
  const gl = await t.open({ query: 'speed=1', conf: { clockStyle: 'glass', hideSeconds: true, cloudMotion: 0, weatherMode: 'clear', plants: false }, width: 800, height: 450 });
  await gl.ready(); await gl.page.waitForTimeout(3000);
  const redraws = await gl.page.evaluate(() => new Promise((res) => { const e = window.__sky, c = { glass: 0, renders: 0 }, g = e.redrawGlass.bind(e), r = e.render.bind(e); e.redrawGlass = (...a) => { c.glass++; return g(...a); }; e.render = (...a) => { c.renders++; return r(...a); }; setTimeout(() => res(c), 6000); }));
  t.check('a still glass clock with the seconds hidden redraws only its glass about as often as it redraws the sky (not twice as often)', redraws.glass <= redraws.renders + 2, JSON.stringify(redraws));
  await gl.close();
}
