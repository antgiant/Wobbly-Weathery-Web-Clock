// The sky is physically sensible: day is bright and blue, night is dark, twilight is warm at the horizon, weather changes it.
export const name = 'sky';

async function sky(t, query, conf = {}) {
  const h = await t.open({ query: query + '&az=180&pitch=8', conf: { clockStyle: 'solid', ...conf }, width: 400, height: 500 });
  await h.settle(800);
  const buf = await h.shot();
  const r = await t.analyze(h.page, buf, ({ mean, w, h }) => ({ top: mean(0, 0, w, h * 0.15), horizon: mean(0, h * 0.5, w, h * 0.08), low: mean(0, h * 0.85, w, h * 0.15) }));
  const state = await h.page.evaluate(() => ({ alt: window.__sky.sky.sun.alt, weather: window.__sky.s.weather.cover, label: window.__sky.s.weather.label }));
  await h.close();
  return { ...r, ...state };
}

export async function run(t) {
  const noon = await sky(t, 't=2026-06-21T16:00:00Z&speed=0');
  const night = await sky(t, 't=2026-06-21T06:00:00Z&speed=0');
  const dusk = await sky(t, 't=2026-06-22T00:50:00Z&speed=0');
  t.check('noon: the sun is high and the sky is bright', noon.alt > 50 && noon.top.lum > 0.35, `alt ${noon.alt.toFixed(0)} lum ${noon.top.lum.toFixed(2)}`);
  t.check('noon: the zenith is blue (more blue than red)', noon.top.b > noon.top.r + 20, JSON.stringify([noon.top.r, noon.top.b].map(Math.round)));
  t.check('night: the sun is well down and the sky is dark', night.alt < -15 && night.top.lum < 0.3, `alt ${night.alt.toFixed(0)} lum ${night.top.lum.toFixed(2)}`);
  t.check('night is much darker than noon', night.top.lum * 2 < noon.top.lum);
  t.check('dusk: the sun just below the horizon', dusk.alt < 0 && dusk.alt > -12, `alt ${dusk.alt.toFixed(1)}`);
  t.check('dusk: the horizon is lighter and warmer than the zenith', dusk.horizon.lum > dusk.top.lum && dusk.horizon.r / dusk.horizon.b > dusk.top.r / dusk.top.b, JSON.stringify({ hz: dusk.horizon.r / dusk.horizon.b, top: dusk.top.r / dusk.top.b }));

  const clear = await sky(t, 't=2026-06-21T16:00:00Z&speed=0&weather=clear');
  const storm = await sky(t, 't=2026-06-21T16:00:00Z&speed=0&weather=storm');
  t.check('a storm preset is applied (heavy cloud cover)', storm.weather.every((c) => c > 0.6) && clear.weather.every((c) => c < 0.05), `${storm.weather} vs ${clear.weather}`);
  const sat = (m) => (Math.max(m.r, m.g, m.b) - Math.min(m.r, m.g, m.b)) / Math.max(m.r, m.g, m.b, 1);
  t.check('a stormy noon is a grey, washed-out sky; a clear one is a saturated blue', sat(storm.top) < sat(clear.top) * 0.7, `${sat(storm.top).toFixed(2)} vs ${sat(clear.top).toFixed(2)}`);

  // the sun, moon and planets are where the almanac says: labels agree with the engine's own positions
  const h = await t.open({ query: 't=2026-06-21T16:00:00Z&speed=0', conf: { showLabels: true, clockStyle: 'solid' } });
  await h.settle(1000);
  const labels = await h.page.evaluate(() => [...document.querySelectorAll('#hud .lbl')].map((e) => e.textContent));
  t.check('labels: the sun and moon are labelled', labels.some((l) => /Sun/.test(l)) && labels.some((l) => /Moon/.test(l)), labels.join(' | '));
  t.check('labels: a sun that is up is never "below horizon"', !labels.some((l) => /Sun.*below horizon/.test(l)));
  await h.close();
  const n = await t.open({ query: 't=2026-06-21T06:00:00Z&speed=0', conf: { showLabels: true, clockStyle: 'solid' } });
  await n.settle(1000);
  const hud = await n.page.evaluate(() => [...document.querySelectorAll('#hud .lbl')].map((e) => ({ t: e.textContent, top: e.getBoundingClientRect().top, h: innerHeight })));
  const sun = hud.find((l) => /Sun/.test(l.t));
  t.check('labels: at night the sun (below the horizon) is labelled as such and sits low on the screen, never high in the sky', !sun || (/below horizon/.test(sun.t) && sun.top > sun.h * 0.45), JSON.stringify(sun));
  await n.close();
}
