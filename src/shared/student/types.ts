/**
 * Orbis Student: the things a student keeps.
 *
 * Pure types, no storage and no browser. Everything here belongs to one local profile -- there is no shape in this
 * file that can hold two students' work at once, which is the point: a leak between profiles would have to be written
 * deliberately rather than happen by forgetting a filter.
 *
 * Three ideas are kept apart on purpose, because conflating them is the mistake that makes study software feel like
 * punishment:
 *
 *   safety   whether something is appropriate for how old somebody is. Always on, decided from the date of birth.
 *   focus    whether something is a distraction from the task in front of them *right now*. Only during a session.
 *   normal   neither applies; the browser is a browser.
 *
 * A site can be perfectly safe and still be a distraction, and the architecture has to be able to say so.
 */

import type { Mastery } from './mastery'

// ---------------------------------------------------------------- how old somebody is

/**
 * Age bands, derived locally from a date of birth and never from anything sent anywhere.
 *
 * `unknown` is a real answer and the most important one to handle: somebody who skipped the question is not an adult
 * by default, and is not a child either. It gets its own policy rather than borrowing one.
 */
export type AgeBand = 'child' | 'preteen' | 'teen' | 'older-teen' | 'adult' | 'unknown'

/** What kind of thing a page is. `unknown` is never treated as safe. */
export type ContentCategory =
  | 'education'
  | 'reference'
  | 'productivity'
  | 'communication'
  | 'social'
  | 'entertainment'
  | 'streaming'
  | 'gaming'
  | 'gambling'
  | 'adult'
  | 'dating'
  | 'shopping'
  | 'news'
  | 'unsafe'
  | 'violent'
  | 'unknown'

/** Where a decision about a page came from, so a student can be told why rather than just "no". */
export type SafetySource = 'age-policy' | 'blocked-list' | 'approved-list' | 'category' | 'unknown-content' | 'focus-policy' | 'allowed'

export interface SafetyVerdict {
  allowed: boolean
  category: ContentCategory
  source: SafetySource
  /** One sentence a student reads. Never an implementation detail. */
  reason: string
  /** Set when the policy would allow an exception to be asked for. */
  askable: boolean
}

// ---------------------------------------------------------------- focus

export type FocusLevel = 'light' | 'focus' | 'deep'

/**
 * A session's life, as a state machine rather than a handful of booleans.
 *
 * `restored` exists separately from `active` for one turn so that whatever restored it can say so on screen; it moves
 * to `active` immediately afterwards. `expired` is a session whose planned end passed while Orbis was not running --
 * it is not a completion, because nobody was there, and it must not pay out as one.
 */
export type SessionState =
  | 'created'
  | 'ready'
  | 'active'
  | 'paused'
  | 'break'
  | 'recovering'
  | 'completed'
  | 'ended-early'
  | 'interrupted'
  | 'restored'
  | 'expired'

export type PolicyState = 'normal' | 'light' | 'focus' | 'deep' | 'locked' | 'break'

/** What a session is allowed to do to the browser. Snapshotted when the session starts and never edited after. */
export interface FocusPolicy
{
  level: FocusLevel
  /** Categories that are not reachable while this session runs. */
  blocked: readonly ContentCategory[]
  /** Hosts, URL prefixes and whole categories that are reachable whatever else is blocked. */
  approved: readonly string[]
  approvedCategories: readonly ContentCategory[]
  /** Hosts a student named themselves, on top of the categories. */
  blockedSites: readonly string[]
  /** Whether the policy may be weakened without ending the session. */
  locked: boolean
  /** Whether blocked things are stopped or only warned about. */
  enforce: 'warn' | 'block'
  /** Whether a blocked page offers "save for later". */
  allowSaveForLater: boolean
  /** Specific YouTube videos and channels that count as approved, for the one site every student needs both ways. */
  approvedVideos: readonly string[]
  approvedChannels: readonly string[]
  youtube: 'blocked' | 'educational' | 'approved-only' | 'open'
}

/** Pomodoro and the plain shapes around it. */
export interface BreakPlan {
  /** Minutes of focus before a break is offered. 0 means no breaks. */
  focusMinutes: number
  breakMinutes: number
  /** How many focus blocks the session is, counting the one in progress. */
  blocks: number
  /** Whether focus resumes by itself when a break's time is up. */
  autoResume: boolean
}

export interface FocusSession {
  id: string
  profileId: string
  state: SessionState
  /** What this is for, in the student's words. */
  title: string
  subject: string | null
  taskId: string | null
  goalId: string | null
  milestoneId: string | null
  /**
   * The concept this session is about, when it was started from the plan or the mastery map.
   *
   * Kept so finishing the session can record that the concept was worked on -- and only that. Sitting with something
   * for twenty minutes is exposure; it is not evidence that it can be recalled, and nothing here pretends otherwise.
   */
  conceptId: string | null
  /** Why it matters. Shown back only when somebody tries to leave early. */
  intention: string
  /** The one thing that must get done. */
  oneThing: string
  level: FocusLevel
  policy: FocusPolicy
  breaks: BreakPlan
  plannedMinutes: number
  /** Wall-clock start, for showing a time. */
  startedAt: number
  /**
   * The monotonic clock at the moment it started, when one was available.
   *
   * Two clocks are kept because neither is enough alone: wall-clock survives a restart but can be changed by hand or
   * by a time server, and monotonic cannot be changed but does not survive the process. Elapsed time uses monotonic
   * while the process lives and falls back to wall-clock across a restart, with a sanity check between them.
   */
  startedMono: number | null
  endedAt: number | null
  /** Seconds genuinely spent focusing, excluding pauses and breaks. Recomputed, never incremented blindly. */
  focusedSeconds: number
  breakSeconds: number
  /** Seconds into the break happening now. Reset when one begins, so it is never worked out from the log. */
  breakNow: number
  /** Each state change, so a restored session can be reasoned about rather than guessed at. */
  log: readonly SessionLogEntry[]
  /** Milestones already passed, so none pays out twice. */
  milestonesHit: readonly number[]
  interruptions: number
  distractionAttempts: number
  savedForLater: number
  orionTurns: number
  atmosphere: string | null
  playlistId: string | null
  capsuleId: string | null
  spaceId: string | null
  /** Filled at completion. */
  xpAwarded: number
  /** What the student wrote afterwards, if anything. */
  journal: string
  /** Whether this session's completion has already been paid out. The guard against a replayed completion. */
  settled: boolean
  createdAt: number
  updatedAt: number
}

export interface SessionLogEntry {
  at: number
  from: SessionState
  to: SessionState
  /** Plain words: 'started', 'break', 'window closed', 'restored after restart'. */
  note: string
}

/** A reusable session configuration. */
export interface FocusCapsule {
  id: string
  profileId: string
  name: string
  subject: string | null
  task: string
  goalId: string | null
  intention: string
  minutes: number
  level: FocusLevel
  blocked: readonly ContentCategory[]
  approved: readonly string[]
  blockedSites: readonly string[]
  breaks: BreakPlan
  atmosphere: string | null
  playlistId: string | null
  orbi: OrbiBehaviour
  locked: boolean
  notes: string
  favourite: boolean
  /** How many sessions came from this capsule, and how many of those finished. */
  used: number
  completed: number
  createdAt: number
  updatedAt: number
}

/** A place that remembers everything about one subject or project. */
export interface FocusSpace {
  id: string
  profileId: string
  name: string
  subject: string | null
  /** Addresses this space opens with. */
  tabs: readonly { url: string; title: string }[]
  /** `type:id` references into the student's other things. Never copies. */
  items: readonly string[]
  notes: string
  /**
   * The session this was taken for, when it is a snapshot of where somebody was.
   *
   * Set only by the snapshot taken before a strict session starts, so "put back what I had" can find the right one
   * rather than guessing from a name and a timestamp.
   */
  sessionId: string | null
  capsuleIds: readonly string[]
  goalId: string | null
  atmosphere: string | null
  playlistId: string | null
  approved: readonly string[]
  favourite: boolean
  lastUsedAt: number
  createdAt: number
  updatedAt: number
}

/** Something a student decided to look at later rather than now. */
export interface DistractionItem {
  id: string
  profileId: string
  url: string
  title: string
  category: ContentCategory
  savedAt: number
  /** The session it was saved during, so the review can say when it happened. */
  sessionId: string | null
  sessionTitle: string
  note: string
  state: 'waiting' | 'opened' | 'archived' | 'became-task'
}

/** A thought that had nothing to do with studying, caught so it did not have to be chased. */
export interface CapturedThought {
  id: string
  profileId: string
  text: string
  at: number
  sessionId: string | null
  state: 'waiting' | 'became-task' | 'became-note' | 'discarded'
}

// ---------------------------------------------------------------- goals, tasks, subjects

export type GoalHorizon = 'daily' | 'weekly' | 'monthly' | 'long-term'

export interface Goal {
  id: string
  profileId: string
  title: string
  why: string
  horizon: GoalHorizon
  subject: string | null
  /** Optional, and deliberately not shown as a countdown. */
  deadline: number | null
  milestones: readonly GoalMilestone[]
  state: 'active' | 'completed' | 'archived'
  completedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface GoalMilestone {
  id: string
  title: string
  /** A stage name, when the student wants journey stages. Free text; nothing is assumed about exams. */
  stage: string
  targetDate: number | null
  taskIds: readonly string[]
  completedAt: number | null
  order: number
}

export type TaskState = 'planned' | 'active' | 'completed' | 'postponed' | 'archived'

export interface StudentTask {
  id: string
  profileId: string
  title: string
  subject: string | null
  goalId: string | null
  milestoneId: string | null
  priority: 'low' | 'normal' | 'high'
  /** Minutes the student guessed. */
  estimate: number | null
  /** Minutes actually focused against it, summed from sessions. */
  actual: number
  due: number | null
  hasTime: boolean
  state: TaskState
  notes: string
  /** Position in the study queue. */
  order: number
  completedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface SubjectProgress {
  subject: string
  xp: number
  sessions: number
  focusedSeconds: number
  tasksCompleted: number
  quizzes: number
  conceptsReviewed: number
  lastStudiedAt: number | null
}

// ---------------------------------------------------------------- progression

export type XPSource =
  | 'focus-session'
  | 'task'
  | 'daily-goal'
  | 'weekly-goal'
  | 'milestone'
  | 'goal'
  | 'word'
  | 'quiz'
  | 'teaser'
  | 'flashcards'
  | 'review'
  | 'exam'
  | 'streak'
  | 'quest'
  | 'achievement'

/**
 * One payment of XP.
 *
 * `key` is what makes the ledger idempotent: it is derived from what happened (`session:<id>:complete`), not from when
 * it was recorded, so the same event arriving twice -- a replayed completion, a double click, a restored session
 * settling again -- cannot pay twice. Nothing adds to a balance directly; the balance is the sum of this list.
 */
export interface XPEvent {
  id: string
  profileId: string
  source: XPSource
  amount: number
  /** What it was for: a session id, a task id, a quest id. */
  sourceId: string
  key: string
  subject: string | null
  at: number
}

export interface LevelProgress {
  level: number
  xp: number
  /** XP at the start of this level, and at the start of the next. */
  from: number
  to: number
  /** 0..1 through the current level. */
  through: number
}

export type QuestPeriod = 'daily' | 'weekly' | 'monthly'

export interface Quest {
  id: string
  period: QuestPeriod
  title: string
  /** What is counted. */
  metric: QuestMetric
  target: number
  xp: number
}

export type QuestMetric =
  | 'focus-minutes'
  | 'focus-sessions'
  | 'tasks-completed'
  | 'learning-items'
  | 'quizzes'
  | 'reviews'
  | 'milestones'
  | 'words'

export interface QuestProgress {
  questId: string
  period: QuestPeriod
  /** The local day/week/month this progress belongs to, as a plain date key. */
  periodKey: string
  value: number
  target: number
  completedAt: number | null
  /** Whether the XP for finishing it has been paid. */
  settled: boolean
}

export interface AchievementRule {
  id: string
  title: string
  blurb: string
  category: 'focus' | 'learning' | 'goals' | 'consistency' | 'exploration' | 'mastery'
  metric: AchievementMetric
  threshold: number
  xp: number
  /** What it unlocks for Orbi, if anything. */
  unlocks: string | null
}

export type AchievementMetric =
  | 'sessions'
  | 'focus-minutes'
  | 'deep-sessions'
  | 'longest-session'
  | 'focus-streak'
  | 'learning-streak'
  | 'tasks'
  | 'goals'
  | 'milestones'
  | 'capsules'
  | 'words'
  | 'quizzes'
  | 'reviews'
  | 'comeback'

export interface AchievementUnlock {
  achievementId: string
  at: number
  /** The value that crossed the line, so the unlock can be shown honestly. */
  value: number
}

export interface Streak {
  kind: 'focus' | 'learning'
  current: number
  longest: number
  /** The last local day that counted. */
  lastDay: string | null
  /** Days that counted, newest first, kept bounded. */
  days: readonly string[]
  /** Days the student marked as rest. These do not break a streak and do not extend it. */
  restDays: readonly string[]
}

export interface PersonalRecord {
  longestSessionSeconds: number
  longestSessionAt: number | null
  totalFocusedSeconds: number
  bestDaySeconds: number
  bestDay: string | null
  bestWeekSeconds: number
  bestWeek: string | null
  mostXpInDay: number
  mostXpDay: string | null
  mostTasksInDay: number
  longestFocusStreak: number
  longestLearningStreak: number
}

// ---------------------------------------------------------------- learning

export type LearningKind = 'word' | 'concept' | 'science' | 'maths' | 'history' | 'vocabulary' | 'teaser' | 'quiz' | 'fact' | 'flashcard'

export type Difficulty = 'beginner' | 'intermediate' | 'advanced'

/** Where a piece of learning content came from. Always shown, never implied. */
export type ContentOrigin = 'orbis' | 'orion' | 'web' | 'student'

export interface LearningItem {
  id: string
  kind: LearningKind
  title: string
  difficulty: Difficulty
  subject: string | null
  origin: ContentOrigin
  /** The content, by kind. Only the fields that kind uses are filled. */
  body: LearningBody
  /** Age bands this is appropriate for. Checked before anything is shown. */
  bands: readonly AgeBand[]
  tags: readonly string[]
}

export interface LearningBody {
  definition?: string
  pronunciation?: string
  partOfSpeech?: string
  example?: string
  synonyms?: readonly string[]
  antonyms?: readonly string[]
  keyIdea?: string
  commonMistake?: string
  text?: string
  question?: string
  options?: readonly string[]
  answer?: string
  /** For a flashcard. */
  front?: string
  back?: string
  /** Where a fact came from, when it is a fact. */
  source?: string
}

/** What a student has done with one piece of content. The review scheduler's only input. */
export interface LearningReview {
  itemId: string
  profileId: string
  firstSeenAt: number
  lastSeenAt: number
  reviews: number
  correct: number
  /** 0..1. Climbs with a right answer, falls further with a wrong one. */
  confidence: number
  difficulty: Difficulty
  /** When it should come back. */
  dueAt: number
  /** How many times in a row it was right, which is what sets the next gap. */
  streak: number
  state: 'learning' | 'reviewing' | 'known' | 'struggling'
}

export interface Flashcard {
  id: string
  profileId: string
  front: string
  back: string
  subject: string | null
  origin: ContentOrigin
  deck: string
  /**
   * The concept this card is about, when the student says so.
   *
   * Optional, and left alone when it is not set: a card with no concept still works as a card, it simply does not
   * move the mastery map. Guessing which topic a card belongs to from its words would put invented evidence into
   * the one place that is supposed to hold only measured evidence.
   */
  conceptId: string | null
  /** Practice, counted on the card itself: the review engine is for Orbis's own items, not for somebody's cards. */
  practised: number
  recalled: number
  lastPractisedAt: number | null
  createdAt: number
}

export interface QuizAttempt {
  id: string
  profileId: string
  itemId: string
  subject: string | null
  correct: boolean
  answer: string
  at: number
  /** The session it happened during, when it happened during one. */
  sessionId: string | null
}

export interface Mistake {
  id: string
  profileId: string
  subject: string | null
  concept: string
  /** What went wrong, as a kind rather than a judgement. */
  kind: 'concept' | 'calculation' | 'recall' | 'application' | 'careless'
  detail: string
  at: number
  reviewedAt: number | null
  sessionId: string | null
}

export interface ConfusionItem {
  id: string
  profileId: string
  concept: string
  subject: string | null
  note: string
  at: number
  sessionId: string | null
  resolvedAt: number | null
}

export interface Concept {
  id: string
  profileId: string
  name: string
  subject: string | null
  /**
   * One number for the screens that only need one, 0..1. Never from time spent.
   *
   * Worked out from `measured` whenever there is one, so the two can never disagree.
   */
  mastery: number
  /**
   * The real measurement: every dimension separately, and the evidence behind each.
   *
   * Kept beside the concept because mastery and the thing it is about are never useful apart. Null means nothing
   * has been measured yet, which is different from measuring zero.
   */
  measured: Mastery | null
  /** Other concept ids. */
  prerequisites: readonly string[]
  related: readonly string[]
  /** Where it sits in a syllabus. Empty when the concept was added on its own. */
  chapterId: string | null
  chapterName: string
  /** 1..5, and 0..1. Both from the syllabus, both used to order work. */
  difficulty: number
  importance: number
  order: number
  lastTouchedAt: number
  notes: string
}

// ---------------------------------------------------------------- what a student keeps

export interface StudyResource {
  id: string
  profileId: string
  /** The canonical address, so the same page saved twice is the same resource. */
  url: string
  title: string
  kind: 'website' | 'pdf' | 'video' | 'document' | 'note' | 'tool' | 'generated'
  subject: string | null
  goalId: string | null
  tags: readonly string[]
  notes: string
  origin: ContentOrigin
  favourite: boolean
  read: boolean
  /** For a research source. */
  relevance: 'high' | 'medium' | 'low' | null
  savedAt: number
  lastOpenedAt: number | null
}

export interface StudyNote {
  id: string
  profileId: string
  title: string
  body: string
  kind: 'quick' | 'rich' | 'checklist' | 'concept' | 'question' | 'mistake' | 'summary'
  subject: string | null
  goalId: string | null
  sessionId: string | null
  conceptId: string | null
  /** `type:id` references. */
  items: readonly string[]
  createdAt: number
  updatedAt: number
}

export interface Whiteboard {
  id: string
  profileId: string
  name: string
  /** The drawing, as the board's own serialised strokes. Opaque here on purpose. */
  data: unknown
  sessionId: string | null
  capsuleId: string | null
  spaceId: string | null
  goalId: string | null
  createdAt: number
  updatedAt: number
}

// ---------------------------------------------------------------- Orbi

/**
 * Orbi's states. A machine with one current state, not a set of flags that can contradict each other.
 */
export type OrbiState =
  | 'idle'
  | 'ready'
  | 'focused'
  | 'thinking'
  | 'listening'
  | 'explaining'
  | 'encouraging'
  | 'curious'
  | 'break'
  | 'sleeping'
  | 'celebrating'
  | 'level-up'
  | 'achievement'
  | 'recovery'
  | 'distraction-warning'
  | 'focus-locked'
  | 'error'
  | 'offline'

/**
 * How Orbi carries itself.
 *
 * The first six are the styles somebody picks. The last four are what older profiles have on disk and are kept
 * valid for ever rather than migrated: `styleFor` in `orbiCharacter.ts` maps each to the nearest of the six, so a
 * setting saved a year ago still resolves and nobody's choice silently resets.
 */
export type OrbiPersonality =
  | 'cute'
  | 'minimal'
  | 'futuristic'
  | 'academic'
  | 'competitive'
  | 'mature'
  | 'calm'
  | 'energetic'
  | 'playful'

export interface OrbiBehaviour {
  enabled: boolean
  visibility: 'full' | 'compact' | 'minimal' | 'hidden'
  personality: OrbiPersonality
  /** How often Orbi may say something, from never to normally. */
  messages: 'off' | 'rare' | 'normal'
  animation: 'full' | 'reduced' | 'off'
  voice: 'off' | 'minimal' | 'normal'
  celebration: 'off' | 'subtle' | 'full'
  size: 'small' | 'medium' | 'large'
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
}

export interface OrbiProfile {
  profileId: string
  name: string
  level: number
  behaviour: OrbiBehaviour
  /** Cosmetic ids that have been unlocked, and which are worn. */
  unlocked: readonly string[]
  worn: readonly string[]
  room: readonly { itemId: string; x: number; y: number }[]
  updatedAt: number
}

/** Something Orbi might say. Kept as content, not inside a component. */
export type MotivationEvent =
  | 'session-started'
  | 'first-milestone'
  | 'half-way'
  | 'final-stretch'
  | 'distraction-attempt'
  | 'session-complete'
  | 'break-started'
  | 'break-over'
  | 'comeback'
  | 'goal-complete'
  | 'task-complete'
  | 'level-up'
  | 'achievement'
  | 'losing-focus'
  | 'rest-day'

export interface CoachMessage {
  event: MotivationEvent
  text: string
  orbi: OrbiState
  priority: 'high' | 'medium' | 'low'
}

// ---------------------------------------------------------------- settings

export interface StudentPreferences {
  name: string
  /** The date of birth, as a plain local date. Never leaves the profile. */
  dob: string | null
  learning: readonly string[]
  workingToward: readonly string[]
  focusStyle: 'short' | 'pomodoro' | 'long' | 'deep' | 'flexible' | 'unsure'
  atmosphere: string
  onboarded: boolean
  onboardedAt: number | null
  /**
   * Where Orbi's tour of the product got to.
   *
   * Kept apart from `onboarded` on purpose: answering the setup questions and being shown round are two different
   * things, and somebody who skipped the tour must not be asked the questions again to see it.
   */
  tourAt: string | null
  tourDone: boolean
  /** Long-term reason, shown rarely and only when it helps. */
  why: string

  defaultMinutes: number
  defaultLevel: FocusLevel
  defaultAtmosphere: string | null
  defaultPlaylistId: string | null
  defaultBreaks: BreakPlan
  exitConfirmation: boolean
  blockedCategories: readonly ContentCategory[]
  approvedSites: readonly string[]
  blockedSites: readonly string[]
  youtube: FocusPolicy['youtube']

  orbi: OrbiBehaviour
  /**
   * Where Orbi was last put, as a fraction of the window.
   *
   * Fractions rather than pixels, so moving to a different screen or resizing the window does not leave Orbi
   * off the edge. Null means it sits in the corner the behaviour asks for.
   */
  orbiAt: { x: number; y: number } | null
  motivationStyle: 'calm' | 'goal' | 'energetic' | 'academic' | 'self-competition' | 'minimal'

  difficulty: Difficulty
  learningReminders: boolean

  musicOnFocus: 'off' | 'suggest' | 'auto'
  volumes: { music: number; atmosphere: number; ui: number; orbi: number }

  notifications: 'all' | 'important' | 'focus' | 'off'
  briefingMorning: boolean
  briefingEvening: boolean
  /**
   * Hours of the day Orbi says nothing at all, as whole hours on a 24-hour clock.
   *
   * `from` may be later than `to`, which is how a night runs across midnight -- 22 to 7 is the usual answer. Null
   * means no quiet hours, not "quiet all day": an empty range and a whole day are opposite answers and the code
   * must not confuse the two.
   */
  quietHours: { from: number; to: number } | null
  /**
   * A town, if the student wants Orbi to drift differently when it is raining.
   *
   * Typed in by them and nothing else: Student never asks for a location, never reads one, and with this empty the
   * weather is simply not part of how Orbi moves.
   */
  weatherCity: string | null
  /**
   * Quiet until this moment, whatever the hours say.
   *
   * One tap, an hour of silence, and it expires by itself. Nothing is ever muted permanently by accident.
   */
  quietUntil: number | null

  reducedMotion: boolean
  reducedTransparency: boolean
  highContrast: boolean
  largerText: boolean
  density: 'calm' | 'standard' | 'dense'

  /** Which dashboard widgets are shown, in order. */
  widgets: readonly string[]
  hiddenWidgets: readonly string[]

  /** Safety the student (or whoever set the profile up) chose on top of the age band. */
  safetyOverride: 'age' | 'strict' | 'off'
  updatedAt: number
}

// ---------------------------------------------------------------- what a day looked like

export interface DailyRecap {
  day: string
  focusedSeconds: number
  sessions: number
  completed: number
  xp: number
  tasksCompleted: number
  learningItems: number
  quizzes: number
  distractionsSaved: number
  subjects: readonly { subject: string; seconds: number }[]
}

export interface Insight {
  id: string
  /** Plain, measured and never a claim about a person. */
  text: string
  kind: 'focus' | 'learning' | 'goals' | 'consistency'
  at: number
}

/** Everything a Student surface needs in one answer. */
export interface StudentSnapshot {
  preferences: StudentPreferences
  orbi: OrbiProfile
  band: AgeBand
  session: FocusSession | null
  policyState: PolicyState
  /** Live numbers about the running session, worked out rather than stored. */
  timer: TimerView | null
  level: LevelProgress
  streaks: readonly Streak[]
  quests: readonly (QuestProgress & { title: string; xp: number })[]
  today: DailyRecap
  goals: readonly Goal[]
  queue: readonly StudentTask[]
  due: number
  waiting: number
  records: PersonalRecord
  achievements: readonly AchievementUnlock[]
  recommendation: SessionRecommendation | null
  /** Set only when a personal record is within a few minutes, or has just been beaten. */
  record: { what: string; inSeconds: number; beaten: boolean } | null
  /** How many extra minutes have been taken today, and whether another is on offer. */
  extraMinutes: number
  canExtend: boolean
}

export interface TimerView {
  state: SessionState
  /** Seconds focused so far. */
  elapsed: number
  /** Seconds left of the planned time, floored at zero. */
  remaining: number
  plannedSeconds: number
  /** 0..1. */
  through: number
  /** The next milestone in seconds of elapsed time, when there is one. */
  nextMilestone: number | null
  breakRemaining: number | null
  block: number
  blocks: number
  locked: boolean
}

export interface SessionRecommendation {
  minutes: number
  level: FocusLevel
  subject: string | null
  taskId: string | null
  capsuleId: string | null
  atmosphere: string | null
  /** Why this was suggested, in the student's terms and only from what they did. */
  because: string
  /** How sure Orbis is, so a weak suggestion can be shown as one. */
  confidence: number
}
