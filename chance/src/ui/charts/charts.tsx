/**
 * Chart components. Each one represents actual computed data: there are no
 * decorative points, and nothing is drawn unless the caller supplies values.
 *
 * Mark specs follow the project's visualisation rules: bars at most 24px thick
 * with a 2px surface gap and 4px rounded data-ends, 2px lines, markers at
 * least 8px across with a 2px surface ring, area fills at ~10% opacity,
 * hairline solid gridlines, and selective direct labels rather than a value on
 * every point.
 */
import { useMemo, useState } from 'react';
import { ChartFrame, TooltipRows, type LegendEntry } from './ChartFrame';
import { downsample, formatPercent, formatProbability, formatValue, seriesColor } from './scale';
import type { ColumnDef } from '../primitives';

const MAX_BAR_THICKNESS = 24;
const BAR_GAP = 2;
const MARKER_RADIUS = 4;
const MAX_DRAWN_POINTS = 1200;

/* ------------------------------------------------------------------ Bars */

export interface BarDatum {
  /** Numeric position on the x axis (a discrete value or bin centre). */
  x: number;
  y: number;
  label?: string;
  /** Overlay value, e.g. the theoretical probability beside an observed one. */
  compare?: number;
}

export function BarChart({
  title,
  description,
  data,
  xLabel,
  yLabel,
  height,
  asPercent,
  compareLabel,
  seriesLabel,
  note,
  onExport,
  highlight,
}: {
  title: string;
  description: string;
  data: BarDatum[];
  xLabel: string;
  yLabel: string;
  height?: number;
  asPercent?: boolean;
  compareLabel?: string;
  seriesLabel: string;
  note?: string;
  onExport?(): void;
  /** Values in this range are emphasised (e.g. a selected interval). */
  highlight?: { from: number; to: number } | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const hasCompare = data.some((d) => d.compare !== undefined);

  if (!data.length) {
    return (
      <ChartFrame
        title={title}
        description={description}
        xLabel={xLabel}
        yLabel={yLabel}
        xDomain={[0, 1]}
        yDomain={[0, 1]}
        empty={{ title: 'Nothing to plot yet', message: 'Run the calculation to see the distribution.' }}
      >
        {() => null}
      </ChartFrame>
    );
  }

  const xs = data.map((d) => d.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMax = Math.max(...data.map((d) => Math.max(d.y, d.compare ?? 0)));
  const step = data.length > 1 ? (xMax - xMin) / (data.length - 1) : 1;
  const xDomain: [number, number] = [xMin - step / 2, xMax + step / 2];
  const format = asPercent ? (v: number) => formatPercent(v) : (v: number) => formatProbability(v);

  const legend: LegendEntry[] = hasCompare
    ? [
        { label: seriesLabel, color: seriesColor(0) },
        { label: compareLabel ?? 'Theoretical', color: seriesColor(1), kind: 'line' },
      ]
    : [{ label: seriesLabel, color: seriesColor(0) }];

  const columns: ColumnDef<unknown>[] = [
    { key: 'x', header: xLabel, render: (r) => (r as BarDatum).label ?? formatValue((r as BarDatum).x) },
    { key: 'y', header: seriesLabel, numeric: true, render: (r) => format((r as BarDatum).y) },
    ...(hasCompare ? [{ key: 'c', header: compareLabel ?? 'Theoretical', numeric: true, render: (r: unknown) => format((r as BarDatum).compare ?? NaN) }] : []),
  ];

  const hovered = hover !== null ? data[hover] : null;

  return (
    <ChartFrame
      title={title}
      description={description}
      xLabel={xLabel}
      yLabel={yLabel}
      xDomain={xDomain}
      yDomain={[0, yMax * 1.08]}
      height={height}
      legend={legend}
      xIntegerTicks={data.every((d) => Number.isInteger(d.x))}
      note={note}
      table={{ columns, rows: data, caption: `${title}: values` }}
      onExport={onExport}
      tooltip={
        hovered
          ? {
              x: 0,
              y: 0,
              content: (
                <TooltipRows
                  rows={[
                    { label: xLabel, value: hovered.label ?? formatValue(hovered.x) },
                    { label: seriesLabel, value: format(hovered.y) },
                    ...(hovered.compare !== undefined ? [{ label: compareLabel ?? 'Theoretical', value: format(hovered.compare) }] : []),
                    ...(hovered.compare !== undefined ? [{ label: 'Difference', value: format(hovered.y - hovered.compare) }] : []),
                  ]}
                />
              ),
            }
          : null
      }
    >
      {({ x, y, width, height: h }) => {
        const slot = width / data.length;
        const barWidth = Math.max(1, Math.min(MAX_BAR_THICKNESS, slot - BAR_GAP));
        const radius = Math.min(4, barWidth / 2);
        return (
          <g>
            {data.map((d, i) => {
              const cx = x(d.x);
              const top = y(d.y);
              const inHighlight = highlight ? d.x >= highlight.from && d.x <= highlight.to : true;
              const barHeight = Math.max(0, h - top);
              return (
                <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  {/* Invisible hit area wider than the bar, for easy hovering. */}
                  <rect x={cx - slot / 2} y={0} width={slot} height={h} fill="transparent" />
                  <path
                    className="oc-chart-series"
                    d={roundedTopRect(cx - barWidth / 2, top, barWidth, barHeight, radius)}
                    fill={seriesColor(0)}
                    fillOpacity={inHighlight ? (hover === i ? 1 : 0.88) : 0.28}
                  />
                  {d.compare !== undefined && (
                    // Theoretical value as a 2px rule across the bar slot.
                    <line
                      x1={cx - barWidth / 2 - 1}
                      x2={cx + barWidth / 2 + 1}
                      y1={y(d.compare)}
                      y2={y(d.compare)}
                      stroke={seriesColor(1)}
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  )}
                </g>
              );
            })}
            {/* Direct label on the tallest bar only. */}
            {(() => {
              const maxI = data.reduce((best, d, i) => (d.y > data[best].y ? i : best), 0);
              const d = data[maxI];
              const cx = x(d.x);
              const top = y(d.y);
              if (top < 14) return null;
              return (
                <text className="oc-chart__tick" x={cx} y={top - 6} textAnchor="middle" style={{ fill: 'var(--text-secondary)' }}>
                  {format(d.y)}
                </text>
              );
            })()}
          </g>
        );
      }}
    </ChartFrame>
  );
}

function roundedTopRect(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

/* ------------------------------------------------------------- Line / area */

export interface CurveSeries {
  label: string;
  points: { x: number; y: number }[];
  /** Fill the area under the curve (for densities). */
  area?: boolean;
  /** Dashed, for a secondary reference curve. */
  dashed?: boolean;
}

export function LineChart({
  title,
  description,
  series,
  xLabel,
  yLabel,
  height,
  shadeRange,
  markers,
  valueFormatter = (v: number) => formatValue(v),
  note,
  onExport,
  yDomain: yDomainOverride,
  referenceLines,
}: {
  title: string;
  description: string;
  series: CurveSeries[];
  xLabel: string;
  yLabel: string;
  height?: number;
  /** Shaded probability region under the first series. */
  shadeRange?: { from: number; to: number; label: string } | null;
  /** Emphasised points, e.g. a selected quantile. */
  markers?: { x: number; y: number; label: string }[];
  valueFormatter?(v: number): string;
  note?: string;
  onExport?(): void;
  yDomain?: [number, number];
  referenceLines?: { value: number; label: string; axis: 'x' | 'y' }[];
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<{ x: number; px: number } | null>(null);
  const visible = series.filter((s) => !hidden.has(s.label));

  const prepared = useMemo(
    () =>
      visible.map((s) => {
        const finite = s.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        const { points, reduced } = downsample(finite, MAX_DRAWN_POINTS, (p) => p.y);
        return { ...s, drawn: points, reduced, all: finite };
      }),
    [visible],
  );

  const allPoints = prepared.flatMap((s) => s.all);
  // Guarded against an empty series: the empty state is rendered further down,
  // after every hook has run, so hook order never changes between renders.
  const xMin = allPoints.length ? Math.min(...allPoints.map((p) => p.x)) : 0;
  const xMax = allPoints.length ? Math.max(...allPoints.map((p) => p.x)) : 1;
  const yMaxRaw = allPoints.length ? Math.max(...allPoints.map((p) => p.y)) : 1;
  const yMinRaw = allPoints.length ? Math.min(0, ...allPoints.map((p) => p.y)) : 0;
  const yDomain = yDomainOverride ?? ([yMinRaw, yMaxRaw * 1.08] as [number, number]);
  const anyReduced = prepared.some((s) => s.reduced);

  const legend: LegendEntry[] = series.map((s, i) => ({
    label: s.label,
    color: seriesColor(i),
    kind: 'line',
    visible: !hidden.has(s.label),
    onToggle:
      series.length > 1
        ? () =>
            setHidden((prev) => {
              const next = new Set(prev);
              if (next.has(s.label)) next.delete(s.label);
              else if (next.size < series.length - 1) next.add(s.label);
              return next;
            })
        : undefined,
  }));

  // Tooltip: nearest x across all visible series.
  const hoverRows = useMemo(() => {
    if (!hover) return null;
    const rows = [{ label: xLabel, value: formatValue(hover.x) }];
    for (const s of prepared) {
      const nearest = nearestByX(s.all, hover.x);
      if (nearest) rows.push({ label: s.label, value: valueFormatter(nearest.y) });
    }
    return rows;
  }, [hover, prepared, xLabel, valueFormatter]);

  const columns: ColumnDef<unknown>[] = [
    { key: 'x', header: xLabel, numeric: true, render: (r) => formatValue((r as { x: number }).x) },
    ...series.map((s, i) => ({
      key: `s${i}`,
      header: s.label,
      numeric: true,
      render: (r: unknown) => {
        const row = r as { values: (number | undefined)[] };
        const v = row.values[i];
        return v === undefined ? '—' : valueFormatter(v);
      },
    })),
  ];
  const tableRows = useMemo(() => buildTableRows(series, 300), [series]);

  if (!allPoints.length) {
    return (
      <ChartFrame
        title={title}
        description={description}
        xLabel={xLabel}
        yLabel={yLabel}
        xDomain={[0, 1]}
        yDomain={[0, 1]}
        empty={{ title: 'Nothing to plot yet', message: 'Adjust the parameters or run the calculation to produce a curve.' }}
      >
        {() => null}
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      title={title}
      description={description}
      xLabel={xLabel}
      yLabel={yLabel}
      xDomain={[xMin, xMax]}
      yDomain={yDomain}
      height={height}
      legend={legend}
      note={note ?? (anyReduced ? `The curve is drawn from a reduced set of points for performance; peaks and troughs are preserved, and the full values are available in the table view.` : undefined)}
      table={{ columns, rows: tableRows, caption: `${title}: values` }}
      onExport={onExport}
      onHover={(p) => setHover(p ? { x: p.x, px: p.px } : null)}
      tooltip={hover && hoverRows ? { x: hover.px, y: 12, content: <TooltipRows rows={hoverRows} /> } : null}
    >
      {({ x, y, width, height: h }) => (
        <g>
          {/* Shaded probability region */}
          {shadeRange && prepared[0] && (
            <>
              <path
                d={areaPath(prepared[0].all.filter((p) => p.x >= shadeRange.from && p.x <= shadeRange.to), x, y, h)}
                fill={seriesColor(0)}
                fillOpacity={0.22}
              />
              {[shadeRange.from, shadeRange.to].map((v, i) =>
                v > xMin && v < xMax ? (
                  <line key={i} x1={x(v)} x2={x(v)} y1={0} y2={h} stroke={seriesColor(0)} strokeWidth={1.5} strokeDasharray="3 3" />
                ) : null,
              )}
            </>
          )}

          {referenceLines?.map((r, i) =>
            r.axis === 'x' ? (
              <g key={i}>
                <line x1={x(r.value)} x2={x(r.value)} y1={0} y2={h} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="4 3" />
                <text className="oc-chart__tick" x={x(r.value) + 4} y={12} style={{ fill: 'var(--text-secondary)' }}>
                  {r.label}
                </text>
              </g>
            ) : (
              <g key={i}>
                <line x1={0} x2={width} y1={y(r.value)} y2={y(r.value)} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="4 3" />
                <text className="oc-chart__tick" x={width - 4} y={y(r.value) - 4} textAnchor="end" style={{ fill: 'var(--text-secondary)' }}>
                  {r.label}
                </text>
              </g>
            ),
          )}

          {prepared.map((s, i) => {
            const colorIndex = series.findIndex((o) => o.label === s.label);
            const color = seriesColor(colorIndex);
            return (
              <g key={s.label} className="oc-chart-series">
                {s.area && <path d={areaPath(s.drawn, x, y, h)} fill={color} fillOpacity={0.1} />}
                <path
                  d={linePath(s.drawn, x, y)}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={s.dashed ? '5 4' : undefined}
                />
                {i === 0 && hover && <Crosshair x={x} y={y} points={s.all} hoverX={hover.x} height={h} color={color} />}
              </g>
            );
          })}

          {markers?.map((m, i) => (
            <g key={i}>
              {/* 2px surface ring keeps the marker legible over the line. */}
              <circle cx={x(m.x)} cy={y(m.y)} r={MARKER_RADIUS + 2} fill="var(--surface-1)" />
              <circle cx={x(m.x)} cy={y(m.y)} r={MARKER_RADIUS} fill={seriesColor(1)} />
              <text className="oc-chart__tick" x={x(m.x)} y={y(m.y) - 10} textAnchor="middle" style={{ fill: 'var(--text-secondary)' }}>
                {m.label}
              </text>
            </g>
          ))}
        </g>
      )}
    </ChartFrame>
  );
}

function Crosshair({
  x,
  y,
  points,
  hoverX,
  height,
  color,
}: {
  x: (v: number) => number;
  y: (v: number) => number;
  points: { x: number; y: number }[];
  hoverX: number;
  height: number;
  color: string;
}) {
  const nearest = nearestByX(points, hoverX);
  if (!nearest) return null;
  return (
    <g>
      <line className="oc-chart__crosshair" x1={x(nearest.x)} x2={x(nearest.x)} y1={0} y2={height} />
      <circle cx={x(nearest.x)} cy={y(nearest.y)} r={MARKER_RADIUS + 2} fill="var(--surface-1)" />
      <circle cx={x(nearest.x)} cy={y(nearest.y)} r={MARKER_RADIUS} fill={color} />
    </g>
  );
}

/** Axis label for a trial count: 1, 10, 100, 1K, 10K, 1M. */
function formatTickCount(n: number): string {
  if (n >= 1e9) return `${Number((n / 1e9).toPrecision(2))}B`;
  if (n >= 1e6) return `${Number((n / 1e6).toPrecision(2))}M`;
  if (n >= 1e3) return `${Number((n / 1e3).toPrecision(2))}K`;
  return String(n);
}

function nearestByX(points: { x: number; y: number }[], target: number): { x: number; y: number } | null {
  if (!points.length) return null;
  // Points are generated in ascending x, so binary search is valid.
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].x <= target) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo].x - target) <= Math.abs(points[hi].x - target) ? points[lo] : points[hi];
}

function linePath(points: { x: number; y: number }[], x: (v: number) => number, y: (v: number) => number): string {
  let d = '';
  let started = false;
  for (const p of points) {
    if (!Number.isFinite(p.y)) {
      started = false;
      continue;
    }
    d += `${started ? 'L' : 'M'}${x(p.x).toFixed(2)},${y(p.y).toFixed(2)}`;
    started = true;
  }
  return d;
}

function areaPath(points: { x: number; y: number }[], x: (v: number) => number, y: (v: number) => number, baseline: number): string {
  const finite = points.filter((p) => Number.isFinite(p.y));
  if (!finite.length) return '';
  const top = linePath(finite, x, y);
  return `${top}L${x(finite[finite.length - 1].x).toFixed(2)},${baseline}L${x(finite[0].x).toFixed(2)},${baseline}Z`;
}

function buildTableRows(series: CurveSeries[], maxRows: number): { x: number; values: (number | undefined)[] }[] {
  const xs = new Set<number>();
  for (const s of series) for (const p of s.points) xs.add(p.x);
  const sorted = [...xs].sort((a, b) => a - b);
  const stride = Math.max(1, Math.ceil(sorted.length / maxRows));
  const rows: { x: number; values: (number | undefined)[] }[] = [];
  for (let i = 0; i < sorted.length; i += stride) {
    const xv = sorted[i];
    rows.push({ x: xv, values: series.map((s) => s.points.find((p) => p.x === xv)?.y) });
  }
  return rows;
}

/* --------------------------------------------------------------- Histogram */

export function HistogramChart({
  title,
  description,
  bins,
  xLabel,
  overlay,
  height,
  note,
  onExport,
  markers,
}: {
  title: string;
  description: string;
  bins: { x0: number; x1: number; count: number; density: number; proportion: number }[];
  xLabel: string;
  /** A theoretical density curve drawn over the histogram. */
  overlay?: { label: string; points: { x: number; y: number }[] } | null;
  height?: number;
  note?: string;
  onExport?(): void;
  markers?: { x: number; label: string }[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!bins.length) {
    return (
      <ChartFrame
        title={title}
        description={description}
        xLabel={xLabel}
        yLabel="Density"
        xDomain={[0, 1]}
        yDomain={[0, 1]}
        empty={{ title: 'No simulated values yet', message: 'Run the simulation to see the distribution of outcomes.' }}
      >
        {() => null}
      </ChartFrame>
    );
  }
  const xDomain: [number, number] = [bins[0].x0, bins[bins.length - 1].x1];
  const yMax = Math.max(...bins.map((b) => b.density), ...(overlay?.points.map((p) => p.y) ?? [0]));
  const legend: LegendEntry[] = overlay
    ? [
        { label: 'Simulated outcomes', color: seriesColor(0) },
        { label: overlay.label, color: seriesColor(1), kind: 'line' },
      ]
    : [{ label: 'Simulated outcomes', color: seriesColor(0) }];

  const columns: ColumnDef<unknown>[] = [
    { key: 'range', header: 'Range', render: (r) => `${formatValue((r as { x0: number }).x0, 4)} to ${formatValue((r as { x1: number }).x1, 4)}` },
    { key: 'count', header: 'Count', numeric: true, render: (r) => (r as { count: number }).count.toLocaleString('en-US') },
    { key: 'prop', header: 'Share', numeric: true, render: (r) => formatPercent((r as { proportion: number }).proportion) },
    { key: 'density', header: 'Density', numeric: true, render: (r) => formatValue((r as { density: number }).density, 4) },
  ];

  const hovered = hover !== null ? bins[hover] : null;
  return (
    <ChartFrame
      title={title}
      description={description}
      xLabel={xLabel}
      yLabel="Density"
      xDomain={xDomain}
      yDomain={[0, yMax * 1.08]}
      height={height}
      margin={markers?.length ? { top: 28 } : undefined}
      legend={legend}
      note={note}
      table={{ columns, rows: bins, caption: `${title}: bin counts` }}
      onExport={onExport}
      tooltip={
        hovered
          ? {
              x: 0,
              y: 0,
              content: (
                <TooltipRows
                  rows={[
                    { label: 'Range', value: `${formatValue(hovered.x0, 4)} – ${formatValue(hovered.x1, 4)}` },
                    { label: 'Count', value: hovered.count.toLocaleString('en-US') },
                    { label: 'Share', value: formatPercent(hovered.proportion) },
                  ]}
                />
              ),
            }
          : null
      }
    >
      {({ x, y, height: h }) => (
        <g>
          {bins.map((b, i) => {
            const left = x(b.x0);
            const right = x(b.x1);
            const w = Math.max(1, right - left - BAR_GAP);
            const top = y(b.density);
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={left} y={0} width={Math.max(1, right - left)} height={h} fill="transparent" />
                <path
                  className="oc-chart-series"
                  d={roundedTopRect(left + BAR_GAP / 2, top, w, Math.max(0, h - top), Math.min(4, w / 2))}
                  fill={seriesColor(0)}
                  fillOpacity={hover === i ? 1 : 0.85}
                />
              </g>
            );
          })}
          {overlay && (
            <path d={linePath(overlay.points, x, y)} fill="none" stroke={seriesColor(1)} strokeWidth={2} strokeLinecap="round" />
          )}
          {/*
            Marker labels are staggered onto two rows when neighbouring markers
            are closer than the labels are wide, so they never overlap.
           */}
          {(() => {
            if (!markers?.length) return null;
            const ordered = [...markers].sort((a, b) => a.x - b.x);
            const APPROX_LABEL_WIDTH = 58;
            let lastX = -Infinity;
            let row = 0;
            return ordered.map((m, i) => {
              const px = x(m.x);
              row = px - lastX < APPROX_LABEL_WIDTH ? 1 - row : 0;
              lastX = px;
              const anchor = px < APPROX_LABEL_WIDTH / 2 ? 'start' : px > x.range[1] - APPROX_LABEL_WIDTH / 2 ? 'end' : 'middle';
              return (
                <g key={i}>
                  <line x1={px} x2={px} y1={0} y2={h} stroke={seriesColor(3)} strokeWidth={2} strokeDasharray="5 3" />
                  <text
                    className="oc-chart__tick"
                    x={px}
                    y={row === 0 ? -2 : -14}
                    textAnchor={anchor}
                    style={{ fill: 'var(--text-secondary)' }}
                  >
                    {m.label}
                  </text>
                </g>
              );
            });
          })()}
        </g>
      )}
    </ChartFrame>
  );
}

/* ------------------------------------------------------------- Convergence */

export function ConvergenceChart({
  title,
  description,
  points,
  theoretical,
  yLabel,
  height,
  onExport,
}: {
  title: string;
  description: string;
  points: { n: number; estimate: number; low: number; high: number }[];
  theoretical?: { value: number; label: string } | null;
  yLabel: string;
  height?: number;
  onExport?(): void;
}) {
  const [hover, setHover] = useState<{ x: number; px: number } | null>(null);
  if (points.length < 2) {
    return (
      <ChartFrame
        title={title}
        description={description}
        xLabel="Trials completed"
        yLabel={yLabel}
        xDomain={[0, 1]}
        yDomain={[0, 1]}
        empty={{ title: 'Not enough trials', message: 'Convergence needs at least two checkpoints. Increase the number of trials.' }}
      >
        {() => null}
      </ChartFrame>
    );
  }
  // Skip the noisiest early checkpoints when they would dominate the y axis.
  const usable = points.filter((p) => p.n >= Math.min(10, points[points.length - 1].n));
  const lows = usable.map((p) => p.low).filter(Number.isFinite);
  const highs = usable.map((p) => p.high).filter(Number.isFinite);
  const yMin = Math.min(...lows, theoretical?.value ?? Infinity);
  const yMax = Math.max(...highs, theoretical?.value ?? -Infinity);
  const pad = (yMax - yMin) * 0.12 || Math.abs(yMax) * 0.1 || 0.1;

  const columns: ColumnDef<unknown>[] = [
    { key: 'n', header: 'Trials', numeric: true, render: (r) => (r as { n: number }).n.toLocaleString('en-US') },
    { key: 'e', header: 'Estimate', numeric: true, render: (r) => formatValue((r as { estimate: number }).estimate) },
    { key: 'ci', header: '95% interval', render: (r) => `${formatValue((r as { low: number }).low, 4)} – ${formatValue((r as { high: number }).high, 4)}` },
  ];

  const hovered = hover ? usable.reduce((best, p) => (Math.abs(Math.log10(Math.max(1, p.n)) - hover.x) < Math.abs(Math.log10(Math.max(1, best.n)) - hover.x) ? p : best), usable[0]) : null;

  return (
    <ChartFrame
      title={title}
      description={description}
      xLabel="Trials completed (logarithmic scale)"
      yLabel={yLabel}
      formatXTick={(v) => formatTickCount(Math.round(Math.pow(10, v)))}
      xDomain={[Math.log10(Math.max(1, usable[0]?.n ?? 1)), Math.log10(usable[usable.length - 1]?.n ?? 10)]}
      yDomain={[yMin - pad, yMax + pad]}
      height={height}
      legend={[
        { label: 'Running estimate', color: seriesColor(0), kind: 'line' },
        { label: '95% Monte Carlo interval', color: seriesColor(0) },
        ...(theoretical ? [{ label: theoretical.label, color: seriesColor(1), kind: 'line' as const }] : []),
      ]}
      note="The x axis is logarithmic so early and late behaviour are both visible. The interval narrows roughly in proportion to 1/√n: quadrupling the trials halves its width."
      table={{ columns, rows: usable, caption: `${title}: convergence checkpoints` }}
      onExport={onExport}
      onHover={(p) => setHover(p ? { x: p.x, px: p.px } : null)}
      tooltip={
        hovered
          ? {
              x: hover!.px,
              y: 12,
              content: (
                <TooltipRows
                  rows={[
                    { label: 'Trials', value: hovered.n.toLocaleString('en-US') },
                    { label: 'Estimate', value: formatValue(hovered.estimate) },
                    { label: '95% interval', value: `${formatValue(hovered.low, 4)} – ${formatValue(hovered.high, 4)}` },
                  ]}
                />
              ),
            }
          : null
      }
    >
      {({ x, y, width, height: h }) => {
        const lx = (n: number) => x(Math.log10(Math.max(1, n)));
        const band = `${usable.map((p, i) => `${i === 0 ? 'M' : 'L'}${lx(p.n).toFixed(2)},${y(p.high).toFixed(2)}`).join('')}${[...usable]
          .reverse()
          .map((p) => `L${lx(p.n).toFixed(2)},${y(p.low).toFixed(2)}`)
          .join('')}Z`;
        return (
          <g>
            <path d={band} fill={seriesColor(0)} fillOpacity={0.14} />
            {theoretical && (
              <g>
                <line x1={0} x2={width} y1={y(theoretical.value)} y2={y(theoretical.value)} stroke={seriesColor(1)} strokeWidth={2} strokeDasharray="6 4" />
                <text className="oc-chart__tick" x={width - 4} y={y(theoretical.value) - 5} textAnchor="end" style={{ fill: 'var(--text-secondary)' }}>
                  {theoretical.label}
                </text>
              </g>
            )}
            <path
              d={usable.map((p, i) => `${i === 0 ? 'M' : 'L'}${lx(p.n).toFixed(2)},${y(p.estimate).toFixed(2)}`).join('')}
              fill="none"
              stroke={seriesColor(0)}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {hovered && (
              <g>
                <line className="oc-chart__crosshair" x1={lx(hovered.n)} x2={lx(hovered.n)} y1={0} y2={h} />
                <circle cx={lx(hovered.n)} cy={y(hovered.estimate)} r={MARKER_RADIUS + 2} fill="var(--surface-1)" />
                <circle cx={lx(hovered.n)} cy={y(hovered.estimate)} r={MARKER_RADIUS} fill={seriesColor(0)} />
              </g>
            )}
          </g>
        );
      }}
    </ChartFrame>
  );
}

/* ---------------------------------------------------------------- Tornado */

export function TornadoChart({
  title,
  description,
  entries,
  baseline,
  unit,
  height,
  onExport,
}: {
  title: string;
  description: string;
  entries: { parameterLabel: string; lowOutput: number; highOutput: number; low: number; high: number; swing: number }[];
  baseline: number;
  unit?: string;
  height?: number;
  onExport?(): void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!entries.length) {
    return (
      <ChartFrame title={title} description={description} xLabel="Output" yLabel="" xDomain={[0, 1]} yDomain={[0, 1]} empty={{ title: 'No parameters analysed', message: 'Choose at least one parameter and a range to vary it over.' }}>
        {() => null}
      </ChartFrame>
    );
  }
  const values = entries.flatMap((e) => [e.lowOutput, e.highOutput]).concat(baseline);
  const xMin = Math.min(...values);
  const xMax = Math.max(...values);
  const pad = (xMax - xMin) * 0.08 || 1;
  const rowHeight = 30;
  const chartHeight = height ?? Math.max(160, entries.length * rowHeight + 70);

  const columns: ColumnDef<unknown>[] = [
    { key: 'p', header: 'Parameter', render: (r) => (r as { parameterLabel: string }).parameterLabel },
    { key: 'lowv', header: 'Low input', numeric: true, render: (r) => formatValue((r as { low: number }).low) },
    { key: 'highv', header: 'High input', numeric: true, render: (r) => formatValue((r as { high: number }).high) },
    { key: 'lo', header: 'Output at low', numeric: true, render: (r) => formatValue((r as { lowOutput: number }).lowOutput) },
    { key: 'hi', header: 'Output at high', numeric: true, render: (r) => formatValue((r as { highOutput: number }).highOutput) },
    { key: 'sw', header: 'Swing', numeric: true, render: (r) => formatValue((r as { swing: number }).swing) },
  ];

  return (
    <ChartFrame
      title={title}
      description={description}
      xLabel={unit ? `Output (${unit})` : 'Output'}
      yLabel=""
      xDomain={[xMin - pad, xMax + pad]}
      yDomain={[entries.length, 0]}
      height={chartHeight}
      margin={{ left: 150, bottom: 44, top: 8, right: 60 }}
      legend={[
        { label: 'Output at the low value', color: seriesColor(0) },
        { label: 'Output at the high value', color: seriesColor(1) },
      ]}
      note="Bars are sorted by the size of the swing. A longer bar means the output is more sensitive to that parameter over the range you chose — a wider range always produces a longer bar."
      table={{ columns, rows: entries, caption: `${title}: parameter swings` }}
      onExport={onExport}
      tooltip={
        hover !== null
          ? {
              x: 0,
              y: 0,
              content: (
                <TooltipRows
                  rows={[
                    { label: 'Parameter', value: entries[hover].parameterLabel },
                    { label: `At ${formatValue(entries[hover].low)}`, value: formatValue(entries[hover].lowOutput) },
                    { label: `At ${formatValue(entries[hover].high)}`, value: formatValue(entries[hover].highOutput) },
                    { label: 'Swing', value: formatValue(entries[hover].swing) },
                  ]}
                />
              ),
            }
          : null
      }
    >
      {({ x, y, height: h }) => (
        <g>
          <line x1={x(baseline)} x2={x(baseline)} y1={0} y2={h} stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="4 3" />
          <text className="oc-chart__tick" x={x(baseline)} y={-1} textAnchor="middle" style={{ fill: 'var(--text-secondary)' }}>
            Baseline {formatValue(baseline, 4)}
          </text>
          {entries.map((e, i) => {
            const cy = y(i + 0.5);
            const barH = Math.min(MAX_BAR_THICKNESS, rowHeight - 10);
            const lowX = x(Math.min(e.lowOutput, e.highOutput));
            const highX = x(Math.max(e.lowOutput, e.highOutput));
            const baseX = x(baseline);
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={0} y={cy - rowHeight / 2} width={x.range[1]} height={rowHeight} fill="transparent" />
                {/* Two segments split at the baseline, separated by a 2px surface gap. */}
                <rect
                  x={lowX}
                  y={cy - barH / 2}
                  width={Math.max(0, Math.min(baseX, highX) - lowX - (lowX < baseX && highX > baseX ? BAR_GAP / 2 : 0))}
                  height={barH}
                  rx={3}
                  fill={e.lowOutput <= e.highOutput ? seriesColor(0) : seriesColor(1)}
                  fillOpacity={hover === i ? 1 : 0.88}
                />
                <rect
                  x={Math.max(baseX, lowX) + (lowX < baseX && highX > baseX ? BAR_GAP / 2 : 0)}
                  y={cy - barH / 2}
                  width={Math.max(0, highX - Math.max(baseX, lowX) - (lowX < baseX && highX > baseX ? BAR_GAP / 2 : 0))}
                  height={barH}
                  rx={3}
                  fill={e.lowOutput <= e.highOutput ? seriesColor(1) : seriesColor(0)}
                  fillOpacity={hover === i ? 1 : 0.88}
                />
                <text className="oc-chart__tick" x={-10} y={cy} dy="0.33em" textAnchor="end" style={{ fill: 'var(--text-secondary)' }}>
                  {truncate(e.parameterLabel, 20)}
                </text>
                <text className="oc-chart__tick" x={highX + 6} y={cy} dy="0.33em" style={{ fill: 'var(--text-muted)' }}>
                  {formatValue(e.swing, 3)}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </ChartFrame>
  );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/* ---------------------------------------------------------------- Scatter */

export function ScatterChart({
  title,
  description,
  points,
  xLabel,
  yLabel,
  height,
  note,
  onExport,
  trendLine,
}: {
  title: string;
  description: string;
  points: { x: number; y: number }[];
  xLabel: string;
  yLabel: string;
  height?: number;
  note?: string;
  onExport?(): void;
  trendLine?: { slope: number; intercept: number; label: string } | null;
}) {
  const MAX_DOTS = 4000;
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length) {
    return (
      <ChartFrame title={title} description={description} xLabel={xLabel} yLabel={yLabel} xDomain={[0, 1]} yDomain={[0, 1]} empty={{ title: 'No paired values', message: 'Choose two numeric columns with values in the same rows.' }}>
        {() => null}
      </ChartFrame>
    );
  }
  const shown = points.length > MAX_DOTS ? points.filter((_, i) => i % Math.ceil(points.length / MAX_DOTS) === 0) : points;
  const xs = shown.map((p) => p.x);
  const ys = shown.map((p) => p.y);
  const xPad = (Math.max(...xs) - Math.min(...xs)) * 0.05 || 1;
  const yPad = (Math.max(...ys) - Math.min(...ys)) * 0.05 || 1;
  const columns: ColumnDef<unknown>[] = [
    { key: 'x', header: xLabel, numeric: true, render: (r) => formatValue((r as { x: number }).x) },
    { key: 'y', header: yLabel, numeric: true, render: (r) => formatValue((r as { y: number }).y) },
  ];
  return (
    <ChartFrame
      title={title}
      description={description}
      xLabel={xLabel}
      yLabel={yLabel}
      xDomain={[Math.min(...xs) - xPad, Math.max(...xs) + xPad]}
      yDomain={[Math.min(...ys) - yPad, Math.max(...ys) + yPad]}
      height={height}
      note={note ?? (shown.length < points.length ? `Showing ${shown.length.toLocaleString('en-US')} of ${points.length.toLocaleString('en-US')} points, sampled evenly. All values remain in the table view and the CSV export.` : undefined)}
      table={{ columns, rows: shown.slice(0, 500), caption: `${title}: paired values` }}
      onExport={onExport}
      tooltip={
        hover !== null
          ? {
              x: 0,
              y: 0,
              content: <TooltipRows rows={[{ label: xLabel, value: formatValue(shown[hover].x) }, { label: yLabel, value: formatValue(shown[hover].y) }]} />,
            }
          : null
      }
    >
      {({ x, y, width }) => (
        <g>
          {shown.map((p, i) => (
            <circle
              key={i}
              cx={x(p.x)}
              cy={y(p.y)}
              r={shown.length > 1500 ? 1.8 : shown.length > 400 ? 2.6 : 3.4}
              fill={seriesColor(0)}
              fillOpacity={shown.length > 800 ? 0.35 : 0.65}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
          {trendLine && (
            <g>
              <line
                x1={0}
                x2={width}
                y1={y(trendLine.intercept + trendLine.slope * x.domain[0])}
                y2={y(trendLine.intercept + trendLine.slope * x.domain[1])}
                stroke={seriesColor(1)}
                strokeWidth={2}
                strokeDasharray="6 4"
              />
            </g>
          )}
        </g>
      )}
    </ChartFrame>
  );
}

/* ---------------------------------------------------------------- Heatmap */

export function HeatmapChart({
  title,
  description,
  rows,
  columns: colLabels,
  values,
  height,
  valueLabel,
  diverging,
  onExport,
}: {
  title: string;
  description: string;
  rows: string[];
  columns: string[];
  /** values[rowIndex][colIndex] */
  values: number[][];
  height?: number;
  valueLabel: string;
  /** Use the diverging ramp with a neutral midpoint at zero. */
  diverging?: boolean;
  onExport?(): void;
}) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const flat = values.flat().filter(Number.isFinite);
  if (!flat.length) {
    return (
      <ChartFrame title={title} description={description} xLabel="" yLabel="" xDomain={[0, 1]} yDomain={[0, 1]} empty={{ title: 'No values to show', message: 'The matrix is empty or contains no finite numbers.' }}>
        {() => null}
      </ChartFrame>
    );
  }
  const maxAbs = Math.max(...flat.map(Math.abs));
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const cellH = 28;
  const chartHeight = height ?? Math.max(140, rows.length * cellH + 80);
  const color = (v: number) => {
    if (!Number.isFinite(v)) return 'var(--surface-3)';
    if (diverging) {
      const t = maxAbs > 0 ? v / maxAbs : 0;
      // Two-hue diverging ramp with a neutral grey midpoint.
      return t >= 0
        ? `color-mix(in srgb, var(--div-high) ${Math.round(Math.abs(t) * 100)}%, var(--div-mid))`
        : `color-mix(in srgb, var(--div-low) ${Math.round(Math.abs(t) * 100)}%, var(--div-mid))`;
    }
    const t = max > min ? (v - min) / (max - min) : 0.5;
    // Single-hue sequential ramp, light → dark.
    return `color-mix(in srgb, var(--seq-700) ${Math.round(t * 100)}%, var(--seq-100))`;
  };
  const tableColumns: ColumnDef<unknown>[] = [
    { key: 'row', header: '', render: (r) => (r as { label: string }).label },
    ...colLabels.map((c, ci) => ({ key: `c${ci}`, header: c, numeric: true, render: (r: unknown) => formatValue((r as { values: number[] }).values[ci], 4) })),
  ];
  const tableRows = rows.map((label, ri) => ({ label, values: values[ri] ?? [] }));
  return (
    <ChartFrame
      title={title}
      description={description}
      xLabel=""
      yLabel=""
      xDomain={[0, colLabels.length]}
      yDomain={[rows.length, 0]}
      height={chartHeight}
      margin={{ left: 120, right: 20, top: 30, bottom: 40 }}
      note={`${diverging ? 'Blue to red through a neutral grey midpoint at zero' : 'Light to dark in a single hue'}. Exact values are in the table view; the colour is a visual aid, not the data.`}
      table={{ columns: tableColumns, rows: tableRows, caption: `${title}: values` }}
      onExport={onExport}
      tooltip={
        hover
          ? {
              x: 0,
              y: 0,
              content: (
                <TooltipRows
                  rows={[
                    { label: 'Row', value: rows[hover.r] },
                    { label: 'Column', value: colLabels[hover.c] },
                    { label: valueLabel, value: formatValue(values[hover.r]?.[hover.c] ?? NaN, 4) },
                  ]}
                />
              ),
            }
          : null
      }
    >
      {({ x, y }) => {
        const cw = x(1) - x(0);
        const ch = y(0) - y(1);
        return (
          <g>
            {rows.map((rLabel, ri) => (
              <g key={ri}>
                <text className="oc-chart__tick" x={-8} y={y(ri + 0.5)} dy="0.33em" textAnchor="end" style={{ fill: 'var(--text-secondary)' }}>
                  {truncate(rLabel, 16)}
                </text>
                {colLabels.map((_, ci) => {
                  const v = values[ri]?.[ci];
                  return (
                    <g key={ci} onMouseEnter={() => setHover({ r: ri, c: ci })} onMouseLeave={() => setHover(null)}>
                      <rect
                        x={x(ci) + 1}
                        y={y(ri + 1) + 1}
                        width={Math.max(1, cw - 2)}
                        height={Math.max(1, ch - 2)}
                        rx={3}
                        fill={color(v ?? NaN)}
                        stroke={hover?.r === ri && hover?.c === ci ? 'var(--text-primary)' : 'none'}
                        strokeWidth={1.5}
                      />
                      {cw > 42 && ch > 18 && Number.isFinite(v) && (
                        <text
                          x={x(ci) + cw / 2}
                          y={y(ri + 0.5)}
                          dy="0.33em"
                          textAnchor="middle"
                          style={{ fontSize: 10.5, fill: pickInk(v!, diverging ? maxAbs : max, diverging), fontVariantNumeric: 'tabular-nums' }}
                        >
                          {formatValue(v!, 2)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            ))}
            {colLabels.map((c, ci) => (
              <text key={ci} className="oc-chart__tick" x={x(ci + 0.5)} y={-10} textAnchor="middle" style={{ fill: 'var(--text-secondary)' }}>
                {truncate(c, 10)}
              </text>
            ))}
          </g>
        );
      }}
    </ChartFrame>
  );
}

/** Choose white or dark ink inside a filled cell so the label always has contrast. */
function pickInk(value: number, scale: number, diverging?: boolean): string {
  const intensity = scale > 0 ? Math.abs(value) / scale : 0;
  if (diverging) return intensity > 0.55 ? '#ffffff' : 'var(--text-primary)';
  return intensity > 0.5 ? '#ffffff' : '#11141a';
}
