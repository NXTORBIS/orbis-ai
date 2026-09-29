import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyFilter,
  applyWindow,
  autocorrelation,
  bandPower,
  checkUniform,
  checkValues,
  convolve,
  crossCorrelation,
  decimate,
  designFilter,
  detrend,
  differenceSeries,
  exponentialSmoothing,
  inverseTransform,
  isSignalError,
  movingAverage,
  movingMedian,
  peaks,
  resample,
  samplingOf,
  signalFacts,
  spectrum,
  transform,
  transformReal,
  welch,
  windowOf,
  WINDOW_FACTS,
  WINDOW_NAMES,
  type ComplexSeries
} from './signal.ts'

/** A deterministic generator, so a noise test is a test rather than a coin toss. */
function noise(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296 - 0.5
  }
}

const sine = (count: number, cyclesInRecord: number, amplitude = 1, phase = 0): number[] =>
  Array.from({ length: count }, (_, i) => amplitude * Math.sin((2 * Math.PI * cyclesInRecord * i) / count + phase))

/** The plain O(n²) definition, to check the fast transforms against something with nowhere to hide a bug. */
function directTransform(input: ComplexSeries): ComplexSeries {
  const n = input.re.length
  const re = new Array<number>(n).fill(0)
  const im = new Array<number>(n).fill(0)
  for (let k = 0; k < n; k += 1) {
    for (let j = 0; j < n; j += 1) {
      const angle = (-2 * Math.PI * k * j) / n
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      re[k] = (re[k] as number) + (input.re[j] as number) * c - (input.im[j] as number) * s
      im[k] = (im[k] as number) + (input.re[j] as number) * s + (input.im[j] as number) * c
    }
  }
  return { re, im }
}

const closeTo = (actual: number, expected: number, tolerance: number, what = ''): void => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what} expected ${expected} within ${tolerance}, got ${actual}`
  )
}

describe('checkValues', () => {
  it('refuses an empty series', () => {
    const result = checkValues([])
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'empty')
  })

  it('names the indices of gaps rather than filling them', () => {
    const result = checkValues([1, null, 3, null])
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'gap')
    assert.match(result.message, /index 1, 3/)
    assert.match(result.message, /step change/)
  })

  it('names non-finite samples separately from gaps', () => {
    const result = checkValues([1, Number.NaN, 3])
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'not-finite')
    assert.match(result.message, /index 1/)
  })

  it('passes a clean series through', () => {
    const result = checkValues([1, 2, 3])
    assert.ok(!isSignalError(result))
    assert.deepEqual([...result], [1, 2, 3])
  })
})

describe('samplingOf', () => {
  it('reports duration as the span between first and last sample', () => {
    const result = samplingOf(100, 1000)
    assert.ok(!isSignalError(result))
    // 100 samples at 1 kHz span 99 ms, not 100 — a fencepost that quietly shifts every frequency if it is got wrong.
    closeTo(result.durationSeconds, 0.099, 1e-12)
    assert.equal(result.nyquistHz, 500)
    assert.equal(result.resolutionHz, 10)
  })

  it('refuses a rate of zero', () => {
    assert.ok(isSignalError(samplingOf(10, 0)))
  })

  it('refuses a fractional sample count', () => {
    assert.ok(isSignalError(samplingOf(10.5, 100)))
  })
})

describe('checkUniform', () => {
  it('accepts evenly spaced timestamps', () => {
    const result = checkUniform([0, 1, 2, 3, 4])
    assert.ok(!isSignalError(result))
    assert.equal(result.uniform, true)
    assert.equal(result.medianInterval, 1)
    assert.deepEqual([...result.irregularAt], [])
  })

  it('names which gaps are irregular and says why it matters', () => {
    const result = checkUniform([0, 1, 2, 5, 6])
    assert.ok(!isSignalError(result))
    assert.equal(result.uniform, false)
    assert.deepEqual([...result.irregularAt], [3])
    assert.match(result.why, /assumes even spacing/)
  })

  it('refuses timestamps that do not increase', () => {
    const result = checkUniform([0, 1, 1, 2])
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'invalid-argument')
  })

  it('needs two timestamps to measure a gap', () => {
    const result = checkUniform([5])
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'too-few')
  })
})

describe('windowOf', () => {
  it('gives a rectangular window all ones and unit gain', () => {
    const result = windowOf('rectangular', 8)
    assert.ok(!isSignalError(result))
    assert.deepEqual([...result.weights], [1, 1, 1, 1, 1, 1, 1, 1])
    assert.equal(result.coherentGain, 1)
    closeTo(result.noiseBandwidthBins, 1, 1e-12)
  })

  it('uses the periodic Hann, so the first weight is zero and the last is not', () => {
    const result = windowOf('hann', 8)
    assert.ok(!isSignalError(result))
    closeTo(result.weights[0] as number, 0, 1e-12)
    // A symmetric Hann would end at 0 too, repeating the endpoint when the record is treated as periodic.
    assert.ok((result.weights[7] as number) > 0)
    closeTo(result.coherentGain, 0.5, 1e-12)
  })

  it('refuses a window it does not know', () => {
    const result = windowOf('gaussian' as never, 8)
    assert.ok(isSignalError(result))
    assert.match(result.message, /rectangular/)
  })

  it('has facts for every name it lists', () => {
    for (const name of WINDOW_NAMES) {
      assert.ok(Object.prototype.hasOwnProperty.call(WINDOW_FACTS, name), name)
      const facts = WINDOW_FACTS[name]
      assert.equal(facts.name, name)
      assert.ok(facts.describe.length > 20, name)
      assert.ok(facts.sidelobeDb < 0, name)
    }
  })

  it('orders the windows so that lower sidelobes cost a wider main lobe', () => {
    const rect = WINDOW_FACTS.rectangular
    const harris = WINDOW_FACTS['blackman-harris']
    assert.ok(harris.sidelobeDb < rect.sidelobeDb)
    assert.ok(harris.mainLobeBins > rect.mainLobeBins)
  })

  it('refuses to apply a window of the wrong length', () => {
    const win = windowOf('hann', 4)
    assert.ok(!isSignalError(win))
    const result = applyWindow([1, 2, 3], win)
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'mismatched-length')
  })
})

describe('transform', () => {
  it('transforms a constant into a single DC term', () => {
    const result = transformReal([2, 2, 2, 2])
    assert.ok(!isSignalError(result))
    closeTo(result.re[0] as number, 8, 1e-12)
    for (let k = 1; k < 4; k += 1) {
      closeTo(result.re[k] as number, 0, 1e-12)
      closeTo(result.im[k] as number, 0, 1e-12)
    }
  })

  it('transforms an impulse into a flat magnitude', () => {
    const result = transformReal([1, 0, 0, 0, 0, 0, 0, 0])
    assert.ok(!isSignalError(result))
    for (let k = 0; k < 8; k += 1) {
      closeTo(Math.hypot(result.re[k] as number, result.im[k] as number), 1, 1e-12)
    }
  })

  it('agrees with the direct definition at a power-of-two length', () => {
    const values = sine(16, 3, 2).map((one, i) => one + 0.5 * i)
    const fast = transform({ re: values, im: new Array<number>(16).fill(0) })
    const slow = directTransform({ re: values, im: new Array<number>(16).fill(0) })
    assert.ok(!isSignalError(fast))
    for (let k = 0; k < 16; k += 1) {
      closeTo(fast.re[k] as number, slow.re[k] as number, 1e-9, `re[${k}]`)
      closeTo(fast.im[k] as number, slow.im[k] as number, 1e-9, `im[${k}]`)
    }
  })

  it('agrees with the direct definition at a prime length, where Bluestein takes over', () => {
    const values = [3, -1, 4, 1, -5, 9, 2]
    const fast = transform({ re: values, im: new Array<number>(7).fill(0) })
    const slow = directTransform({ re: values, im: new Array<number>(7).fill(0) })
    assert.ok(!isSignalError(fast))
    for (let k = 0; k < 7; k += 1) {
      closeTo(fast.re[k] as number, slow.re[k] as number, 1e-9, `re[${k}]`)
      closeTo(fast.im[k] as number, slow.im[k] as number, 1e-9, `im[${k}]`)
    }
  })

  it('agrees with the direct definition at a composite non-power-of-two length', () => {
    const values = [1, 2, 3, 4, 5, 6]
    const fast = transform({ re: values, im: [0.5, -0.5, 1, -1, 0, 2] })
    const slow = directTransform({ re: values, im: [0.5, -0.5, 1, -1, 0, 2] })
    assert.ok(!isSignalError(fast))
    for (let k = 0; k < 6; k += 1) {
      closeTo(fast.re[k] as number, slow.re[k] as number, 1e-9, `re[${k}]`)
      closeTo(fast.im[k] as number, slow.im[k] as number, 1e-9, `im[${k}]`)
    }
  })

  it('round-trips through the inverse at a power-of-two length', () => {
    const values = sine(32, 5, 3)
    const forward = transform({ re: values, im: new Array<number>(32).fill(0) })
    assert.ok(!isSignalError(forward))
    const back = inverseTransform(forward)
    assert.ok(!isSignalError(back))
    for (let i = 0; i < 32; i += 1) {
      closeTo(back.re[i] as number, values[i] as number, 1e-9, `sample ${i}`)
      closeTo(back.im[i] as number, 0, 1e-9)
    }
  })

  it('round-trips through the inverse at a prime length too', () => {
    const values = [8, -3, 0, 7, 2, -6, 1, 4, 9, 5, -2]
    const forward = transform({ re: values, im: new Array<number>(11).fill(0) })
    assert.ok(!isSignalError(forward))
    const back = inverseTransform(forward)
    assert.ok(!isSignalError(back))
    for (let i = 0; i < 11; i += 1) {
      closeTo(back.re[i] as number, values[i] as number, 1e-9, `sample ${i}`)
    }
  })

  it('refuses mismatched real and imaginary parts', () => {
    const result = transform({ re: [1, 2, 3], im: [0, 0] })
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'mismatched-length')
  })

  it('refuses nothing to transform', () => {
    assert.ok(isSignalError(transform({ re: [], im: [] })))
  })
})

describe('spectrum', () => {
  it('reads back the amplitude of a tone that lands on a bin centre', () => {
    // 10 Hz at amplitude 2, sampled at 100 Hz for 100 samples: exactly 10 cycles, exactly on bin 10.
    const result = spectrum(sine(100, 10, 2), 100)
    assert.ok(!isSignalError(result))
    const bin = result.bins[10]
    assert.ok(bin !== undefined)
    closeTo(bin.frequencyHz, 10, 1e-12)
    closeTo(bin.amplitude, 2, 1e-9)
    closeTo(bin.rms, 2 / Math.SQRT2, 1e-9)
  })

  it('does not double the DC bin', () => {
    // A constant 5 must read as 5, not 10. The doubling that is right between DC and Nyquist is wrong at DC.
    const result = spectrum(new Array<number>(64).fill(5), 64)
    assert.ok(!isSignalError(result))
    closeTo(result.bins[0]?.amplitude as number, 5, 1e-9)
    assert.equal(result.bins[0]?.rms, 0)
  })

  it('does not double the Nyquist bin of an even-length record', () => {
    // Alternating ±3 is exactly the Nyquist frequency, and it has no negative-frequency partner to fold in.
    const values = Array.from({ length: 64 }, (_, i) => (i % 2 === 0 ? 3 : -3))
    const result = spectrum(values, 64, { window: 'rectangular' })
    assert.ok(!isSignalError(result))
    const last = result.bins[result.bins.length - 1]
    assert.ok(last !== undefined)
    closeTo(last.frequencyHz, 32, 1e-12)
    closeTo(last.amplitude, 3, 1e-9)
  })

  it('stops at Nyquist and nowhere above it', () => {
    const result = spectrum(sine(64, 7), 64)
    assert.ok(!isSignalError(result))
    for (const bin of result.bins) assert.ok(bin.frequencyHz <= 32 + 1e-12)
    assert.equal(result.bins.length, 33)
  })

  it('recovers the phase of a tone', () => {
    const phase = Math.PI / 3
    const result = spectrum(sine(128, 8, 1, phase), 128, { window: 'rectangular' })
    assert.ok(!isSignalError(result))
    // A sine of phase φ has transform phase φ − π/2 at its bin.
    const measured = result.bins[8]?.phaseRadians as number
    closeTo(measured, phase - Math.PI / 2, 1e-6)
  })

  it('reports the caveat that content above Nyquist was already folded down', () => {
    const result = spectrum(sine(64, 5), 64)
    assert.ok(!isSignalError(result))
    assert.ok(result.caveats.some((one) => /folded down/.test(one)))
  })

  it('says when no window was applied and what that costs', () => {
    const result = spectrum(sine(64, 5), 64, { window: 'rectangular' })
    assert.ok(!isSignalError(result))
    assert.ok(result.caveats.some((one) => /No window was applied/.test(one)))
  })

  it('says that padding interpolates rather than resolves', () => {
    const result = spectrum(sine(50, 5), 100, { padTo: 200 })
    assert.ok(!isSignalError(result))
    assert.equal(result.zeroPadded, 150)
    assert.ok(result.caveats.some((one) => /does not improve the ability to separate/.test(one)))
    // Padding gives four times as many bins over the same span.
    assert.equal(result.bins.length, 101)
    // But the honest resolution still comes from the record actually measured.
    closeTo(result.sampling.resolutionHz, 2, 1e-12)
  })

  it('refuses to pad to fewer samples than it was given', () => {
    const result = spectrum(sine(64, 5), 64, { padTo: 32 })
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'invalid-argument')
  })

  it('distinguishes removing the mean from leaving it in', () => {
    const withOffset = sine(64, 6, 1).map((one) => one + 10)
    const left = spectrum(withOffset, 64)
    const removed = spectrum(withOffset, 64, { removeMean: true })
    assert.ok(!isSignalError(left))
    assert.ok(!isSignalError(removed))
    closeTo(left.bins[0]?.amplitude as number, 10, 1e-9)
    closeTo(removed.bins[0]?.amplitude as number, 0, 1e-9)
    assert.ok(removed.caveats.some((one) => /no longer reports the signal offset/.test(one)))
    assert.ok(left.caveats.some((one) => /can leak into the bins beside it/.test(one)))
  })

  it('warns when the record is too short for the picture to be trusted', () => {
    const result = spectrum(sine(16, 3), 16)
    assert.ok(!isSignalError(result))
    assert.ok(result.caveats.some((one) => /coarse picture/.test(one)))
  })

  it('needs two samples', () => {
    const result = spectrum([1], 10)
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'too-few')
  })

  it('refuses a series with a gap in it', () => {
    const result = spectrum([1, null, 3, 4], 10)
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'gap')
  })

  it('gives the same amplitude through any window, for a tone on a bin centre', () => {
    // The window correction exists precisely so this holds. If it did not, the choice of window would change the answer.
    for (const name of WINDOW_NAMES) {
      const result = spectrum(sine(128, 16, 1.5), 128, { window: name })
      assert.ok(!isSignalError(result))
      closeTo(result.bins[16]?.amplitude as number, 1.5, 2e-3, name)
    }
  })
})

describe('peaks', () => {
  it('finds a single tone and skips DC by default', () => {
    const input = spectrum(sine(256, 20, 4).map((one) => one + 7), 256)
    assert.ok(!isSignalError(input))
    const found = peaks(input)
    assert.ok(found.length >= 1)
    assert.equal(found[0]?.index, 20)
    closeTo(found[0]?.amplitude as number, 4, 1e-6)
  })

  it('finds two tones and ranks them by size', () => {
    const both = sine(512, 30, 5).map((one, i) => one + (sine(512, 70, 2)[i] as number))
    const input = spectrum(both, 512)
    assert.ok(!isSignalError(input))
    const found = peaks(input, { minimumAboveMedian: 2 })
    assert.equal(found[0]?.index, 30)
    assert.equal(found[1]?.index, 70)
  })

  it('interpolates a frequency between bins and says it did', () => {
    // 20.5 cycles in the record: exactly between bin 20 and bin 21.
    const input = spectrum(sine(256, 20.5, 1), 256)
    assert.ok(!isSignalError(input))
    const found = peaks(input, { minimumAboveMedian: 2 })
    const top = found[0]
    assert.ok(top !== undefined)
    assert.equal(top.interpolated, true)
    // The true frequency is 20.5 bins × 1 Hz per bin. The parabola gets closer to it than the bin centre does.
    assert.ok(Math.abs(top.frequencyHz - 20.5) < Math.abs(top.binFrequencyHz - 20.5))
  })

  it('reports no peaks in a flat spectrum', () => {
    const input = spectrum(new Array<number>(64).fill(0), 64)
    assert.ok(!isSignalError(input))
    assert.equal(peaks(input).length, 0)
  })

  it('honours the limit', () => {
    const rng = noise(7)
    const values = Array.from({ length: 512 }, () => rng())
    const input = spectrum(values, 512)
    assert.ok(!isSignalError(input))
    assert.ok(peaks(input, { minimumAboveMedian: 0.1, limit: 3 }).length <= 3)
  })

  it('can be asked to include DC', () => {
    const input = spectrum(new Array<number>(64).fill(5), 64)
    assert.ok(!isSignalError(input))
    const found = peaks(input, { skipDc: false, minimumAboveMedian: 0 })
    assert.equal(found[0]?.index, 0)
  })
})

describe('bandPower', () => {
  it('finds the power of a tone inside its band', () => {
    const input = spectrum(sine(1024, 100, 2), 1024, { window: 'rectangular' })
    assert.ok(!isSignalError(input))
    const result = bandPower(input, 90, 110)
    assert.ok(!isSignalError(result))
    // A sine of amplitude 2 has mean square 2, so the RMS in its band is about √2.
    closeTo(result.rms, Math.SQRT2, 0.02)
  })

  it('refuses a band that starts above Nyquist', () => {
    const input = spectrum(sine(64, 5), 64)
    assert.ok(!isSignalError(input))
    const result = bandPower(input, 100, 200)
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'outside-range')
    assert.match(result.message, /Nyquist/)
  })

  it('clips a band that runs past Nyquist and says so', () => {
    const input = spectrum(sine(64, 5), 64)
    assert.ok(!isSignalError(input))
    const result = bandPower(input, 10, 100)
    assert.ok(!isSignalError(result))
    assert.equal(result.highHz, 32)
    assert.match(result.why, /asked to go higher/)
  })

  it('says when a band fell between bins rather than reporting zero as a finding', () => {
    const input = spectrum(sine(64, 5), 64)
    assert.ok(!isSignalError(input))
    const result = bandPower(input, 10.2, 10.4)
    assert.ok(!isSignalError(result))
    assert.equal(result.binsUsed, 0)
    assert.match(result.why, /can fall between two of them/)
  })

  it('refuses an inverted band', () => {
    const input = spectrum(sine(64, 5), 64)
    assert.ok(!isSignalError(input))
    assert.ok(isSignalError(bandPower(input, 20, 10)))
  })
})

describe('welch', () => {
  it('averages segments and says how many', () => {
    const rng = noise(99)
    const values = Array.from({ length: 1024 }, () => rng())
    const result = welch(values, 1024, { segmentLength: 256 })
    assert.ok(!isSignalError(result))
    assert.equal(result.segmentLength, 256)
    assert.ok(result.segments >= 7)
    assert.equal(result.bins.length, 129)
  })

  it('gives a steadier density than a single transform for noise', () => {
    const rng = noise(4242)
    const values = Array.from({ length: 2048 }, () => rng())
    const single = spectrum(values, 2048, { window: 'hann' })
    const averaged = welch(values, 2048, { segmentLength: 256 })
    assert.ok(!isSignalError(single))
    assert.ok(!isSignalError(averaged))
    const scatter = (xs: readonly { densityPerHz: number }[]): number => {
      const values = xs.slice(1, xs.length - 1).map((one) => one.densityPerHz)
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length
      return Math.sqrt(variance) / mean
    }
    assert.ok(scatter(averaged.bins) < scatter(single.bins))
  })

  it('recovers the amplitude of a tone through the averaging', () => {
    const result = welch(sine(1024, 128, 3), 1024, { segmentLength: 256, overlap: 0 })
    assert.ok(!isSignalError(result))
    // 128 cycles in 1024 samples is 32 cycles in each 256-sample segment: bin 32 of every segment.
    closeTo(result.bins[32]?.amplitude as number, 3, 1e-6)
  })

  it('says plainly when one segment means no averaging happened', () => {
    const result = welch(sine(256, 16, 1), 256, { segmentLength: 256 })
    assert.ok(!isSignalError(result))
    assert.equal(result.segments, 1)
    assert.ok(result.caveats.some((one) => /not an average/.test(one)))
  })

  it('warns that overlapping segments are not independent', () => {
    const rng = noise(3)
    const result = welch(Array.from({ length: 1024 }, () => rng()), 1024, { segmentLength: 256, overlap: 0.75 })
    assert.ok(!isSignalError(result))
    assert.ok(result.caveats.some((one) => /not independent/.test(one)))
  })

  it('warns that an averaged density has no meaningful phase', () => {
    const rng = noise(11)
    const result = welch(Array.from({ length: 512 }, () => rng()), 512, { segmentLength: 128 })
    assert.ok(!isSignalError(result))
    assert.ok(result.caveats.some((one) => /no meaningful phase/.test(one)))
  })

  it('refuses a segment longer than the record', () => {
    const result = welch([1, 2, 3, 4], 4, { segmentLength: 8 })
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'too-few')
  })

  it('refuses an overlap of 1, which would never advance', () => {
    const result = welch(sine(256, 8), 256, { segmentLength: 64, overlap: 1 })
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'invalid-argument')
  })
})

describe('movingAverage', () => {
  it('leaves the edges empty rather than computing them from a partial window', () => {
    const result = movingAverage([1, 2, 3, 4, 5], 3)
    assert.ok(!isSignalError(result))
    assert.deepEqual([...result.values], [null, 2, 3, 4, null])
    assert.equal(result.edgeSamples, 1)
  })

  it('keeps the series the same length so it still lines up with its timestamps', () => {
    const result = movingAverage([1, 2, 3, 4, 5, 6, 7], 5)
    assert.ok(!isSignalError(result))
    assert.equal(result.values.length, 7)
  })

  it('refuses an even window when centred, and names the fix', () => {
    const result = movingAverage([1, 2, 3, 4], 2)
    assert.ok(isSignalError(result))
    assert.match(result.message, /Use 3/)
  })

  it('allows an even window for a trailing average, and says it lags', () => {
    const result = movingAverage([1, 2, 3, 4], 2, { centred: false })
    assert.ok(!isSignalError(result))
    assert.deepEqual([...result.values], [null, 1.5, 2.5, 3.5])
    assert.match(result.why, /lags the original/)
  })

  it('refuses a window longer than the series', () => {
    const result = movingAverage([1, 2], 5)
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'too-few')
  })

  it('does not drift over a long series', () => {
    // The running sum is incremental, so an accumulated error would show up here and nowhere else.
    const values = Array.from({ length: 4000 }, (_, i) => (i % 7) * 1.5)
    const result = movingAverage(values, 7)
    assert.ok(!isSignalError(result))
    const expected = (0 + 1.5 + 3 + 4.5 + 6 + 7.5 + 9) / 7
    for (let i = 3; i < 3997; i += 1) closeTo(result.values[i] as number, expected, 1e-9, `index ${i}`)
  })
})

describe('movingMedian', () => {
  it('ignores a single spike that a mean would be dragged by', () => {
    const values = [1, 1, 1, 100, 1, 1, 1]
    const median = movingMedian(values, 3)
    const mean = movingAverage(values, 3)
    assert.ok(!isSignalError(median))
    assert.ok(!isSignalError(mean))
    assert.equal(median.values[3], 1)
    assert.ok((mean.values[3] as number) > 30)
  })

  it('refuses an even window', () => {
    assert.ok(isSignalError(movingMedian([1, 2, 3, 4], 4)))
  })
})

describe('exponentialSmoothing', () => {
  it('has no edge gap but starts at the first sample unsmoothed', () => {
    const result = exponentialSmoothing([10, 0, 0, 0], 0.5)
    assert.ok(!isSignalError(result))
    assert.equal(result.edgeSamples, 0)
    assert.equal(result.values[0], 10)
    assert.equal(result.values[1], 5)
    assert.equal(result.values[2], 2.5)
  })

  it('passes everything through at alpha 1', () => {
    const result = exponentialSmoothing([3, 7, 2], 1)
    assert.ok(!isSignalError(result))
    assert.deepEqual([...result.values], [3, 7, 2])
  })

  it('refuses alpha of 0, which would never update', () => {
    assert.ok(isSignalError(exponentialSmoothing([1, 2], 0)))
  })
})

describe('detrend', () => {
  it('removes a straight line and reports the slope it removed', () => {
    const values = Array.from({ length: 50 }, (_, i) => 5 + 2 * i)
    const result = detrend(values, 'linear')
    assert.ok(!isSignalError(result))
    closeTo(result.slopePerSample, 2, 1e-9)
    closeTo(result.intercept, 5, 1e-9)
    for (const one of result.values) closeTo(one, 0, 1e-9)
  })

  it('keeps the trend so the original can be recovered exactly', () => {
    const values = Array.from({ length: 30 }, (_, i) => 3 * i - 4 + Math.sin(i))
    const result = detrend(values)
    assert.ok(!isSignalError(result))
    for (let i = 0; i < values.length; i += 1) {
      closeTo((result.values[i] as number) + (result.trend[i] as number), values[i] as number, 1e-9)
    }
  })

  it('leaves the drift in place when only the mean is removed', () => {
    const values = Array.from({ length: 20 }, (_, i) => i)
    const result = detrend(values, 'mean')
    assert.ok(!isSignalError(result))
    assert.equal(result.slopePerSample, 0)
    assert.match(result.why, /still there/)
    assert.ok((result.values[19] as number) > 5)
  })

  it('says that removing a trend also removes any real slow change', () => {
    const result = detrend([1, 2, 3, 4], 'linear')
    assert.ok(!isSignalError(result))
    assert.match(result.why, /removes any real slow change/)
  })
})

describe('differenceSeries', () => {
  it('differences neighbours by default', () => {
    const result = differenceSeries([1, 4, 9, 16])
    assert.ok(!isSignalError(result))
    assert.deepEqual([...result], [3, 5, 7])
  })

  it('differences at a lag', () => {
    const result = differenceSeries([1, 2, 3, 4, 5], 2)
    assert.ok(!isSignalError(result))
    assert.deepEqual([...result], [2, 2, 2])
  })

  it('refuses a lag that leaves nothing', () => {
    assert.ok(isSignalError(differenceSeries([1, 2], 2)))
  })
})

describe('autocorrelation', () => {
  it('is 1 at lag 0 and says that carries no information', () => {
    const result = autocorrelation(sine(128, 8))
    assert.ok(!isSignalError(result))
    closeTo(result.lags[0]?.correlation as number, 1, 1e-12)
    assert.ok(result.caveats.some((one) => /carries no information/.test(one)))
  })

  it('reports the period as the first positive peak, not as the largest magnitude', () => {
    // 8 cycles in 128 samples is a period of 16. The largest *magnitude* is at lag 8, where the series is the exact
    // opposite of itself — a strong relationship, and the opposite of a repeat. Reading that as the period halves it.
    const result = autocorrelation(sine(128, 8), 40)
    assert.ok(!isSignalError(result))
    assert.equal(result.repeatAt?.lag, 16)
    assert.ok((result.repeatAt?.correlation as number) > 0.8)
    assert.equal(result.strongest?.lag, 8)
    assert.ok((result.strongest?.correlation as number) < 0)
  })

  it('says in words that a negative strongest lag is not a repeat', () => {
    const result = autocorrelation(sine(128, 8), 40)
    assert.ok(!isSignalError(result))
    assert.ok(result.caveats.some((one) => /That is not a repeat/.test(one)))
    assert.ok(result.caveats.some((one) => /period candidate/.test(one)))
  })

  it('reports no period when nothing peaks positively', () => {
    const result = autocorrelation([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 5)
    assert.ok(!isSignalError(result))
    assert.equal(result.repeatAt, null)
    assert.ok(result.caveats.some((one) => /no period is suggested/.test(one)))
  })

  it('has no period to report for two different series', () => {
    const result = crossCorrelation(sine(64, 4), sine(64, 4), 10)
    assert.ok(!isSignalError(result))
    assert.equal(result.repeatAt, null)
  })

  it('reports fewer pairs at larger lags', () => {
    const result = autocorrelation(sine(64, 4), 30)
    assert.ok(!isSignalError(result))
    assert.equal(result.lags[0]?.pairs, 64)
    assert.equal(result.lags[30]?.pairs, 34)
  })

  it('warns when the strongest lag rests on too few pairs', () => {
    // Two large opposite values at the ends and nothing in between: the only non-zero product is at the longest lag,
    // where exactly one pair of samples is available.
    const result = autocorrelation([10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -10], 11)
    assert.ok(!isSignalError(result))
    assert.equal(result.strongest?.lag, 11)
    assert.equal(result.strongest?.pairs, 1)
    assert.ok(result.caveats.some((one) => /too few to distinguish/.test(one)))
  })

  it('refuses a flat series, because a flat series has no period', () => {
    const result = autocorrelation([4, 4, 4, 4, 4])
    assert.ok(isSignalError(result))
    assert.match(result.message, /no period/)
  })

  it('never claims a peak establishes a period', () => {
    const result = autocorrelation(sine(64, 4))
    assert.ok(!isSignalError(result))
    assert.ok(result.caveats.some((one) => /does not establish a period/.test(one)))
  })
})

describe('crossCorrelation', () => {
  it('finds the lag by which one series follows another', () => {
    const base = sine(128, 4)
    const shifted = [...new Array<number>(5).fill(0), ...base.slice(0, 123)]
    const result = crossCorrelation(base, shifted, 20)
    assert.ok(!isSignalError(result))
    assert.equal(result.strongest?.lag, 5)
  })

  it('refuses series of different lengths', () => {
    const result = crossCorrelation([1, 2, 3], [1, 2])
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'mismatched-length')
  })

  it('never turns a lead into a cause', () => {
    const result = crossCorrelation(sine(64, 3), sine(64, 3, 1, 0.5), 10)
    assert.ok(!isSignalError(result))
    assert.ok(result.caveats.some((one) => /not a causal one/.test(one)))
  })

  it('refuses a flat series', () => {
    assert.ok(isSignalError(crossCorrelation([1, 1, 1, 1], [1, 2, 3, 4])))
  })
})

describe('convolve', () => {
  it('convolves against a known answer', () => {
    const result = convolve([1, 2, 3], [1, 1])
    assert.ok(!isSignalError(result))
    assert.deepEqual([...result], [1, 3, 5, 3])
  })

  it('gives each mode its documented length', () => {
    const full = convolve([1, 2, 3, 4, 5], [1, 1, 1], 'full')
    const same = convolve([1, 2, 3, 4, 5], [1, 1, 1], 'same')
    const valid = convolve([1, 2, 3, 4, 5], [1, 1, 1], 'valid')
    assert.ok(!isSignalError(full))
    assert.ok(!isSignalError(same))
    assert.ok(!isSignalError(valid))
    assert.equal(full.length, 7)
    assert.equal(same.length, 5)
    assert.equal(valid.length, 3)
    assert.deepEqual([...valid], [6, 9, 12])
  })

  it('refuses a kernel longer than the data', () => {
    const result = convolve([1, 2], [1, 1, 1])
    assert.ok(isSignalError(result))
    assert.match(result.message, /no position where it fits/)
  })
})

describe('designFilter', () => {
  it('gives a low-pass unit gain at DC', () => {
    const filter = designFilter('low-pass', 100, 1000, 51)
    assert.ok(!isSignalError(filter))
    let sum = 0
    for (const one of filter.coefficients) sum += one
    closeTo(sum, 1, 1e-9)
  })

  it('attenuates DC heavily with a high-pass, without pretending to null it exactly', () => {
    // A windowed-sinc high-pass suppresses DC rather than cancelling it: the window's own leakage leaves a residue.
    // 60 dB down is the honest claim here, and asserting an exact zero would be asserting something untrue.
    const filter = designFilter('high-pass', 300, 1000, 51)
    assert.ok(!isSignalError(filter))
    let sum = 0
    for (const one of filter.coefficients) sum += one
    assert.ok(Math.abs(sum) < 1e-2, `DC gain ${sum} should be at least 40 dB down`)
    assert.ok(Math.abs(sum) > 0, 'and it is not exactly zero, which is why this is a bound and not an equality')
  })

  it('is symmetric, which is what makes the delay removable', () => {
    const filter = designFilter('low-pass', 100, 1000, 31)
    assert.ok(!isSignalError(filter))
    for (let i = 0; i < 31; i += 1) {
      closeTo(filter.coefficients[i] as number, filter.coefficients[30 - i] as number, 1e-12, `tap ${i}`)
    }
    assert.equal(filter.delaySamples, 15)
  })

  it('refuses an even number of taps, which would give half a sample of delay', () => {
    const result = designFilter('low-pass', 100, 1000, 32)
    assert.ok(isSignalError(result))
    assert.match(result.message, /odd/)
  })

  it('refuses a cutoff at or above Nyquist', () => {
    const result = designFilter('low-pass', 500, 1000, 31)
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'outside-range')
  })

  it('needs two cutoffs for a band filter and one otherwise', () => {
    assert.ok(isSignalError(designFilter('band-pass', 100, 1000, 31)))
    assert.ok(isSignalError(designFilter('low-pass', [100, 200], 1000, 31)))
  })

  it('refuses an inverted band', () => {
    assert.ok(isSignalError(designFilter('band-pass', [300, 100], 1000, 31)))
  })

  it('reports the transition width, which narrows as taps grow', () => {
    const short = designFilter('low-pass', 100, 1000, 21)
    const long = designFilter('low-pass', 100, 1000, 201)
    assert.ok(!isSignalError(short))
    assert.ok(!isSignalError(long))
    assert.ok(long.transitionHz < short.transitionHz)
    assert.match(short.why, /more taps means a longer delay/)
  })
})

describe('applyFilter', () => {
  it('passes a low tone and blocks a high one', () => {
    const rate = 1000
    const low = sine(1024, 10) // ~9.8 Hz
    const high = sine(1024, 400) // ~390 Hz
    const mixed = low.map((one, i) => one + (high[i] as number))
    const filter = designFilter('low-pass', 100, rate, 101)
    assert.ok(!isSignalError(filter))
    const result = applyFilter(mixed, filter)
    assert.ok(!isSignalError(result))
    const inner = result.values.slice(150, 850).map((one) => one as number)
    const wantedInner = low.slice(150, 850)
    for (let i = 0; i < inner.length; i += 1) {
      closeTo(inner[i] as number, wantedInner[i] as number, 0.05, `sample ${i + 150}`)
    }
  })

  it('aligns the output with the input rather than leaving it delayed', () => {
    const filter = designFilter('low-pass', 50, 1000, 31)
    assert.ok(!isSignalError(filter))
    const values = sine(512, 5) // well inside the pass band
    const result = applyFilter(values, filter)
    assert.ok(!isSignalError(result))
    closeTo(result.values[100] as number, values[100] as number, 0.02)
    assert.match(result.why, /has been removed/)
  })

  it('leaves the ends empty rather than inventing samples beyond the record', () => {
    const filter = designFilter('low-pass', 100, 1000, 21)
    assert.ok(!isSignalError(filter))
    const result = applyFilter(sine(128, 4), filter)
    assert.ok(!isSignalError(result))
    assert.equal(result.edgeSamples, 10)
    for (let i = 0; i < 10; i += 1) assert.equal(result.values[i], null, `start ${i}`)
    for (let i = 118; i < 128; i += 1) assert.equal(result.values[i], null, `end ${i}`)
    assert.equal(result.values.length, 128)
  })

  it('refuses a kernel longer than the series', () => {
    const filter = designFilter('low-pass', 100, 1000, 101)
    assert.ok(!isSignalError(filter))
    const result = applyFilter(sine(50, 3), filter)
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'too-few')
  })

  it('passes a band and blocks either side of it', () => {
    const rate = 1000
    const inside = sine(2048, 200) // ~97.7 Hz
    const below = sine(2048, 20)
    const above = sine(2048, 800)
    const mixed = inside.map((one, i) => one + (below[i] as number) + (above[i] as number))
    const filter = designFilter('band-pass', [70, 130], rate, 201, 'blackman')
    assert.ok(!isSignalError(filter))
    const result = applyFilter(mixed, filter)
    assert.ok(!isSignalError(result))
    const kept = result.values.slice(300, 1700).map((one) => one as number)
    const wanted = inside.slice(300, 1700)
    for (let i = 0; i < kept.length; i += 1) {
      closeTo(kept[i] as number, wanted[i] as number, 0.08, `sample ${i + 300}`)
    }
  })
})

describe('resample', () => {
  it('interpolates between measurements', () => {
    const result = resample([0, 1, 2], [0, 10, 20], [0.5, 1.5])
    assert.ok(!isSignalError(result))
    assert.deepEqual([...result.values], [5, 15])
  })

  it('refuses to extrapolate, and says which points it refused', () => {
    const result = resample([0, 1, 2], [0, 10, 20], [-1, 1, 3])
    assert.ok(!isSignalError(result))
    assert.deepEqual([...result.times], [1])
    assert.deepEqual([...result.refusedOutside], [-1, 3])
    assert.match(result.why, /nothing bounding it/)
  })

  it('names interpolation as an assumption even when it succeeds', () => {
    const result = resample([0, 1], [0, 1], [0.5])
    assert.ok(!isSignalError(result))
    assert.match(result.why, /is an assumption/)
  })

  it('handles a long irregular grid by binary search', () => {
    const times = Array.from({ length: 1000 }, (_, i) => i * i)
    const values = times.map((t) => 2 * t + 1)
    const result = resample(times, values, [500, 250_000, 900_000])
    assert.ok(!isSignalError(result))
    assert.equal(result.values.length, 3)
    // On a straight line, linear interpolation is exact wherever it lands.
    closeTo(result.values[1] as number, 500_001, 1e-6)
  })

  it('refuses timestamps that do not increase', () => {
    assert.ok(isSignalError(resample([0, 2, 1], [1, 2, 3], [0.5])))
  })

  it('refuses mismatched lengths', () => {
    const result = resample([0, 1, 2], [1, 2], [0.5])
    assert.ok(isSignalError(result))
    assert.equal(result.error, 'mismatched-length')
  })
})

describe('decimate', () => {
  it('keeps every nth sample and halves the representable band', () => {
    const result = decimate([1, 2, 3, 4, 5, 6, 7, 8], 2, 100, true)
    assert.ok(!isSignalError(result))
    assert.deepEqual([...result.values], [1, 3, 5, 7])
    assert.equal(result.newRateHz, 50)
    assert.equal(result.newNyquistHz, 25)
  })

  it('warns about folding when no filter was applied first', () => {
    const result = decimate([1, 2, 3, 4, 5, 6], 2, 100, false)
    assert.ok(!isSignalError(result))
    assert.ok(result.warnings.some((one) => /folded down/.test(one)))
  })

  it('does not warn about folding when the filtering was done', () => {
    const result = decimate([1, 2, 3, 4, 5, 6], 2, 100, true)
    assert.ok(!isSignalError(result))
    assert.ok(!result.warnings.some((one) => /folded down/.test(one)))
    // But it still says information was discarded, because it was.
    assert.ok(result.warnings.some((one) => /discarded, not compressed/.test(one)))
  })

  it('refuses a factor of 1, which would do nothing', () => {
    assert.ok(isSignalError(decimate([1, 2, 3], 1, 10, true)))
  })
})

describe('signalFacts', () => {
  it('separates the RMS of the signal from the RMS of its variation', () => {
    const values = sine(512, 8, 2).map((one) => one + 10)
    const result = signalFacts(values)
    assert.ok(!isSignalError(result))
    closeTo(result.mean, 10, 1e-9)
    closeTo(result.rmsAboutMean, 2 / Math.SQRT2, 1e-3)
    assert.ok(result.rms > 10)
  })

  it('gives a sine a crest factor near the square root of two', () => {
    const result = signalFacts(sine(1024, 16, 3))
    assert.ok(!isSignalError(result))
    closeTo(result.crestFactor as number, Math.SQRT2, 0.01)
  })

  it('gives a spiky series a much higher crest factor than a sine', () => {
    const spiky = new Array<number>(512).fill(0)
    spiky[100] = 50
    spiky[300] = -50
    const result = signalFacts(spiky)
    assert.ok(!isSignalError(result))
    assert.ok((result.crestFactor as number) > 10)
  })

  it('has no crest factor for a flat series and says why', () => {
    const result = signalFacts([7, 7, 7, 7])
    assert.ok(!isSignalError(result))
    assert.equal(result.crestFactor, null)
    assert.match(result.why, /no variation/)
  })

  it('counts mean crossings at twice the cycle count', () => {
    const result = signalFacts(sine(1000, 10))
    assert.ok(!isSignalError(result))
    // Ten cycles cross the mean twenty times, give or take the endpoints.
    assert.ok(Math.abs(result.meanCrossings - 20) <= 1)
  })

  it('refuses a series with a gap', () => {
    assert.ok(isSignalError(signalFacts([1, null, 3])))
  })
})
