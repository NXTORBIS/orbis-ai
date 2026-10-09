/**
 * What a course is made of.
 *
 * ## Content is data, not components
 *
 * A lesson is a structure here, never a React file. That is the difference between a product that can hold a
 * hundred courses and one that holds the three somebody hand-wrote: courses can be written, imported, versioned
 * and validated without touching the application, and the interface renders whatever it is handed.
 *
 * ## Nothing has a fixed size
 *
 * A course has as many lessons as the subject needs — eighteen or a hundred and twelve. There is no constant
 * anywhere saying how long a course is, and anything that counts lessons counts the actual lessons. A padded
 * course is worse than a short one.
 *
 * ## Imported content is untrusted
 *
 * A course may come from a file, a textbook or a model. Its text is content and never instruction: nothing in a
 * lesson can change what Orbis is allowed to do, and `validate.ts` is what every course goes through before it
 * is stored.
 */

export type Difficulty = 'beginner' | 'intermediate' | 'advanced' | 'expert'

/** Where a course came from. Decides how much its content is trusted and what may be said about it. */
export type CourseOrigin = 'orbis' | 'imported' | 'generated' | 'personal'

export interface CourseSummary {
  id: string
  title: string
  subtitle?: string
  shortDescription: string
  category: string
  subcategory?: string
  difficulty: Difficulty
  /** Worked out from the content, never typed in by hand. */
  lessonCount: number
  moduleCount: number
  /** Minutes, summed from the lessons. */
  estimatedMinutes: number
  language: string
  tags: string[]
  origin: CourseOrigin
  version: number
  icon?: string
  /** A pair of colours for the cover, so artwork needs no image file. */
  cover?: { from: string; to: string }
  updatedAt: number
}

export interface Course extends CourseSummary {
  description: string
  objectives: string[]
  skills: string[]
  prerequisites: string[]
  audience?: string
  modules: Module[]
  /** Every concept the course teaches, and how they depend on one another. */
  concepts: Concept[]
  completion: CompletionRules
  /** The final assessment, when the course has one. */
  assessment?: Assessment
  certificate: boolean
  createdAt: number
}

export interface Module {
  id: string
  title: string
  summary: string
  lessons: Lesson[]
  /** Concepts this module is responsible for. Used for progress and for revision. */
  concepts: string[]
}

/** A lesson is a sequence of blocks. New kinds of block are added here, not in a component. */
export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  | { kind: 'callout'; tone: 'note' | 'warning' | 'tip'; text: string }
  | { kind: 'example'; title?: string; text: string }
  | { kind: 'code'; language: string; code: string; caption?: string }
  | { kind: 'formula'; latex: string; caption?: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'image'; alt: string; src: string; caption?: string }
  | { kind: 'quote'; text: string; from?: string }
  /** A question asked inside the lesson, to be answered before moving on. */
  | { kind: 'check'; questionId: string }
  /**
   * A real Orbis laboratory, opened from inside the lesson.
   *
   * `appId` is a laboratory the registry actually holds, and `validate.ts` refuses a lesson that names one Orbis
   * has not got -- so a card can never be drawn for something that will not open. `does` is what the learner is
   * being asked to do there, because "Open the Neural Network Playground" without a task is a detour.
   */
  | { kind: 'lab'; appId: string; title: string; does: string; optional?: boolean }

export interface Lesson {
  id: string
  title: string
  /** Why this lesson exists and what somebody will be able to do afterwards. */
  intro: string
  objectives: string[]
  blocks: Block[]
  /** The concepts this lesson teaches. Everything measured about it hangs off these. */
  concepts: string[]
  /** Concepts somebody should already have. A gap here is what remediation looks for. */
  requires: string[]
  minutes: number
  difficulty: Difficulty
  /** Questions for practice and for the checkpoint at the end. */
  questions: Question[]
  /** False for a lesson that is worth reading but not required to finish the course. */
  required: boolean
}

export interface Concept {
  id: string
  name: string
  /** One sentence. Shown when a concept is offered for revision or remediation. */
  blurb: string
  /** Concepts that must come first. The edges of the graph. */
  requires: string[]
  /** How central this is to the course, 0..1. Decides what revision prioritises. */
  weight: number
}

// ---------------------------------------------------------------- questions

export type QuestionKind =
  | 'choice'
  | 'multi'
  | 'true-false'
  | 'number'
  | 'short'
  | 'order'
  | 'match'
  | 'code'

export interface Question {
  id: string
  kind: QuestionKind
  /** The concept this tests. Without it a wrong answer teaches the engine nothing. */
  concept: string
  prompt: string
  difficulty: Difficulty
  /** For choice and multi. The order shown is decided at run time, never stored. */
  options?: string[]
  /** Indices into `options`, or the literal answer for the other kinds. */
  answer: number[] | string | number | boolean
  /** How close a number has to be. Absent means exact. */
  tolerance?: number
  /** Accepted forms for a short answer, lower-cased and compared loosely. */
  accepts?: string[]
  /** Said after answering, right or wrong. The part that actually teaches. */
  explanation: string
  /** Offered one at a time, before the answer. */
  hints: string[]
  /** Minutes. Used for the estimate, not enforced. */
  minutes?: number
}

export interface Assessment {
  id: string
  title: string
  /** Drawn from across the course, and never only the questions already seen in quizzes. */
  questionIds: string[]
  /** How many to ask. Fewer than the pool, so two attempts are not the same paper. */
  ask: number
  passScore: number
  minutes?: number
}

// ---------------------------------------------------------------- finishing

export interface CompletionRules {
  /** Every required lesson must be done. Always true in practice, but a course may say otherwise. */
  requiredLessons: boolean
  /** The share of all lessons that must be completed, 0..1. */
  lessonShare: number
  /** Quizzes that must be passed, by module id. Empty means every module's quiz. */
  requiredQuizzes: string[]
  /** The pass mark for a module quiz. Eighty per cent unless a course says otherwise. */
  quizPass: number
  /** Whether the final assessment must be passed. */
  needsAssessment: boolean
  /** Average mastery across the course's concepts, 0..1, or null when mastery is not required. */
  masteryAtLeast: number | null
  /** Projects that must be finished. */
  requiredProjects: string[]
}

export const DEFAULT_COMPLETION: CompletionRules = {
  requiredLessons: true,
  lessonShare: 1,
  requiredQuizzes: [],
  /*
   * Eighty per cent.
   *
   * Carried over deliberately: a pass mark low enough to scrape through by guessing makes a quiz a formality,
   * and a quiz that is a formality makes the whole progress number a lie.
   */
  quizPass: 0.8,
  needsAssessment: false,
  masteryAtLeast: null,
  requiredProjects: []
}

export interface Project {
  id: string
  title: string
  brief: string
  steps: string[]
  minutes: number
  /** What a finished one looks like, so somebody can judge their own. */
  done: string[]
}

// ---------------------------------------------------------------- what a learner has done

export type LessonState = 'not-started' | 'reading' | 'done'

export interface LessonProgress {
  lessonId: string
  state: LessonState
  /** Where they stopped, as an index into the blocks. */
  atBlock: number
  seconds: number
  startedAt: number | null
  doneAt: number | null
  /** How many times they have come back to it. */
  visits: number
}

export interface QuestionAttempt {
  id: string
  questionId: string
  concept: string
  at: number
  right: boolean
  /** What they answered, kept so an explanation can refer to it. */
  given: string
  hintsUsed: number
  seconds: number
}

export interface QuizAttempt {
  id: string
  /** The module, or the course for a final assessment. */
  scope: string
  at: number
  score: number
  passed: boolean
  asked: number
  right: number
  /** Concepts that went wrong, for the retry screen and for practice. */
  weak: string[]
  seconds: number
}

/** Where a learner is in a course, and everything they have done in it. */
export interface Enrollment {
  courseId: string
  courseVersion: number
  profileId: string
  startedAt: number
  lastAt: number
  /** Exactly where to go back to. */
  at: { moduleId: string; lessonId: string; block: number } | null
  lessons: LessonProgress[]
  quizzes: QuizAttempt[]
  attempts: QuestionAttempt[]
  /** Concept id to mastery record. */
  mastery: Record<string, MasteryRecord>
  projects: { projectId: string; doneAt: number | null; notes: string }[]
  /** Set when the course was finished and the rules were met. */
  completedAt: number | null
  certificateId: string | null
  seconds: number
  /** Marked by hand, so a course can be set aside without losing it. */
  archived: boolean
}

export type MasteryState = 'introduced' | 'practised' | 'recalled' | 'applied' | 'assessed' | 'mastered'

export interface MasteryRecord {
  concept: string
  state: MasteryState
  /** 0..1. What everything below adds up to. */
  score: number
  seen: number
  right: number
  wrong: number
  hints: number
  lastAt: number
  /** When it is next worth going over. Null means nothing is scheduled. */
  reviewAt: number | null
  /** How many times it has come back for review and been got right. */
  reviews: number
}

export interface Certificate {
  id: string
  courseId: string
  courseTitle: string
  courseVersion: number
  profileId: string
  learnerName: string
  issuedAt: number
  /** What was actually achieved, so the certificate says something true. */
  lessonsDone: number
  lessonsTotal: number
  averageQuiz: number
  assessmentScore: number | null
  issuer: string
}

/** What the dashboard needs about a course, without loading the course itself. */
export interface CourseCard extends CourseSummary {
  enrolled: boolean
  progress: number
  /** Where they stopped, in words. */
  nextUp: string | null
  completedAt: number | null
}
