// ?stats=1: a small read-out of how fast the engine really draws on this device (for trying a phone or a laptop at its best quality): frames a second, the gaps between pictures
// (median, 95th percentile, worst), the canvas size and the GPU's name. Tap it to copy the numbers (to paste somewhere). Nothing runs without ?stats.
export function initStats(engine, canvas) {
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:6px;top:6px;z-index:99999;margin:0;padding:6px 8px;border-radius:6px;background:rgba(0,0,0,.7);color:#9f9;font:11px/1.35 ui-monospace,Menlo,monospace;white-space:pre;max-width:96vw;overflow:hidden';
  document.body.appendChild(box);
  let gpu = '?';
  try { const gl = canvas.getContext('webgl2'); const x = gl && gl.getExtension('WEBGL_debug_renderer_info'); gpu = x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : (gl ? 'hidden by the browser' : '?'); } catch (e) { /* the name stays ? */ }
  const gaps = [], drawMs = []; let last = 0, since = performance.now(), n = 0, text = '';
  engine.onPresent(() => { const t = performance.now(); if (last) { gaps.push(t - last); if (gaps.length > 900) gaps.shift(); } last = t; n++; });
  const render = engine.render.bind(engine);                     // the time the page spends handing a frame to the GPU (the GPU's own time shows in the gaps)
  engine.render = (...a) => { const t = performance.now(); const r = render(...a); drawMs.push(performance.now() - t); if (drawMs.length > 900) drawMs.shift(); return r; };
  const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const f = (v) => (Math.round(v * 10) / 10).toFixed(1);
  setInterval(() => {
    const now = performance.now(), fps = n * 1000 / (now - since); since = now; n = 0;
    const med = q(gaps, 0.5), p95 = q(gaps, 0.95), p99 = q(gaps, 0.99), worst = q(gaps, 1);
    text = [
      'fps ' + f(fps) + '  (gaps ms: median ' + f(med) + ', 95% ' + f(p95) + ', 99% ' + f(p99) + ', worst ' + f(worst) + ')',
      'page time handing a frame to the GPU: median ' + f(q(drawMs, 0.5)) + ' ms, 95% ' + f(q(drawMs, 0.95)) + ' ms',
      'canvas ' + canvas.width + 'x' + canvas.height + ' (' + f(canvas.width * canvas.height / 1e6) + ' MP), screen ' + innerWidth + 'x' + innerHeight + ' at ' + devicePixelRatio + 'x',
      'quality ' + engine.s.quality + ', scene scale ' + engine.s.scale + ', output scale ' + (engine.s.outScale == null ? 1 : engine.s.outScale) + (engine.gov ? ', governor level ' + engine.gov.level : ''),
      'GPU ' + gpu + (window.__sky && window.__sky.es2 ? ' (ES 2)' : ''),
      'tap to copy',
    ].join('\n');
    box.textContent = text;
  }, 1000);
  box.addEventListener('click', () => { try { navigator.clipboard.writeText(text + '\n' + navigator.userAgent); box.style.outline = '2px solid #9f9'; setTimeout(() => { box.style.outline = ''; }, 600); } catch (e) { /* no clipboard: read it off the screen */ } });
}
