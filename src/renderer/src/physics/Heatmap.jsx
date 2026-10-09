import React, { useEffect, useRef } from 'react';
import { CanvasStage } from './ui';

// Canvas heatmap for a 2D scalar field. data: number[][] (rows x cols), or a
// function (i,j,rows,cols) => number. colormap: 'viridis' | 'grayscale' | 'cool'.
export default function Heatmap({ data, rows, cols, colormap = 'viridis', height = 280, label, min, max, onCell }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); const w = cv.width, h = cv.height;
    ctx.fillStyle = 'hsl(222 47% 6%)'; ctx.fillRect(0, 0, w, h);
    const grid = typeof data === 'function' ? Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => data(i, j, rows, cols))) : data;
    const R = grid.length, C = grid[0]?.length || 0;
    if (!R || !C) return;
    let lo = min ?? Infinity, hi = max ?? -Infinity;
    if (min === undefined || max === undefined) {
      for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) { const v = grid[i][j]; if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    const cw = w / C, ch = h / R;
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
      const v = (grid[i][j] - lo) / (hi - lo || 1);
      ctx.fillStyle = color(v, colormap);
      ctx.fillRect(j * cw, i * ch, cw + 0.5, ch + 0.5);
    }
  }, [data, rows, cols, colormap, min, max]);
  return (
    <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height }}>
      {label && <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>}
      <CanvasStage ref={ref} />
    </div>
  );
}

function color(t, map) {
  t = Math.max(0, Math.min(1, t));
  if (map === 'grayscale') { const g = Math.round(t * 255); return `rgb(${g},${g},${g})`; }
  if (map === 'cool') return `rgb(${Math.round(t * 80)},${Math.round(80 + t * 175)},${Math.round(180 + t * 75)})`;
  // viridis-ish
  const r = Math.round(20 + 230 * t * t);
  const g = Math.round(40 + 200 * Math.min(1, t * 1.4));
  const b = Math.round(140 - 120 * t + 80 * t * t);
  return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, Math.max(0, b))})`;
}