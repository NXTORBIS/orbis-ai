import { CoursesStore, type StoredSummary } from './store.ts'
import { buildGraph, blockedBy, lessonFor, readyFor, type Graph } from '../../shared/courses/graph.ts'
import { afterAnswer, afterReading, describe as describeMastery, faded, newMastery, overall } from '../../shared/courses/mastery.ts'
import { PASS, markAll, pick, toAttempt, toAttempts, afterFailing, type Given, type Result } from '../../shared/courses/quiz.ts'
import {
  XP,
  canComplete,
  courseProgress,
  courseXp,
  afterVersionChange,
  lessonById,
  lessonXp,
  lessonsOf,
  markAt,
  markLessonDone,
  moduleOf,
  moduleProgress,
  newEnrollment,
  nextUp
} from '../../shared/courses/progress.ts'
import { adapt, dueForReview, nextReview, planPractice, recommend, signalsFrom, type LearningSignals, type PracticeKind } from '../../shared/courses/learn.ts'
import { eligibleFor, issue } from '../../shared/courses/certificate.ts'
import { cleanCourse, teachable } from '../../shared/courses/validate.ts'
import { EVERY_APP_ID } from '../../shared/native/every.ts'
import { offeredHere, packageFor, resolveThis, type Teach, type Where } from '../../shared/courses/orion.ts'
import type { Certificate, Course, CourseCard, Enrollment, Question } from '../../shared/courses/types.ts'

/**
 * Orbis Courses, running.
 *
 * ## Every change goes through here
 *
 * Nothing else writes an enrollment. Marking a lesson done, scoring a quiz, moving mastery, issuing a certificate
 * — all of it is a method here, so the rules about what counts as learning exist in one place and cannot be
 * reached around by a screen in a hurry.
 *
 * ## It gives signals; it does not interrupt
 *
 * Revision due, a module nearly finished, a course gone cold: all of that is published as signals for the parts
 * of Orbis that already decide when to say something. Courses never raises a notification itself — a feature
 * that nags on its own schedule is one people turn off.
 *
 * ## Graphs are built once per course and kept
 *
 * Working out prerequisites on every answer would be the one expensive thing in the loop. The graph for a course
 * is built the first time it is needed and held with it.
 */

export interface CoursesDeps {
  store: CoursesStore
  now(): number
  /** The learner's name, for a certificate. Read at the moment one is issued, never stored here. */
  learnerName(): Promise<string>
  /** Awards XP through the system that already owns it. Absent means XP simply is not awarded. */
  awardXp?(amount: number, why: string): void
  /** Tells the rest of Orbis something happened, so nothing has to poll this. */
  announce?(what: string, detail?: unknown): void
  /**
   * Told what somebody is learning, as they learn it.
   *
   * Ambient Intelligence decides what to do with it, including refusing to record it. Courses deliberately knows
   * nothing about those rules.
   */
  onLearning?(title: string, courseId: string): void
}

export class Courses {
  private readonly o: CoursesDeps
  private readonly graphs = new Map<string, Graph>()
  private counter = 0

  constructor(o: CoursesDeps) {
    this.o = o
  }

  private id(prefix: string): string {
    this.counter += 1
    return `${prefix}-${this.o.now().toString(36)}-${this.counter.toString(36)}`
  }

  private async graphOf(course: Course): Promise<Graph> {
    const held = this.graphs.get(`${course.id}:${course.version}`)
    if (held) return held
    const made = buildGraph(course)
    this.graphs.set(`${course.id}:${course.version}`, made)
    return made
  }

  // ---------------------------------------------------------------- the shelf

  /** Every course, with where the learner is in it. The dashboard's one read. */
  async shelf(): Promise<{ continuing: CourseCard[]; recommended: CourseCard[]; mine: CourseCard[]; all: CourseCard[] }> {
    const [catalogue, enrollments, saved] = await Promise.all([this.o.store.catalogue(), this.o.store.enrollments(), this.o.store.saved()])
    const byId = new Map(enrollments.map((one) => [one.courseId, one]))

    const cards: CourseCard[] = catalogue.map((one) => this.cardFor(one, byId.get(one.id) ?? null))
    const mine = cards.filter((one) => one.enrolled || saved.includes(one.id))

    const continuing = cards
      .filter((one) => one.enrolled && one.completedAt === null && one.progress > 0)
      .sort((a, b) => (byId.get(b.id)?.lastAt ?? 0) - (byId.get(a.id)?.lastAt ?? 0))
      .slice(0, 3)

    const suggestions = recommend(catalogue, enrollments, { most: 3 })
    const recommended = suggestions
      .map((one) => cards.find((two) => two.id === one.courseId))
      .filter((one): one is CourseCard => !!one)

    return { continuing, recommended, mine, all: cards }
  }

  /**
   * A card without reading the course.
   *
   * Progress is approximated from the lessons done against the summary's own count, because the real calculation
   * needs the course and the shelf must not read twenty of them.
   */
  private cardFor(summary: StoredSummary, enrollment: Enrollment | null): CourseCard {
    const done = enrollment ? enrollment.lessons.filter((one) => one.state === 'done').length : 0
    const progress = !enrollment ? 0 : summary.lessonCount === 0 ? 0 : Math.min(1, done / summary.lessonCount)
    return {
      ...summary,
      enrolled: enrollment !== null,
      progress: enrollment?.completedAt ? 1 : progress,
      nextUp: enrollment?.at ? 'Where you stopped' : enrollment ? 'Not started' : null,
      completedAt: enrollment?.completedAt ?? null
    }
  }

  async course(id: string): Promise<Course | null> {
    return this.o.store.course(id)
  }

  /** Everything a detail page shows, in one answer. */
  async detail(courseId: string): Promise<{
    course: Course
    enrollment: Enrollment | null
    progress: number
    modules: ReturnType<typeof moduleProgress>[]
    next: ReturnType<typeof nextUp> | null
    xp: number
    certificate: ReturnType<typeof eligibleFor> | null
    unmet: ReturnType<typeof canComplete>['unmet']
    says: string | null
  } | null> {
    const course = await this.o.store.course(courseId)
    if (!course) return null
    const now = this.o.now()
    let enrollment = await this.o.store.enrollment(courseId)
    let says: string | null = null

    // A course updated under somebody mid-way: keep their progress and say so.
    if (enrollment && enrollment.courseVersion !== course.version) {
      const moved = afterVersionChange(enrollment, course)
      enrollment = moved.enrollment
      says = moved.says
      await this.o.store.saveEnrollment(enrollment)
    }

    return {
      course,
      enrollment,
      progress: enrollment ? courseProgress(course, enrollment, now) : 0,
      modules: enrollment ? course.modules.map((one) => moduleProgress(course, enrollment as Enrollment, one)) : [],
      next: enrollment ? nextUp(course, enrollment, now) : null,
      xp: courseXp(course),
      certificate: enrollment ? eligibleFor(course, enrollment, now) : null,
      unmet: enrollment ? canComplete(course, enrollment, now).unmet : [],
      says
    }
  }

  // ---------------------------------------------------------------- learning

  async enroll(courseId: string): Promise<Enrollment | null> {
    const course = await this.o.store.course(courseId)
    if (!course) return null
    const held = await this.o.store.enrollment(courseId)
    if (held) return held
    const made = newEnrollment(course, this.o.store.profile, this.o.now())
    await this.o.store.saveEnrollment(made)
    this.o.announce?.('courses:enrolled', { courseId })
    return made
  }

  /** A lesson, with everything needed to show and teach it. */
  async lesson(courseId: string, lessonId: string): Promise<{
    course: Course
    lesson: ReturnType<typeof lessonById>
    moduleId: string | null
    atBlock: number
    ready: ReturnType<typeof readyFor> | null
    offered: Teach[]
    mastery: { concept: string; name: string; says: string }[]
  } | null> {
    const course = await this.o.store.course(courseId)
    if (!course) return null
    const lesson = lessonById(course, lessonId)
    if (!lesson) return null
    const enrollment = (await this.o.store.enrollment(courseId)) ?? (await this.enroll(courseId))
    if (!enrollment) return null
    const now = this.o.now()
    const graph = await this.graphOf(course)

    // Opening a lesson is the clearest signal of what somebody is working on that Orbis gets.
    this.o.onLearning?.(`${course.title} — ${lesson.title}`, course.id)

    return {
      course,
      lesson,
      moduleId: moduleOf(course, lessonId)?.id ?? null,
      atBlock: enrollment.lessons.find((one) => one.lessonId === lessonId)?.atBlock ?? 0,
      ready: readyFor(graph, lesson, enrollment.mastery, now),
      offered: offeredHere({ course, lesson, enrollment }),
      mastery: lesson.concepts.map((one) => ({
        concept: one,
        name: course.concepts.find((two) => two.id === one)?.name ?? one,
        says: enrollment.mastery[one] ? describeMastery(enrollment.mastery[one], now) : 'Not started.'
      }))
    }
  }

  /** Where somebody has got to in a lesson. Written often, and cheap. */
  async readingAt(courseId: string, lessonId: string, block: number): Promise<void> {
    const course = await this.o.store.course(courseId)
    const enrollment = await this.o.store.enrollment(courseId)
    if (!course || !enrollment) return
    const module = moduleOf(course, lessonId)
    await this.o.store.saveEnrollment(markAt(enrollment, module?.id ?? '', lessonId, block, this.o.now()))
  }

  /**
   * A lesson finished.
   *
   * Reading moves the concepts a little and deliberately not past "practised" — having read about something is
   * not the same as being able to do it, and the mastery model refuses to pretend otherwise.
   */
  async finishLesson(courseId: string, lessonId: string, seconds = 0): Promise<{ xp: number; progress: number; next: ReturnType<typeof nextUp> } | null> {
    const course = await this.o.store.course(courseId)
    let enrollment = await this.o.store.enrollment(courseId)
    if (!course || !enrollment) return null
    const lesson = lessonById(course, lessonId)
    if (!lesson) return null
    const now = this.o.now()
    const already = enrollment.lessons.some((one) => one.lessonId === lessonId && one.state === 'done')

    enrollment = markLessonDone(enrollment, lessonId, now, seconds)
    for (const concept of lesson.concepts) {
      const record = enrollment.mastery[concept] ?? newMastery(concept, now)
      enrollment.mastery[concept] = afterReading(record, now)
    }

    const xp = already ? 0 : lessonXp(lesson)
    if (xp > 0) this.o.awardXp?.(xp, `Lesson: ${lesson.title}`)
    await this.o.store.saveEnrollment(enrollment)
    await this.maybeComplete(course, enrollment)
    this.o.announce?.('courses:lesson', { courseId, lessonId })

    return { xp, progress: courseProgress(course, enrollment, now), next: nextUp(course, enrollment, now) }
  }

  // ---------------------------------------------------------------- questions

  /** The questions for a quiz, a practice run or the final assessment. */
  async questionsFor(courseId: string, scope: string, kind: 'quiz' | 'practice' | 'assessment', options: { count?: number } = {}): Promise<Question[]> {
    const course = await this.o.store.course(courseId)
    if (!course) return []
    const enrollment = await this.o.store.enrollment(courseId)
    const all = lessonsOf(course).flatMap((one) => one.questions)

    if (kind === 'assessment' && course.assessment) {
      const pool = all.filter((one) => course.assessment?.questionIds.includes(one.id))
      return pick(pool.length > 0 ? pool : all, course.assessment.ask, {
        previous: enrollment?.quizzes,
        wrongConcepts: enrollment?.quizzes.filter((one) => one.scope === course.assessment?.id).flatMap((one) => one.weak)
      })
    }

    if (kind === 'quiz') {
      const module = course.modules.find((one) => one.id === scope)
      if (!module) return []
      const pool = module.lessons.flatMap((one) => one.questions)
      const failed = enrollment?.quizzes.filter((one) => one.scope === scope && !one.passed) ?? []
      return pick(pool, Math.min(pool.length, options.count ?? Math.max(5, Math.min(15, Math.round(pool.length * 0.5)))), {
        previous: enrollment?.quizzes,
        wrongConcepts: failed.flatMap((one) => one.weak)
      })
    }

    // Practice: whatever the plan says the learner needs.
    const concepts = scope ? scope.split(',').filter(Boolean) : []
    const pool = concepts.length > 0 ? all.filter((one) => concepts.includes(one.concept)) : all
    return pick(pool.length > 0 ? pool : all, options.count ?? 8, { previous: enrollment?.quizzes })
  }

  /**
   * A single answer, marked and recorded.
   *
   * The one place mastery moves from practice, and the reason the difficulty and where-it-was-asked are carried:
   * a right answer in an assessment is worth more than the same answer with the lesson open beside it.
   */
  async answer(
    courseId: string,
    given: Given,
    where: 'lesson' | 'practice' | 'recall' | 'quiz' | 'assessment' | 'review'
  ): Promise<{ right: boolean; explanation: string; expected: string; mastery: string; adapt: ReturnType<typeof adapt> } | null> {
    const course = await this.o.store.course(courseId)
    const enrollment = await this.o.store.enrollment(courseId)
    if (!course || !enrollment) return null
    const question = lessonsOf(course)
      .flatMap((one) => one.questions)
      .find((one) => one.id === given.questionId)
    if (!question) return null

    const now = this.o.now()
    const result = markAll([question], [given])
    const marked = result.marked[0]

    const record = enrollment.mastery[question.concept] ?? newMastery(question.concept, now)
    const next = afterAnswer(
      record,
      { concept: question.concept, right: marked.right, difficulty: question.difficulty, where, hintsUsed: given.hintsUsed },
      now
    )
    // When it is next worth seeing again, worked out from how well it went.
    enrollment.mastery[question.concept] = { ...next, reviewAt: nextReview(next, now) }
    enrollment.attempts = [
      ...enrollment.attempts,
      { id: this.id('att'), questionId: question.id, concept: question.concept, at: now, right: marked.right, given: marked.given, hintsUsed: given.hintsUsed, seconds: given.seconds }
    ].slice(-2000)
    enrollment.lastAt = now
    await this.o.store.saveEnrollment(enrollment)

    const recent = enrollment.attempts
      .filter((one) => one.concept === question.concept)
      .slice(-3)
      .map((one) => one.right)

    return {
      right: marked.right,
      explanation: marked.explanation,
      expected: marked.expected,
      mastery: describeMastery(enrollment.mastery[question.concept], now),
      adapt: adapt(question.difficulty, { recent, hintsUsed: given.hintsUsed })
    }
  }

  /**
   * A whole quiz, marked against the course's own pass mark.
   *
   * Failing is never the end: what comes back carries the weak concepts and the three things to do about them.
   */
  async submitQuiz(
    courseId: string,
    scope: string,
    given: readonly Given[],
    seconds = 0
  ): Promise<{ result: Result; xp: number; recovery: ReturnType<typeof afterFailing> | null; progress: number } | null> {
    const course = await this.o.store.course(courseId)
    let enrollment = await this.o.store.enrollment(courseId)
    if (!course || !enrollment) return null
    const now = this.o.now()

    const isAssessment = course.assessment?.id === scope
    const pass = isAssessment ? course.assessment?.passScore ?? course.completion.quizPass : course.completion.quizPass ?? PASS
    const questions = lessonsOf(course).flatMap((one) => one.questions)
    const asked = questions.filter((one) => given.some((two) => two.questionId === one.id))
    const result = markAll(asked, given, pass)

    const wasPassed = enrollment.quizzes.some((one) => one.scope === scope && one.passed)
    enrollment.quizzes = [...enrollment.quizzes, toAttempt(this.id('quiz'), scope, result, now, seconds)].slice(-400)
    enrollment.attempts = [...enrollment.attempts, ...toAttempts(result, given, now, (n) => this.id(`a${n}`))].slice(-2000)

    for (const one of result.marked) {
      const record = enrollment.mastery[one.concept] ?? newMastery(one.concept, now)
      const question = asked.find((two) => two.id === one.questionId)
      const moved = afterAnswer(
        record,
        {
          concept: one.concept,
          right: one.right,
          difficulty: question?.difficulty ?? 'intermediate',
          where: isAssessment ? 'assessment' : 'quiz',
          hintsUsed: given.find((two) => two.questionId === one.questionId)?.hintsUsed ?? 0
        },
        now
      )
      enrollment.mastery[one.concept] = { ...moved, reviewAt: nextReview(moved, now) }
    }

    enrollment.lastAt = now
    await this.o.store.saveEnrollment(enrollment)

    // XP only the first time it is passed, so retrying a passed quiz is not a way of farming it.
    const xp = result.passed && !wasPassed ? (isAssessment ? XP.assessment : XP.quizPassed) : 0
    if (xp > 0) this.o.awardXp?.(xp, isAssessment ? 'Final assessment' : 'Quiz passed')

    await this.maybeComplete(course, enrollment)
    enrollment = (await this.o.store.enrollment(courseId)) ?? enrollment
    this.o.announce?.('courses:quiz', { courseId, scope, passed: result.passed })

    return {
      result,
      xp,
      recovery: result.passed ? null : afterFailing(result, (id) => course.concepts.find((one) => one.id === id)?.name ?? id),
      progress: courseProgress(course, enrollment, now)
    }
  }

  // ---------------------------------------------------------------- finishing

  /** Issues the certificate and marks the course finished, the moment the rules are all met. */
  private async maybeComplete(course: Course, enrollment: Enrollment): Promise<void> {
    if (enrollment.completedAt) return
    const now = this.o.now()
    if (!canComplete(course, enrollment, now).can) return

    enrollment.completedAt = now
    if (course.certificate) {
      const made = issue(course, enrollment, await this.o.learnerName(), now)
      if (made) {
        await this.o.store.saveCertificate(made)
        enrollment.certificateId = made.id
      }
    }
    await this.o.store.saveEnrollment(enrollment)
    this.o.awardXp?.(XP.course, `Course finished: ${course.title}`)
    this.o.announce?.('courses:completed', { courseId: course.id, certificateId: enrollment.certificateId })
  }

  async certificates(): Promise<Certificate[]> {
    return this.o.store.certificates()
  }

  // ---------------------------------------------------------------- practice, revision, help

  async practice(courseId: string, options: { kind?: PracticeKind; concept?: string; minutes?: number } = {}): Promise<{ plan: ReturnType<typeof planPractice>; questions: Question[] } | null> {
    const course = await this.o.store.course(courseId)
    const enrollment = await this.o.store.enrollment(courseId)
    if (!course || !enrollment) return null
    const graph = await this.graphOf(course)
    const plan = planPractice(enrollment, graph, this.o.now(), options)
    const questions = await this.questionsFor(courseId, plan.concepts.join(','), 'practice', { count: plan.count })
    return { plan, questions }
  }

  async due(courseId: string): Promise<ReturnType<typeof dueForReview>> {
    const course = await this.o.store.course(courseId)
    const enrollment = await this.o.store.enrollment(courseId)
    if (!course || !enrollment) return []
    return dueForReview(enrollment, await this.graphOf(course), this.o.now())
  }

  /** The earlier concept actually in the way, when there is one. The thing that makes stuck learners unstuck. */
  async whyStuck(courseId: string, concept: string): Promise<{ concept: string; name: string; says: string; lessonId: string | null } | null> {
    const course = await this.o.store.course(courseId)
    const enrollment = await this.o.store.enrollment(courseId)
    if (!course || !enrollment) return null
    const graph = await this.graphOf(course)
    const found = blockedBy(graph, concept, enrollment.mastery, this.o.now())
    if (!found) return null
    return { concept: found.concept.id, name: found.concept.name, says: found.says, lessonId: lessonFor(graph, found.concept.id) }
  }

  // ---------------------------------------------------------------- Orion

  /** What Orion is told for one question about the lesson in front of somebody. */
  async orionContext(
    courseId: string,
    lessonId: string,
    mode: Teach,
    options: { block?: number; questionId?: string; given?: string; asked?: string } = {}
  ): Promise<ReturnType<typeof packageFor> | null> {
    const course = await this.o.store.course(courseId)
    const enrollment = await this.o.store.enrollment(courseId)
    if (!course || !enrollment) return null
    const lesson = lessonById(course, lessonId)
    if (!lesson) return null
    const question = options.questionId ? lesson.questions.find((one) => one.id === options.questionId) ?? null : null
    const where: Where = { course, lesson, enrollment, atBlock: options.block, question, given: options.given ?? null }
    return packageFor(mode, where, this.o.now(), options.asked)
  }

  /** What "this" means, so a question with a pronoun in it can be answered. */
  async whatIsThis(courseId: string, lessonId: string, questionId?: string): Promise<ReturnType<typeof resolveThis>> {
    const course = await this.o.store.course(courseId)
    const enrollment = await this.o.store.enrollment(courseId)
    if (!course || !enrollment) return null
    const lesson = lessonById(course, lessonId)
    if (!lesson) return null
    const question = questionId ? lesson.questions.find((one) => one.id === questionId) ?? null : null
    return resolveThis({ course, lesson, enrollment, question })
  }

  // ---------------------------------------------------------------- the rest of Orbis

  /** Everything other parts of Orbis need, without any of them reaching into this. */
  async signals(): Promise<LearningSignals> {
    const enrollments = await this.o.store.enrollments()
    const courses: Course[] = []
    for (const one of enrollments.slice(0, 8)) {
      const found = await this.o.store.course(one.courseId)
      if (found) courses.push(found)
    }
    return signalsFrom(courses, enrollments, this.o.now())
  }

  /** Courses, lessons and concepts matching a search. Fed into the universal search rather than its own box. */
  async search(text: string, most = 8): Promise<{ kind: 'course' | 'lesson' | 'concept'; courseId: string; id: string; title: string; subtitle: string }[]> {
    const query = text.trim().toLowerCase()
    if (query.length < 2) return []
    const catalogue = await this.o.store.catalogue()
    const out: { kind: 'course' | 'lesson' | 'concept'; courseId: string; id: string; title: string; subtitle: string }[] = []

    for (const one of catalogue) {
      if (one.title.toLowerCase().includes(query) || one.tags.some((two) => two.toLowerCase().includes(query))) {
        out.push({ kind: 'course', courseId: one.id, id: one.id, title: one.title, subtitle: `${one.lessonCount} lessons · ${one.category}` })
      }
    }

    // Lessons and concepts only from courses somebody has actually started, so searching does not read everything.
    const enrollments = await this.o.store.enrollments()
    for (const enrollment of enrollments.slice(0, 6)) {
      const course = await this.o.store.course(enrollment.courseId)
      if (!course) continue
      for (const module of course.modules) {
        for (const lesson of module.lessons) {
          if (out.length >= most * 2) break
          if (lesson.title.toLowerCase().includes(query)) {
            out.push({ kind: 'lesson', courseId: course.id, id: lesson.id, title: lesson.title, subtitle: `${course.title} · ${module.title}` })
          }
        }
      }
      for (const concept of course.concepts) {
        if (concept.name.toLowerCase().includes(query)) {
          out.push({ kind: 'concept', courseId: course.id, id: concept.id, title: concept.name, subtitle: course.title })
        }
      }
    }

    return out.slice(0, most)
  }

  // ---------------------------------------------------------------- content

  /**
   * What is on the shelf, with versions and nothing about any learner.
   *
   * Exists so the built-in course loader can ask what is already installed without reaching past the service into
   * the store — the thing it needs to know is a version number, not a course.
   */
  async catalogue(): Promise<Awaited<ReturnType<CoursesDeps['store']['catalogue']>>> {
    return this.o.store.catalogue()
  }

  /**
   * A course installed from a file or a model.
   *
   * Cleaned, then checked, and refused when it cannot be taught — a course with no answers or a prerequisite loop
   * would leave somebody stuck on a question nothing can mark.
   */
  async install(raw: unknown): Promise<{ ok: boolean; course?: Course; says: string; problems?: ReturnType<typeof teachable>['problems'] }> {
    const course = cleanCourse(raw, this.o.now())
    if (!course) return { ok: false, says: 'That does not look like a course.' }
    /*
     * The real laboratories, so a lesson cannot name one Orbis has not got.
     *
     * Read from the catalogue here rather than inside the validator, which stays free of any knowledge of apps.
     * Retired laboratories count: a lesson may point at one that has been superseded, and that still opens.
     */
    const verdict = teachable(course, EVERY_APP_ID)
    if (!verdict.ok) return { ok: false, says: verdict.says, problems: verdict.problems }
    await this.o.store.install(course)
    this.o.announce?.('courses:installed', { courseId: course.id })
    return { ok: true, course, says: `${course.title} is ready — ${course.lessonCount} lessons.`, problems: verdict.problems }
  }

  async uninstall(courseId: string): Promise<boolean> {
    return this.o.store.uninstall(courseId)
  }

  async toggleSaved(courseId: string): Promise<string[]> {
    return this.o.store.toggleSaved(courseId)
  }

  async useProfile(profileId: string): Promise<void> {
    await this.o.store.useProfile(profileId)
  }

  async flush(): Promise<void> {
    await this.o.store.flush()
  }

  /** Mastery across a course, for the detail page and for Student. */
  async mastery(courseId: string): Promise<{ score: number; weak: { concept: string; name: string; says: string }[] } | null> {
    const course = await this.o.store.course(courseId)
    const enrollment = await this.o.store.enrollment(courseId)
    if (!course || !enrollment) return null
    const now = this.o.now()
    const records = Object.values(enrollment.mastery)
    return {
      score: overall(records, now),
      weak: records
        .filter((one) => one.seen > 0)
        .sort((a, b) => faded(a, now) - faded(b, now))
        .slice(0, 6)
        .map((one) => ({
          concept: one.concept,
          name: course.concepts.find((two) => two.id === one.concept)?.name ?? one.concept,
          says: describeMastery(one, now)
        }))
    }
  }
}
