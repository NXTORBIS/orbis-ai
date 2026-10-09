import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  cnot,
  cphase,
  emptyCircuit,
  faultsIn,
  gate,
  inverse,
  measure,
  resources,
  run,
  sample,
  swap,
  type Circuit,
  type Operation
} from '../../../../shared/quantum/circuit'
import { GATES, gateInfo } from '../../../../shared/quantum/gates'
import {
  MAX_QUBITS,
  blochOf,
  capacityFor,
  ket,
  normCheck,
  rows,
  type StateVector
} from '../../../../shared/quantum/state'
import { NOISE_DOES, NOISE_NAMES, coherence, densityOf, populations, purity, reduced, runNoisy, type ChannelKind } from '../../../../shared/quantum/noise'
import { CODES, correctOnce, surveyCode, type CodeKind, type ErrorKind } from '../../../../shared/quantum/correction'
import {
  bernsteinVazirani,
  deutsch,
  deutschJozsa,
  grover,
  inverseQft,
  phaseEstimate,
  qft,
  shor,
  superdense,
  teleport
} from '../../../../shared/quantum/algorithms'
import './quantum.css'

/**
 * The Quantum Studio.
 *
 * ## One state, every view
 *
 * The circuit is the single source of truth. The state table, the Bloch sphere, the histogram and the resource
 * figures are all computed from it on every change, so they cannot disagree — which matters more here than
 * almost anywhere, because a Bloch sphere showing one thing and a probability table another would teach
 * something false and look convincing while doing it.
 *
 * ## Nothing displayed is a stock answer
 *
 * Every number comes from `src/shared/quantum`, which is pure and has 94 tests behind it. The algorithms are
 * built from gates and run; Grover's curve is measured at each iteration; the noise figures are averages over
 * trajectories and say so. Where the simulation cannot do something — too many qubits, an inverse of a measured
 * circuit — it refuses with a reason rather than drawing something plausible.
 *
 * ## The honesty labels are part of the interface
 *
 * "Exact", "sampled" and "noisy average" are shown on the result, not buried in documentation. A learner should
 * never have to wonder which kind of number they are looking at.
 */

interface SurfaceProps {
  parameters?: Record<string, unknown>
  onNotify?(message: string, kind?: 'info' | 'warn' | 'error'): void
}

type Section = 'circuit' | 'state' | 'bloch' | 'measure' | 'algorithms' | 'noise' | 'correction'

const SECTIONS: readonly { id: Section; label: string; about: string }[] = Object.freeze([
  { id: 'circuit', label: 'Circuit', about: 'Build it gate by gate' },
  { id: 'state', label: 'State', about: 'Every amplitude, phase and probability' },
  { id: 'bloch', label: 'Bloch sphere', about: 'One qubit, geometrically' },
  { id: 'measure', label: 'Measurement', about: 'Shots, bases, and the sample against the theory' },
  { id: 'algorithms', label: 'Algorithms', about: 'Deutsch to Shor, computed' },
  { id: 'noise', label: 'Noise', about: 'Channels, fidelity and depth' },
  { id: 'correction', label: 'Error correction', about: 'Encode, break, detect, repair' }
])

const PRESETS: readonly { id: string; label: string; qubits: number; build(qubits: number): Circuit }[] = Object.freeze([
  {
    id: 'bell',
    label: 'Bell state',
    qubits: 2,
    build: () => cnot(gate(emptyCircuit(2, 2, 'Bell state'), 'h', 0), 0, 1)
  },
  {
    id: 'ghz',
    label: 'GHZ state',
    qubits: 3,
    build: () => cnot(cnot(gate(emptyCircuit(3, 3, 'GHZ state'), 'h', 0), 0, 1), 1, 2)
  },
  {
    id: 'superposition',
    label: 'Hadamard on every qubit',
    qubits: 3,
    build: (qubits: number) => {
      let out = emptyCircuit(qubits, qubits, 'Superposition')
      for (let at = 0; at < qubits; at += 1) out = gate(out, 'h', at)
      return out
    }
  },
  {
    id: 'interference',
    label: 'Interference: H, Z, H',
    qubits: 1,
    build: () => gate(gate(gate(emptyCircuit(1, 1, 'H Z H'), 'h', 0), 'z', 0), 'h', 0)
  },
  {
    id: 'qft',
    label: 'Fourier transform',
    qubits: 3,
    build: (qubits: number) => qft(emptyCircuit(qubits, qubits, 'QFT'), Array.from({ length: qubits }, (_one, at) => at))
  },
  {
    id: 'qft-inverse',
    label: 'Transform then inverse',
    qubits: 3,
    build: (qubits: number) => {
      const which = Array.from({ length: qubits }, (_one, at) => at)
      return inverseQft(qft(emptyCircuit(qubits, qubits, 'QFT then inverse'), which), which)
    }
  }
])

export default function QuantumStudio({ parameters, onNotify }: SurfaceProps): React.JSX.Element {
  const asked = (parameters ?? {}) as Record<string, unknown>
  const [section, setSection] = useState<Section>(() => {
    const want = String(asked.section ?? 'circuit')
    return SECTIONS.some((one) => one.id === want) ? (want as Section) : 'circuit'
  })
  const [qubits, setQubits] = useState(() => clamp(Number(asked.qubits ?? 2), 1, MAX_QUBITS))
  const [circuit, setCircuit] = useState<Circuit>(() => emptyCircuit(clamp(Number(asked.qubits ?? 2), 1, MAX_QUBITS)))
  const [atStep, setAtStep] = useState<number | null>(null)
  const [said, setSaid] = useState<string | null>(null)

  // Build controls
  const [picked, setPicked] = useState('h')
  const [target, setTarget] = useState(0)
  const [control, setControl] = useState(-1)
  const [angle, setAngle] = useState(Math.PI / 2)

  // Measurement
  const [shots, setShots] = useState(() => clamp(Number(asked.shots ?? 1000), 1, 100000))
  const [seed, setSeed] = useState(() => clamp(Number(asked.seed ?? 0), 0, 1_000_000))

  // Noise
  const [channel, setChannel] = useState<ChannelKind | ''>('')
  const [rate, setRate] = useState(0.02)

  const faults = useMemo(() => faultsIn(circuit), [circuit])

  /** The exact run. Recomputed whenever the circuit changes, which is what keeps every view in agreement. */
  const out = useMemo(() => {
    if (faults.length > 0) return null
    try {
      return run(circuit, { keepEvery: 1 })
    } catch (error) {
      return null
    }
  }, [circuit, faults])

  const shown: StateVector | null = useMemo(() => {
    if (!out) return null
    if (atStep === null) return out.state
    return out.steps[Math.min(atStep, out.steps.length - 1)]?.state ?? out.state
  }, [out, atStep])

  const cost = useMemo(() => resources(circuit), [circuit])
  const capacity = useMemo(() => capacityFor(qubits), [qubits])

  const note = useCallback(
    (message: string, kind: 'info' | 'warn' | 'error' = 'info') => {
      setSaid(message)
      onNotify?.(message, kind)
    },
    [onNotify]
  )

  const setSize = useCallback((many: number) => {
    const want = clamp(many, 1, MAX_QUBITS)
    const can = capacityFor(want)
    if (!can.ok) {
      note(can.says, 'warn')
      return
    }
    setQubits(want)
    setCircuit(emptyCircuit(want))
    setAtStep(null)
    setTarget((one) => Math.min(one, want - 1))
    setControl((one) => Math.min(one, want - 1))
  }, [note])

  const add = useCallback(() => {
    const info = gateInfo(picked)
    if (!info) return
    setAtStep(null)
    setCircuit((before) => {
      if (picked === 'swap') return swap(before, target, control < 0 ? Math.min(target + 1, qubits - 1) : control)
      if (picked === 'cp') return cphase(before, angle, control < 0 ? 0 : control, target)
      if (info.qubits === 1 && control >= 0) {
        return { ...before, ops: [...before.ops, { kind: 'controlled', gate: picked, controls: [control], target, ...(info.parameterised ? { theta: angle } : {}) } as Operation] }
      }
      if (info.qubits === 2) {
        const which = control < 0 ? 0 : control
        return { ...before, ops: [...before.ops, { kind: 'controlled', gate: picked === 'cx' ? 'x' : picked === 'cz' ? 'z' : picked, controls: [which], target } as Operation] }
      }
      if (info.qubits === 3) {
        const first = control < 0 ? 0 : control
        const second = first === 0 ? 1 : 0
        return { ...before, ops: [...before.ops, { kind: 'controlled', gate: 'x', controls: [first, second], target } as Operation] }
      }
      return gate(before, picked, target, info.parameterised ? angle : undefined)
    })
  }, [angle, control, picked, qubits, target])

  const addMeasure = useCallback(() => {
    setAtStep(null)
    setCircuit((before) => measure(before, target, Math.min(target, before.bits - 1)))
  }, [target])

  const undo = useCallback(() => {
    setAtStep(null)
    setCircuit((before) => ({ ...before, ops: before.ops.slice(0, -1) }))
  }, [])

  const clear = useCallback(() => {
    setAtStep(null)
    setCircuit(emptyCircuit(qubits))
    setSaid(null)
  }, [qubits])

  const appendInverse = useCallback(() => {
    const got = inverse(circuit)
    if (got.refused) {
      note(got.refused, 'warn')
      return
    }
    setAtStep(null)
    setCircuit((before) => ({ ...before, ops: [...before.ops, ...got.circuit.ops] }))
    note('The inverse has been appended. Running the whole thing should return every amplitude to the starting state.')
  }, [circuit, note])

  const loadPreset = useCallback(
    (id: string) => {
      const preset = PRESETS.find((one) => one.id === id)
      if (!preset) return
      const want = Math.max(preset.qubits, 1)
      setQubits(want)
      setCircuit(preset.build(want))
      setAtStep(null)
      note(`${preset.label} loaded — ${preset.build(want).ops.length} operations.`)
    },
    [note]
  )

  // A parameter handed in from outside (Orion, or a lesson) opens the right bench.
  useEffect(() => {
    const want = String(asked.section ?? '')
    if (want && SECTIONS.some((one) => one.id === want)) setSection(want as Section)
    const preset = String(asked.preset ?? '')
    if (preset) loadPreset(preset)
  }, [asked.section, asked.preset, loadPreset])

  return (
    <section className="qs" aria-label="Quantum Studio">
      <header className="qs-head">
        <div className="qs-title">
          <strong>Quantum Studio</strong>
          <span>{capacity.says}</span>
        </div>
        <nav className="qs-tabs" aria-label="Sections">
          {SECTIONS.map((one) => (
            <button
              key={one.id}
              type="button"
              className={`qs-tab${section === one.id ? ' is-on' : ''}`}
              aria-pressed={section === one.id}
              title={one.about}
              onClick={() => setSection(one.id)}
            >
              {one.label}
            </button>
          ))}
        </nav>
      </header>

      {faults.length > 0 && (
        <div className="qs-faults" role="alert">
          <strong>This circuit will not run:</strong>
          <ul>
            {faults.slice(0, 4).map((one) => (
              <li key={`${one.at}:${one.says}`}>
                {one.at >= 0 ? `Step ${one.at + 1}: ` : ''}
                {one.says}
              </li>
            ))}
          </ul>
        </div>
      )}

      {said !== null && (
        <p className="qs-said">
          {said}
          <button type="button" onClick={() => setSaid(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      )}

      <div className="qs-body">
        {section === 'circuit' && (
          <CircuitBench
            circuit={circuit}
            qubits={qubits}
            cost={cost}
            picked={picked}
            target={target}
            control={control}
            angle={angle}
            atStep={atStep}
            steps={out?.steps.length ?? 0}
            state={shown}
            onSize={setSize}
            onPick={setPicked}
            onTarget={setTarget}
            onControl={setControl}
            onAngle={setAngle}
            onAdd={add}
            onMeasure={addMeasure}
            onUndo={undo}
            onClear={clear}
            onInverse={appendInverse}
            onStep={setAtStep}
            onPreset={loadPreset}
          />
        )}

        {section === 'state' && <StateBench state={shown} />}
        {section === 'bloch' && <BlochBench state={shown} qubits={qubits} />}
        {section === 'measure' && <MeasureBench circuit={circuit} shots={shots} seed={seed} onShots={setShots} onSeed={setSeed} runnable={faults.length === 0} />}
        {section === 'algorithms' && <AlgorithmBench onLoad={(made, says) => { setQubits(made.qubits); setCircuit(made); setAtStep(null); note(says) }} />}
        {section === 'noise' && (
          <NoiseBench circuit={circuit} channel={channel} rate={rate} shots={shots} seed={seed} onChannel={setChannel} onRate={setRate} runnable={faults.length === 0} />
        )}
        {section === 'correction' && <CorrectionBench />}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- the circuit bench

function CircuitBench(props: {
  circuit: Circuit
  qubits: number
  cost: ReturnType<typeof resources>
  picked: string
  target: number
  control: number
  angle: number
  atStep: number | null
  steps: number
  state: StateVector | null
  onSize(many: number): void
  onPick(id: string): void
  onTarget(at: number): void
  onControl(at: number): void
  onAngle(value: number): void
  onAdd(): void
  onMeasure(): void
  onUndo(): void
  onClear(): void
  onInverse(): void
  onStep(at: number | null): void
  onPreset(id: string): void
}): React.JSX.Element {
  const info = gateInfo(props.picked)
  return (
    <div className="qs-split">
      <div className="qs-pane">
        <h4>Build</h4>
        <div className="qs-controls">
          <label>
            Qubits
            <input type="number" min={1} max={MAX_QUBITS} value={props.qubits} onChange={(e) => props.onSize(Number(e.target.value))} />
          </label>
          <label>
            Gate
            <select value={props.picked} onChange={(e) => props.onPick(e.target.value)}>
              {GATES.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Target
            <input type="number" min={0} max={props.qubits - 1} value={props.target} onChange={(e) => props.onTarget(Number(e.target.value))} />
          </label>
          <label>
            Control
            <input type="number" min={-1} max={props.qubits - 1} value={props.control} onChange={(e) => props.onControl(Number(e.target.value))} />
          </label>
          {info?.parameterised && (
            <label className="qs-wide">
              Angle {props.angle.toFixed(3)} rad
              <input type="range" min={-6.2832} max={6.2832} step={0.0628} value={props.angle} onChange={(e) => props.onAngle(Number(e.target.value))} />
            </label>
          )}
        </div>

        {info && (
          <p className="qs-about">
            <strong>{info.name}.</strong> {info.does}
            {info.bloch ? ` On the Bloch sphere: ${info.bloch.toLowerCase()}.` : ''}
          </p>
        )}

        <div className="qs-actions">
          <button type="button" className="qs-go" onClick={props.onAdd}>
            Add gate
          </button>
          <button type="button" onClick={props.onMeasure}>
            Add measurement
          </button>
          <button type="button" onClick={props.onUndo} disabled={props.circuit.ops.length === 0}>
            Undo
          </button>
          <button type="button" onClick={props.onInverse} disabled={props.circuit.ops.length === 0}>
            Append inverse
          </button>
          <button type="button" onClick={props.onClear} disabled={props.circuit.ops.length === 0}>
            Clear
          </button>
        </div>

        <h4>Start from</h4>
        <div className="qs-presets">
          {PRESETS.map((one) => (
            <button key={one.id} type="button" onClick={() => props.onPreset(one.id)}>
              {one.label}
            </button>
          ))}
        </div>

        <h4>What it costs</h4>
        <table className="qs-table">
          <tbody>
            <tr>
              <th>Operations</th>
              <td>{props.cost.gates}</td>
            </tr>
            <tr>
              <th>Depth</th>
              <td>{props.cost.depth}</td>
            </tr>
            <tr>
              <th>One-qubit</th>
              <td>{props.cost.oneQubit}</td>
            </tr>
            <tr>
              <th>Two or more qubits</th>
              <td>{props.cost.twoQubit + props.cost.multiQubit}</td>
            </tr>
            <tr>
              <th>Measurements</th>
              <td>{props.cost.measurements}</td>
            </tr>
            <tr>
              <th>State vector</th>
              <td>{(props.cost.stateBytes / 1024).toFixed(1)} KB</td>
            </tr>
          </tbody>
        </table>
        <p className="qs-about">{props.cost.says}</p>
      </div>

      <div className="qs-pane">
        <h4>The circuit</h4>
        <Diagram circuit={props.circuit} />

        <h4>Timeline</h4>
        {props.steps === 0 ? (
          <p className="qs-about">Add a gate and the state after each step appears here.</p>
        ) : (
          <>
            <input
              type="range"
              min={0}
              max={Math.max(0, props.steps - 1)}
              value={props.atStep ?? props.steps - 1}
              onChange={(e) => props.onStep(Number(e.target.value))}
              aria-label="Step through the circuit"
            />
            <p className="qs-about">
              Step {(props.atStep ?? props.steps - 1) + 1} of {props.steps}
              {props.atStep !== null && props.atStep < props.steps - 1 ? ' — showing the state part way through' : ' — the final state'}
            </p>
          </>
        )}

        {props.state && (
          <>
            <h4>State</h4>
            <p className="qs-ket">{ket(props.state)}</p>
            <AmplitudeTable state={props.state} />
          </>
        )}
      </div>
    </div>
  )
}

/** The circuit as a grid of wires and gates. Drawn from the operations, so it cannot show a gate that is not there. */
function Diagram({ circuit }: { circuit: Circuit }): React.JSX.Element {
  if (circuit.ops.length === 0) {
    return <p className="qs-about">Empty — every qubit in |0⟩. Add a gate to begin.</p>
  }
  const columns = circuit.ops.map((op, at) => ({ op, at }))
  return (
    <div className="qs-diagram" role="img" aria-label={`A circuit on ${circuit.qubits} qubits with ${circuit.ops.length} operations`}>
      {Array.from({ length: circuit.qubits }, (_one, qubit) => (
        <div key={qubit} className="qs-wire">
          <span className="qs-wire-name">q{qubit}</span>
          {columns.map(({ op, at }) => (
            <span key={at} className={`qs-cell${cellKind(op, qubit)}`}>
              {cellLabel(op, qubit)}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

function cellKind(op: Operation, qubit: number): string {
  switch (op.kind) {
    case 'gate':
      return op.target === qubit ? ' is-gate' : ''
    case 'controlled':
      if (op.target === qubit) return ' is-gate'
      return op.controls.includes(qubit) ? ' is-control' : ' is-through'
    case 'swap':
      return op.first === qubit || op.second === qubit ? ' is-gate' : ''
    case 'cphase':
      return op.first === qubit || op.second === qubit ? ' is-control' : ''
    case 'measure':
      return op.qubit === qubit ? ' is-measure' : ''
    case 'barrier':
      return ' is-barrier'
  }
}

function cellLabel(op: Operation, qubit: number): string {
  switch (op.kind) {
    case 'gate':
      return op.target === qubit ? (gateInfo(op.gate)?.symbol ?? op.gate.toUpperCase()) : ''
    case 'controlled':
      if (op.target === qubit) return gateInfo(op.gate)?.symbol ?? '⊕'
      if (op.controls.includes(qubit)) return '●'
      return ''
    case 'swap':
      return op.first === qubit || op.second === qubit ? '×' : ''
    case 'cphase':
      return op.first === qubit || op.second === qubit ? 'P' : ''
    case 'measure':
      return op.qubit === qubit ? 'M' : ''
    case 'barrier':
      return '┊'
  }
}

function AmplitudeTable({ state }: { state: StateVector }): React.JSX.Element {
  const kept = useMemo(() => rows(state).sort((a, b) => b.probability - a.probability).slice(0, 16), [state])
  const check = normCheck(state)
  return (
    <>
      <table className="qs-table">
        <thead>
          <tr>
            <th>Basis</th>
            <th>Amplitude</th>
            <th>Probability</th>
            <th>Phase</th>
          </tr>
        </thead>
        <tbody>
          {kept.map((one) => (
            <tr key={one.index}>
              <td>|{one.bits}⟩</td>
              <td>
                {one.amplitude.re.toFixed(4)}
                {one.amplitude.im === 0 ? '' : `${one.amplitude.im < 0 ? ' − ' : ' + '}${Math.abs(one.amplitude.im).toFixed(4)}i`}
              </td>
              <td>{(one.probability * 100).toFixed(2)}%</td>
              <td>{(one.phase / Math.PI).toFixed(3)}π</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!check.ok && <p className="qs-warn">{check.says}</p>}
      <p className="qs-about">
        Only the amplitudes above one in a million are listed — the rest are zero. Two states can have identical
        probabilities and different phases, and the phase column is where that difference lives.
      </p>
    </>
  )
}

// ---------------------------------------------------------------- the other benches

function StateBench({ state }: { state: StateVector | null }): React.JSX.Element {
  if (!state) return <p className="qs-about">Fix the circuit and the state will appear.</p>
  const rho = useMemo(() => densityOf(state), [state])
  const parts = useMemo(() => Array.from({ length: state.qubits }, (_one, at) => ({ at, rho: reduced(state, at) })), [state])
  return (
    <div className="qs-split">
      <div className="qs-pane">
        <h4>Amplitudes</h4>
        <p className="qs-ket">{ket(state)}</p>
        <AmplitudeTable state={state} />
      </div>
      <div className="qs-pane">
        <h4>The whole state</h4>
        <table className="qs-table">
          <tbody>
            <tr>
              <th>Qubits</th>
              <td>{state.qubits}</td>
            </tr>
            <tr>
              <th>Amplitudes</th>
              <td>{2 ** state.qubits}</td>
            </tr>
            <tr>
              <th>Purity</th>
              <td>{purity(rho).toFixed(4)}</td>
            </tr>
            <tr>
              <th>Coherence</th>
              <td>{coherence(rho).toFixed(4)}</td>
            </tr>
          </tbody>
        </table>
        <p className="qs-about">
          Purity is 1 for a pure state. Coherence is the largest off-diagonal term of the density matrix: zero
          for a classical mixture, non-zero for a superposition. Two states with the same probabilities and
          different coherence behave completely differently under a Hadamard.
        </p>

        <h4>Each qubit on its own</h4>
        <table className="qs-table">
          <thead>
            <tr>
              <th>Qubit</th>
              <th>P(0)</th>
              <th>P(1)</th>
              <th>Purity</th>
              <th>Entangled?</th>
            </tr>
          </thead>
          <tbody>
            {parts.map(({ at, rho: part }) => {
              const pop = populations(part)
              const pure = purity(part)
              return (
                <tr key={at}>
                  <td>q{at}</td>
                  <td>{(pop[0] * 100).toFixed(1)}%</td>
                  <td>{(pop[1] * 100).toFixed(1)}%</td>
                  <td>{pure.toFixed(3)}</td>
                  <td>{pure < 0.999 ? 'yes' : 'no'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="qs-about">
          A qubit with purity below 1 has no pure state of its own — it is entangled with the rest. Half of a Bell
          pair has purity exactly 0.5, which is the completely mixed state. A pure whole with mixed parts is what
          entanglement is.
        </p>
      </div>
    </div>
  )
}

function BlochBench({ state, qubits }: { state: StateVector | null; qubits: number }): React.JSX.Element {
  const [which, setWhich] = useState(0)
  if (!state) return <p className="qs-about">Fix the circuit and the sphere will appear.</p>
  const point = blochOf(state, Math.min(which, state.qubits - 1))
  const size = 220
  const middle = size / 2
  const radius = size / 2 - 16
  // x to the right, z up on screen.
  const px = middle + point.x * radius
  const py = middle - point.z * radius
  return (
    <div className="qs-split">
      <div className="qs-pane">
        <h4>Bloch sphere</h4>
        <label className="qs-inline">
          Qubit
          <input type="number" min={0} max={Math.max(0, qubits - 1)} value={which} onChange={(e) => setWhich(Number(e.target.value))} />
        </label>
        <svg viewBox={`0 0 ${size} ${size}`} className="qs-bloch" role="img" aria-label={`Qubit ${which} on the Bloch sphere, vector length ${point.radius.toFixed(3)}`}>
          <circle cx={middle} cy={middle} r={radius} className="qs-sphere" />
          <ellipse cx={middle} cy={middle} rx={radius} ry={radius / 3} className="qs-equator" />
          <line x1={middle} y1={middle - radius} x2={middle} y2={middle + radius} className="qs-axis" />
          <line x1={middle - radius} y1={middle} x2={middle + radius} y2={middle} className="qs-axis" />
          <text x={middle + 4} y={middle - radius + 2} className="qs-mark">|0⟩</text>
          <text x={middle + 4} y={middle + radius - 2} className="qs-mark">|1⟩</text>
          <text x={middle + radius - 18} y={middle - 6} className="qs-mark">|+⟩</text>
          <line x1={middle} y1={middle} x2={px} y2={py} className="qs-vector" />
          <circle cx={px} cy={py} r={4} className="qs-point" />
        </svg>
        <table className="qs-table">
          <tbody>
            <tr>
              <th>⟨X⟩</th>
              <td>{point.x.toFixed(4)}</td>
            </tr>
            <tr>
              <th>⟨Y⟩</th>
              <td>{point.y.toFixed(4)}</td>
            </tr>
            <tr>
              <th>⟨Z⟩</th>
              <td>{point.z.toFixed(4)}</td>
            </tr>
            <tr>
              <th>Length</th>
              <td>{point.radius.toFixed(4)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="qs-pane">
        <h4>What the picture means</h4>
        <p className="qs-about">
          The north pole is |0⟩ and the south is |1⟩. The equator holds the equal superpositions, which differ
          from one another only in phase: |+⟩ at ⟨X⟩ = 1, |−⟩ opposite it, and the two |±i⟩ states at ⟨Y⟩ = ±1.
        </p>
        <p className="qs-about">
          <strong>Length matters.</strong> A single qubit in a pure state sits on the surface, at length 1. A qubit
          entangled with another has a <em>short</em> arrow — length 0 for half of a Bell pair, right at the
          centre. That is not a drawing artefact: an entangled qubit genuinely has no state of its own, and a
          picture that put it on the surface would be a picture of something untrue.
        </p>
        <p className="qs-about">
          X, Y and Z are half turns about the three axes. Rx, Ry and Rz turn by any angle. A phase gate rotates
          about the vertical axis, which is why it leaves ⟨Z⟩ — and therefore the measurement probabilities —
          untouched.
        </p>
      </div>
    </div>
  )
}

function MeasureBench(props: {
  circuit: Circuit
  shots: number
  seed: number
  onShots(many: number): void
  onSeed(seed: number): void
  runnable: boolean
}): React.JSX.Element {
  const [got, setGot] = useState<ReturnType<typeof sample> | null>(null)
  const take = useCallback(() => {
    if (!props.runnable) return
    setGot(sample(props.circuit, props.shots, props.seed > 0 ? { seed: props.seed } : {}))
  }, [props.circuit, props.runnable, props.seed, props.shots])

  const keys = useMemo(() => {
    if (!got) return []
    const all = new Set([...Object.keys(got.counts), ...Object.keys(got.exact)])
    return [...all].sort()
  }, [got])

  return (
    <div className="qs-split">
      <div className="qs-pane">
        <h4>Shots</h4>
        <div className="qs-controls">
          <label>
            How many
            <input type="number" min={1} max={100000} value={props.shots} onChange={(e) => props.onShots(clamp(Number(e.target.value), 1, 100000))} />
          </label>
          <label>
            Seed
            <input type="number" min={0} max={1000000} value={props.seed} onChange={(e) => props.onSeed(clamp(Number(e.target.value), 0, 1000000))} />
          </label>
        </div>
        <div className="qs-actions">
          <button type="button" className="qs-go" onClick={take} disabled={!props.runnable}>
            Measure {props.shots} times
          </button>
        </div>
        <p className="qs-about">
          A shot is one run of the circuit followed by a measurement. With few shots the counts will not match the
          exact probabilities — that is sampling, not a fault, and raising the number is how you watch them
          converge. The seed makes a run repeatable; it is a pseudorandom generator in a simulator, which is not
          the same thing as the randomness of a real measurement.
        </p>
      </div>
      <div className="qs-pane">
        <h4>Counts against theory</h4>
        {!got ? (
          <p className="qs-about">Press measure.</p>
        ) : (
          <>
            <p className="qs-label">
              {got.shots} shots · <strong>sampled</strong>
              {got.seed === null ? ' · unseeded' : ` · seed ${got.seed}`}
            </p>
            <table className="qs-table">
              <thead>
                <tr>
                  <th>Outcome</th>
                  <th>Counted</th>
                  <th>Observed</th>
                  <th>Exact</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => {
                  const count = got.counts[key] ?? 0
                  const seen = count / got.shots
                  const want = got.exact[key] ?? 0
                  return (
                    <tr key={key}>
                      <td>|{key}⟩</td>
                      <td>{count}</td>
                      <td>{(seen * 100).toFixed(2)}%</td>
                      <td>{(want * 100).toFixed(2)}%</td>
                      <td>{((seen - want) * 100).toFixed(2)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="qs-bars">
              {keys.map((key) => (
                <div key={key} className="qs-bar">
                  <span className="qs-bar-name">|{key}⟩</span>
                  <span className="qs-bar-track">
                    <span className="qs-bar-fill" style={{ width: `${((got.counts[key] ?? 0) / got.shots) * 100}%` }} />
                    <span className="qs-bar-exact" style={{ left: `${(got.exact[key] ?? 0) * 100}%` }} />
                  </span>
                </div>
              ))}
            </div>
            <p className="qs-about">The thin line on each bar is where the exact probability sits.</p>
          </>
        )}
      </div>
    </div>
  )
}

function AlgorithmBench({ onLoad }: { onLoad(circuit: Circuit, says: string): void }): React.JSX.Element {
  const [which, setWhich] = useState('grover')
  const [marked, setMarked] = useState('101')
  const [iterations, setIterations] = useState(0)
  const [secret, setSecret] = useState('1011')
  const [number, setNumber] = useState(15)
  const [phase, setPhase] = useState(0.25)
  const [counting, setCounting] = useState(4)
  const [result, setResult] = useState<{ says: string; rows: [string, string][]; curve?: { iteration: number; success: number }[] } | null>(null)

  const go = useCallback(() => {
    try {
      switch (which) {
        case 'deutsch': {
          const got = deutsch('identity')
          onLoad(got.circuit, got.says)
          setResult({ says: got.says, rows: [['Measured', String(got.measured)], ['Verdict', got.verdict], ['Queries used', String(got.queries)], ['Correct', got.correct ? 'yes' : 'no']] })
          break
        }
        case 'deutsch-jozsa': {
          const got = deutschJozsa(3, 'balanced')
          onLoad(got.circuit, got.says)
          setResult({
            says: got.says,
            rows: [['Outcome', got.outcome], ['Verdict', got.verdict], ['Quantum queries', String(got.queries)], ['Classical worst case', String(got.classicalWorstCase)]]
          })
          break
        }
        case 'bernstein-vazirani': {
          const got = bernsteinVazirani(secret.replace(/[^01]/g, '') || '1011')
          onLoad(got.circuit, got.says)
          setResult({ says: got.says, rows: [['Hidden string', got.secret], ['Recovered', got.found], ['Quantum queries', String(got.queries)], ['Classical queries', String(got.classicalQueries)]] })
          break
        }
        case 'grover': {
          const bits = marked.replace(/[^01]/g, '') || '101'
          const index = Number.parseInt(bits, 2)
          const got = grover(bits.length, [index], iterations > 0 ? iterations : undefined)
          onLoad(got.circuit, got.says)
          setResult({
            says: got.says,
            rows: [
              ['Search space', String(2 ** bits.length)],
              ['Marked', `|${bits}⟩`],
              ['Iterations run', String(got.iterations)],
              ['Best iteration count', String(got.best)],
              ['Success', `${(got.success * 100).toFixed(1)}%`],
              ['Classical queries on average', String(got.classicalQueries)]
            ],
            curve: got.curve.map((one) => ({ iteration: one.iteration, success: one.success }))
          })
          break
        }
        case 'phase-estimation': {
          const got = phaseEstimate(phase, counting)
          onLoad(got.circuit, got.says)
          setResult({
            says: got.says,
            rows: [
              ['True phase', got.actual.toFixed(5)],
              ['Estimate', got.estimate.toFixed(5)],
              ['Measured', `${got.measured}/${2 ** got.countingQubits}`],
              ['Resolution', got.resolution.toFixed(5)],
              ['Error', got.error.toFixed(5)]
            ]
          })
          break
        }
        case 'shor': {
          const got = shor(number)
          setResult({
            says: got.says,
            rows: [
              ['Number', String(got.n)],
              ['Factors', got.factors ? `${got.factors[0]} × ${got.factors[1]}` : 'none found this run'],
              ['Attempts', String(got.attempts.length)],
              ...got.attempts.map((one, at) => [`Attempt ${at + 1} (a = ${one.a})`, one.step] as [string, string])
            ]
          })
          break
        }
        case 'teleport': {
          const got = teleport(1.0, 0.6)
          onLoad(got.circuit, got.says)
          setResult({ says: got.says, rows: [['Fidelity', got.fidelity.toFixed(5)], ['Classical bits sent', got.classicalBits.join('')]] })
          break
        }
        case 'superdense': {
          const got = superdense('10')
          onLoad(got.circuit, got.says)
          setResult({ says: got.says, rows: [['Sent', got.sent], ['Received', got.received], ['Correct', got.correct ? 'yes' : 'no']] })
          break
        }
        default:
          break
      }
    } catch (error) {
      setResult({ says: error instanceof Error ? error.message : String(error), rows: [] })
    }
  }, [counting, iterations, marked, number, onLoad, phase, secret, which])

  return (
    <div className="qs-split">
      <div className="qs-pane">
        <h4>Algorithm</h4>
        <div className="qs-controls">
          <label className="qs-wide">
            Which
            <select value={which} onChange={(e) => setWhich(e.target.value)}>
              <option value="deutsch">Deutsch</option>
              <option value="deutsch-jozsa">Deutsch-Jozsa</option>
              <option value="bernstein-vazirani">Bernstein-Vazirani</option>
              <option value="grover">Grover search</option>
              <option value="phase-estimation">Phase estimation</option>
              <option value="shor">Shor factoring</option>
              <option value="teleport">Teleportation</option>
              <option value="superdense">Superdense coding</option>
            </select>
          </label>
          {which === 'grover' && (
            <>
              <label>
                Marked state
                <input value={marked} onChange={(e) => setMarked(e.target.value)} />
              </label>
              <label>
                Iterations (0 = best)
                <input type="number" min={0} max={40} value={iterations} onChange={(e) => setIterations(Number(e.target.value))} />
              </label>
            </>
          )}
          {which === 'bernstein-vazirani' && (
            <label>
              Hidden string
              <input value={secret} onChange={(e) => setSecret(e.target.value)} />
            </label>
          )}
          {which === 'shor' && (
            <label>
              Number
              <input type="number" min={3} max={143} value={number} onChange={(e) => setNumber(Number(e.target.value))} />
            </label>
          )}
          {which === 'phase-estimation' && (
            <>
              <label>
                Phase
                <input type="number" min={0} max={0.999} step={0.001} value={phase} onChange={(e) => setPhase(Number(e.target.value))} />
              </label>
              <label>
                Counting qubits
                <input type="number" min={1} max={10} value={counting} onChange={(e) => setCounting(Number(e.target.value))} />
              </label>
            </>
          )}
        </div>
        <div className="qs-actions">
          <button type="button" className="qs-go" onClick={go}>
            Run it
          </button>
        </div>
        <p className="qs-about">
          Each of these is built from gates and run through the simulator. The answers below were computed, not
          looked up — if the engine were wrong, these would be wrong with it.
        </p>
      </div>
      <div className="qs-pane">
        <h4>Result</h4>
        {!result ? (
          <p className="qs-about">Run one.</p>
        ) : (
          <>
            <p className="qs-label">{result.says}</p>
            <table className="qs-table">
              <tbody>
                {result.rows.map(([name, value]) => (
                  <tr key={name}>
                    <th>{name}</th>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.curve && (
              <>
                <h4>Success against iterations</h4>
                <div className="qs-bars">
                  {result.curve.map((one) => (
                    <div key={one.iteration} className="qs-bar">
                      <span className="qs-bar-name">{one.iteration}</span>
                      <span className="qs-bar-track">
                        <span className="qs-bar-fill" style={{ width: `${one.success * 100}%` }} />
                      </span>
                      <span className="qs-bar-value">{(one.success * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
                <p className="qs-about">
                  The curve rises to a peak and then falls. More iterations are not better — past the peak the
                  amplitude rotates away from the marked state again, which is why Grover is not "repeat until
                  certain".
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function NoiseBench(props: {
  circuit: Circuit
  channel: ChannelKind | ''
  rate: number
  shots: number
  seed: number
  onChannel(kind: ChannelKind | ''): void
  onRate(rate: number): void
  runnable: boolean
}): React.JSX.Element {
  const [got, setGot] = useState<ReturnType<typeof runNoisy> | null>(null)
  const go = useCallback(() => {
    if (!props.runnable || props.channel === '') return
    setGot(runNoisy(props.circuit, { oneQubit: { kind: props.channel, p: props.rate }, twoQubit: { kind: props.channel, p: props.rate * 10 } }, Math.min(props.shots, 5000), props.seed > 0 ? { seed: props.seed } : {}))
  }, [props.channel, props.circuit, props.rate, props.runnable, props.seed, props.shots])

  return (
    <div className="qs-split">
      <div className="qs-pane">
        <h4>Noise</h4>
        <div className="qs-controls">
          <label className="qs-wide">
            Channel
            <select value={props.channel} onChange={(e) => props.onChannel(e.target.value as ChannelKind | '')}>
              <option value="">None — ideal</option>
              {Object.entries(NOISE_NAMES).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="qs-wide">
            Error rate per gate: {(props.rate * 100).toFixed(2)}%
            <input type="range" min={0} max={0.3} step={0.005} value={props.rate} onChange={(e) => props.onRate(Number(e.target.value))} />
          </label>
        </div>
        {props.channel !== '' && <p className="qs-about">{NOISE_DOES[props.channel]}</p>}
        <div className="qs-actions">
          <button type="button" className="qs-go" onClick={go} disabled={!props.runnable || props.channel === ''}>
            Run with noise
          </button>
        </div>
        <p className="qs-about">
          Two-qubit gates are given ten times the error rate, which is roughly the ratio on real hardware. Noise
          is simulated by sampling trajectories, so what comes back is an average over runs with sampling error —
          never an exact figure.
        </p>
      </div>
      <div className="qs-pane">
        <h4>Noisy against ideal</h4>
        {!got ? (
          <p className="qs-about">Pick a channel and run.</p>
        ) : (
          <>
            <p className="qs-label">
              {got.shots} shots · <strong>noisy average</strong> · overlap with the ideal distribution{' '}
              {(got.fidelity * 100).toFixed(1)}%
            </p>
            <table className="qs-table">
              <thead>
                <tr>
                  <th>Outcome</th>
                  <th>Noisy</th>
                  <th>Ideal</th>
                </tr>
              </thead>
              <tbody>
                {[...new Set([...Object.keys(got.counts), ...Object.keys(got.ideal)])].sort().map((key) => (
                  <tr key={key}>
                    <td>|{key}⟩</td>
                    <td>{(((got.counts[key] ?? 0) / got.shots) * 100).toFixed(2)}%</td>
                    <td>{((got.ideal[key] ?? 0) * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="qs-about">{got.says}</p>
          </>
        )}
      </div>
    </div>
  )
}

function CorrectionBench(): React.JSX.Element {
  const [code, setCode] = useState<CodeKind>('bit-flip')
  const [error, setError] = useState<ErrorKind>('x')
  const [qubit, setQubit] = useState(0)
  const [got, setGot] = useState<ReturnType<typeof correctOnce> | null>(null)
  const [survey, setSurvey] = useState<ReturnType<typeof surveyCode> | null>(null)

  const info = CODES.find((one) => one.id === code)

  return (
    <div className="qs-split">
      <div className="qs-pane">
        <h4>Code</h4>
        <div className="qs-controls">
          <label className="qs-wide">
            Which
            <select value={code} onChange={(e) => setCode(e.target.value as CodeKind)}>
              {CODES.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Error
            <select value={error} onChange={(e) => setError(e.target.value as ErrorKind)}>
              <option value="none">None</option>
              <option value="x">X — bit flip</option>
              <option value="z">Z — phase flip</option>
              <option value="y">Y — both</option>
            </select>
          </label>
          <label>
            On qubit
            <input type="number" min={0} max={2} value={qubit} onChange={(e) => setQubit(clamp(Number(e.target.value), 0, 2))} />
          </label>
        </div>
        {info && (
          <>
            <p className="qs-about">
              <strong>Protects:</strong> {info.protects}
            </p>
            <p className="qs-about">
              <strong>Misses:</strong> {info.misses}
            </p>
          </>
        )}
        <div className="qs-actions">
          <button type="button" className="qs-go" onClick={() => setGot(correctOnce(code, { kind: error, qubit }))}>
            Encode, break, correct
          </button>
          <button type="button" onClick={() => setSurvey(surveyCode(code))}>
            Try every single error
          </button>
        </div>
      </div>
      <div className="qs-pane">
        <h4>What happened</h4>
        {!got ? (
          <p className="qs-about">Run it.</p>
        ) : (
          <table className="qs-table">
            <tbody>
              <tr>
                <th>Syndrome</th>
                <td>{got.syndrome.join('')}</td>
              </tr>
              <tr>
                <th>Blamed qubit</th>
                <td>{got.blamed === null ? 'none — the checks saw nothing' : `q${got.blamed}`}</td>
              </tr>
              <tr>
                <th>Logical state recovered</th>
                <td>{got.recovered ? 'yes' : 'no'}</td>
              </tr>
              <tr>
                <th>Fidelity</th>
                <td>{got.fidelity.toFixed(4)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {got && <p className="qs-about">{got.says}</p>}

        {survey && (
          <>
            <h4>Every single-qubit error</h4>
            <table className="qs-table">
              <thead>
                <tr>
                  <th>Error</th>
                  <th>Qubit</th>
                  <th>Syndrome</th>
                  <th>Survived</th>
                </tr>
              </thead>
              <tbody>
                {survey.results.map((one) => (
                  <tr key={`${one.kind}${one.qubit}`}>
                    <td>{one.kind.toUpperCase()}</td>
                    <td>q{one.qubit}</td>
                    <td>{one.syndrome}</td>
                    <td>{one.recovered ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="qs-about">{survey.says}</p>
          </>
        )}
      </div>
    </div>
  )
}

const clamp = (value: number, low: number, high: number): number =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : low
