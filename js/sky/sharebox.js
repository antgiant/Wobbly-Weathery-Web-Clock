// Settings -> Presets -> Share this setup: the current setup as a short link and a readable link (js/share.js), a QR code, a sentence saying
// what the link will do, a length check for a sign that limits the address, and a box that turns a pasted link into the other form.
// Also the banner on a page opened from a shared link on an ordinary screen: "Use this setup" or "Just look".

import { conf, shared, CONF_VERSION } from '../config.js';
import { setupFromConf, toLink, describe, convertLink } from '../share.js';
import { render as qr, toSvg } from '../qr.js';
import { toast } from './core.js';

const $ = (id) => document.getElementById(id);

export function refreshShare() {
  const short = $('shareShort');
  if (!short) return;
  const setup = setupFromConf(conf, $('shareKiosk').checked), base = location.origin + location.pathname;
  const a = toLink(setup, base, 'short'), b = toLink(setup, base, 'readable');
  short.value = a; $('shareReadable').value = b;
  $('shareShortLen').textContent = `${a.length} characters`;
  $('shareReadableLen').textContent = `${b.length} characters`;
  $('shareDescribe').textContent = describe(setup);
  $('shareNote').textContent = setup.place ? '' : 'No place is set, so a screen that opens this link estimates it from its own time zone. To send an exact place, turn on Place → Set the place myself.';
  // the QR code of the chosen form
  const which = $('shareQrForm').value === 'readable' ? b : a, box = $('shareQr');
  box.innerHTML = qr(which, 'M') ? toSvg(which, 'M', 1) : '';
  $('shareQrNote').textContent = box.innerHTML ? `Scan it with the sign's camera or a phone. ${which.length} characters.` : `That link is ${which.length} characters, too long for a QR code (the most is about 210). Use the short link.`;
  // the length limit
  const limit = Math.max(0, Number($('shareLimit').value) || 0), note = $('shareLimitNote');
  note.textContent = !limit ? '' : a.length <= limit && b.length <= limit ? `Both links fit in ${limit} characters.` : a.length <= limit ? `The readable link is ${b.length - limit} characters too long; the short link fits (${a.length}).` : `Even the short link is ${a.length - limit} characters too long. Fewer changes from a preset, no place or no time zone make it shorter.`;
}

async function copy(inputId, what) {
  const el = $(inputId);
  try { await navigator.clipboard.writeText(el.value); }
  catch (_) { el.select(); try { document.execCommand('copy'); } catch (__) { /* the text is selected: copy it by hand */ } }
  toast(`${what} link copied`);
}

function convert() {
  const out = $('shareConvertOut'), text = $('shareConvert').value;
  if (!text.trim()) { out.textContent = ''; return; }
  const r = convertLink(text, location.origin + location.pathname);
  out.textContent = r ? `${r.describe}\n${r.form === 'short' ? 'Readable' : 'Short'}: ${r.form === 'short' ? r.readable : r.short}` : 'That is not a link this clock understands.';
  out.style.whiteSpace = 'pre-wrap'; out.style.wordBreak = 'break-all';
}

// A shared link opened on a screen anyone can use: it shows that setup for this visit; the viewer decides whether to keep it.
function sharedBanner() {
  const bar = $('sharedBanner');
  if (!bar || !shared || shared.kiosk) return;
  $('sharedText').textContent = `Showing a shared setup: ${describe(shared)}.`;
  bar.hidden = false;
  $('sharedLook').addEventListener('click', () => { bar.hidden = true; });
  $('sharedUse').addEventListener('click', () => {
    let stored = {}; try { stored = JSON.parse(localStorage.getItem('conf') || '{}') || {}; } catch (_) { stored = {}; }
    const keep = { ...stored, ...shared.settings, confVersion: Math.max(stored.confVersion || 0, CONF_VERSION) };
    if (shared.place) Object.assign(keep, { manualLocation: true, locationChoice: 'manual', location_latitude: shared.place.lat, location_longitude: shared.place.lon });
    if (shared.timeZone) keep.timeZone = shared.timeZone;
    try { localStorage.setItem('conf', JSON.stringify(keep)); } catch (_) { toast('Could not save here'); return; }
    location.replace(location.pathname);                      // the plain address: now it is this device's own setup
  });
}

export function initShare() {
  sharedBanner();
  if (!$('shareShort')) return;
  $('shareCopyShort').addEventListener('click', () => copy('shareShort', 'Short'));
  $('shareCopyReadable').addEventListener('click', () => copy('shareReadable', 'Readable'));
  $('shareKiosk').addEventListener('change', refreshShare);
  $('shareQrForm').addEventListener('change', refreshShare);
  $('shareLimit').addEventListener('input', refreshShare);
  $('shareConvert').addEventListener('input', convert);
  for (const id of ['shareShort', 'shareReadable']) $(id).addEventListener('focus', (e) => e.target.select());
  const modal = $('settingsModal');
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(refreshShare, 150); };
  modal?.addEventListener('change', later); modal?.addEventListener('input', later);
  $('settings')?.addEventListener('click', later);
  refreshShare();
}
