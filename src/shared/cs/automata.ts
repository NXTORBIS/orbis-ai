/**
 * Finite machines: run them, and turn one kind into the other.
 *
 * ## Three things, because two of them only mean something next to the third
 *
 * A deterministic machine is easy to run and tedious to write. A machine that may be in several states at once is
 * easy to write and cannot be run by following one arrow. The subset construction turns the second into the first,
 * and it is the only proof that the two describe exactly the same languages — which is the single most important
 * fact in the subject and is impossible to believe from a sentence.
 *
 * So: run a DFA step by step, run an NFA as a set of states, and build the DFA that an NFA is equivalent to, with
 * every subset that appears named after the states in it.
 *
 * ## A rejection says why
 *
 * Three different things get called "rejected": the string used a symbol the machine has no alphabet for, the
 * machine had no arrow to follow, or it followed every arrow and finished somewhere that is not an accepting
 * state. Those are different mistakes and the trace names which one happened.
 *
 * Pure. No clock, no randomness.
 */

export interface AutomatonError {
  error: 'empty' | 'unknown-state' | 'unknown-symbol' | 'too-big' | 'input' | 'no-start'
  message: string
  fix: string
}

export const isAutomatonError = (value: unknown): value is AutomatonError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>) && 'fix' in (value as Record<string, unknown>)

const fail = (error: AutomatonError['error'], message: string, fix: string): AutomatonError => ({ error, message, fix })

export const LIMITS = Object.freeze({ states: 40, symbols: 12, input: 500, subsets: 256 })

/** The symbol that means "move without reading anything". Written as ε everywhere it is shown. */
export const EMPTY = 'ε'

export interface Machine {
  /** Every state, in the order they should be shown. */
  states: readonly string[]
  /** The symbols it reads. Never includes ε — that is handled separately. */
  alphabet: readonly string[]
  /**
   * Where each arrow goes: `transitions[state][symbol]` is the list of states it may move to.
   *
   * A list even for a deterministic machine, so one shape serves both and `deterministic()` is a question that
   * can be asked rather than a promise the type makes and the data quietly breaks.
   */
  transitions: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>
  start: string
  accept: readonly string[]
}

/** Whether every state has exactly one arrow per symbol and no ε moves. The answer, not an assumption. */
export function deterministic(machine: Machine): { yes: boolean; why: string } {
  for (const state of machine.states) {
    const out = machine.transitions[state] ?? {}
    if ((out[EMPTY] ?? []).length > 0) return { yes: false, why: `${state} has an ε move, and a deterministic machine has none.` }
    for (const symbol of machine.alphabet) {
      const to = out[symbol] ?? []
      if (to.length === 0) return { yes: false, why: `${state} has no arrow for "${symbol}", so the machine can get stuck.` }
      if (to.length > 1) return { yes: false, why: `${state} has ${to.length} arrows for "${symbol}", so it would be in two places at once.` }
    }
  }
  return { yes: true, why: 'Every state has exactly one arrow for every symbol, and there are no ε moves.' }
}

function check(machine: Machine): AutomatonError | null {
  if (!machine || !Array.isArray(machine.states) || machine.states.length === 0) {
    return fail('empty', 'The machine has no states.', 'Add at least one state.')
  }
  if (machine.states.length > LIMITS.states) {
    return fail('too-big', `${machine.states.length} states is more than this runs.`, `Use at most ${LIMITS.states}.`)
  }
  if (machine.alphabet.length === 0) return fail('empty', 'The alphabet is empty, so the machine can read nothing.', 'Add a symbol.')
  if (machine.alphabet.length > LIMITS.symbols) {
    return fail('too-big', `${machine.alphabet.length} symbols is more than this shows.`, `Use at most ${LIMITS.symbols}.`)
  }
  if (!machine.states.includes(machine.start)) {
    return fail('no-start', `The start state "${machine.start}" is not one of the states.`, 'Pick a start state that exists.')
  }
  for (const one of machine.accept) {
    if (!machine.states.includes(one)) return fail('unknown-state', `"${one}" is an accepting state and is not in the list of states.`, 'Remove it, or add the state.')
  }
  for (const [from, out] of Object.entries(machine.transitions)) {
    if (!machine.states.includes(from)) return fail('unknown-state', `There are arrows out of "${from}", which is not a state.`, 'Add the state, or remove its arrows.')
    for (const [symbol, to] of Object.entries(out)) {
      if (symbol !== EMPTY && !machine.alphabet.includes(symbol)) {
        return fail('unknown-symbol', `"${from}" has an arrow for "${symbol}", which is not in the alphabet.`, 'Add it to the alphabet, or remove the arrow.')
      }
      for (const one of to) {
        if (!machine.states.includes(one)) return fail('unknown-state', `An arrow from "${from}" goes to "${one}", which is not a state.`, 'Add the state, or fix the arrow.')
      }
    }
  }
  return null
}

// ---------------------------------------------------------------- running it

export interface Step {
  /** Which character of the input this step read. -1 for the starting position. */
  at: number
  symbol: string
  /** Where the machine was before reading it. */
  from: readonly string[]
  /** Where it is after. */
  to: readonly string[]
  says: string
}

export interface RunReport {
  accepted: boolean
  steps: readonly Step[]
  /** The states it finished in. */
  ended: readonly string[]
  /** Why it did not accept, when it did not. Null when it did. */
  rejected: 'symbol-not-in-alphabet' | 'nowhere-to-go' | 'not-an-accepting-state' | null
  says: string
  notes: readonly string[]
}

/** Every state reachable from these by ε moves alone, including the ones given. */
function closure(machine: Machine, states: readonly string[]): string[] {
  const out = new Set(states)
  const todo = [...states]
  while (todo.length > 0) {
    const one = todo.pop() as string
    for (const next of machine.transitions[one]?.[EMPTY] ?? []) {
      if (!out.has(next)) {
        out.add(next)
        todo.push(next)
      }
    }
  }
  return [...out].sort()
}

/**
 * Feed a string to the machine.
 *
 * Works for both kinds, because the current position is always a *set* of states — one state for a deterministic
 * machine, which is exactly what deterministic means.
 */
export function runMachine(machine: Machine, input: string): RunReport | AutomatonError {
  const bad = check(machine)
  if (bad) return bad
  if (typeof input !== 'string') return fail('input', 'The input has to be text.', 'Type a string to test.')
  if (input.length > LIMITS.input) return fail('too-big', `That string is ${input.length} long.`, `Use at most ${LIMITS.input} characters.`)

  const steps: Step[] = []
  let now = closure(machine, [machine.start])
  const hasEmpty = machine.states.some((one) => (machine.transitions[one]?.[EMPTY] ?? []).length > 0)

  steps.push({
    at: -1,
    symbol: '',
    from: [],
    to: [...now],
    says: hasEmpty && now.length > 1 ? `start at ${machine.start}, and ε moves reach ${now.join(', ')}` : `start at ${machine.start}`
  })

  for (let at = 0; at < input.length; at += 1) {
    const symbol = input[at]
    if (!machine.alphabet.includes(symbol)) {
      steps.push({ at, symbol, from: [...now], to: [], says: `"${symbol}" is not in the alphabet, so the machine cannot read it` })
      return {
        accepted: false,
        steps: Object.freeze(steps),
        ended: [],
        rejected: 'symbol-not-in-alphabet',
        says: `Rejected: "${symbol}" at position ${at} is not a symbol this machine reads.`,
        notes: Object.freeze([`The alphabet is ${machine.alphabet.join(', ')}.`])
      }
    }

    const next = closure(
      machine,
      now.flatMap((one) => [...(machine.transitions[one]?.[symbol] ?? [])])
    )
    steps.push({
      at,
      symbol,
      from: [...now],
      to: [...next],
      says:
        next.length === 0
          ? `read "${symbol}" — there is no arrow out of ${now.join(', ')} for it`
          : `read "${symbol}" — ${now.join(', ')} → ${next.join(', ')}`
    })

    if (next.length === 0) {
      return {
        accepted: false,
        steps: Object.freeze(steps),
        ended: [],
        rejected: 'nowhere-to-go',
        says: `Rejected: after reading ${at + 1} symbol${at === 0 ? '' : 's'} there was no arrow to follow.`,
        notes: Object.freeze(['Getting stuck is a rejection, and it is a different one from finishing in a non-accepting state.'])
      }
    }
    now = next
  }

  const accepted = now.some((one) => machine.accept.includes(one))
  return {
    accepted,
    steps: Object.freeze(steps),
    ended: Object.freeze([...now]),
    rejected: accepted ? null : 'not-an-accepting-state',
    says: accepted
      ? `Accepted: it finished in ${now.filter((one) => machine.accept.includes(one)).join(', ')}, which accepts.`
      : `Rejected: it finished in ${now.join(', ')}, and ${now.length === 1 ? 'that is not an accepting state' : 'none of those accepts'}.`,
    notes: Object.freeze([
      input.length === 0 ? 'The empty string was tested, so the answer depends only on whether the start state accepts.' : `${input.length} symbols read, ${steps.length - 1} moves made.`,
      ...(now.length > 1 ? [`It was in ${now.length} states at once, which only a non-deterministic machine can be.`] : [])
    ])
  }
}

// ---------------------------------------------------------------- turning one into the other

export interface SubsetReport {
  /** The deterministic machine built from the original. */
  machine: Machine
  /** Each new state, and which original states it stands for. */
  made: readonly { name: string; from: readonly string[]; accepting: boolean }[]
  /** Whether a dead state had to be added, and why. */
  deadState: string | null
  says: string
  notes: readonly string[]
}

/**
 * The subset construction: every set of states the original could be in becomes one state of a new machine.
 *
 * The new machine is deterministic by construction — from a set of states and a symbol there is exactly one set it
 * goes to. That is the whole proof, and watching the sets get named is how it stops being a trick.
 */
export function toDeterministic(machine: Machine): SubsetReport | AutomatonError {
  const bad = check(machine)
  if (bad) return bad

  const name = (states: readonly string[]): string => (states.length === 0 ? '∅' : `{${[...states].sort().join(',')}}`)

  const startSet = closure(machine, [machine.start])
  const seen = new Map<string, string[]>([[name(startSet), startSet]])
  const todo = [startSet]
  const transitions: Record<string, Record<string, string[]>> = {}
  let usedDead = false

  while (todo.length > 0) {
    const current = todo.pop() as string[]
    const key = name(current)
    transitions[key] = {}
    for (const symbol of machine.alphabet) {
      const next = closure(
        machine,
        current.flatMap((one) => [...(machine.transitions[one]?.[symbol] ?? [])])
      )
      const nextName = name(next)
      if (next.length === 0) usedDead = true
      transitions[key][symbol] = [nextName]
      if (!seen.has(nextName)) {
        if (seen.size >= LIMITS.subsets) {
          return fail('too-big', `The subset construction made more than ${LIMITS.subsets} states.`, 'Use a smaller machine — in the worst case this doubles for every state, and that is the point of it.')
        }
        seen.set(nextName, next)
        todo.push(next)
      }
    }
  }

  const states = [...seen.keys()].sort((a, b) => (a === name(startSet) ? -1 : b === name(startSet) ? 1 : a.localeCompare(b)))
  const accept = states.filter((one) => (seen.get(one) ?? []).some((two) => machine.accept.includes(two)))

  return {
    machine: {
      states,
      alphabet: machine.alphabet,
      transitions,
      start: name(startSet),
      accept
    },
    made: Object.freeze(
      states.map((one) => ({ name: one, from: Object.freeze([...(seen.get(one) ?? [])]), accepting: accept.includes(one) }))
    ),
    deadState: usedDead ? '∅' : null,
    says: `${machine.states.length} states became ${states.length}, of which ${accept.length} accept.`,
    notes: Object.freeze([
      'Each new state is named after the set of old states the machine could be in at that moment.',
      ...(usedDead ? ['∅ is the dead state: once there, nothing can escape, which is how "stuck" becomes a real state rather than a missing arrow.'] : []),
      states.length > machine.states.length
        ? `It grew from ${machine.states.length} to ${states.length}. In the worst case this doubles with every state, and that is why the construction is worth understanding rather than just using.`
        : `It did not grow, which happens when the original was nearly deterministic already.`
    ])
  }
}

// ---------------------------------------------------------------- machines worth starting from

export interface Preset {
  id: string
  name: string
  /** What the machine accepts, in words. The claim the trace either supports or does not. */
  accepts: string
  machine: Machine
}

const d = (
  transitions: Record<string, Record<string, string>>
): Record<string, Record<string, string[]>> =>
  Object.fromEntries(Object.entries(transitions).map(([from, out]) => [from, Object.fromEntries(Object.entries(out).map(([symbol, to]) => [symbol, [to]]))]))

export const PRESETS: readonly Preset[] = Object.freeze([
  {
    id: 'ends-00',
    name: 'Ends in 00',
    accepts: 'binary strings whose last two symbols are both 0',
    machine: {
      states: ['q0', 'q1', 'q2'],
      alphabet: ['0', '1'],
      transitions: d({ q0: { 0: 'q1', 1: 'q0' }, q1: { 0: 'q2', 1: 'q0' }, q2: { 0: 'q2', 1: 'q0' } }),
      start: 'q0',
      accept: ['q2']
    }
  },
  {
    id: 'even-zeros',
    name: 'An even number of 0s',
    accepts: 'binary strings containing an even number of 0s, including none at all',
    machine: {
      states: ['even', 'odd'],
      alphabet: ['0', '1'],
      transitions: d({ even: { 0: 'odd', 1: 'even' }, odd: { 0: 'even', 1: 'odd' } }),
      start: 'even',
      accept: ['even']
    }
  },
  {
    id: 'divisible-3',
    name: 'A multiple of three',
    accepts: 'binary numbers, read most significant bit first, that are divisible by 3',
    machine: {
      states: ['r0', 'r1', 'r2'],
      alphabet: ['0', '1'],
      // Reading a bit doubles the number and adds the bit, so the remainder goes r → 2r + bit, mod 3.
      transitions: d({ r0: { 0: 'r0', 1: 'r1' }, r1: { 0: 'r2', 1: 'r0' }, r2: { 0: 'r1', 1: 'r2' } }),
      start: 'r0',
      accept: ['r0']
    }
  },
  {
    id: 'contains-ab',
    name: 'Contains "ab"',
    accepts: 'strings over a and b in which "ab" appears somewhere',
    machine: {
      states: ['none', 'sawA', 'found'],
      alphabet: ['a', 'b'],
      transitions: d({ none: { a: 'sawA', b: 'none' }, sawA: { a: 'sawA', b: 'found' }, found: { a: 'found', b: 'found' } }),
      start: 'none',
      accept: ['found']
    }
  },
  {
    id: 'third-last-1',
    name: 'Third from the end is 1',
    accepts: 'binary strings whose third symbol from the end is a 1 — easy to write with choice, awkward without',
    machine: {
      // Non-deterministic on purpose: this is the machine the subset construction is worth running on.
      states: ['s', 'a', 'b', 'c'],
      alphabet: ['0', '1'],
      transitions: {
        s: { '0': ['s'], '1': ['s', 'a'] },
        a: { '0': ['b'], '1': ['b'] },
        b: { '0': ['c'], '1': ['c'] },
        c: {}
      },
      start: 's',
      accept: ['c']
    }
  },
  {
    id: 'ends-01-or-10',
    name: 'Ends in 01 or 10',
    accepts: 'binary strings ending in either 01 or 10 — written with ε moves to show two machines joined',
    machine: {
      states: ['start', 'p0', 'p1', 'pDone', 'q0', 'q1', 'qDone'],
      alphabet: ['0', '1'],
      transitions: {
        start: { [EMPTY]: ['p0', 'q0'] },
        p0: { '0': ['p0', 'p1'], '1': ['p0'] },
        p1: { '1': ['pDone'] },
        pDone: {},
        q0: { '0': ['q0'], '1': ['q0', 'q1'] },
        q1: { '0': ['qDone'] },
        qDone: {}
      },
      start: 'start',
      accept: ['pDone', 'qDone']
    }
  }
])

export const presetFor = (id: string): Preset | null => PRESETS.find((one) => one.id === id) ?? null

// ---------------------------------------------------------------- testing many strings at once

export interface BatchReport {
  rows: readonly { input: string; accepted: boolean; why: string }[]
  accepted: number
  says: string
}

/** Run a list of strings through the machine. Shows the pattern a single test cannot. */
export function testMany(machine: Machine, inputs: readonly string[]): BatchReport | AutomatonError {
  const bad = check(machine)
  if (bad) return bad
  const rows: { input: string; accepted: boolean; why: string }[] = []
  for (const one of inputs.slice(0, 64)) {
    const made = runMachine(machine, one)
    if (isAutomatonError(made)) return made
    rows.push({ input: one === '' ? 'ε (the empty string)' : one, accepted: made.accepted, why: made.says.replace(/^(Accepted|Rejected): /, '') })
  }
  const accepted = rows.filter((one) => one.accepted).length
  return {
    rows: Object.freeze(rows),
    accepted,
    says: `${accepted} of ${rows.length} accepted.`
  }
}

/** Every string over the alphabet up to a length, in order. For seeing what a machine accepts rather than guessing. */
export function allStrings(alphabet: readonly string[], upTo: number): readonly string[] {
  const out: string[] = ['']
  let level: string[] = ['']
  for (let length = 1; length <= Math.min(upTo, 6); length += 1) {
    const next: string[] = []
    for (const one of level) for (const symbol of alphabet) next.push(one + symbol)
    out.push(...next)
    level = next
    if (out.length > 200) break
  }
  return Object.freeze(out)
}
