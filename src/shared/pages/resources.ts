/**
 * What a Page is allowed to consume, and who gets it when several want it at once.
 *
 * A Page that reaches nothing outside itself can still make a machine unusable. It can hold the main process in a loop,
 * queue work faster than it can be done, or sit with a gigabyte of table in memory while five other Pages are open. None
 * of that is a permission question -- the Page was allowed to do arithmetic, and arithmetic is what it did.
 *
 * ## Fair, not first
 *
 * The queue here is deliberately not first-in-first-out. A Page that submits two hundred jobs would, under FIFO, make
 * every other Page wait for all two hundred -- which is how one badly-written Page freezes the others while technically
 * behaving. Work is taken round-robin across Pages instead, so a Page submitting more work gets its own work done more
 * slowly and nobody else's slows down at all.
 *
 * ## Pressure is a state, not an error
 *
 * When a machine is short of memory the right response is to do less, not to fail. `pressure` reports how hard things
 * are, and the caller decides what to shed: a lower sampling resolution, a smaller trace, a deferred recalculation. A
 * system that only knows "fine" and "failed" spends its whole time in the first state until it is suddenly in the
 * second.
 *
 * Pure. No timers, no threads: `now` is always passed in, and the caller does the running.
 */

export const RESOURCE_LIMITS = Object.freeze({
  /** Jobs one Page may have queued or running at once. */
  perPage: 16,
  /** Jobs across every Page. */
  total: 200,
  /** How long one job may run before it is abandoned. */
  jobMs: 15_000,
  /** Workers doing jobs at the same time. */
  workers: 4,
  /** How long a finished job's result is kept for collection. */
  resultMs: 60_000
})

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'abandoned' | 'cancelled'

export interface Job {
  id: string
  pageId: string
  operation: string
  /** Higher runs first *within one Page*. It never lets a Page jump ahead of another Page. */
  priority: number
  state: JobState
  queuedAt: number
  startedAt: number | null
  finishedAt: number | null
  /** Why it ended, where that is worth saying. */
  note: string
}

export interface Queue {
  readonly jobs: readonly Job[]
  /** How many of each Page's jobs have been started, used to keep the round-robin honest across submissions. */
  readonly served: Readonly<Record<string, number>>
}

export const emptyQueue: Queue = Object.freeze({ jobs: Object.freeze([]), served: Object.freeze({}) })

export interface QueueError {
  error: 'too-many-for-page' | 'too-many-overall' | 'unknown-job'
  message: string
}

export const isQueueError = (value: unknown): value is QueueError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const active = (job: Job): boolean => job.state === 'queued' || job.state === 'running'

/**
 * A job accepted, or refused with a reason.
 *
 * Refused per Page first and overall second, so the message names the Page's own limit when that is what was hit. "The
 * system is busy" when the truth is "you have sixteen things queued" sends somebody looking in the wrong place.
 */
export function submit(queue: Queue, job: Omit<Job, 'state' | 'startedAt' | 'finishedAt' | 'note'>): Queue | QueueError {
  const mine = queue.jobs.filter((one) => one.pageId === job.pageId && active(one)).length
  if (mine >= RESOURCE_LIMITS.perPage) {
    return {
      error: 'too-many-for-page',
      message: `This Page already has ${mine} jobs waiting or running, which is as many as it may have at once. They will be worked through; nothing is lost.`
    }
  }
  const everything = queue.jobs.filter(active).length
  if (everything >= RESOURCE_LIMITS.total) {
    return {
      error: 'too-many-overall',
      message: 'Orbis has as much work queued as it will take at once. Try again in a moment.'
    }
  }

  return Object.freeze({
    jobs: Object.freeze([
      ...queue.jobs,
      { ...job, state: 'queued' as const, startedAt: null, finishedAt: null, note: '' }
    ]),
    served: queue.served
  })
}

/**
 * The next job to run, chosen fairly.
 *
 * The Page with the fewest jobs started so far goes next. That is what makes a Page submitting two hundred jobs slow
 * only itself down: it gets one turn per round like everybody else, however long its own queue is.
 *
 * Within one Page, priority decides, then age. Between Pages, priority is deliberately ignored -- a Page cannot promote
 * itself past another Page by claiming its own work is urgent.
 */
export function nextJob(queue: Queue, now: number): Job | null {
  const waiting = queue.jobs.filter((one) => one.state === 'queued')
  if (waiting.length === 0) return null
  if (queue.jobs.filter((one) => one.state === 'running').length >= RESOURCE_LIMITS.workers) return null

  const pages = [...new Set(waiting.map((one) => one.pageId))]
  let chosenPage = pages[0]
  let fewest = queue.served[pages[0]] ?? 0
  for (const pageId of pages) {
    const count = queue.served[pageId] ?? 0
    if (count < fewest) {
      fewest = count
      chosenPage = pageId
    }
  }

  const mine = waiting.filter((one) => one.pageId === chosenPage)
  // Priority within the Page, then oldest first, so a tie is resolved by waiting rather than by chance.
  mine.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt)
  void now
  return mine[0] ?? null
}

/** A job marked as running. */
export function start(queue: Queue, jobId: string, now: number): Queue | QueueError {
  const job = queue.jobs.find((one) => one.id === jobId)
  if (job === undefined || job.state !== 'queued') {
    return { error: 'unknown-job', message: 'There is no job waiting with that id.' }
  }
  return Object.freeze({
    jobs: Object.freeze(queue.jobs.map((one) => (one.id === jobId ? { ...one, state: 'running' as const, startedAt: now } : one))),
    served: Object.freeze({ ...queue.served, [job.pageId]: (queue.served[job.pageId] ?? 0) + 1 })
  })
}

/** A job finished, one way or another. */
export function finish(queue: Queue, jobId: string, state: 'done' | 'failed' | 'cancelled', now: number, note = ''): Queue {
  return Object.freeze({
    jobs: Object.freeze(
      queue.jobs.map((one) => (one.id === jobId ? { ...one, state, finishedAt: now, note } : one))
    ),
    served: queue.served
  })
}

/** Every job that has been running longer than it is allowed. */
export const overrunning = (queue: Queue, now: number): Job[] =>
  queue.jobs.filter((one) => one.state === 'running' && one.startedAt !== null && now - one.startedAt > RESOURCE_LIMITS.jobMs)

/**
 * Overrunning jobs abandoned, and old finished ones forgotten.
 *
 * Abandoning says so rather than reporting a failure: a job that ran out of time did not go wrong, it was stopped, and
 * those need different words because they need different responses.
 */
export function sweep(queue: Queue, now: number): { queue: Queue; abandoned: readonly Job[] } {
  const abandoned: Job[] = []
  const jobs = queue.jobs
    .map((one) => {
      if (one.state === 'running' && one.startedAt !== null && now - one.startedAt > RESOURCE_LIMITS.jobMs) {
        const stopped: Job = {
          ...one,
          state: 'abandoned',
          finishedAt: now,
          note: `This ran for longer than the ${RESOURCE_LIMITS.jobMs / 1000} seconds one job is allowed and was stopped. It did not fail; it was cut short.`
        }
        abandoned.push(stopped)
        return stopped
      }
      return one
    })
    // A finished job is kept for a while so its result can be collected, then forgotten.
    .filter((one) => active(one) || one.finishedAt === null || now - one.finishedAt < RESOURCE_LIMITS.resultMs)

  return { queue: Object.freeze({ jobs: Object.freeze(jobs), served: queue.served }), abandoned: Object.freeze(abandoned) }
}

/** Every job belonging to a Page cancelled, for when it closes. */
export function cancelFor(queue: Queue, pageId: string, now: number): Queue {
  return Object.freeze({
    jobs: Object.freeze(
      queue.jobs.map((one) =>
        one.pageId === pageId && active(one)
          ? { ...one, state: 'cancelled' as const, finishedAt: now, note: 'The Page closed.' }
          : one
      )
    ),
    served: queue.served
  })
}

export interface QueueReport {
  queued: number
  running: number
  /** How many Pages are waiting on something. */
  pagesWaiting: number
  /** The longest anything has been waiting, in milliseconds. */
  longestWaitMs: number
  describe: string
}

export function report(queue: Queue, now: number): QueueReport {
  const queued = queue.jobs.filter((one) => one.state === 'queued')
  const running = queue.jobs.filter((one) => one.state === 'running')
  const longest = queued.reduce((most, one) => Math.max(most, now - one.queuedAt), 0)
  const pages = new Set(queued.map((one) => one.pageId)).size

  return {
    queued: queued.length,
    running: running.length,
    pagesWaiting: pages,
    longestWaitMs: longest,
    describe:
      queued.length === 0 && running.length === 0
        ? 'Nothing is waiting.'
        : `${running.length} running, ${queued.length} waiting${pages > 1 ? ` across ${pages} Pages` : ''}. Work is taken in turn, so one busy Page does not hold up the others.`
  }
}

// ---------------------------------------------------------------- memory pressure

export type Pressure = 'comfortable' | 'tight' | 'critical'

export interface PressureInput {
  /** Bytes currently held by Pages, as the caller measures it. */
  used: number
  /** What is available to them in total. */
  available: number
  /** How many Pages are open. */
  pages: number
}

export interface PressureReport {
  level: Pressure
  /** 0 to 1. */
  fraction: number
  /** What to stop doing, in order. Empty when nothing needs to give. */
  shed: readonly string[]
  describe: string
}

/**
 * How much room is left, and what to give up if it is running out.
 *
 * Three levels rather than two, because "do less" and "stop" are different responses and a system with only the second
 * spends all its time in the first state until it suddenly is not. What to shed is returned in order, so a caller gives
 * up the cheapest thing first rather than reaching straight for the biggest.
 */
export function pressure(input: PressureInput): PressureReport {
  const available = Math.max(1, input.available)
  const fraction = Math.min(1, Math.max(0, input.used / available))

  if (fraction < 0.7) {
    return { level: 'comfortable', fraction, shed: Object.freeze([]), describe: 'There is plenty of room.' }
  }
  if (fraction < 0.9) {
    return {
      level: 'tight',
      fraction,
      // Cheapest first: a coarser plot costs somebody very little; discarding their undo history costs a lot.
      shed: Object.freeze([
        'Draw plots with fewer points',
        'Keep shorter traces from simulations',
        'Stop holding results for jobs that have already been collected'
      ]),
      describe: `Pages are using ${Math.round(fraction * 100)}% of the room they have. Doing a little less now avoids having to stop later.`
    }
  }
  return {
    level: 'critical',
    fraction,
    shed: Object.freeze([
      'Draw plots with fewer points',
      'Keep shorter traces from simulations',
      'Stop holding results for jobs that have already been collected',
      'Refuse new work until something finishes',
      'Ask whether Pages that have not been looked at for a while can be closed'
    ]),
    describe: `Pages are using ${Math.round(fraction * 100)}% of the room they have${input.pages > 1 ? ` across ${input.pages} open Pages` : ''}. Something has to give, and closing a Page you are finished with is the cheapest thing to give.`
  }
}

/** How much work is shared out, for a Page that wants to show why it is waiting. */
export const RESOURCE_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Work is taken from each Page in turn, not in the order it arrived. A Page that queues a lot of work slows only itself down.',
  'A Page can mark its own work urgent, and that decides the order within that Page only. It never jumps ahead of another Page.',
  'A job that runs too long is stopped rather than left running. Being stopped and failing are different things and are reported differently.',
  'Running short of memory is a state with degrees, not a failure. Orbis does less before it stops doing anything.',
  'What gets given up under pressure goes cheapest first: a coarser plot before anything you would notice losing.'
])
