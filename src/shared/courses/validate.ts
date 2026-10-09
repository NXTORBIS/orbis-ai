/**
 * Checking a course before Orbis will keep it.
 *
 * ## A course is content, and content is never trusted
 *
 * A course may arrive from a file somebody downloaded, a textbook, or a model. Its text is data: it can say
 * anything at all and it still cannot change what Orbis does. Everything here is about shape and bounds — no
 * field is executed, no field becomes an instruction, and the one place prose could be mistaken for authority
 * (a lesson that tells Orion what to do) is handled by the context builder fencing it as material.
 *
 * ## Refusing is better than half-keeping
 *
 * A course missing its answers, or with a prerequisite loop, cannot be taught — and storing it anyway produces a
 * learner stuck on a question that cannot be marked. `check` reports every problem at once, in words, so an
 * import either works or says exactly what is wrong with it.
 *
 * ## Nothing here caps how big a course is
 *
 * There are limits on the size of a *field*, because a title of ten megabytes is an attack rather than a title.
 * There is deliberately no limit on how many lessons a course has.
 */

import { buildGraph, cyclesIn } from './graph.ts'
import { DEFAULT_COMPLETION, type Block, type Course, type Difficulty, type Lesson, type Module, type Question } from './types.ts'

/** Field sizes. Generous enough for real material, small enough that nothing here is a way to fill a disk. */
export const LIMITS = {
  title: 200,
  text: 20_000,
  code: 40_000,
  blurb: 600,
  options: 12,
  hints: 5,
  blocksPerLesson: 400,
  questionsPerLesson: 60
}

export interface Problem {
  where: string
  says: string
  /** A problem that makes the course unusable, as opposed to one worth mentioning. */
  fatal: boolean
}

const DIFFICULTIES: readonly Difficulty[] = ['beginner', 'intermediate', 'advanced', 'expert']

const str = (value: unknown, limit: number): string => (typeof value === 'string' ? value.slice(0, limit) : '')
const strs = (value: unknown, limit: number, each = 200): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string').map((one) => one.slice(0, each)).slice(0, limit) : []
const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)
const id = (value: unknown): string => str(value, 80).replace(/[^a-zA-Z0-9_.:-]/g, '')

/** One block, cleaned. Anything unrecognised becomes null and is dropped rather than rendered blindly. */
export function cleanBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== 'object') return null
  const one = raw as Record<string, unknown>
  switch (one.kind) {
    case 'text':
      return str(one.text, LIMITS.text) ? { kind: 'text', text: str(one.text, LIMITS.text) } : null
    case 'heading':
      return str(one.text, LIMITS.title) ? { kind: 'heading', text: str(one.text, LIMITS.title) } : null
    case 'list': {
      const items = strs(one.items, 60, 600)
      return items.length > 0 ? { kind: 'list', items, ordered: flag(one.ordered, false) } : null
    }
    case 'callout': {
      const tone = one.tone === 'warning' || one.tone === 'tip' ? one.tone : 'note'
      return str(one.text, LIMITS.text) ? { kind: 'callout', tone, text: str(one.text, LIMITS.text) } : null
    }
    case 'example':
      return str(one.text, LIMITS.text) ? { kind: 'example', title: str(one.title, LIMITS.title) || undefined, text: str(one.text, LIMITS.text) } : null
    case 'code':
      return str(one.code, LIMITS.code)
        ? { kind: 'code', language: str(one.language, 30) || 'text', code: str(one.code, LIMITS.code), caption: str(one.caption, LIMITS.title) || undefined }
        : null
    case 'formula':
      return str(one.latex, 2000) ? { kind: 'formula', latex: str(one.latex, 2000), caption: str(one.caption, LIMITS.title) || undefined } : null
    case 'table': {
      const headers = strs(one.headers, 12, 200)
      const rows = Array.isArray(one.rows) ? one.rows.map((row) => strs(row, 12, 400)).slice(0, 200) : []
      return headers.length > 0 ? { kind: 'table', headers, rows } : null
    }
    case 'image': {
      const src = str(one.src, 2048)
      /*
       * Only addresses that cannot execute anything.
       *
       * A `javascript:` source in a course file would be a course deciding what Orbis runs, which is exactly the
       * thing none of this is allowed to become.
       */
      const safe = /^(https?:\/\/|data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,)/i.test(src)
      return safe ? { kind: 'image', alt: str(one.alt, 300), src, caption: str(one.caption, LIMITS.title) || undefined } : null
    }
    case 'quote':
      return str(one.text, LIMITS.text) ? { kind: 'quote', text: str(one.text, LIMITS.text), from: str(one.from, LIMITS.title) || undefined } : null
    case 'check': {
      const questionId = id(one.questionId)
      return questionId ? { kind: 'check', questionId } : null
    }
    case 'lab': {
      /*
       * A laboratory is named by its registry id, and the id is checked against what Orbis really has by
       * `check()` below rather than here -- this only shapes the block. A lesson pointing at a laboratory that
       * does not exist is a reported fault, never a card that does nothing when pressed.
       */
      const appId = str(one.appId, 80)
      const title = str(one.title, LIMITS.title)
      const does = str(one.does, LIMITS.text)
      if (!appId || !title || !does) return null
      return { kind: 'lab', appId, title, does, ...(flag(one.optional, false) ? { optional: true } : {}) }
    }
    default:
      return null
  }
}

export function cleanQuestion(raw: unknown): Question | null {
  if (!raw || typeof raw !== 'object') return null
  const one = raw as Record<string, unknown>
  const questionId = id(one.id)
  const prompt = str(one.prompt, LIMITS.text)
  const concept = id(one.concept)
  if (!questionId || !prompt || !concept) return null

  const kind = (['choice', 'multi', 'true-false', 'number', 'short', 'order', 'match', 'code'] as const).find((two) => two === one.kind) ?? 'short'
  const options = strs(one.options, LIMITS.options, 600)

  // An answer that does not fit its kind makes the question unmarkable, so the question is dropped.
  let answer: Question['answer']
  if (kind === 'choice') {
    const at = num(one.answer, -1)
    if (!(at >= 0 && at < options.length)) return null
    answer = at
  } else if (kind === 'multi' || kind === 'order' || kind === 'match') {
    const list = Array.isArray(one.answer) ? one.answer.filter((two): two is number => typeof two === 'number' && two >= 0) : []
    if (list.length === 0) return null
    answer = list
  } else if (kind === 'true-false') {
    if (typeof one.answer !== 'boolean') return null
    answer = one.answer
  } else if (kind === 'number') {
    if (typeof one.answer !== 'number' || !Number.isFinite(one.answer)) return null
    answer = one.answer
  } else {
    const text = str(one.answer, 2000)
    if (!text) return null
    answer = text
  }

  return {
    id: questionId,
    kind,
    concept,
    prompt,
    difficulty: DIFFICULTIES.find((two) => two === one.difficulty) ?? 'intermediate',
    options: options.length > 0 ? options : undefined,
    answer,
    tolerance: typeof one.tolerance === 'number' && one.tolerance >= 0 ? one.tolerance : undefined,
    accepts: strs(one.accepts, 10, 300),
    explanation: str(one.explanation, LIMITS.text),
    hints: strs(one.hints, LIMITS.hints, 600),
    minutes: num(one.minutes, 1)
  }
}

export function cleanLesson(raw: unknown): Lesson | null {
  if (!raw || typeof raw !== 'object') return null
  const one = raw as Record<string, unknown>
  const lessonId = id(one.id)
  const title = str(one.title, LIMITS.title)
  if (!lessonId || !title) return null
  const blocks = (Array.isArray(one.blocks) ? one.blocks : []).map(cleanBlock).filter((two): two is Block => two !== null).slice(0, LIMITS.blocksPerLesson)
  const questions = (Array.isArray(one.questions) ? one.questions : [])
    .map(cleanQuestion)
    .filter((two): two is Question => two !== null)
    .slice(0, LIMITS.questionsPerLesson)
  return {
    id: lessonId,
    title,
    intro: str(one.intro, LIMITS.blurb),
    objectives: strs(one.objectives, 10, 300),
    blocks,
    concepts: strs(one.concepts, 20, 80).map((two) => two.replace(/[^a-zA-Z0-9_.:-]/g, '')),
    requires: strs(one.requires, 20, 80).map((two) => two.replace(/[^a-zA-Z0-9_.:-]/g, '')),
    minutes: Math.max(1, Math.min(600, Math.round(num(one.minutes, 8)))),
    difficulty: DIFFICULTIES.find((two) => two === one.difficulty) ?? 'beginner',
    questions,
    required: flag(one.required, true)
  }
}

export function cleanModule(raw: unknown): Module | null {
  if (!raw || typeof raw !== 'object') return null
  const one = raw as Record<string, unknown>
  const moduleId = id(one.id)
  const title = str(one.title, LIMITS.title)
  if (!moduleId || !title) return null
  const lessons = (Array.isArray(one.lessons) ? one.lessons : []).map(cleanLesson).filter((two): two is Lesson => two !== null)
  return {
    id: moduleId,
    title,
    summary: str(one.summary, LIMITS.blurb),
    lessons,
    concepts: strs(one.concepts, 60, 80)
  }
}

/**
 * A course, cleaned into something Orbis can hold.
 *
 * Always returns a course or null — never a half-built one. The counts are recomputed from the content rather
 * than taken from the file, so a course claiming fifty lessons and carrying twelve shows twelve.
 */
export function cleanCourse(raw: unknown, now: number): Course | null {
  if (!raw || typeof raw !== 'object') return null
  const one = raw as Record<string, unknown>
  const courseId = id(one.id)
  const title = str(one.title, LIMITS.title)
  if (!courseId || !title) return null

  const modules = (Array.isArray(one.modules) ? one.modules : []).map(cleanModule).filter((two): two is Module => two !== null)
  const lessons = modules.flatMap((two) => two.lessons)

  const concepts = (Array.isArray(one.concepts) ? one.concepts : [])
    .map((two) => {
      if (!two || typeof two !== 'object') return null
      const three = two as Record<string, unknown>
      const conceptId = id(three.id)
      if (!conceptId) return null
      return {
        id: conceptId,
        name: str(three.name, LIMITS.title) || conceptId,
        blurb: str(three.blurb, LIMITS.blurb),
        requires: strs(three.requires, 20, 80).map((four) => four.replace(/[^a-zA-Z0-9_.:-]/g, '')),
        weight: Math.max(0, Math.min(1, num(three.weight, 0.5)))
      }
    })
    .filter((two): two is Course['concepts'][number] => two !== null)

  const completionRaw = (one.completion && typeof one.completion === 'object' ? one.completion : {}) as Record<string, unknown>
  const completion = {
    requiredLessons: flag(completionRaw.requiredLessons, DEFAULT_COMPLETION.requiredLessons),
    lessonShare: Math.max(0, Math.min(1, num(completionRaw.lessonShare, DEFAULT_COMPLETION.lessonShare))),
    requiredQuizzes: strs(completionRaw.requiredQuizzes, 200, 80),
    // Never below half: a pass mark a guess could reach makes the quiz meaningless.
    quizPass: Math.max(0.5, Math.min(1, num(completionRaw.quizPass, DEFAULT_COMPLETION.quizPass))),
    needsAssessment: flag(completionRaw.needsAssessment, DEFAULT_COMPLETION.needsAssessment),
    masteryAtLeast: typeof completionRaw.masteryAtLeast === 'number' ? Math.max(0, Math.min(1, completionRaw.masteryAtLeast)) : null,
    requiredProjects: strs(completionRaw.requiredProjects, 20, 80)
  }

  const assessmentRaw = one.assessment && typeof one.assessment === 'object' ? (one.assessment as Record<string, unknown>) : null
  const assessment = assessmentRaw
    ? {
        id: id(assessmentRaw.id) || `${courseId}.final`,
        title: str(assessmentRaw.title, LIMITS.title) || 'Final assessment',
        questionIds: strs(assessmentRaw.questionIds, 500, 80),
        ask: Math.max(1, Math.min(200, Math.round(num(assessmentRaw.ask, 20)))),
        passScore: Math.max(0.5, Math.min(1, num(assessmentRaw.passScore, completion.quizPass))),
        minutes: Math.max(1, Math.min(600, Math.round(num(assessmentRaw.minutes, 25))))
      }
    : undefined

  const estimated = lessons.reduce((sum, two) => sum + two.minutes, 0) + modules.filter((two) => two.lessons.length > 0).length * 6 + (assessment?.minutes ?? 0)

  return {
    id: courseId,
    title,
    subtitle: str(one.subtitle, LIMITS.title) || undefined,
    description: str(one.description, LIMITS.text),
    shortDescription: str(one.shortDescription, LIMITS.blurb) || str(one.description, LIMITS.blurb),
    category: str(one.category, 80) || 'General',
    subcategory: str(one.subcategory, 80) || undefined,
    difficulty: DIFFICULTIES.find((two) => two === one.difficulty) ?? 'beginner',
    // Counted, never claimed: a course saying it has fifty lessons and carrying twelve shows twelve.
    lessonCount: lessons.length,
    moduleCount: modules.length,
    estimatedMinutes: estimated,
    language: str(one.language, 20) || 'en',
    tags: strs(one.tags, 20, 60),
    origin: (['orbis', 'imported', 'generated', 'personal'] as const).find((two) => two === one.origin) ?? 'imported',
    version: Math.max(1, Math.round(num(one.version, 1))),
    icon: str(one.icon, 40) || undefined,
    cover:
      one.cover && typeof one.cover === 'object'
        ? { from: str((one.cover as Record<string, unknown>).from, 40), to: str((one.cover as Record<string, unknown>).to, 40) }
        : undefined,
    updatedAt: num(one.updatedAt, now),
    createdAt: num(one.createdAt, now),
    objectives: strs(one.objectives, 20, 300),
    skills: strs(one.skills, 30, 120),
    prerequisites: strs(one.prerequisites, 20, 200),
    audience: str(one.audience, LIMITS.blurb) || undefined,
    modules,
    concepts,
    completion,
    assessment,
    certificate: flag(one.certificate, true)
  }
}

/**
 * Everything wrong with a course, said at once.
 *
 * Fatal problems make it unteachable. The rest are worth telling whoever wrote it without refusing their work.
 */
export function check(course: Course, labs?: ReadonlySet<string>): Problem[] {
  const out: Problem[] = []
  const lessons = course.modules.flatMap((one) => one.lessons)

  if (course.modules.length === 0) out.push({ where: course.id, says: 'The course has no modules.', fatal: true })
  if (lessons.length === 0) out.push({ where: course.id, says: 'The course has no lessons.', fatal: true })

  const lessonIds = new Set<string>()
  for (const lesson of lessons) {
    if (lessonIds.has(lesson.id)) out.push({ where: lesson.id, says: 'Two lessons share an id.', fatal: true })
    lessonIds.add(lesson.id)
    if (lesson.blocks.length === 0) out.push({ where: lesson.id, says: `"${lesson.title}" has nothing in it.`, fatal: true })
  }

  const conceptIds = new Set(course.concepts.map((one) => one.id))
  for (const lesson of lessons) {
    for (const concept of [...lesson.concepts, ...lesson.requires]) {
      if (!conceptIds.has(concept)) out.push({ where: lesson.id, says: `Mentions a concept the course never declares: ${concept}.`, fatal: false })
    }
  }

  const questionIds = new Set<string>()
  for (const lesson of lessons) {
    for (const question of lesson.questions) {
      if (questionIds.has(question.id)) out.push({ where: question.id, says: 'Two questions share an id.', fatal: true })
      questionIds.add(question.id)
      if (!question.explanation) out.push({ where: question.id, says: 'A question with no explanation teaches nothing when it is got wrong.', fatal: false })
      if ((question.kind === 'choice' || question.kind === 'multi') && (question.options ?? []).length < 2) {
        out.push({ where: question.id, says: 'A choice question needs at least two options.', fatal: true })
      }
    }
    // A check block pointing at a question that does not exist would stop the lesson dead.
    for (const block of lesson.blocks) {
      if (block.kind === 'check' && !lesson.questions.some((one) => one.id === block.questionId)) {
        out.push({ where: lesson.id, says: 'A checkpoint points at a question that is not in the lesson.', fatal: true })
      }
      /*
       * A laboratory the registry does not hold.
       *
       * Reported rather than drawn, because a card that opens nothing is worse than no card: the learner is told
       * to go and do something and then cannot. The set of real laboratories is handed in, so this file still
       * knows nothing about the app registry -- and when the caller does not know either, the check is skipped
       * rather than guessed at.
       */
      if (labs !== undefined && block.kind === 'lab' && !labs.has(block.appId)) {
        out.push({ where: lesson.id, says: `Opens a laboratory Orbis does not have: ${block.appId}.`, fatal: true })
      }
    }
  }

  if (course.assessment) {
    const missing = course.assessment.questionIds.filter((one) => !questionIds.has(one))
    if (missing.length > 0) out.push({ where: course.assessment.id, says: `The assessment asks for ${missing.length} questions the course does not have.`, fatal: true })
    if (course.assessment.questionIds.length < course.assessment.ask) {
      out.push({ where: course.assessment.id, says: 'The assessment asks for more questions than it has.', fatal: true })
    }
  }

  const loops = cyclesIn(buildGraph(course))
  for (const loop of loops) {
    out.push({ where: loop.join(' → '), says: 'These concepts need each other, so there is no order to teach them in.', fatal: true })
  }

  return out
}

export function teachable(course: Course, labs?: ReadonlySet<string>): { ok: boolean; problems: Problem[]; says: string } {
  const problems = check(course, labs)
  const fatal = problems.filter((one) => one.fatal)
  return {
    ok: fatal.length === 0,
    problems,
    says: fatal.length === 0 ? 'Ready to teach.' : `${fatal.length} ${fatal.length === 1 ? 'problem stops' : 'problems stop'} this being taught.`
  }
}
