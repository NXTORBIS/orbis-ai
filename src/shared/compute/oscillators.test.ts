import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyDamping,
  compareDoublePendulums,
  coupledOscillators,
  dampedAt,
  doublePendulum,
  drivenOscillator,
  harmonicAt,
  isOscillatorError,
  pendulumPeriod,
  REGIME_FACTS,
  resonanceCurve,
  simpleHarmonic,
  swingPendulum,
  type OscillatorError
} from './oscillators.ts'

const ok = <T>(value: T): Exclude<T, OscillatorError> => {
  assert.ok(!isOscillatorError(value), isOscillatorError(value) ? value.message : '')
  return value as Exclude<T, OscillatorError>
}

const closeTo = (actual: number, expected: number, tolerance: number, what = ''): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} expected ${expected} within ${tolerance}, got ${actual}`)
}

const G = 9.81

describe('simple harmonic motion', () => {
  it('gets the period from the stiffness and the mass alone', () => {
    const result = ok(simpleHarmonic({ mass: 4, stiffness: 16, initialDisplacement: 1, initialVelocity: 0 }))
    closeTo(result.angularFrequency, 2, 1e-12)
    closeTo(result.period, Math.PI, 1e-12)
  })

  it('does not change the period when the amplitude changes', () => {
    const small = ok(simpleHarmonic({ mass: 1, stiffness: 4, initialDisplacement: 0.1, initialVelocity: 0 }))
    const large = ok(simpleHarmonic({ mass: 1, stiffness: 4, initialDisplacement: 10, initialVelocity: 0 }))
    closeTo(small.period, large.period, 1e-12)
    assert.ok(small.notes.some((one) => /what a restoring force proportional to displacement buys/.test(one)))
  })

  it('combines a displacement and a velocity into one amplitude', () => {
    const result = ok(simpleHarmonic({ mass: 1, stiffness: 1, initialDisplacement: 3, initialVelocity: 4 }))
    closeTo(result.amplitude, 5, 1e-12)
  })

  it('evaluates exactly, and starts where it was put', () => {
    const one = ok(simpleHarmonic({ mass: 1, stiffness: 1, initialDisplacement: 2, initialVelocity: 0 }))
    closeTo(harmonicAt(one, 0).position, 2, 1e-12)
    closeTo(harmonicAt(one, 0).velocity, 0, 1e-12)
    // x = 2cos(t)
    closeTo(harmonicAt(one, 1).position, 2 * Math.cos(1), 1e-12)
    closeTo(harmonicAt(one, one.period).position, 2, 1e-12)
  })

  it('conserves energy exactly', () => {
    const one = ok(simpleHarmonic({ mass: 2, stiffness: 8, initialDisplacement: 1.5, initialVelocity: -3 }))
    for (const t of [0, 0.3, 1.1, 2.7, 5]) {
      const at = harmonicAt(one, t)
      closeTo(0.5 * 2 * at.velocity ** 2 + 0.5 * 8 * at.position ** 2, one.totalEnergy, 1e-9, `t=${t}`)
    }
  })

  it('refuses a spring with no stiffness, and says why there is no oscillation', () => {
    const result = simpleHarmonic({ mass: 1, stiffness: 0, initialDisplacement: 1, initialVelocity: 0 })
    assert.ok(isOscillatorError(result))
    assert.match(result.message, /no restoring force there is no oscillation/)
  })
})

describe('damping', () => {
  it('classifies the four regimes from the damping ratio', () => {
    const base = { mass: 1, stiffness: 4 }
    // Critical damping is 2√(mk) = 4.
    assert.equal(ok(classifyDamping({ ...base, damping: 0 })).regime, 'undamped')
    assert.equal(ok(classifyDamping({ ...base, damping: 1 })).regime, 'underdamped')
    assert.equal(ok(classifyDamping({ ...base, damping: 4 })).regime, 'critically-damped')
    assert.equal(ok(classifyDamping({ ...base, damping: 8 })).regime, 'overdamped')
  })

  it('makes the damped frequency lower than the natural one', () => {
    const result = ok(classifyDamping({ mass: 1, stiffness: 4, damping: 1 }))
    closeTo(result.naturalFrequency, 2, 1e-12)
    assert.ok((result.dampedFrequency as number) < result.naturalFrequency)
    assert.ok(result.notes.some((one) => /Damping slows the oscillation as well as shrinking it/.test(one)))
  })

  it('has no damped frequency at all past critical', () => {
    assert.equal(ok(classifyDamping({ mass: 1, stiffness: 4, damping: 8 })).dampedFrequency, null)
  })

  it('has facts for every regime', () => {
    for (const regime of ['undamped', 'underdamped', 'critically-damped', 'overdamped'] as const) {
      assert.ok(REGIME_FACTS[regime].describe.length > 40, regime)
    }
  })

  it('refuses negative damping', () => {
    const result = classifyDamping({ mass: 1, stiffness: 1, damping: -1 })
    assert.ok(isOscillatorError(result))
    assert.match(result.message, /add energy every cycle/)
  })

  it('reduces to simple harmonic motion with no damping', () => {
    const input = { mass: 1, stiffness: 4, damping: 0, initialDisplacement: 2, initialVelocity: 0 }
    const shm = ok(simpleHarmonic({ mass: 1, stiffness: 4, initialDisplacement: 2, initialVelocity: 0 }))
    for (const t of [0, 0.5, 1.7, 3]) {
      const damped = ok(dampedAt(input, t))
      closeTo(damped.position, harmonicAt(shm, t).position, 1e-9, `t=${t}`)
    }
  })

  it('decays without crossing zero when overdamped', () => {
    const input = { mass: 1, stiffness: 4, damping: 10, initialDisplacement: 1, initialVelocity: 0 }
    let previous = 1
    for (let t = 0; t <= 5; t += 0.05) {
      const at = ok(dampedAt(input, t))
      assert.ok(at.position >= -1e-12, `went negative at t=${t}`)
      assert.ok(at.position <= previous + 1e-12, `grew at t=${t}`)
      previous = at.position
    }
  })

  it('crosses zero when underdamped', () => {
    const input = { mass: 1, stiffness: 4, damping: 0.4, initialDisplacement: 1, initialVelocity: 0 }
    let crossed = false
    for (let t = 0; t <= 5; t += 0.01) {
      if (ok(dampedAt(input, t)).position < -1e-6) crossed = true
    }
    assert.ok(crossed, 'an underdamped oscillator overshoots')
  })

  it('returns to rest faster when critically damped than when overdamped', () => {
    const settle = (damping: number): number => {
      for (let t = 0; t <= 20; t += 0.01) {
        const at = ok(dampedAt({ mass: 1, stiffness: 4, damping, initialDisplacement: 1, initialVelocity: 0 }, t))
        if (Math.abs(at.position) < 0.01) return t
      }
      return Number.POSITIVE_INFINITY
    }
    assert.ok(settle(4) < settle(12), 'critical beats overdamped')
  })

  it('starts where it was put, in every regime', () => {
    for (const damping of [0, 1, 4, 9]) {
      const at = ok(dampedAt({ mass: 1, stiffness: 4, damping, initialDisplacement: 1.5, initialVelocity: -0.5 }, 0))
      closeTo(at.position, 1.5, 1e-9, `damping ${damping}`)
      closeTo(at.velocity, -0.5, 1e-9, `damping ${damping}`)
    }
  })
})

describe('driving and resonance', () => {
  const base = { mass: 1, stiffness: 100, damping: 1, forceAmplitude: 10 }

  it('puts the resonant peak below the natural frequency', () => {
    const result = ok(drivenOscillator({ ...base, drivingFrequency: 10 }))
    closeTo(result.naturalFrequency, 10, 1e-12)
    assert.ok((result.resonantFrequency as number) < result.naturalFrequency)
    assert.ok(result.notes.some((one) => /Resonance sits at ω₀ only in the limit of no damping/.test(one)))
  })

  it('actually peaks where it says it does', () => {
    const peak = ok(drivenOscillator({ ...base, drivingFrequency: 10 })).resonantFrequency as number
    const atPeak = ok(drivenOscillator({ ...base, drivingFrequency: peak })).steadyAmplitude
    for (const offset of [-1.5, -0.4, 0.4, 1.5]) {
      const other = ok(drivenOscillator({ ...base, drivingFrequency: peak + offset })).steadyAmplitude
      assert.ok(atPeak >= other - 1e-12, `at ${peak + offset} the amplitude was ${other}, above the peak's ${atPeak}`)
    }
  })

  it('has no peak at all above a damping ratio of one over root two', () => {
    // Critical damping is 2√(mk) = 20, so ζ = 0.8 needs damping 16.
    const result = ok(drivenOscillator({ ...base, damping: 16, drivingFrequency: 5 }))
    assert.equal(result.resonantFrequency, null)
    assert.ok(result.notes.some((one) => /no resonant peak at all/.test(one)))
  })

  it('approaches the static deflection as the driving frequency goes to zero', () => {
    const result = ok(drivenOscillator({ ...base, drivingFrequency: 1e-6 }))
    closeTo(result.amplification, 1, 1e-6)
    closeTo(result.steadyAmplitude, 10 / 100, 1e-6)
  })

  it('falls away to nothing at high frequency, a half turn behind', () => {
    const result = ok(drivenOscillator({ ...base, drivingFrequency: 1000 }))
    assert.ok(result.steadyAmplitude < 1e-4)
    closeTo(result.phaseLag, Math.PI, 0.01)
    assert.ok(result.notes.some((one) => /moves opposite to the push/.test(one)))
  })

  it('lags a quarter turn exactly at the natural frequency', () => {
    const result = ok(drivenOscillator({ ...base, drivingFrequency: 10 }))
    closeTo(result.phaseLag, Math.PI / 2, 1e-9)
  })

  it('refuses the undamped case driven exactly at resonance, rather than returning infinity', () => {
    const result = drivenOscillator({ ...base, damping: 0, drivingFrequency: 10 })
    assert.ok(isOscillatorError(result))
    assert.match(result.message, /grows without bound/)
  })

  it('says it is only reporting the steady state', () => {
    const result = ok(drivenOscillator({ ...base, drivingFrequency: 7 }))
    assert.ok(result.notes.some((one) => /steady state only/.test(one)))
  })
})

describe('the resonance curve', () => {
  it('peaks near the resonant frequency it reports', () => {
    const result = ok(resonanceCurve({ mass: 1, stiffness: 100, damping: 1, forceAmplitude: 10 }, { from: 1, to: 20, points: 500 }))
    let best = result.points[0]
    for (const one of result.points) if (one.amplitude > (best?.amplitude ?? 0)) best = one
    closeTo(best?.frequency as number, result.resonantFrequency as number, 0.1)
  })

  it('gets narrower as the damping falls', () => {
    const sharp = ok(resonanceCurve({ mass: 1, stiffness: 100, damping: 0.5, forceAmplitude: 10 }, { from: 1, to: 20 }))
    const blunt = ok(resonanceCurve({ mass: 1, stiffness: 100, damping: 4, forceAmplitude: 10 }, { from: 1, to: 20 }))
    assert.ok((sharp.bandwidth as number) < (blunt.bandwidth as number))
    assert.ok(sharp.qualityFactor > blunt.qualityFactor)
  })

  it('says plainly when there is no peak to find', () => {
    const result = ok(resonanceCurve({ mass: 1, stiffness: 100, damping: 18, forceAmplitude: 10 }, { from: 1, to: 20 }))
    assert.equal(result.resonantFrequency, null)
    assert.ok(result.notes.some((one) => /no peak in this curve/.test(one)))
  })

  it('refuses a backwards sweep', () => {
    assert.ok(isOscillatorError(resonanceCurve({ mass: 1, stiffness: 1, damping: 1, forceAmplitude: 1 }, { from: 10, to: 1 })))
  })
})

describe('coupled oscillators', () => {
  const identical = { mass1: 1, mass2: 1, stiffness1: 4, stiffness2: 4, coupling: 1 }

  it('finds two modes, the lower one moving together', () => {
    const result = ok(coupledOscillators(identical))
    const [low, high] = result.modes
    assert.ok(low.angularFrequency < high.angularFrequency)
    assert.equal(low.inPhase, true)
    assert.equal(high.inPhase, false)
  })

  it('gets the textbook frequencies for the symmetric case', () => {
    const result = ok(coupledOscillators(identical))
    // ω² = k/m for the in-phase mode and (k + 2k_c)/m for the other.
    closeTo(result.modes[0].angularFrequency, Math.sqrt(4), 1e-9)
    closeTo(result.modes[1].angularFrequency, Math.sqrt(6), 1e-9)
  })

  it('makes the two masses equal and opposite in the symmetric modes', () => {
    const result = ok(coupledOscillators(identical))
    closeTo(Math.abs(result.modes[0].shape[0]), Math.abs(result.modes[0].shape[1]), 1e-9)
    closeTo(result.modes[1].shape[0], -result.modes[1].shape[1], 1e-9)
  })

  it('reports a beat period for the symmetric case and none otherwise', () => {
    assert.ok((ok(coupledOscillators(identical)).beatPeriod as number) > 0)
    assert.equal(ok(coupledOscillators({ ...identical, mass2: 3 })).beatPeriod, null)
  })

  it('collapses to two independent oscillators with no coupling', () => {
    const result = ok(coupledOscillators({ ...identical, coupling: 0 }))
    closeTo(result.modes[0].angularFrequency, 2, 1e-9)
    closeTo(result.modes[1].angularFrequency, 2, 1e-9)
    assert.ok(result.notes.some((one) => /Energy never crosses between them/.test(one)))
  })

  it('separates the modes further as the coupling grows', () => {
    const weak = ok(coupledOscillators({ ...identical, coupling: 0.2 }))
    const strong = ok(coupledOscillators({ ...identical, coupling: 5 }))
    const gap = (one: typeof weak): number => one.modes[1].angularFrequency - one.modes[0].angularFrequency
    assert.ok(gap(strong) > gap(weak))
  })

  it('refuses a massless oscillator', () => {
    assert.ok(isOscillatorError(coupledOscillators({ ...identical, mass1: 0 })))
  })
})

describe('the pendulum period', () => {
  it('is not mistaken for a failure by the error guard', () => {
    // A result field called `error` would make every valid answer look like a failure. Named so it cannot.
    const result = pendulumPeriod({ length: 1, gravity: G, amplitudeDegrees: 45 })
    assert.equal(isOscillatorError(result), false)
    assert.ok(!Object.prototype.hasOwnProperty.call(result, 'error'))
  })

  it('matches the small-angle formula at tiny amplitudes', () => {
    const result = ok(pendulumPeriod({ length: 1, gravity: G, amplitudeDegrees: 0.01 }))
    // They converge but never meet: at 0.01° the exact period is still about two parts in a billion longer, which is
    // the physics rather than a rounding artefact, so the tolerance has to be looser than the effect.
    closeTo(result.exact, result.smallAngle, 1e-7)
    assert.ok(result.exact > result.smallAngle, 'and the exact one is the longer, at every amplitude above zero')
    closeTo(result.smallAngle, 2 * Math.PI * Math.sqrt(1 / G), 1e-12)
  })

  it('grows with amplitude, which the approximation does not', () => {
    const small = ok(pendulumPeriod({ length: 1, gravity: G, amplitudeDegrees: 10 }))
    const large = ok(pendulumPeriod({ length: 1, gravity: G, amplitudeDegrees: 90 }))
    assert.ok(large.exact > small.exact)
    closeTo(small.smallAngle, large.smallAngle, 1e-12, 'the approximation is the same at both')
  })

  it('gets the known figures right', () => {
    // At 90° the exact period is about 18.03% longer than the small-angle one.
    closeTo(ok(pendulumPeriod({ length: 1, gravity: G, amplitudeDegrees: 90 })).relativeDifference, 0.1803, 0.001)
    // At 20° it is about 0.767% longer.
    closeTo(ok(pendulumPeriod({ length: 1, gravity: G, amplitudeDegrees: 20 })).relativeDifference, 0.00767, 0.0002)
  })

  it('says the independence is what the approximation discarded', () => {
    const result = ok(pendulumPeriod({ length: 1, gravity: G, amplitudeDegrees: 45 }))
    assert.ok(result.notes.some((one) => /exactly what the approximation threw away/.test(one)))
    assert.ok(result.notes.some((one) => /The mass does not appear anywhere/.test(one)))
  })

  it('refuses a pendulum balanced straight up', () => {
    const result = pendulumPeriod({ length: 1, gravity: G, amplitudeDegrees: 180 })
    assert.ok(isOscillatorError(result))
    assert.match(result.message, /infinitely long to leave/)
  })

  it('scales as the square root of the length', () => {
    const one = ok(pendulumPeriod({ length: 1, gravity: G, amplitudeDegrees: 5 }))
    const four = ok(pendulumPeriod({ length: 4, gravity: G, amplitudeDegrees: 5 }))
    closeTo(four.exact / one.exact, 2, 1e-9)
  })
})

describe('swinging a pendulum', () => {
  it('measures a period that matches the exact one', () => {
    const result = ok(swingPendulum({ length: 1, gravity: G, initialAngleDegrees: 30, duration: 20 }))
    assert.ok(result.measuredPeriod !== null)
    closeTo(result.measuredPeriod, result.exactPeriod, result.exactPeriod * 0.002)
  })

  it('swings slower than the small-angle formula at a large amplitude', () => {
    const result = ok(swingPendulum({ length: 1, gravity: G, initialAngleDegrees: 120, duration: 20 }))
    assert.ok((result.measuredPeriod as number) > result.smallAnglePeriod * 1.2)
  })

  it('keeps the energy bounded', () => {
    const result = ok(swingPendulum({ length: 1, gravity: G, initialAngleDegrees: 60, duration: 100, step: 0.001 }))
    assert.ok(result.energyDrift < 1e-4, `drift was ${result.energyDrift}`)
    assert.ok(result.notes.some((one) => /what a symplectic method buys/.test(one)))
  })

  it('says it had to integrate and why', () => {
    const result = ok(swingPendulum({ length: 1, gravity: G, initialAngleDegrees: 30, duration: 5 }))
    assert.ok(result.notes.some((one) => /no elementary solution/.test(one)))
  })

  it('refuses a run with no duration', () => {
    assert.ok(isOscillatorError(swingPendulum({ length: 1, gravity: G, initialAngleDegrees: 30, duration: 0 })))
  })
})

describe('the double pendulum', () => {
  const setup = { mass1: 1, mass2: 1, length1: 1, length2: 1, gravity: G, angle1Degrees: 120, angle2Degrees: 60 }

  it('conserves energy to within the integrator drift', () => {
    const result = ok(doublePendulum(setup, { duration: 20, step: 0.0005 }))
    assert.ok(result.energyDrift < 1e-5, `drift was ${result.energyDrift}`)
  })

  it('gives the same trajectory every time', () => {
    const a = ok(doublePendulum(setup, { duration: 10, step: 0.001 }))
    const b = ok(doublePendulum(setup, { duration: 10, step: 0.001 }))
    assert.deepEqual(a.trace[a.trace.length - 1], b.trace[b.trace.length - 1])
    assert.ok(a.notes.some((one) => /to the last digit/.test(one)))
  })

  it('never calls the motion random', () => {
    const result = ok(doublePendulum(setup, { duration: 5, step: 0.001 }))
    assert.ok(result.notes.some((one) => /Sensitive and random are different words/.test(one)))
    const text = result.notes.join(' ').toLowerCase()
    assert.ok(!/\bis random\b/.test(text))
  })

  it('keeps the bobs within reach of their arms', () => {
    const result = ok(doublePendulum(setup, { duration: 10, step: 0.001 }))
    for (const state of result.trace) {
      closeTo(Math.hypot(state.bob1.x, state.bob1.y), 1, 1e-9)
      closeTo(Math.hypot(state.bob2.x - state.bob1.x, state.bob2.y - state.bob1.y), 1, 1e-9)
    }
  })

  it('hangs still when it starts still and straight down', () => {
    const result = ok(doublePendulum({ ...setup, angle1Degrees: 0, angle2Degrees: 0 }, { duration: 5, step: 0.001 }))
    const last = result.trace[result.trace.length - 1]
    closeTo(last?.angle1 as number, 0, 1e-9)
    closeTo(last?.angle2 as number, 0, 1e-9)
  })

  it('behaves like two small pendulums at tiny angles', () => {
    // At small angles the lower mode of a double pendulum with equal arms has a known frequency.
    const result = ok(doublePendulum({ ...setup, angle1Degrees: 0.5, angle2Degrees: 0.5 }, { duration: 30, step: 0.0005, samples: 20000 }))
    // Starting both at the same small angle is close to the in-phase mode, ω² = g/L·(2 − √2).
    const expected = (2 * Math.PI) / Math.sqrt((G / 1) * (2 - Math.SQRT2))
    let crossings = 0
    let previous = result.trace[0]?.angle1 ?? 0
    let firstCross = 0
    let lastCross = 0
    for (const state of result.trace) {
      if (previous > 0 && state.angle1 <= 0) {
        crossings += 1
        if (crossings === 1) firstCross = state.time
        lastCross = state.time
      }
      previous = state.angle1
    }
    assert.ok(crossings >= 3, `only ${crossings} crossings`)
    // One downward crossing per period, so the span over the gaps is the period -- not twice it.
    const measured = (lastCross - firstCross) / (crossings - 1)
    closeTo(measured, expected, expected * 0.05)
  })

  it('refuses a massless or zero-length arm', () => {
    assert.ok(isOscillatorError(doublePendulum({ ...setup, mass1: 0 }, { duration: 1 })))
    assert.ok(isOscillatorError(doublePendulum({ ...setup, length2: 0 }, { duration: 1 })))
  })
})

describe('comparing two double pendulums', () => {
  const setup = { mass1: 1, mass2: 1, length1: 1, length2: 1, gravity: G, angle1Degrees: 120, angle2Degrees: 60 }

  it('separates two nearly identical starts', () => {
    const result = ok(compareDoublePendulums(setup, 1e-4, { duration: 40, step: 0.001, samples: 4000 }))
    assert.ok(result.finalSeparation > result.initialSeparation * 100, `${result.initialSeparation} → ${result.finalSeparation}`)
    assert.ok(result.separatedAt !== null)
  })

  it('never claims the equations are uncertain', () => {
    const result = ok(compareDoublePendulums(setup, 1e-3, { duration: 20, step: 0.001 }))
    assert.ok(result.notes.some((one) => /not that the equations are uncertain/.test(one)))
    assert.ok(result.notes.some((one) => /Both runs are deterministic and reproducible/.test(one)))
  })

  it('says a plot of bob positions understates the divergence', () => {
    const result = ok(compareDoublePendulums(setup, 1e-3, { duration: 20, step: 0.001 }))
    assert.ok(result.notes.some((one) => /understates how different the two motions have become/.test(one)))
  })

  it('refuses a perturbation of nothing', () => {
    const result = compareDoublePendulums(setup, 0, { duration: 5 })
    assert.ok(isOscillatorError(result))
    assert.match(result.message, /the two runs are identical/)
  })
})
