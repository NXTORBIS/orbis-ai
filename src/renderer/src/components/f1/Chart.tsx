import { useMemo, useRef, useState } from 'react'
import { estimateCorners } from '../../../../shared/f1/extras'

export interface Series {
  id: string
  label: string
  colour: string
  points: { x: number; y: number | null }[]
  /** Draw as steps (gear, DRS) rather than a sloped line. */
  step?: boolean
  dashed?: boolean
}

interface LineChartProps {
  series: Series[]
  height?: number
  xLabel: string
  yLabel: string
  xFormat?: (x: number) => string
  yFormat?: (y: number) => string
  /** The shared x position being inspected, or null. */
  cursor?: number | null
  onCursor?: (x: number | null) => void
  yDomain?: [number, number]
  /** Horizontal reference line, e.g. 0 for a delta. */
  zero?: boolean
  /** Spans of x to shade (e.g. a safety-car period). */
  bands?: { from: number; to: number; colour: string; label: string }[]
  /** An accessible description of what the chart shows. */
  description: string
}

const W = 900
const PAD = { l: 54, r: 14, t: 10, b: 30 }

function ticks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo)) return [lo]
  const raw = (hi - lo) / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step)
  return out
}

/** A multi-series line chart in plain SVG: axes, a hover cursor shared with other charts, optional bands, and no gaps bridged. */
export function LineChart(p: LineChartProps): React.JSX.Element {
  const { series, height = 150, cursor = null, onCursor } = p
  const ref = useRef<SVGSVGElement>(null)
  const [local, setLocal] = useState<number | null>(null)
  const active = cursor ?? local

  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const s of series)
      for (const pt of s.points) {
        if (pt.x < x0) x0 = pt.x
        if (pt.x > x1) x1 = pt.x
        if (pt.y !== null) {
          if (pt.y < y0) y0 = pt.y
          if (pt.y > y1) y1 = pt.y
        }
      }
    if (!Number.isFinite(x0)) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }
    if (p.yDomain) {
      y0 = p.yDomain[0]
      y1 = p.yDomain[1]
    } else {
      if (p.zero) {
        y0 = Math.min(y0, 0)
        y1 = Math.max(y1, 0)
      }
      const span = y1 - y0 || 1
      y0 -= span * 0.06
      y1 += span * 0.06
    }
    return { xMin: x0, xMax: x1 > x0 ? x1 : x0 + 1, yMin: y0, yMax: y1 > y0 ? y1 : y0 + 1 }
  }, [series, p.yDomain, p.zero])

  const X = (x: number): number => PAD.l + ((x - xMin) / (xMax - xMin)) * (W - PAD.l - PAD.r)
  const Y = (y: number): number => PAD.t + (1 - (y - yMin) / (yMax - yMin)) * (height - PAD.t - PAD.b)
  const xf = p.xFormat ?? ((x: number) => String(Math.round(x)))
  const yf = p.yFormat ?? ((y: number) => String(Math.round(y * 100) / 100))

  const path = (s: Series): string => {
    let d = ''
    let pen = false
    let prevY = 0
    for (const pt of s.points) {
      if (pt.y === null) {
        pen = false
        continue
      }
      if (!pen) d += `M${X(pt.x).toFixed(1)},${Y(pt.y).toFixed(1)}`
      else if (s.step) d += `H${X(pt.x).toFixed(1)}V${Y(pt.y).toFixed(1)}`
      else d += `L${X(pt.x).toFixed(1)},${Y(pt.y).toFixed(1)}`
      pen = true
      prevY = pt.y
    }
    void prevY
    return d
  }

  const move = (e: React.PointerEvent<SVGSVGElement>): void => {
    const r = ref.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    const px = ((e.clientX - r.left) / r.width) * W
    const x = xMin + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (xMax - xMin)
    const clamped = Math.max(xMin, Math.min(xMax, x))
    setLocal(clamped)
    onCursor?.(clamped)
  }
  const leave = (): void => {
    setLocal(null)
    onCursor?.(null)
  }

  const at = (s: Series, x: number): number | null => {
    let best: { x: number; y: number | null } | null = null
    for (const pt of s.points) if (best === null || Math.abs(pt.x - x) < Math.abs(best.x - x)) best = pt
    return best?.y ?? null
  }

  return (
    <figure className="f1-chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} role="img" aria-label={p.description} onPointerMove={move} onPointerLeave={leave} preserveAspectRatio="none" style={{ height }}>
        {(p.bands ?? []).map((b, i) => (
          <rect key={i} x={X(b.from)} y={PAD.t} width={Math.max(1, X(b.to) - X(b.from))} height={height - PAD.t - PAD.b} fill={b.colour} opacity={0.14}>
            <title>{b.label}</title>
          </rect>
        ))}
        {(p.yDomain && p.yDomain[1] - p.yDomain[0] < 2 ? [0, 1] : ticks(yMin, yMax, 4)).map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(v)} y2={Y(v)} className="f1-grid" />
            <text x={PAD.l - 6} y={Y(v) + 4} textAnchor="end" className="f1-axis">
              {yf(v)}
            </text>
          </g>
        ))}
        {ticks(xMin, xMax, 6).map((v) => (
          <text key={`x${v}`} x={X(v)} y={height - 10} textAnchor="middle" className="f1-axis">
            {xf(v)}
          </text>
        ))}
        {p.zero && <line x1={PAD.l} x2={W - PAD.r} y1={Y(0)} y2={Y(0)} className="f1-zero" />}
        {series.map((s) => (
          <path key={s.id} d={path(s)} fill="none" stroke={s.colour} strokeWidth={1.6} strokeDasharray={s.dashed ? '5 4' : undefined} vectorEffect="non-scaling-stroke" />
        ))}
        {active !== null && <line x1={X(active)} x2={X(active)} y1={PAD.t} y2={height - PAD.b} className="f1-cursor" />}
        <text x={W - PAD.r} y={height - 1} textAnchor="end" className="f1-axis-title">
          {p.xLabel}
        </text>
        <text x={W - PAD.r} y={9} textAnchor="end" className="f1-axis-title">
          {p.yLabel}
        </text>
      </svg>
      <figcaption className="f1-chart-legend">
        {series.map((s) => (
          <span key={s.id}>
            <i style={{ background: s.colour }} aria-hidden="true" />
            {s.label}
            {active !== null && <b> {(() => { const v = at(s, active); return v === null ? '–' : yf(v) })()}</b>}
          </span>
        ))}
        {active !== null && <span className="f1-at">at {xf(active)}</span>}
      </figcaption>
    </figure>
  )
}

export interface MapCar {
  number: string
  code: string
  x: number
  y: number
  colour: string
  speed?: number | null
  selected?: boolean
}

/** The circuit outline from real position readings, with cars (and a marker) on it. Draws nothing when there is no outline. */
export function TrackMap({
  outline,
  cars = [],
  marker = null,
  trail,
  height = 360,
  corners = false
}: {
  outline: { x: number; y: number }[] | null
  cars?: MapCar[]
  marker?: { x: number; y: number } | null
  /** A coloured path (e.g. the lap by speed): segments with a value 0..1. */
  trail?: { x: number; y: number; v: number }[]
  height?: number
  /** Number the corners, estimated from the shape of the lap (the providers publish no corner numbers). */
  corners?: boolean
}): React.JSX.Element {
  const box = useMemo(() => {
    const pts: { x: number; y: number }[] = [...(outline ?? []), ...(trail ?? [])]
    if (pts.length === 0) return null
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const p of pts) {
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x)
      y1 = Math.max(y1, p.y)
    }
    const pad = Math.max(x1 - x0, y1 - y0) * 0.06 || 1
    return { x0: x0 - pad, y0: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad }
  }, [outline, trail])
  if (!box || (!outline && !trail)) return <p className="f1-note">No circuit outline yet: it is drawn from real position readings, and none are available for this view.</p>
  // The feed's y grows upward; the screen's grows downward.
  const px = (x: number): number => x - box.x0
  const py = (y: number): number => box.h - (y - box.y0)
  const colour = (v: number): string => `hsl(${Math.round(240 - 240 * Math.max(0, Math.min(1, v)))} 90% 55%)`
  const unit = box.w / 120
  const turns = useMemo(() => (corners && outline ? estimateCorners(outline) : []), [corners, outline])
  return (
    <svg className="f1-map" viewBox={`0 0 ${box.w} ${box.h}`} style={{ height }} role="img" aria-label="The circuit, drawn from position readings">
      {outline && <polyline points={outline.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')} fill="none" stroke="rgba(255,255,255,.25)" strokeWidth={unit * 2.2} strokeLinejoin="round" strokeLinecap="round" />}
      {trail && trail.slice(1).map((p, i) => <line key={i} x1={px(trail[i].x)} y1={py(trail[i].y)} x2={px(p.x)} y2={py(p.y)} stroke={colour(p.v)} strokeWidth={unit * 1.6} strokeLinecap="round" />)}
      {cars.map((c) => (
        <g key={c.number} transform={`translate(${px(c.x)},${py(c.y)})`}>
          <circle r={unit * (c.selected ? 3.2 : 2.4)} fill={`#${c.colour}`} stroke="#fff" strokeWidth={unit * 0.4} />
          <text y={-unit * 3.4} textAnchor="middle" fontSize={unit * 3.2} fill="#fff">
            {c.code}
          </text>
        </g>
      ))}
      {turns.map((c) => (
        <g key={`c${c.number}`} transform={`translate(${px(c.x)},${py(c.y)})`}>
          <title>{`Corner ${c.number} (estimated from the lap’s shape)`}</title>
          <circle r={unit * 2} fill="rgba(8,12,22,.85)" stroke="rgba(255,255,255,.55)" strokeWidth={unit * 0.25} />
          <text y={unit * 0.9} textAnchor="middle" fontSize={unit * 2.4} fill="#fff">
            {c.number}
          </text>
        </g>
      ))}
      {marker && <circle cx={px(marker.x)} cy={py(marker.y)} r={unit * 3} fill="none" stroke="#fff" strokeWidth={unit * 0.7} />}
    </svg>
  )
}
