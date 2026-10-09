import { INV_SQRT2, type Complex, complex } from './complex.ts'
import { bitAt, dimension, type StateVector } from './state.ts'

/**
 * The gates, and how they are applied to a state vector.
 *
 * ## A gate is a 2×2 or 4×4 matrix, applied in place
 *
 * A single-qubit gate on qubit q pairs up the basis states that differ only in bit q and applies the matrix to
 * each pair. That is 2ⁿ⁻¹ pairs and no allocation, which is what keeps twelve qubits interactive. Building the
 * full 2ⁿ × 2ⁿ matrix and multiplying would be mathematically identical and unusable past about eight qubits.
 *
 * ## Every matrix here is checked for unitarity by the tests
 *
 * `gates.test.ts` verifies U†U = I for every gate in the table, plus the identities the course teaches —
 * H² = I, X² = I, S² = Z, T² = S. A gate that is not unitary would produce states whose probabilities do not sum
 * to 1, and the state would then be invalid rather than merely surprising.
 */

export interface Matrix2 {
  /** Row-major: [[a, b], [c, d]] */
  a: Complex
  b: Complex
  c: Complex
  d: Complex
}

export interface GateInfo {
  id: string
  name: string
  /** How it is drawn in a circuit. */
  symbol: string
  /** 1 for a single-qubit gate, 2 for a two-qubit gate, 3 for Toffoli. */
  qubits: 1 | 2 | 3
  /** Whether it takes an angle. */
  parameterised: boolean
  /** What it does, in words, for the inspector and the lesson. */
  does: string
  /** The rotation it corresponds to on the Bloch sphere, where it is one. */
  bloch?: string
}

const c = complex

// ---------------------------------------------------------------- the single-qubit matrices

export const MATRIX_I: Matrix2 = { a: c(1), b: c(0), c: c(0), d: c(1) }
export const MATRIX_X: Matrix2 = { a: c(0), b: c(1), c: c(1), d: c(0) }
export const MATRIX_Y: Matrix2 = { a: c(0), b: c(0, -1), c: c(0, 1), d: c(0) }
export const MATRIX_Z: Matrix2 = { a: c(1), b: c(0), c: c(0), d: c(-1) }
export const MATRIX_H: Matrix2 = {
  a: c(INV_SQRT2),
  b: c(INV_SQRT2),
  c: c(INV_SQRT2),
  d: c(-INV_SQRT2)
}
export const MATRIX_S: Matrix2 = { a: c(1), b: c(0), c: c(0), d: c(0, 1) }
export const MATRIX_SDG: Matrix2 = { a: c(1), b: c(0), c: c(0), d: c(0, -1) }
export const MATRIX_T: Matrix2 = { a: c(1), b: c(0), c: c(0), d: c(INV_SQRT2, INV_SQRT2) }
export const MATRIX_TDG: Matrix2 = { a: c(1), b: c(0), c: c(0), d: c(INV_SQRT2, -INV_SQRT2) }
/** √X, which appears as a native gate on real hardware. */
export const MATRIX_SX: Matrix2 = {
  a: c(0.5, 0.5),
  b: c(0.5, -0.5),
  c: c(0.5, -0.5),
  d: c(0.5, 0.5)
}

/** Rotation about X by θ: cos(θ/2) on the diagonal, −i sin(θ/2) off it. */
export const rx = (theta: number): Matrix2 => {
  const co = Math.cos(theta / 2)
  const si = Math.sin(theta / 2)
  return { a: c(co), b: c(0, -si), c: c(0, -si), d: c(co) }
}

/** Rotation about Y by θ. The only one of the three with purely real entries. */
export const ry = (theta: number): Matrix2 => {
  const co = Math.cos(theta / 2)
  const si = Math.sin(theta / 2)
  return { a: c(co), b: c(-si), c: c(si), d: c(co) }
}

/** Rotation about Z by θ. Changes phase only, so it does nothing visible to a computational-basis measurement. */
export const rz = (theta: number): Matrix2 => ({
  a: c(Math.cos(theta / 2), -Math.sin(theta / 2)),
  b: c(0),
  c: c(0),
  d: c(Math.cos(theta / 2), Math.sin(theta / 2))
})

/** A phase gate: |1⟩ picks up e^{iθ} and |0⟩ is untouched. Z, S and T are this at π, π/2 and π/4. */
export const phaseGate = (theta: number): Matrix2 => ({
  a: c(1),
  b: c(0),
  c: c(0),
  d: c(Math.cos(theta), Math.sin(theta))
})

export const matrixFor = (id: string, theta = 0): Matrix2 | null => {
  switch (id) {
    case 'i':
      return MATRIX_I
    case 'x':
      return MATRIX_X
    case 'y':
      return MATRIX_Y
    case 'z':
      return MATRIX_Z
    case 'h':
      return MATRIX_H
    case 's':
      return MATRIX_S
    case 'sdg':
      return MATRIX_SDG
    case 't':
      return MATRIX_T
    case 'tdg':
      return MATRIX_TDG
    case 'sx':
      return MATRIX_SX
    case 'rx':
      return rx(theta)
    case 'ry':
      return ry(theta)
    case 'rz':
      return rz(theta)
    case 'p':
      return phaseGate(theta)
    default:
      return null
  }
}

// ---------------------------------------------------------------- applying them

/**
 * One single-qubit gate, applied in place.
 *
 * The loop walks the basis states whose bit q is 0 and pairs each with its partner. Every pair is transformed
 * independently, which is exactly what a tensor product with the identity on the other qubits means.
 */
export function apply1(state: StateVector, matrix: Matrix2, qubit: number): void {
  if (qubit < 0 || qubit >= state.qubits) throw new Error(`There is no qubit ${qubit} in a ${state.qubits}-qubit register.`)
  const size = dimension(state.qubits)
  const bit = 1 << qubit
  const { a, b, c: cc, d } = matrix
  const data = state.data
  for (let at = 0; at < size; at += 1) {
    if ((at & bit) !== 0) continue
    const partner = at | bit
    const i0 = at * 2
    const i1 = partner * 2
    const x0 = data[i0]
    const y0 = data[i0 + 1]
    const x1 = data[i1]
    const y1 = data[i1 + 1]
    // new0 = a·amp0 + b·amp1 ; new1 = c·amp0 + d·amp1
    data[i0] = a.re * x0 - a.im * y0 + (b.re * x1 - b.im * y1)
    data[i0 + 1] = a.re * y0 + a.im * x0 + (b.re * y1 + b.im * x1)
    data[i1] = cc.re * x0 - cc.im * y0 + (d.re * x1 - d.im * y1)
    data[i1 + 1] = cc.re * y0 + cc.im * x0 + (d.re * y1 + d.im * x1)
  }
}

/**
 * A controlled single-qubit gate.
 *
 * The matrix is applied to the target only in the basis states where every control bit is 1. Note what this
 * does **not** mean: it is not "if the control is 1". In a superposition, some branches of the state have the
 * control at 1 and some at 0, and the gate acts on exactly the branches where it is — which is how entanglement
 * is created and why the classical reading of "controlled" misleads.
 */
export function applyControlled(state: StateVector, matrix: Matrix2, controls: readonly number[], target: number): void {
  for (const one of controls) {
    if (one === target) throw new Error('A gate cannot control itself: the control and the target must be different qubits.')
    if (one < 0 || one >= state.qubits) throw new Error(`There is no qubit ${one} in a ${state.qubits}-qubit register.`)
  }
  if (target < 0 || target >= state.qubits) throw new Error(`There is no qubit ${target} in a ${state.qubits}-qubit register.`)

  let mask = 0
  for (const one of controls) mask |= 1 << one
  const size = dimension(state.qubits)
  const bit = 1 << target
  const { a, b, c: cc, d } = matrix
  const data = state.data
  for (let at = 0; at < size; at += 1) {
    if ((at & bit) !== 0) continue
    if ((at & mask) !== mask) continue
    const partner = at | bit
    const i0 = at * 2
    const i1 = partner * 2
    const x0 = data[i0]
    const y0 = data[i0 + 1]
    const x1 = data[i1]
    const y1 = data[i1 + 1]
    data[i0] = a.re * x0 - a.im * y0 + (b.re * x1 - b.im * y1)
    data[i0 + 1] = a.re * y0 + a.im * x0 + (b.re * y1 + b.im * x1)
    data[i1] = cc.re * x0 - cc.im * y0 + (d.re * x1 - d.im * y1)
    data[i1 + 1] = cc.re * y0 + cc.im * x0 + (d.re * y1 + d.im * x1)
  }
}

/** Swaps two qubits, by exchanging the amplitudes of the basis states where their bits differ. */
export function applySwap(state: StateVector, first: number, second: number): void {
  if (first === second) return
  const size = dimension(state.qubits)
  const data = state.data
  for (let at = 0; at < size; at += 1) {
    const a = bitAt(at, first)
    const b = bitAt(at, second)
    if (a === b) continue
    // Only handle each pair once.
    if (a !== 1) continue
    const partner = (at & ~(1 << first)) | (1 << second)
    const i0 = at * 2
    const i1 = partner * 2
    const re = data[i0]
    const im = data[i0 + 1]
    data[i0] = data[i1]
    data[i0 + 1] = data[i1 + 1]
    data[i1] = re
    data[i1 + 1] = im
  }
}

/**
 * A controlled phase between two qubits: the amplitude where both are 1 picks up e^{iθ}.
 *
 * Symmetric in its two arguments, unlike a controlled gate in general — which is worth noticing, because it is
 * why the QFT circuit can be drawn either way round.
 */
export function applyControlledPhase(state: StateVector, theta: number, first: number, second: number): void {
  const both = (1 << first) | (1 << second)
  const size = dimension(state.qubits)
  const co = Math.cos(theta)
  const si = Math.sin(theta)
  const data = state.data
  for (let at = 0; at < size; at += 1) {
    if ((at & both) !== both) continue
    const i = at * 2
    const re = data[i]
    const im = data[i + 1]
    data[i] = re * co - im * si
    data[i + 1] = re * si + im * co
  }
}

// ---------------------------------------------------------------- the catalogue, for the interface

export const GATES: readonly GateInfo[] = Object.freeze([
  { id: 'i', name: 'Identity', symbol: 'I', qubits: 1, parameterised: false, does: 'Leaves the state exactly as it was.' },
  { id: 'x', name: 'Pauli-X', symbol: 'X', qubits: 1, parameterised: false, does: 'Swaps the amplitudes of |0⟩ and |1⟩. On a basis state it is a bit flip.', bloch: 'A half turn about the x axis' },
  { id: 'y', name: 'Pauli-Y', symbol: 'Y', qubits: 1, parameterised: false, does: 'A bit flip and a phase change together.', bloch: 'A half turn about the y axis' },
  { id: 'z', name: 'Pauli-Z', symbol: 'Z', qubits: 1, parameterised: false, does: 'Leaves |0⟩ alone and multiplies |1⟩ by −1. Invisible to an immediate measurement, decisive after a Hadamard.', bloch: 'A half turn about the z axis' },
  { id: 'h', name: 'Hadamard', symbol: 'H', qubits: 1, parameterised: false, does: 'Takes |0⟩ to |+⟩ and |1⟩ to |−⟩. Applied twice it does nothing at all.', bloch: 'A half turn about the axis between x and z' },
  { id: 's', name: 'S', symbol: 'S', qubits: 1, parameterised: false, does: 'A quarter-turn phase: |1⟩ picks up i. Twice over it is Z.', bloch: 'A quarter turn about z' },
  { id: 'sdg', name: 'S†', symbol: 'S†', qubits: 1, parameterised: false, does: 'The inverse of S: |1⟩ picks up −i rather than i. S then S† leaves the state exactly as it was.', bloch: 'A quarter turn about z, the other way' },
  { id: 't', name: 'T', symbol: 'T', qubits: 1, parameterised: false, does: 'An eighth-turn phase. Twice over it is S.', bloch: 'An eighth turn about z' },
  { id: 'tdg', name: 'T†', symbol: 'T†', qubits: 1, parameterised: false, does: 'The inverse of T: the eighth-turn phase applied the other way round. T then T† is the identity.', bloch: 'An eighth turn about z, the other way' },
  { id: 'sx', name: '√X', symbol: '√X', qubits: 1, parameterised: false, does: 'Half of an X. Twice over it is X. A native gate on much real hardware.', bloch: 'A quarter turn about x' },
  { id: 'rx', name: 'Rx(θ)', symbol: 'Rx', qubits: 1, parameterised: true, does: 'Rotation about x by any angle.', bloch: 'θ about the x axis' },
  { id: 'ry', name: 'Ry(θ)', symbol: 'Ry', qubits: 1, parameterised: true, does: 'Rotation about y by any angle.', bloch: 'θ about the y axis' },
  { id: 'rz', name: 'Rz(θ)', symbol: 'Rz', qubits: 1, parameterised: true, does: 'Rotation about z by any angle. Phase only — no change to computational-basis probabilities.', bloch: 'θ about the z axis' },
  { id: 'p', name: 'Phase(θ)', symbol: 'P', qubits: 1, parameterised: true, does: 'Multiplies |1⟩ by e^{iθ}. Z, S and T are this at π, π/2 and π/4.', bloch: 'θ about z, up to a global phase' },
  { id: 'cx', name: 'CNOT', symbol: '⊕', qubits: 2, parameterised: false, does: 'Flips the target in exactly the branches of the state where the control is 1. With a Hadamard before it, this is how entanglement is made.' },
  { id: 'cz', name: 'Controlled-Z', symbol: 'CZ', qubits: 2, parameterised: false, does: 'Multiplies the |11⟩ amplitude by −1. Symmetric in its two qubits.' },
  { id: 'cp', name: 'Controlled phase', symbol: 'CP', qubits: 2, parameterised: true, does: 'Multiplies the |11⟩ amplitude by e^{iθ}. The building block of the Fourier transform circuit.' },
  { id: 'swap', name: 'Swap', symbol: '×', qubits: 2, parameterised: false, does: 'Exchanges two qubits.' },
  { id: 'ccx', name: 'Toffoli', symbol: '⊕⊕', qubits: 3, parameterised: false, does: 'Flips the target where both controls are 1. Reversible AND, and enough on its own for classical computation.' }
])

export const gateInfo = (id: string): GateInfo | null => GATES.find((one) => one.id === id) ?? null
