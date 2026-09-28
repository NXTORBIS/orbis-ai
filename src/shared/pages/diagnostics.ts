/**
 * When a Page goes wrong: working out whose fault it is, and what can be done without losing anything.
 *
 * Two jobs, and both are really the same one -- telling somebody the truth about a situation they did not ask for.
 *
 * ## Whose fault it is actually matters
 *
 * "Something went wrong" is the least useful sentence software produces, because the four things it can mean need four
 * different responses:
 *
 * ```
 * the Page       its code has a bug            → its author can fix it; you can report it
 * Orbis          the platform failed           → nothing you do will help; it is ours to fix
 * the machine    out of memory, disk, power    → close something, free space
 * the data       the file was not what it said → fix or replace the input
 * ```
 *
 * Telling somebody to check their file when Orbis is broken wastes their afternoon. Telling them Orbis is broken when
 * their CSV has a bad row is worse. So `classify` decides, and says which it is and what follows from it.
 *
 * ## Recovery says what it costs, before it happens
 *
 * Every recovery loses something. A restart loses what was in memory; restoring a checkpoint loses everything since it;
 * resetting loses all of it. The rule here is that the cost is stated **before** the action, in the same sentence as the
 * action, and that a recovery never runs on its own when it would lose work. An app that silently recovers by throwing
 * away an hour of somebody's afternoon has not recovered anything.
 *
 * Pure. No clock, no storage: `now` is always passed in.
 */

export type FaultSource = 'page' | 'orbis' | 'machine' | 'data' | 'unknown'

export const FAULT_SOURCE_LABEL: Readonly<Record<FaultSource, string>> = Object.freeze({
  page: 'this Page',
  orbis: 'Orbis',
  machine: 'this computer',
  data: 'the data it was given',
  unknown: 'something Orbis could not identify'
})

/** What went wrong, as a category rather than a message. Messages are for people; categories are for deciding. */
export type FaultKind =
  | 'script-error'
  | 'startup-failure'
  | 'timed-out'
  | 'out-of-memory'
  | 'crashed'
  | 'policy-violation'
  | 'permission-denied'
  | 'bad-input'
  | 'storage-full'
  | 'storage-unreadable'
  | 'engine-failure'
  | 'unresponsive'

export interface Fault {
  kind: FaultKind
  /** What actually happened, from whatever reported it. Shown, never parsed. */
  detail: string
  at: number
  /** Which Page, where one was involved. */
  pageId?: string
  /** How many times this same kind has happened recently. */
  repeats?: number
}

export interface Diagnosis {
  source: FaultSource
  /** One sentence saying what happened, in words somebody can act on. */
  summary: string
  /** What this means for their work. Whether anything was lost, and what. */
  consequence: string
  /** Whether the person can do anything at all. Saying "no" plainly beats suggesting busywork. */
  actionable: boolean
  /** Ordered, best first. Empty when there is genuinely nothing to try. */
  suggestions: readonly Recovery[]
  /** True when the same thing keeps happening, which changes the advice. */
  recurring: boolean
}

/** What a recovery is, and what it costs. Never one without the other. */
export interface Recovery {
  action: 'reload' | 'restart' | 'restore-checkpoint' | 'reset' | 'reduce-input' | 'grant-permission' | 'report' | 'free-space' | 'wait'
  label: string
  /** What this loses. The empty string only when it genuinely loses nothing. */
  cost: string
  /** Whether Orbis may do this on its own. Only ever true when the cost is nothing. */
  automatic: boolean
}

const reload: Recovery = Object.freeze({
  action: 'reload',
  label: 'Reload the Page',
  cost: 'Anything not saved is lost.',
  automatic: false
})

const restartFree: Recovery = Object.freeze({
  action: 'restart',
  label: 'Start the Page again',
  cost: '',
  // The only automatic recovery there is, and only because nothing had been done yet to lose.
  automatic: true
})

const reportIt: Recovery = Object.freeze({
  action: 'report',
  label: 'Report this',
  cost: '',
  automatic: false
})

/**
 * How many times something has to happen before "try again" stops being honest advice.
 *
 * Three. Once is bad luck, twice is a coincidence, three times means the same thing will happen the fourth time and
 * suggesting a reload is wasting somebody's time.
 */
export const RECURRING_AT = 3

export interface ClassifyInput {
  fault: Fault
  /** Whether there is a checkpoint to go back to. Changes what can honestly be suggested. */
  hasCheckpoint?: boolean
  /** Whether there is unsaved work. Decides whether a recovery may run on its own. */
  hasUnsavedWork?: boolean
  /** Whether the Page ever finished starting. A Page that never started has nothing to lose. */
  everStarted?: boolean
}

/**
 * A fault, classified and turned into advice.
 *
 * The classification is by kind rather than by reading the message, because a message is whatever some library decided
 * to write and matching on its text breaks the first time that library is updated.
 */
export function classify(input: ClassifyInput): Diagnosis {
  const { fault } = input
  const recurring = (fault.repeats ?? 1) >= RECURRING_AT
  const unsaved = input.hasUnsavedWork === true
  const started = input.everStarted !== false

  /** A restart that is safe to run unattended only when there is genuinely nothing to lose. */
  const restart: Recovery = unsaved
    ? { action: 'restart', label: 'Start the Page again', cost: 'Anything not saved is lost.', automatic: false }
    : restartFree

  const checkpoint: Recovery[] = input.hasCheckpoint
    ? [
        {
          action: 'restore-checkpoint',
          label: 'Go back to your last checkpoint',
          cost: 'Everything done since that checkpoint is lost.',
          automatic: false
        }
      ]
    : []

  switch (fault.kind) {
    case 'script-error':
      return {
        source: 'page',
        summary: 'This Page hit an error in its own code.',
        consequence: unsaved
          ? 'Your work is still here, but the Page may not behave correctly until it is reloaded.'
          : 'Nothing was lost.',
        actionable: true,
        recurring,
        suggestions: Object.freeze(
          recurring
            ? [reportIt, ...checkpoint, reload]
            : [reload, ...checkpoint, reportIt]
        )
      }

    case 'startup-failure':
      return {
        source: 'page',
        summary: 'This Page could not start. Its code failed before it ran.',
        // A Page that never started cannot have lost anything, and saying so removes the worry outright.
        consequence: 'Nothing was lost, because the Page never got as far as doing anything.',
        actionable: true,
        recurring,
        suggestions: Object.freeze(recurring ? [reportIt] : [restartFree, reportIt])
      }

    case 'crashed':
      return {
        source: started ? 'page' : 'page',
        summary: 'This Page stopped running unexpectedly.',
        consequence: unsaved
          ? 'Anything not saved since the last save is lost. Orbis saves as you work, so this is usually the last few seconds.'
          : 'Everything was saved, so nothing was lost.',
        actionable: true,
        recurring,
        suggestions: Object.freeze(recurring ? [...checkpoint, reportIt] : [restart, ...checkpoint, reportIt])
      }

    case 'unresponsive':
      return {
        source: 'page',
        summary: 'This Page has stopped responding. It may be in the middle of something very large, or stuck.',
        consequence: 'Nothing is lost yet. Stopping it now loses anything not saved.',
        actionable: true,
        recurring,
        suggestions: Object.freeze([
          { action: 'wait', label: 'Give it a moment longer', cost: '', automatic: false },
          restart,
          ...checkpoint
        ])
      }

    case 'timed-out':
      return {
        source: 'page',
        summary: 'That took longer than Orbis allows one request to take, so it was stopped.',
        consequence: 'Nothing was changed. The request simply did not finish.',
        actionable: true,
        recurring,
        suggestions: Object.freeze([
          {
            action: 'reduce-input',
            label: 'Try it with less data, a smaller range or a coarser step',
            cost: '',
            automatic: false
          }
        ])
      }

    case 'out-of-memory':
      return {
        source: 'machine',
        summary: 'This computer ran out of memory while the Page was working.',
        consequence: unsaved ? 'Anything not saved may be lost.' : 'Nothing was lost.',
        actionable: true,
        recurring,
        suggestions: Object.freeze([
          { action: 'reduce-input', label: 'Try it with less data', cost: '', automatic: false },
          { action: 'free-space', label: 'Close some other windows or applications', cost: '', automatic: false },
          restart
        ])
      }

    case 'storage-full':
      return {
        source: 'machine',
        summary: 'There is no room left to save.',
        // The important part: this is not a "saved!" that quietly did nothing.
        consequence: 'Your work has NOT been saved. It is still on screen, and it will be lost if this Page closes.',
        actionable: true,
        recurring,
        suggestions: Object.freeze([
          { action: 'free-space', label: 'Free up some disk space, then save again', cost: '', automatic: false }
        ])
      }

    case 'storage-unreadable':
      return {
        source: 'data',
        summary: 'What this Page had saved could not be read back.',
        consequence: input.hasCheckpoint
          ? 'The most recent save is unreadable. An earlier checkpoint may still be fine.'
          : 'The most recent save is unreadable, and there is no checkpoint to go back to.',
        actionable: input.hasCheckpoint === true,
        recurring,
        suggestions: Object.freeze(
          input.hasCheckpoint
            ? [...checkpoint, reportIt]
            : [
                {
                  action: 'reset',
                  label: 'Start this Page fresh',
                  cost: 'Everything this Page had saved is lost. This cannot be undone.',
                  automatic: false
                },
                reportIt
              ]
        )
      }

    case 'permission-denied':
      return {
        source: 'page',
        summary: 'This Page tried to do something it has not been allowed to do.',
        consequence: 'Nothing happened, and nothing was lost.',
        actionable: true,
        recurring,
        suggestions: Object.freeze([
          {
            action: 'grant-permission',
            label: 'Look at what it is asking for',
            cost: '',
            automatic: false
          }
        ])
      }

    case 'policy-violation':
      return {
        source: 'page',
        summary: 'This Page tried to do something Pages are not allowed to do, and was stopped.',
        // Not a permission that could be granted: this is outside what any Page may do, at any trust level.
        consequence: 'Nothing happened. This is not something that can be turned on; no Page is allowed it.',
        actionable: true,
        recurring,
        suggestions: Object.freeze([reportIt])
      }

    case 'bad-input':
      return {
        source: 'data',
        summary: 'The information given to this Page was not what it needed.',
        consequence: 'Nothing was changed.',
        actionable: true,
        recurring,
        suggestions: Object.freeze([
          { action: 'reduce-input', label: 'Check the values and try again', cost: '', automatic: false }
        ])
      }

    case 'engine-failure':
      return {
        source: 'orbis',
        summary: 'Something inside Orbis failed while doing this.',
        consequence: 'Nothing was changed. This is not something you did.',
        // Said plainly rather than dressed up as something to try: nothing the person does will help.
        actionable: false,
        recurring,
        suggestions: Object.freeze([reportIt])
      }

    default:
      return {
        source: 'unknown',
        summary: 'Something went wrong, and Orbis could not work out what.',
        consequence: unsaved ? 'Anything not saved may be lost.' : 'Nothing appears to have been lost.',
        actionable: false,
        recurring,
        suggestions: Object.freeze([reportIt])
      }
  }
}

/**
 * The advice, written out, with its recurrence taken into account.
 *
 * A recurring fault gets a different sentence, because "try again" said for the fourth time is not advice, it is an app
 * that has not noticed.
 */
export function adviseFor(diagnosis: Diagnosis, fault: Fault): string[] {
  const lines = [diagnosis.summary, diagnosis.consequence]
  if (diagnosis.recurring) {
    lines.push(
      `This has now happened ${fault.repeats ?? RECURRING_AT} times. It is going to keep happening, so trying the same thing again is not worth your time.`
    )
  }
  if (!diagnosis.actionable && diagnosis.source === 'orbis') {
    lines.push('There is nothing you can do about this one. It is ours to fix.')
  }
  for (const suggestion of diagnosis.suggestions) {
    lines.push(suggestion.cost === '' ? suggestion.label : `${suggestion.label} — ${suggestion.cost}`)
  }
  return lines
}

/** Whether Orbis may carry out a recovery without asking. Only ever when it costs nothing. */
export const mayRunUnattended = (recovery: Recovery): boolean => recovery.automatic && recovery.cost === ''

// ---------------------------------------------------------------- crash loops

export interface RestartRecord {
  /** When each restart happened, newest last. */
  at: readonly number[]
}

export const noRestarts: RestartRecord = Object.freeze({ at: Object.freeze([]) })

export const RESTART_WINDOW_MS = 60_000
export const RESTARTS_ALLOWED = 3

export interface RestartDecision {
  allowed: boolean
  because: string
  /** How long to wait before trying again, when waiting would help. Null when it would not. */
  waitMs: number | null
}

/**
 * Whether a Page should be started again.
 *
 * A Page that crashes on startup will crash again, so restarting it in a loop burns the battery and fills the log while
 * looking, from outside, exactly like an app that is trying. After a few attempts in a short window this says no and
 * says why, which is more useful than a spinner that never resolves.
 */
export function mayRestart(record: RestartRecord, now: number): RestartDecision {
  const recent = record.at.filter((at) => now - at < RESTART_WINDOW_MS)
  if (recent.length < RESTARTS_ALLOWED) {
    return {
      allowed: true,
      because: recent.length === 0 ? 'This is the first attempt.' : `This is attempt ${recent.length + 1}.`,
      waitMs: null
    }
  }
  const oldest = Math.min(...recent)
  const waitMs = Math.max(0, RESTART_WINDOW_MS - (now - oldest))
  return {
    allowed: false,
    because: `This Page has been started ${recent.length} times in the last minute and has failed each time. Starting it again now would only fail again.`,
    waitMs
  }
}

export const recordRestart = (record: RestartRecord, now: number): RestartRecord =>
  Object.freeze({ at: Object.freeze([...record.at.filter((at) => now - at < RESTART_WINDOW_MS * 10), now]) })

// ---------------------------------------------------------------- health

export interface HealthInput {
  pageId: string
  running: boolean
  faults: readonly Fault[]
  /** Fraction of its request budget in use, from 0 to 1. */
  load: number
  /** Whether everything is saved. */
  saved: boolean
  now: number
}

export interface HealthReport {
  /** `well`, `strained` or `unwell`. Three, because two is not enough to say "working but struggling". */
  state: 'well' | 'strained' | 'unwell'
  headline: string
  details: readonly string[]
  /** Faults grouped by kind with counts, so a log of two hundred entries becomes three lines. */
  recent: readonly { kind: FaultKind; count: number; latest: string }[]
}

/**
 * How a Page is doing, in words.
 *
 * Faults are grouped by kind rather than listed, because two hundred identical errors are one problem and printing them
 * all buries the second, different one that actually matters.
 */
export function healthOf(input: HealthInput): HealthReport {
  const recentFaults = input.faults.filter((one) => input.now - one.at < 5 * 60_000)

  const grouped = new Map<FaultKind, { count: number; latest: string; at: number }>()
  for (const fault of recentFaults) {
    const existing = grouped.get(fault.kind)
    if (existing === undefined || fault.at >= existing.at) {
      grouped.set(fault.kind, { count: (existing?.count ?? 0) + 1, latest: fault.detail, at: fault.at })
    } else {
      existing.count += 1
    }
  }
  const recent = [...grouped.entries()]
    .map(([kind, one]) => ({ kind, count: one.count, latest: one.latest }))
    .sort((a, b) => b.count - a.count)

  const details: string[] = []
  let state: HealthReport['state'] = 'well'
  let headline = 'Working normally.'

  if (!input.running) {
    state = 'unwell'
    headline = 'This Page is not running.'
  } else if (recentFaults.length >= RECURRING_AT) {
    state = 'unwell'
    headline = `This Page has had ${recentFaults.length} problems in the last few minutes.`
  } else if (recentFaults.length > 0 || input.load > 0.8) {
    state = 'strained'
    headline = recentFaults.length > 0 ? 'This Page has had a problem recently.' : 'This Page is working hard.'
  }

  if (input.load > 0.8 && input.running) {
    details.push(`It is using ${Math.round(input.load * 100)}% of the requests it is allowed, so it may start being slowed down.`)
  }
  if (!input.saved) {
    // Said whatever the state is: unsaved work is the thing somebody wants to know about a Page that is misbehaving.
    details.push('There are unsaved changes.')
  }
  for (const group of recent.slice(0, 3)) {
    details.push(group.count === 1 ? group.latest : `${group.latest} (${group.count} times)`)
  }
  if (recent.length > 3) {
    details.push(`And ${recent.length - 3} other kinds of problem.`)
  }

  return { state, headline, details: Object.freeze(details), recent: Object.freeze(recent) }
}

/** How faults are handled here, for a Page's own diagnostics panel. */
export const DIAGNOSTIC_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Every problem says whose it is: the Page, Orbis, this computer, or the data. Being told to check your file when Orbis is broken wastes your time.',
  'Every recovery says what it costs before you choose it, and Orbis only ever does one on its own when it costs nothing.',
  'When there is nothing you can do, Orbis says so rather than suggesting something that will not help.',
  'A Page that keeps failing the same way is not restarted over and over. After a few attempts Orbis stops and says why.',
  'When saving fails, Orbis says your work is not saved. It never reports a save that did not happen.',
  'Repeated identical problems are grouped, so one problem does not bury a different one underneath it.'
])
