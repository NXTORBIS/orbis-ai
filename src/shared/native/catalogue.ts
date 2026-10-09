import { declareAll, isParameterProblem, type Parameter, type ParameterSet } from './parameters.ts'
import type { ActionDeclaration, AppDomain, AppPermission, AppSize, DataKind, NativeAppManifest, WhenHidden } from './manifest.ts'

/**
 * The Native Apps Orbis actually has.
 *
 * ## Every one of these already exists and already works
 *
 * Nothing in this file is a placeholder, a "coming soon" row, or an app waiting for an engine. Each entry is a surface
 * that is already in the build and already computes through `shared/compute` — the thirty-seven Pages Orbis ships, plus
 * the Creation Engine's flowchart. The whole point of the native layer is that registering them costs no new UI: a
 * manifest here makes an existing laboratory findable by capability, launchable by Orion, and mountable in a
 * conversation.
 *
 * So there is no Physics Lab entry promising a particle engine, because that engine is Phase 3. Registering it now
 * would make Search Labs findable and then fail, which is worse than not being there.
 *
 * ## Configurable means configurable
 *
 * Most of these Pages keep their own inputs in their own state, which is correct and is not being rewritten. For those,
 * `parameters` is empty and `limitations` says so plainly — Orion can open them and cannot set their values, and that
 * is stated rather than discovered.
 *
 * Four are wired to the parameter system end to end, so "open projectile motion at 30 m/s and 45 degrees" genuinely
 * works rather than being an architecture diagram: `projectile-lab`, `motion-lab`, `function-plotter` and
 * `statistics-lab`. They are the four most likely to be asked for with values, and wiring them proves the pipeline
 * with real engines instead of a demo one. Migrating the rest is a per-app change that touches nothing here but the
 * parameter list.
 *
 * ## Identity
 *
 * An app's id is its Page slug. Deliberately: the Pages registry already owns that identity across installs and
 * profiles, and inventing a second id per app is how the two registries would eventually disagree about which app
 * somebody's saved state belongs to.
 *
 * Pure. No React, no Electron.
 */

// ---------------------------------------------------------------- helpers

interface Draft {
  id: string
  name: string
  summary: string
  domain: AppDomain
  icon: string
  aliases?: readonly string[]
  tags: readonly string[]
  can: readonly (readonly [string, string])[]
  surface?: { kind: 'page' | 'native' | 'artifact'; ref: string }
  opensAt?: AppSize
  largest?: AppSize
  whenHidden?: WhenHidden
  parameters?: readonly string[]
  actions?: readonly ActionDeclaration[]
  accepts?: readonly DataKind[]
  produces?: readonly DataKind[]
  permissions?: readonly AppPermission[]
  persists?: boolean
  engine?: string | null
  limitations: readonly string[]
}

/**
 * A draft filled out into a manifest.
 *
 * The defaults are the honest ones for a Page: it opens expanded because a laboratory at message width is unusable, it
 * keeps running when hidden because none of these has a clock, it reaches the engines and nothing else, and its state
 * is not worth keeping across restarts unless it says so.
 */
const app = (draft: Draft): NativeAppManifest => ({
  id: draft.id,
  name: draft.name,
  summary: draft.summary,
  version: 1,
  domain: draft.domain,
  icon: draft.icon,
  aliases: draft.aliases ?? [],
  tags: draft.tags,
  capabilities: draft.can.map(([id, summary]) => ({ id, summary })),
  surface: draft.surface ?? { kind: 'page', ref: draft.id },
  opensAt: draft.opensAt ?? 'expanded',
  largest: draft.largest ?? 'workspace',
  whenHidden: draft.whenHidden ?? 'continue',
  parameters: draft.parameters ?? [],
  actions: draft.actions ?? [],
  accepts: draft.accepts ?? [],
  produces: draft.produces ?? [],
  permissions: draft.permissions ?? ['compute'],
  persists: draft.persists ?? false,
  engine: draft.engine ?? 'compute',
  limitations: draft.limitations
})

/** Said once, because it is true of every Page that keeps its inputs in its own state. */
const OWNS_ITS_INPUTS = 'Orion can open it, and cannot set its values from a sentence — type them in.'

// ---------------------------------------------------------------- parameters, for the four that are wired

const PROJECTILE: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'speed',
    name: 'Launch speed',
    kind: 'number',
    initial: 40,
    about: 'How fast it leaves the launch point.',
    unit: 'm/s',
    least: 0,
    most: 100_000,
    step: 1,
    places: 2,
    group: 'Launch'
  },
  {
    id: 'angle',
    name: 'Angle above horizontal',
    kind: 'number',
    initial: 45,
    about: 'Zero is flat; ninety is straight up.',
    unit: 'deg',
    least: -90,
    most: 90,
    step: 1,
    places: 1,
    group: 'Launch'
  },
  {
    id: 'height',
    name: 'Launch height',
    kind: 'number',
    initial: 0,
    about: 'How far above the ground it starts.',
    unit: 'm',
    least: 0,
    most: 100_000,
    places: 2,
    group: 'Launch'
  },
  {
    id: 'gravity',
    name: 'Gravity',
    kind: 'number',
    initial: 9.81,
    about: 'Earth is 9.81; Mars is 3.71; the Moon is 1.62.',
    unit: 'm/s^2',
    // Zero gravity makes the flight infinite, so the floor is above it rather than at it.
    least: 0.001,
    most: 1_000,
    places: 3,
    group: 'Environment'
  },
  {
    id: 'drag',
    name: 'Air resistance',
    kind: 'choice',
    initial: 'quadratic',
    about: 'None is the textbook case; quadratic is what air actually does at these speeds.',
    options: [
      { id: 'none', label: 'none — the ideal case' },
      { id: 'linear', label: 'linear — slow and small' },
      { id: 'quadratic', label: 'quadratic — ordinary speeds in air' }
    ],
    group: 'Environment'
  },
  {
    id: 'coefficient',
    name: 'Drag coefficient',
    kind: 'number',
    initial: 0.01,
    about: 'How strongly the air pushes back.',
    least: 0,
    most: 10,
    places: 4,
    // Hidden until air resistance is switched on: a drag coefficient beside "none" is a control that does nothing.
    shownWhen: [{ id: 'drag', is: 'quadratic' }],
    group: 'Environment'
  },
  {
    id: 'mass',
    name: 'Mass',
    kind: 'number',
    initial: 1,
    about: 'Only matters once there is air resistance.',
    unit: 'kg',
    least: 0.000001,
    most: 1_000_000,
    places: 3,
    group: 'Environment'
  }
]

/*
 * Motion Lab's real inputs: a sequence of phases, each with a duration and an acceleration, plus where it starts.
 *
 * Written against what the component actually has rather than against the textbook suvat variables, because a
 * parameter that does not correspond to a field is a parameter nothing can apply.
 */
const MOTION: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'durations',
    name: 'Phase durations',
    kind: 'numbers',
    initial: [5, 5, 10],
    about: 'How long each phase of the motion lasts, in order.',
    mostValues: 200,
    group: 'Phases'
  },
  {
    id: 'accelerations',
    name: 'Phase accelerations',
    kind: 'numbers',
    initial: [2, 0, -1],
    about: 'The acceleration during each phase, in the same order.',
    mostValues: 200,
    group: 'Phases'
  },
  { id: 'velocity', name: 'Starting speed', kind: 'number', initial: 0, about: 'Speed at time zero.', unit: 'm/s', least: -100_000, most: 100_000, places: 3 },
  { id: 'position', name: 'Starting position', kind: 'number', initial: 0, about: 'Where it begins.', unit: 'm', least: -1e9, most: 1e9, places: 3 }
]

/* Function Plotter's real inputs. `second` only means anything in parametric mode, which is why it is conditional. */
const PLOTTER: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'mode',
    name: 'Kind of plot',
    kind: 'choice',
    initial: 'function',
    about: 'An ordinary function of x, a parametric pair, or a polar curve.',
    options: [
      { id: 'function', label: 'function of x' },
      { id: 'parametric', label: 'parametric' },
      { id: 'polar', label: 'polar' }
    ]
  },
  { id: 'expression', name: 'Expression', kind: 'expression', initial: 'sin(x) / x', about: 'In terms of x, e.g. x^2 - 3*x + 1.' },
  {
    id: 'second',
    name: 'Second expression',
    kind: 'expression',
    initial: 'sin(t)',
    about: 'The y part of a parametric pair.',
    shownWhen: [{ id: 'mode', is: 'parametric' }]
  },
  { id: 'from', name: 'From', kind: 'number', initial: -20, about: 'The left edge of the range.', least: -1e9, most: 1e9, places: 4 },
  { id: 'to', name: 'To', kind: 'number', initial: 20, about: 'The right edge of the range.', least: -1e9, most: 1e9, places: 4 }
]

/* Statistics Lab's real inputs: the numbers, a value to test against, and a second set to compare with. */
const STATISTICS: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'text',
    name: 'Values',
    kind: 'numbers',
    initial: [12, 15, 11, 18, 14, 16, 13, 22, 15, 14, 17, 13],
    about: 'The numbers to describe.',
    mostValues: 50_000
  },
  { id: 'against', name: 'Compare against', kind: 'number', initial: 15, about: 'The value a one-sample test is against.', least: -1e12, most: 1e12, places: 4 },
  {
    id: 'other',
    name: 'Second set',
    kind: 'numbers',
    initial: [19, 21, 18, 24, 20, 22, 19, 25],
    about: 'A second set of numbers, for a two-sample comparison.',
    mostValues: 50_000
  }
]

const RUN_ACTIONS: readonly ActionDeclaration[] = [
  { id: 'recompute', summary: 'Work it out again with the current values', takes: [], idempotent: true, destructive: false }
]

/** Parameter sets by app id. Only the four that are wired have one. */

// ---------------------------------------------------------------- the mathematics laboratories

/*
 * Each of these laboratories already keeps its inputs as text, which is correct for a field somebody types in. So
 * the parameters below are mostly `text` rather than `number`: a parameter declared as a number would be handed to
 * the laboratory as a number and immediately turned back into a string, and the range check would have to duplicate
 * one the engine already does better. Where a value really is a bounded number — a polynomial degree, an angle — it
 * is declared as one and the runtime refuses an impossible value before the engine ever sees it.
 *
 * Every id here matches the state variable the laboratory reads from `initial`. A mismatch would show a control that
 * silently did nothing, so the runtime probe checks each one by setting it and reading it back.
 */

const CONVERTER: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  { id: 'value', name: 'Amount', kind: 'text', initial: '36', about: 'The quantity to convert.', group: 'Convert' },
  { id: 'from', name: 'From', kind: 'text', initial: 'km/h', about: 'The unit it is in now.', group: 'Convert' },
  { id: 'to', name: 'To', kind: 'text', initial: 'm/s', about: 'The unit to put it in. A different kind of quantity is refused rather than guessed at.', group: 'Convert' }
]

const SOLVER: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'text',
    name: 'Equation',
    kind: 'text',
    initial: 'x^2 + 3x + 2 = 0',
    about: 'The equation to solve. Several separated by semicolons are solved together as a system.',
    group: 'Solve'
  }
]

const CALCULUS: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  { id: 'text', name: 'Expression', kind: 'text', initial: 'sin(x^2)', about: 'The expression to differentiate.', group: 'Differentiate' },
  { id: 'variable', name: 'With respect to', kind: 'text', initial: 'x', about: 'Which letter is the variable.', group: 'Differentiate' },
  { id: 'at', name: 'Worked out at', kind: 'text', initial: '1', about: 'Where to evaluate the result. Leave it empty for the expression alone.', group: 'Differentiate' }
]

const ALGEBRA: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'coefficients',
    name: 'Coefficients',
    kind: 'text',
    initial: '-6, 1, 1',
    about: 'The polynomial, lowest power first. So -6, 1, 1 is x² + x − 6.',
    group: 'Polynomial'
  },
  { id: 'decimal', name: 'Decimal to turn into a fraction', kind: 'text', initial: '0.142857142857', about: 'A repeating decimal becomes the fraction it really is.', group: 'Fractions' }
]

const MATRIX: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'text',
    name: 'Matrix',
    kind: 'text',
    initial: '2 1\n1 3',
    about: 'One row per line, values separated by spaces.',
    group: 'Matrix'
  },
  { id: 'rhs', name: 'Right-hand side', kind: 'text', initial: '5, 10', about: 'The vector to solve against, for a system of equations.', group: 'Matrix' }
]

const GEOMETRY: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  { id: 'a', name: 'First point', kind: 'text', initial: '0, 0', about: 'As x, y.', group: 'Triangle' },
  { id: 'b', name: 'Second point', kind: 'text', initial: '4, 0', about: 'As x, y.', group: 'Triangle' },
  { id: 'c', name: 'Third point', kind: 'text', initial: '0, 3', about: 'As x, y. Three points in a line are refused rather than given an area of nothing.', group: 'Triangle' }
]

const NUMBERS: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'value',
    name: 'Number',
    kind: 'text',
    initial: '2305843009213693951',
    about: 'The number to look at. Kept as text because these get larger than a double can hold exactly.',
    group: 'Number'
  }
]

const UNCERTAINTY: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'model',
    name: 'Formula',
    kind: 'text',
    initial: 'a * b',
    about: 'How the measurements combine. The uncertainty is propagated through it rather than estimated.',
    group: 'Propagate'
  }
]

const SIGNALS: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  { id: 'rate', name: 'Samples per second', kind: 'text', initial: '128', about: 'The sampling rate. This decides which frequencies can be seen at all.', group: 'Signal' },
  {
    id: 'window',
    name: 'Window',
    kind: 'choice',
    initial: 'hann',
    about: 'Which window to apply before the transform. Each one trades sharpness against leakage.',
    options: [
      { id: 'rectangular', label: 'none (rectangular)' },
      { id: 'hann', label: 'Hann' },
      { id: 'hamming', label: 'Hamming' },
      { id: 'blackman', label: 'Blackman' },
      { id: 'blackman-harris', label: 'Blackman-Harris' },
      { id: 'flat-top', label: 'flat top' }
    ],
    group: 'Signal'
  }
]

const FITTER: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  { id: 'xs', name: 'x values', kind: 'text', initial: '1, 2, 3, 4, 5, 6, 7, 8', about: 'Separated by commas.', group: 'Data' },
  { id: 'ys', name: 'y values', kind: 'text', initial: '2.1, 4.4, 9.1, 15.8, 25.2, 36.1, 49.4, 63.8', about: 'The same number of values as x.', group: 'Data' },
  {
    id: 'family',
    name: 'Fit',
    kind: 'choice',
    initial: 'polynomial',
    about: 'Which shape of curve to fit. The fit reports how well it did rather than claiming it worked.',
    options: [
      { id: 'polynomial', label: 'polynomial' },
      { id: 'exponential', label: 'exponential' },
      { id: 'power', label: 'power law' },
      { id: 'logarithmic', label: 'logarithmic' },
      { id: 'logistic', label: 'logistic' }
    ],
    group: 'Fit'
  },
  {
    id: 'degree',
    name: 'Degree',
    kind: 'text',
    initial: '2',
    about: 'For a polynomial. A degree close to the number of points fits the noise rather than the data.',
    // Only a polynomial has a degree, so it is hidden otherwise rather than sitting there doing nothing.
    shownWhen: [{ id: 'family', is: 'polynomial' }],
    group: 'Fit'
  }
]

const COORDINATES: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  { id: 'point', name: 'Point', kind: 'text', initial: '1, 1, 1', about: 'As x, y, z.', group: 'Point' },
  {
    id: 'convention',
    name: 'Convention',
    kind: 'choice',
    initial: 'physics',
    about: 'Which angle is which. Physics and mathematics swap them, which is the usual cause of a wrong answer here.',
    options: [
      { id: 'physics', label: 'physics (θ from the z axis)' },
      { id: 'maths', label: 'mathematics (θ in the x-y plane)' }
    ],
    group: 'Point'
  },
  {
    id: 'unit',
    name: 'Angles in',
    kind: 'choice',
    initial: 'degrees',
    about: 'Degrees or radians.',
    options: [
      { id: 'degrees', label: 'degrees' },
      { id: 'radians', label: 'radians' }
    ],
    group: 'Point'
  }
]

export const PARAMETERS: Readonly<Record<string, ParameterSet>> = Object.freeze(
  (() => {
    const out: Record<string, ParameterSet> = {}
    const sets: readonly (readonly [string, readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[]])[] = [
      ['projectile-lab', PROJECTILE],
      ['motion-lab', MOTION],
      ['function-plotter', PLOTTER],
      ['statistics-lab', STATISTICS],
      ['unit-converter', CONVERTER],
      ['equation-solver', SOLVER],
      ['calculus-lab', CALCULUS],
      ['algebra-lab', ALGEBRA],
      ['matrix-lab', MATRIX],
      ['geometry-lab', GEOMETRY],
      ['number-lab', NUMBERS],
      ['uncertainty-lab', UNCERTAINTY],
      ['signal-lab', SIGNALS],
      ['curve-fitter', FITTER],
      ['coordinate-lab', COORDINATES]
    ]
    for (const [id, list] of sets) {
      const made = declareAll(list)
      // A bad parameter list here is a programming error in this file, and failing loudly at import is the only way it
      // gets found before an app opens with half a configuration.
      if (Array.isArray(made)) {
        const first = made.find(isParameterProblem)
        throw new Error(`Parameters for "${id}" are not valid: ${first ? `${first.id} — ${first.says}` : 'unknown problem'}`)
      }
      out[id] = made
    }
    return out
  })()
)

export const parametersFor = (appId: string): ParameterSet =>
  Object.prototype.hasOwnProperty.call(PARAMETERS, appId) ? PARAMETERS[appId] : Object.freeze({})

// ---------------------------------------------------------------- the catalogue

export const CATALOGUE: readonly NativeAppManifest[] = Object.freeze([
  // ------------------------------------------------ mathematics
  app({
    id: 'unit-converter',
    name: 'Unit Converter',
    summary: 'Convert between units, with the dimensions checked rather than assumed.',
    domain: 'mathematics',
    icon: 'ruler',
    aliases: ['conversion', 'convert units', 'metric to imperial'],
    tags: ['convert', 'units', 'metric', 'imperial', 'temperature', 'dimensions'],
    can: [
      ['convertUnits', 'convert a quantity from one unit to another'],
      ['checkDimensions', 'say whether two units measure the same kind of thing']
    ],
    opensAt: 'compact',
    largest: 'expanded',
    produces: ['numbers'],
    parameters: Object.keys(PARAMETERS['unit-converter']),
    limitations: ['It refuses a conversion between different kinds of quantity rather than guessing.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'equation-solver',
    name: 'Equation Solver',
    summary: 'Solve equations and systems, exactly where that is possible and numerically where it is not.',
    domain: 'mathematics',
    icon: 'equal',
    aliases: ['solve', 'roots', 'simultaneous equations'],
    tags: ['solve', 'equation', 'quadratic', 'polynomial', 'roots', 'simultaneous', 'linear'],
    can: [
      ['solveEquation', 'find the values that satisfy an equation'],
      ['solveSystem', 'solve several equations together']
    ],
    produces: ['numbers', 'expression'],
    parameters: Object.keys(PARAMETERS['equation-solver']),
    limitations: ['It says when a solution is numerical rather than exact.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'calculus-lab',
    name: 'Calculus Laboratory',
    summary: 'Differentiate, simplify and substitute, showing the expression at each step.',
    domain: 'mathematics',
    icon: 'sigma',
    aliases: ['derivative', 'differentiate', 'symbolic maths'],
    tags: ['derivative', 'calculus', 'simplify', 'expression', 'substitute', 'chain rule'],
    can: [
      ['differentiate', 'work out a derivative symbolically'],
      ['simplifyExpression', 'reduce an expression to a simpler form']
    ],
    accepts: ['expression'],
    produces: ['expression'],
    parameters: Object.keys(PARAMETERS['calculus-lab']),
    limitations: ['It differentiates; it does not integrate symbolically.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'function-plotter',
    name: 'Function Plotter',
    summary: 'Draw a function over a range, in Cartesian, polar or parametric form.',
    domain: 'mathematics',
    icon: 'line-chart',
    aliases: ['graph', 'plot', 'draw a function', 'grapher'],
    tags: ['plot', 'graph', 'function', 'curve', 'sine', 'parabola', 'polar', 'parametric'],
    can: [
      ['plotFunction', 'draw a function over a range'],
      ['sampleFunction', 'work out a function at a set of points']
    ],
    parameters: ['mode', 'expression', 'second', 'from', 'to'],
    actions: RUN_ACTIONS,
    accepts: ['expression'],
    produces: ['series', 'image'],
    limitations: [
      'It draws what the expression engine can evaluate, and says so when a point cannot be worked out.',
      'A range with no finite points in it is reported rather than drawn as an empty chart.'
    ]
  }),
  app({
    id: 'algebra-lab',
    name: 'Algebra Lab',
    summary: 'Expand, factorise and rearrange expressions step by step.',
    domain: 'mathematics',
    icon: 'braces',
    aliases: ['expand', 'factorise', 'rearrange'],
    tags: ['algebra', 'expand', 'factor', 'polynomial', 'rearrange', 'identity'],
    can: [['manipulateAlgebra', 'expand, factorise or rearrange an expression']],
    accepts: ['expression'],
    produces: ['expression'],
    parameters: Object.keys(PARAMETERS['algebra-lab']),
    limitations: ['It works on polynomials and rational expressions, not on arbitrary symbolic forms.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'matrix-lab',
    name: 'Matrix Lab',
    summary: 'Multiply, invert, decompose and find eigenvalues, with the conditioning reported.',
    domain: 'mathematics',
    icon: 'grid-3x3',
    aliases: ['linear algebra', 'eigenvalues', 'matrices'],
    tags: ['matrix', 'determinant', 'inverse', 'eigenvalue', 'linear algebra', 'decomposition', 'rank'],
    can: [
      ['matrixArithmetic', 'multiply, invert or decompose a matrix'],
      ['eigenvalues', 'find eigenvalues and eigenvectors']
    ],
    accepts: ['table', 'numbers'],
    produces: ['table', 'numbers'],
    parameters: Object.keys(PARAMETERS['matrix-lab']),
    limitations: ['It reports when a matrix is near-singular instead of returning an inverse nobody should trust.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'geometry-lab',
    name: 'Geometry Lab',
    summary: 'Distances, angles, areas, intersections and transformations in two and three dimensions.',
    domain: 'mathematics',
    icon: 'triangle',
    aliases: ['geometry', 'distance', 'intersection'],
    tags: ['geometry', 'distance', 'angle', 'area', 'volume', 'intersection', 'transform', 'polygon'],
    can: [['computeGeometry', 'work out a distance, angle, area or intersection']],
    produces: ['numbers'],
    parameters: Object.keys(PARAMETERS['geometry-lab']),
    limitations: ['It computes geometry; it is not a drawing canvas.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'number-lab',
    name: 'Number and Graph Lab',
    summary: 'Primes, factors, modular arithmetic, and graph algorithms over small graphs.',
    domain: 'mathematics',
    icon: 'hash',
    aliases: ['number theory', 'primes', 'graph theory'],
    tags: ['prime', 'factor', 'gcd', 'modular', 'graph', 'shortest path', 'discrete'],
    can: [
      ['numberTheory', 'factorise, test primality or do modular arithmetic'],
      ['graphAlgorithms', 'run a shortest-path or connectivity algorithm']
    ],
    produces: ['numbers', 'table'],
    parameters: Object.keys(PARAMETERS['number-lab']),
    limitations: ['Factorisation is bounded: very large numbers are refused rather than attempted for ever.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'coordinate-lab',
    name: 'Coordinate Lab',
    summary: 'Convert between coordinate systems and reference frames, rotations included.',
    domain: 'mathematics',
    icon: 'axis-3d',
    aliases: ['coordinates', 'frames', 'rotation'],
    tags: ['coordinate', 'polar', 'spherical', 'cylindrical', 'rotation', 'frame', 'transform'],
    can: [['convertCoordinates', 'convert a point between coordinate systems']],
    produces: ['numbers'],
    parameters: Object.keys(PARAMETERS['coordinate-lab']),
    limitations: ['It converts between the systems it names, and refuses anything else.', OWNS_ITS_INPUTS]
  }),

  // ------------------------------------------------ data
  app({
    id: 'statistics-lab',
    name: 'Statistics Lab',
    summary: 'Describe a set of numbers, and test a claim about them with the assumptions stated.',
    domain: 'data',
    icon: 'bar-chart-3',
    aliases: ['stats', 'average', 'hypothesis test', 'mean and median'],
    tags: ['statistics', 'mean', 'median', 'standard deviation', 'correlation', 'regression', 'p-value', 't-test', 'confidence'],
    can: [
      ['describeData', 'summarise a set of numbers'],
      ['testHypothesis', 'test a claim about data and state what it assumed'],
      ['correlate', 'measure how two sets of numbers move together']
    ],
    parameters: ['text', 'against', 'other'],
    actions: RUN_ACTIONS,
    accepts: ['numbers', 'table', 'series'],
    produces: ['numbers', 'table'],
    limitations: [
      'It states what each test assumes and does not check every assumption for you.',
      'It refuses to compute a p-value from too few values rather than returning one that means nothing.'
    ]
  }),
  app({
    id: 'data-explorer',
    name: 'Data Explorer',
    summary: 'Load a table, then filter, sort, group and join it.',
    domain: 'data',
    icon: 'table-2',
    aliases: ['csv', 'spreadsheet', 'table'],
    tags: ['csv', 'table', 'data', 'filter', 'sort', 'join', 'group', 'column'],
    can: [
      ['exploreTable', 'filter, sort, group or join a table'],
      ['summariseTable', 'describe what is in a table']
    ],
    accepts: ['table', 'text'],
    produces: ['table', 'series'],
    permissions: ['compute', 'file.read'],
    limitations: ['It holds a table in memory, so it is not the tool for a file of millions of rows.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'data-importer',
    name: 'Data Importer',
    summary: 'Read CSV, JSON or pasted text into a table, saying what it could not parse.',
    domain: 'data',
    icon: 'file-input',
    aliases: ['import', 'paste data', 'parse csv'],
    tags: ['import', 'csv', 'json', 'parse', 'paste', 'clean'],
    can: [['importData', 'turn a file or pasted text into a table']],
    accepts: ['text'],
    produces: ['table'],
    permissions: ['compute', 'file.read'],
    limitations: ['It reports the rows it could not read rather than dropping them quietly.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'curve-fitter',
    name: 'Curve Fitter',
    summary: 'Fit a curve to measurements and report how well it fits, with the residuals.',
    domain: 'data',
    icon: 'trending-up',
    aliases: ['regression', 'fit', 'least squares'],
    tags: ['fit', 'regression', 'least squares', 'residual', 'polynomial', 'exponential', 'r-squared'],
    can: [['fitCurve', 'fit a curve to measurements and report how well it fits']],
    accepts: ['series', 'table', 'numbers'],
    produces: ['series', 'numbers'],
    parameters: Object.keys(PARAMETERS['curve-fitter']),
    limitations: ['A good fit is not evidence of the right model, and it says so beside the number.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'signal-lab',
    name: 'Signal Lab',
    summary: 'Transform, filter and analyse a signal, with the sampling limits made explicit.',
    domain: 'data',
    icon: 'audio-waveform',
    aliases: ['fourier', 'fft', 'filter', 'spectrum'],
    tags: ['signal', 'fourier', 'fft', 'filter', 'spectrum', 'sampling', 'aliasing', 'window'],
    can: [
      ['analyseSignal', 'find the frequencies in a signal'],
      ['filterSignal', 'apply a filter to a signal']
    ],
    accepts: ['series', 'numbers'],
    produces: ['series', 'numbers'],
    parameters: Object.keys(PARAMETERS['signal-lab']),
    limitations: ['It says when a frequency is above what the sampling rate can represent, rather than reporting it as real.', OWNS_ITS_INPUTS]
  }),

  // ------------------------------------------------ measurement and method
  app({
    id: 'measurement-lab',
    name: 'Measurement Lab',
    summary: 'Propagate uncertainty through a calculation and report the result honestly.',
    domain: 'study',
    icon: 'ruler',
    aliases: ['error', 'uncertainty', 'error bars'],
    tags: ['uncertainty', 'error', 'measurement', 'propagation', 'significant figures', 'tolerance', 'standard error'],
    can: [['propagateUncertainty', 'carry an uncertainty through a calculation']],
    produces: ['numbers'],
    limitations: ['It assumes the inputs are independent unless told otherwise, and says so.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'uncertainty-lab',
    name: 'Uncertainty Lab',
    summary: 'Combine uncertainties, compare measurements, and judge whether a difference is real.',
    domain: 'study',
    icon: 'circle-dot',
    aliases: ['combine errors', 'agreement'],
    tags: ['uncertainty', 'combine', 'agreement', 'significance', 'tolerance', 'error'],
    can: [['compareMeasurements', 'judge whether two measurements genuinely differ']],
    produces: ['numbers'],
    parameters: Object.keys(PARAMETERS['uncertainty-lab']),
    limitations: ['It answers whether a difference is significant, not whether it matters.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'significant-figures',
    name: 'Significant Figures',
    summary: 'Round and present numbers to the precision the inputs actually justify.',
    domain: 'study',
    icon: 'binary',
    aliases: ['rounding', 'precision'],
    tags: ['significant figures', 'rounding', 'precision', 'decimal places'],
    can: [['applyPrecision', 'round a number to the precision its inputs justify']],
    opensAt: 'compact',
    largest: 'expanded',
    produces: ['numbers'],
    limitations: ['It applies the rules; it cannot know how precise your instrument was.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'constants-library',
    name: 'Constants Library',
    summary: 'Physical constants with their units, uncertainties and sources.',
    domain: 'study',
    icon: 'library',
    aliases: ['constants', 'physical constants'],
    tags: ['constant', 'planck', 'gravitational', 'avogadro', 'speed of light', 'uncertainty'],
    can: [['lookUpConstant', 'find a physical constant with its unit and uncertainty']],
    opensAt: 'compact',
    largest: 'expanded',
    produces: ['numbers'],
    limitations: ['It holds the constants it ships with, and says when something is not one of them.']
  }),
  app({
    id: 'constraint-checker',
    name: 'Constraint Checker',
    summary: 'Check a set of values against stated constraints and say which fail.',
    domain: 'study',
    icon: 'shield-check',
    aliases: ['validate', 'check limits'],
    tags: ['constraint', 'validate', 'limit', 'range', 'feasible'],
    can: [['checkConstraints', 'say which of a set of constraints a configuration breaks']],
    accepts: ['table', 'numbers'],
    produces: ['table'],
    limitations: ['It checks what you state; it does not know the constraints you did not write down.', OWNS_ITS_INPUTS]
  }),

  // ------------------------------------------------ physics
  app({
    id: 'motion-lab',
    name: 'Motion Lab',
    summary: 'Motion in phases: a different constant acceleration for each stretch, with the whole journey worked out.',
    domain: 'physics',
    icon: 'move',
    aliases: ['suvat', 'kinematics', 'acceleration'],
    tags: ['motion', 'kinematics', 'acceleration', 'velocity', 'distance', 'suvat'],
    can: [['solveMotion', 'work out constant-acceleration motion from what is known']],
    parameters: ['durations', 'accelerations', 'velocity', 'position'],
    actions: RUN_ACTIONS,
    produces: ['numbers'],
    limitations: ['Each phase has one constant acceleration; smoothly varying acceleration belongs in the Integrator Lab.']
  }),
  app({
    id: 'projectile-lab',
    name: 'Projectile Lab',
    summary: 'Launch something and see where it lands — with air resistance, and with the exact answer beside the numerical one.',
    domain: 'physics',
    icon: 'target',
    aliases: ['projectile motion', 'trajectory', 'ballistics', 'throw'],
    tags: ['projectile', 'trajectory', 'gravity', 'range', 'launch', 'angle', 'drag', 'air resistance'],
    can: [
      ['simulateProjectile', 'work out the flight of a launched object'],
      ['compareDragModels', 'show what air resistance does to a trajectory']
    ],
    parameters: ['speed', 'angle', 'height', 'gravity', 'drag', 'coefficient', 'mass'],
    actions: RUN_ACTIONS,
    produces: ['series', 'numbers'],
    limitations: [
      'Point mass, no spin, no wind, uniform gravity.',
      'With air resistance there is no exact answer, so the numerical one is used and labelled as such.'
    ]
  }),
  app({
    id: 'oscillator-lab',
    name: 'Oscillator Lab',
    summary: 'A mass on a spring, damped and driven, with resonance shown rather than described.',
    domain: 'physics',
    icon: 'activity',
    aliases: ['spring', 'shm', 'resonance', 'damping'],
    tags: ['oscillator', 'spring', 'damping', 'resonance', 'frequency', 'amplitude', 'driven'],
    can: [['simulateOscillator', 'work out the motion of a damped or driven oscillator']],
    produces: ['series', 'numbers'],
    limitations: ['Linear restoring force only.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'pendulum-lab',
    name: 'Pendulum Lab',
    summary: 'A pendulum at any angle, with the small-angle approximation shown against the real thing.',
    domain: 'physics',
    icon: 'clock',
    aliases: ['pendulum', 'swing'],
    tags: ['pendulum', 'period', 'amplitude', 'small angle', 'nonlinear'],
    can: [['simulatePendulum', 'work out the swing of a pendulum at any amplitude']],
    produces: ['series', 'numbers'],
    limitations: ['A single rigid pendulum. The double pendulum is not this app.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'collision-lab',
    name: 'Collision Lab',
    summary: 'Two bodies colliding, from perfectly elastic to perfectly not, with momentum and energy accounted for.',
    domain: 'physics',
    icon: 'git-compare',
    aliases: ['collision', 'momentum', 'impact'],
    tags: ['collision', 'momentum', 'elastic', 'inelastic', 'restitution', 'energy', 'impact'],
    can: [['simulateCollision', 'work out what two colliding bodies do afterwards']],
    produces: ['numbers'],
    limitations: ['Two bodies in one dimension, or two in a plane. Not a many-body contact simulation.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'orbit-lab',
    name: 'Orbit Lab',
    summary: 'Orbits from the gravitational two-body problem, with the orbital elements worked out.',
    domain: 'physics',
    icon: 'orbit',
    aliases: ['orbit', 'kepler', 'satellite', 'gravitation'],
    tags: ['orbit', 'kepler', 'gravity', 'satellite', 'eccentricity', 'period', 'escape velocity'],
    can: [['computeOrbit', 'work out an orbit and its elements']],
    produces: ['series', 'numbers'],
    limitations: ['Two bodies. An n-body simulation is not this app and is not in this build.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'rotation-lab',
    name: 'Rotation Lab',
    summary: 'Moments of inertia, torque and angular momentum for rigid bodies.',
    domain: 'physics',
    icon: 'rotate-cw',
    aliases: ['rotation', 'torque', 'inertia'],
    tags: ['rotation', 'torque', 'inertia', 'angular momentum', 'rigid body', 'spin'],
    can: [['computeRotation', 'work out the rotation of a rigid body']],
    produces: ['numbers'],
    limitations: ['Rigid bodies about fixed axes. Not a general three-dimensional rigid-body solver.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'wave-lab',
    name: 'Wave Lab',
    summary: 'Waves adding, interfering, beating and standing, with the result drawn.',
    domain: 'physics',
    icon: 'waves',
    aliases: ['waves', 'interference', 'standing wave', 'beats'],
    tags: ['wave', 'interference', 'standing', 'beat', 'wavelength', 'frequency', 'superposition', 'doppler'],
    can: [['simulateWaves', 'add waves together and show what results']],
    produces: ['series', 'numbers'],
    limitations: ['One-dimensional linear waves. No two-dimensional field.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'integrator-lab',
    name: 'Integrator Lab',
    summary: 'Numerical methods compared on the same problem, with the error of each shown.',
    domain: 'physics',
    icon: 'zap',
    aliases: ['numerical methods', 'runge-kutta', 'euler', 'ode'],
    tags: ['integrator', 'euler', 'runge-kutta', 'step size', 'error', 'numerical', 'differential equation', 'stability'],
    can: [
      ['integrateNumerically', 'solve a differential equation numerically'],
      ['compareMethods', 'show how numerical methods differ on one problem']
    ],
    produces: ['series', 'numbers'],
    limitations: ['It shows the error against a known solution where there is one, and says so where there is not.', OWNS_ITS_INPUTS]
  }),

  // ------------------------------------------------ method and study
  app({
    id: 'simulation-lab',
    name: 'Simulation Lab',
    summary: 'Step a system forward in time and watch what it does.',
    domain: 'physics',
    icon: 'play',
    aliases: ['simulate', 'time step'],
    tags: ['simulation', 'time step', 'state', 'dynamics', 'integrate'],
    can: [['stepSimulation', 'advance a system in time and report its state']],
    produces: ['series', 'numbers'],
    // The one app here with a clock, so it is the one whose hidden behaviour is not "continue".
    whenHidden: 'pause',
    limitations: ['It solves the systems it ships with, not an arbitrary one you describe.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'parameter-study',
    name: 'Parameter Study',
    summary: 'Sweep a value across a range and see how the answer moves with it.',
    domain: 'study',
    icon: 'sliders-horizontal',
    aliases: ['sweep', 'sensitivity', 'what if'],
    tags: ['sweep', 'sensitivity', 'parameter', 'range', 'study', 'comparison'],
    can: [
      ['sweepParameter', 'run a calculation across a range of one value'],
      ['sensitivity', 'show which inputs the answer actually depends on']
    ],
    accepts: ['numbers'],
    produces: ['table', 'series'],
    whenHidden: 'throttle',
    limitations: ['A sweep is bounded: an enormous one is refused rather than left running.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'scenario-lab',
    name: 'Scenario Lab',
    summary: 'Several configurations side by side, compared on the numbers rather than by eye.',
    domain: 'study',
    icon: 'columns-3',
    aliases: ['compare', 'scenarios', 'what if'],
    tags: ['scenario', 'compare', 'variant', 'side by side', 'alternative'],
    can: [['compareScenarios', 'compare several configurations on their results']],
    accepts: ['table'],
    produces: ['table'],
    persists: true,
    limitations: ['It compares what you set up; it does not search for a better configuration.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'optimiser',
    name: 'Optimiser',
    summary: 'Find the best value of something, subject to constraints, and say how sure it is.',
    domain: 'engineering',
    icon: 'target',
    aliases: ['optimise', 'minimise', 'maximise', 'best fit'],
    tags: ['optimise', 'minimise', 'maximise', 'constraint', 'objective', 'search', 'convergence'],
    can: [['optimise', 'find the best value of something subject to constraints']],
    accepts: ['expression', 'numbers'],
    produces: ['numbers'],
    whenHidden: 'throttle',
    limitations: ['It reports a local optimum as local, and does not claim a global one it has not shown.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'problem-workspace',
    name: 'Problem Workspace',
    summary: 'Work a problem through in steps, with each step checked as you go.',
    domain: 'study',
    icon: 'list-checks',
    aliases: ['working out', 'steps', 'solve step by step'],
    tags: ['problem', 'steps', 'working', 'check', 'method'],
    can: [['workThroughProblem', 'check each step of a worked problem']],
    produces: ['document'],
    persists: true,
    limitations: ['It checks the steps you write; it does not write them for you.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'explain-it-yourself',
    name: 'Explain It Yourself',
    summary: 'Explain something in your own words and have the gaps pointed out.',
    domain: 'study',
    icon: 'message-square',
    aliases: ['feynman', 'explain back', 'self test'],
    tags: ['explain', 'understand', 'recall', 'gaps', 'study'],
    can: [['checkUnderstanding', 'find the gaps in an explanation somebody wrote']],
    produces: ['document'],
    persists: true,
    limitations: ['It points at gaps; it does not grade you.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'document-studio',
    name: 'Document Studio',
    summary: 'Build a document out of results, with the numbers kept attached to where they came from.',
    domain: 'creative',
    icon: 'file-text',
    aliases: ['report', 'write up', 'document'],
    tags: ['document', 'report', 'write up', 'results', 'export'],
    can: [['composeDocument', 'build a document from results']],
    accepts: ['table', 'series', 'numbers', 'document'],
    produces: ['document'],
    permissions: ['compute', 'file.write'],
    persists: true,
    limitations: ['It writes documents in the formats it lists, and refuses the rest.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'builder-studio',
    name: 'Builder Studio',
    summary: 'Assemble a Page of your own from the parts Orbis provides.',
    domain: 'creative',
    icon: 'wrench',
    aliases: ['build a page', 'page builder'],
    tags: ['build', 'page', 'compose', 'studio', 'layout'],
    can: [['buildPage', 'assemble a Page from provided parts']],
    produces: ['document'],
    persists: true,
    permissions: ['compute', 'file.write'],
    limitations: ['What it builds runs inside the Pages sandbox, with the permissions that sandbox allows.', OWNS_ITS_INPUTS]
  }),
  app({
    id: 'project',
    name: 'Project',
    summary: 'A graph of calculations, where changing an input marks everything downstream of it stale.',
    domain: 'study',
    icon: 'folder-tree',
    aliases: ['laboratory', 'pipeline', 'graph'],
    tags: ['project', 'graph', 'pipeline', 'stale', 'dependency', 'checkpoint', 'laboratory'],
    can: [
      ['runProject', 'run a graph of calculations in dependency order'],
      ['trackStaleness', 'mark everything downstream of a changed input']
    ],
    accepts: ['table', 'numbers', 'series', 'experiment'],
    produces: ['table', 'numbers', 'series', 'experiment'],
    persists: true,
    whenHidden: 'throttle',
    limitations: ['It refuses a graph with a cycle before running any of it.', OWNS_ITS_INPUTS]
  }),

  // ------------------------------------------------ creative — already in the Creation Engine
  app({
    id: 'flowchart',
    name: 'Flowchart',
    summary: 'Draw a flowchart or a diagram, and change it by saying what to change.',
    domain: 'creative',
    icon: 'workflow',
    aliases: ['diagram', 'chart', 'process diagram', 'flow diagram'],
    tags: ['flowchart', 'diagram', 'process', 'decision', 'boxes', 'arrows', 'sequence'],
    can: [
      ['drawFlowchart', 'draw a flowchart or diagram'],
      ['editDiagram', 'change a diagram by describing the change']
    ],
    // The Creation Engine already renders this. The native layer only makes it reachable by capability.
    surface: { kind: 'artifact', ref: 'diagram' },
    opensAt: 'compact',
    largest: 'expanded',
    produces: ['image', 'document'],
    permissions: ['compute', 'file.write'],
    persists: true,
    engine: null,
    limitations: ['It draws diagrams; it is not a general vector editor.', 'It lives in the Creation Engine, so its versions are kept there.']
  })
])

/** By id, so nothing has to search the list. */
export const BY_ID: Readonly<Record<string, NativeAppManifest>> = Object.freeze(
  Object.fromEntries(CATALOGUE.map((one) => [one.id, one]))
)

/**
 * Apps whose values Orion can genuinely set.
 *
 * Exported so the Orion bridge can say "you can open the others, you cannot configure them" from one list rather than
 * from a comment. An app joins it by declaring parameters and reading them, in that order.
 */
export const CONFIGURABLE: readonly string[] = Object.freeze(CATALOGUE.filter((one) => one.parameters.length > 0).map((one) => one.id))
