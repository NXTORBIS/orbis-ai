/**
 * The atmosphere: standard air, humidity, stability, comfort indices and air quality.
 *
 * The shared atmosphere engine for Orbis Pages. Humidity is computed from a named saturation-pressure formula
 * rather than a lookup, comfort indices carry the range they were fitted over, and an index asked for outside that
 * range is refused rather than extrapolated — because a heat index quoted for a cold day is a number with no
 * meaning that reads like a measurement.
 *
 * ## Why the saturation formula is named
 *
 * Every humidity calculation rests on the saturation vapour pressure of water, and there are half a dozen
 * formulas for it that disagree in the third decimal place — more than that below freezing, where whether the
 * formula is over water or over ice changes the answer by several percent. The formula is named on every result
 * and the over-ice case is handled separately instead of being let slide.
 *
 * ## Why an index outside its range is a refusal
 *
 * The heat index was fitted above 27 degrees; wind chill was fitted below 10 degrees and above 4.8 km/h of wind.
 * Outside those, the polynomials produce numbers that are not wrong so much as meaningless. A Page showing "feels
 * like 31" for a calm 5-degree day has shown a fabrication, so those cases refuse and say what applies instead.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * relative     vs  absolute humidity  -- a percentage of saturation against grams of water per cubic metre
 * dew point    vs  wet bulb           -- when it condenses against how cold evaporation can get it
 * temperature  vs  apparent temperature -- what a thermometer reads against what a body feels
 * pressure     vs  density altitude   -- what the altimeter says against what the wing feels
 * dry          vs  saturated lapse rate -- 9.8 K/km against about 5, and which one applies depends on the cloud
 * AQI          vs  concentration      -- a scaled index against micrograms per cubic metre
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface AtmosphereError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'outside-model' | 'no-solution'
  message: string
}

export const isAtmosphereError = (value: unknown): value is AtmosphereError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: AtmosphereError['error'], message: string): AtmosphereError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const ATMOSPHERE_LIMITS = Object.freeze({ samples: 2000, pollutants: 12 })

/** Sea-level conditions of the International Standard Atmosphere, which everything below is referred to. */
export const STANDARD_ATMOSPHERE = Object.freeze({
  seaLevelPressure: 101325,
  seaLevelTemperature: 288.15,
  seaLevelDensity: 1.225,
  /** K/m through the troposphere. */
  lapseRate: 0.0065,
  tropopauseAltitude: 11000,
  gasConstantDryAir: 287.0528,
  gravity: 9.80665,
  source: 'ISO 2533:1975, the International Standard Atmosphere.'
})

/** The dry adiabatic lapse rate: how fast rising unsaturated air cools, from expansion alone. K/m. */
export const DRY_ADIABATIC_LAPSE_RATE = 0.0098

// ---------------------------------------------------------------- standard atmosphere

export interface StandardAirReport {
  altitude: number
  /** Kelvin. */
  temperature: number
  /** Pascals. */
  pressure: number
  /** kg/m³. */
  density: number
  /** m/s. */
  speedOfSound: number
  /** As a fraction of the sea-level value, which is what an engine or a wing actually cares about. */
  densityRatio: number
  layer: 'troposphere' | 'lower-stratosphere'
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The standard atmosphere at an altitude.
 *
 * This is a model, not a measurement: it describes an average day that never actually occurs. Real air at 2000 m
 * can be twenty degrees either side of what this says. It is the reference everything aeronautical is quoted
 * against, which is what makes it useful, and it is not a forecast.
 */
export function standardAir(input: { altitude: number }): StandardAirReport | AtmosphereError {
  const { altitude } = input
  if (!finite(altitude)) return fail('not-finite', 'The altitude has to be a finite number.')
  if (altitude < -5000 || altitude > 32000) {
    return fail(
      'out-of-range',
      `The standard atmosphere as implemented here covers -5000 m to 32000 m. ${altitude} m is outside that; above 32 km the model has further layers with different lapse rates.`
    )
  }

  const { seaLevelPressure: p0, seaLevelTemperature: t0, lapseRate: L, gasConstantDryAir: R, gravity: g } = STANDARD_ATMOSPHERE
  let temperature: number
  let pressure: number
  let layer: StandardAirReport['layer']

  if (altitude <= STANDARD_ATMOSPHERE.tropopauseAltitude) {
    layer = 'troposphere'
    temperature = t0 - L * altitude
    pressure = p0 * Math.pow(temperature / t0, g / (R * L))
  } else {
    layer = 'lower-stratosphere'
    // Isothermal above the tropopause, so the pressure falls exponentially rather than as a power.
    const tropopauseTemperature = t0 - L * STANDARD_ATMOSPHERE.tropopauseAltitude
    const tropopausePressure = p0 * Math.pow(tropopauseTemperature / t0, g / (R * L))
    temperature = tropopauseTemperature
    pressure = tropopausePressure * Math.exp((-g * (altitude - STANDARD_ATMOSPHERE.tropopauseAltitude)) / (R * tropopauseTemperature))
  }

  const density = pressure / (R * temperature)
  const speedOfSound = Math.sqrt(1.4 * R * temperature)

  const warnings: string[] = []
  if (altitude > 3000) {
    warnings.push(
      `At ${altitude} m the air is ${((1 - density / STANDARD_ATMOSPHERE.seaLevelDensity) * 100).toFixed(0)}% thinner than at sea level. Engines, wings and people all lose performance in proportion.`
    )
  }

  return {
    altitude,
    temperature,
    pressure,
    density,
    speedOfSound,
    densityRatio: density / STANDARD_ATMOSPHERE.seaLevelDensity,
    layer,
    notes: Object.freeze([
      `${STANDARD_ATMOSPHERE.source} This is an average day that never actually happens — real air at this height can be twenty degrees either side.`,
      layer === 'troposphere'
        ? `In the troposphere the temperature falls at ${(STANDARD_ATMOSPHERE.lapseRate * 1000).toFixed(1)} K per kilometre and the pressure follows as a power of the temperature ratio.`
        : 'Above the tropopause the model is isothermal, so the pressure falls exponentially rather than as a power.',
      `The speed of sound here is ${speedOfSound.toFixed(1)} m/s. It depends on temperature alone, not on pressure or density.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

/**
 * Altitude from a pressure reading, and the density altitude that goes with it.
 *
 * Pressure altitude is what the altimeter reads; density altitude is what the wing and the engine feel, and on a
 * hot day at a high airfield the two differ by thousands of feet. Confusing them is a recurring cause of aircraft
 * failing to clear obstacles, so both are reported and each is named.
 */
export interface AltitudeReport {
  /** Metres. From pressure alone, against the standard atmosphere. */
  pressureAltitude: number
  /** Metres. The altitude at which standard air would have this density. */
  densityAltitude: number | null
  /** kg/m³, when a temperature was given. */
  density: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

export function altitudeFromPressure(input: {
  pressure: number
  /** Kelvin. Actual air temperature, for density altitude. */
  temperature?: number
}): AltitudeReport | AtmosphereError {
  const { pressure } = input
  if (!finite(pressure) || pressure <= 0) return fail('invalid-argument', 'The pressure has to be greater than zero.')
  const { seaLevelPressure: p0, seaLevelTemperature: t0, lapseRate: L, gasConstantDryAir: R, gravity: g } = STANDARD_ATMOSPHERE
  if (pressure > p0 * 1.5) return fail('out-of-range', 'That pressure is far above sea level pressure, which would put this below the bottom of the model.')

  const exponent = (R * L) / g
  const pressureAltitude = (t0 / L) * (1 - Math.pow(pressure / p0, exponent))

  let densityAltitude: number | null = null
  let density: number | null = null
  const warnings: string[] = []
  if (input.temperature !== undefined) {
    if (!finite(input.temperature) || input.temperature <= 0) {
      return fail('invalid-argument', 'The temperature is in kelvin, so it has to be greater than zero.')
    }
    density = pressure / (R * input.temperature)
    const ratio = density / STANDARD_ATMOSPHERE.seaLevelDensity
    // Invert the standard-atmosphere density profile.
    densityAltitude = (t0 / L) * (1 - Math.pow(ratio, 1 / (g / (R * L) - 1)))
    const gap = densityAltitude - pressureAltitude
    if (Math.abs(gap) > 300) {
      warnings.push(
        `The density altitude is ${gap > 0 ? '' : '-'}${Math.abs(gap).toFixed(0)} m ${gap > 0 ? 'above' : 'below'} the pressure altitude. The altimeter reads the pressure figure and the aircraft performs to the density one; on a hot day at height that difference is what fails to clear the trees.`
      )
    }
  }

  return {
    pressureAltitude,
    densityAltitude,
    density,
    notes: Object.freeze([
      'Pressure altitude is what an altimeter set to the standard pressure reads. It is a pressure measurement dressed as a height, and on a non-standard day it is not the height above the ground.',
      densityAltitude === null
        ? 'Give a temperature and this will also report the density altitude, which is the one that decides how an engine and a wing actually perform.'
        : 'Density altitude is the height at which standard air would be this thin. It is the number that matters for performance.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- humidity

export type SaturationFormula = 'magnus-tetens' | 'buck' | 'goff-gratch'

export const SATURATION_FORMULAS: readonly SaturationFormula[] = Object.freeze(['magnus-tetens', 'buck', 'goff-gratch'])

export const SATURATION_FACTS: Readonly<Record<SaturationFormula, { label: string; validFor: string; accuracy: string }>> =
  Object.freeze({
    'magnus-tetens': {
      label: 'Magnus-Tetens',
      validFor: '-45 to 60 C over water.',
      accuracy: 'Within about 0.4% over its range. The usual choice, and the simplest.'
    },
    buck: {
      label: 'Buck (1981, 1996)',
      validFor: '-80 to 50 C, with separate coefficients over ice.',
      accuracy: 'Within about 0.05%. Worth using below freezing, where the water-only formulas drift.'
    },
    'goff-gratch': {
      label: 'Goff-Gratch',
      validFor: '-50 to 100 C over water.',
      accuracy: 'The reference formula for a century. Awkward to compute and slightly superseded, still the benchmark.'
    }
  })

/** Saturation vapour pressure in pascals, for a temperature in Celsius. */
export function saturationVapourPressure(
  celsius: number,
  formula: SaturationFormula = 'buck',
  overIce = false
): number | AtmosphereError {
  if (!finite(celsius)) return fail('not-finite', 'The temperature has to be a finite number.')
  const facts = SATURATION_FACTS[formula]
  if (!facts) return fail('invalid-argument', `"${formula}" is not one of: ${SATURATION_FORMULAS.join(', ')}.`)

  if (formula === 'magnus-tetens') {
    if (celsius < -45 || celsius > 60) {
      return fail('outside-model', `Magnus-Tetens covers ${facts.validFor} ${celsius} C is outside it; Buck covers a wider range.`)
    }
    return 610.94 * Math.exp((17.625 * celsius) / (celsius + 243.04))
  }
  if (formula === 'buck') {
    if (celsius < -80 || celsius > 50) {
      return fail('outside-model', `Buck covers ${facts.validFor} ${celsius} C is outside it.`)
    }
    // Over ice below freezing gives a pressure several percent lower, and it is the correct one for frost,
    // snow and cloud physics. It is a separate branch rather than a fudge on the water coefficients.
    return overIce
      ? 611.15 * Math.exp((23.036 - celsius / 333.7) * (celsius / (279.82 + celsius)))
      : 611.21 * Math.exp((18.678 - celsius / 234.5) * (celsius / (257.14 + celsius)))
  }
  if (celsius < -50 || celsius > 100) {
    return fail('outside-model', `Goff-Gratch covers ${facts.validFor} ${celsius} C is outside it.`)
  }
  const t = celsius + 273.15
  const ts = 373.16
  const log10 =
    -7.90298 * (ts / t - 1) +
    5.02808 * Math.log10(ts / t) -
    1.3816e-7 * (Math.pow(10, 11.344 * (1 - t / ts)) - 1) +
    8.1328e-3 * (Math.pow(10, -3.49149 * (ts / t - 1)) - 1) +
    Math.log10(1013.246)
  return Math.pow(10, log10) * 100
}

export interface HumidityReport {
  /** Celsius. */
  temperature: number
  relativeHumidity: number
  /** Celsius. Where it would start condensing. */
  dewPoint: number
  /** Celsius. How cold evaporation alone can get a wet surface. */
  wetBulb: number
  /** Pascals. */
  vapourPressure: number
  saturationVapourPressure: number
  /** g/m³ of water actually in the air. */
  absoluteHumidity: number
  /** g of water per kg of dry air. The one that is conserved as air rises and cools. */
  mixingRatio: number
  /** Metres. Where a rising parcel would first condense — the base of the cloud it makes. */
  cloudBase: number | null
  formula: SaturationFormula
  overIce: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Everything humidity, from a temperature and any one measure of how wet the air is.
 *
 * The mixing ratio is here alongside relative humidity because they behave completely differently: relative
 * humidity changes when the air merely warms up, with no water added or removed, while the mixing ratio does not.
 * Reasoning about where cloud forms with relative humidity alone is how people end up confused about it.
 *
 * Wet bulb is found by solving the psychrometric relation rather than read off a chart, and it is the figure that
 * decides whether a person can cool themselves at all: above about 35 degrees wet bulb, sweating stops working
 * and shade does not help.
 */
export function humidity(input: {
  /** Celsius. */
  temperature: number
  relativeHumidity?: number
  /** Celsius. */
  dewPoint?: number
  /** Celsius. */
  wetBulb?: number
  /** Pascals. Station pressure, for the mixing ratio. */
  pressure?: number
  formula?: SaturationFormula
}): HumidityReport | AtmosphereError {
  const { temperature } = input
  if (!finite(temperature)) return fail('not-finite', 'The temperature has to be a finite number.')
  const formula = input.formula ?? 'buck'
  const overIce = temperature < 0
  const saturation = saturationVapourPressure(temperature, formula, overIce)
  if (isAtmosphereError(saturation)) return saturation

  const given = ['relativeHumidity', 'dewPoint', 'wetBulb'].filter(
    (one) => input[one as 'relativeHumidity'] !== undefined
  )
  if (given.length === 0) {
    return fail(
      'invalid-argument',
      'Give one of: relativeHumidity, dewPoint or wetBulb. A temperature on its own says nothing about how wet the air is.'
    )
  }
  if (given.length > 1) {
    return fail(
      'invalid-argument',
      `Both ${given.join(' and ')} were given. Any one of them fixes the others, and two that disagree describe no real air — so pick one.`
    )
  }

  const pressure = input.pressure ?? STANDARD_ATMOSPHERE.seaLevelPressure
  if (!finite(pressure) || pressure <= 0) return fail('invalid-argument', 'The pressure has to be greater than zero.')

  let vapour: number
  const warnings: string[] = []

  if (input.relativeHumidity !== undefined) {
    const rh = input.relativeHumidity
    if (!finite(rh) || rh < 0 || rh > 100) return fail('out-of-range', 'Relative humidity is a percentage from 0 to 100.')
    vapour = (rh / 100) * saturation
  } else if (input.dewPoint !== undefined) {
    if (!finite(input.dewPoint)) return fail('not-finite', 'The dew point has to be a finite number.')
    if (input.dewPoint > temperature + 0.01) {
      return fail(
        'no-solution',
        `The dew point (${input.dewPoint} C) is above the air temperature (${temperature} C), which no air can do — it would be more than saturated. One of the two readings is wrong.`
      )
    }
    const at = saturationVapourPressure(Math.min(input.dewPoint, temperature), formula, input.dewPoint < 0)
    if (isAtmosphereError(at)) return at
    vapour = at
  } else {
    const wb = input.wetBulb as number
    if (!finite(wb)) return fail('not-finite', 'The wet bulb temperature has to be a finite number.')
    if (wb > temperature + 0.01) {
      return fail('no-solution', 'The wet bulb reading is above the dry bulb, which evaporation cannot do — evaporating water only cools.')
    }
    const atWet = saturationVapourPressure(wb, formula, wb < 0)
    if (isAtmosphereError(atWet)) return atWet
    // The psychrometric relation, with the standard coefficient for a ventilated thermometer.
    vapour = atWet - 0.000662 * pressure * (temperature - wb)
    if (vapour < 0) vapour = 0
  }

  const relativeHumidity = Math.max(0, Math.min(100, (vapour / saturation) * 100))

  // Dew point by inverting Magnus, which has a closed form. Reported as the dew point whichever formula was used
  // for saturation, and the difference between them is under a tenth of a degree.
  const gamma = Math.log(Math.max(vapour, 1e-9) / 610.94)
  const dewPoint = (243.04 * gamma) / (17.625 - gamma)

  // Wet bulb by bisection on the psychrometric relation. Solved rather than approximated, because the well known
  // one-line approximation is out by more than a degree in dry heat, which is exactly where it matters.
  let wetBulb: number
  if (input.wetBulb !== undefined) {
    wetBulb = input.wetBulb
  } else {
    let low = dewPoint
    let high = temperature
    wetBulb = (low + high) / 2
    for (let i = 0; i < 80; i += 1) {
      wetBulb = (low + high) / 2
      const atGuess = saturationVapourPressure(wetBulb, formula, wetBulb < 0)
      if (isAtmosphereError(atGuess)) return atGuess
      const implied = atGuess - 0.000662 * pressure * (temperature - wetBulb)
      if (implied > vapour) high = wetBulb
      else low = wetBulb
    }
  }

  // Mixing ratio: grams of water per kilogram of dry air. The 0.622 is the ratio of molecular masses.
  const mixingRatio = (622 * vapour) / Math.max(pressure - vapour, 1e-9)
  // Absolute humidity from the ideal gas law for the vapour alone.
  const absoluteHumidity = (1000 * vapour) / (461.5 * (temperature + 273.15))

  // Cloud base: a rising parcel cools at the dry rate and its dew point falls at about a fifth of that, so they
  // close at roughly 125 m per degree of spread.
  const spread = temperature - dewPoint
  const cloudBase = spread > 0 ? spread * 125 : 0

  if (relativeHumidity > 99.5) {
    warnings.push('The air is at or past saturation. Any further cooling makes fog or dew rather than lowering the humidity.')
  }
  if (wetBulb > 32) {
    warnings.push(
      `The wet bulb temperature is ${wetBulb.toFixed(1)} C. Above about 35 the body cannot shed heat by sweating at all, and shade and a fan stop helping. This is the figure that makes humid heat dangerous in a way the thermometer reading does not show.`
    )
  }

  return {
    temperature,
    relativeHumidity,
    dewPoint,
    wetBulb,
    vapourPressure: vapour,
    saturationVapourPressure: saturation,
    absoluteHumidity,
    mixingRatio,
    cloudBase,
    formula,
    overIce,
    notes: Object.freeze([
      `Saturation from ${SATURATION_FACTS[formula].label}${overIce ? ', over ice' : ', over water'}. Valid for ${SATURATION_FACTS[formula].validFor} ${SATURATION_FACTS[formula].accuracy}`,
      `The mixing ratio is ${mixingRatio.toFixed(3)} g of water per kg of dry air. Unlike relative humidity it does not change when the air merely warms, which is what makes it the useful quantity for following air as it rises.`,
      `The dew point is ${dewPoint.toFixed(2)} C and the wet bulb is ${wetBulb.toFixed(2)} C. The dew point says when water condenses out; the wet bulb says how cool evaporation can get a wet surface. They are equal only at saturation.`,
      cloudBase !== null
        ? `Air rising from here would reach saturation at about ${cloudBase.toFixed(0)} m, which is the base of the cloud it would make. The rule is 125 m per degree of spread, and it is why the flat bottoms of fair-weather clouds are all at the same height.`
        : 'The air is saturated at the surface, so there is no cloud base above it — that is fog.',
      'The wet bulb is found by solving the psychrometric relation, not by the usual one-line approximation, which is out by over a degree in dry heat.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- apparent temperature

export type ComfortIndex = 'heat-index' | 'wind-chill' | 'humidex' | 'apparent-temperature'

export const COMFORT_INDICES: readonly ComfortIndex[] = Object.freeze([
  'heat-index',
  'wind-chill',
  'humidex',
  'apparent-temperature'
])

export const COMFORT_FACTS: Readonly<
  Record<ComfortIndex, { label: string; needs: string; validFor: string; origin: string }>
> = Object.freeze({
  'heat-index': {
    label: 'Heat index',
    needs: 'Air temperature and relative humidity.',
    validFor: 'At or above 27 C (80 F) and 40% humidity. Below that it has no meaning.',
    origin: 'Rothfusz regression on Steadman’s 1979 model, as used by the US National Weather Service. Assumes shade and a light breeze.'
  },
  'wind-chill': {
    label: 'Wind chill',
    needs: 'Air temperature and wind speed.',
    validFor: 'At or below 10 C with wind above 4.8 km/h. Outside that the formula returns nonsense.',
    origin: 'The 2001 North American formula, from a study of heat loss from a bare face. It says nothing about a covered body.'
  },
  humidex: {
    label: 'Humidex',
    needs: 'Air temperature and dew point.',
    validFor: 'Above about 20 C. Canadian usage.',
    origin: 'Masterton and Richardson, 1979. Uses the dew point directly rather than relative humidity.'
  },
  'apparent-temperature': {
    label: 'Apparent temperature (Steadman)',
    needs: 'Air temperature, humidity and wind speed.',
    validFor: 'Any temperature. The one index here without a cliff at the edge of its range.',
    origin: 'Steadman 1984, as used by the Australian Bureau of Meteorology. Covers both heat and cold in one expression.'
  }
})

export interface ComfortReport {
  index: ComfortIndex
  label: string
  /** Celsius. */
  apparent: number
  actual: number
  /** How much warmer or colder it feels than the thermometer says. */
  difference: number
  band: string
  origin: string
  validFor: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * How hot or cold it feels, from a named index within the range that index was fitted over.
 *
 * Asked for outside that range, this refuses. The heat index polynomial will happily return a number for a calm
 * winter day and that number is a fabrication — it is a curve fitted to summer data, evaluated where no data
 * existed. Apparent temperature is offered as the one index that works across the whole range.
 */
export function comfortIndex(input: {
  index: ComfortIndex
  /** Celsius. */
  temperature: number
  relativeHumidity?: number
  /** km/h at 10 m, which is how weather stations report it. */
  windSpeed?: number
  /** Celsius. */
  dewPoint?: number
}): ComfortReport | AtmosphereError {
  const facts = COMFORT_FACTS[input.index]
  if (!facts) return fail('invalid-argument', `"${input.index}" is not one of: ${COMFORT_INDICES.join(', ')}.`)
  const t = input.temperature
  if (!finite(t)) return fail('not-finite', 'The temperature has to be a finite number.')

  let apparent: number
  let band: string
  const warnings: string[] = []

  if (input.index === 'heat-index') {
    const rh = input.relativeHumidity
    if (rh === undefined) return fail('invalid-argument', `${facts.label} needs ${facts.needs}`)
    if (!finite(rh) || rh < 0 || rh > 100) return fail('out-of-range', 'Relative humidity is a percentage from 0 to 100.')
    if (t < 27) {
      return fail(
        'outside-model',
        `The heat index was fitted at and above 27 C; this is ${t} C. Below that the formula returns a number with no meaning behind it. For a cold day use wind chill, or apparent-temperature, which covers the whole range.`
      )
    }
    const f = (t * 9) / 5 + 32
    let hi =
      -42.379 +
      2.04901523 * f +
      10.14333127 * rh -
      0.22475541 * f * rh -
      0.00683783 * f * f -
      0.05481717 * rh * rh +
      0.00122874 * f * f * rh +
      0.00085282 * f * rh * rh -
      0.00000199 * f * f * rh * rh
    // The two adjustments the regression itself specifies at its edges.
    if (rh < 13 && f >= 80 && f <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(f - 95)) / 17)
    if (rh > 85 && f >= 80 && f <= 87) hi += ((rh - 85) / 10) * ((87 - f) / 5)
    apparent = ((hi - 32) * 5) / 9
    band =
      apparent >= 54
        ? 'extreme danger — heat stroke likely'
        : apparent >= 41
          ? 'danger — heat stroke possible with continued exposure'
          : apparent >= 32
            ? 'extreme caution — cramps and exhaustion possible'
            : 'caution — fatigue possible with prolonged activity'
    if (rh < 40) {
      warnings.push(`The heat index was fitted above 40% humidity; this is ${rh}%. In dry heat it under-reads, and evaporation is doing more work than the index credits.`)
    }
  } else if (input.index === 'wind-chill') {
    const wind = input.windSpeed
    if (wind === undefined) return fail('invalid-argument', `${facts.label} needs ${facts.needs}`)
    if (!finite(wind) || wind < 0) return fail('invalid-argument', 'The wind speed cannot be negative.')
    if (t > 10) {
      return fail(
        'outside-model',
        `Wind chill was fitted at and below 10 C; this is ${t} C. Above that wind does not make a person colder than the air, and the formula returns nonsense. Use the heat index, or apparent-temperature.`
      )
    }
    if (wind < 4.8) {
      return fail(
        'outside-model',
        `Wind chill needs a wind above 4.8 km/h; this is ${wind}. In still air there is no wind chill — the temperature is simply the temperature.`
      )
    }
    const v = Math.pow(wind, 0.16)
    apparent = 13.12 + 0.6215 * t - 11.37 * v + 0.3965 * t * v
    band =
      apparent <= -48
        ? 'exposed skin freezes in under 5 minutes'
        : apparent <= -28
          ? 'exposed skin can freeze in 10 to 30 minutes'
          : apparent <= -10
            ? 'uncomfortable; risk of frostbite with long exposure'
            : 'cold but not hazardous with reasonable clothing'
    warnings.push('Wind chill describes heat loss from a bare face. It says nothing about a clothed body, and it is not a temperature that anything actually reaches — water will not freeze faster at -30 wind chill than at the real air temperature.')
  } else if (input.index === 'humidex') {
    const dew = input.dewPoint
    if (dew === undefined) return fail('invalid-argument', `${facts.label} needs ${facts.needs}`)
    if (!finite(dew)) return fail('not-finite', 'The dew point has to be a finite number.')
    if (dew > t) return fail('no-solution', 'The dew point is above the air temperature, which no real air does.')
    const e = 6.11 * Math.exp(5417.753 * (1 / 273.16 - 1 / (dew + 273.15)))
    apparent = t + 0.5555 * (e - 10)
    band =
      apparent >= 45
        ? 'dangerous'
        : apparent >= 40
          ? 'great discomfort; avoid exertion'
          : apparent >= 30
            ? 'some discomfort'
            : 'comfortable'
  } else {
    const rh = input.relativeHumidity
    const wind = input.windSpeed ?? 0
    if (rh === undefined) return fail('invalid-argument', `${facts.label} needs ${facts.needs}`)
    if (!finite(rh) || rh < 0 || rh > 100) return fail('out-of-range', 'Relative humidity is a percentage from 0 to 100.')
    if (!finite(wind) || wind < 0) return fail('invalid-argument', 'The wind speed cannot be negative.')
    const saturation = saturationVapourPressure(t, 'buck', t < 0)
    if (isAtmosphereError(saturation)) return saturation
    const vapourHpa = ((rh / 100) * saturation) / 100
    const windMs = wind / 3.6
    apparent = t + 0.33 * vapourHpa - 0.7 * windMs - 4
    band =
      apparent >= 40
        ? 'severe heat stress'
        : apparent >= 32
          ? 'heat stress'
          : apparent >= 26
            ? 'warm'
            : apparent >= 10
              ? 'comfortable'
              : apparent >= 0
                ? 'cool'
                : 'cold'
  }

  return {
    index: input.index,
    label: facts.label,
    apparent,
    actual: t,
    difference: apparent - t,
    band,
    origin: facts.origin,
    validFor: facts.validFor,
    notes: Object.freeze([
      `${facts.label}: ${facts.origin} Valid for ${facts.validFor}`,
      `It feels like ${apparent.toFixed(1)} C against an actual ${t.toFixed(1)} C — ${Math.abs(apparent - t).toFixed(1)} degrees ${apparent > t ? 'warmer' : 'cooler'}.`,
      'Every index here is a fit to how people reported feeling, not a physical temperature. Two indices will disagree on the same weather, and neither is the wrong one.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- stability

export interface StabilityReport {
  /** K/m, measured. Positive means cooling with height. */
  lapseRate: number
  /** What the air does to a parcel given a nudge. */
  stability: 'absolutely-stable' | 'conditionally-unstable' | 'absolutely-unstable' | 'neutral' | 'inversion'
  /** K/m. 0.0098 — the rate unsaturated rising air cools by expansion alone. */
  dryAdiabatic: number
  /** K/m. Roughly 0.005 — slower, because condensing water releases heat. */
  saturatedAdiabatic: number
  describe: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Whether the atmosphere will let air rise, from a measured lapse rate.
 *
 * Conditionally unstable is the interesting case and the one a single label would hide: air between the two
 * adiabatic rates is stable while dry and unstable once saturated, which is why a humid afternoon can go from calm
 * to thunderstorms in an hour on no change in temperature at all.
 */
export function stability(input: {
  /** Celsius, at the lower height. */
  lowerTemperature: number
  upperTemperature: number
  /** Metres. */
  heightDifference: number
  saturatedRate?: number
}): StabilityReport | AtmosphereError {
  const { lowerTemperature, upperTemperature, heightDifference } = input
  for (const [name, value] of Object.entries({ lowerTemperature, upperTemperature, heightDifference })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
  }
  if (heightDifference <= 0) return fail('invalid-argument', 'The height difference has to be greater than zero, with the lower reading given first.')

  const lapse = (lowerTemperature - upperTemperature) / heightDifference
  const saturated = input.saturatedRate ?? 0.005

  let state: StabilityReport['stability']
  let describe: string
  const warnings: string[] = []

  if (lapse < 0) {
    state = 'inversion'
    describe =
      'The air gets warmer with height. Nothing rises through an inversion, which is why they trap smoke, fog and pollution near the ground and why the air is worst on a still cold morning.'
    warnings.push('An inversion caps the air below it. Pollutants emitted under one accumulate rather than dispersing.')
  } else if (Math.abs(lapse - DRY_ADIABATIC_LAPSE_RATE) < 0.0002) {
    state = 'neutral'
    describe = 'The measured rate matches the dry adiabatic rate, so a parcel nudged up or down stays where it is put. Well mixed air, usually windy.'
  } else if (lapse > DRY_ADIABATIC_LAPSE_RATE) {
    state = 'absolutely-unstable'
    describe =
      'Air cools with height faster than a rising parcel does, so anything nudged upward keeps going. This does not last — it overturns itself, and that overturning is convection.'
  } else if (lapse < saturated) {
    state = 'absolutely-stable'
    describe = 'A parcel nudged upward becomes colder than its surroundings and sinks back, saturated or not. Nothing rises on its own.'
  } else {
    state = 'conditionally-unstable'
    describe =
      'Between the two adiabatic rates: stable while the air stays unsaturated, unstable the moment it saturates. This is the state most thunderstorms come out of, and it is why a humid afternoon can turn violent with no change in temperature.'
    warnings.push('Conditionally unstable air is the setup for convective storms. Whether anything happens depends on whether a parcel is lifted far enough to saturate.')
  }

  return {
    lapseRate: lapse,
    stability: state,
    dryAdiabatic: DRY_ADIABATIC_LAPSE_RATE,
    saturatedAdiabatic: saturated,
    describe,
    notes: Object.freeze([
      `The measured lapse rate is ${(lapse * 1000).toFixed(2)} K per kilometre. The dry adiabatic rate is ${(DRY_ADIABATIC_LAPSE_RATE * 1000).toFixed(1)} and the saturated rate is about ${(saturated * 1000).toFixed(1)}.`,
      'Rising air cools because it expands, not because it is moving away from anything warm. The saturated rate is slower because condensing water gives heat back.',
      describe
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- air quality

export type Pollutant = 'pm25' | 'pm10' | 'ozone' | 'no2' | 'so2' | 'co'

export const POLLUTANTS: readonly Pollutant[] = Object.freeze(['pm25', 'pm10', 'ozone', 'no2', 'so2', 'co'])

/**
 * The US EPA breakpoints, as published. Each band maps a concentration range onto an index range linearly.
 *
 * Kept as data with its source attached rather than folded into a formula, because the bands are a regulatory
 * decision that changes — the PM2.5 breakpoints were revised in 2024 — and a formula with the numbers baked in
 * cannot say which version it is using.
 */
export const AQI_BREAKPOINTS: Readonly<
  Record<Pollutant, { unit: string; averaging: string; bands: readonly { low: number; high: number; indexLow: number; indexHigh: number }[] }>
> = Object.freeze({
  pm25: {
    unit: 'ug/m3',
    averaging: '24 hours',
    bands: Object.freeze([
      { low: 0, high: 9, indexLow: 0, indexHigh: 50 },
      { low: 9.1, high: 35.4, indexLow: 51, indexHigh: 100 },
      { low: 35.5, high: 55.4, indexLow: 101, indexHigh: 150 },
      { low: 55.5, high: 125.4, indexLow: 151, indexHigh: 200 },
      { low: 125.5, high: 225.4, indexLow: 201, indexHigh: 300 },
      { low: 225.5, high: 325.4, indexLow: 301, indexHigh: 500 }
    ])
  },
  pm10: {
    unit: 'ug/m3',
    averaging: '24 hours',
    bands: Object.freeze([
      { low: 0, high: 54, indexLow: 0, indexHigh: 50 },
      { low: 55, high: 154, indexLow: 51, indexHigh: 100 },
      { low: 155, high: 254, indexLow: 101, indexHigh: 150 },
      { low: 255, high: 354, indexLow: 151, indexHigh: 200 },
      { low: 355, high: 424, indexLow: 201, indexHigh: 300 },
      { low: 425, high: 604, indexLow: 301, indexHigh: 500 }
    ])
  },
  ozone: {
    unit: 'ppb',
    averaging: '8 hours',
    bands: Object.freeze([
      { low: 0, high: 54, indexLow: 0, indexHigh: 50 },
      { low: 55, high: 70, indexLow: 51, indexHigh: 100 },
      { low: 71, high: 85, indexLow: 101, indexHigh: 150 },
      { low: 86, high: 105, indexLow: 151, indexHigh: 200 },
      { low: 106, high: 200, indexLow: 201, indexHigh: 300 }
    ])
  },
  no2: {
    unit: 'ppb',
    averaging: '1 hour',
    bands: Object.freeze([
      { low: 0, high: 53, indexLow: 0, indexHigh: 50 },
      { low: 54, high: 100, indexLow: 51, indexHigh: 100 },
      { low: 101, high: 360, indexLow: 101, indexHigh: 150 },
      { low: 361, high: 649, indexLow: 151, indexHigh: 200 },
      { low: 650, high: 1249, indexLow: 201, indexHigh: 300 },
      { low: 1250, high: 2049, indexLow: 301, indexHigh: 500 }
    ])
  },
  so2: {
    unit: 'ppb',
    averaging: '1 hour',
    bands: Object.freeze([
      { low: 0, high: 35, indexLow: 0, indexHigh: 50 },
      { low: 36, high: 75, indexLow: 51, indexHigh: 100 },
      { low: 76, high: 185, indexLow: 101, indexHigh: 150 },
      { low: 186, high: 304, indexLow: 151, indexHigh: 200 },
      { low: 305, high: 604, indexLow: 201, indexHigh: 300 },
      { low: 605, high: 1004, indexLow: 301, indexHigh: 500 }
    ])
  },
  co: {
    unit: 'ppm',
    averaging: '8 hours',
    bands: Object.freeze([
      { low: 0, high: 4.4, indexLow: 0, indexHigh: 50 },
      { low: 4.5, high: 9.4, indexLow: 51, indexHigh: 100 },
      { low: 9.5, high: 12.4, indexLow: 101, indexHigh: 150 },
      { low: 12.5, high: 15.4, indexLow: 151, indexHigh: 200 },
      { low: 15.5, high: 30.4, indexLow: 201, indexHigh: 300 },
      { low: 30.5, high: 50.4, indexLow: 301, indexHigh: 500 }
    ])
  }
})

export const AQI_SOURCE =
  'US EPA breakpoints, 40 CFR Part 58 Appendix G, with the 2024 PM2.5 revision. Other countries use different bands, so an index from elsewhere is not comparable.'

export interface AirQualityReport {
  /** The overall index: the worst single pollutant, not an average of them. */
  index: number
  /** Which pollutant set it. */
  driver: Pollutant
  band: string
  advice: string
  each: readonly { pollutant: Pollutant; concentration: number; unit: string; averaging: string; index: number | null; note: string }[]
  source: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * An air quality index from measured concentrations.
 *
 * The overall index is the *worst* pollutant, not an average — averaging would let clean air in five pollutants
 * hide dangerous levels of a sixth, which is precisely the failure the index was designed to avoid. The driving
 * pollutant is named, because "AQI 160" tells someone to stay indoors while "AQI 160, ozone" also tells them it
 * will be better in the evening.
 */
export function airQuality(input: {
  concentrations: Readonly<Partial<Record<Pollutant, number>>>
}): AirQualityReport | AtmosphereError {
  const entries = Object.entries(input.concentrations) as [Pollutant, number][]
  if (entries.length === 0) return fail('invalid-argument', 'No concentrations were given.')

  const each: AirQualityReport['each'][number][] = []
  const warnings: string[] = []

  for (const [pollutant, concentration] of entries) {
    const facts = AQI_BREAKPOINTS[pollutant]
    if (!facts) return fail('invalid-argument', `"${pollutant}" is not one of: ${POLLUTANTS.join(', ')}.`)
    if (!finite(concentration) || concentration < 0) {
      return fail('invalid-argument', `The ${pollutant} concentration has to be zero or more.`)
    }
    const band = facts.bands.find((one) => concentration >= one.low && concentration <= one.high)
    if (!band) {
      // Above the published scale. The index genuinely stops, so this reports null rather than extrapolating a
      // number that no regulator has defined.
      each.push({
        pollutant,
        concentration,
        unit: facts.unit,
        averaging: facts.averaging,
        index: null,
        note: `${concentration} ${facts.unit} is above the top published breakpoint of ${facts.bands[facts.bands.length - 1].high}. The scale stops there; an index beyond it would be invented.`
      })
      warnings.push(`${pollutant} is above the top of the published scale, so it has no index. It is hazardous by any reading.`)
      continue
    }
    const index =
      band.indexLow +
      ((band.indexHigh - band.indexLow) * (concentration - band.low)) / Math.max(band.high - band.low, 1e-9)
    each.push({
      pollutant,
      concentration,
      unit: facts.unit,
      averaging: facts.averaging,
      index,
      note: `Averaged over ${facts.averaging}. A shorter sample is not the same measurement.`
    })
  }

  const scored = each.filter((one) => one.index !== null)
  if (scored.length === 0) {
    return fail('no-solution', 'Every concentration given is above the top of the published scale, so there is no index to report. The air is hazardous.')
  }
  const worst = scored.reduce((best, one) => ((one.index as number) > (best.index as number) ? one : best))
  const index = worst.index as number

  const band =
    index <= 50
      ? 'good'
      : index <= 100
        ? 'moderate'
        : index <= 150
          ? 'unhealthy for sensitive groups'
          : index <= 200
            ? 'unhealthy'
            : index <= 300
              ? 'very unhealthy'
              : 'hazardous'
  const advice =
    index <= 50
      ? 'No restrictions.'
      : index <= 100
        ? 'Unusually sensitive people may want to limit long outdoor exertion.'
        : index <= 150
          ? 'People with lung or heart conditions, children and older adults should limit long outdoor exertion.'
          : index <= 200
            ? 'Everyone should limit long outdoor exertion; sensitive groups should avoid it.'
            : index <= 300
              ? 'Everyone should avoid outdoor exertion; sensitive groups should stay indoors.'
              : 'Everyone should stay indoors with windows closed.'

  return {
    index,
    driver: worst.pollutant,
    band,
    advice,
    each: Object.freeze(each),
    source: AQI_SOURCE,
    notes: Object.freeze([
      `The index is ${index.toFixed(0)}, set by ${worst.pollutant}. It is the worst single pollutant, not an average — averaging would let clean air in five pollutants hide a dangerous level of the sixth.`,
      AQI_SOURCE,
      'Each pollutant has its own averaging period, and a reading taken over a shorter window is a different measurement. An hourly PM2.5 spike is not a 24-hour average.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const ATMOSPHERE_ASSUMPTIONS: readonly string[] = Object.freeze([
  'The standard atmosphere is a reference model of an average day, not a forecast. Real air at a given height varies by tens of degrees from it.',
  'Humidity rests on a named saturation-pressure formula, and the over-ice case below freezing is handled separately rather than glossed over.',
  'Wet bulb temperature is found by solving the psychrometric relation rather than by the usual approximation, which is out by over a degree in dry heat.',
  'Comfort indices are fits to how people reported feeling, each valid only over the range it was fitted. Asked for outside that range they refuse rather than extrapolate.',
  'Wind chill describes heat loss from a bare face. It is not a temperature anything actually reaches.',
  'Air quality bands are the US EPA breakpoints with their revision date named. Other countries use different bands and the indices are not comparable.',
  'Air is treated as dry for the standard atmosphere and pressure calculations. Humid air is slightly less dense, which matters for aircraft performance and not much else.'
])
