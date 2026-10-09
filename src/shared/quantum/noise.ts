import { anyChance, collapse, faultsIn, type Chance, type Circuit, seeded } from './circuit.ts'
import { MATRIX_X, MATRIX_Y, MATRIX_Z, apply1, applyControlled, applyControlledPhase, applySwap, matrixFor } from './gates.ts'
import { dimension, probabilities, zeroState, type StateVector } from './state.ts'

/**
 * Noise, done by sampling rather than by pretending.
 *
 * ## Why trajectories and not density matrices
 *
 * A full density-matrix simulation of n qubits needs 4ⁿ complex numbers, which is 16 MB at eight qubits and
 * 4 GB at twelve. A **trajectory** simulation keeps the state vector and applies a random error with the right
 * probability, then averages over many runs. The averages converge on the density-matrix answer, the memory cost
 * is the same as a noiseless run, and the learner sees something true about noise: it is statistical, and a
 * single run tells you very little.
 *
 * The honest consequence is stated on every result: a noisy result is an average over shots, with sampling
 * error, and `shots` says how many. It is never presented as an exact number.
 *
 * ## What each channel is
 *
 * Every model here is a real channel with a stated meaning, not a vague "add some randomness". Bit flip, phase
 * flip, depolarising, amplitude damping, phase damping and readout error are separate, because they are
 * physically different and they fail differently — a phase flip is invisible in the computational basis and
 * obvious after a Hadamard, which is the lesson the course builds on.
 */

export type ChannelKind = 'bit-flip' | 'phase-flip' | 'depolarising' | 'amplitude-damping' | 'phase-damping'

export interface NoiseModel {
  /** Applied after every one-qubit gate. */
  oneQubit?: { kind: ChannelKind; p: number }
  /** Applied after every two-qubit gate, usually an order of magnitude worse on real hardware. */
  twoQubit?: { kind: ChannelKind; p: number }
  /** Applied to every qubit at the end, as if it had been idling. */
  idle?: { kind: ChannelKind; p: number }
  /** The chance a measurement reports the wrong value, independent of the state. */
  readout?: number
  /** Relaxation and dephasing times, with a gate duration, as an alternative way to express idling noise. */
  times?: { t1: number; t2: number; gateTime: number }
}

export const NOISE_NAMES: Readonly<Record<ChannelKind, string>> = Object.freeze({
  'bit-flip': 'Bit flip',
  'phase-flip': 'Phase flip',
  depolarising: 'Depolarising',
  'amplitude-damping': 'Amplitude damping',
  'phase-damping': 'Phase damping'
})

export const NOISE_DOES: Readonly<Record<ChannelKind, string>> = Object.freeze({
  'bit-flip': 'With probability p, an X is applied: |0⟩ and |1⟩ swap. Visible immediately in a computational-basis measurement.',
  'phase-flip': 'With probability p, a Z is applied. Nothing changes in a computational-basis measurement — and everything changes after a Hadamard.',
  depolarising: 'With probability p, one of X, Y or Z is applied at random. The general case, which pushes the state toward a completely mixed one.',
  'amplitude-damping': 'With probability p, a qubit in |1⟩ relaxes to |0⟩. Energy loss to the environment, and the process T₁ measures.',
  'phase-damping': 'With probability p, the phase is randomised without any energy being lost. Coherence decays while the populations stay put — what T₂ measures.'
})

/**
 * Applies a channel to one qubit of a state, as one random event.
 *
 * Sampling rather than averaging is what keeps this affordable. Over many shots the statistics are right, which
 * is what `runNoisy` collects.
 */
export function applyChannel(state: StateVector, kind: ChannelKind, p: number, qubit: number, chance: Chance): void {
  if (p <= 0) return
  const draw = chance.next()
  switch (kind) {
    case 'bit-flip':
      if (draw < p) apply1(state, MATRIX_X, qubit)
      break
    case 'phase-flip':
      if (draw < p) apply1(state, MATRIX_Z, qubit)
      break
    case 'depolarising': {
      if (draw >= p) break
      const which = chance.next()
      if (which < 1 / 3) apply1(state, MATRIX_X, qubit)
      else if (which < 2 / 3) apply1(state, MATRIX_Y, qubit)
      else apply1(state, MATRIX_Z, qubit)
      break
    }
    case 'amplitude-damping': {
      if (draw >= p) break
      /*
       * Relaxation to |0⟩.
       *
       * Modelled as: with probability p, the qubit is measured in the computational basis and, if it was found
       * in |1⟩, flipped down. That is the jump operator of the amplitude-damping channel sampled as a
       * trajectory: energy leaves the system and the state is conditioned on that having happened.
       */
      const got = collapse(state, qubit, chance)
      if (got.outcome === 1) apply1(state, MATRIX_X, qubit)
      break
    }
    case 'phase-damping': {
      if (draw >= p) break
      // Dephasing: a random phase, which over many trajectories destroys coherence without moving population.
      apply1(state, MATRIX_Z, qubit)
      break
    }
  }
}

export interface NoisyResult {
  counts: Record<string, number>
  shots: number
  /** The noiseless probabilities, for comparison. */
  ideal: Record<string, number>
  /** How close the noisy distribution is to the ideal one, 0 to 1. */
  fidelity: number
  /** Never 'exact'. A noisy result is always an average over trajectories. */
  mode: 'noisy-sampled'
  seed: number | null
  model: NoiseModel
  says: string
}

/**
 * Runs a circuit many times with noise and collects the counts.
 *
 * Each shot is an independent trajectory: the circuit is run, a random error is applied after each gate with the
 * model's probability, and the final state is measured. The counts are therefore a sample of a sample, and the
 * result says so.
 */
export function runNoisy(circuit: Circuit, model: NoiseModel, shots = 1000, options: { seed?: number } = {}): NoisyResult {
  const faults = faultsIn(circuit)
  if (faults.length > 0) throw new Error(`This circuit cannot run: ${faults[0].says}`)

  const seed = options.seed ?? null
  const chance = seed === null ? anyChance : seeded(seed)
  const many = Math.max(1, Math.min(100_000, Math.floor(shots)))
  const counts: Record<string, number> = {}

  for (let shot = 0; shot < many; shot += 1) {
    const state = zeroState(circuit.qubits)
    for (const op of circuit.ops) {
      switch (op.kind) {
        case 'gate': {
          const matrix = matrixFor(op.gate, op.theta ?? 0)
          if (matrix) apply1(state, matrix, op.target)
          if (model.oneQubit) applyChannel(state, model.oneQubit.kind, model.oneQubit.p, op.target, chance)
          break
        }
        case 'controlled': {
          const matrix = matrixFor(op.gate, op.theta ?? 0)
          if (matrix) applyControlled(state, matrix, op.controls, op.target)
          if (model.twoQubit) {
            for (const one of [...op.controls, op.target]) applyChannel(state, model.twoQubit.kind, model.twoQubit.p, one, chance)
          }
          break
        }
        case 'swap':
          applySwap(state, op.first, op.second)
          if (model.twoQubit) {
            applyChannel(state, model.twoQubit.kind, model.twoQubit.p, op.first, chance)
            applyChannel(state, model.twoQubit.kind, model.twoQubit.p, op.second, chance)
          }
          break
        case 'cphase':
          applyControlledPhase(state, op.theta, op.first, op.second)
          if (model.twoQubit) {
            applyChannel(state, model.twoQubit.kind, model.twoQubit.p, op.first, chance)
            applyChannel(state, model.twoQubit.kind, model.twoQubit.p, op.second, chance)
          }
          break
        case 'measure':
          collapse(state, op.qubit, chance)
          break
        case 'barrier':
          break
      }
    }

    // Idling noise at the end, then readout.
    if (model.idle) {
      for (let qubit = 0; qubit < circuit.qubits; qubit += 1) applyChannel(state, model.idle.kind, model.idle.p, qubit, chance)
    }

    const outcome = measureAll(state, chance, model.readout ?? 0)
    counts[outcome] = (counts[outcome] ?? 0) + 1
  }

  // The noiseless distribution, for the comparison the laboratory shows.
  const clean = idealProbabilities(circuit)
  const ideal: Record<string, number> = {}
  for (let at = 0; at < clean.length; at += 1) {
    if (clean[at] > 1e-12) ideal[at.toString(2).padStart(circuit.qubits, '0')] = clean[at]
  }

  const fidelity = classicalFidelity(counts, many, ideal)
  return {
    counts,
    shots: many,
    ideal,
    fidelity,
    mode: 'noisy-sampled',
    seed,
    model,
    says: `${many} noisy shots. The distribution overlaps the noiseless one by ${(fidelity * 100).toFixed(1)}% — and this is an average over trajectories, with sampling error, not an exact figure.`
  }
}

function measureAll(state: StateVector, chance: Chance, readout: number): string {
  let bits = ''
  for (let qubit = state.qubits - 1; qubit >= 0; qubit -= 1) {
    const got = collapse(state, qubit, chance)
    let value: 0 | 1 = got.outcome
    // Readout error is a classical flip after the measurement, independent of the state.
    if (readout > 0 && chance.next() < readout) value = value === 1 ? 0 : 1
    bits += value
  }
  return bits
}

function idealProbabilities(circuit: Circuit): Float64Array {
  const state = zeroState(circuit.qubits)
  for (const op of circuit.ops) {
    switch (op.kind) {
      case 'gate': {
        const matrix = matrixFor(op.gate, op.theta ?? 0)
        if (matrix) apply1(state, matrix, op.target)
        break
      }
      case 'controlled': {
        const matrix = matrixFor(op.gate, op.theta ?? 0)
        if (matrix) applyControlled(state, matrix, op.controls, op.target)
        break
      }
      case 'swap':
        applySwap(state, op.first, op.second)
        break
      case 'cphase':
        applyControlledPhase(state, op.theta, op.first, op.second)
        break
      default:
        break
    }
  }
  return probabilities(state)
}

/**
 * How much two distributions overlap, from 0 to 1.
 *
 * The classical fidelity — the sum of the smaller of each pair of probabilities. Simple, bounded, and it means
 * something a learner can state: the share of outcomes the two distributions agree about.
 */
export function classicalFidelity(counts: Record<string, number>, shots: number, ideal: Record<string, number>): number {
  let overlap = 0
  for (const [key, value] of Object.entries(ideal)) {
    const seen = (counts[key] ?? 0) / shots
    overlap += Math.min(seen, value)
  }
  return overlap
}

/**
 * Noise from coherence times rather than from a probability.
 *
 * T₁ is how long energy survives, T₂ how long phase survives, and a gate takes `gateTime`. The chance of an
 * error during one gate is 1 − e^(−t/T), which is the standard exponential decay. Expressing noise this way is
 * how hardware is actually specified, and converting between the two is a lesson in itself.
 */
export function fromTimes(t1: number, t2: number, gateTime: number): { amplitude: number; phase: number; says: string } {
  const amplitude = 1 - Math.exp(-gateTime / Math.max(1e-12, t1))
  const phase = 1 - Math.exp(-gateTime / Math.max(1e-12, t2))
  return {
    amplitude,
    phase,
    says: `With T₁ = ${t1}, T₂ = ${t2} and a gate taking ${gateTime}, one gate carries about a ${(amplitude * 100).toFixed(2)}% chance of relaxation and ${(phase * 100).toFixed(2)}% of dephasing. Note T₂ ≤ 2T₁ always — dephasing cannot outlast energy loss by more than that.`
  }
}

/** Whether a stated pair of times is physically possible. T₂ ≤ 2T₁ is a theorem, not a convention. */
export const timesArePossible = (t1: number, t2: number): { ok: boolean; says: string } =>
  t2 <= 2 * t1
    ? { ok: true, says: 'Possible.' }
    : { ok: false, says: `T₂ = ${t2} is more than twice T₁ = ${t1}, which cannot happen: dephasing includes the effect of energy loss, so T₂ ≤ 2T₁ always.` }

// ---------------------------------------------------------------- density matrices, for small systems

export interface DensityMatrix {
  qubits: number
  /** Row-major, 2ⁿ × 2ⁿ, interleaved real and imaginary. */
  data: Float64Array
}

/** ρ = |ψ⟩⟨ψ| for a pure state. */
export function densityOf(state: StateVector): DensityMatrix {
  const size = dimension(state.qubits)
  const data = new Float64Array(size * size * 2)
  for (let row = 0; row < size; row += 1) {
    const aRe = state.data[row * 2]
    const aIm = state.data[row * 2 + 1]
    for (let col = 0; col < size; col += 1) {
      const bRe = state.data[col * 2]
      const bIm = state.data[col * 2 + 1]
      const at = (row * size + col) * 2
      // ρ[row][col] = a · conj(b)
      data[at] = aRe * bRe + aIm * bIm
      data[at + 1] = aIm * bRe - aRe * bIm
    }
  }
  return { qubits: state.qubits, data }
}

/** The trace: should always be 1 for a valid state. */
export function trace(rho: DensityMatrix): number {
  const size = dimension(rho.qubits)
  let sum = 0
  for (let at = 0; at < size; at += 1) sum += rho.data[(at * size + at) * 2]
  return sum
}

/**
 * Purity, tr(ρ²): 1 for a pure state, 1/d for a completely mixed one.
 *
 * The single most useful number about a density matrix, and the one that tells a learner whether what they are
 * looking at is a superposition or a mixture — two things with identical measurement probabilities and quite
 * different futures.
 */
export function purity(rho: DensityMatrix): number {
  const size = dimension(rho.qubits)
  let sum = 0
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      const a = (i * size + j) * 2
      const b = (j * size + i) * 2
      sum += rho.data[a] * rho.data[b] - rho.data[a + 1] * rho.data[b + 1]
    }
  }
  return sum
}

/**
 * The reduced density matrix of one qubit: trace out everything else.
 *
 * This is where entanglement becomes visible. Half of a Bell pair has a reduced state with purity 0.5 — the
 * completely mixed single-qubit state — even though the pair as a whole is pure. A pure whole with mixed parts
 * is what entanglement *is*, and this function is how the course shows it rather than asserting it.
 */
export function reduced(state: StateVector, qubit: number): DensityMatrix {
  let a = 0
  let d = 0
  let bRe = 0
  let bIm = 0
  const size = dimension(state.qubits)
  const bit = 1 << qubit
  for (let at = 0; at < size; at += 1) {
    const re = state.data[at * 2]
    const im = state.data[at * 2 + 1]
    if ((at & bit) === 0) {
      a += re * re + im * im
      const partner = at | bit
      const pre = state.data[partner * 2]
      const pim = state.data[partner * 2 + 1]
      bRe += re * pre + im * pim
      bIm += im * pre - re * pim
    } else {
      d += re * re + im * im
    }
  }
  const data = new Float64Array(8)
  data[0] = a
  data[2] = bRe
  data[3] = bIm
  data[4] = bRe
  data[5] = -bIm
  data[6] = d
  return { qubits: 1, data }
}

/** A mixture of states with weights: Σ pᵢ |ψᵢ⟩⟨ψᵢ|. The classical-uncertainty counterpart of a superposition. */
export function mixture(parts: readonly { state: StateVector; weight: number }[]): DensityMatrix {
  if (parts.length === 0) throw new Error('A mixture needs at least one state.')
  const qubits = parts[0].state.qubits
  const size = dimension(qubits)
  const out = new Float64Array(size * size * 2)
  const total = parts.reduce((sum, one) => sum + one.weight, 0)
  for (const part of parts) {
    const rho = densityOf(part.state)
    const k = part.weight / total
    for (let at = 0; at < out.length; at += 1) out[at] += rho.data[at] * k
  }
  return { qubits, data: out }
}

/** Populations — the diagonal — which are the measurement probabilities. */
export function populations(rho: DensityMatrix): number[] {
  const size = dimension(rho.qubits)
  const out: number[] = []
  for (let at = 0; at < size; at += 1) out.push(rho.data[(at * size + at) * 2])
  return out
}

/**
 * The largest off-diagonal magnitude: how much coherence the state has.
 *
 * Zero for a classical mixture, non-zero for a superposition. This is the number that distinguishes "the qubit is
 * either 0 or 1 and I do not know which" from "the qubit is in a superposition", which have identical
 * populations and completely different behaviour under a Hadamard.
 */
export function coherence(rho: DensityMatrix): number {
  const size = dimension(rho.qubits)
  let most = 0
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      if (i === j) continue
      const at = (i * size + j) * 2
      most = Math.max(most, Math.hypot(rho.data[at], rho.data[at + 1]))
    }
  }
  return most
}
