import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  acPower,
  checkCircuit,
  combineResistors,
  isCircuitError,
  resonanceSweep,
  rlc,
  solve,
  transformer,
  transient,
  type Circuit,
  type CircuitError
} from './circuits.ts'

const ok = <T>(value: T): Exclude<T, CircuitError> => {
  assert.ok(!isCircuitError(value), isCircuitError(value) ? value.message : '')
  return value as Exclude<T, CircuitError>
}

const bad = (value: unknown): CircuitError => {
  assert.ok(isCircuitError(value), 'expected an error and got a result')
  return value
}

const closeTo = (actual: number, expected: number, tolerance: number, what = ''): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} expected ${expected} within ${tolerance}, got ${actual}`)
}

/** A 12 V source across a single 100-ohm resistor. The simplest circuit that has an answer. */
const simpleLoop: Circuit = {
  ground: 'gnd',
  components: [
    { id: 'V1', kind: 'voltage-source', value: 12, from: 'gnd', to: 'a' },
    { id: 'R1', kind: 'resistor', value: 100, from: 'a', to: 'gnd' }
  ]
}

describe('the simplest circuit', () => {
  it('gets Ohm law right', () => {
    const report = ok(solve(simpleLoop))
    const r1 = report.components.find((one) => one.id === 'R1')
    assert.ok(r1)
    closeTo(Math.abs(r1.current.magnitude), 0.12, 1e-12, 'I = V/R')
    closeTo(Math.abs(r1.voltage.magnitude), 12, 1e-12)
    closeTo(r1.power, 1.44, 1e-12, 'P = VI')
  })

  it('puts the source node at the source voltage', () => {
    const report = ok(solve(simpleLoop))
    const a = report.nodeVoltages.find((one) => one.node === 'a')
    assert.ok(a)
    closeTo(a.voltage.re, 12, 1e-12)
  })

  it('satisfies Kirchhoff to machine precision, and says by how much', () => {
    const report = ok(solve(simpleLoop))
    assert.ok(report.kclResidual < 1e-12, `KCL residual was ${report.kclResidual}`)
  })

  it('balances the power the source supplies against what the resistor dissipates', () => {
    const report = ok(solve(simpleLoop))
    closeTo(report.totalDissipated, report.totalSupplied, 1e-9)
    assert.equal(report.warnings.length, 0)
  })
})

describe('a divider', () => {
  it('divides in proportion to resistance', () => {
    const circuit: Circuit = {
      ground: 'gnd',
      components: [
        { id: 'V1', kind: 'voltage-source', value: 9, from: 'gnd', to: 'a' },
        { id: 'R1', kind: 'resistor', value: 1000, from: 'a', to: 'b' },
        { id: 'R2', kind: 'resistor', value: 2000, from: 'b', to: 'gnd' }
      ]
    }
    const report = ok(solve(circuit))
    const b = report.nodeVoltages.find((one) => one.node === 'b')
    assert.ok(b)
    closeTo(b.voltage.re, 6, 1e-9, 'two thirds of 9 V across the 2k')
  })

  it('carries the same current through both resistors in series', () => {
    const circuit: Circuit = {
      ground: 'gnd',
      components: [
        { id: 'V1', kind: 'voltage-source', value: 9, from: 'gnd', to: 'a' },
        { id: 'R1', kind: 'resistor', value: 1000, from: 'a', to: 'b' },
        { id: 'R2', kind: 'resistor', value: 2000, from: 'b', to: 'gnd' }
      ]
    }
    const report = ok(solve(circuit))
    const r1 = report.components.find((one) => one.id === 'R1')
    const r2 = report.components.find((one) => one.id === 'R2')
    assert.ok(r1 && r2)
    closeTo(Math.abs(r1.current.magnitude), Math.abs(r2.current.magnitude), 1e-12)
    closeTo(Math.abs(r1.current.magnitude), 0.003, 1e-9)
  })
})

describe('parallel resistors', () => {
  it('splits current in inverse proportion', () => {
    const circuit: Circuit = {
      ground: 'gnd',
      components: [
        { id: 'V1', kind: 'voltage-source', value: 6, from: 'gnd', to: 'a' },
        { id: 'R1', kind: 'resistor', value: 100, from: 'a', to: 'gnd' },
        { id: 'R2', kind: 'resistor', value: 200, from: 'a', to: 'gnd' }
      ]
    }
    const report = ok(solve(circuit))
    const r1 = report.components.find((one) => one.id === 'R1')
    const r2 = report.components.find((one) => one.id === 'R2')
    assert.ok(r1 && r2)
    closeTo(Math.abs(r1.current.magnitude), 0.06, 1e-9)
    closeTo(Math.abs(r2.current.magnitude), 0.03, 1e-9)
    closeTo(Math.abs(r1.current.magnitude), 2 * Math.abs(r2.current.magnitude), 1e-9)
  })
})

describe('refusing rather than answering', () => {
  it('names the source when an ideal source is shorted', () => {
    const circuit: Circuit = {
      ground: 'gnd',
      components: [
        { id: 'V1', kind: 'voltage-source', value: 12, from: 'gnd', to: 'a' },
        { id: 'W1', kind: 'wire', value: 0, from: 'a', to: 'gnd' }
      ]
    }
    const result = bad(solve(circuit))
    assert.equal(result.error, 'short-circuit')
    assert.match(result.message, /infinite current/)
    assert.deepEqual(result.involves, ['V1'])
  })

  it('finds a node with no path back to ground', () => {
    const circuit: Circuit = {
      ground: 'gnd',
      components: [
        { id: 'V1', kind: 'voltage-source', value: 12, from: 'gnd', to: 'a' },
        { id: 'R1', kind: 'resistor', value: 100, from: 'a', to: 'gnd' },
        { id: 'R2', kind: 'resistor', value: 100, from: 'x', to: 'y' }
      ]
    }
    const check = ok(checkCircuit(circuit))
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((one) => one.kind === 'floating-node'))
  })

  it('finds two sources demanding different voltages across the same pair', () => {
    const circuit: Circuit = {
      ground: 'gnd',
      components: [
        { id: 'V1', kind: 'voltage-source', value: 12, from: 'gnd', to: 'a' },
        { id: 'V2', kind: 'voltage-source', value: 5, from: 'gnd', to: 'a' },
        { id: 'R1', kind: 'resistor', value: 100, from: 'a', to: 'gnd' }
      ]
    }
    const check = ok(checkCircuit(circuit))
    assert.equal(check.ok, false)
    const conflict = check.problems.find((one) => one.kind === 'conflicting-sources')
    assert.ok(conflict)
    assert.deepEqual(conflict.involves, ['V1', 'V2'])
  })

  it('refuses a ground node that is not in the circuit', () => {
    const check = ok(checkCircuit({ ...simpleLoop, ground: 'nowhere' }))
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((one) => one.kind === 'no-ground'))
  })

  it('refuses an empty circuit', () => {
    assert.equal(bad(checkCircuit({ ground: 'gnd', components: [] })).error, 'no-components')
  })
})

describe('DC treats reactive parts as their limits', () => {
  it('makes a capacitor an open circuit', () => {
    const circuit: Circuit = {
      ground: 'gnd',
      components: [
        { id: 'V1', kind: 'voltage-source', value: 10, from: 'gnd', to: 'a' },
        { id: 'R1', kind: 'resistor', value: 1000, from: 'a', to: 'b' },
        { id: 'C1', kind: 'capacitor', value: 1e-6, from: 'b', to: 'gnd' }
      ]
    }
    const report = ok(solve(circuit, 0))
    const r1 = report.components.find((one) => one.id === 'R1')
    assert.ok(r1)
    closeTo(Math.abs(r1.current.magnitude), 0, 1e-12, 'no steady current through a capacitor')
    const b = report.nodeVoltages.find((one) => one.node === 'b')
    assert.ok(b)
    closeTo(b.voltage.re, 10, 1e-9, 'the capacitor charges to the full supply')
  })

  it('makes an inductor a short', () => {
    const circuit: Circuit = {
      ground: 'gnd',
      components: [
        { id: 'V1', kind: 'voltage-source', value: 10, from: 'gnd', to: 'a' },
        { id: 'R1', kind: 'resistor', value: 100, from: 'a', to: 'b' },
        { id: 'L1', kind: 'inductor', value: 1e-3, from: 'b', to: 'gnd' }
      ]
    }
    const report = ok(solve(circuit, 0))
    const b = report.nodeVoltages.find((one) => one.node === 'b')
    assert.ok(b)
    closeTo(b.voltage.re, 0, 1e-9, 'an ideal inductor drops no steady voltage')
    const r1 = report.components.find((one) => one.id === 'R1')
    assert.ok(r1)
    closeTo(Math.abs(r1.current.magnitude), 0.1, 1e-9)
  })
})

describe('AC is the same solver over complex numbers', () => {
  it('gives a capacitor a current that leads the voltage', () => {
    const circuit: Circuit = {
      ground: 'gnd',
      components: [
        { id: 'V1', kind: 'voltage-source', value: 1, from: 'gnd', to: 'a' },
        { id: 'C1', kind: 'capacitor', value: 1e-6, from: 'a', to: 'gnd' }
      ]
    }
    const report = ok(solve(circuit, 1000))
    const c1 = report.components.find((one) => one.id === 'C1')
    assert.ok(c1)
    // Xc = 1/(2*pi*1000*1e-6) = 159.15 ohms
    closeTo(c1.impedance?.magnitude ?? 0, 1 / (2 * Math.PI * 1000 * 1e-6), 1e-6)
    closeTo(Math.abs(c1.current.magnitude), 2 * Math.PI * 1000 * 1e-6, 1e-9)
  })

  it('gives an inductor a reactance that rises with frequency', () => {
    const circuit: Circuit = {
      ground: 'gnd',
      components: [
        { id: 'V1', kind: 'voltage-source', value: 1, from: 'gnd', to: 'a' },
        { id: 'R1', kind: 'resistor', value: 1, from: 'a', to: 'b' },
        { id: 'L1', kind: 'inductor', value: 1e-3, from: 'b', to: 'gnd' }
      ]
    }
    const low = ok(solve(circuit, 100))
    const high = ok(solve(circuit, 10_000))
    const lowL = low.components.find((one) => one.id === 'L1')
    const highL = high.components.find((one) => one.id === 'L1')
    assert.ok(lowL && highL)
    assert.ok((highL.impedance?.magnitude ?? 0) > (lowL.impedance?.magnitude ?? 0) * 50)
  })

  it('says which mode it solved in', () => {
    assert.ok(ok(solve(simpleLoop, 0)).notes.some((one) => /Solved as DC/.test(one)))
    assert.ok(ok(solve(simpleLoop, 50)).notes.some((one) => /Solved at 50 Hz/.test(one)))
  })
})

describe('an open switch', () => {
  it('stops current entirely', () => {
    const circuit: Circuit = {
      ground: 'gnd',
      components: [
        { id: 'V1', kind: 'voltage-source', value: 12, from: 'gnd', to: 'a' },
        { id: 'S1', kind: 'switch', value: 0, from: 'a', to: 'b', closed: false },
        { id: 'R1', kind: 'resistor', value: 100, from: 'b', to: 'gnd' }
      ]
    }
    const report = ok(solve(circuit))
    const r1 = report.components.find((one) => one.id === 'R1')
    assert.ok(r1)
    closeTo(Math.abs(r1.current.magnitude), 0, 1e-12)
  })

  it('and passes everything when closed', () => {
    const circuit: Circuit = {
      ground: 'gnd',
      components: [
        { id: 'V1', kind: 'voltage-source', value: 12, from: 'gnd', to: 'a' },
        { id: 'S1', kind: 'switch', value: 0, from: 'a', to: 'b', closed: true },
        { id: 'R1', kind: 'resistor', value: 100, from: 'b', to: 'gnd' }
      ]
    }
    const report = ok(solve(circuit))
    const r1 = report.components.find((one) => one.id === 'R1')
    assert.ok(r1)
    closeTo(Math.abs(r1.current.magnitude), 0.12, 1e-9)
  })
})

describe('series and parallel shortcuts', () => {
  it('adds in series and reciprocates in parallel', () => {
    closeTo(ok(combineResistors([100, 200, 300], 'series')).total, 600, 1e-12)
    closeTo(ok(combineResistors([100, 100], 'parallel')).total, 50, 1e-12)
  })

  it('refuses a zero-ohm resistor in parallel', () => {
    assert.equal(bad(combineResistors([100, 0], 'parallel')).error, 'short-circuit')
  })
})

describe('first-order transients', () => {
  it('has a time constant of RC and reaches 63.2% after one of them', () => {
    const report = ok(transient({ kind: 'rc-charge', resistance: 1000, capacitance: 1e-6, supplyVoltage: 10 }))
    closeTo(report.timeConstant, 1e-3, 1e-15)
    const atTau = report.samples.find((one) => Math.abs(one.time - 1e-3) < 1e-5)
    assert.ok(atTau)
    closeTo(atTau.voltage / 10, 0.632, 0.01, 'one time constant')
  })

  it('has a time constant of L over R for an inductor', () => {
    const report = ok(transient({ kind: 'rl-energise', resistance: 100, inductance: 0.1, supplyVoltage: 10 }))
    closeTo(report.timeConstant, 1e-3, 1e-15)
    closeTo(report.finalValue, 0.1, 1e-12, 'final current is V/R')
  })

  it('decays toward zero when discharging', () => {
    const report = ok(transient({ kind: 'rc-discharge', resistance: 1000, capacitance: 1e-6, initialVoltage: 10 }))
    assert.equal(report.finalValue, 0)
    assert.ok(report.samples[report.samples.length - 1].voltage < 0.1)
  })

  it('refuses a transient with no resistance', () => {
    assert.match(bad(transient({ kind: 'rc-charge', resistance: 0, capacitance: 1e-6 })).message, /no time constant/)
  })
})

describe('second-order behaviour', () => {
  it('rings below critical damping and the ringing frequency is below the natural one', () => {
    const report = ok(rlc({ resistance: 10, inductance: 1e-3, capacitance: 1e-6 }))
    assert.equal(report.damping, 'underdamped')
    assert.ok(report.dampedAngular !== null)
    assert.ok((report.dampedAngular as number) < report.naturalAngular, 'damped is slower than natural')
  })

  it('classifies critical damping exactly', () => {
    // zeta = (R/2)*sqrt(C/L) = 1  ->  R = 2*sqrt(L/C)
    const r = 2 * Math.sqrt(1e-3 / 1e-6)
    const report = ok(rlc({ resistance: r, inductance: 1e-3, capacitance: 1e-6 }))
    assert.equal(report.damping, 'critically-damped')
    assert.equal(report.dampedAngular, null)
  })

  it('classifies overdamping', () => {
    const report = ok(rlc({ resistance: 500, inductance: 1e-3, capacitance: 1e-6 }))
    assert.equal(report.damping, 'overdamped')
    assert.ok(report.dampingRatio > 1)
  })

  it('reverses the effect of resistance in a parallel arrangement', () => {
    const series = ok(rlc({ resistance: 100, inductance: 1e-3, capacitance: 1e-6, arrangement: 'series' }))
    const parallel = ok(rlc({ resistance: 100, inductance: 1e-3, capacitance: 1e-6, arrangement: 'parallel' }))
    assert.ok(series.dampingRatio > 1, 'series is overdamped at 100 ohms')
    assert.ok(parallel.dampingRatio < 1, 'parallel is underdamped at the same 100 ohms')
    assert.ok(parallel.notes.some((one) => /opposite of the series case/.test(one)))
  })

  it('approaches the step amplitude', () => {
    const report = ok(rlc({ resistance: 50, inductance: 1e-3, capacitance: 1e-6, stepAmplitude: 5 }))
    closeTo(report.samples[report.samples.length - 1].value, 5, 0.1)
  })
})

describe('resonance', () => {
  it('finds the frequency where the reactances cancel', () => {
    const report = ok(resonanceSweep({ resistance: 10, inductance: 1e-3, capacitance: 1e-6 }))
    closeTo(report.resonantFrequency, 1 / (2 * Math.PI * Math.sqrt(1e-3 * 1e-6)), 1e-6)
  })

  it('has its minimum impedance at resonance in a series circuit', () => {
    const report = ok(resonanceSweep({ resistance: 10, inductance: 1e-3, capacitance: 1e-6 }))
    const lowest = report.points.reduce((best, one) => (one.impedanceMagnitude < best.impedanceMagnitude ? one : best))
    closeTo(lowest.frequency / report.resonantFrequency, 1, 0.02)
    closeTo(lowest.impedanceMagnitude, 10, 0.5, 'purely resistive at resonance')
  })

  it('has its maximum impedance at resonance in a parallel circuit', () => {
    const report = ok(
      resonanceSweep({ resistance: 1000, inductance: 1e-3, capacitance: 1e-6, arrangement: 'parallel' })
    )
    const highest = report.points.reduce((best, one) => (one.impedanceMagnitude > best.impedanceMagnitude ? one : best))
    closeTo(highest.frequency / report.resonantFrequency, 1, 0.02)
  })

  it('relates bandwidth to Q', () => {
    const report = ok(resonanceSweep({ resistance: 10, inductance: 1e-3, capacitance: 1e-6 }))
    closeTo(report.bandwidth, report.resonantFrequency / report.qualityFactor, 1e-6)
  })
})

describe('AC power', () => {
  it('keeps the three powers distinct', () => {
    const report = ok(acPower({ voltageRms: 230, currentRms: 10, phaseDegrees: 60 }))
    closeTo(report.apparentPower, 2300, 1e-9)
    closeTo(report.realPower, 1150, 1e-6)
    closeTo(report.powerFactor, 0.5, 1e-9)
    closeTo(Math.hypot(report.realPower, report.reactivePower), report.apparentPower, 1e-6, 'power triangle closes')
  })

  it('names lagging and leading correctly', () => {
    assert.equal(ok(acPower({ voltageRms: 1, currentRms: 1, phaseDegrees: 30 })).character, 'lagging')
    assert.equal(ok(acPower({ voltageRms: 1, currentRms: 1, phaseDegrees: -30 })).character, 'leading')
    assert.equal(ok(acPower({ voltageRms: 1, currentRms: 1, phaseDegrees: 0 })).character, 'unity')
  })

  it('refuses both angle units at once', () => {
    assert.match(bad(acPower({ voltageRms: 1, currentRms: 1, phaseDegrees: 30, phaseRadians: 0.5 })).message, /not both/)
  })
})

describe('transformers', () => {
  it('steps voltage up by the turns ratio and current down by the same', () => {
    const report = ok(transformer({ primaryTurns: 100, secondaryTurns: 200, primaryVoltage: 10, loadResistance: 40 }))
    closeTo(report.secondaryVoltage, 20, 1e-12)
    closeTo(report.secondaryCurrent, 0.5, 1e-12)
    closeTo(report.primaryCurrent, 1, 1e-12)
  })

  it('transforms impedance as the square of the ratio', () => {
    const report = ok(transformer({ primaryTurns: 100, secondaryTurns: 200, primaryVoltage: 10, loadResistance: 40 }))
    closeTo(report.reflectedImpedance, 10, 1e-12, '40 / 2^2')
  })

  it('says the ideal model is ideal rather than implying a real efficiency', () => {
    const report = ok(transformer({ primaryTurns: 100, secondaryTurns: 200, primaryVoltage: 10, loadResistance: 40 }))
    assert.equal(report.model, 'ideal')
    assert.equal(report.efficiency, 1)
    assert.equal(report.losses, 0)
    assert.ok(report.notes.some((one) => /nothing to lose energy to/.test(one)))
  })

  it('drops below unity once losses are given', () => {
    const report = ok(
      transformer({
        primaryTurns: 100,
        secondaryTurns: 200,
        primaryVoltage: 10,
        loadResistance: 40,
        windingResistancePrimary: 0.5,
        windingResistanceSecondary: 1
      })
    )
    assert.equal(report.model, 'with-losses')
    assert.ok(report.efficiency < 1 && report.efficiency > 0.8)
    assert.ok(report.losses > 0)
    assert.ok(report.secondaryVoltage < 20, 'below the ideal turns ratio')
  })
})
