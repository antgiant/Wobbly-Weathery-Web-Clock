// Hardware gating for the native version: what each machine can do, from the `requires` fields in the schema (native/cli/hardware.mjs).
import { check, done } from '../lib/check.mjs';
const { SETTINGS } = await import('../../schema/settings.js');
const H = await import('../../native/cli/hardware.mjs');
const { PROFILES } = H;
const sensorless = (p) => ({ ...p, output: 'hdmi', sensors: false });

const TOKEN = /^(gles3|sensors|hdmi|cores>=\d+|ram>=\d+)$/;
const tokens = SETTINGS.flatMap((s) => [...(s.requires || []), ...Object.values(s.requiresValue || {}).flat()]);
check('every `requires` token in the schema is one the gating understands', tokens.every((t) => TOKEN.test(t)), tokens.filter((t) => !TOKEN.test(t)).join());
check('every value a setting lists in requiresValue is a real option, and every fallback is valid', SETTINGS.filter((s) => s.requiresValue).every((s) => Object.keys(s.requiresValue).every((v) => s.options.map(String).includes(v)) && ('fallback' in s) && (s.type !== 'enum' || s.options.map(String).includes(String(s.fallback)))));
check('a setting that needs something has a fallback (or its default) that the same machine can have', Object.values(PROFILES).every((p) => SETTINGS.every((s) => { const g = H.gate(s.key, s.default, p); return g.ok || H.gate(s.key, g.fallback, p).ok || s.requires?.length; })));

const zero = sensorless(PROFILES['pi-zero']), pi3 = sensorless(PROFILES['pi-3']), pi4 = sensorless(PROFILES['pi-4']);
check('Liquid glass is refused on a Pi Zero and a Pi 3 (OpenGL ES 2) but allowed on a Pi 4', !H.gate('clockStyle', 'glass', zero).ok && !H.gate('clockStyle', 'glass', pi3).ok && H.gate('clockStyle', 'glass', pi4).ok);
check('the reason names the setting, the value, the missing thing and the machine', /Style: "glass" needs an OpenGL ES 3 GPU: not available on Raspberry Pi Zero/.test(H.gate('clockStyle', 'glass', zero).reason), H.gate('clockStyle', 'glass', zero).reason);
check('solid is always allowed, and is the fallback', H.gate('clockStyle', 'solid', zero).ok && H.gate('clockStyle', 'glass', zero).fallback === 'solid');
check('wind sway needs two cores: refused on the single-core Zero, fine on a Pi 3', !H.gate('windSway', 'lean', zero).ok && H.gate('windSway', 'lean', pi3).ok);
check('rain beads (digitWeather) need ES 3', !H.gate('digitWeather', 'on', pi3).ok && H.gate('digitWeather', 'on', pi4).ok);
check('the phone-only settings (gyro, compass) are never available on a Pi', ['sensorRotation', 'compassRef', 'vrDebug'].every((k) => !H.gate(k, SETTINGS.find((s) => s.key === k).default, pi4).ok) && !H.gate('viewMode', 'look', pi4).ok && H.gate('viewMode', 'drag', pi4).ok);
check('an unknown need is never assumed met, and an unknown setting is refused', H.unmet(['teleporter'], pi4).length === 1 && !H.gate('nonsense', 1, pi4).ok);

// fitting a whole configuration
const wanted = { clockStyle: 'glass', windSway: 'full', digitWeather: 'on', hideSeconds: true, quality: 'high' };
const f = H.fit(wanted, zero);
check('fit lowers what the machine cannot do and leaves the rest alone', f.config.clockStyle === 'solid' && f.config.windSway === 'off' && f.config.digitWeather === 'off' && f.config.quality === 'low' && f.config.hideSeconds === true);
check('fit says why for each change', f.changes.map((c) => c.key).sort().join() === 'clockStyle,quality,windSway' && f.changes.every((c) => c.reason), f.changes.map((c) => c.key).join());
check('fit changes nothing on a Pi 4 except what no Pi can do', H.fit({ ...wanted, viewMode: 'drag' }, pi4).changes.length === 0);
check('an untouched default of an unavailable option is switched off without a fuss (only real choices are reported); the rain default is off on a Zero', H.fit({ glassFrost: 0.35, sensorRotation: 'auto' }, zero).changes.length === 0 && H.fit({ digitWeather: 'on' }, zero).config.digitWeather === 'off');

// listing, and recognising a board from its name
check('what a Zero cannot have is a longer list than a Pi 4', H.unavailable(zero).length > H.unavailable(pi3).length && H.unavailable(pi3).length > H.unavailable(pi4).length);
const m = (s) => H.profileFromModel(s).name;
check('boards are recognised from /proc/device-tree/model', /Zero 2/.test(m('Raspberry Pi Zero 2 W Rev 1.0')) && /Zero \//.test(m('Raspberry Pi Zero W Rev 1.1')) && /Pi 4/.test(m('Raspberry Pi 4 Model B Rev 1.4')) && /Pi 5/.test(m('Raspberry Pi 5 Model B Rev 1.0')) && /Pi 3/.test(m('Raspberry Pi 3 Model B Plus Rev 1.3')));
check('a board that is not recognised gets cautious numbers, not a guess of a big machine', H.profileFromModel('Mystery board').gles === 2 && H.profileFromModel('Mystery board').cores === 1);
check('probe works on any machine and reports cores, memory and output', (() => { const p = H.probe('matrix'); return p.cores >= 1 && p.ramMB > 0 && p.output === 'matrix'; })());
done();
