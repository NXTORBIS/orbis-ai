import { declareAll, isParameterProblem, type Parameter, type ParameterSet } from './parameters.ts'
import type { ActionDeclaration, NativeAppManifest } from './manifest.ts'
import { CHEMISTRY_BUILT, CHEMISTRY_COUNTS, CHEMISTRY_GROUPS, CHEMISTRY_MODULES } from '../chemistry/modules.ts'

/**
 * Phase 10: the Chemistry Studio.
 *
 * ## One app, twenty-six modules, for the same reason the Physics Studio is one app
 *
 * Registering twenty-six separate apps would make the catalogue useless and the search worse. This is one
 * laboratory with every module in it, the way a chemistry studio is one room with many benches. Every module is
 * still findable by name, because the tags are read straight from the studio's own registry.
 *
 * ## All twenty-six are built
 *
 * Their own registry marked `visualization` and `research` as not finished. Both are built now -- Chemical
 * Visualization computes orbitals, bond curves and energy surfaces; the Research Workspace records a prediction
 * before it runs and reports a null result as a null result. The `soon` flag is gone from their registry, and
 * `CHEMISTRY_BUILT` would drop any module that gained one again, so the catalogue cannot claim a module Orbis
 * has not got.
 *
 * ## The controls belong to the module, not to this file
 *
 * Each module brings its own controls — a titration has concentrations and volumes, a kinetics run has an
 * activation energy. So the only things declared here are which module to open and a free-text line for its own
 * settings. Declaring twenty-six modules' controls would be the same list written twice, and the two would
 * drift apart within a week.
 */

const RECOMPUTE: readonly ActionDeclaration[] = [
  { id: 'run', summary: 'Work out the module again from its current values', takes: [], idempotent: true, destructive: false },
  { id: 'reset', summary: 'Put it back to where it started', takes: [], idempotent: true, destructive: false }
]

type Declared = Omit<Parameter, 'value'> & { value?: Parameter['value'] }

const STUDIO: readonly Declared[] = [
  {
    id: 'module',
    name: 'Module',
    kind: 'choice',
    initial: '',
    about: 'Which part of the studio to open — the periodic table, a reaction, kinetics, spectroscopy, and so on. Leave it empty to show all of them.',
    // Read from their own registry, so a module cannot be offered that does not exist or is not built.
    options: [
      { id: '', label: 'All modules' },
      ...CHEMISTRY_BUILT.map((one) => ({ id: one.name, label: `${one.name} — ${one.group}` }))
    ],
    group: 'What to open'
  },
  {
    id: 'element',
    name: 'Element',
    kind: 'text',
    initial: '',
    about: "One element's own page, by name, symbol or atomic number. Opens the periodic table and goes straight to it.",
    group: 'What to open'
  },
  {
    id: 'settings',
    name: 'Its own settings',
    kind: 'text',
    initial: '',
    about: "The module's own controls, written as `name = value`, separated by commas — for example `temperature = 350, concentration = 0.2`. Each module has its own, and a name it does not have is reported rather than ignored.",
    group: 'How to set it up'
  },
  {
    id: 'tab',
    name: 'View',
    kind: 'text',
    initial: '',
    about: 'One of the module’s own views, by the words on its tab — for example "Titration" or "Arrhenius". Modules that have only one view have no tabs.',
    group: 'How to set it up'
  }
]

export const PHASE10_PARAMETERS: Readonly<Record<string, ParameterSet>> = Object.freeze(
  (() => {
    const made = declareAll(STUDIO)
    if (Array.isArray(made)) {
      const first = made.find(isParameterProblem)
      throw new Error(`Parameters for "chemistry-studio" are not valid: ${first ? `${first.id} — ${first.says}` : 'unknown problem'}`)
    }
    return { 'chemistry-studio': made }
  })()
)

const app = (
  one: Omit<NativeAppManifest, 'version' | 'aliases'> & { version?: number; aliases?: readonly string[] }
): NativeAppManifest => ({ version: 1, aliases: [], ...one })

export const PHASE10_CATALOGUE: readonly NativeAppManifest[] = Object.freeze([
  app({
    id: 'chemistry-studio',
    name: 'Chemistry Studio',
    summary: `${CHEMISTRY_COUNTS.built} chemistry modules across ${CHEMISTRY_GROUPS.length} groups — the periodic table, reactions, kinetics, spectroscopy, biochemistry and the rest, each one worked out rather than looked up.`,
    domain: 'chemistry',
    icon: 'flask',
    aliases: ['chemistry', 'chem', 'chemistry lab', 'periodic table', 'elements', 'reactions'],
    // Every built module's own name and id, so each is findable without the list being written out twice.
    tags: [
      ...new Set([
        'chemistry',
        'chemical',
        'element',
        'periodic',
        'molecule',
        'reaction',
        ...CHEMISTRY_GROUPS.map((one) => one.toLowerCase()),
        ...CHEMISTRY_BUILT.map((one) => one.id),
        ...CHEMISTRY_BUILT.map((one) => one.name.toLowerCase()),
        ...CHEMISTRY_BUILT.flatMap((one) => one.keywords.map((two) => two.toLowerCase()))
      ])
    ].slice(0, 118),
    capabilities: [
      { id: 'periodicTable', summary: "show the periodic table and open any element's own page" },
      { id: 'exploreChemistry', summary: 'find a chemistry module by name and open it' },
      { id: 'workOutChemistry', summary: 'work out a chemistry result from its own controls — a titration curve, a rate law, a cell potential' },
      { id: 'setUpChemistry', summary: "open a chemistry module and set its own controls — the temperature, the concentration, the activation energy" }
    ],
    surface: { kind: 'native', ref: 'ChemistryStudio' },
    // A periodic table is eighteen columns wide and most modules put controls beside a chart. Opened at the
    // chat's text width the columns collapse and the controls end up below the fold.
    opensAt: 'workspace',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE10_PARAMETERS['chemistry-studio']),
    actions: RECOMPUTE,
    accepts: ['numbers', 'text'],
    produces: ['series', 'image', 'table'],
    permissions: ['compute'],
    persists: true,
    engine: 'chemistry',
    limitations: [
      'Each module says what it assumes — ideal mixing, constant temperature, standard conditions — beside the numbers rather than in a manual.',
      'The orbitals are hydrogen-like: the shapes are exact, the energies are not right for any atom with more than one electron, because electron-electron repulsion is not in that model.',
      'The element data is the published values. Where a measurement is uncertain or disputed, it is the standard figure and not a range.',
      'Molecules are drawn in two dimensions. Nothing here is a three-dimensional renderer.',
      'Nothing is a substitute for a real laboratory. A result here is what the model says, not what a bench would measure.'
    ]

  })
])

/** Every module, for anything that wants the list without reaching into the registry. */
export { CHEMISTRY_MODULES, CHEMISTRY_BUILT, CHEMISTRY_COUNTS }
