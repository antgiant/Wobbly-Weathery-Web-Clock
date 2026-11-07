// Running on boot, headless: the systemd unit, the boot-partition config, the "setup needed" notice. Pure text and decisions; the commands that
// write and enable files (`wobbly-clock install-service`) live in main.mjs and are only a thin layer over these.

export function unit({ bin = '/usr/bin/wobbly-clock-run', config = '/etc/wobbly-clock/wobbly-clock.conf', user = 'wobbly', output = 'hdmi' } = {}) {
  const isMatrix = output === 'matrix';
  // The LED library needs the GPIO as root and drops privileges after opening it (the library's own `--led-no-drop-privs` is off);
  // HDMI needs the video device, so the video group.
  return `[Unit]
Description=Wobbly Weathery Web Clock
Documentation=man:wobbly-clock(1) man:wobbly-clock.conf(5)
After=network-online.target time-sync.target
Wants=network-online.target time-sync.target

[Service]
Type=notify
NotifyAccess=main
WatchdogSec=600
ExecStart=${bin} --config ${config} --maxrss 350
Restart=on-failure
RestartSec=5
${isMatrix ? '# the matrix library opens the GPIO as root, then drops privileges itself\n' : `User=${user}\nSupplementaryGroups=video render\n`}${isMatrix ? '' : `# at boot the framebuffer and the GPU's device files appear a moment after this unit could start (and get their permissions a moment later still): without this wait the GPU is refused and Mesa quietly takes the CPU
ExecStartPre=/bin/sh -c 'for n in $$(seq 90); do [ -s /sys/class/graphics/fb0/virtual_size ] && [ -r /dev/dri/renderD128 ] && [ -w /dev/dri/card0 ] && exit 0; sleep 1; done; exit 0'
`}Nice=${isMatrix ? '-5' : '0'}
# the renderer says READY and, every 30 s while pictures keep coming, WATCHDOG=1; a hang means no word for 10 minutes and systemd restarts it.
# --maxrss: if memory ever grows past 350 MB the program exits and is restarted (a safety valve; the soak test shows it should never be needed)
TimeoutStartSec=infinity
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/wobbly-clock
StateDirectory=wobbly-clock
# the GPU driver's shader cache and the page's saved state live in the service's own folder
Environment=MESA_SHADER_CACHE_DIR=/var/lib/wobbly-clock/mesa WOBBLY_STORE=/var/lib/wobbly-clock/state.json

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
