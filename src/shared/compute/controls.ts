/**
 * Control systems: transfer functions, time responses, stability, frequency response and PID tuning.
 *
 * The shared controls engine for Orbis Pages. Poles are found numerically rather than quoted, stability is
 * decided by where those poles actually are, and every tuning rule names itself and says what it was fitted for.
 *
 * ## Why stability is computed from the poles and not from a rule of thumb
 *
 * A system is stable when every pole of its closed loop has a negative real part. That is the definition, and it
 * is checkable. Routh-Hurwitz answers the same question without finding the poles, which is useful for a symbolic
 * parameter but tells you nothing about *how* stable. This engine roots the polynomial and reports both, because
 * "stable" and "stable with 3 degrees of phase margin" are very different situations and only one of them is safe.
 *
 * ## Why a tuning rule is never presented as the answer
 *
 * Ziegler-Nichols was fitted in 1942 to give a quarter-amplitude decay on process plant. It is aggressive, it
 * overshoots badly, and on many loops it is the wrong starting point entirely. It is offered with its name, its
 * origin and its known behaviour attached, and the resulting closed loop is simulated so the overshoot is visible
 * rather than described.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * open loop        vs  closed loop      -- the plant alone against the plant with feedback around it
 * poles            vs  zeros            -- where it blows up against where it goes quiet
 * gain margin      vs  phase margin     -- two different distances to the same instability
 * stable           vs  well damped      -- not oscillating forever against not oscillating much
 * continuous       vs  discrete         -- s-plane left half against z-plane unit circle
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface ControlError {
  error: 'invalid-argument' | 'not-finite' | 'too-many' | 'degenerate' | 'no-solution' | 'not-converged'
  message: string
}

export const isControlError = (value: unknown): value is ControlError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: ControlError['error'], message: string): ControlError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const CONTROL_LIMITS = Object.freeze({
  order: 20,
  samples: 4000,
  frequencies: 2000,
  rootIterations: 500,
  steps: 200_000
})

// ---------------------------------------------------------------- complex helpers

export interface Complex {
  re: number
  im: number
}

const c = (re: number, im = 0): Complex => ({ re, im })
const cAdd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im })
const cSub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im })
const cMul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re })
const cDiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}
const cAbs = (a: Complex): number => Math.hypot(a.re, a.im)

/** Evaluate a polynomial (highest power first) at a complex point, by Horner. */
const polyAt = (coefficients: readonly number[], at: Complex): Complex => {
  let out = c(0)
  for (const k of coefficients) out = cAdd(cMul(out, at), c(k))
  return out
}

/**
 * Roots of a real polynomial by Durand-Kerner.
 *
 * Chosen over companion-matrix eigenvalues because it needs no matrix code, converges on repeated roots given
 * enough iterations, and — importantly — can report that it did *not* converge rather than returning whatever it
 * happened to be holding.
 */
export function polynomialRoots(coefficients: readonly number[]): Complex[] | ControlError {
  const trimmed = [...coefficients]
  while (trimmed.length > 0 && Math.abs(trimmed[0]) < 1e-14) trimmed.shift()
  if (trimmed.length <= 1) return []
  if (trimmed.length - 1 > CONTROL_LIMITS.order) {
    return fail('too-many', `That is order ${trimmed.length - 1}; this handles up to ${CONTROL_LIMITS.order}.`)
  }
  for (const k of trimmed) if (!finite(k)) return fail('not-finite', 'A coefficient is not a finite number.')

  const n = trimmed.length - 1
  const lead = trimmed[0]
  const monic = trimmed.map((k) => k / lead)

  // Spread the starting guesses around a circle sized to the coefficients, off the real axis so a real
  // polynomial's symmetry cannot trap every guess on it.
  const radius = 1 + Math.max(...monic.slice(1).map(Math.abs))
  let roots: Complex[] = []
  for (let i = 0; i < n; i += 1) {
    const angle = (2 * Math.PI * i) / n + 0.35
    roots.push(c(radius * 0.5 * Math.cos(angle), radius * 0.5 * Math.sin(angle)))
  }

  let converged = false
  for (let iteration = 0; iteration < CONTROL_LIMITS.rootIterations; iteration += 1) {
    let worst = 0
    const next: Complex[] = []
    for (let i = 0; i < n; i += 1) {
      let denominator = c(1)
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue
        denominator = cMul(denominator, cSub(roots[i], roots[j]))
      }
      if (cAbs(denominator) < 1e-300) {
        // Two guesses have collided. Nudge one; a repeated root needs them to approach from different sides.
        next.push(cAdd(roots[i], c(1e-6, 1e-6)))
        worst = Math.max(worst, 1)
        continue
      }
      const step = cDiv(polyAt(monic, roots[i]), denominator)
      worst = Math.max(worst, cAbs(step))
      next.push(cSub(roots[i], step))
    }
    roots = next
    if (worst < 1e-12) {
      converged = true
      break
    }
  }
  if (!converged) {
    return fail('not-converged', `Root finding did not settle within ${CONTROL_LIMITS.rootIterations} passes. The polynomial may have a high-multiplicity root or very widely spread coefficients.`)
  }

  // Clean up the tiny imaginary parts a real polynomial's real roots pick up numerically.
  return roots.map((one) => (Math.abs(one.im) < 1e-9 * Math.max(1, Math.abs(one.re)) ? c(one.re, 0) : one))
}

// ---------------------------------------------------------------- transfer functions

export interface TransferFunction {
  /** Highest power first. */
  numerator: readonly number[]
  denominator: readonly number[]
}

export interface PoleZeroReport {
  poles: readonly { value: Complex; kind: 'real' | 'complex-pair'; timeConstant: number | null; naturalFrequency: number | null; dampingRatio: number | null }[]
  zeros: readonly Complex[]
  order: number
  /** Whether every pole is strictly in the left half plane. */
  stable: boolean
  /** Poles exactly on the imaginary axis. Not stable, not unstable — oscillating for ever. */
  marginal: boolean
  /** The pole nearest the imaginary axis, which is the one the response takes longest to forget. */
  dominant: { value: Complex; timeConstant: number | null } | null
  /** Steady-state output for a unit step, when the system is stable. */
  dcGain: number | null
  /** Zeros in the right half plane, which make the output move the wrong way first. */
  nonMinimumPhase: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Poles, zeros and what they mean for the response.
 *
 * The dominant pole is reported because it, not the transfer function's order, decides how long the system takes
 * to settle. A fifth-order plant with one slow pole behaves like a first-order one.
 */
export function poleZero(tf: TransferFunction): PoleZeroReport | ControlError {
  if (tf.denominator.length === 0) return fail('invalid-argument', 'The denominator is empty, so this is not a transfer function.')
  const poles = polynomialRoots(tf.denominator)
  if (isControlError(poles)) return poles
  const zeros = polynomialRoots(tf.numerator)
  if (isControlError(zeros)) return zeros

  const described = poles.map((p) => {
    if (Math.abs(p.im) < 1e-12) {
      return {
        value: p,
        kind: 'real' as const,
        timeConstant: p.re < 0 ? -1 / p.re : null,
        naturalFrequency: null,
        dampingRatio: null
      }
    }
    const wn = cAbs(p)
    return {
      value: p,
      kind: 'complex-pair' as const,
      timeConstant: p.re < 0 ? -1 / p.re : null,
      naturalFrequency: wn,
      dampingRatio: wn === 0 ? null : -p.re / wn
    }
  })

  const stable = poles.every((p) => p.re < -1e-12)
  const marginal = poles.some((p) => Math.abs(p.re) <= 1e-12)
  const nonMinimumPhase = zeros.some((z) => z.re > 1e-12)

  let dominant: PoleZeroReport['dominant'] = null
  if (poles.length > 0) {
    const nearest = poles.reduce((best, p) => (Math.abs(p.re) < Math.abs(best.re) ? p : best))
    dominant = { value: nearest, timeConstant: nearest.re < 0 ? -1 / nearest.re : null }
  }

  let dcGain: number | null = null
  const denominatorAtZero = tf.denominator[tf.denominator.length - 1]
  if (Math.abs(denominatorAtZero) > 1e-14) {
    dcGain = tf.numerator[tf.numerator.length - 1] / denominatorAtZero
  }

  const notes: string[] = [
    'A system is stable when every pole has a negative real part. That is the definition, not a rule of thumb, and it is what was checked here.',
    dominant?.timeConstant != null
      ? `The slowest pole has a time constant of ${dominant.timeConstant.toFixed(4)} s, so the response takes roughly ${(dominant.timeConstant * 4).toFixed(3)} s to settle whatever the other poles do.`
      : 'No stable dominant pole, so there is no settling time to quote.'
  ]
  const warnings: string[] = []
  if (!stable && !marginal) warnings.push('At least one pole is in the right half plane. This system’s output grows without bound; no amount of tuning downstream fixes an open loop that does this.')
  if (marginal) warnings.push('A pole sits on the imaginary axis. The response neither decays nor grows — it oscillates for ever. This is not stability, and the smallest modelling error pushes it either way.')
  if (nonMinimumPhase) {
    warnings.push('There is a zero in the right half plane. The output moves the wrong way before it moves the right way, and no controller can remove that — pushing the loop harder makes it worse, not better.')
  }
  if (tf.numerator.length > tf.denominator.length) {
    warnings.push('The numerator has a higher order than the denominator. That describes a system that responds before it is asked, which no physical thing does.')
  }

  return {
    poles: Object.freeze(described),
    zeros: Object.freeze(zeros),
    order: tf.denominator.length - 1,
    stable,
    marginal,
    dominant,
    dcGain,
    nonMinimumPhase,
    notes: Object.freeze(notes),
    warnings: Object.freeze(warnings)
  }
}

/** Multiply two polynomials, highest power first. */
const polyMul = (a: readonly number[], b: readonly number[]): number[] => {
  const out = new Array<number>(a.length + b.length - 1).fill(0)
  for (const [i, x] of a.entries()) for (const [j, y] of b.entries()) out[i + j] += x * y
  return out
}

/** Add two polynomials, highest power first, aligning on the constant term. */
const polyAdd = (a: readonly number[], b: readonly number[]): number[] => {
  const n = Math.max(a.length, b.length)
  const out = new Array<number>(n).fill(0)
  for (const [i, x] of a.entries()) out[i + n - a.length] += x
  for (const [i, y] of b.entries()) out[i + n - b.length] += y
  return out
}

/** Series, and the unity-feedback closed loop that follows from it. */
export function closedLoop(forward: TransferFunction, feedback?: TransferFunction): TransferFunction {
  const h = feedback ?? { numerator: [1], denominator: [1] }
  // G/(1+GH) = (Gn*Hd) / (Gd*Hd + Gn*Hn)
  return {
    numerator: polyMul(forward.numerator, h.denominator),
    denominator: polyAdd(polyMul(forward.denominator, h.denominator), polyMul(forward.numerator, h.numerator))
  }
}

export function series(a: TransferFunction, b: TransferFunction): TransferFunction {
  return { numerator: polyMul(a.numerator, b.numerator), denominator: polyMul(a.denominator, b.denominator) }
}

// ---------------------------------------------------------------- time response

export interface StepReport {
  samples: readonly { time: number; output: number }[]
  finalValue: number | null
  /** Fraction above the final value at the peak. Null when it never overshoots. */
  overshoot: number | null
  peakTime: number | null
  /** Seconds to reach and stay within the band. */
  settlingTime: number | null
  settlingBand: number
  riseTime: number | null
  /** Steady-state error for a unit step, when there is a final value. */
  steadyStateError: number | null
  stable: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Unit step response by numerical integration of the state-space form.
 *
 * Integrated, not looked up. Second-order closed forms exist and are what textbooks use, but they stop being
 * right the moment the system is third order or has a zero — and real loops almost always do. Runge-Kutta over
 * the controllable canonical form handles any order the same way.
 */
export function stepResponse(
  tf: TransferFunction,
  options?: { duration?: number; samples?: number; settlingBand?: number }
): StepReport | ControlError {
  const zp = poleZero(tf)
  if (isControlError(zp)) return zp

  const den = [...tf.denominator]
  while (den.length > 0 && Math.abs(den[0]) < 1e-14) den.shift()
  if (den.length <= 1) return fail('degenerate', 'The denominator has no s in it, so this is a gain and not a dynamic system.')
  const n = den.length - 1
  const lead = den[0]
  const a = den.map((k) => k / lead) // a[0] = 1

  const num = new Array<number>(den.length).fill(0)
  const rawNum = [...tf.numerator]
  if (rawNum.length > den.length) return fail('invalid-argument', 'The numerator has a higher order than the denominator, which no physical system has.')
  for (let i = 0; i < rawNum.length; i += 1) num[den.length - rawNum.length + i] = rawNum[i] / lead

  // Controllable canonical form. State derivative: x' = Ax + Bu with A the companion matrix.
  const feedthrough = num[0]
  const cRow: number[] = []
  for (let i = 1; i <= n; i += 1) cRow.push(num[i] - feedthrough * a[i])

  const settleTime = zp.dominant?.timeConstant ?? null
  const duration = options?.duration ?? (settleTime !== null ? Math.max(settleTime * 10, 1) : 10)
  if (!finite(duration) || duration <= 0) return fail('invalid-argument', 'The duration has to be a positive time.')
  const count = Math.round(options?.samples ?? 600)
  if (!Number.isInteger(count) || count < 2 || count > CONTROL_LIMITS.samples) {
    return fail('invalid-argument', `The sample count has to be between 2 and ${CONTROL_LIMITS.samples}.`)
  }
  const band = options?.settlingBand ?? 0.02
  if (!finite(band) || band <= 0 || band >= 1) return fail('invalid-argument', 'The settling band is a fraction between 0 and 1.')

  const derivative = (x: readonly number[]): number[] => {
    const out = new Array<number>(n).fill(0)
    for (let i = 0; i < n - 1; i += 1) out[i] = x[i + 1]
    let last = 1 // the unit step input
    for (let i = 0; i < n; i += 1) last -= a[n - i] * x[i]
    out[n - 1] = last
    return out
  }
  const outputOf = (x: readonly number[]): number => {
    let y = feedthrough
    for (let i = 0; i < n; i += 1) y += cRow[n - 1 - i] * x[i]
    return y
  }

  // A fixed small step under the sample spacing, so the integration accuracy does not depend on how many points
  // the caller asked to see.
  const dt = duration / (count - 1)
  const fastest = Math.max(...zp.poles.map((p) => cAbs(p.value)), 1)
  const substeps = Math.max(1, Math.min(200, Math.ceil(dt * fastest * 20)))
  const h = dt / substeps

  let x = new Array<number>(n).fill(0)
  const samples: { time: number; output: number }[] = [{ time: 0, output: outputOf(x) }]
  for (let i = 1; i < count; i += 1) {
    for (let s = 0; s < substeps; s += 1) {
      const k1 = derivative(x)
      const k2 = derivative(x.map((v, j) => v + (h / 2) * k1[j]))
      const k3 = derivative(x.map((v, j) => v + (h / 2) * k2[j]))
      const k4 = derivative(x.map((v, j) => v + h * k3[j]))
      x = x.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]))
    }
    samples.push({ time: i * dt, output: outputOf(x) })
  }

  const warnings: string[] = []
  let overshoot: number | null = null
  let peakTime: number | null = null
  let settling: number | null = null
  let rise: number | null = null
  let error: number | null = null
  const final = zp.stable ? zp.dcGain : null

  if (!zp.stable) {
    warnings.push('This system is not stable, so there is no final value, no overshoot and no settling time. The curve shown is what the output does on its way to infinity.')
  } else if (final !== null) {
    let peak = -Infinity
    for (const one of samples) {
      if (one.output > peak) {
        peak = one.output
        peakTime = one.time
      }
    }
    if (final !== 0 && peak > final) overshoot = (peak - final) / Math.abs(final)
    else peakTime = null

    const low = final * (1 - band)
    const high = final * (1 + band)
    for (let i = samples.length - 1; i >= 0; i -= 1) {
      const y = samples[i].output
      if (y < Math.min(low, high) || y > Math.max(low, high)) {
        settling = i + 1 < samples.length ? samples[i + 1].time : null
        break
      }
      if (i === 0) settling = 0
    }
    if (settling === null && samples[samples.length - 1].time < duration) settling = null

    const from = final * 0.1
    const to = final * 0.9
    const at = (level: number): number | null => {
      for (const one of samples) if ((final > 0 && one.output >= level) || (final < 0 && one.output <= level)) return one.time
      return null
    }
    const t10 = at(from)
    const t90 = at(to)
    rise = t10 !== null && t90 !== null ? t90 - t10 : null
    error = 1 - final
  }

  if (settling === null && zp.stable) {
    warnings.push(`The response had not settled within ${band * 100}% by the end of the window. Either extend the duration or accept that this loop is slower than the window shown.`)
  }

  const notes: string[] = [
    'This is integrated from the system’s own equations, not read off a second-order formula. Second-order formulas stop being correct the moment there is a third pole or a zero, and real loops have both.',
    overshoot !== null
      ? `It overshoots by ${(overshoot * 100).toFixed(1)}%. Overshoot is set by the damping ratio, and pushing the gain up to go faster always costs overshoot.`
      : 'It does not overshoot. That usually means the damping is at or above critical, which is slow but never exceeds its target.'
  ]
  if (error !== null && Math.abs(error) > 1e-9) {
    notes.push(`The steady-state error to a unit step is ${error.toFixed(4)}. Only an integrator in the loop removes that, and adding one costs phase margin.`)
  }

  return {
    samples: Object.freeze(samples),
    finalValue: final,
    overshoot,
    peakTime,
    settlingTime: settling,
    settlingBand: band,
    riseTime: rise,
    steadyStateError: error,
    stable: zp.stable,
    notes: Object.freeze(notes),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- frequency response

export interface BodePoint {
  frequency: number
  magnitude: number
  magnitudeDb: number
  phaseDegrees: number
}

export interface BodeReport {
  points: readonly BodePoint[]
  /** Frequency where the magnitude crosses 1, and the phase margin there. */
  gainCrossover: number | null
  phaseMargin: number | null
  /** Frequency where the phase crosses -180, and the gain margin there. */
  phaseCrossover: number | null
  gainMarginDb: number | null
  /** Whether the closed loop would be stable, from the margins. */
  closedLoopStable: boolean | null
  /** Highest magnitude, and where. */
  peakDb: number
  peakFrequency: number
  bandwidth: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Bode magnitude and phase, with both margins found by crossing detection.
 *
 * Gain margin and phase margin measure the *same* distance to instability in two different directions, and a loop
 * can have a healthy one and a dangerous other. Both are reported, and a phase margin below 30 degrees is
 * flagged, because a loop that is technically stable with 5 degrees of margin will not survive its own plant
 * changing slightly with temperature.
 */
export function bode(
  tf: TransferFunction,
  options?: { from?: number; to?: number; points?: number }
): BodeReport | ControlError {
  const from = options?.from ?? 0.01
  const to = options?.to ?? 1000
  if (!finite(from) || !finite(to) || from <= 0 || to <= from) {
    return fail('invalid-argument', 'The frequency range has to start above zero and end above where it started.')
  }
  const count = Math.round(options?.points ?? 400)
  if (!Number.isInteger(count) || count < 2 || count > CONTROL_LIMITS.frequencies) {
    return fail('invalid-argument', `The point count has to be between 2 and ${CONTROL_LIMITS.frequencies}.`)
  }

  const points: BodePoint[] = []
  let unwrapped = 0
  let previousRaw: number | null = null
  for (let i = 0; i < count; i += 1) {
    const w = from * Math.pow(to / from, i / (count - 1))
    const s = c(0, w)
    const numerator = polyAt(tf.numerator, s)
    const denominator = polyAt(tf.denominator, s)
    if (cAbs(denominator) < 1e-300) return fail('degenerate', `The denominator is zero at ${w.toFixed(4)} rad/s, which is a pole exactly on the imaginary axis. The frequency response is undefined there.`)
    const h = cDiv(numerator, denominator)
    const magnitude = cAbs(h)
    const raw = (Math.atan2(h.im, h.re) * 180) / Math.PI
    // Unwrap: a jump of more than 180 degrees between neighbouring points is the branch cut, not the system.
    if (previousRaw !== null) {
      let delta = raw - previousRaw
      while (delta > 180) delta -= 360
      while (delta < -180) delta += 360
      unwrapped += delta
    } else {
      unwrapped = raw
    }
    previousRaw = raw
    points.push({ frequency: w, magnitude, magnitudeDb: 20 * Math.log10(Math.max(magnitude, 1e-300)), phaseDegrees: unwrapped })
  }

  const interpolate = (a: BodePoint, b: BodePoint, pick: (p: BodePoint) => number, target: number): number => {
    const t = (target - pick(a)) / (pick(b) - pick(a))
    return a.frequency * Math.pow(b.frequency / a.frequency, Math.max(0, Math.min(1, t)))
  }

  let gainCrossover: number | null = null
  let phaseMargin: number | null = null
  let phaseCrossover: number | null = null
  let gainMarginDb: number | null = null
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    if (gainCrossover === null && ((a.magnitudeDb >= 0 && b.magnitudeDb < 0) || (a.magnitudeDb < 0 && b.magnitudeDb >= 0))) {
      gainCrossover = interpolate(a, b, (p) => p.magnitudeDb, 0)
      const t = (0 - a.magnitudeDb) / (b.magnitudeDb - a.magnitudeDb)
      phaseMargin = 180 + (a.phaseDegrees + t * (b.phaseDegrees - a.phaseDegrees))
    }
    if (phaseCrossover === null && ((a.phaseDegrees >= -180 && b.phaseDegrees < -180) || (a.phaseDegrees < -180 && b.phaseDegrees >= -180))) {
      phaseCrossover = interpolate(a, b, (p) => p.phaseDegrees, -180)
      const t = (-180 - a.phaseDegrees) / (b.phaseDegrees - a.phaseDegrees)
      gainMarginDb = -(a.magnitudeDb + t * (b.magnitudeDb - a.magnitudeDb))
    }
  }

  const peak = points.reduce((best, p) => (p.magnitudeDb > best.magnitudeDb ? p : best))
  const lowFrequencyDb = points[0].magnitudeDb
  let bandwidth: number | null = null
  for (let i = 1; i < points.length; i += 1) {
    if (points[i - 1].magnitudeDb >= lowFrequencyDb - 3 && points[i].magnitudeDb < lowFrequencyDb - 3) {
      bandwidth = interpolate(points[i - 1], points[i], (p) => p.magnitudeDb, lowFrequencyDb - 3)
      break
    }
  }

  const warnings: string[] = []
  if (gainCrossover === null) {
    warnings.push(`The magnitude never crosses 0 dB inside ${from} to ${to} rad/s, so there is no phase margin to report. Widen the range.`)
  } else if (phaseMargin !== null && phaseMargin < 30) {
    warnings.push(
      `The phase margin is ${phaseMargin.toFixed(1)} degrees. Below about 30 this loop is stable only on paper — a small change in the plant with temperature or age is enough to take it unstable, and it will ring badly long before that.`
    )
  }
  if (phaseCrossover !== null && gainMarginDb !== null && gainMarginDb < 6) {
    warnings.push(`The gain margin is ${gainMarginDb.toFixed(1)} dB. Below about 6 dB there is very little room: doubling the loop gain would take this unstable.`)
  }

  const closedLoopStable =
    gainCrossover === null ? null : (phaseMargin ?? -1) > 0 && (gainMarginDb === null || gainMarginDb > 0)

  return {
    points: Object.freeze(points),
    gainCrossover,
    phaseMargin,
    phaseCrossover,
    gainMarginDb,
    closedLoopStable,
    peakDb: peak.magnitudeDb,
    peakFrequency: peak.frequency,
    bandwidth,
    notes: Object.freeze([
      'Gain margin and phase margin measure the distance to the same instability in two different directions. A loop can have a comfortable one and a dangerous other, which is why both are here.',
      'Phase margin also predicts the overshoot: roughly, damping ratio is phase margin divided by 100, so 45 degrees gives about 23% overshoot.',
      'These are open-loop quantities read from an open-loop plot, and they say what happens when the loop is closed.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- Routh-Hurwitz

export interface RouthReport {
  /** Each row of the array, left to right. */
  rows: readonly (readonly number[])[]
  /** How many poles are in the right half plane. */
  rightHalfPlanePoles: number
  stable: boolean
  /** True when a whole row went to zero, which means poles symmetric about the origin. */
  auxiliaryUsed: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Routh-Hurwitz: stability from the coefficients, without finding the poles.
 *
 * Kept alongside `poleZero` because it answers a question root-finding cannot: with a symbolic gain in the
 * coefficients it gives the *range* of gain that keeps the loop stable. The two special cases — a zero in the
 * first column, and a whole row of zeros — are handled explicitly rather than being allowed to divide by zero,
 * because both mean something real about where the poles are.
 */
export function routhHurwitz(coefficients: readonly number[]): RouthReport | ControlError {
  const a = [...coefficients]
  while (a.length > 0 && Math.abs(a[0]) < 1e-14) a.shift()
  if (a.length < 2) return fail('degenerate', 'There is no polynomial here to test.')
  if (a.length - 1 > CONTROL_LIMITS.order) return fail('too-many', `That is order ${a.length - 1}; this handles up to ${CONTROL_LIMITS.order}.`)
  for (const k of a) if (!finite(k)) return fail('not-finite', 'A coefficient is not a finite number.')

  const n = a.length - 1
  const width = Math.floor(n / 2) + 1
  const rows: number[][] = []
  const first: number[] = []
  const second: number[] = []
  for (let i = 0; i <= n; i += 1) {
    if (i % 2 === 0) first.push(a[i])
    else second.push(a[i])
  }
  while (first.length < width) first.push(0)
  while (second.length < width) second.push(0)
  rows.push(first, second)

  let auxiliaryUsed = false
  const warnings: string[] = []
  const epsilon = 1e-9 * Math.max(...a.map(Math.abs))

  for (let r = 2; r <= n; r += 1) {
    const above = rows[r - 2]
    const previous = rows[r - 1]

    if (previous.every((v) => Math.abs(v) < 1e-14)) {
      // A whole row of zeros: the polynomial has a factor with roots symmetric about the origin. Differentiate
      // the auxiliary polynomial from the row above and carry on.
      auxiliaryUsed = true
      const order = n - (r - 1)
      const replacement = above.map((v, i) => v * (order - 2 * i)).slice(0, width)
      while (replacement.length < width) replacement.push(0)
      rows[r - 1] = replacement
      warnings.push(
        'A whole row came out as zero. That means the polynomial has roots placed symmetrically about the origin — a pair on the imaginary axis, or a real pair either side. The array was continued from the auxiliary polynomial, and this system is at best marginally stable.'
      )
    } else if (Math.abs(previous[0]) < 1e-14) {
      // A single zero in the first column. Replacing it with a small positive number is the standard trick and
      // it does not change the sign count, but it is worth saying out loud that the answer now depends on a
      // substitution rather than on the original numbers.
      previous[0] = epsilon
      warnings.push('The first entry of a row was zero, so a very small positive value was substituted in its place. The sign count is still correct, but the array below that point depends on that substitution.')
    }

    const row: number[] = []
    for (let i = 0; i < width; i += 1) {
      const b = above[i + 1] ?? 0
      const d = previous[i + 1] ?? 0
      row.push((previous[0] * b - above[0] * d) / previous[0])
    }
    rows.push(row)
  }

  const column = rows.map((r) => r[0])
  let changes = 0
  for (let i = 1; i < column.length; i += 1) {
    if (Math.abs(column[i]) < 1e-14) continue
    let previous = column[i - 1]
    let back = i - 1
    while (Math.abs(previous) < 1e-14 && back > 0) {
      back -= 1
      previous = column[back]
    }
    if (previous * column[i] < 0) changes += 1
  }

  return {
    rows: Object.freeze(rows.map((r) => Object.freeze([...r]))),
    rightHalfPlanePoles: changes,
    stable: changes === 0 && !auxiliaryUsed,
    auxiliaryUsed,
    notes: Object.freeze([
      'The number of sign changes down the first column is the number of poles in the right half plane. Zero changes means stable.',
      'This answers whether the system is stable without finding the poles, which is what makes it useful when a gain is left as a symbol: it gives the range of gain that keeps the loop stable.',
      'It does not say how stable. For that, look at the margins or the poles themselves.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- PID

export type TuningRule = 'ziegler-nichols-ultimate' | 'ziegler-nichols-step' | 'tyreus-luyben' | 'cohen-coon' | 'imc'

export const TUNING_RULES: readonly TuningRule[] = Object.freeze([
  'ziegler-nichols-ultimate',
  'ziegler-nichols-step',
  'tyreus-luyben',
  'cohen-coon',
  'imc'
])

export const TUNING_FACTS: Readonly<
  Record<TuningRule, { label: string; needs: string; fittedFor: string; behaviour: string }>
> = Object.freeze({
  'ziegler-nichols-ultimate': {
    label: 'Ziegler-Nichols (ultimate gain)',
    needs: 'The gain at which the loop just oscillates, and the period of that oscillation.',
    fittedFor: 'Process plant, 1942, aiming at quarter-amplitude decay.',
    behaviour: 'Aggressive. Typically 25% or more overshoot and very little margin. A starting point to detune from, not a destination.'
  },
  'ziegler-nichols-step': {
    label: 'Ziegler-Nichols (step response)',
    needs: 'The dead time, the slope of the open-loop step response, and the process gain.',
    fittedFor: 'Self-regulating processes with a clear S-shaped step response.',
    behaviour: 'Same aggression as the ultimate-gain form. Falls apart when the dead time is a large fraction of the time constant.'
  },
  'tyreus-luyben': {
    label: 'Tyreus-Luyben',
    needs: 'The ultimate gain and period, the same as Ziegler-Nichols.',
    fittedFor: 'The same loops, deliberately detuned.',
    behaviour: 'Much more conservative than Ziegler-Nichols. Slower, far less overshoot, far more robust. Usually the better default.'
  },
  'cohen-coon': {
    label: 'Cohen-Coon',
    needs: 'Process gain, time constant and dead time.',
    fittedFor: 'Processes where the dead time is a significant fraction of the time constant.',
    behaviour: 'Better than Ziegler-Nichols on dead-time-dominant loops, still aggressive.'
  },
  imc: {
    label: 'Internal model control (lambda tuning)',
    needs: 'Process gain, time constant, dead time, and a chosen closed-loop time constant.',
    fittedFor: 'First-order-plus-dead-time models. The closed-loop speed is chosen rather than falling out.',
    behaviour: 'As fast or as gentle as you ask. The only rule here where robustness is a dial rather than an outcome.'
  }
})

export interface PidGains {
  proportional: number
  integral: number
  derivative: number
  /** Seconds. The classical form's Ti and Td, for controllers that take those. */
  integralTime: number | null
  derivativeTime: number | null
}

export interface TuningReport {
  rule: TuningRule
  label: string
  gains: PidGains
  form: 'P' | 'PI' | 'PID'
  fittedFor: string
  behaviour: string
  /** The closed-loop step response these gains actually give, so the overshoot is visible. */
  response: StepReport | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * PID gains from a named tuning rule, with the closed loop simulated so the result is visible.
 *
 * Every rule here is an empirical fit with a known bias, and each one says so. The simulation matters more than
 * the numbers: Ziegler-Nichols will produce gains that look reasonable and a step response that overshoots by a
 * third, and only one of those two facts is obvious from the gains alone.
 */
export function tunePid(input: {
  rule: TuningRule
  form?: 'P' | 'PI' | 'PID'
  ultimateGain?: number
  ultimatePeriod?: number
  processGain?: number
  timeConstant?: number
  deadTime?: number
  closedLoopTimeConstant?: number
  plant?: TransferFunction
}): TuningReport | ControlError {
  const facts = TUNING_FACTS[input.rule]
  if (!facts) return fail('invalid-argument', `"${input.rule}" is not one of: ${TUNING_RULES.join(', ')}.`)
  const form = input.form ?? 'PID'

  let kp: number
  let ti: number | null = null
  let td: number | null = null
  const warnings: string[] = []

  if (input.rule === 'ziegler-nichols-ultimate' || input.rule === 'tyreus-luyben') {
    const { ultimateGain: ku, ultimatePeriod: pu } = input
    if (ku === undefined || pu === undefined) {
      return fail('invalid-argument', `${facts.label} needs ${facts.needs}`)
    }
    if (!finite(ku) || !finite(pu) || ku <= 0 || pu <= 0) {
      return fail('invalid-argument', 'The ultimate gain and period both have to be greater than zero.')
    }
    if (input.rule === 'ziegler-nichols-ultimate') {
      if (form === 'P') kp = 0.5 * ku
      else if (form === 'PI') {
        kp = 0.45 * ku
        ti = pu / 1.2
      } else {
        kp = 0.6 * ku
        ti = pu / 2
        td = pu / 8
      }
    } else {
      if (form === 'P') return fail('invalid-argument', 'Tyreus-Luyben has no proportional-only form.')
      if (form === 'PI') {
        kp = ku / 3.2
        ti = 2.2 * pu
      } else {
        kp = ku / 2.2
        ti = 2.2 * pu
        td = pu / 6.3
      }
    }
  } else {
    const { processGain: k, timeConstant: tau, deadTime: theta } = input
    if (k === undefined || tau === undefined || theta === undefined) {
      return fail('invalid-argument', `${facts.label} needs ${facts.needs}`)
    }
    if (!finite(k) || !finite(tau) || !finite(theta) || k === 0 || tau <= 0 || theta < 0) {
      return fail('invalid-argument', 'The process gain must be non-zero, the time constant positive and the dead time not negative.')
    }
    if (theta === 0 && input.rule !== 'imc') {
      return fail(
        'degenerate',
        `${facts.label} divides by the dead time. With no dead time it gives infinite gain — which is correct, in the sense that a process with no delay can be driven arbitrarily hard, and useless as a tuning.`
      )
    }
    const ratio = theta / tau

    if (input.rule === 'ziegler-nichols-step') {
      if (form === 'P') kp = tau / (k * theta)
      else if (form === 'PI') {
        kp = (0.9 * tau) / (k * theta)
        ti = 3.33 * theta
      } else {
        kp = (1.2 * tau) / (k * theta)
        ti = 2 * theta
        td = 0.5 * theta
      }
      if (ratio > 1) warnings.push(`The dead time is ${ratio.toFixed(2)} times the time constant. Ziegler-Nichols was not fitted for that and will tune far too aggressively here; Cohen-Coon or IMC suit dead-time-dominant loops better.`)
    } else if (input.rule === 'cohen-coon') {
      if (form === 'P') kp = (1 / (k * ratio)) * (1 + ratio / 3)
      else if (form === 'PI') {
        kp = (1 / (k * ratio)) * (0.9 + ratio / 12)
        ti = (theta * (30 + 3 * ratio)) / (9 + 20 * ratio)
      } else {
        kp = (1 / (k * ratio)) * (4 / 3 + ratio / 4)
        ti = (theta * (32 + 6 * ratio)) / (13 + 8 * ratio)
        td = (4 * theta) / (11 + 2 * ratio)
      }
    } else {
      const lambda = input.closedLoopTimeConstant ?? Math.max(tau, 8 * theta) / 2
      if (!finite(lambda) || lambda <= 0) return fail('invalid-argument', 'The closed-loop time constant has to be greater than zero.')
      if (form === 'PID') {
        kp = (tau + theta / 2) / (k * (lambda + theta / 2))
        ti = tau + theta / 2
        td = (tau * theta) / (2 * tau + theta)
      } else if (form === 'PI') {
        kp = tau / (k * (lambda + theta))
        ti = tau
      } else {
        kp = tau / (k * (lambda + theta))
      }
      if (lambda < theta) {
        warnings.push(`The closed-loop time constant asked for (${lambda.toFixed(3)} s) is shorter than the dead time (${theta.toFixed(3)} s). You cannot respond faster than the delay before you can even see what happened; this tuning will be fragile.`)
      }
    }
  }

  const gains: PidGains = {
    proportional: kp,
    integral: ti === null || ti === 0 ? 0 : kp / ti,
    derivative: td === null ? 0 : kp * td,
    integralTime: ti,
    derivativeTime: td
  }

  let response: StepReport | null = null
  if (input.plant) {
    // C(s) = Kd s^2 + Kp s + Ki, all over s.
    const controller: TransferFunction = { numerator: [gains.derivative, gains.proportional, gains.integral], denominator: [1, 0] }
    const loop = closedLoop(series(controller, input.plant))
    const simulated = stepResponse(loop)
    if (!isControlError(simulated)) {
      response = simulated
      if (simulated.overshoot !== null && simulated.overshoot > 0.25) {
        warnings.push(`These gains overshoot by ${(simulated.overshoot * 100).toFixed(0)}% on this plant. That is what ${facts.label} does; detune the proportional gain if that is not acceptable.`)
      }
      if (!simulated.stable) {
        warnings.push('These gains make the closed loop unstable on the plant given. The rule assumes a plant shape that this one does not match.')
      }
    }
  }

  return {
    rule: input.rule,
    label: facts.label,
    gains,
    form,
    fittedFor: facts.fittedFor,
    behaviour: facts.behaviour,
    response,
    notes: Object.freeze([
      `${facts.label}. Fitted for: ${facts.fittedFor} Known behaviour: ${facts.behaviour}`,
      'A tuning rule is a starting point with a known bias, not an answer. The gains are worth what the closed-loop response says they are worth, which is why it is simulated here when a plant is given.',
      'The integral term removes steady-state error and costs phase margin. The derivative term adds damping and amplifies measurement noise. Neither is free.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/**
 * Simulate a PID loop directly, with the practical limits that real controllers have.
 *
 * Output saturation and integral windup are in here because they are what actually goes wrong. A loop tuned on an
 * unlimited simulation and deployed on an actuator that saturates will wind its integrator up during the
 * saturation and then overshoot enormously as it unwinds — a failure that is invisible in any simulation without
 * a limit in it.
 */
export interface PidSimReport {
  samples: readonly { time: number; setpoint: number; output: number; control: number; saturated: boolean }[]
  /** How long the actuator spent on its limit. */
  saturatedFraction: number
  finalError: number
  /** Integral of the absolute error. A single number for comparing tunings. */
  absoluteErrorIntegral: number
  notes: readonly string[]
  warnings: readonly string[]
}

export function simulatePid(input: {
  plant: TransferFunction
  gains: { proportional: number; integral: number; derivative: number }
  setpoint?: number
  duration: number
  timeStep?: number
  outputMinimum?: number
  outputMaximum?: number
  antiWindup?: boolean
  derivativeFilter?: number
}): PidSimReport | ControlError {
  const { plant, gains, duration } = input
  for (const [name, value] of Object.entries(gains)) {
    if (!finite(value)) return fail('not-finite', `The ${name} gain is not a finite number.`)
  }
  if (!finite(duration) || duration <= 0) return fail('invalid-argument', 'The duration has to be a positive time.')

  const den = [...plant.denominator]
  while (den.length > 0 && Math.abs(den[0]) < 1e-14) den.shift()
  if (den.length <= 1) return fail('degenerate', 'The plant has no dynamics in it.')
  const n = den.length - 1
  const lead = den[0]
  const a = den.map((k) => k / lead)
  const num = new Array<number>(den.length).fill(0)
  const rawNum = [...plant.numerator]
  if (rawNum.length > den.length) return fail('invalid-argument', 'The plant numerator has a higher order than its denominator.')
  for (let i = 0; i < rawNum.length; i += 1) num[den.length - rawNum.length + i] = rawNum[i] / lead
  const feedthrough = num[0]
  const cRow: number[] = []
  for (let i = 1; i <= n; i += 1) cRow.push(num[i] - feedthrough * a[i])

  const dt = input.timeStep ?? duration / 2000
  if (!finite(dt) || dt <= 0) return fail('invalid-argument', 'The time step has to be greater than zero.')
  const steps = Math.round(duration / dt)
  if (steps > CONTROL_LIMITS.steps) {
    return fail('too-many', `That is ${steps} steps; use a larger time step or a shorter duration.`)
  }

  const setpoint = input.setpoint ?? 1
  const low = input.outputMinimum ?? Number.NEGATIVE_INFINITY
  const high = input.outputMaximum ?? Number.POSITIVE_INFINITY
  if (low >= high) return fail('invalid-argument', 'The output minimum is at or above the maximum.')
  const antiWindup = input.antiWindup ?? true
  const filterTime = input.derivativeFilter ?? 0

  let x = new Array<number>(n).fill(0)
  let integral = 0
  let previousError = setpoint
  let filteredDerivative = 0
  let saturatedSteps = 0
  let iae = 0

  const outputOf = (state: readonly number[], u: number): number => {
    let y = feedthrough * u
    for (let i = 0; i < n; i += 1) y += cRow[n - 1 - i] * state[i]
    return y
  }

  const samples: PidSimReport['samples'][number][] = []
  const sampleEvery = Math.max(1, Math.floor(steps / 1000))

  for (let step = 0; step <= steps; step += 1) {
    const y = outputOf(x, 0)
    const error = setpoint - y
    const rawDerivative = step === 0 ? 0 : (error - previousError) / dt
    if (filterTime > 0) {
      const alpha = dt / (filterTime + dt)
      filteredDerivative += alpha * (rawDerivative - filteredDerivative)
    } else {
      filteredDerivative = rawDerivative
    }
    const unlimited = gains.proportional * error + gains.integral * integral + gains.derivative * filteredDerivative
    const u = Math.max(low, Math.min(high, unlimited))
    const saturated = u !== unlimited
    if (saturated) saturatedSteps += 1
    // Anti-windup by conditional integration: while the actuator is on its limit, stop accumulating error that
    // pushes it further into the limit. Without this the integrator keeps growing during saturation and the loop
    // overshoots enormously when it comes off the limit.
    if (!saturated || !antiWindup || (u - unlimited) * error < 0) {
      integral += error * dt
    }
    previousError = error
    iae += Math.abs(error) * dt

    if (step % sampleEvery === 0 || step === steps) {
      samples.push({ time: step * dt, setpoint, output: y, control: u, saturated })
    }
    if (step === steps) break

    const derivative = (state: readonly number[]): number[] => {
      const out = new Array<number>(n).fill(0)
      for (let i = 0; i < n - 1; i += 1) out[i] = state[i + 1]
      let last = u
      for (let i = 0; i < n; i += 1) last -= a[n - i] * state[i]
      out[n - 1] = last
      return out
    }
    const k1 = derivative(x)
    const k2 = derivative(x.map((v, j) => v + (dt / 2) * k1[j]))
    const k3 = derivative(x.map((v, j) => v + (dt / 2) * k2[j]))
    const k4 = derivative(x.map((v, j) => v + dt * k3[j]))
    x = x.map((v, j) => v + (dt / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]))
    if (!x.every(finite)) {
      return fail('no-solution', `The simulation blew up at ${(step * dt).toFixed(4)} s. These gains make this loop unstable.`)
    }
  }

  const saturatedFraction = saturatedSteps / (steps + 1)
  const warnings: string[] = []
  if (saturatedFraction > 0.1) {
    warnings.push(
      `The actuator was on its limit for ${(saturatedFraction * 100).toFixed(0)}% of the run. The loop is not doing what the gains say it is doing for that time — it is doing whatever the limit allows.`
    )
  }
  if (saturatedFraction > 0 && !antiWindup) {
    warnings.push('The actuator saturated and anti-windup is off. The integrator is accumulating error it cannot act on, and the loop will overshoot badly when it comes off the limit.')
  }
  if (gains.derivative !== 0 && filterTime === 0) {
    warnings.push('Derivative action with no filter. On a real measurement this amplifies noise directly into the actuator; in simulation it looks fine because there is no noise here.')
  }

  return {
    samples: Object.freeze(samples),
    saturatedFraction,
    finalError: previousError,
    absoluteErrorIntegral: iae,
    notes: Object.freeze([
      'This simulation includes actuator limits and integral windup, because those are what actually goes wrong on a real loop and they are invisible in a simulation without them.',
      `The integrated absolute error is ${iae.toFixed(4)}. It is one number for comparing two tunings on the same problem, and it is meaningless on its own.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const CONTROL_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Systems are linear and time invariant. Real plants saturate, stick and change with temperature, and none of that is in a transfer function.',
  'Stability is decided by where the poles actually are, found numerically, not by a rule of thumb.',
  'Margins are open-loop quantities that predict closed-loop behaviour. They are reliable for well behaved plants and less so for ones with several crossings.',
  'Tuning rules are empirical fits with known biases. Each one names its origin and what it does, and the closed loop is simulated rather than described.',
  'Time responses are integrated from the system equations, so they stay correct above second order and with zeros present.',
  'Dead time is handled where a rule accounts for it. It is not represented as a transfer function here, because a rational approximation to a delay is itself a modelling choice.'
])
