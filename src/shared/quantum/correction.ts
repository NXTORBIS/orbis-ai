import { barrier, cnot, collapse, emptyCircuit, gate, run, seeded, type Chance, type Circuit } from './circuit.ts'
import { MATRIX_X, apply1 } from './gates.ts'
import { probabilities, type StateVector } from './state.ts'

/**
 * Quantum error correction, run rather than described.
 *
 * ## The three-qubit codes, end to end
 *
 * Encode a logical qubit across three physical ones, inject an error, measure the syndrome, correct, decode, and
 * compare with what went in. Every step is a circuit and the final comparison is computed — so when the bit-flip
 * code fails on a phase error, which it does, the learner sees it fail rather than being told it would.
 *
 * ## The syndrome is measured without looking at the data
 *
 * That is the whole trick and the thing worth dwelling on. Measuring the encoded qubits directly would destroy
 * the superposition being protected. Instead, two parity checks are measured — whether qubits 0 and 1 agree, and
 * whether 1 and 2 agree — which says *where* an error is without revealing *what* the logical state is. The
 * ancillas carry that information out; the data qubits are never measured.
 */

export type CodeKind = 'bit-flip' | 'phase-flip'
export type ErrorKind = 'none' | 'x' | 'z' | 'y'

export interface CodeInfo {
  id: CodeKind
  name: string
  physical: number
  /** What it protects against, and what it does not. Stated plainly because the second half is the lesson. */
  protects: string
  misses: string
}

export const CODES: readonly CodeInfo[] = Object.freeze([
  {
    id: 'bit-flip',
    name: 'Three-qubit bit-flip code',
    physical: 3,
    protects: 'A single X error on any one of the three qubits is detected and corrected.',
    misses: 'A Z error passes through untouched — the parity checks cannot see a phase, so the logical state is corrupted and the syndrome reports nothing wrong.'
  },
  {
    id: 'phase-flip',
    name: 'Three-qubit phase-flip code',
    physical: 3,
    protects: 'A single Z error is detected and corrected, by working in the Hadamard basis where a phase flip becomes a bit flip.',
    misses: 'An X error now passes through, for the mirror-image reason. Protecting against both at once needs nine qubits, or a surface code.'
  }
])

export interface CorrectionRun {
  code: CodeKind
  injected: { kind: ErrorKind; qubit: number }
  /** The two parity bits the syndrome measurement produced. */
  syndrome: [0 | 1, 0 | 1]
  /** Which qubit the syndrome pointed at, or null for "nothing wrong". */
  blamed: number | null
  /** Whether the logical state came back intact. Computed, not assumed. */
  recovered: boolean
  /** How close the final logical state is to the one that went in. */
  fidelity: number
  circuit: Circuit
  says: string
}

/**
 * One full cycle: encode, inject, measure the syndrome, correct, decode, compare.
 *
 * The logical state is prepared as α|0⟩ + β|1⟩ with a chosen angle, so the test is whether a *superposition*
 * survives — which is the thing that matters and the thing a classical repetition code cannot do.
 */
export function correctOnce(
  code: CodeKind,
  injected: { kind: ErrorKind; qubit: number },
  options: { theta?: number; seed?: number } = {}
): CorrectionRun {
  const theta = options.theta ?? 0.9
  const chance: Chance = options.seed === undefined ? { next: () => 0.5 } : seeded(options.seed)

  // Five qubits: three data, two ancillas for the syndrome.
  let circuit = emptyCircuit(5, 2, `${code} code`)

  // The logical state, on qubit 0.
  circuit = gate(circuit, 'ry', 0, theta)
  circuit = barrier(circuit, 'encode')
  circuit = cnot(circuit, 0, 1)
  circuit = cnot(circuit, 0, 2)
  if (code === 'phase-flip') {
    // The phase-flip code is the bit-flip code in the Hadamard basis.
    for (const at of [0, 1, 2]) circuit = gate(circuit, 'h', at)
  }

  circuit = barrier(circuit, 'error')
  if (injected.kind !== 'none') {
    const id = injected.kind === 'y' ? 'y' : injected.kind
    circuit = gate(circuit, id, injected.qubit)
  }

  circuit = barrier(circuit, 'syndrome')
  if (code === 'phase-flip') {
    // Back to the computational basis, where the parity checks work.
    for (const at of [0, 1, 2]) circuit = gate(circuit, 'h', at)
  }
  // Parity of 0 and 1 into ancilla 3; parity of 1 and 2 into ancilla 4.
  circuit = cnot(circuit, 0, 3)
  circuit = cnot(circuit, 1, 3)
  circuit = cnot(circuit, 1, 4)
  circuit = cnot(circuit, 2, 4)

  const out = run(circuit, { chance, keepEvery: Number.MAX_SAFE_INTEGER })
  const state = out.state

  // Read the ancillas. This is the only measurement, and it touches no data qubit.
  const first = collapse(state, 3, chance).outcome
  const second = collapse(state, 4, chance).outcome
  const syndrome: [0 | 1, 0 | 1] = [first, second]

  /*
   * What the syndrome means.
   *
   * 00 — the three agree, so no single error.
   * 10 — qubits 0 and 1 disagree, 1 and 2 agree: qubit 0 is the odd one.
   * 11 — both checks disagree: qubit 1 is the odd one.
   * 01 — only the second check disagrees: qubit 2 is the odd one.
   */
  const blamed = first === 0 && second === 0 ? null : first === 1 && second === 0 ? 0 : first === 1 && second === 1 ? 1 : 2

  if (blamed !== null) apply1(state, MATRIX_X, blamed)

  // Decode: undo the encoding and read the logical qubit.
  if (code === 'phase-flip') {
    for (const at of [0, 1, 2]) apply1(state, { a: { re: Math.SQRT1_2, im: 0 }, b: { re: Math.SQRT1_2, im: 0 }, c: { re: Math.SQRT1_2, im: 0 }, d: { re: -Math.SQRT1_2, im: 0 } }, at)
  }
  // The inverse of the two CNOTs.
  applyCnot(state, 0, 2)
  applyCnot(state, 0, 1)

  // What should have come out, for comparison.
  const wanted = probabilitiesOfLogical(theta)
  const got = logicalProbabilities(state)
  const fidelity = Math.min(1, Math.sqrt(wanted[0] * got[0]) + Math.sqrt(wanted[1] * got[1]))
  const recovered = fidelity > 0.999

  const info = CODES.find((one) => one.id === code)
  return {
    code,
    injected,
    syndrome,
    blamed,
    recovered,
    fidelity,
    circuit,
    says: recovered
      ? `Syndrome ${syndrome.join('')}${blamed === null ? ' — nothing to correct' : ` — qubit ${blamed} corrected`}. The logical state came back intact, fidelity ${fidelity.toFixed(4)}.`
      : `Syndrome ${syndrome.join('')}${blamed === null ? ' — the checks saw nothing wrong' : ` — qubit ${blamed} was corrected`}, and the logical state did not survive: fidelity ${fidelity.toFixed(4)}. ${info?.misses ?? ''}`
  }
}

function applyCnot(state: StateVector, control: number, target: number): void {
  // A CNOT is its own inverse, so this undoes the encoding.
  const bitC = 1 << control
  const bitT = 1 << target
  const size = 2 ** state.qubits
  for (let at = 0; at < size; at += 1) {
    if ((at & bitC) === 0) continue
    if ((at & bitT) !== 0) continue
    const partner = at | bitT
    const i0 = at * 2
    const i1 = partner * 2
    const re = state.data[i0]
    const im = state.data[i0 + 1]
    state.data[i0] = state.data[i1]
    state.data[i0 + 1] = state.data[i1 + 1]
    state.data[i1] = re
    state.data[i1 + 1] = im
  }
}

/** The probabilities a logical qubit prepared with Ry(θ) should show. */
const probabilitiesOfLogical = (theta: number): [number, number] => [Math.cos(theta / 2) ** 2, Math.sin(theta / 2) ** 2]

/** The marginal probabilities of qubit 0 in the full register. */
function logicalProbabilities(state: StateVector): [number, number] {
  const probs = probabilities(state)
  let zero = 0
  let one = 0
  for (let at = 0; at < probs.length; at += 1) {
    if ((at & 1) === 0) zero += probs[at]
    else one += probs[at]
  }
  const total = zero + one
  return total > 0 ? [zero / total, one / total] : [0, 0]
}

export interface CodeSurvey {
  code: CodeKind
  /** For each error that could occur, what happened. */
  results: { kind: ErrorKind; qubit: number; recovered: boolean; syndrome: string; fidelity: number }[]
  /** How many of them the code handled. */
  handled: number
  total: number
  says: string
}

/**
 * Every single-qubit error against a code, so the gap is visible.
 *
 * The bit-flip code handles all three X errors and none of the Z errors. Running the whole table is the clearest
 * possible demonstration that a code protects against what it was designed for and nothing else — and it is why
 * the nine-qubit and surface codes exist.
 */
export function surveyCode(code: CodeKind, options: { theta?: number } = {}): CodeSurvey {
  const results: CodeSurvey['results'] = []
  for (const kind of ['none', 'x', 'z'] as const) {
    const qubits = kind === 'none' ? [0] : [0, 1, 2]
    for (const qubit of qubits) {
      const got = correctOnce(code, { kind, qubit }, options)
      results.push({ kind, qubit, recovered: got.recovered, syndrome: got.syndrome.join(''), fidelity: got.fidelity })
    }
  }
  const handled = results.filter((one) => one.recovered).length
  const info = CODES.find((one) => one.id === code)
  return {
    code,
    results,
    handled,
    total: results.length,
    says: `${handled} of ${results.length} cases survived. ${info?.protects ?? ''} ${info?.misses ?? ''}`
  }
}

// ---------------------------------------------------------------- stabilisers, for the surface-code lesson

export interface Stabiliser {
  /** "XZZXI" — one letter per qubit. */
  operator: string
  /** What measuring it tells you. */
  detects: string
}

/**
 * The stabilisers of the three-qubit codes, written out.
 *
 * A stabiliser is an operator the encoded state is an eigenstate of with eigenvalue +1. Measuring it therefore
 * disturbs nothing when all is well, and reports −1 when an error has moved the state out of the code space.
 * That is the formal statement of what the parity checks above are doing, and it is the idea the surface code
 * scales up.
 */
export const STABILISERS: Readonly<Record<CodeKind, readonly Stabiliser[]>> = Object.freeze({
  'bit-flip': Object.freeze([
    { operator: 'ZZI', detects: 'Whether qubits 0 and 1 agree. Reports −1 if exactly one of them was flipped.' },
    { operator: 'IZZ', detects: 'Whether qubits 1 and 2 agree. The two together identify which qubit was flipped.' }
  ]),
  'phase-flip': Object.freeze([
    { operator: 'XXI', detects: 'The same check in the Hadamard basis, where a phase flip looks like a bit flip.' },
    { operator: 'IXX', detects: 'The second check in the Hadamard basis.' }
  ])
})

/** Whether an operator commutes with a stabiliser — which is exactly whether that stabiliser can see that error. */
export function commutes(first: string, second: string): boolean {
  if (first.length !== second.length) throw new Error('Two operators on different numbers of qubits cannot be compared.')
  let anticommuting = 0
  for (let at = 0; at < first.length; at += 1) {
    const a = first[at].toUpperCase()
    const b = second[at].toUpperCase()
    if (a === 'I' || b === 'I' || a === b) continue
    // Two different non-identity Paulis on the same qubit anticommute.
    anticommuting += 1
  }
  return anticommuting % 2 === 0
}

/**
 * What a set of stabilisers sees of an error.
 *
 * An error that commutes with every stabiliser is invisible — and if it is not a logical identity, that is an
 * undetectable error. For the bit-flip code, Z commutes with both ZZ checks, which is precisely why the code is
 * blind to it. The explanation and the demonstration are the same calculation.
 */
export function syndromeOf(code: CodeKind, error: string): { bits: string; visible: boolean; says: string } {
  const checks = STABILISERS[code]
  const bits = checks.map((one) => (commutes(error, one.operator) ? '0' : '1')).join('')
  const visible = bits.includes('1')
  return {
    bits,
    visible,
    says: visible
      ? `${error} anticommutes with ${bits.split('').filter((one) => one === '1').length} of the checks, so the syndrome is ${bits} and the error is detected.`
      : `${error} commutes with every check, so the syndrome is ${bits} and the error is invisible to this code. Nothing is reported and the logical state is wrong.`
  }
}
