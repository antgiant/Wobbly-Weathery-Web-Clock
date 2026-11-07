// The clock: 12 / 24 hour by locale until chosen, seconds, and the digits themselves.
export const name = 'clock';
export const covers = '12/24-hour by locale, seconds hidden, digit curves, upright-phone layout, time really runs';
export const tier = 'fast';          // part of the quick check (npm test); the suite does only its core when t.quick is set

export async function run(t) {
  // 17:00 UTC = 13:00 in New York
  const q = 't=2026-06-21T17:00:00Z&speed=0';
  let h = await t.open({ query: q, locale: 'en-US' });
  t.check('en-US browser, nothing chosen: 12-hour clock (1:00:00)', (await h.page.title()) === '1:00:00', await h.page.title());
  t.check('the 24-hour switch shows what is in effect (off)', (await h.page.evaluate(() => document.getElementById('twentyFourHourClock').checked)) === false);
  t.check('12-hour: the leading digit is hidden for 1:00', await h.page.evaluate(() => getComputedStyle(document.getElementById('firstDigit')).display === 'none'));
  await h.close();

  h = await t.open({ query: q, locale: 'en-GB' });
  t.check('en-GB browser, nothing chosen: 24-hour clock (13:00:00)', (await h.page.title()) === '13:00:00', await h.page.title());
  await h.close();
  // upright phone, seconds hidden (one colon, not two): the digits must fit the screen, with and without a leading hour digit
  for (const [label, when] of [['10:55 (four digits)', '2026-06-21T22:55:00Z'], ['5:55 (three digits)', '2026-06-21T17:55:00Z']]) {
    h = await t.open({ query: `t=${when}&speed=0`, timezone: 'UTC', width: 393, height: 852, conf: { hideSeconds: true, twentyFourHourClock: false, clockStyle: 'solid' } });
    const m = await h.page.evaluate(() => { const r = [...document.querySelectorAll('#clock svg')].filter((e) => getComputedStyle(e).display !== 'none' && e.querySelector('path[id]')).map((e) => e.getBoundingClientRect()); return { n: r.length, w: Math.max(...r.map((a) => a.width)), left: Math.min(...r.map((a) => a.left)), right: Math.max(...r.map((a) => a.right)), vw: innerWidth }; });
    t.check(`upright phone, seconds hidden, ${label}: every digit box is under 40% of the screen (it was 57%, the digits spilled off both sides)`, m.w < m.vw * 0.4, JSON.stringify(m));
    t.check(`upright phone, seconds hidden, ${label}: the digits fit across the screen (within 5%)`, m.left > -m.vw * 0.05 && m.right < m.vw * 1.05, JSON.stringify(m));
    await h.close();
  }
  if (t.quick) return;                                              // the quick check stops here: the rest is in the full run

  h = await t.open({ query: q, locale: 'en-US', conf: { twentyFourHourClock: true } });
  t.check('an explicit 24-hour choice wins over the browser locale', (await h.page.title()) === '13:00:00', await h.page.title());
  await h.close();

  h = await t.open({ query: q, conf: { twentyFourHourClock: true, hideSeconds: true } });
  t.check('seconds hidden: the title has no seconds', (await h.page.title()) === '13:00', await h.page.title());
  const shown = await h.page.evaluate(() => [...document.querySelectorAll('#clock .seconds')].map((e) => getComputedStyle(e).display));
  t.check('seconds hidden: the seconds digits and colon are not displayed', shown.length >= 3 && shown.every((d) => d === 'none'), shown.join());
  await h.close();

  // time runs: start ten seconds before a minute turns and watch the minute digit change shape (however long the page took to load)
  h = await t.open({ query: 't=2026-06-21T17:00:50Z&speed=1', conf: { twentyFourHourClock: true, clockStyle: 'solid' } });
  const read = () => h.page.evaluate(() => ({ title: document.title, d: ['m1p0', 'm1p1', 'm1p2', 'm1p3'].map((i) => document.getElementById(i).getAttribute('d')).join('|') }));
  const first = await read();
  let later = first;
  for (let i = 0; i < 100 && later.title.slice(0, 5) === first.title.slice(0, 5); i++) { await h.page.waitForTimeout(250); later = await read(); }
  await h.page.waitForTimeout(1500);
  later = await read();
  t.check('time runs: the minute turned over while watching', later.title.slice(0, 5) !== first.title.slice(0, 5), `${first.title} -> ${later.title}`);
  t.check('and the minute digit changed shape with it', later.d !== first.d);
  // seven digit slots (the hundreds-of-days digit of countdown mode, then hours, minutes, seconds), four curves each; the hundreds digit stays hidden while the clock shows the time
  t.check('each digit is drawn with four curves (7 digit slots x 4), and the countdown-only hundreds digit is hidden', await h.page.evaluate(() => document.querySelectorAll('#clock svg path[id]').length === 28 && document.getElementById('hundredsDigit').classList.contains('hidden') && getComputedStyle(document.getElementById('hundredsDigit')).display === 'none'));
  await h.close();

  // the digits are in the middle of the screen: the ink of the row (the paths' own boxes) is within 1.2% of the width of the middle, with the leading digit hidden or shown, seconds or not (it sat 1 to 4% left)
  for (const [label, qq, conf] of [['2:33, no seconds', 't=2026-11-07T07:33:30Z&speed=0', { hideSeconds: true }], ['2:33, seconds', 't=2026-11-07T07:33:30Z&speed=0', {}], ['12:33, no seconds', 't=2026-11-07T17:33:30Z&speed=0', { hideSeconds: true }], ['12:33, seconds', 't=2026-11-07T17:33:30Z&speed=0', {}], ['02:33 (24-hour), no seconds', 't=2026-11-07T07:33:30Z&speed=0', { hideSeconds: true, twentyFourHourClock: true }]]) {
    if (!/^2:33, no/.test(label) && !/^12:33, seconds/.test(label)) continue;       // (two pages are enough here: the unit test and the clocklayout suite cover the rest of the layouts)
    const hh = await t.open({ fast: true, query: qq, width: 1280, height: 720, conf });
    await hh.settle(500);
    const r = await hh.page.evaluate(() => { let l = Infinity, rr = -Infinity; document.querySelectorAll('#clock svg').forEach((el) => { if (getComputedStyle(el).display === 'none') return; el.querySelectorAll('path').forEach((p) => { const b = p.getBoundingClientRect(); if (b.width) { l = Math.min(l, b.left); rr = Math.max(rr, b.right); } }); }); return { c: (l + rr) / 2, vw: innerWidth }; });
    t.check(`the digits are in the middle of the screen (${label})`, Math.abs(r.c - r.vw / 2) / r.vw < 0.012, `centre ${Math.round(r.c)} of ${r.vw}`);
    await hh.close();
  }
}
