import { CODE_LIMITS, LANGUAGES, languageById } from './languages.ts'
import type { ColumnType } from '../compute/data.ts'
import type { FormatId } from '../compute/interchange.ts'
import { ARTIFACT_KINDS, canWrite, defaultFormatFor, isArtifactKindId, type ArtifactKindId } from './kinds.ts'
import { isProjectProblem, makeProject, PROJECT_LIMITS, type Project } from './project.ts'

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

export interface DiagramProposal {
  nodes: { id: string; label: string; shape: 'step' | 'decision' | 'start' | 'end' }[]
  edges: { from: string; to: string; label: string }[]
}

export interface CodeProposal {
  /** A language id from the languages table. */
  language: string
  source: string
}

export type Proposal =
  | { intent: CreationIntent; table: TableProposal; markdown?: undefined; diagram?: undefined; code?: undefined; project?: undefined }
  | { intent: CreationIntent; markdown: string; table?: undefined; diagram?: undefined; code?: undefined; project?: undefined }
  | { intent: CreationIntent; diagram: DiagramProposal; table?: undefined; markdown?: undefined; code?: undefined; project?: undefined }
  | { intent: CreationIntent; code: CodeProposal; table?: undefined; markdown?: undefined; diagram?: undefined; project?: undefined }
  /** Several files at once. Already through `makeProject`, so every path in it has been checked, not tidied. */
  | { intent: CreationIntent; project: Project; table?: undefined; markdown?: undefined; diagram?: undefined; code?: undefined }

const SHAPES = ['step', 'decision', 'start', 'end'] as const
const DIAGRAM = Object.freeze({ nodes: 120, edges: 300, label: 80, id: 40 })

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
  const nameable = Object.keys(ARTIFACT_KINDS).filter((one) => ARTIFACT_KINDS[one as ArtifactKindId].orionMayName)
  if (!isArtifactKindId(kind) || !ARTIFACT_KINDS[kind].orionMayName) {
    error(`"kind" has to be one of: ${nameable.join(', ')}. It was "${kind || 'missing'}".${kind === 'plot' ? ' A chart is made from a table’s own numbers, not written: propose the table.' : ''}`)
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

  if (kind === 'diagram') {
    if (!Array.isArray(r.nodes) || r.nodes.length === 0) {
      error('A diagram needs "nodes": a list of {id, label, shape?}, at least one.')
      return { proposal: null, problems }
    }
    if (r.nodes.length > DIAGRAM.nodes) error(`A diagram may have at most ${DIAGRAM.nodes} nodes; this has ${r.nodes.length}.`)
    const ids = new Set<string>()
    const nodes: DiagramProposal['nodes'] = []
    r.nodes.slice(0, DIAGRAM.nodes).forEach((one, i) => {
      const node = (typeof one === 'object' && one !== null ? one : {}) as Record<string, unknown>
      const id = str(node.id, DIAGRAM.id).replace(/[^A-Za-z0-9_-]/g, '_')
      const label = str(node.label, DIAGRAM.label)
      if (id === '') {
        error(`nodes[${i}] has no id.`)
        return
      }
      if (ids.has(id)) {
        error(`Two nodes have the id "${id}".`)
        return
      }
      if (label === '') {
        error(`nodes[${i}] ("${id}") has no label.`)
        return
      }
      const shape = str(node.shape, 20).toLowerCase()
      if (shape !== '' && !(SHAPES as readonly string[]).includes(shape)) {
        error(`nodes[${i}] ("${id}") has shape "${shape}", which is not one of: ${SHAPES.join(', ')}.`)
        return
      }
      ids.add(id)
      nodes.push({ id, label, shape: shape === '' ? 'step' : (shape as DiagramProposal['nodes'][number]['shape']) })
    })
    const edges: DiagramProposal['edges'] = []
    if (r.edges !== undefined) {
      if (!Array.isArray(r.edges)) error('"edges" has to be a list of {from, to, label?}.')
      else {
        if (r.edges.length > DIAGRAM.edges) error(`A diagram may have at most ${DIAGRAM.edges} edges; this has ${r.edges.length}.`)
        r.edges.slice(0, DIAGRAM.edges).forEach((one, i) => {
          const edge = (typeof one === 'object' && one !== null ? one : {}) as Record<string, unknown>
          const from = str(edge.from, DIAGRAM.id).replace(/[^A-Za-z0-9_-]/g, '_')
          const to = str(edge.to, DIAGRAM.id).replace(/[^A-Za-z0-9_-]/g, '_')
          if (!ids.has(from) || !ids.has(to)) {
            error(`edges[${i}] joins "${from || '?'}" to "${to || '?'}", and ${!ids.has(from) ? `"${from || '?'}"` : `"${to || '?'}"`} is not a node.`)
            return
          }
          edges.push({ from, to, label: str(edge.label, DIAGRAM.label) })
        })
      }
    }
    if (typeof r.markdown === 'string' && r.markdown.trim() !== '') warn('"markdown" was given for a diagram and is ignored.')
    return { proposal: buildable(problems) ? { intent, diagram: { nodes, edges } } : null, problems }
  }

  /*
   * A project: several files at once.
   *
   * Nothing here decides whether a path is allowed. `makeProject` does, with the same check the portable-package
   * reader uses, and its refusal is handed back word for word as the problem the next attempt is shown -- so a model
   * that wrote `../secrets.env` is told exactly that and nothing is repaired behind its back.
   */
  if (kind === 'project') {
    if (!Array.isArray(r.files) || r.files.length === 0) {
      error('A project needs "files": a list of {"path", "source"}, at least one. "entry" names the file it starts at.')
      return { proposal: null, problems }
    }
    if (r.files.length > PROJECT_LIMITS.files) error(`A project may hold at most ${PROJECT_LIMITS.files} files; this has ${r.files.length}.`)
    const given = r.files.slice(0, PROJECT_LIMITS.files).map((one) => {
      const file = (typeof one === 'object' && one !== null ? one : {}) as Record<string, unknown>
      return { path: file.path, source: typeof file.source === 'string' ? file.source : file.code }
    })
    const made = makeProject(given, str(r.entry, PROJECT_LIMITS.pathLength))
    if (isProjectProblem(made)) {
      error(made.message)
      return { proposal: null, problems }
    }
    if (typeof r.markdown === 'string' && r.markdown.trim() !== '') warn('"markdown" was given for a project and is ignored.')
    return { proposal: buildable(problems) ? { intent, project: made } : null, problems }
  }

  if (kind === 'code') {
    const named = str(r.language, 40)
    const language = languageById(named)
    if (!language) error(`"language" has to be one of: ${LANGUAGES.map((one) => one.id).join(', ')}. It was "${named || 'missing'}".`)
    const source = typeof r.code === 'string' ? r.code : ''
    if (source.trim() === '') error('Code needs "code": the whole file, as text.')
    if (source.length > CODE_LIMITS.characters) error(`The file is ${source.length.toLocaleString('en')} characters, past the ${CODE_LIMITS.characters.toLocaleString('en')} one file may hold.`)
    if (/^\s*```/.test(source)) error('"code" has to be the file itself, with no Markdown fence around it.')
    if (typeof r.markdown === 'string' && r.markdown.trim() !== '') warn('"markdown" was given for code and is ignored.')
    return { proposal: buildable(problems) && language ? { intent, code: { language: language.id, source } } : null, problems }
  }

  const markdown = typeof r.markdown === 'string' ? r.markdown : ''
  if (markdown.trim() === '') error('A document needs "markdown": the whole document, written as Markdown.')
  if (markdown.length > PLAN_LIMITS.markdown) error(`The document is ${markdown.length.toLocaleString('en')} characters, past the ${PLAN_LIMITS.markdown.toLocaleString('en')} one document may hold.`)
  if (Array.isArray(r.columns)) warn('"columns" were given for a document and are ignored.')
  return { proposal: buildable(problems) ? { intent, markdown } : null, problems }
}
