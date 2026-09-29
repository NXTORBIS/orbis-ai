/**
 * Chronology, linguistics, citations and social measurement, checked against published values and known dates.
 *
 * The interesting cases are the ones where an engine could return a confident wrong answer: a date in a calendar
 * that skipped eleven days, an interval across a year zero that does not exist, a citation with an invented year, a
 * kappa quoted as raw agreement. Each of those has a test.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ADOPTION_DATES,
  ageAt,
  businessDays,
  convertCalendar,
  dateFromJulianDay,
  interval,
  isChronologyError,
  isLeapYear,
  julianDayNumber,
  timeline
} from './chronology.ts'
import {
  READABILITY_FORMULAS,
  isLinguisticsError,
  phoneticKey,
  readability,
  stringDistance,
  syllablesIn,
  textStats,
  vocabularyOverlap
} from './linguistics.ts'
import {
  CITATION_STYLES,
  bibliography,
  checkIdentifier,
  formatReference,
  isCitationError
} from './citations.ts'
import {
  effectSize,
  fleissKappa,
  inequality,
  isMeasureError,
  raterAgreement,
  scaleReliability
} from './socialMeasures.ts'

const near = (actual: number, expected: number, tolerance: number, what: string): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: got ${actual}, expected about ${expected}`)
}

// ---------------------------------------------------------------- chronology

test('the two calendars disagree about leap centuries, which is how they drifted', () => {
  assert.equal(isLeapYear(1900, 'gregorian'), false)
  assert.equal(isLeapYear(1900, 'julian'), true)
  assert.equal(isLeapYear(2000, 'gregorian'), true)
  assert.equal(isLeapYear(2024, 'gregorian'), true)
  assert.equal(isLeapYear(2023, 'gregorian'), false)
})

test('the Julian Day Number matches its published epoch and round-trips', () => {
  // 1 January 2000 noon is JD 2451545; the integer day number for that date is 2451545.
  const jdn = julianDayNumber({ year: 2000, month: 1, day: 1 })
  assert.ok(!isChronologyError(jdn))
  assert.equal(jdn, 2451545)
  const back = dateFromJulianDay(jdn)
  assert.ok(!isChronologyError(back))
  assert.deepEqual({ year: back.year, month: back.month, day: back.day }, { year: 2000, month: 1, day: 1 })
})

test('a date that does not exist in its calendar is refused', () => {
  const notLeap = julianDayNumber({ year: 1900, month: 2, day: 29, calendar: 'gregorian' })
  assert.ok(isChronologyError(notLeap))
  assert.equal(notLeap.error, 'no-such-date')

  const isLeapInJulian = julianDayNumber({ year: 1900, month: 2, day: 29, calendar: 'julian' })
  assert.ok(!isChronologyError(isLeapInJulian), 'the same date does exist in the Julian calendar')
})

test('there is no year zero in the BC/AD scheme', () => {
  assert.ok(isChronologyError(julianDayNumber({ year: 0, month: 1, day: 1, era: 'ad' })))
  assert.ok(isChronologyError(julianDayNumber({ year: 0, month: 1, day: 1, era: 'bc' })))
  const oneBc = julianDayNumber({ year: 1, month: 1, day: 1, era: 'bc' })
  const zero = julianDayNumber({ year: 0, month: 1, day: 1 })
  assert.ok(!isChronologyError(oneBc) && !isChronologyError(zero))
  assert.equal(oneBc, zero, '1 BC is astronomical year 0')
})

test('an interval across the era boundary is not one year too long', () => {
  // 5 BC to AD 5 is nine years, not ten, because there is no year zero.
  const span = interval({
    from: { year: 5, month: 1, day: 1, era: 'bc' },
    to: { year: 5, month: 1, day: 1, era: 'ad' }
  })
  assert.ok(!isChronologyError(span), isChronologyError(span) ? span.message : '')
  assert.equal(span.years, 9)
  assert.equal(span.crossesEraBoundary, true)
  assert.ok(span.warnings.length > 0, 'and it explains why')
})

test('the Julian-Gregorian offset grows, rather than being a constant', () => {
  const in1582 = convertCalendar({ date: { year: 1582, month: 10, day: 4, calendar: 'julian' }, to: 'gregorian' })
  // March 1900, not January: the gap widens on 29 February 1900, which the Julian calendar has and the
  // Gregorian one does not.
  const in1900 = convertCalendar({ date: { year: 1900, month: 3, day: 1, calendar: 'julian' }, to: 'gregorian' })
  const earlier1900 = convertCalendar({ date: { year: 1900, month: 1, day: 1, calendar: 'julian' }, to: 'gregorian' })
  assert.ok(!isChronologyError(in1582) && !isChronologyError(in1900) && !isChronologyError(earlier1900))
  assert.equal(Math.abs(in1582.offset), 10, 'ten days in 1582')
  assert.equal(Math.abs(earlier1900.offset), 12, 'twelve in January 1900')
  assert.equal(Math.abs(in1900.offset), 13, 'and thirteen from March 1900, once the Julian leap day has passed')
})

test('the calendar change skipped dates and never weekdays', () => {
  // 2 September 1752 (Julian) was a Wednesday and 14 September 1752 (Gregorian) was a Thursday — consecutive days.
  const last = julianDayNumber({ year: 1752, month: 9, day: 2, calendar: 'julian' })
  const first = julianDayNumber({ year: 1752, month: 9, day: 14, calendar: 'gregorian' })
  assert.ok(!isChronologyError(last) && !isChronologyError(first))
  assert.equal(first - last, 1, 'they are consecutive days despite the eleven-day jump in the date')
  const britain = ADOPTION_DATES.find((one) => one.place.includes('Great Britain'))
  assert.ok(britain && britain.daysSkipped === 11)
})

test('a date in the transition period is flagged as ambiguous', () => {
  const report = convertCalendar({ date: { year: 1700, month: 3, day: 1, calendar: 'julian' }, to: 'gregorian' })
  assert.ok(!isChronologyError(report))
  assert.ok(report.warnings.some((w) => w.includes('different calendars')))
})

test('a proleptic Gregorian date before 1582 says what it is', () => {
  const report = convertCalendar({ date: { year: 1000, month: 1, day: 1, calendar: 'gregorian' }, to: 'julian' })
  assert.ok(!isChronologyError(report))
  assert.ok(report.warnings.some((w) => w.includes('proleptic')))
})

test('a calendar interval is not days divided by 365.25', () => {
  const span = interval({ from: { year: 2020, month: 1, day: 31 }, to: { year: 2020, month: 3, day: 1 } })
  assert.ok(!isChronologyError(span), isChronologyError(span) ? span.message : '')
  assert.equal(span.days, 30, 'thirty days in a leap year February plus one')
  assert.equal(span.months, 1, 'and one calendar month')
  assert.equal(span.years, 0)
})

test('business days exclude the weekend that was actually given', () => {
  // Monday 1 to Friday 12 January 2024: ten working days counting the end, not the start.
  const standard = businessDays({ from: { year: 2024, month: 1, day: 1 }, to: { year: 2024, month: 1, day: 12 } })
  assert.ok(!isChronologyError(standard), isChronologyError(standard) ? standard.message : '')
  assert.equal(standard.businessDays, 9, 'the start date is not counted')
  assert.equal(standard.weekendDays, 2)

  const middleEast = businessDays({
    from: { year: 2024, month: 1, day: 1 },
    to: { year: 2024, month: 1, day: 12 },
    weekendDays: [5, 6]
  })
  assert.ok(!isChronologyError(middleEast))
  assert.deepEqual([...middleEast.weekend], ['Friday', 'Saturday'])
})

test('an empty holiday list is warned about rather than assumed complete', () => {
  const report = businessDays({ from: { year: 2024, month: 12, day: 20 }, to: { year: 2025, month: 1, day: 5 } })
  assert.ok(!isChronologyError(report))
  assert.ok(report.warnings.some((w) => w.includes('Public holidays')))

  const withHolidays = businessDays({
    from: { year: 2024, month: 12, day: 20 },
    to: { year: 2025, month: 1, day: 5 },
    holidays: [
      { date: { year: 2024, month: 12, day: 25 }, label: 'Christmas Day' },
      { date: { year: 2024, month: 12, day: 26 }, label: 'Boxing Day' },
      { date: { year: 2025, month: 1, day: 1 }, label: "New Year's Day" }
    ]
  })
  assert.ok(!isChronologyError(withHolidays))
  assert.equal(withHolidays.holidaysExcluded.length, 3)
  assert.equal(withHolidays.businessDays, report.businessDays - 3)
})

test('a timeline reports how intervals relate, not just their order', () => {
  const report = timeline({
    events: [
      { label: 'the war', start: { year: 1939, month: 9, day: 1 }, end: { year: 1945, month: 9, day: 2 } },
      { label: 'the battle', start: { year: 1940, month: 7, day: 10 }, end: { year: 1940, month: 10, day: 31 } },
      { label: 'the treaty', start: { year: 1951, month: 9, day: 8 } }
    ]
  })
  assert.ok(!isChronologyError(report), isChronologyError(report) ? report.message : '')
  const nested = report.relations.find((one) => one.first === 'the war' && one.second === 'the battle')
  assert.ok(nested)
  assert.equal(nested.relation, 'contains', 'a battle falls inside a war, which "before" cannot express')
  const after = report.relations.find((one) => one.first === 'the war' && one.second === 'the treaty')
  assert.ok(after && after.relation === 'before')
  assert.equal(report.overlaps.length, 1)
})

test('an uncertain date makes a relation uncertain rather than confidently ordered', () => {
  const report = timeline({
    events: [
      { label: 'first', start: { year: 1200, month: 1, day: 1, era: 'bc' }, uncertaintyDays: 20000 },
      { label: 'second', start: { year: 1190, month: 1, day: 1, era: 'bc' }, uncertaintyDays: 20000 }
    ]
  })
  assert.ok(!isChronologyError(report), isChronologyError(report) ? report.message : '')
  assert.equal(report.relations[0].certain, false, 'two events dated circa 1200 BC cannot be ordered')
  assert.ok(report.warnings.length > 0)
})

test('an event ending before it starts is refused', () => {
  const report = timeline({
    events: [{ label: 'backwards', start: { year: 2000, month: 5, day: 1 }, end: { year: 1999, month: 5, day: 1 } }]
  })
  assert.ok(isChronologyError(report))
})

test('age is completed years and takes the date as an argument', () => {
  const dayBefore = ageAt({ birth: { year: 1994, month: 6, day: 15 }, on: { year: 2024, month: 6, day: 14 } })
  const onTheDay = ageAt({ birth: { year: 1994, month: 6, day: 15 }, on: { year: 2024, month: 6, day: 15 } })
  assert.ok(!isChronologyError(dayBefore) && !isChronologyError(onTheDay))
  assert.equal(dayBefore.years, 29, 'a day short of thirty is twenty-nine')
  assert.equal(onTheDay.years, 30)
  assert.equal(dayBefore.birthdayPassed, false)
})

test('a 29 February birthday is flagged as a legal question rather than resolved', () => {
  const report = ageAt({ birth: { year: 2000, month: 2, day: 29 }, on: { year: 2023, month: 3, day: 1 } })
  assert.ok(!isChronologyError(report))
  assert.ok(report.warnings.some((w) => w.includes('legal question')))
})

// ---------------------------------------------------------------- linguistics

test('syllable counting handles the ordinary cases', () => {
  assert.equal(syllablesIn('cat'), 1)
  assert.equal(syllablesIn('water'), 2)
  assert.equal(syllablesIn('beautiful'), 3)
  assert.equal(syllablesIn('table'), 2)
  assert.ok(syllablesIn('extraordinary') >= 4, 'a long word gets several')
  assert.equal(syllablesIn(''), 0)
})

test('text statistics count words, sentences and distinct words', () => {
  const report = textStats({ text: 'The cat sat. The cat sat again. A dog barked!' })
  assert.ok(!isLinguisticsError(report), isLinguisticsError(report) ? report.message : '')
  assert.equal(report.sentences, 3)
  assert.equal(report.words, 10)
  assert.equal(report.uniqueWords, 7, 'the, cat and sat repeat')
  near(report.averageWordsPerSentence, 10 / 3, 1e-9, 'words per sentence')
})

test('a text with no terminal punctuation is one sentence, not zero', () => {
  const report = textStats({ text: 'just some words with no full stop' })
  assert.ok(!isLinguisticsError(report))
  assert.equal(report.sentences, 1, 'dividing by zero would make every readability score infinite')
  assert.ok(report.warnings.length > 0)
})

test('the root type-token ratio does not collapse with length the way the plain one does', () => {
  const short = textStats({ text: 'alpha beta gamma delta epsilon' })
  const long = textStats({ text: 'alpha beta gamma delta epsilon '.repeat(20) })
  assert.ok(!isLinguisticsError(short) && !isLinguisticsError(long))
  assert.ok(long.typeTokenRatio < short.typeTokenRatio / 10, 'the plain ratio falls off a cliff')
  assert.ok(long.rootTypeTokenRatio < short.rootTypeTokenRatio, 'the root version also falls, but far less')
  assert.ok(long.rootTypeTokenRatio > short.rootTypeTokenRatio / 6)
})

test('graphemes and code points are counted separately', () => {
  const report = textStats({ text: 'café' })
  assert.ok(!isLinguisticsError(report))
  assert.equal(report.characters, 5, 'five code points')
  assert.equal(report.graphemes, 4, 'and four letters to a reader')
})

test('every readability formula is returned, with the spread between them', () => {
  const text =
    'The quick brown fox jumps over the lazy dog. This is a simple sentence. Another short one follows it here. ' +
    'Notwithstanding the aforementioned considerations, the implementation of such methodological frameworks ' +
    'necessitates substantial epistemological reconsideration of foundational presuppositions. Short again. ' +
    'And again now. One more short sentence to make the count work properly for these formulas.'
  const report = readability({ text })
  assert.ok(!isLinguisticsError(report), isLinguisticsError(report) ? report.message : '')
  assert.equal(report.scores.length, READABILITY_FORMULAS.length, 'all of them')
  assert.ok(report.gradeRange !== null)
  assert.ok(report.gradeRange.spread > 0, 'and they disagree, as they always do')
  for (const one of report.scores) {
    assert.ok(one.fittedOn.length > 0, `${one.formula} does not say what it was fitted on`)
    assert.ok(one.scale.length > 0)
  }
})

test('a short text is scored and marked unreliable rather than refused', () => {
  const report = readability({ text: 'Short text here. Very short indeed.' })
  assert.ok(!isLinguisticsError(report), isLinguisticsError(report) ? report.message : '')
  assert.ok(report.scores.some((one) => !one.reliable))
  assert.ok(report.warnings.length > 0)
})

test('a text with no words is refused', () => {
  const report = readability({ text: '   ...   ' })
  assert.ok(isLinguisticsError(report))
  assert.equal(report.error, 'too-short')
})

test('long sentences and long words move the scores in the expected direction', () => {
  const simple = readability({
    text: 'The cat sat. The dog ran. The bird flew. A man ate. She went out. He came back. They all left. It was fine. We saw them. You know it.'
  })
  const hard = readability({
    text:
      'The epistemological ramifications of institutionalised methodological individualism, notwithstanding its ' +
      'considerable heuristic utility within particular disciplinary configurations, remain substantially ' +
      'underdetermined by the available phenomenological evidence, which itself presupposes precisely those ' +
      'categorical distinctions whose justification constitutes the principal matter under investigation here.'
  })
  assert.ok(!isLinguisticsError(simple) && !isLinguisticsError(hard))
  const simpleGrade = simple.gradeRange?.median ?? 0
  const hardGrade = hard.gradeRange?.median ?? 0
  assert.ok(hardGrade > simpleGrade + 5, 'the hard text reads several grades higher')
  const simpleEase = simple.scores.find((one) => one.formula === 'flesch-reading-ease')?.value ?? 0
  const hardEase = hard.scores.find((one) => one.formula === 'flesch-reading-ease')?.value ?? 0
  assert.ok(simpleEase > hardEase, 'and Flesch reading ease runs the other way, as it should')
})

test('edit distance and Damerau differ on a transposition', () => {
  const swapped = stringDistance({ first: 'teh', second: 'the' })
  assert.ok(!isLinguisticsError(swapped), isLinguisticsError(swapped) ? swapped.message : '')
  assert.equal(swapped.levenshtein, 2, 'plain edit distance counts it as two')
  assert.equal(swapped.damerauLevenshtein, 1, 'Damerau counts it as one')
})

test('the edit path is reported and accounts for every character', () => {
  const report = stringDistance({ first: 'kitten', second: 'sitting' })
  assert.ok(!isLinguisticsError(report), isLinguisticsError(report) ? report.message : '')
  assert.equal(report.levenshtein, 3, 'the textbook example')
  const substitutions = report.operations.filter((one) => one.kind === 'substitute').length
  const inserts = report.operations.filter((one) => one.kind === 'insert').length
  const deletes = report.operations.filter((one) => one.kind === 'delete').length
  assert.equal(substitutions + inserts + deletes, 3, 'the path has exactly the reported number of edits')
})

test('Jaro-Winkler rewards a shared prefix the way edit distance does not', () => {
  const prefix = stringDistance({ first: 'Robert', second: 'Roberto' })
  const suffix = stringDistance({ first: 'Robert', second: 'Aobert' })
  assert.ok(!isLinguisticsError(prefix) && !isLinguisticsError(suffix))
  assert.equal(prefix.levenshtein, 1)
  assert.equal(suffix.levenshtein, 1, 'both are one edit away')
  assert.ok(prefix.jaroWinkler > suffix.jaroWinkler, 'and Jaro-Winkler prefers the one with the intact prefix')
})

test('Soundex matches names that sound alike and says what it is for', () => {
  const smith = phoneticKey({ word: 'Smith' })
  const smyth = phoneticKey({ word: 'Smyth' })
  assert.ok(!isLinguisticsError(smith) && !isLinguisticsError(smyth))
  assert.equal(smith.soundex, smyth.soundex)
  assert.equal(smith.soundex, 'S530')
  assert.ok(smith.warnings.length > 0, 'and it warns that better measures exist')
  assert.ok(smith.steps.length > 1, 'with the steps shown')
})

test('Soundex with no letters is refused rather than returning a padded nothing', () => {
  const report = phoneticKey({ word: '12345' })
  assert.ok(isLinguisticsError(report))
})

test('vocabulary overlap separates presence from frequency', () => {
  const report = vocabularyOverlap({
    first: 'the cat sat on the mat the cat was happy',
    second: 'the cat sat on the mat the cat was sad'
  })
  assert.ok(!isLinguisticsError(report), isLinguisticsError(report) ? report.message : '')
  assert.ok(report.jaccard > 0.7, 'nearly all the vocabulary is shared')
  assert.ok(report.cosineSimilarity > 0.9, 'and the frequencies line up too')
  assert.deepEqual([...report.onlyInFirst], ['happy'])
  assert.deepEqual([...report.onlyInSecond], ['sad'])
})

test('a length mismatch is warned about, because Jaccard punishes it', () => {
  const report = vocabularyOverlap({ first: 'cat dog', second: 'cat dog bird fish horse cow sheep goat pig hen duck' })
  assert.ok(!isLinguisticsError(report))
  assert.ok(report.overlapCoefficient > report.jaccard, 'the overlap coefficient is the fair measure here')
  assert.ok(report.warnings.some((w) => w.includes('times the length')))
})

// ---------------------------------------------------------------- citations

test('a complete reference formats in every style without inventing anything', () => {
  const reference = {
    kind: 'journal-article' as const,
    authors: [
      { family: 'Curie', given: 'Marie' },
      { family: 'Curie', given: 'Pierre' }
    ],
    title: 'On a new radioactive substance contained in pitchblende',
    containerTitle: 'Comptes Rendus',
    year: 1898,
    volume: '127',
    pages: '175-178'
  }
  for (const style of CITATION_STYLES) {
    const report = formatReference({ reference, style, number: 1 })
    assert.ok(!isCitationError(report), `${style}: ${isCitationError(report) ? report.message : ''}`)
    assert.equal(report.checkable, true, `${style} should have everything it needs`)
    assert.ok(report.entry.includes('Curie'), `${style} lost the author`)
    assert.ok(report.entry.includes('1898'), `${style} lost the year`)
    assert.ok(report.entry.length > 20)
  }
})

test('a missing year prints the style marker and is named as missing, never guessed', () => {
  const report = formatReference({
    reference: { kind: 'book', authors: [{ family: 'Woolf', given: 'Virginia' }], title: 'The Waves', publisher: 'Hogarth' },
    style: 'apa'
  })
  assert.ok(!isCitationError(report), isCitationError(report) ? report.message : '')
  assert.ok(report.entry.includes('n.d.'), 'the style marker for an unknown date')
  assert.ok(report.missingFields.includes('year'))
  assert.equal(report.checkable, false)
  assert.ok(!/\b(19|20)\d\d\b/.test(report.entry), 'and no year was invented anywhere in the entry')
})

test('styles abbreviate author lists at their own thresholds', () => {
  const authors = Array.from({ length: 5 }, (_, i) => ({ family: `Author${i + 1}`, given: 'A' }))
  const reference = { kind: 'journal-article' as const, authors, title: 'A paper', containerTitle: 'A journal', year: 2020 }
  const mla = formatReference({ reference, style: 'mla' })
  const apa = formatReference({ reference, style: 'apa' })
  assert.ok(!isCitationError(mla) && !isCitationError(apa))
  assert.ok(mla.entry.includes('et al.'), 'MLA abbreviates from three authors')
  assert.ok(!apa.entry.includes('et al.'), 'APA lists up to twenty')
  assert.ok(apa.entry.includes('Author5'))
})

test('a field a style does not use is reported rather than dropped silently', () => {
  const report = formatReference({
    reference: {
      kind: 'journal-article',
      authors: [{ family: 'Smith', given: 'J' }],
      title: 'A paper',
      containerTitle: 'A journal',
      year: 2020,
      place: 'London'
    },
    style: 'apa'
  })
  assert.ok(!isCitationError(report))
  assert.ok(report.unusedFields.includes('place'))
  assert.ok(report.warnings.some((w) => w.includes('place')))
})

test('Harvard says it has no single authority', () => {
  const report = formatReference({
    reference: { kind: 'book', authors: [{ family: 'Orwell', given: 'George' }], title: '1984', year: 1949, publisher: 'Secker' },
    style: 'harvard'
  })
  assert.ok(!isCitationError(report))
  assert.ok(report.warnings.some((w) => w.includes('no single authority')))
})

test('a numbered style cannot produce an in-text form without a number', () => {
  const without = formatReference({
    reference: { kind: 'journal-article', authors: [{ family: 'Smith' }], title: 'A paper', containerTitle: 'A journal', year: 2020 },
    style: 'vancouver'
  })
  assert.ok(!isCitationError(without))
  assert.equal(without.inText, '[number needed]')
  assert.ok(without.warnings.some((w) => w.includes('numbered style')))
})

test('an author with no family name is refused, because that is a missing author', () => {
  const report = formatReference({
    reference: { kind: 'book', authors: [{ family: '  ', given: 'A' }], title: 'A book', year: 2000, publisher: 'X' },
    style: 'apa'
  })
  assert.ok(isCitationError(report))
})

test('a known ISBN passes and a mistyped digit fails with the expected check digit', () => {
  // 0-306-40615-2 is the standard ISBN-10 example.
  const good = checkIdentifier({ identifier: '0-306-40615-2' })
  assert.ok(!isCitationError(good), isCitationError(good) ? good.message : '')
  assert.equal(good.kind, 'isbn-10')
  assert.equal(good.valid, true)
  assert.equal(good.alternateForm, '9780306406157', 'the ISBN-13 form, recomputed rather than carried over')

  const bad = checkIdentifier({ identifier: '0-306-40615-3' })
  assert.ok(!isCitationError(bad))
  assert.equal(bad.valid, false)
  assert.equal(bad.expectedCheck, '2')
})

test('a wrong ISBN-10 is not converted, because a wrong ISBN-13 would look right', () => {
  const bad = checkIdentifier({ identifier: '0306406153' })
  assert.ok(!isCitationError(bad))
  assert.equal(bad.alternateForm, null)
})

test('ISBN-13 and ISSN checksums work, and 979 has no ten-digit form', () => {
  const isbn13 = checkIdentifier({ identifier: '978-0-306-40615-7' })
  assert.ok(!isCitationError(isbn13))
  assert.equal(isbn13.valid, true)
  assert.equal(isbn13.alternateForm, '0306406152')

  const issn = checkIdentifier({ identifier: '0378-5955' })
  assert.ok(!isCitationError(issn))
  assert.equal(issn.kind, 'issn')
  assert.equal(issn.valid, true)
})

test('a DOI is shape-checked and says it cannot be verified', () => {
  const report = checkIdentifier({ identifier: 'https://doi.org/10.1038/nature12373' })
  assert.ok(!isCitationError(report), isCitationError(report) ? report.message : '')
  assert.equal(report.kind, 'doi')
  assert.equal(report.valid, true)
  assert.equal(report.normalised, '10.1038/nature12373')
  assert.ok(report.notes.some((n) => n.includes('does not mean the work exists')))

  const malformed = checkIdentifier({ identifier: '10.x/nothing' })
  assert.ok(isCitationError(malformed) || malformed.valid === false)
})

test('a bibliography sorts by style and keeps numbered order intact', () => {
  const references = [
    { kind: 'book' as const, authors: [{ family: 'Zola', given: 'Emile' }], title: 'Germinal', year: 1885, publisher: 'Charpentier' },
    { kind: 'book' as const, authors: [{ family: 'Austen', given: 'Jane' }], title: 'Emma', year: 1815, publisher: 'Murray' }
  ]
  const apa = bibliography({ references, style: 'apa' })
  assert.ok(!isCitationError(apa), isCitationError(apa) ? apa.message : '')
  assert.equal(apa.order, 'alphabetical')
  assert.ok(apa.entries[0].entry.includes('Austen'), 'sorted by family name')

  const ieee = bibliography({ references, style: 'ieee' })
  assert.ok(!isCitationError(ieee))
  assert.equal(ieee.order, 'as-cited')
  assert.ok(ieee.entries[0].entry.includes('Zola'), 'citation order is preserved so the numbers still point correctly')
})

test('possible duplicates are flagged and never merged', () => {
  const same = { kind: 'journal-article' as const, authors: [{ family: 'Smith' }], title: 'A paper', containerTitle: 'J', year: 2020, doi: '10.1/abc' }
  const report = bibliography({ references: [same, { ...same, pages: '1-10' }], style: 'apa' })
  assert.ok(!isCitationError(report), isCitationError(report) ? report.message : '')
  assert.equal(report.entries.length, 2, 'both are kept')
  assert.equal(report.possibleDuplicates.length, 1)
  assert.ok(report.warnings.some((w) => w.includes('not merged')))
})

// ---------------------------------------------------------------- social measurement

test("Cronbach's alpha rises with items that agree and finds the one that does not", () => {
  // Four items that track each other, plus one reverse-coded item nobody reversed.
  const responses = [
    [5, 5, 4, 5, 1],
    [1, 2, 1, 1, 5],
    [4, 4, 5, 4, 2],
    [2, 1, 2, 2, 4],
    [3, 3, 3, 3, 3],
    [5, 4, 5, 5, 1],
    [1, 1, 2, 1, 5],
    [4, 5, 4, 4, 2]
  ]
  const report = scaleReliability({ responses })
  assert.ok(!isMeasureError(report), isMeasureError(report) ? report.message : '')
  const reversed = report.ifItemRemoved.find((one) => one.item === 5)
  assert.ok(reversed)
  assert.ok(reversed.itemTotalCorrelation < 0, 'the unreversed item correlates negatively')
  assert.ok(reversed.alpha > report.alpha, 'and removing it would raise alpha')
  assert.ok(report.warnings.some((w) => w.includes('reverse')))
})

test('alpha rises with the number of items but the inter-item correlation does not', () => {
  const column = [5, 1, 4, 2, 3, 5, 1, 4, 2, 3]
  const jitter = (offset: number): number[] => column.map((one, i) => one + ((i + offset) % 2 === 0 ? 0.5 : -0.5))
  const four = scaleReliability({ responses: column.map((_, i) => [0, 1, 2, 3].map((k) => jitter(k)[i])) })
  const eight = scaleReliability({ responses: column.map((_, i) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => jitter(k)[i])) })
  assert.ok(!isMeasureError(four) && !isMeasureError(eight))
  assert.ok(eight.alpha > four.alpha, 'more items, higher alpha, same underlying agreement')
  near(eight.averageInterItemCorrelation, four.averageInterItemCorrelation, 0.15, 'the length-free measure barely moves')
})

test('alpha refuses data with no variance rather than dividing by zero', () => {
  const report = scaleReliability({ responses: [[3, 3, 3], [3, 3, 3], [3, 3, 3]] })
  assert.ok(isMeasureError(report))
  assert.equal(report.error, 'no-variance')
})

test('a ragged response matrix is refused rather than padded', () => {
  const report = scaleReliability({ responses: [[1, 2, 3], [1, 2]] })
  assert.ok(isMeasureError(report))
  assert.ok(report.message.includes('Missing answers'))
})

test('high raw agreement on a skewed category gives a low kappa, and both are shown', () => {
  // Both raters say "no" almost always. Raw agreement is high and agreement beyond chance is not.
  const ratings = [
    ...Array.from({ length: 90 }, () => ({ first: 'no', second: 'no' })),
    ...Array.from({ length: 4 }, () => ({ first: 'yes', second: 'no' })),
    ...Array.from({ length: 4 }, () => ({ first: 'no', second: 'yes' })),
    ...Array.from({ length: 2 }, () => ({ first: 'yes', second: 'yes' }))
  ]
  const report = raterAgreement({ ratings })
  assert.ok(!isMeasureError(report), isMeasureError(report) ? report.message : '')
  assert.ok(report.rawAgreement > 0.9, 'raw agreement is over 90%')
  assert.ok(report.kappa < 0.35, 'and kappa is far lower')
  assert.ok(report.warnings.some((w) => w.includes('chance')))
})

test('perfect agreement gives a kappa of one, and random agreement about zero', () => {
  const perfect = raterAgreement({
    ratings: [
      { first: 'a', second: 'a' },
      { first: 'b', second: 'b' },
      { first: 'a', second: 'a' },
      { first: 'b', second: 'b' }
    ]
  })
  assert.ok(!isMeasureError(perfect), isMeasureError(perfect) ? perfect.message : '')
  near(perfect.kappa, 1, 1e-9, 'perfect agreement')

  const random = raterAgreement({
    ratings: [
      { first: 'a', second: 'a' },
      { first: 'a', second: 'b' },
      { first: 'b', second: 'a' },
      { first: 'b', second: 'b' }
    ]
  })
  assert.ok(!isMeasureError(random))
  near(random.kappa, 0, 1e-9, 'agreement exactly at chance')
})

test('weighted kappa exceeds plain kappa when disagreements are near misses', () => {
  const ordered = ['low', 'medium', 'high']
  const ratings = [
    { first: 'low', second: 'low' },
    { first: 'low', second: 'medium' },
    { first: 'medium', second: 'medium' },
    { first: 'medium', second: 'high' },
    { first: 'high', second: 'high' },
    { first: 'high', second: 'medium' },
    { first: 'low', second: 'low' },
    { first: 'high', second: 'high' }
  ]
  const report = raterAgreement({ ratings, orderedCategories: ordered })
  assert.ok(!isMeasureError(report), isMeasureError(report) ? report.message : '')
  assert.ok(report.weightedKappa !== null)
  assert.ok(report.weightedKappa > report.kappa, 'being one category out is counted as less wrong')
})

test('unordered categories are flagged, so weighted kappa is not silently skipped', () => {
  const report = raterAgreement({
    ratings: [
      { first: 'a', second: 'a' },
      { first: 'b', second: 'c' },
      { first: 'c', second: 'c' }
    ]
  })
  assert.ok(!isMeasureError(report))
  assert.equal(report.weightedKappa, null)
  assert.ok(report.warnings.some((w) => w.includes('unordered')))
})

test('Fleiss kappa works with several raters and reports per-category agreement', () => {
  const report = fleissKappa({
    counts: [
      [5, 0],
      [4, 1],
      [0, 5],
      [1, 4],
      [5, 0],
      [0, 5]
    ],
    categories: ['yes', 'no']
  })
  assert.ok(!isMeasureError(report), isMeasureError(report) ? report.message : '')
  assert.ok(report.kappa > 0.6, 'the raters mostly agree')
  assert.equal(report.raters, 5)
  assert.equal(report.perCategory.length, 2)
})

test('Fleiss refuses cases with different numbers of ratings', () => {
  const report = fleissKappa({ counts: [[3, 0], [2, 0]] })
  assert.ok(isMeasureError(report))
  assert.ok(report.message.includes('same number of ratings'))
})

test('a perfectly equal distribution has a Gini of zero', () => {
  const report = inequality({ values: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10] })
  assert.ok(!isMeasureError(report), isMeasureError(report) ? report.message : '')
  near(report.gini, 0, 1e-9, 'perfect equality')
  for (const one of report.quintileShares) near(one.share, 0.2, 1e-9, `quintile ${one.quintile}`)
})

test('the quintile shares add to one and the top fifth leads', () => {
  const report = inequality({ values: [1, 2, 3, 4, 5, 10, 20, 40, 80, 160] })
  assert.ok(!isMeasureError(report), isMeasureError(report) ? report.message : '')
  const total = report.quintileShares.reduce((sum, one) => sum + one.share, 0)
  near(total, 1, 1e-9, 'the shares are a partition')
  assert.ok(report.quintileShares[4].share > report.quintileShares[0].share * 10)
  assert.ok(report.gini > 0.5, 'a skewed distribution')
  assert.ok(report.lorenz.length === 11, 'the Lorenz curve starts at the origin')
})

test('negative values are refused, because the Gini stops meaning what it usually means', () => {
  const report = inequality({ values: [-5, 10, 20] })
  assert.ok(isMeasureError(report))
  assert.ok(report.message.includes('negative wealth'))
})

test("Cohen's d matches its definition and reports the overlap", () => {
  const report = effectSize({ measure: 'cohens-d', meanA: 100, meanB: 115, sdA: 15, sdB: 15, nA: 50, nB: 50 })
  assert.ok(!isMeasureError(report), isMeasureError(report) ? report.message : '')
  near(report.value, 1, 1e-9, 'a full standard deviation apart')
  assert.equal(report.band, 'large')
  assert.ok(report.overlap !== null && report.overlap > 0.5 && report.overlap < 0.7, 'and still more than half overlapping')
  assert.ok(report.interval !== null)
})

test("Hedges' g corrects the small-sample bias and Cohen's d is flagged for it", () => {
  const d = effectSize({ measure: 'cohens-d', meanA: 100, meanB: 110, sdA: 10, sdB: 10, nA: 8, nB: 8 })
  const g = effectSize({ measure: 'hedges-g', meanA: 100, meanB: 110, sdA: 10, sdB: 10, nA: 8, nB: 8 })
  assert.ok(!isMeasureError(d) && !isMeasureError(g))
  assert.ok(g.value < d.value, 'g is the smaller, corrected figure')
  assert.ok(d.warnings.some((w) => w.includes('biased upward')))
})

test('very unequal variances are flagged as the wrong case for pooling', () => {
  const report = effectSize({ measure: 'cohens-d', meanA: 100, meanB: 110, sdA: 5, sdB: 25, nA: 40, nB: 40 })
  assert.ok(!isMeasureError(report))
  assert.ok(report.warnings.some((w) => w.includes("Glass")))
})

test('the odds ratio and risk ratio differ on a common outcome, and it says so', () => {
  // 60 of 100 exposed and 30 of 100 unexposed: risk ratio 2, odds ratio 3.5.
  const odds = effectSize({ measure: 'odds-ratio', table: [[60, 40], [30, 70]] })
  const risk = effectSize({ measure: 'risk-ratio', table: [[60, 40], [30, 70]] })
  assert.ok(!isMeasureError(odds) && !isMeasureError(risk))
  near(risk.value, 2, 1e-9, 'the risk ratio')
  near(odds.value, 3.5, 1e-9, 'the odds ratio, always more extreme')
  assert.ok(odds.warnings.some((w) => w.includes('overstates')))
  near(risk.numberNeededToTreat as number, 1 / 0.3, 1e-9, 'and the risk ratio gives a number needed to treat')
})

test('a zero denominator in an odds ratio is refused rather than smoothed', () => {
  const report = effectSize({ measure: 'odds-ratio', table: [[10, 0], [0, 10]] })
  assert.ok(isMeasureError(report))
  assert.equal(report.error, 'no-solution')
})

test("Cramér's V measures strength on a larger table and flags sparse cells", () => {
  const strong = effectSize({ measure: 'cramers-v', table: [[40, 5, 5], [5, 40, 5], [5, 5, 40]] })
  assert.ok(!isMeasureError(strong), isMeasureError(strong) ? strong.message : '')
  assert.ok(strong.value > 0.5, 'a strong diagonal association')

  const sparse = effectSize({ measure: 'cramers-v', table: [[2, 1], [1, 2]] })
  assert.ok(!isMeasureError(sparse))
  assert.ok(sparse.warnings.some((w) => w.includes('expected count')))
})
