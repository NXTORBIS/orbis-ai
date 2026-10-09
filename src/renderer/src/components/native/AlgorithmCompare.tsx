import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { SurfaceProps } from './surfaces'
import Parameters from './Parameters'
import Plot from './Plot'
import { useAlgorithms } from './useAlgorithms'
import { CATALOGUE, type Comparison, type Growth } from '../../../../shared/algorithms/catalogue'
// The chart below is the Phase 4 plot, and its stylesheet is where it is laid out. Without this the figure has no
// size and no containment, so the curves and the legend paint straight over the settings underneath -- which is
// exactly what they did.
import './phase2.css'
import './phase4.css'

/**
 * Running several algorithms over one input and showing what each one actually did.
 *
 * ## It counts operations, not milliseconds
 *
 * Deliberately. A timing on one machine, in one browser, with one garbage collector, is not reproducible and is not
 * what distinguishes merge sort from bubble sort. A comparison count is exact, is the same on every machine, and is
 * the number the complexity of a comparison sort is actually defined in. So the table reports comparisons, swaps,
 * writes and steps — every one of them measured by the engine as it ran.
 *
 * ## The same input, or it is not a comparison
 *
 * One list, one seed, handed to all of them. An algorithm that refuses that input — binary search given an unsorted
 * list — keeps its row and shows its reason, because a missing row looks like a bug and a silent substitution would
 * be worse.
 *
 * ## The growth curve is measured and the complexity is stated
 *
 * They sit beside each other and are labelled as what they are. Nothing here fits a curve and announces a complexity
 * class: a handful of points cannot establish a bound, and claiming one would be the fabricated-convergence failure
 * the brief names.
 */

export default function AlgorithmCompare({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engine = useAlgorithms()
  const values = instance?.values ?? {}

  const ids = useMemo(
    () =>
      String(values.algorithms ?? '')
        .split(',')
        .map((one) => one.trim())
        .filter((one) => one.length > 0),
    [values.algorithms]
  )
  const shape = String(values.shape ?? 'random')
  const size = Number(values.size ?? 200)
  const seed = Number(values.seed ?? 1)
  const wantCurve = values.curve === true

  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [curves, setCurves] = useState<readonly Growth[]>([])
  const [list, setList] = useState<readonly number[]>([])

  const known = useMemo(() => new Set(CATALOGUE.map((one) => one.id)), [])
  const unknown = ids.filter((one) => !known.has(one))

  const start = useCallback(() => {
    if (unknown.length > 0 || ids.length < 2) return
    engine.ask({ kind: 'generate', what: 'numbers', shape: shape as never, size, seed })
  }, [engine, ids, unknown.length, shape, size, seed])

  // The input is generated first, then handed to every algorithm, so they all get the identical list.
  useEffect(() => {
    const made = engine.generated.value as readonly number[] | null
    if (!made || !Array.isArray(made)) return
    setList(made)
    engine.ask({ kind: 'compare', ids, request: { values: made, target: made[Math.floor(made.length / 2)], seed } })
  }, [engine.generated.value])

  useEffect(() => {
    const made = engine.comparison.value as Comparison | null
    if (!made) return
    setComparison(made)
    if (wantCurve) engine.ask({ kind: 'growth', ids, shape: shape as never, seed })
  }, [engine.comparison.value])

  useEffect(() => {
    const made = engine.curves.value as readonly Growth[] | null
    if (made) setCurves(made)
  }, [engine.curves.value])

  useEffect(() => {
    if (engine.ready && !comparison && !engine.generated.busy) start()
  }, [engine.ready])

  const busy = engine.generated.busy || engine.comparison.busy || engine.curves.busy
  const refused = engine.generated.refused ?? engine.comparison.refused

  return (
    <section className="p2" aria-label="Algorithm Comparison">
      <header className="p2-bar">
        <strong>{ids.length} algorithms, one input</strong>
        <span className="p2-faint">
          {list.length > 0 ? `${list.length.toLocaleString('en-GB')} values, ${shape.replace(/-/g, ' ')}, seed ${seed}` : 'nothing run yet'}
        </span>
      </header>

      {unknown.length > 0 && (
        <p className="p2-refused" role="status">
          <strong>
            {unknown.length === 1 ? `There is no algorithm called "${unknown[0]}".` : `These are not algorithms: ${unknown.join(', ')}.`}
          </strong>{' '}
          Use ids from the list below.
        </p>
      )}
      {ids.length < 2 && unknown.length === 0 && (
        <p className="p2-refused" role="status">
          <strong>A comparison needs at least two algorithms.</strong> Add another id, separated by a comma.
        </p>
      )}
      {refused && (
        <p className="p2-refused" role="status">
          <strong>{refused.says}</strong> {refused.fix}
        </p>
      )}

      <div className="p2-controls">
        <button type="button" className="p2-btn primary" onClick={start} disabled={busy || !engine.ready || ids.length < 2 || unknown.length > 0}>
          <Sparkles size={14} aria-hidden /> {busy ? 'Running…' : 'Run them'}
        </button>
      </div>

      {comparison && (
        <>
          <div className="p2-table-wrap">
            <table className="p2-table p2-wide">
              <caption className="p2-faint">
                Every algorithm was given the same {list.length.toLocaleString('en-GB')} values. Counts are what the engine recorded as it ran.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Algorithm</th>
                  <th scope="col">Comparisons</th>
                  <th scope="col">Swaps</th>
                  <th scope="col">Writes</th>
                  <th scope="col">Steps</th>
                  <th scope="col">Stated worst case</th>
                </tr>
              </thead>
              <tbody>
                {comparison.sides.map((side) => {
                  const entry = CATALOGUE.find((one) => one.id === side.id)
                  if (!side.run) {
                    return (
                      <tr key={side.id} className="p2-row-refused">
                        <th scope="row">{side.name}</th>
                        <td colSpan={5}>refused — {side.refused}</td>
                      </tr>
                    )
                  }
                  const counts = side.run.counts
                  return (
                    <tr key={side.id}>
                      <th scope="row">{side.name}</th>
                      <td>{counts.comparisons.toLocaleString('en-GB')}</td>
                      <td>{counts.swaps.toLocaleString('en-GB')}</td>
                      <td>{counts.writes.toLocaleString('en-GB')}</td>
                      <td>
                        {counts.steps.toLocaleString('en-GB')}
                        {side.run.cut && <span className="p2-faint"> (stopped early)</span>}
                      </td>
                      <td className="p2-faint">{entry?.complexity.worst ?? ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {Object.keys(comparison.winners).length > 0 && (
            <div className="p2-counts">
              {Object.entries(comparison.winners).map(([what, who]) => (
                <span key={what} className="p2-count">
                  <strong>{who}</strong>
                  {what}
                </span>
              ))}
            </div>
          )}

          {comparison.sides.some((one) => one.run?.cut) && (
            <p className="p2-refused" role="status">
              <strong>At least one of them was stopped at the step ceiling.</strong> Its counts are a floor, not a total,
              and it is not comparable with the others on this input.
            </p>
          )}
        </>
      )}

      {/* ------------------------------------------------ growth */}
      {curves.length > 0 && <GrowthTable curves={curves} />}

      {instance && onConfigure && (
        <details className="p2-settings" open>
          <summary>Settings</summary>
          <Parameters definitions={instance.definitions} shown={instance.shown} values={instance.values} onSet={onConfigure} busy={busy} />
          <p className="p2-faint p2-hint">
            Ids: {CATALOGUE.filter((one) => one.family === 'sorting' || one.family === 'searching').map((one) => one.id).join(', ')}
          </p>
        </details>
      )}
    </section>
  )
}

/**
 * How each algorithm's work grew, at several sizes.
 *
 * A table rather than a chart, on purpose: the numbers are the evidence and a reader can see the ratio between rows
 * for themselves. A smoothed line would invite the conclusion the data cannot support.
 */
function GrowthTable({ curves }: { curves: readonly Growth[] }): React.JSX.Element {
  const sizes = curves[0]?.measured.map((one) => one.size) ?? []
  return (
    <div className="p2-complexity">
      <h4>How the work grew</h4>
      {/*
        * The curve, before the numbers.
        *
        * This is the one picture the whole comparison is for: at these sizes an n log n sort and an n squared sort
        * are two numbers in a row that both look large, and two lines on a chart that are visibly different shapes.
        * Every point is measured -- the engine counted the comparisons -- and the stated bound in the table was not
        * fitted to them.
        */}
      {curves.length > 0 && curves[0].measured.length > 1 && (
        <Plot
          series={curves.map((curve) => ({
            id: curve.id,
            label: curve.name,
            points: curve.measured.map((one) => ({ x: one.size, y: one.comparisons }))
          }))}
          xLabel="how many items"
          yLabel="comparisons"
          height={220}
          about="Each line is one algorithm. A line that bends upwards is doing more than its share of extra work for each extra item — which is what a worse complexity looks like before anybody writes the bound down."
        />
      )}
      <div className="p2-table-wrap">
        <table className="p2-table p2-wide">
          <caption className="p2-faint">
            Comparisons at each size, on {curves[0]?.shape.replace(/-/g, ' ')} input with seed {curves[0]?.seed}. Measured.
          </caption>
          <thead>
            <tr>
              <th scope="col">Algorithm</th>
              {sizes.map((one) => (
                <th key={one} scope="col">
                  n={one}
                </th>
              ))}
              <th scope="col">×, first to last</th>
              <th scope="col">Stated</th>
            </tr>
          </thead>
          <tbody>
            {curves.map((curve) => {
              const first = curve.measured[0]?.comparisons ?? 0
              const last = curve.measured[curve.measured.length - 1]?.comparisons ?? 0
              const ratio = first > 0 ? (last / first).toFixed(1) : '—'
              return (
                <tr key={curve.id}>
                  <th scope="row">{curve.name}</th>
                  {curve.measured.map((one) => (
                    <td key={one.size}>
                      {one.comparisons.toLocaleString('en-GB')}
                      {one.cut && <span className="p2-faint">+</span>}
                    </td>
                  ))}
                  <td>×{ratio}</td>
                  <td className="p2-faint">{curve.stated.average}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="p2-faint">
        The stated column is the textbook bound and was not worked out from these numbers. A `+` means that run hit the
        step ceiling, so its figure is a floor. Sizes rise by a factor of two across the row: an algorithm whose count
        roughly quadruples each time is behaving quadratically on this input, and one that roughly doubles is not —
        but a handful of points demonstrates a bound rather than establishing one.
      </p>
    </div>
  )
}
