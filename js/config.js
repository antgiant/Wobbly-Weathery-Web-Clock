import { hour24, unitFor, formatTempIn } from './units.js'
import { isChristmasSeason } from './season.js'
import { now as simNow } from './simtime.js'
import { fromSearch } from './share.js'
import { SETTING_DEFAULTS } from '../schema/settings.js'

/**
 * What the capability ladder (js/sky/capability.js) has decided the hardware can handle, which outranks the settings: a clock that cannot show the right time is worth nothing.
 * seconds: 'morph' (the digit slides over the second), 'tick' (it changes on the second), 'off' (not shown); cadence: 'live' or 'minute' (one picture a minute, drawn ahead and shown
 * on the minute); lead: how many ms before the minute to start drawing the next picture.
 */
export const cap = { seconds: 'morph', cadence: 'live', lead: 0 };
/** Whether the seconds are hidden: by the setting, or because the hardware cannot keep pace with them. */
export const hideSec = () => !!conf.hideSeconds || cap.seconds === 'off';

export function adjustTimeSize() {
  if (hideSec()) {
    document.querySelector("#firstSeperator").style.marginRight = "-25%";
    document.querySelectorAll('.seconds').forEach(element => {
      element.style.display = 'none';
    });
  } else {
    document.querySelectorAll('.seconds').forEach(element => {
      element.style.display = '';
    });
    document.querySelector("#firstSeperator").style.marginRight = (hideSec() ? "-25%" : "-15%");
  }
}

function createPersistentConfig(key, initialValue = {}, shared = null) {
  // Load existing data from localStorage
  let data = initialValue;
  if (shared) {
    // A shared link (share.js): this setup for this load only. Nothing is read from or written to storage, so it never overwrites
    // anyone's own settings, and a sign that has nothing stored comes up exactly as the link says.
    data = { ...initialValue, ...shared.settings, kiosk: shared.kiosk, confVersion: 99, locationChoice: shared.place ? 'manual' : 'estimated', manualLocation: !!shared.place, preciseLocation: false, timeZone: shared.timeZone || '' };
    if (shared.place) { data.location_latitude = shared.place.lat; data.location_longitude = shared.place.lon; }
    if (shared.placeName) data.location_name = shared.placeName;
    if (shared.kiosk) data.viewMode = 'fixed';                      // nobody can drag a sign
    return new Proxy(data, { set(target, property, value) { target[property] = value; return true; }, deleteProperty(target, property) { delete target[property]; return true; } });
  }
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

// The settings that have a control (and their defaults) are in schema/settings.js; what is here is state: where you are, what was
// asked, the panel's last tab, the time travel, and a few internals.
export const DEFAULTS = {
  ...SETTING_DEFAULTS,
  steps: 15,
  easing: 'easeInOutBack',
  location_latitude: -1,
  location_longitude: -1,
  location_accuracy: -1,
  location_altitude: -1,
  location_altitudeAccuracy: -1,
  // sky
  // view
  // time travel (never persisted as "on" across reloads)
  simSpeed: 1,
  // clock
  // sun & screen
  // VR sensor overrides, for devices whose sensor frame is not what the spec says
  // settings panel
  settingsTab: 'clock',
  settingsLevel: 'simple',    // simple | advanced
  // first-run choice
  kiosk: false,               // set by a shared link made with the kiosk switch: no controls, no questions, updates itself
  location_name: '',          // the name of the place when it was searched for
  locationChoice: null,       // null (not asked yet) | real | estimated
  // weather & units
  confVersion: 0
};
export const CONF_VERSION = 4;
// A link made by "Share this setup" (?c=... or ?preset=...&...): applied for this load only, not saved (see share.js)
export const shared = (typeof location !== 'undefined' && location.search) ? fromSearch(location.search) : null;
export var conf = createPersistentConfig("conf", DEFAULTS, shared);
if (shared?.kiosk && typeof document !== 'undefined') document.documentElement.dataset.kiosk = '1';        // styles.css hides every control

// Defaults that changed: settings saved by an older version only ever held the old default, so move them once.
if (!shared && (conf.confVersion || 0) < CONF_VERSION) {
  if ((conf.confVersion || 0) < 3) {                       // version 3 moved these defaults
    for (const k of ['twentyFourHourClock', 'keepAwake', 'followSun', 'viewMode', 'glassGlowColor']) conf[k] = DEFAULTS[k];
    if (conf.clockStyle === 'glass') conf.clockStyle = 'auto';   // 'glass' was only ever the default
  }
  // version 4: "Dim the screen" (off / at night / always) and "How dark" became a day brightness and a night brightness
  const old = conf;                                        // (the old keys are no longer settings: read through another name)
  if ((old.confVersion || 0) < 4 && old.nightDim && old.nightDim !== 'off') {
    const keep = 1 - Math.min(0.9, Math.max(0.1, Number(old.nightDimLevel) || 0.6));
    conf.brightnessNight = keep;
    conf.brightnessDay = old.nightDim === 'on' ? keep : 1;
  }
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