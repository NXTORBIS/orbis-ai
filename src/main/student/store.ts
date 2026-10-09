import { join } from 'node:path'
import { Collection, JsonFile } from '../personal/store.ts'
import { dataDirFor } from '../../shared/profiles.ts'
import { emptyRecords, emptyStreak } from '../../shared/student/progress.ts'
import { newLog, type InterventionLog } from '../../shared/student/decide.ts'
import type { PlanItem } from '../../shared/student/planner.ts'
import { DIMENSIONS, EVIDENCE_KINDS, overall as overallMastery, type Dimension, type EvidenceKind, type Mastery } from '../../shared/student/mastery.ts'
import { COMBO_XP_A_DAY, newCombo, type Combo } from '../../shared/student/challenge.ts'
import { EXAM_OFF, type ExamSettings } from '../../shared/student/exam.ts'
import { emptyProgression, type Progression } from '../../shared/student/progression.ts'
import { newOrbi } from '../../shared/student/orbi.ts'
import { defaultPreferences, readPreferences } from '../../shared/student/prefs.ts'
import type {
  AchievementUnlock,
  CapturedThought,
  Concept,
  ConfusionItem,
  DistractionItem,
  Flashcard,
  FocusCapsule,
  FocusSession,
  FocusSpace,
  Goal,
  LearningReview,
  Mistake,
  OrbiProfile,
  PersonalRecord,
  QuestProgress,
  QuizAttempt,
  Streak,
  StudentPreferences,
  StudentTask,
  StudyNote,
  StudyResource,
  SubjectProgress,
  Whiteboard,
  XPEvent
} from '../../shared/student/types.ts'
import type { Beat } from '../../shared/student/session.ts'

/**
 * Where Orbis Student keeps a student's work.
 *
 * Everything lives under one profile's own folder, and switching profile moves every file at once -- there is no
 * shape in here that can hold two students' work, and no read that takes a profile id, because the store *is* one
 * profile. That is the cheapest way to make profile isolation true rather than remembered: a leak would require
 * adding a parameter that does not exist.
 *
 * Built on `JsonFile` and `Collection`, which Orbis already uses for notes, tasks and clipboard history. They write
 * atomically, debounce, hold the file at mode 0600, and -- the part that matters most here -- refuse to overwrite a
 * file they could not read, so a locked or half-written file never costs somebody their history. Nothing new was
 * written for storage; reusing them is also what keeps the quit-time flush honest.
 *
 * One file per kind of thing, rather than one big document, so a damaged file costs one feature instead of all of
 * them.
 */

const n = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const s = (value: unknown, limit: number, fallback = ''): string => (typeof value === 'string' ? value.slice(0, limit) : fallback)
const b = (value: unknown, fallback = false): boolean => (typeof value === 'boolean' ? value : fallback)
const maybeId = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 && value.length <= 80 ? value : null)
const maybeNum = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const list = (value: unknown, limit: number, each = 200): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string').map((one) => one.slice(0, each)).slice(0, limit) : []
const one = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback)

/** Anything with an id and no id is not storable, whatever else it has. */
const needsId = (raw: unknown): Record<string, unknown> | null => {
  if (!raw || typeof raw !== 'object') return null
  const held = raw as Record<string, unknown>
  return typeof held.id === 'string' && held.id.length > 0 && held.id.length <= 80 ? held : null
}

// ---------------------------------------------------------------- reading each kind of thing back

function readSession(raw: unknown, profileId: string): FocusSession | null {
  const held = needsId(raw)
  if (!held) return null
  const policy = (held.policy ?? {}) as Record<string, unknown>
  const breaks = (held.breaks ?? {}) as Record<string, unknown>
  return {
    id: held.id as string,
    profileId,
    state: one(
      held.state,
      ['created', 'ready', 'active', 'paused', 'break', 'recovering', 'completed', 'ended-early', 'interrupted', 'restored', 'expired'] as const,
      'interrupted'
    ),
    title: s(held.title, 200),
    subject: maybeId(held.subject),
    taskId: maybeId(held.taskId),
    goalId: maybeId(held.goalId),
    milestoneId: maybeId(held.milestoneId),
    conceptId: maybeId(held.conceptId),
    intention: s(held.intention, 400),
    oneThing: s(held.oneThing, 200),
    level: one(held.level, ['light', 'focus', 'deep'] as const, 'focus'),
    policy: {
      level: one(policy.level, ['light', 'focus', 'deep'] as const, 'focus'),
      blocked: list(policy.blocked, 20, 20) as FocusSession['policy']['blocked'],
      approved: list(policy.approved, 400, 300),
      approvedCategories: list(policy.approvedCategories, 20, 20) as FocusSession['policy']['approvedCategories'],
      blockedSites: list(policy.blockedSites, 400, 300),
      locked: b(policy.locked),
      enforce: one(policy.enforce, ['warn', 'block'] as const, 'block'),
      allowSaveForLater: b(policy.allowSaveForLater, true),
      approvedVideos: list(policy.approvedVideos, 400, 60),
      approvedChannels: list(policy.approvedChannels, 400, 60),
      youtube: one(policy.youtube, ['blocked', 'educational', 'approved-only', 'open'] as const, 'educational')
    },
    breaks: {
      focusMinutes: n(breaks.focusMinutes),
      breakMinutes: n(breaks.breakMinutes),
      blocks: Math.max(1, n(breaks.blocks, 1)),
      autoResume: b(breaks.autoResume)
    },
    plannedMinutes: Math.max(1, Math.min(600, n(held.plannedMinutes, 45))),
    startedAt: n(held.startedAt),
    // Never read back from disk: a monotonic reading belongs to the process that took it, and comparing it with one
    // from a different run of the program would be comparing two different zeros.
    startedMono: null,
    endedAt: maybeNum(held.endedAt),
    focusedSeconds: Math.max(0, n(held.focusedSeconds)),
    breakSeconds: Math.max(0, n(held.breakSeconds)),
    breakNow: Math.max(0, n(held.breakNow)),
    log: Array.isArray(held.log)
      ? held.log
          .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
          .map((entry) => ({ at: n(entry.at), from: s(entry.from, 20) as FocusSession['state'], to: s(entry.to, 20) as FocusSession['state'], note: s(entry.note, 120) }))
          .slice(-120)
      : [],
    milestonesHit: Array.isArray(held.milestonesHit) ? held.milestonesHit.filter((x): x is number => typeof x === 'number').slice(0, 8) : [],
    interruptions: Math.max(0, n(held.interruptions)),
    distractionAttempts: Math.max(0, n(held.distractionAttempts)),
    savedForLater: Math.max(0, n(held.savedForLater)),
    orionTurns: Math.max(0, n(held.orionTurns)),
    atmosphere: maybeId(held.atmosphere),
    playlistId: maybeId(held.playlistId),
    capsuleId: maybeId(held.capsuleId),
    spaceId: maybeId(held.spaceId),
    xpAwarded: Math.max(0, n(held.xpAwarded)),
    journal: s(held.journal, 2000),
    settled: b(held.settled),
    createdAt: n(held.createdAt, n(held.startedAt)),
    updatedAt: n(held.updatedAt, n(held.startedAt))
  }
}

function readGoal(raw: unknown, profileId: string): Goal | null {
  const held = needsId(raw)
  if (!held) return null
  return {
    id: held.id as string,
    profileId,
    title: s(held.title, 200),
    why: s(held.why, 500),
    horizon: one(held.horizon, ['daily', 'weekly', 'monthly', 'long-term'] as const, 'long-term'),
    subject: maybeId(held.subject),
    deadline: maybeNum(held.deadline),
    milestones: Array.isArray(held.milestones)
      ? held.milestones
          .map((raw2, index): Goal['milestones'][number] | null => {
            const m = needsId(raw2)
            if (!m) return null
            return {
              id: m.id as string,
              title: s(m.title, 200),
              stage: s(m.stage, 60),
              targetDate: maybeNum(m.targetDate),
              taskIds: list(m.taskIds, 200, 80),
              completedAt: maybeNum(m.completedAt),
              order: n(m.order, index)
            }
          })
          .filter((m) => m !== null)
          .slice(0, 60)
      : [],
    state: one(held.state, ['active', 'completed', 'archived'] as const, 'active'),
    completedAt: maybeNum(held.completedAt),
    createdAt: n(held.createdAt),
    updatedAt: n(held.updatedAt)
  }
}

function readTask(raw: unknown, profileId: string): StudentTask | null {
  const held = needsId(raw)
  if (!held) return null
  return {
    id: held.id as string,
    profileId,
    title: s(held.title, 300),
    subject: maybeId(held.subject),
    goalId: maybeId(held.goalId),
    milestoneId: maybeId(held.milestoneId),
    priority: one(held.priority, ['low', 'normal', 'high'] as const, 'normal'),
    estimate: maybeNum(held.estimate),
    actual: Math.max(0, n(held.actual)),
    due: maybeNum(held.due),
    hasTime: b(held.hasTime),
    state: one(held.state, ['planned', 'active', 'completed', 'postponed', 'archived'] as const, 'planned'),
    notes: s(held.notes, 4000),
    order: n(held.order),
    completedAt: maybeNum(held.completedAt),
    createdAt: n(held.createdAt),
    updatedAt: n(held.updatedAt)
  }
}

function readCapsule(raw: unknown, profileId: string): FocusCapsule | null {
  const held = needsId(raw)
  if (!held) return null
  const breaks = (held.breaks ?? {}) as Record<string, unknown>
  const orbi = (held.orbi ?? {}) as Record<string, unknown>
  return {
    id: held.id as string,
    profileId,
    name: s(held.name, 120),
    subject: maybeId(held.subject),
    task: s(held.task, 300),
    goalId: maybeId(held.goalId),
    intention: s(held.intention, 400),
    minutes: Math.max(1, Math.min(600, n(held.minutes, 45))),
    level: one(held.level, ['light', 'focus', 'deep'] as const, 'focus'),
    blocked: list(held.blocked, 20, 20) as FocusCapsule['blocked'],
    approved: list(held.approved, 400, 300),
    blockedSites: list(held.blockedSites, 400, 300),
    breaks: { focusMinutes: n(breaks.focusMinutes), breakMinutes: n(breaks.breakMinutes), blocks: Math.max(1, n(breaks.blocks, 1)), autoResume: b(breaks.autoResume) },
    atmosphere: maybeId(held.atmosphere),
    playlistId: maybeId(held.playlistId),
    orbi: {
      enabled: b(orbi.enabled, true),
      visibility: one(orbi.visibility, ['full', 'compact', 'minimal', 'hidden'] as const, 'full'),
      personality: one(orbi.personality, ['cute', 'minimal', 'futuristic', 'academic', 'competitive', 'mature', 'calm', 'energetic', 'playful'] as const, 'cute'),
      messages: one(orbi.messages, ['off', 'rare', 'normal'] as const, 'normal'),
      animation: one(orbi.animation, ['full', 'reduced', 'off'] as const, 'full'),
      voice: one(orbi.voice, ['off', 'minimal', 'normal'] as const, 'off'),
      celebration: one(orbi.celebration, ['off', 'subtle', 'full'] as const, 'subtle'),
      size: one(orbi.size, ['small', 'medium', 'large'] as const, 'medium'),
      position: one(orbi.position, ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const, 'bottom-right')
    },
    locked: b(held.locked),
    notes: s(held.notes, 2000),
    favourite: b(held.favourite),
    used: Math.max(0, n(held.used)),
    completed: Math.max(0, n(held.completed)),
    createdAt: n(held.createdAt),
    updatedAt: n(held.updatedAt)
  }
}

function readSpace(raw: unknown, profileId: string): FocusSpace | null {
  const held = needsId(raw)
  if (!held) return null
  return {
    id: held.id as string,
    profileId,
    name: s(held.name, 120),
    subject: maybeId(held.subject),
    tabs: Array.isArray(held.tabs)
      ? held.tabs
          .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && typeof t.url === 'string')
          .map((t) => ({ url: s(t.url, 2048), title: s(t.title, 300) }))
          .slice(0, 60)
      : [],
    items: list(held.items, 300, 120),
    notes: s(held.notes, 8000),
    sessionId: maybeId(held.sessionId),
    capsuleIds: list(held.capsuleIds, 60, 80),
    goalId: maybeId(held.goalId),
    atmosphere: maybeId(held.atmosphere),
    playlistId: maybeId(held.playlistId),
    approved: list(held.approved, 400, 300),
    favourite: b(held.favourite),
    lastUsedAt: n(held.lastUsedAt),
    createdAt: n(held.createdAt),
    updatedAt: n(held.updatedAt)
  }
}

function readDistraction(raw: unknown, profileId: string): DistractionItem | null {
  const held = needsId(raw)
  if (!held || typeof held.url !== 'string') return null
  return {
    id: held.id as string,
    profileId,
    url: s(held.url, 2048),
    title: s(held.title, 300),
    category: s(held.category, 20, 'unknown') as DistractionItem['category'],
    savedAt: n(held.savedAt),
    sessionId: maybeId(held.sessionId),
    sessionTitle: s(held.sessionTitle, 200),
    note: s(held.note, 600),
    state: one(held.state, ['waiting', 'opened', 'archived', 'became-task'] as const, 'waiting')
  }
}

function readThought(raw: unknown, profileId: string): CapturedThought | null {
  const held = needsId(raw)
  if (!held) return null
  return {
    id: held.id as string,
    profileId,
    text: s(held.text, 1000),
    at: n(held.at),
    sessionId: maybeId(held.sessionId),
    state: one(held.state, ['waiting', 'became-task', 'became-note', 'discarded'] as const, 'waiting')
  }
}

function readReview(raw: unknown, profileId: string): LearningReview | null {
  if (!raw || typeof raw !== 'object') return null
  const held = raw as Record<string, unknown>
  if (typeof held.itemId !== 'string') return null
  return {
    itemId: s(held.itemId, 120),
    profileId,
    firstSeenAt: n(held.firstSeenAt),
    lastSeenAt: n(held.lastSeenAt),
    reviews: Math.max(0, n(held.reviews)),
    correct: Math.max(0, n(held.correct)),
    confidence: Math.max(0, Math.min(1, n(held.confidence, 0.3))),
    difficulty: one(held.difficulty, ['beginner', 'intermediate', 'advanced'] as const, 'intermediate'),
    dueAt: n(held.dueAt),
    streak: Math.max(0, n(held.streak)),
    state: one(held.state, ['learning', 'reviewing', 'known', 'struggling'] as const, 'learning')
  }
}

function readFlashcard(raw: unknown, profileId: string): Flashcard | null {
  const held = needsId(raw)
  if (!held) return null
  return {
    id: held.id as string,
    profileId,
    front: s(held.front, 1000),
    back: s(held.back, 2000),
    subject: maybeId(held.subject),
    origin: one(held.origin, ['orbis', 'orion', 'web', 'student'] as const, 'student'),
    deck: s(held.deck, 80, 'Default'),
    conceptId: maybeId(held.conceptId),
    practised: Math.max(0, Math.round(n(held.practised))),
    // Never more right than attempted, whatever a damaged file says.
    recalled: Math.max(0, Math.min(Math.max(0, Math.round(n(held.practised))), Math.round(n(held.recalled)))),
    lastPractisedAt: held.lastPractisedAt === undefined || held.lastPractisedAt === null ? null : n(held.lastPractisedAt) || null,
    createdAt: n(held.createdAt)
  }
}

function readAttempt(raw: unknown, profileId: string): QuizAttempt | null {
  const held = needsId(raw)
  if (!held) return null
  return {
    id: held.id as string,
    profileId,
    itemId: s(held.itemId, 120),
    subject: maybeId(held.subject),
    correct: b(held.correct),
    answer: s(held.answer, 500),
    at: n(held.at),
    sessionId: maybeId(held.sessionId)
  }
}

function readMistake(raw: unknown, profileId: string): Mistake | null {
  const held = needsId(raw)
  if (!held) return null
  return {
    id: held.id as string,
    profileId,
    subject: maybeId(held.subject),
    concept: s(held.concept, 200),
    kind: one(held.kind, ['concept', 'calculation', 'recall', 'application', 'careless'] as const, 'concept'),
    detail: s(held.detail, 1000),
    at: n(held.at),
    reviewedAt: maybeNum(held.reviewedAt),
    sessionId: maybeId(held.sessionId)
  }
}

function readConfusion(raw: unknown, profileId: string): ConfusionItem | null {
  const held = needsId(raw)
  if (!held) return null
  return {
    id: held.id as string,
    profileId,
    concept: s(held.concept, 200),
    subject: maybeId(held.subject),
    note: s(held.note, 1000),
    at: n(held.at),
    sessionId: maybeId(held.sessionId),
    resolvedAt: maybeNum(held.resolvedAt)
  }
}

/**
 * A measurement, read back as it was written.
 *
 * Every number is clamped and every list is bounded, but nothing is invented: a file with no measurement reads as
 * `null`, which the rest of Orbis treats as "nothing has been measured", not as "measured zero". Those are
 * different claims and only one of them is true of a concept nobody has answered a question about yet.
 *
 * The dimensions are read by name rather than copied wholesale, so a stray key in the file cannot become a
 * dimension the code does not know what to do with.
 */
function readMeasured(raw: unknown, conceptId: string): Mastery | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const held = raw as Record<string, unknown>
  const heldScores = held.scores && typeof held.scores === 'object' ? (held.scores as Record<string, unknown>) : null
  if (!heldScores) return null
  const unit = (value: unknown): number => Math.max(0, Math.min(1, n(value)))
  const scores = {} as Record<Dimension, number>
  for (const name of DIMENSIONS) scores[name] = unit(heldScores[name])
  const counts = held.evidence && typeof held.evidence === 'object' ? (held.evidence as Record<string, unknown>) : {}
  const evidence = {} as Record<EvidenceKind, number>
  for (const kind of EVIDENCE_KINDS) evidence[kind] = Math.max(0, Math.round(n(counts[kind])))
  return {
    conceptId,
    scores,
    confidence: unit(held.confidence),
    evidence,
    correct: Math.max(0, Math.round(n(held.correct))),
    attempts: Math.max(0, Math.round(n(held.attempts))),
    days: list(held.days, 400, 10),
    firstSeenAt: n(held.firstSeenAt),
    lastSeenAt: n(held.lastSeenAt),
    longestGapSurvived: Math.max(0, n(held.longestGapSurvived)),
    wrongRun: Math.max(0, Math.round(n(held.wrongRun))),
    state: one(held.state, ['new', 'learning', 'reviewing', 'stable', 'strong', 'mastered', 'slipping'] as const, 'new')
  }
}

function readConcept(raw: unknown, profileId: string): Concept | null {
  const held = needsId(raw)
  if (!held) return null
  const id = held.id as string
  const measured = readMeasured(held.measured, id)
  return {
    id,
    profileId,
    name: s(held.name, 200),
    subject: maybeId(held.subject),
    /*
     * The one number comes from the measurement whenever there is one, so the summary on a list and the detail on
     * the mastery page can never disagree. Only a file written before measurements existed falls back to its own
     * stored number.
     */
    mastery: measured ? overallMastery(measured) : Math.max(0, Math.min(1, n(held.mastery))),
    measured,
    prerequisites: list(held.prerequisites, 40, 80),
    related: list(held.related, 60, 80),
    chapterId: maybeId(held.chapterId),
    chapterName: s(held.chapterName, 200),
    difficulty: Math.max(1, Math.min(5, Math.round(n(held.difficulty)) || 3)),
    importance: held.importance === undefined ? 0.5 : Math.max(0, Math.min(1, n(held.importance))),
    order: Math.max(0, Math.round(n(held.order))),
    lastTouchedAt: n(held.lastTouchedAt),
    notes: s(held.notes, 4000)
  }
}

function readResource(raw: unknown, profileId: string): StudyResource | null {
  const held = needsId(raw)
  if (!held || typeof held.url !== 'string') return null
  return {
    id: held.id as string,
    profileId,
    url: s(held.url, 2048),
    title: s(held.title, 300),
    kind: one(held.kind, ['website', 'pdf', 'video', 'document', 'note', 'tool', 'generated'] as const, 'website'),
    subject: maybeId(held.subject),
    goalId: maybeId(held.goalId),
    tags: list(held.tags, 30, 40),
    notes: s(held.notes, 4000),
    origin: one(held.origin, ['orbis', 'orion', 'web', 'student'] as const, 'web'),
    favourite: b(held.favourite),
    read: b(held.read),
    relevance: typeof held.relevance === 'string' ? one(held.relevance, ['high', 'medium', 'low'] as const, 'medium') : null,
    savedAt: n(held.savedAt),
    lastOpenedAt: maybeNum(held.lastOpenedAt)
  }
}

function readNote(raw: unknown, profileId: string): StudyNote | null {
  const held = needsId(raw)
  if (!held) return null
  return {
    id: held.id as string,
    profileId,
    title: s(held.title, 300),
    body: s(held.body, 100_000),
    kind: one(held.kind, ['quick', 'rich', 'checklist', 'concept', 'question', 'mistake', 'summary'] as const, 'quick'),
    subject: maybeId(held.subject),
    goalId: maybeId(held.goalId),
    sessionId: maybeId(held.sessionId),
    conceptId: maybeId(held.conceptId),
    items: list(held.items, 200, 120),
    createdAt: n(held.createdAt),
    updatedAt: n(held.updatedAt)
  }
}

function readBoard(raw: unknown, profileId: string): Whiteboard | null {
  const held = needsId(raw)
  if (!held) return null
  return {
    id: held.id as string,
    profileId,
    name: s(held.name, 120),
    // The drawing itself is the board's own business. Kept as it was handed over, with a size limit applied where
    // it is written rather than re-interpreted here.
    data: held.data ?? null,
    sessionId: maybeId(held.sessionId),
    capsuleId: maybeId(held.capsuleId),
    spaceId: maybeId(held.spaceId),
    goalId: maybeId(held.goalId),
    createdAt: n(held.createdAt),
    updatedAt: n(held.updatedAt)
  }
}

function readXp(raw: unknown, profileId: string): XPEvent | null {
  const held = needsId(raw)
  if (!held || typeof held.key !== 'string') return null
  return {
    id: held.id as string,
    profileId,
    source: s(held.source, 30, 'focus-session') as XPEvent['source'],
    amount: Math.max(0, Math.round(n(held.amount))),
    sourceId: s(held.sourceId, 80),
    key: s(held.key, 160),
    subject: maybeId(held.subject),
    at: n(held.at)
  }
}

// ---------------------------------------------------------------- the one file that is about right now

/**
 * The live state: one running session, the heartbeat, and the running totals.
 *
 * Kept in one file on purpose. These are the things that have to be consistent with each other after a crash -- a
 * session restored without its heartbeat would be a session whose elapsed time could not be worked out -- and one
 * atomic write is the cheapest way to make sure they are never half-updated.
 */
export interface StudentState {
  session: FocusSession | null
  beat: Beat | null
  streaks: readonly Streak[]
  records: PersonalRecord
  quests: readonly QuestProgress[]
  achievements: readonly AchievementUnlock[]
  subjects: readonly SubjectProgress[]
  /** Learning content already shown, so the word of the day does not come round again. */
  seen: readonly string[]
  /** What was chosen for today, so a refresh shows the same thing. Replaced when the day changes. */
  picks: { day: string; ids: readonly string[] } | null
  /**
   * How many times "one more minute" has been taken today.
   *
   * Counted because it pays a little, and anything that pays has to be countable -- otherwise it is a button that
   * can be pressed forty times for XP, which is the definition of farming rather than finishing.
   */
  extraMinutes: { day: string; used: number }
  /**
   * The run of right answers, and the day a surprise was last offered.
   *
   * Kept here rather than worked out from the attempt log, because a run belongs to one sitting and the log has no
   * idea where a sitting began.
   */
  combo: Combo
  lastSurpriseDay: string | null
  /** The exam the student has put Orbis into exam mode for, and what that mode does. */
  exam: ExamSettings
  /**
   * Questions the student said were wrong or off-course.
   *
   * Kept by their words rather than by an id, because a generated question has no life beyond the moment it was
   * written -- and the same bad question would otherwise come back tomorrow with a new id.
   */
  rejectedQuestions: readonly string[]
  /** Every stage attempt, newest first. A record, never a score. */
  progression: Progression
  /** The day each briefing was last shown, so neither appears twice. */
  briefings: { morning: string | null; evening: string | null }
  /** The last day the student was here at all, for the welcome-back path. */
  lastSeenDay: string | null
  /**
   * How often Orbi has interrupted today, and how each kind of interruption has been received.
   *
   * Kept with the live state rather than in its own file because it is about *now*: the budget resets daily and
   * the reception counts are small. It is also the one thing that must not be lost on a crash, or Orbi comes back
   * with a full budget and says six things in a row.
   */
  interventions: InterventionLog
  /** The plan, by day. Only the days that have one. */
  plans: Readonly<Record<string, readonly PlanItem[]>>
  /** Minutes the student said they have, by day. A day with no entry is a day with no time. */
  availability: Readonly<Record<string, number>>
  /** The longest stretch they want to sit for, and the break between stretches. */
  sitting: { longest: number; breakMinutes: number }
  version: number
}

export const STUDENT_SCHEMA = 1

function emptyState(): StudentState {
  return {
    session: null,
    beat: null,
    streaks: [emptyStreak('focus'), emptyStreak('learning')],
    records: emptyRecords(),
    quests: [],
    achievements: [],
    subjects: [],
    seen: [],
    picks: null,
    extraMinutes: { day: '', used: 0 },
    combo: newCombo('', ''),
    lastSurpriseDay: null,
    exam: EXAM_OFF,
    rejectedQuestions: [],
    progression: emptyProgression(),
    briefings: { morning: null, evening: null },
    lastSeenDay: null,
    interventions: newLog(''),
    plans: {},
    availability: {},
    sitting: { longest: 50, breakMinutes: 10 },
    version: STUDENT_SCHEMA
  }
}

function readState(raw: unknown, profileId: string): StudentState {
  const base = emptyState()
  if (!raw || typeof raw !== 'object') return base
  const held = raw as Record<string, unknown>
  // Written by a newer Orbis: left exactly as it is rather than read down to what this version understands, because
  // reading it down would be followed by writing it back, which is how an upgrade loses work.
  if (n(held.version, 1) > STUDENT_SCHEMA) return base
  const records = (held.records ?? {}) as Record<string, unknown>
  const briefings = (held.briefings ?? {}) as Record<string, unknown>
  return {
    session: readSession(held.session, profileId),
    beat: held.beat && typeof held.beat === 'object' ? { at: n((held.beat as Record<string, unknown>).at), mono: null } : null,
    streaks: Array.isArray(held.streaks)
      ? (['focus', 'learning'] as const).map((kind) => {
          const found = (held.streaks as unknown[]).find((x) => !!x && typeof x === 'object' && (x as Record<string, unknown>).kind === kind) as Record<string, unknown> | undefined
          if (!found) return emptyStreak(kind)
          return {
            kind,
            current: Math.max(0, n(found.current)),
            longest: Math.max(0, n(found.longest)),
            lastDay: typeof found.lastDay === 'string' ? found.lastDay.slice(0, 10) : null,
            days: list(found.days, 400, 10),
            restDays: list(found.restDays, 200, 10)
          }
        })
      : base.streaks,
    records: {
      longestSessionSeconds: Math.max(0, n(records.longestSessionSeconds)),
      longestSessionAt: maybeNum(records.longestSessionAt),
      totalFocusedSeconds: Math.max(0, n(records.totalFocusedSeconds)),
      bestDaySeconds: Math.max(0, n(records.bestDaySeconds)),
      bestDay: typeof records.bestDay === 'string' ? records.bestDay.slice(0, 10) : null,
      bestWeekSeconds: Math.max(0, n(records.bestWeekSeconds)),
      bestWeek: typeof records.bestWeek === 'string' ? records.bestWeek.slice(0, 10) : null,
      mostXpInDay: Math.max(0, n(records.mostXpInDay)),
      mostXpDay: typeof records.mostXpDay === 'string' ? records.mostXpDay.slice(0, 10) : null,
      mostTasksInDay: Math.max(0, n(records.mostTasksInDay)),
      longestFocusStreak: Math.max(0, n(records.longestFocusStreak)),
      longestLearningStreak: Math.max(0, n(records.longestLearningStreak))
    },
    quests: Array.isArray(held.quests)
      ? held.quests
          .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object' && typeof q.questId === 'string')
          .map((q) => ({
            questId: s(q.questId, 60),
            period: one(q.period, ['daily', 'weekly', 'monthly'] as const, 'daily'),
            periodKey: s(q.periodKey, 10),
            value: Math.max(0, n(q.value)),
            target: Math.max(1, n(q.target, 1)),
            completedAt: maybeNum(q.completedAt),
            settled: b(q.settled)
          }))
          .slice(0, 200)
      : [],
    achievements: Array.isArray(held.achievements)
      ? held.achievements
          .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof a.achievementId === 'string')
          .map((a) => ({ achievementId: s(a.achievementId, 60), at: n(a.at), value: n(a.value) }))
          .slice(0, 200)
      : [],
    subjects: Array.isArray(held.subjects)
      ? held.subjects
          .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof x.subject === 'string')
          .map((x) => ({
            subject: s(x.subject, 80),
            xp: Math.max(0, n(x.xp)),
            sessions: Math.max(0, n(x.sessions)),
            focusedSeconds: Math.max(0, n(x.focusedSeconds)),
            tasksCompleted: Math.max(0, n(x.tasksCompleted)),
            quizzes: Math.max(0, n(x.quizzes)),
            conceptsReviewed: Math.max(0, n(x.conceptsReviewed)),
            lastStudiedAt: maybeNum(x.lastStudiedAt)
          }))
          .slice(0, 200)
      : [],
    seen: list(held.seen, 2000, 120),
    picks:
      held.picks && typeof held.picks === 'object' && typeof (held.picks as Record<string, unknown>).day === 'string'
        ? { day: s((held.picks as Record<string, unknown>).day, 10), ids: list((held.picks as Record<string, unknown>).ids, 12, 120) }
        : null,
    extraMinutes:
      held.extraMinutes && typeof held.extraMinutes === 'object'
        ? { day: s((held.extraMinutes as Record<string, unknown>).day, 10), used: Math.max(0, n((held.extraMinutes as Record<string, unknown>).used)) }
        : { day: '', used: 0 },
    combo: readCombo(held.combo),
    lastSurpriseDay: typeof held.lastSurpriseDay === 'string' ? held.lastSurpriseDay.slice(0, 10) : null,
    exam: readExam(held.exam),
    rejectedQuestions: list(held.rejectedQuestions, 300, 200),
    progression: readProgression(held.progression),
    briefings: {
      morning: typeof briefings.morning === 'string' ? briefings.morning.slice(0, 10) : null,
      evening: typeof briefings.evening === 'string' ? briefings.evening.slice(0, 10) : null
    },
    lastSeenDay: typeof held.lastSeenDay === 'string' ? held.lastSeenDay.slice(0, 10) : null,
    interventions: readLog(held.interventions),
    plans: readPlans(held.plans),
    availability: readAvailability(held.availability),
    sitting: {
      longest: Math.max(5, Math.min(240, n((held.sitting as Record<string, unknown>)?.longest, 50))),
      breakMinutes: Math.max(0, Math.min(60, n((held.sitting as Record<string, unknown>)?.breakMinutes, 10)))
    },
    version: STUDENT_SCHEMA
  }
}

/** Exam mode, read back. A damaged file turns the mode off rather than leaving Orbis in a state nobody chose. */
function readExam(raw: unknown): ExamSettings {
  if (!raw || typeof raw !== 'object') return EXAM_OFF
  const held = raw as Record<string, unknown>
  const goalId = maybeId(held.goalId)
  if (!goalId) return EXAM_OFF
  return {
    goalId,
    since: typeof held.since === 'number' && Number.isFinite(held.since) ? Math.round(held.since) : null,
    quieter: held.quieter === undefined ? true : held.quieter === true,
    longerSessions: held.longerSessions === undefined ? true : held.longerSessions === true
  }
}

/** Stage attempts, read back without letting a bad file claim a pass that never happened. */
function readProgression(raw: unknown): Progression {
  if (!raw || typeof raw !== 'object') return emptyProgression()
  const rows = (raw as Record<string, unknown>).attempts
  if (!Array.isArray(rows)) return emptyProgression()
  const attempts = rows
    .filter((one): one is Record<string, unknown> => !!one && typeof one === 'object' && typeof one.stageId === 'string')
    .slice(0, 500)
    .map((one) => {
      const outOf = Math.max(0, Math.round(n(one.outOf)))
      const score = Math.max(0, Math.min(outOf, Math.round(n(one.score))))
      return {
        stageId: s(one.stageId, 120),
        score,
        outOf,
        // A pass is recomputed from the numbers, never taken on trust from the file.
        passed: outOf > 0 && score >= Math.max(3, Math.floor(outOf * 0.8)),
        at: n(one.at)
      }
    })
  return { attempts }
}

/** A run of right answers, read back without letting a bad file hand out a day's worth of XP. */
function readCombo(raw: unknown): Combo {
  if (!raw || typeof raw !== 'object') return newCombo('', '')
  const held = raw as Record<string, unknown>
  return {
    run: Math.max(0, Math.min(500, Math.round(n(held.run)))),
    best: Math.max(0, Math.min(500, Math.round(n(held.best)))),
    sittingId: typeof held.sittingId === 'string' ? held.sittingId.slice(0, 60) : '',
    // Clamped to the day's cap: a tampered file must not be able to claim a negative amount was already paid.
    paidToday: Math.max(0, Math.min(COMBO_XP_A_DAY, Math.round(n(held.paidToday)))),
    day: typeof held.day === 'string' ? held.day.slice(0, 10) : ''
  }
}

/** The intervention log, read back without letting a bad file hand Orbi an unlimited budget. */
function readLog(raw: unknown): InterventionLog {
  if (!raw || typeof raw !== 'object') return newLog('')
  const held = raw as Record<string, unknown>
  const outcomes: Record<string, { shown: number; accepted: number; dismissed: number }> = {}
  if (held.outcomes && typeof held.outcomes === 'object') {
    for (const [key, value] of Object.entries(held.outcomes as Record<string, unknown>).slice(0, 60)) {
      if (!value || typeof value !== 'object') continue
      const one = value as Record<string, unknown>
      outcomes[key.slice(0, 40)] = { shown: Math.max(0, n(one.shown)), accepted: Math.max(0, n(one.accepted)), dismissed: Math.max(0, n(one.dismissed)) }
    }
  }
  const last: Record<string, number> = {}
  if (held.last && typeof held.last === 'object') {
    for (const [key, value] of Object.entries(held.last as Record<string, unknown>).slice(0, 60)) {
      if (typeof value === 'number' && Number.isFinite(value)) last[key.slice(0, 40)] = value
    }
  }
  return { day: s(held.day, 10), spent: Math.max(0, n(held.spent)), last, outcomes }
}

/** A plan, by day. Items are read through the same rules as everything else. */
function readPlans(raw: unknown): Record<string, PlanItem[]> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, PlanItem[]> = {}
  for (const [day, value] of Object.entries(raw as Record<string, unknown>).slice(0, 120)) {
    if (!Array.isArray(value)) continue
    out[day.slice(0, 10)] = value
      .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && typeof row.id === 'string')
      .map((row) => ({
        id: s(row.id, 60),
        kind: one(row.kind, ['learn', 'practice', 'recall', 'revise', 'mistakes', 'mock', 'read', 'break'] as const, 'practice'),
        minutes: Math.max(1, Math.min(600, n(row.minutes, 10))),
        subject: maybeId(row.subject),
        chapterId: maybeId(row.chapterId),
        conceptId: maybeId(row.conceptId),
        title: s(row.title, 200),
        because: s(row.because, 240),
        value: Math.max(0, Math.min(1, n(row.value))),
        forId: maybeId(row.forId),
        state: one(row.state, ['planned', 'done', 'skipped', 'moved'] as const, 'planned')
      }))
      .slice(0, 40)
  }
  return out
}

/** Minutes free per day, with anything unreadable left out rather than defaulted to a number of hours. */
function readAvailability(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [day, value] of Object.entries(raw as Record<string, unknown>).slice(0, 400)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
    out[day.slice(0, 10)] = Math.max(0, Math.min(960, Math.round(value)))
  }
  return out
}

// ---------------------------------------------------------------- the store

const file = (userData: string, profileId: string, name: string): string => join(userData, dataDirFor(profileId), 'student', name)

export class StudentStore {
  private profileId: string
  private readonly userData: string
  private readonly listeners = new Set<() => void>()

  readonly prefs: JsonFile<StudentPreferences>
  readonly orbi: JsonFile<OrbiProfile>
  readonly state: JsonFile<StudentState>

  readonly sessions: Collection<FocusSession>
  readonly goals: Collection<Goal>
  readonly tasks: Collection<StudentTask>
  readonly capsules: Collection<FocusCapsule>
  readonly spaces: Collection<FocusSpace>
  readonly distractions: Collection<DistractionItem>
  readonly thoughts: Collection<CapturedThought>
  readonly flashcards: Collection<Flashcard>
  readonly attempts: Collection<QuizAttempt>
  readonly mistakes: Collection<Mistake>
  readonly confusions: Collection<ConfusionItem>
  readonly concepts: Collection<Concept>
  readonly resources: Collection<StudyResource>
  readonly notes: Collection<StudyNote>
  readonly boards: Collection<Whiteboard>
  readonly xp: Collection<XPEvent>
  /** Reviews are keyed by the content they are about, not by an id of their own. */
  readonly reviews: JsonFile<LearningReview[]>

  constructor(userData: string, profileId: string) {
    this.userData = userData
    this.profileId = profileId
    const at = (name: string): string => file(userData, profileId, name)
    const now = Date.now()

    this.prefs = new JsonFile<StudentPreferences>(at('preferences.json'), () => defaultPreferences(now), (raw) => readPreferences(raw, now))
    this.orbi = new JsonFile<OrbiProfile>(
      at('orbi.json'),
      () => newOrbi(profileId, now),
      (raw) => {
        const base = newOrbi(this.profileId, now)
        if (!raw || typeof raw !== 'object') return base
        const held = raw as Record<string, unknown>
        return {
          ...base,
          name: s(held.name, 40, base.name) || base.name,
          level: Math.max(1, Math.min(100, n(held.level, 1))),
          unlocked: list(held.unlocked, 200, 60),
          worn: list(held.worn, 20, 60),
          room: Array.isArray(held.room)
            ? held.room
                .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof r.itemId === 'string')
                .map((r) => ({ itemId: s(r.itemId, 60), x: n(r.x), y: n(r.y) }))
                .slice(0, 60)
            : [],
          updatedAt: n(held.updatedAt, now)
        }
      }
    )
    this.state = new JsonFile<StudentState>(at('state.json'), emptyState, (raw) => readState(raw, this.profileId))
    this.reviews = new JsonFile<LearningReview[]>(
      at('reviews.json'),
      () => [],
      (raw) => (Array.isArray(raw) ? raw.map((x) => readReview(x, this.profileId)).filter((x): x is LearningReview => x !== null).slice(0, 5000) : [])
    )

    this.sessions = new Collection<FocusSession>(at('sessions.json'), (raw) => readSession(raw, this.profileId), 4000)
    this.goals = new Collection<Goal>(at('goals.json'), (raw) => readGoal(raw, this.profileId), 500)
    this.tasks = new Collection<StudentTask>(at('tasks.json'), (raw) => readTask(raw, this.profileId), 5000)
    this.capsules = new Collection<FocusCapsule>(at('capsules.json'), (raw) => readCapsule(raw, this.profileId), 300)
    this.spaces = new Collection<FocusSpace>(at('spaces.json'), (raw) => readSpace(raw, this.profileId), 200)
    this.distractions = new Collection<DistractionItem>(at('later.json'), (raw) => readDistraction(raw, this.profileId), 2000)
    this.thoughts = new Collection<CapturedThought>(at('thoughts.json'), (raw) => readThought(raw, this.profileId), 2000)
    this.flashcards = new Collection<Flashcard>(at('flashcards.json'), (raw) => readFlashcard(raw, this.profileId), 5000)
    this.attempts = new Collection<QuizAttempt>(at('quizzes.json'), (raw) => readAttempt(raw, this.profileId), 5000)
    this.mistakes = new Collection<Mistake>(at('mistakes.json'), (raw) => readMistake(raw, this.profileId), 3000)
    this.confusions = new Collection<ConfusionItem>(at('confusions.json'), (raw) => readConfusion(raw, this.profileId), 2000)
    this.concepts = new Collection<Concept>(at('concepts.json'), (raw) => readConcept(raw, this.profileId), 3000)
    this.resources = new Collection<StudyResource>(at('resources.json'), (raw) => readResource(raw, this.profileId), 5000)
    this.notes = new Collection<StudyNote>(at('notes.json'), (raw) => readNote(raw, this.profileId), 5000)
    this.boards = new Collection<Whiteboard>(at('boards.json'), (raw) => readBoard(raw, this.profileId), 500)
    this.xp = new Collection<XPEvent>(at('xp.json'), (raw) => readXp(raw, this.profileId), 20_000)

    for (const collection of this.everyCollection()) collection.onChange(() => this.changed())
  }

  private everyCollection(): Collection<{ id: string }>[] {
    return [
      this.sessions,
      this.goals,
      this.tasks,
      this.capsules,
      this.spaces,
      this.distractions,
      this.thoughts,
      this.flashcards,
      this.attempts,
      this.mistakes,
      this.confusions,
      this.concepts,
      this.resources,
      this.notes,
      this.boards,
      this.xp
    ] as unknown as Collection<{ id: string }>[]
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  changed(): void {
    for (const listener of [...this.listeners]) listener()
  }

  who(): string {
    return this.profileId
  }

  /** Whether anything on disk could not be read, so a student is told rather than shown an empty list. */
  async problems(): Promise<string[]> {
    const out: string[] = []
    for (const one of [this.prefs, this.orbi, this.state, this.reviews]) {
      await one.read()
      const problem = one.problem()
      if (problem) out.push(problem)
    }
    return out
  }

  /**
   * Moves every file to another profile's folder.
   *
   * All of them, in one call, because a half-switched store is the exact shape of a cross-profile leak: one file
   * still pointing at the old profile while the rest point at the new one would show one student another's work.
   */
  async useProfile(profileId: string): Promise<void> {
    if (profileId === this.profileId) return
    this.profileId = profileId
    const at = (name: string): string => file(this.userData, profileId, name)
    await Promise.all([
      this.prefs.usePath(at('preferences.json')),
      this.orbi.usePath(at('orbi.json')),
      this.state.usePath(at('state.json')),
      this.reviews.usePath(at('reviews.json')),
      this.sessions.usePath(at('sessions.json')),
      this.goals.usePath(at('goals.json')),
      this.tasks.usePath(at('tasks.json')),
      this.capsules.usePath(at('capsules.json')),
      this.spaces.usePath(at('spaces.json')),
      this.distractions.usePath(at('later.json')),
      this.thoughts.usePath(at('thoughts.json')),
      this.flashcards.usePath(at('flashcards.json')),
      this.attempts.usePath(at('quizzes.json')),
      this.mistakes.usePath(at('mistakes.json')),
      this.confusions.usePath(at('confusions.json')),
      this.concepts.usePath(at('concepts.json')),
      this.resources.usePath(at('resources.json')),
      this.notes.usePath(at('notes.json')),
      this.boards.usePath(at('boards.json')),
      this.xp.usePath(at('xp.json'))
    ])
    this.changed()
  }

  async flush(): Promise<void> {
    await Promise.all([this.prefs.flush(), this.orbi.flush(), this.state.flush(), this.reviews.flush(), ...this.everyCollection().map((one) => one.flush())])
  }
}
