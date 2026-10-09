import { declareAll, isParameterProblem, type Parameter, type ParameterSet } from './parameters.ts'
import type { ActionDeclaration, NativeAppManifest } from './manifest.ts'
import { PHYSICS_SECTIONS, PHYSICS_TOPICS } from '../physics/topics.ts'

/**
 * Phase 8: the Physics Studio.
 *
 * ## One app, 244 topics, because that is what a studio is
 *
 * Registering 244 separate apps would make the catalogue useless and the search worse. This is one laboratory
 * with every topic in it, the way a physics studio is one room with many experiments. Every topic is still
 * findable by name, because the tags and the picker are read straight from the studio's own list.
 *
 * ## The controls belong to the simulation, not to this file
 *
 * Each simulation brings its own parameters, its own canvas and its own transport — play, pause, step, speed and
 * reset. So the only thing declared here is which topic to open. Declaring 244 simulations' controls would be the
 * same list written twice, and the two would drift apart within a week.
 */

const RECOMPUTE: readonly ActionDeclaration[] = [
  { id: 'run', summary: 'Start the simulation running', takes: [], idempotent: true, destructive: false },
  { id: 'reset', summary: 'Put it back to where it started', takes: [], idempotent: true, destructive: false }
]

type Declared = Omit<Parameter, 'value'> & { value?: Parameter['value'] }

const STUDIO: readonly Declared[] = [
  {
    id: 'topic',
    name: 'Topic',
    kind: 'choice',
    initial: 'projectile',
    about: 'Which of the topics to open. Each brings its own controls, graphs and transport.',
    // Read from the studio's own list, so a topic cannot be offered that does not exist.
    options: PHYSICS_TOPICS.map((one) => ({ id: one.id, label: `${one.name} — ${one.sectionName}` })),
    group: 'What to open'
  },
  {
    id: 'settings',
    name: 'Settings',
    kind: 'text',
    initial: '',
    /*
     * Free text rather than a declared list, because the 245 topics have entirely different controls and no two
     * share a set. Written as `name = value`, separated by commas: `launch angle = 60, initial speed = 30`.
     *
     * The names are matched against the labels the chosen simulation is actually showing, so a setting it has not
     * got is refused by name with the list of what it does have, rather than quietly doing nothing.
     */
    about:
      'The chosen simulation\'s own controls, as `name = value` separated by commas — for example `launch angle = 60, initial speed = 30`. Anything the simulation has not got is refused by name.',
    group: 'How to run it'
  },
  {
    id: 'speed',
    name: 'Run speed',
    kind: 'number',
    initial: 1,
    // No unit: a multiple of real time is a ratio, not a quantity, and Orbis only knows real units.
    about: 'How fast it runs, as a multiple of real time — 1 is real time, 2 is twice as fast. Only the topics that run over time have this.',
    least: 0.1,
    most: 4,
    step: 0.1,
    group: 'How to run it'
  },
  {
    id: 'playing',
    name: 'Running',
    kind: 'boolean',
    initial: false,
    about: 'Start it going, or hold it. A topic that is worked out once rather than stepped has nothing to start.',
    group: 'How to run it'
  }
]

export const PHASE8_PARAMETERS: Readonly<Record<string, ParameterSet>> = Object.freeze(
  (() => {
    const made = declareAll(STUDIO)
    if (Array.isArray(made)) {
      const first = made.find(isParameterProblem)
      throw new Error(`Parameters for "physics-studio" are not valid: ${first ? `${first.id} — ${first.says}` : 'unknown problem'}`)
    }
    return { 'physics-studio': made }
  })()
)

const app = (
  one: Omit<NativeAppManifest, 'version' | 'aliases'> & { version?: number; aliases?: readonly string[] }
): NativeAppManifest => ({ version: 1, aliases: [], ...one })

export const PHASE8_CATALOGUE: readonly NativeAppManifest[] = Object.freeze([
  app({
    id: 'physics-studio',
    name: 'Physics Studio',
    summary: `${PHYSICS_TOPICS.length} physics topics across ${PHYSICS_SECTIONS.length} sections, each one a simulation you can run, pause, step and change while it goes.`,
    domain: 'physics',
    icon: 'atom',
    aliases: ['physics', 'simulation', 'physics lab', 'physics simulations', 'experiment'],
    // Every topic's own name and id, so each is findable without the list being written out twice.
    tags: [
      ...new Set([
        'physics',
        'simulation',
        'simulate',
        'experiment',
        ...PHYSICS_SECTIONS.map((one) => one.name.toLowerCase()),
        ...PHYSICS_TOPICS.map((one) => one.id),
        ...PHYSICS_TOPICS.map((one) => one.name.toLowerCase())
      ])
    ].slice(0, 118),
    capabilities: [
      { id: 'runSimulation', summary: 'open a physics simulation and run it, with its own controls and live graphs' },
      { id: 'showConservation', summary: 'show how a quantity that should not change behaves as the simulation runs' },
      { id: 'exploreTopic', summary: 'find a physics topic by name and open the simulation for it' },
      { id: 'setUpSimulation', summary: "open a topic and set its own controls — the angle, the speed, the mass — and start it running" }
    ],
    surface: { kind: 'native', ref: 'PhysicsStudio' },
    // A canvas, a parameter panel and live graphs side by side need the room. Opened at the chat's text width the
    // three columns collapse into one and the controls end up below the fold.
    opensAt: 'workspace',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE8_PARAMETERS['physics-studio']),
    actions: RECOMPUTE,
    accepts: ['numbers'],
    produces: ['series', 'image', 'table'],
    permissions: ['compute'],
    persists: true,
    engine: 'physics',
    limitations: [
      'Each simulation says what it leaves out — no drag unless asked for, point masses, frictionless pivots — beside the numbers rather than in a manual.',
      'A result is only as good as the time step. Anything that should conserve a quantity shows it, and a drifting value means the step is too big rather than that physics is wrong.',
      'Two dimensions throughout. Nothing here is a three-dimensional renderer.',
      'Nothing is relativistic or quantised unless the simulation says so, and each says so.'
    ]
  })
])

export const PHASE8_BY_ID: Readonly<Record<string, NativeAppManifest>> = Object.freeze(
  Object.fromEntries(PHASE8_CATALOGUE.map((one) => [one.id, one]))
)
