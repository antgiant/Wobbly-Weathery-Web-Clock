// From Thanksgiving to Christmas: a lit tree in the scene (floating at sea) and, left on Automatic, the coloured-lights clock.
export const name = 'christmas';

const state = (page) => page.evaluate(() => ({ tree: window.__sky.s.tree.on, ocean: window.__sky.s.landscape.ocean, style: document.body.dataset.clockstyle, mode: window.__sky.glass.mode, glow: window.__sky.glass.glow }));

export async function run(t) {
  const cases = [
    { when: '2026-11-25T17:00:00Z', tree: false, style: 'glass', label: 'the day before Thanksgiving (Nov 25 2026)' },
    { when: '2026-11-26T17:00:00Z', tree: true, style: 'stained', label: 'Thanksgiving itself (Nov 26 2026)' },
    { when: '2026-12-10T17:00:00Z', tree: true, style: 'stained', label: 'December 10' },
    { when: '2026-12-25T17:00:00Z', tree: true, style: 'stained', label: 'Christmas Day' },
    { when: '2026-12-26T17:00:00Z', tree: false, style: 'glass', label: 'December 26' },
    { when: '2026-07-04T17:00:00Z', tree: false, style: 'glass', label: 'July 4' },
  ];
  for (const c of cases) {
    const h = await t.open({ query: `t=${c.when}&speed=0` });
    const s = await state(h.page);
    t.check(`${c.label}: tree ${c.tree ? 'on' : 'off'}, clock ${c.style === 'stained' ? 'coloured lights' : 'liquid glass'}`, s.tree === c.tree && s.style === c.style, JSON.stringify(s));
    await h.close();
  }

  // the user's own choice always wins
  let h = await t.open({ query: 't=2026-12-10T17:00:00Z&speed=0', conf: { clockStyle: 'solid' } });
  let s = await state(h.page);
  t.check('December with solid ink chosen: it stays solid (the tree still stands)', s.style === 'solid' && s.tree === true, JSON.stringify(s));
  await h.close();
  h = await t.open({ query: 't=2026-12-10T17:00:00Z&speed=0', conf: { clockStyle: 'glass' } });
  s = await state(h.page);
  t.check('December with liquid glass chosen: it stays liquid glass', s.style === 'glass', JSON.stringify(s));
  await h.close();
  h = await t.open({ query: 't=2026-12-10T17:00:00Z&speed=0', conf: { holidayTree: false } });
  s = await state(h.page);
  t.check('the tree can be switched off (and the lights stay: they are a clock style, not the tree)', s.tree === false && s.style === 'stained', JSON.stringify(s));
  await h.close();
  h = await t.open({ query: 't=2026-12-10T17:00:00Z&speed=0&xmas=0' });
  t.check('?xmas=0 forces the tree off, ?xmas=1 forces it on out of season', (await state(h.page)).tree === false);
  await h.close();
  h = await t.open({ query: 't=2026-07-04T17:00:00Z&speed=0&xmas=1' });
  t.check('?xmas=1 forces the tree on in July', (await state(h.page)).tree === true);
  await h.close();

  // on land: switching the tree off changes a compact patch of the picture and nothing else (nothing else moves on a still hill)
  const land = { query: 't=2026-12-10T22:30:00Z&speed=0&az=190&pitch=8', width: 900, height: 500, conf: { clockStyle: 'solid', landscape: 'hills' } };
  const on = await t.open(land), off = await t.open({ ...land, query: land.query + '&xmas=0' });
  const dl = await t.diff(on.page, await on.shot('christmas-land'), await off.shot('christmas-land-no-tree'), 60);
  t.check('on land the tree is drawn: it is a compact, tall patch of the picture', dl.size && dl.count > 400 && dl.box && (dl.box[3] - dl.box[1]) > (dl.box[2] - dl.box[0]) * 1.2 && dl.share < 0.05, JSON.stringify(dl));
  await on.close(); await off.close();

  // at sea the tree floats: the ocean is the landscape and the tree is drawn with its reflection (two sprites, not one)
  const count = () => { window.__tree = []; const f = WebGL2RenderingContext.prototype.drawArraysInstanced; WebGL2RenderingContext.prototype.drawArraysInstanced = function (m, a, c, n) { window.__tree.push(n); return f.call(this, m, a, c, n); }; };
  const sea = await t.open({ query: 't=2026-12-10T22:30:00Z&speed=0&landscape=ocean&az=190&pitch=8', width: 900, height: 500, conf: { clockStyle: 'solid' }, init: count });
  const ss = await state(sea.page);
  t.check('on the ocean landscape the tree is on and the sea is the landscape', ss.tree && ss.ocean, JSON.stringify(ss));
  await sea.page.waitForTimeout(1500);
  const sprites = await sea.page.evaluate(() => [...new Set(window.__tree)]);
  t.check('at sea the tree and its reflection are drawn together (an instanced draw of 2)', sprites.includes(2), JSON.stringify(sprites));
  const lnd = await t.open({ ...land, init: count });
  await lnd.page.waitForTimeout(1500);
  t.check('on land the tree alone is drawn (an instanced draw of 1, no reflection)', (await lnd.page.evaluate(() => [...new Set(window.__tree)])).includes(1), '');
  await lnd.close();
  const h2 = sea;
  t.check('no script or shader errors with the tree', h2.errors.length === 0, h2.errors.join(' | '));
  await h2.close();
}
