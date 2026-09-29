/**
 * Thermodynamics, statistical mechanics, relativity and quantum mechanics, checked against published values.
 *
 * The interesting cases are the ones where an engine could return a confident wrong answer: a cycle that beats
 * Carnot, heat flowing from cold to hot, a Lorentz factor above light speed, an uncertainty product below the floor,
 * a measurement that returns an outcome. Each of those has a test.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CYCLES,
  GASES,
  PROCESSES,
  cycle,
  entropyOfMixing,
  entropyTransfer,
  gasById,
  gasState,
  isThermoError,
  phaseHeat,
  process
} from './thermodynamics.ts'
import {
  boltzmannDistribution,
  heatCapacity,
  isStatMechError,
  microstateEntropy,
  speedDistribution,
  stateOccupancy
} from './statisticalMechanics.ts'
import {
  addVelocities,
  bindingEnergy,
  blackbody,
  deBroglie,
  isRelativityError,
  lorentz,
  massEnergy,
  photoelectric,
  photon,
  radioactiveDecay,
  relativisticDoppler
} from './relativity.ts'
import {
  expectationValue,
  harmonicOscillator,
  hydrogen,
  isQuantumError,
  measure,
  particleInBox,
  tunnelling,
  uncertainty
} from './quantum.ts'

const near = (actual: number, expected: number, tolerance: number, what: string): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: got ${actual}, expected about ${expected}`)
}

const relative = (actual: number, expected: number, fraction: number, what: string): void => {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * fraction,
    `${what}: got ${actual}, expected within ${fraction * 100}% of ${expected}`
  )
}

// ---------------------------------------------------------------- thermodynamics

test('every gas carries a source and a plausible gamma', () => {
  for (const one of GASES) {
    assert.ok(one.source.length > 0, `${one.id} has no source`)
    assert.ok(one.gamma > 1 && one.gamma <= 1.67 + 1e-9, `${one.id} has an impossible gamma`)
    assert.ok(one.molarMass > 0)
  }
  const monatomic = GASES.filter((one) => one.shape === 'monatomic')
  for (const one of monatomic) near(one.gamma, 5 / 3, 0.01, `${one.id} gamma`)
  assert.ok(isThermoError(gasById('phlogiston')))
})

test('a mole of ideal gas at standard conditions occupies 22.4 litres', () => {
  const report = gasState({ moles: 1, pressure: 101325, temperature: 273.15 })
  assert.ok(!isThermoError(report), isThermoError(report) ? report.message : '')
  relative(report.volume, 0.0224, 0.005, 'the molar volume at STP')
  assert.equal(report.ideal, true)
})

test('a Celsius temperature is refused with the conversion', () => {
  const report = gasState({ moles: 1, pressure: 101325, temperature: -20 })
  assert.ok(isThermoError(report))
  assert.ok(report.message.includes('kelvin'))
  assert.ok(report.message.includes('273'))
})

test('too few quantities cannot fix the fourth, and four that disagree are refused', () => {
  const two = gasState({ moles: 1, temperature: 300 })
  assert.ok(isThermoError(two))
  const four = gasState({ moles: 1, temperature: 300, pressure: 101325, volume: 1 })
  assert.ok(isThermoError(four))
  assert.equal(four.error, 'no-solution')
  const consistent = gasState({ moles: 1, temperature: 300, pressure: 101325, volume: (8.31446261815324 * 300) / 101325 })
  assert.ok(!isThermoError(consistent), 'four that do agree are accepted')
})

test('high pressure with no compressibility factor is flagged', () => {
  const report = gasState({ moles: 1, temperature: 300, pressure: 5e6 })
  assert.ok(!isThermoError(report))
  assert.ok(report.warnings.some((w) => w.includes('ideal gas law')))
})

test('an isothermal expansion does work equal to the heat absorbed', () => {
  const report = process({
    process: 'isothermal',
    moles: 1,
    gas: 'air',
    fromPressure: 200000,
    fromTemperature: 300,
    toVolume: 0.02
  })
  assert.ok(!isThermoError(report), isThermoError(report) ? report.message : '')
  near(report.internalEnergyChange, 0, 1e-6, 'no temperature change means no internal energy change')
  near(report.heat, report.work, 1e-6, 'so every joule of work came from heat')
  near(report.to.temperature, 300, 1e-6, 'and the temperature is unchanged')
})

test('a reversible adiabatic process generates no entropy and changes the temperature', () => {
  const report = process({
    process: 'adiabatic',
    moles: 1,
    gas: 'air',
    fromPressure: 100000,
    fromTemperature: 300,
    toVolume: 0.01
  })
  assert.ok(!isThermoError(report), isThermoError(report) ? report.message : '')
  near(report.heat, 0, 1e-6, 'no heat crosses the boundary')
  near(report.entropyChange, 0, 1e-9, 'which makes it isentropic')
  assert.ok(report.to.temperature > 300, 'compressing it heats it without heating it')
  near(report.work, -report.internalEnergyChange, 1e-6, 'all the work went into internal energy')
})

test('PV^gamma is constant across an adiabatic process', () => {
  const report = process({
    process: 'adiabatic',
    moles: 1,
    gamma: 1.4,
    fromPressure: 100000,
    fromVolume: 0.02,
    toVolume: 0.01
  })
  assert.ok(!isThermoError(report), isThermoError(report) ? report.message : '')
  const before = report.from.pressure * Math.pow(report.from.volume, 1.4)
  const after = report.to.pressure * Math.pow(report.to.volume, 1.4)
  relative(after, before, 1e-9, 'PV^gamma')
})

test('an isochoric process does no work and an isobaric one does P dV', () => {
  const rigid = process({ process: 'isochoric', moles: 1, gas: 'air', fromVolume: 0.01, fromTemperature: 300, toTemperature: 400 })
  assert.ok(!isThermoError(rigid), isThermoError(rigid) ? rigid.message : '')
  assert.equal(rigid.work, 0)
  near(rigid.heat, rigid.internalEnergyChange, 1e-9, 'every joule went into internal energy')

  const piston = process({ process: 'isobaric', moles: 1, gas: 'air', fromPressure: 100000, fromVolume: 0.01, toVolume: 0.02 })
  assert.ok(!isThermoError(piston), isThermoError(piston) ? piston.message : '')
  near(piston.work, 100000 * 0.01, 1e-6, 'P dV')
  near(piston.heat, piston.enthalpyChange, 1e-6, 'and the heat added is the enthalpy change, which is why enthalpy exists')
})

test('a contradictory process is refused rather than quietly preferred', () => {
  const contradiction = process({
    process: 'isobaric',
    moles: 1,
    fromPressure: 100000,
    fromVolume: 0.01,
    toPressure: 200000
  })
  assert.ok(isThermoError(contradiction))
  assert.ok(contradiction.message.includes('contradiction'))

  const noRoom = process({ process: 'isothermal', moles: 1, fromPressure: 1e5, fromTemperature: 300, toTemperature: 400 })
  assert.ok(isThermoError(noRoom), 'an isothermal process cannot be given an ending temperature')
})

test('a polytropic index of exactly one is refused with what to use instead', () => {
  const report = process({ process: 'polytropic', index: 1, moles: 1, fromPressure: 1e5, fromVolume: 0.01, toVolume: 0.02 })
  assert.ok(isThermoError(report))
  assert.ok(report.message.includes('isothermal'))
})

test('every process runs and the first law balances in each', () => {
  for (const one of PROCESSES) {
    const report = process({
      process: one,
      index: one === 'polytropic' ? 1.3 : undefined,
      moles: 1,
      gas: 'nitrogen',
      fromPressure: 150000,
      fromVolume: 0.015,
      toVolume: one === 'isochoric' ? undefined : 0.03,
      toPressure: one === 'isochoric' ? 100000 : undefined
    })
    assert.ok(!isThermoError(report), `${one}: ${isThermoError(report) ? report.message : ''}`)
    near(report.heat, report.internalEnergyChange + report.work, Math.abs(report.heat) * 1e-9 + 1e-9, `${one} first law`)
  }
})

test('the Carnot efficiency is one minus the temperature ratio', () => {
  const report = cycle({ cycle: 'carnot', hotTemperature: 600, coldTemperature: 300 })
  assert.ok(!isThermoError(report), isThermoError(report) ? report.message : '')
  near(report.efficiency as number, 0.5, 1e-12, 'one minus 300/600')
  near(report.secondLawEfficiency as number, 1, 1e-12, 'Carnot is its own limit')
})

test('a cycle that would beat Carnot is refused, not reported', () => {
  // An Otto cycle at compression ratio 20 is 70% efficient; asked for between 400 K and 300 K, where Carnot is 25%.
  const report = cycle({ cycle: 'otto', compressionRatio: 20, gamma: 1.4, hotTemperature: 400, coldTemperature: 300 })
  assert.ok(isThermoError(report))
  assert.equal(report.error, 'second-law')
  assert.ok(report.message.includes('never a good result'))
})

test('the Otto efficiency matches its formula and high compression is flagged', () => {
  const report = cycle({ cycle: 'otto', compressionRatio: 10, gamma: 1.4 })
  assert.ok(!isThermoError(report), isThermoError(report) ? report.message : '')
  near(report.efficiency as number, 1 - Math.pow(10, -0.4), 1e-12, 'the Otto formula')
  const tooHigh = cycle({ cycle: 'otto', compressionRatio: 20, gamma: 1.4 })
  assert.ok(!isThermoError(tooHigh))
  assert.ok(tooHigh.warnings.some((w) => w.includes('igniting on its own')))
})

test('the Brayton efficiency depends only on the pressure ratio', () => {
  const report = cycle({ cycle: 'brayton', pressureRatio: 15, gamma: 1.4 })
  assert.ok(!isThermoError(report), isThermoError(report) ? report.message : '')
  near(report.efficiency as number, 1 - Math.pow(15, -0.4 / 1.4), 1e-12, 'the Brayton formula')
})

test('coefficient of performance is never called an efficiency', () => {
  const fridge = cycle({ cycle: 'refrigeration', hotTemperature: 300, coldTemperature: 270 })
  assert.ok(!isThermoError(fridge), isThermoError(fridge) ? fridge.message : '')
  assert.equal(fridge.efficiency, null)
  near(fridge.coefficientOfPerformance as number, 270 / 30, 1e-12, 'cold over the difference')
  assert.ok(fridge.notes.some((n) => n.includes('not an efficiency')))

  const pump = cycle({ cycle: 'heat-pump', hotTemperature: 293, coldTemperature: 273 })
  assert.ok(!isThermoError(pump))
  near(pump.coefficientOfPerformance as number, 293 / 20, 1e-12, 'hot over the difference')
  assert.ok((pump.coefficientOfPerformance as number) > 1, 'and it is above 1, which an efficiency cannot be')
})

test('the Rankine cycle needs real steam enthalpies and says why', () => {
  const without = cycle({ cycle: 'rankine' })
  assert.ok(isThermoError(without))
  assert.ok(without.message.includes('steam table'))

  const with_ = cycle({ cycle: 'rankine', turbineInletEnthalpy: 3400, turbineOutletEnthalpy: 2200, condenserOutletEnthalpy: 190, pumpWork: 10 })
  assert.ok(!isThermoError(with_), isThermoError(with_) ? with_.message : '')
  near(with_.efficiency as number, (1200 - 10) / (3400 - 200), 1e-9, 'work out over heat in')
})

test('every cycle either runs or refuses with what it needs', () => {
  for (const one of CYCLES) {
    const report = cycle({
      cycle: one,
      hotTemperature: 800,
      coldTemperature: 300,
      compressionRatio: 9,
      pressureRatio: 12,
      cutOffRatio: 2,
      gamma: 1.4,
      turbineInletEnthalpy: 3400,
      turbineOutletEnthalpy: 2200,
      condenserOutletEnthalpy: 190,
      pumpWork: 10
    })
    assert.ok(!isThermoError(report), `${one}: ${isThermoError(report) ? report.message : ''}`)
    if (report.efficiency !== null && report.carnotLimit !== null) {
      assert.ok(report.efficiency <= report.carnotLimit + 1e-9, `${one} exceeds Carnot`)
    }
  }
})

test('heat flowing from cold to hot on its own is refused as not happening', () => {
  const report = entropyTransfer({ heat: 1000, fromTemperature: 280, toTemperature: 320 })
  assert.ok(isThermoError(report))
  assert.equal(report.error, 'second-law')
  assert.ok(report.message.includes('fridge'))
})

test('heat flowing downhill generates entropy and destroys work', () => {
  const report = entropyTransfer({ heat: 1000, fromTemperature: 400, toTemperature: 300, surroundingsTemperature: 300 })
  assert.ok(!isThermoError(report), isThermoError(report) ? report.message : '')
  near(report.change, 1000 / 300 - 1000 / 400, 1e-12, 'the entropy generated')
  assert.ok(report.change > 0, 'always positive for a real transfer')
  near(report.lostWork as number, 300 * report.change, 1e-9, 'entropy times surroundings temperature')
})

test('mixing generates entropy with no heat and no work', () => {
  const report = entropyOfMixing({ components: [{ moles: 1 }, { moles: 1 }], temperature: 300 })
  assert.ok(!isThermoError(report), isThermoError(report) ? report.message : '')
  near(report.entropyChange, 2 * 8.31446261815324 * Math.log(2), 1e-9, 'R ln 2 per mole for an even mix')
  assert.ok(report.entropyChange > 0)
  near(report.lostWork as number, 300 * report.entropyChange, 1e-9, 'the minimum work to unmix')
})

test('mixing at different temperatures also equalises them', () => {
  const report = entropyOfMixing({
    components: [
      { moles: 1, temperature: 400, molarHeatCapacity: 29 },
      { moles: 1, temperature: 300, molarHeatCapacity: 29 }
    ]
  })
  assert.ok(!isThermoError(report), isThermoError(report) ? report.message : '')
  near(report.finalTemperature as number, 350, 1e-9, 'equal amounts and capacities meet in the middle')
  assert.ok(report.entropyChange > 2 * 8.31446261815324 * Math.log(2), 'more than mixing alone')
})

test('boiling water takes far more heat than warming it', () => {
  const report = phaseHeat({
    mass: 1,
    fromTemperature: 273.15,
    toTemperature: 400,
    liquidHeatCapacity: 4186,
    gasHeatCapacity: 2010,
    boilingPoint: 373.15,
    latentHeatOfVaporisation: 2.257e6
  })
  assert.ok(!isThermoError(report), isThermoError(report) ? report.message : '')
  const warming = report.stages.find((one) => one.kind === 'sensible' && one.temperatureTo <= 373.16)
  const boiling = report.stages.find((one) => one.kind === 'latent')
  assert.ok(warming && boiling)
  relative(warming.heat, 4186 * 100, 0.01, 'warming from freezing to boiling')
  near(boiling.heat, 2.257e6, 1, 'and boiling it')
  assert.ok(boiling.heat > warming.heat * 5, 'boiling takes over five times as much')
  assert.ok(report.latentFraction > 0.5)
  assert.ok(report.warnings.some((w) => w.includes('thermometer does not move')))
})

test('crossing a phase boundary without its latent heat is refused', () => {
  const report = phaseHeat({
    mass: 1,
    fromTemperature: 300,
    toTemperature: 400,
    liquidHeatCapacity: 4186,
    boilingPoint: 373.15
  })
  assert.ok(isThermoError(report))
  assert.ok(report.message.includes('latent heat'))
})

// ---------------------------------------------------------------- statistical mechanics

test('kT at room temperature is about 25 meV', () => {
  const report = boltzmannDistribution({ temperature: 298.15, levels: [{ energy: 0 }] })
  assert.ok(!isStatMechError(report), isStatMechError(report) ? report.message : '')
  near(report.thermalEnergyElectronVolts, 0.0257, 0.0002, 'kT at room temperature')
})

test('a level one kT up holds 37% of the ground-state population', () => {
  const kt = 0.0257
  const report = boltzmannDistribution({ temperature: 298.15, levels: [{ energy: 0 }, { energy: kt }], unit: 'electron-volts' })
  assert.ok(!isStatMechError(report), isStatMechError(report) ? report.message : '')
  near(report.levels[1].relativePopulation, Math.exp(-1), 0.01, 'e to the minus one')
  near(report.levels[1].energyInKt, 1, 0.01, 'one kT up')
})

test('degeneracy multiplies the population of a level', () => {
  const single = boltzmannDistribution({ temperature: 300, levels: [{ energy: 0 }, { energy: 0.05, degeneracy: 1 }], unit: 'electron-volts' })
  const eightfold = boltzmannDistribution({ temperature: 300, levels: [{ energy: 0 }, { energy: 0.05, degeneracy: 8 }], unit: 'electron-volts' })
  assert.ok(!isStatMechError(single) && !isStatMechError(eightfold))
  near(eightfold.levels[1].relativePopulation, single.levels[1].relativePopulation * 8, 1e-9, 'eight states at one energy')
})

test('probabilities add to one and a far level is warned about', () => {
  const report = boltzmannDistribution({ temperature: 300, levels: [{ energy: 0 }, { energy: 0.1 }, { energy: 2 }], unit: 'electron-volts' })
  assert.ok(!isStatMechError(report), isStatMechError(report) ? report.message : '')
  near(report.levels.reduce((sum, one) => sum + one.probability, 0), 1, 1e-12, 'the probabilities partition')
  assert.ok(report.warnings.some((w) => w.includes('unoccupied')))
})

test('a temperature of zero is refused with why', () => {
  const report = boltzmannDistribution({ temperature: 0, levels: [{ energy: 0 }] })
  assert.ok(isStatMechError(report))
  assert.equal(report.error, 'out-of-range')
})

test('the three molecular speeds differ by the factors they should', () => {
  const report = speedDistribution({ temperature: 300, molarMass: 0.028, gamma: 1.4 })
  assert.ok(!isStatMechError(report), isStatMechError(report) ? report.message : '')
  near(report.mean / report.mostProbable, Math.sqrt(4 / Math.PI), 1e-9, 'mean over most probable')
  near(report.rootMeanSquare / report.mostProbable, Math.sqrt(1.5), 1e-9, 'rms over most probable')
  relative(report.rootMeanSquare, 517, 0.02, 'nitrogen rms speed at 300 K')
  assert.ok(report.mean > (report.speedOfSound as number), 'molecules outrun sound, as they must')
})

test('the average kinetic energy is 3kT/2 whatever the gas', () => {
  const light = speedDistribution({ temperature: 300, molarMass: 0.002 })
  const heavy = speedDistribution({ temperature: 300, molarMass: 0.131 })
  assert.ok(!isStatMechError(light) && !isStatMechError(heavy))
  near(light.averageKineticEnergy, heavy.averageKineticEnergy, 1e-30, 'the same energy')
  assert.ok(light.mean > heavy.mean * 5, 'and very different speeds')
})

test('the speed distribution integrates to one and the tail is thin', () => {
  const report = speedDistribution({ temperature: 300, molarMass: 0.028, samples: 2000, above: 2000 })
  assert.ok(!isStatMechError(report), isStatMechError(report) ? report.message : '')
  near(report.distribution[report.distribution.length - 1].cumulative, 1, 0.01, 'almost all of it is below 3.5 times the peak')
  assert.ok((report.fractionAbove as number) < 1e-6, 'very few molecules reach 2000 m/s at 300 K')
  assert.ok((report.fractionAbove as number) > 0, 'and it is not zero')
})

test('heat capacity switches modes on with temperature', () => {
  const cold = heatCapacity({ temperature: 20, shape: 'linear', characteristicTemperatures: { rotational: 85 } })
  const warm = heatCapacity({ temperature: 300, shape: 'linear', characteristicTemperatures: { rotational: 85 } })
  assert.ok(!isStatMechError(cold) && !isStatMechError(warm))
  relative(cold.cv, 1.5 * 8.31446261815324, 0.05, 'hydrogen below 100 K behaves like a monatomic gas')
  relative(warm.cv, 2.5 * 8.31446261815324, 0.02, 'and like a diatomic one at room temperature')
  assert.ok(cold.warnings.some((w) => w.includes('monatomic')))
})

test('vibration contributes almost nothing at room temperature', () => {
  const report = heatCapacity({
    temperature: 300,
    shape: 'linear',
    vibrationalModes: 1,
    characteristicTemperatures: { rotational: 5, vibrational: 3000 }
  })
  assert.ok(!isStatMechError(report), isStatMechError(report) ? report.message : '')
  relative(report.cv, 2.5 * 8.31446261815324, 0.02, 'still 5/2 R despite the vibrational mode')
  assert.ok(report.cv < report.classicalLimit * 0.8, 'well below the classical limit')
  assert.ok(report.warnings.some((w) => w.includes('not enough thermal energy')))
})

test('a monatomic gas has gamma of 5/3 and no vibration', () => {
  const report = heatCapacity({ temperature: 300, shape: 'monatomic' })
  assert.ok(!isStatMechError(report), isStatMechError(report) ? report.message : '')
  near(report.gamma, 5 / 3, 1e-9, 'the monatomic gamma')
  const wrong = heatCapacity({ temperature: 300, shape: 'monatomic', vibrationalModes: 2 })
  assert.ok(isStatMechError(wrong), 'a single atom has nothing to vibrate against')
})

test('Cp is always R more than Cv', () => {
  for (const shape of ['monatomic', 'linear', 'nonlinear'] as const) {
    const report = heatCapacity({ temperature: 500, shape })
    assert.ok(!isStatMechError(report))
    near(report.cp - report.cv, 8.31446261815324, 1e-9, `${shape} Cp minus Cv`)
  }
})

test('microstate counts come back as logarithms when they overflow', () => {
  const small = microstateEntropy({ particles: 4, states: 2 })
  assert.ok(!isStatMechError(small), isStatMechError(small) ? small.message : '')
  near(small.microstates as number, 16, 1e-9, 'two to the fourth')

  const mole = microstateEntropy({ particles: 6.022e23, states: 2 })
  assert.ok(!isStatMechError(mole), isStatMechError(mole) ? mole.message : '')
  assert.equal(mole.microstates, null, 'far past what a float can hold')
  near(mole.molarEntropy, 8.31446261815324 * Math.log(2), 1e-6, 'R ln 2 per mole')
  assert.ok(mole.warnings.some((w) => w.includes('logarithm')))
})

test('an uneven arrangement is less likely than an even one, and it says so', () => {
  const even = microstateEntropy({ particles: 100, occupancy: [50, 50] })
  const skewed = microstateEntropy({ particles: 100, occupancy: [90, 10] })
  assert.ok(!isStatMechError(even) && !isStatMechError(skewed))
  assert.ok(even.logMicrostates > skewed.logMicrostates, 'the even split has more arrangements')
  assert.ok(skewed.warnings.some((w) => w.includes('second law')))
})

test('occupancies that do not add up are refused', () => {
  const report = microstateEntropy({ particles: 100, occupancy: [50, 40] })
  assert.ok(isStatMechError(report))
})

test('the three statistics agree when the occupancy is small and diverge when it is not', () => {
  const dilute = stateOccupancy({ statistics: 'fermi-dirac', energy: 0.5, chemicalPotential: 0, temperature: 300, unit: 'electron-volts' })
  assert.ok(!isStatMechError(dilute), isStatMechError(dilute) ? dilute.message : '')
  assert.equal(dilute.classicalRegime, true)
  for (const other of dilute.others) {
    relative(other.occupancy, dilute.occupancy, 0.01, `${other.statistics} agrees in the dilute limit`)
  }

  const dense = stateOccupancy({ statistics: 'fermi-dirac', energy: 0, chemicalPotential: 0, temperature: 300, unit: 'electron-volts' })
  assert.ok(!isStatMechError(dense), isStatMechError(dense) ? dense.message : '')
  near(dense.occupancy, 0.5, 1e-12, 'a fermion state at the Fermi level is exactly half full')
  assert.equal(dense.classicalRegime, false)
  assert.ok(dense.warnings.some((w) => w.includes('disagree')))
})

test('a boson state at the chemical potential is refused as the condensation point', () => {
  const report = stateOccupancy({ statistics: 'bose-einstein', energy: 0, chemicalPotential: 0, temperature: 300 })
  assert.ok(isStatMechError(report))
  assert.ok(report.message.includes('condensation'))
})

// ---------------------------------------------------------------- relativity

test('the Lorentz factor matches its textbook values', () => {
  const half = lorentz({ beta: 0.5 })
  assert.ok(!isRelativityError(half), isRelativityError(half) ? half.message : '')
  near(half.gamma, 1 / Math.sqrt(0.75), 1e-12, 'gamma at half light speed')
  const famous = lorentz({ beta: 0.8 })
  assert.ok(!isRelativityError(famous))
  near(famous.gamma, 5 / 3, 1e-12, 'the classic 0.8c case')
  near(famous.lengthContraction, 0.6, 1e-12, 'and lengths measure 60%')
})

test('light speed and above are refused rather than returning infinity', () => {
  const atC = lorentz({ beta: 1 })
  assert.ok(isRelativityError(atC))
  assert.equal(atC.error, 'faster-than-light')
  const above = lorentz({ beta: 1.5 })
  assert.ok(isRelativityError(above))
  assert.ok(above.message.includes('no such frame'))
})

test('everyday speeds have an unmeasurable but real Lorentz factor', () => {
  const report = lorentz({ speed: 300 })
  assert.ok(!isRelativityError(report), isRelativityError(report) ? report.message : '')
  assert.ok(report.gamma - 1 < 1e-12 && report.gamma > 1, 'above one and only just')
  assert.equal(report.noticeable, false)
  assert.ok(report.warnings.some((w) => w.includes('unmeasurable')))
})

test('adding two large speeds never exceeds light', () => {
  const report = addVelocities({ firstBeta: 0.9, secondBeta: 0.9 })
  assert.ok(!isRelativityError(report), isRelativityError(report) ? report.message : '')
  near(report.beta, 1.8 / 1.81, 1e-12, 'the relativistic sum')
  assert.ok(report.beta < 1, 'and it stays below light speed')
  near(report.classicalSum, 1.8 * 299792458, 1, 'where simple addition gives 1.8c')
})

test('adding anything to light speed gives light speed', () => {
  const report = addVelocities({ firstBeta: 1, secondBeta: 0.5 })
  assert.ok(!isRelativityError(report), isRelativityError(report) ? report.message : '')
  near(report.beta, 1, 1e-12, 'exactly c again')
  assert.ok(report.warnings.some((w) => w.includes('same speed in every frame')))
})

test('an electron rest energy is 0.511 MeV and a proton is 938', () => {
  const electron = massEnergy({ particle: 'electron', beta: 0 })
  const proton = massEnergy({ particle: 'proton', beta: 0 })
  assert.ok(!isRelativityError(electron) && !isRelativityError(proton))
  near(electron.restEnergyMev, 0.511, 0.001, 'the electron rest energy')
  near(proton.restEnergyMev, 938.272, 0.01, 'the proton rest energy')
  near(electron.kineticEnergyMev, 0, 1e-12, 'at rest there is no kinetic energy')
})

test('the energy-momentum relation holds and the classical formula is flagged when it fails', () => {
  const fast = massEnergy({ particle: 'electron', beta: 0.99 })
  assert.ok(!isRelativityError(fast), isRelativityError(fast) ? fast.message : '')
  const c = 299792458
  const check = Math.sqrt(Math.pow(fast.momentum * c, 2) + Math.pow(fast.restEnergy, 2))
  relative(check, fast.totalEnergy, 1e-12, 'E^2 = (pc)^2 + (mc^2)^2')
  assert.ok(Math.abs(fast.classicalError) > 0.5, 'the classical formula is badly out at 0.99c')
  assert.ok(fast.warnings.some((w) => w.includes('classical kinetic energy')))

  const slow = massEnergy({ particle: 'proton', beta: 0.01 })
  assert.ok(!isRelativityError(slow))
  assert.ok(Math.abs(slow.classicalError) < 0.01, 'and fine at 0.01c')
})

test('two of the motion quantities at once are refused', () => {
  const report = massEnergy({ particle: 'electron', beta: 0.5, gamma: 2 })
  assert.ok(isRelativityError(report))
  assert.ok(report.message.includes('pick one'))
})

test('a transverse Doppler shift exists where the classical formula predicts none', () => {
  const report = relativisticDoppler({ sourceFrequency: 1e9, beta: 0.5, angleDegrees: 90 })
  assert.ok(!isRelativityError(report), isRelativityError(report) ? report.message : '')
  near(report.factor, Math.sqrt(1 - 0.25), 1e-12, 'pure time dilation')
  near(report.classicalFactor, 1, 1e-12, 'the classical formula predicts nothing at 90 degrees')
  assert.ok(report.warnings.some((w) => w.includes('pure time dilation')))
})

test('a receding source is redshifted and z is reported', () => {
  const report = relativisticDoppler({ sourceWavelength: 500e-9, beta: 0.5 })
  assert.ok(!isRelativityError(report), isRelativityError(report) ? report.message : '')
  assert.ok(report.observedWavelength > 500e-9, 'redshifted')
  near(report.redshift, Math.sqrt(1.5 / 0.5) - 1, 1e-12, 'the radial redshift formula')
  assert.equal(report.approaching, false)
})

test('a photon carries energy in electronvolts and momentum without mass', () => {
  const green = photon({ wavelength: 500e-9 })
  assert.ok(!isRelativityError(green), isRelativityError(green) ? green.message : '')
  near(green.energyElectronVolts, 2.48, 0.01, 'a green photon is about 2.5 eV')
  assert.equal(green.band, 'visible light')
  assert.ok(green.momentum > 0, 'momentum with no mass')
  near(green.momentum, green.energy / 299792458, 1e-40, 'E over c')
})

test('a photon past the bond threshold is flagged and a radio photon is not', () => {
  const uv = photon({ wavelength: 250e-9 })
  assert.ok(!isRelativityError(uv))
  assert.equal(uv.canBreakBonds, true)
  assert.ok(uv.warnings.some((w) => w.includes('sunburn') || w.includes('damage')))

  const radio = photon({ frequency: 100e6 })
  assert.ok(!isRelativityError(radio))
  assert.equal(radio.band, 'radio')
  assert.equal(radio.canBreakBonds, false)
  assert.ok(radio.timesRoomThermalEnergy < 0.01, 'far below thermal noise')
})

test('two photon properties at once are refused', () => {
  const report = photon({ wavelength: 500e-9, frequency: 6e14 })
  assert.ok(isRelativityError(report))
})

test('the photoelectric threshold blocks low-frequency light however bright', () => {
  const below = photoelectric({ workFunction: 4.5, wavelength: 500e-9 })
  assert.ok(!isRelativityError(below), isRelativityError(below) ? below.message : '')
  assert.equal(below.emits, false)
  assert.equal(below.maximumKineticEnergy, 0)
  assert.ok(below.warnings.some((w) => w.includes('no amount of intensity')))

  const above = photoelectric({ workFunction: 2.3, wavelength: 400e-9 })
  assert.ok(!isRelativityError(above), isRelativityError(above) ? above.message : '')
  assert.equal(above.emits, true)
  near(above.maximumKineticEnergy, above.photonEnergy - 2.3, 1e-9, 'photon energy less the work function')
  near(above.stoppingVoltage, above.maximumKineticEnergy, 1e-12, 'volts equal electronvolts by definition')
})

test('the blackbody peak follows Wien and the total follows Stefan-Boltzmann', () => {
  const sun = blackbody({ temperature: 5772 })
  assert.ok(!isRelativityError(sun), isRelativityError(sun) ? sun.message : '')
  near(sun.peakWavelength * 1e9, 502, 2, 'the sun peaks in green')
  relative(sun.totalEmission, 5.670374419e-8 * Math.pow(5772, 4), 1e-9, 'Stefan-Boltzmann')
  assert.ok(sun.visibleFraction > 0.3, 'over a third of sunlight is visible')
})

test('the classical law diverges where Planck does not', () => {
  const report = blackbody({ temperature: 3000 })
  assert.ok(!isRelativityError(report), isRelativityError(report) ? report.message : '')
  const atPeak = report.spectrum.reduce((best, one) => (one.spectralRadiance > best.spectralRadiance ? one : best))
  assert.ok(report.classicalAtPeak > atPeak.spectralRadiance, 'Rayleigh-Jeans over-predicts even at the peak')
  // And the short-wavelength end of Planck's curve falls to nothing, where the classical law would rise.
  assert.ok(report.spectrum[0].spectralRadiance < atPeak.spectralRadiance, 'Planck falls off toward short wavelengths')
})

test('a warm object glows invisibly and it says so', () => {
  const report = blackbody({ temperature: 310 })
  assert.ok(!isRelativityError(report), isRelativityError(report) ? report.message : '')
  assert.equal(report.band, 'infrared')
  assert.ok(report.visibleFraction < 1e-6)
  assert.ok(report.warnings.some((w) => w.includes('cannot see it glowing')))
})

test('the wavelength and frequency peaks of a blackbody are not the same place', () => {
  const report = blackbody({ temperature: 5772 })
  assert.ok(!isRelativityError(report))
  const fromFrequency = 299792458 / report.peakFrequency
  assert.ok(fromFrequency > report.peakWavelength * 1.5, 'they differ by about 70%')
})

test('an electron accelerated through 100 volts has a wavelength around 120 pm', () => {
  const report = deBroglie({ particle: 'electron', kineticEnergyElectronVolts: 100, comparedWith: 1e-10 })
  assert.ok(!isRelativityError(report), isRelativityError(report) ? report.message : '')
  relative(report.wavelength * 1e12, 122.6, 0.01, 'the standard electron diffraction wavelength')
  assert.equal(report.quantumRegime, true, 'comparable to an atom, so it diffracts')
})

test('a cricket ball has a wavelength smaller than anything that means anything', () => {
  const report = deBroglie({ mass: 0.16, speed: 40, comparedWith: 0.07 })
  assert.ok(!isRelativityError(report), isRelativityError(report) ? report.message : '')
  assert.ok(report.wavelength < 1e-33, 'about 1e-34 metres')
  assert.equal(report.quantumRegime, false)
  assert.ok(report.warnings.some((w) => w.includes('trajectories')))
})

test('helium-4 binding energy is about 28 MeV', () => {
  const report = bindingEnergy({ protons: 2, neutrons: 2, atomicMass: 4.002602 })
  assert.ok(!isRelativityError(report), isRelativityError(report) ? report.message : '')
  near(report.bindingEnergy, 28.3, 0.1, 'the helium-4 binding energy')
  near(report.bindingEnergyPerNucleon, 7.07, 0.05, 'per nucleon')
  assert.equal(report.releasesEnergyBy, 'fusion')
})

test('uranium-238 is heavier than iron and releases energy by splitting', () => {
  const report = bindingEnergy({ protons: 92, neutrons: 146, atomicMass: 238.05079 })
  assert.ok(!isRelativityError(report), isRelativityError(report) ? report.message : '')
  near(report.bindingEnergyPerNucleon, 7.57, 0.05, 'uranium-238 per nucleon')
  assert.equal(report.releasesEnergyBy, 'fission')
  assert.ok(report.bindingEnergyPerNucleon < 8.79, 'below the iron peak')
})

test('a nucleus heavier than its parts is refused', () => {
  const report = bindingEnergy({ protons: 2, neutrons: 2, atomicMass: 4.1 })
  assert.ok(isRelativityError(report))
  assert.ok(report.message.includes('electrons'))
})

test('decay halves at the half-life and the mean life is longer', () => {
  const report = radioactiveDecay({ halfLife: 100, initialCount: 1e6, elapsed: 100 })
  assert.ok(!isRelativityError(report), isRelativityError(report) ? report.message : '')
  near(report.fractionRemaining, 0.5, 1e-12, 'one half-life')
  near(report.meanLifetime, 100 / Math.LN2, 1e-9, 'longer than the half-life by 1/ln2')
  near(report.finalActivity, report.initialActivity / 2, 1e-6, 'activity halves with the count')
})

test('decaying past the last atom is flagged as a statement about averages', () => {
  const report = radioactiveDecay({ halfLife: 1, initialCount: 100, elapsed: 50 })
  assert.ok(!isRelativityError(report), isRelativityError(report) ? report.message : '')
  assert.ok(report.remaining < 1)
  assert.ok(report.warnings.some((w) => w.includes('no schedule')))
})

// ---------------------------------------------------------------- quantum

test('a particle in a box has a non-zero ground state that rises as the box shrinks', () => {
  const wide = particleInBox({ width: 1e-9, particle: 'electron' })
  const narrow = particleInBox({ width: 0.5e-9, particle: 'electron' })
  assert.ok(!isQuantumError(wide) && !isQuantumError(narrow))
  assert.ok(wide.groundStateElectronVolts > 0, 'never zero')
  near(wide.groundStateElectronVolts, 0.376, 0.005, 'the standard 1 nm electron box')
  relative(narrow.groundStateElectronVolts, wide.groundStateElectronVolts * 4, 1e-9, 'halving the box quadruples the energy')
})

test('box levels go as n squared and have n-1 nodes', () => {
  const report = particleInBox({ width: 1e-9, particle: 'electron', levels: 4 })
  assert.ok(!isQuantumError(report), isQuantumError(report) ? report.message : '')
  for (const one of report.levels) {
    relative(one.energy, report.levels[0].energy * one.n * one.n, 1e-9, `level ${one.n}`)
    assert.equal(one.nodes, one.n - 1)
  }
  assert.ok(report.levels[3].energy - report.levels[2].energy > report.levels[1].energy - report.levels[0].energy, 'the gaps widen')
})

test('the box probability density is normalised', () => {
  const report = particleInBox({ width: 2e-9, particle: 'electron', densityFor: 3, samples: 2000 })
  assert.ok(!isQuantumError(report), isQuantumError(report) ? report.message : '')
  const width = 2e-9
  let integral = 0
  const step = width / (report.density.length - 1)
  for (let i = 1; i < report.density.length; i += 1) {
    integral += ((report.density[i].probability + report.density[i - 1].probability) / 2) * step
  }
  near(integral, 1, 0.01, 'the probability adds to one')
  assert.equal(report.warnings.length, 0, 'and no sampling warning at this resolution')
})

test('oscillator levels are equally spaced with half a quantum at the bottom', () => {
  const report = harmonicOscillator({ frequency: 1e13, particle: 'proton', levels: 4 })
  assert.ok(!isQuantumError(report), isQuantumError(report) ? report.message : '')
  near(report.zeroPointEnergy, report.levelSpacing / 2, 1e-30, 'half a quantum')
  for (let i = 1; i < report.levels.length; i += 1) {
    near(report.levels[i].energy - report.levels[i - 1].energy, report.levelSpacing, 1e-30, `gap ${i}`)
  }
  near(report.tunnellingFraction, 0.157, 0.001, 'the ground state leaks outside its classical limits')
})

test('a stiff oscillator is frozen out at room temperature', () => {
  const report = harmonicOscillator({ frequency: 1e14, particle: 'proton' })
  assert.ok(!isQuantumError(report), isQuantumError(report) ? report.message : '')
  assert.ok(report.characteristicTemperature > 1000)
  assert.ok(report.warnings.some((w) => w.includes('ground state')))
})

test('hydrogen levels match the Rydberg formula and the Balmer line is visible', () => {
  const report = hydrogen({ from: 3, to: 2 })
  assert.ok(!isQuantumError(report), isQuantumError(report) ? report.message : '')
  near(report.ionisationEnergy, 13.606, 0.005, 'the hydrogen ionisation energy')
  near(report.levels[0].energy, -13.606, 0.005, 'the ground state')
  assert.ok(report.transition !== null)
  near(report.transition.wavelengthNanometres, 656.3, 1, 'the H-alpha line')
  assert.equal(report.transition.series, 'Balmer')
  assert.equal(report.transition.visible, true)
})

test('hydrogen level spacing shrinks upward, unlike a box', () => {
  const report = hydrogen({ levels: 5 })
  assert.ok(!isQuantumError(report), isQuantumError(report) ? report.message : '')
  const firstGap = report.levels[1].energy - report.levels[0].energy
  const lastGap = report.levels[4].energy - report.levels[3].energy
  assert.ok(lastGap < firstGap / 10, 'the levels crowd together going up')
  for (const one of report.levels) assert.equal(one.degeneracy, 2 * one.n * one.n)
  near(report.levels[0].radius, 5.29e-11, 1e-13, 'the Bohr radius')
})

test('helium-plus scales as Z squared and a heavy nucleus is refused', () => {
  const helium = hydrogen({ atomicNumber: 2 })
  assert.ok(!isQuantumError(helium), isQuantumError(helium) ? helium.message : '')
  near(helium.ionisationEnergy, 13.606 * 4, 0.02, 'four times hydrogen')
  near(helium.bohrRadius, 5.29e-11 / 2, 1e-13, 'and half the radius')
  const uranium = hydrogen({ atomicNumber: 92 })
  assert.ok(isQuantumError(uranium))
  assert.equal(uranium.error, 'outside-model')
})

test('an absorption is distinguished from an emission', () => {
  const report = hydrogen({ from: 1, to: 3 })
  assert.ok(!isQuantumError(report), isQuantumError(report) ? report.message : '')
  assert.ok(report.warnings.some((w) => w.includes('absorption')))
})

test('tunnelling falls exponentially with barrier thickness', () => {
  const thin = tunnelling({ particleEnergy: 1, barrierHeight: 5, barrierWidth: 0.5e-9, particle: 'electron' })
  const thick = tunnelling({ particleEnergy: 1, barrierHeight: 5, barrierWidth: 1e-9, particle: 'electron' })
  assert.ok(!isQuantumError(thin) && !isQuantumError(thick))
  assert.ok(thin.transmission > thick.transmission * 100, 'doubling the width cuts it by orders of magnitude')
  near(thin.transmission + thin.reflection, 1, 1e-12, 'they add to one')
  assert.ok(thin.warnings.some((w) => w.includes('tunnelling microscope')))
})

test('a proton tunnels far less than an electron through the same barrier', () => {
  const electron = tunnelling({ particleEnergy: 1, barrierHeight: 5, barrierWidth: 0.3e-9, particle: 'electron' })
  const proton = tunnelling({ particleEnergy: 1, barrierHeight: 5, barrierWidth: 0.3e-9, particle: 'proton' })
  assert.ok(!isQuantumError(electron) && !isQuantumError(proton))
  assert.ok(electron.transmission > proton.transmission * 1e6, 'mass matters exponentially')
})

test('going over a barrier still reflects, which a classical particle would not', () => {
  const report = tunnelling({ particleEnergy: 6, barrierHeight: 5, barrierWidth: 0.4e-9, particle: 'electron' })
  assert.ok(!isQuantumError(report), isQuantumError(report) ? report.message : '')
  assert.equal(report.overTheTop, true)
  assert.ok(report.reflection > 0, 'a classical particle would pass every time')
  assert.ok(report.warnings.some((w) => w.includes('classical particle would pass')))
})

test('the uncertainty floor is enforced and a state below it is refused', () => {
  const hbar = 1.054571817e-34
  const impossible = uncertainty({ first: 1e-12, second: 1e-24 })
  assert.ok(isQuantumError(impossible))
  assert.ok(impossible.message.includes('describing nothing'))

  const minimum = uncertainty({ first: 1e-10 })
  assert.ok(!isQuantumError(minimum), isQuantumError(minimum) ? minimum.message : '')
  near(minimum.minimumOther as number, hbar / 2 / 1e-10, 1e-30, 'the floor divided by the given spread')
})

test('a state far above the floor is flagged as classically broadened', () => {
  // Nearly two thousand times the floor, which is where something classical is plainly doing the broadening.
  const report = uncertainty({ first: 1e-9, second: 1e-22 })
  assert.ok(!isQuantumError(report), isQuantumError(report) ? report.message : '')
  assert.ok(report.timesTheFloor > 100, 'nowhere near the quantum limit')
  assert.ok(report.warnings.some((w) => w.includes('classical')))
  assert.equal(report.possible, true)
})

test('an uncertainty of exactly zero is refused with why', () => {
  const report = uncertainty({ first: 0 })
  assert.ok(isQuantumError(report))
  assert.ok(report.message.includes('no momentum at all'))
})

test('the energy-time relation says it is a different kind of statement', () => {
  const report = uncertainty({ pair: 'energy-time', first: 1e-20, second: 1e-13 })
  assert.ok(!isQuantumError(report), isQuantumError(report) ? report.message : '')
  assert.ok(report.notes.some((n) => n.includes('not an operator')))
})

test('a measurement returns probabilities that add to one, never an outcome', () => {
  const report = measure({
    amplitudes: [
      { label: 'up', real: 1 / Math.sqrt(2) },
      { label: 'down', real: 1 / Math.sqrt(2) }
    ]
  })
  assert.ok(!isQuantumError(report), isQuantumError(report) ? report.message : '')
  near(report.outcomes[0].probability, 0.5, 1e-12, 'an even superposition')
  near(report.outcomes.reduce((sum, one) => sum + one.probability, 0), 1, 1e-12, 'they add to one')
  near(report.shannonEntropyBits, 1, 1e-12, 'one bit of uncertainty')
  assert.ok(report.notes.some((n) => n.includes('not an outcome')))
  assert.ok(!Object.keys(report).some((one) => /result|chosen|collapsed/i.test(one)), 'no field claims an outcome')
})

test('phase does not change the probabilities and is reported anyway', () => {
  const same = measure({ amplitudes: [{ label: 'a', real: 0.6 }, { label: 'b', real: 0.8 }] })
  const shifted = measure({ amplitudes: [{ label: 'a', real: 0.6 }, { label: 'b', real: 0, imaginary: 0.8 }] })
  assert.ok(!isQuantumError(same) && !isQuantumError(shifted))
  near(shifted.outcomes[1].probability, same.outcomes[1].probability, 1e-12, 'the same probability')
  assert.equal(shifted.phasesDiffer, true)
  near(shifted.outcomes[1].phaseDegrees, 90, 1e-9, 'and a quarter turn of phase')
})

test('an unnormalised state is normalised and the factor reported, or refused on request', () => {
  const scaled = measure({ amplitudes: [{ label: 'a', real: 3 }, { label: 'b', real: 4 }] })
  assert.ok(!isQuantumError(scaled), isQuantumError(scaled) ? scaled.message : '')
  assert.equal(scaled.wasNormalised, false)
  near(scaled.outcomes[0].probability, 9 / 25, 1e-12, 'nine twenty-fifths')
  assert.ok(scaled.warnings.length > 0)

  const strict = measure({ amplitudes: [{ label: 'a', real: 3 }, { label: 'b', real: 4 }], requireNormalised: true })
  assert.ok(isQuantumError(strict))
  assert.equal(strict.error, 'not-normalised')
})

test('an all-zero state is refused as describing nothing', () => {
  const report = measure({ amplitudes: [{ label: 'a', real: 0 }, { label: 'b', real: 0 }] })
  assert.ok(isQuantumError(report))
  assert.equal(report.error, 'no-solution')
})

test('an expectation value need not be an attainable outcome', () => {
  const report = expectationValue({
    outcomes: [
      { label: 'up', value: 1, probability: 0.5 },
      { label: 'down', value: -1, probability: 0.5 }
    ]
  })
  assert.ok(!isQuantumError(report), isQuantumError(report) ? report.message : '')
  near(report.expectation, 0, 1e-12, 'the average is zero')
  near(report.standardDeviation, 1, 1e-12, 'and every measurement is plus or minus one')
  assert.equal(report.isEigenstate, false)
  assert.ok(report.warnings.some((w) => w.includes('not one of the possible outcomes')))
})

test('an eigenstate has zero spread and gives the same value every time', () => {
  const report = expectationValue({ outcomes: [{ label: 'only', value: 7, probability: 1 }] })
  assert.ok(!isQuantumError(report), isQuantumError(report) ? report.message : '')
  near(report.expectation, 7, 1e-12, 'the only value')
  near(report.standardDeviation, 0, 1e-12, 'no spread')
  assert.equal(report.isEigenstate, true)
})

test('probabilities that do not add to one are normalised with a warning', () => {
  const report = expectationValue({
    outcomes: [
      { value: 1, probability: 1 },
      { value: 3, probability: 1 }
    ]
  })
  assert.ok(!isQuantumError(report), isQuantumError(report) ? report.message : '')
  near(report.expectation, 2, 1e-12, 'the average after normalising')
  assert.ok(report.warnings.some((w) => w.includes('add to')))
})
