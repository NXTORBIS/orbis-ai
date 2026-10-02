import type { ColumnType } from '../compute/data.ts'
import type { FormatId } from '../compute/interchange.ts'
import { ARTIFACT_KINDS, canWrite, defaultFormatFor, isArtifactKindId, type ArtifactKindId } from './kinds.ts'

/**
 * What Orion proposes to make, checked before anything is made.
 *
 * A model is asked for one JSON object: what kind of thing, what to call it, and the content -- columns and rows for
 * a table, Markdown for a document. Everything in that object is untrusted until it has been through here. The rules
 * are deny-by-default: a kind that is not in the kinds table is refused, a format the kind cannot be written in is
 * refused, a table with no columns is refused, and every string is bounded.
 *
 * Problems come back as a list with a severity, in sentences, because the list is what the second attempt is given.
 * "columns[2] has no name" is something a model can fix; "invalid" is not.
 */

export const PLAN_LIMITS = Object.freeze({
  request: 4000,
  title: 120,
  purpose: 400,
  columns: 64,
  rows: 500,
  cell: 2000,
  markdown: 200_000
})

const COLUMN_TYPES: readonly ColumnType[] = Object.freeze(['text', 'number', 'integer', 'boolean', 'date', 'category', 'quantity'])

export interface CreationIntent {
  kind: ArtifactKindId
  title: string
  format: FormatId
  purpose: string
}

export interface TableProposal {
  columns: { name: string; type: ColumnType | undefined; unit: string | undefined }[]
  /** Rows a model wrote. They are examples by definition, and are labelled as such wherever they go. */
  rows: string[][]
}

export type Proposal = { intent: CreationIntent; table: TableProposal; markdown?: undefined } | { intent: CreationIntent; markdown: string; table?: undefined }

export interface Problem {
  severity: 'error' | 'warning'
  message: string
}

export const buildable = (problems: readonly Problem[]): boolean => problems.every((one) => one.severity !== 'error')

const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/** A cell as text, from whatever a model put there. Numbers and booleans are written out; nothing else is. */
const cellText = (value: unknown): string | null => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.slice(0, PLAN_LIMITS.cell)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return null
}

/** A proposal read from a model's answer, with everything wrong with it named. */
export function readProposal(raw: unknown): { proposal: Proposal | null; problems: Problem[] } {
  const problems: Problem[] = []
  const error = (message: string): void => {
    problems.push({ severity: 'error', message })
  }
  const warn = (message: string): void => {
    problems.push({ severity: 'warning', message })
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    error('The answer has to be one JSON object.')
    return { proposal: null, problems }
  }
  const r = raw as Record<string, unknown>

  const kind = str(r.kind, 40).toLowerCase()
  if (!isArtifactKindId(kind)) {
    error(`"kind" has to be one of: ${Object.keys(ARTIFACT_KINDS).join(', ')}. It was "${kind || 'missing'}".`)
    return { proposal: null, problems }
  }

  const title = str(r.title, PLAN_LIMITS.title)
  if (title === '') error('"title" is missing. Give it a short name a person would call it.')
  const purpose = str(r.purpose, PLAN_LIMITS.purpose)

  let format: FormatId = defaultFormatFor(kind)
  const wanted = str(r.format, 20).toLowerCase()
  if (wanted !== '') {
    if (canWrite(kind, wanted)) format = wanted
    else error(`A ${ARTIFACT_KINDS[kind].name.toLowerCase()} cannot be written as "${wanted}". Choose one of: ${ARTIFACT_KINDS[kind].writes.join(', ')}.`)
  }

  const intent: CreationIntent = { kind, title: title || ARTIFACT_KINDS[kind].name, format, purpose }

  if (kind === 'table') {
    if (!Array.isArray(r.columns) || r.columns.length === 0) {
      error('A table needs "columns": a list of {name, type?, unit?}, at least one.')
      return { proposal: null, problems }
    }
    if (r.columns.length > PLAN_LIMITS.columns) error(`A table may have at most ${PLAN_LIMITS.columns} columns; this has ${r.columns.length}.`)
    const taken = new Set<string>()
    const columns: TableProposal['columns'] = []
    r.columns.slice(0, PLAN_LIMITS.columns).forEach((one, i) => {
      const col = (typeof one === 'object' && one !== null ? one : {}) as Record<string, unknown>
      const name = str(typeof one === 'string' ? one : col.name, 80)
      if (name === '') {
        error(`columns[${i}] has no name.`)
        return
      }
      const key = name.toLowerCase()
      if (taken.has(key)) {
        error(`Two columns are called "${name}". Every column needs its own name.`)
        return
      }
      taken.add(key)
      const type = str(col.type, 20).toLowerCase()
      if (type !== '' && !(COLUMN_TYPES as readonly string[]).includes(type)) {
        error(`columns[${i}] ("${name}") has type "${type}", which is not one of: ${COLUMN_TYPES.join(', ')}.`)
        return
      }
      const unit = str(col.unit, 30)
      columns.push({ name, type: type === '' ? undefined : (type as ColumnType), unit: unit === '' ? undefined : unit })
    })

    const rows: string[][] = []
    if (r.rows !== undefined) {
      if (!Array.isArray(r.rows)) error('"rows" has to be a list of rows, each a list of cell values.')
      else {
        if (r.rows.length > PLAN_LIMITS.rows) error(`At most ${PLAN_LIMITS.rows} example rows may be written; this has ${r.rows.length}.`)
        r.rows.slice(0, PLAN_LIMITS.rows).forEach((row, i) => {
          if (!Array.isArray(row)) {
            error(`rows[${i}] is not a list.`)
            return
          }
          if (row.length > columns.length) error(`rows[${i}] has ${row.length} cells for ${columns.length} columns.`)
          const cells: string[] = []
          row.slice(0, columns.length).forEach((cell, c) => {
            const text = cellText(cell)
            if (text === null) error(`rows[${i}][${c}] is not text, a number or true/false.`)
            else cells.push(text)
          })
          rows.push(cells)
        })
      }
    }
    if (rows.length > 0) warn(`${rows.length} example row${rows.length === 1 ? '' : 's'} ${rows.length === 1 ? 'was' : 'were'} written by a model. They are examples, not records of anything.`)
    if (typeof r.markdown === 'string' && r.markdown.trim() !== '') warn('"markdown" was given for a table and is ignored.')

    return { proposal: buildable(problems) ? { intent, table: { columns, rows } } : null, problems }
  }

  const markdown = typeof r.markdown === 'string' ? r.markdown : ''
  if (markdown.trim() === '') error('A document needs "markdown": the whole document, written as Markdown.')
  if (markdown.length > PLAN_LIMITS.markdown) error(`The document is ${markdown.length.toLocaleString('en')} characters, past the ${PLAN_LIMITS.markdown.toLocaleString('en')} one document may hold.`)
  if (Array.isArray(r.columns)) warn('"columns" were given for a document and are ignored.')
  return { proposal: buildable(problems) ? { intent, markdown } : null, problems }
}
