/**
 * Ecology: populations over time, who eats whom, and how much variety there is.
 *
 * The shared ecology engine for Orbis Pages. Population models are integrated rather than approximated, diversity
 * indices are reported together because they weight rarity differently, and every estimate from a sample says how
 * much the sample constrains it.
 *
 * ## Why several diversity indices are always reported
 *
 * Species richness counts species and ignores abundance. Shannon weights every species by its log-abundance.
 * Simpson is dominated by the common species and barely notices the rare ones. Two communities can rank in opposite
 * orders under Shannon and Simpson, and neither ranking is wrong — they are answers to different questions about
 * what diversity means. Reporting one index alone hides that the choice was made, so this reports them all along
 * with the effective species number, which is the one that is comparable.
 *
 * ## Why a population projection reports where it stops being meaningful
 *
 * Exponential growth extrapolated far enough predicts more bacteria than there are atoms. Logistic growth is better
 * behaved and still assumes a fixed carrying capacity, instant response to density, no age structure, and no
 * environmental variation. Every projection states how far out it was run and what it assumed, because the
 * arithmetic will happily continue long after the biology has stopped.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * richness       vs  diversity      -- how many species against how evenly they are spread
 * growth rate    vs  doubling time  -- a rate against the time it implies
 * capacity       vs  current size   -- what the environment supports against what is there
 * density        vs  abundance      -- per unit area against a total
 * a projection   vs  a prediction   -- what a model gives against what will happen
 * correlation    vs  a food web     -- species found together against species eating each other
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface EcologyError {
  error: 'invalid-argument' | 'out-of-range' | 'insufficient-data' | 'no-solution' | 'too-many'
  message: string
}

export const isEcologyError = (value: unknown): value is EcologyError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: EcologyError['error'], message: string): EcologyError => ({ error, message })

export const ECOLOGY_LIMITS = Object.freeze({ steps: 200_000, species: 5_000, samples: 20_000, traceSamples: 400 })

const thin = <T>(samples: readonly T[], wanted: number): readonly T[] => {
  if (samples.length <= wanted) return samples
  const step = (samples.length - 1) / (wanted - 1)
  const out: T[] = []
  for (let i = 0; i < wanted; i += 1) out.push(samples[Math.round(i * step)])
  return out
}

// ---------------------------------------------------------------- population growth

export type GrowthModel = 'exponential' | 'logistic' | 'gompertz' | 'ricker' | 'beverton-holt'

export interface GrowthReport {
  model: GrowthModel
  /** The size at the end of the projection. */
  finalSize: number
  /** Where the size stops changing, if there is such a point. */
  equilibrium: number | null
  /** Time to double, for exponential growth — and why it does not apply to the others. */
  doublingTime: number | null
  /** Where growth is fastest, which for logistic growth is exactly half the carrying capacity. */
  fastestGrowthAt: { size: number; time: number; rate: number } | null
  /** Whether the projection ran past where the model means anything. */
  beyondMeaning: boolean
  /** The size over time. */
  trace: readonly { time: number; size: number; growthRate: number }[]
  assumptions: readonly string[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Project a population forward under a named growth model, integrated with fourth-order Runge-Kutta.
 *
 * The continuous models are integrated rather than stepped with a difference equation, because a coarse Euler step
 * on logistic growth overshoots the carrying capacity and then oscillates — an artefact of the arithmetic that looks
 * exactly like real boom-and-bust dynamics and is not.
 *
 * Ricker and Beverton-Holt are genuine difference equations, applied per time step as written. Ricker can produce
 * real chaos at high growth rates, and that is a property of the model rather than of the integration, so when the
 * projection enters that regime it is said.
 */
export function populationGrowth(input: {
  model: GrowthModel
  /** Starting population. */
  initialSize: number
  /** Intrinsic growth rate, per unit time. */
  growthRate: number
  /** Carrying capacity. Required for everything but exponential. */
  carryingCapacity?: number
  /** How long to run. */
  duration: number
  /** Integration steps. */
  steps?: number
}): GrowthReport | EcologyError {
  const { model, initialSize, growthRate, duration } = input
  const models: readonly GrowthModel[] = ['exponential', 'logistic', 'gompertz', 'ricker', 'beverton-holt']
  if (!models.includes(model)) return fail('invalid-argument', `The model is one of ${models.join(', ')}.`)
  if (!Number.isFinite(initialSize) || initialSize < 0) return fail('invalid-argument', 'The starting population cannot be negative.')
  if (!Number.isFinite(growthRate)) return fail('invalid-argument', 'The growth rate has to be a number.')
  if (!Number.isFinite(duration) || duration <= 0) return fail('invalid-argument', 'The duration has to be positive.')

  const discrete = model === 'ricker' || model === 'beverton-holt'
  const steps = Math.max(1, Math.round(input.steps ?? (discrete ? Math.min(duration, 10_000) : 2_000)))
  if (steps > ECOLOGY_LIMITS.steps) return fail('too-many', `That is ${steps} steps; this handles up to ${ECOLOGY_LIMITS.steps}.`)

  const warnings: string[] = []
  let capacity = 0
  if (model !== 'exponential') {
    if (input.carryingCapacity === undefined) {
      return fail(
        'invalid-argument',
        `The ${model} model needs a carrying capacity. Only exponential growth has none, which is exactly why exponential growth extrapolated far enough predicts more organisms than there are atoms.`
      )
    }
    if (!Number.isFinite(input.carryingCapacity) || input.carryingCapacity <= 0) {
      return fail('out-of-range', 'The carrying capacity has to be positive.')
    }
    capacity = input.carryingCapacity
    if (model === 'gompertz' && initialSize <= 0) {
      return fail(
        'invalid-argument',
        'Gompertz growth is undefined at a starting size of zero, because it uses the logarithm of the size ratio. A population of exactly zero also never grows under any model, so the question is usually about a very small population rather than none.'
      )
    }
  } else if (input.carryingCapacity !== undefined) {
    warnings.push('A carrying capacity was given but exponential growth has none, so it was ignored. If a ceiling was intended, the logistic model is the one that has one.')
  }

  const derivative = (size: number): number => {
    switch (model) {
      case 'exponential':
        return growthRate * size
      case 'logistic':
        return growthRate * size * (1 - size / capacity)
      case 'gompertz':
        return size <= 0 ? 0 : growthRate * size * Math.log(capacity / size)
      default:
        return 0
    }
  }

  const trace: { time: number; size: number; growthRate: number }[] = []
  let size = initialSize
  const dt = duration / steps
  trace.push({ time: 0, size, growthRate: discrete ? 0 : derivative(size) })

  if (discrete) {
    // Difference equations, applied once per time step as written. The step size is the generation.
    for (let i = 1; i <= steps; i += 1) {
      const previous = size
      if (model === 'ricker') size = previous * Math.exp(growthRate * (1 - previous / capacity))
      else size = (Math.exp(growthRate) * previous) / (1 + ((Math.exp(growthRate) - 1) * previous) / capacity)
      if (!Number.isFinite(size) || size < 0) {
        warnings.push(`The population went non-finite at step ${i}, which means the growth rate is too large for this model to remain bounded.`)
        size = previous
        break
      }
      trace.push({ time: (i * duration) / steps, size, growthRate: size - previous })
    }
    if (model === 'ricker' && growthRate > 2) {
      warnings.push(
        `A Ricker growth rate of ${growthRate} is above 2, where the model becomes genuinely chaotic: the trajectory never settles and it is exquisitely sensitive to the starting size. That is a real property of the equation, not an artefact of the arithmetic, and it means the projection has no predictive value even though it has exact values.`
      )
    } else if (model === 'ricker' && growthRate > 2 / Math.E) {
      warnings.push(
        `A Ricker growth rate above about 0.736 overshoots the carrying capacity and oscillates before settling. Above 2 it never settles at all.`
      )
    }
  } else {
    // Fourth-order Runge-Kutta. A coarse Euler step on logistic growth overshoots the capacity and then
    // oscillates, which looks exactly like real boom-and-bust and is entirely an artefact of the arithmetic.
    for (let i = 1; i <= steps; i += 1) {
      const k1 = derivative(size)
      const k2 = derivative(size + (dt * k1) / 2)
      const k3 = derivative(size + (dt * k2) / 2)
      const k4 = derivative(size + dt * k3)
      const next = size + (dt * (k1 + 2 * k2 + 2 * k3 + k4)) / 6
      if (!Number.isFinite(next)) {
        warnings.push(`The population exceeded what a number can hold at time ${((i * duration) / steps).toPrecision(4)}. Exponential growth does this quickly, which is the point.`)
        break
      }
      size = Math.max(0, next)
      trace.push({ time: (i * duration) / steps, size, growthRate: derivative(size) })
    }
  }

  const doublingTime = model === 'exponential' && growthRate > 0 ? Math.LN2 / growthRate : null
  if (model !== 'exponential' && growthRate > 0) {
    warnings.push(
      'A doubling time only exists for exponential growth. Under every model with a carrying capacity the growth rate falls as the population rises, so there is no single doubling time — the first doubling is fast and the last never happens.'
    )
  }

  let fastest: GrowthReport['fastestGrowthAt'] = null
  if (model === 'logistic' && growthRate > 0) {
    const half = capacity / 2
    const reached = trace.find((one) => one.size >= half)
    fastest = { size: half, time: reached?.time ?? Number.NaN, rate: (growthRate * capacity) / 4 }
    if (reached === undefined) {
      warnings.push(`The population never reached half the carrying capacity inside ${duration}, so the point of fastest growth is still ahead.`)
    }
  }

  let beyondMeaning = false
  if (model === 'exponential' && growthRate > 0) {
    const multiplier = initialSize > 0 ? size / initialSize : Number.POSITIVE_INFINITY
    if (multiplier > 1e6) {
      beyondMeaning = true
      warnings.push(
        `The population grew ${multiplier.toPrecision(3)}-fold. No real population does that without hitting something — food, space, disease, or predators. The arithmetic is exact and the biology stopped applying long before the end of this projection.`
      )
    }
  }
  if (model !== 'exponential' && size > capacity * 1.01) {
    warnings.push(`The population ended ${((size / capacity - 1) * 100).toFixed(1)}% above the carrying capacity, which happens in the overshooting models and is real behaviour for them.`)
  }

  const equilibrium = model === 'exponential' ? (growthRate === 0 ? initialSize : null) : growthRate > 0 ? capacity : 0

  return {
    model,
    finalSize: size,
    equilibrium,
    doublingTime,
    fastestGrowthAt: fastest,
    beyondMeaning,
    trace: Object.freeze(thin(trace, ECOLOGY_LIMITS.traceSamples)),
    assumptions: Object.freeze([
      model === 'exponential'
        ? 'Unlimited resources. Nothing constrains the population at any size, which is true for a short while and never for long.'
        : `A fixed carrying capacity of ${capacity}. A real capacity changes with the weather, the season and what else lives there.`,
      discrete
        ? 'Discrete generations: the whole population reproduces at once and the step size is one generation.'
        : 'Continuous reproduction and instant response to density. A real population responds with a lag, and a lag is what turns smooth approach into oscillation.',
      'No age structure. Every individual is identical and reproduces at the same rate, whereas a real population has juveniles that do not breed and old individuals that no longer do.',
      'No environmental variation, no immigration, no emigration, and no genetic change.',
      'A deterministic model. A small population is dominated by chance, and this says nothing about the probability of extinction.'
    ]),
    notes: Object.freeze([
      `${model} growth from ${initialSize} at rate ${growthRate} over ${duration} reaches ${size.toPrecision(6)}.`,
      doublingTime === null
        ? 'No doubling time applies to this model.'
        : `Doubling time ${doublingTime.toPrecision(5)}. That is ln(2) over the growth rate, and it is constant only because nothing constrains the population.`,
      fastest === null
        ? ''
        : `Growth is fastest at half the carrying capacity (${fastest.size}), where the rate is rK/4 = ${fastest.rate.toPrecision(5)}. That half-capacity point is exact and it is why maximum sustainable yield is calculated there.`,
      equilibrium === null
        ? 'This model has no equilibrium: exponential growth either rises forever or falls to zero.'
        : `The population settles at ${equilibrium}.`,
      discrete
        ? 'Difference equations were stepped once per time unit as written, so the step size is the generation length.'
        : 'Integrated with fourth-order Runge-Kutta. A coarse Euler step overshoots the capacity and oscillates, which looks exactly like real boom-and-bust and is entirely an artefact.'
    ].filter((one) => one !== '')),
    warnings: Object.freeze(warnings)
  }
}

export interface PredatorPreyReport {
  /** Both populations over time. */
  trace: readonly { time: number; prey: number; predator: number }[]
  /** Where both stop changing. */
  equilibrium: { prey: number; predator: number } | null
  /** The period of the cycle, measured from the trace rather than assumed. */
  cyclePeriod: number | null
  /** How far each swings. */
  range: { prey: { low: number; high: number }; predator: { low: number; high: number } }
  /** Whether either population effectively went extinct. */
  extinction: { prey: boolean; predator: boolean; at: number | null }
  /** Whether prey peaks lead predator peaks, which is the signature of the interaction. */
  predatorLag: number | null
  model: string
  assumptions: readonly string[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Lotka-Volterra predator and prey, with an optional carrying capacity on the prey.
 *
 * The cycle period and the predator lag are measured from the integrated trace rather than taken from the
 * linearised formula, because the classic small-oscillation period only holds near the equilibrium and the real
 * cycles in this model are far from sinusoidal at large amplitude.
 *
 * The bare model's neutral cycles are an artefact worth knowing about: without a prey carrying capacity the
 * amplitude is set entirely by the starting condition and never decays, which no real system does. Adding a
 * capacity makes the cycles damp to the equilibrium, which is why the bare model is a teaching device rather than
 * a description of anything.
 */
export function predatorPrey(input: {
  /** Starting populations. */
  prey: number
  predator: number
  /** Prey growth rate. */
  preyGrowth: number
  /** Rate at which predators eat prey, per predator per prey. */
  predationRate: number
  /** Predator death rate. */
  predatorDeath: number
  /** Efficiency at which eaten prey becomes new predators. */
  conversionRate: number
  /** Optional carrying capacity on the prey, which is what makes the cycles damp. */
  preyCapacity?: number
  duration: number
  steps?: number
}): PredatorPreyReport | EcologyError {
  const { prey, predator, preyGrowth, predationRate, predatorDeath, conversionRate, duration } = input
  for (const [name, value] of Object.entries({ prey, predator, preyGrowth, predationRate, predatorDeath, conversionRate, duration })) {
    if (!Number.isFinite(value)) return fail('invalid-argument', `"${name}" has to be a number.`)
    if (value < 0) return fail('out-of-range', `"${name}" cannot be negative.`)
  }
  if (duration <= 0) return fail('out-of-range', 'The duration has to be positive.')
  if (predationRate === 0) {
    return fail(
      'invalid-argument',
      'With a predation rate of zero the two populations do not interact at all: the prey grow on their own and the predators starve. That is two independent exponentials rather than a predator-prey system.'
    )
  }
  if (conversionRate === 0) {
    return fail('invalid-argument', 'With a conversion rate of zero, eating prey produces no predators, so the predators die out regardless of how much they eat.')
  }
  const steps = Math.max(100, Math.round(input.steps ?? 20_000))
  if (steps > ECOLOGY_LIMITS.steps) return fail('too-many', `That is ${steps} steps; this handles up to ${ECOLOGY_LIMITS.steps}.`)

  const capacity = input.preyCapacity
  if (capacity !== undefined && (!Number.isFinite(capacity) || capacity <= 0)) {
    return fail('out-of-range', 'The prey carrying capacity has to be positive.')
  }

  const warnings: string[] = []
  const dt = duration / steps

  const rates = (n: number, p: number): [number, number] => {
    const density = capacity === undefined ? 1 : 1 - n / capacity
    return [preyGrowth * n * density - predationRate * n * p, conversionRate * predationRate * n * p - predatorDeath * p]
  }

  const trace: { time: number; prey: number; predator: number }[] = []
  let n = prey
  let p = predator
  trace.push({ time: 0, prey: n, predator: p })
  // A population below this is treated as gone. Under a continuous model nothing ever reaches zero, and a
  // fractional individual is not a population.
  const extinctionFloor = 1e-6 * Math.max(1, prey, predator)
  let extinctAt: number | null = null
  let preyGone = false
  let predatorGone = false

  for (let i = 1; i <= steps; i += 1) {
    const [a1, b1] = rates(n, p)
    const [a2, b2] = rates(n + (dt * a1) / 2, p + (dt * b1) / 2)
    const [a3, b3] = rates(n + (dt * a2) / 2, p + (dt * b2) / 2)
    const [a4, b4] = rates(n + dt * a3, p + dt * b3)
    const nextN = n + (dt * (a1 + 2 * a2 + 2 * a3 + a4)) / 6
    const nextP = p + (dt * (b1 + 2 * b2 + 2 * b3 + b4)) / 6
    if (!Number.isFinite(nextN) || !Number.isFinite(nextP)) {
      warnings.push(`The integration went non-finite at time ${(i * dt).toPrecision(4)}, which means the rates are too large for this step size.`)
      break
    }
    n = Math.max(0, nextN)
    p = Math.max(0, nextP)
    if (!preyGone && n < extinctionFloor) {
      preyGone = true
      extinctAt = i * dt
    }
    if (!predatorGone && p < extinctionFloor) {
      predatorGone = true
      if (extinctAt === null) extinctAt = i * dt
    }
    trace.push({ time: i * dt, prey: n, predator: p })
  }

  if (preyGone) {
    warnings.push(
      `The prey fell below one part in a million of the starting scale at time ${(extinctAt as number).toPrecision(4)}. In a continuous model a population never reaches zero and recovers from a fraction of an individual, which is nonsense — a real population that small is gone.`
    )
  }
  if (predatorGone && !preyGone) {
    warnings.push(`The predators fell to effectively zero at time ${(extinctAt as number).toPrecision(4)}, after which the prey grow unchecked.`)
  }

  // The equilibrium, from setting both rates to zero.
  let equilibrium: PredatorPreyReport['equilibrium'] = null
  if (capacity === undefined) {
    const preyStar = predatorDeath / (conversionRate * predationRate)
    const predatorStar = preyGrowth / predationRate
    equilibrium = { prey: preyStar, predator: predatorStar }
  } else {
    const preyStar = predatorDeath / (conversionRate * predationRate)
    if (preyStar < capacity) {
      const predatorStar = (preyGrowth * (1 - preyStar / capacity)) / predationRate
      equilibrium = { prey: preyStar, predator: predatorStar }
    } else {
      equilibrium = { prey: capacity, predator: 0 }
      warnings.push(
        `The prey level the predators need to break even (${preyStar.toPrecision(4)}) is above the prey carrying capacity (${capacity}). The predators cannot sustain themselves at any prey density the environment allows, so they die out and the prey settle at capacity.`
      )
    }
  }

  // The period, measured from the trace by finding successive prey peaks.
  const peaks: number[] = []
  for (let i = 1; i < trace.length - 1; i += 1) {
    if (trace[i].prey > trace[i - 1].prey && trace[i].prey >= trace[i + 1].prey) peaks.push(trace[i].time)
  }
  const period = peaks.length >= 2 ? (peaks[peaks.length - 1] - peaks[0]) / (peaks.length - 1) : null
  if (period === null && !preyGone && !predatorGone) {
    warnings.push(`Fewer than two prey peaks appeared inside ${duration}, so no period could be measured. Running longer would give one.`)
  }

  // The predator lag: how far the nearest predator peak sits after a prey peak.
  let lag: number | null = null
  if (peaks.length >= 1) {
    const predatorPeaks: number[] = []
    for (let i = 1; i < trace.length - 1; i += 1) {
      if (trace[i].predator > trace[i - 1].predator && trace[i].predator >= trace[i + 1].predator) predatorPeaks.push(trace[i].time)
    }
    const after = predatorPeaks.find((one) => one > peaks[0])
    if (after !== undefined) lag = after - peaks[0]
  }

  const preyValues = trace.map((one) => one.prey)
  const predatorValues = trace.map((one) => one.predator)

  if (capacity === undefined) {
    warnings.push(
      'Without a prey carrying capacity the cycles are neutrally stable: the amplitude is set entirely by the starting condition and never decays. No real system does that, and it is why the bare Lotka-Volterra model is a teaching device rather than a description of anything. Adding a capacity makes the cycles damp to the equilibrium.'
    )
  }

  return {
    trace: Object.freeze(thin(trace, ECOLOGY_LIMITS.traceSamples)),
    equilibrium,
    cyclePeriod: period,
    range: {
      prey: { low: Math.min(...preyValues), high: Math.max(...preyValues) },
      predator: { low: Math.min(...predatorValues), high: Math.max(...predatorValues) }
    },
    extinction: { prey: preyGone, predator: predatorGone, at: extinctAt },
    predatorLag: lag,
    model:
      capacity === undefined
        ? 'Lotka-Volterra as originally written, with unlimited prey growth in the absence of predators.'
        : 'Lotka-Volterra with a logistic ceiling on the prey, which makes the cycles damp to the equilibrium instead of persisting forever.',
    assumptions: Object.freeze([
      'One predator and one prey, with no other food and no other predators. A real food web has both, and that is what usually stabilises it.',
      'Predation is proportional to the product of the two populations, which assumes predators never become satiated and never have trouble finding prey at low density.',
      'No spatial structure. Prey cannot hide in a refuge, and a refuge is one of the main things that prevents a real collapse.',
      'No age structure, no time lag between eating and reproducing, and no environmental variation.',
      'Deterministic. A cycle whose low point is a handful of individuals will in reality go extinct by chance, and this model recovers from it every time.'
    ]),
    notes: Object.freeze([
      `Prey went from ${prey} to ${n.toPrecision(5)} and predators from ${predator} to ${p.toPrecision(5)} over ${duration}.`,
      equilibrium === null
        ? 'No equilibrium.'
        : `The equilibrium sits at ${equilibrium.prey.toPrecision(5)} prey and ${equilibrium.predator.toPrecision(5)} predators. Note what sets each: the prey level is fixed by the predators' death and conversion rates, and the predator level by the prey's growth rate — each population's equilibrium is controlled by the other's parameters, which is deeply counter-intuitive and is the model's most famous result.`,
      period === null ? 'No cycle period was measurable from this run.' : `The cycle period measured from the trace is ${period.toPrecision(5)}.`,
      lag === null ? '' : `Predator peaks follow prey peaks by about ${lag.toPrecision(4)}, which is a quarter of a cycle and is the signature of the interaction.`,
      'Integrated with fourth-order Runge-Kutta, and both the period and the lag are measured from the trace rather than taken from the small-oscillation formula, which only holds near the equilibrium.'
    ].filter((one) => one !== '')),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- estimating a population

export interface MarkRecaptureReport {
  /** The simple Lincoln-Petersen estimate. */
  lincolnPetersen: number
  /** The Chapman estimate, which is less biased for a small sample and is the one to quote. */
  chapman: number
  /** The 95% confidence interval on the Chapman estimate. */
  interval: { low: number; high: number }
  /** The standard error. */
  standardError: number
  /** What fraction of the estimated population was actually handled. */
  sampledFraction: number
  /** Whether the sample supports an estimate at all. */
  reliable: boolean
  assumptions: readonly string[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Estimate a population from a mark-and-recapture sample.
 *
 * The Chapman estimator is reported as the answer rather than Lincoln-Petersen, because Lincoln-Petersen is biased
 * upwards for small samples and becomes infinite when no marked animal is recaptured — which happens often enough
 * in real field work to matter. Chapman adds one to each count and is very nearly unbiased.
 *
 * Every assumption here is a way the estimate goes wrong in a specific direction, so they are listed with the
 * direction: marks that fall off inflate the estimate, marked animals that are easier to catch deflate it, and
 * animals that were born or died between the two samples mean the estimate refers to no single population.
 */
export function markRecapture(input: {
  /** How many were caught and marked in the first sample. */
  marked: number
  /** How many were caught in the second sample. */
  recaptureSample: number
  /** How many of the second sample carried a mark. */
  recapturedMarked: number
}): MarkRecaptureReport | EcologyError {
  const { marked, recaptureSample, recapturedMarked } = input
  for (const [name, value] of Object.entries({ marked, recaptureSample, recapturedMarked })) {
    if (!Number.isInteger(value) || value < 0) return fail('invalid-argument', `"${name}" has to be a whole number of animals, zero or more.`)
  }
  if (marked === 0 || recaptureSample === 0) return fail('invalid-argument', 'Both samples have to contain at least one animal.')
  if (recapturedMarked > recaptureSample) {
    return fail(
      'invalid-argument',
      `${recapturedMarked} marked animals were found in a second sample of ${recaptureSample}. The recaptured marked animals are a subset of the second sample, so this cannot exceed it.`
    )
  }
  if (recapturedMarked > marked) {
    return fail(
      'invalid-argument',
      `${recapturedMarked} marked animals were recaptured but only ${marked} were ever marked. More marks came back than went out, which means either a counting error or that something else in the population carries a similar mark.`
    )
  }

  const warnings: string[] = []
  const lincolnPetersen = recapturedMarked === 0 ? Number.POSITIVE_INFINITY : (marked * recaptureSample) / recapturedMarked
  const chapman = ((marked + 1) * (recaptureSample + 1)) / (recapturedMarked + 1) - 1

  if (recapturedMarked === 0) {
    warnings.push(
      'No marked animals were recaptured. The Lincoln-Petersen estimate divides by that count, so it is infinite — which is why Chapman is the estimator being quoted. With zero recaptures the Chapman value is a lower bound at best, and the honest answer is that the population is larger than the sampling could resolve.'
    )
  }
  if (recapturedMarked > 0 && recapturedMarked < 7) {
    warnings.push(
      `Only ${recapturedMarked} marked animal${recapturedMarked === 1 ? ' was' : 's were'} recaptured. Below about seven the confidence interval is so wide that the estimate carries almost no information — the usual rule of thumb is to keep sampling until at least ten come back.`
    )
  }

  // The Seber variance for the Chapman estimator.
  const variance =
    ((marked + 1) * (recaptureSample + 1) * (marked - recapturedMarked) * (recaptureSample - recapturedMarked)) /
    (Math.pow(recapturedMarked + 1, 2) * (recapturedMarked + 2))
  const standardError = Math.sqrt(Math.max(0, variance))
  const low = Math.max(marked, chapman - 1.96 * standardError)
  const high = chapman + 1.96 * standardError

  const fraction = chapman > 0 ? (marked + recaptureSample - recapturedMarked) / chapman : 1
  if (fraction > 0.5) {
    warnings.push(
      `The two samples together handled about ${(fraction * 100).toFixed(0)}% of the estimated population. At that fraction a near-total count would be more accurate than an estimate, and the estimator's assumptions matter much less than simply counting.`
    )
  }

  return {
    lincolnPetersen,
    chapman,
    interval: { low, high },
    standardError,
    sampledFraction: fraction,
    reliable: recapturedMarked >= 7,
    assumptions: Object.freeze([
      'The population did not change between the samples — nothing was born, died, arrived or left. If it did, the estimate refers to no single population.',
      'No mark was lost. A mark that falls off makes an animal look unmarked, which inflates the estimate.',
      'Marked animals mix back in completely and are no easier or harder to catch. Trap-happy animals deflate the estimate; trap-shy ones inflate it.',
      'Every animal had the same chance of being caught. Where some parts of the range were not sampled, the estimate is of the sampled area rather than the whole population.',
      'Every mark was noticed. A missed mark has the same effect as a lost one.'
    ]),
    notes: Object.freeze([
      `Chapman estimate ${chapman.toFixed(1)} animals, 95% interval ${low.toFixed(1)} to ${high.toFixed(1)}.`,
      recapturedMarked === 0
        ? 'The Lincoln-Petersen estimate is infinite with no recaptures.'
        : `Lincoln-Petersen gives ${lincolnPetersen.toFixed(1)}, which is biased upwards for a small sample and is shown only for comparison.`,
      'Chapman is quoted rather than Lincoln-Petersen because it is very nearly unbiased and stays finite when no marked animal comes back — which happens often enough in real field work to matter.',
      `The two samples handled about ${(fraction * 100).toFixed(1)}% of the estimated population.`,
      'The interval is from the Seber variance and is symmetric, which understates the upper tail when few marks came back. A profile-likelihood interval would be wider on the high side.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface DiversityReport {
  /** How many species were seen. */
  richness: number
  /** The total number of individuals. */
  total: number
  /** Shannon entropy, in nats. */
  shannon: number
  /** Shannon evenness: the entropy as a fraction of its maximum. */
  evenness: number
  /** Simpson's index — the chance two random individuals are different species. */
  simpson: number
  /** The inverse, which is an effective species count. */
  inverseSimpson: number
  /** Berger-Parker: the share of the most abundant species. */
  bergerParker: number
  /** Effective species numbers, which are the figures that compare between communities. */
  effectiveSpecies: { order0: number; order1: number; order2: number }
  /** Chao1, an estimate of how many species were missed. */
  chao1: { estimate: number; unseenEstimate: number; singletons: number; doubletons: number } | null
  /** Each species and its share. */
  shares: readonly { name: string; count: number; share: number }[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Every standard diversity index at once, plus an estimate of the species that were missed.
 *
 * They are all reported together because they weight rarity differently and two communities can rank in opposite
 * orders under Shannon and Simpson. Neither ranking is wrong — richness ignores abundance entirely, Shannon weights
 * by log-abundance, and Simpson is dominated by the common species. Reporting one alone hides that a choice was
 * made.
 *
 * The effective species numbers are the figures that actually compare. An index value of 2.3 nats means nothing on
 * its own; the equivalent of 10 equally common species is a statement anyone can hold in mind, and it is what makes
 * "twice as diverse" a meaningful phrase.
 *
 * Chao1 is the honest part: it estimates how many species the sampling missed, from the number seen exactly once.
 * When most species are singletons, most of the community was not sampled, and every index above is an
 * underestimate.
 */
export function diversity(input: {
  /** Counts per species. */
  counts: readonly { name: string; count: number }[]
}): DiversityReport | EcologyError {
  const counts = input.counts
  if (!Array.isArray(counts) || counts.length === 0) return fail('invalid-argument', 'Give a count for at least one species.')
  if (counts.length > ECOLOGY_LIMITS.species) return fail('too-many', `That is ${counts.length} species; this handles up to ${ECOLOGY_LIMITS.species}.`)

  const seen = new Set<string>()
  for (const [i, entry] of counts.entries()) {
    if (typeof entry.name !== 'string' || entry.name.trim() === '') return fail('invalid-argument', `Species ${i + 1} has no name.`)
    if (!Number.isFinite(entry.count) || entry.count < 0) return fail('out-of-range', `"${entry.name}" has a count that is negative or not a number.`)
    const key = entry.name.trim().toLowerCase()
    if (seen.has(key)) {
      return fail('invalid-argument', `"${entry.name}" appears twice. Two rows for one species would double-count it, so they have to be added together first.`)
    }
    seen.add(key)
  }

  const present = counts.filter((one) => one.count > 0)
  if (present.length === 0) return fail('invalid-argument', 'Every count is zero, so no community was sampled.')
  const total = present.reduce((sum, one) => sum + one.count, 0)
  const warnings: string[] = []
  const zeroed = counts.length - present.length
  if (zeroed > 0) {
    warnings.push(`${zeroed} species had a count of zero and were left out. A species absent from a sample is not part of that sample's diversity, though it may well be part of the community.`)
  }

  const shares = present
    .map((one) => ({ name: one.name, count: one.count, share: one.count / total }))
    .sort((a, b) => b.count - a.count)

  const shannon = -shares.reduce((sum, one) => sum + one.share * Math.log(one.share), 0) + 0
  const richness = shares.length
  const evenness = richness <= 1 ? (richness === 1 ? 1 : 0) : shannon / Math.log(richness)
  const simpsonSum = shares.reduce((sum, one) => sum + one.share * one.share, 0)
  const simpson = 1 - simpsonSum
  const inverseSimpson = simpsonSum === 0 ? Number.POSITIVE_INFINITY : 1 / simpsonSum
  const bergerParker = shares[0].share

  // Chao1, from the species seen exactly once and exactly twice. Only meaningful for integer counts of
  // individuals — it is a statement about sampling and a fractional count is not a sampling outcome.
  let chao1: DiversityReport['chao1'] = null
  if (present.every((one) => Number.isInteger(one.count))) {
    const singletons = present.filter((one) => one.count === 1).length
    const doubletons = present.filter((one) => one.count === 2).length
    // The bias-corrected form, which stays finite when nothing was seen exactly twice.
    const unseen =
      doubletons > 0
        ? (singletons * singletons) / (2 * doubletons)
        : (singletons * (singletons - 1)) / 2
    chao1 = { estimate: richness + unseen, unseenEstimate: unseen, singletons, doubletons }
    if (singletons / richness > 0.5) {
      warnings.push(
        `${singletons} of ${richness} species were seen exactly once. When most species are singletons, most of the community was not sampled — Chao1 estimates about ${unseen.toFixed(1)} species were missed, so every index here is an underestimate of the real diversity.`
      )
    }
  } else {
    warnings.push(
      'The counts are not whole numbers, so Chao1 was not computed. It estimates missed species from how many were seen exactly once, which is a statement about sampling that a fractional count cannot make. Biomass or cover values are legitimate diversity data and simply do not support it.'
    )
  }

  if (total < 30) {
    warnings.push(`Only ${total} individuals were counted. Every index here is strongly biased downwards at that sample size, and richness especially so, because rare species are simply absent from a small sample.`)
  }
  if (richness === 1) {
    warnings.push('One species. Shannon is zero, Simpson is zero, and evenness is defined as 1 by convention — a single-species community is perfectly even and has no diversity, which is consistent rather than contradictory.')
  }

  return {
    richness,
    total,
    shannon,
    evenness,
    simpson,
    inverseSimpson,
    bergerParker,
    effectiveSpecies: { order0: richness, order1: Math.exp(shannon), order2: inverseSimpson },
    chao1,
    shares: Object.freeze(shares),
    notes: Object.freeze([
      `${richness} species among ${total} individuals. Shannon ${shannon.toFixed(5)} nats, evenness ${evenness.toFixed(5)}, Simpson ${simpson.toFixed(5)}, inverse Simpson ${inverseSimpson.toFixed(5)}.`,
      `As effective species numbers: ${richness} counting every species equally, ${Math.exp(shannon).toFixed(3)} weighting by Shannon, ${inverseSimpson.toFixed(3)} weighting by Simpson. Those are the figures that compare between communities — "2.3 nats" means nothing alone, "the equivalent of 10 equally common species" does.`,
      `The most abundant species is ${(bergerParker * 100).toFixed(2)}% of the sample. Simpson's index is the chance that two individuals picked at random are different species, which is why it is dominated by the common ones.`,
      'Every index is reported because they weight rarity differently, and two communities can rank in opposite orders under Shannon and Simpson without either ranking being wrong.',
      chao1 === null
        ? 'No Chao1 estimate.'
        : `Chao1 estimates ${chao1.estimate.toFixed(1)} species in total, about ${chao1.unseenEstimate.toFixed(1)} of them unseen, from ${chao1.singletons} singleton${chao1.singletons === 1 ? '' : 's'} and ${chao1.doubletons} doubleton${chao1.doubletons === 1 ? '' : 's'}.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface FoodWebReport {
  /** Each level, the energy reaching it, and what fraction of the original that is. */
  levels: readonly { level: number; name: string; energy: number; fractionOfBase: number; efficiency: number }[]
  /** How many levels the energy supports before it runs out. */
  supportedLevels: number
  /** How much primary production one unit at the top requires. */
  baseRequired: number
  /** The efficiency that was actually used at each step. */
  efficiencyUsed: readonly number[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Energy up a food chain, level by level.
 *
 * The ten percent rule is used only when no efficiency is given, and it is labelled for what it is: a
 * mid-twentieth-century rule of thumb from a handful of lake studies. Real transfer efficiencies range from about
 * one percent to over forty, and they are systematically higher in aquatic systems than on land — which is why the
 * ocean supports food chains several levels longer than any terrestrial one.
 *
 * The number worth seeing is how much primary production a unit at the top requires. At ten percent per step, a
 * fourth-level predator needs a thousand times its own energy in plants, and that single figure explains why apex
 * predators are rare, why they are the first thing lost when habitat shrinks, and why eating lower down the chain
 * feeds more people from the same land.
 */
export function foodChain(input: {
  /** Energy or biomass entering at the bottom. */
  primaryProduction: number
  /** How many levels to compute. */
  levels: number
  /** Efficiency per step, as a fraction. One value for all steps, or one per step. */
  efficiency?: number | readonly number[]
  /** Names for the levels. */
  names?: readonly string[]
}): FoodWebReport | EcologyError {
  const { primaryProduction, levels } = input
  if (!Number.isFinite(primaryProduction) || primaryProduction <= 0) return fail('invalid-argument', 'Primary production has to be positive.')
  if (!Number.isInteger(levels) || levels < 1 || levels > 12) return fail('out-of-range', 'The number of levels has to be a whole number between 1 and 12. No real food chain exceeds about six.')

  const warnings: string[] = []
  let efficiencies: number[]
  if (input.efficiency === undefined) {
    efficiencies = new Array(levels - 1).fill(0.1)
    warnings.push(
      'No efficiency was given, so the ten percent rule was used. That is a mid-twentieth-century rule of thumb from a handful of lake studies, not a law — real transfer efficiencies range from about 1% to over 40%, and they are systematically higher in water than on land, which is why ocean food chains run several levels longer.'
    )
  } else if (typeof input.efficiency === 'number') {
    if (!Number.isFinite(input.efficiency) || input.efficiency <= 0 || input.efficiency > 1) {
      return fail('out-of-range', 'An efficiency is a fraction above 0 and at most 1. An efficiency above 1 would mean a level contains more energy than it ate.')
    }
    efficiencies = new Array(levels - 1).fill(input.efficiency)
  } else {
    if (!Array.isArray(input.efficiency)) return fail('invalid-argument', 'The efficiency is a single fraction or a list of them, one per step.')
    if (input.efficiency.length < levels - 1) {
      return fail(
        'invalid-argument',
        `${levels} levels need ${levels - 1} transfer efficiencies and ${input.efficiency.length} ${input.efficiency.length === 1 ? 'was' : 'were'} given.`
      )
    }
    for (const [i, value] of input.efficiency.entries()) {
      if (!Number.isFinite(value) || value <= 0 || value > 1) {
        return fail('out-of-range', `Efficiency ${i + 1} is ${value}, and an efficiency is a fraction above 0 and at most 1.`)
      }
    }
    efficiencies = input.efficiency.slice(0, levels - 1)
  }

  const defaultNames = ['producers', 'primary consumers', 'secondary consumers', 'tertiary consumers', 'quaternary consumers']
  const nameFor = (index: number): string => {
    if (input.names !== undefined && index < input.names.length && typeof input.names[index] === 'string') return input.names[index]
    return index < defaultNames.length ? defaultNames[index] : `level ${index + 1}`
  }

  const out: FoodWebReport['levels'][number][] = []
  let energy = primaryProduction
  let supported = 0
  for (let i = 0; i < levels; i += 1) {
    const efficiency = i === 0 ? 1 : efficiencies[i - 1]
    out.push({ level: i + 1, name: nameFor(i), energy, fractionOfBase: energy / primaryProduction, efficiency })
    // A level holding less than a millionth of the base is not a level anything lives at.
    if (energy / primaryProduction >= 1e-6) supported = i + 1
    if (i < levels - 1) energy *= efficiencies[i]
  }

  const product = efficiencies.reduce((value, one) => value * one, 1)
  const baseRequired = product === 0 ? Number.POSITIVE_INFINITY : 1 / product

  if (levels > 5) {
    warnings.push(
      `${levels} levels were asked for. Real food chains rarely exceed five and almost never six, precisely because of this arithmetic — at ten percent per step a sixth level receives a hundred-thousandth of the primary production, which cannot support a viable population of anything.`
    )
  }
  if (supported < levels) {
    warnings.push(`Energy falls below a millionth of the base by level ${supported + 1}, so only ${supported} level${supported === 1 ? '' : 's'} is meaningfully supported.`)
  }

  return {
    levels: Object.freeze(out),
    supportedLevels: supported,
    baseRequired,
    efficiencyUsed: Object.freeze(efficiencies),
    notes: Object.freeze([
      `${primaryProduction} at the bottom leaves ${out[out.length - 1].energy.toPrecision(5)} at level ${levels} — ${(out[out.length - 1].fractionOfBase * 100).toPrecision(4)}% of the base.`,
      `One unit at level ${levels} requires ${baseRequired.toPrecision(5)} units of primary production. That single figure explains why apex predators are rare, why they are the first thing lost when habitat shrinks, and why eating lower down the chain feeds more people from the same land.`,
      `Efficiencies used: ${efficiencies.map((one) => (one * 100).toFixed(1) + '%').join(', ')}.`,
      'The lost energy is not wasted — most of it went into respiration, which is what being alive costs. It left the chain as heat rather than going uneaten.',
      'This counts energy, not individuals. A pyramid of numbers can be inverted — one tree supports thousands of insects — while a pyramid of energy never can, because energy is conserved.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface LifeTableReport {
  /** Each age class with its survival and reproduction. */
  rows: readonly {
    age: number
    survivors: number
    survivorship: number
    /** The chance of surviving this class, given you reached it. */
    survivalRate: number
    mortalityRate: number
    fecundity: number
    /** Survivorship times fecundity, which is this class's contribution. */
    contribution: number
    /** Life expectancy remaining at the start of this class. */
    remainingExpectancy: number
  }[]
  /** Net reproductive rate: expected offspring per newborn over a whole lifetime. */
  netReproductiveRate: number
  /** Mean generation time. */
  generationTime: number
  /** The intrinsic rate of increase, solved from the Euler-Lotka equation rather than approximated. */
  intrinsicRate: number
  /** Whether the population replaces itself. */
  replacing: boolean
  /** Which survivorship shape this resembles. */
  survivorshipType: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * A life table: survival, reproduction, and whether the population replaces itself.
 *
 * The intrinsic rate of increase is solved from the Euler-Lotka equation by bisection, not approximated as
 * ln(R0)/T. That approximation is standard and it is wrong by ten percent or more whenever reproduction is spread
 * unevenly across ages, which is most of the time — and it is wrong in the direction of making a declining
 * population look stable.
 *
 * The net reproductive rate is the number that decides it: above one the population grows, below one it shrinks,
 * and at exactly one it replaces itself. A rate of 0.95 sounds close to stable and halves the population in about
 * fourteen generations.
 */
export function lifeTable(input: {
  /** One row per age class, in order. */
  rows: readonly { age: number; survivors: number; fecundity: number }[]
}): LifeTableReport | EcologyError {
  const rows = input.rows
  if (!Array.isArray(rows) || rows.length < 2) return fail('insufficient-data', 'A life table needs at least two age classes.')
  if (rows.length > 1_000) return fail('too-many', `That is ${rows.length} age classes; this handles up to 1000.`)

  for (const [i, row] of rows.entries()) {
    if (!Number.isFinite(row.age) || !Number.isFinite(row.survivors) || !Number.isFinite(row.fecundity)) {
      return fail('invalid-argument', `Row ${i + 1} has a value that is not a number.`)
    }
    if (row.survivors < 0) return fail('out-of-range', `Row ${i + 1} has a negative number of survivors.`)
    if (row.fecundity < 0) return fail('out-of-range', `Row ${i + 1} has a negative fecundity.`)
    if (i > 0) {
      if (row.age <= rows[i - 1].age) return fail('invalid-argument', `Age ${row.age} does not come after ${rows[i - 1].age}. The rows have to be in increasing order of age.`)
      if (row.survivors > rows[i - 1].survivors) {
        return fail(
          'invalid-argument',
          `Age ${row.age} has ${row.survivors} survivors, more than the ${rows[i - 1].survivors} at age ${rows[i - 1].age}. Survivors can only fall — a cohort does not gain members. If immigration was meant, a life table is the wrong tool.`
        )
      }
    }
  }
  const initial = rows[0].survivors
  if (initial <= 0) return fail('invalid-argument', 'The first age class has no survivors, so there is no cohort to follow.')

  const warnings: string[] = []
  const out: LifeTableReport['rows'][number][] = []
  let netRate = 0
  let weightedAge = 0

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const survivorship = row.survivors / initial
    const next = i + 1 < rows.length ? rows[i + 1].survivors : 0
    const survivalRate = row.survivors === 0 ? 0 : next / row.survivors
    const contribution = survivorship * row.fecundity
    netRate += contribution
    weightedAge += contribution * row.age
    // Life expectancy remaining: the average number of further classes lived, from this class on.
    let personTime = 0
    for (let j = i; j < rows.length; j += 1) {
      const after = j + 1 < rows.length ? rows[j + 1].survivors : 0
      personTime += (rows[j].survivors + after) / 2
    }
    out.push({
      age: row.age,
      survivors: row.survivors,
      survivorship,
      survivalRate,
      mortalityRate: 1 - survivalRate,
      fecundity: row.fecundity,
      contribution,
      remainingExpectancy: row.survivors === 0 ? 0 : personTime / row.survivors
    })
  }

  if (netRate === 0) {
    return fail(
      'no-solution',
      'Every fecundity is zero, so the cohort produces no offspring at all and no reproductive rate or generation time can be formed. A life table with no reproduction describes a cohort dying out, which is a survivorship curve rather than a population projection.'
    )
  }
  const generationTime = weightedAge / netRate

  // The Euler-Lotka equation, solved by bisection. Not the ln(R0)/T approximation, which is wrong by ten
  // percent or more when reproduction is spread unevenly across ages — and wrong in the direction of making a
  // declining population look stable.
  const eulerLotka = (r: number): number =>
    out.reduce((sum, row) => sum + Math.exp(-r * row.age) * row.survivorship * row.fecundity, 0) - 1

  let low = -5
  let high = 5
  let intrinsic = 0
  if (eulerLotka(low) < 0 || eulerLotka(high) > 0) {
    intrinsic = Math.log(netRate) / generationTime
    warnings.push(
      `The Euler-Lotka equation had no root between -5 and 5 per unit time, so the intrinsic rate fell back to the ln(R0)/T approximation of ${intrinsic.toPrecision(5)}. That approximation is wrong by ten percent or more when reproduction is spread unevenly across ages.`
    )
  } else {
    for (let i = 0; i < 300; i += 1) {
      const middle = (low + high) / 2
      if (eulerLotka(middle) > 0) low = middle
      else high = middle
    }
    intrinsic = (low + high) / 2
    const approximation = Math.log(netRate) / generationTime
    if (Math.abs(intrinsic - approximation) > Math.abs(intrinsic) * 0.1 && Math.abs(intrinsic) > 1e-6) {
      warnings.push(
        `The solved intrinsic rate is ${intrinsic.toPrecision(5)} against ${approximation.toPrecision(5)} from the usual ln(R0)/T approximation — a difference of ${(Math.abs(intrinsic - approximation) / Math.abs(intrinsic) * 100).toFixed(1)}%. The approximation is quoted everywhere and it breaks when reproduction is spread unevenly across ages.`
      )
    }
  }

  // The survivorship shape, judged from where mortality actually falls.
  // The three survivorship shapes are defined by the curvature of log survivorship against age, so that is what
  // is measured: the chord from the first age class to the last living one, and whether the classes in between sit
  // above it or below it. A Type II curve is a straight line on a log scale by definition, and comparing raw
  // numbers of deaths instead would call every exponential decline Type III, because a constant mortality *rate*
  // always kills more individuals early simply because more are alive.
  const living = out.filter((row) => row.survivors > 0)
  let survivorshipType =
    'Type II: mortality is roughly constant with age, so survivorship falls in a straight line on a log scale. Typical of many birds and small mammals.'
  if (living.length >= 3) {
    const first = living[0]
    const last = living[living.length - 1]
    const span = last.age - first.age
    const drop = Math.log(last.survivorship) - Math.log(first.survivorship)
    if (span > 0 && Math.abs(drop) > 1e-9) {
      let deviation = 0
      for (let i = 1; i < living.length - 1; i += 1) {
        const chord = Math.log(first.survivorship) + (drop * (living[i].age - first.age)) / span
        deviation += (Math.log(living[i].survivorship) - chord) / Math.abs(drop)
      }
      deviation /= living.length - 2
      if (deviation < -0.05) {
        survivorshipType =
          'Type III: most die young, and the few that survive live a long time. Typical of anything producing very many offspring with no parental care.'
      } else if (deviation > 0.05) {
        survivorshipType =
          'Type I: most survive to old age and mortality is concentrated at the end. Typical of large mammals with few, well-tended offspring.'
      }
    }
  }

  if (Math.abs(netRate - 1) < 0.05) {
    warnings.push(
      `A net reproductive rate of ${netRate.toFixed(4)} is within 5% of exact replacement, which is inside the error of almost any real life table. This population cannot be said to be growing or shrinking on this data.`
    )
  } else if (netRate < 1) {
    const generationsToHalve = Math.log(0.5) / Math.log(netRate)
    warnings.push(
      `A net reproductive rate of ${netRate.toFixed(4)} is below replacement. That sounds close to stable and it halves the population in about ${generationsToHalve.toFixed(1)} generations, which is ${(generationsToHalve * generationTime).toPrecision(4)} in the age units used here.`
    )
  }
  if (out[out.length - 1].survivors > 0) {
    warnings.push(
      `${out[out.length - 1].survivors} individuals are still alive in the last age class, so the cohort was not followed to the end. Everything here treats them as dying immediately after it, which understates both life expectancy and lifetime reproduction.`
    )
  }

  return {
    rows: Object.freeze(out),
    netReproductiveRate: netRate,
    generationTime,
    intrinsicRate: intrinsic,
    replacing: netRate >= 1,
    survivorshipType,
    notes: Object.freeze([
      `Net reproductive rate ${netRate.toFixed(5)} offspring per newborn over a lifetime, generation time ${generationTime.toPrecision(5)}, intrinsic rate of increase ${intrinsic.toPrecision(5)} per unit time.`,
      `Above 1 the population grows, below 1 it shrinks, at exactly 1 it replaces itself. This one ${netRate > 1 ? 'grows' : netRate < 1 ? 'shrinks' : 'replaces itself exactly'}.`,
      'The intrinsic rate was solved from the Euler-Lotka equation by bisection rather than approximated as ln(R0)/T. The approximation is standard and it is wrong whenever reproduction is spread unevenly across ages — in the direction of making a declining population look stable.',
      survivorshipType,
      `Life expectancy at the first age class is ${out[0].remainingExpectancy.toPrecision(4)} further classes.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const ECOLOGY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Continuous growth models are integrated with fourth-order Runge-Kutta, because a coarse Euler step overshoots the carrying capacity and oscillates — an artefact that looks exactly like real boom-and-bust.',
  'Every projection lists its assumptions: fixed capacity, no age structure, instant response to density, no environmental variation, and determinism.',
  'A projection that grows more than a millionfold is flagged as beyond where the biology applies, however exact the arithmetic.',
  'A doubling time is reported only for exponential growth, because every model with a ceiling has a growth rate that falls with size.',
  'Predator-prey cycle periods and lags are measured from the integrated trace, not taken from the small-oscillation formula that only holds near equilibrium.',
  'Populations falling below a millionth of the starting scale are called extinct, because a continuous model otherwise recovers from a fraction of an individual.',
  'Mark-recapture quotes the Chapman estimator, which stays finite with no recaptures, and lists each assumption with the direction it biases the estimate.',
  'Every diversity index is reported together with the effective species numbers, because they weight rarity differently and can rank two communities in opposite orders.',
  'Chao1 is computed only for whole-number counts, since it estimates missed species from singletons and a fractional count is not a sampling outcome.',
  'The ten percent rule is used only as a fallback and is labelled as a rule of thumb from a handful of lake studies, not a law.',
  'The intrinsic rate of increase is solved from the Euler-Lotka equation rather than approximated as ln(R0)/T.'
])
