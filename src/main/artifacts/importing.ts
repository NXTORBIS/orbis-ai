import { checkSyntax, CODE_LIMITS, CODE_ONLY_EXTENSIONS, languageForFile } from '../../shared/artifacts/languages.ts'
import { compileJavaScript } from './codeCheck.ts'
import { basename, extname } from 'node:path'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { buildTable, formatDate, isDataError } from '../../shared/compute/data.ts'
import { emptyDocument, fromHtml, isDocumentError, text, type Block } from '../../shared/compute/document.ts'
import { flattenJson, isInterchangeError, stageImport, type FormatId } from '../../shared/compute/interchange.ts'
import type { ArtifactBody } from '../../shared/artifacts/model.ts'
import { safeName } from '../../shared/artifacts/naming.ts'

/**
 * A file read into something Orbis can keep.
 *
 * The text formats go through `stageImport`, which already detects the format from three kinds of evidence, decodes
 * the bytes honestly, and holds the result without committing it; everything it says about the file -- the
 * delimiter it chose, the bytes it could not decode, the tags it removed -- is carried into the artifact's notes.
 * Three binary formats are read here: a workbook with exceljs, a Word document through mammoth into HTML and then
 * through the same allow-list importer any HTML goes through, and a PDF's text layer with pdf.js. Nothing is fetched
 * and nothing in an imported file is ever run.
 *
 * What cannot be read is said: a PDF gives its text and not its layout, a workbook gives one sheet, a deck is not
 * read at all. A note is written for each, because a file that imported "fine" with half of it missing is the
 * failure nobody notices.
 */

export const IMPORT_LIMITS = Object.freeze({
  /** Bytes of one file. */
  bytes: 50 * 1024 * 1024,
  /** Pages of a PDF read for text. */
  pdfPages: 400,
  /** Characters of text taken from a PDF. */
  pdfChars: 2_000_000
})

export interface Imported {
  body: ArtifactBody
  title: string
  source: string
  format: FormatId
  notes: string[]
}

export type ImportOutcome = Imported | { error: string; message: string }

const titleOf = (name: string): string => safeName(basename(name, extname(name)), 'Imported')

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

// ---------------------------------------------------------------- workbook

/** A cell as the text the table builder reads: a date as a date, a formula as its result, rich text as its text. */
const cellText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return formatDate(value.getTime())
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue)
    if ('richText' in v && Array.isArray(v.richText)) return (v.richText as { text: string }[]).map((one) => one.text).join('')
    if ('text' in v && typeof v.text === 'string') return v.text
    if ('error' in v) return ''
    return JSON.stringify(value)
  }
  return String(value)
}

async function readWorkbook(name: string, bytes: Uint8Array): Promise<ImportOutcome> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer)
  } catch (err) {
    return { error: 'parse', message: `The workbook could not be opened: ${err instanceof Error ? err.message.slice(0, 160) : 'unknown error'}` }
  }
  const sheet = workbook.worksheets.find((one) => one.rowCount > 0) ?? workbook.worksheets[0]
  if (!sheet) return { error: 'parse', message: 'The workbook has no sheets in it.' }

  const width = sheet.actualColumnCount
  const headerValues = (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1, width + 1)
  const headers = Array.from({ length: width }, (_, i) => cellText(headerValues[i] ?? null) || `Column ${i + 1}`)
  const rows: string[][] = []
  for (let r = 2; r <= sheet.rowCount; r++) {
    const values = (sheet.getRow(r).values as ExcelJS.CellValue[]).slice(1, width + 1)
    const row = Array.from({ length: width }, (_, i) => cellText(values[i] ?? null))
    if (row.every((one) => one === '')) continue
    rows.push(row)
  }
  const source = `file: ${basename(name)}`
  const table = buildTable(headers, rows, { source })
  if (isDataError(table)) return { error: 'parse', message: table.message }

  const notes = [`Read from the sheet "${sheet.name}".`]
  if (workbook.worksheets.length > 1) {
    notes.push(`The workbook has ${workbook.worksheets.length} sheets; only "${sheet.name}" was read. The others: ${workbook.worksheets.filter((one) => one !== sheet).map((one) => one.name).join(', ')}.`)
  }
  notes.push('Formulas were read as their last computed values. Column types were inferred from the values.')
  return { body: { kind: 'table', table }, title: titleOf(name), source, format: 'xlsx', notes }
}

// ---------------------------------------------------------------- Word

async function readWord(name: string, bytes: Uint8Array): Promise<ImportOutcome> {
  let converted: { value: string; messages: { type: string; message: string }[] }
  try {
    converted = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })
  } catch (err) {
    return { error: 'parse', message: `The Word document could not be read: ${err instanceof Error ? err.message.slice(0, 160) : 'unknown error'}` }
  }
  const parsed = fromHtml(converted.value, 'i')
  if (isDocumentError(parsed)) return { error: 'parse', message: parsed.message }
  if (parsed.blocks.length === 0) return { error: 'parse', message: 'The Word document has no text in it that Orbis could read.' }

  const document = emptyDocument('imported', titleFrom(parsed.blocks) ?? titleOf(name))
  document.blocks = parsed.blocks
  document.metadata.source = `file: ${basename(name)}`
  const notes = ['Read as Word → HTML → document: headings, paragraphs, lists and tables are kept; page layout, images, footnotes and tracked changes are not.']
  const warnings = converted.messages.filter((one) => one.type === 'warning').map((one) => one.message)
  if (warnings.length > 0) notes.push(`The reader warned: ${[...new Set(warnings)].slice(0, 5).join('; ')}.`)
  if (parsed.removed.length > 0) notes.push(`Removed on import: ${parsed.removed.map((one) => `${one.count} <${one.tag}>`).join(', ')}.`)
  return { body: { kind: 'document', document }, title: document.metadata.title, source: document.metadata.source, format: 'docx', notes }
}

const titleFrom = (blocks: readonly Block[]): string | null => {
  const first = blocks.find((one) => one.kind === 'heading' && one.level === 1) ?? blocks.find((one) => one.kind === 'heading')
  if (!first || first.kind !== 'heading') return null
  const value = first.content.map((one) => ('text' in one ? one.text : '')).join('').trim()
  return value === '' ? null : value.slice(0, 120)
}

// ---------------------------------------------------------------- PDF

async function readPdf(name: string, bytes: Uint8Array): Promise<ImportOutcome> {
  // No fonts are loaded from the system, nothing is drawn, and the loading task is destroyed when the text is out.
  const task = pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false, stopAtErrors: false })
  let pdf: pdfjs.PDFDocumentProxy
  try {
    pdf = await task.promise
  } catch (err) {
    await task.destroy().catch(() => undefined)
    return { error: 'parse', message: `The PDF could not be opened: ${err instanceof Error ? err.message.slice(0, 160) : 'unknown error'}` }
  }
  const pages = Math.min(pdf.numPages, IMPORT_LIMITS.pdfPages)
  const paragraphs: string[] = []
  let chars = 0
  try {
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      // A line per end-of-line mark; a paragraph per blank line, with the lines of one paragraph joined by a space.
      let lines: string[] = []
      let line = ''
      for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
        if (typeof item.str !== 'string') continue
        line += item.str
        if (item.hasEOL) {
          lines.push(line.trim())
          line = ''
        }
      }
      if (line.trim() !== '') lines.push(line.trim())
      let current: string[] = []
      const flush = (): void => {
        if (current.length > 0) paragraphs.push(current.join(' '))
        current = []
      }
      for (const one of lines) {
        if (one === '') flush()
        else current.push(one)
      }
      flush()
      lines = []
      chars += lines.length
      chars = paragraphs.reduce((n, one) => n + one.length, 0)
      page.cleanup()
      if (chars > IMPORT_LIMITS.pdfChars) break
    }
  } finally {
    await task.destroy().catch(() => undefined)
  }
  const kept = paragraphs.filter((one) => one.trim() !== '')
  if (kept.length === 0) return { error: 'parse', message: 'The PDF has no text layer Orbis could read. A scanned PDF is a picture of text, and Orbis does not read pictures of text yet.' }

  const document = emptyDocument('imported', titleOf(name))
  let n = 0
  document.blocks = kept.map((one) => ({ id: `p-${++n}`, sectionId: '', kind: 'paragraph' as const, content: [text(one)] }))
  document.metadata.source = `file: ${basename(name)}`
  const notes = [`Read the text of ${pages} page${pages === 1 ? '' : 's'}${pdf.numPages > pages ? ` of ${pdf.numPages}` : ''}. Headings, tables, images and layout are not read from a PDF; every line of text is a paragraph.`]
  if (chars > IMPORT_LIMITS.pdfChars) notes.push(`Stopped after ${IMPORT_LIMITS.pdfChars.toLocaleString('en')} characters.`)
  return { body: { kind: 'document', document }, title: document.metadata.title, source: document.metadata.source, format: 'pdf', notes }
}

// ---------------------------------------------------------------- the text formats

function readText(name: string, bytes: Uint8Array): ImportOutcome {
  const staged = stageImport({ id: 'import', source: 'local', name: basename(name), bytes: bytes.length, modifiedAt: '', provenance: `file: ${basename(name)}` }, bytes)
  if (isInterchangeError(staged)) return { error: 'parse', message: `${staged.message} ${staged.recovery}`.trim() }
  const source = `file: ${basename(name)}`
  const notes = [...staged.preview.notes, ...staged.preview.issues.map((one) => one.describe)]
  const format = staged.preview.file.format

  if (staged.table) {
    return { body: { kind: 'table', table: { ...staged.table, source } }, title: titleOf(name), source, format, notes }
  }
  if (staged.document) {
    const document = emptyDocument('imported', titleFrom(staged.document.blocks) ?? titleOf(name))
    document.blocks = staged.document.blocks
    document.metadata.source = source
    return { body: { kind: 'document', document }, title: document.metadata.title, source, format, notes }
  }
  if (format === 'text') {
    const paragraphs = String(staged.value ?? '')
      .split(/\r?\n\s*\r?\n/)
      .map((one) => one.replace(/\s*\r?\n\s*/g, ' ').trim())
      .filter((one) => one !== '')
    if (paragraphs.length === 0) return { error: 'parse', message: 'The file has no text in it.' }
    const document = emptyDocument('imported', titleOf(name))
    let n = 0
    document.blocks = paragraphs.map((one) => ({ id: `p-${++n}`, sectionId: '', kind: 'paragraph' as const, content: [text(one)] }))
    document.metadata.source = source
    return { body: { kind: 'document', document }, title: document.metadata.title, source, format, notes: [...notes, 'Plain text: a blank line separates paragraphs.'] }
  }
  // JSON, newline-delimited JSON: flattened into rows and columns, which is a choice that cannot be undone.
  const flat = flattenJson(staged.value)
  if (flat.columns.length === 0 || flat.rows.length === 0) return { error: 'parse', message: 'The file holds no rows Orbis could turn into a table.' }
  const table = buildTable(flat.columns, flat.rows.map((row) => flat.columns.map((column) => row[column] ?? '')), { source })
  if (isDataError(table)) return { error: 'parse', message: table.message }
  return { body: { kind: 'table', table }, title: titleOf(name), source, format, notes: [...notes, ...flat.notes, 'Nested values were flattened into dotted column names; the nesting cannot be recovered from the table.'] }
}

// ---------------------------------------------------------------- the door

/** A file's bytes read into a table or a document, with what was lost said. */
/** A source file, kept character for character. */
function readSource(name: string, bytes: Uint8Array, language: string): ImportOutcome {
  if (bytes.includes(0)) return { error: 'parse', message: 'That file has bytes in it that no source file has. It was not opened.' }
  const source = decode(bytes).replace(/^\uFEFF/, '')
  if (source.trim() === '') return { error: 'parse', message: 'The file has no text in it.' }
  if (source.length > CODE_LIMITS.characters) {
    return { error: 'too-large', message: `That file is ${source.length.toLocaleString('en')} characters, past the ${CODE_LIMITS.characters.toLocaleString('en')} one code artifact holds.` }
  }
  const syntax = checkSyntax(language, source, compileJavaScript)
  const from = `file: ${basename(name)}`
  return { body: { kind: 'code', code: { language, source } }, title: titleOf(name), source: from, format: 'code', notes: ['Kept exactly as it was in the file. Orbis did not run it.', syntax.message] }
}

export async function importFile(name: string, bytes: Uint8Array): Promise<ImportOutcome> {
  if (bytes.length === 0) return { error: 'parse', message: 'The file is empty.' }
  if (bytes.length > IMPORT_LIMITS.bytes) {
    return { error: 'too-large', message: `That file is ${(bytes.length / (1024 * 1024)).toFixed(1)} MB, past the ${IMPORT_LIMITS.bytes / (1024 * 1024)} MB Orbis reads at once.` }
  }
  const ext = extname(name).toLowerCase()
  const zip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
  if (ext === '.xlsx' && zip) return readWorkbook(name, bytes)
  if (ext === '.docx' && zip) return readWord(name, bytes)
  if (ext === '.pptx') return { error: 'unsupported', message: 'Orbis does not read PowerPoint decks yet. It can write them.' }
  if (ext === '.pdf' || decode(bytes.subarray(0, 5)) === '%PDF-') return readPdf(name, bytes)
  if (zip) return { error: 'unsupported', message: 'That is an archive or an Office file Orbis does not read.' }
  // A source file is kept as the file it is. JSON, HTML and XML keep opening as the table or document they hold,
  // which is what they were opened as before there was such a thing as a code artifact.
  const language = languageForFile(name)
  if (language && CODE_ONLY_EXTENSIONS.includes(ext)) return readSource(name, bytes, language.id)
  return readText(name, bytes)
}
