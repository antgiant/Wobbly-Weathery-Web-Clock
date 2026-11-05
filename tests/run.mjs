// Runs the tests. Usage: node tests/run.mjs [unit|browser|all] [name-filter]
//   unit     every tests/unit/*.test.mjs, each in its own node process (fast, no browser)
//   browser  every tests/browser/*.test.mjs in one headless Chromium against the real page
// Environment: TEST_ARTIFACTS=dir saves screenshots there; VISUAL=warn makes picture comparisons report instead of fail;
// UPDATE_BASELINES=1 rewrites the picture baselines. SHARD=2/3 runs only the second of three equal shares of the browser suites
// (CI runs the shares side by side on separate machines).
//   changed    (CHANGED_FILES=a,b overrides what git says) lint, the unit tests and only the browser suites the changed files can affect (npm test); see tests/impact.mjs
//   TIER=fast  the whole quick check (npm run test:quick): the suites marked `tier = 'fast'`, each trimmed to its core
//              (suites read `t.quick`). WORKERS=n runs n suites side by side, but software WebGL already uses every core,
//              so it does not make the run faster. TIER=full (the default of `node tests/run.mjs`) runs everything.
import fs from 'fs';
import path from 'path';
import { spawnSync, spawn } from 'child_process';

const here = path.dirname(new URL(import.meta.url).pathname);
let [kind = 'all', filter = ''] = process.argv.slice(2);
// `changed`: lint and unit tests, plus only the browser suites the changed files can affect (tests/impact.mjs), each trimmed to its core
if (kind === 'changed') {
  const { execSync } = await import('child_process');
  const { suitesFor } = await import('./impact.mjs');
  const git = (c) => { try { return execSync(c, { encoding: 'utf8', cwd: path.join(here, '..') }).split('\n').filter(Boolean); } catch { return []; } };
  let files = process.env.CHANGED_FILES ? process.env.CHANGED_FILES.split(',') : [...new Set([...git('git diff --name-only HEAD'), ...git('git ls-files --others --exclude-standard')])];
  let from = process.env.CHANGED_FILES ? 'CHANGED_FILES' : 'your uncommitted changes';
  if (!files.length) { files = git('git diff --name-only HEAD~1 HEAD'); from = 'the last commit'; }
  const pick = suitesFor(files);
  process.env.SUITES = pick.suites.join(',');
  const shared = files.filter((f) => /^(index\.html|styles\.css|js\/clock\.js|js\/config\.js|sw\.js|tests\/(lib|run|impact))/.test(f));
  if (shared.length) console.log(`\n!! ${shared.join(', ')} ${shared.length === 1 ? 'is' : 'are'} shared by many suites, and this quick check skips their long tails (CI runs them). Run \`npm run test:full\`, or read the CI result before merging.`);
  process.env.TIER = 'fast';
  console.log(`\n== changed: ${files.length} file${files.length === 1 ? '' : 's'} (${from}) -> browser suites: ${pick.suites.join(', ')}${pick.all ? '  (a core file changed: the whole quick check)' : ''} ==`);
  kind = 'all';
}
const SUITES = process.env.SUITES ? process.env.SUITES.split(',') : null;
const want = (f) => !filter || (filter.startsWith('=') ? f.replace('.test.mjs', '') === filter.slice(1) : f.includes(filter));
const wantSuite = (f) => !SUITES || SUITES.includes(f.replace('.test.mjs', ''));
const TIER = process.env.TIER === 'fast' ? 'fast' : 'full';
const WORKERS = Math.max(1, Number(process.env.WORKERS) || 1);
// rough seconds each suite takes in its tier: the longest start first, so the workers finish together
const COST = { options: 30, alerts: 20, led: 18, startup: 14, sky: 14, clock: 12, wind: 12, settings: 12, offline: 13, digitweather: 10, smoke: 6 };
// seconds each suite takes in the full run on a CI machine (docs/TESTS.md, GitHub Actions run 63; share and place re-measured after they grew)
const FULL_COST = { dropsgpu: 15, maskgpu: 20, clocklayout: 20, alerts: 115, digitweather: 105, led: 90, options: 98, perf: 95, christmas: 86, countdown: 42, share: 55, wind: 38, startup: 42, visual: 40, idle: 38, clock: 29, place: 30, sky: 24, settings: 24, offline: 23, smoke: 5 };
let failed = 0, passed = 0;
const timings = { when: new Date().toISOString(), node: process.version, kind: '', unit: [], browser: [] };       // where the time goes (written to test-results/timings.json, summarised at the end)
const started = Date.now();

if (kind === 'unit' || kind === 'all') {
  console.log('\n== unit tests ==');
  for (const f of fs.readdirSync(path.join(here, 'unit')).filter((x) => x.endsWith('.test.mjs') && want(x)).sort()) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(here, 'unit', f)], { encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    const bad = out.split('\n').filter((l) => l.startsWith('FAIL'));
    const n = out.split('\n').filter((l) => l.startsWith('PASS')).length;
    timings.unit.push({ name: f.replace('.test.mjs', ''), checks: n, ms: Date.now() - t0 });
    if (r.status === 0) { passed++; console.log(`  ok    ${f.replace('.test.mjs', '').padEnd(14)} ${String(n).padStart(3)} checks  ${Date.now() - t0} ms`); }
    else { failed++; console.log(`  FAIL  ${f}\n${bad.map((l) => '        ' + l).join('\n') || out.split('\n').slice(-12).map((l) => '        ' + l).join('\n')}`); }
  }
}

if (kind === 'browser' || kind === 'all') {
  console.log('\n== browser tests (headless Chromium, software WebGL) ==');
  const [shard, shards] = (process.env.SHARD || '1/1').split('/').map(Number);
  // The shares are dealt by measured cost, the longest suite first to whichever share has the least so far (docs/TESTS.md), so the
  // shares finish together. The dealing looks at every suite, whatever filter is given, so a suite is always in the same share.
  const everySuite = fs.readdirSync(path.join(here, 'browser')).filter((x) => x.endsWith('.test.mjs')).sort();
  const load = Array(shards).fill(0), mine = new Set();
  for (const f of [...everySuite].sort((a, b) => (FULL_COST[b.replace('.test.mjs', '')] ?? 30) - (FULL_COST[a.replace('.test.mjs', '')] ?? 30) || a.localeCompare(b))) {
    const k = load.indexOf(Math.min(...load)); load[k] += FULL_COST[f.replace('.test.mjs', '')] ?? 30;
    if (k === shard - 1) mine.add(f);
  }
  let files = everySuite.filter((x) => mine.has(x) && want(x) && wantSuite(x));
  if (shards > 1) console.log(`  (share ${shard} of ${shards}: ${files.map((f) => f.replace('.test.mjs', '')).join(', ')})`);
  if (TIER === 'fast' && !SUITES) {                                // only the suites that are part of the quick check
    const keep = [];
    for (const f of files) if ((await import(path.join(here, 'browser', f))).tier === 'fast') keep.push(f);
    files = keep;
    console.log(`  (quick check: ${files.map((f) => f.replace('.test.mjs', '')).join(', ')}; ${WORKERS} at a time)`);
  }

  if (WORKERS > 1 && files.length > 1) {
    // side by side: one child process (and one Chromium) per suite, WORKERS at a time, the longest first
    const queue = [...files].sort((a, b) => (COST[b.replace('.test.mjs', '')] || 15) - (COST[a.replace('.test.mjs', '')] || 15));
    const done = new Map();
    const runOne = (f) => new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(here, 'run.mjs'), 'browser', '=' + f.replace('.test.mjs', '')], { env: { ...process.env, WORKERS: '1', SHARD: '1/1' } });
      let out = '';
      child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
      child.on('close', (code) => { done.set(f, { code, out }); resolve(); });
    });
    await Promise.all(Array.from({ length: Math.min(WORKERS, queue.length) }, async () => { while (queue.length) await runOne(queue.shift()); }));
    for (const f of files) {
      const { code, out } = done.get(f);
      if (code === 0) passed++; else failed++;
      console.log(out.split('\n').filter((l) => /^ {2}(ok|FAIL) |^ {8}[-!.] /.test(l) || (code !== 0 && /^ {8}/.test(l))).join('\n') || `  FAIL  ${f}\n${out.split('\n').slice(-8).map((l) => '        ' + l).join('\n')}`);
    }
  } else {
  const { startHarness, stats } = await import('./lib/harness.mjs');
  let h;
  try { h = await startHarness(); } catch (e) { console.log('  FAIL  could not start the browser: ' + e.message); process.exit(1); }
  for (const f of files) {
    const mod = await import(path.join(here, 'browser', f));
    const t0 = Date.now(), results = [];
    stats.opens = 0; stats.openMs = 0; stats.waitMs = 0;
    const t = {
      ...h,
      quick: TIER === 'fast',                                      // a suite does only its core when this is true
      check: (n, ok, extra = '') => results.push({ n, ok: !!ok, extra }),
      warn: (n, extra = '') => results.push({ n, ok: true, extra, warn: true }),
    };
    let crashed = null;
    try { await Promise.race([mod.run(t), new Promise((_, rej) => setTimeout(() => rej(new Error('test timed out after 240 s')), 240000))]); }
    catch (e) { crashed = e; }
    const total = Date.now() - t0;
    timings.browser.push({ name: mod.name, covers: mod.covers || '', tier: mod.tier || 'deep', checks: results.length, failed: results.filter((r) => !r.ok).length, ms: total, opens: stats.opens, openMs: stats.openMs, waitMs: stats.waitMs, otherMs: Math.max(0, total - stats.openMs - stats.waitMs) });
    const bad = results.filter((r) => !r.ok);
    if (!bad.length && !crashed) { passed++; console.log(`  ok    ${mod.name.padEnd(14)} ${String(results.length).padStart(3)} checks  ${((Date.now() - t0) / 1000).toFixed(1)} s${results.some((r) => r.warn) ? '  (with warnings)' : ''}`); }
    else {
      failed++;
      console.log(`  FAIL  ${mod.name}  (${results.length - bad.length} of ${results.length} checks passed)`);
      for (const r of bad) console.log(`        - ${r.n}${r.extra ? '  [' + r.extra + ']' : ''}`);
      if (crashed) console.log(`        - the test stopped: ${(process.env.VERBOSE ? crashed.stack : crashed.message.split('\n')[0])}`);
    }
    for (const r of results.filter((x) => x.warn)) console.log(`        ! ${r.n}${r.extra ? '  [' + r.extra + ']' : ''}`);
    if (process.env.VERBOSE) for (const r of results.filter((x) => x.ok && !x.warn)) console.log(`        . ${r.n}`);
  }
  await h.close();
  }
}

// ---- where the time went ----
{
  const sec = (ms) => (ms / 1000).toFixed(1).padStart(6);
  timings.kind = process.env.TIER === 'fast' ? 'quick' : 'full';
  timings.totalMs = Date.now() - started;
  if (timings.browser.length) {
    console.log('\n== where the time went (browser suites, seconds) ==');
    console.log('  suite           checks  total  pages  opening  waiting   other  (opening = to ready; waiting = deliberate waits; other = checks, screenshots, mocks)');
    for (const b of [...timings.browser].sort((a, c) => c.ms - a.ms)) console.log(`  ${b.name.padEnd(14)} ${String(b.checks).padStart(6)} ${sec(b.ms)} ${String(b.opens).padStart(6)} ${sec(b.openMs)} ${sec(b.waitMs)} ${sec(b.otherMs)}`);
    const sum = (k) => timings.browser.reduce((a, b) => a + b[k], 0);
    console.log(`  ${'all'.padEnd(14)} ${String(sum('checks')).padStart(6)} ${sec(sum('ms'))} ${String(sum('opens')).padStart(6)} ${sec(sum('openMs'))} ${sec(sum('waitMs'))} ${sec(sum('otherMs'))}`);
  }
  const dir = process.env.TEST_ARTIFACTS;
  if (dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `timings${process.env.SHARD ? '-' + process.env.SHARD.replace('/', 'of') : ''}.json`), JSON.stringify(timings, null, 2)); }
  if (process.env.GITHUB_STEP_SUMMARY && timings.browser.length) {
    const rows = [...timings.browser].sort((a, c) => c.ms - a.ms).map((b) => `| ${b.name} | ${b.checks} | ${(b.ms / 1000).toFixed(1)} | ${b.opens} | ${(b.openMs / 1000).toFixed(1)} | ${(b.waitMs / 1000).toFixed(1)} | ${(b.otherMs / 1000).toFixed(1)} | ${b.covers} |`);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Browser test timings${process.env.SHARD ? ' (share ' + process.env.SHARD + ')' : ''}\n\n| suite | checks | total s | pages | opening s | waiting s | other s | covers |\n|---|---:|---:|---:|---:|---:|---:|---|\n${rows.join('\n')}\n`);
  }
}

console.log(`\n${failed ? 'FAILED' : 'PASSED'}: ${passed} suites ok, ${failed} failed, ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
