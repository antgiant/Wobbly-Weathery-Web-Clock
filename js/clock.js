import { conf, vars, dd, adjustTimeSize, use24h, cap, hideSec } from './config.js';
import { easing } from './easing.js'
import { centreMargin } from './clocklayout.js'
import { now as simNow, getSim } from './simtime.js'
import { sway, topOffset, bend } from './wind.js'
import { wallTime } from './timezone.js'
import { secondsLeft, slotsFor, groupsFor, textOf, parseTarget, unitsFor, defaultTarget, phaseOf, doneSlots } from './countdown.js'

function ci(c, i) {
  var k = i * 6;
  return ["M"].concat(c.slice(k, k + 2), ["C"], c.slice(k + 2, k + 8)).join(" ");
}

var clockChanged = false;
// Hiding / showing the leading hour digit changes how many digits share the row, so the widths
// must be recomputed (this used to be done by a MutationObserver that also fired on every path write).
var layoutStale = false;
function setCurve(id, val, nums, from) {
  var e = document.getElementById(id);
  // skip identical writes: most ticks nothing moves, and the glass renderer redraws on change
  if (e !== null && e.__d !== val) {
    e.__d = val;
    e.__c = nums; e.__ck = from;                  // the same curve as numbers (8 from `from`), so the glass need not read it back out of the string
    e.setAttribute("d", val);
    clockChanged = true;
    if (window.__why) window.__why('a digit path changed: ' + id);
  }
}

// wind sway (wind.js): each digit leans by its own amount, so they do not move as one block
var PHASE = { h0: 0.4, h1: 2.1, m0: 3.7, m1: 5.2, s0: 1.3, s1: 4.4 };
function setDigit(t, d, nowMs) {
  if (sway.mode !== 'off') d = bend(d, topOffset(nowMs, PHASE[t] || 0));
  for (var i = 0; i < 4; i++) {
    setCurve(t + "p" + i, ci(d, i), d, i * 6);
  }
}

function ease(x, t, b, c, d) {
  if (typeof easing !== 'undefined' && typeof easing[conf.easing] === 'function') {
    return easing[conf.easing](x, t, b, c, d);
  }
  return 0;
}

function morph(a, b, s) {
  var e = ease(null, s, 0, 1, conf.steps);      // the same for every number of the digit
  return a.map(function(v, i) {
    return v + e * (b[i] - v);
  });
}

function toDigitArray(str) {
  return str.split('').map(function(v) {
    return parseInt(v);
  });
}

function getTime(date) {
  let h = "";
  const wall = wallTime(date);
  if (use24h()) {
    h = wall.h.toString().padStart(2, "0");
  } else {
    h = (wall.h % 12 || 12).toString().padStart(2, "0");
  }
  const el = document.getElementById("firstDigit");
  if (!use24h() && parseInt(h) < 10) {
    if (el && !el.classList.contains("hidden")) {
      el.classList.add("hidden");
      layoutStale = true;
    }
  } else {
    if (el && el.classList.contains("hidden")) {
      el.classList.remove("hidden");
      layoutStale = true;
    }
  }
  
  let m = wall.m.toString().padStart(2, "0");
  let s = wall.s.toString().padStart(2, "0");
  let temp = {
    'h': toDigitArray(h),
    'm': toDigitArray(m),
    's': toDigitArray(s)
  }
  
  return temp;
}


// ---- countdown mode (countdown.js): the same digits show days:hours:minutes:seconds to a date ----
var cdShown = false, overSince = 0;                         // the digit slots are currently arranged for a countdown
function countdownTarget() {
  return conf.clockMode === 'countdown' ? parseTarget(conf.timerTarget) : NaN;
}
// the countdown has run its day: back to the clock, and the setting says so
function endCountdown() {
  conf.clockMode = 'time';
  window.dispatchEvent(new Event('confreset'));
}
function svgOf(id) { var p = document.getElementById(id); return p ? p.closest('svg') : null; }
function setHidden(el, hide) {
  if (el && el.classList.contains('hidden') !== hide) { el.classList.toggle('hidden', hide); layoutStale = true; }
}
// which digits are on the screen: the third group is the seconds svgs, the second group the minutes, the first may have a hundreds digit
function arrangeCountdown(show) {
  setHidden(document.getElementById('firstDigit'), !show.h0);
  setHidden(document.getElementById('hundredsDigit'), !show.x);
  setHidden(svgOf('m0p0'), !show.m); setHidden(svgOf('m1p0'), !show.m); setHidden(document.getElementById('firstSeperator'), !show.m);
  document.querySelectorAll('.seconds').forEach(function(e) { setHidden(e, !show.s); });
  cdShown = true;
}
function restoreTime() {
  if (!cdShown) return;
  cdShown = false;
  setHidden(document.getElementById('hundredsDigit'), true);
  setHidden(svgOf('m0p0'), false); setHidden(svgOf('m1p0'), false); setHidden(document.getElementById('firstSeperator'), false);
  document.querySelectorAll('.seconds').forEach(function(e) { setHidden(e, false); });
  document.getElementById('firstDigit').classList.remove('hidden');     // getTime() decides about the leading zero again
  layoutStale = true;
}
window.addEventListener('timerchange', function() { layoutStale = true; kickClock(); });
window.addEventListener('timezonechange', function() { kickClock(); });


// the caption: the name of the countdown and which units the digits are
var pillText = null;
function updateTimerPill(counting, left, done) {
  var el = document.getElementById('timerPill');
  if (!el) return;
  var text = counting ? (conf.timerLabel ? conf.timerLabel + ' · ' : '') + (done ? 'today' : unitsFor(left, !hideSec())) : '';
  if (text === pillText) return;
  pillText = text;
  if (window.__pillSet) window.__pillSet('timer', counting ? text : null);       // (the Raspberry Pi program draws the pills itself: native/host/js/pills.js)
  el.textContent = text;
  el.hidden = !counting;
}

// the settings controls
document.addEventListener('DOMContentLoaded', function() {
  var mode = document.getElementById('clockMode'), box = document.getElementById('timerTarget'), label = document.getElementById('timerLabel'), fields = document.getElementById('timerFields');
  if (!mode) return;
  var sync = function() { mode.value = conf.clockMode === 'countdown' ? 'countdown' : 'time'; box.value = conf.timerTarget || ''; label.value = conf.timerLabel || ''; fields.hidden = mode.value !== 'countdown'; };
  sync();
  mode.addEventListener('change', function() {
    conf.clockMode = mode.value;
    if (mode.value === 'countdown' && !Number.isFinite(parseTarget(conf.timerTarget))) { conf.timerTarget = defaultTarget(+simNow()); }   // a new countdown starts with the next midnight
    sync();
    window.dispatchEvent(new Event('timerchange'));
  });
  box.addEventListener('input', function() { conf.timerTarget = box.value; window.dispatchEvent(new Event('timerchange')); });
  label.addEventListener('input', function() { conf.timerLabel = label.value.slice(0, 40); window.dispatchEvent(new Event('timerchange')); });
  window.addEventListener('confreset', sync);
});

// Draws the digits for this instant. Returns true while any visible digit is morphing into the next one (the digits
// that change at the next second morph all through this one), which is when it needs ~15 frames a second.
var still = {};          // per digit slot: the shape it was last drawn as when it was standing still
function clock() {
  if (document.hidden) return false;           // nothing to animate in a background tab
  var now = simNow();
  if ((cap.cadence === 'minute' || cap.ahead) && window.__holdsFrames && !getSim()) {                  // one picture a minute (or the seconds off): the minute: from a little before the minute the next one is drawn (and the host holds it back until the minute)
    var toMin = 60000 - (+now % 60000);
    if (toMin <= cap.lead + 1500) { now = new Date(+now + toMin); window.__presentAt = +now; } else window.__presentAt = 0;
  } else window.__presentAt = 0;
  var target = countdownTarget(), counting = Number.isFinite(target), done = false;
  if (counting) {
    var phase = phaseOf(target, +now);
    if (phase === 'over') {
      counting = false;                                    // the digits show the time ...
      // ... and, after it has stayed over for a few seconds (not while time travel is on, and not on the very first tick,
      // which can run before a ?t= date is applied), the setting goes back to "The time" too
      if (!getSim()) { if (!overSince) overSince = performance.now(); else if (performance.now() - overSince > 3000) endCountdown(); }
    } else { overSince = 0; done = phase === 'done'; }
  }
  var time, nTime, slots = vars.t, left = 0;
  if (counting) {
    left = done ? 0 : secondsLeft(target, +now);
    time = done ? doneSlots() : slotsFor(left, !hideSec());
    nTime = done ? time : slotsFor(Math.max(0, left - 1), !hideSec());
    arrangeCountdown(time.show);
    slots = ['x', 'h', 'm', 's'];
  } else {
    restoreTime();
    time = getTime(now);
    nTime = getTime(new Date(now.getTime() + 1000));
  }
  var smooth = cap.seconds === 'morph' && cap.cadence === 'live';       // the digit slides over its second; otherwise it changes on the second (the capability ladder)
  var cStep = smooth ? now.getMilliseconds() / vars.step : 0;
  var morphing = false;

  slots.map(function(t) {
    if (t === 's' && hideSec()) return;  // not shown: do not draw it
    if (counting && ((t === 's' && !time.show.s) || (t === 'm' && !time.show.m) || (t === 'x' && !time.show.x))) return;
    for (var i = 0; i < 2; i++) {
      var d = time[t][i],
        nd = nTime[t][i];
      if (d != nd && smooth) morphing = true;
      var key = t + i;
      if (d == nd && sway.mode === 'off' && still[key] === dd[d]) continue;     // a digit that is not changing and is already drawn: nothing to work out
      still[key] = d == nd && sway.mode === 'off' ? dd[d] : null;
      setDigit(key, morph(dd[d], dd[nd], cStep), performance.now());   // gusts run on the real clock, even while time travel holds the time still
    }
  });
  updateTimerPill(counting, left, done);
  if (layoutStale) {
    layoutStale = false;
    updateSvgWidths();
  }
  if (clockChanged) {
    clockChanged = false;
    window.dispatchEvent(new Event('clockchange'));
  }
  var tempTime = counting
    ? (conf.timerLabel ? conf.timerLabel + ' ' : '') + (done ? '00:00' : textOf(groupsFor(left, !hideSec())))
    : Number(String(time.h[0]) + String(time.h[1])) + ":" + time.m[0] + time.m[1] + (hideSec() ? "" : ":" + time.s[0] + time.s[1]);
  if (document.title !== tempTime) {
    document.title = tempTime;
  }
  return morphing;
}

// Not a constant 15 Hz timer: while something morphs it ticks every frame step, otherwise it sleeps until the next
// second (hidden seconds: one wake-up a second instead of fifteen), and not at all in a background tab.
var clockTimer = 0;
function loop() {
  clockTimer = 0;
  var tp = window.__tp, t0 = tp && performance.now();             // (the native host's --profile adds up the phases)
  var morphing = clock();
  if (tp) tp('page loop: clock() (the digits, the date, the seconds)', t0);
  if (document.hidden) return;                 // the visibilitychange below restarts it
  var sim = getSim();
  if (window.__why) window.__why('clock loop ran, short wait because: ' + (morphing ? 'a digit is about to change' : sway.flutter ? 'sway flutter' : sim && sim.scale > 1 ? 'time travel' : 'none (waits for the next second)'));
  var delay = morphing || sway.flutter || (sim && sim.scale > 1) ? (vars.tick || vars.step) : 1005 - simNow().getMilliseconds();
  if (cap.cadence === 'minute' && !sim) {
    var t1 = +simNow();
    if (window.__holdsFrames) {                                   // wake once a minute, a lead before it, to draw the next minute's picture (the host shows it on the minute)
      var wake = Math.ceil((t1 + 1) / 60000) * 60000 - cap.lead;
      if (wake - t1 < 500) wake += 60000;
      delay = wake - t1;
    } else delay = Math.ceil((t1 + 1) / 60000) * 60000 + 30 - t1;   // a browser cannot hold a picture back: draw it just after the minute turns (never before)
  }     // vars.tick: the quality governor's pace (js/sky/governor.js), when there is one
  clockTimer = setTimeout(loop, delay);
}
function kickClock() {
  if (window.__why) window.__why('clock kicked (an event asked for an immediate tick)');
  clearTimeout(clockTimer);
  loop();
}
document.addEventListener('visibilitychange', function() { if (!document.hidden) kickClock(); });
window.addEventListener('windchange', kickClock);                 // the sway was switched on, off, or changed: redraw the digits now
window.addEventListener('capchange', function() { layoutStale = true; still = {}; kickClock(); });       // the capability ladder moved: seconds shown or not, how the digits change, the rhythm

function updateSvgWidths() {
  const svgs = document.querySelectorAll("#clock svg");
  const visibleSvgs = [...svgs].filter(svg => getComputedStyle(svg).display !== "none");
  // How many digits share the row: the colons do not count. (This used to be "visible svgs - 2", which is right only
  // while the seconds are shown: with them hidden there is one colon, not two, so it came out one digit short and the
  // digits were drawn far too big, most visibly on a phone held upright.)
  const count = visibleSvgs.filter(svg => svg.querySelector('path[id]')).length;
  const leadingHidden = document.getElementById("firstDigit")?.classList.contains("hidden");

  if (count > 0) {
    let temp = "1%";
    if (leadingHidden) temp = "3%";                     // 12-hour time before 10 o'clock: no leading zero
    const width = `calc(((100% + (7% * 3)) / ${count}) - ${temp})`;
    visibleSvgs.forEach(svg => {
      svg.style.width = width;
    });
    const clockBox = document.querySelector("#clock");
    if (conf.screenMode === 'led') clockBox.style.marginLeft = leadingHidden ? "6%" : "";       // (an LED panel lays itself out: clocklayout.js)
    else {                                              // the row is put in the middle of the screen from where its digits really are (it was a fixed 6% or nothing, and sat left of centre)
      const items = [...svgs].map((el) => ({ hidden: getComputedStyle(el).display === 'none', width: el.style.width, marginRight: el.style.marginRight, hundreds: el.id === 'hundredsDigit', colon: !el.querySelector('path[id]') }));
      clockBox.style.marginLeft = `${centreMargin(items).toFixed(2)}%`;
    }
  }
  // for the LED panel layout (styles.css): how many digit-boxes wide the row is (a digit takes 0.76 of its box, a colon 0.3), and how many rows when it stacks
  const colons = visibleSvgs.filter(svg => !svg.querySelector('path[id]')).length;
  const digits = visibleSvgs.length - colons;
  const clockEl = document.querySelector("#clock");
  clockEl.style.setProperty('--units', String(0.76 * digits + 0.3 * colons));
  clockEl.style.setProperty('--rows', String(Math.max(1, Math.ceil(digits / 2))));
  window.dispatchEvent(new Event('clocklayout'));
}

function initalize() {
  //start the clock ticking 
  // Set up widths so that clock fills the horizontal space
  updateSvgWidths();
  kickClock();                                 // draw the digits now (they start as crossed lines)
  
  //Set up config option actions
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('easing').addEventListener('change', (event) => {
      conf.easing = event.target.options[event.target.selectedIndex].value;
    });
  });
  
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('twentyFourHourClock').addEventListener('change', (event) => {
      conf.twentyFourHourClock = event.target.checked;
    });
  });
  
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('hideSeconds').addEventListener('change', (event) => {
      conf.hideSeconds = event.target.checked;
      adjustTimeSize();
      updateSvgWidths();
      kickClock();
    });
  });
  
  //set up easing options to choose from 
  var select = document.getElementById("easing");
  Object.getOwnPropertyNames(easing).forEach(function(val, idx, array) {
    var option = document.createElement("option");
    option.text = val;
    option.value = val;
    if (conf.easing == val) {
      option.selected = true;
    }
    select.add(option);
  });
  
  //Set up initial config settings state
  document.getElementById("twentyFourHourClock").checked = use24h();
  
  document.getElementById("hideSeconds").checked = conf.hideSeconds;
  
  adjustTimeSize();
  updateSvgWidths();
}

initalize();