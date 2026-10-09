import type { Assessment, Course, Module } from '../../types.ts'
import { PYTHON_CONCEPTS } from './concepts.ts'
import { MODULE_1 } from './module1.ts'
import { MODULE_2 } from './module2.ts'
import { MODULE_3 } from './module3.ts'
import { MODULE_4 } from './module4.ts'
import { MODULE_5 } from './module5.ts'
import { MODULE_6 } from './module6.ts'
import { MODULE_7 } from './module7.ts'
import { MODULE_8 } from './module8.ts'
import { MODULE_9 } from './module9.ts'
import { MODULE_PROJECT } from './project.ts'

/**
 * Course 01 — Python Programming: From Zero to Developer.
 *
 * ## Nothing here is counted by hand
 *
 * `lessonCount`, `moduleCount` and `estimatedMinutes` are all recomputed by `cleanCourse` from the actual
 * content, so there is no number in this file that could disagree with what is really there. The same goes for
 * the assessment: its question pool is gathered from the lessons rather than typed out, which means a question
 * cannot be renamed in a module and leave the final paper asking for something that does not exist.
 *
 * ## The pass mark is 80%
 *
 * Both for module quizzes and for the final assessment. A mark a guess could reach makes the certificate a lie,
 * and the certificate names what was actually achieved.
 */

const MODULES: readonly Module[] = [
  MODULE_1,
  MODULE_2,
  MODULE_3,
  MODULE_4,
  MODULE_5,
  MODULE_6,
  MODULE_7,
  MODULE_8,
  MODULE_9,
  MODULE_PROJECT
]

/**
 * The final paper's pool.
 *
 * Gathered from the lessons, so it cannot name a question that was renamed or removed. Only intermediate,
 * advanced and expert questions are eligible: a final assessment made of the beginner checks from lesson one
 * would pass somebody who had read the first module and nothing else.
 */
function assessmentPool(): string[] {
  const out: string[] = []
  for (const unit of MODULES) {
    for (const lesson of unit.lessons) {
      for (const question of lesson.questions) {
        if (question.difficulty === 'beginner') continue
        out.push(question.id)
      }
    }
  }
  return out
}

const POOL = assessmentPool()

const ASSESSMENT: Assessment = {
  id: 'python.final',
  title: 'Final assessment',
  questionIds: POOL,
  /*
   * Forty, drawn from a pool several times that size.
   *
   * Deliberately far fewer than the pool holds, so a second attempt is a different paper. Retaking until the
   * same forty questions are memorised would measure memory of this paper rather than knowledge of Python.
   */
  ask: Math.min(40, POOL.length),
  passScore: 0.8,
  minutes: 60
}

export const PYTHON_COURSE: Course = {
  id: 'orbis.python.01',
  title: 'Python Programming: From Zero to Developer',
  subtitle: 'From never having written a line to finishing something on your own',
  shortDescription:
    'The whole language, taught in the order it makes sense, and then the part courses usually leave out: taking a problem nobody has given you steps for and finishing it.',
  description:
    'A complete first course in Python, for somebody who has never programmed. It starts with what a program is, ' +
    'works through the language — values, decisions, loops, collections, functions, files, errors, libraries and classes — ' +
    'and then spends two modules on the things that separate somebody who can write code from somebody who can build ' +
    'software: readable code, debugging, testing, project structure, and working out what is actually wanted before ' +
    'writing anything.\n\n' +
    'It ends with one real program, built over twenty stages: a productivity manager that keeps tasks, notes, habits ' +
    'and expenses, saves them safely, reports on them, and survives everything a person can type at it.\n\n' +
    'Nothing is a toy example that would fall over on real data. Where something is genuinely awkward — floats and ' +
    'money, a streak that must not break at midnight, a data file that cannot be read — the course says so and shows ' +
    'what to do about it.',
  category: 'Programming',
  subcategory: 'Python',
  difficulty: 'beginner',
  // Recomputed from the content by cleanCourse; these are placeholders that the loader overwrites.
  lessonCount: 0,
  moduleCount: MODULES.length,
  estimatedMinutes: 0,
  language: 'en',
  tags: ['python', 'programming', 'beginner', 'software development', 'testing', 'project'],
  origin: 'orbis',
  version: 1,
  icon: 'code',
  cover: { from: '#2b6cb0', to: '#1a202c' },
  updatedAt: 0,
  createdAt: 0,
  objectives: [
    'Write Python programs from nothing, without following a tutorial',
    'Choose the right data structure for a problem, and say why',
    'Split a program into functions and modules that can be read and changed',
    'Find out why code is wrong, instead of changing things until it stops complaining',
    'Write tests, and know which parts are worth testing',
    'Handle bad input, missing files and damaged data without losing anything',
    'Use classes where they earn their place, and leave them out where they do not',
    'Turn a vague request into requirements, a design, and a finished program'
  ],
  skills: [
    'Python syntax and semantics',
    'Control flow and the common loop patterns',
    'Lists, tuples, sets and dictionaries',
    'Functions and program design',
    'Files, JSON and CSV',
    'Exceptions and input validation',
    'The standard library, pip and virtual environments',
    'Classes, inheritance and composition',
    'Debugging',
    'Testing with assert and pytest',
    'Project structure and layering',
    'Refactoring',
    'Requirements and independent problem solving'
  ],
  prerequisites: [
    'None. It assumes you have never written a line of code.',
    'A computer you can install Python on, and about an hour at a time.'
  ],
  audience:
    'Anybody starting from nothing, and anybody who has done a few tutorials and still cannot start a program from a blank file.',
  modules: [...MODULES],
  concepts: [...PYTHON_CONCEPTS],
  completion: {
    requiredLessons: true,
    lessonShare: 1,
    // Empty means every module's quiz, which is what is wanted here.
    requiredQuizzes: [],
    quizPass: 0.8,
    needsAssessment: true,
    /*
     * Mastery is required as well as the lessons and the quizzes.
     *
     * Reading every page and passing every quiz once is not the same as knowing it, and 0.7 average mastery across
     * the course's concepts is reachable by somebody who actually learned it and not by somebody who clicked through.
     */
    masteryAtLeast: 0.7,
    requiredProjects: ['m10']
  },
  assessment: ASSESSMENT,
  certificate: true
}
