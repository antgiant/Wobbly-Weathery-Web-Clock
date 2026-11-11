// Raindrops on the digits: a small simulation, so drops behave like drops. They form on the glass, grow while it rains, and past a
// size they run down in jerky bursts, leaving a wet trail, swallowing the smaller drops they meet. A drop that runs off the bottom of a
// stroke hangs there for a moment and falls. When the digit moves or changes and the glass is no longer under a drop, the drop is shed.
// Pure maths (no DOM, no GL): glass.js gives it the digits' ink and draws the result.
//
// Units are the pixels of the digit mask (the canvas the digits are drawn into), y down. `stroke` is how thick a digit's stroke is.

export function rng(seed) {                                   // small seeded generator: the same seed gives the same rain (tests)
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const GRAVITY = 5;                                     // stroke widths per second per second
export const MAX_DROPS = 160;

export class DropSim {
  constructor(seed = 1) {
    this.rand = rng(seed);
    this.drops = [];
    this.gw = 0; this.gh = 0; this.grid = null; this.w = 1; this.h = 1; this.inkCells = 0;
    this.stroke = 30;
    this.freeze = 0;                    // 0..1, freezing rain: drops freeze where they land (they grow into larger beads and sheets and do not run)
    this.wind = 0;                      // sideways push on a drop in the air, -0.75..0.75 (engine.lean): the wind across the view
    this.maxDrops = MAX_DROPS;          // the quality governor lowers this on a slow machine
    this.wet = null;                    // water left on the glass by running drops (0..1 per cell of the ink grid); later drops are drawn along it
  }

  /** The digits' ink as a grid of alpha 0..255 (gw x gh, row by row) covering w x h mask pixels. Drops that lost their glass are shed. */
  setInk(grid, gw, gh, w, h, stroke) {
    this.grid = grid; this.gw = gw; this.gh = gh; this.w = w; this.h = h; this.stroke = Math.max(4, stroke);
    let n = 0; for (let i = 0; i < grid.length; i++) if (grid[i] > 200) n++;
    this.inkCells = n;
    if (!this.wet || this.wet.length !== gw * gh) this.wet = new Float32Array(gw * gh);
    for (const d of this.drops) if (!d.dying && this.inkAt(d.x, d.y) < 0.3) this._shed(d);       // the glass moved away from under it
  }

  /** A drop that lost its glass is thrown off: away from the nearest glass that is left (the edge it was just on), faster the more the glass has moved. */
  _shed(d) {
    d.dying = true; d.fall = 0; d.run = false; d.hang = 0;
    const S = this.stroke, reach = Math.max(2, Math.ceil(S * 1.5 / this.w * this.gw));            // look as far as one and a half stroke widths
    const cx = Math.floor(d.x / this.w * this.gw), cy = Math.floor(d.y / this.h * this.gh);
    let best = 1e9, bx = 0, by = 0;
    for (let j = Math.max(0, cy - reach); j <= Math.min(this.gh - 1, cy + reach); j++) {
      for (let i = Math.max(0, cx - reach); i <= Math.min(this.gw - 1, cx + reach); i++) {
        if (this.grid[j * this.gw + i] < 128) continue;
        const dd = (i - cx) * (i - cx) + (j - cy) * (j - cy);
        if (dd < best) { best = dd; bx = i - cx; by = j - cy; }
      }
    }
    const v0 = S * (1.0 + 1.6 * this.rand());
    if (best < 1e9 && best > 0) { const l = Math.sqrt(best); d.vx = -bx / l * v0; d.vy = -by / l * v0 * 0.6 + S * 0.2; d.thrown = true; }   // flung out and a little down
    else { d.vx = 0; d.vy = S * 0.4; d.thrown = false; }                                               // no glass nearby to leave: it just falls
  }

  _wetAt(x, y) {
    if (!this.wet) return 0;
    const i = Math.floor(x / this.w * this.gw), j = Math.floor(y / this.h * this.gh);
    return i < 0 || j < 0 || i >= this.gw || j >= this.gh ? 0 : this.wet[j * this.gw + i];
  }

  /** Ink (alpha 0..1) under a point of the mask. */
  inkAt(x, y) {
    if (!this.grid) return 0;
    const i = Math.floor(x / this.w * this.gw), j = Math.floor(y / this.h * this.gh);
    if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) return 0;
    return this.grid[j * this.gw + i] / 255;
  }

  /** A random point on the ink, or null. */
  _spot() {
    if (!this.inkCells) return null;
    for (let k = 0; k < 20; k++) {
      const x = this.rand() * this.w, y = this.rand() * this.h;
      const m = this.stroke * 0.12;
      if (this.inkAt(x, y) > 0.9 && this.inkAt(x, y - m) > 0.8 && this.inkAt(x, y + m) > 0.8 && this.inkAt(x - m, y) > 0.8 && this.inkAt(x + m, y) > 0.8) return [x, y];       // not right on an edge
    }
    return null;
  }

  /** How many drops the glass should carry for this rain: more rain, more drops, in proportion to the area of glass. */
  target(rain) {
    const cellArea = (this.w / this.gw) * (this.h / this.gh), ink = this.inkCells * cellArea;
    const r = this.stroke * 0.09;
    return Math.min(this.maxDrops, Math.round(rain * ink / (Math.PI * r * r) * 0.06));
  }

  /**
   * Advance by dt seconds (at most 0.15 is taken at once: a slow frame must not teleport the drops).
   * @param {number} dt  seconds
   * @param {number} rain  0 (dry) .. 1 (downpour)
   */
  step(dt, rain) {
    dt = Math.min(0.15, Math.max(0, dt));
    const S = this.stroke, rRun = S * 0.15, drops = this.drops, beads = [];
    if (this.wet) { const k = Math.exp(-dt / 3); for (let i = 0; i < this.wet.length; i++) this.wet[i] *= k; }       // the water dries in a few seconds
    // new drops where there are fewer than the rain calls for
    const want = this.target(rain);
    let alive = 0; for (const d of drops) if (!d.dying) alive++;
    if (rain > 0.01 && alive < want && this.inkCells) {
      const spawn = Math.min(want - alive, Math.ceil(rain * 6 * dt * (1 + this.rand())));
      for (let k = 0; k < spawn; k++) { const p = this._spot(); if (p) drops.push({ x: p[0], y: p[1], r: S * (0.025 + 0.03 * this.rand()), vy: 0, run: false, y0: p[1], hang: 0, wait: 0, dying: false, fall: 0, age: 0, trail: [] }); }
    }
    for (const d of drops) {
      d.age += dt;
      if (d.dying) {
        d.fall += dt; d.vy += GRAVITY * S * dt * 1.5; d.y += d.vy * dt;
        if (this.wind) d.vx = (d.vx || 0) + this.wind * S * 9 * dt;            // wind carries a drop that has left the glass
        if (d.vx) { d.x += d.vx * dt; d.vx *= Math.exp(-dt * 1.5); }
        if (d.thrown && d.fall > 0.03 && this.inkAt(d.x, d.y) > 0.9) { d.dying = false; d.thrown = false; d.fall = 0; d.vx = 0; d.vy = 0; d.run = false; d.hang = 0; d.r *= 0.85; d.y0 = d.y; d.trail.length = 0; }   // it lands on other glass and sticks
        continue;
      }
      if (!d.run && !d.hang) {                                       // sitting: grows while it rains, until it is heavy enough to run
        d.r += dt * S * (0.004 + 0.03 * rain);
        if (this.freeze > 0.5) { d.ice = true; d.r = Math.min(d.r, S * 0.2); continue; }            // frozen: it stays a bead (the big ones are sheets of ice) until the rain stops and it thaws away
        if (d.r >= rRun * (0.85 + 0.3 * ((d.age * 7.13) % 1))) { d.run = true; d.vy = S * 0.15; d.y0 = d.y; d.wait = 0; d.trail.length = 0; }
        continue;
      }
      if (d.hang) {                                                  // hanging off the bottom edge of a stroke: swells, then falls
        d.hang += dt; d.r += dt * S * 0.05;
        if (d.hang > 0.7 + 0.5 * ((d.age * 3.7) % 1)) { d.dying = true; d.fall = 0; d.vy = S * 0.4; }
        continue;
      }
      // running: jerky, like a real drop (it sticks, then slips), faster the bigger it is, and faster and straighter on water that is already there
      if (d.wait > 0) { d.wait -= dt; }
      else {
        const ahead = this._wetAt(d.x, d.y + d.r * 1.5);
        d.vy = Math.min(S * 4.5 * (1 + 0.6 * ahead), d.vy + GRAVITY * S * dt * (d.r / rRun) * (1 + 1.2 * ahead));
        const ny = d.y + d.vy * dt;
        if (this.inkAt(d.x, ny + d.r) < 0.35) { d.hang = 0.001; d.vy = 0; }       // the stroke ends: hang there
        else {
          d.trail.push([d.x, d.y, d.age]); if (d.trail.length > 40) d.trail.shift();
          d.y = ny;
          // it drifts towards water on either side of its way (a drop follows an earlier drop's track)
          const lat = this._wetAt(d.x + S * 0.3, ny + d.r * 1.5) - this._wetAt(d.x - S * 0.3, ny + d.r * 1.5);
          if (Math.abs(lat) > 0.05) { const nx = d.x + lat * S * 0.9 * dt; if (this.inkAt(nx, ny) > 0.9) d.x = nx; }
          if (this.wet) { const i = Math.floor(d.x / this.w * this.gw), j = Math.floor(d.y / this.h * this.gh); if (i >= 0 && j >= 0 && i < this.gw && j < this.gh) this.wet[j * this.gw + i] = Math.min(1, this.wet[j * this.gw + i] + 0.6); }
          d.r = Math.max(S * 0.045, d.r - dt * S * 0.012);                 // it leaves water behind
          if (this.rand() < dt * 0.9 * (d.r / rRun) && drops.length < this.maxDrops) {   // ... and sometimes a small bead stays where it passed
            beads.push({ x: d.x + (this.rand() - 0.5) * d.r, y: d.y - d.r * 1.3, r: S * (0.015 + 0.015 * this.rand()), vy: 0, run: false, y0: d.y, hang: 0, wait: 0, dying: false, fall: 0, age: 0, trail: [] });
          }
          if (this.rand() < dt * 3 * (1 - 0.6 * ahead)) { d.wait = 0.05 + 0.25 * this.rand(); d.vy *= 0.3; }   // sticks (less on wet glass)
          if (d.vy < S * 0.05 && d.r < S * 0.07) { d.run = false; d.trail.length = 0; }   // too small to keep going: it sits again
        }
      }
    }
    for (const b of beads) if (this.inkAt(b.x, b.y) > 0.9) drops.push(b);
    // a drop that meets another swallows it
    for (let i = 0; i < drops.length; i++) {
      const a = drops[i]; if (!a || a.dying) continue;
      for (let j = i + 1; j < drops.length; j++) {
        const b = drops[j]; if (!b || b.dying) continue;
        const dx = a.x - b.x, dy = a.y - b.y, rr = (a.r + b.r) * 0.8;
        if (dx * dx + dy * dy < rr * rr) {
          const big = a.r >= b.r ? a : b, small = big === a ? b : a, ma = big.r * big.r, mb = small.r * small.r;
          big.x = (big.x * ma + small.x * mb) / (ma + mb); big.y = (big.y * ma + small.y * mb) / (ma + mb);
          big.r = Math.sqrt(ma + mb);
          big.vy = (big.vy * ma + small.vy * mb) / (ma + mb);                     // momentum is kept: a fast little drop barely speeds a big slow one
          if (small.run && !big.run) { big.run = true; big.vy = Math.max(big.vy, small.vy * 0.5, S * 0.1); big.y0 = Math.min(big.y0, small.y0); }
          small.dying = true; small.gone = true;                    // absorbed (removed below, not shown falling)
        }
      }
    }
    // drops that have fallen away
    this.drops = drops.filter((d) => !d.gone && !(d.dying && (d.fall > 0.35 || d.y > this.h + S)));
  }
}

/**
 * Draws the drops into a canvas 2D context the size of the mask, as three channels the glass shader reads:
 * red = the dark rim of a drop, green = its glint, blue = water (the sky seen through it, bent). Black elsewhere.
 * @param {CanvasRenderingContext2D} ctx
 * @param {DropSim} sim
 * @param {[number, number]} light  screen direction towards the light (y up), unit-ish
 */
export function drawDrops(ctx, sim, light = [-0.5, 0.8]) {
  const { width: w, height: h } = ctx.canvas;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';                          // channels add up where drops and trails overlap
  const S = sim.stroke;
  for (const d of sim.drops) {
    const fade = d.dying ? Math.max(0, 1 - d.fall / 0.35) : 1;
    if (fade <= 0) continue;
    if (d.run && d.trail.length > 1) {                               // the wet line it leaves: thin, brightest by the drop, gone with age
      for (let i = 1; i < d.trail.length; i++) {
        const a = d.trail[i - 1], b = d.trail[i], age = Math.max(0, 1 - (d.age - b[2]) / 1.6);
        if (age <= 0) continue;
        ctx.strokeStyle = `rgba(0,0,${Math.round(255 * 0.45 * age * fade)},1)`; ctx.lineWidth = Math.max(1, d.r * 0.5);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    }
    const x = d.x, y = d.y, r = Math.max(1, d.r) * (d.dying ? 1 : 1);
    ctx.fillStyle = `rgba(0,0,${Math.round(255 * fade)},1)`; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();          // the water
    const rim = ctx.createRadialGradient(x, y, r * 0.55, x, y, r * 1.08);
    rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(0.75, `rgba(${Math.round(255 * 0.9 * fade)},0,0,1)`); rim.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(x, y, r * 1.1, 0, 6.2832); ctx.fill();                                      // the dark edge
    const gx = x + light[0] * r * 0.42, gy = y - light[1] * r * 0.42;                                                        // (y is down on the canvas)
    const hi = ctx.createRadialGradient(gx, gy, 0, gx, gy, r * 0.5);
    hi.addColorStop(0, `rgba(0,${Math.round(255 * fade)},0,1)`); hi.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hi; ctx.beginPath(); ctx.arc(gx, gy, r * 0.5, 0, 6.2832); ctx.fill();                                      // the glint
  }
  ctx.globalCompositeOperation = 'source-over';
  void S;
}

/**
 * The same picture as drawDrops, as vertex lists for the GPU (glsl-mask.js): `drops` has 6 vertices per drop of 8 floats (x, y, centre x, centre y, radius, fade, light x, light y),
 * `trails` 6 vertices per trail segment of 8 floats (x, y, ax, ay, bx, by, half width, brightness). Pure, so it is tested in node.
 */
export function dropGeometry(sim, light = [-0.5, 0.8]) {
  const drops = [], trails = [];
  const quad = (out, x0, y0, x1, y1, tail) => { for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y0], [x1, y1], [x0, y1]]) out.push(x, y, ...tail); };
  for (const d of sim.drops) {
    const fade = d.dying ? Math.max(0, 1 - d.fall / 0.35) : 1;
    if (fade <= 0) continue;
    if (d.run && d.trail.length > 1) {
      for (let i = 1; i < d.trail.length; i++) {
        const a = d.trail[i - 1], b = d.trail[i], age = Math.max(0, 1 - (d.age - b[2]) / 1.6);
        if (age <= 0) continue;
        const hw = Math.max(1, d.r * 0.5) / 2, m = hw + 1;
        quad(trails, Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m, [a[0], a[1], b[0], b[1], hw, 0.45 * age * fade]);
      }
    }
    const r = Math.max(1, d.r), m = r * 1.1 + 2;
    quad(drops, d.x - m, d.y - m, d.x + m, d.y + m, [d.x, d.y, r, fade, light[0], light[1]]);
  }
  return { drops: new Float32Array(drops), trails: new Float32Array(trails) };
}
