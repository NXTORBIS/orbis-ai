import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addColumn,
  aggregateCells,
  asNumber,
  asText,
  buildTable,
  columnById,
  columnValues,
  DATA_ASSUMPTIONS,
  DATA_LIMITS,
  detectDelimiter,
  detectHeader,
  dropColumn,
  emptyTable,
  filterTable,
  groupBy,
  groupsToTable,
  hasValue,
  inferColumnType,
  invalid,
  isDataError,
  isInvalid,
  isMissing,
  joinTables,
  MISSING,
  numericColumn,
  parseDelimited,
  profileColumn,
  profileTable,
  readCell,
  readDate,
  readNumber,
  renameColumn,
  retypeColumn,
  selectColumns,
  sortTable,
  splitDelimitedLine,
  toDelimited,
  type ColumnProfile,
  type DelimitedResult,
  type Group,
  type JoinResult,
  type Table
} from './data.ts'

const table = (value: Table | { error: string; message: string }): Table => {
  assert.equal(isDataError(value), false, `expected a table: ${JSON.stringify(value)}`)
  return value as Table
}

const parsed = (text: string, options = {}): DelimitedResult => {
  const result = parseDelimited(text, options)
  assert.equal(isDataError(result), false, `could not parse: ${JSON.stringify(result)}`)
  return result as DelimitedResult
}

/** A table's cells as plain text, for comparing shapes without caring about cell objects. */
const asGrid = (one: Table): string[][] => one.rows.map((row) => one.columns.map((_, c) => asText(row.cells[c] ?? MISSING)))

// ---------------------------------------------------------------- the four kinds of nothing

test('missing, null, invalid and zero are four different things', () => {
  assert.equal(hasValue(0), true, 'zero is a value')
  assert.equal(hasValue(''), true, 'an empty string is a value')
  assert.equal(hasValue(false), true, 'false is a value')
  assert.equal(hasValue(null), false)
  assert.equal(hasValue(MISSING), false)
  assert.equal(hasValue(invalid('abc', 'not a number')), false)
  // And each is distinguishable, which is what lets a profile count them apart.
  assert.equal(isMissing(MISSING), true)
  assert.equal(isMissing(null), false)
  assert.equal(isInvalid(invalid('x', 'why')), true)
})

test('a value that could not be read keeps what was actually there', () => {
  const cell = readCell('twelve', 'number')
  assert.equal(isInvalid(cell), true)
  assert.equal((cell as { raw: string }).raw, 'twelve')
  assert.match((cell as { why: string }).why, /not a number/)
  // So nothing is lost by being misunderstood, and a retype can recover it.
  assert.equal(asText(cell), 'twelve')
})

test('a cell never reads back as "null" or an object', () => {
  assert.equal(asText(null), '')
  assert.equal(asText(MISSING), '')
  assert.equal(asText(0), '0')
  assert.equal(asText(false), 'false')
  assert.equal(asNumber(true), 1)
  assert.equal(asNumber('12'), null, 'text is not silently coerced')
  assert.equal(asNumber(MISSING), null)
})

// ---------------------------------------------------------------- reading numbers and dates

test('a number is read from the forms people actually write', () => {
  assert.equal(readNumber('42'), 42)
  assert.equal(readNumber('-3.5'), -3.5)
  assert.equal(readNumber('.5'), 0.5)
  assert.equal(readNumber('1e-3'), 0.001)
  assert.equal(readNumber('1,234,567'), 1234567)
  assert.equal(readNumber('  7  '), 7)
  assert.equal(readNumber('50%'), 0.5)
})

test('an ambiguous number is refused rather than guessed at', () => {
  // `1,23` is a European decimal or a broken thousands separator, and choosing would be wrong half the time.
  assert.equal(readNumber('1,23'), null)
  assert.equal(readNumber('1,2345'), null)
  for (const bad of ['', 'abc', '12abc', '1.2.3', '--5', '1,234,56']) {
    assert.equal(readNumber(bad), null, `"${bad}" should not be a number`)
  }
})

test('a date is read only when it cannot be read two ways', () => {
  assert.equal(readDate('2026-03-15'), Date.parse('2026-03-15T00:00:00Z'))
  assert.equal(readDate('2026-03-15T10:30:00Z'), Date.parse('2026-03-15T10:30:00Z'))
  assert.notEqual(readDate('15 March 2026'), null)
  assert.notEqual(readDate('March 15, 2026'), null)
  // The one that means different days in different places.
  assert.equal(readDate('01/02/2026'), null)
  assert.equal(readDate('1.2.2026'), null)
  assert.equal(readDate('not a date'), null)
})

// ---------------------------------------------------------------- type inference

test('a type is only inferred when every value fits it', () => {
  assert.equal(inferColumnType(['1', '2', '3']).type, 'integer')
  assert.equal(inferColumnType(['1.5', '2', '3']).type, 'number')
  assert.equal(inferColumnType(['2026-01-01', '2026-02-01']).type, 'date')
  assert.equal(inferColumnType(['yes', 'no', 'yes']).type, 'boolean')
  // Eleven dates and one word is a text column, not eleven dates and a silent invalid.
  assert.equal(inferColumnType(['2026-01-01', '2026-02-01', 'unknown-ish']).type, 'text')
  assert.equal(inferColumnType(['1', '2', 'many']).type, 'text')
})

test('empty values do not stop a type being inferred', () => {
  assert.equal(inferColumnType(['1', '', '3', 'N/A', 'null']).type, 'integer')
  assert.equal(inferColumnType(['', '', '']).confidence, 'low')
})

test('a column of zeros and ones is numbers, because that is almost always what it means', () => {
  assert.equal(inferColumnType(['0', '1', '1', '0']).type, 'integer')
})

test('a small set of repeated labels is a category, and a column of unique text is not', () => {
  const few = inferColumnType(['red', 'green', 'red', 'blue', 'red', 'green'])
  assert.equal(few.type, 'category')
  assert.deepEqual(few.categories, ['red', 'green', 'blue'])
  const unique = inferColumnType(['a1', 'b2', 'c3', 'd4', 'e5', 'f6'])
  assert.equal(unique.type, 'text')
})

test('an inference says why, so a wrong guess can be argued with', () => {
  assert.match(inferColumnType(['1', '2']).reason, /whole number/)
  assert.match(inferColumnType(['01/02/2026', '03/04/2026']).reason, /read two ways/)
  assert.equal(inferColumnType(['01/02/2026', '03/04/2026']).confidence, 'low')
})

test('a number with a unit is recognised as a measurement', () => {
  const found = inferColumnType(['5 m', '7 m', '12 m'])
  assert.equal(found.type, 'quantity')
})

// ---------------------------------------------------------------- building

test('a table is built with stable row ids that survive sorting', () => {
  const built = table(buildTable(['name', 'score'], [['ana', '3'], ['ben', '1'], ['cal', '2']]))
  assert.deepEqual(built.rows.map((row) => row.id), [1, 2, 3])
  const ordered = table(sortTable(built, [{ columnId: 'score' }]))
  // The first thing anybody does is sort, which is why identity is never the position.
  assert.deepEqual(ordered.rows.map((row) => row.id), [2, 3, 1])
  assert.deepEqual(ordered.rows.map((row) => asText(row.cells[0])), ['ben', 'cal', 'ana'])
})

test('a duplicate header is numbered rather than overwritten, so no column disappears', () => {
  const built = table(buildTable(['value', 'value', 'value'], [['1', '2', '3']]))
  assert.equal(built.columns.length, 3)
  assert.deepEqual(built.columns.map((one) => one.id), ['value', 'value_2', 'value_3'])
})

test('a blank header still becomes a usable column', () => {
  const built = table(buildTable(['', 'b'], [['1', '2']]))
  assert.equal(built.columns[0].name, 'Column 1')
  assert.equal(built.columns[0].id, 'column_1')
})

test('a short row is filled rather than trimmed, so nothing shifts left', () => {
  const built = table(buildTable(['a', 'b', 'c'], [['1', '2', '3'], ['4']]))
  assert.equal(built.rows[1].cells.length, 3)
  assert.equal(isMissing(built.rows[1].cells[1]), true)
  assert.equal(asText(built.rows[1].cells[0]), '4')
})

test('a row longer than the header widens the table rather than losing the extra', () => {
  const built = table(buildTable(['a'], [['1', '2', '3']]))
  assert.equal(built.columns.length, 3)
  assert.equal(asText(built.rows[0].cells[2]), '3')
})

test('a unit written in a column heading is picked up', () => {
  const built = table(buildTable(['Temperature (°C)', 'Distance [km]'], [['20', '5']]))
  assert.equal(built.columns[0].type, 'quantity')
  assert.equal(built.columns[0].unit?.display, '°C')
  assert.equal(built.columns[1].unit?.display, 'km')
  assert.match(built.columns[0].reason, /column heading/)
})

test('a table with no columns or too much of anything is refused', () => {
  assert.equal((buildTable([], []) as { error: string }).error, 'no-columns')
  const wide = Array.from({ length: DATA_LIMITS.columns + 1 }, (_, i) => `c${i}`)
  assert.equal((buildTable(wide, []) as { error: string }).error, 'too-large')
})

// ---------------------------------------------------------------- CSV, properly

test('a quoted field containing the delimiter is one field', () => {
  // `split(',')` gets this wrong, and the failure is silent.
  assert.deepEqual(splitDelimitedLine('a,"b,c",d', ','), ['a', 'b,c', 'd'])
  assert.deepEqual(splitDelimitedLine('"one","two"', ','), ['one', 'two'])
})

test('a doubled quote inside a quoted field is one literal quote', () => {
  assert.deepEqual(splitDelimitedLine('a,"say ""hi""",b', ','), ['a', 'say "hi"', 'b'])
})

test('a newline inside a quoted field stays inside it', () => {
  const csv = 'name,note\nana,"first line\nsecond line"\nben,plain'
  const result = parsed(csv)
  assert.equal(result.table.rows.length, 2)
  assert.equal(asText(result.table.rows[0].cells[1]), 'first line\nsecond line')
  assert.equal(asText(result.table.rows[1].cells[0]), 'ben')
})

test('a byte-order mark does not become part of the first column name', () => {
  const result = parsed('﻿name,score\nana,3')
  assert.equal(result.table.columns[0].name, 'name')
})

test('both kinds of line ending work', () => {
  const windows = parsed('a,b\r\n1,2\r\n3,4')
  assert.equal(windows.table.rows.length, 2)
  assert.deepEqual(asGrid(windows.table), [['1', '2'], ['3', '4']])
})

test('trailing newlines are formatting, not rows', () => {
  assert.equal(parsed('a,b\n1,2\n').table.rows.length, 1)
  assert.equal(parsed('a,b\n1,2\n\n').table.rows.length, 1)
  assert.equal(parsed('a,b\n1,2\n\n\n\n').table.rows.length, 1, 'however many there are')
})

test('a blank line in the middle is kept as a row of blanks rather than silently dropped', () => {
  // Dropping it would change the row count of somebody's file without telling them.
  const result = parsed('a,b\n1,2\n\n3,4')
  assert.equal(result.table.rows.length, 3)
  assert.equal(isMissing(result.table.rows[1].cells[1]), true)
  assert.equal(asText(result.table.rows[2].cells[0]), '3')
})

test('the delimiter is chosen by consistency, not by how often it appears', () => {
  // Prose full of commas: plenty of commas, no consistency.
  const tabbed = 'name\tnote\nana\tone, two, three, four\nben\tfive, six, seven, eight'
  assert.equal(detectDelimiter(tabbed), '\t')
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',')
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';')
  assert.equal(detectDelimiter('a|b\n1|2'), '|')
})

test('the delimiter and the header are reported, because both are guesses', () => {
  const result = parsed('name,score\nana,3')
  assert.equal(result.delimiter, ',')
  assert.equal(result.headerRow, true)
  assert.ok(result.notes.some((one) => /consistent number of columns/.test(one)))
  assert.ok(result.notes.some((one) => /looks like headings/.test(one)))
})

test('a file whose first row is data keeps that row', () => {
  // Treating it as a header would lose a row, which is worse than a column called "1".
  assert.equal(detectHeader([['1', '2'], ['3', '4'], ['5', '6']]), false)
  const result = parsed('1,2\n3,4\n5,6')
  assert.equal(result.headerRow, false)
  assert.equal(result.table.rows.length, 3)
  assert.ok(result.notes.some((one) => /no row was lost/.test(one)))
})

test('a first row that repeats a value is data, not headings', () => {
  assert.equal(detectHeader([['a', 'a'], ['1', '2']]), false)
})

test('the header decision can be overridden', () => {
  const forced = parsed('1,2\n3,4', { header: true })
  assert.equal(forced.headerRow, true)
  assert.equal(forced.table.rows.length, 1)
  assert.ok(forced.notes.some((one) => /as asked/.test(one)))
})

test('an unclosed quote is reported rather than silently swallowing the file', () => {
  const result = parsed('a,b\n1,"unclosed')
  assert.ok(result.notes.some((one) => /never closed/.test(one)))
})

test('an empty file is a reason, not an empty table', () => {
  assert.equal((parseDelimited('') as { error: string }).error, 'no-rows')
  assert.equal((parseDelimited('   \n  ') as { error: string }).error, 'no-rows')
})

// ---------------------------------------------------------------- writing out

test('a table written out and read back is the same table', () => {
  const original = parsed('name,note,score\nana,"has, a comma",3\nben,"has ""quotes""",1').table
  const again = parsed(toDelimited(original)).table
  assert.deepEqual(asGrid(again), asGrid(original))
})

test('a value a spreadsheet would run is escaped on the way out', () => {
  // A cell beginning = opens as executable in every spreadsheet application.
  const built = table(buildTable(['formula'], [['=1+1'], ['+SUM(A1)'], ['-2'], ['@x'], ['plain']]))
  const csv = toDelimited(built)
  assert.match(csv, /'=1\+1/)
  assert.match(csv, /'\+SUM\(A1\)/)
  assert.match(csv, /'@x/)
  assert.ok(csv.includes('plain'), 'an ordinary value is untouched')
})

// ---------------------------------------------------------------- sorting

test('numbers sort numerically and text alphabetically', () => {
  const numbers = table(buildTable(['n'], [['10'], ['2'], ['33']]))
  assert.deepEqual(
    table(sortTable(numbers, [{ columnId: 'n' }])).rows.map((row) => asText(row.cells[0])),
    ['2', '10', '33']
  )
  const words = table(buildTable(['w'], [['banana'], ['apple'], ['cherry']]))
  assert.deepEqual(
    table(sortTable(words, [{ columnId: 'w' }])).rows.map((row) => asText(row.cells[0])),
    ['apple', 'banana', 'cherry']
  )
})

test('missing values sort last in both directions, because absent is not smallest', () => {
  const built = table(buildTable(['n'], [['5'], [''], ['1'], ['']]))
  const up = table(sortTable(built, [{ columnId: 'n' }]))
  const down = table(sortTable(built, [{ columnId: 'n', descending: true }]))
  assert.deepEqual(up.rows.map((row) => asText(row.cells[0])), ['1', '5', '', ''])
  // Burying them at the top of a descending sort would hide them.
  assert.deepEqual(down.rows.map((row) => asText(row.cells[0])), ['5', '1', '', ''])
})

test('sorting by two columns does what anybody would expect', () => {
  const built = table(
    buildTable(['team', 'score'], [['b', '2'], ['a', '2'], ['b', '1'], ['a', '1']])
  )
  const ordered = table(sortTable(built, [{ columnId: 'team' }, { columnId: 'score', descending: true }]))
  assert.deepEqual(asGrid(ordered), [['a', '2'], ['a', '1'], ['b', '2'], ['b', '1']])
})

test('sorting is stable, so equal rows keep their order', () => {
  const built = table(buildTable(['k', 'v'], [['x', '1'], ['x', '2'], ['x', '3']]))
  assert.deepEqual(
    table(sortTable(built, [{ columnId: 'k' }])).rows.map((row) => row.id),
    [1, 2, 3]
  )
})

test('sorting by a column that is not there is an error, not a no-op', () => {
  const built = table(buildTable(['a'], [['1']]))
  assert.equal((sortTable(built, [{ columnId: 'nope' }]) as { error: string }).error, 'unknown-column')
})

// ---------------------------------------------------------------- filtering

const people = (): Table =>
  table(
    buildTable(
      ['name', 'age', 'city', 'member'],
      [
        ['Ana', '34', 'Lisbon', 'yes'],
        ['Ben', '28', 'Berlin', 'no'],
        ['Cal', '45', 'Lisbon', 'yes'],
        ['Dee', '', 'Cairo', 'no'],
        ['Eve', '61', 'Berlin', 'yes']
      ]
    )
  )

test('a filter keeps the rows that match, with their ids intact', () => {
  const found = table(filterTable(people(), { match: 'all', conditions: [{ columnId: 'city', comparison: 'equals', value: 'Lisbon' }] }))
  assert.deepEqual(found.rows.map((row) => asText(row.cells[0])), ['Ana', 'Cal'])
  assert.deepEqual(found.rows.map((row) => row.id), [1, 3])
})

test('text comparisons ignore case unless asked not to', () => {
  const loose = table(filterTable(people(), { match: 'all', conditions: [{ columnId: 'city', comparison: 'equals', value: 'lisbon' }] }))
  assert.equal(loose.rows.length, 2)
  const strict = table(
    filterTable(people(), { match: 'all', conditions: [{ columnId: 'city', comparison: 'equals', value: 'lisbon', caseSensitive: true }] })
  )
  assert.equal(strict.rows.length, 0)
})

test('every comparison does what it says', () => {
  const only = (condition: Parameters<typeof filterTable>[1]['conditions'][0]): string[] =>
    table(filterTable(people(), { match: 'all', conditions: [condition] })).rows.map((row) => asText(row.cells[0]))
  assert.deepEqual(only({ columnId: 'age', comparison: 'greater', value: 40 }), ['Cal', 'Eve'])
  assert.deepEqual(only({ columnId: 'age', comparison: 'greater-or-equal', value: 45 }), ['Cal', 'Eve'])
  assert.deepEqual(only({ columnId: 'age', comparison: 'less', value: 30 }), ['Ben'])
  assert.deepEqual(only({ columnId: 'age', comparison: 'between', value: 30, value2: 50 }), ['Ana', 'Cal'])
  assert.deepEqual(only({ columnId: 'age', comparison: 'between', value: 50, value2: 30 }), ['Ana', 'Cal'], 'the bounds work either way round')
  assert.deepEqual(only({ columnId: 'name', comparison: 'starts-with', value: 'A' }), ['Ana'])
  assert.deepEqual(only({ columnId: 'name', comparison: 'ends-with', value: 'e' }), ['Dee', 'Eve'])
  assert.deepEqual(only({ columnId: 'city', comparison: 'contains', value: 'erl' }), ['Ben', 'Eve'])
  assert.deepEqual(only({ columnId: 'age', comparison: 'is-empty' }), ['Dee'])
  assert.deepEqual(only({ columnId: 'age', comparison: 'is-not-empty' }), ['Ana', 'Ben', 'Cal', 'Eve'])
  assert.deepEqual(only({ columnId: 'city', comparison: 'is-one-of', values: ['Cairo', 'Berlin'] }), ['Ben', 'Dee', 'Eve'])
  assert.deepEqual(only({ columnId: 'member', comparison: 'equals', value: true }), ['Ana', 'Cal', 'Eve'])
  assert.deepEqual(only({ columnId: 'city', comparison: 'not-equals', value: 'Lisbon' }), ['Ben', 'Dee', 'Eve'])
})

test('a row with no value never satisfies a comparison about one', () => {
  // Dee has no age, so she is not greater than, less than, or equal to anything.
  for (const comparison of ['greater', 'less', 'equals', 'between'] as const) {
    const found = table(
      filterTable(people(), { match: 'all', conditions: [{ columnId: 'age', comparison, value: 0, value2: 999 }] })
    )
    assert.equal(found.rows.some((row) => asText(row.cells[0]) === 'Dee'), false, comparison)
  }
})

test('any and all mean what they say, and groups nest', () => {
  const any = table(
    filterTable(people(), {
      match: 'any',
      conditions: [
        { columnId: 'city', comparison: 'equals', value: 'Cairo' },
        { columnId: 'age', comparison: 'greater', value: 60 }
      ]
    })
  )
  assert.deepEqual(any.rows.map((row) => asText(row.cells[0])), ['Dee', 'Eve'])

  // member = yes AND (city = Lisbon OR age > 60)
  const nested = table(
    filterTable(people(), {
      match: 'all',
      conditions: [{ columnId: 'member', comparison: 'equals', value: true }],
      groups: [
        {
          match: 'any',
          conditions: [
            { columnId: 'city', comparison: 'equals', value: 'Lisbon' },
            { columnId: 'age', comparison: 'greater', value: 60 }
          ]
        }
      ]
    })
  )
  assert.deepEqual(nested.rows.map((row) => asText(row.cells[0])), ['Ana', 'Cal', 'Eve'])
})

test('an empty filter keeps everything rather than nothing', () => {
  assert.equal(table(filterTable(people(), { match: 'all', conditions: [] })).rows.length, 5)
})

// ---------------------------------------------------------------- columns

test('columns can be selected, dropped and reordered', () => {
  const picked = table(selectColumns(people(), ['city', 'name']))
  assert.deepEqual(picked.columns.map((one) => one.id), ['city', 'name'])
  assert.deepEqual(asGrid(picked)[0], ['Lisbon', 'Ana'])
  assert.deepEqual(table(dropColumn(people(), 'age')).columns.map((one) => one.id), ['name', 'city', 'member'])
  assert.equal((selectColumns(people(), ['nope']) as { error: string }).error, 'unknown-column')
})

test('renaming a column changes its name and not its id', () => {
  // A saved filter or a derived column refers to the id, and renaming must not break them.
  const renamed = table(renameColumn(people(), 'name', 'Full name'))
  assert.equal(renamed.columns[0].name, 'Full name')
  assert.equal(renamed.columns[0].id, 'name')
  assert.equal((renameColumn(people(), 'name', '   ') as { error: string }).error, 'invalid-argument')
})

test('retyping a column reads from the original text, so a round trip loses nothing', () => {
  const built = table(buildTable(['n'], [['1'], ['2'], ['three']]))
  assert.equal(built.columns[0].type, 'text', 'one unreadable value keeps the whole column as text')
  const asNumbers = table(retypeColumn(built, 'n', 'number'))
  assert.equal(asNumber(asNumbers.rows[0].cells[0]), 1)
  assert.equal(isInvalid(asNumbers.rows[2].cells[0]), true)
  // And back, recovering the text that was there all along.
  const backToText = table(retypeColumn(asNumbers, 'n', 'text'))
  assert.equal(asText(backToText.rows[2].cells[0]), 'three')
})

test('retyping to a quantity attaches the unit', () => {
  const built = table(buildTable(['d'], [['5'], ['10']]))
  const asQuantity = table(retypeColumn(built, 'd', 'quantity', 'km'))
  assert.equal(asQuantity.columns[0].unit?.display, 'km')
  assert.equal(asText(asQuantity.rows[0].cells[0]), '5 km')
  assert.equal((retypeColumn(built, 'd', 'quantity', 'nonsense-unit') as { error: string }).error, 'invalid-argument')
})

test('a derived column is added without disturbing the rest', () => {
  const built = people()
  const withDouble = table(
    addColumn(
      built,
      { id: 'double_age', sourceName: '', name: 'Double age', type: 'number', unit: null, confidence: 'given', reason: 'Worked out.' },
      (row) => {
        const age = asNumber(row.cells[1])
        return age === null ? MISSING : age * 2
      }
    )
  )
  assert.equal(withDouble.columns.length, 5)
  assert.equal(asNumber(withDouble.rows[0].cells[4]), 68)
  assert.equal(isMissing(withDouble.rows[3].cells[4]), true, 'no age means no doubled age, not zero')
  // A duplicate id is refused.
  assert.equal(
    (addColumn(withDouble, { id: 'name', sourceName: '', name: 'x', type: 'text', unit: null, confidence: 'given', reason: '' }, () => null) as { error: string }).error,
    'invalid-argument'
  )
})

// ---------------------------------------------------------------- grouping

test('grouping gathers rows and works out the aggregates asked for', () => {
  const groups = groupBy(people(), ['city'], [
    { columnId: 'age', aggregate: 'mean', as: 'average age' },
    { columnId: 'name', aggregate: 'count', as: 'people' }
  ]) as Group[]
  assert.equal(isDataError(groups), false)
  const byCity = new Map(groups.map((group) => [group.keyText[0], group]))
  assert.equal(byCity.get('Lisbon')?.values['people'], 2)
  assert.equal(asNumber(byCity.get('Lisbon')?.values['average age'] ?? MISSING), 39.5)
  assert.equal(byCity.get('Cairo')?.values['people'], 1)
})

test('count and count-values differ exactly when data is missing, which is when it matters', () => {
  const groups = groupBy(people(), ['member'], [
    { columnId: 'age', aggregate: 'count', as: 'rows' },
    { columnId: 'age', aggregate: 'count-values', as: 'ages known' }
  ]) as Group[]
  const no = groups.find((group) => group.keyText[0] === 'false')!
  assert.equal(no.values['rows'], 2)
  assert.equal(no.values['ages known'], 1)
})

test('every aggregate gives the right answer', () => {
  const cells = [1, 2, 2, 5, null, MISSING]
  assert.equal(aggregateCells(cells, 'count'), 6)
  assert.equal(aggregateCells(cells, 'count-values'), 4)
  assert.equal(aggregateCells(cells, 'count-distinct'), 3)
  assert.equal(aggregateCells(cells, 'sum'), 10)
  assert.equal(aggregateCells(cells, 'mean'), 2.5)
  assert.equal(aggregateCells(cells, 'median'), 2)
  assert.equal(aggregateCells(cells, 'minimum'), 1)
  assert.equal(aggregateCells(cells, 'maximum'), 5)
  assert.equal(aggregateCells(cells, 'first'), 1)
  assert.equal(aggregateCells(cells, 'last'), 5)
  // Nothing to aggregate is missing, not zero.
  assert.equal(isMissing(aggregateCells([null, MISSING], 'sum')), true)
  assert.equal(aggregateCells([null, MISSING], 'count'), 2)
})

test('a quantity column keeps its unit through a sum and a mean', () => {
  const built = table(buildTable(['Distance (km)'], [['5'], ['10'], ['15']]))
  const cells = columnValues(built, 'distance_km') as import('./data.ts').Cell[]
  const total = aggregateCells(cells, 'sum', built.columns[0])
  assert.equal(asText(total), '30 km')
  assert.equal(asText(aggregateCells(cells, 'mean', built.columns[0])), '10 km')
})

test('grouping by a column with missing values keeps them as their own group', () => {
  const groups = groupBy(people(), ['age'], []) as Group[]
  // Five distinct ages including the blank one, which is a group rather than being dropped.
  assert.equal(groups.length, 5)
  assert.ok(groups.some((group) => group.keyText[0] === ''))
})

test('groups become a table that can be sorted and exported like any other', () => {
  const built = people()
  const groups = groupBy(built, ['city'], [{ columnId: 'name', aggregate: 'count', as: 'people' }]) as Group[]
  const asTable = groupsToTable(groups, [columnById(built, 'city')!], 'grouped')
  assert.equal(asTable.columns.length, 2)
  const ordered = table(sortTable(asTable, [{ columnId: 'city' }]))
  assert.deepEqual(ordered.rows.map((row) => asText(row.cells[0])), ['Berlin', 'Cairo', 'Lisbon'])
})

test('grouping needs a column, and an unknown one is an error', () => {
  assert.equal((groupBy(people(), []) as { error: string }).error, 'invalid-argument')
  assert.equal((groupBy(people(), ['nope']) as { error: string }).error, 'unknown-column')
})

// ---------------------------------------------------------------- joining

const orders = (): Table =>
  table(buildTable(['customer', 'total'], [['Ana', '20'], ['Ben', '35'], ['Ana', '15'], ['Zoe', '99']]))

const customers = (): Table =>
  table(buildTable(['customer', 'city'], [['Ana', 'Lisbon'], ['Ben', 'Berlin'], ['Cal', 'Cairo']]))

test('an inner join keeps only the rows that found a partner, and says how many did not', () => {
  const result = joinTables(orders(), customers(), 'customer', 'customer', 'inner') as JoinResult
  assert.equal(isDataError(result), false)
  assert.equal(result.table.rows.length, 3, 'Zoe has no customer record')
  assert.equal(result.unmatchedLeft, 1)
  assert.ok(result.notes.some((one) => /found no partner/.test(one)))
  // The right key column is not duplicated.
  assert.deepEqual(result.table.columns.map((one) => one.id), ['customer', 'total', 'city'])
})

test('a left join keeps every left row and leaves the rest missing', () => {
  const result = joinTables(orders(), customers(), 'customer', 'customer', 'left') as JoinResult
  assert.equal(result.table.rows.length, 4)
  const zoe = result.table.rows.find((row) => asText(row.cells[0]) === 'Zoe')!
  assert.equal(isMissing(zoe.cells[2]), true, 'no city, not an empty string')
})

test('a full join keeps the unmatched rows from both sides', () => {
  const result = joinTables(orders(), customers(), 'customer', 'customer', 'full') as JoinResult
  // Ana twice, Ben once, Zoe with no customer, Cal with no order.
  assert.equal(result.table.rows.length, 5)
  assert.equal(result.unmatchedRight, 1)
})

test('a duplicate key is reported, because it is how a join silently multiplies rows', () => {
  const result = joinTables(customers(), orders(), 'customer', 'customer', 'inner') as JoinResult
  assert.ok(result.duplicateKeys.includes('Ana'))
  assert.ok(result.notes.some((one) => /appears more than once/.test(one)))
  assert.equal(result.table.rows.length, 3, 'Ana appears twice because she has two orders')
})

test('a row with no key cannot be joined on it, and two blanks are not a pair', () => {
  const left = table(buildTable(['k', 'a'], [['x', '1'], ['', '2']]))
  const right = table(buildTable(['k', 'b'], [['x', '9'], ['', '8']]))
  const result = joinTables(left, right, 'k', 'k', 'inner') as JoinResult
  assert.equal(result.table.rows.length, 1)
  assert.equal(asText(result.table.rows[0].cells[0]), 'x')
})

test('a clash of column names between the two sides is renamed rather than overwritten', () => {
  const left = table(buildTable(['k', 'value'], [['x', '1']]))
  const right = table(buildTable(['k', 'value'], [['x', '2']]))
  const result = joinTables(left, right, 'k', 'k', 'inner') as JoinResult
  assert.deepEqual(result.table.columns.map((one) => one.id), ['k', 'value', 'value_2'])
  assert.equal(asText(result.table.rows[0].cells[1]), '1')
  assert.equal(asText(result.table.rows[0].cells[2]), '2')
})

test('joining on a column that is not there is an error', () => {
  assert.equal((joinTables(orders(), customers(), 'nope', 'customer') as { error: string }).error, 'unknown-column')
  assert.equal((joinTables(orders(), customers(), 'customer', 'nope') as { error: string }).error, 'unknown-column')
})

// ---------------------------------------------------------------- profiling

test('a column profile counts what is there and what is not, separately', () => {
  const built = table(buildTable(['n'], [['1'], [''], ['2'], ['oops'], ['2']]))
  const asNumbers = table(retypeColumn(built, 'n', 'number'))
  const profile = profileColumn(asNumbers, 'n') as ColumnProfile
  assert.equal(profile.count, 5)
  assert.equal(profile.present, 3)
  assert.equal(profile.empty, 2)
  assert.equal(profile.invalid, 1)
  assert.equal(profile.distinct, 2)
  assert.equal(profile.statistics?.mean, 5 / 3)
})

test('a profile warns about the things somebody would otherwise analyse without noticing', () => {
  const constant = table(buildTable(['x'], [['5'], ['5'], ['5']]))
  assert.ok((profileColumn(constant, 'x') as ColumnProfile).warnings.some((one) => /Every value in this column is the same/.test(one)))

  const mostlyEmpty = table(buildTable(['x'], [['1'], [''], [''], [''], ['']]))
  assert.ok((profileColumn(mostlyEmpty, 'x') as ColumnProfile).warnings.some((one) => /% of this column is empty/.test(one)))

  const allEmpty = table(buildTable(['x'], [[''], ['']]))
  assert.ok((profileColumn(allEmpty, 'x') as ColumnProfile).warnings.some((one) => /Every value in this column is empty/.test(one)))

  const withInvalid = table(retypeColumn(table(buildTable(['x'], [['1'], ['two']])), 'x', 'number'))
  assert.ok((profileColumn(withInvalid, 'x') as ColumnProfile).warnings.some((one) => /could not be read/.test(one)))
})

test('a column of unique labels is flagged as an identifier rather than something to group by', () => {
  const ids = table(buildTable(['id'], Array.from({ length: 25 }, (_, i) => [`ref-${i}`])))
  assert.ok((profileColumn(ids, 'id') as ColumnProfile).warnings.some((one) => /identifier/.test(one)))
})

test('a table profile flags duplicate rows and never removes them', () => {
  const built = table(buildTable(['a', 'b'], [['1', '2'], ['3', '4'], ['1', '2']]))
  const profile = profileTable(built)
  assert.deepEqual(profile.duplicateRows, [3])
  assert.ok(profile.warnings.some((one) => /flagged, not removed/.test(one)))
  assert.equal(built.rows.length, 3, 'the table is untouched')
})

test('the commonest values are reported for a column where that means something', () => {
  const built = table(buildTable(['city'], [['Lisbon'], ['Berlin'], ['Lisbon'], ['Cairo'], ['Lisbon']]))
  const profile = profileColumn(built, 'city') as ColumnProfile
  assert.equal(profile.common[0].value, 'Lisbon')
  assert.equal(profile.common[0].count, 3)
  // And not for a column of continuous numbers, where a "commonest value" says nothing.
  const numbers = table(buildTable(['x'], [['1.1'], ['2.2'], ['3.3']]))
  assert.deepEqual((profileColumn(numbers, 'x') as ColumnProfile).common, [])
})

// ---------------------------------------------------------------- immutability

test('every operation returns a new table and leaves the old one alone', () => {
  const original = people()
  const before = asGrid(original)
  sortTable(original, [{ columnId: 'age' }])
  filterTable(original, { match: 'all', conditions: [{ columnId: 'age', comparison: 'greater', value: 30 }] })
  dropColumn(original, 'age')
  retypeColumn(original, 'age', 'text')
  assert.deepEqual(asGrid(original), before)
  /*
   * Frozen and unchanged, which is the invariant, with the write itself allowed to throw or not.
   *
   * It used to assume the write would be silently dropped, on the grounds that these files ran as CommonJS in sloppy
   * mode. They now run as modules, where the same write throws -- so the test failed on an object that was correctly
   * frozen. Either behaviour is the engine's business; what matters is that the value did not change.
   */
  assert.ok(Object.isFrozen(original))
  try {
    ;(original as { rows: unknown }).rows = []
  } catch {
    // Strict mode refuses the write outright, which is the invariant holding more loudly.
  }
  assert.deepEqual(asGrid(original), before, 'the table was editable in place')
})

test('numeric access skips what is not a number rather than turning it into one', () => {
  const built = table(retypeColumn(table(buildTable(['n'], [['1'], ['x'], ['3'], ['']])), 'n', 'number'))
  assert.deepEqual(numericColumn(built, 'n'), [1, 3])
  assert.equal((numericColumn(built, 'nope') as { error: string }).error, 'unknown-column')
})

test('an empty table is a real table', () => {
  const nothing = emptyTable('test')
  assert.equal(nothing.columns.length, 0)
  assert.equal(nothing.rows.length, 0)
  assert.equal(nothing.source, 'test')
  assert.deepEqual(profileTable(nothing).warnings, ['This table has no rows.'])
})

test('the promises this engine makes are the ones the code keeps', () => {
  const all = DATA_ASSUMPTIONS.join(' ')
  assert.match(all, /never zero/)
  assert.match(all, /keeps its original text/)
  assert.match(all, /01\/02\/2026/)
  assert.match(all, /survives sorting/)
  assert.match(all, /flagged, never removed/)
  assert.match(all, /cannot run/)
})
