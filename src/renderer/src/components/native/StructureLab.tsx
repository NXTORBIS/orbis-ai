import { useEffect, useMemo, useRef, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import { Segmented } from '../../ui'
import Parameters from './Parameters'
import { useStructures } from './useStructures'
import './phase2.css'
import './phase4.css'

/**
 * The Data Structures Laboratory.
 *
 * ## One drawing function, four shapes
 *
 * Every structure reports itself as a `Snapshot` — cells, links, optional depths, and notes — so this file draws
 * four layouts rather than twelve structures. A stack and an array-backed heap are both rows of boxes; a linked list
 * and a trie are both cells joined by lines. Writing twelve renderers would have meant twelve places for a bug and
 * twelve things to restyle.
 *
 * ## The costs on screen are the costs that were counted
 *
 * The comparison, pointer-change, probe and rotation counts come from the engine, which increments them as it works.
 * Nothing here computes an expected figure. That is what lets the panel say a degenerate tree cost sixty-four
 * comparisons where a balanced one cost seven, and have it be a measurement.
 *
 * ## The stated complexity sits next to the measured count, on purpose
 *
 * A textbook says a hash table lookup is O(1). This shows what it actually cost, which is sometimes four comparisons
 * because the keys collided. Putting the claim and the measurement side by side is the entire reason for building
 * this rather than writing the complexities on a page.
 */

interface Cell {
  id: string
  value: number | string | null
  at: number
  mark?: 'looking' | 'found' | 'changed' | 'added' | 'removed' | 'path' | 'unbalanced'
  note?: string
}

interface Link {
  from: string
  to: string
  role: 'next' | 'prev' | 'left' | 'right' | 'child' | 'parent'
  mark?: 'changed' | 'path' | 'broken'
}

interface Snapshot {
  layout: 'row' | 'chain' | 'tree' | 'buckets'
  cells: readonly Cell[]
  links: readonly Link[]
  depth?: Readonly<Record<string, number>>
  notes: readonly string[]
}

interface Counts {
  comparisons: number
  reads: number
  writes: number
  links: number
  rotations: number
  probes: number
  allocations: number
  deepest: number
}

interface Step {
  n: number
  says: string
  kind: string
  snapshot: Snapshot
}

interface Run {
  structure: string
  operation: string
  argument: string
  steps: readonly Step[]
  counts: Counts
  ending: Snapshot
  answer: string
  changed: boolean
  truncated: boolean
}

interface Operation {
  id: string
  name: string
  about: string
  needs: string
  costs: string
}

interface Entry {
  id: string
  name: string
  about: string
  goodAt: readonly string[]
  badAt: readonly string[]
  operations: readonly Operation[]
  complexity: Readonly<Record<string, string>>
  watchOutFor: string
}

interface Spread {
  buckets: number
  keys: number
  used: number
  longest: number
  ideal: number
  averageLookup: number
  says: string
}

interface Side {
  id: string
  name: string
  counts: Counts
  answer: string
  stated: string
}

interface Comparison {
  operation: string
  argument: string
  sides: readonly Side[]
  says: string
}

/** The only structures that can be walked, so the walk control is only sent for them. */
const WALKABLE = new Set(['binary-search-tree', 'avl-tree'])

/** The three things this laboratory can show you about whatever is built. */
const SHOWING = [
  { value: 'picture', label: 'The structure' },
  { value: 'steps', label: 'Every step' },
  { value: 'about', label: 'About it' }
] as const satisfies readonly { value: 'picture' | 'steps' | 'about'; label: string }[]

// ---------------------------------------------------------------- drawing

function Row({ snapshot }: { snapshot: Snapshot }): React.JSX.Element {
  return (
    <div className={`p4-row${snapshot.layout === 'buckets' ? ' buckets' : ''}`} role="list">
      {snapshot.cells.map((cell) => (
        <div key={cell.id} className={`p4-box${cell.mark ? ` ${cell.mark}` : ''}${cell.value === null ? ' empty' : ''}`} role="listitem">
          <span className="p4-box-value">{cell.value === null ? '—' : String(cell.value)}</span>
          {cell.note !== undefined && <small>{cell.note}</small>}
        </div>
      ))}
      {snapshot.cells.length === 0 && <p className="p2-faint">Nothing in it.</p>}
    </div>
  )
}

function Chain({ snapshot }: { snapshot: Snapshot }): React.JSX.Element {
  const doubly = snapshot.links.some((one) => one.role === 'prev')
  return (
    <div className="p4-chain" role="list">
      {snapshot.cells.map((cell, index) => (
        <div key={cell.id} className="p4-chain-part">
          <div className={`p4-box${cell.mark ? ` ${cell.mark}` : ''}`} role="listitem">
            <span className="p4-box-value">{cell.value === null ? '—' : String(cell.value)}</span>
            {cell.note !== undefined && <small>{cell.note}</small>}
          </div>
          {index < snapshot.cells.length - 1 && (
            <span className="p4-link" aria-hidden="true">
              {doubly ? '⇄' : '→'}
            </span>
          )}
        </div>
      ))}
      {snapshot.cells.length === 0 && <p className="p2-faint">Nothing in it.</p>}
    </div>
  )
}

/**
 * Draws a tree.
 *
 * Positions come from the depth the structure reported and the drawn order it gave, so a tree that has degenerated
 * into a line *looks* like a line. Laying it out prettily — spreading the nodes evenly whatever their real depth —
 * would hide the single most important thing this laboratory has to show.
 */
function Tree({ snapshot }: { snapshot: Snapshot }): React.JSX.Element {
  const placed = useMemo(() => {
    const depth = snapshot.depth ?? {}
    const deepest = Math.max(0, ...Object.values(depth))
    const width = Math.max(1, snapshot.cells.length)
    const stepX = 100 / (width + 1)
    const stepY = deepest === 0 ? 0 : 100 / (deepest + 1)
    const at = new Map<string, { x: number; y: number }>()
    for (const cell of snapshot.cells) {
      at.set(cell.id, { x: stepX * (cell.at + 1), y: deepest === 0 ? 50 : stepY * ((depth[cell.id] ?? 0) + 0.6) })
    }
    return { at, deepest }
  }, [snapshot])

  if (snapshot.cells.length === 0) return <p className="p2-faint">Nothing in it.</p>

  // Taller when the tree is deeper, so a degenerate tree is not squashed into looking balanced.
  const height = Math.max(200, 56 * (placed.deepest + 1))

  return (
    <div className="p4-tree" style={{ height: `${height}px` }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="p4-tree-lines">
        {snapshot.links.map((link, index) => {
          const from = placed.at.get(link.from)
          const to = placed.at.get(link.to)
          if (!from || !to) return null
          return (
            <line
              key={index}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className={`p4-tree-line${link.mark ? ` ${link.mark}` : ''}`}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
      </svg>
      {snapshot.cells.map((cell) => {
        const spot = placed.at.get(cell.id)
        if (!spot) return null
        return (
          <div
            key={cell.id}
            className={`p4-node${cell.mark ? ` ${cell.mark}` : ''}`}
            style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
          >
            <span>{cell.value === null ? '—' : String(cell.value)}</span>
            {cell.note !== undefined && <small>{cell.note}</small>}
          </div>
        )
      })}
    </div>
  )
}

function Picture({ snapshot }: { snapshot: Snapshot }): React.JSX.Element {
  if (snapshot.layout === 'tree') return <Tree snapshot={snapshot} />
  if (snapshot.layout === 'chain') return <Chain snapshot={snapshot} />
  return <Row snapshot={snapshot} />
}

// ---------------------------------------------------------------- the laboratory

export default function StructureLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const structures = useStructures()
  const values = instance?.values ?? {}

  const structure = String(values.structure ?? 'binary-search-tree')
  const keys = String(values.keys ?? '')
  const operation = String(values.operation ?? 'find')
  const argument = String(values.argument ?? '')
  const walk = String(values.walk ?? 'in-order')
  const collisions = String(values.collisions ?? 'chaining') as 'chaining' | 'linear-probing'
  const buckets = Number(values.buckets ?? 8)
  const compress = values.compress !== false
  const compareWith = String(values.compareWith ?? '').trim()

  const [at, setAt] = useState(0)
  const [showing, setShowing] = useState<'picture' | 'steps' | 'about'>('picture')

  /*
   * Rebuilding whenever the structure or its settings change, and *only* then. Changing the operation must not
   * rebuild, or every lookup would be performed on a fresh tree and the whole laboratory would be meaningless.
   */
  useEffect(() => {
    if (!structures.ready) return
    structures.ask({
      kind: 'make',
      structure: structure as never,
      collisions,
      buckets,
      compress,
      keys
    })
    setAt(0)
  }, [structures.ready, structure, keys, collisions, buckets, compress])

  const state = structures.state.value
  const run = (state?.run ?? null) as Run | null
  const entry = (state?.entry ?? null) as Entry | null
  const spread = (state?.spread ?? null) as Spread | null
  const picture = (state?.picture ?? null) as Snapshot | null
  const comparison = structures.comparison.value as Comparison | null

  const steps = run?.steps ?? []
  const shown = steps.length > 0 ? steps[Math.min(at, steps.length - 1)].snapshot : picture

  // Comparing is a separate request, asked for only when something was typed in the box.
  useEffect(() => {
    if (!structures.ready || compareWith.length === 0 || keys.trim().length === 0) return
    const ids = [structure, ...compareWith.split(/[\s,;]+/).filter((one) => one.length > 0)]
    structures.ask({ kind: 'compare', ids, keys, lookFor: argument })
  }, [structures.ready, compareWith, keys, structure, argument])

  const doIt = (): void => {
    if (!structures.ready) return
    structures.ask({
      kind: 'do',
      operation: operation as never,
      argument,
      ...(WALKABLE.has(structure) ? { walk: walk as never } : {})
    })
    setAt(0)
  }

  // Stepping through with the keyboard, because a timeline you can only drag is unusable without a mouse.
  const timeline = useRef<HTMLInputElement | null>(null)

  const available = entry?.operations ?? []
  const current = available.find((one) => one.id === operation) ?? null

  return (
    <section className="p2 p4" aria-label="Data Structures Laboratory">
      <header className="p2-bar">
        <strong>{entry?.name ?? 'Data structure'}</strong>
        {run !== null && (
          <span className="p2-faint">
            {run.operation}
            {run.argument ? ` ${run.argument}` : ''} — {run.answer}
          </span>
        )}
      </header>

      {structures.state.refused && (
        <p className="p2-refused" role="status">
          <strong>{structures.state.refused.says}</strong> {structures.state.refused.fix}
        </p>
      )}
      {structures.state.broke && (
        <p className="p2-refused" role="status">
          {structures.state.broke}
        </p>
      )}
      {run?.truncated && (
        <p className="p2-refused" role="status">
          <strong>This operation took more steps than can be recorded.</strong> What is shown is real as far as it goes,
          but there is more of it.
        </p>
      )}

      <div className="p2-controls">
        <button type="button" className="p2-btn primary" onClick={doIt} disabled={!structures.ready || structures.state.busy}>
          {current === null ? 'Run' : current.name}
        </button>
        {current !== null && <span className="p2-faint">{current.about}</span>}
        {run !== null && run.steps.length > 0 && (
          <>
            <button type="button" className="p2-btn" onClick={() => setAt((n) => Math.max(0, n - 1))} disabled={at === 0}>
              Back
            </button>
            <button
              type="button"
              className="p2-btn"
              onClick={() => setAt((n) => Math.min(steps.length - 1, n + 1))}
              disabled={at >= steps.length - 1}
            >
              Forward
            </button>
            <button type="button" className="p2-btn" onClick={() => setAt(steps.length - 1)} disabled={at >= steps.length - 1}>
              End
            </button>
          </>
        )}
      </div>

      {run !== null && steps.length > 1 && (
        <div className="p2-timeline">
          <input
            ref={timeline}
            type="range"
            min={0}
            max={steps.length - 1}
            value={Math.min(at, steps.length - 1)}
            onChange={(event) => setAt(Number(event.target.value))}
            aria-label={`Step ${at + 1} of ${steps.length}`}
          />
          <span className="p2-trace-n">
            step {Math.min(at, steps.length - 1) + 1} of {steps.length}
          </span>
        </div>
      )}

      {steps.length > 0 && (
        <p className="p4-says" role="status" aria-live="polite">
          {steps[Math.min(at, steps.length - 1)].says}
        </p>
      )}

      {/*
       * `.p2-tab.on` is what the stylesheet lights up, and this strip had never added `on` — so the chosen tab
       * looked exactly like the other two. The shared control adds it, along with the question the three answer.
       */}
      <Segmented
        className="p2-tabs"
        optionClass="p2-tab"
        label="What to show about this structure"
        value={showing}
        options={SHOWING}
        onChange={setShowing}
      />

      <div className="p2-split">
        <div className="p2-stage">
          {showing === 'picture' && shown !== null && (
            <>
              <Picture snapshot={shown} />
              <ul className="p4-notes">
                {shown.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </>
          )}
          {showing === 'picture' && shown === null && (
            <p className="p2-faint">{structures.state.busy ? 'Building it…' : 'Nothing built yet.'}</p>
          )}

          {showing === 'steps' && (
            <div className="p2-trace">
              {steps.length === 0 && <p className="p2-faint">No steps were recorded. Run an operation.</p>}
              <ol>
                {steps.map((step) => (
                  <li key={step.n}>
                    <button
                      type="button"
                      className={`p4-step${step.n === at ? ' here' : ''}`}
                      onClick={() => {
                        setAt(step.n)
                        setShowing('picture')
                      }}
                    >
                      <span className="p2-trace-n">{step.n + 1}</span> {step.says}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {showing === 'about' && entry !== null && (
            <div className="p4-about">
              <p>{entry.about}</p>
              <h4 className="p4-heading">Good at</h4>
              <ul>
                {entry.goodAt.map((one, index) => (
                  <li key={index}>{one}</li>
                ))}
              </ul>
              <h4 className="p4-heading">Bad at</h4>
              <ul>
                {entry.badAt.map((one, index) => (
                  <li key={index}>{one}</li>
                ))}
              </ul>
              <h4 className="p4-heading">Worth trying</h4>
              <p>{entry.watchOutFor}</p>
            </div>
          )}
        </div>

        <div className="p3-side">
          {run !== null && (
            <div className="p3-panel">
              <h4>What it cost</h4>
              <dl className="p3-facts">
                {(
                  [
                    ['Comparisons', run.counts.comparisons],
                    ['Buckets tried', run.counts.probes],
                    ['Reads', run.counts.reads],
                    ['Writes', run.counts.writes],
                    ['Pointers changed', run.counts.links],
                    ['Rotations', run.counts.rotations],
                    ['New nodes', run.counts.allocations],
                    ['Deepest reached', run.counts.deepest]
                  ] as const
                )
                  // Zero is not worth a row: a stack has no rotations and saying "0 rotations" is noise.
                  .filter(([, n]) => n > 0)
                  .map(([label, n]) => (
                    <div key={label} className="p4-fact">
                      <dt>{label}</dt>
                      <dd>{n.toLocaleString()}</dd>
                    </div>
                  ))}
              </dl>
              {current !== null && (
                <p className="p2-faint">
                  Stated cost: {current.costs}. What is above is what this run actually did.
                </p>
              )}
            </div>
          )}

          {spread !== null && (
            <div className="p3-panel">
              <h4>How evenly the keys landed</h4>
              <dl className="p3-facts">
                <div className="p4-fact">
                  <dt>Buckets used</dt>
                  <dd>
                    {spread.used} of {spread.buckets}
                  </dd>
                </div>
                <div className="p4-fact">
                  <dt>Busiest holds</dt>
                  <dd>{spread.longest}</dd>
                </div>
                <div className="p4-fact">
                  <dt>If spread evenly</dt>
                  <dd>{spread.ideal}</dd>
                </div>
                <div className="p4-fact">
                  <dt>Average lookup</dt>
                  <dd>{spread.averageLookup.toFixed(2)} comparisons</dd>
                </div>
              </dl>
              <p className="p2-faint">{spread.says}</p>
            </div>
          )}

          {comparison !== null && (
            <div className="p3-panel">
              <h4>Against the others</h4>
              <div className="p2-table-wrap">
                <table className="p2-table">
                  <thead>
                    <tr>
                      <th>Structure</th>
                      <th>Comparisons</th>
                      <th>Pointers</th>
                      <th>Stated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.sides.map((side) => (
                      <tr key={side.id}>
                        <td>{side.name}</td>
                        <td>{(side.counts.comparisons + side.counts.probes).toLocaleString()}</td>
                        <td>{side.counts.links.toLocaleString()}</td>
                        <td>{side.stated}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="p2-faint">{comparison.says}</p>
              <ul className="p4-notes">
                {comparison.sides.map((side) => (
                  <li key={side.id}>
                    <strong>{side.name}:</strong> {side.answer}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {structures.comparison.refused && (
            <p className="p2-refused" role="status">
              <strong>{structures.comparison.refused.says}</strong> {structures.comparison.refused.fix}
            </p>
          )}

          {entry !== null && (
            <div className="p3-panel">
              <h4>What this does not do</h4>
              <ul className="p3-assumptions">
                <li>Up to 4,000 keys. The counts stay exact; the picture stops being a picture well before that.</li>
                <li>The twelve structures it ships with. You cannot define your own here.</li>
                <li>
                  Operation counts, not timings. A count is the same on every machine and a timing is not, so the
                  comparison is honest rather than impressive.
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>

      {instance && onConfigure && (
        <details className="p2-settings" open>
          <summary>Settings</summary>
          <Parameters
            definitions={instance.definitions}
            shown={instance.shown}
            values={instance.values}
            onSet={onConfigure}
            busy={structures.state.busy}
          />
        </details>
      )}
    </section>
  )
}
