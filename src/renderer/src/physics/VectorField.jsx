import React, { useEffect, useRef } from 'react';
import { CanvasStage } from './ui';

// Vector field plot. f(x, y) => [vx, vy] in data space. Draws arrows on a grid.
export default function VectorField({ f, xRange = [-1, 1], yRange = [-1, 1], grid = 16, height = 280, color = '#22d3ee', label }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); const w = cv.width, h = cv.height;
    ctx.fillStyle = 'hsl(222 47% 6%)'; ctx.fillRect(0, 0, w, h);
    const [x0, x1] = xRange, [y0, y1] = yRange;
    const sx = (x) => ((x - x0) / (x1 - x0)) * w;
    const sy = (y) => (1 - (y - y0) / (y1 - y0)) * h;
    // axes
    ctx.strokeStyle = 'hsl(var(--border) / 0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, sy(0)); ctx.lineTo(w, sy(0)); ctx.moveTo(sx(0), 0); ctx.lineTo(sx(0), h); ctx.stroke();
    // sample magnitudes for normalisation
    let magMax = 1e-9; const samples = [];
    for (let i = 0; i < grid; i++) for (let j = 0; j < grid; j++) {
      const x = x0 + (i + 0.5) / grid * (x1 - x0), y = y0 + (j + 0.5) / grid * (y1 - y0);
      const [vx, vy] = f(x, y); const m = Math.hypot(vx, vy); samples.push([x, y, vx, vy, m]); if (m > magMax) magMax = m;
    }
    const cellW = w / grid, cellH = h / grid;
    ctx.strokeStyle = color; ctx.fillStyle = color;
    for (const [x, y, vx, vy, m] of samples) {
      const cx = sx(x), cy = sy(y); const len = (m / magMax) * Math.min(cellW, cellH) * 0.9;
      const ang = Math.atan2(-vy, vx); const ex = cx + Math.cos(ang) * len, ey = cy + Math.sin(ang) * len;
      ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      // arrowhead
      const ah = 4; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(ang - 0.4) * ah, ey - Math.sin(ang - 0.4) * ah); ctx.lineTo(ex - Math.cos(ang + 0.4) * ah, ey - Math.sin(ang + 0.4) * ah); ctx.closePath(); ctx.fill();
    }
  }, [f, xRange, yRange, grid, color]);
  return (
    <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height }}>
      {label && <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>}
      <CanvasStage ref={ref} />
    </div>
  );
}