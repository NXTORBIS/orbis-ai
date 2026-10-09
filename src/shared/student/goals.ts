import { dayKey, daysBetween } from './days.ts'
import type { Goal, GoalMilestone, StudentTask, SubjectProgress } from './types.ts'

/**
 * Goals, milestones and tasks.
 *
 * Progress is counted from finished work, never from time spent. A student who sat in front of a chapter for two
 * hours and finished none of it has made no progress on it, and a percentage that said otherwise would be the most
 * demoralising kind of lie -- the flattering one.
 *
 * So: a goal's progress is its milestones; a milestone's progress is its tasks. Nothing here looks at a clock.
 *
 * Pure.
 */

export interface GoalProgress {
  /** 0..1, from milestones finished. */
  through: number
  milestones: number
  milestonesDone: number
  tasks: number
  tasksDone: number
  /** The next thing to do, when there is one. */
  nextMilestone: GoalMilestone | null
  nextTaskId: string | null
  /** Days until the deadline, when there is one. Negative when it has passed. */
  daysLeft: number | null
  /** Said plainly, with the numbers rather than a prediction. */
  note: string
}

export function goalProgress(goal: Goal, tasks: readonly StudentTask[], now: number): GoalProgress {
  const mine = tasks.filter((one) => one.goalId === goal.id && one.state !== 'archived')
  const done = mine.filter((one) => one.state === 'completed')
  const milestonesDone = goal.milestones.filter((one) => one.completedAt !== null).length
  const ordered = [...goal.milestones].sort((a, b) => a.order - b.order)
  const next = ordered.find((one) => one.completedAt === null) ?? null
  const nextTask = next ? mine.find((one) => next.taskIds.includes(one.id) && one.state !== 'completed') : mine.find((one) => one.state !== 'completed')
  const daysLeft = goal.deadline === null ? null : daysBetween(dayKey(now), dayKey(goal.deadline))
  const remaining = mine.length - done.length

  return {
    through: goal.milestones.length > 0 ? milestonesDone / goal.milestones.length : mine.length > 0 ? done.length / mine.length : 0,
    milestones: goal.milestones.length,
    milestonesDone,
    tasks: mine.length,
    tasksDone: done.length,
    nextMilestone: next,
    nextTaskId: nextTask?.id ?? null,
    daysLeft,
    note: noteFor(remaining, daysLeft, milestonesDone, goal.milestones.length)
  }
}

/**
 * What to say about where a goal stands.
 *
 * Deliberately a count and a date, never a verdict. Orbis does not know whether somebody will finish in time, and
 * software that guesses out loud about that is either wrong or frightening.
 */
function noteFor(remaining: number, daysLeft: number | null, done: number, total: number): string {
  if (total > 0 && done === total) return 'Every milestone is done.'
  if (remaining === 0 && total === 0) return 'Nothing added yet.'
  const work = remaining === 1 ? '1 task remaining' : `${remaining} tasks remaining`
  if (daysLeft === null) return total > 0 ? `${done} of ${total} milestones · ${work}` : work
  if (daysLeft < 0) return `${work} · the date has passed`
  if (daysLeft === 0) return `${work} · due today`
  return `${work} before ${daysLeft === 1 ? 'tomorrow' : `${daysLeft} days from now`}`
}

/**
 * The tasks that belong to a milestone.
 *
 * The link is kept in both directions on purpose: a milestone lists its tasks, and a task names its milestone. Either
 * one alone is enough. Reading only the milestone's list meant a task created with a milestone on it was never
 * counted -- the milestone never finished, so the goal never finished either, and nothing said why.
 */
export function tasksOn(milestone: GoalMilestone, tasks: readonly StudentTask[]): StudentTask[] {
  return tasks.filter((one) => one.state !== 'archived' && (milestone.taskIds.includes(one.id) || one.milestoneId === milestone.id))
}

/** Whether every task on a milestone is finished, which is the only thing that completes one. */
export function milestoneDone(milestone: GoalMilestone, tasks: readonly StudentTask[]): boolean {
  const mine = tasksOn(milestone, tasks)
  return mine.length > 0 && mine.every((one) => one.state === 'completed')
}

/**
 * Which tasks come next, and in what order.
 *
 * The order is the whole feature: dated work first, then the current goal, then whatever was ordered by hand. A
 * student who opens the app should not have to decide what to do before they can start.
 */
export function studyQueue(tasks: readonly StudentTask[], now: number, options: { goalId?: string | null; subject?: string | null } = {}): StudentTask[] {
  const today = dayKey(now)
  const open = tasks.filter((one) => one.state === 'planned' || one.state === 'active')
  const rank = (task: StudentTask): number => {
    let score = 0
    if (task.state === 'active') score -= 1000
    if (task.due !== null) {
      const left = daysBetween(today, dayKey(task.due))
      // Overdue and due today come first; something due next month does not jump the queue.
      if (left !== null) score += left <= 0 ? -500 : Math.min(left, 60) * 4
      else score += 200
    } else score += 200
    if (options.goalId && task.goalId === options.goalId) score -= 120
    if (options.subject && task.subject === options.subject) score -= 80
    score += task.priority === 'high' ? -60 : task.priority === 'low' ? 40 : 0
    score += Math.min(task.order, 200) * 0.5
    return score
  }
  return [...open].sort((a, b) => rank(a) - rank(b))
}

/** What is overdue, due today, and due this week. For the dashboard, said as counts rather than alarms. */
export function dueCounts(tasks: readonly StudentTask[], now: number): { overdue: number; today: number; week: number } {
  const key = dayKey(now)
  let overdue = 0
  let today = 0
  let week = 0
  for (const task of tasks) {
    if (task.state === 'completed' || task.state === 'archived' || task.due === null) continue
    const left = daysBetween(key, dayKey(task.due))
    if (left === null) continue
    if (left < 0) overdue += 1
    else if (left === 0) today += 1
    else if (left <= 7) week += 1
  }
  return { overdue, today, week }
}

/**
 * How good a student's time estimates are, from the ones they have actually finished.
 *
 * Used to improve planning rather than to comment on them. Null until there is enough to mean anything -- a ratio
 * from two tasks is noise, and showing it would be inventing a fact.
 */
export function estimateAccuracy(tasks: readonly StudentTask[]): { ratio: number; from: number } | null {
  const done = tasks.filter((one) => one.state === 'completed' && one.estimate !== null && one.estimate > 0 && one.actual > 0)
  if (done.length < 5) return null
  let sum = 0
  for (const task of done) sum += task.actual / (task.estimate as number)
  return { ratio: sum / done.length, from: done.length }
}

/** A plan for a stretch of time: blocks of work with breaks between them. The student edits it before it starts. */
export interface PlanBlock {
  kind: 'focus' | 'break' | 'review'
  minutes: number
  taskId: string | null
  title: string
  subject: string | null
}

/**
 * How to spend the minutes somebody says they have.
 *
 * Takes the queue in order and fills the time, with a break after each block and a short review at the end when
 * there is room. Nothing is started by this -- it returns a plan, which is a different thing from a decision.
 */
export function planTime(minutes: number, queue: readonly StudentTask[], options: { block?: number; breakMinutes?: number } = {}): PlanBlock[] {
  const total = Math.max(10, Math.min(600, Math.round(minutes)))
  const block = Math.max(10, Math.min(90, options.block ?? 50))
  const rest = Math.max(0, Math.min(30, options.breakMinutes ?? 10))
  const out: PlanBlock[] = []
  let left = total
  let index = 0
  while (left >= 10) {
    const task = queue[index]
    // The last block takes whatever is left rather than overrunning, and a review only happens if it fits.
    const length = Math.min(block, left - (left > block + rest + 10 ? rest : 0))
    if (length < 10) break
    out.push({
      kind: 'focus',
      minutes: length,
      taskId: task?.id ?? null,
      title: task?.title ?? 'Study',
      subject: task?.subject ?? null
    })
    left -= length
    index += 1
    if (left >= rest + 10 && rest > 0) {
      out.push({ kind: 'break', minutes: rest, taskId: null, title: 'Break', subject: null })
      left -= rest
    } else if (left >= 10) {
      out.push({ kind: 'review', minutes: Math.min(left, 15), taskId: null, title: 'Review', subject: null })
      left -= Math.min(left, 15)
    }
  }
  return out
}

// ---------------------------------------------------------------- subjects

export function emptySubject(subject: string): SubjectProgress {
  return { subject, xp: 0, sessions: 0, focusedSeconds: 0, tasksCompleted: 0, quizzes: 0, conceptsReviewed: 0, lastStudiedAt: null }
}

export function subjectOf(list: readonly SubjectProgress[], subject: string): SubjectProgress {
  return list.find((one) => one.subject === subject) ?? emptySubject(subject)
}

/** Which subject has had the most focus. Null when there is not enough to compare. */
export function strongestSubject(list: readonly SubjectProgress[]): SubjectProgress | null {
  const real = list.filter((one) => one.focusedSeconds > 600)
  if (real.length < 2) return null
  return [...real].sort((a, b) => b.focusedSeconds - a.focusedSeconds)[0]
}

/** Which subject has been left alone longest, among those being worked on. */
export function neglectedSubject(list: readonly SubjectProgress[], now: number): SubjectProgress | null {
  const real = list.filter((one) => one.sessions > 0 && one.lastStudiedAt !== null)
  if (real.length < 2) return null
  const oldest = [...real].sort((a, b) => (a.lastStudiedAt as number) - (b.lastStudiedAt as number))[0]
  const days = daysBetween(dayKey(oldest.lastStudiedAt as number), dayKey(now)) ?? 0
  return days >= 4 ? oldest : null
}
