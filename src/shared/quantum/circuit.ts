import { matrixFor, MATRIX_X, MATRIX_Z, applyControlled, apply1, applySwap, applyControlledPhase, gateInfo } from './gates.ts'
import { bitAt, capacityFor, copy, dimension, probabilities, zeroState, type StateVector } from './state.ts'

/**
 * A circuit: a list of operations, and the machinery to run one.
 *
 * ## A circuit is data
 *
 * It can be stored, exported, imported, edited, compared and analysed without being executed, which is what
 * lets the course save experiments and lets a lesson hand the learner a deliberately broken circuit to repair.
 * Importantly, an imported circuit is **data** — it names gates from a fixed table and can do nothing that is
 * not in that table.
 *
 * ## Running it produces a trace, not just an answer
 *
 * `run` returns the state after every step, so the timeline in the laboratory can show what the state was at
 * step 4 without re-running the circuit from the beginning. That is also what makes the debugging exercises
 * possible: you can look at where it went wrong rather than only that it did.
 *
 * ## Measurement is sampling, and the two modes are kept apart
 *
 * `run` evolves the state exactly — the analytical answer. `sample` draws shots from it, which is what real
 * hardware gives you. The difference between them is a lesson in its own right, so the two are never mixed in
 * one result.
 */

export type Operation =
  | { kind: 'gate'; gate: string; target: number; theta?: number }
  | { kind: 'controlled'; gate: string; controls: number[]; target: number; theta?: number }
  | { kind: 'swap'; first: number; second: number }
  | { kind: 'cphase'; first: number; second: number; theta: number }
  /** A measurement written into the circuit, recording its outcome in a classical bit. */
  | { kind: 'measure'; qubit: number; into: number }
  /** A barrier: no effect on the state, a marker in the drawing and a boundary for optimisation. */
  | { kind: 'barrier'; note?: string }

export interface Circuit {
  qubits: number
  /** How many classical bits measurements may write into. */
  bits: number
  ops: Operation[]
  name?: string
}

export const emptyCircuit = (qubits: number, bits = qubits, name?: string): Circuit => ({
  qubits,
  bits,
  ops: [],
  ...(name === undefined ? {} : { name })
})

// ---------------------------------------------------------------- building, fluently

export const gate = (circuit: Circuit, gateId: string, target: number, theta?: number): Circuit => ({
  ...circuit,
  ops: [...circuit.ops, { kind: 'gate', gate: gateId, target, ...(theta === undefined ? {} : { theta }) }]
})

export const controlled = (circuit: Circuit, gateId: string, controls: number[], target: number, theta?: number): Circuit => ({
  ...circuit,
  ops: [...circuit.ops, { kind: 'controlled', gate: gateId, controls, target, ...(theta === undefined ? {} : { theta }) }]
})

export const cnot = (circuit: Circuit, control: number, target: number): Circuit => controlled(circuit, 'x', [control], target)
export const swap = (circuit: Circuit, first: number, second: number): Circuit => ({
  ...circuit,
  ops: [...circuit.ops, { kind: 'swap', first, second }]
})
export const cphase = (circuit: Circuit, theta: number, first: number, second: number): Circuit => ({
  ...circuit,
  ops: [...circuit.ops, { kind: 'cphase', first, second, theta }]
})
export const measure = (circuit: Circuit, qubit: number, into = qubit): Circuit => ({
  ...circuit,
  ops: [...circuit.ops, { kind: 'measure', qubit, into }]
})
export const barrier = (circuit: Circuit, note?: string): Circuit => ({
  ...circuit,
  ops: [...circuit.ops, { kind: 'barrier', ...(note === undefined ? {} : { note }) }]
})

// ---------------------------------------------------------------- validation

export interface CircuitFault {
  at: number
  says: string
}

/**
 * Everything wrong with a circuit, with the step number of each fault.
 *
 * Reported rather than thrown, and all of them rather than the first, so the laboratory can mark every bad step
 * at once. A message says what is wrong **and why it cannot work** — "qubit 5 does not exist in a 3-qubit
 * register" rather than "invalid qubit".
 */
export function faultsIn(circuit: Circuit): CircuitFault[] {
  const out: CircuitFault[] = []
  const can = capacityFor(circuit.qubits)
  if (!can.ok) out.push({ at: -1, says: can.says })

  const inRange = (qubit: number, at: number, role: string): boolean => {
    if (!Number.isInteger(qubit) || qubit < 0 || qubit >= circuit.qubits) {
      out.push({ at, says: `${role} is qubit ${qubit}, and this register has qubits 0 to ${circuit.qubits - 1}.` })
      return false
    }
    return true
  }

  for (const [at, op] of circuit.ops.entries()) {
    switch (op.kind) {
      case 'gate': {
        const info = gateInfo(op.gate)
        if (!info) out.push({ at, says: `"${op.gate}" is not a gate this simulator knows.` })
        else if (info.qubits !== 1) out.push({ at, says: `${info.name} acts on ${info.qubits} qubits, so it needs controls as well as a target.` })
        else if (info.parameterised && typeof op.theta !== 'number') out.push({ at, says: `${info.name} needs an angle, and none was given.` })
        inRange(op.target, at, 'The target')
        break
      }
      case 'controlled': {
        const info = gateInfo(op.gate)
        if (!info) out.push({ at, says: `"${op.gate}" is not a gate this simulator knows.` })
        if (op.controls.length === 0) out.push({ at, says: 'A controlled gate with no controls is just a gate — give it a control or use a plain gate.' })
        if (new Set(op.controls).size !== op.controls.length) out.push({ at, says: 'The same qubit appears twice as a control.' })
        if (op.controls.includes(op.target)) out.push({ at, says: 'The control and the target are the same qubit, which is not a valid operation.' })
        for (const one of op.controls) inRange(one, at, 'A control')
        inRange(op.target, at, 'The target')
        break
      }
      case 'swap':
        if (op.first === op.second) out.push({ at, says: 'Swapping a qubit with itself does nothing; remove the step or change one of the qubits.' })
        inRange(op.first, at, 'The first qubit')
        inRange(op.second, at, 'The second qubit')
        break
      case 'cphase':
        if (op.first === op.second) out.push({ at, says: 'A controlled phase needs two different qubits.' })
        if (typeof op.theta !== 'number' || !Number.isFinite(op.theta)) out.push({ at, says: 'The angle is missing or not a number.' })
        inRange(op.first, at, 'The first qubit')
        inRange(op.second, at, 'The second qubit')
        break
      case 'measure':
        inRange(op.qubit, at, 'The measured qubit')
        if (!Number.isInteger(op.into) || op.into < 0 || op.into >= circuit.bits) {
          out.push({ at, says: `The result is written to classical bit ${op.into}, and this circuit has bits 0 to ${circuit.bits - 1}.` })
        }
        break
      case 'barrier':
        break
    }
  }
  return out
}

export const isRunnable = (circuit: Circuit): boolean => faultsIn(circuit).length === 0

// ---------------------------------------------------------------- running

export interface Step {
  /** The index of the operation that produced this state. −1 for the starting state. */
  at: number
  /** What happened, in words, for the timeline. */
  says: string
  state: StateVector
  /** Set when this step was a measurement: which qubit, what came out, and with what probability. */
  measured?: { qubit: number; into: number; outcome: 0 | 1; chance: number }
}

export interface RunResult {
  /** The state after every step, including the starting state at index 0. */
  steps: Step[]
  /** The final state. */
  state: StateVector
  /** The classical bits, after any measurements in the circuit. */
  bits: (0 | 1 | null)[]
  /** Every probability of the final state, in basis-state order. */
  probabilities: Float64Array
  /** How this result was obtained. Shown on screen so an exact result is never confused with a sampled one. */
  mode: 'exact'
}

/**
 * A source of random numbers that can be seeded.
 *
 * Seeded so an experiment can be repeated exactly. The course is explicit that this is pseudorandomness in a
 * simulator and not the physical randomness of a real measurement — a distinction that matters both for honesty
 * and for understanding what quantum randomness would be.
 */
export interface Chance {
  next(): number
}

/** A small, fast, seeded generator. Deterministic for a given seed, which is the entire point. */
export function seeded(seed: number): Chance {
  let state = (seed | 0) || 1
  return {
    next(): number {
      // xorshift32: short, fast, and good enough for sampling measurement outcomes.
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      return ((state >>> 0) % 1_000_000) / 1_000_000
    }
  }
}

/** Unseeded, for when reproducibility is not wanted. */
export const anyChance: Chance = { next: () => Math.random() }

/**
 * Runs a circuit exactly, keeping the state after every step.
 *
 * `keepEvery` throws away intermediate states for long circuits — a 500-step circuit on 16 qubits would hold
 * 500 MB of history otherwise. The final state is always kept.
 */
export function run(circuit: Circuit, options: { chance?: Chance; keepEvery?: number } = {}): RunResult {
  const faults = faultsIn(circuit)
  if (faults.length > 0) {
    throw new Error(`This circuit cannot run: ${faults[0].says}${faults.length > 1 ? ` (and ${faults.length - 1} more)` : ''}`)
  }

  const chance = options.chance ?? anyChance
  const keepEvery = Math.max(1, options.keepEvery ?? 1)
  const state = zeroState(circuit.qubits)
  const bits: (0 | 1 | null)[] = Array.from({ length: circuit.bits }, () => null)
  const steps: Step[] = [{ at: -1, says: 'Starting state', state: copy(state) }]

  for (const [at, op] of circuit.ops.entries()) {
    let measured: Step['measured']
    switch (op.kind) {
      case 'gate': {
        const matrix = matrixFor(op.gate, op.theta ?? 0)
        if (matrix) apply1(state, matrix, op.target)
        break
      }
      case 'controlled': {
        if (op.gate === 'z') applyControlled(state, MATRIX_Z, op.controls, op.target)
        else if (op.gate === 'x') applyControlled(state, MATRIX_X, op.controls, op.target)
        else {
          const matrix = matrixFor(op.gate, op.theta ?? 0)
          if (matrix) applyControlled(state, matrix, op.controls, op.target)
        }
        break
      }
      case 'swap':
        applySwap(state, op.first, op.second)
        break
      case 'cphase':
        applyControlledPhase(state, op.theta, op.first, op.second)
        break
      case 'measure': {
        const got = collapse(state, op.qubit, chance)
        bits[op.into] = got.outcome
        measured = { qubit: op.qubit, into: op.into, outcome: got.outcome, chance: got.chance }
        break
      }
      case 'barrier':
        break
    }
    const last = at === circuit.ops.length - 1
    if (last || at % keepEvery === 0) {
      steps.push({ at, says: describe(op), state: copy(state), ...(measured ? { measured } : {}) })
    }
  }

  return { steps, state, bits, probabilities: probabilities(state), mode: 'exact' }
}

/**
 * Measures one qubit and collapses the state onto the outcome.
 *
 * The outcome is drawn with the correct probability, then every amplitude inconsistent with it is set to zero
 * and what remains is rescaled — which is what a projective measurement is. This is the one place
 * renormalisation is correct, because the post-measurement state genuinely is the conditioned one.
 */
export function collapse(state: StateVector, qubit: number, chance: Chance = anyChance): { outcome: 0 | 1; chance: number } {
  const size = dimension(state.qubits)
  let pOne = 0
  for (let at = 0; at < size; at += 1) {
    if (bitAt(at, qubit) === 1) {
      const re = state.data[at * 2]
      const im = state.data[at * 2 + 1]
      pOne += re * re + im * im
    }
  }
  const draw = chance.next()
  const outcome: 0 | 1 = draw < pOne ? 1 : 0
  const keep = outcome === 1 ? pOne : 1 - pOne
  const k = keep > 0 ? 1 / Math.sqrt(keep) : 0
  for (let at = 0; at < size; at += 1) {
    if (bitAt(at, qubit) === outcome) {
      state.data[at * 2] *= k
      state.data[at * 2 + 1] *= k
    } else {
      state.data[at * 2] = 0
      state.data[at * 2 + 1] = 0
    }
  }
  return { outcome, chance: outcome === 1 ? pOne : 1 - pOne }
}

function describe(op: Operation): string {
  switch (op.kind) {
    case 'gate': {
      const info = gateInfo(op.gate)
      const angle = op.theta === undefined ? '' : `(${op.theta.toFixed(3)})`
      return `${info?.name ?? op.gate}${angle} on qubit ${op.target}`
    }
    case 'controlled': {
      const info = gateInfo(op.gate)
      return `${info?.name ?? op.gate} on qubit ${op.target}, controlled by ${op.controls.join(' and ')}`
    }
    case 'swap':
      return `Swap qubits ${op.first} and ${op.second}`
    case 'cphase':
      return `Controlled phase ${op.theta.toFixed(3)} between qubits ${op.first} and ${op.second}`
    case 'measure':
      return `Measure qubit ${op.qubit}`
    case 'barrier':
      return op.note ?? 'Barrier'
  }
}

// ---------------------------------------------------------------- sampling

export interface SampleResult {
  /** How many times each outcome came up, keyed by bit string. */
  counts: Record<string, number>
  shots: number
  /** The exact probabilities, for comparing the sample against the theory. */
  exact: Record<string, number>
  /** Deliberately distinct from 'exact', so a screen can never present one as the other. */
  mode: 'sampled'
  /** The seed, when one was used, so the run can be repeated. */
  seed: number | null
}

/**
 * Draws shots from the final state.
 *
 * This is what hardware gives you: counts, not amplitudes. The exact probabilities are returned alongside, so
 * the laboratory can show the sample converging on them as the shot count rises — which is the only honest way
 * to teach what a shot is.
 */
export function sample(circuit: Circuit, shots: number, options: { seed?: number; qubits?: readonly number[] } = {}): SampleResult {
  const seed = options.seed ?? null
  const chance = seed === null ? anyChance : seeded(seed)
  const result = run(circuit, { chance, keepEvery: Number.MAX_SAFE_INTEGER })
  const probs = result.probabilities
  const which = options.qubits ? [...options.qubits] : null

  const label = (index: number): string => {
    if (!which) return index.toString(2).padStart(circuit.qubits, '0')
    return which.map((q) => bitAt(index, q)).reverse().join('')
  }

  const exact: Record<string, number> = {}
  for (let at = 0; at < probs.length; at += 1) {
    if (probs[at] <= 0) continue
    const key = label(at)
    exact[key] = (exact[key] ?? 0) + probs[at]
  }

  const counts: Record<string, number> = {}
  const many = Math.max(1, Math.min(1_000_000, Math.floor(shots)))
  // The cumulative distribution, built once.
  const cumulative = new Float64Array(probs.length)
  let running = 0
  for (let at = 0; at < probs.length; at += 1) {
    running += probs[at]
    cumulative[at] = running
  }
  for (let shot = 0; shot < many; shot += 1) {
    const draw = chance.next() * running
    let at = 0
    while (at < cumulative.length - 1 && cumulative[at] < draw) at += 1
    const key = label(at)
    counts[key] = (counts[key] ?? 0) + 1
  }

  return { counts, shots: many, exact, mode: 'sampled', seed }
}

// ---------------------------------------------------------------- what a circuit costs

export interface Resources {
  qubits: number
  /** How many operations. */
  gates: number
  /** The longest chain of operations on any one qubit — the circuit depth. */
  depth: number
  oneQubit: number
  twoQubit: number
  multiQubit: number
  measurements: number
  parameterised: number
  /** Bytes the state vector needs. */
  stateBytes: number
  /** A readable summary. */
  says: string
}

/**
 * What a circuit costs.
 *
 * Depth is counted properly — the longest chain of operations sharing a qubit, not the number of gates — because
 * depth is what noise accumulates with, and a 40-gate circuit of depth 8 behaves very differently from a 40-gate
 * circuit of depth 40.
 */
export function resources(circuit: Circuit): Resources {
  const endOf = new Array<number>(circuit.qubits).fill(0)
  let gates = 0
  let oneQubit = 0
  let twoQubit = 0
  let multiQubit = 0
  let measurements = 0
  let parameterised = 0

  for (const op of circuit.ops) {
    let touched: number[] = []
    switch (op.kind) {
      case 'gate':
        touched = [op.target]
        oneQubit += 1
        if (typeof op.theta === 'number') parameterised += 1
        break
      case 'controlled':
        touched = [...op.controls, op.target]
        if (touched.length === 2) twoQubit += 1
        else multiQubit += 1
        if (typeof op.theta === 'number') parameterised += 1
        break
      case 'swap':
        touched = [op.first, op.second]
        twoQubit += 1
        break
      case 'cphase':
        touched = [op.first, op.second]
        twoQubit += 1
        parameterised += 1
        break
      case 'measure':
        touched = [op.qubit]
        measurements += 1
        break
      case 'barrier':
        // A barrier aligns every qubit, which is what it is for.
        touched = Array.from({ length: circuit.qubits }, (_one, at) => at)
        break
    }
    if (op.kind !== 'barrier') gates += 1
    const start = Math.max(0, ...touched.map((one) => endOf[one] ?? 0))
    for (const one of touched) endOf[one] = start + 1
  }

  const depth = Math.max(0, ...endOf)
  const stateBytes = dimension(circuit.qubits) * 16
  return {
    qubits: circuit.qubits,
    gates,
    depth,
    oneQubit,
    twoQubit,
    multiQubit,
    measurements,
    parameterised,
    stateBytes,
    says: `${circuit.qubits} qubits, ${gates} operations, depth ${depth} — ${twoQubit + multiQubit} of them act on more than one qubit, which is where most of the error on real hardware comes from.`
  }
}

/** The inverse of a circuit: every operation reversed, in reverse order. Measurements cannot be undone. */
export function inverse(circuit: Circuit): { circuit: Circuit; refused: string | null } {
  if (circuit.ops.some((one) => one.kind === 'measure')) {
    return {
      circuit,
      refused: 'A circuit containing a measurement has no inverse — measurement is not reversible, which is the whole of why it is different from a gate.'
    }
  }
  const ops: Operation[] = []
  for (const op of [...circuit.ops].reverse()) {
    switch (op.kind) {
      case 'gate': {
        const flipped = inverseGate(op.gate, op.theta)
        if (!flipped) return { circuit, refused: `${op.gate} has no inverse in this simulator.` }
        ops.push({ kind: 'gate', gate: flipped.gate, target: op.target, ...(flipped.theta === undefined ? {} : { theta: flipped.theta }) })
        break
      }
      case 'controlled': {
        const flipped = inverseGate(op.gate, op.theta)
        if (!flipped) return { circuit, refused: `${op.gate} has no inverse in this simulator.` }
        ops.push({ kind: 'controlled', gate: flipped.gate, controls: [...op.controls], target: op.target, ...(flipped.theta === undefined ? {} : { theta: flipped.theta }) })
        break
      }
      case 'swap':
        ops.push({ ...op })
        break
      case 'cphase':
        ops.push({ ...op, theta: -op.theta })
        break
      case 'barrier':
        ops.push({ ...op })
        break
      case 'measure':
        break
    }
  }
  return { circuit: { ...circuit, ops, name: circuit.name ? `${circuit.name} inverted` : undefined }, refused: null }
}

function inverseGate(id: string, theta?: number): { gate: string; theta?: number } | null {
  switch (id) {
    case 'i':
    case 'x':
    case 'y':
    case 'z':
    case 'h':
      // Each is its own inverse: applying it twice is the identity.
      return { gate: id }
    case 's':
      return { gate: 'sdg' }
    case 'sdg':
      return { gate: 's' }
    case 't':
      return { gate: 'tdg' }
    case 'tdg':
      return { gate: 't' }
    case 'sx':
      // √X inverted is a rotation of −π/2 about x.
      return { gate: 'rx', theta: -Math.PI / 2 }
    case 'rx':
    case 'ry':
    case 'rz':
    case 'p':
      return { gate: id, theta: -(theta ?? 0) }
    default:
      return null
  }
}
