/**
 * What-ifs, and why they are patches rather than copies.
 *
 * "What if cost mattered twice as much?" is a question about a decision, not a change to it. If it were applied as
 * a change, the person would have to remember to undo it, and the next real answer would be built on a
 * hypothetical they asked about once. So a what-if is a small set of overrides -- these weights, these figures,
 * this limit -- that the engine is handed alongside the untouched decision. Going back to the real assumptions is
 * dropping the patch; there is nothing to undo.
 *
 * That also makes two what-ifs comparable, since both are patches over the same base, and makes "compare the
 * original with the worst case" a single call rather than a history walk.
 */
import { run, weightsFor } from './engine.ts'
import type { Decision, Known, Origin, Result, Scenario } from './types.ts'

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const words = (value: unknown, most = 200): string => (typeof value === 'string' ? value.trim().slice(0, most) : '')
const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

// ---------------------------------------------------------------- what Orion is asked

export function scenarioPrompt(decision: Decision, message: string): string {
  const shares = weightsFor(decision.criteria).share
  const criteria = decision.criteria
    .map((one) => `  ${one.id} — ${one.name} (importance ${one.importance}, about ${Math.round((shares[one.id] ?? 0) * 100)}% of the weight)`)
    .join('\n')
  const alternatives = decision.alternatives
    .map((one) => {
      const figures = decision.criteria
        .map((two) => {
          const held = one.values[two.id]
          return held && held.value !== null ? `${two.id}=${held.value}` : null
        })
        .filter((two) => two !== null)
        .join(' ')
      return `  ${one.id} — ${one.name}${figures ? ' — ' + figures : ''}`
    })
    .join('\n')
  const constraints = decision.constraints.length
    ? decision.constraints.map((one) => `  ${one.id} — ${one.says} (limit ${one.limit ?? 'none'})`).join('\n')
    : '  (none)'

  return [
    'Somebody is asking a what-if about a decision. Turn it into a set of overrides. Do not change the decision;',
    'this is a hypothetical that will be run alongside it and thrown away.',
    '',
    `The question: ${decision.question}`,
    'Options:',
    alternatives,
    'Being weighed:',
    criteria,
    'Hard requirements:',
    constraints,
    '',
    `The what-if:\n"""\n${String(message).slice(0, 2000)}\n"""`,
    '',
    'Answer with JSON and nothing else:',
    '{',
    '  "name": "<four or five words naming the what-if, e.g. cost twice as important>",',
    '  "weights": { "<criterion id>": <new importance> },',
    '  "values": { "<alternative id>/<criterion id>": { "value": <number>, "origin": "assumed" } },',
    '  "limits": { "<requirement id>": <new limit> },',
    '  "without": ["<criterion id to leave out entirely>"],',
    '  "cannotDo": ""',
    '}',
    '',
    'Rules:',
    '  - **Only the ids above.** Anything else is thrown away.',
    '  - **Only what the question actually changes.** Leave the other sections out rather than restating what is',
    '    already there; everything not overridden keeps its real value.',
    '  - "Twice as important" means double that one criterion\'s importance and leave the others alone. The engine',
    '    works out what that does to the shares.',
    '  - **A figure changed in a what-if is `assumed`**, whatever it was before. It is a supposition, not a finding.',
    '  - **Set `cannotDo` to a sentence if the question cannot be expressed as overrides** -- for instance if it asks',
    '    about something that is not part of this decision at all. Then leave the other sections empty.'
  ].join('\n')
}

// ---------------------------------------------------------------- reading it back

export interface ScenarioRead {
  scenario: Scenario | null
  /** Why no scenario, when there is none. */
  cannotDo: string
}

/** JSON from Orion to a what-if, with every id checked against the decision it is about. */
export function readScenario(text: string, decision: Decision, o: { id: string; now: number }): ScenarioRead {
  const raw = String(text ?? '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return { scenario: null, cannotDo: 'That what-if could not be worked out.' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return { scenario: null, cannotDo: 'That what-if could not be worked out.' }
  }

  const top = object(parsed)
  const cannotDo = words(top.cannotDo, 300)
  if (cannotDo !== '') return { scenario: null, cannotDo }

  const criteria = new Set(decision.criteria.map((one) => one.id))
  const alternatives = new Set(decision.alternatives.map((one) => one.id))
  const constraints = new Set(decision.constraints.map((one) => one.id))

  const weights: Record<string, number> = {}
  for (const [key, value] of Object.entries(object(top.weights))) {
    const made = number(value)
    if (criteria.has(key) && made !== null && made >= 0) weights[key] = Math.min(100, made)
  }

  const values: Record<string, Known> = {}
  for (const [key, held] of Object.entries(object(top.values))) {
    const [alternativeId, criterionId] = key.split('/')
    if (!alternatives.has(alternativeId ?? '') || !criteria.has(criterionId ?? '')) continue
    const cell = object(held)
    const made = number(cell.value)
    if (made === null) continue
    /*
     * Always `assumed`, whatever the model said. A figure invented to answer "what if it were cheaper" is a
     * supposition, and letting it carry the origin it had in the real decision would make the what-if's table look
     * as well-founded as the real one.
     */
    const origin: Origin = 'assumed'
    values[key] = { value: made, origin }
  }

  const limits: Record<string, number> = {}
  for (const [key, value] of Object.entries(object(top.limits))) {
    const made = number(value)
    if (constraints.has(key) && made !== null) limits[key] = made
  }

  const without = list(top.without)
    .map((one) => words(one, 40))
    .filter((one) => criteria.has(one))
    .slice(0, 6)

  const nothing =
    Object.keys(weights).length === 0 && Object.keys(values).length === 0 && Object.keys(limits).length === 0 && without.length === 0
  if (nothing) {
    return { scenario: null, cannotDo: 'That what-if does not change anything about this comparison, so the answer is the same.' }
  }

  // Everything left out would also leave every criterion out, which is not a comparison.
  if (without.length >= decision.criteria.length) {
    return { scenario: null, cannotDo: 'That would leave nothing to compare the options on.' }
  }

  return {
    scenario: {
      id: o.id,
      name: words(top.name, 80) || 'a what-if',
      ...(Object.keys(weights).length ? { weights } : {}),
      ...(Object.keys(values).length ? { values } : {}),
      ...(Object.keys(limits).length ? { limits } : {}),
      ...(without.length ? { without } : {}),
      madeAt: o.now
    },
    cannotDo: ''
  }
}

// ---------------------------------------------------------------- running and comparing

/** A what-if, run. The decision itself is never touched. */
export function runScenario(decision: Decision, scenario: Scenario, o: { run: number; now: number }): Result {
  return run(decision, {
    ...(scenario.weights ? { weights: scenario.weights } : {}),
    ...(scenario.values ? { values: scenario.values } : {}),
    ...(scenario.limits ? { limits: scenario.limits } : {}),
    ...(scenario.without ? { without: scenario.without } : {}),
    run: o.run,
    now: o.now
  })
}

export interface Difference {
  /** True when the recommendation is not the same. */
  leaderChanged: boolean
  wasLeading: string | null
  nowLeading: string | null
  /** Options whose place moved, with where they were and where they are. */
  moved: readonly { alternativeId: string; was: number; now: number }[]
  /** Options whose standing against the hard requirements changed. */
  feasibilityChanged: readonly { alternativeId: string; was: string; now: string }[]
  /** How much each option's score moved. Only the ones that moved by more than a hundredth. */
  scoreMoved: readonly { alternativeId: string; by: number }[]
  /** True when nothing worth reporting changed. */
  sameAnswer: boolean
}

/** What a what-if actually changed, worked out from the two runs rather than described. */
export function difference(before: Result, after: Result): Difference {
  const was = new Map(before.scored.map((one) => [one.alternativeId, one]))
  const moved: Difference['moved'] = after.scored
    .map((one) => ({ alternativeId: one.alternativeId, was: was.get(one.alternativeId)?.place ?? one.place, now: one.place }))
    .filter((one) => one.was !== one.now)

  const feasibilityChanged: Difference['feasibilityChanged'] = after.scored
    .map((one) => ({ alternativeId: one.alternativeId, was: was.get(one.alternativeId)?.feasible ?? one.feasible, now: one.feasible }))
    .filter((one) => one.was !== one.now)

  const scoreMoved: Difference['scoreMoved'] = after.scored
    .map((one) => ({ alternativeId: one.alternativeId, by: one.score - (was.get(one.alternativeId)?.score ?? one.score) }))
    .filter((one) => Math.abs(one.by) > 0.01)
    .sort((a, b) => Math.abs(b.by) - Math.abs(a.by))

  const leaderChanged = before.leaderId !== after.leaderId
  return {
    leaderChanged,
    wasLeading: before.leaderId,
    nowLeading: after.leaderId,
    moved,
    feasibilityChanged,
    scoreMoved,
    sameAnswer: !leaderChanged && moved.length === 0 && feasibilityChanged.length === 0 && scoreMoved.length === 0
  }
}
