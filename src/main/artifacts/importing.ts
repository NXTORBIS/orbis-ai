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
import { readDeck } from './deck.ts'
import { familyOf } from '../../shared/artifacts/media.ts'
import { importMedia } from './media.ts'
import { askToSend, isPicturesError, looksScanned, pagePicturesIn, readPictures, type PictureReaderDeps } from './scanned.ts'
import { isProjectProblem, makeProject, PROJECT_LIMITS, projectListing } from '../../shared/artifacts/project.ts'
import { isZipError, readDirectory, readEntry } from '../../shared/portable/zip.ts'
import { inflateRawSync } from 'node:zlib'

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
 * What cannot be read is said: a PDF gives its text and not its layout, a workbook gives one sheet, a deck gives its
 * words and not its pictures (see deck.ts). A note is written for each, because a file that imported "fine" with half of it missing is the
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
  /**
   * The content bytes, for a kind whose bytes cannot be rebuilt from its body.
   *
   * A picture, a sound and a video only. Every other reader leaves it out, and the one write then takes the bytes it
   * renders from the body as it always has.
   */
  bytes?: Uint8Array
}

/** A PDF that is pictures of pages, and what it would take to read them. The ask is the words to show. */
export interface ScannedOffer {
  pages: number
  to: 'Mistral'
  ask: string
}

export type ImportOutcome = Imported | { error: string; message: string; scanned?: ScannedOffer }

/** What a caller may hand in: a way to read a scanned page, and the person's yes for this file. */
export interface ImportOptions {
  scanned?: { deps: PictureReaderDeps; consent: unknown }
  /**
   * Why nothing here can read a picture, when nothing can.
   *
   * Given instead of `scanned`, and it stops the offer being made at all. Asking somebody whether to send pictures
   * to a service that is not set up would be a question whose yes could only end in a refusal.
   */
  cannotRead?: string
}

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

async function readPdf(name: string, bytes: Uint8Array, options: ImportOptions = {}): Promise<ImportOutcome> {
  /*
   * No fonts are loaded from the system, nothing is drawn, and the loading task is destroyed when the text is out.
   *
   * It is handed a COPY of the bytes, and that is not caution. pdf.js takes ownership of the array it is given and
   * detaches its buffer, so after this line the caller's `bytes` would be zero length -- which is exactly what
   * happened the first time the scanned branch below tried to lift the page pictures out of the same file and was
   * told it was empty. One extra copy of a file that is at most 50 MB, for a reader that can still look at it.
   */
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, stopAtErrors: false })
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
  if (kept.length === 0) {
    /*
     * No words in it. Is it a scan?
     *
     * A scan is one photograph per page stored inside the PDF, so the pictures are lifted out as they are and
     * counted against the pages. Reading the words in them means a model, and the pictures would leave this
     * computer -- so the first answer is the question, with the number of pages and where they would go, and
     * nothing is sent. The second request carries the person's yes.
     */
    const shots = pagePicturesIn(bytes)
    const scan = isPicturesError(shots) ? null : looksScanned({ pages, characters: chars }, shots.pictures)
    if (!isPicturesError(shots) && scan?.scanned) {
      if (!options.scanned) {
        if (options.cannotRead) {
          return {
            error: 'parse',
            message: `This PDF has no words in it to read -- its ${pages} ${pages === 1 ? 'page is a picture' : 'pages are pictures'}. ${options.cannotRead}`
          }
        }
        const ask = askToSend(shots.pictures.length, 'pages')
        return { error: 'scanned', message: ask, scanned: { pages: shots.pictures.length, to: 'Mistral', ask } }
      }
      const read = await readPictures(shots.pictures, options.scanned.deps, options.scanned.consent)
      if (!read.ok) {
        return read.needs === 'consent'
          ? { error: 'scanned', message: read.ask, scanned: { pages: read.pages, to: 'Mistral', ask: read.ask } }
          : { error: 'parse', message: read.message }
      }
      const scanDocument = emptyDocument('imported', titleOf(name))
      scanDocument.blocks = read.blocks ?? []
      scanDocument.metadata.source = `file: ${basename(name)}`
      return {
        body: { kind: 'document', document: scanDocument },
        title: scanDocument.metadata.title,
        source: scanDocument.metadata.source,
        format: 'pdf',
        notes: [...read.notes, shots.note, ...shots.skipped]
      }
    }
    const why = isPicturesError(shots) ? ` ${shots.message}` : shots.skipped.length > 0 ? ` ${shots.skipped.join(' ')}` : scan ? ` ${scan.why}` : ''
    return { error: 'parse', message: `The PDF has no text layer Orbis could read, and no page picture it could read either.${why}` }
  }

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

// ---------------------------------------------------------------- an archive of text files

/**
 * A zip read as a project: every entry's text, with its path.
 *
 * A project holds text files and nothing else, so an entry whose bytes are not text is left out and counted rather
 * than kept as something it is not. Every path goes through `makeProject`, which uses the same check the archive
 * reader itself used -- so there is one answer to "may this path be a file here" and not two -- and a path it refuses
 * means the entry is left out with the reason, never repaired.
 */
function readArchive(name: string, bytes: Uint8Array): ImportOutcome {
  const listing = readDirectory(bytes)
  if (isZipError(listing)) return { error: 'parse', message: `That archive could not be read: ${listing.message}` }
  const files: { path: string; source: string }[] = []
  const left: string[] = []
  let binary = 0
  let folders = 0
  for (const entry of listing) {
    if (entry.path.endsWith('/')) {
      folders += 1
      continue
    }
    if (files.length >= PROJECT_LIMITS.files) {
      left.push(`"${entry.path}" was left out: a project holds ${PROJECT_LIMITS.files} files at most.`)
      continue
    }
    const data = readEntry(bytes, entry, (chunk) => new Uint8Array(inflateRawSync(chunk)))
    if (isZipError(data)) {
      left.push(`"${entry.path}" could not be read out of the archive: ${data.message}`)
      continue
    }
    if (data.includes(0)) {
      binary += 1
      continue
    }
    files.push({ path: entry.path, source: decode(data).replace(/^﻿/, '') })
  }
  if (files.length === 0) {
    return {
      error: 'parse',
      message: `That archive holds no text files Orbis could read as a project${binary > 0 ? `: ${binary} of its ${listing.length - folders} entries are not text` : ''}. A project holds named text files only.`
    }
  }
  const project = makeProject(files)
  if (isProjectProblem(project)) return { error: project.error === 'parse' ? 'parse' : 'bad-input', message: project.message }
  const source = `file: ${basename(name)}`
  const notes = [
    `Read from an archive: ${projectListing(project, 40)}. It is taken to start at ${project.entry}.`,
    'Every file is kept exactly as it was in the archive. Orbis has not run any of it.'
  ]
  if (binary > 0) notes.push(`${binary} ${binary === 1 ? 'entry was' : 'entries were'} left out because they are not text. A project holds text files only.`)
  if (left.length > 0) notes.push(...left.slice(0, 8))
  return { body: { kind: 'project', project }, title: titleOf(name), source, format: 'zip', notes }
}

export async function importFile(name: string, bytes: Uint8Array, options: ImportOptions = {}): Promise<ImportOutcome> {
  if (bytes.length === 0) return { error: 'parse', message: 'The file is empty.' }
  if (bytes.length > IMPORT_LIMITS.bytes) {
    return { error: 'too-large', message: `That file is ${(bytes.length / (1024 * 1024)).toFixed(1)} MB, past the ${IMPORT_LIMITS.bytes / (1024 * 1024)} MB Orbis reads at once.` }
  }
  const ext = extname(name).toLowerCase()
  const zip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
  if (ext === '.xlsx' && zip) return readWorkbook(name, bytes)
  if (ext === '.docx' && zip) return readWord(name, bytes)
  if (ext === '.pptx' && zip) return readDeck(name, bytes)
  if (ext === '.pdf' || decode(bytes.subarray(0, 5)) === '%PDF-') return readPdf(name, bytes, options)
  if (zip) return readArchive(name, bytes)
  /*
   * A picture, a sound or a video, decided by its first bytes and never by its name.
   *
   * Gating on the signature rather than the extension is the point: a text file can never fall in here, and a `.png`
   * that holds a JPEG is refused by the reader with both facts in the sentence rather than kept under the wrong name.
   * SVG is left out -- it is markup, and Orbis's own drawings are SVG.
   */
  const family = familyOf(bytes)
  if (family !== null && family !== 'svg') {
    const made = importMedia(name, bytes)
    if ('error' in made) return { error: made.error, message: made.message }
    // The format is the kind: one format each, and what the saved file is called comes from the bytes.
    return { body: made.body, title: made.title, source: made.source, format: made.body.kind, notes: made.notes, bytes: made.bytes }
  }
  // A source file is kept as the file it is. JSON, HTML and XML keep opening as the table or document they hold,
  // which is what they were opened as before there was such a thing as a code artifact.
  const language = languageForFile(name)
  if (language && CODE_ONLY_EXTENSIONS.includes(ext)) return readSource(name, bytes, language.id)
  return readText(name, bytes)
}
