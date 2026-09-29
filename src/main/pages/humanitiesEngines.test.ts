/**
 * The humanities bridge, tested through the door a Page actually knocks on.
 *
 * The engines have their own tests. What is checked here is the boundary: that every advertised operation has an
 * implementation, that a date cannot arrive without its calendar being a real one, that nothing reads the clock or
 * looks anything up, and that a refusal arrives as a value with a reason on it.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { HUMANITIES_CAPABILITY, HUMANITIES_LIMITS, runHumanitiesOperation } from './humanitiesEngines.ts'
import { BadInput } from './engines.ts'

const run = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> =>
  runHumanitiesOperation(operation, input) as Record<string, unknown>

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
  for (const operation of Object.keys(HUMANITIES_CAPABILITY)) {
    try {
      runHumanitiesOperation(operation, {})
    } catch (error) {
      assert.ok(error instanceof BadInput, `${operation} threw something other than BadInput: ${String(error)}`)
      assert.ok(
        !/is not a humanities operation/.test(error.message),
        `${operation} is advertised but has no implementation`
      )
    }
  }
})

test('every operation asks for the same capability, and it is the humanities one', () => {
  for (const [operation, capability] of Object.entries(HUMANITIES_CAPABILITY)) {
    assert.equal(capability, 'computation.humanities', `${operation} asks for something else`)
  }
})

test('an operation nobody advertises is refused', () => {
  assert.throws(() => runHumanitiesOperation('humanities.write-my-essay', {}), BadInput)
})

test('nothing in this bridge or its engines reads the clock or reaches the network', () => {
  // Dates are arguments so results are reproducible, and citations are formatted rather than looked up. Both are
  // load-bearing claims in the documentation, so they are checked rather than trusted.
  const here = dirname(fileURLToPath(import.meta.url))
  const files = [
    join(here, 'humanitiesEngines.ts'),
    join(here, '..', '..', 'shared', 'compute', 'chronology.ts'),
    join(here, '..', '..', 'shared', 'compute', 'linguistics.ts'),
    join(here, '..', '..', 'shared', 'compute', 'citations.ts'),
    join(here, '..', '..', 'shared', 'compute', 'socialMeasures.ts')
  ]
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const forbidden of ['Date.now(', 'new Date(', 'performance.now(', 'fetch(', 'XMLHttpRequest']) {
      assert.ok(!source.includes(forbidden), `${file} uses ${forbidden}`)
    }
  }
})

// ---------------------------------------------------------------- calendars

test('a date carries its calendar and its era through the door', () => {
  const gregorian = ok('date.julian-day', { date: { year: 1900, month: 2, day: 28, calendar: 'gregorian' } })
  const julian = ok('date.julian-day', { date: { year: 1900, month: 2, day: 29, calendar: 'julian' } })
  assert.notEqual(gregorian.julianDayNumber, julian.julianDayNumber)

  const impossible = run('date.julian-day', { date: { year: 1900, month: 2, day: 29, calendar: 'gregorian' } })
  assert.equal(impossible.ok, false)
  assert.equal(impossible.error, 'no-such-date')
})

test('a calendar nobody defined is refused', () => {
  assert.throws(
    () => runHumanitiesOperation('date.julian-day', { date: { year: 2000, month: 1, day: 1, calendar: 'mayan' } }),
    BadInput
  )
})

test('an era nobody defined is refused', () => {
  assert.throws(
    () => runHumanitiesOperation('date.julian-day', { date: { year: 100, month: 1, day: 1, era: 'bce-ish' } }),
    BadInput
  )
})

test('the Julian Day Number round-trips through the door', () => {
  const forward = ok('date.julian-day', { date: { year: 1969, month: 7, day: 20 } })
  const back = ok('date.from-julian-day', { julianDayNumber: forward.julianDayNumber })
  assert.deepEqual({ year: back.year, month: back.month, day: back.day }, { year: 1969, month: 7, day: 20 })
})

test('a conversion reports the offset and flags the ambiguous period', () => {
  const result = ok('date.convert', { date: { year: 1700, month: 3, day: 1, calendar: 'julian' }, to: 'gregorian' })
  assert.equal(Math.abs(result.offset as number), 11)
  assert.ok((result.warnings as string[]).some((w) => w.includes('different calendars')))
})

test('an interval across the era boundary is one year shorter than subtracting suggests', () => {
  const result = ok('date.interval', {
    from: { year: 5, month: 1, day: 1, era: 'bc' },
    to: { year: 5, month: 1, day: 1, era: 'ad' }
  })
  assert.equal(result.years, 9)
  assert.equal(result.crossesEraBoundary, true)
})

test('business days take the weekend and holidays as arguments', () => {
  const plain = ok('date.business-days', { from: { year: 2024, month: 1, day: 1 }, to: { year: 2024, month: 1, day: 12 } })
  assert.equal(plain.businessDays, 9)
  assert.ok((plain.warnings as string[]).some((w) => w.includes('Public holidays')))

  const withHoliday = ok('date.business-days', {
    from: { year: 2024, month: 1, day: 1 },
    to: { year: 2024, month: 1, day: 12 },
    holidays: [{ date: { year: 2024, month: 1, day: 2 }, label: 'a holiday' }]
  })
  assert.equal(withHoliday.businessDays, 8)
  assert.deepEqual(withHoliday.holidaysExcluded, ['a holiday'])
})

test('age takes the reference date rather than the clock', () => {
  const dayBefore = ok('date.age', { birth: { year: 1994, month: 6, day: 15 }, on: { year: 2024, month: 6, day: 14 } })
  const onTheDay = ok('date.age', { birth: { year: 1994, month: 6, day: 15 }, on: { year: 2024, month: 6, day: 15 } })
  assert.equal(dayBefore.years, 29)
  assert.equal(onTheDay.years, 30)
})

test('a timeline thins its relation list without losing the count', () => {
  const events = Array.from({ length: 40 }, (_, i) => ({
    label: `event ${i + 1}`,
    start: { year: 1900 + i, month: 1, day: 1 }
  }))
  const full = ok('date.timeline', { events, relations: 2000 })
  const thinned = ok('date.timeline', { events, relations: 25 })
  assert.equal((full.relations as unknown[]).length, 780, 'every pair of forty events')
  assert.equal((thinned.relations as unknown[]).length, 25)
  assert.equal(thinned.relationsTotal, 780, 'and the total is still reported')
})

test('a relation list cannot be asked for more than the door allows', () => {
  const events = Array.from({ length: 10 }, (_, i) => ({ label: `e${i}`, start: { year: 2000 + i, month: 1, day: 1 } }))
  const result = ok('date.timeline', { events, relations: 1_000_000 })
  assert.ok((result.relations as unknown[]).length <= HUMANITIES_LIMITS.relations)
})

// ---------------------------------------------------------------- text

test('readability returns every formula, each with what it was fitted on', () => {
  const text =
    'The quick brown fox jumps over the lazy dog. Simple sentences are easy. Another one here now. ' +
    'Notwithstanding the aforementioned methodological considerations, substantial epistemological ' +
    'reconsideration remains necessary. Short again. And again. One more to make the counts behave.'
  const result = ok('text.readability', { text })
  const scores = result.scores as { formula: string; fittedOn: string; scale: string }[]
  assert.equal(scores.length, 6)
  for (const one of scores) {
    assert.ok(one.fittedOn.length > 0, `${one.formula} does not say what it was fitted on`)
  }
  assert.ok(result.gradeRange !== null)
})

test('a text with no words is refused', () => {
  const result = run('text.readability', { text: '   ' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'too-short')
})

test('the frequency list is capped on the way out', () => {
  const text = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ')
  const result = ok('text.stats', { text, topWords: 5 })
  assert.equal((result.frequencies as unknown[]).length, 5)
  assert.equal(result.uniqueWords, 300, 'and the count still reflects the whole text')
})

test('syllables come back per word with the estimate warning attached', () => {
  const result = ok('text.syllables', { words: ['cat', 'water', 'beautiful'] })
  const words = result.words as { word: string; syllables: number }[]
  assert.deepEqual(words.map((one) => one.syllables), [1, 2, 3])
  assert.equal(result.total, 6)
  assert.ok(typeof result.note === 'string' && (result.note as string).includes('85-90%'))
})

test('string distance reports the path and thins it', () => {
  const result = ok('text.distance', { first: 'kitten', second: 'sitting', operations: 500 })
  assert.equal(result.levenshtein, 3)
  assert.equal(result.damerauLevenshtein, 3)
  const capped = ok('text.distance', { first: 'a'.repeat(200), second: 'b'.repeat(200), operations: 10 })
  assert.equal((capped.operations as unknown[]).length, 10)
  assert.equal(capped.operationsTotal, 200)
})

test('the phonetic key matches names that sound alike and warns about itself', () => {
  const smith = ok('text.phonetic', { word: 'Smith' })
  const smyth = ok('text.phonetic', { word: 'Smyth' })
  assert.equal(smith.soundex, smyth.soundex)
  assert.ok((smith.warnings as string[]).length > 0)
})

test('vocabulary overlap accepts a stop-word list and caps the word lists', () => {
  const first = `the of and ${Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ')}`
  const second = `the of and ${Array.from({ length: 300 }, (_, i) => `w${i + 150}`).join(' ')}`
  const result = ok('text.overlap', { first, second, ignore: ['the', 'of', 'and'], listLength: 10 })
  assert.equal((result.sharedWords as unknown[]).length, 10)
  assert.equal(result.sharedTotal, 150, 'and the total is still the true count')
  assert.ok((result.warnings as string[]).every((w) => !w.includes('No words were ignored')))
})

// ---------------------------------------------------------------- references

test('a reference formats without inventing a missing year', () => {
  const result = ok('cite.format', {
    reference: { kind: 'book', authors: [{ family: 'Woolf', given: 'Virginia' }], title: 'The Waves', publisher: 'Hogarth' },
    style: 'apa'
  })
  assert.ok((result.entry as string).includes('n.d.'))
  assert.ok((result.missingFields as string[]).includes('year'))
  assert.equal(result.checkable, false)
  assert.ok(!/\b(19|20)\d\d\b/.test(result.entry as string), 'no year appears anywhere in the entry')
})

test('a style nobody defined is refused', () => {
  assert.throws(
    () =>
      runHumanitiesOperation('cite.format', {
        reference: { kind: 'book', title: 'A book' },
        style: 'my-own-style'
      }),
    BadInput
  )
})

test('a source kind nobody defined is refused', () => {
  assert.throws(
    () => runHumanitiesOperation('cite.format', { reference: { kind: 'tweet-thread', title: 'A thread' }, style: 'apa' }),
    BadInput
  )
})

test('a bibliography keeps numbered order and sorts author-date styles', () => {
  const references = [
    { kind: 'book', authors: [{ family: 'Zola', given: 'Emile' }], title: 'Germinal', year: 1885, publisher: 'C' },
    { kind: 'book', authors: [{ family: 'Austen', given: 'Jane' }], title: 'Emma', year: 1815, publisher: 'M' }
  ]
  const apa = ok('cite.bibliography', { references, style: 'apa' })
  assert.equal(apa.order, 'alphabetical')
  assert.ok(((apa.entries as { entry: string }[])[0].entry).includes('Austen'))

  const ieee = ok('cite.bibliography', { references, style: 'ieee' })
  assert.equal(ieee.order, 'as-cited')
  assert.ok(((ieee.entries as { entry: string }[])[0].entry).includes('Zola'))
})

test('an identifier is checked by arithmetic and says it cannot confirm the work exists', () => {
  const good = ok('cite.identifier', { identifier: '978-0-306-40615-7' })
  assert.equal(good.valid, true)
  assert.ok((good.notes as string[]).some((n) => n.includes('does not mean the work exists')))

  const bad = ok('cite.identifier', { identifier: '978-0-306-40615-8' })
  assert.equal(bad.valid, false)
  assert.equal(bad.expectedCheck, '7')
})

test('an identifier of an unknown shape is refused with the list', () => {
  const result = run('cite.identifier', { identifier: 'not-an-identifier' })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('ISBN-10'))
})

// ---------------------------------------------------------------- social measurement

test('reliability finds the item that does not belong', () => {
  const result = ok('measure.reliability', {
    responses: [
      [5, 5, 4, 1],
      [1, 2, 1, 5],
      [4, 4, 5, 2],
      [2, 1, 2, 4],
      [5, 4, 5, 1],
      [1, 1, 2, 5]
    ]
  })
  const items = result.ifItemRemoved as { item: number; itemTotalCorrelation: number }[]
  const reversed = items.find((one) => one.item === 4)
  assert.ok(reversed && reversed.itemTotalCorrelation < 0)
  assert.ok((result.warnings as string[]).some((w) => w.includes('reverse')))
})

test('a ragged response matrix is refused rather than padded', () => {
  const result = run('measure.reliability', { responses: [[1, 2, 3], [1, 2]] })
  assert.equal(result.ok, false)
})

test('agreement always reports the raw figure beside kappa', () => {
  const ratings = [
    ...Array.from({ length: 90 }, () => ({ first: 'no', second: 'no' })),
    ...Array.from({ length: 4 }, () => ({ first: 'yes', second: 'no' })),
    ...Array.from({ length: 4 }, () => ({ first: 'no', second: 'yes' })),
    ...Array.from({ length: 2 }, () => ({ first: 'yes', second: 'yes' }))
  ]
  const result = ok('measure.agreement', { ratings })
  assert.ok((result.rawAgreement as number) > 0.9)
  assert.ok((result.kappa as number) < 0.35)
  assert.ok((result.warnings as string[]).some((w) => w.includes('chance')))
})

test('ordered categories unlock weighted kappa and unordered ones say so', () => {
  const ratings = [
    { first: 'low', second: 'low' },
    { first: 'low', second: 'medium' },
    { first: 'medium', second: 'high' },
    { first: 'high', second: 'high' },
    { first: 'high', second: 'medium' },
    { first: 'low', second: 'low' }
  ]
  const unordered = ok('measure.agreement', { ratings })
  assert.equal(unordered.weightedKappa, null)
  const ordered = ok('measure.agreement', { ratings, orderedCategories: ['low', 'medium', 'high'] })
  assert.ok(ordered.weightedKappa !== null)
})

test('inequality reports the shares the Gini compresses, and thins its curve', () => {
  const values = Array.from({ length: 500 }, (_, i) => (i + 1) ** 2)
  const full = ok('measure.inequality', { values, curvePoints: 4000 })
  const thinned = ok('measure.inequality', { values, curvePoints: 20 })
  assert.equal((full.lorenz as unknown[]).length, 501)
  assert.equal((thinned.lorenz as unknown[]).length, 20)
  assert.equal(thinned.gini, full.gini, 'the coefficient comes from the calculation, not the drawn curve')
  const quintiles = full.quintileShares as { share: number }[]
  near(quintiles.reduce((sum, one) => sum + one.share, 0), 1, 1e-9, 'the shares partition the total')
})

test('negative values are refused rather than producing a Gini above one', () => {
  const result = run('measure.inequality', { values: [-10, 5, 20] })
  assert.equal(result.ok, false)
})

test('an effect size reports the overlap alongside the coefficient', () => {
  const result = ok('measure.effect-size', { measure: 'cohens-d', meanA: 100, meanB: 115, sdA: 15, sdB: 15, nA: 50, nB: 50 })
  near(result.value, 1, 1e-9, "Cohen's d")
  assert.ok((result.overlap as number) > 0.5, 'a "large" effect still overlaps more than half')
  assert.ok(result.interval !== null)
})

test('the odds ratio warns when it diverges from the risk ratio', () => {
  const odds = ok('measure.effect-size', { measure: 'odds-ratio', table: [[60, 40], [30, 70]] })
  near(odds.value, 3.5, 1e-9, 'the odds ratio')
  assert.ok((odds.warnings as string[]).some((w) => w.includes('overstates')))
  const risk = ok('measure.effect-size', { measure: 'risk-ratio', table: [[60, 40], [30, 70]] })
  near(risk.value, 2, 1e-9, 'and the risk ratio is the smaller one')
})

test('an effect measure nobody defined is refused', () => {
  assert.throws(() => runHumanitiesOperation('measure.effect-size', { measure: 'vibes' }), BadInput)
})

test('a table cell that is not a number is refused', () => {
  assert.throws(
    () => runHumanitiesOperation('measure.effect-size', { measure: 'risk-ratio', table: [[60, 'forty'], [30, 70]] }),
    BadInput
  )
})

// ---------------------------------------------------------------- provenance

test('the assumptions cover every domain this bridge answers for', () => {
  const result = ok('humanities.assumptions')
  for (const domain of ['chronology', 'linguistics', 'citations', 'measurement']) {
    assert.ok(
      Array.isArray(result[domain]) && (result[domain] as unknown[]).length > 0,
      `${domain} has no assumptions listed`
    )
  }
})

test('the reference tables come back with their facts attached', () => {
  assert.ok(Object.keys(ok('cite.styles').facts as object).length > 0)
  assert.ok(Object.keys(ok('text.formulas').facts as object).length > 0)
  assert.ok(Object.keys(ok('date.calendars').facts as object).length > 0)
  assert.ok((ok('date.calendars').adoptionDates as unknown[]).length > 0)
  assert.ok(Object.keys(ok('measure.effect-measures').facts as object).length > 0)
  assert.ok(Object.keys(ok('date.relations').describe as object).length === 13)
})
