/**
 * Digital logic: gates, networks, truth tables and sequential circuits.
 *
 * ## The network is evaluated, not described
 *
 * A circuit here is a graph of gates with named wires between them, and working out what it does means propagating
 * values through it until they settle. So a truth table is produced by actually running the network for every input
 * combination rather than by being written down beside it — which is the whole point, because it means the table and
 * the circuit cannot disagree.
 *
 * ## Feedback is detected, not forbidden
 *
 * A latch is a loop: two gates each feeding the other. That is not a mistake, it is how memory is built. So
 * evaluation iterates to a fixed point and reports what happened: settled, oscillating, or still moving when it ran
 * out of rounds. An engine that rejected loops could not show a flip-flop; one that pretended a loop settled would
 * be lying about the most interesting case there is.
 *
 * ## Propagation delay is counted in gate levels
 *
 * Each gate takes one unit. The depth of the network is therefore the number of levels a signal passes through, and
 * that is the honest measure of how fast it can be clocked. It is not nanoseconds: real timing depends on the
 * technology, the fan-out and the wire, none of which is modelled, and saying "7 gate delays" is true where saying
 * "4.2ns" would not be.
 *
 * Pure. No Electron, no DOM.
 */

export interface LogicError {
  error: string
  says: string
  fix: string
}

export const isLogicError = (value: unknown): value is LogicError =>
  typeof value === 'object' && value !== null && 'error' in value && 'says' in value && 'fix' in value

const refuse = (error: string, says: string, fix: string): LogicError => ({ error, says, fix })

const LIMITS = Object.freeze({
  gates: 400,
  inputs: 16,
  wires: 1_200,
  /** Rounds of propagation before a network is called unsettled. Generous: the deepest legitimate chain is far less. */
  rounds: 200,
  /** Clock ticks one run may simulate. */
  ticks: 4_000
})

// ---------------------------------------------------------------- gates

export type GateKind = 'and' | 'or' | 'not' | 'nand' | 'nor' | 'xor' | 'xnor' | 'buffer'

export const GATE_KINDS: readonly GateKind[] = Object.freeze(['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'buffer'])

interface GateFacts {
  label: string
  /** How many inputs it takes. Null means any number of two or more. */
  arity: number | null
  /** Said the way somebody would explain it. */
  about: string
  /** The common shorthand. */
  symbol: string
}

export const GATE_FACTS: Readonly<Record<GateKind, GateFacts>> = Object.freeze({
  and: { label: 'AND', arity: null, about: 'On only when every input is on.', symbol: '·' },
  or: { label: 'OR', arity: null, about: 'On when any input is on.', symbol: '+' },
  not: { label: 'NOT', arity: 1, about: 'The opposite of its input.', symbol: "'" },
  nand: { label: 'NAND', arity: null, about: 'An AND followed by a NOT. Every other gate can be built from these alone.', symbol: '↑' },
  nor: { label: 'NOR', arity: null, about: 'An OR followed by a NOT. Also enough on its own to build anything.', symbol: '↓' },
  xor: { label: 'XOR', arity: null, about: 'On when an odd number of inputs are on. With two inputs: on when they differ.', symbol: '⊕' },
  xnor: { label: 'XNOR', arity: null, about: 'The opposite of XOR. With two inputs: on when they are the same.', symbol: '⊙' },
  buffer: { label: 'buffer', arity: 1, about: 'Passes its input through. Used to add a delay or drive a bigger load.', symbol: '▷' }
})

/** Works out one gate's output from its inputs. */
export function gateOutput(kind: GateKind, inputs: readonly boolean[]): boolean | LogicError {
  const facts = GATE_FACTS[kind]
  if (facts === undefined) return refuse('unknown gate', `There is no "${String(kind)}" gate.`, `Use one of: ${GATE_KINDS.join(', ')}.`)
  if (facts.arity !== null && inputs.length !== facts.arity) {
    return refuse(
      'wrong number of inputs',
      `${facts.label} takes exactly ${facts.arity} input${facts.arity === 1 ? '' : 's'}, not ${inputs.length}.`,
      facts.arity === 1 ? 'Give it one input.' : `Give it ${facts.arity}.`
    )
  }
  if (facts.arity === null && inputs.length < 2) {
    return refuse('too few inputs', `${facts.label} needs at least two inputs.`, 'Connect another one.')
  }

  switch (kind) {
    case 'and':
      return inputs.every((one) => one)
    case 'or':
      return inputs.some((one) => one)
    case 'not':
      return !inputs[0]
    case 'buffer':
      return inputs[0]
    case 'nand':
      return !inputs.every((one) => one)
    case 'nor':
      return !inputs.some((one) => one)
    case 'xor':
      // An odd number on, which is what XOR means for more than two inputs.
      return inputs.filter((one) => one).length % 2 === 1
    case 'xnor':
      return inputs.filter((one) => one).length % 2 === 0
  }
}

// ---------------------------------------------------------------- networks

export interface Gate {
  id: string
  kind: GateKind
  /** Wire names feeding it, in order. */
  from: readonly string[]
  /** The wire it drives. One gate drives one wire. */
  to: string
  label?: string
}

export interface Network {
  /** Wire names that come from outside. */
  inputs: readonly string[]
  /** Wire names somebody wants to look at. */
  outputs: readonly string[]
  gates: readonly Gate[]
  name?: string
}

export interface NetworkCheck {
  ok: boolean
  /** Wires read by a gate and driven by nothing. */
  floating: readonly string[]
  /** Wires driven by more than one gate, which is a short. */
  contended: readonly string[]
  /** Outputs named that nothing produces. */
  missingOutputs: readonly string[]
  /** True when a gate's output feeds back round to its own input, directly or through others. */
  hasFeedback: boolean
  /** The feedback loops found, as wire names in order. */
  loops: readonly (readonly string[])[]
  /** Gate levels from the inputs to the deepest output. Null when feedback makes depth meaningless. */
  depth: number | null
  problems: readonly string[]
  notes: readonly string[]
}

/**
 * Looks a network over before running it.
 *
 * Every problem is reported rather than the first, because a network with three floating wires should be fixed in one
 * pass and not three.
 */
export function checkNetwork(network: Network): NetworkCheck | LogicError {
  if (network.gates.length === 0) return refuse('empty', 'There are no gates.', 'Add at least one gate.')
  if (network.gates.length > LIMITS.gates) {
    return refuse('too many gates', `${network.gates.length} gates is more than this will work with.`, `Keep it under ${LIMITS.gates}.`)
  }
  if (network.inputs.length > LIMITS.inputs) {
    return refuse(
      'too many inputs',
      `${network.inputs.length} inputs means ${(2 ** network.inputs.length).toLocaleString()} rows in a truth table.`,
      `Use ${LIMITS.inputs} or fewer.`
    )
  }

  const driven = new Map<string, string[]>()
  const read = new Set<string>()
  const problems: string[] = []
  const seenIds = new Set<string>()

  for (const gate of network.gates) {
    if (seenIds.has(gate.id)) problems.push(`Two gates are both called "${gate.id}".`)
    seenIds.add(gate.id)
    const facts = GATE_FACTS[gate.kind]
    if (facts === undefined) {
      problems.push(`"${gate.id}" is a "${String(gate.kind)}", which is not a gate.`)
      continue
    }
    if (facts.arity !== null && gate.from.length !== facts.arity) {
      problems.push(`${gate.id} is a ${facts.label} with ${gate.from.length} inputs; it takes ${facts.arity}.`)
    }
    if (facts.arity === null && gate.from.length < 2) {
      problems.push(`${gate.id} is a ${facts.label} with ${gate.from.length} input${gate.from.length === 1 ? '' : 's'}; it needs at least two.`)
    }
    const held = driven.get(gate.to)
    if (held === undefined) driven.set(gate.to, [gate.id])
    else held.push(gate.id)
    for (const wire of gate.from) read.add(wire)
  }

  const contended: string[] = []
  for (const [wire, by] of driven) {
    if (by.length > 1) {
      contended.push(wire)
      problems.push(`${by.join(' and ')} all drive "${wire}". Two gates driving one wire is a short.`)
    }
  }

  const supplied = new Set([...network.inputs, ...driven.keys()])
  const floating = [...read].filter((wire) => !supplied.has(wire)).sort()
  for (const wire of floating) problems.push(`"${wire}" is read by a gate and driven by nothing.`)

  const missingOutputs = network.outputs.filter((wire) => !supplied.has(wire)).sort()
  for (const wire of missingOutputs) problems.push(`"${wire}" is named as an output and nothing produces it.`)

  /*
   * Feedback, found by walking the wire graph.
   *
   * Reported rather than refused: a loop is how a latch stores a bit, and a logic laboratory that could not build one
   * would be missing half the subject. What it costs is the depth — a network with feedback has no finite number of
   * levels, so `depth` becomes null and the honest answer is that it has to be clocked instead.
   */
  const feedsInto = new Map<string, string[]>()
  for (const gate of network.gates) {
    const held = feedsInto.get(gate.to)
    if (held === undefined) feedsInto.set(gate.to, [...gate.from])
    else held.push(...gate.from)
  }

  const loops: string[][] = []
  const state = new Map<string, 0 | 1 | 2>()
  const path: string[] = []
  const walk = (wire: string): void => {
    const held = state.get(wire)
    if (held === 2) return
    if (held === 1) {
      const at = path.indexOf(wire)
      if (at >= 0) loops.push([...path.slice(at), wire])
      return
    }
    state.set(wire, 1)
    path.push(wire)
    for (const source of feedsInto.get(wire) ?? []) walk(source)
    path.pop()
    state.set(wire, 2)
  }
  for (const wire of [...network.outputs, ...driven.keys()]) walk(wire)

  const hasFeedback = loops.length > 0

  let depth: number | null = null
  if (!hasFeedback) {
    const levelOf = new Map<string, number>()
    for (const wire of network.inputs) levelOf.set(wire, 0)
    const level = (wire: string): number => {
      const held = levelOf.get(wire)
      if (held !== undefined) return held
      const sources = feedsInto.get(wire)
      if (sources === undefined) {
        levelOf.set(wire, 0)
        return 0
      }
      levelOf.set(wire, 0)
      const made = 1 + Math.max(0, ...sources.map((one) => level(one)))
      levelOf.set(wire, made)
      return made
    }
    depth = Math.max(0, ...network.outputs.map((one) => level(one)))
  }

  const notes: string[] = []
  if (hasFeedback) {
    notes.push(
      `This network feeds back on itself — ${loops.length === 1 ? 'one loop' : `${loops.length} loops`} — which is how memory is built rather than a mistake. A looping network has no fixed number of gate levels, so it has to be clocked rather than simply settled.`
    )
  } else if (depth !== null) {
    notes.push(
      `A signal passes through ${depth} gate${depth === 1 ? '' : 's'} on its longest path. That depth, not the number of gates, is what limits how fast it can be clocked.`
    )
  }
  const unread = [...driven.keys()].filter((wire) => !read.has(wire) && !network.outputs.includes(wire))
  if (unread.length > 0) {
    notes.push(`${unread.join(', ')} ${unread.length === 1 ? 'is' : 'are'} produced and never used. Not wrong, but nothing depends on ${unread.length === 1 ? 'it' : 'them'}.`)
  }

  return {
    ok: problems.length === 0,
    floating: Object.freeze(floating),
    contended: Object.freeze(contended),
    missingOutputs: Object.freeze(missingOutputs),
    hasFeedback,
    loops: Object.freeze(loops.map((one) => Object.freeze(one))),
    depth,
    problems: Object.freeze(problems),
    notes: Object.freeze(notes)
  }
}

export type Settled = 'settled' | 'oscillating' | 'still-moving'

export interface Evaluation {
  /** Every wire's final value. */
  wires: Readonly<Record<string, boolean>>
  /** What the named outputs came to. */
  outputs: Readonly<Record<string, boolean>>
  /** How many rounds of propagation it took. */
  rounds: number
  settled: Settled
  /** Wires that never stopped changing. Empty when it settled. */
  unstable: readonly string[]
  /** Said plainly. */
  says: string
}

/**
 * Runs the network until nothing changes.
 *
 * Every wire starts at the value given, or off. Each round recomputes every gate from the current wire values, which
 * is how a real circuit behaves: gates do not take turns, they all respond to whatever is on their inputs at once.
 *
 * A network that never settles is reported as oscillating rather than quietly returning the last round's values. A
 * ring of three inverters genuinely does oscillate, and saying so is the only honest answer.
 */
export function evaluate(
  network: Network,
  given: Readonly<Record<string, boolean>>,
  held: Readonly<Record<string, boolean>> = {}
): Evaluation | LogicError {
  const wires = new Map<string, boolean>()
  for (const wire of network.inputs) wires.set(wire, given[wire] === true)
  for (const gate of network.gates) if (!wires.has(gate.to)) wires.set(gate.to, held[gate.to] === true)
  for (const [wire, value] of Object.entries(held)) if (!network.inputs.includes(wire)) wires.set(wire, value === true)

  const changedIn = new Map<string, number>()
  let rounds = 0
  let settled: Settled = 'still-moving'

  for (; rounds < LIMITS.rounds; rounds += 1) {
    const next = new Map(wires)
    let moved = false
    for (const gate of network.gates) {
      const inputs = gate.from.map((wire) => wires.get(wire) === true)
      const made = gateOutput(gate.kind, inputs)
      if (isLogicError(made)) return made
      if (next.get(gate.to) !== made) {
        next.set(gate.to, made)
        moved = true
        changedIn.set(gate.to, (changedIn.get(gate.to) ?? 0) + 1)
      }
    }
    for (const [wire, value] of next) wires.set(wire, value)
    if (!moved) {
      settled = 'settled'
      break
    }
  }

  /*
   * A wire that changed in most of the rounds is oscillating rather than merely settling late. The threshold is
   * generous — a third of the rounds — because a deep network legitimately takes many rounds to settle while an
   * oscillator changes in nearly all of them.
   */
  const unstable =
    settled === 'settled'
      ? []
      : [...changedIn.entries()]
          .filter(([, count]) => count > LIMITS.rounds / 3)
          .map(([wire]) => wire)
          .sort()
  if (settled !== 'settled') settled = unstable.length > 0 ? 'oscillating' : 'still-moving'

  const outputs: Record<string, boolean> = {}
  for (const wire of network.outputs) outputs[wire] = wires.get(wire) === true

  return {
    wires: Object.freeze(Object.fromEntries(wires)),
    outputs: Object.freeze(outputs),
    rounds: rounds + (settled === 'settled' ? 1 : 0),
    settled,
    unstable: Object.freeze(unstable),
    says:
      settled === 'settled'
        ? `Settled after ${rounds + 1} round${rounds === 0 ? '' : 's'} of propagation.`
        : settled === 'oscillating'
          ? `It never settles: ${unstable.join(', ')} keep${unstable.length === 1 ? 's' : ''} changing. A loop with an odd number of inversions in it oscillates rather than holding a value — which is how a ring oscillator works, and why a latch needs an even number.`
          : `Still changing after ${LIMITS.rounds} rounds. The network may be very deep, or it may be oscillating slowly.`
  }
}

// ---------------------------------------------------------------- truth tables

export interface TruthRow {
  inputs: Readonly<Record<string, boolean>>
  outputs: Readonly<Record<string, boolean>>
  settled: Settled
}

export interface TruthTable {
  inputs: readonly string[]
  outputs: readonly string[]
  rows: readonly TruthRow[]
  /** Rows where the network did not settle. Empty for ordinary combinational logic. */
  unsettled: number
  /** For each output, the input combinations that turn it on, as minterm numbers. */
  minterms: Readonly<Record<string, readonly number[]>>
  notes: readonly string[]
}

/** Builds the truth table by running the network for every input combination. */
export function truthTable(network: Network): TruthTable | LogicError {
  const check = checkNetwork(network)
  if (isLogicError(check)) return check
  if (!check.ok) {
    return refuse('network has problems', check.problems[0] ?? 'The network is not valid.', 'Fix the wiring first; the full list is in the check.')
  }
  if (network.inputs.length === 0) return refuse('no inputs', 'A truth table needs inputs.', 'Name at least one input wire.')

  const combinations = 2 ** network.inputs.length
  const rows: TruthRow[] = []
  const minterms: Record<string, number[]> = {}
  for (const wire of network.outputs) minterms[wire] = []
  let unsettled = 0

  for (let n = 0; n < combinations; n += 1) {
    const given: Record<string, boolean> = {}
    // The most significant bit is the first input, so the table reads in the order somebody expects.
    for (let i = 0; i < network.inputs.length; i += 1) {
      given[network.inputs[i]] = ((n >> (network.inputs.length - 1 - i)) & 1) === 1
    }
    const made = evaluate(network, given)
    if (isLogicError(made)) return made
    if (made.settled !== 'settled') unsettled += 1
    for (const wire of network.outputs) if (made.outputs[wire]) minterms[wire].push(n)
    rows.push({ inputs: Object.freeze(given), outputs: made.outputs, settled: made.settled })
  }

  const notes: string[] = []
  if (unsettled > 0) {
    notes.push(
      `${unsettled} of the ${combinations} rows never settled. A network with feedback has no single truth table — what it outputs depends on what it was already holding, which is what makes it memory.`
    )
  }
  for (const wire of network.outputs) {
    const on = minterms[wire].length
    if (on === 0) notes.push(`"${wire}" is never on, whatever the inputs.`)
    else if (on === combinations) notes.push(`"${wire}" is always on, whatever the inputs.`)
  }

  return {
    inputs: Object.freeze([...network.inputs]),
    outputs: Object.freeze([...network.outputs]),
    rows: Object.freeze(rows),
    unsettled,
    minterms: Object.freeze(Object.fromEntries(Object.entries(minterms).map(([k, v]) => [k, Object.freeze(v)]))),
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- simplification

export interface Simplified {
  /** The expression, in sum-of-products form, as text. */
  expression: string
  /** Each product term, as the literals in it. */
  terms: readonly (readonly { input: string; on: boolean }[])[]
  /** Literals before and after, which is the measure of how much was saved. */
  literalsBefore: number
  literalsAfter: number
  says: string
}

/**
 * Reduces a function to a sum of products, by the Quine-McCluskey method.
 *
 * ## Why this and not a Karnaugh map
 *
 * A Karnaugh map is a way of doing this by eye and only works up to about four inputs. Quine-McCluskey is the same
 * reduction done mechanically, works for any number, and — importantly — is *exact*: it finds a minimal cover rather
 * than a good one. So the result can be stated as minimal rather than as "simplified", which is a different claim.
 *
 * The prime-implicant chart is solved greedily after the essential implicants are taken, which is exact for every
 * function up to the sizes this engine allows and is noted where it might not be.
 */
export function simplify(table: TruthTable, output: string): Simplified | LogicError {
  if (!table.outputs.includes(output)) {
    return refuse('no such output', `"${output}" is not one of the outputs.`, `The outputs are: ${table.outputs.join(', ')}.`)
  }
  if (table.unsettled > 0) {
    return refuse(
      'not combinational',
      'This network holds state, so it has no single expression.',
      'Simplification only applies to logic whose output depends only on its inputs.'
    )
  }

  const bits = table.inputs.length
  const ones = table.minterms[output] ?? []
  if (ones.length === 0) {
    return { expression: '0', terms: Object.freeze([]), literalsBefore: 0, literalsAfter: 0, says: `"${output}" is never on, so the expression is simply 0.` }
  }
  if (ones.length === 2 ** bits) {
    return { expression: '1', terms: Object.freeze([]), literalsBefore: 0, literalsAfter: 0, says: `"${output}" is always on, so the expression is simply 1.` }
  }

  /** A term as a string of '0', '1' and '-' for "does not matter". */
  type Implicant = { bits: string; covers: readonly number[] }
  const asBits = (n: number): string => n.toString(2).padStart(bits, '0')

  let current: Implicant[] = ones.map((n) => ({ bits: asBits(n), covers: [n] }))
  const primes: Implicant[] = []

  // Combine terms differing in exactly one position, repeatedly, until nothing more combines.
  for (let round = 0; round < bits + 1 && current.length > 0; round += 1) {
    const used = new Set<number>()
    const next: Implicant[] = []
    const seen = new Set<string>()
    for (let i = 0; i < current.length; i += 1) {
      for (let j = i + 1; j < current.length; j += 1) {
        let differ = -1
        let count = 0
        for (let k = 0; k < bits; k += 1) {
          if (current[i].bits[k] !== current[j].bits[k]) {
            differ = k
            count += 1
            if (count > 1) break
          }
        }
        if (count !== 1) continue
        used.add(i)
        used.add(j)
        const made = current[i].bits.slice(0, differ) + '-' + current[i].bits.slice(differ + 1)
        if (seen.has(made)) continue
        seen.add(made)
        next.push({ bits: made, covers: [...new Set([...current[i].covers, ...current[j].covers])].sort((a, b) => a - b) })
      }
    }
    for (let i = 0; i < current.length; i += 1) if (!used.has(i)) primes.push(current[i])
    current = next
  }
  for (const one of current) primes.push(one)

  // The chart: which prime implicants cover which minterms.
  const needed = new Set(ones)
  const chosen: Implicant[] = []

  // Essential implicants first: a minterm covered by exactly one prime forces that prime into the answer.
  for (const n of ones) {
    const covering = primes.filter((one) => one.covers.includes(n))
    if (covering.length === 1 && !chosen.includes(covering[0])) chosen.push(covering[0])
  }
  for (const one of chosen) for (const n of one.covers) needed.delete(n)

  // Then the largest remaining cover each time, until everything is covered.
  while (needed.size > 0) {
    let best: Implicant | null = null
    let bestCount = 0
    for (const one of primes) {
      if (chosen.includes(one)) continue
      const count = one.covers.filter((n) => needed.has(n)).length
      if (count > bestCount) {
        best = one
        bestCount = count
      }
    }
    if (best === null) break
    chosen.push(best)
    for (const n of best.covers) needed.delete(n)
  }

  const terms = chosen.map((one) =>
    Object.freeze(
      [...one.bits]
        .map((bit, at) => ({ bit, at }))
        .filter(({ bit }) => bit !== '-')
        .map(({ bit, at }) => ({ input: table.inputs[at], on: bit === '1' }))
    )
  )
  const literalsAfter = terms.reduce((a, b) => a + b.length, 0)
  const literalsBefore = ones.length * bits

  const expression =
    terms.length === 0
      ? '0'
      : terms
          .map((term) => (term.length === 0 ? '1' : term.map((one) => (one.on ? one.input : `${one.input}'`)).join('·')))
          .join(' + ')

  return {
    expression,
    terms: Object.freeze(terms),
    literalsBefore,
    literalsAfter,
    says:
      literalsAfter < literalsBefore
        ? `The same function in ${literalsAfter} literal${literalsAfter === 1 ? '' : 's'} instead of ${literalsBefore} — ${terms.length} term${terms.length === 1 ? '' : 's'} rather than ${ones.length}. This is minimal, not merely shorter.`
        : `Already minimal at ${literalsAfter} literals; there was nothing to combine.`
  }
}

// ---------------------------------------------------------------- the ones worth having ready

/** Builds a network for one of the standard building blocks, so somebody can look at a real one. */
export type Blueprint =
  | 'half-adder'
  | 'full-adder'
  | 'ripple-adder-4'
  | 'multiplexer-2'
  | 'multiplexer-4'
  | 'decoder-2-4'
  | 'comparator-2'
  | 'sr-latch'
  | 'd-latch'
  | 'ring-oscillator'
  | 'xor-from-nand'
  | 'parity-4'

export const BLUEPRINTS: readonly Blueprint[] = Object.freeze([
  'half-adder',
  'full-adder',
  'ripple-adder-4',
  'multiplexer-2',
  'multiplexer-4',
  'decoder-2-4',
  'comparator-2',
  'parity-4',
  'xor-from-nand',
  'sr-latch',
  'd-latch',
  'ring-oscillator'
])

export const BLUEPRINT_ABOUT: Readonly<Record<Blueprint, string>> = Object.freeze({
  'half-adder': 'Adds two bits. The sum is their XOR and the carry is their AND — two gates, and it is the whole idea of addition.',
  'full-adder': 'Adds two bits and a carry in. Chain these and you have arithmetic.',
  'ripple-adder-4': 'Four full adders in a row, adding two four-bit numbers. The carry has to travel the whole way, which is why it is slow and why faster adders exist.',
  'multiplexer-2': 'Picks one of two inputs, according to a select line. This is the gate-level version of an if.',
  'multiplexer-4': 'Picks one of four inputs, using two select lines.',
  'decoder-2-4': 'Turns a two-bit number into one of four lines being on. How an address picks a memory row.',
  'comparator-2': 'Says whether two two-bit numbers are equal, and which is larger.',
  'parity-4': 'On when an odd number of its four inputs are on. One XOR tree, and the basis of simple error detection.',
  'xor-from-nand': 'An XOR built from four NAND gates, to show that NAND alone is enough to build anything.',
  'sr-latch': 'Two NOR gates feeding each other. It remembers a bit — and setting both inputs at once is the forbidden state, which this will show you rather than hide.',
  'd-latch': 'An SR latch with an enable, so it stores whatever D is while enable is on and holds it when enable goes off.',
  'ring-oscillator': 'Three inverters in a loop. It cannot settle, and never will — which is what an odd number of inversions in a loop does.'
})

export function blueprint(which: Blueprint): Network | LogicError {
  switch (which) {
    case 'half-adder':
      return {
        name: 'Half adder',
        inputs: ['a', 'b'],
        outputs: ['sum', 'carry'],
        gates: [
          { id: 'x1', kind: 'xor', from: ['a', 'b'], to: 'sum', label: 'sum' },
          { id: 'a1', kind: 'and', from: ['a', 'b'], to: 'carry', label: 'carry' }
        ]
      }
    case 'full-adder':
      return {
        name: 'Full adder',
        inputs: ['a', 'b', 'cin'],
        outputs: ['sum', 'cout'],
        gates: [
          { id: 'x1', kind: 'xor', from: ['a', 'b'], to: 'p' },
          { id: 'x2', kind: 'xor', from: ['p', 'cin'], to: 'sum' },
          { id: 'a1', kind: 'and', from: ['a', 'b'], to: 'g' },
          { id: 'a2', kind: 'and', from: ['p', 'cin'], to: 'h' },
          { id: 'o1', kind: 'or', from: ['g', 'h'], to: 'cout' }
        ]
      }
    case 'ripple-adder-4': {
      const gates: Gate[] = []
      for (let i = 0; i < 4; i += 1) {
        const cin = i === 0 ? 'cin' : `c${i}`
        const cout = i === 3 ? 'cout' : `c${i + 1}`
        gates.push(
          { id: `x${i}a`, kind: 'xor', from: [`a${i}`, `b${i}`], to: `p${i}` },
          { id: `x${i}b`, kind: 'xor', from: [`p${i}`, cin], to: `s${i}` },
          { id: `a${i}a`, kind: 'and', from: [`a${i}`, `b${i}`], to: `g${i}` },
          { id: `a${i}b`, kind: 'and', from: [`p${i}`, cin], to: `h${i}` },
          { id: `o${i}`, kind: 'or', from: [`g${i}`, `h${i}`], to: cout }
        )
      }
      return {
        name: 'Four-bit ripple-carry adder',
        inputs: ['a0', 'a1', 'a2', 'a3', 'b0', 'b1', 'b2', 'b3', 'cin'],
        outputs: ['s0', 's1', 's2', 's3', 'cout'],
        gates
      }
    }
    case 'multiplexer-2':
      return {
        name: 'Two-way multiplexer',
        inputs: ['d0', 'd1', 'sel'],
        outputs: ['y'],
        gates: [
          { id: 'n1', kind: 'not', from: ['sel'], to: 'nsel' },
          { id: 'a1', kind: 'and', from: ['d0', 'nsel'], to: 'p0' },
          { id: 'a2', kind: 'and', from: ['d1', 'sel'], to: 'p1' },
          { id: 'o1', kind: 'or', from: ['p0', 'p1'], to: 'y' }
        ]
      }
    case 'multiplexer-4':
      return {
        name: 'Four-way multiplexer',
        inputs: ['d0', 'd1', 'd2', 'd3', 's0', 's1'],
        outputs: ['y'],
        gates: [
          { id: 'n0', kind: 'not', from: ['s0'], to: 'ns0' },
          { id: 'n1', kind: 'not', from: ['s1'], to: 'ns1' },
          { id: 'a0', kind: 'and', from: ['d0', 'ns0', 'ns1'], to: 'p0' },
          { id: 'a1', kind: 'and', from: ['d1', 's0', 'ns1'], to: 'p1' },
          { id: 'a2', kind: 'and', from: ['d2', 'ns0', 's1'], to: 'p2' },
          { id: 'a3', kind: 'and', from: ['d3', 's0', 's1'], to: 'p3' },
          { id: 'o1', kind: 'or', from: ['p0', 'p1', 'p2', 'p3'], to: 'y' }
        ]
      }
    case 'decoder-2-4':
      return {
        name: 'Two-to-four decoder',
        inputs: ['a0', 'a1'],
        outputs: ['y0', 'y1', 'y2', 'y3'],
        gates: [
          { id: 'n0', kind: 'not', from: ['a0'], to: 'na0' },
          { id: 'n1', kind: 'not', from: ['a1'], to: 'na1' },
          { id: 'g0', kind: 'and', from: ['na0', 'na1'], to: 'y0' },
          { id: 'g1', kind: 'and', from: ['a0', 'na1'], to: 'y1' },
          { id: 'g2', kind: 'and', from: ['na0', 'a1'], to: 'y2' },
          { id: 'g3', kind: 'and', from: ['a0', 'a1'], to: 'y3' }
        ]
      }
    case 'comparator-2':
      return {
        name: 'Two-bit comparator',
        inputs: ['a0', 'a1', 'b0', 'b1'],
        outputs: ['equal', 'aBigger'],
        gates: [
          { id: 'e1', kind: 'xnor', from: ['a1', 'b1'], to: 'eh' },
          { id: 'e0', kind: 'xnor', from: ['a0', 'b0'], to: 'el' },
          { id: 'eq', kind: 'and', from: ['eh', 'el'], to: 'equal' },
          { id: 'nb1', kind: 'not', from: ['b1'], to: 'nb1w' },
          { id: 'nb0', kind: 'not', from: ['b0'], to: 'nb0w' },
          { id: 'hi', kind: 'and', from: ['a1', 'nb1w'], to: 'highWins' },
          { id: 'lo', kind: 'and', from: ['eh', 'a0', 'nb0w'], to: 'lowWins' },
          { id: 'big', kind: 'or', from: ['highWins', 'lowWins'], to: 'aBigger' }
        ]
      }
    case 'parity-4':
      return {
        name: 'Four-bit parity',
        inputs: ['b0', 'b1', 'b2', 'b3'],
        outputs: ['odd'],
        gates: [
          { id: 'x1', kind: 'xor', from: ['b0', 'b1'], to: 'p0' },
          { id: 'x2', kind: 'xor', from: ['b2', 'b3'], to: 'p1' },
          { id: 'x3', kind: 'xor', from: ['p0', 'p1'], to: 'odd' }
        ]
      }
    case 'xor-from-nand':
      return {
        name: 'XOR from four NANDs',
        inputs: ['a', 'b'],
        outputs: ['y'],
        gates: [
          { id: 'n1', kind: 'nand', from: ['a', 'b'], to: 'w1' },
          { id: 'n2', kind: 'nand', from: ['a', 'w1'], to: 'w2' },
          { id: 'n3', kind: 'nand', from: ['w1', 'b'], to: 'w3' },
          { id: 'n4', kind: 'nand', from: ['w2', 'w3'], to: 'y' }
        ]
      }
    case 'sr-latch':
      return {
        name: 'SR latch',
        inputs: ['s', 'r'],
        outputs: ['q', 'qbar'],
        gates: [
          { id: 'nr1', kind: 'nor', from: ['r', 'qbar'], to: 'q' },
          { id: 'nr2', kind: 'nor', from: ['s', 'q'], to: 'qbar' }
        ]
      }
    case 'd-latch':
      return {
        name: 'D latch',
        inputs: ['d', 'enable'],
        outputs: ['q', 'qbar'],
        gates: [
          { id: 'nd', kind: 'not', from: ['d'], to: 'nd' },
          { id: 'as', kind: 'and', from: ['d', 'enable'], to: 's' },
          { id: 'ar', kind: 'and', from: ['nd', 'enable'], to: 'r' },
          { id: 'nr1', kind: 'nor', from: ['r', 'qbar'], to: 'q' },
          { id: 'nr2', kind: 'nor', from: ['s', 'q'], to: 'qbar' }
        ]
      }
    case 'ring-oscillator':
      return {
        name: 'Ring oscillator',
        inputs: [],
        outputs: ['a'],
        gates: [
          { id: 'i1', kind: 'not', from: ['c'], to: 'a' },
          { id: 'i2', kind: 'not', from: ['a'], to: 'b' },
          { id: 'i3', kind: 'not', from: ['b'], to: 'c' }
        ]
      }
    default:
      return refuse('unknown blueprint', `There is no blueprint called "${String(which)}".`, `Try one of: ${BLUEPRINTS.join(', ')}.`)
  }
}

// ---------------------------------------------------------------- clocked logic

export type FlipFlopKind = 'd' | 'jk' | 't' | 'sr'

export const FLIP_FLOP_KINDS: readonly FlipFlopKind[] = Object.freeze(['d', 'jk', 't', 'sr'])

export const FLIP_FLOP_ABOUT: Readonly<Record<FlipFlopKind, string>> = Object.freeze({
  d: 'Stores whatever D was at the clock edge. The plain one, and what a register is made of.',
  jk: 'J sets, K clears, both together toggles. The most flexible, and the one that makes counters easy.',
  t: 'Toggles when T is on. A chain of these divides a clock in half each time, which is a counter.',
  sr: 'S sets, R clears. Both at once is not allowed, and this reports it rather than picking an answer.'
})

/** What a flip-flop goes to, given what it holds and what is on its inputs at the clock edge. */
export function flipFlopNext(kind: FlipFlopKind, holding: boolean, inputs: Readonly<Record<string, boolean>>): boolean | LogicError {
  switch (kind) {
    case 'd':
      return inputs.d === true
    case 't':
      return inputs.t === true ? !holding : holding
    case 'jk': {
      const j = inputs.j === true
      const k = inputs.k === true
      if (j && k) return !holding
      if (j) return true
      if (k) return false
      return holding
    }
    case 'sr': {
      const s = inputs.s === true
      const r = inputs.r === true
      if (s && r) {
        return refuse(
          'forbidden state',
          'An SR flip-flop cannot be set and cleared at once.',
          'In a real one both outputs would go low and what happens next depends on which input is released first. Use a JK if you want both-at-once to mean something.'
        )
      }
      if (s) return true
      if (r) return false
      return holding
    }
  }
}

export interface Register {
  id: string
  kind: FlipFlopKind
  /** Which wire feeds each of the flip-flop's inputs. */
  from: Readonly<Record<string, string>>
  /** The wire it drives. */
  to: string
  /** What it holds to begin with. */
  initial?: boolean
}

export interface Sequential {
  inputs: readonly string[]
  outputs: readonly string[]
  gates: readonly Gate[]
  registers: readonly Register[]
  name?: string
}

export interface Tick {
  tick: number
  /** Every wire, after the combinational logic settled and before the clock edge. */
  wires: Readonly<Record<string, boolean>>
  /** What each register holds after the edge. */
  holding: Readonly<Record<string, boolean>>
  outputs: Readonly<Record<string, boolean>>
  settled: Settled
  /** Set when something went wrong at this tick, such as a forbidden flip-flop state. */
  problem: string | null
}

export interface Run {
  ticks: readonly Tick[]
  /** True when the state repeated, which means the machine is in a cycle. */
  cycles: boolean
  /** The length of that cycle, when there is one. */
  cycleLength: number | null
  /** Which tick the cycle started at. */
  cycleFrom: number | null
  says: string
  notes: readonly string[]
}

/**
 * Runs a clocked circuit for a number of ticks.
 *
 * Each tick: the combinational logic settles with the registers holding what they hold, then the clock edge happens
 * and every register takes its new value **at once** from what it saw. Doing it at once rather than one at a time is
 * what makes a shift register shift rather than collapse, and getting it wrong is the classic mistake.
 */
export function runClocked(
  circuit: Sequential,
  given: readonly Readonly<Record<string, boolean>>[],
  ticks: number
): Run | LogicError {
  if (ticks < 1) return refuse('no ticks', 'There is nothing to run.', 'Ask for at least one tick.')
  if (ticks > LIMITS.ticks) return refuse('too many ticks', `${ticks} ticks is more than this will run.`, `Keep it under ${LIMITS.ticks}.`)
  if (circuit.registers.length === 0) {
    return refuse(
      'nothing to clock',
      'This circuit has no flip-flops, so a clock does nothing to it.',
      'Use the truth table instead, or add a register.'
    )
  }

  const holding = new Map<string, boolean>()
  for (const register of circuit.registers) holding.set(register.id, register.initial === true)

  const out: Tick[] = []
  const seen = new Map<string, number>()
  let cycles = false
  let cycleLength: number | null = null
  let cycleFrom: number | null = null

  for (let tick = 0; tick < ticks; tick += 1) {
    // Register outputs are wires with values held from the last edge.
    const held: Record<string, boolean> = {}
    for (const register of circuit.registers) held[register.to] = holding.get(register.id) === true

    const inputs = given[Math.min(tick, given.length - 1)] ?? {}
    const network: Network = { inputs: circuit.inputs, outputs: circuit.outputs, gates: circuit.gates }
    const settledNow = evaluate(network, inputs, held)
    if (isLogicError(settledNow)) return settledNow

    // The clock edge: every register reads at once, then they all change at once.
    const next = new Map<string, boolean>()
    let problem: string | null = null
    for (const register of circuit.registers) {
      const feed: Record<string, boolean> = {}
      for (const [pin, wire] of Object.entries(register.from)) {
        feed[pin] = settledNow.wires[wire] === true || inputs[wire] === true || held[wire] === true
      }
      const made = flipFlopNext(register.kind, holding.get(register.id) === true, feed)
      if (isLogicError(made)) {
        problem = `${register.id}: ${made.says} ${made.fix}`
        next.set(register.id, holding.get(register.id) === true)
        continue
      }
      next.set(register.id, made)
    }

    out.push({
      tick,
      wires: settledNow.wires,
      holding: Object.freeze(Object.fromEntries([...holding].map(([k, v]) => [k, v]))),
      outputs: settledNow.outputs,
      settled: settledNow.settled,
      problem
    })

    // State repeating means a cycle, which for a counter is the whole point.
    const fingerprint = [...next.entries()].sort().map(([k, v]) => `${k}=${v ? 1 : 0}`).join(',')
    if (!cycles && given.length <= 1) {
      const before = seen.get(fingerprint)
      if (before !== undefined) {
        cycles = true
        cycleFrom = before
        cycleLength = tick + 1 - before
      } else seen.set(fingerprint, tick + 1)
    }

    for (const [id, value] of next) holding.set(id, value)
  }

  const problems = out.filter((one) => one.problem !== null).length
  const notes: string[] = []
  if (problems > 0) notes.push(`${problems} of the ${out.length} ticks hit a problem. Each one is on the tick it happened.`)
  if (out.some((one) => one.settled !== 'settled')) {
    notes.push('On some ticks the combinational logic did not settle before the clock edge. In a real circuit that is a timing violation and the register would latch an undefined value.')
  }

  return {
    ticks: Object.freeze(out),
    cycles,
    cycleLength,
    cycleFrom,
    says:
      cycles && cycleLength !== null
        ? `It repeats every ${cycleLength} tick${cycleLength === 1 ? '' : 's'}, from tick ${cycleFrom}. A circuit of ${circuit.registers.length} flip-flops has ${2 ** circuit.registers.length} possible states, so a cycle of ${cycleLength} uses ${((cycleLength / 2 ** circuit.registers.length) * 100).toFixed(0)}% of them.`
        : `Ran for ${out.length} tick${out.length === 1 ? '' : 's'} without repeating a state.`,
    notes: Object.freeze(notes)
  }
}

/** A counter of a chosen width, built from T flip-flops. */
export function counter(bits: number): Sequential | LogicError {
  if (bits < 1 || bits > 8) return refuse('out of range', 'A counter here is between one and eight bits.', 'Pick a width in that range.')
  const gates: Gate[] = []
  const registers: Register[] = []
  const outputs: string[] = []

  for (let i = 0; i < bits; i += 1) {
    outputs.push(`q${i}`)
    // Bit 0 toggles every tick; each higher bit toggles when every bit below it is already on.
    if (i === 0) {
      registers.push({ id: `ff0`, kind: 't', from: { t: 'enable' }, to: 'q0', initial: false })
    } else {
      const below = Array.from({ length: i }, (_, k) => `q${k}`)
      gates.push({ id: `and${i}`, kind: 'and', from: [...below, 'enable'], to: `t${i}` })
      registers.push({ id: `ff${i}`, kind: 't', from: { t: `t${i}` }, to: `q${i}`, initial: false })
    }
  }

  return { name: `${bits}-bit counter`, inputs: ['enable'], outputs, gates, registers }
}

/** A shift register of a chosen width, built from D flip-flops. */
export function shiftRegister(bits: number): Sequential | LogicError {
  if (bits < 2 || bits > 8) return refuse('out of range', 'A shift register here is between two and eight bits.', 'Pick a width in that range.')
  const registers: Register[] = []
  const outputs: string[] = []
  for (let i = 0; i < bits; i += 1) {
    outputs.push(`q${i}`)
    registers.push({ id: `ff${i}`, kind: 'd', from: { d: i === 0 ? 'in' : `q${i - 1}` }, to: `q${i}`, initial: false })
  }
  return { name: `${bits}-bit shift register`, inputs: ['in'], outputs, gates: [], registers }
}

export const LOGIC_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Gates are ideal: no propagation delay in time, no rise or fall time, no fan-out limit and no power supply.',
  'Delay is counted in gate levels rather than nanoseconds, because real timing depends on the technology, the load and the wiring, none of which is modelled here.',
  'Every wire is either on or off. There is no high-impedance state, no undefined level and no analogue behaviour between the two.',
  'A clock edge is instant, and every register reads before any of them changes. A real circuit has setup and hold times that this does not model.',
  'Glitches are not shown. A combinational network can momentarily output the wrong value while it settles, and only the settled value is reported.'
])

export { LIMITS as LOGIC_LIMITS }
