// Running on boot, headless: the systemd unit, the boot-partition config, the "setup needed" notice. Pure text and decisions; the commands that
// write and enable files (`wobbly-clock install-service`) live in main.mjs and are only a thin layer over these.

export function unit({ bin = '/usr/bin/wobbly-clock', config = '/etc/wobbly-clock/wobbly-clock.conf', user = 'wobbly', output = 'hdmi' } = {}) {
  const isMatrix = output === 'matrix';
  // The LED library needs the GPIO as root and drops privileges after opening it (the library's own `--led-no-drop-privs` is off);
  // HDMI needs the video device, so the video group.
  return `[Unit]
Description=Wobbly Weathery Web Clock
Documentation=man:wobbly-clock(1) man:wobbly-clock.conf(5)
After=network-online.target time-sync.target
Wants=network-online.target time-sync.target

[Service]
Type=simple
ExecStart=${bin} run --config ${config}
Restart=on-failure
RestartSec=5
${isMatrix ? '# the matrix library opens the GPIO as root, then drops privileges itself\n' : `User=${user}\nSupplementaryGroups=video render\n`}Nice=${isMatrix ? '-5' : '0'}
# a watchdog (WatchdogSec=60, Type=notify) is added once the renderer reports in with sd_notify
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/wobbly-clock
StateDirectory=wobbly-clock

[Install]
WantedBy=multi-user.target
`;
}

/** Where a config can be dropped on the boot partition (like wpa_supplicant.conf): the first one that exists wins. */
export const BOOT_CONFIG_PATHS = ['/boot/firmware/wobbly-clock.conf', '/boot/wobbly-clock.conf'];

/** What to do with a file found on the boot partition: use it once, then move it so it is not applied again on every boot. */
export function bootConfigAction(found, appliedHash, hash) {
  if (!found) return { apply: false };
  if (appliedHash === hash) return { apply: false, why: 'already applied' };
  return { apply: true, then: 'rename to wobbly-clock.conf.applied' };
}

/** Shown on the output when there is no configuration yet, instead of nothing. */
export const SETUP_NEEDED = ['SETUP', 'NEEDED'];
export function firstBoot(hasConfig) { return hasConfig ? null : { show: 'setup-needed', say: 'No configuration yet. Run: wobbly-clock setup  (or put wobbly-clock.conf on the boot partition).' }; }

export function status(s) {
  return [`wobbly-clock ${s.version}`, `output     ${s.output}${s.output === 'matrix' ? ` (${s.layout})` : ''}`, `machine    ${s.machine}`, `service    ${s.active ? 'running' : 'stopped'}${s.enabled ? ', starts on boot' : ', does not start on boot'}`].join('\n');
}
