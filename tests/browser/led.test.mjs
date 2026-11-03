// The LED panel: the grid you choose, turning, the tuned layouts and the "normal page made of LEDs" fallback,
// checked on the page's geometry and on the pixels of what is drawn.
export const name = 'led';
export const covers = 'LED panel: eight panel sizes (grid, layout, nothing cropped, centred, lines, bezel), size controls, stars lit when the normal picture shows them';
export const tier = 'fast';          // part of the quick check (npm test); the suite does only its core when t.quick is set

const NOON = 't=2026-06-21T17:00:00Z&speed=0';
const cases = [
  // chosen cols x rows, window, expected grid, expected layout
  { cols: 64, rows: 32, w: 1000, h: 560, grid: [64, 32], mode: 'row', label: 'classic 64 x 32 on a wide screen' },
  { cols: 64, rows: 32, w: 400, h: 800, grid: [32, 64], mode: 'stack', label: 'classic panel turned upright on a phone (32 x 64)' },
  { cols: 32, rows: 64, w: 1000, h: 560, grid: [64, 32], mode: 'row', label: '32 x 64 turned to 64 x 32 on a wide screen' },
  { cols: 96, rows: 48, w: 1000, h: 560, grid: [96, 48], mode: 'row', label: '96 x 48' },
  { cols: 64, rows: 64, w: 700, h: 700, grid: [64, 64], mode: 'stack', label: 'square 64 x 64' },
  { cols: 128, rows: 64, w: 1000, h: 560, grid: [128, 64], mode: 'row', label: '128 x 64' },
  { cols: 32, rows: 16, w: 800, h: 500, grid: [32, 16], mode: 'fit', label: '32 x 16 is too small for the tuned layout: normal page, made of LEDs' },
  { cols: 16, rows: 16, w: 700, h: 700, grid: [16, 16], mode: 'fit', label: '16 x 16' },
];

export async function run(t) {
  for (const [i, c] of cases.entries()) {
    if (t.quick && i >= 2) break;                                       // the quick check: the first two panel sizes
    const h = await t.open({ query: NOON, width: c.w, height: c.h, conf: { screenMode: 'led', ledCols: c.cols, ledRows: c.rows, clockStyle: 'solid', twentyFourHourClock: true } });
    await h.settle(600);
    const s = await h.page.evaluate(() => {
      const g = window.__sky.glass, clock = document.getElementById('clock').getBoundingClientRect();
      const all = [...document.querySelectorAll('#clock svg')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => ({ digit: !!e.querySelector('path[id]'), r: e.getBoundingClientRect() }));
      const svgs = all.filter((x) => x.digit).map((x) => x.r);
      const colons = all.map((x, i) => ({ x, i })).filter((o) => !o.x.digit && all[o.i - 1] && all[o.i + 1] && all[o.i - 1].digit && all[o.i + 1].digit).map((o) => {
        const L = all[o.i - 1].r, R = all[o.i + 1].r;                       // ink: a digit fills the middle 64% of its box, a colon's ink sits 9.6% in
        return { x: o.x.r.left + o.x.r.width * 0.096, from: L.left + L.width * 0.82, to: R.left + R.width * 0.18 };
      });
      return { colons, mode: document.body.dataset.led, cols: g.led.cols, rows: g.led.rows, on: g.led.on, w: innerWidth, h: innerHeight, svgs: svgs.map((r) => [r.left, r.top, r.right, r.bottom]), clock: [clock.left, clock.top, clock.width, clock.height], info: document.getElementById('ledInfo').textContent };
    });
    t.check(`${c.label}: grid ${c.grid.join(' x ')}, layout ${c.mode}`, s.on && s.cols === c.grid[0] && s.rows === c.grid[1] && s.mode === c.mode, JSON.stringify({ g: [s.cols, s.rows], m: s.mode }));
    if (c.mode !== 'fit') {
      // the panel: the largest rectangle of this shape that fits the window, centred
      const A = s.cols / s.rows, pw = Math.min(s.w, A * s.h), ph = pw / A, px = (s.w - pw) / 2, py = (s.h - ph) / 2;
      const left = Math.min(...s.svgs.map((r) => r[0])), right = Math.max(...s.svgs.map((r) => r[2])), top = Math.min(...s.svgs.map((r) => r[1])), bottom = Math.max(...s.svgs.map((r) => r[3]));
      t.check(`${c.label}: every digit box lies inside the panel (nothing cropped)`, left >= px - 1 && right <= px + pw + 1 && top >= py - 1 && bottom <= py + ph + 1, JSON.stringify({ box: [left, top, right, bottom].map(Math.round), panel: [px, py, px + pw, py + ph].map(Math.round) }));
      if (c.mode === 'row') {
        const off = s.colons.map((k) => Math.abs(k.x - (k.from + k.to) / 2) / Math.max(1, k.to - k.from));
        t.check(`${c.label}: each colon's ink sits in the middle of the gap between its digits`, s.colons.length === 0 || off.every((o) => o < 0.4), s.colons.length ? 'off by ' + off.map((o) => (o * 100).toFixed(0) + '%').join(', ') : 'no colons');
        // the ink of a digit fills the middle ~64% of its box, so the row's ink is centred when the boxes are
        const ink = (r) => [r[0] + (r[2] - r[0]) * 0.18, r[2] - (r[2] - r[0]) * 0.18];
        const il = Math.min(...s.svgs.map((r) => ink(r)[0])), ir = Math.max(...s.svgs.map((r) => ink(r)[1]));
        t.check(`${c.label}: the digits are centred in the panel (within 3% of its width)`, Math.abs((il + ir) / 2 - s.w / 2) < pw * 0.03, `centre ${(((il + ir) / 2 - s.w / 2) / pw * 100).toFixed(1)}%`);
      }
    } else {
      t.check(`${c.label}: the page layout is the normal one (full width, not fitted to the panel)`, s.clock[2] > s.w * 0.85, `clock width ${Math.round(s.clock[2])} of ${s.w}`);
      t.check(`${c.label}: the panel size is explained as "exactly like the normal clock"`, /exactly like the normal clock/.test(s.info));
    }

    // the pixels: square LEDs with black lines between them, a black bezel round the panel
    const buf = await h.shot(`led-${c.cols}x${c.rows}-${c.w}x${c.h}`);
    const px = await t.analyze(h.page, buf, ({ w, h, lum, mean }) => ({ w, h }));
    const cell = Math.max(2, Math.floor(Math.min(px.w / s.cols, px.h / s.rows))), pw2 = s.cols * cell, ph2 = s.rows * cell, ox = Math.floor((px.w - pw2) / 2), oy = Math.floor((px.h - ph2) / 2);
    const lines = await h.page.evaluate(async ({ b64, cell, ox, oy, cols, rows, W, H }) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
      const L = (x, y) => { const p = cx.getImageData(x, y, 1, 1).data; return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255; };
      let gap = 0, mid = 0, n = 0;
      for (let k = 1; k < cols; k += Math.max(1, Math.floor(cols / 12))) for (let j = 1; j < rows - 1; j += Math.max(1, Math.floor(rows / 8))) {
        gap += L(ox + k * cell, oy + j * cell + Math.floor(cell / 2)); mid += L(ox + k * cell + Math.floor(cell / 2), oy + j * cell + Math.floor(cell / 2)); n++;
      }
      const bezel = [L(1, 1), L(W - 2, H - 2), ox > 4 ? L(2, Math.floor(H / 2)) : 0, oy > 4 ? L(Math.floor(W / 2), 2) : 0];
      return { gap: gap / n, mid: mid / n, bezel: Math.max(...bezel) };
    }, { b64: buf.toString('base64'), cell, ox, oy, cols: s.cols, rows: s.rows, W: px.w, H: px.h });
    t.check(`${c.label}: black lines between LEDs (lines ${lines.gap.toFixed(2)} vs LEDs ${lines.mid.toFixed(2)})`, lines.gap < lines.mid * 0.6, JSON.stringify(lines));
    t.check(`${c.label}: black bezel round the panel where the screen is a different shape`, lines.bezel < 0.05, `bezel ${lines.bezel.toFixed(3)}`);
    t.check(`${c.label}: no script errors`, h.errors.length === 0, h.errors.join(' | '));
    await h.close();
  }

  if (t.quick) return;
  // the settings: choosing a size changes the panel at once, and the choices are saved
  const h = await t.open({ query: NOON, width: 1000, height: 560, conf: { screenMode: 'led', clockStyle: 'solid' } });
  await h.page.evaluate(() => document.getElementById('settings').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await h.page.click('#tab-extras');
  await h.page.click('.seg__btn[data-level="advanced"]');                        // the LED controls are Advanced settings
  await h.page.selectOption('#ledPreset', '128x64');
  await h.page.waitForTimeout(600);
  let s = await h.page.evaluate(() => ({ cols: window.__sky.glass.led.cols, rows: window.__sky.glass.led.rows, c: JSON.parse(localStorage.getItem('conf')), box: [document.getElementById('ledCols').value, document.getElementById('ledRows').value] }));
  t.check('picking the 128 x 64 preset changes the panel, the number boxes and the saved settings', s.cols === 128 && s.rows === 64 && s.c.ledCols === 128 && s.c.ledRows === 64 && s.box.join() === '128,64', JSON.stringify(s.box));
  await h.page.fill('#ledCols', '48'); await h.page.fill('#ledRows', '24');
  await h.page.evaluate(() => document.getElementById('ledRows').dispatchEvent(new Event('change', { bubbles: true })));
  await h.page.waitForTimeout(600);
  s = await h.page.evaluate(() => ({ cols: window.__sky.glass.led.cols, rows: window.__sky.glass.led.rows, preset: document.getElementById('ledPreset').value, mode: document.body.dataset.led }));
  t.check('typing 48 and 24 gives a 48 x 24 panel, and the preset menu says Custom', s.cols === 48 && s.rows === 24 && s.preset === 'custom' && s.mode === 'row', JSON.stringify(s));
  await h.page.fill('#ledCols', '5000');
  await h.page.evaluate(() => document.getElementById('ledCols').dispatchEvent(new Event('change', { bubbles: true })));
  s = await h.page.evaluate(() => JSON.parse(localStorage.getItem('conf')).ledCols);
  t.check('an absurd count is clamped to 256', s === 256, String(s));
  await h.page.evaluate(() => { const e = document.getElementById('ledTurn'); e.checked = false; e.dispatchEvent(new Event('change', { bubbles: true })); });
  t.check('"Turn to match the screen" can be switched off and is saved', await h.page.evaluate(() => JSON.parse(localStorage.getItem('conf')).ledTurn) === false);
  await h.close();

  // ---- stars: the LED averaging used to lose them ----
  const countStars = async (query, conf) => {
    const hh = await t.open({ query: `${query}&speed=0&landscape=hills&az=200&pitch=35`, width: 900, height: 500, conf: { screenMode: 'led', ledCols: 64, ledRows: 32, clockStyle: 'solid', hideSeconds: true, followSun: false, plants: false, countdown: 'off', cloudMotion: 0, weatherMode: 'clear', ...conf } });
    await hh.settle(2800);
    const shot = await hh.shot();
    const n = await t.analyze(hh.page, shot, ({ w, h: H, lum }) => {
      const cols = 64, rows = 32, cell = Math.floor(Math.min(w / cols, H / rows)), ox = Math.floor((w - cols * cell) / 2), oy = Math.floor((H - rows * cell) / 2);
      const L = []; for (let j = 0; j < rows; j++) { L.push([]); for (let i = 0; i < cols; i++) L[j].push(lum(ox + (i + 0.5) * cell, oy + (j + 0.5) * cell)); }
      const dig = document.getElementById('clock').getBoundingClientRect();
      let stars = 0;
      for (let j = 1; j < rows - 1; j++) for (let i = 1; i < cols - 1; i++) {
        const x = ox + (i + 0.5) * cell, y = oy + (j + 0.5) * cell;
        if (x > dig.left + dig.width * 0.04 && x < dig.right - dig.width * 0.04 && y > dig.top + dig.height * 0.2 && y < dig.bottom - dig.height * 0.2) continue;      // the digits and their glow
        let top = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (di || dj) top = Math.max(top, L[j + dj][i + di]);
        if (L[j][i] > 0.22 && L[j][i] - top > 0.12) stars++;                                  // a lone bright LED in dark surroundings
      }
      return stars;
    });
    const errs = hh.errors.join(' | ');
    await hh.close();
    return { n, errs };
  };
  const dark = 't=2026-06-22T05:30:00Z&weather=clear&lp=1';
  const off = await countStars(dark, { ledStars: 'off' }), auto = await countStars(dark, { ledStars: 'auto' }), always = await countStars(dark, { ledStars: 'always' });
  t.check('LED panel, dark sky at night: with Stars off there are (almost) no lone bright LEDs in the sky', off.n <= 3, `${off.n}`);
  t.check('Automatic: the stars the normal picture shows are lit (at least 12 lone bright LEDs, not a flood)', auto.n >= 12 && auto.n <= 200, `${auto.n}`);
  t.check('Always shows at least as many as Automatic', always.n >= auto.n, `${always.n} vs ${auto.n}`);
  const day = await countStars('t=2026-06-21T16:00:00Z&weather=clear&lp=1', { ledStars: 'always' });
  t.check('by day there are none, even with "Always" (no stars in a blue sky)', day.n <= 2, `${day.n}`);
  const city = await countStars('t=2026-06-22T05:30:00Z&weather=clear&lp=9', { ledStars: 'auto' });
  t.check('a bright city sky shows fewer stars than a dark one (the rule is the normal picture\'s own visibility)', city.n < auto.n * 0.7, `${city.n} vs ${auto.n}`);
  t.check('stars: no errors', !off.errs && !auto.errs && !always.errs && !day.errs && !city.errs, [off.errs, auto.errs].join(' '));
}
