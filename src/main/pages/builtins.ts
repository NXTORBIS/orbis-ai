import { makePageId } from '../../shared/pages/identity.ts'
import { MANIFEST_SCHEMA_VERSION } from '../../shared/pages/manifest.ts'

/**
 * The Pages Orbis ships with.
 *
 * Every one of these is backed by a real engine in `shared/compute` and does actual work: the converter runs the unit
 * system, the solver runs the solver, the calculus lab runs the expression engine. None of them is a placeholder waiting
 * for an implementation, because a Page in the register that cannot do what it says is worse than a missing Page -- it is
 * findable, it gets indexed, and it fails when somebody opens it.
 *
 * ## The ids are fixed, and that is deliberate
 *
 * A Page id is normally random. These are not: they are written down, because a Page that ships has to keep the same
 * identity across installs and across machines. A bookmark to the unit converter made on one computer has to resolve on
 * another, and a grant given to it has to survive an Orbis update. A random id per install would break both.
 *
 * They are still generated through `makePageId`, so they have the same shape as every other id and nothing downstream has
 * to know these are special.
 */

/** Padded to the length `makePageId` requires, so these look like every other id. */
const fixedId = (name: string): string => makePageId(`${name}${'0'.repeat(32)}`.slice(0, 32))

export const BUILT_IN_IDS = {
  unitConverter: fixedId('orbisunitconverter'),
  equationSolver: fixedId('orbisequationsolver'),
  calculusLab: fixedId('orbiscalculuslab'),
  functionPlotter: fixedId('orbisfunctionplotter'),
  statisticsLab: fixedId('orbisstatisticslab'),
  dataExplorer: fixedId('orbisdataexplorer'),
  measurementLab: fixedId('orbismeasurementlab'),
  optimiser: fixedId('orbisoptimiser'),
  simulationLab: fixedId('orbissimulationlab'),
  algebraLab: fixedId('orbisalgebralab'),
  matrixLab: fixedId('orbismatrixlab'),
  geometryLab: fixedId('orbisgeometrylab'),
  numberLab: fixedId('orbisnumberlab'),
  uncertaintyLab: fixedId('orbisuncertaintylab'),
  parameterStudy: fixedId('orbisparameterstudy'),
  documentStudio: fixedId('orbisdocumentstudio'),
  dataImporter: fixedId('orbisdataimporter'),
  problemWorkspace: fixedId('orbisproblemworkspace'),
  scenarioLab: fixedId('orbisscenariolab'),
  explainYourself: fixedId('orbisexplainyourself'),
  builderStudio: fixedId('orbisbuilderstudio'),
  projectGraph: fixedId('orbisprojectgraph'),
  signalLab: fixedId('orbissignallab'),
  curveFitter: fixedId('orbiscurvefitter'),
  significantFigures: fixedId('orbissignificantfigures'),
  constantsLibrary: fixedId('orbisconstantslibrary'),
  coordinateLab: fixedId('orbiscoordinatelab'),
  constraintChecker: fixedId('orbisconstraintchecker'),
  motionLab: fixedId('orbismotionlab'),
  projectileLab: fixedId('orbisprojectilelab'),
  oscillatorLab: fixedId('orbisoscillatorlab'),
  pendulumLab: fixedId('orbispendulumlab'),
  collisionLab: fixedId('orbiscollisionlab'),
  orbitLab: fixedId('orbisorbitlab'),
  rotationLab: fixedId('orbisrotationlab'),
  waveLab: fixedId('orbiswavelab'),
  integratorLab: fixedId('orbisintegratorlab')
} as const

/**
 * The manifests, as the plain objects `registerPage` validates.
 *
 * Written as JSON rather than built with a helper on purpose: these go through exactly the same validation as an imported
 * manifest, so a mistake in one is caught by the same check that catches a mistake in somebody else's.
 */
export const BUILT_IN_MANIFESTS: readonly Record<string, unknown>[] = [
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.unitConverter,
    slug: 'unit-converter',
    title: 'Unit Converter',
    description:
      'Convert a quantity into another unit of the same kind, and find out when two units cannot be converted because they measure different things.',
    version: '1.0.0',
    kind: 'converter',
    categories: ['utilities.units', 'science.measurement'],
    tags: ['units', 'conversion', 'measurement', 'dimensions'],
    icon: 'ruler',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    // Nothing else. It reaches no network, no files and no devices, so it asks for none of them.
    capabilities: ['computation.arithmetic', 'computation.units', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Convert between metres, miles, kilograms, pounds, seconds, degrees Celsius, pascals, joules, watts and hundreds of other units, with dimensional checking.',
      keywords: ['convert', 'conversion', 'units', 'metric', 'imperial', 'celsius', 'fahrenheit', 'kilometres', 'miles', 'dimensions'],
      intents: ['convert', 'calculate', 'compare'],
      aliases: ['Units', 'Conversion', 'Measurement Converter']
    },
    offline: true,
    limitations: [
      'Currency is not a unit: an exchange rate is a fact about today and has to be fetched, so it is not here.',
      'Degrees Celsius and Fahrenheit cannot appear inside a compound unit, because they are measured from a different zero.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.equationSolver,
    slug: 'equation-solver',
    title: 'Equation Solver',
    description:
      'Solve an equation for one unknown, or a system of linear equations, and see every answer checked by substituting it back.',
    version: '1.0.0',
    kind: 'solver',
    categories: ['science.mathematics.algebra', 'education.mathematics'],
    tags: ['algebra', 'equations', 'quadratic', 'polynomial', 'roots', 'systems'],
    icon: 'equals',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.arithmetic', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Solve linear, quadratic and polynomial equations and systems of linear equations, with every root substituted back into the original equation and the residual reported.',
      keywords: ['solve', 'equation', 'algebra', 'quadratic', 'linear', 'polynomial', 'roots', 'simultaneous', 'system'],
      intents: ['solve', 'calculate', 'check'],
      aliases: ['Solver', 'Algebra Solver', 'Simultaneous Equations']
    },
    offline: true,
    limitations: [
      'An equation with no algebraic structure is scanned over a range, so a root outside that range is not looked for.',
      'Rearranging for a subject is only offered where an exact rearrangement exists, which is the linear case.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.calculusLab,
    slug: 'calculus-lab',
    title: 'Calculus Laboratory',
    description:
      'Evaluate, simplify and differentiate an expression, substitute values into it, and see the derivative checked against the function it came from.',
    version: '1.0.0',
    kind: 'laboratory',
    categories: ['science.mathematics.calculus', 'education.mathematics'],
    tags: ['calculus', 'derivative', 'differentiation', 'algebra', 'expressions'],
    icon: 'function',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.arithmetic', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Differentiate an expression symbolically, simplify it, substitute values, and check the derivative numerically against the function it came from.',
      keywords: ['derivative', 'differentiate', 'calculus', 'simplify', 'expression', 'substitute', 'chain rule'],
      intents: ['differentiate', 'simplify', 'calculate', 'learn'],
      aliases: ['Derivatives', 'Differentiation']
    },
    offline: true,
    limitations: [
      'A function with no derivative rule is refused by name rather than approximated: abs, sign, floor, ceil and round have no derivative everywhere.',
      'Symbolic integration is not here. Only differentiation.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.functionPlotter,
    accepts: [
      { kind: 'plot.series', describe: 'Draws the points on the chart alongside anything already plotted.', replies: false }
    ],
    slug: 'function-plotter',
    title: 'Function Plotter',
    description:
      'Draw a function, a parametric curve or a polar curve, sampled where it bends so a narrow feature is not missed between points.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.mathematics', 'utilities.visualisation'],
    tags: ['plot', 'graph', 'function', 'curve', 'chart'],
    icon: 'line-chart',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.arithmetic', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Plot y = f(x), a parametric curve or a polar curve, with adaptive sampling, automatic axes and breaks drawn at discontinuities rather than lines through them.',
      keywords: ['plot', 'graph', 'draw', 'function', 'curve', 'sine', 'parabola', 'polar', 'parametric', 'chart'],
      intents: ['plot', 'calculate', 'compare'],
      aliases: ['Grapher', 'Graph', 'Plot']
    },
    offline: true,
    limitations: [
      'Sampling follows where the curve bends, so it cannot find a feature narrower than its starting grid. Raise the starting points for a function with very fine structure.',
      'A large jump is drawn as a break. No finite number of samples can tell a pole from a very steep curve, so that is a judgement rather than a fact.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.statisticsLab,
    accepts: [
      { kind: 'table.rows', describe: 'Summarises the numbers in the first numeric column.', replies: true },
      { kind: 'series.values', describe: 'Summarises a list of numbers.', replies: true }
    ],
    slug: 'statistics-lab',
    title: 'Statistics Lab',
    description:
      'Summarise numbers, measure correlation, fit a line and run a test, with every assumption stated and no result reduced to whether it passed.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.statistics'],
    tags: ['statistics', 'average', 'correlation', 'regression', 'significance'],
    icon: 'sigma',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.statistics', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Mean, median, spread, percentiles, correlation, linear regression, t-tests and chi-square, each with its assumptions and the warning that goes with it.',
      keywords: ['statistics', 'mean', 'average', 'median', 'standard deviation', 'correlation', 'regression', 'p-value', 't-test'],
      intents: ['calculate', 'compare', 'analyse'],
      aliases: ['Stats', 'Statistics']
    },
    offline: true,
    limitations: [
      'No test here reports whether a result is significant. 0.05 is a convention, not a fact, and the decision is yours.',
      'A correlation is never reported without the warning that it is not causation, because the two get separated the moment they are apart.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.dataExplorer,
    accepts: [
      { kind: 'table.rows', describe: 'Opens the table in the explorer, replacing what is there.', replies: false }
    ],
    slug: 'data-explorer',
    title: 'Data Explorer',
    description:
      'Paste a table, see what Orbis made of each column and why, then sort, filter, group and join it without losing what was in it.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['utilities.data'],
    tags: ['data', 'table', 'csv', 'spreadsheet', 'filter'],
    icon: 'table',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.data', 'computation.statistics', 'storage.page', 'page.send'],
    capabilityReasons: {
      'page.send': 'So a table you have read here can be handed to the Statistics Lab without exporting and re-importing it.'
    },
    dependencies: [],
    search: {
      summary:
        'Read pasted CSV or tab-separated data, infer each column type with a stated confidence, and sort, filter, aggregate and join it.',
      keywords: ['csv', 'table', 'data', 'spreadsheet', 'import', 'filter', 'sort', 'join', 'column'],
      intents: ['analyse', 'lookup', 'compare'],
      aliases: ['Tables', 'CSV', 'Data']
    },
    offline: true,
    limitations: [
      'The delimiter and whether the first row is headers are both guesses, and both are reported so you can correct them.',
      'A value that could be read two ways -- 01/02/2026, or 1,23 -- is marked invalid rather than guessed at.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.measurementLab,
    slug: 'measurement-lab',
    title: 'Measurement Lab',
    description:
      'Combine measurements and carry their uncertainties through, by formula where that is exact and by sampling where it is not.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.measurement'],
    tags: ['measurement', 'uncertainty', 'error', 'precision', 'significant-figures'],
    icon: 'ruler',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.measurement', 'computation.units', 'computation.statistics', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Propagate uncertainty through arithmetic, work out a measurement from repeated readings, check whether two measurements agree, and report a value the way it should be written.',
      keywords: ['uncertainty', 'error', 'measurement', 'propagation', 'significant figures', 'standard error', 'tolerance'],
      intents: ['calculate', 'convert', 'compare'],
      aliases: ['Uncertainty', 'Error Propagation']
    },
    offline: true,
    limitations: [
      'Uncertainties are combined assuming they are independent unless you say otherwise. Two readings from the same miscalibrated instrument are not independent.',
      'Repeated readings show scatter only. A systematic error shifts every reading the same way and cannot be seen here.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.optimiser,
    slug: 'optimiser',
    title: 'Optimiser',
    description:
      'Find the best value of something, with or without constraints, and be told plainly whether the answer is the best one or merely a good one.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.mathematics', 'utilities.planning'],
    tags: ['optimisation', 'minimise', 'maximise', 'constraints', 'linear-programming'],
    icon: 'target',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.arithmetic', 'computation.optimise', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Minimise or maximise an expression over one or many variables, solve a linear programme with constraints, and see which constraints are actually limiting the answer.',
      keywords: ['optimise', 'optimize', 'minimise', 'maximise', 'best', 'constraint', 'linear programming', 'shadow price'],
      intents: ['calculate', 'solve', 'compare'],
      aliases: ['Optimizer', 'Solver (optimisation)']
    },
    offline: true,
    limitations: [
      'Every method here finds a local best except the linear-programme solver, which finds the global one because a linear problem has no local traps.',
      'Trying many starting points raises confidence and proves nothing. Only landing in several different minima proves anything, and what it proves is that there are several.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.simulationLab,
    slug: 'simulation-lab',
    title: 'Simulation Lab',
    description:
      'Run a model forward in time, check the integration did not quietly go wrong, and sweep a parameter to see what the model does with it.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.physics', 'science.mathematics'],
    tags: ['simulation', 'differential-equations', 'model', 'sweep', 'sensitivity'],
    icon: 'activity',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.arithmetic', 'computation.simulate', 'computation.plot', 'computation.statistics', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Integrate a system of differential equations, compare step sizes to see whether the answer depends on them, watch a conserved quantity, and sweep or test the sensitivity of a parameter.',
      keywords: ['simulate', 'simulation', 'differential equation', 'ode', 'model', 'integrate', 'sweep', 'sensitivity', 'monte carlo'],
      intents: ['calculate', 'solve', 'compare'],
      aliases: ['Simulator', 'Model', 'ODE']
    },
    offline: true,
    limitations: [
      'Everything here is simulated, and every result says so. It describes a model, not the world.',
      'The step size is part of the answer. An answer that changes when the step is halved is telling you about the integrator rather than about the model.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.algebraLab,
    slug: 'algebra-lab',
    title: 'Algebra Lab',
    description:
      'Work with exact fractions, polynomials, sequences, series and logic, and see which steps are exact and which are approximations.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.mathematics', 'education.learning'],
    tags: ['algebra', 'polynomial', 'fractions', 'logic', 'sequences'],
    icon: 'sigma',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.arithmetic', 'computation.mathematics', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Exact rational arithmetic, polynomial division and factorisation, rational and numeric roots, recurring decimals, sequence and series analysis, truth tables and normal forms.',
      keywords: ['algebra', 'fraction', 'rational', 'polynomial', 'roots', 'factorise', 'sequence', 'series', 'truth table', 'logic'],
      intents: ['calculate', 'solve', 'compare'],
      aliases: ['Polynomials', 'Exact Arithmetic', 'Logic']
    },
    offline: true,
    limitations: [
      'Roots found exactly and roots found numerically are reported separately, and a polynomial whose roots cannot be found exactly says so rather than handing back decimals as if they were the answer.',
      'A simplification that needs an assumption is refused until the assumption is stated. The square root of x squared is x only when x is not negative.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.matrixLab,
    slug: 'matrix-lab',
    title: 'Matrix Lab',
    description:
      'Solve linear systems exactly, reduce a matrix step by step, and factorise one numerically with the residuals reported.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.mathematics'],
    tags: ['matrix', 'linear-algebra', 'eigenvalues', 'least-squares'],
    icon: 'grid',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.arithmetic', 'computation.mathematics', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Row reduction with every operation kept, exact determinants and inverses, the four fundamental subspaces, LU, QR, Cholesky, symmetric eigenvalues, the singular value decomposition and least squares.',
      keywords: ['matrix', 'determinant', 'inverse', 'eigenvalue', 'eigenvector', 'svd', 'rank', 'null space', 'least squares', 'linear system'],
      intents: ['calculate', 'solve'],
      aliases: ['Linear Algebra', 'Matrices']
    },
    offline: true,
    limitations: [
      'The exact and the numeric paths are kept apart. A determinant of exactly zero and one of 1e-17 are different claims, and this never turns one into the other.',
      'Every numeric factorisation reports its residual. That is the check, not a promise.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.geometryLab,
    slug: 'geometry-lab',
    title: 'Geometry Lab',
    description:
      'Construct points, lines, circles, triangles and polygons, measure them, and check a claim about them against what was constructed.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.mathematics', 'education.learning'],
    tags: ['geometry', 'triangle', 'circle', 'polygon', 'transformation'],
    icon: 'triangle',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.arithmetic', 'computation.mathematics', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Line relationships, triangle centres and the Euler line, circle intersections and tangents, conic classification, polygon area and containment, transformations, convex hulls, closest pairs and Delaunay triangulation.',
      keywords: ['geometry', 'triangle', 'circle', 'polygon', 'angle', 'tangent', 'conic', 'convex hull', 'delaunay', 'transformation'],
      intents: ['calculate', 'compare', 'solve'],
      aliases: ['Shapes', 'Constructions', 'Euclidean Geometry']
    },
    offline: true,
    limitations: [
      'A claim checked against one construction is checked numerically and never called proven. One configuration satisfying a claim is not a proof of it.',
      'A construction with two answers, such as side-side-angle, returns both rather than picking one.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.numberLab,
    slug: 'number-lab',
    title: 'Number and Graph Lab',
    description:
      'Work with whole numbers, primes, modular arithmetic, counting arguments and graphs, on numbers too large for ordinary arithmetic.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.mathematics', 'education.learning'],
    tags: ['number-theory', 'primes', 'combinatorics', 'graphs', 'modular'],
    icon: 'hash',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.arithmetic', 'computation.mathematics', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Greatest common divisors with the working shown, modular inverses and powers, the Chinese remainder theorem, primality, factorisation, totients, counting arguments, and graph traversal, shortest paths, spanning trees, colouring and ordering.',
      keywords: ['prime', 'factor', 'gcd', 'modular', 'congruence', 'combination', 'permutation', 'graph', 'shortest path', 'spanning tree'],
      intents: ['calculate', 'solve', 'compare'],
      aliases: ['Number Theory', 'Discrete Maths', 'Graphs']
    },
    offline: true,
    limitations: [
      'Whole numbers travel as text, because a JSON number past 2^53 loses digits silently and a primality test on the wrong number is worse than a refusal.',
      'A primality result says whether it is proven or probable, and the two are never conflated. A number too large to factor is reported as unfactored rather than partly factored.',
      'How many there are and what they are are different questions. Ten to the hundred permutations can be counted and cannot be listed, and that is what it says.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.uncertaintyLab,
    slug: 'uncertainty-lab',
    title: 'Uncertainty Lab',
    description:
      'Carry uncertainty through a calculation, two different ways, and find out which inputs the answer actually depends on.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.measurement', 'science.mathematics'],
    tags: ['uncertainty', 'monte-carlo', 'error-propagation', 'sensitivity'],
    icon: 'target',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.arithmetic', 'computation.measurement', 'computation.statistics', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'First-order propagation with the assumptions it rests on, Monte Carlo sampling with correlations and a reproducible seed, variance-based sensitivity, and an uncertainty budget separating systematic from random.',
      keywords: ['uncertainty', 'error', 'propagation', 'monte carlo', 'confidence', 'sensitivity', 'budget', 'correlation'],
      intents: ['calculate', 'compare'],
      aliases: ['Error Propagation', 'Monte Carlo']
    },
    offline: true,
    limitations: [
      'The two methods are run and compared rather than one being chosen. Where they disagree, linearising the model changed the answer, and that is the finding.',
      'A sampled run is reproducible from its seed. A run with no seed reported would not be a measurement.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.parameterStudy,
    slug: 'parameter-study',
    title: 'Parameter Study',
    description:
      'Sweep parameters across ranges, see which ones matter, and find the setting that reaches a target.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.mathematics', 'utilities.analysis'],
    tags: ['sweep', 'sensitivity', 'tornado', 'what-if', 'scenario'],
    icon: 'sliders',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.arithmetic', 'computation.simulate', 'computation.statistics', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'One-at-a-time, grid, random and Latin hypercube sweeps with the size checked first, constraints that prune cases and say what they pruned, local sensitivity, tornado charts, goal seeking and robustness.',
      keywords: ['sweep', 'parameter', 'sensitivity', 'tornado', 'goal seek', 'what if', 'latin hypercube', 'grid'],
      intents: ['calculate', 'compare', 'solve'],
      aliases: ['Sweeps', 'What-If', 'Sensitivity Study']
    },
    offline: true,
    limitations: [
      'The size of a sweep is worked out before any of it runs, because a grid of a million cases is easy to ask for by accident.',
      'A constraint that cannot be read is refused rather than treated as always satisfied, so cases it should have removed never sit in the results looking checked.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.documentStudio,
    slug: 'document-studio',
    title: 'Document Studio',
    description:
      'Build a structured document with real headings, references and citations, and find out what is missing before anybody else does.',
    version: '1.0.0',
    kind: 'editor',
    categories: ['productivity.writing', 'utilities.documents'],
    tags: ['document', 'outline', 'citations', 'references', 'markdown'],
    icon: 'file-text',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.document', 'computation.arithmetic', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Computed outlines and numbering, cross-references that break loudly when their target moves, citations in four styles, markdown in and out, sanitised HTML import, readability analysis and structural diffs.',
      keywords: ['document', 'outline', 'heading', 'citation', 'reference', 'bibliography', 'markdown', 'html', 'readability'],
      intents: ['create', 'analyse', 'compare'],
      aliases: ['Writing', 'Structured Document', 'Report Builder']
    },
    offline: true,
    limitations: [
      'Imported HTML is read through an allow-list and everything else is stripped, with what was stripped reported. Nothing from a document ever runs.',
      'Numbering is computed from the structure, never typed into a heading, so moving a section renumbers everything that follows it.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.dataImporter,
    slug: 'data-importer',
    title: 'Data Importer',
    description:
      'Work out what a file actually is, read it safely, map its columns onto the fields you want, and find out what an export would lose.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['utilities.data', 'utilities.analysis'],
    tags: ['import', 'export', 'csv', 'json', 'xml', 'encoding'],
    icon: 'download',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.interchange', 'computation.data', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Format detection from content as well as from the name, encoding detection with the replacements counted, locale-aware numbers and dates with ambiguity flagged, JSON and XML reading, column mapping, duplicate detection and archive safety checks.',
      keywords: ['import', 'export', 'csv', 'json', 'xml', 'encoding', 'utf-8', 'locale', 'mapping', 'duplicate', 'archive'],
      intents: ['import', 'convert', 'analyse'],
      aliases: ['File Import', 'Data Conversion', 'Format Detection']
    },
    offline: true,
    limitations: [
      'What the name claims, what the source claims and what the bytes show are reported separately, and only the third is evidence. A disagreement is surfaced rather than resolved silently.',
      'An XML document declaring entities is refused, and an archive path that would escape its folder is refused. Neither is repaired into something safe.',
      'A date that could be read two ways is flagged as ambiguous rather than read one way and passed on.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.problemWorkspace,
    slug: 'problem-workspace',
    title: 'Problem Workspace',
    description:
      'Break a problem into parts, write down what you are assuming, and find out what breaks when one of those assumptions turns out to be wrong.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['productivity.thinking', 'utilities.analysis'],
    tags: ['assumptions', 'reasoning', 'problem-solving', 'provenance'],
    icon: 'git-branch',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.reasoning', 'computation.arithmetic', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'An assumption register linked to everything resting on it, what changing one would reach, several approaches to one subproblem kept side by side, staleness traced to the change that caused it, and a report carrying its own caveats.',
      keywords: ['assumption', 'problem', 'reasoning', 'workspace', 'impact', 'stale', 'approach', 'report'],
      intents: ['analyse', 'compare', 'solve'],
      aliases: ['Assumptions', 'Working Out', 'Problem Solving']
    },
    offline: true,
    limitations: [
      'Two approaches that disagree are both kept and neither is averaged with the other. Averaging two answers produces a third that is also wrong.',
      'A report says what is still open, what has gone stale and what contradicts what. It never reads as more settled than the work behind it.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.scenarioLab,
    slug: 'scenario-lab',
    title: 'Scenario Lab',
    description:
      'Build named alternatives to how things are now, compare them, and get an answer to which change actually moved the number.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['utilities.analysis', 'productivity.thinking'],
    tags: ['scenario', 'what-if', 'baseline', 'comparison', 'timeline'],
    icon: 'layers',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.reasoning', 'computation.arithmetic', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'A frozen baseline, scenarios as differences from it, branching, scenario matrices sized before they are built, difference maps, conflict detection, stated merge precedence and event timelines.',
      keywords: ['scenario', 'what if', 'baseline', 'branch', 'matrix', 'compare', 'timeline', 'merge'],
      intents: ['compare', 'calculate', 'analyse'],
      aliases: ['What-If', 'Scenarios', 'Alternatives']
    },
    offline: true,
    limitations: [
      'The baseline is captured and frozen. A scenario is a difference from it and never an edit to it, so every comparison still means what it meant when it was made.',
      'Where changing the inputs one at a time does not account for the move, the interaction left over is reported as its own number and no single input is said to have caused it.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.explainYourself,
    slug: 'explain-it-yourself',
    title: 'Explain It Yourself',
    description:
      'Explain something in your own words and find out what you left out, without being told you understand it.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['education.learning'],
    tags: ['learning', 'explanation', 'misconception', 'hints', 'review'],
    icon: 'message-circle',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.reasoning', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Coverage measured against a concept map, misconceptions found by their stated signals, hints that escalate and still end in a question, every attempt kept so the change between them is visible, and a review queue ordered by what depends on what.',
      keywords: ['learn', 'explain', 'understand', 'misconception', 'hint', 'revision', 'feynman', 'teach'],
      intents: ['learn', 'analyse'],
      aliases: ['Feynman Technique', 'Self-Explanation', 'Study']
    },
    offline: true,
    limitations: [
      'Coverage is measured by matching concept names and their aliases. That is checkable, and it is not understanding -- every result says so, and none of them reports a mastery score.',
      'No hint completes the explanation. The most direct one names the missing idea and asks what it does.',
      'An explanation that is correct in unexpected words will score badly here. The measurement is of coverage, not of correctness.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.builderStudio,
    slug: 'builder-studio',
    title: 'Builder Studio',
    description:
      'Build flowcharts, mind maps, timelines, forms, checklists, decision trees, tables and calculators, each checked against its own rules.',
    version: '1.0.0',
    kind: 'editor',
    categories: ['productivity.diagrams', 'utilities.tools'],
    tags: ['flowchart', 'mind-map', 'timeline', 'form', 'decision-tree'],
    icon: 'shapes',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.reasoning', 'computation.arithmetic', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Eight builders over one object model, with shared selection, grouping, layers, alignment, even distribution and orthogonal connector routing, and per-builder validation that knows a mind map has one root and a decision has two ways out.',
      keywords: ['flowchart', 'diagram', 'mind map', 'timeline', 'form', 'checklist', 'decision tree', 'table', 'calculator', 'builder'],
      intents: ['create', 'analyse'],
      aliases: ['Diagrams', 'Flowcharts', 'Editors']
    },
    offline: true,
    limitations: [
      'What an artifact carries is a list of typed actions, never code. Opening a document somebody sent you never runs their program.',
      'A connector with waypoints you placed is drawn exactly as placed. Objects a route passes through are reported rather than silently routed around.',
      'A builder that registers no rules of its own is reported as having none rather than treated as always valid.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.signalLab,
    slug: 'signal-lab',
    title: 'Signal Lab',
    description:
      'Take a sampled series apart into the frequencies it is made of, smooth it, filter it, and find what repeats in it.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.mathematics', 'science.measurement', 'utilities.analysis'],
    tags: ['fourier', 'spectrum', 'filter', 'signal', 'time-series', 'frequency'],
    icon: 'activity',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.science', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Amplitude and density spectra at any record length, window functions with the trade each one makes, averaged spectra for noise, peak frequencies interpolated between bins, linear-phase filters, smoothing, detrending, autocorrelation and resampling.',
      keywords: ['fourier', 'fft', 'spectrum', 'frequency', 'filter', 'smooth', 'autocorrelation', 'sampling', 'nyquist', 'aliasing'],
      intents: ['calculate', 'compare'],
      aliases: ['Fourier', 'Spectrum Analyser', 'Frequency Analysis']
    },
    offline: true,
    limitations: [
      'Nothing above half the sampling rate is reported. Content above it was folded onto a lower frequency when the samples were taken, and no transform undoes that.',
      'A gap in the samples refuses the transform rather than being filled with a zero. A zero is a step change, and a step change has energy at every frequency.',
      'Zero padding draws the spectrum at finer spacing. It does not help separate two nearby frequencies -- only a longer record does that.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.curveFitter,
    slug: 'curve-fitter',
    title: 'Curve Fitter',
    description:
      'Draw a curve through measurements or near them, and find out whether the shape you chose is the wrong one.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.mathematics', 'utilities.analysis'],
    tags: ['fit', 'regression', 'interpolation', 'spline', 'residuals', 'curve'],
    icon: 'trending-up',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.science', 'computation.statistics', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Linear, polynomial, exponential, power, logarithmic, reciprocal and logistic fits; nearest, linear, polynomial, spline and monotone interpolation; residual checks that find curvature, changing spread and serial correlation; and a comparison that ranks without naming a winner.',
      keywords: ['fit', 'curve', 'regression', 'interpolate', 'spline', 'residual', 'r squared', 'trend', 'exponential', 'power law'],
      intents: ['calculate', 'compare', 'solve'],
      aliases: ['Regression', 'Trend Line', 'Interpolation']
    },
    offline: true,
    limitations: [
      'Interpolation is refused outside the measured range. A fitted curve has a value anywhere, and those values assert the shape continues rather than describe anything measured.',
      'R squared measures how closely a shape follows the data, never that the shape is right. The residual checks find curvature a high R squared hides.',
      'A fit through a logarithm minimises proportional rather than absolute error. R squared is computed on the original scale, not the transformed one.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.significantFigures,
    slug: 'significant-figures',
    title: 'Significant Figures',
    description:
      'Work out how many digits an answer has earned, carry that through a calculation, and write it down properly.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.measurement', 'science.mathematics', 'education.reference'],
    tags: ['significant-figures', 'rounding', 'precision', 'scientific-notation'],
    icon: 'hash',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.science', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Counting significant figures from how a number is written, the separate rules for adding and for multiplying, chains rounded once at the end, six rounding modes, scientific and engineering notation, and what a double can actually hold.',
      keywords: ['significant figures', 'sig fig', 'rounding', 'precision', 'scientific notation', 'engineering notation', 'decimal places'],
      intents: ['calculate', 'define'],
      aliases: ['Sig Figs', 'Rounding', 'Precision']
    },
    offline: true,
    limitations: [
      'Significant figures are notation, not uncertainty. A plus-or-minus is a different and stronger statement, and the Uncertainty Lab is where that lives.',
      'A number like 1200 does not say how many of its digits are meant. That is reported as ambiguous, with both ways to write it, rather than guessed.',
      'Adding keeps decimal places and multiplying keeps significant figures. Two different rules, and the one that fits the operation is the one applied.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.constantsLibrary,
    slug: 'constants-library',
    title: 'Constants Library',
    description:
      'Physical, agreed and mathematical constants, each saying where its value came from and how much it limits a result.',
    version: '1.0.0',
    kind: 'reference',
    categories: ['science.physics', 'science.reference', 'education.reference'],
    tags: ['constants', 'codata', 'si', 'physics', 'reference'],
    icon: 'book',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.science', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'The seven constants that define the SI and have no uncertainty, the ones derived exactly from them, the measured ones with their CODATA uncertainties, agreed values like standard gravity, and mathematical constants -- with a comparison that says whether a measurement is consistent with one.',
      keywords: ['constant', 'speed of light', 'planck', 'avogadro', 'boltzmann', 'gravitational constant', 'codata', 'si units', 'physics'],
      intents: ['define', 'calculate', 'compare'],
      aliases: ['Physical Constants', 'CODATA', 'SI Constants']
    },
    offline: true,
    limitations: [
      'Since 2019 several constants are exact by definition. Their uncertainty is zero and will never improve, because there is nothing left to measure.',
      'A measured constant limits every result using it. G is known to two parts in a hundred thousand, so a result using it cannot be quoted to more figures than that.',
      'Some constants are published with more digits than a double holds. The published text is shown beside the number handed out, rather than pretending they match.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.coordinateLab,
    slug: 'coordinate-lab',
    title: 'Coordinate Lab',
    description:
      'Convert between coordinate systems, compose rotations, and move points between reference frames without losing track of the convention.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.mathematics', 'science.physics', 'utilities.analysis'],
    tags: ['coordinates', 'spherical', 'rotation', 'quaternion', 'euler', 'reference-frame'],
    icon: 'compass',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.science', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Cartesian, polar, cylindrical and spherical coordinates under either convention; rotations as axis-and-angle, quaternion, matrix or Euler angles; and trees of reference frames with points and directions moved between them.',
      keywords: ['coordinate', 'polar', 'spherical', 'cylindrical', 'rotation', 'quaternion', 'euler', 'gimbal lock', 'reference frame', 'transform'],
      intents: ['calculate', 'compare'],
      aliases: ['Coordinates', 'Rotations', 'Reference Frames']
    },
    offline: true,
    limitations: [
      'The physics and mathematics conventions swap the meanings of theta and phi. The page asks which you mean, because the wrong default gives clean wrong answers.',
      'Angles that do not exist are reported missing rather than returned as zero. At the origin there is no direction; on the z axis there is no azimuth.',
      'At gimbal lock infinitely many Euler triples give the same rotation. The page says so and shows which it picked, rather than presenting one as the answer.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.constraintChecker,
    slug: 'constraint-checker',
    title: 'Constraint Checker',
    description:
      'Write down what must be true, check it against the numbers, and find out which rules are impossible before looking for a better value.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.mathematics', 'utilities.analysis', 'work.planning'],
    tags: ['constraints', 'requirements', 'feasibility', 'limits', 'tolerance'],
    icon: 'check-square',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.science', 'computation.arithmetic', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Ranges, comparisons between expressions, sums, required values and orderings, all checked with units; which rules are exactly at their limit; which rules contradict each other whatever the values; and how far a range can be narrowed from the others.',
      keywords: ['constraint', 'requirement', 'limit', 'tolerance', 'feasible', 'specification', 'bounds', 'check'],
      intents: ['compare', 'solve', 'calculate'],
      aliases: ['Requirements', 'Limits', 'Feasibility']
    },
    offline: true,
    limitations: [
      'A rule that cannot be checked because a value is missing has not passed. Those are counted separately and never folded in with the satisfied ones.',
      'Comparing a length against a time is a broken rule rather than a broken design, and the page says which it found.',
      'Contradictions are found only among ranges. Conflicts inside expressions cannot be found in general, so this says nothing was proved impossible.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.motionLab,
    slug: 'motion-lab',
    title: 'Motion Lab',
    description:
      'Build motion out of phases of acceleration and watch position, velocity and acceleration follow.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.physics', 'science.physics.mechanics', 'education.reference'],
    tags: ['kinematics', 'motion', 'acceleration', 'velocity', 'graphs'],
    icon: 'move',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.physics', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Piecewise constant acceleration solved exactly in each phase, with position, velocity and acceleration graphs, the moment the motion turns round, and distance kept separate from displacement.',
      keywords: ['motion', 'kinematics', 'velocity', 'acceleration', 'displacement', 'distance', 'velocity time graph'],
      intents: ['calculate', 'compare'],
      aliases: ['Kinematics', 'Motion Graphs']
    },
    offline: true,
    limitations: [
      'Each phase is solved exactly rather than integrated, so nothing drifts. Constant acceleration has a closed form.',
      'Distance and displacement are reported separately. They are the same number until the motion turns round, and afterwards they are not.',
      'One dimension only. A two-dimensional trajectory belongs in the Projectile Lab.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.projectileLab,
    slug: 'projectile-lab',
    title: 'Projectile Lab',
    description:
      'Launch something and find out how far it goes, with and without the air, and how much difference the air makes.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.physics', 'science.physics.mechanics'],
    tags: ['projectile', 'trajectory', 'range', 'drag', 'ballistics'],
    icon: 'target',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.physics', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'The exact no-drag solution with its assumptions, the integrated trajectory with linear or quadratic drag, and a comparison that says whether the difference is the air or the integration.',
      keywords: ['projectile', 'trajectory', 'range', 'launch angle', 'air resistance', 'drag', 'maximum height', 'time of flight'],
      intents: ['calculate', 'compare'],
      aliases: ['Trajectory', 'Ballistics', 'Range Calculator']
    },
    offline: true,
    limitations: [
      'The projectile formulas solve motion with no air resistance. With drag they are not approximately right; they answer a different question, so no ideal range is quoted beside a dragged path.',
      'Without drag every projectile follows the same path whatever it weighs. With drag a heavier one goes further, and the page shows both.',
      'The best launch angle is 45 degrees only from level ground. From a height it is lower, and the page computes it rather than assuming.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.oscillatorLab,
    slug: 'oscillator-lab',
    title: 'Oscillator Lab',
    description:
      'A mass on a spring: damped, driven, and pushed toward resonance.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.physics', 'science.physics.mechanics'],
    tags: ['oscillator', 'spring', 'damping', 'resonance', 'shm'],
    icon: 'activity',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.physics', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Simple harmonic motion solved exactly, the four damping regimes classified from the damping ratio, the steady-state response to driving, and a resonance curve with its peak and bandwidth.',
      keywords: ['oscillator', 'spring', 'simple harmonic motion', 'damping', 'resonance', 'driven', 'quality factor', 'hooke'],
      intents: ['calculate', 'compare'],
      aliases: ['Springs', 'Resonance', 'SHM']
    },
    offline: true,
    limitations: [
      'Resonance is at a frequency below the natural one, and above a damping ratio of 0.707 there is no peak at all. Driving at the natural frequency is the undamped limit, not the general case.',
      'The driven result is the steady state. There is also a transient at the natural frequency that fades, and the full motion is the two added together.',
      'Springs are assumed to obey Hookes law at every extension, with no limit and no permanent bending.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.pendulumLab,
    slug: 'pendulum-lab',
    title: 'Pendulum Lab',
    description:
      'How long a pendulum really takes, why the textbook formula is wrong at large angles, and what happens with two of them.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.physics', 'science.physics.mechanics'],
    tags: ['pendulum', 'period', 'double-pendulum', 'nonlinear', 'chaos'],
    icon: 'clock',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.physics', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'The exact period from an elliptic integral beside the small-angle formula and the error between them, the swing integrated from the nonlinear equation, and two double pendulums started a hair apart.',
      keywords: ['pendulum', 'period', 'small angle', 'double pendulum', 'chaos', 'sensitive', 'swing', 'oscillation'],
      intents: ['calculate', 'compare'],
      aliases: ['Pendulum', 'Double Pendulum']
    },
    offline: true,
    limitations: [
      'The small-angle period does not depend on amplitude. That independence is what the approximation discarded; the real period is 18% longer at 90 degrees.',
      'The double pendulum is deterministic and sensitive, which are different things. The same start gives the same trajectory every time; nothing here is random.',
      'The rod is massless and does not stretch. A real rod with mass swings at a different rate.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.collisionLab,
    slug: 'collision-lab',
    title: 'Collision Lab',
    description:
      'Two things meet. See what survives the collision and what does not.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.physics', 'science.physics.mechanics'],
    tags: ['collision', 'momentum', 'energy', 'restitution', 'elastic'],
    icon: 'zap',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.physics', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Head-on and glancing collisions at any restitution, with momentum and kinetic energy audited separately, the centre-of-mass view, and the exact contact time for two moving discs.',
      keywords: ['collision', 'momentum', 'elastic', 'inelastic', 'restitution', 'energy loss', 'impact', 'conservation'],
      intents: ['calculate', 'compare'],
      aliases: ['Impacts', 'Momentum']
    },
    offline: true,
    limitations: [
      'Momentum is conserved in every collision here. Kinetic energy is conserved only in an elastic one, and the loss below that is heat and deformation rather than an error.',
      'A restitution above 1 is refused. That would leave the pair with more energy than they arrived with, which needs a spring or a motor rather than a collision.',
      'Collisions are instantaneous. Nothing models the contact lasting a while, so there is no peak force and no contact duration.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.orbitLab,
    slug: 'orbit-lab',
    title: 'Orbit Lab',
    description:
      'Put something in orbit and find out what kind of orbit it is, from the numbers rather than the picture.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.physics', 'science.astronomy', 'science.physics.mechanics'],
    tags: ['orbit', 'gravity', 'kepler', 'eccentricity', 'n-body'],
    icon: 'orbit',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.physics', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Orbital elements from a position and a velocity, classification from the specific energy and eccentricity, the conic drawn exactly, comparison against Keplers third law, and an n-body integration.',
      keywords: ['orbit', 'gravity', 'kepler', 'eccentricity', 'escape velocity', 'satellite', 'elliptical', 'hyperbolic', 'n-body'],
      intents: ['calculate', 'compare'],
      aliases: ['Orbital Mechanics', 'Kepler', 'Gravity']
    },
    offline: true,
    limitations: [
      'Orbits are classified from the specific energy and eccentricity, never from the shape drawn. Over a short arc a hyperbola and an ellipse look the same.',
      'This works in a plane. Inclination and the ascending node describe a three-dimensional orientation and are reported as absent rather than as zero.',
      'Newtonian gravity throughout. No relativity, so nothing here describes a precessing perihelion or anything near a black hole.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.rotationLab,
    slug: 'rotation-lab',
    title: 'Rotation Lab',
    description:
      'Moments of inertia, torque, and why a hoop always loses a race to a sphere.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.physics', 'science.physics.mechanics'],
    tags: ['rotation', 'inertia', 'torque', 'rolling', 'angular-momentum'],
    icon: 'rotate-cw',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.physics', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Moments of inertia for nine shapes with the axis each is about, the parallel-axis theorem, composite bodies, torque as a cross product, and a rolling race decided by shape alone.',
      keywords: ['moment of inertia', 'torque', 'rolling', 'angular momentum', 'parallel axis', 'rotation', 'lever', 'rolling race'],
      intents: ['calculate', 'compare'],
      aliases: ['Torque', 'Moment of Inertia', 'Rolling']
    },
    offline: true,
    limitations: [
      'A moment of inertia is always about a stated axis. The number alone cannot say which, and cannot be recovered afterwards.',
      'Rolling without slipping needs enough friction. The coefficient required is computed, and below it none of the rolling results apply.',
      'Rotation is about a fixed axis in a plane. Nothing here handles a tumbling body, where the inertia is a tensor and the axis itself moves.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.waveLab,
    slug: 'wave-lab',
    title: 'Wave Lab',
    description:
      'Waves travelling, standing, added together and beating against each other.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.physics', 'science.physics.waves'],
    tags: ['wave', 'standing-wave', 'interference', 'beats', 'superposition'],
    icon: 'audio-waveform',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.physics', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Travelling waves from any two of speed, frequency and wavelength; standing waves with the harmonics each boundary allows; superposition, two-source interference, beats and wave packets.',
      keywords: ['wave', 'wavelength', 'frequency', 'standing wave', 'harmonic', 'interference', 'beats', 'superposition', 'node'],
      intents: ['calculate', 'compare'],
      aliases: ['Waves', 'Interference', 'Harmonics']
    },
    offline: true,
    limitations: [
      'Give two of speed, frequency and wavelength; the third follows from v = f lambda. All three are refused, because a set that does not satisfy it is not a wave.',
      'A pipe closed at one end has no even harmonics. Asking for one is refused rather than rounded to a neighbour.',
      'The beat rate is the difference of the two frequencies, not half of it. The envelope swings at half that, and each swing is heard twice.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.integratorLab,
    slug: 'integrator-lab',
    title: 'Integrator Lab',
    description:
      'Four ways to step a simulation forward, and why the most accurate one is not always the best.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['science.physics', 'science.mathematics', 'utilities.analysis'],
    tags: ['integrator', 'verlet', 'symplectic', 'numerical', 'energy-drift'],
    icon: 'git-compare',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.physics', 'computation.plot', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Explicit and semi-implicit Euler, velocity Verlet and Runge-Kutta 4 run on the same system, with energy drift measured for each and the stability limit computed from the stiffest spring.',
      keywords: ['integrator', 'verlet', 'runge kutta', 'euler', 'symplectic', 'energy drift', 'timestep', 'numerical stability'],
      intents: ['compare', 'calculate'],
      aliases: ['Numerical Methods', 'Verlet', 'Timestep']
    },
    offline: true,
    limitations: [
      'Accuracy per step and long-run drift pull in opposite directions. A first-order symplectic method beats a fourth-order one over a long run, because bounded error beats small one-way error.',
      'Energy drift only means anything when the system conserves energy. With drag or an applied force in it, the change is the physics rather than the method.',
      'Being closest to Runge-Kutta 4 is not the same as being right. It is the yardstick because it is most accurate over a short run, not because it is exact.'
    ],
    languages: ['en']
  },
  {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: BUILT_IN_IDS.projectGraph,
    slug: 'project',
    title: 'Project',
    description:
      'Wire several Pages together into one piece of work, and get an answer to where any number in it came from.',
    version: '1.0.0',
    kind: 'tool',
    categories: ['productivity.thinking', 'utilities.analysis'],
    tags: ['project', 'pipeline', 'lineage', 'provenance', 'staleness'],
    icon: 'workflow',
    owner: 'system',
    runtimeAtLeast: '1.0.0',
    capabilities: ['computation.reasoning', 'computation.arithmetic', 'storage.page'],
    capabilityReasons: {},
    dependencies: [],
    search: {
      summary:
        'Typed connections between Pages with named conversions, shared variables with scope and shadowing reported, a run order with what can go in parallel, full lineage for every artifact, staleness, checkpoints, diffs and import with collision renaming.',
      keywords: ['project', 'pipeline', 'connect', 'lineage', 'provenance', 'stale', 'checkpoint', 'import', 'export'],
      intents: ['create', 'analyse', 'compare'],
      aliases: ['Pipeline', 'Workflow', 'Composition']
    },
    offline: true,
    limitations: [
      'A connection whose units differ is refused even when the types match. That is the mismatch that computes perfectly and gives a wrong answer.',
      'An artifact whose inputs are no longer in the project is reported as unknown rather than current, because calling it current would be a claim nobody could have checked.',
      'An import renames colliding ids rather than overwriting, and lists every rename.'
    ],
    languages: ['en']
  }
]
