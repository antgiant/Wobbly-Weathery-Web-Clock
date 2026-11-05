// What a machine can do, and which settings that switches off. The schema (schema/settings.js) says what each option needs; this file knows
// the machines. Pure functions plus one probe, so the rules are tested against fake profiles (tests/unit/native-hardware.test.mjs).
import fs from 'fs';
import os from 'os';
import { SETTINGS } from '../../schema/settings.js';

// A profile: { name, arch, cores, ramMB, gles (0 none, 2, 3), output ('hdmi' | 'matrix'), sensors: false }
export const PROFILES = {
  'pi-zero': { name: 'Raspberry Pi Zero / Zero W', arch: 'armv6l', cores: 1, ramMB: 512, gles: 2 },
  'pi-zero-2': { name: 'Raspberry Pi Zero 2 W', arch: 'aarch64', cores: 4, ramMB: 512, gles: 2 },
  'pi-3': { name: 'Raspberry Pi 3', arch: 'aarch64', cores: 4, ramMB: 1024, gles: 2 },
  'pi-4': { name: 'Raspberry Pi 4', arch: 'aarch64', cores: 4, ramMB: 4096, gles: 3 },
  'pi-5': { name: 'Raspberry Pi 5', arch: 'aarch64', cores: 4, ramMB: 8192, gles: 3 },
};

// From the board's own name (/proc/device-tree/model, "Raspberry Pi 4 Model B Rev 1.4"): which GPU it has.
export function profileFromModel(model, extra = {}) {
  const m = /Raspberry Pi (Zero 2|Zero|5|4|3|2|Model|\d)/i.exec(model || '');
  const key = !m ? null : /zero 2/i.test(m[0]) ? 'pi-zero-2' : /zero/i.test(m[0]) ? 'pi-zero' : /\b5\b/.test(m[1]) ? 'pi-5' : /\b4\b/.test(m[1]) ? 'pi-4' : /\b3\b/.test(m[1]) ? 'pi-3' : null;
  return { ...(PROFILES[key] || { name: model || 'unknown machine', arch: os.arch(), cores: 1, ramMB: 512, gles: 2 }), ...extra };
}

export function probe(output = 'hdmi') {
  let model = '';
  try { model = fs.readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '').trim(); } catch { /* not a Pi */ }
  const base = model ? profileFromModel(model) : { name: `${os.type()} ${os.arch()}`, arch: os.arch(), cores: os.cpus().length, ramMB: Math.round(os.totalmem() / 2 ** 20), gles: 3 };
  return { ...base, cores: os.cpus().length || base.cores, ramMB: Math.round(os.totalmem() / 2 ** 20) || base.ramMB, output };
}

const WORDS = {
  gles3: 'an OpenGL ES 2 or 3 GPU', sensors: 'motion and compass sensors (a phone or tablet)', hdmi: 'an HDMI output',
};
const describe = (tok) => WORDS[tok] || (/^cores>=(\d+)$/.exec(tok) ? `${/(\d+)/.exec(tok)[1]} or more CPU cores` : /^ram>=(\d+)$/.exec(tok) ? `${/(\d+)/.exec(tok)[1]} MB of memory or more` : tok);

// Which of these needs does the profile not meet?  tokens: ["gles3", "cores>=2", ...]
export function unmet(tokens, p) {
  return (tokens || []).filter((t) => {
    if (t === 'gles3') return p.gles < 2;      // the page's shaders have an OpenGL ES 2 form (js/sky/portable.js): a Pi Zero or 3 draws the same picture on its own GPU
    if (t === 'sensors') return !p.sensors;
    if (t === 'hdmi') return p.output !== 'hdmi';
    let m = /^cores>=(\d+)$/.exec(t); if (m) return p.cores < Number(m[1]);
    m = /^ram>=(\d+)$/.exec(t); if (m) return p.ramMB < Number(m[1]);
    return true; // an unknown need is never assumed to be met
  });
}

// Can this setting have this value on this machine?  { ok: true } or { ok: false, reason, fallback }
export function gate(key, value, p) {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) return { ok: false, reason: `no such setting: ${key}`, fallback: undefined };
  const need = [...(s.requires || []), ...((s.requiresValue && s.requiresValue[String(value)]) || [])];
  const bad = unmet(need, p);
  if (!bad.length) return { ok: true };
  const what = s.requiresValue && s.requiresValue[String(value)] ? `${s.label}: "${value}"` : s.label;
  return { ok: false, reason: `${what} needs ${bad.map(describe).join(' and ')}: not available on ${p.name}`, fallback: 'fallback' in s ? s.fallback : s.default };
}

// The whole configuration made to fit the machine: { config, changes: [{ key, from, to, reason }] }
export function fit(config, p) {
  const out = { ...config }, changes = [];
  for (const s of SETTINGS) {
    if (!(s.key in out)) continue;
    const g = gate(s.key, out[s.key], p);
    // an untouched default of an option the machine lacks is simply not used: only say something about a choice that matters
    if (!g.ok && s.requiresValue === undefined && JSON.stringify(out[s.key]) === JSON.stringify(s.default)) { out[s.key] = g.fallback; continue; }
    if (!g.ok) { changes.push({ key: s.key, from: out[s.key], to: g.fallback, reason: g.reason }); out[s.key] = g.fallback; }
  }
  return { config: out, changes };
}

// Settings (and values) a machine cannot have, for --help, the setup questions and the man page.
export function unavailable(p) {
  const list = [];
  for (const s of SETTINGS) {
    if (s.requires?.length && unmet(s.requires, p).length) { list.push({ key: s.key, reason: gate(s.key, s.default, p).reason || `${s.label} needs ${s.requires.map(describe).join(' and ')}` }); continue; }
    for (const v of Object.keys(s.requiresValue || {})) { const g = gate(s.key, v, p); if (!g.ok) list.push({ key: s.key, value: v, reason: g.reason }); }
  }
  return list;
}
