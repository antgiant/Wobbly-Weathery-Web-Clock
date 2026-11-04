// THE settings of the clock: one list that everything reads. The web page's defaults (js/config.js), the presets (schema/presets.js),
// the tests that check every control in index.html against it, schema/settings.json (for the native version and its command line and
// man page) all come from here, so they cannot drift.
//
//   key        the name it is stored and shared under (never rename one: saved settings and links use it)
//   type       bool | tri (auto / on / off) | enum (options) | number (min, max, step) | text (max) | datetime
//   default    what a new visitor gets
//   tab        which tab of Settings it is on (presets clock scene weather extras place)
//   advanced   shown only in Advanced mode
//   shareable  carried by a share link (js/share.js keeps its own frozen copy of version 1: this list may grow, that one never changes)
//   preset     set by the presets and by "Reset all settings"
//
//   requires   (added by the native work) what a machine needs for the option to work, a list of tokens: "gles3" (an OpenGL ES 3 GPU),
//              "cores>=2", "ram>=1024" (megabytes), "hdmi" (a full-resolution screen output), "sensors" (motion/compass: a phone, never a Pi).
//              The native program switches off what a machine cannot do and says why (native/cli/hardware.mjs). The web page ignores it.
//   requiresValue  the same, for one value of an enum ({ glass: ["gles3"] }); the native program falls back to `fallback`.
// Run `npm run schema` after changing this file: it rewrites schema/settings.json.

const RAW = [
  { key: "twentyFourHourClock", type: "tri", default: null, tab: "clock", advanced: false, label: "24-hour time", shareable: true, preset: false, doc: "null = follow the browser's locale until the user chooses" },
  { key: "hideSeconds", type: "bool", default: false, tab: "clock", advanced: false, label: "Hide seconds", shareable: true, preset: true },
  { key: "clockMode", type: "enum", default: "time", options: ["time", "countdown"], tab: "clock", advanced: true, label: "The digits show", shareable: true, preset: false, doc: "time | countdown: the digits show the time, or the time left to timerTarget" },
  { key: "timerTarget", type: "datetime", default: "", tab: "clock", advanced: true, label: "Count down to", shareable: true, preset: false, doc: "countdown: a datetime-local value (\"2026-12-25T08:00\"), in the viewer's own time zone" },
  { key: "timerLabel", type: "text", default: "", max: 40, tab: "clock", advanced: true, label: "Name (optional)", shareable: true, preset: false, doc: "countdown: a name shown with it" },
  { key: "clockStyle", type: "enum", default: "auto", options: ["auto", "glass", "stained", "solid"], tab: "clock", advanced: false, label: "Style", shareable: true, preset: true, doc: "auto (liquid glass; coloured tube from Thanksgiving to Christmas) | glass | stained (coloured tube) | solid" },
  { key: "glassFrost", type: "number", default: 0.35, min: 0, max: 1, step: 0.01, tab: "clock", advanced: false, label: "Frosting", shareable: true, preset: true, doc: "0 clear .. 1 heavily frosted" },
  { key: "glassGlow", type: "number", default: 0, min: 0, max: 1, step: 0.01, tab: "clock", advanced: false, label: "Light from inside", shareable: true, preset: true, doc: "light from inside the glass, 0..1 (stained glass always glows a little)" },
  { key: "legibility", type: "enum", default: "auto", options: ["auto", "high", "off"], tab: "clock", advanced: false, label: "Keep the time readable", shareable: true, preset: true, doc: "off | auto (3:1) | high (4.5:1): least brightness contrast between the time and the sky" },
  { key: "glassGlowColor", type: "enum", default: "follow", options: ["warm", "white", "cool", "follow"], tab: "clock", advanced: true, label: "Colour of the light (liquid glass)", shareable: true, preset: true, doc: "liquid glass: warm | white | cool | follow (the sun / moon light)" },
  { key: "clockColor", type: "enum", default: "auto", options: ["auto", "classic", "white"], tab: "clock", advanced: true, label: "Ink colour (solid style)", shareable: true, preset: true, doc: "solid style only: auto | classic | white" },
  { key: "landscape", type: "enum", default: "auto", options: ["auto", "flat", "hills", "mountains", "desert", "ocean", "city"], tab: "scene", advanced: false, label: "Landscape", shareable: true, preset: true, doc: "auto (real terrain when available) | flat | ocean | hills | mountains | desert | city" },
  { key: "holidayTree", type: "bool", default: true, tab: "scene", advanced: false, label: "Christmas tree", shareable: true, preset: true, doc: "a lit Christmas tree in the scene from Thanksgiving to Christmas" },
  { key: "plants", type: "bool", default: true, tab: "scene", advanced: false, label: "Plants that suit this place", shareable: true, preset: true, doc: "grass, trees, cacti ... swaying in the wind" },
  { key: "quality", type: "enum", default: "auto", options: ["auto", "low", "medium", "high"], tab: "scene", advanced: true, label: "Quality", shareable: true, preset: true, doc: "auto | low | medium | high" },
  { key: "bodySize", type: "enum", default: 2, options: ["1", "2", "3"], tab: "scene", advanced: true, label: "Sun & moon size", shareable: true, preset: false, doc: "sun & moon size multiplier" },
  { key: "nightBrightness", type: "number", default: 1.4, min: 0.5, max: 4, step: 0.1, tab: "scene", advanced: true, label: "Night brightness", shareable: true, preset: false },
  { key: "lightPollution", type: "enum", default: "auto", options: ["auto", "off", "1", "2", "3", "4", "5", "6", "7", "8", "9"], tab: "scene", advanced: true, label: "Light pollution", shareable: false, preset: false, doc: "auto (by time zone) | off | 1..9 (Bortle)" },
  { key: "viewMode", type: "enum", default: "drag", options: ["fixed", "drag", "look"], tab: "scene", advanced: false, label: "Mode", shareable: true, preset: true, doc: "fixed | drag (look around) | look (gyro \"VR\" mode)" },
  { key: "followSun", type: "bool", default: true, tab: "scene", advanced: false, label: "Follow the sun", shareable: true, preset: true, doc: "clock view only: sun rises on the right quarter, sets on the left, tilt never changes" },
  { key: "showLabels", type: "bool", default: false, tab: "scene", advanced: true, label: "Label the sun, moon and planets", shareable: false, preset: false },
  { key: "viewHeading", type: "number", default: 180, min: 0, max: 359, step: 1, tab: "scene", advanced: true, label: "Facing", shareable: true, preset: false },
  { key: "viewPitchAuto", type: "bool", default: true, tab: "scene", advanced: true, label: "Keep the horizon on the digits", shareable: true, preset: false, doc: "keep the horizon on the clock digits" },
  { key: "horizonInDigits", type: "number", default: 0.3, min: 0, max: 0.8, step: 0.05, tab: "scene", advanced: true, label: "Ground inside the digits", shareable: true, preset: false, doc: "how far up the digits the horizon sits (0 = bottom edge): ground shows through the lower part" },
  { key: "viewPitch", type: "number", default: 12, min: -10, max: 80, step: 1, tab: "scene", advanced: true, label: "Tilt up", shareable: true, preset: false },
  { key: "viewFov", type: "number", default: 80, min: 30, max: 110, step: 1, tab: "scene", advanced: true, label: "Field of view", shareable: true, preset: false },
  { key: "sensorRotation", type: "enum", default: "auto", options: ["auto", "ignore"], tab: "scene", advanced: true, label: "Screen rotation", shareable: false, preset: false, doc: "auto | ignore" },
  { key: "compassRef", type: "enum", default: "auto", options: ["auto", "cam", "top"], tab: "scene", advanced: true, label: "Compass reference (iPhone & iPad)", shareable: false, preset: false, doc: "auto | cam | top (iOS compass heading reference)" },
  { key: "vrDebug", type: "bool", default: false, tab: "scene", advanced: true, label: "Show sensor readout", shareable: false, preset: false, doc: "settings panel" },
  { key: "weatherMode", type: "enum", default: "live", options: ["live", "clear", "partly", "cloudy", "overcast", "rain", "storm", "snow", "fog", "haze"], tab: "weather", advanced: false, label: "Weather", shareable: true, preset: true, doc: "live | clear | partly | cloudy | overcast | rain | storm | snow | fog | haze" },
  { key: "tempUnit", type: "enum", default: "auto", options: ["auto", "c", "f"], tab: "weather", advanced: true, label: "Temperature", shareable: true, preset: false, doc: "auto (by region) | c | f" },
  { key: "cloudMotion", type: "enum", default: 1, options: ["1", "0.25", "0"], tab: "weather", advanced: true, label: "Cloud & water motion", shareable: true, preset: true, doc: "1 real time, 0.25 slow, 0 still" },
  { key: "rainAlert", type: "bool", default: false, tab: "weather", advanced: false, label: "Umbrella alert", shareable: true, preset: true, doc: "show an umbrella / slicker indicator when enough rain is coming today" },
  { key: "digitWeather", type: "enum", default: "on", options: ["on", "off"], tab: "weather", advanced: true, label: "Rain and snow on the digits", shareable: true, preset: false, doc: "on | off: rain beads and splashes, snow settling on the digits (glass, tube and LED styles)" },
  { key: "windSway", type: "enum", default: "off", options: ["off", "lean", "full"], tab: "weather", advanced: true, label: "Wind sway", shareable: true, preset: false, doc: "off | lean | full: the digits lean downwind like palm trees (steady lean, or lean and gusts)" },
  { key: "countdown", type: "enum", default: "off", options: ["off", "both", "sunrise", "sunset"], tab: "extras", advanced: false, label: "Countdown timer", shareable: true, preset: true, doc: "off | both | sunrise | sunset" },
  { key: "countdownKind", type: "enum", default: "sun", options: ["sun", "golden", "civil", "nautical", "astro", "moon"], tab: "extras", advanced: true, label: "Count down to", shareable: true, preset: false, doc: "sun | golden | civil | nautical | astro | moon: what the countdown counts down to (morning and evening events)" },
  { key: "countdownLead", type: "enum", default: 20, options: ["10", "15", "20", "30"], tab: "extras", advanced: true, label: "Start counting", shareable: true, preset: true, doc: "minutes before the event the countdown appears" },
  { key: "brightnessDay", type: "number", default: 1, min: 0.1, max: 1, step: 0.05, tab: "extras", advanced: false, label: "By day", shareable: true, preset: true, doc: "0.1 .. 1: how bright the screen is by day (1 = no veil)" },
  { key: "brightnessNight", type: "number", default: 1, min: 0.1, max: 1, step: 0.05, tab: "extras", advanced: false, label: "At night", shareable: true, preset: true, doc: "0.1 .. 1: how bright it is at night" },
  { key: "brightnessTransition", type: "enum", default: 45, options: ["15", "30", "45", "60", "90", "120"], tab: "extras", advanced: true, label: "The change takes", shareable: true, preset: true, doc: "minutes the change takes, centred on sunset and on sunrise" },
  { key: "screenMode", type: "enum", default: "normal", options: ["normal", "led"], tab: "extras", advanced: true, label: "Look of the screen", shareable: true, preset: true, doc: "normal | led (LED panel simulator)" },
  { key: "ledCols", type: "number", default: 64, min: 8, max: 256, step: 1, tab: "extras", advanced: true, label: "LEDs across", shareable: true, preset: true, doc: "LEDs across the panel (64 x 32 is the classic panel)" },
  { key: "ledRows", type: "number", default: 32, min: 8, max: 256, step: 1, tab: "extras", advanced: true, label: "LEDs down", shareable: true, preset: true, doc: "LEDs down it" },
  { key: "ledStars", type: "enum", default: "auto", options: ["auto", "always", "off"], tab: "extras", advanced: true, label: "Stars on the LED panel", shareable: true, preset: false, doc: "off | auto | always: stars, planets and the moon that show in the normal picture also light an LED on the LED panel" },
  { key: "ledTurn", type: "bool", default: true, tab: "extras", advanced: true, label: "Turn to match the screen", shareable: true, preset: true, doc: "turn the panel on its side when the screen is the other way round" },
  { key: "keepAwake", type: "bool", default: true, tab: "extras", advanced: false, label: "Keep the screen on", shareable: true, preset: true, doc: "Screen Wake Lock" },
  { key: "antiBurnIn", type: "enum", default: "auto", options: ["auto", "on", "off"], tab: "extras", advanced: true, label: "Anti burn-in", shareable: true, preset: false, doc: "auto (while the screen is kept on) | on | off: step the digits a few pixels round a small square, once a minute" },
  { key: "preciseLocation", type: "bool", default: false, tab: "place", advanced: false, label: "Use precise location", shareable: false, preset: false },
  { key: "manualLocation", type: "bool", default: false, tab: "place", advanced: false, label: "Set the place myself", shareable: false, preset: false, doc: "the place was typed or searched for (Settings -> Place): never replaced by GPS or the time-zone estimate" },
  { key: "gpsFrequency", type: "enum", default: -1, options: ["-1", "1", "5", "15", "30", "60", "120", "720", "1440", "-2"], tab: "place", advanced: true, label: "Location update frequency", shareable: false, preset: false },
  { key: "coarseLookups", type: "bool", default: true, tab: "place", advanced: true, label: "Share only an approximate position", shareable: false, preset: false, doc: "weather / terrain lookups use a rounded position, never the exact one" },
];


// What each option needs (see the header). Anything not listed runs on every machine. Kept as one table so it is easy to review as a whole.
const NEEDS = {
  clockStyle: { requiresValue: { auto: ["gles3"], glass: ["gles3"], stained: ["gles3"] }, fallback: "solid" },
  glassFrost: { requires: ["gles3"] }, glassGlow: { requires: ["gles3"] }, glassGlowColor: { requires: ["gles3"] },
  digitWeather: { requires: ["gles3"], fallback: "off" },
  windSway: { requires: ["cores>=2"], fallback: "off" },
  plants: { requires: ["gles3"], fallback: false },
  holidayTree: { requires: ["gles3"], fallback: false },
  quality: { requiresValue: { high: ["gles3", "cores>=2"], medium: ["gles3"] }, fallback: "low" },
  viewMode: { requiresValue: { look: ["sensors"] }, fallback: "fixed" },
  sensorRotation: { requires: ["sensors"] }, compassRef: { requires: ["sensors"] }, vrDebug: { requires: ["sensors"] },
  cloudMotion: { requiresValue: { 1: ["cores>=2"], 0.25: ["cores>=2"] }, fallback: 0 },
};
export const SETTINGS = RAW.map((s) => ({ ...s, ...(NEEDS[s.key] || {}) }));
export const SETTING_DEFAULTS = Object.fromEntries(SETTINGS.map((s) => [s.key, s.default]));
export const PRESET_KEYS = SETTINGS.filter((s) => s.preset).map((s) => s.key);
