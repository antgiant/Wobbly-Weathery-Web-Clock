// Keep the screen on (Screen Wake Lock API).
//
// Browsers drop the lock whenever the page is hidden, and some only grant it after a user
// gesture, so it is re-requested when the page becomes visible again and on the first tap.
import { conf } from './config.js';

const supported = 'wakeLock' in navigator;
let sentinel = null;
let wanted = false;

const box = () => document.getElementById('keepAwake');
const note = () => document.getElementById('wakeStatus');
const BASE = 'Stops the phone dimming and locking while this page is open, handy as a bedside or travel clock. It lasts only while the page is visible, and it uses battery, so plug in if you can.';

function status(text) { if (note()) note().textContent = text ? `${BASE} ${text}` : BASE; }

async function acquire() {
  if (!supported || !wanted || document.hidden || sentinel) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
    status('Active: the screen will stay on.');
  } catch (e) {
    sentinel = null;
    // typically "NotAllowedError": low-power mode, or no user gesture yet; retried on the next tap
    status(`Could not start yet (${e.name}). Tap the page once, or check that battery saver is off.`);
  }
}

async function release() {
  try { await sentinel?.release(); } catch (_) { /* already released */ }
  sentinel = null;
  status('');
}

function set(on) {
  wanted = on;
  conf.keepAwake = on;
  if (on) acquire(); else release();
}

function init() {
  const el = box();
  if (!el) return;
  if (!supported) {
    el.disabled = true;
    status("This browser can't keep the screen awake from a web page. Chrome, Edge, Safari 16.4+ and recent Firefox can.");
    return;
  }
  el.checked = !!conf.keepAwake;
  wanted = el.checked;
  el.addEventListener('change', () => set(el.checked));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) acquire(); });
  // a saved "on" may be refused until the user interacts with the page
  const retry = () => { if (wanted && !sentinel) acquire(); };
  window.addEventListener('pointerdown', retry, { passive: true });
  window.addEventListener('keydown', retry);
  if (wanted) acquire();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
