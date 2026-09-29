import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, Info, LineChart, Sigma, Table as TableIcon, Target } from 'lucide-react'
import type { NoticeKind } from '../App'
import type { PageComputeResult } from '../../../shared/types'

/**
 * The Pages backed by the newer engines: plotting, statistics, data, measurement, optimisation and simulation.
 *
 * Kept out of `PagesView.tsx` because that file is the library and the frame, and these are six Pages. Everything here
 * follows the same rule as the three that came before: **nothing on this screen is computed here**. Every number,
 * every curve and every caveat arrived from the main process through `pagesCompute`, which is the only route to an
 * engine and is capability-checked on the way through.
 *
 * ## Why the caveats are on screen rather than in a tooltip
 *
 * These engines return notes -- that a correlation is not causation, that a minimum is local, that a simulation is not
 * a measurement, that a step size changed the answer. Those notes are not decoration and they are not an appendix.
 * They are the difference between a number somebody can use and a number that will mislead them, so they are rendered
 * beside the result every time, not behind a disclosure somebody has to think to open.
 */

/** The engine call every Page here makes. Returns the value, or throws with the message the service gave. */
export async function compute(pageId: string, operation: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = (await window.api.pagesCompute({ pageId, operation, input })) as PageComputeResult
  if (!result || typeof result !== 'object') throw new Error('That calculation did not come back.')
  if (!('ok' in result)) throw new Error((result as { message?: string }).message ?? 'That calculation did not work.')
  if (!result.ok) {
    throw new Error(result.capability ? `${result.message} (${result.capability})` : result.message)
  }
  return (result.value ?? {}) as Record<string, unknown>
}

/** Numbers typed into a box, read leniently about separators and strictly about everything else. */
export function readNumbers(text: string): number[] {
  return text
    .split(/[\s,;]+/)
    .filter((one) => one !== '')
    .map((one) => Number(one))
    .filter((one) => Number.isFinite(one))
}

/**
 * A labelled text box, since the Pages are mostly text boxes.
 *
 * Here rather than in each lab file so the three of them cannot drift into three slightly different fields.
 */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  wide = false,
  rows = 0
}: {
  label: string
  value: string
  onChange(next: string): void
  placeholder?: string
  wide?: boolean
  rows?: number
}): React.JSX.Element {
  return (
    <label className={wide ? 'page-field wide' : 'page-field'}>
      <span>{label}</span>
      {rows > 0 ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} spellCheck={false} placeholder={placeholder} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} placeholder={placeholder} />
      )}
    </label>
  )
}

/** A row of labelled figures. Shared, so the lab files cannot drift into three slightly different ones. */
export function Stats({ items }: { items: readonly [string, string][] }): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="page-stats">
      {items.map(([label, value]) => (
        <div className="page-stat" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  )
}

/** A dropdown, for the several places here where the choice itself carries meaning. */
export function Choice({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange(next: string): void
}): React.JSX.Element {
  return (
    <label className="page-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((one) => (
          <option key={one.value} value={one.value}>
            {one.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The notes an engine returned, shown as themselves. */
export function Notes({ notes, label = 'What this assumes' }: { notes: readonly string[]; label?: string }): React.JSX.Element | null {
  if (!notes || notes.length === 0) return null
  return (
    <div className="page-notes" role="note" aria-label={label}>
      <Info size={14} aria-hidden />
      <ul>
        {notes.map((one) => (
          <li key={one}>{one}</li>
        ))}
      </ul>
    </div>
  )
}

export function Problem({ text }: { text: string }): React.JSX.Element | null {
  if (text === '') return null
  return (
    <p className="page-problem" role="alert">
      <AlertTriangle size={14} aria-hidden /> {text}
    </p>
  )
}

/** A hook for the shape every Page here has: run an operation, hold the answer, hold the problem. */
export function useEngine<T extends Record<string, unknown>>(
  pageId: string,
  run: (call: (operation: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>) => Promise<T | null>,
  deps: unknown[]
): { result: T | null; problem: string; busy: boolean; again(): void } {
  const [result, setResult] = useState<T | null>(null)
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    const call = (operation: string, input: Record<string, unknown>): Promise<Record<string, unknown>> =>
      compute(pageId, operation, input)
    void run(call)
      .then((value) => {
        if (cancelled) return
        setResult(value)
        setProblem('')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // The engine's own sentence. It was written for the person, so it is not rewritten here.
        setProblem(err instanceof Error ? err.message : 'That did not work.')
        setResult(null)
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, tick, ...deps])

  return { result, problem, busy, again: () => setTick((one) => one + 1) }
}

// ---------------------------------------------------------------- drawing

interface Segment {
  points: { x: number; y: number }[]
}

interface Series {
  id: string
  label: string
  kind: string
  segments: Segment[]
}

/** The palette the plot engine chose, mirrored so a legend and a curve agree. */
const COLOURS = ['#56b4e9', '#e69f00', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#999999']

/**
 * A plot, drawn from what the engine returned.
 *
 * The engine decided where the points go, where the axes run and where the curve breaks. This turns that into SVG and
 * makes no decisions of its own -- in particular it never joins across a break, because the break is the engine saying
 * there is nothing there to join.
 */
function Plot({ series, height = 260 }: { series: Series[]; height?: number }): React.JSX.Element | null {
  const bounds = useMemo(() => {
    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY
    let left = Number.POSITIVE_INFINITY
    let right = Number.NEGATIVE_INFINITY
    for (const one of series) {
      for (const segment of one.segments ?? []) {
        for (const point of segment.points ?? []) {
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
          if (point.y < low) low = point.y
          if (point.y > high) high = point.y
          if (point.x < left) left = point.x
          if (point.x > right) right = point.x
        }
      }
    }
    if (low > high || left > right) return null
    // A flat curve still needs a drawable range, widened around itself rather than pinned to zero.
    if (low === high) {
      const size = Math.abs(low) > 0 ? Math.abs(low) * 0.1 : 1
      low -= size
      high += size
    }
    if (left === right) {
      left -= 1
      right += 1
    }
    const pad = (high - low) * 0.06
    return { left, right, low: low - pad, high: high + pad }
  }, [series])

  if (bounds === null) return null

  const width = 640
  const inset = { top: 12, right: 12, bottom: 26, left: 52 }
  const inner = { width: width - inset.left - inset.right, height: height - inset.top - inset.bottom }
  const x = (one: number): number => inset.left + ((one - bounds.left) / (bounds.right - bounds.left)) * inner.width
  const y = (one: number): number => inset.top + inner.height - ((one - bounds.low) / (bounds.high - bounds.low)) * inner.height

  const ticks = (from: number, to: number, count: number): number[] => {
    const rough = (to - from) / count
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(rough) || 1)))
    const normalised = rough / magnitude
    const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude
    const out: number[] = []
    for (let value = Math.ceil(from / step) * step, guard = 0; value <= to && guard < 20; value += step, guard++) {
      out.push(Number(value.toPrecision(12)))
    }
    return out
  }

  const label = (one: number): string =>
    Math.abs(one) >= 1e5 || (Math.abs(one) < 1e-3 && one !== 0) ? one.toExponential(1) : String(Number(one.toPrecision(4)))

  return (
    <svg className="page-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Plot">
      {ticks(bounds.low, bounds.high, 5).map((one) => (
        <g key={`h${one}`}>
          <line x1={inset.left} x2={width - inset.right} y1={y(one)} y2={y(one)} className="page-plot-grid" />
          <text x={inset.left - 8} y={y(one) + 4} className="page-plot-label" textAnchor="end">
            {label(one)}
          </text>
        </g>
      ))}
      {ticks(bounds.left, bounds.right, 6).map((one) => (
        <g key={`v${one}`}>
          <line x1={x(one)} x2={x(one)} y1={inset.top} y2={height - inset.bottom} className="page-plot-grid" />
          <text x={x(one)} y={height - inset.bottom + 16} className="page-plot-label" textAnchor="middle">
            {label(one)}
          </text>
        </g>
      ))}
      {/* Zero lines, where they are on screen. A plot whose axes are not at zero should say where zero is. */}
      {bounds.low < 0 && bounds.high > 0 && (
        <line x1={inset.left} x2={width - inset.right} y1={y(0)} y2={y(0)} className="page-plot-axis" />
      )}
      {bounds.left < 0 && bounds.right > 0 && (
        <line x1={x(0)} x2={x(0)} y1={inset.top} y2={height - inset.bottom} className="page-plot-axis" />
      )}

      {series.map((one, index) =>
        (one.segments ?? []).map((segment, s) => {
          const points = (segment.points ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
          if (points.length === 0) return null
          if (one.kind === 'scatter' || points.length === 1) {
            return points.map((point, i) => (
              <circle key={`${one.id}-${s}-${i}`} cx={x(point.x)} cy={y(point.y)} r={2.5} fill={COLOURS[index % COLOURS.length]} />
            ))
          }
          // Each segment is its own path. Nothing joins across a break, because the engine put the break there.
          const d = points.map((point, i) => `${i === 0 ? 'M' : 'L'}${x(point.x).toFixed(2)},${y(point.y).toFixed(2)}`).join(' ')
          return <path key={`${one.id}-${s}`} d={d} fill="none" stroke={COLOURS[index % COLOURS.length]} strokeWidth={1.8} />
        })
      )}
    </svg>
  )
}

// ---------------------------------------------------------------- Function Plotter

export function FunctionPlotterPage({
  pageId,
  onNotify
}: {
  pageId: string
  onNotify(m: string, k?: NoticeKind): void
}): React.JSX.Element {
  const [mode, setMode] = useState<'function' | 'parametric' | 'polar'>('function')
  const [expression, setExpression] = useState('sin(x) / x')
  const [second, setSecond] = useState('sin(t)')
  const [from, setFrom] = useState('-20')
  const [to, setTo] = useState('20')

  const { result, problem, busy } = useEngine<{ series: Series; evaluations: number }>(
    pageId,
    async (call) => {
      const low = Number(from)
      const high = Number(to)
      if (!Number.isFinite(low) || !Number.isFinite(high)) throw new Error('The range has to be two numbers.')
      if (mode === 'function') {
        const out = await call('plot.function', { expression, from: low, to: high, initial: 256 })
        if (out.ok !== true) throw new Error(String(out.message ?? 'That could not be plotted.'))
        return out as unknown as { series: Series; evaluations: number }
      }
      if (mode === 'polar') {
        const out = await call('plot.polar', { expression, from: low, to: high, initial: 600 })
        if (out.ok !== true) throw new Error(String(out.message ?? 'That could not be plotted.'))
        return out as unknown as { series: Series; evaluations: number }
      }
      const out = await call('plot.parametric', { x: expression, y: second, from: low, to: high, initial: 600 })
      if (out.ok !== true) throw new Error(String(out.message ?? 'That could not be plotted.'))
      return out as unknown as { series: Series; evaluations: number }
    },
    [mode, expression, second, from, to]
  )

  const series = result?.series ? [result.series] : []
  const breaks = (result?.series?.segments ?? []).length

  return (
    <section className="page-pane" aria-label="Function Plotter">
      <div className="page-chips" role="tablist" aria-label="What to plot">
        {(['function', 'parametric', 'polar'] as const).map((one) => (
          <button
            key={one}
            type="button"
            role="tab"
            aria-selected={mode === one}
            className={`page-chip${mode === one ? ' on' : ''}`}
            onClick={() => setMode(one)}
          >
            {one === 'function' ? 'y = f(x)' : one === 'parametric' ? 'parametric' : 'polar'}
          </button>
        ))}
      </div>

      <div className="page-row">
        <label className="page-field wide">
          <span>{mode === 'parametric' ? 'x(t)' : mode === 'polar' ? 'r(theta)' : 'y = f(x)'}</span>
          <input value={expression} onChange={(e) => setExpression(e.target.value)} spellCheck={false} />
        </label>
        {mode === 'parametric' && (
          <label className="page-field wide">
            <span>y(t)</span>
            <input value={second} onChange={(e) => setSecond(e.target.value)} spellCheck={false} />
          </label>
        )}
      </div>
      <div className="page-row">
        <label className="page-field">
          <span>From</span>
          <input value={from} onChange={(e) => setFrom(e.target.value)} inputMode="decimal" spellCheck={false} />
        </label>
        <label className="page-field">
          <span>To</span>
          <input value={to} onChange={(e) => setTo(e.target.value)} inputMode="decimal" spellCheck={false} />
        </label>
      </div>

      <Problem text={problem} />
      {busy && series.length === 0 && <p className="page-note">Sampling…</p>}
      {series.length > 0 && <Plot series={series} />}

      {result && (
        <p className="page-note">
          <LineChart size={14} aria-hidden /> {result.evaluations} evaluations, placed where the curve bends rather than
          evenly.
          {breaks > 1 && ` Drawn in ${breaks} pieces, because the curve was cut where it jumped rather than joined across.`}
        </p>
      )}
      <Notes notes={(result?.series as unknown as { notes?: string[] })?.notes ?? []} label="About this plot" />

      <button
        type="button"
        className="queue-btn small"
        onClick={() =>
          void window.api
            .pagesProjectSave(pageId, null, expression, { mode, expression, second, from, to })
            .then((r) => onNotify('saved' in r && r.saved ? 'Saved' : 'Could not save', 'saved' in r && r.saved ? 'info' : 'error'))
        }
      >
        Save this plot
      </button>
    </section>
  )
}

// ---------------------------------------------------------------- Statistics Lab

export function StatisticsLabPage({
  pageId,
  onNotify
}: {
  pageId: string
  onNotify(m: string, k?: NoticeKind): void
}): React.JSX.Element {
  const [text, setText] = useState('12 15 11 18 14 16 13 22 15 14 17 13')
  const [against, setAgainst] = useState('15')
  const [other, setOther] = useState('19 21 18 24 20 22 19 25')

  const values = useMemo(() => readNumbers(text), [text])
  const comparison = useMemo(() => readNumbers(other), [other])

  const { result, problem } = useEngine<{
    summary: Record<string, unknown>
    test: Record<string, unknown> | null
    twoSample: Record<string, unknown> | null
    correlation: Record<string, unknown> | null
    histogram: Record<string, unknown> | null
    outliers: Record<string, unknown> | null
  }>(
    pageId,
    async (call) => {
      if (values.length < 2) throw new Error('Type at least two numbers, separated by spaces or commas.')
      const summary = await call('statistics.summarise', { values })
      if (summary.ok !== true) throw new Error(String(summary.message ?? 'Those numbers could not be summarised.'))

      const target = Number(against)
      const test = Number.isFinite(target) ? await call('statistics.test', { kind: 'one-sample', values, against: target }) : null
      const twoSample = comparison.length >= 2 ? await call('statistics.test', { kind: 'two-sample', a: values, b: comparison }) : null
      const correlation =
        comparison.length === values.length && values.length >= 3 ? await call('statistics.correlate', { a: values, b: comparison }) : null
      const histogram = await call('statistics.histogram', { values })
      const outliers = await call('statistics.outliers', { values, method: 'iqr' })
      return { summary, test, twoSample, correlation, histogram, outliers }
    },
    [values.join(','), comparison.join(','), against]
  )

  const summary = result?.summary
  const bins = (result?.histogram?.bins ?? []) as { from: number; to: number; count: number }[]
  const histogramSeries: Series[] = bins.length
    ? [
        {
          id: 'hist',
          label: 'Distribution',
          kind: 'line',
          segments: [{ points: bins.flatMap((one) => [{ x: one.from, y: one.count }, { x: one.to, y: one.count }]) }]
        }
      ]
    : []

  return (
    <section className="page-pane" aria-label="Statistics Lab">
      <label className="page-field wide">
        <span>Your numbers</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} spellCheck={false} />
      </label>
      <div className="page-row">
        <label className="page-field">
          <span>Compare the average against</span>
          <input value={against} onChange={(e) => setAgainst(e.target.value)} inputMode="decimal" spellCheck={false} />
        </label>
      </div>
      <label className="page-field wide">
        <span>A second group, to compare (optional)</span>
        <textarea value={other} onChange={(e) => setOther(e.target.value)} rows={2} spellCheck={false} />
      </label>

      <Problem text={problem} />

      {summary && (
        <div className="page-stats" aria-label="Summary">
          {[
            ['Count', summary.count],
            ['Mean', summary.mean],
            ['Median', summary.median],
            ['Std deviation', summary.standardDeviation],
            ['Smallest', summary.minimum],
            ['Largest', summary.maximum]
          ].map(([label, value]) => (
            <div key={String(label)} className="page-stat">
              <span>{String(label)}</span>
              <strong>{typeof value === 'number' ? Number(value.toPrecision(6)) : String(value ?? '—')}</strong>
            </div>
          ))}
        </div>
      )}

      {histogramSeries.length > 0 && (
        <>
          <Plot series={histogramSeries} height={180} />
          <p className="page-note">
            <Sigma size={14} aria-hidden /> Binned by {String(result?.histogram?.rule ?? 'a rule')}. The rule is part of
            the answer: the same numbers look unimodal or bimodal depending on it.
          </p>
        </>
      )}

      {result?.outliers && (result.outliers.indices as number[])?.length > 0 && (
        <p className="page-note">
          {(result.outliers.indices as number[]).length} value
          {(result.outliers.indices as number[]).length === 1 ? '' : 's'} flagged as unusual, at position
          {(result.outliers.indices as number[]).length === 1 ? ' ' : 's '}
          {(result.outliers.indices as number[]).map((one) => one + 1).join(', ')}. {String(result.outliers.describe ?? '')}
        </p>
      )}

      {result?.test && (
        <div className="page-result">
          <h4>Is the average different from {against}?</h4>
          <p>
            {String(result.test.test)}: t = {Number((result.test.statistic as number)?.toPrecision(4))}, p ={' '}
            {Number((result.test.pValue as number)?.toPrecision(3))}
          </p>
          <p className="page-note">{String(result.test.describe ?? '')}</p>
          <Notes notes={(result.test.assumptions as string[]) ?? []} />
        </div>
      )}

      {result?.twoSample && (
        <div className="page-result">
          <h4>Are the two groups different?</h4>
          <p>
            {String(result.twoSample.test)}: t = {Number((result.twoSample.statistic as number)?.toPrecision(4))}, p ={' '}
            {Number((result.twoSample.pValue as number)?.toPrecision(3))}
          </p>
          <p className="page-note">{String(result.twoSample.describe ?? '')}</p>
          <Notes notes={(result.twoSample.assumptions as string[]) ?? []} />
        </div>
      )}

      {result?.correlation && (
        <div className="page-result">
          <h4>Do the two groups move together?</h4>
          <p>r = {Number((result.correlation.correlation as number)?.toPrecision(4))}</p>
          {/* Always. The warning and the number are one thing, and separating them is how a correlation becomes a claim. */}
          <p className="page-note">{String(result.correlation.describe ?? '')}</p>
        </div>
      )}

      <Notes notes={(summary?.notes as string[]) ?? []} />

      <button
        type="button"
        className="queue-btn small"
        onClick={() =>
          void window.api
            .pagesProjectSave(pageId, null, `${values.length} values`, { text, other, against })
            .then((r) => onNotify('saved' in r && r.saved ? 'Saved' : 'Could not save', 'saved' in r && r.saved ? 'info' : 'error'))
        }
      >
        Save these numbers
      </button>
    </section>
  )
}

// ---------------------------------------------------------------- Data Explorer

interface TableOut {
  columns: { id: string; name: string; type: string; unit: string | null; confidence: string; reason: string }[]
  rows: { id: string; cells: unknown[] }[]
  source: string
}

/** A cell as text. The four kinds of nothing are shown as themselves rather than all rendered as blank. */
function cellText(cell: unknown): { text: string; kind: 'value' | 'missing' | 'invalid' | 'null' } {
  if (cell === null) return { text: '—', kind: 'null' }
  if (typeof cell === 'object') {
    const record = cell as Record<string, unknown>
    if (record.kind === 'missing') return { text: '', kind: 'missing' }
    if (record.kind === 'invalid') return { text: String(record.raw ?? ''), kind: 'invalid' }
    if ('unit' in record && 'value' in record) {
      return { text: `${String(record.value)} ${String((record.unit as { display?: string })?.display ?? record.unit ?? '')}`.trim(), kind: 'value' }
    }
  }
  return { text: String(cell), kind: 'value' }
}

export function DataExplorerPage({
  pageId,
  onNotify
}: {
  pageId: string
  onNotify(m: string, k?: NoticeKind): void
}): React.JSX.Element {
  const [text, setText] = useState(
    'city,population,temperature (degC)\nOslo,709037,4.2\nLisbon,545796,17.1\nHelsinki,658457,5.9\nAthens,664046,18.8\nDublin,592713,9.8'
  )
  const [sortBy, setSortBy] = useState('')
  const [descending, setDescending] = useState(false)

  const { result, problem } = useEngine<{
    table: TableOut
    delimiter: string
    headerRow: boolean
    notes: string[]
    profile: Record<string, unknown>
  }>(
    pageId,
    async (call) => {
      if (text.trim() === '') throw new Error('Paste a table to look at.')
      const parsed = await call('data.parse', { text })
      if (parsed.ok !== true) throw new Error(String(parsed.message ?? 'That could not be read as a table.'))

      const table = parsed.table as TableOut
      const headers = table.columns.map((one) => one.name)
      const rows = table.rows.map((row) => row.cells.map((cell) => cellText(cell).text))

      let shown = table
      if (sortBy !== '') {
        const sorted = await call('data.sort', { table: { headers, rows }, keys: [{ column: sortBy, descending }] })
        if (sorted.ok === true) shown = sorted.table as TableOut
      }
      const profile = await call('data.profile', { table: { headers, rows } })
      return { table: shown, delimiter: String(parsed.delimiter), headerRow: parsed.headerRow === true, notes: (parsed.notes as string[]) ?? [], profile }
    },
    [text, sortBy, descending]
  )

  const table = result?.table
  const warnings = (result?.profile?.warnings as string[]) ?? []

  return (
    <section className="page-pane" aria-label="Data Explorer">
      <label className="page-field wide">
        <span>Paste a table</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} spellCheck={false} />
      </label>

      <Problem text={problem} />

      {result && (
        <p className="page-note">
          <TableIcon size={14} aria-hidden /> Read with "{result.delimiter === '\t' ? 'tab' : result.delimiter}" as the
          separator{result.headerRow ? ', treating the first row as headings' : ', with no heading row'}. Both were
          guesses.
        </p>
      )}
      <Notes notes={result?.notes ?? []} label="How this was read" />

      {table && table.columns.length > 0 && (
        <>
          <div className="page-chips" aria-label="Sort by">
            <button type="button" className={`page-chip${sortBy === '' ? ' on' : ''}`} onClick={() => setSortBy('')}>
              original order
            </button>
            {table.columns.map((one) => (
              <button
                key={one.id}
                type="button"
                className={`page-chip${sortBy === one.id ? ' on' : ''}`}
                onClick={() => {
                  if (sortBy === one.id) setDescending((d) => !d)
                  else {
                    setSortBy(one.id)
                    setDescending(false)
                  }
                }}
              >
                {one.name}
                {sortBy === one.id ? (descending ? ' ↓' : ' ↑') : ''}
              </button>
            ))}
          </div>

          <div className="page-table-wrap">
            <table className="page-table">
              <thead>
                <tr>
                  {table.columns.map((one) => (
                    <th key={one.id} scope="col">
                      <span>{one.name}</span>
                      {/* The inferred type and how sure Orbis is, because a wrong type silently changes every sort. */}
                      <em title={one.reason}>
                        {one.type}
                        {one.unit ? ` (${one.unit})` : ''}
                        {one.confidence === 'low' ? ' — unsure' : ''}
                      </em>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.slice(0, 200).map((row) => (
                  <tr key={row.id}>
                    {row.cells.map((cell, i) => {
                      const shown = cellText(cell)
                      return (
                        <td key={i} className={`page-cell-${shown.kind}`} title={shown.kind === 'invalid' ? 'Orbis could not read this value' : undefined}>
                          {shown.kind === 'missing' ? <span className="page-cell-empty">missing</span> : shown.text}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {table.rows.length > 200 && <p className="page-note">Showing the first 200 of {table.rows.length} rows.</p>}
        </>
      )}

      {warnings.length > 0 && <Notes notes={warnings} label="Worth knowing about this data" />}

      <button
        type="button"
        className="queue-btn small"
        onClick={() =>
          void window.api
            .pagesProjectSave(pageId, null, `${table?.rows.length ?? 0} rows`, { text })
            .then((r) => onNotify('saved' in r && r.saved ? 'Saved' : 'Could not save', 'saved' in r && r.saved ? 'info' : 'error'))
        }
      >
        Save this table
      </button>
    </section>
  )
}

// ---------------------------------------------------------------- Measurement Lab

export function MeasurementLabPage({
  pageId,
  onNotify
}: {
  pageId: string
  onNotify(m: string, k?: NoticeKind): void
}): React.JSX.Element {
  const [aValue, setAValue] = useState('9.81')
  const [aUncertainty, setAUncertainty] = useState('0.02')
  const [aUnit, setAUnit] = useState('m/s^2')
  const [bValue, setBValue] = useState('2.00')
  const [bUncertainty, setBUncertainty] = useState('0.05')
  const [bUnit, setBUnit] = useState('s')
  const [how, setHow] = useState<'add' | 'subtract' | 'multiply' | 'divide'>('multiply')
  const [readings, setReadings] = useState('10.1 10.3 9.9 10.2 10.0 10.4')
  const [readingUnit, setReadingUnit] = useState('mm')

  const { result, problem } = useEngine<{
    combined: Record<string, unknown>
    repeated: Record<string, unknown> | null
    agree: Record<string, unknown> | null
  }>(
    pageId,
    async (call) => {
      const a = {
        value: Number(aValue),
        unit: aUnit,
        uncertainty: Math.abs(Number(aUncertainty) || 0),
        provenance: 'measured'
      }
      const b = {
        value: Number(bValue),
        unit: bUnit,
        uncertainty: Math.abs(Number(bUncertainty) || 0),
        provenance: 'measured'
      }
      if (!Number.isFinite(a.value) || !Number.isFinite(b.value)) throw new Error('Both measurements need a number.')

      const combined = await call('measurement.combine', { a, b, how })
      if (combined.ok !== true) throw new Error(String(combined.message ?? 'Those cannot be combined.'))

      const list = readNumbers(readings)
      const repeated = list.length > 0 ? await call('measurement.repeated', { readings: list, unit: readingUnit }) : null

      // Only meaningful when both measure the same kind of thing, which the engine decides rather than this screen.
      let agree: Record<string, unknown> | null = null
      try {
        agree = await call('measurement.agree', { a, b })
      } catch {
        agree = null
      }
      return { combined, repeated, agree }
    },
    [aValue, aUncertainty, aUnit, bValue, bUncertainty, bUnit, how, readings, readingUnit]
  )

  const field = (
    label: string,
    value: string,
    setValue: (one: string) => void,
    uncertainty: string,
    setUncertainty: (one: string) => void,
    unit: string,
    setUnit: (one: string) => void
  ): React.JSX.Element => (
    <div className="page-row">
      <label className="page-field">
        <span>{label}</span>
        <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" spellCheck={false} />
      </label>
      <label className="page-field">
        <span>±</span>
        <input value={uncertainty} onChange={(e) => setUncertainty(e.target.value)} inputMode="decimal" spellCheck={false} />
      </label>
      <label className="page-field">
        <span>Unit</span>
        <input value={unit} onChange={(e) => setUnit(e.target.value)} spellCheck={false} />
      </label>
    </div>
  )

  return (
    <section className="page-pane" aria-label="Measurement Lab">
      {field('First measurement', aValue, setAValue, aUncertainty, setAUncertainty, aUnit, setAUnit)}
      <div className="page-chips" aria-label="How to combine them">
        {(['add', 'subtract', 'multiply', 'divide'] as const).map((one) => (
          <button key={one} type="button" className={`page-chip${how === one ? ' on' : ''}`} onClick={() => setHow(one)}>
            {one}
          </button>
        ))}
      </div>
      {field('Second measurement', bValue, setBValue, bUncertainty, setBUncertainty, bUnit, setBUnit)}

      <Problem text={problem} />

      {result?.combined && (
        <output className="page-answer">
          <strong>{String(result.combined.report)}</strong>
        </output>
      )}
      <Notes notes={(result?.combined?.describe as string[]) ?? []} label="About this result" />

      {result?.agree && (
        <p className="page-note">{String(result.agree.describe ?? '')}</p>
      )}

      <label className="page-field wide">
        <span>Or work one out from repeated readings</span>
        <textarea value={readings} onChange={(e) => setReadings(e.target.value)} rows={2} spellCheck={false} />
      </label>
      <label className="page-field">
        <span>Unit</span>
        <input value={readingUnit} onChange={(e) => setReadingUnit(e.target.value)} spellCheck={false} />
      </label>

      {result?.repeated?.ok === true && (
        <>
          <output className="page-answer">
            <strong>{String((result.repeated.measurement as Record<string, unknown>).report)}</strong>
          </output>
          <Notes notes={(result.repeated.notes as string[]) ?? []} label="About these readings" />
        </>
      )}

      <button
        type="button"
        className="queue-btn small"
        onClick={() =>
          void window.api
            .pagesProjectSave(pageId, null, `${aValue} ${aUnit} ${how} ${bValue} ${bUnit}`, {
              aValue,
              aUncertainty,
              aUnit,
              bValue,
              bUncertainty,
              bUnit,
              how,
              readings,
              readingUnit
            })
            .then((r) => onNotify('saved' in r && r.saved ? 'Saved' : 'Could not save', 'saved' in r && r.saved ? 'info' : 'error'))
        }
      >
        Save this measurement
      </button>
    </section>
  )
}

// ---------------------------------------------------------------- Optimiser

export function OptimiserPage({
  pageId,
  onNotify
}: {
  pageId: string
  onNotify(m: string, k?: NoticeKind): void
}): React.JSX.Element {
  const [expression, setExpression] = useState('(x-3)^2 + (y+1)^2 + 2')
  const [variables, setVariables] = useState('x y')
  const [start, setStart] = useState('0 0')
  const [direction, setDirection] = useState<'minimise' | 'maximise'>('minimise')
  const [scatter, setScatter] = useState(true)

  const names = useMemo(() => variables.split(/[\s,]+/).filter((one) => one !== ''), [variables])
  const startAt = useMemo(() => readNumbers(start), [start])

  const { result, problem } = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => {
      if (names.length === 0) throw new Error('Name at least one variable.')
      if (startAt.length !== names.length) {
        throw new Error(`There are ${names.length} variables but ${startAt.length} starting values.`)
      }
      if (scatter) {
        // A box around the starting point, so many starts have somewhere to be scattered.
        const bounds = startAt.map((one) => ({ low: one - 50, high: one + 50 }))
        const out = await call('optimise.multistart', {
          expression: direction === 'maximise' ? `-(${expression})` : expression,
          variables: names,
          bounds,
          starts: 16,
          seed: 7
        })
        if (out.ok !== true) throw new Error(String(out.message ?? 'That could not be optimised.'))
        return { ...out, value: direction === 'maximise' ? -(out.value as number) : out.value }
      }
      const out = await call('optimise.minimise', {
        expression,
        variables: names,
        start: startAt,
        maximise: direction === 'maximise'
      })
      if (out.ok !== true) throw new Error(String(out.message ?? 'That could not be optimised.'))
      return out
    },
    [expression, names.join(','), startAt.join(','), direction, scatter]
  )

  const point = (result?.point as number[]) ?? []

  return (
    <section className="page-pane" aria-label="Optimiser">
      <label className="page-field wide">
        <span>What to make as small or as large as possible</span>
        <input value={expression} onChange={(e) => setExpression(e.target.value)} spellCheck={false} />
      </label>
      <div className="page-row">
        <label className="page-field">
          <span>Variables</span>
          <input value={variables} onChange={(e) => setVariables(e.target.value)} spellCheck={false} />
        </label>
        <label className="page-field">
          <span>Starting at</span>
          <input value={start} onChange={(e) => setStart(e.target.value)} spellCheck={false} />
        </label>
      </div>
      <div className="page-chips">
        {(['minimise', 'maximise'] as const).map((one) => (
          <button
            key={one}
            type="button"
            className={`page-chip${direction === one ? ' on' : ''}`}
            onClick={() => setDirection(one)}
          >
            {one}
          </button>
        ))}
        <button type="button" className={`page-chip${scatter ? ' on' : ''}`} onClick={() => setScatter((one) => !one)}>
          try many starting points
        </button>
      </div>

      <Problem text={problem} />

      {result && point.length > 0 && (
        <>
          <output className="page-answer">
            <Target size={16} aria-hidden />
            <strong>
              {names.map((name, i) => `${name} = ${Number(point[i]?.toPrecision(6))}`).join(', ')}
            </strong>
            <span className="pages-tag">value {Number((result.value as number)?.toPrecision(6))}</span>
            {/* The honest headline: whether this is the best, or merely a best. */}
            <span className="pages-tag">
              {result.certainty === 'global' ? 'the best there is' : result.certainty === 'local' ? 'a best, not necessarily the best' : 'the best seen'}
            </span>
          </output>
          {typeof result.distinctMinima === 'number' && (result.distinctMinima as number) > 1 && (
            <p className="page-note">
              The starts landed in {String(result.distinctMinima)} different places, which proves this problem has more
              than one answer of its kind.
            </p>
          )}
        </>
      )}

      <Notes notes={(result?.notes as string[]) ?? []} label="What can and cannot be claimed" />

      <button
        type="button"
        className="queue-btn small"
        onClick={() =>
          void window.api
            .pagesProjectSave(pageId, null, expression, { expression, variables, start, direction, scatter })
            .then((r) => onNotify('saved' in r && r.saved ? 'Saved' : 'Could not save', 'saved' in r && r.saved ? 'info' : 'error'))
        }
      >
        Save this problem
      </button>
    </section>
  )
}

// ---------------------------------------------------------------- Simulation Lab

export function SimulationLabPage({
  pageId,
  onNotify
}: {
  pageId: string
  onNotify(m: string, k?: NoticeKind): void
}): React.JSX.Element {
  const [variables, setVariables] = useState('x v')
  const [rates, setRates] = useState('v\n-x - 0.1*v')
  const [start, setStart] = useState('1 0')
  const [until, setUntil] = useState('30')
  const [method, setMethod] = useState<'euler' | 'rk4' | 'adaptive'>('adaptive')
  const [invariant, setInvariant] = useState('0.5*v^2 + 0.5*x^2')

  const names = useMemo(() => variables.split(/[\s,]+/).filter((one) => one !== ''), [variables])
  const rateList = useMemo(() => rates.split('\n').map((one) => one.trim()).filter((one) => one !== ''), [rates])
  const startAt = useMemo(() => readNumbers(start), [start])

  const { result, problem } = useEngine<{ run: Record<string, unknown>; invariant: Record<string, unknown> | null }>(
    pageId,
    async (call) => {
      if (names.length === 0) throw new Error('Name at least one variable.')
      if (rateList.length !== names.length) {
        throw new Error(`There are ${names.length} variables but ${rateList.length} rates of change. Every variable needs one, on its own line.`)
      }
      if (startAt.length !== names.length) throw new Error(`There are ${names.length} variables but ${startAt.length} starting values.`)
      const to = Number(until)
      if (!Number.isFinite(to)) throw new Error('The end time has to be a number.')

      const run = await call('simulate.integrate', {
        variables: names,
        rates: rateList,
        start: startAt,
        from: 0,
        to,
        method,
        step: method === 'adaptive' ? undefined : to / 2000,
        tracePoints: 1200
      })
      if (run.ok !== true) throw new Error(String(run.message ?? 'That could not be run.'))

      let watched: Record<string, unknown> | null = null
      if (invariant.trim() !== '') {
        try {
          watched = await call('simulate.invariant', {
            variables: names,
            rates: rateList,
            quantity: invariant,
            start: startAt,
            from: 0,
            to,
            method,
            step: method === 'adaptive' ? undefined : to / 2000,
            allowedDrift: 0.01
          })
        } catch {
          watched = null
        }
      }
      return { run, invariant: watched }
    },
    [names.join(','), rateList.join('|'), startAt.join(','), until, method, invariant]
  )

  const trace = (result?.run?.trace as { time: number; values: number[] }[]) ?? []
  const series: Series[] = names.map((name, i) => ({
    id: name,
    label: name,
    kind: 'line',
    segments: [{ points: trace.map((state) => ({ x: state.time, y: state.values[i] })) }]
  }))

  return (
    <section className="page-pane" aria-label="Simulation Lab">
      <div className="page-row">
        <label className="page-field">
          <span>Variables</span>
          <input value={variables} onChange={(e) => setVariables(e.target.value)} spellCheck={false} />
        </label>
        <label className="page-field">
          <span>Starting at</span>
          <input value={start} onChange={(e) => setStart(e.target.value)} spellCheck={false} />
        </label>
        <label className="page-field">
          <span>Until</span>
          <input value={until} onChange={(e) => setUntil(e.target.value)} inputMode="decimal" spellCheck={false} />
        </label>
      </div>
      <label className="page-field wide">
        <span>How fast each one changes, one per line</span>
        <textarea value={rates} onChange={(e) => setRates(e.target.value)} rows={3} spellCheck={false} />
      </label>
      <div className="page-chips" aria-label="Method">
        {(['adaptive', 'rk4', 'euler'] as const).map((one) => (
          <button key={one} type="button" className={`page-chip${method === one ? ' on' : ''}`} onClick={() => setMethod(one)}>
            {one === 'rk4' ? 'RK4' : one}
          </button>
        ))}
      </div>
      <label className="page-field wide">
        <span>Something that should not change (optional)</span>
        <input value={invariant} onChange={(e) => setInvariant(e.target.value)} spellCheck={false} />
      </label>

      <Problem text={problem} />

      {series.length > 0 && trace.length > 0 && (
        <>
          <Plot series={series} />
          <div className="page-chips" aria-label="Legend">
            {names.map((name, i) => (
              <span key={name} className="page-legend">
                <i style={{ background: COLOURS[i % COLOURS.length] }} aria-hidden /> {name}
              </span>
            ))}
          </div>
        </>
      )}

      {result?.run && (
        <p className="page-note">
          <Activity size={14} aria-hidden /> {String(result.run.steps)} steps, {String(result.run.evaluations)}{' '}
          evaluations. This is a <strong>simulation</strong>: it describes the model you typed, not the world.
        </p>
      )}

      {result?.invariant?.ok === true && (
        <p className={result.invariant.held === true ? 'page-note' : 'page-problem'}>
          {String(result.invariant.verdict ?? '')}
        </p>
      )}

      <Notes notes={(result?.run?.notes as string[]) ?? []} label="About this run" />

      <button
        type="button"
        className="queue-btn small"
        onClick={() =>
          void window.api
            .pagesProjectSave(pageId, null, `${names.join(', ')} to t=${until}`, {
              variables,
              rates,
              start,
              until,
              method,
              invariant
            })
            .then((r) => onNotify('saved' in r && r.saved ? 'Saved' : 'Could not save', 'saved' in r && r.saved ? 'info' : 'error'))
        }
      >
        Save this model
      </button>
    </section>
  )
}
