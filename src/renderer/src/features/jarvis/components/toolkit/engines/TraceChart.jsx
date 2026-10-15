import React from 'react';

/**
 * A small multi-series line chart on an SVG canvas. Data units in, pixels out — no chart
 * library, so trajectories can be drawn the moment a simulation produces them.
 */
export default function TraceChart({ series = [], height = 180, bands = [], yMin, yMax, xMin = 0, xMax, yTicks = 3, className }) {
  const points = series.flatMap((entry) => entry.points);
  if (!points.length) return null;

  const lo = yMin ?? Math.min(...points.map((point) => point.y));
  const hi = yMax ?? Math.max(...points.map((point) => point.y));
  const left = xMin;
  const right = xMax ?? Math.max(...points.map((point) => point.x));
  const spanY = hi - lo || 1;
  const spanX = right - left || 1;
  const W = 600;
  const H = height;
  const px = (x) => ((x - left) / spanX) * W;
  const py = (y) => H - ((y - lo) / spanY) * (H - 10) - 5;

  const ticks = [];
  for (let i = 0; i <= yTicks; i += 1) {
    const value = lo + (spanY * i) / yTicks;
    ticks.push({ value, y: py(value) });
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className ?? 'h-44 w-full'}>
      {bands.map((band, index) => (
        <rect
          key={`${band.label}-${index}`}
          x={px(band.from)}
          y={0}
          width={Math.max(0, px(band.to) - px(band.from))}
          height={H}
          fill={band.fill ?? 'hsl(189 100% 50% / 0.06)'}
        />
      ))}
      {ticks.map((tick) => (
        <line key={tick.value} x1={0} x2={W} y1={tick.y} y2={tick.y} stroke="hsl(var(--border))" strokeWidth="1" opacity="0.5" />
      ))}
      {series.map((entry, index) => (
        <polyline
          key={entry.label ?? index}
          points={entry.points.map((point) => `${px(point.x).toFixed(1)},${py(point.y).toFixed(1)}`).join(' ')}
          fill="none"
          stroke={entry.stroke ?? 'hsl(189 100% 50%)'}
          strokeWidth={entry.width ?? 1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={entry.opacity ?? 1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}