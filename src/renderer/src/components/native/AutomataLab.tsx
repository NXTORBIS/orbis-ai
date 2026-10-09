import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes } from './LabShell'
import { useCS } from './useCS'
import './phase7.css'

/**
 * The Theory of Computation Laboratory — run a machine, and turn one kind into the other.
 *
 * ## The transition table is the machine
 *
 * Not a picture of it. Reading down a column shows what one symbol does from everywhere, which is how you see that
 * a machine counts something; reading across a row shows one state's whole behaviour. A drawn graph of arrows looks
 * nicer and hides both.
 *
 * ## Three different rejections
 *
 * Fed a symbol that is not in the alphabet, having no arrow to follow, and finishing somewhere that does not accept
 * are three different things, and the card names which happened. "Rejected" on its own teaches nothing.
 */

interface Machine {
  states: readonly string[]
  alphabet: readonly string[]
  transitions: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>
  start: string
  accept: readonly string[]
}

interface Step {
  at: number
  symbol: string
  from: readonly string[]
  to: readonly string[]
  says: string
}

interface RunReport {
  accepted: boolean
  steps: readonly Step[]
  ended: readonly string[]
  rejected: string | null
  says: string
  notes: readonly string[]
}

interface SubsetReport {
  machine: Machine
  made: readonly { name: string; from: readonly string[]; accepting: boolean }[]
  deadState: string | null
  says: string
  notes: readonly string[]
}

interface BatchReport {
  rows: readonly { input: string; accepted: boolean; why: string }[]
  accepted: number
  says: string
}

const EMPTY = 'ε'

export default function AutomataLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engine = useCS()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState<string>('run')

  const preset = String(values.preset ?? 'ends-00')
  const input = String(values.input ?? '0100')
  const upTo = Number(values.upTo ?? 3)

  useEffect(() => {
    if (!engine.ready) return
    const what = showing === 'convert' ? 'convert' : showing === 'explore' ? 'explore' : 'run'
    engine.ask({ kind: 'automata', what, preset, machine: null, input, upTo })
  }, [engine.ready, preset, input, upTo, showing])

  const held = engine.automata.value
  const machine = (held?.machine ?? null) as Machine | null
  const kind = (held?.deterministic ?? null) as { yes: boolean; why: string } | null
  const presets = (held?.presets ?? []) as readonly { id: string; name: string; accepts: string; deterministic: boolean }[]
  const what = String(held?.what ?? 'run')
  const run = what === 'run' ? ((held?.report ?? null) as RunReport | null) : null
  const subset = what === 'convert' ? ((held?.report ?? null) as SubsetReport | null) : null
  const batch = what === 'explore' ? ((held?.report ?? null) as BatchReport | null) : null
  const chosen = presets.find((one) => one.id === preset) ?? null

  /** One cell of the transition table: where this state goes on this symbol. */
  const goesTo = (from: string, symbol: string): string => {
    const to = machine?.transitions[from]?.[symbol] ?? []
    return to.length === 0 ? '—' : to.join(', ')
  }

  const hasEmpty = machine !== null && machine.states.some((one) => (machine.transitions[one]?.[EMPTY] ?? []).length > 0)

  return (
    <LabShell
      title="Theory of Computation"
      summary={run?.says ?? subset?.says ?? batch?.says ?? chosen?.accepts}
      refused={engine.automata.refused}
      broke={engine.automata.broke}
      busy={engine.automata.busy}
      waitingFor="Running the machine…"
      ready={held !== null}
      instance={instance}
      onConfigure={onConfigure}
      tabs={[
        { id: 'run', label: 'Run a string' },
        { id: 'table', label: 'The machine' },
        { id: 'convert', label: 'Make it deterministic' },
        { id: 'explore', label: 'What it accepts' }
      ]}
      showing={showing}
      onShow={setShowing}
      aside={
        <>
          {machine !== null && (
            <Facts
              title="This machine"
              rows={[
                ['States', machine.states.length],
                ['Alphabet', machine.alphabet.join(', ')],
                ['Starts at', machine.start],
                ['Accepts in', machine.accept.join(', ')],
                ['Kind', kind?.yes ? 'deterministic' : 'non-deterministic']
              ]}
              about={kind?.why}
            />
          )}
          {run !== null && (
            <Facts
              title="This run"
              rows={[
                ['Answer', run.accepted ? 'accepted' : 'rejected'],
                ['Ended in', run.ended.length === 0 ? 'nowhere' : run.ended.join(', ')],
                [
                  'Why not',
                  run.rejected === null
                    ? ''
                    : run.rejected === 'symbol-not-in-alphabet'
                      ? 'a symbol it cannot read'
                      : run.rejected === 'nowhere-to-go'
                        ? 'it got stuck'
                        : 'it finished somewhere that does not accept'
                ]
              ]}
            />
          )}
          <Notes title="Worth knowing" notes={run?.notes ?? subset?.notes} />
        </>
      }
    >
      {showing === 'run' && run !== null && (
        <>
          <h4 className="p4-heading">{run.accepted ? 'Accepted' : 'Rejected'}</h4>
          {/* The string with the symbol being read marked, so the trace below has something to point at. */}
          <div className="p7-tape">
            {[...input].map((one, at) => (
              <span key={`${at}-${one}`} className={`p7-cell${run.steps.some((two) => two.at === at) ? '' : ' unread'}`}>
                {one}
              </span>
            ))}
            {input === '' && <span className="p2-faint">the empty string</span>}
          </div>
          <div className="p2-table-wrap p7-scroll">
            <table className="p2-table">
              <thead>
                <tr>
                  <th scope="col">Read</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">What happened</th>
                </tr>
              </thead>
              <tbody>
                {run.steps.map((one, at) => (
                  <tr key={`${at}-${one.at}`}>
                    <td>{one.symbol === '' ? '—' : one.symbol}</td>
                    <td>{one.from.length === 0 ? '—' : one.from.join(', ')}</td>
                    <td className={one.to.some((two) => machine?.accept.includes(two)) ? 'p7-accepting' : undefined}>
                      {one.to.length === 0 ? 'nowhere' : one.to.join(', ')}
                    </td>
                    <td className="p2-faint">{one.says}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showing === 'table' && machine !== null && (
        <>
          <h4 className="p4-heading">Transition table</h4>
          <div className="p2-table-wrap">
            <table className="p2-table">
              <thead>
                <tr>
                  <th scope="col">State</th>
                  {machine.alphabet.map((one) => (
                    <th key={one} scope="col">
                      {one}
                    </th>
                  ))}
                  {hasEmpty && <th scope="col">{EMPTY}</th>}
                </tr>
              </thead>
              <tbody>
                {machine.states.map((state) => (
                  <tr key={state}>
                    <td>
                      {state === machine.start && <span className="p7-mark">→</span>}
                      {machine.accept.includes(state) && <span className="p7-mark accept">◉</span>}
                      <strong>{state}</strong>
                    </td>
                    {machine.alphabet.map((symbol) => (
                      <td key={symbol} className={goesTo(state, symbol) === '—' ? 'p2-faint' : undefined}>
                        {goesTo(state, symbol)}
                      </td>
                    ))}
                    {hasEmpty && <td className={goesTo(state, EMPTY) === '—' ? 'p2-faint' : undefined}>{goesTo(state, EMPTY)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="p4-says">
            → marks where it starts and ◉ marks a state that accepts. A dash means there is no arrow, and landing on
            one is a rejection of a different kind from finishing somewhere that does not accept.
          </p>
          <p className="p2-faint">{kind?.why}</p>
        </>
      )}

      {showing === 'convert' && subset !== null && (
        <>
          <h4 className="p4-heading">{subset.says}</h4>
          <div className="p2-table-wrap">
            <table className="p2-table">
              <thead>
                <tr>
                  <th scope="col">New state</th>
                  <th scope="col">Stands for</th>
                  <th scope="col">Accepts</th>
                </tr>
              </thead>
              <tbody>
                {subset.made.map((one) => (
                  <tr key={one.name} className={one.accepting ? 'p7-accepting' : undefined}>
                    <td>
                      <strong>{one.name}</strong>
                    </td>
                    <td className="p2-faint">{one.from.length === 0 ? 'nothing — the dead state' : one.from.join(', ')}</td>
                    <td>{one.accepting ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="p4-says">
            Each new state is named after the set of old states the machine could be in. From a set and a symbol
            there is exactly one set it goes to — which is what deterministic means, and is the whole proof that the
            two kinds of machine describe the same languages.
          </p>
        </>
      )}

      {showing === 'explore' && batch !== null && (
        <>
          <h4 className="p4-heading">Every string up to {upTo} symbols</h4>
          <div className="p7-strings">
            {batch.rows.map((one) => (
              <span key={one.input} className={`p7-string${one.accepted ? ' yes' : ''}`} title={one.why}>
                {one.input}
              </span>
            ))}
          </div>
          <p className="p4-says">
            {batch.says} Reading the accepted ones together is how you check that the machine really does what it was
            meant to — rather than testing one string and hoping.
          </p>
        </>
      )}
    </LabShell>
  )
}
