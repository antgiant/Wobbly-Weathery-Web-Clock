// "Install as an app": the browser's install prompt where there is one (Chrome, Edge, Android), and the Share-menu
// instructions on iPhone / iPad, where there is no prompt. Nothing is shown once the page already runs as an app.

const group = () => document.getElementById('installGroup');
const button = () => document.getElementById('installButton');
const hint = () => document.getElementById('installHint');

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isApple = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let deferred = null;

function show(text, withButton) {
  if (standalone() || !group()) return;
  group().hidden = false;
  hint().textContent = text;
  button().hidden = !withButton;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();                                   // keep it for our own button
  deferred = e;
  show('Runs full screen like an app, from your home screen or dock, and keeps working without a connection.', true);
});

window.addEventListener('appinstalled', () => { deferred = null; if (group()) group().hidden = true; });

document.addEventListener('DOMContentLoaded', () => {
  button()?.addEventListener('click', async () => {
    if (!deferred) { if (isApple() && !standalone()) openSteps(); return; }
    deferred.prompt();
    try { await deferred.userChoice; } catch (_) { /* dismissed */ }
    deferred = null;
    button().hidden = true;
  });
  if (deferred) show('Runs full screen like an app, from your home screen or dock, and keeps working without a connection.', true);
  else if (isApple() && !standalone()) {
    show('Runs full screen like an app, from your home screen, and keeps working without a connection. Safari has no install button, so this shows you the steps.', true);
    button().textContent = 'Show me how';
  }
  document.getElementById('installDone')?.addEventListener('click', closeSteps);
  document.querySelector('[data-close-install]')?.addEventListener('click', closeSteps);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal()?.hidden) closeSteps(); });
});

// ---- iPhone / iPad: a dialog with the three steps (there is no install prompt to call) ----
const modal = () => document.getElementById('installModal');
function openSteps() {
  const m = modal();
  if (!m) return;
  const safari = /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios|opios|gsa\//i.test(navigator.userAgent);
  document.getElementById('installNote').textContent = safari ? '' : 'You are not in Safari. On iOS 16.4 and later the Share menu of other browsers also has “Add to Home Screen”; on older versions open this page in Safari.';
  m.hidden = false;
  document.getElementById('installDone')?.focus();
}
function closeSteps() { const m = modal(); if (m) m.hidden = true; button()?.focus(); }
