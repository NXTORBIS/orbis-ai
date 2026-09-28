/**
 * The scenario lab: one baseline, many what-ifs, and an answer to "why did that change".
 *
 * `study.ts` sweeps a parameter across a range and reports the shape of the response. This is the other half: a
 * named alternative to the present state, built by stating what is different rather than by restating everything.
 *
 * ## The baseline never moves
 *
 * A scenario is a delta against a baseline. If the baseline could be edited in place, every scenario built on it
 * would silently change meaning -- the comparison would still render, and it would be a comparison against something
 * that no longer exists. So the baseline is captured, and `applyTo` never modifies what it is given.
 *
 * ## Why did it change
 *
 * A scenario that moves three inputs and shifts the answer by 12% invites the question of which input did it. The
 * honest answer is usually "not cleanly separable", because the inputs interact. `explainChange` reports the
 * one-at-a-time contributions *and* the interaction left over, so the residual is visible rather than quietly
 * distributed across the parts.
 */

export interface ScenarioError {
  error: string
  message: string
}

export const isScenarioError = (value: unknown): value is ScenarioError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): ScenarioError => ({ error, message })

export const SCENARIO_LIMITS: Readonly<Record<'scenarios' | 'changes' | 'depth' | 'matrix' | 'queue' | 'events', number>> =
  Object.freeze({
    scenarios: 2_000,
    changes: 500,
    depth: 16,
    matrix: 10_000,
    queue: 5_000,
    events: 1_000
  })

export type Value = number | string | boolean

export interface Baseline {
  id: string
  label: string
  /** The values every scenario is a difference from. Never modified once captured. */
  values: Readonly<Record<string, Value>>
  /** When it was captured, as the caller's own stamp. This module never reads a clock. */
  capturedAt: string
}

/** Capture a baseline. The values are copied and frozen, so later edits to the source cannot reach it. */
export function captureBaseline(id: string, label: string, values: Readonly<Record<string, Value>>, capturedAt: string): Baseline {
  const copy: Record<string, Value> = Object.create(null)
  for (const key of Object.keys(values)) {
    Object.defineProperty(copy, key, { value: values[key], enumerable: true, writable: false, configurable: false })
  }
  return Object.freeze({ id, label, values: Object.freeze(copy), capturedAt })
}

// ---------------------------------------------------------------- scenarios

export interface Change {
  key: string
  /** `set` replaces, `add` and `multiply` move relative to whatever the value is at this point in the chain. */
  how: 'set' | 'add' | 'multiply'
  to: Value
  because: string
}

export interface Scenario {
  id: string
  label: string
  /** The scenario this branches from, or `null` to branch from the baseline. */
  parentId: string | null
  changes: Change[]
  describe: string
}

export interface Resolved {
  scenarioId: string
  label: string
  values: Record<string, Value>
  /** Every key that ended up different from the baseline, and by what. */
  differences: { key: string; from: Value; to: Value; by: number | null; through: string[] }[]
  /** Changes that could not be applied, kept rather than dropped. */
  refused: { change: Change; why: string }[]
  /** The chain from the baseline down to this scenario. */
  lineage: string[]
}

/**
 * Work out a scenario's values by walking the chain from the baseline down.
 *
 * `through` on each difference names every scenario in the chain that touched that key, which is what makes a deep
 * branch explicable: a value 40% off the baseline usually got there in three steps, not one.
 */
export function resolve(baseline: Baseline, scenarios: readonly Scenario[], scenarioId: string): Resolved | ScenarioError {
  const byId = new Map(scenarios.map((one) => [one.id, one]))
  const chain: Scenario[] = []
  const seen = new Set<string>()
  let cursor: string | null = scenarioId

  while (cursor !== null) {
    if (seen.has(cursor)) {
      return fail('cycle', `Scenario "${cursor}" is its own ancestor, so it has no baseline to be a difference from.`)
    }
    seen.add(cursor)
    const one = byId.get(cursor)
    if (!one) return fail('not-found', `There is no scenario "${cursor}".`)
    chain.unshift(one)
    if (chain.length > SCENARIO_LIMITS.depth) {
      return fail('too-deep', `Scenarios are nested more than ${SCENARIO_LIMITS.depth} deep, past what can be explained.`)
    }
    cursor = one.parentId
  }

  const values: Record<string, Value> = Object.create(null)
  for (const key of Object.keys(baseline.values)) {
    Object.defineProperty(values, key, { value: baseline.values[key], enumerable: true, writable: true, configurable: true })
  }

  const refused: Resolved['refused'] = []
  const touchedBy = new Map<string, string[]>()

  for (const scenario of chain) {
    if (scenario.changes.length > SCENARIO_LIMITS.changes) {
      return fail('too-many-changes', `"${scenario.label}" changes ${scenario.changes.length} values, past the ${SCENARIO_LIMITS.changes} allowed.`)
    }
    for (const change of scenario.changes) {
      const present = Object.prototype.hasOwnProperty.call(values, change.key)
      if (!present && change.how !== 'set') {
        refused.push({ change, why: `"${change.key}" is not in the baseline, so there is nothing to ${change.how === 'add' ? 'add to' : 'multiply'}.` })
        continue
      }
      const current = present ? (values[change.key] as Value) : null

      if (change.how === 'set') {
        Object.defineProperty(values, change.key, { value: change.to, enumerable: true, writable: true, configurable: true })
      } else {
        if (typeof current !== 'number' || typeof change.to !== 'number') {
          refused.push({ change, why: `"${change.key}" is ${typeof current}, and ${change.how} only applies to numbers. Use set instead.` })
          continue
        }
        const next = change.how === 'add' ? current + change.to : current * change.to
        if (!Number.isFinite(next)) {
          refused.push({ change, why: `${change.how === 'add' ? 'Adding' : 'Multiplying'} gives a value that is not finite.` })
          continue
        }
        Object.defineProperty(values, change.key, { value: next, enumerable: true, writable: true, configurable: true })
      }

      const list = touchedBy.get(change.key) ?? []
      if (!list.includes(scenario.label)) list.push(scenario.label)
      touchedBy.set(change.key, list)
    }
  }

  const differences: Resolved['differences'] = []
  for (const key of Object.keys(values)) {
    const from = Object.prototype.hasOwnProperty.call(baseline.values, key) ? (baseline.values[key] as Value) : null
    const to = values[key] as Value
    if (from === to) continue
    differences.push({
      key,
      from: from === null ? '' : from,
      to,
      by: typeof from === 'number' && typeof to === 'number' ? to - from : null,
      through: touchedBy.get(key) ?? []
    })
  }
  differences.sort((a, b) => a.key.localeCompare(b.key))

  const last = chain[chain.length - 1] as Scenario
  return { scenarioId, label: last.label, values, differences, refused, lineage: chain.map((one) => one.id) }
}

// ---------------------------------------------------------------- checking

export interface ScenarioProblem {
  kind: 'unknown-key' | 'contradiction' | 'no-changes' | 'unexplained' | 'overridden' | 'cycle'
  keys: string[]
  describe: string
  blocking: boolean
}

/**
 * Whether a scenario is coherent before anything is run.
 *
 * The one worth catching early is two changes to the same key inside one scenario: the second silently wins, and the
 * reason written against the first stays in the record looking like it applied.
 */
export function checkScenario(baseline: Baseline, scenario: Scenario): ScenarioProblem[] {
  const problems: ScenarioProblem[] = []

  if (scenario.changes.length === 0) {
    problems.push({
      kind: 'no-changes',
      keys: [],
      describe: `"${scenario.label}" changes nothing, so it is the baseline under another name.`,
      blocking: false
    })
  }

  const unknown = scenario.changes.filter((one) => !Object.prototype.hasOwnProperty.call(baseline.values, one.key)).map((one) => one.key)
  if (unknown.length > 0) {
    problems.push({
      kind: 'unknown-key',
      keys: [...new Set(unknown)],
      describe: `${[...new Set(unknown)].join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not in the baseline. Setting ${unknown.length === 1 ? 'it' : 'them'} adds ${unknown.length === 1 ? 'a value' : 'values'} nothing else uses.`,
      blocking: false
    })
  }

  const byKey = new Map<string, Change[]>()
  for (const change of scenario.changes) {
    const list = byKey.get(change.key) ?? []
    list.push(change)
    byKey.set(change.key, list)
  }
  for (const [key, changes] of byKey) {
    const setters = changes.filter((one) => one.how === 'set')
    if (setters.length > 1) {
      problems.push({
        kind: 'contradiction',
        keys: [key],
        describe: `"${key}" is set twice in "${scenario.label}", to ${setters.map((one) => String(one.to)).join(' and ')}. The last one wins and the reason given for the first stays in the record looking like it applied.`,
        blocking: true
      })
    } else if (changes.length > 1 && setters.length === 1 && changes[0]?.how !== 'set') {
      problems.push({
        kind: 'overridden',
        keys: [key],
        describe: `"${key}" is adjusted and then set outright in "${scenario.label}", so the adjustment has no effect.`,
        blocking: false
      })
    }
  }

  const unexplained = scenario.changes.filter((one) => one.because.trim() === '').map((one) => one.key)
  if (unexplained.length > 0) {
    problems.push({
      kind: 'unexplained',
      keys: [...new Set(unexplained)],
      describe: `${[...new Set(unexplained)].join(', ')} ${unexplained.length === 1 ? 'is changed' : 'are changed'} with no reason given. In three months the number will still be there and the reason will not.`,
      blocking: false
    })
  }

  return problems
}

// ---------------------------------------------------------------- matrices

export interface Axis {
  key: string
  label: string
  values: Value[]
}

export interface MatrixCell {
  id: string
  /** Which value each axis takes, by axis key. */
  at: Record<string, Value>
  scenario: Scenario
}

/**
 * Every combination of the axes, as scenarios.
 *
 * The size is checked before anything is built: three axes of ten values is a thousand runs, which is easy to ask for
 * by accident and expensive to discover halfway through.
 */
export function buildMatrix(baseline: Baseline, axes: readonly Axis[], because = 'scenario matrix'): MatrixCell[] | ScenarioError {
  if (axes.length === 0) return fail('no-axes', 'A matrix needs at least one axis.')
  for (const axis of axes) {
    if (axis.values.length === 0) return fail('empty-axis', `Axis "${axis.label}" has no values.`)
    if (!Object.prototype.hasOwnProperty.call(baseline.values, axis.key)) {
      return fail('unknown-key', `Axis "${axis.label}" varies "${axis.key}", which is not in the baseline.`)
    }
  }

  const total = axes.reduce((count, axis) => count * axis.values.length, 1)
  if (total > SCENARIO_LIMITS.matrix) {
    return fail(
      'too-large',
      `${axes.map((one) => one.values.length).join(' x ')} is ${total.toLocaleString('en')} scenarios, past the ${SCENARIO_LIMITS.matrix.toLocaleString('en')} allowed. Narrow an axis or drop one.`
    )
  }

  const cells: MatrixCell[] = []
  const counters = axes.map(() => 0)
  for (let index = 0; index < total; index += 1) {
    const at: Record<string, Value> = Object.create(null)
    const changes: Change[] = []
    for (let axisIndex = 0; axisIndex < axes.length; axisIndex += 1) {
      const axis = axes[axisIndex] as Axis
      const value = axis.values[counters[axisIndex] as number] as Value
      Object.defineProperty(at, axis.key, { value, enumerable: true, writable: false, configurable: false })
      changes.push({ key: axis.key, how: 'set', to: value, because })
    }
    const id = `cell-${String(index + 1).padStart(6, '0')}`
    const label = axes.map((axis, axisIndex) => `${axis.label} ${String(axis.values[counters[axisIndex] as number])}`).join(', ')
    cells.push({ id, at, scenario: { id, label, parentId: null, changes, describe: because } })

    // Odometer: the last axis turns fastest, so the listing reads in the order the axes were given.
    for (let axisIndex = axes.length - 1; axisIndex >= 0; axisIndex -= 1) {
      counters[axisIndex] = (counters[axisIndex] as number) + 1
      if ((counters[axisIndex] as number) < (axes[axisIndex] as Axis).values.length) break
      counters[axisIndex] = 0
    }
  }
  return cells
}

// ---------------------------------------------------------------- the queue

export type QueueState = 'waiting' | 'running' | 'done' | 'failed' | 'cancelled' | 'skipped'

export interface QueueEntry {
  scenarioId: string
  state: QueueState
  /** Set only when the entry has finished one way or another. */
  outcome: { values: Record<string, number> } | null
  failure: string | null
}

export interface QueueReport {
  entries: QueueEntry[]
  counts: Record<QueueState, number>
  /** True only when every entry reached `done`. A queue with failures is not a finished queue. */
  complete: boolean
  describe: string
}

/**
 * Run a queue of scenarios, one state per entry and no state that means "probably fine".
 *
 * `stopOnFailure` marks the rest `skipped` rather than `cancelled`: the distinction is whether a person stopped it or
 * a failure did, and a report that blurs them makes a broken run look abandoned.
 */
export async function runQueue(
  order: readonly string[],
  runOne: (scenarioId: string) => Promise<Record<string, number>>,
  options: { stopOnFailure?: boolean; cancelled?: () => boolean; onProgress?: (entry: QueueEntry) => void } = {}
): Promise<QueueReport | ScenarioError> {
  if (order.length > SCENARIO_LIMITS.queue) {
    return fail('too-large', `${order.length.toLocaleString('en')} scenarios queued, past the ${SCENARIO_LIMITS.queue.toLocaleString('en')} allowed.`)
  }

  const entries: QueueEntry[] = order.map((scenarioId) => ({ scenarioId, state: 'waiting', outcome: null, failure: null }))
  let stopped = false

  for (const entry of entries) {
    if (stopped) {
      entry.state = 'skipped'
      options.onProgress?.(entry)
      continue
    }
    if (options.cancelled?.()) {
      entry.state = 'cancelled'
      options.onProgress?.(entry)
      continue
    }

    entry.state = 'running'
    options.onProgress?.(entry)
    try {
      const values = await runOne(entry.scenarioId)
      entry.outcome = { values }
      entry.state = 'done'
    } catch (error) {
      entry.failure = error instanceof Error ? error.message : String(error)
      entry.state = 'failed'
      if (options.stopOnFailure === true) stopped = true
    }
    options.onProgress?.(entry)
  }

  const counts: Record<QueueState, number> = { waiting: 0, running: 0, done: 0, failed: 0, cancelled: 0, skipped: 0 }
  for (const entry of entries) counts[entry.state] += 1

  const complete = counts.done === entries.length
  const parts: string[] = [`${counts.done} of ${entries.length} finished`]
  if (counts.failed > 0) parts.push(`${counts.failed} failed`)
  if (counts.skipped > 0) parts.push(`${counts.skipped} never started because an earlier one failed`)
  if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`)

  return { entries, counts, complete, describe: `${parts.join(', ')}.` }
}

// ---------------------------------------------------------------- differences

export interface DifferenceMap {
  /** Outputs that moved, largest relative move first. */
  moved: { key: string; baseline: number; scenario: number; by: number; relative: number | null }[]
  unchanged: string[]
  /** Outputs present in one and not the other. */
  onlyInBaseline: string[]
  onlyInScenario: string[]
  describe: string
}

/** What actually came out different, with relative moves reported as null where the baseline is zero. */
export function differenceMap(
  baselineOutputs: Readonly<Record<string, number>>,
  scenarioOutputs: Readonly<Record<string, number>>,
  tolerance = 0
): DifferenceMap {
  const moved: DifferenceMap['moved'] = []
  const unchanged: string[] = []
  const onlyInBaseline: string[] = []
  const onlyInScenario: string[] = []

  for (const key of Object.keys(baselineOutputs)) {
    if (!Object.prototype.hasOwnProperty.call(scenarioOutputs, key)) {
      onlyInBaseline.push(key)
      continue
    }
    const from = baselineOutputs[key] as number
    const to = scenarioOutputs[key] as number
    const by = to - from
    if (Math.abs(by) <= tolerance) {
      unchanged.push(key)
      continue
    }
    moved.push({ key, baseline: from, scenario: to, by, relative: from === 0 ? null : by / Math.abs(from) })
  }
  for (const key of Object.keys(scenarioOutputs)) {
    if (!Object.prototype.hasOwnProperty.call(baselineOutputs, key)) onlyInScenario.push(key)
  }

  moved.sort((a, b) => Math.abs(b.relative ?? Infinity) - Math.abs(a.relative ?? Infinity) || a.key.localeCompare(b.key))

  const describe =
    moved.length === 0
      ? onlyInScenario.length > 0 || onlyInBaseline.length > 0
        ? 'Nothing that appears in both moved, but the two runs did not produce the same set of outputs.'
        : 'Nothing moved. Either the change does not reach these outputs, or it was not applied.'
      : `${moved.length} output${moved.length === 1 ? '' : 's'} moved; the largest is ${moved[0]?.key}${moved[0]?.relative === null ? '' : ` at ${((moved[0]?.relative as number) * 100).toFixed(1)}%`}.`

  return { moved, unchanged, onlyInBaseline, onlyInScenario, describe }
}

// ---------------------------------------------------------------- why

export interface Contribution {
  key: string
  from: Value
  to: Value
  /** What moves the output when only this input changes. */
  alone: number
  share: number | null
}

export interface Explanation {
  outputKey: string
  baseline: number
  scenario: number
  total: number
  contributions: Contribution[]
  /** What the one-at-a-time parts do not account for: the inputs interacting. */
  interaction: number
  /** True when the parts very nearly add up, which is the only case where "this input caused it" is a fair reading. */
  separable: boolean
  describe: string
}

/**
 * Why a scenario's output moved.
 *
 * Each changed input is applied to the baseline on its own and the output remeasured. The parts will generally not
 * add up to the whole, and the gap is the interaction -- reported as its own number rather than spread across the
 * contributions, because spreading it makes each part look more responsible than it is.
 */
export async function explainChange(
  baseline: Baseline,
  resolved: Resolved,
  outputKey: string,
  evaluate: (values: Readonly<Record<string, Value>>) => Promise<Record<string, number>>
): Promise<Explanation | ScenarioError> {
  if (resolved.differences.length === 0) {
    return fail('no-changes', 'This scenario changes nothing against the baseline, so there is nothing to explain.')
  }
  if (resolved.differences.length > 64) {
    return fail('too-many-changes', `Explaining ${resolved.differences.length} changes one at a time would take ${resolved.differences.length + 2} runs. Narrow it to the inputs in question.`)
  }

  const atBaseline = await evaluate(baseline.values)
  const atScenario = await evaluate(resolved.values)
  if (!Object.prototype.hasOwnProperty.call(atBaseline, outputKey) || !Object.prototype.hasOwnProperty.call(atScenario, outputKey)) {
    return fail('no-such-output', `"${outputKey}" is not among the outputs.`)
  }

  const from = atBaseline[outputKey] as number
  const to = atScenario[outputKey] as number
  const total = to - from

  const contributions: Contribution[] = []
  for (const difference of resolved.differences) {
    const one: Record<string, Value> = { ...baseline.values }
    Object.defineProperty(one, difference.key, { value: difference.to, enumerable: true, writable: true, configurable: true })
    const at = await evaluate(one)
    const alone = (at[outputKey] ?? NaN) - from
    contributions.push({
      key: difference.key,
      from: difference.from,
      to: difference.to,
      alone,
      share: total === 0 ? null : alone / total
    })
  }
  contributions.sort((a, b) => Math.abs(b.alone) - Math.abs(a.alone) || a.key.localeCompare(b.key))

  const sum = contributions.reduce((running, one) => running + one.alone, 0)
  const interaction = total - sum
  const scale = Math.max(Math.abs(total), ...contributions.map((one) => Math.abs(one.alone)))
  const separable = scale === 0 ? true : Math.abs(interaction) <= 0.01 * scale

  const largest = contributions[0]
  const describe =
    total === 0
      ? `"${outputKey}" did not move, although ${resolved.differences.length} input${resolved.differences.length === 1 ? '' : 's'} changed. The changes may be cancelling each other out rather than having no effect.`
      : separable
        ? `"${outputKey}" moved by ${Number(total.toPrecision(4))}, and the inputs account for it almost exactly. ${largest?.key} alone accounts for ${Number(((largest?.alone ?? 0) / total * 100).toFixed(1))}%.`
        : `"${outputKey}" moved by ${Number(total.toPrecision(4))}. Changing each input on its own accounts for ${Number(sum.toPrecision(4))}, leaving ${Number(interaction.toPrecision(4))} that only appears when they change together. No single input caused this move, and saying one did would be wrong.`

  return { outputKey, baseline: from, scenario: to, total, contributions, interaction, separable, describe }
}

// ---------------------------------------------------------------- conflicts

export interface Conflict {
  kind: 'same-key' | 'incompatible-direction' | 'duplicate-scenario'
  scenarioIds: string[]
  keys: string[]
  describe: string
}

/** Where two scenarios cannot be held at once, checked before anything tries to merge them. */
export function findConflicts(scenarios: readonly Scenario[]): Conflict[] {
  const conflicts: Conflict[] = []

  for (let i = 0; i < scenarios.length; i += 1) {
    for (let j = i + 1; j < scenarios.length; j += 1) {
      const a = scenarios[i] as Scenario
      const b = scenarios[j] as Scenario
      const aKeys = new Map(a.changes.filter((one) => one.how === 'set').map((one) => [one.key, one.to]))
      const shared: string[] = []
      const opposed: string[] = []
      for (const change of b.changes) {
        if (change.how !== 'set' || !aKeys.has(change.key)) continue
        shared.push(change.key)
        if (aKeys.get(change.key) !== change.to) opposed.push(change.key)
      }

      if (opposed.length > 0) {
        conflicts.push({
          kind: 'incompatible-direction',
          scenarioIds: [a.id, b.id],
          keys: opposed,
          describe: `"${a.label}" and "${b.label}" both set ${opposed.join(', ')} to different values. They cannot both hold, so combining them means choosing.`
        })
      } else if (shared.length > 0 && shared.length === a.changes.length && shared.length === b.changes.length) {
        conflicts.push({
          kind: 'duplicate-scenario',
          scenarioIds: [a.id, b.id],
          keys: shared,
          describe: `"${a.label}" and "${b.label}" make exactly the same changes. Running both produces the same answer twice.`
        })
      } else if (shared.length > 0) {
        conflicts.push({
          kind: 'same-key',
          scenarioIds: [a.id, b.id],
          keys: shared,
          describe: `"${a.label}" and "${b.label}" both set ${shared.join(', ')}, to the same values. Combining them is safe, but one of them is redundant there.`
        })
      }
    }
  }

  return conflicts
}

export interface Merge {
  scenario: Scenario
  /** Which scenario won each contested key, stated rather than left to the order. */
  resolutions: { key: string; wonBy: string; over: string[] }[]
  describe: string
}

/**
 * Combine scenarios into one, with the precedence stated.
 *
 * Later scenarios in the list win contested keys, and every place that happened is recorded. A merge that silently
 * takes the last value is the same computation with the explanation removed.
 */
export function mergeScenarios(scenarios: readonly Scenario[], id: string, label: string): Merge | ScenarioError {
  if (scenarios.length === 0) return fail('nothing-to-merge', 'A merge needs at least one scenario.')

  const byKey = new Map<string, { change: Change; from: Scenario }[]>()
  for (const scenario of scenarios) {
    if (scenario.parentId !== null) {
      return fail('branched', `"${scenario.label}" branches from another scenario, so merging it would drop the chain it depends on. Resolve it first.`)
    }
    for (const change of scenario.changes) {
      const list = byKey.get(change.key) ?? []
      list.push({ change, from: scenario })
      byKey.set(change.key, list)
    }
  }

  const changes: Change[] = []
  const resolutions: Merge['resolutions'] = []
  for (const [key, list] of byKey) {
    const winner = list[list.length - 1] as { change: Change; from: Scenario }
    changes.push(winner.change)
    const contested = list.filter((one) => one.change.to !== winner.change.to)
    if (contested.length > 0) {
      resolutions.push({ key, wonBy: winner.from.label, over: contested.map((one) => one.from.label) })
    }
  }
  changes.sort((a, b) => a.key.localeCompare(b.key))

  return {
    scenario: { id, label, parentId: null, changes, describe: `Merged from ${scenarios.map((one) => one.label).join(', ')}.` },
    resolutions,
    describe:
      resolutions.length === 0
        ? `${scenarios.length} scenarios combined with nothing contested.`
        : `${scenarios.length} scenarios combined. ${resolutions.length} key${resolutions.length === 1 ? '' : 's'} were set by more than one, and the later scenario won each: ${resolutions.map((one) => `${one.key} from ${one.wonBy}`).join(', ')}.`
  }
}

// ---------------------------------------------------------------- time

export interface Event {
  at: number
  key: string
  how: Change['how']
  to: Value
  because: string
}

export interface Timeline {
  steps: { at: number; values: Record<string, Value>; applied: string[] }[]
  /** Events whose time falls outside the run, kept so the omission is visible. */
  outside: Event[]
  describe: string
}

/**
 * A scenario that changes over time: events applied at their moment, and the state at each step.
 *
 * Events landing between steps are applied at the first step at or after their time, and that step names them. An
 * event outside the run is not applied and is listed, because an event silently dropped is the difference between a
 * scenario that was modelled and one that looks like it was.
 */
export function playTimeline(baseline: Baseline, events: readonly Event[], steps: readonly number[]): Timeline | ScenarioError {
  if (events.length > SCENARIO_LIMITS.events) {
    return fail('too-many-events', `${events.length} events, past the ${SCENARIO_LIMITS.events} allowed.`)
  }
  if (steps.length === 0) return fail('no-steps', 'A timeline needs at least one step.')
  for (let i = 1; i < steps.length; i += 1) {
    if ((steps[i] as number) <= (steps[i - 1] as number)) return fail('unordered', 'The steps must increase.')
  }

  const first = steps[0] as number
  const last = steps[steps.length - 1] as number
  const outside = events.filter((one) => one.at > last || one.at < first)
  const inside = events.filter((one) => one.at <= last && one.at >= first).sort((a, b) => a.at - b.at)

  const values: Record<string, Value> = Object.create(null)
  for (const key of Object.keys(baseline.values)) {
    Object.defineProperty(values, key, { value: baseline.values[key], enumerable: true, writable: true, configurable: true })
  }

  const out: Timeline['steps'] = []
  let cursor = 0
  for (const at of steps) {
    const applied: string[] = []
    while (cursor < inside.length && (inside[cursor] as Event).at <= at) {
      const event = inside[cursor] as Event
      cursor += 1
      const current = Object.prototype.hasOwnProperty.call(values, event.key) ? (values[event.key] as Value) : null
      let next: Value = event.to
      if (event.how !== 'set') {
        if (typeof current !== 'number' || typeof event.to !== 'number') continue
        next = event.how === 'add' ? current + event.to : current * event.to
      }
      Object.defineProperty(values, event.key, { value: next, enumerable: true, writable: true, configurable: true })
      applied.push(`${event.key}: ${event.because || `${event.how} ${String(event.to)}`}`)
    }
    out.push({ at, values: { ...values }, applied })
  }

  return {
    steps: out,
    outside,
    describe:
      outside.length === 0
        ? `${inside.length} event${inside.length === 1 ? '' : 's'} across ${steps.length} steps.`
        : `${inside.length} event${inside.length === 1 ? '' : 's'} applied; ${outside.length} fall outside ${first} to ${last} and were not applied.`
  }
}

/** The assumptions the Page rests on, for a screen that shows them rather than implies them. */
export const SCENARIO_ASSUMPTIONS: readonly string[] = Object.freeze([
  'The baseline is captured and frozen. A scenario is a difference from it, never an edit to it.',
  'A scenario branching from another is resolved by walking the whole chain, and every step that touched a value is named.',
  'A key set twice in one scenario is blocking: the second silently wins and the first reason stays in the record.',
  'A matrix is sized before it is built, because a thousand runs is easy to ask for by accident.',
  'A queue entry that never started because an earlier one failed is skipped, not cancelled.',
  'A queue with any failure is not complete.',
  'One-at-a-time contributions are reported with the interaction left over shown separately, never spread across them.',
  'When the parts do not add up, no single input is said to have caused the move.',
  'A merge states which scenario won each contested key rather than taking the last value quietly.',
  'An event outside the timeline is listed as not applied rather than dropped.'
])
