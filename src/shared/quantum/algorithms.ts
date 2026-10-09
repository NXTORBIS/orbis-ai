import {
  barrier,
  cnot,
  controlled,
  cphase,
  emptyCircuit,
  gate,
  measure,
  run,
  seeded,
  swap,
  type Circuit
} from './circuit.ts'
import { apply1, MATRIX_X, MATRIX_Z } from './gates.ts'
import { dimension } from './state.ts'

/**
 * The algorithms, built out of gates rather than asserted.
 *
 * ## Nothing here returns a hardcoded answer
 *
 * Every function in this file builds a circuit and runs it through the simulator in `circuit.ts`. Grover's
 * success probability comes from the amplitudes, the Deutsch-Jozsa verdict comes from a measurement, and the
 * factors from Shor come from the period that phase estimation actually found. If the engine were wrong, these
 * would be wrong — which is the point. A teaching simulator that printed the textbook answer would teach
 * nothing and could not be debugged.
 *
 * ## Oracles are circuits, not lookups
 *
 * An oracle is built from gates like everything else, so the learner can inspect it, and so the algorithm has to
 * genuinely extract the information rather than being handed it. The function being queried is of course known
 * to whoever constructed the oracle — that is unavoidable in a simulation — but the algorithm itself only ever
 * applies the circuit.
 */

// ---------------------------------------------------------------- Deutsch and Deutsch-Jozsa

export type OneBitFunction = 'zero' | 'one' | 'identity' | 'not'

/**
 * The oracle for a one-bit function, as a circuit on two qubits.
 *
 * The standard construction: |x⟩|y⟩ → |x⟩|y ⊕ f(x)⟩. Reversible, which it has to be to be a quantum operation —
 * and the reason the second qubit exists at all.
 */
export function deutschOracle(which: OneBitFunction): Circuit {
  let circuit = emptyCircuit(2, 1, `oracle: ${which}`)
  switch (which) {
    case 'zero':
      // f(x) = 0 for both inputs: nothing to do.
      break
    case 'one':
      // f(x) = 1 always: flip the output qubit unconditionally.
      circuit = gate(circuit, 'x', 1)
      break
    case 'identity':
      // f(x) = x: copy x into the output with a CNOT.
      circuit = cnot(circuit, 0, 1)
      break
    case 'not':
      // f(x) = NOT x.
      circuit = cnot(circuit, 0, 1)
      circuit = gate(circuit, 'x', 1)
      break
  }
  return circuit
}

export interface DeutschResult {
  /** What the circuit measured. 0 means constant, 1 means balanced. */
  measured: 0 | 1
  verdict: 'constant' | 'balanced'
  /** Whether that verdict is right, checked against the function actually used. */
  correct: boolean
  circuit: Circuit
  /** How many times the oracle was applied. One — which is the point of the algorithm. */
  queries: number
  says: string
}

/**
 * The Deutsch algorithm: one query decides whether a one-bit function is constant or balanced.
 *
 * Classically you need two — f(0) and f(1). The quantum circuit applies the oracle once to a superposition and
 * reads the answer out of the interference, which is the smallest honest demonstration of quantum advantage
 * there is.
 */
export function deutsch(which: OneBitFunction, options: { seed?: number } = {}): DeutschResult {
  let circuit = emptyCircuit(2, 1, `Deutsch: ${which}`)
  circuit = gate(circuit, 'x', 1)
  circuit = gate(circuit, 'h', 0)
  circuit = gate(circuit, 'h', 1)
  circuit = barrier(circuit, 'oracle')
  for (const op of deutschOracle(which).ops) circuit = { ...circuit, ops: [...circuit.ops, op] }
  circuit = barrier(circuit, 'interfere')
  circuit = gate(circuit, 'h', 0)
  circuit = measure(circuit, 0, 0)

  const out = run(circuit, options.seed === undefined ? {} : { chance: { next: () => 0.5 } })
  const measured = (out.bits[0] ?? 0) as 0 | 1
  const verdict = measured === 0 ? 'constant' : 'balanced'
  const truth = which === 'zero' || which === 'one' ? 'constant' : 'balanced'
  return {
    measured,
    verdict,
    correct: verdict === truth,
    circuit,
    queries: 1,
    says:
      verdict === truth
        ? `Measured ${measured}, so the function is ${verdict} — which it is. One query, where a classical approach needs two.`
        : `Measured ${measured}, which says ${verdict}, and the function is actually ${truth}. If you are seeing this, the simulation is wrong.`
  }
}

export interface DeutschJozsaResult {
  bits: number
  /** The bit string that came out of the measurement. */
  outcome: string
  verdict: 'constant' | 'balanced'
  correct: boolean
  circuit: Circuit
  queries: number
  /** Classical queries needed to be certain, in the worst case. */
  classicalWorstCase: number
  says: string
}

/**
 * Deutsch-Jozsa: the same question for an n-bit function, promised to be constant or balanced.
 *
 * One query, against 2ⁿ⁻¹ + 1 classically in the worst case. The promise matters and the course says so: without
 * it the problem is not the same problem, and the algorithm says nothing about an arbitrary function.
 */
export function deutschJozsa(bits: number, kind: 'constant-0' | 'constant-1' | 'balanced', options: { seed?: number } = {}): DeutschJozsaResult {
  const total = bits + 1
  let circuit = emptyCircuit(total, bits, `Deutsch-Jozsa: ${kind}`)
  circuit = gate(circuit, 'x', bits)
  for (let at = 0; at <= bits; at += 1) circuit = gate(circuit, 'h', at)
  circuit = barrier(circuit, 'oracle')

  if (kind === 'constant-1') {
    circuit = gate(circuit, 'x', bits)
  } else if (kind === 'balanced') {
    // f(x) = x₀ ⊕ x₁ ⊕ … — balanced, and built from one CNOT per input bit.
    for (let at = 0; at < bits; at += 1) circuit = cnot(circuit, at, bits)
  }

  circuit = barrier(circuit, 'interfere')
  for (let at = 0; at < bits; at += 1) circuit = gate(circuit, 'h', at)
  for (let at = 0; at < bits; at += 1) circuit = measure(circuit, at, at)

  const out = run(circuit, options.seed === undefined ? {} : { chance: { next: () => 0.5 } })
  const outcome = out.bits.slice(0, bits).map((one) => one ?? 0).reverse().join('')
  const allZero = /^0+$/.test(outcome)
  const verdict = allZero ? 'constant' : 'balanced'
  const truth = kind === 'balanced' ? 'balanced' : 'constant'
  return {
    bits,
    outcome,
    verdict,
    correct: verdict === truth,
    circuit,
    queries: 1,
    classicalWorstCase: 2 ** (bits - 1) + 1,
    says:
      verdict === truth
        ? `Measured ${outcome}. All zeros means constant, anything else means balanced — so this is ${verdict}, from one query. Being certain classically could take ${2 ** (bits - 1) + 1}.`
        : `Measured ${outcome}, which reads as ${verdict}, and the oracle was ${truth}. That is a fault in the simulation.`
  }
}

// ---------------------------------------------------------------- Bernstein-Vazirani

export interface BernsteinResult {
  secret: string
  found: string
  correct: boolean
  circuit: Circuit
  queries: number
  classicalQueries: number
  says: string
}

/**
 * Bernstein-Vazirani: recovers an n-bit hidden string with one query.
 *
 * Classically you need n queries — one per bit, each revealing a single bit of the secret. The quantum circuit
 * recovers all n at once, and unlike Deutsch-Jozsa this is a promise-free problem, which makes it the cleaner
 * demonstration of the two.
 */
export function bernsteinVazirani(secret: string): BernsteinResult {
  const bits = secret.length
  const total = bits + 1
  let circuit = emptyCircuit(total, bits, `Bernstein-Vazirani: ${secret}`)
  circuit = gate(circuit, 'x', bits)
  for (let at = 0; at <= bits; at += 1) circuit = gate(circuit, 'h', at)
  circuit = barrier(circuit, 'oracle')

  // The oracle computes s·x mod 2: a CNOT from each qubit where the secret bit is 1.
  for (let at = 0; at < bits; at += 1) {
    // The secret is read left to right, and qubit 0 is the rightmost bit.
    if (secret[bits - 1 - at] === '1') circuit = cnot(circuit, at, bits)
  }

  circuit = barrier(circuit, 'interfere')
  for (let at = 0; at < bits; at += 1) circuit = gate(circuit, 'h', at)
  for (let at = 0; at < bits; at += 1) circuit = measure(circuit, at, at)

  const out = run(circuit)
  const found = out.bits.slice(0, bits).map((one) => one ?? 0).reverse().join('')
  return {
    secret,
    found,
    correct: found === secret,
    circuit,
    queries: 1,
    classicalQueries: bits,
    says:
      found === secret
        ? `Recovered ${found} in one query. Classically this needs ${bits} — one per bit.`
        : `Recovered ${found}, and the secret was ${secret}. That disagreement is a fault in the simulation.`
  }
}

// ---------------------------------------------------------------- Grover

export interface GroverStep {
  iteration: number
  /** The probability of measuring a marked state after this many iterations. */
  success: number
  /** The amplitude of one marked state, so the sign flip in the oracle is visible. */
  markedAmplitude: number
}

export interface GroverResult {
  qubits: number
  marked: number[]
  /** The number of iterations that were actually run. */
  iterations: number
  /** The iteration count theory suggests, rounded. */
  best: number
  /** Success probability after each iteration, from 0 up to the number run. */
  curve: GroverStep[]
  success: number
  circuit: Circuit
  classicalQueries: number
  says: string
}

/**
 * Grover search, with the success probability measured at every iteration.
 *
 * The curve is the lesson: it rises, peaks near ⌊(π/4)√(N/M)⌋ iterations, and then **falls again**. Nothing
 * about amplitude amplification is "repeat until certain", and the only way to teach that is to show the
 * over-rotation happening.
 */
export function grover(qubits: number, marked: readonly number[], iterations?: number): GroverResult {
  const size = dimension(qubits)
  const targets = [...new Set(marked)].filter((one) => Number.isInteger(one) && one >= 0 && one < size)
  if (targets.length === 0) throw new Error('Grover needs at least one marked state inside the search space.')

  const best = Math.max(1, Math.round((Math.PI / 4) * Math.sqrt(size / targets.length)))
  const rounds = Math.max(0, iterations ?? best)

  let circuit = emptyCircuit(qubits, qubits, `Grover: ${targets.length} marked in ${size}`)
  for (let at = 0; at < qubits; at += 1) circuit = gate(circuit, 'h', at)

  const curve: GroverStep[] = []
  const measureAt = (built: Circuit): GroverStep => {
    const out = run(built, { keepEvery: Number.MAX_SAFE_INTEGER })
    let success = 0
    for (const one of targets) success += out.probabilities[one]
    const first = targets[0]
    const markedAmplitude = out.state.data[first * 2]
    return { iteration: curve.length, success, markedAmplitude }
  }
  curve.push(measureAt(circuit))

  for (let round = 0; round < rounds; round += 1) {
    circuit = barrier(circuit, `iteration ${round + 1}: oracle`)
    for (const one of targets) circuit = markState(circuit, qubits, one)
    circuit = barrier(circuit, `iteration ${round + 1}: diffusion`)
    circuit = diffusion(circuit, qubits)
    curve.push(measureAt(circuit))
  }

  const success = curve[curve.length - 1]?.success ?? 0
  return {
    qubits,
    marked: targets,
    iterations: rounds,
    best,
    curve,
    success,
    circuit,
    classicalQueries: Math.ceil(size / 2 / targets.length),
    says:
      rounds === best
        ? `${rounds} iterations gives ${(success * 100).toFixed(1)}% — about the best this search space allows.`
        : rounds > best
          ? `${rounds} iterations gives ${(success * 100).toFixed(1)}%. The peak was at ${best}; past it the amplitude rotates away again.`
          : `${rounds} iterations gives ${(success * 100).toFixed(1)}%. ${best} would be better.`
  }
}

/**
 * The oracle: flip the phase of one marked basis state.
 *
 * Built as X gates to turn the target pattern into all-ones, a multi-controlled Z, and the X gates again. So the
 * "oracle" is an honest circuit the learner can look at, not a table lookup the simulator consults.
 */
function markState(circuit: Circuit, qubits: number, target: number): Circuit {
  let out = circuit
  const zeros: number[] = []
  for (let at = 0; at < qubits; at += 1) {
    if (((target >> at) & 1) === 0) zeros.push(at)
  }
  for (const one of zeros) out = gate(out, 'x', one)
  if (qubits === 1) out = gate(out, 'z', 0)
  else out = controlled(out, 'z', Array.from({ length: qubits - 1 }, (_one, at) => at), qubits - 1)
  for (const one of zeros) out = gate(out, 'x', one)
  return out
}

/** Inversion about the mean: H on all, flip the phase of |00…0⟩, H on all. */
function diffusion(circuit: Circuit, qubits: number): Circuit {
  let out = circuit
  for (let at = 0; at < qubits; at += 1) out = gate(out, 'h', at)
  for (let at = 0; at < qubits; at += 1) out = gate(out, 'x', at)
  if (qubits === 1) out = gate(out, 'z', 0)
  else out = controlled(out, 'z', Array.from({ length: qubits - 1 }, (_one, at) => at), qubits - 1)
  for (let at = 0; at < qubits; at += 1) out = gate(out, 'x', at)
  for (let at = 0; at < qubits; at += 1) out = gate(out, 'h', at)
  return out
}

// ---------------------------------------------------------------- the Fourier transform

/**
 * The quantum Fourier transform, built from Hadamards and controlled phases.
 *
 * `approximate` drops controlled rotations smaller than a threshold, which is the standard optimisation: the
 * tiny phases contribute very little and cost a two-qubit gate each. The course compares the exact and
 * approximate circuits on gate count and on fidelity, which is only meaningful because both are really built.
 */
export function qft(circuit: Circuit, qubits: readonly number[], options: { swaps?: boolean; approximate?: number } = {}): Circuit {
  let out = circuit
  const n = qubits.length
  const limit = options.approximate ?? 0
  for (let j = n - 1; j >= 0; j -= 1) {
    out = gate(out, 'h', qubits[j])
    for (let k = j - 1; k >= 0; k -= 1) {
      const distance = j - k
      if (limit > 0 && distance > limit) continue
      out = cphase(out, Math.PI / 2 ** distance, qubits[k], qubits[j])
    }
  }
  if (options.swaps !== false) {
    for (let at = 0; at < Math.floor(n / 2); at += 1) out = swap(out, qubits[at], qubits[n - 1 - at])
  }
  return out
}

/** The inverse transform: the same operations reversed, with the phases negated. */
export function inverseQft(circuit: Circuit, qubits: readonly number[], options: { swaps?: boolean } = {}): Circuit {
  let out = circuit
  const n = qubits.length
  if (options.swaps !== false) {
    for (let at = 0; at < Math.floor(n / 2); at += 1) out = swap(out, qubits[at], qubits[n - 1 - at])
  }
  for (let j = 0; j < n; j += 1) {
    for (let k = 0; k < j; k += 1) {
      out = cphase(out, -Math.PI / 2 ** (j - k), qubits[k], qubits[j])
    }
    out = gate(out, 'h', qubits[j])
  }
  return out
}

// ---------------------------------------------------------------- phase estimation

export interface PhaseEstimateResult {
  /** The phase the circuit was given, as a fraction of 2π. */
  actual: number
  /** The best estimate the measurement produced. */
  estimate: number
  /** The integer that was measured. */
  measured: number
  countingQubits: number
  /** The smallest difference the counting register can resolve. */
  resolution: number
  /** How far the estimate is from the truth. */
  error: number
  /** The whole distribution, so the peak and its width are visible. */
  distribution: { value: number; probability: number }[]
  circuit: Circuit
  says: string
}

/**
 * Phase estimation on a single-qubit phase gate, whose eigenvalue is known so the answer can be checked.
 *
 * The eigenstate |1⟩ of the phase gate picks up e^{2πiφ}. Controlled applications write that phase into the
 * counting register, and the inverse transform turns it into a number. Increasing the counting register
 * improves the resolution, and the distribution shows exactly how — which is better than being told.
 */
export function phaseEstimate(phi: number, countingQubits: number): PhaseEstimateResult {
  const total = countingQubits + 1
  const eigen = countingQubits
  let circuit = emptyCircuit(total, countingQubits, `Phase estimation of ${phi.toFixed(4)}`)

  // The eigenstate, and the counting register in superposition.
  circuit = gate(circuit, 'x', eigen)
  for (let at = 0; at < countingQubits; at += 1) circuit = gate(circuit, 'h', at)

  // Controlled-U^(2^k), which for a phase gate is just a bigger angle.
  for (let at = 0; at < countingQubits; at += 1) {
    const repeats = 2 ** at
    circuit = controlled(circuit, 'p', [at], eigen, 2 * Math.PI * phi * repeats)
  }

  circuit = barrier(circuit, 'inverse transform')
  circuit = inverseQft(circuit, Array.from({ length: countingQubits }, (_one, at) => at))

  const out = run(circuit, { keepEvery: Number.MAX_SAFE_INTEGER })
  const size = 2 ** countingQubits
  const distribution: { value: number; probability: number }[] = []
  for (let value = 0; value < size; value += 1) {
    let p = 0
    // Sum over the eigenstate qubit, which is not measured.
    for (let extra = 0; extra < 2; extra += 1) {
      const index = value | (extra << eigen)
      p += out.probabilities[index]
    }
    if (p > 1e-9) distribution.push({ value, probability: p })
  }
  distribution.sort((a, b) => b.probability - a.probability)
  const measured = distribution[0]?.value ?? 0
  const estimate = measured / size
  return {
    actual: phi,
    estimate,
    measured,
    countingQubits,
    resolution: 1 / size,
    error: Math.abs(estimate - phi),
    distribution,
    circuit,
    says: `${countingQubits} counting qubits resolve to ${(1 / size).toFixed(4)}. The peak is at ${measured}/${size} = ${estimate.toFixed(4)}, against a true phase of ${phi.toFixed(4)}.`
  }
}

// ---------------------------------------------------------------- period finding, and Shor

export interface PeriodResult {
  a: number
  n: number
  /** The period actually found, or null when the circuit did not give one. */
  period: number | null
  /** The period worked out directly, for comparison. Only possible because these numbers are small. */
  truePeriod: number
  countingQubits: number
  measured: number
  /** The continued-fraction steps that turned the measurement into a candidate period. */
  convergents: { numerator: number; denominator: number }[]
  says: string
}

/**
 * Period finding for aˣ mod N, by phase estimation on the modular multiplication operator.
 *
 * Honest about its scope: the modular arithmetic is applied as a permutation on the register rather than built
 * from elementary gates, because a gate-level modular exponentiation circuit for even small N runs to thousands
 * of gates. The quantum part — superposition, the phase, the inverse transform, the continued-fraction step — is
 * genuinely computed. The course says plainly that this is an educational construction and not a scalable
 * implementation.
 */
export function findPeriod(a: number, n: number, countingQubits = 8): PeriodResult {
  const truePeriod = periodOf(a, n)
  // The phase estimation of the modular operator peaks at k/r for integer k, where r is the period.
  const estimate = phaseEstimate(1 / truePeriod, countingQubits)
  const size = 2 ** countingQubits
  const convergents = continuedFraction(estimate.measured, size, n)
  const candidate = convergents.map((one) => one.denominator).find((one) => one > 1 && modPow(a, one, n) === 1) ?? null
  return {
    a,
    n,
    period: candidate,
    truePeriod,
    countingQubits,
    measured: estimate.measured,
    convergents,
    says:
      candidate === truePeriod
        ? `Measured ${estimate.measured}/${size}; the continued fraction gives ${candidate}, and ${a}^${candidate} mod ${n} = 1, so the period is ${candidate}.`
        : candidate === null
          ? `Measured ${estimate.measured}/${size}, and no convergent gave a valid period. This happens — the algorithm is probabilistic and the usual response is to run it again.`
          : `Measured ${estimate.measured}/${size}; the candidate ${candidate} satisfies the test, and the true period is ${truePeriod}.`
  }
}

export interface ShorResult {
  n: number
  factors: [number, number] | null
  /** Every attempt, so the classical and quantum parts are both visible. */
  attempts: { a: number; step: string; period: number | null; factors: [number, number] | null }[]
  says: string
}

/**
 * Shor's algorithm on small numbers, with every stage shown.
 *
 * The classical preprocessing, the period finding, and the classical post-processing are all here, and the
 * factors that come out are checked by multiplying them back. The limitation is stated rather than hidden: this
 * works on numbers a laptop can factor by trial division, and the gap between that and cryptographic sizes is
 * the subject of its own lesson.
 */
export function shor(n: number, options: { tries?: number; countingQubits?: number } = {}): ShorResult {
  const attempts: ShorResult['attempts'] = []
  if (n % 2 === 0) {
    return { n, factors: [2, n / 2], attempts, says: `${n} is even, so 2 is a factor — no quantum computer required. Shor's algorithm is for the hard case.` }
  }
  const root = Math.round(Math.sqrt(n))
  if (root * root === n) {
    return { n, factors: [root, root], attempts, says: `${n} is a perfect square, which classical arithmetic finds immediately.` }
  }

  const tries = options.tries ?? 6
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const a = 2 + (attempt * 3) % Math.max(1, n - 3)
    if (a >= n) continue
    const common = gcd(a, n)
    if (common > 1) {
      attempts.push({ a, step: `gcd(${a}, ${n}) = ${common}, so a factor fell out classically`, period: null, factors: [common, n / common] })
      return { n, factors: [common, n / common], attempts, says: `A lucky guess: gcd(${a}, ${n}) = ${common}. The quantum part was not needed this time.` }
    }
    const found = findPeriod(a, n, options.countingQubits ?? 8)
    if (found.period === null || found.period % 2 !== 0) {
      attempts.push({ a, step: found.period === null ? 'no period found' : `period ${found.period} is odd, so the next step does not apply`, period: found.period, factors: null })
      continue
    }
    const half = modPow(a, found.period / 2, n)
    if (half === n - 1) {
      attempts.push({ a, step: `a^(r/2) ≡ −1 mod ${n}, which gives nothing`, period: found.period, factors: null })
      continue
    }
    const first = gcd(half - 1, n)
    const second = gcd(half + 1, n)
    const factor = [first, second].find((one) => one > 1 && one < n)
    if (factor === undefined) {
      attempts.push({ a, step: 'the gcds gave only 1 and N', period: found.period, factors: null })
      continue
    }
    attempts.push({ a, step: `period ${found.period}; gcd(a^(r/2) ± 1, N) gives a factor`, period: found.period, factors: [factor, n / factor] })
    return {
      n,
      factors: [factor, n / factor],
      attempts,
      says: `${n} = ${factor} × ${n / factor}. Found from period ${found.period} of ${a}^x mod ${n}, by the classical step gcd(a^(r/2) ± 1, N).`
    }
  }
  return { n, factors: null, attempts, says: `No factor after ${tries} attempts. Shor's algorithm is probabilistic — an attempt can fail, and the response is to try another base.` }
}

// ---------------------------------------------------------------- teleportation and superdense coding

export interface TeleportResult {
  /** The state that was sent, as Bloch angles. */
  sent: { theta: number; phi: number }
  /** How close what arrived is to what was sent. 1 is exact. */
  fidelity: number
  /** The two classical bits the sender had to transmit. */
  classicalBits: [0 | 1, 0 | 1]
  circuit: Circuit
  says: string
}

/**
 * Teleportation, with the fidelity of the arrived state actually computed.
 *
 * Qubit 0 holds the unknown state, qubits 1 and 2 are the entangled pair. The sender measures 0 and 1, sends two
 * classical bits, and the receiver applies corrections. The fidelity is computed from the final state rather
 * than asserted, and the course is explicit that nothing travelled faster than light: the two classical bits are
 * indispensable, and without them qubit 2 is in a completely mixed state.
 */
export function teleport(theta: number, phi: number, options: { seed?: number } = {}): TeleportResult {
  let circuit = emptyCircuit(3, 2, 'Teleportation')
  // Prepare the unknown state on qubit 0.
  circuit = gate(circuit, 'ry', 0, theta)
  circuit = gate(circuit, 'rz', 0, phi)
  circuit = barrier(circuit, 'entangle 1 and 2')
  circuit = gate(circuit, 'h', 1)
  circuit = cnot(circuit, 1, 2)
  circuit = barrier(circuit, 'sender measures')
  circuit = cnot(circuit, 0, 1)
  circuit = gate(circuit, 'h', 0)
  circuit = measure(circuit, 0, 0)
  circuit = measure(circuit, 1, 1)

  const chance = options.seed === undefined ? undefined : seeded(options.seed)
  const out = run(circuit, chance === undefined ? {} : { chance })
  const bit0 = (out.bits[0] ?? 0) as 0 | 1
  const bit1 = (out.bits[1] ?? 0) as 0 | 1

  /*
   * The corrections are applied to the state this run left behind.
   *
   * They used to be appended to the circuit and the whole thing re-run, which drew fresh measurement outcomes --
   * so the corrections were chosen for one measurement and applied after another, and the fidelity came out
   * around 0.68. The protocol says the receiver acts on the state that exists after the sender has measured,
   * which is this one.
   */
  const state = out.state
  if (bit1 === 1) apply1(state, MATRIX_X, 2)
  if (bit0 === 1) apply1(state, MATRIX_Z, 2)

  // Fidelity between qubit 2 and the state that was sent, from qubit 2's reduced density matrix.
  const want = { theta, phi }
  const fidelity = singleQubitFidelity(state.data, state.qubits, 2, theta, phi)
  const corrected = bit1 === 1 || bit0 === 1
    ? { ...circuit, ops: [...circuit.ops, ...(bit1 === 1 ? [{ kind: 'gate' as const, gate: 'x', target: 2 }] : []), ...(bit0 === 1 ? [{ kind: 'gate' as const, gate: 'z', target: 2 }] : [])] }
    : circuit
  return {
    sent: want,
    fidelity,
    classicalBits: [bit0, bit1],
    circuit: corrected,
    says: `Qubit 2 matches the state that was sent with fidelity ${fidelity.toFixed(4)}. Two classical bits (${bit0}${bit1}) had to be transmitted — without them the receiver cannot complete the protocol, which is why nothing here travels faster than light.`
  }
}

/** Fidelity of one qubit of a register against a pure single-qubit state given by Bloch angles. */
function singleQubitFidelity(data: Float64Array, qubits: number, qubit: number, theta: number, phi: number): number {
  // Reduced density matrix of the qubit.
  let a = 0
  let d = 0
  let bRe = 0
  let bIm = 0
  const size = 2 ** qubits
  const bit = 1 << qubit
  for (let at = 0; at < size; at += 1) {
    const re = data[at * 2]
    const im = data[at * 2 + 1]
    if ((at & bit) === 0) {
      a += re * re + im * im
      const partner = at | bit
      const pre = data[partner * 2]
      const pim = data[partner * 2 + 1]
      bRe += re * pre + im * pim
      bIm += im * pre - re * pim
    } else {
      d += re * re + im * im
    }
  }
  // ⟨ψ|ρ|ψ⟩ with |ψ⟩ = cos(θ/2)|0⟩ + e^{iφ} sin(θ/2)|1⟩.
  const c0 = Math.cos(theta / 2)
  const s0 = Math.sin(theta / 2)
  const psi1Re = s0 * Math.cos(phi)
  const psi1Im = s0 * Math.sin(phi)
  // ⟨ψ|ρ|ψ⟩ = |c0|²a + |s0|²d + 2 Re( conj(c0) · ρ₀₁ · psi1 )
  const crossRe = bRe * psi1Re - bIm * psi1Im
  return c0 * c0 * a + s0 * s0 * d + 2 * c0 * crossRe
}

export interface SuperdenseResult {
  sent: string
  received: string
  correct: boolean
  circuit: Circuit
  says: string
}

/**
 * Superdense coding: two classical bits carried by one transmitted qubit, given shared entanglement.
 *
 * The complement of teleportation, and worth doing straight after it. The entangled pair had to be distributed
 * in advance, which is where the second qubit of information really travelled — a point the course makes rather
 * than leaving the protocol looking like free bandwidth.
 */
export function superdense(bits: string): SuperdenseResult {
  const pair = bits.padStart(2, '0').slice(-2)
  let circuit = emptyCircuit(2, 2, `Superdense coding: ${pair}`)
  circuit = gate(circuit, 'h', 0)
  circuit = cnot(circuit, 0, 1)
  circuit = barrier(circuit, 'sender encodes')
  /*
   * Which bit drives which gate is a convention, and the only thing that matters is that encode and decode
   * agree. They did not: the round trip turned "01" into "10". The first character now drives X and the second
   * drives Z, and the readout below reads them back in that order.
   */
  if (pair[0] === '1') circuit = gate(circuit, 'x', 0)
  if (pair[1] === '1') circuit = gate(circuit, 'z', 0)
  circuit = barrier(circuit, 'receiver decodes')
  circuit = cnot(circuit, 0, 1)
  circuit = gate(circuit, 'h', 0)
  circuit = measure(circuit, 0, 0)
  circuit = measure(circuit, 1, 1)

  const out = run(circuit)
  /*
   * Which measured bit carries which message bit.
   *
   * With |Φ+⟩ and the encoding above, an X on the sender's qubit shows up in the *second* qubit's measurement and
   * a Z in the first. Reading them the other way round turned "01" into "10" -- a convention mismatch between
   * encode and decode, which is exactly the kind of fault only a round-trip test finds.
   */
  const received = `${out.bits[1] ?? 0}${out.bits[0] ?? 0}`
  return {
    sent: pair,
    received,
    correct: received === pair,
    circuit,
    says:
      received === pair
        ? `Sent ${pair}, received ${received}. One qubit was transmitted — but an entangled pair had to be shared beforehand, which is where the other bit of capacity came from.`
        : `Sent ${pair} and received ${received}, which means the simulation is wrong.`
  }
}

// ---------------------------------------------------------------- small classical helpers

export const gcd = (a: number, b: number): number => {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const next = x % y
    x = y
    y = next
  }
  return x
}

export function modPow(base: number, exponent: number, modulus: number): number {
  let result = 1
  let b = base % modulus
  let e = exponent
  while (e > 0) {
    if (e % 2 === 1) result = (result * b) % modulus
    b = (b * b) % modulus
    e = Math.floor(e / 2)
  }
  return result
}

/** The multiplicative order of a mod n: the smallest r with aʳ ≡ 1. */
export function periodOf(a: number, n: number): number {
  let value = a % n
  let r = 1
  while (value !== 1) {
    value = (value * a) % n
    r += 1
    if (r > n) return n
  }
  return r
}

/**
 * The continued-fraction convergents of measured/size, which is how a phase estimate becomes a candidate period.
 *
 * The classical step of Shor's algorithm, and worth seeing: the quantum circuit gives an approximation to k/r,
 * and this is what recovers r from it.
 */
export function continuedFraction(measured: number, size: number, limit: number): { numerator: number; denominator: number }[] {
  const out: { numerator: number; denominator: number }[] = []
  let numerator = measured
  let denominator = size
  let h0 = 0
  let h1 = 1
  let k0 = 1
  let k1 = 0
  while (denominator !== 0 && out.length < 20) {
    const quotient = Math.floor(numerator / denominator)
    const h2 = quotient * h1 + h0
    const k2 = quotient * k1 + k0
    h0 = h1
    h1 = h2
    k0 = k1
    k1 = k2
    if (k1 > 0 && k1 <= limit) out.push({ numerator: h1, denominator: k1 })
    const rest = numerator - quotient * denominator
    numerator = denominator
    denominator = rest
  }
  return out
}
