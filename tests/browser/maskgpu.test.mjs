// The glass mask drawn on the GPU (glsl-mask.js) against the same mask drawn by a 2D canvas (the original way): they are the same picture
// (the strokes' shape, the stained glass lights), to within the edge smoothing.
export const name = 'maskgpu';
export const covers = 'The GPU-drawn glass mask equals the canvas-drawn one (glass and coloured-tube styles); the digits still draw when the GPU path is off';
export const tier = 'deep';

const NOON = 't=2026-06-21T17:00:00Z&speed=0';

export async function run(t) {
  for (const style of ['glass', 'stained']) {
    const h = await t.open({ fast: true, query: NOON, width: 800, height: 500, conf: { clockStyle: style, twentyFourHourClock: true } });
    await h.settle(600);
    const r = await h.page.evaluate(async (style) => {
      const e = window.__sky, gl = e.gl;
      const raf = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const read = (tex, w, hh) => {
        const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        const px = new Uint8Array(w * hh * 4); gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(f); return px;
      };
      const redraw = async () => { window.dispatchEvent(new Event('clocklayout')); await raf(); };
      window.__canvasMask = false; await redraw();
      const w = e.glass.maskW, hh = e.glass.maskH, gpu = read(e.maskTex, w, hh), gpuUsed = !!e.maskTarget && e.maskTex === e.maskTarget.tex;
      window.__canvasMask = true; await redraw();
      const w2 = e.glass.maskW, h2 = e.glass.maskH, cv = read(e.maskTex, w2, h2), cvUsed = e.maskTex === e.maskTexCanvas;
      window.__canvasMask = false;
      if (w !== w2 || hh !== h2) return { err: `sizes differ ${w}x${hh} vs ${w2}x${h2}` };
      // coverage (alpha) and colour inside the glyphs (where both are mostly covered)
      let n = 0, sumA = 0, maxA = 0, big = 0, inside = 0, sumC = 0, maxC = 0;
      for (let i = 0; i < w * hh; i++) {
        const da = Math.abs(gpu[i * 4 + 3] - cv[i * 4 + 3]); sumA += da; maxA = Math.max(maxA, da); if (da > 40) big++; n++;
        if (gpu[i * 4 + 3] > 250 && cv[i * 4 + 3] > 250) { inside++; for (let c = 0; c < 3; c++) { const dc = Math.abs(gpu[i * 4 + c] - cv[i * 4 + c]); sumC += dc; maxC = Math.max(maxC, dc); } }
      }
      let covered = 0; for (let i = 0; i < w * hh; i++) if (cv[i * 4 + 3] > 128) covered++;
      return { w, hh, gpuUsed, cvUsed, meanA: sumA / n, maxA, bigShare: big / n, covered, inside, meanC: inside ? sumC / (inside * 3) : 0, maxC, style };
    }, style);
    if (r.err) { t.check(`${style}: masks comparable`, false, r.err); await h.close(); continue; }
    t.check(`${style}: the GPU path was really used, and the canvas path really used for the comparison`, r.gpuUsed && r.cvUsed, JSON.stringify({ gpu: r.gpuUsed, canvas: r.cvUsed }));
    t.check(`${style}: the digits cover a real area of the mask`, r.covered > 2000, `${r.covered} pixels`);
    t.check(`${style}: coverage agrees (mean difference ${r.meanA.toFixed(2)} of 255, ${(r.bigShare * 100).toFixed(2)}% of pixels differ by more than 40)`, r.meanA < 1.5 && r.bigShare < 0.01, JSON.stringify({ meanA: r.meanA, maxA: r.maxA, big: r.bigShare }));
    t.check(`${style}: colour inside the glyphs agrees (mean difference ${r.meanC.toFixed(2)} of 255)`, r.meanC < 3, JSON.stringify({ meanC: r.meanC, maxC: r.maxC, inside: r.inside }));
    await h.close();
  }
}
