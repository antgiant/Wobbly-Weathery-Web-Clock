// The man pages and --help, generated from the settings schema so they are always complete: wobbly-clock(1) and wobbly-clock.conf(5).
import { SETTINGS } from '../../schema/settings.js';
import { PRESET_LIST } from '../../schema/presets.js';
import { EXTRA, showValue } from './config.mjs';
import { PROFILES, unmet } from './hardware.mjs';

const esc = (s) => String(s).replace(/\\/g, '\\e').replace(/^([.'])/, '\\&$1').replace(/-/g, '\\-');
const NEEDS = { gles3: 'an OpenGL ES 3 GPU (Pi 4, 5)', 'cores>=2': 'two or more cores', sensors: 'motion sensors: web page only' };
const needText = (t) => NEEDS[t] || t;
const range = (s) => s.type === 'enum' ? s.options.join(' | ') : s.type === 'number' ? `${s.min} to ${s.max}` : s.type === 'bool' ? 'on | off' : s.type === 'tri' ? 'auto | on | off' : s.type === 'text' ? `text, up to ${s.max} characters` : 'yyyy-mm-ddThh:mm';

const header = (name, sec, title) => `.TH ${name.toUpperCase()} ${sec} "2026-11-04" "Wobbly Weathery Web Clock" "${title}"\n`;

function settingsSection() {
  const out = [];
  for (const tab of ['clock', 'scene', 'weather', 'extras', 'place']) {
    out.push(`.SS ${tab[0].toUpperCase() + tab.slice(1)}`);
    for (const s of SETTINGS.filter((x) => x.tab === tab)) {
      const needs = [...(s.requires || []), ...Object.values(s.requiresValue || {}).flat()];
      const uniq = [...new Set(needs)];
      out.push(`.TP\n.B ${esc(s.key)}\n${esc(s.label)}${s.advanced ? ' (advanced)' : ''}. Values: ${esc(range(s))}. Default: ${esc(showValue(s.default))}.${s.doc ? ' ' + esc(s.doc) + '.' : ''}${uniq.length ? ` Needs ${esc(uniq.map(needText).join(' and '))}.` : ''}`);
    }
  }
  out.push('.SS Native only');
  for (const [k, e] of Object.entries(EXTRA)) out.push(`.TP\n.B ${esc(k)}\n${esc(e.label)}. Values: ${esc(range(e))}. Default: ${esc(showValue(e.default))}.`);
  return out.join('\n');
}

export function manCommand() {
  return header('wobbly-clock', 1, 'User Commands') + `.SH NAME
wobbly\\-clock \\- a clock in front of a real\\-time sky, for a Raspberry Pi
.SH SYNOPSIS
.B wobbly\\-clock
.I command
[arguments]
.SH DESCRIPTION
Shows the time over a sky computed for your place, on a screen (HDMI) or an LED panel. It has the same settings, names and defaults as the
web page: what you can set here you can set there, and a share link from the web page works as a configuration.
.SH COMMANDS
.TP
.B setup
Ask where the clock shows (HDMI or LED panel), describe the panels in plain questions, check the answers, run the test, and write the configuration.
.TP
.B test
Light the output with test patterns and stop: colour bars and a grey ramp, the panels numbered, a brightness sweep, a border box. Ctrl\\-C ends it.
.TP
.B run
Show the clock (what the service runs).
.TP
.BI get " [setting]"
Print every setting that differs from the default, or one setting.
.TP
.BI set " setting value"
Change one setting. Refused, with the reason, when this machine cannot do it.
.TP
.B presets
List the presets.
.TP
.BI preset " name"
Apply a preset.
.TP
.BI apply " link"
Use a share link (short or readable) from the web page as the configuration, including its place and sign mode.
.TP
.BI import\\-matrix\\-cfg " file"
Read the panel layout from an rpi\\-fb\\-matrix matrix.cfg.
.TP
.B export\\-matrix\\-cfg
Write the panel layout as a matrix.cfg.
.TP
.B install\\-service
Write and enable a systemd service so the clock starts on boot.
.TP
.BR status ", " logs ", " restart
Look after the service.
.TP
.B update
Check for a new release now. Releases are checked against a checksum and a signature and rolled back if they do not start.
.TP
.BR \\-\\-help ", " \\-\\-version
Short help; the version.
.SH FILES
.TP
.I /etc/wobbly\\-clock/wobbly\\-clock.conf
The settings; see wobbly\\-clock.conf(5).
.TP
.I /etc/wobbly\\-clock/matrix.cfg
The panel layout, in rpi\\-fb\\-matrix's format.
.TP
.I /boot/firmware/wobbly\\-clock.conf
If present at boot, applied once and renamed. For setting a Pi up with no keyboard or screen.
.SH EXIT STATUS
0 success; 1 a setting or value was refused; 2 bad usage; 3 the hardware cannot do what was asked.
.SH EXAMPLES
.nf
wobbly\\-clock set hideSeconds on
wobbly\\-clock preset bedside
wobbly\\-clock apply 'https://clock.wooleys.us/?c=...'
.fi
.SH SEE ALSO
wobbly\\-clock.conf(5), the LED panel guide in docs/LED\\-PANELS.md, https://github.com/hzeller/rpi\\-rgb\\-led\\-matrix
`;
}

export function manConfig() {
  const presets = PRESET_LIST.map((p) => `.TP\n.B ${esc(p.id)}\n${esc(p.name)}. ${esc(p.note)}`).join('\n');
  const machines = Object.values(PROFILES).map((p) => `${p.name}: ${unmet(['gles3'], p).length ? 'no ' : ''}OpenGL ES 3`).join('; ');
  return header('wobbly-clock.conf', 5, 'File Formats') + `.SH NAME
wobbly\\-clock.conf \\- settings for wobbly\\-clock
.SH DESCRIPTION
One setting per line, \\fIkey = value\\fR. Lines starting with # are comments. Only settings that differ from the default need to be written.
The keys and values are the web page's. A machine that cannot do a setting refuses it with the reason, and the clock uses the nearest setting it can.
.SH SETTINGS
${settingsSection()}
.SH PRESETS
Applied with \\fBwobbly\\-clock preset\\fR. A preset sets the look and the power settings; it never changes the place, units or labels.
${presets}
.SH HARDWARE
${esc(machines)}.
.SH SEE ALSO
wobbly\\-clock(1)
`;
}

/** --help: short form of the same content */
export function help() {
  const lines = ['Usage: wobbly-clock <command> [arguments]', '', 'Commands:',
    '  setup  test  run  get [key]  set <key> <value>  presets  preset <name>  apply <link>',
    '  import-matrix-cfg <file>  export-matrix-cfg  install-service  status  logs  restart  update', '',
    'Presets: ' + PRESET_LIST.map((p) => p.id).join(', '), `Settings: ${SETTINGS.length} (same names as the web page); see man wobbly-clock.conf`];
  return lines.join('\n');
}
