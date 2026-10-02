/**
 * Tables, columns, and the operations Pages perform on them.
 *
 * The shared structured-data engine. A Page that wants to import a file, sort it, filter it, group it, derive a column and
 * summarise it should not have to write any of that, and above all should not have to write a CSV parser -- because
 * `split(',')` is not one, and the day somebody's data has a comma inside a quoted field is the day the Page starts quietly
 * reading the wrong column.
 *
 * ## What this file will not do
 *
 * ```
 * missing    is never       zero
 * ""         is never       missing
 * invalid    is never       silently dropped
 * a guess    is never       presented as a reading
 * ```
 *
 * Type inference reports its confidence, and an ambiguous column stays text rather than becoming a date that is right for
 * eleven rows and wrong for the twelfth. A cell that could not be read keeps what was actually there, so nothing is lost by
 * being misunderstood.
 *
 * Row identity is assigned on import and never derived from position, because the first thing anybody does is sort.
 *
 * Pure. No network, no clock, no storage. Uses `statistics.ts` for every number it reports and `units.ts` for quantities.
 */

import { isStatisticsError, summarise, type Summary } from './statistics.ts'
import { formatQuantity, isQuantityError, parseUnit, quantity, type Quantity, type ResolvedUnit } from './units.ts'

// ---------------------------------------------------------------- cells

/**
 * What a cell holds.
 *
 * Four ways of having nothing, and they are not interchangeable:
 *
 * - `null` -- the source said "no value here" explicitly.
 * - `missing` -- there was no cell at all, because the row was short.
 * - `invalid` -- there was something, and it was not what the column holds. The original text is kept.
 * - `0` / `''` -- a value. Not nothing.
 */
export type Cell = number | string | boolean | null | CellMissing | CellInvalid | Quantity

export interface CellMissing {
  readonly kind: 'missing'
}

export interface CellInvalid {
  readonly kind: 'invalid'
  /** What was actually there. Kept so nothing is lost by being misunderstood. */
  readonly raw: string
  readonly why: string
}

export const MISSING: CellMissing = Object.freeze({ kind: 'missing' })

export const invalid = (raw: string, why: string): CellInvalid => Object.freeze({ kind: 'invalid', raw: String(raw).slice(0, 200), why })

export const isMissing = (cell: Cell): cell is CellMissing =>
  typeof cell === 'object' && cell !== null && (cell as { kind?: string }).kind === 'missing'

export const isInvalid = (cell: Cell): cell is CellInvalid =>
  typeof cell === 'object' && cell !== null && (cell as { kind?: string }).kind === 'invalid'

export const isQuantityCell = (cell: Cell): cell is Quantity =>
  typeof cell === 'object' && cell !== null && 'unit' in (cell as object) && 'value' in (cell as object)

/** Whether a cell holds anything at all. `0`, `false` and `''` do; the three kinds of nothing do not. */
export const hasValue = (cell: Cell): boolean => cell !== null && !isMissing(cell) && !isInvalid(cell)

/** A cell as a number, or null when it is not one. The single place numeric coercion happens. */
export function asNumber(cell: Cell): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null
  if (typeof cell === 'boolean') return cell ? 1 : 0
  if (isQuantityCell(cell)) return Number.isFinite(cell.value) ? cell.value : null
  return null
}

/** A cell as text, for display and for sorting strings. Never `"null"` or `"[object Object]"`. */
export function asText(cell: Cell): string {
  if (cell === null) return ''
  if (isMissing(cell)) return ''
  if (isInvalid(cell)) return cell.raw
  if (isQuantityCell(cell)) return formatQuantity(cell)
  if (typeof cell === 'boolean') return cell ? 'true' : 'false'
  return String(cell)
}

/**
 * A date, written back as a date.
 *
 * Dates are held as milliseconds since the epoch so they sort and subtract. Written out, that number is a value nobody
 * typed and nobody can read: `2026-10-01` has to leave as `2026-10-01`. A date with no time of day leaves as the date
 * alone; one that had a time leaves in the full ISO form, in UTC, which is how `readDate` read it.
 */
export function formatDate(ms: number): string {
  const iso = new Date(ms).toISOString()
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso
}

/**
 * A cell as text for writing out, knowing which column it is in.
 *
 * `asText` on its own cannot tell a date from a count, because both are numbers in a cell. The column can. This is the
 * only way a date leaves a table as a date, and every writer goes through it.
 */
export function cellOut(cell: Cell, column: Pick<Column, 'type'>): string {
  if (column.type === 'date' && typeof cell === 'number' && Number.isFinite(cell)) return formatDate(cell)
  return asText(cell)
}

// ---------------------------------------------------------------- columns

export type ColumnType = 'text' | 'number' | 'integer' | 'boolean' | 'date' | 'category' | 'quantity'

export interface Column {
  id: string
  /** As it appeared in the source, so a header nobody expected is still recognisable. */
  sourceName: string
  name: string
  type: ColumnType
  /** For a quantity column: what its numbers are measured in. */
  unit: ResolvedUnit | null
  /** How sure the inference was. `given` means a caller said so and nothing was inferred. */
  confidence: 'given' | 'high' | 'medium' | 'low'
  /** Why this type rather than another, so a wrong guess can be argued with. */
  reason: string
  /** For a category column: the distinct values, in first-seen order. */
  categories: string[]
}

/** A stable identifier for a row. Assigned on import; never the position, because the first thing anybody does is sort. */
export type RowId = number

export interface Row {
  readonly id: RowId
  readonly cells: readonly Cell[]
}

export interface Table {
  readonly columns: readonly Column[]
  readonly rows: readonly Row[]
  /** Where it came from, for provenance. */
  readonly source: string
  /** The next id to hand out, so a row added later cannot collide with one removed earlier. */
  readonly nextId: RowId
}

export interface DataError {
  error: 'no-columns' | 'no-rows' | 'unknown-column' | 'wrong-type' | 'invalid-argument' | 'too-large' | 'parse'
  message: string
}

export const isDataError = (value: unknown): value is DataError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

/** Limits, so an imported file cannot make the application unresponsive. */
export const DATA_LIMITS = Object.freeze({
  rows: 200_000,
  columns: 512,
  cellLength: 32_000,
  /** The most distinct values a column may have before it stops being a category. */
  categories: 64,
  /** How many rows type inference looks at. Enough to be right; bounded so a huge file is still fast. */
  sample: 2000
})

export const emptyTable = (source = ''): Table => Object.freeze({ columns: [], rows: [], source, nextId: 1 })

/** A column by id, without the prototype chain answering for a name nobody defined. */
export const columnById = (table: Table, id: string): Column | null => table.columns.find((one) => one.id === id) ?? null

export const columnIndex = (table: Table, id: string): number => table.columns.findIndex((one) => one.id === id)

/** Every value in one column, in row order. */
export function columnValues(table: Table, id: string): Cell[] | DataError {
  const at = columnIndex(table, id)
  if (at < 0) return { error: 'unknown-column', message: `There is no column called "${id}".` }
  return table.rows.map((row) => row.cells[at] ?? MISSING)
}

/** Every numeric value in one column, with the non-numbers left out. What every statistic here is computed from. */
export function numericColumn(table: Table, id: string): number[] | DataError {
  const values = columnValues(table, id)
  if (isDataError(values)) return values
  const out: number[] = []
  for (const cell of values) {
    const value = asNumber(cell)
    if (value !== null) out.push(value)
  }
  return out
}

// ---------------------------------------------------------------- reading a cell

const TRUE_WORDS = new Set(['true', 'yes', 'y', 't', '1', 'on'])
const FALSE_WORDS = new Set(['false', 'no', 'n', 'f', '0', 'off'])
/** Spellings of "there is no value". `0` is deliberately not one of them. */
const NULL_WORDS = new Set(['', 'na', 'n/a', 'null', 'nil', 'none', 'nan', '-', '--', '?'])

/**
 * A number from text, without the guesses that go wrong.
 *
 * Accepts a leading sign, a decimal point, scientific notation, thousands separators that are commas *and* consistent, and
 * a trailing percent. Refuses anything ambiguous -- `1,23` could be a European decimal or a broken thousands separator, and
 * choosing would be choosing wrong half the time.
 */
export function readNumber(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  // A percent is a number divided by a hundred, which is what `units.ts` says too.
  const percent = trimmed.endsWith('%')
  const body = percent ? trimmed.slice(0, -1).trim() : trimmed
  // Thousands separators, only in the grouping that actually means thousands.
  const grouped = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(body)
  const plain = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(body)
  if (!grouped && !plain) return null
  const value = Number(grouped ? body.replace(/,/g, '') : body)
  if (!Number.isFinite(value)) return null
  return percent ? value / 100 : value
}

/**
 * A date from text, only in the formats that cannot be read two ways.
 *
 * ISO, and a month name written out. `01/02/2026` is deliberately refused: it is the first of February in most of the
 * world and the second of January in one country, and a parser that picks is a parser that is confidently wrong for
 * somebody. The column stays text and the caller can say which they meant.
 *
 * Returns milliseconds since the epoch, in UTC where the text does not say otherwise.
 */
export function readDate(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  // ISO date, with an optional time and zone.
  if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(trimmed)) {
    const value = Date.parse(trimmed.includes('T') || trimmed.includes(' ') ? trimmed : `${trimmed}T00:00:00Z`)
    return Number.isFinite(value) ? value : null
  }
  // A written month, which cannot be read two ways.
  if (/^\d{1,2} [A-Za-z]{3,9} \d{4}$/.test(trimmed) || /^[A-Za-z]{3,9} \d{1,2},? \d{4}$/.test(trimmed)) {
    const value = Date.parse(`${trimmed} UTC`)
    return Number.isFinite(value) ? value : null
  }
  return null
}

/** A cell read as a given type. Never throws; an unreadable value becomes `invalid` and keeps its text. */
export function readCell(raw: string, type: ColumnType, unit: ResolvedUnit | null = null): Cell {
  const text = String(raw ?? '')
  if (text.length > DATA_LIMITS.cellLength) return invalid(text, 'That value is too long to hold.')
  const trimmed = text.trim()
  if (NULL_WORDS.has(trimmed.toLowerCase())) return null

  switch (type) {
    case 'text':
    case 'category':
      return text
    case 'boolean': {
      const lower = trimmed.toLowerCase()
      if (TRUE_WORDS.has(lower)) return true
      if (FALSE_WORDS.has(lower)) return false
      return invalid(text, 'That is not a yes or a no.')
    }
    case 'integer': {
      const value = readNumber(trimmed)
      if (value === null) return invalid(text, 'That is not a number.')
      if (!Number.isInteger(value)) return invalid(text, 'That is not a whole number.')
      return value
    }
    case 'number': {
      const value = readNumber(trimmed)
      return value === null ? invalid(text, 'That is not a number.') : value
    }
    case 'date': {
      const value = readDate(trimmed)
      return value === null ? invalid(text, 'That is not a date Orbis can read without guessing.') : value
    }
    case 'quantity': {
      const value = readNumber(trimmed)
      if (value === null) {
        // A number with its own unit written next to it, as measurement data usually is.
        const split = /^([+-]?[\d.,eE+-]+)\s*(.+)$/.exec(trimmed)
        if (split) {
          const amount = readNumber(split[1])
          if (amount !== null) {
            const made = quantity(amount, split[2])
            if (!isQuantityError(made)) return made as Quantity
            return invalid(text, made.message)
          }
        }
        return invalid(text, 'That is not a measurement.')
      }
      if (!unit) return value
      return { value, unit }
    }
  }
}

// ---------------------------------------------------------------- inferring what a column is

/**
 * What a column of text most likely holds.
 *
 * Every candidate type has to fit *every* non-empty value in the sample, not most of them. A column that is a date for
 * eleven rows and text for the twelfth is a text column -- because the alternative is eleven dates and one silent `invalid`,
 * which is a column that looks clean and is not.
 *
 * The order is deliberate: boolean before integer, so a column of `0` and `1` is numbers rather than yes-and-no, which is
 * almost always what a column of `0` and `1` means in data.
 */
export function inferColumnType(values: readonly string[]): { type: ColumnType; confidence: Column['confidence']; reason: string; categories: string[] } {
  const present = values.map((one) => String(one ?? '').trim()).filter((one) => !NULL_WORDS.has(one.toLowerCase()))
  if (present.length === 0) {
    return { type: 'text', confidence: 'low', reason: 'Every value is empty, so there is nothing to infer from.', categories: [] }
  }

  const all = (test: (one: string) => boolean): boolean => present.every(test)

  if (all((one) => readDate(one) !== null)) {
    return { type: 'date', confidence: 'high', reason: 'Every value is an unambiguous date.', categories: [] }
  }
  if (all((one) => readNumber(one) !== null)) {
    const whole = all((one) => Number.isInteger(readNumber(one) as number))
    // Booleans dressed as 0 and 1 are almost always counts or flags meant to be summed, so they stay numbers.
    return {
      type: whole ? 'integer' : 'number',
      confidence: 'high',
      reason: whole ? 'Every value is a whole number.' : 'Every value is a number.',
      categories: []
    }
  }
  const lowered = present.map((one) => one.toLowerCase())
  if (lowered.every((one) => TRUE_WORDS.has(one) || FALSE_WORDS.has(one))) {
    return { type: 'boolean', confidence: 'high', reason: 'Every value is a yes or a no.', categories: [] }
  }
  if (all((one) => /^[+-]?[\d.,]+\s*\S+$/.test(one) && !isQuantityError(readCellQuantity(one)))) {
    return { type: 'quantity', confidence: 'medium', reason: 'Every value is a number with a unit.', categories: [] }
  }

  const distinct: string[] = []
  for (const one of present) {
    if (!distinct.includes(one)) distinct.push(one)
    if (distinct.length > DATA_LIMITS.categories) break
  }
  // A set of labels is one where values repeat. Any repetition counts, with a cap on how many distinct values a category
  // may have -- a column of a thousand nearly-unique strings with two duplicates in it is not a category.
  if (distinct.length <= DATA_LIMITS.categories && distinct.length < present.length) {
    return {
      type: 'category',
      confidence: distinct.length <= 12 ? 'high' : 'medium',
      reason: `Only ${distinct.length} distinct value${distinct.length === 1 ? '' : 's'} across ${present.length}, so this looks like a set of labels.`,
      categories: distinct
    }
  }

  // Deliberately the fallback rather than a guess. Text loses nothing; a wrong guess does.
  const ambiguous = present.some((one) => /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(one))
  return {
    type: 'text',
    confidence: ambiguous ? 'low' : 'medium',
    reason: ambiguous
      ? 'Some values look like dates written in an order that could be read two ways, so they are kept as text.'
      : 'The values do not all fit any one type.',
    categories: []
  }
}

/** Helper for the quantity check above, kept separate so the inference reads cleanly. */
function readCellQuantity(text: string): Quantity | { error: string; message: string } {
  const split = /^([+-]?[\d.,eE+-]+)\s*(.+)$/.exec(text.trim())
  if (!split) return { error: 'parse', message: 'not a measurement' }
  const amount = readNumber(split[1])
  if (amount === null) return { error: 'parse', message: 'not a number' }
  return quantity(amount, split[2])
}

// ---------------------------------------------------------------- building a table

const slugColumn = (name: string, taken: Set<string>): string => {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'column'
  if (!taken.has(base)) return base
  // A duplicate header is normal in real files. Numbered rather than overwritten, so no column disappears.
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${base}_${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}_${taken.size}`
}

export interface BuildOptions {
  source?: string
  /** Types the caller already knows, by column position. Anything absent is inferred. */
  types?: (ColumnType | undefined)[]
  /** Units for quantity columns, by position. */
  units?: (string | undefined)[]
}

/**
 * A table from headers and rows of text.
 *
 * Columns are typed once, from a sample, and then every row is read against that type. A short row is filled with
 * `missing` rather than trimmed, and a long one keeps its extra cells in a numbered column rather than losing them.
 */
export function buildTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  options: BuildOptions = {}
): Table | DataError {
  if (headers.length === 0) return { error: 'no-columns', message: 'There are no columns here.' }
  if (headers.length > DATA_LIMITS.columns) {
    return { error: 'too-large', message: `A table may have at most ${DATA_LIMITS.columns} columns.` }
  }
  if (rows.length > DATA_LIMITS.rows) {
    return { error: 'too-large', message: `A table may have at most ${DATA_LIMITS.rows.toLocaleString('en')} rows.` }
  }

  // A row longer than the header is a real thing in real files. Widen rather than truncate.
  const width = Math.min(DATA_LIMITS.columns, Math.max(headers.length, ...rows.map((row) => row.length), 0))
  const taken = new Set<string>()
  const columns: Column[] = []

  for (let c = 0; c < width; c++) {
    const sourceName = headers[c] ?? ''
    const name = sourceName.trim() === '' ? `Column ${c + 1}` : sourceName.trim()
    const id = slugColumn(name, taken)
    taken.add(id)

    const sample = rows.slice(0, DATA_LIMITS.sample).map((row) => row[c] ?? '')
    const given = options.types?.[c]
    const inferred = given
      ? { type: given, confidence: 'given' as const, reason: 'The type was given rather than inferred.', categories: [] }
      : inferColumnType(sample)

    let unit: ResolvedUnit | null = null
    const unitText = options.units?.[c]
    if (unitText) {
      const parsed = parseUnit(unitText)
      if (!('error' in parsed)) unit = parsed
    }
    // A unit written in the header, as measurement files do: `Temperature (°C)`.
    if (!unit && inferred.type !== 'text' && inferred.type !== 'category') {
      const bracketed = /[([]\s*([^)\]]+?)\s*[)\]]\s*$/.exec(name)
      if (bracketed) {
        const parsed = parseUnit(bracketed[1])
        if (!('error' in parsed) && parsed.display !== '') unit = parsed
      }
    }

    columns.push({
      id,
      sourceName,
      name,
      type: unit && (inferred.type === 'number' || inferred.type === 'integer') ? 'quantity' : inferred.type,
      unit,
      confidence: inferred.confidence,
      reason: unit ? `${inferred.reason} The unit came from the column heading.` : inferred.reason,
      categories: inferred.categories
    })
  }

  const built: Row[] = rows.map((row, index) => ({
    id: index + 1,
    cells: columns.map((column, c) =>
      // A short row is filled rather than trimmed, so the shape is square and nothing shifts left.
      c < row.length ? readCell(row[c], column.type, column.unit) : MISSING
    )
  }))

  return Object.freeze({
    columns: Object.freeze(columns),
    rows: Object.freeze(built),
    source: options.source ?? '',
    nextId: built.length + 1
  })
}

// ---------------------------------------------------------------- CSV

export interface DelimitedOptions {
  /** The separator. Detected when absent. */
  delimiter?: string
  /** Whether the first row is headers. Detected when absent. */
  header?: boolean
  source?: string
}

export interface DelimitedResult {
  table: Table
  delimiter: string
  headerRow: boolean
  /** How the delimiter and the header were decided, because both are guesses that can be wrong. */
  notes: string[]
}

/**
 * The delimiter a file most likely uses.
 *
 * Chosen by which candidate gives the most *consistent* number of fields per line, not by which appears most often. A file
 * of prose with commas in it has plenty of commas and no consistency, and counting occurrences would pick the comma every
 * time.
 */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '').slice(0, 30)
  if (lines.length === 0) return ','
  let best = ','
  let bestScore = -1
  for (const candidate of [',', '\t', ';', '|']) {
    const counts = lines.map((line) => splitDelimitedLine(line, candidate).length)
    const first = counts[0]
    if (first < 2) continue
    const consistent = counts.filter((count) => count === first).length / counts.length
    // Consistency first, then how many fields it produces -- so a delimiter that splits into more columns wins a tie.
    const score = consistent * 1000 + Math.min(first, 100)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

/**
 * One line split on a delimiter, respecting quotes.
 *
 * Handles a quoted field containing the delimiter, and a doubled quote meaning a literal one. Does not handle a newline
 * inside a field -- that needs the whole text, which is what `parseDelimited` does.
 */
export function splitDelimitedLine(line: string, delimiter: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false
  let at = 0
  while (at < line.length) {
    const char = line[at]
    if (quoted) {
      if (char === '"') {
        if (line[at + 1] === '"') {
          field += '"'
          at += 2
          continue
        }
        quoted = false
        at += 1
        continue
      }
      field += char
      at += 1
      continue
    }
    if (char === '"' && field === '') {
      quoted = true
      at += 1
      continue
    }
    if (char === delimiter) {
      out.push(field)
      field = ''
      at += 1
      continue
    }
    field += char
    at += 1
  }
  out.push(field)
  return out
}

/**
 * Whether the first row is headers rather than data.
 *
 * Headers are distinguishable by being text where the rest of the column is not, and by being distinct from one another. A
 * file whose first row is numbers like every other row has no header, and treating it as one loses a row of data -- which
 * is worse than a column called "5".
 */
export function detectHeader(rows: readonly (readonly string[])[]): boolean {
  if (rows.length < 2) return true
  const first = rows[0]
  const rest = rows.slice(1, 40)
  if (first.some((cell) => cell.trim() === '')) {
    // A blank header cell is possible but unusual; only treat the row as headers if it is otherwise convincing.
    if (first.filter((cell) => cell.trim() !== '').length < first.length / 2) return false
  }
  // Duplicated values in the first row look like data, not headings.
  const distinct = new Set(first.map((cell) => cell.trim().toLowerCase()))
  if (distinct.size < first.length && first.length > 1) return false

  let evidence = 0
  for (let c = 0; c < first.length; c++) {
    const below = rest.map((row) => row[c] ?? '').filter((cell) => cell.trim() !== '')
    if (below.length === 0) continue
    const headerIsText = readNumber(first[c]) === null && readDate(first[c]) === null
    const belowIsTyped = below.every((cell) => readNumber(cell) !== null) || below.every((cell) => readDate(cell) !== null)
    if (headerIsText && belowIsTyped) evidence += 1
    else if (!headerIsText && belowIsTyped) evidence -= 1
  }
  return evidence >= 0
}

/**
 * A delimited file parsed into a table.
 *
 * A real parser: quoted fields, doubled quotes, the delimiter inside quotes, newlines inside quoted fields, `\r\n` and
 * `\n`, and a byte-order mark. `split(',')` gets every one of these wrong and the failure is silent.
 */
export function parseDelimited(text: string, options: DelimitedOptions = {}): DelimitedResult | DataError {
  let body = String(text ?? '')
  // A byte-order mark would otherwise become part of the first column's name.
  if (body.charCodeAt(0) === 0xfeff) body = body.slice(1)
  if (body.trim() === '') return { error: 'no-rows', message: 'There is nothing in that file.' }

  const delimiter = options.delimiter ?? detectDelimiter(body)
  const notes: string[] = [
    options.delimiter
      ? `Split on the delimiter given.`
      : `Split on ${delimiter === '\t' ? 'tabs' : `"${delimiter}"`}, chosen because it gives the most consistent number of columns per line.`
  ]

  // Walk the whole text rather than line by line, so a newline inside a quoted field stays inside it.
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let at = 0
  while (at < body.length) {
    const char = body[at]
    if (quoted) {
      if (char === '"') {
        if (body[at + 1] === '"') {
          field += '"'
          at += 2
          continue
        }
        quoted = false
        at += 1
        continue
      }
      field += char
      at += 1
      continue
    }
    if (char === '"' && field === '') {
      quoted = true
      at += 1
      continue
    }
    if (char === delimiter) {
      row.push(field)
      field = ''
      at += 1
      continue
    }
    if (char === '\r' || char === '\n') {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      // `\r\n` is one line ending, not two.
      at += char === '\r' && body[at + 1] === '\n' ? 2 : 1
      continue
    }
    field += char
    at += 1
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // A trailing newline, or several, is file formatting rather than data. Every empty row at the end goes.
  //
  // A blank line in the *middle* is kept: it becomes a row filled with `missing`, which is visible in the table and can be
  // filtered out deliberately. Dropping it silently would change the row count of somebody's file without telling them.
  const useful = [...rows]
  while (useful.length > 0) {
    const last = useful[useful.length - 1]
    if (last.length === 1 && last[0] === '') useful.pop()
    else break
  }
  if (useful.length === 0) return { error: 'no-rows', message: 'There are no rows in that file.' }
  if (quoted) notes.push('A quoted value was never closed; everything after it was read as one field.')

  const headerRow = options.header ?? detectHeader(useful)
  notes.push(
    options.header !== undefined
      ? headerRow
        ? 'The first row was treated as headings, as asked.'
        : 'The first row was treated as data, as asked.'
      : headerRow
        ? 'The first row looks like headings: its values are text where the columns below are not, and none repeats.'
        : 'The first row looks like data rather than headings, so no row was lost to a heading.'
  )

  const headers = headerRow ? useful[0] : useful[0].map((_, i) => `Column ${i + 1}`)
  const dataRows = headerRow ? useful.slice(1) : useful
  const table = buildTable(headers, dataRows, { source: options.source ?? '' })
  if (isDataError(table)) return table
  return { table, delimiter, headerRow, notes }
}

/**
 * A table written back out as a delimited file.
 *
 * Quotes a field only when it needs it, and protects a value that a spreadsheet would otherwise treat as a formula. That
 * last part is not cosmetic: a cell beginning `=` or `+` opens as executable in every spreadsheet application, and a Page
 * exporting somebody's data should not hand them a file that runs.
 */
export function toDelimited(table: Table, delimiter = ','): string {
  const escape = (text: string): string => {
    // A leading =, +, - or @ is a formula to a spreadsheet. Prefixing with a quote keeps the text and not the behaviour.
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
    return /["\r\n]/.test(safe) || safe.includes(delimiter) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  const lines = [table.columns.map((column) => escape(column.name)).join(delimiter)]
  for (const row of table.rows) {
    lines.push(table.columns.map((column, c) => escape(cellOut(row.cells[c] ?? MISSING, column))).join(delimiter))
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------- sorting

export interface SortKey {
  columnId: string
  descending?: boolean
}

/**
 * A table sorted, type-aware, and stable.
 *
 * Numbers sort numerically and text alphabetically, so `10` does not come before `2`. Missing values always sort last
 * whichever direction is asked for, because "no value" is not smaller than every value -- it is absent, and burying it at
 * the top of a descending sort hides it.
 *
 * Stable, so sorting by one column then another gives what anybody would expect.
 */
export function sortTable(table: Table, keys: readonly SortKey[]): Table | DataError {
  for (const key of keys) {
    if (columnIndex(table, key.columnId) < 0) {
      return { error: 'unknown-column', message: `There is no column called "${key.columnId}".` }
    }
  }
  if (keys.length === 0) return table

  const positions = keys.map((key) => ({ at: columnIndex(table, key.columnId), column: columnById(table, key.columnId)!, descending: key.descending === true }))
  const decorated = table.rows.map((row, index) => ({ row, index }))

  decorated.sort((left, right) => {
    for (const { at, column, descending } of positions) {
      const a = left.row.cells[at] ?? MISSING
      const b = right.row.cells[at] ?? MISSING
      const aHas = hasValue(a)
      const bHas = hasValue(b)
      // Absent sorts last either way. It is not smaller than everything.
      if (!aHas && !bHas) continue
      if (!aHas) return 1
      if (!bHas) return -1

      let comparison: number
      if (column.type === 'text' || column.type === 'category') {
        comparison = asText(a).localeCompare(asText(b), undefined, { numeric: true, sensitivity: 'base' })
      } else if (column.type === 'boolean') {
        comparison = (a === true ? 1 : 0) - (b === true ? 1 : 0)
      } else {
        const an = asNumber(a)
        const bn = asNumber(b)
        comparison = an === null || bn === null ? asText(a).localeCompare(asText(b)) : an - bn
      }
      if (comparison !== 0) return descending ? -comparison : comparison
    }
    // Stable: equal rows keep the order they arrived in.
    return left.index - right.index
  })

  return Object.freeze({ ...table, rows: Object.freeze(decorated.map((one) => one.row)) })
}

// ---------------------------------------------------------------- filtering

export type Comparison =
  | 'equals'
  | 'not-equals'
  | 'contains'
  | 'starts-with'
  | 'ends-with'
  | 'greater'
  | 'greater-or-equal'
  | 'less'
  | 'less-or-equal'
  | 'between'
  | 'is-empty'
  | 'is-not-empty'
  | 'is-invalid'
  | 'is-one-of'

export interface Condition {
  columnId: string
  comparison: Comparison
  value?: string | number | boolean
  /** The upper bound, for `between`. */
  value2?: string | number
  /** The allowed set, for `is-one-of`. */
  values?: (string | number)[]
  /** Whether text comparisons mind their case. Off by default, which is what people expect. */
  caseSensitive?: boolean
}

export interface Filter {
  /** Whether every condition has to hold or only one of them. */
  match: 'all' | 'any'
  conditions: Condition[]
  /** Nested groups, so `A and (B or C)` can be expressed. */
  groups?: Filter[]
}

/** Whether one row satisfies one condition. Missing and invalid never satisfy a comparison they were not asked about. */
function matchesCondition(table: Table, row: Row, condition: Condition): boolean {
  const at = columnIndex(table, condition.columnId)
  if (at < 0) return false
  const cell = row.cells[at] ?? MISSING

  if (condition.comparison === 'is-empty') return !hasValue(cell)
  if (condition.comparison === 'is-not-empty') return hasValue(cell)
  if (condition.comparison === 'is-invalid') return isInvalid(cell)
  // Everything below asks about a value, and a cell with no value has no answer -- so it is false rather than a match.
  if (!hasValue(cell)) return false

  const column = table.columns[at]
  const numericColumnType = column.type === 'number' || column.type === 'integer' || column.type === 'date' || column.type === 'quantity'

  const text = condition.caseSensitive === true ? asText(cell) : asText(cell).toLowerCase()
  const wanted = (value: unknown): string =>
    condition.caseSensitive === true ? String(value ?? '') : String(value ?? '').toLowerCase()

  switch (condition.comparison) {
    case 'equals':
      if (typeof condition.value === 'boolean') return cell === condition.value
      if (numericColumnType) {
        const a = asNumber(cell)
        const b = typeof condition.value === 'number' ? condition.value : readNumber(String(condition.value ?? ''))
        return a !== null && b !== null && a === b
      }
      return text === wanted(condition.value)
    case 'not-equals':
      return !matchesCondition(table, row, { ...condition, comparison: 'equals' })
    case 'contains':
      return text.includes(wanted(condition.value))
    case 'starts-with':
      return text.startsWith(wanted(condition.value))
    case 'ends-with':
      return text.endsWith(wanted(condition.value))
    case 'greater':
    case 'greater-or-equal':
    case 'less':
    case 'less-or-equal': {
      const a = asNumber(cell)
      const b = typeof condition.value === 'number' ? condition.value : readNumber(String(condition.value ?? ''))
      if (a === null || b === null) {
        // Comparing text: fall back to an alphabetical comparison rather than refusing, which is what a spreadsheet does.
        const comparison = text.localeCompare(wanted(condition.value))
        if (condition.comparison === 'greater') return comparison > 0
        if (condition.comparison === 'greater-or-equal') return comparison >= 0
        if (condition.comparison === 'less') return comparison < 0
        return comparison <= 0
      }
      if (condition.comparison === 'greater') return a > b
      if (condition.comparison === 'greater-or-equal') return a >= b
      if (condition.comparison === 'less') return a < b
      return a <= b
    }
    case 'between': {
      const a = asNumber(cell)
      const low = typeof condition.value === 'number' ? condition.value : readNumber(String(condition.value ?? ''))
      const high = typeof condition.value2 === 'number' ? condition.value2 : readNumber(String(condition.value2 ?? ''))
      if (a === null || low === null || high === null) return false
      // Inclusive, and the bounds are accepted in either order because nobody remembers which way round they go.
      return a >= Math.min(low, high) && a <= Math.max(low, high)
    }
    case 'is-one-of':
      return (condition.values ?? []).some((one) =>
        numericColumnType ? asNumber(cell) === (typeof one === 'number' ? one : readNumber(String(one))) : text === wanted(one)
      )
    default:
      return false
  }
}

/** Whether a row satisfies a filter, including its nested groups. */
export function matchesFilter(table: Table, row: Row, filter: Filter): boolean {
  const results = [
    ...filter.conditions.map((condition) => matchesCondition(table, row, condition)),
    ...(filter.groups ?? []).map((group) => matchesFilter(table, row, group))
  ]
  if (results.length === 0) return true
  return filter.match === 'any' ? results.some(Boolean) : results.every(Boolean)
}

/** A table with only the rows a filter keeps. Row ids are preserved, so a filtered row is still the same row. */
export function filterTable(table: Table, filter: Filter): Table | DataError {
  for (const condition of filter.conditions) {
    if (columnIndex(table, condition.columnId) < 0) {
      return { error: 'unknown-column', message: `There is no column called "${condition.columnId}".` }
    }
  }
  return Object.freeze({ ...table, rows: Object.freeze(table.rows.filter((row) => matchesFilter(table, row, filter))) })
}

// ---------------------------------------------------------------- columns in and out

/** A table with only the columns named, in the order named. */
export function selectColumns(table: Table, ids: readonly string[]): Table | DataError {
  const positions: number[] = []
  for (const id of ids) {
    const at = columnIndex(table, id)
    if (at < 0) return { error: 'unknown-column', message: `There is no column called "${id}".` }
    positions.push(at)
  }
  return Object.freeze({
    ...table,
    columns: Object.freeze(positions.map((at) => table.columns[at])),
    rows: Object.freeze(table.rows.map((row) => ({ id: row.id, cells: Object.freeze(positions.map((at) => row.cells[at] ?? MISSING)) })))
  })
}

export function dropColumn(table: Table, id: string): Table | DataError {
  const at = columnIndex(table, id)
  if (at < 0) return { error: 'unknown-column', message: `There is no column called "${id}".` }
  return selectColumns(
    table,
    table.columns.filter((_, i) => i !== at).map((one) => one.id)
  )
}

export function renameColumn(table: Table, id: string, name: string): Table | DataError {
  const at = columnIndex(table, id)
  if (at < 0) return { error: 'unknown-column', message: `There is no column called "${id}".` }
  const trimmed = String(name ?? '').trim()
  if (trimmed === '') return { error: 'invalid-argument', message: 'A column needs a name.' }
  return Object.freeze({
    ...table,
    // The id does not change. A saved filter or a derived column refers to it, and renaming must not break them.
    columns: Object.freeze(table.columns.map((column, i) => (i === at ? { ...column, name: trimmed.slice(0, 120) } : column)))
  })
}

/**
 * A column re-read as a different type.
 *
 * Reads from the text that was originally there, not from the value it currently holds -- so changing a column from text to
 * number and back does not lose anything, and a value that was `invalid` gets a second chance under the new type.
 */
export function retypeColumn(table: Table, id: string, type: ColumnType, unitText?: string): Table | DataError {
  const at = columnIndex(table, id)
  if (at < 0) return { error: 'unknown-column', message: `There is no column called "${id}".` }
  let unit: ResolvedUnit | null = null
  if (unitText) {
    const parsed = parseUnit(unitText)
    if ('error' in parsed) return { error: 'invalid-argument', message: parsed.message }
    unit = parsed
  }
  return Object.freeze({
    ...table,
    columns: Object.freeze(
      table.columns.map((one, i) =>
        i === at
          ? { ...one, type, unit, confidence: 'given' as const, reason: 'The type was set rather than inferred.', categories: [] }
          : one
      )
    ),
    rows: Object.freeze(
      table.rows.map((row) => ({
        id: row.id,
        cells: Object.freeze(
          row.cells.map((cell, i) => {
            if (i !== at) return cell
            if (isMissing(cell)) return cell
            // From the original text, so nothing is lost by a round trip through the wrong type.
            return readCell(isInvalid(cell) ? cell.raw : asText(cell), type, unit)
          })
        )
      }))
    ),
    source: table.source
  })
}

/**
 * A new column worked out from the others.
 *
 * The formula is evaluated by the caller, per row, and handed back as a cell. Keeping evaluation outside means this file
 * has no opinion about what a formula is, and the expression engine stays the only thing that parses one.
 */
export function addColumn(
  table: Table,
  column: Omit<Column, 'categories'> & { categories?: string[] },
  cellFor: (row: Row, index: number) => Cell
): Table | DataError {
  if (table.columns.some((one) => one.id === column.id)) {
    return { error: 'invalid-argument', message: `There is already a column called "${column.id}".` }
  }
  if (table.columns.length >= DATA_LIMITS.columns) {
    return { error: 'too-large', message: `A table may have at most ${DATA_LIMITS.columns} columns.` }
  }
  return Object.freeze({
    ...table,
    columns: Object.freeze([...table.columns, { ...column, categories: column.categories ?? [] }]),
    rows: Object.freeze(
      table.rows.map((row, index) => ({ id: row.id, cells: Object.freeze([...row.cells, cellFor(row, index)]) }))
    )
  })
}

// ---------------------------------------------------------------- grouping

export type Aggregate =
  | 'count'
  | 'count-values'
  | 'count-distinct'
  | 'sum'
  | 'mean'
  | 'median'
  | 'minimum'
  | 'maximum'
  | 'standard-deviation'
  | 'first'
  | 'last'

export interface AggregateRequest {
  columnId: string
  aggregate: Aggregate
  /** What to call the result. Defaults to something readable. */
  as?: string
}

export interface Group {
  /** The value of each grouping column, in the order they were given. */
  key: Cell[]
  keyText: string[]
  rows: Row[]
  /** The aggregates asked for, keyed by their output name. */
  values: Record<string, Cell>
}

const AGGREGATE_LABEL: Record<Aggregate, string> = {
  count: 'rows',
  'count-values': 'values',
  'count-distinct': 'distinct',
  sum: 'sum',
  mean: 'mean',
  median: 'median',
  minimum: 'minimum',
  maximum: 'maximum',
  'standard-deviation': 'standard deviation',
  first: 'first',
  last: 'last'
}

/**
 * Rows gathered by the values of one or more columns.
 *
 * `count` counts rows; `count-values` counts the ones that actually have a value. The two differ exactly when data is
 * missing, which is when it matters, so both exist rather than one being called "count" and quietly picking.
 *
 * Every numeric aggregate goes through `statistics.ts`, so a mean here and a mean in a Statistics Page cannot disagree.
 */
export function groupBy(table: Table, byIds: readonly string[], aggregates: readonly AggregateRequest[] = []): Group[] | DataError {
  const positions: number[] = []
  for (const id of byIds) {
    const at = columnIndex(table, id)
    if (at < 0) return { error: 'unknown-column', message: `There is no column called "${id}".` }
    positions.push(at)
  }
  for (const request of aggregates) {
    if (columnIndex(table, request.columnId) < 0) {
      return { error: 'unknown-column', message: `There is no column called "${request.columnId}".` }
    }
  }
  if (positions.length === 0) return { error: 'invalid-argument', message: 'Grouping needs at least one column.' }

  const buckets = new Map<string, { key: Cell[]; keyText: string[]; rows: Row[] }>()
  for (const row of table.rows) {
    const key = positions.map((at) => row.cells[at] ?? MISSING)
    const keyText = key.map(asText)
    // The separator is one that cannot appear in a cell, so two different keys cannot collide into one group.
    const id = keyText.join('\u0000')
    const held = buckets.get(id)
    if (held) held.rows.push(row)
    else buckets.set(id, { key, keyText, rows: [row] })
  }

  return [...buckets.values()].map((bucket) => {
    const values: Record<string, Cell> = {}
    for (const request of aggregates) {
      const at = columnIndex(table, request.columnId)
      const column = table.columns[at]
      const cells = bucket.rows.map((row) => row.cells[at] ?? MISSING)
      const name = request.as ?? `${column.name} ${AGGREGATE_LABEL[request.aggregate]}`
      values[name] = aggregateCells(cells, request.aggregate, column)
    }
    return { key: bucket.key, keyText: bucket.keyText, rows: bucket.rows, values }
  })
}

/** One aggregate over a list of cells. Every statistic goes through `statistics.ts` rather than being recomputed here. */
export function aggregateCells(cells: readonly Cell[], aggregate: Aggregate, column?: Column): Cell {
  const present = cells.filter(hasValue)
  const numbers = present.map(asNumber).filter((one): one is number => one !== null)

  switch (aggregate) {
    case 'count':
      return cells.length
    case 'count-values':
      return present.length
    case 'count-distinct':
      return new Set(present.map(asText)).size
    case 'first':
      return present[0] ?? MISSING
    case 'last':
      return present[present.length - 1] ?? MISSING
    case 'minimum':
    case 'maximum': {
      if (column && (column.type === 'text' || column.type === 'category')) {
        const sorted = present.map(asText).sort((a, b) => a.localeCompare(b))
        return (aggregate === 'minimum' ? sorted[0] : sorted[sorted.length - 1]) ?? MISSING
      }
      if (numbers.length === 0) return MISSING
      return aggregate === 'minimum' ? Math.min(...numbers) : Math.max(...numbers)
    }
    default: {
      if (numbers.length === 0) return MISSING
      const stats = summarise(numbers)
      if (isStatisticsError(stats)) return MISSING
      const value =
        aggregate === 'sum'
          ? stats.sum
          : aggregate === 'mean'
            ? stats.mean
            : aggregate === 'median'
              ? stats.median
              : stats.standardDeviation
      // A quantity column keeps its unit through a sum or a mean. A standard deviation does too; it is in the same units.
      // A count never does -- but a count has already returned above, so there is no case to exclude here.
      if (column?.unit) return { value, unit: column.unit }
      return value
    }
  }
}

/** Groups turned back into a table, so a grouped result can be sorted, filtered or exported like any other. */
export function groupsToTable(groups: readonly Group[], byColumns: readonly Column[], source = ''): Table {
  const aggregateNames = groups.length === 0 ? [] : Object.keys(groups[0].values)
  const columns: Column[] = [
    ...byColumns.map((column) => ({ ...column })),
    ...aggregateNames.map((name, i) => {
      // The column is what its values are. A sum of megawatt-hours is still megawatt-hours, and the first value of a
      // text column is text: calling either "number" hands a writer a cell its column says it cannot hold.
      const sample = groups.map((group) => group.values[name]).find((cell) => cell !== undefined && hasValue(cell))
      const type: ColumnType = sample === undefined || typeof sample === 'number' ? 'number' : isQuantityCell(sample) ? 'quantity' : typeof sample === 'boolean' ? 'boolean' : 'text'
      return {
        id: `aggregate_${i + 1}`,
        sourceName: name,
        name,
        type,
        unit: sample !== undefined && isQuantityCell(sample) ? sample.unit : null,
        confidence: 'given' as const,
        reason: 'Worked out by grouping.',
        categories: []
      }
    })
  ]
  return Object.freeze({
    columns: Object.freeze(columns),
    rows: Object.freeze(
      groups.map((group, index) => ({
        id: index + 1,
        cells: Object.freeze([...group.key, ...aggregateNames.map((name) => group.values[name] ?? MISSING)])
      }))
    ),
    source,
    nextId: groups.length + 1
  })
}

// ---------------------------------------------------------------- joining

export type JoinKind = 'inner' | 'left' | 'full'

export interface JoinResult {
  table: Table
  /** How many rows on each side found a partner, and how many did not. Reported, because a join that lost half the data silently is the classic quiet disaster. */
  matchedLeft: number
  unmatchedLeft: number
  matchedRight: number
  unmatchedRight: number
  /** Keys appearing more than once on a side, which is how a join multiplies rows unexpectedly. */
  duplicateKeys: string[]
  notes: string[]
}

/**
 * Two tables joined on a key.
 *
 * Reports how many rows on each side found a partner, and which keys were duplicated. A join is the operation most likely
 * to silently change the size of somebody's data -- an unnoticed duplicate key multiplies rows, and an unnoticed mismatch
 * loses them -- so the counts are part of the result rather than something to work out afterwards.
 */
export function joinTables(
  left: Table,
  right: Table,
  leftKey: string,
  rightKey: string,
  kind: JoinKind = 'inner'
): JoinResult | DataError {
  const leftAt = columnIndex(left, leftKey)
  const rightAt = columnIndex(right, rightKey)
  if (leftAt < 0) return { error: 'unknown-column', message: `The left table has no column called "${leftKey}".` }
  if (rightAt < 0) return { error: 'unknown-column', message: `The right table has no column called "${rightKey}".` }

  const keyOf = (row: Row, at: number): string | null => {
    const cell = row.cells[at] ?? MISSING
    // A row with no key cannot be joined on it. Null rather than the empty string, so two blank keys do not become a pair.
    return hasValue(cell) ? asText(cell) : null
  }

  const rightByKey = new Map<string, Row[]>()
  for (const row of right.rows) {
    const key = keyOf(row, rightAt)
    if (key === null) continue
    const held = rightByKey.get(key)
    if (held) held.push(row)
    else rightByKey.set(key, [row])
  }

  const duplicateKeys = [...rightByKey.entries()].filter(([, rows]) => rows.length > 1).map(([key]) => key)
  const leftCounts = new Map<string, number>()
  for (const row of left.rows) {
    const key = keyOf(row, leftAt)
    if (key !== null) leftCounts.set(key, (leftCounts.get(key) ?? 0) + 1)
  }
  for (const [key, count] of leftCounts) if (count > 1 && !duplicateKeys.includes(key)) duplicateKeys.push(key)

  // The right key column is dropped: two identical columns side by side is never what anybody wanted.
  const rightColumns = right.columns.filter((_, i) => i !== rightAt)
  const taken = new Set(left.columns.map((one) => one.id))
  const renamed = rightColumns.map((column) => {
    if (!taken.has(column.id)) {
      taken.add(column.id)
      return column
    }
    const id = slugColumn(`${column.id}_2`, taken)
    taken.add(id)
    return { ...column, id, name: `${column.name} (2)` }
  })

  const blankRight: Cell[] = renamed.map(() => MISSING)
  const rows: Row[] = []
  let nextId = 1
  let matchedLeft = 0
  const usedRight = new Set<RowId>()

  for (const row of left.rows) {
    const key = keyOf(row, leftAt)
    const partners = key === null ? [] : (rightByKey.get(key) ?? [])
    if (partners.length === 0) {
      if (kind === 'inner') continue
      rows.push({ id: nextId++, cells: Object.freeze([...row.cells, ...blankRight]) })
      continue
    }
    matchedLeft += 1
    for (const partner of partners) {
      usedRight.add(partner.id)
      rows.push({
        id: nextId++,
        cells: Object.freeze([...row.cells, ...rightColumns.map((_, i) => partner.cells[i >= rightAt ? i + 1 : i] ?? MISSING)])
      })
    }
  }

  if (kind === 'full') {
    const blankLeft: Cell[] = left.columns.map(() => MISSING)
    for (const row of right.rows) {
      if (usedRight.has(row.id)) continue
      rows.push({
        id: nextId++,
        cells: Object.freeze([...blankLeft, ...rightColumns.map((_, i) => row.cells[i >= rightAt ? i + 1 : i] ?? MISSING)])
      })
    }
  }

  const matchedRight = usedRight.size
  const notes: string[] = [`A ${kind} join on "${left.columns[leftAt].name}" and "${right.columns[rightAt].name}".`]
  if (duplicateKeys.length > 0) {
    notes.push(
      `${duplicateKeys.length} key${duplicateKeys.length === 1 ? '' : 's'} appears more than once, so some rows were multiplied. ${duplicateKeys.slice(0, 5).join(', ')}${duplicateKeys.length > 5 ? '…' : ''}`
    )
  }
  const lostLeft = left.rows.length - matchedLeft
  if (kind === 'inner' && lostLeft > 0) {
    notes.push(`${lostLeft} row${lostLeft === 1 ? '' : 's'} on the left found no partner and ${lostLeft === 1 ? 'is' : 'are'} not in the result.`)
  }

  return {
    table: Object.freeze({
      columns: Object.freeze([...left.columns, ...renamed]),
      rows: Object.freeze(rows),
      source: `${left.source || 'left'} joined with ${right.source || 'right'}`,
      nextId
    }),
    matchedLeft,
    unmatchedLeft: left.rows.length - matchedLeft,
    matchedRight,
    unmatchedRight: right.rows.length - matchedRight,
    duplicateKeys: duplicateKeys.slice(0, 50),
    notes
  }
}

// ---------------------------------------------------------------- profiling

export interface ColumnProfile {
  columnId: string
  name: string
  type: ColumnType
  unit: string | null
  count: number
  present: number
  empty: number
  invalid: number
  distinct: number
  /** The commonest values and how often each appears. Only for columns where that is meaningful. */
  common: { value: string; count: number }[]
  /** Statistics, for a column that holds numbers. */
  statistics: Summary | null
  /** Things worth knowing that a caller should not have to work out. */
  warnings: string[]
}

/**
 * What one column actually contains.
 *
 * The warnings are the point. A column that is entirely one value, or is 90% empty, or has a handful of unreadable values,
 * is a column somebody will otherwise analyse without noticing -- and every conclusion from it will be wrong in a way that
 * does not look wrong.
 */
export function profileColumn(table: Table, id: string): ColumnProfile | DataError {
  const at = columnIndex(table, id)
  if (at < 0) return { error: 'unknown-column', message: `There is no column called "${id}".` }
  const column = table.columns[at]
  const cells = table.rows.map((row) => row.cells[at] ?? MISSING)

  const present = cells.filter(hasValue)
  const invalidCount = cells.filter(isInvalid).length
  const empty = cells.length - present.length
  const texts = present.map(asText)
  const counts = new Map<string, number>()
  for (const text of texts) counts.set(text, (counts.get(text) ?? 0) + 1)

  const numbers = present.map(asNumber).filter((one): one is number => one !== null)
  const stats = numbers.length > 0 ? summarise(numbers) : null

  const warnings: string[] = []
  if (cells.length > 0 && present.length === 0) warnings.push('Every value in this column is empty.')
  else if (cells.length > 0 && empty / cells.length > 0.5) {
    warnings.push(`${Math.round((empty / cells.length) * 100)}% of this column is empty, so anything worked out from it rests on less than half the rows.`)
  }
  if (invalidCount > 0) {
    warnings.push(`${invalidCount} value${invalidCount === 1 ? '' : 's'} could not be read as ${column.type}. The original text has been kept.`)
  }
  if (counts.size === 1 && present.length > 1) {
    warnings.push('Every value in this column is the same, so it cannot explain anything that varies.')
  }
  if (column.confidence === 'low') warnings.push(`The type was guessed with low confidence: ${column.reason}`)
  if (present.length > 20 && counts.size === present.length && (column.type === 'text' || column.type === 'category')) {
    warnings.push('Every value is distinct, so this looks like an identifier rather than something to group by.')
  }

  return {
    columnId: id,
    name: column.name,
    type: column.type,
    unit: column.unit?.display ?? null,
    count: cells.length,
    present: present.length,
    empty,
    invalid: invalidCount,
    distinct: counts.size,
    common:
      column.type === 'number' || column.type === 'quantity'
        ? []
        : [...counts.entries()]
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
            .slice(0, 10),
    statistics: stats && !isStatisticsError(stats) ? stats : null,
    warnings
  }
}

export interface TableProfile {
  rows: number
  columns: number
  source: string
  /** Rows identical to an earlier row across every column. Flagged, never removed. */
  duplicateRows: RowId[]
  columnProfiles: ColumnProfile[]
  warnings: string[]
}

/** Everything about a table, for the screen a Page shows after an import. */
export function profileTable(table: Table): TableProfile {
  const seen = new Map<string, RowId>()
  const duplicateRows: RowId[] = []
  for (const row of table.rows) {
    const signature = row.cells.map(asText).join('\u0000')
    if (seen.has(signature)) duplicateRows.push(row.id)
    else seen.set(signature, row.id)
  }

  const columnProfiles = table.columns
    .map((column) => profileColumn(table, column.id))
    .filter((one): one is ColumnProfile => !isDataError(one))

  const warnings: string[] = []
  if (table.rows.length === 0) warnings.push('This table has no rows.')
  if (duplicateRows.length > 0) {
    warnings.push(`${duplicateRows.length} row${duplicateRows.length === 1 ? '' : 's'} ${duplicateRows.length === 1 ? 'is' : 'are'} identical to an earlier row. They are flagged, not removed.`)
  }
  const lowConfidence = columnProfiles.filter((one) => table.columns.find((c) => c.id === one.columnId)?.confidence === 'low')
  if (lowConfidence.length > 0) {
    warnings.push(`${lowConfidence.length} column${lowConfidence.length === 1 ? '' : 's'} could not be typed confidently and ${lowConfidence.length === 1 ? 'was' : 'were'} kept as text.`)
  }

  return { rows: table.rows.length, columns: table.columns.length, source: table.source, duplicateRows, columnProfiles, warnings }
}

/** The promises this engine makes, for a Page that wants to show them. */
export const DATA_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A missing value is never zero, and zero is never missing. Both are counted separately.',
  'A value that could not be read keeps its original text, so nothing is lost by being misunderstood.',
  'A column type is only inferred when every value fits it. Anything ambiguous stays text.',
  'A date written as 01/02/2026 is refused rather than guessed at, because it means different days in different places.',
  'Row identity is assigned on import and survives sorting, filtering and grouping.',
  'A duplicate row is flagged, never removed.',
  'A join reports how many rows matched on each side, because a join is the easiest way to silently lose or multiply data.',
  'Exported values that a spreadsheet would treat as a formula are escaped, so a file Orbis writes cannot run.'
])
