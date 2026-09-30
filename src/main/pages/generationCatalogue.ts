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
export type ArgumentKind = 'number' | 'number?' | 'text' | 'text?' | 'choice' | 'numbers' | 'strings' | 'list' | 'boolean' | 'boolean?' | 'whole' | 'value'

/** Operation to its arguments. Derived from the bridges, and checked against them by a test. */
export const GENERATION_CATALOGUE: Readonly<Record<string, Readonly<Record<string, ArgumentKind>>>> = Object.freeze({
  'air.saturation': { celsius: 'number', formula: 'choice', overIce: 'boolean?' },
  'air.standard': { altitude: 'number' },
  'algebra.logic': { what: 'choice', maxVariables: 'number?' },
  'algebra.rational': { digits: 'number?' },
  'algebra.sequence': { what: 'choice', kind: 'choice', first: 'number?', count: 'number?', terms: 'numbers' },
  'algebra.series': { terms: 'numbers' },
  'algebra.simplify': { rule: 'text', symbol: 'text', domain: 'choice', high: 'number', inclusive: 'boolean?' },
  'body.measures': { height: 'number', weight: 'number' },
  'body.metabolism': { weight: 'number', height: 'number', age: 'number' },
  'calculus.derivative': { expression: 'text', at: 'number', variable: 'text?' },
  'calculus.pde': { which: 'choice', initial: 'numbers', dx: 'number', dt: 'number', steps: 'number', diffusivity: 'number', speed: 'number' },
  'capacitor.combine': { capacitances: 'numbers', arrangement: 'choice', supplyVoltage: 'number?' },
  'charge.dipole': { charge: 'number', separation: 'number' },
  'circuit.ac-power': { voltageRms: 'number', currentRms: 'number', phaseDegrees: 'number?' },
  'circuit.resistors': { resistances: 'numbers', arrangement: 'choice', supplyVoltage: 'number?' },
  'circuit.resonance': { resistance: 'number', inductance: 'number', capacitance: 'number', arrangement: 'choice', driveVoltage: 'number?', samples: 'number?' },
  'circuit.rlc': { resistance: 'number', inductance: 'number', capacitance: 'number', arrangement: 'choice', stepAmplitude: 'number?', samples: 'number?' },
  'circuit.transformer': { primaryTurns: 'number', secondaryTurns: 'number', primaryVoltage: 'number', loadResistance: 'number' },
  'circuit.transient': { kind: 'choice', resistance: 'number', capacitance: 'number?', inductance: 'number?', supplyVoltage: 'number?', samples: 'number?' },
  'cite.bibliography': { references: 'list' },
  'cite.identifier': { identifier: 'text' },
  'collision.head-on': { mass1: 'number', velocity1: 'number', mass2: 'number', velocity2: 'number', restitution: 'number?' },
  'collision.restitution': { velocity1Before: 'number', velocity2Before: 'number', velocity1After: 'number', velocity2After: 'number' },
  'colour.contrast': { foreground: 'text', background: 'text', fontSize: 'number?', bold: 'boolean?' },
  'colour.palette': { base: 'text', harmony: 'choice', steps: 'number?' },
  'column.buckling': { youngsModulus: 'number', secondMoment: 'number', length: 'number' },
  'combinatorics.count': { what: 'choice', n: 'number', r: 'number', parts: 'numbers', total: 'number', positive: 'boolean?' },
  'combinatorics.enumerate': { items: 'strings', kind: 'choice', r: 'number?' },
  'combinatorics.inclusion': { sets: 'strings', sizes: 'list' },
  'combinatorics.pascal': { n: 'number' },
  'combinatorics.pigeonhole': { objects: 'number', boxes: 'number' },
  'constants.compare': { id: 'text', value: 'number', uncertainty: 'number?' },
  'constants.get': { id: 'text' },
  'constants.search': { text: 'text?' },
  'control.roots': { coefficients: 'numbers' },
  'control.routh': { coefficients: 'numbers' },
  'date.from-julian-day': { julianDayNumber: 'number', calendar: 'choice' },
  'date.leap-year': { year: 'number', calendar: 'choice' },
  'date.timeline': { events: 'list', relations: 'number?' },
  'dna.read': { sequence: 'text' },
  'dna.translate': { sequence: 'text' },
  'ecology.diversity': { counts: 'list' },
  'ecology.food-chain': { primaryProduction: 'number', levels: 'number' },
  'element.get': { element: 'text' },
  'entropy.mixing': { components: 'list' },
  'entropy.transfer': { heat: 'number', fromTemperature: 'number', toTemperature: 'number' },
  'enzyme.binding': { points: 'list' },
  'enzyme.inhibition': { control: 'list', inhibited: 'list' },
  'enzyme.kinetics': { points: 'list' },
  'farm.nutrients': { requirements: 'list' },
  'fit.compare': { x: 'numbers', y: 'numbers', families: 'list' },
  'fluid.continuity': { stations: 'list', fluid: 'text?' },
  'fluid.dimensionless': { number: 'choice' },
  'fluid.get': { fluid: 'text' },
  'fluid.pressure': { depth: 'number', fluid: 'text?' },
  'fluid.pump': { head: 'number', flowRate: 'number', efficiency: 'number?', fluid: 'text?' },
  'formula.parse': { formula: 'text' },
  'frames.from-cylindrical': { radius: 'number', azimuth: 'number', height: 'number', unit: 'choice' },
  'frames.from-euler': { angles: 'numbers', order: 'choice', unit: 'choice' },
  'frames.from-polar': { radius: 'number', angle: 'number', unit: 'choice' },
  'frames.from-spherical': { radius: 'number', polar: 'number', azimuth: 'number', unit: 'choice' },
  'frames.to-polar': { x: 'number', y: 'number', unit: 'choice' },
  'gas.get': { gas: 'text' },
  'geometry.claim': { id: 'text?', kind: 'choice', of: 'strings', describe: 'text?', xVariable: 'text?', yVariable: 'text?' },
  'geometry.conic': { A: 'number', B: 'number', C: 'number', D: 'number', E: 'number', F: 'number' },
  'geometry.solid': { shape: 'choice' },
  'gravity.compare-orbits': { orbits: 'list' },
  'gravity.field': { sources: 'list' },
  'gravity.pair': { mass1: 'number', mass2: 'number', separation: 'number' },
  'gravity.speeds': { centralMass: 'number', radius: 'number' },
  'heat.fin': { tip: 'text?', length: 'number', crossSectionArea: 'number', perimeter: 'number', conductivity: 'number', coefficient: 'number', baseTemperature: 'number', ambientTemperature: 'number' },
  'heat.lmtd': { hotInlet: 'number', hotOutlet: 'number', coldInlet: 'number', coldOutlet: 'number' },
  'heat.ntu': { overallCoefficient: 'number', area: 'number', hotCapacityRate: 'number', coldCapacityRate: 'number', hotInlet: 'number', coldInlet: 'number' },
  'heat.radiation': { surfaceTemperature: 'number', surroundingTemperature: 'number', emissivity: 'number', area: 'number?', viewFactor: 'number?' },
  'heat.resistance': { layers: 'list' },
  'heat.transient': { volume: 'number', surfaceArea: 'number', density: 'number', specificHeat: 'number', coefficient: 'number', conductivity: 'number', initialTemperature: 'number', ambientTemperature: 'number', samples: 'number?' },
  'inherit.cross': { first: 'text', second: 'text' },
  'inherit.linkage': { parentalOne: 'number', parentalTwo: 'number', recombinantOne: 'number', recombinantTwo: 'number' },
  'interpolate.at': { x: 'numbers', y: 'numbers', kind: 'choice', count: 'number?', at: 'numbers' },
  'interpolate.build': { x: 'numbers', y: 'numbers', kind: 'choice', count: 'number?', at: 'numbers' },
  'interpolate.grid': { x: 'numbers', y: 'numbers', kind: 'choice', count: 'number?', at: 'numbers' },
  'kidney.function': { creatinine: 'number', age: 'number' },
  'layout.scale': { ratio: 'text?', ratioValue: 'number?', base: 'number', up: 'number?', down: 'number?', round: 'boolean?' },
  'light.blackbody': { temperature: 'number', samples: 'number?', trace: 'number?' },
  'magnet.flux': { fieldStrength: 'number', area: 'number', turns: 'number?' },
  'magnet.induction': { fluxChange: 'number', timeInterval: 'number', turns: 'number?' },
  'magnet.loop': { current: 'number', radius: 'number', axialDistance: 'number?', turns: 'number?' },
  'magnet.motional': { fieldStrength: 'number', rodLength: 'number', speed: 'number' },
  'magnet.solenoid': { current: 'number', turns: 'number', length: 'number', coreRelativePermeability: 'number?' },
  'material.get': { material: 'text' },
  'material.list': { materialClass: 'text?' },
  'material.mixture': { fibreModulus: 'number', matrixModulus: 'number', fibreVolumeFraction: 'number' },
  'material.property': { material: 'text', property: 'text' },
  'matrix.orthogonalise': { project: 'boolean?', vector: 'numbers' },
  'measure.agreement': { ratings: 'list' },
  'measure.inequality': { values: 'numbers', curvePoints: 'number?' },
  'measurement.figures': { written: 'text' },
  'measurement.propagate': { inputs: 'list', names: 'strings', expression: 'text', samples: 'number?', seed: 'number?', level: 'number?' },
  'measurement.repeated': { readings: 'numbers', unit: 'text', provenance: 'choice', note: 'text?' },
  'motion.circular': { radius: 'number', mass: 'number', tangentialAcceleration: 'number?' },
  'motion.compare-projectile': { speed: 'number', angle: 'number', height: 'number?', gravity: 'number?', drag: 'choice', coefficient: 'number?', mass: 'number?' },
  'motion.phases': { phases: 'list', position: 'number?', velocity: 'number?' },
  'motion.projectile': { speed: 'number', angle: 'number', height: 'number?', gravity: 'number?' },
  'motion.river': { boatSpeed: 'number', riverSpeed: 'number', width: 'number', heading: 'number?' },
  'motion.vertical-circle': { radius: 'number', mass: 'number', speedAtBottom: 'number', gravity: 'number?', canPull: 'boolean?' },
  'music.chord': { root: 'text', quality: 'choice' },
  'music.frequency': { note: 'text', tuning: 'choice', referenceA4: 'number?' },
  'music.note': { note: 'text' },
  'music.scale': { tonic: 'text', scale: 'choice' },
  'music.tempo': { beatsPerMinute: 'number', beatsPerBar: 'number?', beatUnit: 'number?' },
  'nucleus.binding': { protons: 'number', neutrons: 'number', atomicMass: 'number', includesElectrons: 'boolean?' },
  'nucleus.decay': { halfLife: 'number', initialCount: 'number', elapsed: 'number' },
  'number.sieve': { limit: 'number' },
  'optics.critical-angle': { fromIndex: 'number', toIndex: 'number' },
  'optics.double-slit': { wavelength: 'number', slitSeparation: 'number', screenDistance: 'number', samples: 'number?', maxOrder: 'number?' },
  'optics.fibre': { coreIndex: 'number', claddingIndex: 'number', surroundingIndex: 'number?' },
  'optics.grating': { wavelength: 'number', incidentAngleDegrees: 'number?' },
  'optics.image': { optic: 'choice', objectDistance: 'number', focalLength: 'number', objectHeight: 'number?' },
  'optics.index': { material: 'text', wavelength: 'number' },
  'optics.lens-maker': { refractiveIndex: 'number', radius1: 'number', radius2: 'number', surroundingIndex: 'number?' },
  'optics.polarise': { incidentIntensity: 'number', angleDegrees: 'number', incidentPolarised: 'boolean?' },
  'optics.prism': { apexAngleDegrees: 'number', refractiveIndex: 'number', incidentAngleDegrees: 'number', surroundingIndex: 'number?' },
  'optics.refract': { incidentAngleDegrees: 'number', fromIndex: 'number', toIndex: 'number' },
  'optics.single-slit': { wavelength: 'number', slitWidth: 'number', screenDistance: 'number', samples: 'number?', maxOrder: 'number?' },
  'optics.system': { elements: 'list', objectDistance: 'number' },
  'optics.thin-film': { thickness: 'number', filmIndex: 'number', aboveIndex: 'number?', belowIndex: 'number?', wavelength: 'number', incidentAngleDegrees: 'number?', maxOrders: 'number?' },
  'optimise.constrained': { variables: 'strings', expression: 'text', constraints: 'list', start: 'numbers', rounds: 'number?' },
  'optimise.interval': { variable: 'text?', expression: 'text', from: 'number', to: 'number', unimodal: 'boolean?' },
  'optimise.linear': { constraints: 'list', objective: 'numbers', direction: 'choice' },
  'oscillator.coupled': { mass1: 'number', mass2: 'number', stiffness1: 'number', stiffness2: 'number', coupling: 'number' },
  'oscillator.damping': { mass: 'number', stiffness: 'number', damping: 'number?' },
  'oscillator.driven': { mass: 'number', stiffness: 'number', damping: 'number?', forceAmplitude: 'number', drivingFrequency: 'number' },
  'oscillator.harmonic': { mass: 'number', stiffness: 'number', initialDisplacement: 'number?', initialVelocity: 'number?' },
  'oscillator.pendulum-period': { length: 'number', gravity: 'number?', amplitudeDegrees: 'number' },
  'plan.buffer': { tasks: 'list', confidence: 'number?' },
  'plan.critical-path': { tasks: 'list' },
  'plan.estimate': { optimistic: 'number', likely: 'number', pessimistic: 'number' },
  'plot.axis': { values: 'numbers', scale: 'choice', label: 'text?', includeZero: 'boolean?' },
  'plot.decimate': { target: 'number?' },
  'plot.function': { variable: 'text?', expression: 'text', from: 'number', to: 'number', label: 'text?' },
  'plot.parametric': { parameter: 'text?', x: 'text', y: 'text', from: 'number', to: 'number', label: 'text?' },
  'plot.points': { series: 'list', id: 'text?', title: 'text?', equalAspect: 'boolean?' },
  'plot.polar': { parameter: 'text?', expression: 'text', from: 'number?', to: 'number?', label: 'text?' },
  'population.growth': { initialSize: 'number', growthRate: 'number', duration: 'number' },
  'population.life-table': { rows: 'list' },
  'population.mark-recapture': { marked: 'number', recaptureSample: 'number', recapturedMarked: 'number' },
  'population.predator-prey': { prey: 'number', predator: 'number', preyGrowth: 'number', predationRate: 'number', predatorDeath: 'number', conversionRate: 'number', duration: 'number' },
  'precision.agree': { a: 'number', b: 'number', figures: 'number' },
  'precision.chain': { steps: 'list' },
  'precision.combine': { operation: 'choice' },
  'precision.read': { text: 'text' },
  'precision.represent': { value: 'number' },
  'precision.round': { value: 'number', mode: 'choice', figures: 'number' },
  'precision.write': { value: 'number', figures: 'number', notation: 'choice' },
  'process.conversion': { reactantIn: 'number', reactantOut: 'number', stoichiometricRatio: 'number?' },
  'process.mass-balance': { inlets: 'list', outlets: 'list', tolerance: 'number?' },
  'process.raoult': { components: 'list' },
  'process.reactor': { kind: 'text?', rateConstant: 'number', order: 'number?', inletConcentration: 'number', conversion: 'number' },
  'protein.properties': { sequence: 'text' },
  'quake.arrivals': { distance: 'number', pVelocity: 'number?', sVelocity: 'number?' },
  'quantum.box': { particle: 'text?', width: 'number', levels: 'number?', densityFor: 'number?', samples: 'number?', trace: 'number?' },
  'quantum.expectation': { outcomes: 'list' },
  'quantum.hydrogen': { atomicNumber: 'number?', levels: 'number?' },
  'quantum.measure': { amplitudes: 'list', requireNormalised: 'boolean?' },
  'quantum.tunnelling': { particle: 'text?', particleEnergy: 'number', barrierHeight: 'number', barrierWidth: 'number' },
  'reaction.balance': { reactants: 'strings', products: 'strings' },
  'reaction.cell': { cathodePotential: 'number', anodePotential: 'number', electrons: 'number', reactionQuotient: 'number?' },
  'reaction.equilibrium': { constant: 'number', reactants: 'list', products: 'list' },
  'reaction.rate': { order: 'number?', rateConstant: 'number', initialConcentration: 'number', samples: 'number?', trace: 'number?' },
  'reaction.thermochemistry': { reactants: 'list', products: 'list' },
  'relation.properties': { members: 'strings', pairs: 'list', what: 'choice' },
  'revise.plan': { topics: 'list', minutesPerDay: 'number', days: 'number', minimumBlock: 'number?' },
  'revise.retention': { curve: 'choice', elapsedDays: 'number', stability: 'number', threshold: 'number?', samples: 'number?', trace: 'number?' },
  'revise.workload': { cards: 'list', days: 'number', secondsPerReview: 'number?', trace: 'number?' },
  'rock.get': { rock: 'text' },
  'rock.slope': { slopeAngle: 'number', frictionAngle: 'number', depth: 'number', unitWeight: 'number', cohesion: 'number?', waterTableHeight: 'number?', waterUnitWeight: 'number?' },
  'rotation.composite': { parts: 'list' },
  'rotation.inertia': { shape: 'choice', mass: 'number', size: 'number' },
  'rotation.race': { shapes: 'strings', slopeDegrees: 'number', gravity: 'number?', distance: 'number' },
  'rotation.rolling': { shape: 'choice', slopeDegrees: 'number', gravity: 'number?' },
  'rotation.shift-axis': { aboutCentreOfMass: 'number', mass: 'number', distance: 'number' },
  'rotation.spin': { inertia: 'number', torque: 'number', initialAngularVelocity: 'number?', initialAngle: 'number?', time: 'number' },
  'shaft.torsion': { torque: 'number', outerDiameter: 'number', innerDiameter: 'number?' },
  'signal.cross-correlation': { a: 'numbers', b: 'numbers' },
  'signal.uniformity': { times: 'numbers', tolerance: 'number?' },
  'simulate.integrate': { variables: 'strings', rates: 'strings', time: 'text?', from: 'number?', start: 'numbers', to: 'number', method: 'choice', tracePoints: 'number?' },
  'simulate.invariant': { variables: 'strings', time: 'text?', rates: 'strings', quantity: 'text', from: 'number?', start: 'numbers', to: 'number', method: 'choice', allowedDrift: 'number?' },
  'simulate.montecarlo': { expression: 'text', runs: 'number?', seed: 'number?', level: 'number?' },
  'simulate.sensitivity': { expression: 'text', fraction: 'number?', bounds: 'list' },
  'simulate.steps': { variables: 'strings', rates: 'strings', time: 'text?', from: 'number?', start: 'numbers', to: 'number', steps: 'numbers', method: 'choice' },
  'simulate.sweep': { axes: 'list', expression: 'text' },
  'solution.colligative': { molality: 'number' },
  'solution.ph': { kind: 'text?', concentration: 'number' },
  'solution.solubility': { commonIonIs: 'text?', ksp: 'number', formula: 'text?', cationCount: 'number?', anionCount: 'number?' },
  'solution.titration': { analyte: 'text?', analyteConcentration: 'number', analyteVolume: 'number', titrantConcentration: 'number', samples: 'number?', trace: 'number?' },
  'sound.beats': { frequency1: 'number', frequency2: 'number' },
  'sound.combine-levels': { levels: 'numbers' },
  'sound.decibels': { value: 'number', reference: 'choice' },
  'sound.distance': { referenceLevel: 'number', referenceDistance: 'number', distance: 'number', spreading: 'choice' },
  'sound.doppler': { sourceFrequency: 'number', sourceSpeed: 'number?', observerSpeed: 'number?', windSpeed: 'number?' },
  'sound.interval': { lower: 'number', upper: 'number' },
  'sound.note': { frequency: 'number', referenceA4: 'number?' },
  'sound.pipe': { kind: 'choice', length: 'number', count: 'number?' },
  'sound.string': { length: 'number', tension: 'number', count: 'number?' },
  'stat.boltzmann': { levels: 'list', unit: 'text?', temperature: 'number' },
  'stat.heat-capacity': { shape: 'text?', temperature: 'number', vibrationalModes: 'number?' },
  'stat.occupancy': { unit: 'text?', energy: 'number', chemicalPotential: 'number?', temperature: 'number' },
  'statics.centroid': { pieces: 'list' },
  'statics.slope': { mass: 'number', slopeDegrees: 'number', staticCoefficient: 'number' },
  'statics.truss': { nodes: 'list', members: 'list' },
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
  'text.distance': { first: 'text', second: 'text', operations: 'number?' },
  'text.overlap': { first: 'text', second: 'text', listLength: 'number?' },
  'text.phonetic': { word: 'text' },
  'text.readability': { text: 'text', topWords: 'number?' },
  'text.stats': { text: 'text', topWords: 'number?' },
  'text.syllables': { words: 'strings' },
  'water.return-period': { returnPeriod: 'number' },
  'water.well': { pumpingRate: 'number', transmissivity: 'number', storativity: 'number', distance: 'number', time: 'number' },
  'wave.standing': { length: 'number', speed: 'number', harmonic: 'number', boundary: 'choice' },
  'weather.stability': { lowerTemperature: 'number', upperTemperature: 'number', heightDifference: 'number', saturatedRate: 'number?' },
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
  'algebra.sequence': { what: ['terms', 'analyse'], kind: ['arithmetic', 'geometric', 'recursive', 'explicit'] },
  'algebra.series': { knownForm: ['geometric', 'harmonic', 'p-series'] },
  'algebra.simplify': { domain: ['real', 'positive', 'non-negative', 'non-zero', 'integer', 'natural', 'complex'] },
  'calculus.pde': { which: ['heat', 'wave'] },
  'capacitor.combine': { arrangement: ['series', 'parallel'] },
  'circuit.resistors': { arrangement: ['series', 'parallel'] },
  'circuit.resonance': { arrangement: ['series', 'parallel'] },
  'circuit.rlc': { arrangement: ['series', 'parallel'] },
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
  'sound.distance': { spreading: ['spherical', 'cylindrical'] },
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
