// Keeping itself current: decide when, check the download, swap it in, and roll back if the new one will not start.
// The network and the filesystem are passed in, so every branch is tested (tests/unit/native-update.test.mjs).
import crypto from 'crypto';

export const parseVersion = (v) => String(v).replace(/^native-v|^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
export function newer(a, b) { const x = parseVersion(a), y = parseVersion(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }

/** Quiet hour only, never mid-transition or in a countdown's last minute, and not more than once a day. */
export function shouldCheck({ now, quietHour = 3, lastCheck = 0, enabled = true, busy = false }) {
  if (!enabled) return { check: false, why: 'updates are off' };
  if (busy) return { check: false, why: 'in a transition or the last minute of a countdown' };
  const d = new Date(now);
  if (d.getHours() !== quietHour) return { check: false, why: 'not the quiet hour' };
  if (now - lastCheck < 20 * 3600e3) return { check: false, why: 'checked in the last day' };
  return { check: true };
}

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
export function verify({ data, sha256: want, signature, publicKey }) {
  if (sha256(data) !== String(want).toLowerCase()) return { ok: false, why: 'checksum does not match (corrupt or tampered download)' };
  if (!signature || !publicKey) return { ok: false, why: 'no signature to check' };
  let ok = false;
  try { ok = crypto.verify(null, data, publicKey, Buffer.from(signature, 'base64')); } catch { ok = false; }
  return ok ? { ok: true } : { ok: false, why: 'signature does not match the release key' };
}

/** io: { install(data) -> backup token, start() -> boolean (did the new one come up?), restore(token) } */
export async function applyUpdate({ data, check, io }) {
  const v = verify({ data, ...check });
  if (!v.ok) return { updated: false, why: v.why };
  const token = await io.install(data);
  const up = await io.start();
  if (up) return { updated: true };
  await io.restore(token);
  await io.start();
  return { updated: false, rolledBack: true, why: 'the new version did not start; the previous one is back' };
}
