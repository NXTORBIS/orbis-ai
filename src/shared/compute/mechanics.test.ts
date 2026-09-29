import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  body,
  centreOfMass,
  compareIntegrators,
  cross,
  direction,
  distance,
  dot,
  FORCE_FACTS,
  forcesOn,
  hasExternalWork,
  INTEGRATOR_FACTS,
  INTEGRATORS,
  isDissipative,
  isMechanicsError,
  kineticEnergy,
  magnitude,
  potentialEnergy,
  run,
  scale,
  stableStep,
  subtract,
  totalEnergy,
  system,
  totalMomentum,
  vec,
  type Body,
  type Force,
  type MechanicsError,
  type System,
  type Vec2
} from './mechanics.ts'

const ok = <T>(value: T): Exclude<T, MechanicsError> => {
  assert.ok(!isMechanicsError(value), isMechanicsError(value) ? value.message : '')
  return value as Exclude<T, MechanicsError>
}

const closeTo = (actual: number, expected: number, tolerance: number, what = ''): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} expected ${expected} within ${tolerance}, got ${actual}`)
}

const makeBody = (one: Partial<Body> & { id: string; mass: number }): Body => ok(body(one))
const makeSystem = (bodies: readonly Body[], forces: readonly Force[]): System => ok(system(bodies, forces))

const GRAVITY: Force = { kind: 'uniform-gravity', acceleration: vec(0, -9.81) }

describe('vectors', () => {
  it('does the arithmetic', () => {
    assert.deepEqual(subtract(vec(3, 4), vec(1, 1)), { x: 2, y: 3 })
    assert.deepEqual(scale(vec(2, 3), 2), { x: 4, y: 6 })
    assert.equal(dot(vec(1, 2), vec(3, 4)), 11)
    assert.equal(cross(vec(1, 0), vec(0, 1)), 1)
    assert.equal(magnitude(vec(3, 4)), 5)
    assert.equal(distance(vec(0, 0), vec(3, 4)), 5)
  })

  it('refuses a direction for a vector of no length', () => {
    assert.ok(isMechanicsError(direction(vec(0, 0))))
    assert.deepEqual(ok(direction(vec(0, 5))), { x: 0, y: 1 })
  })
})

describe('bodies', () => {
  it('refuses a massless body that is not fixed, and says what fixed is for', () => {
    const result = body({ id: 'ghost', mass: 0 })
    assert.ok(isMechanicsError(result))
    assert.equal(result.error, 'zero-mass')
    assert.match(result.message, /something immovable is described/)
  })

  it('allows a fixed body with no mass', () => {
    assert.ok(!isMechanicsError(body({ id: 'wall', mass: 0, fixed: true })))
  })

  it('refuses a negative radius', () => {
    assert.ok(isMechanicsError(body({ id: 'a', mass: 1, radius: -1 })))
  })

  it('refuses a position that is not a number', () => {
    assert.ok(isMechanicsError(body({ id: 'a', mass: 1, position: vec(Number.NaN, 0) })))
  })
})

describe('systems', () => {
  it('refuses a system with nothing in it', () => {
    const result = system([], [])
    assert.ok(isMechanicsError(result))
    assert.equal(result.error, 'no-bodies')
  })

  it('refuses two bodies with the same id', () => {
    assert.ok(isMechanicsError(system([makeBody({ id: 'a', mass: 1 }), makeBody({ id: 'a', mass: 2 })], [])))
  })

  it('refuses a force naming a body that is not there', () => {
    const result = system([makeBody({ id: 'a', mass: 1 })], [{ kind: 'constant', bodyId: 'b', force: vec(1, 0) }])
    assert.ok(isMechanicsError(result))
    assert.match(result.message, /not in this system/)
  })

  it('knows which systems lose energy and which have work done on them', () => {
    assert.equal(isDissipative(makeSystem([makeBody({ id: 'a', mass: 1 })], [GRAVITY])), false)
    assert.equal(
      isDissipative(makeSystem([makeBody({ id: 'a', mass: 1 })], [{ kind: 'linear-drag', bodyId: null, coefficient: 0.1 }])),
      true
    )
    assert.equal(
      hasExternalWork(makeSystem([makeBody({ id: 'a', mass: 1 })], [{ kind: 'constant', bodyId: 'a', force: vec(1, 0) }])),
      true
    )
  })

  it('has facts for every force it knows', () => {
    for (const kind of Object.keys(FORCE_FACTS) as (keyof typeof FORCE_FACTS)[]) {
      assert.ok(FORCE_FACTS[kind].describe.length > 40, kind)
    }
    assert.equal(FORCE_FACTS['quadratic-drag'].dissipative, true)
    assert.equal(FORCE_FACTS.spring.conservative, true)
  })
})

describe('forces', () => {
  it('gives uniform gravity the same acceleration and different forces', () => {
    const one = makeSystem([makeBody({ id: 'light', mass: 1 }), makeBody({ id: 'heavy', mass: 10 })], [GRAVITY])
    const forces = forcesOn(one, [vec(0, 0), vec(1, 0)], [vec(0, 0), vec(0, 0)])
    closeTo(forces[0]?.y as number, -9.81, 1e-12)
    closeTo(forces[1]?.y as number, -98.1, 1e-12)
  })

  it('makes a spring pull both ends equally and oppositely', () => {
    const one = makeSystem(
      [makeBody({ id: 'a', mass: 1, position: vec(0, 0) }), makeBody({ id: 'b', mass: 1, position: vec(3, 0) })],
      [{ kind: 'spring', bodyId: 'a', otherId: 'b', anchor: vec(0, 0), stiffness: 10, restLength: 2, damping: 0 }]
    )
    const forces = forcesOn(one, [vec(0, 0), vec(3, 0)], [vec(0, 0), vec(0, 0)])
    // Stretched by 1, so a is pulled toward b (+x) with 10 N and b toward a with 10 N.
    closeTo(forces[0]?.x as number, 10, 1e-12)
    closeTo(forces[1]?.x as number, -10, 1e-12)
  })

  it('leaves a spring at its rest length pushing nothing', () => {
    const one = makeSystem(
      [makeBody({ id: 'a', mass: 1 })],
      [{ kind: 'spring', bodyId: 'a', otherId: null, anchor: vec(2, 0), stiffness: 10, restLength: 2, damping: 0 }]
    )
    const forces = forcesOn(one, [vec(0, 0)], [vec(0, 0)])
    closeTo(magnitude(forces[0] as Vec2), 0, 1e-12)
  })

  it('opposes velocity with linear drag and squares it with quadratic', () => {
    const linear = makeSystem([makeBody({ id: 'a', mass: 1 })], [{ kind: 'linear-drag', bodyId: null, coefficient: 0.5 }])
    closeTo((forcesOn(linear, [vec(0, 0)], [vec(4, 0)])[0] as Vec2).x, -2, 1e-12)

    const quadratic = makeSystem([makeBody({ id: 'a', mass: 1 })], [{ kind: 'quadratic-drag', bodyId: null, coefficient: 0.5 }])
    // 0.5 × 4² = 8, against the direction of travel.
    closeTo((forcesOn(quadratic, [vec(0, 0)], [vec(4, 0)])[0] as Vec2).x, -8, 1e-12)
  })

  it('leaves a stationary body alone under quadratic drag', () => {
    const one = makeSystem([makeBody({ id: 'a', mass: 1 })], [{ kind: 'quadratic-drag', bodyId: null, coefficient: 0.5 }])
    closeTo(magnitude(forcesOn(one, [vec(0, 0)], [vec(0, 0)])[0] as Vec2), 0, 1e-12)
  })

  it('attracts two bodies equally and oppositely under mutual gravity', () => {
    const one = makeSystem(
      [makeBody({ id: 'a', mass: 2, position: vec(0, 0) }), makeBody({ id: 'b', mass: 3, position: vec(2, 0) })],
      [{ kind: 'mutual-gravity', constant: 1, softening: 0 }]
    )
    const forces = forcesOn(one, [vec(0, 0), vec(2, 0)], [vec(0, 0), vec(0, 0)])
    // G·m1·m2/r² = 1·2·3/4 = 1.5
    closeTo(forces[0]?.x as number, 1.5, 1e-12)
    closeTo(forces[1]?.x as number, -1.5, 1e-12)
  })

  it('never pushes a fixed body', () => {
    const one = makeSystem(
      [makeBody({ id: 'wall', mass: 1000, fixed: true }), makeBody({ id: 'ball', mass: 1 })],
      [GRAVITY, { kind: 'mutual-gravity', constant: 1, softening: 0.1 }]
    )
    const forces = forcesOn(one, [vec(0, 0), vec(1, 0)], [vec(0, 0), vec(0, 0)])
    closeTo(magnitude(forces[0] as Vec2), 0, 1e-12)
  })
})

describe('energy and momentum', () => {
  it('adds kinetic and potential together', () => {
    const one = makeSystem([makeBody({ id: 'a', mass: 2, position: vec(0, 3) })], [GRAVITY])
    closeTo(totalEnergy(one, [vec(0, 3)], [vec(4, 0)]), 0.5 * 2 * 16 + 2 * 9.81 * 3, 1e-12)
  })

  it('adds up kinetic energy', () => {
    const one = makeSystem([makeBody({ id: 'a', mass: 2 }), makeBody({ id: 'b', mass: 4 })], [])
    closeTo(kineticEnergy(one, [vec(3, 0), vec(0, 1)]), 0.5 * 2 * 9 + 0.5 * 4 * 1, 1e-12)
  })

  it('gives a fixed body no kinetic energy and no momentum', () => {
    const one = makeSystem([makeBody({ id: 'wall', mass: 5, fixed: true })], [])
    assert.equal(kineticEnergy(one, [vec(10, 0)]), 0)
    assert.deepEqual(totalMomentum(one, [vec(10, 0)]), { x: 0, y: 0 })
  })

  it('measures gravitational potential from y = 0', () => {
    const one = makeSystem([makeBody({ id: 'a', mass: 2 })], [GRAVITY])
    closeTo(potentialEnergy(one, [vec(0, 5)]), 2 * 9.81 * 5, 1e-12)
    closeTo(potentialEnergy(one, [vec(0, 0)]), 0, 1e-12)
  })

  it('stores energy in a stretched spring and none in a relaxed one', () => {
    const one = makeSystem(
      [makeBody({ id: 'a', mass: 1 })],
      [{ kind: 'spring', bodyId: 'a', otherId: null, anchor: vec(0, 0), stiffness: 8, restLength: 1, damping: 0 }]
    )
    closeTo(potentialEnergy(one, [vec(3, 0)]), 0.5 * 8 * 4, 1e-12)
    closeTo(potentialEnergy(one, [vec(1, 0)]), 0, 1e-12)
  })

  it('finds the centre of mass', () => {
    const one = makeSystem([makeBody({ id: 'a', mass: 1 }), makeBody({ id: 'b', mass: 3 })], [])
    const centre = ok(centreOfMass(one, [vec(0, 0), vec(4, 0)]))
    closeTo(centre.x, 3, 1e-12)
  })
})

describe('the integrators', () => {
  /** A mass on a spring: the case where symplectic matters and where the exact answer is known. */
  const oscillator = (): System =>
    makeSystem(
      [makeBody({ id: 'm', mass: 1, position: vec(1, 0) })],
      [{ kind: 'spring', bodyId: 'm', otherId: null, anchor: vec(0, 0), stiffness: 1, restLength: 0, damping: 0 }]
    )

  it('has facts for every integrator it offers', () => {
    for (const one of INTEGRATORS) {
      assert.ok(INTEGRATOR_FACTS[one].describe.length > 40, one)
      assert.ok(INTEGRATOR_FACTS[one].wrongWhen.length > 20, one)
    }
    assert.equal(INTEGRATOR_FACTS['velocity-verlet'].symplectic, true)
    assert.equal(INTEGRATOR_FACTS.rk4.symplectic, false)
  })

  it('lets Euler run away with the energy, and says that is the method', () => {
    const result = ok(run(oscillator(), { integrator: 'euler', step: 0.05, until: 200 }))
    assert.ok(result.energy.final > result.energy.initial * 1.5, `energy went ${result.energy.initial} → ${result.energy.final}`)
    assert.ok(result.notes.some((one) => /not symplectic/.test(one)))
    assert.ok(result.notes.some((one) => /the integrator rather than the physics/.test(one)))
  })

  it('keeps the energy bounded with semi-implicit Euler, at the same step and the same order', () => {
    const euler = ok(run(oscillator(), { integrator: 'euler', step: 0.05, until: 200 }))
    const symplectic = ok(run(oscillator(), { integrator: 'semi-implicit', step: 0.05, until: 200 }))
    // Both first order. The only difference is the order of the two lines, and it decides the whole long run.
    assert.ok(symplectic.energy.relativeDrift < 0.1, `drift was ${symplectic.energy.relativeDrift}`)
    assert.ok(symplectic.energy.relativeDrift < euler.energy.relativeDrift / 10)
  })

  it('keeps the energy bounded with velocity Verlet over a very long run', () => {
    const result = ok(run(oscillator(), { integrator: 'velocity-verlet', step: 0.01, until: 2000 }))
    assert.ok(result.energy.relativeDrift < 1e-3, `drift was ${result.energy.relativeDrift}`)
    assert.ok(result.notes.some((one) => /oscillates around its starting value/.test(one)))
  })

  it('tracks the exact solution of a harmonic oscillator', () => {
    // x(t) = cos(t) for k = m = 1 released from x = 1 at rest.
    const result = ok(run(oscillator(), { integrator: 'velocity-verlet', step: 0.001, until: 10, samples: 20000 }))
    for (const snapshot of result.trace) {
      const exact = Math.cos(snapshot.time)
      closeTo(snapshot.positions[0]?.x as number, exact, 2e-3, `at t=${snapshot.time}`)
    }
  })

  it('reproduces free fall exactly under uniform gravity', () => {
    const one = makeSystem([makeBody({ id: 'ball', mass: 2, position: vec(0, 100) })], [GRAVITY])
    const result = ok(run(one, { integrator: 'velocity-verlet', step: 0.001, until: 2 }))
    // Verlet is exact for a constant acceleration: the quadratic term in the position update is the whole solution.
    closeTo(result.final.positions[0]?.y as number, 100 - 0.5 * 9.81 * 4, 1e-9)
    closeTo(result.final.velocities[0]?.y as number, -9.81 * 2, 1e-9)
  })

  it('gives the same answer every time', () => {
    const a = ok(run(oscillator(), { integrator: 'velocity-verlet', step: 0.01, until: 20 }))
    const b = ok(run(oscillator(), { integrator: 'velocity-verlet', step: 0.01, until: 20 }))
    assert.deepEqual(a.final.positions, b.final.positions)
    assert.deepEqual(a.final.velocities, b.final.velocities)
  })

  it('conserves momentum in a closed two-body system', () => {
    const one = makeSystem(
      [
        makeBody({ id: 'a', mass: 2, position: vec(-1, 0), velocity: vec(0, 0.3) }),
        makeBody({ id: 'b', mass: 3, position: vec(1, 0), velocity: vec(0, -0.2) })
      ],
      [{ kind: 'mutual-gravity', constant: 1, softening: 0.05 }]
    )
    const result = ok(run(one, { integrator: 'velocity-verlet', step: 0.001, until: 20 }))
    closeTo(result.momentum.final.x, result.momentum.initial.x, 1e-9)
    closeTo(result.momentum.final.y, result.momentum.initial.y, 1e-9)
  })

  it('takes energy out when there is drag, and says that is the physics', () => {
    const one = makeSystem(
      [makeBody({ id: 'm', mass: 1, position: vec(1, 0) })],
      [
        { kind: 'spring', bodyId: 'm', otherId: null, anchor: vec(0, 0), stiffness: 1, restLength: 0, damping: 0 },
        { kind: 'linear-drag', bodyId: null, coefficient: 0.2 }
      ]
    )
    const result = ok(run(one, { integrator: 'velocity-verlet', step: 0.01, until: 50 }))
    assert.equal(result.energyShouldBeConstant, false)
    assert.ok(result.energy.final < result.energy.initial * 0.1)
    assert.ok(result.notes.some((one) => /physics rather than error/.test(one)))
  })

  it('does not claim conservation when a constant force does work', () => {
    const one = makeSystem([makeBody({ id: 'a', mass: 1 })], [{ kind: 'constant', bodyId: 'a', force: vec(1, 0) }])
    const result = ok(run(one, { integrator: 'velocity-verlet', step: 0.01, until: 5 }))
    assert.equal(result.energyShouldBeConstant, false)
    assert.ok(result.notes.some((one) => /no potential behind it/.test(one)))
  })

  it('stops early when told to, and keeps the snapshot it stopped at', () => {
    const one = makeSystem([makeBody({ id: 'ball', mass: 1, position: vec(0, 10) })], [GRAVITY])
    const result = ok(
      run(one, {
        integrator: 'velocity-verlet',
        step: 0.001,
        until: 100,
        stopWhen: (snapshot) => (snapshot.positions[0]?.y ?? 0) <= 0
      })
    )
    assert.equal(result.status, 'stopped-early')
    closeTo(result.final.time, Math.sqrt((2 * 10) / 9.81), 2e-3)
  })

  it('reports divergence rather than returning a huge number', () => {
    const one = makeSystem(
      [makeBody({ id: 'm', mass: 1, position: vec(1, 0) })],
      [{ kind: 'spring', bodyId: 'm', otherId: null, anchor: vec(0, 0), stiffness: 1e6, restLength: 0, damping: 0 }]
    )
    const result = ok(run(one, { integrator: 'euler', step: 0.5, until: 100 }))
    assert.equal(result.status, 'diverged')
    assert.ok(result.notes.some((one) => /ran off to infinity/.test(one)))
  })

  it('refuses a step of zero and a run of no length', () => {
    assert.ok(isMechanicsError(run(oscillator(), { step: 0, until: 1 })))
    assert.ok(isMechanicsError(run(oscillator(), { step: 0.1, until: 0 })))
  })

  it('refuses an integrator it does not have', () => {
    const result = run(oscillator(), { integrator: 'leapfrog' as never, step: 0.1, until: 1 })
    assert.ok(isMechanicsError(result))
    assert.match(result.message, /velocity-verlet/)
  })

  it('refuses a run that would take more steps than it will run', () => {
    const result = run(oscillator(), { step: 1e-9, until: 1000 })
    assert.ok(isMechanicsError(result))
    assert.equal(result.error, 'too-many-steps')
  })

  it('keeps the trace to the sample count asked for without changing the step', () => {
    const coarse = ok(run(oscillator(), { step: 0.001, until: 10, samples: 50 }))
    const fine = ok(run(oscillator(), { step: 0.001, until: 10, samples: 5000 }))
    assert.ok(coarse.trace.length < 60)
    assert.ok(fine.trace.length > 1000)
    // The step is what decides the answer; the sampling only decides what was kept.
    closeTo(coarse.final.positions[0]?.x as number, fine.final.positions[0]?.x as number, 1e-12)
  })
})

describe('stableStep', () => {
  it('works out the limit from the stiffest spring', () => {
    const one = makeSystem(
      [makeBody({ id: 'm', mass: 1 })],
      [{ kind: 'spring', bodyId: 'm', otherId: null, anchor: vec(0, 0), stiffness: 100, restLength: 0, damping: 0 }]
    )
    const limit = stableStep(one)
    // ω = √(k/m) = 10, so the limit is 2/10.
    closeTo(limit.limit as number, 0.2, 1e-12)
    assert.match(limit.from, /oscillates at/)
  })

  it('uses the reduced mass when both ends are free', () => {
    const one = makeSystem(
      [makeBody({ id: 'a', mass: 2 }), makeBody({ id: 'b', mass: 2 })],
      [{ kind: 'spring', bodyId: 'a', otherId: 'b', anchor: vec(0, 0), stiffness: 8, restLength: 1, damping: 0 }]
    )
    // Reduced mass is 1, so ω = √8 and the limit is 2/√8.
    closeTo(stableStep(one).limit as number, 2 / Math.sqrt(8), 1e-12)
  })

  it('says plainly when nothing sets a limit', () => {
    const one = makeSystem([makeBody({ id: 'a', mass: 1 })], [GRAVITY])
    const limit = stableStep(one)
    assert.equal(limit.limit, null)
    assert.match(limit.from, /no oscillation for a step to outrun/)
  })

  it('warns when a run is above the limit', () => {
    const one = makeSystem(
      [makeBody({ id: 'm', mass: 1, position: vec(1, 0) })],
      [{ kind: 'spring', bodyId: 'm', otherId: null, anchor: vec(0, 0), stiffness: 100, restLength: 0, damping: 0 }]
    )
    const result = ok(run(one, { integrator: 'semi-implicit', step: 0.3, until: 5 }))
    assert.ok(result.notes.some((one) => /it is the method failing/.test(one)))
  })

  it('warns when a run is stable but coarse', () => {
    const one = makeSystem(
      [makeBody({ id: 'm', mass: 1, position: vec(1, 0) })],
      [{ kind: 'spring', bodyId: 'm', otherId: null, anchor: vec(0, 0), stiffness: 100, restLength: 0, damping: 0 }]
    )
    const result = ok(run(one, { integrator: 'velocity-verlet', step: 0.1, until: 5 }))
    assert.ok(result.notes.some((one) => /stable but coarse/.test(one)))
  })
})

describe('compareIntegrators', () => {
  const oscillator = (): System =>
    makeSystem(
      [makeBody({ id: 'm', mass: 1, position: vec(1, 0) })],
      [{ kind: 'spring', bodyId: 'm', otherId: null, anchor: vec(0, 0), stiffness: 1, restLength: 0, damping: 0 }]
    )

  it('runs every method and reports each one drift', () => {
    const result = ok(compareIntegrators(oscillator(), { step: 0.02, until: 100 }))
    assert.equal(result.entries.length, INTEGRATORS.length)
    for (const entry of result.entries) {
      assert.ok(Number.isFinite(entry.relativeDrift), entry.integrator)
    }
  })

  it('shows the symplectic methods drifting less than Euler over a long run', () => {
    const result = ok(compareIntegrators(oscillator(), { step: 0.02, until: 500 }))
    const euler = result.entries.find((one) => one.integrator === 'euler')
    const verlet = result.entries.find((one) => one.integrator === 'velocity-verlet')
    const semi = result.entries.find((one) => one.integrator === 'semi-implicit')
    assert.ok((verlet?.relativeDrift ?? 1) < (euler?.relativeDrift ?? 0))
    assert.ok((semi?.relativeDrift ?? 1) < (euler?.relativeDrift ?? 0))
  })

  it('never says being closest to the yardstick is being right', () => {
    const result = ok(compareIntegrators(oscillator(), { step: 0.02, until: 20 }))
    assert.ok(result.caveats.some((one) => /not the same as being right/.test(one)))
    assert.ok(result.caveats.some((one) => /bounded error eventually beats small error/.test(one)))
  })
})
