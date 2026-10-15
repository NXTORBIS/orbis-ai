/**
 * Shared chart chrome: responsive sizing, axes, gridlines, legend, tooltip
 * layer, empty/error states and an accessible table alternative.
 *
 * Every chart built on this frame has:
 *  - labelled axes with correct scales,
 *  - a legend whenever two or more series are shown (identity is never
 *    conveyed by colour alone),
 *  - a hover tooltip carrying the actual values,
 *  - a "Show values" table view, so the data is available without the chart,
 *  - an explicit note when data has been reduced for drawing.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Button, DataTable, EmptyState, useElementWidth, type ColumnDef } from '../primitives';
import { formatTick, linearScale, seriesColor, ticks, type LinearScale } from './scale';

export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGIN: ChartMargin = { top: 12, right: 18, bottom: 40, left: 58 };

export interface LegendEntry {
  label: string;
  color: string;
  kind?: 'area' | 'line' | 'dot';
  /** Toggling hides the series. Omit to make the entry non-interactive. */
  onToggle?(): void;
  visible?: boolean;
}

export interface ChartFrameProps {
  title: string;
  /** Hidden description for assistive technology, summarising what is plotted. */
  description: string;
  xLabel: string;
  yLabel: string;
  xDomain: [number, number];
  yDomain: [number, number];
  height?: number;
  margin?: Partial<ChartMargin>;
  legend?: LegendEntry[];
  /** Integer-only x ticks, for discrete distributions. */
  xIntegerTicks?: boolean;
  /** Custom x tick label, e.g. to undo a log transform before display. */
  formatXTick?(value: number): string;
  /** Rendered inside the plot area, receiving the scales. */
  children(ctx: { x: LinearScale; y: LinearScale; width: number; height: number }): ReactNode;
  /** Hover handler: receives data coordinates, or null when the pointer leaves. */
  onHover?(point: { x: number; y: number; px: number; py: number } | null): void;
  /** Tooltip content; positioned by the frame. */
  tooltip?: { x: number; y: number; content: ReactNode } | null;
  /** Shown beneath the chart, e.g. a truncation or precision note. */
  note?: string;
  /** Table alternative to the chart. */
  table?: { columns: ColumnDef<unknown>[]; rows: unknown[]; caption: string };
  /** Toolbar controls shown above the plot. */
  toolbar?: ReactNode;
  /** Set when there is nothing to draw. */
  empty?: { title: string; message: string } | null;
  /** Set when the chart could not be produced. */
  error?: string | null;
  onExport?(): void;
}

export function ChartFrame({
  title,
  description,
  xLabel,
  yLabel,
  xDomain,
  yDomain,
  height = 280,
  margin: marginOverride,
  legend,
  xIntegerTicks,
  formatXTick,
  children,
  onHover,
  tooltip,
  note,
  table,
  toolbar,
  empty,
  error,
  onExport,
}: ChartFrameProps) {
  const [ref, containerWidth] = useElementWidth<HTMLDivElement>();
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();
  const descId = useId();
  const margin = { ...DEFAULT_MARGIN, ...marginOverride };
  const width = Math.max(260, containerWidth);
  const innerWidth = Math.max(40, width - margin.left - margin.right);
  const innerHeight = Math.max(40, height - margin.top - margin.bottom);

  const x = useMemo(() => linearScale(xDomain, [0, innerWidth]), [xDomain, innerWidth]);
  const y = useMemo(() => linearScale(yDomain, [innerHeight, 0]), [yDomain, innerHeight]);

  const xTicks = useMemo(() => {
    const span = x.domain[1] - x.domain[0];
    const target = Math.max(2, Math.min(10, Math.floor(innerWidth / 72)));
    if (xIntegerTicks) {
      const lo = Math.ceil(x.domain[0]);
      const hi = Math.floor(x.domain[1]);
      const step = Math.max(1, Math.ceil((hi - lo + 1) / target));
      const out: number[] = [];
      for (let v = lo; v <= hi; v += step) out.push(v);
      return out;
    }
    return ticks(x.domain[0], x.domain[1], target).map((t) => t).filter((t) => t >= x.domain[0] - span * 1e-9 && t <= x.domain[1] + span * 1e-9);
  }, [x, innerWidth, xIntegerTicks]);

  const yTicks = useMemo(() => ticks(y.domain[0], y.domain[1], Math.max(2, Math.min(8, Math.floor(innerHeight / 44)))), [y, innerHeight]);

  if (error) {
    return (
      <div className="oc-chart" ref={ref}>
        <ChartHeading title={title} toolbar={toolbar} />
        <EmptyState icon="alert" title="This chart could not be drawn">
          {error}
        </EmptyState>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="oc-chart" ref={ref}>
        <ChartHeading title={title} toolbar={toolbar} />
        <EmptyState icon="chart" title={empty.title}>
          {empty.message}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="oc-chart" ref={ref}>
      <div className="oc-chart-toolbar">
        <h3 className="oc-card__title" id={titleId}>
          {title}
        </h3>
        <div className="oc-btn-row">
          {toolbar}
          {table && (
            <Button size="sm" variant="ghost" icon="table" onClick={() => setShowTable((v) => !v)}>
              {showTable ? 'Hide values' : 'Show values'}
            </Button>
          )}
          {onExport && (
            <Button size="sm" variant="ghost" icon="download" onClick={onExport} title="Export this chart's data as CSV">
              CSV
            </Button>
          )}
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          style={{ touchAction: 'pan-y' }}
          onMouseMove={
            onHover
              ? (e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const scaleX = width / rect.width;
                  const px = (e.clientX - rect.left) * scaleX - margin.left;
                  const py = (e.clientY - rect.top) * (height / rect.height) - margin.top;
                  if (px < -4 || px > innerWidth + 4 || py < -8 || py > innerHeight + 8) {
                    onHover(null);
                    return;
                  }
                  onHover({ x: x.invert(px), y: y.invert(py), px, py });
                }
              : undefined
          }
          onMouseLeave={onHover ? () => onHover(null) : undefined}
        >
          <desc id={descId}>{description}</desc>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {/* Horizontal gridlines */}
            {yTicks.map((t) => (
              <line key={`gy-${t}`} className="oc-chart__gridline" x1={0} x2={innerWidth} y1={y(t)} y2={y(t)} />
            ))}
            {/* Axis lines */}
            <line className="oc-chart__axis-line" x1={0} x2={innerWidth} y1={innerHeight} y2={innerHeight} />
            <line className="oc-chart__axis-line" x1={0} x2={0} y1={0} y2={innerHeight} />
            {/* Zero line, when zero is inside the y domain but is not the baseline */}
            {y.domain[0] < 0 && y.domain[1] > 0 && (
              <line className="oc-chart__axis-line" x1={0} x2={innerWidth} y1={y(0)} y2={y(0)} strokeDasharray="4 3" />
            )}

            {children({ x, y, width: innerWidth, height: innerHeight })}

            {/* Ticks */}
            {xTicks.map((t) => (
              <g key={`tx-${t}`} transform={`translate(${x(t)},${innerHeight})`}>
                <line className="oc-chart__axis-line" y1={0} y2={4} />
                <text className="oc-chart__tick" y={16} textAnchor="middle">
                  {formatXTick ? formatXTick(t) : formatTick(t, x.domain[1] - x.domain[0])}
                </text>
              </g>
            ))}
            {yTicks.map((t) => (
              <g key={`ty-${t}`} transform={`translate(0,${y(t)})`}>
                <line className="oc-chart__axis-line" x1={-4} x2={0} />
                <text className="oc-chart__tick" x={-8} dy="0.33em" textAnchor="end">
                  {formatTick(t, y.domain[1] - y.domain[0])}
                </text>
              </g>
            ))}
          </g>
          {/* Axis labels */}
          <text className="oc-chart__axis-label" x={margin.left + innerWidth / 2} y={height - 6} textAnchor="middle">
            {xLabel}
          </text>
          <text
            className="oc-chart__axis-label"
            transform={`translate(13,${margin.top + innerHeight / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            {yLabel}
          </text>
        </svg>

        {tooltip && (
          <div
            className="oc-chart__tooltip"
            style={{
              left: `${((margin.left + tooltip.x) / width) * 100}%`,
              top: `${((margin.top + tooltip.y - 10) / height) * 100}%`,
            }}
          >
            {tooltip.content}
          </div>
        )}
      </div>

      {legend && legend.length > 1 && (
        <div className="oc-legend">
          {legend.map((e, i) =>
            e.onToggle ? (
              <button key={i} type="button" className="oc-legend__item" aria-pressed={e.visible !== false} onClick={e.onToggle}>
                <span className={`oc-legend__swatch${e.kind === 'line' ? ' oc-legend__swatch--line' : ''}`} style={{ background: e.color }} />
                {e.label}
              </button>
            ) : (
              <span key={i} className="oc-legend__item">
                <span className={`oc-legend__swatch${e.kind === 'line' ? ' oc-legend__swatch--line' : ''}`} style={{ background: e.color }} />
                {e.label}
              </span>
            ),
          )}
        </div>
      )}

      {note && <p className="oc-chart-note">{note}</p>}

      {showTable && table && (
        <div style={{ marginTop: 'var(--s3)' }}>
          <DataTable columns={table.columns} rows={table.rows} caption={table.caption} maxHeight={320} />
        </div>
      )}
    </div>
  );
}

function ChartHeading({ title, toolbar }: { title: string; toolbar?: ReactNode }) {
  return (
    <div className="oc-chart-toolbar">
      <h3 className="oc-card__title">{title}</h3>
      {toolbar && <div className="oc-btn-row">{toolbar}</div>}
    </div>
  );
}

/** Texture definitions for the colour-vision accessibility channel. */
export function TextureDefs({ count }: { count: number }) {
  return (
    <defs>
      {Array.from({ length: Math.min(count, 8) }, (_, i) => (
        <pattern
          key={i}
          id={`oc-tex-${i}`}
          width="6"
          height="6"
          patternTransform={`rotate(${i % 2 === 0 ? 45 : 135})`}
          patternUnits="userSpaceOnUse"
        >
          <rect width="6" height="6" fill={seriesColor(i)} fillOpacity="0.25" />
          <line x1="0" y1="0" x2="0" y2="6" stroke={seriesColor(i)} strokeWidth="2.2" />
        </pattern>
      ))}
    </defs>
  );
}

/** Build a tooltip body from label/value rows. */
export function TooltipRows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <>
      {rows.map((r, i) => (
        <div key={i} className="oc-chart__tooltip-row">
          <span className="oc-muted">{r.label}</span>
          <span>{r.value}</span>
        </div>
      ))}
    </>
  );
}
