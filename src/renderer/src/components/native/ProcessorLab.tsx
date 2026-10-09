import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes } from './LabShell'
import { useSystems } from './useSystems'

/**
 * The Processor Laboratory.
 *
 * ## Both pipelines are always shown
 *
 * With forwarding and without, over the same executed trace. The number that teaches anything is the difference
 * between them, and a laboratory showing only whichever is switched on makes that difference invisible. They cannot
 * disagree about what ran, because they are two readings of one run.
 *
 * ## The diagram is the schedule, not a picture of a pipeline
 *
 * Each instruction's five stages are placed in the cycles the scheduler put them in. A stall is a gap because the
 * scheduler could not avoid one, and hovering it says which register was being waited for and why.
 */

interface Instruction {
  at: number
  kind: string
  line: number
  text: string
}

interface Step {
  n: number
  at: number
  instruction: Instruction
  registers: readonly number[]
  address: number | null
  cacheHit: boolean | null
  branchedTo: number | null
  says: string
}

interface RunReport {
  steps: readonly Step[]
  registers: readonly number[]
  memory: Readonly<Record<number, number>>
  instructionsRun: number
  halted: boolean
  ranAway: boolean
  cache: {
    reads: number
    writes: number
    hits: number
    misses: number
    coldMisses: number
    conflictMisses: number
    hitRate: number
    sets: number
    says: string
    notes: readonly string[]
  }
  problem: { says: string; fix: string; line?: number } | null
  says: string
  notes: readonly string[]
}

interface Slot {
  issue: number
  instruction: Instruction
  stages: Readonly<Record<string, number | null>>
  stalled: number
}

interface Hazard {
  kind: string
  cycle: number
  waiting: number
  register: number | null
  cyclesLost: number
  says: string
}

interface PipelineReport {
  slots: readonly Slot[]
  cycles: number
  instructions: number
  cpi: number
  hazards: readonly Hazard[]
  stallCycles: number
  withoutPipeline: number
  says: string
  notes: readonly string[]
}

const STAGE_LETTER: Readonly<Record<string, string>> = {
  fetch: 'F',
  decode: 'D',
  execute: 'E',
  memory: 'M',
  writeback: 'W'
}

export default function ProcessorLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engines = useSystems()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState('pipeline')
  const [at, setAt] = useState(0)

  const useSample = String(values.useSample ?? 'sum-array')
  const forwarding = values.forwarding !== false
  const predictTaken = values.predictTaken === true
  const cacheSize = Number(values.cacheSize ?? 64)
  const lineSize = Number(values.lineSize ?? 4)
  const ways = Number(values.ways ?? 1)
  const replacement = String(values.replacement ?? 'lru')

  useEffect(() => {
    if (!engines.ready) return
    engines.ask({
      kind: 'processor',
      source: '',
      useSample: useSample as never,
      forwarding,
      predictTaken,
      cacheSize,
      lineSize,
      ways,
      replacement: replacement as never
    })
    setAt(0)
  }, [engines.ready, useSample, forwarding, predictTaken, cacheSize, lineSize, ways, replacement])

  const held = engines.processor.value
  const ran = (held?.run ?? null) as RunReport | null
  const withForwarding = (held?.withForwarding ?? null) as PipelineReport | null
  const withoutForwarding = (held?.withoutForwarding ?? null) as PipelineReport | null
  const current = forwarding ? withForwarding : withoutForwarding

  const step = ran?.steps[Math.min(at, (ran?.steps.length ?? 1) - 1)]
  // Enough of the diagram to be readable; a loop runs for thousands of instructions and no chart of that is useful.
  const shownSlots = current?.slots.slice(0, 40) ?? []
  const widest = Math.max(1, ...shownSlots.map((one) => (one.stages.writeback as number | null) ?? 0))

  const saving = withForwarding !== null && withoutForwarding !== null ? withoutForwarding.cycles - withForwarding.cycles : 0

  return (
    <LabShell
      title="Processor"
      summary={ran?.says}
      refused={engines.processor.refused}
      broke={engines.processor.broke}
      busy={engines.processor.busy}
      waitingFor="Running the program…"
      ready={held !== null}
      assumptions={held?.assumptions as readonly string[] | undefined}
      instance={instance}
      onConfigure={onConfigure}
      tabs={[
        { id: 'pipeline', label: 'The pipeline' },
        { id: 'trace', label: 'What it executed' },
        { id: 'cache', label: 'The cache' }
      ]}
      showing={showing}
      onShow={setShowing}
      aside={
        <>
          {ran?.problem != null && (
            <p className="p2-refused" role="status">
              <strong>{ran.problem.says}</strong> {ran.problem.fix}
              {ran.problem.line !== undefined ? ` (line ${ran.problem.line})` : ''}
            </p>
          )}

          {current !== null && (
            <Facts
              title="What it cost"
              rows={[
                ['Instructions', current.instructions],
                ['Cycles', current.cycles],
                ['Cycles each', current.cpi.toFixed(2)],
                ['Lost to stalls', current.stallCycles],
                ['Without a pipeline', current.withoutPipeline]
              ]}
              about={current.says}
            />
          )}

          {withForwarding !== null && withoutForwarding !== null && (
            <div className="p3-panel">
              <h4>What passing results on is worth</h4>
              <dl className="p3-facts">
                <div className="p4-fact">
                  <dt>With it</dt>
                  <dd>{withForwarding.cycles} cycles</dd>
                </div>
                <div className="p4-fact">
                  <dt>Without it</dt>
                  <dd>{withoutForwarding.cycles} cycles</dd>
                </div>
                <div className="p4-fact">
                  <dt>Difference</dt>
                  <dd>
                    {saving} cycles, {withoutForwarding.cycles === 0 ? '0' : ((saving / withoutForwarding.cycles) * 100).toFixed(0)}%
                  </dd>
                </div>
              </dl>
              <p className="p2-faint">
                {saving > 0
                  ? 'Both are the same program, the same instructions and the same answer. The only difference is whether a result can be handed from the stage that produced it to the stage that needs it.'
                  : 'This program has nothing waiting on anything, so there is nothing for forwarding to save.'}
              </p>
            </div>
          )}

          {ran !== null && (
            <Facts
              title="The cache"
              rows={[
                ['Accesses', ran.cache.reads + ran.cache.writes],
                ['Hits', ran.cache.hits],
                ['Hit rate', `${(ran.cache.hitRate * 100).toFixed(1)}%`],
                ['Unavoidable misses', ran.cache.coldMisses],
                ['Avoidable misses', ran.cache.conflictMisses]
              ]}
              about={ran.cache.says}
            />
          )}

          <Notes title="Worth knowing" notes={current?.notes} />
          <Notes title="About the cache" notes={ran?.cache.notes} />
          <Notes title="About the program" notes={ran?.notes} />
        </>
      }
    >
      {showing === 'pipeline' && current !== null && (
        <>
          <h4 className="p4-heading">
            {forwarding ? 'With results passed straight on' : 'Without results passed straight on'}
          </h4>
          <div className="p5-pipeline">
            {shownSlots.map((slot) => (
              <div key={slot.issue} className="p5-pipeline-row">
                <span className="p5-pipeline-name" title={`line ${slot.instruction.line}`}>
                  {slot.instruction.text}
                </span>
                <div className="p5-pipeline-track">
                  {Array.from({ length: widest }, (_, cycle) => {
                    const stage = Object.entries(slot.stages).find(([, when]) => when === cycle + 1)
                    const stalling = slot.stalled > 0 && cycle + 1 > (slot.stages.fetch as number) && stage === undefined && cycle + 1 < (slot.stages.execute as number)
                    return (
                      <span
                        key={cycle}
                        className={`p5-stage${stage ? ` ${stage[0]}` : stalling ? ' stalled' : ''}`}
                        title={stage ? `${stage[0]} in cycle ${cycle + 1}` : stalling ? 'waiting' : ''}
                      >
                        {stage ? STAGE_LETTER[stage[0]] : stalling ? '·' : ''}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          {(current.slots.length ?? 0) > shownSlots.length && (
            <p className="p2-faint">
              Showing the first {shownSlots.length} of {current.slots.length} instructions. The figures on the right
              are over all of them.
            </p>
          )}

          {current.hazards.length > 0 && (
            <>
              <h4 className="p4-heading">Where it had to wait</h4>
              <ul className="p4-notes p5-hazards">
                {current.hazards.slice(0, 8).map((one, index) => (
                  <li key={index} className={one.kind}>
                    <strong>cycle {one.cycle}</strong> — {one.says}
                  </li>
                ))}
              </ul>
              {current.hazards.length > 8 && (
                <p className="p2-faint">and {current.hazards.length - 8} more of the same kinds.</p>
              )}
            </>
          )}
        </>
      )}

      {showing === 'trace' && ran !== null && step !== undefined && (
        <>
          <div className="p2-timeline">
            <input
              type="range"
              min={0}
              max={Math.max(0, ran.steps.length - 1)}
              value={Math.min(at, ran.steps.length - 1)}
              onChange={(event) => setAt(Number(event.target.value))}
              aria-label={`Instruction ${at + 1} of ${ran.steps.length}`}
            />
            <span className="p2-trace-n">
              {Math.min(at, ran.steps.length - 1) + 1} of {ran.steps.length}
            </span>
          </div>
          <p className="p4-says">
            <code>{step.instruction.text}</code> — {step.says}
          </p>

          <h4 className="p4-heading">Registers</h4>
          <div className="p4-row">
            {step.registers.map((value, index) => (
              <div key={index} className={`p4-box${value !== 0 ? ' changed' : ''}`}>
                <span className="p4-box-value">{value}</span>
                <small>r{index}</small>
              </div>
            ))}
          </div>

          {Object.keys(ran.memory).length > 0 && (
            <>
              <h4 className="p4-heading">Memory it touched</h4>
              <div className="p4-row buckets">
                {Object.entries(ran.memory)
                  .slice(0, 48)
                  .map(([address, value]) => (
                    <div key={address} className={`p4-box${step.address === Number(address) ? ' looking' : ''}`}>
                      <span className="p4-box-value">{value}</span>
                      <small>{address}</small>
                    </div>
                  ))}
              </div>
            </>
          )}
        </>
      )}

      {showing === 'cache' && ran !== null && (
        <>
          <h4 className="p4-heading">Every access, in order</h4>
          <div className="p5-cache-strip">
            {ran.steps
              .filter((one) => one.cacheHit !== null)
              .slice(0, 300)
              .map((one, index) => (
                <span
                  key={index}
                  className={`p5-access${one.cacheHit === true ? ' hit' : ' miss'}`}
                  title={`${one.cacheHit === true ? 'hit' : 'miss'} at address ${one.address}`}
                />
              ))}
          </div>
          <ul className="p4-legend">
            <li>
              <span className="p4-swatch" style={{ background: '#37d67a' }} aria-hidden="true" />
              found in the cache
            </li>
            <li>
              <span className="p4-swatch" style={{ background: '#e05c5c' }} aria-hidden="true" />
              had to go to memory
            </li>
          </ul>
          <p className="p4-says">
            {ran.cache.coldMisses > 0 && ran.cache.conflictMisses === 0
              ? 'Every miss here was unavoidable — the data had simply not been read before. No arrangement of a cache this size does better on this program.'
              : ran.cache.conflictMisses > ran.cache.coldMisses
                ? `${ran.cache.conflictMisses} of the misses were avoidable: the line had been in the cache and something pushed it out. More ways, or a different line size, would help.`
                : ran.cache.says}
          </p>
        </>
      )}
    </LabShell>
  )
}
