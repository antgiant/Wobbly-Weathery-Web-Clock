// Countdown mode: the digits show days:hours:minutes:seconds to a date, never more than 6 digits on screen with the seconds
// shown or 4 with them hidden; everything else (sky, settings) works as before.
export const name = 'countdown';
export const tier = 'fast';          // part of the quick check (npm test); the suite does only its core when t.quick is set

const NOW = 't=2026-06-21T12:00:00Z&speed=0';
const state = (page) => page.evaluate(() => {
  const vis = [...document.querySelectorAll('#clock svg')].filter((e) => getComputedStyle(e).display !== 'none');
  const digs = vis.filter((e) => e.querySelector('path[id]'));
  const r = digs.map((e) => e.getBoundingClientRect());
  const pill = document.getElementById('timerPill');
  return { title: document.title, digits: digs.length, svgs: vis.length, pill: pill.hidden ? null : pill.textContent, left: Math.min(...r.map((a) => a.left)), right: Math.max(...r.map((a) => a.right)), vw: innerWidth, w: Math.max(...r.map((a) => a.width)) };
});
const open = (t, target, conf = {}, o = {}) => t.open({ query: NOW, timezone: 'UTC', width: 393, height: 852, ...o, conf: { clockStyle: 'solid', clockMode: 'countdown', timerTarget: target, ...conf } });

export async function run(t) {
  // 3 days 4 h 5 min 6 s to go, seconds shown: days:hours:minutes, 5 digits
  let h = await open(t, '2026-06-24T16:05:06', { timerLabel: 'Launch' });
  await h.settle(1200);
  let s = await state(h.page);
  t.check('a day or more, seconds shown: days:hours:minutes (3:04:05), five digits, named in the tab', s.title === 'Launch 3:04:05' && s.digits === 5, JSON.stringify(s));
  t.check('the caption names the name and the units', s.pill === 'Launch · days:hours:minutes', String(s.pill));
  t.check('upright phone: the digits fit across the screen', s.left > -s.vw * 0.05 && s.right < s.vw * 1.05, `${Math.round(s.left)}..${Math.round(s.right)} of ${s.vw}`);
  t.check('the sky is drawn as usual (frames are running, no errors)', await h.page.evaluate(() => window.__frames > 0) && h.errors.length === 0, h.errors.join(' | '));
  await h.close();

  // under a day, seconds hidden: hours:minutes, 3 digits
  h = await open(t, '2026-06-21T17:04:03', { hideSeconds: true });
  await h.settle(900);
  s = await state(h.page);
  t.check('under a day, seconds hidden: hours:minutes (5:04), three digits, no more than 4', s.title === '5:04' && s.digits === 3 && s.digits <= 4, JSON.stringify(s));
  await h.close();

  // 123 days: the hundreds digit shows; seconds hidden: just the days
  h = await open(t, '2026-10-22T17:00:00');
  await h.settle(900);
  s = await state(h.page);
  t.check('100 days or more, seconds shown: days:hours (123:05), five digits, the hundreds digit drawn first', s.title === '123:05' && s.digits === 5, JSON.stringify(s));
  const order = await h.page.evaluate(() => { const hd = document.getElementById('hundredsDigit').getBoundingClientRect(), fd = document.getElementById('firstDigit').getBoundingClientRect(); return hd.left < fd.left && hd.width > 5; });
  t.check('the hundreds digit sits to the left of the others', order);
  await h.close();

  h = await open(t, '2026-10-22T17:00:00', { hideSeconds: true });
  await h.settle(900);
  s = await state(h.page);
  t.check('100 days or more, seconds hidden: just the days (123), three digits, no colon, no more than 4', s.title === '123' && s.digits === 3 && s.svgs === 3, JSON.stringify(s));
  await h.close();

  // it ticks: one second later the last unit has changed
  h = await t.open({ query: 't=2026-06-21T12:00:00Z&speed=1', timezone: 'UTC', width: 393, height: 852, conf: { clockStyle: 'solid', clockMode: 'countdown', timerTarget: '2026-06-21T12:05:00', twentyFourHourClock: true } });
  const t0 = await h.page.evaluate(() => document.title);
  await h.page.waitForTimeout(2300);
  const t1 = await h.page.evaluate(() => document.title);
  t.check('it counts down in real time (seconds shown, under a day: 0:04:5x then lower)', /^0:04:5\d$/.test(t0) && t0 !== t1 && /^0:04:\d\d$/.test(t1), `${t0} -> ${t1}`);
  await h.close();

  if (t.quick) return;                                              // the quick check stops here

  // a target in the past: zeros and "now"
  h = await open(t, '2026-06-20T08:00:00', { timerLabel: 'Done' });
  await h.settle(900);
  s = await state(h.page);
  t.check('a date that has passed shows zeros and the caption says "now"', s.title === 'Done 0:00:00' && s.pill === 'Done · now', JSON.stringify(s));
  await h.close();

  // switching in the settings: a new countdown starts at the next midnight, and Time brings the clock back
  h = await t.open({ query: NOW, timezone: 'UTC', width: 393, height: 852, conf: { clockStyle: 'solid', twentyFourHourClock: true } });
  await h.page.evaluate(() => document.getElementById('settings').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await h.page.waitForTimeout(300);
  await h.page.click('.tab[data-tab="clock"]');
  t.check('the date and name fields are hidden while the digits show the time', await h.page.evaluate(() => document.getElementById('timerFields').hidden));
  await h.page.evaluate(() => { const e = document.getElementById('clockMode'); e.value = 'countdown'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await h.page.waitForTimeout(1500);
  s = await state(h.page);
  const target = await h.page.evaluate(() => document.getElementById('timerTarget').value);
  t.check('choosing a countdown starts one at the next midnight (12:00 to 00:00 is 12 hours)', /^2026-06-22T00:00$/.test(target) && /^12:00:0\d$|^11:59:5\d$/.test(s.title), `${target} ${s.title}`);
  await h.page.evaluate(() => { const e = document.getElementById('timerTarget'); e.value = '2026-06-21T14:30'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await h.page.waitForTimeout(1300);
  t.check('changing the date changes the digits at once (2 h 30 min)', /^2:29:5\d$|^2:30:0\d$/.test((await state(h.page)).title), (await state(h.page)).title);
  await h.page.evaluate(() => { const e = document.getElementById('clockMode'); e.value = 'time'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await h.page.waitForTimeout(1300);
  s = await state(h.page);
  t.check('choosing The time brings the clock back (12:00:00, six digits, caption gone)', /^12:00:0\d$|^12:00:\d\d$/.test(s.title) && s.digits === 6 && s.pill === null, JSON.stringify(s));
  t.check('no errors', h.errors.length === 0, h.errors.join(' | '));
  await h.close();
}
