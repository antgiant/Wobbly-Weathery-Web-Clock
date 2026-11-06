// The settings screens follow the capability ladder (capability.js): an option whose feature the device has given up is greyed out with a note until it can have it back, so nobody
// is left changing something that has no effect. The settings themselves are not touched (when the feature comes back they apply again); only the controls change.
import { conf } from '../config.js';
import { givenUp } from './capability.js';

const NOTE = {
  weather: 'Off for now: this device cannot keep up with rain and snow in motion.',
  ambient: 'Off for now: this device cannot keep up with the motion of clouds, water and plants.',
  seconds: 'Off for now: this device cannot keep up with the seconds.',
  glass: 'Off for now: this device cannot keep up with the glass; the digits are solid.',
  landscape: 'Off for now: this device cannot keep up with the landscape.',
  sky: 'Off for now: this device cannot keep up with the sky; it is a gradient.',
};
const HELD = 'Off while Adapt to this device holds the clock at a simpler step (Quality).';

const marked = new Map();                              // key -> the element that was disabled, to give it back

/** Greys out (and explains) the controls the ladder has taken away; gives back the ones it has returned. `held`: the user holds the ladder at a step (the note says so). */
export function applyLadderUi(k, held = false) {
  const off = givenUp(k);
  for (const [key, el] of [...marked]) {
    if (key in off) continue;
    el.disabled = false;
    const field = el.closest('.field') || el.parentElement;
    if (field) { field.classList.remove('ladder-off'); field.querySelector(':scope > .ladder-note, .ladder-note')?.remove(); }
    if (key === 'hideSeconds') el.checked = !!conf.hideSeconds;
    marked.delete(key);
  }
  for (const [key, why] of Object.entries(off)) {
    const el = document.getElementById(key);
    if (!el) continue;
    const field = el.closest('.field') || el.parentElement;
    el.disabled = true;
    if (key === 'hideSeconds') el.checked = true;       // shown on: that is what the clock is doing
    if (field && !field.classList.contains('ladder-off')) {
      field.classList.add('ladder-off');
      const n = document.createElement('small'); n.className = 'ladder-note'; n.textContent = held ? HELD : NOTE[why];
      field.appendChild(n);
    } else if (field) { const n = field.querySelector('.ladder-note'); if (n) n.textContent = held ? HELD : NOTE[why]; }
    marked.set(key, el);
  }
}
