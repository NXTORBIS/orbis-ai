import type { NotificationsConfig } from './experience.ts'

/**
 * "Tell me when..."
 *
 * A rule watches something Orbis already knows -- a download's progress, a workflow's status, how many tasks are
 * left -- and says something once, when it becomes true. The configuration reserved a `rules` field for this and
 * left it empty; this is that field.
 *
 * Two things make the difference between a useful rule and a nuisance, and both are here rather than left to each
 * caller:
 *
 *  - It fires on the *change*, not on the state. A download that is finished stays finished; being told once is
 *    being told, and being told every second is being shouted at.
 *  - It reads values that something else produced. A rule cannot invent a reading, so a rule can never announce
 *    something that did not happen.
 */

export const RULES_SCHEMA_VERSION = 1

/** Enough to watch everything worth watching, few enough that the list stays readable. */
export const MAX_RULES = 50

export type RuleOperator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'contains'
  | 'changes'
  | 'increases'
  | 'decreases'

const OPERATORS: RuleOperator[] = [
  'equals',
  'notEquals',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'contains',
  'changes',
  'increases',
  'decreases'
]

/** One thing being watched: which reading, and what about it. */
export interface RuleCondition {
  /** Where the reading comes from, e.g. 'download' or 'workflow'. */
  source: string
  /** Which reading, e.g. 'progress' or 'status'. */
  field: string
  operator: RuleOperator
  /** Not needed by `changes`, `increases` or `decreases`, which compare against the reading before. */
  value?: string | number
}

/** Conditions, and the ways of combining them. */
export type RuleTest = RuleCondition | { all: RuleTest[] } | { any: RuleTest[] } | { not: RuleTest }

/** How often a rule is allowed to speak. */
export type RuleRepeat = 'once' | 'always'

export interface StoredRule {
  id: string
  name: string
  schemaVersion: number
  enabled: boolean
  test: RuleTest
  notify: { title: string; body: string }
  /** How long after speaking it must stay quiet, however often it becomes true again. */
  cooldownMs: number
  repeat: RuleRepeat
  createdAt: number
  updatedAt: number
  /** When it last spoke, so a cooldown means something across restarts. */
  lastFiredAt?: number
  /** What it said last time it was asked, so it can tell a change from a state. */
  lastResult?: boolean
}

/** Everything the rules can see right now: readings, by source and then by field. */
export type Readings = Record<string, Record<string, unknown>>

const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const asText = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value)

const isCondition = (test: RuleTest): test is RuleCondition =>
  typeof (test as RuleCondition).source === 'string'

/**
 * Whether one condition holds.
 *
 * A reading that is missing is not a reading of zero, and not a reading of false: it is nothing to compare, so the
 * condition simply does not hold. That is what stops a rule announcing that a download finished because the download
 * does not exist.
 */
function conditionHolds(condition: RuleCondition, now: Readings, before: Readings): boolean {
  const current = now[condition.source]?.[condition.field]
  if (current === undefined) return false

  switch (condition.operator) {
    case 'equals':
      return asText(current) === asText(condition.value)
    case 'notEquals':
      return asText(current) !== asText(condition.value)
    case 'contains':
      return asText(current).toLowerCase().includes(asText(condition.value).toLowerCase())
    case 'greaterThan':
    case 'greaterThanOrEqual':
    case 'lessThan':
    case 'lessThanOrEqual': {
      const a = number(current)
      const b = number(condition.value)
      if (a === null || b === null) return false
      if (condition.operator === 'greaterThan') return a > b
      if (condition.operator === 'greaterThanOrEqual') return a >= b
      if (condition.operator === 'lessThan') return a < b
      return a <= b
    }
    case 'changes':
    case 'increases':
    case 'decreases': {
      const previous = before[condition.source]?.[condition.field]
      // Nothing to compare against yet. The first reading of something is not a change in it.
      if (previous === undefined) return false
      if (condition.operator === 'changes') return asText(current) !== asText(previous)
      const a = number(current)
      const b = number(previous)
      if (a === null || b === null) return false
      return condition.operator === 'increases' ? a > b : a < b
    }
    default:
      return false
  }
}

/** Whether a whole test holds, conditions and combinations alike. */
export function testHolds(test: RuleTest, now: Readings, before: Readings = {}): boolean {
  if (isCondition(test)) return conditionHolds(test, now, before)
  if ('all' in test) return test.all.length > 0 && test.all.every((t) => testHolds(t, now, before))
  if ('any' in test) return test.any.some((t) => testHolds(t, now, before))
  if ('not' in test) return !testHolds(test.not, now, before)
  return false
}

export interface RuleOutcome {
  /** Whether the rule should speak now. */
  fire: boolean
  /** The rule with what it has learned written down, to be stored. */
  rule: StoredRule
}

/**
 * What a rule should do, given what is true now.
 *
 * The whole of the "do not be a nuisance" logic lives here: a rule speaks when its answer turns from no to yes, not
 * while the answer stays yes; it stays quiet for as long as its cooldown says; and a rule set to speak once does not
 * speak again, though it keeps watching so that it still knows whether it is true.
 */
export function considerRule(rule: StoredRule, now: Readings, before: Readings = {}, at = Date.now()): RuleOutcome {
  const holds = testHolds(rule.test, now, before)
  const remembered: StoredRule = { ...rule, lastResult: holds }

  if (!rule.enabled) return { fire: false, rule: remembered }
  // Still true is not newly true. This is the difference between being told and being nagged.
  if (!holds || rule.lastResult === true) return { fire: false, rule: remembered }
  if (rule.repeat === 'once' && rule.lastFiredAt !== undefined) return { fire: false, rule: remembered }
  if (rule.lastFiredAt !== undefined && at - rule.lastFiredAt < rule.cooldownMs) {
    return { fire: false, rule: remembered }
  }

  return { fire: true, rule: { ...remembered, lastFiredAt: at, updatedAt: at } }
}

// ---------------------------------------------------------------- when Orbis may speak at all

const minutes = (clock: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * Whether the person asked not to be disturbed right now.
 *
 * Quiet hours were a setting with nothing reading it. They wrap around midnight, which is the case worth being
 * careful about: 22:00 to 07:00 is one stretch of night, not an empty range.
 */
export function inQuietHours(config: NotificationsConfig, at = Date.now()): boolean {
  const { enabled, from, to } = config.quietHours
  if (!enabled) return false
  const start = minutes(from)
  const end = minutes(to)
  if (start === null || end === null || start === end) return false
  const when = new Date(at)
  const nowMinutes = when.getHours() * 60 + when.getMinutes()
  return start < end ? nowMinutes >= start && nowMinutes < end : nowMinutes >= start || nowMinutes < end
}

/**
 * Whether a notification of this kind may be shown.
 *
 * A category the person has not decided about is allowed: Orbis does not go silent about something new simply
 * because it was not on a list written before that something existed.
 */
export function mayNotify(config: NotificationsConfig, category: string, at = Date.now()): boolean {
  if (config.categories[category] === false) return false
  return !inQuietHours(config, at)
}

// ---------------------------------------------------------------- reading rules in

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''

const MAX_DEPTH = 4

function cleanTest(raw: unknown, depth = 0): RuleTest | null {
  if (!raw || typeof raw !== 'object' || depth > MAX_DEPTH) return null
  const o = raw as Record<string, unknown>

  for (const key of ['all', 'any'] as const) {
    if (Array.isArray(o[key])) {
      const parts = (o[key] as unknown[]).slice(0, 10).map((p) => cleanTest(p, depth + 1)).filter(Boolean) as RuleTest[]
      return parts.length ? ({ [key]: parts } as RuleTest) : null
    }
  }
  if (o.not) {
    const inner = cleanTest(o.not, depth + 1)
    return inner ? { not: inner } : null
  }

  const source = text(o.source, 40)
  const field = text(o.field, 40)
  if (!source || !field || !OPERATORS.includes(o.operator as RuleOperator)) return null
  const operator = o.operator as RuleOperator
  const value =
    typeof o.value === 'number' && Number.isFinite(o.value)
      ? o.value
      : typeof o.value === 'string'
        ? o.value.slice(0, 200)
        : undefined
  return { source, field, operator, ...(value === undefined ? {} : { value }) }
}

/** The most a rule may be told to wait, so a cooldown cannot silence one for ever by accident. */
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000

export function cleanRule(raw: unknown, at = Date.now()): StoredRule | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = text(o.id, 64)
  const name = text(o.name, 80)
  const test = cleanTest(o.test)
  if (!id || !name || !test) return null

  const n = (o.notify ?? {}) as Record<string, unknown>
  const title = text(n.title, 80) || name
  const cooldown = typeof o.cooldownMs === 'number' && Number.isFinite(o.cooldownMs) ? o.cooldownMs : 0

  return {
    id,
    name,
    schemaVersion: RULES_SCHEMA_VERSION,
    enabled: o.enabled !== false,
    test,
    notify: { title, body: text(n.body, 300) },
    cooldownMs: Math.min(MAX_COOLDOWN_MS, Math.max(0, cooldown)),
    repeat: o.repeat === 'once' ? 'once' : 'always',
    createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : at,
    updatedAt: at,
    ...(typeof o.lastFiredAt === 'number' && Number.isFinite(o.lastFiredAt) ? { lastFiredAt: o.lastFiredAt } : {}),
    ...(typeof o.lastResult === 'boolean' ? { lastResult: o.lastResult } : {})
  }
}

export function cleanRules(raw: unknown, at = Date.now()): StoredRule[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: StoredRule[] = []
  for (const entry of raw) {
    const rule = cleanRule(entry, at)
    if (!rule || seen.has(rule.id)) continue
    seen.add(rule.id)
    out.push(rule)
    if (out.length >= MAX_RULES) break
  }
  return out
}
