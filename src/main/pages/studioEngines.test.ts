/**
 * The studio bridge, tested through the door a Page actually knocks on.
 *
 * The engines have their own tests. What is checked here is the boundary: that every advertised operation has an
 * implementation, that nothing reads the clock, that traces are thinned without moving the answers, and that a
 * refusal arrives as a value with a reason on it.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { STUDIO_CAPABILITY, STUDIO_LIMITS, runStudioOperation } from './studioEngines.ts'
import { BadInput } from './engines.ts'

const run = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> =>
  runStudioOperation(operation, input) as Record<string, unknown>

const ok = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> => {
  const result = run(operation, input)
  assert.equal(result.ok, true, `${operation} failed: ${String(result.message ?? '')}`)
  return result
}

const near = (actual: unknown, expected: number, tolerance: number, what: string): void => {
  assert.equal(typeof actual, 'number', `${what} is not a number`)
  assert.ok(Math.abs((actual as number) - expected) <= tolerance, `${what}: got ${actual}, expected about ${expected}`)
}

test('every advertised operation has an implementation', () => {
  for (const operation of Object.keys(STUDIO_CAPABILITY)) {
    try {
      runStudioOperation(operation, {})
    } catch (error) {
      assert.ok(error instanceof BadInput, `${operation} threw something other than BadInput: ${String(error)}`)
      assert.ok(!/is not a studio operation/.test(error.message), `${operation} is advertised but has no implementation`)
    }
  }
})

test('every operation asks for the same capability, and it is the studio one', () => {
  for (const [operation, capability] of Object.entries(STUDIO_CAPABILITY)) {
    assert.equal(capability, 'computation.studio', `${operation} asks for something else`)
  }
})

test('an operation nobody advertises is refused', () => {
  assert.throws(() => runStudioOperation('studio.make-me-a-hit', {}), BadInput)
})

test('nothing in this bridge or its engines reads the clock', () => {
  // A schedule returns an interval in days and never a date, which is what keeps every answer reproducible.
  const here = dirname(fileURLToPath(import.meta.url))
  const files = [
    join(here, 'studioEngines.ts'),
    join(here, '..', '..', 'shared', 'compute', 'learning.ts'),
    join(here, '..', '..', 'shared', 'compute', 'creative.ts'),
    join(here, '..', '..', 'shared', 'compute', 'media.ts'),
    join(here, '..', '..', 'shared', 'compute', 'productivity.ts')
  ]
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const forbidden of ['Date.now(', 'new Date(', 'performance.now(', 'Math.random(']) {
      assert.ok(!source.includes(forbidden), `${file} uses ${forbidden}`)
    }
  }
})

test('the revision operations are not under the "study" prefix the catalogue excludes', () => {
  // `study` is already the parameter-study family and the generation catalogue drops that whole prefix. Anything
  // named study.* here would be invisible to Orion for ever, which is why these are revise.*.
  for (const operation of Object.keys(STUDIO_CAPABILITY)) {
    assert.ok(!operation.startsWith('study.'), `${operation} would never be offered to Orion`)
  }
  assert.ok(Object.keys(STUDIO_CAPABILITY).some((one) => one.startsWith('revise.')))
})

// ---------------------------------------------------------------- revision

test('a review returns an interval in days, never a date', () => {
  const result = ok('revise.review', { scheduler: 'sm2', grade: 5, state: { interval: 6, ease: 2.5, repetitions: 2 } })
  assert.equal(typeof result.interval, 'number')
  assert.ok(result.next !== undefined, 'and the state to store for next time')
  assert.ok(!Object.keys(result).some((one) => /date/i.test(one)), 'no date field, because there is no clock here')
})

test('a grade outside the scale is refused with what the scale means', () => {
  const result = run('revise.review', { grade: 9 })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('0-2 is a failure'))
})

test('a scheduler nobody defined is refused', () => {
  assert.throws(() => runStudioOperation('revise.review', { scheduler: 'vibes', grade: 4 }), BadInput)
})

test('a retention trace is thinned without moving the answer', () => {
  const base = { curve: 'exponential', elapsedDays: 5, stability: 10, samples: 800 }
  const full = ok('revise.retention', { ...base, trace: 800 })
  const thinned = ok('revise.retention', { ...base, trace: 20 })
  assert.equal((full.samples as unknown[]).length, 800)
  assert.equal((thinned.samples as unknown[]).length, 20)
  assert.equal(thinned.retention, full.retention, 'the answer comes from the formula, not the trace')
  assert.equal(thinned.daysUntilThreshold, full.daysUntilThreshold)
})

test('a trace cannot be asked for more samples than the door allows', () => {
  const result = ok('revise.retention', { elapsedDays: 1, stability: 10, samples: 100, trace: 1_000_000 })
  assert.ok((result.samples as unknown[]).length <= STUDIO_LIMITS.samples)
})

test('mastery from a count and from a sequence agree, and only one gives a trend', () => {
  const counted = ok('revise.mastery', { attempts: 8, correct: 6 })
  const sequenced = ok('revise.mastery', { sequence: [true, false, true, true, false, true, true, true] })
  near(sequenced.rawAccuracy, counted.rawAccuracy as number, 1e-9, 'the same proportion')
  assert.equal(counted.trend, 'unknown')
  assert.notEqual(sequenced.trend, 'unknown')
})

test('a sequence entry that is not a boolean is refused', () => {
  assert.throws(() => runStudioOperation('revise.mastery', { sequence: [true, 'yes'] }), BadInput)
})

test('a study plan divides by weight and interleaves', () => {
  const result = ok('revise.plan', {
    topics: [{ topic: 'algebra', weight: 3 }, { topic: 'geometry', weight: 1 }],
    minutesPerDay: 60,
    days: 4
  })
  const perTopic = result.perTopic as { topic: string; minutes: number }[]
  const algebra = perTopic.find((one) => one.topic === 'algebra')
  const geometry = perTopic.find((one) => one.topic === 'geometry')
  assert.ok(algebra && geometry)
  near(algebra.minutes / geometry.minutes, 3, 0.2, 'three times the weight')
})

test('a workload trace is thinned and the peak survives', () => {
  const cards = Array.from({ length: 50 }, () => ({ dueDay: 7, interval: 7 }))
  const full = ok('revise.workload', { cards, days: 120, trace: 400 })
  const thinned = ok('revise.workload', { cards, days: 120, trace: 15 })
  assert.equal((full.days as unknown[]).length, 120)
  assert.equal((thinned.days as unknown[]).length, 15)
  assert.deepEqual(thinned.peak, full.peak, 'the peak is found before thinning')
})

// ---------------------------------------------------------------- music

test('notes and frequencies come back through the door', () => {
  const note = ok('music.note', { note: 'A4' })
  assert.equal(note.midi, 69)
  const frequency = ok('music.frequency', { note: 'A4' })
  near(frequency.frequency, 440, 1e-9, 'the reference pitch')
})

test('just intonation refuses without a tonic and works with one', () => {
  const without = run('music.frequency', { note: 'E4', tuning: 'just-intonation' })
  assert.equal(without.ok, false)
  assert.ok((without.message as string).includes('tonic'))
  const with_ = ok('music.frequency', { note: 'E4', tuning: 'just-intonation', tonic: 'C4' })
  near(with_.centsFromEqual, -13.7, 1, 'the syntonic comma')
})

test('a tuning nobody defined is refused', () => {
  assert.throws(() => runStudioOperation('music.frequency', { note: 'A4', tuning: 'my-own' }), BadInput)
})

test('F major is spelled with a flat through the door too', () => {
  const result = ok('music.scale', { tonic: 'F', scale: 'major' })
  const names = (result.notes as { name: string }[]).map((one) => one.name)
  assert.ok(names.includes('Bb'))
  assert.ok(!names.includes('A#'))
  assert.equal(result.keySignature, -1)
})

test('a chord reports the keys it functions in', () => {
  const result = ok('music.chord', { root: 'G', quality: 'major' })
  const keys = (result.functionsIn as { key: string; numeral: string }[]).map((one) => `${one.numeral} ${one.key}`)
  assert.ok(keys.some((one) => one.startsWith('V ')), 'the dominant of somewhere')
  assert.ok(keys.length >= 3, 'a triad belongs to three major keys')
})

test('a scale or chord nobody defined is refused', () => {
  assert.throws(() => runStudioOperation('music.scale', { tonic: 'C', scale: 'bebop-omni' }), BadInput)
  assert.throws(() => runStudioOperation('music.chord', { root: 'C', quality: 'wonky' }), BadInput)
})

test('tempo gives the dotted eighth delay everyone sets', () => {
  const result = ok('music.tempo', { beatsPerMinute: 120 })
  const dotted = (result.dotted as { value: string; milliseconds: number }[]).find((one) => one.value === 'dotted eighth')
  assert.ok(dotted)
  near(dotted.milliseconds, 375, 1e-9, 'the famous setting')
})

// ---------------------------------------------------------------- colour

test('contrast reports both standards and the thresholds it was judged against', () => {
  const result = ok('colour.contrast', { foreground: '#000000', background: '#ffffff' })
  near(result.ratio, 21, 0.01, 'the maximum')
  assert.ok((result.passes as { passed: boolean }[]).every((one) => one.passed))
  assert.ok(typeof result.apcaLc === 'number')
})

test('a colour nobody can read is refused with the formats that work', () => {
  const result = run('colour.contrast', { foreground: 'burnt sienna', background: '#fff' })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('#3366cc'))
})

test('a palette reports contrast with the base and warns when it is too low', () => {
  const result = ok('colour.palette', { base: '#3366cc', harmony: 'triadic' })
  assert.equal((result.colours as unknown[]).length, 3)
  assert.ok((result.warnings as string[]).length > 0, 'rotating hue at constant lightness gives no contrast')
})

test('a modular scale takes a named ratio or a number, both visible', () => {
  const named = ok('layout.scale', { base: 16, ratio: 'perfect-fourth', up: 3, down: 0 })
  const steps = named.steps as { step: number; value: number }[]
  const first = steps.find((one) => one.step === 1)
  assert.ok(first)
  near(first.value / 16, 1.333, 0.001, 'the named ratio')

  const custom = ok('layout.scale', { base: 16, ratioValue: 1.5, up: 2, down: 0 })
  const customFirst = (custom.steps as { step: number; value: number }[]).find((one) => one.step === 1)
  assert.ok(customFirst)
  near(customFirst.value / 16, 1.5, 1e-9, 'and the number wins when both are given')
})

// ---------------------------------------------------------------- media

test('drop-frame timecode keeps the clock and non-drop does not', () => {
  const drop = ok('media.timecode', { frameRate: '29.97', timecode: '01:00:00;00' })
  near(drop.seconds, 3600, 0.2, 'an hour of drop-frame is an hour')
  const nonDrop = ok('media.timecode', { frameRate: '29.97', timecode: '01:00:00:00', dropFrame: false })
  near(nonDrop.seconds, 3603.6, 0.2, 'and non-drop is 3.6 seconds longer')
})

test('a skipped drop-frame number is refused rather than rounded to a valid one', () => {
  const result = run('media.timecode', { frameRate: '29.97', timecode: '00:01:00;00' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'no-solution')
})

test('a frame rate nobody defined is refused with the list', () => {
  const result = run('media.timecode', { frameRate: '100', frames: 10 })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('29.97'))
})

test('file size comes back in both unit systems', () => {
  const result = ok('media.file-size', {
    tracks: [{ label: 'video', bitrate: 8_000_000 }, { label: 'audio', bitrate: 256_000 }],
    durationSeconds: 3600,
    overhead: 0
  })
  near(result.bytes, (8_256_000 * 3600) / 8, 1, 'bits over eight')
  const decimal = result.decimal as { unit: string; value: number }
  const binary = result.binary as { unit: string; value: number }
  assert.equal(decimal.unit, 'GB')
  assert.equal(binary.unit, 'GiB')
  assert.ok(binary.value < decimal.value)
})

test('fitting one aspect ratio into another reports all three costs', () => {
  const result = ok('media.aspect-ratio', { width: 2048, height: 858, targetWidth: 1920, targetHeight: 1080 })
  const inside = result.inside as { letterbox: { kind: string }; crop: { lostFraction: number } }
  assert.equal(inside.letterbox.kind, 'letterbox')
  assert.ok(inside.crop.lostFraction > 0.2)
})

test('loudness catches the clipping that normalising a quiet master would cause', () => {
  const result = ok('media.loudness', { integratedLoudness: -20, platform: 'spotify', truePeak: -1 })
  near(result.gainDb, 6, 1e-9, 'six decibels up')
  assert.equal(result.wouldClip, true)
})

test('a platform nobody defined is refused with the list', () => {
  const result = run('media.loudness', { integratedLoudness: -14, platform: 'myspace' })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('spotify'))
})

test('print size divides pixels by density', () => {
  const result = ok('media.print-size', { pixelWidth: 6000, pixelHeight: 4000, dpi: 300 })
  const inches = result.inches as { width: number; height: number }
  near(inches.width, 20, 1e-9, 'six thousand over three hundred')
})

// ---------------------------------------------------------------- planning

test('an estimate comes back as a range with confidence levels', () => {
  const result = ok('plan.estimate', { optimistic: 5, likely: 10, pessimistic: 25 })
  near(result.expected, (5 + 40 + 25) / 6, 1e-9, 'the PERT mean')
  const levels = result.atConfidence as { confidence: number; duration: number }[]
  assert.ok(levels.length >= 4)
  const eightyFive = levels.find((one) => Math.abs(one.confidence - 0.85) < 1e-9)
  assert.ok(eightyFive && eightyFive.duration > (result.expected as number))
})

test('figures out of order are refused', () => {
  const result = run('plan.estimate', { optimistic: 20, likely: 5, pessimistic: 10 })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('in order'))
})

test('the aggregate buffer is far smaller than padding each task', () => {
  const result = ok('plan.buffer', {
    tasks: Array.from({ length: 16 }, () => ({ expected: 10, standardDeviation: 3 }))
  })
  near(result.overBufferFactor, 4, 1e-6, 'sixteen tasks means padding each over-buffers fourfold')
  assert.ok((result.aggregateBuffer as number) < (result.paddedSum as number) - (result.baseDuration as number))
})

test('the critical path and every task slack come back', () => {
  const result = ok('plan.critical-path', {
    tasks: [
      { id: 'design', duration: 5 },
      { id: 'build', duration: 10, dependsOn: ['design'] },
      { id: 'docs', duration: 2, dependsOn: ['design'] },
      { id: 'ship', duration: 1, dependsOn: ['build', 'docs'] }
    ]
  })
  assert.equal(result.projectDuration, 16)
  assert.deepEqual(result.criticalPath, ['design', 'build', 'ship'])
  const docs = (result.tasks as { id: string; slack: number }[]).find((one) => one.id === 'docs')
  assert.ok(docs && docs.slack === 8)
})

test('a circular dependency is refused with the cycle named', () => {
  const result = run('plan.critical-path', {
    tasks: [
      { id: 'a', duration: 1, dependsOn: ['b'] },
      { id: 'b', duration: 1, dependsOn: ['a'] }
    ]
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'cycle')
})

test('prioritising shows each criterion contribution and names the method bias', () => {
  const result = ok('plan.prioritise', {
    method: 'wsjf',
    items: [
      { id: 'small', criteria: { businessValue: 3, timeCriticality: 1, riskReduction: 1, jobSize: 1 } },
      { id: 'large', criteria: { businessValue: 20, timeCriticality: 8, riskReduction: 8, jobSize: 20 } }
    ]
  })
  const ranked = result.ranked as { id: string; contributions: unknown[] }[]
  assert.equal(ranked[0].id, 'small')
  assert.ok(ranked[0].contributions.length >= 4)
  assert.ok((result.caution as string).includes('small'))
})

test('a criterion name that could reach a prototype is refused', () => {
  // Written as a literal, __proto__ sets the prototype instead of becoming a key. Parsed from JSON — which is how
  // a Page's payload actually arrives — it is a real own property, which is the case the guard is for.
  const sneaky = JSON.parse('{"__proto__": 1, "constructor": 2}')
  assert.throws(() => runStudioOperation('plan.prioritise', { items: [{ id: 'a', criteria: sneaky }] }), BadInput)
})

test('a method missing a field it needs is refused with the formula', () => {
  const result = run('plan.prioritise', { method: 'rice', items: [{ id: 'a', criteria: { reach: 100 } }] })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('reach x impact'))
})

test("Little's law needs two quantities and refuses three that disagree", () => {
  const two = ok('plan.flow', { throughput: 5, workInProgress: 20 })
  near(two.cycleTime, 4, 1e-9, 'twenty over five')
  const one = run('plan.flow', { throughput: 5 })
  assert.equal(one.ok, false)
  const three = run('plan.flow', { throughput: 5, workInProgress: 20, cycleTime: 10 })
  assert.equal(three.ok, false)
  assert.equal(three.error, 'no-solution')
})

test('full utilisation is refused, and the refusal is the answer', () => {
  const result = run('plan.flow', { throughput: 5, workInProgress: 20, utilisation: 1 })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('without bound'))
})

// ---------------------------------------------------------------- provenance

test('the assumptions cover every domain this bridge answers for', () => {
  const result = ok('studio.assumptions')
  for (const domain of ['learning', 'creative', 'media', 'planning']) {
    assert.ok(
      Array.isArray(result[domain]) && (result[domain] as unknown[]).length > 0,
      `${domain} has no assumptions listed`
    )
  }
})

test('the reference tables come back with their facts attached', () => {
  assert.ok(Object.keys(ok('revise.schedulers').facts as object).length > 0)
  assert.ok(Object.keys(ok('revise.curves').facts as object).length > 0)
  assert.ok(Object.keys(ok('music.tunings').facts as object).length > 0)
  assert.ok(Object.keys(ok('music.scales').patterns as object).length > 0)
  assert.ok(Object.keys(ok('music.chords').patterns as object).length > 0)
  assert.ok((ok('media.frame-rates').frameRates as unknown[]).length > 0)
  assert.ok((ok('media.loudness-targets').targets as unknown[]).length > 0)
  assert.ok(Object.keys(ok('plan.priority-methods').facts as object).length > 0)
  assert.ok(Object.keys(ok('layout.ratios').ratios as object).length > 0)
  assert.ok((ok('colour.harmonies').harmonies as unknown[]).length > 0)
})
