/**
 * Structured documents.
 *
 * Text is structured information first and rendered content second. Everything here follows from that: a document is a
 * list of typed blocks with typed inline runs, and the Markdown and HTML at either end are import and export formats
 * rather than the storage.
 *
 * ## Why not store HTML
 *
 * Storing a document as an HTML string makes four things impossible at once. An outline has to be recovered by parsing.
 * A reference to "Figure 3" cannot be renumbered when a figure moves. A diff can only be character-level, so moving a
 * paragraph reads as deleting and re-adding it. And every import becomes an injection question, because the storage
 * format is also an execution format.
 *
 * ## Sanitising
 *
 * `fromHtml` is an allow-list. Anything not named is dropped, along with its attributes; `script`, `style`, `iframe`,
 * `object` and their contents go entirely. A deny-list would be the wrong shape -- it has to be complete to be correct,
 * and the set of things a browser will execute is not a list anybody finishes.
 *
 * ## Counting
 *
 * Word counts are exact, because exact is available. Reading time is an estimate and is labelled one, with the rate it
 * used attached, because a number of minutes with no stated rate is a number nobody can check.
 */

export interface DocumentError {
  error: string
  message: string
}

export const isDocumentError = (value: unknown): value is DocumentError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): DocumentError => ({ error, message })

export const DOCUMENT_LIMITS: Readonly<
  Record<'blocks' | 'inlineRuns' | 'textLength' | 'tableRows' | 'tableColumns' | 'depth' | 'importBytes' | 'variables', number>
> = Object.freeze({
  blocks: 20_000,
  inlineRuns: 500,
  textLength: 200_000,
  tableRows: 5_000,
  tableColumns: 200,
  depth: 8,
  importBytes: 8 * 1024 * 1024,
  variables: 200
})

// ---------------------------------------------------------------- inline

export type MarkKind = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'highlight' | 'subscript' | 'superscript'

/** One run of text with the marks that apply to all of it. Marks are a set, never nested spans. */
export interface TextRun {
  kind: 'text'
  text: string
  marks: MarkKind[]
}

export interface LinkRun {
  kind: 'link'
  text: string
  href: string
  marks: MarkKind[]
  /** Whether the target is inside this document. An internal link is checked; an external one is not followed. */
  internal: boolean
}

export interface MathRun {
  kind: 'math'
  /** The expression as text. Never rendered here; a renderer gets the source, not a picture. */
  source: string
}

export interface ReferenceRun {
  kind: 'reference'
  /** The id of the block being referred to. The number shown is computed at render, never stored. */
  targetId: string
  /** What sort of thing is being referred to, which decides the numbering sequence it belongs to. */
  as: 'figure' | 'table' | 'equation' | 'section' | 'block'
}

export interface CitationRun {
  kind: 'citation'
  sourceId: string
  /** A page or locator inside the source. Stored as given; never parsed into a range. */
  locator: string
}

export interface FootnoteRun {
  kind: 'footnote'
  noteId: string
}

export type Inline = TextRun | LinkRun | MathRun | ReferenceRun | CitationRun | FootnoteRun

export const text = (value: string, marks: MarkKind[] = []): TextRun => ({ kind: 'text', text: value, marks: [...marks] })

/** The plain text of a run, for counting and searching. A reference contributes nothing, because its text is computed. */
export function runText(one: Inline): string {
  switch (one.kind) {
    case 'text':
    case 'link':
      return one.text
    case 'math':
      return one.source
    case 'reference':
    case 'citation':
    case 'footnote':
      return ''
  }
}

export const inlineText = (runs: readonly Inline[]): string => runs.map(runText).join('')

// ---------------------------------------------------------------- blocks

export type ListStyle = 'bullet' | 'ordered' | 'task'

export interface TableCell {
  content: Inline[]
  /** How many columns or rows this cell covers. One unless it was merged. */
  colSpan: number
  rowSpan: number
  header: boolean
  align: 'left' | 'center' | 'right'
}

export interface BlockBase {
  id: string
  /** Which section this block belongs to, for the outline. Derived, never authored. */
  sectionId: string
}

export type Block = BlockBase &
  (
    | { kind: 'paragraph'; content: Inline[] }
    | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; content: Inline[] }
    | { kind: 'list'; style: ListStyle; items: { content: Inline[]; checked: boolean; depth: number }[] }
    | { kind: 'quote'; content: Inline[]; attribution: string }
    | { kind: 'code'; language: string; source: string; showLineNumbers: boolean }
    | { kind: 'equation'; source: string; label: string }
    | { kind: 'table'; columns: number; rows: TableCell[][]; caption: string; label: string }
    | { kind: 'image'; source: string; alt: string; caption: string; label: string }
    | { kind: 'callout'; tone: 'note' | 'warning' | 'success' | 'danger'; title: string; content: Inline[] }
    | { kind: 'divider' }
    | { kind: 'footnote'; noteId: string; content: Inline[] }
    /** A result from elsewhere in Orbis, kept as a reference with a snapshot, not as a picture. */
    | {
        kind: 'embed'
        source: { pageId: string; outputId: string; describe: string }
        snapshot: string
        /** Whether the snapshot still corresponds to the source. Set by the host, never guessed here. */
        live: boolean
        takenAt: string
      }
  )

export type BlockKind = Block['kind']

export interface DocumentMetadata {
  title: string
  /** Never invented. An empty author is an empty author, not "Unknown". */
  author: string
  createdAt: string
  modifiedAt: string
  language: string
  tags: string[]
  version: number
  source: string
  provenance: string
}

export interface StructuredDocument {
  id: string
  metadata: DocumentMetadata
  blocks: Block[]
  /** Named values a template resolves. Resolved from real state, never filled in with a plausible default. */
  variables: Record<string, string>
}

export const emptyDocument = (id: string, title = ''): StructuredDocument => ({
  id,
  metadata: {
    title,
    author: '',
    createdAt: '',
    modifiedAt: '',
    language: 'en',
    tags: [],
    version: 1,
    source: '',
    provenance: ''
  },
  blocks: [],
  variables: {}
})

/** The plain text of a block. Used by counting, searching and the analysis, so it lives in one place. */
export function blockText(block: Block): string {
  switch (block.kind) {
    case 'paragraph':
    case 'heading':
    case 'quote':
      return inlineText(block.content)
    case 'callout':
      return block.title === '' ? inlineText(block.content) : `${block.title} ${inlineText(block.content)}`
    case 'list':
      return block.items.map((one) => inlineText(one.content)).join('\n')
    case 'code':
      return block.source
    case 'equation':
      return block.source
    case 'table':
      return block.rows.map((row) => row.map((cell) => inlineText(cell.content)).join(' ')).join('\n')
    case 'image':
      return [block.alt, block.caption].filter((one) => one !== '').join(' ')
    case 'footnote':
      return inlineText(block.content)
    case 'embed':
      return block.source.describe
    case 'divider':
      return ''
  }
}

// ---------------------------------------------------------------- sections and outline

export interface OutlineEntry {
  id: string
  /** The heading block this section starts at. */
  blockId: string
  level: number
  title: string
  /** A dotted number computed from position, like `2.1.3`. Recomputed on every call, never stored. */
  number: string
  /** How many blocks belong to this section, including those in its subsections. */
  blockCount: number
  children: OutlineEntry[]
}

/**
 * The outline, computed from the headings.
 *
 * Numbering is positional and derived. Storing "2.1" on a heading would mean every insertion higher up left a document
 * full of wrong numbers, and the wrongness would be invisible until somebody read it.
 *
 * A heading that skips a level -- an `h3` directly under an `h1` -- is placed under the nearest shallower heading
 * rather than being refused. Refusing would lose the document; the skip is reported by `analyse` instead.
 */
export function outlineOf(document: StructuredDocument): OutlineEntry[] {
  const roots: OutlineEntry[] = []
  const stack: OutlineEntry[] = []
  const counters: number[] = []
  let sinceHeading = new Map<string, number>()

  for (const block of document.blocks) {
    if (block.kind !== 'heading') {
      const owner = stack[stack.length - 1]
      if (owner) sinceHeading.set(owner.id, (sinceHeading.get(owner.id) ?? 0) + 1)
      continue
    }
    while (stack.length > 0 && stack[stack.length - 1].level >= block.level) {
      stack.pop()
      counters.pop()
    }
    // Pad the counters when a level is skipped, so `1` followed by an h3 numbers as `1.0.1` rather than losing a place.
    while (counters.length < block.level - 1) counters.push(0)
    counters.length = block.level - 1
    counters.push((countAt(roots, stack, block.level) ?? 0) + 1)

    const entry: OutlineEntry = {
      id: block.id,
      blockId: block.id,
      level: block.level,
      title: inlineText(block.content),
      number: counters.join('.'),
      blockCount: 0,
      children: []
    }
    if (stack.length === 0) roots.push(entry)
    else stack[stack.length - 1].children.push(entry)
    stack.push(entry)
  }

  // Block counts are filled in afterwards, walking the document once more, because a section's extent is "until the
  // next heading of the same or a shallower level" and that is only known once the whole list has been seen.
  sinceHeading = new Map()
  const flat: OutlineEntry[] = []
  const collect = (entries: OutlineEntry[]): void => {
    for (const entry of entries) {
      flat.push(entry)
      collect(entry.children)
    }
  }
  collect(roots)
  const positions = new Map(flat.map((one) => [one.id, document.blocks.findIndex((b) => b.id === one.id)]))
  for (const entry of flat) {
    const start = positions.get(entry.id) ?? 0
    let end = document.blocks.length
    for (let i = start + 1; i < document.blocks.length; i++) {
      const block = document.blocks[i]
      if (block.kind === 'heading' && block.level <= entry.level) {
        end = i
        break
      }
    }
    entry.blockCount = end - start - 1
  }

  return roots
}

/** How many siblings a heading at this level already has, for the numbering. */
function countAt(roots: OutlineEntry[], stack: OutlineEntry[], level: number): number {
  const siblings = stack.length === 0 ? roots : stack[stack.length - 1].children
  return siblings.filter((one) => one.level === level).length
}

/** The section each block belongs to, so a block knows where it sits without the outline being walked again. */
export function assignSections(document: StructuredDocument): StructuredDocument {
  let current = ''
  const blocks = document.blocks.map((block) => {
    if (block.kind === 'heading') current = block.id
    return block.sectionId === current ? block : { ...block, sectionId: current }
  })
  return { ...document, blocks }
}

// ---------------------------------------------------------------- numbering and references

export interface NumberedThing {
  blockId: string
  as: 'figure' | 'table' | 'equation'
  number: number
  label: string
  caption: string
}

/**
 * The numbers figures, tables and equations carry.
 *
 * Positional, and each kind counts separately. This is the machinery that makes "Figure 3" survive a figure being
 * inserted above it: nothing stores the 3, so nothing has to be updated.
 */
export function numbering(document: StructuredDocument): NumberedThing[] {
  const counts = { figure: 0, table: 0, equation: 0 }
  const out: NumberedThing[] = []
  for (const block of document.blocks) {
    if (block.kind === 'image') {
      counts.figure += 1
      out.push({ blockId: block.id, as: 'figure', number: counts.figure, label: block.label, caption: block.caption })
    } else if (block.kind === 'table') {
      counts.table += 1
      out.push({ blockId: block.id, as: 'table', number: counts.table, label: block.label, caption: block.caption })
    } else if (block.kind === 'equation') {
      counts.equation += 1
      out.push({ blockId: block.id, as: 'equation', number: counts.equation, label: block.label, caption: '' })
    }
  }
  return out
}

export interface ReferenceCheck {
  runsTo: { blockId: string; as: string; resolved: boolean; display: string }[]
  broken: { blockId: string; as: string }[]
}

/** Every reference resolved to the text it should display, and the ones that point at nothing. */
export function resolveReferences(document: StructuredDocument): ReferenceCheck {
  const numbered = new Map(numbering(document).map((one) => [one.blockId, one]))
  const sections = new Map<string, string>()
  const walk = (entries: OutlineEntry[]): void => {
    for (const entry of entries) {
      sections.set(entry.blockId, entry.number)
      walk(entry.children)
    }
  }
  walk(outlineOf(document))

  const runsTo: ReferenceCheck['runsTo'] = []
  const broken: ReferenceCheck['broken'] = []
  for (const block of document.blocks) {
    for (const run of inlineRunsOf(block)) {
      if (run.kind !== 'reference') continue
      if (run.as === 'section') {
        const number = sections.get(run.targetId)
        if (number === undefined) broken.push({ blockId: run.targetId, as: run.as })
        else runsTo.push({ blockId: run.targetId, as: run.as, resolved: true, display: `Section ${number}` })
        continue
      }
      const thing = numbered.get(run.targetId)
      if (!thing) {
        broken.push({ blockId: run.targetId, as: run.as })
        continue
      }
      const name = thing.as.charAt(0).toUpperCase() + thing.as.slice(1)
      runsTo.push({ blockId: run.targetId, as: run.as, resolved: true, display: `${name} ${thing.number}` })
    }
  }
  return { runsTo, broken }
}

/** Every inline run inside a block, wherever it lives. Used by anything that walks the inline layer. */
export function inlineRunsOf(block: Block): Inline[] {
  switch (block.kind) {
    case 'paragraph':
    case 'heading':
    case 'quote':
    case 'callout':
    case 'footnote':
      return block.content
    case 'list':
      return block.items.flatMap((one) => one.content)
    case 'table':
      return block.rows.flatMap((row) => row.flatMap((cell) => cell.content))
    default:
      return []
  }
}

// ---------------------------------------------------------------- citations

export interface Source {
  id: string
  /** A citation is never fabricated. A source with no title is a source with no title. */
  title: string
  authors: string[]
  year: string
  publisher: string
  url: string
  accessed: string
  kind: 'article' | 'book' | 'web' | 'report' | 'dataset' | 'other'
}

export type CitationStyle = 'apa' | 'mla' | 'chicago' | 'ieee'

/**
 * A bibliography entry, formatted from what the source actually holds.
 *
 * Missing fields are left out rather than filled in. A citation with an invented year is worse than a citation with no
 * year: the second is obviously incomplete and the first is quietly wrong.
 */
export function formatCitation(source: Source, style: CitationStyle, index = 1): string {
  const authors = source.authors.filter((one) => one.trim() !== '')
  const parts: string[] = []

  /**
   * A field with its trailing punctuation, added only when it is not already there.
   *
   * An author list is very often written "Rao, S." with the initial's own full stop, and appending another gives
   * "Rao, S..". Bibliographic fields carry punctuation of their own, so every one of them has to be joined this way.
   */
  const ending = (value: string, mark: string): string => (value.endsWith(mark) ? value : `${value}${mark}`)

  switch (style) {
    case 'apa':
      if (authors.length > 0) parts.push(ending(authors.join(', '), '.'))
      if (source.year !== '') parts.push(`(${source.year}).`)
      if (source.title !== '') parts.push(ending(source.title, '.'))
      if (source.publisher !== '') parts.push(ending(source.publisher, '.'))
      if (source.url !== '') parts.push(source.url)
      break

    case 'mla':
      if (authors.length > 0) parts.push(ending(authors.join(', '), '.'))
      if (source.title !== '') parts.push(`"${ending(source.title, '.')}"`)
      if (source.publisher !== '') parts.push(ending(source.publisher, ','))
      if (source.year !== '') parts.push(`${source.year}.`)
      if (source.url !== '') parts.push(source.url)
      break

    case 'chicago':
      if (authors.length > 0) parts.push(ending(authors.join(', '), '.'))
      if (source.title !== '') parts.push(ending(source.title, '.'))
      if (source.publisher !== '') parts.push(source.publisher)
      if (source.year !== '') parts.push(`${source.year}.`)
      if (source.url !== '') parts.push(source.url)
      break

    case 'ieee':
      parts.push(`[${index}]`)
      if (authors.length > 0) parts.push(ending(authors.join(', '), ','))
      if (source.title !== '') parts.push(`"${ending(source.title, ',')}"`)
      if (source.publisher !== '') parts.push(ending(source.publisher, ','))
      if (source.year !== '') parts.push(`${source.year}.`)
      if (source.url !== '') parts.push(source.url)
      break
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** Which citations point at a source that is not in the list, and which sources nothing cites. */
export function checkCitations(
  document: StructuredDocument,
  sources: readonly Source[]
): { missing: string[]; uncited: string[]; incomplete: { id: string; fields: string[] }[] } {
  const known = new Map(sources.map((one) => [one.id, one]))
  const used = new Set<string>()
  const missing = new Set<string>()

  for (const block of document.blocks) {
    for (const run of inlineRunsOf(block)) {
      if (run.kind !== 'citation') continue
      if (known.has(run.sourceId)) used.add(run.sourceId)
      else missing.add(run.sourceId)
    }
  }

  const incomplete = sources
    .map((one) => {
      const fields: string[] = []
      if (one.title === '') fields.push('title')
      if (one.authors.length === 0) fields.push('author')
      if (one.year === '') fields.push('year')
      if (one.kind === 'web' && one.url === '') fields.push('url')
      return { id: one.id, fields }
    })
    .filter((one) => one.fields.length > 0)

  return {
    missing: [...missing],
    uncited: sources.filter((one) => !used.has(one.id)).map((one) => one.id),
    incomplete
  }
}

// ---------------------------------------------------------------- Markdown

/**
 * Markdown to blocks.
 *
 * A deliberately small dialect: headings, lists, tables, code fences, quotes, rules, images and the inline marks. That
 * is what the document model has blocks for, and parsing a construct with nowhere to put it would mean either losing
 * it or inventing a block kind at import time.
 *
 * Anything unrecognised becomes a paragraph rather than being dropped. Losing a line because the parser did not know
 * what it was is the worst failure an importer has.
 */
export function fromMarkdown(source: string, idPrefix = 'b'): { blocks: Block[]; notes: string[] } | DocumentError {
  if (source.length > DOCUMENT_LIMITS.textLength) {
    return fail('too-large', `That is ${source.length.toLocaleString('en')} characters, past the ${DOCUMENT_LIMITS.textLength.toLocaleString('en')} a document can be imported from at once.`)
  }

  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  const notes: string[] = []
  let counter = 0
  const nextId = (): string => `${idPrefix}${++counter}`

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i += 1
      continue
    }

    // Fenced code. The fence length is remembered so a fence inside a longer fence does not end it.
    const fence = /^(`{3,}|~{3,})\s*(\S*)\s*$/.exec(line)
    if (fence) {
      const marker = fence[1][0]
      const length = fence[1].length
      const language = fence[2]
      const body: string[] = []
      i += 1
      let closed = false
      while (i < lines.length) {
        const candidate = new RegExp(`^${marker === '`' ? '`' : '~'}{${length},}\\s*$`).exec(lines[i])
        if (candidate) {
          closed = true
          i += 1
          break
        }
        body.push(lines[i])
        i += 1
      }
      if (!closed) notes.push('A code fence was never closed, so it runs to the end of the document.')
      blocks.push({ id: nextId(), sectionId: '', kind: 'code', language, source: body.join('\n'), showLineNumbers: false })
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({
        id: nextId(),
        sectionId: '',
        kind: 'heading',
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        content: parseInline(heading[2])
      })
      i += 1
      continue
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push({ id: nextId(), sectionId: '', kind: 'divider' })
      i += 1
      continue
    }

    // A table needs its separator row, which is what distinguishes it from a paragraph full of pipes.
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const rows: string[][] = []
      const aligns = readAlignments(lines[i + 1])
      rows.push(splitRow(line))
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]))
        i += 1
      }
      const columns = Math.max(...rows.map((one) => one.length))
      if (rows.length > DOCUMENT_LIMITS.tableRows || columns > DOCUMENT_LIMITS.tableColumns) {
        return fail('too-large', 'That table is larger than a document can hold.')
      }
      const cells: TableCell[][] = rows.map((row, r) =>
        Array.from({ length: columns }, (_, c) => ({
          content: parseInline(row[c] ?? ''),
          colSpan: 1,
          rowSpan: 1,
          header: r === 0,
          align: aligns[c] ?? 'left'
        }))
      )
      // The caption `toMarkdown` wrote under it, if there is one, comes back as the caption and not as a paragraph --
      // otherwise a document with a captioned table reads back one block longer than it was written.
      const captioned = captionAfter(lines, i)
      blocks.push({ id: nextId(), sectionId: '', kind: 'table', columns, rows: cells, caption: captioned.caption, label: '' })
      i = captioned.next
      continue
    }

    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      const body: string[] = [quote[1]]
      i += 1
      while (i < lines.length) {
        const more = /^>\s?(.*)$/.exec(lines[i])
        if (!more) break
        body.push(more[1])
        i += 1
      }
      blocks.push({ id: nextId(), sectionId: '', kind: 'quote', content: parseInline(body.join(' ')), attribution: '' })
      continue
    }

    const listStart = listItem(line)
    if (listStart) {
      const items: { content: Inline[]; checked: boolean; depth: number }[] = []
      const style = listStart.style
      while (i < lines.length) {
        const item = listItem(lines[i])
        if (!item || item.style !== style) break
        items.push({ content: parseInline(item.text), checked: item.checked, depth: item.depth })
        i += 1
      }
      blocks.push({ id: nextId(), sectionId: '', kind: 'list', style, items })
      continue
    }

    // A paragraph runs until a blank line or the start of something else.
    const body: string[] = [line]
    i += 1
    while (i < lines.length && lines[i].trim() !== '' && !startsSomething(lines[i])) {
      body.push(lines[i])
      i += 1
    }
    blocks.push({ id: nextId(), sectionId: '', kind: 'paragraph', content: parseInline(body.join(' ')) })
  }

  if (blocks.length > DOCUMENT_LIMITS.blocks) {
    return fail('too-large', `That is ${blocks.length.toLocaleString('en')} blocks, past the ${DOCUMENT_LIMITS.blocks.toLocaleString('en')} a document can hold.`)
  }
  return { blocks, notes }
}

const startsSomething = (line: string): boolean =>
  /^(#{1,6})\s/.test(line) ||
  /^(`{3,}|~{3,})/.test(line) ||
  /^>\s?/.test(line) ||
  /^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line) ||
  listItem(line) !== null

function listItem(line: string): { style: ListStyle; text: string; checked: boolean; depth: number } | null {
  const bullet = /^(\s*)([-*+])\s+(.*)$/.exec(line)
  if (bullet) {
    const task = /^\[([ xX])\]\s+(.*)$/.exec(bullet[3])
    const depth = Math.floor(bullet[1].length / 2)
    if (task) return { style: 'task', text: task[2], checked: task[1].toLowerCase() === 'x', depth }
    return { style: 'bullet', text: bullet[3], checked: false, depth }
  }
  const ordered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line)
  if (ordered) return { style: 'ordered', text: ordered[3], checked: false, depth: Math.floor(ordered[1].length / 2) }
  return null
}

/**
 * The caption `toMarkdown` writes under a table or an image, read back as a caption.
 *
 * The writer puts the caption on its own line as `*caption*`. Read as ordinary Markdown that is an italic paragraph,
 * and a document with three captioned tables comes back three blocks longer than it went out -- which the read-back
 * check then reports as a copy that does not match. So an italic-only line that directly follows a table or an image
 * is the caption. That is the one convention the pair agrees on.
 */
function captionAfter(lines: readonly string[], from: number): { caption: string; next: number } {
  let i = from
  while (i < lines.length && lines[i].trim() === '') i += 1
  const match = i < lines.length ? /^\*([^*]+)\*\s*$/.exec(lines[i]) : null
  if (!match) return { caption: '', next: from }
  return { caption: match[1].trim(), next: i + 1 }
}

const splitRow = (line: string): string[] =>
  line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((one) => one.trim())

function readAlignments(line: string): ('left' | 'center' | 'right')[] {
  return splitRow(line).map((one) => {
    const left = one.startsWith(':')
    const right = one.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })
}

/**
 * Inline Markdown into runs.
 *
 * Scanned left to right with an explicit mark set rather than by nesting, because the model has no nested spans: a run
 * is text plus the marks that apply to all of it, which is both simpler to reason about and what a diff can compare.
 */
export function parseInline(source: string): Inline[] {
  const runs: Inline[] = []
  let buffer = ''
  const marks = new Set<MarkKind>()

  const flush = (): void => {
    if (buffer === '') return
    runs.push(text(buffer, [...marks]))
    buffer = ''
  }

  let i = 0
  while (i < source.length) {
    const rest = source.slice(i)

    // Code spans take everything literally, so they are matched before anything else.
    const code = /^`([^`]+)`/.exec(rest)
    if (code) {
      flush()
      runs.push(text(code[1], [...marks, 'code']))
      i += code[0].length
      continue
    }

    const math = /^\$([^$]+)\$/.exec(rest)
    if (math) {
      flush()
      runs.push({ kind: 'math', source: math[1] })
      i += math[0].length
      continue
    }

    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest)
    if (image) {
      // An image inside a paragraph becomes a link to it: the block model has images as blocks, and silently promoting
      // a paragraph to an image block would reorder the document.
      flush()
      runs.push({ kind: 'link', text: image[1] === '' ? image[2] : image[1], href: image[2], marks: [...marks], internal: isInternal(image[2]) })
      i += image[0].length
      continue
    }

    const link = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest)
    if (link) {
      flush()
      runs.push({ kind: 'link', text: link[1], href: link[2], marks: [...marks], internal: isInternal(link[2]) })
      i += link[0].length
      continue
    }

    const footnote = /^\[\^([A-Za-z0-9_-]+)\]/.exec(rest)
    if (footnote) {
      flush()
      runs.push({ kind: 'footnote', noteId: footnote[1] })
      i += footnote[0].length
      continue
    }

    if (rest.startsWith('**') || rest.startsWith('__')) {
      flush()
      toggle(marks, 'bold')
      i += 2
      continue
    }
    if (rest.startsWith('~~')) {
      flush()
      toggle(marks, 'strike')
      i += 2
      continue
    }
    if (rest.startsWith('==')) {
      flush()
      toggle(marks, 'highlight')
      i += 2
      continue
    }
    if (rest[0] === '*' || rest[0] === '_') {
      flush()
      toggle(marks, 'italic')
      i += 1
      continue
    }
    if (rest[0] === '\\' && rest.length > 1) {
      // An escape puts the next character in literally, which is how a document contains an asterisk.
      buffer += rest[1]
      i += 2
      continue
    }

    buffer += rest[0]
    i += 1
  }
  flush()

  if (runs.length > DOCUMENT_LIMITS.inlineRuns) return runs.slice(0, DOCUMENT_LIMITS.inlineRuns)
  return runs
}

const toggle = (marks: Set<MarkKind>, mark: MarkKind): void => {
  if (marks.has(mark)) marks.delete(mark)
  else marks.add(mark)
}

const isInternal = (href: string): boolean => href.startsWith('#')

/** Blocks back to Markdown. A round trip is not guaranteed to be identical, only to mean the same thing. */
export function toMarkdown(document: StructuredDocument): string {
  const out: string[] = []
  for (const block of document.blocks) {
    switch (block.kind) {
      case 'heading':
        out.push(`${'#'.repeat(block.level)} ${serialiseInline(block.content)}`)
        break
      case 'paragraph':
        out.push(serialiseInline(block.content))
        break
      case 'quote':
        out.push(
          serialiseInline(block.content)
            .split('\n')
            .map((one) => `> ${one}`)
            .join('\n')
        )
        break
      case 'code':
        out.push(`\`\`\`${block.language}\n${block.source}\n\`\`\``)
        break
      case 'equation':
        out.push(`$$\n${block.source}\n$$`)
        break
      case 'divider':
        out.push('---')
        break
      case 'list':
        out.push(
          block.items
            .map((item) => {
              const indent = '  '.repeat(Math.max(0, item.depth))
              if (block.style === 'ordered') return `${indent}1. ${serialiseInline(item.content)}`
              if (block.style === 'task') return `${indent}- [${item.checked ? 'x' : ' '}] ${serialiseInline(item.content)}`
              return `${indent}- ${serialiseInline(item.content)}`
            })
            .join('\n')
        )
        break
      case 'table': {
        const rows = block.rows.map((row) => `| ${row.map((cell) => serialiseInline(cell.content)).join(' | ')} |`)
        const separator = `| ${block.rows[0]?.map((cell) => (cell.align === 'center' ? ':---:' : cell.align === 'right' ? '---:' : '---')).join(' | ') ?? ''} |`
        out.push([rows[0], separator, ...rows.slice(1)].filter((one) => one !== undefined).join('\n'))
        if (block.caption !== '') out.push(`*${block.caption}*`)
        break
      }
      case 'image':
        out.push(`![${block.alt}](${block.source})`)
        if (block.caption !== '') out.push(`*${block.caption}*`)
        break
      case 'callout':
        out.push(`> **${block.title || block.tone}** ${serialiseInline(block.content)}`)
        break
      case 'footnote':
        out.push(`[^${block.noteId}]: ${serialiseInline(block.content)}`)
        break
      case 'embed':
        // The snapshot, plus where it came from. An embed exported as a bare value would lose the fact that it is one.
        out.push(`> ${block.source.describe}: ${block.snapshot}`)
        break
    }
  }
  return out.join('\n\n')
}

function serialiseInline(runs: readonly Inline[]): string {
  return runs
    .map((run) => {
      switch (run.kind) {
        case 'text':
        case 'link': {
          let value = run.text
          if (run.marks.includes('code')) value = `\`${value}\``
          if (run.marks.includes('bold')) value = `**${value}**`
          if (run.marks.includes('italic')) value = `*${value}*`
          if (run.marks.includes('strike')) value = `~~${value}~~`
          if (run.marks.includes('highlight')) value = `==${value}==`
          return run.kind === 'link' ? `[${value}](${run.href})` : value
        }
        case 'math':
          return `$${run.source}$`
        case 'footnote':
          return `[^${run.noteId}]`
        case 'citation':
          return `[@${run.sourceId}${run.locator === '' ? '' : ` ${run.locator}`}]`
        case 'reference':
          return `[#${run.targetId}]`
      }
    })
    .join('')
}

// ---------------------------------------------------------------- HTML

/**
 * The tags an import may keep, and what each becomes.
 *
 * An allow-list. Everything not here is dropped, and for the four in `STRIPPED` the contents go too -- a `<script>`
 * whose text survived as a paragraph would put the script's source into the document as prose.
 */
const HTML_BLOCKS: Record<string, BlockKind | 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'heading5' | 'heading6'> = {
  p: 'paragraph',
  h1: 'heading1',
  h2: 'heading2',
  h3: 'heading3',
  h4: 'heading4',
  h5: 'heading5',
  h6: 'heading6',
  blockquote: 'quote',
  pre: 'code',
  ul: 'list',
  ol: 'list',
  table: 'table',
  hr: 'divider'
}

const STRIPPED = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg'])

const HTML_MARKS: Record<string, MarkKind> = {
  b: 'bold',
  strong: 'bold',
  i: 'italic',
  em: 'italic',
  u: 'underline',
  s: 'strike',
  del: 'strike',
  code: 'code',
  mark: 'highlight',
  sub: 'subscript',
  sup: 'superscript'
}

export interface HtmlImport {
  blocks: Block[]
  /** What was removed, so an import is not silently lossy. */
  removed: { tag: string; count: number }[]
  notes: string[]
}

/**
 * HTML into blocks, with everything unsafe removed.
 *
 * This is a small tokeniser rather than a DOM parse, because it runs in the main process where there is no DOM and
 * because the output is a fixed block model: anything it cannot place becomes text, which is the safe direction to
 * fail in.
 */
export function fromHtml(source: string, idPrefix = 'h'): HtmlImport | DocumentError {
  if (source.length > DOCUMENT_LIMITS.textLength) {
    return fail('too-large', `That is ${source.length.toLocaleString('en')} characters, past the ${DOCUMENT_LIMITS.textLength.toLocaleString('en')} that can be imported at once.`)
  }

  const removed = new Map<string, number>()
  let cleaned = source

  // Comments first: a comment can contain anything, including an unbalanced tag that would confuse the scan.
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '')

  for (const tag of STRIPPED) {
    const pattern = new RegExp(`<${tag}\\b[\\s\\S]*?(?:</${tag}\\s*>|$)`, 'gi')
    cleaned = cleaned.replace(pattern, () => {
      removed.set(tag, (removed.get(tag) ?? 0) + 1)
      return ''
    })
    // A self-closing or unmatched opening tag of a stripped kind goes too.
    const lone = new RegExp(`<${tag}\\b[^>]*/?>`, 'gi')
    cleaned = cleaned.replace(lone, () => {
      removed.set(tag, (removed.get(tag) ?? 0) + 1)
      return ''
    })
  }

  const blocks: Block[] = []
  let counter = 0
  const nextId = (): string => `${idPrefix}${++counter}`

  const blockPattern = /<(p|h[1-6]|blockquote|pre|ul|ol|table|hr)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<(hr)\b[^>]*\/?>/gi
  let lastIndex = 0
  let match: RegExpExecArray | null
  const loose: string[] = []

  while ((match = blockPattern.exec(cleaned)) !== null) {
    const before = cleaned.slice(lastIndex, match.index)
    const beforeText = stripTags(before, removed)
    if (beforeText.trim() !== '') loose.push(beforeText.trim())
    lastIndex = blockPattern.lastIndex

    const tag = (match[1] ?? match[4]).toLowerCase()
    const inner = match[3] ?? ''
    const kind = HTML_BLOCKS[tag]

    if (kind === 'divider') {
      blocks.push({ id: nextId(), sectionId: '', kind: 'divider' })
      continue
    }
    if (typeof kind === 'string' && kind.startsWith('heading')) {
      blocks.push({
        id: nextId(),
        sectionId: '',
        kind: 'heading',
        level: Number(kind.slice(7)) as 1 | 2 | 3 | 4 | 5 | 6,
        content: htmlInline(inner, removed)
      })
      continue
    }
    if (kind === 'code') {
      blocks.push({ id: nextId(), sectionId: '', kind: 'code', language: '', source: decodeEntities(stripTags(inner, removed)), showLineNumbers: false })
      continue
    }
    if (kind === 'quote') {
      blocks.push({ id: nextId(), sectionId: '', kind: 'quote', content: htmlInline(inner, removed), attribution: '' })
      continue
    }
    if (kind === 'list') {
      const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)].map((one) => ({
        content: htmlInline(one[1], removed),
        checked: false,
        depth: 0
      }))
      blocks.push({ id: nextId(), sectionId: '', kind: 'list', style: tag === 'ol' ? 'ordered' : 'bullet', items })
      continue
    }
    if (kind === 'table') {
      const rowMatches = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)]
      const rows: TableCell[][] = rowMatches.map((row) =>
        [...row[1].matchAll(/<(t[dh])\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)].map((cell) => ({
          content: htmlInline(cell[3], removed),
          colSpan: readSpan(cell[2], 'colspan'),
          rowSpan: readSpan(cell[2], 'rowspan'),
          header: cell[1].toLowerCase() === 'th',
          align: 'left' as const
        }))
      )
      if (rows.length > DOCUMENT_LIMITS.tableRows) return fail('too-large', 'That table has more rows than a document can hold.')
      const columns = Math.max(0, ...rows.map((one) => one.reduce((sum, cell) => sum + cell.colSpan, 0)))
      if (columns > DOCUMENT_LIMITS.tableColumns) return fail('too-large', 'That table has more columns than a document can hold.')
      blocks.push({ id: nextId(), sectionId: '', kind: 'table', columns, rows, caption: '', label: '' })
      continue
    }
    blocks.push({ id: nextId(), sectionId: '', kind: 'paragraph', content: htmlInline(inner, removed) })
  }

  const trailing = stripTags(cleaned.slice(lastIndex), removed)
  if (trailing.trim() !== '') loose.push(trailing.trim())

  // Text outside any block tag becomes a paragraph rather than being dropped.
  for (const one of loose) {
    blocks.push({ id: nextId(), sectionId: '', kind: 'paragraph', content: parseInline(decodeEntities(one)) })
  }

  const notes: string[] = []
  if (removed.size > 0) {
    notes.push(
      `Removed on import: ${[...removed.entries()].map(([tag, count]) => `${count} <${tag}>`).join(', ')}. Imported markup is kept only where it maps onto a block or a mark; anything else, including anything executable, is dropped.`
    )
  }
  if (blocks.length > DOCUMENT_LIMITS.blocks) {
    return fail('too-large', `That is ${blocks.length.toLocaleString('en')} blocks, past the ${DOCUMENT_LIMITS.blocks.toLocaleString('en')} a document can hold.`)
  }

  return { blocks, removed: [...removed.entries()].map(([tag, count]) => ({ tag, count })), notes }
}

const readSpan = (attributes: string, name: string): number => {
  const match = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(attributes)
  const value = match ? Number(match[1]) : 1
  return Number.isFinite(value) && value >= 1 && value <= 100 ? value : 1
}

function htmlInline(source: string, removed: Map<string, number>): Inline[] {
  const runs: Inline[] = []
  const marks = new Set<MarkKind>()
  let buffer = ''

  const flush = (): void => {
    if (buffer === '') return
    runs.push(text(decodeEntities(buffer), [...marks]))
    buffer = ''
  }

  // A tag name may hold a hyphen -- every custom element has one -- and stopping at it would leave the rest as text.
  const pattern = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\s*([^>]*)>/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    buffer += source.slice(lastIndex, match.index)
    lastIndex = pattern.lastIndex
    const tag = match[1].toLowerCase()
    const closing = match[0].startsWith('</')

    if (tag === 'br') {
      buffer += '\n'
      continue
    }
    if (tag === 'a' && !closing) {
      const href = /href\s*=\s*["']([^"']*)["']/i.exec(match[2])?.[1] ?? ''
      // A link whose scheme can execute is kept as text with its target removed, not as a clickable link.
      if (href !== '' && safeHref(href)) {
        flush()
        const close = source.indexOf('</a>', lastIndex)
        const label = close === -1 ? '' : stripTags(source.slice(lastIndex, close), removed)
        runs.push({ kind: 'link', text: decodeEntities(label), href, marks: [...marks], internal: isInternal(href) })
        lastIndex = close === -1 ? lastIndex : close + 4
        pattern.lastIndex = lastIndex
      } else if (href !== '') {
        removed.set('unsafe-href', (removed.get('unsafe-href') ?? 0) + 1)
      }
      continue
    }
    if (tag === 'a' && closing) continue

    const mark = HTML_MARKS[tag]
    if (mark) {
      flush()
      if (closing) marks.delete(mark)
      else marks.add(mark)
      continue
    }
    // Any other tag contributes nothing but its text, which the buffer is already collecting.
    if (!closing && !STRIPPED.has(tag)) removed.set(tag, (removed.get(tag) ?? 0) + 1)
  }
  buffer += source.slice(lastIndex)
  flush()
  return runs.length > DOCUMENT_LIMITS.inlineRuns ? runs.slice(0, DOCUMENT_LIMITS.inlineRuns) : runs
}

/** Whether a link target is one a document may keep. An allow-list of schemes, for the same reason as the tags. */
export function safeHref(href: string): boolean {
  const trimmed = href.trim()
  if (trimmed === '') return false
  if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return true
  // The scheme is taken before any colon, so `java\nscript:` and `JaVaScRiPt:` are both caught.
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed.replace(/[\s\u0000-\u001f]/g, ''))
  if (!scheme) return true
  return ['http', 'https', 'mailto', 'orbis'].includes(scheme[1].toLowerCase())
}

const stripTags = (source: string, removed: Map<string, number>): string =>
  source.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\s*[^>]*>/g, (_all, tag: string) => {
    const name = tag.toLowerCase()
    if (!HTML_MARKS[name] && !HTML_BLOCKS[name]) removed.set(name, (removed.get(name) ?? 0) + 1)
    return ''
  })

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–'
}

export function decodeEntities(source: string): string {
  return source.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      // Only real characters, and never a surrogate half, which would produce broken text.
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return all
      return String.fromCodePoint(code)
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : all
  })
}

// ---------------------------------------------------------------- searching

export interface Match {
  blockId: string
  blockKind: BlockKind
  /** Offsets into the block's plain text, so a highlighter can mark without re-deriving the text. */
  start: number
  end: number
  excerpt: string
}

export interface SearchOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
  /** A regular expression, compiled with a guard. Rejected rather than run when it is not valid. */
  regex?: boolean
  inSections?: string[]
  limit?: number
}

/**
 * Matches inside a document, by block.
 *
 * Offsets are into each block's own plain text rather than into a flattened document, because a highlighter works on a
 * block and a global offset would have to be turned back into a block and a position anyway -- and would be wrong the
 * moment a block above changed length.
 */
export function search(document: StructuredDocument, query: string, options: SearchOptions = {}): Match[] | DocumentError {
  if (query === '') return []
  const limit = Math.max(1, Math.min(10_000, options.limit ?? 1000))

  let pattern: RegExp
  if (options.regex) {
    try {
      pattern = new RegExp(query, options.caseSensitive ? 'g' : 'gi')
    } catch (error) {
      return fail('invalid-pattern', `That is not a valid search pattern: ${error instanceof Error ? error.message : 'it could not be read'}.`)
    }
  } else {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    pattern = new RegExp(options.wholeWord ? `\\b${escaped}\\b` : escaped, options.caseSensitive ? 'g' : 'gi')
  }

  const wanted = options.inSections ? new Set(options.inSections) : null
  const matches: Match[] = []
  for (const block of document.blocks) {
    if (wanted && !wanted.has(block.sectionId)) continue
    const body = blockText(block)
    if (body === '') continue
    pattern.lastIndex = 0
    let found: RegExpExecArray | null
    while ((found = pattern.exec(body)) !== null) {
      if (found[0] === '') {
        // A pattern that matches nothing at all would loop forever; step past it instead.
        pattern.lastIndex += 1
        continue
      }
      matches.push({
        blockId: block.id,
        blockKind: block.kind,
        start: found.index,
        end: found.index + found[0].length,
        excerpt: body.slice(Math.max(0, found.index - 30), Math.min(body.length, found.index + found[0].length + 30))
      })
      if (matches.length >= limit) return matches
    }
  }
  return matches
}

/**
 * A replacement applied to the text runs of a document.
 *
 * Only text runs. Replacing inside a link's target, a citation's id or an equation's source would change what the
 * document points at rather than what it says, and a find-and-replace is not meant to do that.
 */
export function replaceAll(
  document: StructuredDocument,
  query: string,
  replacement: string,
  options: SearchOptions = {}
): { document: StructuredDocument; replaced: number } | DocumentError {
  if (query === '') return fail('invalid-argument', 'There is nothing to replace.')
  let pattern: RegExp
  if (options.regex) {
    try {
      pattern = new RegExp(query, options.caseSensitive ? 'g' : 'gi')
    } catch (error) {
      return fail('invalid-pattern', `That is not a valid search pattern: ${error instanceof Error ? error.message : 'it could not be read'}.`)
    }
  } else {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    pattern = new RegExp(options.wholeWord ? `\\b${escaped}\\b` : escaped, options.caseSensitive ? 'g' : 'gi')
  }

  let replaced = 0
  const mapRuns = (runs: Inline[]): Inline[] =>
    runs.map((run) => {
      if (run.kind !== 'text') return run
      pattern.lastIndex = 0
      const next = run.text.replace(pattern, () => {
        replaced += 1
        return replacement
      })
      return next === run.text ? run : { ...run, text: next }
    })

  const blocks = document.blocks.map((block) => {
    switch (block.kind) {
      case 'paragraph':
      case 'heading':
      case 'quote':
      case 'callout':
      case 'footnote':
        return { ...block, content: mapRuns(block.content) }
      case 'list':
        return { ...block, items: block.items.map((one) => ({ ...one, content: mapRuns(one.content) })) }
      case 'table':
        return { ...block, rows: block.rows.map((row) => row.map((cell) => ({ ...cell, content: mapRuns(cell.content) }))) }
      default:
        return block
    }
  })

  return { document: { ...document, blocks }, replaced }
}

// ---------------------------------------------------------------- deterministic transforms

export type Transform =
  | { kind: 'upper' }
  | { kind: 'lower' }
  | { kind: 'title' }
  | { kind: 'sentence' }
  | { kind: 'trim-whitespace' }
  | { kind: 'collapse-spaces' }
  | { kind: 'sort-lines'; descending: boolean }
  | { kind: 'deduplicate-lines' }

/**
 * Deterministic text transforms, kept entirely separate from anything a model does.
 *
 * The separation is the point. "Make this uppercase" has one right answer and should never involve a model; "make this
 * clearer" has no single right answer and should never be presented as if it did. Mixing them means a user cannot tell
 * which kind of operation they just ran.
 */
export function transformText(source: string, transform: Transform): string {
  switch (transform.kind) {
    case 'upper':
      return source.toUpperCase()
    case 'lower':
      return source.toLowerCase()
    case 'title':
      // Only the first letter of each word; a real title case needs a list of words to leave alone, which is a
      // language question rather than a string one.
      return source.replace(/\b[\p{L}]/gu, (one) => one.toUpperCase())
    case 'sentence':
      return source.replace(/(^|[.!?]\s+)([\p{L}])/gu, (_all, before: string, letter: string) => before + letter.toUpperCase())
    case 'trim-whitespace':
      return source
        .split('\n')
        .map((one) => one.trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    case 'collapse-spaces':
      return source.replace(/[ \t]+/g, ' ')
    case 'sort-lines': {
      const lines = source.split('\n')
      // A locale compare, so accented characters sort where a reader expects rather than by code point.
      lines.sort((a, b) => a.localeCompare(b))
      return (transform.descending ? lines.reverse() : lines).join('\n')
    }
    case 'deduplicate-lines': {
      const seen = new Set<string>()
      return source
        .split('\n')
        .filter((one) => {
          if (seen.has(one)) return false
          seen.add(one)
          return true
        })
        .join('\n')
    }
  }
}

/** Wrap at a column, without breaking a word across lines. */
export function wrapLines(source: string, columns: number): string {
  if (!Number.isFinite(columns) || columns < 10) return source
  return source
    .split('\n')
    .map((line) => {
      if (line.length <= columns) return line
      const words = line.split(/\s+/)
      const out: string[] = []
      let current = ''
      for (const word of words) {
        if (current === '') current = word
        else if (current.length + 1 + word.length <= columns) current += ` ${word}`
        else {
          out.push(current)
          current = word
        }
      }
      if (current !== '') out.push(current)
      return out.join('\n')
    })
    .join('\n')
}

// ---------------------------------------------------------------- variables and templates

export interface TemplateField {
  name: string
  describe: string
  required: boolean
}

/** The variables a document refers to, found by scanning rather than declared and possibly out of date. */
export function variablesUsed(document: StructuredDocument): string[] {
  const found = new Set<string>()
  for (const block of document.blocks) {
    for (const match of blockText(block).matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g)) {
      found.add(match[1])
    }
  }
  return [...found].sort()
}

export interface Resolution {
  document: StructuredDocument
  resolved: string[]
  /** Variables the document uses that nothing supplied. Left in place, never replaced with a plausible value. */
  unresolved: string[]
}

/**
 * Template variables replaced from real state.
 *
 * An unresolved variable stays as `{{name}}` rather than becoming an empty string. A lab report with a blank where the
 * student's name should be is a mistake somebody notices; one with the placeholder still in it is a mistake nobody can
 * miss, which is the better failure.
 */
export function resolveVariables(document: StructuredDocument, values: Record<string, string>): Resolution {
  const resolved = new Set<string>()
  const unresolved = new Set<string>()

  const substitute = (source: string): string =>
    source.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g, (all, name: string) => {
      if (!Object.prototype.hasOwnProperty.call(values, name)) {
        unresolved.add(name)
        return all
      }
      resolved.add(name)
      return values[name]
    })

  const mapRuns = (runs: Inline[]): Inline[] =>
    runs.map((run) => (run.kind === 'text' ? { ...run, text: substitute(run.text) } : run))

  const blocks = document.blocks.map((block) => {
    switch (block.kind) {
      case 'paragraph':
      case 'heading':
      case 'quote':
      case 'callout':
      case 'footnote':
        return { ...block, content: mapRuns(block.content) }
      case 'list':
        return { ...block, items: block.items.map((one) => ({ ...one, content: mapRuns(one.content) })) }
      case 'table':
        return { ...block, rows: block.rows.map((row) => row.map((cell) => ({ ...cell, content: mapRuns(cell.content) }))) }
      case 'code':
        return { ...block, source: substitute(block.source) }
      default:
        return block
    }
  })

  return {
    document: { ...document, blocks, metadata: { ...document.metadata, title: substitute(document.metadata.title) } },
    resolved: [...resolved].sort(),
    unresolved: [...unresolved].sort()
  }
}

// ---------------------------------------------------------------- schemas and validation

export interface DocumentSchema {
  id: string
  name: string
  requiredSections: { title: string; describe: string }[]
  requiredBlocks: { kind: BlockKind; atLeast: number; describe: string }[]
  requireCitations: boolean
  requireTitle: boolean
}

export interface ValidationResult {
  ok: boolean
  missing: { what: string; describe: string }[]
  notes: string[]
}

/** Whether a document meets a schema, reporting what is actually absent rather than a score. */
export function validateAgainst(document: StructuredDocument, schema: DocumentSchema, sources: readonly Source[] = []): ValidationResult {
  const missing: ValidationResult['missing'] = []
  const notes: string[] = []

  if (schema.requireTitle && document.metadata.title.trim() === '') {
    missing.push({ what: 'title', describe: 'The document has no title.' })
  }

  const headings = document.blocks
    .filter((one): one is Block & { kind: 'heading' } => one.kind === 'heading')
    .map((one) => inlineText(one.content).trim().toLowerCase())
  for (const section of schema.requiredSections) {
    if (!headings.includes(section.title.trim().toLowerCase())) {
      missing.push({ what: `section "${section.title}"`, describe: section.describe })
    }
  }

  for (const requirement of schema.requiredBlocks) {
    const count = document.blocks.filter((one) => one.kind === requirement.kind).length
    if (count < requirement.atLeast) {
      missing.push({
        what: `${requirement.atLeast} ${requirement.kind} block${requirement.atLeast === 1 ? '' : 's'}`,
        describe: `${requirement.describe} There ${count === 1 ? 'is' : 'are'} ${count}.`
      })
    }
  }

  if (schema.requireCitations) {
    const cited = new Set<string>()
    for (const block of document.blocks) {
      for (const run of inlineRunsOf(block)) if (run.kind === 'citation') cited.add(run.sourceId)
    }
    if (cited.size === 0) missing.push({ what: 'citations', describe: 'Nothing in the document cites a source.' })
    const problems = checkCitations(document, sources)
    if (problems.missing.length > 0) {
      notes.push(`${problems.missing.length} citation${problems.missing.length === 1 ? '' : 's'} point at a source that is not in the list.`)
    }
  }

  // An empty section is reported as a note rather than as missing: it exists, it just has nothing in it yet.
  const empty = outlineOf(document).flatMap(function flatten(entry): OutlineEntry[] {
    return [entry, ...entry.children.flatMap(flatten)]
  }).filter((one) => one.blockCount === 0 && one.children.length === 0)
  if (empty.length > 0) {
    notes.push(`${empty.map((one) => one.title || 'an untitled section').join(', ')} ${empty.length === 1 ? 'has' : 'have'} a heading but nothing under it.`)
  }

  return { ok: missing.length === 0, missing, notes }
}

// ---------------------------------------------------------------- analysis

export interface DocumentAnalysis {
  words: number
  characters: number
  charactersWithoutSpaces: number
  sentences: number
  paragraphs: number
  blocks: number
  /** Per kind, so "this document is mostly tables" is answerable. */
  blocksByKind: Record<string, number>
  headings: number
  /** Labelled an estimate, with the rate used attached, because a bare number of minutes is uncheckable. */
  readingMinutes: { estimate: number; wordsPerMinute: number; describe: string }
  longestSection: { title: string; blocks: number } | null
  averageSentenceWords: number | null
  repeatedWords: { word: string; count: number }[]
  problems: { kind: string; describe: string }[]
}

/** Exact counts where exact is available, and an estimate labelled as one where it is not. */
export function analyse(document: StructuredDocument, wordsPerMinute = 220): DocumentAnalysis {
  const body = document.blocks.map(blockText).filter((one) => one !== '').join('\n')
  // A word is a run of letters, digits or apostrophes. Not a split on whitespace, which counts "a -- b" as three.
  const words = body.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []
  const sentences = body.split(/[.!?]+(?:\s|$)/).filter((one) => one.trim() !== '')

  const blocksByKind: Record<string, number> = {}
  for (const block of document.blocks) blocksByKind[block.kind] = (blocksByKind[block.kind] ?? 0) + 1

  const counts = new Map<string, number>()
  for (const word of words) {
    const key = word.toLowerCase()
    if (key.length < 5) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const outline = outlineOf(document)
  const flat = outline.flatMap(function flatten(entry): OutlineEntry[] {
    return [entry, ...entry.children.flatMap(flatten)]
  })
  const longest = flat.slice().sort((a, b) => b.blockCount - a.blockCount)[0]

  const problems: DocumentAnalysis['problems'] = []
  let previous = 0
  for (const block of document.blocks) {
    if (block.kind !== 'heading') continue
    if (previous > 0 && block.level > previous + 1) {
      problems.push({
        kind: 'skipped-heading-level',
        describe: `"${inlineText(block.content)}" is a level ${block.level} heading directly under a level ${previous}. A reader following the outline loses a level, and a screen reader announces a jump.`
      })
    }
    previous = block.level
  }
  for (const entry of flat) {
    if (entry.blockCount === 0 && entry.children.length === 0) {
      problems.push({ kind: 'empty-section', describe: `"${entry.title}" has a heading but nothing under it.` })
    }
  }
  const references = resolveReferences(document)
  for (const broken of references.broken) {
    problems.push({ kind: 'broken-reference', describe: `A reference points at "${broken.blockId}", which is not in the document.` })
  }
  for (const block of document.blocks) {
    if (block.kind === 'image' && block.alt.trim() === '') {
      problems.push({ kind: 'missing-alt-text', describe: 'An image has no alternative text, so it is invisible to anyone using a screen reader.' })
    }
    for (const run of inlineRunsOf(block)) {
      if (run.kind === 'link' && !safeHref(run.href)) {
        problems.push({ kind: 'unsafe-link', describe: `A link points at "${run.href.slice(0, 60)}", which is not a target a document should carry.` })
      }
    }
  }

  return {
    words: words.length,
    characters: body.length,
    charactersWithoutSpaces: body.replace(/\s/g, '').length,
    sentences: sentences.length,
    paragraphs: document.blocks.filter((one) => one.kind === 'paragraph').length,
    blocks: document.blocks.length,
    blocksByKind,
    headings: document.blocks.filter((one) => one.kind === 'heading').length,
    readingMinutes: {
      estimate: words.length === 0 ? 0 : Math.max(1, Math.round(words.length / Math.max(1, wordsPerMinute))),
      wordsPerMinute,
      describe: `An estimate at ${wordsPerMinute} words a minute. Actual reading speed varies with the material and the reader.`
    },
    longestSection: longest ? { title: longest.title, blocks: longest.blockCount } : null,
    averageSentenceWords: sentences.length === 0 ? null : words.length / sentences.length,
    repeatedWords: [...counts.entries()]
      .filter(([, count]) => count > 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word, count]) => ({ word, count })),
    problems
  }
}

// ---------------------------------------------------------------- editing

export interface EditResult {
  document: StructuredDocument
  /** What happened, for the undo stack and the event log. One entry per user action, not one per changed field. */
  event: { kind: string; blockId: string; describe: string }
}

/** A block inserted at a position. Out-of-range positions are clamped rather than refused. */
export function insertBlock(document: StructuredDocument, block: Block, at: number): EditResult | DocumentError {
  if (document.blocks.length >= DOCUMENT_LIMITS.blocks) {
    return fail('too-large', `A document holds at most ${DOCUMENT_LIMITS.blocks.toLocaleString('en')} blocks.`)
  }
  if (document.blocks.some((one) => one.id === block.id)) {
    return fail('duplicate', `There is already a block with the id "${block.id}".`)
  }
  const index = Math.max(0, Math.min(document.blocks.length, Math.round(at)))
  const blocks = [...document.blocks.slice(0, index), block, ...document.blocks.slice(index)]
  return {
    document: assignSections({ ...document, blocks }),
    event: { kind: 'BLOCK_ADDED', blockId: block.id, describe: `A ${block.kind} was added.` }
  }
}

/**
 * A block moved to a new position.
 *
 * References survive because they are by id and numbers are computed. That is the property the whole numbering design
 * exists for: moving a figure changes what "Figure 2" means, and nothing has to be rewritten for it to be right.
 */
export function moveBlock(document: StructuredDocument, blockId: string, to: number): EditResult | DocumentError {
  const from = document.blocks.findIndex((one) => one.id === blockId)
  if (from === -1) return fail('not-found', `There is no block with the id "${blockId}".`)
  const index = Math.max(0, Math.min(document.blocks.length - 1, Math.round(to)))
  if (index === from) {
    return { document, event: { kind: 'BLOCK_MOVED', blockId, describe: 'The block did not move.' } }
  }
  const blocks = [...document.blocks]
  const [moved] = blocks.splice(from, 1)
  blocks.splice(index, 0, moved)
  return {
    document: assignSections({ ...document, blocks }),
    event: { kind: 'BLOCK_MOVED', blockId, describe: `A ${moved.kind} moved from position ${from + 1} to ${index + 1}.` }
  }
}

/** A block removed, with a warning about anything that referred to it rather than a silent break. */
export function removeBlock(document: StructuredDocument, blockId: string): (EditResult & { breaks: string[] }) | DocumentError {
  const block = document.blocks.find((one) => one.id === blockId)
  if (!block) return fail('not-found', `There is no block with the id "${blockId}".`)

  const breaks: string[] = []
  for (const other of document.blocks) {
    if (other.id === blockId) continue
    for (const run of inlineRunsOf(other)) {
      if (run.kind === 'reference' && run.targetId === blockId) breaks.push(other.id)
    }
  }

  const blocks = document.blocks.filter((one) => one.id !== blockId)
  return {
    document: assignSections({ ...document, blocks }),
    event: { kind: 'BLOCK_REMOVED', blockId, describe: `A ${block.kind} was removed.` },
    breaks
  }
}

/** A section moved, taking everything under it. The operation people actually mean by "move this section". */
export function moveSection(document: StructuredDocument, headingId: string, toIndex: number): EditResult | DocumentError {
  const start = document.blocks.findIndex((one) => one.id === headingId)
  if (start === -1) return fail('not-found', `There is no block with the id "${headingId}".`)
  const heading = document.blocks[start]
  if (heading.kind !== 'heading') return fail('invalid-argument', 'Only a heading starts a section.')

  let end = document.blocks.length
  for (let i = start + 1; i < document.blocks.length; i++) {
    const block = document.blocks[i]
    if (block.kind === 'heading' && block.level <= heading.level) {
      end = i
      break
    }
  }

  const moving = document.blocks.slice(start, end)
  const rest = [...document.blocks.slice(0, start), ...document.blocks.slice(end)]
  const index = Math.max(0, Math.min(rest.length, Math.round(toIndex)))
  const blocks = [...rest.slice(0, index), ...moving, ...rest.slice(index)]
  return {
    document: assignSections({ ...document, blocks }),
    event: {
      kind: 'SECTION_MOVED',
      blockId: headingId,
      describe: `"${inlineText(heading.content)}" moved, taking ${moving.length - 1} block${moving.length === 2 ? '' : 's'} with it.`
    }
  }
}

// ---------------------------------------------------------------- diff

export type ChangeKind = 'added' | 'removed' | 'changed' | 'moved' | 'unchanged'

export interface BlockChange {
  kind: ChangeKind
  blockId: string
  blockKind: BlockKind
  from: number | null
  to: number | null
  describe: string
}

/**
 * Two documents compared at the block level.
 *
 * Structural rather than character-level, which is what makes a moved paragraph read as moved. A character diff sees a
 * deletion at one place and an insertion at another, and a reader has to work out for themselves that they are the
 * same paragraph -- which for a long document they will not.
 */
export function diffDocuments(before: StructuredDocument, after: StructuredDocument): { changes: BlockChange[]; summary: string } {
  const beforeIndex = new Map(before.blocks.map((one, i) => [one.id, i]))
  const afterIndex = new Map(after.blocks.map((one, i) => [one.id, i]))
  const beforeById = new Map(before.blocks.map((one) => [one.id, one]))
  const afterById = new Map(after.blocks.map((one) => [one.id, one]))

  const changes: BlockChange[] = []

  for (const [id, index] of beforeIndex) {
    if (afterIndex.has(id)) continue
    const block = beforeById.get(id) as Block
    changes.push({ kind: 'removed', blockId: id, blockKind: block.kind, from: index, to: null, describe: `A ${block.kind} was removed.` })
  }

  for (const [id, index] of afterIndex) {
    const block = afterById.get(id) as Block
    const was = beforeIndex.get(id)
    if (was === undefined) {
      changes.push({ kind: 'added', blockId: id, blockKind: block.kind, from: null, to: index, describe: `A ${block.kind} was added.` })
      continue
    }
    const old = beforeById.get(id) as Block
    const changed = blockText(old) !== blockText(block) || old.kind !== block.kind
    if (changed) {
      changes.push({ kind: 'changed', blockId: id, blockKind: block.kind, from: was, to: index, describe: `A ${block.kind} was edited.` })
    } else if (was !== index) {
      changes.push({
        kind: 'moved',
        blockId: id,
        blockKind: block.kind,
        from: was,
        to: index,
        describe: `A ${block.kind} moved from position ${was + 1} to ${index + 1}, with its content unchanged.`
      })
    } else {
      changes.push({ kind: 'unchanged', blockId: id, blockKind: block.kind, from: was, to: index, describe: '' })
    }
  }

  changes.sort((a, b) => (a.to ?? a.from ?? 0) - (b.to ?? b.from ?? 0))
  const count = (kind: ChangeKind): number => changes.filter((one) => one.kind === kind).length
  const parts: string[] = []
  if (count('added') > 0) parts.push(`${count('added')} added`)
  if (count('removed') > 0) parts.push(`${count('removed')} removed`)
  if (count('changed') > 0) parts.push(`${count('changed')} changed`)
  if (count('moved') > 0) parts.push(`${count('moved')} moved`)

  return {
    changes,
    summary: parts.length === 0 ? 'Nothing changed.' : `${parts.join(', ')}; ${count('unchanged')} unchanged.`
  }
}

/** The assumptions the engine rests on, for a Page that wants to show them rather than have them inferred. */
export const DOCUMENT_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A document is stored as typed blocks. Markdown and HTML are formats it is read from and written to, not what it is.',
  'Imported markup is filtered through an allow-list. Anything not named is dropped, and what was dropped is reported.',
  'Figure, table and equation numbers are computed from position, so moving one does not leave a wrong number behind.',
  'Word counts are exact. Reading time is an estimate and says so, with the rate it used attached.',
  'An unresolved template variable stays visible rather than becoming an empty space.',
  'Deterministic transforms and model-written text are separate operations and are never presented as the same thing.',
  'A citation is formatted from what the source holds. A missing field is left out, never filled in.'
])
