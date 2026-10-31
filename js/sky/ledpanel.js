// Applies the LED panel's size to the page: works out the grid for this screen (ledgrid.js), tells the renderer, and sets
// what the stylesheet needs to lay the clock out inside the panel: body[data-led] = row | stack | fit, --led-aspect.

import { conf } from '../config.js';
import { panelFor } from './ledgrid.js';
import { engine, canvas } from './core.js';

let current = null;

/** The panel as drawn now ({cols, rows, mode, tuned, turned, shrunk, aspect}), or null when the LED look is off. */
export const ledPanel = () => current;

export function applyLedPanel() {
  const body = document.body;
  if (!engine || conf.screenMode !== 'led') {
    if (current) { current = null; body.removeAttribute('data-led'); body.style.removeProperty('--led-aspect'); }
    return;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.max(2, Math.round(canvas.clientWidth * dpr)), ch = Math.max(2, Math.round(canvas.clientHeight * dpr));
  const p = panelFor(conf, cw, ch);
  const changed = !current || current.cols !== p.cols || current.rows !== p.rows || current.mode !== p.mode;
  current = p;
  engine.glass.led.cols = p.cols;
  engine.glass.led.rows = p.rows;
  body.dataset.led = p.mode;
  body.style.setProperty('--led-aspect', p.aspect.toFixed(4));
  const info = document.getElementById('ledInfo');
  if (info) {
    info.textContent = `Showing ${p.cols} × ${p.rows} LEDs` + (p.turned ? ' (turned to match the screen)' : '') + (p.shrunk ? ', reduced so every LED is at least 3 pixels' : '') +
      (p.tuned ? '.' : '. This size is shown exactly like the normal clock, just made of LEDs.');
  }
  if (changed) {
    engine.dirty = true;
    window.dispatchEvent(new Event('clocklayout'));
  }
}

let raf = 0;
const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; applyLedPanel(); }); };
window.addEventListener('resize', later);
window.addEventListener('orientationchange', later);
window.addEventListener('clocklayout', later);          // the clock changed (seconds shown or hidden): the best arrangement may too
