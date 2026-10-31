// First visit and upgrades: the one location question, and settings saved by an older version.
export const name = 'startup';

export async function run(t) {
  // a brand new visitor (nothing saved, no location in the address)
  let h = await t.open({ query: 'lat=&x=1', seedConf: false, load: false });
  await h.page.goto(h.url.replace('lat=&x=1', 'x=1').replace('?lat=40.7&lon=-74&', '?'));
  await h.ready();
  await h.page.waitForTimeout(800);
  t.check('first visit: the one question is shown', await h.page.evaluate(() => !document.getElementById('welcome').hidden));
  const txt = await h.page.evaluate(() => document.getElementById('welcome').textContent);
  t.check('it offers "real location" and "estimate it", and says only a rounded position is used', /real location/i.test(txt) && /estimate/i.test(txt) && /rounded/i.test(txt));
  await h.page.click('#welcomeEstimate');
  await h.page.waitForTimeout(300);
  const c = await h.page.evaluate(() => JSON.parse(localStorage.getItem('conf')));
  t.check('choosing "estimate" hides the question and remembers the choice', c.locationChoice === 'estimated' && c.preciseLocation === false && await h.page.evaluate(() => document.getElementById('welcome').hidden));
  t.check('a location was estimated from the time zone', Number.isFinite(c.location_latitude) && c.location_latitude !== -1);
  await h.page.reload();
  await h.ready();
  await h.page.waitForTimeout(500);
  t.check('it is not asked again', await h.page.evaluate(() => document.getElementById('welcome').hidden));
  await h.close();

  // a deep link with a location is never interrupted by the question
  h = await t.open({ query: 'lat=40.7&lon=-74', seedConf: false });
  t.check('with ?lat=&lon= in the address there is no question', await h.page.evaluate(() => document.getElementById('welcome').hidden));
  await h.close();

  // settings saved by an older version are upgraded once, and the user's own choices survive
  h = await t.open({ seedConf: false, load: false, init: () => localStorage.setItem('conf', JSON.stringify({ confVersion: 0, twentyFourHourClock: true, clockStyle: 'glass', viewMode: 'fixed', keepAwake: false, followSun: false, hideSeconds: true, location_latitude: 51.5, location_longitude: -0.1, locationChoice: 'estimated', weatherMode: 'clear' })) });
  await h.page.goto(h.url);
  await h.ready();
  const m = await h.page.evaluate(() => JSON.parse(localStorage.getItem('conf')));
  t.check('upgrade: the old defaults moved to the new ones', m.clockStyle === 'auto' && m.viewMode === 'drag' && m.followSun === true && m.keepAwake === true && m.twentyFourHourClock === null);
  t.check('upgrade: the user\'s own settings (no seconds) are kept', m.hideSeconds === true);
  t.check('upgrade: the page runs in look-around, following the sun', await h.page.evaluate(() => window.__controls.mode === 'drag'));
  t.check('upgrade: no errors', h.errors.length === 0, h.errors.join(' | '));
  await h.close();

  // the return-to-default-view button: hidden at the default view, shown after dragging, gone again after pressing
  h = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0', width: 900, height: 500 });
  const vis = () => h.page.evaluate(() => getComputedStyle(document.getElementById('homeButton')).display !== 'none');
  t.check('home button: not shown while the view is the default', (await vis()) === false);
  await h.page.mouse.move(450, 250); await h.page.mouse.down(); await h.page.mouse.move(300, 200, { steps: 6 }); await h.page.mouse.up();
  await h.page.waitForTimeout(400);
  t.check('home button: shown after dragging the view away', (await vis()) === true && await h.page.evaluate(() => window.__controls.userMoved));
  const moved = await h.page.evaluate(() => Math.round(window.__controls.heading));
  await h.page.mouse.move(100, 100);
  await h.page.waitForTimeout(300);
  await h.page.click('#homeButton');
  await h.page.waitForTimeout(500);
  t.check('home button: pressing it returns to the default and hides it again', (await vis()) === false && await h.page.evaluate((m) => Math.round(window.__controls.heading) !== m && !window.__controls.userMoved, moved));
  await h.close();
}
