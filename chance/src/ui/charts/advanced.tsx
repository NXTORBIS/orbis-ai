/**
 * Advanced chart components: survival/step curves, fan charts, box plots,
 * ROC and precision–recall curves, Q–Q and P–P plots, correlograms, layered
 * network graphs, decision trees, reliability diagrams and risk/return
 * frontiers.
 *
 * Every chart here follows the same contract as `charts.tsx`:
 *  - it receives computed values and never computes a statistic itself
 *    (the only arithmetic below is layout geometry, which is the chart's job),
 *  - it is built on `ChartFrame`, so it gets axes, a legend, a tooltip, the
 *    "Show values" table alternative and CSV export for free,
 *  - identity is never carried by colour alone: every chart has a legend, and
 *    essential distinctions also use shape, dash pattern or stroke weight,
 *  - non-finite values are filtered out and the omission is stated in the note
 *    rather than being silently drawn as zero,
 *  - every hook runs unconditionally; empty states are returned only after all
 *    hooks have run, so hook order can never change between renders.
 *
 * Mark specs follow the project's visualisation rules: bars at most 24px thick
 * with a 2px surface gap and 4px rounded data-ends, 2px lines, markers at
 * least 8px across with a 2px surface ring, area fills at ~10% opacity,
 * hairline solid gridlines, and selective direct labels.
 */
import { useId, useMemo, useState } from 'react';
import { ChartFrame, TooltipRows, type LegendEntry } from './ChartFrame';
import { downsample, formatPercent, formatValue, seriesColor } from './scale';
import type { ColumnDef } from '../primitives';

const MAX_BAR_THICKNESS = 24;
const BAR_GAP = 2;
const MARKER_RADIUS = 4;
const MAX_DRAWN_POINTS = 1200;

/* ------------------------------------------------------- Numeric guards */

/**
 * Every number that reaches an SVG attribute passes through here. A domain of
 * ±1e308, a single point or a NaN mixed into real data has previously reached
 * the DOM as `x="NaN"`, which silently removes the mark; a finite fallback
 * keeps the geometry drawable and wrong-looking rather than absent.
 */
function px(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Fixed-precision coordinate for path data. Never emits NaN or Infinity. */
function svgNum(value: number, fallback = 0): string {
  return px(value, fallback).toFixed(2);
}

/** Tooltip/table number. Non-finite values are shown as missing, not as 0. */
function val(value: number | undefined | null, digits = 6): string {
  return value !== undefined && value !== null && Number.isFinite(value) ? formatValue(value, digits) : '—';
}

/** Percentage for a proportion in [0, 1]; missing when not finite. */
function pct(value: number | undefined | null): string {
  return value !== undefined && value !== null && Number.isFinite(value) ? formatPercent(value) : '—';
}

/** Integer count with thousands separators; missing when not finite. */
function count(value: number | undefined | null): string {
  return value !== undefined && value !== null && Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—';
}

/** Finite extent of a set of numbers, or null when none are finite. */
function extent(values: number[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

/**
 * Pad a finite extent for drawing. A span that overflows to Infinity (for
 * example −1e308 to 1e308) is left unpadded rather than becoming non-finite.
 */
function padDomain(ext: [number, number] | null, frac = 0.06, fallback: [number, number] = [0, 1]): [number, number] {
  if (!ext) return fallback;
  const [min, max] = ext;
  if (min === max) {
    const p = Math.abs(min) > 0 ? Math.abs(min) * 0.05 : 0.5;
    return [px(min - p, fallback[0]), px(max + p, fallback[1])];
  }
  const span = max - min;
  const p = Number.isFinite(span) ? span * frac : 0;
  return [px(min - p, min), px(max + p, max)];
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Rough advance width of a label, for sizing boxes to their text. */
function estimateTextWidth(text: string, fontSize = 12): number {
  return text.length * fontSize * 0.58;
}

/** A note fragment naming how many values were dropped as non-finite. */
function omittedNote(omitted: number, what: string): string | null {
  if (omitted <= 0) return null;
  return `${count(omitted)} ${what} ${omitted === 1 ? 'was' : 'were'} not a finite number and ${omitted === 1 ? 'is' : 'are'} not drawn.`;
}

function joinNotes(parts: (string | null | undefined)[]): string | undefined {
  const kept = parts.filter((p): p is string => typeof p === 'string' && p.length > 0);
  return kept.length ? kept.join(' ') : undefined;
}

/** Sanitised `useId` output, safe inside an `id` attribute and `url(#…)`. */
function useDomId(prefix: string): string {
  const raw = useId();
  return `${prefix}-${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

type Scale = (value: number) => number;

/* ------------------------------------------------------------- StepChart */

export interface StepBandPoint {
  x: number;
  lower: number;
  upper: number;
}

export interface StepSeries {
  label: string;
  /** Sorted by x. Each point starts a new constant level (right-continuous). */
  points: { x: number; y: number }[];
  /** Pointwise confidence band, drawn as a stepped shaded region. */
  band?: StepBandPoint[];
  /** x positions of censored observations, marked with a small vertical tick. */
  censored?: number[];
  /** Dashed, so the series is distinguishable without colour. */
  dashed?: boolean;
}

/**
 * Right-continuous step path: hold the previous level until the next x, then
 * jump. Emitted as explicit `H`/`V` commands so the shape is unambiguous.
 */
export function stepPath(points: { x: number; y: number }[], x: Scale, y: Scale): string {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) return '';
  let d = `M${svgNum(x(pts[0].x))},${svgNum(y(pts[0].y))}`;
  for (let i = 1; i < pts.length; i++) {
    d += `H${svgNum(x(pts[i].x))}V${svgNum(y(pts[i].y))}`;
  }
  return d;
}

/** Stepped closed region between an upper and a lower level. */
export function steppedBandPath(band: StepBandPoint[], x: Scale, y: Scale): string {
  const pts = band.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.lower) && Number.isFinite(p.upper));
  if (!pts.length) return '';
  let d = `M${svgNum(x(pts[0].x))},${svgNum(y(pts[0].upper))}`;
  for (let i = 1; i < pts.length; i++) {
    d += `H${svgNum(x(pts[i].x))}V${svgNum(y(pts[i].upper))}`;
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    d += `V${svgNum(y(pts[i].lower))}`;
    if (i > 0) d += `H${svgNum(x(pts[i - 1].x))}`;
  }
  return `${d}Z`;
}

/** Level of a right-continuous step function at `target`. */
function stepLevelAt(points: { x: number; y: number }[], target: number): number | null {
  let level: number | null = null;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x <= target) level = p.y;
    else break;
  }
  return level;
}

export function StepChart({
  title,
  description,
  series,
  xLabel,
  yLabel,
  height,
  yDomain: yDomainOverride,
  referenceLines,
  note,
  onExport,
}: {
  title: string;
  description: string;
  series: StepSeries[];
  xLabel: string;
  yLabel: string;
  height?: number;
  /** Overrides the default domain, which is [0, 1] for a probability curve. */
  yDomain?: [number, number];
  referenceLines?: { value: number; label: string; axis: 'x' | 'y' }[];
  note?: string;
  onExport?(): void;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<{ x: number; px: number } | null>(null);

  const prepared = useMemo(
    () =>
      series.map((s) => {
        const finite = s.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        const { points: drawn, reduced } = downsample(finite, MAX_DRAWN_POINTS, (p) => p.y);
        const band = (s.band ?? []).filter((b) => Number.isFinite(b.x) && Number.isFinite(b.lower) && Number.isFinite(b.upper));
        const censored = (s.censored ?? []).filter(Number.isFinite);
        return { label: s.label, dashed: s.dashed, all: finite, drawn, reduced, band, censored, omitted: s.points.length - finite.length };
      }),
    [series],
  );

  const visible = prepared.filter((s) => !hidden.has(s.label));
  const allPoints = visible.flatMap((s) => s.all);
  const omitted = prepared.reduce((n, s) => n + s.omitted, 0);
  const anyReduced = visible.some((s) => s.reduced);

  const xDomain = useMemo(() => padDomain(extent(allPoints.map((p) => p.x)), 0.02), [allPoints]);
  const yDomain = useMemo(() => {
    if (yDomainOverride) return yDomainOverride;
    const ys = visible.flatMap((s) => [...s.all.map((p) => p.y), ...s.band.flatMap((b) => [b.lower, b.upper])]);
    const ext = extent(ys);
    // A probability or survival curve reads correctly only against the full
    // [0, 1] range; anything else gets a padded data domain.
    if (!ext || (ext[0] >= 0 && ext[1] <= 1)) return [0, 1] as [number, number];
    return padDomain(ext, 0.06);
  }, [visible, yDomainOverride]);

  const legend: LegendEntry[] = prepared.map((s, i) => ({
    label: s.label,
    color: seriesColor(i),
    kind: 'line' as const,
    visible: !hidden.has(s.label),
    onToggle:
      prepared.length > 1
        ? () =>
            setHidden((prev) => {
              const next = new Set(prev);
              if (next.has(s.label)) next.delete(s.label);
              else if (next.size < prepared.length - 1) next.add(s.label);
              return next;
            })
        : undefined,
  }));

  const hoverRows = useMemo(() => {
    if (!hover) return null;
    const rows = [{ label: xLabel, value: val(hover.x) }];
    for (const s of visible) {
      const level = stepLevelAt(s.all, hover.x);
      rows.push({ label: s.label, value: level === null ? '—' : val(level, 4) });
      const b = s.band.filter((p) => p.x <= hover.x).pop();
      if (b) rows.push({ label: `${s.label} interval`, value: `${val(b.lower, 4)} – ${val(b.upper, 4)}` });
    }
    return rows;
  }, [hover, visible, xLabel]);

  const columns: ColumnDef<unknown>[] = useMemo(
    () => [
      { key: 'series', header: 'Series', render: (r) => (r as { series: string }).series },
      { key: 'x', header: xLabel, numeric: true, render: (r) => val((r as { x: number }).x) },
      { key: 'y', header: yLabel, numeric: true, render: (r) => val((r as { y: number }).y, 4) },
      { key: 'band', header: 'Interval', render: (r) => { const row = r as { lower?: number; upper?: number }; return row.lower === undefined ? '—' : `${val(row.lower, 4)} – ${val(row.upper, 4)}`; } },
      { key: 'cens', header: 'Censored here', render: (r) => ((r as { censored: boolean }).censored ? 'yes' : '') },
    ],
    [xLabel, yLabel],
  );

  const tableRows = useMemo(
    () =>
      prepared.flatMap((s) =>
        s.all.slice(0, 400).map((p) => {
          const b = s.band.find((q) => q.x === p.x);
          return { series: s.label, x: p.x, y: p.y, lower: b?.lower, upper: b?.upper, censored: s.censored.includes(p.x) };
        }),
      ),
    [prepared],
  );

  // Every hook above runs unconditionally; the empty state is returned only
  // once they have, so hook order is stable across renders.
  if (!allPoints.length) {
    return (
      <ChartFrame
        title={title}
        description={description}
        xLabel={xLabel}
        yLabel={yLabel}
        xDomain={[0, 1]}
        yDomain={[0, 1]}
        height={height}
        empty={{ title: 'No step curve to draw', message: 'Supply at least one series with finite x and y values — for example a survival estimate at each event time.' }}
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
      xDomain={xDomain}
      yDomain={yDomain}
      height={height}
      legend={legend}
      note={joinNotes([
        note,
        'The curve is right-continuous: each level is held until the next event, where it steps.',
        omittedNote(omitted, 'point'),
        anyReduced ? 'The curve is drawn from a reduced set of points; the full values are in the table view.' : null,
      ])}
      table={{ columns, rows: tableRows, caption: `${title}: step levels` }}
      onExport={onExport}
      onHover={(p) => setHover(p ? { x: p.x, px: p.px } : null)}
      tooltip={hover && hoverRows ? { x: hover.px, y: 12, content: <TooltipRows rows={hoverRows} /> } : null}
    >
      {({ x, y, width, height: h }) => (
        <g>
          {referenceLines?.filter((r) => Number.isFinite(r.value)).map((r, i) =>
            r.axis === 'y' ? (
              <g key={`ref-${i}`}>
                <line x1={0} x2={width} y1={px(y(r.value))} y2={px(y(r.value))} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="4 3" />
                <text className="oc-chart__tick" x={width - 4} y={px(y(r.value)) - 4} textAnchor="end" style={{ fill: 'var(--text-secondary)' }}>
                  {r.label}
                </text>
              </g>
            ) : (
              <g key={`ref-${i}`}>
                <line x1={px(x(r.value))} x2={px(x(r.value))} y1={0} y2={h} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="4 3" />
                <text className="oc-chart__tick" x={px(x(r.value)) + 4} y={12} style={{ fill: 'var(--text-secondary)' }}>
                  {r.label}
                </text>
              </g>
            ),
          )}

          {visible.map((s) => {
            const colorIndex = prepared.findIndex((o) => o.label === s.label);
            const color = seriesColor(colorIndex);
            return (
              <g key={s.label} className="oc-chart-series" data-series={s.label}>
                {s.band.length > 0 && <path d={steppedBandPath(s.band, x, y)} fill={color} fillOpacity={0.1} />}
                <path
                  data-role="step-line"
                  d={stepPath(s.drawn, x, y)}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinejoin="miter"
                  strokeDasharray={s.dashed ? '6 4' : undefined}
                />
                {/* Censoring ticks: a short vertical mark at the current level. */}
                {s.censored.map((cx, ci) => {
                  const level = stepLevelAt(s.all, cx);
                  if (level === null) return null;
                  const cy = px(y(level));
                  return (
                    <line
                      key={`cens-${ci}`}
                      data-role="censor-tick"
                      x1={px(x(cx))}
                      x2={px(x(cx))}
                      y1={cy - 5}
                      y2={cy + 5}
                      stroke={color}
                      strokeWidth={2}
                      strokeLinecap="butt"
                    />
                  );
                })}
              </g>
            );
          })}
        </g>
      )}
    </ChartFrame>
  );
}

/* -------------------------------------------------------------- FanChart */

export interface FanBand {
  label: string;
  lower: number[];
  upper: number[];
}

/**
 * The two readings a fan chart can carry. They are different statements and
 * the project's rules forbid conflating them, so the caller must say which it
 * is — there is deliberately no default.
 */
export type BandMeaning = 'paths' | 'mean-uncertainty';

const BAND_CAPTIONS: Record<BandMeaning, string> = {
  paths:
    'Each band contains the stated share of simulated paths. An individual path can leave and re-enter a band, so a band is not a range for any single outcome sequence.',
  'mean-uncertainty':
    'Each band is a confidence interval for the mean path. It describes uncertainty about the average, not the spread of individual simulated paths, which is wider.',
};

export function FanChart({
  title,
  description,
  x: xValues,
  bands,
  center,
  bandMeaning,
  observed,
  forecastStart,
  xLabel,
  yLabel,
  height,
  note,
  onExport,
}: {
  title: string;
  description: string;
  /** Shared x positions for every band and the central line. */
  x: number[];
  /** Outermost first; opacity increases toward the centre. */
  bands: FanBand[];
  center: { label: string; values: number[] };
  /** Required: says what the bands mean. There is no safe default. */
  bandMeaning: BandMeaning;
  /** Historical series, drawn with a distinct dash up to `forecastStart`. */
  observed?: { label: string; points: { x: number; y: number }[] } | null;
  /** x value where the forecast begins; marked with a vertical divider. */
  forecastStart?: number | null;
  xLabel: string;
  yLabel: string;
  height?: number;
  note?: string;
  onExport?(): void;
}) {
  const [hover, setHover] = useState<{ x: number; px: number } | null>(null);

  const prepared = useMemo(() => {
    const idx: number[] = [];
    for (let i = 0; i < xValues.length; i++) if (Number.isFinite(xValues[i])) idx.push(i);
    const xs = idx.map((i) => xValues[i]);
    const centerPts = idx
      .map((i) => ({ x: xValues[i], y: center.values[i] }))
      .filter((p) => Number.isFinite(p.y));
    const bandPaths = bands.map((b) => ({
      label: b.label,
      points: idx
        .map((i) => ({ x: xValues[i], lower: b.lower[i], upper: b.upper[i] }))
        .filter((p) => Number.isFinite(p.lower) && Number.isFinite(p.upper)),
    }));
    const obs = (observed?.points ?? [])
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .filter((p) => forecastStart === null || forecastStart === undefined || !Number.isFinite(forecastStart) || p.x <= forecastStart);
    const omitted = xValues.length - xs.length + (center.values.length - centerPts.length);
    return { xs, centerPts, bandPaths, obs, omitted: Math.max(0, omitted) };
  }, [xValues, bands, center.values, observed, forecastStart]);

  const xDomain = useMemo(
    () => padDomain(extent([...prepared.xs, ...prepared.obs.map((p) => p.x)]), 0.02),
    [prepared],
  );
  const yDomain = useMemo(
    () =>
      padDomain(
        extent([
          ...prepared.centerPts.map((p) => p.y),
          ...prepared.bandPaths.flatMap((b) => b.points.flatMap((p) => [p.lower, p.upper])),
          ...prepared.obs.map((p) => p.y),
        ]),
        0.08,
      ),
    [prepared],
  );

  const legend: LegendEntry[] = useMemo(
    () => [
      ...(prepared.obs.length ? [{ label: observed?.label ?? 'Observed', color: seriesColor(2), kind: 'line' as const }] : []),
      { label: center.label, color: seriesColor(0), kind: 'line' as const },
      ...bands.map((b) => ({ label: b.label, color: seriesColor(0), kind: 'area' as const })),
    ],
    [bands, center.label, observed, prepared.obs.length],
  );

  const hoverRows = useMemo(() => {
    if (!hover || !prepared.xs.length) return null;
    let best = 0;
    for (let i = 1; i < prepared.xs.length; i++) {
      if (Math.abs(prepared.xs[i] - hover.x) < Math.abs(prepared.xs[best] - hover.x)) best = i;
    }
    const at = prepared.xs[best];
    const rows = [{ label: xLabel, value: val(at) }];
    const c = prepared.centerPts.find((p) => p.x === at);
    rows.push({ label: center.label, value: val(c?.y, 4) });
    for (const b of prepared.bandPaths) {
      const p = b.points.find((q) => q.x === at);
      rows.push({ label: b.label, value: p ? `${val(p.lower, 4)} – ${val(p.upper, 4)}` : '—' });
    }
    return rows;
  }, [hover, prepared, xLabel, center.label]);

  const columns: ColumnDef<unknown>[] = useMemo(
    () => [
      { key: 'x', header: xLabel, numeric: true, render: (r) => val((r as { x: number }).x) },
      { key: 'c', header: center.label, numeric: true, render: (r) => val((r as { c?: number }).c, 4) },
      ...bands.map((b, i) => ({
        key: `b${i}`,
        header: b.label,
        render: (r: unknown) => {
          const row = (r as { bands: ({ lower: number; upper: number } | undefined)[] }).bands[i];
          return row ? `${val(row.lower, 4)} – ${val(row.upper, 4)}` : '—';
        },
      })),
    ],
    [xLabel, center.label, bands],
  );

  const tableRows = useMemo(
    () =>
      prepared.xs.slice(0, 400).map((xv) => ({
        x: xv,
        c: prepared.centerPts.find((p) => p.x === xv)?.y,
        bands: prepared.bandPaths.map((b) => b.points.find((p) => p.x === xv)),
      })),
    [prepared],
  );

  if (!prepared.centerPts.length && !prepared.bandPaths.some((b) => b.points.length)) {
    return (
      <ChartFrame
        title={title}
        description={description}
        xLabel={xLabel}
        yLabel={yLabel}
        xDomain={[0, 1]}
        yDomain={[0, 1]}
        height={height}
        empty={{ title: 'No ensemble to draw', message: 'Supply matching x positions with at least one quantile band or a central path.' }}
      >
        {() => null}
      </ChartFrame>
    );
  }

  const divider = forecastStart !== null && forecastStart !== undefined && Number.isFinite(forecastStart) ? forecastStart : null;

  return (
    <ChartFrame
      title={title}
      description={`${description} ${BAND_CAPTIONS[bandMeaning]}`}
      xLabel={xLabel}
      yLabel={yLabel}
      xDomain={xDomain}
      yDomain={yDomain}
      height={height}
      legend={legend}
      note={joinNotes([BAND_CAPTIONS[bandMeaning], note, omittedNote(prepared.omitted, 'value')])}
      table={{ columns, rows: tableRows, caption: `${title}: quantile bands` }}
      onExport={onExport}
      onHover={(p) => setHover(p ? { x: p.x, px: p.px } : null)}
      tooltip={hover && hoverRows ? { x: hover.px, y: 12, content: <TooltipRows rows={hoverRows} /> } : null}
    >
      {({ x, y, height: h }) => (
        <g>
          {/* Outermost band is faintest; opacity increases toward the centre. */}
          {prepared.bandPaths.map((b, i) => (
            <path
              key={`band-${i}`}
              data-role="fan-band"
              d={bandAreaPath(b.points, x, y)}
              fill={seriesColor(0)}
              fillOpacity={Math.min(0.28, 0.1 + i * 0.06)}
            />
          ))}

          {divider !== null && (
            <g>
              <line data-role="forecast-divider" x1={px(x(divider))} x2={px(x(divider))} y1={0} y2={h} stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="4 3" />
              <text className="oc-chart__tick" x={px(x(divider)) + 4} y={12} style={{ fill: 'var(--text-secondary)' }}>
                Forecast begins
              </text>
            </g>
          )}

          {prepared.obs.length > 0 && (
            <path
              data-role="observed-line"
              d={plainLinePath(prepared.obs, x, y)}
              fill="none"
              stroke={seriesColor(2)}
              strokeWidth={2}
              strokeDasharray="2 3"
              strokeLinejoin="round"
            />
          )}

          <path data-role="center-line" d={plainLinePath(prepared.centerPts, x, y)} fill="none" stroke={seriesColor(0)} strokeWidth={2} strokeLinejoin="round" />
        </g>
      )}
    </ChartFrame>
  );
}

function plainLinePath(points: { x: number; y: number }[], x: Scale, y: Scale): string {
  let d = '';
  let started = false;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      started = false;
      continue;
    }
    d += `${started ? 'L' : 'M'}${svgNum(x(p.x))},${svgNum(y(p.y))}`;
    started = true;
  }
  return d;
}

function bandAreaPath(points: { x: number; lower: number; upper: number }[], x: Scale, y: Scale): string {
  if (!points.length) return '';
  const up = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${svgNum(x(p.x))},${svgNum(y(p.upper))}`).join('');
  const down = [...points].reverse().map((p) => `L${svgNum(x(p.x))},${svgNum(y(p.lower))}`).join('');
  return `${up}${down}Z`;
}

/* --------------------------------------------------------------- BoxPlot */

export interface BoxGroup {
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers?: number[];
  mean?: number;
  n?: number;
  /** Median confidence interval; drawn as a notch when both ends are given. */
  medianLower?: number;
  medianUpper?: number;
}

export function BoxPlot({
  title,
  description,
  groups,
  valueLabel,
  groupLabel,
  orientation = 'vertical',
  height,
  note,
  onExport,
}: {
  title: string;
  description: string;
  groups: BoxGroup[];
  valueLabel: string;
  groupLabel: string;
  orientation?: 'vertical' | 'horizontal';
  height?: number;
  note?: string;
  onExport?(): void;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const prepared = useMemo(
    () =>
      groups
        .filter((g) => [g.min, g.q1, g.median, g.q3, g.max].every(Number.isFinite))
        .map((g) => ({ ...g, outliers: (g.outliers ?? []).filter(Number.isFinite) })),
    [groups],
  );
  const omitted = groups.length - prepared.length;

  const valueDomain = useMemo(
    () => padDomain(extent(prepared.flatMap((g) => [g.min, g.max, ...g.outliers, ...(Number.isFinite(g.mean ?? NaN) ? [g.mean as number] : [])])), 0.08),
    [prepared],
  );

  const columns: ColumnDef<unknown>[] = useMemo(
    () => [
      { key: 'g', header: groupLabel, render: (r) => (r as BoxGroup).label },
      { key: 'n', header: 'n', numeric: true, render: (r) => count((r as BoxGroup).n) },
      { key: 'min', header: 'Minimum', numeric: true, render: (r) => val((r as BoxGroup).min, 4) },
      { key: 'q1', header: 'Lower quartile', numeric: true, render: (r) => val((r as BoxGroup).q1, 4) },
      { key: 'med', header: 'Median', numeric: true, render: (r) => val((r as BoxGroup).median, 4) },
      { key: 'q3', header: 'Upper quartile', numeric: true, render: (r) => val((r as BoxGroup).q3, 4) },
      { key: 'max', header: 'Maximum', numeric: true, render: (r) => val((r as BoxGroup).max, 4) },
      { key: 'mean', header: 'Mean', numeric: true, render: (r) => val((r as BoxGroup).mean, 4) },
      { key: 'out', header: 'Outliers', render: (r) => { const o = (r as BoxGroup).outliers ?? []; return o.length ? o.map((v) => val(v, 3)).join(', ') : '—'; } },
    ],
    [groupLabel],
  );

  const hovered = hover !== null ? prepared[hover] ?? null : null;

  if (!prepared.length) {
    return (
      <ChartFrame
        title={title}
        description={description}
        xLabel={orientation === 'vertical' ? groupLabel : valueLabel}
        yLabel={orientation === 'vertical' ? valueLabel : groupLabel}
        xDomain={[0, 1]}
        yDomain={[0, 1]}
        height={height}
        empty={{ title: 'No groups to compare', message: 'Each group needs a finite minimum, lower quartile, median, upper quartile and maximum.' }}
      >
        {() => null}
      </ChartFrame>
    );
  }

  const vertical = orientation === 'vertical';
  const chartHeight = px(height ?? (vertical ? 300 : Math.max(180, prepared.length * 38 + 80)), 300);

  return (
    <ChartFrame
      title={title}
      description={description}
      xLabel={vertical ? groupLabel : valueLabel}
      yLabel={vertical ? valueLabel : groupLabel}
      xDomain={vertical ? [0, prepared.length] : valueDomain}
      yDomain={vertical ? valueDomain : [prepared.length, 0]}
      height={chartHeight}
      margin={vertical ? { bottom: 56 } : { left: 130, bottom: 44 }}
      legend={[
        { label: 'Interquartile range (box)', color: seriesColor(0), kind: 'area' },
        { label: 'Median (thick line)', color: seriesColor(0), kind: 'line' },
        { label: 'Mean (diamond marker)', color: seriesColor(1), kind: 'dot' },
        { label: 'Outlier (ring marker)', color: seriesColor(3), kind: 'dot' },
      ]}
      note={joinNotes([
        note,
        'Whiskers run to the minimum and maximum supplied by the caller, not to a 1.5×IQR rule; outliers are the values the caller marked as such.',
        omittedNote(omitted, 'group'),
      ])}
      table={{ columns, rows: prepared, caption: `${title}: five-number summaries` }}
      onExport={onExport}
      tooltip={
        hovered
          ? {
              x: 0,
              y: 0,
              content: (
                <TooltipRows
                  rows={[
                    { label: groupLabel, value: hovered.label },
                    { label: 'n', value: count(hovered.n) },
                    { label: 'Median', value: val(hovered.median, 4) },
                    { label: 'Quartiles', value: `${val(hovered.q1, 4)} – ${val(hovered.q3, 4)}` },
                    { label: 'Range', value: `${val(hovered.min, 4)} – ${val(hovered.max, 4)}` },
                    { label: 'Mean', value: val(hovered.mean, 4) },
                  ]}
                />
              ),
            }
          : null
      }
    >
      {({ x, y, width, height: h }) => {
        const cross = vertical ? x : y;
        const value = vertical ? y : x;
        const slotSize = Math.abs(px(cross(1)) - px(cross(0))) || 30;
        const boxThickness = Math.min(MAX_BAR_THICKNESS, Math.max(6, slotSize - 12));
        return (
          <g>
            {prepared.map((g, i) => {
              const c = px(cross(i + 0.5));
              const vMin = px(value(g.min));
              const vMax = px(value(g.max));
              const vQ1 = px(value(g.q1));
              const vQ3 = px(value(g.q3));
              const vMed = px(value(g.median));
              const notchLo = Number.isFinite(g.medianLower ?? NaN) ? px(value(g.medianLower as number)) : null;
              const notchHi = Number.isFinite(g.medianUpper ?? NaN) ? px(value(g.medianUpper as number)) : null;
              const boxLo = Math.min(vQ1, vQ3);
              const boxHi = Math.max(vQ1, vQ3);
              const boxLen = Math.max(1, boxHi - boxLo);
              const label = `${truncate(g.label, vertical ? 12 : 16)}${g.n !== undefined && Number.isFinite(g.n) ? ` (n=${count(g.n)})` : ''}`;
              return (
                <g key={`${g.label}-${i}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} data-group={g.label}>
                  {/* Hover target covering the whole slot. */}
                  {vertical ? (
                    <rect x={c - slotSize / 2} y={0} width={Math.max(1, slotSize)} height={Math.max(1, h)} fill="transparent" />
                  ) : (
                    <rect x={0} y={c - slotSize / 2} width={Math.max(1, width)} height={Math.max(1, slotSize)} fill="transparent" />
                  )}

                  {/* Whiskers, with end caps. */}
                  {vertical ? (
                    <g>
                      <line x1={c} x2={c} y1={vMin} y2={boxHi} stroke={seriesColor(0)} strokeWidth={1.5} />
                      <line x1={c} x2={c} y1={boxLo} y2={vMax} stroke={seriesColor(0)} strokeWidth={1.5} />
                      <line x1={c - boxThickness / 4} x2={c + boxThickness / 4} y1={vMin} y2={vMin} stroke={seriesColor(0)} strokeWidth={1.5} />
                      <line x1={c - boxThickness / 4} x2={c + boxThickness / 4} y1={vMax} y2={vMax} stroke={seriesColor(0)} strokeWidth={1.5} />
                    </g>
                  ) : (
                    <g>
                      <line x1={vMin} x2={boxLo} y1={c} y2={c} stroke={seriesColor(0)} strokeWidth={1.5} />
                      <line x1={boxHi} x2={vMax} y1={c} y2={c} stroke={seriesColor(0)} strokeWidth={1.5} />
                      <line x1={vMin} x2={vMin} y1={c - boxThickness / 4} y2={c + boxThickness / 4} stroke={seriesColor(0)} strokeWidth={1.5} />
                      <line x1={vMax} x2={vMax} y1={c - boxThickness / 4} y2={c + boxThickness / 4} stroke={seriesColor(0)} strokeWidth={1.5} />
                    </g>
                  )}

                  {/* The box itself, 4px rounded data-ends. */}
                  <rect
                    data-role="box"
                    x={vertical ? c - boxThickness / 2 : boxLo}
                    y={vertical ? boxLo : c - boxThickness / 2}
                    width={Math.max(1, vertical ? boxThickness : boxLen)}
                    height={Math.max(1, vertical ? boxLen : boxThickness)}
                    rx={4}
                    fill={seriesColor(0)}
                    fillOpacity={hover === i ? 0.34 : 0.18}
                    stroke={seriesColor(0)}
                    strokeWidth={1.5}
                  />

                  {/* Median confidence notch, when supplied. */}
                  {notchLo !== null && notchHi !== null && (
                    <rect
                      data-role="median-notch"
                      x={vertical ? c - boxThickness / 4 : Math.min(notchLo, notchHi)}
                      y={vertical ? Math.min(notchLo, notchHi) : c - boxThickness / 4}
                      width={Math.max(1, vertical ? boxThickness / 2 : Math.abs(notchHi - notchLo))}
                      height={Math.max(1, vertical ? Math.abs(notchHi - notchLo) : boxThickness / 2)}
                      rx={2}
                      fill={seriesColor(0)}
                      fillOpacity={0.3}
                    />
                  )}

                  {/* Median: a thick line, so it reads without colour. */}
                  <line
                    data-role="median"
                    x1={vertical ? c - boxThickness / 2 : vMed}
                    x2={vertical ? c + boxThickness / 2 : vMed}
                    y1={vertical ? vMed : c - boxThickness / 2}
                    y2={vertical ? vMed : c + boxThickness / 2}
                    stroke={seriesColor(0)}
                    strokeWidth={3}
                    strokeLinecap="butt"
                  />

                  {/* Mean: a diamond, a different shape rather than a colour. */}
                  {Number.isFinite(g.mean ?? NaN) && (
                    <g data-role="mean">
                      <path d={diamondPath(vertical ? c : px(value(g.mean as number)), vertical ? px(value(g.mean as number)) : c, MARKER_RADIUS + 2.5)} fill="var(--surface)" />
                      <path d={diamondPath(vertical ? c : px(value(g.mean as number)), vertical ? px(value(g.mean as number)) : c, MARKER_RADIUS)} fill={seriesColor(1)} />
                    </g>
                  )}

                  {/* Outliers: open ring markers with a 2px surface ring. */}
                  {g.outliers.map((o, oi) => {
                    const ov = px(value(o));
                    return (
                      <g key={`out-${oi}`} data-role="outlier" data-value={String(Number.isFinite(o) ? o : '')}>
                        <circle cx={vertical ? c : ov} cy={vertical ? ov : c} r={MARKER_RADIUS + 1} fill="var(--surface)" />
                        <circle cx={vertical ? c : ov} cy={vertical ? ov : c} r={MARKER_RADIUS - 0.5} fill="none" stroke={seriesColor(3)} strokeWidth={2} />
                      </g>
                    );
                  })}

                  {/* Group label, carrying n so the sample size is always visible. */}
                  {vertical ? (
                    <text className="oc-chart__tick" x={c} y={h + 16} textAnchor="middle" style={{ fill: 'var(--text-secondary)' }}>
                      {label}
                    </text>
                  ) : (
                    <text className="oc-chart__tick" x={-10} y={c} dy="0.33em" textAnchor="end" style={{ fill: 'var(--text-secondary)' }}>
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      }}
    </ChartFrame>
  );
}

function diamondPath(cx: number, cy: number, r: number): string {
  const x = px(cx);
  const y = px(cy);
  const rr = Math.max(1, px(r, 4));
  return `M${svgNum(x)},${svgNum(y - rr)}L${svgNum(x + rr)},${svgNum(y)}L${svgNum(x)},${svgNum(y + rr)}L${svgNum(x - rr)},${svgNum(y)}Z`;
}

/* ------------------------------------------------- ROC / precision–recall */

export interface RocCurve {
  label: string;
  points: { fpr: number; tpr: number }[];
  /** Computed by the caller. The chart never computes a statistic. */
  auc: number;
  dashed?: boolean;
}

export function RocChart({
  title,
  description,
  curves,
  height,
  note,
  onExport,
}: {
  title: string;
  description: string;
  curves: RocCurve[];
  height?: number;
  note?: string;
  onExport?(): void;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const prepared = useMemo(
    () =>
      curves.map((c) => {
        const pts = c.points
          .filter((p) => Number.isFinite(p.fpr) && Number.isFinite(p.tpr))
          .map((p) => ({ x: p.fpr, y: p.tpr }))
          .sort((a, b) => a.x - b.x || a.y - b.y);
        return { label: c.label, auc: c.auc, dashed: c.dashed, points: pts, omitted: c.points.length - pts.length };
      }),
    [curves],
  );
  const omitted = prepared.reduce((n, c) => n + c.omitted, 0);
  const drawable = prepared.filter((c) => c.points.length > 0);

  const columns: ColumnDef<unknown>[] = useMemo(
    () => [
      { key: 'c', header: 'Curve', render: (r) => (r as { curve: string }).curve },
      { key: 'fpr', header: 'False positive rate', numeric: true, render: (r) => val((r as { x: number }).x, 4) },
      { key: 'tpr', header: 'True positive rate', numeric: true, render: (r) => val((r as { y: number }).y, 4) },
    ],
    [],
  );
  const tableRows = useMemo(() => drawable.flatMap((c) => c.points.slice(0, 400).map((p) => ({ curve: c.label, x: p.x, y: p.y }))), [drawable]);

  if (!drawable.length) {
    return (
      <ChartFrame
        title={title}
        description={description}
        xLabel="False positive rate"
        yLabel="True positive rate"
        xDomain={[0, 1]}
        yDomain={[0, 1]}
        height={height}
        empty={{ title: 'No ROC curve to draw', message: 'Supply at least one curve of finite false-positive / true-positive rate pairs, together with its AUC.' }}
      >
        {() => null}
      </ChartFrame>
    );
  }

  const hovered = hover !== null ? drawable[hover] ?? null : null;

  return (
    <ChartFrame
      title={title}
      description={description}
      xLabel="False positive rate"
      yLabel="True positive rate"
      xDomain={[0, 1]}
      yDomain={[0, 1]}
      height={height ?? 320}
      legend={[
        ...drawable.map((c, i) => ({ label: `${c.label} — AUC ${val(c.auc, 4)}`, color: seriesColor(i), kind: 'line' as const })),
        { label: 'No better than chance (dashed diagonal)', color: 'var(--text-muted)', kind: 'line' as const },
      ]}
      note={joinNotes([note, 'The area under the curve is supplied by the caller; this chart draws it and does not recompute it.', omittedNote(omitted, 'point')])}
      table={{ columns, rows: tableRows, caption: `${title}: operating points` }}
      onExport={onExport}
      tooltip={
        hovered
          ? { x: 0, y: 0, content: <TooltipRows rows={[{ label: 'Curve', value: hovered.label }, { label: 'AUC', value: val(hovered.auc, 4) }, { label: 'Operating points', value: count(hovered.points.length) }]} /> }
          : null
      }
    >
      {({ x, y, width, height: h }) => (
        <g>
          {/* Area under the first curve at ~10% opacity. */}
          <path d={underCurvePath(drawable[0].points, x, y, h)} fill={seriesColor(0)} fillOpacity={0.1} />

          {/* The chance diagonal, dashed and labelled. */}
          <line data-role="chance-diagonal" x1={px(x(0))} x2={px(x(1))} y1={px(y(0))} y2={px(y(1))} stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="5 4" />
          <text className="oc-chart__tick" x={px(x(0.62))} y={px(y(0.56))} style={{ fill: 'var(--text-muted)' }}>
            no better than chance
          </text>

          {drawable.map((c, i) => (
            <g key={c.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <path
                data-role="roc-curve"
                d={plainLinePath(c.points, x, y)}
                fill="none"
                stroke={seriesColor(i)}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={i === 1 ? '7 4' : i === 2 ? '2 3' : c.dashed ? '4 3' : undefined}
              />
            </g>
          ))}

          {/* AUC stated in the chart, not only in the legend. */}
          {drawable.map((c, i) => (
            <text
              key={`auc-${c.label}`}
              className="oc-chart__tick"
              x={Math.max(0, px(width) - 6)}
              y={px(h) - 8 - i * 15}
              textAnchor="end"
              style={{ fill: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}
            >
              {`${truncate(c.label, 18)}: AUC ${val(c.auc, 4)}`}
            </text>
          ))}
        </g>
      )}
    </ChartFrame>
  );
}

export interface PrecisionRecallCurve {
  label: string;
  points: { recall: number; precision: number }[];
  /** Average precision / area under the PR curve, computed by the caller. */
  auc: number;
  dashed?: boolean;
}

export function PrecisionRecallChart({
  title,
  description,
  curves,
  prevalence,
  height,
  note,
  onExport,
}: {
  title: string;
  description: string;
  curves: PrecisionRecallCurve[];
  /** Positive-class prevalence, supplied by the caller; the chance baseline. */
  prevalence: number;
  height?: number;
  note?: string;
  onExport?(): void;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const prepared = useMemo(
    () =>
      curves.map((c) => {
        const pts = c.points
          .filter((p) => Number.isFinite(p.recall) && Number.isFinite(p.precision))
          .map((p) => ({ x: p.recall, y: p.precision }))
          .sort((a, b) => a.x - b.x);
        return { label: c.label, auc: c.auc, dashed: c.dashed, points: pts, omitted: c.points.length - pts.length };
      }),
    [curves],
  );
  const omitted = prepared.reduce((n, c) => n + c.omitted, 0);
  const drawable = prepared.filter((c) => c.points.length > 0);

  const columns: ColumnDef<unknown>[] = useMemo(
    () => [
      { key: 'c', header: 'Curve', render: (r) => (r as { curve: string }).curve },
      { key: 'r', header: 'Recall', numeric: true, render: (r) => val((r as { x: number }).x, 4) },
      { key: 'p', header: 'Precision', numeric: true, render: (r) => val((r as { y: number }).y, 4) },
    ],
    [],
  );
  const tableRows = useMemo(() => drawable.flatMap((c) => c.points.slice(0, 400).map((p) => ({ curve: c.label, x: p.x, y: p.y }))), [drawable]);

  if (!drawable.length) {
    return (
      <ChartFrame
        title={title}
        description={description}
        xLabel="Recall"
        yLabel="Precision"
        xDomain={[0, 1]}
        yDomain={[0, 1]}
        height={height}
        empty={{ title: 'No precision–recall curve to draw', message: 'Supply at least one curve of finite recall / precision pairs, together with its average precision.' }}
      >
        {() => null}
      </ChartFrame>
    );
  }

  const hovered = hover !== null ? drawable[hover] ?? null : null;
  const baseline = Number.isFinite(prevalence) ? prevalence : null;

  return (
    <ChartFrame
      title={title}
      description={description}
      xLabel="Recall"
      yLabel="Precision"
      xDomain={[0, 1]}
      yDomain={[0, 1]}
      height={height ?? 320}
      legend={[
        ...drawable.map((c, i) => ({ label: `${c.label} — AP ${val(c.auc, 4)}`, color: seriesColor(i), kind: 'line' as const })),
        { label: 'Positive-class prevalence (dashed baseline)', color: 'var(--text-muted)', kind: 'line' as const },
      ]}
      note={joinNotes([
        note,
        baseline === null
          ? 'No prevalence was supplied, so the chance baseline is not drawn.'
          : `The dashed baseline is the positive-class prevalence (${pct(baseline)}), which is what a constant-positive classifier achieves.`,
        omittedNote(omitted, 'point'),
      ])}
      table={{ columns, rows: tableRows, caption: `${title}: operating points` }}
      onExport={onExport}
      tooltip={
        hovered
          ? { x: 0, y: 0, content: <TooltipRows rows={[{ label: 'Curve', value: hovered.label }, { label: 'Average precision', value: val(hovered.auc, 4) }, { label: 'Prevalence', value: pct(baseline) }]} /> }
          : null
      }
    >
      {({ x, y, width, height: h }) => (
        <g>
          <path d={underCurvePath(drawable[0].points, x, y, h)} fill={seriesColor(0)} fillOpacity={0.1} />
          {baseline !== null && (
            <g>
              <line data-role="prevalence-baseline" x1={0} x2={px(width)} y1={px(y(baseline))} y2={px(y(baseline))} stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="5 4" />
              <text className="oc-chart__tick" x={4} y={px(y(baseline)) - 5} style={{ fill: 'var(--text-muted)' }}>
                {`prevalence ${pct(baseline)}`}
              </text>
            </g>
          )}
          {drawable.map((c, i) => (
            <g key={c.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <path
                data-role="pr-curve"
                d={plainLinePath(c.points, x, y)}
                fill="none"
                stroke={seriesColor(i)}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeDasharray={i === 1 ? '7 4' : i === 2 ? '2 3' : undefined}
              />
            </g>
          ))}
          {drawable.map((c, i) => (
            <text
              key={`ap-${c.label}`}
              className="oc-chart__tick"
              x={Math.max(0, px(width) - 6)}
              y={px(h) - 8 - i * 15}
              textAnchor="end"
              style={{ fill: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}
            >
              {`${truncate(c.label, 18)}: AP ${val(c.auc, 4)}`}
            </text>
          ))}
        </g>
      )}
    </ChartFrame>
  );
}

function underCurvePath(points: { x: number; y: number }[], x: Scale, y: Scale, baseline: number): string {
  const finite = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!finite.length) return '';
  const top = plainLinePath(finite, x, y);
  return `${top}L${svgNum(x(finite[finite.length - 1].x))},${svgNum(baseline)}L${svgNum(x(finite[0].x))},${svgNum(baseline)}Z`;
}

/* --------------------------------------------------------- Q–Q and P–P */

export interface QuantilePoint {
  theoretical: number;
  sample: number;
}

export interface QuantileEnvelopePoint {
  theoretical: number;
  lower: number;
  upper: number;
}

export function QQChart({
  title,
  description,
  points,
  referenceLine,
  envelope,
  xLabel = 'Theoretical quantile',
  yLabel = 'Sample quantile',
  equalAspect = true,
  height,
  note,
  onExport,
}: {
  title: string;
  description: string;
  points: QuantilePoint[];
  /** Dashed reference, e.g. the fitted or identity line. */
  referenceLine?: { slope: number; intercept: number; label: string } | null;
  /** Bootstrap envelope, drawn as a shaded band at ~10% opacity. */
  envelope?: QuantileEnvelopePoint[] | null;
  xLabel?: string;
  yLabel?: string;
  /** Share one domain between both axes so the reference line reads at 45°. */
  equalAspect?: boolean;
  height?: number;
  note?: string;
  onExport?(): void;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const prepared = useMemo(() => points.filter((p) => Number.isFinite(p.theoretical) && Number.isFinite(p.sample)), [points]);
  const band = useMemo(
    () => (envelope ?? []).filter((p) => Number.isFinite(p.theoretical) && Number.isFinite(p.lower) && Number.isFinite(p.upper)).sort((a, b) => a.theoretical - b.theoretical),
    [envelope],
  );
  const omitted = points.length - prepared.length;

  const domains = useMemo(() => {
    const tExt = extent([...prepared.map((p) => p.theoretical), ...band.map((p) => p.theoretical)]);
    const sExt = extent([...prepared.map((p) => p.sample), ...band.flatMap((p) => [p.lower, p.upper])]);
    if (equalAspect && tExt && sExt) {
      const shared = extent([tExt[0], tExt[1], sExt[0], sExt[1]]);
      const d = padDomain(shared, 0.06);
      return { x: d, y: d };
    }
    return { x: padDomain(tExt, 0.06), y: padDomain(sExt, 0.06) };
  }, [prepared, band, equalAspect]);

  const columns: ColumnDef<unknown>[] = useMemo(
    () => [
      { key: 't', header: xLabel, numeric: true, render: (r) => val((r as QuantilePoint).theoretical, 4) },
      { key: 's', header: yLabel, numeric: true, render: (r) => val((r as QuantilePoint).sample, 4) },
    ],
    [xLabel, yLabel],
  );

  const hovered = hover !== null ? prepared[hover] ?? null : null;

  if (!prepared.length) {
    return (
      <ChartFrame
        title={title}
        description={description}
        xLabel={xLabel}
        yLabel={yLabel}
        xDomain={[0, 1]}
        yDomain={[0, 1]}
        height={height}
        empty={{ title: 'No quantile pairs to plot', message: 'Supply pairs of theoretical and sample quantiles with finite values.' }}
      >
        {() => null}
      </ChartFrame>
    );
  }

  const r = Math.max(2.4, prepared.length > 600 ? 2 : prepared.length > 200 ? 2.8 : 3.4);

  return (
    <ChartFrame
      title={title}
      description={description}
      xLabel={xLabel}
      yLabel={yLabel}
      xDomain={domains.x}
      yDomain={domains.y}
      height={height ?? 320}
      legend={[
        { label: 'Quantile pairs', color: seriesColor(0), kind: 'dot' },
        ...(referenceLine ? [{ label: `${referenceLine.label} (dashed)`, color: seriesColor(1), kind: 'line' as const }] : []),
        ...(band.length ? [{ label: 'Bootstrap envelope', color: seriesColor(1), kind: 'area' as const }] : []),
      ]}
      note={joinNotes([
        note,
        equalAspect ? 'Both axes share one range, so agreement with the reference line reads as a 45° alignment.' : null,
        omittedNote(omitted, 'quantile pair'),
      ])}
      table={{ columns, rows: prepared.slice(0, 500), caption: `${title}: quantile pairs` }}
      onExport={onExport}
      tooltip={
        hovered
          ? { x: 0, y: 0, content: <TooltipRows rows={[{ label: xLabel, value: val(hovered.theoretical, 5) }, { label: yLabel, value: val(hovered.sample, 5) }]} /> }
          : null
      }
    >
      {({ x, y }) => (
        <g>
          {band.length > 0 && (
            <path
              data-role="qq-envelope"
              d={bandAreaPath(band.map((p) => ({ x: p.theoretical, lower: p.lower, upper: p.upper })), x, y)}
              fill={seriesColor(1)}
              fillOpacity={0.1}
            />
          )}

          {referenceLine && Number.isFinite(referenceLine.slope) && Number.isFinite(referenceLine.intercept) && (
            <line
              data-role="qq-reference"
              x1={px(x(domains.x[0]))}
              x2={px(x(domains.x[1]))}
              y1={px(y(referenceLine.intercept + referenceLine.slope * domains.x[0]))}
              y2={px(y(referenceLine.intercept + referenceLine.slope * domains.x[1]))}
              stroke={seriesColor(1)}
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          )}

          {prepared.map((p, i) => (
            <circle
              key={i}
              data-role="qq-point"
              cx={px(x(p.theoretical))}
              cy={px(y(p.sample))}
              r={r}
              fill={seriesColor(0)}
              fillOpacity={prepared.length > 400 ? 0.4 : 0.7}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </g>
      )}
    </ChartFrame>
  );
}

/**
 * Probability–probability plot. The same structure as a Q–Q plot, but both
 * axes are cumulative probabilities, so the domain is fixed to [0, 1].
 */
export function PpChart({
  title,
  description,
  points,
  referenceLine = { slope: 1, intercept: 0, label: 'Perfect agreement' },
  envelope,
  height,
  note,
  onExport,
}: {
  title: string;
  description: string;
  points: QuantilePoint[];
  referenceLine?: { slope: number; intercept: number; label: string } | null;
  envelope?: QuantileEnvelopePoint[] | null;
  height?: number;
  note?: string;
  onExport?(): void;
}) {
  return (
    <QQChart
      title={title}
      description={description}
      points={points}
      referenceLine={referenceLine}
      envelope={envelope}
      xLabel="Theoretical cumulative probability"
      yLabel="Empirical cumulative probability"
      equalAspect
      height={height}
      note={note}
      onExport={onExport}
    />
  );
}

/* -------------------------------------------------------------- AcfChart */

export interface AcfPoint {
  lag: number;
  value: number;
}

export function AcfChart({
  title,
  description,
  data,
  bounds,
  yLabel = 'Autocorrelation',
  height,
  note,
  onExport,
}: {
  title: string;
  description: string;
  data: AcfPoint[];
  /** Symmetric significance bound: one value, or one per lag. */
  bounds: number | { lag: number; bound: number }[];
  yLabel?: string;
  height?: number;
  note?: string;
  onExport?(): void;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const boundAt = useMemo(() => {
    if (typeof bounds === 'number') {
      const b = Number.isFinite(bounds) ? Math.abs(bounds) : null;
      return (_lag: number) => b;
    }
    const map = new Map<number, number>();
    for (const b of bounds) if (Number.isFinite(b.lag) && Number.isFinite(b.bound)) map.set(b.lag, Math.abs(b.bound));
    return (lag: number) => map.get(lag) ?? null;
  }, [bounds]);

  const prepared = useMemo(
    () =>
      data
        .filter((d) => Number.isFinite(d.lag) && Number.isFinite(d.value))
        .sort((a, b) => a.lag - b.lag)
        .map((d) => {
          const bound = boundAt(d.lag);
          return { ...d, bound, significant: bound !== null && Math.abs(d.value) > bound };
        }),
    [data, boundAt],
  );
  const omitted = data.length - prepared.length;

  const xDomain = useMemo(() => {
    const ext = extent(prepared.map((d) => d.lag));
    if (!ext) return [0, 1] as [number, number];
    return [Math.min(0, ext[0]) - 0.6, ext[1] + 0.6] as [number, number];
  }, [prepared]);

  const yDomain = useMemo(() => {
    const vals = prepared.flatMap((d) => [d.value, ...(d.bound !== null ? [d.bound, -d.bound] : [])]);
    const ext = extent(vals);
    if (!ext) return [-1, 1] as [number, number];
    const m = Math.max(Math.abs(ext[0]), Math.abs(ext[1]));
    const limit = Number.isFinite(m) && m > 0 ? Math.min(1.05, m * 1.15) : 1;
    return [-limit, limit] as [number, number];
  }, [prepared]);

  const columns: ColumnDef<unknown>[] = useMemo(
    () => [
      { key: 'lag', header: 'Lag', numeric: true, render: (r) => count((r as { lag: number }).lag) },
      { key: 'v', header: yLabel, numeric: true, render: (r) => val((r as { value: number }).value, 4) },
      { key: 'b', header: 'Significance bound', numeric: true, render: (r) => val((r as { bound: number | null }).bound ?? undefined, 4) },
      { key: 's', header: 'Beyond the bound', render: (r) => ((r as { significant: boolean }).significant ? 'yes' : 'no') },
    ],
    [yLabel],
  );

  const hovered = hover !== null ? prepared[hover] ?? null : null;

  if (!prepared.length) {
    return (
      <ChartFrame
        title={title}
        description={description}
        xLabel="Lag"
        yLabel={yLabel}
        xDomain={[0, 1]}
        yDomain={[-1, 1]}
        height={height}
        empty={{ title: 'No correlogram to draw', message: 'Supply one finite correlation value per lag, together with the significance bound used to judge them.' }}
      >
        {() => null}
      </ChartFrame>
    );
  }

  const significantCount = prepared.filter((d) => d.significant).length;

  return (
    <ChartFrame
      title={title}
      description={description}
      xLabel="Lag"
      yLabel={yLabel}
      xDomain={xDomain}
      yDomain={yDomain}
      xIntegerTicks
      height={height ?? 260}
      legend={[
        { label: 'Within the bound (round marker)', color: seriesColor(0), kind: 'dot' },
        { label: 'Beyond the bound (square marker, heavier stem)', color: seriesColor(1), kind: 'dot' },
        { label: 'Significance bound (dashed band)', color: 'var(--text-muted)', kind: 'line' },
      ]}
      note={joinNotes([
        note,
        `${count(significantCount)} of ${count(prepared.length)} lags lie beyond the significance bound; they are drawn with a square marker and a heavier stem as well as a different colour.`,
        omittedNote(omitted, 'lag'),
      ])}
      table={{ columns, rows: prepared, caption: `${title}: correlation by lag` }}
      onExport={onExport}
      tooltip={
        hovered
          ? {
              x: 0,
              y: 0,
              content: (
                <TooltipRows
                  rows={[
                    { label: 'Lag', value: count(hovered.lag) },
                    { label: yLabel, value: val(hovered.value, 4) },
                    { label: 'Bound', value: val(hovered.bound ?? undefined, 4) },
                    { label: 'Beyond the bound', value: hovered.significant ? 'yes' : 'no' },
                  ]}
                />
              ),
            }
          : null
      }
    >
      {({ x, y, width, height: h }) => {
        const constantBound = typeof bounds === 'number' && Number.isFinite(bounds) ? Math.abs(bounds) : null;
        const perLag = prepared.filter((d) => d.bound !== null).map((d) => ({ x: d.lag, lower: -(d.bound as number), upper: d.bound as number }));
        return (
          <g>
            {/* Significance band: a constant bound as two dashed rules, a
                per-lag bound as a dashed stepped band. */}
            {constantBound !== null ? (
              <g data-role="acf-bound">
                <line x1={0} x2={px(width)} y1={px(y(constantBound))} y2={px(y(constantBound))} stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="5 4" />
                <line x1={0} x2={px(width)} y1={px(y(-constantBound))} y2={px(y(-constantBound))} stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="5 4" />
              </g>
            ) : (
              perLag.length > 0 && (
                <path data-role="acf-bound" d={bandAreaPath(perLag, x, y)} fill="var(--text-muted)" fillOpacity={0.1} stroke="var(--text-muted)" strokeWidth={1.2} strokeDasharray="5 4" />
              )
            )}

            {/* Solid zero line. */}
            <line data-role="acf-zero" x1={0} x2={px(width)} y1={px(y(0))} y2={px(y(0))} stroke="var(--text-muted)" strokeWidth={1.5} />

            {prepared.map((d, i) => {
              const cx = px(x(d.lag));
              const cy = px(y(d.value));
              const zero = px(y(0));
              const color = d.significant ? seriesColor(1) : seriesColor(0);
              return (
                <g
                  key={d.lag}
                  data-role="acf-stem"
                  data-lag={String(d.lag)}
                  data-significant={d.significant ? 'true' : 'false'}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <rect x={cx - 6} y={0} width={12} height={Math.max(1, px(h))} fill="transparent" />
                  <line x1={cx} x2={cx} y1={zero} y2={cy} stroke={color} strokeWidth={d.significant ? 2.5 : 1.4} strokeLinecap="butt" />
                  {/* Shape, not colour, carries significance. */}
                  {d.significant ? (
                    <g>
                      <rect x={cx - (MARKER_RADIUS + 1.5)} y={cy - (MARKER_RADIUS + 1.5)} width={(MARKER_RADIUS + 1.5) * 2} height={(MARKER_RADIUS + 1.5) * 2} fill="var(--surface)" rx={1} />
                      <rect x={cx - MARKER_RADIUS} y={cy - MARKER_RADIUS} width={MARKER_RADIUS * 2} height={MARKER_RADIUS * 2} fill={color} rx={1} />
                    </g>
                  ) : (
                    <g>
                      <circle cx={cx} cy={cy} r={MARKER_RADIUS + 1.5} fill="var(--surface)" />
                      <circle cx={cx} cy={cy} r={MARKER_RADIUS} fill={color} />
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        );
      }}
    </ChartFrame>
  );
}

/* ---------------------------------------------------------- NetworkGraph */

export interface GraphNode {
  id: string;
  label: string;
  /** Explicit layer; when omitted the layer is the longest path from a root. */
  layer?: number;
  group?: string;
  /** Small secondary label, e.g. a node's current probability or state. */
  badge?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  emphasis?: boolean;
}

export interface LaidOutGraphNode {
  id: string;
  label: string;
  group?: string;
  badge?: string;
  layer: number;
  order: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutGraphEdge {
  from: string;
  to: string;
  label?: string;
  emphasis: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface NetworkLayout {
  nodes: LaidOutGraphNode[];
  edges: LaidOutGraphEdge[];
  width: number;
  height: number;
  /** Edges naming a node that does not exist; reported, never drawn. */
  danglingEdges: number;
  /** True when the input is not acyclic and layering had to be forced. */
  cyclic: boolean;
}

const NODE_HEIGHT = 38;
const NODE_MIN_WIDTH = 72;
const NODE_MAX_WIDTH = 168;
const LAYER_GAP = 56;
const ROW_GAP = 16;

/**
 * Layer assignment by longest path from the roots, computed iteratively with
 * Kahn's algorithm so a deep graph cannot overflow the stack. An explicit
 * `layer` on a node overrides the computed value. A cyclic input still gets a
 * layering (the remaining nodes are placed after their known predecessors) and
 * is flagged rather than looping forever.
 */
export function assignNetworkLayers(nodes: GraphNode[], edges: GraphEdge[]): { layers: Map<string, number>; cyclic: boolean } {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) {
    out.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    out.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }

  const layer = new Map<string, number>();
  for (const n of nodes) layer.set(n.id, 0);

  // Queue seeded in input order, so the result never depends on Map ordering
  // beyond the order the caller gave.
  const queue: string[] = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const remaining = new Map(indeg);
  let visited = 0;
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    visited++;
    for (const v of out.get(u) ?? []) {
      layer.set(v, Math.max(layer.get(v) ?? 0, (layer.get(u) ?? 0) + 1));
      const left = (remaining.get(v) ?? 0) - 1;
      remaining.set(v, left);
      if (left === 0) queue.push(v);
    }
  }

  const cyclic = visited < nodes.length;
  if (cyclic) {
    // Nodes inside a cycle never reach the queue. Give them one pass in input
    // order so they still land after their visited predecessors.
    for (const n of nodes) {
      if (queue.includes(n.id)) continue;
      for (const v of out.get(n.id) ?? []) {
        layer.set(v, Math.max(layer.get(v) ?? 0, (layer.get(n.id) ?? 0) + 1));
      }
    }
  }

  for (const n of nodes) {
    if (n.layer !== undefined && Number.isFinite(n.layer)) layer.set(n.id, Math.max(0, Math.round(n.layer)));
  }
  return { layers: layer, cyclic };
}

/**
 * Deterministic layered (Sugiyama-style) layout: layer assignment, then a
 * small number of barycentre sweeps to reduce edge crossings, then even
 * positioning. The same input always produces byte-identical output — there is
 * no randomness and no dependence on iteration order of a hash map.
 */
export function layoutNetwork(nodes: GraphNode[], edges: GraphEdge[], sweeps = 4): NetworkLayout {
  const ids = new Set(nodes.map((n) => n.id));
  const usable = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const danglingEdges = edges.length - usable.length;
  if (!nodes.length) return { nodes: [], edges: [], width: 1, height: 1, danglingEdges, cyclic: false };

  const { layers, cyclic } = assignNetworkLayers(nodes, usable);
  const maxLayer = nodes.reduce((m, n) => Math.max(m, layers.get(n.id) ?? 0), 0);

  // Buckets in input order.
  const buckets: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of nodes) buckets[layers.get(n.id) ?? 0].push(n.id);

  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const n of nodes) {
    preds.set(n.id, []);
    succs.set(n.id, []);
  }
  for (const e of usable) {
    succs.get(e.from)!.push(e.to);
    preds.get(e.to)!.push(e.from);
  }

  const ordered = buckets.map((b) => [...b]);
  for (let s = 0; s < Math.max(0, sweeps); s++) {
    const position = new Map<string, number>();
    for (const bucket of ordered) bucket.forEach((id, i) => position.set(id, i));
    const forward = s % 2 === 0;
    const sequence = forward ? ordered.map((_, i) => i) : ordered.map((_, i) => ordered.length - 1 - i);
    for (const li of sequence) {
      const neighbours = forward ? preds : succs;
      const bucket = ordered[li];
      const keyed = bucket.map((id, i) => {
        const ns = (neighbours.get(id) ?? []).map((m) => position.get(m)).filter((p): p is number => p !== undefined);
        const bary = ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : i;
        return { id, i, bary };
      });
      // Stable sort with explicit tie-breaks keeps the layout deterministic.
      keyed.sort((a, b) => a.bary - b.bary || a.i - b.i || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      ordered[li] = keyed.map((k) => k.id);
      ordered[li].forEach((id, i) => position.set(id, i));
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const widthOf = (n: GraphNode) =>
    Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, Math.round(estimateTextWidth(n.label) + (n.badge ? estimateTextWidth(n.badge, 10) : 0) + 26)));
  const layerWidths = ordered.map((bucket) => bucket.reduce((m, id) => Math.max(m, widthOf(byId.get(id)!)), NODE_MIN_WIDTH));
  const layerX: number[] = [];
  let cursor = 0;
  for (let i = 0; i < layerWidths.length; i++) {
    layerX.push(cursor);
    cursor += layerWidths[i] + LAYER_GAP;
  }
  const rows = ordered.reduce((m, b) => Math.max(m, b.length), 1);
  const totalHeight = rows * NODE_HEIGHT + (rows - 1) * ROW_GAP;
  const totalWidth = Math.max(1, cursor - LAYER_GAP);

  const laidOut: LaidOutGraphNode[] = [];
  const nodeById = new Map<string, LaidOutGraphNode>();
  ordered.forEach((bucket, li) => {
    const n = bucket.length;
    const blockHeight = n * NODE_HEIGHT + (n - 1) * ROW_GAP;
    const top = (totalHeight - blockHeight) / 2;
    bucket.forEach((id, oi) => {
      const src = byId.get(id)!;
      const w = widthOf(src);
      const node: LaidOutGraphNode = {
        id,
        label: src.label,
        group: src.group,
        badge: src.badge,
        layer: li,
        order: oi,
        x: px(layerX[li] + (layerWidths[li] - w) / 2),
        y: px(top + oi * (NODE_HEIGHT + ROW_GAP)),
        width: w,
        height: NODE_HEIGHT,
      };
      laidOut.push(node);
      nodeById.set(id, node);
    });
  });

  const laidOutEdges: LaidOutGraphEdge[] = usable.map((e) => {
    const a = nodeById.get(e.from)!;
    const b = nodeById.get(e.to)!;
    // Leave the source on its right edge and arrive on the target's left edge
    // when the target is to the right; otherwise connect centre to centre.
    const forward = b.x >= a.x + a.width;
    return {
      from: e.from,
      to: e.to,
      label: e.label,
      emphasis: e.emphasis === true,
      x1: px(forward ? a.x + a.width : a.x + a.width / 2),
      y1: px(a.y + a.height / 2),
      x2: px(forward ? b.x : b.x + b.width / 2),
      y2: px(b.y + b.height / 2),
    };
  });

  return { nodes: laidOut, edges: laidOutEdges, width: totalWidth, height: Math.max(1, totalHeight), danglingEdges, cyclic };
}

export function NetworkGraph({
  title,
  description,
  nodes,
  edges,
  highlight,
  highlightLabel = 'Highlighted nodes',
  height,
  note,
  onExport,
}: {
  title: string;
  description: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Node ids to emphasise, e.g. evidence nodes or an active path. */
  highlight?: string[];
  highlightLabel?: string;
  height?: number;
  note?: string;
  onExport?(): void;
}) {
  const arrowId = useDomId('oc-arrow');
  const arrowEmphId = useDomId('oc-arrow-emph');
  const hatchId = useDomId('oc-hatch');
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => layoutNetwork(nodes, edges), [nodes, edges]);
  const highlighted = useMemo(() => new Set(highlight ?? []), [highlight]);

  const columns: ColumnDef<unknown>[] = useMemo(
    () => [
      { key: 'kind', header: 'Kind', render: (r) => (r as { kind: string }).kind },
      { key: 'a', header: 'Node or source', render: (r) => (r as { a: string }).a },
      { key: 'b', header: 'Target', render: (r) => (r as { b: string }).b },
      { key: 'layer', header: 'Layer', numeric: true, render: (r) => { const v = (r as { layer?: number }).layer; return v === undefined ? '—' : count(v); } },
      { key: 'extra', header: 'Badge or label', render: (r) => (r as { extra: string }).extra },
      { key: 'mark', header: 'Highlighted', render: (r) => ((r as { mark: boolean }).mark ? 'yes' : '') },
    ],
    [],
  );

  const tableRows = useMemo(
    () => [
      ...layout.nodes.map((n) => ({ kind: 'Node', a: n.label, b: '', layer: n.layer, extra: n.badge ?? n.group ?? '', mark: highlighted.has(n.id) })),
      ...layout.edges.map((e) => ({ kind: 'Edge', a: e.from, b: e.to, layer: undefined, extra: e.label ?? '', mark: e.emphasis })),
    ],
    [layout, highlighted],
  );

  const hovered = hover ? layout.nodes.find((n) => n.id === hover) ?? null : null;
  const layerCount = layout.nodes.reduce((m, n) => Math.max(m, n.layer + 1), 0);

  if (!layout.nodes.length) {
    return (
      <ChartFrame
        title={title}
        description={description}
        xLabel=""
        yLabel=""
        xDomain={[0, 1]}
        yDomain={[0, 1]}
        height={height}
        empty={{ title: 'No graph to draw', message: 'Supply at least one node. Edges naming an unknown node are ignored and reported.' }}
      >
        {() => null}
      </ChartFrame>
    );
  }

  const chartHeight = px(height ?? Math.min(640, Math.max(220, layout.height + 70)), 320);

  return (
    <ChartFrame
      title={title}
      description={description}
      xLabel=""
      yLabel=""
      /* A graph has no measurement axes; the frame is used for its chrome,
         table alternative and export, and the scales are ignored below. */
      xDomain={[0, 1]}
      yDomain={[0, 1]}
      height={chartHeight}
      margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
      legend={[
        { label: 'Node', color: seriesColor(0), kind: 'area' },
        { label: `${highlightLabel} (heavier stroke and a hatched fill)`, color: seriesColor(1), kind: 'area' },
        { label: 'Directed edge (arrowhead points to the child)', color: 'var(--text-muted)', kind: 'line' },
      ]}
      note={joinNotes([
        note,
        `${count(layout.nodes.length)} nodes across ${count(layerCount)} layers. Layers run left to right; the layout is deterministic, so the same network always draws the same way.`,
        layout.danglingEdges > 0 ? `${count(layout.danglingEdges)} edges name a node that is not in the list and are not drawn.` : null,
        layout.cyclic ? 'The edges contain a cycle, so the layering is only approximate; a Bayesian network or fault tree should be acyclic.' : null,
        'The diagram is scaled to fit the card rather than overflowing the page; the node and edge listing in the table view is the exact reading.',
      ])}
      table={{ columns, rows: tableRows, caption: `${title}: nodes and edges` }}
      onExport={onExport}
      tooltip={
        hovered
          ? {
              x: 0,
              y: 0,
              content: (
                <TooltipRows
                  rows={[
                    { label: 'Node', value: hovered.label },
                    { label: 'Layer', value: count(hovered.layer) },
                    ...(hovered.group ? [{ label: 'Group', value: hovered.group }] : []),
                    ...(hovered.badge ? [{ label: 'State', value: hovered.badge }] : []),
                    { label: 'Highlighted', value: highlighted.has(hovered.id) ? 'yes' : 'no' },
                  ]}
                />
              ),
            }
          : null
      }
    >
      {({ width, height: h }) => {
        // Fit the computed layout into the plot area. 40 nodes stay legible at
        // card width, and nothing ever extends past the card.
        const scale = Math.min(1, px(width, 1) / Math.max(1, layout.width), px(h, 1) / Math.max(1, layout.height)) || 1;
        const s = Math.max(0.2, px(scale, 1));
        const offsetX = Math.max(0, (px(width) - layout.width * s) / 2);
        const offsetY = Math.max(0, (px(h) - layout.height * s) / 2);
        return (
          <g transform={`translate(${svgNum(offsetX)},${svgNum(offsetY)}) scale(${s.toFixed(4)})`}>
            <defs>
              <marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--text-muted)" />
              </marker>
              <marker id={arrowEmphId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={seriesColor(1)} />
              </marker>
              <pattern id={hatchId} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                <rect width="6" height="6" fill={seriesColor(1)} fillOpacity="0.14" />
                <line x1="0" y1="0" x2="0" y2="6" stroke={seriesColor(1)} strokeWidth="1.6" strokeOpacity="0.5" />
              </pattern>
            </defs>

            {layout.edges.map((e, i) => (
              <g key={`e-${i}`} data-role="graph-edge">
                <path
                  d={curvedEdgePath(e)}
                  fill="none"
                  stroke={e.emphasis ? seriesColor(1) : 'var(--text-muted)'}
                  strokeWidth={e.emphasis ? 2.4 : 1.4}
                  markerEnd={`url(#${e.emphasis ? arrowEmphId : arrowId})`}
                />
                {e.label && (
                  <text className="oc-chart__tick" x={svgNum((e.x1 + e.x2) / 2)} y={svgNum((e.y1 + e.y2) / 2 - 4)} textAnchor="middle" style={{ fill: 'var(--text-muted)' }}>
                    {truncate(e.label, 14)}
                  </text>
                )}
              </g>
            ))}

            {layout.nodes.map((n) => {
              const marked = highlighted.has(n.id);
              return (
                <g key={n.id} data-role="graph-node" data-node={n.id} data-highlighted={marked ? 'true' : 'false'} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}>
                  <rect
                    x={svgNum(n.x)}
                    y={svgNum(n.y)}
                    width={Math.max(1, px(n.width))}
                    height={Math.max(1, px(n.height))}
                    rx={6}
                    /* Highlight uses a texture as well as a heavier stroke, so
                       it never depends on colour alone. */
                    fill={marked ? `url(#${hatchId})` : 'var(--surface)'}
                    stroke={marked ? seriesColor(1) : seriesColor(0)}
                    strokeWidth={marked ? 3 : 1.5}
                    strokeOpacity={hover === n.id ? 1 : 0.9}
                  />
                  <text
                    x={svgNum(n.x + n.width / 2)}
                    y={svgNum(n.y + (n.badge ? n.height / 2 - 4 : n.height / 2))}
                    dy="0.33em"
                    textAnchor="middle"
                    style={{ fontSize: 12, fill: 'var(--text-primary)' }}
                  >
                    {truncate(n.label, 20)}
                  </text>
                  {n.badge && (
                    <text x={svgNum(n.x + n.width / 2)} y={svgNum(n.y + n.height - 7)} textAnchor="middle" style={{ fontSize: 10, fill: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                      {truncate(n.badge, 16)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      }}
    </ChartFrame>
  );
}

function curvedEdgePath(e: LaidOutGraphEdge): string {
  const dx = Math.max(16, Math.abs(px(e.x2) - px(e.x1)) * 0.45);
  return `M${svgNum(e.x1)},${svgNum(e.y1)}C${svgNum(e.x1 + dx)},${svgNum(e.y1)} ${svgNum(e.x2 - dx)},${svgNum(e.y2)} ${svgNum(e.x2)},${svgNum(e.y2)}`;
}

/* ----------------------------------------------------------- TreeDiagram */

export type TreeNodeKind = 'decision' | 'chance' | 'terminal';

export interface TreeNode {
  id: string;
  kind: TreeNodeKind;
  label: string;
  /** Rolled-back value, computed by the caller. */
  value?: number;
  /** Branch probability on the edge leading into this node. */
  probability?: number;
  /** Marks the branch chosen at the parent decision. */
  chosen?: boolean;
  children?: TreeNode[];
}

export interface LaidOutTreeNode {
  id: string;
  kind: TreeNodeKind;
  label: string;
  value?: number;
  probability?: number;
  chosen: boolean;
  depth: number;
  x: number;
  y: number;
  parent: string | null;
  /** True when children were pruned at the depth limit. */
  pruned: boolean;
}

export interface TreePath {
  labels: string[];
  cumulativeProbability: number | null;
  value?: number;
  chosen: boolean;
}

export interface TreeLayout {
  nodes: LaidOutTreeNode[];
  width: number;
  height: number;
  /** True when at least one subtree was pruned at the depth limit. */
  truncated: boolean;
  paths: TreePath[];
}

/** Default depth limit. A deeper tree is pruned, never recursed into. */
export const TREE_MAX_DEPTH = 24;
const TREE_COL_WIDTH = 150;
const TREE_ROW_HEIGHT = 34;
const TREE_MAX_PATHS = 300;

/**
 * Left-to-right tree layout computed entirely iteratively, with an explicit
 * stack and a documented depth limit. A 2,000-level tree is pruned at
 * `maxDepth` and still lays out; nothing here recurses, so a deep input can
 * never overflow the stack.
 */
export function layoutTree(root: TreeNode | null | undefined, maxDepth = TREE_MAX_DEPTH): TreeLayout {
  if (!root) return { nodes: [], width: 1, height: 1, truncated: false, paths: [] };
  const limit = Number.isFinite(maxDepth) ? Math.max(0, Math.floor(maxDepth)) : TREE_MAX_DEPTH;

  interface Frame {
    node: TreeNode;
    depth: number;
    parent: string | null;
  }
  const visitOrder: { src: TreeNode; depth: number; parent: string | null; childIds: string[]; pruned: boolean }[] = [];
  // Depth-first pre-order with an explicit stack; children pushed in reverse so
  // they come out in input order, which keeps the layout deterministic.
  const stack: Frame[] = [{ node: root, depth: 0, parent: null }];
  let truncated = false;
  const seen = new Set<string>();
  while (stack.length) {
    const frame = stack.pop()!;
    const { node, depth, parent } = frame;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    const kids = depth < limit ? node.children ?? [] : [];
    const pruned = depth >= limit && (node.children?.length ?? 0) > 0;
    if (pruned) truncated = true;
    visitOrder.push({ src: node, depth, parent, childIds: kids.map((k) => k.id), pruned });
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i], depth: depth + 1, parent: node.id });
  }

  // Leaves get consecutive rows in visit order; internal nodes centre on their
  // children, resolved by walking the pre-order list backwards (children always
  // appear after their parent in a pre-order listing).
  const rowOf = new Map<string, number>();
  let nextRow = 0;
  for (const entry of visitOrder) {
    if (!entry.childIds.length) rowOf.set(entry.src.id, nextRow++);
  }
  for (let i = visitOrder.length - 1; i >= 0; i--) {
    const entry = visitOrder[i];
    if (!entry.childIds.length) continue;
    const rows = entry.childIds.map((id) => rowOf.get(id)).filter((r): r is number => r !== undefined);
    rowOf.set(entry.src.id, rows.length ? (Math.min(...rows) + Math.max(...rows)) / 2 : nextRow++);
  }

  const maxShownDepth = visitOrder.reduce((m, e) => Math.max(m, e.depth), 0);
  const nodes: LaidOutTreeNode[] = visitOrder.map((e) => ({
    id: e.src.id,
    kind: e.src.kind,
    label: e.src.label,
    value: e.src.value,
    probability: e.src.probability,
    chosen: e.src.chosen === true,
    depth: e.depth,
    x: px(e.depth * TREE_COL_WIDTH),
    y: px((rowOf.get(e.src.id) ?? 0) * TREE_ROW_HEIGHT),
    parent: e.parent,
    pruned: e.pruned,
  }));

  // Flat root-to-leaf path listing with cumulative probabilities, also built
  // iteratively.
  const childrenOf = new Map<string, string[]>();
  const byId = new Map(visitOrder.map((e) => [e.src.id, e]));
  for (const e of visitOrder) childrenOf.set(e.src.id, e.childIds);
  const paths: TreePath[] = [];
  const pathStack: { id: string; labels: string[]; prob: number | null; chosen: boolean }[] = [
    { id: root.id, labels: [root.label], prob: Number.isFinite(root.probability ?? NaN) ? (root.probability as number) : 1, chosen: true },
  ];
  while (pathStack.length && paths.length < TREE_MAX_PATHS) {
    const top = pathStack.pop()!;
    const kids = childrenOf.get(top.id) ?? [];
    if (!kids.length) {
      paths.push({ labels: top.labels, cumulativeProbability: top.prob, value: byId.get(top.id)?.src.value, chosen: top.chosen });
      continue;
    }
    for (let i = kids.length - 1; i >= 0; i--) {
      const kid = byId.get(kids[i]);
      if (!kid) continue;
      const p = kid.src.probability;
      // A branch with no probability (a decision) leaves the product alone; a
      // branch with an unusable probability makes the product unknown rather
      // than quietly wrong.
      const prob = top.prob === null ? null : p === undefined ? top.prob : Number.isFinite(p) ? top.prob * p : null;
      pathStack.push({
        id: kid.src.id,
        labels: [...top.labels, kid.src.label],
        prob: prob !== null && Number.isFinite(prob) ? prob : null,
        chosen: top.chosen && kid.src.chosen === true,
      });
    }
  }

  return {
    nodes,
    width: Math.max(1, maxShownDepth * TREE_COL_WIDTH + TREE_COL_WIDTH),
    height: Math.max(1, nextRow * TREE_ROW_HEIGHT + TREE_ROW_HEIGHT),
    truncated,
    paths,
  };
}

export function TreeDiagram({
  title,
  description,
  root,
  maxDepth = TREE_MAX_DEPTH,
  valueLabel = 'Value',
  height,
  note,
  onExport,
}: {
  title: string;
  description: string;
  root: TreeNode | null;
  maxDepth?: number;
  valueLabel?: string;
  height?: number;
  note?: string;
  onExport?(): void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const layout = useMemo(() => layoutTree(root, maxDepth), [root, maxDepth]);

  const columns: ColumnDef<unknown>[] = useMemo(
    () => [
      { key: 'path', header: 'Path', render: (r) => (r as TreePath).labels.join(' → ') },
      { key: 'p', header: 'Cumulative probability', numeric: true, render: (r) => { const p = (r as TreePath).cumulativeProbability; return p === null ? '—' : pct(p); } },
      { key: 'v', header: valueLabel, numeric: true, render: (r) => val((r as TreePath).value, 5) },
      { key: 'c', header: 'On the chosen branch', render: (r) => ((r as TreePath).chosen ? 'yes' : '') },
    ],
    [valueLabel],
  );

  const hovered = hover ? layout.nodes.find((n) => n.id === hover) ?? null : null;
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  if (!layout.nodes.length) {
    return (
      <ChartFrame
        title={title}
        description={description}
        xLabel=""
        yLabel=""
        xDomain={[0, 1]}
        yDomain={[0, 1]}
        height={height}
        empty={{ title: 'No decision tree to draw', message: 'Supply a root node. Each node needs an id, a kind (decision, chance or terminal) and a label.' }}
      >
        {() => null}
      </ChartFrame>
    );
  }

  const chartHeight = px(height ?? Math.min(640, Math.max(220, layout.height + 60)), 320);

  return (
    <ChartFrame
      title={title}
      description={description}
      xLabel=""
      yLabel=""
      /* A tree has no measurement axes; the frame supplies the chrome, the path
         listing and the export, and the scales are ignored below. */
      xDomain={[0, 1]}
      yDomain={[0, 1]}
      height={chartHeight}
      margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
      legend={[
        { label: 'Decision (square)', color: seriesColor(0), kind: 'area' },
        { label: 'Chance (circle)', color: seriesColor(1), kind: 'dot' },
        { label: 'Terminal (triangle)', color: seriesColor(2), kind: 'dot' },
        { label: 'Chosen branch (heavier stroke with a marker)', color: seriesColor(0), kind: 'line' },
      ]}
      note={joinNotes([
        note,
        'Shape carries the node kind: a square is a decision, a circle is a chance node and a triangle is a terminal outcome. The chosen branch at each decision is drawn with a heavier stroke and a marker as well as a different colour.',
        layout.truncated ? `The tree is deeper than the ${count(maxDepth)}-level drawing limit; deeper subtrees are not drawn and are not included in the path listing.` : null,
        layout.paths.length >= TREE_MAX_PATHS ? `The path listing is capped at ${count(TREE_MAX_PATHS)} paths.` : null,
      ])}
      table={{ columns, rows: layout.paths, caption: `${title}: root-to-leaf paths` }}
      onExport={onExport}
      tooltip={
        hovered
          ? {
              x: 0,
              y: 0,
              content: (
                <TooltipRows
                  rows={[
                    { label: 'Node', value: hovered.label },
                    { label: 'Kind', value: hovered.kind },
                    { label: 'Branch probability', value: pct(hovered.probability) },
                    { label: valueLabel, value: val(hovered.value, 5) },
                    { label: 'Chosen', value: hovered.chosen ? 'yes' : 'no' },
                  ]}
                />
              ),
            }
          : null
      }
    >
      {({ width, height: h }) => {
        const scale = Math.min(1, px(width, 1) / Math.max(1, layout.width), px(h, 1) / Math.max(1, layout.height)) || 1;
        const s = Math.max(0.2, px(scale, 1));
        const offsetY = Math.max(0, (px(h) - layout.height * s) / 2);
        const R = 10;
        return (
          <g transform={`translate(0,${svgNum(offsetY)}) scale(${s.toFixed(4)})`}>
            {/* Branches first, so the symbols sit on top. */}
            {layout.nodes.map((n) => {
              if (!n.parent) return null;
              const p = byId.get(n.parent);
              if (!p) return null;
              const x1 = px(p.x + R + 4);
              const y1 = px(p.y);
              const x2 = px(n.x - R - 4);
              const y2 = px(n.y);
              const mx = (x1 + x2) / 2;
              return (
                <g key={`b-${n.id}`} data-role="tree-branch" data-chosen={n.chosen ? 'true' : 'false'}>
                  <path
                    d={`M${svgNum(x1)},${svgNum(y1)}H${svgNum(mx)}V${svgNum(y2)}H${svgNum(x2)}`}
                    fill="none"
                    stroke={n.chosen ? seriesColor(0) : 'var(--text-muted)'}
                    strokeWidth={n.chosen ? 3 : 1.4}
                  />
                  {/* A marker, so the chosen branch is not colour-only. */}
                  {n.chosen && <path d={diamondPath(mx, (y1 + y2) / 2, 4)} fill={seriesColor(0)} />}
                  {n.probability !== undefined && Number.isFinite(n.probability) && (
                    <text className="oc-chart__tick" x={svgNum(mx + 4)} y={svgNum(y2 - 5)} style={{ fill: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                      {pct(n.probability)}
                    </text>
                  )}
                </g>
              );
            })}

            {layout.nodes.map((n) => {
              const cx = px(n.x);
              const cy = px(n.y);
              const color = n.kind === 'decision' ? seriesColor(0) : n.kind === 'chance' ? seriesColor(1) : seriesColor(2);
              return (
                <g key={n.id} data-role="tree-node" data-kind={n.kind} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}>
                  {n.kind === 'decision' && <rect x={svgNum(cx - R)} y={svgNum(cy - R)} width={R * 2} height={R * 2} rx={2} fill="var(--surface)" stroke={color} strokeWidth={2} />}
                  {n.kind === 'chance' && <circle cx={cx} cy={cy} r={R} fill="var(--surface)" stroke={color} strokeWidth={2} />}
                  {n.kind === 'terminal' && (
                    <path d={`M${svgNum(cx - R)},${svgNum(cy - R)}L${svgNum(cx + R)},${svgNum(cy)}L${svgNum(cx - R)},${svgNum(cy + R)}Z`} fill="var(--surface)" stroke={color} strokeWidth={2} />
                  )}
                  <text x={svgNum(cx + R + 6)} y={svgNum(cy)} dy="0.33em" style={{ fontSize: 12, fill: 'var(--text-primary)' }}>
                    {truncate(n.label, 16)}
                  </text>
                  {n.value !== undefined && Number.isFinite(n.value) && (
                    <text x={svgNum(cx + R + 6)} y={svgNum(cy + 13)} style={{ fontSize: 10, fill: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                      {val(n.value, 4)}
                    </text>
                  )}
                  {n.pruned && (
                    <text x={svgNum(cx + R + 6)} y={svgNum(cy - 12)} style={{ fontSize: 10, fill: 'var(--status-warning)' }}>
                      deeper branches not drawn
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      }}
    </ChartFrame>
  );
}

/* ----------------------------------------------------- CalibrationChart */

export interface CalibrationBin {
  predicted: number;
  observed: number;
  n: number;
  lower?: number;
  upper?: number;
}

export function CalibrationChart({
  title,
  description,
  bins,
  baseRate,
  height,
  note,
  onExport,
}: {
  title: string;
  description: string;
  bins: CalibrationBin[];
  /** Overall observed frequency, supplied by the caller. */
  baseRate: number;
  height?: number;
  note?: string;
  onExport?(): void;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const prepared = useMemo(
    () => bins.filter((b) => Number.isFinite(b.predicted) && Number.isFinite(b.observed)).sort((a, b) => a.predicted - b.predicted),
    [bins],
  );
  const omitted = bins.length - prepared.length;
  const maxN = useMemo(() => prepared.reduce((m, b) => (Number.isFinite(b.n) ? Math.max(m, b.n) : m), 0), [prepared]);
  const totalN = useMemo(() => prepared.reduce((s, b) => (Number.isFinite(b.n) ? s + b.n : s), 0), [prepared]);

  const columns: ColumnDef<unknown>[] = useMemo(
    () => [
      { key: 'p', header: 'Forecast probability', numeric: true, render: (r) => pct((r as CalibrationBin).predicted) },
      { key: 'o', header: 'Observed frequency', numeric: true, render: (r) => pct((r as CalibrationBin).observed) },
      { key: 'n', header: 'Forecasts in bin', numeric: true, render: (r) => count((r as CalibrationBin).n) },
      { key: 'ci', header: 'Interval', render: (r) => { const b = r as CalibrationBin; return b.lower === undefined || b.upper === undefined ? '—' : `${pct(b.lower)} – ${pct(b.upper)}`; } },
    ],
    [],
  );

  const hovered = hover !== null ? prepared[hover] ?? null : null;

  if (!prepared.length) {
    return (
      <ChartFrame
        title={title}
        description={description}
        xLabel="Forecast probability"
        yLabel="Observed frequency"
        xDomain={[0, 1]}
        yDomain={[0, 1]}
        height={height}
        empty={{ title: 'No calibration bins to draw', message: 'Supply bins of forecast probability against observed frequency, each with the number of forecasts it contains.' }}
      >
        {() => null}
      </ChartFrame>
    );
  }

  const base = Number.isFinite(baseRate) ? baseRate : null;

  return (
    <ChartFrame
      title={title}
      description={description}
      xLabel="Forecast probability"
      yLabel="Observed frequency"
      xDomain={[0, 1]}
      yDomain={[0, 1]}
      height={height ?? 340}
      legend={[
        { label: 'Observed frequency per bin (marker area ∝ number of forecasts)', color: seriesColor(0), kind: 'dot' },
        { label: 'Perfect calibration (dashed diagonal)', color: 'var(--text-muted)', kind: 'line' },
        ...(base !== null ? [{ label: 'Overall base rate (solid rule)', color: seriesColor(3), kind: 'line' as const }] : []),
      ]}
      note={joinNotes([
        note,
        'Marker area is proportional to the number of forecasts in the bin, so a bin with a handful of observations looks as thin as it is. The inset bars show how the forecasts are distributed across the bins.',
        omittedNote(omitted, 'bin'),
      ])}
      table={{ columns, rows: prepared, caption: `${title}: calibration bins` }}
      onExport={onExport}
      tooltip={
        hovered
          ? {
              x: 0,
              y: 0,
              content: (
                <TooltipRows
                  rows={[
                    { label: 'Forecast', value: pct(hovered.predicted) },
                    { label: 'Observed', value: pct(hovered.observed) },
                    { label: 'Forecasts in bin', value: count(hovered.n) },
                    { label: 'Interval', value: hovered.lower === undefined || hovered.upper === undefined ? '—' : `${pct(hovered.lower)} – ${pct(hovered.upper)}` },
                  ]}
                />
              ),
            }
          : null
      }
    >
      {({ x, y, width, height: h }) => {
        const maxR = 11;
        const minR = 1.6;
        const radius = (n: number) => {
          if (!Number.isFinite(n) || n <= 0 || maxN <= 0) return minR;
          // Area proportional to n means radius proportional to √n. The floor
          // is deliberately small: a bin with three observations must not look
          // as solid as one with three thousand.
          return Math.max(minR, Math.min(maxR, maxR * Math.sqrt(n / maxN)));
        };
        const insetW = Math.min(132, px(width) * 0.4);
        const insetH = Math.min(62, px(h) * 0.26);
        const showInset = px(width) > 240 && px(h) > 170 && maxN > 0;
        const insetX = Math.max(0, px(width) - insetW - 6);
        const insetY = Math.max(0, px(h) - insetH - 6);
        const slotW = insetW / Math.max(1, prepared.length);
        return (
          <g>
            {/* Perfect calibration. */}
            <line data-role="calibration-diagonal" x1={px(x(0))} x2={px(x(1))} y1={px(y(0))} y2={px(y(1))} stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="5 4" />
            <text className="oc-chart__tick" x={px(x(0.6))} y={px(y(0.64))} style={{ fill: 'var(--text-muted)' }}>
              perfect calibration
            </text>

            {base !== null && (
              <g>
                <line data-role="base-rate" x1={0} x2={px(width)} y1={px(y(base))} y2={px(y(base))} stroke={seriesColor(3)} strokeWidth={1.5} />
                <text className="oc-chart__tick" x={4} y={px(y(base)) - 5} style={{ fill: 'var(--text-secondary)' }}>
                  {`base rate ${pct(base)}`}
                </text>
              </g>
            )}

            {/* Reliability line through the bins. */}
            <path d={plainLinePath(prepared.map((b) => ({ x: b.predicted, y: b.observed })), x, y)} fill="none" stroke={seriesColor(0)} strokeWidth={2} strokeLinejoin="round" />

            {prepared.map((b, i) => {
              const cx = px(x(b.predicted));
              const cy = px(y(b.observed));
              const hasCi = Number.isFinite(b.lower ?? NaN) && Number.isFinite(b.upper ?? NaN);
              const r = radius(b.n);
              return (
                <g key={i} data-role="calibration-bin" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  {hasCi && (
                    <g data-role="calibration-interval">
                      <line x1={cx} x2={cx} y1={px(y(b.lower as number))} y2={px(y(b.upper as number))} stroke={seriesColor(0)} strokeWidth={1.5} />
                      <line x1={cx - 4} x2={cx + 4} y1={px(y(b.lower as number))} y2={px(y(b.lower as number))} stroke={seriesColor(0)} strokeWidth={1.5} />
                      <line x1={cx - 4} x2={cx + 4} y1={px(y(b.upper as number))} y2={px(y(b.upper as number))} stroke={seriesColor(0)} strokeWidth={1.5} />
                    </g>
                  )}
                  <circle cx={cx} cy={cy} r={r + 2} fill="var(--surface)" />
                  <circle cx={cx} cy={cy} r={r} fill={seriesColor(0)} fillOpacity={hover === i ? 1 : 0.85} />
                </g>
              );
            })}

            {/* Companion histogram of the forecast distribution. */}
            {showInset && (
              <g data-role="forecast-histogram">
                <rect x={svgNum(insetX)} y={svgNum(insetY)} width={Math.max(1, insetW)} height={Math.max(1, insetH)} rx={4} fill="var(--surface)" fillOpacity={0.82} stroke="var(--text-muted)" strokeWidth={1} strokeOpacity={0.4} />
                {prepared.map((b, i) => {
                  const nn = Number.isFinite(b.n) ? Math.max(0, b.n) : 0;
                  const barH = maxN > 0 ? (nn / maxN) * (insetH - 16) : 0;
                  const bw = Math.max(1, Math.min(MAX_BAR_THICKNESS, slotW - BAR_GAP));
                  return (
                    <rect
                      key={i}
                      x={svgNum(insetX + i * slotW + (slotW - bw) / 2)}
                      y={svgNum(insetY + insetH - 4 - barH)}
                      width={bw}
                      height={Math.max(0, px(barH))}
                      rx={Math.min(4, bw / 2)}
                      fill={seriesColor(0)}
                      fillOpacity={0.6}
                    />
                  );
                })}
                <text x={svgNum(insetX + 5)} y={svgNum(insetY + 11)} style={{ fontSize: 9.5, fill: 'var(--text-muted)' }}>
                  {`forecasts per bin (n=${count(totalN)})`}
                </text>
              </g>
            )}
          </g>
        );
      }}
    </ChartFrame>
  );
}

/* -------------------------------------------------------- FrontierChart */

export interface RiskReturnPoint {
  risk: number;
  return: number;
  label: string;
}

export function FrontierChart({
  title,
  description,
  frontier,
  assets,
  highlights,
  capitalMarketLine,
  riskLabel = 'Risk (standard deviation)',
  returnLabel = 'Expected return',
  height,
  note,
  onExport,
}: {
  title: string;
  description: string;
  frontier: { risk: number; return: number }[];
  assets: RiskReturnPoint[];
  /** Directly labelled portfolios, e.g. minimum variance and maximum Sharpe. */
  highlights?: RiskReturnPoint[];
  /** From the risk-free rate through the tangency portfolio. */
  capitalMarketLine?: { riskFree: number; tangencyRisk: number; tangencyReturn: number; label: string } | null;
  riskLabel?: string;
  returnLabel?: string;
  height?: number;
  note?: string;
  onExport?(): void;
}) {
  const [hover, setHover] = useState<{ kind: 'asset' | 'highlight'; i: number } | null>(null);

  const line = useMemo(
    () => frontier.filter((p) => Number.isFinite(p.risk) && Number.isFinite(p.return)).sort((a, b) => a.risk - b.risk),
    [frontier],
  );
  const dots = useMemo(() => assets.filter((p) => Number.isFinite(p.risk) && Number.isFinite(p.return)), [assets]);
  const marks = useMemo(() => (highlights ?? []).filter((p) => Number.isFinite(p.risk) && Number.isFinite(p.return)), [highlights]);
  const omitted = frontier.length - line.length + (assets.length - dots.length) + ((highlights?.length ?? 0) - marks.length);

  const cml = useMemo(() => {
    if (!capitalMarketLine) return null;
    const { riskFree, tangencyRisk, tangencyReturn } = capitalMarketLine;
    if (![riskFree, tangencyRisk, tangencyReturn].every(Number.isFinite) || tangencyRisk <= 0) return null;
    return capitalMarketLine;
  }, [capitalMarketLine]);

  const xDomain = useMemo(
    () => padDomain(extent([0, ...line.map((p) => p.risk), ...dots.map((p) => p.risk), ...marks.map((p) => p.risk), ...(cml ? [cml.tangencyRisk] : [])]), 0.08),
    [line, dots, marks, cml],
  );
  const yDomain = useMemo(
    () =>
      padDomain(
        extent([...line.map((p) => p.return), ...dots.map((p) => p.return), ...marks.map((p) => p.return), ...(cml ? [cml.riskFree, cml.tangencyReturn] : [])]),
        0.1,
      ),
    [line, dots, marks, cml],
  );

  const columns: ColumnDef<unknown>[] = useMemo(
    () => [
      { key: 'k', header: 'Kind', render: (r) => (r as { kind: string }).kind },
      { key: 'l', header: 'Name', render: (r) => (r as { label: string }).label },
      { key: 'r', header: riskLabel, numeric: true, render: (r) => val((r as { risk: number }).risk, 5) },
      { key: 'ret', header: returnLabel, numeric: true, render: (r) => val((r as { ret: number }).ret, 5) },
    ],
    [riskLabel, returnLabel],
  );

  const tableRows = useMemo(
    () => [
      ...marks.map((p) => ({ kind: 'Highlighted portfolio', label: p.label, risk: p.risk, ret: p.return })),
      ...dots.map((p) => ({ kind: 'Asset', label: p.label, risk: p.risk, ret: p.return })),
      ...line.slice(0, 300).map((p, i) => ({ kind: 'Frontier', label: `point ${i + 1}`, risk: p.risk, ret: p.return })),
    ],
    [marks, dots, line],
  );

  const hovered = hover ? (hover.kind === 'asset' ? dots[hover.i] : marks[hover.i]) ?? null : null;

  if (!line.length && !dots.length && !marks.length) {
    return (
      <ChartFrame
        title={title}
        description={description}
        xLabel={riskLabel}
        yLabel={returnLabel}
        xDomain={[0, 1]}
        yDomain={[0, 1]}
        height={height}
        empty={{ title: 'No risk/return data', message: 'Supply a frontier, some assets or a highlighted portfolio with finite risk and return values.' }}
      >
        {() => null}
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      title={title}
      description={description}
      xLabel={riskLabel}
      yLabel={returnLabel}
      xDomain={xDomain}
      yDomain={yDomain}
      height={height ?? 330}
      legend={[
        { label: 'Efficient frontier', color: seriesColor(0), kind: 'line' },
        { label: 'Individual asset (small dot)', color: seriesColor(2), kind: 'dot' },
        { label: 'Highlighted portfolio (diamond, directly labelled)', color: seriesColor(1), kind: 'dot' },
        ...(cml ? [{ label: cml.label, color: seriesColor(3), kind: 'line' as const }] : []),
      ]}
      note={joinNotes([
        note,
        'The frontier is the set the caller computed; points below and to the right of it are attainable but not efficient.',
        omittedNote(omitted, 'point'),
      ])}
      table={{ columns, rows: tableRows, caption: `${title}: risk and return` }}
      onExport={onExport}
      tooltip={
        hovered
          ? { x: 0, y: 0, content: <TooltipRows rows={[{ label: 'Name', value: hovered.label }, { label: riskLabel, value: val(hovered.risk, 5) }, { label: returnLabel, value: val(hovered.return, 5) }]} /> }
          : null
      }
    >
      {({ x, y, width }) => (
        <g>
          {cml && (
            <g>
              {/* Extended to the right edge of the plot at the tangency slope. */}
              <line
                data-role="capital-market-line"
                x1={px(x(0))}
                x2={px(width)}
                y1={px(y(cml.riskFree))}
                y2={px(y(cml.riskFree + ((cml.tangencyReturn - cml.riskFree) / cml.tangencyRisk) * xDomain[1]))}
                stroke={seriesColor(3)}
                strokeWidth={2}
                strokeDasharray="8 4"
              />
            </g>
          )}

          {line.length > 1 && <path data-role="frontier-line" d={plainLinePath(line.map((p) => ({ x: p.risk, y: p.return })), x, y)} fill="none" stroke={seriesColor(0)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}

          {dots.map((p, i) => (
            <g key={`a-${i}`} data-role="asset-point" onMouseEnter={() => setHover({ kind: 'asset', i })} onMouseLeave={() => setHover(null)}>
              <circle cx={px(x(p.risk))} cy={px(y(p.return))} r={3.2} fill={seriesColor(2)} fillOpacity={0.75} />
            </g>
          ))}

          {/* Highlighted portfolios are direct-labelled rather than left to the legend. */}
          {marks.map((p, i) => {
            const cx = px(x(p.risk));
            const cy = px(y(p.return));
            const anchor = cx > px(width) * 0.72 ? 'end' : 'start';
            return (
              <g key={`m-${i}`} data-role="highlight-point" onMouseEnter={() => setHover({ kind: 'highlight', i })} onMouseLeave={() => setHover(null)}>
                <path d={diamondPath(cx, cy, MARKER_RADIUS + 2.5)} fill="var(--surface)" />
                <path d={diamondPath(cx, cy, MARKER_RADIUS)} fill={seriesColor(1)} />
                <text
                  className="oc-chart__tick"
                  x={anchor === 'end' ? cx - 9 : cx + 9}
                  y={cy - 7}
                  textAnchor={anchor}
                  style={{ fill: 'var(--text-secondary)' }}
                >
                  {truncate(p.label, 22)}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </ChartFrame>
  );
}
