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
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch (_) { /* dismissed */ }
    deferred = null;
    button().hidden = true;
  });
  if (deferred) show('Runs full screen like an app, from your home screen or dock, and keeps working without a connection.', true);
  else if (isApple() && !standalone()) show('To install on an iPhone or iPad: open the Share menu in Safari, then choose Add to Home Screen. It then runs full screen like an app.', false);
});
