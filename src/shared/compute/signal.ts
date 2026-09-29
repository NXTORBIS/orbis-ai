/**
 * Signals and series in time and frequency, with the sampling never left implicit.
 *
 * The shared signal engine for Orbis Pages. It turns a sampled series into spectra, correlations, filtered copies and
 * summary facts. Everything is deterministic and everything that depends on the sampling rate says so, because a
 * frequency without its sampling rate is a number with no units attached to it.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * sample index   vs   time            -- bin 7 is not "7 Hz" until a rate says so
 * uniform        vs   nearly uniform  -- a spectrum of jittered samples is a spectrum of the jitter too
 * bin frequency  vs   true frequency  -- a peak between bins is interpolated, and labelled as interpolated
 * amplitude      vs   power           -- one is volts, the other volts squared; a dB figure needs to say which
 * windowed       vs   raw             -- a window changes amplitudes, so the correction is applied and reported
 * smoothed       vs   measured        -- a moving average is a new series, never an edit of the old one
 * missing        vs   zero            -- a gap refuses the transform instead of being silently filled with 0
 * below Nyquist  vs   above           -- nothing above half the rate is reported, because nothing up there is knowable
 * ```
 *
 * Two things this engine will not do. It will not extrapolate: resampling outside the measured span returns a refusal,
 * not a guess. And it will not present a decimated series as if no information were lost: dropping samples without
 * filtering first folds high frequencies down onto low ones, and `decimate` says so every time.
 *
 * Pure. No network, no clock, no storage. Every transform of the same input gives the same output.
 */

// ---------------------------------------------------------------- failure

export interface SignalError {
  error:
    | 'empty'
    | 'too-few'
    | 'not-finite'
    | 'gap'
    | 'not-uniform'
    | 'mismatched-length'
    | 'invalid-argument'
    | 'too-large'
    | 'outside-range'
  message: string
}

export const isSignalError = (value: unknown): value is SignalError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: SignalError['error'], message: string): SignalError => ({ error, message })

/** Past this many samples a transform is refused rather than attempted, so a Page cannot stall the engine. */
export const MAXIMUM_SAMPLES = 1_048_576

/**
 * Checks a series is usable as a signal: non-empty, all finite, no gaps.
 *
 * A gap is named by index rather than skipped. Filling one with zero would add a step change to the signal, and a step
 * change has energy at every frequency — the gap would show up across the whole spectrum as if it were real.
 */
export function checkValues(values: readonly (number | null)[]): readonly number[] | SignalError {
  if (values.length === 0) return fail('empty', 'There are no samples.')
  if (values.length > MAXIMUM_SAMPLES) {
    return fail('too-large', `${values.length} samples is more than the ${MAXIMUM_SAMPLES} this engine will transform.`)
  }
  const gaps: number[] = []
  const bad: number[] = []
  for (let i = 0; i < values.length; i += 1) {
    const one = values[i]
    if (one === null || one === undefined) gaps.push(i)
    else if (!Number.isFinite(one)) bad.push(i)
  }
  if (gaps.length > 0) {
    const shown = gaps.slice(0, 6).join(', ')
    return fail(
      'gap',
      `${gaps.length} sample${gaps.length === 1 ? '' : 's'} ${gaps.length === 1 ? 'is' : 'are'} missing (index ${shown}${gaps.length > 6 ? ', …' : ''}). Fill or interpolate them deliberately first — filling a gap with zero puts a step change into the signal, and a step change has energy at every frequency.`
    )
  }
  if (bad.length > 0) {
    const shown = bad.slice(0, 6).join(', ')
    return fail('not-finite', `Samples at index ${shown}${bad.length > 6 ? ', …' : ''} are not finite numbers.`)
  }
  return values as readonly number[]
}

// ---------------------------------------------------------------- sampling

/** What the sampling of a series is, once a rate is known. */
export interface Sampling {
  /** How many samples there are. */
  count: number
  /** Samples per second. */
  rateHz: number
  /** Seconds between samples. */
  intervalSeconds: number
  /** Total span covered, `(count - 1) * interval` — the span between first and last sample, not `count * interval`. */
  durationSeconds: number
  /** The highest frequency this rate can represent. Nothing above it is reported by anything in this file. */
  nyquistHz: number
  /** The spacing between spectrum bins, `rate / count`. Two frequencies closer than this cannot be told apart. */
  resolutionHz: number
}

export function samplingOf(count: number, rateHz: number): Sampling | SignalError {
  if (!Number.isInteger(count) || count < 1) return fail('invalid-argument', 'The sample count must be a whole number of at least 1.')
  if (!Number.isFinite(rateHz) || rateHz <= 0) return fail('invalid-argument', 'The sampling rate must be a positive number of samples per second.')
  return {
    count,
    rateHz,
    intervalSeconds: 1 / rateHz,
    durationSeconds: (count - 1) / rateHz,
    nyquistHz: rateHz / 2,
    resolutionHz: rateHz / count
  }
}

/** How evenly spaced a set of timestamps actually is. */
export interface UniformityCheck {
  /** True when every gap is within tolerance of the median gap. */
  uniform: boolean
  /** The median gap, in the same units as the timestamps given. */
  medianInterval: number
  /** Smallest and largest gap seen. */
  shortestInterval: number
  longestInterval: number
  /** The largest deviation from the median gap, as a share of the median. */
  worstDeviation: number
  /** Indices where the gap to the previous timestamp is outside tolerance. */
  irregularAt: readonly number[]
  /** Plain reason, whichever way the answer went. */
  why: string
}

/**
 * Checks whether timestamps are evenly spaced, which every frequency transform here assumes.
 *
 * The check is not pedantry. A discrete Fourier transform has no way to know when its samples were taken; it assumes
 * they were evenly spaced and reports frequencies on that assumption. Feed it jittered samples and the jitter becomes
 * part of the answer, spread across the spectrum as broadband noise that looks exactly like measurement noise.
 */
export function checkUniform(times: readonly number[], tolerance = 0.01): UniformityCheck | SignalError {
  if (times.length < 2) return fail('too-few', 'At least two timestamps are needed to measure the spacing between them.')
  if (!Number.isFinite(tolerance) || tolerance < 0) return fail('invalid-argument', 'The tolerance must be a non-negative fraction.')
  const gaps: number[] = []
  for (let i = 1; i < times.length; i += 1) {
    const before = times[i - 1]
    const now = times[i]
    if (before === undefined || now === undefined || !Number.isFinite(before) || !Number.isFinite(now)) {
      return fail('not-finite', `The timestamp at index ${i} is not a finite number.`)
    }
    const gap = now - before
    if (gap <= 0) return fail('invalid-argument', `Timestamps must increase; index ${i} is not after index ${i - 1}.`)
    gaps.push(gap)
  }
  const sorted = [...gaps].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
  const irregularAt: number[] = []
  let worst = 0
  for (let i = 0; i < gaps.length; i += 1) {
    const deviation = Math.abs((gaps[i] ?? 0) - median) / median
    if (deviation > worst) worst = deviation
    if (deviation > tolerance) irregularAt.push(i + 1)
  }
  const uniform = irregularAt.length === 0
  return {
    uniform,
    medianInterval: median,
    shortestInterval: sorted[0] ?? 0,
    longestInterval: sorted[sorted.length - 1] ?? 0,
    worstDeviation: worst,
    irregularAt,
    why: uniform
      ? `Every gap is within ${(tolerance * 100).toFixed(1)}% of the median ${median}.`
      : `${irregularAt.length} gap${irregularAt.length === 1 ? '' : 's'} differ${irregularAt.length === 1 ? 's' : ''} from the median by more than ${(tolerance * 100).toFixed(1)}%; the worst is off by ${(worst * 100).toFixed(1)}%. A frequency transform assumes even spacing, so uneven samples would put the unevenness into the spectrum. Resample onto a regular grid first.`
  }
}

// ---------------------------------------------------------------- windows

/**
 * The window functions this engine knows.
 *
 * A window tapers the ends of a finite record to zero. Without one, the transform sees the record as if it repeated
 * forever, and the discontinuity where the end meets the start leaks energy across every bin — a single clean tone
 * smears into a skirt that can bury a smaller tone beside it.
 */
export type WindowName =
  | 'rectangular'
  | 'hann'
  | 'hamming'
  | 'blackman'
  | 'blackman-harris'
  | 'bartlett'
  | 'welch'
  | 'flat-top'

export const WINDOW_NAMES: readonly WindowName[] = Object.freeze([
  'rectangular',
  'hann',
  'hamming',
  'blackman',
  'blackman-harris',
  'bartlett',
  'welch',
  'flat-top'
])

/** What choosing a window costs and buys. */
export interface WindowFacts {
  name: WindowName
  label: string
  /** The trade this window makes, in a sentence. */
  describe: string
  /** Width of the main lobe in bins — how far apart two tones must be to stay distinguishable. */
  mainLobeBins: number
  /** Highest sidelobe, in dB below the peak. More negative hides small tones better. */
  sidelobeDb: number
  /** Worst-case amplitude error for a tone falling between bins, in dB. */
  scallopLossDb: number
}

export const WINDOW_FACTS: Readonly<Record<WindowName, WindowFacts>> = Object.freeze({
  rectangular: {
    name: 'rectangular',
    label: 'Rectangular (none)',
    describe: 'No taper at all. The sharpest frequency resolution available, and the worst leakage — only right when the record already starts and ends at zero, or when nothing small sits near something large.',
    mainLobeBins: 2,
    sidelobeDb: -13.3,
    scallopLossDb: 3.92
  },
  hann: {
    name: 'hann',
    label: 'Hann',
    describe: 'The usual first choice. Leakage falls away quickly, at the cost of a main lobe twice as wide as no window at all.',
    mainLobeBins: 4,
    sidelobeDb: -31.5,
    scallopLossDb: 1.42
  },
  hamming: {
    name: 'hamming',
    label: 'Hamming',
    describe: 'A slightly narrower main lobe than Hann with a lower first sidelobe, but the far sidelobes fall away more slowly.',
    mainLobeBins: 4,
    sidelobeDb: -42.7,
    scallopLossDb: 1.75
  },
  blackman: {
    name: 'blackman',
    label: 'Blackman',
    describe: 'Much less leakage than Hann, and a main lobe half again as wide. Use it when a small tone sits close to a large one.',
    mainLobeBins: 6,
    sidelobeDb: -58.1,
    scallopLossDb: 1.1
  },
  'blackman-harris': {
    name: 'blackman-harris',
    label: 'Blackman–Harris (4-term)',
    describe: 'Very low leakage, wide main lobe. For separating tones by size rather than by frequency.',
    mainLobeBins: 8,
    sidelobeDb: -92,
    scallopLossDb: 0.83
  },
  bartlett: {
    name: 'bartlett',
    label: 'Bartlett (triangular)',
    describe: 'A plain triangle. Cheap, and better than nothing, but Hann beats it on both counts.',
    mainLobeBins: 4,
    sidelobeDb: -26.5,
    scallopLossDb: 1.82
  },
  welch: {
    name: 'welch',
    label: 'Welch (parabolic)',
    describe: 'A parabola. Between rectangular and Hann on every measure.',
    mainLobeBins: 4,
    sidelobeDb: -21.3,
    scallopLossDb: 2.22
  },
  'flat-top': {
    name: 'flat-top',
    label: 'Flat-top',
    describe: 'Deliberately flattens the top of the main lobe so a tone between bins still reads the right amplitude. The widest main lobe here — for measuring amplitude, not for separating frequencies.',
    mainLobeBins: 10,
    sidelobeDb: -93.6,
    scallopLossDb: 0.01
  }
})

/** The weights a window applies, with the two gains needed to undo its effect on amplitudes. */
export interface Window {
  name: WindowName
  weights: readonly number[]
  /**
   * The mean weight. Divide a measured amplitude by this to recover the amplitude before windowing.
   * Applied automatically by `spectrum`.
   */
  coherentGain: number
  /** The mean squared weight. Used for power, which needs the squares rather than the values. */
  powerGain: number
  /**
   * How much wider than one bin the effective noise bandwidth is. Broadband noise measured through a window occupies
   * this many bins' worth of bandwidth per bin, which is why a density needs it and a single tone does not.
   */
  noiseBandwidthBins: number
}

/**
 * Builds the weights for a window of a given length.
 *
 * Periodic rather than symmetric: the divisor is `n`, not `n - 1`. A symmetric window repeats its endpoint when the
 * record is treated as periodic, which is exactly the discontinuity a window exists to remove.
 */
export function windowOf(name: WindowName, length: number): Window | SignalError {
  if (!Number.isInteger(length) || length < 1) return fail('invalid-argument', 'The window length must be a whole number of at least 1.')
  if (length > MAXIMUM_SAMPLES) return fail('too-large', `A window of ${length} is longer than the ${MAXIMUM_SAMPLES} this engine builds.`)
  if (!Object.prototype.hasOwnProperty.call(WINDOW_FACTS, name)) {
    return fail('invalid-argument', `There is no window called "${name}". The ones here are ${WINDOW_NAMES.join(', ')}.`)
  }
  const weights = new Array<number>(length)
  for (let i = 0; i < length; i += 1) {
    const t = i / length
    const angle = 2 * Math.PI * t
    switch (name) {
      case 'rectangular':
        weights[i] = 1
        break
      case 'hann':
        weights[i] = 0.5 - 0.5 * Math.cos(angle)
        break
      case 'hamming':
        weights[i] = 0.54 - 0.46 * Math.cos(angle)
        break
      case 'blackman':
        weights[i] = 0.42 - 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle)
        break
      case 'blackman-harris':
        weights[i] = 0.35875 - 0.48829 * Math.cos(angle) + 0.14128 * Math.cos(2 * angle) - 0.01168 * Math.cos(3 * angle)
        break
      case 'bartlett':
        weights[i] = 1 - Math.abs(2 * t - 1)
        break
      case 'welch': {
        const u = 2 * t - 1
        weights[i] = 1 - u * u
        break
      }
      case 'flat-top':
        weights[i] =
          0.21557895 -
          0.41663158 * Math.cos(angle) +
          0.277263158 * Math.cos(2 * angle) -
          0.083578947 * Math.cos(3 * angle) +
          0.006947368 * Math.cos(4 * angle)
        break
    }
  }
  let sum = 0
  let sumSquares = 0
  for (const w of weights) {
    sum += w
    sumSquares += w * w
  }
  const coherentGain = sum / length
  const powerGain = sumSquares / length
  return {
    name,
    weights,
    coherentGain,
    powerGain,
    // Σw² · n / (Σw)², the standard equivalent noise bandwidth in bins.
    noiseBandwidthBins: sum === 0 ? 1 : (sumSquares * length) / (sum * sum)
  }
}

/** Multiplies a series by a window's weights. Returns a new series; the input is untouched. */
export function applyWindow(values: readonly number[], window: Window): readonly number[] | SignalError {
  if (values.length !== window.weights.length) {
    return fail('mismatched-length', `The series has ${values.length} samples and the window has ${window.weights.length} weights.`)
  }
  return values.map((one, i) => one * (window.weights[i] ?? 0))
}

// ---------------------------------------------------------------- the transform itself

/** A complex series, held as two real arrays because that is what the transform works on. */
export interface ComplexSeries {
  re: readonly number[]
  im: readonly number[]
}

const isPowerOfTwo = (n: number): boolean => n > 0 && (n & (n - 1)) === 0

/** In-place radix-2 Cooley–Tukey. `re` and `im` must have a power-of-two length. */
function radix2(re: number[], im: number[], inverse: boolean): void {
  const n = re.length
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i] as number
      re[i] = re[j] as number
      re[j] = tr
      const ti = im[i] as number
      im[i] = im[j] as number
      im[j] = ti
    }
  }
  const sign = inverse ? 1 : -1
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const step = (sign * 2 * Math.PI) / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k += 1) {
        const angle = step * k
        const wr = Math.cos(angle)
        const wi = Math.sin(angle)
        const a = start + k
        const b = a + half
        const br = re[b] as number
        const bi = im[b] as number
        const tr = br * wr - bi * wi
        const ti = br * wi + bi * wr
        re[b] = (re[a] as number) - tr
        im[b] = (im[a] as number) - ti
        re[a] = (re[a] as number) + tr
        im[a] = (im[a] as number) + ti
      }
    }
  }
}

/**
 * The angle `π·t²/n`, with `t²` reduced modulo `2n` first.
 *
 * Without the reduction, `t²` for a long record is large enough that the fractional part of the angle is lost to
 * floating-point rounding, and the chirp stops being a chirp. The reduction is exact because `e^{iπ(t²+2n)/n}` and
 * `e^{iπt²/n}` differ by a full turn.
 */
const chirpAngle = (t: number, n: number): number => (Math.PI * ((t * t) % (2 * n))) / n

/**
 * Bluestein's algorithm: a DFT of any length, by way of a convolution done with power-of-two transforms.
 *
 * The alternative would be an O(n²) direct sum for lengths that are not powers of two, which for a 100-thousand-sample
 * record is the difference between a moment and a minute.
 */
function bluestein(input: ComplexSeries, inverse: boolean): ComplexSeries {
  const n = input.re.length
  let m = 1
  while (m < 2 * n - 1) m <<= 1
  const sign = inverse ? 1 : -1
  const ar = new Array<number>(m).fill(0)
  const ai = new Array<number>(m).fill(0)
  for (let i = 0; i < n; i += 1) {
    const angle = sign * chirpAngle(i, n)
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const xr = input.re[i] as number
    const xi = input.im[i] as number
    ar[i] = xr * c - xi * s
    ai[i] = xr * s + xi * c
  }
  const br = new Array<number>(m).fill(0)
  const bi = new Array<number>(m).fill(0)
  for (let i = 0; i < n; i += 1) {
    const angle = -sign * chirpAngle(i, n)
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    br[i] = c
    bi[i] = s
    if (i > 0) {
      br[m - i] = c
      bi[m - i] = s
    }
  }
  radix2(ar, ai, false)
  radix2(br, bi, false)
  for (let i = 0; i < m; i += 1) {
    const r = (ar[i] as number) * (br[i] as number) - (ai[i] as number) * (bi[i] as number)
    const q = (ar[i] as number) * (bi[i] as number) + (ai[i] as number) * (br[i] as number)
    ar[i] = r
    ai[i] = q
  }
  radix2(ar, ai, true)
  const re = new Array<number>(n)
  const im = new Array<number>(n)
  for (let k = 0; k < n; k += 1) {
    const angle = sign * chirpAngle(k, n)
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    // The inverse radix-2 above leaves a factor of m to divide out.
    const cr = (ar[k] as number) / m
    const ci = (ai[k] as number) / m
    re[k] = cr * c - ci * s
    im[k] = cr * s + ci * c
  }
  return { re, im }
}

/**
 * The discrete Fourier transform of a complex series, at any length.
 *
 * Unnormalised: `X[k] = Σ x[j]·e^{-2πijk/n}`. The scaling belongs with the interpretation, so `spectrum` applies it and
 * `inverseTransform` undoes it.
 */
export function transform(input: ComplexSeries): ComplexSeries | SignalError {
  const n = input.re.length
  if (n === 0) return fail('empty', 'There is nothing to transform.')
  if (n !== input.im.length) return fail('mismatched-length', `The real part has ${n} values and the imaginary part has ${input.im.length}.`)
  if (n > MAXIMUM_SAMPLES) return fail('too-large', `${n} samples is more than the ${MAXIMUM_SAMPLES} this engine will transform.`)
  for (let i = 0; i < n; i += 1) {
    if (!Number.isFinite(input.re[i]) || !Number.isFinite(input.im[i])) {
      return fail('not-finite', `The value at index ${i} is not finite.`)
    }
  }
  if (isPowerOfTwo(n)) {
    const re = [...input.re]
    const im = [...input.im]
    radix2(re, im, false)
    return { re, im }
  }
  return bluestein(input, false)
}

/** The inverse transform, scaled by `1/n` so that `inverseTransform(transform(x))` returns `x`. */
export function inverseTransform(input: ComplexSeries): ComplexSeries | SignalError {
  const n = input.re.length
  if (n === 0) return fail('empty', 'There is nothing to transform.')
  if (n !== input.im.length) return fail('mismatched-length', `The real part has ${n} values and the imaginary part has ${input.im.length}.`)
  if (n > MAXIMUM_SAMPLES) return fail('too-large', `${n} samples is more than the ${MAXIMUM_SAMPLES} this engine will transform.`)
  for (let i = 0; i < n; i += 1) {
    if (!Number.isFinite(input.re[i]) || !Number.isFinite(input.im[i])) {
      return fail('not-finite', `The value at index ${i} is not finite.`)
    }
  }
  if (isPowerOfTwo(n)) {
    const re = [...input.re]
    const im = [...input.im]
    radix2(re, im, true)
    return { re: re.map((one) => one / n), im: im.map((one) => one / n) }
  }
  const out = bluestein(input, true)
  return { re: out.re.map((one) => one / n), im: out.im.map((one) => one / n) }
}

/** Transforms a real series. Convenience over `transform` with a zero imaginary part. */
export function transformReal(values: readonly (number | null)[]): ComplexSeries | SignalError {
  const clean = checkValues(values)
  if (isSignalError(clean)) return clean
  return transform({ re: clean, im: new Array<number>(clean.length).fill(0) })
}

// ---------------------------------------------------------------- spectra

/** One bin of a spectrum. */
export interface Bin {
  /** Which bin, counting from 0 at DC. */
  index: number
  /** The frequency this bin is centred on, in Hz. */
  frequencyHz: number
  /** Peak amplitude of a sinusoid at this frequency, in the units of the input, corrected for the window. */
  amplitude: number
  /** The same thing as an RMS value. Zero at DC and Nyquist, where there is no oscillation to take an RMS of. */
  rms: number
  /** Power spectral density, in input-units squared per Hz. The right quantity for noise; amplitude is right for tones. */
  densityPerHz: number
  /** Phase in radians, meaningful only where the amplitude is above the noise. */
  phaseRadians: number
}

export interface Spectrum {
  /** One-sided: DC through Nyquist. Nothing above Nyquist, because nothing up there is knowable from these samples. */
  bins: readonly Bin[]
  sampling: Sampling
  window: WindowName
  /** What the window cost, carried along so a Page can show it beside the plot. */
  windowFacts: WindowFacts
  /** How many samples of zero padding were added, and what that does and does not buy. */
  zeroPadded: number
  /** Sentences a Page should show with the plot. Generated from what was actually done, not a fixed list. */
  caveats: readonly string[]
}

export interface SpectrumOptions {
  /** Defaults to Hann, which is the right default for a record that does not already start and end at zero. */
  window?: WindowName
  /**
   * Pad to this length with zeros before transforming. Padding interpolates the spectrum between bins — it draws a
   * smoother curve through the same information. It does not let two close frequencies be told apart; only a longer
   * record does that.
   */
  padTo?: number
  /** Remove the mean first. A large DC offset leaks into the low bins and can hide a real low-frequency component. */
  removeMean?: boolean
}

/**
 * The one-sided amplitude and density spectrum of a real series.
 *
 * Two normalisations that are easy to get wrong and are got right here. Amplitude bins between DC and Nyquist are
 * doubled, because a real signal's energy at one frequency is split between the positive and negative halves of the
 * two-sided transform — but DC and, for an even-length record, Nyquist have no partner to fold in, so they are not
 * doubled. And the density divides by the sum of the squared window weights rather than by the window's mean, because
 * power needs the squares.
 */
export function spectrum(
  values: readonly (number | null)[],
  rateHz: number,
  options: SpectrumOptions = {}
): Spectrum | SignalError {
  const clean = checkValues(values)
  if (isSignalError(clean)) return clean
  if (clean.length < 2) return fail('too-few', 'A spectrum needs at least two samples.')
  const windowName = options.window ?? 'hann'
  const win = windowOf(windowName, clean.length)
  if (isSignalError(win)) return win

  let working: number[] = [...clean]
  if (options.removeMean === true) {
    let total = 0
    for (const one of working) total += one
    const mean = total / working.length
    working = working.map((one) => one - mean)
  }
  const windowed = applyWindow(working, win)
  if (isSignalError(windowed)) return windowed

  let padded: number[] = [...windowed]
  let zeroPadded = 0
  if (options.padTo !== undefined) {
    if (!Number.isInteger(options.padTo) || options.padTo < clean.length) {
      return fail('invalid-argument', `padTo must be a whole number at least as large as the ${clean.length} samples given.`)
    }
    if (options.padTo > MAXIMUM_SAMPLES) return fail('too-large', `Padding to ${options.padTo} exceeds the ${MAXIMUM_SAMPLES} limit.`)
    zeroPadded = options.padTo - clean.length
    padded = [...padded, ...new Array<number>(zeroPadded).fill(0)]
  }

  const transformed = transform({ re: padded, im: new Array<number>(padded.length).fill(0) })
  if (isSignalError(transformed)) return transformed

  const n = padded.length
  const sampling = samplingOf(clean.length, rateHz)
  if (isSignalError(sampling)) return sampling

  // Σw² over the *unpadded* window: the zeros contribute no window energy.
  let sumSquares = 0
  for (const w of win.weights) sumSquares += w * w
  const lastBin = Math.floor(n / 2)
  const evenLength = n % 2 === 0
  const bins: Bin[] = []
  for (let k = 0; k <= lastBin; k += 1) {
    const re = transformed.re[k] ?? 0
    const im = transformed.im[k] ?? 0
    const magnitude = Math.hypot(re, im)
    const edge = k === 0 || (evenLength && k === lastBin)
    // Amplitude: undo the window's mean gain, undo the transform's length, fold in the negative half except at the edges.
    const amplitude = (magnitude / (clean.length * win.coherentGain)) * (edge ? 1 : 2)
    const densityPerHz = ((magnitude * magnitude) / (rateHz * sumSquares)) * (edge ? 1 : 2)
    bins.push({
      index: k,
      frequencyHz: (k * rateHz) / n,
      amplitude,
      rms: edge ? 0 : amplitude / Math.SQRT2,
      densityPerHz,
      phaseRadians: Math.atan2(im, re)
    })
  }

  const caveats: string[] = [
    `Frequencies are spaced ${((rateHz / n) * 1).toPrecision(4)} Hz apart and stop at ${(rateHz / 2).toPrecision(6)} Hz, which is half the sampling rate. Anything in the signal above that frequency was folded down onto a lower bin when the samples were taken, and no transform can undo that.`
  ]
  if (windowName === 'rectangular') {
    caveats.push('No window was applied. Unless the record happens to start and end at the same value, the join between its end and its start acts like a step change, and a step change puts energy into every bin.')
  } else {
    caveats.push(`A ${WINDOW_FACTS[windowName].label} window was applied and its amplitude effect divided back out. It widens each peak to about ${WINDOW_FACTS[windowName].mainLobeBins} bins, so two tones closer than ${(((rateHz / n) * WINDOW_FACTS[windowName].mainLobeBins) / 1).toPrecision(3)} Hz will read as one.`)
  }
  if (zeroPadded > 0) {
    caveats.push(`${zeroPadded} zeros were added before transforming. That draws the same spectrum at finer spacing — it interpolates between bins. It does not improve the ability to separate two nearby frequencies, which is set by the ${((clean.length - 1) / rateHz).toPrecision(4)} s of record actually measured.`)
  }
  if (options.removeMean === true) caveats.push('The mean was subtracted first, so the bin at 0 Hz no longer reports the signal offset.')
  else caveats.push('The mean was not removed, so bin 0 carries the signal offset and can leak into the bins beside it.')
  if (clean.length < 32) {
    caveats.push(`With only ${clean.length} samples the spectrum has ${lastBin + 1} bins. That is a coarse picture; treat a peak position as an indication rather than a measurement.`)
  }

  return {
    bins,
    sampling,
    window: windowName,
    windowFacts: WINDOW_FACTS[windowName],
    zeroPadded,
    caveats
  }
}

/** A peak found in a spectrum. */
export interface Peak {
  /** The bin the peak sits in. */
  index: number
  /** The bin's own centre frequency. */
  binFrequencyHz: number
  /**
   * The estimated true frequency, from fitting a parabola through this bin and its neighbours.
   *
   * A real tone almost never lands exactly on a bin centre. Reporting the bin centre as the frequency quantises every
   * answer to the bin spacing; interpolating recovers most of the difference. It is an estimate, which is why it is a
   * separate field from `binFrequencyHz` rather than replacing it.
   */
  frequencyHz: number
  /** Whether the frequency above was interpolated or is just the bin centre (true at the ends, where there is no triple). */
  interpolated: boolean
  amplitude: number
  /** How far above the median bin amplitude this peak stands. A weak peak in a noisy spectrum is not a finding. */
  aboveMedian: number
}

export interface PeakOptions {
  /** Ignore peaks below this multiple of the median bin amplitude. Defaults to 3. */
  minimumAboveMedian?: number
  /** At most this many peaks, strongest first. Defaults to 10. */
  limit?: number
  /** Ignore bin 0. Defaults to true — the DC offset is rarely the finding being looked for. */
  skipDc?: boolean
}

/** Finds the strongest local maxima in a spectrum, with each peak's frequency refined between bins. */
export function peaks(input: Spectrum, options: PeakOptions = {}): readonly Peak[] {
  const threshold = options.minimumAboveMedian ?? 3
  const limit = options.limit ?? 10
  const skipDc = options.skipDc ?? true
  const amplitudes = input.bins.map((one) => one.amplitude)
  const sorted = [...amplitudes].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 1
        ? (sorted[middle] ?? 0)
        : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
  const found: Peak[] = []
  const first = skipDc ? 1 : 0
  for (let k = first; k < input.bins.length; k += 1) {
    const here = amplitudes[k] ?? 0
    const before = k > 0 ? (amplitudes[k - 1] ?? -Infinity) : -Infinity
    const after = k < amplitudes.length - 1 ? (amplitudes[k + 1] ?? -Infinity) : -Infinity
    if (!(here > before && here >= after)) continue
    if (median > 0 && here < median * threshold) continue
    if (median === 0 && here === 0) continue
    const bin = input.bins[k]
    if (bin === undefined) continue
    let frequencyHz = bin.frequencyHz
    let interpolated = false
    if (Number.isFinite(before) && Number.isFinite(after)) {
      const denominator = before - 2 * here + after
      if (denominator !== 0) {
        const shift = (0.5 * (before - after)) / denominator
        if (Math.abs(shift) <= 0.5) {
          // Taken from the bins rather than recomputed: padding changes the spacing, and the bins already know it.
          const spacing = (input.bins[1]?.frequencyHz ?? 0) - (input.bins[0]?.frequencyHz ?? 0)
          frequencyHz = bin.frequencyHz + shift * spacing
          interpolated = true
        }
      }
    }
    found.push({
      index: k,
      binFrequencyHz: bin.frequencyHz,
      frequencyHz,
      interpolated,
      amplitude: here,
      aboveMedian: median > 0 ? here / median : Infinity
    })
  }
  found.sort((a, b) => b.amplitude - a.amplitude)
  return found.slice(0, Math.max(0, limit))
}

/** Total power in a frequency band, integrated from the density. */
export interface BandPower {
  lowHz: number
  highHz: number
  /** Integrated density across the band, in input-units squared. */
  power: number
  /** The square root of the above — an RMS figure for just this band. */
  rms: number
  /** How many bins fell inside the band. One or two bins is a thin basis for a band figure. */
  binsUsed: number
  why: string
}

export function bandPower(input: Spectrum, lowHz: number, highHz: number): BandPower | SignalError {
  if (!Number.isFinite(lowHz) || !Number.isFinite(highHz)) return fail('invalid-argument', 'The band edges must be finite frequencies.')
  if (highHz <= lowHz) return fail('invalid-argument', 'The upper band edge must be above the lower one.')
  if (lowHz < 0) return fail('invalid-argument', 'A frequency band cannot start below 0 Hz.')
  const nyquist = input.sampling.nyquistHz
  if (lowHz > nyquist) {
    return fail('outside-range', `The band starts at ${lowHz} Hz, above the ${nyquist} Hz Nyquist limit of this sampling. There is no information up there to measure.`)
  }
  const spacing = input.sampling.resolutionHz
  let power = 0
  let binsUsed = 0
  for (const bin of input.bins) {
    if (bin.frequencyHz < lowHz || bin.frequencyHz > highHz) continue
    power += bin.densityPerHz * spacing
    binsUsed += 1
  }
  const clipped = highHz > nyquist
  return {
    lowHz,
    highHz: clipped ? nyquist : highHz,
    power,
    rms: Math.sqrt(power),
    binsUsed,
    why: binsUsed === 0
      ? `No bin falls between ${lowHz} and ${highHz} Hz. The bins are ${spacing.toPrecision(4)} Hz apart, so a band narrower than that can fall between two of them.`
      : clipped
        ? `${binsUsed} bins, from ${lowHz} Hz up to the ${nyquist} Hz Nyquist limit — the band was asked to go higher than this sampling can report.`
        : `${binsUsed} bin${binsUsed === 1 ? '' : 's'} at ${spacing.toPrecision(4)} Hz spacing.`
  }
}

// ---------------------------------------------------------------- Welch's method

export interface WelchOptions {
  /** Samples per segment. Each segment is transformed separately and the results averaged. */
  segmentLength: number
  /** Fraction of a segment that overlaps the next. Defaults to 0.5, which is the usual choice for Hann. */
  overlap?: number
  window?: WindowName
  removeMean?: boolean
}

export interface WelchSpectrum {
  bins: readonly Bin[]
  sampling: Sampling
  window: WindowName
  /** How many segments were averaged. More segments means a steadier density and coarser frequency spacing. */
  segments: number
  segmentLength: number
  overlap: number
  caveats: readonly string[]
}

/**
 * An averaged power spectral density, by Welch's method.
 *
 * A single transform of a noisy record gives a density with as much scatter as the noise itself — each bin is one
 * sample of a random quantity. Splitting the record into overlapping segments and averaging their densities trades
 * frequency spacing for a steadier estimate. This is the right tool for noise; a single `spectrum` is the right tool
 * for a tone.
 */
export function welch(
  values: readonly (number | null)[],
  rateHz: number,
  options: WelchOptions
): WelchSpectrum | SignalError {
  const clean = checkValues(values)
  if (isSignalError(clean)) return clean
  const segmentLength = options.segmentLength
  if (!Number.isInteger(segmentLength) || segmentLength < 2) {
    return fail('invalid-argument', 'The segment length must be a whole number of at least 2.')
  }
  if (segmentLength > clean.length) {
    return fail('too-few', `A segment of ${segmentLength} samples does not fit in a record of ${clean.length}.`)
  }
  const overlap = options.overlap ?? 0.5
  if (!Number.isFinite(overlap) || overlap < 0 || overlap >= 1) {
    return fail('invalid-argument', 'The overlap must be a fraction from 0 up to but not including 1.')
  }
  const windowName = options.window ?? 'hann'
  const win = windowOf(windowName, segmentLength)
  if (isSignalError(win)) return win
  const step = Math.max(1, Math.round(segmentLength * (1 - overlap)))

  let sumSquares = 0
  for (const w of win.weights) sumSquares += w * w
  const lastBin = Math.floor(segmentLength / 2)
  const evenLength = segmentLength % 2 === 0
  const accumulated = new Array<number>(lastBin + 1).fill(0)
  const phaseOfFirst = new Array<number>(lastBin + 1).fill(0)
  let segments = 0

  for (let start = 0; start + segmentLength <= clean.length; start += step) {
    let segment = clean.slice(start, start + segmentLength)
    if (options.removeMean !== false) {
      let total = 0
      for (const one of segment) total += one
      const mean = total / segment.length
      segment = segment.map((one) => one - mean)
    }
    const windowed = segment.map((one, i) => one * (win.weights[i] ?? 0))
    const t = transform({ re: windowed, im: new Array<number>(segmentLength).fill(0) })
    if (isSignalError(t)) return t
    for (let k = 0; k <= lastBin; k += 1) {
      const re = t.re[k] ?? 0
      const im = t.im[k] ?? 0
      const magnitude = Math.hypot(re, im)
      const edge = k === 0 || (evenLength && k === lastBin)
      accumulated[k] = (accumulated[k] ?? 0) + ((magnitude * magnitude) / (rateHz * sumSquares)) * (edge ? 1 : 2)
      if (segments === 0) phaseOfFirst[k] = Math.atan2(im, re)
    }
    segments += 1
  }
  if (segments === 0) return fail('too-few', 'No complete segment fits in the record.')

  const sampling = samplingOf(segmentLength, rateHz)
  if (isSignalError(sampling)) return sampling
  const bins: Bin[] = []
  for (let k = 0; k <= lastBin; k += 1) {
    const densityPerHz = (accumulated[k] ?? 0) / segments
    const edge = k === 0 || (evenLength && k === lastBin)
    // Recover a tone amplitude from the averaged density, for the cases where a Page wants to plot amplitude.
    const magnitude = Math.sqrt(Math.max(0, (densityPerHz * rateHz * sumSquares) / (edge ? 1 : 2)))
    const amplitude = (magnitude / (segmentLength * win.coherentGain)) * (edge ? 1 : 2)
    bins.push({
      index: k,
      frequencyHz: (k * rateHz) / segmentLength,
      amplitude,
      rms: edge ? 0 : amplitude / Math.SQRT2,
      densityPerHz,
      phaseRadians: phaseOfFirst[k] ?? 0
    })
  }
  return {
    bins,
    sampling,
    window: windowName,
    segments,
    segmentLength,
    overlap,
    caveats: [
      `${segments} segment${segments === 1 ? '' : 's'} of ${segmentLength} samples were averaged. Averaging steadies the density; the scatter in each bin falls roughly as the square root of the segment count.`,
      `Frequency spacing is ${(rateHz / segmentLength).toPrecision(4)} Hz, set by the segment length rather than by the whole record. Longer segments resolve finer frequencies and give fewer of them to average.`,
      segments === 1
        ? 'With one segment this is a single transform, not an average. Each bin still carries the full scatter of the noise.'
        : `Segments overlap by ${(overlap * 100).toFixed(0)}%, so they are not independent — the effective number of independent averages is lower than ${segments}.`,
      'The phase shown is from the first segment only. Averaged densities have no meaningful phase, because phases from different segments do not line up.'
    ]
  }
}

// ---------------------------------------------------------------- time domain

/** A series returned alongside what was done to it. */
export interface Smoothed {
  values: readonly (number | null)[]
  /** How many samples at each end could not be computed, and are `null` rather than guessed. */
  edgeSamples: number
  why: string
}

/**
 * A moving average.
 *
 * Edges are `null`, not padded and not trimmed. Padding invents samples that were never measured; trimming silently
 * changes the length so the result no longer lines up with the original timestamps. A gap that says "not known here"
 * is the only honest answer at the ends of a window.
 */
export function movingAverage(
  values: readonly (number | null)[],
  window: number,
  options: { centred?: boolean } = {}
): Smoothed | SignalError {
  const clean = checkValues(values)
  if (isSignalError(clean)) return clean
  if (!Number.isInteger(window) || window < 2) return fail('invalid-argument', 'The window must be a whole number of at least 2.')
  if (window > clean.length) return fail('too-few', `A window of ${window} does not fit in ${clean.length} samples.`)
  const centred = options.centred ?? true
  if (centred && window % 2 === 0) {
    return fail('invalid-argument', `A centred window must be an odd number of samples so it has a middle; ${window} does not. Use ${window + 1}, or set centred to false for a trailing average.`)
  }
  const out = new Array<number | null>(clean.length).fill(null)
  let running = 0
  for (let i = 0; i < clean.length; i += 1) {
    running += clean[i] as number
    if (i >= window) running -= clean[i - window] as number
    if (i >= window - 1) {
      const at = centred ? i - (window - 1) / 2 : i
      out[at] = running / window
    }
  }
  return {
    values: out,
    edgeSamples: centred ? (window - 1) / 2 : window - 1,
    why: centred
      ? `Each value is the mean of the ${window} samples centred on it. The ${(window - 1) / 2} samples at each end have no full window and are left empty rather than computed from a partial one.`
      : `Each value is the mean of the ${window} samples up to and including it, so the series lags the original by about ${(window - 1) / 2} samples. The first ${window - 1} are left empty.`
  }
}

/** A moving median — resistant to single wild samples in a way a mean is not. */
export function movingMedian(values: readonly (number | null)[], window: number): Smoothed | SignalError {
  const clean = checkValues(values)
  if (isSignalError(clean)) return clean
  if (!Number.isInteger(window) || window < 3 || window % 2 === 0) {
    return fail('invalid-argument', 'The window must be an odd whole number of at least 3, so it has a middle.')
  }
  if (window > clean.length) return fail('too-few', `A window of ${window} does not fit in ${clean.length} samples.`)
  const half = (window - 1) / 2
  const out = new Array<number | null>(clean.length).fill(null)
  for (let i = half; i < clean.length - half; i += 1) {
    const slice = clean.slice(i - half, i + half + 1).sort((a, b) => a - b)
    out[i] = slice[half] ?? null
  }
  return {
    values: out,
    edgeSamples: half,
    why: `Each value is the median of the ${window} samples centred on it. A median ignores a single extreme sample where a mean would be dragged by it, which makes this the right smoother when the noise is spikes rather than scatter.`
  }
}

/** Exponential smoothing. Unlike a moving average this has no edge gap, but every value depends on the whole past. */
export function exponentialSmoothing(values: readonly (number | null)[], alpha: number): Smoothed | SignalError {
  const clean = checkValues(values)
  if (isSignalError(clean)) return clean
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) {
    return fail('invalid-argument', 'Alpha must be greater than 0 and at most 1.')
  }
  const out: number[] = []
  let previous = clean[0] as number
  out.push(previous)
  for (let i = 1; i < clean.length; i += 1) {
    previous = alpha * (clean[i] as number) + (1 - alpha) * previous
    out.push(previous)
  }
  return {
    values: out,
    edgeSamples: 0,
    why: `Each value is ${alpha} of the new sample plus ${(1 - alpha).toPrecision(3)} of the previous smoothed value, so the effective memory is about ${(1 / alpha).toFixed(1)} samples. Every value depends on every earlier one, and the first is the first sample itself with no smoothing applied.`
  }
}

/** What a detrend removed, kept so it can be put back. */
export interface Detrended {
  values: readonly number[]
  kind: 'mean' | 'linear'
  /** The trend that was subtracted, sample by sample. Add it back to recover the original exactly. */
  trend: readonly number[]
  /** For a linear detrend, the line that was removed. */
  slopePerSample: number
  intercept: number
  why: string
}

/**
 * Removes a constant or a straight line from a series.
 *
 * Worth doing before a spectrum. A drift across the record is a very low frequency component, and a very low frequency
 * component that does not complete a cycle inside the record leaks across the low bins and can hide whatever is
 * actually there.
 */
export function detrend(values: readonly (number | null)[], kind: 'mean' | 'linear' = 'linear'): Detrended | SignalError {
  const clean = checkValues(values)
  if (isSignalError(clean)) return clean
  if (kind === 'mean') {
    let total = 0
    for (const one of clean) total += one
    const mean = total / clean.length
    return {
      values: clean.map((one) => one - mean),
      kind,
      trend: new Array<number>(clean.length).fill(mean),
      slopePerSample: 0,
      intercept: mean,
      why: `The mean ${mean.toPrecision(6)} was subtracted from every sample. Any drift across the record is still there.`
    }
  }
  if (clean.length < 2) return fail('too-few', 'A straight line needs at least two samples.')
  const n = clean.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (let i = 0; i < n; i += 1) {
    const y = clean[i] as number
    sumX += i
    sumY += y
    sumXY += i * y
    sumXX += i * i
  }
  const denominator = n * sumXX - sumX * sumX
  if (denominator === 0) return fail('invalid-argument', 'The sample positions are degenerate; no line can be fitted.')
  const slope = (n * sumXY - sumX * sumY) / denominator
  const intercept = (sumY - slope * sumX) / n
  const trend = clean.map((_, i) => intercept + slope * i)
  return {
    values: clean.map((one, i) => one - (trend[i] ?? 0)),
    kind,
    trend,
    slopePerSample: slope,
    intercept,
    why: `A line of slope ${slope.toPrecision(4)} per sample was subtracted. Removing a drift stops it leaking across the low-frequency bins of a spectrum; it also removes any real slow change, so the detrended series answers questions about variation around the trend and not about the trend itself.`
  }
}

/** Differences between neighbouring samples, or samples a lag apart. */
export function differenceSeries(values: readonly (number | null)[], lag = 1): readonly number[] | SignalError {
  const clean = checkValues(values)
  if (isSignalError(clean)) return clean
  if (!Number.isInteger(lag) || lag < 1) return fail('invalid-argument', 'The lag must be a whole number of at least 1.')
  if (lag >= clean.length) return fail('too-few', `A lag of ${lag} leaves nothing to difference in ${clean.length} samples.`)
  const out: number[] = []
  for (let i = lag; i < clean.length; i += 1) out.push((clean[i] as number) - (clean[i - lag] as number))
  return out
}

/** One lag of a correlation, with the count of pairs that went into it. */
export interface Lag {
  lag: number
  /** Correlation coefficient at this lag, between −1 and 1. */
  correlation: number
  /**
   * How many pairs of samples were available at this lag.
   *
   * This falls as the lag grows. A correlation at lag `n − 3` rests on three pairs and means almost nothing; carrying
   * the count beside the coefficient is what stops that number being read as a finding.
   */
  pairs: number
}

export interface Correlation {
  lags: readonly Lag[]
  /**
   * The non-zero lag with the largest absolute correlation, or null when there is none worth naming.
   *
   * Absolute, so this can be a *negative* correlation. For a sine, the largest magnitude is at half a period, where the
   * series is the exact opposite of itself — which is a strong relationship and the opposite of a repeat. Read
   * `repeatAt` for a period; read this for the strongest relationship of either sign.
   */
  strongest: Lag | null
  /**
   * The first lag that is a genuine local peak with a positive correlation — the period candidate.
   *
   * Null when no interior lag peaks positively, which is the right answer for a series with no repeat in it. Only
   * interior lags qualify: the last lag examined has no lag after it to compare against, so it cannot be shown to be a
   * peak rather than the start of a rise.
   */
  repeatAt: Lag | null
  caveats: readonly string[]
}

/**
 * Autocorrelation: how much a series resembles itself, shifted.
 *
 * A peak at lag k says the series repeats itself every k samples. That is the honest reading, and it is a weaker
 * statement than "the period is k" — a peak can also come from a slow trend, from a harmonic of the real period, or
 * from nothing, when the record is short enough that chance produces one.
 */
export function autocorrelation(values: readonly (number | null)[], maximumLag?: number): Correlation | SignalError {
  const clean = checkValues(values)
  if (isSignalError(clean)) return clean
  if (clean.length < 3) return fail('too-few', 'At least three samples are needed to correlate a series with itself.')
  const limit = maximumLag ?? Math.floor(clean.length / 2)
  if (!Number.isInteger(limit) || limit < 1 || limit >= clean.length) {
    return fail('invalid-argument', `The maximum lag must be a whole number from 1 to ${clean.length - 1}.`)
  }
  let total = 0
  for (const one of clean) total += one
  const mean = total / clean.length
  const centred = clean.map((one) => one - mean)
  let variance = 0
  for (const one of centred) variance += one * one
  if (variance === 0) {
    return fail('invalid-argument', 'Every sample is the same value, so there is no variation to correlate. A flat series has no period.')
  }
  const lags: Lag[] = []
  for (let k = 0; k <= limit; k += 1) {
    let sum = 0
    for (let i = 0; i + k < centred.length; i += 1) sum += (centred[i] as number) * (centred[i + k] as number)
    lags.push({ lag: k, correlation: sum / variance, pairs: centred.length - k })
  }
  let strongest: Lag | null = null
  for (const one of lags) {
    if (one.lag === 0) continue
    if (strongest === null || Math.abs(one.correlation) > Math.abs(strongest.correlation)) strongest = one
  }
  let repeatAt: Lag | null = null
  for (let k = 1; k < lags.length - 1; k += 1) {
    const here = lags[k]
    const before = lags[k - 1]
    const after = lags[k + 1]
    if (here === undefined || before === undefined || after === undefined) continue
    if (here.correlation <= 0) continue
    if (here.correlation > before.correlation && here.correlation >= after.correlation) {
      repeatAt = here
      break
    }
  }
  const caveats: string[] = [
    'Lag 0 is 1 by definition — a series always matches itself unshifted. It carries no information.',
    'Each lag rests on fewer pairs than the one before it, so the coefficients at large lags are less steady than those at small ones. The pair count is on every lag for that reason.'
  ]
  if (strongest !== null && strongest.correlation < 0) {
    caveats.push(
      `The largest relationship, at lag ${strongest.lag}, is negative: shifted by that much the series is close to the opposite of itself. That is not a repeat. ${repeatAt === null ? 'No lag here peaks positively, so there is no period candidate to report.' : `The first positive peak, at lag ${repeatAt.lag}, is the period candidate.`}`
    )
  }
  if (repeatAt === null) {
    caveats.push('No interior lag is a positive peak, so no period is suggested. A series can be strongly structured and still have no period.')
  }
  if (strongest !== null && strongest.pairs < 10) {
    caveats.push(`The strongest lag, ${strongest.lag}, rests on only ${strongest.pairs} pairs. That is too few to distinguish a real repeat from chance.`)
  }
  caveats.push('A peak here says the series resembles a shifted copy of itself. It does not establish a period: a trend, or a harmonic of the real period, produces one too.')
  return { lags, strongest, repeatAt, caveats }
}

/** Cross-correlation: how much one series resembles another, shifted. Positive lag means `b` follows `a`. */
export function crossCorrelation(
  a: readonly (number | null)[],
  b: readonly (number | null)[],
  maximumLag?: number
): Correlation | SignalError {
  const cleanA = checkValues(a)
  if (isSignalError(cleanA)) return cleanA
  const cleanB = checkValues(b)
  if (isSignalError(cleanB)) return cleanB
  if (cleanA.length !== cleanB.length) {
    return fail('mismatched-length', `The series have ${cleanA.length} and ${cleanB.length} samples. Cross-correlation compares them sample for sample, so they must be the same length and on the same time base.`)
  }
  const n = cleanA.length
  if (n < 3) return fail('too-few', 'At least three samples are needed.')
  const limit = maximumLag ?? Math.floor(n / 2)
  if (!Number.isInteger(limit) || limit < 1 || limit >= n) {
    return fail('invalid-argument', `The maximum lag must be a whole number from 1 to ${n - 1}.`)
  }
  const meanOf = (xs: readonly number[]): number => {
    let total = 0
    for (const one of xs) total += one
    return total / xs.length
  }
  const ca = cleanA.map((one) => one - meanOf(cleanA))
  const cb = cleanB.map((one) => one - meanOf(cleanB))
  const energy = (xs: readonly number[]): number => {
    let sum = 0
    for (const one of xs) sum += one * one
    return sum
  }
  const scale = Math.sqrt(energy(ca) * energy(cb))
  if (scale === 0) return fail('invalid-argument', 'One of the series is flat, so there is no variation to correlate.')
  const lags: Lag[] = []
  for (let k = -limit; k <= limit; k += 1) {
    let sum = 0
    let pairs = 0
    for (let i = 0; i < n; i += 1) {
      const j = i + k
      if (j < 0 || j >= n) continue
      sum += (ca[i] as number) * (cb[j] as number)
      pairs += 1
    }
    lags.push({ lag: k, correlation: sum / scale, pairs })
  }
  let strongest: Lag | null = null
  for (const one of lags) {
    if (strongest === null || Math.abs(one.correlation) > Math.abs(strongest.correlation)) strongest = one
  }
  return {
    lags,
    // Two different series have no period between them, so there is nothing for this field to mean here.
    repeatAt: null,
    strongest,
    caveats: [
      'A positive lag means the second series resembles the first delayed by that many samples.',
      'A lead or lag between two series is a timing relationship, not a causal one. Two series driven by a third will show one.',
      'Each lag uses only the samples that overlap at that shift, so the pair count falls as the shift grows.'
    ]
  }
}

/** How a convolution handles the ends, where the two series only partly overlap. */
export type ConvolveMode = 'full' | 'same' | 'valid'

/**
 * Convolution of two series.
 *
 * `full` keeps every output, including the ends where the kernel hangs off the edge. `same` trims to the length of the
 * first input. `valid` keeps only the outputs where the kernel sat entirely inside the data — the only ones that used
 * no assumption about what lies beyond the ends.
 */
export function convolve(
  values: readonly (number | null)[],
  kernel: readonly (number | null)[],
  mode: ConvolveMode = 'full'
): readonly number[] | SignalError {
  const clean = checkValues(values)
  if (isSignalError(clean)) return clean
  const cleanKernel = checkValues(kernel)
  if (isSignalError(cleanKernel)) return cleanKernel
  if (cleanKernel.length > clean.length) {
    return fail('invalid-argument', `The kernel has ${cleanKernel.length} values and the series ${clean.length}. A kernel longer than the data has no position where it fits inside it.`)
  }
  const n = clean.length
  const m = cleanKernel.length
  const full = new Array<number>(n + m - 1).fill(0)
  for (let i = 0; i < n; i += 1) {
    const x = clean[i] as number
    for (let j = 0; j < m; j += 1) {
      full[i + j] = (full[i + j] as number) + x * (cleanKernel[j] as number)
    }
  }
  if (mode === 'full') return full
  if (mode === 'valid') return full.slice(m - 1, n)
  const start = Math.floor((m - 1) / 2)
  return full.slice(start, start + n)
}

// ---------------------------------------------------------------- filters

/** A finite impulse response filter: a kernel, plus what it does and what it costs. */
export interface Filter {
  kind: 'low-pass' | 'high-pass' | 'band-pass' | 'band-stop'
  coefficients: readonly number[]
  cutoffHz: readonly number[]
  rateHz: number
  /**
   * The delay this filter introduces, in samples. A symmetric FIR delays everything equally, which is why the delay
   * can be compensated exactly — unlike a recursive filter, where different frequencies are delayed differently.
   */
  delaySamples: number
  /** Roughly how wide the transition from passed to stopped is, in Hz. Shorter filters have wider transitions. */
  transitionHz: number
  why: string
}

/**
 * Designs a windowed-sinc FIR filter.
 *
 * Symmetric, so the phase response is linear and the delay is the same at every frequency. That property is why this
 * is the filter offered here: `applyFilter` can shift the result back by exactly half the kernel and recover the
 * original timing, which no recursive filter allows.
 */
export function designFilter(
  kind: Filter['kind'],
  cutoffHz: number | readonly [number, number],
  rateHz: number,
  taps: number,
  windowName: WindowName = 'hamming'
): Filter | SignalError {
  if (!Number.isFinite(rateHz) || rateHz <= 0) return fail('invalid-argument', 'The sampling rate must be positive.')
  if (!Number.isInteger(taps) || taps < 3 || taps % 2 === 0) {
    return fail('invalid-argument', 'The number of taps must be an odd whole number of at least 3, so the kernel has a centre and the delay is a whole number of samples.')
  }
  if (taps > 8192) return fail('too-large', 'A kernel of more than 8192 taps is refused.')
  const nyquist = rateHz / 2
  const edges = typeof cutoffHz === 'number' ? [cutoffHz] : [...cutoffHz]
  for (const edge of edges) {
    if (!Number.isFinite(edge) || edge <= 0) return fail('invalid-argument', 'Every cutoff must be a positive frequency.')
    if (edge >= nyquist) {
      return fail('outside-range', `A cutoff of ${edge} Hz is at or above the ${nyquist} Hz Nyquist limit for a ${rateHz} Hz sampling rate. There is no band up there to pass or stop.`)
    }
  }
  const twoEdges = kind === 'band-pass' || kind === 'band-stop'
  if (twoEdges && edges.length !== 2) return fail('invalid-argument', `A ${kind} filter needs two cutoff frequencies.`)
  if (!twoEdges && edges.length !== 1) return fail('invalid-argument', `A ${kind} filter needs one cutoff frequency.`)
  if (twoEdges && (edges[1] as number) <= (edges[0] as number)) {
    return fail('invalid-argument', 'The upper cutoff must be above the lower one.')
  }
  const win = windowOf(windowName, taps)
  if (isSignalError(win)) return win
  // The periodic window is right for a transform; a filter kernel wants the symmetric one, so rebuild symmetrically.
  const symmetric = new Array<number>(taps)
  for (let i = 0; i < taps; i += 1) {
    const t = i / (taps - 1)
    const angle = 2 * Math.PI * t
    switch (windowName) {
      case 'rectangular': symmetric[i] = 1; break
      case 'hann': symmetric[i] = 0.5 - 0.5 * Math.cos(angle); break
      case 'hamming': symmetric[i] = 0.54 - 0.46 * Math.cos(angle); break
      case 'blackman': symmetric[i] = 0.42 - 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle); break
      case 'blackman-harris':
        symmetric[i] = 0.35875 - 0.48829 * Math.cos(angle) + 0.14128 * Math.cos(2 * angle) - 0.01168 * Math.cos(3 * angle)
        break
      case 'bartlett': symmetric[i] = 1 - Math.abs(2 * t - 1); break
      case 'welch': { const u = 2 * t - 1; symmetric[i] = 1 - u * u; break }
      case 'flat-top':
        symmetric[i] =
          0.21557895 - 0.41663158 * Math.cos(angle) + 0.277263158 * Math.cos(2 * angle) -
          0.083578947 * Math.cos(3 * angle) + 0.006947368 * Math.cos(4 * angle)
        break
    }
  }
  const middle = (taps - 1) / 2
  const sinc = (x: number): number => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x))
  const lowPassAt = (edge: number, i: number): number => {
    const f = edge / nyquist // normalised to 1 at Nyquist
    return f * sinc(f * (i - middle))
  }
  const raw = new Array<number>(taps).fill(0)
  for (let i = 0; i < taps; i += 1) {
    switch (kind) {
      case 'low-pass':
        raw[i] = lowPassAt(edges[0] as number, i)
        break
      case 'high-pass':
        raw[i] = (i === middle ? 1 : 0) - lowPassAt(edges[0] as number, i)
        break
      case 'band-pass':
        raw[i] = lowPassAt(edges[1] as number, i) - lowPassAt(edges[0] as number, i)
        break
      case 'band-stop':
        raw[i] = (i === middle ? 1 : 0) - (lowPassAt(edges[1] as number, i) - lowPassAt(edges[0] as number, i))
        break
    }
  }
  let coefficients = raw.map((one, i) => one * (symmetric[i] ?? 0))
  // Normalise the gain in the pass band to 1, so the filter changes the frequency content and not the level.
  if (kind === 'low-pass' || kind === 'band-stop') {
    let sum = 0
    for (const one of coefficients) sum += one
    if (sum !== 0) coefficients = coefficients.map((one) => one / sum)
  } else {
    // For high-pass and band-pass the DC sum is near zero; normalise at the centre of the pass band instead.
    const centre = kind === 'high-pass'
      ? (nyquist + (edges[0] as number)) / 2
      : ((edges[0] as number) + (edges[1] as number)) / 2
    let re = 0
    let im = 0
    for (let i = 0; i < taps; i += 1) {
      const angle = (-2 * Math.PI * centre * i) / rateHz
      re += (coefficients[i] as number) * Math.cos(angle)
      im += (coefficients[i] as number) * Math.sin(angle)
    }
    const gain = Math.hypot(re, im)
    if (gain !== 0) coefficients = coefficients.map((one) => one / gain)
  }
  const transitionHz = (WINDOW_FACTS[windowName].mainLobeBins * rateHz) / taps
  return {
    kind,
    coefficients,
    cutoffHz: edges,
    rateHz,
    delaySamples: middle,
    transitionHz,
    why: `A ${taps}-tap ${kind} filter with a ${WINDOW_FACTS[windowName].label} window. The change from passed to stopped takes about ${transitionHz.toPrecision(3)} Hz — a sharper edge needs more taps, and more taps means a longer delay and more samples lost at each end. The kernel is symmetric, so every frequency is delayed by the same ${middle} samples and the delay can be removed exactly.`
  }
}

export interface Filtered {
  values: readonly (number | null)[]
  /** How many samples at each end are `null` because the kernel did not fit entirely inside the data. */
  edgeSamples: number
  filter: Filter
  why: string
}

/**
 * Runs a filter over a series.
 *
 * The ends are `null`. A filter output near an edge depends on samples beyond the edge, and there are none — the usual
 * fixes (pad with zeros, repeat the end value, mirror the signal) all invent data, and each invents a different
 * artefact. Saying "not known here" is the one answer that adds nothing.
 */
export function applyFilter(values: readonly (number | null)[], filter: Filter): Filtered | SignalError {
  const clean = checkValues(values)
  if (isSignalError(clean)) return clean
  const taps = filter.coefficients.length
  if (taps > clean.length) {
    return fail('too-few', `The filter has ${taps} taps and the series ${clean.length} samples. There is no position where the kernel fits inside the data.`)
  }
  const half = filter.delaySamples
  const out = new Array<number | null>(clean.length).fill(null)
  for (let i = half; i < clean.length - half; i += 1) {
    let sum = 0
    for (let j = 0; j < taps; j += 1) {
      sum += (filter.coefficients[j] as number) * (clean[i + half - j] as number)
    }
    out[i] = sum
  }
  return {
    values: out,
    edgeSamples: half,
    filter,
    why: `The output is aligned with the input — the filter's ${half}-sample delay has been removed, which a symmetric kernel allows exactly. The ${half} samples at each end are left empty because computing them would need samples from beyond the record.`
  }
}

// ---------------------------------------------------------------- resampling

export interface Resampled {
  times: readonly number[]
  values: readonly number[]
  /** Points that were asked for outside the measured span, and therefore not produced. */
  refusedOutside: readonly number[]
  why: string
}

/**
 * Resamples a series onto new timestamps by linear interpolation.
 *
 * Points outside the measured span are refused rather than extrapolated. An interpolated value sits between two real
 * measurements and is bounded by them; an extrapolated one is bounded by nothing, and presenting it in the same array
 * as the measurements would make a guess indistinguishable from an observation.
 */
export function resample(
  times: readonly number[],
  values: readonly (number | null)[],
  newTimes: readonly number[]
): Resampled | SignalError {
  const clean = checkValues(values)
  if (isSignalError(clean)) return clean
  if (times.length !== clean.length) {
    return fail('mismatched-length', `There are ${times.length} timestamps and ${clean.length} values.`)
  }
  if (times.length < 2) return fail('too-few', 'At least two samples are needed to interpolate between.')
  for (let i = 1; i < times.length; i += 1) {
    const before = times[i - 1]
    const now = times[i]
    if (before === undefined || now === undefined || !Number.isFinite(before) || !Number.isFinite(now)) {
      return fail('not-finite', `The timestamp at index ${i} is not a finite number.`)
    }
    if (now <= before) return fail('invalid-argument', `Timestamps must increase; index ${i} is not after index ${i - 1}.`)
  }
  const first = times[0] as number
  const last = times[times.length - 1] as number
  const outTimes: number[] = []
  const outValues: number[] = []
  const refused: number[] = []
  for (const t of newTimes) {
    if (!Number.isFinite(t)) return fail('not-finite', 'Every requested timestamp must be a finite number.')
    if (t < first || t > last) {
      refused.push(t)
      continue
    }
    // Binary search for the interval containing t.
    let low = 0
    let high = times.length - 1
    while (high - low > 1) {
      const middle = (low + high) >> 1
      if ((times[middle] as number) <= t) low = middle
      else high = middle
    }
    const t0 = times[low] as number
    const t1 = times[high] as number
    const v0 = clean[low] as number
    const v1 = clean[high] as number
    const fraction = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
    outTimes.push(t)
    outValues.push(v0 + fraction * (v1 - v0))
  }
  return {
    times: outTimes,
    values: outValues,
    refusedOutside: refused,
    why: refused.length === 0
      ? `${outTimes.length} points interpolated linearly between the measurements. A straight line between two samples is an assumption about what happened between them; it is bounded by the two measurements, which is why it is offered, but it is still an assumption.`
      : `${outTimes.length} points interpolated. ${refused.length} fell outside the measured span of ${first} to ${last} and were not produced — extending a series past its measurements is a guess with nothing bounding it, and this engine will not put one in the same array as the measurements.`
  }
}

export interface Decimated {
  values: readonly number[]
  factor: number
  newRateHz: number
  /** True when the caller confirmed a low-pass filter was applied first. */
  filteredFirst: boolean
  /** The frequency above which content will fold down onto lower frequencies. */
  newNyquistHz: number
  warnings: readonly string[]
}

/**
 * Keeps every nth sample.
 *
 * Halving the rate halves the highest frequency that can be represented, and anything above the new limit does not
 * disappear — it reappears at a lower frequency, indistinguishable from real content there. That is why `filteredFirst`
 * is a required argument rather than an option: the caller has to say whether the filtering was done, and if it was
 * not, the warning goes out with the result.
 */
export function decimate(
  values: readonly (number | null)[],
  factor: number,
  rateHz: number,
  filteredFirst: boolean
): Decimated | SignalError {
  const clean = checkValues(values)
  if (isSignalError(clean)) return clean
  if (!Number.isInteger(factor) || factor < 2) return fail('invalid-argument', 'The factor must be a whole number of at least 2.')
  if (factor >= clean.length) return fail('too-few', `Keeping every ${factor}th sample of ${clean.length} leaves too little.`)
  if (!Number.isFinite(rateHz) || rateHz <= 0) return fail('invalid-argument', 'The sampling rate must be positive.')
  const out: number[] = []
  for (let i = 0; i < clean.length; i += factor) out.push(clean[i] as number)
  const newRate = rateHz / factor
  const warnings: string[] = []
  if (!filteredFirst) {
    warnings.push(
      `No low-pass filter was applied before dropping samples. Anything in the signal above ${(newRate / 2).toPrecision(4)} Hz is now folded down onto a lower frequency, where it is indistinguishable from real content. Filter to below ${(newRate / 2).toPrecision(4)} Hz first, then decimate.`
    )
  }
  warnings.push(`The rate went from ${rateHz} Hz to ${newRate} Hz, so the highest representable frequency went from ${(rateHz / 2).toPrecision(4)} Hz to ${(newRate / 2).toPrecision(4)} Hz. That is information discarded, not compressed.`)
  return {
    values: out,
    factor,
    newRateHz: newRate,
    filteredFirst,
    newNyquistHz: newRate / 2,
    warnings
  }
}

// ---------------------------------------------------------------- summary facts

export interface SignalFacts {
  count: number
  minimum: number
  maximum: number
  peakToPeak: number
  mean: number
  /** Root mean square of the samples as given, offset included. */
  rms: number
  /** Root mean square after the mean is removed — the size of the variation rather than of the signal. */
  rmsAboutMean: number
  /** Peak divided by RMS about the mean. About 1.41 for a sine, higher for something spiky. */
  crestFactor: number | null
  /** Times the series crosses its own mean. Twice the number of cycles, for something periodic. */
  meanCrossings: number
  why: string
}

export function signalFacts(values: readonly (number | null)[]): SignalFacts | SignalError {
  const clean = checkValues(values)
  if (isSignalError(clean)) return clean
  let minimum = Infinity
  let maximum = -Infinity
  let total = 0
  let squares = 0
  for (const one of clean) {
    if (one < minimum) minimum = one
    if (one > maximum) maximum = one
    total += one
    squares += one * one
  }
  const n = clean.length
  const mean = total / n
  let centredSquares = 0
  for (const one of clean) centredSquares += (one - mean) * (one - mean)
  const rmsAboutMean = Math.sqrt(centredSquares / n)
  let crossings = 0
  for (let i = 1; i < n; i += 1) {
    const before = (clean[i - 1] as number) - mean
    const now = (clean[i] as number) - mean
    if ((before < 0 && now > 0) || (before > 0 && now < 0)) crossings += 1
  }
  const peak = Math.max(Math.abs(maximum - mean), Math.abs(minimum - mean))
  return {
    count: n,
    minimum,
    maximum,
    peakToPeak: maximum - minimum,
    mean,
    rms: Math.sqrt(squares / n),
    rmsAboutMean,
    crestFactor: rmsAboutMean === 0 ? null : peak / rmsAboutMean,
    meanCrossings: crossings,
    why: rmsAboutMean === 0
      ? `All ${n} samples are ${mean}. There is no variation, so there is no crest factor to report.`
      : `${n} samples. The RMS about the mean, ${rmsAboutMean.toPrecision(4)}, describes the variation; the plain RMS, ${Math.sqrt(squares / n).toPrecision(4)}, includes the ${mean.toPrecision(4)} offset. A crest factor near 1.41 suggests something close to a single sine; much higher suggests spikes.`
  }
}
