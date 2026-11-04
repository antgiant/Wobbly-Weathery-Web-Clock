// The command line end to end with fake files, a fake machine and scripted answers (native/cli/main.mjs).
import { check, done } from '../lib/check.mjs';
const M = await import('../../native/cli/main.mjs');
const H = await import('../../native/cli/hardware.mjs');
const P = await import('../../native/cli/panel.mjs');
const S = await import('../../js/share.js');

function world(profileName = 'pi-4', answers = []) {
  const files = {}, asked = [];
  return {
    files, asked,
    io: {
      read: (f) => (f in files ? files[f] : null), write: (f, t) => { files[f] = t; },
      profile: (output) => ({ ...H.PROFILES[profileName], output, sensors: false }),
      calls: [], exec(cmd, args) { this.calls.push([cmd, ...args]); return this.execStatus?.[cmd] ?? 0; },
      capture(cmd, args) { this.calls.push([cmd, ...args]); return this.captured?.[`${cmd} ${args[0]}`] ?? { code: 0, out: '' }; },
      ask: answers ? async (q) => { asked.push(q); return answers.length ? answers.shift() : ''; } : null,
    },
  };
}
const CONF = '/etc/wobbly-clock/wobbly-clock.conf';
const go = (w, ...argv) => M.run(argv, w.io);

let w = world(); let r = await go(w, 'set', 'hideSeconds', 'on');
check('set writes the file and says what it did', r.code === 0 && w.files[CONF].includes('hideSeconds = on') && /hideSeconds = on/.test(r.out));
r = await go(w, 'get'); check('get lists what differs from the default', r.out === 'hideSeconds = on');
r = await go(w, 'get', 'hideSeconds'); check('get one setting', r.out === 'on');
r = await go(w, 'get', 'nope'); check('get an unknown setting is an error', r.code === 1);
r = await go(w, 'set', 'clockStyle', 'purple'); check('a bad value exits 1 and says what is allowed', r.code === 1 && /one of auto, glass/.test(r.err));
r = await go(w, 'set', 'hideSeconds'); check('missing arguments exit 2', r.code === 2);
r = await go(w, 'bogus'); check('an unknown command exits 2 and points to --help', r.code === 2 && /--help/.test(r.err));
check('--help and --version work, and help lists the presets', (await go(w, '--help')).out.includes('bedside') && /wobbly-clock 0\./.test((await go(w, '--version')).out));

const zero = world('pi-zero');
r = await go(zero, 'set', 'clockStyle', 'glass');
check('on a Pi Zero, glass is refused with the reason and exit 3, and nothing is written', r.code === 3 && /needs an OpenGL ES 3 GPU/.test(r.err) && !(CONF in zero.files));
r = await go(zero, 'preset', 'bedside');
check('a preset on a Zero is lowered to what it can do, and says so', r.code === 0 && /Style.*needs an OpenGL ES 3/.test(r.out) && zero.files[CONF].includes('clockStyle = solid'));
check('a Pi 4 gets the same preset as designed', (await go(world(), 'preset', 'bedside')).out === 'preset bedside applied');
r = await go(zero, 'preset', 'nope'); check('an unknown preset exits 1', r.code === 1);
r = await go(zero, 'capabilities'); check('capabilities lists what the machine cannot do', /clockStyle=glass/.test(r.out) && /windSway/.test(r.out));

// a share link
const link = S.toLink({ settings: S.normalise({ ...Object.fromEntries(S.SETTINGS_V1.map((x) => [x[0], x[2]])), hideSeconds: true }), place: { lat: 40.7, lon: -74 }, kiosk: true }, 'https://clock.wooleys.us/', 'short');
w = world(); r = await go(w, 'apply', link);
check('apply takes the share link as the configuration, including place and sign mode', r.code === 0 && /hideSeconds = on/.test(w.files[CONF]) && /kiosk = on/.test(w.files[CONF]) && /manualLocation = on/.test(w.files[CONF]) && /location_latitude = 40\.7/.test(w.files[CONF]));
check('a broken link exits 1', (await go(w, 'apply', 'https://x/?c=!!!')).code === 1);

// setup: HDMI
w = world('pi-4', ['1']); r = await go(w, 'setup');
check('setup for HDMI asks one question and saves', r.code === 0 && w.asked.length === 1 && !('/etc/wobbly-clock/matrix.cfg' in w.files) && /Saved/.test(r.out));
// setup: LED panel, 2 x 2 of 32 x 32, cable top right, snake, one chain, confirmed
w = world('pi-3', ['2', '2', '2', '2', '2', '1', '1', '1']); r = await go(w, 'setup');
const cfgText = w.files['/etc/wobbly-clock/matrix.cfg'];
check('setup for an LED panel asks in plain questions, draws the result and writes the sample\'s exact layout', r.code === 0 && cfgText && JSON.stringify(P.parseMatrixCfg(cfgText).panels.map((x) => x.map((t) => [t.order, t.rotate]))) === '[[[1,0],[0,0]],[[2,180],[3,180]]]' && /64 x 64 pixels, 4 panels of 32 x 32, one chain of 4/.test(r.out) && /Does this match/.test(r.out) && /output = matrix/.test(w.files[CONF]), r.code ? r.out + r.err : "");
w = world('pi-3', ['2', '2', '2', '2', '2', '1', '1', '2']); r = await go(w, 'setup');
check('answering "no, start again" stops before anything is saved', r.code === 1 && !(CONF in w.files) && !('/etc/wobbly-clock/matrix.cfg' in w.files));
w = world('pi-3', ['2', 'x', 'y', 'z']); r = await go(w, 'setup');
check('unusable answers end politely after three tries', r.code === 1 && /Please answer/.test(r.out));
w = world('pi-4', null); r = await go(w, 'setup');
check('setup without a terminal says so', r.code === 2 && /terminal/.test(r.err));

// matrix.cfg import / export
const SAMPLE = 'display_width=64;display_height=64;panel_width=32;panel_height=32;chain_length=4;parallel_count=1;\npanels = (\n ( { order = 1; rotate = 0; }, { order = 0; rotate = 0; } ),\n ( { order = 2; rotate = 180; }, { order = 3; rotate = 180; } )\n)\n';
w = world(); w.files['/home/matrix.cfg'] = SAMPLE; r = await go(w, 'import-matrix-cfg', '/home/matrix.cfg');
check('import-matrix-cfg takes an existing rpi-fb-matrix file, switches the output to the panel and saves', r.code === 0 && /64 x 64 pixels/.test(r.out) && /output = matrix/.test(w.files[CONF]));
r = await go(w, 'export-matrix-cfg'); check('export-matrix-cfg gives it back, in the same format', r.code === 0 && P.parseMatrixCfg(r.out).panels[1][0].rotate === 180);
w = world(); w.files['/home/bad.cfg'] = SAMPLE.replace('display_width=64', 'display_width=65'); r = await go(w, 'import-matrix-cfg', '/home/bad.cfg');
check('a layout with a mistake is refused with the fix', r.code === 1 && /not a multiple of panel_width/.test(r.err) && !(CONF in w.files));
check('a missing file is an error', (await go(world(), 'import-matrix-cfg', '/nope')).code === 1);

// the test and the service
w = world(); w.files['/etc/wobbly-clock/matrix.cfg'] = SAMPLE; r = await go(w, 'test');
check('test lists the four patterns and what each should look like', r.out.split('\n').length === 4 && /colour bars/.test(r.out) && /identify/.test(r.out));
r = await go(w, 'install-service', '--print'); check('install-service --print shows the unit; without --print it writes it', /\[Service\]/.test(r.out) && (await go(w, 'install-service')).out.includes('systemctl enable') && '/etc/systemd/system/wobbly-clock.service' in w.files);
r = await go(w, 'man'); check('man prints the manual page', /^\.TH WOBBLY-CLOCK 1 "2026-11-04"/.test(r.out));

// running and looking after the service
w = world(); r = await go(w, 'run');
check('run starts the renderer with the configuration file', r.code === 0 && w.io.calls[0].join(' ') === `wobbly-clock-run --config ${CONF}`, JSON.stringify(w.io.calls));
w.io.execStatus = { 'wobbly-clock-run': 127 }; r = await go(w, 'run');
check('run says how to get the renderer when it is missing (exit 3)', r.code === 3 && /not installed/.test(r.err));
w = world(); w.io.captured = { 'wobbly-clock-run --version': { code: 0, out: 'wobbly-clock-run 0.4.2' }, 'systemctl is-active': { code: 0, out: 'active' }, 'systemctl is-enabled': { code: 0, out: 'enabled' } };
r = await go(w, 'status');
check('status says the version, the output, the machine and whether the service runs and starts on boot', /wobbly-clock 0\.4\.2/.test(r.out) && /running, starts on boot/.test(r.out) && /output\s+hdmi/.test(r.out), r.out);
w = world(); r = await go(w, 'status'); check('status when nothing is installed says so', /not installed/.test(r.out) && /stopped/.test(r.out), r.out);
w = world(); await go(w, 'restart'); await go(w, 'update'); await go(w, 'logs'); await go(w, 'logs', '-f');
check('restart, update and logs call systemctl, the update script and journalctl', w.io.calls.some((c) => c.join(' ') === 'systemctl restart wobbly-clock') && w.io.calls.some((c) => c[0] === 'wobbly-clock-update') && w.io.calls.some((c) => c.join(' ') === 'journalctl -u wobbly-clock -n 50 --no-pager') && w.io.calls.some((c) => c.join(' ') === 'journalctl -u wobbly-clock --no-pager -f'), JSON.stringify(w.io.calls));
w = world(); w.io.execStatus = { systemctl: 1, 'wobbly-clock-update': 2 };
check('failures are reported with exit 1 and in words', (await go(w, 'restart')).code === 1 && /could not restart/.test((await go(w, 'restart')).err) && (await go(w, 'update')).code === 1);

// a file with mistakes is reported but does not stop the program
w = world(); w.files[CONF] = 'hideSeconds = maybe\nclockStyle = glass\n'; r = await go(w, 'get');
check('mistakes in the file are reported with the line, and the good lines still count', /line 1/.test(r.err) && r.out === 'clockStyle = glass');
done();
