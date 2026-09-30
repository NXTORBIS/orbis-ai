/**
 * The planning and deciding workbench a Page can reach: task graphs, schedules, weighted choices and sensitivity.
 *
 * Same contract as every bridge before it. A Page sends data, never code. There is no `eval` and no `new Function`
 * on any path reachable from here, and every number a Page shows came back through this door from an engine that
 * computed it — none of it is produced by a language model and none of it is hardcoded.
 *
 * ## Why the Page holds the plan and this holds none of it
 *
 * A plan arrives whole on every call and nothing here remembers it. That looks wasteful and is the right shape: the
 * Page owns its own state and persists it through the Page store, so there is exactly one copy of the plan and no
 * way for a cached one here to disagree with it. A schedule is a pure function of a plan, so recomputing it is
 * cheaper than the bugs that come from keeping it.
 *
 * ## Why dates are day numbers and never calendar dates
 *
 * Every date in a plan is an offset in days from the plan's own start. No operation here reads a clock, which means
 * a schedule computed today and the same schedule computed next year are identical, and a plan can be tested. Where
 * a health report needs to know what "late" means, the Page passes the day it considers today — so the reading is
 * visible rather than hidden inside an engine.
 *
 * ## Why there is no single "decide" operation
 *
 * The engine has one, and it takes requirements carrying a predicate function. A function cannot cross this
 * boundary — that is the whole point of the boundary — so rather than inventing a weaker version of requirements
 * that looks like the real thing, the pieces are exposed separately: rank, stability, pareto, trade-off and risk.
 * A Page can do everything `decide` does by calling them, and nothing here pretends to screen options against
 * rules it was never given.
 *
 * ## The operations that refuse rather than default
 *
 * `plan.schedule` refuses a dependency cycle rather than returning a partial order that quietly omits the tasks
 * caught in it. `decide.weights-pairwise` reports its consistency ratio, because contradictory comparisons produce
 * confident-looking weights. `decide.rank` treats a missing value as missing rather than as zero. Nothing here
 * names a winner unless the Page supplied the weights that decide one.
 */

import {
  PLAN_ASSUMPTIONS,
  PLAN_LIMITS,
  checkPlan,
  comparePlans,
  isPlanError,
  planHealth,
  progressOf,
  resourceConflicts,
  schedule,
  topologicalOrder,
  whatIfDelayed,
  type Dependency,
  type DependencyKind,
  type Goal,
  type Plan,
  type ProgressRule,
  type Resource,
  type Task,
  type TaskState
} from '../../shared/pages/planner.ts'
import {
  COMPARE_ASSUMPTIONS,
  MISSING,
  NOT_APPLICABLE,
  differences,
  filterEntities,
  isCompareError,
  normalise,
  pareto,
  rank,
  stability,
  tradeOff,
  type Criterion,
  type CriterionKind,
  type CriterionValue,
  type Direction,
  type Entity,
  type Filter
} from '../../shared/pages/compare.ts'
import {
  DECISION_ASSUMPTIONS,
  equalWeights,
  isDecisionError,
  summariseRisks,
  weightsFromPairwise,
  weightsFromRanking,
  type Comparison,
  type Risk
} from '../../shared/pages/decision.ts'
import { BadInput, Reader } from './engines.ts'

/**
 * Every operation this bridge answers, and the capability each one needs.
 *
 * Two, not one. Planning a project and choosing between options are different things a Page might want one of
 * without the other, and the split is along the line a person would recognise: `computation.planning` works out
 * when things can happen, `computation.deciding` works out which option a stated set of weights prefers.
 */
export const PLANNING_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  // ---- plans
  'plan.check': 'computation.planning',
  'plan.order': 'computation.planning',
  'plan.schedule': 'computation.planning',
  'plan.conflicts': 'computation.planning',
  'plan.progress': 'computation.planning',
  'plan.health': 'computation.planning',
  'plan.what-if': 'computation.planning',
  'plan.compare': 'computation.planning',
  'plan.dependency-kinds': 'computation.planning',

  // ---- choices
  'decide.normalise': 'computation.deciding',
  'decide.rank': 'computation.deciding',
  'decide.stability': 'computation.deciding',
  'decide.pareto': 'computation.deciding',
  'decide.trade-off': 'computation.deciding',
  'decide.differences': 'computation.deciding',
  'decide.filter': 'computation.deciding',
  'decide.weights-equal': 'computation.deciding',
  'decide.weights-ranking': 'computation.deciding',
  'decide.weights-pairwise': 'computation.deciding',
  'decide.risks': 'computation.deciding',
  'decide.criterion-kinds': 'computation.deciding',

  // ---- provenance
  'planning.assumptions': 'computation.planning'
})

/** What crosses the boundary, as opposed to what the engines will compute. */
export const PLANNING_LIMITS = Object.freeze({
  tasks: PLAN_LIMITS.tasks,
  goals: 200,
  dependencies: PLAN_LIMITS.dependencies,
  resources: PLAN_LIMITS.resources,
  options: 200,
  criteria: 100,
  risks: 400,
  comparisons: 4000,
  filters: 64,
  days: 100_000
})

const settle = <T>(value: T, isError: (one: unknown) => boolean): unknown =>
  isError(value) ? { ok: false, ...(value as object) } : { ok: true, ...(value as object) }

// ---------------------------------------------------------------- readers

function choice<T extends string>(read: Reader, key: string, allowed: readonly T[], fallback?: T): T {
  if (!read.has(key)) {
    if (fallback !== undefined) return fallback
    throw new BadInput(`"${key}" has to be one of: ${allowed.join(', ')}.`)
  }
  const value = read.text(key, 64)
  if (!(allowed as readonly string[]).includes(value)) {
    throw new BadInput(`"${value}" is not one of: ${allowed.join(', ')}.`)
  }
  return value as T
}

const TASK_STATES: readonly TaskState[] = [
  'not-started',
  'ready',
  'in-progress',
  'blocked',
  'done',
  'skipped',
  'cancelled'
]
const DEPENDENCY_KINDS: readonly DependencyKind[] = [
  'finish-to-start',
  'start-to-start',
  'finish-to-finish',
  'start-to-finish'
]
const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const
const PROGRESS_RULES: readonly ProgressRule[] = ['by-count', 'by-duration', 'by-fraction']
const CRITERION_KINDS: readonly CriterionKind[] = ['number', 'currency', 'boolean', 'category', 'rating', 'date', 'text']
const DIRECTIONS: readonly Direction[] = ['higher-better', 'lower-better', 'target', 'range', 'neutral']
const FILTER_TESTS = ['above', 'below', 'equals', 'one-of', 'present'] as const

/**
 * A number that may legitimately be absent, read as null rather than zero.
 *
 * A task with no deadline and a task due on day zero are different facts, and defaulting the first to the second
 * is how a plan acquires a deadline nobody set.
 */
const optionalDay = (read: Reader, key: string): number | null => (read.has(key) ? read.number(key) : null)

function taskFrom(row: Record<string, unknown>): Task {
  const read = new Reader(row)
  return {
    id: read.text('id', 80),
    title: read.text('title', 200),
    duration: read.number('duration'),
    state: choice<TaskState>(read, 'state', TASK_STATES, 'not-started'),
    priority: choice(read, 'priority', PRIORITIES, 'medium'),
    resources: read.has('resources') ? read.strings('resources', PLANNING_LIMITS.resources) : [],
    goalId: read.has('goalId') ? read.text('goalId', 80) : null,
    notBefore: optionalDay(read, 'notBefore'),
    notAfter: optionalDay(read, 'notAfter'),
    fraction: read.has('fraction') ? read.number('fraction') : 0,
    notes: read.has('notes') ? read.text('notes', 1000) : ''
  }
}

function goalFrom(row: Record<string, unknown>): Goal {
  const read = new Reader(row)
  return {
    id: read.text('id', 80),
    title: read.text('title', 200),
    parent: read.has('parent') ? read.text('parent', 80) : null,
    deadline: optionalDay(read, 'deadline'),
    successCriteria: read.has('successCriteria') ? read.strings('successCriteria', 64) : [],
    priority: choice(read, 'priority', PRIORITIES, 'medium')
  }
}

function dependencyFrom(row: Record<string, unknown>): Dependency {
  const read = new Reader(row)
  return {
    from: read.text('from', 80),
    to: read.text('to', 80),
    kind: choice<DependencyKind>(read, 'kind', DEPENDENCY_KINDS, 'finish-to-start'),
    lag: read.has('lag') ? read.number('lag') : 0
  }
}

function resourceFrom(row: Record<string, unknown>): Resource {
  const read = new Reader(row)
  return {
    id: read.text('id', 80),
    name: read.text('name', 200),
    capacity: read.number('capacity'),
    unavailable: read.has('unavailable') ? read.numbers('unavailable', 2000) : []
  }
}

/** A whole plan, read from one object. The Page owns it; this borrows it for the length of one call. */
function planFrom(read: Reader, key = 'plan'): Plan {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be a plan object.`)
  }
  const entry = new Reader(raw as Record<string, unknown>)
  return {
    id: entry.text('id', 80),
    title: entry.text('title', 200),
    startDay: entry.has('startDay') ? entry.number('startDay') : 0,
    goals: entry.has('goals') ? entry.list('goals', PLANNING_LIMITS.goals).map(goalFrom) : [],
    tasks: entry.has('tasks') ? entry.list('tasks', PLANNING_LIMITS.tasks).map(taskFrom) : [],
    dependencies: entry.has('dependencies')
      ? entry.list('dependencies', PLANNING_LIMITS.dependencies).map(dependencyFrom)
      : [],
    resources: entry.has('resources') ? entry.list('resources', PLANNING_LIMITS.resources).map(resourceFrom) : []
  }
}

/**
 * A criterion value, which may be a number, a word, a yes/no, or explicitly absent.
 *
 * Absent has two spellings and they mean different things. `"missing"` is a value nobody has supplied yet;
 * `"not-applicable"` is one the criterion cannot have for this option. Collapsing them, or turning either into
 * zero, is the mistake this whole type exists to prevent — a phone with no headphone jack does not score zero on
 * headphone quality.
 */
function criterionValueFrom(raw: unknown): CriterionValue {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new BadInput('A criterion value has to be a finite number.')
    return raw
  }
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') {
    if (raw.length > 1000) throw new BadInput('That criterion value is too long.')
    if (raw === 'missing') return MISSING
    if (raw === 'not-applicable') return NOT_APPLICABLE
    return raw
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const kind = (raw as Record<string, unknown>).kind
    if (kind === 'missing') return MISSING
    if (kind === 'not-applicable') return NOT_APPLICABLE
  }
  throw new BadInput(
    'A criterion value is a number, a word, true or false, or "missing" or "not-applicable". Those last two are different: one is a value nobody supplied, the other one the option cannot have.'
  )
}

function criterionFrom(row: Record<string, unknown>): Criterion {
  const read = new Reader(row)
  const rangeRaw = read.has('range') ? read.raw('range') : null
  let range: { low: number; high: number } | null = null
  if (rangeRaw !== null && typeof rangeRaw === 'object' && !Array.isArray(rangeRaw)) {
    const entry = new Reader(rangeRaw as Record<string, unknown>)
    range = { low: entry.number('low'), high: entry.number('high') }
  }
  return {
    id: read.text('id', 80),
    name: read.text('name', 200),
    kind: choice<CriterionKind>(read, 'kind', CRITERION_KINDS, 'number'),
    direction: choice<Direction>(read, 'direction', DIRECTIONS, 'higher-better'),
    unit: read.has('unit') ? read.text('unit', 40) : '',
    target: read.has('target') ? read.number('target') : null,
    range,
    scale: read.has('scale') ? read.strings('scale', 64) : [],
    weight: read.has('weight') ? read.number('weight') : 1,
    describe: read.has('describe') ? read.text('describe', 600) : '',
    source: read.has('source') ? read.text('source', 300) : ''
  }
}

function entityFrom(row: Record<string, unknown>): Entity {
  const read = new Reader(row)
  const valuesRaw = read.raw('values')
  if (typeof valuesRaw !== 'object' || valuesRaw === null || Array.isArray(valuesRaw)) {
    throw new BadInput('An option needs a "values" object keyed by criterion id.')
  }
  const values: Record<string, CriterionValue> = Object.create(null)
  for (const [criterionId, raw] of Object.entries(valuesRaw as Record<string, unknown>)) {
    if (criterionId.length > 80) throw new BadInput('A criterion id in "values" is too long.')
    values[criterionId] = criterionValueFrom(raw)
  }
  return {
    id: read.text('id', 80),
    name: read.text('name', 200),
    values,
    describe: read.has('describe') ? read.text('describe', 600) : '',
    source: read.has('source') ? read.text('source', 300) : ''
  }
}

function riskFrom(row: Record<string, unknown>): Risk {
  const read = new Reader(row)
  return {
    id: read.text('id', 80),
    optionId: read.text('optionId', 80),
    description: read.text('description', 600),
    probability: read.number('probability'),
    impact: read.number('impact'),
    mitigation: read.has('mitigation') ? read.text('mitigation', 600) : '',
    // Left null rather than defaulted to the unmitigated probability: "no mitigation planned" and "mitigation that
    // changes nothing" are different claims, and only the Page knows which it meant.
    residualProbability: read.has('residualProbability') ? read.number('residualProbability') : null,
    source: read.has('source') ? read.text('source', 300) : ''
  }
}

function comparisonFrom(row: Record<string, unknown>): Comparison {
  const read = new Reader(row)
  return { a: read.text('a', 80), b: read.text('b', 80), ratio: read.number('ratio') }
}

function filterFrom(row: Record<string, unknown>): Filter {
  const read = new Reader(row)
  const rawValue = read.has('value') ? read.raw('value') : null
  let value: number | string | null = null
  if (typeof rawValue === 'number') value = rawValue
  else if (typeof rawValue === 'string') value = rawValue.slice(0, 200)
  return {
    criterionId: read.text('criterionId', 80),
    test: choice(read, 'test', FILTER_TESTS),
    value,
    values: read.has('values') ? read.strings('values', 200) : []
  }
}

const optionsOf = (read: Reader): Entity[] =>
  read.list('options', PLANNING_LIMITS.options).map(entityFrom)

const criteriaOf = (read: Reader): Criterion[] =>
  read.list('criteria', PLANNING_LIMITS.criteria).map(criterionFrom)

/** One option by id, for the operations that compare a named pair. */
function optionNamed(options: readonly Entity[], id: string): Entity {
  const found = options.find((one) => one.id === id)
  if (found === undefined) {
    throw new BadInput(`There is no option with the id "${id}". The options given are: ${options.map((one) => one.id).join(', ')}.`)
  }
  return found
}

export function runPlanningOperation(operation: string, input: Record<string, unknown>): unknown {
  const read = new Reader(input)

  switch (operation) {
    // ---------------------------------------------------------------- plans
    case 'plan.check': {
      // Under a named field, not spread. `PlanCheck` carries its own `ok` meaning "this plan is sound", and
      // spreading it here would overwrite the `ok` that means "this call worked" -- so a plan with a problem would
      // come back looking like a bridge failure, and the problems would be read as an error payload.
      const checked = checkPlan(planFrom(read))
      return { ok: true, sound: checked.ok, problems: checked.problems, notes: checked.notes }
    }

    case 'plan.order': {
      // Under a named field. `topologicalOrder` returns an array, and spreading an array onto a result object turns
      // it into numeric keys -- {ok: true, 0: 'design', 1: 'build'} -- which is a shape no caller would expect.
      const order = topologicalOrder(planFrom(read))
      return isPlanError(order) ? { ok: false, ...order } : { ok: true, order }
    }

    case 'plan.schedule':
      return settle(schedule(planFrom(read)), isPlanError)

    case 'plan.conflicts': {
      // The schedule is computed here rather than taken from the Page, so a conflict report can never be about a
      // schedule that no longer matches the plan it came from.
      const plan = planFrom(read)
      const computed = schedule(plan)
      if (isPlanError(computed)) return settle(computed, isPlanError)
      return { ok: true, conflicts: resourceConflicts(plan, computed), duration: computed.duration }
    }

    case 'plan.progress':
      return {
        ok: true,
        ...progressOf(planFrom(read), choice<ProgressRule>(read, 'rule', PROGRESS_RULES, 'by-duration'))
      }

    case 'plan.health': {
      const plan = planFrom(read)
      const computed = schedule(plan)
      if (isPlanError(computed)) return settle(computed, isPlanError)
      // What "today" is has to come from the Page. Reading a clock here would make a health report unreproducible
      // and would mean the same plan told two different stories on two different days for no visible reason.
      const today = read.number('today')
      if (!Number.isFinite(today)) throw new BadInput('"today" has to be a day number.')
      return {
        ok: true,
        ...planHealth(plan, computed, resourceConflicts(plan, computed), today)
      }
    }

    case 'plan.what-if':
      return settle(whatIfDelayed(planFrom(read), read.text('taskId', 80), read.number('extraDays')), isPlanError)

    case 'plan.compare': {
      const before = planFrom(read, 'before')
      const after = planFrom(read, 'after')
      const beforeSchedule = schedule(before)
      if (isPlanError(beforeSchedule)) return settle(beforeSchedule, isPlanError)
      const afterSchedule = schedule(after)
      if (isPlanError(afterSchedule)) return settle(afterSchedule, isPlanError)
      return {
        ok: true,
        ...comparePlans({ plan: before, schedule: beforeSchedule }, { plan: after, schedule: afterSchedule })
      }
    }

    case 'plan.dependency-kinds':
      return {
        ok: true,
        kinds: DEPENDENCY_KINDS,
        states: TASK_STATES,
        priorities: PRIORITIES,
        progressRules: PROGRESS_RULES
      }

    // ---------------------------------------------------------------- choices
    case 'decide.normalise': {
      const options = optionsOf(read)
      const criteria = criteriaOf(read)
      const wanted = read.text('criterionId', 80)
      const criterion = criteria.find((one) => one.id === wanted)
      if (criterion === undefined) {
        throw new BadInput(`There is no criterion with the id "${wanted}".`)
      }
      const result = normalise(options, criterion)
      return isCompareError(result) ? { ok: false, ...result } : { ok: true, normalised: result }
    }

    case 'decide.rank':
      return settle(rank(optionsOf(read), criteriaOf(read)), isCompareError)

    case 'decide.stability':
      return settle(
        stability(optionsOf(read), criteriaOf(read), {
          samples: read.has('samples') ? read.number('samples') : undefined,
          // A seed rather than a clock or a random source, so the same question gives the same sensitivity answer.
          seed: read.has('seed') ? read.number('seed') : undefined
        }),
        isCompareError
      )

    case 'decide.pareto':
      return settle(pareto(optionsOf(read), criteriaOf(read)), isCompareError)

    case 'decide.trade-off': {
      const options = optionsOf(read)
      return {
        ok: true,
        ...tradeOff(
          optionNamed(options, read.text('first', 80)),
          optionNamed(options, read.text('second', 80)),
          criteriaOf(read)
        )
      }
    }

    case 'decide.differences': {
      const options = optionsOf(read)
      return {
        ok: true,
        differences: differences(
          optionNamed(options, read.text('first', 80)),
          optionNamed(options, read.text('second', 80)),
          criteriaOf(read)
        )
      }
    }

    case 'decide.filter':
      return {
        ok: true,
        ...filterEntities(
          optionsOf(read),
          criteriaOf(read),
          read.list('filters', PLANNING_LIMITS.filters).map(filterFrom)
        )
      }

    case 'decide.weights-equal':
      return { ok: true, ...equalWeights(criteriaOf(read)) }

    case 'decide.weights-ranking':
      return settle(weightsFromRanking(read.strings('order', PLANNING_LIMITS.criteria)), isDecisionError)

    case 'decide.weights-pairwise':
      return settle(
        weightsFromPairwise(
          read.strings('criteria', PLANNING_LIMITS.criteria),
          read.list('comparisons', PLANNING_LIMITS.comparisons).map(comparisonFrom)
        ),
        isDecisionError
      )

    case 'decide.risks':
      return settle(
        summariseRisks(read.text('optionId', 80), read.list('risks', PLANNING_LIMITS.risks).map(riskFrom)),
        isDecisionError
      )

    case 'decide.criterion-kinds':
      return { ok: true, kinds: CRITERION_KINDS, directions: DIRECTIONS, filterTests: FILTER_TESTS }

    // ---------------------------------------------------------------- provenance
    case 'planning.assumptions':
      return {
        ok: true,
        planning: PLAN_ASSUMPTIONS,
        comparing: COMPARE_ASSUMPTIONS,
        deciding: DECISION_ASSUMPTIONS,
        noSingleDecide:
          'There is no one "decide" operation. The engine has one and it takes requirements carrying a predicate function, which cannot cross this boundary. The pieces are exposed instead, so nothing here pretends to screen options against rules it was never given.'
      }

    default:
      throw new BadInput(`"${operation}" is not a planning operation.`)
  }
}
