// The camera: the clock view, look-around, VR, following the sun, the labels, and the return-to-default button.

import { conf } from '../config.js';
import { now } from '../simtime.js';
import { sunEvents, followHeading } from './sunpath.js';
import { canvas, engine, controls, num, ov, DEG, DEFAULT_LAT, defaultLon } from './core.js';

// Bottom edge of the clock digits, in canvas CSS pixels (digit glyphs end at the bottom of their viewBox).
export function clockBottom() {
  const cr = canvas.getBoundingClientRect();
  let bottom = -Infinity, digitH = 0;
  document.querySelectorAll('#clock svg').forEach((el) => {
    if (getComputedStyle(el).display === 'none') return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const k = Math.min(r.width / 100, r.height / 116);
    bottom = Math.max(bottom, r.top + (r.height - 116 * k) / 2 + 116 * k - cr.top);
    digitH = Math.max(digitH, 116 * k);
  });
  return Number.isFinite(bottom) ? { bottom, dh: digitH, h: cr.height, w: cr.width } : null;
}

// Tilt the camera so the horizon lands exactly on the bottom of the digits. In a rectilinear view the
// horizon is a straight line at ndc_y = -tan(pitch) / tan(fovY / 2), so solve for the pitch.
export function pitchForHorizonAtClockBottom(fovDeg) {
  const m = clockBottom();
  if (!m || !m.h) return null;
  // the horizon crosses the digits this far up from their bottom edge, so the glass shows ground
  const frac = Math.max(0, Math.min(0.8, num(conf.horizonInDigits, 0.3)));
  const ndc = 1 - 2 * (m.bottom - frac * m.dh) / m.h;
  const t = Math.tan(fovDeg * Math.PI / 360), aspect = m.w / m.h;
  const ty = aspect >= 1 ? t / aspect : t;
  const p = Math.atan(-ndc * ty) * 180 / Math.PI;
  return Math.max(-10, Math.min(80, p));
}

// Sunrise and sunset times are searched for once per bracket (between two events) rather than on every tick.
const evCaches = {};                                    // one per kind of event (the camera needs sunrise and sunset while the countdown may count down to something else)
export function getSunEvents(date, type = 'sun') {
  const evCache = evCaches[type] || (evCaches[type] = { key: '', at: 0, ev: null });
  const lat = num(ov.lat ?? conf.location_latitude, DEFAULT_LAT), lon = num(ov.lon ?? conf.location_longitude, defaultLon());
  const elev = engine?.s.elevM || 0, key = `${lat.toFixed(3)},${lon.toFixed(3)},${Math.round(elev)}`;
  const t = +date, c = evCache.ev;
  const fresh = c && evCache.key === key && Math.abs(t - evCache.at) < 12 * 3600e3
    && t >= Math.max(+(c.prevRise || 0), +(c.prevSet || 0)) && t < Math.min(+(c.nextRise || Infinity), +(c.nextSet || Infinity));
  if (!fresh) { evCache.ev = sunEvents(date, lat, lon, elev, type); evCache.key = key; evCache.at = t; }
  return { ev: evCache.ev, lat, lon, elev };
}

// "the default view": the clock view, or look-around that has not been dragged away from where it started
export const atDefault = () => controls?.mode === 'fixed' || (controls?.mode === 'drag' && !controls.userMoved);
export const followActive = () => !!conf.followSun && atDefault() && ov.az == null;

export function applyView() {
  if (!controls) return;
  const fov = num(conf.viewFov, 80);
  let pitch = num(ov.pitch ?? conf.viewPitch, 12);
  if (controls.mode === 'drag' && controls.userMoved) { controls.setView({ fov }); return; }   // the user's view is theirs
  const auto = ov.pitch == null && conf.viewPitchAuto && atDefault();
  if (auto) pitch = pitchForHorizonAtClockBottom(fov) ?? pitch;
  const slider = document.getElementById('viewPitch');
  if (slider) { slider.disabled = !!(ov.pitch == null && conf.viewPitchAuto); if (auto) { slider.value = Math.round(pitch); const o = document.getElementById('viewPitchOut'); if (o) o.textContent = Math.round(pitch); } }
  let heading = num(ov.az ?? conf.viewHeading, 180);
  const follow = followActive();
  if (follow) {
    // never touches the pitch: only the heading follows the sun, so the sun stays put up and down
    const d = now(), { ev, lat, lon, elev } = getSunEvents(d);
    const t = Math.tan(fov * Math.PI / 360), aspect = window.innerWidth / Math.max(1, window.innerHeight);
    heading = followHeading(d, lat, lon, elev, { pitch, tanX: aspect >= 1 ? t : t * aspect }, ev);
  }
  const hs = document.getElementById('viewHeading');
  if (hs) { hs.disabled = follow; if (follow) { hs.value = Math.round(heading); const o = document.getElementById('viewHeadingOut'); if (o) o.textContent = Math.round(heading); } }
  controls.setView({ heading, pitch, fov });
}

// ------------------------------------------------------------------- HUD --
const hud = document.getElementById('hud');
export function updateHud() {
  if (!hud || !engine?.sky) return;
  const show = conf.showLabels || conf.viewMode === 'look';
  hud.hidden = !show;
  if (!show) return;
  const b = engine._basis();
  const w = window.innerWidth, h = window.innerHeight;
  const aspect = w / h, t = Math.tan(engine.s.view.fov * Math.PI / 360);
  const tan = aspect >= 1 ? [t, t / aspect] : [t * aspect, t];
  const items = [
    { name: '☀ Sun', dir: engine.sky.sun.dir, alt: engine.sky.sun.alt },
    { name: '☾ Moon', dir: engine.sky.moon.dir, alt: engine.sky.moon.alt },
    ...engine.sky.planets.map(p => ({ name: p.name, dir: p.dir, alt: p.alt, minor: true })),
  ];
  const html = [];
  const look = controls.lookDir;
  const m = 26;                                     // keep edge labels this far inside the screen
  const edge = (x, y, text) => {                    // labels hug the edge they are pinned to instead of sticking out of the screen
    const side = x <= m ? 'l' : x >= w - m ? 'r' : 'c';
    const px = side === 'l' ? 8 : side === 'r' ? w - 8 : x;
    return `<span class="lbl edge ${side}" style="left:${px.toFixed(0)}px;top:${y.toFixed(0)}px">${text}</span>`;
  };
  const fovV = 2 * Math.atan(tan[1]) / DEG;
  for (const it of items) {
    if (it.minor && it.alt < 0) continue;
    const d = it.dir;
    const cx = d[0] * b.right[0] + d[1] * b.right[1] + d[2] * b.right[2];
    const cy = d[0] * b.up[0] + d[1] * b.up[1] + d[2] * b.up[2];
    const cz = d[0] * b.forward[0] + d[1] * b.forward[1] + d[2] * b.forward[2];
    const below = it.alt < 0 ? ' (below horizon)' : '';
    const cls = it.minor ? ' minor' : '';
    if (cz > 0.05) {
      const x = (cx / (cz * tan[0]) * 0.5 + 0.5) * w, y = (0.5 - cy / (cz * tan[1]) * 0.5) * h;
      if (x > -20 && x < w + 20 && y > -20 && y < h + 20) {
        html.push(`<span class="lbl${cls}" style="left:${x.toFixed(0)}px;top:${(y + 14).toFixed(0)}px">${it.name}${below}</span>`);
        continue;
      }
      if (!it.minor) {                              // in front but off screen: pin it to the nearest edge, where it really is
        const ex = Math.min(w - m, Math.max(m, x)), ey = Math.min(h - m, Math.max(m, y));
        const arrow = x < 0 ? '◀ ' : x > w ? '' : '';
        const tail = x > w ? ' ▶' : '';
        const vert = y < 0 ? '▲ ' : y > h ? '▼ ' : '';
        html.push(edge(ex, ey, `${arrow}${vert}${it.name}${below} ${Math.round(it.alt)}°${tail}`));
      }
      continue;
    }
    if (!it.minor) {
      // Behind the camera. Projecting it would put an object that is below the horizon near the top of the
      // screen whenever the view is tilted up, so place it by what it really is: which way to turn
      // (left / right) and how far above or below where you are looking (altitude difference).
      const right = cx >= 0;
      const dv = it.alt - look.alt;
      const f = Math.max(-1, Math.min(1, dv / Math.max(fovV, 30)));
      const ey = h / 2 - f * (h / 2 - m);
      const ex = right ? w - m : m;
      html.push(edge(ex, ey, `${right ? '' : '◀ '}${it.name}${below} ${Math.round(it.alt)}°${right ? ' ▶' : ''}`));
    }
  }
  const card = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(look.az / 45) % 8];
  html.push(`<div class="readout">${card} ${Math.round(look.az)}° · ${look.alt >= 0 ? '+' : ''}${Math.round(look.alt)}°</div>`);
  hud.innerHTML = html.join('');
}

// Raw sensor numbers, for working out what a device does (Settings -> View -> Motion sensor fixes).
export function updateVrReadout() {
  let el = document.getElementById('vrReadout');
  if (!conf.vrDebug) { if (el) el.hidden = true; return; }
  if (!el) { el = document.createElement('pre'); el.id = 'vrReadout'; document.body.appendChild(el); }
  const d = controls?.debug;
  const f = (v) => (typeof v === 'number' ? v.toFixed(1) : '-');
  el.hidden = false;
  el.textContent = d
    ? `alpha ${f(d.a)}  beta ${f(d.b)}  gamma ${f(d.g)}\nscreen angle ${d.screenAngle}${controls.ignoreScreenAngle ? ' (ignored)' : ''}  absolute ${d.abs}\ncompass ${f(d.compass)}  offset ${f(d.off)}  ref ${d.mode}${conf.compassRef === 'auto' ? ' (auto)' : ''}\nview ${f(controls.lookDir.az)}  ${f(controls.lookDir.alt)}`
    : 'no sensor readings yet (VR look-around must be on)';
}

export function applySensorFixes() {
  if (!controls) return;
  controls.ignoreScreenAngle = conf.sensorRotation === 'ignore';
  controls.compass.force = conf.compassRef === 'cam' || conf.compassRef === 'top' ? conf.compassRef : 'auto';
}

let baseMode = 'drag';
export const setBaseMode = (m) => { baseMode = m; };                         // the mode "default view" returns to (never VR)
export async function setViewMode(mode) {
  const ok = await controls.setMode(mode);
  if (ok && mode !== 'look') baseMode = mode;
  conf.viewMode = ok ? mode : conf.viewMode === 'look' ? 'drag' : conf.viewMode;
  document.body.dataset.view = controls.mode;
  document.getElementById('viewMode').value = controls.mode;
  applyView();
  document.getElementById('vrButton')?.setAttribute('aria-pressed', String(controls.mode === 'look'));
  updateHomeButton();
  updateHud();                                  // the labels job sleeps unless VR or labels are on
  return ok;
}

export function updateHomeButton() {
  const b = document.getElementById('homeButton');
  if (b && controls) b.dataset.atDefault = String(controls.mode !== 'look' && atDefault());
}

/** Back to the default framing: out of VR, undo any dragging / zooming, and the sun-following view again. */
export async function returnToDefaultView() {
  if (controls.mode === 'look') await setViewMode(baseMode);
  controls.userMoved = false;
  controls.yawOffset = 0;
  applyView();
  updateHomeButton();
}

