/**
 * One place things are announced, so subsystems can stop knowing about each other.
 *
 * Today a tab closing reaches whatever needs to know through whatever wire happened to exist: a direct call, an IPC
 * channel named for its one listener, a callback passed down three constructors. Each is fine alone, and together they
 * are why adding a feature that cares about tabs means finding every place tabs change and editing it.
 *
 * This is the shared bus (§3). What it deliberately is *not* is a second source of truth: an event says something
 * happened, it does not say what is. Anything needing current state asks the thing that owns it. A bus that also
 * remembers is a cache nobody invalidates.
 *
 * Four things it does that a plain emitter does not, because each has bitten somebody:
 *
 *   - **A listener that throws cannot stop the others.** One broken subscriber taking down tab tracking is not a
 *     trade worth making, so a throw is caught, reported and stepped over.
 *   - **Correlation.** Events carry the id of the thing that caused them, so a workflow's tab, its download and its
 *     failure can be told apart from another workflow's.
 *   - **Profiles.** An event is stamped with the profile it happened in, and a listener scoped to one never sees
 *     another's. Profile isolation that depends on every listener remembering to check is not isolation.
 *   - **Throttling and debouncing per subscription**, because the rate an event happens at and the rate a subscriber
 *     wants it at are different questions.
 */

export type OrbisEventName =
  // browser
  | 'tab.created' | 'tab.closed' | 'tab.activated' | 'tab.navigated' | 'tab.moved'
  | 'page.loaded' | 'page.changed'
  | 'download.started' | 'download.completed' | 'download.failed'
  | 'permission.requested' | 'permission.changed'
  | 'extension.changed'
  /** A page is asking somebody to prove they are a person, and a run has stopped to wait for them. */
  | 'captcha.required'
  /** A run has stopped and will not go on until somebody answers it. */
  | 'browser.attention'
  /** An Orbis Page has been built, checked and published -- not merely written. */
  | 'orbisPage.ready'
  // intelligence
  | 'orion.started' | 'orion.completed'
  | 'search.completed'
  | 'research.started' | 'research.completed' | 'research.failed'
  | 'vision.completed'
  | 'voice.started' | 'voice.completed'
  // work
  | 'workflow.started' | 'workflow.completed' | 'workflow.failed' | 'workflow.queued'
  | 'task.created' | 'task.due'
  | 'reminder.triggered'
  // study
  /*
   * Orbis Student.
   *
   * These are what connects the subsystems: quests, achievements, streaks, insights and Orbi all listen rather than
   * being called. A completed session publishes once, and five things happen -- which is why the same achievement
   * cannot be unlocked twice by two different code paths.
   */
  | 'focus.started' | 'focus.milestone' | 'focus.paused' | 'focus.resumed'
  | 'focus.break.started' | 'focus.break.completed'
  | 'focus.completed' | 'focus.endedEarly' | 'focus.interrupted' | 'focus.restored'
  | 'focus.distraction' | 'focus.saved'
  | 'study.task.completed' | 'study.goal.completed' | 'study.milestone.completed'
  | 'study.xp' | 'study.level' | 'study.achievement' | 'study.quest'
  /** Exam mode on or off: a deliberate change of behaviour, so it is announced like one. */
  | 'study.examMode'
  /** A question written by Orion that the student said was wrong. Worth knowing how often that happens. */
  | 'study.questionRejected'
  | 'study.learning.completed'
  // places and people
  | 'workspace.changed' | 'profile.changed'
  | 'security.event'

export interface OrbisEvent<T = unknown> {
  name: OrbisEventName
  at: number
  /** Which subsystem announced it. For diagnosis, never for authority. */
  source: string
  /** The profile it happened in. A listener scoped elsewhere never sees it. */
  profileId?: string
  /** The workspace, when it happened inside one. */
  workspaceId?: string
  /** Ties together everything one request caused, so two concurrent runs can be told apart. */
  correlationId?: string
  /** The event that caused this one, for following a chain backwards. */
  causedBy?: string
  /** A stable id for this event. */
  id: string
  detail: T
}

export interface Subscription {
  /** Only these events. Omit for all of them. */
  names?: OrbisEventName[]
  /** Only this profile's events. Omit to see every profile's -- which almost nothing should do. */
  profileId?: string
  /** Only events tied to this request. */
  correlationId?: string
  /** Stop after the first matching event. */
  once?: boolean
  /** At most one delivery per this many ms, dropping what arrives between. For counters and progress. */
  throttleMs?: number
  /** Deliver only after this quiet period, keeping the last. For "the page settled". */
  debounceMs?: number
  /** Higher runs first. For the rare listener that must see an event before the others. */
  priority?: number
}

type Listener<T = unknown> = (event: OrbisEvent<T>) => void

interface Entry {
  id: number
  subscription: Subscription
  listener: Listener
  /**
   * When this subscription last received something, for throttling.
   *
   * Starts at negative infinity rather than zero so the *first* event always gets through. Zero works by accident
   * with a wall clock, where the difference from the epoch is enormous, and fails the moment time starts anywhere
   * else -- which is exactly what a test does.
   */
  lastAt: number
  timer: ReturnType<typeof setTimeout> | null
  pending: OrbisEvent | null
}

let nextId = 0

export interface OrbisBus {
  publish<T>(name: OrbisEventName, detail: T, meta?: Omit<Partial<OrbisEvent>, 'name' | 'detail'>): OrbisEvent<T>
  subscribe<T>(subscription: Subscription, listener: Listener<T>): () => void
  /** Everything published recently, newest last. For diagnosis: bounded, and never the source of truth. */
  recent(limit?: number): OrbisEvent[]
  /** How many listeners are attached, so a leak is visible rather than merely slow. */
  listenerCount(): number
}

/**
 * Makes a bus.
 *
 * `onListenerError` is how a broken subscriber is reported. It is a parameter rather than a console call because the
 * bus is used in the main process, the helper and the renderer, and each has its own idea of where a problem goes.
 */
export function createBus(options: { now?: () => number; onListenerError?: (error: unknown, event: OrbisEvent) => void; keep?: number } = {}): OrbisBus {
  const now = options.now ?? Date.now
  const keep = options.keep ?? 200
  const entries: Entry[] = []
  const history: OrbisEvent[] = []

  const matches = (subscription: Subscription, event: OrbisEvent): boolean => {
    if (subscription.names && !subscription.names.includes(event.name)) return false
    // A subscription scoped to a profile never sees another's, whatever the listener does or forgets to do.
    if (subscription.profileId !== undefined && event.profileId !== undefined && subscription.profileId !== event.profileId) return false
    if (subscription.correlationId !== undefined && subscription.correlationId !== event.correlationId) return false
    return true
  }

  const deliver = (entry: Entry, event: OrbisEvent): void => {
    try {
      entry.listener(event)
    } catch (error) {
      // One broken subscriber must not stop the rest: the others are how the browser keeps working.
      options.onListenerError?.(error, event)
    }
    if (entry.subscription.once) remove(entry.id)
  }

  const remove = (id: number): void => {
    const at = entries.findIndex((e) => e.id === id)
    if (at < 0) return
    const [gone] = entries.splice(at, 1)
    if (gone.timer) clearTimeout(gone.timer)
  }

  return {
    publish(name, detail, meta = {}) {
      const event: OrbisEvent = {
        id: `e${(nextId += 1).toString(36)}`,
        name,
        at: meta.at ?? now(),
        source: meta.source ?? 'orbis',
        ...(meta.profileId !== undefined ? { profileId: meta.profileId } : {}),
        ...(meta.workspaceId !== undefined ? { workspaceId: meta.workspaceId } : {}),
        ...(meta.correlationId !== undefined ? { correlationId: meta.correlationId } : {}),
        ...(meta.causedBy !== undefined ? { causedBy: meta.causedBy } : {}),
        detail
      }

      history.push(event)
      if (history.length > keep) history.splice(0, history.length - keep)

      // A copy, because a listener that unsubscribes mid-delivery must not shorten the list being walked.
      for (const entry of [...entries].sort((a, b) => (b.subscription.priority ?? 0) - (a.subscription.priority ?? 0))) {
        if (!matches(entry.subscription, event)) continue

        const { throttleMs, debounceMs } = entry.subscription
        if (debounceMs) {
          // Keep the newest and wait for quiet: what a subscriber wants when the question is "has it settled".
          entry.pending = event
          if (entry.timer) clearTimeout(entry.timer)
          entry.timer = setTimeout(() => {
            entry.timer = null
            const held = entry.pending
            entry.pending = null
            if (held) deliver(entry, held)
          }, debounceMs)
          continue
        }
        if (throttleMs) {
          if (now() - entry.lastAt < throttleMs) continue
          entry.lastAt = now()
        }
        deliver(entry, event)
      }
      return event as OrbisEvent<typeof detail>
    },

    subscribe(subscription, listener) {
      const entry: Entry = { id: (nextId += 1), subscription, listener: listener as Listener, lastAt: Number.NEGATIVE_INFINITY, timer: null, pending: null }
      entries.push(entry)
      return () => remove(entry.id)
    },

    recent(limit = 50) {
      return history.slice(-limit)
    },

    listenerCount() {
      return entries.length
    }
  }
}

/** Ties together everything one request causes, so a run's events can be followed and two runs told apart. */
export const newCorrelationId = (prefix = 'c'): string => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
