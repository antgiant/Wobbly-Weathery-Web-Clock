// The clock: 12 / 24 hour by locale until chosen, seconds, and the digits themselves.
export const name = 'clock';

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

  h = await t.open({ query: q, locale: 'en-US', conf: { twentyFourHourClock: true } });
  t.check('an explicit 24-hour choice wins over the browser locale', (await h.page.title()) === '13:00:00', await h.page.title());
  await h.close();

  h = await t.open({ query: q, conf: { twentyFourHourClock: true, hideSeconds: true } });
  t.check('seconds hidden: the title has no seconds', (await h.page.title()) === '13:00', await h.page.title());
  const shown = await h.page.evaluate(() => [...document.querySelectorAll('#clock .seconds')].map((e) => getComputedStyle(e).display));
  t.check('seconds hidden: the seconds digits and colon are not displayed', shown.length >= 3 && shown.every((d) => d === 'none'), shown.join());
  await h.close();

  // the digits morph: a minute later the shapes differ, and the clock runs in real time with no pinned time
  h = await t.open({ query: 't=2026-06-21T17:00:58Z&speed=1', conf: { twentyFourHourClock: true, clockStyle: 'solid' } });
  const before = await h.page.evaluate(() => ['m1p0', 'm1p1', 'm1p2', 'm1p3'].map((i) => document.getElementById(i).getAttribute('d')).join('|'));
  await h.page.waitForTimeout(3300);
  const after = await h.page.evaluate(() => ['m1p0', 'm1p1', 'm1p2', 'm1p3'].map((i) => document.getElementById(i).getAttribute('d')).join('|'));
  const title = await h.page.title();
  t.check('time runs: the minute digit changed shape after the minute turned', before !== after && /^13:01/.test(title), `${title}`);
  t.check('each digit is drawn with four curves', await h.page.evaluate(() => document.querySelectorAll('#clock svg path[id]').length === 24));
  await h.close();
}
