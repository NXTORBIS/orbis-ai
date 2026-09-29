/**
 * Waves: travelling, standing, added together, and beating against each other.
 *
 * The shared wave engine for Orbis Pages. Everything here is a closed form — a wave is a function of position and
 * time, not something to integrate — and `signal.ts` is where a wave *measured* rather than *described* goes, for
 * spectra and correlations.
 *
 * ## The relation that catches people out
 *
 * `v = fλ` ties three quantities together, and which of them changes when a wave crosses into a new medium is not
 * symmetric. The **frequency does not change**: it is set by whatever is shaking the source, and the far side has to
 * receive as many crests per second as arrive. So the speed changes and the wavelength changes with it. A page that
 * lets all three be edited independently is describing three unrelated numbers, and this engine takes two and
 * derives the third rather than allowing that.
 *
 * ## A standing wave is not a travelling wave that stopped
 *
 * It is two travelling waves going opposite ways, added. The nodes never move, no energy goes anywhere on average,
 * and the whole string moves in step rather than passing a crest along. Calling it a wave that stands still gets
 * every one of those wrong.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * frequency    vs   wavelength      -- crossing into a new medium changes one and not the other
 * travelling   vs   standing        -- one carries energy along, the other does not carry it anywhere
 * phase velocity vs group velocity  -- the crests and the packet, which move at different speeds when dispersive
 * beat frequency vs  envelope rate  -- the envelope pulses twice per cycle of its own, and loudness follows the pulses
 * superposition vs   interference   -- the same arithmetic; the second is what the first looks like in a pattern
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface WaveError {
  error: 'invalid-argument' | 'not-finite' | 'over-specified' | 'under-specified' | 'no-harmonic'
  message: string
}

export const isWaveError = (value: unknown): value is WaveError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: WaveError['error'], message: string): WaveError => ({ error, message })

// ---------------------------------------------------------------- one wave, travelling

export interface Wave {
  amplitude: number
  wavelength: number
  frequency: number
  speed: number
  period: number
  /** 2π/λ. */
  waveNumber: number
  /** 2πf. */
  angularFrequency: number
  /** Where in the cycle it starts, in radians. */
  phase: number
  /** +1 travels toward increasing x, −1 the other way. */
  direction: 1 | -1
  notes: readonly string[]
}

/**
 * A travelling wave, from any two of speed, frequency and wavelength.
 *
 * Exactly two: giving all three over-specifies it and giving one leaves it undetermined. Refusing all three rather
 * than silently preferring two of them is the point — a set that does not satisfy `v = fλ` is not a wave, and
 * quietly discarding whichever was listed last would answer a question nobody asked.
 */
export function travellingWave(input: {
  amplitude: number
  speed?: number
  frequency?: number
  wavelength?: number
  phase?: number
  direction?: 1 | -1
}): Wave | WaveError {
  const { amplitude } = input
  if (!Number.isFinite(amplitude)) return fail('not-finite', 'The amplitude must be a finite number.')

  const given = [input.speed, input.frequency, input.wavelength].filter((one) => one !== undefined)
  if (given.length > 2) {
    return fail(
      'over-specified',
      'Give exactly two of speed, frequency and wavelength. All three are tied by v = fλ, so a third value either repeats one of the others or contradicts them — and there is no way to tell which was meant.'
    )
  }
  if (given.length < 2) {
    return fail('under-specified', 'Give two of speed, frequency and wavelength. Any two fix the third through v = fλ.')
  }
  if (!given.every((one) => Number.isFinite(one) && (one as number) > 0)) {
    return fail('invalid-argument', 'Speed, frequency and wavelength are all positive.')
  }

  let speed: number
  let frequency: number
  let wavelength: number
  if (input.speed !== undefined && input.frequency !== undefined) {
    speed = input.speed
    frequency = input.frequency
    wavelength = speed / frequency
  } else if (input.speed !== undefined && input.wavelength !== undefined) {
    speed = input.speed
    wavelength = input.wavelength
    frequency = speed / wavelength
  } else {
    frequency = input.frequency as number
    wavelength = input.wavelength as number
    speed = frequency * wavelength
  }

  const phase = input.phase ?? 0
  const direction = input.direction ?? 1
  if (!Number.isFinite(phase)) return fail('not-finite', 'The phase must be finite.')
  if (direction !== 1 && direction !== -1) return fail('invalid-argument', 'The direction is 1 or −1.')

  return {
    amplitude,
    wavelength,
    frequency,
    speed,
    period: 1 / frequency,
    waveNumber: (2 * Math.PI) / wavelength,
    angularFrequency: 2 * Math.PI * frequency,
    phase,
    direction,
    notes: [
      `Speed ${speed.toPrecision(6)} = frequency ${frequency.toPrecision(6)} × wavelength ${wavelength.toPrecision(6)}. Two of those were given and the third follows; there is no way to set all three independently.`,
      'Crossing into a new medium changes the speed and the wavelength together and leaves the frequency alone — the far side has to receive exactly as many crests per second as arrive, whatever the medium does to them.',
      'The amplitude does not affect the speed. A large wave and a small one on the same string travel at the same rate, which is what makes this a linear wave.'
    ]
  }
}

/** The displacement at a place and a time. */
export const waveAt = (one: Wave, x: number, t: number): number =>
  one.amplitude * Math.sin(one.waveNumber * x - one.direction * one.angularFrequency * t + one.phase)

export interface WaveSample {
  points: readonly { x: number; y: number }[]
  time: number
  notes: readonly string[]
}

/** The shape of the wave across a stretch of space, frozen at one moment. */
export function sampleWave(one: Wave, span: { from: number; to: number; points?: number }, time = 0): WaveSample | WaveError {
  if (!Number.isFinite(span.from) || !Number.isFinite(span.to) || span.to <= span.from) {
    return fail('invalid-argument', 'The span needs a start and a larger end.')
  }
  if (!Number.isFinite(time)) return fail('not-finite', 'The time must be finite.')
  const count = Math.min(20_000, Math.max(2, Math.round(span.points ?? 400)))
  const points: { x: number; y: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const x = span.from + ((span.to - span.from) * i) / (count - 1)
    points.push({ x, y: waveAt(one, x, time) })
  }
  const perWavelength = count / ((span.to - span.from) / one.wavelength)
  const notes: string[] = [`A snapshot at t = ${time}. The whole shape moves ${one.direction > 0 ? 'right' : 'left'} at ${one.speed.toPrecision(6)} without changing.`]
  if (perWavelength < 8) {
    notes.push(
      `Only about ${perWavelength.toPrecision(3)} points per wavelength. A plot of this will not look like the wave — it will show a slower one that happens to pass through the same points, which is aliasing.`
    )
  }
  return { points, time, notes }
}

// ---------------------------------------------------------------- standing

export type BoundaryCondition = 'both-fixed' | 'both-free' | 'one-fixed-one-free'

export const BOUNDARY_FACTS: Readonly<Record<BoundaryCondition, { label: string; describe: string; harmonics: string }>> =
  Object.freeze({
    'both-fixed': {
      label: 'Fixed at both ends',
      describe: 'A guitar string, a rope tied at both ends. There must be a node at each end, so a whole number of half wavelengths fits.',
      harmonics: 'All of them: 1, 2, 3, 4…'
    },
    'both-free': {
      label: 'Free at both ends',
      describe: 'A pipe open at both ends. An antinode at each end, which allows exactly the same wavelengths as fixing both.',
      harmonics: 'All of them: 1, 2, 3, 4…'
    },
    'one-fixed-one-free': {
      label: 'Fixed at one end, free at the other',
      describe: 'A pipe closed at one end. A node at the closed end and an antinode at the open one, so only an odd number of quarter wavelengths fits.',
      harmonics: 'Only the odd ones: 1, 3, 5, 7… The even harmonics simply do not exist on it.'
    }
  })

export interface StandingWave {
  harmonic: number
  boundary: BoundaryCondition
  length: number
  wavelength: number
  frequency: number
  speed: number
  /** Where the string never moves. */
  nodes: readonly number[]
  /** Where it moves most. */
  antinodes: readonly number[]
  /** The lowest frequency this boundary allows. */
  fundamental: number
  notes: readonly string[]
}

/**
 * A standing wave on a string or in a pipe.
 *
 * Which harmonics exist is decided by the ends, not by the string: a pipe closed at one end has no even harmonics at
 * all, which is why it sounds an octave lower than an open pipe of the same length and quite different in timbre.
 * Asking for an even harmonic of one is refused rather than rounded to a neighbour.
 */
export function standingWave(input: {
  length: number
  speed: number
  harmonic: number
  boundary: BoundaryCondition
}): StandingWave | WaveError {
  const { length, speed, harmonic, boundary } = input
  if (![length, speed, harmonic].every((one) => Number.isFinite(one))) return fail('not-finite', 'Every value must be finite.')
  if (length <= 0) return fail('invalid-argument', 'The length must be positive.')
  if (speed <= 0) return fail('invalid-argument', 'The wave speed must be positive.')
  if (!Number.isInteger(harmonic) || harmonic < 1) return fail('invalid-argument', 'The harmonic is a whole number of at least 1.')
  if (!Object.prototype.hasOwnProperty.call(BOUNDARY_FACTS, boundary)) {
    return fail('invalid-argument', `There is no boundary condition called "${boundary}".`)
  }

  let wavelength: number
  let nodes: number[] = []
  let antinodes: number[] = []

  if (boundary === 'one-fixed-one-free') {
    if (harmonic % 2 === 0) {
      return fail(
        'no-harmonic',
        `Harmonic ${harmonic} does not exist with one end fixed and one free. That arrangement needs a node at one end and an antinode at the other, which only an odd number of quarter wavelengths satisfies — the even harmonics are absent rather than weak.`
      )
    }
    wavelength = (4 * length) / harmonic
    // Node at x = 0, antinode at x = L.
    for (let i = 0; i * (wavelength / 2) <= length + 1e-12; i += 1) nodes.push(i * (wavelength / 2))
    for (let i = 0; wavelength / 4 + i * (wavelength / 2) <= length + 1e-12; i += 1) antinodes.push(wavelength / 4 + i * (wavelength / 2))
  } else {
    wavelength = (2 * length) / harmonic
    const spacing = wavelength / 2
    if (boundary === 'both-fixed') {
      for (let i = 0; i <= harmonic; i += 1) nodes.push(i * spacing)
      for (let i = 0; i < harmonic; i += 1) antinodes.push((i + 0.5) * spacing)
    } else {
      for (let i = 0; i <= harmonic; i += 1) antinodes.push(i * spacing)
      for (let i = 0; i < harmonic; i += 1) nodes.push((i + 0.5) * spacing)
    }
  }

  const frequency = speed / wavelength
  const fundamental = boundary === 'one-fixed-one-free' ? speed / (4 * length) : speed / (2 * length)
  const facts = BOUNDARY_FACTS[boundary]

  return {
    harmonic,
    boundary,
    length,
    wavelength,
    frequency,
    speed,
    nodes,
    antinodes,
    fundamental,
    notes: [
      facts.describe,
      `Harmonics available: ${facts.harmonics}`,
      'A standing wave is two travelling waves going opposite ways, added. The nodes never move and no energy travels along on average — it is not a travelling wave that stopped, and the whole string moves in step rather than passing a crest along.',
      `The fundamental is ${fundamental.toPrecision(6)}, and this harmonic is ${(frequency / fundamental).toPrecision(4)} times it.`
    ]
  }
}

/** The shape of a standing wave at a moment, including the envelope it never exceeds. */
export function sampleStanding(
  one: StandingWave,
  amplitude: number,
  time: number,
  points = 400
): { points: readonly { x: number; y: number; envelope: number }[]; notes: readonly string[] } | WaveError {
  if (!Number.isFinite(amplitude) || !Number.isFinite(time)) return fail('not-finite', 'The amplitude and time must be finite.')
  const count = Math.min(20_000, Math.max(2, Math.round(points)))
  const k = (2 * Math.PI) / one.wavelength
  const omega = 2 * Math.PI * one.frequency
  // A node at x = 0 for a fixed end, an antinode there for a free one.
  const shape = one.boundary === 'both-free' ? Math.cos : Math.sin

  const out: { x: number; y: number; envelope: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const x = (one.length * i) / (count - 1)
    const envelope = amplitude * shape(k * x)
    out.push({ x, y: envelope * Math.cos(omega * time), envelope: Math.abs(envelope) })
  }
  return {
    points: out,
    notes: [
      'Every point moves in step: they all reach their maximum at the same instant and all pass through zero at the same instant. That is what distinguishes this from a travelling wave, where the crest arrives at each point in turn.',
      'The envelope is the largest displacement each point ever reaches. A node stays at zero for ever, which no travelling wave does anywhere.'
    ]
  }
}

// ---------------------------------------------------------------- added together

export interface Superposition {
  points: readonly { x: number; components: readonly number[]; total: number }[]
  time: number
  notes: readonly string[]
}

/**
 * Several waves added at every point.
 *
 * All of wave interference is this one line of arithmetic. Two waves do not interact, change each other or take turns
 * — the medium is simply displaced by the sum, and everything that looks like interaction is what that sum looks
 * like when plotted.
 */
export function superpose(
  waves: readonly Wave[],
  span: { from: number; to: number; points?: number },
  time = 0
): Superposition | WaveError {
  if (waves.length === 0) return fail('invalid-argument', 'There are no waves to add.')
  if (waves.length > 32) return fail('invalid-argument', 'More than 32 waves at once is refused.')
  if (span.to <= span.from) return fail('invalid-argument', 'The span needs a start and a larger end.')
  const count = Math.min(20_000, Math.max(2, Math.round(span.points ?? 400)))

  const out: { x: number; components: number[]; total: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const x = span.from + ((span.to - span.from) * i) / (count - 1)
    const components = waves.map((one) => waveAt(one, x, time))
    out.push({ x, components, total: components.reduce((a, b) => a + b, 0) })
  }

  const notes: string[] = [
    'The medium is displaced by the sum. The waves do not interact, change each other or take turns — everything that looks like interference is what adding them looks like when it is drawn.'
  ]
  const same = waves.every((one) => Math.abs(one.frequency - (waves[0]?.frequency ?? 0)) < 1e-12)
  if (same && waves.length === 2) {
    const a = waves[0]
    const b = waves[1]
    if (a !== undefined && b !== undefined && a.direction !== b.direction) {
      notes.push('Two identical waves going opposite ways: what this adds up to is a standing wave, with nodes that never move.')
    }
  }
  if (!same) {
    notes.push('These have different frequencies, so the resultant shape changes from moment to moment rather than travelling unchanged.')
  }
  return { points: out, time, notes }
}

export interface Interference {
  pathDifference: number
  /** In wavelengths, which is what decides the outcome. */
  pathDifferenceInWavelengths: number
  phaseDifference: number
  /** How the two add up here, from nothing to twice one of them. */
  resultantAmplitude: number
  kind: 'constructive' | 'destructive' | 'partial'
  why: string
  notes: readonly string[]
}

/**
 * Two sources reaching one point.
 *
 * What decides the result is the path difference measured **in wavelengths**, not in metres. A difference of a metre
 * is constructive for one wavelength and destructive for another, which is why the same two speakers produce a
 * different pattern for every note they play.
 */
export function interferenceAt(input: {
  source1: { x: number; y: number; amplitude: number; phase?: number }
  source2: { x: number; y: number; amplitude: number; phase?: number }
  point: { x: number; y: number }
  wavelength: number
}): Interference | WaveError {
  const { source1, source2, point, wavelength } = input
  const values = [source1.x, source1.y, source2.x, source2.y, point.x, point.y, wavelength, source1.amplitude, source2.amplitude]
  if (!values.every((one) => Number.isFinite(one))) return fail('not-finite', 'Every value must be finite.')
  if (wavelength <= 0) return fail('invalid-argument', 'The wavelength must be positive.')

  const d1 = Math.hypot(point.x - source1.x, point.y - source1.y)
  const d2 = Math.hypot(point.x - source2.x, point.y - source2.y)
  const pathDifference = d2 - d1
  const inWavelengths = pathDifference / wavelength
  const sourcePhase = (source2.phase ?? 0) - (source1.phase ?? 0)
  const phaseDifference = (2 * Math.PI * inWavelengths + sourcePhase) % (2 * Math.PI)

  // Two waves of different amplitude never cancel completely; the cosine rule gives what they do make.
  const a = source1.amplitude
  const b = source2.amplitude
  const resultant = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(phaseDifference))

  const fromWhole = Math.abs(phaseDifference / (2 * Math.PI) - Math.round(phaseDifference / (2 * Math.PI)))
  const kind: Interference['kind'] = fromWhole < 0.02 ? 'constructive' : Math.abs(fromWhole - 0.5) < 0.02 ? 'destructive' : 'partial'

  const notes: string[] = [
    'What decides the outcome is the path difference in wavelengths, not in metres. The same two sources give a different pattern for every frequency they emit, which is why a room sounds different at different notes.'
  ]
  if (kind === 'destructive' && Math.abs(a - b) > 1e-9) {
    notes.push(
      `These arrive exactly out of step and still do not cancel, because their amplitudes differ: ${a} against ${b} leaves ${Math.abs(a - b).toPrecision(4)}. Complete cancellation needs equal amplitudes as well as opposite phase.`
    )
  }
  if (kind === 'constructive') {
    notes.push('Arriving in step, the amplitudes add. The energy is four times one wave alone here — and correspondingly missing from the places where they cancel. Interference moves energy about rather than creating it.')
  }

  return {
    pathDifference,
    pathDifferenceInWavelengths: inWavelengths,
    phaseDifference,
    resultantAmplitude: resultant,
    kind,
    why: `The paths differ by ${pathDifference.toPrecision(6)}, which is ${inWavelengths.toPrecision(5)} wavelengths — a phase difference of ${(phaseDifference / Math.PI).toPrecision(4)}π. ${kind === 'constructive' ? 'They arrive in step and reinforce.' : kind === 'destructive' ? 'They arrive out of step and cancel.' : 'They arrive partly out of step, somewhere between the two.'}`,
    notes
  }
}

// ---------------------------------------------------------------- beats

export interface Beats {
  frequency1: number
  frequency2: number
  /** The rate the loudness pulses at: the difference of the two, not half of it. */
  beatFrequency: number
  /** The pitch that is heard, which is the average of the two. */
  carrierFrequency: number
  beatPeriod: number
  points: readonly { time: number; wave1: number; wave2: number; total: number; envelope: number }[]
  notes: readonly string[]
}

/**
 * Two nearby frequencies added.
 *
 * The beat frequency is the **difference** of the two, not half of it. The envelope itself oscillates at half the
 * difference, but loudness does not care about the sign of the displacement — the sound is loudest at both the
 * positive and the negative bulge of the envelope, so the pulsing is heard at twice the envelope's own rate, which
 * is the difference. Getting that factor of two wrong is the usual mistake here.
 */
export function beats(input: {
  frequency1: number
  frequency2: number
  amplitude?: number
  duration: number
  points?: number
}): Beats | WaveError {
  const { frequency1, frequency2, duration } = input
  if (![frequency1, frequency2, duration].every((one) => Number.isFinite(one))) return fail('not-finite', 'Every value must be finite.')
  if (frequency1 <= 0 || frequency2 <= 0) return fail('invalid-argument', 'Both frequencies must be positive.')
  if (duration <= 0) return fail('invalid-argument', 'The duration must be positive.')
  if (frequency1 === frequency2) {
    return fail(
      'invalid-argument',
      'Two identical frequencies produce no beats at all — they simply add to a louder wave of the same pitch. Beats need a difference.'
    )
  }

  const amplitude = input.amplitude ?? 1
  const beatFrequency = Math.abs(frequency1 - frequency2)
  const carrier = (frequency1 + frequency2) / 2
  const count = Math.min(50_000, Math.max(2, Math.round(input.points ?? 2000)))

  const out: { time: number; wave1: number; wave2: number; total: number; envelope: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const t = (duration * i) / (count - 1)
    const w1 = amplitude * Math.sin(2 * Math.PI * frequency1 * t)
    const w2 = amplitude * Math.sin(2 * Math.PI * frequency2 * t)
    out.push({
      time: t,
      wave1: w1,
      wave2: w2,
      total: w1 + w2,
      envelope: Math.abs(2 * amplitude * Math.cos(Math.PI * beatFrequency * t))
    })
  }

  const perBeat = count / (duration * beatFrequency)
  const notes: string[] = [
    `The loudness pulses ${beatFrequency.toPrecision(6)} times a second — the difference of the two frequencies, not half of it. The envelope oscillates at half that, but loudness ignores the sign of the displacement, so each swing of the envelope is heard twice.`,
    `The pitch heard is the average, ${carrier.toPrecision(6)}. Neither of the two original frequencies is what the ear picks out.`,
    'Nothing new is produced. This is the two waves added, and the pulsing is what that sum looks like over a longer stretch than one cycle.'
  ]
  if (perBeat < 20) {
    notes.push(`Only about ${perBeat.toPrecision(3)} samples per beat. A plot of this will not show the envelope clearly.`)
  }
  if (beatFrequency > carrier / 4) {
    notes.push(
      `These two are far apart — the beat rate is ${((beatFrequency / carrier) * 100).toPrecision(3)}% of the pitch. At that separation the ear hears two distinct tones rather than one pulsing one, and "beats" stops being the right description.`
    )
  }

  return {
    frequency1,
    frequency2,
    beatFrequency,
    carrierFrequency: carrier,
    beatPeriod: 1 / beatFrequency,
    points: out,
    notes
  }
}

// ---------------------------------------------------------------- packets

export interface WavePacket {
  points: readonly { x: number; carrier: number; envelope: number; y: number }[]
  carrierWavelength: number
  /** The speed of an individual crest inside the packet. */
  phaseVelocity: number
  /** The speed of the packet as a whole, which is what carries the energy and the information. */
  groupVelocity: number
  /** True when the two differ, so the packet spreads as it goes. */
  dispersive: boolean
  notes: readonly string[]
}

/**
 * A localised group of waves.
 *
 * The point of it is that the crests and the packet move at different speeds when the medium is dispersive. The
 * crests move at the phase velocity, appearing at the back of the packet and vanishing at the front; the packet
 * moves at the group velocity, and that is what carries the energy and anything the wave is being used to signal.
 */
export function wavePacket(input: {
  carrierWavelength: number
  envelopeWidth: number
  phaseVelocity: number
  groupVelocity: number
  centre?: number
  span: { from: number; to: number; points?: number }
  time?: number
}): WavePacket | WaveError {
  const { carrierWavelength, envelopeWidth, phaseVelocity, groupVelocity, span } = input
  if (![carrierWavelength, envelopeWidth, phaseVelocity, groupVelocity, span.from, span.to].every((one) => Number.isFinite(one))) {
    return fail('not-finite', 'Every value must be finite.')
  }
  if (carrierWavelength <= 0) return fail('invalid-argument', 'The carrier wavelength must be positive.')
  if (envelopeWidth <= 0) return fail('invalid-argument', 'The envelope width must be positive.')
  if (span.to <= span.from) return fail('invalid-argument', 'The span needs a start and a larger end.')

  const time = input.time ?? 0
  const centre = (input.centre ?? (span.from + span.to) / 2) + groupVelocity * time
  const k = (2 * Math.PI) / carrierWavelength
  const omega = k * phaseVelocity
  const count = Math.min(20_000, Math.max(2, Math.round(span.points ?? 800)))

  const out: { x: number; carrier: number; envelope: number; y: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const x = span.from + ((span.to - span.from) * i) / (count - 1)
    const envelope = Math.exp(-(((x - centre) / envelopeWidth) ** 2))
    const carrier = Math.cos(k * x - omega * time)
    out.push({ x, carrier, envelope, y: envelope * carrier })
  }

  const dispersive = Math.abs(phaseVelocity - groupVelocity) > 1e-12
  const notes: string[] = [
    'The envelope is where the wave actually is; the crests inside it are what it is made of.',
    dispersive
      ? `The crests move at ${phaseVelocity.toPrecision(6)} and the packet at ${groupVelocity.toPrecision(6)}. Watch one crest and it ${phaseVelocity > groupVelocity ? 'appears at the back and vanishes at the front' : 'appears at the front and falls back through'} — the packet and its contents are genuinely moving at different speeds.`
      : 'The crests and the packet move at the same speed, so the medium is not dispersive here and the shape travels unchanged.',
    'The group velocity is what carries the energy and anything being signalled. The phase velocity can exceed the speed of light in some media without anything travelling that fast, because no crest carries information.'
  ]
  if (envelopeWidth < carrierWavelength) {
    notes.push(
      `The envelope is narrower than one wavelength of the carrier, so there is less than a full oscillation inside it. That is not really a wave packet any more — a packet that short has no well-defined frequency at all.`
    )
  }

  return {
    points: out,
    carrierWavelength,
    phaseVelocity,
    groupVelocity,
    dispersive,
    notes
  }
}

export const WAVE_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Waves add. Two overlapping waves displace the medium by their sum and do not affect each other, which is true of small waves and stops being true of large ones.',
  'The speed does not depend on the amplitude. A large wave and a small one on the same string travel together.',
  'Crossing into a new medium changes the speed and the wavelength and leaves the frequency alone. The far side must receive as many crests per second as arrive.',
  'A standing wave is two travelling waves going opposite ways, added. Its nodes never move and it carries no energy along on average.',
  'The beat rate is the difference of the two frequencies. The envelope oscillates at half that, but loudness ignores the sign of the displacement, so each swing is heard twice.'
])
