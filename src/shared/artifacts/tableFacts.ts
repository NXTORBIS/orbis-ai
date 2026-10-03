import { profileTable, type Table } from '../compute/data.ts'

/**
 * The numbers in an attached table, worked out rather than read off by a model.
 *
 * Orbis has a whole deterministic data layer -- grouping, filtering, joining, statistics -- and a question typed in
 * the chat about an attached spreadsheet never reached it. The table went into the prompt as text and the model did
 * the arithmetic, which is the one thing a model should never be trusted with: "what is the total?" over four hundred
 * rows gets an answer that looks exactly like a right answer.
 *
 * So before the model sees the question, the obvious figures are computed here and handed over as facts. The model
 * writes the sentence; the numbers in it are Orbis's.
 *
 * Two rules:
 *
 * **Every number here was computed from the rows.** Nothing is estimated, nothing is sampled, and a column that is
 * not really numeric produces nothing rather than a total of whatever its text parsed as.
 *
 * **It answers what it can and says nothing about the rest.** This is not a query engine. It gives the shape of the
 * table and the totals, averages and ranges of its numeric columns, because those are what nearly every question
 * about a spreadsheet turns on. Anything else is still the model's to work out -- from the rows, which it also has.
 */

export interface ColumnFacts {
  name: string
  count: number
  /** How many rows had no usable number in this column. */
  missing: number
  total: number
  mean: number
  median: number
  min: number
  max: number
}

export interface TableFacts {
  rows: number
  columns: string[]
  numeric: ColumnFacts[]
  /** Columns that look like categories, with how many different values each has. */
  categories: { name: string; distinct: number; commonest: string | null }[]
}

/** The column types that really hold numbers. Named, because "number" is only one of them. */
const NUMERIC_TYPES = new Set(['number', 'integer', 'quantity'])

/** How many different values a column may have and still be worth describing as a category. */
const CATEGORY_LIMIT = 30

/**
 * What the table really says, computed.
 *
 * Built on `profileTable`, which already walks every row and keeps the statistics and the commonest values per
 * column. Re-deriving them here would be a second answer to the same question, and two answers that could disagree
 * is worse than one.
 */
export function tableFacts(table: Table): TableFacts {
  const profile = profileTable(table)
  if ('error' in profile) return { rows: table.rows.length, columns: table.columns.map((one) => one.name), numeric: [], categories: [] }

  const numeric: ColumnFacts[] = []
  const categories: TableFacts['categories'] = []

  for (const column of profile.columnProfiles) {
    const s = column.statistics
    // Every type that really holds numbers, not only the one called "number": a column of whole numbers is typed
    // `integer` and a measured one `quantity`, and leaving those out was why a column of prices came back as labels.
    if (NUMERIC_TYPES.has(column.type) && s && s.count > 0) {
      numeric.push({
        name: column.name,
        count: s.count,
        // From the column's own profile rather than from the statistics: the statistics are given the values that
        // parsed, so by the time they are computed the blanks and the unreadable entries have already gone.
        missing: column.empty + column.invalid,
        total: s.sum,
        mean: s.mean,
        median: s.median,
        min: s.minimum,
        max: s.maximum
      })
      continue
    }
    // A column with a handful of repeated values is a category; one where every row differs is a label, and saying
    // "4,000 different values" about it is true and useless.
    if (column.distinct > 0 && column.distinct <= CATEGORY_LIMIT) {
      categories.push({ name: column.name, distinct: column.distinct, commonest: column.common[0]?.value ?? null })
    }
  }

  return { rows: table.rows.length, columns: table.columns.map((one) => one.name), numeric, categories }
}

const LF = String.fromCharCode(10)

const round = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) >= 100 ? 1 : 3).replace(/\.?0+$/, ''))

/**
 * What to tell the model, as facts it must use rather than recompute.
 *
 * The instruction is the point of the block as much as the numbers are. Given a table and a figure, a model will
 * happily produce its own figure; told that these were computed from every row and that it must not work out its own,
 * it uses them -- and when the question needs something not here, it says so instead of inventing it.
 */
export function factsBlock(facts: TableFacts, name: string): string | null {
  if (facts.rows === 0) return null
  const lines: string[] = [
    `Orbis computed these from every row of "${name}" (${facts.rows.toLocaleString('en')} rows, ${facts.columns.length} columns: ${facts.columns.join(', ')}).`,
    'Use these figures exactly. Do not calculate your own totals or averages from the rows, and do not round them further.',
    'If the question needs a figure that is not here, say what you would need rather than working one out.'
  ]
  for (const one of facts.numeric) {
    const missing = one.missing > 0 ? `, ${one.missing} rows had no number` : ''
    lines.push(`- ${one.name}: total ${round(one.total)}, mean ${round(one.mean)}, median ${round(one.median)}, lowest ${round(one.min)}, highest ${round(one.max)} (from ${one.count} values${missing})`)
  }
  for (const one of facts.categories) {
    lines.push(`- ${one.name}: ${one.distinct} different value${one.distinct === 1 ? '' : 's'}${one.commonest ? `, commonest "${one.commonest}"` : ''}`)
  }
  // A table with nothing countable in it is not worth a block that says only its size.
  if (facts.numeric.length === 0 && facts.categories.length === 0) return null
  return lines.join(LF)
}
