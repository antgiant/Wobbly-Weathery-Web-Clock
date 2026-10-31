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
