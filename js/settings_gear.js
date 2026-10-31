import { conf } from './config.js';

// global variables for settings gear state
const settingsEl = document.getElementById('settings');
// floating buttons that fade out together with the gear when the page is idle
const fadeEls = () => [settingsEl, ...document.querySelectorAll('.fab')];

// How long to wait with no activity before hiding settings gear (ms)
const IDLE_MS = 5000;
let hideTimerId = null;
let isHidden = false;
const modal = document.getElementById('settingsModal');
const closeBtn = modal.querySelector('.modal__close');
const tabs = [...modal.querySelectorAll('.tab')];
const panels = [...modal.querySelectorAll('.panel')];
let lastActive = null;

function initalize() {
  //Set up settings gear hiding
  // Consider these as “activity”:
  const activityEvents = [
    'mousemove',
    'mousedown',
    'mouseup',
    'wheel',
    'scroll',
    'keydown',
    'keyup',
    'touchstart',
    'touchmove',
    'pointerdown',
    'pointermove'
  ];
  
  // Use passive listeners where appropriate for performance
  const passiveOpts = { passive: true };
  
  activityEvents.forEach(evt => {
    window.addEventListener(evt, resetIdleTimer, passiveOpts);
  });
  
  // If the page/tab becomes visible again, treat that as activity
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resetIdleTimer();
  });
  
  // Keep the button visible while the user interacts with it directly
  settingsEl.addEventListener('mouseenter', showSettings, passiveOpts);
  settingsEl.addEventListener('focusin', showSettings);
  settingsEl.addEventListener('pointerenter', showSettings, passiveOpts);
  settingsEl.addEventListener('pointerdown', showSettings, passiveOpts);
  
  // Start the initial timer on load
  resetIdleTimer();
  
  const openTrigger = document.getElementById('settings');
  // Open via click
  openTrigger.addEventListener('click', openModal);
  
  // Open via keyboard (Enter/Space) on the SVG “button”
  openTrigger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openModal();
    }
  });
  
  initTabs();
  initLevel();
  initAdjusting();

  const backdrop = modal.querySelector('.modal__backdrop');
  
  // Close via X button or clicking the backdrop
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => {
    if (e.target.dataset.close === 'true') closeModal();
  });
}

// ---- tabs (WAI-ARIA tabs pattern: arrow keys move between them) ----
function selectTab(name, focus = false) {
  if (!tabs.some(t => t.dataset.tab === name)) name = tabs[0].dataset.tab;
  tabs.forEach(t => {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  });
  panels.forEach(p => { p.hidden = p.dataset.panel !== name; });
  modal.querySelector('.modal__body').scrollTop = 0;
}

function initTabs() {
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      const k = e.key;
      const to = k === 'ArrowRight' || k === 'ArrowDown' ? i + 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? i - 1 : k === 'Home' ? 0 : k === 'End' ? tabs.length - 1 : null;
      if (to == null) return;
      e.preventDefault();
      selectTab(tabs[(to + tabs.length) % tabs.length].dataset.tab, true);
    });
  });
  selectTab('presets');                          // every visit starts on the presets
}

// ---- Simple / Advanced ----
function setLevel(level) {
  level = level === 'advanced' ? 'advanced' : 'simple';
  modal.dataset.level = level;
  modal.querySelectorAll('.seg__btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.level === level)));
  conf.settingsLevel = level;
}

function initLevel() {
  modal.querySelectorAll('.seg__btn').forEach(b => b.addEventListener('click', () => setLevel(b.dataset.level)));
  setLevel(conf.settingsLevel);
}

// On a phone the sheet covers the clock; while a slider is held it fades away so the change can be seen.
function initAdjusting() {
  let t = 0;
  const on = () => { clearTimeout(t); modal.classList.add('adjusting'); };
  const off = () => { clearTimeout(t); t = setTimeout(() => modal.classList.remove('adjusting'), 450); };
  modal.addEventListener('pointerdown', (e) => { if (e.target.matches('input[type="range"]')) on(); });
  ['pointerup', 'pointercancel'].forEach(ev => window.addEventListener(ev, () => { if (modal.classList.contains('adjusting')) off(); }));
}

// management of Settings gear hiding and showing
function showSettings() {
  if (isHidden) {
    fadeEls().forEach(el => el.classList.remove('is-hidden'));
    isHidden = false;
  }
}

function hideSettings() {
  if (!isHidden) {
    fadeEls().forEach(el => el.classList.add('is-hidden'));
    isHidden = true;
  }
}

function resetIdleTimer() {
  // Any activity should show the control immediately
  showSettings();
  if (hideTimerId !== null) {
    clearTimeout(hideTimerId);
  }
  hideTimerId = setTimeout(hideSettings, IDLE_MS);
}

function openModal() {
  lastActive = document.activeElement;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  // Focus inside the modal
  setTimeout(() => {
    (modal.querySelector('.tab[aria-selected="true"]') || closeBtn || modal).focus();
  }, 0);
  document.addEventListener('keydown', onKeydown);
}

function closeModal() {
  modal.hidden = true;
  modal.classList.remove('adjusting');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onKeydown);
  if (lastActive && typeof lastActive.focus === 'function') {
    lastActive.focus();
  }
}

function onKeydown(e) {
  // ESC closes
  if (e.key === 'Escape') {
    e.preventDefault();
    closeModal();
  }
  // Simple focus trap: keep focus inside modal
  if (e.key === 'Tab') {
    const focusables = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const list = Array.from(focusables).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (list.length === 0) return;
    const first = list[0],
      last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

initalize();