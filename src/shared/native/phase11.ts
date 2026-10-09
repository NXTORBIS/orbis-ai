import { declareAll, isParameterProblem, type Parameter, type ParameterSet } from './parameters.ts'
import type { ActionDeclaration, NativeAppManifest } from './manifest.ts'
import { CS_ALGORITHMS, CS_CATEGORIES, CS_COUNTS, CS_SECTIONS } from '../cs/sections.ts'

/**
 * Phase 11: the Computer Science Studio.
 *
 * ## One app, twenty-four sections, for the same reason the other studios are one app
 *
 * Registering twenty-four separate apps would make the catalogue useless and the search worse. This is one
 * studio with everything in it, the way a computer laboratory is one room with many benches. Every section and
 * every algorithm is still findable by name, because the tags are read straight from the studio's own rail and
 * registry.
 *
 * ## It supersedes sixteen laboratories Orbis built first
 *
 * Orbis grew its own algorithm, data-structure, processor, operating-system, network, database, compiler,
 * automata, cryptography, graphics, consensus, learning and neural laboratories before the user's own studio was
 * ported. The studio now contains all of that, as the user's own design, so each of those names
 * `supersededBy: 'cs-studio'` and steps aside — out of the catalogue, its capabilities handed over, and still
 * registered so an instance already on screen keeps working.
 *
 * ## The controls belong to the section, not to this file
 *
 * Each of the twenty-four brings its own: a scheduler has processes and a quantum, a DFA has an alphabet, the
 * playground has a language and a program. So the only things declared here are which section to open and the
 * few values worth setting from outside. Declaring twenty-four sections' controls would be the same list written
 * twice, and the two would drift apart within a week.
 */

const RECOMPUTE: readonly ActionDeclaration[] = [
  { id: 'run', summary: 'Run whatever the open section runs', takes: [], idempotent: true, destructive: false },
  { id: 'reset', summary: 'Put it back to where it started', takes: [], idempotent: true, destructive: false }
]

type Declared = Omit<Parameter, 'value'> & { value?: Parameter['value'] }

const STUDIO: readonly Declared[] = [
  {
    id: 'section',
    name: 'Section',
    kind: 'choice',
    initial: '',
    about: 'Which part of the studio to open — a laboratory, the problems, the playground, the lessons. Leave it empty for the overview.',
    // Read from the studio's own rail, so a section cannot be offered that does not exist.
    options: [
      { id: '', label: 'Overview' },
      ...CS_SECTIONS.filter((one) => one.label !== 'Overview').map((one) => ({ id: one.label, label: one.label }))
    ],
    group: 'What to open'
  },
  {
    id: 'algorithm',
    name: 'Algorithm',
    kind: 'choice',
    initial: '',
    about: `One of the ${CS_COUNTS.algorithms} algorithms, traced step by step with its own pseudocode, variables and running count of comparisons and swaps. Opens the Algorithm Laboratory.`,
    options: [
      { id: '', label: 'None' },
      ...CS_ALGORITHMS.map((one) => ({ id: one.name, label: `${one.name} — ${one.category}` }))
    ],
    group: 'What to open'
  },
  {
    id: 'problem',
    name: 'Problem',
    kind: 'text',
    initial: '',
    about: 'A problem to open, by its title. Opens the problem list and goes to it.',
    group: 'What to open'
  },
  {
    id: 'language',
    name: 'Language',
    kind: 'text',
    initial: '',
    about: 'Which language the editor is in. Any language can be read; what cannot be read in a sandbox is said rather than hidden.',
    group: 'Writing code'
  },
  {
    id: 'code',
    name: 'The program',
    kind: 'text',
    initial: '',
    about: 'A program to put in the playground’s editor. It is not run until Run is pressed.',
    group: 'Writing code'
  }
]

export const PHASE11_PARAMETERS: Readonly<Record<string, ParameterSet>> = Object.freeze(
  (() => {
    const made = declareAll(STUDIO)
    if (Array.isArray(made)) {
      const first = made.find(isParameterProblem)
      throw new Error(`Parameters for "cs-studio" are not valid: ${first ? `${first.id} — ${first.says}` : 'unknown problem'}`)
    }
    return { 'cs-studio': made }
  })()
)

const app = (
  one: Omit<NativeAppManifest, 'version' | 'aliases'> & { version?: number; aliases?: readonly string[] }
): NativeAppManifest => ({ version: 1, aliases: [], ...one })

export const PHASE11_CATALOGUE: readonly NativeAppManifest[] = Object.freeze([
  app({
    id: 'cs-studio',
    name: 'Computer Science Studio',
    summary: `${CS_COUNTS.algorithms} algorithms traced step by step across ${CS_COUNTS.categories} categories, fourteen laboratories, a problem bank and a playground — in ${CS_COUNTS.sections} sections.`,
    domain: 'computing',
    icon: 'boxes',
    // The names people actually use for it, including the one the Algorithm Laboratory is universally called.
    aliases: [
      'computer science',
      'cs',
      'dsa',
      'algorithms',
      'coding',
      'programming',
      'leetcode',
      'algorithm visualizer',
      'algorithm visualiser',
      'algorithm lab',
      'data structures',
      'code playground'
    ],
    tags: [
      ...new Set([
        'computer science',
        'algorithm',
        'data structure',
        'coding',
        'programming',
        'leetcode',
        ...CS_CATEGORIES.map((one) => one.toLowerCase()),
        ...CS_SECTIONS.map((one) => one.label.toLowerCase()),
        /*
         * Names before ids, because the list is capped at 118 and there are more than that.
         *
         * The ids came first and filled it, so "binary search" was cut and a search for it found a different
         * laboratory. An id like `binarysearch` is not what anybody types; the name is.
         */
        ...CS_ALGORITHMS.map((one) => one.name.toLowerCase()),
        ...CS_ALGORITHMS.map((one) => one.id.toLowerCase())
      ])
    ].slice(0, 118),
    capabilities: [
      /*
       * Only what no other app already does.
       *
       * The studio deliberately does NOT claim `simulateCpu`, `scheduleProcesses`, `simulateNetwork`,
       * `runQuery`, `exploreSchema`, `compileSource`, `runMachine`, `projectShape` or `electLeader`. Each of
       * those belongs to an Orbis laboratory that goes further than the studio's section of the same name --
       * a pipeline and a cache, paging and deadlock, subnets and firewalls, NFA conversion, back-face culling,
       * partitions and replication. Claiming them would make `resolve` choose between two apps for one job,
       * which is exactly the duplication all of this was meant to remove.
       *
       * One id per job, and where a retired laboratory already used a name, that is the name kept --
       * `simulateCpu` rather than a second `simulateProcessor` -- so whatever already asked for it keeps
       * working.
       *
       * Deliberately NOT claimed, and left with the laboratory that really does them: `tracePipeline` and
       * `simulateCache` (the Architecture section shows registers and stepping, not a pipeline or a cache),
       * `workOutSubnet`, `breakCaesarCipher` (it enciphers; it does not break one), and all of digital
       * logic, which stays with Orbis\u2019s own logic laboratory because the studio does not contain it.
       */
      { id: 'visualizeAlgorithm', summary: 'show an algorithm running step by step, with its array, its variables, the pseudocode line and a running count of comparisons and swaps' },
      { id: 'measureComplexity', summary: 'count the work an algorithm actually did on a given input, rather than quoting its order' },
      { id: 'compareAlgorithms', summary: 'run the same input through several algorithms and show what each one cost' },
      { id: 'exploreDataStructure', summary: 'build and walk a data structure one operation at a time' },
      { id: 'solveProblem', summary: 'open a coding problem with its tests, write a solution and have it judged' },
      { id: 'runCode', summary: 'write a program in any language and have it read or run, saying plainly which it was' },
      { id: 'predictOutput', summary: 'read a program and say what it would print, as a labelled reading rather than a run' },
      { id: 'listLanguages', summary: 'list the languages available and how each one would be handled' },
      { id: 'hashMessage', summary: 'hash, encode or encipher a message, and measure how strong a password is' },
      { id: 'trainModel', summary: 'set a model\u2019s hyperparameters, train it and see what it predicts' },
      { id: 'learnComputing', summary: 'work through computer science lessons, with what was completed recorded' }
    ],
    surface: { kind: 'native', ref: 'CSStudio' },
    // A rail of twenty-four, an editor and a console beside it. Opened at the chat's text width the rail eats
    // the page and the editor ends up below the fold.
    opensAt: 'workspace',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE11_PARAMETERS['cs-studio']),
    actions: RECOMPUTE,
    accepts: ['text', 'numbers'],
    produces: ['series', 'table', 'text'],
    permissions: ['compute'],
    persists: true,
    // `cs` is the engine name this build already recognises. Naming one it does not know makes the app
    // launchable in the catalogue and refused the moment somebody opens it, which is what happened.
    engine: 'cs',
    limitations: [
      'Code is read rather than executed by default: Orion says what a program would print, and the result says so and never reports a running time. Nothing is ever run on this computer.',
      'A verdict on a submitted solution is a reading of the code, not a run of it, unless a sandbox has been set up — and the verdict says which it was.',
      'Each algorithm trace is the real algorithm on a small input. The step counts are counted, not estimated, but they are the counts for that input rather than a proof about every input.',
      'The laboratories are models: a scheduler, a processor, a network, a cluster. They show what the model does under the settings given, which is a different thing from what a machine would do.',
      'The problem bank is finite. Beyond it, problems are generated and checked against a reference solution, and a generated problem says so.',
      'A submission is judged by comparing what it printed with what the test expects. Where a problem genuinely has more than one right answer and its test names only one, a correct solution can be marked wrong — the message says what it printed and what was expected, so the difference is visible rather than mysterious.'
    ]
  })
])

export { CS_SECTIONS, CS_ALGORITHMS, CS_COUNTS }
