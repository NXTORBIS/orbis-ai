import { useEffect, useMemo } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes, Refused, didRefuse } from './LabShell'
import { useSystems } from './useSystems'
import { Gantt, CellGrid } from './Draw'

/**
 * The Operating System Laboratory.
 *
 * ## The chart is the schedule
 *
 * Every band is a slice the scheduler handed out, tick by tick, and the waiting times beside it are measured off that
 * chart rather than computed from a formula. The formulas only hold for the simple cases, and the interesting cases
 * are the others.
 *
 * ## Starvation is visible
 *
 * Strict priority with urgent work arriving will leave a background process waiting, and the chart shows it waiting
 * while the figures name it. A scheduler that quietly added ageing to avoid that would be teaching a different
 * algorithm from the one chosen.
 */

interface Slice {
  process: string | null
  from: number
  to: number
}

interface Outcome {
  id: string
  arrives: number
  needs: number
  priority: number
  finished: number | null
  turnaround: number | null
  waiting: number | null
  response: number | null
  preempted: number
}

interface Schedule {
  policy: string
  slices: readonly Slice[]
  processes: readonly Outcome[]
  averageWaiting: number
  averageTurnaround: number
  averageResponse: number
  contextSwitches: number
  idleTicks: number
  finishedAt: number
  starved: readonly string[]
  says: string
  notes: readonly string[]
}

interface Comparison {
  sides: readonly { policy: string; label: string; averageWaiting: number; averageResponse: number; contextSwitches: number; starved: readonly string[] }[]
  says: string
}

interface PageStep {
  wanted: number
  frames: readonly (number | null)[]
  fault: boolean
  evicted: number | null
}

interface Paging {
  policy: string
  frames: number
  steps: readonly PageStep[]
  faults: number
  hits: number
  faultRate: number
  says: string
  notes: readonly string[]
}

interface Belady {
  byFrames: readonly { frames: number; faults: number }[]
  anomalyAt: readonly { frames: number; from: number; to: number }[]
  says: string
}

interface Deadlock {
  deadlocked: boolean
  cycle: readonly string[]
  involved: readonly string[]
  says: string
  notes: readonly string[]
}

interface Banker {
  safe: boolean
  sequence: readonly string[]
  available: readonly number[]
  stuckWith: readonly string[]
  says: string
  notes: readonly string[]
}

interface Race {
  raced: boolean
  interleaving: readonly string[]
  counter: number
  shouldBe: number
  says: string
  notes: readonly string[]
}

/** Each process gets its own colour, picked by position so the chart and the table agree. */
const COLOURS = ['var(--cyan)', '#f0a33a', '#37d67a', '#c08bf0', '#e05c5c', '#5cc8e0', '#f472b6', '#a3e635']

/** Reads the processes somebody typed: a name, when it arrives, how long it needs, how urgent. */
function readProcesses(text: string): { id: string; arrives: number; needs: number; priority: number }[] {
  const out: { id: string; arrives: number; needs: number; priority: number }[] = []
  for (const line of String(text).split(/[;\n]/)) {
    const parts = line.trim().split(/[\s,]+/).filter((one) => one.length > 0)
    if (parts.length < 3) continue
    const arrives = Number(parts[1])
    const needs = Number(parts[2])
    if (!Number.isFinite(arrives) || !Number.isFinite(needs)) continue
    out.push({ id: parts[0], arrives, needs, priority: Number(parts[3] ?? 0) || 0 })
  }
  return out
}

export default function OsLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engines = useSystems()
  const values = instance?.values ?? {}

  const what = String(values.what ?? 'processes') as 'processes' | 'paging' | 'deadlock' | 'race'
  const policy = String(values.policy ?? 'round-robin')
  const quantum = Number(values.quantum ?? 4)
  const processText = String(values.processes ?? 'A 0 6 2; B 0 8 1; C 0 7 3; D 0 3 4')
  const compareText = String(values.compare ?? '')
  const referenceText = String(values.references ?? '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1')
  const frames = Number(values.frames ?? 3)
  const pagePolicy = String(values.pagePolicy ?? 'lru')
  const locked = values.locked === true
  const rounds = Number(values.rounds ?? 10)
  const workers = Number(values.workers ?? 2)

  const processes = useMemo(() => readProcesses(processText), [processText])
  const references = useMemo(
    () => referenceText.split(/[\s,]+/).map(Number).filter((one) => Number.isFinite(one)),
    [referenceText]
  )
  const compareWith = useMemo(
    () => compareText.split(/[\s,]+/).map((one) => one.trim()).filter((one) => one.length > 0),
    [compareText]
  )

  useEffect(() => {
    if (!engines.ready) return
    engines.ask({
      kind: 'scheduling',
      what,
      processes,
      policy: policy as never,
      quantum,
      compareWith: (compareWith.length > 0 ? [policy, ...compareWith] : []) as never,
      references,
      frames,
      pagePolicy: pagePolicy as never,
      locked,
      rounds,
      workers
    })
  }, [engines.ready, what, processes, policy, quantum, compareWith, references, frames, pagePolicy, locked, rounds, workers])

  const held = engines.scheduling.value
  const made = (held?.schedule ?? null) as Schedule | null
  const comparison = didRefuse(held?.comparison) ? null : ((held?.comparison ?? null) as Comparison | null)
  const paging = (held?.paging ?? null) as Paging | null
  const belady = didRefuse(held?.belady) ? null : ((held?.belady ?? null) as Belady | null)
  const deadlock = (held?.deadlock ?? null) as Deadlock | null
  const banker = didRefuse(held?.banker) ? null : ((held?.banker ?? null) as Banker | null)
  const raceHeld = (held?.race ?? null) as { without: Race; withLock: Race; showing: string } | null
  const race = raceHeld === null ? null : locked ? raceHeld.withLock : raceHeld.without

  return (
    <LabShell
      title={
        what === 'processes'
          ? 'Scheduling'
          : what === 'paging'
            ? 'Memory'
            : what === 'deadlock'
              ? 'Deadlock'
              : 'Sharing a counter'
      }
      summary={made?.says ?? paging?.says ?? deadlock?.says ?? race?.says}
      refused={engines.scheduling.refused}
      broke={engines.scheduling.broke}
      busy={engines.scheduling.busy}
      waitingFor="Working it out…"
      ready={held !== null}
      assumptions={held?.assumptions as readonly string[] | undefined}
      instance={instance}
      onConfigure={onConfigure}
      aside={
        <>
          <Refused held={held?.comparison} />
          <Refused held={held?.belady} />
          <Refused held={held?.banker} />

          {made !== null && (
            <Facts
              title="Measured off the chart"
              rows={[
                ['Average wait', made.averageWaiting.toFixed(2)],
                ['Average turnaround', made.averageTurnaround.toFixed(2)],
                ['Average first run', made.averageResponse.toFixed(2)],
                ['Context switches', made.contextSwitches],
                ['Idle ticks', made.idleTicks],
                ['Everything done by', made.finishedAt]
              ]}
            />
          )}

          {made !== null && made.starved.length > 0 && (
            <div className="p3-panel">
              <h4>Left waiting</h4>
              <p className="p2-faint">
                <strong>{made.starved.join(', ')}</strong> waited far longer than the rest. That is starvation, and
                this policy allows it.
              </p>
            </div>
          )}

          {comparison !== null && (
            <div className="p3-panel">
              <h4>Against the others</h4>
              <div className="p2-table-wrap">
                <table className="p2-table">
                  <thead>
                    <tr>
                      <th>Policy</th>
                      <th>Wait</th>
                      <th>First run</th>
                      <th>Switches</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.sides.map((one) => (
                      <tr key={one.policy}>
                        <td>{one.label}</td>
                        <td className="p4-num">{one.averageWaiting.toFixed(2)}</td>
                        <td className="p4-num">{one.averageResponse.toFixed(2)}</td>
                        <td className="p4-num">{one.contextSwitches}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="p2-faint">{comparison.says}</p>
            </div>
          )}

          {paging !== null && (
            <Facts
              title="Page faults"
              rows={[
                ['References', paging.steps.length],
                ['Faults', paging.faults],
                ['Found in memory', paging.hits],
                ['Fault rate', `${(paging.faultRate * 100).toFixed(1)}%`]
              ]}
              about={paging.says}
            />
          )}

          {belady !== null && (
            <div className="p3-panel">
              <h4>Does more memory help?</h4>
              <div className="p5-belady">
                {belady.byFrames.map((one, index) => {
                  const worse = index > 0 && one.faults > belady.byFrames[index - 1].faults
                  return (
                    <div key={one.frames} className={`p5-belady-bar${worse ? ' worse' : ''}`}>
                      <span style={{ height: `${(one.faults / Math.max(...belady.byFrames.map((x) => x.faults))) * 100}%` }} />
                      <small>{one.frames}</small>
                      <em>{one.faults}</em>
                    </div>
                  )
                })}
              </div>
              <p className="p2-faint">{belady.says}</p>
            </div>
          )}

          {banker !== null && (
            <Facts
              title="Is the state safe?"
              rows={[
                ['Safe', banker.safe ? 'yes' : 'no'],
                ['An order that works', banker.sequence.length > 0 ? banker.sequence.join(' → ') : 'there is none'],
                ['Left unallocated', banker.available.join(', ')]
              ]}
              about={banker.says}
            />
          )}

          {race !== null && (
            <Facts
              title="The counter"
              rows={[
                ['It came to', race.counter],
                ['It should be', race.shouldBe],
                ['Lost', race.shouldBe - race.counter]
              ]}
              about={race.says}
            />
          )}

          <Notes title="Worth knowing" notes={made?.notes ?? paging?.notes ?? deadlock?.notes ?? race?.notes} />
          <Notes title="And" notes={banker?.notes} />
        </>
      }
    >
      {what === 'processes' && made !== null && (
        <>
          <h4 className="p4-heading">Who had the processor</h4>
          {/*
            * One row per process, not one strip with everybody in it.
            *
            * A single strip shows the order and hides the waiting, and the waiting is the whole point of comparing
            * schedulers: a process's row is empty exactly while it sat ready and got nothing, which is the gap
            * round-robin shortens and shortest-job-first lengthens for the long ones.
            */}
          <Gantt
            rows={[...made.processes.map((one) => one.id), ...(made.idleTicks > 0 ? ['idle'] : [])]}
            bars={made.slices.map((slice) => ({
              row: slice.process ?? 'idle',
              start: slice.from,
              end: slice.to,
              label: slice.process ?? '',
              idle: slice.process === null
            }))}
            xLabel="time"
            about={`${made.contextSwitches} context switch${made.contextSwitches === 1 ? '' : 'es'}, finished at ${made.finishedAt}${made.idleTicks > 0 ? `, ${made.idleTicks} tick${made.idleTicks === 1 ? '' : 's'} with nothing ready` : ''}.`}
          />
          <h4 className="p4-heading">What each one got</h4>
          <div className="p2-table-wrap">
            <table className="p2-table">
              <thead>
                <tr>
                  <th>Process</th>
                  <th>Arrived</th>
                  <th>Needed</th>
                  <th>Waited</th>
                  <th>In the system</th>
                  <th>First ran after</th>
                  <th>Interrupted</th>
                </tr>
              </thead>
              <tbody>
                {made.processes.map((one, index) => (
                  <tr key={one.id} className={made.starved.includes(one.id) ? 'p5-starved' : ''}>
                    <td>
                      <span className="p4-swatch" style={{ background: COLOURS[index % COLOURS.length] }} aria-hidden="true" /> {one.id}
                    </td>
                    <td className="p4-num">{one.arrives}</td>
                    <td className="p4-num">{one.needs}</td>
                    <td className="p4-num">{one.waiting ?? '—'}</td>
                    <td className="p4-num">{one.turnaround ?? 'never finished'}</td>
                    <td className="p4-num">{one.response ?? '—'}</td>
                    <td className="p4-num">{one.preempted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {what === 'paging' && paging !== null && (
        <>
          <h4 className="p4-heading">What was in memory, reference by reference</h4>
          {/*
            * The same thing the table below says, as a picture.
            *
            * A fault is a column that changed, and a policy that keeps the wrong page shows as a stripe that keeps
            * being evicted and fetched again. That pattern is what tells least-recently-used apart from first-in
            * first-out, and it is invisible in a grid of numbers.
            */}
          <CellGrid
            columns={paging.steps.map((step) => String(step.wanted))}
            rows={Array.from({ length: paging.frames }, (_, i) => `frame ${i}`)}
            cellWidth={Math.max(18, Math.min(34, 560 / Math.max(1, paging.steps.length)))}
            cells={paging.steps.flatMap((step, column) =>
              step.frames.map((page, row) => ({
                column,
                row,
                text: page === null ? '' : String(page),
                group: page === null ? -1 : page === step.wanted && step.fault ? -2 : page % 6,
                title:
                  page === null
                    ? 'empty'
                    : `page ${page}${page === step.wanted && step.fault ? ' — just fetched, this was the fault' : ''}`
              }))
            )}
            about={`${paging.faults} fault${paging.faults === 1 ? '' : 's'} in ${paging.steps.length} references. A red cell is the page that had just been fetched, which is what a fault costs.`}
          />
          <h4 className="p4-heading">The same thing, as numbers</h4>
          <div className="p2-table-wrap p5-paging">
            <table className="p2-table">
              <thead>
                <tr>
                  <th>Asked for</th>
                  {Array.from({ length: paging.frames }, (_, i) => (
                    <th key={i}>frame {i + 1}</th>
                  ))}
                  <th>Thrown out</th>
                </tr>
              </thead>
              <tbody>
                {paging.steps.map((step, index) => (
                  <tr key={index} className={step.fault ? 'p5-fault' : ''}>
                    <td className="p5-wanted">{step.wanted}</td>
                    {Array.from({ length: paging.frames }, (_, i) => (
                      <td key={i} className={`p5-frame${step.frames[i] === step.wanted ? ' here' : ''}`}>
                        {step.frames[i] ?? ''}
                      </td>
                    ))}
                    <td className="p5-evicted">{step.evicted ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="p4-says">A shaded row is a page fault — the page was not in memory and had to be brought in.</p>
        </>
      )}

      {what === 'deadlock' && deadlock !== null && (
        <>
          <h4 className="p4-heading">Who is waiting on what</h4>
          <div className="p5-wait">
            {deadlock.cycle.length > 0 ? (
              deadlock.cycle.map((one, index) => (
                <span key={index} className={`p5-wait-node${one.startsWith('P') ? ' process' : ' resource'}`}>
                  {one}
                  {index < deadlock.cycle.length - 1 && <em aria-hidden="true">→</em>}
                </span>
              ))
            ) : (
              <p className="p2-faint">No circular wait.</p>
            )}
          </div>
          <p className="p4-says">{deadlock.says}</p>

          {banker !== null && (
            <>
              <h4 className="p4-heading">Can everybody still finish?</h4>
              <p className={banker.safe ? 'p4-says' : 'p2-refused'}>{banker.says}</p>
            </>
          )}
        </>
      )}

      {what === 'race' && race !== null && (
        <>
          <h4 className="p4-heading">{locked ? 'With a lock' : 'Without a lock'}</h4>
          <ol className="p5-interleaving">
            {race.interleaving.map((one, index) => (
              <li key={index} className={/reads/.test(one) ? 'reads' : /writes/.test(one) ? 'writes' : ''}>
                {one}
              </li>
            ))}
          </ol>
          <p className={race.counter === race.shouldBe ? 'p4-says' : 'p2-refused'}>{race.says}</p>
        </>
      )}
    </LabShell>
  )
}
