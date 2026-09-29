/**
 * Geology: earthquakes, radiometric dating, plate motion, rocks and slope stability.
 *
 * The shared geology engine for Orbis Pages. Magnitude scales are converted through energy rather than treated as
 * interchangeable, ages carry the half-life and the assumptions that make them meaningful, and a slope is given a
 * factor of safety with the method that produced it named.
 *
 * ## Why magnitude conversions go through energy
 *
 * Richter's original local magnitude saturates above about 6.5 — a magnitude 8 and a magnitude 9 read almost the
 * same on it — which is why moment magnitude replaced it. They are different quantities measuring different
 * things, and a "magnitude" without a scale attached is ambiguous for exactly the largest and most important
 * earthquakes. Everything here states which scale and converts through radiated energy, where the relationship is
 * defined.
 *
 * ## Why a radiometric age states its assumptions
 *
 * A date from a decay ratio assumes the sample started with no daughter isotope (or a known amount), that nothing
 * has entered or left since, and that the clock started at the event being dated. Those are the assumptions that
 * fail in practice — a weathered sample gives a wrong answer with full precision — so the assumptions are on the
 * result, not in a footnote.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * magnitude    vs  intensity        -- one number for the earthquake against what was felt at each place
 * Richter      vs  moment magnitude -- and the saturation that makes them differ where it matters
 * half-life    vs  mean life        -- 0.693 of the other, and confusing them is a 44% error
 * absolute     vs  relative dating  -- years against older-than
 * factor of safety vs  will it fail -- a ratio against a certainty nobody can offer
 * ```
 *
 * Pure. No network, no clock, no storage. Every date is supplied; nothing reads the system time.
 */

export interface GeologyError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'outside-model' | 'no-solution'
  message: string
}

export const isGeologyError = (value: unknown): value is GeologyError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: GeologyError['error'], message: string): GeologyError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

// ---------------------------------------------------------------- earthquakes

export type MagnitudeScale = 'moment' | 'local' | 'surface-wave' | 'body-wave'

export const MAGNITUDE_SCALES: readonly MagnitudeScale[] = Object.freeze(['moment', 'local', 'surface-wave', 'body-wave'])

export const MAGNITUDE_FACTS: Readonly<
  Record<MagnitudeScale, { label: string; symbol: string; measures: string; saturatesAbove: number | null; useFor: string }>
> = Object.freeze({
  moment: {
    label: 'Moment magnitude',
    symbol: 'Mw',
    measures: 'The seismic moment — the rock strength, the fault area and how far it slipped, multiplied together.',
    saturatesAbove: null,
    useFor: 'Everything. It does not saturate, so it is the only scale that distinguishes a magnitude 8 from a 9.'
  },
  local: {
    label: 'Local magnitude (Richter)',
    symbol: 'ML',
    measures: 'The largest wave amplitude on a particular seismograph, corrected for distance.',
    saturatesAbove: 6.5,
    useFor:
      'Small local earthquakes. Above about 6.5 it stops responding to a bigger earthquake, so the largest events all read about the same.'
  },
  'surface-wave': {
    label: 'Surface wave magnitude',
    symbol: 'Ms',
    measures: 'The amplitude of 20-second surface waves.',
    saturatesAbove: 8.0,
    useFor: 'Shallow distant earthquakes. Saturates around 8 and misses deep events entirely.'
  },
  'body-wave': {
    label: 'Body wave magnitude',
    symbol: 'mb',
    measures: 'The amplitude of short-period P waves.',
    saturatesAbove: 6.8,
    useFor: 'Deep earthquakes, which surface-wave magnitude cannot see. Saturates early.'
  }
})

export interface EarthquakeReport {
  magnitude: number
  scale: MagnitudeScale
  scaleLabel: string
  /** Joules of radiated seismic energy. */
  energy: number
  /** Newton-metres. Null for scales that do not define one. */
  seismicMoment: number | null
  /** Equivalent tonnes of TNT, for a sense of scale. */
  tntEquivalent: number
  /** How this compares with a reference magnitude: energy ratio and amplitude ratio. They are very different. */
  comparedWith: { magnitude: number; energyRatio: number; amplitudeRatio: number } | null
  /** Whether this magnitude is in the range the scale can actually resolve. */
  withinScaleRange: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * What an earthquake magnitude means in energy, with the scale's saturation checked.
 *
 * Two ratios are reported when comparing magnitudes and they are wildly different: one step of magnitude is ten
 * times the ground motion and about 32 times the energy. Almost every confused statement about earthquake sizes
 * comes from using one of those numbers when the other was meant.
 */
export function earthquakeEnergy(input: {
  magnitude: number
  scale?: MagnitudeScale
  compareWith?: number
}): EarthquakeReport | GeologyError {
  const { magnitude } = input
  if (!finite(magnitude)) return fail('not-finite', 'The magnitude has to be a finite number.')
  if (magnitude < -2 || magnitude > 10.5) {
    return fail(
      'out-of-range',
      `A magnitude of ${magnitude} is outside anything recorded. The largest measured is 9.5 (Chile, 1960), and the physical limit is set by how long a fault can be.`
    )
  }
  const scale = input.scale ?? 'moment'
  const facts = MAGNITUDE_FACTS[scale]
  if (!facts) return fail('invalid-argument', `"${scale}" is not one of: ${MAGNITUDE_SCALES.join(', ')}.`)

  // Gutenberg-Richter: log10 E = 1.5 M + 4.8, with E in joules.
  const energy = Math.pow(10, 1.5 * magnitude + 4.8)
  // Kanamori: Mw = (2/3) log10 M0 - 6.07, with M0 in newton-metres.
  const seismicMoment = scale === 'moment' ? Math.pow(10, 1.5 * (magnitude + 6.07)) : null
  const tnt = energy / 4.184e9

  let comparedWith: EarthquakeReport['comparedWith'] = null
  if (input.compareWith !== undefined) {
    if (!finite(input.compareWith)) return fail('not-finite', 'The comparison magnitude has to be a finite number.')
    comparedWith = {
      magnitude: input.compareWith,
      energyRatio: Math.pow(10, 1.5 * (magnitude - input.compareWith)),
      amplitudeRatio: Math.pow(10, magnitude - input.compareWith)
    }
  }

  const withinRange = facts.saturatesAbove === null || magnitude <= facts.saturatesAbove
  const warnings: string[] = []
  if (!withinRange) {
    warnings.push(
      `${facts.label} saturates above about ${facts.saturatesAbove}. A ${magnitude} on this scale is not distinguishable from a considerably larger earthquake — that is why moment magnitude replaced it, and why the 1960 Chile earthquake was originally under-reported.`
    )
  }

  const notes: string[] = [
    `${facts.label} (${facts.symbol}): ${facts.measures} ${facts.useFor}`,
    `This releases about ${energy.toExponential(3)} J of seismic energy, or ${tnt < 1000 ? `${tnt.toFixed(1)} tonnes` : `${(tnt / 1000).toFixed(1)} kilotonnes`} of TNT.`,
    'One step of magnitude is ten times the ground motion and about 32 times the energy. Those are different numbers and mixing them up is behind most confused statements about earthquake sizes.'
  ]
  if (comparedWith !== null) {
    notes.push(
      `Against magnitude ${comparedWith.magnitude}: ${comparedWith.amplitudeRatio.toFixed(2)} times the ground motion and ${comparedWith.energyRatio.toFixed(2)} times the energy.`
    )
  }
  if (seismicMoment !== null) {
    notes.push(
      `The seismic moment is ${seismicMoment.toExponential(3)} N*m. That is the physical quantity — fault area times slip times rock stiffness — and the magnitude is just a logarithm of it.`
    )
  }
  notes.push(
    'Magnitude is one number for the whole earthquake. Intensity is what was felt at a particular place, varies enormously across a region, and is a different kind of measurement entirely.'
  )

  return {
    magnitude,
    scale,
    scaleLabel: facts.label,
    energy,
    seismicMoment,
    tntEquivalent: tnt,
    comparedWith,
    withinScaleRange: withinRange,
    notes: Object.freeze(notes),
    warnings: Object.freeze(warnings)
  }
}

export interface ArrivalReport {
  /** Kilometres. */
  distance: number
  /** Seconds. */
  pArrival: number
  sArrival: number
  /** Seconds. The gap, which is what locates the earthquake. */
  separation: number
  pVelocity: number
  sVelocity: number
  /** Seconds of warning, if a system triggers on the P wave. */
  warningTime: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * P and S wave arrival times, and the warning the gap between them buys.
 *
 * The S-minus-P gap is how a single station estimates its distance from an earthquake, and it is also the whole
 * basis of earthquake early warning: the P wave arrives first and does little damage, the S wave and surface waves
 * arrive later and do most of it. Close to the epicentre the gap is seconds and there is no useful warning, which
 * is the fundamental limit of such systems rather than an engineering shortcoming.
 */
export function waveArrivals(input: {
  /** Kilometres. */
  distance: number
  /** km/s. */
  pVelocity?: number
  sVelocity?: number
}): ArrivalReport | GeologyError {
  const { distance } = input
  if (!finite(distance) || distance <= 0) return fail('invalid-argument', 'The distance has to be greater than zero kilometres.')
  const p = input.pVelocity ?? 6.0
  const s = input.sVelocity ?? 3.5
  for (const [name, value] of Object.entries({ pVelocity: p, sVelocity: s })) {
    if (!finite(value) || value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }
  if (s >= p) {
    return fail(
      'invalid-argument',
      'The S wave velocity is at or above the P wave velocity. P waves are compressional and always travel faster — that is what makes them primary.'
    )
  }

  const pArrival = distance / p
  const sArrival = distance / s
  const separation = sArrival - pArrival

  const warnings: string[] = []
  if (separation < 5) {
    warnings.push(
      `The gap is only ${separation.toFixed(1)} s. Close to an epicentre there is no time for a warning to be useful — this is the hard limit of early warning systems, not a shortcoming of their engineering.`
    )
  }

  return {
    distance,
    pArrival,
    sArrival,
    separation,
    pVelocity: p,
    sVelocity: s,
    warningTime: separation,
    notes: Object.freeze([
      `The P wave arrives at ${pArrival.toFixed(2)} s and the S wave at ${sArrival.toFixed(2)} s, ${separation.toFixed(2)} s apart.`,
      'That gap is how a single station works out its distance from an earthquake, and three stations doing so is how the epicentre is found.',
      'It is also the whole basis of early warning: the P wave does little damage, the S and surface waves do most of it, and the gap between them is all the notice there is.',
      'Velocities here are single averages through the crust. Real wave paths bend and speed up with depth, which is why proper location uses a velocity model rather than one number.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- radiometric dating

export interface IsotopeSystem {
  id: string
  label: string
  parent: string
  daughter: string
  /** Years. */
  halfLife: number
  /** Years. What this system can usefully date. */
  usefulFrom: number
  usefulTo: number
  datesWhat: string
  source: string
}

export const ISOTOPE_SYSTEMS: readonly IsotopeSystem[] = Object.freeze([
  {
    id: 'carbon-14',
    label: 'Carbon-14',
    parent: '14C',
    daughter: '14N',
    halfLife: 5730,
    usefulFrom: 100,
    usefulTo: 50000,
    datesWhat: 'When something living stopped exchanging carbon with the air. Dates the death, not the rock.',
    source: 'Libby half-life 5568 a is still used by convention for reported ages; the measured value is 5730 a, used here.'
  },
  {
    id: 'potassium-40',
    label: 'Potassium-argon',
    parent: '40K',
    daughter: '40Ar',
    halfLife: 1.248e9,
    usefulFrom: 100000,
    usefulTo: 4.5e9,
    datesWhat: 'When a volcanic rock cooled enough to trap argon. Any later heating resets it.',
    source: 'IUPAC-recommended 40K half-life, 1.248 Ga.'
  },
  {
    id: 'uranium-238',
    label: 'Uranium-lead (238U)',
    parent: '238U',
    daughter: '206Pb',
    halfLife: 4.468e9,
    usefulFrom: 1e6,
    usefulTo: 4.6e9,
    datesWhat: 'When a zircon crystallised. The most reliable system there is, because zircon holds lead tightly.',
    source: 'Jaffey et al. 1971, the reference determination.'
  },
  {
    id: 'rubidium-87',
    label: 'Rubidium-strontium',
    parent: '87Rb',
    daughter: '87Sr',
    halfLife: 4.97e10,
    usefulFrom: 1e7,
    usefulTo: 4.6e9,
    datesWhat: 'Whole rocks and metamorphic events. Needs an isochron because the initial strontium is unknown.',
    source: 'Villa et al. 2015.'
  },
  {
    id: 'thorium-232',
    label: 'Thorium-lead',
    parent: '232Th',
    daughter: '208Pb',
    halfLife: 1.405e10,
    usefulFrom: 1e7,
    usefulTo: 4.6e9,
    datesWhat: 'A cross-check on uranium-lead in the same crystal. Agreement between them is what makes a date trustworthy.',
    source: 'IUPAC.'
  }
])

export function isotopeById(id: string): IsotopeSystem | GeologyError {
  const found = ISOTOPE_SYSTEMS.find((one) => one.id === id)
  return found ?? fail('invalid-argument', `"${id}" is not a system this knows: ${ISOTOPE_SYSTEMS.map((one) => one.id).join(', ')}.`)
}

export interface AgeReport {
  system: string
  label: string
  /** Years. */
  age: number
  halfLife: number
  /** Years. 1/lambda, which is longer than the half-life and is a different quantity. */
  meanLife: number
  /** How many half-lives have passed. */
  halfLivesElapsed: number
  /** The fraction of parent left. */
  parentRemaining: number
  /** Whether the age is inside what this system can resolve. */
  withinUsefulRange: boolean
  datesWhat: string
  source: string
  assumptions: readonly string[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * A radiometric age, with the assumptions that make it meaningful stated on the result.
 *
 * Those assumptions are the whole story: a weathered sample, or one that was reheated, gives a precise and wrong
 * answer. The useful range is checked too, because beyond about ten half-lives there is too little parent left to
 * measure and the date is a detection limit rather than a measurement — carbon dating something older than fifty
 * thousand years returns a number that means "older than this" and nothing more.
 */
export function radiometricAge(input: {
  system: string
  /** The fraction of the original parent still present, if that is what is known. */
  parentFraction?: number
  /** The daughter-to-parent atom ratio, which is what is usually measured. */
  daughterToParent?: number
  /** Years, to work the other way and find the remaining fraction. */
  age?: number
}): AgeReport | GeologyError {
  const system = isotopeById(input.system)
  if (isGeologyError(system)) return system

  const lambda = Math.LN2 / system.halfLife
  const given = ['parentFraction', 'daughterToParent', 'age'].filter((one) => input[one as 'age'] !== undefined)
  if (given.length === 0) {
    return fail('invalid-argument', 'Give a parent fraction, a daughter-to-parent ratio, or an age.')
  }
  if (given.length > 1) {
    return fail('invalid-argument', `Both ${given.join(' and ')} were given. Any one fixes the others, so pick one.`)
  }

  let age: number
  let parentRemaining: number

  if (input.age !== undefined) {
    age = input.age
    if (!finite(age) || age < 0) return fail('invalid-argument', 'The age cannot be negative.')
    parentRemaining = Math.exp(-lambda * age)
  } else if (input.parentFraction !== undefined) {
    parentRemaining = input.parentFraction
    if (!finite(parentRemaining) || parentRemaining <= 0 || parentRemaining > 1) {
      return fail('out-of-range', 'The parent fraction is greater than 0 and at most 1. Exactly 0 would be an infinite age.')
    }
    age = -Math.log(parentRemaining) / lambda
  } else {
    const ratio = input.daughterToParent as number
    if (!finite(ratio) || ratio < 0) return fail('invalid-argument', 'The daughter-to-parent ratio cannot be negative.')
    // t = (1/lambda) ln(1 + D/P), which assumes every daughter atom came from a parent in this sample.
    age = Math.log(1 + ratio) / lambda
    parentRemaining = 1 / (1 + ratio)
  }

  const halfLivesElapsed = age / system.halfLife
  const withinRange = age >= system.usefulFrom && age <= system.usefulTo

  const warnings: string[] = []
  if (!withinRange) {
    if (age > system.usefulTo) {
      warnings.push(
        `${system.label} is useful up to about ${system.usefulTo.toExponential(1)} years and this comes out at ${age.toExponential(2)}. After that there is too little parent left to measure, so the figure is a detection limit — it means "older than this" rather than an age.`
      )
    } else {
      warnings.push(
        `${system.label} is useful from about ${system.usefulFrom.toExponential(1)} years and this comes out at ${age.toExponential(2)}. Too little daughter has accumulated to measure against the uncertainty.`
      )
    }
  }
  if (halfLivesElapsed > 10) {
    warnings.push(`That is ${halfLivesElapsed.toFixed(1)} half-lives, leaving ${(parentRemaining * 100).toExponential(2)}% of the parent. Below about a tenth of a percent the measurement is dominated by contamination.`)
  }

  return {
    system: system.id,
    label: system.label,
    age,
    halfLife: system.halfLife,
    meanLife: 1 / lambda,
    halfLivesElapsed,
    parentRemaining,
    withinUsefulRange: withinRange,
    datesWhat: system.datesWhat,
    source: system.source,
    assumptions: Object.freeze([
      'The sample began with no daughter isotope from this decay, or with a known amount.',
      'Nothing has entered or left the sample since. This is the assumption that fails in weathered or reheated rock, and it fails without any sign in the numbers.',
      'The decay constant has been the same throughout. Well established, and worth stating.',
      `The clock started at the event being dated: ${system.datesWhat}`
    ]),
    notes: Object.freeze([
      `${system.label}: ${system.parent} decays to ${system.daughter} with a half-life of ${system.halfLife.toExponential(3)} years. ${system.source}`,
      `${halfLivesElapsed.toFixed(3)} half-lives have passed, leaving ${(parentRemaining * 100).toFixed(4)}% of the original parent.`,
      `The mean life is ${(1 / lambda).toExponential(3)} years — longer than the half-life by a factor of 1/ln2. They are different quantities and swapping them is a 44% error.`,
      'An age like this is only as good as its assumptions, which are listed rather than left implicit. A weathered sample gives a precise wrong answer.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- plate motion

export interface PlateReport {
  /** mm/year. */
  rate: number
  /** Metres moved over the span. */
  displacement: number
  years: number
  /** Kilometres. */
  displacementKm: number
  /** How long to move a given distance, when one was asked for. */
  timeFor: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * How far a plate moves in a span of time, or how long a distance takes.
 *
 * Plate rates are of order tens of millimetres a year, and the point of this calculation is almost always the
 * accumulated total: forty millimetres a year is four kilometres in a hundred thousand years and four hundred in
 * ten million. That arithmetic is the whole of why continents have moved as far as they have.
 */
export function plateMotion(input: {
  /** mm/year. */
  rate: number
  years?: number
  /** Metres, to find how long it takes instead. */
  distance?: number
}): PlateReport | GeologyError {
  const { rate } = input
  if (!finite(rate)) return fail('not-finite', 'The rate has to be a finite number.')
  if (rate <= 0) return fail('invalid-argument', 'The rate has to be greater than zero millimetres a year.')
  if (input.years === undefined && input.distance === undefined) {
    return fail('invalid-argument', 'Give a number of years, or a distance to find the time for.')
  }

  const years = input.years ?? 0
  if (!finite(years) || years < 0) return fail('invalid-argument', 'The number of years cannot be negative.')
  const displacement = (rate / 1000) * years

  const warnings: string[] = []
  if (rate > 200) {
    warnings.push(`${rate} mm/year is faster than any measured plate. The fastest, the Nazca-Pacific boundary, is about 150 mm/year.`)
  }

  return {
    rate,
    displacement,
    years,
    displacementKm: displacement / 1000,
    timeFor: input.distance !== undefined && finite(input.distance) ? (input.distance * 1000) / rate : null,
    notes: Object.freeze([
      `At ${rate} mm a year — about the rate a fingernail grows — ${years.toExponential(2)} years gives ${(displacement / 1000).toFixed(3)} km.`,
      'Plate rates are measured by GPS over years and by magnetic stripes on the sea floor over millions. The two agree, which is a large part of why plate tectonics is settled.',
      'Rates are not constant over geological time, so extrapolating a present-day GPS rate back a hundred million years gives an order of magnitude and not a number.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- slope stability

export interface SlopeReport {
  method: 'infinite-slope'
  /** The ratio of resisting to driving forces. Above 1 it holds; the margin is the point. */
  factorOfSafety: number
  /** Degrees. The steepest this slope could be and still hold. */
  criticalAngle: number | null
  /** kPa. */
  drivingStress: number
  resistingStress: number
  /** Whether groundwater was included, which changes everything. */
  saturated: boolean
  /** kPa of water pressure holding the grains apart. */
  porePressure: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Slope stability by the infinite-slope method, with pore pressure treated as the thing that matters.
 *
 * Almost every landslide happens during or just after rain, and this is why: water pressure in the pores pushes the
 * grains apart, which cuts the friction holding the slope together without changing its weight. A stability
 * calculation done dry can give a comfortable factor of safety for a slope that fails in the first storm, so the
 * dry case is reported alongside the wet one whenever water is included.
 *
 * A factor of safety is a ratio, not a prediction. 1.5 is a common design target precisely because 1.05 is not a
 * slope anybody should stand under.
 */
export function slopeStability(input: {
  /** Degrees. */
  slopeAngle: number
  /** Degrees. The soil's internal friction angle. */
  frictionAngle: number
  /** kPa. Cohesion. Zero for clean sand. */
  cohesion?: number
  /** Metres. Depth to the failure surface. */
  depth: number
  /** kN/m³. */
  unitWeight: number
  /** Metres above the failure surface. Leave out for a dry slope. */
  waterTableHeight?: number
  /** kN/m³. */
  waterUnitWeight?: number
}): SlopeReport | GeologyError {
  const { slopeAngle, frictionAngle, depth, unitWeight } = input
  for (const [name, value] of Object.entries({ slopeAngle, frictionAngle, depth, unitWeight })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
  }
  if (slopeAngle <= 0 || slopeAngle >= 90) return fail('out-of-range', 'The slope angle runs between 0 and 90 degrees. A vertical face is a different problem.')
  if (frictionAngle < 0 || frictionAngle >= 90) return fail('out-of-range', 'The friction angle runs from 0 to below 90 degrees.')
  if (depth <= 0) return fail('invalid-argument', 'The depth to the failure surface has to be greater than zero.')
  if (unitWeight <= 0) return fail('invalid-argument', 'The unit weight has to be greater than zero.')

  const cohesion = input.cohesion ?? 0
  if (!finite(cohesion) || cohesion < 0) return fail('invalid-argument', 'Cohesion cannot be negative.')
  const beta = (slopeAngle * Math.PI) / 180
  const phi = (frictionAngle * Math.PI) / 180
  const waterWeight = input.waterUnitWeight ?? 9.81

  const height = input.waterTableHeight ?? 0
  if (!finite(height) || height < 0) return fail('invalid-argument', 'The water table height cannot be negative.')
  if (height > depth) {
    return fail(
      'invalid-argument',
      `The water table is ${height} m above a failure surface only ${depth} m down, which would put it above the ground. For a slope with surface water flowing over it the model is different.`
    )
  }
  const saturated = height > 0

  // Normal and shear stress on a slope-parallel plane at this depth.
  const total = unitWeight * depth * Math.cos(beta) * Math.cos(beta)
  const driving = unitWeight * depth * Math.sin(beta) * Math.cos(beta)
  // Pore pressure from a water table parallel to the slope.
  const porePressure = saturated ? waterWeight * height * Math.cos(beta) * Math.cos(beta) : 0
  const effective = total - porePressure
  const resisting = cohesion + effective * Math.tan(phi)

  const factorOfSafety = driving === 0 ? Number.POSITIVE_INFINITY : resisting / driving

  // The steepest angle this soil holds, when there is no cohesion. With cohesion the critical angle depends on
  // depth as well and has no single closed form, so it is reported as null rather than approximated.
  const criticalAngle = cohesion === 0 && !saturated ? frictionAngle : null

  const warnings: string[] = []
  if (factorOfSafety < 1) {
    warnings.push(
      `The factor of safety is ${factorOfSafety.toFixed(3)}, below 1. By this calculation the slope does not hold. It is a simple model and a real slope has three-dimensional shape, roots and layering that this ignores — but below 1 is not a margin to argue over.`
    )
  } else if (factorOfSafety < 1.3) {
    warnings.push(
      `The factor of safety is ${factorOfSafety.toFixed(3)}. Design practice usually asks for 1.3 to 1.5, because the soil properties themselves are known to perhaps 20% and the failure surface is a guess.`
    )
  }
  if (saturated) {
    const dry = (cohesion + total * Math.tan(phi)) / driving
    warnings.push(
      `Dry, this slope would have a factor of safety of ${dry.toFixed(3)}; with the water table where it is, ${factorOfSafety.toFixed(3)}. The weight has not changed — water pressure is holding the grains apart and taking the friction away. This is why landslides happen in the rain.`
    )
  } else {
    warnings.push(
      'No water table was given, so this is the dry case and it is the optimistic one. Rain raises the pore pressure and cuts the factor of safety substantially without adding much weight.'
    )
  }

  return {
    method: 'infinite-slope',
    factorOfSafety,
    criticalAngle,
    drivingStress: driving,
    resistingStress: resisting,
    saturated,
    porePressure,
    notes: Object.freeze([
      'The infinite-slope method: a planar failure surface parallel to the ground, in uniform soil, with the slope long enough that the ends do not matter. Right for a shallow slide in a soil mantle, wrong for a deep rotational failure.',
      `Driving stress ${driving.toFixed(2)} kPa against resisting ${resisting.toFixed(2)} kPa, giving ${factorOfSafety.toFixed(3)}.`,
      criticalAngle !== null
        ? `With no cohesion and no water, a dry granular slope stands at up to its friction angle of ${frictionAngle} degrees and no steeper, whatever its depth. That is why dry sand always forms the same cone.`
        : 'With cohesion or groundwater present the critical angle depends on depth as well, so there is no single steepest angle to quote.',
      'A factor of safety is a ratio, not a prediction. It does not say when, and it carries the uncertainty of every soil property that went into it.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- rocks

export interface RockType {
  id: string
  name: string
  family: 'igneous' | 'sedimentary' | 'metamorphic'
  /** kg/m³. */
  density: number
  porosity: string
  /** MPa, unconfined compressive strength. */
  strength: number
  describe: string
  source: string
}

export const ROCK_TYPES: readonly RockType[] = Object.freeze([
  {
    id: 'granite',
    name: 'Granite',
    family: 'igneous',
    density: 2670,
    porosity: 'Under 1%',
    strength: 200,
    describe: 'Cooled slowly deep underground, so the crystals are large enough to see. Strong and nearly impermeable.',
    source: 'Typical values, Schön, Physical Properties of Rocks.'
  },
  {
    id: 'basalt',
    name: 'Basalt',
    family: 'igneous',
    density: 2900,
    porosity: '1 to 20%, mostly as gas bubbles',
    strength: 250,
    describe: 'Cooled fast at the surface, so the crystals are tiny. The ocean floor is made of it.',
    source: 'Typical values, Schön.'
  },
  {
    id: 'sandstone',
    name: 'Sandstone',
    family: 'sedimentary',
    density: 2200,
    porosity: '5 to 30%',
    strength: 70,
    describe: 'Cemented sand grains. The porosity is what makes it an aquifer and an oil reservoir.',
    source: 'Typical values, Schön.'
  },
  {
    id: 'limestone',
    name: 'Limestone',
    family: 'sedimentary',
    density: 2550,
    porosity: '1 to 30%',
    strength: 90,
    describe: 'Mostly calcium carbonate, often from shells. Dissolves in slightly acid water, which is how caves form.',
    source: 'Typical values, Schön.'
  },
  {
    id: 'shale',
    name: 'Shale',
    family: 'sedimentary',
    density: 2400,
    porosity: '5 to 30%, but almost none of it connected',
    strength: 30,
    describe: 'Compacted mud. High porosity and almost no permeability, which makes it the seal above a reservoir.',
    source: 'Typical values, Schön.'
  },
  {
    id: 'marble',
    name: 'Marble',
    family: 'metamorphic',
    density: 2700,
    porosity: 'Under 1%',
    strength: 100,
    describe: 'Limestone recrystallised by heat and pressure. The fossils are gone; the calcium carbonate is not.',
    source: 'Typical values, Schön.'
  },
  {
    id: 'slate',
    name: 'Slate',
    family: 'metamorphic',
    density: 2750,
    porosity: 'Under 1%',
    strength: 120,
    describe: 'Shale under pressure. Splits into sheets along a direction that has nothing to do with the original bedding.',
    source: 'Typical values, Schön.'
  },
  {
    id: 'gneiss',
    name: 'Gneiss',
    family: 'metamorphic',
    density: 2750,
    porosity: 'Under 1%',
    strength: 180,
    describe: 'Heavily metamorphosed, with the minerals separated into bands. Often was granite, sometimes was sediment.',
    source: 'Typical values, Schön.'
  }
])

export function rockById(id: string): RockType | GeologyError {
  const found = ROCK_TYPES.find((one) => one.id === id)
  return found ?? fail('invalid-argument', `"${id}" is not a rock this knows: ${ROCK_TYPES.map((one) => one.id).join(', ')}.`)
}

export interface OverburdenReport {
  /** Pascals. The weight of rock above. */
  totalStress: number
  /** Pascals. Water pressure at that depth. */
  porePressure: number
  /** Pascals. What the grain framework actually carries. */
  effectiveStress: number
  /** Degrees Celsius, from a geothermal gradient. */
  temperature: number | null
  depth: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Stress and temperature at depth, with total and effective stress kept apart.
 *
 * Effective stress is what the rock framework carries and it is what governs whether rock fails; total stress is
 * the weight above. They differ by the water pressure, and the difference is the mechanism behind induced
 * earthquakes — injecting fluid raises the pore pressure and cuts the effective stress without removing any of
 * the weight, which lets a fault slip that was otherwise held.
 */
export function overburdenStress(input: {
  /** Metres. */
  depth: number
  /** kg/m³. Bulk rock density. */
  density?: number
  rock?: string
  /** Metres. Depth to the water table. */
  waterTableDepth?: number
  /** Celsius per kilometre. */
  geothermalGradient?: number
  /** Celsius at the surface. */
  surfaceTemperature?: number
  gravity?: number
}): OverburdenReport | GeologyError {
  const { depth } = input
  if (!finite(depth) || depth < 0) return fail('invalid-argument', 'The depth cannot be negative.')

  let density: number
  if (input.density !== undefined) {
    density = input.density
  } else if (input.rock !== undefined) {
    const rock = rockById(input.rock)
    if (isGeologyError(rock)) return rock
    density = rock.density
  } else {
    return fail('invalid-argument', 'Give a density, or a rock type to look one up.')
  }
  if (!finite(density) || density <= 0) return fail('invalid-argument', 'The density has to be greater than zero.')

  const g = input.gravity ?? 9.80665
  const totalStress = density * g * depth
  const waterTable = input.waterTableDepth ?? 0
  if (!finite(waterTable) || waterTable < 0) return fail('invalid-argument', 'The water table depth cannot be negative.')
  const waterColumn = Math.max(0, depth - waterTable)
  const porePressure = 1000 * g * waterColumn

  let temperature: number | null = null
  if (input.geothermalGradient !== undefined) {
    if (!finite(input.geothermalGradient)) return fail('not-finite', 'The geothermal gradient has to be a finite number.')
    temperature = (input.surfaceTemperature ?? 15) + (input.geothermalGradient * depth) / 1000
  }

  const warnings: string[] = []
  if (porePressure > 0 && porePressure / totalStress > 0.45) {
    warnings.push(
      `Pore pressure is ${((porePressure / totalStress) * 100).toFixed(0)}% of the total stress, which is above normal hydrostatic. Overpressure like that is what makes a well blow out and what lets a fault slip that would otherwise hold.`
    )
  }

  return {
    totalStress,
    porePressure,
    effectiveStress: totalStress - porePressure,
    temperature,
    depth,
    notes: Object.freeze([
      `At ${depth} m the weight above gives ${(totalStress / 1e6).toFixed(3)} MPa of total stress, and about ${(totalStress / 1e6 / (depth / 1000)).toFixed(1)} MPa per kilometre is the usual rule.`,
      `Water pressure is ${(porePressure / 1e6).toFixed(3)} MPa, so the grain framework carries ${((totalStress - porePressure) / 1e6).toFixed(3)} MPa.`,
      'Effective stress, not total stress, governs whether rock fails. Raising the pore pressure cuts it without removing any weight, which is the mechanism behind earthquakes induced by fluid injection.',
      temperature !== null
        ? `At the gradient given the temperature here is about ${temperature.toFixed(1)} C. Gradients run from 15 C/km in old stable crust to over 50 in volcanic areas, so a single figure is a starting point rather than an answer.`
        : 'Give a geothermal gradient for the temperature at this depth.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const GEOLOGY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Earthquake magnitudes name their scale and are converted through radiated energy. Scales that saturate say where they saturate.',
  'Magnitude and intensity are different quantities. Magnitude is one number for the event; intensity varies from place to place.',
  'Radiometric ages carry the assumptions that make them meaningful, and the range where the system can actually resolve an age.',
  'Wave velocities are single crustal averages. Real paths bend and speed up with depth.',
  'Slope stability uses the infinite-slope method: a planar surface in uniform soil. It suits a shallow slide and not a deep rotational failure.',
  'Where groundwater is included, the dry case is reported alongside so the effect of pore pressure is visible rather than buried.',
  'Rock properties are typical values from a named source, and real rock of the same name varies by tens of percent.',
  'A factor of safety is a ratio, not a prediction. It carries the uncertainty of every property that went into it.'
])
