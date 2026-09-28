import type { RuleOperator } from './rules.ts'

/**
 * What there is to watch.
 *
 * `rules.ts` can compare any reading against anything. This says which readings actually exist -- and it exists
 * because those are not the same question. A rule watching a reading nobody produces is a rule that will never fire,
 * and offering one in an interface is offering something that looks like it works.
 *
 * So this list is the contract between the two halves. The watcher in the main process fills exactly these readings,
 * and the interface offers exactly these choices. Adding a source means adding it in both places; nothing can appear
 * in a menu before something is reporting it.
 */

/** What kind of thing a reading is, which decides how it may be compared. */
export type ReadingKind = 'number' | 'text' | 'state'

export interface WatchableField {
  /** The field name, as the watcher reports it. */
  name: string
  /** What to call it. */
  label: string
  kind: ReadingKind
  /** For a state, the values it can actually take -- so the interface offers those, not a free-text box. */
  states?: string[]
  /** What the number means, shown beside the box. */
  unit?: string
}

export interface WatchableSource {
  /** The source name, as the watcher reports it. */
  name: string
  label: string
  /** One line about where the readings come from. */
  from: string
  fields: WatchableField[]
}

/** Which comparisons make sense for a kind of reading. Offering the rest would be offering comparisons that never hold. */
export const OPERATORS_FOR: Record<ReadingKind, RuleOperator[]> = {
  number: [
    'equals',
    'notEquals',
    'greaterThan',
    'greaterThanOrEqual',
    'lessThan',
    'lessThanOrEqual',
    'changes',
    'increases',
    'decreases'
  ],
  text: ['equals', 'notEquals', 'contains', 'changes'],
  state: ['equals', 'notEquals', 'changes']
}

/** How a comparison reads in a sentence, so a rule can be shown as one. */
export const OPERATOR_LABELS: Record<RuleOperator, string> = {
  equals: 'is',
  notEquals: 'is not',
  greaterThan: 'is more than',
  greaterThanOrEqual: 'is at least',
  lessThan: 'is under',
  lessThanOrEqual: 'is at most',
  contains: 'contains',
  changes: 'changes',
  increases: 'goes up',
  decreases: 'goes down'
}

/** The comparisons that need no value, because they compare against the reading before. */
export const NEEDS_NO_VALUE: RuleOperator[] = ['changes', 'increases', 'decreases']

/**
 * The sources Orbis really reports.
 *
 * Workflows are here because the Workflow Engine already publishes the state of every run it is doing, which is a real
 * reading of a real thing. Nothing else is here yet -- not downloads, not prices, not pages -- because nothing else is
 * being reported, and a menu entry is a promise.
 */
export const WATCHABLE: WatchableSource[] = [
  {
    name: 'workflow',
    label: 'Workflows',
    from: 'The Workflow Engine, as it runs',
    fields: [
      {
        name: 'status',
        label: 'Status',
        kind: 'state',
        states: ['running', 'paused', 'waiting', 'succeeded', 'failed', 'stopped']
      },
      { name: 'name', label: 'Name', kind: 'text' },
      { name: 'progress', label: 'Progress', kind: 'number', unit: '%' },
      { name: 'step', label: 'Step reached', kind: 'number' },
      { name: 'steps', label: 'Steps in total', kind: 'number' },
      { name: 'running', label: 'How many are running', kind: 'number' },
      { name: 'waitingFor', label: 'Waiting for', kind: 'state', states: ['', 'user', 'confirmation', 'debugger'] }
    ]
  }
]

export const watchableSource = (name: string): WatchableSource | null =>
  WATCHABLE.find((s) => s.name === name) ?? null

export const watchableField = (source: string, field: string): WatchableField | null =>
  watchableSource(source)?.fields.find((f) => f.name === field) ?? null

/**
 * Whether a condition watches something that exists.
 *
 * Used when a rule is being made and when one is read back in, so a rule that survived a change in what Orbis reports
 * can be shown as no longer watching anything rather than silently never firing again.
 */
export function isWatchable(source: string, field: string, operator: RuleOperator): boolean {
  const known = watchableField(source, field)
  return known !== null && OPERATORS_FOR[known.kind].includes(operator)
}

/** A condition as a sentence, for showing a rule without showing its shape. */
export function describeCondition(
  source: string,
  field: string,
  operator: RuleOperator,
  value?: string | number
): string {
  const where = watchableSource(source)?.label ?? source
  const what = watchableField(source, field)?.label ?? field
  const how = OPERATOR_LABELS[operator] ?? operator
  if (NEEDS_NO_VALUE.includes(operator)) return `${where}: ${what} ${how}`
  const unit = watchableField(source, field)?.unit ?? ''
  return `${where}: ${what} ${how} ${value ?? ''}${unit}`.trimEnd()
}
