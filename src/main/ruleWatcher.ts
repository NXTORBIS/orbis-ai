import type { Readings, StoredRule } from '../shared/rules.ts'
import { considerRule, mayNotify } from '../shared/rules.ts'
import type { NotificationsConfig } from '../shared/experience.ts'

/**
 * The thing that actually watches.
 *
 * `rules.ts` decides whether a rule should speak; this is what asks it, and what it is asked about. The split matters:
 * every decision about nagging, cooldowns and transitions is pure and tested, and this file only supplies readings and
 * carries out the answer.
 *
 * Nothing here invents a reading. `read()` is given by the caller and returns what real systems currently report; a
 * rule watching something nobody reports finds nothing to compare and stays quiet, which is why a rule can never
 * announce something that did not happen.
 */

export interface RuleWatcherOptions {
  /** What is true right now, from real systems. Called on every look; must be cheap. */
  read(): Readings
  /** The rules as stored. */
  rules(): StoredRule[]
  /** The notification settings, so quiet hours and the category switches are honoured here too. */
  notifications(): NotificationsConfig | null
  /** Stores what the rules have learned: what they last saw, and when they last spoke. */
  remember(rules: StoredRule[]): Promise<void> | void
  /** Shows a notification. Returns nothing; a rule is recorded as having spoken because this was called. */
  notify(title: string, body: string): void
  /** How often to look when nothing has told us to. Time-based readings need this; state changes do not. */
  everyMs?: number
}

/** Rarely enough to cost nothing, often enough that a rule about a number is not hours late. */
const DEFAULT_INTERVAL_MS = 30_000

/**
 * Which notification category a rule belongs to.
 *
 * It is the source it watches, so turning "workflows" off in notification settings really turns off the rules about
 * workflows -- rather than rules being a second channel that ignores the settings.
 */
const categoryOf = (rule: StoredRule): string => {
  const test = rule.test as { source?: string }
  return typeof test.source === 'string' ? `${test.source}s` : 'workflows'
}

export class RuleWatcher {
  private readonly o: RuleWatcherOptions
  private timer: ReturnType<typeof setInterval> | null = null
  /** What was true the last time we looked, so a rule can tell a change from a state. */
  private before: Readings = {}
  /** True while a look is in progress, so an event arriving mid-look cannot make two. */
  private looking = false
  /**
   * True until the first look has finished.
   *
   * That look records what every rule finds without saying any of it. Orbis cannot know whether the thing that is
   * already true became true a second ago or a fortnight ago, so announcing it at launch would be announcing
   * something that may be long past -- and would mean every rule fired every time Orbis opened.
   */
  private priming = true
  private stopped = false

  constructor(options: RuleWatcherOptions) {
    this.o = options
  }

  /**
   * Begins watching.
   *
   * It looks once, immediately, and says nothing about what it finds -- so everything already true when Orbis opened
   * is written down rather than announced. Starting Orbis is not a workflow finishing, and a rule should not report,
   * every morning, everything that was already the case last night.
   *
   * Awaiting it means the first real look cannot arrive before that has been recorded. Callers that do not care can
   * leave it; the watcher is correct either way, because the flag is cleared by the look rather than by the clock.
   */
  async start(): Promise<void> {
    if (this.timer || this.stopped) return
    this.priming = true
    this.timer = setInterval(() => void this.look(), this.o.everyMs ?? DEFAULT_INTERVAL_MS)
    // Windows and macOS both keep the process alive for a timer; the watcher should not be the reason Orbis will not quit.
    this.timer.unref?.()
    await this.look()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Looks now.
   *
   * Called by whatever knows something changed -- a workflow finishing, a run being paused -- so a rule about a state
   * answers at the moment it becomes true instead of up to half a minute later. The interval is for readings nothing
   * announces, not the main way this runs.
   */
  async look(): Promise<void> {
    if (this.stopped || this.looking) return
    this.looking = true
    try {
      const now = this.safeRead()
      const before = this.before
      // Recorded before anything is sent, so a notification that throws cannot make the same rule fire again.
      this.before = now

      const rules = this.o.rules()
      if (rules.length === 0) {
        this.priming = false
        return
      }

      // The first look is only a look. Everything a rule found is written down; nothing is said.
      const priming = this.priming
      this.priming = false

      const settings = this.o.notifications()
      const updated: StoredRule[] = []
      const speak: StoredRule[] = []
      let changed = false

      for (const rule of rules) {
        const outcome = considerRule(rule, now, before)
        // Compared by value, not by identity. `considerRule` is pure and hands back a fresh rule every time, so an
        // identity check would be true on every look -- and would mean a disk write and a message to every window
        // every half-minute for rules that had learned nothing.
        if (outcome.rule.lastResult !== rule.lastResult || outcome.rule.lastFiredAt !== rule.lastFiredAt) {
          changed = true
        }
        const silenced = settings !== null && !mayNotify(settings, categoryOf(rule))
        // Kept quiet, but not counted as having spoken: its cooldown has not started, and it will speak the next time
        // it becomes true -- once Orbis has been running, and once the person allows it.
        if (outcome.fire && (priming || silenced)) {
          updated.push({ ...rule, lastResult: outcome.rule.lastResult })
          continue
        }

        updated.push(outcome.rule)
        if (outcome.fire) speak.push(outcome.rule)
      }

      if (changed) await this.o.remember(updated)
      for (const rule of speak) this.o.notify(rule.notify.title || rule.name, rule.notify.body)
    } finally {
      this.looking = false
    }
  }

  /**
   * Reading, without a broken source stopping every rule.
   *
   * If whatever supplies the readings throws, the rules are asked about nothing rather than not asked at all -- which
   * keeps them quiet for one look instead of leaving them stuck with whatever they last saw.
   */
  private safeRead(): Readings {
    try {
      return this.o.read()
    } catch {
      return {}
    }
  }
}

// ---------------------------------------------------------------- what the workflow engine reports

export interface RunLike {
  state: {
    name: string
    status: string
    stepIndex?: number
    stepCount?: number
    waitingFor?: { kind: string }
  }
}

/**
 * The workflow readings, from the runs the engine is actually doing.
 *
 * One workflow at a time is reported -- the one that has got furthest -- because a reading is a single value and
 * "progress" across three simultaneous runs is not a number. `running` is there for the case somebody wants to watch
 * the whole engine rather than a run: it is the only reading here that is about all of them.
 *
 * When nothing is running there are no readings, not readings of zero. That is deliberate: a rule watching for a
 * workflow to fail should not fire because no workflow exists.
 */
export function workflowReadings(runs: RunLike[]): Readings {
  if (runs.length === 0) return {}
  const furthest = runs.reduce((best, run) => (progressOf(run) > progressOf(best) ? run : best), runs[0])
  const s = furthest.state
  return {
    workflow: {
      status: s.status,
      name: s.name,
      progress: progressOf(furthest),
      ...(s.stepIndex === undefined ? {} : { step: s.stepIndex }),
      ...(s.stepCount === undefined ? {} : { steps: s.stepCount }),
      running: runs.length,
      waitingFor: s.waitingFor?.kind ?? ''
    }
  }
}

/** How far through a run is, as a whole percentage. Unknowable without a step count, and 0 then rather than a guess. */
function progressOf(run: RunLike): number {
  const { stepIndex, stepCount } = run.state
  if (!stepCount || stepIndex === undefined) return 0
  return Math.min(100, Math.max(0, Math.round((stepIndex / stepCount) * 100)))
}
