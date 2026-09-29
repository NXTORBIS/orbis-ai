/**
 * Agronomy: how much water a crop needs, how fast it develops, what the soil holds and what it is short of.
 *
 * The shared agronomy engine for Orbis Pages. Evapotranspiration is computed by FAO-56 Penman-Monteith rather than
 * approximated, soil water is separated into what is there and what a plant can actually reach, and a nutrient
 * recommendation is never produced without a soil test, because fertiliser advice without one is guesswork with
 * consequences.
 *
 * ## Why FAO-56 and not a simpler formula
 *
 * Penman-Monteith is the international standard reference method, and the simpler formulas — Hargreaves,
 * Thornthwaite, Blaney-Criddle — exist because it needs data that was hard to get before automatic weather
 * stations. They are 15-30% out in dry windy conditions, which is exactly when irrigation matters. Where the full
 * data is not available a simpler method is offered *by name*, with its bias stated.
 *
 * ## Why available water is not the water in the soil
 *
 * A soil holds water at field capacity and holds onto some of it so tightly that roots cannot pull it out. The
 * difference between field capacity and the permanent wilting point is the available water, and it is often half
 * of what is there. A plant in a clay soil with 30% water content can wilt while the number looks healthy.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * reference ET  vs  crop ET          -- a clipped grass surface against the actual crop, via Kc
 * potential     vs  actual ET        -- what it would use with enough water against what it got
 * water content vs  available water  -- what is there against what a root can pull out
 * total         vs  available nutrient -- what the soil holds against what dissolves this season
 * growing degree days vs  calendar days -- heat accumulated against time passed
 * yield         vs  yield potential  -- what came off the field against what the season allowed
 * ```
 *
 * Pure. No network, no clock, no storage. Every date is supplied; nothing reads the system time.
 */

export interface AgronomyError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'outside-model' | 'no-solution' | 'needs-soil-test' | 'too-many'
  message: string
}

export const isAgronomyError = (value: unknown): value is AgronomyError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: AgronomyError['error'], message: string): AgronomyError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const AGRONOMY_LIMITS = Object.freeze({ days: 400, layers: 16, nutrients: 12 })

// ---------------------------------------------------------------- evapotranspiration

export type EtMethod = 'penman-monteith' | 'hargreaves' | 'blaney-criddle'

export const ET_METHODS: readonly EtMethod[] = Object.freeze(['penman-monteith', 'hargreaves', 'blaney-criddle'])

export const ET_FACTS: Readonly<Record<EtMethod, { label: string; needs: string; bias: string; standing: string }>> =
  Object.freeze({
    'penman-monteith': {
      label: 'FAO-56 Penman-Monteith',
      needs: 'Maximum and minimum temperature, humidity, wind speed and solar radiation.',
      bias: 'None known. This is the reference every other method is compared against.',
      standing: 'The international standard, FAO Irrigation and Drainage Paper 56 (1998).'
    },
    hargreaves: {
      label: 'Hargreaves',
      needs: 'Maximum and minimum temperature, and the latitude and day of year for extraterrestrial radiation.',
      bias: 'Under-reads by 15 to 30% in dry windy conditions and over-reads in humid calm ones, because it cannot see wind or humidity at all.',
      standing: 'The FAO-recommended fallback when only temperature is available. Named rather than passed off as the reference.'
    },
    'blaney-criddle': {
      label: 'Blaney-Criddle',
      needs: 'Mean temperature and the daylight fraction of the year.',
      bias: 'Poor outside the western United States it was fitted in. Can be 40% out in a humid climate.',
      standing: 'Historic. Included because a great deal of older irrigation design is quoted in it, not because it should be used now.'
    }
  })

export interface EtReport {
  method: EtMethod
  label: string
  /** mm/day of water from a reference grass surface. */
  referenceEt: number
  /** mm/day from the actual crop, when a crop coefficient was given. */
  cropEt: number | null
  cropCoefficient: number | null
  /** MJ/m²/day. What the net radiation contributed. */
  radiationTerm: number | null
  /** MJ/m²/day. What the dry air and wind contributed. These two split the total. */
  aerodynamicTerm: number | null
  bias: string
  standing: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Reference evapotranspiration, and the crop's own if a coefficient is given.
 *
 * The radiation and aerodynamic terms are reported separately because they say what is actually driving the water
 * loss: on a still humid day almost all of it is radiation, and on a dry windy one the aerodynamic term can be
 * larger than the radiation. Irrigation advice that ignores wind fails on exactly the days when it matters.
 *
 * Reference ET is for a clipped grass surface, 0.12 m tall, with a fixed surface resistance. It is not what any
 * crop uses. The crop coefficient converts it, and it changes through the season — a coefficient quoted for "maize"
 * without a growth stage is not usable.
 */
export function evapotranspiration(input: {
  method?: EtMethod
  /** Celsius. */
  maximumTemperature: number
  minimumTemperature: number
  /** Percent. */
  relativeHumidity?: number
  /** m/s at 2 m. */
  windSpeed?: number
  /** MJ/m²/day. */
  solarRadiation?: number
  /** Metres above sea level, for the psychrometric constant. */
  altitude?: number
  /** Degrees, for extraterrestrial radiation. */
  latitudeDegrees?: number
  /** 1 to 366. */
  dayOfYear?: number
  cropCoefficient?: number
}): EtReport | AgronomyError {
  const method = input.method ?? 'penman-monteith'
  const facts = ET_FACTS[method]
  if (!facts) return fail('invalid-argument', `"${method}" is not one of: ${ET_METHODS.join(', ')}.`)

  const { maximumTemperature: tMax, minimumTemperature: tMin } = input
  for (const [name, value] of Object.entries({ maximumTemperature: tMax, minimumTemperature: tMin })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
  }
  if (tMin > tMax) return fail('invalid-argument', 'The minimum temperature is above the maximum. Check which is which.')

  const tMean = (tMax + tMin) / 2
  const altitude = input.altitude ?? 0
  const warnings: string[] = []

  // Extraterrestrial radiation, needed by the temperature-only methods and for checking solar radiation.
  let extraterrestrial: number | null = null
  if (input.latitudeDegrees !== undefined && input.dayOfYear !== undefined) {
    const { latitudeDegrees, dayOfYear } = input
    if (!finite(latitudeDegrees) || Math.abs(latitudeDegrees) > 90) return fail('out-of-range', 'The latitude runs from -90 to 90.')
    if (!Number.isInteger(dayOfYear) || dayOfYear < 1 || dayOfYear > 366) return fail('out-of-range', 'The day of year is a whole number from 1 to 366.')
    const phi = (latitudeDegrees * Math.PI) / 180
    const dr = 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365)
    const declination = 0.409 * Math.sin((2 * Math.PI * dayOfYear) / 365 - 1.39)
    const cosOmega = -Math.tan(phi) * Math.tan(declination)
    const omega = Math.acos(Math.max(-1, Math.min(1, cosOmega)))
    extraterrestrial =
      ((24 * 60) / Math.PI) * 0.0820 * dr * (omega * Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.sin(omega))
  }

  let referenceEt: number
  let radiationTerm: number | null = null
  let aerodynamicTerm: number | null = null

  if (method === 'hargreaves') {
    if (extraterrestrial === null) {
      return fail('invalid-argument', `${facts.label} needs ${facts.needs}`)
    }
    referenceEt = 0.0023 * (tMean + 17.8) * Math.sqrt(tMax - tMin) * (extraterrestrial / 2.45)
    warnings.push(facts.bias)
  } else if (method === 'blaney-criddle') {
    if (input.latitudeDegrees === undefined || input.dayOfYear === undefined) {
      return fail('invalid-argument', `${facts.label} needs ${facts.needs}`)
    }
    // p is the mean daily percentage of annual daylight hours, approximated from the day length.
    const phi = (input.latitudeDegrees * Math.PI) / 180
    const declination = 0.409 * Math.sin((2 * Math.PI * input.dayOfYear) / 365 - 1.39)
    const omega = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(declination))))
    const dayLength = (24 / Math.PI) * omega
    const p = (dayLength / (365 * 12)) * 100
    referenceEt = p * (0.46 * tMean + 8.13)
    warnings.push(facts.bias)
  } else {
    const { relativeHumidity: rh, windSpeed: wind, solarRadiation: solar } = input
    if (rh === undefined || wind === undefined || solar === undefined) {
      return fail('invalid-argument', `${facts.label} needs ${facts.needs} Give a simpler method by name if that data is not available — each states its own bias.`)
    }
    if (!finite(rh) || rh < 0 || rh > 100) return fail('out-of-range', 'Relative humidity is a percentage from 0 to 100.')
    if (!finite(wind) || wind < 0) return fail('invalid-argument', 'The wind speed cannot be negative.')
    if (!finite(solar) || solar < 0) return fail('invalid-argument', 'The solar radiation cannot be negative.')
    if (extraterrestrial !== null && solar > extraterrestrial) {
      warnings.push(
        `The solar radiation given (${solar} MJ/m2/day) is above what reaches the top of the atmosphere here (${extraterrestrial.toFixed(1)}). One of the two is wrong, or the units are not MJ/m2/day.`
      )
    }

    // FAO-56, equation 6, with the standard constants for a clipped grass reference surface.
    const pressure = 101.3 * Math.pow((293 - 0.0065 * altitude) / 293, 5.26)
    const psychrometric = 0.000665 * pressure
    const saturationAt = (t: number): number => 0.6108 * Math.exp((17.27 * t) / (t + 237.3))
    const es = (saturationAt(tMax) + saturationAt(tMin)) / 2
    const ea = (rh / 100) * es
    const slope = (4098 * saturationAt(tMean)) / Math.pow(tMean + 237.3, 2)
    // Net radiation, taken as 0.77 of the incoming shortwave less the standard longwave loss.
    const netShortwave = 0.77 * solar
    const clearSky = extraterrestrial !== null ? (0.75 + 2e-5 * altitude) * extraterrestrial : solar / 0.75
    const cloudiness = clearSky > 0 ? Math.max(0, Math.min(1, solar / clearSky)) : 1
    const netLongwave =
      4.903e-9 *
      ((Math.pow(tMax + 273.16, 4) + Math.pow(tMin + 273.16, 4)) / 2) *
      (0.34 - 0.14 * Math.sqrt(Math.max(ea, 0))) *
      (1.35 * cloudiness - 0.35)
    const netRadiation = netShortwave - netLongwave

    const wind2 = wind
    radiationTerm = (0.408 * slope * netRadiation) / (slope + psychrometric * (1 + 0.34 * wind2))
    aerodynamicTerm =
      (psychrometric * (900 / (tMean + 273)) * wind2 * (es - ea)) / (slope + psychrometric * (1 + 0.34 * wind2))
    referenceEt = radiationTerm + aerodynamicTerm

    if (aerodynamicTerm > radiationTerm) {
      warnings.push(
        `The dry-air and wind term (${aerodynamicTerm.toFixed(2)} mm) is larger than the radiation term (${radiationTerm.toFixed(2)} mm). On a day like this the wind is doing more than the sun, and any method that cannot see wind will under-read badly.`
      )
    }
  }

  if (referenceEt < 0) referenceEt = 0

  const kc = input.cropCoefficient ?? null
  if (kc !== null && (!finite(kc) || kc < 0 || kc > 2)) {
    return fail('out-of-range', 'A crop coefficient runs from 0 to about 1.5. Above 2 is not a crop.')
  }

  return {
    method,
    label: facts.label,
    referenceEt,
    cropEt: kc === null ? null : referenceEt * kc,
    cropCoefficient: kc,
    radiationTerm,
    aerodynamicTerm,
    bias: facts.bias,
    standing: facts.standing,
    notes: Object.freeze([
      `${facts.label}. ${facts.standing} Bias: ${facts.bias}`,
      `Reference ET is ${referenceEt.toFixed(3)} mm/day. That is for clipped grass 0.12 m tall — not for any actual crop.`,
      kc === null
        ? 'Give a crop coefficient for the crop’s own water use. The coefficient changes through the season, so one quoted for a crop without a growth stage is not usable.'
        : `With a crop coefficient of ${kc}, this crop uses about ${(referenceEt * kc).toFixed(3)} mm/day. Check the coefficient matches the growth stage — it can nearly double between emergence and full canopy.`,
      radiationTerm !== null
        ? `Radiation supplied ${radiationTerm.toFixed(3)} mm and dry air with wind supplied ${(aerodynamicTerm as number).toFixed(3)} mm. Which dominates decides whether shelter or shade would help more.`
        : 'This method does not separate the radiation and wind contributions, because it cannot see wind.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- growing degree days

export interface DegreeDayReport {
  /** Accumulated degree days over the run. */
  accumulated: number
  /** Per day, so a chart can show when development sped up. */
  daily: readonly { day: number; degreeDays: number; cumulative: number }[]
  baseTemperature: number
  upperThreshold: number | null
  /** The day the target was reached, when one was given. */
  dayTargetReached: number | null
  method: 'simple-average' | 'capped-average'
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Growing degree days, with the upper cap that most calculations leave out.
 *
 * Above about 30 degrees most temperate crops stop developing faster and start being damaged, so heat beyond that
 * should not be counted as progress. An uncapped total over a hot summer says a crop should be ready a fortnight
 * before it is. The cap is optional because some crops genuinely have none, and which was used is reported.
 *
 * Negative daily values are clamped to zero rather than subtracted: a cold day does not undo development.
 */
export function growingDegreeDays(input: {
  days: readonly { maximum: number; minimum: number }[]
  /** Celsius. Below this the crop does not develop. 10 for maize, 0 for wheat. */
  baseTemperature: number
  /** Celsius. Above this extra heat is not progress. */
  upperThreshold?: number
  /** Accumulated degree days to reach, to find the day it happens. */
  target?: number
}): DegreeDayReport | AgronomyError {
  const { days, baseTemperature } = input
  if (days.length === 0) return fail('invalid-argument', 'There are no days to add up.')
  if (days.length > AGRONOMY_LIMITS.days) return fail('too-many', `That is ${days.length} days; this handles up to ${AGRONOMY_LIMITS.days}.`)
  if (!finite(baseTemperature)) return fail('not-finite', 'The base temperature has to be a finite number.')
  const cap = input.upperThreshold
  if (cap !== undefined) {
    if (!finite(cap)) return fail('not-finite', 'The upper threshold has to be a finite number.')
    if (cap <= baseTemperature) return fail('invalid-argument', 'The upper threshold is at or below the base temperature, which leaves no range for development.')
  }

  const daily: DegreeDayReport['daily'][number][] = []
  let cumulative = 0
  let dayTargetReached: number | null = null
  const warnings: string[] = []
  let cappedDays = 0

  for (const [i, one] of days.entries()) {
    if (!finite(one.maximum) || !finite(one.minimum)) return fail('not-finite', `Day ${i + 1} has a temperature that is not finite.`)
    if (one.minimum > one.maximum) return fail('invalid-argument', `Day ${i + 1} has a minimum above its maximum.`)
    let max = one.maximum
    let min = one.minimum
    if (cap !== undefined) {
      if (max > cap) {
        max = cap
        cappedDays += 1
      }
      if (min > cap) min = cap
    }
    // Clamped, not subtracted: a cold day does not undo development.
    const contribution = Math.max(0, (max + min) / 2 - baseTemperature)
    cumulative += contribution
    daily.push({ day: i + 1, degreeDays: contribution, cumulative })
    if (dayTargetReached === null && input.target !== undefined && cumulative >= input.target) {
      dayTargetReached = i + 1
    }
  }

  if (cap === undefined) {
    warnings.push(
      'No upper threshold was set, so every degree of heat counts as progress. Most temperate crops stop developing faster above about 30 C and start being damaged, so an uncapped total over a hot summer predicts maturity a fortnight early.'
    )
  } else if (cappedDays > 0) {
    warnings.push(`${cappedDays} of ${days.length} days were hot enough to hit the ${cap} C cap. Heat above it was not counted as progress, which is the point of having one.`)
  }
  if (input.target !== undefined && dayTargetReached === null) {
    warnings.push(`The target of ${input.target} degree days was not reached: the run ended at ${cumulative.toFixed(1)}.`)
  }

  return {
    accumulated: cumulative,
    daily: Object.freeze(daily),
    baseTemperature,
    upperThreshold: cap ?? null,
    dayTargetReached,
    method: cap === undefined ? 'simple-average' : 'capped-average',
    notes: Object.freeze([
      `${cumulative.toFixed(1)} degree days over ${days.length} days, above a base of ${baseTemperature} C.`,
      'Degree days measure heat accumulated rather than time passed, which is why a crop matures in different numbers of calendar days in different years and the same number of degree days.',
      'The base temperature is a property of the crop. Using maize’s base of 10 for wheat, which develops from 0, understates the accumulation badly in a cool spring.',
      'A negative day contributes zero rather than subtracting. Cold does not undo development already made.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- soil water

export type SoilTexture =
  | 'sand'
  | 'loamy-sand'
  | 'sandy-loam'
  | 'loam'
  | 'silt-loam'
  | 'silt'
  | 'clay-loam'
  | 'silty-clay-loam'
  | 'clay'

export const SOIL_TEXTURES: readonly SoilTexture[] = Object.freeze([
  'sand',
  'loamy-sand',
  'sandy-loam',
  'loam',
  'silt-loam',
  'silt',
  'clay-loam',
  'silty-clay-loam',
  'clay'
])

/**
 * Soil water constants by texture, from the USDA. Volumetric fractions.
 *
 * Held as data with a source because these are measured averages, and the spread within a texture class is wide —
 * two loams can differ by a third in available water depending on organic matter and structure. A field
 * measurement always beats this table, which is why the table says so.
 */
export const SOIL_WATER: Readonly<
  Record<SoilTexture, { label: string; fieldCapacity: number; wiltingPoint: number; saturation: number; infiltration: number }>
> = Object.freeze({
  sand: { label: 'Sand', fieldCapacity: 0.1, wiltingPoint: 0.05, saturation: 0.44, infiltration: 50 },
  'loamy-sand': { label: 'Loamy sand', fieldCapacity: 0.12, wiltingPoint: 0.05, saturation: 0.44, infiltration: 35 },
  'sandy-loam': { label: 'Sandy loam', fieldCapacity: 0.18, wiltingPoint: 0.08, saturation: 0.45, infiltration: 25 },
  loam: { label: 'Loam', fieldCapacity: 0.28, wiltingPoint: 0.14, saturation: 0.46, infiltration: 13 },
  'silt-loam': { label: 'Silt loam', fieldCapacity: 0.31, wiltingPoint: 0.11, saturation: 0.5, infiltration: 7 },
  silt: { label: 'Silt', fieldCapacity: 0.3, wiltingPoint: 0.06, saturation: 0.49, infiltration: 6 },
  'clay-loam': { label: 'Clay loam', fieldCapacity: 0.36, wiltingPoint: 0.22, saturation: 0.46, infiltration: 4 },
  'silty-clay-loam': { label: 'Silty clay loam', fieldCapacity: 0.38, wiltingPoint: 0.22, saturation: 0.47, infiltration: 3 },
  clay: { label: 'Clay', fieldCapacity: 0.4, wiltingPoint: 0.27, saturation: 0.48, infiltration: 1 }
})

export const SOIL_WATER_SOURCE =
  'USDA-NRCS National Engineering Handbook Part 652 and Saxton-Rawls pedotransfer functions. Class averages; two soils of the same texture can differ by a third.'

export interface SoilWaterReport {
  texture: SoilTexture
  label: string
  /** Volumetric fraction. */
  fieldCapacity: number
  wiltingPoint: number
  /** Volumetric fraction. What a plant can actually pull out. Often half of what is there. */
  availableWaterFraction: number
  /** mm over the root depth. */
  totalAvailableWater: number
  /** mm currently available, when a water content was given. */
  currentlyAvailable: number | null
  /** The fraction of available water already used. */
  depletion: number | null
  /** mm. The point at which the crop starts being stressed. */
  readilyAvailable: number
  /** Whether irrigation is due, if a depletion fraction was given. */
  irrigationDue: boolean | null
  /** mm to bring it back to field capacity. */
  irrigationRequired: number | null
  source: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * How much water a soil holds and how much of it a plant can reach.
 *
 * The important number here is available water, not water content. A clay soil at 25% water content has almost
 * nothing a plant can use because its wilting point is 27%; a sandy loam at the same 25% is above field capacity
 * and draining. The same reading means opposite things in the two soils, so the reading alone is not an answer.
 */
export function soilWater(input: {
  texture?: SoilTexture
  /** Volumetric fractions, to override the table with a measurement. */
  fieldCapacity?: number
  wiltingPoint?: number
  /** Metres. */
  rootDepth: number
  /** Volumetric fraction, measured now. */
  currentWaterContent?: number
  /** The fraction of available water the crop tolerates losing before it is stressed. 0.5 is typical. */
  allowableDepletion?: number
}): SoilWaterReport | AgronomyError {
  const { rootDepth } = input
  if (!finite(rootDepth) || rootDepth <= 0) return fail('invalid-argument', 'The root depth has to be greater than zero metres.')

  let texture: SoilTexture
  let fieldCapacity: number
  let wiltingPoint: number

  if (input.fieldCapacity !== undefined && input.wiltingPoint !== undefined) {
    texture = input.texture ?? 'loam'
    fieldCapacity = input.fieldCapacity
    wiltingPoint = input.wiltingPoint
  } else {
    if (input.texture === undefined) {
      return fail('invalid-argument', `Give a texture, or a measured field capacity and wilting point. Textures: ${SOIL_TEXTURES.join(', ')}.`)
    }
    const facts = SOIL_WATER[input.texture]
    if (!facts) return fail('invalid-argument', `"${input.texture}" is not a texture this knows: ${SOIL_TEXTURES.join(', ')}.`)
    texture = input.texture
    fieldCapacity = facts.fieldCapacity
    wiltingPoint = facts.wiltingPoint
  }

  for (const [name, value] of Object.entries({ fieldCapacity, wiltingPoint })) {
    if (!finite(value) || value <= 0 || value > 1) return fail('out-of-range', `"${name}" is a volumetric fraction between 0 and 1.`)
  }
  if (wiltingPoint >= fieldCapacity) {
    return fail(
      'invalid-argument',
      'The wilting point is at or above field capacity, which would leave no water a plant could use at all. Check which is which.'
    )
  }

  const availableFraction = fieldCapacity - wiltingPoint
  const totalAvailable = availableFraction * rootDepth * 1000
  const depletionFraction = input.allowableDepletion ?? 0.5
  if (!finite(depletionFraction) || depletionFraction <= 0 || depletionFraction > 1) {
    return fail('out-of-range', 'The allowable depletion is a fraction from just above 0 to 1.')
  }
  const readilyAvailable = totalAvailable * depletionFraction

  let currentlyAvailable: number | null = null
  let depletion: number | null = null
  let irrigationDue: boolean | null = null
  let irrigationRequired: number | null = null
  const warnings: string[] = []

  if (input.currentWaterContent !== undefined) {
    const theta = input.currentWaterContent
    if (!finite(theta) || theta < 0 || theta > 1) return fail('out-of-range', 'The water content is a volumetric fraction between 0 and 1.')
    currentlyAvailable = Math.max(0, (theta - wiltingPoint) * rootDepth * 1000)
    depletion = totalAvailable === 0 ? 0 : 1 - currentlyAvailable / totalAvailable
    irrigationDue = depletion >= depletionFraction
    irrigationRequired = Math.max(0, (fieldCapacity - theta) * rootDepth * 1000)

    if (theta < wiltingPoint) {
      warnings.push(
        `The water content of ${(theta * 100).toFixed(1)}% is below this soil’s wilting point of ${(wiltingPoint * 100).toFixed(1)}%. There is water in the soil and the plant cannot get any of it — the reading looking non-zero is exactly why water content alone is not an answer.`
      )
    }
    if (theta > fieldCapacity) {
      warnings.push(
        `The water content is above field capacity, so the excess is draining away and taking dissolved nitrogen with it. Irrigating now adds to that rather than to the crop.`
      )
    }
  }

  return {
    texture,
    label: SOIL_WATER[texture]?.label ?? 'measured soil',
    fieldCapacity,
    wiltingPoint,
    availableWaterFraction: availableFraction,
    totalAvailableWater: totalAvailable,
    currentlyAvailable,
    depletion,
    readilyAvailable,
    irrigationDue,
    irrigationRequired,
    source: input.fieldCapacity !== undefined ? 'Measured values as given.' : SOIL_WATER_SOURCE,
    notes: Object.freeze([
      `${SOIL_WATER[texture]?.label ?? 'This soil'} holds ${(fieldCapacity * 100).toFixed(1)}% water at field capacity and holds on to ${(wiltingPoint * 100).toFixed(1)}% too tightly for roots. The difference, ${(availableFraction * 100).toFixed(1)}%, is all a plant can use.`,
      `Over ${rootDepth} m of root zone that is ${totalAvailable.toFixed(1)} mm of available water — ${(totalAvailable / 1).toFixed(0)} mm, or about ${(totalAvailable / 5).toFixed(0)} days of use at 5 mm/day.`,
      `Irrigation is usually scheduled at ${(depletionFraction * 100).toFixed(0)}% depletion, which is ${readilyAvailable.toFixed(1)} mm used. Waiting longer costs yield before the plant shows any sign of it.`,
      input.fieldCapacity !== undefined ? 'Using the measured values given.' : SOIL_WATER_SOURCE
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- nutrients

export type Nutrient = 'nitrogen' | 'phosphorus' | 'potassium' | 'sulphur' | 'magnesium' | 'calcium'

export const NUTRIENTS: readonly Nutrient[] = Object.freeze([
  'nitrogen',
  'phosphorus',
  'potassium',
  'sulphur',
  'magnesium',
  'calcium'
])

export const NUTRIENT_FACTS: Readonly<
  Record<Nutrient, { label: string; symbol: string; mobile: boolean; role: string; lossRoute: string }>
> = Object.freeze({
  nitrogen: {
    label: 'Nitrogen',
    symbol: 'N',
    mobile: true,
    role: 'Leaf and stem growth, and every protein. The one crops most often run short of.',
    lossRoute: 'Leaches with drainage water and escapes as gas from wet soil. Applying it all at once loses most of it.'
  },
  phosphorus: {
    label: 'Phosphorus',
    symbol: 'P',
    mobile: false,
    role: 'Root development and energy transfer. Needed early.',
    lossRoute: 'Barely moves in soil and does not leach, but binds to soil minerals so most of what is applied is unavailable for years. Lost to water by erosion of the soil itself.'
  },
  potassium: {
    label: 'Potassium',
    symbol: 'K',
    mobile: true,
    role: 'Water regulation and disease resistance. Held on clay surfaces.',
    lossRoute: 'Leaches from sandy soils, held well by clay.'
  },
  sulphur: {
    label: 'Sulphur',
    symbol: 'S',
    mobile: true,
    role: 'Proteins and oils. Became limiting in many places once industrial air pollution was cleaned up.',
    lossRoute: 'Leaches as sulphate.'
  },
  magnesium: {
    label: 'Magnesium',
    symbol: 'Mg',
    mobile: true,
    role: 'The centre of every chlorophyll molecule.',
    lossRoute: 'Leaches, and is crowded out by heavy potassium application.'
  },
  calcium: {
    label: 'Calcium',
    symbol: 'Ca',
    mobile: false,
    role: 'Cell walls, and soil structure. Usually plentiful except in acid soils.',
    lossRoute: 'Leaches slowly; lost mainly by acidification.'
  }
})

export interface NutrientReport {
  /** Per nutrient, what the crop needs and what the soil is short of. */
  each: readonly {
    nutrient: Nutrient
    label: string
    /** kg/ha the crop will remove. */
    cropRemoval: number
    /** kg/ha the soil test says is available. */
    soilSupply: number
    /** kg/ha the shortfall, before any efficiency allowance. */
    deficit: number
    /** kg/ha to apply, after allowing for how much of it the crop will actually get. */
    applicationRate: number
    useEfficiency: number
    mobile: boolean
    advice: string
  }[]
  /** Whether a soil test was supplied for every nutrient asked about. */
  fromSoilTest: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * A nutrient balance, from a soil test and a yield target.
 *
 * This refuses to produce a recommendation without a soil test, which is the whole design of it. Fertiliser advice
 * from a crop and a yield figure alone is a guess, it costs money when it is too high and yield when it is too
 * low, and the excess ends up in water. The soil supply is the only part of the calculation that is specific to the
 * field.
 *
 * Use efficiency is applied explicitly rather than folded in, because it differs enormously: about 50-70% of
 * applied nitrogen reaches the crop in the year it is applied, and 15-25% of applied phosphorus. A recommendation
 * that ignores that under-applies phosphorus fourfold.
 */
export function nutrientBalance(input: {
  /** Per nutrient: what the crop removes and what the soil test found, in kg/ha. */
  requirements: readonly { nutrient: Nutrient; cropRemoval: number; soilSupply?: number; useEfficiency?: number }[]
}): NutrientReport | AgronomyError {
  if (input.requirements.length === 0) return fail('invalid-argument', 'No nutrients were given.')
  if (input.requirements.length > AGRONOMY_LIMITS.nutrients) {
    return fail('too-many', `That is more than the ${AGRONOMY_LIMITS.nutrients} nutrients this handles.`)
  }

  const missing = input.requirements.filter((one) => one.soilSupply === undefined).map((one) => one.nutrient)
  if (missing.length > 0) {
    return fail(
      'needs-soil-test',
      `No soil test value was given for ${missing.join(', ')}. A fertiliser recommendation without one is a guess: too high wastes money and pollutes water, too low costs yield, and the soil supply is the only part of this calculation that is specific to your field. Get a test, or give the value you have.`
    )
  }

  const defaultEfficiency: Readonly<Record<Nutrient, number>> = {
    nitrogen: 0.6,
    phosphorus: 0.2,
    potassium: 0.6,
    sulphur: 0.5,
    magnesium: 0.5,
    calcium: 0.5
  }

  const each: NutrientReport['each'][number][] = []
  const warnings: string[] = []

  for (const one of input.requirements) {
    const facts = NUTRIENT_FACTS[one.nutrient]
    if (!facts) return fail('invalid-argument', `"${one.nutrient}" is not one of: ${NUTRIENTS.join(', ')}.`)
    if (!finite(one.cropRemoval) || one.cropRemoval < 0) return fail('invalid-argument', `The ${one.nutrient} crop removal has to be zero or more.`)
    const supply = one.soilSupply as number
    if (!finite(supply) || supply < 0) return fail('invalid-argument', `The ${one.nutrient} soil supply has to be zero or more.`)
    const efficiency = one.useEfficiency ?? defaultEfficiency[one.nutrient]
    if (!finite(efficiency) || efficiency <= 0 || efficiency > 1) {
      return fail('out-of-range', `The ${one.nutrient} use efficiency is a fraction from just above 0 to 1.`)
    }

    const deficit = Math.max(0, one.cropRemoval - supply)
    const applicationRate = deficit / efficiency

    each.push({
      nutrient: one.nutrient,
      label: facts.label,
      cropRemoval: one.cropRemoval,
      soilSupply: supply,
      deficit,
      applicationRate,
      useEfficiency: efficiency,
      mobile: facts.mobile,
      advice:
        deficit === 0
          ? `The soil already supplies the ${one.cropRemoval} kg/ha this crop removes. Applying more adds cost and, for a mobile nutrient, goes into water.`
          : facts.mobile
            ? `Apply ${applicationRate.toFixed(1)} kg/ha, split through the season. ${facts.lossRoute}`
            : `Apply ${applicationRate.toFixed(1)} kg/ha. ${facts.lossRoute}`
    })

    if (supply > one.cropRemoval * 2) {
      warnings.push(
        `The soil supplies more than twice the ${one.nutrient} this crop removes. There is no agronomic case for applying any, and for a mobile nutrient the surplus will reach groundwater.`
      )
    }
    if (applicationRate > one.cropRemoval * 3) {
      warnings.push(
        `The ${one.nutrient} application rate of ${applicationRate.toFixed(0)} kg/ha is over three times what the crop removes, because the use efficiency is only ${(efficiency * 100).toFixed(0)}%. That is real for phosphorus, which binds to the soil, and worth questioning for anything else.`
      )
    }
  }

  return {
    each: Object.freeze(each),
    fromSoilTest: true,
    notes: Object.freeze([
      'Every rate here is the shortfall between what the crop removes and what the soil supplies, divided by the fraction of applied nutrient the crop actually gets.',
      'That efficiency differs enormously between nutrients — roughly 60% for nitrogen and 20% for phosphorus — so ignoring it under-applies phosphorus fourfold.',
      'Mobile nutrients should be split through the season. Applying a season’s nitrogen at once loses most of it to drainage before the crop needs it.',
      'This is a balance calculation, not a local recommendation. Regional advisory services account for soil type, previous cropping and rainfall in ways a balance cannot.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const AGRONOMY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Reference evapotranspiration is FAO-56 Penman-Monteith for clipped grass. Simpler methods are available by name and state their own bias.',
  'Reference ET is not crop ET. The crop coefficient converts it and changes through the season; one quoted without a growth stage is not usable.',
  'The radiation and wind contributions to ET are reported separately, because which dominates decides what would actually help.',
  'Growing degree days clamp negative days to zero and offer an upper cap. Without a cap a hot summer predicts maturity a fortnight early.',
  'Soil water constants are class averages from a named source. Two soils of the same texture can differ by a third, and a field measurement always beats the table.',
  'Available water, not water content, is what a plant can use. The same reading means opposite things in sand and in clay.',
  'A fertiliser recommendation is refused without a soil test. The soil supply is the only part of the calculation specific to the field.',
  'Nutrient use efficiency is applied explicitly and differs by nutrient by a factor of three.'
])
