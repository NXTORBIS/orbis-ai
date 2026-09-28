import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  PLAN_ASSUMPTIONS,
  checkPlan,
  comparePlans,
  emptyPlan,
  isPlanError,
  planHealth,
  progressOf,
  resourceConflicts,
  schedule,
  topologicalOrder,
  whatIfDelayed,
  type Plan,
  type Task
} from './planner.ts'

const task = (id: string, title: string, duration: number, options: Partial<Task> = {}): Task => ({
  id,
  title,
  duration,
  state: options.state ?? 'not-started',
  priority: options.priority ?? 'medium',
  resources: options.resources ?? [],
  goalId: options.goalId ?? null,
  notBefore: options.notBefore ?? null,
  notAfter: options.notAfter ?? null,
  fraction: options.fraction ?? 0,
  notes: options.notes ?? ''
})

/**
 * A -> C and B -> C, with A taking 5 days and B taking 2.
 * C cannot start until both are done, so B has three days of float and A has none.
 */
const project = (): Plan => ({
  ...emptyPlan('p', 'Project'),
  tasks: [task('a', 'Long task', 5), task('b', 'Short task', 2), task('c', 'Final task', 3)],
  dependencies: [
    { from: 'a', to: 'c', kind: 'finish-to-start', lag: 0 },
    { from: 'b', to: 'c', kind: 'finish-to-start', lag: 0 }
  ]
})

describe('validation', () => {
  test('a well-formed plan passes', () => {
    const result = checkPlan(project())
    assert.equal(result.ok, true)
    assert.deepEqual(result.problems, [])
  })

  test('a circular dependency is refused, naming the tasks', () => {
    const plan = project()
    plan.dependencies.push({ from: 'c', to: 'a', kind: 'finish-to-start', lag: 0 })
    const result = checkPlan(plan)
    assert.equal(result.ok, false)
    const cycle = result.problems.find((one) => one.kind === 'cycle')
    assert.ok(cycle)
    assert.match(cycle.describe, /Long task/)
  })

  test('a negative duration is refused', () => {
    const plan = project()
    plan.tasks.push(task('bad', 'Impossible', -1))
    assert.ok(checkPlan(plan).problems.some((one) => one.kind === 'negative-duration'))
  })

  test('a window too narrow for the task is refused, with the arithmetic', () => {
    const plan = project()
    plan.tasks.push(task('tight', 'Too tight', 10, { notBefore: 0, notAfter: 5 }))
    const problem = checkPlan(plan).problems.find((one) => one.kind === 'impossible-window')
    assert.ok(problem)
    assert.match(problem.describe, /only 5 days wide/)
  })

  test('a milestone is recognised as a point in time', () => {
    const plan = project()
    plan.tasks.push(task('m', 'Launch', 0))
    assert.ok(checkPlan(plan).notes.some((one) => /point in time rather than a stretch/.test(one)))
  })

  test('a dependency on a task that is not there is refused', () => {
    const plan = project()
    plan.dependencies.push({ from: 'a', to: 'nope', kind: 'finish-to-start', lag: 0 })
    assert.ok(checkPlan(plan).problems.some((one) => one.kind === 'missing-task'))
  })

  test('the order follows the dependencies rather than the list', () => {
    const plan = project()
    plan.tasks.reverse()
    const order = topologicalOrder(plan)
    assert.ok(!isPlanError(order))
    assert.ok(order.indexOf('a') < order.indexOf('c'))
    assert.ok(order.indexOf('b') < order.indexOf('c'))
  })
})

describe('scheduling', () => {
  test('the dates are derived from the dependencies', () => {
    const result = schedule(project())
    assert.ok(!isPlanError(result))
    const a = result.tasks.find((one) => one.taskId === 'a')
    const c = result.tasks.find((one) => one.taskId === 'c')
    assert.equal(a?.earliestStart, 0)
    assert.equal(a?.earliestFinish, 5)
    // C waits for the later of A and B.
    assert.equal(c?.earliestStart, 5)
    assert.equal(result.duration, 8)
  })

  test('the critical path is computed from the float, not labelled', () => {
    const result = schedule(project())
    assert.ok(!isPlanError(result))
    assert.deepEqual(result.criticalPath, ['a', 'c'])
    assert.equal(result.tasks.find((one) => one.taskId === 'a')?.totalFloat, 0)
    assert.equal(result.tasks.find((one) => one.taskId === 'b')?.totalFloat, 3)
    assert.equal(result.tasks.find((one) => one.taskId === 'b')?.critical, false)
  })

  test('the notes say what the critical path means', () => {
    const result = schedule(project())
    assert.ok(!isPlanError(result))
    assert.ok(result.notes.some((one) => /delaying the others does not/.test(one)))
  })

  test('what drove a task’s start is recorded, so the date has a reason', () => {
    const result = schedule(project())
    assert.ok(!isPlanError(result))
    assert.equal(result.tasks.find((one) => one.taskId === 'c')?.drivenBy, 'a')
  })

  test('a lag pushes the follower out by exactly that much', () => {
    const plan = project()
    plan.dependencies = [{ from: 'a', to: 'c', kind: 'finish-to-start', lag: 2 }]
    const result = schedule(plan)
    assert.ok(!isPlanError(result))
    assert.equal(result.tasks.find((one) => one.taskId === 'c')?.earliestStart, 7)
  })

  test('start-to-start lets two tasks run together', () => {
    const plan: Plan = {
      ...emptyPlan('p', 'Parallel'),
      tasks: [task('a', 'A', 5), task('b', 'B', 3)],
      dependencies: [{ from: 'a', to: 'b', kind: 'start-to-start', lag: 0 }]
    }
    const result = schedule(plan)
    assert.ok(!isPlanError(result))
    assert.equal(result.tasks.find((one) => one.taskId === 'b')?.earliestStart, 0)
    assert.equal(result.duration, 5)
  })

  test('finish-to-finish makes two tasks end together', () => {
    const plan: Plan = {
      ...emptyPlan('p', 'Together'),
      tasks: [task('a', 'A', 5), task('b', 'B', 2)],
      dependencies: [{ from: 'a', to: 'b', kind: 'finish-to-finish', lag: 0 }]
    }
    const result = schedule(plan)
    assert.ok(!isPlanError(result))
    // B has to finish when A does, so it starts three days in.
    assert.equal(result.tasks.find((one) => one.taskId === 'b')?.earliestStart, 3)
    assert.equal(result.tasks.find((one) => one.taskId === 'b')?.earliestFinish, 5)
  })

  test('a fixed earliest start is honoured', () => {
    const plan = project()
    plan.tasks[1].notBefore = 10
    const result = schedule(plan)
    assert.ok(!isPlanError(result))
    assert.equal(result.tasks.find((one) => one.taskId === 'b')?.earliestStart, 10)
    // B now drives C, and the plan is longer.
    assert.equal(result.duration, 15)
  })

  test('free float and total float differ where a task has followers with slack', () => {
    const result = schedule(project())
    assert.ok(!isPlanError(result))
    const b = result.tasks.find((one) => one.taskId === 'b')
    // B can slip three days before C moves, so its free float equals its total float here.
    assert.equal(b?.freeFloat, 3)
  })

  test('a missed deadline is reported with how late it is', () => {
    const plan = project()
    plan.goals = [{ id: 'g', title: 'Ship it', parent: null, deadline: 5, successCriteria: [], priority: 'high' }]
    plan.tasks = plan.tasks.map((one) => ({ ...one, goalId: 'g' }))
    const result = schedule(plan)
    assert.ok(!isPlanError(result))
    assert.equal(result.missedDeadlines.length, 1)
    assert.equal(result.missedDeadlines[0].lateBy, 3)
  })

  test('a plan that does not validate is refused rather than scheduled', () => {
    const plan = project()
    plan.dependencies.push({ from: 'c', to: 'a', kind: 'finish-to-start', lag: 0 })
    assert.ok(isPlanError(schedule(plan)))
  })
})

describe('resources', () => {
  test('a person asked to do two things at once is a conflict', () => {
    const plan: Plan = {
      ...emptyPlan('p', 'Overloaded'),
      tasks: [task('a', 'A', 3, { resources: ['asha'] }), task('b', 'B', 3, { resources: ['asha'] })],
      dependencies: [],
      resources: [{ id: 'asha', name: 'Asha', capacity: 1, unavailable: [] }]
    }
    const computed = schedule(plan)
    assert.ok(!isPlanError(computed))
    const conflicts = resourceConflicts(plan, computed)
    assert.ok(conflicts.length > 0)
    assert.match(conflicts[0].describe, /arithmetically valid and not actually possible/)
  })

  test('a team of two doing two things is not a conflict', () => {
    const plan: Plan = {
      ...emptyPlan('p', 'Fine'),
      tasks: [task('a', 'A', 3, { resources: ['team'] }), task('b', 'B', 3, { resources: ['team'] })],
      dependencies: [],
      resources: [{ id: 'team', name: 'Team', capacity: 2, unavailable: [] }]
    }
    const computed = schedule(plan)
    assert.ok(!isPlanError(computed))
    assert.equal(resourceConflicts(plan, computed).length, 0)
  })

  test('a day the resource is unavailable is a conflict however much capacity it has', () => {
    const plan: Plan = {
      ...emptyPlan('p', 'Away'),
      tasks: [task('a', 'A', 2, { resources: ['asha'] })],
      dependencies: [],
      resources: [{ id: 'asha', name: 'Asha', capacity: 5, unavailable: [1] }]
    }
    const computed = schedule(plan)
    assert.ok(!isPlanError(computed))
    const conflicts = resourceConflicts(plan, computed)
    assert.equal(conflicts.length, 1)
    assert.match(conflicts[0].describe, /is unavailable on day 1/)
  })

  test('a finished task does not consume its resource', () => {
    const plan: Plan = {
      ...emptyPlan('p', 'Done'),
      tasks: [task('a', 'A', 3, { resources: ['asha'], state: 'done' }), task('b', 'B', 3, { resources: ['asha'] })],
      dependencies: [],
      resources: [{ id: 'asha', name: 'Asha', capacity: 1, unavailable: [] }]
    }
    const computed = schedule(plan)
    assert.ok(!isPlanError(computed))
    assert.equal(resourceConflicts(plan, computed).length, 0)
  })
})

describe('progress', () => {
  const partly = (): Plan => ({
    ...emptyPlan('p', 'Partly'),
    tasks: [
      task('a', 'Quick', 1, { state: 'done' }),
      task('b', 'Long', 9, { state: 'in-progress', fraction: 0.5 }),
      task('c', 'Waiting', 10)
    ],
    dependencies: []
  })

  test('counting tasks and weighting by duration give different answers, which is the point', () => {
    const byCount = progressOf(partly(), 'by-count')
    const byDuration = progressOf(partly(), 'by-duration')
    assert.ok(Math.abs(byCount.fraction - 1 / 3) < 1e-12)
    assert.ok(Math.abs(byDuration.fraction - 1 / 20) < 1e-12)
    assert.notEqual(byCount.fraction, byDuration.fraction)
  })

  test('the rule used is always reported, because the rules disagree', () => {
    assert.match(progressOf(partly(), 'by-count').describe, /treats a five-minute task and a five-week one as equal/)
    assert.match(progressOf(partly(), 'by-fraction').describe, /rests on numbers somebody typed/)
  })

  test('a reported fraction counts partial work', () => {
    const byFraction = progressOf(partly(), 'by-fraction')
    // 1 done plus half of 9 out of 20.
    assert.ok(Math.abs(byFraction.fraction - 5.5 / 20) < 1e-12)
  })

  test('cancelled tasks are left out of the totals', () => {
    const plan = partly()
    plan.tasks.push(task('x', 'Dropped', 100, { state: 'cancelled' }))
    assert.equal(progressOf(plan, 'by-count').total, 3)
  })

  test('blocked tasks are counted separately', () => {
    const plan = partly()
    plan.tasks[2].state = 'blocked'
    const result = progressOf(plan)
    assert.equal(result.blocked, 1)
    assert.match(result.describe, /1 is blocked/)
  })
})

describe('health', () => {
  test('a plan with nothing wrong is on track', () => {
    const plan = project()
    plan.tasks[0].state = 'in-progress'
    const computed = schedule(plan)
    assert.ok(!isPlanError(computed))
    assert.equal(planHealth(plan, computed, [], 1).health, 'on-track')
  })

  test('a plan where nothing has started says so rather than calling it on track', () => {
    const computed = schedule(project())
    assert.ok(!isPlanError(computed))
    assert.equal(planHealth(project(), computed, [], 0).health, 'not-started')
  })

  test('a finished plan is complete', () => {
    const plan = project()
    plan.tasks = plan.tasks.map((one) => ({ ...one, state: 'done' as const }))
    const computed = schedule(plan)
    assert.ok(!isPlanError(computed))
    assert.equal(planHealth(plan, computed, [], 20).health, 'complete')
  })

  test('a blocked task makes the plan blocked, and it is named', () => {
    const plan = project()
    plan.tasks[0].state = 'blocked'
    const computed = schedule(plan)
    assert.ok(!isPlanError(computed))
    const health = planHealth(plan, computed, [], 1)
    assert.equal(health.health, 'blocked')
    assert.ok(health.reasons.some((one) => one.about === 'a'))
  })

  test('an overdue task with float is at risk rather than late', () => {
    const plan = project()
    // The critical task is finished, so the only thing running late is the one with slack.
    plan.tasks[0].state = 'done'
    plan.tasks[1].state = 'in-progress'
    const computed = schedule(plan)
    assert.ok(!isPlanError(computed))
    const health = planHealth(plan, computed, [], 6)
    assert.equal(health.health, 'at-risk')
    assert.ok(health.reasons.some((one) => /float, so the end date has not moved yet/.test(one.describe)))
  })

  test('an overdue critical task makes the plan late, and says the whole plan has moved', () => {
    const plan = project()
    plan.tasks[0].state = 'in-progress'
    const computed = schedule(plan)
    assert.ok(!isPlanError(computed))
    const health = planHealth(plan, computed, [], 6)
    assert.equal(health.health, 'late')
    assert.ok(health.reasons.some((one) => /whole plan has moved/.test(one.describe)))
  })

  test('a missed deadline makes the plan late', () => {
    const plan = project()
    plan.goals = [{ id: 'g', title: 'Ship', parent: null, deadline: 2, successCriteria: [], priority: 'high' }]
    plan.tasks = plan.tasks.map((one) => ({ ...one, goalId: 'g', state: 'in-progress' as const }))
    const computed = schedule(plan)
    assert.ok(!isPlanError(computed))
    assert.equal(planHealth(plan, computed, [], 1).health, 'late')
  })
})

describe('replanning', () => {
  test('delaying a task with float moves nothing, which is the useful answer', () => {
    const result = whatIfDelayed(project(), 'b', 2)
    assert.ok(!isPlanError(result))
    assert.equal(result.difference.durationChange, 0)
    assert.equal(result.difference.movedTasks.length, 0)
    assert.equal(result.difference.describe, 'The schedule is unchanged.')
  })

  test('delaying a critical task moves the whole plan by the same amount', () => {
    const result = whatIfDelayed(project(), 'a', 3)
    assert.ok(!isPlanError(result))
    assert.equal(result.difference.durationChange, 3)
    assert.ok(result.difference.movedTasks.some((one) => one.taskId === 'c'))
  })

  test('delaying enough to change which chain is longest is reported as the path changing', () => {
    const result = whatIfDelayed(project(), 'b', 10)
    assert.ok(!isPlanError(result))
    assert.equal(result.difference.criticalPathChanged, true)
    assert.match(result.difference.describe, /effort aimed at the old one no longer helps/)
  })

  test('a task that is not there cannot be delayed', () => {
    assert.ok(isPlanError(whatIfDelayed(project(), 'nope', 1)))
  })

  test('two plans compared report what changed in the configuration and in the schedule', () => {
    const before = project()
    const after = project()
    after.tasks.push(task('d', 'New task', 4))
    const beforeSchedule = schedule(before)
    const afterSchedule = schedule(after)
    assert.ok(!isPlanError(beforeSchedule) && !isPlanError(afterSchedule))
    const difference = comparePlans({ plan: before, schedule: beforeSchedule }, { plan: after, schedule: afterSchedule })
    assert.deepEqual(difference.addedTasks, ['d'])
    assert.equal(difference.removedTasks.length, 0)
  })

  test('a changed duration is reported as a change rather than only as a moved date', () => {
    const before = project()
    const after = project()
    after.tasks[0].duration = 8
    const beforeSchedule = schedule(before)
    const afterSchedule = schedule(after)
    assert.ok(!isPlanError(beforeSchedule) && !isPlanError(afterSchedule))
    const difference = comparePlans({ plan: before, schedule: beforeSchedule }, { plan: after, schedule: afterSchedule })
    assert.deepEqual(difference.changedDurations, [{ taskId: 'a', from: 5, to: 8 }])
  })
})

describe('the assumptions are stated', () => {
  test('the list names the distinctions the Page is built on', () => {
    assert.ok(PLAN_ASSUMPTIONS.length >= 8)
    assert.ok(PLAN_ASSUMPTIONS.some((one) => /Dates are derived/.test(one)))
    assert.ok(PLAN_ASSUMPTIONS.some((one) => /ignores resources/.test(one)))
    assert.ok(PLAN_ASSUMPTIONS.some((one) => /often that nothing moves/.test(one)))
  })
})
