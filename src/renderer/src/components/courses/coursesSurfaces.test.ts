import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Course, Lesson } from '../../../../shared/courses/types.ts'
import { courseSurface, lessonSurface } from './coursesSurfaces.ts'

/*
 * A course screen has to be describable before the course has arrived.
 *
 * The course and lesson screens hand over a `course()` / `lesson()` that throws while the content is still being
 * read -- on purpose, so a question asked in that moment is refused rather than answered with an empty course. The
 * declarations are built on the screen's first draw, which is exactly that moment: when they read the throwing
 * function to list a control's allowed values, the throw escaped the screen's own render and React took the whole of
 * Courses down with it. Pressing any course card left a blank page.
 *
 * So these tests build both declarations with a screen that throws, which is the first draw, and then with real
 * content, which is every draw after it. Nothing here goes near a browser.
 */

const NOT_YET = (): never => {
  throw new Error('This course has not finished loading.')
}

const COURSE: Course = {
  id: 'orbis.test.01',
  title: 'A test course',
  subtitle: undefined,
  shortDescription: 'For the test.',
  description: 'For the test.',
  category: 'General',
  difficulty: 'beginner',
  lessonCount: 1,
  moduleCount: 1,
  estimatedMinutes: 10,
  language: 'en',
  tags: [],
  origin: 'orbis',
  version: 1,
  updatedAt: 0,
  modules: [
    {
      id: 'm1',
      title: 'The only module',
      lessons: [{ id: 'l1', title: 'The only lesson', blocks: [], questions: [], concepts: [], estimatedMinutes: 10 } as unknown as Lesson]
    }
  ]
} as unknown as Course

const LESSON = COURSE.modules[0].lessons[0]

function courseScreen(course: () => Course): Parameters<typeof courseSurface>[0] {
  return {
    course,
    progress: () => 0,
    enrolled: () => false,
    modules: () => [],
    next: () => null,
    certificate: () => null,
    openModule: () => null,
    expand: () => undefined,
    start: async () => undefined,
    lesson: () => undefined,
    back: () => undefined,
    check: async () => null
  }
}

function lessonScreen(lesson: () => Lesson): Parameters<typeof lessonSurface>[0] {
  return {
    lesson,
    courseTitle: () => 'A test course',
    readAt: () => 0,
    readTo: async () => undefined,
    offered: () => [],
    ask: async () => undefined,
    finished: () => false,
    finish: async () => undefined,
    quizzing: () => false,
    hasModuleQuiz: () => false,
    startQuiz: () => undefined,
    back: () => undefined,
    check: async () => null
  }
}

test('the course screen can be described while the course is still being read', () => {
  const made = courseSurface(courseScreen(NOT_YET as () => Course))
  assert.equal(made.id, 'course')
  // No list of allowed modules yet, because there is no course to list -- and no throw either.
  assert.equal('enum' in (made.controls?.module.spec ?? {}), false)
})

test('the course screen lists its real modules and lessons once the course has arrived', () => {
  const made = courseSurface(courseScreen(() => COURSE))
  const spec = made.controls?.module.spec as { enum?: string[] }
  assert.deepEqual(spec.enum, ['', 'm1'])
  // Read out of the map the declaration really hands over, rather than asserted into a shape: a cast that promises
  // the key is there is a promise the type checker is right to refuse, and the thing worth checking is that it is.
  const lesson = made.actions?.openLesson.params?.lesson
  assert.deepEqual(lesson?.enum, ['l1', 'The only lesson'])
})

test('the lesson screen can be described while the lesson is still being read', () => {
  const made = lessonSurface(lessonScreen(NOT_YET as () => Lesson))
  const spec = made.controls?.readAt.spec as { max?: number }
  // Nothing has been read because nothing has arrived, so there is no upper block to name.
  assert.equal(spec.max, undefined)
})

test('a lesson with blocks gets a reading range', () => {
  const withBlocks = { ...LESSON, blocks: [{ kind: 'text', text: 'one' }, { kind: 'text', text: 'two' }] } as unknown as Lesson
  const made = lessonSurface(lessonScreen(() => withBlocks))
  const spec = made.controls?.readAt.spec as { max?: number }
  assert.equal(spec.max, 1)
})
