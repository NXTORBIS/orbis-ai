import { AmbientStore, type AmbientSettings, type SessionMemory } from './store.ts'
import { toActivity, type Activity, type RawActivity } from '../../shared/ambient/activity.ts'
import { cluster, correct, dominant, shouldShow, summarise, type AmbientContext } from '../../shared/ambient/context.ts'
import { decide, answered as recordAnswer, shown as recordShown, NOTHING, type Moment, type Situation, type Suggestion, type SuggestionKind } from '../../shared/ambient/suggest.ts'
import { keywordsOf } from '../../shared/ambient/topics.ts'

/**
 * Ambient Intelligence, running.
 *
 * ## It listens; it is not called
 *
 * Everything that happens in Orbis already announces itself on the existing event bus. This subscribes, writes
 * down the few kinds worth remembering, and works out what they add up to. Nothing else in Orbis has to know this
 * exists — which is the only way a layer like this can be added to a product this size without a hundred edits.
 *
 * ## The expensive part never blocks anything
 *
 * Recording is a write and nothing more. The thinking — clustering, subjects, intent — happens on a timer, on
 * whatever has been recorded, and its answer is cached. Asking "what am I doing" is reading a variable. Nothing
 * waits for analysis, which is why this cannot make a browser feel heavy.
 *
 * ## Off means off
 *
 * Disabled, nothing is recorded at all. Paused, what is already known stays but nothing new is learned and
 * nothing is suggested. Both are checked at the door, in `record`, so there is one place to get right.
 */

export interface AmbientDeps {
  store: AmbientStore
  now(): number
  /** The subject of a running Focus session, when there is one. The strongest signal Ambient Intelligence gets. */
  focusSubject(): string | null
  /** Whether a session is running, and whether it is locked. Decides whether anything may interrupt. */
  focusState(): { running: boolean; locked: boolean }
  /** Whether somebody is mid-sentence. */
  typing(): boolean
  /** Whether the rest of Orbis has already decided this is a quiet time. */
  quiet(): boolean
  /** Files of theirs, for "you have a note about this". Names only; nothing reads a file here. */
  files?(): Promise<readonly { id: string; name: string }[]>
  /** Tells whoever is listening that the context changed, so a chip can redraw without asking. */
  announce(context: AmbientContext | null): void
}

/** How often the thinking runs. Often enough to keep up, rarely enough to be free. */
const THINK_EVERY = 20_000
/** How far back a single piece of current work can reach. */
const WINDOW = 3 * 3_600_000

export class Ambient {
  private readonly o: AmbientDeps
  private contexts: AmbientContext[] = []
  private current: AmbientContext | null = null
  /** Corrections, by context id, so a correction survives the next pass that rebuilds the context. */
  private readonly corrections = new Map<string, { subject: string | null; concept: string | null; wrong: boolean }>()
  private thinking: ReturnType<typeof setInterval> | null = null
  private lastThought = 0
  private counter = 0
  private lastSweep = 0

  constructor(o: AmbientDeps) {
    this.o = o
  }

  start(): void {
    if (this.thinking) return
    this.thinking = setInterval(() => void this.think().catch(() => undefined), THINK_EVERY)
    // Unref'd where the runtime allows it: this must never be the reason a process stays alive.
    ;(this.thinking as { unref?: () => void }).unref?.()
    void this.o.store.sweep(this.o.now()).catch(() => undefined)
  }

  stop(): void {
    if (!this.thinking) return
    clearInterval(this.thinking)
    this.thinking = null
  }

  private id(prefix: string): string {
    this.counter += 1
    return `${prefix}-${this.o.now().toString(36)}-${this.counter.toString(36)}`
  }

  /**
   * Something happened.
   *
   * The one door in. Returns whether it was written down, so a caller can tell the difference between "recorded"
   * and "refused" — which matters for the privacy tests and for nothing else.
   */
  async record(raw: RawActivity): Promise<boolean> {
    const settings = await this.o.store.settings()
    if (!settings.enabled || settings.paused) return false
    const one = toActivity(raw, this.o.store.profile, this.o.now(), this.id('act'))
    if (!one) return false
    await this.o.store.add(one)

    // Swept at most once a day, on the back of a write, so it happens on machines that are never left open.
    const now = this.o.now()
    if (now - this.lastSweep > 86_400_000) {
      this.lastSweep = now
      void this.o.store.sweep(now).catch(() => undefined)
    }
    return true
  }

  /**
   * What everything recorded lately adds up to.
   *
   * The expensive pass, and the only one. Everything else reads what this leaves behind.
   */
  async think(): Promise<AmbientContext | null> {
    const settings = await this.o.store.settings()
    if (!settings.enabled || settings.paused) {
      this.contexts = []
      this.current = null
      return null
    }
    const now = this.o.now()
    const rows = await this.o.store.since(now - WINDOW, 400)
    const made = cluster(rows, { now, profileId: this.o.store.profile, focusSubject: this.o.focusSubject() })

    // Corrections are applied after the rebuild, so being told "this is Chemistry" survives the next pass.
    this.contexts = made.map((one) => {
      const fix = this.corrections.get(one.id)
      return fix ? correct(one, fix) : one
    })
    this.current = dominant(this.contexts, now)
    this.lastThought = now
    this.o.announce(shouldShow(this.current) ? this.current : null)
    return this.current
  }

  /**
   * What somebody is doing, answered immediately.
   *
   * Never waits for the thinking: a question about context that takes a second to answer is a question nothing
   * will bother asking. If the cached answer is stale a fresh pass is kicked off, and the stale one is returned.
   */
  currentContext(): AmbientContext | null {
    if (this.o.now() - this.lastThought > THINK_EVERY * 2) void this.think().catch(() => undefined)
    return shouldShow(this.current) ? this.current : null
  }

  all(): AmbientContext[] {
    return [...this.contexts]
  }

  /** Everything known about the current context, for the popover and the inspector. */
  async detail(): Promise<{ context: AmbientContext | null; related: SessionMemory[]; says: string } | null> {
    const one = this.currentContext()
    if (!one) return null
    const sessions = await this.o.store.sessionList()
    const related = sessions.filter((two) => !two.rejected && two.subject && two.subject === one.subject).slice(0, 4)
    return { context: one, related, says: summarise(one) }
  }

  /** Somebody saying what this is, or that it is not what Orbis thought. */
  async correctCurrent(change: { subject?: string | null; concept?: string | null; wrong?: boolean }): Promise<AmbientContext | null> {
    const one = this.current
    if (!one) return null
    this.corrections.set(one.id, {
      subject: change.subject ?? null,
      concept: change.concept ?? null,
      wrong: change.wrong === true
    })
    const fixed = correct(one, change)
    this.contexts = this.contexts.map((two) => (two.id === one.id ? fixed : two))
    this.current = fixed
    this.o.announce(shouldShow(fixed) ? fixed : null)
    return fixed
  }

  // ---------------------------------------------------------------- remembering a stretch of work

  /**
   * A context written down so it outlives its rows.
   *
   * Called when a piece of work goes quiet. Only what is worth keeping: a title, a subject, counts and the
   * places, so it can be offered back later without having kept a month of raw activity to do it.
   */
  async remember(one: AmbientContext): Promise<SessionMemory | null> {
    const settings = await this.o.store.settings()
    if (!settings.sessionMemory) return null
    if (!shouldShow(one)) return null
    const rows = await this.o.store.since(one.startedAt - 1000, 400)
    const mine = rows.filter((two) => one.activityIds.includes(two.id))
    const places = [...new Set(mine.map((two) => two.url).filter((two): two is string => !!two))].slice(0, 12)
    return this.o.store.keepSession({
      id: one.id,
      profileId: this.o.store.profile,
      title: one.title,
      subject: one.subject,
      concept: one.concept,
      intent: one.intent,
      startedAt: one.startedAt,
      endedAt: one.lastAt,
      seconds: one.seconds,
      things: one.activityIds.length,
      places,
      rejected: false
    })
  }

  /** Anything that has gone dormant is written down, so closing Orbis does not lose the day. */
  async rememberDormant(): Promise<number> {
    let kept = 0
    for (const one of this.contexts) {
      if (one.state === 'dormant' && (await this.remember(one))) kept += 1
    }
    return kept
  }

  /**
   * Something worth picking up again.
   *
   * Deliberately strict: it must have had real time put into it, it must not be what somebody is already doing,
   * and it must not be something they said was wrong. The offer is only worth making when the answer is obviously
   * yes.
   */
  async unfinished(): Promise<(SessionMemory & { daysAgo: number }) | null> {
    const settings = await this.o.store.settings()
    if (!settings.continueWhereLeftOff) return null
    const now = this.o.now()
    const sessions = await this.o.store.sessionList()
    const current = this.current
    const candidates = sessions
      .filter((one) => !one.rejected)
      .filter((one) => one.seconds >= 300 && one.things >= 3)
      .filter((one) => now - one.endedAt > 2 * 3_600_000 && now - one.endedAt < 14 * 86_400_000)
      .filter((one) => !current || one.subject !== current.subject)
    const best = candidates[0]
    if (!best) return null
    return { ...best, daysAgo: Math.floor((now - best.endedAt) / 86_400_000) }
  }

  // ---------------------------------------------------------------- saying something, rarely

  /** The one thing worth saying now, or nothing. Everything about when not to speak lives in `suggest.ts`. */
  async suggestion(options: { busy?: boolean } = {}): Promise<Suggestion> {
    const settings = await this.o.store.settings()
    if (!settings.enabled || settings.paused || !settings.suggestions) {
      return { ...NOTHING, because: 'suggestions are switched off' }
    }
    const focus = this.o.focusState()
    const moment: Moment = {
      now: this.o.now(),
      typing: this.o.typing(),
      focused: focus.running,
      locked: focus.locked,
      paused: settings.paused,
      quiet: this.o.quiet(),
      busy: options.busy === true
    }
    const history = await this.o.store.history()
    const current = this.currentContext()

    const unfinishedSession = await this.unfinished()
    const unfinished = unfinishedSession
      ? {
          id: unfinishedSession.id,
          profileId: unfinishedSession.profileId,
          title: unfinishedSession.title,
          subject: unfinishedSession.subject,
          concept: unfinishedSession.concept,
          intent: 'studying' as const,
          confidence: 0.9,
          band: 'certain' as const,
          entities: [],
          activityIds: [],
          startedAt: unfinishedSession.startedAt,
          lastAt: unfinishedSession.endedAt,
          seconds: unfinishedSession.seconds,
          evidence: [],
          state: 'dormant' as const,
          daysAgo: unfinishedSession.daysAgo
        }
      : null

    const situation: Situation = {
      current,
      unfinished,
      looseRelatedTabs: settings.smartTabs ? this.looseTabs() : 0,
      relatedFile: settings.relatedFiles ? await this.relatedFile(current) : null,
      timesReturned: current ? await this.timesReturned(current) : 0
    }

    const one = decide(situation, moment, history)
    if (one.kind !== 'nothing') await this.o.store.saveHistory(recordShown(history, one.kind, moment.now))
    return one
  }

  async answerSuggestion(kind: SuggestionKind, how: 'accepted' | 'dismissed' | 'never'): Promise<void> {
    const history = await this.o.store.history()
    await this.o.store.saveHistory(recordAnswer(history, kind, how))
  }

  /**
   * How many separate times this subject has come back.
   *
   * Separate is the word that matters: four sessions on four days is a project, and four sessions in one evening
   * is one evening.
   */
  private async timesReturned(one: AmbientContext): Promise<number> {
    if (!one.subject) return 0
    const sessions = await this.o.store.sessionList()
    const days = new Set(sessions.filter((two) => two.subject === one.subject).map((two) => new Date(two.endedAt).toDateString()))
    return days.size
  }

  /** A file of theirs whose name matches what they are reading. Names only; nothing opens a file here. */
  private async relatedFile(one: AmbientContext | null): Promise<{ id: string; name: string } | null> {
    if (!one || !this.o.files) return null
    const words = new Set([...(one.concept ? keywordsOf(one.concept) : []), ...(one.subject ? keywordsOf(one.subject) : [])])
    if (words.size === 0) return null
    const files = await this.o.files().catch(() => [])
    for (const file of files) {
      const against = keywordsOf(file.name)
      if (against.some((word) => words.has(word))) return { id: file.id, name: file.name }
    }
    return null
  }

  /** Tabs that look like they belong together. Counted from what was recorded, not by reaching into the browser. */
  private looseTabs(): number {
    const biggest = this.contexts.filter((one) => one.state === 'active').sort((a, b) => b.activityIds.length - a.activityIds.length)[0]
    return biggest ? biggest.activityIds.length : 0
  }

  // ---------------------------------------------------------------- what Orion is given

  /**
   * The smallest useful description of what somebody is doing, for a model request.
   *
   * Three short lines at most, and only when Orbis is actually confident. **Never the activity log, never a
   * history, never a page's text.** The existing Context Engine already assembles the page, the selection and the
   * tabs; this adds the one thing it cannot know, which is what all of that is *about*.
   */
  async forOrion(): Promise<{ text: string; label: string } | null> {
    const settings = await this.o.store.settings()
    if (!settings.enabled || settings.paused || !settings.contextForOrion) return null
    const one = this.currentContext()
    if (!one) return null
    const lines = [`They appear to be ${one.intent}.`]
    if (one.concept) lines.push(`The subject is ${one.concept}${one.subject ? ` (${one.subject})` : ''}.`)
    else if (one.subject) lines.push(`The subject is ${one.subject}.`)
    if (one.seconds > 300) lines.push(`They have been at it for about ${Math.round(one.seconds / 60)} minutes.`)
    return { text: lines.join(' '), label: 'What they are working on' }
  }

  /**
   * What "this", "that" or "yesterday" is pointing at.
   *
   * Resolved from what is known rather than guessed: when there is no confident context the honest answer is
   * null, and the caller asks the person instead of inventing a subject for them.
   */
  async resolve(phrase: string): Promise<{ what: string; from: 'current' | 'recent'; contextId: string } | null> {
    const words = phrase.toLowerCase()
    const current = this.currentContext()
    if (/\b(this|these|here|it)\b/.test(words) && current) {
      return { what: current.title, from: 'current', contextId: current.id }
    }
    if (/\b(yesterday|last night|earlier|before|that|previous)\b/.test(words)) {
      const sessions = await this.o.store.sessionList()
      const best = sessions.find((one) => !one.rejected)
      if (best) return { what: best.title, from: 'recent', contextId: best.id }
    }
    return current ? { what: current.title, from: 'current', contextId: current.id } : null
  }

  async settings(): Promise<AmbientSettings> {
    return this.o.store.settings()
  }

  async saveSettings(patch: Partial<AmbientSettings>): Promise<AmbientSettings> {
    const next = await this.o.store.saveSettings(patch)
    if (!next.enabled || next.paused) {
      this.contexts = []
      this.current = null
      this.o.announce(null)
    }
    return next
  }

  /** Everything forgotten. Settings deliberately survive, so nothing somebody switched off comes back on. */
  async clear(): Promise<{ activity: number; sessions: number }> {
    const out = await this.o.store.clearEverything()
    this.contexts = []
    this.current = null
    this.corrections.clear()
    this.o.announce(null)
    return out
  }

  /** What the inspector shows. Developer-facing; never put in front of an ordinary person. */
  inspect(): { current: AmbientContext | null; contexts: AmbientContext[]; lastThought: number } {
    return { current: this.current, contexts: this.contexts, lastThought: this.lastThought }
  }

  async useProfile(profileId: string): Promise<void> {
    /*
     * Nothing survives a profile change.
     *
     * Cleared before the store is switched, so there is no window in which the new profile's first question could
     * be answered with the previous profile's context.
     */
    this.contexts = []
    this.current = null
    this.corrections.clear()
    this.lastThought = 0
    await this.o.store.useProfile(profileId)
    this.o.announce(null)
  }

  async flush(): Promise<void> {
    await this.rememberDormant().catch(() => undefined)
    await this.o.store.flush()
  }
}

/** The activities the event bus can be turned into. One table, so the mapping is readable in one place. */
export const FROM_EVENT: Readonly<Record<string, { kind: Activity['kind']; source: Activity['source'] } | undefined>> = {
  'page.loaded': { kind: 'page-opened', source: 'browser' },
  'tab.activated': { kind: 'page-active', source: 'browser' },
  'tab.navigated': { kind: 'page-opened', source: 'browser' },
  'search.completed': { kind: 'search', source: 'search' },
  'download.completed': { kind: 'file-downloaded', source: 'files' },
  'orion.started': { kind: 'orion-asked', source: 'orion' },
  'orion.completed': { kind: 'orion-answered', source: 'orion' },
  'focus.started': { kind: 'focus-started', source: 'focus' },
  'focus.completed': { kind: 'focus-ended', source: 'focus' },
  'task.created': { kind: 'task-created', source: 'tasks' },
  'study.task.completed': { kind: 'task-completed', source: 'tasks' },
  'workspace.changed': { kind: 'tab-group', source: 'browser' }
}
