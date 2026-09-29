import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { EM_CAPABILITY, runEmOperation } from './emEngines.ts'

type Result = Record<string, unknown>

const run = (operation: string, input: Record<string, unknown> = {}): Result =>
  runEmOperation(operation, input) as Result

const good = (operation: string, input: Record<string, unknown> = {}): Result => {
  const result = run(operation, input)
  assert.equal(result.ok, true, `${operation}: ${String(result.message ?? 'refused')}`)
  return result
}

const refused = (operation: string, input: Record<string, unknown> = {}): Result => {
  const result = run(operation, input)
  assert.equal(result.ok, false, `${operation} should have refused`)
  return result
}

const threw = (operation: string, input: Record<string, unknown> = {}): Error => {
  try {
    runEmOperation(operation, input)
  } catch (error) {
    return error as Error
  }
  throw new assert.AssertionError({ message: `${operation} should have thrown` })
}

const closeTo = (actual: unknown, expected: number, tolerance: number, what = ''): void => {
  assert.equal(typeof actual, 'number', `${what} is not a number`)
  assert.ok(Math.abs((actual as number) - expected) <= tolerance, `${what} expected ${expected}, got ${actual}`)
}

describe('the door itself', () => {
  it('needs one capability for every operation and one operation for every capability', () => {
    const operations = Object.keys(EM_CAPABILITY)
    assert.ok(operations.length > 50, `only ${operations.length} operations`)
    for (const one of operations) {
      assert.equal(EM_CAPABILITY[one], 'computation.electromagnetism', `${one} has the wrong capability`)
    }
  })

  it('has an implementation behind every capability it advertises', () => {
    // A row that has a capability and no case is a Page control that looks live and is not, which is the one
    // failure mode this whole registry exists to prevent.
    for (const operation of Object.keys(EM_CAPABILITY)) {
      let message = ''
      try {
        runEmOperation(operation, {})
      } catch (error) {
        message = (error as Error).message
      }
      assert.ok(
        !message.includes('has a capability but no implementation'),
        `${operation} is advertised and not implemented`
      )
    }
  })

  it('refuses an operation it never advertised', () => {
    assert.match(threw('charge.teleport').message, /no implementation/)
  })
})

describe('electrostatics through the door', () => {
  it('returns a field and a potential', () => {
    const result = good('charge.field', { charges: [{ charge: 1e-9, x: 0, y: 0 }], at: { x: 1, y: 0 } })
    assert.ok(result.field)
    assert.equal(typeof result.potential, 'number')
  })

  it('caps the grid it will return', () => {
    const result = refused('charge.grid', {
      charges: [{ charge: 1, x: 0, y: 0 }],
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
      columns: 300,
      rows: 300
    })
    assert.equal(result.error, 'too-many')
  })

  it('refuses a charge list that is not numbers', () => {
    assert.match(threw('charge.field', { charges: [{ charge: 'lots', x: 0, y: 0 }], at: { x: 1, y: 0 } }).message, /finite number/)
  })
})

describe('the dielectric condition is required at the door', () => {
  const capacitor = { shape: 'parallel-plate', area: 0.01, separation: 0.001, voltage: 10, dielectricConstant: 4 }

  it('refuses to guess', () => {
    const error = threw('capacitor.dielectric', capacitor)
    assert.match(error.message, /"connected"/)
    assert.match(error.message, /"isolated"/)
  })

  it('answers either once told', () => {
    const connected = good('capacitor.dielectric', { ...capacitor, condition: 'connected' })
    const isolated = good('capacitor.dielectric', { ...capacitor, condition: 'isolated' })
    assert.equal(connected.held, 'voltage')
    assert.equal(isolated.held, 'charge')
  })
})

describe('circuits through the door', () => {
  const divider = {
    ground: 'gnd',
    components: [
      { id: 'V1', kind: 'voltage-source', value: 9, from: 'gnd', to: 'a' },
      { id: 'R1', kind: 'resistor', value: 1000, from: 'a', to: 'b' },
      { id: 'R2', kind: 'resistor', value: 2000, from: 'b', to: 'gnd' }
    ]
  }

  it('solves and reports its own Kirchhoff residual', () => {
    const result = good('circuit.solve', divider)
    const nodes = result.nodeVoltages as { node: string; voltage: { re: number } }[]
    const b = nodes.find((one) => one.node === 'b')
    assert.ok(b)
    closeTo(b.voltage.re, 6, 1e-6, 'divider output')
    assert.ok((result.kclResidual as number) < 1e-9)
  })

  it('names the shorted source rather than returning an enormous number', () => {
    const result = refused('circuit.solve', {
      ground: 'gnd',
      components: [
        { id: 'V1', kind: 'voltage-source', value: 12, from: 'gnd', to: 'a' },
        { id: 'W1', kind: 'wire', from: 'a', to: 'gnd' }
      ]
    })
    assert.equal(result.error, 'short-circuit')
    assert.deepEqual(result.involves, ['V1'])
  })

  it('reports problems without solving when asked to check', () => {
    const result = good('circuit.check', divider)
    assert.equal(result.ok, true)
    assert.deepEqual(result.problems, [])
  })

  it('caps the trace it returns without capping the model', () => {
    const result = good('circuit.transient', {
      kind: 'rc-charge',
      resistance: 1000,
      capacitance: 1e-6,
      supplyVoltage: 5,
      samples: 99_999
    })
    const samples = result.samples as unknown[]
    assert.ok(samples.length <= 4000, `returned ${samples.length} samples`)
  })
})

describe('magnetism through the door', () => {
  it('integrates a trajectory and reports its energy drift', () => {
    const result = good('magnet.trajectory', {
      particle: 'proton',
      initialVelocity: { x: 1e5, y: 0, z: 0 },
      magneticField: { x: 0, y: 0, z: 0.5 },
      duration: 1e-6,
      samples: 100
    })
    assert.ok((result.energyDrift as number) < 1e-9)
    assert.equal(result.motion, 'circular')
  })

  it('keeps the minus sign on an induced emf', () => {
    const result = good('magnet.induction', { fluxChange: 0.5, timeInterval: 0.1, turns: 100 })
    assert.ok((result.emf as number) < 0, 'Lenz')
  })
})

describe('optics through the door', () => {
  it('reports total internal reflection as its own answer', () => {
    const result = good('optics.refract', { incidentAngleDegrees: 60, fromIndex: 1.5, toIndex: 1 })
    assert.equal(result.totallyInternallyReflected, true)
    closeTo(result.reflectance, 1, 0)
  })

  it('carries the sign convention on an image result', () => {
    const result = good('optics.image', { optic: 'converging-lens', objectDistance: 0.3, focalLength: 0.1 })
    const convention = result.convention as { name: string }
    assert.equal(convention.name, 'Cartesian, real-is-positive')
  })

  it('refuses an element it does not know', () => {
    assert.match(threw('optics.image', { optic: 'kaleidoscope', objectDistance: 1, focalLength: 0.1 }).message, /has to be one of/)
  })
})

describe('acoustics through the door', () => {
  it('refuses a decibel ratio with nothing to compare against', () => {
    const result = refused('sound.decibels', { value: 2, reference: 'power-ratio' })
    assert.match(String(result.message), /compare against/)
  })

  it('adds levels logarithmically', () => {
    const result = good('sound.combine-levels', { levels: [60, 60] })
    closeTo(result.total, 63.01, 0.01)
  })

  it('refuses a supersonic Doppler source', () => {
    const result = refused('sound.doppler', { sourceFrequency: 400, sourceSpeed: 400, speedOfSound: 343 })
    assert.equal(result.error, 'supersonic')
  })

  it('gives a closed pipe only odd harmonics', () => {
    const result = good('sound.pipe', { kind: 'open-closed', length: 0.5, speed: 343, count: 3 })
    const harmonics = result.harmonics as { number: number }[]
    assert.deepEqual(
      harmonics.map((one) => one.number),
      [1, 3, 5]
    )
  })
})

describe('provenance', () => {
  it('names a source for every constant it uses', () => {
    const result = good('em.constants')
    const constants = result.constants as { symbol: string; name: string; source: string; derivedFrom: string | null }[]
    assert.ok(constants.length > 15)
    for (const one of constants) {
      assert.ok(one.source.length > 0, `${one.symbol} has no source`)
    }
    // By name, not by symbol: the Boltzmann constant is also written k, and it is listed first.
    const coulomb = constants.find((one) => one.name === "Coulomb's constant")
    assert.ok(coulomb)
    assert.equal(coulomb.source, 'Derived', 'not attributed to a measurement campaign')
    assert.match(coulomb.derivedFrom ?? '', /epsilon_0/)
  })

  it('exposes the assumptions each engine is standing on', () => {
    const result = good('em.assumptions')
    for (const key of ['electrostatics', 'circuits', 'magnetism', 'optics', 'acoustics']) {
      assert.ok(Array.isArray(result[key]) && (result[key] as unknown[]).length > 0, `${key} has no assumptions`)
    }
  })
})
