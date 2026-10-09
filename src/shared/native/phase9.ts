import { declareAll, isParameterProblem, type Parameter, type ParameterSet } from './parameters.ts'
import type { ActionDeclaration, NativeAppManifest } from './manifest.ts'
import { CATEGORIES, LANGUAGES } from '../cs/execution.ts'

/**
 * Phase 9: writing and running code.
 *
 * ## The Playground is honest about where an answer came from
 *
 * It has two sources — a sandbox that really runs the program, and Orion reading the code and saying what it
 * thinks would happen. Those are entirely different claims. Every capability here is worded so neither can be
 * mistaken for the other, and the manifest says plainly that without a sandbox configured only the second is
 * available.
 *
 * ## Nothing runs on this machine
 *
 * There is no capability for executing anything locally, and that is deliberate rather than an oversight. The
 * permission list has `network` and `compute` and nothing that touches a shell.
 */

const RUN: readonly ActionDeclaration[] = [
  { id: 'run', summary: 'Compile and run it, or ask Orion when there is no sandbox', takes: [], idempotent: false, destructive: false },
  { id: 'predict', summary: 'Ask Orion what it would print, without running it', takes: [], idempotent: true, destructive: false },
  { id: 'reset', summary: 'Go back to the example program for this language', takes: [], idempotent: true, destructive: false }
]

type Declared = Omit<Parameter, 'value'> & { value?: Parameter['value'] }

const PLAYGROUND: readonly Declared[] = [
  {
    id: 'language',
    name: 'Language',
    kind: 'choice',
    initial: 'python',
    about: 'Which language to write in. A few can only be predicted, never really run, and those say so.',
    // Read from the engine, so a language cannot be offered that the runner does not know.
    options: LANGUAGES.map((one) => ({ id: one.id, label: `${one.name} — ${one.category}` })),
    group: 'What to write'
  },
  {
    id: 'source',
    name: 'The program',
    kind: 'text',
    initial: '',
    about: 'The code itself. Leaving it empty loads the example for the chosen language, which reads a line of input.',
    group: 'What to write'
  },
  {
    id: 'stdin',
    name: 'Input it reads',
    kind: 'text',
    initial: '',
    about: 'What the program gets on its standard input, one value per line. Every example here reads something, so this box is connected to the program rather than decoration.',
    group: 'What to write'
  },
  {
    id: 'predictOnly',
    name: 'Ask Orion instead of running it',
    kind: 'boolean',
    initial: false,
    about: 'Skip the sandbox even when there is one, to compare what a model thinks the code does against what it really does.',
    group: 'How to run it'
  }
]

export const PHASE9_PARAMETERS: Readonly<Record<string, ParameterSet>> = Object.freeze(
  (() => {
    const made = declareAll(PLAYGROUND)
    if (Array.isArray(made)) {
      const first = made.find(isParameterProblem)
      throw new Error(`Parameters for "code-playground" are not valid: ${first ? `${first.id} — ${first.says}` : 'unknown problem'}`)
    }
    return { 'code-playground': made }
  })()
)

const app = (
  one: Omit<NativeAppManifest, 'version' | 'aliases'> & { version?: number; aliases?: readonly string[] }
): NativeAppManifest => ({ version: 1, aliases: [], ...one })

export const PHASE9_CATALOGUE: readonly NativeAppManifest[] = Object.freeze([
  app({
    id: 'code-playground',
    name: 'Code Playground',
    summary:
      'Write a program in any of twenty languages, give it input, and run it in a sandbox — or have Orion read it and say what it would do, clearly labelled as a guess.',
    domain: 'computing',
    icon: 'terminal',
    aliases: ['code', 'run code', 'playground', 'compiler', 'repl', 'execute code', 'programming'],
    tags: [
      ...new Set([
        'code',
        'run',
        'compile',
        'execute',
        'program',
        'programming',
        'repl',
        'playground',
        'stdin',
        'input',
        'output',
        'judge0',
        'sandbox',
        ...CATEGORIES.map((one) => one.toLowerCase()),
        ...LANGUAGES.map((one) => one.id),
        ...LANGUAGES.map((one) => one.name.toLowerCase())
      ])
    ].slice(0, 118),
    capabilities: [
      { id: 'runCode', summary: 'compile and run a program in a sandbox and report exactly what it printed' },
      { id: 'predictOutput', summary: 'read a program and say what it would print, as a labelled guess rather than a run' },
      { id: 'listLanguages', summary: 'list the languages available and which of them can really be run' }
    ],
    surface: { kind: 'native', ref: 'CodePlaygroundLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE9_PARAMETERS['code-playground']),
    actions: RUN,
    accepts: ['text'],
    produces: ['text'],
    permissions: ['compute', 'network'],
    persists: true,
    engine: 'execution',
    limitations: [
      'Nothing is ever run on this machine. Code goes to a remote sandbox, or to a model that reads it — there is no third route, and that is deliberate.',
      'Without a sandbox configured in Settings, every answer is Orion reading the code rather than running it. Those answers are labelled, and they can be wrong.',
      'A predicted result never reports a running time or a memory figure, because nothing ran and inventing those would be the easiest possible lie.',
      'No network access from inside the program, no file system, and no installing packages. Only what the language has as standard.',
      'One file, one program. There is no project, no build system and no linking against anything.'
    ],
    // Retired: the studio has the Playground, with its own editor, console and language list.
    supersededBy: 'cs-studio'
  })
])

export const PHASE9_BY_ID: Readonly<Record<string, NativeAppManifest>> = Object.freeze(
  Object.fromEntries(PHASE9_CATALOGUE.map((one) => [one.id, one]))
)
