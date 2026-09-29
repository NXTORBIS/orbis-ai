/**
 * The engineering bridge, tested through the door a Page actually knocks on.
 *
 * The engines have their own tests. What is checked here is the boundary: that every advertised operation has an
 * implementation, that untrusted input is read rather than trusted, that a refusal arrives as a value with a
 * reason on it, and that the traces crossing the boundary are thinned without the answer changing.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ENGINEERING_CAPABILITY, ENGINEERING_LIMITS, runEngineeringOperation } from './engineeringEngines.ts'
import { BadInput } from './engines.ts'

const run = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> =>
  runEngineeringOperation(operation, input) as Record<string, unknown>

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
  for (const operation of Object.keys(ENGINEERING_CAPABILITY)) {
    try {
      runEngineeringOperation(operation, {})
    } catch (error) {
      // A missing argument is fine — that is the reader doing its job. An unknown operation is not.
      assert.ok(error instanceof BadInput, `${operation} threw something other than BadInput: ${String(error)}`)
      assert.ok(
        !/is not an engineering operation/.test(error.message),
        `${operation} is advertised but has no implementation`
      )
    }
  }
})

test('every operation asks for the same capability, and it is the engineering one', () => {
  for (const [operation, capability] of Object.entries(ENGINEERING_CAPABILITY)) {
    assert.equal(capability, 'computation.engineering', `${operation} asks for something else`)
  }
})

test('an operation nobody advertises is refused', () => {
  assert.throws(() => runEngineeringOperation('engineering.launch-rocket', {}), BadInput)
})

// ---------------------------------------------------------------- materials

test('the material list names what each material actually holds', () => {
  const result = ok('material.list')
  const materials = result.materials as { id: string; has: string[] }[]
  assert.ok(materials.length > 5)
  assert.ok(materials.every((one) => Array.isArray(one.has) && one.has.length > 0))
})

test('a property comes back with where it came from, and a missing one comes back refused', () => {
  const found = ok('material.property', { material: 'steel-mild', property: 'youngsModulus' })
  assert.ok(typeof found.source === 'string' && (found.source as string).length > 0)

  const missing = run('material.property', { material: 'steel-mild', property: 'flavour' })
  assert.equal(missing.ok, false)
  assert.ok(typeof missing.message === 'string')
})

test('elastic constants refuse one input and accept two', () => {
  const one = run('material.elastic', { youngsModulus: 200e9 })
  assert.equal(one.ok, false)
  const two = ok('material.elastic', { youngsModulus: 200e9, poissonRatio: 0.3 })
  near(two.shearModulus, 200e9 / 2.6, 1e6, 'shear modulus')
})

// ---------------------------------------------------------------- statics

test('a beam with a central load splits it, through the door', () => {
  const result = ok('statics.beam', {
    length: 4,
    supports: [
      { kind: 'pin', position: 0 },
      { kind: 'roller', position: 4 }
    ],
    pointLoads: [{ magnitude: 1000, position: 2 }]
  })
  const reactions = result.reactions as { vertical: number | null }[]
  near(reactions[0].vertical, 500, 1e-6, 'left reaction')
  assert.equal(result.equilibriumVerified, true)
})

test('an indeterminate beam is refused with a reason a Page can show', () => {
  const result = run('statics.beam', {
    length: 4,
    supports: [
      { kind: 'fixed', position: 0 },
      { kind: 'fixed', position: 4 }
    ],
    pointLoads: [{ magnitude: 1000, position: 2 }]
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'indeterminate')
  assert.ok(typeof result.message === 'string' && (result.message as string).length > 20)
})

test('a support kind nobody defined is refused rather than treated as free', () => {
  assert.throws(
    () =>
      runEngineeringOperation('statics.beam', {
        length: 4,
        supports: [{ kind: 'magnetic', position: 0 }],
        pointLoads: []
      }),
    BadInput
  )
})

test('a distributed load with no end intensity is uniform, not tapered', () => {
  const uniform = ok('statics.beam', {
    length: 4,
    supports: [
      { kind: 'pin', position: 0 },
      { kind: 'roller', position: 4 }
    ],
    distributedLoads: [{ startIntensity: 1000, start: 0, end: 4 }]
  })
  near(uniform.totalLoad, 4000, 1e-6, 'a uniform 1 kN/m over 4 m')
})

test('a truss solved through the door balances', () => {
  const result = ok('statics.truss', {
    nodes: [
      { id: 'a', x: 0, y: 0, support: 'pin' },
      { id: 'b', x: 4, y: 0, support: 'roller' },
      { id: 'c', x: 2, y: 2 }
    ],
    members: [
      { id: 'ab', from: 'a', to: 'b' },
      { id: 'ac', from: 'a', to: 'c' },
      { id: 'bc', from: 'b', to: 'c' }
    ],
    loads: [{ node: 'c', y: -1000 }]
  })
  assert.equal(result.equilibriumVerified, true)
})

test('a truss member pointing at a joint that does not exist is refused by name', () => {
  const result = run('statics.truss', {
    nodes: [{ id: 'a', x: 0, y: 0, support: 'pin' }],
    members: [{ id: 'ax', from: 'a', to: 'x' }]
  })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('x'))
})

// ---------------------------------------------------------------- beams

test('a section is computed, and a section missing a dimension is refused', () => {
  const rectangle = ok('section.properties', { shape: 'rectangle', width: 0.1, height: 0.2 })
  near(rectangle.ixx, (0.1 * 0.2 ** 3) / 12, 1e-12, 'bh^3/12')
  const partial = run('section.properties', { shape: 'rectangle', width: 0.1 })
  assert.equal(partial.ok, false)
})

test('a beam trace is thinned on the way out without moving the answer', () => {
  const base = {
    kind: 'simply-supported',
    length: 4,
    supportA: 0,
    supportB: 4,
    pointLoads: [{ magnitude: 1000, position: 2 }],
    youngsModulus: 200e9,
    secondMoment: 6.667e-5,
    stations: 801
  }
  const full = ok('beam.analyse', { ...base, samples: 801 })
  const thinned = ok('beam.analyse', { ...base, samples: 50 })
  const fullStations = full.stations as unknown[]
  const thinStations = thinned.stations as unknown[]
  assert.equal(fullStations.length, 801)
  assert.equal(thinStations.length, 50)
  // The answer comes from the integration, not from the trace, so thinning must not move it at all.
  assert.deepEqual(thinned.maxMoment, full.maxMoment)
  assert.deepEqual(thinned.maxDeflection, full.maxDeflection)
})

test('a beam trace cannot be asked for more samples than the door allows', () => {
  const result = ok('beam.analyse', {
    kind: 'cantilever',
    length: 2,
    pointLoads: [{ magnitude: 100, position: 2 }],
    stations: 201,
    samples: 1_000_000
  })
  assert.ok((result.stations as unknown[]).length <= ENGINEERING_LIMITS.samples)
})

test('failure criteria all come back, so the choice is visible', () => {
  const result = ok('stress.failure', { sigmaX: 200e6, sigmaY: -100e6, strength: 250e6 })
  assert.equal((result.comparison as unknown[]).length, 3)
})

// ---------------------------------------------------------------- fluids

test('laminar pipe flow does not iterate and turbulent flow does', () => {
  const laminar = ok('fluid.pipe', { diameter: 0.01, length: 10, velocity: 0.05, fluid: 'water' })
  assert.equal(laminar.regime, 'laminar')
  assert.equal(laminar.iterations, null)

  const turbulent = ok('fluid.pipe', { diameter: 0.1, length: 100, velocity: 2, fluid: 'water', roughness: 0.000045 })
  assert.equal(turbulent.regime, 'turbulent')
  assert.ok((turbulent.iterations as number) > 0, 'Colebrook is implicit and must have been iterated')
})

test('a fluid nobody stocks is refused rather than substituted with water', () => {
  const result = run('fluid.pressure', { depth: 10, fluid: 'custard' })
  assert.equal(result.ok, false)
})

test('continuity through the door refuses a zero area as a value, not a throw', () => {
  const result = run('fluid.continuity', { stations: [{ area: 0.01, velocity: 2 }, { area: 0 }], fluid: 'water' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'invalid-argument')
})

// ---------------------------------------------------------------- heat

test('a wall names the layer worth improving', () => {
  const result = ok('heat.resistance', {
    layers: [
      { label: 'brick', conductivity: 0.7, thickness: 0.1 },
      { label: 'insulation', conductivity: 0.04, thickness: 0.05 }
    ],
    area: 1,
    insideTemperature: 293,
    outsideTemperature: 273
  })
  assert.equal(result.dominantLayer, 'insulation')
  assert.ok((result.heatFlow as number) > 0)
})

test('a convection result says which correlation it used and whether it applied', () => {
  const result = ok('heat.convection', {
    correlation: 'dittus-boelter',
    characteristicLength: 0.05,
    thermalConductivity: 0.6,
    prandtl: 7,
    velocity: 2,
    kinematicViscosity: 1e-6
  })
  assert.equal(result.correlation, 'dittus-boelter')
  assert.equal(result.withinValidRange, true)
  assert.ok(typeof result.formula === 'string' && (result.formula as string).length > 0)
})

test('a correlation nobody fitted is refused', () => {
  assert.throws(
    () =>
      runEngineeringOperation('heat.convection', {
        correlation: 'my-own-guess',
        characteristicLength: 1,
        thermalConductivity: 1,
        prandtl: 1
      }),
    BadInput
  )
})

test('parallel flow refuses a crossed outlet through the door', () => {
  const result = run('heat.lmtd', {
    arrangement: 'parallel-flow',
    hotInlet: 400,
    hotOutlet: 350,
    coldInlet: 300,
    coldOutlet: 360
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'no-solution')
})

// ---------------------------------------------------------------- control

test('poles and stability come back for a known system', () => {
  const result = ok('control.poles', { system: { numerator: [4], denominator: [1, 2, 4] } })
  assert.equal(result.stable, true)
  near(result.dcGain, 1, 1e-12, 'unity at DC')
})

test('a tuning rule names itself and simulates the loop it produced', () => {
  const result = ok('control.tune', {
    rule: 'ziegler-nichols-ultimate',
    form: 'PID',
    ultimateGain: 8,
    ultimatePeriod: 3.63,
    plant: { numerator: [1], denominator: [1, 3, 3, 1] },
    samples: 100
  })
  assert.ok(typeof result.fittedFor === 'string' && (result.fittedFor as string).length > 0)
  const response = result.response as { samples: unknown[] } | null
  assert.ok(response !== null, 'the closed loop was simulated')
  assert.equal(response.samples.length, 100, 'and the trace was thinned to what was asked for')
})

test('a rule that needs a dead time is refused without one', () => {
  const result = run('control.tune', { rule: 'ziegler-nichols-step', processGain: 2, timeConstant: 10 })
  assert.equal(result.ok, false)
})

test('a PID simulation reports its saturation and thins its trace', () => {
  const result = ok('control.simulate', {
    plant: { numerator: [1], denominator: [1, 1] },
    gains: { proportional: 5, integral: 10 },
    setpoint: 1,
    duration: 10,
    timeStep: 0.001,
    outputMinimum: -1,
    outputMaximum: 1,
    samples: 120
  })
  assert.equal((result.samples as unknown[]).length, 120)
  assert.ok((result.saturatedFraction as number) > 0)
})

// ---------------------------------------------------------------- robotics

test('a two-link arm reaches its length and folds back to its base', () => {
  const links = [
    { d: 0, theta: 0, a: 1, alpha: 0 },
    { d: 0, theta: 0, a: 1, alpha: 0 }
  ]
  const straight = ok('robot.forward', { links, values: [0, 0] })
  near((straight.pose as { position: { x: number } }).position.x, 2, 1e-12, 'straight out')
  const folded = ok('robot.forward', { links, values: [0, Math.PI] })
  near((folded.pose as { position: { x: number } }).position.x, 0, 1e-9, 'folded back')
})

test('an unreachable target is reported as not reached, not as a pose', () => {
  const result = ok('robot.inverse', {
    links: [
      { d: 0, theta: 0, a: 1, alpha: 0 },
      { d: 0, theta: 0, a: 1, alpha: 0 }
    ],
    target: { x: 5, y: 0, z: 0 },
    initial: [0.2, 0.4]
  })
  assert.equal(result.converged, false)
  assert.ok((result.positionError as number) > 2.5)
  assert.ok((result.warnings as string[]).length > 0)
})

test('a joint type nobody defined is refused', () => {
  assert.throws(
    () => runEngineeringOperation('robot.forward', { links: [{ a: 1, type: 'hinge' }], values: [0] }),
    BadInput
  )
})

test('a trapezoidal move too short for its cruise speed is reported as a triangle', () => {
  const result = ok('robot.trajectory', {
    profile: 'trapezoidal',
    from: 0,
    to: 0.5,
    maximumVelocity: 2,
    maximumAcceleration: 1
  })
  assert.equal(result.triangular, true)
})

// ---------------------------------------------------------------- provenance

test('the assumptions cover every domain this bridge answers for', () => {
  const result = ok('engineering.assumptions')
  for (const domain of ['materials', 'statics', 'beams', 'fluids', 'heat', 'control', 'robotics']) {
    assert.ok(Array.isArray(result[domain]) && (result[domain] as unknown[]).length > 0, `${domain} has no assumptions listed`)
  }
})
