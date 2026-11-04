// The golden vectors the Rust core is tested against (native/core/tests/golden.tsv) must be the web code's current answers.
// If this fails: run `node tools/native-golden.mjs`, then `cargo test` in native/core (the Rust port must still agree).
import { execFileSync } from 'child_process';
import path from 'path';
import { check, done } from '../lib/check.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
let ok = true, msg = '';
try { execFileSync(process.execPath, [path.join(root, 'tools/native-golden.mjs'), '--check'], { stdio: 'pipe' }); } catch (e) { ok = false; msg = String(e.stderr || e.message).trim(); }
let digitsOk = true, digitsMsg = '';
try { execFileSync(process.execPath, [path.join(root, 'tools/native-digits.mjs'), '--check'], { stdio: 'pipe' }); } catch (e) { digitsOk = false; digitsMsg = String(e.stderr || e.message).trim(); }
check('the native digit shapes (native/core/src/digits.rs) are the web page\'s', digitsOk, digitsMsg);
check('the golden vectors for the native core are the web code\'s current answers', ok, msg);
done();
