import { allPoints, colourFor, decimate, PLOT_LIMITS, pointCount, positionOn, type Axis, type Plot } from '../compute/plot.ts'
import { isInterchangeError, readXml, hashOf, type VerifyResult } from '../compute/interchange.ts'
import type { Artifact, ArtifactObject, Connector } from '../pages/builders.ts'

/**
 * A plot drawn, and a diagram drawn, as SVG.
 *
 * The maths is not here. `plot.ts` already decides the ranges, the ticks, the scales and where a value sits on an
 * axis; there are nine hand-rolled copies of that in the renderer and this is deliberately not the tenth. This file
 * turns those decisions into elements, and it keeps three promises the plot engine made:
 *
 *   - a series is a list of segments, and a segment that ends because of a discontinuity or a gap is drawn as a
 *     break, never joined across;
 *   - a bar or an area starts from zero, because a bar starting anywhere else draws a length that is not
 *     proportional to its value;
 *   - more points than can be drawn are decimated with every spike kept, and the number drawn is said.
 *
 * Colours are fixed, not theme tokens: this is a file that opens in a browser, in Illustrator, in a PDF -- anywhere
 * but Orbis -- so it cannot ask a theme for anything. The series palette is the plot engine's own.
 */

export const escapeXml = (text: string): string =>
  String(text ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c)

export interface SvgResult {
  svg: string
  notes: string[]
}

export interface PlotSvgOptions {
  width?: number
  height?: number
  /** A colour per series, in order. Defaults to the plot engine's colourblind-safe set. */
  colours?: readonly string[]
}

const FONT = 'font-family="Segoe UI, system-ui, -apple-system, Helvetica, Arial, sans-serif"'
const INK = '#1a1d24'
const MUTED = '#6b7280'
const GRID = '#e1e4ea'
const PAPER = '#ffffff'

const round = (n: number): string => (Math.round(n * 100) / 100).toString()

/** A y value on a bar or area axis, or the axis bottom when zero is below it (which the engine prevents, but safely). */
const baselineOf = (axis: Axis): number => {
  const zero = positionOn(axis, 0)
  return zero === null ? 0 : Math.min(1, Math.max(0, zero))
}

/** A label for an axis: its label and, when there is one, its unit. */
const axisTitle = (axis: Axis): string => (axis.unit ? `${axis.label} (${axis.unit.display})` : axis.label)

export function plotToSvg(plot: Plot, options: PlotSvgOptions = {}): SvgResult {
  const width = Math.max(320, Math.round(options.width ?? 880))
  const height = Math.max(240, Math.round(options.height ?? 520))
  const colours = options.colours ?? []
  const notes: string[] = [...plot.notes]

  const hasLegend = plot.series.length > 1 || plot.series.some((one) => one.provenance === 'simulated')
  const margin = { top: plot.title ? 48 : 20, right: 24, bottom: plot.x.label || plot.x.unit ? 64 : 44, left: plot.y.label || plot.y.unit ? 76 : 56 }
  const legendHeight = hasLegend ? 22 : 0
  const left = margin.left
  const top = margin.top + legendHeight
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - top - margin.bottom

  const sx = (value: number): number | null => {
    const p = positionOn(plot.x, value)
    return p === null ? null : left + p * plotWidth
  }
  const sy = (value: number): number | null => {
    const p = positionOn(plot.y, value)
    return p === null ? null : top + plotHeight - p * plotHeight
  }

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(plot.title || 'Plot')}">`)
  parts.push(`<rect width="${width}" height="${height}" fill="${PAPER}"/>`)
  if (plot.title) parts.push(`<text x="${left}" y="28" ${FONT} font-size="16" font-weight="600" fill="${INK}">${escapeXml(plot.title)}</text>`)

  // Grid and ticks, from the axes the engine made. A minor tick gets a line and no label.
  for (const tick of plot.y.ticks) {
    const y = sy(tick.value)
    if (y === null) continue
    parts.push(`<line x1="${left}" y1="${round(y)}" x2="${left + plotWidth}" y2="${round(y)}" stroke="${GRID}" stroke-width="${tick.major ? 1 : 0.5}"/>`)
    if (tick.major) parts.push(`<text x="${left - 8}" y="${round(y + 4)}" text-anchor="end" ${FONT} font-size="11" fill="${MUTED}">${escapeXml(tick.label)}</text>`)
  }
  for (const tick of plot.x.ticks) {
    const x = sx(tick.value)
    if (x === null) continue
    parts.push(`<line x1="${round(x)}" y1="${top}" x2="${round(x)}" y2="${top + plotHeight}" stroke="${GRID}" stroke-width="${tick.major ? 1 : 0.5}"/>`)
    if (tick.major) parts.push(`<text x="${round(x)}" y="${top + plotHeight + 18}" text-anchor="middle" ${FONT} font-size="11" fill="${MUTED}">${escapeXml(tick.label)}</text>`)
  }
  // The frame, and the axis titles.
  parts.push(`<rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" fill="none" stroke="#c9ced8" stroke-width="1"/>`)
  if (plot.x.label || plot.x.unit) parts.push(`<text x="${left + plotWidth / 2}" y="${height - 14}" text-anchor="middle" ${FONT} font-size="12" fill="${INK}">${escapeXml(axisTitle(plot.x))}</text>`)
  if (plot.y.label || plot.y.unit) parts.push(`<text transform="translate(18 ${top + plotHeight / 2}) rotate(-90)" text-anchor="middle" ${FONT} font-size="12" fill="${INK}">${escapeXml(axisTitle(plot.y))}</text>`)

  // Bars share the x positions, so their width comes from the smallest gap between any two drawn x values.
  const bars = plot.series.filter((one) => one.kind === 'bar')
  let barWidth = 0
  if (bars.length > 0) {
    const xs = [...new Set(bars.flatMap((one) => allPoints(one).map((p) => p.x)))].sort((a, b) => a - b)
    let gap = Number.POSITIVE_INFINITY
    for (let i = 1; i < xs.length; i++) gap = Math.min(gap, xs[i] - xs[i - 1])
    const span = plot.x.range.high - plot.x.range.low || 1
    const gapPx = Number.isFinite(gap) ? (gap / span) * plotWidth : plotWidth / 2
    barWidth = Math.max(2, (gapPx * 0.72) / bars.length)
  }
  let barSlot = 0

  const baseline = top + plotHeight - baselineOf(plot.y) * plotHeight
  plot.series.forEach((series, index) => {
    const colour = colours[index] ?? colourFor(index)
    const dashed = series.provenance === 'simulated' ? ' stroke-dasharray="6 4"' : ''
    notes.push(...series.notes.map((one) => `${series.label}: ${one}`))

    // Too many points to draw are decimated here, every spike kept, and the count is said.
    const total = pointCount(series)
    const segments = total > PLOT_LIMITS.drawablePoints ? series.segments.map((segment) => ({ ...segment, points: decimate(segment.points, Math.max(50, Math.floor((PLOT_LIMITS.drawablePoints * segment.points.length) / total))).points })) : series.segments
    if (total > PLOT_LIMITS.drawablePoints) notes.push(`${series.label}: ${segments.reduce((n, s) => n + s.points.length, 0).toLocaleString('en')} of ${total.toLocaleString('en')} points drawn, keeping every high and low.`)

    if (series.kind === 'bar') {
      const offset = -((bars.length - 1) / 2) * barWidth + barSlot * barWidth
      barSlot += 1
      for (const point of allPoints(series)) {
        const x = sx(point.x)
        const y = sy(point.y)
        if (x === null || y === null) continue
        const topY = Math.min(y, baseline)
        parts.push(`<rect x="${round(x + offset - barWidth / 2)}" y="${round(topY)}" width="${round(barWidth)}" height="${round(Math.abs(baseline - y))}" fill="${colour}" fill-opacity="0.9"/>`)
      }
    } else if (series.kind === 'scatter') {
      for (const point of allPoints(series)) {
        const x = sx(point.x)
        const y = sy(point.y)
        if (x === null || y === null) continue
        parts.push(`<circle cx="${round(x)}" cy="${round(y)}" r="3.2" fill="${colour}" fill-opacity="0.85"/>`)
      }
    } else {
      for (const segment of segments) {
        const placed = segment.points.map((p) => ({ x: sx(p.x), y: sy(p.y) })).filter((p): p is { x: number; y: number } => p.x !== null && p.y !== null)
        if (placed.length === 0) continue
        let d = ''
        placed.forEach((p, i) => {
          if (i === 0) d += `M${round(p.x)} ${round(p.y)}`
          else if (series.kind === 'step') d += ` H${round(p.x)} V${round(p.y)}`
          else d += ` L${round(p.x)} ${round(p.y)}`
        })
        if (series.kind === 'area') {
          const first = placed[0]
          const last = placed[placed.length - 1]
          parts.push(`<path d="${d} L${round(last.x)} ${round(baseline)} L${round(first.x)} ${round(baseline)} Z" fill="${colour}" fill-opacity="0.22" stroke="none"/>`)
        }
        parts.push(`<path d="${d}" fill="none" stroke="${colour}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"${dashed}/>`)
        // A segment that ends because the curve breaks is marked, so a gap reads as a gap and not as a missed line.
        if (segment.endsBecause === 'discontinuity' || segment.endsBecause === 'undefined') {
          const end = placed[placed.length - 1]
          parts.push(`<circle cx="${round(end.x)}" cy="${round(end.y)}" r="2.6" fill="${PAPER}" stroke="${colour}" stroke-width="1.4"/>`)
        }
      }
    }

    // Error bars, where the series carries them: one per point, in order.
    if (series.errorY.length > 0) {
      const points = allPoints(series)
      points.forEach((point, i) => {
        const err = series.errorY[i]
        if (!Number.isFinite(err) || err <= 0) return
        const x = sx(point.x)
        const yLow = sy(point.y - err)
        const yHigh = sy(point.y + err)
        if (x === null || yLow === null || yHigh === null) return
        parts.push(`<line x1="${round(x)}" y1="${round(yHigh)}" x2="${round(x)}" y2="${round(yLow)}" stroke="${colour}" stroke-width="1"/>`)
        parts.push(`<line x1="${round(x - 3)}" y1="${round(yHigh)}" x2="${round(x + 3)}" y2="${round(yHigh)}" stroke="${colour}" stroke-width="1"/>`)
        parts.push(`<line x1="${round(x - 3)}" y1="${round(yLow)}" x2="${round(x + 3)}" y2="${round(yLow)}" stroke="${colour}" stroke-width="1"/>`)
      })
    }
  })

  if (hasLegend) {
    let x = left
    const y = margin.top + 6
    plot.series.forEach((series, index) => {
      const colour = colours[index] ?? colourFor(index)
      const label = series.provenance === 'simulated' ? `${series.label} (simulated)` : series.label
      parts.push(`<line x1="${x}" y1="${y}" x2="${x + 18}" y2="${y}" stroke="${colour}" stroke-width="2.4"${series.provenance === 'simulated' ? ' stroke-dasharray="6 4"' : ''}/>`)
      parts.push(`<text x="${x + 24}" y="${y + 4}" ${FONT} font-size="11" fill="${INK}">${escapeXml(label)}</text>`)
      x += 24 + label.length * 6.4 + 18
    })
  }

  parts.push('</svg>')
  return { svg: parts.join('\n'), notes }
}

// ---------------------------------------------------------------- diagrams

/** The point where a line from `from`'s centre towards `to`'s centre leaves `from`'s box. */
const centreOf = (object: ArtifactObject): { x: number; y: number } => ({ x: object.box.x + object.box.width / 2, y: object.box.y + object.box.height / 2 })

/** Where a line from the centre of a box towards a point leaves the box. */
const edgePoint = (from: ArtifactObject, towards: { x: number; y: number }): { x: number; y: number } => {
  const cx = from.box.x + from.box.width / 2
  const cy = from.box.y + from.box.height / 2
  const tx = towards.x
  const ty = towards.y
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : from.box.width / 2 / Math.abs(dx)
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : from.box.height / 2 / Math.abs(dy)
  const t = Math.min(scaleX, scaleY)
  return { x: cx + dx * t, y: cy + dy * t }
}

/** Text wrapped to fit a box, roughly: by character count, which is what a file with no font metrics can do. */
const wrap = (text: string, width: number, size: number): string[] => {
  const perLine = Math.max(4, Math.floor(width / (size * 0.56)))
  const words = text.split(/\s+/).filter((one) => one !== '')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (current !== '' && (current + ' ' + word).length > perLine) {
      lines.push(current)
      current = word
    } else current = current === '' ? word : `${current} ${word}`
  }
  if (current !== '') lines.push(current)
  return lines.slice(0, 6)
}

const SHAPE_FILL: Record<string, string> = { decision: '#fff4d6', start: '#e3f6ec', end: '#e3f6ec', step: '#eef2ff', node: '#f4f5f8' }

export function diagramToSvg(diagram: Artifact, padding = 24): SvgResult {
  const shown = diagram.objects.filter((one) => !one.hidden)
  const notes: string[] = []
  if (shown.length === 0) {
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80"><rect width="200" height="80" fill="${PAPER}"/><text x="100" y="45" text-anchor="middle" ${FONT} font-size="12" fill="${MUTED}">Nothing to draw</text></svg>`, notes: ['The diagram has no visible objects.'] }
  }
  // The paper covers every box and every bend an arrow makes: a loop routed round the boxes runs outside them, and a
  // paper sized to the boxes alone would cut it off.
  const shownIds = new Set(shown.map((one) => one.id))
  const bends = diagram.connectors.filter((one) => shownIds.has(one.from) && shownIds.has(one.to)).flatMap((one) => one.waypoints)
  const minX = Math.min(...shown.map((one) => one.box.x), ...bends.map((one) => one.x))
  const minY = Math.min(...shown.map((one) => one.box.y), ...bends.map((one) => one.y))
  const maxX = Math.max(...shown.map((one) => one.box.x + one.box.width), ...bends.map((one) => one.x))
  const maxY = Math.max(...shown.map((one) => one.box.y + one.box.height), ...bends.map((one) => one.y))
  const width = Math.ceil(maxX - minX + padding * 2)
  const height = Math.ceil(maxY - minY + padding * 2)
  const shift = (p: { x: number; y: number }): { x: number; y: number } => ({ x: p.x - minX + padding, y: p.y - minY + padding })
  const byId = new Map(shown.map((one) => [one.id, one]))

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(diagram.title)}">`)
  parts.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${INK}"/></marker></defs>`)
  parts.push(`<rect width="${width}" height="${height}" fill="${PAPER}"/>`)

  let dropped = 0
  for (const connector of diagram.connectors) {
    const from = byId.get(connector.from)
    const to = byId.get(connector.to)
    if (!from || !to) {
      dropped += 1
      continue
    }
    // Each end leaves its box towards the nearest waypoint, or towards the other box when there are none.
    const first = connector.waypoints[0]
    const last = connector.waypoints[connector.waypoints.length - 1]
    const points = [
      shift(edgePoint(from, first ?? centreOf(to))),
      ...connector.waypoints.map(shift),
      shift(edgePoint(to, last ?? centreOf(from)))
    ]
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ')
    parts.push(`<path d="${d}" fill="none" stroke="${INK}" stroke-width="1.4" marker-end="url(#arrow)"/>`)
    if (connector.text) {
      const mid = points[Math.floor(points.length / 2)]
      const prev = points[Math.floor(points.length / 2) - 1] ?? mid
      const lx = (mid.x + prev.x) / 2
      const ly = (mid.y + prev.y) / 2
      const w = connector.text.length * 6.6 + 10
      parts.push(`<rect x="${round(lx - w / 2)}" y="${round(ly - 9)}" width="${round(w)}" height="16" rx="3" fill="${PAPER}" fill-opacity="0.92"/>`)
      parts.push(`<text x="${round(lx)}" y="${round(ly + 3)}" text-anchor="middle" ${FONT} font-size="11" fill="${MUTED}">${escapeXml(connector.text)}</text>`)
    }
  }
  if (dropped > 0) notes.push(`${dropped} connector${dropped === 1 ? '' : 's'} point${dropped === 1 ? 's' : ''} at an object that is not there and ${dropped === 1 ? 'was' : 'were'} not drawn.`)

  for (const object of shown) {
    const p = shift(object.box)
    const fill = SHAPE_FILL[object.type] ?? SHAPE_FILL.node
    if (object.type === 'decision') {
      const cx = p.x + object.box.width / 2
      const cy = p.y + object.box.height / 2
      parts.push(`<polygon points="${round(cx)},${round(p.y)} ${round(p.x + object.box.width)},${round(cy)} ${round(cx)},${round(p.y + object.box.height)} ${round(p.x)},${round(cy)}" fill="${fill}" stroke="${INK}" stroke-width="1.2"/>`)
    } else {
      const rx = object.type === 'start' || object.type === 'end' ? Math.min(object.box.height / 2, 24) : 6
      parts.push(`<rect x="${round(p.x)}" y="${round(p.y)}" width="${round(object.box.width)}" height="${round(object.box.height)}" rx="${rx}" fill="${fill}" stroke="${INK}" stroke-width="1.2"/>`)
    }
    const lines = wrap(object.text, object.box.width - 16, 12)
    const startY = p.y + object.box.height / 2 - ((lines.length - 1) * 15) / 2 + 4
    lines.forEach((line, i) => {
      parts.push(`<text x="${round(p.x + object.box.width / 2)}" y="${round(startY + i * 15)}" text-anchor="middle" ${FONT} font-size="12" fill="${INK}">${escapeXml(line)}</text>`)
    })
  }
  parts.push('</svg>')
  return { svg: parts.join('\n'), notes }
}

// ---------------------------------------------------------------- reading an SVG back

const formatBytes = (count: number): string => (count < 1024 ? `${count} B` : count < 1024 * 1024 ? `${(count / 1024).toFixed(1)} KB` : `${(count / (1024 * 1024)).toFixed(1)} MB`)

/** An SVG file read back: size, hash, that it parses as SVG, and that something is drawn in it. */
export function verifySvgFile(expected: { bytes: number; hash: string }, readBack: Uint8Array): VerifyResult {
  const checks: VerifyResult['checks'] = [
    { what: 'written', passed: readBack.length === expected.bytes, describe: `The file on disk is ${formatBytes(readBack.length)}; ${formatBytes(expected.bytes)} was written.` },
    { what: 'checksum', passed: hashOf(readBack) === expected.hash, describe: 'The hash of the file on disk matches the one recorded when it was written.' }
  ]
  const text = new TextDecoder().decode(readBack)
  const parsed = readXml(text)
  const isSvg = !isInterchangeError(parsed) && parsed.name === 'svg'
  checks.push({ what: 'svg', passed: isSvg, describe: isSvg ? 'The file parses as SVG.' : `The file does not parse as SVG${isInterchangeError(parsed) ? `: ${parsed.message}` : ''}.` })
  const drawn = (text.match(/<(path|rect|circle|line|polygon|text)[\s/>]/g) ?? []).length - 1
  checks.push({ what: 'drawn', passed: drawn > 0, describe: drawn > 0 ? `${drawn} element${drawn === 1 ? '' : 's'} drawn.` : 'Nothing is drawn in it.' })
  return { ok: checks.every((one) => one.passed), checks, reimported: drawn > 0 ? { rows: drawn, columns: 0 } : null, differences: [] }
}

export type { Connector }
