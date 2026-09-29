/**
 * Learning, music and colour, media arithmetic and project maths, checked against published values and closed forms.
 *
 * The interesting cases are where an engine could return a confident wrong answer: an SM-2 interval that ignored the
 * pass boundary, an F major scale spelled with an A sharp, a 29.97 timecode counted as 30, a buffer padded per task
 * and added up. Each of those has a test.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SCHEDULERS,
  isLearningError,
  mastery,
  retention,
  reviewWorkload,
  scheduleReview,
  studyPlan
} from './learning.ts'
import {
  CHORD_QUALITIES,
  SCALE_NAMES,
  chord,
  contrast,
  frequencyOf,
  isCreativeError,
  modularScale,
  palette,
  parseColour,
  parseNote,
  relativeLuminance,
  scale,
  tempo
} from './creative.ts'
import {
  FRAME_RATES,
  aspectRatio,
  fileSize,
  frameRateById,
  isMediaError,
  loudness,
  printSize,
  timecode
} from './media.ts'
import {
  aggregateBuffer,
  criticalPath,
  estimate,
  flow,
  isProductivityError,
  prioritise
} from './productivity.ts'

const near = (actual: number, expected: number, tolerance: number, what: string): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: got ${actual}, expected about ${expected}`)
}

// ---------------------------------------------------------------- learning

test('SM-2 follows its published schedule for a run of easy answers', () => {
  let state = { interval: 0 }
  const intervals: number[] = []
  for (let i = 0; i < 4; i += 1) {
    const report = scheduleReview({ scheduler: 'sm2', state, grade: 5 })
    assert.ok(!isLearningError(report), isLearningError(report) ? report.message : '')
    intervals.push(report.interval)
    state = report.next as { interval: number }
  }
  assert.equal(intervals[0], 1, 'the first review is a day later')
  assert.equal(intervals[1], 6, 'the second is six days, which SM-2 fixes')
  assert.ok(intervals[2] > 6, 'and after that it multiplies by the ease factor')
  assert.ok(intervals[3] > intervals[2])
})

test('a lapse resets the SM-2 interval and a struggle does not', () => {
  const settled = { interval: 30, ease: 2.5, repetitions: 5 }
  const lapse = scheduleReview({ scheduler: 'sm2', state: settled, grade: 2 })
  const struggle = scheduleReview({ scheduler: 'sm2', state: settled, grade: 3 })
  assert.ok(!isLearningError(lapse) && !isLearningError(struggle))
  assert.equal(lapse.interval, 1, 'a grade of 2 is a failure and starts again')
  assert.equal(lapse.lapsed, true)
  assert.ok(struggle.interval > 30, 'a grade of 3 is a difficult pass and still extends')
  assert.equal(struggle.lapsed, false)
  assert.ok((struggle.next.ease as number) < 2.5, 'though it lowers the ease factor')
})

test('the SM-2 ease factor stops at its floor and says so', () => {
  let state = { interval: 10, ease: 1.4, repetitions: 5 }
  for (let i = 0; i < 5; i += 1) {
    const report = scheduleReview({ scheduler: 'sm2', state, grade: 3 })
    assert.ok(!isLearningError(report))
    state = report.next as typeof state
  }
  near(state.ease as number, 1.3, 1e-9, 'the floor')
  const atFloor = scheduleReview({ scheduler: 'sm2', state, grade: 3 })
  assert.ok(!isLearningError(atFloor))
  assert.ok(atFloor.warnings.some((w) => w.includes('floor')))
})

test('FSRS-style scheduling cuts stability on a lapse rather than resetting it', () => {
  const settled = { interval: 40, stability: 40, difficulty: 5, repetitions: 6 }
  const lapse = scheduleReview({ scheduler: 'fsrs-like', state: settled, grade: 1, elapsedDays: 40 })
  assert.ok(!isLearningError(lapse), isLearningError(lapse) ? lapse.message : '')
  assert.ok((lapse.next.stability as number) > 0.5, 'a lapse does not throw everything away')
  assert.ok((lapse.next.stability as number) < 40, 'but it does cost')
  const pass = scheduleReview({ scheduler: 'fsrs-like', state: settled, grade: 4, elapsedDays: 40 })
  assert.ok(!isLearningError(pass))
  assert.ok((pass.next.stability as number) > 40, 'and a pass grows it')
})

test('a lower target retention gives longer intervals', () => {
  const state = { interval: 10, stability: 10, difficulty: 5, repetitions: 3 }
  const strict = scheduleReview({ scheduler: 'fsrs-like', state, grade: 4, elapsedDays: 10, targetRetention: 0.95 })
  const relaxed = scheduleReview({ scheduler: 'fsrs-like', state, grade: 4, elapsedDays: 10, targetRetention: 0.8 })
  assert.ok(!isLearningError(strict) && !isLearningError(relaxed))
  assert.ok(relaxed.interval > strict.interval, 'accepting more forgetting means reviewing less often')
})

test('Leitner boxes double and reset, and every scheduler names its limitation', () => {
  const report = scheduleReview({ scheduler: 'leitner', state: { interval: 4, box: 3 }, grade: 5 })
  assert.ok(!isLearningError(report), isLearningError(report) ? report.message : '')
  assert.equal(report.next.box, 4)
  assert.equal(report.interval, 8)
  for (const scheduler of SCHEDULERS) {
    const one = scheduleReview({ scheduler, state: { interval: 1 }, grade: 4, elapsedDays: 1 })
    assert.ok(!isLearningError(one), `${scheduler}: ${isLearningError(one) ? one.message : ''}`)
    assert.ok(one.limitation.length > 0, `${scheduler} does not state its limitation`)
  }
})

test('a grade outside the scale is refused with what the scale means', () => {
  const report = scheduleReview({ grade: 7 })
  assert.ok(isLearningError(report))
  assert.ok(report.message.includes('0-2 is a failure'))
})

test('the two forgetting curves agree early and diverge later', () => {
  // Both are scaled so recall is 90% at the stability figure, which is what makes the comparison mean anything.
  const atStability = retention({ curve: 'exponential', elapsedDays: 10, stability: 10 })
  assert.ok(!isLearningError(atStability), isLearningError(atStability) ? atStability.message : '')
  near(atStability.retention, 0.9, 1e-9, 'the exponential curve at its own stability')
  near(atStability.otherCurve.retention, 0.9, 1e-9, 'and the power law agrees exactly there')

  const week = retention({ curve: 'exponential', elapsedDays: 7, stability: 10 })
  assert.ok(!isLearningError(week))
  assert.ok(Math.abs(week.retention - week.otherCurve.retention) < 0.02, 'they are within two points at a week')

  const year = retention({ curve: 'exponential', elapsedDays: 365, stability: 10 })
  assert.ok(!isLearningError(year), isLearningError(year) ? year.message : '')
  assert.ok(year.retention < 0.05, 'the exponential curve says it is nearly gone')
  assert.ok(year.otherCurve.retention > 0.15, 'and the power law says a fifth of it is still there')
  assert.ok(year.otherCurve.retention > year.retention * 5, 'nearly an order of magnitude apart')
  assert.ok(year.warnings.length > 0, 'and the disagreement is reported')
})

test('retention starts at one and falls, and the threshold time is consistent', () => {
  const report = retention({ curve: 'exponential', elapsedDays: 0, stability: 10, threshold: 0.9 })
  assert.ok(!isLearningError(report), isLearningError(report) ? report.message : '')
  near(report.retention, 1, 1e-12, 'nothing is forgotten at the moment of learning')
  // Stability is defined as the time recall falls to 90%, so the threshold time for 0.9 is the stability itself.
  near(report.daysUntilThreshold as number, 10, 1e-9, 'the exponential threshold time')
  const atThreshold = report.samples.find((one) => one.day >= (report.daysUntilThreshold as number))
  assert.ok(atThreshold !== undefined && atThreshold.retention <= 0.9 + 0.01)
})

test('a perfect short run is not mastery, and the interval says so', () => {
  const report = mastery({ attempts: 3, correct: 3 })
  assert.ok(!isLearningError(report), isLearningError(report) ? report.message : '')
  assert.equal(report.rawAccuracy, 1)
  assert.ok(report.estimate < 0.9, 'the estimate is shrunk toward the middle')
  assert.ok(report.interval.low < 0.5, 'and the interval reaches well below half')
  assert.ok(report.warnings.some((w) => w.includes('not mastery')))
})

test('a long run narrows the interval and separates from guessing', () => {
  const short = mastery({ attempts: 4, correct: 3, guessRate: 0.25 })
  const long = mastery({ attempts: 200, correct: 150, guessRate: 0.25 })
  assert.ok(!isLearningError(short) && !isLearningError(long))
  near(short.rawAccuracy, long.rawAccuracy, 1e-9, 'the same proportion')
  assert.ok(long.interval.high - long.interval.low < (short.interval.high - short.interval.low) / 4, 'far tighter')
  assert.equal(short.distinguishableFromGuessing, true, 'even four answers beat a 25% guess rate here')
  assert.equal(long.distinguishableFromGuessing, true)
})

test('a sequence gives a trend that a count cannot', () => {
  const improving = mastery({ sequence: [false, false, false, true, true, true, true, true] })
  const counted = mastery({ attempts: 8, correct: 5 })
  assert.ok(!isLearningError(improving) && !isLearningError(counted))
  assert.equal(improving.trend, 'improving')
  assert.equal(counted.trend, 'unknown')
})

test('a study plan divides by weight and interleaves rather than blocking', () => {
  const report = studyPlan({
    topics: [
      { topic: 'algebra', weight: 3 },
      { topic: 'geometry', weight: 1 }
    ],
    minutesPerDay: 60,
    days: 4
  })
  assert.ok(!isLearningError(report), isLearningError(report) ? report.message : '')
  const algebra = report.perTopic.find((one) => one.topic === 'algebra')
  const geometry = report.perTopic.find((one) => one.topic === 'geometry')
  assert.ok(algebra && geometry)
  near(algebra.minutes / geometry.minutes, 3, 0.2, 'three times the weight, three times the time')
  assert.equal(report.days.length, 4)
  assert.ok(report.days[0].topics.length === 2, 'both topics appear on the first day rather than being blocked')
})

test('a plan with more topics than fit says which got no time', () => {
  const report = studyPlan({
    topics: Array.from({ length: 10 }, (_, i) => ({ topic: `topic ${i + 1}` })),
    minutesPerDay: 20,
    days: 1,
    minimumBlock: 10
  })
  assert.ok(!isLearningError(report), isLearningError(report) ? report.message : '')
  assert.equal(report.everyTopicCovered, false)
  assert.ok(report.warnings.some((w) => w.includes('no time at all')))
})

test('review workload reports the peak, not just the average', () => {
  // A hundred cards all added the same day come due together.
  const cards = Array.from({ length: 100 }, () => ({ dueDay: 7, interval: 7, growth: 2.5 }))
  const report = reviewWorkload({ cards, days: 90 })
  assert.ok(!isLearningError(report), isLearningError(report) ? report.message : '')
  assert.equal(report.peak.due, 100, 'they all land on the same day')
  assert.ok(report.peakRatio > 3)
  assert.ok(report.warnings.some((w) => w.includes('come due together')))

  const spread = reviewWorkload({ cards: cards.map((one, i) => ({ ...one, dueDay: (i % 30) + 1 })), days: 90 })
  assert.ok(!isLearningError(spread))
  assert.ok(spread.peakRatio < report.peakRatio, 'spreading the additions fixes it')
})

// ---------------------------------------------------------------- music

test('note names parse into the right pitch classes and MIDI numbers', () => {
  const middleC = parseNote('C4')
  assert.ok(!isCreativeError(middleC), isCreativeError(middleC) ? middleC.message : '')
  assert.equal(middleC.midi, 60)
  const a4 = parseNote('A4')
  assert.ok(!isCreativeError(a4))
  assert.equal(a4.midi, 69)
  const enharmonic = parseNote('Db4')
  const sharp = parseNote('C#4')
  assert.ok(!isCreativeError(enharmonic) && !isCreativeError(sharp))
  assert.equal(enharmonic.midi, sharp.midi, 'the same key on a piano')
})

test('B sharp and C flat cross the octave boundary', () => {
  const bSharp = parseNote('B#3')
  const c4 = parseNote('C4')
  assert.ok(!isCreativeError(bSharp) && !isCreativeError(c4))
  assert.equal(bSharp.midi, c4.midi, 'the same pitch')
  assert.equal(bSharp.octave, 4, 'and it belongs to the next octave')
})

test('a name that is not a note is refused with what one looks like', () => {
  const report = parseNote('H4')
  assert.ok(isCreativeError(report))
  assert.ok(report.message.includes('A to G'))
})

test('A4 is the reference and the equal-tempered octave is exactly double', () => {
  const a4 = frequencyOf({ note: 'A4' })
  const a5 = frequencyOf({ note: 'A5' })
  assert.ok(!isCreativeError(a4) && !isCreativeError(a5))
  near(a4.frequency, 440, 1e-9, 'the reference')
  near(a5.frequency, 880, 1e-9, 'an octave up is exactly double')
  const at442 = frequencyOf({ note: 'A4', referenceA4: 442 })
  assert.ok(!isCreativeError(at442))
  near(at442.frequency, 442, 1e-9, 'and the reference is an argument')
})

test('a just major third is 14 cents flat of the equal-tempered one', () => {
  const just = frequencyOf({ note: 'E4', tuning: 'just-intonation', tonic: 'C4' })
  assert.ok(!isCreativeError(just), isCreativeError(just) ? just.message : '')
  near(just.centsFromEqual, -13.7, 1, 'the syntonic comma, audible and famous')
  assert.ok(just.warnings.length > 0, 'and it is flagged as audible')
  near(just.frequency / (frequencyOf({ note: 'C4' }) as { frequency: number }).frequency, 5 / 4, 1e-9, 'an exact 5:4')
})

test('just and Pythagorean tuning both need a tonic and equal temperament does not', () => {
  const withoutTonic = frequencyOf({ note: 'E4', tuning: 'just-intonation' })
  assert.ok(isCreativeError(withoutTonic))
  assert.ok(withoutTonic.message.includes('tonic'))
  const equal = frequencyOf({ note: 'E4' })
  assert.ok(!isCreativeError(equal), 'equal temperament needs none')
})

test('a Pythagorean fifth is exactly 3:2', () => {
  const g = frequencyOf({ note: 'G4', tuning: 'pythagorean', tonic: 'C4' })
  const c = frequencyOf({ note: 'C4' })
  assert.ok(!isCreativeError(g) && !isCreativeError(c))
  near(g.frequency / c.frequency, 1.5, 1e-9, 'a perfect fifth')
})

test('C major has no accidentals and F major has a B flat, not an A sharp', () => {
  const c = scale({ tonic: 'C', scale: 'major' })
  assert.ok(!isCreativeError(c), isCreativeError(c) ? c.message : '')
  assert.deepEqual(c.notes.map((one) => one.name), ['C', 'D', 'E', 'F', 'G', 'A', 'B'])
  assert.equal(c.keySignature, 0)

  const f = scale({ tonic: 'F', scale: 'major' })
  assert.ok(!isCreativeError(f), isCreativeError(f) ? f.message : '')
  assert.ok(f.notes.some((one) => one.name === 'Bb'), 'F major is spelled with a flat')
  assert.ok(!f.notes.some((one) => one.name === 'A#'), 'and never with a sharp')
  assert.equal(f.keySignature, -1)
})

test('G major has one sharp and it is F sharp', () => {
  const g = scale({ tonic: 'G', scale: 'major' })
  assert.ok(!isCreativeError(g), isCreativeError(g) ? g.message : '')
  assert.equal(g.keySignature, 1)
  assert.ok(g.notes.some((one) => one.name === 'F#'))
})

test('the diatonic chords of a major key are the ones everyone knows', () => {
  const c = scale({ tonic: 'C', scale: 'major' })
  assert.ok(!isCreativeError(c))
  assert.ok(c.diatonicChords !== null)
  const qualities = c.diatonicChords.map((one) => one.quality)
  assert.deepEqual(qualities, ['major', 'minor', 'minor', 'major', 'major', 'minor', 'diminished'])
  assert.equal(c.diatonicChords[4].root, 'G', 'the dominant of C is G')
})

test('a minor scale names its relative major and a pentatonic has no diatonic chords', () => {
  const a = scale({ tonic: 'A', scale: 'natural-minor' })
  assert.ok(!isCreativeError(a), isCreativeError(a) ? a.message : '')
  assert.ok((a.relative as string).startsWith('C'), 'A minor is relative to C major')
  const pentatonic = scale({ tonic: 'C', scale: 'minor-pentatonic' })
  assert.ok(!isCreativeError(pentatonic))
  assert.equal(pentatonic.diatonicChords, null)
  assert.equal(pentatonic.notes.length, 5)
})

test('every scale builds and the melodic minor says what it cannot express', () => {
  for (const name of SCALE_NAMES) {
    const built = scale({ tonic: 'D', scale: name })
    assert.ok(!isCreativeError(built), `${name}: ${isCreativeError(built) ? built.message : ''}`)
    assert.ok(built.notes.length >= 5)
  }
  const melodic = scale({ tonic: 'A', scale: 'melodic-minor' })
  assert.ok(!isCreativeError(melodic))
  assert.ok(melodic.warnings.some((w) => w.includes('descend')))
})

test('a C major triad is C E G and a dominant seventh adds a flat seven', () => {
  const triad = chord({ root: 'C', quality: 'major' })
  assert.ok(!isCreativeError(triad), isCreativeError(triad) ? triad.message : '')
  assert.deepEqual(triad.notes.map((one) => one.name), ['C', 'E', 'G'])
  assert.equal(triad.inversions.length, 3)
  assert.equal(triad.inversions[1].bass, 'E', 'first inversion has the third in the bass')

  const seventh = chord({ root: 'G', quality: 'dominant-7' })
  assert.ok(!isCreativeError(seventh), isCreativeError(seventh) ? seventh.message : '')
  assert.deepEqual(seventh.notes.map((one) => one.name), ['G', 'B', 'D', 'F'])
})

test('a G major triad functions in three keys, not one', () => {
  const report = chord({ root: 'G', quality: 'major' })
  assert.ok(!isCreativeError(report), isCreativeError(report) ? report.message : '')
  const keys = report.functionsIn.map((one) => `${one.numeral} in ${one.key}`)
  assert.ok(keys.some((one) => one.startsWith('V in C')), 'the dominant of C')
  assert.ok(keys.some((one) => one.startsWith('I in G')), 'the tonic of G')
  assert.ok(keys.some((one) => one.startsWith('IV in D')), 'the subdominant of D')
})

test('symmetrical chords are flagged as having no single root', () => {
  for (const quality of ['diminished-7', 'augmented'] as const) {
    const report = chord({ root: 'C', quality })
    assert.ok(!isCreativeError(report))
    assert.ok(report.warnings.some((w) => w.includes('symmetrical')), `${quality} should be flagged`)
  }
})

test('every chord quality builds', () => {
  for (const quality of CHORD_QUALITIES) {
    const built = chord({ root: 'Eb', quality })
    assert.ok(!isCreativeError(built), `${quality}: ${isCreativeError(built) ? built.message : ''}`)
    assert.ok(built.notes.length >= 3)
  }
})

test('tempo gives the delay times a sequencer is actually set from', () => {
  const report = tempo({ beatsPerMinute: 120 })
  assert.ok(!isCreativeError(report), isCreativeError(report) ? report.message : '')
  near(report.beatMs, 500, 1e-9, 'a beat at 120 bpm')
  const eighth = report.noteValues.find((one) => one.value === 'eighth')
  assert.ok(eighth)
  near(eighth.milliseconds, 250, 1e-9, 'an eighth note')
  const dottedEighth = report.dotted.find((one) => one.value === 'dotted eighth')
  assert.ok(dottedEighth)
  near(dottedEighth.milliseconds, 375, 1e-9, 'the famous dotted eighth delay')
  near(report.barSeconds, 2, 1e-9, 'a 4/4 bar at 120')
})

// ---------------------------------------------------------------- colour

test('colours parse from hex in both lengths and from rgb', () => {
  const long = parseColour('#3366cc')
  const short = parseColour('#36c')
  const rgb = parseColour('rgb(51, 102, 204)')
  assert.ok(!isCreativeError(long) && !isCreativeError(short) && !isCreativeError(rgb))
  assert.deepEqual(long, { red: 51, green: 102, blue: 204 })
  assert.deepEqual(short, long, 'the short form expands to the same colour')
  assert.deepEqual(rgb, long)
})

test('black and white are the extremes of luminance and contrast', () => {
  const black = parseColour('#000000')
  const white = parseColour('#ffffff')
  assert.ok(!isCreativeError(black) && !isCreativeError(white))
  near(relativeLuminance(black), 0, 1e-12, 'black')
  near(relativeLuminance(white), 1, 1e-12, 'white')
  const report = contrast({ foreground: '#000000', background: '#ffffff' })
  assert.ok(!isCreativeError(report), isCreativeError(report) ? report.message : '')
  near(report.ratio, 21, 0.01, 'the maximum possible ratio')
  assert.ok(report.passes.every((one) => one.passed))
})

test('contrast thresholds follow the text size', () => {
  const body = contrast({ foreground: '#767676', background: '#ffffff', fontSize: 16 })
  const large = contrast({ foreground: '#767676', background: '#ffffff', fontSize: 24 })
  assert.ok(!isCreativeError(body) && !isCreativeError(large))
  near(body.ratio, large.ratio, 1e-12, 'the same colours')
  const bodyAa = body.passes.find((one) => one.level === 'AA')
  const largeAa = large.passes.find((one) => one.level === 'AA')
  assert.ok(bodyAa && largeAa)
  assert.equal(bodyAa.requirement, 4.5)
  assert.equal(largeAa.requirement, 3)
})

test('APCA is signed where the WCAG ratio is not', () => {
  const darkOnLight = contrast({ foreground: '#222222', background: '#ffffff' })
  const lightOnDark = contrast({ foreground: '#ffffff', background: '#222222' })
  assert.ok(!isCreativeError(darkOnLight) && !isCreativeError(lightOnDark))
  near(darkOnLight.ratio, lightOnDark.ratio, 1e-12, 'the ratio cannot tell them apart')
  assert.ok(darkOnLight.apcaLc > 0 && lightOnDark.apcaLc < 0, 'and APCA can')
})

test('a very low contrast pair fails everything and says so', () => {
  const report = contrast({ foreground: '#cccccc', background: '#ffffff' })
  assert.ok(!isCreativeError(report))
  assert.ok(report.ratio < 3)
  assert.ok(report.passes.every((one) => !one.passed))
  assert.ok(report.warnings.length > 0)
})

test('a palette reports the contrast between its colours, not just their hues', () => {
  const report = palette({ base: '#3366cc', harmony: 'triadic' })
  assert.ok(!isCreativeError(report), isCreativeError(report) ? report.message : '')
  assert.equal(report.colours.length, 3)
  near(report.colours[0].contrastWithBase, 1, 1e-9, 'the base against itself')
  // Rotating hue at constant lightness produces colours with almost identical luminance, which is the failure mode.
  assert.ok(report.colours.slice(1).every((one) => one.contrastWithBase < 3))
  assert.ok(report.warnings.length > 0, 'and it is warned about')
})

test('a monochromatic palette is the one that guarantees usable contrast', () => {
  const report = palette({ base: '#3366cc', harmony: 'monochromatic', steps: 5 })
  assert.ok(!isCreativeError(report), isCreativeError(report) ? report.message : '')
  assert.equal(report.colours.length, 5)
  const lightest = report.colours[report.colours.length - 1]
  const darkest = report.colours[0]
  assert.ok(lightest.lightness > darkest.lightness)
  assert.ok(Math.max(...report.colours.map((one) => one.contrastWithBase)) > 3, 'lightness variation gives real contrast')
})

test('a modular scale multiplies by its ratio and flags collisions', () => {
  const report = modularScale({ base: 16, ratio: 'minor-third', up: 4, down: 1 })
  assert.ok(!isCreativeError(report), isCreativeError(report) ? report.message : '')
  const base = report.steps.find((one) => one.step === 0)
  const first = report.steps.find((one) => one.step === 1)
  assert.ok(base && first)
  near(first.value / base.value, 1.2, 1e-9, 'the ratio')
  assert.equal(base.value, 16)

  const tight = modularScale({ base: 10, ratio: 1.02, up: 5, down: 0 })
  assert.ok(!isCreativeError(tight))
  assert.ok(tight.warnings.some((w) => w.includes('same whole pixel')))
})

test('a ratio at or below 1 is refused, because the scale would not grow', () => {
  const report = modularScale({ base: 16, ratio: 0.9 })
  assert.ok(isCreativeError(report))
})

// ---------------------------------------------------------------- media

test('frame rates are held as exact fractions, not decimals', () => {
  for (const one of FRAME_RATES) {
    near(one.exact, one.numerator / one.denominator, 1e-12, `${one.id} exact value`)
  }
  const ntsc = frameRateById('29.97')
  assert.ok(!isMediaError(ntsc))
  assert.equal(ntsc.numerator, 30000)
  assert.equal(ntsc.denominator, 1001)
  assert.notEqual(ntsc.exact, 30, 'and 29.97 is not 30')
  assert.ok(isMediaError(frameRateById('42')))
})

test('an hour of drop-frame timecode is about an hour of real time', () => {
  const report = timecode({ frameRate: '29.97', timecode: '01:00:00;00' })
  assert.ok(!isMediaError(report), isMediaError(report) ? report.message : '')
  near(report.seconds, 3600, 0.2, 'drop-frame keeps the clock')
  assert.equal(report.dropFrame, true)
})

test('an hour of non-drop timecode at 29.97 is 3.6 seconds long', () => {
  const report = timecode({ frameRate: '29.97', timecode: '01:00:00:00', dropFrame: false })
  assert.ok(!isMediaError(report), isMediaError(report) ? report.message : '')
  near(report.seconds, 3603.6, 0.2, 'which is the drift everyone has to know about')
  near(report.driftSeconds, -3.6, 0.2, 'reported as a negative drift')
  assert.ok(report.warnings.some((w) => w.includes('3.6')))
})

test('timecode round-trips through frames', () => {
  for (const rate of ['24', '25', '29.97', '50']) {
    const forward = timecode({ frameRate: rate, timecode: '00:10:30:05' })
    assert.ok(!isMediaError(forward), `${rate}: ${isMediaError(forward) ? forward.message : ''}`)
    const back = timecode({ frameRate: rate, frames: forward.frames })
    assert.ok(!isMediaError(back))
    assert.equal(back.timecode.replace(';', ':'), '00:10:30:05', `${rate} round trip`)
  }
})

test('a frame number that drop-frame skips is refused as not a real timecode', () => {
  const report = timecode({ frameRate: '29.97', timecode: '00:01:00;00' })
  assert.ok(isMediaError(report), 'minute one, frame zero is a skipped number')
  assert.equal(report.error, 'no-solution')
  assert.ok(report.message.includes('only the numbers are missing'))
})

test('the tenth minute keeps its frame numbers', () => {
  const report = timecode({ frameRate: '29.97', timecode: '00:10:00;00' })
  assert.ok(!isMediaError(report), isMediaError(report) ? report.message : '')
})

test('a frame field past the rate is refused', () => {
  const report = timecode({ frameRate: '25', timecode: '00:00:01:30' })
  assert.ok(isMediaError(report))
  assert.equal(report.error, 'out-of-range')
})

test('drop-frame on a whole rate is refused, because there is nothing to drop', () => {
  const report = timecode({ frameRate: '25', frames: 100, dropFrame: true })
  assert.ok(isMediaError(report))
})

test('file size is bitrate times duration, in both unit systems', () => {
  const report = fileSize({
    tracks: [{ label: 'video', bitrate: 8_000_000 }, { label: 'audio', bitrate: 256_000 }],
    durationSeconds: 3600,
    overhead: 0
  })
  assert.ok(!isMediaError(report), isMediaError(report) ? report.message : '')
  near(report.bytes, (8_256_000 * 3600) / 8, 1, 'bits over eight')
  assert.equal(report.decimal.unit, 'GB')
  assert.equal(report.binary.unit, 'GiB')
  assert.ok(report.binary.value < report.decimal.value, 'the binary figure is the smaller number for the same bytes')
  const video = report.tracks.find((one) => one.label === 'video')
  assert.ok(video && video.share > 0.9)
  assert.ok(report.warnings.some((w) => w.includes('video')))
})

test('a target size converts to a duration', () => {
  const report = fileSize({
    tracks: [{ bitrate: 1_000_000 }],
    durationSeconds: 60,
    overhead: 0,
    targetBytes: 1_000_000_000
  })
  assert.ok(!isMediaError(report), isMediaError(report) ? report.message : '')
  near(report.fitsInMinutes as number, (1_000_000_000 * 8) / 1_000_000 / 60, 1e-6, 'eight thousand seconds')
})

test('aspect ratios simplify and name themselves', () => {
  const hd = aspectRatio({ width: 1920, height: 1080 })
  assert.ok(!isMediaError(hd), isMediaError(hd) ? hd.message : '')
  assert.equal(hd.simplified.text, '16:9')
  assert.ok((hd.named as string).includes('16:9'))
  near(hd.megapixels, 2.0736, 1e-6, 'two megapixels')
})

test('fitting one shape into another reports the cost of all three ways', () => {
  const report = aspectRatio({ width: 2048, height: 858, targetWidth: 1920, targetHeight: 1080 })
  assert.ok(!isMediaError(report), isMediaError(report) ? report.message : '')
  assert.ok(report.inside !== null)
  assert.equal(report.inside.letterbox.kind, 'letterbox', 'scope into 16:9 gives bars top and bottom')
  assert.ok(report.inside.letterbox.barHeight > 0)
  assert.ok(report.inside.crop.lostFraction > 0.2, 'cropping loses a lot')
  assert.ok(report.warnings.some((w) => w.includes('Cropping')))
})

test('a matching shape is exact, with no bars and nothing lost', () => {
  const report = aspectRatio({ width: 1280, height: 720, targetWidth: 1920, targetHeight: 1080 })
  assert.ok(!isMediaError(report), isMediaError(report) ? report.message : '')
  assert.ok(report.inside !== null)
  assert.equal(report.inside.letterbox.kind, 'exact')
  near(report.inside.crop.lostFraction, 0, 1e-9, 'nothing lost')
  near(report.inside.stretch.distortion, 0, 1e-9, 'no distortion')
})

test('loudness gain is the difference, and the clipping check catches the damage', () => {
  const report = loudness({ integratedLoudness: -20, platform: 'spotify', truePeak: -1 })
  assert.ok(!isMediaError(report), isMediaError(report) ? report.message : '')
  near(report.gainDb, 6, 1e-9, 'from -20 to -14')
  near(report.resultingTruePeak as number, 5, 1e-9, 'which takes the peak well past zero')
  assert.equal(report.wouldClip, true)
  assert.ok(report.warnings.some((w) => w.includes('solved together')))
})

test('a loud master is turned down by the platform, and the result says so', () => {
  const report = loudness({ integratedLoudness: -8, platform: 'youtube' })
  assert.ok(!isMediaError(report), isMediaError(report) ? report.message : '')
  assert.ok(report.gainDb < -3)
  assert.ok(report.warnings.some((w) => w.includes('gains nothing')))
})

test('a positive LUFS figure is refused, because the scale is against full scale', () => {
  const report = loudness({ integratedLoudness: 3, target: -14 })
  assert.ok(isMediaError(report))
  assert.equal(report.error, 'out-of-range')
})

test('print size divides pixels by density and lists what the pixels support', () => {
  const report = printSize({ pixelWidth: 6000, pixelHeight: 4000, dpi: 300 })
  assert.ok(!isMediaError(report), isMediaError(report) ? report.message : '')
  near(report.inches.width, 20, 1e-9, 'six thousand over three hundred')
  near(report.millimetres.width, 20 * 25.4, 1e-6, 'in millimetres')
  near(report.megapixels, 24, 1e-9, 'a 24 megapixel image')
  const press = report.atQuality.find((one) => one.dpi === 300)
  assert.ok(press && press.inchesWide === 20)
})

test('asking for a print the pixels cannot support is flagged', () => {
  const report = printSize({ pixelWidth: 800, pixelHeight: 600, dpi: 300, requestedWidth: 20, requestedHeight: 15 })
  assert.ok(!isMediaError(report), isMediaError(report) ? report.message : '')
  assert.equal(report.enoughForRequested, false)
  assert.ok(report.warnings.some((w) => w.includes('no detail')))
})

// ---------------------------------------------------------------- productivity

test('PERT weights the likely case four times', () => {
  const report = estimate({ optimistic: 2, likely: 5, pessimistic: 14 })
  assert.ok(!isProductivityError(report), isProductivityError(report) ? report.message : '')
  near(report.expected, (2 + 20 + 14) / 6, 1e-9, 'the PERT mean')
  near(report.simpleAverage, 7, 1e-9, 'against a plain average of seven')
  near(report.standardDeviation, 2, 1e-9, 'a sixth of the range')
  assert.ok(report.expected < report.simpleAverage, 'the weighting pulls toward the likely case')
})

test('the confidence table shows what a commitment costs over an estimate', () => {
  const report = estimate({ optimistic: 5, likely: 10, pessimistic: 25 })
  assert.ok(!isProductivityError(report), isProductivityError(report) ? report.message : '')
  const fifty = report.atConfidence.find((one) => Math.abs(one.confidence - 0.5) < 1e-9)
  const eightyFive = report.atConfidence.find((one) => Math.abs(one.confidence - 0.85) < 1e-9)
  assert.ok(fifty && eightyFive)
  near(fifty.duration, report.expected, 1e-6, 'the expected value is the 50% figure')
  assert.ok(eightyFive.duration > report.expected * 1.1, 'and 85% costs substantially more')
})

test('a narrow range is flagged as a claim of certainty', () => {
  const report = estimate({ optimistic: 9.5, likely: 10, pessimistic: 10.5 })
  assert.ok(!isProductivityError(report))
  assert.ok(report.warnings.some((w) => w.includes('near-certainty')))
})

test('three identical figures are called out as a single-number estimate', () => {
  const report = estimate({ optimistic: 10, likely: 10, pessimistic: 10 })
  assert.ok(!isProductivityError(report))
  assert.equal(report.standardDeviation, 0)
  assert.ok(report.warnings.some((w) => w.includes('three hats')))
})

test('figures out of order are refused', () => {
  const report = estimate({ optimistic: 10, likely: 5, pessimistic: 20 })
  assert.ok(isProductivityError(report))
  assert.ok(report.message.includes('in order'))
})

test('the aggregate buffer grows as the square root, not linearly', () => {
  const four = aggregateBuffer({ tasks: Array.from({ length: 4 }, () => ({ expected: 10, standardDeviation: 3 })) })
  const sixteen = aggregateBuffer({ tasks: Array.from({ length: 16 }, () => ({ expected: 10, standardDeviation: 3 })) })
  assert.ok(!isProductivityError(four) && !isProductivityError(sixteen))
  near(sixteen.aggregateBuffer / four.aggregateBuffer, 2, 1e-9, 'four times the tasks, twice the buffer')
  near(sixteen.paddedSum - sixteen.baseDuration, 4 * (four.paddedSum - four.baseDuration), 1e-6, 'while padding each grows fourfold')
  near(sixteen.overBufferFactor, 4, 1e-6, 'so padding per task over-buffers fourfold at sixteen tasks')
  assert.ok(sixteen.warnings.some((w) => w.includes('too much')))
})

test('the critical path is the chain that decides the end date', () => {
  const report = criticalPath({
    tasks: [
      { id: 'design', duration: 5 },
      { id: 'build', duration: 10, dependsOn: ['design'] },
      { id: 'docs', duration: 2, dependsOn: ['design'] },
      { id: 'test', duration: 3, dependsOn: ['build'] },
      { id: 'ship', duration: 1, dependsOn: ['test', 'docs'] }
    ]
  })
  assert.ok(!isProductivityError(report), isProductivityError(report) ? report.message : '')
  assert.equal(report.projectDuration, 19, 'design, build, test, ship')
  assert.deepEqual([...report.criticalPath], ['design', 'build', 'test', 'ship'])
  const docs = report.tasks.find((one) => one.id === 'docs')
  assert.ok(docs)
  assert.equal(docs.onCriticalPath, false)
  assert.equal(docs.slack, 11, 'docs can be eleven days late and cost nothing')
})

test('a circular dependency is refused with the cycle named', () => {
  const report = criticalPath({
    tasks: [
      { id: 'a', duration: 1, dependsOn: ['b'] },
      { id: 'b', duration: 1, dependsOn: ['a'] }
    ]
  })
  assert.ok(isProductivityError(report))
  assert.equal(report.error, 'cycle')
  assert.ok(report.message.includes('a') && report.message.includes('b'))
})

test('a dependency on a task that does not exist is refused by name', () => {
  const report = criticalPath({ tasks: [{ id: 'a', duration: 1, dependsOn: ['ghost'] }] })
  assert.ok(isProductivityError(report))
  assert.equal(report.error, 'unknown-task')
  assert.ok(report.message.includes('ghost'))
})

test('near-critical tasks are reported separately', () => {
  const report = criticalPath({
    tasks: [
      { id: 'start', duration: 1 },
      { id: 'long', duration: 20, dependsOn: ['start'] },
      { id: 'nearly', duration: 19, dependsOn: ['start'] },
      { id: 'end', duration: 1, dependsOn: ['long', 'nearly'] }
    ]
  })
  assert.ok(!isProductivityError(report), isProductivityError(report) ? report.message : '')
  assert.ok(report.nearCritical.some((one) => one.id === 'nearly'))
  assert.ok(report.warnings.some((w) => w.includes('join the critical path')))
})

test('a weighted score shows what each criterion contributed', () => {
  const report = prioritise({
    method: 'weighted-score',
    items: [
      { id: 'a', criteria: { value: 8, risk: 2 } },
      { id: 'b', criteria: { value: 4, risk: 9 } }
    ],
    weights: { value: 3, risk: 1 }
  })
  assert.ok(!isProductivityError(report), isProductivityError(report) ? report.message : '')
  assert.equal(report.ranked[0].id, 'a')
  const valueContribution = report.ranked[0].contributions.find((one) => one.criterion === 'value')
  assert.ok(valueContribution)
  near(valueContribution.contribution, 24, 1e-9, 'eight times three')
  assert.ok(valueContribution.share > 0.9)
})

test('WSJF favours small work and says so', () => {
  const report = prioritise({
    method: 'wsjf',
    items: [
      { id: 'small', criteria: { businessValue: 3, timeCriticality: 1, riskReduction: 1, jobSize: 1 } },
      { id: 'large', criteria: { businessValue: 20, timeCriticality: 8, riskReduction: 8, jobSize: 20 } }
    ]
  })
  assert.ok(!isProductivityError(report), isProductivityError(report) ? report.message : '')
  assert.equal(report.ranked[0].id, 'small', 'the small item wins on less than a third of the value')
  assert.ok(report.warnings.some((w) => w.includes('favours small work')))
  assert.ok(report.caution.includes('small'))
})

test('RICE with confidence at one is flagged as having lost its only honest term', () => {
  const report = prioritise({
    method: 'rice',
    items: [{ id: 'a', criteria: { reach: 1000, impact: 2, confidence: 1, effort: 5 } }]
  })
  assert.ok(!isProductivityError(report), isProductivityError(report) ? report.message : '')
  near(report.ranked[0].score, 400, 1e-9, 'reach times impact over effort')
  assert.ok(report.warnings.some((w) => w.includes('not knowing')))
})

test('a method missing a field it needs is refused with the formula', () => {
  const report = prioritise({ method: 'rice', items: [{ id: 'a', criteria: { reach: 100 } }] })
  assert.ok(isProductivityError(report))
  assert.ok(report.message.includes('reach x impact'))
})

test('value against effort names the quadrant', () => {
  const report = prioritise({
    method: 'value-effort',
    items: [
      { id: 'quick', criteria: { value: 9, effort: 1 } },
      { id: 'big', criteria: { value: 9, effort: 9 } },
      { id: 'fill', criteria: { value: 1, effort: 1 } },
      { id: 'pit', criteria: { value: 1, effort: 9 } }
    ]
  })
  assert.ok(!isProductivityError(report), isProductivityError(report) ? report.message : '')
  const byId = new Map(report.ranked.map((one) => [one.id, one.quadrant]))
  assert.equal(byId.get('quick'), 'quick win')
  assert.equal(byId.get('big'), 'big bet')
  assert.equal(byId.get('pit'), 'money pit')
})

test('scores within five percent are reported as too close to call', () => {
  const report = prioritise({
    items: [
      { id: 'a', criteria: { value: 100 } },
      { id: 'b', criteria: { value: 98 } }
    ]
  })
  assert.ok(!isProductivityError(report), isProductivityError(report) ? report.message : '')
  assert.equal(report.tooCloseToCall.length, 1)
  assert.ok(report.warnings.some((w) => w.includes('tied')))
})

test("Little's law relates the three quantities exactly", () => {
  const report = flow({ throughput: 5, workInProgress: 20 })
  assert.ok(!isProductivityError(report), isProductivityError(report) ? report.message : '')
  near(report.cycleTime, 4, 1e-9, 'twenty over five')
  const halved = report.atWipLimits.find((one) => one.wip === 5)
  assert.ok(halved)
  near(halved.cycleTime, 1, 1e-9, 'a quarter of the WIP is a quarter of the cycle time')
})

test('three quantities that disagree are refused rather than averaged', () => {
  const report = flow({ throughput: 5, workInProgress: 20, cycleTime: 10 })
  assert.ok(isProductivityError(report))
  assert.equal(report.error, 'no-solution')
})

test('fewer than two quantities cannot fix the third', () => {
  const report = flow({ throughput: 5 })
  assert.ok(isProductivityError(report))
  assert.ok(report.message.includes('any two'))
})

test('the queueing penalty rises steeply near full utilisation', () => {
  const half = flow({ throughput: 5, workInProgress: 20, utilisation: 0.5 })
  const busy = flow({ throughput: 5, workInProgress: 20, utilisation: 0.9 })
  assert.ok(!isProductivityError(half) && !isProductivityError(busy))
  near(half.queueMultiplier as number, 1, 1e-9, 'at half capacity the queue equals the service time')
  near(busy.queueMultiplier as number, 9, 1e-9, 'at ninety percent it is nine times')
  assert.ok(busy.warnings.some((w) => w.includes('slower, not faster')))
})

test('full utilisation is refused, and the refusal is the answer', () => {
  const report = flow({ throughput: 5, workInProgress: 20, utilisation: 1 })
  assert.ok(isProductivityError(report))
  assert.ok(report.message.includes('without bound'))
})
