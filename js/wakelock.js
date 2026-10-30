// Keep the screen on.
//
// 1. Screen Wake Lock API where it exists.
// 2. Fallback: a tiny silent looping video, played inline. iOS Safari treats a playing video as
//    "something is on screen" and does not dim or lock, even where Wake Lock is missing (older
//    iOS) or refused (Home Screen web apps, low power mode quirks).
//
// Both need a *user activation*: on a touch screen only click / touchend / pointerup / keydown
// count (pointerdown does not, which is why a pointerdown retry can never succeed on iOS). So the
// request is retried on every such gesture until it works, and a visible banner asks for the tap.
import { conf } from './config.js';

const supported = 'wakeLock' in navigator;
const MP4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM3bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAmF0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHZbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABhG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAURzdGJsAAAAuHN0c2QAAAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAK/+EAFmdCwArZHsBEAAADAAQAAAMAKDxImSABAAVoy4PLIAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAABVIAAAVSAAAABhzdHRzAAAAAAAAAAEAAAAFAAAIAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAFAAAAAQAAAChzdHN6AAAAAAAAAAAAAAAFAAACgwAAAAoAAAAKAAAACQAAAAkAAAAUc3RjbwAAAAAAAAABAAADZwAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjAuMTYuMTAwAAAACGZyZWUAAAKxbWRhdAAAAnAGBf//bNxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjQgcjMxMDggMzFlMTlmOSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjMgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDE6MHgxMTEgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTI1MCBrZXlpbnRfbWluPTUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAALZYiEBHyYoAA2I4AAAAAGQZo4CPqAAAAABkGaVAI+oAAAAAVBmmAQ9QAAAAVBmoA/1A==';
const WEBM = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAI/EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggIp7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECPQAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYgKgL51NcPYoZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgibCBELqBEJqBAhJUw2f8c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2MC4xNi4xMDBzc9ZjwItjxYgKgL51NcPYoWfIoUWjh0VOQ09ERVJEh5RMYXZjNjAuMzEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnVAhOeBAKOjgQAAgBACAJ0BKhAAEAAARwiFhYiFhIgCAgAMDWAA/v+rUICjlYEAyACxAQABEBAAGAAYWC/0AAgAAKOVgQGQALEBAAEQEAAYABhYL/QACAAAo5WBAlgAsQEAARAQABgAGFgv9AAIAACjlYEDIACxAQABEBAAGAAYWC/0AAgAABxTu2uRu4+zgQC3iveBAfGCAZ/wgQM=';
const BASE = 'Stops the phone dimming and locking while this page is open, handy as a bedside or travel clock. It lasts only while the page is visible, and it uses battery, so plug in if you can.';

let sentinel = null;
let video = null;
let wanted = false;
let busy = false;

const box = () => document.getElementById('keepAwake');
const note = () => document.getElementById('wakeStatus');
const banner = () => document.getElementById('wakeBanner');
const active = () => !!sentinel || !!(video && !video.paused);

function ui(text) {
  if (note()) note().textContent = text ? `${BASE} ${text}` : BASE;
  const b = banner();
  if (b) b.hidden = !(wanted && !active() && !document.hidden);     // ask for a tap while it is wanted but not running
}

function startVideo() {
  if (!video) {
    video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.muted = true; video.loop = true; video.preload = 'auto';
    video.setAttribute('aria-hidden', 'true');
    video.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
    for (const [src, type] of [[WEBM, 'video/webm'], [MP4, 'video/mp4']]) {
      const s = document.createElement('source'); s.src = src; s.type = type; video.appendChild(s);
    }
    video.addEventListener('pause', () => ui(''));
    document.body.appendChild(video);
  }
  return video.play().then(() => true, () => false);
}

/** @param {boolean} gesture true when called from a click / touch / key handler */
async function acquire(gesture) {
  if (!wanted || document.hidden || active() || busy) return;
  busy = true;
  let how = '', err = '';
  if (supported) {
    try {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => { sentinel = null; ui(''); });
      how = 'Active: the screen will stay on.';
    } catch (e) { sentinel = null; err = e.name; }
  }
  if (!how && gesture && (await startVideo())) how = 'Active (compatibility mode): the screen will stay on.';
  busy = false;
  if (how) ui(how);
  else ui(gesture ? `Could not start (${err || 'blocked'}). Check that battery saver / low power mode is off.` : 'Tap anywhere on the page to switch it on (the browser requires a touch).');
}

async function release() {
  try { await sentinel?.release(); } catch (_) { /* already released */ }
  sentinel = null;
  if (video) video.pause();
  ui('');
}

function set(on) {
  wanted = on;
  conf.keepAwake = on;
  if (on) acquire(true);                  // we are inside the checkbox's click, so this counts as a gesture
  else release();
}

function init() {
  const el = box();
  if (!el) return;
  el.checked = !!conf.keepAwake;
  wanted = el.checked;
  el.addEventListener('change', () => set(el.checked));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) acquire(false); else ui(''); });
  // Events that grant user activation on touch devices. Keep listening: a request can be refused
  // (or the lock can be released by the system) at any time and be retried on the next tap.
  const retry = () => { if (wanted && !active()) acquire(true); };
  for (const type of ['click', 'touchend', 'pointerup', 'keydown']) window.addEventListener(type, retry, { passive: true });
  banner()?.addEventListener('click', retry);
  if (!supported) ui('');
  if (wanted) acquire(false);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
