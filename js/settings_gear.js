// global variables for settings gear state
const settingsEl = document.getElementById('settings');

// How long to wait with no activity before hiding settings gear (ms)
const IDLE_MS = 5000;
let hideTimerId = null;
let isHidden = false;
const modal = document.getElementById('settingsModal');
const closeBtn = modal.querySelector('.modal__close');
const firstFocusable = modal.querySelector('#easing'); // auto-focus target
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
  
  const backdrop = modal.querySelector('.modal__backdrop');
  
  // Close via X button or clicking the backdrop
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => {
    if (e.target.dataset.close === 'true') closeModal();
  });
}

// management of Settings gear hiding and showing
function showSettings() {
  if (isHidden) {
    settingsEl.classList.remove('is-hidden');
    isHidden = false;
  }
}

function hideSettings() {
  if (!isHidden) {
    settingsEl.classList.add('is-hidden');
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
    (firstFocusable || closeBtn || modal).focus();
  }, 0);
  document.addEventListener('keydown', onKeydown);
}

function closeModal() {
  modal.hidden = true;
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