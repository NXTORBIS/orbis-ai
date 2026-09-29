/**
 * Fluids, heat transfer, control systems and robotics, checked against answers with an independent route.
 *
 * The hard cases here are the ones where an engine could plausibly return a number and be wrong: an iterated
 * friction factor that never actually iterated, a step response read off a second-order formula that does not
 * apply, an inverse-kinematics solver returning its last guess for a target it cannot reach. Each of those has a
 * test that would catch it.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FLUIDS,
  fluidById,
  pressureAtDepth,
  buoyancy,
  dimensionless,
  pipeFlow,
  energyEquation,
  continuity,
  pumpPerformance,
  openChannel,
  isFluidError
} from './fluids.ts'
import {
  resistanceNetwork,
  convection,
  radiation,
  straightFin,
  lmtd,
  effectivenessNtu,
  lumpedCapacitance,
  isHeatError
} from './heatTransfer.ts'
import {
  polynomialRoots,
  poleZero,
  closedLoop,
  stepResponse,
  bode,
  routhHurwitz,
  tunePid,
  simulatePid,
  isControlError
} from './controls.ts'
import {
  forwardKinematics,
  jacobian,
  inverseKinematics,
  trajectory,
  staticTorques,
  isRoboticsError,
  type DhLink
} from './robotics.ts'

const near = (actual: number, expected: number, tolerance: number, what: string): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: got ${actual}, expected about ${expected}`)
}

// ---------------------------------------------------------------- fluids

test('every fluid says where its properties came from', () => {
  for (const fluid of FLUIDS) {
    assert.ok(fluid.source.length > 0, `${fluid.id} has no source`)
    assert.ok(fluid.density > 0, `${fluid.id} has no density`)
  }
  assert.ok(!isFluidError(fluidById('water')))
  assert.ok(isFluidError(fluidById('custard')))
})

test('ten metres of water is about one atmosphere of gauge pressure', () => {
  const report = pressureAtDepth({ depth: 10, fluid: 'water' })
  assert.ok(!isFluidError(report), isFluidError(report) ? report.message : '')
  near(report.gaugePressure, 998 * 9.80665 * 10, 2000, 'rho g h')
  assert.ok(report.absolutePressure > report.gaugePressure, 'absolute includes the atmosphere above it')
})

test('a body denser than the fluid sinks and one lighter floats at the right depth', () => {
  const sinks = buoyancy({ objectVolume: 0.001, objectDensity: 7800, fluid: 'water' })
  assert.ok(!isFluidError(sinks), isFluidError(sinks) ? sinks.message : '')
  assert.equal(sinks.floats, false)
  assert.ok(sinks.netForce > 0, 'the net force is downward, which this reports as positive')

  const floats = buoyancy({ objectVolume: 0.001, objectDensity: 500, fluid: 'water' })
  assert.ok(!isFluidError(floats))
  assert.equal(floats.floats, true)
  near(floats.submergedFraction ?? 0, 500 / 998, 0.01, 'it floats with its density ratio submerged')
})

test('the Reynolds number names the regime it puts the flow in', () => {
  const slow = dimensionless({ number: 'reynolds', velocity: 0.001, length: 0.01, density: 998, dynamicViscosity: 1.002e-3 })
  assert.ok(!isFluidError(slow), isFluidError(slow) ? slow.message : '')
  assert.ok(slow.value < 2300)
  assert.ok((slow.regime ?? '').toLowerCase().includes('laminar'))

  const fast = dimensionless({ number: 'reynolds', velocity: 5, length: 0.05, density: 998, dynamicViscosity: 1.002e-3 })
  assert.ok(!isFluidError(fast))
  assert.ok(fast.value > 1e5)
})

test('a dimensionless number without the quantities it needs is refused', () => {
  const report = dimensionless({ number: 'reynolds', velocity: 1 })
  assert.ok(isFluidError(report))
})

test('laminar pipe flow gives exactly 64/Re and needs no iteration', () => {
  const report = pipeFlow({ diameter: 0.01, length: 10, velocity: 0.05, fluid: 'water' })
  assert.ok(!isFluidError(report), isFluidError(report) ? report.message : '')
  assert.equal(report.regime, 'laminar')
  near(report.frictionFactor, 64 / report.reynolds, 1e-9, '64/Re')
  assert.equal(report.iterations, null, 'a closed form does not iterate')
})

test('turbulent pipe flow actually iterates Colebrook and lands on a sane friction factor', () => {
  const report = pipeFlow({ diameter: 0.1, length: 100, velocity: 2, fluid: 'water', roughness: 0.000045 })
  assert.ok(!isFluidError(report), isFluidError(report) ? report.message : '')
  assert.equal(report.regime, 'turbulent')
  assert.ok((report.iterations ?? 0) > 0, 'Colebrook is implicit, so it must have iterated')
  assert.ok(report.frictionFactor > 0.01 && report.frictionFactor < 0.05, 'a normal commercial-pipe value')
  // The result has to satisfy the equation it claims to solve.
  const f = report.frictionFactor
  const left = 1 / Math.sqrt(f)
  const right = -2 * Math.log10(report.relativeRoughness / 3.7 + 2.51 / (report.reynolds * Math.sqrt(f)))
  near(left, right, 1e-6, 'the Colebrook residual')
  near(report.majorLoss, f * (100 / 0.1) * 0.5 * 998 * 4, report.majorLoss * 0.01, 'Darcy-Weisbach, in pascals')
  near(report.headLoss, report.totalLoss / (998 * 9.80665), report.headLoss * 0.01, 'and the same loss expressed in metres of water')
})

test('minor losses add to the major ones rather than replacing them', () => {
  const plain = pipeFlow({ diameter: 0.05, length: 20, velocity: 1.5, fluid: 'water' })
  const fitted = pipeFlow({ diameter: 0.05, length: 20, velocity: 1.5, fluid: 'water', minorLossCoefficients: [0.5, 0.9, 0.9] })
  assert.ok(!isFluidError(plain) && !isFluidError(fitted))
  near(fitted.majorLoss, plain.majorLoss, 1e-9, 'the pipe itself is unchanged')
  assert.ok(fitted.minorLoss > 0 && fitted.totalLoss > plain.totalLoss, 'the fittings add on top')
})

test('Bernoulli only applies when the losses are zero', () => {
  // Ten metres of fall turning entirely into speed. The heads balance exactly and the density cancels, so there
  // is nothing left over to be a loss.
  const speed = Math.sqrt(2 * 9.80665 * 10)
  const lossless = energyEquation({
    from: { pressure: 0, velocity: 0, elevation: 10 },
    to: { pressure: 0, velocity: speed, elevation: 0 },
    fluid: 'water'
  })
  assert.ok(!isFluidError(lossless), isFluidError(lossless) ? lossless.message : '')
  assert.equal(lossless.bernoulliApplies, true)

  const lossy = energyEquation({
    from: { pressure: 0, velocity: 0, elevation: 10 },
    to: { pressure: 0, velocity: speed, elevation: 0 },
    fluid: 'water',
    headLoss: 3
  })
  assert.ok(!isFluidError(lossy))
  assert.equal(lossy.bernoulliApplies, false, 'with a loss term this is the energy equation, not Bernoulli')
})

test('continuity speeds the flow up through a contraction', () => {
  const report = continuity({
    stations: [{ area: 0.01, velocity: 2 }, { area: 0.0025 }],
    fluid: 'water'
  })
  assert.ok(!isFluidError(report), isFluidError(report) ? report.message : '')
  near(report.stations[1].velocity, 8, 1e-9, 'a quarter of the area is four times the speed')
  assert.equal(report.incompressible, true, 'one density throughout')
})

test('continuity refuses a station with no area rather than throwing', () => {
  const report = continuity({ stations: [{ area: 0.01, velocity: 2 }, { area: 0 }], fluid: 'water' })
  assert.ok(isFluidError(report), 'every failure is a value the caller can read')
  assert.equal(report.error, 'invalid-argument')
})

test('a pump needs more shaft power than it delivers', () => {
  const report = pumpPerformance({ head: 30, flowRate: 0.02, efficiency: 0.7, fluid: 'water' })
  assert.ok(!isFluidError(report), isFluidError(report) ? report.message : '')
  near(report.hydraulicPower, 998 * 9.80665 * 0.02 * 30, 50, 'rho g Q H')
  near(report.shaftPower, report.hydraulicPower / 0.7, 1, 'divided by the efficiency')
  assert.ok(report.shaftPower > report.hydraulicPower)
})

test('a channel flowing fast is supercritical and slow is subcritical', () => {
  const slow = openChannel({ shape: 'rectangular', width: 5, depth: 2, slope: 0.0005, manningN: 0.03 })
  assert.ok(!isFluidError(slow), isFluidError(slow) ? slow.message : '')
  assert.equal(slow.regime, 'subcritical')
  assert.ok(slow.froude < 1)

  const fast = openChannel({ shape: 'rectangular', width: 5, depth: 0.2, slope: 0.05, manningN: 0.012 })
  assert.ok(!isFluidError(fast), isFluidError(fast) ? fast.message : '')
  assert.equal(fast.regime, 'supercritical')
  assert.ok(fast.froude > 1)
})

// ---------------------------------------------------------------- heat transfer

test('resistances in series add, and the dominant one is named', () => {
  const report = resistanceNetwork({
    geometry: 'plane',
    layers: [
      { label: 'brick', conductivity: 0.7, thickness: 0.1 },
      { label: 'insulation', conductivity: 0.04, thickness: 0.05 }
    ],
    area: 1,
    insideTemperature: 293,
    outsideTemperature: 273
  })
  assert.ok(!isHeatError(report), isHeatError(report) ? report.message : '')
  const expected = 0.1 / 0.7 + 0.05 / 0.04
  near(report.totalResistance, expected, 1e-9, 'L/kA summed')
  assert.equal(report.dominantLayer, 'insulation', 'the thin insulating layer dominates')
  near(report.heatFlow ?? 0, 20 / expected, 1e-6, 'dT over R')
  const last = report.interfaceTemperatures?.[report.interfaceTemperatures.length - 1]
  near(last?.temperature ?? 0, 273, 1e-6, 'the temperatures land on the outside condition')
})

test('a cylindrical wall uses the log of the radius ratio', () => {
  const report = resistanceNetwork({
    geometry: 'cylindrical',
    layers: [{ conductivity: 50, innerRadius: 0.05, outerRadius: 0.06 }],
    length: 1
  })
  assert.ok(!isHeatError(report), isHeatError(report) ? report.message : '')
  near(report.totalResistance, Math.log(0.06 / 0.05) / (2 * Math.PI * 50 * 1), 1e-12, 'ln(r2/r1)/(2 pi k L)')
})

test('a convection correlation names itself and flags when it is being extrapolated', () => {
  const inside = convection({
    correlation: 'dittus-boelter',
    characteristicLength: 0.05,
    thermalConductivity: 0.6,
    prandtl: 7,
    velocity: 2,
    kinematicViscosity: 1e-6
  })
  assert.ok(!isHeatError(inside), isHeatError(inside) ? inside.message : '')
  assert.equal(inside.withinValidRange, true)
  near(inside.nusselt, 0.023 * Math.pow(inside.reynolds ?? 0, 0.8) * Math.pow(7, 0.4), 1e-6, 'Dittus-Boelter')
  near(inside.coefficient, (inside.nusselt * 0.6) / 0.05, 1e-6, 'h = Nu k / L')

  const outside = convection({
    correlation: 'dittus-boelter',
    characteristicLength: 0.05,
    thermalConductivity: 0.6,
    prandtl: 7,
    velocity: 0.01,
    kinematicViscosity: 1e-6
  })
  assert.ok(!isHeatError(outside))
  assert.equal(outside.withinValidRange, false, 'Re is far too low for this correlation')
  assert.ok(outside.warnings.length > 0, 'and it says so')
})

test('a forced correlation without a velocity is refused', () => {
  const report = convection({ correlation: 'flat-plate-laminar', characteristicLength: 1, thermalConductivity: 0.026, prandtl: 0.7 })
  assert.ok(isHeatError(report))
})

test('net radiation is far smaller than what the surface emits', () => {
  const report = radiation({ surfaceTemperature: 310, surroundingTemperature: 293, emissivity: 0.95, area: 1.8 })
  assert.ok(!isHeatError(report), isHeatError(report) ? report.message : '')
  assert.ok(report.emitted > report.net * 4, 'quoting the emitted term alone overstates the loss hugely')
  near(report.net, report.emitted - report.absorbed, 1e-9, 'net is the difference')
  assert.ok(report.equivalentCoefficient > 4 && report.equivalentCoefficient < 8, 'about 6 W/m2K near room temperature')
})

test('a Celsius temperature slipped into a radiation calculation is caught', () => {
  const report = radiation({ surfaceTemperature: 37, surroundingTemperature: 20, emissivity: 0.95 })
  assert.ok(!isHeatError(report))
  assert.ok(report.warnings.some((w) => w.includes('kelvin')), 'it warns rather than silently answering nonsense')
})

test('a short fat fin is called out as not worth fitting', () => {
  const bad = straightFin({
    length: 0.01,
    crossSectionArea: 0.001,
    perimeter: 0.14,
    conductivity: 200,
    coefficient: 500,
    baseTemperature: 350,
    ambientTemperature: 300
  })
  assert.ok(!isHeatError(bad), isHeatError(bad) ? bad.message : '')
  assert.ok(bad.effectiveness < 2, 'this fin barely beats the surface it covers')
  assert.ok(bad.warnings.length > 0, 'and the report says so')

  const good = straightFin({
    length: 0.1,
    crossSectionArea: 1e-5,
    perimeter: 0.02,
    conductivity: 200,
    coefficient: 20,
    baseTemperature: 350,
    ambientTemperature: 300
  })
  assert.ok(!isHeatError(good), isHeatError(good) ? good.message : '')
  assert.ok(good.effectiveness > 2, 'long, thin, poor convection — exactly where a fin earns its place')
  assert.ok(good.tipTemperature > 300 && good.tipTemperature < 350, 'the tip sits between base and ambient')
})

test('counter-flow beats parallel flow, and parallel flow refuses a crossed outlet', () => {
  const counter = lmtd({ arrangement: 'counter-flow', hotInlet: 400, hotOutlet: 350, coldInlet: 300, coldOutlet: 340 })
  // The cold stream leaves hotter than the hot stream does. Counter-flow manages it; parallel flow cannot.
  const parallel = lmtd({ arrangement: 'parallel-flow', hotInlet: 400, hotOutlet: 350, coldInlet: 300, coldOutlet: 360 })
  assert.ok(!isHeatError(counter), isHeatError(counter) ? counter.message : '')
  assert.ok(isHeatError(parallel), 'parallel flow cannot bring the cold outlet above the hot outlet')
  assert.equal(parallel.error, 'no-solution')
  near(counter.lmtd, (60 - 50) / Math.log(60 / 50), 1e-9, 'the log mean of the two ends')
})

test('effectiveness-NTU finds the outlets and parallel flow has a hard ceiling', () => {
  const counter = effectivenessNtu({
    arrangement: 'counter-flow',
    overallCoefficient: 500,
    area: 2,
    hotCapacityRate: 2000,
    coldCapacityRate: 4000,
    hotInlet: 400,
    coldInlet: 300
  })
  assert.ok(!isHeatError(counter), isHeatError(counter) ? counter.message : '')
  near(counter.ntu, (500 * 2) / 2000, 1e-12, 'UA over the smaller capacity rate')
  near(counter.capacityRatio, 0.5, 1e-12, 'the smaller rate over the larger')
  near(counter.heatDuty, 2000 * (400 - counter.hotOutlet), 1e-6, 'the hot stream gave up what the duty says')
  near(counter.heatDuty, 4000 * (counter.coldOutlet - 300), 1e-6, 'and the cold stream took it')
  assert.ok(counter.hotOutlet > 300 && counter.coldOutlet < 400, 'neither stream crosses the other inlet')

  const parallel = effectivenessNtu({
    arrangement: 'parallel-flow',
    overallCoefficient: 500,
    area: 200,
    hotCapacityRate: 2000,
    coldCapacityRate: 4000,
    hotInlet: 400,
    coldInlet: 300
  })
  assert.ok(!isHeatError(parallel))
  assert.ok(parallel.effectiveness <= 1 / (1 + 0.5) + 1e-9, 'however large the area, parallel flow saturates')
})

test('lumped cooling checks the Biot number rather than assuming it', () => {
  const thin = lumpedCapacitance({
    volume: 1e-6,
    surfaceArea: 6e-4,
    density: 8900,
    specificHeat: 385,
    coefficient: 20,
    conductivity: 400,
    initialTemperature: 400,
    ambientTemperature: 300
  })
  assert.ok(!isHeatError(thin), isHeatError(thin) ? thin.message : '')
  assert.equal(thin.lumpedValid, true)
  near(thin.samples[0].temperature, 400, 1e-9, 'it starts where it started')
  const oneTau = thin.samples.find((s) => Math.abs(s.time - thin.timeConstant) < thin.timeConstant * 0.05)
  assert.ok(oneTau && Math.abs(oneTau.temperature - (300 + 100 * Math.exp(-1))) < 2, 'one time constant closes 63% of the gap')

  const thick = lumpedCapacitance({
    volume: 1e-3,
    surfaceArea: 6e-2,
    density: 2400,
    specificHeat: 880,
    coefficient: 200,
    conductivity: 1.4,
    initialTemperature: 400,
    ambientTemperature: 300
  })
  assert.ok(!isHeatError(thick), isHeatError(thick) ? thick.message : '')
  assert.equal(thick.lumpedValid, false)
  assert.ok(thick.warnings.length > 0, 'a large Biot number invalidates the model and it says so')
})

test('a cooling body never reaches ambient, and asking when it does is refused', () => {
  const report = lumpedCapacitance({
    volume: 1e-6,
    surfaceArea: 6e-4,
    density: 8900,
    specificHeat: 385,
    coefficient: 20,
    conductivity: 400,
    initialTemperature: 400,
    ambientTemperature: 300,
    targetTemperature: 300
  })
  assert.ok(isHeatError(report))
  assert.equal(report.error, 'no-solution')
})

// ---------------------------------------------------------------- controls

test('polynomial roots come back where they were put', () => {
  // (s+1)(s+2)(s+3) = s^3 + 6s^2 + 11s + 6
  const roots = polynomialRoots([1, 6, 11, 6])
  assert.ok(!isControlError(roots), isControlError(roots) ? roots.message : '')
  const real = roots.map((r) => r.re).sort((a, b) => a - b)
  near(real[0], -3, 1e-6, 'first root')
  near(real[1], -2, 1e-6, 'second root')
  near(real[2], -1, 1e-6, 'third root')
  assert.ok(roots.every((r) => Math.abs(r.im) < 1e-6), 'and they are all real')
})

test('a complex pair reports its natural frequency and damping ratio', () => {
  // s^2 + 2*z*wn*s + wn^2 with wn = 2, z = 0.5
  const report = poleZero({ numerator: [4], denominator: [1, 2, 4] })
  assert.ok(!isControlError(report), isControlError(report) ? report.message : '')
  assert.equal(report.stable, true)
  const pair = report.poles.find((p) => p.kind === 'complex-pair')
  assert.ok(pair)
  near(pair.naturalFrequency ?? 0, 2, 1e-9, 'natural frequency')
  near(pair.dampingRatio ?? 0, 0.5, 1e-9, 'damping ratio')
  near(report.dcGain ?? 0, 1, 1e-12, 'unity at DC')
})

test('a right-half-plane pole is unstable and a right-half-plane zero is flagged separately', () => {
  const unstable = poleZero({ numerator: [1], denominator: [1, -1] })
  assert.ok(!isControlError(unstable))
  assert.equal(unstable.stable, false)
  assert.ok(unstable.warnings.some((w) => w.includes('right half plane')))

  const nmp = poleZero({ numerator: [1, -2], denominator: [1, 3, 2] })
  assert.ok(!isControlError(nmp))
  assert.equal(nmp.stable, true, 'the poles are fine')
  assert.equal(nmp.nonMinimumPhase, true, 'the zero is not')
})

test('closing a unity-feedback loop moves the poles where the algebra says', () => {
  // G = 1/(s+1); closed loop = 1/(s+2)
  const loop = closedLoop({ numerator: [1], denominator: [1, 1] })
  const report = poleZero(loop)
  assert.ok(!isControlError(report), isControlError(report) ? report.message : '')
  near(report.poles[0].value.re, -2, 1e-9, 'feedback pulls the pole left')
  near(report.dcGain ?? 0, 0.5, 1e-12, 'and halves the DC gain')
})

test('a first-order step response matches the exponential it should be', () => {
  const report = stepResponse({ numerator: [1], denominator: [1, 1] }, { duration: 5, samples: 501 })
  assert.ok(!isControlError(report), isControlError(report) ? report.message : '')
  near(report.finalValue ?? 0, 1, 1e-9, 'it settles at the DC gain')
  assert.equal(report.overshoot, null, 'first order never overshoots')
  const at1 = report.samples.find((s) => Math.abs(s.time - 1) < 0.01)
  near(at1?.output ?? 0, 1 - Math.exp(-1), 1e-4, 'one time constant is 63%')
  near(report.settlingTime ?? 0, 4, 0.1, 'four time constants to 2%')
})

test('a second-order step response overshoots by the amount the damping ratio predicts', () => {
  // wn = 1, zeta = 0.5 -> overshoot = exp(-pi*z/sqrt(1-z^2)) = 16.3%
  const report = stepResponse({ numerator: [1], denominator: [1, 1, 1] }, { duration: 20, samples: 2001 })
  assert.ok(!isControlError(report), isControlError(report) ? report.message : '')
  const predicted = Math.exp((-Math.PI * 0.5) / Math.sqrt(1 - 0.25))
  near(report.overshoot ?? 0, predicted, 0.01, 'the classical overshoot formula')
  near(report.peakTime ?? 0, Math.PI / Math.sqrt(1 - 0.25), 0.05, 'peak time')
})

test('an unstable system is reported as having no final value rather than a wrong one', () => {
  const report = stepResponse({ numerator: [1], denominator: [1, -1] }, { duration: 3, samples: 100 })
  assert.ok(!isControlError(report), isControlError(report) ? report.message : '')
  assert.equal(report.stable, false)
  assert.equal(report.finalValue, null)
  assert.equal(report.settlingTime, null)
  assert.ok(report.warnings.length > 0)
})

test('Bode finds the crossover and margins of a known loop', () => {
  // 1/(s(s+1)): crossover near 0.786 rad/s, phase margin about 51.8 degrees.
  const report = bode({ numerator: [1], denominator: [1, 1, 0] }, { from: 0.01, to: 100, points: 2000 })
  assert.ok(!isControlError(report), isControlError(report) ? report.message : '')
  near(report.gainCrossover ?? 0, 0.786, 0.02, 'gain crossover')
  near(report.phaseMargin ?? 0, 51.8, 1.5, 'phase margin')
  assert.equal(report.phaseCrossover, null, 'this loop never reaches -180, so it has no gain margin')
})

test('a loop with too little phase margin is warned about', () => {
  // A high-gain third-order loop: stable by a hair.
  const report = bode({ numerator: [50], denominator: [1, 6, 11, 6] }, { from: 0.01, to: 100, points: 2000 })
  assert.ok(!isControlError(report), isControlError(report) ? report.message : '')
  assert.ok(report.phaseMargin !== null && report.phaseMargin < 30)
  assert.ok(report.warnings.some((w) => w.includes('phase margin')))
})

test('Routh-Hurwitz counts the right-half-plane roots', () => {
  const stable = routhHurwitz([1, 6, 11, 6])
  assert.ok(!isControlError(stable), isControlError(stable) ? stable.message : '')
  assert.equal(stable.rightHalfPlanePoles, 0)
  assert.equal(stable.stable, true)

  // s^3 + s^2 + 2s + 8 has two roots in the right half plane.
  const unstable = routhHurwitz([1, 1, 2, 8])
  assert.ok(!isControlError(unstable), isControlError(unstable) ? unstable.message : '')
  assert.equal(unstable.stable, false)
  assert.equal(unstable.rightHalfPlanePoles, 2)
})

test('Routh-Hurwitz and root finding agree', () => {
  for (const coefficients of [[1, 2, 3, 4], [1, 5, 6], [2, 1, 3, 1, 1]]) {
    const routh = routhHurwitz(coefficients)
    const roots = polynomialRoots(coefficients)
    assert.ok(!isControlError(routh) && !isControlError(roots))
    const inRight = roots.filter((r) => r.re > 1e-9).length
    assert.equal(routh.rightHalfPlanePoles, inRight, `for ${coefficients.join(' ')}`)
  }
})

test('Ziegler-Nichols gives the gains it is supposed to, and its overshoot is shown', () => {
  const plant = { numerator: [1], denominator: [1, 3, 3, 1] }
  const report = tunePid({ rule: 'ziegler-nichols-ultimate', form: 'PID', ultimateGain: 8, ultimatePeriod: 3.63, plant })
  assert.ok(!isControlError(report), isControlError(report) ? report.message : '')
  near(report.gains.proportional, 0.6 * 8, 1e-9, 'Kp = 0.6 Ku')
  near(report.gains.integralTime ?? 0, 3.63 / 2, 1e-9, 'Ti = Pu/2')
  near(report.gains.derivativeTime ?? 0, 3.63 / 8, 1e-9, 'Td = Pu/8')
  assert.ok(report.response !== null, 'the closed loop was simulated, not described')
  assert.ok(report.fittedFor.length > 0 && report.behaviour.length > 0, 'the rule owns up to what it is')
})

test('Tyreus-Luyben is more conservative than Ziegler-Nichols on the same loop', () => {
  const zn = tunePid({ rule: 'ziegler-nichols-ultimate', form: 'PI', ultimateGain: 8, ultimatePeriod: 3.63 })
  const tl = tunePid({ rule: 'tyreus-luyben', form: 'PI', ultimateGain: 8, ultimatePeriod: 3.63 })
  assert.ok(!isControlError(zn) && !isControlError(tl))
  assert.ok(tl.gains.proportional < zn.gains.proportional, 'lower gain')
  assert.ok((tl.gains.integralTime ?? 0) > (zn.gains.integralTime ?? 0), 'and slower integral action')
})

test('a step-response rule with no dead time is refused rather than dividing by zero', () => {
  const report = tunePid({ rule: 'ziegler-nichols-step', processGain: 2, timeConstant: 10, deadTime: 0 })
  assert.ok(isControlError(report))
  assert.equal(report.error, 'degenerate')
})

test('actuator saturation and windup are simulated, not assumed away', () => {
  const plant = { numerator: [1], denominator: [1, 1] }
  const gains = { proportional: 5, integral: 10, derivative: 0 }
  const limited = simulatePid({ plant, gains, setpoint: 1, duration: 10, timeStep: 0.001, outputMinimum: -1, outputMaximum: 1, antiWindup: true })
  const wound = simulatePid({ plant, gains, setpoint: 1, duration: 10, timeStep: 0.001, outputMinimum: -1, outputMaximum: 1, antiWindup: false })
  assert.ok(!isControlError(limited), isControlError(limited) ? limited.message : '')
  assert.ok(!isControlError(wound), isControlError(wound) ? wound.message : '')
  assert.ok(limited.saturatedFraction > 0, 'the actuator does hit its limit')
  assert.ok(
    limited.absoluteErrorIntegral <= wound.absoluteErrorIntegral + 1e-9,
    'anti-windup does not make it worse, which is the whole point of it'
  )
  assert.ok(wound.warnings.some((w) => w.includes('anti-windup')), 'and running without it is warned about')
})

// ---------------------------------------------------------------- robotics

/** A planar two-link arm, the case where every answer can be checked by hand. */
const TWO_LINK: readonly DhLink[] = Object.freeze([
  { label: 'shoulder', d: 0, theta: 0, a: 1, alpha: 0 },
  { label: 'elbow', d: 0, theta: 0, a: 1, alpha: 0 }
])

test('a straight two-link arm reaches exactly its combined length', () => {
  const report = forwardKinematics(TWO_LINK, [0, 0])
  assert.ok(!isRoboticsError(report), isRoboticsError(report) ? report.message : '')
  near(report.pose.position.x, 2, 1e-12, 'straight out along x')
  near(report.pose.position.y, 0, 1e-12, 'and nothing off to the side')
  near(report.reach, 2, 1e-12, 'its whole length')
})

test('a folded two-link arm comes back to the base', () => {
  const report = forwardKinematics(TWO_LINK, [0, Math.PI])
  assert.ok(!isRoboticsError(report), isRoboticsError(report) ? report.message : '')
  near(report.pose.position.x, 0, 1e-9, 'folded back on itself')
  near(report.pose.position.y, 0, 1e-9, 'in both directions')
})

test('the arm reports joints pushed outside their declared limits', () => {
  const limited: DhLink[] = [
    { label: 'shoulder', d: 0, theta: 0, a: 1, alpha: 0, minimum: -1, maximum: 1 },
    { label: 'elbow', d: 0, theta: 0, a: 1, alpha: 0 }
  ]
  const report = forwardKinematics(limited, [2, 0])
  assert.ok(!isRoboticsError(report))
  assert.equal(report.outsideLimits.length, 1)
  assert.equal(report.outsideLimits[0].label, 'shoulder')
})

test('the Jacobian matches a numerical difference of the forward kinematics', () => {
  const at = [0.4, 0.7]
  const report = jacobian(TWO_LINK, at)
  assert.ok(!isRoboticsError(report), isRoboticsError(report) ? report.message : '')
  const h = 1e-6
  for (let j = 0; j < 2; j += 1) {
    const forward = forwardKinematics(TWO_LINK, at.map((v, i) => (i === j ? v + h : v)))
    const back = forwardKinematics(TWO_LINK, at.map((v, i) => (i === j ? v - h : v)))
    assert.ok(!isRoboticsError(forward) && !isRoboticsError(back))
    near(report.matrix[0][j], (forward.pose.position.x - back.pose.position.x) / (2 * h), 1e-5, `dx/dq${j}`)
    near(report.matrix[1][j], (forward.pose.position.y - back.pose.position.y) / (2 * h), 1e-5, `dy/dq${j}`)
  }
})

test('a fully extended arm is a singularity and says so', () => {
  const extended = jacobian(TWO_LINK, [0, 0])
  assert.ok(!isRoboticsError(extended), isRoboticsError(extended) ? extended.message : '')
  assert.equal(extended.singular, true)
  assert.ok(extended.warnings.some((w) => w.includes('singularity')))

  const bent = jacobian(TWO_LINK, [0.3, 1.2])
  assert.ok(!isRoboticsError(bent))
  assert.equal(bent.singular, false)
  assert.ok(bent.manipulability > extended.manipulability, 'a bent arm has more freedom than a straight one')
})

test('inverse kinematics finds a reachable point and the answer checks out forward', () => {
  const report = inverseKinematics({
    links: TWO_LINK,
    target: { position: { x: 1.2, y: 0.8, z: 0 } },
    initial: [0.5, 0.8],
    positionOnly: true
  })
  assert.ok(!isRoboticsError(report), isRoboticsError(report) ? report.message : '')
  assert.equal(report.converged, true)
  assert.ok(report.positionError < 1e-4, 'the error is measured by running it forward again')
  const check = forwardKinematics(TWO_LINK, report.values)
  assert.ok(!isRoboticsError(check))
  near(check.pose.position.x, 1.2, 1e-3, 'x really is where it was asked for')
  near(check.pose.position.y, 0.8, 1e-3, 'and y')
})

test('a target outside the workspace is reported as not reached, not approximated', () => {
  const report = inverseKinematics({
    links: TWO_LINK,
    target: { position: { x: 5, y: 0, z: 0 } },
    initial: [0.2, 0.4],
    positionOnly: true,
    maxIterations: 200
  })
  assert.ok(!isRoboticsError(report), isRoboticsError(report) ? report.message : '')
  assert.equal(report.converged, false, 'a two-metre arm cannot reach five metres')
  assert.ok(report.positionError > 2.5, 'and the residual says how far short it fell')
  assert.ok(report.warnings.length > 0, 'with a warning rather than a silent near-miss')
})

test('a trapezoidal move too short to reach cruise speed becomes a triangle', () => {
  const long = trajectory({ profile: 'trapezoidal', from: 0, to: 10, maximumVelocity: 2, maximumAcceleration: 1 })
  assert.ok(!isRoboticsError(long), isRoboticsError(long) ? long.message : '')
  assert.equal(long.triangular, false)
  near(long.peakVelocity, 2, 1e-6, 'it reaches the speed limit')
  assert.ok((long.phases?.cruise ?? 0) > 0, 'and holds it for a while')
  near(long.samples[long.samples.length - 1].position, 10, 1e-3, 'and arrives where it was sent')

  const short = trajectory({ profile: 'trapezoidal', from: 0, to: 0.5, maximumVelocity: 2, maximumAcceleration: 1 })
  assert.ok(!isRoboticsError(short), isRoboticsError(short) ? short.message : '')
  assert.equal(short.triangular, true)
  near(short.phases?.cruise ?? -1, 0, 1e-12, 'no cruise phase at all')
  near(short.samples[short.samples.length - 1].position, 0.5, 1e-3, 'still arrives')
})

test('quintic starts and ends without a jolt, and cubic does not', () => {
  const quintic = trajectory({ profile: 'quintic', from: 0, to: 1, duration: 2, samples: 201 })
  const cubic = trajectory({ profile: 'cubic', from: 0, to: 1, duration: 2, samples: 201 })
  assert.ok(!isRoboticsError(quintic) && !isRoboticsError(cubic))
  near(quintic.samples[0].acceleration, 0, 1e-9, 'quintic starts with zero acceleration')
  near(quintic.samples[quintic.samples.length - 1].acceleration, 0, 1e-9, 'and ends with it')
  assert.ok(Math.abs(cubic.samples[0].acceleration) > 0.5, 'cubic steps its acceleration at the start')
  assert.ok(quintic.peakVelocity > cubic.peakVelocity, 'the smoothness costs a higher peak speed')
})

test('static torques on a horizontal arm match the moment arms', () => {
  const report = staticTorques({
    links: TWO_LINK,
    values: [0, 0],
    force: { x: 0, y: -10, z: 0 }
  })
  assert.ok(!isRoboticsError(report), isRoboticsError(report) ? report.message : '')
  // The arm lies along x with the tip 2 m out; a 10 N downward tip force is 20 N*m at the shoulder and 10 at the elbow.
  near(Math.abs(report.torques[0].torque), 20, 1e-9, 'shoulder')
  near(Math.abs(report.torques[1].torque), 10, 1e-9, 'elbow')
})
