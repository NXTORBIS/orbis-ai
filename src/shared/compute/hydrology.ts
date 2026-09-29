/**
 * Hydrology: where rain goes, how fast it gets there, and what the ground holds.
 *
 * The shared hydrology engine for Orbis Pages. Runoff is computed by a named method with its assumptions
 * attached, return periods are treated as probabilities rather than schedules, and a water balance that does not
 * close says so instead of being quietly adjusted until it does.
 *
 * ## Why a return period is not a schedule
 *
 * A "hundred-year flood" is a flood with a one-in-a-hundred chance of happening in any given year. It is not a
 * flood that happens once a century, two of them can arrive in consecutive years, and the chance of seeing one in
 * a thirty-year mortgage is 26% rather than 30%. This is the single most widely misunderstood idea in the subject
 * and every return-period result here states the actual probability alongside it.
 *
 * ## Why the method is named on every runoff result
 *
 * The rational method and the SCS curve number give different answers for the same storm on the same catchment,
 * and both are defensible within their own limits — the rational method for small paved areas, the curve number
 * for rural catchments over a whole storm. Neither is the truth. A number without its method attached cannot be
 * checked, argued with, or compared against the next one.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * rainfall     vs  runoff              -- what fell against what reached the stream
 * intensity    vs  depth               -- mm per hour against mm, and a storm has both
 * peak flow    vs  volume              -- what overtops the bank against what fills the reservoir
 * return period vs  a schedule         -- an annual probability against a timetable
 * porosity     vs  specific yield      -- the water it holds against the water it will give up
 * conductivity vs  velocity            -- the ability to transmit against how fast it moves
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface HydrologyError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'outside-model' | 'no-solution' | 'too-many' | 'not-balanced'
  message: string
}

export const isHydrologyError = (value: unknown): value is HydrologyError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: HydrologyError['error'], message: string): HydrologyError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const HYDROLOGY_LIMITS = Object.freeze({
  steps: 5000,
  segments: 200,
  samples: 2000
})

// ---------------------------------------------------------------- land cover and soil

export type SoilGroup = 'A' | 'B' | 'C' | 'D'

export const SOIL_GROUPS: readonly SoilGroup[] = Object.freeze(['A', 'B', 'C', 'D'])

export const SOIL_GROUP_FACTS: Readonly<Record<SoilGroup, { label: string; describe: string; minimumInfiltration: string }>> =
  Object.freeze({
    A: {
      label: 'Group A — sand and gravel',
      describe: 'Water goes straight through. Very little runs off even in heavy rain.',
      minimumInfiltration: 'Above 7.6 mm/h'
    },
    B: {
      label: 'Group B — sandy loam',
      describe: 'Drains well. Moderate runoff from a large storm.',
      minimumInfiltration: '3.8 to 7.6 mm/h'
    },
    C: {
      label: 'Group C — clay loam',
      describe: 'Drains slowly. A good deal runs off.',
      minimumInfiltration: '1.3 to 3.8 mm/h'
    },
    D: {
      label: 'Group D — clay, or shallow soil over rock',
      describe: 'Barely drains at all. Nearly everything runs off once it is wet.',
      minimumInfiltration: 'Below 1.3 mm/h'
    }
  })

/**
 * SCS curve numbers, from the USDA National Engineering Handbook Part 630, for average antecedent moisture.
 *
 * Held as data with its source because these are tabulated field values, not derived ones, and because the
 * antecedent moisture condition matters enormously — the same catchment can differ by twenty curve-number points
 * between dry and saturated, which roughly doubles the runoff.
 */
export const CURVE_NUMBERS: Readonly<Record<string, { label: string; byGroup: Readonly<Record<SoilGroup, number>> }>> =
  Object.freeze({
    'woodland-good': { label: 'Woodland, good cover', byGroup: { A: 30, B: 55, C: 70, D: 77 } },
    'woodland-poor': { label: 'Woodland, thin cover', byGroup: { A: 45, B: 66, C: 77, D: 83 } },
    'pasture-good': { label: 'Pasture, good condition', byGroup: { A: 39, B: 61, C: 74, D: 80 } },
    'pasture-poor': { label: 'Pasture, overgrazed', byGroup: { A: 68, B: 79, C: 86, D: 89 } },
    'row-crops': { label: 'Row crops, straight rows', byGroup: { A: 72, B: 81, C: 88, D: 91 } },
    'lawn-good': { label: 'Lawns and parks, good grass cover', byGroup: { A: 39, B: 61, C: 74, D: 80 } },
    'residential-quarter-acre': { label: 'Residential, quarter-acre lots (38% impervious)', byGroup: { A: 61, B: 75, C: 83, D: 87 } },
    'residential-eighth-acre': { label: 'Residential, eighth-acre lots (65% impervious)', byGroup: { A: 77, B: 85, C: 90, D: 92 } },
    commercial: { label: 'Commercial and business (85% impervious)', byGroup: { A: 89, B: 92, C: 94, D: 95 } },
    industrial: { label: 'Industrial (72% impervious)', byGroup: { A: 81, B: 88, C: 91, D: 93 } },
    paved: { label: 'Paved, with storm drains', byGroup: { A: 98, B: 98, C: 98, D: 98 } },
    'gravel-road': { label: 'Gravel road', byGroup: { A: 76, B: 85, C: 89, D: 91 } }
  })

export const CURVE_NUMBER_SOURCE =
  'USDA National Engineering Handbook Part 630 Chapter 9, Table 9-1, for average antecedent runoff condition (ARC II).'

export type MoistureCondition = 'dry' | 'average' | 'wet'

export interface RunoffReport {
  method: 'scs-curve-number'
  /** Millimetres. What fell. */
  rainfall: number
  /** Millimetres. What ran off. */
  runoff: number
  /** The fraction of the rain that ran off. Not a constant — it rises with storm size. */
  runoffCoefficient: number
  /** Millimetres. The rain absorbed before any runoff starts. */
  initialAbstraction: number
  /** Millimetres. How much the soil can hold once running. */
  potentialRetention: number
  curveNumber: number
  adjustedFor: MoistureCondition
  /** m³, when an area was given. */
  volume: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Runoff from a storm by the SCS curve number method.
 *
 * The runoff coefficient is reported but is not an input, because it is not a property of the catchment — it rises
 * with the size of the storm. The same field that sheds 10% of a small shower sheds 60% of a cloudburst. Treating
 * it as a fixed number, which the rational method does, is that method's main limitation.
 *
 * Antecedent moisture is adjusted for explicitly. A curve number quoted for average conditions applied to a
 * catchment that is already saturated understates the runoff by roughly half, and that is the situation floods
 * happen in.
 */
export function scsRunoff(input: {
  /** Millimetres of rain over the storm. */
  rainfall: number
  curveNumber?: number
  landCover?: string
  soilGroup?: SoilGroup
  moisture?: MoistureCondition
  /** Hectares. */
  area?: number
  /** The fraction of retention absorbed before runoff starts. 0.2 is the original; 0.05 fits modern data better. */
  initialAbstractionRatio?: number
}): RunoffReport | HydrologyError {
  const { rainfall } = input
  if (!finite(rainfall) || rainfall < 0) return fail('invalid-argument', 'The rainfall has to be zero or more millimetres.')

  let curveNumber: number
  if (input.curveNumber !== undefined) {
    curveNumber = input.curveNumber
  } else {
    if (input.landCover === undefined || input.soilGroup === undefined) {
      return fail(
        'invalid-argument',
        `Give a curve number, or a land cover and a soil group to look one up. Land covers: ${Object.keys(CURVE_NUMBERS).join(', ')}.`
      )
    }
    const cover = Object.prototype.hasOwnProperty.call(CURVE_NUMBERS, input.landCover)
      ? CURVE_NUMBERS[input.landCover]
      : undefined
    if (!cover) {
      return fail('invalid-argument', `"${input.landCover}" is not a land cover this knows: ${Object.keys(CURVE_NUMBERS).join(', ')}.`)
    }
    if (!SOIL_GROUPS.includes(input.soilGroup)) {
      return fail('invalid-argument', `"${input.soilGroup}" is not a soil group; use A, B, C or D.`)
    }
    curveNumber = cover.byGroup[input.soilGroup]
  }
  if (!finite(curveNumber) || curveNumber <= 0 || curveNumber > 100) {
    return fail('out-of-range', 'A curve number runs from just above 0 to 100. 100 means every drop runs off.')
  }

  const moisture = input.moisture ?? 'average'
  // The standard conversions between antecedent runoff conditions.
  const adjusted =
    moisture === 'dry'
      ? (4.2 * curveNumber) / (10 - 0.058 * curveNumber)
      : moisture === 'wet'
        ? (23 * curveNumber) / (10 + 0.13 * curveNumber)
        : curveNumber

  const retention = (25400 / adjusted) - 254
  const ratio = input.initialAbstractionRatio ?? 0.2
  if (!finite(ratio) || ratio < 0 || ratio > 0.5) return fail('out-of-range', 'The initial abstraction ratio runs from 0 to 0.5; 0.2 is the original and 0.05 fits modern data better.')
  const abstraction = ratio * retention

  const runoff = rainfall <= abstraction ? 0 : Math.pow(rainfall - abstraction, 2) / (rainfall - abstraction + retention)

  const warnings: string[] = []
  if (runoff === 0 && rainfall > 0) {
    warnings.push(
      `All ${rainfall} mm was absorbed: the storm did not exceed the ${abstraction.toFixed(1)} mm this catchment soaks up before anything runs off. That threshold is why light rain on dry ground produces no stream response at all.`
    )
  }
  if (rainfall > 0 && rainfall < 12.7) {
    warnings.push('The curve number method was developed for whole storms and is unreliable below about half an inch of rain. Small events are dominated by the initial abstraction, which is the least certain part of it.')
  }
  if (moisture === 'average' && input.moisture === undefined) {
    warnings.push(
      `Average antecedent moisture was assumed. If the ground is already saturated the curve number rises to ${((23 * curveNumber) / (10 + 0.13 * curveNumber)).toFixed(0)} and the runoff roughly doubles — and that is the condition floods happen in.`
    )
  }

  return {
    method: 'scs-curve-number',
    rainfall,
    runoff,
    runoffCoefficient: rainfall === 0 ? 0 : runoff / rainfall,
    initialAbstraction: abstraction,
    potentialRetention: retention,
    curveNumber: adjusted,
    adjustedFor: moisture,
    volume: input.area !== undefined ? (finite(input.area) && input.area > 0 ? (runoff / 1000) * input.area * 10000 : null) : null,
    notes: Object.freeze([
      `${CURVE_NUMBER_SOURCE} Curve number ${adjusted.toFixed(1)}${moisture === 'average' ? '' : ` after adjusting for ${moisture} conditions`}.`,
      `${(((rainfall === 0 ? 0 : runoff / rainfall)) * 100).toFixed(1)}% of the rain ran off. That fraction is not a property of the catchment — it rises with the size of the storm, which is the thing a fixed runoff coefficient gets wrong.`,
      `The first ${abstraction.toFixed(1)} mm is absorbed before anything runs off, taken as ${ratio} of the ${retention.toFixed(1)} mm this soil can hold.`,
      'This is a whole-storm method. It gives a volume, not a peak flow, and it says nothing about when the water arrives.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface RationalReport {
  method: 'rational'
  /** m³/s. */
  peakFlow: number
  runoffCoefficient: number
  /** mm/h. */
  intensity: number
  /** Hectares. */
  area: number
  /** Minutes. How long the storm has to last for the whole catchment to be contributing. */
  timeOfConcentration: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Peak flow by the rational method.
 *
 * Kept alongside the curve number method because it answers a different question: this gives the peak flow that
 * sizes a pipe, that gives the volume that fills a pond. Using either for the other's job is the common mistake.
 *
 * Its limits are real and are stated: a fixed runoff coefficient (which the curve number method shows is not
 * fixed), uniform rainfall over the whole area, and a storm lasting at least as long as the time of
 * concentration. Above about 80 hectares those assumptions stop holding and the method over-predicts.
 */
export function rationalMethod(input: {
  runoffCoefficient: number
  /** mm/h. */
  intensity: number
  /** Hectares. */
  area: number
  /** Minutes. */
  timeOfConcentration?: number
  /** Minutes. */
  stormDuration?: number
}): RationalReport | HydrologyError {
  const { runoffCoefficient: c, intensity, area } = input
  for (const [name, value] of Object.entries({ runoffCoefficient: c, intensity, area })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value < 0) return fail('invalid-argument', `"${name}" cannot be negative.`)
  }
  if (c > 1) return fail('out-of-range', 'The runoff coefficient is a fraction from 0 to 1. Above 1 more water would leave than fell.')
  if (area === 0) return fail('invalid-argument', 'The area has to be greater than zero.')

  // Q = CiA, with the 1/360 that converts mm/h over hectares into m³/s.
  const peakFlow = (c * intensity * area) / 360

  const warnings: string[] = []
  if (area > 80) {
    warnings.push(
      `The catchment is ${area} hectares. The rational method assumes uniform rain over the whole area and is generally held to break down above about 80 hectares, where it over-predicts the peak.`
    )
  }
  if (input.stormDuration !== undefined && input.timeOfConcentration !== undefined) {
    if (input.stormDuration < input.timeOfConcentration) {
      warnings.push(
        `The storm lasts ${input.stormDuration} minutes and the catchment takes ${input.timeOfConcentration} to respond fully. The whole area never contributes at once, so this peak is an over-estimate — the method assumes the storm lasts at least as long as the time of concentration.`
      )
    }
  }

  return {
    method: 'rational',
    peakFlow,
    runoffCoefficient: c,
    intensity,
    area,
    timeOfConcentration: input.timeOfConcentration ?? null,
    notes: Object.freeze([
      'Q = CiA. The rational method gives a peak flow, which is what sizes a pipe or a culvert. It does not give a volume, and it says nothing about how long the flow lasts.',
      'The runoff coefficient is taken as fixed here, which it is not — the curve number method shows it rising with storm size. That simplification is this method’s main limitation and the reason it is kept to small, mostly paved areas.',
      `A peak of ${peakFlow.toFixed(4)} m3/s from ${area} hectares at ${intensity} mm/h.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- frequency

export interface ReturnPeriodReport {
  returnPeriod: number
  /** The chance in any single year. */
  annualProbability: number
  /** The chance of at least one in a span of years. This is the number people get wrong. */
  chanceWithin: readonly { years: number; probability: number }[]
  /** The chance of none at all over the design life. */
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * What a return period actually means, as probabilities.
 *
 * The one calculation in this file that exists to correct a misunderstanding rather than to size anything. A
 * hundred-year flood has a 26% chance of occurring at least once in thirty years, not a 30% chance — and two can
 * arrive in consecutive years without anything being unusual, because the events are independent.
 */
export function returnPeriod(input: {
  returnPeriod: number
  spans?: readonly number[]
}): ReturnPeriodReport | HydrologyError {
  const t = input.returnPeriod
  if (!finite(t) || t <= 0) return fail('invalid-argument', 'The return period has to be greater than zero years.')
  const p = 1 / t
  if (p > 1) return fail('out-of-range', 'A return period under one year means more than one event per year, which this framing does not describe.')

  const spans = input.spans ?? [1, 5, 10, 25, 30, 50, 100]
  for (const one of spans) {
    if (!finite(one) || one <= 0) return fail('invalid-argument', 'Every span has to be a positive number of years.')
  }
  if (spans.length > 64) return fail('too-many', 'That is more than the 64 spans this handles.')

  const chanceWithin = spans.map((years) => ({ years, probability: 1 - Math.pow(1 - p, years) }))
  const thirty = 1 - Math.pow(1 - p, 30)

  return {
    returnPeriod: t,
    annualProbability: p,
    chanceWithin: Object.freeze(chanceWithin),
    notes: Object.freeze([
      `A ${t}-year event has a ${(p * 100).toFixed(2)}% chance of happening in any given year. That is what the return period means — it is not a schedule.`,
      `Over thirty years the chance of at least one is ${(thirty * 100).toFixed(1)}%, not ${((30 / t) * 100).toFixed(0)}%. The difference is that the years are independent, so they compound rather than adding.`,
      'Two hundred-year floods in consecutive years is not evidence the estimate was wrong. It is a one-in-ten-thousand coincidence, and there are a great many places for it to happen in.',
      'The return period itself is estimated from a record that is usually shorter than the period being estimated, so it carries real uncertainty that this calculation does not show.'
    ]),
    warnings: Object.freeze(
      t > 200
        ? [
            `A ${t}-year return period is almost always extrapolated from a much shorter record — rarely more than a century of measurements. The number is a long way outside the data it came from.`
          ]
        : []
    )
  }
}

// ---------------------------------------------------------------- infiltration

export interface InfiltrationReport {
  model: 'horton' | 'green-ampt'
  samples: readonly { time: number; rate: number; cumulative: number }[]
  /** mm. Total infiltrated over the run. */
  totalInfiltrated: number
  /** mm/h at the end. */
  finalRate: number
  /** Minutes. When the rain starts exceeding what the soil can take, and runoff begins. */
  pondingTime: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * How fast water soaks in over time, and when the ground starts to pond.
 *
 * Both models give a rate that falls with time, which is the point: the same rain that soaks away in the first ten
 * minutes runs off in the last ten. The ponding time is when that crossover happens, and it is the reason a long
 * moderate storm can flood a place a short heavy one does not.
 */
export function infiltration(input: {
  model?: 'horton' | 'green-ampt'
  /** mm/h. The rate into dry soil. */
  initialRate?: number
  /** mm/h. The rate once the soil is wet through. */
  finalRate?: number
  /** Per hour. How fast the rate decays, for Horton. */
  decayConstant?: number
  /** mm/h. Saturated hydraulic conductivity, for Green-Ampt. */
  conductivity?: number
  /** mm. Suction at the wetting front, for Green-Ampt. */
  suctionHead?: number
  /** The water the soil can still take, as a fraction, for Green-Ampt. */
  moistureDeficit?: number
  /** mm/h. Constant rainfall, to find the ponding time. */
  rainfallIntensity?: number
  /** Minutes. */
  duration: number
  samples?: number
}): InfiltrationReport | HydrologyError {
  const model = input.model ?? 'horton'
  const { duration } = input
  if (!finite(duration) || duration <= 0) return fail('invalid-argument', 'The duration has to be a positive number of minutes.')
  const count = Math.round(input.samples ?? 120)
  if (!Number.isInteger(count) || count < 2 || count > HYDROLOGY_LIMITS.samples) {
    return fail('invalid-argument', `The sample count has to be between 2 and ${HYDROLOGY_LIMITS.samples}.`)
  }

  const samples: InfiltrationReport['samples'][number][] = []
  let pondingTime: number | null = null
  const warnings: string[] = []

  if (model === 'horton') {
    const f0 = input.initialRate
    const fc = input.finalRate
    const k = input.decayConstant
    if (f0 === undefined || fc === undefined || k === undefined) {
      return fail('invalid-argument', 'Horton needs an initial rate, a final rate and a decay constant.')
    }
    for (const [name, value] of Object.entries({ initialRate: f0, finalRate: fc, decayConstant: k })) {
      if (!finite(value) || value < 0) return fail('invalid-argument', `"${name}" has to be zero or more.`)
    }
    if (fc > f0) return fail('invalid-argument', 'The final rate is above the initial one. Soil takes water in more slowly as it wets, not faster.')

    for (let i = 0; i < count; i += 1) {
      const minutes = (duration * i) / (count - 1)
      const hours = minutes / 60
      const rate = fc + (f0 - fc) * Math.exp(-k * hours)
      // The integral of the same expression, so the cumulative figure is exact rather than a running sum.
      const cumulative = fc * hours + ((f0 - fc) / k) * (1 - Math.exp(-k * hours))
      samples.push({ time: minutes, rate, cumulative })
      if (pondingTime === null && input.rainfallIntensity !== undefined && rate < input.rainfallIntensity) {
        pondingTime = minutes
      }
    }
  } else {
    const ks = input.conductivity
    const psi = input.suctionHead
    const deficit = input.moistureDeficit
    if (ks === undefined || psi === undefined || deficit === undefined) {
      return fail('invalid-argument', 'Green-Ampt needs a saturated conductivity, a suction head and a moisture deficit.')
    }
    for (const [name, value] of Object.entries({ conductivity: ks, suctionHead: psi, moistureDeficit: deficit })) {
      if (!finite(value) || value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
    }
    if (deficit > 1) return fail('out-of-range', 'The moisture deficit is a fraction from 0 to 1.')

    // Green-Ampt is implicit in the cumulative depth, so it is iterated at each step rather than approximated.
    let cumulative = 0.01
    for (let i = 0; i < count; i += 1) {
      const minutes = (duration * i) / (count - 1)
      const hours = minutes / 60
      if (hours > 0) {
        let guess = Math.max(cumulative, ks * hours)
        for (let step = 0; step < 60; step += 1) {
          const next = ks * hours + psi * deficit * Math.log(1 + guess / (psi * deficit))
          if (Math.abs(next - guess) < 1e-9) {
            guess = next
            break
          }
          guess = next
        }
        cumulative = guess
      }
      const rate = hours === 0 ? Number.POSITIVE_INFINITY : ks * (1 + (psi * deficit) / Math.max(cumulative, 1e-9))
      samples.push({ time: minutes, rate: Number.isFinite(rate) ? rate : ks * 100, cumulative })
      if (pondingTime === null && input.rainfallIntensity !== undefined && Number.isFinite(rate) && rate < input.rainfallIntensity) {
        pondingTime = minutes
      }
    }
    if (input.rainfallIntensity !== undefined && input.rainfallIntensity <= ks) {
      warnings.push(
        `The rain falls at ${input.rainfallIntensity} mm/h and the soil takes water at ${ks} mm/h once saturated. Rain at or below the saturated conductivity never ponds, however long it lasts.`
      )
    }
  }

  const last = samples[samples.length - 1]
  return {
    model,
    samples: Object.freeze(samples),
    totalInfiltrated: last.cumulative,
    finalRate: last.rate,
    pondingTime,
    notes: Object.freeze([
      model === 'horton'
        ? 'Horton: an empirical curve from initial to final rate. Simple, fitted to measurements, and it says nothing about why the rate falls.'
        : 'Green-Ampt: derived from the physics of a sharp wetting front moving down through the soil. Implicit in the cumulative depth, so it was iterated rather than approximated.',
      'The rate falls with time because the soil above the wetting front fills up. That is why the same rain soaks away at the start of a storm and runs off at the end.',
      pondingTime !== null
        ? `Ponding starts at ${pondingTime.toFixed(1)} minutes, when the soil stops being able to take the rain as fast as it arrives. Runoff begins there, not when the storm begins.`
        : 'No ponding within this run: the soil kept up with the rain throughout, so nothing ran off.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- groundwater

export interface DarcyReport {
  /** m/day. The bulk flow rate per unit area — not how fast the water moves. */
  darcyVelocity: number
  /** m/day. How fast the water actually moves through the pores. Faster than the Darcy velocity. */
  seepageVelocity: number | null
  /** m³/day. */
  discharge: number | null
  hydraulicGradient: number
  /** Days, when a travel distance was given. */
  travelTime: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Darcy's law, with the distinction between the two velocities made explicit.
 *
 * The Darcy velocity is a flow per unit of total area and nothing moves at it. Water moves through the pores only,
 * so its actual speed is the Darcy velocity divided by the porosity — three to five times faster. Using the Darcy
 * velocity for a travel time overstates how long a contaminant takes to arrive by that same factor, which is the
 * kind of error that matters.
 */
export function darcyFlow(input: {
  /** m/day. */
  conductivity: number
  /** The head drop over the distance it drops across. */
  hydraulicGradient?: number
  headDifference?: number
  flowLength?: number
  /** m². */
  crossSectionArea?: number
  porosity?: number
  /** Metres, for a travel time. */
  travelDistance?: number
}): DarcyReport | HydrologyError {
  const { conductivity } = input
  if (!finite(conductivity) || conductivity <= 0) return fail('invalid-argument', 'The hydraulic conductivity has to be greater than zero.')

  let gradient: number
  if (input.hydraulicGradient !== undefined) {
    gradient = input.hydraulicGradient
  } else {
    if (input.headDifference === undefined || input.flowLength === undefined) {
      return fail('invalid-argument', 'Give a hydraulic gradient, or a head difference and the length it drops over.')
    }
    if (!finite(input.flowLength) || input.flowLength <= 0) return fail('invalid-argument', 'The flow length has to be greater than zero.')
    gradient = input.headDifference / input.flowLength
  }
  if (!finite(gradient)) return fail('not-finite', 'The hydraulic gradient is not a finite number.')

  const darcyVelocity = conductivity * gradient
  let seepageVelocity: number | null = null
  const warnings: string[] = []

  if (input.porosity !== undefined) {
    if (!finite(input.porosity) || input.porosity <= 0 || input.porosity > 1) {
      return fail('out-of-range', 'Porosity is a fraction from just above 0 to 1.')
    }
    seepageVelocity = darcyVelocity / input.porosity
  } else {
    warnings.push(
      'No porosity was given, so only the Darcy velocity is reported. Nothing actually moves at that speed — water moves through the pores, three to five times faster. For a travel time the porosity is essential.'
    )
  }

  return {
    darcyVelocity,
    seepageVelocity,
    discharge:
      input.crossSectionArea !== undefined && finite(input.crossSectionArea) && input.crossSectionArea > 0
        ? darcyVelocity * input.crossSectionArea
        : null,
    hydraulicGradient: gradient,
    travelTime:
      input.travelDistance !== undefined && seepageVelocity !== null && seepageVelocity !== 0
        ? input.travelDistance / seepageVelocity
        : null,
    notes: Object.freeze([
      `The Darcy velocity is ${darcyVelocity.toFixed(5)} m/day. That is a discharge per unit of total cross-section, and it is not a speed anything travels at.`,
      seepageVelocity !== null
        ? `The water actually moves at ${seepageVelocity.toFixed(5)} m/day through the pores. Using the Darcy velocity for a travel time would overstate it by the porosity — a factor of ${(1 / (input.porosity as number)).toFixed(1)} here.`
        : 'Give a porosity for the speed the water actually travels at.',
      'Darcy’s law assumes laminar flow through a uniform porous medium. It does not describe flow through fractures or large channels, where most of the water can move through a very small part of the rock.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface WellReport {
  /** Metres. Drawdown at the observation distance. */
  drawdown: number
  /** The dimensionless well function argument. */
  u: number
  /** The well function W(u), by series. */
  wellFunction: number
  /** Whether the series was inside the range it converges well in. */
  reliable: boolean
  /** m²/day. */
  transmissivity: number
  storativity: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Drawdown near a pumped well by the Theis solution.
 *
 * The well function is computed by its series rather than read off a type curve, and the range where that series
 * is trustworthy is reported — for large u the terms alternate and cancel, and a value produced there is
 * numerically meaningless even though the arithmetic completes.
 *
 * Theis assumes a confined aquifer of infinite extent, fully penetrated by the well, pumped at a constant rate,
 * with water released instantly from storage. Real aquifers break every one of those, which is why a pumping test
 * is analysed by fitting rather than by a single calculation.
 */
export function theisDrawdown(input: {
  /** m³/day. */
  pumpingRate: number
  /** m²/day. */
  transmissivity: number
  storativity: number
  /** Metres from the well. */
  distance: number
  /** Days since pumping started. */
  time: number
}): WellReport | HydrologyError {
  const { pumpingRate: q, transmissivity: T, storativity: S, distance: r, time: t } = input
  for (const [name, value] of Object.entries({ pumpingRate: q, transmissivity: T, storativity: S, distance: r, time: t })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }
  if (S > 1) return fail('out-of-range', 'Storativity is a fraction. A confined aquifer is typically 1e-5 to 1e-3, and an unconfined one 0.1 to 0.3.')

  const u = (r * r * S) / (4 * T * t)

  // The exponential integral by its series for small u and by a continued-fraction-style asymptotic form for
  // large u. The series alone loses all precision above about u = 1.
  let wellFunction: number
  let reliable = true
  if (u < 1) {
    // W(u) = -gamma - ln u + u - u^2/(2*2!) + u^3/(3*3!) - ...
    const gamma = 0.5772156649015329
    let sum = -gamma - Math.log(u)
    let term = 1
    for (let n = 1; n <= 30; n += 1) {
      term *= -u / n
      sum -= term / n
    }
    wellFunction = sum
  } else {
    // For u above 1 the drawdown is tiny and the asymptotic form is both accurate and stable.
    wellFunction = (Math.exp(-u) / u) * (1 - 1 / u + 2 / (u * u))
    if (u > 5) {
      reliable = false
    }
  }

  const drawdown = (q / (4 * Math.PI * T)) * wellFunction

  const warnings: string[] = []
  if (!reliable) {
    warnings.push(
      `u is ${u.toExponential(2)}, well above 1. The drawdown this far out and this early is effectively zero, and the asymptotic expansion used here is not precise there. Treat the figure as "negligible" rather than as a number.`
    )
  }
  if (u > 0.01 && u < 1) {
    warnings.push(
      `u is ${u.toFixed(4)}. Above about 0.01 the Cooper-Jacob straight-line simplification, which a lot of published analysis uses, is not valid — only the full Theis solution is, which is what this is.`
    )
  }
  if (drawdown < 0) {
    warnings.push('The drawdown came out negative, which means the well function went negative at this u. That is the series losing precision rather than water flowing uphill.')
  }

  return {
    drawdown,
    u,
    wellFunction,
    reliable,
    transmissivity: T,
    storativity: S,
    notes: Object.freeze([
      `Drawdown of ${drawdown.toFixed(4)} m at ${r} m from the well after ${t} days, by the Theis solution.`,
      'The well function is computed from its series, not read off a type curve, and the range it is trustworthy in is reported rather than assumed.',
      'Theis assumes a confined aquifer of infinite extent, fully penetrated, pumped at a constant rate, releasing water instantly from storage. Every real aquifer breaks at least one of those, which is why a pumping test is analysed by fitting a whole curve rather than by one calculation.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- water balance

export interface BalanceReport {
  /** All in the same units as given. */
  inflows: readonly { label: string; amount: number }[]
  outflows: readonly { label: string; amount: number }[]
  totalIn: number
  totalOut: number
  /** What is left over. Positive means storage grew. */
  storageChange: number
  /** How far the balance misses closing, as a fraction of the inflow. */
  closureError: number | null
  closes: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * A water balance, with the residual left visible.
 *
 * The point of this function is what it refuses to do: if the terms do not add up it reports the gap rather than
 * adjusting anything to close it. A balance forced to close hides the fact that a term is missing or measured
 * wrong, and in practice the residual is the most informative number in the whole calculation — it is usually
 * groundwater exchange, which nobody measured.
 */
export function waterBalance(input: {
  inflows: readonly { label?: string; amount: number }[]
  outflows: readonly { label?: string; amount: number }[]
  /** The measured change in storage, if there is one, so the balance can be checked rather than assumed. */
  measuredStorageChange?: number
  tolerance?: number
}): BalanceReport | HydrologyError {
  if (input.inflows.length === 0 && input.outflows.length === 0) {
    return fail('invalid-argument', 'There are no terms to balance.')
  }
  if (input.inflows.length + input.outflows.length > 128) {
    return fail('too-many', 'That is more than the 128 terms this handles.')
  }

  const inflows: BalanceReport['inflows'][number][] = []
  for (const [i, one] of input.inflows.entries()) {
    if (!finite(one.amount)) return fail('not-finite', `Inflow ${i + 1} is not a finite number.`)
    if (one.amount < 0) {
      return fail(
        'invalid-argument',
        `Inflow ${i + 1} is negative. A negative inflow is an outflow, and putting it on the wrong side makes the balance look like it closes when it does not — list it under outflows.`
      )
    }
    inflows.push({ label: one.label ?? `inflow ${i + 1}`, amount: one.amount })
  }
  const outflows: BalanceReport['outflows'][number][] = []
  for (const [i, one] of input.outflows.entries()) {
    if (!finite(one.amount)) return fail('not-finite', `Outflow ${i + 1} is not a finite number.`)
    if (one.amount < 0) {
      return fail('invalid-argument', `Outflow ${i + 1} is negative. List it as an inflow instead.`)
    }
    outflows.push({ label: one.label ?? `outflow ${i + 1}`, amount: one.amount })
  }

  const totalIn = inflows.reduce((sum, one) => sum + one.amount, 0)
  const totalOut = outflows.reduce((sum, one) => sum + one.amount, 0)
  const storageChange = totalIn - totalOut

  const tolerance = input.tolerance ?? 0.05
  let closureError: number | null = null
  let closes = true
  const warnings: string[] = []

  if (input.measuredStorageChange !== undefined) {
    if (!finite(input.measuredStorageChange)) return fail('not-finite', 'The measured storage change is not a finite number.')
    const gap = storageChange - input.measuredStorageChange
    closureError = totalIn === 0 ? null : Math.abs(gap) / totalIn
    closes = closureError !== null && closureError <= tolerance
    if (!closes) {
      warnings.push(
        `The balance misses by ${gap.toFixed(4)}, which is ${((closureError ?? 0) * 100).toFixed(1)}% of the inflow. That residual is not noise to be adjusted away — it is usually a term nobody measured, and groundwater exchange is the usual candidate.`
      )
    }
  }

  return {
    inflows: Object.freeze(inflows),
    outflows: Object.freeze(outflows),
    totalIn,
    totalOut,
    storageChange,
    closureError,
    closes,
    notes: Object.freeze([
      `${totalIn.toFixed(4)} in, ${totalOut.toFixed(4)} out, so storage changed by ${storageChange.toFixed(4)}.`,
      input.measuredStorageChange === undefined
        ? 'No measured storage change was given, so the change above is whatever the terms imply. Give a measured one and this will report how far the balance misses closing.'
        : 'The residual is reported rather than distributed among the terms. A balance forced to close hides the term that is missing.',
      'Every term has to be over the same period and the same area, and in the same units. Mixing a monthly rainfall with a daily evaporation is the commonest error here and nothing in the arithmetic can catch it.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const HYDROLOGY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Every runoff result names the method it used. The rational method and the curve number method answer different questions and disagree on the same storm.',
  'Curve numbers are tabulated field values from a named source, adjusted explicitly for antecedent moisture rather than silently assuming average conditions.',
  'A return period is an annual probability, not a schedule. Every result states the compounded chance over a span of years.',
  'Green-Ampt infiltration is implicit and is iterated. Horton is an empirical curve and says so.',
  'Darcy velocity and seepage velocity are reported separately, because nothing travels at the Darcy velocity and using it for a travel time is wrong by the porosity.',
  'The Theis solution assumes a confined, infinite, fully penetrated aquifer pumped at a constant rate. The range where its series is numerically trustworthy is reported.',
  'A water balance reports its residual rather than closing itself. The residual is usually the most informative number in it.'
])
