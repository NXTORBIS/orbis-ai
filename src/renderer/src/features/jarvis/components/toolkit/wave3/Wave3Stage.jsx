import { useMemo, useRef, useState } from 'react';
import { formatNumber } from '@jarvis/components/toolkit/science50/model';

const W = 760;
const H = 336;
const PAD = { left: 64, right: 22, top: 20, bottom: 46 };
const TICKS = 5;

const nearest = (points, target, screen) => points.reduce((best, item, index) => {
  const distance = Math.abs(screen(item.x) - target);
  return distance < best.distance ? { index, distance } : best;
}, { index: 0, distance: Infinity });

export default function Wave3Stage({ series, pickValue, hasComparison, onPick }) {
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [dragging, setDragging] = useState(false);

  const model = useMemo(() => {
    const pts = series.points.filter((item) => item.y !== null);
    if (pts.length < 2) return null;
    const logX = series.scale === 'log';
    const tx = (x) => (logX ? Math.log10(Math.max(x, 1e-12)) : x);
    const first = tx(series.points[0].x);
    const last = tx(series.points[series.points.length - 1].x);
    const x0 = first;
    const x1 = last > first ? last : first + 1;
    const values = pts.map((item) => item.y).concat(pts.map((item) => item.comparison).filter((value) => typeof value === 'number'));
    let y0 = Math.min(...values);
    let y1 = Math.max(...values);
    if (y1 === y0) { const unit = Math.abs(y0) || 1; y0 -= unit * 0.1; y1 += unit * 0.1; }
    const pad = (y1 - y0) * 0.12;
    y0 -= pad; y1 += pad;
    const px = (x) => PAD.left + ((tx(x) - x0) / (x1 - x0)) * (W - PAD.left - PAD.right);
    const py = (y) => H - PAD.bottom - ((y - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom);
    return { pts, x0, x1, y0, y1, px, py, tx };
  }, [series]);

  if (!model) return <p role="status" className="rounded-lg border border-border p-3 text-xs text-muted-foreground">Not enough valid points to plot. Widen the range or change an input.</p>;

  const line = model.pts.map((item) => `${model.px(item.x).toFixed(2)},${model.py(item.y).toFixed(2)}`).join(' ');
  const floor = H - PAD.bottom;
  const area = `${line} ${model.px(model.pts[model.pts.length - 1].x).toFixed(2)},${floor} ${model.px(model.pts[0].x).toFixed(2)},${floor}`;
  const baselineLine = hasComparison ? model.pts.filter((item) => typeof item.comparison === 'number').map((item) => `${model.px(item.x).toFixed(2)},${model.py(item.comparison).toFixed(2)}`).join(' ') : '';
  const handle = series.pickable && typeof pickValue === 'number' ? model.pts[nearest(model.pts, model.px(pickValue), model.px).index] : null;

  const track = (event) => {
    const rect = svgRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (W / rect.width);
    const { index } = nearest(model.pts, x, model.px);
    setHover(index);
    if (dragging && series.pickable && onPick) onPick(model.pts[index].x);
  };

  const active = hover === null ? null : model.pts[hover];
  const readout = active ? { id: active.x, value: active.y, compared: active.comparison } : { id: model.pts[model.pts.length - 1].x, value: model.pts[model.pts.length - 1].y, compared: model.pts[model.pts.length - 1].comparison };
  const boxLeft = Math.min(Math.max(model.px(readout.id) / W, 0.02), 0.72);

  return (
    <div className="relative select-none">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none" role="img" aria-label={`${series.yLabel} against ${series.xLabel}`}
        onPointerMove={track} onPointerDown={(event) => { setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); track(event); }}
        onPointerUp={(event) => { setDragging(false); event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerLeave={() => { setHover(null); setDragging(false); }}>
        <defs>
          <linearGradient id="w3-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(189 100% 50%)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="hsl(189 100% 50%)" stopOpacity="0.01" />
          </linearGradient>
          <filter id="w3-glow" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {Array.from({ length: TICKS }, (_, index) => {
          const ratio = index / (TICKS - 1);
          const y = PAD.top + ratio * (H - PAD.top - PAD.bottom);
          const value = model.y1 - ratio * (model.y1 - model.y0);
          return (
            <g key={`y${index}`}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="hsl(var(--border))" strokeWidth="0.7" opacity="0.7" />
              <text x={PAD.left - 8} y={y + 3} textAnchor="end" fontSize="9" fill="hsl(var(--muted-foreground))" fontFamily="monospace">{formatNumber(value)}</text>
            </g>
          );
        })}

        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const x = PAD.left + ratio * (W - PAD.left - PAD.right);
          const value = model.tx ? (series.scale === 'log' ? Math.pow(10, model.x0 + ratio * (model.x1 - model.x0)) : model.x0 + ratio * (model.x1 - model.x0)) : 0;
          return (
            <g key={`x${ratio}`}>
              <line x1={x} y1={PAD.top} x2={x} y2={floor} stroke="hsl(var(--border))" strokeWidth="0.7" opacity="0.4" />
              <text x={x} y={floor + 16} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))" fontFamily="monospace">{formatNumber(value)}</text>
            </g>
          );
        })}

        <polygon points={area} fill="url(#w3-area)" />
        {baselineLine && <polyline points={baselineLine} fill="none" stroke="hsl(265 85% 68%)" strokeWidth="1.6" strokeDasharray="5 4" opacity="0.9" />}
        <polyline points={line} fill="none" stroke="hsl(189 100% 50%)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" filter="url(#w3-glow)" />

        {active && <line x1={model.px(active.x)} y1={PAD.top} x2={model.px(active.x)} y2={floor} stroke="hsl(var(--foreground))" strokeWidth="0.8" opacity="0.45" />}
        {hasComparison && active && typeof active.comparison === 'number' && <circle cx={model.px(active.x)} cy={model.py(active.comparison)} r="3" fill="hsl(265 85% 68%)" />}
        {active && <circle cx={model.px(active.x)} cy={model.py(active.y)} r="4" fill="hsl(189 100% 50%)" stroke="hsl(var(--background))" strokeWidth="1.4" />}

        {handle && <g className={dragging ? 'cursor-grabbing' : 'cursor-grab'}>
          <line x1={model.px(handle.x)} y1={PAD.top} x2={model.px(handle.x)} y2={floor} stroke="hsl(189 100% 50%)" strokeWidth="1" strokeDasharray="3 3" opacity="0.8" />
          <circle cx={model.px(handle.x)} cy={model.py(handle.y)} r="8" fill="hsl(189 100% 50%)" opacity="0.18" />
          <circle cx={model.px(handle.x)} cy={model.py(handle.y)} r="5.2" fill="hsl(var(--background))" stroke="hsl(189 100% 50%)" strokeWidth="2.4" />
        </g>}

        <text x={PAD.left} y={PAD.top - 8} fontSize="9" fill="hsl(var(--muted-foreground))">{series.yLabel}{series.unit ? ` (${series.unit})` : ''}</text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize="9" fill="hsl(var(--muted-foreground))">{series.xLabel}</text>
      </svg>

      <div className="pointer-events-none absolute top-1 rounded-lg border border-border/70 bg-card/90 px-2.5 py-1.5 font-mono text-[10px] leading-tight shadow-lg backdrop-blur" style={{ left: `${boxLeft * 100}%` }}>
        <div className="text-muted-foreground">{series.xLabel}: <span className="text-foreground">{formatNumber(readout.id)}</span></div>
        <div className="text-cyan-j">{series.yLabel}: {formatNumber(readout.value)} {series.unit}</div>
        {hasComparison && typeof readout.compared === 'number' && <div className="text-violet-400">Captured: {formatNumber(readout.compared)} {series.unit}</div>}
      </div>
      {series.pickable && <p className="mt-1 text-center text-[10px] text-muted-foreground">Drag the handle to set {series.variableLabel} · hover anywhere for a readout</p>}
    </div>
  );
}