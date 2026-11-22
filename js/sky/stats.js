// ?stats=1: a small read-out of how fast the engine really draws on this device (for trying a phone or a laptop at its best quality): frames a second, the gaps between pictures
// (median, 95th percentile, worst), the canvas size and the GPU's name. Tap it to copy the numbers (to paste somewhere). Nothing runs without ?stats.
// ?stats=gpu also waits for the GPU after every frame, so the time a frame takes shows what the GPU needs (the gaps are held at the screen's rate otherwise: 60 or 120 a second).
export function initStats(engine, canvas, mode) {
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:6px;top:6px;z-index:99999;margin:0;padding:6px 8px;border-radius:6px;background:rgba(0,0,0,.7);color:#9f9;font:11px/1.35 ui-monospace,Menlo,monospace;white-space:pre;max-width:96vw;overflow:hidden';
  document.body.appendChild(box);
  const close = document.createElement('button');            // closes the read-out for good (until ?stats is asked for again)
  close.textContent = '\u00d7'; close.setAttribute('aria-label', 'Close the stats'); close.id = 'statsClose';
  close.style.cssText = 'position:fixed;left:6px;top:6px;z-index:100000;margin:0;padding:0 7px;border:0;border-radius:0 6px 0 6px;background:rgba(0,0,0,.85);color:#f99;font:14px/1.3 ui-monospace,Menlo,monospace;cursor:pointer';
  document.body.appendChild(close);
  let gpu = '?';
  try { const gl = canvas.getContext('webgl2'); const x = gl && gl.getExtension('WEBGL_debug_renderer_info'); gpu = x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : (gl ? 'hidden by the browser' : '?'); } catch (e) { /* the name stays ? */ }
  const gaps = [], drawMs = []; let last = 0, since = performance.now(), n = 0, text = '';
  engine.onPresent(() => { const t = performance.now(); if (last) { gaps.push(t - last); if (gaps.length > 900) gaps.shift(); } last = t; n++; });
  const gl = canvas.getContext('webgl2'), gpuWait = mode === 'gpu';
  const timed = (name) => { const f = engine[name].bind(engine); engine[name] = (...a) => { const t = performance.now(); const r = f(...a); if (gpuWait && gl) gl.finish(); drawMs.push(performance.now() - t); if (drawMs.length > 900) drawMs.shift(); return r; }; };
  timed('render'); if (gpuWait) timed('redrawGlass');         // the time the page spends on a frame (with ?stats=gpu, until the GPU has finished it)
  const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const f = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const timer = setInterval(() => {
    const now = performance.now(), fps = n * 1000 / (now - since); since = now; n = 0;
    const med = q(gaps, 0.5), p95 = q(gaps, 0.95), p99 = q(gaps, 0.99), worst = q(gaps, 1);
    text = [
      'fps ' + f(fps) + '  (gaps ms: median ' + f(med) + ', 95% ' + f(p95) + ', 99% ' + f(p99) + ', worst ' + f(worst) + ')',
      (gpuWait ? 'frame including the GPU: median ' : 'page time handing a frame to the GPU: median ') + f(q(drawMs, 0.5)) + ' ms, 95% ' + f(q(drawMs, 0.95)) + ' ms',
      'canvas ' + canvas.width + 'x' + canvas.height + ' (' + f(canvas.width * canvas.height / 1e6) + ' MP), screen ' + innerWidth + 'x' + innerHeight + ' at ' + devicePixelRatio + 'x',
      'quality ' + engine.s.quality + ', scene scale ' + engine.s.scale + ', output scale ' + (engine.s.outScale == null ? 1 : engine.s.outScale) + (engine.gov ? ', governor level ' + engine.gov.level + ', rung ' + engine.gov.rung + ' (' + engine.gov.name + ')' : ''),
      'GPU ' + gpu + (window.__sky && window.__sky.es2 ? ' (ES 2)' : ''),
      'tap to copy',
    ].join('\n');
    box.textContent = text;
    close.style.left = Math.max(6, box.getBoundingClientRect().right - close.offsetWidth) + 'px';
  }, 1000);
  close.addEventListener('click', () => { clearInterval(timer); box.remove(); close.remove(); try { localStorage.removeItem('stats'); } catch (e) { /* nothing saved */ } });
  box.addEventListener('click', () => { try { navigator.clipboard.writeText(text + '\n' + navigator.userAgent); box.style.outline = '2px solid #9f9'; setTimeout(() => { box.style.outline = ''; }, 600); } catch (e) { /* no clipboard: read it off the screen */ } });
}
