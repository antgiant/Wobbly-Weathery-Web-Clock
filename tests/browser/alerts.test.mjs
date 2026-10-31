// The countdown to sunset / sunrise and the optional umbrella alert, as page pills and as pixel art on the LED panel.
import { nextSunset, nextSunrise, at } from '../lib/astro.mjs';
export const name = 'alerts';

const pill = (page) => page.evaluate(() => { const e = document.getElementById('sunCountdown'); return e.hidden ? null : e.textContent.replace(/\s+/g, ' ').trim(); });
const rainPill = (page) => page.evaluate(() => { const e = document.getElementById('rainAlertPill'); return e.hidden ? null : { text: e.textContent.trim(), level: e.dataset.level }; });

export async function run(t) {
  const sunset = nextSunset('2026-06-21T12:00:00Z');
  const sunrise = nextSunrise('2026-06-22T00:00:00Z');

  // 4 min 30 s before sunset
  let h = await t.open({ query: `t=${at(sunset, -270e3)}&speed=0`, conf: { countdown: 'both', countdownLead: 20, clockStyle: 'solid' } });
  await h.settle(1500);
  let p = await pill(h.page);
  t.check('4.5 minutes before sunset the pill says "Sunset in 04:30"', p && /Sunset in\s*0?4:[23]\d/.test(p), String(p));
  t.check('the pill sits above the clock and does not cover the digits', await h.page.evaluate(() => { const d = [...document.querySelectorAll('#clock svg')].filter((e) => getComputedStyle(e).display !== 'none' && e.querySelector('path[id]')).map((e) => e.getBoundingClientRect()); return document.getElementById('sunCountdown').getBoundingClientRect().bottom <= Math.min(...d.map((r) => r.top)) + 8; }));
  await h.close();

  h = await t.open({ query: `t=${at(sunset, -25 * 60e3)}&speed=0`, conf: { countdown: 'both', countdownLead: 20, clockStyle: 'solid' } });
  await h.settle(1500);
  t.check('25 minutes before sunset (lead 20): no countdown yet', (await pill(h.page)) === null);
  await h.close();

  h = await t.open({ query: `t=${at(sunset, -10 * 60e3)}&speed=0`, conf: { countdown: 'both', countdownLead: 20, clockStyle: 'solid' } });
  await h.settle(1500);
  t.check('10 minutes before: counting down', /Sunset in\s*(10:0\d|09:5\d)/.test(String(await pill(h.page))), String(await pill(h.page)));
  await h.close();

  h = await t.open({ query: `t=${at(sunset, 20e3)}&speed=0`, conf: { countdown: 'both', clockStyle: 'solid' } });
  await h.settle(1500);
  p = await pill(h.page);
  t.check('20 seconds after sunset it says "Sunset" (no time)', p && /Sunset/.test(p) && !/ in\s*\d/.test(p), String(p));
  await h.close();

  h = await t.open({ query: `t=${at(sunset, -5 * 60e3)}&speed=0`, conf: { countdown: 'sunrise', clockStyle: 'solid' } });
  await h.settle(1500);
  t.check('"sunrise only" shows nothing before a sunset', (await pill(h.page)) === null);
  await h.close();

  h = await t.open({ query: `t=${at(sunrise, -8 * 60e3)}&speed=0`, conf: { countdown: 'both', clockStyle: 'solid' } });
  await h.settle(1500);
  p = await pill(h.page);
  t.check('before sunrise: "Sunrise in 08:00"', p && /Sunrise in\s*0?[78]:\d\d/.test(p), String(p));
  await h.close();

  h = await t.open({ query: `t=${at(sunset, -5 * 60e3)}&speed=0`, conf: { countdown: 'off', clockStyle: 'solid' } });
  await h.settle(1500);
  t.check('countdown off: nothing', (await pill(h.page)) === null);
  await h.close();

  // the umbrella: off by default, on when asked, follows the mocked afternoon shower (3-6 pm UTC)
  h = await t.open({ query: 't=2026-06-21T12:00:00Z&speed=0', conf: { weatherMode: 'live', clockStyle: 'solid' } });
  await h.settle(3500);
  t.check('umbrella alert is off by default (no pill, no forecast requested)', (await rainPill(h.page)) === null && !h.net.calls.some((u) => u.includes('precipitation_probability')));
  await h.close();

  const noonLive = { fixedTime: '2026-06-21T12:00:00Z', conf: { weatherMode: 'live', rainAlert: true, clockStyle: 'solid', twentyFourHourClock: true } };
  h = await t.open(noonLive);
  await h.settle(4500);
  const rp = await rainPill(h.page);
  t.check('live weather + a forecast shower (15-18 UTC): an umbrella pill that says when, in the viewer\'s own time (11:00 to 14:00 in New York)', rp && rp.level === 'umbrella' && /Umbrella: rain, 11:00 to 14:00/.test(rp.text), JSON.stringify(rp));
  t.check('the settings panel says the same', /Umbrella/.test(await h.page.evaluate(() => document.getElementById('rainStatus').textContent)));
  await h.close();

  const heavy = await t.open({ ...noonLive, load: false });
  heavy.net.rainHours = (hr) => (hr === 15 ? 4 : 0);
  await heavy.page.goto(heavy.url); await heavy.ready(); await heavy.settle(4500);
  t.check('one downpour hour (4 mm) is a slicker, not an umbrella', (await rainPill(heavy.page)) && (await rainPill(heavy.page)).level === 'slicker', JSON.stringify(await rainPill(heavy.page)));
  await heavy.close();

  const dry = await t.open({ ...noonLive, load: false });
  dry.net.rainHours = () => 0.02;
  await dry.page.goto(dry.url); await dry.ready(); await dry.settle(4500);
  t.check('a dry day (drizzle under 0.2 mm an hour): no alert', (await rainPill(dry.page)) === null);
  await dry.close();

  h = await t.open({ query: 't=2026-06-21T12:00:00Z&speed=0', conf: { weatherMode: 'clear', rainAlert: true, clockStyle: 'solid' } });
  await h.settle(3500);
  t.check('with a manual clear sky there is no alert', (await rainPill(h.page)) === null);
  await h.close();

  // on the LED panel: the countdown card is pixel art, the clock gives way to it, the page pill is gone
  h = await t.open({ query: `t=${at(sunset, -270e3)}&speed=0`, width: 1000, height: 560, conf: { countdown: 'both', screenMode: 'led', clockStyle: 'solid', twentyFourHourClock: true } });
  await h.settle(2500);
  const led = await h.page.evaluate(() => ({ overlay: window.__sky.glass.overlay, top: parseFloat(document.body.style.getPropertyValue('--led-top')), pill: getComputedStyle(document.getElementById('alerts')).display, rows: window.__sky.glass.led.rows, clock: document.getElementById('clock').getBoundingClientRect().top, ph: Math.min(innerHeight, innerWidth / 2) }));
  t.check('LED panel: the countdown card is drawn (pixel art overlay on)', led.overlay === true);
  t.check('LED panel: the page pill is hidden (the card replaces it)', led.pill === 'none');
  t.check('LED panel: the clock is laid out below the card (--led-top reserved)', led.top > 0.2 && led.top < 0.6, String(led.top));
  const card = await h.page.evaluate(() => { const c = window.__ledCard; return c && { w: c.width, h: c.height, url: c.toDataURL() }; });
  t.check('LED panel: the card is one pixel per LED (a 64 x 32 canvas)', card && card.w === 64 && card.h === 32, card && `${card.w}x${card.h}`);
  const lit = await h.page.evaluate(async (url) => { const i = new Image(); i.src = url; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let white = 0, orange = 0; for (let k = 0; k < d.length; k += 4) { if (d[k + 3] > 200 && d[k] > 230 && d[k + 1] > 230 && d[k + 2] > 230) white++; if (d[k + 3] > 200 && d[k] > 230 && d[k + 1] > 90 && d[k + 1] < 150 && d[k + 2] < 90) orange++; } return { white, orange }; }, card.url);
  t.check('LED panel: the card has white digits and an orange (sunset) sun', lit.white > 20 && lit.orange > 8, JSON.stringify(lit));
  const cardBottomPx = await h.page.evaluate(() => ((parseFloat(document.body.style.getPropertyValue('--led-top')) * Math.min(innerHeight, innerWidth / 2)) + (innerHeight - Math.min(innerHeight, innerWidth / 2)) / 2));
  const digitTop = await h.page.evaluate(() => Math.min(...[...document.querySelectorAll('#clock svg')].filter((e) => getComputedStyle(e).display !== 'none' && e.querySelector('path[id]')).map((e) => e.getBoundingClientRect().top)));
  t.check('LED panel: the digits start below the card (it never covers the time)', digitTop >= cardBottomPx - 2, `digits ${Math.round(digitTop)} card ends ${Math.round(cardBottomPx)}`);
  await h.close();

  h = await t.open({ query: `t=${at(sunset, -270e3)}&speed=0`, width: 800, height: 500, conf: { countdown: 'both', screenMode: 'led', ledCols: 16, ledRows: 16, clockStyle: 'solid' } });
  await h.settle(2500);
  t.check('a 16 x 16 panel shows the normal pill, made of LEDs (full-size overlay, no pixel card)', await h.page.evaluate(() => window.__sky.glass.overlayFull === true && window.__sky.glass.overlay === false));
  await h.close();
}
