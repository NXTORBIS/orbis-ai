import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes, Refused, didRefuse } from './LabShell'
import { useSystems } from './useSystems'
import { Diagram, Waves } from './Draw'

/**
 * The Digital Logic Laboratory.
 *
 * ## The truth table is produced by running the circuit
 *
 * Every row comes from evaluating the network for that combination of inputs, so the table and the circuit cannot
 * disagree. A table written beside a diagram can be wrong about it; one produced by running it cannot.
 *
 * ## A circuit that cannot settle is shown as not settling
 *
 * A ring of three inverters oscillates for ever, and the panel says so rather than showing the last value it happened
 * to hold. That is the most interesting thing a logic simulator can be asked, and faking it would be the worst thing
 * it could do.
 */

interface Gate {
  id: string
  kind: string
  from: readonly string[]
  to: string
  label?: string
}

interface LogicNetwork {
  inputs: readonly string[]
  outputs: readonly string[]
  gates: readonly Gate[]
  name?: string
}

interface Check {
  ok: boolean
  floating: readonly string[]
  hasFeedback: boolean
  depth: number | null
  problems: readonly string[]
  notes: readonly string[]
}

interface TruthRow {
  inputs: Readonly<Record<string, boolean>>
  outputs: Readonly<Record<string, boolean>>
  settled: string
}

interface TruthTable {
  inputs: readonly string[]
  outputs: readonly string[]
  rows: readonly TruthRow[]
  unsettled: number
  notes: readonly string[]
}

interface Simplified {
  expression: string
  literalsBefore: number
  literalsAfter: number
  says: string
}

interface Evaluation {
  wires: Readonly<Record<string, boolean>>
  outputs: Readonly<Record<string, boolean>>
  rounds: number
  settled: string
  unstable: readonly string[]
  says: string
}

interface Tick {
  tick: number
  holding: Readonly<Record<string, boolean>>
  outputs: Readonly<Record<string, boolean>>
  problem: string | null
}

interface Clocked {
  ticks: readonly Tick[]
  cycles: boolean
  cycleLength: number | null
  says: string
  notes: readonly string[]
}

const LEVEL = (on: boolean): string => (on ? '1' : '0')

export default function LogicLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engines = useSystems()
  const values = instance?.values ?? {}
  const [at, setAt] = useState(0)

  const what = String(values.what ?? 'truth-table') as 'blueprint' | 'truth-table' | 'simplify' | 'clocked'
  const blueprint = String(values.blueprint ?? 'half-adder')
  const output = String(values.output ?? 'sum')
  const sequential = String(values.sequential ?? 'counter') as 'counter' | 'shift-register'
  const bits = Number(values.bits ?? 4)
  const ticks = Number(values.ticks ?? 20)

  useEffect(() => {
    if (!engines.ready) return
    engines.ask({ kind: 'logic', what, blueprint: blueprint as never, output, sequential, bits, ticks, inputs: {} })
    setAt(0)
  }, [engines.ready, what, blueprint, output, sequential, bits, ticks])

  const held = engines.logic.value
  const network = (held?.network ?? null) as LogicNetwork | null
  const check = (held?.check ?? null) as Check | null
  const table = didRefuse(held?.table) ? null : ((held?.table ?? null) as TruthTable | null)
  const expression = didRefuse(held?.expression) ? null : ((held?.expression ?? null) as Simplified | null)
  const evaluation = didRefuse(held?.evaluation) ? null : ((held?.evaluation ?? null) as Evaluation | null)
  const clocked = (held?.clocked ?? null) as Clocked | null

  const showing = clocked?.ticks[Math.min(at, (clocked?.ticks.length ?? 1) - 1)]

  return (
    <LabShell
      title={network?.name ?? 'Digital logic'}
      summary={
        what === 'clocked'
          ? clocked?.says
          : check === null
            ? undefined
            : check.hasFeedback
              ? 'This circuit feeds back on itself, which is how it remembers.'
              : `${check.depth} gate${check.depth === 1 ? '' : 's'} deep`
      }
      refused={engines.logic.refused}
      broke={engines.logic.broke}
      busy={engines.logic.busy}
      waitingFor="Working the circuit out…"
      ready={held !== null}
      assumptions={held?.assumptions as readonly string[] | undefined}
      instance={instance}
      onConfigure={onConfigure}
      aside={
        <>
          <Refused held={held?.table} />
          <Refused held={held?.expression} />

          {check !== null && (
            <Facts
              title="The circuit"
              rows={[
                ['Gates', network?.gates.length ?? 0],
                ['Inputs', network?.inputs.length ?? 0],
                ['Outputs', network?.outputs.length ?? 0],
                ['Levels deep', check.depth === null ? 'it loops, so there is no depth' : check.depth],
                ['Wired properly', check.ok ? 'yes' : 'no']
              ]}
            />
          )}

          {expression !== null && (
            <Facts
              title="The smallest expression"
              rows={[
                [output, expression.expression],
                ['Literals', `${expression.literalsAfter} (was ${expression.literalsBefore})`]
              ]}
              about={expression.says}
            />
          )}

          {evaluation !== null && evaluation.settled !== 'settled' && (
            <div className="p3-panel">
              <h4>It never settles</h4>
              <p className="p2-faint">{evaluation.says}</p>
            </div>
          )}

          {clocked !== null && (
            <Facts
              title="Over time"
              rows={[
                ['Ticks', clocked.ticks.length],
                ['Repeats every', clocked.cycleLength === null ? 'it did not repeat' : `${clocked.cycleLength} ticks`]
              ]}
              about={clocked.says}
            />
          )}

          <Notes title="Worth knowing" notes={check?.notes ?? clocked?.notes ?? table?.notes} />
          {check !== null && check.problems.length > 0 && <Notes title="Problems with the wiring" notes={check.problems} />}
        </>
      }
    >
      {/* The gates, as a list of what each one does, which is what the circuit actually is. */}
      {network !== null && what !== 'clocked' && (
        <>
          <h4 className="p4-heading">The circuit</h4>
          {/*
            * The circuit as a circuit, which is what somebody opening a logic laboratory came to see.
            *
            * Laid out by how far each gate is from an input, so the depth of the diagram is the depth of the circuit
            * -- the thing that decides how long it takes to settle. A wire carrying a one right now is drawn in the
            * accent, so the truth table and the picture are the same fact twice.
            */}
          <Diagram
            nodes={[
              ...network.inputs.map((one, index) => ({ id: one, label: one, depth: 0, group: index % 6,
                note: evaluation !== null ? LEVEL(evaluation.wires[one] === true) : undefined })),
              ...network.gates.map((gate) => ({ id: gate.to, label: gate.kind.toUpperCase(),
                note: evaluation !== null ? `${gate.to} = ${LEVEL(evaluation.wires[gate.to] === true)}` : gate.to }))
            ]}
            edges={network.gates.flatMap((gate) =>
              gate.from.map((from) => ({ from, to: gate.to, marked: evaluation !== null && evaluation.wires[from] === true }))
            )}
            about={
              check === null
                ? undefined
                : check.hasFeedback
                  ? 'This one feeds back on itself, so it has no depth: that loop is how it remembers.'
                  : `${check.depth} gate${check.depth === 1 ? '' : 's'} from an input to an output, which is how long it takes to settle.`
            }
          />
          <h4 className="p4-heading">Every gate, in words</h4>
          <div className="p5-gates">
            {network.gates.map((gate) => (
              <div key={gate.id} className="p5-gate">
                <span className="p5-gate-kind">{gate.kind}</span>
                <span className="p5-gate-wires">
                  {gate.from.join(', ')} <span aria-hidden="true">→</span> <strong>{gate.to}</strong>
                </span>
                {evaluation !== null && (
                  <span className={`p5-level${evaluation.wires[gate.to] ? ' on' : ''}`}>{LEVEL(evaluation.wires[gate.to] === true)}</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {table !== null && (
        <>
          <h4 className="p4-heading">Every combination, run</h4>
          <div className="p2-table-wrap p5-truth">
            <table className="p2-table">
              <thead>
                <tr>
                  {table.inputs.map((one) => (
                    <th key={one} scope="col" className="p5-in">
                      {one}
                    </th>
                  ))}
                  {table.outputs.map((one) => (
                    <th key={one} scope="col" className="p5-out">
                      {one}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, index) => (
                  <tr key={index}>
                    {table.inputs.map((one) => (
                      <td key={one} className={`p5-bit${row.inputs[one] ? ' on' : ''}`}>
                        {LEVEL(row.inputs[one] === true)}
                      </td>
                    ))}
                    {table.outputs.map((one) => (
                      <td key={one} className={`p5-bit out${row.outputs[one] ? ' on' : ''}`}>
                        {LEVEL(row.outputs[one] === true)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {table.unsettled > 0 && (
            <p className="p4-says">
              {table.unsettled} of these rows never settled, so this circuit has no single truth table — what it
              outputs depends on what it was already holding. That is what makes it memory.
            </p>
          )}
        </>
      )}

      {clocked !== null && showing !== undefined && (
        <>
          <h4 className="p4-heading">The signals over time</h4>
          {/*
            * A logic analyser's picture, because that is the instrument this is pretending to be.
            *
            * In a counter each bit's period doubles, and that doubling is simply visible here and completely hidden
            * in a column of ones and zeros. A shift register shows the same pattern walking sideways one tick at a
            * time. Neither fact needs explaining once it is drawn.
            */}
          <Waves
            waves={Object.keys(clocked.ticks[0]?.holding ?? {})
              .sort()
              .map((id) => ({ name: id, values: clocked.ticks.map((tick) => tick.holding[id] === true) }))}
            about={
              clocked.cycleLength === null
                ? 'It did not repeat within the ticks asked for.'
                : `It repeats every ${clocked.cycleLength} ticks.`
            }
          />

          <h4 className="p4-heading">Tick by tick</h4>
          <div className="p2-timeline">
            <input
              type="range"
              min={0}
              max={clocked.ticks.length - 1}
              value={Math.min(at, clocked.ticks.length - 1)}
              onChange={(event) => setAt(Number(event.target.value))}
              aria-label={`Tick ${at + 1} of ${clocked.ticks.length}`}
            />
            <span className="p2-trace-n">
              tick {Math.min(at, clocked.ticks.length - 1)} of {clocked.ticks.length - 1}
            </span>
          </div>

          <div className="p4-row">
            {Object.entries(showing.holding)
              .sort()
              .reverse()
              .map(([id, on]) => (
                <div key={id} className={`p4-box${on ? ' found' : ''}`}>
                  <span className="p4-box-value">{LEVEL(on)}</span>
                  <small>{id}</small>
                </div>
              ))}
          </div>
          {sequential === 'counter' && (
            <p className="p4-says">
              As a number:{' '}
              <strong>
                {/* Sorted by flip-flop name, so bit 0 is first and the place value is the position. */}
                {Object.entries(showing.holding)
                  .sort()
                  .reduce((total, [, on], index) => total + (on ? 2 ** index : 0), 0)}
              </strong>
            </p>
          )}
          {showing.problem !== null && <p className="p2-refused">{showing.problem}</p>}

          {/* The whole run at a glance, so a repeat is visible rather than having to be counted. */}
          <div className="p5-strip" aria-hidden="true">
            {clocked.ticks.map((tick) => (
              <button
                key={tick.tick}
                type="button"
                className={`p5-strip-tick${tick.tick === at ? ' here' : ''}`}
                onClick={() => setAt(tick.tick)}
                title={`Tick ${tick.tick}`}
              >
                {Object.keys(tick.holding)
                  .sort()
                  .reverse()
                  .map((id) => <span key={id} className={`p5-strip-bit${tick.holding[id] ? ' on' : ''}`} />)}
              </button>
            ))}
          </div>
        </>
      )}
    </LabShell>
  )
}
