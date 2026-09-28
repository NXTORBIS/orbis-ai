/**
 * The Universal Generator: a specification, a generator, and output that is checked against what was asked for.
 *
 * The thing this exists to prevent is the most common failure of generation: asking for 500 rows, getting 487, and
 * being told it worked. Every specification carries what it requires, and `validate` checks the output against it --
 * count, uniqueness, schema, range -- before anything is reported as produced.
 *
 * ## Deterministic where it can be
 *
 * A dataset of numbers with a stated distribution, a schedule under constraints, a set of unique identifiers: these
 * are algorithms, and they run with a seed so the same request gives the same result. Only the parts that genuinely
 * need meaning -- the wording of a question, the prose of a section -- go to a model, and the structure around them is
 * still checked.
 *
 * ## Partial is not complete
 *
 * A generator that produced 80 of 100 items reports 80 and says so. The quantity asked for is part of the request,
 * not a target to approach.
 */

import { accurateSum } from '../compute/statistics.ts'
import { drawFrom, randomStream, type Distribution, type RandomStream } from '../compute/uncertainty.ts'

export interface GeneratorError {
  error: string
  message: string
}

export const isGeneratorError = (value: unknown): value is GeneratorError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): GeneratorError => ({ error, message })

export const GENERATOR_LIMITS: Readonly<Record<'items' | 'columns' | 'attempts' | 'fields' | 'textLength', number>> = Object.freeze({
  items: 1_000_000,
  columns: 500,
  attempts: 100,
  fields: 200,
  textLength: 2_000_000
})

// ---------------------------------------------------------------- specifications

export type OutputKind = 'dataset' | 'document' | 'questions' | 'schedule' | 'code' | 'identifiers' | 'structure'

export interface FieldSpec {
  name: string
  kind: 'number' | 'integer' | 'text' | 'boolean' | 'category' | 'date'
  /** For a numeric field: how its values are distributed. */
  distribution: Distribution | null
  /** For a categorical field: the values and their relative frequencies. */
  categories: { value: string; weight: number }[]
  /** Hard bounds the generated values must respect. */
  bounds: { low: number | null; high: number | null }
  unique: boolean
  /** The share of values that should be missing, for generating realistic test data. */
  missingRate: number
}

export interface Constraint {
  id: string
  describe: string
  holds: (item: Record<string, unknown>) => boolean
}

export interface Specification {
  id: string
  kind: OutputKind
  /** Exactly how many. Not a target; the output is checked against it. */
  quantity: number
  fields: FieldSpec[]
  constraints: Constraint[]
  /** Correlations between numeric fields, as pairs. */
  correlations: { a: string; b: string; value: number }[]
  seed: number
  /** Whether every item has to differ from every other. */
  distinct: boolean
  describe: string
}

export interface SpecCheck {
  ok: boolean
  problems: string[]
  notes: string[]
}

/** Whether a specification can be satisfied at all, checked before anything is generated. */
export function checkSpecification(spec: Specification): SpecCheck {
  const problems: string[] = []
  const notes: string[] = []

  if (!Number.isInteger(spec.quantity) || spec.quantity < 0) {
    problems.push('The quantity has to be a whole number that is not negative.')
  }
  if (spec.quantity > GENERATOR_LIMITS.items) {
    problems.push(`${spec.quantity.toLocaleString('en')} items is past the ${GENERATOR_LIMITS.items.toLocaleString('en')} Orbis generates at once.`)
  }
  if (spec.fields.length > GENERATOR_LIMITS.fields) {
    problems.push(`A specification holds at most ${GENERATOR_LIMITS.fields} fields.`)
  }

  const names = new Set<string>()
  for (const field of spec.fields) {
    if (names.has(field.name)) problems.push(`There are two fields called "${field.name}".`)
    names.add(field.name)

    if (field.kind === 'category' && field.categories.length === 0) {
      problems.push(`"${field.name}" is categorical and has no categories to draw from.`)
    }
    if ((field.kind === 'number' || field.kind === 'integer') && field.distribution === null && field.bounds.low === null) {
      problems.push(`"${field.name}" is numeric and has neither a distribution nor bounds, so there is nothing to draw from.`)
    }
    if (field.missingRate < 0 || field.missingRate > 1) {
      problems.push(`"${field.name}" has a missing rate of ${field.missingRate}, which is not a fraction between 0 and 1.`)
    }

    // A unique field needs enough distinct values to go round, which for a small category set it will not have.
    if (field.unique && field.kind === 'category' && field.categories.length < spec.quantity) {
      problems.push(
        `"${field.name}" has to be unique and has ${field.categories.length} categories, which cannot fill ${spec.quantity} rows. Uniqueness needs at least as many possible values as items.`
      )
    }
    if (field.unique && field.kind === 'integer' && field.bounds.low !== null && field.bounds.high !== null) {
      const span = field.bounds.high - field.bounds.low + 1
      if (span < spec.quantity) {
        problems.push(`"${field.name}" has to be unique and its bounds allow ${span} values, which cannot fill ${spec.quantity} rows.`)
      }
    }
  }

  for (const correlation of spec.correlations) {
    if (!names.has(correlation.a) || !names.has(correlation.b)) {
      problems.push(`A correlation mentions a field that is not in the specification.`)
    }
    if (correlation.value < -1 || correlation.value > 1) {
      problems.push('A correlation is a number between -1 and 1.')
    }
  }

  if (spec.constraints.length > 0 && spec.quantity > 0) {
    notes.push(
      `${spec.constraints.length} constraint${spec.constraints.length === 1 ? '' : 's'} will be applied by rejecting and redrawing. If ${spec.constraints.length === 1 ? 'it is' : 'they are'} narrow, generation may not reach the quantity asked for -- and it will say so rather than returning fewer.`
    )
  }
  if (spec.correlations.length > 0) {
    notes.push('Correlations are applied to normally distributed fields. A correlated field with another distribution would need a different method, and is refused rather than approximated.')
  }

  return { ok: problems.length === 0, problems, notes }
}

// ---------------------------------------------------------------- generation

export interface Generated<T> {
  items: T[]
  /** How many were asked for, alongside how many there are. Both, always. */
  requested: number
  produced: number
  complete: boolean
  /** Draws thrown away for breaking a constraint or repeating a unique value. */
  rejected: number
  seed: number
  notes: string[]
}

/**
 * A dataset with the distributions, bounds and correlations asked for.
 *
 * Correlated fields are drawn from a joint normal through a Cholesky factor of the correlation matrix, which is the
 * only honest way to do it for normal fields -- and it is refused for any other distribution rather than applied to
 * something it does not describe.
 */
export function generateDataset(spec: Specification): Generated<Record<string, unknown>> | GeneratorError {
  const check = checkSpecification(spec)
  if (!check.ok) return fail('invalid-specification', check.problems.join(' '))

  const correlated = new Set(spec.correlations.flatMap((one) => [one.a, one.b]))
  for (const name of correlated) {
    const field = spec.fields.find((one) => one.name === name)
    if (field && field.distribution !== null && field.distribution.kind !== 'normal') {
      return fail(
        'unsupported-correlation',
        `"${name}" is correlated with another field and is not normally distributed. Correlating through a joint normal only describes normal fields; anything else needs a different method, and applying this one would produce data whose correlation is not what was asked for.`
      )
    }
  }

  const streams = new Map<string, RandomStream>()
  spec.fields.forEach((field, i) => streams.set(field.name, randomStream(spec.seed, i + 1)))
  const jointStream = randomStream(spec.seed, 0)

  // The Cholesky factor of the correlation matrix, for the fields that are correlated.
  const correlatedFields = spec.fields.filter((one) => correlated.has(one.name))
  let factor: number[][] | null = null
  if (correlatedFields.length > 1) {
    const n = correlatedFields.length
    const matrix: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        if (i === j) return 1
        const found = spec.correlations.find(
          (one) =>
            (one.a === correlatedFields[i].name && one.b === correlatedFields[j].name) ||
            (one.b === correlatedFields[i].name && one.a === correlatedFields[j].name)
        )
        return found?.value ?? 0
      })
    )
    const built = cholesky(matrix)
    if (built === null) {
      return fail(
        'impossible-correlation',
        'Those correlations cannot all hold at once: they imply a combination of the fields with negative variance. Correlations set one pair at a time can contradict each other even when each looks reasonable.'
      )
    }
    factor = built
  }

  const items: Record<string, unknown>[] = []
  const seenUnique = new Map<string, Set<string>>()
  for (const field of spec.fields) if (field.unique) seenUnique.set(field.name, new Set())
  const seenItems = new Set<string>()
  let rejected = 0

  for (let i = 0; i < spec.quantity; i++) {
    let accepted: Record<string, unknown> | null = null

    for (let attempt = 0; attempt < GENERATOR_LIMITS.attempts && accepted === null; attempt++) {
      const item: Record<string, unknown> = {}

      // The correlated block first, drawn together.
      if (factor) {
        const z = correlatedFields.map(() => jointStream.normal())
        correlatedFields.forEach((field, index) => {
          let sum = 0
          for (let k = 0; k <= index; k++) sum += (factor as number[][])[index][k] * z[k]
          const distribution = field.distribution
          const mean = distribution && distribution.kind === 'normal' ? distribution.mean : 0
          const spread = distribution && distribution.kind === 'normal' ? distribution.standardDeviation : 1
          set(item, field.name, clampTo(field, mean + sum * spread))
        })
      }

      let drewOutside = false
      for (const field of spec.fields) {
        if (Object.prototype.hasOwnProperty.call(item, field.name)) continue
        const stream = streams.get(field.name) as RandomStream
        const drawn = drawField(field, stream)
        if (drawn === OUT_OF_BOUNDS) {
          drewOutside = true
          break
        }
        set(item, field.name, drawn)
      }
      if (drewOutside) {
        // Redraw rather than clamp. Clamping a distribution into its bounds piles every stray draw onto the boundary,
        // which turns a normal field into a spike at each end -- and for a unique field it guarantees collisions.
        rejected += 1
        continue
      }

      // Missing values last, so the drawn value is the one that would have been there.
      for (const field of spec.fields) {
        if (field.missingRate <= 0) continue
        const stream = streams.get(field.name) as RandomStream
        if (stream.next() < field.missingRate) set(item, field.name, null)
      }

      let ok = true
      for (const field of spec.fields) {
        if (!field.unique) continue
        const value = String(item[field.name])
        const seen = seenUnique.get(field.name) as Set<string>
        if (seen.has(value)) {
          ok = false
          break
        }
      }
      if (ok) {
        for (const constraint of spec.constraints) {
          let holds = false
          try {
            holds = constraint.holds(item) === true
          } catch {
            holds = false
          }
          if (!holds) {
            ok = false
            break
          }
        }
      }
      if (ok && spec.distinct) {
        const key = JSON.stringify(spec.fields.map((one) => item[one.name]))
        if (seenItems.has(key)) ok = false
        else seenItems.add(key)
      }

      if (ok) accepted = item
      else rejected += 1
    }

    if (accepted === null) break
    for (const field of spec.fields) {
      if (!field.unique) continue
      ;(seenUnique.get(field.name) as Set<string>).add(String(accepted[field.name]))
    }
    items.push(accepted)
  }

  const notes: string[] = [...check.notes, `Seed ${spec.seed}. The same specification and seed give the same data.`]
  if (rejected > 0) {
    notes.push(`${rejected.toLocaleString('en')} draws were thrown away for breaking a constraint or repeating a value that has to be unique.`)
  }
  if (items.length < spec.quantity) {
    notes.push(
      `Only ${items.length.toLocaleString('en')} of the ${spec.quantity.toLocaleString('en')} asked for could be produced. The constraints are narrow enough that redrawing stopped finding values that satisfy them. This is a partial result, not a complete one.`
    )
  }

  return { items, requested: spec.quantity, produced: items.length, complete: items.length === spec.quantity, rejected, seed: spec.seed, notes }
}

/** `defineProperty`, so a field called `__proto__` becomes a field rather than a change to the item's prototype. */
const set = (item: Record<string, unknown>, key: string, value: unknown): void => {
  Object.defineProperty(item, key, { value, enumerable: true, writable: true, configurable: true })
}

/** A draw that fell outside the field's bounds. Distinguished from a value, so the caller redraws rather than clamps. */
const OUT_OF_BOUNDS = Symbol('out-of-bounds')

function drawField(field: FieldSpec, stream: RandomStream): unknown {
  switch (field.kind) {
    case 'boolean':
      return stream.next() < 0.5
    case 'category': {
      const total = accurateSum(field.categories.map((one) => one.weight))
      let target = stream.next() * total
      for (const category of field.categories) {
        target -= category.weight
        if (target <= 0) return category.value
      }
      return field.categories[field.categories.length - 1].value
    }
    case 'text':
      // Deterministic filler, because inventing plausible prose is a model's job and this is not that.
      return `${field.name}-${Math.floor(stream.next() * 1e9).toString(36)}`
    case 'date': {
      const low = field.bounds.low ?? 0
      const high = field.bounds.high ?? low + 365
      return Math.round(low + stream.next() * (high - low))
    }
    case 'integer':
    case 'number': {
      if (!field.distribution) {
        // No distribution: draw uniformly across the bounds, which cannot fall outside them.
        const low = field.bounds.low ?? 0
        const high = field.bounds.high ?? 1
        const raw = low + stream.next() * (high - low)
        return field.kind === 'integer' ? Math.round(raw) : raw
      }
      const drawn = drawFrom(field.distribution, stream)
      const value = field.kind === 'integer' ? Math.round(drawn) : drawn
      if (field.bounds.low !== null && value < field.bounds.low) return OUT_OF_BOUNDS
      if (field.bounds.high !== null && value > field.bounds.high) return OUT_OF_BOUNDS
      return value
    }
  }
}

/** A correlated draw brought inside its field's bounds. Correlated values cannot be redrawn one at a time. */
function clampTo(field: FieldSpec, value: number): number {
  let out = value
  if (field.bounds.low !== null) out = Math.max(field.bounds.low, out)
  if (field.bounds.high !== null) out = Math.min(field.bounds.high, out)
  return field.kind === 'integer' ? Math.round(out) : out
}

/** The Cholesky factor, or `null` where the matrix is not a possible correlation matrix. */
function cholesky(matrix: readonly (readonly number[])[]): number[][] | null {
  const n = matrix.length
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = matrix[i][j]
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k]
      if (i === j) {
        if (sum < -1e-10) return null
        L[i][j] = Math.sqrt(Math.max(0, sum))
      } else {
        L[i][j] = L[j][j] > 1e-12 ? sum / L[j][j] : 0
      }
    }
  }
  return L
}

// ---------------------------------------------------------------- validation

export interface ValidationRule {
  id: string
  describe: string
  check: (items: readonly unknown[]) => { passed: boolean; detail: string }
}

export interface Validation {
  ok: boolean
  results: { rule: string; passed: boolean; detail: string }[]
  describe: string
}

/**
 * Output checked against the specification that asked for it.
 *
 * The count check is the one that matters most and is the one most often skipped. Asking for 500 and producing 487 is
 * a failure of the request, not a rounding, and reporting it as success is the single most common way a generator
 * lies.
 */
export function validate(spec: Specification, items: readonly Record<string, unknown>[], extra: readonly ValidationRule[] = []): Validation {
  const results: Validation['results'] = []

  results.push({
    rule: 'count',
    passed: items.length === spec.quantity,
    detail:
      items.length === spec.quantity
        ? `${items.length} items, which is what was asked for.`
        : `${items.length} items were produced and ${spec.quantity} were asked for. That is a failure of the request, not a rounding.`
  })

  for (const field of spec.fields) {
    const present = items.filter((one) => one[field.name] !== null && one[field.name] !== undefined)

    if (field.unique) {
      const seen = new Set(present.map((one) => String(one[field.name])))
      results.push({
        rule: `unique:${field.name}`,
        passed: seen.size === present.length,
        detail:
          seen.size === present.length
            ? `Every value of ${field.name} is different.`
            : `${present.length - seen.size} values of ${field.name} repeat, and it is meant to be unique.`
      })
    }

    if (field.bounds.low !== null || field.bounds.high !== null) {
      const outside = present.filter((one) => {
        const value = one[field.name]
        if (typeof value !== 'number') return false
        if (field.bounds.low !== null && value < field.bounds.low) return true
        if (field.bounds.high !== null && value > field.bounds.high) return true
        return false
      })
      results.push({
        rule: `bounds:${field.name}`,
        passed: outside.length === 0,
        detail: outside.length === 0 ? `Every value of ${field.name} is inside its bounds.` : `${outside.length} values of ${field.name} are outside its bounds.`
      })
    }

    if (field.kind === 'integer') {
      const fractional = present.filter((one) => typeof one[field.name] === 'number' && !Number.isInteger(one[field.name] as number))
      results.push({
        rule: `integer:${field.name}`,
        passed: fractional.length === 0,
        detail: fractional.length === 0 ? `Every value of ${field.name} is a whole number.` : `${fractional.length} values of ${field.name} are not whole numbers.`
      })
    }

    if (field.kind === 'category' && field.categories.length > 0) {
      const allowed = new Set(field.categories.map((one) => one.value))
      const strange = present.filter((one) => !allowed.has(String(one[field.name])))
      results.push({
        rule: `categories:${field.name}`,
        passed: strange.length === 0,
        detail: strange.length === 0 ? `Every value of ${field.name} is one of its categories.` : `${strange.length} values of ${field.name} are not among its categories.`
      })
    }
  }

  for (const constraint of spec.constraints) {
    const broken = items.filter((one) => {
      try {
        return constraint.holds(one) !== true
      } catch {
        return true
      }
    })
    results.push({
      rule: `constraint:${constraint.id}`,
      passed: broken.length === 0,
      detail: broken.length === 0 ? `Every item satisfies "${constraint.describe}".` : `${broken.length} items break "${constraint.describe}".`
    })
  }

  for (const rule of extra) {
    const outcome = rule.check(items)
    results.push({ rule: rule.id, passed: outcome.passed, detail: outcome.detail })
  }

  const failed = results.filter((one) => !one.passed)
  return {
    ok: failed.length === 0,
    results,
    describe:
      failed.length === 0
        ? `All ${results.length} checks pass.`
        : `${failed.length} of ${results.length} checks fail: ${failed.map((one) => one.detail).join(' ')}`
  }
}

// ---------------------------------------------------------------- scheduling

export interface Slot {
  id: string
  label: string
  start: number
  duration: number
  resource: string
}

export interface ScheduleRequest {
  items: { id: string; label: string; duration: number; resource: string; notBefore: number; notAfter: number }[]
  /** Windows nothing may be scheduled in. */
  blocked: { from: number; to: number; resource: string }[]
  horizon: number
  seed: number
}

/**
 * A schedule that satisfies its constraints, by earliest-fit placement.
 *
 * Deterministic: items are placed in order of how tight their window is, and each goes at the earliest time that
 * works. An item that cannot be placed is reported as unplaced rather than squeezed in somewhere that breaks a
 * constraint, because a schedule with a conflict in it is worse than a schedule with a hole.
 */
export function generateSchedule(request: ScheduleRequest): Generated<Slot> & { unplaced: { id: string; why: string }[] } | GeneratorError {
  if (request.items.length > GENERATOR_LIMITS.items) return fail('too-many', 'That is more items than Orbis schedules at once.')
  if (!Number.isFinite(request.horizon) || request.horizon <= 0) return fail('invalid-argument', 'The horizon has to be a positive number.')

  for (const item of request.items) {
    if (item.duration <= 0) return fail('invalid-argument', `"${item.label}" has a duration of ${item.duration}. A duration has to be positive.`)
    if (item.notAfter - item.notBefore < item.duration) {
      return fail(
        'impossible-window',
        `"${item.label}" takes ${item.duration} and its window from ${item.notBefore} to ${item.notAfter} is only ${item.notAfter - item.notBefore} wide. No placement fits it.`
      )
    }
  }

  // Tightest window first: placing the constrained items while there is still room is what makes greedy work here.
  const order = [...request.items].sort(
    (a, b) => (a.notAfter - a.notBefore - a.duration) - (b.notAfter - b.notBefore - b.duration) || a.id.localeCompare(b.id)
  )

  const placed: Slot[] = []
  const unplaced: { id: string; why: string }[] = []

  for (const item of order) {
    const conflicts = [
      ...placed.filter((one) => one.resource === item.resource).map((one) => ({ from: one.start, to: one.start + one.duration })),
      ...request.blocked.filter((one) => one.resource === item.resource).map((one) => ({ from: one.from, to: one.to }))
    ].sort((a, b) => a.from - b.from)

    let at = item.notBefore
    let found = false
    for (let guard = 0; guard <= conflicts.length; guard++) {
      const clash = conflicts.find((one) => at < one.to && at + item.duration > one.from)
      if (!clash) {
        found = at + item.duration <= item.notAfter && at + item.duration <= request.horizon
        break
      }
      at = clash.to
    }

    if (found) placed.push({ id: item.id, label: item.label, start: at, duration: item.duration, resource: item.resource })
    else {
      unplaced.push({
        id: item.id,
        why: `No time between ${item.notBefore} and ${item.notAfter} on ${item.resource} is free for ${item.duration}. It is left unplaced rather than put somewhere that breaks a constraint.`
      })
    }
  }

  placed.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))

  return {
    items: placed,
    requested: request.items.length,
    produced: placed.length,
    complete: unplaced.length === 0,
    rejected: 0,
    seed: request.seed,
    unplaced,
    notes: [
      `${placed.length} of ${request.items.length} placed, tightest window first.`,
      unplaced.length > 0
        ? `${unplaced.length} could not be placed. A schedule with a hole is more useful than one with a conflict in it.`
        : 'Everything fits, and nothing overlaps on any resource.'
    ]
  }
}

// ---------------------------------------------------------------- identifiers

/**
 * Unique identifiers, generated deterministically from a seed.
 *
 * Deterministic on purpose, and that is exactly why these are not suitable for anything security-related: anybody
 * with the seed can produce the same sequence. They are for test data, sample records and fixtures, and the note
 * says so rather than leaving somebody to find out.
 */
export function generateIdentifiers(count: number, options: { seed?: number; length?: number; prefix?: string } = {}): Generated<string> | GeneratorError {
  if (!Number.isInteger(count) || count < 0) return fail('invalid-argument', 'The count has to be a whole number that is not negative.')
  if (count > GENERATOR_LIMITS.items) return fail('too-many', `At most ${GENERATOR_LIMITS.items.toLocaleString('en')} identifiers at once.`)

  const length = Math.max(4, Math.min(64, Math.round(options.length ?? 12)))
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
  // The number of distinct identifiers of this length, against how many are wanted: collisions become likely long
  // before the space is full, so the check is generous.
  const space = alphabet.length ** length
  if (count > space / 100) {
    return fail(
      'too-few-possible',
      `${count.toLocaleString('en')} identifiers of length ${length} would use more than a hundredth of the possible values, which makes repeats likely. Use a longer identifier.`
    )
  }

  const seed = Math.round(options.seed ?? 1)
  const stream = randomStream(seed, 0)
  const prefix = options.prefix ?? ''
  const seen = new Set<string>()
  const items: string[] = []
  let rejected = 0

  while (items.length < count && rejected < count * 10 + 1000) {
    let value = ''
    for (let i = 0; i < length; i++) value += alphabet[Math.floor(stream.next() * alphabet.length)]
    const full = prefix + value
    if (seen.has(full)) {
      rejected += 1
      continue
    }
    seen.add(full)
    items.push(full)
  }

  return {
    items,
    requested: count,
    produced: items.length,
    complete: items.length === count,
    rejected,
    seed,
    notes: [
      `Seed ${seed}: the same seed gives the same identifiers.`,
      'These are deterministic, so anybody with the seed can reproduce them. They are for test data and fixtures, not for anything that has to be unguessable.',
      rejected > 0 ? `${rejected} repeats were drawn and discarded.` : 'No repeats were drawn.'
    ]
  }
}

// ---------------------------------------------------------------- revision

export interface Revision {
  /** The specification after the change. The original is never modified. */
  specification: Specification
  changed: string[]
  describe: string
}

export type Change =
  | { kind: 'quantity'; to: number }
  | { kind: 'seed'; to: number }
  | { kind: 'add-field'; field: FieldSpec }
  | { kind: 'remove-field'; name: string }
  | { kind: 'add-constraint'; constraint: Constraint }
  | { kind: 'remove-constraint'; id: string }

/**
 * A specification changed, rather than output regenerated from scratch.
 *
 * "Make them harder" is a change to the specification, and the next generation follows from the new specification.
 * Regenerating from the old one with a different prompt would produce something unrelated to what was already there.
 */
export function revise(spec: Specification, changes: readonly Change[]): Revision | GeneratorError {
  let next: Specification = { ...spec, fields: [...spec.fields], constraints: [...spec.constraints] }
  const changed: string[] = []

  for (const change of changes) {
    switch (change.kind) {
      case 'quantity':
        if (!Number.isInteger(change.to) || change.to < 0) return fail('invalid-argument', 'A quantity has to be a whole number that is not negative.')
        changed.push(`quantity ${next.quantity} to ${change.to}`)
        next = { ...next, quantity: change.to }
        break
      case 'seed':
        changed.push(`seed ${next.seed} to ${change.to}`)
        next = { ...next, seed: change.to }
        break
      case 'add-field':
        if (next.fields.some((one) => one.name === change.field.name)) {
          return fail('duplicate', `There is already a field called "${change.field.name}".`)
        }
        changed.push(`added the field "${change.field.name}"`)
        next = { ...next, fields: [...next.fields, change.field] }
        break
      case 'remove-field': {
        if (!next.fields.some((one) => one.name === change.name)) {
          return fail('not-found', `There is no field called "${change.name}".`)
        }
        const stillCorrelated = next.correlations.some((one) => one.a === change.name || one.b === change.name)
        if (stillCorrelated) {
          return fail('in-use', `"${change.name}" is part of a correlation. Remove the correlation first, or the specification would refer to a field that is not there.`)
        }
        changed.push(`removed the field "${change.name}"`)
        next = { ...next, fields: next.fields.filter((one) => one.name !== change.name) }
        break
      }
      case 'add-constraint':
        changed.push(`added the constraint "${change.constraint.describe}"`)
        next = { ...next, constraints: [...next.constraints, change.constraint] }
        break
      case 'remove-constraint':
        if (!next.constraints.some((one) => one.id === change.id)) return fail('not-found', `There is no constraint called "${change.id}".`)
        changed.push(`removed a constraint`)
        next = { ...next, constraints: next.constraints.filter((one) => one.id !== change.id) }
        break
    }
  }

  const check = checkSpecification(next)
  if (!check.ok) return fail('invalid-specification', `After those changes the specification cannot be satisfied: ${check.problems.join(' ')}`)

  return {
    specification: next,
    changed,
    describe:
      changed.length === 0
        ? 'Nothing changed.'
        : `${changed.join(', ')}. The next generation follows from the changed specification; the original is unchanged.`
  }
}

/** The assumptions the Page rests on, for a screen that wants to show them rather than have them inferred. */
export const GENERATOR_ASSUMPTIONS: readonly string[] = Object.freeze([
  'The quantity asked for is part of the request. Producing fewer is a partial result and says so.',
  'Output is validated against the specification -- count, uniqueness, bounds, categories, constraints -- before it is reported.',
  'Generation is seeded, so the same specification and seed give the same result.',
  'A correlation is applied through a joint normal, and is refused for a distribution it does not describe.',
  'Correlations that contradict each other are refused rather than approximated.',
  'An item that cannot be placed in a schedule is left unplaced, because a hole is more useful than a conflict.',
  'Generated identifiers are deterministic and are not suitable for anything that has to be unguessable.',
  'A revision changes the specification. The original is never modified, and regeneration follows the new one.'
])
