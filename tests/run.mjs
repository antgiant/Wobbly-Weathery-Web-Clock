// Runs the tests. Usage: node tests/run.mjs [unit|browser|all] [name-filter]
//   unit     every tests/unit/*.test.mjs, each in its own node process (fast, no browser)
//   browser  every tests/browser/*.test.mjs in one headless Chromium against the real page
// Environment: TEST_ARTIFACTS=dir saves screenshots there; VISUAL=warn makes picture comparisons report instead of fail;
// UPDATE_BASELINES=1 rewrites the picture baselines.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const here = path.dirname(new URL(import.meta.url).pathname);
const [kind = 'all', filter = ''] = process.argv.slice(2);
const want = (f) => !filter || f.includes(filter);
let failed = 0, passed = 0;
const started = Date.now();

if (kind === 'unit' || kind === 'all') {
  console.log('\n== unit tests ==');
  for (const f of fs.readdirSync(path.join(here, 'unit')).filter((x) => x.endsWith('.test.mjs') && want(x)).sort()) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(here, 'unit', f)], { encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    const bad = out.split('\n').filter((l) => l.startsWith('FAIL'));
    const n = out.split('\n').filter((l) => l.startsWith('PASS')).length;
    if (r.status === 0) { passed++; console.log(`  ok    ${f.replace('.test.mjs', '').padEnd(14)} ${String(n).padStart(3)} checks  ${Date.now() - t0} ms`); }
    else { failed++; console.log(`  FAIL  ${f}\n${bad.map((l) => '        ' + l).join('\n') || out.split('\n').slice(-12).map((l) => '        ' + l).join('\n')}`); }
  }
}

if (kind === 'browser' || kind === 'all') {
  console.log('\n== browser tests (headless Chromium, software WebGL) ==');
  const { startHarness } = await import('./lib/harness.mjs');
  let h;
  try { h = await startHarness(); } catch (e) { console.log('  FAIL  could not start the browser: ' + e.message); process.exit(1); }
  for (const f of fs.readdirSync(path.join(here, 'browser')).filter((x) => x.endsWith('.test.mjs') && want(x)).sort()) {
    const mod = await import(path.join(here, 'browser', f));
    const t0 = Date.now(), results = [];
    const t = {
      ...h,
      check: (n, ok, extra = '') => results.push({ n, ok: !!ok, extra }),
      warn: (n, extra = '') => results.push({ n, ok: true, extra, warn: true }),
    };
    let crashed = null;
    try { await Promise.race([mod.run(t), new Promise((_, rej) => setTimeout(() => rej(new Error('test timed out after 240 s')), 240000))]); }
    catch (e) { crashed = e; }
    const bad = results.filter((r) => !r.ok);
    if (!bad.length && !crashed) { passed++; console.log(`  ok    ${mod.name.padEnd(14)} ${String(results.length).padStart(3)} checks  ${((Date.now() - t0) / 1000).toFixed(1)} s${results.some((r) => r.warn) ? '  (with warnings)' : ''}`); }
    else {
      failed++;
      console.log(`  FAIL  ${mod.name}  (${results.length - bad.length} of ${results.length} checks passed)`);
      for (const r of bad) console.log(`        - ${r.n}${r.extra ? '  [' + r.extra + ']' : ''}`);
      if (crashed) console.log(`        - the test stopped: ${crashed.message.split('\n')[0]}`);
    }
    for (const r of results.filter((x) => x.warn)) console.log(`        ! ${r.n}${r.extra ? '  [' + r.extra + ']' : ''}`);
    if (process.env.VERBOSE) for (const r of results.filter((x) => x.ok && !x.warn)) console.log(`        . ${r.n}`);
  }
  await h.close();
}

console.log(`\n${failed ? 'FAILED' : 'PASSED'}: ${passed} suites ok, ${failed} failed, ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
