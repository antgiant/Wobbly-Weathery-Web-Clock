// Checks the device-orientation -> camera math used by VR look-around mode.
// Run: node tools/test-orientation.mjs
import { basisFromOrientation, CompassCalibrator } from '../js/sky/orientation.js';
const az = f => ((Math.atan2(f[0], f[2]) * 180 / Math.PI) + 360) % 360;
const alt = f => Math.asin(f[1]) * 180 / Math.PI;
const near = (a, b, t = 0.01) => Math.abs(a - b) < t;
let fails = 0;
const check = (name, ok, extra='') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + ' ' + extra); if (!ok) fails++; };

// upright portrait phone, camera facing north: beta=90
let b = basisFromOrientation(0, 90, 0, 0);
check('upright faces north', near(az(b.forward), 0) || near(az(b.forward), 360), `az=${az(b.forward).toFixed(2)} alt=${alt(b.forward).toFixed(2)}`);
check('upright level horizon', near(alt(b.forward), 0));
check('up vector is zenith', near(b.up[1], 1));
check('right is east', near(b.right[0], 1));
// alpha is counter-clockwise: alpha=90 -> faces west
b = basisFromOrientation(90, 90, 0, 0);
check('alpha 90 faces west', near(az(b.forward), 270), `az=${az(b.forward).toFixed(1)}`);
// tilt back: beta=120 -> camera pitched up 30 deg
b = basisFromOrientation(0, 120, 0, 0);
check('beta 120 looks up 30', near(alt(b.forward), 30), `alt=${alt(b.forward).toFixed(2)}`);
// flat on a table (beta 0): camera looks straight down
b = basisFromOrientation(0, 0, 0, 0);
check('flat looks down', near(alt(b.forward), -90));
// landscape (screen angle 90): same forward, but camera right = old -up
b = basisFromOrientation(0, 90, 0, 90);
check('landscape keeps forward', near(az(b.forward), 0) && near(alt(b.forward), 0));
check('landscape: screen-up is device-right (east-ish when held CCW)', near(Math.hypot(b.up[0], b.up[2]), 1) && near(b.up[1], 0), JSON.stringify(b.up.map(v=>+v.toFixed(2))));
// orthonormal
for (const [a,be,g,s] of [[10,80,5,0],[200,100,-20,270],[300,45,30,90]]) {
  const q = basisFromOrientation(a,be,g,s);
  const dot=(x,y)=>x[0]*y[0]+x[1]*y[1]+x[2]*y[2];
  check(`orthonormal ${a},${be},${g},${s}`, near(dot(q.right,q.up),0,1e-9)&&near(dot(q.right,q.forward),0,1e-9)&&near(dot(q.up,q.forward),0,1e-9)&&near(dot(q.right,q.right),1,1e-9));
}

// ---- iOS compass calibration ----
// Simulate a device whose alpha is offset by an unknown constant C from the absolute frame, with
// webkitCompassHeading following either the camera direction or the device's top edge.
const wrap = d => ((d + 540) % 360) - 180;
for (const hyp of ['cam', 'top']) {
  for (const [label, betaBase, screenAngle, gammaBase, gammaSwing = 10] of [['portrait upright', 80, 0, 25], ['landscape upright, rolling about', 8, 90, -60, 30], ['landscape tilted, rolling about', 35, 90, -55, 30]]) {
    const C = 137, cal = new CompassCalibrator();
    // turning alone cannot tell the two readings apart in landscape, so a wrong guess is fixed by the setting
    const guessOk = screenAngle === 0 || hyp === 'top';
    if (!guessOk) cal.force = hyp;
    let worst = 0, off = null, grew = false, prev = null;
    for (let i = 0; i < 1200; i++) {
      const t = i / 60;
      const aAbs = (200 + 60 * Math.sin(t * 0.7) + 20 * t) % 360;          // wander and slowly turn
      const beta = betaBase + 12 * Math.sin(t * 1.3), gamma = gammaBase + gammaSwing * Math.sin(t * 0.9 + 1);
      const bAbs = basisFromOrientation(aAbs, beta, gamma, 0);
      // 'top' reading: follows the top edge unless that points at the sky, where the camera takes over (as iOS does)
      const axis = hyp === 'cam' || Math.abs(bAbs.up[1]) > 0.7 ? bAbs.forward : bAbs.up;
      const H = ((Math.atan2(axis[0], axis[2]) * 180 / Math.PI) + 360) % 360;
      off = cal.update((aAbs + C) % 360, beta, gamma, H, screenAngle);
      if (off != null && prev != null && Math.abs(wrap(off - prev)) > 30 && i > 400) grew = true;
      prev = off;
      if (i > 600 && off != null) worst = Math.max(worst, Math.abs(wrap(off - C)));
    }
    check(`compass ${hyp} reading, ${label}${guessOk ? '' : ' (forced in Settings)'}: converges to the true offset`, worst < 3, `worst error ${worst.toFixed(2)} deg, mode=${cal.mode(screenAngle)}`);
    check(`compass ${hyp} reading, ${label}: offset does not run away`, !grew && Math.abs(wrap(off - C)) < 3);
  }
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
