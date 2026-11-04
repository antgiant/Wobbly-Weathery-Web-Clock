// The presets: what each one sets, as the settings that differ from the defaults ("Standard" is the defaults). The page builds the full
// patch from these (js/sky/presets.js); the native version reads the same list (schema/settings.json). Editing a preset here changes what
// the preset does from now on; share links keep their own frozen copy (js/share.js), so old links never change meaning.

export const PRESET_LIST = [
  { id: "standard", name: "Standard", note: "The default look: liquid glass, a live sky, following the sun.",
    set: {} },
  { id: "bedside", name: "Bedside", note: "Calm and dim at night: no seconds, soft glow, slow clouds, screen stays on.",
    set: {"clockStyle":"glass","glassFrost":0.55,"glassGlow":0.35,"hideSeconds":true,"quality":"medium","cloudMotion":0.25,"brightnessNight":0.25} },
  { id: "sunwatch", name: "Sunset watcher", note: "Countdowns to sunrise and sunset, with a touch more glow.",
    set: {"glassGlow":0.2,"countdown":"both"} },
  { id: "led", name: "LED panel", note: "64 × 32 LED matrix with the countdown in pixels. Light on the battery.",
    set: {"quality":"low","cloudMotion":0.25,"countdown":"both","screenMode":"led","brightnessNight":0.5} },
  { id: "weather", name: "Weather watch", note: "Umbrella alert and sunrise / sunset countdowns.",
    set: {"countdown":"both","rainAlert":true} },
  { id: "everyday", name: "Everyday", note: "Bedside calm plus the weather watch: no seconds, soft glow, dims at night, screen on, umbrella alert, sunrise and sunset countdowns.",
    set: {"glassFrost":0.55,"glassGlow":0.35,"hideSeconds":true,"quality":"medium","cloudMotion":0.25,"countdown":"both","rainAlert":true,"brightnessNight":0.25} },
  { id: "everyday-saver", name: "Everyday, power saver", note: "Everyday as an LED panel with every battery-saver setting: still sky, flat colour, no plants, low quality, dimmer at night. The screen stays on, because it is a clock.",
    set: {"glassFrost":0.55,"hideSeconds":true,"quality":"low","cloudMotion":0,"plants":false,"countdown":"both","screenMode":"led","rainAlert":true,"brightnessNight":0.3} },
  { id: "showcase", name: "Showcase", note: "Everything turned up: high quality, glowing glass, moving clouds.",
    set: {"clockStyle":"glass","glassFrost":0.25,"glassGlow":0.45,"quality":"high"} },
  { id: "saver", name: "Battery saver", note: "Still sky, flat ink, no plants, dimmed at night, screen not forced on.",
    set: {"clockStyle":"solid","quality":"low","cloudMotion":0,"plants":false,"brightnessNight":0.3,"keepAwake":false} },
];
