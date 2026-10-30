// Keep the screen on.
//
// Two mechanisms, because neither is reliable everywhere:
//  1. The Screen Wake Lock API.
//  2. A silent looping video. Browsers treat a playing, visible video as "someone is watching" and do
//     not dim or lock. Chrome only counts a video of at least ~200x140 px, so it is a real 256x144
//     clip, parked behind the (opaque) sky canvas where nobody sees it.
// On Apple devices both run together: Safari can grant a wake lock and still let the screen sleep
// (notably in Home Screen web apps), and the video is what actually holds it.
//
// Both need a *user activation*. On a touch screen only click / touchend / pointerup / keydown count
// (pointerdown does not), so the request is retried on every such gesture until it works, a visible
// banner asks for the tap, and Settings says which mechanism is active and why anything failed.
import { conf } from './config.js';

const supported = 'wakeLock' in navigator;
const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// iOS Home Screen web apps: Apple's Wake Lock has never worked there (WebKit bug 254545), so the video does the work
const standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
const MP4 = 'data:video/mp4;base64,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';
const WEBM = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAN3EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEfTbuMU6uEHFO7a1OsggNP7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECfQAAAAAAAFlSua8KuAQAAAAAAADnXgQFzxYjs6F+jp3fn15yBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgirCCAQC6gZCagQISVMNn/HNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjAuMTYuMTAwc3PWY8CLY8WI7Ohfo6d359dnyKFFo4dFTkNPREVSRIeUTGF2YzYwLjMxLjEwMiBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAyLjAwMDAwMDAwMAAfQ7Z1QanngQCj4YEAAIDQCQCdASoAAZAAAEcIhYWIhYSIAgIABhYE9waBZJ9r25snOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOGQA/v+rUICjmoEAyABRAgABEBAAGAAYWC/0AAiABnlw7SAAo5qBAZAAUQIAARAQABgAGFgv9AAIgAZ5cO0gAKOagQJYAFECAAEQEAAYABhYL/QACIAGeXDtIACjmoEDIABRAgABEBAAGAAYWC/0AAiABnlw7SAAo+GBA+iA0AkAnQEqAAGQAABHCIWFiIWEiAICAAYWBPcGgWSfa9ubJzh7Jzh7Jzh7Jzh7Jzh7Jzh7Jzh7Jzh7Jzh7Jzh7Jzh7Jzh7Jzh7Jzh7Jzh7Jzh7Jzh7JzhkAP7/q1CAo5qBBLAAUQIAARAQABgAGFgv9AAIgAZ5cO0gAKOagQV4AFECAAEQEAAYABhYL/QACIAGeXDtIACjmoEGQABRAgABEBAAGAAYWC/0AAiABnlw7SAAo5qBBwgAUQIAARAQABgAGFgv9AAIgAZ5cO0gABxTu2uju4+zgQC3iveBAfGCAaDwgQO7kLOCA+i3iveBAfGCAaDwgdY=';
const BASE = 'Stops the phone dimming and locking while this page is open, handy as a bedside or travel clock. It lasts only while the page is visible, and it uses battery, so plug in if you can.';

let sentinel = null;
let video = null;
let wanted = false;
let busy = false;
let lastError = '';

const box = () => document.getElementById('keepAwake');
const note = () => document.getElementById('wakeStatus');
const banner = () => document.getElementById('wakeBanner');
const lockOn = () => !!sentinel;
const videoOn = () => !!(video && !video.paused && !video.ended);
// Apple needs the video as well; everywhere else either mechanism is enough
const holding = () => (apple ? videoOn() : lockOn() || videoOn());

function describe() {
  if (!wanted) return '';
  const how = [lockOn() ? 'Wake Lock' : '', videoOn() ? 'video' : ''].filter(Boolean).join(' + ');
  const where = apple ? (standalone ? ' [iPhone Home Screen app]' : ' [iPhone Safari]') : '';
  if (holding()) return `Active (${how})${where}: the screen will stay on.`;
  if (document.hidden) return 'Paused while the page is hidden.';
  if (lastError) return `Not holding yet (${lastError}). Tap the page. If it keeps failing, turn off Low Power Mode / battery saver${standalone && apple ? ', or open this page in Safari instead of the Home Screen app' : ''}.`;
  return 'Tap anywhere on the page to switch it on (the browser requires a touch).';
}

function ui() {
  if (note()) note().textContent = `${BASE} ${describe()}`.trim();
  const b = banner();
  if (b) b.hidden = !(wanted && !holding() && !document.hidden);     // ask for a tap while it is wanted but not running
}

function startVideo() {
  if (!video) {
    video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('muted', '');
    video.muted = true; video.loop = true; video.preload = 'auto';
    video.setAttribute('aria-hidden', 'true');
    // real size and fully "visible" (browsers ignore tiny or display:none videos), but behind the sky canvas
    video.style.cssText = 'position:fixed;left:0;bottom:0;width:256px;height:144px;z-index:-1;pointer-events:none;';
    for (const [src, type] of [[MP4, 'video/mp4'], [WEBM, 'video/webm']]) {   // MP4 first: Safari can claim WebM and then fail to play it
      const s = document.createElement('source'); s.src = src; s.type = type; video.appendChild(s);
    }
    video.addEventListener('pause', ui);
    video.addEventListener('playing', ui);
    video.addEventListener('error', () => { lastError = `video error ${video.error ? video.error.code : '?'}`; ui(); });
    video.addEventListener('stalled', () => { if (!videoOn()) { lastError = 'video stalled'; ui(); } });
    document.body.appendChild(video);
  }
  return video.play().then(() => true, (e) => { lastError = e && e.name || 'video blocked'; return false; });
}

/** @param {boolean} gesture true when called from a click / touch / key handler */
async function acquire(gesture) {
  if (!wanted || document.hidden || busy || holding()) return;
  busy = true;
  lastError = '';
  if (supported && !sentinel) {
    try {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        sentinel = null; ui();
        // the system let go while we are still on screen (battery saver, an alarm...): ask again
        if (wanted && !document.hidden) setTimeout(() => acquire(false), 800);
      });
    } catch (e) { sentinel = null; if (gesture) lastError = e.name || 'Wake Lock refused'; }   // a refusal before any touch is normal, not an error
  }
  // the video is the fallback everywhere and a companion on Apple devices; it can only start from a gesture
  if (gesture && (apple || !sentinel) && !videoOn()) await startVideo();
  busy = false;
  ui();
}

async function release() {
  try { await sentinel?.release(); } catch (_) { /* already released */ }
  sentinel = null;
  if (video) video.pause();
  lastError = '';
  ui();
}

function set(on) {
  wanted = on;
  conf.keepAwake = on;
  if (on) acquire(true);                  // we are inside the checkbox's click, so this counts as a gesture
  else release();
}

function init() {
  const el = box();
  if (!el) return;
  el.checked = !!conf.keepAwake;
  wanted = el.checked;
  el.addEventListener('change', () => set(el.checked));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { sentinel = null; acquire(false); }      // browsers drop the lock when hidden
    ui();
  });
  // Events that grant user activation on touch devices. Keep listening: a request can be refused
  // (or the lock released by the system) at any time and be retried on the next tap.
  const retry = () => { if (wanted && !holding()) acquire(true); };
  for (const type of ['click', 'touchend', 'pointerup', 'keydown']) window.addEventListener(type, retry, { passive: true });
  banner()?.addEventListener('click', retry);
  if (!supported && !('HTMLVideoElement' in window)) { el.disabled = true; }
  ui();
  if (wanted) acquire(false);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
