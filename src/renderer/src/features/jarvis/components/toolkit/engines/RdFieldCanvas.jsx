import { useEffect, useRef } from 'react';
import { Button } from '@jarvis/components/ui/button';
import { downloadBlob } from '@jarvis/components/toolkit/shared';

export default function RdFieldCanvas({ frame, species, stimulate }) {
  const canvas = useRef(null);
  useEffect(() => {
    if (!frame) return;
    const ctx = canvas.current.getContext('2d'), values = frame[species], image = ctx.createImageData(frame.n, frame.n);
    let lo = Infinity, hi = -Infinity; for (const v of values) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const range = Math.max(hi - lo, 1e-6), sample = document.createElement('canvas').getContext('2d'), tokens = window.getComputedStyle(canvas.current);
    sample.fillStyle = `hsl(${tokens.getPropertyValue('--background').trim()})`; sample.fillRect(0, 0, 1, 1); const bg = sample.getImageData(0, 0, 1, 1).data;
    sample.fillStyle = `hsl(${tokens.getPropertyValue('--cyan').trim()})`; sample.fillRect(0, 0, 1, 1); const fg = sample.getImageData(0, 0, 1, 1).data;
    values.forEach((v, i) => { const t = (v - lo) / range; for (let j = 0; j < 3; j++) image.data[4 * i + j] = bg[j] + (fg[j] - bg[j]) * t; image.data[4 * i + 3] = 255; });
    ctx.putImageData(image, 0, 0);
  }, [frame, species]);
  if (!frame) return null;
  return <div className="space-y-2">
    <canvas ref={canvas} width={frame.n} height={frame.n} className="aspect-square w-full max-w-xl rounded-xl border border-border bg-background" style={{ imageRendering: 'pixelated' }} aria-label={`${species} concentration field at t=${frame.t.toFixed(2)}`} onPointerDown={e => { const r = e.currentTarget.getBoundingClientRect(); stimulate((e.clientX - r.left) / r.width * frame.n, (e.clientY - r.top) / r.height * frame.n); }} />
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] text-muted-foreground">Dark → low; cyan → high · Auto-scaled per frame · Click to stimulate</p><Button size="sm" variant="outline" onClick={() => canvas.current.toBlob(blob => { if (blob) downloadBlob(blob, `reaction-diffusion-${species}-${frame.t.toFixed(1)}.png`); })}>Save PNG</Button></div>
  </div>;
}