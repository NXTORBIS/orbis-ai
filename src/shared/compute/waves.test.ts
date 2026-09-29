import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  BOUNDARY_FACTS,
  beats,
  interferenceAt,
  isWaveError,
  sampleStanding,
  sampleWave,
  standingWave,
  superpose,
  travellingWave,
  waveAt,
  wavePacket,
  type WaveError
} from './waves.ts'

const ok = <T>(value: T): Exclude<T, WaveError> => {
  assert.ok(!isWaveError(value), isWaveError(value) ? value.message : '')
  return value as Exclude<T, WaveError>
}

const closeTo = (actual: number, expected: number, tolerance: number, what = ''): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} expected ${expected} within ${tolerance}, got ${actual}`)
}

describe('a travelling wave', () => {
  it('derives the third quantity from any two', () => {
    const fromSpeedAndFrequency = ok(travellingWave({ amplitude: 1, speed: 340, frequency: 170 }))
    closeTo(fromSpeedAndFrequency.wavelength, 2, 1e-12)
    const fromFrequencyAndWavelength = ok(travellingWave({ amplitude: 1, frequency: 170, wavelength: 2 }))
    closeTo(fromFrequencyAndWavelength.speed, 340, 1e-12)
    const fromSpeedAndWavelength = ok(travellingWave({ amplitude: 1, speed: 340, wavelength: 2 }))
    closeTo(fromSpeedAndWavelength.frequency, 170, 1e-12)
  })

  it('refuses all three, and says why it cannot pick two', () => {
    const result = travellingWave({ amplitude: 1, speed: 340, frequency: 170, wavelength: 2 })
    assert.ok(isWaveError(result))
    assert.equal(result.error, 'over-specified')
    assert.match(result.message, /no way to tell which was meant/)
  })

  it('refuses only one', () => {
    const result = travellingWave({ amplitude: 1, speed: 340 })
    assert.ok(isWaveError(result))
    assert.equal(result.error, 'under-specified')
  })

  it('says the frequency is what survives a change of medium', () => {
    const wave = ok(travellingWave({ amplitude: 1, speed: 340, frequency: 170 }))
    assert.ok(wave.notes.some((one) => /leaves the frequency alone/.test(one)))
  })

  it('repeats itself after one wavelength and one period', () => {
    const wave = ok(travellingWave({ amplitude: 2, speed: 3, frequency: 1.5 }))
    for (const t of [0, 0.3, 1.1]) {
      closeTo(waveAt(wave, 0, t), waveAt(wave, wave.wavelength, t), 1e-9, `space at t=${t}`)
      closeTo(waveAt(wave, 0, t), waveAt(wave, 0, t + wave.period), 1e-9, `time at t=${t}`)
    }
  })

  it('moves the pattern at the wave speed', () => {
    const wave = ok(travellingWave({ amplitude: 1, speed: 4, frequency: 2 }))
    // What is at x after time t was at x − vt at time zero.
    for (const t of [0.1, 0.5, 1.3]) {
      closeTo(waveAt(wave, 5, t), waveAt(wave, 5 - 4 * t, 0), 1e-9, `t=${t}`)
    }
  })

  it('travels the other way when told to', () => {
    const wave = ok(travellingWave({ amplitude: 1, speed: 4, frequency: 2, direction: -1 }))
    closeTo(waveAt(wave, 5, 0.5), waveAt(wave, 5 + 4 * 0.5, 0), 1e-9)
  })

  it('refuses a negative speed', () => {
    assert.ok(isWaveError(travellingWave({ amplitude: 1, speed: -1, frequency: 1 })))
  })

  it('warns when a sample is too coarse to show the wave', () => {
    const wave = ok(travellingWave({ amplitude: 1, speed: 1, wavelength: 0.1 }))
    const sample = ok(sampleWave(wave, { from: 0, to: 10, points: 50 }))
    assert.ok(sample.notes.some((one) => /which is aliasing/.test(one)))
  })

  it('does not warn when it is fine', () => {
    const wave = ok(travellingWave({ amplitude: 1, speed: 1, wavelength: 2 }))
    const sample = ok(sampleWave(wave, { from: 0, to: 10, points: 400 }))
    assert.ok(!sample.notes.some((one) => /aliasing/.test(one)))
  })
})

describe('standing waves', () => {
  it('fits a whole number of half wavelengths between two fixed ends', () => {
    for (const harmonic of [1, 2, 3, 5]) {
      const wave = ok(standingWave({ length: 2, speed: 100, harmonic, boundary: 'both-fixed' }))
      closeTo(wave.wavelength, 4 / harmonic, 1e-12, `harmonic ${harmonic}`)
      closeTo(wave.frequency, (harmonic * 100) / 4, 1e-12, `harmonic ${harmonic}`)
    }
  })

  it('puts nodes at both fixed ends', () => {
    const wave = ok(standingWave({ length: 2, speed: 100, harmonic: 3, boundary: 'both-fixed' }))
    closeTo(wave.nodes[0] as number, 0, 1e-12)
    closeTo(wave.nodes[wave.nodes.length - 1] as number, 2, 1e-12)
    assert.equal(wave.nodes.length, 4)
    assert.equal(wave.antinodes.length, 3)
  })

  it('puts antinodes at both free ends', () => {
    const wave = ok(standingWave({ length: 2, speed: 100, harmonic: 2, boundary: 'both-free' }))
    closeTo(wave.antinodes[0] as number, 0, 1e-12)
    closeTo(wave.antinodes[wave.antinodes.length - 1] as number, 2, 1e-12)
  })

  it('has no even harmonics with one end fixed and one free', () => {
    const result = standingWave({ length: 2, speed: 100, harmonic: 2, boundary: 'one-fixed-one-free' })
    assert.ok(isWaveError(result))
    assert.equal(result.error, 'no-harmonic')
    assert.match(result.message, /absent rather than weak/)
    assert.ok(!isWaveError(standingWave({ length: 2, speed: 100, harmonic: 3, boundary: 'one-fixed-one-free' })))
  })

  it('gives a closed pipe half the fundamental of an open one', () => {
    const open = ok(standingWave({ length: 2, speed: 340, harmonic: 1, boundary: 'both-free' }))
    const closed = ok(standingWave({ length: 2, speed: 340, harmonic: 1, boundary: 'one-fixed-one-free' }))
    closeTo(closed.fundamental / open.fundamental, 0.5, 1e-12)
  })

  it('says a standing wave is not a travelling one that stopped', () => {
    const wave = ok(standingWave({ length: 1, speed: 10, harmonic: 1, boundary: 'both-fixed' }))
    assert.ok(wave.notes.some((one) => /not a travelling wave that stopped/.test(one)))
  })

  it('has facts for every boundary condition', () => {
    for (const boundary of ['both-fixed', 'both-free', 'one-fixed-one-free'] as const) {
      assert.ok(BOUNDARY_FACTS[boundary].describe.length > 40, boundary)
      assert.ok(BOUNDARY_FACTS[boundary].harmonics.length > 5, boundary)
    }
  })

  it('keeps every node exactly at zero for all time', () => {
    const wave = ok(standingWave({ length: 2, speed: 100, harmonic: 3, boundary: 'both-fixed' }))
    for (const time of [0, 0.001, 0.007, 0.013]) {
      const sample = ok(sampleStanding(wave, 1, time, 601))
      for (const node of wave.nodes) {
        const at = sample.points.reduce((best, one) => (Math.abs(one.x - node) < Math.abs(best.x - node) ? one : best))
        closeTo(at.y, 0, 1e-6, `node ${node} at t=${time}`)
      }
    }
  })

  it('moves every point in step', () => {
    const wave = ok(standingWave({ length: 1, speed: 4, harmonic: 2, boundary: 'both-fixed' }))
    const sample = ok(sampleStanding(wave, 1, 0.03, 200))
    assert.ok(sample.notes.some((one) => /reach their maximum at the same instant/.test(one)))
    // Every point is its own envelope times one common factor of time.
    const factors = sample.points.filter((one) => one.envelope > 0.1).map((one) => one.y / one.envelope)
    for (const factor of factors) closeTo(Math.abs(factor), Math.abs(factors[0] as number), 1e-9)
  })

  it('refuses a fractional harmonic', () => {
    assert.ok(isWaveError(standingWave({ length: 1, speed: 1, harmonic: 1.5, boundary: 'both-fixed' })))
  })
})

describe('superposition', () => {
  it('adds the waves at every point', () => {
    const a = ok(travellingWave({ amplitude: 1, speed: 1, wavelength: 4 }))
    const b = ok(travellingWave({ amplitude: 2, speed: 1, wavelength: 4, phase: Math.PI }))
    const result = ok(superpose([a, b], { from: 0, to: 8, points: 50 }))
    for (const point of result.points) {
      closeTo(point.total, point.components.reduce((x, y) => x + y, 0), 1e-12)
    }
  })

  it('cancels two equal and opposite waves entirely', () => {
    const a = ok(travellingWave({ amplitude: 1, speed: 1, wavelength: 4 }))
    const b = ok(travellingWave({ amplitude: 1, speed: 1, wavelength: 4, phase: Math.PI }))
    const result = ok(superpose([a, b], { from: 0, to: 8, points: 100 }))
    for (const point of result.points) closeTo(point.total, 0, 1e-9)
  })

  it('makes a standing wave from two waves going opposite ways', () => {
    const right = ok(travellingWave({ amplitude: 1, speed: 2, wavelength: 4, direction: 1 }))
    const left = ok(travellingWave({ amplitude: 1, speed: 2, wavelength: 4, direction: -1 }))
    const result = ok(superpose([right, left], { from: 0, to: 8, points: 400 }))
    assert.ok(result.notes.some((one) => /what this adds up to is a standing wave/.test(one)))

    // A node must stay at zero for every time.
    for (const time of [0, 0.2, 0.7, 1.4]) {
      const at = ok(superpose([right, left], { from: 0, to: 0.0001, points: 2 }, time))
      closeTo(at.points[0]?.total as number, 0, 1e-9, `t=${time}`)
    }
  })

  it('says the waves do not interact', () => {
    const a = ok(travellingWave({ amplitude: 1, speed: 1, wavelength: 2 }))
    const result = ok(superpose([a], { from: 0, to: 4 }))
    assert.ok(result.notes.some((one) => /do not interact, change each other or take turns/.test(one)))
  })

  it('refuses an empty superposition', () => {
    assert.ok(isWaveError(superpose([], { from: 0, to: 1 })))
  })
})

describe('interference', () => {
  const sources = {
    source1: { x: -1, y: 0, amplitude: 1 },
    source2: { x: 1, y: 0, amplitude: 1 }
  }

  it('reinforces where the paths are equal', () => {
    const result = ok(interferenceAt({ ...sources, point: { x: 0, y: 5 }, wavelength: 0.5 }))
    closeTo(result.pathDifference, 0, 1e-9)
    assert.equal(result.kind, 'constructive')
    closeTo(result.resultantAmplitude, 2, 1e-9)
  })

  it('cancels where the paths differ by half a wavelength', () => {
    // Point on the axis, 1 from one source and 3 from the other: a difference of 2.
    const result = ok(interferenceAt({ ...sources, point: { x: 2, y: 0 }, wavelength: 4 }))
    closeTo(result.pathDifferenceInWavelengths, -0.5, 1e-9)
    assert.equal(result.kind, 'destructive')
    closeTo(result.resultantAmplitude, 0, 1e-9)
  })

  it('reinforces again at a whole wavelength', () => {
    const result = ok(interferenceAt({ ...sources, point: { x: 2, y: 0 }, wavelength: 2 }))
    closeTo(Math.abs(result.pathDifferenceInWavelengths), 1, 1e-9)
    assert.equal(result.kind, 'constructive')
  })

  it('gives a different answer for a different wavelength at the same place', () => {
    const point = { x: 2, y: 0 }
    const a = ok(interferenceAt({ ...sources, point, wavelength: 4 }))
    const b = ok(interferenceAt({ ...sources, point, wavelength: 2 }))
    assert.notEqual(a.kind, b.kind)
    assert.ok(a.notes.some((one) => /a different pattern for every frequency/.test(one)))
  })

  it('does not fully cancel unequal amplitudes, and says why', () => {
    const result = ok(
      interferenceAt({
        source1: { x: -1, y: 0, amplitude: 3 },
        source2: { x: 1, y: 0, amplitude: 1 },
        point: { x: 2, y: 0 },
        wavelength: 4
      })
    )
    assert.equal(result.kind, 'destructive')
    closeTo(result.resultantAmplitude, 2, 1e-9)
    assert.ok(result.notes.some((one) => /Complete cancellation needs equal amplitudes/.test(one)))
  })

  it('says interference moves energy rather than making it', () => {
    const result = ok(interferenceAt({ ...sources, point: { x: 0, y: 5 }, wavelength: 0.5 }))
    assert.ok(result.notes.some((one) => /moves energy about rather than creating it/.test(one)))
  })

  it('refuses a wavelength of zero', () => {
    assert.ok(isWaveError(interferenceAt({ ...sources, point: { x: 0, y: 1 }, wavelength: 0 })))
  })
})

describe('beats', () => {
  it('pulses at the difference of the two frequencies', () => {
    const result = ok(beats({ frequency1: 440, frequency2: 444, duration: 1 }))
    closeTo(result.beatFrequency, 4, 1e-12)
    closeTo(result.beatPeriod, 0.25, 1e-12)
    assert.ok(result.notes.some((one) => /not half of it/.test(one)))
  })

  it('is heard at the average pitch', () => {
    const result = ok(beats({ frequency1: 440, frequency2: 444, duration: 1 }))
    closeTo(result.carrierFrequency, 442, 1e-12)
  })

  it('keeps the total inside its envelope', () => {
    const result = ok(beats({ frequency1: 100, frequency2: 104, duration: 1, points: 20000 }))
    for (const point of result.points) {
      assert.ok(Math.abs(point.total) <= point.envelope + 1e-9, `at t=${point.time}`)
    }
  })

  it('reaches full loudness once per beat period, which is twice per envelope cycle', () => {
    const result = ok(beats({ frequency1: 100, frequency2: 102, duration: 3, points: 60000 }))
    // Measured as the spacing between loud moments rather than by counting them, so the ends of the run do not
    // decide the answer -- the envelope peaks at t = 0 as well, and an interior count misses it.
    const peaks: number[] = []
    for (let i = 1; i < result.points.length - 1; i += 1) {
      const before = result.points[i - 1]?.envelope ?? 0
      const here = result.points[i]?.envelope ?? 0
      const after = result.points[i + 1]?.envelope ?? 0
      if (here > before && here >= after && here > 1.99) peaks.push(result.points[i]?.time ?? 0)
    }
    assert.ok(peaks.length >= 3, `only ${peaks.length} loud moments found`)
    for (let i = 1; i < peaks.length; i += 1) {
      closeTo((peaks[i] as number) - (peaks[i - 1] as number), result.beatPeriod, 0.01, `gap ${i}`)
    }
    // The envelope itself swings at half the beat rate: cos(π·Δf·t) has period 2/Δf.
    closeTo(result.beatPeriod, 1 / result.beatFrequency, 1e-12)
  })

  it('adds the two waves and nothing else', () => {
    const result = ok(beats({ frequency1: 50, frequency2: 53, duration: 0.5, points: 1000 }))
    for (const point of result.points) closeTo(point.total, point.wave1 + point.wave2, 1e-12)
    assert.ok(result.notes.some((one) => /Nothing new is produced/.test(one)))
  })

  it('refuses two identical frequencies', () => {
    const result = beats({ frequency1: 440, frequency2: 440, duration: 1 })
    assert.ok(isWaveError(result))
    assert.match(result.message, /Beats need a difference/)
  })

  it('says when the two are too far apart to be heard as beats', () => {
    const result = ok(beats({ frequency1: 200, frequency2: 400, duration: 1 }))
    assert.ok(result.notes.some((one) => /stops being the right description/.test(one)))
  })
})

describe('wave packets', () => {
  it('keeps the wave inside the envelope', () => {
    const result = ok(
      wavePacket({
        carrierWavelength: 1,
        envelopeWidth: 5,
        phaseVelocity: 2,
        groupVelocity: 1,
        span: { from: -30, to: 30, points: 2000 }
      })
    )
    for (const point of result.points) assert.ok(Math.abs(point.y) <= point.envelope + 1e-12)
  })

  it('moves the packet at the group velocity', () => {
    const at = (time: number): number => {
      const result = ok(
        wavePacket({
          carrierWavelength: 1,
          envelopeWidth: 4,
          phaseVelocity: 5,
          groupVelocity: 1,
          centre: 0,
          span: { from: -40, to: 40, points: 4000 },
          time
        })
      )
      return result.points.reduce((best, one) => (one.envelope > best.envelope ? one : best)).x
    }
    closeTo(at(10) - at(0), 10, 0.1)
  })

  it('knows when the medium is dispersive and when it is not', () => {
    const dispersive = ok(
      wavePacket({ carrierWavelength: 1, envelopeWidth: 5, phaseVelocity: 3, groupVelocity: 1, span: { from: -10, to: 10 } })
    )
    assert.equal(dispersive.dispersive, true)
    assert.ok(dispersive.notes.some((one) => /genuinely moving at different speeds/.test(one)))

    const plain = ok(
      wavePacket({ carrierWavelength: 1, envelopeWidth: 5, phaseVelocity: 2, groupVelocity: 2, span: { from: -10, to: 10 } })
    )
    assert.equal(plain.dispersive, false)
    assert.ok(plain.notes.some((one) => /travels unchanged/.test(one)))
  })

  it('says the group velocity is what carries information', () => {
    const result = ok(
      wavePacket({ carrierWavelength: 1, envelopeWidth: 5, phaseVelocity: 3, groupVelocity: 1, span: { from: -10, to: 10 } })
    )
    assert.ok(result.notes.some((one) => /no crest carries information/.test(one)))
  })

  it('warns when the packet is too short to have a frequency', () => {
    const result = ok(
      wavePacket({ carrierWavelength: 10, envelopeWidth: 1, phaseVelocity: 1, groupVelocity: 1, span: { from: -10, to: 10 } })
    )
    assert.ok(result.notes.some((one) => /no well-defined frequency at all/.test(one)))
  })

  it('refuses a packet with no width', () => {
    assert.ok(
      isWaveError(wavePacket({ carrierWavelength: 1, envelopeWidth: 0, phaseVelocity: 1, groupVelocity: 1, span: { from: 0, to: 1 } }))
    )
  })
})
