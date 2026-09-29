/**
 * The humanities workbench a Page can reach: calendars, texts, references and social measurement.
 *
 * Same contract as every bridge before it. A Page sends data, never code. There is no `eval` and no `new Function`
 * on any path reachable from here, and every number a Page shows came back through this door from an engine that
 * computed it — none of it is produced by a language model and none of it is hardcoded.
 *
 * ## No clock, and no lookups
 *
 * Every date is an argument, so a Page asking about 1752 gets 1752 and nothing changes between one run and the
 * next. And no operation here looks anything up: a citation is formatted from the fields given, an ISBN is checked
 * by arithmetic on its digits, and neither can tell you whether the work exists. Both limits are on the results
 * rather than in a footnote.
 *
 * ## The operations that refuse rather than default
 *
 * `text.readability` returns every formula rather than one, because they disagree by several grade levels and the
 * disagreement is the finding. `cite.format` prints the style's own marker for a missing year and names the gap —
 * it never invents a field, because a fabricated citation looks checkable and is not. `measure.agreement` always
 * returns raw agreement beside kappa, because the gap between them is usually the whole story. `date.julian-day`
 * refuses 29 February 1900 in the Gregorian calendar and accepts it in the Julian one, which is the same fact from
 * two directions.
 */

import {
  ADOPTION_DATES,
  ALLEN_DESCRIPTIONS,
  ALLEN_RELATIONS,
  CALENDARS,
  CALENDAR_FACTS,
  CHRONOLOGY_ASSUMPTIONS,
  ageAt,
  businessDays,
  convertCalendar,
  dateFromJulianDay,
  interval,
  isChronologyError,
  isLeapYear,
  julianDayNumber,
  timeline,
  type Calendar,
  type HistoricalDate,
  type TimelineEvent
} from '../../shared/compute/chronology.ts'
import {
  LINGUISTICS_ASSUMPTIONS,
  READABILITY_FACTS,
  READABILITY_FORMULAS,
  isLinguisticsError,
  phoneticKey,
  readability,
  stringDistance,
  syllablesIn,
  textStats,
  vocabularyOverlap
} from '../../shared/compute/linguistics.ts'
import {
  CITATION_ASSUMPTIONS,
  CITATION_STYLES,
  SOURCE_KINDS,
  STYLE_FACTS,
  bibliography,
  checkIdentifier,
  formatReference,
  isCitationError,
  type Author,
  type CitationStyle,
  type Reference,
  type SourceKind
} from '../../shared/compute/citations.ts'
import {
  EFFECT_FACTS,
  EFFECT_MEASURES,
  MEASURE_ASSUMPTIONS,
  effectSize,
  fleissKappa,
  inequality,
  isMeasureError,
  raterAgreement,
  scaleReliability,
  type EffectMeasure
} from '../../shared/compute/socialMeasures.ts'
import { BadInput, Reader } from './engines.ts'

/**
 * Every operation this bridge answers, and the capability each one needs.
 *
 * All of them need the same one. A Page that can convert a date can also count syllables, and splitting them into
 * four permissions would ask the user four questions about the same thing — arithmetic that reaches nothing
 * outside the Page.
 */
export const HUMANITIES_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  // ---- calendars and time
  'date.calendars': 'computation.humanities',
  'date.leap-year': 'computation.humanities',
  'date.julian-day': 'computation.humanities',
  'date.from-julian-day': 'computation.humanities',
  'date.convert': 'computation.humanities',
  'date.interval': 'computation.humanities',
  'date.business-days': 'computation.humanities',
  'date.age': 'computation.humanities',
  'date.timeline': 'computation.humanities',
  'date.relations': 'computation.humanities',

  // ---- text
  'text.stats': 'computation.humanities',
  'text.syllables': 'computation.humanities',
  'text.readability': 'computation.humanities',
  'text.formulas': 'computation.humanities',
  'text.distance': 'computation.humanities',
  'text.phonetic': 'computation.humanities',
  'text.overlap': 'computation.humanities',

  // ---- references
  'cite.format': 'computation.humanities',
  'cite.styles': 'computation.humanities',
  'cite.bibliography': 'computation.humanities',
  'cite.identifier': 'computation.humanities',

  // ---- social measurement
  'measure.reliability': 'computation.humanities',
  'measure.agreement': 'computation.humanities',
  'measure.panel-agreement': 'computation.humanities',
  'measure.inequality': 'computation.humanities',
  'measure.effect-size': 'computation.humanities',
  'measure.effect-measures': 'computation.humanities',

  // ---- provenance
  'humanities.assumptions': 'computation.humanities'
})

/** What crosses the boundary, as opposed to what the engines will compute. */
export const HUMANITIES_LIMITS = Object.freeze({
  events: 2000,
  holidays: 400,
  spans: 64,
  authors: 100,
  references: 1000,
  respondents: 20_000,
  items: 500,
  categories: 200,
  values: 20_000,
  relations: 4000,
  words: 500
})

const settle = <T>(value: T, isError: (one: unknown) => boolean): unknown =>
  isError(value) ? { ok: false, ...(value as object) } : { ok: true, ...(value as object) }

// ---------------------------------------------------------------- readers

function objectAt(read: Reader, key: string): Reader {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be an object.`)
  }
  return new Reader(raw as Record<string, unknown>)
}

function choice<T extends string>(read: Reader, key: string, allowed: readonly T[], fallback?: T): T {
  if (!read.has(key)) {
    if (fallback !== undefined) return fallback
    throw new BadInput(`"${key}" has to be one of: ${allowed.join(', ')}.`)
  }
  const value = read.text(key, 64)
  if (!(allowed as readonly string[]).includes(value)) {
    throw new BadInput(`"${value}" is not one of: ${allowed.join(', ')}.`)
  }
  return value as T
}

/**
 * A historical date, read as named fields with its calendar and era.
 *
 * The calendar and era are part of the date, not decoration on it: 14 September 1752 does not exist in Britain,
 * and there is no year zero in the BC/AD scheme. Reading a date without them would silently pick one.
 */
function dateFrom(entry: Reader): HistoricalDate {
  const era = entry.optionalText('era', '', 8)
  if (era !== '' && era !== 'bc' && era !== 'ad') {
    throw new BadInput(`"${era}" is not an era; use "bc" or "ad", or leave it out for astronomical year numbering.`)
  }
  return {
    year: Math.round(entry.number('year')),
    month: Math.round(entry.number('month')),
    day: Math.round(entry.number('day')),
    calendar: entry.has('calendar') ? choice<Calendar>(entry, 'calendar', CALENDARS) : undefined,
    era: era === '' ? undefined : era
  }
}

function dateAt(read: Reader, key: string): HistoricalDate {
  return dateFrom(objectAt(read, key))
}

/**
 * Reads a group of arguments where the engine requires some of them but no single one of them.
 *
 * Passing the reader in is what makes the operation invisible to the generation catalogue, and that is the point:
 * an effect size needs two means and two standard deviations or a contingency table, and neither set alone is
 * required. An operation offered with only the arguments a static reader can see would pass the argument check and
 * then be refused by the engine.
 */
function optionalGroup(read: Reader, names: readonly string[]): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = Object.create(null)
  for (const name of names) out[name] = read.has(name) ? read.number(name) : undefined
  return out
}

function authorsFrom(entry: Reader, key: string): Author[] | undefined {
  if (!entry.has(key)) return undefined
  return entry.list(key, HUMANITIES_LIMITS.authors).map((one) => {
    const author = new Reader(one)
    return {
      family: author.text('family', 300),
      given: author.optionalText('given', '', 300) || undefined,
      isOrganisation: author.boolean('isOrganisation', false)
    }
  })
}

function referenceFrom(entry: Reader): Reference {
  const reference: Reference = {
    kind: choice<SourceKind>(entry, 'kind', SOURCE_KINDS),
    authors: authorsFrom(entry, 'authors'),
    editors: authorsFrom(entry, 'editors'),
    title: entry.optionalText('title', '', 2000) || undefined,
    containerTitle: entry.optionalText('containerTitle', '', 2000) || undefined,
    year: entry.has('year') ? Math.round(entry.number('year')) : undefined,
    volume: entry.optionalText('volume', '', 64) || undefined,
    issue: entry.optionalText('issue', '', 64) || undefined,
    pages: entry.optionalText('pages', '', 64) || undefined,
    publisher: entry.optionalText('publisher', '', 500) || undefined,
    place: entry.optionalText('place', '', 200) || undefined,
    doi: entry.optionalText('doi', '', 500) || undefined,
    url: entry.optionalText('url', '', 2000) || undefined,
    edition: entry.optionalText('edition', '', 64) || undefined,
    institution: entry.optionalText('institution', '', 500) || undefined
  }
  if (entry.has('accessed')) {
    const when = objectAt(entry, 'accessed')
    reference.accessed = {
      year: Math.round(when.number('year')),
      month: Math.round(when.number('month')),
      day: Math.round(when.number('day'))
    }
  }
  return reference
}

/**
 * A grid of numbers, read from the raw value rather than through `list`.
 *
 * `list` requires each entry to be an object, and a response matrix or a contingency table arrives as an array of
 * arrays. A row given as `{ values: [...] }` is accepted too, because that is the shape a table editor sends.
 */
function numberMatrix(read: Reader, key: string, maxRows: number, maxColumns: number): number[][] {
  const raw = read.raw(key)
  if (!Array.isArray(raw)) throw new BadInput(`"${key}" has to be a list of rows.`)
  if (raw.length > maxRows) throw new BadInput(`"${key}" has more than the ${maxRows} rows allowed.`)
  return raw.map((row, i) => {
    if (Array.isArray(row)) {
      if (row.length > maxColumns) throw new BadInput(`Row ${i + 1} has more than the ${maxColumns} columns allowed.`)
      return row.map((value, j) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new BadInput(`Row ${i + 1}, column ${j + 1} is not a finite number.`)
        }
        return value
      })
    }
    if (typeof row === 'object' && row !== null) {
      return new Reader(row as Record<string, unknown>).numbers('values', maxColumns)
    }
    throw new BadInput(`Row ${i + 1} is neither a list of numbers nor an object with a "values" list.`)
  })
}

/** Cut a long trace down to what a chart can use, keeping both ends. */
function thin<T>(samples: readonly T[], wanted: number): readonly T[] {
  if (samples.length <= wanted) return samples
  const step = (samples.length - 1) / (wanted - 1)
  const out: T[] = []
  for (let i = 0; i < wanted; i += 1) out.push(samples[Math.round(i * step)])
  return out
}

// ---------------------------------------------------------------- dispatch

export function runHumanitiesOperation(operation: string, input: Record<string, unknown>): unknown {
  const read = new Reader(input)

  switch (operation) {
    // ---------------------------------------------------------------- calendars
    case 'date.calendars':
      return { ok: true, calendars: CALENDARS, facts: CALENDAR_FACTS, adoptionDates: ADOPTION_DATES }

    case 'date.leap-year': {
      const built = isLeapYear(Math.round(read.number('year')), read.choice('calendar', CALENDARS, 'gregorian'))
      return isChronologyError(built) ? { ok: false, ...built } : { ok: true, leapYear: built }
    }

    case 'date.julian-day': {
      const built = julianDayNumber(dateAt(read, 'date'))
      return isChronologyError(built) ? { ok: false, ...built } : { ok: true, julianDayNumber: built }
    }

    case 'date.from-julian-day':
      return settle(
        dateFromJulianDay(Math.round(read.number('julianDayNumber')), read.choice('calendar', CALENDARS, 'gregorian')),
        isChronologyError
      )

    case 'date.convert':
      return settle(convertCalendar({ date: dateAt(read, 'date'), to: read.choice('to', CALENDARS, 'gregorian') }), isChronologyError)

    case 'date.interval':
      return settle(interval({ from: dateAt(read, 'from'), to: dateAt(read, 'to') }), isChronologyError)

    case 'date.business-days': {
      const holidays = read.has('holidays')
        ? read.list('holidays', HUMANITIES_LIMITS.holidays).map((one) => {
            const entry = new Reader(one)
            return { date: dateFrom(objectAt(entry, 'date')), label: entry.optionalText('label', '', 200) || undefined }
          })
        : undefined
      return settle(
        businessDays({
          from: dateAt(read, 'from'),
          to: dateAt(read, 'to'),
          weekendDays: read.has('weekendDays') ? read.numbers('weekendDays', 7).map(Math.round) : undefined,
          holidays
        }),
        isChronologyError
      )
    }

    case 'date.age':
      // The reference date is an argument rather than the system clock, so this answer is the same every run.
      return settle(ageAt({ birth: dateAt(read, 'birth'), on: dateAt(read, 'on') }), isChronologyError)

    case 'date.timeline': {
      const events: TimelineEvent[] = read.list('events', HUMANITIES_LIMITS.events).map((one, i) => {
        const entry = new Reader(one)
        return {
          label: entry.optionalText('label', '', 300) || `event ${i + 1}`,
          start: dateFrom(objectAt(entry, 'start')),
          end: entry.has('end') ? dateFrom(objectAt(entry, 'end')) : undefined,
          uncertaintyDays: entry.has('uncertaintyDays') ? entry.number('uncertaintyDays') : undefined
        }
      })
      const built = timeline({ events })
      if (isChronologyError(built)) return { ok: false, ...built }
      // Every pair was compared; only the list of pairs is thinned on the way out, since it grows as the square.
      const wanted = Math.max(1, Math.min(Math.round(read.optionalNumber('relations', 500)), HUMANITIES_LIMITS.relations))
      return { ok: true, ...built, relations: thin(built.relations, wanted), relationsTotal: built.relations.length }
    }

    case 'date.relations':
      return { ok: true, relations: ALLEN_RELATIONS, describe: ALLEN_DESCRIPTIONS }

    // ---------------------------------------------------------------- text
    case 'text.stats':
      return settle(
        textStats({ text: read.text('text', 200_000), topWords: Math.round(read.optionalNumber('topWords', 20)) }),
        isLinguisticsError
      )

    case 'text.syllables': {
      const words = read.strings('words', HUMANITIES_LIMITS.words)
      return {
        ok: true,
        words: words.map((word) => ({ word, syllables: syllablesIn(word) })),
        total: words.reduce((sum, one) => sum + syllablesIn(one), 0),
        note: 'Estimated by rule, about 85-90% accurate. Spelling does not determine syllables, so no rule can do better without a pronunciation dictionary.'
      }
    }

    case 'text.readability': {
      const built = readability({ text: read.text('text', 200_000) })
      if (isLinguisticsError(built)) return { ok: false, ...built }
      // The frequency list is the only long part of the statistics; the scores are all short.
      const wanted = Math.max(0, Math.min(Math.round(read.optionalNumber('topWords', 20)), 500))
      return { ok: true, ...built, stats: { ...built.stats, frequencies: built.stats.frequencies.slice(0, wanted) } }
    }

    case 'text.formulas':
      return { ok: true, formulas: READABILITY_FORMULAS, facts: READABILITY_FACTS }

    case 'text.distance': {
      const built = stringDistance({ first: read.text('first', 2000), second: read.text('second', 2000) })
      if (isLinguisticsError(built)) return { ok: false, ...built }
      const wanted = Math.max(0, Math.min(Math.round(read.optionalNumber('operations', 500)), 4000))
      return { ok: true, ...built, operations: built.operations.slice(0, wanted), operationsTotal: built.operations.length }
    }

    case 'text.phonetic':
      return settle(phoneticKey({ word: read.text('word', 200) }), isLinguisticsError)

    case 'text.overlap': {
      const built = vocabularyOverlap({
        first: read.text('first', 200_000),
        second: read.text('second', 200_000),
        ignore: read.has('ignore') ? read.strings('ignore', 2000) : undefined
      })
      if (isLinguisticsError(built)) return { ok: false, ...built }
      const wanted = Math.max(0, Math.min(Math.round(read.optionalNumber('listLength', 200)), 5000))
      return {
        ok: true,
        ...built,
        sharedWords: built.sharedWords.slice(0, wanted),
        onlyInFirst: built.onlyInFirst.slice(0, wanted),
        onlyInSecond: built.onlyInSecond.slice(0, wanted),
        sharedTotal: built.sharedWords.length
      }
    }

    // ---------------------------------------------------------------- references
    case 'cite.format':
      return settle(
        formatReference({
          reference: referenceFrom(objectAt(read, 'reference')),
          style: choice<CitationStyle>(read, 'style', CITATION_STYLES, 'apa'),
          page: read.optionalText('page', '', 64) || undefined,
          number: read.has('number') ? Math.round(read.number('number')) : undefined
        }),
        isCitationError
      )

    case 'cite.styles':
      return { ok: true, styles: CITATION_STYLES, facts: STYLE_FACTS, sourceKinds: SOURCE_KINDS }

    case 'cite.bibliography':
      return settle(
        bibliography({
          references: read.list('references', HUMANITIES_LIMITS.references).map((one) => referenceFrom(new Reader(one))),
          style: choice<CitationStyle>(read, 'style', CITATION_STYLES, 'apa')
        }),
        isCitationError
      )

    case 'cite.identifier':
      return settle(checkIdentifier({ identifier: read.text('identifier', 500) }), isCitationError)

    // ---------------------------------------------------------------- social measurement
    case 'measure.reliability':
      return settle(
        scaleReliability({
          responses: numberMatrix(read, 'responses', HUMANITIES_LIMITS.respondents, HUMANITIES_LIMITS.items)
        }),
        isMeasureError
      )

    case 'measure.agreement': {
      const ratings = read.list('ratings', HUMANITIES_LIMITS.respondents).map((one) => {
        const entry = new Reader(one)
        return { first: entry.text('first', 200), second: entry.text('second', 200) }
      })
      return settle(
        raterAgreement({
          ratings,
          // Given in order, weighted kappa becomes available. Left out, every disagreement counts the same, which
          // is right for unordered labels and wrong for a Likert scale.
          orderedCategories: read.has('orderedCategories')
            ? read.strings('orderedCategories', HUMANITIES_LIMITS.categories)
            : undefined
        }),
        isMeasureError
      )
    }

    case 'measure.panel-agreement':
      return settle(
        fleissKappa({
          counts: numberMatrix(read, 'counts', HUMANITIES_LIMITS.respondents, HUMANITIES_LIMITS.categories),
          categories: read.has('categories') ? read.strings('categories', HUMANITIES_LIMITS.categories) : undefined
        }),
        isMeasureError
      )

    case 'measure.inequality': {
      const built = inequality({
        values: read.numbers('values', HUMANITIES_LIMITS.values),
        weights: read.has('weights') ? read.numbers('weights', HUMANITIES_LIMITS.values) : undefined
      })
      if (isMeasureError(built)) return { ok: false, ...built }
      const wanted = Math.max(2, Math.min(Math.round(read.optionalNumber('curvePoints', 400)), 4000))
      return { ok: true, ...built, lorenz: thin(built.lorenz, wanted) }
    }

    case 'measure.effect-size': {
      // Which arguments an effect size needs depends on the measure — two means and two spreads, or a table — so
      // the numeric set is read as a group.
      const numbers = optionalGroup(read, ['meanA', 'meanB', 'sdA', 'sdB', 'nA', 'nB'])
      return settle(
        effectSize({
          measure: choice<EffectMeasure>(read, 'measure', EFFECT_MEASURES, 'cohens-d'),
          ...numbers,
          table: read.has('table') ? numberMatrix(read, 'table', 200, 200) : undefined
        }),
        isMeasureError
      )
    }

    case 'measure.effect-measures':
      return { ok: true, measures: EFFECT_MEASURES, facts: EFFECT_FACTS }

    // ---------------------------------------------------------------- provenance
    case 'humanities.assumptions':
      return {
        ok: true,
        chronology: CHRONOLOGY_ASSUMPTIONS,
        linguistics: LINGUISTICS_ASSUMPTIONS,
        citations: CITATION_ASSUMPTIONS,
        measurement: MEASURE_ASSUMPTIONS
      }

    default:
      throw new BadInput(`"${operation}" is not a humanities operation.`)
  }
}
