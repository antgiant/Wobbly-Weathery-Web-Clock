// Runs the web page itself, unmodified, with no browser: index.html is parsed into the small DOM (dom.js), the browser's globals are provided,
// js/index.js (the page's entry) is imported, and the frames are drawn by the same sky engine into an OpenGL ES framebuffer.
import './polyfills.js';
import { parseDocument, Element, Evt, EventTarget_, Node_, Text, Doc, setLayoutHook, setCanvasFactory, computedStyle, rect } from './dom.js';
import { layoutClock } from 'js/clocklayout.js';
import { SETTINGS } from 'schema/settings.js';

const G = globalThis, A = __args, W = A.w, H = A.h;

// ---- window as an event target, and the event classes ----
for (const k of ['addEventListener', 'removeEventListener', '_fire', 'dispatchEvent']) Object.defineProperty(G, k, { value: EventTarget_.prototype[k], writable: true, configurable: true });
G.Event = Evt; G.CustomEvent = class CustomEvent extends Evt { constructor(t, i = {}) { super(t, i); this.detail = i.detail; } };
for (const n of ['KeyboardEvent', 'MouseEvent', 'PointerEvent', 'TouchEvent', 'WheelEvent', 'FocusEvent', 'InputEvent', 'StorageEvent', 'PopStateEvent', 'MessageEvent']) G[n] = class extends Evt {};
G.Node = Node_; G.Element = Element; G.HTMLElement = Element; G.SVGElement = Element; G.Text = Text; G.Document = Doc;
for (const n of ['HTMLInputElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLDivElement', 'HTMLSpanElement', 'HTMLAnchorElement', 'HTMLTextAreaElement', 'HTMLDialogElement', 'HTMLImageElement', 'HTMLFormElement', 'SVGSVGElement']) G[n] = Element;

// ---- the canvas element: an Element that is also the drawing surface ----
class CanvasEl extends Element {
  constructor() { super('canvas'); this._w = 300; this._h = 150; this._id = -1; }
}
for (const k of Object.getOwnPropertyNames(HTMLCanvasElement.prototype)) if (k !== 'constructor') Object.defineProperty(CanvasEl.prototype, k, Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, k));
setCanvasFactory(() => new CanvasEl());
G.HTMLCanvasElement = CanvasEl;

// ---- the document: the page's own markup ----
const doc = parseDocument(__readtext(__root + '/index.html'));
doc.baseURI = 'file://' + __root + '/index.html';
G.document = doc;
doc.activeElement = doc.body;
G.getComputedStyle = (el) => computedStyle(el);
G.innerWidth = G.outerWidth = W; G.innerHeight = G.outerHeight = H; G.scrollX = G.scrollY = G.pageXOffset = G.pageYOffset = 0; G.devicePixelRatio = 1;
G.screen = { width: W, height: H, availWidth: W, availHeight: H, colorDepth: 24, orientation: { type: W >= H ? 'landscape-primary' : 'portrait-primary', angle: 0, addEventListener() {}, removeEventListener() {} } };
G.matchMedia = (q) => ({ media: q, matches: /prefers-reduced-motion:\s*no-preference|orientation:\s*landscape/.test(q) && !/reduce/.test(q) ? true : false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null });
G.history = { state: null, length: 1, replaceState() {}, pushState() {}, back() {}, forward() {}, go() {} };
G.navigator = { onLine: true, language: 'en-US', languages: ['en-US'], userAgent: 'wobbly-host (Linux)', platform: 'Linux', hardwareConcurrency: 4, maxTouchPoints: 0, cookieEnabled: false, standalone: false, vibrate() { return false; } };
let searchText = A.search || '';
if (A.at) { const q = new URLSearchParams(searchText); q.set('t', new Date(A.at).toISOString()); q.set('speed', '1'); searchText = q.toString(); }     // --at: pretend it is this moment (and let time run on)
// a CPU doing the drawing (no usable GPU): smaller sky tables (js/sky/engine.js lutScale), unless --lut says otherwise
if (A.present) {
  const renderer = String(__gl('getString', 0x1F01));
  const soft = /llvmpipe|softpipe|swrast/i.test(renderer);
  const q = new URLSearchParams(searchText);
  if (!q.has('gov') && !A.nogov) { q.set('gov', '1'); q.set('minfps', String(A.minfps || 15)); q.set('maxfps', String(A.maxfps || 60)); if (soft && !q.has('level')) q.set('level', '1'); }   // the quality governor: 15 to 60 frames a second
  searchText = q.toString();
  __print('drawing with: ' + renderer + (q.has('gov') ? ' (quality governor: ' + (A.minfps || 15) + ' to ' + (A.maxfps || 60) + ' fps)' : ''));
}
const search = searchText ? (searchText[0] === '?' ? searchText : '?' + searchText) : '';
G.location = { search, hash: '', href: doc.baseURI + search, origin: 'file://', protocol: 'file:', host: '', hostname: '', pathname: '/index.html', reload() {}, assign() {}, replace() {} };

// ---- localStorage: one JSON file ----
{
  let data = {}; try { data = JSON.parse(__store_read()); } catch (_) { /* start empty */ }
  let pending = 0; const flush = () => { pending = 0; __store_write(JSON.stringify(data)); };
  G.localStorage = { getItem: (k) => (k in data ? data[k] : null), setItem(k, v) { data[k] = String(v); if (!pending) pending = setTimeout(flush, 300); }, removeItem(k) { delete data[k]; if (!pending) pending = setTimeout(flush, 300); }, clear() { data = {}; flush(); }, key: (i) => Object.keys(data)[i] || null, get length() { return Object.keys(data).length; } };
  const mem = {}; G.sessionStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem(k, v) { mem[k] = String(v); }, removeItem(k) { delete mem[k]; }, clear() { for (const k in mem) delete mem[k]; }, key: (i) => Object.keys(mem)[i] || null, get length() { return Object.keys(mem).length; } };
}

if (A.conf) localStorage.setItem('conf', String(A.conf));
if (A.config !== undefined && A.config !== '' || A.present) {
  // the settings file (`key = value`, the page's own names) becomes the page's saved settings, coerced by the schema's types
  const specs = Object.fromEntries(SETTINGS.map((x) => [x.key, x]));
  const conf = JSON.parse(localStorage.getItem('conf') || '{}');
  for (const raw of String(A.config || '').split('\n')) {
    const line = raw.replace(/#.*/, '').trim(); const i = line.indexOf('='); if (i < 1) continue;
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim(), sp = specs[k];
    if (/^(on|true|yes|1)$/i.test(v) && (!sp || sp.type === 'bool')) conf[k] = true;
    else if (/^(off|false|no|0)$/i.test(v) && (!sp || sp.type === 'bool')) conf[k] = false;
    else if (sp && sp.type === 'number' || (!sp && v !== '' && !Number.isNaN(Number(v)))) conf[k] = Number(v);
    else conf[k] = v;
  }
  if ('location_latitude' in conf && 'location_longitude' in conf) { conf.locationChoice = 'manual'; conf.manualLocation = true; conf.preciseLocation = false; }
  if (A.ledCols) { conf.screenMode = 'led'; conf.ledCols = A.ledCols; conf.ledRows = A.ledRows; }
  localStorage.setItem('conf', JSON.stringify(conf));
}

// ---- fetch: local files, and the network through curl ----
G.fetch = (url, init = {}) => new Promise((resolve, reject) => {
  const href = String(url), sig = init.signal;
  const abort = () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
  if (sig && sig.aborted) return abort();
  const reply = (status, buf) => resolve({ ok: status >= 200 && status < 300, status, statusText: '', url: href, headers: { get: () => null, has: () => false }, arrayBuffer: async () => buf, text: async () => new TextDecoder().decode(buf), json: async () => JSON.parse(new TextDecoder().decode(buf)), clone() { return this; } });
  if (/^https?:/i.test(href)) {
    const id = __http_start(href);
    const poll = () => { if (sig && sig.aborted) return abort(); const r = __http_poll(id); if (r === undefined) return setTimeout(poll, 40); if (r.status === 0) return reject(new TypeError('Failed to fetch')); reply(r.status, r.data); };
    return setTimeout(poll, 40);
  }
  try { reply(200, __readfile(href.replace(/^file:\/\//, '').replace(/[?#].*$/, ''))); } catch (e) { reply(404, new ArrayBuffer(0)); }
});

// ---- repeatable runs: a seeded Math.random (the same generator is installed in the browser by tests/app-chromium.mjs) and no network ----
if (A.seed) { let a = A.seed >>> 0; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
if (A.offline) { const f = G.fetch; G.fetch = (u, i) => (/^https?:/i.test(String(u)) ? Promise.reject(new TypeError('Failed to fetch')) : f(u, i)); }

// ---- the page's boxes ----
const $ = (id) => doc.getElementById(id);
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
function clockLayout() {
  const clock = $('clock'), body = doc.body, root = doc.documentElement;
  const items = clock.children.filter((c) => c.localName === 'svg').map((el) => ({ hidden: computedStyle(el).display === 'none', width: el.style.width, marginRight: el.style.marginRight, hundreds: el.id === 'hundredsDigit', colon: !el.querySelector('path[id]') }));
  const led = body.dataset.led ? { mode: body.dataset.led, aspect: num(body.style.getPropertyValue('--led-aspect'), 2), top: num(body.style.getPropertyValue('--led-top'), 0), units: num(clock.style.getPropertyValue('--units'), 7), rows: num(clock.style.getPropertyValue('--rows'), 3) } : null;
  return { items, ...layoutClock({ vw: W, vh: H, pillRoom: num(root.style.getPropertyValue('--pill-room'), 0), burn: [num(root.style.getPropertyValue('--burn-x'), 0), num(root.style.getPropertyValue('--burn-y'), 0)], marginLeft: clock.style.marginLeft, led, items }) };
}
setLayoutHook((el) => {
  if (el.localName === 'canvas') return el.id === 'sky' ? rect(0, 0, W, H) : rect(0, 0, el.width || 0, el.height || 0);
  if (el === doc.documentElement || el === doc.body) return rect(0, 0, W, H);
  const clock = $('clock');
  if (el === clock) { const l = clockLayout(); return rect(...l.box); }
  if (el.parentNode === clock && el.localName === 'svg') { const l = clockLayout(), i = clock.children.filter((c) => c.localName === 'svg').indexOf(el), r = l.rects[i]; return r ? rect(...r) : rect(0, 0, 0, 0); }
  return rect(0, 0, 0, 0);
});

// ---- run the page ----
const t0 = performance.now();
await import('js/index.js');
doc.readyState = 'interactive'; doc.dispatchEvent(new Evt('DOMContentLoaded', { bubbles: true }));
doc.readyState = 'complete'; G.dispatchEvent(new Evt('load'));
const until = async (f, ms) => { const s = performance.now(); while (!f() && performance.now() - s < ms) await new Promise((r) => setTimeout(r, 20)); return f(); };
const sky = $('sky'), want = A.frames || 3;
let presented = 0; G.__govN = 0;
if (A.present) {
  const gl = sky.getContext('webgl2');
  const send = () => {
    const e = G.__sky; if (!e) return;
    const w = sky.width, h = sky.height; gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const dim = $('dimmer'), level = dim && !dim.hidden ? Math.max(0, 1 - (parseFloat(dim.style.opacity) || 0)) : 1;
    __present(w, h, px.buffer, level); presented++;
    if (A.timing) __print('[' + Math.round(performance.now()) + ' ms] frame ' + presented + ' presented');
    if (A.profile && G.__profDump) G.__profDump();
  };
  await until(() => !!G.__sky, 30000);
  if (A.profile && G.__sky) {      // time the engine's own CPU-side parts (the drawing inside them is counted by the GL profile)
    const e = G.__sky;
    for (const [k, label] of [['render', 'engine.render, everything inside it'], ['_updateAstro', 'astronomy (sun, moon, planets)'], ['_updateLuts', 'sky tables, incl. their drawing'], ['setGlassMask', 'glass mask upload'], ['_autoScale', 'automatic scale']]) {
      if (typeof e[k] !== 'function') continue; const f = e[k].bind(e);
      e[k] = (...a) => { const t = performance.now(); const r = f(...a); G.__pt[label] = (G.__pt[label] || 0) + performance.now() - t; return r; };
    }
  }
  if (A.ledCols && G.__sky) G.__sky.glass.led.gap = 0;                 // the panel needs the cells' own colours, with no dark lines between
  if (G.__sky) {                                      // every change to the picture, including a digit that only moved; several changes in one turn are one frame
    let pending = false;
    let t0 = 0, kind = 'glass';
    G.__sky.onPresent((e, k) => { if (k === 'scene') kind = 'scene'; if (!pending) { pending = true; t0 = performance.now(); setTimeout(() => { pending = false; send(); G.__sky.reportFrame(performance.now() - t0, kind); kind = 'glass'; if (A.timing && G.__sky.gov) { const g = G.__sky.gov; if (++G.__govN % 20 === 0) __print('governor: level ' + g.level + ', frame cost ' + Math.round(g.cost || 0) + ' ms, tick ' + Math.round(g.tickMs) + ' ms, outScale ' + G.__sky.s.outScale.toFixed(2)); } }, 0); } });
  }
}
if (A.present) {
  // the service: show frames until stopped, or until --frames have been presented
  if (A.frames) { await until(() => presented >= A.frames, 600000); __done(); }
  await new Promise(() => {});
}
const ok = await until(() => (G.__frames || 0) >= want && doc.body.classList.contains('ready'), (A.timeout || 60) * 1000);
await new Promise((r) => setTimeout(r, A.settle || 600));
console.log('ready: ' + ok + ', frames ' + (G.__frames || 0) + ', ' + Math.round(performance.now() - t0) + ' ms; body.dataset: ' + JSON.stringify(Object.fromEntries(Object.entries(Object.fromEntries(doc.body._attrs)).filter(([k]) => k.startsWith('data-')))));
if (A.debug) {
  const e = G.__sky; console.log('glass: mode ' + (e && e.glass.mode) + ' hasMask ' + (e && e.glass.hasMask) + ' rect ' + JSON.stringify(e && e.glass.rect));
  for (const id of ['h0p3', 'h1p3', 'm0p3', 'm1p3']) console.log(id + ' d=' + (doc.getElementById(id) || { getAttribute() {} }).getAttribute('d'));
  console.log('clock box ' + JSON.stringify(doc.getElementById('clock').getBoundingClientRect()) + ' svg0 ' + JSON.stringify(doc.getElementById('clock').children[1].getBoundingClientRect()));
  console.log('title: ' + doc.title);
  if (e) console.log('state: ' + JSON.stringify({ light: e.glass.light, lightCol: e.glass.lightCol, glowCol: e.glass.glowCol, ink: e.glass.ink, frost: e.glass.frost, contrast: e.glass.contrast, glow: e.glass.glow, mode: e.glass.mode, rect: e.glass.rect, maskW: e.glass.maskW, maskH: e.glass.maskH, stroke: e.glass.stroke, view: e.s.view && [e.s.view.heading, e.s.view.pitch], scale: e.s.scale, mips: e._mipsValid, dropsOn: e.glass.dropsOn }));
}
if (A.out) {
  const gl = sky.getContext('webgl2'); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const px = new Uint8Array(sky.width * sky.height * 4); gl.readPixels(0, 0, sky.width, sky.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  __writeppm(A.out, sky.width, sky.height, px.buffer);
}
__done();
