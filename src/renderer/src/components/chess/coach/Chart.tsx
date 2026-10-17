import { useId } from 'react'
import type { Point, Series } from '../../../../../shared/chess/progress'

/**
 * One chart, with its axes named and its gaps left as gaps.
 *
 * The rule the whole component is built around: a bucket with no value is **not** drawn at nought. A week with no
 * attempts and a week where nothing came off look identical on a chart that fills missing values in, and they are
 * completely different facts about somebody's month. So a bucket whose value is null gets a small mark on the
 * baseline and a note saying there was nothing in it, and a line chart breaks rather than sloping through it.
 *
 * Every chart also carries its own numbers underneath, in a table that can be opened. A picture of a measurement
 * that cannot be read as a measurement is decoration, and anything using a screen reader gets nothing at all from
 * an SVG of bars.
 */

const W = 640
const H = 210
const PAD = { left: 52, right: 12, top: 14, bottom: 40 }
const PLOT = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom }

/** A round number at or above the largest value, so the top of the scale is a number a person would choose. */
function topOf(series: Series): number {
  if (series.unit === 'share') return 1
  const max = series.max ?? 0
  if (max <= 0) return 1
  const size = Math.pow(10, Math.floor(Math.log10(max)))
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = size * step
    if (candidate >= max) return candidate
  }
  return size * 10
}

const show = (value: number, unit: Series['unit']): string =>
  unit === 'share' ? `${Math.round(value * 100)}%` : unit === 'minutes' ? `${Math.round(value)} min` : String(Math.round(value))

const axisNumber = (value: number, unit: Series['unit']): string =>
  unit === 'share' ? `${Math.round(value * 100)}%` : String(Math.round(value * 10) / 10)

/** At most seven labels along the bottom, so they do not pile on top of each other. */
function labelAt(index: number, count: number): boolean {
  if (count <= 7) return true
  const every = Math.ceil(count / 7)
  return index % every === 0 || index === count - 1
}

export function Chart({ series }: { series: Series }): React.JSX.Element {
  const id = useId()
  const points = series.points
  const top = topOf(series)
  const step = points.length > 0 ? PLOT.w / points.length : PLOT.w
  const x = (index: number): number => PAD.left + (index + 0.5) * step
  const y = (value: number): number => PAD.top + (1 - Math.max(0, Math.min(1, value / top))) * PLOT.h
  const baseline = PAD.top + PLOT.h
  const ticks = series.unit === 'share' ? [0, 0.25, 0.5, 0.75, 1] : [0, top / 2, top]
  const asLine = series.unit === 'share'

  /** Consecutive runs of buckets that have a value. A gap ends a run rather than being drawn through. */
  const runs: { index: number; point: Point }[][] = []
  let run: { index: number; point: Point }[] = []
  for (const [index, point] of points.entries()) {
    if (point.value === null) {
      if (run.length > 0) runs.push(run)
      run = []
      continue
    }
    run.push({ index, point })
  }
  if (run.length > 0) runs.push(run)

  const withValue = points.filter((one) => one.value !== null)
  const summary = withValue.length === 0
    ? `${series.title}: nothing to show in ${series.range.label}.`
    : `${series.title}, ${series.axisY} by ${series.axisX.toLowerCase()}, over ${series.range.label}. `
      + `Highest ${show(series.max ?? 0, series.unit)}; ${series.gaps} of ${points.length} with nothing in them.`

  return (
    <figure className="cw-co-chart">
      <figcaption className="cw-co-chart-top">
        <strong>{series.title}</strong>
        <span className="cw-co-dim">{series.range.label}</span>
      </figcaption>

      <svg className="cw-co-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} preserveAspectRatio="none">
        {ticks.map((tick) => (
          <g key={`t${tick}`}>
            <line className="cw-co-grid" x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} />
            <text className="cw-co-tick" x={PAD.left - 8} y={y(tick) + 4} textAnchor="end">{axisNumber(tick, series.unit)}</text>
          </g>
        ))}
        <line className="cw-co-axis" x1={PAD.left} x2={W - PAD.right} y1={baseline} y2={baseline} />
        <line className="cw-co-axis" x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={baseline} />

        {points.map((point, index) => (
          point.value === null
            ? (
              <g key={`${point.from}`}>
                <line className="cw-co-nothing" x1={x(index) - Math.min(6, step / 3)} x2={x(index) + Math.min(6, step / 3)} y1={baseline - 3} y2={baseline - 3} />
                <title>{`${point.label}: nothing recorded`}</title>
              </g>
            )
            : asLine
              ? (
                <circle key={`${point.from}`} className="cw-co-dot" cx={x(index)} cy={y(point.value)} r={3}>
                  <title>{`${point.label}: ${show(point.value, series.unit)} from ${point.n}`}</title>
                </circle>
              )
              : (
                <rect
                  key={`${point.from}`}
                  className="cw-co-bar"
                  x={x(index) - Math.max(1, step * 0.35)}
                  y={point.value <= 0 ? baseline - 1 : y(point.value)}
                  width={Math.max(2, step * 0.7)}
                  height={point.value <= 0 ? 1 : Math.max(1, baseline - y(point.value))}
                >
                  <title>{`${point.label}: ${show(point.value, series.unit)}`}</title>
                </rect>
              )
        ))}

        {asLine && runs.map((segment) => (
          <polyline
            key={`line${segment[0].index}`}
            className="cw-co-line"
            points={segment.map((one) => `${x(one.index)},${y(one.point.value as number)}`).join(' ')}
          />
        ))}

        {points.map((point, index) => (
          labelAt(index, points.length)
            ? <text key={`x${point.from}`} className="cw-co-tick" x={x(index)} y={baseline + 16} textAnchor="middle">{point.label}</text>
            : null
        ))}

        <text className="cw-co-axis-name" x={PAD.left + PLOT.w / 2} y={H - 6} textAnchor="middle">{series.axisX}</text>
        <text className="cw-co-axis-name" x={12} y={PAD.top + PLOT.h / 2} textAnchor="middle" transform={`rotate(-90 12 ${PAD.top + PLOT.h / 2})`}>{series.axisY}</text>
      </svg>

      <p className="cw-co-dim cw-co-chart-note">{series.says}</p>

      <details className="cw-co-numbers">
        <summary>Show the numbers</summary>
        <table aria-describedby={`${id}-cap`}>
          <caption id={`${id}-cap`}>{`${series.title}. ${series.axisY} by ${series.axisX.toLowerCase()}, over ${series.range.label}.`}</caption>
          <thead>
            <tr>
              <th scope="col">{series.axisX}</th>
              <th scope="col">{series.axisY}</th>
              <th scope="col">From how many</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={`r${point.from}`}>
                <th scope="row">{point.label}</th>
                <td>{point.value === null ? 'nothing recorded' : show(point.value, series.unit)}</td>
                <td>{point.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
