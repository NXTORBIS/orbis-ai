import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { dataDirFor, DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'
import { Collection, JsonFile } from '../personal/store.ts'
import { openStored } from '../storedFile.ts'
import { cleanCourse } from '../../shared/courses/validate.ts'
import type { Certificate, Course, Enrollment, LessonProgress, MasteryRecord, QuestionAttempt, QuizAttempt } from '../../shared/courses/types.ts'

/**
 * What Orbis keeps about courses.
 *
 * ## Two different things, kept apart on purpose
 *
 * **Courses** are content: the same for everybody, read-only once installed, and stored once rather than per
 * profile. **Enrollments** are a person's: their progress, their answers, their mastery, their certificates — and
 * those live with the profile and never cross between them.
 *
 * Mixing the two would mean a hundred lessons copied into every profile, and a course update having to be applied
 * to each of them separately.
 *
 * ## A course is validated on the way in and again on the way out
 *
 * `cleanCourse` runs when it is installed, and again when it is read back. A file on disk can be edited by
 * anything; trusting it because it was clean when it was written is trusting the disk.
 *
 * ## A big course is not read until it is opened
 *
 * The dashboard needs titles and counts, not lessons. Summaries live in their own small file so the shelf loads
 * instantly however large the courses are, and a course's content is read only when somebody opens it.
 *
 * ## A course file that could not be read is not a course that is not there
 *
 * `course()` used to answer null to four different questions -- there is no file, something else has the file open,
 * the file is half-written, the file is not a course -- and null means "not installed" to everybody who asks. So a
 * truncated course file read as an uninstalled course while the shelf went on listing it, and installing the same id
 * again renamed a fresh file over the only copy of a course somebody had imported or Orion had written for them.
 *
 * `storedFile.ts` already says what to do, and `openCourse` below does it: a file that is there and was not
 * understood is moved aside before anything is written, so the words survive; a file that is merely unreadable is
 * left exactly as it is and `install` refuses rather than writing over something nobody has read.
 *
 * What is not done yet: `course()` still answers null for a damaged file, and no screen asks `problem(id)` why, so
 * the shelf still shows such a course as one that is simply not installed. The words exist and reach somebody only
 * through a refused install. Saying so here rather than letting this comment claim a page that does not exist.
 */

export const MAX_COURSES = 500
export const MAX_ENROLLMENTS = 500
export const MAX_CERTIFICATES = 500
/** How many whole courses to keep in memory. Enough for the few anybody has open. */
const CACHE = 4

const coursesDir = (userData: string): string => join(userData, 'courses')
/**
 * The part of a course id that reaches the disk.
 *
 * A valid course id may hold a colon (`validate.ts` allows it) and a file name may not, so two ids can clean down to
 * one file -- `my:course` and `mycourse` are the same file. Anything noted about a file has to be noted under this,
 * not under the id somebody typed: keyed by the raw id, what was learnt about a file was invisible to the other id
 * that shares it, so the store said nothing was wrong with a file it had just failed to read.
 */
const fileKey = (id: string): string => id.replace(/[^a-zA-Z0-9_.-]/g, '')
const courseFile = (userData: string, id: string): string => join(coursesDir(userData), `${fileKey(id)}.json`)
const learnerFile = (userData: string, profileId: string, name: string): string => join(userData, dataDirFor(profileId), 'courses', name)

const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const text = (value: unknown, most = 200): string => (typeof value === 'string' ? value.slice(0, most) : '')
const flag = (value: unknown, fallback = false): boolean => (typeof value === 'boolean' ? value : fallback)

/** A course summary, as the shelf needs it. Derived from the course, never typed in. */
export interface StoredSummary {
  id: string
  title: string
  subtitle?: string
  shortDescription: string
  category: string
  subcategory?: string
  difficulty: Course['difficulty']
  lessonCount: number
  moduleCount: number
  estimatedMinutes: number
  language: string
  tags: string[]
  origin: Course['origin']
  version: number
  icon?: string
  cover?: { from: string; to: string }
  updatedAt: number
}

export function summaryOf(course: Course): StoredSummary {
  return {
    id: course.id,
    title: course.title,
    subtitle: course.subtitle,
    shortDescription: course.shortDescription,
    category: course.category,
    subcategory: course.subcategory,
    difficulty: course.difficulty,
    lessonCount: course.lessonCount,
    moduleCount: course.moduleCount,
    estimatedMinutes: course.estimatedMinutes,
    language: course.language,
    tags: course.tags,
    origin: course.origin,
    version: course.version,
    icon: course.icon,
    cover: course.cover,
    updatedAt: course.updatedAt
  }
}

function normalizeSummary(raw: unknown): StoredSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const one = raw as Record<string, unknown>
  const id = text(one.id, 80)
  const title = text(one.title, 200)
  if (!id || !title) return null
  return {
    id,
    title,
    subtitle: text(one.subtitle, 200) || undefined,
    shortDescription: text(one.shortDescription, 600),
    category: text(one.category, 80) || 'General',
    subcategory: text(one.subcategory, 80) || undefined,
    difficulty: (['beginner', 'intermediate', 'advanced', 'expert'] as const).find((two) => two === one.difficulty) ?? 'beginner',
    lessonCount: Math.max(0, Math.round(num(one.lessonCount))),
    moduleCount: Math.max(0, Math.round(num(one.moduleCount))),
    estimatedMinutes: Math.max(0, Math.round(num(one.estimatedMinutes))),
    language: text(one.language, 20) || 'en',
    tags: Array.isArray(one.tags) ? one.tags.filter((two): two is string => typeof two === 'string').slice(0, 20) : [],
    origin: (['orbis', 'imported', 'generated', 'personal'] as const).find((two) => two === one.origin) ?? 'imported',
    version: Math.max(1, Math.round(num(one.version, 1))),
    icon: text(one.icon, 40) || undefined,
    cover:
      one.cover && typeof one.cover === 'object'
        ? { from: text((one.cover as Record<string, unknown>).from, 40), to: text((one.cover as Record<string, unknown>).to, 40) }
        : undefined,
    updatedAt: num(one.updatedAt)
  }
}

function normalizeLessonProgress(raw: unknown): LessonProgress | null {
  if (!raw || typeof raw !== 'object') return null
  const one = raw as Record<string, unknown>
  const lessonId = text(one.lessonId, 80)
  if (!lessonId) return null
  return {
    lessonId,
    state: (['not-started', 'reading', 'done'] as const).find((two) => two === one.state) ?? 'not-started',
    atBlock: Math.max(0, Math.round(num(one.atBlock))),
    seconds: Math.max(0, Math.round(num(one.seconds))),
    startedAt: typeof one.startedAt === 'number' ? one.startedAt : null,
    doneAt: typeof one.doneAt === 'number' ? one.doneAt : null,
    visits: Math.max(0, Math.round(num(one.visits)))
  }
}

function normalizeMastery(raw: unknown): Record<string, MasteryRecord> {
  const out: Record<string, MasteryRecord> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const one = value as Record<string, unknown>
    const concept = text(one.concept, 80) || text(key, 80)
    if (!concept) continue
    out[concept] = {
      concept,
      state: (['introduced', 'practised', 'recalled', 'applied', 'assessed', 'mastered'] as const).find((two) => two === one.state) ?? 'introduced',
      score: Math.max(0, Math.min(1, num(one.score))),
      seen: Math.max(0, Math.round(num(one.seen))),
      right: Math.max(0, Math.round(num(one.right))),
      wrong: Math.max(0, Math.round(num(one.wrong))),
      hints: Math.max(0, Math.round(num(one.hints))),
      lastAt: num(one.lastAt),
      reviewAt: typeof one.reviewAt === 'number' ? one.reviewAt : null,
      reviews: Math.max(0, Math.round(num(one.reviews)))
    }
  }
  return out
}

export function normalizeEnrollment(raw: unknown): (Enrollment & { id: string }) | null {
  if (!raw || typeof raw !== 'object') return null
  const one = raw as Record<string, unknown>
  const courseId = text(one.courseId, 80)
  if (!courseId) return null
  const quizzes = Array.isArray(one.quizzes)
    ? one.quizzes
        .map((two) => {
          if (!two || typeof two !== 'object') return null
          const three = two as Record<string, unknown>
          const id = text(three.id, 80)
          const scope = text(three.scope, 80)
          if (!id || !scope) return null
          return {
            id,
            scope,
            at: num(three.at),
            score: Math.max(0, Math.min(1, num(three.score))),
            passed: flag(three.passed),
            asked: Math.max(0, Math.round(num(three.asked))),
            right: Math.max(0, Math.round(num(three.right))),
            weak: Array.isArray(three.weak) ? three.weak.filter((four): four is string => typeof four === 'string').slice(0, 40) : [],
            seconds: Math.max(0, Math.round(num(three.seconds)))
          } as QuizAttempt
        })
        .filter((two): two is QuizAttempt => two !== null)
        .slice(-400)
    : []
  const attempts = Array.isArray(one.attempts)
    ? one.attempts
        .map((two) => {
          if (!two || typeof two !== 'object') return null
          const three = two as Record<string, unknown>
          const id = text(three.id, 80)
          const questionId = text(three.questionId, 80)
          if (!id || !questionId) return null
          return {
            id,
            questionId,
            concept: text(three.concept, 80),
            at: num(three.at),
            right: flag(three.right),
            given: text(three.given, 600),
            hintsUsed: Math.max(0, Math.round(num(three.hintsUsed))),
            seconds: Math.max(0, Math.round(num(three.seconds)))
          } as QuestionAttempt
        })
        .filter((two): two is QuestionAttempt => two !== null)
        // Capped: mastery is already distilled from these, so the oldest are no longer load-bearing.
        .slice(-2000)
    : []

  const at = one.at && typeof one.at === 'object' ? (one.at as Record<string, unknown>) : null

  return {
    id: courseId,
    courseId,
    courseVersion: Math.max(1, Math.round(num(one.courseVersion, 1))),
    profileId: text(one.profileId, 60) || DEFAULT_PROFILE_ID,
    startedAt: num(one.startedAt),
    lastAt: num(one.lastAt),
    at: at && text(at.lessonId, 80) ? { moduleId: text(at.moduleId, 80), lessonId: text(at.lessonId, 80), block: Math.max(0, Math.round(num(at.block))) } : null,
    lessons: Array.isArray(one.lessons) ? one.lessons.map(normalizeLessonProgress).filter((two): two is LessonProgress => two !== null) : [],
    quizzes,
    attempts,
    mastery: normalizeMastery(one.mastery),
    projects: Array.isArray(one.projects)
      ? one.projects
          .map((two) => {
            if (!two || typeof two !== 'object') return null
            const three = two as Record<string, unknown>
            const projectId = text(three.projectId, 80)
            if (!projectId) return null
            return { projectId, doneAt: typeof three.doneAt === 'number' ? three.doneAt : null, notes: text(three.notes, 4000) }
          })
          .filter((two): two is { projectId: string; doneAt: number | null; notes: string } => two !== null)
      : [],
    completedAt: typeof one.completedAt === 'number' ? one.completedAt : null,
    certificateId: text(one.certificateId, 80) || null,
    seconds: Math.max(0, Math.round(num(one.seconds))),
    archived: flag(one.archived)
  }
}

export function normalizeCertificate(raw: unknown): Certificate | null {
  if (!raw || typeof raw !== 'object') return null
  const one = raw as Record<string, unknown>
  const id = text(one.id, 80)
  const courseId = text(one.courseId, 80)
  if (!id || !courseId) return null
  return {
    id,
    courseId,
    courseTitle: text(one.courseTitle, 200),
    courseVersion: Math.max(1, Math.round(num(one.courseVersion, 1))),
    profileId: text(one.profileId, 60) || DEFAULT_PROFILE_ID,
    learnerName: text(one.learnerName, 120) || 'Learner',
    issuedAt: num(one.issuedAt),
    lessonsDone: Math.max(0, Math.round(num(one.lessonsDone))),
    lessonsTotal: Math.max(0, Math.round(num(one.lessonsTotal))),
    averageQuiz: Math.max(0, Math.min(1, num(one.averageQuiz))),
    assessmentScore: typeof one.assessmentScore === 'number' ? Math.max(0, Math.min(1, one.assessmentScore)) : null,
    issuer: text(one.issuer, 80) || 'Orbis'
  }
}

export class CoursesStore {
  /** The shelf: one small row per course, so the dashboard never reads a course. */
  private readonly summaries: Collection<StoredSummary>
  private readonly enrolled: Collection<Enrollment & { id: string }>
  private readonly certs: Collection<Certificate>
  private readonly bookmarks: JsonFile<string[]>
  private readonly userData: string
  private profileId = DEFAULT_PROFILE_ID
  /** Whole courses, held briefly. Content is the same for every profile, so this survives a switch. */
  private readonly loaded = new Map<string, Course>()
  /**
   * Course files that were there and were not understood, by `fileKey` rather than by course id: what to say about
   * it, and whether that path may be written over. Only a file Orbis could not read at all is a path to keep off;
   * one that was moved aside is safe to write, because the original is still on the disk under another name.
   */
  private readonly damaged = new Map<string, { says: string; mayWrite: boolean }>()

  constructor(userData: string) {
    this.userData = userData
    this.summaries = new Collection<StoredSummary>(join(coursesDir(userData), 'catalogue.json'), normalizeSummary, MAX_COURSES)
    this.enrolled = new Collection(learnerFile(userData, DEFAULT_PROFILE_ID, 'enrollments.json'), normalizeEnrollment, MAX_ENROLLMENTS)
    this.certs = new Collection(learnerFile(userData, DEFAULT_PROFILE_ID, 'certificates.json'), normalizeCertificate, MAX_CERTIFICATES)
    this.bookmarks = new JsonFile<string[]>(
      learnerFile(userData, DEFAULT_PROFILE_ID, 'saved.json'),
      () => [],
      (raw) => (Array.isArray(raw) ? raw.filter((one): one is string => typeof one === 'string').slice(0, 200) : [])
    )
  }

  /**
   * Another profile is another learner.
   *
   * The catalogue deliberately does not move: a course is content and the same for everybody. Everything that is
   * somebody's — progress, answers, certificates, what they saved — swaps.
   */
  async useProfile(profileId: string): Promise<void> {
    if (profileId === this.profileId) return
    this.profileId = profileId
    await Promise.all([
      this.enrolled.usePath(learnerFile(this.userData, profileId, 'enrollments.json')),
      this.certs.usePath(learnerFile(this.userData, profileId, 'certificates.json')),
      this.bookmarks.usePath(learnerFile(this.userData, profileId, 'saved.json'))
    ])
  }

  get profile(): string {
    return this.profileId
  }

  // ---------------------------------------------------------------- the catalogue

  catalogue(): Promise<StoredSummary[]> {
    return this.summaries.all()
  }

  /**
   * One course's file, read and decided about.
   *
   * Validated again on the way out: a file on disk can be changed by anything, and trusting it because it was
   * clean when written is trusting the disk.
   *
   * The deciding is `openStored`'s, which is the point: no file means no course and the path may be written; a file
   * that will not parse or is not a course is moved aside first and then may be written; a file that could not be
   * read at all means no course and a path to leave completely alone.
   */
  private async openCourse(id: string): Promise<{ course: Course | null; mayWrite: boolean }> {
    const path = courseFile(this.userData, id)
    const opened = await openStored<Course | null>(
      path,
      (raw) => {
        const course = cleanCourse(JSON.parse(raw), Date.now())
        // Thrown rather than returned, so `openStored` counts it as damage. Valid JSON that is not a course is as
        // unusable as a half-written file and as much worth keeping a copy of -- and if this returned null instead,
        // it would be indistinguishable from there being no file, which is the fault this whole path exists to fix.
        if (!course) throw new Error('that file is not a course')
        return course
      },
      () => null
    )
    if (opened.wasDamaged) {
      // Said in full here rather than through `damageNote`, because nothing fresh is started for a course: the row
      // stays on the shelf and the course simply cannot be opened until it is installed again.
      const says = opened.movedTo
        ? `Orbis could not make sense of the file for "${id}", so it was moved to ${opened.movedTo}. Nothing was deleted, and the course cannot be opened until it is installed again.`
        : `Orbis could not read the file for "${id}". It has been left exactly as it is and nothing has been written over it. This is usually another program holding the file; try again in a moment.`
      this.damaged.set(fileKey(id), { says, mayWrite: opened.mayWrite })
    } else {
      this.damaged.delete(fileKey(id))
    }
    return { course: opened.value, mayWrite: opened.mayWrite }
  }

  /**
   * A whole course, read from its own file.
   *
   * Null is "Orbis has no course by that id to give you", and never on its own a reason to write: whoever reads
   * null and wants to put a course there goes through `install`, which reads the file itself and refuses.
   */
  async course(id: string): Promise<Course | null> {
    const held = this.loaded.get(id)
    if (held) return held
    const { course } = await this.openCourse(id)
    if (!course) return null
    // Oldest out first, so a few open courses never grow into the whole catalogue in memory.
    if (this.loaded.size >= CACHE) this.loaded.delete(this.loaded.keys().next().value as string)
    this.loaded.set(id, course)
    return course
  }

  /**
   * What went wrong reading a course's file, in plain words. Null when nothing did.
   *
   * These are the words `install` refuses in, which is how they reach somebody: the start-up log when a shipped
   * course cannot be written, the install result when an imported or generated one cannot. No screen asks this on
   * its own yet, so a course whose file is damaged still reads as "not installed" wherever it is listed.
   */
  problem(id: string): string | null {
    return this.damaged.get(fileKey(id))?.says ?? null
  }

  /** A course written to disk and listed on the shelf. The only way content gets in. */
  async install(course: Course): Promise<Course> {
    // The disk is read every time, and never the note from last time. `install` is usually the first thing to touch
    // an id at all -- the shipped courses on start-up, an import, a course Orion has just written -- so a guard that
    // only consulted this session's notes found them empty and let the rename through: a fresh file went over the
    // only copy of a course with no read, no quarantine and no refusal. Reading again is also what lets a refusal
    // clear, because something unreadable is often only unreadable for a moment.
    const opened = await this.openCourse(course.id)
    if (!opened.mayWrite) throw new Error(this.problem(course.id) ?? `Orbis could not read the file for "${course.id}".`)
    await fs.mkdir(coursesDir(this.userData), { recursive: true })
    const path = courseFile(this.userData, course.id)
    const temporary = `${path}.tmp`
    await fs.writeFile(temporary, JSON.stringify(course), { mode: 0o600 })
    await fs.rename(temporary, path)
    // The file is now one Orbis wrote and has in hand, so nothing is wrong with it any more. Left in place, the note
    // from the file that was moved aside would have `problem` reporting damage about a course that opens perfectly
    // for the rest of the session -- and `loaded` below makes the next `course()` a cache hit, so nothing else
    // would ever re-read the file and clear it.
    this.damaged.delete(fileKey(course.id))
    await this.summaries.put(summaryOf(course))
    this.loaded.set(course.id, course)
    return course
  }

  async uninstall(id: string): Promise<boolean> {
    this.loaded.delete(id)
    // Somebody asked for this one to go, so the file may go. What was noted about it must go with it: a path to keep
    // off outliving the file it was about would refuse an install of the same id for the rest of the session.
    this.damaged.delete(fileKey(id))
    await fs.rm(courseFile(this.userData, id), { force: true }).catch(() => undefined)
    return this.summaries.remove(id)
  }

  // ---------------------------------------------------------------- the learner

  async enrollments(): Promise<Enrollment[]> {
    const all = await this.enrolled.all()
    return all.filter((one) => one.profileId === this.profileId)
  }

  async enrollment(courseId: string): Promise<Enrollment | null> {
    const all = await this.enrolled.all()
    return all.find((one) => one.courseId === courseId && one.profileId === this.profileId) ?? null
  }

  async saveEnrollment(one: Enrollment): Promise<Enrollment> {
    await this.enrolled.put({ ...one, id: one.courseId, profileId: this.profileId })
    return one
  }

  async removeEnrollment(courseId: string): Promise<boolean> {
    return this.enrolled.remove(courseId)
  }

  async certificates(): Promise<Certificate[]> {
    const all = await this.certs.all()
    return all.filter((one) => one.profileId === this.profileId).sort((a, b) => b.issuedAt - a.issuedAt)
  }

  async saveCertificate(one: Certificate): Promise<Certificate> {
    await this.certs.put(one)
    return one
  }

  async saved(): Promise<string[]> {
    return this.bookmarks.read()
  }

  async toggleSaved(courseId: string): Promise<string[]> {
    const held = await this.bookmarks.read()
    const next = held.includes(courseId) ? held.filter((one) => one !== courseId) : [...held, courseId].slice(-200)
    await this.bookmarks.write(next)
    return next
  }

  async flush(): Promise<void> {
    await Promise.all([this.summaries.flush(), this.enrolled.flush(), this.certs.flush(), this.bookmarks.flush()])
  }
}
