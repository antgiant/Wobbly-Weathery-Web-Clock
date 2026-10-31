import { hour24, unitFor, formatTempIn } from './units.js'
import { isChristmasSeason } from './season.js'
import { now as simNow } from './simtime.js'

export function adjustTimeSize() {
  if (conf.hideSeconds) {
    document.querySelector("#firstSeperator").style.marginRight = "-25%";
    document.querySelectorAll('.seconds').forEach(element => {
      element.style.display = 'none';
    });
  } else {
    document.querySelectorAll('.seconds').forEach(element => {
      element.style.display = '';
    });
    document.querySelector("#firstSeperator").style.marginRight = (conf.hideSeconds ? "-25%" : "-15%");
  }
}

function createPersistentConfig(key, initialValue = {}) {
  // Load existing data from localStorage
  let data = initialValue;
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      // defaults first, so settings added in newer versions get a value
      data = { ...initialValue, ...JSON.parse(stored) };
    } else {
      //Persist the initial value
      localStorage.setItem(key, JSON.stringify(data));
    }
  } catch (error) {
    console.warn("Failed to load from localStorage: ", error);
  }
  
  // Save to localStorage function
  const save = () => {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.error("Failed to save to localStorage: ", error);
    }
  };
  
  // Create proxy to intercept changes
  return new Proxy(data, {
    set(target, property, value) {
      target[property] = value;
      save(); // Automatically save on any change
      if (globalThis.__confDebug) console.log(key + "." + property + ": " + value);    // set window.__confDebug = true to watch settings change
      return true;
    },
    
    deleteProperty(target, property) {
      delete target[property];
      save(); // Save on deletion
      if (globalThis.__confDebug) console.log("deleted " + key + "." + property);
      return true;
    }
    
  });
}

export const DEFAULTS = {
  steps: 15,
  easing: 'easeInOutBack',
  twentyFourHourClock: null,  // null = follow the browser's locale until the user chooses
  hideSeconds: false,
  preciseLocation: false,
  gpsFrequency: -1,
  location_latitude: -1,
  location_longitude: -1,
  location_accuracy: -1,
  location_altitude: -1,
  location_altitudeAccuracy: -1,
  // sky
  quality: 'auto',            // auto | low | medium | high
  landscape: 'auto',          // auto (real terrain when available) | flat | ocean | hills | mountains | desert | city
  weatherMode: 'live',        // live | clear | partly | cloudy | overcast | rain | storm | snow | fog | haze
  lightPollution: 'auto',     // auto (by time zone) | off | 1..9 (Bortle)
  bodySize: 2,                // sun & moon size multiplier
  nightBrightness: 1.4,
  cloudMotion: 1,             // 1 real time, 0.25 slow, 0 still
  // view
  viewMode: 'drag',           // fixed | drag (look around) | look (gyro "VR" mode)
  viewHeading: 180,
  viewPitch: 12,
  viewPitchAuto: true,        // keep the horizon on the clock digits
  horizonInDigits: 0.3,       // how far up the digits the horizon sits (0 = bottom edge): ground shows through the lower part
  viewFov: 80,
  showLabels: false,
  plants: true,               // grass, trees, cacti ... swaying in the wind
  keepAwake: true,            // Screen Wake Lock
  // time travel (never persisted as "on" across reloads)
  simSpeed: 1,
  // clock
  clockStyle: 'auto',         // auto (liquid glass; coloured tube from Thanksgiving to Christmas) | glass | stained (coloured tube) | solid
  glassFrost: 0.35,           // 0 clear .. 1 heavily frosted
  clockColor: 'auto',         // solid style only: auto | classic | white
  legibility: 'auto',         // off | auto (3:1) | high (4.5:1): least brightness contrast between the time and the sky
  glassGlow: 0,               // light from inside the glass, 0..1 (stained glass always glows a little)
  glassGlowColor: 'follow',     // liquid glass: warm | white | cool | follow (the sun / moon light)
  // sun & screen
  followSun: true,            // clock view only: sun rises on the right quarter, sets on the left, tilt never changes
  countdown: 'off',           // off | both | sunrise | sunset
  countdownKind: 'sun',       // sun | golden | civil | nautical | astro | moon: what the countdown counts down to (morning and evening events)
  countdownLead: 20,          // minutes before the event the countdown appears
  screenMode: 'normal',       // normal | led (LED panel simulator)
  ledCols: 64,                // LEDs across the panel (64 x 32 is the classic panel)
  ledRows: 32,                // LEDs down it
  ledTurn: true,              // turn the panel on its side when the screen is the other way round
  // VR sensor overrides, for devices whose sensor frame is not what the spec says
  sensorRotation: 'auto',     // auto | ignore
  compassRef: 'auto',         // auto | cam | top (iOS compass heading reference)
  vrDebug: false,
  // settings panel
  settingsTab: 'clock',
  holidayTree: true,          // a lit Christmas tree in the scene from Thanksgiving to Christmas
  nightDim: 'off',            // off | auto (dim between dusk and dawn) | on
  nightDimLevel: 0.6,         // how much light the veil takes away at full dimming
  rainAlert: false,           // show an umbrella / slicker indicator when enough rain is coming today
  settingsLevel: 'simple',    // simple | advanced
  // first-run choice
  locationChoice: null,       // null (not asked yet) | real | estimated
  coarseLookups: true,        // weather / terrain lookups use a rounded position, never the exact one
  // weather & units
  tempUnit: 'auto',           // auto (by region) | c | f
  confVersion: 0
};
const CONF_VERSION = 3;
export var conf = createPersistentConfig("conf", DEFAULTS);

// Defaults that changed: settings saved by an older version only ever held the old default, so move them once.
if ((conf.confVersion || 0) < CONF_VERSION) {
  for (const k of ['twentyFourHourClock', 'keepAwake', 'followSun', 'viewMode', 'glassGlowColor']) conf[k] = DEFAULTS[k];
  if ((conf.confVersion || 0) < 3 && conf.clockStyle === 'glass') conf.clockStyle = 'auto';   // 'glass' was only ever the default
  conf.confVersion = CONF_VERSION;
}

/**
 * Whether the device is short of power: the Battery saver quality setting, or (where the browser reports it; Chrome and
 * Android do, Safari does not) a battery that is under 20% and not charging.
 */
export const power = { battery: false };
export const lowPower = () => conf.quality === 'low' || power.battery;
try {
  navigator.getBattery?.().then((b) => {
    const update = () => {
      const low = !b.charging && b.level <= 0.2;
      if (low !== power.battery) { power.battery = low; window.dispatchEvent(new Event('powerchange')); }
    };
    b.addEventListener('levelchange', update); b.addEventListener('chargingchange', update); update();
  }).catch(() => {});
} catch (_) { /* no battery information */ }

/**
 * The clock style in force: the user's choice, or while it is left on automatic: liquid glass, coloured lights at
 * Christmas time, and flat colour whenever the device is saving power (glass is the most expensive thing to draw).
 */
export function clockStyleNow() {
  if (conf.clockStyle === 'glass' || conf.clockStyle === 'stained' || conf.clockStyle === 'solid') return conf.clockStyle;
  if (lowPower()) return 'solid';
  return isChristmasSeason(simNow()) ? 'stained' : 'glass';
}

/** 24-hour time unless the user chose; until then whatever the browser's locale uses. */
export const use24h = () => hour24(conf.twentyFourHourClock);
export const tempUnit = () => unitFor(conf.tempUnit);
export const formatTemp = (c) => formatTempIn(c, tempUnit());

//Set clock size
adjustTimeSize();

export var vars = {
  inited: false,
  t: ["h", "m", "s"],
  step: 1000 / conf.steps
};

export var dd = [];
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