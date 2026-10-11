import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Code2, Pause, Play, RotateCcw, SkipForward, Sparkles, Variable } from 'lucide-react'
import type { SurfaceProps } from './surfaces'
import { Segmented } from '../../ui'
import Parameters from './Parameters'
import { useAlgorithms } from './useAlgorithms'
import { arrayAt, lineAt, regionAt, settledAt, stackAt, varsAt, visitedAt, type Frame, type Run, type Step } from '../../../../shared/algorithms/trace'
import { codeFor } from '../../../../shared/algorithms/code'
import { entryFor, type Entry } from '../../../../shared/algorithms/catalogue'
import type { Graph } from '../../../../shared/algorithms/graphs'
import './phase2.css'

/**
 * The Algorithm Laboratory.
 *
 * ## It replays a recording; it does not animate
 *
 * Everything on screen comes from the trace the engine produced. The bars are the array as it stood at the current
 * step, worked out by replaying the recorded swaps; the highlighted pair is the pair the algorithm compared; the
 * counts are the recorder's. Nothing here invents a plausible-looking step, which is the whole difference between
 * this and an animation of an algorithm.
 *
 * That also means stepping backwards is free and exact: step 14 is step 14, not an attempt to undo.
 *
 * ## Progressive disclosure
 *
 * It opens with an algorithm, an input and a Run button. The trace, the recursion tree, the stack and the growth
 * curve are there when asked for. A laboratory that opens on forty controls is one nobody uses.
 *
 * ## Without animation it still works
 *
 * Play is a convenience. Every state is reachable by stepping or by dragging the timeline, each step says in words
 * what happened, and nothing is communicated by colour alone — the compared pair is labelled, the settled positions
 * are ticked, and the current step is written out. That is what `prefers-reduced-motion` leaves usable.
 */

type View = 'bars' | 'graph' | 'table' | 'trace'

/**
 * Speed as a multiple of real time, from a tenth to a hundred and twenty-eight times.
 *
 * Four named speeds were not enough at either end: watching one comparison of bubble sort needs slower than "slow",
 * and getting through forty thousand steps of a big quicksort needs faster than "sprint". The numbers are powers of
 * two around 1× so the labels stay short and the steps feel even.
 *
 * 1× is one step every 220 ms, which is about as fast as a step can be read.
 */
const BASE_MS = 220
const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128] as const
const speedLabel = (one: number): string => (one < 1 ? `${one}\u00d7` : `${one}\u00d7`)

export default function AlgorithmLab({ instance, onNotify, onConfigure }: SurfaceProps): React.JSX.Element {
  const engine = useAlgorithms()
  const values = instance?.values ?? {}

  const algorithm = String(values.algorithm ?? 'binary')
  const entry = entryFor(algorithm)
  const list = useMemo(() => (Array.isArray(values.values) ? (values.values as number[]) : []), [values.values])
  const target = typeof values.target === 'number' ? values.target : 0

  const [run, setRun] = useState<Run | null>(null)
  const [at, setAt] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(1)
  const [panel, setPanel] = useState<'none' | 'code' | 'vars'>('none')
  const [view, setView] = useState<View>('bars')
  const [graph, setGraph] = useState<{ graph: Graph; at: Record<string, { x: number; y: number }> } | null>(null)

  const family = entry?.family ?? 'sorting'

  // ---------------------------------------------------------------- asking the engine

  const start = useCallback(() => {
    if (!entry) return
    setPlaying(false)
    if (entry.family === 'graphs') {
      /*
       * Topological sort needs a directed graph without cycles, and a grid has neither property.
       *
       * Choosing it used to produce "a topological order only means something for a directed graph" — a correct
       * refusal to a question nobody asked. The shape follows the algorithm unless the person has picked one.
       */
      const shape = entry.id === 'topological' ? 'dag' : String(values.graphShape ?? 'grid')
      engine.ask({
        kind: 'generate',
        what: 'graph',
        graphShape: shape as never,
        size: Number(values.graphSize ?? 16),
        seed: Number(values.seed ?? 1)
      })
      return
    }
    engine.ask({
      kind: 'run',
      algorithm,
      request: {
        values: list,
        target,
        pivot: String(values.pivot ?? 'median-of-three') as never,
        seed: Number(values.seed ?? 1),
        // The two strings serve both the subsequence algorithms and the three matchers; for a matcher the second
        // is the pattern, so it has to be something that is actually in the first.
        a: entry.family === 'strings' ? String(values.text ?? 'abacabadabacaba') : String(values.a ?? 'ABCBDAB'),
        b: entry.family === 'strings' ? String(values.pattern ?? 'abacaba') : String(values.b ?? 'BDCABA'),
        /*
         * `n` means different things to different families, so it is not one number reused.
         *
         * Hanoi counts discs and N-Queens counts rows of a board; both explode, and passing the length of the
         * value list would mean twelve discs the moment somebody typed twelve numbers. Fibonacci wants a term.
         */
        n:
          entry.family === 'backtracking'
            ? Math.max(1, Number(values.puzzleSize ?? (entry.id === 'n-queens' ? 6 : 4)))
            : Math.min(25, Math.max(1, list.length || 12)),
        /*
         * Knapsack needs items and a capacity, and passing nothing produced "0/1 knapsack needs some items" —
         * an app registered, selectable, and unable to run. These are the defaults; the controls override them.
         */
        items: Array.isArray(values.items)
          ? (values.items as { name: string; weight: number; value: number }[])
          : [
              { name: 'map', weight: 1, value: 1 },
              { name: 'compass', weight: 2, value: 2 },
              { name: 'water', weight: 3, value: 5 },
              { name: 'food', weight: 4, value: 7 },
              { name: 'rope', weight: 5, value: 8 }
            ],
        capacity: Number(values.capacity ?? 10)
      }
    })
  }, [engine, entry, algorithm, list, target, values.pivot, values.seed, values.graphShape, values.graphSize])

  // A generated graph arrives first; the algorithm is then run against it.
  useEffect(() => {
    const made = engine.generated.value as { graph: Graph; at: Record<string, { x: number; y: number }> } | null
    if (!made || !made.graph) return
    setGraph(made)
    if (family !== 'graphs') return
    engine.ask({
      kind: 'run',
      algorithm,
      request: { graph: made.graph, start: made.graph.nodes[0], graphTarget: made.graph.nodes[made.graph.nodes.length - 1], at: made.at }
    })
  }, [engine.generated.value])

  useEffect(() => {
    const made = engine.run.value as Run | null
    if (!made) return
    setRun(made)
    setAt(0)
    setView(made.algorithm.includes('search') && family === 'graphs' ? 'graph' : family === 'graphs' ? 'graph' : family === 'dynamic' ? 'table' : 'bars')
    if (made.cut) onNotify(`It was stopped after ${made.counts.steps.toLocaleString('en-GB')} steps, so the answer is incomplete.`, 'warn')
  }, [engine.run.value])

  useEffect(() => {
    if (engine.ready && !run && !engine.run.busy) start()
  }, [engine.ready])

  // ---------------------------------------------------------------- playing

  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (!playing || !run) return
    // At 128× a step every 1.7 ms is below a frame, so the interval is floored and several steps are taken per
    // tick instead. Asking setInterval for 1 ms and getting 16 would make the fast end quietly stop getting faster.
    const perTick = Math.max(1, Math.round(BASE_MS / speed / 16))
    const ms = Math.max(16, Math.round(BASE_MS / speed))
    timer.current = window.setInterval(() => {
      setAt((held) => {
        if (held >= run.steps.length - 1) {
          setPlaying(false)
          return held
        }
        return Math.min(run.steps.length - 1, held + perTick)
      })
    }, ms)
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current)
      timer.current = null
    }
  }, [playing, speed, run])

  const step: Step | null = run && run.steps.length > 0 ? run.steps[Math.min(at, run.steps.length - 1)] : null

  // ---------------------------------------------------------------- views

  const shown = useMemo(() => (run && family !== 'graphs' && family !== 'dynamic' ? arrayAt(list, run.steps, at) : list), [run, list, at, family])
  const settled = useMemo(() => (run ? settledAt(run.steps, at) : new Set<number>()), [run, at])
  const region = useMemo(() => (run ? regionAt(run.steps, at) : null), [run, at])
  const visited = useMemo(() => (run ? visitedAt(run.steps, at) : []), [run, at])
  const stack = useMemo(() => (run ? stackAt(run, at) : []), [run, at])
  const touching = useMemo(() => new Set(step?.at ?? []), [step])
  const code = useMemo(() => codeFor(algorithm), [algorithm])
  const vars = useMemo(() => (run ? varsAt(run.steps, at) : {}), [run, at])
  const onLine = useMemo(() => (run ? lineAt(run.steps, at) : null), [run, at])

  const biggest = Math.max(1, ...shown.map((one) => Math.abs(one)))

  return (
    <section className="p2" aria-label="Algorithm Laboratory">
      <header className="p2-bar">
        <strong>{entry?.name ?? algorithm}</strong>
        {entry && <span className="p2-faint">{entry.idea}</span>}
      </header>

      {engine.run.refused && (
        <p className="p2-refused" role="status">
          <strong>{engine.run.refused.says}</strong> {engine.run.refused.fix}
        </p>
      )}
      {engine.generated.refused && (
        <p className="p2-refused" role="status">
          <strong>{engine.generated.refused.says}</strong> {engine.generated.refused.fix}
        </p>
      )}
      {engine.run.broke && <p className="p2-refused" role="status">{engine.run.broke}</p>}

      {/* ------------------------------------------------ controls */}
      <div className="p2-controls">
        <button type="button" className="p2-btn primary" onClick={start} disabled={engine.run.busy || !engine.ready}>
          <Sparkles size={14} aria-hidden /> {engine.run.busy ? 'Working…' : 'Run'}
        </button>
        <button type="button" className="p2-btn" onClick={() => setPlaying((held) => !held)} disabled={!run || run.steps.length < 2}>
          {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />} {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="p2-btn" aria-label="Step back" onClick={() => setAt((held) => Math.max(0, held - 1))} disabled={!run || at === 0}>
          <ChevronLeft size={14} aria-hidden />
        </button>
        <button
          type="button"
          className="p2-btn"
          aria-label="Step forward"
          onClick={() => setAt((held) => Math.min((run?.steps.length ?? 1) - 1, held + 1))}
          disabled={!run || at >= (run?.steps.length ?? 1) - 1}
        >
          <ChevronRight size={14} aria-hidden />
        </button>
        <button type="button" className="p2-btn" aria-label="To the end" onClick={() => setAt((run?.steps.length ?? 1) - 1)} disabled={!run}>
          <SkipForward size={14} aria-hidden />
        </button>
        <button type="button" className="p2-btn" aria-label="Back to the start" onClick={() => { setAt(0); setPlaying(false) }} disabled={!run}>
          <RotateCcw size={14} aria-hidden />
        </button>

        <label className="p2-speed">
          Speed
          <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
            {SPEEDS.map((one) => (
              <option key={one} value={one}>
                {speedLabel(one)}
              </option>
            ))}
          </select>
        </label>

        {/* The two side panels. Off by default, because a laboratory that opens on everything is one nobody reads. */}
        <button
          type="button"
          className={`p2-btn${panel === 'code' ? ' on' : ''}`}
          aria-pressed={panel === 'code'}
          onClick={() => setPanel((held) => (held === 'code' ? 'none' : 'code'))}
          disabled={code === null}
          title={code === null ? 'There is no listing for this algorithm' : onLine === null ? 'Read the code — this one does not mark its line yet' : 'Follow the code'}
        >
          <Code2 size={14} aria-hidden /> Code
        </button>
        <button
          type="button"
          className={`p2-btn${panel === 'vars' ? ' on' : ''}`}
          aria-pressed={panel === 'vars'}
          onClick={() => setPanel((held) => (held === 'vars' ? 'none' : 'vars'))}
          disabled={Object.keys(vars).length === 0}
          title={Object.keys(vars).length === 0 ? 'This algorithm does not report its variables yet' : 'Watch the variables'}
        >
          <Variable size={14} aria-hidden /> Variables
        </button>
      </div>

      {/* ------------------------------------------------ the timeline */}
      {run && run.steps.length > 1 && (
        <div className="p2-timeline">
          <input
            type="range"
            min={0}
            max={run.steps.length - 1}
            value={Math.min(at, run.steps.length - 1)}
            onChange={(event) => {
              setPlaying(false)
              setAt(Number(event.target.value))
            }}
            aria-label={`Step ${at} of ${run.steps.length - 1}`}
          />
          <span className="p2-faint">
            step {at.toLocaleString('en-GB')} of {(run.steps.length - 1).toLocaleString('en-GB')}
          </span>
        </div>
      )}

      {/* The step in words. This is what makes the whole thing usable with animation turned off. */}
      {step && (
        <p className="p2-step" role="status" aria-live="polite">
          <span className={`p2-kind k-${step.kind}`}>{step.kind}</span> {step.says}
        </p>
      )}

      {/* ------------------------------------------------ views */}
      <Segmented<View>
        className="p2-tabs"
        optionClass="p2-tab"
        label="How to show it"
        value={view}
        options={(['bars', 'graph', 'table', 'trace'] as View[])
          .filter((one) => (one === 'graph' ? family === 'graphs' : one === 'table' ? family === 'dynamic' : one === 'bars' ? family !== 'graphs' : true))
          .map((one) => ({
            value: one,
            label: one === 'bars' ? 'Values' : one === 'graph' ? 'Graph' : one === 'table' ? 'Table' : 'Every step'
          }))}
        onChange={setView}
      />

      <div className={`p2-stage${panel === 'none' ? '' : ' with-panel'}`}>
        {panel === 'code' && code !== null && <CodePanel lines={code.lines} on={onLine} />}
        {panel === 'vars' && <VarsPanel vars={vars} names={code?.names ?? {}} />}
        {view === 'bars' && <Bars values={shown} biggest={biggest} settled={settled} touching={touching} region={region} />}
        {view === 'graph' && graph && <GraphView graph={graph.graph} at={graph.at} visited={visited} touching={touching} />}
        {view === 'table' && run && <TableView run={run} upTo={at} />}
        {view === 'trace' && run && <TraceView run={run} at={at} onPick={(n) => { setPlaying(false); setAt(n) }} />}
      </div>

      {/* ------------------------------------------------ what it measured */}
      {run && (
        <div className="p2-counts">
          <Count label="steps" value={run.counts.steps} />
          {run.counts.comparisons > 0 && <Count label="comparisons" value={run.counts.comparisons} />}
          {run.counts.swaps > 0 && <Count label="swaps" value={run.counts.swaps} />}
          {run.counts.writes > 0 && <Count label="writes" value={run.counts.writes} />}
          {run.counts.calls > 0 && <Count label="calls" value={run.counts.calls} />}
          {run.counts.depth > 0 && <Count label="deepest" value={run.counts.depth} />}
          {Object.entries(run.counts.own).map(([name, value]) => (
            <Count key={name} label={name.replace(/([A-Z])/g, ' $1').toLowerCase()} value={value} />
          ))}
        </div>
      )}

      {run?.cut && (
        <p className="p2-refused" role="status">
          <strong>Stopped after {run.counts.steps.toLocaleString('en-GB')} steps.</strong> What is shown is how far it got, not the finished answer.
        </p>
      )}

      {/* The stated complexity and what was measured, side by side and labelled as what each is. */}
      {entry && run && (
        <div className="p2-complexity">
          <h4>Complexity</h4>
          <dl>
            <dt>stated, best</dt>
            <dd>{entry.complexity.best}</dd>
            <dt>stated, average</dt>
            <dd>{entry.complexity.average}</dd>
            <dt>stated, worst</dt>
            <dd>{entry.complexity.worst}</dd>
            <dt>stated, extra space</dt>
            <dd>{entry.complexity.space}</dd>
            <dt>measured here</dt>
            <dd>
              {run.counts.comparisons > 0 ? `${run.counts.comparisons.toLocaleString('en-GB')} comparisons` : `${run.counts.steps.toLocaleString('en-GB')} steps`} on{' '}
              {family === 'graphs' ? `${graph?.graph.nodes.length ?? 0} nodes` : `${list.length} values`}
            </dd>
          </dl>
          <p className="p2-faint">
            The stated figures are the textbook bounds. The measured figure is this one run on this one input, which
            demonstrates a bound but never establishes one.
          </p>
        </div>
      )}

      {/* The recursion tree, for the algorithms that recurse. */}
      {run && run.frames.length > 0 && <Recursion frames={run.frames} at={at} />}

      {stack.length > 0 && (
        <div className="p2-stack">
          <h4>Call stack, here</h4>
          <ol>
            {[...stack].reverse().map((one) => (
              <li key={one.id}>{one.label}</li>
            ))}
          </ol>
        </div>
      )}

      {entry && (
        <details className="p2-limits">
          <summary>What this does not do</summary>
          <ul>
            {entry.limits.map((one) => (
              <li key={one}>{one}</li>
            ))}
          </ul>
        </details>
      )}

      {/*
        * The controls, rendered from the app's declared parameters.
        *
        * Every one of them goes through the runtime, which checks its range and refuses what does not fit -- so a
        * value typed here cannot reach the engine without having been validated.
        */}
      {instance && onConfigure && (
        <details className="p2-settings" open>
          <summary>Settings</summary>
          <Parameters
            definitions={instance.definitions}
            shown={instance.shown}
            values={instance.values}
            onSet={onConfigure}
            busy={engine.run.busy || engine.generated.busy}
          />
          <p className="p2-faint p2-hint">
            Or ask Orion — &ldquo;use 3, 8, 12, 17 and find 17&rdquo; sets these for you.
          </p>
        </details>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- the views

/**
 * The algorithm's own code, with the line it is on marked.
 *
 * The highlight comes from the step, not from a guess about which line a step kind belongs to. An algorithm that
 * records no lines never reaches this panel: the button that opens it is disabled, which is why there is no case
 * here for "no line" beyond leaving nothing marked.
 */
function CodePanel({ lines, on }: { lines: readonly string[]; on: number | null }): React.JSX.Element {
  return (
    <aside className="p2-code" aria-label="The algorithm, with the current line marked">
      <h4>The code</h4>
      <ol>
        {lines.map((one, at) => (
          <li key={`${at}-${one}`} className={on === at + 1 ? 'on' : undefined} aria-current={on === at + 1 ? 'step' : undefined}>
            <span className="p2-code-n">{at + 1}</span>
            {/* Leading spaces carry the nesting, and a span keeps them from collapsing. */}
            <code>{one === '' ? ' ' : one}</code>
          </li>
        ))}
      </ol>
      {on !== null ? (
        <p className="p2-faint">Line {on} is where the run is now. Stepping back moves it back.</p>
      ) : (
        <p className="p2-faint">
          This algorithm does not yet say which line it is on, so nothing is marked. The listing is still what it
          does, step for step.
        </p>
      )}
    </aside>
  )
}

/**
 * The algorithm's variables as they stand.
 *
 * Named as the algorithm names them, with the explanation from the same listing the code panel shows — so a
 * variable on screen can always be found in the code beside it. A value is carried forward until the algorithm
 * changes it, which is what makes this readable while stepping rather than a panel that empties every other step.
 */
function VarsPanel({
  vars,
  names
}: {
  vars: Readonly<Record<string, number | string | boolean>>
  names: Readonly<Record<string, string>>
}): React.JSX.Element {
  const rows = Object.entries(vars)
  return (
    <aside className="p2-vars" aria-label="The algorithm's variables">
      <h4>Variables</h4>
      {rows.length === 0 ? (
        <p className="p2-faint">Nothing has been set yet.</p>
      ) : (
        <dl>
          {rows.map(([name, value]) => (
            <div key={name} className="p2-var">
              <dt>
                <code>{name}</code>
              </dt>
              <dd>{typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)}</dd>
              {names[name] !== undefined && <p className="p2-faint">{names[name]}</p>}
            </div>
          ))}
        </dl>
      )}
    </aside>
  )
}

function Count({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <span className="p2-count">
      <strong>{value.toLocaleString('en-GB')}</strong>
      {label}
    </span>
  )
}

/**
 * The values, as bars.
 *
 * State is shown three ways on purpose — position, a label and a tick — so none of it depends on colour alone.
 */
function Bars({
  values,
  biggest,
  settled,
  touching,
  region
}: {
  values: readonly number[]
  biggest: number
  settled: ReadonlySet<number>
  touching: ReadonlySet<number | string>
  region: Step['region'] | null
}): React.JSX.Element {
  if (values.length === 0) return <p className="p2-faint">Nothing to show yet.</p>
  // Beyond a few hundred bars the labels are unreadable, so they are dropped rather than overlapped.
  const labels = values.length <= 40
  return (
    <div className="p2-bars" role="img" aria-label={`${values.length} values, ${settled.size} in their final place`}>
      {values.map((one, index) => {
        const inRegion = region ? index >= region.from && index <= region.to : false
        const here = touching.has(index)
        return (
          <div
            key={index}
            className={`p2-bar${here ? ' here' : ''}${settled.has(index) ? ' settled' : ''}${inRegion ? ' in-region' : ''}`}
            style={{ height: `${Math.max(3, (Math.abs(one) / biggest) * 100)}%` }}
            title={`position ${index}: ${one}`}
          >
            {labels && <span className="p2-bar-value">{one}</span>}
            {settled.has(index) && <span className="p2-bar-tick" aria-hidden>✓</span>}
          </div>
        )
      })}
    </div>
  )
}

/** The graph, with the visited nodes marked and the current ones named. */
function GraphView({
  graph,
  at,
  visited,
  touching
}: {
  graph: Graph
  at: Readonly<Record<string, { x: number; y: number }>>
  visited: readonly string[]
  touching: ReadonlySet<number | string>
}): React.JSX.Element {
  const xs = graph.nodes.map((one) => at[one]?.x ?? 0)
  const ys = graph.nodes.map((one) => at[one]?.y ?? 0)
  const minX = Math.min(...xs, 0)
  const maxX = Math.max(...xs, 1)
  const minY = Math.min(...ys, 0)
  const maxY = Math.max(...ys, 1)
  const pad = 1.2
  const seen = new Set(visited)

  return (
    <svg className="p2-graph" viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`} role="img"
      aria-label={`${graph.nodes.length} nodes, ${seen.size} visited so far`}>
      {graph.edges.map((edge, index) => {
        const a = at[edge.from]
        const b = at[edge.to]
        if (!a || !b) return null
        const both = seen.has(edge.from) && seen.has(edge.to)
        return (
          <g key={index}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`p2-edge${both ? ' used' : ''}`} />
            {graph.edges.length <= 40 && edge.weight !== 1 && (
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} className="p2-edge-weight">
                {edge.weight}
              </text>
            )}
          </g>
        )
      })}
      {graph.nodes.map((node) => {
        const spot = at[node]
        if (!spot) return null
        const here = touching.has(node)
        return (
          <g key={node} className={`p2-node${seen.has(node) ? ' seen' : ''}${here ? ' here' : ''}`}>
            <circle cx={spot.x} cy={spot.y} r={0.55} />
            {graph.nodes.length <= 60 && (
              <text x={spot.x} y={spot.y + 0.18} className="p2-node-label">
                {node.replace(/^[nr]/, '')}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** The dynamic-programming table, filled in as far as the current step. */
function TableView({ run, upTo }: { run: Run; upTo: number }): React.JSX.Element {
  const filled = useMemo(() => {
    const out = new Map<string, number>()
    for (let n = 0; n <= Math.min(upTo, run.steps.length - 1); n += 1) {
      const step = run.steps[n]
      if (step.kind !== 'write' || step.at.length !== 2 || !step.values || step.values.length === 0) continue
      const [row, column] = step.at as [number, number]
      const value = step.values[0]
      if (typeof value === 'number') out.set(`${row}:${column}`, value)
    }
    return out
  }, [run, upTo])

  const table = (run.result as { table?: readonly (readonly number[])[] } | null)?.table
  if (!table || table.length === 0) return <p className="p2-faint">This algorithm has no table to show.</p>
  // A wide table is virtualised by simply not drawing past what fits; the numbers are still all in the result.
  const columns = Math.min(table[0]?.length ?? 0, 40)

  return (
    <div className="p2-table-wrap">
      <table className="p2-table">
        <caption className="p2-faint">Cells appear as the algorithm writes them. {columns < (table[0]?.length ?? 0) ? `First ${columns} columns shown.` : ''}</caption>
        <tbody>
          {table.slice(0, 40).map((row, r) => (
            <tr key={r}>
              {row.slice(0, columns).map((_, c) => {
                const value = filled.get(`${r}:${c}`)
                const written = value !== undefined
                return (
                  <td key={c} className={written ? 'written' : 'blank'}>
                    {written ? value : r === 0 || c === 0 ? 0 : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Every step, as a list. Clicking one goes to it. */
function TraceView({ run, at, onPick }: { run: Run; at: number; onPick(n: number): void }): React.JSX.Element {
  const held = useRef<HTMLOListElement | null>(null)
  useEffect(() => {
    held.current?.querySelector<HTMLElement>('[data-here="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  // Only a window is rendered: a 200,000-step trace would be 200,000 DOM nodes.
  const from = Math.max(0, at - 60)
  const to = Math.min(run.steps.length, at + 140)

  return (
    <ol className="p2-trace" ref={held}>
      {from > 0 && <li className="p2-faint">…{from.toLocaleString('en-GB')} earlier steps</li>}
      {run.steps.slice(from, to).map((step) => (
        <li key={step.n} data-here={step.n === at ? 'true' : 'false'} className={step.n === at ? 'here' : undefined}>
          <button type="button" onClick={() => onPick(step.n)}>
            <span className="p2-trace-n">{step.n}</span>
            <span className={`p2-kind k-${step.kind}`}>{step.kind}</span>
            <span>{step.says}</span>
          </button>
        </li>
      ))}
      {to < run.steps.length && <li className="p2-faint">…{(run.steps.length - to).toLocaleString('en-GB')} later steps</li>}
    </ol>
  )
}

/** The recursion tree, from the recorded frames. */
function Recursion({ frames, at }: { frames: readonly Frame[]; at: number }): React.JSX.Element {
  const shown = frames.slice(0, 200)
  return (
    <details className="p2-recursion" open={frames.length <= 24}>
      <summary>Recursion ({frames.length.toLocaleString('en-GB')} calls)</summary>
      <ul>
        {shown.map((frame) => {
          const open = frame.from <= at && (frame.to === null || frame.to > at)
          const done = frame.to !== null && frame.to <= at
          return (
            <li key={frame.id} style={{ marginLeft: `${Math.min(frame.depth, 12) * 14}px` }} className={open ? 'open' : done ? 'done' : 'later'}>
              <span>{frame.label}</span>
              {frame.result !== undefined && done && <span className="p2-faint"> → {frame.result}</span>}
              {open && <span className="p2-faint"> (running)</span>}
            </li>
          )
        })}
        {frames.length > shown.length && <li className="p2-faint">…{(frames.length - shown.length).toLocaleString('en-GB')} more</li>}
      </ul>
    </details>
  )
}

export type { Entry }
