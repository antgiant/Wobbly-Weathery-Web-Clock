// native/scripts/sign-release.sh: signs release files with the key in the NATIVE_SIGNING_KEY secret, tolerating a secret pasted without its BEGIN/END lines or with its line breaks lost,
// and never writing a signature the clocks would refuse (an unreadable key, an empty signature, a key that does not go with the committed public key).
// Run: node tests/unit/native-sign.test.mjs   (needs openssl and bash)
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { check, done } from '../lib/check.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const script = path.join(root, 'native', 'scripts', 'sign-release.sh');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sign-'));
const sh = (cmd, args) => execFileSync(cmd, args, { cwd: dir }).toString();
const genkey = (name) => { sh('openssl', ['genpkey', '-algorithm', 'ed25519', '-out', `${name}.pem`]); sh('openssl', ['pkey', '-in', `${name}.pem`, '-pubout', '-out', `${name}-pub.pem`]); return fs.readFileSync(path.join(dir, `${name}.pem`), 'utf8'); };
const priv = genkey('a'); genkey('b');
fs.writeFileSync(path.join(dir, 'prog'), 'a program, more or less');
const sign = (key, pub = 'a-pub.pem') => { try { fs.unlinkSync(path.join(dir, 'prog.sig')); } catch (_) { /* none yet */ } return spawnSync('bash', [script, 'prog'], { cwd: dir, env: { ...process.env, KEY: key, PUBKEY: path.join(dir, pub) }, encoding: 'utf8' }); };
const verifies = () => { try { fs.writeFileSync(path.join(dir, 'sig.bin'), Buffer.from(fs.readFileSync(path.join(dir, 'prog.sig'), 'utf8'), 'base64')); sh('openssl', ['pkeyutl', '-verify', '-rawin', '-pubin', '-inkey', 'a-pub.pem', '-sigfile', 'sig.bin', '-in', 'prog']); return true; } catch (_) { return false; } };

const body = priv.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
let r = sign(priv);
check('the whole PEM signs, and the signature verifies with the matching public key', r.status === 0 && verifies(), r.stderr);
r = sign(body);
check('the base64 alone (the BEGIN/END lines lost in the paste) signs too', r.status === 0 && verifies(), r.stderr);
r = sign(priv.replace(/\n/g, ' '));
check('a PEM whose line breaks became spaces signs too', r.status === 0 && verifies(), r.stderr);
r = sign('  ' + priv.replace(/\n/g, '\r\n') + '\n\n');
check('Windows line breaks and blank lines round it do no harm', r.status === 0 && verifies(), r.stderr);
r = sign('this is not a key');
check('text that is not a key fails with the way to fix it, and leaves no signature', r.status !== 0 && /not a private key openssl can read/.test(r.stdout + r.stderr) && !fs.existsSync(path.join(dir, 'prog.sig')), `${r.status} ${r.stdout}${r.stderr}`);
r = sign(fs.readFileSync(path.join(dir, 'b.pem'), 'utf8'));
check('a key that does not go with the committed public key fails (the clocks would refuse its signatures)', r.status !== 0 && /does not verify/.test(r.stdout + r.stderr), `${r.status} ${r.stdout}${r.stderr}`);
r = sign('');
check('an empty secret fails', r.status !== 0 && /KEY .* is empty/.test(r.stdout + r.stderr));
check('the release workflow uses the script, and still refuses to publish unsigned when the public key is in the repository', (() => { const w = fs.readFileSync(path.join(root, '.github', 'workflows', 'native-release.yml'), 'utf8'); return /sign-release\.sh/.test(w) && /elif \[ -f native\/release-key\.pem \]/.test(w); })());
fs.rmSync(dir, { recursive: true, force: true });
done();
