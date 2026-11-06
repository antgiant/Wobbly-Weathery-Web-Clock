// The capability ladder on the web (js/sky/capability.js): on by default, the settings screens grey out what it has given up, and the 'adapt' setting (or the address) overrides it.
export const name = 'ladder';
export const covers = 'The ladder is on by default and holds the clock right; the settings controls it has given up are disabled with a note; Adapt to this device turns it off, holds it at a step or back to automatic';
export const tier = 'deep';

const NOON = 't=2026-06-21T17:00:00Z&speed=0';
const NOT_AUTOMATION = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });      // (a browser driven by a test says it is: the page then runs without the ladder, unless asked)

const disabledNow = (page, ids) => page.evaluate((ids) => Object.fromEntries(ids.map((id) => [id, !!document.getElementById(id)?.disabled])), ids);
const notes = (page) => page.evaluate(() => [...document.querySelectorAll('.field.ladder-off')].map((f) => !!f.querySelector('.ladder-note')));

export async function run(t) {
  // 1. held by the address at the solid digits: the glass, weather, cloud and seconds options are given up, the landscape's are not
  { const h = await t.open({ fast: true, query: `${NOON}&gov=1&rung=6&pin=1`, width: 900, height: 700 });
    await h.settle(500);
    const d = await disabledNow(h.page, ['glassFrost', 'glassGlow', 'clockStyle', 'digitWeather', 'cloudMotion', 'windSway', 'hideSeconds', 'landscape', 'plants', 'bodySize']);
    t.check('solid digits: the glass options are greyed out', d.glassFrost && d.glassGlow && d.clockStyle, JSON.stringify(d));
    t.check('... and the weather and cloud motion options, and wind sway', d.digitWeather && d.cloudMotion && d.windSway, JSON.stringify(d));
    t.check('... and the seconds switch is locked', d.hideSeconds);
    t.check('... but the landscape, plants and the sky options are still open', !d.landscape && !d.plants && !d.bodySize, JSON.stringify(d));
    t.check('every greyed-out option says why', (await notes(h.page)).length > 6 && (await notes(h.page)).every(Boolean));
    const status = await h.page.evaluate(() => document.getElementById('perfStatus').textContent);
    t.check('the status under Quality names the step', /solid digits/.test(status), status);
    const sec = await h.page.evaluate(() => ({ locked: document.getElementById('hideSeconds').checked, shown: [...document.querySelectorAll('.seconds')].some((x) => getComputedStyle(x).display !== 'none') }));
    t.check('the seconds are hidden on the clock itself', sec.locked && !sec.shown, JSON.stringify(sec));
    await h.close(); }

  // 2. the simplest picture: the landscape and sky options go too
  { const h = await t.open({ fast: true, query: `${NOON}&gov=1&rung=8&pin=1`, width: 900, height: 700 });
    await h.settle(500);
    const d = await disabledNow(h.page, ['landscape', 'plants', 'holidayTree', 'bodySize', 'nightBrightness', 'lightPollution', 'showLabels', 'quality', 'adapt']);
    t.check('gradient sky: the landscape and sky options are greyed out', d.landscape && d.plants && d.holidayTree && d.bodySize && d.nightBrightness && d.lightPollution && d.showLabels, JSON.stringify(d));
    t.check('... but Quality and the Adapt control stay open (the way back)', !d.quality && !d.adapt, JSON.stringify(d));
    await h.close(); }

  // 3. nothing given up on the full rung
  { const h = await t.open({ fast: true, query: `${NOON}&gov=1&rung=0&pin=1`, width: 900, height: 700 });
    await h.settle(500);
    t.check('the full rung greys out nothing', (await h.page.evaluate(() => document.querySelectorAll('.field.ladder-off').length)) === 0);
    await h.close(); }

  // 4. the address outranks the setting; automation runs without the ladder unless asked
  { const h = await t.open({ fast: true, query: NOON, width: 900, height: 700 });
    await h.settle(400);
    t.check('a browser driven by a test runs without the ladder by default (so tests see what they ask for)', await h.page.evaluate(() => window.__sky.gov === null));
    await h.close(); }

  // 5. in an ordinary browser the ladder is on by default, measures real frames, and the setting overrides it
  { const h = await t.open({ fast: true, query: NOON, width: 900, height: 700, init: NOT_AUTOMATION });
    await h.settle(3500);
    const r = await h.page.evaluate(() => ({ gov: !!window.__sky.gov, rung: window.__sky.gov && window.__sky.gov.rung, cost: window.__sky.gov && window.__sky.gov.cost, probe: window.__sky.autoProbe, adapt: document.getElementById('adapt').value }));
    t.check('in an ordinary browser the ladder is on by default', r.gov && r.adapt === 'auto', JSON.stringify(r));
    t.check('... it reads real frame costs back (a probe a second)', r.probe === true && r.cost != null, JSON.stringify(r));
    const pick = async (v) => { await h.page.evaluate((v) => { const el = document.getElementById('adapt'); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, v); await h.page.waitForTimeout(400); return h.page.evaluate(() => ({ gov: window.__sky.gov ? window.__sky.gov.rung : null, off: document.querySelectorAll('.field.ladder-off').length, status: document.getElementById('perfStatus').textContent, glass: document.getElementById('glassFrost').disabled })); };
    let p = await pick('gradient-sky');
    t.check('Adapt "Always: a gradient sky" holds the ladder there at once, and the screens follow', p.gov === 8 && p.off > 10 && p.glass, JSON.stringify(p));
    t.check('... and says it is held', /held by Adapt/.test(p.status), p.status);
    p = await pick('off');
    t.check('Adapt "Off" takes the ladder away: nothing is greyed out, the status says so', p.gov === null && p.off === 0 && !p.glass && /off/i.test(p.status), JSON.stringify(p));
    p = await pick('auto');
    t.check('Adapt "Automatic" brings it back, from the top', p.gov === 0 && p.off === 0, JSON.stringify(p));
    p = await pick('seconds-off');
    t.check('holding at "no seconds" locks the seconds switch and nothing else of the looks', p.gov === 4 && (await disabledNow(h.page, ['hideSeconds', 'glassFrost', 'landscape'])).hideSeconds === true, JSON.stringify(p));
    const keep = await disabledNow(h.page, ['glassFrost', 'landscape']);
    t.check('... the glass and landscape options stay open (those looks are kept)', !keep.glassFrost && !keep.landscape, JSON.stringify(keep));
    await h.close(); }

  // 6. the setting is read at the start too
  { const h = await t.open({ fast: true, query: NOON, width: 900, height: 700, init: NOT_AUTOMATION, conf: { adapt: 'solid' } });
    await h.settle(800);
    const r = await h.page.evaluate(() => ({ rung: window.__sky.gov && window.__sky.gov.rung, pinned: window.__sky.gov && window.__sky.gov.pin }));
    t.check('a saved Adapt choice holds the ladder from the start', r.rung === 6 && r.pinned === true, JSON.stringify(r));
    await h.close(); }
  { const h = await t.open({ fast: true, query: NOON, width: 900, height: 700, init: NOT_AUTOMATION, conf: { adapt: 'off' } });
    await h.settle(500);
    t.check('a saved "Off" starts without the ladder', await h.page.evaluate(() => window.__sky.gov === null));
    await h.close(); }
}
