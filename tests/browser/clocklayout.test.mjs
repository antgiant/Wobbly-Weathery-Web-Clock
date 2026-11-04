// js/clocklayout.js (the digits' boxes as a pure function, used where there is no CSS engine) against the real page: for several window sizes
// and settings, each digit's box from the function must equal getBoundingClientRect() within a pixel.
export const name = 'clocklayout';
export const covers = 'The pure clock layout function equals the browser\'s own layout (normal row, no seconds, LED row, LED stack, several sizes)';
export const tier = 'deep';

const NOON = 't=2026-06-21T17:00:00Z&speed=0';
const cases = [
  { label: 'wide window', w: 1280, h: 720, conf: {} },
  { label: 'phone', w: 420, h: 800, conf: {} },
  { label: 'no seconds', w: 1280, h: 720, conf: { hideSeconds: true } },
  { label: 'no seconds, phone', w: 390, h: 844, conf: { hideSeconds: true } },
  { label: '24-hour, narrow', w: 700, h: 700, conf: { twentyFourHourClock: true } },
  { label: 'LED 64x32 wide (row)', w: 1000, h: 560, conf: { screenMode: 'led', ledCols: 64, ledRows: 32, clockStyle: 'solid', twentyFourHourClock: true } },
  { label: 'LED 64x32 upright (stack)', w: 400, h: 800, conf: { screenMode: 'led', ledCols: 64, ledRows: 32, clockStyle: 'solid', twentyFourHourClock: true } },
  { label: 'LED 128x64 (row)', w: 1000, h: 560, conf: { screenMode: 'led', ledCols: 128, ledRows: 64, clockStyle: 'solid', twentyFourHourClock: true } },
];

export async function run(t) {
  for (const [i, c] of cases.entries()) {
    if (t.quick && i >= 2) break;
    const h = await t.open({ fast: true, query: NOON, width: c.w, height: c.h, conf: c.conf });
    await h.settle(600);
    const r = await h.page.evaluate(async () => {
      const { layoutClock } = await import('/js/clocklayout.js');
      const clock = document.getElementById('clock'), cs = getComputedStyle(clock), body = document.body;
      const tr = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform);
      const items = [...clock.querySelectorAll('svg')].map((el) => ({ hidden: getComputedStyle(el).display === 'none', width: el.style.width, marginRight: el.style.marginRight, hundreds: el.id === 'hundredsDigit', colon: !el.querySelector('path[id]') }));
      const led = body.dataset.led ? { mode: body.dataset.led, aspect: parseFloat(body.style.getPropertyValue('--led-aspect')) || 2, top: parseFloat(body.style.getPropertyValue('--led-top')) || 0, units: parseFloat(clock.style.getPropertyValue('--units')) || 7, rows: parseFloat(clock.style.getPropertyValue('--rows')) || 3 } : null;
      const pill = parseFloat(document.documentElement.style.getPropertyValue('--pill-room')) || 0;
      const got = layoutClock({ vw: innerWidth, vh: innerHeight, pillRoom: pill, burn: [tr.m41, tr.m42], marginLeft: clock.style.marginLeft, led, items });
      const real = [...clock.querySelectorAll('svg')].map((el, k) => { const b = el.getBoundingClientRect(); return items[k].hidden ? null : [b.left, b.top, b.width, b.height]; });
      const cb = clock.getBoundingClientRect();
      return { got, real, box: [cb.left, cb.top, cb.width, cb.height], mode: led && led.mode };
    });
    let worst = 0, where = '';
    r.real.forEach((rr, k) => {
      const g = r.got.rects[k];
      if (!rr && !g) return;
      if (!rr || !g) { worst = 1e9; where = `item ${k + 1} hidden mismatch`; return; }
      rr.forEach((v, j) => { const d = Math.abs(v - g[j]); if (d > worst) { worst = d; where = `item ${k + 1} component ${j}: page ${v.toFixed(2)}, function ${g[j].toFixed(2)}`; } });
    });
    t.check(`${c.label}${r.mode ? ' [' + r.mode + ']' : ''}: every digit's box matches the page's (worst ${worst.toFixed(2)} px)`, worst < 1.5, where);
    await h.close();
  }
}
