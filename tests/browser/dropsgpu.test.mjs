// The raindrops drawn on the GPU (glsl-mask.js, from dropGeometry) against the same drops drawn by a 2D canvas (drawDrops, the original way): the same picture
// (water, dark rim, glint, wet trails) to within edge smoothing, from a real simulation state with running drops and trails.
export const name = 'dropsgpu';
export const covers = 'The GPU-drawn raindrops equal the canvas-drawn ones (water, rim, glint, trails)';
export const tier = 'deep';

export async function run(t) {
  const h = await t.open({ fast: true, query: 't=2026-06-21T17:00:00Z&speed=0', width: 800, height: 500 });
  await h.settle(500);
  const r = await h.page.evaluate(async () => {
    const { DropSim, drawDrops, dropGeometry } = await import('/js/sky/drops.js');
    const e = window.__sky, gl = e.gl, W = 400, H = 300;
    // a simulation with ink everywhere in a block, run long enough for drops to grow, run and leave trails
    const sim = new DropSim(7), gw = 40, gh = 30, grid = new Uint8Array(gw * gh).fill(255);
    sim.setInk(grid, gw, gh, W, H, 40);
    for (let i = 0; i < 160; i++) sim.step(0.05, 0.9);
    const run = sim.drops.filter((d) => d.run).length, trails = sim.drops.reduce((a, d) => a + (d.trail ? d.trail.length : 0), 0);
    const light = [-0.5, 0.8];
    // GPU
    const geo = dropGeometry(sim, light);
    e.setGlassDropsGeometry({ w: W, h: H, ...geo });
    const read = (tex) => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(f); return px; };
    const gpu = read(e.dropsTex);
    // canvas
    const c = document.createElement('canvas'); c.width = W; c.height = H; drawDrops(c.getContext('2d'), sim, light);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    const cv = read(tex);
    let sum = [0, 0, 0], max = [0, 0, 0], big = 0, lit = 0;
    for (let i = 0; i < W * H; i++) {
      let any = false;
      for (let k = 0; k < 3; k++) { const d = Math.abs(gpu[i * 4 + k] - cv[i * 4 + k]); sum[k] += d; max[k] = Math.max(max[k], d); if (d > 48) big++; if (cv[i * 4 + k] > 20) any = true; }
      if (any) lit++;
    }
    return { drops: sim.drops.length, run, trails, lit, mean: sum.map((v) => v / (W * H)), max, bigShare: big / (W * H * 3) };
  });
  t.check('the test simulation has drops, running drops and trails to compare', r.drops >= 10 && r.run >= 2 && r.trails >= 10, JSON.stringify({ drops: r.drops, run: r.run, trails: r.trails }));
  t.check('the picture is not empty', r.lit > 1500, `${r.lit} pixels lit`);
  t.check(`rim (red), glint (green) and water (blue) agree: mean difference ${r.mean.map((v) => v.toFixed(2)).join(', ')} of 255`, r.mean.every((v) => v < 1.2) && r.bigShare < 0.005, JSON.stringify({ mean: r.mean, max: r.max, big: r.bigShare }));
  await h.close();
}
