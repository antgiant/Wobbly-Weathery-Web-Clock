// What the hardware can handle: a ladder of rungs below the quality governor's resolution levels. The clock must always show the right time, so when even the cheapest picture costs
// too much the engine gives things up in a fixed order until the time is right, whatever the user chose (a clock that shows the wrong time is worth nothing). The seconds go before
// the glass and the real sky and ground do: the picture a person looks at stays as rich as the hardware can draw, and a clock that cannot keep pace with its seconds shows the minutes
// beautifully instead of the seconds badly.
//
//    0 full            everything the quality governor allows
//    1 weather         no rain or snow in motion (streaks, drops on the digits): the weather stays as light and cloud, standing still
//    2 ambient         no cloud or water drift, plant sway or twinkle: the sky is redrawn only when the sun has moved
//    3 tick            seconds shown but not morphing: each second is drawn once, on the second
//    4 seconds off     no seconds; the picture is redrawn when it must be (a new minute, the light)
//    5 slow clock      one picture a minute, drawn ahead of time and shown on the minute (so a redraw may take most of a minute)
//    6 solid digits    no glass: flat digits in one cheap pass (the glass is the most expensive thing drawn)
//    7 flat ground     no terrain, plants or tree: the ground is a colour fading towards the horizon
//    8 gradient sky    no sky tables, clouds or stars: a gradient from the sun's height (flatsky.js)
//    9 smaller         the whole picture at half the size (the screen enlarges it): only when even that much is too slow for one picture a minute
//   10 smallest        a quarter of the size
//
// The quality governor (governor.js) moves along its resolution levels first; only when it is on its lowest level and frames still cost too much does a rung go.
// A rung comes back after a good while, when there may be room again (something else stopped using the CPU); if it was not, it goes again within a few frames.
//
// Pure maths like the governor: the caller passes costs and the time, so it is tested in node.
import { Governor, LADDER, SHARP_LADDER } from './governor.js';

/** The 'adapt' setting's names for holding the ladder at a rung (and the steps before it). */
export const RUNG_OF = { weather: 1, ambient: 2, tick: 3, 'seconds-off': 4, slow: 5, solid: 6, 'flat-ground': 7, 'gradient-sky': 8 };
export const RUNGS = ['full', 'weather', 'ambient', 'tick', 'seconds off', 'slow clock', 'solid digits', 'flat ground', 'gradient sky', 'smaller picture', 'smallest picture'];
export const WHY = [
  'everything on',
  'rain and snow stand still (the frames cost too much)',
  'clouds, water and plants stand still (the frames cost too much)',
  'seconds tick instead of morphing (the frames cost too much)',
  'seconds are hidden (a second could be missed)',
  'one picture a minute (a redraw takes too long to keep pace)',
  'the digits are solid, not glass (even one picture a minute takes too long)',
  'the ground is a flat colour (even one picture a minute takes too long)',
  'the sky is a gradient (even one picture a minute takes too long)',
  'a smaller picture (it takes too long even without glass, landscape or sky)',
  'the smallest picture (it takes too long even at half the size)',
];
/** The most a single redraw of the digits (glass) and of the sky (scene) may take on each rung, ms: more than that and the clock could not keep up with what the rung promises. */
export const BUDGET = [
  null, null, null,                       // the live rungs: the quality governor's frame budget
  { glass: 600, scene: 900 },             // tick: a redraw must end inside its second
  { glass: 2500, scene: 6000 },           // seconds off: the light timer only
  { glass: 40000, scene: 40000 },         // slow clock: a minute to draw the next one (the lead is 1.4 x the redraw: 40 s leaves the minute's last seconds)
  { glass: 40000, scene: 40000 },
  { glass: 40000, scene: 40000 },
  { glass: 40000, scene: 40000 },
  { glass: 40000, scene: 40000 },
  { glass: 40000, scene: 40000 },
];

/** What each rung switches off, by the setting keys it makes pointless (the settings screens grey these out, ladderui.js). Seconds act on the clock: hideSeconds is shown on and locked. */
export const GIVEN_UP = {
  weather: ['digitWeather'],
  ambient: ['cloudMotion', 'windSway'],
  glass: ['clockStyle', 'glassFrost', 'glassGlow', 'glassGlowColor', 'legibility'],
  landscape: ['landscape', 'plants', 'holidayTree'],
  sky: ['bodySize', 'nightBrightness', 'lightPollution', 'showLabels'],
};
/** The setting keys the ladder has given up at these knobs, each with the feature it gave up (`null`: no ladder: nothing). */
export function givenUp(k) {
  if (!k) return {};
  const out = {};
  if (!k.weather) for (const key of GIVEN_UP.weather) out[key] = 'weather';
  if (!k.ambient) for (const key of GIVEN_UP.ambient) out[key] = 'ambient';
  if (k.seconds === 'off') out.hideSeconds = 'seconds';
  if (!k.glass) for (const key of GIVEN_UP.glass) out[key] = 'glass';
  if (!k.landscape) for (const key of GIVEN_UP.landscape) out[key] = 'landscape';
  if (!k.sky) for (const key of GIVEN_UP.sky) out[key] = 'sky';
  return out;
}

/**
 * How long a sky redraw must wait (ms; 0: it may start now) so that it cannot still be running when the minute turns, with room for the digits' own redraw after it.
 * toMin: ms to the next minute; sceneMs: the slowest recent sky redraw; leadMs: the digits' lead.
 */
export function quietFor(toMin, sceneMs, leadMs) {
  const need = Math.min(45000, sceneMs * 1.3 + leadMs + 1000);
  return toMin < need ? toMin + 60 : 0;
}

export class Capability {
  /**
   * @param {{profile?:'sharp'|'smooth', rung?:number, pin?:boolean, floorFps?:number, ceilFps?:number, level?:number, retryMs?:number}} o
   *   profile: 'sharp' keeps the output size (a display) and only the sky shrinks; 'smooth' lets the whole picture shrink (a small LED panel).
   */
  constructor({ profile = 'smooth', rung = 0, pin = false, retryMs = 30 * 60000, ...gov } = {}) {
    this.profile = profile;
    this.rung = Math.max(0, Math.min(RUNGS.length - 1, rung));
    this.gov = new Governor({ ladder: profile === 'sharp' ? SHARP_LADDER : LADDER, pin, ...gov, ...(this.rung > 0 ? { level: 0 } : {}) });      // (a rung given up means the picture is already the cheapest)
    this.pin = !!pin; this.retryMs = retryMs;
    this.glass = []; this.scene = [];       // the last redraw costs of each kind, ms
    this.over = 0; this.overGlass = 0; this.overScene = 0;       // reports in a row that were too costly for this rung
    this.retryAt = this.rung > 0 ? this.retryMs : Infinity; this.changes = 0;
  }

  get name() { return RUNGS[this.rung]; }
  get rungIndex() { return this.rung; }
  get why() { return WHY[this.rung]; }
  get cost() { return this.gov.cost; }
  get tickMs() { return this.gov.tickMs; }
  get level() { return this.gov.level; }
  get budgetMs() { return this.gov.budgetMs; }
  /** Everything the engine and page read: the governor's resolution knobs and what the rung leaves on. */
  get knobs() {
    const k = this.gov.knobs, r = this.rung;
    return {
      ...k,
      skyMs: r < 3 ? k.skyMs : r < 4 ? Math.max(k.skyMs, 15000) : 60000,       // the sun moves a quarter of a degree a minute: a still sky need not be drawn more often than that on the slow rungs
      weather: r < 1, ambient: r < 2,
      seconds: r < 3 ? 'morph' : r < 4 ? 'tick' : 'off',
      cadence: r < 5 ? 'live' : 'minute',
      ahead: r >= 4,       // the minute's digits are drawn a little before it and shown on it (a host that can hold a frame), and no sky redraw is started where it could cross the minute
      glass: r < 6, landscape: r < 7, sky: r < 8,
      outScale: r >= 10 ? Math.min(k.outScale, 0.25) : r >= 9 ? Math.min(k.outScale, 0.5) : k.outScale,       // (the last resort: a smaller picture, enlarged by the screen)
      rung: r, name: RUNGS[r],
    };
  }
  /** The slowest recent redraw of each kind. */
  worst(kind) { const a = kind === 'scene' ? this.scene : this.glass; return a.length ? Math.max(...a) : 0; }
  /** The lead the page should give a redraw of the digits on the slow rungs, ms: how long before the minute to start drawing it. */
  get leadMs() { return Math.ceil(this.worst('glass') * 1.6 + 700); }

  /**
   * One redraw took `costMs`; `kind` is 'glass' (the digits and the final passes) or 'scene' (the sky was drawn too). now = a monotonic time, ms.
   * Returns true when something changed (the caller applies `knobs`).
   */
  report(costMs, kind = 'glass', now = 0) {
    if (!(costMs >= 0)) return false;
    const a = kind === 'scene' ? this.scene : this.glass;
    a.push(costMs); if (a.length > 6) a.shift();
    if (this.pin) return false;
    let changed = false;
    if (this.rung === 0) changed = this.gov.report(kind === 'scene' ? costMs * 0.25 : costMs, now);   // resolution first: a scene frame is rare among the digits' frames
    else {
      if (now >= this.retryAt) { this._move(this.rung - 1); this.retryAt = now + this.retryMs; return true; }       // try the richer rung again
      this.gov.observe(kind === 'scene' ? costMs * 0.25 : costMs);
    }
    if (changed) return true;
    if (this.gov.level > 0 && this.rung === 0) return false;       // not on the cheapest picture yet
    // the lowest resolution: is this rung affordable?
    const b = BUDGET[this.rung];
    let over;
    if (!b) { over = this.gov.cost != null && this.gov.cost > this.gov.budgetMs && this.gov.samples >= 4; this.over = over ? this.over + 1 : 0; }
    else {                                                          // glass redraws and sky redraws are counted apart (one kind fitting must not hide the other missing)
      if (kind === 'glass') this.overGlass = costMs > b.glass ? this.overGlass + 1 : 0; else this.overScene = costMs > b.scene ? this.overScene + 1 : 0;
      this.over = Math.max(this.overGlass, this.overScene);
    }
    if (this.over >= (b ? 2 : 1) && this.rung < RUNGS.length - 1) {
      // a rung that missed by a little may do better another time; one that missed by more than a quarter (a 7 s redraw for a 2.5 s budget) will not, and a try would show the wrong time while it fails
      const worst = b ? Math.max(this.worst('glass') / b.glass, this.worst('scene') / b.scene) : (this.gov.cost || 0) / this.gov.budgetMs;
      this._move(this.rung + 1); this.retryAt = now + (worst > 1.25 ? 12 * 3600000 : this.retryMs); return true;
    }
    return false;
  }

  _move(rung) {
    this.rung = rung; this.changes++; this.over = 0; this.overGlass = 0; this.overScene = 0;
    if (rung === 0) this.retryAt = Infinity;
    this.glass = []; this.scene = [];
    this.gov.cost = null; this.gov.samples = 0; this.gov.stableSince = 0;
  }
}
