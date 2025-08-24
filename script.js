var conf = {
  steps: 15,
  easing: 'easeInOutBack'
};
var dd = [];
dd[0] = [254, 47, 159, 84, 123, 158, 131, 258, 139, 358, 167, 445, 256, 446, 345, 447, 369, 349, 369, 275, 369, 201, 365, 81, 231, 75];
dd[1] = [138, 180, 226, 99, 230, 58, 243, 43, 256, 28, 252, 100, 253, 167, 254, 234, 254, 194, 255, 303, 256, 412, 254, 361, 255, 424];
dd[2] = [104, 111, 152, 55, 208, 26, 271, 50, 334, 74, 360, 159, 336, 241, 312, 323, 136, 454, 120, 405, 104, 356, 327, 393, 373, 414];
dd[3] = [96, 132, 113, 14, 267, 17, 311, 107, 355, 197, 190, 285, 182, 250, 174, 215, 396, 273, 338, 388, 280, 503, 110, 445, 93, 391];
dd[4] = [374, 244, 249, 230, 192, 234, 131, 239, 70, 244, 142, 138, 192, 84, 242, 30, 283, -30, 260, 108, 237, 246, 246, 435, 247, 438];
dd[5] = [340, 52, 226, 42, 153, 44, 144, 61, 135, 78, 145, 203, 152, 223, 159, 243, 351, 165, 361, 302, 371, 439, 262, 452, 147, 409];
dd[6] = [301, 26, 191, 104, 160, 224, 149, 296, 138, 368, 163, 451, 242, 458, 321, 465, 367, 402, 348, 321, 329, 240, 220, 243, 168, 285];
dd[7] = [108, 52, 168, 34, 245, 42, 312, 38, 379, 34, 305, 145, 294, 166, 283, 187, 243, 267, 231, 295, 219, 323, 200, 388, 198, 452];
dd[8] = [243, 242, 336, 184, 353, 52, 240, 43, 127, 34, 143, 215, 225, 247, 307, 279, 403, 427, 248, 432, 93, 437, 124, 304, 217, 255];
dd[9] = [322, 105, 323, 6, 171, 33, 151, 85, 131, 137, 161, 184, 219, 190, 277, 196, 346, 149, 322, 122, 298, 95, 297, 365, 297, 448];

var vars = {
  inited: false,
  t: ["h", "m", "s"],
  step: 1000 / conf.steps
};

function ci(c, i) {
  var k = i * 6;
  return ["M"].concat(c.slice(k, k + 2), ["C"], c.slice(k + 2, k + 8)).join(" ");
}

function setCurve(id, val) {
  var e = document.getElementById(id);
  if (e !== null)
    e.setAttribute("d", val);
}

function setDigit(t, d) {
  for (var i = 0; i < 4; i++) {
    setCurve(t + "p" + i, ci(d, i));
  }
}

function ease(x, t, b, c, d) {
  if (typeof easing !== 'undefined' && typeof easing[conf.easing] === 'function') {
    return easing[conf.easing](x, t, b, c, d);
  }
  return 0;
}

function morph(a, b, s) {
  return a.map(function(v, i) {
    var e = ease(null, s, 0, 1, conf.steps);
    return v + e * (b[i] - v);
  });
}

function toDigitArray(str) {
  return str.split('').map(function(v) {
    return parseInt(v);
  });
}

function getTime(date) {
  var s = date.toTimeString().replace(/.*(\d{2}:\d{2}:\d{2}).*/, "$1").split(":");
  return {
    'h': toDigitArray(s[0]),
    'm': toDigitArray(s[1]),
    's': toDigitArray(s[2])
  };
}

function clock() {
  var now = new Date();
  var time = getTime(now);
  var nTime = getTime(new Date(now.getTime() + 1000));
  var cStep = now.getMilliseconds() / vars.step;
  
  vars.t.map(function(t) {
    for (var i = 0; i < 2; i++) {
      var d = time[t][i],
        nd = nTime[t][i];
      if (d != nd || !vars.inited) {
        setDigit(t + i, morph(dd[d], dd[nd], cStep));
      }
    }
  });
  inited = true;
}

setInterval(function() {
  clock();
}, vars.step);

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

  const settingsEl = document.getElementById('settings');

  // How long to wait with no activity before hiding (ms)
  const IDLE_MS = 5000;

  let hideTimerId = null;
  let isHidden = false;

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