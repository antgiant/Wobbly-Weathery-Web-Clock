// Setting the place by hand (Settings -> Place -> Set the place myself): coordinates or a search by name, kept, never replaced,
// never questioned.
export const name = 'place';
export const covers = 'Manual location: typed coordinates (validated), search by name, kept across a reload, never replaced by the estimate, no first-run question';
export const tier = 'fast';          // part of the quick check (npm test); the suite does only its core when t.quick is set

const open = (page) => page.evaluate(() => document.getElementById('settings').dispatchEvent(new MouseEvent('click', { bubbles: true })));
const conf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('conf')));

export async function run(t) {
  let h = await t.open({ query: 'lat=&t=2026-06-21T12:00:00Z&speed=0', width: 420, height: 800, conf: { clockStyle: 'solid' } });
  await open(h.page);
  await h.page.waitForTimeout(400);
  await h.page.click('.tab[data-tab="place"]');
  t.check('the manual place fields are hidden until asked for', await h.page.evaluate(() => document.getElementById('manualFields').hidden));
  await h.page.evaluate(() => { const b = document.getElementById('manualLocation'); b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
  await h.page.waitForTimeout(300);
  t.check('"Set the place myself" shows the search box and the two coordinate boxes, and turns the automatic controls off', await h.page.evaluate(() => !document.getElementById('manualFields').hidden && document.getElementById('preciseLocation').disabled && document.getElementById('refreshLocation').disabled));

  // typed coordinates: Reykjavik
  await h.page.fill('#manualLat', '64.1466'); await h.page.fill('#manualLon', '-21.9426');
  await h.page.dispatchEvent('#manualLon', 'change');
  await h.page.waitForTimeout(700);
  let c = await conf(h.page), sky = await h.page.evaluate(() => ({ lat: window.__sky.s.lat, lon: window.__sky.s.lon }));
  t.check('typed coordinates are saved (rounded to 0.0001), flagged as set by hand, and the sky moves there', c.manualLocation === true && c.locationChoice === 'manual' && Math.abs(c.location_latitude - 64.1466) < 1e-6 && Math.abs(c.location_longitude + 21.9426) < 1e-6 && Math.abs(sky.lat - 64.1466) < 1e-3 && Math.abs(sky.lon + 21.9426) < 1e-3, JSON.stringify({ c: [c.location_latitude, c.location_longitude, c.manualLocation], sky }));
  t.check('the place line says it was set by the user and shows the coordinates', /Place \(set by you\).*64\.147.*-21\.943/.test(await h.page.evaluate(() => document.getElementById('coords').textContent.replace(/\s+/g, ' '))), await h.page.evaluate(() => document.getElementById('coords').textContent));

  // out of range is refused, with words
  await h.page.fill('#manualLat', '95'); await h.page.dispatchEvent('#manualLat', 'change');
  await h.page.waitForTimeout(300);
  c = await conf(h.page);
  t.check('a latitude of 95 is refused: the place stays, and the hint says why', Math.abs(c.location_latitude - 64.1466) < 1e-6 && /latitude must be a number from -90/i.test(await h.page.evaluate(() => document.getElementById('manualHint').textContent)) && await h.page.evaluate(() => document.getElementById('manualLat').getAttribute('aria-invalid') === 'true'));
  await h.page.fill('#manualLat', 'north'); await h.page.dispatchEvent('#manualLat', 'change');
  t.check('so is text', Math.abs((await conf(h.page)).location_latitude - 64.1466) < 1e-6);
  await h.page.fill('#manualLat', '64,15'); await h.page.dispatchEvent('#manualLat', 'change');
  await h.page.waitForTimeout(300);
  t.check('a decimal comma is understood (64,15)', Math.abs((await conf(h.page)).location_latitude - 64.15) < 1e-6);
  t.check('no errors', h.errors.length === 0, h.errors.join(' | '));
  await h.close();

  // kept: a reload does not replace it with the time-zone estimate, and there is no first-run question
  h = await t.open({ seedConf: false, load: false, init: () => { if (!localStorage.getItem('conf')) localStorage.setItem('conf', JSON.stringify({ confVersion: 99, manualLocation: true, locationChoice: 'manual', location_latitude: -33.8688, location_longitude: 151.2093, location_name: 'Sydney, Australia', clockStyle: 'solid', keepAwake: false })); }, timezone: 'America/New_York' });
  await h.page.goto(h.url.replace('lat=40.7&lon=-74&', ''));
  await h.ready(); await h.page.waitForTimeout(1200);
  c = await conf(h.page);
  t.check('a saved manual place survives a load: the New York time zone does not replace Sydney', c.manualLocation === true && Math.abs(c.location_latitude + 33.8688) < 1e-6 && Math.abs(c.location_longitude - 151.2093) < 1e-6, JSON.stringify([c.location_latitude, c.location_longitude]));
  t.check('and the first-run question is not shown', await h.page.evaluate(() => document.getElementById('welcome').hidden));
  t.check('the sky is drawn for Sydney', await h.page.evaluate(() => Math.abs(window.__sky.s.lat + 33.8688) < 0.01));
  await h.close();

  // the time at another place: the digits (the page title is the time) follow the chosen zone; a bad name is ignored
  h = await t.open({ query: 't=2026-06-21T17:00:00Z&speed=0', conf: { clockStyle: 'solid', twentyFourHourClock: true, timeZone: 'Asia/Tokyo' } });
  await h.page.waitForTimeout(600);
  t.check('with a time zone set, the digits show that zone (17:00 UTC is 2:00 the next morning in Tokyo, not 13:00 in New York)', (await h.page.title()) === '2:00:00', await h.page.title());
  await h.page.evaluate(() => { const b = document.getElementById('timeZone'); b.value = 'Europe/Paris'; b.dispatchEvent(new Event('change', { bubbles: true })); });
  await h.page.waitForTimeout(700);
  t.check('typing another zone in Settings -> Place changes the digits at once and is saved', (await h.page.title()) === '19:00:00' && (await conf(h.page)).timeZone === 'Europe/Paris', await h.page.title());
  await h.page.evaluate(() => { const b = document.getElementById('timeZone'); b.value = 'Mars/Olympus'; b.dispatchEvent(new Event('change', { bubbles: true })); });
  await h.page.waitForTimeout(500);
  t.check('a zone name the browser does not know is refused with words, and the digits stay on the last good zone', (await h.page.title()) === '19:00:00' && /not a time zone name/.test(await h.page.evaluate(() => document.getElementById('timeZoneHint').textContent)) && (await conf(h.page)).timeZone === 'Europe/Paris');
  await h.page.evaluate(() => { const b = document.getElementById('timeZone'); b.value = ''; b.dispatchEvent(new Event('change', { bubbles: true })); });
  await h.page.waitForTimeout(600);
  t.check('emptying it goes back to this device\'s own time (13:00 in New York)', (await h.page.title()) === '13:00:00', await h.page.title());
  t.check('time zone: no errors', h.errors.length === 0, h.errors.join(' | '));
  await h.close();

  if (t.quick) return;                                              // the quick check stops here

  // search by name (the service is mocked)
  h = await t.open({ query: 'lat=&t=2026-06-21T12:00:00Z&speed=0', width: 420, height: 800, conf: { clockStyle: 'solid', manualLocation: true, locationChoice: 'manual', location_latitude: 10, location_longitude: 10 } });
  let asked = '';
  await h.page.route('https://geocoding-api.open-meteo.com/**', (route) => { asked = route.request().url(); route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [{ name: 'Chicago', admin1: 'Illinois', country: 'United States', latitude: 41.85003, longitude: -87.65005, timezone: 'America/Chicago' }, { name: 'Chicago Heights', admin1: 'Illinois', country: 'United States', latitude: 41.50615, longitude: -87.63532 }] }) }); });
  await open(h.page); await h.page.waitForTimeout(400);
  await h.page.click('.tab[data-tab="place"]');
  await h.page.fill('#placeSearch', 'Chicag');
  await h.page.waitForFunction(() => !document.getElementById('placeResults').hidden, null, { timeout: 8000 }).catch(() => {});
  const items = await h.page.evaluate(() => [...document.querySelectorAll('#placeResults button')].map((b) => b.textContent));
  t.check('typing a place name lists the matches (name, region, country), asking the service for exactly what was typed', items.length === 2 && items[0] === 'Chicago, Illinois, United States' && /name=Chicag/.test(asked), JSON.stringify(items));
  await h.page.click('#placeResults button');
  await h.page.waitForTimeout(600);
  c = await conf(h.page);
  t.check('choosing one sets the place (rounded to 0.0001) and remembers its name', Math.abs(c.location_latitude - 41.85) < 1e-6 && Math.abs(c.location_longitude + 87.65) < 1e-6 && c.location_name === 'Chicago, United States', JSON.stringify([c.location_latitude, c.location_longitude, c.location_name]));
  t.check('and the place\'s time zone from the search result is filled in', c.timeZone === 'America/Chicago' && await h.page.evaluate(() => document.getElementById('timeZone').value === 'America/Chicago'));
  t.check('the place line shows the name', /Chicago, United States/.test(await h.page.evaluate(() => document.getElementById('coords').textContent)));
  t.check('the list closes and the boxes show the new coordinates', await h.page.evaluate(() => document.getElementById('placeResults').hidden && document.getElementById('manualLat').value === '41.8500'));
  // a place name with markup is shown as text
  await h.page.evaluate(() => { const c = JSON.parse(localStorage.getItem('conf')); c.location_name = '<img src=x onerror=window.__pwned=1>'; localStorage.setItem('conf', JSON.stringify(c)); });
  await h.page.reload(); await h.ready(); await h.page.waitForTimeout(800);
  t.check('a name that looks like markup is shown as text, never run', await h.page.evaluate(() => !window.__pwned && !document.querySelector('#coords img')));
  // turning it off goes back to the estimate
  await open(h.page); await h.page.waitForTimeout(300); await h.page.click('.tab[data-tab="place"]');
  await h.page.evaluate(() => { const b = document.getElementById('manualLocation'); b.checked = false; b.dispatchEvent(new Event('change', { bubbles: true })); });
  await h.page.waitForTimeout(800);
  c = await conf(h.page);
  t.check('turning it off goes back to the automatic place (the time-zone estimate here), and the name is forgotten', c.manualLocation === false && c.location_name === '' && Math.abs(c.location_latitude - 41.85) > 0.3, JSON.stringify([c.manualLocation, c.location_latitude, c.location_name]));
  t.check('search: no errors', h.errors.length === 0, h.errors.join(' | '));
  await h.close();

  // no connection to the search service: the cities built into the page are offered, with their time zones
  h = await t.open({ query: 'lat=&t=2026-06-21T12:00:00Z&speed=0', width: 420, height: 800, conf: { clockStyle: 'solid', manualLocation: true, locationChoice: 'manual', location_latitude: 10, location_longitude: 10 } });
  await h.page.route('https://geocoding-api.open-meteo.com/**', (route) => route.abort());
  await open(h.page); await h.page.waitForTimeout(400);
  await h.page.click('.tab[data-tab="place"]');
  await h.page.fill('#placeSearch', 'reykj');
  await h.page.waitForFunction(() => !document.getElementById('placeResults').hidden, null, { timeout: 8000 }).catch(() => {});
  const offline = await h.page.evaluate(() => ({ items: [...document.querySelectorAll('#placeResults button')].map((b) => b.textContent), hint: document.getElementById('manualHint').textContent }));
  t.check('when the search service cannot be reached, the built-in city list answers, and says so', offline.items.join() === 'Reykjavik, Iceland' && /Could not reach the search service/.test(offline.hint) && /list built into the page/.test(offline.hint), JSON.stringify(offline));
  await h.page.click('#placeResults button'); await h.page.waitForTimeout(500);
  c = await conf(h.page);
  t.check('choosing it sets the place and the time zone, with no connection', Math.abs(c.location_latitude - 64.15) < 1e-6 && Math.abs(c.location_longitude + 21.94) < 1e-6 && c.timeZone === 'Atlantic/Reykjavik' && c.location_name === 'Reykjavik, Iceland', JSON.stringify([c.location_latitude, c.timeZone, c.location_name]));
  await h.page.fill('#placeSearch', 'qqqqqq');
  await h.page.waitForTimeout(1200);
  t.check('a name that is not in the list says only large cities are known offline', /Only large cities are known/.test(await h.page.evaluate(() => document.getElementById('manualHint').textContent)));
  t.check('offline search: no errors', h.errors.filter((e) => !/ERR_FAILED|Failed to load resource|geocoding/.test(e)).length === 0, h.errors.join(' | '));
  await h.close();
}
