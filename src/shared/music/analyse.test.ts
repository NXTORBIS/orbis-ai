import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { ANALYSE_RATE, beatOf, dynamicsOf, loudnessCurve, measure, rms, roughnessOf, sparsenessOf, spectralCentroid, vocalnessOf, zeroCrossingRate } from './analyse.ts'

/**
 * These are built out of signals whose answers are known in advance.
 *
 * A measuring function that is tested against "some audio" and an eyeballed number is worthless: it will pass while
 * reading the wrong thing. So the inputs here are a sine wave at a stated frequency, a click at a stated interval,
 * silence, and noise -- and each case asserts the thing physics says the answer must be.
 */

const RATE = ANALYSE_RATE

/** A sine wave, which has a known frequency, a known loudness and a known crossing rate. */
const sine = (hz: number, seconds: number, amplitude = 0.5): Float32Array => {
  const out = new Float32Array(Math.round(RATE * seconds))
  for (let i = 0; i < out.length; i += 1) out[i] = Math.sin((2 * Math.PI * hz * i) / RATE) * amplitude
  return out
}

/** Clicks at a stated interval: a known tempo, and nothing else. */
const clicks = (bpm: number, seconds: number): Float32Array => {
  const out = new Float32Array(Math.round(RATE * seconds))
  const period = Math.round((60 / bpm) * RATE)
  for (let at = 0; at < out.length; at += period) {
    for (let i = 0; i < 400 && at + i < out.length; i += 1) out[at + i] = Math.sin((2 * Math.PI * 180 * i) / RATE) * (1 - i / 400)
  }
  return out
}

const silence = (seconds: number): Float32Array => new Float32Array(Math.round(RATE * seconds))

const noise = (seconds: number, amplitude = 0.5): Float32Array => {
  const out = new Float32Array(Math.round(RATE * seconds))
  // A fixed sequence rather than a random one, so a failure is reproducible.
  let seed = 12345
  for (let i = 0; i < out.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    out[i] = (seed / 0x3fffffff - 1) * amplitude
  }
  return out
}

// ---------------------------------------------------------------- loudness

test('loudness is the root mean square, which for a sine wave is a known number', () => {
  // A sine of amplitude a has an RMS of a divided by the square root of two.
  const measured = rms(sine(440, 1, 0.5))
  assert.ok(Math.abs(measured - 0.5 / Math.SQRT2) < 0.01, `${measured} should be about ${(0.5 / Math.SQRT2).toFixed(3)}`)
  assert.equal(rms(silence(1)), 0)
})

test('the loudness curve has one value per window and follows the signal', () => {
  const half = new Float32Array(RATE)
  for (let i = RATE / 2; i < RATE; i += 1) half[i] = 0.5
  const curve = loudnessCurve(half)
  assert.ok(curve.length > 20)
  assert.ok(curve[0] < 0.01, 'quiet at the start')
  assert.ok(curve[curve.length - 1] > 0.3, 'and loud at the end')
})

// ---------------------------------------------------------------- brightness

test('how often the wave crosses zero is twice the frequency of a sine', () => {
  const measured = zeroCrossingRate(sine(440, 1))
  assert.ok(Math.abs(measured - 880) < 20, `${measured} should be about 880 for a 440 Hz tone`)
})

test('a high tone is measured as brighter than a low one', () => {
  const low = spectralCentroid(sine(120, 1))
  const high = spectralCentroid(sine(4000, 1))
  assert.ok(high > low + 0.2, `${high} should be well above ${low}`)
  assert.ok(low < 0.2, 'a bass tone sits low in the spectrum')
})

test('noise is brighter than a pure tone, because its energy is everywhere', () => {
  assert.ok(spectralCentroid(noise(1)) > spectralCentroid(sine(220, 1)))
})

// ---------------------------------------------------------------- the beat

test('a click track is measured at the tempo it was built at', () => {
  for (const bpm of [90, 120, 150]) {
    const beat = beatOf(loudnessCurve(clicks(bpm, 12)))
    assert.ok(beat.bpm !== null, `nothing found at ${bpm}`)
    // Half or double is the same pulse, so either counts as right.
    const close = Math.abs(beat.bpm! - bpm) < 6 || Math.abs(beat.bpm! - bpm * 2) < 8 || Math.abs(beat.bpm! - bpm / 2) < 4
    assert.ok(close, `found ${beat.bpm} for a ${bpm} click track`)
    assert.ok(beat.strength > 0.2, `and it should be sure about it (${beat.strength})`)
  }
})

test('something with no pulse comes back with no tempo, rather than a plausible one', () => {
  const steady = beatOf(loudnessCurve(sine(220, 10)))
  assert.equal(steady.bpm, null, 'a held tone has no beat')
  assert.equal(beatOf(loudnessCurve(silence(10))).bpm, null)
})

test('a tempo is folded into the range music is counted in', () => {
  const fast = beatOf(loudnessCurve(clicks(300, 12)))
  if (fast.bpm !== null) assert.ok(fast.bpm >= 60 && fast.bpm <= 200, `${fast.bpm} is outside the range anybody counts in`)
})

// ---------------------------------------------------------------- space, movement and squash

test('a piece with silence in it is measured as sparse, and a solid one is not', () => {
  const sparse = new Float32Array(RATE * 4)
  for (let i = 0; i < RATE; i += 1) sparse[i] = Math.sin((2 * Math.PI * 440 * i) / RATE) * 0.6
  assert.ok(sparsenessOf(loudnessCurve(sparse)) > 0.6, 'three quarters of it is silence')
  assert.ok(sparsenessOf(loudnessCurve(sine(440, 4))) < 0.1, 'and a continuous tone is not sparse at all')
})

test('a quiet-then-loud piece has dynamics; a flat one does not', () => {
  const swell = new Float32Array(RATE * 4)
  for (let i = 0; i < swell.length; i += 1) swell[i] = Math.sin((2 * Math.PI * 440 * i) / RATE) * (0.02 + (i / swell.length) * 0.9)
  assert.ok(dynamicsOf(loudnessCurve(swell)) > 0.6)
  assert.ok(dynamicsOf(loudnessCurve(sine(440, 4, 0.5))) < 0.2, 'a steady tone barely moves')
})

test('how squashed the sound is, in the order physics says it must be', () => {
  // Every sample at the ceiling: as squashed as audio can be.
  const squashed = new Float32Array(RATE)
  for (let i = 0; i < squashed.length; i += 1) squashed[i] = i % 2 === 0 ? 0.99 : -0.99
  // A sine sits between the two: a known crest factor of about 1.41.
  const tone = roughnessOf(sine(440, 1, 0.3))
  // Noise with occasional big peaks is open and dynamic.
  const open = new Float32Array(RATE)
  for (let i = 0; i < open.length; i += 1) open[i] = (i % 2000 === 0 ? 0.95 : 0.02) * (i % 3 === 0 ? -1 : 1)
  assert.ok(roughnessOf(squashed) > tone, `squashed ${roughnessOf(squashed)} should beat a tone ${tone}`)
  assert.ok(tone > roughnessOf(open), `a tone ${tone} should beat open audio ${roughnessOf(open)}`)
  assert.ok(roughnessOf(open) < 0.2, 'open audio is not squashed at all')
})

test('a steady tone is not mistaken for a voice', () => {
  // A voice moves about the spectrum constantly; a held tone does not move at all.
  assert.ok(vocalnessOf(sine(440, 4)) < 0.6)
})

// ---------------------------------------------------------------- everything together

test('silence measures as nothing, not as something middling', () => {
  const measured = measure(silence(4))
  assert.equal(measured.energy, 0)
  assert.equal(measured.tempo, null)
  assert.equal(measured.danceability, 0)
  assert.equal(measured.sparseness, 1)
})

test('a loud bright busy track measures as more energetic than a quiet sparse one', () => {
  const quiet = new Float32Array(RATE * 4)
  for (let i = 0; i < RATE; i += 1) quiet[i] = Math.sin((2 * Math.PI * 200 * i) / RATE) * 0.05
  const loud = noise(4, 0.9)
  const a = measure(quiet)
  const b = measure(loud)
  assert.ok(b.energy > a.energy + 0.3, `${b.energy} should be well above ${a.energy}`)
  assert.ok(b.brightness > a.brightness)
})

test('every measurement is inside its range, whatever the audio', () => {
  for (const samples of [silence(2), sine(440, 2), noise(2, 1), clicks(128, 6)]) {
    const measured = measure(samples)
    for (const [name, value] of Object.entries(measured)) {
      if (name === 'tempo') {
        assert.ok(value === null || (value >= 60 && value <= 200), `tempo ${value}`)
        continue
      }
      assert.ok(typeof value === 'number' && value >= 0 && value <= 1, `${name} is ${value}`)
    }
  }
})

test('measuring is cheap enough to do for a whole library', () => {
  // Thirty seconds of audio, which is what the player sends. The budget is generous and the point is that it is a
  // budget at all: this runs over every file somebody imports.
  const samples = noise(30, 0.4)
  const started = performance.now()
  measure(samples)
  const took = performance.now() - started
  assert.ok(took < 3000, `took ${Math.round(took)}ms for thirty seconds of audio`)
})
