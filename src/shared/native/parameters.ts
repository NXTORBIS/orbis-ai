import { isUnitError, parseUnit, sameDimension, type Dimension } from '../compute/units.ts'

/**
 * Parameters: the only route by which anything changes a Native App's inputs.
 *
 * A parameter is not a slider. It is a declared, typed, bounded, optionally unit-carrying value, and the reason it is
 * a first-class object rather than a number in a component's state is this sentence from the platform brief:
 *
 * > The user can say "Set gravity to 3.7 m/s²" and the system validates it and changes the actual engine
 * > configuration.
 *
 * For that to be true, something other than the UI has to know that gravity is an acceleration, that it is in m/s²,
 * that 3.7 is plausible and -3.7 is not, and that changing it invalidates whatever was computed from it. That is this
 * file.
 *
 * ## Units are checked, not assumed
 *
 * `shared/compute/units.ts` already parses and dimension-checks units for the whole of Orbis, and it is what is used
 * here. So setting gravity to "3.7 kg" is refused because kilograms are not an acceleration — not because a string did
 * not match. A silent unit mismatch is the failure mode that makes a simulation confidently wrong, and it is the one
 * thing a parameter system exists to prevent.
 *
 * ## The pipeline, and why nothing may skip it
 *
 * ```
 * control / Orion
 *        ↓
 * coerce      a typed value, or a refusal
 *        ↓
 * validate    range, step, enum, unit, dependencies
 *        ↓
 * apply       a new parameter set — the old one is never edited
 *        ↓
 * engine
 * ```
 *
 * `apply` returns a new set. Nothing here mutates, which is what makes two open instances of the same app genuinely
 * independent rather than accidentally so.
 *
 * ## Refusing beats clamping
 *
 * A value out of range is reported, not quietly moved to the nearest allowed one. Somebody who asks for a 400-degree
 * launch angle has misunderstood something, and a program that silently uses 360 has hidden that from them.
 *
 * Pure. No clock, no storage.
 */

// ---------------------------------------------------------------- kinds

export type ParameterKind =
  | 'number'
  | 'integer'
  | 'boolean'
  | 'text'
  | 'choice'
  | 'vector'
  | 'numbers'
  | 'expression'
  | 'color'
  | 'reference'

export const PARAMETER_KINDS: readonly ParameterKind[] = Object.freeze([
  'number',
  'integer',
  'boolean',
  'text',
  'choice',
  'vector',
  'numbers',
  'expression',
  'color',
  'reference'
])

export type ParameterValue = number | boolean | string | readonly number[]

export interface Parameter {
  id: string
  name: string
  kind: ParameterKind
  /** The value now. Always of the declared kind, because nothing else can be stored. */
  value: ParameterValue
  /** What it returns to on reset. Never changes. */
  initial: ParameterValue
  /** One line, shown beside the control and used when a refusal has to be explained. */
  about: string

  // numbers
  /** The unit its value is in, e.g. `m/s^2`. Absent for a dimensionless or non-numeric parameter. */
  unit?: string
  least?: number
  most?: number
  /** The smallest meaningful change. Used by controls; a value off the step is allowed, never silently snapped. */
  step?: number
  /** Decimal places for display only. Never applied to the stored value. */
  places?: number

  // choice
  options?: readonly { id: string; label: string }[]

  // vector / numbers
  /** Exactly how many numbers a `vector` holds. Required for `vector`, meaningless for `numbers`. */
  length?: number
  /** The most values a `numbers` parameter may hold. Unbounded input is how a field meant for ten gets a million. */
  mostValues?: number

  // relationships
  /** Parameter ids whose values this one is worked out from. A derived parameter cannot be set directly. */
  from?: readonly string[]
  /** Hidden until each of these has the stated value. Progressive disclosure, declared rather than coded. */
  shownWhen?: readonly { id: string; is: ParameterValue }[]
  /** What grouping a control panel puts it in. */
  group?: string
}

export type ParameterSet = Readonly<Record<string, Parameter>>

// ---------------------------------------------------------------- problems

export interface ParameterProblem {
  id: string
  says: string
  /** What to do about it. Never "try again"; always something specific. */
  fix: string
}

export const isParameterProblem = (value: unknown): value is ParameterProblem =>
  typeof value === 'object' && value !== null && 'id' in value && 'says' in value && 'fix' in value

const fail = (id: string, says: string, fix: string): ParameterProblem => ({ id, says, fix })

export const MOST_VALUES = 100_000
const MOST_TEXT = 4_000

// ---------------------------------------------------------------- building

/**
 * A parameter, or a reason it could not be declared.
 *
 * Checked at declaration rather than at first use, so a mistake in an app's own parameter list surfaces when the app
 * registers rather than when somebody opens it.
 */
export function declare(one: Omit<Parameter, 'value'> & { value?: ParameterValue }): Parameter | ParameterProblem {
  const { id, kind, initial } = one
  if (!id) return fail('', 'A parameter needs an id.', 'Give it one.')
  if (!PARAMETER_KINDS.includes(kind)) return fail(id, `"${kind}" is not a parameter kind.`, `Use one of: ${PARAMETER_KINDS.join(', ')}.`)

  if (one.unit !== undefined) {
    const unit = parseUnit(one.unit)
    if (isUnitError(unit)) return fail(id, `"${one.unit}" is not a unit Orbis knows.`, unit.message)
  }

  if (one.least !== undefined && one.most !== undefined && one.least > one.most) {
    return fail(id, `Its range runs backwards: least ${one.least}, most ${one.most}.`, 'Swap them.')
  }
  if (kind === 'choice') {
    if (!one.options || one.options.length === 0) return fail(id, 'A choice parameter needs options.', 'List them.')
  }
  if (kind === 'vector' && (one.length === undefined || one.length < 1)) {
    return fail(id, 'A vector parameter needs a length.', 'Say how many numbers it holds.')
  }

  // The initial value has to satisfy the parameter's own rules, or reset produces something invalid.
  const held: Parameter = { ...one, value: initial }
  const bad = check(held, initial)
  if (bad !== null) return fail(id, `Its starting value is not allowed: ${bad.says}`, bad.fix)

  return { ...one, value: one.value ?? initial }
}

/** A set from a list, or every problem in it. */
export function declareAll(list: readonly (Omit<Parameter, 'value'> & { value?: ParameterValue })[]): ParameterSet | ParameterProblem[] {
  const out: Record<string, Parameter> = {}
  const problems: ParameterProblem[] = []
  for (const one of list) {
    const made = declare(one)
    if (isParameterProblem(made)) {
      problems.push(made)
      continue
    }
    if (out[made.id]) problems.push(fail(made.id, 'Two parameters share this id.', 'Rename one.'))
    else out[made.id] = made
  }
  // A dependency on a parameter that does not exist can never be satisfied, so it is caught here rather than at run time.
  for (const one of Object.values(out)) {
    for (const want of one.from ?? []) if (!out[want]) problems.push(fail(one.id, `It is worked out from "${want}", which is not a parameter here.`, 'Add it, or remove the dependency.'))
    for (const when of one.shownWhen ?? []) if (!out[when.id]) problems.push(fail(one.id, `It is shown when "${when.id}" has a value, and there is no such parameter.`, 'Fix the condition.'))
  }
  return problems.length > 0 ? problems : Object.freeze(out)
}

// ---------------------------------------------------------------- coercion

/**
 * Text or an unknown value turned into the parameter's own kind, or a refusal.
 *
 * This is where "3.7 m/s²" becomes 3.7 after the unit has been checked against the parameter's dimension, and where
 * "fast" becomes a refusal rather than NaN. Nothing downstream has to wonder whether a value is a number.
 */
export function coerce(parameter: Parameter, raw: unknown): ParameterValue | ParameterProblem {
  const { id, kind } = parameter

  if (parameter.from && parameter.from.length > 0) {
    return fail(id, `${parameter.name} is worked out from other values.`, `Change ${parameter.from.join(' or ')} instead.`)
  }

  switch (kind) {
    case 'boolean': {
      if (typeof raw === 'boolean') return raw
      const word = String(raw).trim().toLowerCase()
      if (word === 'true' || word === 'yes' || word === 'on' || word === '1') return true
      if (word === 'false' || word === 'no' || word === 'off' || word === '0') return false
      return fail(id, `"${String(raw)}" is not yes or no.`, 'Use true or false.')
    }
    case 'number':
    case 'integer': {
      const found = readQuantity(parameter, raw)
      if (isParameterProblem(found)) return found
      if (kind === 'integer' && !Number.isInteger(found)) {
        return fail(id, `${parameter.name} is a whole number and ${found} is not.`, 'Use a whole number.')
      }
      return found
    }
    case 'text':
    case 'expression':
    case 'color':
    case 'reference': {
      if (typeof raw !== 'string') return fail(id, `${parameter.name} is text.`, 'Give it text.')
      if (raw.length > MOST_TEXT) return fail(id, `That is longer than ${MOST_TEXT} characters.`, 'Shorten it.')
      return raw
    }
    case 'choice': {
      const word = String(raw).trim()
      const found = (parameter.options ?? []).find((one) => one.id === word || one.label.toLowerCase() === word.toLowerCase())
      if (!found) {
        const names = (parameter.options ?? []).map((one) => one.label).join(', ')
        /*
         * The parameter is named, as every other refusal in this file names it.
         *
         * It did not, and a batch of thirteen values refused for one bad choice read as `"unobtainium" is not one of
         * the choices` with nothing saying which control that was — so a caller could see that something was wrong
         * and not what.
         */
        return fail(id, `${parameter.name}: "${word}" is not one of the choices.`, `Choose one of: ${names}.`)
      }
      return found.id
    }
    case 'vector':
    case 'numbers': {
      const list = readNumberList(raw)
      if (list === null) return fail(id, `${parameter.name} is a list of numbers.`, 'Give numbers separated by commas.')
      return list
    }
    default:
      return fail(id, `"${String(kind)}" is not a parameter kind.`, 'This is a programming error in the app.')
  }
}

/**
 * A number with an optional unit, dimension-checked against what the parameter is in.
 *
 * "3.7 m/s^2" into a parameter declared in m/s² is 3.7. Into a parameter declared in kilograms it is a refusal, and
 * that refusal is the point of the whole file.
 */
function readQuantity(parameter: Parameter, raw: unknown): number | ParameterProblem {
  const { id } = parameter
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return fail(id, 'That is not a finite number.', 'Give a real number.')
    return raw
  }
  if (typeof raw !== 'string') return fail(id, `${parameter.name} is a number.`, 'Give it a number.')

  const written = raw.trim()
  if (!written) return fail(id, `${parameter.name} was left empty.`, 'Give it a number.')

  const match = /^([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*(.*)$/.exec(written)
  if (!match) return fail(id, `"${written}" is not a number.`, 'Give a number, optionally with a unit.')

  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return fail(id, `"${written}" is not a finite number.`, 'Give a real number.')

  const written_unit = match[2].trim()
  if (!written_unit) return amount

  const given = parseUnit(written_unit)
  if (isUnitError(given)) return fail(id, `"${written_unit}" is not a unit Orbis knows.`, given.message)

  if (parameter.unit === undefined) {
    return fail(id, `${parameter.name} has no unit, and "${written_unit}" is one.`, 'Give the number on its own.')
  }
  const wanted = parseUnit(parameter.unit)
  if (isUnitError(wanted)) return fail(id, `${parameter.name} declares a unit Orbis cannot parse.`, 'This is a programming error in the app.')

  if (!sameDimension(given.dimension as Dimension, wanted.dimension as Dimension)) {
    return fail(
      id,
      `${parameter.name} is measured in ${parameter.unit}, and ${written_unit} measures something else.`,
      `Give it in ${parameter.unit}, or in anything of the same kind.`
    )
  }

  // Converted into the parameter's own unit, so everything stored is in one unit and the engine never converts.
  const inBase = amount * given.factor + given.offset
  return (inBase - wanted.offset) / wanted.factor
}

function readNumberList(raw: unknown): number[] | null {
  if (Array.isArray(raw)) {
    const out: number[] = []
    for (const one of raw) {
      const found = typeof one === 'number' ? one : Number(String(one).trim())
      if (!Number.isFinite(found)) return null
      out.push(found)
    }
    return out
  }
  if (typeof raw !== 'string') return null
  const parts = raw.split(/[,;\s]+/).filter((one) => one.length > 0)
  const out: number[] = []
  for (const part of parts) {
    const found = Number(part)
    if (!Number.isFinite(found)) return null
    out.push(found)
  }
  return out
}

// ---------------------------------------------------------------- validation

/** Whether an already-coerced value satisfies the parameter's rules. Null when it does. */
export function check(parameter: Parameter, value: ParameterValue): ParameterProblem | null {
  const { id, name } = parameter

  switch (parameter.kind) {
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail(id, `${name} has to be a finite number.`, 'Give a real number.')
      if (parameter.kind === 'integer' && !Number.isInteger(value)) return fail(id, `${name} has to be a whole number.`, 'Round it.')
      if (parameter.least !== undefined && value < parameter.least) {
        return fail(id, `${name} cannot be below ${parameter.least}${unitSuffix(parameter)}.`, `Use ${parameter.least} or more.`)
      }
      if (parameter.most !== undefined && value > parameter.most) {
        return fail(id, `${name} cannot be above ${parameter.most}${unitSuffix(parameter)}.`, `Use ${parameter.most} or less.`)
      }
      return null
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : fail(id, `${name} is yes or no.`, 'Use true or false.')
    case 'choice': {
      if (typeof value !== 'string') return fail(id, `${name} is one of a set of choices.`, 'Choose one.')
      return (parameter.options ?? []).some((one) => one.id === value)
        ? null
        : fail(
            id,
            `${name}: "${value}" is not one of the choices.`,
            `Choose one of: ${(parameter.options ?? []).map((one) => one.label).join(', ')}.`
          )
    }
    case 'text':
    case 'expression':
    case 'color':
    case 'reference':
      if (typeof value !== 'string') return fail(id, `${name} is text.`, 'Give it text.')
      return value.length > MOST_TEXT ? fail(id, `${name} is longer than ${MOST_TEXT} characters.`, 'Shorten it.') : null
    case 'vector': {
      if (!Array.isArray(value)) return fail(id, `${name} is a list of numbers.`, 'Give numbers separated by commas.')
      if (parameter.length !== undefined && value.length !== parameter.length) {
        return fail(id, `${name} takes exactly ${parameter.length} numbers and was given ${value.length}.`, `Give ${parameter.length}.`)
      }
      return everyFinite(value) ? null : fail(id, `${name} contains something that is not a number.`, 'Give only numbers.')
    }
    case 'numbers': {
      if (!Array.isArray(value)) return fail(id, `${name} is a list of numbers.`, 'Give numbers separated by commas.')
      const most = parameter.mostValues ?? MOST_VALUES
      if (value.length > most) return fail(id, `${name} takes at most ${most} numbers and was given ${value.length}.`, 'Give fewer.')
      return everyFinite(value) ? null : fail(id, `${name} contains something that is not a number.`, 'Give only numbers.')
    }
    default:
      return fail(id, 'This parameter has no kind.', 'This is a programming error in the app.')
  }
}

const everyFinite = (list: readonly unknown[]): boolean => list.every((one) => typeof one === 'number' && Number.isFinite(one))

const unitSuffix = (parameter: Parameter): string => (parameter.unit ? ` ${parameter.unit}` : '')

// ---------------------------------------------------------------- applying

export interface Applied {
  parameters: ParameterSet
  /** The ids that actually changed. Empty when the value given was the one already held. */
  changed: readonly string[]
}

/**
 * A value set, coerced and validated, returning a new set.
 *
 * Returns the problem rather than a partly-updated set: a parameter change that half-applied leaves an app in a state
 * neither the user nor the engine asked for.
 */
export function set(parameters: ParameterSet, id: string, raw: unknown): Applied | ParameterProblem {
  const parameter = parameters[id]
  if (!parameter) return fail(id, `There is no parameter called "${id}".`, 'Check the name.')

  const value = coerce(parameter, raw)
  if (isParameterProblem(value)) return value
  const bad = check(parameter, value)
  if (bad !== null) return bad

  if (same(parameter.value, value)) return { parameters, changed: [] }
  return { parameters: Object.freeze({ ...parameters, [id]: { ...parameter, value } }), changed: [id] }
}

/**
 * Several values at once, all or nothing.
 *
 * Orion configuring an app on launch sets five parameters in one go, and three of them landing is worse than none: the
 * app would then be running a configuration nobody described.
 */
export function setAll(parameters: ParameterSet, values: Readonly<Record<string, unknown>>): Applied | ParameterProblem[] {
  const problems: ParameterProblem[] = []
  let next = parameters
  const changed: string[] = []

  for (const [id, raw] of Object.entries(values)) {
    const applied = set(next, id, raw)
    if (isParameterProblem(applied)) {
      problems.push(applied)
      continue
    }
    next = applied.parameters
    changed.push(...applied.changed)
  }

  if (problems.length > 0) return problems
  return { parameters: next, changed }
}

/** Every parameter back to its starting value. */
export function reset(parameters: ParameterSet): Applied {
  const out: Record<string, Parameter> = {}
  const changed: string[] = []
  for (const [id, one] of Object.entries(parameters)) {
    out[id] = { ...one, value: one.initial }
    if (!same(one.value, one.initial)) changed.push(id)
  }
  return { parameters: Object.freeze(out), changed }
}

const same = (a: ParameterValue, b: ParameterValue): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((one, at) => one === b[at])
  return a === b
}

// ---------------------------------------------------------------- reading

/** Just the values, which is what an engine is handed. */
export function values(parameters: ParameterSet): Record<string, ParameterValue> {
  const out: Record<string, ParameterValue> = {}
  for (const [id, one] of Object.entries(parameters)) out[id] = one.value
  return out
}

/**
 * Which parameters a control panel should show, given what the others hold.
 *
 * Progressive disclosure, worked out rather than coded into each app: an app declares `shownWhen` and gets a panel
 * that starts simple and grows. Showing a hundred parameters at once is how a laboratory becomes unusable.
 */
export function visible(parameters: ParameterSet): readonly string[] {
  const out: string[] = []
  for (const [id, one] of Object.entries(parameters)) {
    const conditions = one.shownWhen ?? []
    /*
     * Conditions on the *same* parameter are alternatives; conditions on different parameters must all hold.
     *
     * Requiring all of them unconditionally made "show this for either of two values" impossible to express, and
     * worse, impossible to notice: two conditions on one parameter simply meant the control could never appear. The
     * walk-order control on the structures laboratory, which belongs to both kinds of tree, is what found it.
     */
    const byParameter = new Map<string, { id: string; is: ParameterValue }[]>()
    for (const when of conditions) {
      const held = byParameter.get(when.id)
      if (held === undefined) byParameter.set(when.id, [when])
      else held.push(when)
    }
    const satisfied = [...byParameter.values()].every((group) =>
      group.some((when) => parameters[when.id] !== undefined && same(parameters[when.id].value, when.is))
    )
    if (satisfied) out.push(id)
  }
  /*
   * A control whose condition points at a hidden control is hidden too.
   *
   * The blur radius appears when the filter is a Gaussian one, and the filter itself only appears while the panel is
   * showing filters. Pick a Gaussian blur, then switch the panel to adjustments, and the radius was still on screen
   * next to nothing it could affect -- a control that does nothing, which is the one thing these panels must not have.
   */
  let shown = new Set(out)
  for (let round = 0; round < out.length; round += 1) {
    const next = new Set(
      [...shown].filter((id) =>
        (parameters[id].shownWhen ?? []).every((when) => parameters[when.id] === undefined || shown.has(when.id))
      )
    )
    if (next.size === shown.size) break
    shown = next
  }
  return out.filter((id) => shown.has(id))
}

/**
 * Everything that has to be recomputed because these parameters changed.
 *
 * Walks `from` edges forwards, so changing a mass marks the momentum derived from it. Without this a derived value
 * stays on screen next to the input it no longer matches, which is the silent-staleness failure `shared/pages/lab.ts`
 * describes at the graph level.
 */
export function affectedBy(parameters: ParameterSet, changed: readonly string[]): readonly string[] {
  const out = new Set<string>()
  let frontier = new Set(changed)
  // Bounded by the number of parameters: a `from` cycle cannot extend the walk for ever.
  for (let round = 0; round < Object.keys(parameters).length && frontier.size > 0; round += 1) {
    const next = new Set<string>()
    for (const one of Object.values(parameters)) {
      if (out.has(one.id)) continue
      if ((one.from ?? []).some((want) => frontier.has(want))) {
        out.add(one.id)
        next.add(one.id)
      }
    }
    frontier = next
  }
  return [...out]
}

/** A value as a person would read it, unit included. For display only. */
export function describe(parameter: Parameter): string {
  const { value } = parameter
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (Array.isArray(value)) return value.length > 8 ? `${value.length} values` : value.join(', ')
  if (typeof value === 'number') {
    const shown = parameter.places !== undefined ? value.toFixed(parameter.places) : String(value)
    return parameter.unit ? `${shown} ${parameter.unit}` : shown
  }
  if (parameter.kind === 'choice') {
    const found = (parameter.options ?? []).find((one) => one.id === value)
    return found ? found.label : String(value)
  }
  return String(value)
}
