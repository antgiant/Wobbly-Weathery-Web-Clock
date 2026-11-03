// Settings -> Presets -> Share this setup: the current setup as a short link and a readable link (js/share.js), with a sentence saying
// what the link will do, for a screen nobody can touch (kiosk mode).

import { conf } from '../config.js';
import { setupFromConf, toLink, describe } from '../share.js';
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
}

async function copy(inputId, what) {
  const el = $(inputId);
  try { await navigator.clipboard.writeText(el.value); }
  catch (_) { el.select(); try { document.execCommand('copy'); } catch (__) { /* the text is selected: copy it by hand */ } }
  toast(`${what} link copied`);
}

export function initShare() {
  if (!$('shareShort')) return;
  $('shareCopyShort').addEventListener('click', () => copy('shareShort', 'Short'));
  $('shareCopyReadable').addEventListener('click', () => copy('shareReadable', 'Readable'));
  $('shareKiosk').addEventListener('change', refreshShare);
  for (const id of ['shareShort', 'shareReadable']) $(id).addEventListener('focus', (e) => e.target.select());
  const modal = $('settingsModal');
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(refreshShare, 150); };
  modal?.addEventListener('change', later); modal?.addEventListener('input', later);
  $('settings')?.addEventListener('click', later);
  refreshShare();
}
