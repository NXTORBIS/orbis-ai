import { ipcMain } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { Courses } from './service.ts'
import type { Given } from '../../shared/courses/quiz.ts'
import type { Teach } from '../../shared/courses/orion.ts'
import type { PracticeKind } from '../../shared/courses/learn.ts'

/**
 * What the window may ask Orbis Courses.
 *
 * One channel, `courses:do`, with an operation name — the same shape Student, Music and Ambient Intelligence use.
 * The handlers check the sender, coerce what arrived, and hand it on; every decision about what counts as
 * learning is in the service, where it can be reasoned about in one place.
 *
 * Nothing here takes a file path, and nothing here runs anything from a course. A course installed through this
 * goes through `cleanCourse` and `teachable` first, so content that cannot be taught never reaches the disk.
 */

export interface CoursesIpcOptions {
  courses: Courses
  getWindow(): BrowserWindow | null
}

const id = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 && value.length <= 80 ? value : null)
const text = (value: unknown, limit: number): string => (typeof value === 'string' ? value.slice(0, limit) : '')
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const object = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

const TEACH: readonly Teach[] = [
  'explain', 'simplify', 'deeper', 'example', 'hint', 'teach', 'quiz', 'challenge', 'check', 'socratic', 'connect', 'recall', 'apply'
]
const WHERE = ['lesson', 'practice', 'recall', 'quiz', 'assessment', 'review'] as const

/** One answer, coerced. An answer of the wrong shape is marked wrong rather than throwing. */
function toGiven(raw: unknown): Given | null {
  const one = object(raw)
  const questionId = id(one.questionId)
  if (!questionId) return null
  let value: Given['value'] = null
  if (Array.isArray(one.value)) value = one.value.filter((two): two is number => typeof two === 'number').slice(0, 40)
  else if (typeof one.value === 'number' || typeof one.value === 'boolean') value = one.value
  else if (typeof one.value === 'string') value = one.value.slice(0, 4000)
  return {
    questionId,
    value,
    hintsUsed: Math.max(0, Math.min(10, Math.round(num(one.hintsUsed)))),
    seconds: Math.max(0, Math.min(86_400, Math.round(num(one.seconds))))
  }
}

export function registerCoursesIpc(options: CoursesIpcOptions): void {
  const { courses, getWindow } = options

  const mine = (event: IpcMainInvokeEvent): boolean => {
    const window = getWindow()
    return Boolean(window && !window.isDestroyed() && event.sender === window.webContents)
  }

  const run = async (op: unknown, a?: unknown, b?: unknown, c?: unknown): Promise<unknown> => {
    switch (op) {
      // ---------------------------------------------------------------- the shelf
      case 'shelf':
        return courses.shelf()
      case 'detail':
        return id(a) ? courses.detail(id(a)!) : null
      case 'course':
        return id(a) ? courses.course(id(a)!) : null
      case 'search':
        return typeof a === 'string' ? courses.search(a.slice(0, 200), Math.max(1, Math.min(20, Math.round(num(b, 8))))) : []
      case 'saved':
        return id(a) ? courses.toggleSaved(id(a)!) : []

      // ---------------------------------------------------------------- learning
      case 'enroll':
        return id(a) ? courses.enroll(id(a)!) : null
      case 'lesson':
        return id(a) && id(b) ? courses.lesson(id(a)!, id(b)!) : null
      case 'reading-at':
        if (id(a) && id(b)) await courses.readingAt(id(a)!, id(b)!, Math.max(0, Math.round(num(c))))
        return { ok: true }
      case 'finish-lesson':
        return id(a) && id(b) ? courses.finishLesson(id(a)!, id(b)!, Math.max(0, Math.min(86_400, Math.round(num(c))))) : null

      // ---------------------------------------------------------------- questions
      case 'questions': {
        const kind = b === 'quiz' || b === 'assessment' ? b : 'practice'
        return id(a) ? courses.questionsFor(id(a)!, text(c, 400), kind) : []
      }
      case 'answer': {
        const given = toGiven(b)
        const where = WHERE.find((one) => one === c) ?? 'practice'
        return id(a) && given ? courses.answer(id(a)!, given, where) : null
      }
      case 'submit-quiz': {
        const given = (Array.isArray(b) ? b : []).map(toGiven).filter((one): one is Given => one !== null).slice(0, 200)
        return id(a) && given.length > 0 ? courses.submitQuiz(id(a)!, text(c, 80), given) : null
      }

      // ---------------------------------------------------------------- practice and revision
      case 'practice': {
        const given = object(b)
        const kind = (['concept', 'mixed', 'weak', 'revision', 'challenge'] as const).find((one) => one === given.kind) as PracticeKind | undefined
        return id(a)
          ? courses.practice(id(a)!, {
              kind,
              concept: id(given.concept) ?? undefined,
              minutes: Math.max(1, Math.min(120, Math.round(num(given.minutes, 10))))
            })
          : null
      }
      case 'due':
        return id(a) ? courses.due(id(a)!) : []
      case 'why-stuck':
        return id(a) && id(b) ? courses.whyStuck(id(a)!, id(b)!) : null
      case 'mastery':
        return id(a) ? courses.mastery(id(a)!) : null

      // ---------------------------------------------------------------- Orion
      case 'orion-context': {
        const given = object(c)
        const mode = TEACH.find((one) => one === given.mode) ?? 'explain'
        return id(a) && id(b)
          ? courses.orionContext(id(a)!, id(b)!, mode, {
              block: Math.max(0, Math.round(num(given.block))),
              questionId: id(given.questionId) ?? undefined,
              given: text(given.given, 4000) || undefined,
              asked: text(given.asked, 1000) || undefined
            })
          : null
      }
      case 'what-is-this':
        return id(a) && id(b) ? courses.whatIsThis(id(a)!, id(b)!, id(c) ?? undefined) : null

      // ---------------------------------------------------------------- finishing
      case 'certificates':
        return courses.certificates()

      // ---------------------------------------------------------------- the rest of Orbis
      case 'signals':
        return courses.signals()

      // ---------------------------------------------------------------- content
      case 'install':
        return courses.install(a)
      case 'uninstall':
        return id(a) ? courses.uninstall(id(a)!) : false

      default:
        return { ok: false, why: `Orbis Courses does not know how to "${String(op).slice(0, 40)}".` }
    }
  }

  ipcMain.handle('courses:do', async (event, op: unknown, a?: unknown, b?: unknown, c?: unknown) => {
    if (!mine(event)) throw new Error('Not allowed.')
    return run(op, a, b, c)
  })
}
