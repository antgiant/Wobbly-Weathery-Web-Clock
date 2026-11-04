// Running on boot, updating itself, and rolling back (native/cli/service.mjs, update.mjs).
import crypto from 'crypto';
import { check, done } from '../lib/check.mjs';
const S = await import('../../native/cli/service.mjs');
const U = await import('../../native/cli/update.mjs');

const unit = S.unit({ output: 'hdmi' }), led = S.unit({ output: 'matrix' });
check('the service starts after the network, restarts on failure, logs to the journal (the default) and starts on boot', /After=network-online\.target/.test(unit) && /Restart=on-failure/.test(unit) && /WantedBy=multi-user\.target/.test(unit) && /ExecStart=\/usr\/bin\/wobbly-clock-run --config \/etc\/wobbly-clock\/wobbly-clock\.conf/.test(unit));
check('HDMI runs as an unprivileged user in the video group; the LED panel opens the GPIO first and is not forced to a user', /User=wobbly/.test(unit) && /SupplementaryGroups=video/.test(unit) && !/User=/.test(led) && /Nice=-5/.test(led));
check('the service can only write its own state directory', /ProtectSystem=strict/.test(unit) && /ReadWritePaths=\/var\/lib\/wobbly-clock/.test(unit) && /ProtectHome=true/.test(unit));
check('a different binary and config path are honoured', /ExecStart=\/opt\/w --config \/x\.conf/.test(S.unit({ bin: '/opt/w', config: '/x.conf' })));
check('a config on the boot partition is applied once, then not again', S.bootConfigAction(true, null, 'a').apply && !S.bootConfigAction(true, 'a', 'a').apply && !S.bootConfigAction(false).apply && S.BOOT_CONFIG_PATHS[0] === '/boot/firmware/wobbly-clock.conf');
check('with no configuration the first boot says so, with what to do', /wobbly-clock setup/.test(S.firstBoot(false).say) && S.firstBoot(true) === null);
check('status reads in plain words', /running, starts on boot/.test(S.status({ version: '1', output: 'matrix', layout: '64 x 32', machine: 'Pi 3', active: true, enabled: true })) && /stopped, does not start/.test(S.status({ version: '1', output: 'hdmi', machine: 'x', active: false, enabled: false })));

// updating
check('versions compare as numbers, not text, and tolerate the release tag', U.newer('0.10.0', '0.9.9') && U.newer('native-v1.0.0', '0.9.0') && !U.newer('1.0.0', '1.0.0') && !U.newer('1.2.0', '1.10.0'));
const at = (h, d = 5) => new Date(2026, 10, d, h, 15).getTime();
check('it checks only in the quiet hour, once a day, when enabled and when nothing delicate is happening', U.shouldCheck({ now: at(3) }).check && !U.shouldCheck({ now: at(14) }).check && !U.shouldCheck({ now: at(3), lastCheck: at(3) - 3600e3 }).check && U.shouldCheck({ now: at(3, 6), lastCheck: at(3, 5) }).check && !U.shouldCheck({ now: at(3), enabled: false }).check && /transition|countdown/.test(U.shouldCheck({ now: at(3), busy: true }).why));

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' });
const data = Buffer.from('a new build');
const sig = crypto.sign(null, data, privateKey).toString('base64');
const good = { data, check: { sha256: U.sha256(data), signature: sig, publicKey: pem } };
check('a download with the right checksum and signature is accepted', U.verify({ data, ...good.check }).ok);
check('a corrupt download (checksum), a forged one (signature), and an unsigned one are all refused', !U.verify({ data: Buffer.from('a new bu1ld'), ...good.check }).ok && /checksum/.test(U.verify({ data: Buffer.from('x'), ...good.check }).why) && /signature/.test(U.verify({ data, ...good.check, signature: crypto.sign(null, Buffer.from('other'), privateKey).toString('base64') }).why) && !U.verify({ data, sha256: U.sha256(data) }).ok);

const io = (up) => { const log = []; return { log, install: async () => { log.push('install'); return 'backup'; }, start: async () => { log.push('start'); return up(log); }, restore: async (t) => log.push('restore ' + t) }; };
const a = io(() => true), r1 = await U.applyUpdate({ data, check: good.check, io: a });
check('a good update is installed and started', r1.updated && a.log.join() === 'install,start');
const b = io((log) => log.filter((x) => x === 'start').length > 1), r2 = await U.applyUpdate({ data, check: good.check, io: b });
check('a build that will not start is rolled back and the old one is started again', !r2.updated && r2.rolledBack && b.log.join() === 'install,start,restore backup,start' && /previous one is back/.test(r2.why));
const c = io(() => true), r3 = await U.applyUpdate({ data: Buffer.from('tampered'), check: good.check, io: c });
check('a tampered download never touches the installed program', !r3.updated && c.log.length === 0);
done();
