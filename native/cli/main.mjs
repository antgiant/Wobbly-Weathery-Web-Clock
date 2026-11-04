#!/usr/bin/env node
// wobbly-clock: the command line. `run(argv, io)` does the work with everything outside it passed in (files, questions, machine), so it is
// tested with scripted answers and fake hardware (tests/unit/native-cli.test.mjs). The renderer itself is not here yet (see TODO.md).
import fs from 'fs';
import path from 'path';
import { DEFAULT_CONFIG, parseFile, serialize, setValue, applyPreset, applyLink, diff, showValue, spec } from './config.mjs';
import { probe, fit, unavailable } from './hardware.mjs';
import { PANEL_SIZES, WIRINGS, fromAnswers, validate, totals, draw, parseMatrixCfg, writeMatrixCfg } from './panel.mjs';
import { sequence } from './patterns.mjs';
import { unit } from './service.mjs';
import { manCommand, manConfig, help } from './manpage.mjs';
import { PRESET_LIST } from '../../schema/presets.js';

export const VERSION = '0.1.0';
const CONF = process.env.WOBBLY_CONFIG || '/etc/wobbly-clock/wobbly-clock.conf';
const MATRIX = (conf) => conf.matrixConfig || path.join(path.dirname(CONF), 'matrix.cfg');

export function realIO() {
  return {
    read: (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } },
    write: (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); },
    profile: (output) => probe(output),
    ask: null,
  };
}

async function choose(io, say, question, options, def = 0) {
  say(`${question}`); options.forEach((o, i) => say(`  ${i + 1}) ${o}`));
  for (let tries = 0; tries < 3; tries++) {
    const a = String((await io.ask(`[${def + 1}] `)) || '').trim();
    if (a === '') return def;
    const n = Number(a) - 1; if (Number.isInteger(n) && n >= 0 && n < options.length) return n;
    say(`  Please answer 1 to ${options.length}.`);
  }
  throw new Error('no usable answer');
}
async function number(io, say, question, def, lo, hi) {
  for (let tries = 0; tries < 3; tries++) {
    const a = String((await io.ask(`${question} [${def}] `)) || '').trim(); const n = a === '' ? def : Number(a);
    if (Number.isInteger(n) && n >= lo && n <= hi) return n;
    say(`  A whole number from ${lo} to ${hi}, please.`);
  }
  throw new Error('no usable answer');
}

/** The first-run questions. Returns { config, matrix } (matrix null for HDMI). */
export async function setup(io, say, config, profileFor) {
  const out = (await choose(io, say, 'Where should the clock show?', ['An HDMI screen (full resolution)', 'An LED panel (hub75, through rpi-rgb-led-matrix)'])) === 1 ? 'matrix' : 'hdmi';
  const profile = profileFor(out);
  let matrix = null;
  if (out === 'matrix') {
    const size = await choose(io, say, 'What size is each panel?', [...PANEL_SIZES.map(([w, h]) => `${w} x ${h}`), 'other'], 2);
    let [pw, ph] = PANEL_SIZES[size] || [0, 0];
    if (!pw) { pw = await number(io, say, 'Panel width in pixels', 32, 8, 128); ph = await number(io, say, 'Panel height in pixels', 32, 8, 64); }
    const across = await number(io, say, 'How many panels across?', 2, 1, 16), down = await number(io, say, 'How many panels down?', 1, 1, 16);
    let wiring = 'row', entry = 'top-left';
    if (across * down > 1) {
      entry = ['top-left', 'top-right', 'bottom-left', 'bottom-right'][await choose(io, say, 'Which corner does the cable from the Pi go into?', ['top left', 'top right', 'bottom left', 'bottom right'])];
      const keys = Object.keys(WIRINGS).filter((k) => (across > 1 && down > 1) || /^(row|column)$/.test(k) || false);
      const usable = across > 1 && down > 1 ? keys.filter((k) => !/^(row|column)$/.test(k)) : (down === 1 ? ['row'] : ['column']);
      wiring = usable[usable.length === 1 ? 0 : await choose(io, say, 'How are the panels wired from there?', usable.map((k) => WIRINGS[k]))];
    }
    const parallel = across * down > 1 && profile.arch !== 'armv6l' ? await number(io, say, 'How many parallel chains (1 unless you wired more)?', 1, 1, 3) : 1;
    matrix = fromAnswers({ panelWidth: pw, panelHeight: ph, across, down, entry, wiring, parallel });
    say('', draw(matrix), '', totals(matrix));
    const problems = validate(matrix, profile);
    if (problems.length) { say('', 'Problems:', ...problems.map((p) => `  - ${p}`)); throw new Error('the panel answers do not add up'); }
    if ((await choose(io, say, 'Does this match what you built?', ['Yes', 'No, start again'])) === 1) throw new Error('start again with: wobbly-clock setup');
  }
  const fitted = fit({ ...config, output: out }, profile);
  for (const c of fitted.changes) say(`Note: ${c.reason}; using "${showValue(c.to)}".`);
  return { config: fitted.config, matrix };
}

export async function run(argv, io = realIO()) {
  const o = [], e = [];
  const say = (...a) => o.push(...a);
  const fail = (code, msg) => { e.push(msg); return { code, out: o.join('\n'), err: e.join('\n') }; };
  const done = () => ({ code: 0, out: o.join('\n'), err: e.join('\n') });
  const [cmd, ...args] = argv;
  try {
    const raw = io.read(CONF);
    const parsed = raw ? parseFile(raw) : { config: { ...DEFAULT_CONFIG }, errors: [] };
    for (const m of parsed.errors) e.push(`${CONF}: ${m}`);
    let config = parsed.config;
    const profile = io.profile(config.output);
    const save = (c) => io.write(CONF, serialize(c));
    switch (cmd) {
      case undefined: case '--help': case 'help': case '-h': say(help()); return done();
      case '--version': say(`wobbly-clock ${VERSION}`); return done();
      case 'man': say(args[0] === 'conf' ? manConfig() : manCommand()); return done();
      case 'get':
        if (args[0]) { if (!spec(args[0])) return fail(1, `no such setting "${args[0]}"`); say(showValue(config[args[0]])); } else for (const [k, v] of diff(config)) say(`${k} = ${showValue(v)}`);
        return done();
      case 'set': {
        if (args.length < 2) return fail(2, 'usage: wobbly-clock set <setting> <value>');
        try { config = setValue(config, args[0], args.slice(1).join(' '), profile); } catch (err) { return fail(/needs/.test(err.message) ? 3 : 1, err.message); }
        save(config); say(`${args[0]} = ${showValue(config[args[0]])}`); return done();
      }
      case 'presets': for (const p of PRESET_LIST) say(`${p.id.padEnd(15)} ${p.note}`); return done();
      case 'preset': {
        try { config = applyPreset(config, args[0]); } catch (err) { return fail(1, err.message); }
        const f = fit(config, profile); f.changes.forEach((c) => say(`Note: ${c.reason}; using "${showValue(c.to)}".`));
        save(f.config); say(`preset ${args[0]} applied`); return done();
      }
      case 'apply': {
        if (!args[0]) return fail(2, 'usage: wobbly-clock apply <link>');
        try { config = applyLink(config, args[0]); } catch (err) { return fail(1, err.message); }
        const f = fit(config, profile); f.changes.forEach((c) => say(`Note: ${c.reason}; using "${showValue(c.to)}".`));
        save(f.config); say('link applied'); return done();
      }
      case 'setup': {
        if (!io.ask) return fail(2, 'setup asks questions: run it in a terminal');
        const r = await setup(io, say, config, (out) => io.profile(out));
        save(r.config); if (r.matrix) io.write(MATRIX(r.config), writeMatrixCfg(r.matrix));
        say('', 'Saved. Check it with: wobbly-clock test'); return done();
      }
      case 'import-matrix-cfg': {
        const text = io.read(args[0]); if (!text) return fail(1, `cannot read ${args[0]}`);
        const cfg = parseMatrixCfg(text), problems = validate(cfg, profile);
        if (problems.length) return fail(1, problems.join('\n'));
        io.write(MATRIX(config), writeMatrixCfg(cfg)); config = { ...config, output: 'matrix' }; save(config); say(totals(cfg)); return done();
      }
      case 'export-matrix-cfg': {
        const t = io.read(MATRIX(config)); if (!t) return fail(1, 'no panel layout yet: run wobbly-clock setup'); say(t.trimEnd()); return done();
      }
      case 'test': {
        const t = io.read(MATRIX(config)); const cfg = t ? parseMatrixCfg(t) : { displayWidth: 1920, displayHeight: 1080, panelWidth: 1920, panelHeight: 1080, panels: [[{ order: 0, rotate: 0 }]] };
        for (const s of sequence(cfg)) say(`${s.name} (${s.seconds} s): ${s.expect}`);
        return done();
      }
      case 'install-service': {
        const text = unit({ output: config.output });
        if (args.includes('--print')) say(text); else { io.write('/etc/systemd/system/wobbly-clock.service', text); say('wrote /etc/systemd/system/wobbly-clock.service; enable it with: systemctl enable --now wobbly-clock'); }
        return done();
      }
      case 'capabilities': for (const u of unavailable(profile)) say(`${u.key}${u.value !== undefined ? '=' + u.value : ''}: ${u.reason}`); return done();
      default: return fail(2, `unknown command "${cmd}". Try: wobbly-clock --help`);
    }
  } catch (err) { return fail(1, err.message); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const io = realIO();
  if (process.stdin.isTTY) { const rl = (await import('readline')).createInterface({ input: process.stdin, output: process.stdout }); io.ask = (q) => new Promise((r) => rl.question(q, r)); process.on('exit', () => rl.close()); }
  const r = await run(process.argv.slice(2), io);
  if (r.out) console.log(r.out); if (r.err) console.error(r.err);
  process.exit(r.code);
}
