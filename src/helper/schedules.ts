import { HelperError } from './server.ts'
import type { TemporalJob } from '../shared/temporal/job.ts'
import { upcomingAcross } from '../shared/temporal/plan.ts'
import { readRequest } from '../shared/temporal/phrase.ts'
import { deviceZone } from '../shared/temporal/zone.ts'

/**
 * Schedules, for the browser.
 *
 * The browser's panel and the Orb reach Orbis through the helper, so this is how they see and make schedules without
 * the chat window being the only place that can. It is the same store, not a second one: two stores would mean two
 * answers to "what is scheduled", and the one somebody happened not to be looking at would be the wrong one.
 *
 * ## What it will not do
 *
 * **Nothing here can switch on keeping Orbis running, or waking the computer.** Those are decisions somebody makes
 * in Settings with the wording in front of them, and a page in a browser changing how a computer behaves is not
 * something to offer over a websocket.
 *
 * **Nothing reads a credential.** A Telegram token lives in the vault and is read only at the moment of sending, by
 * the scheduler, in the other process. Nothing on this side can ask for it.
 *
 * **It never pretends the window is running when it is not.** Every one of these needs the app's store, and without
 * it they refuse with a reason -- because an empty list reads as "you have no schedules", which would be a lie
 * somebody only discovers when a reminder never arrives.
 */

export interface SchedulesHelperDeps {
  all(): Promise<TemporalJob[]>
  add(job: {
    name: string
    said: string
    action: TemporalJob['action']
    schedule: TemporalJob['schedule']
    policies: TemporalJob['policies']
    conditions: readonly TemporalJob['conditions'][number][]
  }): Promise<{ ok: true; job: TemporalJob } | { ok: false; problems: readonly string[] }>
  pause(jobId: string, until: number | null): Promise<TemporalJob | null>
  resume(jobId: string): Promise<TemporalJob | null>
  remove(jobId: string): Promise<boolean>
  skip(jobId: string, dueAt: number): Promise<TemporalJob | null>
  /** Asks the scheduler to look now, so something due in a minute does not wait for the next half-minute pass. */
  look(): void
}

type Handler = (args: unknown[]) => Promise<unknown> | unknown

const text = (value: unknown, cap = 400): string => (typeof value === 'string' ? value.slice(0, cap) : '')
const first = (args: unknown[]): Record<string, unknown> =>
  args[0] && typeof args[0] === 'object' ? (args[0] as Record<string, unknown>) : {}

export function createScheduleHandlers(get: () => SchedulesHelperDeps | null | undefined): Record<string, Handler> {
  /** Read at call time, like the other stores here: the window may start after the browser has. */
  const need = (): SchedulesHelperDeps => {
    const deps = get()
    if (!deps) {
      throw new HelperError('unavailable', 'Orbis is not running, so its schedules cannot be read from here.')
    }
    return deps
  }

  return {
    'schedules:list': async () => ({
      /*
       * Trimmed on the way out.
       *
       * The panel draws a name and a next time; it has no use for every past run, and the history is the part that
       * grows. Sending only what is drawn keeps the message small and means a page in the browser is not holding a
       * copy of everything that has ever happened.
       */
      jobs: (await need().all()).map((job) => ({
        jobId: job.jobId,
        name: job.name,
        said: job.said,
        state: job.state,
        actionKind: job.action.kind,
        nextRunAt: job.nextRunAt,
        lastRunAt: job.lastRunAt,
        runsSoFar: job.runsSoFar,
        timeZone: job.schedule.timeZone,
        lastOutcome: job.history[job.history.length - 1]?.state ?? null
      }))
    }),

    'schedules:upcoming': async (args) => {
      const days = Math.min(Math.max(Number(first(args).days) || 7, 1), 90)
      const now = Date.now()
      return { upcoming: upcomingAcross(await need().all(), now, now + days * 86_400_000) }
    },

    /**
     * Reads a phrase without keeping anything.
     *
     * The same strict reader the rest of Orbis uses, and the same refusals: what Orbis cannot do comes back saying
     * so, and a sentence it could not read comes back with a reason rather than a guess. It does not need the app,
     * so somebody can see what Orbis makes of a sentence with the window closed.
     */
    'schedules:read': (args) => {
      const a = first(args)
      const reading = readRequest(text(a.phrase), Date.now(), text(a.zone) || deviceZone())
      if (!reading.ok) return reading
      return {
        ok: true,
        said: reading.said,
        assumedTime: reading.assumedTime,
        action: reading.action,
        schedule: reading.schedule,
        conditions: reading.conditions
      }
    },

    /**
     * Keeps one, from a sentence.
     *
     * The sentence is read here rather than the browser handing over an action and a rule of its own. That is
     * deliberate: a page cannot ask for a kind of action the reader would never produce, so every schedule that
     * exists came from words somebody can be shown back.
     */
    'schedules:add': async (args) => {
      const a = first(args)
      const deps = need()
      const reading = readRequest(text(a.phrase), Date.now(), text(a.zone) || deviceZone())
      if (!reading.ok) return reading
      const kept = await deps.add({
        name: text(a.name, 120) || reading.said.slice(0, 80),
        said: text(a.phrase),
        action: reading.action,
        schedule: reading.schedule,
        policies: reading.policies,
        conditions: reading.conditions
      })
      if (!kept.ok) return kept
      deps.look()
      return { ok: true, said: reading.said, job: { jobId: kept.job.jobId, name: kept.job.name, nextRunAt: kept.job.nextRunAt } }
    },

    'schedules:pause': async (args) => {
      const a = first(args)
      const until = typeof a.until === 'number' ? a.until : null
      const job = await need().pause(text(a.jobId, 80), until)
      return job ? { ok: true, state: job.state } : { ok: false, problems: ['That schedule no longer exists.'] }
    },

    'schedules:resume': async (args) => {
      const deps = need()
      const job = await deps.resume(text(first(args).jobId, 80))
      deps.look()
      return job ? { ok: true, state: job.state, nextRunAt: job.nextRunAt } : { ok: false, problems: ['That schedule no longer exists.'] }
    },

    'schedules:skip': async (args) => {
      const a = first(args)
      const job = await need().skip(text(a.jobId, 80), Number(a.dueAt))
      return job ? { ok: true } : { ok: false, problems: ['That schedule no longer exists.'] }
    },

    'schedules:remove': async (args) => ({ ok: await need().remove(text(first(args).jobId, 80)) })
  }
}
