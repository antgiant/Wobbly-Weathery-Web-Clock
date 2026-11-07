// The update script (native/scripts/wobbly-clock-update) run for real, with a release on disk (file://), real ed25519 signatures from openssl, and a stand-in
// for systemctl: a good update is installed, a corrupt or forged or unsigned one never touches the installed program, an up-to-date machine downloads nothing,
// and a new program that does not start is replaced by the old one.  Run: node tests/unit/native-update-script.test.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync, spawn } from 'child_process';
import crypto from 'crypto';
import { check, done } from '../lib/check.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SCRIPT = path.join(root, 'native/scripts/wobbly-clock-update');
const have = (c) => spawnSync('sh', ['-c', `command -v ${c}`]).status === 0;
if (!['openssl', 'curl', 'sha256sum'].every(have)) { console.log('SKIP the update script test needs curl, openssl and sha256sum'); process.exit(0); }

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wobbly-upd-'));
const sh = (body) => `#!/bin/sh\n${body}\n`;
const program = (version, { works = true } = {}) => sh(`case "$1" in --version) echo "wobbly-clock-run ${version}";; --help) ${works ? 'echo usage' : 'exit 1'};; esac`);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// a key pair, and a release directory
const dir = tmp();
execFileSync('openssl', ['genpkey', '-algorithm', 'ed25519', '-out', path.join(dir, 'key.pem')], { stdio: 'pipe' });
execFileSync('openssl', ['pkey', '-in', path.join(dir, 'key.pem'), '-pubout', '-out', path.join(dir, 'pub.pem')], { stdio: 'pipe' });
const sign = (file, key = path.join(dir, 'key.pem')) => execFileSync('sh', ['-c', `openssl pkeyutl -sign -rawin -inkey ${key} -in ${file} | openssl base64 -A`], { encoding: 'utf8' });

function release(name, version, { tamper = false, unsigned = false, forged = false, works = true } = {}) {
  const rel = path.join(dir, name); fs.mkdirSync(rel, { recursive: true });
  const body = program(version, { works }), asset = path.join(rel, 'wobbly-clock-run-aarch64');
  fs.writeFileSync(asset, body);
  fs.writeFileSync(path.join(rel, 'LATEST'), version + '\n');
  fs.writeFileSync(path.join(rel, 'SHA256SUMS'), `${sha(body)}  wobbly-clock-run-aarch64\n`);
  if (!unsigned) {
    let other = path.join(dir, 'other.pem');
    if (forged) { execFileSync('openssl', ['genpkey', '-algorithm', 'ed25519', '-out', other], { stdio: 'pipe' }); }
    fs.writeFileSync(path.join(rel, 'wobbly-clock-run-aarch64.sig'), sign(asset, forged ? other : undefined));
  }
  if (tamper) fs.writeFileSync(asset, body + '# changed after signing\n');         // the checksum no longer matches
  return `file://${rel}`;
}
function machine(installed) {
  const m = tmp(), bin = path.join(m, 'wobbly-clock-run');
  fs.writeFileSync(bin, program(installed)); fs.chmodSync(bin, 0o755);
  fs.writeFileSync(path.join(m, 'systemctl'), sh(`echo "$@" >> ${m}/calls\ncase "$1" in is-active) [ -f ${m}/broken ] && [ -f ${m}/restarted-new ] && exit 3; exit 0;; restart) touch ${m}/restarted; grep -q "${'NEWVERSION'}" ${bin} 2>/dev/null && touch ${m}/restarted-new;; esac\nexit 0`));
  fs.chmodSync(path.join(m, 'systemctl'), 0o755);
  return { m, bin, version: () => execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim() };
}
function run(mc, base, env = {}) {
  return spawnSync('sh', [SCRIPT], { encoding: 'utf8', env: { ...process.env, WOBBLY_RELEASE_BASE: base, WOBBLY_BIN: mc.bin, WOBBLY_PUBKEY: path.join(dir, 'pub.pem'), SYSTEMCTL: path.join(mc.m, 'systemctl'), WOBBLY_SETTLE: '0', WOBBLY_ARCH: 'aarch64', ...env } });
}
const calls = (mc) => (fs.existsSync(path.join(mc.m, 'calls')) ? fs.readFileSync(path.join(mc.m, 'calls'), 'utf8') : '');

// 1. a good update
let mc = machine('0.1.0'), r = run(mc, release('good', '0.2.0'));
check('a newer, correctly signed release is installed, the service restarted, and the previous program kept', r.status === 0 && mc.version() === 'wobbly-clock-run 0.2.0' && /restart wobbly-clock/.test(calls(mc)) && fs.existsSync(mc.bin + '.previous') && /signature ok/.test(r.stdout), r.stdout + r.stderr);
// 2. already up to date: nothing downloaded (the release has no program at all, so any download would fail)
mc = machine('0.2.0'); const bare = path.join(dir, 'bare'); fs.mkdirSync(bare); fs.writeFileSync(path.join(bare, 'LATEST'), '0.2.0\n');
r = run(mc, `file://${bare}`);
check('an up-to-date machine reads LATEST, downloads nothing and changes nothing', r.status === 0 && /already up to date/.test(r.stdout) && mc.version() === 'wobbly-clock-run 0.2.0' && calls(mc) === '', r.stdout + r.stderr);
// 3. versions are numbers: 0.10.0 is newer than 0.9.0
mc = machine('0.9.0'); r = run(mc, release('ten', '0.10.0'));
check('0.10.0 counts as newer than 0.9.0 (numbers, not text)', r.status === 0 && mc.version() === 'wobbly-clock-run 0.10.0', r.stdout + r.stderr);
mc = machine('0.10.0'); r = run(mc, release('nine', '0.9.0'));
check('and an older release never replaces a newer program', /already up to date/.test(r.stdout) && mc.version() === 'wobbly-clock-run 0.10.0');
// 4. refusals leave the program alone
for (const [label, opts, words] of [['a corrupt download (checksum)', { tamper: true }, /corrupt|tampered/], ['a release signed with the wrong key', { forged: true }, /signature does not match/], ['a release with no signature when a key is installed', { unsigned: true }, /no signature/]]) {
  mc = machine('0.1.0'); r = run(mc, release('bad-' + Object.keys(opts)[0], '0.2.0', opts));
  check(`${label}: refused, and the installed program is untouched`, r.status !== 0 && words.test(r.stderr + r.stdout) && mc.version() === 'wobbly-clock-run 0.1.0' && calls(mc) === '' && !fs.existsSync(mc.bin + '.previous'), r.stdout + r.stderr);
}
// 5. no key installed: the checksum alone is checked, and the log says so
mc = machine('0.1.0'); r = run(mc, release('nokey', '0.2.0', { unsigned: true }), { WOBBLY_PUBKEY: path.join(dir, 'missing.pem') });
check('with no release key installed the checksum alone is checked, and it says so', r.status === 0 && /no release key installed/.test(r.stdout) && mc.version() === 'wobbly-clock-run 0.2.0', r.stdout + r.stderr);
// 6. a program that does not run on this machine
mc = machine('0.1.0'); r = run(mc, release('dud', '0.2.0', { works: false }));
check('a new program that will not run is refused before anything is replaced', r.status !== 0 && /does not run/.test(r.stderr + r.stdout) && mc.version() === 'wobbly-clock-run 0.1.0' && calls(mc) === '');
// 7. a program that runs but whose service does not start: rolled back
mc = machine('0.1.0'); fs.writeFileSync(path.join(mc.m, 'systemctl'), sh(`echo "$@" >> ${mc.m}/calls\ncase "$1" in is-active) exit 3;; esac\nexit 0`)); fs.chmodSync(path.join(mc.m, 'systemctl'), 0o755);
r = run(mc, release('crashy', '0.2.0'));
check('if the service is not running after the update, the previous program is put back and the script fails', r.status !== 0 && mc.version() === 'wobbly-clock-run 0.1.0' && /did not start/.test(r.stderr + r.stdout) && (calls(mc).match(/restart/g) || []).length === 2, r.stdout + r.stderr + calls(mc));
// 8. dry run, a missing release, an unknown machine
mc = machine('0.1.0'); r = run(mc, release('dry', '0.2.0'), { WOBBLY_DRY_RUN: '1' });
check('a dry run checks everything and installs nothing', r.status === 0 && /dry run/.test(r.stdout) && mc.version() === 'wobbly-clock-run 0.1.0' && calls(mc) === '');
mc = machine('0.1.0'); r = run(mc, 'file:///nonexistent-release');
check('an unreachable release is an error, not a crash or a change', r.status !== 0 && /could not download/.test(r.stderr + r.stdout) && mc.version() === 'wobbly-clock-run 0.1.0');
r = run(mc, release('x86', '0.2.0'), { WOBBLY_ARCH: 'x86_64' });
check('an unknown machine type says so', r.status !== 0 && /no program for this machine/.test(r.stderr + r.stdout));
const timer = fs.readFileSync(path.join(root, 'native/scripts/wobbly-clock-update.timer'), 'utf8');
check('the timer runs in the quiet hours (3 at night, spread over an hour) and catches up if the Pi was off', /OnCalendar=\*-\*-\* 03:00:00/.test(timer) && /RandomizedDelaySec=3600/.test(timer) && /Persistent=true/.test(timer));
// 8. over http, through a redirect, the way GitHub's "latest release" address works (it answers 302 and the file is somewhere else): curl must follow it (it did not: the installed 0.2.1 read an empty LATEST)
{
  const rel = release('redirect', '0.2.0').replace('file://', '');
  const server = `const h=require('http'),f=require('fs'),p=require('path');const rel=${JSON.stringify(rel)};h.createServer((q,s)=>{const n=p.basename(q.url);if(q.url.startsWith('/latest/download/')){s.writeHead(302,{Location:'/files/'+n});s.end();}else if(q.url.startsWith('/files/')&&f.existsSync(p.join(rel,n))){s.end(f.readFileSync(p.join(rel,n)));}else{s.writeHead(404);s.end();}}).listen(0,'127.0.0.1',function(){console.log(this.address().port)})`;
  const srv = spawn('node', ['-e', server], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((res) => srv.stdout.once('data', (d) => res(String(d).trim())));
  mc = machine('0.1.0'); r = run(mc, `http://127.0.0.1:${port}/latest/download`);
  srv.kill();
  check('a release behind a redirect (GitHub\'s latest-release address) is found, checked and installed', r.status === 0 && mc.version() === 'wobbly-clock-run 0.2.0', r.stdout + r.stderr);
}
done();
