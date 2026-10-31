// Anti burn-in. A clock that is on all night draws the same bright shapes in the same place for hours, which can leave
// a ghost of them on an OLED screen. While the screen is kept on, the digits (and the sunrise / umbrella pills) step a
// few pixels round a small square, one step a minute, just as the minute digit changes. It is too small and too slow to
// notice, but no pixel carries the same edge for long. In the LED look the steps are whole LEDs.
//   Automatic  while "Keep the screen on" is on     Always     whatever the screen does     Never

import { conf } from '../config.js';
import { engine } from './core.js';
import { ledPanel } from './ledpanel.js';

// a walk round the centre and its eight neighbours
export const PATH = [[0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

export const burnInOn = (c = conf) => c.antiBurnIn === 'on' || (c.antiBurnIn !== 'off' && !!c.keepAwake);

/**
 * How far a step moves, in px: about 1.2% of the short side of the screen (3 to 10 px), but never more than half the room
 * the digits have to the edge (so they cannot be cropped). `unit` makes it a whole number of units (an LED), and 0 when there is not room for one.
 */
export function amplitude(short, room, unit = 0) {
  let a = Math.min(Math.max(3, Math.min(10, short * 0.012)), room / 2);
  if (unit > 0) a = a >= unit ? Math.floor(a / unit) * unit : (room / 2 >= unit * 0.99 ? unit : 0);
  return Math.max(0, a);
}

let step = 0, shown = false;

function setOffset(x, y) {
  const r = document.documentElement.style;
  r.setProperty('--burn-x', `${x}px`); r.setProperty('--burn-y', `${y}px`);
  shown = x !== 0 || y !== 0;
  window.dispatchEvent(new Event('clocklayout'));            // the glass measures the digits again
}

/** Room the digits have on every side, in px, ignoring the offset they have now. */
function room() {
  const clock = document.getElementById('clock');
  if (!clock) return 0;
  const cs = document.documentElement.style, ox = parseFloat(cs.getPropertyValue('--burn-x')) || 0, oy = parseFloat(cs.getPropertyValue('--burn-y')) || 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  clock.querySelectorAll('svg').forEach((el) => {
    if (getComputedStyle(el).display === 'none') return;
    const r = el.getBoundingClientRect();
    if (r.width < 1) return;
    x0 = Math.min(x0, r.left - ox); x1 = Math.max(x1, r.right - ox); y0 = Math.min(y0, r.top - oy); y1 = Math.max(y1, r.bottom - oy);
  });
  if (!Number.isFinite(x0)) return 0;
  const W = innerWidth, H = innerHeight;
  return Math.max(0, Math.min(x0, W - x1, y0, H - y1));
}

/** One step of the walk (or back to the middle when it is off). Run once a minute by the scheduler. */
export function updateBurnIn() {
  if (!burnInOn()) { if (shown) setOffset(0, 0); step = 0; return; }
  const panel = ledPanel();
  const short = Math.min(innerWidth, innerHeight);
  const cell = panel && engine ? Math.min(engine.canvas.clientWidth / panel.cols, engine.canvas.clientHeight / panel.rows) : 0;
  const a = amplitude(short, room(), cell);
  step = (step + 1) % PATH.length;
  const [dx, dy] = PATH[step];
  setOffset(Math.round(dx * a * 100) / 100, Math.round(dy * a * 100) / 100);
}

/** ms to the next minute boundary: the step then hides in the minute digit changing. */
export const toNextMinute = () => 60000 - (Date.now() % 60000) + 300;
export const burnInPeriod = () => (burnInOn() ? 60000 : (shown ? 2000 : Infinity));
