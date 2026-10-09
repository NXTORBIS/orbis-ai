import { randomFrom, type Scene, type Shape, type Simulation } from './simulation.ts'

/**
 * Quantum error correction: stabiliser codes, syndromes, and decoders that are sometimes wrong.
 *
 * ## The decoder failing is the point
 *
 * A laboratory that showed error correction always working would be teaching the opposite of the subject. A
 * distance-3 code corrects one error and is defeated by two, and the whole of fault tolerance is the business of
 * pushing the chance of that second error down. Here the errors are applied at a rate you choose, the syndrome is
 * measured, the decoder makes its guess, and the laboratory reports how often that guess was *wrong*.
 *
 * ## Success is not "the correction cancelled the error"
 *
 * It is the one subtlety that decides whether this engine is right or merely plausible. If the correction differs
 * from the error by a **stabiliser**, the state is untouched and the round succeeded — even though the leftover
 * Pauli is not the identity. Within a Shor block, Z on the first qubit and Z on the second differ by a stabiliser
 * and do exactly the same thing to the encoded state. An engine that demanded an exact cancellation would call
 * those rounds failures and report roughly twice the true logical error rate.
 *
 * So a round succeeds when the residual lies in the stabiliser group, and fails when it commutes with every
 * stabiliser yet lies outside it — which is precisely the definition of a logical operator.
 *
 * ## Every stabiliser is a full Pauli string
 *
 * Not "an X check over these qubits". The five-qubit perfect code's generators are `XZZXI` and its rotations:
 * mixed Pauli, a different letter on every qubit. Anything that cannot write those down is not describing that
 * code, whatever it calls itself.
 *
 * ## The syndrome never tells you the state
 *
 * Measuring Z₁Z₂ tells you whether those two qubits agree, and nothing at all about whether they are both 0 or
 * both 1. The readout shows the syndrome beside the real error so it is visible that the first does not determine
 * the second: two different errors can give the same syndrome, and that is exactly when the decoder is wrong.
 *
 * Pure. Takes a seed, so a run can be repeated exactly.
 */

export type Pauli = 'I' | 'X' | 'Y' | 'Z'

/**
 * A Pauli operator on n qubits, held as two bit vectors — the X part and the Z part.
 * I = (0,0), X = (1,0), Z = (0,1), Y = (1,1). Phases are dropped; they affect none of this.
 */
interface Operator {
  x: number[]
  z: number[]
}

const empty = (n: number): Operator => ({ x: new Array<number>(n).fill(0), z: new Array<number>(n).fill(0) })

function fromString(text: string): Operator {
  const made = empty(text.length)
  for (let at = 0; at < text.length; at += 1) {
    const letter = text[at] as Pauli
    if (letter === 'X' || letter === 'Y') made.x[at] = 1
    if (letter === 'Z' || letter === 'Y') made.z[at] = 1
  }
  return made
}

const letterAt = (one: Operator, at: number): Pauli =>
  one.x[at] === 1 ? (one.z[at] === 1 ? 'Y' : 'X') : one.z[at] === 1 ? 'Z' : 'I'

const asString = (one: Operator): string => one.x.map((_, at) => letterAt(one, at)).join('')

/** Paulis multiply by adding their bit vectors, since every Pauli is its own inverse. */
const times = (a: Operator, b: Operator): Operator => ({
  x: a.x.map((one, at) => one ^ b.x[at]),
  z: a.z.map((one, at) => one ^ b.z[at])
})

/** The symplectic product: 0 when two Paulis commute, 1 when they anticommute. This is the syndrome bit. */
function anticommutes(a: Operator, b: Operator): number {
  let total = 0
  for (let at = 0; at < a.x.length; at += 1) total ^= (a.x[at] & b.z[at]) ^ (a.z[at] & b.x[at])
  return total
}

const weightOf = (one: Operator): number => one.x.reduce((count, _, at) => count + (letterAt(one, at) === 'I' ? 0 : 1), 0)

export interface Code {
  id: string
  name: string
  /** How many physical qubits carry the encoded information. */
  qubits: number
  /** The stabiliser generators, as full Pauli strings. */
  stabilisers: readonly string[]
  /** The logical operators, so a failure can be named rather than merely counted. */
  logical: readonly { label: string; on: string }[]
  /** What it protects against, said plainly. */
  protects: string
  /** Errors on this many qubits are always corrected; one more may not be. */
  distance: number
  /**
   * Which kinds of error this code can actually handle. The three-qubit codes handle one kind only, and scoring
   * them against all three would be marking them on a job they never claimed.
   */
  corrects: readonly Pauli[]
  about: string
}

export const CODES: readonly Code[] = Object.freeze([
  {
    id: 'bit-flip',
    name: 'Three-qubit bit-flip code',
    qubits: 3,
    stabilisers: ['ZZI', 'IZZ'],
    logical: [{ label: 'X̄', on: 'XXX' }, { label: 'Z̄', on: 'ZZZ' }],
    protects: 'one bit flip (X error) anywhere in the three',
    distance: 3,
    corrects: ['X'],
    about: 'Encodes |0⟩ as |000⟩ and |1⟩ as |111⟩. Two parity checks locate a single flip without ever revealing which of the two states it is. A phase error passes straight through untouched, which is exactly why the phase-flip code exists.'
  },
  {
    id: 'phase-flip',
    name: 'Three-qubit phase-flip code',
    qubits: 3,
    stabilisers: ['XXI', 'IXX'],
    logical: [{ label: 'X̄', on: 'XXX' }, { label: 'Z̄', on: 'ZZZ' }],
    protects: 'one phase flip (Z error) anywhere in the three',
    distance: 3,
    corrects: ['Z'],
    about: 'The bit-flip code turned sideways by a Hadamard on every qubit. A phase flip in one basis is a bit flip in the other, which is the whole idea — and it is blind to bit flips in precisely the way the other is blind to phase flips.'
  },
  {
    id: 'shor',
    name: 'Shor nine-qubit code',
    qubits: 9,
    stabilisers: ['ZZIIIIIII', 'IZZIIIIII', 'IIIZZIIII', 'IIIIZZIII', 'IIIIIIZZI', 'IIIIIIIZZ', 'XXXXXXIII', 'IIIXXXXXX'],
    logical: [{ label: 'X̄', on: 'XXXXXXXXX' }, { label: 'Z̄', on: 'ZZZZZZZZZ' }],
    protects: 'any single error at all — bit flip, phase flip, or both at once',
    distance: 3,
    corrects: ['X', 'Y', 'Z'],
    about: 'The phase-flip code with each of its three qubits replaced by a bit-flip code. The first code to show that arbitrary errors could be corrected, and the reason anybody believed quantum computing was possible.'
  },
  {
    id: 'steane',
    name: 'Steane seven-qubit code',
    qubits: 7,
    stabilisers: ['IIIZZZZ', 'IZZIIZZ', 'ZIZIZIZ', 'IIIXXXX', 'IXXIIXX', 'XIXIXIX'],
    logical: [{ label: 'X̄', on: 'XXXXXXX' }, { label: 'Z̄', on: 'ZZZZZZZ' }],
    protects: 'any single error, using seven qubits rather than nine',
    distance: 3,
    corrects: ['X', 'Y', 'Z'],
    about: 'Built from the Hamming code. The three Z checks read as a binary number give the position of a bit flip directly, and the three X checks do the same for a phase flip — so it needs no lookup table at all.'
  },
  {
    id: 'five-qubit',
    name: 'Five-qubit perfect code',
    qubits: 5,
    stabilisers: ['XZZXI', 'IXZZX', 'XIXZZ', 'ZXIXZ'],
    logical: [{ label: 'X̄', on: 'XXXXX' }, { label: 'Z̄', on: 'ZZZZZ' }],
    protects: 'any single error, on the fewest qubits that is possible',
    distance: 3,
    corrects: ['X', 'Y', 'Z'],
    about: 'Five is provably the smallest number of qubits that can correct an arbitrary single error. Four stabilisers give sixteen syndromes for fifteen single-qubit errors plus no error — exactly enough, with none spare, which is what "perfect" means here.'
  }
])

export const codeFor = (id: string): Code | null => CODES.find((one) => one.id === id) ?? null

/** Everything derived from a code once, so a run does not rebuild it every round. */
export interface Prepared {
  code: Code
  stabilisers: Operator[]
  /** Reduced basis of the stabiliser group, for deciding whether a residual is harmless. */
  basis: { op: Operator; pivot: number }[]
  /** Syndrome → smallest error giving it. Built once; this is the decoder. */
  table: Map<string, Operator>
  logical: { label: string; op: Operator }[]
}

const syndromeKey = (bits: readonly number[]): string => bits.join('')

const measure = (prepared: Prepared, error: Operator): number[] =>
  prepared.stabilisers.map((one) => anticommutes(one, error))

/** Bit `at` of the 2n-bit symplectic vector: the X part, then the Z part. */
const bitAt = (one: Operator, at: number, qubits: number): number => (at < qubits ? one.x[at] : one.z[at - qubits])

const firstSet = (one: Operator, qubits: number): number => {
  for (let at = 0; at < 2 * qubits; at += 1) if (bitAt(one, at, qubits) === 1) return at
  return -1
}

/** Row-reduce the generators over GF(2), so group membership can be decided by elimination. */
function reduce(operators: readonly Operator[], qubits: number): { op: Operator; pivot: number }[] {
  const basis: { op: Operator; pivot: number }[] = []
  for (const original of operators) {
    let current: Operator = { x: [...original.x], z: [...original.z] }
    for (const one of basis) {
      if (bitAt(current, one.pivot, qubits) === 1) current = times(current, one.op)
    }
    const pivot = firstSet(current, qubits)
    if (pivot < 0) continue // a dependent generator adds nothing
    basis.push({ op: current, pivot })
  }
  return basis
}

/** Whether an operator lies in the stabiliser group — meaning it does nothing at all to the encoded state. */
export function inStabiliserGroup(prepared: Prepared, operator: Operator): boolean {
  const qubits = prepared.code.qubits
  let current: Operator = { x: [...operator.x], z: [...operator.z] }
  for (const one of prepared.basis) {
    if (bitAt(current, one.pivot, qubits) === 1) current = times(current, one.op)
  }
  return current.x.every((one) => one === 0) && current.z.every((one) => one === 0)
}

/**
 * Build the decoder: for every syndrome, the lowest-weight error that produces it.
 *
 * Enumerated weight by weight — nothing, then every single-qubit error, then every pair, and so on — so the first
 * error written for a syndrome is always a minimum-weight one. This is exactly what a minimum-weight decoder
 * computes, done by exhaustion because codes this small allow it.
 *
 * ## It must cover every syndrome, not merely the likely ones
 *
 * `n − k` independent generators give `2^(n−k)` possible syndromes, and every one of them can occur. A decoder
 * built only out of one- and two-qubit errors reaches 148 of Shor's 256, and on the other 108 it would hand back
 * "nothing is wrong" — silently correcting nothing while the data was corrupted. So the enumeration continues to
 * whatever weight it takes, and stops the moment every syndrome has an answer.
 */
function buildTable(prepared: Prepared, code: Code): Map<string, Operator> {
  const table = new Map<string, Operator>()
  const kinds: Pauli[] = ['X', 'Z', 'Y']
  const wanted = 2 ** prepared.basis.length

  const put = (error: Operator): void => {
    const key = syndromeKey(measure(prepared, error))
    if (!table.has(key)) table.set(key, error)
  }

  put(empty(code.qubits)) // the all-zero syndrome means do nothing

  // Every error of weight `weight`: choose the qubits, then choose a Pauli for each of them.
  const places: number[] = []
  const walk = (weight: number, from: number): void => {
    if (table.size >= wanted) return
    if (places.length === weight) {
      const assignments = 3 ** weight
      for (let one = 0; one < assignments; one += 1) {
        const error = empty(code.qubits)
        let rest = one
        for (const at of places) {
          const kind = kinds[rest % 3]
          rest = Math.floor(rest / 3)
          if (kind === 'X' || kind === 'Y') error.x[at] = 1
          if (kind === 'Z' || kind === 'Y') error.z[at] = 1
        }
        put(error)
      }
      return
    }
    for (let at = from; at < code.qubits; at += 1) {
      places.push(at)
      walk(weight, at + 1)
      places.pop()
      if (table.size >= wanted) return
    }
  }

  for (let weight = 1; weight <= code.qubits && table.size < wanted; weight += 1) walk(weight, 0)
  return table
}

export function prepare(code: Code): Prepared {
  const stabilisers = code.stabilisers.map(fromString)
  const prepared: Prepared = {
    code,
    stabilisers,
    basis: reduce(stabilisers, code.qubits),
    table: new Map(),
    logical: code.logical.map((one) => ({ label: one.label, op: fromString(one.on) }))
  }
  prepared.table = buildTable(prepared, code)
  return prepared
}

export interface Round {
  round: number
  /** What really went wrong, as a Pauli string. */
  error: string
  errorWeight: number
  /** What the stabilisers read: one bit each. */
  syndrome: readonly number[]
  /** What the decoder concluded. */
  guess: string
  /** Whether the encoded information came through untouched. */
  survived: boolean
  /** When it did not, which logical operator got applied — the thing that corrupted the data. */
  became: string | null
}

interface QecState {
  prepared: Prepared
  rounds: Round[]
  random: () => number
  t: number
  survived: number
  corrupted: number
  undetected: number
  errored: number
}

/** The error kinds a setting allows. Index 0 defers to the code's own `corrects`. */
export const KIND_SETS: readonly { label: string; kinds: readonly Pauli[] }[] = Object.freeze([
  { label: 'whatever the code is for', kinds: [] },
  { label: 'bit flips only', kinds: ['X'] },
  { label: 'phase flips only', kinds: ['Z'] },
  { label: 'all three kinds', kinds: ['X', 'Z', 'Y'] }
])

/** One round, start to finish. Exported so a test can check a specific error rather than wait for one. */
export function oneRound(prepared: Prepared, error: Operator, at: number): Round {
  const syndrome = measure(prepared, error)
  const guess = prepared.table.get(syndromeKey(syndrome)) ?? empty(prepared.code.qubits)
  const residual = times(error, guess)
  const survived = inStabiliserGroup(prepared, residual)
  let became: string | null = null
  if (!survived) {
    // Name the damage: the logical operators the residual anticommutes with are what got corrupted.
    const hit = prepared.logical.filter((one) => anticommutes(residual, one.op) === 1).map((one) => one.label)
    became = hit.length > 0 ? hit.join(' and ') : asString(residual)
  }
  return { round: at, error: asString(error), errorWeight: weightOf(error), syndrome, guess: asString(guess), survived, became }
}

export const errorFrom = (text: string): Operator => fromString(text)

export const errorCorrection: Simulation<QecState> = {
  id: 'error-correction',
  name: 'Quantum Error Correction',
  section: 'quantum',
  about: 'Stabiliser codes with real syndromes and an exact minimum-weight decoder — including the rounds where it guesses wrong.',
  controls: [
    { key: 'code', label: 'Code', unit: '', least: 0, most: CODES.length - 1, step: 1, initial: 4, about: 'Bit-flip, phase-flip, Shor nine, Steane seven, or the five-qubit perfect code.' },
    { key: 'errorKinds', label: 'Kinds of error', unit: '', least: 0, most: KIND_SETS.length - 1, step: 1, initial: 0, about: 'By default only the kinds the chosen code is actually for — a bit-flip code scored against phase errors is being marked on a job it never claimed. Widen it to watch exactly that happen.' },
    { key: 'errorRate', label: 'Chance of an error per qubit', unit: '', least: 0, most: 0.5, step: 0.005, initial: 0.03, about: 'Per qubit, per round. Below the threshold the code wins; above it, correcting makes things worse.' },
    { key: 'roundsPerSecond', label: 'Rounds per second', unit: '', least: 1, most: 50, step: 1, initial: 10, about: 'How often the syndrome is measured and the decoder runs.' },
    { key: 'seed', label: 'Seed', unit: '', least: 1, most: 9999, step: 1, initial: 1, about: 'The same seed gives exactly the same errors, so a failure can be looked at twice.' }
  ],
  readouts: [
    { key: 'rounds', label: 'Rounds', unit: '' },
    { key: 'survived', label: 'Came through', unit: '' },
    { key: 'corrupted', label: 'Data corrupted', unit: '' },
    { key: 'rate', label: 'Logical error rate', unit: '' },
    { key: 'physical', label: 'Physical error rate', unit: '' },
    { key: 'improvement', label: 'Better by at least', unit: '×' },
    { key: 'undetected', label: 'Errors nothing detected', unit: '' }
  ],
  start(values) {
    const code = CODES[Math.max(0, Math.min(CODES.length - 1, Math.round(values.code)))]
    return { prepared: prepare(code), rounds: [], random: randomFrom(values.seed), t: 0, survived: 0, corrupted: 0, undetected: 0, errored: 0 }
  },
  step(state, dt, values) {
    state.t += dt
    const code = state.prepared.code
    const pick = Math.max(0, Math.min(KIND_SETS.length - 1, Math.round(values.errorKinds)))
    const kinds = pick === 0 ? code.corrects : KIND_SETS[pick].kinds

    const due = Math.floor(state.t * values.roundsPerSecond) - state.rounds.length
    for (let one = 0; one < due && one < 20; one += 1) {
      // Each qubit independently gets an error, of a kind chosen evenly from those allowed.
      let error = empty(code.qubits)
      for (let qubit = 0; qubit < code.qubits; qubit += 1) {
        if (state.random() >= values.errorRate) continue
        const kind = kinds[Math.min(kinds.length - 1, Math.floor(state.random() * kinds.length))]
        const just = empty(code.qubits)
        if (kind === 'X' || kind === 'Y') just.x[qubit] = 1
        if (kind === 'Z' || kind === 'Y') just.z[qubit] = 1
        error = times(error, just)
      }

      const round = oneRound(state.prepared, error, state.rounds.length + 1)
      if (round.survived) state.survived += 1
      else state.corrupted += 1
      if (round.errorWeight > 0) {
        state.errored += 1
        if (round.syndrome.every((two) => two === 0)) state.undetected += 1
      }
      state.rounds.push(round)
      if (state.rounds.length > 400) state.rounds.shift()
    }
  },
  read(state, values) {
    const total = state.survived + state.corrupted
    const logical = total > 0 ? state.corrupted / total : 0
    return {
      rounds: total,
      survived: state.survived,
      corrupted: state.corrupted,
      rate: logical,
      physical: values.errorRate,
      // With no failures yet the true rate is neither zero nor infinity — it is below what one round in `total`
      // can measure. Reporting that bound keeps the number honest and keeps it finite, which matters: an infinity
      // here would make the runner call a perfectly working code diverged.
      improvement: logical > 0 ? values.errorRate / logical : total > 0 ? values.errorRate * total : 0,
      undetected: state.undetected,
      errored: state.errored
    }
  },
  paint(state): Scene {
    const code = state.prepared.code
    const last = state.rounds[state.rounds.length - 1]
    const shapes: Shape[] = []
    const wide = code.qubits * 1.3

    // The qubits, with whatever went wrong in the most recent round marked on them.
    for (let qubit = 0; qubit < code.qubits; qubit += 1) {
      const x = qubit * 1.3
      const letter = last ? last.error[qubit] : 'I'
      const hit = letter !== 'I' && letter !== undefined
      shapes.push({ kind: 'circle', at: [x, 0], radius: 0.35, fill: hit, tone: hit ? 'other' : undefined })
      shapes.push({ kind: 'text', at: [x, -0.78], text: `q${qubit + 1}`, size: 10, anchor: 'middle' })
      if (hit) shapes.push({ kind: 'text', at: [x, 0.62], text: letter, size: 12, anchor: 'middle', tone: 'other' })
    }

    // Each stabiliser written out letter by letter, lit when it fired.
    code.stabilisers.forEach((one, at) => {
      const y = -1.6 - at * 0.5
      const fired = last?.syndrome[at] === 1
      for (let qubit = 0; qubit < code.qubits; qubit += 1) {
        if (one[qubit] === 'I') continue
        shapes.push({ kind: 'text', at: [qubit * 1.3, y], text: one[qubit], size: 11, anchor: 'middle', tone: fired ? 'other' : 'faint' })
      }
      shapes.push({ kind: 'text', at: [wide + 0.1, y], text: `= ${last?.syndrome[at] ?? 0}`, size: 10, tone: fired ? 'other' : 'faint' })
    })

    // The recent rounds as a row of marks, so a run of corruptions is visible at a glance.
    const base = -1.6 - code.stabilisers.length * 0.5 - 0.7
    state.rounds.slice(-24).forEach((one, at) => {
      shapes.push({ kind: 'rect', at: [at * 0.42, base], width: 0.32, height: 0.32, fill: true, tone: one.survived ? undefined : 'other' })
    })

    return {
      view: [-1, base - 0.8, wide + 2.2, 1.3],
      shapes,
      about: last
        ? last.errorWeight === 0
          ? 'No error this round, and every stabiliser reads zero.'
          : `Error ${last.error} (weight ${last.errorWeight}) · syndrome ${last.syndrome.join('')} · decoder guessed ${last.guess} · ${
              last.survived ? 'the data came through' : `the data was corrupted: ${last.became}`
            }`
        : `${code.name}: ${code.about}`
    }
  },
  limits: [
    'The stabiliser formalism, not a full state vector. These codes live entirely inside it, so nothing about them is lost — but no superposition is tracked here, and this cannot show a state that is not a stabiliser state.',
    'The decoder is exact minimum weight, found by enumerating errors weight by weight until every syndrome has an answer. That is right for codes this small, and it is not how a surface-code decoder works at scale, where matching or belief propagation is used because exhaustion is impossible.',
    'Errors happen independently on each qubit. Real noise is correlated, and correlated noise defeats codes that handle independent noise comfortably.',
    'Measurement itself is taken as perfect. Faulty syndrome measurement is what makes fault tolerance genuinely hard, and it is not modelled here — a real decoder must repeat the measurement and decode in time as well as space.',
    'One round of errors then one correction, with nothing carried over. This measures the chance a round corrupts the data, not the lifetime of a stored qubit.'
  ]
}

export const QEC: readonly Simulation[] = Object.freeze([errorCorrection as Simulation])
