import { msUntilQuiet } from './quiet.js';
// Offline status: whether the app is saved on the device (so it opens with no connection), whether the connection is
// up, and what that means for the live extras (weather, terrain, rain) that refresh by themselves when it returns.

const el = () => document.getElementById('offlineStatus');

let saved = null;          // {cached, total} from the service worker, or false when there is none
function ask(type) {
  return new Promise((resolve) => {
    const ctl = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!ctl) { resolve(null); return; }
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => resolve(e.data);
    ctl.postMessage({ type }, [ch.port2]);
    setTimeout(() => resolve(null), 4000);
  });
}

function render() {
  if (!el()) return;
  const online = navigator.onLine !== false;
  let line;
  if (!('serviceWorker' in navigator)) line = 'Offline use is not available in this browser.';
  else if (saved === false) line = 'Not saved for offline use yet: open the page once with a connection.';
  else if (!saved) line = 'Saving for offline use…';
  else if (saved.cached >= saved.total) line = `Saved on this device (${saved.total} files): it opens and runs with no connection.`;
  else line = `Saving for offline use… ${saved.cached} of ${saved.total} files so far.`;
  el().textContent = line + (online ? '' : ' You are offline now: the clock, sun, moon and stars keep working; weather, terrain and rain use what was last saved and refresh by themselves when a connection returns.');
}

async function check(type = 'status') {
  saved = await ask(type);
  if (!saved && 'serviceWorker' in navigator && !navigator.serviceWorker.controller) saved = location.hostname === 'localhost' && !/[?&]sw=1/.test(location.search) ? false : null;
  render();
}

document.addEventListener('DOMContentLoaded', () => {
  render();
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(() => check()).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => check());
  window.addEventListener('online', () => { check('ensure'); render(); });     // fill in anything a flaky first visit missed
  window.addEventListener('offline', render);
});

// "Update and reload": an installed app has no reload button or pull-down, and it opens from the saved copy while it
// fetches the new one in the background (so a fix arrives on the launch after next). This fetches everything again now and reloads.
async function refreshApp() {
  const b = document.getElementById('refreshApp'), note = document.getElementById('refreshNote');
  if (b) b.disabled = true;
  if (note) note.textContent = navigator.onLine === false ? 'You are offline: nothing new can be fetched. Reloading what is saved…' : 'Fetching the newest files…';
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (navigator.onLine !== false) { await reg?.update(); await ask('refresh'); }
  } catch (_) { /* reload anyway */ }
  location.reload();
}
document.addEventListener('DOMContentLoaded', () => document.getElementById('refreshApp')?.addEventListener('click', refreshApp));

// The saved copy opens first, and the newer one is fetched behind it. When the service worker finds a file has changed it
// says so, and this offers the reload (a banner at the top, so a clock left running on a shelf is never reloaded by surprise).
let kioskTimer = 0;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'updated') return;
    if (document.documentElement.dataset.kiosk) {                      // a sign nobody can tap: update by itself, in the quiet hour (3 at night)
      if (!kioskTimer) kioskTimer = setTimeout(() => location.reload(), msUntilQuiet());
      return;
    }
    autoApply();
  });
}

// A new version is applied by itself, at a moment that cannot lose anything: no dialog or settings screen open, nothing being typed, no finger on the screen. If one of
// those is going on it waits (the banner offers the update by hand meanwhile) and applies the moment the last one is done. One automatic reload a minute at most, so a
// copy that comes back old (a slow connection) cannot loop; the banner stays as the manual way.
let pointerDown = false, waiting = 0;
addEventListener('pointerdown', () => { pointerDown = true; }, true);
addEventListener('pointerup', () => { pointerDown = false; }, true);
addEventListener('pointercancel', () => { pointerDown = false; }, true);
export function updateSafe() {
  const a = document.activeElement, shared = document.getElementById('sharedBanner');                 // (a shared setup waiting to be used or not is a decision half made too)
  return !document.querySelector('.modal:not([hidden])') && !pointerDown && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) && (!shared || shared.hidden);
}
function autoApply() {
  const b = document.getElementById('updateBanner');
  let last = 0; try { last = +sessionStorage.getItem('autoUpdateAt') || 0; } catch (_) { /* no session storage */ }
  if (Date.now() - last < 60000) { if (b) b.hidden = false; return; }               // just did one: only offer it
  if (updateSafe()) { try { sessionStorage.setItem('autoUpdateAt', String(Date.now())); } catch (_) { /* fine */ } refreshApp(); return; }
  if (b) b.hidden = false;                                                           // busy: offer it, and apply when the busy moment ends
  if (!waiting) waiting = setInterval(() => { if (updateSafe()) { clearInterval(waiting); waiting = 0; autoApply(); } }, 1500);
}
document.addEventListener('DOMContentLoaded', () => document.getElementById('updateBanner')?.addEventListener('click', refreshApp));

// ---- the version: which copy of the app is running, and whether the server has a newer one ----
const V = globalThis.APP_VERSION;
const parse = (t) => { const n = /number: (\d+)/.exec(t), h = /hash: '([0-9a-f]+)'/.exec(t); return n && h ? { number: +n[1], hash: h[1] } : null; };
async function showVersion() {
  const line = document.getElementById('versionLine'), newest = document.getElementById('versionNewest');
  if (line) line.textContent = V ? `Version ${V.number} (${V.hash}), built ${V.built}. This is the copy of the app running now.` : 'Version unknown (js/version.js did not load).';
  if (!newest || !V) return;
  if (navigator.onLine === false) { newest.textContent = 'Offline: cannot check for a newer version.'; return; }
  newest.textContent = 'Checking the server for a newer version…';
  try {
    const r = await fetch('js/version.js', { cache: 'no-store' });
    const s = parse(await r.text());
    if (!s) newest.textContent = 'Could not read the newest version.';
    else if (s.hash === V.hash) newest.textContent = `The server has the same version (${s.number}): you are up to date.`;
    else if (s.number > V.number) { newest.textContent = `The server has a newer version: ${s.number} (${s.hash}). It is applied by itself when you close this; or use "Update and reload" below.`; autoApply(); }
    else newest.textContent = `The server has version ${s.number} (${s.hash}), which differs from yours.`;
  } catch (_) { newest.textContent = 'Could not reach the server to check.'; }
}
if (V) { document.documentElement.dataset.version = String(V.number); window.__version = V; }
document.addEventListener('DOMContentLoaded', () => {
  showVersion();
  document.getElementById('settings')?.addEventListener('click', showVersion);        // look again each time Settings opens
});
