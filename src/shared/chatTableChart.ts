/**
 * A chart from a table in a chat reply.
 *
 * The drawing is the plot engine's (`compute/plot.ts` decides ranges, ticks and baselines; `artifacts/svg.ts` draws it):
 * this file only decides *whether* a table is a chart and which of its columns are the numbers. It is deliberately
 * cautious, because a chart of something that is not a series of numbers is a picture of nothing:
 *
 *  - the first column is the label, and at least one other column must be numbers (70% of its cells, and the same unit
 *    in every cell: "12 ms" next to "3 GB" is not one axis);
 *  - between three and twenty-four rows;
 *  - columns whose unit differs from the first numeric column's are left out, and the notes say so;
 *  - a cell that is not a number ("n/a", a dash) is a gap, never zero.
 */
import { buildPlot, isPlotError, seriesFromPoints, type Plot, type Series, type SeriesKind } from './compute/plot.ts'

export interface ChartableTable {
  title: string
  kind: SeriesKind
  plot: Plot
  columns: string[]
  notes: string[]
}

const MISSING = /^(?:|[-–—−]|n\/?a|nan|none|null|unknown|tbd|\?)$/i
const UNIT_SUFFIX = /^(.*?)(?:\s*)(%|[a-zA-Zµ°/²³]{1,5})$/

/** "1,234.5", "$12", "45%", "(3.2)", "12 ms", "−7" -> its number and the unit it carried. Null when it is not a number. */
export function parseCell(raw: string): { value: number; unit: string } | null {
  let t = raw.replace(/\*\*|__|`/g, '').trim()
  if (MISSING.test(t)) return null
  let negative = false
  if (/^\(.*\)$/.test(t)) {
    negative = true
    t = t.slice(1, -1).trim()
  }
  t = t.replace(/^[−–]/, '-')
  let unit = ''
  const currency = /^([$€£₹¥])\s*(.*)$/.exec(t)
  if (currency) {
    unit = currency[1]
    t = currency[2]
  }
  const m = UNIT_SUFFIX.exec(t)
  if (m && /\d/.test(m[1])) {
    // "1,234 ms" -> "1,234" and "ms"; a bare number matches neither group's suffix and falls through below.
    t = m[1]
    if (!unit) unit = m[2]
  }
  t = t.replace(/(?<=\d),(?=\d{3}(\D|$))/g, '').replace(/\s+/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null
  const v = Number(t)
  if (!Number.isFinite(v)) return null
  return { value: negative ? -v : v, unit }
}

/**
 * The chart a table supports, or null when it supports none. `header` and `rows` are the cells' text exactly as shown.
 */
export function tableChart(header: readonly string[], rows: readonly (readonly string[])[]): ChartableTable | null {
  if (header.length < 2 || rows.length < 3 || rows.length > 24) return null
  const cols = header.length
  const parsed = Array.from({ length: cols }, (_, c) => rows.map((r) => parseCell(r[c] ?? '')))
  const numeric: { index: number; unit: string }[] = []
  for (let c = 1; c < cols; c++) {
    const cells = parsed[c]
    const present = cells.filter((x): x is { value: number; unit: string } => x !== null)
    if (present.length < Math.ceil(rows.length * 0.7) || present.length < 3) continue
    const units = new Set(present.map((p) => p.unit))
    if (units.size !== 1) continue
    // Anything in the column that is not a number and not a plain gap marker means the column is text with a few digits in it.
    const nonNumbers = rows.filter((r, i) => cells[i] === null && !MISSING.test((r[c] ?? '').replace(/\*\*|__|`/g, '').trim()))
    if (nonNumbers.length > 0) continue
    numeric.push({ index: c, unit: present[0].unit })
  }
  if (numeric.length === 0) return null
  const unit = numeric[0].unit
  const same = numeric.filter((n) => n.unit === unit).slice(0, 4)
  const left = numeric.length - same.length
  const notes: string[] = []
  if (left > 0) notes.push(`${left} numeric column${left === 1 ? '' : 's'} with a different unit ${left === 1 ? 'is' : 'are'} not drawn, because one axis cannot honestly hold both.`)

  const labels = rows.map((r) => (r[0] ?? '').replace(/\*\*|__|`/g, '').trim())
  const years = labels.every((l) => /^\d{4}$/.test(l))
  const kind: SeriesKind = years || rows.length > 12 ? 'line' : 'bar'
  const series: Series[] = same.map((n) => {
    const points: { x: number; y: number }[] = []
    parsed[n.index].forEach((p, i) => {
      if (p) points.push({ x: years ? Number(labels[i]) : i, y: p.value })
    })
    return seriesFromPoints(`c${n.index}`, header[n.index].replace(/\*\*|__|`/g, '').trim() || `Column ${n.index + 1}`, points, { kind, provenance: 'unknown' })
  })
  const title = `${same.map((n) => header[n.index].replace(/\*\*|__|`/g, '').trim()).join(', ')} by ${header[0].replace(/\*\*|__|`/g, '').trim() || 'row'}`
  const made = buildPlot('chat-table', series, { title, x: { label: header[0].replace(/\*\*|__|`/g, '').trim() }, y: { label: unit ? `(${unit})` : '', includeZero: kind === 'bar' } })
  if (isPlotError(made)) return null
  let plot: Plot = made
  if (!years) {
    // Row order on the axis, labelled by the first column; every k-th label when there are too many to read.
    const every = Math.max(1, Math.ceil(rows.length / 10))
    const ticks = labels.map((label, i) => ({ value: i, label: i % every === 0 ? label : '', major: i % every === 0 }))
    plot = { ...made, x: { ...made.x, ticks } }
    notes.push(`The first column is drawn in row order, with its values as the labels.`)
  }
  return { title, kind, plot, columns: same.map((n) => header[n.index]), notes }
}
