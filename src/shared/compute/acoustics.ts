/**
 * Sound: how fast it goes, how loud it is, what resonates, and what happens when things move.
 *
 * The shared acoustics engine for Orbis Pages. Everything here works on real pressures and real frequencies;
 * decibels are a presentation of those numbers against a stated reference, never a quantity in their own right.
 *
 * ## Decibels are a ratio, and which ratio matters
 *
 * `dB` on its own means nothing. Twenty times the log of a pressure ratio and ten times the log of a power ratio
 * give the same answer for the same physical change — but only because pressure is squared in power. Mix the two
 * and everything is out by a factor of two, silently.
 *
 * ```
 * dB SPL     20*log10(p/20uPa)     a sound pressure against the quietest audible one
 * dB (power) 10*log10(I/I0)        an intensity against 1 pW/m^2
 * dB gain    20*log10(Vout/Vin)    a voltage ratio, with no absolute reference at all
 * ```
 *
 * Every decibel this engine returns names its reference. A Page that adds a gain in dB to a level in dB SPL is
 * doing something meaningful; one that adds two dB SPL figures is not, and gets a warning.
 *
 * ## Doppler is not symmetric, and that is the interesting part
 *
 * A source moving toward you and a listener moving toward the source at the same speed give **different**
 * frequencies. The medium breaks the symmetry: sound travels through air, and the air knows which of you is moving
 * through it. This is exactly where the acoustic case parts company from the relativistic one, so the two
 * velocities are separate arguments and are never combined into a relative speed.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * pressure     vs  intensity      -- pascals against watts per square metre; one is the square of the other
 * loudness     vs  intensity      -- what an ear reports against what a meter measures
 * frequency    vs  pitch          -- cycles per second against what it sounds like
 * open pipe    vs  closed pipe    -- all harmonics against only the odd ones
 * absorption   vs  transmission   -- energy soaked up against energy that went through
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import { REFERENCE_SOUND_INTENSITY, REFERENCE_SOUND_PRESSURE } from './emConstants.ts'

export interface AcousticsError {
  error: 'invalid-argument' | 'not-finite' | 'too-many' | 'supersonic' | 'no-solution' | 'outside-model'
  message: string
}

export const isAcousticsError = (value: unknown): value is AcousticsError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: AcousticsError['error'], message: string): AcousticsError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const ACOUSTICS_LIMITS = Object.freeze({
  harmonics: 64,
  surfaces: 64,
  samples: 8000,
  sources: 32
})

// ---------------------------------------------------------------- media

export interface AcousticMedium {
  name: string
  /** m/s at the reference temperature. */
  speed: number
  /** kg/m³. */
  density: number
  /** Degrees Celsius. */
  referenceTemperature: number
  source: string
}

const acousticMedium = (one: AcousticMedium): AcousticMedium => Object.freeze(one)

export const ACOUSTIC_MEDIA: readonly AcousticMedium[] = Object.freeze([
  acousticMedium({ name: 'Air', speed: 343, density: 1.204, referenceTemperature: 20, source: 'Dry air at 20 C, 1 atm' }),
  acousticMedium({ name: 'Water (fresh)', speed: 1482, density: 998, referenceTemperature: 20, source: 'Fresh water at 20 C' }),
  acousticMedium({ name: 'Water (sea)', speed: 1500, density: 1025, referenceTemperature: 20, source: 'Seawater, 35 ppt salinity' }),
  acousticMedium({ name: 'Steel', speed: 5960, density: 7850, referenceTemperature: 20, source: 'Longitudinal wave in mild steel' }),
  acousticMedium({ name: 'Aluminium', speed: 6420, density: 2700, referenceTemperature: 20, source: 'Longitudinal wave' }),
  acousticMedium({ name: 'Helium', speed: 965, density: 0.1786, referenceTemperature: 20, source: 'At 20 C, 1 atm' }),
  acousticMedium({ name: 'Wood (oak, along grain)', speed: 3850, density: 720, referenceTemperature: 20, source: 'Along the grain' }),
  acousticMedium({ name: 'Glass', speed: 5640, density: 2500, referenceTemperature: 20, source: 'Longitudinal wave in crown glass' })
])

export function acousticMediumByName(name: string): AcousticMedium | AcousticsError {
  const wanted = name.trim().toLowerCase()
  const found = ACOUSTIC_MEDIA.find((one) => one.name.toLowerCase() === wanted) ??
    ACOUSTIC_MEDIA.find((one) => one.name.toLowerCase().includes(wanted))
  if (found) return found
  return fail(
    'invalid-argument',
    `There is no medium called "${name}" here. Give a speed and density directly, or pick one of: ${ACOUSTIC_MEDIA.map((one) => one.name).join(', ')}.`
  )
}

export interface SpeedReport {
  speed: number
  temperature: number
  medium: string
  /** The speed at the reference temperature, for comparison. */
  referenceSpeed: number
  model: 'ideal-gas' | 'fixed'
  notes: readonly string[]
}

/**
 * The speed of sound, with temperature accounted for in air.
 *
 * In a gas the speed goes as the square root of absolute temperature, which is why a cold morning changes the
 * pitch of a wind instrument. Solids and liquids get their tabulated value back with a note saying the model does
 * not vary it — inventing a temperature curve for steel would be inventing data.
 */
export function speedOfSound(input: {
  medium?: string
  temperatureCelsius?: number
  speed?: number
}): SpeedReport | AcousticsError {
  if (input.speed !== undefined) {
    if (!finite(input.speed) || input.speed <= 0) return fail('invalid-argument', 'The speed has to be greater than zero.')
    return {
      speed: input.speed,
      temperature: input.temperatureCelsius ?? 20,
      medium: 'given directly',
      referenceSpeed: input.speed,
      model: 'fixed',
      notes: Object.freeze(['The speed was supplied rather than derived, so no temperature model was applied.'])
    }
  }
  const found = acousticMediumByName(input.medium ?? 'Air')
  if (isAcousticsError(found)) return found
  const temperature = input.temperatureCelsius ?? found.referenceTemperature
  if (!finite(temperature)) return fail('not-finite', 'The temperature has to be a finite number.')
  if (temperature <= -273.15) return fail('invalid-argument', 'That is at or below absolute zero.')

  const isGas = found.name === 'Air' || found.name === 'Helium'
  if (!isGas) {
    return {
      speed: found.speed,
      temperature,
      medium: found.name,
      referenceSpeed: found.speed,
      model: 'fixed',
      notes: Object.freeze([
        `${found.speed} m/s at ${found.referenceTemperature} C (${found.source}). This engine does not model how the speed in ${found.name.toLowerCase()} changes with temperature, so the same value comes back whatever you ask for.`
      ])
    }
  }
  // v proportional to sqrt(T) in kelvin.
  const speed = found.speed * Math.sqrt((temperature + 273.15) / (found.referenceTemperature + 273.15))
  return {
    speed,
    temperature,
    medium: found.name,
    referenceSpeed: found.speed,
    model: 'ideal-gas',
    notes: Object.freeze([
      'In a gas the speed of sound goes as the square root of absolute temperature. It does not depend on pressure, because density and stiffness change together.',
      'It does not depend on frequency either, which is why a distant band still sounds like a band rather than arriving smeared out.'
    ])
  }
}

// ---------------------------------------------------------------- sound waves

export interface SoundWaveReport {
  frequency: number
  wavelength: number
  speed: number
  period: number
  /** Pa, when an amplitude was given. */
  pressureAmplitude: number | null
  /** W/m². */
  intensity: number | null
  /** dB SPL. */
  soundPressureLevel: number | null
  /** m/s. How fast the air itself moves, which is tiny compared with the wave speed. */
  particleVelocity: number | null
  /** Rayls. */
  impedance: number | null
  /** One cycle, sampled, when asked. */
  samples: readonly { time: number; pressure: number }[] | null
  notes: readonly string[]
}

/** A sound wave described completely: two of speed, frequency and wavelength, plus an amplitude if wanted. */
export function soundWave(input: {
  frequency?: number
  wavelength?: number
  speed?: number
  medium?: string
  temperatureCelsius?: number
  pressureAmplitude?: number
  density?: number
  sampleCount?: number
}): SoundWaveReport | AcousticsError {
  let speed = input.speed
  let density = input.density
  if (speed === undefined) {
    const resolved = speedOfSound({ medium: input.medium, temperatureCelsius: input.temperatureCelsius })
    if (isAcousticsError(resolved)) return resolved
    speed = resolved.speed
    if (density === undefined) {
      const m = acousticMediumByName(input.medium ?? 'Air')
      if (!isAcousticsError(m)) density = m.density
    }
  }
  if (!finite(speed) || speed <= 0) return fail('invalid-argument', 'The speed has to be greater than zero.')

  const given = [input.frequency, input.wavelength].filter((one) => one !== undefined).length
  if (given === 0) return fail('invalid-argument', 'Give a frequency or a wavelength.')
  if (given === 2) {
    const implied = (input.frequency as number) * (input.wavelength as number)
    if (Math.abs(implied - speed) > speed * 1e-6) {
      return fail(
        'invalid-argument',
        `Frequency times wavelength is ${implied.toFixed(3)} m/s, but the speed is ${speed.toFixed(3)} m/s. Those cannot all be true at once — give two of the three and let the third be worked out.`
      )
    }
  }
  const frequency = input.frequency ?? speed / (input.wavelength as number)
  const wavelength = input.wavelength ?? speed / frequency
  if (!finite(frequency) || frequency <= 0) return fail('invalid-argument', 'The frequency has to be greater than zero.')

  let intensity: number | null = null
  let spl: number | null = null
  let particle: number | null = null
  let impedance: number | null = null
  let samples: { time: number; pressure: number }[] | null = null

  const amplitude = input.pressureAmplitude
  if (amplitude !== undefined) {
    if (!finite(amplitude) || amplitude < 0) return fail('invalid-argument', 'The pressure amplitude has to be zero or positive.')
    if (density !== undefined && finite(density) && density > 0) {
      impedance = density * speed
      // I = p²/(2*rho*c) for an amplitude; the 2 is what turns amplitude into RMS.
      intensity = (amplitude * amplitude) / (2 * impedance)
      particle = amplitude / impedance
    }
    const rms = amplitude / Math.SQRT2
    spl = rms > 0 ? 20 * Math.log10(rms / REFERENCE_SOUND_PRESSURE) : Number.NEGATIVE_INFINITY

    const count = Math.round(input.sampleCount ?? 0)
    if (count > 0) {
      if (count < 2 || count > ACOUSTICS_LIMITS.samples) {
        return fail('invalid-argument', `The sample count has to be between 2 and ${ACOUSTICS_LIMITS.samples}.`)
      }
      samples = []
      const period = 1 / frequency
      for (let i = 0; i < count; i += 1) {
        const t = (period * i) / (count - 1)
        samples.push({ time: t, pressure: amplitude * Math.sin(2 * Math.PI * frequency * t) })
      }
    }
  }

  return {
    frequency,
    wavelength,
    speed,
    period: 1 / frequency,
    pressureAmplitude: amplitude ?? null,
    intensity,
    soundPressureLevel: spl,
    particleVelocity: particle,
    impedance,
    samples: samples ? Object.freeze(samples) : null,
    notes: Object.freeze([
      'Sound in air is a longitudinal wave: the air moves back and forth along the direction of travel, not across it.',
      'The air itself barely moves. At ordinary conversational levels the particle velocity is a fraction of a millimetre per second while the wave travels at 343 m/s.'
    ])
  }
}

// ---------------------------------------------------------------- decibels

export type DecibelReference = 'spl' | 'intensity' | 'power-ratio' | 'amplitude-ratio'

export const DECIBEL_REFERENCES: readonly DecibelReference[] = Object.freeze([
  'spl',
  'intensity',
  'power-ratio',
  'amplitude-ratio'
])

export const DECIBEL_FACTS: Readonly<
  Record<DecibelReference, { label: string; formula: string; reference: string; absolute: boolean }>
> = Object.freeze({
  spl: {
    label: 'Sound pressure level',
    formula: '20*log10(p / p0)',
    reference: '20 microPa, about the quietest sound a young ear can detect at 1 kHz',
    absolute: true
  },
  intensity: {
    label: 'Sound intensity level',
    formula: '10*log10(I / I0)',
    reference: '1 pW/m^2',
    absolute: true
  },
  'power-ratio': {
    label: 'Power ratio',
    formula: '10*log10(P2 / P1)',
    reference: 'none: this is a comparison, not a level',
    absolute: false
  },
  'amplitude-ratio': {
    label: 'Amplitude or voltage ratio',
    formula: '20*log10(A2 / A1)',
    reference: 'none: this is a comparison, not a level',
    absolute: false
  }
})

export interface DecibelReport {
  decibels: number
  reference: DecibelReference
  referenceDescribe: string
  formula: string
  absolute: boolean
  /** The linear ratio the decibels represent. */
  ratio: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Convert to decibels against a stated reference.
 *
 * The reference is required. `dB` without one is a number with no meaning, and the two families use different
 * multipliers — 20 for a pressure or amplitude, 10 for a power or intensity — so getting the reference wrong is
 * wrong by a factor of two in the exponent, which is a factor of a hundred in the thing being measured.
 */
export function toDecibels(input: {
  value: number
  reference: DecibelReference
  referenceValue?: number
}): DecibelReport | AcousticsError {
  const { value, reference } = input
  if (!finite(value)) return fail('not-finite', 'The value has to be a finite number.')
  if (value < 0) return fail('invalid-argument', 'A negative value has no decibel equivalent. Decibels compare magnitudes.')
  const facts = DECIBEL_FACTS[reference]
  if (!facts) return fail('invalid-argument', `"${reference}" is not one of the decibel references this understands.`)

  let base: number
  if (facts.absolute) {
    base = reference === 'spl' ? REFERENCE_SOUND_PRESSURE : REFERENCE_SOUND_INTENSITY
    if (input.referenceValue !== undefined) base = input.referenceValue
  } else {
    if (input.referenceValue === undefined) {
      return fail('invalid-argument', `A ${facts.label.toLowerCase()} is a comparison, so it needs something to compare against. Give a reference value.`)
    }
    base = input.referenceValue
  }
  if (!finite(base) || base <= 0) return fail('invalid-argument', 'The reference value has to be greater than zero.')

  const multiplier = reference === 'spl' || reference === 'amplitude-ratio' ? 20 : 10
  const ratio = value / base
  const db = value === 0 ? Number.NEGATIVE_INFINITY : multiplier * Math.log10(ratio)

  const warnings: string[] = []
  if (reference === 'spl' && db > 120) warnings.push('Above about 120 dB SPL sound causes pain and damages hearing quickly.')
  if (reference === 'spl' && db > 194) {
    warnings.push(
      'Above about 194 dB SPL in air the trough of the wave would be a vacuum, so this stops being a sound wave and becomes a shock wave. The formula still returns a number; the physics has changed.'
    )
  }

  return {
    decibels: db,
    reference,
    referenceDescribe: facts.reference,
    formula: facts.formula,
    absolute: facts.absolute,
    ratio,
    notes: Object.freeze([
      `${facts.label}: ${facts.formula}, against ${facts.reference}.`,
      multiplier === 20
        ? 'The multiplier is 20 because pressure is squared in power. Doubling the pressure is +6 dB, not +3.'
        : 'The multiplier is 10 because this is already a power quantity. Doubling the power is +3 dB.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface CombineLevelsReport {
  levels: readonly number[]
  /** dB. */
  total: number
  /** How much louder the total is than the loudest single source. */
  aboveLoudest: number
  notes: readonly string[]
}

/**
 * Add sound levels, which is not adding decibels.
 *
 * Two 60 dB sources give 63 dB, not 120. Decibels are logarithmic, so the intensities are added and the result is
 * converted back — and the answer to "twice as much sound" is always +3 dB whatever you started from.
 */
export function combineLevels(levels: readonly number[]): CombineLevelsReport | AcousticsError {
  if (levels.length === 0) return fail('invalid-argument', 'There are no levels to combine.')
  if (levels.length > ACOUSTICS_LIMITS.sources) {
    return fail('too-many', `That is ${levels.length} sources; this combines up to ${ACOUSTICS_LIMITS.sources}.`)
  }
  let sum = 0
  for (const [i, one] of levels.entries()) {
    if (!finite(one)) return fail('not-finite', `Level ${i + 1} is not a finite number of decibels.`)
    sum += Math.pow(10, one / 10)
  }
  const total = 10 * Math.log10(sum)
  const loudest = Math.max(...levels)
  return {
    levels,
    total,
    aboveLoudest: total - loudest,
    notes: Object.freeze([
      'Decibels do not add. The intensities add, and the total is converted back — so two equal sources give 3 dB more, not double the number.',
      'A source 10 dB below another adds less than half a decibel. That is why one loud thing dominates a room however many quiet ones there are.'
    ])
  }
}

export interface DistanceLevelReport {
  referenceLevel: number
  referenceDistance: number
  distance: number
  level: number
  drop: number
  spreading: 'spherical' | 'cylindrical'
  notes: readonly string[]
}

/** How a level falls with distance, under the spreading model being assumed. */
export function levelAtDistance(input: {
  referenceLevel: number
  referenceDistance: number
  distance: number
  spreading?: 'spherical' | 'cylindrical'
}): DistanceLevelReport | AcousticsError {
  const { referenceLevel, referenceDistance, distance } = input
  for (const [name, value] of Object.entries({ referenceLevel, referenceDistance, distance })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
  }
  if (referenceDistance <= 0 || distance <= 0) return fail('invalid-argument', 'Both distances have to be greater than zero.')
  const spreading = input.spreading ?? 'spherical'
  const multiplier = spreading === 'spherical' ? 20 : 10
  const drop = multiplier * Math.log10(distance / referenceDistance)
  return {
    referenceLevel,
    referenceDistance,
    distance,
    level: referenceLevel - drop,
    drop,
    spreading,
    notes: Object.freeze([
      spreading === 'spherical'
        ? 'Spherical spreading: 6 dB quieter every time the distance doubles. This assumes a point source in the open with nothing reflecting.'
        : 'Cylindrical spreading: 3 dB per doubling. This is what a long line source such as a road or a railway does.',
      'Absorption by the air is not included. Over hundreds of metres it matters, and it matters far more at high frequencies than at low ones.'
    ])
  }
}

// ---------------------------------------------------------------- Doppler

export interface DopplerReport {
  sourceFrequency: number
  observedFrequency: number
  /** Hz. Positive when the pitch went up. */
  shift: number
  /** Dimensionless. */
  ratio: number
  sourceSpeed: number
  observerSpeed: number
  speedOfSound: number
  approaching: boolean
  /** What the same geometry would give with source and observer swapped, which is not the same number. */
  ifRolesSwapped: number
  notes: readonly string[]
}

/**
 * The acoustic Doppler effect, with the source and observer motions kept separate.
 *
 * ```
 * f' = f * (v + vo) / (v - vs)
 * ```
 *
 * `vo` and `vs` do not combine into a relative velocity. A source moving at 30 m/s toward a still listener and a
 * listener moving at 30 m/s toward a still source produce different frequencies, because the air is a medium and
 * it is at rest in only one of those two cases. Collapsing them into "closing speed" gets a measurably wrong
 * answer, and that difference is the whole reason acoustic Doppler is not the relativistic one.
 */
export function doppler(input: {
  sourceFrequency: number
  /** m/s, positive toward the observer. */
  sourceSpeed?: number
  /** m/s, positive toward the source. */
  observerSpeed?: number
  speedOfSound?: number
  medium?: string
  temperatureCelsius?: number
  /** m/s, positive in the direction from source to observer. */
  windSpeed?: number
}): DopplerReport | AcousticsError {
  const { sourceFrequency } = input
  if (!finite(sourceFrequency) || sourceFrequency <= 0) {
    return fail('invalid-argument', 'The source frequency has to be greater than zero.')
  }
  let v = input.speedOfSound
  if (v === undefined) {
    const resolved = speedOfSound({ medium: input.medium, temperatureCelsius: input.temperatureCelsius })
    if (isAcousticsError(resolved)) return resolved
    v = resolved.speed
  }
  if (!finite(v) || v <= 0) return fail('invalid-argument', 'The speed of sound has to be greater than zero.')

  const vs = input.sourceSpeed ?? 0
  const vo = input.observerSpeed ?? 0
  const wind = input.windSpeed ?? 0
  for (const [name, value] of Object.entries({ vs, vo, wind })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
  }

  // Wind shifts the medium, which changes the effective speed in each direction.
  const effective = v + wind
  if (effective <= 0) return fail('outside-model', 'The wind is carrying the medium backwards faster than sound travels in it, which this model cannot describe.')

  if (vs >= effective) {
    return fail(
      'supersonic',
      `The source is moving at or above the speed of sound (${effective.toFixed(1)} m/s), so the Doppler formula has no answer — the wavefronts pile up into a shock cone instead of arriving at a higher pitch.`
    )
  }

  const observed = (sourceFrequency * (effective + vo)) / (effective - vs)
  const swapped = (sourceFrequency * (effective + vs)) / (effective - vo)

  const notes: string[] = [
    'The source and observer speeds enter the formula differently. Air is a medium and it is at rest relative to only one of them, so moving the source is not the same as moving the listener.'
  ]
  if (Math.abs(vs) > 0 && Math.abs(vo) > 0) {
    notes.push('Both are moving, so neither term drops out. The result depends on which is doing the moving relative to the air.')
  }
  if (Math.abs(observed - swapped) / sourceFrequency > 1e-6) {
    notes.push(
      `Swapping who is moving gives ${swapped.toFixed(4)} Hz instead of ${observed.toFixed(4)} Hz. That difference is real and measurable, and it is why the relativistic Doppler effect — where there is no medium — has a different formula.`
    )
  }
  if (wind !== 0) notes.push('A wind moves the whole medium, so it changes the effective speed of sound rather than acting like motion of either party.')

  return {
    sourceFrequency,
    observedFrequency: observed,
    shift: observed - sourceFrequency,
    ratio: observed / sourceFrequency,
    sourceSpeed: vs,
    observerSpeed: vo,
    speedOfSound: effective,
    approaching: observed > sourceFrequency,
    ifRolesSwapped: swapped,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- resonance

export type PipeKind = 'open-open' | 'open-closed'

export const PIPE_KINDS: readonly PipeKind[] = Object.freeze(['open-open', 'open-closed'])

export interface HarmonicReport {
  kind: PipeKind | 'string'
  length: number
  speed: number
  /** Hz. */
  fundamental: number
  harmonics: readonly { number: number; frequency: number; wavelength: number; nodes: number; antinodes: number }[]
  /** Whether even harmonics exist at all. */
  hasEvenHarmonics: boolean
  /** Metres. The correction for the open end bulging out past the pipe, when a radius was given. */
  endCorrection: number | null
  notes: readonly string[]
}

/**
 * The harmonics of a pipe, open at both ends or closed at one.
 *
 * A closed pipe has **only the odd harmonics**, and its fundamental is an octave below an open pipe of the same
 * length. That is not a detail: it is why a clarinet and a flute of similar length sound an octave apart and have
 * entirely different timbres. A Page that lists 2f, 3f, 4f for a closed pipe is listing frequencies that do not
 * resonate in it.
 */
export function pipeHarmonics(input: {
  kind: PipeKind
  length: number
  speed?: number
  medium?: string
  temperatureCelsius?: number
  count?: number
  radius?: number
}): HarmonicReport | AcousticsError {
  const { kind, length } = input
  if (!finite(length) || length <= 0) return fail('invalid-argument', 'The length has to be greater than zero.')
  if (kind !== 'open-open' && kind !== 'open-closed') {
    return fail('invalid-argument', 'A pipe is either open at both ends or closed at one. Say which — the harmonics differ completely.')
  }
  let v = input.speed
  if (v === undefined) {
    const resolved = speedOfSound({ medium: input.medium, temperatureCelsius: input.temperatureCelsius })
    if (isAcousticsError(resolved)) return resolved
    v = resolved.speed
  }
  if (!finite(v) || v <= 0) return fail('invalid-argument', 'The speed has to be greater than zero.')

  // The open end is not exactly at the pipe mouth: the air just outside moves with it.
  let correction: number | null = null
  let effective = length
  if (input.radius !== undefined) {
    if (!finite(input.radius) || input.radius <= 0) return fail('invalid-argument', 'The radius has to be greater than zero.')
    const perEnd = 0.6 * input.radius
    correction = kind === 'open-open' ? perEnd * 2 : perEnd
    effective = length + correction
  }

  const count = Math.min(Math.round(input.count ?? 8), ACOUSTICS_LIMITS.harmonics)
  if (!Number.isInteger(count) || count < 1) return fail('invalid-argument', 'The harmonic count has to be a whole number of at least 1.')

  const fundamental = kind === 'open-open' ? v / (2 * effective) : v / (4 * effective)
  const harmonics: HarmonicReport['harmonics'][number][] = []
  for (let i = 1; i <= count; i += 1) {
    const n = kind === 'open-open' ? i : 2 * i - 1
    const frequency = n * fundamental
    harmonics.push({
      number: n,
      frequency,
      wavelength: v / frequency,
      nodes: kind === 'open-open' ? n : i,
      antinodes: kind === 'open-open' ? n + 1 : i
    })
  }

  const notes: string[] = [
    kind === 'open-open'
      ? 'Open at both ends: antinodes at both, so every whole-number harmonic resonates. The fundamental fits half a wavelength in the pipe.'
      : 'Closed at one end: a node there and an antinode at the open end, so only a quarter wavelength fits. Only the odd harmonics exist — 3f, 5f, 7f and so on, never 2f.'
  ]
  if (kind === 'open-closed') {
    notes.push(
      'A closed pipe sounds an octave below an open pipe of the same length, and its missing even harmonics are why it has a hollow, woody timbre rather than a bright one.'
    )
  }
  if (correction !== null) {
    notes.push(
      `The open end was corrected by ${correction.toExponential(3)} m. The air just outside the mouth moves with the column, so a pipe behaves as though it were slightly longer than it is.`
    )
  } else {
    notes.push('No end correction was applied. A real pipe resonates slightly lower than these figures because the air outside the open end moves too; give a radius to include it.')
  }

  return {
    kind,
    length,
    speed: v,
    fundamental,
    harmonics: Object.freeze(harmonics),
    hasEvenHarmonics: kind === 'open-open',
    endCorrection: correction,
    notes: Object.freeze(notes)
  }
}

export interface StringReport {
  length: number
  tension: number
  linearDensity: number
  /** m/s. */
  waveSpeed: number
  fundamental: number
  harmonics: readonly { number: number; frequency: number; wavelength: number; nodes: number; antinodes: number }[]
  notes: readonly string[]
}

/** A vibrating string: v = sqrt(T/mu), and every harmonic present. */
export function stringHarmonics(input: {
  length: number
  tension: number
  linearDensity?: number
  mass?: number
  count?: number
}): StringReport | AcousticsError {
  const { length, tension } = input
  if (!finite(length) || length <= 0) return fail('invalid-argument', 'The length has to be greater than zero.')
  if (!finite(tension) || tension <= 0) return fail('invalid-argument', 'The tension has to be greater than zero.')

  let mu = input.linearDensity
  if (mu === undefined) {
    if (input.mass === undefined) return fail('invalid-argument', 'Give either the linear density or the total mass of the string.')
    if (!finite(input.mass) || input.mass <= 0) return fail('invalid-argument', 'The mass has to be greater than zero.')
    mu = input.mass / length
  }
  if (!finite(mu) || mu <= 0) return fail('invalid-argument', 'The linear density has to be greater than zero.')

  const v = Math.sqrt(tension / mu)
  const fundamental = v / (2 * length)
  const count = Math.min(Math.round(input.count ?? 8), ACOUSTICS_LIMITS.harmonics)
  if (!Number.isInteger(count) || count < 1) return fail('invalid-argument', 'The harmonic count has to be a whole number of at least 1.')

  const harmonics: StringReport['harmonics'][number][] = []
  for (let n = 1; n <= count; n += 1) {
    const frequency = n * fundamental
    harmonics.push({ number: n, frequency, wavelength: (2 * length) / n, nodes: n + 1, antinodes: n })
  }

  return {
    length,
    tension,
    linearDensity: mu,
    waveSpeed: v,
    fundamental,
    harmonics: Object.freeze(harmonics),
    notes: Object.freeze([
      'The wave speed on the string is sqrt(T/mu) and has nothing to do with the speed of sound in the air around it. The string sets the frequency; the air carries it.',
      'Quadrupling the tension doubles the pitch, which is why tuning is fine work — the frequency goes as the square root.',
      'Both ends are fixed, so both are nodes and every whole-number harmonic fits. That is why a plucked string sounds musical rather than hollow.'
    ])
  }
}

export interface BeatReport {
  frequency1: number
  frequency2: number
  /** Hz. How many loudness pulses per second, which is the difference and not half of it. */
  beatFrequency: number
  /** Hz. The pitch actually heard, which is the average. */
  perceivedFrequency: number
  samples: readonly { time: number; amplitude: number; envelope: number }[] | null
  notes: readonly string[]
}

/**
 * Beats between two close frequencies.
 *
 * The beat frequency is the difference, not half of it. The envelope oscillates at half the difference, but you
 * hear a loudness peak at every extreme of that envelope — twice per envelope cycle — so the audible rate is the
 * full difference. This is the single most common mistake in the subject.
 */
export function beats(input: {
  frequency1: number
  frequency2: number
  duration?: number
  sampleCount?: number
}): BeatReport | AcousticsError {
  const { frequency1, frequency2 } = input
  for (const [name, value] of Object.entries({ frequency1, frequency2 })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }
  const beat = Math.abs(frequency1 - frequency2)
  const perceived = (frequency1 + frequency2) / 2

  let samples: { time: number; amplitude: number; envelope: number }[] | null = null
  if (input.duration !== undefined) {
    if (!finite(input.duration) || input.duration <= 0) return fail('invalid-argument', 'The duration has to be a positive time.')
    const count = Math.round(input.sampleCount ?? 2000)
    if (!Number.isInteger(count) || count < 2 || count > ACOUSTICS_LIMITS.samples) {
      return fail('invalid-argument', `The sample count has to be between 2 and ${ACOUSTICS_LIMITS.samples}.`)
    }
    samples = []
    for (let i = 0; i < count; i += 1) {
      const t = (input.duration * i) / (count - 1)
      const a = Math.sin(2 * Math.PI * frequency1 * t) + Math.sin(2 * Math.PI * frequency2 * t)
      samples.push({ time: t, amplitude: a, envelope: 2 * Math.abs(Math.cos(Math.PI * beat * t)) })
    }
  }

  const notes: string[] = [
    `The beat rate is ${beat.toFixed(4)} Hz, the full difference between the two. The envelope wobbles at half that, but a loudness peak happens at both its extremes, so you count twice as many as the envelope has cycles.`,
    'The pitch you hear is the average of the two, not either one. That is why beats are used for tuning: you match the pitch first and then slow the beating to nothing.'
  ]
  if (beat > 20) {
    notes.push('Above about 20 beats per second the ear stops hearing pulses and starts hearing roughness, and eventually a separate tone.')
  }
  if (beat === 0) notes.push('The frequencies are identical, so there are no beats at all — the sound is steady.')

  return {
    frequency1,
    frequency2,
    beatFrequency: beat,
    perceivedFrequency: perceived,
    samples: samples ? Object.freeze(samples) : null,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- musical acoustics

export interface NoteReport {
  name: string
  frequency: number
  /** Semitones from A4. */
  semitonesFromA4: number
  /** Cents from the nearest equal-tempered note. */
  cents: number
  octave: number
  notes: readonly string[]
}

const NOTE_NAMES = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])

/** A frequency turned into a note name, in equal temperament against a stated reference pitch. */
export function noteFor(frequency: number, referenceA4 = 440): NoteReport | AcousticsError {
  if (!finite(frequency) || frequency <= 0) return fail('invalid-argument', 'The frequency has to be greater than zero.')
  if (!finite(referenceA4) || referenceA4 <= 0) return fail('invalid-argument', 'The reference pitch has to be greater than zero.')

  const exact = 12 * Math.log2(frequency / referenceA4)
  const nearest = Math.round(exact)
  const cents = (exact - nearest) * 100
  // A4 is MIDI 69; C is index 0 in the name table.
  const midi = nearest + 69
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1

  return {
    name: `${name}${octave}`,
    frequency,
    semitonesFromA4: exact,
    cents,
    octave,
    notes: Object.freeze([
      `Equal temperament against A4 = ${referenceA4} Hz. Every semitone is the twelfth root of two, which makes every key equally in tune and none of them perfectly so.`,
      Math.abs(cents) < 5
        ? 'This is within five cents of the note, which is about the limit of what most people can hear.'
        : `This is ${cents > 0 ? 'sharp' : 'flat'} by ${Math.abs(cents).toFixed(1)} cents, which is audible.`
    ])
  }
}

export interface IntervalReport {
  ratio: number
  cents: number
  /** The nearest just ratio, when one is close. */
  justRatio: string | null
  justCents: number | null
  /** How far equal temperament is from that just interval. */
  temperamentError: number | null
  name: string
  notes: readonly string[]
}

const JUST_INTERVALS: readonly { ratio: number; name: string; label: string }[] = Object.freeze([
  { ratio: 1, name: '1:1', label: 'unison' },
  { ratio: 16 / 15, name: '16:15', label: 'minor second' },
  { ratio: 9 / 8, name: '9:8', label: 'major second' },
  { ratio: 6 / 5, name: '6:5', label: 'minor third' },
  { ratio: 5 / 4, name: '5:4', label: 'major third' },
  { ratio: 4 / 3, name: '4:3', label: 'perfect fourth' },
  { ratio: 3 / 2, name: '3:2', label: 'perfect fifth' },
  { ratio: 8 / 5, name: '8:5', label: 'minor sixth' },
  { ratio: 5 / 3, name: '5:3', label: 'major sixth' },
  { ratio: 16 / 9, name: '16:9', label: 'minor seventh' },
  { ratio: 15 / 8, name: '15:8', label: 'major seventh' },
  { ratio: 2, name: '2:1', label: 'octave' }
])

/** An interval between two frequencies, in cents, with the just ratio it is approximating. */
export function interval(lower: number, upper: number): IntervalReport | AcousticsError {
  if (!finite(lower) || !finite(upper)) return fail('not-finite', 'Both frequencies have to be finite.')
  if (lower <= 0 || upper <= 0) return fail('invalid-argument', 'Both frequencies have to be greater than zero.')
  const ratio = upper / lower
  const cents = 1200 * Math.log2(ratio)

  let best: (typeof JUST_INTERVALS)[number] | null = null
  let bestError = Number.POSITIVE_INFINITY
  // Fold into one octave to compare.
  let folded = ratio
  while (folded >= 2) folded /= 2
  while (folded < 1) folded *= 2
  for (const one of JUST_INTERVALS) {
    const error = Math.abs(1200 * Math.log2(folded / one.ratio))
    if (error < bestError) {
      bestError = error
      best = one
    }
  }

  return {
    ratio,
    cents,
    justRatio: best && bestError < 30 ? best.name : null,
    justCents: best && bestError < 30 ? 1200 * Math.log2(best.ratio) : null,
    temperamentError: best && bestError < 30 ? bestError : null,
    name: best && bestError < 30 ? best.label : `${cents.toFixed(1)} cents`,
    notes: Object.freeze([
      'Cents are logarithmic: 1200 to the octave, 100 to an equal-tempered semitone. Equal steps in cents sound like equal musical steps, which equal steps in hertz do not.',
      best && bestError < 30 && bestError > 1
        ? `Equal temperament is ${bestError.toFixed(1)} cents from the just ${best.label} (${best.name}). That compromise is what lets an instrument play in every key.`
        : 'Simple whole-number ratios sound consonant because their harmonics line up rather than beating against each other.'
    ])
  }
}

// ---------------------------------------------------------------- room acoustics

export interface Surface {
  name: string
  /** m². */
  area: number
  /** 0 to 1. The fraction of energy soaked up rather than reflected. */
  absorptionCoefficient: number
}

export interface RoomReport {
  volume: number
  totalArea: number
  /** m² sabins. */
  totalAbsorption: number
  /** Dimensionless. The area-weighted mean. */
  averageAbsorption: number
  /** Seconds, by Sabine. */
  reverbSabine: number
  /** Seconds, by Eyring. More accurate in absorbent rooms. */
  reverbEyring: number
  /** Metres. Where direct and reverberant sound are equally loud. */
  criticalDistance: number
  /** Hz. Below this the room's own modes dominate and statistical models stop applying. */
  schroederFrequency: number
  model: 'sabine' | 'eyring'
  surfaces: readonly { name: string; area: number; absorption: number; sabins: number }[]
  warnings: readonly string[]
  notes: readonly string[]
}

/**
 * Reverberation time for a room, by both Sabine and Eyring, with the one to trust named.
 *
 * Sabine's formula is the famous one and it is wrong in absorbent rooms: it predicts a non-zero reverberation time
 * for a room with perfectly absorbing walls, which is impossible. Eyring's version goes to zero as it should.
 * Both are returned and the model field says which applies here, because a Page quoting a single RT60 without
 * saying which formula produced it is quoting a number that two textbooks will disagree about by 30%.
 */
export function roomAcoustics(input: {
  volume?: number
  dimensions?: { length: number; width: number; height: number }
  surfaces: readonly Surface[]
  speed?: number
  temperatureCelsius?: number
}): RoomReport | AcousticsError {
  if (input.surfaces.length === 0) return fail('invalid-argument', 'A room needs at least one surface to absorb anything.')
  if (input.surfaces.length > ACOUSTICS_LIMITS.surfaces) {
    return fail('too-many', `That is ${input.surfaces.length} surfaces; this handles up to ${ACOUSTICS_LIMITS.surfaces}.`)
  }

  let volume = input.volume
  if (volume === undefined) {
    if (!input.dimensions) return fail('invalid-argument', 'Give either the volume or the three room dimensions.')
    const { length, width, height } = input.dimensions
    for (const [name, value] of Object.entries({ length, width, height })) {
      if (!finite(value) || value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
    }
    volume = length * width * height
  }
  if (!finite(volume) || volume <= 0) return fail('invalid-argument', 'The volume has to be greater than zero.')

  let totalArea = 0
  let totalAbsorption = 0
  const surfaces: RoomReport['surfaces'][number][] = []
  for (const [i, one] of input.surfaces.entries()) {
    if (!finite(one.area) || one.area <= 0) return fail('invalid-argument', `Surface ${i + 1} has to have an area greater than zero.`)
    if (!finite(one.absorptionCoefficient) || one.absorptionCoefficient < 0 || one.absorptionCoefficient > 1) {
      return fail(
        'invalid-argument',
        `Surface ${i + 1} has an absorption coefficient of ${one.absorptionCoefficient}. It is a fraction of the energy absorbed, so it runs from 0 to 1.`
      )
    }
    const sabins = one.area * one.absorptionCoefficient
    totalArea += one.area
    totalAbsorption += sabins
    surfaces.push({ name: one.name, area: one.area, absorption: one.absorptionCoefficient, sabins })
  }
  if (totalAbsorption <= 0) {
    return fail(
      'no-solution',
      'Every surface is perfectly reflective, so no energy leaves the room and the sound never decays. There is no reverberation time to report.'
    )
  }

  let v = input.speed
  if (v === undefined) {
    const resolved = speedOfSound({ medium: 'Air', temperatureCelsius: input.temperatureCelsius })
    if (isAcousticsError(resolved)) return resolved
    v = resolved.speed
  }

  const average = totalAbsorption / totalArea
  const sabine = (0.161 * volume) / totalAbsorption
  // Eyring: uses -ln(1-a) instead of a, which diverges correctly as a approaches 1.
  const eyring = average >= 1 ? 0 : (0.161 * volume) / (-totalArea * Math.log(1 - average))
  const model: RoomReport['model'] = average > 0.2 ? 'eyring' : 'sabine'
  const critical = 0.057 * Math.sqrt(volume / (model === 'eyring' ? eyring : sabine))
  const schroeder = 2000 * Math.sqrt((model === 'eyring' ? eyring : sabine) / volume)

  const warnings: string[] = []
  if (average > 0.2) {
    warnings.push(
      `The average absorption is ${average.toFixed(3)}, above the 0.2 where Sabine's formula starts overestimating. Eyring's ${eyring.toFixed(3)} s is the one to use here; Sabine gives ${sabine.toFixed(3)} s.`
    )
  }
  if (average > 0.9) {
    warnings.push('The room is almost anechoic. Both statistical formulas assume a diffuse sound field, and that assumption has failed here.')
  }

  return {
    volume,
    totalArea,
    totalAbsorption,
    averageAbsorption: average,
    reverbSabine: sabine,
    reverbEyring: eyring,
    criticalDistance: critical,
    schroederFrequency: schroeder,
    model,
    surfaces: Object.freeze(surfaces),
    warnings: Object.freeze(warnings),
    notes: Object.freeze([
      'RT60 is how long it takes the sound to fall by 60 dB, which is a millionth of its energy.',
      `Below about ${schroeder.toFixed(0)} Hz the room's individual modes dominate and neither formula applies — statistical acoustics needs many overlapping modes to average over.`,
      'Absorption coefficients depend strongly on frequency. A single number is a single-frequency answer, usually taken at 500 Hz.'
    ])
  }
}

export interface ImpedanceReport {
  /** Rayls. */
  impedance: number
  density: number
  speed: number
  /** For a boundary between two media. */
  reflectionCoefficient: number | null
  transmissionCoefficient: number | null
  /** Fraction of power that gets through. */
  powerTransmitted: number | null
  notes: readonly string[]
}

/**
 * Acoustic impedance, and what happens at a boundary between two of them.
 *
 * The mismatch is why you can barely hear someone shouting underwater from above: air and water differ in
 * impedance by a factor of about 3,600, and over 99.9% of the power reflects. It is also why ultrasound scans need
 * gel — a millimetre of air between the probe and the skin is enough to stop the sound getting in.
 */
export function acousticImpedance(input: {
  density?: number
  speed?: number
  medium?: string
  secondMedium?: string
  secondDensity?: number
  secondSpeed?: number
}): ImpedanceReport | AcousticsError {
  let density = input.density
  let speed = input.speed
  if (density === undefined || speed === undefined) {
    const found = acousticMediumByName(input.medium ?? 'Air')
    if (isAcousticsError(found)) return found
    density = density ?? found.density
    speed = speed ?? found.speed
  }
  if (!finite(density) || density <= 0 || !finite(speed) || speed <= 0) {
    return fail('invalid-argument', 'Density and speed both have to be greater than zero.')
  }
  const z1 = density * speed

  let z2: number | null = null
  if (input.secondMedium !== undefined || input.secondDensity !== undefined) {
    let d2 = input.secondDensity
    let s2 = input.secondSpeed
    if (d2 === undefined || s2 === undefined) {
      const found = acousticMediumByName(input.secondMedium ?? 'Water (fresh)')
      if (isAcousticsError(found)) return found
      d2 = d2 ?? found.density
      s2 = s2 ?? found.speed
    }
    if (!finite(d2) || d2 <= 0 || !finite(s2) || s2 <= 0) {
      return fail('invalid-argument', 'The second medium needs a positive density and speed.')
    }
    z2 = d2 * s2
  }

  if (z2 === null) {
    return {
      impedance: z1,
      density,
      speed,
      reflectionCoefficient: null,
      transmissionCoefficient: null,
      powerTransmitted: null,
      notes: Object.freeze([
        'Acoustic impedance is density times speed. It decides how much sound crosses a boundary, and it is the reason two materials can both carry sound well and still barely pass it to each other.'
      ])
    }
  }

  const r = (z2 - z1) / (z2 + z1)
  const t = (2 * z2) / (z2 + z1)
  const powerThrough = 1 - r * r
  return {
    impedance: z1,
    density,
    speed,
    reflectionCoefficient: r,
    transmissionCoefficient: t,
    powerTransmitted: powerThrough,
    notes: Object.freeze([
      `${(powerThrough * 100).toFixed(4)}% of the power crosses the boundary. The rest reflects.`,
      powerThrough < 0.01
        ? 'That is almost total reflection. A large impedance mismatch is a very good sound barrier, which is why air gaps work so well in walls.'
        : 'Matched impedances pass sound almost perfectly, which is what ultrasound gel and acoustic horns are arranged to achieve.',
      r < 0 ? 'The reflection coefficient is negative, so the reflected wave is inverted — the boundary is to a softer medium.' : 'The reflected wave keeps its sign; the boundary is to a stiffer medium.'
    ])
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const ACOUSTICS_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Sound is a small-amplitude linear wave. Above about 130 dB that stops being true and shock behaviour appears.',
  'The medium is uniform and still unless a wind speed is given. Temperature gradients bend sound and are not modelled.',
  'Room formulas assume a diffuse field: many overlapping modes, evenly distributed absorption. Small or very absorbent rooms break that.',
  'Absorption coefficients are single-frequency values. Real materials absorb very differently at 125 Hz and at 4 kHz.',
  'Every decibel names its reference. A level and a ratio are different quantities and are never added together here.'
])
