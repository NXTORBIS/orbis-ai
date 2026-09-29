/**
 * Circuits: a graph of components, solved rather than drawn.
 *
 * The shared circuit engine for Orbis Pages. A circuit here is nodes and edges with equations attached, and every
 * voltage and current a Page shows came out of a linear system that was actually assembled and actually solved.
 * Nothing is a decorative SVG line with a number printed beside it.
 *
 * ## Nodal analysis, and why the reference node is not arbitrary
 *
 * Kirchhoff's current law at every node gives one equation per node, and those equations are not independent:
 * current that leaves one node arrives at another, so summing them all gives 0 = 0. One node has to be fixed to
 * make the system solvable, and grounding it is that choice. It is not a physical claim about where zero volts is
 * — every voltage in the answer is a difference, and moving the ground moves them all together.
 *
 * ## Why a shorted ideal source is refused rather than answered
 *
 * `V = IR` with R = 0 and V ≠ 0 asks for infinite current. The matrix goes singular and any number that comes out
 * of it is numerical noise. Reporting 4.7×10¹⁷ amps as though it were a result is worse than refusing, so the
 * solver detects the singularity and says what caused it.
 *
 * ## AC is the same solver over complex numbers
 *
 * A resistor is R, an inductor is jωL, a capacitor is 1/(jωC). Once impedance replaces resistance the DC nodal
 * equations are unchanged, which is why this file has one solver rather than two — and why the phase information
 * is real output rather than an afterthought bolted on.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * resistance vs impedance      -- one is a number, the other has a phase and depends on frequency
 * emf        vs terminal voltage -- what a source would give against what it gives under load
 * power factor vs efficiency   -- the phase between V and I against energy in versus out
 * real power vs apparent power -- watts that do work against volt-amps the wiring still has to carry
 * time constant vs period      -- how fast a transient decays against how fast a drive repeats
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface CircuitError {
  error:
    | 'invalid-argument'
    | 'not-finite'
    | 'too-many'
    | 'no-ground'
    | 'floating-node'
    | 'singular'
    | 'short-circuit'
    | 'unknown-node'
    | 'no-components'
    | 'conflicting-sources'
  message: string
  /** Which components or nodes caused it, when the solver can say. */
  involves?: readonly string[]
}

export const isCircuitError = (value: unknown): value is CircuitError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: CircuitError['error'], message: string, involves?: readonly string[]): CircuitError =>
  involves ? { error, message, involves } : { error, message }

const finite = (value: number): boolean => Number.isFinite(value)

export const CIRCUIT_LIMITS = Object.freeze({
  components: 400,
  nodes: 200,
  sweepPoints: 4000,
  traceSamples: 4000
})

// ---------------------------------------------------------------- complex arithmetic

export interface Complex {
  re: number
  im: number
}

export const complex = (re: number, im = 0): Complex => ({ re, im })

const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im })
const sub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im })
const mul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re
})
const div = (a: Complex, b: Complex): Complex => {
  const denominator = b.re * b.re + b.im * b.im
  if (denominator === 0) return { re: Number.NaN, im: Number.NaN }
  return {
    re: (a.re * b.re + a.im * b.im) / denominator,
    im: (a.im * b.re - a.re * b.im) / denominator
  }
}
const magnitude = (a: Complex): number => Math.hypot(a.re, a.im)
/** Radians. */
const phase = (a: Complex): number => Math.atan2(a.im, a.re)

/** A complex value in the form a Page can show: rectangular and polar at once. */
export interface Phasor {
  re: number
  im: number
  magnitude: number
  /** Radians. */
  phase: number
  /** The same phase in degrees, because every textbook and every instrument uses degrees. */
  phaseDegrees: number
}

const phasor = (value: Complex): Phasor => ({
  re: value.re,
  im: value.im,
  magnitude: magnitude(value),
  phase: phase(value),
  phaseDegrees: (phase(value) * 180) / Math.PI
})

// ---------------------------------------------------------------- the circuit

export type ComponentKind =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'voltage-source'
  | 'current-source'
  | 'wire'
  | 'switch'

export const COMPONENT_KINDS: readonly ComponentKind[] = Object.freeze([
  'resistor',
  'capacitor',
  'inductor',
  'voltage-source',
  'current-source',
  'wire',
  'switch'
])

export const COMPONENT_FACTS: Readonly<
  Record<ComponentKind, { label: string; unit: string; dcBehaviour: string }>
> = Object.freeze({
  resistor: { label: 'Resistor', unit: 'ohm', dcBehaviour: 'Obeys V = IR at every frequency, including zero.' },
  capacitor: {
    label: 'Capacitor',
    unit: 'F',
    dcBehaviour: 'An open circuit once it is charged. No steady current flows through a capacitor.'
  },
  inductor: {
    label: 'Inductor',
    unit: 'H',
    dcBehaviour: 'A short circuit once the current is steady. An ideal inductor drops no steady voltage.'
  },
  'voltage-source': { label: 'Voltage source', unit: 'V', dcBehaviour: 'Holds its voltage whatever current flows.' },
  'current-source': { label: 'Current source', unit: 'A', dcBehaviour: 'Pushes its current whatever voltage it takes.' },
  wire: { label: 'Wire', unit: '', dcBehaviour: 'Zero resistance. The two nodes it joins are one node.' },
  switch: { label: 'Switch', unit: '', dcBehaviour: 'A wire when closed, an open circuit when open.' }
})

export interface Component {
  id: string
  kind: ComponentKind
  /** Ohms, farads, henries, volts or amps depending on the kind. Ignored for wires. */
  value: number
  /** The node the current is taken as flowing from. */
  from: string
  /** The node it flows to. For a source, the positive terminal. */
  to: string
  /** For switches only. */
  closed?: boolean
  label?: string
}

export interface Circuit {
  components: readonly Component[]
  /** The node held at zero volts. Every reported voltage is measured against it. */
  ground: string
}

// ---------------------------------------------------------------- validation

export interface CircuitCheck {
  ok: boolean
  nodes: readonly string[]
  problems: readonly { kind: string; message: string; involves: readonly string[] }[]
  warnings: readonly string[]
}

/**
 * Everything wrong with a circuit that can be found before solving it.
 *
 * Run separately from the solver so a Page can show problems while the user is still building, rather than only
 * when they press run. A circuit that fails here will also fail to solve, but the message is far more useful.
 */
export function checkCircuit(circuit: Circuit): CircuitCheck | CircuitError {
  if (circuit.components.length === 0) {
    return fail('no-components', 'There are no components, so there is nothing to solve.')
  }
  if (circuit.components.length > CIRCUIT_LIMITS.components) {
    return fail('too-many', `That is ${circuit.components.length} components; this solves up to ${CIRCUIT_LIMITS.components}.`)
  }

  const nodes = new Set<string>()
  const problems: { kind: string; message: string; involves: readonly string[] }[] = []
  const warnings: string[] = []
  const seenIds = new Set<string>()

  for (const one of circuit.components) {
    if (seenIds.has(one.id)) {
      problems.push({ kind: 'duplicate-id', message: `Two components are both called "${one.id}".`, involves: [one.id] })
    }
    seenIds.add(one.id)
    nodes.add(one.from)
    nodes.add(one.to)
    if (one.from === one.to) {
      problems.push({
        kind: 'self-loop',
        message: `"${one.id}" has both ends on the same node, so nothing can flow through it.`,
        involves: [one.id]
      })
    }
    if (one.kind !== 'wire' && one.kind !== 'switch') {
      if (!finite(one.value)) {
        problems.push({ kind: 'not-finite', message: `"${one.id}" has a value that is not a finite number.`, involves: [one.id] })
      } else if (one.kind === 'resistor' && one.value < 0) {
        problems.push({ kind: 'negative', message: `"${one.id}" has a negative resistance.`, involves: [one.id] })
      } else if ((one.kind === 'capacitor' || one.kind === 'inductor') && one.value <= 0) {
        problems.push({
          kind: 'non-positive',
          message: `"${one.id}" has to have a value greater than zero.`,
          involves: [one.id]
        })
      }
    }
    if (one.kind === 'resistor' && one.value === 0) {
      warnings.push(`"${one.id}" is a zero-ohm resistor, which is a wire. It joins its two nodes into one.`)
    }
  }

  if (nodes.size > CIRCUIT_LIMITS.nodes) {
    return fail('too-many', `That is ${nodes.size} nodes; this solves up to ${CIRCUIT_LIMITS.nodes}.`)
  }
  if (!nodes.has(circuit.ground)) {
    problems.push({
      kind: 'no-ground',
      message: `The ground node "${circuit.ground}" is not connected to anything. Pick a node that exists — every voltage is measured against it.`,
      involves: [circuit.ground]
    })
  }

  // Connectivity: anything not reachable from ground has no defined voltage.
  const reachable = reachableFrom(circuit, circuit.ground)
  for (const node of nodes) {
    if (!reachable.has(node)) {
      problems.push({
        kind: 'floating-node',
        message: `Node "${node}" has no path back to ground, so its voltage is not determined by anything.`,
        involves: [node]
      })
    }
  }

  // Two voltage sources across the same pair of nodes, disagreeing.
  const sourceByPair = new Map<string, Component[]>()
  for (const one of circuit.components) {
    if (one.kind !== 'voltage-source') continue
    const key = [one.from, one.to].sort().join('\u0000')
    const list = sourceByPair.get(key) ?? []
    list.push(one)
    sourceByPair.set(key, list)
  }
  for (const list of sourceByPair.values()) {
    if (list.length < 2) continue
    const values = list.map((one) => (one.from === list[0].from ? one.value : -one.value))
    if (values.some((one) => Math.abs(one - values[0]) > 1e-12)) {
      problems.push({
        kind: 'conflicting-sources',
        message: `${list.map((one) => `"${one.id}"`).join(' and ')} are both across the same two nodes and demand different voltages. Only one of them can be right.`,
        involves: list.map((one) => one.id)
      })
    }
  }

  return {
    ok: problems.length === 0,
    nodes: Object.freeze([...nodes].sort()),
    problems: Object.freeze(problems),
    warnings: Object.freeze(warnings)
  }
}

function reachableFrom(circuit: Circuit, start: string): Set<string> {
  const neighbours = new Map<string, string[]>()
  for (const one of circuit.components) {
    if (one.kind === 'switch' && one.closed === false) continue
    for (const [a, b] of [
      [one.from, one.to],
      [one.to, one.from]
    ]) {
      const list = neighbours.get(a) ?? []
      list.push(b)
      neighbours.set(a, list)
    }
  }
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const node = queue.pop() as string
    if (seen.has(node)) continue
    seen.add(node)
    for (const next of neighbours.get(node) ?? []) if (!seen.has(next)) queue.push(next)
  }
  return seen
}

// ---------------------------------------------------------------- the linear solver

/**
 * Solve a complex linear system by Gaussian elimination with partial pivoting.
 *
 * Partial pivoting is not an optimisation here. Without it a circuit whose first node happens to have a tiny
 * conductance divides by that tiny number and the rounding error swamps the answer — and it looks like a plausible
 * answer rather than a wrong one, which is the dangerous kind of failure.
 */
function solveLinear(matrix: Complex[][], vector: Complex[]): Complex[] | CircuitError {
  const n = vector.length
  const a = matrix.map((row) => row.slice())
  const b = vector.slice()

  for (let column = 0; column < n; column += 1) {
    let pivotRow = column
    let best = magnitude(a[column][column])
    for (let row = column + 1; row < n; row += 1) {
      const candidate = magnitude(a[row][column])
      if (candidate > best) {
        best = candidate
        pivotRow = row
      }
    }
    if (best < 1e-14) {
      return fail(
        'singular',
        'The circuit has no single answer. That usually means an ideal source is shorted by a zero-resistance path, or a part of the circuit is not connected to ground.'
      )
    }
    if (pivotRow !== column) {
      ;[a[column], a[pivotRow]] = [a[pivotRow], a[column]]
      ;[b[column], b[pivotRow]] = [b[pivotRow], b[column]]
    }
    for (let row = column + 1; row < n; row += 1) {
      const factor = div(a[row][column], a[column][column])
      if (!finite(factor.re) || !finite(factor.im)) {
        return fail('singular', 'The circuit equations could not be reduced; the system is degenerate.')
      }
      for (let k = column; k < n; k += 1) a[row][k] = sub(a[row][k], mul(factor, a[column][k]))
      b[row] = sub(b[row], mul(factor, b[column]))
    }
  }

  const x: Complex[] = new Array(n).fill(null).map(() => complex(0))
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = b[row]
    for (let k = row + 1; k < n; k += 1) sum = sub(sum, mul(a[row][k], x[k]))
    x[row] = div(sum, a[row][row])
    if (!finite(x[row].re) || !finite(x[row].im)) {
      return fail('singular', 'The circuit equations gave a value that is not finite, which means the system is degenerate.')
    }
  }
  return x
}

// ---------------------------------------------------------------- solving

export interface NodeVoltage {
  node: string
  voltage: Phasor
}

export interface ComponentResult {
  id: string
  kind: ComponentKind
  label: string
  /** Volts across it, from `from` to `to`. */
  voltage: Phasor
  /** Amps through it, taken positive from `from` to `to`. */
  current: Phasor
  /** Watts of real power dissipated or supplied. Negative means it is supplying. */
  power: number
  /** Ohms. Complex for reactive parts; real for a resistor. */
  impedance: Phasor | null
}

export interface SolveReport {
  /** Hertz. Zero means this was solved as a DC circuit. */
  frequency: number
  nodeVoltages: readonly NodeVoltage[]
  components: readonly ComponentResult[]
  /** The worst Kirchhoff residual found, in amps and volts. Small is the proof the answer is real. */
  kclResidual: number
  kvlResidual: number
  /** Watts. Should match what the sources supply, and does not when the model is inconsistent. */
  totalDissipated: number
  totalSupplied: number
  warnings: readonly string[]
  notes: readonly string[]
}

/**
 * Solve a circuit at one frequency.
 *
 * `frequency: 0` is the DC case and is not a special path: capacitors become open circuits and inductors become
 * shorts, which is exactly what their impedances do in the limit, so the same matrix handles both.
 */
export function solve(circuit: Circuit, frequency = 0): SolveReport | CircuitError {
  const check = checkCircuit(circuit)
  if (isCircuitError(check)) return check
  if (!check.ok) {
    const first = check.problems[0]
    const kind = first.kind === 'floating-node' ? 'floating-node' : first.kind === 'no-ground' ? 'no-ground' : 'invalid-argument'
    return fail(kind as CircuitError['error'], first.message, first.involves)
  }
  if (!finite(frequency) || frequency < 0) {
    return fail('invalid-argument', 'The frequency has to be zero or a positive number of hertz.')
  }

  const omega = 2 * Math.PI * frequency
  const nodes = check.nodes.filter((one) => one !== circuit.ground)
  const index = new Map(nodes.map((node, i) => [node, i]))

  // Voltage sources and zero-ohm paths each need their own current unknown, because the current through them is
  // not determined by the voltage across them. This is modified nodal analysis, and it is why a wire is not simply
  // deleted: deleting it would lose the current flowing in it, which a Page wants to show.
  const currentUnknowns = circuit.components.filter(
    (one) =>
      one.kind === 'voltage-source' ||
      one.kind === 'wire' ||
      (one.kind === 'switch' && one.closed !== false) ||
      (one.kind === 'resistor' && one.value === 0) ||
      (frequency === 0 && one.kind === 'inductor')
  )
  const currentIndex = new Map(currentUnknowns.map((one, i) => [one.id, nodes.length + i]))
  const size = nodes.length + currentUnknowns.length
  if (size === 0) {
    return fail('invalid-argument', 'Everything is tied to ground, so there are no unknown voltages to find.')
  }

  const matrix: Complex[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => complex(0)))
  const vector: Complex[] = Array.from({ length: size }, () => complex(0))

  const stampAdmittance = (from: string, to: string, y: Complex): void => {
    const a = index.get(from)
    const b = index.get(to)
    if (a !== undefined) matrix[a][a] = add(matrix[a][a], y)
    if (b !== undefined) matrix[b][b] = add(matrix[b][b], y)
    if (a !== undefined && b !== undefined) {
      matrix[a][b] = sub(matrix[a][b], y)
      matrix[b][a] = sub(matrix[b][a], y)
    }
  }

  for (const one of circuit.components) {
    if (one.kind === 'switch' && one.closed === false) continue

    switch (one.kind) {
      case 'resistor': {
        if (one.value === 0) break // handled as a current unknown below
        stampAdmittance(one.from, one.to, complex(1 / one.value))
        break
      }
      case 'capacitor': {
        // jωC. At DC this is zero, which is an open circuit — exactly right, and no special case needed.
        if (frequency > 0) stampAdmittance(one.from, one.to, complex(0, omega * one.value))
        break
      }
      case 'inductor': {
        // 1/(jωL). At DC this is infinite, so the DC case is handled as a zero-volt source instead.
        if (frequency > 0) stampAdmittance(one.from, one.to, div(complex(1), complex(0, omega * one.value)))
        break
      }
      case 'current-source': {
        // Current leaves `from` and arrives at `to`.
        const a = index.get(one.from)
        const b = index.get(one.to)
        if (a !== undefined) vector[a] = sub(vector[a], complex(one.value))
        if (b !== undefined) vector[b] = add(vector[b], complex(one.value))
        break
      }
      default:
        break
    }
  }

  // Branch-current rows: one per voltage source, wire, closed switch, zero-ohm resistor, or DC inductor.
  for (const one of currentUnknowns) {
    const row = currentIndex.get(one.id) as number
    const a = index.get(one.from)
    const b = index.get(one.to)
    // KCL: the branch current leaves `from` and enters `to`.
    if (a !== undefined) matrix[a][row] = add(matrix[a][row], complex(1))
    if (b !== undefined) matrix[b][row] = sub(matrix[b][row], complex(1))
    // The constraint: V(to) − V(from) = source value, or 0 for a wire/short/DC inductor.
    if (b !== undefined) matrix[row][b] = add(matrix[row][b], complex(1))
    if (a !== undefined) matrix[row][a] = sub(matrix[row][a], complex(1))
    vector[row] = complex(one.kind === 'voltage-source' ? one.value : 0)
  }

  const solved = solveLinear(matrix, vector)
  if (isCircuitError(solved)) {
    const shorted = shortedSourceIn(circuit)
    if (shorted) {
      return fail(
        'short-circuit',
        `"${shorted}" is an ideal voltage source with a zero-resistance path straight across it. That asks for infinite current, so there is no answer to give. Add some resistance, or remove the short.`,
        [shorted]
      )
    }
    return solved
  }

  const voltageOf = (node: string): Complex => {
    if (node === circuit.ground) return complex(0)
    const at = index.get(node)
    return at === undefined ? complex(0) : solved[at]
  }

  const results: ComponentResult[] = []
  let totalDissipated = 0
  let totalSupplied = 0

  for (const one of circuit.components) {
    // The drop from `from` to `to`, which is what a passive component's current divides into. Taking it the other
    // way round gives a current flowing backwards through every resistor, and a Kirchhoff residual of exactly twice
    // the loop current rather than zero.
    const across = sub(voltageOf(one.from), voltageOf(one.to))
    let through: Complex
    let impedance: Complex | null = null

    if (currentIndex.has(one.id)) {
      through = solved[currentIndex.get(one.id) as number]
      impedance = one.kind === 'voltage-source' ? null : complex(0)
    } else if (one.kind === 'switch' && one.closed === false) {
      through = complex(0)
      impedance = null
    } else if (one.kind === 'resistor') {
      impedance = complex(one.value)
      through = div(across, impedance)
    } else if (one.kind === 'capacitor') {
      impedance = frequency > 0 ? complex(0, -1 / (omega * one.value)) : complex(Number.POSITIVE_INFINITY)
      through = frequency > 0 ? mul(across, complex(0, omega * one.value)) : complex(0)
    } else if (one.kind === 'inductor') {
      impedance = complex(0, omega * one.value)
      through = div(across, impedance)
    } else if (one.kind === 'current-source') {
      through = complex(one.value)
      impedance = null
    } else {
      through = complex(0)
      impedance = null
    }

    // Real power: ½·Re(V·I*) for AC amplitudes, V·I for DC. The conjugate is what makes reactive power drop out.
    const conjugate = complex(through.re, -through.im)
    const raw = mul(across, conjugate).re
    // Passive sign convention: the drop across it times the current through it. Positive means it is absorbing, and
    // a source pushing current out of its positive terminal comes out negative — which is the sign saying it is
    // supplying rather than a bug.
    const absorbed = frequency > 0 ? raw / 2 : raw
    if (absorbed > 0) totalDissipated += absorbed
    else totalSupplied += -absorbed

    results.push({
      id: one.id,
      kind: one.kind,
      label: one.label ?? one.id,
      voltage: phasor(across),
      current: phasor(through),
      power: absorbed,
      impedance: impedance === null || !finite(impedance.re) ? null : phasor(impedance)
    })
  }

  const kclResidual = worstKcl(circuit, results, circuit.ground)
  const warnings = [...check.warnings]
  const notes: string[] = []
  if (frequency === 0) {
    notes.push(
      'Solved as DC. Capacitors are open circuits and inductors are shorts, because that is what their impedances become as the frequency goes to zero.'
    )
  } else {
    notes.push(
      `Solved at ${frequency} Hz. Every voltage and current is a phasor: the magnitude is the amplitude and the angle is how far it leads or lags.`
    )
  }
  const imbalance = Math.abs(totalDissipated - totalSupplied)
  if (imbalance > Math.max(totalSupplied, totalDissipated) * 1e-6 + 1e-12) {
    warnings.push(
      `Power in and power out differ by ${imbalance.toExponential(2)} W. That is larger than rounding, and usually means the circuit contains something that cannot be in steady state.`
    )
  }

  return {
    frequency,
    nodeVoltages: Object.freeze(
      check.nodes.map((node) => ({ node, voltage: phasor(voltageOf(node)) }))
    ),
    components: Object.freeze(results),
    kclResidual,
    kvlResidual: 0,
    totalDissipated,
    totalSupplied,
    warnings: Object.freeze(warnings),
    notes: Object.freeze(notes)
  }
}

function shortedSourceIn(circuit: Circuit): string | null {
  const zeroPaths = circuit.components.filter(
    (one) => one.kind === 'wire' || (one.kind === 'resistor' && one.value === 0) || (one.kind === 'switch' && one.closed !== false)
  )
  for (const source of circuit.components) {
    if (source.kind !== 'voltage-source' || source.value === 0) continue
    const joined = new Set([source.from])
    let grew = true
    while (grew) {
      grew = false
      for (const path of zeroPaths) {
        if (joined.has(path.from) && !joined.has(path.to)) {
          joined.add(path.to)
          grew = true
        } else if (joined.has(path.to) && !joined.has(path.from)) {
          joined.add(path.from)
          grew = true
        }
      }
    }
    if (joined.has(source.to)) return source.id
  }
  return null
}

/**
 * The worst current imbalance at any node.
 *
 * This is the proof that the answer is an answer. A solver that returns numbers satisfying Kirchhoff's current law
 * to one part in 10¹² has solved the circuit; one that does not has returned something else, and a Page showing
 * the residual can tell the difference without trusting anybody.
 */
function worstKcl(circuit: Circuit, results: readonly ComponentResult[], ground: string): number {
  const byId = new Map(results.map((one) => [one.id, one]))
  const sums = new Map<string, { re: number; im: number }>()
  for (const one of circuit.components) {
    const result = byId.get(one.id)
    if (!result) continue
    const current = result.current
    for (const [node, sign] of [
      [one.from, -1],
      [one.to, 1]
    ] as const) {
      if (node === ground) continue
      const running = sums.get(node) ?? { re: 0, im: 0 }
      running.re += sign * current.re
      running.im += sign * current.im
      sums.set(node, running)
    }
  }
  let worst = 0
  for (const one of sums.values()) worst = Math.max(worst, Math.hypot(one.re, one.im))
  return worst
}

// ---------------------------------------------------------------- series and parallel shortcuts

export interface SeriesParallelReport {
  arrangement: 'series' | 'parallel'
  values: readonly number[]
  total: number
  /** For resistors in series, how a supply voltage divides. */
  shares: readonly number[]
  notes: readonly string[]
}

/** Resistors in series or parallel, for the Pages that do not need a whole graph. */
export function combineResistors(
  values: readonly number[],
  arrangement: 'series' | 'parallel',
  supplyVoltage = 0
): SeriesParallelReport | CircuitError {
  if (values.length === 0) return fail('no-components', 'There are no resistors to combine.')
  if (values.length > 128) return fail('too-many', 'That is more than the 128 resistors this handles.')
  for (const [i, one] of values.entries()) {
    if (!finite(one)) return fail('not-finite', `Resistor ${i + 1} is not a finite number of ohms.`)
    if (one < 0) return fail('invalid-argument', `Resistor ${i + 1} has a negative resistance.`)
  }
  if (arrangement === 'series') {
    const total = values.reduce((sum, one) => sum + one, 0)
    const current = total === 0 ? 0 : supplyVoltage / total
    return {
      arrangement,
      values,
      total,
      shares: values.map((one) => one * current),
      notes: Object.freeze([
        'In series the same current goes through every resistor, so the voltage divides in proportion to resistance.'
      ])
    }
  }
  if (values.some((one) => one === 0)) {
    return fail(
      'short-circuit',
      'One of these is zero ohms. In parallel that shorts out everything beside it, and the combination is zero.',
      []
    )
  }
  const total = 1 / values.reduce((sum, one) => sum + 1 / one, 0)
  return {
    arrangement,
    values,
    total,
    shares: values.map((one) => (supplyVoltage === 0 ? 0 : supplyVoltage / one)),
    notes: Object.freeze([
      'In parallel every resistor has the same voltage across it, and the total is always smaller than the smallest one.'
    ])
  }
}

// ---------------------------------------------------------------- transients

export type TransientKind = 'rc-charge' | 'rc-discharge' | 'rl-energise' | 'rl-decay'

export const TRANSIENT_KINDS: readonly TransientKind[] = Object.freeze([
  'rc-charge',
  'rc-discharge',
  'rl-energise',
  'rl-decay'
])

export interface TransientSample {
  time: number
  /** Volts across the reactive component. */
  voltage: number
  /** Amps through the loop. */
  current: number
  /** Coulombs on the capacitor, or webers through the inductor. Null when the other kind. */
  stored: number
  /** Joules stored in the field. */
  energy: number
}

export interface TransientReport {
  kind: TransientKind
  /** Seconds. RC or L/R. */
  timeConstant: number
  /** The value the transient is heading toward. */
  finalValue: number
  /** Where it started. */
  initialValue: number
  samples: readonly TransientSample[]
  /** Seconds to reach 63.2%, 86.5%, 95.0% and 99.3% of the way there — one to four time constants. */
  milestones: readonly { fraction: number; time: number; label: string }[]
  notes: readonly string[]
}

/**
 * A first-order transient, in closed form.
 *
 * RC and RL circuits have exact solutions, and integrating them numerically would add error to a problem that has
 * none. The numerical solver in `simulation.ts` is for systems that need it; this is not one of them.
 */
export function transient(input: {
  kind: TransientKind
  resistance: number
  capacitance?: number
  inductance?: number
  supplyVoltage?: number
  initialVoltage?: number
  initialCurrent?: number
  duration?: number
  samples?: number
}): TransientReport | CircuitError {
  const { kind, resistance } = input
  if (!finite(resistance) || resistance <= 0) {
    return fail('invalid-argument', 'The resistance has to be greater than zero. With no resistance the transient has no time constant.')
  }
  const isCapacitive = kind === 'rc-charge' || kind === 'rc-discharge'
  const reactive = isCapacitive ? input.capacitance : input.inductance
  if (reactive === undefined || !finite(reactive) || reactive <= 0) {
    return fail(
      'invalid-argument',
      isCapacitive ? 'An RC transient needs a capacitance greater than zero.' : 'An RL transient needs an inductance greater than zero.'
    )
  }

  const tau = isCapacitive ? resistance * reactive : reactive / resistance
  const supply = input.supplyVoltage ?? 0
  const count = Math.round(input.samples ?? 400)
  if (!Number.isInteger(count) || count < 2 || count > CIRCUIT_LIMITS.traceSamples) {
    return fail('invalid-argument', `The sample count has to be a whole number between 2 and ${CIRCUIT_LIMITS.traceSamples}.`)
  }
  const duration = input.duration ?? tau * 5
  if (!finite(duration) || duration <= 0) return fail('invalid-argument', 'The duration has to be a positive time.')

  const samples: TransientSample[] = []
  let initialValue = 0
  let finalValue = 0

  for (let i = 0; i < count; i += 1) {
    const time = (duration * i) / (count - 1)
    const decay = Math.exp(-time / tau)
    let voltage: number
    let current: number
    let stored: number
    let energy: number

    switch (kind) {
      case 'rc-charge': {
        const start = input.initialVoltage ?? 0
        voltage = supply + (start - supply) * decay
        current = ((supply - voltage) / resistance)
        stored = voltage * reactive
        energy = 0.5 * reactive * voltage * voltage
        initialValue = start
        finalValue = supply
        break
      }
      case 'rc-discharge': {
        const start = input.initialVoltage ?? supply
        voltage = start * decay
        current = -voltage / resistance
        stored = voltage * reactive
        energy = 0.5 * reactive * voltage * voltage
        initialValue = start
        finalValue = 0
        break
      }
      case 'rl-energise': {
        const target = supply / resistance
        const start = input.initialCurrent ?? 0
        current = target + (start - target) * decay
        voltage = supply - current * resistance
        stored = current * reactive
        energy = 0.5 * reactive * current * current
        initialValue = start
        finalValue = target
        break
      }
      default: {
        const start = input.initialCurrent ?? supply / resistance
        current = start * decay
        voltage = -current * resistance
        stored = current * reactive
        energy = 0.5 * reactive * current * current
        initialValue = start
        finalValue = 0
        break
      }
    }
    samples.push({ time, voltage, current, stored, energy })
  }

  return {
    kind,
    timeConstant: tau,
    finalValue,
    initialValue,
    samples: Object.freeze(samples),
    milestones: Object.freeze([
      { fraction: 0.632, time: tau, label: 'one time constant' },
      { fraction: 0.865, time: tau * 2, label: 'two time constants' },
      { fraction: 0.95, time: tau * 3, label: 'three time constants' },
      { fraction: 0.993, time: tau * 5, label: 'five time constants' }
    ]),
    notes: Object.freeze([
      `The time constant is ${isCapacitive ? 'RC' : 'L/R'} = ${tau.toExponential(3)} s. After one of them the gap to the final value has closed by 63.2%, and after five by more than 99%.`,
      'An exponential never actually arrives. "Settled" is a convention about how close is close enough, not a moment when something stops changing.'
    ])
  }
}

// ---------------------------------------------------------------- second order

export type Damping = 'underdamped' | 'critically-damped' | 'overdamped'

export interface RlcReport {
  arrangement: 'series' | 'parallel'
  resistance: number
  inductance: number
  capacitance: number
  /** rad/s. The undamped natural frequency. */
  naturalAngular: number
  /** Hz. */
  naturalFrequency: number
  /** Dimensionless. Below 1 rings, above 1 crawls, exactly 1 is the fastest approach without overshoot. */
  dampingRatio: number
  damping: Damping
  /** rad/s. The frequency it actually rings at, which is lower than the natural one. Null when it does not ring. */
  dampedAngular: number | null
  /** Dimensionless. */
  qualityFactor: number
  /** Hz. The width where the response is within 3 dB of the peak. */
  bandwidth: number
  samples: readonly { time: number; value: number; envelope: number }[]
  notes: readonly string[]
}

/**
 * A series or parallel RLC circuit: its natural frequency, its damping, and the step response that follows.
 *
 * The damped frequency is lower than the natural one, always. A circuit that rings at exactly ω₀ is one with no
 * resistance at all, and that circuit does not exist — so a Page quoting ω₀ as "the frequency it rings at" is
 * quoting a number the oscilloscope will disagree with.
 */
export function rlc(input: {
  resistance: number
  inductance: number
  capacitance: number
  arrangement?: 'series' | 'parallel'
  stepAmplitude?: number
  duration?: number
  samples?: number
}): RlcReport | CircuitError {
  const { resistance, inductance, capacitance } = input
  const arrangement = input.arrangement ?? 'series'
  if (!finite(resistance) || resistance < 0) return fail('invalid-argument', 'The resistance has to be zero or positive.')
  if (!finite(inductance) || inductance <= 0) return fail('invalid-argument', 'The inductance has to be greater than zero.')
  if (!finite(capacitance) || capacitance <= 0) return fail('invalid-argument', 'The capacitance has to be greater than zero.')

  const omega0 = 1 / Math.sqrt(inductance * capacitance)
  // The damping ratio is different for the two arrangements, which is the single most common mistake here.
  const zeta =
    arrangement === 'series'
      ? (resistance / 2) * Math.sqrt(capacitance / inductance)
      : resistance === 0
        ? Number.POSITIVE_INFINITY
        : (1 / (2 * resistance)) * Math.sqrt(inductance / capacitance)

  const damping: Damping = zeta < 1 - 1e-12 ? 'underdamped' : zeta > 1 + 1e-12 ? 'overdamped' : 'critically-damped'
  const omegaD = damping === 'underdamped' ? omega0 * Math.sqrt(1 - zeta * zeta) : null
  const q = zeta === 0 ? Number.POSITIVE_INFINITY : 1 / (2 * zeta)
  const bandwidth = (omega0 / (2 * Math.PI)) / (finite(q) ? q : Number.POSITIVE_INFINITY)

  const amplitude = input.stepAmplitude ?? 1
  const count = Math.round(input.samples ?? 500)
  if (!Number.isInteger(count) || count < 2 || count > CIRCUIT_LIMITS.traceSamples) {
    return fail('invalid-argument', `The sample count has to be a whole number between 2 and ${CIRCUIT_LIMITS.traceSamples}.`)
  }
  const duration = input.duration ?? (zeta > 0 ? Math.min(60 / (zeta * omega0), 200 / omega0) : 40 / omega0)
  if (!finite(duration) || duration <= 0) return fail('invalid-argument', 'The duration has to be a positive time.')

  const samples: { time: number; value: number; envelope: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const t = (duration * i) / (count - 1)
    const envelope = amplitude * Math.exp(-zeta * omega0 * t)
    let value: number
    if (damping === 'underdamped' && omegaD !== null) {
      value =
        amplitude *
        (1 - Math.exp(-zeta * omega0 * t) * (Math.cos(omegaD * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(omegaD * t)))
    } else if (damping === 'critically-damped') {
      value = amplitude * (1 - Math.exp(-omega0 * t) * (1 + omega0 * t))
    } else {
      const root = Math.sqrt(zeta * zeta - 1)
      const s1 = -omega0 * (zeta - root)
      const s2 = -omega0 * (zeta + root)
      value = amplitude * (1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1))
    }
    samples.push({ time: t, value, envelope })
  }

  const notes: string[] = [
    damping === 'underdamped'
      ? `Underdamped: it overshoots and rings at ${((omegaD ?? 0) / (2 * Math.PI)).toFixed(4)} Hz, which is lower than the undamped ${(omega0 / (2 * Math.PI)).toFixed(4)} Hz. Resistance slows the ringing as well as shrinking it.`
      : damping === 'critically-damped'
        ? 'Critically damped: the fastest it can reach the final value without overshooting. Any less resistance and it rings; any more and it takes longer.'
        : 'Overdamped: no ringing, and slower than critical damping. Extra resistance past critical does not help it settle — it hinders.'
  ]
  if (arrangement === 'parallel') {
    notes.push(
      'In a parallel RLC, more resistance means less damping — the opposite of the series case. The resistor is a path around the tank rather than in series with it.'
    )
  }

  return {
    arrangement,
    resistance,
    inductance,
    capacitance,
    naturalAngular: omega0,
    naturalFrequency: omega0 / (2 * Math.PI),
    dampingRatio: zeta,
    damping,
    dampedAngular: omegaD,
    qualityFactor: q,
    bandwidth,
    samples: Object.freeze(samples),
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- resonance and sweeps

export interface ResonancePoint {
  frequency: number
  /** Ohms. */
  impedanceMagnitude: number
  /** Radians. Positive means the circuit is inductive and the current lags. */
  impedancePhase: number
  current: number
  /** Decibels relative to the peak, so a Page can find the −3 dB points without a second pass. */
  gainDb: number
}

export interface ResonanceReport {
  arrangement: 'series' | 'parallel'
  resonantFrequency: number
  qualityFactor: number
  bandwidth: number
  /** Hz. Where the response falls to 1/√2 of the peak. */
  lowerCutoff: number
  upperCutoff: number
  /** Ohms at resonance: purely real, and minimum for series or maximum for parallel. */
  impedanceAtResonance: number
  points: readonly ResonancePoint[]
  notes: readonly string[]
}

/**
 * Sweep an RLC circuit across frequency and find its resonance.
 *
 * At resonance the reactances cancel exactly and the impedance is purely resistive — which is why the current
 * peaks in a series circuit and dips in a parallel one. Same cancellation, opposite consequence, and a Page that
 * describes resonance as "where current is highest" is only right about half of them.
 */
export function resonanceSweep(input: {
  resistance: number
  inductance: number
  capacitance: number
  arrangement?: 'series' | 'parallel'
  driveVoltage?: number
  fromFrequency?: number
  toFrequency?: number
  points?: number
}): ResonanceReport | CircuitError {
  const { resistance, inductance, capacitance } = input
  const arrangement = input.arrangement ?? 'series'
  if (!finite(resistance) || resistance <= 0) return fail('invalid-argument', 'The resistance has to be greater than zero for a sweep.')
  if (!finite(inductance) || inductance <= 0) return fail('invalid-argument', 'The inductance has to be greater than zero.')
  if (!finite(capacitance) || capacitance <= 0) return fail('invalid-argument', 'The capacitance has to be greater than zero.')

  const f0 = 1 / (2 * Math.PI * Math.sqrt(inductance * capacitance))
  const q = arrangement === 'series' ? (1 / resistance) * Math.sqrt(inductance / capacitance) : resistance * Math.sqrt(capacitance / inductance)
  const bandwidth = f0 / q
  const drive = input.driveVoltage ?? 1

  const from = input.fromFrequency ?? Math.max(f0 / 10, f0 - bandwidth * 8)
  const to = input.toFrequency ?? f0 + bandwidth * 8
  if (!finite(from) || !finite(to) || from <= 0 || to <= from) {
    return fail('invalid-argument', 'The sweep needs a positive start frequency below its end frequency.')
  }
  const count = Math.round(input.points ?? 600)
  if (!Number.isInteger(count) || count < 2 || count > CIRCUIT_LIMITS.sweepPoints) {
    return fail('invalid-argument', `The point count has to be a whole number between 2 and ${CIRCUIT_LIMITS.sweepPoints}.`)
  }

  const points: ResonancePoint[] = []
  let peak = 0
  for (let i = 0; i < count; i += 1) {
    // Logarithmic spacing, because a resonance peak is symmetric on a log axis and not on a linear one.
    const f = from * Math.pow(to / from, i / (count - 1))
    const omega = 2 * Math.PI * f
    const zl = omega * inductance
    const zc = 1 / (omega * capacitance)
    let z: Complex
    if (arrangement === 'series') {
      z = complex(resistance, zl - zc)
    } else {
      const y = add(add(complex(1 / resistance), div(complex(1), complex(0, zl))), complex(0, 1 / zc))
      z = div(complex(1), y)
    }
    const mag = magnitude(z)
    const current = mag === 0 ? Number.POSITIVE_INFINITY : drive / mag
    peak = Math.max(peak, current)
    points.push({ frequency: f, impedanceMagnitude: mag, impedancePhase: phase(z), current, gainDb: 0 })
  }
  for (const one of points) one.gainDb = peak > 0 ? 20 * Math.log10(one.current / peak) : 0

  return {
    arrangement,
    resonantFrequency: f0,
    qualityFactor: q,
    bandwidth,
    lowerCutoff: Math.max(0, f0 - bandwidth / 2),
    upperCutoff: f0 + bandwidth / 2,
    impedanceAtResonance: arrangement === 'series' ? resistance : resistance,
    points: Object.freeze(points),
    notes: Object.freeze([
      arrangement === 'series'
        ? 'At resonance the inductive and capacitive reactances cancel, the impedance falls to just the resistance, and the current peaks.'
        : 'At resonance the reactances cancel, the impedance rises to a maximum, and the current from the supply dips. Inside the tank the circulating current is Q times larger than what the supply provides.',
      `Q = ${q.toFixed(3)}. A higher Q means a narrower peak: the bandwidth is the resonant frequency divided by Q.`
    ])
  }
}

// ---------------------------------------------------------------- AC power

export interface PowerReport {
  /** Volts RMS. */
  voltageRms: number
  /** Amps RMS. */
  currentRms: number
  /** Radians. Positive means the current lags the voltage, which is what an inductive load does. */
  phase: number
  /** Watts. What actually does work. */
  realPower: number
  /** Volt-amps reactive. Energy that sloshes back and forth and does no net work — but the wiring still carries it. */
  reactivePower: number
  /** Volt-amps. The hypotenuse. */
  apparentPower: number
  /** cos φ. */
  powerFactor: number
  /** Whether the current lags (inductive) or leads (capacitive). */
  character: 'lagging' | 'leading' | 'unity'
  notes: readonly string[]
}

/**
 * The three powers in an AC circuit, which are not three ways of saying the same thing.
 *
 * Real power is what the meter bills for. Apparent power is what the cable has to be sized for. Reactive power is
 * the difference, and it is not waste in the sense of heat — it is energy that goes out and comes back every cycle
 * while occupying capacity that could have carried something useful.
 */
export function acPower(input: {
  voltageRms: number
  currentRms: number
  phaseRadians?: number
  phaseDegrees?: number
}): PowerReport | CircuitError {
  const { voltageRms, currentRms } = input
  if (!finite(voltageRms) || !finite(currentRms)) return fail('not-finite', 'Voltage and current both have to be finite.')
  if (voltageRms < 0 || currentRms < 0) {
    return fail('invalid-argument', 'RMS values are magnitudes and cannot be negative. The phase carries the direction.')
  }
  const hasRadians = input.phaseRadians !== undefined
  const hasDegrees = input.phaseDegrees !== undefined
  if (hasRadians && hasDegrees) {
    return fail('invalid-argument', 'Give the phase in radians or in degrees, not both.')
  }
  const angle = hasDegrees ? ((input.phaseDegrees as number) * Math.PI) / 180 : (input.phaseRadians ?? 0)
  if (!finite(angle)) return fail('not-finite', 'The phase has to be a finite angle.')

  const apparent = voltageRms * currentRms
  const real = apparent * Math.cos(angle)
  const reactive = apparent * Math.sin(angle)
  const factor = apparent === 0 ? 1 : real / apparent
  const character: PowerReport['character'] =
    Math.abs(angle) < 1e-12 ? 'unity' : angle > 0 ? 'lagging' : 'leading'

  const notes: string[] = [
    'The power triangle: S² = P² + Q². Real power is the adjacent side, reactive the opposite, apparent the hypotenuse.'
  ]
  if (character === 'lagging') {
    notes.push('The current lags the voltage, so the load is inductive — motors and transformers behave this way.')
  } else if (character === 'leading') {
    notes.push('The current leads the voltage, so the load is capacitive.')
  }
  if (Math.abs(factor) < 0.8 && apparent > 0) {
    notes.push(
      `A power factor of ${factor.toFixed(3)} means the wiring is carrying ${(1 / Math.abs(factor)).toFixed(2)} times the current that the real power alone would need.`
    )
  }

  return {
    voltageRms,
    currentRms,
    phase: angle,
    realPower: real,
    reactivePower: reactive,
    apparentPower: apparent,
    powerFactor: factor,
    character,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- transformers

export interface TransformerReport {
  model: 'ideal' | 'with-losses'
  primaryTurns: number
  secondaryTurns: number
  turnsRatio: number
  primaryVoltage: number
  secondaryVoltage: number
  primaryCurrent: number
  secondaryCurrent: number
  /** Ohms, as the primary sees it. A transformer turns a load into a different load. */
  reflectedImpedance: number
  inputPower: number
  outputPower: number
  /** Watts lost. Zero in the ideal model, and saying so is the point. */
  losses: number
  efficiency: number
  notes: readonly string[]
}

/**
 * A transformer, ideal by default and with losses if asked.
 *
 * The two models are kept apart rather than blended. The ideal one is exact and says 100% efficiency because that
 * is what the model contains — hiding that behind a plausible-looking 97% would be inventing a loss the
 * calculation never computed.
 */
export function transformer(input: {
  primaryTurns: number
  secondaryTurns: number
  primaryVoltage: number
  loadResistance: number
  windingResistancePrimary?: number
  windingResistanceSecondary?: number
  coreLossWatts?: number
}): TransformerReport | CircuitError {
  const { primaryTurns, secondaryTurns, primaryVoltage, loadResistance } = input
  for (const [name, value] of Object.entries({ primaryTurns, secondaryTurns, primaryVoltage, loadResistance })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
  }
  if (primaryTurns <= 0 || secondaryTurns <= 0) return fail('invalid-argument', 'Both turn counts have to be greater than zero.')
  if (loadResistance <= 0) return fail('invalid-argument', 'The load resistance has to be greater than zero.')

  const ratio = secondaryTurns / primaryTurns
  const hasLosses =
    input.windingResistancePrimary !== undefined ||
    input.windingResistanceSecondary !== undefined ||
    input.coreLossWatts !== undefined

  if (!hasLosses) {
    const secondaryVoltage = primaryVoltage * ratio
    const secondaryCurrent = secondaryVoltage / loadResistance
    const primaryCurrent = secondaryCurrent * ratio
    const power = secondaryVoltage * secondaryCurrent
    return {
      model: 'ideal',
      primaryTurns,
      secondaryTurns,
      turnsRatio: ratio,
      primaryVoltage,
      secondaryVoltage,
      primaryCurrent,
      secondaryCurrent,
      reflectedImpedance: loadResistance / (ratio * ratio),
      inputPower: power,
      outputPower: power,
      losses: 0,
      efficiency: 1,
      notes: Object.freeze([
        'This is the ideal model: no winding resistance, no core loss, no leakage. Efficiency is exactly 1 because the model has nothing to lose energy to, not because a real transformer would.',
        `The load looks like ${(loadResistance / (ratio * ratio)).toFixed(3)} ohms from the primary side. Impedance transforms as the square of the turns ratio.`
      ])
    }
  }

  const rp = input.windingResistancePrimary ?? 0
  const rs = input.windingResistanceSecondary ?? 0
  const coreLoss = input.coreLossWatts ?? 0
  for (const [name, value] of Object.entries({ rp, rs, coreLoss })) {
    if (!finite(value) || value < 0) return fail('invalid-argument', `"${name}" has to be zero or positive.`)
  }

  // Refer the secondary side to the primary and solve the single loop, then transform back.
  const referredLoad = (loadResistance + rs) / (ratio * ratio)
  const totalPrimary = rp + referredLoad
  if (totalPrimary <= 0) return fail('invalid-argument', 'The total referred resistance came out as zero, which has no solution.')
  const primaryCurrent = primaryVoltage / totalPrimary + (primaryVoltage === 0 ? 0 : coreLoss / primaryVoltage)
  const loadCurrentPrimarySide = primaryVoltage / totalPrimary
  const secondaryCurrent = loadCurrentPrimarySide / ratio
  const secondaryVoltage = secondaryCurrent * loadResistance
  const inputPower = primaryVoltage * primaryCurrent
  const outputPower = secondaryVoltage * secondaryCurrent
  const losses = inputPower - outputPower

  return {
    model: 'with-losses',
    primaryTurns,
    secondaryTurns,
    turnsRatio: ratio,
    primaryVoltage,
    secondaryVoltage,
    primaryCurrent,
    secondaryCurrent,
    reflectedImpedance: referredLoad,
    inputPower,
    outputPower,
    losses,
    efficiency: inputPower === 0 ? 0 : outputPower / inputPower,
    notes: Object.freeze([
      'Winding resistance and core loss are included, so the secondary voltage is below the ideal turns ratio and efficiency is below 1.',
      'Leakage inductance and saturation are still not modelled. This is an engineering approximation, not a full transformer model.'
    ])
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const CIRCUIT_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Components are ideal and linear. A resistor has one resistance at every current, and nothing saturates or heats up.',
  'Wires have no resistance, no inductance and no capacitance to anything else.',
  'The circuit is lumped: signals cross it instantly, which stops being true when the wiring is a noticeable fraction of a wavelength.',
  'AC results are steady state. The transient that got there is a separate calculation.',
  'Every voltage is measured against the ground node. Moving the ground moves them all together and changes no current.'
])
