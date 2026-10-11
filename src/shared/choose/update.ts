/**
 * Changing a decision that is already on the table.
 *
 * "Cost matters more." "Add a third option." "I have five days, not two weeks." "Ignore how it looks." Each of
 * those changes one part of a decision and must leave the rest exactly as it was -- which is the whole reason this
 * file exists rather than the decision being worked out again from the conversation on every message. Worked out
 * again, "cost matters more" would re-derive the options, the criteria and the figures from scratch, and come back
 * with a slightly different decision each time; the person would see numbers drifting for no reason they said.
 *
 * ## Changes are named, validated, then applied
 *
 * Orion turns the message into a list of named changes. Every one of them is checked against the decision that
 * actually exists -- an id that is not there is refused, not invented -- and only then applied. A change that
 * cannot be made is reported as refused and the decision is left alone, because half-applying a list of changes is
 * the one outcome worse than applying none of them.
 *
 * ## Why ids and not names
 *
 * The person says "cost"; the change carries `cost`, the id. Names can be edited, two criteria can be renamed into
 * each other, and matching on the name after a rename silently changes the wrong one. The prompt is given the ids
 * alongside the names so the model can use them.
 *
 * ## A different decision is not a change to this one
 *
 * `startOver` exists because somebody who was choosing a laptop and now asks which language to learn has not
 * changed their mind about laptops. Treating the second as a change to the first produces a comparison of two
 * programming languages on price and screen size.
 */
import {
  type Alternative,
  type Constraint,
  type ConstraintTest,
  type Criterion,
  type Decision,
  type Direction,
  type Known,
  type Method,
  type Origin,
  type Scaling,
  type WhenMissing
} from './types.ts'
import { idFrom, MOST_ALTERNATIVES, MOST_CONSTRAINTS, MOST_CRITERIA } from './extract.ts'

export type Change =
  /** How much a criterion matters, as a multiple of what it was or as a new figure. */
  | { kind: 'importance'; criterionId: string; times?: number; to?: number; says: string }
  | { kind: 'rename-criterion'; criterionId: string; name: string }
  | { kind: 'drop-criterion'; criterionId: string }
  | { kind: 'add-criterion'; name: string; describe: string; direction: Direction; importance: number; scaling: Scaling; unit: string; target?: number }
  | { kind: 'direction'; criterionId: string; to: Direction }
  /** Turn something being weighed into a line nothing may cross. */
  | { kind: 'require'; criterionId: string; test: ConstraintTest; limit: number | null; unit: string; says: string }
  | { kind: 'set-limit'; constraintId: string; limit: number }
  | { kind: 'drop-requirement'; constraintId: string }
  | { kind: 'add-alternative'; name: string; describe: string; mentioned: boolean }
  | { kind: 'drop-alternative'; alternativeId: string }
  | { kind: 'set-value'; alternativeId: string; criterionId: string; value: number | null; origin: Origin; says?: string; low?: number; high?: number }
  | { kind: 'aim'; aim: string }
  | { kind: 'how'; method?: Method; whenMissing?: WhenMissing }

export interface Applied {
  decision: Decision
  /** What was done, in words somebody would recognise. Shown. */
  applied: readonly string[]
  /** What could not be done, and why. Shown when it matters. */
  refused: readonly string[]
}

// ---------------------------------------------------------------- what Orion is asked

/** The decision as a short list of ids and names, so a change can point at the right thing. */
export function decisionSketch(decision: Decision): string {
  const criteria = decision.criteria
    .map((one) => `  ${one.id} — ${one.name} (${one.direction}, importance ${one.importance}${one.unit ? ', in ' + one.unit : ''})`)
    .join('\n')
  const alternatives = decision.alternatives.map((one) => `  ${one.id} — ${one.name}`).join('\n')
  const constraints = decision.constraints.length
    ? decision.constraints.map((one) => `  ${one.id} — ${one.says} (${one.test} ${one.limit ?? ''})`).join('\n')
    : '  (none)'
  return [
    `The question: ${decision.question}`,
    decision.aim ? `What they want: ${decision.aim}` : '',
    'Options:',
    alternatives,
    'Being weighed:',
    criteria,
    'Hard requirements:',
    constraints
  ]
    .filter((one) => one !== '')
    .join('\n')
}

export function changePrompt(decision: Decision, message: string): string {
  return [
    'A decision is already laid out. Turn the new message into a list of changes to it. Change only what the',
    'message actually says to change.',
    '',
    decisionSketch(decision),
    '',
    `The new message:\n"""\n${String(message).slice(0, 3000)}\n"""`,
    '',
    'Answer with JSON and nothing else:',
    '{',
    '  "startOver": false,',
    '  "changes": [',
    '    { "kind": "importance", "criterionId": "<id>", "times": 2, "says": "cost matters twice as much" },',
    '    { "kind": "importance", "criterionId": "<id>", "to": 9, "says": "reliability is now the most important" },',
    '    { "kind": "rename-criterion", "criterionId": "<id>", "name": "<new name>" },',
    '    { "kind": "drop-criterion", "criterionId": "<id>" },',
    '    { "kind": "add-criterion", "name": "<...>", "describe": "<...>", "direction": "more-is-better|less-is-better|closest-to-target", "importance": 5, "scaling": "min-max|against-target|bands|yes-no|own-scale", "unit": "<...>", "target": <number> },',
    '    { "kind": "direction", "criterionId": "<id>", "to": "less-is-better" },',
    '    { "kind": "require", "criterionId": "<id>", "test": "at-most|at-least|must-equal|must-be-true|must-be-false", "limit": <number>, "unit": "<...>", "says": "<in their words>" },',
    '    { "kind": "set-limit", "constraintId": "<id>", "limit": <number> },',
    '    { "kind": "drop-requirement", "constraintId": "<id>" },',
    '    { "kind": "add-alternative", "name": "<...>", "describe": "<...>", "mentioned": true },',
    '    { "kind": "drop-alternative", "alternativeId": "<id>" },',
    '    { "kind": "set-value", "alternativeId": "<id>", "criterionId": "<id>", "value": <number or null>, "origin": "user-said|measured|from-source|derived|estimated|assumed|unknown", "says": "<where it came from>" },',
    '    { "kind": "aim", "aim": "<...>" }',
    '  ],',
    '  "says": "<one sentence saying what you changed, in plain words>"',
    '}',
    '',
    'Rules:',
    '  - **Use the ids above.** A change pointing at an id that is not listed is thrown away.',
    '  - **Set `startOver` to true only if this is a different decision**, not a change to this one. Then leave',
    '    `changes` empty.',
    '  - **An empty `changes` list is a fine answer** when the message changes nothing about the decision.',
    '  - "Cost matters more" is `times`, around 1.5 to 2. "Cost is the most important thing" is `to`, above every',
    '    other importance. Do not use both on one criterion.',
    '  - **A deadline or a budget that has changed is `set-limit`**, not a new requirement, when a requirement for it',
    '    already exists.',
    '  - **A value nobody knows is `null`.** Never zero, and never a guess written as a fact.',
    '  - **"Ignore X" is `drop-criterion`**, not an importance of nothing: a criterion left in at zero still shows',
    '    in the table as something that was weighed.'
  ].join('\n')
}

// ---------------------------------------------------------------- reading the changes back

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const words = (value: unknown, most = 200): string => (typeof value === 'string' ? value.trim().slice(0, most) : '')
const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

const DIRECTIONS: readonly Direction[] = ['more-is-better', 'less-is-better', 'closest-to-target']
const SCALINGS: readonly Scaling[] = ['min-max', 'against-target', 'bands', 'yes-no', 'own-scale']
const TESTS: readonly ConstraintTest[] = ['at-most', 'at-least', 'must-equal', 'must-be-true', 'must-be-false']
const ORIGINS: readonly Origin[] = ['measured', 'user-said', 'from-source', 'derived', 'estimated', 'assumed', 'unknown']
const METHODS: readonly Method[] = ['weighted-sum', 'in-order-of-importance', 'rule-out', 'nothing-beats-it', 'closest-to-what-you-asked', 'expected-value']
const MISSING: readonly WhenMissing[] = ['share-out-the-rest', 'drop-the-criterion', 'say-it-is-not-known']

export interface ChangesRead {
  startOver: boolean
  changes: readonly Change[]
  says: string
}

/**
 * One change, coerced from whatever arrived.
 *
 * Shared between Orion's answer and the controls on the card, deliberately: a slider and a sentence have to be held
 * to the same checks, because a control that can write a value no sentence could is a second way into the decision
 * with its own rules.
 *
 * Returns null for anything this file does not recognise. Nothing is guessed at.
 */
export function cleanChange(raw: unknown): Change | null {
  const changes: Change[] = []
  {
    const one = object(raw)
    const kind = words(one.kind, 30)

    if (kind === 'importance') {
      const criterionId = words(one.criterionId, 40)
      const times = number(one.times)
      const to = number(one.to)
      if (criterionId === '' || (times === null && to === null)) return null
      changes.push({
        kind: 'importance',
        criterionId,
        ...(times !== null ? { times: Math.min(20, Math.max(0, times)) } : {}),
        ...(to !== null ? { to: Math.min(100, Math.max(0, to)) } : {}),
        says: words(one.says, 160)
      })
    } else if (kind === 'rename-criterion') {
      const criterionId = words(one.criterionId, 40)
      const name = words(one.name, 60)
      if (criterionId && name) changes.push({ kind, criterionId, name })
    } else if (kind === 'drop-criterion') {
      const criterionId = words(one.criterionId, 40)
      if (criterionId) changes.push({ kind, criterionId })
    } else if (kind === 'add-criterion') {
      const name = words(one.name, 60)
      if (!name) return null
      const target = number(one.target)
      changes.push({
        kind,
        name,
        describe: words(one.describe, 240),
        direction: oneOf(one.direction, DIRECTIONS, 'more-is-better'),
        importance: Math.min(100, Math.max(0, number(one.importance) ?? 5)),
        scaling: oneOf(one.scaling, SCALINGS, 'min-max'),
        unit: words(one.unit, 24),
        ...(target !== null ? { target } : {})
      })
    } else if (kind === 'direction') {
      const criterionId = words(one.criterionId, 40)
      if (criterionId) changes.push({ kind, criterionId, to: oneOf(one.to, DIRECTIONS, 'more-is-better') })
    } else if (kind === 'require') {
      const criterionId = words(one.criterionId, 40)
      const test = oneOf(one.test, TESTS, 'at-most')
      const limit = number(one.limit)
      if (!criterionId) return null
      if (test !== 'must-be-true' && test !== 'must-be-false' && limit === null) return null
      changes.push({ kind, criterionId, test, limit: test === 'must-be-true' || test === 'must-be-false' ? null : limit, unit: words(one.unit, 24), says: words(one.says, 200) })
    } else if (kind === 'set-limit') {
      const constraintId = words(one.constraintId, 40)
      const limit = number(one.limit)
      if (constraintId && limit !== null) changes.push({ kind, constraintId, limit })
    } else if (kind === 'drop-requirement') {
      const constraintId = words(one.constraintId, 40)
      if (constraintId) changes.push({ kind, constraintId })
    } else if (kind === 'add-alternative') {
      const name = words(one.name, 80)
      if (name) changes.push({ kind, name, describe: words(one.describe, 300), mentioned: one.mentioned !== false })
    } else if (kind === 'drop-alternative') {
      const alternativeId = words(one.alternativeId, 40)
      if (alternativeId) changes.push({ kind, alternativeId })
    } else if (kind === 'set-value') {
      const alternativeId = words(one.alternativeId, 40)
      const criterionId = words(one.criterionId, 40)
      if (!alternativeId || !criterionId) return null
      const value = number(one.value)
      const low = number(one.low)
      const high = number(one.high)
      const says = words(one.says, 160)
      let origin = oneOf(one.origin, ORIGINS, 'estimated')
      // The same rule as on the way in: a measurement has to say where it was measured.
      if ((origin === 'measured' || origin === 'from-source') && says === '') origin = 'estimated'
      changes.push({
        kind,
        alternativeId,
        criterionId,
        value,
        origin: value === null ? 'unknown' : origin,
        ...(says ? { says } : {}),
        ...(low !== null && value !== null && low <= value ? { low } : {}),
        ...(high !== null && value !== null && high >= value ? { high } : {})
      })
    } else if (kind === 'aim') {
      const aim = words(one.aim, 300)
      if (aim) changes.push({ kind, aim })
    } else if (kind === 'how') {
      const method = typeof one.method === 'string' ? oneOf(one.method, METHODS, 'weighted-sum') : undefined
      const whenMissing = typeof one.whenMissing === 'string' ? oneOf(one.whenMissing, MISSING, 'share-out-the-rest') : undefined
      if (method || whenMissing) changes.push({ kind, ...(method ? { method } : {}), ...(whenMissing ? { whenMissing } : {}) })
    }
  }

  return changes[0] ?? null
}

/** JSON from Orion to a list of changes. Anything that is not a change this file knows is dropped. */
export function readChanges(text: string): ChangesRead {
  const raw = String(text ?? '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return { startOver: false, changes: [], says: '' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return { startOver: false, changes: [], says: '' }
  }

  const top = object(parsed)
  if (top.startOver === true) return { startOver: true, changes: [], says: words(top.says, 300) }

  const changes = list(top.changes)
    .slice(0, 24)
    .map((one) => cleanChange(one))
    .filter((one): one is Change => one !== null)

  return { startOver: false, changes, says: words(top.says, 300) }
}

// ---------------------------------------------------------------- applying them

/**
 * Applies the changes that can be applied, and says what could not be.
 *
 * Nothing is applied in place: each change produces a new decision, so a change that turns out to be impossible
 * leaves the original untouched rather than half-edited.
 */
export function applyChanges(decision: Decision, changes: readonly Change[], o: { now: number; from: string }): Applied {
  let next = decision
  const applied: string[] = []
  const refused: string[] = []

  const criterion = (id: string): Criterion | undefined => next.criteria.find((one) => one.id === id)
  const alternative = (id: string): Alternative | undefined => next.alternatives.find((one) => one.id === id)
  const constraint = (id: string): Constraint | undefined => next.constraints.find((one) => one.id === id)

  for (const change of changes) {
    switch (change.kind) {
      case 'importance': {
        const was = criterion(change.criterionId)
        if (!was) {
          refused.push(`There is nothing called "${change.criterionId}" being weighed.`)
          break
        }
        /*
         * "The most important thing" is not a number anybody said. It is read as a tenth above whatever is
         * currently highest, which is what makes it the most important without turning everything else into noise:
         * a hundred would make every other criterion effectively nothing.
         */
        const highest = Math.max(...next.criteria.map((one) => one.importance), 0)
        const to =
          change.to !== undefined
            ? change.to >= highest
              ? Math.max(change.to, highest * 1.1 || 1)
              : change.to
            : Math.max(0, was.importance * (change.times ?? 1))
        next = { ...next, criteria: next.criteria.map((one) => (one.id === was.id ? { ...one, importance: to } : one)) }
        applied.push(
          change.times !== undefined && change.times > 1
            ? `${was.name} now matters ${change.times === 2 ? 'twice' : `${round(change.times)} times`} as much.`
            : change.times !== undefined && change.times < 1
              ? `${was.name} now matters less.`
              : `${was.name} is now the most important thing.`
        )
        break
      }

      case 'rename-criterion': {
        const was = criterion(change.criterionId)
        if (!was) {
          refused.push(`There is nothing called "${change.criterionId}" being weighed.`)
          break
        }
        if (next.criteria.some((one) => one.id !== was.id && one.name.toLowerCase() === change.name.toLowerCase())) {
          refused.push(`There is already something called "${change.name}".`)
          break
        }
        next = { ...next, criteria: next.criteria.map((one) => (one.id === was.id ? { ...one, name: change.name } : one)) }
        applied.push(`"${was.name}" is now called "${change.name}".`)
        break
      }

      case 'drop-criterion': {
        const was = criterion(change.criterionId)
        if (!was) {
          refused.push(`There is nothing called "${change.criterionId}" being weighed.`)
          break
        }
        if (next.criteria.length <= 1) {
          refused.push(`"${was.name}" is the only thing left to compare on, so it cannot come out.`)
          break
        }
        /*
         * A requirement about a criterion that is gone can never be checked, so it goes too. Leaving it would put
         * every option at "cannot tell" against a line nothing is measured on any more, which blocks every
         * recommendation for a reason nobody could find.
         */
        const orphaned = next.constraints.filter((one) => one.criterionId === was.id)
        next = {
          ...next,
          criteria: next.criteria.filter((one) => one.id !== was.id),
          constraints: next.constraints.filter((one) => one.criterionId !== was.id),
          alternatives: next.alternatives.map((one) => {
            const values = { ...one.values }
            delete values[was.id]
            return { ...one, values }
          })
        }
        applied.push(`${was.name} is no longer part of the comparison.`)
        for (const one of orphaned) applied.push(`"${one.says}" went with it, since there is nothing left to check it against.`)
        break
      }

      case 'add-criterion': {
        if (next.criteria.length >= MOST_CRITERIA) {
          refused.push(`There are already ${MOST_CRITERIA} things being weighed, which is as many as is useful.`)
          break
        }
        if (next.criteria.some((one) => one.name.toLowerCase() === change.name.toLowerCase())) {
          refused.push(`"${change.name}" is already being weighed.`)
          break
        }
        const taken = new Set(next.criteria.map((one) => one.id))
        const made: Criterion = {
          id: idFrom(change.name, taken, 'criterion'),
          name: change.name,
          describe: change.describe,
          direction: change.direction,
          importance: change.importance,
          scaling: change.scaling === 'against-target' && change.target === undefined ? 'min-max' : change.scaling,
          unit: change.unit,
          ...(change.target !== undefined ? { target: change.target } : {}),
          origin: 'user-said'
        }
        next = { ...next, criteria: [...next.criteria, made] }
        applied.push(`${change.name} is now part of the comparison. Nothing is known about it for any option yet.`)
        break
      }

      case 'direction': {
        const was = criterion(change.criterionId)
        if (!was) {
          refused.push(`There is nothing called "${change.criterionId}" being weighed.`)
          break
        }
        next = { ...next, criteria: next.criteria.map((one) => (one.id === was.id ? { ...one, direction: change.to } : one)) }
        applied.push(
          change.to === 'less-is-better'
            ? `Less ${was.name} now counts as better.`
            : change.to === 'more-is-better'
              ? `More ${was.name} now counts as better.`
              : `${was.name} is now judged on how close it gets to the target.`
        )
        break
      }

      case 'require': {
        const was = criterion(change.criterionId)
        if (!was) {
          refused.push(`There is nothing called "${change.criterionId}" to make a requirement of.`)
          break
        }
        if (next.constraints.length >= MOST_CONSTRAINTS) {
          refused.push('There are already as many hard requirements as can be checked usefully.')
          break
        }
        const taken = new Set(next.constraints.map((one) => one.id))
        const says = change.says || `${was.name} ${change.test} ${change.limit ?? ''}`.trim()
        next = {
          ...next,
          constraints: [
            ...next.constraints,
            { id: idFrom(says, taken, 'must'), says, criterionId: was.id, test: change.test, limit: change.limit, unit: change.unit || was.unit, origin: 'user-said' }
          ]
        }
        applied.push(`"${says}" is now a hard requirement: an option that breaks it is out, however good it is elsewhere.`)
        break
      }

      case 'set-limit': {
        const was = constraint(change.constraintId)
        if (!was) {
          refused.push('That requirement is not one of the ones here.')
          break
        }
        next = { ...next, constraints: next.constraints.map((one) => (one.id === was.id ? { ...one, limit: change.limit } : one)) }
        applied.push(`"${was.says}" is now ${change.limit}${was.unit ? ' ' + was.unit : ''}.`)
        break
      }

      case 'drop-requirement': {
        const was = constraint(change.constraintId)
        if (!was) {
          refused.push('That requirement is not one of the ones here.')
          break
        }
        next = { ...next, constraints: next.constraints.filter((one) => one.id !== was.id) }
        applied.push(`"${was.says}" is no longer a hard requirement.`)
        break
      }

      case 'add-alternative': {
        if (next.alternatives.length >= MOST_ALTERNATIVES) {
          refused.push(`There are already ${MOST_ALTERNATIVES} options, which is as many as can be compared usefully.`)
          break
        }
        if (next.alternatives.some((one) => one.name.toLowerCase() === change.name.toLowerCase())) {
          refused.push(`"${change.name}" is already one of the options.`)
          break
        }
        const taken = new Set(next.alternatives.map((one) => one.id))
        next = {
          ...next,
          alternatives: [
            ...next.alternatives,
            {
              id: idFrom(change.name, taken, 'option'),
              name: change.name,
              describe: change.describe,
              values: {},
              upsides: [],
              downsides: [],
              origin: change.mentioned ? 'user-said' : 'estimated'
            }
          ]
        }
        /*
         * Said out loud, because a new option with no figures against it scores nothing and comes last, and that
         * looks like a verdict on it rather than what it is: a row nobody has filled in yet.
         */
        applied.push(`${change.name} is now one of the options. Nothing is known about it yet, so it is not being compared on anything until it is.`)
        break
      }

      case 'drop-alternative': {
        const was = alternative(change.alternativeId)
        if (!was) {
          refused.push('That option is not one of the ones here.')
          break
        }
        if (next.alternatives.length <= 1) {
          refused.push(`"${was.name}" is the only option left, so it cannot come out.`)
          break
        }
        next = { ...next, alternatives: next.alternatives.filter((one) => one.id !== was.id) }
        applied.push(`${was.name} is out of the comparison.`)
        break
      }

      case 'set-value': {
        const who = alternative(change.alternativeId)
        const what = criterion(change.criterionId)
        if (!who || !what) {
          refused.push('That figure is about something that is not part of this comparison.')
          break
        }
        const held: Known =
          change.value === null
            ? { value: null, origin: 'unknown' }
            : {
                value: change.value,
                origin: change.origin,
                ...(change.says ? { says: change.says } : {}),
                ...(change.low !== undefined ? { low: change.low } : {}),
                ...(change.high !== undefined ? { high: change.high } : {})
              }
        next = {
          ...next,
          alternatives: next.alternatives.map((one) => (one.id === who.id ? { ...one, values: { ...one.values, [what.id]: held } } : one))
        }
        applied.push(
          change.value === null
            ? `${what.name} for ${who.name} is back to not known.`
            : `${what.name} for ${who.name} is now ${change.value}${what.unit ? ' ' + what.unit : ''}.`
        )
        break
      }

      case 'aim': {
        next = { ...next, aim: change.aim }
        applied.push('What you are after has been updated.')
        break
      }

      case 'how': {
        next = { ...next, policy: { ...next.policy, ...(change.method ? { method: change.method } : {}), ...(change.whenMissing ? { whenMissing: change.whenMissing } : {}) } }
        applied.push('How the options are compared has been changed.')
        break
      }
    }
  }

  if (applied.length === 0) return { decision, applied, refused }

  return {
    decision: {
      ...next,
      changedAt: o.now,
      history: [...next.history, { at: o.now, what: applied.join(' '), from: o.from.slice(0, 300) }].slice(-40)
    },
    applied,
    refused
  }
}

const round = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1))
