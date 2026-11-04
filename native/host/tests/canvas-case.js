// A drawing in the style of the glass mask (stroked digit paths, round caps, radial-gradient lights painted inside the strokes with source-atop),
// a linear gradient, a rounded rectangle, drawImage with scaling and getImageData/putImageData. Run by both the browser and the native host; the
// pictures must agree.
export function draw(document) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 200;
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.save();
  ctx.translate(20, 20); ctx.scale(0.5, 0.5);
  ctx.strokeStyle = '#fff'; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 80;
  ctx.stroke(new Path2D('M 0 0 L 400 0 400 500 0 500'));
  ctx.stroke(new Path2D('M 450 0 C 450 200, 600 300, 750 500'));
  ctx.restore();
  ctx.globalCompositeOperation = 'source-atop';
  for (const [x, y, col] of [[40, 30, [255, 40, 50]], [120, 40, [20, 215, 255]], [60, 130, [70, 90, 255]], [200, 100, [40, 240, 90]]]) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 60);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.22, `rgba(${col[0]},${col[1]},${col[2]},0.95)`); g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 60, 0, 6.2832); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  const lg = ctx.createLinearGradient(0, 150, 320, 150); lg.addColorStop(0, '#f00'); lg.addColorStop(1, 'rgba(0,0,255,0.5)');
  ctx.fillStyle = lg; ctx.fillRect(10, 160, 300, 14);
  ctx.fillStyle = 'rgba(30,120,60,0.8)'; ctx.strokeStyle = '#223'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(200, 20, 100, 50, 25); ctx.fill(); ctx.stroke();
  const small = document.createElement('canvas'); small.width = 8; small.height = 8;
  const sc = small.getContext('2d'); sc.fillStyle = '#e63'; sc.fillRect(0, 0, 8, 8); sc.fillStyle = '#36e'; sc.fillRect(0, 0, 4, 4);
  ctx.drawImage(small, 230, 90, 64, 48);
  const img = ctx.getImageData(10, 10, 20, 20); for (let i = 0; i < img.data.length; i += 4) img.data[i] = 255 - img.data[i];
  ctx.putImageData(img, 280, 170);
  const out = ctx.getImageData(0, 0, c.width, c.height);
  return { w: c.width, h: c.height, data: out.data };     // straight RGBA
}
