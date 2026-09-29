/**
 * The modern-physics bridge, tested through the door a Page actually knocks on.
 *
 * The engines have their own tests. What is checked here is the boundary: that every advertised operation has an
 * implementation, that nothing draws a random number, that the second law is enforced across the door, and that a
 * refusal arrives as a value with a reason on it.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MODERN_PHYSICS_CAPABILITY, MODERN_PHYSICS_LIMITS, runModernPhysicsOperation } from './modernPhysicsEngines.ts'
import { BadInput } from './engines.ts'

const run = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> =>
  runModernPhysicsOperation(operation, input) as Record<string, unknown>

const ok = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> => {
  const result = run(operation, input)
  assert.equal(result.ok, true, `${operation} failed: ${String(result.message ?? '')}`)
  return result
}

const near = (actual: unknown, expected: number, tolerance: number, what: string): void => {
  assert.equal(typeof actual, 'number', `${what} is not a number`)
  assert.ok(Math.abs((actual as number) - expected) <= tolerance, `${what}: got ${actual}, expected about ${expected}`)
}

test('every advertised operation has an implementation', () => {
  for (const operation of Object.keys(MODERN_PHYSICS_CAPABILITY)) {
    try {
      runModernPhysicsOperation(operation, {})
    } catch (error) {
      assert.ok(error instanceof BadInput, `${operation} threw something other than BadInput: ${String(error)}`)
      assert.ok(
        !/is not a modern-physics operation/.test(error.message),
        `${operation} is advertised but has no implementation`
      )
    }
  }
})

test('every operation asks for the same capability, and it is the modern-physics one', () => {
  for (const [operation, capability] of Object.entries(MODERN_PHYSICS_CAPABILITY)) {
    assert.equal(capability, 'computation.modern-physics', `${operation} asks for something else`)
  }
})

test('an operation nobody advertises is refused', () => {
  assert.throws(() => runModernPhysicsOperation('quantum.collapse-the-universe', {}), BadInput)
})

test('nothing on this path draws a random number or reads the clock', () => {
  // A quantum measurement returns probabilities and never an outcome. A Math.random anywhere in this stack would let
  // an engine appear to know what the universe did, so it is checked rather than trusted.
  const here = dirname(fileURLToPath(import.meta.url))
  const files = [
    join(here, 'modernPhysicsEngines.ts'),
    join(here, '..', '..', 'shared', 'compute', 'thermodynamics.ts'),
    join(here, '..', '..', 'shared', 'compute', 'statisticalMechanics.ts'),
    join(here, '..', '..', 'shared', 'compute', 'relativity.ts'),
    join(here, '..', '..', 'shared', 'compute', 'quantum.ts')
  ]
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const forbidden of ['Math.random(', 'Date.now(', 'new Date(', 'crypto.']) {
      assert.ok(!source.includes(forbidden), `${file} uses ${forbidden}`)
    }
  }
})

// ---------------------------------------------------------------- thermodynamics

test('a mole of gas at standard conditions comes back through the door', () => {
  const result = ok('gas.state', { moles: 1, pressure: 101325, temperature: 273.15 })
  near(result.volume, 0.0224, 0.0002, 'the molar volume at STP')
  assert.equal(result.ideal, true)
})

test('a Celsius temperature is refused with the conversion', () => {
  const result = run('gas.state', { moles: 1, pressure: 101325, temperature: -20 })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('kelvin'))
})

test('four quantities that disagree are refused rather than three being preferred', () => {
  const result = run('gas.state', { moles: 1, pressure: 101325, temperature: 300, volume: 1 })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'no-solution')
})

test('a gas nobody stocks is refused with the list', () => {
  const result = run('gas.get', { gas: 'phlogiston' })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('helium'))
})

test('a process satisfies the first law and its path is thinned on the way out', () => {
  const base = {
    process: 'adiabatic',
    gas: 'air',
    moles: 1,
    fromPressure: 100000,
    fromTemperature: 300,
    toVolume: 0.01,
    samples: 800
  }
  const full = ok('gas.process', { ...base, trace: 800 })
  const thinned = ok('gas.process', { ...base, trace: 25 })
  assert.equal((full.path as unknown[]).length, 800)
  assert.equal((thinned.path as unknown[]).length, 25)
  assert.equal(thinned.work, full.work, 'the work comes from the formula, not the path')
  near(full.heat, (full.internalEnergyChange as number) + (full.work as number), 1e-6, 'the first law')
})

test('a trace cannot be asked for more samples than the door allows', () => {
  const result = ok('gas.process', {
    process: 'isothermal',
    moles: 1,
    fromPressure: 100000,
    fromTemperature: 300,
    toVolume: 0.02,
    trace: 1_000_000
  })
  assert.ok((result.path as unknown[]).length <= MODERN_PHYSICS_LIMITS.samples)
})

test('a process nobody defined is refused', () => {
  assert.throws(
    () => runModernPhysicsOperation('gas.process', { process: 'magical', moles: 1, fromPressure: 1e5, fromVolume: 0.01, toVolume: 0.02 }),
    BadInput
  )
})

test('a cycle that would beat Carnot is refused across the door', () => {
  const result = run('cycle.efficiency', {
    cycle: 'otto',
    compressionRatio: 20,
    gamma: 1.4,
    hotTemperature: 400,
    coldTemperature: 300
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'second-law')
})

test('an engine reports its efficiency and a fridge reports a coefficient of performance', () => {
  const engine = ok('cycle.efficiency', { cycle: 'carnot', hotTemperature: 600, coldTemperature: 300 })
  near(engine.efficiency, 0.5, 1e-12, 'the Carnot efficiency')
  assert.equal(engine.coefficientOfPerformance, null)

  const fridge = ok('cycle.efficiency', { cycle: 'refrigeration', hotTemperature: 300, coldTemperature: 270 })
  assert.equal(fridge.efficiency, null, 'a fridge has no efficiency')
  assert.ok((fridge.coefficientOfPerformance as number) > 1)
})

test('heat flowing from cold to hot unaided is refused', () => {
  const result = run('entropy.transfer', { heat: 1000, fromTemperature: 280, toTemperature: 320 })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'second-law')
  assert.ok((result.message as string).includes('fridge'))
})

test('mixing generates entropy and the lost work follows', () => {
  const result = ok('entropy.mixing', { components: [{ moles: 1 }, { moles: 1 }], temperature: 300 })
  assert.ok((result.entropyChange as number) > 0)
  near(result.lostWork, 300 * (result.entropyChange as number), 1e-9, 'entropy times temperature')
})

test('crossing a phase boundary without its latent heat is refused', () => {
  const result = run('heat.phase-change', {
    mass: 1,
    fromTemperature: 300,
    toTemperature: 400,
    liquidHeatCapacity: 4186,
    boilingPoint: 373.15
  })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('latent heat'))
})

// ---------------------------------------------------------------- statistical mechanics

test('a Boltzmann distribution normalises and reports energies in kT', () => {
  const result = ok('stat.boltzmann', { temperature: 300, levels: [{ energy: 0 }, { energy: 0.05 }], unit: 'electron-volts' })
  const levels = result.levels as { probability: number; energyInKt: number }[]
  near(levels.reduce((sum, one) => sum + one.probability, 0), 1, 1e-12, 'the probabilities partition')
  assert.ok(levels[1].energyInKt > 1)
})

test('a unit nobody defined is refused', () => {
  assert.throws(
    () => runModernPhysicsOperation('stat.boltzmann', { temperature: 300, levels: [{ energy: 0 }], unit: 'ergs' }),
    BadInput
  )
})

test('the speed distribution is thinned without moving its speeds', () => {
  const base = { temperature: 300, molarMass: 0.028, samples: 1000 }
  const full = ok('stat.speeds', { ...base, trace: 1000 })
  const thinned = ok('stat.speeds', { ...base, trace: 20 })
  assert.equal((full.distribution as unknown[]).length, 1000)
  assert.equal((thinned.distribution as unknown[]).length, 20)
  assert.equal(thinned.rootMeanSquare, full.rootMeanSquare, 'the speeds come from formulas, not the curve')
})

test('heat capacity freezes rotation out at low temperature', () => {
  const cold = ok('stat.heat-capacity', { temperature: 20, shape: 'linear', rotationalTemperature: 85 })
  const warm = ok('stat.heat-capacity', { temperature: 300, shape: 'linear', rotationalTemperature: 85 })
  assert.ok((cold.cv as number) < (warm.cv as number) * 0.7, 'cold hydrogen behaves like a monatomic gas')
  assert.ok((cold.warnings as string[]).length > 0)
})

test('a molecular shape nobody defined is refused', () => {
  assert.throws(() => runModernPhysicsOperation('stat.heat-capacity', { temperature: 300, shape: 'wiggly' }), BadInput)
})

test('a mole of microstates comes back as a logarithm', () => {
  const result = ok('stat.microstates', { particles: 6.022e23, states: 2 })
  assert.equal(result.microstates, null, 'far past what a float holds')
  assert.ok((result.logMicrostates as number) > 1e23)
  assert.ok((result.warnings as string[]).length > 0)
})

test('a boson state at the chemical potential is refused as the condensation point', () => {
  const result = run('stat.occupancy', { statistics: 'bose-einstein', energy: 0, chemicalPotential: 0, temperature: 300 })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('condensation'))
})

test('a fermion state at the Fermi level is exactly half full', () => {
  const result = ok('stat.occupancy', { statistics: 'fermi-dirac', energy: 0, chemicalPotential: 0, temperature: 300 })
  near(result.occupancy, 0.5, 1e-12, 'half full at any temperature')
  assert.equal((result.others as unknown[]).length, 2, 'and the other two statistics are reported alongside')
})

// ---------------------------------------------------------------- relativity

test('light speed and above are refused rather than returning infinity', () => {
  const atC = run('fast.lorentz', { beta: 1 })
  assert.equal(atC.ok, false)
  assert.equal(atC.error, 'faster-than-light')
  const above = run('fast.lorentz', { beta: 2 })
  assert.equal(above.ok, false)
})

test('the Lorentz factor and its consequences come back together', () => {
  const result = ok('fast.lorentz', { beta: 0.8, properTime: 1, restLength: 1 })
  near(result.gamma, 5 / 3, 1e-12, 'the classic case')
  near(result.lengthContraction, 0.6, 1e-12, 'lengths measure 60%')
  const interval = result.overInterval as { coordinateSeconds: number }
  near(interval.coordinateSeconds, 5 / 3, 1e-12, 'and a second of proper time is 1.67 s in the other frame')
})

test('adding two large speeds stays below light', () => {
  const result = ok('fast.add-velocities', { firstBeta: 0.9, secondBeta: 0.9 })
  assert.ok((result.beta as number) < 1)
  near(result.beta, 1.8 / 1.81, 1e-12, 'the relativistic sum')
})

test('rest energies match their published values and two motion inputs are refused', () => {
  const electron = ok('fast.mass-energy', { particle: 'electron', beta: 0 })
  near(electron.restEnergyMev, 0.511, 0.001, 'the electron rest energy')
  const both = run('fast.mass-energy', { particle: 'electron', beta: 0.5, gamma: 2 })
  assert.equal(both.ok, false)
})

test('a particle nobody defined is refused', () => {
  assert.throws(() => runModernPhysicsOperation('fast.mass-energy', { particle: 'muon', beta: 0.5 }), BadInput)
})

test('the transverse Doppler shift exists where the classical formula predicts none', () => {
  const result = ok('fast.doppler', { sourceFrequency: 1e9, beta: 0.5, angleDegrees: 90 })
  near(result.factor, Math.sqrt(0.75), 1e-12, 'pure time dilation')
  near(result.classicalFactor, 1, 1e-12, 'and nothing classically')
})

// ---------------------------------------------------------------- light and nuclei

test('a photon reports its energy in electronvolts and its band', () => {
  const result = ok('light.photon', { wavelength: 500e-9 })
  near(result.energyElectronVolts, 2.48, 0.01, 'a green photon')
  assert.equal(result.band, 'visible light')
})

test('two photon properties at once are refused', () => {
  const result = run('light.photon', { wavelength: 500e-9, frequency: 6e14 })
  assert.equal(result.ok, false)
})

test('the photoelectric threshold blocks light below it', () => {
  const result = ok('light.photoelectric', { workFunction: 4.5, wavelength: 500e-9 })
  assert.equal(result.emits, false)
  assert.ok((result.warnings as string[]).some((w) => w.includes('no amount of intensity')))
})

test('a blackbody spectrum is thinned without moving the peak', () => {
  const full = ok('light.blackbody', { temperature: 5772, samples: 800, trace: 800 })
  const thinned = ok('light.blackbody', { temperature: 5772, samples: 800, trace: 20 })
  assert.equal((full.spectrum as unknown[]).length, 800)
  assert.equal((thinned.spectrum as unknown[]).length, 20)
  assert.equal(thinned.peakWavelength, full.peakWavelength, 'the peak comes from Wien, not the curve')
  near(full.peakWavelength as number, 502e-9, 2e-9, 'the sun peaks in green')
})

test('a de Broglie wavelength needs something to compare against', () => {
  const result = ok('light.de-broglie', { particle: 'electron', kineticEnergyElectronVolts: 100, comparedWith: 1e-10 })
  assert.equal(result.quantumRegime, true)
  near((result.wavelength as number) * 1e12, 122.6, 1.5, 'the standard electron diffraction wavelength')
})

test('binding energy reports which direction releases energy', () => {
  const helium = ok('nucleus.binding', { protons: 2, neutrons: 2, atomicMass: 4.002602 })
  assert.equal(helium.releasesEnergyBy, 'fusion')
  near(helium.bindingEnergy, 28.3, 0.1, 'the helium-4 binding energy')

  const uranium = ok('nucleus.binding', { protons: 92, neutrons: 146, atomicMass: 238.05079 })
  assert.equal(uranium.releasesEnergyBy, 'fission')
})

test('decay halves at the half-life and the mean life is longer', () => {
  const result = ok('nucleus.decay', { halfLife: 100, initialCount: 1e6, elapsed: 100 })
  near(result.fractionRemaining, 0.5, 1e-12, 'one half-life')
  assert.ok((result.meanLifetime as number) > 100)
})

// ---------------------------------------------------------------- quantum

test('a box has a non-zero ground state and its density is thinned', () => {
  const full = ok('quantum.box', { width: 1e-9, particle: 'electron', samples: 800, trace: 800 })
  const thinned = ok('quantum.box', { width: 1e-9, particle: 'electron', samples: 800, trace: 15 })
  assert.ok((full.groundStateElectronVolts as number) > 0)
  near(full.groundStateElectronVolts, 0.376, 0.005, 'the standard 1 nm electron box')
  assert.equal((thinned.density as unknown[]).length, 15)
  assert.equal(thinned.groundStateEnergy, full.groundStateEnergy)
})

test('oscillator levels are equally spaced with half a quantum at the bottom', () => {
  const result = ok('quantum.oscillator', { frequency: 1e13, particle: 'proton', levels: 4 })
  near(result.zeroPointEnergy, (result.levelSpacing as number) / 2, 1e-30, 'half a quantum')
  const levels = result.levels as { energy: number }[]
  near(levels[1].energy - levels[0].energy, result.levelSpacing as number, 1e-30, 'the first gap')
  near(levels[3].energy - levels[2].energy, result.levelSpacing as number, 1e-30, 'and the last')
})

test('hydrogen gives the H-alpha line and a heavy nucleus is refused', () => {
  const result = ok('quantum.hydrogen', { from: 3, to: 2 })
  const transition = result.transition as { wavelengthNanometres: number; series: string }
  near(transition.wavelengthNanometres, 656.3, 1, 'the H-alpha line')
  assert.equal(transition.series, 'Balmer')

  const uranium = run('quantum.hydrogen', { atomicNumber: 92 })
  assert.equal(uranium.ok, false)
  assert.equal(uranium.error, 'outside-model')
})

test('tunnelling falls exponentially with thickness and reflects over the top', () => {
  const thin = ok('quantum.tunnelling', { particleEnergy: 1, barrierHeight: 5, barrierWidth: 0.5e-9 })
  const thick = ok('quantum.tunnelling', { particleEnergy: 1, barrierHeight: 5, barrierWidth: 1e-9 })
  assert.ok((thin.transmission as number) > (thick.transmission as number) * 100)

  const over = ok('quantum.tunnelling', { particleEnergy: 6, barrierHeight: 5, barrierWidth: 0.4e-9 })
  assert.equal(over.overTheTop, true)
  assert.ok((over.reflection as number) > 0, 'a classical particle would pass every time')
})

test('an uncertainty pair below the floor is refused', () => {
  const result = run('quantum.uncertainty', { first: 1e-12, second: 1e-24 })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('describing nothing'))
})

test('a measurement returns probabilities and no outcome', () => {
  const result = ok('quantum.measure', {
    amplitudes: [
      { label: 'up', real: 0.6 },
      { label: 'down', real: 0.8 }
    ]
  })
  const outcomes = result.outcomes as { label: string; probability: number }[]
  near(outcomes[0].probability, 0.36, 1e-12, 'amplitude squared')
  near(outcomes.reduce((sum, one) => sum + one.probability, 0), 1, 1e-12, 'they add to one')
  assert.ok(!Object.keys(result).some((one) => /\bresult\b|chosen|collapsed|actual/i.test(one)), 'no field claims an outcome')
})

test('an unnormalised state is normalised, or refused on request', () => {
  const scaled = ok('quantum.measure', { amplitudes: [{ label: 'a', real: 3 }, { label: 'b', real: 4 }] })
  near((scaled.outcomes as { probability: number }[])[0].probability, 9 / 25, 1e-12, 'nine twenty-fifths')
  const strict = run('quantum.measure', {
    amplitudes: [{ label: 'a', real: 3 }, { label: 'b', real: 4 }],
    requireNormalised: true
  })
  assert.equal(strict.ok, false)
  assert.equal(strict.error, 'not-normalised')
})

test('an expectation value need not be attainable', () => {
  const result = ok('quantum.expectation', {
    outcomes: [
      { label: 'up', value: 1, probability: 0.5 },
      { label: 'down', value: -1, probability: 0.5 }
    ]
  })
  near(result.expectation, 0, 1e-12, 'the average')
  near(result.standardDeviation, 1, 1e-12, 'the spread')
  assert.ok((result.warnings as string[]).some((w) => w.includes('not one of the possible outcomes')))
})

// ---------------------------------------------------------------- provenance

test('the constants and assumptions cover every domain this bridge answers for', () => {
  const constants = ok('modern.constants')
  const assumptions = ok('modern.assumptions')
  for (const domain of ['thermodynamics', 'statisticalMechanics', 'relativity', 'quantum']) {
    assert.ok(typeof constants[domain] === 'object' && constants[domain] !== null, `${domain} has no constants`)
    assert.ok(
      Array.isArray(assumptions[domain]) && (assumptions[domain] as unknown[]).length > 0,
      `${domain} has no assumptions listed`
    )
  }
})

test('the reference tables come back with their facts attached', () => {
  assert.ok((ok('gas.list').gases as unknown[]).length > 0)
  assert.ok(Object.keys(ok('gas.processes').facts as object).length > 0)
  assert.ok(Object.keys(ok('cycle.list').facts as object).length > 0)
  assert.ok(Object.keys(ok('stat.statistics').facts as object).length === 3)
})
