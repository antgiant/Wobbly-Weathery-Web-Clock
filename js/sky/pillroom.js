// Keeps the digits clear of the pills. The pills (rain alert, sunrise / sunset countdown, countdown name) sit at the bottom;
// on a wide screen the digits are as tall as the screen allows, so they would run into them. When the bottom of the digits
// would touch the top of the pills, the clock's box is made a little shorter (--pill-room, read by styles.css), which scales
// the digits down just enough. Where there is room already (upright phones) nothing changes. Measured, not guessed, so it
// works for any aspect ratio, either seconds setting and any number of pills.

const GAP = 12;                                           // px of clear space between the digits and the pills

function inkBottom() {
  let bottom = -Infinity;
  document.querySelectorAll('#clock svg').forEach((svg) => {
    if (getComputedStyle(svg).display === 'none' || !svg.querySelector('path[id]')) return;
    const r = svg.getBoundingClientRect(), pad = r.width * 0.08;           // half the stroke
    svg.querySelectorAll('path').forEach((p) => { bottom = Math.max(bottom, p.getBoundingClientRect().bottom + pad); });
  });
  return bottom;
}

let room = 0;
function setRoom(px) {
  px = Math.max(0, Math.round(px));
  if (px === room) return false;
  room = px;
  document.documentElement.style.setProperty('--pill-room', px + 'px');
  return true;
}

export function updatePillRoom() {
  const al = document.getElementById('alerts');
  const showing = al && getComputedStyle(al).display !== 'none' && [...al.children].some((c) => !c.hidden);
  let changed = false;
  if (!showing) { changed = setRoom(0); }
  else {
    changed = setRoom(0);                                 // measure from the unconstrained layout, so the answer does not depend on the last one
    for (let i = 0; i < 3; i++) {
      const top = al.getBoundingClientRect().top, bottom = inkBottom();
      const need = bottom + GAP - top;
      if (!(need > 1)) break;
      changed = setRoom(room + need) || changed;
    }
  }
  if (changed) window.dispatchEvent(new Event('clocklayout'));            // the glass measures the digits again
}

export function initPillRoom() {
  const al = document.getElementById('alerts');
  if (!al) return;
  let queued = 0;
  const soon = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; updatePillRoom(); }); };
  new MutationObserver(soon).observe(al, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('resize', soon);
  window.addEventListener('orientationchange', soon);
  window.addEventListener('clocklayout', soon);           // the digits changed size or number (seconds shown / hidden, a countdown)
  window.addEventListener('timerchange', soon);
  soon();
}
