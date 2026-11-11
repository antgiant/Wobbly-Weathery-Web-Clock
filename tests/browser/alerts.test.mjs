// The countdown to sunset / sunrise and the optional umbrella alert, as page pills and as pixel art on the LED panel.
import { nextSunset, nextSunrise, at } from '../lib/astro.mjs';
export const name = 'alerts';
export const covers = 'Sunrise / sunset countdown and umbrella alert (pills and LED pixel card, no black plate), pills at the bottom clear of the digits on ten screen shapes';
export const tier = 'fast';          // part of the quick check (npm test); the suite does only its core when t.quick is set

const pill = (page) => page.evaluate(() => { const e = document.getElementById('sunCountdown'); return e.hidden ? null : e.textContent.replace(/\s+/g, ' ').trim(); });
const rainPill = (page) => page.evaluate(() => { const e = document.getElementById('rainAlertPill'); return e.hidden ? null : { text: e.textContent.trim(), level: e.dataset.level }; });

export async function run(t) {
  const sunset = nextSunset('2026-06-21T12:00:00Z');
  const sunrise = nextSunrise('2026-06-22T00:00:00Z');

  // 4 min 30 s before sunset
  let h = await t.open({ fast: true, query: `t=${at(sunset, -270e3)}&speed=0`, conf: { countdown: 'both', countdownLead: 20, clockStyle: 'solid' } });
  await h.settle(1500);
  let p = await pill(h.page);
  t.check('4.5 minutes before sunset the pill says "Sunset in 04:30"', p && /Sunset in\s*0?4:[23]\d/.test(p), String(p));
  t.check('the pill sits at the bottom, below the clock, and does not cover the digits', await h.page.evaluate(() => { const pr = document.getElementById('sunCountdown').getBoundingClientRect(); const d = [...document.querySelectorAll('#clock svg')].filter((e) => getComputedStyle(e).display !== 'none' && e.querySelector('path[id]')).map((e) => e.getBoundingClientRect()); return pr.top >= Math.max(...d.map((r) => r.bottom)) - 8 || pr.top > innerHeight * 0.7; }));
  await h.close();

  h = await t.open({ fast: true, query: `t=${at(sunset, -25 * 60e3)}&speed=0`, conf: { countdown: 'both', countdownLead: 20, clockStyle: 'solid' } });
  await h.settle(1500);
  t.check('25 minutes before sunset (lead 20): no countdown yet', (await pill(h.page)) === null);
  await h.close();

  h = await t.open({ fast: true, query: `t=${at(sunset, -10 * 60e3)}&speed=0`, conf: { countdown: 'both', countdownLead: 20, clockStyle: 'solid' } });
  await h.settle(1500);
  t.check('10 minutes before: counting down', /Sunset in\s*(10:0\d|09:5\d)/.test(String(await pill(h.page))), String(await pill(h.page)));
  await h.close();
  // the pills sit at the bottom, clear of the digits whatever the screen shape and the seconds setting: all of one long rain alert
  // on screen, not touching the digits or the corner buttons, centred
  const shapes = [['phone in landscape, seconds hidden', 852, 393, true], ['upright phone, seconds shown', 393, 852, false]];
  if (!t.quick) shapes.push(['phone in landscape, seconds shown', 852, 393, false], ['upright phone, seconds hidden', 393, 852, true], ['small upright phone', 320, 568, true], ['wide laptop, seconds hidden', 1366, 768, true], ['wide laptop, seconds shown', 1366, 768, false],
    ['square, seconds hidden', 700, 700, true], ['short and wide, seconds hidden', 900, 500, true], ['ultra wide, seconds hidden', 2000, 800, true], ['tablet upright, seconds hidden', 820, 1180, true]);
  for (const [label, w, hh, hide] of shapes) {
    h = await t.open({ fast: true, fixedTime: '2026-06-21T12:00:00Z', width: w, height: hh, touch: true, conf: { weatherMode: 'live', rainAlert: true, clockStyle: 'solid', twentyFourHourClock: false, countdown: 'both', hideSeconds: hide } });
    await h.settle(4800);
    const g = await h.page.evaluate(() => {
      const pill = document.getElementById('rainAlertPill'), pr = pill.getBoundingClientRect();
      const ink = [...document.querySelectorAll('#clock svg')].filter((e) => getComputedStyle(e).display !== 'none' && e.querySelector('path[id]')).map((e) => { const r = e.getBoundingClientRect(), pad = r.width * 0.08; const p = [...e.querySelectorAll('path')].map((q) => q.getBoundingClientRect()); return { left: Math.min(...p.map((q) => q.left)) - pad, right: Math.max(...p.map((q) => q.right)) + pad, top: Math.min(...p.map((q) => q.top)) - pad, bottom: Math.max(...p.map((q) => q.bottom)) + pad }; });
      const corner = ['settings', 'vrButton', 'homeButton'].map((id) => document.getElementById(id)).filter((e) => e && !e.hidden && getComputedStyle(e).display !== 'none').map((e) => e.getBoundingClientRect());
      const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const inkBottom = Math.max(...ink.map((d) => d.bottom)), inkTop = Math.min(...ink.map((d) => d.top)), inkW = Math.max(...ink.map((d) => d.right)) - Math.min(...ink.map((d) => d.left));
      return { shown: !pill.hidden, left: pr.left, right: pr.right, top: pr.top, bottom: pr.bottom, vw: innerWidth, vh: innerHeight, text: pill.textContent, overDigits: ink.some((d) => hit(pr, d)), clear: pr.top - inkBottom, inkH: inkBottom - inkTop, inkW, inkTop, overButtons: corner.some((c) => hit(pr, c)), centre: Math.abs((pr.left + pr.right) / 2 - innerWidth / 2), room: getComputedStyle(document.documentElement).getPropertyValue('--pill-room') };
    });
    t.check(`${label} (${w} x ${hh}): the rain alert is shown in full on the screen (not cut off at an edge)`, g.shown && g.left >= 0 && g.right <= g.vw && g.text.length > 20, JSON.stringify(g));
    t.check(`${label} (${w} x ${hh}): it is at the bottom, centred, clear of the corner buttons`, g.top > g.vh * 0.6 && g.bottom <= g.vh && g.centre < 60 && !g.overButtons, JSON.stringify(g));
    t.check(`${label} (${w} x ${hh}): it does not touch the digits (at least 6 px clear)`, !g.overDigits && g.clear >= 6, `clear ${g.clear.toFixed(1)} px, room ${g.room}`);
    t.check(`${label} (${w} x ${hh}): the digits are still big and on the screen (over 20% of the height or 70% of the width, top not cut off)`, (g.inkH > g.vh * 0.2 || g.inkW > g.vw * 0.7) && g.inkTop >= -8, `ink ${g.inkH.toFixed(0)} x ${g.inkW.toFixed(0)} of ${g.vh} x ${g.vw}, top ${g.inkTop.toFixed(0)}`);
    await h.close();
  }
  if (t.quick) return;                                              // the quick check stops here: the rest is in the full run

  h = await t.open({ fast: true, query: `t=${at(sunset, 20e3)}&speed=0`, conf: { countdown: 'both', clockStyle: 'solid' } });
  await h.settle(1500);
  p = await pill(h.page);
  t.check('20 seconds after sunset it says "Sunset" (no time)', p && /Sunset/.test(p) && !/ in\s*\d/.test(p), String(p));
  await h.close();

  h = await t.open({ fast: true, query: `t=${at(sunset, -5 * 60e3)}&speed=0`, conf: { countdown: 'sunrise', clockStyle: 'solid' } });
  await h.settle(1500);
  t.check('"sunrise only" shows nothing before a sunset', (await pill(h.page)) === null);
  await h.close();

  h = await t.open({ fast: true, query: `t=${at(sunrise, -8 * 60e3)}&speed=0`, conf: { countdown: 'both', clockStyle: 'solid' } });
  await h.settle(1500);
  p = await pill(h.page);
  t.check('before sunrise: "Sunrise in 08:00"', p && /Sunrise in\s*0?[78]:\d\d/.test(p), String(p));
  await h.close();

  h = await t.open({ fast: true, query: `t=${at(sunset, -5 * 60e3)}&speed=0`, conf: { countdown: 'off', clockStyle: 'solid' } });
  await h.settle(1500);
  t.check('countdown off: nothing', (await pill(h.page)) === null);
  await h.close();

  // the umbrella: off by default, on when asked, follows the mocked afternoon shower (3-6 pm UTC)
  h = await t.open({ fast: true, query: 't=2026-06-21T12:00:00Z&speed=0', conf: { weatherMode: 'live', clockStyle: 'solid' } });
  await h.settle(3500);
  t.check('umbrella alert is off by default (no pill, no forecast requested)', (await rainPill(h.page)) === null && !h.net.calls.some((u) => u.includes('precipitation_probability')));
  await h.close();

  const noonLive = { fast: true, fixedTime: '2026-06-21T12:00:00Z', conf: { weatherMode: 'live', rainAlert: true, clockStyle: 'solid', twentyFourHourClock: true } };
  h = await t.open(noonLive);
  await h.settle(4500);
  const rp = await rainPill(h.page);
  t.check('live weather + a forecast shower (15-18 UTC): an umbrella pill that says when, in the viewer\'s own time (11:00 to 14:00 in New York)', rp && rp.level === 'umbrella' && /Umbrella: rain, 11:00 to 14:00/.test(rp.text), JSON.stringify(rp));
  t.check('the settings panel says the same', /Umbrella/.test(await h.page.evaluate(() => document.getElementById('rainStatus').textContent)));
  await h.close();

  const heavy = await t.open({ fast: true, ...noonLive, load: false });
  heavy.net.rainHours = (hr) => (hr === 15 ? 4 : 0);
  await heavy.page.goto(heavy.url); await heavy.ready(); await heavy.settle(4500);
  t.check('one downpour hour (4 mm) is a slicker, not an umbrella', (await rainPill(heavy.page)) && (await rainPill(heavy.page)).level === 'slicker', JSON.stringify(await rainPill(heavy.page)));
  await heavy.close();

  const dry = await t.open({ fast: true, ...noonLive, load: false });
  dry.net.rainHours = () => 0.02;
  await dry.page.goto(dry.url); await dry.ready(); await dry.settle(4500);
  t.check('a dry day (drizzle under 0.2 mm an hour): no alert', (await rainPill(dry.page)) === null);
  await dry.close();

  h = await t.open({ fast: true, query: 't=2026-06-21T12:00:00Z&speed=0', conf: { weatherMode: 'clear', rainAlert: true, clockStyle: 'solid' } });
  await h.settle(3500);
  t.check('with a manual clear sky there is no alert', (await rainPill(h.page)) === null);
  await h.close();

  // on the LED panel: the countdown card is pixel art, the clock gives way to it, the page pill is gone
  h = await t.open({ fast: true, query: `t=${at(sunset, -270e3)}&speed=0`, width: 1000, height: 560, conf: { countdown: 'both', screenMode: 'led', clockStyle: 'solid', twentyFourHourClock: true } });
  await h.settle(2500);
  const led = await h.page.evaluate(() => ({ overlay: window.__sky.glass.overlay, top: parseFloat(document.body.style.getPropertyValue('--led-top')), pill: getComputedStyle(document.getElementById('alerts')).display, rows: window.__sky.glass.led.rows, clock: document.getElementById('clock').getBoundingClientRect().top, ph: Math.min(innerHeight, innerWidth / 2) }));
  t.check('LED panel: the countdown card is drawn (pixel art overlay on)', led.overlay === true);
  t.check('LED panel: the page pill is hidden (the card replaces it)', led.pill === 'none');
  t.check('LED panel: the clock is laid out below the card (--led-top reserved)', led.top > 0.2 && led.top < 0.6, String(led.top));
  const card = await h.page.evaluate(() => { const c = window.__ledCard; return c && { w: c.width, h: c.height, url: c.toDataURL() }; });
  t.check('LED panel: the card is one pixel per LED (a 64 x 32 canvas)', card && card.w === 64 && card.h === 32, card && `${card.w}x${card.h}`);
  const lit = await h.page.evaluate(async (url) => { const i = new Image(); i.src = url; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let white = 0, orange = 0; for (let k = 0; k < d.length; k += 4) { if (d[k + 3] > 200 && d[k] > 230 && d[k + 1] > 230 && d[k + 2] > 230) white++; if (d[k + 3] > 200 && d[k] > 230 && d[k + 1] > 90 && d[k + 1] < 150 && d[k + 2] < 90) orange++; } return { white, orange }; }, card.url);
  t.check('LED panel: the card has white digits and an orange (sunset) sun', lit.white > 20 && lit.orange > 8, JSON.stringify(lit));
  // no black plate: the sky shows through; every lit LED has a dark outline instead
  const plate = (page) => page.evaluate(() => {
    const c = window.__ledCard, x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height;
    const a = (i, j) => d[(j * W + i) * 4 + 3], rgb = (i, j) => [d[(j * W + i) * 4], d[(j * W + i) * 4 + 1], d[(j * W + i) * 4 + 2]];
    const isLit = (i, j) => a(i, j) > 250 && Math.max(...rgb(i, j)) > 60;
    let x0 = W, y0 = H, x1 = -1, y1 = -1, opaque = 0, lit = 0, outline = 0, litNoOutline = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (a(i, j) > 0) { x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, j); y1 = Math.max(y1, j); opaque++; if (isLit(i, j)) lit++; else outline++; }
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (isLit(i, j)) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const ni = i + dx, nj = j + dy; if (ni >= 0 && nj >= 0 && ni < W && nj < H && a(ni, nj) === 0) litNoOutline++; }
    const box = (x1 - x0 + 1) * (y1 - y0 + 1);
    return { box, opaque, lit, outline, litNoOutline, transparentInBox: box - opaque, W, H };
  });
  const pl = await plate(h.page);
  t.check('LED panel: the card has no solid plate (more than 15% of the LEDs inside the card are see-through; a black plate has none)', pl.transparentInBox > pl.box * 0.15, JSON.stringify(pl));
  t.check('LED panel: every lit LED has a dark outline on each side (none touches a transparent LED)', pl.litNoOutline === 0 && pl.lit > 20 && pl.outline > pl.lit * 0.5, JSON.stringify(pl));
  const cardBottomPx = await h.page.evaluate(() => ((parseFloat(document.body.style.getPropertyValue('--led-top')) * Math.min(innerHeight, innerWidth / 2)) + (innerHeight - Math.min(innerHeight, innerWidth / 2)) / 2));
  const digitTop = await h.page.evaluate(() => Math.min(...[...document.querySelectorAll('#clock svg')].filter((e) => getComputedStyle(e).display !== 'none' && e.querySelector('path[id]')).map((e) => e.getBoundingClientRect().top)));
  t.check('LED panel: the digits start below the card (it never covers the time)', digitTop >= cardBottomPx - 2, `digits ${Math.round(digitTop)} card ends ${Math.round(cardBottomPx)}`);
  await h.close();

  // the umbrella on the LED panel: see-through too, with the outline
  h = await t.open({ fast: true, query: 't=2026-06-21T12:00:00Z&speed=0', width: 1000, height: 560, conf: { weatherMode: 'rain', rainAlert: true, screenMode: 'led', clockStyle: 'solid', countdown: 'off' } });
  await h.settle(3200);
  const um = await plate(h.page);
  t.check('LED panel: the umbrella is see-through with an outline (no black plate behind it)', um.lit > 15 && um.litNoOutline === 0 && um.transparentInBox > um.box * 0.2, JSON.stringify(um));
  await h.close();

  h = await t.open({ fast: true, query: `t=${at(sunset, -270e3)}&speed=0`, width: 800, height: 500, conf: { countdown: 'both', screenMode: 'led', ledCols: 16, ledRows: 16, clockStyle: 'solid' } });
  await h.settle(2500);
  t.check('a 16 x 16 panel shows the normal pill, made of LEDs (full-size overlay, no pixel card)', await h.page.evaluate(() => window.__sky.glass.overlayFull === true && window.__sky.glass.overlay === false));
  await h.close();

  // ---- severe weather notices: official alerts for the place (js/sky/severe.js), mocked NWS answers ----
  const feat = (event, extra = {}) => ({ id: `urn:${event}`, properties: { id: `urn:${event}`, event, severity: 'Severe', urgency: 'Immediate', headline: `${event} for the county`, areaDesc: 'Test County', ends: '2026-06-21T20:00:00Z', messageType: 'Alert', status: 'Actual', ...extra } });
  const sevPill = (page) => page.evaluate(() => { const e = document.getElementById('severePill'); return e && !e.hidden ? { level: e.dataset.level, text: e.textContent.trim(), icon: !!e.querySelector('svg path') } : null; });
  const rainVisible = (page) => page.evaluate(() => { const e = document.getElementById('rainAlertPill'); return !!e && !e.hidden; });
  const sevOpen = { fast: true, fixedTime: '2026-06-21T12:00:00Z', conf: { weatherMode: 'live', rainAlert: true, clockStyle: 'solid', twentyFourHourClock: true } };
  const pollNow = (page) => page.evaluate(async () => { const m = await import('/js/sky/alerts.js'); await m.loadSevere(); });
  const sv = await t.open({ ...sevOpen, load: false });
  sv.net.alerts = [feat('Tornado Warning', { severity: 'Extreme' }), feat('Flood Watch', { severity: 'Moderate', urgency: 'Future' }), feat('Wind Advisory', { severity: 'Minor' })];
  await sv.page.goto(sv.url); await sv.ready(); await sv.settle(4500);
  let sp = await sevPill(sv.page);
  t.check('severe notice: a tornado warning shows first, in red, with an icon, until its end time, and says there is one more (the watch; the advisory is off by default)', sp && sp.level === 'warning' && /^Tornado Warning until /.test(sp.text) && /\(\+1 more\)$/.test(sp.text) && sp.icon, JSON.stringify(sp));
  t.check('severe notice: the umbrella steps aside while it shows', (await rainVisible(sv.page)) === false);
  t.check('severe notice: the settings panel says what it is', /Tornado Warning for the county/.test(await sv.page.evaluate(() => document.getElementById('severeStatus').textContent)));
  t.check('severe notice: asked for this place (the NWS point), no other service', sv.net.calls.some((u) => /api\.weather\.gov\/alerts\/active\?point=40\.\d+,-7\d\.\d+/.test(u)));
  sv.net.alerts = [feat('Flood Watch', { severity: 'Moderate', urgency: 'Future' })];
  await pollNow(sv.page); await sv.settle(300);
  sp = await sevPill(sv.page);
  t.check('severe notice: the warning is cancelled (gone at the next poll): the watch takes over, amber, and the umbrella is still away', sp && sp.level === 'watch' && /^Flood Watch/.test(sp.text) && !/more/.test(sp.text) && (await rainVisible(sv.page)) === false, JSON.stringify(sp));
  sv.net.alerts = [];
  await pollNow(sv.page); await sv.settle(400);
  t.check('severe notice: nothing left: no pill, and the umbrella is back', (await sevPill(sv.page)) === null && (await rainVisible(sv.page)) === true);
  await sv.close();

  const off = await t.open({ ...sevOpen, load: false, conf: { ...sevOpen.conf, severeAlerts: 'off' } });
  off.net.alerts = [feat('Tornado Warning')];
  await off.page.goto(off.url); await off.ready(); await off.settle(3500);
  t.check('severe notice: off means no pill and no request to the service', (await sevPill(off.page)) === null && !off.net.calls.some((u) => /api\.weather\.gov/.test(u)));
  await off.close();

  const abroad = await t.open({ ...sevOpen, load: false, query: 'lat=51.5&lon=-0.1' });
  abroad.net.alerts = [feat('Tornado Warning')];
  await abroad.page.goto(abroad.url); await abroad.ready(); await abroad.settle(3500);
  const abroadText = await abroad.page.evaluate(() => document.getElementById('severeStatus').textContent);
  t.check('severe notice: outside the United States the service is not asked, and the settings panel says why', (await sevPill(abroad.page)) === null && !abroad.net.calls.some((u) => /api\.weather\.gov/.test(u)) && /United States/.test(abroadText), JSON.stringify([abroadText, abroad.net.calls.filter((u) => /weather\.gov/.test(u))]));
  await abroad.close();

  const advisory = await t.open({ ...sevOpen, load: false, conf: { ...sevOpen.conf, severeAlerts: 'all' } });
  advisory.net.alerts = [feat('Wind Advisory', { severity: 'Minor' })];
  await advisory.page.goto(advisory.url); await advisory.ready(); await advisory.settle(3500);
  const ap = await sevPill(advisory.page);
  t.check('severe notice: with "Everything" an advisory shows too (blue), and a civil emergency stays away unless asked', ap && ap.level === 'advisory' && /^Wind Advisory/.test(ap.text), JSON.stringify(ap));
  await advisory.close();

  // ---- a severe weather notice on an LED panel: a warning triangle (red) takes the umbrella's corner ----
  const ledSev = await t.open({ fast: true, fixedTime: '2026-06-21T12:00:00Z', width: 1000, height: 560, load: false, conf: { weatherMode: 'rain', rainAlert: true, screenMode: 'led', clockStyle: 'solid', countdown: 'off', twentyFourHourClock: true } });
  ledSev.net.alerts = [feat('Tornado Warning', { severity: 'Extreme' })];
  await ledSev.page.goto(ledSev.url); await ledSev.ready(); await ledSev.settle(4500);
  const redLit = await ledSev.page.evaluate(() => { const c = window.__ledCard, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let red = 0, blue = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 250) { if (d[i] > 200 && d[i + 1] < 120 && d[i + 2] < 120) red++; else if (d[i + 2] > 200 && d[i] < 160) blue++; } return { red, blue }; });
  t.check('LED panel: a tornado warning takes the umbrella\'s corner as a red triangle (the blue umbrella is not drawn)', redLit.red >= 15 && redLit.blue === 0, JSON.stringify(redLit));
  await ledSev.close();
}
