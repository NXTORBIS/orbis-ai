/**
 * A PageSpec: what a generated Page is asked to be, before anything has been built.
 *
 * This is the format a model writes when somebody asks for a Page that does not exist yet, and it is the single place
 * where model output crosses from "text somebody produced" into "a thing Orbis will run". Everything downstream --
 * the compiler, the manifest, the capability grant, the sandbox -- trusts what `checkSpec` returned and nothing else.
 *
 * ## It is a description, not a program
 *
 * There is nowhere in this format to put code. Not a script, not a callback, not a snippet, not an expression. A spec
 * names inputs, names engine operations, and names where results go. The operations are looked up in a table that the
 * caller supplies; an operation that is not in it does not compile, so the set of things a generated Page can do is
 * exactly the set of things Orbis already implemented and tested. A model cannot widen that set by asking nicely,
 * because asking is not a mechanism that exists here.
 *
 * That is also why a spec carries **no capability list**. Capabilities are *derived* from the operations a spec uses,
 * in `compiler.ts`, from the same table. A spec that could declare `secrets.read` would be a spec that could ask for
 * `secrets.read`, and the only reliable way to stop that is to have no field to write it in.
 *
 * ## Why validation is this paranoid about small things
 *
 * A generated Page is the one kind of Page nobody reviewed. There is no author to ask what a field was for. So every
 * name is checked, every reference has to resolve, every list has a ceiling, every string has a length, and anything
 * unrecognised is refused rather than dropped. Dropping is the dangerous one: a spec that is *repaired* into validity
 * is a spec whose author did not write what runs, and the difference is invisible afterwards.
 *
 * ## What a spec deliberately cannot say
 *
 * - **Where to get data from.** No URLs, no file paths, no hosts. A generated Page computes; it does not fetch.
 * - **What it may be trusted with.** See above.
 * - **How something looks in pixels.** Sections and a kind of display, and that is all. A generated Page inherits the
 *   application's appearance rather than describing its own, so a spec cannot produce a Page that looks like a
 *   different application -- or like a system dialog.
 * - **What another Page holds.** A spec names its own inputs, steps and outputs, and nothing else's.
 */

const NAME = /^[a-z][a-z0-9_]{0,39}$/i
const OPERATION = /^[a-z]+\.[a-z-]+$/

/** Nothing here is negotiable, and all of it is smaller than it could be. A Page nobody reviewed should be small. */
export const SPEC_LIMITS = Object.freeze({
  inputs: 24,
  steps: 24,
  outputs: 24,
  sections: 12,
  /** Members of one section. */
  members: 24,
  notes: 12,
  keywords: 16,
  options: 40,
  /** Arguments to one step. */
  arguments: 24,
  titleLength: 80,
  purposeLength: 400,
  labelLength: 120,
  helpLength: 400,
  noteLength: 300,
  /** A literal string handed to an engine. */
  literalLength: 2000,
  /** How many members a literal list may have. */
  literalItems: 200,
  /** How deeply a literal may nest. */
  literalDepth: 6
})

export interface SpecProblem {
  /** A path into the spec, so a screen can point at the thing rather than describe it. */
  at: string
  severity: 'error' | 'warning'
  code: string
  message: string
}

// ---------------------------------------------------------------- inputs

/**
 * The kinds a person can type into. Deliberately the subset of the builder's field types that a person edits: a
 * `result` is something a step produced, so it is never an input, and a `table` is not something anybody types.
 */
export type SpecInputKind = 'number' | 'text' | 'boolean' | 'choice' | 'quantity'

export interface SpecInput {
  name: string
  kind: SpecInputKind
  label: string
  /** For `quantity`: the unit the number is in. */
  unit?: string
  /** For `choice`. */
  options?: readonly { value: string; label: string }[]
  initial?: unknown
  /** For `number` and `quantity`. */
  minimum?: number
  maximum?: number
  help?: string
}

// ---------------------------------------------------------------- steps

/**
 * Where one argument's value comes from.
 *
 * `step` is what makes a chain possible: an engine returns an object and the next step wants one number out of it.
 * `pick` is a plain property name -- never a path -- for the reason given in `builder.ts`.
 */
export type SpecArgument = { input: string } | { step: string; pick?: string } | { value: unknown }

export interface SpecStep {
  name: string
  /** An engine operation, `family.op`. Looked up in the table the caller supplies. */
  operation: string
  arguments: Readonly<Record<string, SpecArgument>>
  /** `change` recomputes as somebody types; `button` waits to be asked. */
  when: 'change' | 'button'
  /** A sentence saying what this step does, shown to somebody reading the Page's workings. */
  describe?: string
}

// ---------------------------------------------------------------- outputs

/**
 * How a result is shown. Not a widget library -- four ways of presenting a number or a set of them, chosen because
 * each says something different about what the reader is looking at.
 */
export type SpecDisplay = 'value' | 'statistic' | 'table' | 'plot'

export interface SpecOutput {
  name: string
  label: string
  display: SpecDisplay
  /** The step whose result this shows. */
  step: string
  /** One property of that result, where the display wants a single number. */
  pick?: string
  help?: string
}

// ---------------------------------------------------------------- layout

export interface SpecSection {
  title: string
  /** Names of inputs and outputs, in the order they appear. Nothing else may be named here. */
  members: readonly string[]
  /** A sentence above the section. */
  text?: string
}

// ---------------------------------------------------------------- the spec

export const SPEC_VERSION = 1

export interface PageSpec {
  specVersion: number
  title: string
  /** One sentence. Becomes the Page's description, and is what somebody sees before opening it. */
  purpose: string
  inputs: readonly SpecInput[]
  steps: readonly SpecStep[]
  outputs: readonly SpecOutput[]
  sections: readonly SpecSection[]
  /**
   * What this Page does not do, in the author's words. These become the manifest's limitations, which are shown on
   * the Page itself. A generated Page with no stated limits is a generated Page that is claiming to have none.
   */
  notes: readonly string[]
  keywords: readonly string[]
}

export interface SpecCheck {
  problems: readonly SpecProblem[]
  /** True when nothing is an error. A spec with warnings compiles. */
  usable: boolean
  /** Every operation the spec uses, sorted. What the compiler derives capabilities from. */
  operations: readonly string[]
  /**
   * The spec as the checker read it: trimmed, with defaults worked out, and with nothing it did not recognise.
   *
   * Null when the spec is unusable. This is what the compiler is given, and it matters that it is *this* object
   * rather than the original: the checker fills in a choice's starting value, trims every label, and drops anything
   * it never read, and a compiler handed the original would be compiling something the checker never saw.
   */
  normalised: PageSpec | null
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type Add = (at: string, code: string, message: string, severity?: 'error' | 'warning') => void

/**
 * A literal handed to an engine, checked for shape and size.
 *
 * Literals are the one place in a spec where arbitrary data appears, so they are the one place where a spec could be
 * made enormous. Depth and breadth are both capped, and anything that is not JSON -- a function, a symbol, a date, a
 * cyclic object -- is refused rather than serialised into something else.
 */
function checkLiteral(value: unknown, at: string, depth: number, add: Add): void {
  if (depth > SPEC_LIMITS.literalDepth) {
    add(at, 'literal-too-deep', `This value nests more than ${SPEC_LIMITS.literalDepth} deep. Nothing an engine takes is that shape.`)
    return
  }
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) add(at, 'literal-not-finite', 'A value here has to be a real number. Infinity and NaN are not.')
    return
  }
  if (typeof value === 'string') {
    if (value.length > SPEC_LIMITS.literalLength) {
      add(at, 'literal-too-long', `This text is ${value.length} characters, and the most a value may be is ${SPEC_LIMITS.literalLength}.`)
    }
    return
  }
  if (Array.isArray(value)) {
    if (value.length > SPEC_LIMITS.literalItems) {
      add(at, 'literal-too-many', `This list has ${value.length} items, and the most a value may have is ${SPEC_LIMITS.literalItems}.`)
      return
    }
    for (let i = 0; i < value.length; i++) checkLiteral(value[i], `${at}[${i}]`, depth + 1, add)
    return
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length > SPEC_LIMITS.literalItems) {
      add(at, 'literal-too-many', `This object has ${keys.length} properties, and the most a value may have is ${SPEC_LIMITS.literalItems}.`)
      return
    }
    for (const key of keys) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        // Not because the engines are vulnerable to it, but because a spec that contains it was not written by
        // somebody describing a calculation, and the right response to that is to stop rather than to sanitise.
        add(`${at}.${key}`, 'literal-reserved-key', `"${key}" is not a property a value may carry.`)
        continue
      }
      checkLiteral(value[key], `${at}.${key}`, depth + 1, add)
    }
    return
  }
  add(at, 'literal-not-data', 'A value here has to be data: a number, some text, true or false, a list, or an object of those.')
}

/**
 * Whether text contains a character that does not print.
 *
 * Checked by code point rather than by a pattern, because the set includes the line separators, and a pattern
 * containing those cannot be written on one line in a source file -- which is exactly the property that makes them
 * worth refusing in a label.
 *
 * Three groups, for three different reasons. The C0 and C1 controls because they are not text. The zero-width and
 * joining marks because two labels that look identical should not be two labels. The bidirectional overrides because
 * they reorder what is printed around them, which is how a label can be made to read as something other than what it
 * says.
 */
function hasInvisible(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) as number
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
    if (code >= 0x200b && code <= 0x200f) return true
    if (code === 0x2028 || code === 0x2029) return true
    if (code >= 0x202a && code <= 0x202e) return true
    if (code >= 0x2066 && code <= 0x2069) return true
  }
  return false
}

const text = (value: unknown, at: string, what: string, limit: number, add: Add, required = true): string | null => {
  if (typeof value !== 'string') {
    if (required) add(at, 'missing-text', `${what} has to be text.`)
    return null
  }
  const trimmed = value.trim()
  if (required && trimmed.length === 0) {
    add(at, 'empty-text', `${what} is empty.`)
    return null
  }
  if (trimmed.length > limit) {
    add(at, 'text-too-long', `${what} is ${trimmed.length} characters, and the most it may be is ${limit}.`)
    return null
  }
  // A control character in a label is either a mistake or an attempt to make one thing look like another on screen.
  if (hasInvisible(trimmed)) {
    add(at, 'text-has-control-characters', `${what} contains characters that do not print. Text here is text somebody reads.`)
    return null
  }
  return trimmed
}

/**
 * A spec checked against everything that has to be true before it can be compiled.
 *
 * `known` is the operation table -- operation name to the capability it needs. It is passed in rather than imported
 * because the table lives in the main process where the engines are, and because a test wants to hand this a table of
 * three operations rather than four hundred.
 */
export interface OperationSignature {
  /**
   * What each argument is, where it is known.
   *
   * `options` is the closed set a choice argument accepts. A word outside it is refused here with the real list, so
   * a model that guessed `hands` where the engine wanted `combinations` is told, rather than being refused later by
   * the engine with a sentence nobody can act on.
   */
  readonly [argument: string]: { optional: boolean; options?: readonly string[] }
}

export function checkSpec(
  raw: unknown,
  known: Readonly<Record<string, string>>,
  /**
   * What each operation takes, where that is known.
   *
   * Optional because the checker is useful without it -- a test hands it three operations and no signatures. When it
   * is supplied, an argument the operation does not take, or a required one left out, is refused here rather than at
   * run time. Both directions matter: a missing argument is refused by the engine in front of somebody, and an
   * unknown one is silently ignored, which makes a control that does nothing look like a calculation that is
   * insensitive.
   */
  signatures: Readonly<Record<string, OperationSignature>> = {}
): SpecCheck {
  const problems: SpecProblem[] = []
  const usedOperations = new Set<string>()
  const add: Add = (at, code, message, severity = 'error') => {
    problems.push({ at, code, message, severity })
  }
  /** Filled as the checker goes, and only handed back when nothing was an error. */
  let normalised: PageSpec | null = null
  const done = (): SpecCheck => {
    const usable = !problems.some((one) => one.severity === 'error')
    return {
      problems: Object.freeze(problems),
      usable,
      operations: Object.freeze([...usedOperations].sort()),
      normalised: usable ? normalised : null
    }
  }

  if (!isPlainObject(raw)) {
    add('', 'not-a-spec', 'A Page specification has to be an object.')
    return done()
  }
  const spec = raw as Partial<PageSpec>

  if (spec.specVersion !== SPEC_VERSION) {
    add(
      'specVersion',
      'wrong-version',
      `This specification says it is version ${String(spec.specVersion)}, and this version of Orbis builds version ${SPEC_VERSION}.`
    )
    return done()
  }

  text(spec.title, 'title', 'The title', SPEC_LIMITS.titleLength, add)
  text(spec.purpose, 'purpose', 'The purpose', SPEC_LIMITS.purposeLength, add)

  const list = (value: unknown, at: string, limit: number, what: string): readonly unknown[] => {
    if (!Array.isArray(value)) {
      add(at, 'missing-list', `${what} has to be a list.`)
      return []
    }
    if (value.length > limit) {
      add(at, 'list-too-long', `${what} has ${value.length} entries, and the most allowed is ${limit}.`)
      return value.slice(0, limit)
    }
    return value
  }

  // ---------------------------------------------------------------- inputs
  const inputs = list(spec.inputs, 'inputs', SPEC_LIMITS.inputs, 'The inputs')
  const inputByName = new Map<string, SpecInput>()
  for (let i = 0; i < inputs.length; i++) {
    const at = `inputs[${i}]`
    const one = inputs[i]
    if (!isPlainObject(one)) {
      add(at, 'not-an-input', 'Each input has to be an object.')
      continue
    }
    const name = typeof one.name === 'string' ? one.name : ''
    if (!NAME.test(name)) {
      add(`${at}.name`, 'bad-name', `"${name}" is not a usable name. Use a letter first, then letters, numbers or underscores, up to 40.`)
      continue
    }
    if (inputByName.has(name)) {
      add(`${at}.name`, 'duplicate-name', `There is already an input called "${name}".`)
      continue
    }
    const kind = one.kind
    if (kind !== 'number' && kind !== 'text' && kind !== 'boolean' && kind !== 'choice' && kind !== 'quantity') {
      add(`${at}.kind`, 'bad-kind', `"${String(kind)}" is not a kind of input. It has to be number, text, boolean, choice or quantity.`)
      continue
    }
    const label = text(one.label, `${at}.label`, 'An input label', SPEC_LIMITS.labelLength, add)
    if (label === null) continue
    let help: string | undefined
    if (one.help !== undefined) {
      const read = text(one.help, `${at}.help`, 'An input note', SPEC_LIMITS.helpLength, add)
      if (read === null) continue
      help = read
    }

    const input: SpecInput = { name, kind, label }
    if (help !== undefined) (input as { help?: string }).help = help

    if (kind === 'choice') {
      const options = list(one.options, `${at}.options`, SPEC_LIMITS.options, 'The options')
      if (options.length === 0) {
        add(`${at}.options`, 'no-options', `"${name}" is a choice with nothing to choose between.`)
        continue
      }
      const values = new Set<string>()
      const checked: { value: string; label: string }[] = []
      let bad = false
      for (let j = 0; j < options.length; j++) {
        const option = options[j]
        if (!isPlainObject(option)) {
          add(`${at}.options[${j}]`, 'bad-option', 'Each option has to be an object with a value and a label.')
          bad = true
          break
        }
        const optionValue = text(option.value, `${at}.options[${j}].value`, 'An option value', SPEC_LIMITS.labelLength, add)
        const optionLabel = text(option.label, `${at}.options[${j}].label`, 'An option label', SPEC_LIMITS.labelLength, add)
        if (optionValue === null || optionLabel === null) {
          bad = true
          break
        }
        if (values.has(optionValue)) {
          add(`${at}.options[${j}].value`, 'duplicate-option', `"${optionValue}" appears twice among the options for "${name}".`)
          bad = true
          break
        }
        values.add(optionValue)
        checked.push({ value: optionValue, label: optionLabel })
      }
      if (bad) continue
      ;(input as { options?: readonly { value: string; label: string }[] }).options = checked
      if (one.initial !== undefined && !values.has(String(one.initial))) {
        add(`${at}.initial`, 'initial-not-an-option', `"${name}" starts at ${JSON.stringify(one.initial)}, which is not one of its options.`)
        continue
      }
      ;(input as { initial?: unknown }).initial = one.initial === undefined ? checked[0].value : String(one.initial)
    }

    if (kind === 'number' || kind === 'quantity') {
      let boundsBad = false
      for (const bound of ['minimum', 'maximum'] as const) {
        const held = one[bound]
        if (held === undefined) continue
        if (typeof held !== 'number' || !Number.isFinite(held)) {
          add(`${at}.${bound}`, 'bad-bound', `The ${bound} for "${name}" has to be a real number.`)
          boundsBad = true
        } else if (bound === 'minimum') {
          ;(input as { minimum?: number }).minimum = held
        } else {
          ;(input as { maximum?: number }).maximum = held
        }
      }
      if (boundsBad) continue
      const low = input.minimum
      const high = input.maximum
      if (low !== undefined && high !== undefined && low > high) {
        add(`${at}.minimum`, 'bounds-crossed', `"${name}" cannot be at least ${low} and at most ${high}.`)
        continue
      }
      if (one.initial !== undefined) {
        if (typeof one.initial !== 'number' || !Number.isFinite(one.initial)) {
          add(`${at}.initial`, 'bad-initial', `"${name}" is a number, so it has to start at one.`)
          continue
        }
        if ((low !== undefined && one.initial < low) || (high !== undefined && one.initial > high)) {
          add(`${at}.initial`, 'initial-out-of-range', `"${name}" starts at ${one.initial}, which is outside the range it allows.`)
          continue
        }
        ;(input as { initial?: unknown }).initial = one.initial
      }
      if (kind === 'quantity') {
        const unit = text(one.unit, `${at}.unit`, 'A quantity unit', 40, add)
        if (unit === null) continue
        ;(input as { unit?: string }).unit = unit
      }
    }

    if (kind === 'boolean' && one.initial !== undefined) {
      if (typeof one.initial !== 'boolean') {
        add(`${at}.initial`, 'bad-initial', `"${name}" is true or false, so it has to start at one of those.`)
        continue
      }
      ;(input as { initial?: unknown }).initial = one.initial
    }
    if (kind === 'text' && one.initial !== undefined) {
      const initial = text(one.initial, `${at}.initial`, 'A starting value', SPEC_LIMITS.literalLength, add, false)
      if (initial !== null) (input as { initial?: unknown }).initial = initial
    }

    inputByName.set(name, input)
  }

  // ---------------------------------------------------------------- steps
  const steps = list(spec.steps, 'steps', SPEC_LIMITS.steps, 'The steps')
  const stepByName = new Map<string, SpecStep>()
  /** Which steps each step reads from. */
  const stepReads = new Map<string, string[]>()

  for (let i = 0; i < steps.length; i++) {
    const at = `steps[${i}]`
    const one = steps[i]
    if (!isPlainObject(one)) {
      add(at, 'not-a-step', 'Each step has to be an object.')
      continue
    }
    const name = typeof one.name === 'string' ? one.name : ''
    if (!NAME.test(name)) {
      add(`${at}.name`, 'bad-name', `"${name}" is not a usable step name.`)
      continue
    }
    if (stepByName.has(name) || inputByName.has(name)) {
      // Steps and inputs share one namespace, because they both become fields in the built document and two things
      // with one name would silently overwrite each other.
      add(`${at}.name`, 'duplicate-name', `"${name}" is already the name of ${inputByName.has(name) ? 'an input' : 'another step'}.`)
      continue
    }
    const operation = typeof one.operation === 'string' ? one.operation : ''
    if (!OPERATION.test(operation)) {
      add(`${at}.operation`, 'bad-operation', `"${operation}" is not the shape of an operation. They are written family.name.`)
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(known, operation)) {
      // The whole security argument rests on this line: a generated Page can only do what Orbis already implemented.
      add(
        `${at}.operation`,
        'unknown-operation',
        `There is no calculation called "${operation}". A Page can only use the ones Orbis already has, and this is not one of them.`
      )
      continue
    }
    const when = one.when
    if (when !== 'change' && when !== 'button') {
      add(`${at}.when`, 'bad-when', `"${String(when)}" is not when a step runs. It runs on change or on a button.`)
      continue
    }
    if (!isPlainObject(one.arguments)) {
      add(`${at}.arguments`, 'missing-arguments', `The arguments for "${name}" have to be an object.`)
      continue
    }
    const argumentNames = Object.keys(one.arguments)
    if (argumentNames.length > SPEC_LIMITS.arguments) {
      add(`${at}.arguments`, 'too-many-arguments', `"${name}" takes ${argumentNames.length} arguments, and the most allowed is ${SPEC_LIMITS.arguments}.`)
      continue
    }
    const resolved: Record<string, SpecArgument> = {}
    const readsSteps: string[] = []
    let bad = false
    for (const argument of argumentNames) {
      const where = `${at}.arguments.${argument}`
      if (!NAME.test(argument)) {
        add(where, 'bad-argument-name', `"${argument}" is not a usable argument name.`)
        bad = true
        break
      }
      const source = (one.arguments as Record<string, unknown>)[argument]
      if (!isPlainObject(source)) {
        add(where, 'bad-argument', `"${argument}" has to say where its value comes from: an input, a step, or a value.`)
        bad = true
        break
      }
      const kinds = ['input', 'step', 'value'].filter((key) => Object.prototype.hasOwnProperty.call(source, key))
      if (kinds.length !== 1) {
        add(
          where,
          'ambiguous-argument',
          kinds.length === 0
            ? `"${argument}" does not say where its value comes from.`
            : `"${argument}" says its value comes from ${kinds.join(' and ')}. It can only come from one of them.`
        )
        bad = true
        break
      }
      if (kinds[0] === 'input') {
        const from = String(source.input)
        if (!inputByName.has(from)) {
          add(where, 'unknown-input', `"${name}" takes "${argument}" from the input "${from}", and there is no input with that name.`)
          bad = true
          break
        }
        resolved[argument] = { input: from }
      } else if (kinds[0] === 'step') {
        const from = String(source.step)
        // A step may only read steps declared before it. That is stricter than refusing cycles, and it is deliberate:
        // the order in the list is then the order things happen, which is what somebody reading the spec will assume.
        if (!stepByName.has(from)) {
          add(
            where,
            'unknown-step',
            `"${name}" takes "${argument}" from the step "${from}", and there is no earlier step with that name. A step can only use what came before it.`
          )
          bad = true
          break
        }
        if (source.pick !== undefined && !NAME.test(String(source.pick))) {
          add(where, 'bad-pick', `"${String(source.pick)}" is not a plain property name. A property is a name, never a path.`)
          bad = true
          break
        }
        readsSteps.push(from)
        resolved[argument] = source.pick === undefined ? { step: from } : { step: from, pick: String(source.pick) }
      } else {
        const before = problems.length
        checkLiteral(source.value, `${where}.value`, 0, add)
        if (problems.length !== before) {
          bad = true
          break
        }
        resolved[argument] = { value: source.value }
      }
    }
    if (bad) continue

    if (Object.prototype.hasOwnProperty.call(signatures, operation)) {
      const signature = signatures[operation]
      for (const argument of argumentNames) {
        if (!Object.prototype.hasOwnProperty.call(signature, argument)) {
          add(
            `${at}.arguments.${argument}`,
            'no-such-argument',
            `${operation} does not take "${argument}". It takes ${Object.keys(signature).join(', ')}.`
          )
          bad = true
        }
      }
      for (const [argument, about] of Object.entries(signature)) {
        if (!about.optional && !argumentNames.includes(argument)) {
          add(`${at}.arguments`, 'missing-argument', `${operation} needs "${argument}", and "${name}" does not give it one.`)
          bad = true
          continue
        }
        // A choice given as a literal is checked against what the engine accepts. Only a literal: a choice coming
        // from an input is whatever somebody picks on the day, and the input's own options were checked above.
        const given = Object.prototype.hasOwnProperty.call(resolved, argument) ? resolved[argument] : undefined
        if (about.options === undefined || given === undefined || !('value' in given)) continue
        if (typeof given.value !== 'string' || !about.options.includes(given.value)) {
          add(
            `${at}.arguments.${argument}`,
            'not-an-option',
            `${operation} does not accept ${JSON.stringify(given.value)} for "${argument}". It accepts ${about.options.join(', ')}.`
          )
          bad = true
        }
      }
      if (bad) continue
    }

    if (argumentNames.length === 0) {
      add(
        `${at}.arguments`,
        'no-arguments',
        `"${name}" calls ${operation} with nothing. A calculation with no input has one answer, and it is not a Page.`,
        'warning'
      )
    }

    let describe: string | undefined
    if (one.describe !== undefined) {
      const read = text(one.describe, `${at}.describe`, 'A step description', SPEC_LIMITS.noteLength, add)
      if (read === null) continue
      describe = read
    }
    const step: SpecStep = { name, operation, arguments: resolved, when }
    if (describe !== undefined) (step as { describe?: string }).describe = describe
    stepByName.set(name, step)
    stepReads.set(name, readsSteps)
    usedOperations.add(operation)
  }

  // ---------------------------------------------------------------- outputs
  const outputs = list(spec.outputs, 'outputs', SPEC_LIMITS.outputs, 'The outputs')
  const outputByName = new Map<string, SpecOutput>()
  const shownSteps = new Set<string>()
  for (let i = 0; i < outputs.length; i++) {
    const at = `outputs[${i}]`
    const one = outputs[i]
    if (!isPlainObject(one)) {
      add(at, 'not-an-output', 'Each output has to be an object.')
      continue
    }
    const name = typeof one.name === 'string' ? one.name : ''
    if (!NAME.test(name)) {
      add(`${at}.name`, 'bad-name', `"${name}" is not a usable output name.`)
      continue
    }
    if (outputByName.has(name) || inputByName.has(name) || stepByName.has(name)) {
      add(`${at}.name`, 'duplicate-name', `"${name}" is already the name of something else in this Page.`)
      continue
    }
    const display = one.display
    if (display !== 'value' && display !== 'statistic' && display !== 'table' && display !== 'plot') {
      add(`${at}.display`, 'bad-display', `"${String(display)}" is not a way of showing a result. It has to be value, statistic, table or plot.`)
      continue
    }
    const from = typeof one.step === 'string' ? one.step : ''
    if (!stepByName.has(from)) {
      add(`${at}.step`, 'unknown-step', `"${name}" shows the step "${from}", and there is no step with that name.`)
      continue
    }
    if (one.pick !== undefined && !NAME.test(String(one.pick))) {
      add(`${at}.pick`, 'bad-pick', `"${String(one.pick)}" is not a plain property name.`)
      continue
    }
    if ((display === 'value' || display === 'statistic') && one.pick === undefined) {
      // A `value` bound straight to a whole engine result renders an object, which is never what somebody meant.
      add(
        `${at}.pick`,
        'nothing-picked',
        `"${name}" shows a single number from "${from}", so it has to say which one. A calculation returns a result with several parts.`
      )
      continue
    }
    const label = text(one.label, `${at}.label`, 'An output label', SPEC_LIMITS.labelLength, add)
    if (label === null) continue
    let help: string | undefined
    if (one.help !== undefined) {
      const read = text(one.help, `${at}.help`, 'An output note', SPEC_LIMITS.helpLength, add)
      if (read === null) continue
      help = read
    }
    shownSteps.add(from)
    const output: SpecOutput = { name, label, display, step: from }
    if (one.pick !== undefined) (output as { pick?: string }).pick = String(one.pick)
    if (help !== undefined) (output as { help?: string }).help = help
    outputByName.set(name, output)
  }

  // A step nothing shows and nothing reads is work the Page does and then throws away.
  for (const name of stepByName.keys()) {
    const readByAnother = [...stepReads.values()].some((reads) => reads.includes(name))
    if (!shownSteps.has(name) && !readByAnother) {
      add(`steps.${name}`, 'step-goes-nowhere', `"${name}" is calculated and then nothing shows it or uses it.`, 'warning')
    }
  }
  // An input nothing reads is a control that does nothing when somebody moves it, which is worse than it not being there.
  for (const name of inputByName.keys()) {
    const used = [...stepByName.values()].some((step) =>
      Object.values(step.arguments).some((source) => 'input' in source && source.input === name)
    )
    if (!used) add(`inputs.${name}`, 'input-goes-nowhere', `Nothing uses "${name}", so changing it would do nothing.`, 'warning')
  }

  // ---------------------------------------------------------------- sections
  const sections = list(spec.sections, 'sections', SPEC_LIMITS.sections, 'The sections')
  const placed = new Set<string>()
  for (let i = 0; i < sections.length; i++) {
    const at = `sections[${i}]`
    const one = sections[i]
    if (!isPlainObject(one)) {
      add(at, 'not-a-section', 'Each section has to be an object.')
      continue
    }
    const title = text(one.title, `${at}.title`, 'A section title', SPEC_LIMITS.labelLength, add)
    if (title === null) continue
    if (one.text !== undefined && text(one.text, `${at}.text`, 'Section text', SPEC_LIMITS.noteLength, add) === null) continue
    const members = list(one.members, `${at}.members`, SPEC_LIMITS.members, 'The members of a section')
    if (members.length === 0) {
      add(`${at}.members`, 'empty-section', `"${title}" has nothing in it.`)
      continue
    }
    for (let j = 0; j < members.length; j++) {
      const member = String(members[j])
      if (!inputByName.has(member) && !outputByName.has(member)) {
        add(`${at}.members[${j}]`, 'unknown-member', `"${member}" is not an input or an output of this Page.`)
        continue
      }
      if (placed.has(member)) {
        add(`${at}.members[${j}]`, 'placed-twice', `"${member}" is already in another section.`)
        continue
      }
      placed.add(member)
    }
  }
  for (const name of [...inputByName.keys(), ...outputByName.keys()]) {
    if (!placed.has(name)) add('sections', 'not-placed', `"${name}" is not in any section, so it would never be shown.`)
  }

  // ---------------------------------------------------------------- notes and keywords
  const notes = list(spec.notes, 'notes', SPEC_LIMITS.notes, 'The notes')
  for (let i = 0; i < notes.length; i++) text(notes[i], `notes[${i}]`, 'A note', SPEC_LIMITS.noteLength, add)
  if (notes.length === 0) {
    add(
      'notes',
      'no-limits-stated',
      'This Page does not say what it does not do. Every calculation has assumptions, and a generated Page that states none is claiming to have none.',
      'warning'
    )
  }
  const keywords = list(spec.keywords, 'keywords', SPEC_LIMITS.keywords, 'The keywords')
  for (let i = 0; i < keywords.length; i++) text(keywords[i], `keywords[${i}]`, 'A keyword', 60, add)

  if (stepByName.size === 0) {
    add('steps', 'nothing-computed', 'This Page calculates nothing. A Page that only shows what somebody typed is not a Page.')
  }
  if (outputByName.size === 0) {
    add('outputs', 'nothing-shown', 'This Page shows no results.')
  }

  // Built from what the checker read rather than from what arrived, so anything it did not recognise is simply not
  // here. That is the difference between refusing to repair a spec and refusing to carry the parts it never read.
  normalised = {
    specVersion: SPEC_VERSION,
    title: typeof spec.title === 'string' ? spec.title.trim() : '',
    purpose: typeof spec.purpose === 'string' ? spec.purpose.trim() : '',
    inputs: [...inputByName.values()],
    steps: [...stepByName.values()],
    outputs: [...outputByName.values()],
    sections: sections
      .filter(isPlainObject)
      .map((one) => {
        const built: SpecSection = {
          title: String(one.title).trim(),
          members: (one.members as readonly unknown[]).map((member) => String(member))
        }
        if (one.text !== undefined) (built as { text?: string }).text = String(one.text).trim()
        return built
      }),
    notes: (notes as readonly string[]).map((one) => String(one).trim()),
    keywords: (keywords as readonly string[]).map((one) => String(one).trim().toLowerCase())
  }

  return done()
}

/**
 * The spec as it will actually be compiled: the same data, normalised, with the defaults the checker worked out
 * filled in. It runs the check itself rather than trusting a caller to have run it, because the one thing that must
 * never happen is a spec reaching the compiler unchecked.
 */
export function readSpec(
  raw: unknown,
  known: Readonly<Record<string, string>>,
  signatures: Readonly<Record<string, OperationSignature>> = {}
): { spec: PageSpec; warnings: readonly SpecProblem[] } | { problems: readonly SpecProblem[] } {
  const checked = checkSpec(raw, known, signatures)
  if (!checked.usable || checked.normalised === null) {
    return { problems: checked.problems.filter((one) => one.severity === 'error') }
  }
  return { spec: checked.normalised, warnings: checked.problems.filter((one) => one.severity === 'warning') }
}

export const specErrors = (problems: readonly SpecProblem[]): readonly SpecProblem[] => problems.filter((one) => one.severity === 'error')

export const SPEC_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A specification is data and never code. There is nowhere in this format to put a statement, a function or an expression.',
  'A specification cannot ask for a permission. What a generated Page is allowed to do follows from the calculations it uses, and those come from a table of what Orbis already implemented.',
  'A calculation that is not in that table does not compile. The set of things a generated Page can do is exactly the set Orbis already tested.',
  'A specification is never repaired into validity. A repaired specification is one whose author did not write what runs.',
  'A step may only read steps declared before it, so the order in the list is the order things happen.',
  'A generated Page fetches nothing. There is no field here for a URL, a host or a file path.'
])
