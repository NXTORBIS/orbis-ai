import { buildTable, type DataError, type Table } from '../compute/data.ts'
import { inlineText, type StructuredDocument, type TableCell } from '../compute/document.ts'

/**
 * A table inside a document, taken out as a table.
 *
 * A report that came in as a PDF or a Word file, or that Orion wrote, often has the numbers somebody wants in a
 * table in the middle of it. Inside a document a table is text laid out in a grid; taken out, it is typed columns
 * that can be sorted, totalled and drawn. This is the step between the two, and it is deterministic: the first row
 * is the headings, the rest are the rows, and the types are worked out from the values by the same inference a
 * pasted CSV goes through. Nothing is filled in. A merged cell covers its columns with its text in the first and
 * blanks in the rest, because repeating it would invent values that were not written.
 */

export interface DocumentTable {
  /** Which table in the document, counted from 1. */
  index: number
  caption: string
  /** Data rows -- the heading row is not counted. */
  rows: number
  columns: number
  /** The headings, as far as there are any, so a person can tell the tables apart. */
  headings: string[]
}

const cellText = (cell: TableCell): string => inlineText(cell.content).replace(/\s+/g, ' ').trim()

/** A row as plain cells, with a merged cell spread over the columns it covers. */
const spread = (row: readonly TableCell[], width: number): string[] => {
  const out: string[] = []
  for (const cell of row) {
    out.push(cellText(cell))
    for (let extra = 1; extra < Math.max(1, cell.colSpan); extra++) out.push('')
  }
  while (out.length < width) out.push('')
  return out.slice(0, width)
}

const tableBlocks = (document: StructuredDocument) => document.blocks.filter((one): one is Extract<StructuredDocument['blocks'][number], { kind: 'table' }> => one.kind === 'table')

/** The tables a document holds, described, without their contents. */
export function tablesIn(document: StructuredDocument): DocumentTable[] {
  return tableBlocks(document).map((block, i) => ({
    index: i + 1,
    caption: block.caption,
    rows: Math.max(0, block.rows.length - 1),
    columns: block.columns,
    headings: block.rows.length > 0 ? spread(block.rows[0], block.columns).slice(0, 12) : []
  }))
}

/** One of a document's tables as a table. `index` counts from 1. */
export function extractTable(document: StructuredDocument, index: number, source: string): Table | DataError {
  const blocks = tableBlocks(document)
  if (blocks.length === 0) return { error: 'invalid-argument', message: 'There is no table in this document.' }
  const block = blocks[index - 1]
  if (!Number.isInteger(index) || !block) {
    return { error: 'invalid-argument', message: `This document has ${blocks.length} table${blocks.length === 1 ? '' : 's'}; there is no table ${index}.` }
  }
  if (block.rows.length === 0 || block.columns === 0) return { error: 'no-columns', message: `Table ${index} is empty.` }

  // A heading that is blank or used twice still has to name a column, so it is named by where it is.
  const seen = new Set<string>()
  const headings = spread(block.rows[0], block.columns).map((raw, at) => {
    let name = raw === '' ? `Column ${at + 1}` : raw
    for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${raw === '' ? `Column ${at + 1}` : raw} (${n})`
    seen.add(name.toLowerCase())
    return name
  })
  return buildTable(
    headings,
    block.rows.slice(1).map((row) => spread(row, block.columns)),
    { source }
  )
}
