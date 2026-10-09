import { declareAll, isParameterProblem, type Parameter, type ParameterSet } from './parameters.ts'
import type { ActionDeclaration, NativeAppManifest } from './manifest.ts'
import { KNOWN } from '../compute/molecules.ts'

/**
 * The Phase 3 scientific environments.
 *
 * ## Almost all of the science already existed
 *
 * The audit for this phase found about twenty-two thousand lines of real, tested scientific engines already in
 * `shared/compute/` — mechanics, kinematics, collisions, gravitation (including `nBody` and `fieldGrid`),
 * oscillators, waves, optics, electrostatics, magnetism, thermodynamics, fluids, quantum, relativity, chemistry,
 * reactions, biochemistry, genetics, physiology and ecology — plus `simulation.ts`, which already provides ODE
 * integration with divergence detection, conservation checks, parameter sweeps, Monte Carlo and sensitivity
 * analysis. Phase 1 registered thirty-seven laboratories over them.
 *
 * So this phase does not rebuild engines. It adds the one that was genuinely missing — molecular structure, in
 * `shared/compute/molecules.ts` — and builds specialised applications over what exists.
 *
 * ## Only what is built is registered
 *
 * The same rule as Phase 2, enforced by `surfaces.test.ts`: an app in this list must have a component, or the test
 * suite fails. A row that opens nothing is worse than no row, and the brief says so in §202 and §206.
 *
 * Pure.
 */

const REFRESH: readonly ActionDeclaration[] = [
  { id: 'recompute', summary: 'Work it out again with the current values', takes: [], idempotent: true, destructive: false }
]

// ---------------------------------------------------------------- molecular explorer

const MOLECULE_LAB: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'molecule',
    name: 'Molecule',
    kind: 'choice',
    initial: 'water',
    about: 'Which molecule to build. Each one is constructed atom by atom and valence-checked, not drawn.',
    // Straight from the engine, so the list cannot offer a molecule it cannot build.
    options: KNOWN.map((one) => ({ id: one.id, label: one.name })),
    group: 'Molecule'
  },
  {
    id: 'style',
    name: 'Drawn as',
    kind: 'choice',
    initial: 'ball-and-stick',
    about: 'Ball-and-stick shows the bonds; space-filling shows roughly how much room the atoms take up.',
    options: [
      { id: 'ball-and-stick', label: 'ball and stick' },
      { id: 'space-filling', label: 'space filling' },
      { id: 'wireframe', label: 'wireframe' }
    ],
    group: 'View'
  },
  {
    id: 'spin',
    name: 'Rotate',
    kind: 'number',
    initial: 25,
    about: 'Turn the molecule about the vertical axis.',
    unit: 'deg',
    least: -180,
    most: 180,
    step: 1,
    places: 0,
    group: 'View'
  },
  {
    id: 'tilt',
    name: 'Tilt',
    kind: 'number',
    initial: 15,
    about: 'Tilt it towards or away from you.',
    unit: 'deg',
    least: -90,
    most: 90,
    step: 1,
    places: 0,
    group: 'View'
  },
  {
    id: 'labels',
    name: 'Label the atoms',
    kind: 'boolean',
    initial: true,
    about: 'Show each atom’s symbol.',
    group: 'View'
  },
  {
    id: 'showLonePairs',
    name: 'Show lone pairs',
    kind: 'boolean',
    initial: false,
    about: 'Mark the non-bonding electron pairs, which are what bend water and make ammonia a pyramid.',
    group: 'View'
  }
]

// ---------------------------------------------------------------- ecosystem

const ECOSYSTEM_LAB: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'model',
    name: 'Model',
    kind: 'choice',
    initial: 'predator-prey',
    about: 'Which population model to run. Each is a named set of equations, not a generic simulation.',
    options: [
      { id: 'predator-prey', label: 'predator and prey (Lotka-Volterra)' },
      { id: 'logistic', label: 'logistic growth, with a carrying capacity' },
      { id: 'exponential', label: 'exponential growth, unlimited' }
    ],
    group: 'Model'
  },
  { id: 'prey', name: 'Prey at the start', kind: 'number', initial: 40, about: 'How many prey there are to begin with.', least: 0, most: 1e6, places: 2, group: 'Starting state' },
  {
    id: 'predators',
    name: 'Predators at the start',
    kind: 'number',
    initial: 9,
    about: 'How many predators there are to begin with.',
    least: 0,
    most: 1e6,
    places: 2,
    shownWhen: [{ id: 'model', is: 'predator-prey' }],
    group: 'Starting state'
  },
  {
    id: 'preyGrowth',
    name: 'Prey birth rate',
    kind: 'number',
    initial: 0.6,
    about: 'How fast the prey breed when nothing is eating them. Per unit time.',
    least: 0,
    most: 10,
    places: 4,
    group: 'Rates'
  },
  {
    id: 'predation',
    name: 'Predation rate',
    kind: 'number',
    initial: 0.03,
    about: 'How often a meeting between a predator and a prey ends badly for the prey.',
    least: 0,
    most: 10,
    places: 4,
    shownWhen: [{ id: 'model', is: 'predator-prey' }],
    group: 'Rates'
  },
  {
    id: 'predatorDeath',
    name: 'Predator death rate',
    kind: 'number',
    initial: 0.4,
    about: 'How fast predators die out with nothing to eat.',
    least: 0,
    most: 10,
    places: 4,
    shownWhen: [{ id: 'model', is: 'predator-prey' }],
    group: 'Rates'
  },
  {
    id: 'conversion',
    name: 'Conversion efficiency',
    kind: 'number',
    initial: 0.02,
    about: 'How much of what a predator eats becomes new predators.',
    least: 0,
    most: 10,
    places: 4,
    shownWhen: [{ id: 'model', is: 'predator-prey' }],
    group: 'Rates'
  },
  {
    id: 'capacity',
    name: 'Carrying capacity',
    kind: 'number',
    initial: 500,
    about: 'The largest population the environment can support.',
    least: 1,
    most: 1e9,
    places: 2,
    shownWhen: [{ id: 'model', is: 'logistic' }],
    group: 'Rates'
  },
  { id: 'until', name: 'Run for', kind: 'number', initial: 60, about: 'How long to simulate, in the model’s own time units.', unit: 's', least: 0.1, most: 10_000, places: 2, group: 'Run' },
  {
    id: 'step',
    name: 'Timestep',
    kind: 'number',
    initial: 0.01,
    about: 'How big a step the solver takes. Too large and the answer drifts, which the stability check reports.',
    unit: 's',
    least: 1e-6,
    most: 1,
    places: 6,
    group: 'Run'
  },
  {
    id: 'method',
    name: 'Solver',
    kind: 'choice',
    initial: 'rk4',
    about: 'Which integration method. Euler is simple and drifts; RK4 is far more accurate for the same step.',
    options: [
      { id: 'euler', label: 'Euler — simplest, drifts most' },
      { id: 'rk4', label: 'Runge-Kutta 4 — accurate' },
      { id: 'adaptive', label: 'adaptive — chooses its own step' }
    ],
    group: 'Run'
  }
]

// ---------------------------------------------------------------- field laboratory

const FIELD_LAB: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'kind',
    name: 'Field',
    kind: 'choice',
    initial: 'electric',
    about: 'Which field to map. Both are inverse-square, and the difference is that charge can be negative.',
    options: [
      { id: 'electric', label: 'electric, from point charges' },
      { id: 'gravitational', label: 'gravitational, from masses' }
    ],
    group: 'Field'
  },
  {
    id: 'sources',
    name: 'Sources',
    kind: 'text',
    initial: '1 -2 0; -1 2 0',
    about: 'One per line or separated by semicolons: strength, then x and y. A negative strength is a negative charge.',
    group: 'Field'
  },
  { id: 'extent', name: 'Half-width', kind: 'number', initial: 5, about: 'How far from the centre to map, each way.', unit: 'm', least: 0.1, most: 1_000, places: 3, group: 'View' },
  {
    id: 'resolution',
    name: 'Grid',
    kind: 'integer',
    initial: 17,
    about: 'How many samples across. More is finer and slower; this is a real computation at every point.',
    least: 3,
    most: 81,
    group: 'View'
  },
  {
    id: 'show',
    name: 'Show',
    kind: 'choice',
    initial: 'vectors',
    about: 'Arrows for direction and strength, or shading for the potential.',
    options: [
      { id: 'vectors', label: 'field arrows' },
      { id: 'potential', label: 'potential, shaded' },
      { id: 'both', label: 'both' }
    ],
    group: 'View'
  },
  {
    id: 'normalise',
    name: 'Equal-length arrows',
    kind: 'boolean',
    initial: true,
    about: 'Draw every arrow the same length so the direction is readable near a source, where the strength would swamp everything else.',
    group: 'View'
  }
]

// ---------------------------------------------------------------- DNA

const DNA_LAB: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'sequence',
    name: 'Sequence',
    kind: 'text',
    initial: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG',
    about: 'A DNA sequence. Only A, T, G and C; anything else is reported rather than ignored.',
    group: 'Sequence'
  },
  {
    id: 'frame',
    name: 'Reading frame',
    kind: 'integer',
    initial: 1,
    about: 'Which of the three forward frames to read. Shifting it by one changes every codon after it — which is what a frameshift mutation does.',
    // 1, 2 or 3, which is the convention the genetics engine uses and what biology writes.
    least: 1,
    most: 3,
    group: 'Translation'
  },
  {
    id: 'mutateAt',
    name: 'Change the base at',
    kind: 'integer',
    initial: 0,
    about: 'Position to alter, counting from 1. Zero leaves the sequence alone.',
    least: 0,
    most: 100_000,
    group: 'Mutation'
  },
  {
    id: 'mutateTo',
    name: 'Change it to',
    kind: 'choice',
    initial: 'A',
    about: 'Which base to put there.',
    options: [
      { id: 'A', label: 'A — adenine' },
      { id: 'T', label: 'T — thymine' },
      { id: 'G', label: 'G — guanine' },
      { id: 'C', label: 'C — cytosine' }
    ],
    shownWhen: [{ id: 'mutationKind', is: 'substitution' }],
    group: 'Mutation'
  },
  {
    id: 'mutationKind',
    name: 'Kind of change',
    kind: 'choice',
    initial: 'substitution',
    about: 'A substitution swaps one base. An insertion or a deletion shifts everything after it.',
    options: [
      { id: 'substitution', label: 'substitution — swap one base' },
      { id: 'insertion', label: 'insertion — add a base' },
      { id: 'deletion', label: 'deletion — remove a base' }
    ],
    group: 'Mutation'
  }
]

export const PHASE3_PARAMETERS: Readonly<Record<string, ParameterSet>> = Object.freeze(
  (() => {
    const out: Record<string, ParameterSet> = {}
    const sets: readonly (readonly [string, readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[]])[] = [
      ['molecule-lab', MOLECULE_LAB],
      ['ecosystem-lab', ECOSYSTEM_LAB],
      ['field-lab', FIELD_LAB],
      ['dna-lab', DNA_LAB]
    ]
    for (const [id, list] of sets) {
      const made = declareAll(list)
      if (Array.isArray(made)) {
        const first = made.find(isParameterProblem)
        throw new Error(`Parameters for "${id}" are not valid: ${first ? `${first.id} — ${first.says}` : 'unknown problem'}`)
      }
      out[id] = made
    }
    return out
  })()
)

// ---------------------------------------------------------------- the manifests

export const PHASE3_CATALOGUE: readonly NativeAppManifest[] = Object.freeze([
  {
    id: 'molecule-lab',
    name: 'Molecular Explorer',
    summary: 'Build a molecule atom by atom, turn it in three dimensions, and see its shape, mass and polarity worked out.',
    version: 1,
    domain: 'chemistry',
    icon: 'circle-dot',
    aliases: ['molecule', 'molecular explorer', 'molecule builder', 'build a molecule', 'vsepr', 'molecular geometry', 'water molecule'],
    tags: ['molecule', 'atom', 'bond', 'geometry', 'vsepr', 'polarity', 'valence', 'formula', 'molar mass', 'lone pair', 'tetrahedral', 'chemistry'],
    capabilities: [
      { id: 'exploreMolecule', summary: 'show a molecule in three dimensions with its shape and properties' },
      { id: 'buildMolecule', summary: 'add and remove atoms and bonds, with the chemistry checked' },
      { id: 'molecularGeometry', summary: 'work out a molecule’s shape and bond angles' },
      { id: 'molecularPolarity', summary: 'work out whether a molecule has a dipole' }
    ],
    surface: { kind: 'native', ref: 'MoleculeLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'continue',
    parameters: Object.keys(PHASE3_PARAMETERS['molecule-lab']),
    actions: [
      ...REFRESH,
      { id: 'addAtom', summary: 'Add an atom', takes: [], idempotent: false, destructive: false },
      { id: 'removeSelected', summary: 'Remove what is selected', takes: [], idempotent: false, destructive: true }
    ],
    accepts: ['text'],
    produces: ['table', 'text'],
    permissions: ['compute'],
    persists: true,
    engine: 'molecules',
    limitations: [
      'The shape comes from VSEPR and the positions from covalent radii — a visualisation, not energy minimisation, so rings lie flat and a large molecule looks approximate.',
      'The bond angles shown as idealised are the VSEPR ones; where a measured angle is known it is given separately and labelled, because water is 104.5° and not 109.5°.',
      'Valence is checked by the octet and common-valence rules. A transition metal is reported as unchecked rather than judged by a rule that does not apply to it.',
      'Whether a whole molecule is polar is only stated where symmetry settles it. Otherwise it says it cannot be decided from connectivity alone.'
    ]
  },
  {
    id: 'ecosystem-lab',
    name: 'Population Laboratory',
    summary: 'Run a real population model — predator and prey, or logistic growth — and watch the cycles it produces.',
    version: 1,
    domain: 'biology',
    icon: 'activity',
    aliases: ['ecosystem', 'predator prey', 'lotka volterra', 'population', 'population dynamics', 'logistic growth'],
    tags: ['ecosystem', 'predator', 'prey', 'population', 'lotka-volterra', 'logistic', 'carrying capacity', 'growth', 'cycle', 'phase space', 'biology'],
    capabilities: [
      { id: 'simulateEcosystem', summary: 'run a predator and prey model and show both populations over time' },
      { id: 'simulatePopulation', summary: 'run a growth model with or without a carrying capacity' },
      { id: 'showPhaseSpace', summary: 'plot one population against the other to show the cycle' }
    ],
    surface: { kind: 'native', ref: 'EcosystemLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE3_PARAMETERS['ecosystem-lab']),
    actions: REFRESH,
    accepts: ['numbers'],
    produces: ['series', 'table', 'numbers'],
    permissions: ['compute'],
    persists: true,
    engine: 'compute',
    limitations: [
      'Lotka-Volterra is a deliberately simple model: no age structure, no space, no other species, and prey grow without limit when predators are absent. It shows why populations cycle, not what any real population will do.',
      'The solver reports when it diverges or when the timestep is too large, rather than drawing a smooth curve that is wrong.',
      'Populations are continuous numbers, so a value below one is a fraction of an animal. Treat extinction as "effectively gone", which the laboratory says.'
    ]
  },
  {
    id: 'field-lab',
    name: 'Field Laboratory',
    summary: 'Map the electric or gravitational field around several sources, computed at every point on the grid.',
    version: 1,
    domain: 'physics',
    icon: 'zap',
    aliases: ['electric field', 'field lines', 'gravitational field', 'electrostatics', 'point charge', 'equipotential'],
    tags: ['field', 'electric', 'gravitational', 'charge', 'mass', 'potential', 'equipotential', 'vector field', 'inverse square', 'coulomb', 'physics'],
    capabilities: [
      { id: 'simulateElectricField', summary: 'map the electric field and potential around point charges' },
      { id: 'simulateGravitationalField', summary: 'map the gravitational field around masses' },
      { id: 'showFieldMap', summary: 'draw a vector field and its potential' }
    ],
    surface: { kind: 'native', ref: 'FieldLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'continue',
    parameters: Object.keys(PHASE3_PARAMETERS['field-lab']),
    actions: REFRESH,
    accepts: ['numbers'],
    produces: ['table', 'numbers'],
    permissions: ['compute'],
    persists: true,
    engine: 'compute',
    limitations: [
      'Point sources in a plane. No conductors, no dielectrics and no induced charge, so a field near a metal surface is not what this shows.',
      'The field at a source itself is infinite, so those grid points are left out rather than given a made-up value.',
      'Equal-length arrows make the direction readable and hide how fast the strength falls. The shaded potential is the honest picture of magnitude.'
    ]
  },
  {
    id: 'dna-lab',
    name: 'DNA Laboratory',
    summary: 'Read a DNA sequence, find its reading frames, translate it, and see what a single mutation does to the protein.',
    version: 1,
    domain: 'biology',
    icon: 'hash',
    aliases: ['dna', 'sequence', 'codon', 'translation', 'transcription', 'mutation', 'reverse complement', 'genetics'],
    tags: ['dna', 'rna', 'sequence', 'codon', 'translate', 'protein', 'amino acid', 'mutation', 'frameshift', 'reading frame', 'gc content', 'complement', 'biology'],
    capabilities: [
      { id: 'exploreDNA', summary: 'read a DNA sequence and report its composition and complement' },
      { id: 'translateSequence', summary: 'translate a sequence into amino acids in any reading frame' },
      { id: 'simulateMutation', summary: 'change a base and show what it does to the protein' }
    ],
    surface: { kind: 'native', ref: 'DnaLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'continue',
    parameters: Object.keys(PHASE3_PARAMETERS['dna-lab']),
    actions: [...REFRESH, { id: 'mutate', summary: 'Apply the mutation', takes: [], idempotent: true, destructive: false }],
    accepts: ['text'],
    produces: ['text', 'table'],
    permissions: ['compute'],
    persists: true,
    engine: 'compute',
    limitations: [
      'The standard genetic code. Mitochondrial and alternative codes differ, and are not offered.',
      'Translation is from the sequence as given: it does not look for a promoter, splice introns or model regulation.',
      'A protein consequence is what the codon table says. Whether a change matters to an organism is biology this does not model.'
    ]
  }
])

export const PHASE3_BY_ID: Readonly<Record<string, NativeAppManifest>> = Object.freeze(
  Object.fromEntries(PHASE3_CATALOGUE.map((one) => [one.id, one]))
)
