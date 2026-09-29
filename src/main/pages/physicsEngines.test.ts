import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { BadInput } from './engines.ts'
import { PHYSICS_CAPABILITY, PHYSICS_LIMITS, runPhysicsOperation } from './physicsEngines.ts'

/**
 * The physics bridge, checked through the door a Page actually uses.
 *
 * `labEngines.test.ts` holds the structural guards every bridge shares. What is here is the behaviour: that the
 * readers refuse what they should, that the limits are the ones advertised, and — most of all — that the numbers
 * coming back are the physics rather than something shaped like it.
 */

const run = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> =>
  runPhysicsOperation(operation, input) as Record<string, unknown>

const refused = (operation: string, input: Record<string, unknown> = {}): string => {
  try {
    runPhysicsOperation(operation, input)
  } catch (err) {
    assert.ok(err instanceof BadInput, `expected a BadInput, got ${String(err)}`)
    return err.message
  }
  return assert.fail(`${operation} was not refused`)
}

const closeTo = (actual: number, expected: number, tolerance: number, what = ''): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} expected ${expected} within ${tolerance}, got ${actual}`)
}

const G = 9.81

describe('the map', () => {
  it('routes every operation through one capability', () => {
    assert.deepEqual([...new Set(Object.values(PHYSICS_CAPABILITY))], ['computation.physics'])
  })

  it('covers all seven engines', () => {
    const families = new Set(Object.keys(PHYSICS_CAPABILITY).map((one) => one.split('.')[0]))
    for (const family of ['mechanics', 'motion', 'oscillator', 'collision', 'gravity', 'rotation', 'wave']) {
      assert.ok(families.has(family), `no operations for ${family}`)
    }
  })
})

describe('mechanics', () => {
  const spring = {
    bodies: [{ id: 'm', mass: 1, position: { x: 1, y: 0 } }],
    forces: [{ kind: 'spring', bodyId: 'm', otherId: null, anchor: { x: 0, y: 0 }, stiffness: 1, restLength: 0 }]
  }

  it('runs a system and reports which body is which', () => {
    const out = run('mechanics.run', { ...spring, step: 0.01, until: 10, samples: 100 })
    assert.equal(out.ok, true)
    assert.deepEqual(out.bodyIds, ['m'])
    assert.ok((out.trace as unknown[]).length <= 102)
  })

  it('shows Euler leaking energy where Verlet does not', () => {
    const euler = run('mechanics.run', { ...spring, integrator: 'euler', step: 0.05, until: 200 })
    const verlet = run('mechanics.run', { ...spring, integrator: 'velocity-verlet', step: 0.05, until: 200 })
    assert.ok((euler.energy as { relativeDrift: number }).relativeDrift > 0.5)
    assert.ok((verlet.energy as { relativeDrift: number }).relativeDrift < 0.01)
  })

  it('compares all four integrators in one answer', () => {
    const out = run('mechanics.compare-integrators', { ...spring, step: 0.02, until: 100 })
    assert.equal(out.ok, true)
    assert.equal((out.entries as unknown[]).length, 4)
    assert.equal(out.best, undefined, 'there is no winner to report')
  })

  it('works out the stable step from the stiffest spring', () => {
    const out = run('mechanics.stable-step', {
      bodies: [{ id: 'm', mass: 1 }],
      forces: [{ kind: 'spring', bodyId: 'm', otherId: null, anchor: { x: 0, y: 0 }, stiffness: 100, restLength: 0 }]
    })
    closeTo(out.limit as number, 0.2, 1e-9)
  })

  it('gives uniform gravity the same acceleration and different forces', () => {
    const out = run('mechanics.forces', {
      bodies: [{ id: 'light', mass: 1 }, { id: 'heavy', mass: 10 }],
      forces: [{ kind: 'uniform-gravity', acceleration: { x: 0, y: -9.81 } }]
    })
    const forces = out.forces as { id: string; force: { y: number }; acceleration: { y: number } }[]
    closeTo(forces[0]?.force.y as number, -9.81, 1e-9)
    closeTo(forces[1]?.force.y as number, -98.1, 1e-9)
    closeTo(forces[0]?.acceleration.y as number, forces[1]?.acceleration.y as number, 1e-9)
  })

  it('refuses a massless body that is not fixed', () => {
    assert.match(refused('mechanics.run', { bodies: [{ id: 'a', mass: 0 }], step: 0.1, until: 1 }), /immovable/)
  })

  it('refuses a force naming a body that is not there', () => {
    assert.match(
      refused('mechanics.run', {
        bodies: [{ id: 'a', mass: 1 }],
        forces: [{ kind: 'constant', bodyId: 'b', force: { x: 1, y: 0 } }],
        step: 0.1,
        until: 1
      }),
      /not in this system/
    )
  })

  it('refuses more bodies than the door carries', () => {
    const many = Array.from({ length: PHYSICS_LIMITS.bodies + 1 }, (_, i) => ({ id: `b${i}`, mass: 1 }))
    assert.match(refused('mechanics.run', { bodies: many, step: 0.1, until: 1 }), /more than the 200/)
  })

  it('describes the integrators and forces it offers', () => {
    const out = run('mechanics.facts')
    assert.equal((out.integrators as unknown[]).length, 4)
    assert.ok((out.forces as unknown[]).length >= 6)
    assert.ok((out.assumptions as string[]).length > 0)
  })
})

describe('motion', () => {
  it('solves a projectile exactly', () => {
    const out = run('motion.projectile', { speed: 20, angle: 45, gravity: G })
    closeTo(out.range as number, 400 / G, 1e-9)
    closeTo(out.bestAngle as number, 45, 1e-9)
  })

  it('refuses drag on the exact solver, and names the alternative', () => {
    const message = refused('motion.projectile', { speed: 20, angle: 45, drag: 'quadratic' })
    assert.match(message, /motion.projectile-drag/)
    assert.match(message, /stopped being true/)
  })

  it('integrates a dragged projectile and shortens the range', () => {
    const ideal = run('motion.projectile-drag', { speed: 40, angle: 45, gravity: G, drag: 'none', mass: 1 })
    const dragged = run('motion.projectile-drag', { speed: 40, angle: 45, gravity: G, drag: 'quadratic', coefficient: 0.01, mass: 1 })
    assert.ok((dragged.range as number) < (ideal.range as number) * 0.9)
  })

  it('says whether a difference is drag or integration error', () => {
    const clean = run('motion.compare-projectile', { speed: 20, angle: 45, gravity: G, drag: 'none', mass: 1 })
    assert.equal(clean.because, 'integration-error')
    const dirty = run('motion.compare-projectile', { speed: 40, angle: 45, gravity: G, drag: 'quadratic', coefficient: 0.02, mass: 1 })
    assert.equal(dirty.because, 'drag')
    assert.match(String(dirty.why), /not an error in either/)
  })

  it('joins phases of motion and separates distance from displacement', () => {
    const out = run('motion.phases', { phases: [{ duration: 3, acceleration: -9.81 }], velocity: 10 })
    assert.ok((out.distance as number) > Math.abs(out.displacement as number))
  })

  it('crosses a river fastest pointing straight across', () => {
    const across = run('motion.river', { boatSpeed: 4, riverSpeed: 3, width: 100, heading: 0 })
    closeTo(across.crossingTime as number, 25, 1e-9)
    closeTo(across.drift as number, 75, 1e-9)
  })

  it('refuses a wind course that cannot be held', () => {
    const out = run('motion.wind', { airspeed: 10, wind: { x: 0, y: 40 }, course: 0 })
    assert.equal(out.ok, false)
    assert.match(String(out.message), /cannot outrun/)
  })

  it('keeps the two components of circular acceleration apart', () => {
    const out = run('motion.circular', { radius: 4, mass: 1, speed: 8, tangentialAcceleration: 3 })
    closeTo(out.centripetalAcceleration as number, 16, 1e-9)
    closeTo(out.tangentialAcceleration as number, 3, 1e-9)
  })

  it('loses contact in a vertical circle with speed to spare', () => {
    const out = run('motion.vertical-circle', { radius: 2, mass: 1, speedAtBottom: 8, gravity: G })
    assert.ok(out.losesContactAt !== null)
    assert.equal(out.completesLoop, false)
  })
})

describe('oscillators', () => {
  it('gets the period from stiffness and mass', () => {
    const out = run('oscillator.harmonic', { mass: 4, stiffness: 16 })
    closeTo(out.period as number, Math.PI, 1e-9)
  })

  it('traces the motion without changing the answer', () => {
    const out = run('oscillator.harmonic-trace', { mass: 1, stiffness: 1, initialDisplacement: 2, duration: 10, samples: 200 })
    const trace = out.trace as { time: number; position: number }[]
    assert.equal(trace.length, 200)
    closeTo(trace[0]?.position as number, 2, 1e-9)
    closeTo(trace[trace.length - 1]?.position as number, 2 * Math.cos(10), 1e-9)
  })

  it('classifies the damping regimes', () => {
    assert.equal(run('oscillator.damping', { mass: 1, stiffness: 4, damping: 0 }).regime, 'undamped')
    assert.equal(run('oscillator.damping', { mass: 1, stiffness: 4, damping: 1 }).regime, 'underdamped')
    assert.equal(run('oscillator.damping', { mass: 1, stiffness: 4, damping: 4 }).regime, 'critically-damped')
    assert.equal(run('oscillator.damping', { mass: 1, stiffness: 4, damping: 8 }).regime, 'overdamped')
  })

  it('puts resonance below the natural frequency', () => {
    const out = run('oscillator.driven', { mass: 1, stiffness: 100, damping: 1, forceAmplitude: 10, drivingFrequency: 10 })
    assert.ok((out.resonantFrequency as number) < (out.naturalFrequency as number))
  })

  it('has no peak above a damping ratio of one over root two', () => {
    const out = run('oscillator.driven', { mass: 1, stiffness: 100, damping: 16, forceAmplitude: 10, drivingFrequency: 5 })
    assert.equal(out.resonantFrequency, null)
  })

  it('sweeps a resonance curve that peaks where it says', () => {
    const out = run('oscillator.resonance', { mass: 1, stiffness: 100, damping: 1, forceAmplitude: 10, from: 1, to: 20, samples: 400 })
    const points = out.points as { frequency: number; amplitude: number }[]
    const peak = points.reduce((best, one) => (one.amplitude > best.amplitude ? one : best))
    closeTo(peak.frequency, out.resonantFrequency as number, 0.15)
  })

  it('finds two normal modes for a coupled pair', () => {
    const out = run('oscillator.coupled', { mass1: 1, mass2: 1, stiffness1: 4, stiffness2: 4, coupling: 1 })
    const modes = out.modes as { angularFrequency: number; inPhase: boolean }[]
    closeTo(modes[0]?.angularFrequency as number, 2, 1e-9)
    closeTo(modes[1]?.angularFrequency as number, Math.sqrt(6), 1e-9)
    assert.equal(modes[0]?.inPhase, true)
  })

  it('makes the pendulum period grow with amplitude', () => {
    const small = run('oscillator.pendulum-period', { length: 1, gravity: G, amplitudeDegrees: 5 })
    const large = run('oscillator.pendulum-period', { length: 1, gravity: G, amplitudeDegrees: 90 })
    assert.ok((large.exact as number) > (small.exact as number))
    closeTo(small.smallAngle as number, large.smallAngle as number, 1e-12)
    closeTo(large.relativeDifference as number, 0.1803, 0.001)
  })

  it('does not mistake a pendulum result for a failure', () => {
    // The result carries a `relativeDifference` rather than an `error`, which the guard would have seized on.
    const out = run('oscillator.pendulum-period', { length: 1, gravity: G, amplitudeDegrees: 45 })
    assert.equal(out.ok, true)
  })

  it('swings a pendulum and measures its own period', () => {
    const out = run('oscillator.pendulum-swing', { length: 1, gravity: G, initialAngleDegrees: 30, duration: 20 })
    closeTo(out.measuredPeriod as number, out.exactPeriod as number, (out.exactPeriod as number) * 0.005)
  })

  it('runs a double pendulum reproducibly', () => {
    const setup = { angle1Degrees: 120, angle2Degrees: 60, duration: 5, step: 0.001, samples: 100 }
    const a = run('oscillator.double-pendulum', setup)
    const b = run('oscillator.double-pendulum', setup)
    assert.deepEqual((a.trace as unknown[])[99], (b.trace as unknown[])[99])
  })

  it('separates two nearly identical double pendulums', () => {
    const out = run('oscillator.double-compare', {
      angle1Degrees: 120,
      angle2Degrees: 60,
      perturbation: 1e-4,
      duration: 40,
      step: 0.001,
      samples: 500
    })
    assert.ok((out.finalSeparation as number) > (out.initialSeparation as number) * 100)
    assert.ok((out.notes as string[]).some((one) => /not that the equations are uncertain/.test(one)))
  })
})

describe('collisions', () => {
  it('exchanges velocities for equal masses colliding elastically', () => {
    const out = run('collision.head-on', { mass1: 1, velocity1: 5, mass2: 1, velocity2: -3, restitution: 1 })
    const after = out.after as { velocity1: number; velocity2: number }
    closeTo(after.velocity1, -3, 1e-9)
    closeTo(after.velocity2, 5, 1e-9)
  })

  it('conserves momentum at every restitution and energy only at one', () => {
    for (const restitution of [0, 0.5, 1]) {
      const out = run('collision.head-on', { mass1: 3, velocity1: 7, mass2: 5, velocity2: -2, restitution })
      const audit = out.audit as { momentumChange: number; elastic: boolean }
      closeTo(audit.momentumChange, 0, 1e-9, `restitution ${restitution}`)
      assert.equal(audit.elastic, restitution === 1)
    }
  })

  it('refuses a restitution that would create energy', () => {
    const out = run('collision.head-on', { mass1: 1, velocity1: 1, mass2: 1, velocity2: 0, restitution: 1.5 })
    assert.equal(out.ok, false)
    assert.match(String(out.message), /a spring, an explosion or a motor/)
  })

  it('leaves the tangential component of a glancing blow alone', () => {
    const out = run('collision.glancing', {
      a: { mass: 1, position: { x: -2, y: -0.5 }, velocity: { x: 4, y: 0 }, radius: 1 },
      b: { mass: 1, position: { x: 0, y: 0.5 }, velocity: { x: 0, y: 0 }, radius: 1 },
      restitution: 1
    })
    closeTo((out.audit as { momentumChange: number }).momentumChange, 0, 1e-9)
  })

  it('finds a contact time exactly', () => {
    const out = run('collision.contact', {
      a: { mass: 1, position: { x: 0, y: 0 }, velocity: { x: 1, y: 0 }, radius: 1 },
      b: { mass: 1, position: { x: 10, y: 0 }, velocity: { x: -1, y: 0 }, radius: 1 }
    })
    closeTo(out.time as number, 4, 1e-9)
  })

  it('reports the energy a perfectly inelastic collision can lose', () => {
    const view = run('collision.centre-of-mass', { mass1: 2, mass2: 5, velocity1: { x: 6, y: 0 }, velocity2: { x: -2, y: 0 } })
    const sticky = run('collision.head-on', { mass1: 2, velocity1: 6, mass2: 5, velocity2: -2, restitution: 0 })
    closeTo((sticky.audit as { kineticEnergyLost: number }).kineticEnergyLost, view.availableEnergy as number, 1e-9)
  })

  it('reads a restitution back from a collision that happened', () => {
    const out = run('collision.restitution', { velocity1Before: 4, velocity2Before: 0, velocity1After: 1, velocity2After: 3 })
    closeTo(out.restitution as number, 0.5, 1e-9)
  })
})

describe('gravity', () => {
  it('classifies an orbit from its energy', () => {
    const base = { centralMass: 1, constant: 1, position: { x: 1, y: 0 } }
    assert.equal(run('gravity.orbit', { ...base, velocity: { x: 0, y: 1 } }).shape, 'circular')
    assert.equal(run('gravity.orbit', { ...base, velocity: { x: 0, y: 0.8 } }).shape, 'elliptical')
    assert.equal(run('gravity.orbit', { ...base, velocity: { x: 0, y: Math.SQRT2 } }).shape, 'parabolic')
    assert.equal(run('gravity.orbit', { ...base, velocity: { x: 0, y: 2 } }).shape, 'hyperbolic')
  })

  it('reports inclination as absent rather than zero', () => {
    const out = run('gravity.orbit', { centralMass: 1, constant: 1, position: { x: 1, y: 0 }, velocity: { x: 0, y: 1 } })
    assert.equal(out.inclination, null)
  })

  it('obeys Kepler third law', () => {
    const inner = run('gravity.orbit', { centralMass: 1, constant: 1, position: { x: 1, y: 0 }, velocity: { x: 0, y: 1 } })
    const outer = run('gravity.orbit', { centralMass: 1, constant: 1, position: { x: 4, y: 0 }, velocity: { x: 0, y: 0.5 } })
    closeTo((outer.period as number) / (inner.period as number), 8, 1e-9)
  })

  it('draws a closed path for an ellipse and an open one for a hyperbola', () => {
    const closed = run('gravity.orbit-path', { centralMass: 1, constant: 1, position: { x: 1, y: 0 }, velocity: { x: 0, y: 0.7 }, points: 180 })
    closeTo(closed.sweptDegrees as number, 360, 1e-9)
    const open = run('gravity.orbit-path', { centralMass: 1, constant: 1, position: { x: 1, y: 0 }, velocity: { x: 0, y: 2 }, points: 180 })
    assert.ok((open.sweptDegrees as number) < 360)
  })

  it('gives circular and escape speeds a factor of root two apart', () => {
    const out = run('gravity.speeds', { centralMass: 1, radius: 3, constant: 1 })
    closeTo((out.escape as number) / (out.circular as number), Math.SQRT2, 1e-12)
  })

  it('samples a field that is an acceleration', () => {
    const out = run('gravity.field', {
      sources: [{ mass: 100, position: { x: 0, y: 0 } }],
      area: { xFrom: 1, xTo: 3, yFrom: 0, yTo: 1, columns: 3, rows: 2 },
      constant: 1
    })
    const samples = out.samples as { at: { x: number; y: number }; strength: number }[]
    const at1 = samples.find((one) => one.at.x === 1 && one.at.y === 0)
    closeTo(at1?.strength as number, 100, 1e-9)
  })

  it('refuses a field grid bigger than the door carries', () => {
    assert.match(
      refused('gravity.field', {
        sources: [{ mass: 1, position: { x: 0, y: 0 } }],
        area: { xFrom: 0, xTo: 1, yFrom: 0, yTo: 1, columns: 200, rows: 200 }
      }),
      /more than the 10000/
    )
  })

  it('runs a two-body pair that conserves energy and angular momentum', () => {
    const pair = run('gravity.pair', { mass1: 1, mass2: 1, separation: 1, constant: 1 })
    const out = run('gravity.n-body', { bodies: pair.bodies, constant: 1, step: 0.0005, until: 20, samples: 200 })
    assert.equal(out.ok, true)
    assert.ok(((out.run as { energy: { relativeDrift: number } }).energy.relativeDrift) < 1e-6)
    assert.ok((out.angularMomentum as { drift: number }).drift < 1e-9)
  })
})

describe('rotation', () => {
  it('gets the standard moments of inertia', () => {
    closeTo(run('rotation.inertia', { shape: 'solid-disc', mass: 4, size: 3 }).value as number, 18, 1e-12)
    closeTo(run('rotation.inertia', { shape: 'ring', mass: 4, size: 3 }).value as number, 36, 1e-12)
    closeTo(run('rotation.inertia', { shape: 'solid-sphere', mass: 5, size: 2 }).value as number, 8, 1e-12)
  })

  it('carries the axis with the number', () => {
    const out = run('rotation.inertia', { shape: 'rod-centre', mass: 1, size: 1 })
    assert.ok(String(out.axis).length > 5)
  })

  it('turns a rod about its centre into one about its end', () => {
    const centre = run('rotation.inertia', { shape: 'rod-centre', mass: 3, size: 2 })
    const shifted = run('rotation.shift-axis', { aboutCentreOfMass: centre.value, mass: 3, distance: 1 })
    const end = run('rotation.inertia', { shape: 'rod-end', mass: 3, size: 2 })
    closeTo(shifted.aboutNewAxis as number, end.value as number, 1e-12)
  })

  it('gives a force through the pivot no torque', () => {
    const out = run('rotation.torque', { pivot: { x: 0, y: 0 }, applicationPoint: { x: 3, y: 0 }, force: { x: -1000, y: 0 } })
    closeTo(out.torque as number, 0, 1e-9)
    assert.match(String(out.why), /does not close it, however hard/)
  })

  it('runs a rolling race that always finishes in the same order', () => {
    const gentle = run('rotation.race', { shapes: ['ring', 'solid-sphere', 'solid-disc'], slopeDegrees: 3, gravity: G, distance: 100 })
    const steep = run('rotation.race', { shapes: ['ring', 'solid-sphere', 'solid-disc'], slopeDegrees: 70, gravity: G, distance: 0.5 })
    const order = (one: Record<string, unknown>): string[] => (one.order as { shape: string }[]).map((x) => x.shape)
    assert.deepEqual(order(gentle), ['solid-sphere', 'solid-disc', 'ring'])
    assert.deepEqual(order(gentle), order(steep))
  })

  it('works out the friction rolling needs', () => {
    const out = run('rotation.rolling', { shape: 'ring', slopeDegrees: 45, gravity: G, frictionCoefficient: 0.1 })
    closeTo(out.frictionNeeded as number, 0.5, 1e-9)
    assert.equal(out.rolls, false)
  })

  it('refuses to roll something that does not roll', () => {
    const out = run('rotation.rolling', { shape: 'rod-centre', slopeDegrees: 30, gravity: G })
    assert.equal(out.ok, false)
    assert.match(String(out.message), /circular cross-section/)
  })

  it('lists the shapes it knows', () => {
    const out = run('rotation.shapes')
    assert.ok((out.shapes as unknown[]).length >= 9)
  })
})

describe('waves', () => {
  it('derives the third quantity from two', () => {
    closeTo(run('wave.travelling', { amplitude: 1, speed: 340, frequency: 170 }).wavelength as number, 2, 1e-12)
  })

  it('refuses all three, at the door rather than in the answer', () => {
    // The reader builds the wave, so an over-specified one is refused before there is a result to wrap.
    const message = refused('wave.travelling', { amplitude: 1, speed: 340, frequency: 170, wavelength: 2 })
    assert.match(message, /no way to tell which was meant/)
  })

  it('has no even harmonics in a pipe closed at one end', () => {
    const out = run('wave.standing', { length: 2, speed: 100, harmonic: 2, boundary: 'one-fixed-one-free' })
    assert.equal(out.ok, false)
    assert.match(String(out.message), /absent rather than weak/)
    assert.equal(run('wave.standing', { length: 2, speed: 100, harmonic: 3, boundary: 'one-fixed-one-free' }).ok, true)
  })

  it('puts nodes at both fixed ends', () => {
    const out = run('wave.standing', { length: 2, speed: 100, harmonic: 3, boundary: 'both-fixed' })
    const nodes = out.nodes as number[]
    closeTo(nodes[0] as number, 0, 1e-12)
    closeTo(nodes[nodes.length - 1] as number, 2, 1e-12)
  })

  it('adds waves at every point', () => {
    const out = run('wave.superpose', {
      waves: [
        { amplitude: 1, speed: 1, wavelength: 4 },
        { amplitude: 1, speed: 1, wavelength: 4, phase: Math.PI }
      ],
      span: { from: 0, to: 8, points: 50 }
    })
    for (const point of out.points as { total: number }[]) closeTo(point.total, 0, 1e-9)
  })

  it('gives a different interference answer for a different wavelength', () => {
    const sources = { source1: { x: -1, y: 0, amplitude: 1 }, source2: { x: 1, y: 0, amplitude: 1 }, point: { x: 2, y: 0 } }
    assert.equal(run('wave.interference', { ...sources, wavelength: 4 }).kind, 'destructive')
    assert.equal(run('wave.interference', { ...sources, wavelength: 2 }).kind, 'constructive')
  })

  it('beats at the difference of the frequencies', () => {
    const out = run('wave.beats', { frequency1: 440, frequency2: 444, duration: 1, samples: 2000 })
    closeTo(out.beatFrequency as number, 4, 1e-12)
    closeTo(out.carrierFrequency as number, 442, 1e-12)
  })

  it('refuses two identical frequencies', () => {
    const out = run('wave.beats', { frequency1: 440, frequency2: 440, duration: 1 })
    assert.equal(out.ok, false)
    assert.match(String(out.message), /Beats need a difference/)
  })

  it('moves a packet at the group velocity', () => {
    const out = run('wave.packet', {
      carrierWavelength: 1,
      envelopeWidth: 5,
      phaseVelocity: 3,
      groupVelocity: 1,
      span: { from: -20, to: 20, points: 500 }
    })
    assert.equal(out.dispersive, true)
  })

  it('refuses more waves than the door carries', () => {
    const many = Array.from({ length: PHYSICS_LIMITS.waves + 1 }, () => ({ amplitude: 1, speed: 1, wavelength: 1 }))
    assert.match(refused('wave.superpose', { waves: many, span: { from: 0, to: 1 } }), /more than the 16/)
  })
})
