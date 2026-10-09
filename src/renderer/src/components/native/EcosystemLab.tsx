import { useEffect, useMemo } from 'react'
import type { SurfaceProps } from './surfaces'
import Parameters from './Parameters'
import { useScience } from './useScience'
import './phase2.css'
import './phase3.css'

/**
 * The Population Laboratory.
 *
 * ## Real integration, and the solver's own verdict
 *
 * The curves come from `simulation.ts`'s `integrate`, running the Lotka-Volterra or logistic equations with the
 * solver and timestep the user chose. That function reports a status — `complete`, `diverged`, `too-stiff`,
 * `step-limit` — and this shows it rather than drawing a smooth line regardless. A population model run with too
 * large a step produces growing oscillations that look like a result and are an artefact, so the laboratory names
 * that when it happens.
 *
 * ## Euler against RK4 is the lesson, not a setting
 *
 * The solver is a visible parameter because the difference is the point: Euler at a coarse step visibly drifts
 * outward on a Lotka-Volterra cycle, which should be a closed loop. The phase plot makes that drift obvious in a way
 * the time series does not, which is why both are shown.
 *
 * ## It says what the model is not
 *
 * Lotka-Volterra has no age structure, no space, no third species, and prey that grow without limit when predators
 * are gone. The assumptions panel states that, because a convincing cycle invites the belief that it predicts real
 * populations.
 */

interface RunResult {
  trace: readonly { time: number; values: readonly number[] }[]
  final: { time: number; values: readonly number[] }
  status: 'complete' | 'stopped-early' | 'diverged' | 'too-stiff' | 'step-limit'
  steps?: number
  notes?: readonly string[]
}

const STATUS_WORDS: Readonly<Record<RunResult['status'], string>> = Object.freeze({
  complete: 'ran to the end',
  'stopped-early': 'stopped at a condition',
  diverged: 'diverged — the values grew without bound, so this is not a result',
  'too-stiff': 'the solver could not make progress at the accuracy asked for',
  'step-limit': 'hit the step ceiling before the end time'
})

export default function EcosystemLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const science = useScience()
  const values = instance?.values ?? {}

  const model = String(values.model ?? 'predator-prey')
  const method = String(values.method ?? 'rk4')
  const twoSpecies = model === 'predator-prey'

  const numbers = useMemo(() => {
    const out: Record<string, number> = {}
    for (const [key, value] of Object.entries(values)) if (typeof value === 'number') out[key] = value
    return out
  }, [values])

  useEffect(() => {
    if (science.ready) science.ask({ kind: 'population', model, values: numbers, method })
  }, [science.ready, model, method, JSON.stringify(numbers)])

  const result = science.population.value as RunResult | null
  const trace = result?.trace ?? []

  const summary = useMemo(() => {
    if (trace.length === 0) return null
    const prey = trace.map((one) => one.values[0])
    const predators = twoSpecies ? trace.map((one) => one.values[1] ?? 0) : []
    return {
      preyLeast: Math.min(...prey),
      preyMost: Math.max(...prey),
      preyEnd: prey[prey.length - 1],
      predatorLeast: predators.length > 0 ? Math.min(...predators) : null,
      predatorMost: predators.length > 0 ? Math.max(...predators) : null,
      predatorEnd: predators.length > 0 ? predators[predators.length - 1] : null,
      time: trace[trace.length - 1].time
    }
  }, [trace, twoSpecies])

  const unstable = result ? result.status !== 'complete' && result.status !== 'stopped-early' : false
  // Below one individual a continuous model is describing a fraction of an animal, which is worth saying.
  const effectivelyGone = summary ? summary.preyEnd < 1 || (summary.predatorEnd !== null && summary.predatorEnd < 1) : false

  return (
    <section className="p2 p3" aria-label="Population Laboratory">
      <header className="p2-bar">
        <strong>{twoSpecies ? 'Predator and prey' : model === 'logistic' ? 'Logistic growth' : 'Exponential growth'}</strong>
        <span className="p2-faint">
          {trace.length > 0 ? `${trace.length.toLocaleString('en-GB')} points over ${summary?.time.toFixed(1)} time units, ${method.toUpperCase()}` : 'nothing run yet'}
        </span>
      </header>

      {science.population.refused && (
        <p className="p2-refused" role="status">
          <strong>{science.population.refused.says}</strong> {science.population.refused.fix}
        </p>
      )}
      {science.population.broke && <p className="p2-refused" role="status">{science.population.broke}</p>}

      {/* The solver's verdict, where it is not a clean finish. Never hidden. */}
      {unstable && result && (
        <p className="p2-refused" role="status">
          <strong>The solver {STATUS_WORDS[result.status]}.</strong>{' '}
          {result.status === 'diverged'
            ? 'Try a smaller timestep, or RK4 instead of Euler. What is drawn below is how far it got and is not a prediction.'
            : 'Try a smaller timestep or a shorter run.'}
        </p>
      )}

      <div className="p3-split">
        <div>
          <div className="p2-stage">
            {trace.length > 1 ? (
              <TimeSeries trace={trace} twoSpecies={twoSpecies} />
            ) : (
              <p className="p2-faint">{science.population.busy ? 'Integrating…' : 'Nothing run yet.'}</p>
            )}
          </div>

          <div className="p3-legend">
            <span>
              <span className="p3-swatch prey" aria-hidden /> {twoSpecies ? 'prey' : 'population'}
            </span>
            {twoSpecies && (
              <span>
                <span className="p3-swatch predator" aria-hidden /> predators (dashed)
              </span>
            )}
          </div>

          {/* The phase plot, which is where a solver's drift becomes visible. */}
          {twoSpecies && trace.length > 1 && (
            <>
              <div className="p2-stage">
                <PhasePlot trace={trace} />
              </div>
              <p className="p3-note">
                Prey across, predators up. With exact mathematics this is a closed loop that repeats for ever; a spiral
                means the solver is drifting, which is what Euler does at a coarse step. That drift is the integration,
                not the biology.
              </p>
            </>
          )}
        </div>

        <div className="p3-side">
          {summary && (
            <div className="p3-panel">
              <h4>Measured</h4>
              <dl className="p3-facts">
                <dt>{twoSpecies ? 'Prey range' : 'Range'}</dt>
                <dd>
                  {summary.preyLeast.toFixed(2)} to {summary.preyMost.toFixed(2)}
                </dd>
                <dt>{twoSpecies ? 'Prey at the end' : 'At the end'}</dt>
                <dd>{summary.preyEnd.toFixed(2)}</dd>
                {summary.predatorMost !== null && (
                  <>
                    <dt>Predator range</dt>
                    <dd>
                      {summary.predatorLeast?.toFixed(2)} to {summary.predatorMost.toFixed(2)}
                    </dd>
                    <dt>Predators at the end</dt>
                    <dd>{summary.predatorEnd?.toFixed(2)}</dd>
                  </>
                )}
                <dt>Solver</dt>
                <dd>{method.toUpperCase()}</dd>
                <dt>Finished</dt>
                <dd>{result ? STATUS_WORDS[result.status] : '—'}</dd>
              </dl>
              {effectivelyGone && (
                <p className="p2-faint">
                  A population has fallen below one. The equations are continuous, so they carry on with a fraction of
                  an animal; in reality that is extinction.
                </p>
              )}
            </div>
          )}

          <div className="p3-panel">
            <h4>What this model is not</h4>
            <ul className="p3-assumptions">
              {twoSpecies ? (
                <>
                  <li>Prey grow without limit when predators are absent.</li>
                  <li>One predator, one prey, nothing else.</li>
                  <li>No space: every animal can meet every other.</li>
                  <li>No age, no sex, no individual variation.</li>
                </>
              ) : model === 'logistic' ? (
                <>
                  <li>One species, one fixed carrying capacity.</li>
                  <li>No predators, no competitors, no seasons.</li>
                  <li>Growth slows smoothly; real populations overshoot and crash.</li>
                </>
              ) : (
                <>
                  <li>Unlimited growth, which no real population has for long.</li>
                  <li>It is here to show what a carrying capacity prevents.</li>
                </>
              )}
              <li>It shows why populations behave as they do, not what any particular population will do.</li>
            </ul>
          </div>
        </div>
      </div>

      {instance && onConfigure && (
        <details className="p2-settings" open>
          <summary>Settings</summary>
          <Parameters definitions={instance.definitions} shown={instance.shown} values={instance.values} onSet={onConfigure} busy={science.population.busy} />
        </details>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- charts

/** Both populations against time. Thinned to what can be drawn, keeping the extremes. */
function TimeSeries({ trace, twoSpecies }: { trace: readonly { time: number; values: readonly number[] }[]; twoSpecies: boolean }): React.JSX.Element {
  const width = 600
  const height = 240
  const pad = 34

  const thinned = useMemo(() => thin(trace, 900), [trace])
  const times = thinned.map((one) => one.time)
  const all = thinned.flatMap((one) => (twoSpecies ? [one.values[0], one.values[1] ?? 0] : [one.values[0]]))
  const most = Math.max(...all, 1)
  const lastTime = Math.max(...times, 1)

  const path = (which: number): string =>
    thinned
      .map((one, at) => {
        const x = pad + (one.time / lastTime) * (width - pad * 2)
        const y = height - pad - ((one.values[which] ?? 0) / most) * (height - pad * 2)
        return `${at === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(' ')

  return (
    <svg className="p3-chart" viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`Population against time. ${twoSpecies ? 'Two curves: prey and predators.' : 'One curve.'} Largest value ${most.toFixed(1)}.`}>
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="p3-axis" />
      <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="p3-axis" />
      <text x={width - pad} y={height - pad + 16} className="p3-axis-label" textAnchor="end">
        time {lastTime.toFixed(1)}
      </text>
      <text x={pad - 6} y={pad + 4} className="p3-axis-label" textAnchor="end">
        {most.toFixed(0)}
      </text>
      <text x={pad - 6} y={height - pad} className="p3-axis-label" textAnchor="end">
        0
      </text>
      <path d={path(0)} className="p3-curve prey" />
      {twoSpecies && <path d={path(1)} className="p3-curve predator" />}
    </svg>
  )
}

/** Predators against prey — the phase plot, where solver drift shows as a spiral. */
function PhasePlot({ trace }: { trace: readonly { time: number; values: readonly number[] }[] }): React.JSX.Element {
  const size = 280
  const pad = 30
  const thinned = useMemo(() => thin(trace, 1600), [trace])
  const mostPrey = Math.max(...thinned.map((one) => one.values[0]), 1)
  const mostPredator = Math.max(...thinned.map((one) => one.values[1] ?? 0), 1)

  const path = thinned
    .map((one, at) => {
      const x = pad + (one.values[0] / mostPrey) * (size - pad * 2)
      const y = size - pad - ((one.values[1] ?? 0) / mostPredator) * (size - pad * 2)
      return `${at === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <svg className="p3-chart" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Predators plotted against prey. A closed loop means the solver held; a spiral means it drifted.">
      <line x1={pad} y1={size - pad} x2={size - pad} y2={size - pad} className="p3-axis" />
      <line x1={pad} y1={pad} x2={pad} y2={size - pad} className="p3-axis" />
      <text x={size - pad} y={size - pad + 15} className="p3-axis-label" textAnchor="end">
        prey
      </text>
      <text x={pad} y={pad - 8} className="p3-axis-label">
        predators
      </text>
      <path d={path} className="p3-curve predator" style={{ strokeDasharray: 'none' }} />
    </svg>
  )
}

/**
 * Thinned for drawing, keeping the first, the last and the extremes.
 *
 * Taking every nth point would clip the peaks of a cycle and make the amplitude look smaller than it is. The data
 * itself is untouched — this is only what gets drawn, which is what §185 asks for.
 */
function thin<T extends { time: number; values: readonly number[] }>(trace: readonly T[], most: number): T[] {
  if (trace.length <= most) return [...trace]
  const every = Math.ceil(trace.length / most)
  const out: T[] = []
  for (let at = 0; at < trace.length; at += every) {
    const slice = trace.slice(at, at + every)
    // The highest and lowest in each bucket, so peaks survive.
    let high = slice[0]
    let low = slice[0]
    for (const one of slice) {
      if (one.values[0] > high.values[0]) high = one
      if (one.values[0] < low.values[0]) low = one
    }
    if (low.time <= high.time) out.push(low, high)
    else out.push(high, low)
  }
  if (out[out.length - 1] !== trace[trace.length - 1]) out.push(trace[trace.length - 1])
  return out
}
