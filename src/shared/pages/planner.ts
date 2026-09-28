/**
 * Planning: goals, tasks, dependencies and a schedule computed from them.
 *
 * The thing that makes this a planner rather than a list is that the dates are *derived*. Nobody types a start date;
 * it follows from what a task depends on, how long that takes, and when resources are free. Change one duration and
 * everything downstream moves, which is what a plan is for.
 *
 * ## The critical path is a fact, not a label
 *
 * A task is critical when its float is zero -- when delaying it by a day delays the whole plan by a day. That is
 * computed from the forward and backward passes, and it is the most useful thing a schedule knows: it says exactly
 * where attention changes the end date and where it does not.
 *
 * ## Progress comes from the tasks
 *
 * A completion percentage is derived from task states by a stated rule. A number somebody typed is a claim about
 * progress; a number computed from what is done is a measurement of it, and the two should never look the same.
 */

export interface PlanError {
  error: string
  message: string
}

export const isPlanError = (value: unknown): value is PlanError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): PlanError => ({ error, message })

export const PLAN_LIMITS: Readonly<Record<'tasks' | 'dependencies' | 'resources' | 'depth' | 'horizonDays', number>> = Object.freeze({
  tasks: 5_000,
  dependencies: 20_000,
  resources: 500,
  depth: 100,
  horizonDays: 36_500
})

// ---------------------------------------------------------------- goals and tasks

export type TaskState = 'not-started' | 'ready' | 'in-progress' | 'blocked' | 'done' | 'skipped' | 'cancelled'

export type DependencyKind = 'finish-to-start' | 'start-to-start' | 'finish-to-finish' | 'start-to-finish'

export interface Dependency {
  from: string
  to: string
  kind: DependencyKind
  /** Days of enforced delay after the dependency is met. Negative means overlap, which is allowed and unusual. */
  lag: number
}

export interface Task {
  id: string
  title: string
  /** In days. Zero marks a milestone, which is a point in time rather than a stretch of it. */
  duration: number
  state: TaskState
  priority: 'critical' | 'high' | 'medium' | 'low'
  /** Resource ids this needs for its whole duration. */
  resources: string[]
  goalId: string | null
  /** Fixed dates, where something outside the plan sets them. Everything else is derived. */
  notBefore: number | null
  notAfter: number | null
  /** How much is done, 0 to 1. Only meaningful while in progress. */
  fraction: number
  notes: string
}

export interface Goal {
  id: string
  title: string
  parent: string | null
  deadline: number | null
  /** What finishing means, in terms that can be checked. An empty list means completion is a judgement call. */
  successCriteria: string[]
  priority: Task['priority']
}

export interface Resource {
  id: string
  name: string
  /** How many of this there are. One person is capacity 1; a team of three is 3. */
  capacity: number
  /** Days this is unavailable, as offsets from the plan's start. */
  unavailable: number[]
}

export interface Plan {
  id: string
  title: string
  /** Day zero. Every date in the plan is an offset from this, so the arithmetic never touches a calendar. */
  startDay: number
  goals: Goal[]
  tasks: Task[]
  dependencies: Dependency[]
  resources: Resource[]
}

export const emptyPlan = (id: string, title: string, startDay = 0): Plan => ({
  id,
  title,
  startDay,
  goals: [],
  tasks: [],
  dependencies: [],
  resources: []
})

// ---------------------------------------------------------------- validation

export interface PlanProblem {
  kind: 'cycle' | 'missing-task' | 'duplicate' | 'negative-duration' | 'impossible-window' | 'over-capacity' | 'too-large' | 'orphan-goal'
  ids: string[]
  describe: string
  blocking: boolean
}

export interface PlanCheck {
  ok: boolean
  problems: PlanProblem[]
  notes: string[]
}

/** Whether a plan can be scheduled at all. Every check runs before any dates are computed. */
export function checkPlan(plan: Plan): PlanCheck {
  const problems: PlanProblem[] = []
  const notes: string[] = []
  const byId = new Map<string, Task>()

  if (plan.tasks.length > PLAN_LIMITS.tasks) {
    problems.push({ kind: 'too-large', ids: [], describe: `This plan has ${plan.tasks.length.toLocaleString('en')} tasks, past the ${PLAN_LIMITS.tasks.toLocaleString('en')} allowed.`, blocking: true })
  }

  for (const task of plan.tasks) {
    if (byId.has(task.id)) {
      problems.push({ kind: 'duplicate', ids: [task.id], describe: `There are two tasks with the id "${task.id}".`, blocking: true })
    }
    byId.set(task.id, task)
    if (!Number.isFinite(task.duration) || task.duration < 0) {
      problems.push({ kind: 'negative-duration', ids: [task.id], describe: `"${task.title}" has a duration of ${task.duration}. A duration cannot be negative.`, blocking: true })
    }
    if (task.notBefore !== null && task.notAfter !== null && task.notBefore + task.duration > task.notAfter) {
      problems.push({
        kind: 'impossible-window',
        ids: [task.id],
        describe: `"${task.title}" takes ${task.duration} days but its window from ${task.notBefore} to ${task.notAfter} is only ${task.notAfter - task.notBefore} days wide. No schedule fits it.`,
        blocking: true
      })
    }
    if (task.goalId !== null && !plan.goals.some((one) => one.id === task.goalId)) {
      problems.push({ kind: 'orphan-goal', ids: [task.id], describe: `"${task.title}" belongs to goal "${task.goalId}", which is not in the plan.`, blocking: false })
    }
  }

  for (const dependency of plan.dependencies) {
    if (!byId.has(dependency.from) || !byId.has(dependency.to)) {
      problems.push({
        kind: 'missing-task',
        ids: [dependency.from, dependency.to].filter((one) => !byId.has(one)),
        describe: 'A dependency refers to a task that is not in the plan.',
        blocking: true
      })
    }
  }

  const ordered = topologicalOrder(plan)
  if (isPlanError(ordered)) {
    problems.push({ kind: 'cycle', ids: [], describe: ordered.message, blocking: true })
  }

  const milestones = plan.tasks.filter((one) => one.duration === 0).length
  if (milestones > 0) notes.push(`${milestones} task${milestones === 1 ? ' is a' : 's are'} milestone${milestones === 1 ? '' : 's'}: a point in time rather than a stretch of work.`)

  return { ok: !problems.some((one) => one.blocking), problems, notes }
}

/** The order tasks can be scheduled in, or the circular dependency that stops there being one. */
export function topologicalOrder(plan: Plan): string[] | PlanError {
  const byId = new Map(plan.tasks.map((one) => [one.id, one]))
  const incoming = new Map<string, Set<string>>()
  for (const task of plan.tasks) incoming.set(task.id, new Set())
  for (const dependency of plan.dependencies) {
    if (!byId.has(dependency.from) || !byId.has(dependency.to)) continue
    incoming.get(dependency.to)?.add(dependency.from)
  }

  const order: string[] = []
  const done = new Set<string>()
  const ready = plan.tasks.filter((one) => (incoming.get(one.id)?.size ?? 0) === 0).map((one) => one.id).sort()

  while (ready.length > 0) {
    const id = ready.shift() as string
    if (done.has(id)) continue
    done.add(id)
    order.push(id)
    const next: string[] = []
    for (const dependency of plan.dependencies) {
      if (dependency.from !== id) continue
      const set = incoming.get(dependency.to)
      if (!set) continue
      set.delete(id)
      if (set.size === 0 && !done.has(dependency.to)) next.push(dependency.to)
    }
    next.sort()
    ready.push(...next)
  }

  if (order.length !== plan.tasks.length) {
    const stuck = plan.tasks.filter((one) => !done.has(one.id))
    return fail(
      'cycle',
      `These tasks depend on each other in a circle, so none of them can start first: ${stuck.map((one) => one.title).join(', ')}.`
    )
  }
  return order
}

// ---------------------------------------------------------------- scheduling

export interface Scheduled {
  taskId: string
  earliestStart: number
  earliestFinish: number
  latestStart: number
  latestFinish: number
  /** How much this can slip without moving the end of the plan. Zero means it is on the critical path. */
  totalFloat: number
  /** How much it can slip without moving anything that follows it. */
  freeFloat: number
  critical: boolean
  /** The dependency that decided the earliest start, so "why does this start then" has an answer. */
  drivenBy: string | null
}

export interface Schedule {
  tasks: Scheduled[]
  /** Days from the plan's start to its end. */
  duration: number
  /** The longest chain, in order. Delaying any of these delays the whole plan. */
  criticalPath: string[]
  /** Deadlines the schedule does not meet, with how far it misses by. */
  missedDeadlines: { goalId: string; goalTitle: string; deadline: number; finishes: number; lateBy: number }[]
  notes: string[]
}

/**
 * The schedule, by the critical path method.
 *
 * A forward pass gives the earliest each task could start given what it depends on; a backward pass gives the latest
 * it could start without moving the end. The gap is the float, and a task with none is critical. This is the whole
 * value of a dependency graph: it converts "which of these matters" from an opinion into arithmetic.
 *
 * All four dependency kinds are handled, because they mean genuinely different things -- finish-to-start is "after",
 * start-to-start is "not before", and the two finish-aligned kinds are what a review or a handover actually needs.
 */
export function schedule(plan: Plan): Schedule | PlanError {
  const check = checkPlan(plan)
  if (!check.ok) {
    return fail('invalid-plan', `This plan cannot be scheduled: ${check.problems.filter((one) => one.blocking).map((one) => one.describe).join(' ')}`)
  }

  const order = topologicalOrder(plan)
  if (isPlanError(order)) return order

  const byId = new Map(plan.tasks.map((one) => [one.id, one]))
  const earliestStart = new Map<string, number>()
  const earliestFinish = new Map<string, number>()
  const drivenBy = new Map<string, string | null>()

  // Forward pass.
  for (const id of order) {
    const task = byId.get(id)
    if (!task) continue
    let start = task.notBefore ?? 0
    let driver: string | null = null

    for (const dependency of plan.dependencies) {
      if (dependency.to !== id) continue
      const otherStart = earliestStart.get(dependency.from)
      const otherFinish = earliestFinish.get(dependency.from)
      if (otherStart === undefined || otherFinish === undefined) continue

      let required: number
      switch (dependency.kind) {
        case 'finish-to-start':
          required = otherFinish + dependency.lag
          break
        case 'start-to-start':
          required = otherStart + dependency.lag
          break
        case 'finish-to-finish':
          // This one constrains the finish, so the start is the finish minus the duration.
          required = otherFinish + dependency.lag - task.duration
          break
        case 'start-to-finish':
          required = otherStart + dependency.lag - task.duration
          break
      }
      if (required > start) {
        start = required
        driver = dependency.from
      }
    }

    earliestStart.set(id, start)
    earliestFinish.set(id, start + task.duration)
    drivenBy.set(id, driver)
  }

  const duration = Math.max(0, ...[...earliestFinish.values()])

  // Backward pass.
  const latestFinish = new Map<string, number>()
  const latestStart = new Map<string, number>()
  for (const id of [...order].reverse()) {
    const task = byId.get(id)
    if (!task) continue
    let finish = task.notAfter ?? duration

    for (const dependency of plan.dependencies) {
      if (dependency.from !== id) continue
      const otherLatestStart = latestStart.get(dependency.to)
      const otherLatestFinish = latestFinish.get(dependency.to)
      if (otherLatestStart === undefined || otherLatestFinish === undefined) continue

      let allowed: number
      switch (dependency.kind) {
        case 'finish-to-start':
          allowed = otherLatestStart - dependency.lag
          break
        case 'start-to-start':
          allowed = otherLatestStart - dependency.lag + task.duration
          break
        case 'finish-to-finish':
          allowed = otherLatestFinish - dependency.lag
          break
        case 'start-to-finish':
          allowed = otherLatestFinish - dependency.lag + task.duration
          break
      }
      if (allowed < finish) finish = allowed
    }

    latestFinish.set(id, finish)
    latestStart.set(id, finish - task.duration)
  }

  const tasks: Scheduled[] = order.map((id) => {
    const es = earliestStart.get(id) as number
    const ef = earliestFinish.get(id) as number
    const ls = latestStart.get(id) as number
    const lf = latestFinish.get(id) as number

    // Free float: how far this can slip before the earliest of anything that follows has to move.
    let free = Number.POSITIVE_INFINITY
    let hasFollowers = false
    for (const dependency of plan.dependencies) {
      if (dependency.from !== id) continue
      hasFollowers = true
      const followerStart = earliestStart.get(dependency.to)
      if (followerStart === undefined) continue
      free = Math.min(free, followerStart - ef - dependency.lag)
    }

    const totalFloat = ls - es
    return {
      taskId: id,
      earliestStart: es,
      earliestFinish: ef,
      latestStart: ls,
      latestFinish: lf,
      totalFloat,
      freeFloat: hasFollowers && Number.isFinite(free) ? Math.max(0, free) : totalFloat,
      // Within a rounding tolerance: durations can be fractional days.
      critical: Math.abs(totalFloat) < 1e-9,
      drivenBy: drivenBy.get(id) ?? null
    }
  })

  const criticalPath = tasks
    .filter((one) => one.critical)
    .sort((a, b) => a.earliestStart - b.earliestStart)
    .map((one) => one.taskId)

  const finishOf = new Map(tasks.map((one) => [one.taskId, one.earliestFinish]))
  const missedDeadlines: Schedule['missedDeadlines'] = []
  for (const goal of plan.goals) {
    if (goal.deadline === null) continue
    const mine = plan.tasks.filter((one) => one.goalId === goal.id)
    if (mine.length === 0) continue
    const finishes = Math.max(...mine.map((one) => finishOf.get(one.id) ?? 0))
    if (finishes > goal.deadline) {
      missedDeadlines.push({ goalId: goal.id, goalTitle: goal.title, deadline: goal.deadline, finishes, lateBy: finishes - goal.deadline })
    }
  }

  const notes: string[] = [
    `The plan takes ${Number(duration.toPrecision(6))} days. ${criticalPath.length} of ${plan.tasks.length} tasks are on the critical path: delaying any of those delays the whole plan by the same amount, and delaying the others does not.`
  ]
  const slack = tasks.filter((one) => !one.critical && one.totalFloat > 0)
  if (slack.length > 0) {
    const most = slack.sort((a, b) => b.totalFloat - a.totalFloat)[0]
    notes.push(`"${byId.get(most.taskId)?.title}" has ${Number(most.totalFloat.toPrecision(4))} days of float, the most in the plan. It can slip that far before it affects anything.`)
  }
  for (const missed of missedDeadlines) {
    notes.push(`"${missed.goalTitle}" is due on day ${missed.deadline} and finishes on day ${missed.finishes}, ${Number(missed.lateBy.toPrecision(4))} days late.`)
  }

  return { tasks, duration, criticalPath, missedDeadlines, notes }
}

// ---------------------------------------------------------------- resources

export interface Conflict {
  resourceId: string
  resourceName: string
  day: number
  /** How much is needed against how much there is. */
  demanded: number
  capacity: number
  taskIds: string[]
  describe: string
}

/**
 * Where the schedule asks for more of a resource than exists.
 *
 * Checked day by day against the schedule rather than assumed away. The critical path method does not know about
 * resources at all -- it happily schedules one person to do three things at once -- so this is the check that turns
 * an arithmetic schedule into a possible one.
 */
export function resourceConflicts(plan: Plan, computed: Schedule): Conflict[] {
  const byId = new Map(plan.tasks.map((one) => [one.id, one]))
  const resourceById = new Map(plan.resources.map((one) => [one.id, one]))
  const byDay = new Map<string, Map<number, string[]>>()

  for (const scheduled of computed.tasks) {
    const task = byId.get(scheduled.taskId)
    if (!task || task.state === 'done' || task.state === 'cancelled' || task.state === 'skipped') continue
    for (const resourceId of task.resources) {
      const days = byDay.get(resourceId) ?? new Map<number, string[]>()
      // A milestone occupies the single day it falls on; anything else occupies every day it spans.
      const from = Math.floor(scheduled.earliestStart)
      const to = Math.max(from, Math.ceil(scheduled.earliestFinish) - 1)
      for (let day = from; day <= to; day++) {
        const list = days.get(day) ?? []
        list.push(task.id)
        days.set(day, list)
      }
      byDay.set(resourceId, days)
    }
  }

  const conflicts: Conflict[] = []
  for (const [resourceId, days] of byDay) {
    const resource = resourceById.get(resourceId)
    const capacity = resource?.capacity ?? 0
    for (const [day, taskIds] of days) {
      const unavailable = resource?.unavailable.includes(day) ?? false
      const effective = unavailable ? 0 : capacity
      if (taskIds.length <= effective) continue
      conflicts.push({
        resourceId,
        resourceName: resource?.name ?? resourceId,
        day,
        demanded: taskIds.length,
        capacity: effective,
        taskIds: [...taskIds].sort(),
        describe: unavailable
          ? `${resource?.name ?? resourceId} is unavailable on day ${day}, and ${taskIds.length} task${taskIds.length === 1 ? '' : 's'} need it.`
          : `${resource?.name ?? resourceId} is needed by ${taskIds.length} tasks on day ${day} and there ${capacity === 1 ? 'is' : 'are'} ${capacity}. The schedule is arithmetically valid and not actually possible.`
      })
    }
  }

  return conflicts.sort((a, b) => a.day - b.day || a.resourceId.localeCompare(b.resourceId))
}

// ---------------------------------------------------------------- progress

export type ProgressRule = 'by-count' | 'by-duration' | 'by-fraction'

export interface Progress {
  rule: ProgressRule
  fraction: number
  done: number
  total: number
  inProgress: number
  blocked: number
  /** Work remaining, in days, by the rule used. */
  remaining: number
  describe: string
}

/**
 * How far along the plan is, by a stated rule.
 *
 * Three rules because they answer different questions and disagree. Counting tasks treats a five-minute task and a
 * five-week one as equal. Weighting by duration does not, and is usually what people mean. Using each task's own
 * reported fraction is the most detailed and rests on numbers somebody typed. The rule is always reported, because
 * "the project is 60% done" means three different things.
 */
export function progressOf(plan: Plan, rule: ProgressRule = 'by-duration'): Progress {
  const counted = plan.tasks.filter((one) => one.state !== 'cancelled')
  const done = counted.filter((one) => one.state === 'done' || one.state === 'skipped')
  const inProgress = counted.filter((one) => one.state === 'in-progress')
  const blocked = counted.filter((one) => one.state === 'blocked')

  let fraction = 0
  let remaining = 0

  switch (rule) {
    case 'by-count':
      fraction = counted.length === 0 ? 0 : done.length / counted.length
      remaining = counted.length - done.length
      break
    case 'by-duration': {
      const total = counted.reduce((sum, one) => sum + one.duration, 0)
      const finished = done.reduce((sum, one) => sum + one.duration, 0)
      fraction = total === 0 ? (counted.length > 0 && done.length === counted.length ? 1 : 0) : finished / total
      remaining = total - finished
      break
    }
    case 'by-fraction': {
      const total = counted.reduce((sum, one) => sum + one.duration, 0)
      const finished = counted.reduce((sum, one) => {
        if (one.state === 'done' || one.state === 'skipped') return sum + one.duration
        if (one.state === 'in-progress') return sum + one.duration * Math.min(1, Math.max(0, one.fraction))
        return sum
      }, 0)
      fraction = total === 0 ? 0 : finished / total
      remaining = total - finished
      break
    }
  }

  const describeRule =
    rule === 'by-count'
      ? 'counting tasks, which treats a five-minute task and a five-week one as equal'
      : rule === 'by-duration'
        ? 'weighting by duration, so a long task counts for more than a short one'
        : "using each task's own reported fraction, which rests on numbers somebody typed"

  return {
    rule,
    fraction,
    done: done.length,
    total: counted.length,
    inProgress: inProgress.length,
    blocked: blocked.length,
    remaining,
    describe: `${Math.round(fraction * 100)}% by ${describeRule}. ${done.length} of ${counted.length} tasks are finished${blocked.length > 0 ? `, and ${blocked.length} ${blocked.length === 1 ? 'is' : 'are'} blocked` : ''}.`
  }
}

export type Health = 'on-track' | 'at-risk' | 'blocked' | 'overloaded' | 'late' | 'not-started' | 'complete'

export interface HealthReport {
  health: Health
  /** What led to the verdict, each naming what it concerns. */
  reasons: { about: string; describe: string }[]
  describe: string
}

/** The plan's state, from the schedule and the task states rather than from a judgement. */
export function planHealth(plan: Plan, computed: Schedule, conflicts: readonly Conflict[], today: number): HealthReport {
  const reasons: HealthReport['reasons'] = []
  const byId = new Map(plan.tasks.map((one) => [one.id, one]))
  const active = plan.tasks.filter((one) => one.state !== 'cancelled')

  if (active.length === 0) {
    return { health: 'not-started', reasons: [], describe: 'There are no tasks in this plan.' }
  }
  if (active.every((one) => one.state === 'done' || one.state === 'skipped')) {
    return { health: 'complete', reasons: [], describe: 'Every task is finished.' }
  }
  if (active.every((one) => one.state === 'not-started')) {
    return { health: 'not-started', reasons: [], describe: `Nothing has started. The plan runs ${Number(computed.duration.toPrecision(4))} days from its start day.` }
  }

  const blocked = active.filter((one) => one.state === 'blocked')
  for (const task of blocked) reasons.push({ about: task.id, describe: `"${task.title}" is blocked.` })

  // Overdue: a task that should have finished by now and has not.
  const overdue = computed.tasks.filter((one) => {
    const task = byId.get(one.taskId)
    if (!task || task.state === 'done' || task.state === 'skipped' || task.state === 'cancelled') return false
    return one.latestFinish < today
  })
  for (const one of overdue) {
    // Whether an overdue task matters depends entirely on its float, so the two cases are said differently.
    reasons.push({
      about: one.taskId,
      describe: one.critical
        ? `"${byId.get(one.taskId)?.title}" should have finished by day ${one.latestFinish} and has not. It is on the critical path, so the whole plan has moved.`
        : `"${byId.get(one.taskId)?.title}" should have finished by day ${one.latestFinish} and has not. It has ${Number(one.totalFloat.toPrecision(4))} days of float, so the end date has not moved yet.`
    })
  }

  for (const conflict of conflicts.slice(0, 5)) reasons.push({ about: conflict.resourceId, describe: conflict.describe })
  for (const missed of computed.missedDeadlines) {
    reasons.push({ about: missed.goalId, describe: `"${missed.goalTitle}" finishes ${Number(missed.lateBy.toPrecision(4))} days after its deadline.` })
  }

  const health: Health =
    overdue.some((one) => one.critical) || computed.missedDeadlines.length > 0
      ? 'late'
      : blocked.length > 0
        ? 'blocked'
        : conflicts.length > 0
          ? 'overloaded'
          : overdue.length > 0
            ? 'at-risk'
            : 'on-track'

  return {
    health,
    reasons,
    describe:
      health === 'on-track'
        ? 'Nothing is blocked, overdue or over capacity.'
        : health === 'late'
          ? 'The plan will not finish when it was meant to.'
          : health === 'blocked'
            ? `${blocked.length} task${blocked.length === 1 ? ' is' : 's are'} blocked.`
            : health === 'overloaded'
              ? `${conflicts.length} day${conflicts.length === 1 ? '' : 's'} ask for more of a resource than exists.`
              : 'Something is behind, but it has enough float that the end date has not moved.'
  }
}

// ---------------------------------------------------------------- replanning

export interface PlanDifference {
  addedTasks: string[]
  removedTasks: string[]
  changedDurations: { taskId: string; from: number; to: number }[]
  changedDependencies: { describe: string }[]
  /** How the schedule moved. This is what a replan is for. */
  durationChange: number
  criticalPathChanged: boolean
  movedTasks: { taskId: string; from: number; to: number }[]
  describe: string
}

/**
 * Two plans compared, including what happened to the schedule.
 *
 * The critical path changing is reported separately because it is the most consequential difference: it means the
 * tasks that matter are now different ones, and effort aimed at the old path stops helping.
 */
export function comparePlans(before: { plan: Plan; schedule: Schedule }, after: { plan: Plan; schedule: Schedule }): PlanDifference {
  const beforeTasks = new Map(before.plan.tasks.map((one) => [one.id, one]))
  const afterTasks = new Map(after.plan.tasks.map((one) => [one.id, one]))

  const addedTasks = [...afterTasks.keys()].filter((one) => !beforeTasks.has(one))
  const removedTasks = [...beforeTasks.keys()].filter((one) => !afterTasks.has(one))

  const changedDurations: PlanDifference['changedDurations'] = []
  for (const [id, task] of beforeTasks) {
    const other = afterTasks.get(id)
    if (!other || other.duration === task.duration) continue
    changedDurations.push({ taskId: id, from: task.duration, to: other.duration })
  }

  const key = (one: Dependency): string => `${one.from}->${one.to}:${one.kind}+${one.lag}`
  const beforeDeps = new Set(before.plan.dependencies.map(key))
  const afterDeps = new Set(after.plan.dependencies.map(key))
  const changedDependencies = [
    ...[...afterDeps].filter((one) => !beforeDeps.has(one)).map((one) => ({ describe: `added ${one}` })),
    ...[...beforeDeps].filter((one) => !afterDeps.has(one)).map((one) => ({ describe: `removed ${one}` }))
  ]

  const beforeStart = new Map(before.schedule.tasks.map((one) => [one.taskId, one.earliestStart]))
  const movedTasks: PlanDifference['movedTasks'] = []
  for (const one of after.schedule.tasks) {
    const was = beforeStart.get(one.taskId)
    if (was === undefined || was === one.earliestStart) continue
    movedTasks.push({ taskId: one.taskId, from: was, to: one.earliestStart })
  }

  const criticalPathChanged = before.schedule.criticalPath.join('|') !== after.schedule.criticalPath.join('|')
  const durationChange = after.schedule.duration - before.schedule.duration

  return {
    addedTasks,
    removedTasks,
    changedDurations,
    changedDependencies,
    durationChange,
    criticalPathChanged,
    movedTasks,
    describe:
      durationChange === 0 && movedTasks.length === 0
        ? 'The schedule is unchanged.'
        : `The plan is ${durationChange === 0 ? 'the same length' : `${Number(Math.abs(durationChange).toPrecision(4))} days ${durationChange > 0 ? 'longer' : 'shorter'}`}, and ${movedTasks.length} task${movedTasks.length === 1 ? '' : 's'} moved.${criticalPathChanged ? ' The critical path is now through different tasks, so effort aimed at the old one no longer helps the end date.' : ''}`
  }
}

/**
 * What would happen if a task took longer.
 *
 * A what-if, computed by rescheduling rather than estimated. The answer is often "nothing", because a task with float
 * can slip without moving anything -- and knowing which tasks those are is the point of having a schedule.
 */
export function whatIfDelayed(plan: Plan, taskId: string, extraDays: number): { before: Schedule; after: Schedule; difference: PlanDifference } | PlanError {
  const task = plan.tasks.find((one) => one.id === taskId)
  if (!task) return fail('not-found', `There is no task with the id "${taskId}".`)
  if (!Number.isFinite(extraDays)) return fail('invalid-argument', 'The delay has to be a finite number of days.')

  const before = schedule(plan)
  if (isPlanError(before)) return before

  const changed: Plan = {
    ...plan,
    tasks: plan.tasks.map((one) => (one.id === taskId ? { ...one, duration: one.duration + extraDays } : one))
  }
  const after = schedule(changed)
  if (isPlanError(after)) return after

  return { before, after, difference: comparePlans({ plan, schedule: before }, { plan: changed, schedule: after }) }
}

/** The assumptions the Page rests on, for a screen that wants to show them rather than have them inferred. */
export const PLAN_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Dates are derived from durations and dependencies. Nothing is typed in except a genuinely fixed date.',
  'A task is critical when its float is zero, which is computed and not labelled.',
  'The critical path method ignores resources, so resource conflicts are checked separately against the schedule.',
  'Progress is computed from task states by a stated rule, and the rule is always reported because the rules disagree.',
  'A circular dependency is refused before anything is scheduled, because there is no order that satisfies it.',
  'All four dependency kinds are handled, because after, not-before and finish-together mean different things.',
  'A what-if is answered by rescheduling, not by estimating. The answer is often that nothing moves.',
  'The critical path changing is reported separately, because it means different tasks now matter.'
])
