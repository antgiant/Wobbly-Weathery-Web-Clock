// The man pages (generated from the schema): complete, well formed roff, current. CI also runs `mandoc -Tlint` on them (native workflow).
import fs from 'fs';
import path from 'path';
import { check, done } from '../lib/check.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const { SETTINGS } = await import('../../schema/settings.js');
const { PRESET_LIST } = await import('../../schema/presets.js');
const { manCommand, manConfig, help } = await import('../../native/cli/manpage.mjs');
const { FILES } = await import('../../tools/native-man.mjs');
const conf = manConfig(), cmd = manCommand();

check('every setting is in the .conf page, once, with its default and its allowed values', SETTINGS.every((s) => conf.split(`.B ${s.key}\n`).length === 2 && conf.split(`.B ${s.key}\n`)[1].split('.TP')[0].includes('Default:') && conf.split(`.B ${s.key}\n`)[1].split('.TP')[0].includes('Values:')));
check('every preset is described', PRESET_LIST.every((p) => conf.includes(`.B ${p.id.replace(/-/g, '\\-')}\n`)));
check('what needs a better GPU or more cores says so', /Needs two or more cores/.test(conf) && /OpenGL ES 2 or 3 GPU/.test(conf) && /web page only/.test(conf));
check('both pages have the sections a man page needs', ['NAME', 'DESCRIPTION', 'SEE ALSO'].every((s) => conf.includes(`.SH ${s}`) && cmd.includes(`.SH ${s}`)) && ['SYNOPSIS', 'COMMANDS', 'FILES', 'EXIT STATUS', 'EXAMPLES'].every((s) => cmd.includes(`.SH ${s}`)));
check('every command in the page is a command the program has', ['setup', 'test', 'run', 'get', 'set', 'presets', 'preset', 'apply', 'import', 'export', 'install', 'status', 'update'].every((c) => cmd.includes(c)));
const bad = (t) => t.split('\n').filter((l) => /^[^.\\]*\S/.test(l) && false || /^\.(?![A-Za-z]{1,3}\b)/.test(l) && !/^\.\\/.test(l));
check('the roff is well formed: only known macros, a title line, no stray dot-lines', [conf, cmd].every((t) => /^\.TH \S+ [15] "\d{4}-\d\d-\d\d" /.test(t) && t.split('\n').filter((l) => /^\./.test(l)).every((l) => /^\.(TH|SH|SS|TP|B|BI|BR|I|nf|fi|PP) ?/.test(l)) && bad(t).length === 0));
check('a hyphen in text is written \\- so it stays a minus when printed', !/[a-z]-[a-z]/.test(conf.split('\n').filter((l) => !/^\./.test(l) || /^\.B /.test(l)).join('\n').replace(/\\-/g, '')));
check('the page text has no raw line starting with . or \' that roff would take as a command', [conf, cmd].every((t) => t.split('\n').every((l) => !/^'/.test(l))));
check('the checked-in pages are current (run node tools/native-man.mjs)', Object.entries(FILES).every(([f, make]) => fs.readFileSync(path.join(root, f), 'utf8') === make()));
check('--help is short and names the presets', help().split('\n').length < 14 && help().includes('bedside'));
done();
