import { useMemo } from 'react'

/**
 * One chart, used by every Phase 4 laboratory.
 *
 * ## Why this exists rather than four copies
 *
 * A circuit transient, a control-loop response, a joint trajectory and a bending-moment diagram are all the same
 * picture: several named series over a shared horizontal axis. Four laboratories each drawing their own would be
 * four places for an axis to be wrong, and the Phase 3 laboratories already showed how much of a surface is axis
 * labelling rather than physics.
 *
 * ## It never redraws more points than the screen has
 *
 * A 2,000-sample transient is 2,000 SVG commands for maybe 700 pixels of width. `thin` keeps the extremes of each
 * bucket rather than taking every nth point, so a spike stays a spike — dropping it would make an overshoot
 * disappear, which in a control laboratory is the single most misleading thing a chart could do.
 *
 * ## Nothing is scaled to look good
 *
 * The vertical range covers the data, with a margin. It is not clipped to hide an excursion and it is not
 * re-centred: an unstable response that runs off to a million is drawn as running off to a million, and the axis
 * says so.
 */

export interface Series {
  id: string
  label: string
  points: readonly { x: number; y: number }[]
  /** A token or colour. The laboratories pass Orbis's own tokens. */
  colour?: string
  /** Drawn as a dashed line: a setpoint, an envelope, a limit. */
  dashed?: boolean
  /** Not counted when working out the vertical range. For an envelope that would otherwise dominate it. */
  ignoreForRange?: boolean
}

export interface Marker {
  /** Where on the horizontal axis. */
  x: number
  label: string
}

export interface PlotProps {
  series: readonly Series[]
  xLabel: string
  yLabel: string
  /** Vertical lines: a peak time, a settling time, a time constant. */
  markers?: readonly Marker[]
  /** A horizontal line at this value, for a target or a limit. */
  zero?: number
  height?: number
  /** Said under the chart. What the picture means, rather than what it is. */
  about?: string
}

const COLOURS = ['var(--cyan)', '#f0a33a', '#37d67a', '#c08bf0', '#e05c5c', '#5cc8e0']

/**
 * Reduces a series to about `most` points, keeping the highest and lowest of each bucket.
 *
 * Taking every nth point is the obvious thing and it is wrong: it drops whichever sample happened to be the peak, so
 * an overshoot of 30% can be drawn as an overshoot of 4%. Keeping both extremes of each bucket preserves the shape
 * of the envelope at the cost of drawing two points where one was asked for.
 */
function thin(points: readonly { x: number; y: number }[], most: number): readonly { x: number; y: number }[] {
  if (points.length <= most) return points
  const buckets = Math.max(1, Math.floor(most / 2))
  const size = points.length / buckets
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < buckets; i += 1) {
    const from = Math.floor(i * size)
    const to = Math.min(points.length, Math.floor((i + 1) * size))
    if (to <= from) continue
    let low = points[from]
    let high = points[from]
    for (let k = from; k < to; k += 1) {
      if (points[k].y < low.y) low = points[k]
      if (points[k].y > high.y) high = points[k]
    }
    // In the order they occurred, so the line does not zig-zag backwards.
    if (low.x <= high.x) out.push(low, high)
    else out.push(high, low)
  }
  return out
}

const tidy = (value: number): string => {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞'
  const size = Math.abs(value)
  if (size === 0) return '0'
  if (size >= 1e6 || size < 1e-3) return value.toExponential(1)
  if (size >= 100) return value.toFixed(0)
  if (size >= 1) return value.toFixed(2)
  return value.toFixed(3)
}

export default function Plot({ series, xLabel, yLabel, markers = [], zero, height = 220, about }: PlotProps): React.JSX.Element {
  const drawn = useMemo(() => {
    const kept = series.filter((one) => one.points.length > 0)
    if (kept.length === 0) return null

    let lowX = Infinity
    let highX = -Infinity
    let lowY = Infinity
    let highY = -Infinity
    for (const one of kept) {
      for (const point of one.points) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
        if (point.x < lowX) lowX = point.x
        if (point.x > highX) highX = point.x
        if (one.ignoreForRange) continue
        if (point.y < lowY) lowY = point.y
        if (point.y > highY) highY = point.y
      }
    }
    if (!Number.isFinite(lowX) || !Number.isFinite(lowY)) return null
    if (zero !== undefined && Number.isFinite(zero)) {
      lowY = Math.min(lowY, zero)
      highY = Math.max(highY, zero)
    }
    if (highX === lowX) highX = lowX + 1
    if (highY === lowY) {
      // A flat series still needs a visible axis, so a margin is made around the single value it holds.
      const margin = Math.max(1e-9, Math.abs(lowY) * 0.1)
      lowY -= margin
      highY += margin
    } else {
      const margin = (highY - lowY) * 0.08
      lowY -= margin
      highY += margin
    }

    const atX = (x: number): number => ((x - lowX) / (highX - lowX)) * 100
    const atY = (y: number): number => 100 - ((y - lowY) / (highY - lowY)) * 100

    const lines = kept.map((one, index) => {
      const points = thin(one.points, 900)
      const path = points
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
        .map((point, k) => `${k === 0 ? 'M' : 'L'}${atX(point.x).toFixed(3)} ${atY(point.y).toFixed(3)}`)
        .join(' ')
      return { id: one.id, label: one.label, path, colour: one.colour ?? COLOURS[index % COLOURS.length], dashed: one.dashed === true }
    })

    return {
      lines,
      lowX,
      highX,
      lowY,
      highY,
      atX,
      atY,
      zeroAt: zero !== undefined && Number.isFinite(zero) ? atY(zero) : null,
      marks: markers
        .filter((one) => Number.isFinite(one.x) && one.x >= lowX && one.x <= highX)
        .map((one) => ({ ...one, at: atX(one.x) }))
    }
  }, [series, markers, zero])

  if (drawn === null) {
    return <p className="p2-faint">Nothing to draw yet.</p>
  }

  return (
    <figure className="p4-plot" style={{ height: `${height}px` }}>
      <span className="p4-plot-y" aria-hidden="true">
        {yLabel}
      </span>
      <div className="p4-plot-area">
        <span className="p4-plot-high" aria-hidden="true">
          {tidy(drawn.highY)}
        </span>
        <span className="p4-plot-low" aria-hidden="true">
          {tidy(drawn.lowY)}
        </span>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${yLabel} against ${xLabel}`}>
          {drawn.zeroAt !== null && (
            <line x1="0" y1={drawn.zeroAt} x2="100" y2={drawn.zeroAt} className="p4-plot-zero" vectorEffect="non-scaling-stroke" />
          )}
          {drawn.marks.map((one) => (
            <line
              key={one.label}
              x1={one.at}
              y1="0"
              x2={one.at}
              y2="100"
              className="p4-plot-mark"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {drawn.lines.map((one) => (
            <path
              key={one.id}
              d={one.path}
              fill="none"
              stroke={one.colour}
              strokeWidth="1.6"
              strokeDasharray={one.dashed ? '4 3' : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
      <div className="p4-plot-x">
        <span>{tidy(drawn.lowX)}</span>
        <span className="p4-plot-x-label">{xLabel}</span>
        <span>{tidy(drawn.highX)}</span>
      </div>
      <figcaption>
        <ul className="p4-legend">
          {drawn.lines.map((one) => (
            <li key={one.id}>
              <span className="p4-swatch" style={{ background: one.colour }} aria-hidden="true" />
              {one.label}
            </li>
          ))}
          {drawn.marks.map((one) => (
            <li key={`m-${one.label}`} className="p4-legend-mark">
              {one.label} at {tidy(one.x)}
            </li>
          ))}
        </ul>
        {about !== undefined && <p className="p2-faint">{about}</p>}
      </figcaption>
    </figure>
  )
}

export { tidy }
