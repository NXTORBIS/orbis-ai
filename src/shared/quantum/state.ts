import { INV_SQRT2, type Complex, complex, norm2, phase } from './complex.ts'

/**
 * The quantum state of n qubits, and every operation that acts on it.
 *
 * ## One flat array, interleaved
 *
 * An n-qubit pure state needs 2ⁿ complex amplitudes. They are held in a single `Float64Array` of length 2ⁿ⁺¹,
 * real and imaginary parts alternating, because that is what makes a gate a tight loop over a typed array rather
 * than 2ⁿ object allocations. Ten qubits is 16 KB; twenty is 16 MB; twenty-four is 256 MB and the limit of what
 * a desktop should attempt, which is why `capacityFor` exists and refuses rather than freezing the application.
 *
 * ## Qubit ordering, stated once
 *
 * Qubit 0 is the **least significant bit** of the basis-state index. So for two qubits, index 2 (binary 10) means
 * qubit 1 is |1⟩ and qubit 0 is |0⟩, which this file writes as |q₁q₀⟩ = |10⟩. Every convention is defensible and
 * mixing two of them silently produces a circuit that is wrong in a way no test catches unless the convention is
 * written down. It is written down here.
 *
 * ## Nothing is renormalised behind your back
 *
 * A state that drifts from norm 1 is a fault to be reported, not patched. `normCheck` exists so a test or a
 * screen can ask; no gate quietly rescales, because a gate that silently fixed its own error would hide the
 * mistake that caused it.
 */

export interface StateVector {
  /** How many qubits. */
  qubits: number
  /** 2ⁿ⁺¹ doubles: [re₀, im₀, re₁, im₁, …]. */
  data: Float64Array
}

/** How many basis states an n-qubit register has. */
export const dimension = (qubits: number): number => 2 ** qubits

/**
 * Whether a register of this size can be simulated here, and what it would cost.
 *
 * Refusing honestly is the whole point. A simulator that accepts 30 qubits and then exhausts memory has told the
 * learner nothing except that the application is unreliable.
 */
export function capacityFor(qubits: number): { ok: boolean; bytes: number; says: string } {
  if (!Number.isInteger(qubits) || qubits < 1) {
    return { ok: false, bytes: 0, says: 'A register needs at least one qubit.' }
  }
  const bytes = dimension(qubits) * 16
  if (qubits > MAX_QUBITS) {
    return {
      ok: false,
      bytes,
      says: `${qubits} qubits would need ${readable(bytes)} for the state vector alone, which is more than this simulator will attempt. The limit here is ${MAX_QUBITS} qubits.`
    }
  }
  return { ok: true, bytes, says: `${qubits} qubits — ${dimension(qubits)} amplitudes, about ${readable(bytes)}.` }
}

/**
 * The ceiling.
 *
 * Twenty-four qubits is 16.8 million amplitudes and 268 MB, which a desktop can hold and which takes a
 * noticeable moment per gate. Beyond it the honest answer is no.
 */
export const MAX_QUBITS = 24

const readable = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/** A fresh register, every qubit in |0⟩. */
export function zeroState(qubits: number): StateVector {
  const can = capacityFor(qubits)
  if (!can.ok) throw new Error(can.says)
  const data = new Float64Array(dimension(qubits) * 2)
  data[0] = 1
  return { qubits, data }
}

/** A register prepared in one basis state, given as an integer or as a bit string like "1011". */
export function basisState(qubits: number, which: number | string): StateVector {
  const index = typeof which === 'string' ? Number.parseInt(which, 2) : which
  if (!Number.isInteger(index) || index < 0 || index >= dimension(qubits)) {
    throw new Error(`${String(which)} is not a basis state of ${qubits} qubits.`)
  }
  const state = zeroState(qubits)
  state.data[0] = 0
  state.data[index * 2] = 1
  return state
}

/** A state built from amplitudes, checked for normalisation rather than rescaled. */
export function fromAmplitudes(amplitudes: readonly Complex[]): StateVector {
  const qubits = Math.log2(amplitudes.length)
  if (!Number.isInteger(qubits) || qubits < 1) {
    throw new Error(`${amplitudes.length} amplitudes is not a power of two, so it is not a qubit register.`)
  }
  const state = zeroState(qubits)
  for (const [at, one] of amplitudes.entries()) {
    state.data[at * 2] = one.re
    state.data[at * 2 + 1] = one.im
  }
  return state
}

export const copy = (state: StateVector): StateVector => ({ qubits: state.qubits, data: state.data.slice() })

/** One amplitude. */
export const amplitude = (state: StateVector, index: number): Complex =>
  complex(state.data[index * 2], state.data[index * 2 + 1])

/** The probability of measuring one particular basis state. */
export const probability = (state: StateVector, index: number): number => norm2(amplitude(state, index))

/** Every probability, in basis-state order. */
export function probabilities(state: StateVector): Float64Array {
  const out = new Float64Array(dimension(state.qubits))
  for (let at = 0; at < out.length; at += 1) {
    const re = state.data[at * 2]
    const im = state.data[at * 2 + 1]
    out[at] = re * re + im * im
  }
  return out
}

/** The total probability. Should be 1; reported rather than corrected. */
export function totalProbability(state: StateVector): number {
  let sum = 0
  for (let at = 0; at < state.data.length; at += 2) {
    sum += state.data[at] * state.data[at] + state.data[at + 1] * state.data[at + 1]
  }
  return sum
}

/**
 * Whether the state is still normalised.
 *
 * Called by tests and by the inspector. If this ever reports false during a run of valid gates, something is
 * wrong with the engine and the screen should say so rather than showing a tidy picture of an invalid state.
 */
export function normCheck(state: StateVector, tol = 1e-9): { ok: boolean; total: number; says: string } {
  const total = totalProbability(state)
  if (Math.abs(total - 1) <= tol) return { ok: true, total, says: 'Normalised.' }
  return {
    ok: false,
    total,
    says: `The probabilities add up to ${total.toFixed(9)} rather than 1. This is a fault in the simulation, not a property of the state.`
  }
}

/**
 * Normalises a state, for the one legitimate case: a state the learner typed in.
 *
 * Never called by a gate. A learner entering amplitudes should be told their state is not normalised and offered
 * this, which is a different thing from an engine quietly hiding its own drift.
 */
export function normalised(state: StateVector): StateVector | null {
  const total = totalProbability(state)
  if (total <= 0) return null
  const k = 1 / Math.sqrt(total)
  const out = copy(state)
  for (let at = 0; at < out.data.length; at += 1) out.data[at] *= k
  return out
}

// ---------------------------------------------------------------- reading a state

export interface BasisRow {
  index: number
  /** "01", with qubit 0 on the right. */
  bits: string
  amplitude: Complex
  probability: number
  /** Radians, −π to π. Zero for a zero amplitude. */
  phase: number
}

/** The bit string for a basis-state index, qubit 0 on the right. */
export const bitsOf = (index: number, qubits: number): string => index.toString(2).padStart(qubits, '0')

/** Whether qubit q is 1 in this basis state. */
export const bitAt = (index: number, qubit: number): 0 | 1 => ((index >> qubit) & 1) as 0 | 1

/**
 * The state as a table, for the inspector.
 *
 * `atLeast` drops amplitudes smaller than a threshold, because a ten-qubit state has 1,024 rows and nearly all
 * of them are zero. The default keeps anything with a probability above one in a million — small enough to show
 * real interference, large enough to hide floating-point dust.
 */
export function rows(state: StateVector, atLeast = 1e-6): BasisRow[] {
  const out: BasisRow[] = []
  for (let at = 0; at < dimension(state.qubits); at += 1) {
    const one = amplitude(state, at)
    const p = norm2(one)
    if (p < atLeast) continue
    out.push({ index: at, bits: bitsOf(at, state.qubits), amplitude: one, probability: p, phase: phase(one) })
  }
  return out
}

/** The state in ket notation: "0.707|00⟩ + 0.707|11⟩". For small registers; refuses to be a wall of text. */
export function ket(state: StateVector, digits = 3, most = 8): string {
  const kept = rows(state).sort((a, b) => b.probability - a.probability)
  if (kept.length === 0) return '0'
  const shown = kept.slice(0, most)
  const parts = shown.map((one) => {
    const re = Number(one.amplitude.re.toFixed(digits))
    const im = Number(one.amplitude.im.toFixed(digits))
    const coefficient = im === 0 ? `${re}` : re === 0 ? `${im}i` : `(${re}${im < 0 ? '' : '+'}${im}i)`
    return `${coefficient}|${one.bits}⟩`
  })
  const tail = kept.length > most ? ` + ${kept.length - most} more` : ''
  return parts.join(' + ') + tail
}

/**
 * The probability that one qubit reads 1, with every other qubit ignored.
 *
 * This is a marginal: summed over all the basis states where that qubit is 1. It is what a single-qubit
 * measurement would give, and it is also what the Bloch sphere needs for a qubit in a larger register.
 */
export function qubitProbability(state: StateVector, qubit: number): number {
  let sum = 0
  for (let at = 0; at < dimension(state.qubits); at += 1) {
    if (bitAt(at, qubit) === 1) sum += probability(state, at)
  }
  return sum
}

// ---------------------------------------------------------------- the single-qubit states people draw

/** |+⟩ = (|0⟩ + |1⟩)/√2 */
export const plusState = (): StateVector => fromAmplitudes([complex(INV_SQRT2), complex(INV_SQRT2)])
/** |−⟩ = (|0⟩ − |1⟩)/√2 — the same measurement probabilities as |+⟩, the opposite relative phase. */
export const minusState = (): StateVector => fromAmplitudes([complex(INV_SQRT2), complex(-INV_SQRT2)])
/** |i⟩ = (|0⟩ + i|1⟩)/√2 */
export const iState = (): StateVector => fromAmplitudes([complex(INV_SQRT2), complex(0, INV_SQRT2)])

/**
 * A single qubit from its Bloch angles.
 *
 * |ψ⟩ = cos(θ/2)|0⟩ + e^{iφ} sin(θ/2)|1⟩. θ runs from 0 at the north pole (|0⟩) to π at the south (|1⟩); φ is
 * the angle round the equator, which is where |+⟩, |i⟩, |−⟩ and |−i⟩ sit.
 */
export function fromBloch(theta: number, phi: number): StateVector {
  const half = theta / 2
  const sin = Math.sin(half)
  return fromAmplitudes([complex(Math.cos(half)), complex(sin * Math.cos(phi), sin * Math.sin(phi))])
}

export interface BlochPoint {
  x: number
  y: number
  z: number
  /** The polar angle, 0 at |0⟩. */
  theta: number
  /** The azimuth. */
  phi: number
  /**
   * The length of the vector. 1 for a pure single-qubit state; less than 1 when the qubit is entangled with
   * something else, because then it has no pure state of its own — which is the honest reason the arrow is
   * short rather than a drawing artefact.
   */
  radius: number
}

/**
 * Where one qubit of a register sits on the Bloch sphere.
 *
 * Computed from the reduced density matrix of that qubit, which is what makes the entangled case come out
 * correctly: half of a Bell pair has ⟨X⟩ = ⟨Y⟩ = ⟨Z⟩ = 0 and therefore sits at the centre with radius 0. A
 * drawing that put it on the surface would be a drawing of something that is not true.
 */
export function blochOf(state: StateVector, qubit = 0): BlochPoint {
  // The 2×2 reduced density matrix of this qubit: ρ = [[a, b], [conj(b), d]].
  let a = 0
  let d = 0
  let bRe = 0
  let bIm = 0
  const size = dimension(state.qubits)
  for (let at = 0; at < size; at += 1) {
    const re = state.data[at * 2]
    const im = state.data[at * 2 + 1]
    const p = re * re + im * im
    if (bitAt(at, qubit) === 0) {
      a += p
      // The partner index with this qubit flipped to 1; the off-diagonal term pairs them.
      const partner = at | (1 << qubit)
      const pre = state.data[partner * 2]
      const pim = state.data[partner * 2 + 1]
      // ρ₀₁ = Σ ⟨0|ψ⟩⟨ψ|1⟩ over the other qubits = Σ amp(at) · conj(amp(partner)).
      bRe += re * pre + im * pim
      bIm += im * pre - re * pim
    } else {
      d += p
    }
  }
  const x = 2 * bRe
  const y = -2 * bIm
  const z = a - d
  const radius = Math.hypot(x, y, z)
  return { x, y, z, theta: Math.acos(Math.max(-1, Math.min(1, z / (radius || 1)))), phi: Math.atan2(y, x), radius }
}
