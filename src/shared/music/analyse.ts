/**
 * Measuring what a track actually sounds like, from its samples.
 *
 * Everything here works on decoded audio -- real numbers off the waveform, not a guess from the genre tag. The
 * decoding happens in the one place Orbis has a decoder (the hidden player window, which is a browser), and the
 * measuring happens here, as plain functions, so it can be tested against signals whose answers are known: a 440 Hz
 * sine wave has a known brightness, a click every half second has a known tempo, silence has no energy.
 *
 * ## What is measured, and why these
 *
 * Energy, brightness, dynamics, sparseness, roughness and a beat. Not because they are the fashionable features, but
 * because each one changes what a track is *for*: energy and tempo decide whether it belongs in a workout or at
 * bedtime, sparseness and dynamics decide whether it will sit politely behind work, brightness and roughness are
 * what people mean by "darker" and "softer".
 *
 * ## What is not measured
 *
 * Key, chords, lyrics, mood. Those need either a much larger model or the words, and a number invented for them
 * would be worse than their absence -- so `tempo` can come back null and a mood is never claimed at all. The taste
 * model treats an unmeasured dimension as unknown rather than as middling.
 */

export interface Measured {
  energy: number
  tempo: number | null
  danceability: number
  brightness: number
  dynamics: number
  sparseness: number
  vocalness: number
  roughness: number
}

/** How many samples a second the measuring expects. Audio is resampled to this before it arrives. */
export const ANALYSE_RATE = 22050

/** The window the measurements are taken over: about 23 ms at the analysis rate. */
const WINDOW = 512

/** Root mean square: the honest measure of how loud a stretch of audio is. */
export function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0
  const end = Math.min(to, samples.length)
  for (let i = from; i < end; i += 1) sum += samples[i] * samples[i]
  const count = Math.max(1, end - from)
  return Math.sqrt(sum / count)
}

/** Loudness over time, one value per window. The basis of nearly everything else. */
export function loudnessCurve(samples: Float32Array, window = WINDOW): Float32Array {
  const count = Math.max(1, Math.floor(samples.length / window))
  const out = new Float32Array(count)
  for (let i = 0; i < count; i += 1) out[i] = rms(samples, i * window, (i + 1) * window)
  return out
}

/**
 * How often the waveform crosses zero, per second.
 *
 * A cheap, reliable stand-in for brightness: a bass line crosses zero rarely, a hi-hat constantly. It needs no
 * Fourier transform, which matters when this runs over a whole library.
 */
export function zeroCrossingRate(samples: Float32Array, rate = ANALYSE_RATE): number {
  if (samples.length < 2) return 0
  let crossings = 0
  for (let i = 1; i < samples.length; i += 1) {
    if ((samples[i - 1] >= 0 && samples[i] < 0) || (samples[i - 1] < 0 && samples[i] >= 0)) crossings += 1
  }
  return (crossings / samples.length) * rate
}

/**
 * Where the energy sits in the spectrum, as a fraction of the Nyquist frequency.
 *
 * A real discrete Fourier transform over a few windows -- enough to place a track's centre of mass without
 * transforming the whole file. Bass-heavy music lands low, bright production lands high, and that is what somebody
 * means when they ask for something darker.
 */
export function spectralCentroid(samples: Float32Array, rate = ANALYSE_RATE, windows = 24): number {
  if (samples.length < WINDOW * 2) return 0
  const step = Math.max(WINDOW, Math.floor(samples.length / windows))
  let weighted = 0
  let total = 0
  for (let start = 0; start + WINDOW <= samples.length; start += step) {
    // A Hann window, so the edges of each slice do not smear across the spectrum.
    const slice = new Float32Array(WINDOW)
    for (let i = 0; i < WINDOW; i += 1) slice[i] = samples[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1)))
    for (let bin = 1; bin < WINDOW / 2; bin += 1) {
      let real = 0
      let imaginary = 0
      const angle = (-2 * Math.PI * bin) / WINDOW
      for (let i = 0; i < WINDOW; i += 1) {
        real += slice[i] * Math.cos(angle * i)
        imaginary += slice[i] * Math.sin(angle * i)
      }
      const magnitude = Math.sqrt(real * real + imaginary * imaginary)
      weighted += magnitude * ((bin * rate) / WINDOW)
      total += magnitude
    }
  }
  if (total === 0) return 0
  const centroid = weighted / total
  return Math.max(0, Math.min(1, centroid / (rate / 2)))
}

/** Where the loudness rises sharply: the moments a person hears as beats. */
export function onsets(curve: Float32Array): Float32Array {
  const out = new Float32Array(curve.length)
  for (let i = 1; i < curve.length; i += 1) {
    const rise = curve[i] - curve[i - 1]
    out[i] = rise > 0 ? rise : 0
  }
  return out
}

export interface Beat {
  bpm: number | null
  /** 0..1: how strong and regular the pulse is. Low means there is no real beat to find. */
  strength: number
}

/**
 * The tempo, by looking for a repeating pulse in the onsets.
 *
 * Autocorrelation over the onset curve: the lag that best explains the rises is the beat period. A null answer is a
 * real answer -- a solo piano piece has no steady pulse, and inventing 120 BPM for it would put it in a running
 * playlist.
 *
 * The range is deliberately bounded to tempos music is actually played at, and a half or double answer is folded
 * into the usual range, because autocorrelation is as happy with one as the other.
 */
export function beatOf(curve: Float32Array, rate = ANALYSE_RATE, window = WINDOW): Beat {
  const rises = onsets(curve)
  if (rises.length < 16) return { bpm: null, strength: 0 }
  const perSecond = rate / window
  const minLag = Math.max(2, Math.floor((perSecond * 60) / 200))
  const maxLag = Math.min(rises.length - 2, Math.ceil((perSecond * 60) / 50))
  if (maxLag <= minLag) return { bpm: null, strength: 0 }

  /*
   * Nothing to find in something that does not move.
   *
   * A held tone produces a loudness curve with a tiny ripple in it -- an artefact of where the windows fall
   * against the waveform -- and autocorrelation is perfectly happy to call that ripple a beat. It reported a
   * confident tempo for a single sustained note. So the rises have to amount to something next to how loud the
   * track is before any of this is worth doing.
   */
  let loudest = 0
  for (const one of curve) loudest = Math.max(loudest, one)
  let riseTotal = 0
  for (const one of rises) riseTotal += one
  const movement = loudest === 0 ? 0 : riseTotal / rises.length / loudest
  if (movement < 0.02) return { bpm: null, strength: 0 }

  let mean = 0
  for (const one of rises) mean += one
  mean /= rises.length
  const centred = Array.from(rises, (one) => one - mean)
  let energy = 0
  for (const one of centred) energy += one * one
  if (energy === 0) return { bpm: null, strength: 0 }

  let bestLag = 0
  let bestScore = 0
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0
    for (let i = lag; i < centred.length; i += 1) sum += centred[i] * centred[i - lag]
    const score = sum / energy
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  if (bestLag === 0 || bestScore < 0.08) return { bpm: null, strength: Math.max(0, bestScore) }

  let bpm = (perSecond * 60) / bestLag
  // Folded into the range music is counted in, since a pulse at 60 and at 120 are the same pulse.
  while (bpm < 60) bpm *= 2
  while (bpm > 200) bpm /= 2
  return { bpm: Math.round(bpm * 10) / 10, strength: Math.max(0, Math.min(1, bestScore * 2.5)) }
}

/** How much of the track is near silence. A piece with space in it is not a wall of sound. */
export function sparsenessOf(curve: Float32Array): number {
  if (curve.length === 0) return 0
  let peak = 0
  for (const one of curve) peak = Math.max(peak, one)
  if (peak === 0) return 1
  const quiet = Array.from(curve).filter((one) => one < peak * 0.1).length
  return quiet / curve.length
}

/** How much the loudness moves about: the difference between the quiet parts and the loud ones. */
export function dynamicsOf(curve: Float32Array): number {
  if (curve.length < 4) return 0
  const sorted = Array.from(curve).sort((a, b) => a - b)
  const low = sorted[Math.floor(sorted.length * 0.1)]
  const high = sorted[Math.floor(sorted.length * 0.9)]
  if (high === 0) return 0
  return Math.max(0, Math.min(1, (high - low) / high))
}

/**
 * How squashed the sound is, from its crest factor: the peak divided by the average level.
 *
 * This is the standard measure and the honest one. A limited, heavily compressed master sits near one -- every
 * moment is as loud as every other -- and an open recording with real peaks sits at three or more. Counting
 * samples near the peak instead, which is what this did first, called a pure sine wave maximally squashed,
 * because a fifth of a sine's samples really are near its peak. That is a property of sine waves, not of
 * production.
 */
export function roughnessOf(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let peak = 0
  for (const one of samples) peak = Math.max(peak, Math.abs(one))
  if (peak === 0) return 0
  const average = rms(samples)
  if (average === 0) return 0
  const crest = peak / average
  // One is as squashed as audio gets; three and above is open and dynamic.
  return Math.max(0, Math.min(1, (2.1 - crest) / 1.1))
}

/**
 * Whether there is probably a voice.
 *
 * Voices live in the middle of the spectrum and move about constantly, so a track whose brightness keeps shifting
 * around the middle is more likely to have singing on it than one that sits still. It is a likelihood, not a
 * transcription, and it is named `vocalness` rather than "has vocals" for that reason.
 */
export function vocalnessOf(samples: Float32Array, rate = ANALYSE_RATE): number {
  const chunk = Math.floor(rate * 0.5)
  if (samples.length < chunk * 4) return 0.5
  const rates: number[] = []
  for (let start = 0; start + chunk <= samples.length; start += chunk * 2) {
    rates.push(zeroCrossingRate(samples.subarray(start, start + chunk), rate))
  }
  if (rates.length < 3) return 0.5
  const mean = rates.reduce((sum, one) => sum + one, 0) / rates.length
  const variance = rates.reduce((sum, one) => sum + (one - mean) ** 2, 0) / rates.length
  const moving = Math.sqrt(variance) / Math.max(1, mean)
  // In the middle of the range and moving about: likely a voice. Steady and extreme: likely not.
  const middle = Math.max(0, 1 - Math.abs(mean - 2200) / 2200)
  return Math.max(0, Math.min(1, middle * 0.6 + Math.min(1, moving * 2) * 0.4))
}

/**
 * Everything, from one stretch of decoded audio.
 *
 * The caller hands over mono samples at `ANALYSE_RATE`. A short excerpt from the middle is enough and is what the
 * player sends: the first ten seconds of a track are often an intro and tell you the least about it.
 */
export function measure(samples: Float32Array, rate = ANALYSE_RATE): Measured {
  const curve = loudnessCurve(samples)
  const loudness = rms(samples)
  const beat = beatOf(curve, rate)
  const brightness = spectralCentroid(samples, rate)
  const sparseness = sparsenessOf(curve)
  const dynamics = dynamicsOf(curve)
  const roughness = roughnessOf(samples)

  /*
   * Energy is what somebody means by "energetic": loud, busy and bright, not merely loud.
   *
   * Loudness alone calls a loud sad ballad energetic. The mix below was checked against the obvious cases -- silence
   * at the bottom, a dense bright loud track at the top, a quiet sparse one near the bottom whatever its peak level.
   */
  const busy = 1 - sparseness
  const energy = Math.max(0, Math.min(1, Math.min(1, loudness * 3.2) * 0.55 + busy * 0.25 + brightness * 0.2))

  // A beat you could move to: a strong, regular pulse at a danceable tempo, in music with some punch to it.
  const tempoFit = beat.bpm === null ? 0 : Math.max(0, 1 - Math.abs(beat.bpm - 120) / 90)
  const danceability = Math.max(0, Math.min(1, beat.strength * 0.6 + tempoFit * 0.25 + busy * 0.15))

  return {
    energy,
    tempo: beat.bpm,
    danceability,
    brightness,
    dynamics,
    sparseness,
    vocalness: vocalnessOf(samples, rate),
    roughness
  }
}
