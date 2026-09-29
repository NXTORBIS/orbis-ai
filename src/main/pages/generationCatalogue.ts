/**
 * The calculations a generated Page is allowed to use, and what each of them takes.
 *
 * Orbis has 278 engine operations. This catalogue is 91 of them, and the difference is not caution about what is
 * dangerous -- every one of them is a pure calculation behind the same capability check. It is about what a model can
 * be told **accurately**.
 *
 * ## Why an operation is in here
 *
 * A model writing a specification has to name an operation and its arguments. If it guesses an argument name, the
 * Page compiles, opens, and is refused on the first keystroke -- which is the worst of the three ways this can fail,
 * because it happens in front of somebody rather than during generation. So an operation is in this catalogue only
 * when its full argument list can be read directly out of the bridge that dispatches it.
 *
 * Operations are left out for exactly one reason: the bridge hands the whole reader to a helper, so the arguments are
 * assembled somewhere this cannot see. `motion.projectile` is here because its four arguments are read by name in its
 * own case; `motion.projectile-drag` is not, because a helper builds its input. Nothing is excluded for being risky,
 * and nothing is included for being popular.
 *
 * `generationCatalogue.test.ts` re-derives this from the bridge sources and fails when the two disagree. That is what
 * makes the catalogue safe to widen later, and it is what stops a renamed argument in an engine from quietly turning
 * every generated Page that used it into one that refuses.
 *
 * ## What this cannot say
 *
 * What an operation **returns**. Return shapes are not declared anywhere, so the catalogue cannot tell a model which
 * property to show. That is answered by running the Page instead -- `pages:compute` is called for real during
 * generation, and every property the Page tries to show is checked against what actually came back. A guess that is
 * wrong is caught there, with the real property names to hand, rather than becoming an empty box.
 */

/**
 * The shape of one argument, as the bridge reads it.
 *
 * A trailing `?` means the bridge has a default, so the argument may be left out. `whole` is a whole number that
 * travels as a decimal string, because JSON loses digits past 2^53. `value` is a structure a previous step returned.
 */
export type ArgumentKind = 'number' | 'number?' | 'text' | 'text?' | 'choice' | 'numbers' | 'list' | 'boolean' | 'whole' | 'value'

/** Operation to its arguments. Derived from the bridges, and checked against them by a test. */
export const GENERATION_CATALOGUE: Readonly<Record<string, Readonly<Record<string, ArgumentKind>>>> = Object.freeze({
  'algebra.logic': { what: 'choice', maxVariables: 'number?' },
  'air.saturation': { celsius: 'number', formula: 'choice' },
  'air.standard': { altitude: 'number' },
  'farm.nutrients': { requirements: 'list' },
  'quake.arrivals': { distance: 'number', pVelocity: 'number?', sVelocity: 'number?' },
  'rock.get': { rock: 'text' },
  'rock.slope': { slopeAngle: 'number', frictionAngle: 'number', depth: 'number', unitWeight: 'number', cohesion: 'number?', waterTableHeight: 'number?', waterUnitWeight: 'number?' },
  'water.return-period': { returnPeriod: 'number' },
  'water.well': { pumpingRate: 'number', transmissivity: 'number', storativity: 'number', distance: 'number', time: 'number' },
  'weather.stability': { lowerTemperature: 'number', upperTemperature: 'number', heightDifference: 'number', saturatedRate: 'number?' },
  'column.buckling': { youngsModulus: 'number', secondMoment: 'number', length: 'number' },
  'control.roots': { coefficients: 'numbers' },
  'control.routh': { coefficients: 'numbers' },
  'fluid.continuity': { stations: 'list', fluid: 'text?' },
  'fluid.dimensionless': { number: 'choice' },
  'fluid.get': { fluid: 'text' },
  'fluid.pressure': { depth: 'number', fluid: 'text?' },
  'fluid.pump': { head: 'number', flowRate: 'number', efficiency: 'number?', fluid: 'text?' },
  'heat.fin': { tip: 'text?', length: 'number', crossSectionArea: 'number', perimeter: 'number', conductivity: 'number', coefficient: 'number', baseTemperature: 'number', ambientTemperature: 'number' },
  'heat.lmtd': { hotInlet: 'number', hotOutlet: 'number', coldInlet: 'number', coldOutlet: 'number' },
  'heat.ntu': { overallCoefficient: 'number', area: 'number', hotCapacityRate: 'number', coldCapacityRate: 'number', hotInlet: 'number', coldInlet: 'number' },
  'heat.radiation': { surfaceTemperature: 'number', surroundingTemperature: 'number', emissivity: 'number', area: 'number?', viewFactor: 'number?' },
  'heat.resistance': { layers: 'list' },
  'heat.transient': { volume: 'number', surfaceArea: 'number', density: 'number', specificHeat: 'number', coefficient: 'number', conductivity: 'number', initialTemperature: 'number', ambientTemperature: 'number', samples: 'number?' },
  'material.get': { material: 'text' },
  'material.list': { materialClass: 'text?' },
  'material.mixture': { fibreModulus: 'number', matrixModulus: 'number', fibreVolumeFraction: 'number' },
  'material.property': { material: 'text', property: 'text' },
  'shaft.torsion': { torque: 'number', outerDiameter: 'number', innerDiameter: 'number?' },
  'statics.centroid': { pieces: 'list' },
  'statics.slope': { mass: 'number', slopeDegrees: 'number', staticCoefficient: 'number' },
  'statics.truss': { nodes: 'list', members: 'list' },
  'algebra.rational': { digits: 'number?' },
'capacitor.combine': { capacitances: 'numbers', arrangement: 'choice', supplyVoltage: 'number?' },
  'charge.dipole': { charge: 'number', separation: 'number' },
  'circuit.ac-power': { voltageRms: 'number', currentRms: 'number', phaseDegrees: 'number?' },
  'circuit.resistors': { resistances: 'numbers', arrangement: 'choice', supplyVoltage: 'number?' },
  'circuit.resonance': { resistance: 'number', inductance: 'number', capacitance: 'number', arrangement: 'choice', driveVoltage: 'number?', samples: 'number?' },
  'circuit.rlc': { resistance: 'number', inductance: 'number', capacitance: 'number', arrangement: 'choice', stepAmplitude: 'number?', samples: 'number?' },
  'circuit.transformer': { primaryTurns: 'number', secondaryTurns: 'number', primaryVoltage: 'number', loadResistance: 'number' },
  'circuit.transient': { kind: 'choice', resistance: 'number', capacitance: 'number?', inductance: 'number?', supplyVoltage: 'number?', samples: 'number?' },
  'magnet.flux': { fieldStrength: 'number', area: 'number', turns: 'number?' },
  'magnet.induction': { fluxChange: 'number', timeInterval: 'number', turns: 'number?' },
  'magnet.loop': { current: 'number', radius: 'number', axialDistance: 'number?', turns: 'number?' },
  'magnet.motional': { fieldStrength: 'number', rodLength: 'number', speed: 'number' },
  'magnet.solenoid': { current: 'number', turns: 'number', length: 'number', coreRelativePermeability: 'number?' },
  'optics.critical-angle': { fromIndex: 'number', toIndex: 'number' },
  'optics.double-slit': { wavelength: 'number', slitSeparation: 'number', screenDistance: 'number', samples: 'number?', maxOrder: 'number?' },
  'optics.fibre': { coreIndex: 'number', claddingIndex: 'number', surroundingIndex: 'number?' },
  'optics.grating': { wavelength: 'number', incidentAngleDegrees: 'number?' },
  'optics.image': { optic: 'choice', objectDistance: 'number', focalLength: 'number', objectHeight: 'number?' },
  'optics.index': { material: 'text', wavelength: 'number' },
  'optics.lens-maker': { refractiveIndex: 'number', radius1: 'number', radius2: 'number', surroundingIndex: 'number?' },
  'optics.polarise': { incidentIntensity: 'number', angleDegrees: 'number' },
  'optics.prism': { apexAngleDegrees: 'number', refractiveIndex: 'number', incidentAngleDegrees: 'number', surroundingIndex: 'number?' },
  'optics.refract': { incidentAngleDegrees: 'number', fromIndex: 'number', toIndex: 'number' },
  'optics.single-slit': { wavelength: 'number', slitWidth: 'number', screenDistance: 'number', samples: 'number?', maxOrder: 'number?' },
  'optics.system': { elements: 'list', objectDistance: 'number' },
  'optics.thin-film': { thickness: 'number', filmIndex: 'number', aboveIndex: 'number?', belowIndex: 'number?', wavelength: 'number', incidentAngleDegrees: 'number?', maxOrders: 'number?' },
  'sound.beats': { frequency1: 'number', frequency2: 'number' },
  'sound.combine-levels': { levels: 'numbers' },
  'sound.decibels': { value: 'number', reference: 'choice' },
  'sound.distance': { referenceLevel: 'number', referenceDistance: 'number', distance: 'number', spreading: 'choice' },
  'sound.doppler': { sourceFrequency: 'number', sourceSpeed: 'number?', observerSpeed: 'number?', windSpeed: 'number?' },
  'sound.interval': { lower: 'number', upper: 'number' },
  'sound.note': { frequency: 'number', referenceA4: 'number?' },
  'sound.pipe': { kind: 'choice', length: 'number', count: 'number?' },
  'sound.string': { length: 'number', tension: 'number', count: 'number?' },
  'algebra.sequence': { what: 'choice', kind: 'choice', first: 'number?', count: 'number?', terms: 'numbers' },
  'algebra.series': { terms: 'numbers' },
  'algebra.simplify': { rule: 'text', symbol: 'text', domain: 'choice', high: 'number' },
  'calculus.derivative': { expression: 'text', at: 'number', variable: 'text?' },
  'calculus.pde': { which: 'choice', initial: 'numbers', dx: 'number', dt: 'number', steps: 'number', diffusivity: 'number', speed: 'number' },
  'collision.head-on': { mass1: 'number', velocity1: 'number', mass2: 'number', velocity2: 'number', restitution: 'number?' },
  'collision.restitution': { velocity1Before: 'number', velocity2Before: 'number', velocity1After: 'number', velocity2After: 'number' },
  'combinatorics.count': { what: 'choice', n: 'number', r: 'number', parts: 'numbers', total: 'number' },
  'combinatorics.enumerate': { kind: 'choice', r: 'number?' },
  'combinatorics.inclusion': { sizes: 'list' },
  'combinatorics.pascal': { n: 'number' },
  'combinatorics.pigeonhole': { objects: 'number', boxes: 'number' },
  'constants.compare': { id: 'text', value: 'number', uncertainty: 'number?' },
  'constants.get': { id: 'text' },
  'constants.search': { text: 'text?' },
  'fit.compare': { x: 'numbers', y: 'numbers', families: 'list' },
  'frames.from-cylindrical': { radius: 'number', azimuth: 'number', height: 'number', unit: 'choice' },
  'frames.from-euler': { angles: 'numbers', order: 'choice', unit: 'choice' },
  'frames.from-polar': { radius: 'number', angle: 'number', unit: 'choice' },
  'frames.from-spherical': { radius: 'number', polar: 'number', azimuth: 'number', unit: 'choice' },
  'frames.to-polar': { x: 'number', y: 'number', unit: 'choice' },
  'geometry.claim': { id: 'text?', kind: 'choice', describe: 'text?', xVariable: 'text?', yVariable: 'text?' },
  'geometry.conic': { A: 'number', B: 'number', C: 'number', D: 'number', E: 'number', F: 'number' },
  'geometry.solid': { shape: 'choice' },
  'gravity.compare-orbits': { orbits: 'list' },
  'gravity.field': { sources: 'list' },
  'gravity.pair': { mass1: 'number', mass2: 'number', separation: 'number' },
  'gravity.speeds': { centralMass: 'number', radius: 'number' },
  'interpolate.at': { x: 'numbers', y: 'numbers', kind: 'choice', count: 'number?', at: 'numbers' },
  'interpolate.build': { x: 'numbers', y: 'numbers', kind: 'choice', count: 'number?', at: 'numbers' },
  'interpolate.grid': { x: 'numbers', y: 'numbers', kind: 'choice', count: 'number?', at: 'numbers' },
  'matrix.orthogonalise': { vector: 'numbers' },
  'measurement.figures': { written: 'text' },
  'measurement.propagate': { inputs: 'list', expression: 'text', samples: 'number?', seed: 'number?', level: 'number?' },
  'measurement.repeated': { readings: 'numbers', unit: 'text', provenance: 'choice', note: 'text?' },
  'motion.circular': { radius: 'number', mass: 'number', tangentialAcceleration: 'number?' },
  'motion.compare-projectile': { speed: 'number', angle: 'number', height: 'number?', gravity: 'number?', drag: 'choice', coefficient: 'number?', mass: 'number?' },
  'motion.phases': { phases: 'list', position: 'number?', velocity: 'number?' },
  'motion.projectile': { speed: 'number', angle: 'number', height: 'number?', gravity: 'number?' },
  'motion.river': { boatSpeed: 'number', riverSpeed: 'number', width: 'number', heading: 'number?' },
  'motion.vertical-circle': { radius: 'number', mass: 'number', speedAtBottom: 'number', gravity: 'number?' },
  'number.sieve': { limit: 'number' },
  'optimise.constrained': { expression: 'text', constraints: 'list', start: 'numbers', rounds: 'number?' },
  'optimise.interval': { variable: 'text?', expression: 'text', from: 'number', to: 'number' },
  'optimise.linear': { constraints: 'list', objective: 'numbers', direction: 'choice' },
  'oscillator.coupled': { mass1: 'number', mass2: 'number', stiffness1: 'number', stiffness2: 'number', coupling: 'number' },
  'oscillator.damping': { mass: 'number', stiffness: 'number', damping: 'number?' },
  'oscillator.driven': { mass: 'number', stiffness: 'number', damping: 'number?', forceAmplitude: 'number', drivingFrequency: 'number' },
  'oscillator.harmonic': { mass: 'number', stiffness: 'number', initialDisplacement: 'number?', initialVelocity: 'number?' },
  'oscillator.pendulum-period': { length: 'number', gravity: 'number?', amplitudeDegrees: 'number' },
  'plot.axis': { values: 'numbers', scale: 'choice', label: 'text?' },
  'plot.decimate': { target: 'number?' },
  'plot.function': { variable: 'text?', expression: 'text', from: 'number', to: 'number', label: 'text?' },
  'plot.parametric': { parameter: 'text?', x: 'text', y: 'text', from: 'number', to: 'number', label: 'text?' },
  'plot.points': { series: 'list', id: 'text?', title: 'text?' },
  'plot.polar': { parameter: 'text?', expression: 'text', from: 'number?', to: 'number?', label: 'text?' },
  'precision.agree': { a: 'number', b: 'number', figures: 'number' },
  'precision.chain': { steps: 'list' },
  'precision.combine': { operation: 'choice' },
  'precision.read': { text: 'text' },
  'precision.represent': { value: 'number' },
  'precision.round': { value: 'number', mode: 'choice', figures: 'number' },
  'precision.write': { value: 'number', figures: 'number', notation: 'choice' },
  'relation.properties': { pairs: 'list', what: 'choice' },
  'rotation.composite': { parts: 'list' },
  'rotation.inertia': { shape: 'choice', mass: 'number', size: 'number' },
  'rotation.race': { slopeDegrees: 'number', gravity: 'number?', distance: 'number' },
  'rotation.rolling': { shape: 'choice', slopeDegrees: 'number', gravity: 'number?' },
  'rotation.shift-axis': { aboutCentreOfMass: 'number', mass: 'number', distance: 'number' },
  'rotation.spin': { inertia: 'number', torque: 'number', initialAngularVelocity: 'number?', initialAngle: 'number?', time: 'number' },
  'signal.cross-correlation': { a: 'numbers', b: 'numbers' },
  'signal.uniformity': { times: 'numbers', tolerance: 'number?' },
  'simulate.integrate': { time: 'text?', from: 'number?', start: 'numbers', to: 'number', method: 'choice', tracePoints: 'number?' },
  'simulate.invariant': { time: 'text?', quantity: 'text', from: 'number?', start: 'numbers', to: 'number', method: 'choice', allowedDrift: 'number?' },
  'simulate.montecarlo': { expression: 'text', runs: 'number?', seed: 'number?', level: 'number?' },
  'simulate.sensitivity': { expression: 'text', fraction: 'number?', bounds: 'list' },
  'simulate.steps': { time: 'text?', from: 'number?', start: 'numbers', to: 'number', steps: 'numbers', method: 'choice' },
  'simulate.sweep': { axes: 'list', expression: 'text' },
  'statistics.correlate': { a: 'numbers', b: 'numbers', kind: 'choice' },
  'statistics.distribution': { distribution: 'text', parameters: 'numbers', at: 'number?', probability: 'number?' },
  'statistics.histogram': { values: 'numbers', rule: 'choice' },
  'statistics.interval': { values: 'numbers', level: 'number?' },
  'statistics.outliers': { values: 'numbers', method: 'choice' },
  'statistics.ranks': { values: 'numbers' },
  'statistics.regress': { predictors: 'list', outcome: 'numbers' },
  'statistics.summarise': { values: 'numbers' },
  'statistics.test': { kind: 'choice', values: 'numbers', against: 'number', a: 'numbers', b: 'numbers' },
  'statistics.weighted': { values: 'numbers', weights: 'numbers' },
  'wave.standing': { length: 'number', speed: 'number', harmonic: 'number', boundary: 'choice' },
})

/**
 * What a `choice` argument will actually accept.
 *
 * Without this a catalogued operation is unusable: `combinatorics.count(what: choice, n: number, r: number)` tells a
 * model nothing about what `what` may be, so it guesses a word the engine has never heard of -- or, worse, decides
 * the operation cannot do the job and says so. That is what this fixes: asking for the number of five-card hands was
 * refused as impossible while `what: 'combinations'` was sitting in the bridge the whole time.
 *
 * Read out of the same `case` blocks as the arguments, and checked against them by the same test, so a new option in
 * an engine appears here or the test fails.
 */
export const CHOICE_OPTIONS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = Object.freeze({
  'algebra.logic': { what: ['table', 'equivalent', 'dnf', 'cnf'] },
'capacitor.combine': { arrangement: ['series', 'parallel'] },
  'circuit.resistors': { arrangement: ['series', 'parallel'] },
  'circuit.resonance': { arrangement: ['series', 'parallel'] },
  'circuit.rlc': { arrangement: ['series', 'parallel'] },
  'sound.distance': { spreading: ['spherical', 'cylindrical'] },
  'algebra.sequence': { kind: ['arithmetic', 'geometric', 'recursive', 'explicit'], what: ['terms', 'analyse'] },
  'algebra.series': { knownForm: ['geometric', 'harmonic', 'p-series'] },
  'algebra.simplify': { domain: ['real', 'positive', 'non-negative', 'non-zero', 'integer', 'natural', 'complex'] },
  'calculus.pde': { which: ['heat', 'wave'] },
  'combinatorics.count': { what: ['factorial', 'combinations', 'permutations', 'multinomial', 'stars-and-bars', 'derangements'] },
  'combinatorics.enumerate': { kind: ['permutations', 'combinations'] },
  'geometry.claim': { kind: ['collinear', 'concurrent', 'equal-length', 'perpendicular', 'parallel', 'equal-angle', 'on-circle', 'congruent-triangles'] },
  'geometry.solid': { shape: ['cube', 'cuboid', 'sphere', 'cylinder', 'cone', 'pyramid', 'prism'] },
  'measurement.repeated': { provenance: ['measured', 'simulated', 'derived', 'imported', 'assumed', 'unknown'] },
  'motion.compare-projectile': { drag: ['none', 'linear', 'quadratic'] },
  'optimise.linear': { direction: ['minimise', 'maximise'] },
  'plot.axis': { scale: ['linear', 'log', 'symlog'] },
  'precision.combine': { operation: ['add', 'subtract', 'multiply', 'divide', 'power'] },
  'precision.write': { notation: ['plain', 'scientific', 'engineering'] },
  'relation.properties': { what: ['properties', 'classes', 'order'] },
  'simulate.integrate': { method: ['euler', 'rk4', 'adaptive'] },
  'simulate.invariant': { method: ['euler', 'rk4', 'adaptive'] },
  'simulate.steps': { method: ['euler', 'rk4'] },
  'statistics.correlate': { kind: ['pearson', 'spearman'] },
  'statistics.histogram': { rule: ['freedman-diaconis', 'sturges', 'square-root', 'fixed'] },
  'statistics.outliers': { method: ['iqr', 'z-score', 'modified-z'] },
  'statistics.test': { kind: ['one-sample', 'two-sample', 'paired', 'chi-square'] },
  'wave.standing': { boundary: ['both-fixed', 'both-free', 'one-fixed-one-free'] },
})

/**
 * The catalogue in the shape `checkSpec` wants -- with **every argument optional**.
 *
 * That looks like giving up on half the check, and it is the opposite. The two directions fail completely
 * differently:
 *
 * - An argument an operation does **not take** is ignored by the engine. The Page works, the answer is wrong or
 *   fixed, and a control somebody moves does nothing at all. Nothing catches that later, so it is caught here.
 * - An argument an operation **needs** and did not get is refused by the engine, loudly, with its own sentence about
 *   what was missing -- and the trial run during generation hits exactly that, and hands the sentence back for a
 *   second attempt.
 *
 * And requiredness is a thing this file cannot honestly know. `combinatorics.count` reads `n` and `r` for a
 * combination and `parts` and `total` for a partition; the bridge reads all four somewhere in its case, and no amount
 * of looking at the text says which go together. Marking them all required refused every correct specification for
 * it, which is what this comment is here to stop somebody helpfully reinstating.
 */
export const SPEC_SIGNATURES: Readonly<Record<string, Readonly<Record<string, { optional: boolean; options?: readonly string[] }>>>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(GENERATION_CATALOGUE).map(([operation, signature]) => {
        const options = Object.prototype.hasOwnProperty.call(CHOICE_OPTIONS, operation) ? CHOICE_OPTIONS[operation] : {}
        return [
          operation,
          Object.freeze(
            Object.fromEntries(
              Object.keys(signature).map((argument) => [
                argument,
                Object.prototype.hasOwnProperty.call(options, argument)
                  ? { optional: true, options: options[argument] }
                  : { optional: true }
              ])
            )
          )
        ]
      })
    )
  )

/** Operation to the capability it needs, for the operations a generated Page may use. */
export const generationOperations = (all: Readonly<Record<string, string>>): Readonly<Record<string, string>> =>
  Object.freeze(
    Object.fromEntries(
      Object.keys(GENERATION_CATALOGUE)
        .filter((operation) => Object.prototype.hasOwnProperty.call(all, operation))
        .map((operation) => [operation, all[operation]])
    )
  )

/** Every operation a generated Page may use. */
export const CATALOGUED_OPERATIONS: readonly string[] = Object.freeze(Object.keys(GENERATION_CATALOGUE).sort())

/**
 * Which arguments an operation requires, and which it will accept.
 *
 * `undefined` for an operation that is not catalogued, which the caller must treat as "not allowed" rather than as
 * "no constraints".
 */
export function signatureOf(operation: string): Readonly<Record<string, ArgumentKind>> | undefined {
  return Object.prototype.hasOwnProperty.call(GENERATION_CATALOGUE, operation) ? GENERATION_CATALOGUE[operation] : undefined
}

export interface ArgumentProblem {
  argument: string
  /** `unknown` was not in the signature; `missing` is required and was not given. */
  trouble: 'unknown' | 'missing'
  message: string
}

/**
 * The arguments a step gave, checked against what its operation takes.
 *
 * Both directions matter and they fail differently. A **missing** required argument is refused by the engine at run
 * time, so catching it here turns a Page that breaks in front of somebody into one that was never built. An
 * **unknown** argument is worse in a quieter way: the engine ignores it, the Page works, and a control somebody moves
 * does nothing at all -- which looks like the calculation being insensitive rather than like a mistake.
 */
export function checkArguments(operation: string, given: readonly string[]): ArgumentProblem[] {
  const signature = signatureOf(operation)
  if (signature === undefined) {
    return [{ argument: '', trouble: 'unknown', message: `A Page may not use "${operation}".` }]
  }
  const problems: ArgumentProblem[] = []
  for (const argument of given) {
    if (!Object.prototype.hasOwnProperty.call(signature, argument)) {
      problems.push({
        argument,
        trouble: 'unknown',
        message: `${operation} does not take "${argument}". It takes ${Object.keys(signature).join(', ')}.`
      })
    }
  }
  for (const [argument, kind] of Object.entries(signature)) {
    if (kind.endsWith('?')) continue
    if (!given.includes(argument)) {
      problems.push({ argument, trouble: 'missing', message: `${operation} needs "${argument}", and it was not given one.` })
    }
  }
  return problems
}

/**
 * The catalogue as a model is shown it.
 *
 * Grouped by family and written on one line each, because a model reading four hundred lines of prose about
 * operations spends its attention there rather than on what was asked for.
 */
export function catalogueForPrompt(): string {
  const families = new Map<string, string[]>()
  for (const operation of CATALOGUED_OPERATIONS) {
    const family = operation.slice(0, operation.indexOf('.'))
    const signature = GENERATION_CATALOGUE[operation]
    const options = Object.prototype.hasOwnProperty.call(CHOICE_OPTIONS, operation) ? CHOICE_OPTIONS[operation] : {}
    const rendered = Object.entries(signature)
      .map(([name, kind]) => {
        const bare = kind.endsWith('?') ? kind.slice(0, -1) : kind
        const shown = Object.prototype.hasOwnProperty.call(options, name) ? options[name].join('|') : bare
        return kind.endsWith('?') ? `${name}?: ${shown}` : `${name}: ${shown}`
      })
      .join(', ')
    families.set(family, [...(families.get(family) ?? []), `  ${operation}(${rendered})`])
  }
  const newline = String.fromCharCode(10)
  return [...families.entries()].map(([family, rows]) => `${family}:${newline}${rows.join(newline)}`).join(newline)
}
