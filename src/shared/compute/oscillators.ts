/**
 * Things that swing: springs, pendulums, damping, driving, resonance and coupling.
 *
 * The shared oscillator engine for Orbis Pages. Most of it is exact, because most of these systems have closed-form
 * solutions and integrating what can be solved is a way of introducing error for nothing. The two that do not —
 * the exact pendulum beyond small angles, and the double pendulum — say which method they used and why.
 *
 * ## Three things this file is careful about, because they are the three usually got wrong
 *
 * **Resonance is not at the natural frequency.** A damped driven oscillator peaks at `ω₀√(1 − 2ζ²)`, below its own
 * natural frequency, and above `ζ = 1/√2` it has no peak at all — the amplitude just falls away from zero. Driving
 * at `ω₀` and calling it resonance is right only in the limit of no damping.
 *
 * **A pendulum's period depends on its amplitude.** The familiar `2π√(L/g)` is the small-angle answer and it is
 * independent of amplitude precisely because the approximation threw that dependence away. At 90° the real period is
 * 18% longer. This file computes the exact period and reports the error, rather than offering the approximation and
 * a footnote.
 *
 * **A double pendulum is not random.** It is deterministic: the same initial conditions give the same trajectory
 * every time. What it is, is sensitive — two starts a millionth of a radian apart end up nowhere near each other.
 * Those are different statements and this file never uses the word for one to mean the other.
 *
 * Pure. No network, no clock, no storage.
 */

export interface OscillatorError {
  error: 'invalid-argument' | 'not-finite' | 'no-solution' | 'too-many-steps'
  message: string
}

export const isOscillatorError = (value: unknown): value is OscillatorError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: OscillatorError['error'], message: string): OscillatorError => ({ error, message })

// ---------------------------------------------------------------- simple harmonic motion

export interface SimpleHarmonic {
  /** √(k/m). */
  angularFrequency: number
  period: number
  frequency: number
  amplitude: number
  /** Where in the cycle it starts, in radians. */
  phase: number
  maximumSpeed: number
  maximumAcceleration: number
  totalEnergy: number
  notes: readonly string[]
}

/**
 * A mass on a spring, solved exactly.
 *
 * The period does not depend on the amplitude — pull it twice as far and it takes exactly as long to come back.
 * That is a property of the restoring force being proportional to displacement and it is the reason this is the
 * shape every other oscillation gets approximated to.
 */
export function simpleHarmonic(input: {
  mass: number
  stiffness: number
  initialDisplacement: number
  initialVelocity: number
}): SimpleHarmonic | OscillatorError {
  const { mass, stiffness, initialDisplacement, initialVelocity } = input
  if (![mass, stiffness, initialDisplacement, initialVelocity].every((one) => Number.isFinite(one))) {
    return fail('not-finite', 'Every value must be a finite number.')
  }
  if (mass <= 0) return fail('invalid-argument', 'The mass must be positive.')
  if (stiffness <= 0) {
    return fail('invalid-argument', 'The stiffness must be positive. With no restoring force there is no oscillation — the mass just carries on at whatever speed it had.')
  }
  const omega = Math.sqrt(stiffness / mass)
  const amplitude = Math.hypot(initialDisplacement, initialVelocity / omega)
  const phase = Math.atan2(-initialVelocity / omega, initialDisplacement)
  return {
    angularFrequency: omega,
    period: (2 * Math.PI) / omega,
    frequency: omega / (2 * Math.PI),
    amplitude,
    phase,
    maximumSpeed: amplitude * omega,
    maximumAcceleration: amplitude * omega * omega,
    totalEnergy: 0.5 * stiffness * amplitude * amplitude,
    notes: [
      'The period does not depend on the amplitude. Pull it twice as far and it takes exactly as long to come back — that is what a restoring force proportional to displacement buys, and it is why this shape is the one everything else gets approximated to.',
      'The mass never changes the total energy, only how fast it moves: a heavier mass on the same spring released from the same place oscillates more slowly with the same energy.',
      'Exact, not integrated. This is the solution to the equation rather than a numerical approach to it.'
    ]
  }
}

/** Where a simple harmonic oscillator is at a given time. Exact. */
export function harmonicAt(one: SimpleHarmonic, time: number): { position: number; velocity: number; acceleration: number } {
  const angle = one.angularFrequency * time + one.phase
  const position = one.amplitude * Math.cos(angle)
  return {
    position,
    velocity: -one.amplitude * one.angularFrequency * Math.sin(angle),
    acceleration: -one.angularFrequency * one.angularFrequency * position
  }
}

// ---------------------------------------------------------------- damping

export type DampingRegime = 'undamped' | 'underdamped' | 'critically-damped' | 'overdamped'

export interface Damped {
  regime: DampingRegime
  /** The frequency it would have with no damping. */
  naturalFrequency: number
  /** Damping as a fraction of what it takes to stop oscillation altogether. */
  dampingRatio: number
  /** The frequency it actually oscillates at. Null when it does not oscillate. */
  dampedFrequency: number | null
  /** How long the amplitude takes to fall to 1/e of its starting value. Infinite with no damping. */
  decayTime: number
  /** The sharpness of the resonance this system would have if driven. Infinite with no damping. */
  qualityFactor: number
  /** The damping that would make it exactly critical. */
  criticalDamping: number
  describe: string
  notes: readonly string[]
}

export const REGIME_FACTS: Readonly<Record<DampingRegime, { label: string; describe: string }>> = Object.freeze({
  undamped: {
    label: 'Undamped',
    describe: 'No damping at all. It oscillates for ever at its natural frequency, which no real system does — but it is the case everything else is measured against.'
  },
  underdamped: {
    label: 'Underdamped',
    describe: 'It oscillates, and the amplitude decays. The usual case: a plucked string, a car on worn shocks, a swinging door that overshoots.'
  },
  'critically-damped': {
    label: 'Critically damped',
    describe: 'The fastest return to rest without overshooting. What a door closer and a good suspension aim for. Exactly on the boundary, so real systems are near it rather than at it.'
  },
  overdamped: {
    label: 'Overdamped',
    describe: 'It creeps back without oscillating, and slower than critical damping would. More damping is not better damping past this point.'
  }
})

/**
 * Which of the four a damped oscillator is, and the numbers that follow.
 *
 * The classification is from the damping ratio rather than from the shape of the curve, because the difference
 * between critically damped and slightly overdamped is invisible in a plot and completely decided by one number.
 */
export function classifyDamping(input: { mass: number; stiffness: number; damping: number }): Damped | OscillatorError {
  const { mass, stiffness, damping } = input
  if (![mass, stiffness, damping].every((one) => Number.isFinite(one))) return fail('not-finite', 'Every value must be finite.')
  if (mass <= 0) return fail('invalid-argument', 'The mass must be positive.')
  if (stiffness <= 0) return fail('invalid-argument', 'The stiffness must be positive.')
  if (damping < 0) return fail('invalid-argument', 'Damping is zero or more. Negative damping would add energy every cycle.')

  const omega0 = Math.sqrt(stiffness / mass)
  const critical = 2 * Math.sqrt(mass * stiffness)
  const zeta = damping / critical

  let regime: DampingRegime
  if (zeta === 0) regime = 'undamped'
  else if (zeta < 1) regime = 'underdamped'
  else if (zeta === 1) regime = 'critically-damped'
  else regime = 'overdamped'

  const dampedFrequency = zeta < 1 ? omega0 * Math.sqrt(1 - zeta * zeta) : null
  const notes: string[] = [REGIME_FACTS[regime].describe]
  if (regime === 'underdamped') {
    notes.push(
      `It oscillates at ${(dampedFrequency ?? 0).toPrecision(6)} rad/s, below its natural ${omega0.toPrecision(6)}. Damping slows the oscillation as well as shrinking it, and at a damping ratio of ${zeta.toPrecision(3)} the difference is ${(((omega0 - (dampedFrequency ?? 0)) / omega0) * 100).toPrecision(3)}%.`
    )
  }
  if (regime === 'overdamped') {
    notes.push('Past critical damping, adding more damping makes the return slower rather than steadier. There is nothing to be gained by overdamping something that only has to stop.')
  }
  if (regime === 'critically-damped') {
    notes.push('Exactly critical is a single point, so a real system is near it rather than on it. Which side it lands on changes whether it overshoots at all.')
  }

  return {
    regime,
    naturalFrequency: omega0,
    dampingRatio: zeta,
    dampedFrequency,
    decayTime: damping === 0 ? Number.POSITIVE_INFINITY : (2 * mass) / damping,
    qualityFactor: zeta === 0 ? Number.POSITIVE_INFINITY : 1 / (2 * zeta),
    criticalDamping: critical,
    describe: `${REGIME_FACTS[regime].label}: damping ratio ${zeta.toPrecision(4)}, natural frequency ${omega0.toPrecision(6)} rad/s.`,
    notes
  }
}

/**
 * Where a damped oscillator is at a given time. Exact in all three regimes.
 *
 * Each regime has its own closed form and they are genuinely different functions, not one function with a parameter.
 * Using the underdamped expression past critical damping gives a complex frequency and nonsense.
 */
export function dampedAt(
  input: { mass: number; stiffness: number; damping: number; initialDisplacement: number; initialVelocity: number },
  time: number
): { position: number; velocity: number } | OscillatorError {
  const classified = classifyDamping(input)
  if (isOscillatorError(classified)) return classified
  if (!Number.isFinite(time)) return fail('not-finite', 'The time must be finite.')

  const { mass, damping, initialDisplacement: x0, initialVelocity: v0 } = input
  const omega0 = classified.naturalFrequency
  const gamma = damping / (2 * mass)

  if (classified.regime === 'undamped' || classified.regime === 'underdamped') {
    const wd = classified.dampedFrequency ?? omega0
    const decay = Math.exp(-gamma * time)
    const a = x0
    const b = (v0 + gamma * x0) / wd
    const position = decay * (a * Math.cos(wd * time) + b * Math.sin(wd * time))
    const velocity =
      decay * (-gamma * (a * Math.cos(wd * time) + b * Math.sin(wd * time)) + wd * (-a * Math.sin(wd * time) + b * Math.cos(wd * time)))
    return { position, velocity }
  }

  if (classified.regime === 'critically-damped') {
    const decay = Math.exp(-gamma * time)
    const a = x0
    const b = v0 + gamma * x0
    return { position: decay * (a + b * time), velocity: decay * (b - gamma * (a + b * time)) }
  }

  // Overdamped: two real roots, two decaying exponentials and no oscillation anywhere in it.
  const root = Math.sqrt(gamma * gamma - omega0 * omega0)
  const r1 = -gamma + root
  const r2 = -gamma - root
  const c1 = (v0 - r2 * x0) / (r1 - r2)
  const c2 = x0 - c1
  return {
    position: c1 * Math.exp(r1 * time) + c2 * Math.exp(r2 * time),
    velocity: c1 * r1 * Math.exp(r1 * time) + c2 * r2 * Math.exp(r2 * time)
  }
}

// ---------------------------------------------------------------- driving and resonance

export interface Driven {
  /** How far it swings once the transient has died away. */
  steadyAmplitude: number
  /** How far behind the driving force it runs, in radians. */
  phaseLag: number
  naturalFrequency: number
  dampingRatio: number
  /**
   * The driving frequency that gives the largest amplitude.
   *
   * `ω₀√(1 − 2ζ²)`, which is *below* the natural frequency, and null above ζ = 1/√2 where there is no peak at all.
   * Driving at ω₀ and calling it resonance is the undamped limit rather than the general case.
   */
  resonantFrequency: number | null
  /** The amplitude at that frequency. Null where there is no peak. */
  peakAmplitude: number | null
  /** How far it would move if the same force were simply held there. The yardstick for amplification. */
  staticDeflection: number
  /** Amplitude divided by static deflection. Above one is amplification. */
  amplification: number
  notes: readonly string[]
}

/**
 * A driven oscillator, once the transient has died away.
 *
 * Only the steady state: the transient is a damped oscillation at the *natural* frequency that fades, while this
 * persists at the *driving* frequency. They are different motions and adding them is the full solution; this is the
 * half that is still there a minute later.
 */
export function drivenOscillator(input: {
  mass: number
  stiffness: number
  damping: number
  /** Amplitude of the driving force. */
  forceAmplitude: number
  /** Angular frequency it is driven at. */
  drivingFrequency: number
}): Driven | OscillatorError {
  const classified = classifyDamping(input)
  if (isOscillatorError(classified)) return classified
  const { mass, stiffness, damping, forceAmplitude, drivingFrequency } = input
  if (![forceAmplitude, drivingFrequency].every((one) => Number.isFinite(one))) return fail('not-finite', 'Every value must be finite.')
  if (drivingFrequency < 0) return fail('invalid-argument', 'The driving frequency is zero or more.')

  const omega0 = classified.naturalFrequency
  const zeta = classified.dampingRatio
  const w = drivingFrequency

  const denominator = Math.hypot(stiffness - mass * w * w, damping * w)
  if (denominator === 0) {
    return fail(
      'no-solution',
      'With no damping and driving exactly at the natural frequency, the steady amplitude is infinite: nothing removes the energy being put in, so it grows without bound. Add any damping at all, or drive at a different frequency.'
    )
  }
  const amplitude = forceAmplitude / denominator
  const phaseLag = Math.atan2(damping * w, stiffness - mass * w * w)
  const staticDeflection = forceAmplitude / stiffness

  const hasPeak = zeta < 1 / Math.SQRT2
  const resonant = hasPeak ? omega0 * Math.sqrt(1 - 2 * zeta * zeta) : null
  const peakAmplitude =
    resonant === null
      ? null
      : zeta === 0
        ? Number.POSITIVE_INFINITY
        : forceAmplitude / (damping * omega0 * Math.sqrt(1 - zeta * zeta))

  const notes: string[] = [
    'This is the steady state only. For the first while there is also a transient: a damped oscillation at the natural frequency, which fades. The full motion is the two added together.'
  ]
  if (hasPeak && zeta > 0) {
    notes.push(
      `The largest response is at ${(resonant ?? 0).toPrecision(6)} rad/s, which is below the natural frequency of ${omega0.toPrecision(6)}. Resonance sits at ω₀ only in the limit of no damping; here it is ${(((omega0 - (resonant ?? 0)) / omega0) * 100).toPrecision(3)}% below.`
    )
  }
  if (!hasPeak) {
    notes.push(
      `At a damping ratio of ${zeta.toPrecision(4)} — above 1/√2 — there is no resonant peak at all. The amplitude simply falls as the driving frequency rises, so there is no frequency to avoid and nothing to tune to.`
    )
  }
  if (phaseLag > Math.PI / 2) {
    notes.push('Driven above the natural frequency, the mass is more than a quarter cycle behind the force — at high frequencies it moves opposite to the push.')
  }

  return {
    steadyAmplitude: amplitude,
    phaseLag,
    naturalFrequency: omega0,
    dampingRatio: zeta,
    resonantFrequency: resonant,
    peakAmplitude,
    staticDeflection,
    amplification: staticDeflection === 0 ? 0 : amplitude / staticDeflection,
    notes
  }
}

export interface ResonanceCurve {
  points: readonly { frequency: number; amplitude: number; phaseLag: number; amplification: number }[]
  naturalFrequency: number
  resonantFrequency: number | null
  /** How wide the peak is at 1/√2 of its height. Null where there is no peak. */
  bandwidth: number | null
  qualityFactor: number
  notes: readonly string[]
}

/** The response across a range of driving frequencies. */
export function resonanceCurve(
  input: { mass: number; stiffness: number; damping: number; forceAmplitude: number },
  sweep: { from: number; to: number; points?: number }
): ResonanceCurve | OscillatorError {
  const classified = classifyDamping(input)
  if (isOscillatorError(classified)) return classified
  if (!Number.isFinite(sweep.from) || !Number.isFinite(sweep.to) || sweep.from < 0 || sweep.to <= sweep.from) {
    return fail('invalid-argument', 'The sweep needs a range from a non-negative frequency up to a higher one.')
  }
  const count = Math.min(5000, Math.max(3, Math.round(sweep.points ?? 300)))
  const points: { frequency: number; amplitude: number; phaseLag: number; amplification: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const frequency = sweep.from + ((sweep.to - sweep.from) * i) / (count - 1)
    const one = drivenOscillator({ ...input, drivingFrequency: frequency })
    if (isOscillatorError(one)) continue
    points.push({ frequency, amplitude: one.steadyAmplitude, phaseLag: one.phaseLag, amplification: one.amplification })
  }
  if (points.length === 0) return fail('no-solution', 'No point in this sweep had a finite response.')

  const zeta = classified.dampingRatio
  const hasPeak = zeta < 1 / Math.SQRT2
  const resonant = hasPeak ? classified.naturalFrequency * Math.sqrt(1 - 2 * zeta * zeta) : null
  // The half-power width, which is what a quality factor actually measures.
  const bandwidth = zeta === 0 ? null : hasPeak ? classified.naturalFrequency / classified.qualityFactor : null

  return {
    points,
    naturalFrequency: classified.naturalFrequency,
    resonantFrequency: resonant,
    bandwidth,
    qualityFactor: classified.qualityFactor,
    notes: [
      hasPeak
        ? `The peak is at ${(resonant ?? 0).toPrecision(6)} rad/s and the natural frequency is ${classified.naturalFrequency.toPrecision(6)}. They are not the same number and the gap grows with damping.`
        : 'There is no peak in this curve: the damping is above 1/√2 of critical, so the response falls away from its zero-frequency value and never rises.',
      `A quality factor of ${classified.qualityFactor === Number.POSITIVE_INFINITY ? 'infinity' : classified.qualityFactor.toPrecision(4)} says how sharp the peak is — how many cycles the energy survives, and how narrow a band of frequencies gets amplified.`
    ]
  }
}

// ---------------------------------------------------------------- two masses, coupled

export interface NormalMode {
  /** The frequency this mode oscillates at. */
  angularFrequency: number
  period: number
  /** How the two masses move relative to each other in this mode. Normalised so the larger is 1. */
  shape: readonly [number, number]
  /** True when the two move together, false when they move against each other. */
  inPhase: boolean
  describe: string
}

export interface Coupled {
  modes: readonly [NormalMode, NormalMode]
  /** How long energy takes to pass fully from one mass to the other and back, when they are identical. */
  beatPeriod: number | null
  notes: readonly string[]
}

/**
 * Two masses joined by springs, solved as normal modes.
 *
 * A coupled system looks complicated and is not: it is two independent oscillations added together, each at its own
 * frequency and each with a fixed shape. Every motion the system can make is some combination of those two, which is
 * what a normal mode is for.
 *
 * With identical masses and springs, starting one moving and the other at rest gives the familiar result: the energy
 * passes entirely to the second mass and back, at the difference of the two mode frequencies.
 */
export function coupledOscillators(input: {
  mass1: number
  mass2: number
  /** Spring from the wall to mass 1. */
  stiffness1: number
  /** Spring from mass 2 to the other wall. */
  stiffness2: number
  /** Spring between the two masses. */
  coupling: number
}): Coupled | OscillatorError {
  const { mass1, mass2, stiffness1, stiffness2, coupling } = input
  if (![mass1, mass2, stiffness1, stiffness2, coupling].every((one) => Number.isFinite(one))) {
    return fail('not-finite', 'Every value must be finite.')
  }
  if (mass1 <= 0 || mass2 <= 0) return fail('invalid-argument', 'Both masses must be positive.')
  if (stiffness1 < 0 || stiffness2 < 0 || coupling < 0) return fail('invalid-argument', 'Stiffnesses are zero or more.')

  // M ẍ = −K x, so the modes are the eigenvalues of M⁻¹K. Two by two, so it is a quadratic.
  const a = (stiffness1 + coupling) / mass1
  const b = -coupling / mass1
  const c = -coupling / mass2
  const d = (stiffness2 + coupling) / mass2

  const trace = a + d
  const determinant = a * d - b * c
  const discriminant = trace * trace - 4 * determinant
  if (discriminant < 0) {
    return fail('no-solution', 'This system has no real normal modes, which should not happen for positive masses and stiffnesses.')
  }
  const root = Math.sqrt(discriminant)
  const lowSquared = (trace - root) / 2
  const highSquared = (trace + root) / 2
  if (lowSquared < 0) {
    return fail('no-solution', 'One mode has a negative squared frequency, which means this arrangement does not oscillate — check the stiffnesses.')
  }

  const modeFor = (lambda: number, label: string): NormalMode => {
    // (a − λ)u + b·v = 0
    let u = 1
    let v = b === 0 ? 0 : (lambda - a) / b
    if (!Number.isFinite(v)) {
      u = 0
      v = 1
    }
    const largest = Math.max(Math.abs(u), Math.abs(v))
    if (largest > 0) {
      u /= largest
      v /= largest
    }
    const omega = Math.sqrt(Math.max(0, lambda))
    const together = u * v >= 0
    return {
      angularFrequency: omega,
      period: omega === 0 ? Number.POSITIVE_INFINITY : (2 * Math.PI) / omega,
      shape: [u, v],
      inPhase: together,
      describe: `${label}: the two masses move ${together ? 'together, in the same direction' : 'against each other, in opposite directions'}, in the ratio ${u.toPrecision(3)} to ${v.toPrecision(3)}.`
    }
  }

  const low = modeFor(lowSquared, 'Lower mode')
  const high = modeFor(highSquared, 'Upper mode')

  const identical = mass1 === mass2 && stiffness1 === stiffness2
  const gap = high.angularFrequency - low.angularFrequency
  const beatPeriod = identical && gap > 0 ? (2 * Math.PI) / gap : null

  const notes: string[] = [
    'Every motion this system can make is one of these two oscillations, or both added together. That is what a normal mode is: a shape that keeps its shape, oscillating at one frequency.',
    'In the lower mode the masses move together, so the coupling spring barely stretches and contributes almost nothing — which is why that mode is the slower of the two.'
  ]
  if (beatPeriod !== null) {
    notes.push(
      `With the two halves identical, starting one mass moving and the other at rest sends the energy fully across and back every ${beatPeriod.toPrecision(5)} s. That is the two mode frequencies beating against each other, not anything extra in the model.`
    )
  }
  if (coupling === 0) {
    notes.push('With no coupling the two are independent oscillators that happen to be drawn next to each other. Energy never crosses between them.')
  }

  return { modes: [low, high], beatPeriod, notes }
}

// ---------------------------------------------------------------- pendulums

/**
 * The complete elliptic integral of the first kind, by the arithmetic–geometric mean.
 *
 * Converges quadratically — five or six iterations reach machine precision — which is what makes the exact pendulum
 * period as cheap to compute as the approximation it corrects.
 */
function ellipticK(modulus: number): number {
  let a = 1
  let b = Math.sqrt(1 - modulus * modulus)
  for (let i = 0; i < 60 && Math.abs(a - b) > 1e-16; i += 1) {
    const nextA = (a + b) / 2
    b = Math.sqrt(a * b)
    a = nextA
  }
  return Math.PI / (a + b)
}

export interface PendulumPeriod {
  /** The real period, from the exact solution. */
  exact: number
  /** 2π√(L/g), which does not depend on the amplitude at all. */
  smallAngle: number
  /**
   * How much longer the real period is, as a fraction.
   *
   * Not called `error`: every engine here reports a failure as an object with an `error` field, so a *result* with
   * one is indistinguishable from a failure to `isOscillatorError` and every valid answer gets thrown away.
   */
  relativeDifference: number
  amplitudeDegrees: number
  notes: readonly string[]
}

/**
 * How long a pendulum takes, exactly and approximately.
 *
 * The exact period grows with amplitude and the small-angle one does not — that independence is not a property of
 * pendulums, it is what the approximation discarded. At 20° the difference is under 1%, at 90° it is 18%, and at
 * 179° the period is more than five times the small-angle answer.
 */
export function pendulumPeriod(input: { length: number; gravity: number; amplitudeDegrees: number }): PendulumPeriod | OscillatorError {
  const { length, gravity, amplitudeDegrees } = input
  if (![length, gravity, amplitudeDegrees].every((one) => Number.isFinite(one))) return fail('not-finite', 'Every value must be finite.')
  if (length <= 0) return fail('invalid-argument', 'The length must be positive.')
  if (gravity <= 0) return fail('invalid-argument', 'Gravity must be positive for a pendulum to swing.')
  const amplitude = Math.abs(amplitudeDegrees)
  if (amplitude >= 180) {
    return fail(
      'invalid-argument',
      'At 180° the pendulum is balanced straight up. It takes infinitely long to leave, so there is no period — and any real one would have fallen one way or the other.'
    )
  }

  const smallAngle = 2 * Math.PI * Math.sqrt(length / gravity)
  const k = Math.sin((amplitude * Math.PI) / 360)
  const exact = (2 / Math.PI) * smallAngle * ellipticK(k)
  const relativeDifference = smallAngle === 0 ? 0 : (exact - smallAngle) / smallAngle

  const notes: string[] = [
    'The small-angle period does not depend on the amplitude. That independence is not a property of pendulums — it is exactly what the approximation threw away, and the exact period grows steadily with amplitude.',
    `At ${amplitude.toPrecision(4)}° the real period is ${(relativeDifference * 100).toPrecision(3)}% longer than 2π√(L/g).`
  ]
  if (amplitude <= 10) notes.push('Below about 10° the approximation is within a quarter of a percent, which is why clocks were built on it.')
  if (amplitude >= 90) notes.push('Past 90° the approximation is badly wrong and the swing is nothing like a sine wave — it dwells at the extremes and rushes through the middle.')
  notes.push('The mass does not appear anywhere. A heavier bob on the same string swings at exactly the same rate.')

  return { exact, smallAngle, relativeDifference, amplitudeDegrees: amplitude, notes }
}

export interface PendulumRun {
  trace: readonly { time: number; angle: number; angularVelocity: number; energy: number }[]
  /** The period measured from the swing itself, by finding successive crossings. Null when it never crossed twice. */
  measuredPeriod: number | null
  exactPeriod: number
  smallAnglePeriod: number
  energyDrift: number
  notes: readonly string[]
}

/**
 * A pendulum swung forward in time, exactly as the nonlinear equation says.
 *
 * Integrated rather than solved, because `θ'' = −(g/L)sin θ` has no elementary solution — the elliptic integral
 * gives the period and not the motion. Velocity Verlet keeps the energy bounded, and the measured period is
 * compared against the exact one as a check that the integration actually worked.
 */
export function swingPendulum(input: {
  length: number
  gravity: number
  initialAngleDegrees: number
  initialAngularVelocity?: number
  duration: number
  step?: number
  samples?: number
}): PendulumRun | OscillatorError {
  const { length, gravity, initialAngleDegrees, duration } = input
  if (![length, gravity, initialAngleDegrees, duration].every((one) => Number.isFinite(one))) return fail('not-finite', 'Every value must be finite.')
  if (length <= 0) return fail('invalid-argument', 'The length must be positive.')
  if (gravity <= 0) return fail('invalid-argument', 'Gravity must be positive.')
  if (duration <= 0) return fail('invalid-argument', 'The run must have a positive duration.')

  const step = input.step ?? 0.0005
  const steps = Math.ceil(duration / step)
  if (steps > 2_000_000) return fail('too-many-steps', `${steps} steps is more than this engine runs. Use a larger step or a shorter run.`)

  let theta = (initialAngleDegrees * Math.PI) / 180
  let omega = input.initialAngularVelocity ?? 0
  const accelerationAt = (angle: number): number => -(gravity / length) * Math.sin(angle)
  let acceleration = accelerationAt(theta)

  // Per unit mass: ½L²ω² for the kinetic part and gL(1 − cos θ) for the potential.
  const energyOf = (angle: number, rate: number): number => 0.5 * length * length * rate * rate + gravity * length * (1 - Math.cos(angle))
  const startEnergy = energyOf(theta, omega)
  let worstDrift = 0

  const keep = Math.min(input.samples ?? 2000, 20000)
  const every = Math.max(1, Math.floor(steps / keep))
  const trace: { time: number; angle: number; angularVelocity: number; energy: number }[] = []
  const crossings: number[] = []
  let previousAngle = theta

  trace.push({ time: 0, angle: theta, angularVelocity: omega, energy: startEnergy })

  for (let n = 0; n < steps; n += 1) {
    theta += omega * step + 0.5 * acceleration * step * step
    omega += 0.5 * acceleration * step
    const next = accelerationAt(theta)
    omega += 0.5 * next * step
    acceleration = next
    const time = (n + 1) * step

    // A period is two crossings of the lowest point in the same direction, which is a measurement rather than a
    // formula and so can disagree with the formula if the integration is wrong.
    if (previousAngle < 0 && theta >= 0) crossings.push(time)
    previousAngle = theta

    const energy = energyOf(theta, omega)
    const drift = Math.abs(energy - startEnergy)
    if (drift > worstDrift) worstDrift = drift
    if ((n + 1) % every === 0 || n === steps - 1) trace.push({ time, angle: theta, angularVelocity: omega, energy })
  }

  const measuredPeriod = crossings.length >= 2 ? (crossings[crossings.length - 1] as number) - (crossings[crossings.length - 2] as number) : null
  const amplitude = Math.abs(initialAngleDegrees)
  const periods = pendulumPeriod({ length, gravity, amplitudeDegrees: amplitude })
  const exactPeriod = isOscillatorError(periods) ? Number.NaN : periods.exact
  const smallAnglePeriod = isOscillatorError(periods) ? Number.NaN : periods.smallAngle

  const notes: string[] = [
    'Integrated rather than solved: θ″ = −(g/L)·sin θ has no elementary solution. The elliptic integral gives the period and not the motion.',
    `Velocity Verlet at ${step} s per step, with the energy drifting by ${((worstDrift / (startEnergy || 1)) * 100).toPrecision(3)}% — bounded rather than growing, which is what a symplectic method buys.`
  ]
  if (measuredPeriod !== null && Number.isFinite(exactPeriod)) {
    const gap = Math.abs(measuredPeriod - exactPeriod) / exactPeriod
    notes.push(
      `The period measured from the swing is ${measuredPeriod.toPrecision(6)} s against the exact ${exactPeriod.toPrecision(6)} s, a difference of ${(gap * 100).toPrecision(3)}%. That is a check on the integration rather than a result: the two come from completely different calculations.`
    )
  }

  return { trace, measuredPeriod, exactPeriod, smallAnglePeriod, energyDrift: worstDrift / (startEnergy || 1), notes }
}

// ---------------------------------------------------------------- two pendulums, one on the other

export interface DoublePendulumState {
  time: number
  angle1: number
  angle2: number
  rate1: number
  rate2: number
  /** Where the two bobs actually are, for drawing. */
  bob1: { x: number; y: number }
  bob2: { x: number; y: number }
  energy: number
}

export interface DoublePendulum {
  trace: readonly DoublePendulumState[]
  energyDrift: number
  notes: readonly string[]
}

export interface DoublePendulumSetup {
  mass1: number
  mass2: number
  length1: number
  length2: number
  gravity: number
  angle1Degrees: number
  angle2Degrees: number
  rate1?: number
  rate2?: number
}

interface DoubleState {
  t1: number
  t2: number
  w1: number
  w2: number
}

function doubleDerivative(s: DoubleState, one: DoublePendulumSetup): { w1: number; w2: number; a1: number; a2: number } {
  const { mass1: m1, mass2: m2, length1: L1, length2: L2, gravity: g } = one
  const delta = s.t1 - s.t2
  const denominator = 2 * m1 + m2 - m2 * Math.cos(2 * delta)

  const a1 =
    (-g * (2 * m1 + m2) * Math.sin(s.t1) -
      m2 * g * Math.sin(s.t1 - 2 * s.t2) -
      2 * Math.sin(delta) * m2 * (s.w2 * s.w2 * L2 + s.w1 * s.w1 * L1 * Math.cos(delta))) /
    (L1 * denominator)

  const a2 =
    (2 *
      Math.sin(delta) *
      (s.w1 * s.w1 * L1 * (m1 + m2) + g * (m1 + m2) * Math.cos(s.t1) + s.w2 * s.w2 * L2 * m2 * Math.cos(delta))) /
    (L2 * denominator)

  return { w1: s.w1, w2: s.w2, a1, a2 }
}

function doubleEnergy(s: DoubleState, one: DoublePendulumSetup): number {
  const { mass1: m1, mass2: m2, length1: L1, length2: L2, gravity: g } = one
  const kinetic =
    0.5 * m1 * L1 * L1 * s.w1 * s.w1 +
    0.5 * m2 * (L1 * L1 * s.w1 * s.w1 + L2 * L2 * s.w2 * s.w2 + 2 * L1 * L2 * s.w1 * s.w2 * Math.cos(s.t1 - s.t2))
  const potential = -(m1 + m2) * g * L1 * Math.cos(s.t1) - m2 * g * L2 * Math.cos(s.t2)
  return kinetic + potential
}

/**
 * A pendulum hanging from a pendulum.
 *
 * Integrated with RK4 rather than Verlet, because the accelerations depend on both angular velocities and the
 * equations do not separate into the kick–drift–kick form Verlet needs. RK4 drifts slowly, so the drift is reported
 * and a run long enough for it to matter says so.
 *
 * The motion is **deterministic**. The same starting angles give the same trajectory every time, to the last digit.
 * What it also is, is sensitive: two starts a millionth of a radian apart separate completely within about twenty
 * seconds. Those are different statements, and this engine never uses the word for one to mean the other.
 */
export function doublePendulum(
  setup: DoublePendulumSetup,
  options: { duration: number; step?: number; samples?: number }
): DoublePendulum | OscillatorError {
  const values = [setup.mass1, setup.mass2, setup.length1, setup.length2, setup.gravity, setup.angle1Degrees, setup.angle2Degrees]
  if (!values.every((one) => Number.isFinite(one))) return fail('not-finite', 'Every value must be finite.')
  if (setup.mass1 <= 0 || setup.mass2 <= 0) return fail('invalid-argument', 'Both masses must be positive.')
  if (setup.length1 <= 0 || setup.length2 <= 0) return fail('invalid-argument', 'Both lengths must be positive.')
  if (setup.gravity <= 0) return fail('invalid-argument', 'Gravity must be positive.')
  if (options.duration <= 0) return fail('invalid-argument', 'The run must have a positive duration.')

  const step = options.step ?? 0.001
  const steps = Math.ceil(options.duration / step)
  if (steps > 2_000_000) return fail('too-many-steps', `${steps} steps is more than this engine runs.`)

  let state: DoubleState = {
    t1: (setup.angle1Degrees * Math.PI) / 180,
    t2: (setup.angle2Degrees * Math.PI) / 180,
    w1: setup.rate1 ?? 0,
    w2: setup.rate2 ?? 0
  }
  const startEnergy = doubleEnergy(state, setup)
  let worstDrift = 0

  const keep = Math.min(options.samples ?? 3000, 20000)
  const every = Math.max(1, Math.floor(steps / keep))
  const trace: DoublePendulumState[] = []

  const record = (time: number, s: DoubleState): void => {
    const x1 = setup.length1 * Math.sin(s.t1)
    const y1 = -setup.length1 * Math.cos(s.t1)
    trace.push({
      time,
      angle1: s.t1,
      angle2: s.t2,
      rate1: s.w1,
      rate2: s.w2,
      bob1: { x: x1, y: y1 },
      bob2: { x: x1 + setup.length2 * Math.sin(s.t2), y: y1 - setup.length2 * Math.cos(s.t2) },
      energy: doubleEnergy(s, setup)
    })
  }
  record(0, state)

  for (let n = 0; n < steps; n += 1) {
    const k1 = doubleDerivative(state, setup)
    const s2: DoubleState = {
      t1: state.t1 + (k1.w1 * step) / 2,
      t2: state.t2 + (k1.w2 * step) / 2,
      w1: state.w1 + (k1.a1 * step) / 2,
      w2: state.w2 + (k1.a2 * step) / 2
    }
    const k2 = doubleDerivative(s2, setup)
    const s3: DoubleState = {
      t1: state.t1 + (k2.w1 * step) / 2,
      t2: state.t2 + (k2.w2 * step) / 2,
      w1: state.w1 + (k2.a1 * step) / 2,
      w2: state.w2 + (k2.a2 * step) / 2
    }
    const k3 = doubleDerivative(s3, setup)
    const s4: DoubleState = {
      t1: state.t1 + k3.w1 * step,
      t2: state.t2 + k3.w2 * step,
      w1: state.w1 + k3.a1 * step,
      w2: state.w2 + k3.a2 * step
    }
    const k4 = doubleDerivative(s4, setup)

    state = {
      t1: state.t1 + (step / 6) * (k1.w1 + 2 * k2.w1 + 2 * k3.w1 + k4.w1),
      t2: state.t2 + (step / 6) * (k1.w2 + 2 * k2.w2 + 2 * k3.w2 + k4.w2),
      w1: state.w1 + (step / 6) * (k1.a1 + 2 * k2.a1 + 2 * k3.a1 + k4.a1),
      w2: state.w2 + (step / 6) * (k1.a2 + 2 * k2.a2 + 2 * k3.a2 + k4.a2)
    }

    const drift = Math.abs(doubleEnergy(state, setup) - startEnergy)
    if (drift > worstDrift) worstDrift = drift
    if ((n + 1) % every === 0 || n === steps - 1) record((n + 1) * step, state)
  }

  const scale = Math.abs(startEnergy) > 0 ? Math.abs(startEnergy) : 1
  return {
    trace,
    energyDrift: worstDrift / scale,
    notes: [
      'This motion is deterministic. The same starting angles give the same trajectory every time, to the last digit. What it is not is predictable in practice: two starts a millionth of a radian apart end up in completely different places within about twenty seconds.',
      'Sensitive and random are different words. Nothing here draws a random number, and the trajectory is not a sample from anything.',
      `Integrated with RK4 at ${step} s per step. The accelerations depend on both angular rates, so the equations do not split into the form a symplectic method needs — the energy drifted by ${((worstDrift / scale) * 100).toPrecision(3)}% over this run.`,
      worstDrift / scale > 0.01
        ? 'That drift is large enough to matter. Past this point the trajectory is the integrator as much as the physics; use a smaller step.'
        : 'That drift is small enough that the trajectory is the physics rather than the method — over this length of run.'
    ]
  }
}

export interface Divergence {
  /** How far apart the two trajectories are, over time. */
  separation: readonly { time: number; distance: number }[]
  /** How far apart they started. */
  initialSeparation: number
  finalSeparation: number
  /** The time by which they had separated by a radian, if they did. */
  separatedAt: number | null
  notes: readonly string[]
}

/**
 * Two double pendulums started almost identically, and how far apart they end up.
 *
 * The demonstration this system is famous for, made measurable rather than merely watched. The separation is in the
 * angle variables, which is what diverges; the bobs are bounded by the arm lengths and so cannot separate without
 * limit however different the motions become.
 */
export function compareDoublePendulums(
  setup: DoublePendulumSetup,
  perturbation: number,
  options: { duration: number; step?: number; samples?: number }
): Divergence | OscillatorError {
  if (!Number.isFinite(perturbation) || perturbation === 0) {
    return fail('invalid-argument', 'The perturbation must be a non-zero, finite angle in degrees. With no difference at all the two runs are identical, which is the point being demonstrated rather than a demonstration.')
  }
  const a = doublePendulum(setup, options)
  if (isOscillatorError(a)) return a
  const b = doublePendulum({ ...setup, angle1Degrees: setup.angle1Degrees + perturbation }, options)
  if (isOscillatorError(b)) return b

  const separation: { time: number; distance: number }[] = []
  const count = Math.min(a.trace.length, b.trace.length)
  let separatedAt: number | null = null
  for (let i = 0; i < count; i += 1) {
    const one = a.trace[i]
    const other = b.trace[i]
    if (one === undefined || other === undefined) continue
    const distance = Math.hypot(one.angle1 - other.angle1, one.angle2 - other.angle2)
    separation.push({ time: one.time, distance })
    if (separatedAt === null && distance >= 1) separatedAt = one.time
  }

  const initial = separation[0]?.distance ?? 0
  const final = separation[separation.length - 1]?.distance ?? 0

  return {
    separation,
    initialSeparation: initial,
    finalSeparation: final,
    separatedAt,
    notes: [
      `Started ${Math.abs(perturbation)}° apart in the first angle and ${final > initial ? `ended ${(final / (initial || 1)).toPrecision(4)} times further apart` : 'stayed close'}.`,
      separatedAt === null
        ? 'The two stayed within a radian of each other for this whole run. A longer run, or a larger starting angle, separates them.'
        : `They were a radian apart by ${separatedAt.toPrecision(4)} s. After that the two motions have nothing to do with each other, from a difference too small to set up deliberately.`,
      'Both runs are deterministic and reproducible. Neither is more correct than the other — the point is that a difference too small to measure makes the later motion unknowable in practice, not that the equations are uncertain.',
      'The separation is measured in the angles. The bobs themselves cannot separate by more than the arm lengths, so a plot of bob positions understates how different the two motions have become.'
    ]
  }
}

export const OSCILLATOR_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Springs obey Hooke’s law at every extension, with no limit and no permanent deformation.',
  'Pendulum rods and strings are massless and do not stretch. A real rod with mass swings at a different rate.',
  'Damping is proportional to velocity. Real friction is often nearer constant, and dry friction stops a system dead rather than letting it decay for ever.',
  'A driven oscillator is reported in its steady state. The transient that dies away first is a real part of the motion and is not included in those numbers.',
  'The double pendulum is deterministic and sensitive, which are different things. Nothing here is random.'
])
