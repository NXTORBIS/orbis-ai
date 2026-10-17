import type { Course, CourseCard, Lesson, Question } from '../../../../shared/courses/types.ts'
import { TEACH_LABELS, type Teach } from '../../../../shared/courses/orion.ts'
import type { ControlDeclaration, SurfaceDeclaration } from '../../lib/surfaces/registry.ts'

/**
 * What Courses lets Orbis read, set and do, as data.
 *
 * Four screens: the shelf, one course, one lesson, and the questions. Written as functions of each screen's own state
 * and handlers so the whole chain can be driven without a browser -- see `settingsSurfaces.ts` for why that matters,
 * and `src/main/browserControl/moduleSurfaces.test.ts` for it happening.
 *
 * ## The course and the lesson are side by side, not nested
 *
 * It would read better the other way, and it would be a lie. `CoursesView` *replaces* itself: the shelf draws the
 * course screen instead of the shelf, and the lesson instead of the course. So the course and the lesson are both
 * children of `courses` and only one of them is ever on screen. Writing the lesson as a child of the course would mean
 * a path (`courses/course/lesson`) whose middle is never registered while its end is -- and the register would report
 * every open lesson as a screen whose parent has gone.
 *
 * ## A course is not a path
 *
 * Course ids are written `orbis.ai.02`, and a path segment cannot hold a dot (`pathSegments` splits on them). So the
 * open course is always `courses/course` -- there is only ever one open -- and which course that is, is a parameter of
 * the action that opens it, with the real titles in its list of allowed values. The same goes for a lesson.
 *
 * ## Asking Orion is declared as leaving the computer
 *
 * The teaching buttons under a lesson send the lesson's material to a model. That is more than changing what is on
 * screen, so they declare `communicate` and Orbis asks the person first when it is Orion driving.
 *
 * ## Nothing here marks anything
 *
 * A quiz is answered and submitted through the same `submit-quiz` the button calls, and the marking happens in the
 * main process against the course's own answers. There is no setter here that can say an answer was right.
 */

/** The names and ids of the courses on the shelf, for an action's list of allowed values. */
const namesOf = (cards: readonly CourseCard[]): string[] => [...new Set(cards.flatMap((one) => [one.id, one.title]))]

/** What the shelf has to hand over. */
export interface CoursesScreen {
  search(): string
  setSearch(text: string): void
  /** Every course Orbis has, as the shelf read them. Empty until the shelf has arrived. */
  all(): readonly CourseCard[]
  /** The ones in progress, as the shelf groups them. */
  continuing(): readonly CourseCard[]
  /** True until the shelf has answered, so "no courses" can be told from "not asked yet". */
  loading(): boolean
  /** Opens one course by its id. The same thing pressing its card does. */
  open(courseId: string): void
  close(): void
  /** Asked of Orbis again, for checking. */
  check(): Promise<readonly CourseCard[] | null>
}

/**
 * The course shelf.
 *
 * `open` takes a course by its id or by the title on screen, because the thing asking has read one of those two and
 * should not have to know which. The match is exact or a plain contains, and an ambiguous word is refused with the
 * names rather than resolved to the first hit.
 */
export function coursesSurface(screen: CoursesScreen): SurfaceDeclaration {
  const cards = (): readonly CourseCard[] => {
    if (screen.loading()) throw new Error('The shelf has not finished loading.')
    return screen.all()
  }
  /** Which course somebody means. Never a guess between two: picking one is how the wrong course gets opened. */
  const which = (asked: string): CourseCard => {
    const shelf = cards()
    const want = asked.trim().toLowerCase()
    const exact = shelf.filter((one) => one.id.toLowerCase() === want || one.title.toLowerCase() === want)
    const near = exact.length ? exact : shelf.filter((one) => one.title.toLowerCase().includes(want))
    if (near.length === 0) throw new Error(`There is no course called “${asked}”. There is: ${shelf.map((one) => one.title).join(', ') || 'nothing installed yet'}.`)
    if (near.length > 1) throw new Error(`“${asked}” could be ${near.map((one) => one.title).join(' or ')}. Say which one.`)
    return near[0]
  }

  return {
    id: 'courses',
    parent: null,
    name: 'Courses',
    about: 'Structured learning, with everything you do actually measured.',
    kind: 'module',
    keywords: ['course', 'courses', 'lesson', 'module', 'curriculum', 'learning', 'certificate', 'syllabus', 'training'],
    controls: {
      search: {
        name: 'Find a course',
        about: 'Narrows the shelf to the courses whose title, tag or category match. Two letters or more.',
        spec: { type: 'string', description: 'What to look for. Empty shows the shelf.' },
        get: () => screen.search(),
        set: (value) => screen.setSearch(String(value ?? '').slice(0, 120)),
        default: ''
      }
    },
    actions: {
      open: {
        name: 'Open a course',
        about: 'Opens one course, by its id or by the title on screen.',
        params: {
          course: {
            type: 'string',
            description: 'Which course: its id, or the title as it is written on screen.',
            required: true,
            // The real shelf, so what may be asked for is what Orbis actually has rather than a list somebody wrote.
            ...(screen.loading() || screen.all().length === 0 ? {} : { enum: namesOf(screen.all()) })
          }
        },
        run: (params) => {
          const card = which(String(params.course))
          screen.open(card.id)
          return { courseId: card.id, title: card.title }
        },
        /*
         * Not confirmed, and said so.
         *
         * Opening a course asks the window to draw another screen, and the screen registers itself when it has
         * loaded -- after this. Reporting `done: true` here would be reporting the request as the result, which is
         * the one thing the whole protocol exists to stop.
         */
        verify: (data) => ({ done: false, detail: `${(data as { title: string }).title} was asked to open. It says what is on it once it has loaded, as courses/course.` })
      },
      close: {
        name: 'Close Courses',
        run: () => {
          screen.close()
          return { closed: true }
        }
      }
    },
    /*
     * Two possible children, and neither can be walked to.
     *
     * A reach's parameters are fixed when it is declared, and which course or lesson to open is not -- so declaring
     * either as an action would mean Orbis picking one. The sentences name the actions that really open them, which is
     * what `planNextStep` reports instead of trying something on a guess.
     */
    possibleChildren: [
      {
        id: 'course',
        name: 'Course',
        kind: 'subpage',
        reach: { kind: 'manual', how: 'say which course. Use the “open” action on Courses, whose list of allowed values is the real shelf.' }
      },
      {
        id: 'lesson',
        name: 'Lesson',
        kind: 'subpage',
        reach: { kind: 'manual', how: 'open a course first, then use its “openLesson” action, whose list of allowed values is that course’s own lessons.' }
      }
    ],
    state: () => {
      if (screen.loading()) return { activity: 'running', detail: 'Reading the shelf.' }
      const shelf = screen.all()
      return {
        values: {
          installed: shelf.length,
          inProgress: screen.continuing().length,
          finished: shelf.filter((one) => one.completedAt !== null).length,
          searching: screen.search().trim().length > 1,
          titles: shelf.slice(0, 40).map((one) => one.title)
        }
      }
    }
  }
}

// ---------------------------------------------------------------- one course

/** What the course screen has to hand over. */
export interface CourseScreen {
  /** The course as it was read. Throws until it has arrived. */
  course(): Course
  /** How far through, from 0 to 1, as the main process worked it out. */
  progress(): number
  enrolled(): boolean
  /** What each module has done, as the detail reported it. */
  modules(): readonly { moduleId: string; title: string; lessons: number; done: number; quizPassed: boolean }[]
  /** What is next, in the course's own words. Null when there is nothing. */
  next(): { kind: string; id: string; title: string } | null
  /** Whether the certificate is earned, and what is still missing. Null when the course has no certificate. */
  certificate(): { eligible: boolean; unmet: { says: string }[] } | null
  /** Which module is expanded. */
  openModule(): string | null
  expand(moduleId: string | null): void
  /** Enrols and goes to where they left off. The same thing the big button does. */
  start(): Promise<unknown>
  lesson(lessonId: string): void
  back(): void
  /** Asked of Orbis again, for checking. */
  check(): Promise<{ progress: number; enrolled: boolean } | null>
}

/** One course: the modules, how far through, and the way into a lesson. */
export function courseSurface(screen: CourseScreen): SurfaceDeclaration {
  const course = (): Course => screen.course()
  /*
   * The course if it has arrived, and null if it has not.
   *
   * `course()` deliberately throws while the course is still being read, so a question asked in that moment is
   * answered "not loaded yet" rather than with an empty course. But the two lists of allowed values below are built
   * while this declaration is being made -- which is during the course screen's very first draw, when nothing has
   * arrived yet. Reading `course()` there threw out of the screen's own render and took the whole of Courses with it:
   * pressing a course card left a blank page. So the lists ask this instead and are simply left out until there is a
   * course to list; everything that runs later still goes through `course()` and still refuses honestly.
   */
  const maybe = (): Course | null => {
    try {
      return screen.course()
    } catch {
      return null
    }
  }
  /** Every lesson in the course, flat, with the module it is in. */
  const lessons = (): { id: string; title: string }[] => course().modules.flatMap((one) => one.lessons.map((two) => ({ id: two.id, title: two.title })))
  const which = (asked: string): { id: string; title: string } => {
    const all = lessons()
    const want = asked.trim().toLowerCase()
    const exact = all.filter((one) => one.id.toLowerCase() === want || one.title.toLowerCase() === want)
    const near = exact.length ? exact : all.filter((one) => one.title.toLowerCase().includes(want))
    if (near.length === 0) throw new Error(`${course().title} has no lesson called “${asked}”.`)
    if (near.length > 1) throw new Error(`“${asked}” could be ${near.map((one) => one.title).join(' or ')}. Say which one.`)
    return near[0]
  }

  // Read once for this declaration, so the two lists below agree with each other.
  const here = maybe()

  return {
    id: 'course',
    parent: 'courses',
    /*
     * Called `Course`, not `The open course`, and that matters.
     *
     * A path segment is matched against every word of a surface's name, and surfaces are matched before actions. A
     * screen called "The open course" therefore answered to `open` and swallowed the `open` action on Courses -- the
     * very thing that opens one. A name that contains another thing's name is a real fault here.
     */
    name: 'Course',
    about: 'One course: what it covers, how far through you are, and what is left before a certificate.',
    kind: 'subpage',
    keywords: ['course', 'modules', 'syllabus', 'certificate', 'progress'],
    controls: {
      module: {
        name: 'Module shown',
        about: 'Which module’s lessons are listed. Nothing means they are all folded away.',
        spec: {
          type: 'string',
          description: 'The module whose lessons are listed, or empty for none.',
          ...(here && here.modules.length ? { enum: ['', ...here.modules.map((one) => one.id)] } : {})
        },
        get: () => screen.openModule() ?? '',
        set: (value) => screen.expand(String(value ?? '') || null),
        // A default of nothing, written as null with the key present, because this really does have one.
        default: null
      }
    },
    actions: {
      start: {
        name: 'Start or carry on',
        about: 'Enrols if this is the first time, then opens where you left off.',
        run: () => screen.start(),
        verify: async () => {
          const now = await screen.check()
          if (!now) return { done: false, detail: 'The course could not be asked whether it started.' }
          return now.enrolled
            ? { done: true, detail: `You are on this course, ${Math.round(now.progress * 100)}% through.` }
            : { done: false, detail: 'The course did not record you as being on it.' }
        }
      },
      openLesson: {
        name: 'Open a lesson',
        params: {
          lesson: {
            type: 'string',
            description: 'Which lesson: its id, or the title as it is written on screen.',
            required: true,
            ...(here && here.modules.length ? { enum: [...new Set(lessons().flatMap((one) => [one.id, one.title]))] } : {})
          }
        },
        run: (params) => {
          const found = which(String(params.lesson))
          screen.lesson(found.id)
          return { lessonId: found.id, title: found.title }
        },
        // Unconfirmed for the same reason as opening a course: the lesson registers itself once it has loaded.
        verify: (data) => ({ done: false, detail: `${(data as { title: string }).title} was asked to open. It says what is on it once it has loaded, as courses/lesson.` })
      },
      back: {
        name: 'Back to the shelf',
        run: () => {
          screen.back()
          return { closed: true }
        }
      }
    },
    /*
     * No possible children.
     *
     * `openLesson` really does open a lesson, and the lesson is not inside this screen -- it replaces it. It is named
     * as a possible child of `courses`, where it really appears, with the sentence that says this action is what opens
     * one.
     */
    state: () => {
      const one = course()
      const cert = screen.certificate()
      return {
        values: {
          title: one.title,
          difficulty: one.difficulty,
          lessons: one.lessonCount,
          modules: one.moduleCount,
          onIt: screen.enrolled(),
          lessonsDone: screen.modules().reduce((sum, two) => sum + two.done, 0),
          quizzesPassed: screen.modules().filter((two) => two.quizPassed).length,
          next: screen.next()?.title ?? null,
          certificate: cert === null ? 'this course has none' : cert.eligible ? 'earned' : `${cert.unmet.length} things still to do`
        },
        /*
         * A real measurement: the main process worked it out from the lessons actually finished.
         *
         * Reported only once somebody is on the course, because a fraction of a course nobody has started is not 0
         * progress -- there is no progress to have.
         */
        ...(screen.enrolled() ? { progress: screen.progress() } : {})
      }
    }
  }
}

// ---------------------------------------------------------------- one lesson

/** What the lesson screen has to hand over. */
export interface LessonScreen {
  /** Throws until the lesson has arrived. */
  lesson(): Lesson
  courseTitle(): string
  /** Which block they have read to, as the main process last recorded it. */
  readAt(): number
  /** Records how far they have read, through the same `reading-at` the scroll handler calls. */
  readTo(block: number): Promise<unknown>
  /** The teaching modes this lesson offers, as the main process decided them. */
  offered(): readonly Teach[]
  ask(mode: Teach): Promise<unknown>
  /** True once "I have finished this lesson" has been pressed and answered. */
  finished(): boolean
  finish(): Promise<unknown>
  /** Whether the module quiz is on screen instead of the lesson. */
  quizzing(): boolean
  /** Whether this lesson belongs to a module, so there is a quiz to start at all. */
  hasModuleQuiz(): boolean
  startQuiz(): void
  back(): void
  /** Asked of Orbis again, for checking that a lesson was recorded as done. */
  check(): Promise<{ done: boolean; readAt: number } | null>
}

/** A lesson: where the reader is in it, the teaching Orion offers, and finishing it. */
export function lessonSurface(screen: LessonScreen): SurfaceDeclaration {
  const lesson = (): Lesson => screen.lesson()
  /*
   * How many blocks there are, and 0 while the lesson is still being read.
   *
   * Same reason as the course above: the range of the reading control is worked out while this declaration is being
   * made, on the lesson screen's first draw, when `lesson()` still throws by design. Letting that throw escape took
   * the lesson screen down with it.
   */
  const blocks = (): number => {
    try {
      return lesson().blocks.length
    } catch {
      return 0
    }
  }

  return {
    id: 'lesson',
    // Beside the course rather than inside it: opening a lesson replaces the course screen. See the note at the top.
    parent: 'courses',
    // `Lesson` rather than `The open lesson`, for the reason given on the course above.
    name: 'Lesson',
    about: 'The material, where you have read to, what Orion can do about it, and finishing it.',
    kind: 'subpage',
    keywords: ['lesson', 'material', 'reading', 'blocks', 'finish'],
    controls: {
      readAt: {
        name: 'Read as far as',
        about: 'Which block of the lesson counts as read. Scrolling sets this as you go; this is the same record.',
        spec: { type: 'integer', description: 'The block read to, counting from 0.', min: 0, ...(blocks() > 0 ? { max: blocks() - 1 } : {}) },
        get: () => screen.readAt(),
        set: (value) => void screen.readTo(Number(value)),
        writable: () => (blocks() > 0 ? true : 'This lesson has no blocks, so there is nowhere to have read to.'),
        default: 0
      }
    },
    actions: {
      finish: {
        name: 'I have finished this lesson',
        about: 'Records the lesson as done, pays the XP it is worth, and moves on to whatever is next.',
        unavailable: () => (screen.finished() ? 'This lesson has already been recorded as finished.' : null),
        run: () => screen.finish(),
        verify: async () => {
          const now = await screen.check()
          if (!now) return { done: false, detail: 'The course could not be asked whether the lesson was recorded.' }
          return now.done ? { done: true, detail: 'The lesson is recorded as finished.' } : { done: false, detail: 'The course does not have it as finished.' }
        }
      },
      ask: {
        name: 'Ask Orion about this lesson',
        about:
          'Puts a question about this lesson to Orion, with the course, the module, the lesson and how you have been doing. The lesson’s material goes to the model, which is why this asks first.',
        params: {
          mode: {
            type: 'string',
            description: `What to ask for. ${screen.offered().map((one) => `${one}: ${TEACH_LABELS[one]}`).join(' ')}`,
            required: true,
            ...(screen.offered().length ? { enum: [...screen.offered()] } : {})
          }
        },
        // It leaves the computer: the material is sent to a model. The capability itself can only declare a write, so
        // this declaration is the only thing that makes Orbis ask first.
        effects: ['communicate'],
        unavailable: () => (screen.offered().length ? null : 'This lesson offers nothing to ask Orion.'),
        run: async (params) => {
          const mode = String(params.mode) as Teach
          if (!screen.offered().includes(mode)) throw new Error(`This lesson does not offer “${mode}”. It offers: ${screen.offered().join(', ')}.`)
          await screen.ask(mode)
          return { mode, said: TEACH_LABELS[mode] }
        },
        // The question goes to the chat, and nothing here can see what Orion makes of it. Said in those words rather
        // than reported as confirmed.
        verify: (data) => ({ done: false, detail: `${(data as { said: string }).said} was put to Orion in the chat. Nothing on this screen can see the answer, so it is not confirmed here.` })
      },
      startQuiz: {
        name: 'Take the module quiz',
        unavailable: () => (screen.hasModuleQuiz() ? (screen.quizzing() ? 'The quiz is already on screen.' : null) : 'This lesson is not in a module, so there is no module quiz.'),
        run: () => {
          screen.startQuiz()
          return { quizzing: true }
        },
        // Whether it is on screen is this screen's own state, and asking for it is asking for a redraw -- so a "no"
        // here means "not yet", and says so rather than claiming it did not open.
        verify: () => (screen.quizzing() ? { done: true, detail: 'The quiz is on screen.' } : { done: false, detail: 'the lesson has not redrawn yet. The quiz turns up as courses/lesson/quiz.' })
      },
      back: {
        name: 'Back to the course',
        run: () => {
          screen.back()
          return { closed: true }
        }
      }
    },
    possibleChildren: [{ id: 'quiz', name: 'The module quiz', kind: 'panel', reach: { kind: 'action', action: 'startQuiz' } }],
    state: () => {
      const one = lesson()
      return {
        activity: screen.quizzing() ? 'running' : 'idle',
        detail: `${one.title} — ${screen.courseTitle()}`,
        values: {
          title: one.title,
          minutes: one.minutes,
          difficulty: one.difficulty,
          blocks: one.blocks.length,
          readTo: screen.readAt(),
          objectives: one.objectives.length,
          questionsInIt: one.questions.length,
          orionOffers: [...screen.offered()],
          recordedAsFinished: screen.finished()
        },
        /*
         * How far through the material, which the lesson really measures: the blocks are counted and the recorded
         * position is one of them. A lesson with no blocks has nothing to measure, so nothing is reported.
         */
        ...(one.blocks.length > 1 ? { progress: Math.min(1, screen.readAt() / (one.blocks.length - 1)) } : {})
      }
    }
  }
}

// ---------------------------------------------------------------- the questions

/** What the quiz has to hand over. One control per question, built from the questions themselves. */
export interface QuizScreen {
  title(): string
  /** The questions as they were fetched. Empty while they are still coming. */
  questions(): readonly Question[]
  /** What has been put for one question, or null for nothing yet. */
  answer(questionId: string): number[] | string | number | boolean | null
  /** Puts an answer, through the same handler the radio buttons and boxes call. */
  put(questionId: string, value: number[] | string | number | boolean | null): void
  /** How many hints have been asked for on one question. */
  hintsUsed(questionId: string): number
  hint(questionId: string): void
  /** Whether it is being marked right now. */
  busy(): boolean
  /** The mark, once there is one. */
  result(): QuizResult | null
  /**
   * Sends every answer to be marked, and answers with the mark.
   *
   * The mark comes back rather than only being put on screen, deliberately: checking afterwards has to read the
   * application's own answer. Reading `result()` straight after this would read the screen, which has not redrawn.
   */
  submit(): Promise<QuizResult | null>
  retry(): void
  done(): void
}

/** A marked paper, as the main process worked it out. */
export interface QuizResult {
  score: number
  passed: boolean
  asked: number
  right: number
  says: string
  weak: string[]
}

/**
 * The questions, as controls.
 *
 * One control per question, with the type the question really is: a choice is the number of the option, a multi is the
 * list of them, true-or-false is a switch, a number is a number, and everything else is text. Built from the questions
 * the main process sent, so a question added to a course is answerable in the same change -- and nothing here knows
 * what any answer should be.
 */
export function quizSurface(screen: QuizScreen): SurfaceDeclaration {
  const marked = (): boolean => screen.result() !== null
  const notAfterMarking = (): true | string => (marked() ? 'This has been marked. Use retry to answer it again.' : true)

  const control = (question: Question, at: number): ControlDeclaration => {
    const options = question.options ?? []
    const label = `${at + 1}. ${question.prompt}`
    const common = { name: label, get: () => screen.answer(question.id), writable: notAfterMarking }
    switch (question.kind) {
      case 'choice':
        return {
          ...common,
          about: options.length ? `The number of the option, counting from 0: ${options.map((one, index) => `${index} = ${one}`).join('; ')}` : 'A choice with no options.',
          spec: { type: 'integer', description: 'Which option, counting from 0.', min: 0, ...(options.length ? { max: options.length - 1 } : {}) },
          set: (value) => screen.put(question.id, Number(value))
        }
      case 'multi':
        return {
          ...common,
          about: options.length ? `The numbers of every option that applies: ${options.map((one, index) => `${index} = ${one}`).join('; ')}` : 'A choice with no options.',
          spec: { type: 'array', description: 'The numbers of the options that apply, counting from 0.' },
          set: (value) => screen.put(question.id, (Array.isArray(value) ? value : []).map((one) => Number(one)).filter((one) => Number.isInteger(one) && one >= 0 && one < options.length))
        }
      case 'true-false':
        return { ...common, spec: { type: 'boolean', description: 'True or false.' }, set: (value) => screen.put(question.id, value === true) }
      case 'number':
        return { ...common, spec: { type: 'number', description: 'The answer, as a number.' }, set: (value) => screen.put(question.id, Number(value)) }
      default:
        return {
          ...common,
          spec: { type: 'string', description: question.kind === 'code' ? 'The answer, as code. Shown as text and never run.' : 'The answer, in words.' },
          set: (value) => screen.put(question.id, String(value ?? '').slice(0, 4000))
        }
    }
  }

  const unanswered = (): Question[] => screen.questions().filter((one) => screen.answer(one.id) === null || screen.answer(one.id) === undefined)

  return {
    id: 'quiz',
    // Really inside the lesson: the lesson screen stays and draws the quiz in place of its own body.
    parent: 'courses/lesson',
    name: 'The quiz',
    about: 'The questions, what has been put for each, the hints, and getting it marked. 80% passes, and it can be retaken.',
    kind: 'panel',
    keywords: ['quiz', 'questions', 'test', 'assessment', 'mark', 'answers'],
    controls: Object.fromEntries(screen.questions().map((one, at) => [`q${at + 1}`, control(one, at)])),
    actions: {
      hint: {
        name: 'Ask for a hint',
        about: 'One hint at a time. Hints are counted, and a question answered with one is worth less -- which is said on screen too.',
        params: { question: { type: 'string', description: 'Which question, as its number on screen ("1") or its id.', required: true } },
        unavailable: () => (marked() ? 'This has been marked, so there is nothing left to hint at.' : null),
        run: (params) => {
          const asked = String(params.question).trim()
          const all = screen.questions()
          const at = Number(asked)
          const found = Number.isInteger(at) && at >= 1 && at <= all.length ? all[at - 1] : all.find((one) => one.id === asked)
          if (!found) throw new Error(`There is no question “${asked}”. There ${all.length === 1 ? 'is 1 question' : `are ${all.length} questions`}.`)
          if (found.hints.length <= screen.hintsUsed(found.id)) throw new Error(`Question ${all.indexOf(found) + 1} has no more hints.`)
          /*
           * The count is read *before* asking, and checked for having gone up.
           *
           * Reading it after and adding one assumed the screen's setter takes effect at once. It does in a test and it
           * does not in React, so the check was comparing two different moments and reporting a hint that really was
           * shown as unconfirmed. Found by asking for one.
           */
          const before = screen.hintsUsed(found.id)
          screen.hint(found.id)
          return { questionId: found.id, before, hints: found.hints.length }
        },
        verify: (data) => {
          const said = data as { questionId: string; before: number; hints: number }
          const now = screen.hintsUsed(said.questionId)
          if (now > said.before) return { done: true, detail: `${now} ${now === 1 ? 'hint has' : 'hints have'} been shown for that question.` }
          return { done: false, detail: `the screen still shows ${said.before} of ${said.hints} hints, so it has not redrawn yet.` }
        }
      },
      mark: {
        name: 'Mark it',
        about: 'Sends every answer to be marked against the course’s own answers. 80% passes.',
        unavailable: () => {
          if (marked()) return 'This has already been marked. Use retry to do it again.'
          if (screen.busy()) return 'It is being marked.'
          const left = unanswered()
          return left.length ? `${left.length} ${left.length === 1 ? 'question has' : 'questions have'} no answer yet. Every question has to be answered first.` : null
        },
        run: () => screen.submit(),
        // The mark the marking gave back, not the mark on screen: the screen has not redrawn yet, and the thing worth
        // reporting is what the course's own answers made of the paper.
        verify: (data) => {
          const out = data as QuizResult | null
          if (!out) return { done: false, detail: 'nothing came back from the marking, so nothing was recorded.' }
          return { done: true, detail: `${out.right} of ${out.asked} right — ${Math.round(out.score * 100)}%. ${out.passed ? 'Passed.' : 'Not a pass yet.'}` }
        }
      },
      retry: {
        name: 'Try again',
        about: 'Clears the answers and fetches the questions again. A retake is a different paper, not the same one.',
        unavailable: () => (marked() ? null : 'There is nothing to try again: this has not been marked yet.'),
        run: () => {
          screen.retry()
          return { retried: true }
        },
        verify: () =>
          screen.result() === null
            ? { done: true, detail: 'The questions are back and the answers are cleared.' }
            : { done: false, detail: 'the mark is still on screen, so it has not redrawn yet.' }
      },
      done: {
        name: 'Carry on',
        about: 'Puts the quiz away and goes back to the lesson.',
        run: () => {
          screen.done()
          return { closed: true }
        }
      }
    },
    state: () => {
      const all = screen.questions()
      const out = screen.result()
      return {
        activity: screen.busy() ? 'running' : out ? (out.passed ? 'finished' : 'failed') : 'idle',
        detail: out ? out.says : `${all.length - unanswered().length} of ${all.length} answered`,
        values: {
          title: screen.title(),
          questions: all.length,
          answered: all.length - unanswered().length,
          hintsUsed: all.reduce((sum, one) => sum + screen.hintsUsed(one.id), 0),
          ...(out ? { score: Math.round(out.score * 100), passed: out.passed, right: out.right, shakyConcepts: out.weak } : {})
        },
        // How much of the paper is filled in -- counted, not guessed. Nothing is reported when there are no questions.
        ...(all.length ? { progress: (all.length - unanswered().length) / all.length } : {})
      }
    }
  }
}
