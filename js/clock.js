import { conf, vars, dd, adjustTimeSize } from './config.js';
import { easing } from './easing.js'
import { refreshSky } from './horizon/horizon.js'

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
  let h = "";
  if (conf.twentyFourHourClock) {
    h = date.getHours().toString().padStart(2, "0");
  } else {
    h = (date.getHours() % 12 || 12).toString().padStart(2, "0");
  }
  const el = document.getElementById("firstDigit");
  if (!conf.twentyFourHourClock && parseInt(h) < 10) {
    if (el && !el.classList.contains("hidden")) {
      el.classList.add("hidden");
    }
  } else {
    if (el && el.classList.contains("hidden")) {
      el.classList.remove("hidden");
    }
  }
  
  let m = date.getMinutes().toString().padStart(2, "0");
  let s = date.getSeconds().toString().padStart(2, "0");
  let temp = {
    'h': toDigitArray(h),
    'm': toDigitArray(m),
    's': toDigitArray(s)
  }
  
  return temp;
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
  var tempTime = Number(time.h[0] + time.h[1]) + ":" + time.m[0] + time.m[1] + (conf.hideSeconds ? "" : ":" + time.s[0] + time.s[1]);
  if (document.title !== tempTime) {
    document.title = tempTime;
    refreshSky();
  }
}

function updateSvgWidths() {
  const svgs = document.querySelectorAll("#clock svg");
  const visibleSvgs = [...svgs].filter(svg => getComputedStyle(svg).display !== "none");
  const count = visibleSvgs.length - 2;
  
  if (count > 0) {
    let temp = "1%";
    if (count == 2 || count == 5) {
      temp = "3%";
      document.querySelector("#clock").style.marginLeft = "6%";
    } else {
      document.querySelector("#clock").style.marginLeft = "";
    }
    const width = `calc(((100% + (7% * 3)) / ${count}) - ${temp})`;
    visibleSvgs.forEach(svg => {
      svg.style.width = width;
    });
  }
}

function initalize() {
  //start the clock ticking 
  setInterval(function() {
    clock();
  }, vars.step);
  
  // Set up widths so that clock fills the horizontal space
  updateSvgWidths();
  
  // Optional: rerun if elements may toggle visibility
  const observer = new MutationObserver(updateSvgWidths);
  observer.observe(document.querySelector("#clock"), { attributes: true, childList: true, subtree: true });
  
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
  document.getElementById("twentyFourHourClock").checked = conf.twentyFourHourClock;
  
  document.getElementById("hideSeconds").checked = conf.hideSeconds;
  
  adjustTimeSize();
  
}

initalize();