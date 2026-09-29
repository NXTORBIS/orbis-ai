/**
 * Changing a Page without writing it again.
 *
 * "Make the chart bigger." "Call it something else." "Work that out when I press a button instead." Every one of
 * those was, until now, a complete regeneration: the whole specification written again by a model, with a new chance
 * to get every unrelated part wrong. That is slow, and it is worse than slow -- it means asking for a smaller font
 * can change the calculation, and nobody would look for that.
 *
 * So a modification is a **change set**: a small, named, checkable edit to the specification that already exists. The
 * parts nobody asked about are not touched, because there is no mechanism here that could touch them.
 *
 * ## Two ways a change set arrives, and the fast one is free
 *
 * Most modification requests are one of a few dozen phrasings of a handful of operations. "Rename the speed box to
 * launch speed" needs nobody's judgement: it is a `relabel`, the target is obvious, and `read` produces it in
 * microseconds. A model is asked only when the request is not one of those.
 *
 * That ordering matters more than the speed. A deterministic change is one that does exactly what it says, every
 * time, and can be shown to somebody before it is applied.
 *
 * ## Applying one is checked, not trusted
 *
 * `apply` produces a candidate specification and hands it straight back to `checkSpec`. A change that would leave an
 * output pointing at a step that no longer exists is refused, not applied and discovered. And the change set itself
 * is validated first -- a `relabel` naming a field the Page does not have is refused before anything is edited,
 * rather than silently doing nothing, which is the failure somebody notices a week later.
 *
 * ## What a change set cannot do
 *
 * It cannot add a calculation, change an operation, or alter what a step is given. Those are changes to what the Page
 * *means*, and meaning is the one thing worth regenerating for. A change set is for the treatment: labels, order,
 * presentation, when things happen, what is said about it.
 */

import { checkSpec, type OperationSignature, type PageSpec, type SpecDisplay, type SpecProblem, type SpecSection } from './spec.ts'

export const CHANGE_LIMITS = Object.freeze({
  /** How many edits one request may make. More than this is a rewrite wearing a diff's clothes. */
  perSet: 12,
  reasonLength: 200,
  requestLength: 300
})

export type ChangeOp =
  /** A different label on an input or an output. */
  | 'relabel'
  /** A different title for the Page. */
  | 'retitle'
  /** A different sentence about what it is for. */
  | 'rephrase'
  /** A different way of showing one output. */
  | 'redisplay'
  /** A different starting value for an input. */
  | 'restart'
  /** A different range for a number input. */
  | 'rebound'
  /** A step happens as somebody types, or waits for a button. */
  | 'retime'
  /** Something moves to a different section, or a section moves. */
  | 'reorder'
  /** A different title on a section. */
  | 'resection'
  /** Something the Page says about what it does not do. */
  | 'note'

export interface Change {
  op: ChangeOp
  /** What it applies to: an input, output, step or section title. Empty for a change to the Page itself. */
  target: string
  /** What it becomes. Its shape depends on the operation, and `check` is what says whether it is right. */
  to: unknown
  /** Why, in the person's words where there are any. Shown before it is applied. */
  reason: string
}

export interface ChangeSet {
  changes: readonly Change[]
  /** What was asked for, kept so the edit can be explained afterwards. */
  request: string
  /** True when this was worked out without asking anybody. */
  direct: boolean
}

export interface ChangeProblem {
  at: string
  code: string
  message: string
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const DISPLAYS: ReadonlySet<string> = new Set<SpecDisplay>(['value', 'statistic', 'table', 'plot'])

/**
 * A change set checked against the Page it would edit.
 *
 * Every target has to exist and every value has to be the right shape *before* anything is applied. A change naming
 * something that is not there is refused rather than doing nothing quietly, which is the failure somebody finds a
 * week later when they wonder why their edit never took.
 */
export function check(set: ChangeSet, spec: PageSpec): ChangeProblem[] {
  const problems: ChangeProblem[] = []
  const add = (at: string, code: string, message: string): void => {
    problems.push({ at, code, message })
  }

  if (set.changes.length === 0) add('', 'nothing-to-do', 'This change set does nothing.')
  if (set.changes.length > CHANGE_LIMITS.perSet) {
    add('', 'too-many', `This makes ${set.changes.length} edits, and past ${CHANGE_LIMITS.perSet} it is a rewrite rather than a change.`)
  }

  const inputs = new Map(spec.inputs.map((one) => [one.name, one]))
  const outputs = new Map(spec.outputs.map((one) => [one.name, one]))
  const steps = new Set(spec.steps.map((one) => one.name))
  const sections = new Set(spec.sections.map((one) => one.title))

  for (let i = 0; i < set.changes.length; i++) {
    const change = set.changes[i]
    const at = `changes[${i}]`
    const text = (): string | null => (typeof change.to === 'string' && change.to.trim().length > 0 ? change.to.trim() : null)

    switch (change.op) {
      case 'relabel': {
        if (!inputs.has(change.target) && !outputs.has(change.target)) {
          add(at, 'no-such-thing', `There is nothing called "${change.target}" on this Page to relabel.`)
          break
        }
        if (text() === null) add(at, 'bad-label', 'A label has to be text.')
        break
      }
      case 'retitle':
      case 'rephrase': {
        if (text() === null) add(at, 'bad-text', 'That has to be text.')
        break
      }
      case 'redisplay': {
        const output = outputs.get(change.target)
        if (output === undefined) {
          add(at, 'no-such-output', `There is no output called "${change.target}".`)
          break
        }
        if (typeof change.to !== 'string' || !DISPLAYS.has(change.to)) {
          add(at, 'bad-display', `"${String(change.to)}" is not a way of showing a result.`)
          break
        }
        // A single number needs to say which one; a plot or a table shows the whole result and must not.
        const single = change.to === 'value' || change.to === 'statistic'
        if (single && output.pick === undefined) {
          add(at, 'nothing-picked', `Showing "${change.target}" as a ${change.to} needs it to say which part of the result to show, and it does not.`)
        }
        break
      }
      case 'restart': {
        const input = inputs.get(change.target)
        if (input === undefined) {
          add(at, 'no-such-input', `There is no input called "${change.target}".`)
          break
        }
        if (input.kind === 'number' || input.kind === 'quantity') {
          if (typeof change.to !== 'number' || !Number.isFinite(change.to)) {
            add(at, 'bad-start', `"${change.target}" holds a number, so it has to start at one.`)
            break
          }
          if ((input.minimum !== undefined && change.to < input.minimum) || (input.maximum !== undefined && change.to > input.maximum)) {
            add(at, 'out-of-range', `${change.to} is outside what "${change.target}" allows.`)
          }
        } else if (input.kind === 'boolean' && typeof change.to !== 'boolean') {
          add(at, 'bad-start', `"${change.target}" is true or false.`)
        } else if (input.kind === 'choice' && !(input.options ?? []).some((one) => one.value === change.to)) {
          add(at, 'not-an-option', `"${String(change.to)}" is not one of the choices for "${change.target}".`)
        }
        break
      }
      case 'rebound': {
        const input = inputs.get(change.target)
        if (input === undefined || (input.kind !== 'number' && input.kind !== 'quantity')) {
          add(at, 'no-such-number', `There is no number called "${change.target}" to give a range to.`)
          break
        }
        if (!isPlainObject(change.to)) {
          add(at, 'bad-range', 'A range is a minimum and a maximum.')
          break
        }
        const low = change.to.minimum
        const high = change.to.maximum
        for (const [name, value] of [['minimum', low], ['maximum', high]] as const) {
          if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
            add(at, 'bad-range', `The ${name} has to be a real number.`)
          }
        }
        if (typeof low === 'number' && typeof high === 'number' && low > high) {
          add(at, 'range-crossed', `It cannot be at least ${low} and at most ${high}.`)
        }
        break
      }
      case 'retime': {
        if (!steps.has(change.target)) {
          add(at, 'no-such-step', `There is no calculation called "${change.target}".`)
          break
        }
        if (change.to !== 'change' && change.to !== 'button') {
          add(at, 'bad-timing', 'A calculation happens as somebody types, or waits for a button.')
        }
        break
      }
      case 'reorder': {
        if (!Array.isArray(change.to)) {
          add(at, 'bad-order', 'An order is a list of what goes where.')
          break
        }
        const named = (change.to as unknown[]).map((one) => String(one))
        const known = new Set([...inputs.keys(), ...outputs.keys(), ...sections])
        for (const one of named) {
          if (!known.has(one)) add(at, 'no-such-thing', `There is nothing called "${one}" on this Page to move.`)
        }
        break
      }
      case 'resection': {
        if (!sections.has(change.target)) {
          add(at, 'no-such-section', `There is no section called "${change.target}".`)
          break
        }
        if (text() === null) add(at, 'bad-text', 'A section title has to be text.')
        break
      }
      case 'note': {
        if (text() === null) add(at, 'bad-text', 'A note has to be text.')
        break
      }
      default:
        add(at, 'no-such-change', `"${String(change.op)}" is not a kind of change.`)
    }
  }
  return problems
}

/**
 * A change set applied.
 *
 * Checked twice, and the second one is the point: the change set is checked against the Page it edits, and then the
 * Page that comes out is checked as a specification. A `redisplay` that leaves an output showing a single number with
 * nothing picked is caught by the first; a change that leaves the Page as a whole inconsistent is caught by the
 * second. Neither can see what the other sees.
 */
export function apply(
  spec: PageSpec,
  set: ChangeSet,
  known: Readonly<Record<string, string>>,
  signatures: Readonly<Record<string, OperationSignature>> = {}
): { spec: PageSpec; applied: readonly Change[] } | { problems: readonly ChangeProblem[]; specProblems?: readonly SpecProblem[] } {
  const problems = check(set, spec)
  if (problems.length > 0) return { problems }

  let next: PageSpec = {
    ...spec,
    inputs: spec.inputs.map((one) => ({ ...one })),
    outputs: spec.outputs.map((one) => ({ ...one })),
    steps: spec.steps.map((one) => ({ ...one })),
    sections: spec.sections.map((one) => ({ ...one, members: [...one.members] })),
    notes: [...spec.notes],
    keywords: [...spec.keywords]
  }

  for (const change of set.changes) {
    switch (change.op) {
      case 'relabel':
        next = {
          ...next,
          inputs: next.inputs.map((one) => (one.name === change.target ? { ...one, label: String(change.to).trim() } : one)),
          outputs: next.outputs.map((one) => (one.name === change.target ? { ...one, label: String(change.to).trim() } : one))
        }
        break
      case 'retitle':
        next = { ...next, title: String(change.to).trim() }
        break
      case 'rephrase':
        next = { ...next, purpose: String(change.to).trim() }
        break
      case 'redisplay':
        next = {
          ...next,
          outputs: next.outputs.map((one) => (one.name === change.target ? { ...one, display: change.to as SpecDisplay } : one))
        }
        break
      case 'restart':
        next = { ...next, inputs: next.inputs.map((one) => (one.name === change.target ? { ...one, initial: change.to } : one)) }
        break
      case 'rebound': {
        const to = change.to as { minimum?: number; maximum?: number }
        next = {
          ...next,
          inputs: next.inputs.map((one) =>
            one.name === change.target ? { ...one, minimum: to.minimum, maximum: to.maximum } : one
          )
        }
        break
      }
      case 'retime':
        next = { ...next, steps: next.steps.map((one) => (one.name === change.target ? { ...one, when: change.to as 'change' | 'button' } : one)) }
        break
      case 'reorder':
        next = { ...next, sections: reorder(next.sections, (change.to as unknown[]).map((one) => String(one))) }
        break
      case 'resection':
        next = {
          ...next,
          sections: next.sections.map((one) => (one.title === change.target ? { ...one, title: String(change.to).trim() } : one))
        }
        break
      case 'note':
        next = { ...next, notes: [...next.notes, String(change.to).trim()] }
        break
    }
  }

  const checked = checkSpec(next, known, signatures)
  if (!checked.usable || checked.normalised === null) {
    return { problems: [], specProblems: checked.problems.filter((one) => one.severity === 'error') }
  }
  return { spec: checked.normalised, applied: set.changes }
}

/**
 * Sections and their members, put in a requested order.
 *
 * Anything the order does not mention keeps its place relative to the rest, rather than being pushed to the end. A
 * reorder that silently moves what it was not asked about is a reorder nobody can predict.
 */
function reorder(sections: readonly SpecSection[], wanted: readonly string[]): SpecSection[] {
  const rank = new Map(wanted.map((one, i) => [one, i]))
  const sectionRank = (one: SpecSection): number => {
    const own = rank.get(one.title)
    if (own !== undefined) return own
    // A section takes the rank of its earliest mentioned member, so "put the answer first" moves the section holding
    // it without anybody having to name the section.
    const member = one.members.map((each) => rank.get(each)).filter((each): each is number => each !== undefined)
    return member.length > 0 ? Math.min(...member) : Number.POSITIVE_INFINITY
  }
  const ordered = sections
    .map((one, i) => ({ one, i, rank: sectionRank(one) }))
    // A stable sort by rank, falling back to where it already was.
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((each) => each.one)

  return ordered.map((section) => ({
    ...section,
    members: [...section.members]
      .map((name, i) => ({ name, i, rank: rank.get(name) ?? Number.POSITIVE_INFINITY }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i)
      .map((each) => each.name)
  }))
}

// ---------------------------------------------------------------- the fast path

/** One phrasing, and what it means. Ordered: the first that matches wins, so the specific ones come first. */
const PHRASINGS: readonly { pattern: RegExp; read(match: RegExpMatchArray, spec: PageSpec): Change | null }[] = Object.freeze([
  {
    // "call the speed box launch speed", "rename speed to launch speed"
    pattern: /^(?:re)?name\s+(?:the\s+)?"?([a-z][a-z0-9_ ]*?)"?\s+(?:box\s+)?(?:to|as)\s+"?(.+?)"?$/i,
    read: (match, spec) => {
      const target = findThing(spec, match[1])
      return target === null ? null : { op: 'relabel', target, to: match[2].trim(), reason: 'Renamed.' }
    }
  },
  {
    // "call it the projectile calculator"
    pattern: /^(?:re)?name\s+it\s+"?(.+?)"?$/i,
    read: (match) => ({ op: 'retitle', target: '', to: match[1].trim(), reason: 'Renamed.' })
  },
  {
    // "show the path as a chart", "show range as a table"
    pattern: /^(?:show|display)\s+(?:the\s+)?"?([a-z][a-z0-9_ ]*?)"?\s+as\s+(?:an?\s+)?(chart|graph|plot|table|number|value|statistic)$/i,
    read: (match, spec) => {
      const target = findThing(spec, match[1])
      if (target === null) return null
      const word = match[2].toLowerCase()
      const display: SpecDisplay = word === 'table' ? 'table' : word === 'number' || word === 'value' ? 'value' : word === 'statistic' ? 'statistic' : 'plot'
      return { op: 'redisplay', target, to: display, reason: `Shown as a ${word}.` }
    }
  },
  {
    // "work out the flight when I press a button"
    pattern: /^(?:work out|calculate|compute)\s+(?:the\s+)?"?([a-z][a-z0-9_ ]*?)"?\s+(?:only\s+)?(?:when|on)\s+(?:i\s+)?(?:press|click)/i,
    read: (match, spec) => {
      const target = findStep(spec, match[1])
      return target === null ? null : { op: 'retime', target, to: 'button', reason: 'Waits for a button now.' }
    }
  },
  {
    // "work out the flight as I type"
    pattern: /^(?:work out|calculate|compute)\s+(?:the\s+)?"?([a-z][a-z0-9_ ]*?)"?\s+as\s+(?:i\s+)?type/i,
    read: (match, spec) => {
      const target = findStep(spec, match[1])
      return target === null ? null : { op: 'retime', target, to: 'change', reason: 'Happens as you type now.' }
    }
  },
  {
    // "start the speed at 30"
    pattern: /^(?:start|set)\s+(?:the\s+)?"?([a-z][a-z0-9_ ]*?)"?\s+(?:box\s+)?(?:at|to)\s+(-?\d+(?:\.\d+)?)$/i,
    read: (match, spec) => {
      const target = findThing(spec, match[1])
      return target === null ? null : { op: 'restart', target, to: Number(match[2]), reason: `Starts at ${match[2]}.` }
    }
  },
  {
    // "put the answer first", "show the range first"
    pattern: /^(?:put|move|show)\s+(?:the\s+)?"?([a-z][a-z0-9_ ]*?)"?\s+(?:at the top|first|up top)$/i,
    read: (match, spec) => {
      const target = findThing(spec, match[1]) ?? findSection(spec, match[1])
      return target === null ? null : { op: 'reorder', target: '', to: [target], reason: `"${target}" comes first now.` }
    }
  },
  {
    // "say that it ignores air resistance"
    pattern: /^(?:say|add a note|note)\s+(?:that\s+)?(.+)$/i,
    read: (match) => ({ op: 'note', target: '', to: match[1].trim(), reason: 'Said on the Page.' })
  }
])

/** An input or output whose name or label a person meant. */
function findThing(spec: PageSpec, said: string): string | null {
  const wanted = said.trim().toLowerCase().replace(/\s+/g, ' ')
  for (const one of [...spec.inputs, ...spec.outputs]) {
    if (one.name.toLowerCase() === wanted || one.name.toLowerCase().replace(/_/g, ' ') === wanted) return one.name
    if (one.label.toLowerCase() === wanted) return one.name
  }
  // Then a label that contains what was said, but only when exactly one does -- two matches is a guess.
  const near = [...spec.inputs, ...spec.outputs].filter((one) => one.label.toLowerCase().includes(wanted))
  return near.length === 1 ? near[0].name : null
}

function findStep(spec: PageSpec, said: string): string | null {
  const wanted = said.trim().toLowerCase().replace(/\s+/g, ' ')
  for (const one of spec.steps) {
    if (one.name.toLowerCase() === wanted || one.name.toLowerCase().replace(/_/g, ' ') === wanted) return one.name
  }
  // An output's name is what somebody would say, and it points at the step behind it.
  const output = spec.outputs.find((one) => one.label.toLowerCase() === wanted || one.name.toLowerCase() === wanted)
  return output?.step ?? null
}

function findSection(spec: PageSpec, said: string): string | null {
  const wanted = said.trim().toLowerCase()
  return spec.sections.find((one) => one.title.toLowerCase() === wanted)?.title ?? null
}

/**
 * A change set read straight from what somebody said, or nothing.
 *
 * Nothing is the normal answer and is not a failure: it means the request was not one of the phrasings this knows,
 * and a model should be asked. What this must never do is guess -- a change set produced from a request it did not
 * really understand is an edit somebody did not ask for, applied confidently.
 */
export function read(request: string, spec: PageSpec): ChangeSet | null {
  const said = request.trim().replace(/[.!]+$/, '')
  if (said.length === 0 || said.length > CHANGE_LIMITS.requestLength) return null
  for (const { pattern, read: readOne } of PHRASINGS) {
    const match = pattern.exec(said)
    if (match === null) continue
    const change = readOne(match, spec)
    if (change === null) return null
    return { changes: [change], request: said, direct: true }
  }
  return null
}

/**
 * What one version changed about another, as change sets.
 *
 * For showing somebody what happened rather than for applying: a regeneration produces a new specification, and this
 * says which of the differences are the kind a change set could have made. Anything not describable here changed the
 * Page's meaning, which is worth saying separately.
 */
export function describeChanges(before: PageSpec, after: PageSpec): { described: Change[]; deeper: string[] } {
  const described: Change[] = []
  const deeper: string[] = []

  if (before.title !== after.title) described.push({ op: 'retitle', target: '', to: after.title, reason: 'Renamed.' })
  if (before.purpose !== after.purpose) described.push({ op: 'rephrase', target: '', to: after.purpose, reason: 'Described differently.' })

  const beforeInputs = new Map(before.inputs.map((one) => [one.name, one]))
  for (const one of after.inputs) {
    const was = beforeInputs.get(one.name)
    if (was === undefined) {
      deeper.push(`"${one.label}" is new.`)
      continue
    }
    if (was.label !== one.label) described.push({ op: 'relabel', target: one.name, to: one.label, reason: 'Renamed.' })
    if (was.initial !== one.initial) described.push({ op: 'restart', target: one.name, to: one.initial, reason: 'Starts somewhere else.' })
    if (was.minimum !== one.minimum || was.maximum !== one.maximum) {
      described.push({ op: 'rebound', target: one.name, to: { minimum: one.minimum, maximum: one.maximum }, reason: 'Allows a different range.' })
    }
    if (was.kind !== one.kind) deeper.push(`"${one.label}" was a ${was.kind} and is now a ${one.kind}.`)
  }
  for (const one of before.inputs) if (!after.inputs.some((each) => each.name === one.name)) deeper.push(`"${one.label}" is gone.`)

  const beforeOutputs = new Map(before.outputs.map((one) => [one.name, one]))
  for (const one of after.outputs) {
    const was = beforeOutputs.get(one.name)
    if (was === undefined) {
      deeper.push(`"${one.label}" is new.`)
      continue
    }
    if (was.label !== one.label) described.push({ op: 'relabel', target: one.name, to: one.label, reason: 'Renamed.' })
    if (was.display !== one.display) described.push({ op: 'redisplay', target: one.name, to: one.display, reason: 'Shown differently.' })
    if (was.pick !== one.pick) deeper.push(`"${one.label}" shows a different part of its result.`)
  }
  for (const one of before.outputs) if (!after.outputs.some((each) => each.name === one.name)) deeper.push(`"${one.label}" is no longer shown.`)

  const beforeSteps = new Map(before.steps.map((one) => [one.name, one]))
  for (const one of after.steps) {
    const was = beforeSteps.get(one.name)
    if (was === undefined) {
      deeper.push(`A new calculation, ${one.operation}.`)
      continue
    }
    if (was.when !== one.when) described.push({ op: 'retime', target: one.name, to: one.when, reason: 'Happens at a different time.' })
    if (was.operation !== one.operation) deeper.push(`"${one.name}" works the answer out a different way now.`)
    if (JSON.stringify(was.arguments) !== JSON.stringify(one.arguments)) deeper.push(`"${one.name}" is given different things.`)
  }
  for (const one of before.steps) if (!after.steps.some((each) => each.name === one.name)) deeper.push(`The calculation "${one.name}" is gone.`)

  return { described, deeper }
}

export const CHANGES_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A modification is an edit to the specification that exists, not a new one. The parts nobody asked about are not touched because nothing here could touch them.',
  'Most requests are one of a few dozen phrasings and need nobody. A model is asked only when the request is not one of them.',
  'Reading a request never guesses. Nothing is the normal answer, and a change set produced from a request nobody understood is an edit somebody did not ask for.',
  'A change set is checked against the Page it edits, and then the Page it produces is checked as a specification. Neither check can see what the other sees.',
  'A change naming something that is not there is refused, not quietly skipped. Quietly skipped is the failure somebody finds a week later.',
  'A change set cannot add a calculation or alter what one is given. Those change what the Page means, and meaning is the one thing worth regenerating for.',
  'A reorder leaves what it was not asked about where it was, relative to the rest.'
])
