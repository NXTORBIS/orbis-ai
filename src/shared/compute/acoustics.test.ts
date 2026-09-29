import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  acousticImpedance,
  beats,
  combineLevels,
  doppler,
  interval,
  isAcousticsError,
  levelAtDistance,
  noteFor,
  pipeHarmonics,
  roomAcoustics,
  soundWave,
  speedOfSound,
  stringHarmonics,
  toDecibels,
  type AcousticsError
} from './acoustics.ts'

const ok = <T>(value: T): Exclude<T, AcousticsError> => {
  assert.ok(!isAcousticsError(value), isAcousticsError(value) ? value.message : '')
  return value as Exclude<T, AcousticsError>
}

const bad = (value: unknown): AcousticsError => {
  assert.ok(isAcousticsError(value), 'expected an error and got a result')
  return value
}

const closeTo = (actual: number, expected: number, tolerance: number, what = ''): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} expected ${expected} within ${tolerance}, got ${actual}`)
}

describe('the speed of sound', () => {
  it('rises with the square root of absolute temperature in air', () => {
    const cold = ok(speedOfSound({ medium: 'Air', temperatureCelsius: 0 }))
    const warm = ok(speedOfSound({ medium: 'Air', temperatureCelsius: 20 }))
    closeTo(warm.speed, 343, 0.5)
    closeTo(cold.speed, 331, 1)
    assert.ok(warm.speed > cold.speed)
    assert.equal(warm.model, 'ideal-gas')
  })

  it('says so rather than inventing a curve for a solid', () => {
    const report = ok(speedOfSound({ medium: 'Steel', temperatureCelsius: 500 }))
    assert.equal(report.model, 'fixed')
    assert.equal(report.speed, report.referenceSpeed)
    assert.ok(report.notes.some((one) => /does not model/.test(one)))
  })

  it('refuses a temperature below absolute zero', () => {
    assert.match(bad(speedOfSound({ medium: 'Air', temperatureCelsius: -300 })).message, /absolute zero/)
  })
})

describe('describing a sound wave', () => {
  it('derives the third quantity from any two', () => {
    const report = ok(soundWave({ frequency: 440, speed: 343 }))
    closeTo(report.wavelength, 343 / 440, 1e-12)
  })

  it('refuses a set that cannot all be true at once', () => {
    const result = bad(soundWave({ frequency: 440, wavelength: 1, speed: 343 }))
    assert.match(result.message, /cannot all be true at once/)
  })

  it('computes intensity and level from a pressure amplitude', () => {
    const report = ok(soundWave({ frequency: 1000, medium: 'Air', pressureAmplitude: 0.02 }))
    assert.ok((report.intensity ?? 0) > 0)
    // 0.02 Pa amplitude = 0.01414 Pa RMS -> about 57 dB SPL
    closeTo(report.soundPressureLevel ?? 0, 57, 1)
  })

  it('shows how little the air itself moves', () => {
    const report = ok(soundWave({ frequency: 1000, medium: 'Air', pressureAmplitude: 0.02 }))
    assert.ok((report.particleVelocity ?? 1) < 1e-4, 'microns per second against 343 m/s')
  })
})

describe('decibels name their reference', () => {
  it('uses twenty for pressure and ten for power', () => {
    const pressure = ok(toDecibels({ value: 2e-5 * 10, reference: 'spl' }))
    closeTo(pressure.decibels, 20, 1e-9, 'ten times the reference pressure is 20 dB')
    const intensity = ok(toDecibels({ value: 1e-12 * 10, reference: 'intensity' }))
    closeTo(intensity.decibels, 10, 1e-9, 'ten times the reference intensity is 10 dB')
  })

  it('makes doubling pressure six decibels and doubling power three', () => {
    const p = ok(toDecibels({ value: 2, reference: 'amplitude-ratio', referenceValue: 1 }))
    closeTo(p.decibels, 6.0206, 1e-3)
    const w = ok(toDecibels({ value: 2, reference: 'power-ratio', referenceValue: 1 }))
    closeTo(w.decibels, 3.0103, 1e-3)
  })

  it('refuses a ratio with nothing to compare against', () => {
    assert.match(bad(toDecibels({ value: 2, reference: 'power-ratio' })).message, /needs something to compare against/)
  })

  it('warns above the pain threshold and above where air stops being a medium', () => {
    const loud = ok(toDecibels({ value: 2e-5 * Math.pow(10, 130 / 20), reference: 'spl' }))
    assert.ok(loud.warnings.some((one) => /damages hearing/.test(one)))
    const impossible = ok(toDecibels({ value: 2e-5 * Math.pow(10, 200 / 20), reference: 'spl' }))
    assert.ok(impossible.warnings.some((one) => /shock wave/.test(one)))
  })

  it('carries the reference on every result', () => {
    const report = ok(toDecibels({ value: 1, reference: 'spl' }))
    assert.match(report.referenceDescribe, /20 microPa/)
    assert.equal(report.absolute, true)
  })
})

describe('adding sound levels', () => {
  it('gives sixty-three, not a hundred and twenty, for two sixty-decibel sources', () => {
    const report = ok(combineLevels([60, 60]))
    closeTo(report.total, 63.0103, 1e-3)
    closeTo(report.aboveLoudest, 3.0103, 1e-3)
  })

  it('makes a much quieter source almost irrelevant', () => {
    const report = ok(combineLevels([80, 60]))
    assert.ok(report.aboveLoudest < 0.05, 'a source 20 dB down adds almost nothing')
  })
})

describe('level with distance', () => {
  it('drops six decibels per doubling under spherical spreading', () => {
    const report = ok(levelAtDistance({ referenceLevel: 100, referenceDistance: 1, distance: 2 }))
    closeTo(report.drop, 6.0206, 1e-3)
    closeTo(report.level, 100 - 6.0206, 1e-3)
  })

  it('drops three per doubling for a line source', () => {
    const report = ok(levelAtDistance({ referenceLevel: 100, referenceDistance: 1, distance: 2, spreading: 'cylindrical' }))
    closeTo(report.drop, 3.0103, 1e-3)
  })
})

describe('the Doppler effect', () => {
  it('raises the pitch of an approaching source', () => {
    const report = ok(doppler({ sourceFrequency: 400, sourceSpeed: 30 }))
    assert.ok(report.observedFrequency > 400)
    assert.equal(report.approaching, true)
  })

  it('is not symmetric between a moving source and a moving listener', () => {
    const movingSource = ok(doppler({ sourceFrequency: 400, sourceSpeed: 30, speedOfSound: 343 }))
    const movingListener = ok(doppler({ sourceFrequency: 400, observerSpeed: 30, speedOfSound: 343 }))
    assert.notEqual(movingSource.observedFrequency, movingListener.observedFrequency)
    assert.ok(movingSource.observedFrequency > movingListener.observedFrequency)
    closeTo(movingSource.ifRolesSwapped, movingListener.observedFrequency, 1e-9, 'and it says what the other case gives')
  })

  it('explains why, rather than leaving it a surprise', () => {
    const report = ok(doppler({ sourceFrequency: 400, sourceSpeed: 30, speedOfSound: 343 }))
    assert.ok(report.notes.some((one) => /at rest relative to only one of them/.test(one)))
  })

  it('refuses a supersonic source instead of returning a number', () => {
    const result = bad(doppler({ sourceFrequency: 400, sourceSpeed: 400, speedOfSound: 343 }))
    assert.equal(result.error, 'supersonic')
    assert.match(result.message, /shock cone/)
  })

  it('treats wind as a change in the medium, not motion of either party', () => {
    const still = ok(doppler({ sourceFrequency: 400, sourceSpeed: 30, speedOfSound: 343 }))
    const windy = ok(doppler({ sourceFrequency: 400, sourceSpeed: 30, speedOfSound: 343, windSpeed: 20 }))
    assert.notEqual(still.observedFrequency, windy.observedFrequency)
    closeTo(windy.speedOfSound, 363, 1e-9)
  })
})

describe('pipes', () => {
  it('gives an open pipe every harmonic', () => {
    const report = ok(pipeHarmonics({ kind: 'open-open', length: 0.5, speed: 343, count: 4 }))
    assert.deepEqual(
      report.harmonics.map((one) => one.number),
      [1, 2, 3, 4]
    )
    closeTo(report.fundamental, 343, 0.5)
  })

  it('gives a closed pipe only the odd harmonics', () => {
    const report = ok(pipeHarmonics({ kind: 'open-closed', length: 0.5, speed: 343, count: 4 }))
    assert.deepEqual(
      report.harmonics.map((one) => one.number),
      [1, 3, 5, 7]
    )
    assert.equal(report.hasEvenHarmonics, false)
  })

  it('puts a closed pipe an octave below an open one of the same length', () => {
    const open = ok(pipeHarmonics({ kind: 'open-open', length: 0.5, speed: 343 }))
    const closed = ok(pipeHarmonics({ kind: 'open-closed', length: 0.5, speed: 343 }))
    closeTo(open.fundamental / closed.fundamental, 2, 1e-9)
  })

  it('applies an end correction only when it knows the radius', () => {
    const without = ok(pipeHarmonics({ kind: 'open-open', length: 0.5, speed: 343 }))
    assert.equal(without.endCorrection, null)
    assert.ok(without.notes.some((one) => /No end correction was applied/.test(one)))
    const withRadius = ok(pipeHarmonics({ kind: 'open-open', length: 0.5, speed: 343, radius: 0.02 }))
    assert.ok((withRadius.endCorrection ?? 0) > 0)
    assert.ok(withRadius.fundamental < without.fundamental, 'a corrected pipe sounds lower')
  })
})

describe('a vibrating string', () => {
  it('follows the square root of tension over linear density', () => {
    const report = ok(stringHarmonics({ length: 0.65, tension: 100, linearDensity: 0.001 }))
    closeTo(report.waveSpeed, Math.sqrt(100 / 0.001), 1e-9)
    closeTo(report.fundamental, Math.sqrt(100 / 0.001) / (2 * 0.65), 1e-9)
  })

  it('needs four times the tension to double the pitch', () => {
    const low = ok(stringHarmonics({ length: 1, tension: 100, linearDensity: 0.001 }))
    const high = ok(stringHarmonics({ length: 1, tension: 400, linearDensity: 0.001 }))
    closeTo(high.fundamental / low.fundamental, 2, 1e-9)
  })

  it('has every whole-number harmonic', () => {
    const report = ok(stringHarmonics({ length: 1, tension: 100, linearDensity: 0.001, count: 5 }))
    assert.deepEqual(
      report.harmonics.map((one) => one.number),
      [1, 2, 3, 4, 5]
    )
  })

  it('derives linear density from a total mass', () => {
    const fromMass = ok(stringHarmonics({ length: 0.5, tension: 100, mass: 0.0005 }))
    const direct = ok(stringHarmonics({ length: 0.5, tension: 100, linearDensity: 0.001 }))
    closeTo(fromMass.fundamental, direct.fundamental, 1e-9)
  })
})

describe('beats', () => {
  it('beats at the full difference, not half of it', () => {
    const report = ok(beats({ frequency1: 440, frequency2: 444 }))
    closeTo(report.beatFrequency, 4, 1e-12)
    assert.ok(report.notes.some((one) => /full difference/.test(one)))
  })

  it('is heard at the average pitch', () => {
    const report = ok(beats({ frequency1: 440, frequency2: 444 }))
    closeTo(report.perceivedFrequency, 442, 1e-12)
  })

  it('has no beats when the frequencies match', () => {
    const report = ok(beats({ frequency1: 440, frequency2: 440 }))
    closeTo(report.beatFrequency, 0, 0)
    assert.ok(report.notes.some((one) => /no beats at all/.test(one)))
  })

  it('warns when the difference is too fast to count', () => {
    const report = ok(beats({ frequency1: 440, frequency2: 500 }))
    assert.ok(report.notes.some((one) => /roughness/.test(one)))
  })
})

describe('musical acoustics', () => {
  it('names A4 at 440 Hz', () => {
    const report = ok(noteFor(440))
    assert.equal(report.name, 'A4')
    closeTo(report.cents, 0, 1e-9)
  })

  it('names the octave above', () => {
    assert.equal(ok(noteFor(880)).name, 'A5')
    assert.equal(ok(noteFor(220)).name, 'A3')
  })

  it('reports how far out of tune a frequency is', () => {
    const report = ok(noteFor(445))
    assert.equal(report.name, 'A4')
    assert.ok(report.cents > 15, 'sharp')
  })

  it('respects a different reference pitch', () => {
    assert.equal(ok(noteFor(432, 432)).name, 'A4')
  })

  it('finds the just ratio an equal-tempered interval approximates', () => {
    const fifth = ok(interval(440, 440 * Math.pow(2, 7 / 12)))
    assert.equal(fifth.justRatio, '3:2')
    closeTo(fifth.cents, 700, 1e-6)
    assert.ok((fifth.temperamentError ?? 0) < 3, 'the tempered fifth is close to just')
  })

  it('shows the tempered major third is noticeably sharp', () => {
    const third = ok(interval(440, 440 * Math.pow(2, 4 / 12)))
    assert.equal(third.justRatio, '5:4')
    assert.ok((third.temperamentError ?? 0) > 10, 'about 14 cents sharp of just')
  })
})

describe('room acoustics', () => {
  const surfaces = [
    { name: 'walls', area: 100, absorptionCoefficient: 0.1 },
    { name: 'floor', area: 50, absorptionCoefficient: 0.05 },
    { name: 'ceiling', area: 50, absorptionCoefficient: 0.2 }
  ]

  it('gives both formulas and names which applies', () => {
    const report = ok(roomAcoustics({ volume: 150, surfaces }))
    assert.ok(report.reverbSabine > 0)
    assert.ok(report.reverbEyring > 0)
    assert.equal(report.model, 'sabine', 'low absorption, so Sabine is fine')
  })

  it('switches to Eyring and warns in an absorbent room', () => {
    const absorbent = surfaces.map((one) => ({ ...one, absorptionCoefficient: 0.5 }))
    const report = ok(roomAcoustics({ volume: 150, surfaces: absorbent }))
    assert.equal(report.model, 'eyring')
    assert.ok(report.reverbEyring < report.reverbSabine, 'Sabine overestimates here')
    assert.ok(report.warnings.some((one) => /overestimating/.test(one)))
  })

  it('refuses a perfectly reflective room instead of returning infinity', () => {
    const mirrors = surfaces.map((one) => ({ ...one, absorptionCoefficient: 0 }))
    const result = bad(roomAcoustics({ volume: 150, surfaces: mirrors }))
    assert.equal(result.error, 'no-solution')
    assert.match(result.message, /never decays/)
  })

  it('refuses an absorption coefficient outside zero to one', () => {
    assert.match(
      bad(roomAcoustics({ volume: 150, surfaces: [{ name: 'x', area: 1, absorptionCoefficient: 1.5 }] })).message,
      /runs from 0 to 1/
    )
  })

  it('derives volume from dimensions', () => {
    const fromVolume = ok(roomAcoustics({ volume: 60, surfaces }))
    const fromDimensions = ok(roomAcoustics({ dimensions: { length: 5, width: 4, height: 3 }, surfaces }))
    closeTo(fromDimensions.reverbSabine, fromVolume.reverbSabine, 1e-12)
  })
})

describe('acoustic impedance', () => {
  it('is density times speed', () => {
    const report = ok(acousticImpedance({ medium: 'Air' }))
    closeTo(report.impedance, 1.204 * 343, 1e-6)
  })

  it('shows almost nothing crosses from air into water', () => {
    const report = ok(acousticImpedance({ medium: 'Air', secondMedium: 'Water (fresh)' }))
    assert.ok((report.powerTransmitted ?? 1) < 0.002, 'over 99.8% reflects')
    assert.ok(report.notes.some((one) => /almost total reflection/.test(one)))
  })

  it('leaves the boundary numbers null when there is only one medium', () => {
    const report = ok(acousticImpedance({ medium: 'Air' }))
    assert.equal(report.reflectionCoefficient, null)
    assert.equal(report.powerTransmitted, null)
  })
})
