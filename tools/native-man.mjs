// Writes native/man/wobbly-clock.1 and wobbly-clock.conf.5 from the settings schema (native/cli/manpage.mjs).
//   node tools/native-man.mjs           write them        node tools/native-man.mjs --check   fail if out of date
import fs from 'fs';
import path from 'path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { manCommand, manConfig } = await import('../native/cli/manpage.mjs');
export const FILES = { 'native/man/wobbly-clock.1': manCommand, 'native/man/wobbly-clock.conf.5': manConfig };
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  let stale = 0;
  for (const [f, make] of Object.entries(FILES)) {
    const p = path.join(root, f), text = make(), have = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    if (process.argv.includes('--check')) { if (have !== text) { console.error(`${f} is out of date: run node tools/native-man.mjs`); stale++; } }
    else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); console.log(`wrote ${f}`); }
  }
  if (stale) process.exit(1);
  if (process.argv.includes('--check')) console.log('man pages are current');
}
