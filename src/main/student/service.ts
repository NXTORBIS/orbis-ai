import { randomUUID } from 'node:crypto'
import { bus } from '../eventBus.ts'
import { StudentStore } from './store.ts'
import { ALL_CONTENT, contentById } from '../../shared/student/content.ts'
import { bandFor, canonical, type SafetyConfig } from '../../shared/student/safety.ts'
import { DEFAULT_BREAKS, decide, describeForLater, previewPolicy, snapshotPolicy, type PolicyDraft } from '../../shared/student/focus.ts'
import {
  GAP,
  TICK_EVERY,
  beginBreak,
  carryOn,
  complete,
  counts,
  endBreak,
  endEarly,
  interrupt,
  isOver,
  newSession,
  pause,
  policyStateOf,
  restoreSession,
  resume,
  tick,
  timerView,
  type Beat
} from '../../shared/student/session.ts'
import { dayKey, monthKey, partOfDay, weekKey } from '../../shared/student/days.ts'
import {
  DAILY_SWEEP_XP,
  XP_VALUES,
  achievementById,
  advanceQuests,
  award,
  awayDays,
  countDay,
  dailySweep,
  levelFor,
  markRestDay,
  newUnlocks,
  questsNow,
  sessionXp,
  streakMark,
  streakNow,
  totalXp,
  updateRecords,
  xpOnDay
} from '../../shared/student/progress.ts'
import { goalProgress, milestoneDone, studyQueue } from '../../shared/student/goals.ts'
import { EXTRA_MINUTES_A_DAY, EXTRA_MINUTE_XP, constellation, offerExtraMinute, watchRecord } from '../../shared/student/orbiAnim.ts'
import { describe as describeMastery, newMastery, overall, proof, record as recordEvidence, strengths, weaknesses, confusions, type EvidenceKind, type Mastery } from '../../shared/student/mastery.ts'
import { blockedBy, merge as mergeGraph, readSyllabus, readyFor, subjectsOf, tree, type Graph } from '../../shared/student/graph.ts'
import { planAhead, planDay, radar, recovery, replan, shortPlan, type Availability, type Deadline, type Exam, type PlanInput, type PlanItem } from '../../shared/student/planner.ts'
import { decide as decideNext, insideQuietHours, recommend as recommendNow, record as logIntervention, shouldAppear, usualHours, type DecideInput, type Intervention } from '../../shared/student/decide.ts'
import { evidenceFrom, finishStep, microFor, missionFor, smaller, type Mission } from '../../shared/student/mission.ts'
import { appropriate, dueCount, dueNow, itemForDay, learningDayCounts, learningOnDay, newReview, nextDifficulty, review as answerReview } from '../../shared/student/learn.ts'
import { unlockedFor, orbiLevelFor } from '../../shared/student/orbi.ts'
import { reportFor, type Report } from '../../shared/student/report.ts'
import { asSyllabus, topicsIn, type Found } from '../../shared/student/material.ts'
import {
  describeMix,
  CARDS_SYSTEM,
  EXPLAIN_SYSTEM,
  MARK_SYSTEM,
  QUIZ_SYSTEM,
  STRUCTURE_SYSTEM,
  cardsPrompt,
  evidenceForGenerated,
  explainPrompt,
  markPrompt,
  quizPrompt,
  readCards,
  readMarks,
  readQuiz,
  readStructure,
  structurePrompt,
  withoutRejected,
  type DraftCard,
  type GeneratedQuestion,
  type MarkedPoint,
  type ProposedStructure
} from '../../shared/student/generate.ts'
import {
  evidenceAfterHints,
  evidenceAfterTeachBack,
  hintFor,
  retryAfter,
  sayTeachBack,
  teachBackFor,
  type Hint,
  type Retry,
  type Rung,
  type TeachBack
} from '../../shared/student/practice.ts'
import { answered, challengeFor, newCombo, challengeResult, surpriseFor, type Challenge, type NotReady, type Surprise } from '../../shared/student/challenge.ts'
import { EXAM_OFF, afterExam, examAhead, whatChanges, type AfterExam, type ExamAhead, type ExamSettings } from '../../shared/student/exam.ts'
import {
  SOCRATIC_SYSTEM,
  advance,
  evidenceFor as evidenceForSocratic,
  firstPrompt,
  newConversation,
  readReply,
  sayEnd,
  turnsPrompt,
  type Conversation
} from '../../shared/student/socratic.ts'
import { CANNOT_READ, PHOTO_PROMPT, PHOTO_SYSTEM, readPhoto, whatNext, type ReadPhoto } from '../../shared/student/photo.ts'
import { emptyProgression, nextStage, record as recordAttempt, stagesFor, through, type Stage } from '../../shared/student/progression.ts'
import { insights, recapFor, recommend } from '../../shared/student/insight.ts'
import { applyOnboarding, patchPreferences, type Onboarding, type ResetScope } from '../../shared/student/prefs.ts'
import type { AchievementCounts } from '../../shared/student/progress.ts'
import type { Answer } from '../../shared/student/learn.ts'
import type {
  AgeBand,
  ContentCategory,
  FocusSession,
  Goal,
  LearningItem,
  LearningReview,
  MotivationEvent,
  PolicyState,
  QuestProgress,
  StudentSnapshot,
  Streak,
  StudentTask,
  SubjectProgress,
  XPEvent
} from '../../shared/student/types.ts'

/**
 * Orbis Student, in the main process.
 *
 * This is the one owner of a Focus session. Nothing else starts, stops, credits or settles one, which is what keeps
 * the numbers consistent: there is a single place where "the session finished" turns into XP, a quest, an
 * achievement, a streak, a record, a subject total and a goal's progress, and it does all seven or none of them.
 *
 * ## The two rules that run through everything here
 *
 * **Settlement happens once.** `settle()` is the only path that pays anything out, it refuses a session already
 * marked settled, and every payment it makes carries a key derived from the session id. A completion that arrives
 * twice -- from a tick, from a restored session and from a student pressing the button -- pays once. This was not a
 * theoretical worry: all three of those really do happen, and two of them happen while the first is still running.
 *
 * **Time is credited by the heartbeat, never computed from the start.** See session.ts for why. The practical
 * consequence here is that this service has to be the thing holding the heartbeat, and it has to write it with the
 * session in one file, so a crash cannot leave a session whose elapsed time is unknowable.
 */

export interface StudentHooks {
  /**
   * Tells the browser what may be reached.
   *
   * Handed the whole decision rather than a list of sites, because the browser enforces and does not interpret: a
   * second place that worked out what counts as a distraction would eventually disagree with this one.
   */
  enforce(policy: { state: PolicyState; blockedCategories: readonly ContentCategory[]; blockedHosts: readonly string[]; approved: readonly string[]; youtube: string; sessionId: string | null; band: AgeBand; safetyBlocked: readonly ContentCategory[] }): void
  /** Says something to the student, through whatever Orbis already uses to interrupt somebody. */
  notify?(notice: { title: string; body: string; kind: 'focus' | 'learning' | 'progress' | 'problem'; important: boolean }): void
  /**
   * What is open in the browser right now, for the one observation worth making about tabs.
   *
   * Read from the browser only while it is already running -- counting somebody's tabs must never be the thing that
   * launches a browser. With no browser, this returns nothing and Orbis simply says nothing about tabs.
   */
  tabs?(): readonly { url: string; title: string }[]
  /**
   * Closing tabs, by address, and only when the student asked.
   *
   * Returns how many actually closed. Orbis never closes a tab on its own initiative -- which of twenty tabs
   * somebody was finished with is not a thing software can know.
   */
  closeTabs?(urls: readonly string[]): Promise<number>
  /**
   * Asking a model for something written: questions, card drafts, a marking suggestion, an explanation.
   *
   * One hook for all of it, so there is exactly one place where Student talks to a model -- and it returns plain
   * JSON or null. Null is the honest answer when there is no key, no network, or a reply that could not be read,
   * and every caller treats it as "no suggestion" rather than as an error.
   */
  ask?(system: string, user: string, options?: { maxTokens?: number; timeoutMs?: number }): Promise<Record<string, unknown> | null>
  /** Free text rather than JSON, for an explanation that is meant to be read. */
  askText?(system: string, user: string, options?: { maxTokens?: number; timeoutMs?: number }): Promise<string | null>
  /**
   * Looking at a picture.
   *
   * Only the vision service can answer this, so it is absent without a key for it -- and a student without one is
   * told that looking is not set up rather than shown a camera button that fails.
   */
  askImage?(
    system: string,
    user: string,
    image: string,
    options?: { maxTokens?: number; timeoutMs?: number; json?: boolean }
  ): Promise<string | Record<string, unknown> | null>
  /** Starts, pauses or stops the atmosphere and music, when the session asked for them. */
  sound?(what: { atmosphere: string | null; playlistId: string | null; playing: boolean }): void
  /** Something changed; every Student surface should look again. */
  announce?(): void
}

export class StudentService {
  private readonly store: StudentStore
  private readonly hooks: StudentHooks
  private timer: NodeJS.Timeout | null = null
  /** Set while settling, so a second call cannot interleave with the first. */
  private settling: Promise<void> | null = null
  private lastMoment: { kind: string; at: number } | null = null

  constructor(store: StudentStore, hooks: StudentHooks) {
    this.store = store
    this.hooks = hooks
  }

  // ---------------------------------------------------------------- starting and stopping

  /**
   * Picks up whatever was happening when Orbis last stopped.
   *
   * Called once, after the store exists and before any surface draws, so a student never sees "no session" for a
   * moment before their locked session reappears.
   */
  async start(): Promise<void> {
    const state = await this.store.state.read()
    if (state.session && !isOver(state.session.state)) {
      const beat: Beat = state.beat ?? { at: state.session.updatedAt, mono: null }
      const back = restoreSession(state.session, beat, Date.now())
      await this.store.state.write({ ...state, session: back.session, beat: { at: Date.now(), mono: now() } })
      bus.publish('focus.restored', { sessionId: back.session.id, kind: back.kind, gapMinutes: back.gapMinutes }, { source: 'student', profileId: this.store.who() })
      if (back.kind === 'complete') await this.settle(back.session, 'completed')
      else if (back.kind === 'expired') await this.finish(back.session)
      else {
        this.apply(back.session)
        if (back.kind === 'ask') {
          void this.tell({
            title: 'Your session is still here',
            // The numbers, said plainly: Orbis was not watching, so that time was not counted.
            body: `Orbis was closed for ${back.gapMinutes} minutes. That time was not counted. Carry on, or finish here.`,
            kind: 'focus',
            important: true
          })
        }
      }
    }
    await this.noteTheDay()
    this.beat()
    this.changed()
  }

  /** The heartbeat. One timer for the whole of Student. */
  private beat(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.onBeat(), TICK_EVERY * 1000)
    // Never the reason a machine cannot sleep or Orbis cannot quit.
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * One tick.
   *
   * Everything that happens on a schedule happens here, in order, so there is one place to look when a timer
   * misbehaves. A tick that finds nothing running writes nothing at all -- an idle Orbis does not touch the disk.
   */
  private async onBeat(): Promise<void> {
    const state = await this.store.state.read()
    const session = state.session
    if (!session || isOver(session.state)) return

    const at = Date.now()
    const beat: Beat = state.beat ?? { at, mono: now() }
    const stepped = tick(session, beat, at, now())
    await this.store.state.write({ ...state, session: stepped.session, beat: { at, mono: now() } })

    const profileId = this.store.who()
    if (stepped.gap !== null) {
      bus.publish('focus.interrupted', { sessionId: session.id, gapSeconds: Math.round(stepped.gap) }, { source: 'student', profileId })
      void this.tell({
        title: 'Session paused',
        body: `Orbis was not running for ${Math.round(stepped.gap / 60)} minutes, so that time was not counted.`,
        kind: 'focus',
        important: true
      })
      this.apply(stepped.session)
      this.changed()
      return
    }

    for (const milestone of stepped.milestones) {
      bus.publish('focus.milestone', { sessionId: session.id, through: milestone }, { source: 'student', profileId })
      this.say(milestone >= 0.9 ? 'final-stretch' : milestone >= 0.5 ? 'half-way' : 'first-milestone')
    }

    if (stepped.breakDue) {
      bus.publish('focus.break.started', { sessionId: session.id }, { source: 'student', profileId })
      this.say('break-started')
      this.apply(stepped.session)
    }
    if (stepped.breakOver) {
      this.say('break-over')
      if (stepped.session.breaks.autoResume) await this.endBreak()
      else this.changed()
      return
    }
    if (stepped.finished) {
      await this.settle(stepped.session, 'completed')
      return
    }
    this.changed()
  }

  // ---------------------------------------------------------------- a session

  async startFocus(draft: {
    title?: string
    subject?: string | null
    taskId?: string | null
    goalId?: string | null
    milestoneId?: string | null
    conceptId?: string | null
    intention?: string
    oneThing?: string
    minutes?: number
    policy?: PolicyDraft
    breaks?: FocusSession['breaks']
    atmosphere?: string | null
    playlistId?: string | null
    capsuleId?: string | null
    spaceId?: string | null
  }): Promise<{ ok: boolean; why?: string; session?: FocusSession }> {
    const state = await this.store.state.read()
    if (state.session && !isOver(state.session.state)) {
      return { ok: false, why: 'A session is already running. Finish it first.' }
    }
    const prefs = await this.store.prefs.read()
    const at = Date.now()
    const task = draft.taskId ? await this.store.tasks.get(draft.taskId) : null
    /*
     * A capsule is a saved session, so starting one has to mean starting *that* session.
     *
     * Everything it holds becomes the default, and anything passed in alongside still wins -- which is what lets a
     * capsule be started with a different task without being edited. Without this a capsule was a name and nothing
     * else: its length, its strictness and its sound were all quietly replaced by the general defaults.
     */
    const capsule = draft.capsuleId ? await this.store.capsules.get(draft.capsuleId) : null

    const session = newSession(
      {
        id: randomUUID(),
        profileId: this.store.who(),
        title: (draft.title ?? capsule?.name ?? task?.title ?? 'Focus').slice(0, 200),
        subject: draft.subject ?? capsule?.subject ?? task?.subject ?? null,
        taskId: draft.taskId ?? null,
        goalId: draft.goalId ?? capsule?.goalId ?? task?.goalId ?? null,
        milestoneId: draft.milestoneId ?? task?.milestoneId ?? null,
        conceptId: draft.conceptId ?? null,
        intention: (draft.intention ?? capsule?.intention ?? '').slice(0, 400),
        oneThing: (draft.oneThing ?? capsule?.task ?? task?.title ?? '').slice(0, 200),
        level: draft.policy?.level ?? capsule?.level ?? prefs.defaultLevel,
        // Snapshotted here, once. Nothing in Settings can weaken it after this line.
        policy: snapshotPolicy({
          level: draft.policy?.level ?? capsule?.level ?? prefs.defaultLevel,
          blocked: draft.policy?.blocked ?? (capsule && capsule.blocked.length > 0 ? capsule.blocked : prefs.blockedCategories),
          approved: draft.policy?.approved ?? (capsule && capsule.approved.length > 0 ? capsule.approved : prefs.approvedSites),
          approvedCategories: draft.policy?.approvedCategories,
          blockedSites: draft.policy?.blockedSites ?? (capsule && capsule.blockedSites.length > 0 ? capsule.blockedSites : prefs.blockedSites),
          locked: draft.policy?.locked ?? capsule?.locked,
          youtube: draft.policy?.youtube ?? prefs.youtube,
          approvedVideos: draft.policy?.approvedVideos,
          approvedChannels: draft.policy?.approvedChannels
        }),
        breaks: draft.breaks ?? capsule?.breaks ?? prefs.defaultBreaks ?? DEFAULT_BREAKS,
        /*
         * Longer by default in exam mode, and only as a default.
         *
         * Anything the student typed, and any capsule's own length, still wins -- this changes the number that
         * comes up when nobody said one.
         */
        plannedMinutes: draft.minutes ?? capsule?.minutes ?? (state.exam.goalId !== null && state.exam.longerSessions ? 50 : prefs.defaultMinutes),
        atmosphere: draft.atmosphere ?? capsule?.atmosphere ?? prefs.defaultAtmosphere,
        playlistId: draft.playlistId ?? capsule?.playlistId ?? (prefs.musicOnFocus === 'auto' ? prefs.defaultPlaylistId : null),
        capsuleId: draft.capsuleId ?? null,
        spaceId: draft.spaceId ?? null
      },
      at,
      now()
    )

    await this.store.state.write({ ...state, session, beat: { at, mono: now() } })
    if (capsule) await this.store.capsules.put({ ...capsule, used: capsule.used + 1, updatedAt: at })
    if (session.taskId && task && task.state === 'planned') {
      await this.store.tasks.put({ ...task, state: 'active', updatedAt: at })
    }
    this.apply(session)
    /*
     * Where they were, kept before a strict session takes it away.
     *
     * Only for a session that will actually block things: a light session leaves the browser alone, so there is
     * nothing to put back and a space nobody asked for is clutter. Nothing is closed here either -- the enforcer
     * replaces blocked pages, and this is what makes that reversible.
     */
    if (session.level === 'deep' || session.policy.locked) {
      void this.tidyTabs(`Where you were — ${new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`, { sessionId: session.id }).catch(() => undefined)
    }
    // Sound only when it was asked for. Nothing starts playing because a session started.
    if (session.atmosphere || session.playlistId) this.hooks.sound?.({ atmosphere: session.atmosphere, playlistId: session.playlistId, playing: true })
    bus.publish('focus.started', { sessionId: session.id, minutes: session.plannedMinutes, level: session.level, subject: session.subject }, { source: 'student', profileId: this.store.who() })
    this.say('session-started')
    this.beat()
    this.changed()
    return { ok: true, session }
  }

  async pauseFocus(): Promise<boolean> {
    return this.move((session) => pause(session, Date.now()), 'focus.paused', 'paused')
  }

  async resumeFocus(): Promise<boolean> {
    return this.move((session) => resume(session, Date.now()), 'focus.resumed', 'resumed')
  }

  async startBreak(): Promise<boolean> {
    const moved = await this.move((session) => beginBreak(session, Date.now()), 'focus.break.started', 'break')
    if (moved) this.say('break-started')
    return moved
  }

  async endBreak(): Promise<boolean> {
    const moved = await this.move((session) => endBreak(session, Date.now()), 'focus.break.completed', 'break over')
    if (moved) this.say('break-over')
    return moved
  }

  /**
   * One more minute.
   *
   * Offered only in the last stretch and paid only a few times a day. It extends the plan rather than pretending
   * the time was already done, so the history still says what happened: a fifty-minute session that became
   * fifty-one is recorded as fifty-one planned, not as fifty with a minute of credit nobody earned.
   */
  async extraMinute(): Promise<{ ok: boolean; why?: string; minutes?: number }> {
    const state = await this.store.state.read()
    const session = state.session
    const at = Date.now()
    const day = dayKey(at)
    const used = state.extraMinutes.day === day ? state.extraMinutes.used : 0
    if (!session || session.state !== 'active') return { ok: false, why: 'Nothing is running.' }
    if (!offerExtraMinute(session, used)) {
      return { ok: false, why: used >= EXTRA_MINUTES_A_DAY ? 'That is enough extra minutes for today.' : 'There is still time left in this session.' }
    }

    const next = { ...session, plannedMinutes: session.plannedMinutes + 1, updatedAt: at }
    await this.store.state.write({ ...state, session: next, extraMinutes: { day, used: used + 1 } })

    // Keyed on the session and the count, so a double press pays once.
    const events = await this.store.xp.all()
    const keys = new Set(events.map((one) => one.key))
    const out = award(events, keys, this.store.who(), {
      source: 'focus-session',
      amount: EXTRA_MINUTE_XP,
      sourceId: session.id,
      key: `extra:${session.id}:${used + 1}`,
      subject: session.subject,
      at,
      id: randomUUID()
    })
    if (out.awarded > 0) await this.store.xp.replace(out.events.map((one) => one))
    await this.apply(next)
    this.changed()
    return { ok: true, minutes: next.plannedMinutes }
  }

  /** What the student wrote about a session afterwards. Optional, and never asked for twice. */
  async journal(sessionId: string, text: string): Promise<boolean> {
    const held = await this.store.sessions.get(sessionId)
    if (!held) return false
    await this.store.sessions.put({ ...held, journal: text.slice(0, 2000) })
    this.changed()
    return true
  }

  async carryOnFocus(): Promise<boolean> {
    return this.move((session) => carryOn(session, Date.now()), 'focus.resumed', 'carried on')
  }

  private async move(change: (session: FocusSession) => FocusSession, event: Parameters<typeof bus.publish>[0], note: string): Promise<boolean> {
    const state = await this.store.state.read()
    if (!state.session) return false
    const next = change(state.session)
    if (next === state.session) return false
    await this.store.state.write({ ...state, session: next, beat: { at: Date.now(), mono: now() } })
    this.apply(next)
    bus.publish(event, { sessionId: next.id, note }, { source: 'student', profileId: this.store.who() })
    this.changed()
    return true
  }

  /** Ending early. Allowed from anywhere, always, because a student must never be trapped. */
  async endFocus(options: { reason?: string } = {}): Promise<{ ok: boolean; session?: FocusSession }> {
    const state = await this.store.state.read()
    const session = state.session
    if (!session || isOver(session.state)) return { ok: false }
    /*
     * Pressing "end" when the planned time is already up is not ending early -- it is finishing.
     *
     * Worth being exact about, because an achievement and a quest both ask how many sessions were *completed*, and a
     * student who sat through the whole fifty minutes and then pressed the button would otherwise have none.
     */
    const done = session.focusedSeconds >= session.plannedMinutes * 60
    const ended = done ? complete(session, Date.now()) : endEarly(session, Date.now(), options.reason?.slice(0, 120) ?? 'ended early')
    // Most of a session is still a session: it settles, and pays for what was actually done.
    if (counts(ended)) {
      await this.settle(ended, done ? 'completed' : 'ended-early')
      return { ok: true, session: ended }
    }
    await this.finish(ended)
    return { ok: true, session: ended }
  }

  /** The window is closing. The session is not ended -- it is put down where it can be picked up. */
  async onQuit(): Promise<void> {
    const state = await this.store.state.read()
    if (state.session && !isOver(state.session.state)) {
      const held = interrupt(state.session, Date.now(), 'Orbis closed')
      await this.store.state.write({ ...state, session: held, beat: state.beat ?? { at: Date.now(), mono: null } })
      bus.publish('focus.interrupted', { sessionId: held.id }, { source: 'student', profileId: this.store.who() })
    }
    this.stop()
    await this.store.flush()
  }

  /**
   * Settlement. The only place anything is paid out.
   *
   * Everything in here is keyed on the session, and the session is marked settled before any of it is written, so a
   * second arrival finds nothing left to do. The order matters only in that the session is written first: if the
   * process dies halfway, the session is already settled and the XP keys will stop the rest from happening twice
   * when it is picked up again.
   */
  private async settle(session: FocusSession, as: 'completed' | 'ended-early'): Promise<void> {
    if (this.settling) return this.settling
    const run = this.doSettle(session, as)
    this.settling = run.finally(() => {
      this.settling = null
    })
    return this.settling
  }

  private async doSettle(session: FocusSession, as: 'completed' | 'ended-early'): Promise<void> {
    const state = await this.store.state.read()
    if (session.settled) return
    const at = Date.now()
    const finished = as === 'completed' ? complete(session, at) : endEarly(session, at)
    const paid = counts(finished)

    // Marked settled first, so nothing that follows can be done twice.
    const settledSession: FocusSession = { ...finished, settled: true }
    const day = dayKey(settledSession.startedAt)

    // --- XP, each payment keyed on this session and nothing else
    let events: readonly XPEvent[] = await this.store.xp.all()
    let keys: ReadonlySet<string> = new Set(events.map((one) => one.key))
    let levelled = false
    let awarded = 0
    const pay = (source: Parameters<typeof award>[3]['source'], amount: number, key: string, subject: string | null = null, sourceId = settledSession.id): void => {
      const out = award(events, keys, this.store.who(), { source, amount, sourceId, key, subject, at, id: randomUUID() })
      events = out.events
      keys = new Set(events.map((one) => one.key))
      awarded += out.awarded
      levelled = levelled || out.levelled
    }

    if (paid) {
      pay('focus-session', sessionXp(Math.round(settledSession.focusedSeconds / 60), settledSession.level), `session:${settledSession.id}:complete`, settledSession.subject)
    }

    // --- quests, from one event rather than from several places
    let quests: readonly QuestProgress[] = state.quests
    if (paid) {
      quests = advanceQuests(quests, 'focus-minutes', Math.round(settledSession.focusedSeconds / 60), at)
      quests = advanceQuests(quests, 'focus-sessions', 1, at)
    }
    const { quests: settledQuests, events: afterQuests, keys: keysAfterQuests, awarded: questXp } = await this.settleQuests(quests, events, keys, at)
    quests = settledQuests
    events = afterQuests
    keys = keysAfterQuests
    awarded += questXp

    // --- streaks, records, subject totals
    let streaks = state.streaks
    if (paid) {
      streaks = streaks.map((one) => (one.kind === 'focus' ? countDay(one, day) : one))
      const focus = streaks.find((one) => one.kind === 'focus')
      const mark = focus ? streakMark(focus.current) : null
      if (mark) pay('streak', XP_VALUES.streak, `streak:focus:${mark}`, null, String(mark))
    }

    const sessions = [...(await this.store.sessions.all()), settledSession]
    const daySeconds = sessions.filter((one) => dayKey(one.startedAt) === day).reduce((sum, one) => sum + one.focusedSeconds, 0)
    const weekSeconds = sessions.filter((one) => weekKey(one.startedAt) === weekKey(settledSession.startedAt)).reduce((sum, one) => sum + one.focusedSeconds, 0)
    const tasks = await this.store.tasks.all()
    const records = paid
      ? updateRecords(state.records, {
          sessionSeconds: settledSession.focusedSeconds,
          at: settledSession.startedAt,
          daySeconds,
          weekSeconds,
          dayXp: xpOnDay(events, day),
          dayTasks: tasks.filter((one) => one.completedAt !== null && dayKey(one.completedAt) === day).length,
          focusStreak: streaks.find((one) => one.kind === 'focus')?.current ?? 0,
          learningStreak: streaks.find((one) => one.kind === 'learning')?.current ?? 0
        })
      : state.records

    const subjects = settledSession.subject && paid ? bumpSubject(state.subjects, settledSession.subject, { sessions: 1, focusedSeconds: settledSession.focusedSeconds, at }) : state.subjects

    // --- achievements, from one centralised count
    const unlocks = newUnlocks(await this.counts(sessions, tasks, streaks, events), state.achievements, at)
    for (const unlock of unlocks) {
      const rule = achievementById(unlock.achievementId)
      if (rule) pay('achievement', rule.xp, `achievement:${rule.id}`, null, rule.id)
    }

    const total = totalXp(events)
    const xpForThis = events.filter((one) => one.sourceId === settledSession.id && one.key.startsWith('session:')).reduce((sum, one) => sum + one.amount, 0)

    await this.store.state.write({
      ...state,
      session: null,
      beat: null,
      quests,
      streaks,
      records,
      subjects,
      achievements: [...state.achievements, ...unlocks].slice(-300)
    })
    await this.store.xp.replace(events.map((one) => one))
    await this.store.sessions.put({ ...settledSession, xpAwarded: xpForThis })

    // --- the task and the goal this session was for
    if (settledSession.taskId) {
      const task = await this.store.tasks.get(settledSession.taskId)
      if (task) await this.store.tasks.put({ ...task, actual: task.actual + Math.round(settledSession.focusedSeconds / 60), updatedAt: at })
    }
    /*
     * The concept this session was about.
     *
     * Sitting with something counts as exposure and nothing else -- not recall, not application. A twenty-minute
     * session cannot make the mastery map claim the student can produce it from memory, because it has no evidence
     * of that. Recall and application are recorded only when the student actually answers or applies something.
     */
    if (settledSession.conceptId && paid) {
      await this.learned(settledSession.conceptId, 'read').catch(() => undefined)
    }
    if (settledSession.capsuleId && paid) {
      const capsule = await this.store.capsules.get(settledSession.capsuleId)
      if (capsule) await this.store.capsules.put({ ...capsule, completed: capsule.completed + 1, updatedAt: at })
    }

    await this.updateOrbi(levelFor(total).level, [...state.achievements, ...unlocks].map((one) => achievementById(one.achievementId)?.unlocks ?? '').filter(Boolean))

    this.apply(null)
    this.hooks.sound?.({ atmosphere: null, playlistId: null, playing: false })

    const profileId = this.store.who()
    bus.publish(as === 'completed' ? 'focus.completed' : 'focus.endedEarly', { sessionId: settledSession.id, seconds: Math.round(settledSession.focusedSeconds), xp: awarded, paid }, { source: 'student', profileId })
    if (awarded > 0) bus.publish('study.xp', { amount: awarded, total }, { source: 'student', profileId })
    if (levelled) bus.publish('study.level', { level: levelFor(total).level }, { source: 'student', profileId })
    for (const unlock of unlocks) bus.publish('study.achievement', unlock, { source: 'student', profileId })

    if (as === 'completed') this.say('session-complete')
    // Level-ups and achievements are queued behind the completion on purpose: nothing interrupts work, and a
    // celebration lands when the session is already over.
    if (levelled) this.moment('level-up')
    else if (unlocks.length > 0) this.moment('achievement')
    /*
     * The dance is for something that took a while.
     *
     * Forty-five minutes finished, and only then. A companion that dances at every twenty-five minute session is
     * one somebody turns off by Wednesday, which costs more than the dance is worth.
     */
    else if (as === 'completed' && settledSession.focusedSeconds >= 45 * 60) this.moment('dance')
    else if (as === 'completed') this.moment('celebrating')

    if (as === 'completed') {
      await this.tell({
        title: 'Session complete',
        body: `${Math.round(settledSession.focusedSeconds / 60)} minutes${awarded > 0 ? ` · +${awarded} XP` : ''}`,
        kind: 'progress',
        important: false
      })
    }
    this.changed()
  }

  /** A session that pays nothing still goes into the history, because it happened. */
  private async finish(session: FocusSession): Promise<void> {
    const state = await this.store.state.read()
    await this.store.state.write({ ...state, session: null, beat: null })
    await this.store.sessions.put({ ...session, settled: true, endedAt: session.endedAt ?? Date.now() })
    this.apply(null)
    this.hooks.sound?.({ atmosphere: null, playlistId: null, playing: false })
    this.changed()
  }

  /** Quests that have been finished but not paid. Separate so a quest finished outside a session settles too. */
  private async settleQuests(
    quests: readonly QuestProgress[],
    events: readonly XPEvent[],
    keys: ReadonlySet<string>,
    at: number
  ): Promise<{ quests: readonly QuestProgress[]; events: readonly XPEvent[]; keys: Set<string>; awarded: number }> {
    let held = events
    let heldKeys = new Set(keys)
    let awarded = 0
    const out = quests.map((quest) => {
      if (quest.completedAt === null || quest.settled) return quest
      const definition = questsNow(quests, at).find((one) => one.questId === quest.questId)
      const xp = definition?.xp ?? 20
      const result = award(held, heldKeys, this.store.who(), {
        source: 'quest',
        amount: xp,
        sourceId: quest.questId,
        // The key carries the period, so the same daily quest pays on each day it is done and never twice on one.
        key: `quest:${quest.questId}:${quest.periodKey}`,
        at,
        id: randomUUID()
      })
      held = result.events
      heldKeys = new Set(held.map((one) => one.key))
      awarded += result.awarded
      bus.publish('study.quest', { questId: quest.questId, periodKey: quest.periodKey, xp: result.awarded }, { source: 'student', profileId: this.store.who() })
      return { ...quest, settled: true }
    })
    if (dailySweep(out, at)) {
      const sweep = award(held, heldKeys, this.store.who(), { source: 'quest', amount: DAILY_SWEEP_XP, sourceId: 'daily-sweep', key: `quest:daily-sweep:${dayKey(at)}`, at, id: randomUUID() })
      held = sweep.events
      heldKeys = new Set(held.map((one) => one.key))
      awarded += sweep.awarded
    }
    return { quests: out, events: held, keys: heldKeys, awarded }
  }

  /** Every number an achievement can be about, counted in one place. */
  private async counts(
    sessions: readonly FocusSession[],
    tasks: readonly StudentTask[],
    streaks: readonly Streak[],
    events: readonly XPEvent[]
  ): Promise<AchievementCounts> {
    const settled = sessions.filter((one) => one.state === 'completed')
    const goals = await this.store.goals.all()
    const reviews = await this.store.reviews.read()
    const attempts = await this.store.attempts.all()
    const capsules = await this.store.capsules.all()
    return {
      sessions: settled.length,
      'focus-minutes': Math.round(sessions.reduce((sum, one) => sum + one.focusedSeconds, 0) / 60),
      'deep-sessions': settled.filter((one) => one.level === 'deep').length,
      'longest-session': Math.round(Math.max(0, ...sessions.map((one) => one.focusedSeconds)) / 60),
      'focus-streak': streaks.find((one) => one.kind === 'focus')?.current ?? 0,
      'learning-streak': streaks.find((one) => one.kind === 'learning')?.current ?? 0,
      tasks: tasks.filter((one) => one.state === 'completed').length,
      goals: goals.filter((one) => one.state === 'completed').length,
      milestones: goals.reduce((sum, goal) => sum + goal.milestones.filter((one) => one.completedAt !== null).length, 0),
      capsules: capsules.length,
      words: reviews.filter((one) => one.itemId.startsWith('word-') && one.reviews > 0).length,
      quizzes: attempts.length,
      reviews: reviews.reduce((sum, one) => sum + one.reviews, 0),
      // Coming back after a week away, which is worth saying something about exactly once.
      comeback: events.some((one) => one.key === 'achievement:comeback') ? 1 : streaks.find((one) => one.kind === 'focus') && awayDays(streaks.find((one) => one.kind === 'focus') as never, Date.now()) >= 7 ? 1 : 0
    }
  }

  private async updateOrbi(level: number, unlocks: readonly string[]): Promise<void> {
    const held = await this.store.orbi.read()
    const next = orbiLevelFor(level)
    const unlocked = unlockedFor(next, [...held.unlocked, ...unlocks])
    if (next === held.level && unlocked.length === held.unlocked.length) return
    await this.store.orbi.write({ ...held, level: next, unlocked, updatedAt: Date.now() })
  }

  // ---------------------------------------------------------------- the browser

  /** What the browser is told. Derived, never stored, so it cannot drift from the session. */
  private async policyNow(session: FocusSession | null): Promise<Parameters<StudentHooks['enforce']>[0]> {
    const prefs = await this.store.prefs.read()
    const band = bandFor(prefs.dob, new Date())
    const onBreak = session?.state === 'break'
    return {
      state: policyStateOf(session),
      blockedCategories: session && !onBreak ? session.policy.blocked : [],
      blockedHosts: session && !onBreak ? session.policy.blockedSites : [],
      approved: session ? [...session.policy.approved, ...prefs.approvedSites] : prefs.approvedSites,
      youtube: session && !onBreak ? session.policy.youtube : 'open',
      sessionId: session?.id ?? null,
      band,
      // Safety is not part of the session and does not stop when it does.
      safetyBlocked: safetyBlockedFor(band, prefs.safetyOverride)
    }
  }

  /**
   * Tells the browser what is in force.
   *
   * Returns the promise rather than firing and forgetting, so anything that changed the policy can wait for the
   * browser to have been told. Without that, a settings change resolves before it has taken effect, and a page
   * loaded in the next moment is decided by the policy that was just replaced.
   */
  private apply(session: FocusSession | null): Promise<void> {
    return this.policyNow(session).then((policy) => this.hooks.enforce(policy))
  }

  /** Re-applies the policy, after a settings change or a profile switch. */
  async reapply(): Promise<void> {
    const state = await this.store.state.read()
    await this.apply(state.session && !isOver(state.session.state) ? state.session : null)
  }

  /**
   * Whether a page may open, asked by the browser.
   *
   * The one decision point. The browser enforces what this says and works nothing out for itself, which is why a
   * student cannot get a different answer out of two parts of Orbis.
   */
  async mayOpen(url: string): Promise<{ allowed: boolean; reason: string; saveable: boolean; because: string; category: string; remaining: number | null; sessionTitle: string }> {
    const prefs = await this.store.prefs.read()
    const state = await this.store.state.read()
    const session = state.session && !isOver(state.session.state) ? state.session : null
    const safety: SafetyConfig = {
      band: bandFor(prefs.dob, new Date()),
      override: prefs.safetyOverride,
      approved: prefs.approvedSites,
      blocked: prefs.blockedSites
    }
    const verdict = decide(url, { safety, policy: session?.policy ?? null, onBreak: session?.state === 'break' })

    if (verdict.counts && session) {
      const next = { ...session, distractionAttempts: session.distractionAttempts + 1, updatedAt: Date.now() }
      await this.store.state.write({ ...state, session: next })
      bus.publish('focus.distraction', { sessionId: session.id, url: canonical(url), category: verdict.category }, { source: 'student', profileId: this.store.who() })
      this.say('distraction-attempt')
      this.moment('distraction')
    }

    return {
      allowed: verdict.allowed,
      reason: verdict.reason,
      saveable: verdict.saveable,
      because: verdict.because,
      category: verdict.category,
      remaining: session ? timerView(session).remaining : null,
      sessionTitle: session?.title ?? ''
    }
  }

  async saveForLater(url: string, title: string, note = ''): Promise<{ ok: boolean; id?: string }> {
    const state = await this.store.state.read()
    const session = state.session
    const described = describeForLater(url, title)
    const at = Date.now()
    const item = await this.store.distractions.put({
      id: randomUUID(),
      profileId: this.store.who(),
      url: described.url,
      title: described.title,
      category: described.category,
      savedAt: at,
      sessionId: session?.id ?? null,
      sessionTitle: session?.title ?? '',
      note: note.slice(0, 600),
      state: 'waiting'
    })
    if (session && !isOver(session.state)) {
      await this.store.state.write({ ...state, session: { ...session, savedForLater: session.savedForLater + 1, updatedAt: at } })
    }
    bus.publish('focus.saved', { url: described.url, sessionId: session?.id ?? null }, { source: 'student', profileId: this.store.who() })
    this.changed()
    return { ok: true, id: item.id }
  }

  async capture(text: string): Promise<{ ok: boolean }> {
    const trimmed = text.trim().slice(0, 1000)
    if (!trimmed) return { ok: false }
    const state = await this.store.state.read()
    await this.store.thoughts.put({
      id: randomUUID(),
      profileId: this.store.who(),
      text: trimmed,
      at: Date.now(),
      sessionId: state.session?.id ?? null,
      state: 'waiting'
    })
    this.changed()
    return { ok: true }
  }

  // ---------------------------------------------------------------- tasks and goals

  async completeTask(taskId: string): Promise<{ ok: boolean; xp: number }> {
    const task = await this.store.tasks.get(taskId)
    if (!task || task.state === 'completed') return { ok: false, xp: 0 }
    const at = Date.now()
    await this.store.tasks.put({ ...task, state: 'completed', completedAt: at, updatedAt: at })

    const state = await this.store.state.read()
    let events: readonly XPEvent[] = await this.store.xp.all()
    const keys = new Set(events.map((one) => one.key))
    const out = award(events, keys, this.store.who(), { source: 'task', amount: XP_VALUES.task, sourceId: task.id, key: `task:${task.id}`, subject: task.subject, at, id: randomUUID() })
    events = out.events

    let quests: readonly QuestProgress[] = advanceQuests(state.quests, 'tasks-completed', 1, at)
    const settled = await this.settleQuests(quests, events, new Set(events.map((one) => one.key)), at)
    quests = settled.quests
    const subjects = task.subject ? bumpSubject(state.subjects, task.subject, { tasksCompleted: 1, at }) : state.subjects

    await this.store.xp.replace(settled.events.map((one) => one))
    await this.store.state.write({ ...state, quests, subjects })

    bus.publish('study.task.completed', { taskId: task.id, goalId: task.goalId }, { source: 'student', profileId: this.store.who() })
    this.say('task-complete')
    await this.checkGoal(task.goalId)
    this.changed()
    return { ok: true, xp: out.awarded + settled.awarded }
  }

  /** Whether finishing something finished a milestone, and whether that finished a goal. */
  private async checkGoal(goalId: string | null): Promise<void> {
    if (!goalId) return
    const goal = await this.store.goals.get(goalId)
    if (!goal || goal.state !== 'active') return
    const tasks = await this.store.tasks.all()
    const at = Date.now()

    const milestones = goal.milestones.map((one) => (one.completedAt === null && milestoneDone(one, tasks) ? { ...one, completedAt: at } : one))
    const newlyDone = milestones.filter((one, i) => one.completedAt !== null && goal.milestones[i].completedAt === null)
    const everyDone = milestones.length > 0 && milestones.every((one) => one.completedAt !== null)
    if (newlyDone.length === 0 && !everyDone) return

    const next: Goal = { ...goal, milestones, state: everyDone ? 'completed' : goal.state, completedAt: everyDone ? at : goal.completedAt, updatedAt: at }
    await this.store.goals.put(next)

    let events: readonly XPEvent[] = await this.store.xp.all()
    let keys: ReadonlySet<string> = new Set(events.map((one) => one.key))
    const pay = (amount: number, key: string, sourceId: string, source: Parameters<typeof award>[3]['source']): number => {
      const out = award(events, keys, this.store.who(), { source, amount, sourceId, key, subject: goal.subject, at, id: randomUUID() })
      events = out.events
      keys = new Set(events.map((one) => one.key))
      return out.awarded
    }
    for (const one of newlyDone) {
      pay(XP_VALUES.milestone, `milestone:${one.id}`, one.id, 'milestone')
      bus.publish('study.milestone.completed', { goalId: goal.id, milestoneId: one.id }, { source: 'student', profileId: this.store.who() })
    }
    if (everyDone) {
      pay(XP_VALUES.goal, `goal:${goal.id}`, goal.id, 'goal')
      bus.publish('study.goal.completed', { goalId: goal.id }, { source: 'student', profileId: this.store.who() })
      this.say('goal-complete')
    }

    const state = await this.store.state.read()
    const quests = advanceQuests(state.quests, 'milestones', newlyDone.length, at)
    const settled = await this.settleQuests(quests, events, keys, at)
    await this.store.xp.replace(settled.events.map((one) => one))
    await this.store.state.write({ ...state, quests: [...settled.quests] })
    this.changed()
  }

  // ---------------------------------------------------------------- learning

  /** Today's content, chosen so it is the same all day. */
  async today(): Promise<{ word: LearningItem | null; mix: LearningItem[]; due: number; dueItems: { item: LearningItem; review: LearningReview }[] }> {
    const prefs = await this.store.prefs.read()
    const state = await this.store.state.read()
    const band = bandFor(prefs.dob, new Date())
    const attempts = await this.store.attempts.all()
    const difficulty = nextDifficulty(attempts, prefs.difficulty)
    const day = dayKey(Date.now())
    const reviews = await this.store.reviews.read()
    const due = dueNow(reviews, Date.now())
    const mine = ALL_CONTENT.filter((one) => appropriate(one, band))

    /*
     * The day's choice is written down once, for the day.
     *
     * Answering something puts it in `seen`, and `seen` is what stops the rotation handing out a word twice -- so
     * without this, answering the word of the day made it stop being the word of the day, and the page showed a
     * different word a moment later. Recording the day's pick keeps both rules: today is stable, and tomorrow moves
     * on.
     */
    if (state.picks?.day === day && state.picks.ids.length > 0) {
      const held = state.picks.ids.map((id) => contentById(id)).filter((one): one is LearningItem => one !== null && appropriate(one, band))
      if (held.length > 0) {
        return {
          word: held.find((one) => one.kind === 'word') ?? null,
          mix: held.filter((one) => one.kind !== 'word'),
          due: dueCount(reviews, Date.now()),
          dueItems: due.map((one) => ({ item: contentById(one.itemId), review: one })).filter((one): one is { item: LearningItem; review: LearningReview } => one.item !== null)
        }
      }
    }

    const seen = new Set(state.seen)
    const word = itemForDay(mine, 'word', day, seen, band, difficulty)
    const mix = (['concept', 'fact', 'teaser', 'quiz'] as const)
      .map((kind) => itemForDay(mine, kind, day, new Set([...seen, ...(word ? [word.id] : [])]), band, difficulty))
      .filter((one): one is LearningItem => one !== null)
    await this.store.state.write({ ...state, picks: { day, ids: [...(word ? [word.id] : []), ...mix.map((one) => one.id)] } })
    return {
      word,
      mix,
      due: dueCount(reviews, Date.now()),
      dueItems: due.map((one) => ({ item: contentById(one.itemId), review: one })).filter((one): one is { item: LearningItem; review: LearningReview } => one.item !== null)
    }
  }

  /** A piece of learning answered. The only path that touches the learning streak. */
  async answer(itemId: string, answer: Answer, options: { correct?: boolean; given?: string } = {}): Promise<{ ok: boolean; xp: number; nextDue: number | null }> {
    const item = contentById(itemId)
    const prefs = await this.store.prefs.read()
    const band = bandFor(prefs.dob, new Date())
    if (!item) return { ok: false, xp: 0, nextDue: null }
    // Checked again here, not only where it was shown: an id can arrive from anywhere.
    if (!appropriate(item, band)) return { ok: false, xp: 0, nextDue: null }

    const at = Date.now()
    const reviews = await this.store.reviews.read()
    const held = reviews.find((one) => one.itemId === itemId) ?? newReview(itemId, this.store.who(), item.difficulty, at)
    const next = answerReview(held, answer, at)
    await this.store.reviews.write([next, ...reviews.filter((one) => one.itemId !== itemId)].slice(0, 5000))

    const state = await this.store.state.read()
    let events: readonly XPEvent[] = await this.store.xp.all()
    const keys = new Set(events.map((one) => one.key))
    const source = item.kind === 'word' ? 'word' : item.kind === 'quiz' ? 'quiz' : item.kind === 'teaser' ? 'teaser' : 'review'
    const amount = XP_VALUES[source]
    // Keyed on the day as well as the item, so reviewing something again tomorrow pays and clicking twice does not.
    const out = award(events, keys, this.store.who(), { source, amount, sourceId: itemId, key: `learn:${itemId}:${dayKey(at)}`, subject: item.subject, at, id: randomUUID() })
    events = out.events

    if (item.kind === 'quiz' && typeof options.correct === 'boolean') {
      await this.store.attempts.put({
        id: randomUUID(),
        profileId: this.store.who(),
        itemId,
        subject: item.subject,
        correct: options.correct,
        answer: (options.given ?? '').slice(0, 500),
        at,
        sessionId: state.session?.id ?? null
      })
    }

    const attempts = await this.store.attempts.all()
    const day = dayKey(at)
    let streaks = state.streaks
    if (learningDayCounts([next], attempts, day)) {
      streaks = streaks.map((one) => (one.kind === 'learning' ? countDay(one, day) : one))
    }
    let quests: readonly QuestProgress[] = advanceQuests(state.quests, item.kind === 'word' ? 'words' : item.kind === 'quiz' ? 'quizzes' : 'learning-items', 1, at)
    quests = advanceQuests(quests, 'reviews', 1, at)
    const settled = await this.settleQuests(quests, events, new Set(events.map((one) => one.key)), at)

    const subjects = item.subject ? bumpSubject(state.subjects, item.subject, { conceptsReviewed: 1, quizzes: item.kind === 'quiz' ? 1 : 0, at }) : state.subjects
    await this.store.xp.replace(settled.events.map((one) => one))
    await this.store.state.write({ ...state, streaks, quests: [...settled.quests], subjects, seen: [...new Set([itemId, ...state.seen])].slice(0, 2000) })

    bus.publish('study.learning.completed', { itemId, kind: item.kind }, { source: 'student', profileId: this.store.who() })
    this.changed()
    return { ok: true, xp: out.awarded + settled.awarded, nextDue: next.dueAt }
  }

  // ---------------------------------------------------------------- what the screen shows

  async snapshot(): Promise<StudentSnapshot> {
    const [prefs, orbi, state, goals, tasks, sessions, events, reviews, distractions] = await Promise.all([
      this.store.prefs.read(),
      this.store.orbi.read(),
      this.store.state.read(),
      this.store.goals.all(),
      this.store.tasks.all(),
      this.store.sessions.all(),
      this.store.xp.all(),
      this.store.reviews.read(),
      this.store.distractions.all()
    ])
    const at = Date.now()
    const session = state.session && !isOver(state.session.state) ? state.session : null
    const attempts = await this.store.attempts.all()
    const day = dayKey(at)
    return {
      preferences: prefs,
      orbi,
      band: bandFor(prefs.dob, new Date(at)),
      session,
      policyState: policyStateOf(session),
      timer: session ? timerView(session) : null,
      level: levelFor(totalXp(events)),
      streaks: state.streaks.map((one) => streakNow(one, at)),
      quests: questsNow(state.quests, at),
      today: recapFor(day, sessions, events, tasks, learningOnDay(reviews, attempts, day), attempts.filter((one) => dayKey(one.at) === day).length),
      goals: goals.filter((one) => one.state === 'active'),
      queue: studyQueue(tasks, at).slice(0, 12),
      due: dueCount(reviews, at),
      waiting: distractions.filter((one) => one.state === 'waiting').length,
      records: state.records,
      achievements: state.achievements,
      /*
       * Worked out here rather than in the interface.
       *
       * Both halves then agree about whether a record is close, and the interface never has to hold a second copy
       * of the rule for when it is worth saying.
       */
      record: watchRecord(session, state.records, recapFor(day, sessions, events, tasks, 0, 0).focusedSeconds),
      extraMinutes: state.extraMinutes.day === day ? state.extraMinutes.used : 0,
      canExtend: offerExtraMinute(session, state.extraMinutes.day === day ? state.extraMinutes.used : 0),
      recommendation: recommend(sessions, { queue: studyQueue(tasks, at), fallbackMinutes: prefs.defaultMinutes, fallbackLevel: prefs.defaultLevel, now: at })
    }
  }

  /** Everything the progress pages show, worked out rather than stored. */
  async progress(): Promise<{
    goals: { goal: Goal; progress: ReturnType<typeof goalProgress> }[]
    insights: ReturnType<typeof insights>
    subjects: readonly SubjectProgress[]
    sessions: readonly FocusSession[]
    months: readonly string[]
    sky: ReturnType<typeof constellation>
  }> {
    const [goals, tasks, sessions, state] = await Promise.all([this.store.goals.all(), this.store.tasks.all(), this.store.sessions.all(), this.store.state.read()])
    const at = Date.now()
    return {
      goals: goals.map((goal) => ({ goal, progress: goalProgress(goal, tasks, at) })),
      insights: insights(sessions, tasks, at),
      subjects: [...state.subjects].sort((a, b) => b.focusedSeconds - a.focusedSeconds),
      sky: constellation(goals, state.subjects),
      sessions: [...sessions].sort((a, b) => b.startedAt - a.startedAt).slice(0, 400),
      months: [...new Set(sessions.map((one) => monthKey(one.startedAt)))].sort().reverse()
    }
  }

  async preview(draft: PolicyDraft): Promise<ReturnType<typeof previewPolicy>> {
    const prefs = await this.store.prefs.read()
    return previewPolicy(
      snapshotPolicy({
        ...draft,
        blocked: draft.blocked ?? prefs.blockedCategories,
        approved: draft.approved ?? prefs.approvedSites,
        youtube: draft.youtube ?? prefs.youtube
      })
    )
  }

  // ---------------------------------------------------------------- settings, onboarding and starting over

  async savePreferences(patch: unknown): Promise<void> {
    const held = await this.store.prefs.read()
    const next = patchPreferences(held, patch, Date.now())
    await this.store.prefs.write(next)
    // A running session keeps the policy it started with, so this only changes what happens next. The one exception
    // is safety, which is not part of a session and is re-applied at once.
    await this.reapply()
    this.changed()
  }

  async onboard(answers: Onboarding): Promise<void> {
    const held = await this.store.prefs.read()
    await this.store.prefs.write(applyOnboarding(held, answers, Date.now()))
    await this.reapply()
    this.changed()
  }

  /** Marks today as a rest day, which costs nothing. */
  async restDay(): Promise<void> {
    const state = await this.store.state.read()
    const day = dayKey(Date.now())
    await this.store.state.write({ ...state, streaks: state.streaks.map((one) => markRestDay(one, day)) })
    this.say('rest-day')
    this.changed()
  }

  /**
   * Starting part of it over.
   *
   * Each scope is exactly what it says and nothing more. Nothing here touches the browser profile, the browsing
   * history or any Orbis setting outside Student -- which is the thing somebody is actually afraid of when they press
   * a reset button.
   */
  async reset(scope: ResetScope): Promise<void> {
    const at = Date.now()
    const state = await this.store.state.read()
    switch (scope) {
      case 'xp':
        await this.store.xp.replace([])
        await this.store.state.write({ ...state, subjects: state.subjects.map((one) => ({ ...one, xp: 0 })) })
        break
      case 'achievements':
        await this.store.state.write({ ...state, achievements: [] })
        break
      case 'goals':
        await this.store.goals.replace([])
        await this.store.tasks.replace([])
        break
      case 'learning':
        await this.store.reviews.write([])
        await this.store.attempts.replace([])
        await this.store.flashcards.replace([])
        await this.store.mistakes.replace([])
        await this.store.confusions.replace([])
        await this.store.state.write({ ...state, seen: [], streaks: state.streaks.map((one) => (one.kind === 'learning' ? { ...one, current: 0, longest: 0, lastDay: null, days: [] } : one)) })
        break
      case 'focus-history':
        await this.store.sessions.replace([])
        await this.store.state.write({ ...state, records: (await import('../../shared/student/progress.ts')).emptyRecords(), streaks: state.streaks.map((one) => (one.kind === 'focus' ? { ...one, current: 0, longest: 0, lastDay: null, days: [] } : one)) })
        break
      case 'orbi':
        await this.store.orbi.write({ ...(await import('../../shared/student/orbi.ts')).newOrbi(this.store.who(), at) })
        break
      case 'distractions':
        await this.store.distractions.replace([])
        await this.store.thoughts.replace([])
        break
      case 'everything': {
        const { emptyRecords } = await import('../../shared/student/progress.ts')
        const { newOrbi } = await import('../../shared/student/orbi.ts')
        const { defaultPreferences } = await import('../../shared/student/prefs.ts')
        await Promise.all([
          this.store.xp.replace([]),
          this.store.sessions.replace([]),
          this.store.goals.replace([]),
          this.store.tasks.replace([]),
          this.store.capsules.replace([]),
          this.store.spaces.replace([]),
          this.store.distractions.replace([]),
          this.store.thoughts.replace([]),
          this.store.flashcards.replace([]),
          this.store.attempts.replace([]),
          this.store.mistakes.replace([]),
          this.store.confusions.replace([]),
          this.store.concepts.replace([]),
          this.store.resources.replace([]),
          this.store.notes.replace([]),
          this.store.boards.replace([]),
          this.store.reviews.write([]),
          this.store.orbi.write(newOrbi(this.store.who(), at)),
          this.store.prefs.write(defaultPreferences(at))
        ])
        await this.store.state.write({
          session: null,
          beat: null,
          streaks: state.streaks.map((one) => ({ ...one, current: 0, longest: 0, lastDay: null, days: [], restDays: [] })),
          records: emptyRecords(),
          quests: [],
          achievements: [],
          subjects: [],
          seen: [],
          picks: null,
          extraMinutes: { day: '', used: 0 },
          interventions: (await import('../../shared/student/decide.ts')).newLog(''),
          plans: {},
          /*
           * The time somebody set aside is their data too, so clearing everything clears it.
           *
           * Keeping it looked harmless and was not: a fresh start would quietly plan a week against last term's
           * timetable, and nothing on screen would say where those hours came from.
           */
          availability: {},
          sitting: { longest: 50, breakMinutes: 10 },
          // The run and the surprise are part of a day's play, so clearing everything clears them too.
          combo: newCombo('', ''),
          lastSurpriseDay: null,
          // Exam mode and the record of stage attempts are this student's too: clearing everything clears them.
          exam: EXAM_OFF,
          rejectedQuestions: [],
          progression: emptyProgression(),
          briefings: { morning: null, evening: null },
          lastSeenDay: null,
          version: state.version
        })
        break
      }
    }
    await this.reapply()
    this.changed()
  }

  // ---------------------------------------------------------------- the learning brain

  /**
   * The mastery of every concept, as a map.
   *
   * Kept in the concept store rather than its own file, because mastery and the concept it is about are never
   * useful apart. Read through the same guards as everything else: a row that cannot be read becomes a fresh
   * record rather than a wrong one.
   */
  private async masteryMap(): Promise<Map<string, Mastery>> {
    const rows = await this.store.concepts.all()
    const out = new Map<string, Mastery>()
    for (const row of rows) {
      out.set(row.id, row.measured ?? newMastery(row.id, row.lastTouchedAt || Date.now()))
    }
    return out
  }

  /** The knowledge graph, built from the concept store. */
  private async graph(): Promise<Graph> {
    const rows = await this.store.concepts.all()
    const chapters = new Map<string, { id: string; name: string; subject: string; order: number }>()
    const concepts = rows.map((row, index) => {
      const chapterId = row.chapterId ?? `chapter:${row.subject ?? 'general'}`
      const chapterName = row.chapterName || row.subject || 'General'
      if (!chapters.has(chapterId)) chapters.set(chapterId, { id: chapterId, name: chapterName, subject: row.subject ?? 'General', order: chapters.size })
      return {
        id: row.id,
        name: row.name,
        chapterId,
        requires: row.prerequisites,
        difficulty: row.difficulty,
        importance: row.importance,
        order: row.order || index
      }
    })
    return { chapters: [...chapters.values()], concepts }
  }

  /**
   * One thing the student did, recorded against a concept.
   *
   * The only way mastery moves. Everything else -- the planner, the recommendations, the revision schedule -- reads
   * what this wrote, so there is one place evidence enters and one definition of what counts as evidence.
   */
  async learned(conceptId: string, kind: EvidenceKind): Promise<{ ok: boolean; mastery?: Mastery; said?: string }> {
    const row = await this.store.concepts.get(conceptId)
    if (!row) return { ok: false, said: 'Orbis does not know that concept.' }
    const at = Date.now()
    const before = row.measured ?? newMastery(conceptId, at)
    const after = recordEvidence(before, kind, at)
    // Both written together: `measured` is the real record, `mastery` the one number screens show.
    await this.store.concepts.put({ ...row, lastTouchedAt: at, measured: after, mastery: overall(after) })

    if (row.subject) {
      const state = await this.store.state.read()
      await this.store.state.write({ ...state, subjects: bumpSubject(state.subjects, row.subject, { conceptsReviewed: 1, at }) })
    }
    bus.publish('study.learning.completed', { conceptId, kind }, { source: 'student', profileId: this.store.who() })
    this.changed()
    return { ok: true, mastery: after, said: describeMastery(after) }
  }

  /** What is weak, what is strong, and what is merely inconsistent. All from measured evidence. */
  async learning(): Promise<{
    weak: readonly { conceptId: string; name: string; subject: string | null; need: number; why: string; state: string }[]
    strong: readonly { conceptId: string; name: string; score: number }[]
    confused: readonly { conceptId: string; name: string; swing: number }[]
    tree: ReturnType<typeof tree>
    subjects: readonly string[]
  }> {
    const [mastery, graph, rows] = await Promise.all([this.masteryMap(), this.graph(), this.store.concepts.all()])
    const at = Date.now()
    const nameOf = (id: string): string => rows.find((one) => one.id === id)?.name ?? id
    const subjectOf = (id: string): string | null => rows.find((one) => one.id === id)?.subject ?? null
    return {
      weak: weaknesses([...mastery.values()], at).map((one) => ({ ...one, name: nameOf(one.conceptId), subject: subjectOf(one.conceptId) })),
      strong: strengths([...mastery.values()]).map((one) => ({ conceptId: one.conceptId, name: nameOf(one.conceptId), score: one.score })),
      confused: confusions([...mastery.values()]).map((one) => ({ conceptId: one.conceptId, name: nameOf(one.conceptId), swing: one.swing })),
      tree: tree(graph, mastery),
      subjects: subjectsOf(graph)
    }
  }

  /** Whether a concept is ready to be worked on, or whether something underneath it comes first. */
  async readyTo(conceptId: string): Promise<{ ready: boolean; instead: { id: string; name: string } | null; why: string; blockers: readonly { id: string; name: string; score: number }[]; untouched: readonly { id: string; name: string }[] }> {
    const [graph, mastery] = await Promise.all([this.graph(), this.masteryMap()])
    const out = readyFor(graph, conceptId, mastery)
    const blocked = blockedBy(graph, conceptId, mastery)
    return {
      ready: out.ready,
      instead: out.instead ? { id: out.instead.id, name: out.instead.name } : null,
      why: out.why,
      blockers: blocked.blockers.map((one) => ({ id: one.concept.id, name: one.concept.name, score: one.score })),
      untouched: blocked.untouched.map((one) => ({ id: one.id, name: one.name }))
    }
  }

  /** What it would take to claim mastery of something, and what is still missing. */
  async proveMastery(conceptId: string): Promise<ReturnType<typeof proof> | null> {
    const mastery = await this.masteryMap()
    const held = mastery.get(conceptId)
    return held ? proof(held) : null
  }

  /** A syllabus turned into chapters and concepts, with anything unreadable reported. */
  /**
   * The topics Orbis can see in a piece of the student's own material.
   *
   * Found, not understood: this returns candidates with the reason each one looked like a heading, and adds nothing
   * anywhere. Adding is a separate step the student takes by ticking.
   */
  topicsIn(text: string): Found {
    return topicsIn(text)
  }

  /** The ticked topics, added through the same importer a typed syllabus goes through. */
  async addTopics(subject: string, chapter: string, names: readonly string[]): Promise<{ added: number; chapters: number; skipped: readonly string[] }> {
    if (names.length === 0) return { added: 0, chapters: 0, skipped: [] }
    return this.importSyllabus(asSyllabus(subject, chapter, names))
  }

  async importSyllabus(text: string): Promise<{ added: number; chapters: number; skipped: readonly string[] }> {
    const at = Date.now()
    const { graph, skipped } = readSyllabus(text, at)
    const existing = await this.graph()
    const merged = mergeGraph(existing, graph)
    const have = new Set(existing.concepts.map((one) => one.id))
    let added = 0
    for (const concept of merged.concepts) {
      if (have.has(concept.id)) continue
      const chapter = merged.chapters.find((one) => one.id === concept.chapterId)
      await this.store.concepts.put({
        id: concept.id,
        profileId: this.store.who(),
        name: concept.name,
        subject: chapter?.subject ?? null,
        // Nothing measured yet, and nothing pretended: a freshly imported topic reads as not started.
        mastery: 0,
        measured: null,
        prerequisites: concept.requires,
        related: [],
        chapterId: concept.chapterId,
        chapterName: chapter?.name ?? '',
        difficulty: concept.difficulty,
        importance: concept.importance,
        order: concept.order,
        lastTouchedAt: 0,
        notes: ''
      })
      added += 1
    }
    this.changed()
    return { added, chapters: merged.chapters.length - existing.chapters.length, skipped }
  }

  // ---------------------------------------------------------------- planning

  /** Everything the planner needs, gathered once. */
  private async planInput(): Promise<PlanInput> {
    const [graph, mastery, state, sessions] = await Promise.all([this.graph(), this.masteryMap(), this.store.state.read(), this.store.sessions.all()])
    const lastStudied: Record<string, number> = {}
    for (const one of sessions) {
      if (!one.subject) continue
      lastStudied[one.subject] = Math.max(lastStudied[one.subject] ?? 0, one.startedAt)
    }
    const goals = await this.store.goals.all()
    const availability: Availability = { minutes: state.availability, longestSession: state.sitting.longest, breakMinutes: state.sitting.breakMinutes }
    return {
      graph,
      mastery,
      availability,
      // Exams and deadlines both come from goals with a date on them: one place a date is kept.
      exams: goals
        .filter((one) => one.deadline !== null && one.horizon === 'long-term' && one.state === 'active')
        .map<Exam>((one) => ({
          id: one.id,
          name: one.title,
          day: dayKey(one.deadline as number),
          subjects: one.subject ? [one.subject] : [],
          chapterIds: [],
          /*
           * Exam mode is what this does to the plan.
           *
           * The chosen paper counts full and the others count less, so its subject comes first and the rest keep
           * their place rather than disappearing -- a student with two exams has not stopped having the second one.
           */
          importance: state.exam.goalId === null || state.exam.goalId === one.id ? 1 : 0.5
        })),
      deadlines: goals
        .filter((one) => one.deadline !== null && one.horizon !== 'long-term' && one.state === 'active')
        .map<Deadline>((one) => ({ id: one.id, title: one.title, day: dayKey(one.deadline as number), subject: one.subject, minutesLeft: 60, importance: 0.7 })),
      subjects: subjectsOf(graph),
      lastStudied,
      now: Date.now()
    }
  }

  /** Today, and the days after it. Never more than the time the student said they have. */
  async plan(days = 7): Promise<{ days: ReturnType<typeof planDay>[]; radar: ReturnType<typeof radar>; availability: Readonly<Record<string, number>> }> {
    const input = await this.planInput()
    return { days: planAhead(input, days), radar: radar(input), availability: input.availability.minutes }
  }

  /** How much time there is, which is the one thing the planner cannot work out for itself. */
  async setAvailability(minutes: Readonly<Record<string, number>>, sitting?: { longest?: number; breakMinutes?: number }): Promise<void> {
    const state = await this.store.state.read()
    const clean: Record<string, number> = { ...state.availability }
    for (const [day, value] of Object.entries(minutes).slice(0, 400)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      if (value <= 0) delete clean[day.slice(0, 10)]
      else clean[day.slice(0, 10)] = Math.max(0, Math.min(960, Math.round(value)))
    }
    await this.store.state.write({
      ...state,
      availability: clean,
      sitting: {
        longest: Math.max(5, Math.min(240, sitting?.longest ?? state.sitting.longest)),
        breakMinutes: Math.max(0, Math.min(60, sitting?.breakMinutes ?? state.sitting.breakMinutes))
      }
    })
    this.changed()
  }

  /** The plan reshaped after a missed day. Nothing is piled on top of tomorrow. */
  async replanFrom(day: string): Promise<ReturnType<typeof replan>> {
    const input = await this.planInput()
    const state = await this.store.state.read()
    const missed = (state.plans[day] ?? []).filter((one) => one.state === 'planned') as PlanItem[]
    const out = replan(input, missed, 7)
    await this.store.state.write({ ...state, plans: { ...state.plans, [day]: (state.plans[day] ?? []).map((one) => (one.state === 'planned' ? { ...one, state: 'moved' as const } : one)) } })
    this.changed()
    return out
  }

  /** A way back when a lot has been missed, with what will not fit said plainly. */
  async recoveryPlan(until: string): Promise<ReturnType<typeof recovery>> {
    return recovery(await this.planInput(), until)
  }

  /** What to do with very little time. Never presented as a substitute for a session. */
  async short(minutes: number): Promise<ReturnType<typeof shortPlan>> {
    return shortPlan(await this.planInput(), minutes)
  }

  // ---------------------------------------------------------------- the decision

  /** Everything the decision engine is told, gathered once. */
  /**
   * One notification, if the student is actually willing to be told.
   *
   * Every notification goes through here, because the alternative -- each call site checking the settings itself --
   * is how a "quiet hours" setting ends up applying to four of the seven things that interrupt somebody.
   *
   * The order is the point:
   *
   *   off              nothing, ever.
   *   quiet until      the student asked for silence a moment ago. Only something about the session they are in gets
   *                    through, because that is work they started and are waiting on.
   *   quiet hours      the same rule, for the hours they said.
   *   important only   the default: anything not marked important waits for them to look.
   *   focus only       only the session.
   *
   * Nothing here can be bypassed by passing `important`, except for the two cases above that are genuinely about
   * the session in front of them -- a timer finishing is not an interruption, it is the thing they asked for.
   */
  private async tell(notice: { title: string; body: string; kind: 'focus' | 'learning' | 'progress' | 'problem'; important: boolean }): Promise<void> {
    const prefs = await this.store.prefs.read()
    if (prefs.notifications === 'off') return
    const at = Date.now()
    const aboutThisSession = notice.kind === 'focus' && notice.important
    if (prefs.quietUntil !== null && at < prefs.quietUntil && !aboutThisSession) return
    if (insideQuietHours(prefs.quietHours, at) && !aboutThisSession) return
    if (prefs.notifications === 'focus' && notice.kind !== 'focus') return
    if (prefs.notifications === 'important' && !notice.important) return
    this.hooks.notify?.(notice)
  }

  /** Silence for a while, by the student's own hand. Expires by itself; nothing is muted for ever by accident. */
  async quietFor(minutes: number): Promise<{ until: number }> {
    const clamped = Math.max(5, Math.min(480, Math.round(minutes)))
    const until = Date.now() + clamped * 60_000
    const prefs = await this.store.prefs.read()
    await this.store.prefs.write({ ...prefs, quietUntil: until })
    this.changed()
    return { until }
  }

  /** Back to normal, before the quiet time was up. */
  async endQuiet(): Promise<void> {
    const prefs = await this.store.prefs.read()
    await this.store.prefs.write({ ...prefs, quietUntil: null })
    this.changed()
  }

  private async decideInput(busy?: { typing?: boolean; reading?: boolean; quizzing?: boolean; waitingOnOrion?: boolean }, tabs?: readonly { url: string; title: string }[]): Promise<DecideInput> {
    const plan = await this.planInput()
    const [state, sessions, tasks, prefs] = await Promise.all([this.store.state.read(), this.store.sessions.all(), this.store.tasks.all(), this.store.prefs.read()])
    const at = Date.now()
    const day = dayKey(at)
    const finished = sessions.filter((one) => counts(one)).sort((a, b) => b.startedAt - a.startedAt)
    const today = sessions.filter((one) => dayKey(one.startedAt) === day)
    const session = state.session && !isOver(state.session.state) ? state.session : null
    const interrupted = state.session && state.session.state === 'interrupted' ? state.session : null
    return {
      ...plan,
      session,
      busy: { typing: busy?.typing === true, reading: busy?.reading === true, quizzing: busy?.quizzing === true, waitingOnOrion: busy?.waitingOnOrion === true },
      tasks,
      daysAway: finished[0] ? Math.max(0, Math.round((at - finished[0].startedAt) / 86_400_000)) : 0,
      today: {
        focusedSeconds: today.reduce((sum, one) => sum + one.focusedSeconds, 0),
        sessions: today.length,
        completed: today.filter((one) => one.state === 'completed').length,
        plannedMinutes: (state.plans[day] ?? []).filter((one) => one.kind !== 'break').reduce((sum, one) => sum + one.minutes, 0)
      },
      record: watchRecord(session, state.records, today.reduce((sum, one) => sum + one.focusedSeconds, 0)),
      tabs: tabs ?? this.hooks.tabs?.() ?? [],
      interrupted,
      log: state.interventions,
      /*
       * The hours the student actually chose, plus whatever silence they asked for a moment ago.
       *
       * `notifications: 'off'` is a whole quiet day, which is the one case where a range covering everything is the
       * honest answer rather than a bug.
       */
      quietHours:
        prefs.notifications === 'off' || (prefs.quietUntil !== null && at < prefs.quietUntil) ? { from: 0, to: 23 } : prefs.quietHours,
      // Quiet while a paper is close and the student asked for quiet. Asking still gets an answer.
      paused: prefs.orbi.messages === 'off' || (state.exam.goalId !== null && state.exam.quieter),
      idleMinutes: 10
    }
  }

  /**
   * The one thing worth doing right now, or nothing.
   *
   * `asked` is the difference between answering and intruding: a student who opened the dashboard came looking, so
   * neither the budget nor quiet hours apply. Everything else goes through both.
   */
  async nextBest(options: { asked?: boolean; busy?: { typing?: boolean; reading?: boolean; quizzing?: boolean; waitingOnOrion?: boolean }; tabs?: readonly { url: string; title: string }[] } = {}): Promise<Intervention> {
    const input = await this.decideInput(options.busy, options.tabs)
    const out = options.asked ? recommendNow(input) : decideNext(input)
    if (!options.asked && out.decision !== 'no-action') {
      const state = await this.store.state.read()
      await this.store.state.write({ ...state, interventions: logIntervention(state.interventions, out.decision, 'shown', Date.now(), out.priority) })
    }
    return out
  }

  /** What the student made of an intervention. This is what the engine learns from. */
  async interventionAnswered(decision: string, what: 'accepted' | 'dismissed'): Promise<void> {
    const state = await this.store.state.read()
    await this.store.state.write({ ...state, interventions: logIntervention(state.interventions, decision as never, what, Date.now(), 'normal') })
    this.changed()
  }

  /** Whether Orbi should appear by itself, and what it would say. */
  async appearance(busy?: { typing?: boolean; reading?: boolean }): Promise<{ appear: boolean; intervention: Intervention; why: string }> {
    const input = await this.decideInput(busy)
    const sessions = await this.store.sessions.all()
    const out = shouldAppear(input, usualHours(sessions))
    if (out.appear) {
      const state = await this.store.state.read()
      await this.store.state.write({ ...state, interventions: logIntervention(state.interventions, out.intervention.decision, 'shown', Date.now(), out.intervention.priority) })
    }
    return out
  }

  // ---------------------------------------------------------------- missions

  /** A concept turned into three or four steps somebody can start without deciding anything. */
  async mission(conceptId: string, minutes: number): Promise<Mission | null> {
    const [graph, mastery, rows] = await Promise.all([this.graph(), this.masteryMap(), this.store.concepts.all()])
    const concept = graph.concepts.find((one) => one.id === conceptId)
    if (!concept) return null
    const subject = rows.find((one) => one.id === conceptId)?.subject ?? null
    return missionFor(concept, mastery.get(conceptId) ?? null, minutes, Date.now(), subject)
  }

  /** The smallest useful thing, for when there is no time or no willingness. */
  async micro(conceptId?: string): Promise<Mission> {
    const [graph, mastery] = await Promise.all([this.graph(), this.masteryMap()])
    const concept = conceptId ? (graph.concepts.find((one) => one.id === conceptId) ?? null) : (weaknesses([...mastery.values()], Date.now(), 1)[0] ? (graph.concepts.find((one) => one.id === weaknesses([...mastery.values()], Date.now(), 1)[0].conceptId) ?? null) : null)
    return microFor(concept, concept ? (mastery.get(concept.id) ?? null) : null, Date.now())
  }

  /** A step finished, which is evidence about what the student can do. */
  async missionStep(mission: Mission, stepId: string, succeeded: boolean): Promise<{ mission: Mission; mastery?: Mastery }> {
    const next = finishStep(mission, stepId)
    const step = mission.steps.find((one) => one.id === stepId)
    if (!step || !mission.conceptId) return { mission: next }
    const kind = evidenceFrom(step, succeeded)
    if (!kind) return { mission: next }
    const out = await this.learned(mission.conceptId, kind)
    return { mission: next, mastery: out.mastery }
  }

  /** The same work, halved, for somebody who keeps abandoning it. */
  smallerMission(mission: Mission): Mission | null {
    return smaller(mission)
  }

  /** Another profile. Everything switches at once, including whatever the browser was being told. */
  async useProfile(profileId: string): Promise<void> {
    // A session belonging to the profile being left is put down first, so it is picked up again on return rather
    // than running on in somebody else's browser.
    await this.onQuit()
    await this.store.useProfile(profileId)
    this.hooks.enforce({ state: 'normal', blockedCategories: [], blockedHosts: [], approved: [], youtube: 'open', sessionId: null, band: 'unknown', safetyBlocked: [] })
    await this.start()
  }

  async flush(): Promise<void> {
    await this.store.flush()
  }

  // ---------------------------------------------------------------- Orbi, and the day

  /** What Orbi should say, published for whatever is drawing it. The rate limiting lives in the renderer's coach. */
  private say(event: MotivationEvent): void {
    this.hooks.announce?.()
    bus.publish('study.quest', { orbi: event }, { source: 'student-orbi', profileId: this.store.who() })
  }

  private moment(kind: string): void {
    this.lastMoment = { kind, at: Date.now() }
    this.hooks.announce?.()
  }

  /** The moment Orbi is reacting to, if it is recent enough to still be a reaction. */
  momentNow(): string | null {
    if (!this.lastMoment) return null
    return Date.now() - this.lastMoment.at < 8000 ? this.lastMoment.kind : null
  }

  /**
   * The day's housekeeping, done once a day.
   *
   * Three things, each at most once: noticing somebody has been away, the morning briefing and the evening summary.
   * Written down against the day so that opening Orbis six times does not mean six of anything -- a study tool that
   * greets you on every launch is one people stop launching.
   */
  private async noteTheDay(): Promise<void> {
    const state = await this.store.state.read()
    const prefs = await this.store.prefs.read()
    const at = Date.now()
    const day = dayKey(at)
    const part = partOfDay(at)
    let next = state

    if (state.lastSeenDay !== day) {
      const focus = state.streaks.find((one) => one.kind === 'focus')
      const away = focus ? awayDays(focus, at) : 0
      next = { ...next, lastSeenDay: day }
      if (away >= 3) this.say('comeback')
    }

    // Only when it was asked for, only in the right half of the day, and only once in it.
    if (prefs.briefingMorning && prefs.notifications !== 'off' && state.briefings.morning !== day && (part === 'morning' || part === 'afternoon')) {
      const brief = await this.briefing('morning')
      next = { ...next, briefings: { ...next.briefings, morning: day } }
      await this.tell({ title: brief.title, body: brief.body, kind: 'progress', important: false })
    }
    if (prefs.briefingEvening && prefs.notifications !== 'off' && state.briefings.evening !== day && (part === 'evening' || part === 'night')) {
      const brief = await this.briefing('evening')
      next = { ...next, briefings: { ...next.briefings, evening: day } }
      await this.tell({ title: brief.title, body: brief.body, kind: 'progress', important: false })
    }

    // Something due to come back round, said once a day and only if there is anything.
    if (prefs.learningReminders && prefs.notifications === 'all' && state.briefings.evening !== day) {
      const reviews = await this.store.reviews.read()
      const due = dueCount(reviews, at)
      if (due >= 3) await this.tell({ title: 'Something is due for review', body: `${due} things are ready to come back round.`, kind: 'learning', important: false })
    }

    if (next !== state) await this.store.state.write(next)
  }

  /**
   * What a briefing says.
   *
   * Counts and the next thing to do, and nothing else. No encouragement, no target somebody did not set, and nothing
   * about yesterday being a disappointment.
   */
  /**
   * The week or the month, counted from the records.
   *
   * Nothing is modelled and nothing is smoothed: the report says what is there, and says plainly when there is too
   * little there to talk about.
   */
  async report(span: 'week' | 'month'): Promise<Report> {
    const [sessions, xp, tasks, mastery, rows] = await Promise.all([
      this.store.sessions.all(),
      this.store.xp.all(),
      this.store.tasks.all(),
      this.masteryMap(),
      this.store.concepts.all()
    ])
    const names = new Map(rows.map((one) => [one.id, one.name]))
    return reportFor(span, Date.now(), { sessions, xp, tasks, mastery, nameOf: (id) => names.get(id) ?? id })
  }

  /**
   * The open tabs, kept as a space.
   *
   * Nothing is closed. Orbis has no business deciding which of somebody's twenty tabs they were finished with, and a
   * tidy-up that loses a page somebody needed is worse than the mess. So the addresses are saved, the student is told
   * where they went, and closing them stays their decision.
   */
  async tidyTabs(name?: string, options?: { sessionId?: string | null; closeAfter?: boolean }): Promise<{
    ok: boolean
    saved: number
    closed?: number
    spaceId?: string
    why?: string
  }> {
    const open = (this.hooks.tabs?.() ?? []).filter((one) => /^https?:/i.test(one.url))
    if (open.length === 0) return { ok: false, saved: 0, why: 'There are no pages open to save.' }
    const at = Date.now()
    // The same address twice is one page, however many tabs it is in.
    const seen = new Set<string>()
    const tabs = open.filter((one) => (seen.has(one.url) ? false : (seen.add(one.url), true))).slice(0, 200)
    const session = (await this.store.state.read()).session
    const space = await this.store.spaces.put({
      id: randomUUID(),
      profileId: this.store.who(),
      name: (name ?? (session?.subject ? `${session.subject} — ${new Date(at).toLocaleDateString()}` : `Tabs, ${new Date(at).toLocaleDateString()}`)).slice(0, 120),
      subject: session?.subject ?? null,
      tabs,
      items: [],
      notes: '',
      sessionId: options?.sessionId ?? null,
      capsuleIds: [],
      goalId: session?.goalId ?? null,
      atmosphere: null,
      playlistId: null,
      approved: [],
      favourite: false,
      lastUsedAt: 0,
      createdAt: at,
      updatedAt: at
    })
    /*
     * Closing them is a separate decision, and only ever the student's.
     *
     * Saved first, closed second, and only what was saved: if the save failed there is nothing to close, and if a
     * tab arrived after the save it is not in the list and is left alone. Anything that cannot be closed is counted
     * honestly rather than reported as done.
     */
    let closed = 0
    if (options?.closeAfter && this.hooks.closeTabs) {
      closed = await this.hooks.closeTabs(tabs.map((one) => one.url)).catch(() => 0)
    }
    this.changed()
    return { ok: true, saved: tabs.length, closed, spaceId: space.id }
  }

  /** The pages somebody had open before a session took the screen away. */
  async snapshotFor(sessionId: string): Promise<{ id: string; name: string; tabs: readonly { url: string; title: string }[] } | null> {
    const spaces = await this.store.spaces.all()
    const found = spaces.find((one) => one.sessionId === sessionId)
    return found ? { id: found.id, name: found.name, tabs: found.tabs } : null
  }

  // ---------------------------------------------------------------- getting stuck

  /**
   * A rung of the hint ladder.
   *
   * The content is always the student's own answer, cut or described -- Orbis writes nothing. Taking a rung is
   * recorded nowhere by itself: what it changes is what the *attempt* proves, which `attempted` works out.
   */
  hint(rung: Rung, question: { ask: string; answer: string; source: 'flashcard' | 'mistake' | 'review'; where?: string | null }): Hint {
    return hintFor(rung, question)
  }

  /**
   * One attempt, with however much help was taken.
   *
   * The evidence recorded depends on the deepest rung reached, and somebody who looked the answer up has their
   * attempt recorded as reading rather than as a failure -- they did not fail, they looked it up.
   */
  async attempted(options: { conceptId?: string | null; right: boolean; rungs?: readonly Rung[]; sittingId?: string }): Promise<{
    kind: ReturnType<typeof evidenceAfterHints>
    retry: Retry
    run: number
    xp: number
    says: string | null
  }> {
    const kind = evidenceAfterHints(options.right, options.rungs ?? [])
    if (options.conceptId && kind) await this.learned(options.conceptId, kind).catch(() => undefined)
    const mastery = options.conceptId ? (await this.masteryMap()).get(options.conceptId) : null
    const retry = retryAfter(mastery?.wrongRun ?? (options.right ? 0 : 1))
    /*
     * The run only counts an answer that was reached without being shown.
     *
     * A run built out of revealed answers would make the most help-seeking session look like the best one.
     */
    const earned = options.right && kind === 'recalled'
    const combo = await this.answeredOne(earned, options.sittingId ?? '')
    return { kind, retry, run: combo.run, xp: combo.xp, says: combo.says }
  }

  /**
   * A card practised: the count on the card, and the evidence on the concept it names.
   *
   * A card with no concept still counts as practice -- the student sees their own record of it -- it simply does not
   * claim anything about a topic. That is the honest reading: nobody said what this card is about.
   */
  async practisedCard(
    cardId: string,
    right: boolean,
    rungs: readonly Rung[],
    sittingId: string
  ): Promise<{ ok: boolean; practised: number; recalled: number; kind: ReturnType<typeof evidenceAfterHints>; run: number; xp: number; says: string | null }> {
    const card = await this.store.flashcards.get(cardId)
    if (!card) return { ok: false, practised: 0, recalled: 0, kind: null, run: 0, xp: 0, says: null }
    const at = Date.now()
    const out = await this.attempted({ conceptId: card.conceptId, right, rungs, sittingId: sittingId || `cards:${dayKey(at)}` })
    const next = { ...card, practised: card.practised + 1, recalled: card.recalled + (right ? 1 : 0), lastPractisedAt: at }
    await this.store.flashcards.put(next)
    this.changed()
    return { ok: true, practised: next.practised, recalled: next.recalled, kind: out.kind, run: out.run, xp: out.xp, says: out.says }
  }

  /** What to explain back, and the points of their own note to tick afterwards. */
  teachBack(question: { ask: string; answer: string; conceptId?: string | null }): TeachBack {
    return teachBackFor(question)
  }

  /**
   * A finished teach-back.
   *
   * `lookedFirst` is the whole honesty of this: explaining with the note open is reading aloud, and it records
   * nothing rather than recording the strongest evidence Orbis has.
   */
  async taughtBack(options: { conceptId?: string | null; covered: number; outOf: number; lookedFirst: boolean }): Promise<{
    kind: ReturnType<typeof evidenceAfterTeachBack>
    says: string
  }> {
    const kind = evidenceAfterTeachBack(options.covered, options.outOf, options.lookedFirst)
    if (options.conceptId && kind) await this.learned(options.conceptId, kind).catch(() => undefined)
    return { kind, says: sayTeachBack(options.covered, options.outOf, options.lookedFirst) }
  }

  // ---------------------------------------------------------------- what Orion writes

  /**
   * Whether anything written is possible at all.
   *
   * Asked by every screen that offers it, so a student without a key sees the manual version rather than a button
   * that fails. "Not set up" and "it broke" are different answers and this is the first of them.
   */
  canGenerate(): boolean {
    return typeof this.hooks.ask === 'function'
  }

  /** The context a prompt needs about one concept: what it is, and which part of it is missing. */
  private async aboutConcept(conceptId: string): Promise<{
    name: string
    subject: string | null
    chapter: string | null
    missing: string | null
    mistakes: string[]
    confusions: string[]
  } | null> {
    const [graph, mastery, rows, mistakes, confusions] = await Promise.all([
      this.graph(),
      this.masteryMap(),
      this.store.concepts.all(),
      this.store.mistakes.all(),
      this.store.confusions.all()
    ])
    const concept = graph.concepts.find((one) => one.id === conceptId)
    if (!concept) return null
    const chapter = graph.chapters.find((one) => one.id === concept.chapterId)
    const held = mastery.get(conceptId)
    const weak = held ? weaknesses([held], Date.now(), 1)[0] : null
    const row = rows.find((one) => one.id === conceptId)
    return {
      name: concept.name,
      subject: chapter?.subject ?? row?.subject ?? null,
      chapter: chapter?.name ?? null,
      missing: weak?.why ?? null,
      // Only this topic's own mistakes: somebody's chemistry errors have no business in a physics explanation.
      mistakes: mistakes
        .filter((one) => one.concept.toLowerCase().includes(concept.name.toLowerCase()) || concept.name.toLowerCase().includes(one.concept.toLowerCase()))
        .slice(0, 5)
        .map((one) => `${one.concept}: ${one.detail}`),
      confusions: confusions
        .filter((one) => !one.resolvedAt)
        .slice(0, 5)
        .map((one) => `${one.concept}${one.note ? ` — ${one.note}` : ''}`)
    }
  }

  /**
   * Questions about one topic, written by Orion.
   *
   * Practice, not measurement: answering one records `quiz-right` or `quiz-wrong`, which nudge recall rather than
   * claiming it, and a question the student rejects is never asked again.
   */
  async quizMe(conceptId: string, howMany = 6): Promise<{ ok: boolean; questions: GeneratedQuestion[]; why?: string }> {
    if (!this.hooks.ask) return { ok: false, questions: [], why: 'Orion is not set up on this computer, so there is nothing to write questions with.' }
    const about = await this.aboutConcept(conceptId)
    if (!about) return { ok: false, questions: [], why: 'Orbis does not know that topic.' }

    const state = await this.store.state.read()
    const rejected = state.rejectedQuestions
    const raw = await this.hooks.ask(
      QUIZ_SYSTEM,
      quizPrompt({
        concept: about.name,
        subject: about.subject,
        chapter: about.chapter,
        howMany,
        missing: about.missing,
        avoid: rejected
      }),
      { maxTokens: 1800, timeoutMs: 45_000 }
    )
    if (!raw) return { ok: false, questions: [], why: 'Nothing came back. Try again in a moment.' }

    const at = Date.now()
    const questions = withoutRejected(readQuiz(raw, conceptId, (index) => `gen:${conceptId}:${at.toString(36)}:${index}`), rejected)
    return questions.length === 0
      ? { ok: false, questions: [], why: 'Orion did not write anything it was confident about for this topic.' }
      : { ok: true, questions }
  }

  /** An answer to a generated question. Lighter evidence, and only when the student says they had it. */
  async answeredGenerated(conceptId: string | null, right: boolean, sittingId: string): Promise<{ ok: boolean; run: number; xp: number; says: string | null }> {
    if (conceptId) await this.learned(conceptId, evidenceForGenerated(right)).catch(() => undefined)
    // A generated question never builds a run: a run is for producing your own material from memory.
    const combo = await this.answeredOne(false, sittingId)
    return { ok: true, run: combo.run, xp: 0, says: combo.says }
  }

  /** A question the student says was wrong or off-course. Never offered again, and nothing it touched is kept. */
  async rejectQuestion(ask: string, conceptId: string | null): Promise<{ ok: boolean; rejected: number }> {
    const state = await this.store.state.read()
    const held = state.rejectedQuestions
    const trimmed = ask.slice(0, 200)
    const next = [trimmed, ...held.filter((one) => one !== trimmed)].slice(0, 300)
    await this.store.state.write({ ...state, rejectedQuestions: next })
    bus.publish('study.questionRejected', { conceptId }, { source: 'student', profileId: this.store.who() })
    this.changed()
    return { ok: true, rejected: next.length }
  }

  /**
   * Cards drafted from a piece of the student's own material.
   *
   * Drafts, not cards: nothing is saved until the student keeps them, and what is kept carries `origin: 'orion'`
   * so it says who wrote it wherever it is shown.
   */
  async draftCards(material: string, options: { subject?: string | null; conceptId?: string | null; howMany?: number } = {}): Promise<{
    ok: boolean
    cards: DraftCard[]
    note: string | null
    why?: string
  }> {
    if (!this.hooks.ask) return { ok: false, cards: [], note: null, why: 'Orion is not set up on this computer.' }
    if (material.trim().length < 40) return { ok: false, cards: [], note: null, why: 'There is not enough there to make cards from.' }
    const raw = await this.hooks.ask(CARDS_SYSTEM, cardsPrompt(material, { subject: options.subject ?? null, howMany: options.howMany }), {
      maxTokens: 2400,
      timeoutMs: 60_000
    })
    if (!raw) return { ok: false, cards: [], note: null, why: 'Nothing came back. Try again in a moment.' }
    const out = readCards(raw, options.conceptId ?? null)
    return out.cards.length === 0
      ? { ok: false, cards: [], note: out.note, why: out.note ?? 'Orion could not find anything in there to make cards from.' }
      : { ok: true, ...out }
  }

  /** Keeping drafted cards. They become the student's own, and they say who wrote them. */
  async keepDrafts(cards: readonly { front: string; back: string; conceptId?: string | null; subject?: string | null; deck?: string }[]): Promise<{ kept: number }> {
    const at = Date.now()
    let kept = 0
    for (const card of cards.slice(0, 50)) {
      const front = card.front.trim().slice(0, 1000)
      const back = card.back.trim().slice(0, 2000)
      if (!front || !back) continue
      await this.store.flashcards.put({
        id: randomUUID(),
        profileId: this.store.who(),
        front,
        back,
        subject: card.subject ?? null,
        // Said plainly wherever the card is shown, for ever.
        origin: 'orion',
        deck: card.deck?.slice(0, 80) || 'Default',
        conceptId: card.conceptId ?? null,
        practised: 0,
        recalled: 0,
        lastPractisedAt: null,
        createdAt: at
      })
      kept += 1
    }
    this.changed()
    return { kept }
  }

  /**
   * A suggestion about which points an explanation covered.
   *
   * A suggestion and nothing more: the ticks the student confirms are what is recorded, and with no model the
   * screen falls back to them ticking it themselves, exactly as before.
   */
  async markExplanation(options: { about: string; points: readonly string[]; said: string }): Promise<{ ok: boolean; points: MarkedPoint[]; why?: string }> {
    if (!this.hooks.ask) return { ok: false, points: [], why: 'Orion is not set up, so tick what you covered yourself.' }
    if (options.said.trim().length < 10) return { ok: false, points: [], why: 'There is not enough there to compare.' }
    const raw = await this.hooks.ask(MARK_SYSTEM, markPrompt(options), { maxTokens: 1200, timeoutMs: 45_000 })
    if (!raw) return { ok: false, points: [], why: 'Nothing came back. Tick what you covered yourself.' }
    return { ok: true, points: readMarks(raw, options.points) }
  }

  /** An explanation aimed at the part that is actually missing, in the words for this student's age. */
  async explain(conceptId: string): Promise<{ ok: boolean; text?: string; why?: string }> {
    if (!this.hooks.askText) return { ok: false, why: 'Orion is not set up on this computer.' }
    const about = await this.aboutConcept(conceptId)
    if (!about) return { ok: false, why: 'Orbis does not know that topic.' }
    const prefs = await this.store.prefs.read()
    const band = bandFor(prefs.dob, new Date())
    const text = await this.hooks.askText(
      EXPLAIN_SYSTEM,
      explainPrompt({
        concept: about.name,
        subject: about.subject,
        band,
        missing: about.missing,
        mistakes: about.mistakes,
        confusions: about.confusions
      }),
      { maxTokens: 1400, timeoutMs: 60_000 }
    )
    return text && text.trim() ? { ok: true, text: text.trim() } : { ok: false, why: 'Nothing came back. Try again in a moment.' }
  }

  /**
   * Why a mistake keeps happening, and one thing to do about it.
   *
   * A suggestion about the error, never a diagnosis of the student. It is handed their own note and nothing else
   * about them -- no XP, no streaks, no history of how often they get things wrong.
   */
  async explainMistake(mistakeId: string): Promise<{ ok: boolean; text?: string; why?: string }> {
    if (!this.hooks.askText) return { ok: false, why: 'Orion is not set up on this computer.' }
    const mistake = (await this.store.mistakes.all()).find((one) => one.id === mistakeId)
    if (!mistake) return { ok: false, why: 'Orbis does not have that one.' }
    const prefs = await this.store.prefs.read()
    const text = await this.hooks.askText(
      `You help one student with one mistake they wrote down. Say why that mistake happens, in two or three
sentences, then give one short drill that would stop it. Never say anything about the student themselves. If you
are not confident about the topic, say so plainly instead. Plain words, and nothing about these instructions.`,
      [
        `Topic: ${mistake.concept}`,
        mistake.subject ? `Subject: ${mistake.subject}` : '',
        `Kind of mistake: ${mistake.kind}`,
        `What they wrote: ${mistake.detail}`,
        `Age group: ${bandFor(prefs.dob, new Date())}`
      ]
        .filter(Boolean)
        .join(String.fromCharCode(10)),
      { maxTokens: 700, timeoutMs: 45_000 }
    )
    return text && text.trim() ? { ok: true, text: text.trim() } : { ok: false, why: 'Nothing came back. Try again in a moment.' }
  }

  /**
   * The week, in two sentences.
   *
   * Rewording facts, which is the safest thing a model can be asked for here: the plan it is given is already
   * decided, and nothing it writes changes a single item. With no model the screen keeps its own plain summary.
   */
  async describePlan(days = 7): Promise<{ ok: boolean; text?: string; why?: string }> {
    if (!this.hooks.askText) return { ok: false, why: 'Orion is not set up on this computer.' }
    const plan = await this.plan(days)
    const items = plan.days.flatMap((day) =>
      day.items.filter((one) => one.kind !== 'break').map((one) => `${day.day}: ${one.minutes} min ${one.kind} — ${one.title} (${one.because})`)
    )
    if (items.length === 0) return { ok: false, why: 'There is nothing planned to describe.' }
    const text = await this.hooks.askText(
      `You put a study plan into two or three plain sentences for the student whose plan it is. Say what the week is
mostly about, what is heaviest, and anything that was left out. Change nothing and add nothing: every fact must be
in the plan you are given. No encouragement, no advice, no comment on the student.`,
      [...items.slice(0, 60), ...plan.days.flatMap((day) => day.leftOut.map((one) => `${day.day}: left out — ${one.title} (${one.why})`)).slice(0, 20)].join(String.fromCharCode(10)),
      { maxTokens: 500, timeoutMs: 45_000 }
    )
    return text && text.trim() ? { ok: true, text: text.trim() } : { ok: false, why: 'Nothing came back.' }
  }

  /** The structure Orion can see in a document. Proposed only: nothing is added until it is ticked. */
  async proposeStructure(material: string): Promise<{ ok: boolean; structure?: ProposedStructure; why?: string }> {
    if (!this.hooks.ask) return { ok: false, why: 'Orion is not set up on this computer.' }
    if (material.trim().length < 40) return { ok: false, why: 'There is not enough there to read.' }
    const raw = await this.hooks.ask(STRUCTURE_SYSTEM, structurePrompt(material), { maxTokens: 2000, timeoutMs: 60_000 })
    const structure = readStructure(raw)
    return structure && structure.chapters.length > 0
      ? { ok: true, structure }
      : { ok: false, why: 'Orion could not see a structure in that. The headings it finds by itself are still there.' }
  }

  // ---------------------------------------------------------------- a tutor that asks

  /** Whether looking at a photograph is possible at all. A different key from the writing, so a different question. */
  canLook(): boolean {
    return typeof this.hooks.askImage === 'function'
  }

  /**
   * The first question of a Socratic conversation.
   *
   * It is handed what the student already knows in this subject, so the first question starts from solid ground
   * rather than from the thing they are stuck on.
   */
  async socraticStart(conceptId: string): Promise<{ ok: boolean; conversation?: Conversation; say?: string; why?: string }> {
    if (!this.hooks.ask) return { ok: false, why: 'Orion is not set up on this computer.' }
    const about = await this.aboutConcept(conceptId)
    if (!about) return { ok: false, why: 'Orbis does not know that topic.' }
    const [prefs, mastery, graph] = await Promise.all([this.store.prefs.read(), this.masteryMap(), this.graph()])
    const knows = [...mastery.entries()]
      .filter(([, held]) => overall(held) >= 0.5)
      .map(([id]) => graph.concepts.find((one) => one.id === id)?.name)
      .filter((one): one is string => !!one)
      .slice(0, 8)

    const raw = await this.hooks.ask(
      SOCRATIC_SYSTEM,
      firstPrompt({ topic: about.name, subject: about.subject, band: bandFor(prefs.dob, new Date()), missing: about.missing, knows }),
      { maxTokens: 500, timeoutMs: 45_000 }
    )
    const reply = readReply(raw)
    if (!reply) return { ok: false, why: 'Nothing came back. Try again in a moment.' }

    const conversation: Conversation = {
      ...newConversation(conceptId, about.name),
      asked: reply.asking ? 1 : 0,
      turns: [{ who: 'orbis', text: reply.say }]
    }
    return { ok: true, conversation, say: reply.say }
  }

  /**
   * One more turn.
   *
   * The model proposes what to say; `advance` decides whether the conversation carries on -- the cap, the two
   * blanks and the finish are Orbis's rules, not a model's, because how long somebody has to be questioned is not
   * a decision a model should hold.
   */
  async socraticReply(conversation: Conversation, said: string): Promise<{
    ok: boolean
    conversation: Conversation
    say: string
    stop: null | 'told' | 'gave-up' | 'got-there'
    explanation?: string
  }> {
    if (!this.hooks.ask) {
      return { ok: false, conversation: { ...conversation, ended: 'told' }, say: 'Orion is not set up on this computer.', stop: 'told' }
    }
    const withStudent = { ...conversation, turns: [...conversation.turns, { who: 'student' as const, text: said.slice(0, 2000) }] }
    const raw = await this.hooks.ask(SOCRATIC_SYSTEM, `Topic: ${conversation.topic}\n\n${turnsPrompt(withStudent)}\n\nYour reply.`, {
      maxTokens: 500,
      timeoutMs: 45_000
    })
    const out = advance(conversation, said, readReply(raw))

    /*
     * When it stops without the student getting there, the explanation comes straight away.
     *
     * Stopping the questions and leaving somebody with nothing would be the worst of both: they have spent five
     * minutes and still do not know it.
     */
    let explanation: string | undefined
    if (out.stop === 'told' || out.stop === 'gave-up') {
      const written = await this.explain(conversation.conceptId)
      if (written.ok) explanation = written.text
    }

    if (out.conversation.ended) await this.socraticFinished(out.conversation)
    return { ok: true, conversation: out.conversation, say: out.say, stop: out.stop, explanation }
  }

  /** What a finished conversation records. Giving up records nothing: a badly pitched question is not evidence. */
  async socraticFinished(conversation: Conversation): Promise<{ kind: ReturnType<typeof evidenceForSocratic>; says: string }> {
    const kind = evidenceForSocratic(conversation.ended)
    if (kind) await this.learned(conversation.conceptId, kind).catch(() => undefined)
    return { kind, says: sayEnd(conversation.ended) }
  }

  // ---------------------------------------------------------------- looking at a photograph

  /**
   * What is in a picture of somebody's work.
   *
   * Read into text and topics, and nothing more: it never says whether the work is right. A model misreading a
   * minus sign and calling a correct answer wrong is the one failure here that would actively teach somebody the
   * wrong thing, and they would believe it because it looked at their page.
   *
   * The image is not stored. What comes back is text the student reads and decides about.
   */
  async readPhoto(image: string): Promise<{ ok: boolean; read?: ReadPhoto; next?: ReturnType<typeof whatNext>; why?: string }> {
    if (!this.hooks.askImage) return { ok: false, why: 'Looking at pictures is not set up on this computer.' }
    if (typeof image !== 'string' || image.length < 100) return { ok: false, why: 'That is not a picture Orbis can read.' }
    const raw = await this.hooks.askImage(PHOTO_SYSTEM, PHOTO_PROMPT, image, { json: true, maxTokens: 2000, timeoutMs: 90_000 })
    const read = readPhoto(raw)
    if (!read || read.kind === 'unreadable') return { ok: false, why: CANNOT_READ }
    return { ok: true, read, next: whatNext(read) }
  }

  // ---------------------------------------------------------------- the exam ahead

  /**
   * The next exam, what phase it is in, and what is worth the time left.
   *
   * Works whether or not exam mode is on: knowing a paper is in four days is useful on its own, and the mode is
   * about what Orbis *does* with that, not about whether it may say it.
   */
  async exam(goalId?: string | null): Promise<{ ahead: ExamAhead | null; settings: ExamSettings; changes: string[]; after: AfterExam | null }> {
    const [goals, graph, mastery, state] = await Promise.all([this.store.goals.all(), this.graph(), this.masteryMap(), this.store.state.read()])
    const ahead = examAhead(goals, graph, mastery, Date.now(), goalId ?? state.exam.goalId)

    /*
     * The day after, worked out rather than waited for.
     *
     * Nobody presses "my exam is over", so if the chosen exam's day has passed, the review is simply what this
     * returns instead of a countdown.
     */
    let after: AfterExam | null = null
    if (ahead && ahead.phase === 'after') {
      const goal = goals.find((one) => one.id === ahead.goalId)
      if (goal) after = afterExam(goal, graph, mastery, await this.store.sessions.all(), Date.now())
    }
    return { ahead, settings: state.exam, changes: whatChanges(state.exam), after }
  }

  /** Turning the mode on, or off. Always the student's press, and reversible in one. */
  async setExamMode(settings: { goalId: string | null; quieter?: boolean; longerSessions?: boolean }): Promise<ExamSettings> {
    const state = await this.store.state.read()
    const next: ExamSettings = settings.goalId
      ? {
          goalId: settings.goalId,
          since: state.exam.goalId === settings.goalId ? (state.exam.since ?? Date.now()) : Date.now(),
          quieter: settings.quieter ?? state.exam.quieter,
          longerSessions: settings.longerSessions ?? state.exam.longerSessions
        }
      : EXAM_OFF
    await this.store.state.write({ ...state, exam: next })
    bus.publish('study.examMode', { on: next.goalId !== null, goalId: next.goalId }, { source: 'student', profileId: this.store.who() })
    this.changed()
    return next
  }

  // ---------------------------------------------------------------- stages

  /** The stages of a subject, with what has been attempted. Suggestions, never doors. */
  async stages(subject: string): Promise<{ stages: Stage[]; next: Stage | null; through: ReturnType<typeof through> }> {
    const [graph, mastery, state] = await Promise.all([this.graph(), this.masteryMap(), this.store.state.read()])
    const all = stagesFor(graph, subject, mastery, state.progression)
    return { stages: all, next: nextStage(all), through: through(all) }
  }

  /** Every subject that has stages, for the screen that lists them. */
  async subjectsWithStages(): Promise<{ subject: string; passed: number; total: number; says: string }[]> {
    const [graph, mastery, state] = await Promise.all([this.graph(), this.masteryMap(), this.store.state.read()])
    const subjects = [...new Set(graph.chapters.map((one) => one.subject))]
    return subjects.map((subject) => {
      const all = stagesFor(graph, subject, mastery, state.progression)
      return { subject, ...through(all) }
    })
  }

  /**
   * The test for one stage.
   *
   * A chapter stage is the chapter test. A mixed or final stage draws from every chapter in the subject and asks
   * more questions -- but it is still built only from the student's own cards and mistakes, and still refuses with
   * a reason when there are not enough of them.
   */
  async stageChallenge(stageId: string, subject: string, options: { topUp?: boolean } = {}): Promise<Challenge | NotReady> {
    const [graph, mastery, cards, mistakes, state] = await Promise.all([
      this.graph(),
      this.masteryMap(),
      this.store.flashcards.all(),
      this.store.mistakes.all(),
      this.store.state.read()
    ])
    const stage = stagesFor(graph, subject, mastery, state.progression).find((one) => one.id === stageId)
    if (!stage) return { ready: false, why: 'Orbis does not know that stage.', need: 0, have: 0 }

    const inside = graph.concepts.filter((one) => stage.chapterIds.includes(one.chapterId))
    const out = challengeFor(
      { id: stage.id.replace('stage:', ''), name: stage.name, subject },
      inside,
      { cards, mistakes },
      mastery,
      Date.now(),
      // A paper across a whole subject asks more; the pass mark is still four fifths of what is actually asked.
      { most: stage.kind === 'chapter' ? 12 : stage.kind === 'mixed' ? 20 : 30, label: stage.name }
    )
    if ('questions' in out) return { ...out, stageId: stage.id, mix: describeMix(out.questions.length, 0) }

    /*
     * Not enough of the student's own material, and they asked for a top-up.
     *
     * Orion fills the gap rather than the test simply not existing -- and the mix is carried with it so the screen
     * can say "4 yours, 6 from Orion" rather than quietly passing off written questions as the student's own.
     */
    if (!options.topUp || !this.hooks.ask) return out

    const first = inside[0]
    if (!first) return out
    const generated = await this.quizMe(first.id, 8)
    if (!generated.ok || generated.questions.length === 0) return out

    const mine = out.have
    return {
      id: `challenge:${stage.id}:${dayKey(Date.now())}`,
      stageId: stage.id,
      chapterId: stage.id.replace('stage:', ''),
      chapterName: stage.name,
      subject,
      questions: generated.questions.map((one) => ({
        id: one.id,
        source: 'generated' as const,
        sourceId: one.id,
        ask: one.ask,
        answer: one.answer,
        conceptId: one.conceptId
      })),
      toPass: Math.max(3, Math.floor(generated.questions.length * 0.8)),
      xp: 10,
      createdAt: Date.now(),
      mix: describeMix(mine, generated.questions.length)
    }
  }

  /** A finished stage: the same settling as any challenge, plus the attempt on the record. */
  async stageDone(challenge: Challenge, right: readonly string[], stageId: string): Promise<{ passed: boolean; score: number; outOf: number; says: string; xp: number }> {
    const out = await this.challengeDone(challenge, right)
    // A stage passed is one of the two things worth a dance.
    if (out.passed) this.moment('dance')
    const state = await this.store.state.read()
    await this.store.state.write({
      ...state,
      progression: recordAttempt(state.progression, { stageId, score: out.score, outOf: out.outOf, passed: out.passed, at: Date.now() })
    })
    this.changed()
    return out
  }

  // ---------------------------------------------------------------- challenges

  /**
   * A test over one chapter, built only from the student's own cards and mistakes.
   *
   * Returns a refusal with a reason when there is not enough of their own material, because the alternative is a
   * quiz Orbis wrote -- and a confidently wrong question is worse than no question at all.
   */
  async challenge(chapterId: string): Promise<Challenge | NotReady> {
    const [graph, mastery, cards, mistakes] = await Promise.all([this.graph(), this.masteryMap(), this.store.flashcards.all(), this.store.mistakes.all()])
    const chapter = graph.chapters.find((one) => one.id === chapterId)
    if (!chapter) return { ready: false, why: 'Orbis does not know that chapter.', need: 0, have: 0 }
    const inside = graph.concepts.filter((one) => one.chapterId === chapterId)
    return challengeFor(chapter, inside, { cards, mistakes }, mastery, Date.now())
  }

  /**
   * A finished challenge: the score, and the mastery it actually proves.
   *
   * Right answers are recorded as recall against the concept they belong to, which is the only reason a challenge
   * is worth anything -- and wrong ones are recorded too, because a test that only counts the good news is not a
   * measurement.
   */
  async challengeDone(challenge: Challenge, right: readonly string[]): Promise<{ passed: boolean; score: number; outOf: number; says: string; xp: number }> {
    const out = challengeResult(challenge, right)
    const correct = new Set(right)
    for (const question of challenge.questions) {
      if (!question.conceptId) continue
      await this.learned(question.conceptId, correct.has(question.id) ? 'recalled' : 'recall-failed').catch(() => undefined)
    }
    let xp = 0
    if (out.passed) {
      const events = await this.store.xp.all()
      const keys = new Set(events.map((one) => one.key))
      // Keyed on the challenge, so passing the same one twice in a day pays once.
      const paid = award(events, keys, this.store.who(), {
        source: 'quest',
        amount: challenge.xp,
        sourceId: challenge.id,
        key: `challenge:${challenge.id}`,
        subject: challenge.subject,
        at: Date.now(),
        id: randomUUID()
      })
      if (paid.awarded > 0) await this.store.xp.replace(paid.events.map((one) => one))
      xp = paid.awarded
    }
    this.changed()
    return { ...out, xp }
  }

  /** One answer in a sitting: the run, and the small XP a run is worth. */
  async answeredOne(right: boolean, sittingId: string): Promise<{ run: number; best: number; xp: number; says: string | null }> {
    const state = await this.store.state.read()
    const at = Date.now()
    const out = answered(state.combo, right, (sittingId || state.session?.id || 'loose').slice(0, 60), at)
    await this.store.state.write({ ...state, combo: out.combo })
    if (out.xp > 0) {
      const events = await this.store.xp.all()
      const keys = new Set(events.map((one) => one.key))
      const paid = award(events, keys, this.store.who(), {
        source: 'quest',
        amount: out.xp,
        sourceId: out.combo.sittingId,
        // Keyed on the sitting and the run, so the same milestone cannot pay twice.
        key: `combo:${out.combo.sittingId}:${out.combo.run}`,
        subject: null,
        at,
        id: randomUUID()
      })
      if (paid.awarded > 0) await this.store.xp.replace(paid.events.map((one) => one))
    }
    this.changed()
    return { run: out.combo.run, best: out.combo.best, xp: out.xp, says: out.says }
  }

  /**
   * A surprise, at most once a day and only after a decent day's work.
   *
   * Offered, never started. And asking for it is what records it as offered, so it cannot appear twice.
   */
  async surprise(): Promise<Surprise | null> {
    const [state, sessions, graph, mastery] = await Promise.all([this.store.state.read(), this.store.sessions.all(), this.graph(), this.masteryMap()])
    const day = dayKey(Date.now())
    const today = sessions.filter((one) => dayKey(one.startedAt) === day)
    const out = surpriseFor(
      {
        lastSurpriseDay: state.lastSurpriseDay,
        sessionsToday: today.filter((one) => counts(one)).length,
        focusedSecondsToday: today.reduce((sum, one) => sum + one.focusedSeconds, 0),
        now: Date.now()
      },
      graph,
      mastery
    )
    if (out) await this.store.state.write({ ...state, lastSurpriseDay: day })
    return out
  }

  async briefing(which: 'morning' | 'evening'): Promise<{ title: string; body: string }> {
    const snapshot = await this.snapshot()
    const name = snapshot.preferences.name
    const streak = snapshot.streaks.find((one) => one.kind === 'focus')?.current ?? 0
    const next = snapshot.queue[0] ?? null

    if (which === 'morning') {
      const bits: string[] = []
      if (snapshot.goals[0]) bits.push(snapshot.goals[0].title)
      if (next) bits.push(`next: ${next.title}`)
      if (snapshot.due > 0) bits.push(`${snapshot.due} to review`)
      if (streak > 0) bits.push(`${streak} days in a row`)
      return { title: name ? `Good morning, ${name}` : 'Good morning', body: bits.length > 0 ? bits.join(' · ') : 'Nothing planned yet.' }
    }

    const today = snapshot.today
    const bits = [`${spellOut(today.focusedSeconds)} focused`, `${today.sessions} ${today.sessions === 1 ? 'session' : 'sessions'}`]
    if (today.tasksCompleted > 0) bits.push(`${today.tasksCompleted} tasks done`)
    if (today.xp > 0) bits.push(`${today.xp} XP`)
    if (next) bits.push(`tomorrow: ${next.title}`)
    return { title: 'Today', body: bits.join(' · ') }
  }

  private changed(): void {
    this.hooks.announce?.()
    this.store.changed()
  }
}

/** A length of time the way a person says it. The same shape session.ts uses, for the same reason. */
function spellOut(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  if (whole < 60) return 'nothing yet'
  const h = Math.floor(whole / 3600)
  const m = Math.round((whole % 3600) / 60)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

/** A monotonic reading, when the platform has one. Milliseconds since the process started. */
function now(): number | null {
  try {
    return performance.now()
  } catch {
    return null
  }
}

/** The categories safety holds back for a band, so the browser can enforce them outside any session. */
function safetyBlockedFor(band: AgeBand, override: 'age' | 'strict' | 'off'): ContentCategory[] {
  if (override === 'off') return []
  const strict = override === 'strict'
  const held: Record<AgeBand, ContentCategory[]> = {
    child: ['adult', 'gambling', 'dating', 'unsafe', 'violent', 'social', 'streaming', 'gaming', 'shopping'],
    preteen: ['adult', 'gambling', 'dating', 'unsafe', 'violent', 'social', 'shopping'],
    teen: ['adult', 'gambling', 'dating', 'unsafe', 'violent'],
    'older-teen': ['adult', 'gambling', 'unsafe'],
    adult: [],
    unknown: ['adult', 'gambling', 'unsafe']
  }
  const stricter: Record<AgeBand, AgeBand> = { child: 'child', preteen: 'child', teen: 'preteen', 'older-teen': 'teen', adult: 'older-teen', unknown: 'preteen' }
  return held[strict ? stricter[band] : band]
}

/** One subject's totals moved on, without needing to know whether the subject had been seen before. */
function bumpSubject(
  subjects: readonly SubjectProgress[],
  subject: string,
  by: Partial<Omit<SubjectProgress, 'subject' | 'lastStudiedAt'>> & { at: number }
): SubjectProgress[] {
  const held = subjects.find((one) => one.subject === subject) ?? {
    subject,
    xp: 0,
    sessions: 0,
    focusedSeconds: 0,
    tasksCompleted: 0,
    quizzes: 0,
    conceptsReviewed: 0,
    lastStudiedAt: null
  }
  const next: SubjectProgress = {
    ...held,
    xp: held.xp + (by.xp ?? 0),
    sessions: held.sessions + (by.sessions ?? 0),
    focusedSeconds: held.focusedSeconds + (by.focusedSeconds ?? 0),
    tasksCompleted: held.tasksCompleted + (by.tasksCompleted ?? 0),
    quizzes: held.quizzes + (by.quizzes ?? 0),
    conceptsReviewed: held.conceptsReviewed + (by.conceptsReviewed ?? 0),
    lastStudiedAt: by.at
  }
  return [next, ...subjects.filter((one) => one.subject !== subject)].slice(0, 200)
}

export { GAP, TICK_EVERY }
