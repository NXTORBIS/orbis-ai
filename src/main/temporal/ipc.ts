import { ipcMain } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { UNSUPPORTED, answerAboutOffline, type DeviceState } from '../../shared/temporal/capability.ts'
import type { JobCondition, JobPolicies, TemporalAction } from '../../shared/temporal/job.ts'
import { occurrencesBetween, type Schedule } from '../../shared/temporal/recurrence.ts'
import { describe, readRequest } from '../../shared/temporal/phrase.ts'
import { deviceZone } from '../../shared/temporal/zone.ts'
import type { TemporalEngine } from './engine.ts'
import { hibernateNow, readPower } from './powerRead.ts'
import type { TemporalStore } from './store.ts'

/**
 * The adapter between schedules and however the application talks to its window.
 *
 * It coerces arguments and delegates, and that is all it does. Every decision about time, every policy and every
 * refusal lives in files with no Electron in them, so the feature travels to Chromium and this one file is rewritten
 * as Mojo.
 */

export interface TemporalIpcOptions {
  store: TemporalStore
  engine: TemporalEngine
  activeProfile: () => string
  device: () => DeviceState
  getWindow(): BrowserWindow | null
  send(channel: string, ...args: unknown[]): void
}

export function registerTemporalIpc(o: TemporalIpcOptions): void {
  // Destructured, not called as `o.handle`, so the channel scanner that checks every channel is documented sees these.
  const handle = (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== o.getWindow()?.webContents) throw new Error('Not allowed.')
      return handler(event, ...args)
    })
  }

  const text = (value: unknown, cap = 400): string => (typeof value === 'string' ? value.slice(0, cap) : '')
  const profile = (): string => o.activeProfile()

  handle('schedules:list', () => o.store.all(profile()))

  handle('schedules:add', async (_e, raw) => {
    const asked = (raw ?? {}) as Record<string, unknown>
    const result = await o.store.add(
      profile(),
      {
        name: text(asked.name, 120),
        said: text(asked.said),
        action: asked.action as TemporalAction,
        schedule: asked.schedule as Schedule,
        policies: (asked.policies ?? undefined) as Partial<JobPolicies> | undefined,
        conditions: (Array.isArray(asked.conditions) ? asked.conditions : []) as JobCondition[],
        startPaused: asked.startPaused === true
      },
      Date.now()
    )
    // Looked at straight away, so something due in a minute does not wait for the next half-minute tick.
    if (result.ok) void o.engine.tick()
    return result
  })

  handle('schedules:update', async (_e, jobId, raw) => {
    const patch = (raw ?? {}) as Record<string, unknown>
    const result = await o.store.update(
      profile(),
      String(jobId),
      {
        ...(patch.name === undefined ? {} : { name: text(patch.name, 120) }),
        ...(patch.action === undefined ? {} : { action: patch.action as TemporalAction }),
        ...(patch.schedule === undefined ? {} : { schedule: patch.schedule as Schedule }),
        ...(patch.conditions === undefined ? {} : { conditions: patch.conditions as JobCondition[] }),
        ...(patch.policies === undefined ? {} : { policies: patch.policies as Partial<JobPolicies> })
      },
      Date.now()
    )
    if (result.ok) void o.engine.tick()
    return result
  })

  handle('schedules:pause', (_e, jobId, until) => o.store.pause(profile(), String(jobId), typeof until === 'number' ? until : null))
  handle('schedules:resume', async (_e, jobId) => {
    const job = await o.store.resume(profile(), String(jobId), Date.now())
    void o.engine.tick()
    return job
  })
  handle('schedules:cancel', (_e, jobId) => o.store.cancel(profile(), String(jobId)))
  handle('schedules:remove', (_e, jobId) => o.store.remove(profile(), String(jobId)))
  handle('schedules:skip-next', (_e, jobId, dueAt) => o.store.skipOccurrence(profile(), String(jobId), Number(dueAt)))

  /** Runs one now, without touching the schedule. For "let me see what this does before I trust it". */
  handle('schedules:run-now', async (_e, jobId) => {
    const job = await o.store.get(profile(), String(jobId))
    if (job === null) return { ok: false, problems: ['That schedule no longer exists.'] }
    await o.store.setState(profile(), job.jobId, 'ready', { nextRunAt: Date.now() })
    await o.engine.tick()
    return { ok: true, job: await o.store.get(profile(), job.jobId) }
  })

  /**
   * Reading a phrase without saving anything.
   *
   * Which is what makes the confirmation possible: somebody sees what Orbis understood, in words, before a schedule
   * exists. Refusals come back with their reason, and the things Orbis cannot do come back saying so.
   */
  handle('schedules:read-phrase', (_e, phrase, zone) => {
    const reading = readRequest(text(phrase), Date.now(), typeof zone === 'string' && zone ? zone : deviceZone())
    if (!reading.ok) return reading
    // The next few occurrences, so "every month on the 31st" can be checked rather than trusted.
    const soon = occurrencesBetween(reading.schedule, Date.now(), Date.now() + 366 * 86_400_000, 5)
    return { ...reading, preview: soon.map((o2) => ({ at: o2.at, resolution: o2.resolution })) }
  })

  /** What a rule will actually do, for a schedule being edited. */
  handle('schedules:preview', (_e, raw, count) => {
    const schedule = raw as Schedule
    const limit = Math.min(Math.max(Number(count) || 5, 1), 50)
    const soon = occurrencesBetween(schedule, Date.now(), Date.now() + 366 * 4 * 86_400_000, limit)
    return { occurrences: soon, said: schedule ? describeSchedule(schedule) : '' }
  })

  /**
   * The honest answer about what Orbis can and cannot promise.
   *
   * One channel, so every screen gives the same answer rather than each writing its own hedge -- and so that adding
   * a capability later means changing one list.
   */
  handle('schedules:capabilities', () => ({
    zone: deviceZone(),
    device: o.device(),
    unsupported: UNSUPPORTED,
    /** True for everything today: there is no Orbis server, so nothing runs with this computer off. */
    needsThisComputer: true
  }))

  handle('schedules:can-run-offline', (_e, action) => answerAboutOffline(action as TemporalAction))

  /**
   * What this computer can be woken from, read from the computer itself.
   *
   * It changes nothing: not a power setting, not a firmware setting. Which settings a computer uses is its owner's
   * business, and a wrong write to a firmware settings area can leave a machine that will not start.
   */
  handle('schedules:power', () => readPower())

  /**
   * Hibernates now, because it was asked for.
   *
   * The same thing the Start menu's Hibernate does. It is offered here because a hibernated computer can be woken
   * for a schedule and a switched-off one cannot -- so this is the one action that turns "my computer was off" into
   * something Orbis can actually do something about.
   */
  handle('schedules:hibernate', () => hibernateNow())
}

/** A schedule in words, for a rule assembled in the editor rather than said in a sentence. */
function describeSchedule(schedule: Schedule): string {
  return describe({ kind: 'notify', message: '' }, schedule).replace(/^Remind you: ?, /, '')
}
