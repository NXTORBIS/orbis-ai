import { existsSync } from 'node:fs'
import { readFile as readFromDisk, writeFile as writeToDisk } from 'node:fs/promises'
import { join } from 'node:path'
import { isDataError, parseDelimited, type Table } from '../../shared/compute/data.ts'
import { DOCUMENT_LIMITS, emptyDocument, fromMarkdown, isDocumentError, text as inline, type StructuredDocument, type TableCell } from '../../shared/compute/document.ts'
import { toHtml } from '../../shared/compute/documentHtml.ts'
import {
  FORMATS,
  exportDocument,
  exportTable,
  hashOf,
  isInterchangeError,
  lossFor,
  type ExportResult,
  type FormatId,
  type LossReport,
  type VerifyResult
} from '../../shared/compute/interchange.ts'
import { ARTIFACT_KINDS, canWrite, describeKinds, extensionFor, isArtifactKindId, type ArtifactKindId } from '../../shared/artifacts/kinds.ts'
import {
  isArtifactId,
  isConversationId,
  isVersionId,
  makeArtifactId,
  makeVersionId,
  refOf,
  summaryOf,
  type ArtifactBody,
  type ArtifactRecord,
  type ExportOutcome
} from '../../shared/artifacts/model.ts'
import { safeName, unique } from '../../shared/artifacts/naming.ts'
import { gateForWrite } from '../../shared/artifacts/secrets.ts'
import { verifyDocumentFile, verifyPdfFile, verifyTableFile } from '../../shared/artifacts/validate.ts'
import { longDocumentAsked, STOPPED, type ArtifactGeneration } from './generation.ts'
import { importFile } from './importing.ts'
import { verifyDocx, verifyPptx, verifyXlsx, writeDocx, writePptx, writeXlsx, type Picture } from './office.ts'
import { ArtifactStore, CONTENT_PREFIX, SOURCE_FILE } from './store.ts'
import { toDelimited } from '../../shared/compute/data.ts'
import { toText } from '../../shared/compute/documentHtml.ts'
import { analyseTable, analysisDocument } from '../../shared/artifacts/analysis.ts'
import { diagramToSvg, PIE_LIMITS, pieProblem, pieToSvg, plotToSvg, verifySvgFile } from '../../shared/artifacts/svg.ts'
import { asNumber, formatDate, type Column } from '../../shared/compute/data.ts'
import { buildPlot, isPlotError, seriesFromPoints, type Series, type SeriesKind } from '../../shared/compute/plot.ts'
import { decodePng } from '../chromium/png.ts'
import { cellOut, joinTables, type JoinKind } from '../../shared/compute/data.ts'
import { applySteps, formulaName, isTransformFailure, readSteps, type TransformStep } from '../../shared/artifacts/transform.ts'
import { listTemplates, templateById } from '../../shared/artifacts/templates.ts'
import { extractTable, tablesIn, type DocumentTable } from '../../shared/artifacts/extract.ts'
import { checkSyntax, CODE_LIMITS, extensionForLanguage, languageById, languageForFile, lineCount, LANGUAGES } from '../../shared/artifacts/languages.ts'
import { compileJavaScript } from './codeCheck.ts'
import { buildTable } from '../../shared/compute/data.ts'
import { toMarkdown } from '../../shared/compute/document.ts'

/**
 * The one door for making, keeping and exporting artifacts.
 *
 * Mirrors `pages/service.ts`: an operation is looked up in a frozen map with `hasOwnProperty`, refused if it is not
 * there, and only then carried out. Every result is an envelope -- `{ok, operation, value}` or `{ok, operation, error,
 * message}` -- and a caller reads the envelope before it reads anything inside it.
 *
 * What this file guarantees, in the order the work happens:
 *
 *   1. Nothing is written that looks like a credential, unless a person was shown each finding and said yes.
 *   2. Nothing is written anywhere a renderer named. The destination comes from a dialog that runs in the main process.
 *   3. Nothing is reported as made or saved until the file has been read back from disk and checked -- size, hash and
 *      a round trip through the parser it came from. A write that fails that check is a failure, with the checks named.
 *
 * The stored copy is the source. An export is rendered from it, never from a previous export, so three exports in three
 * formats are three readings of one thing rather than a copy of a copy. Everything rendered is bytes by the time it is
 * written: text formats are encoded, and a PDF is printed from the document's HTML by an engine handed in from outside.
 */

const LIMITS = Object.freeze({
  /** Characters of pasted text one request may carry. The same ceiling as the delimited parser's. */
  text: 4 * 1024 * 1024,
  title: 120,
  /** Characters of content handed back for a preview. A preview is for looking, not for a second export. */
  preview: 1024 * 1024,
  /** Characters of a document or flowchart handed to Orion whole for a revision. Past this the answer would not fit either. */
  revise: 12_000,
  /** How much of a table is handed back as a grid to look at. */
  gridRows: 100,
  gridColumns: 40,
  gridCell: 200
})

/** Every operation this door answers. An operation missing from here cannot run, by construction. */
const OPERATIONS: Readonly<Record<string, string>> = Object.freeze({
  'artifact.kinds': 'What Orbis can create, and in which formats.',
  'artifact.create': 'Make an artifact from text, keep it, and check the kept copy.',
  'artifact.generate': 'Make an artifact from a sentence: Orion decides what and writes it, Orbis builds, keeps and checks it.',
  'artifact.import': 'Read a file the person chooses into a table or a document, keep it, and check the kept copy.',
  'artifact.analyse': 'Analyse a table with the data engines and keep the write-up as a document. Every figure is computed.',
  'artifact.list': 'Every artifact in this profile.',
  'artifact.read': 'One artifact, with a bounded preview of its content.',
  'artifact.export': 'Write an artifact to a file the person chooses, then check the file.',
  'artifact.remove': 'Remove an artifact and its files, every version with it.',
  'artifact.update': 'Replace an artifact with new text as a new version. The old version is kept.',
  'artifact.restore': 'Make an earlier version current again, as a new version. Nothing is deleted.',
  'artifact.versions': 'Every version of an artifact: the current one and the ones before it.',
  'artifact.rename': 'Give an artifact a new name. Not a new version: the name is not the content.',
  'artifact.duplicate': 'A copy of an artifact as a new artifact that remembers where it came from.',
  'artifact.search': 'Find artifacts by words in their name, notes or content.',
  'artifact.chart': 'A chart from the columns of a table, kept as a drawing that remembers the table it came from.',
  'artifact.transform': 'A table changed by a list of steps -- filter, sort, columns, a computed column, group and total -- or by a sentence Orion turns into those steps.',
  'artifact.join': 'Two tables joined on a column, with how many rows on each side found a partner.',
  'artifact.templates': 'The starting points Orbis has: tables with their columns chosen, documents with their headings written.',
  'artifact.fromTemplate': 'A new table or document started from one of those. Structure only; no row and no sentence in it is data.',
  'artifact.revise': 'A document or a flowchart changed by an instruction, kept as a new version with the one before still there.',
  'artifact.languages': 'The languages a code artifact can be in, and which of them Orbis can check.',
  'artifact.place': 'A chart or a diagram put into a document as a figure, so the document carries the picture when it is saved as PDF, Word, slides or HTML.',
  'artifact.extractTable': 'A table inside a document taken out as a table of its own, so it can be sorted, totalled and drawn.',
  'artifact.asDocument': 'A table, a chart, a diagram or a code file put into a new document, so it can leave as PDF, Word or slides. Nothing is rewritten.',
  'artifact.download': 'Write an artifact into the Downloads folder under a name of its own, then check the file. No dialog: the folder is chosen by Orbis, never by a caller.',
  'artifact.reveal': 'Show a file this session saved in its folder, or open it. Only a file Orbis itself just wrote.'
})

const JOIN_KINDS: readonly JoinKind[] = Object.freeze(['inner', 'left', 'full'])

const SERIES_KINDS: readonly SeriesKind[] = Object.freeze(['line', 'bar', 'scatter', 'area', 'step'])

/**
 * The kind of chart a sentence names, when it names exactly one.
 *
 * "Make it a pie chart" is not a suggestion. The model that chooses the columns also offers a kind, and left to it a
 * pie that was asked for can come back as bars with nothing said. So the person's own word decides, and when it
 * cannot be drawn the reason is given instead.
 */
export function chartKindSaid(request: string): 'pie' | SeriesKind | null {
  const said: ('pie' | SeriesKind)[] = []
  if (/\bpie\b/i.test(request)) said.push('pie')
  if (/\b(bars?|bar ?chart|column chart|columns chart)\b/i.test(request)) said.push('bar')
  if (/\bline (chart|graph|plot)\b|\bas a line\b|\blines\b/i.test(request)) said.push('line')
  if (/\bscatter/i.test(request)) said.push('scatter')
  if (/\barea (chart|graph|plot)\b|\bas an area\b/i.test(request)) said.push('area')
  if (/\bstep (chart|graph|plot)\b|\bas steps\b/i.test(request)) said.push('step')
  return said.length === 1 ? said[0] : null
}

export const ARTIFACT_OPERATIONS = Object.freeze(Object.keys(OPERATIONS))

export type ArtifactResult =
  | { ok: true; operation: string; value: unknown }
  | { ok: false; operation: string; error: string; message: string; detail?: unknown }

export interface DestinationRequest {
  title: string
  defaultName: string
  filters: { name: string; extensions: string[] }[]
}

export interface ArtifactServiceOptions {
  store: ArtifactStore
  now(): number
  /** 32 hexadecimal characters of randomness. */
  random(): string
  /** Where to write. Runs a dialog in the main process; null when the person cancelled. */
  chooseDestination(request: DestinationRequest): Promise<string | null>
  /** Which file to read. Runs a dialog in the main process; null when the person cancelled. */
  chooseSource?(): Promise<string | null>
  /**
   * A page of HTML printed to PDF bytes, by a print engine that lives outside this file.
   *
   * Optional, and absent is a working state: a copy of Orbis with no print engine leaves PDF out of what it offers
   * rather than offering a button that fails.
   */
  renderPdf?(html: string): Promise<Uint8Array>
  /** An SVG drawn to PNG bytes at a size, by the same kind of hidden window. Optional for the same reason. */
  renderPng?(svg: string, width: number, height: number): Promise<Uint8Array>
  /**
   * Orion, for making something from a sentence.
   *
   * Optional for the same reason as the print engine: a copy of Orbis with no model configured has nothing to write
   * with, and the operation says so rather than vanishing.
   */
  generation?: ArtifactGeneration
  /** Writing and reading the chosen file. Injected so the service can be tested against a folder rather than a dialog. */
  writeFile?(path: string, bytes: Uint8Array): Promise<void>
  readFile?(path: string): Promise<Uint8Array>
  /**
   * The folder a download goes to. Asked of the system in the main process, so a download needs no dialog and a
   * renderer still cannot name a path. Absent, downloading is not offered and saving through the dialog still is.
   */
  downloadsDir?(): string
  /** Shows a file in its folder, or opens it with whatever the system opens it with. */
  reveal?(path: string, open: boolean): Promise<void>
}

/** What a render produced: bytes to write, the text to scan for secrets, and what the format could not carry. */
interface Rendered {
  bytes: Uint8Array
  /** The text form, when there is one. A PDF or a workbook has none, and the text it was made from is scanned instead. */
  text: string | null
  /** What the secret gate reads. The text, or for a binary format the text it was made from. */
  scan: string
  format: FormatId
  hash: string
  loss: LossReport
  notes: string[]
  /** For a deck: how many slides were written, so the read-back can count them. */
  count?: number
  /** For a picture: the size it was drawn at, so the read-back can check the image is that size. */
  size?: { width: number; height: number }
  /** For a Word document or a deck: how many figures were put in as pictures. */
  pictures?: number
}

/** A table as Markdown writes it: a line with pipes, and under it a ruled line of dashes and pipes. */
const MARKDOWN_TABLE = /^[ \t]*\|?[^\n|]*\|[^\n]*\n[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)+\|?[ \t]*$/m

/** A figure in a document that points at a chart or a diagram kept in Create. */
const FIGURE_REF = /^artifact:(artifact_[0-9a-f]{32})$/

const rowsOf = (n: number): string => `${n.toLocaleString('en')} ${n === 1 ? 'row' : 'rows'}`
const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')
const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

/** The size an SVG declares on its root, for drawing it to pixels at the size it was made. */
const svgSize = (svg: string): { width: number; height: number } => {
  const width = Number(/<svg[^>]*\swidth="(\d+)"/.exec(svg)?.[1] ?? 880)
  const height = Number(/<svg[^>]*\sheight="(\d+)"/.exec(svg)?.[1] ?? 520)
  return { width: Math.min(4000, Math.max(16, width)), height: Math.min(4000, Math.max(16, height)) }
}

/** A source file read back: the same size, the same hash, and the same characters. */
const verifySourceFile = (expected: { bytes: number; hash: string; text: string }, readBack: Uint8Array): VerifyResult => {
  const same = decode(readBack) === expected.text
  const checks: VerifyResult['checks'] = [
    { what: 'written', passed: readBack.length === expected.bytes, describe: `The file on disk is ${readBack.length.toLocaleString('en')} bytes; ${expected.bytes.toLocaleString('en')} were written.` },
    { what: 'checksum', passed: hashOf(readBack) === expected.hash, describe: 'The hash of the file on disk matches the one recorded when it was written.' },
    { what: 'same text', passed: same, describe: same ? 'Read back, it is the same text character for character.' : 'Read back, the text is not what was written.' }
  ]
  return { ok: checks.every((one) => one.passed), checks, reimported: { rows: lineCount(expected.text), columns: 0 }, differences: [] }
}

/** A PNG file read back: size, hash, the signature, and that it decodes to the size it was drawn at. */
const verifyPngFile = (expected: { bytes: number; hash: string; width: number; height: number }, readBack: Uint8Array): VerifyResult => {
  const checks: VerifyResult['checks'] = [
    { what: 'written', passed: readBack.length === expected.bytes, describe: `The file on disk is ${readBack.length.toLocaleString('en')} bytes; ${expected.bytes.toLocaleString('en')} were written.` },
    { what: 'checksum', passed: hashOf(readBack) === expected.hash, describe: 'The hash of the file on disk matches the one recorded when it was written.' }
  ]
  const signed = readBack.length > 8 && readBack[0] === 0x89 && readBack[1] === 0x50 && readBack[2] === 0x4e && readBack[3] === 0x47
  checks.push({ what: 'png', passed: signed, describe: signed ? 'The file begins the way every PNG does.' : 'The file does not begin as a PNG does.' })
  let decoded: { width: number; height: number; bgra: Buffer } | null = null
  try {
    decoded = signed ? decodePng(Buffer.from(readBack)) : null
  } catch {
    decoded = null
  }
  const sized = decoded !== null && decoded.width === expected.width && decoded.height === expected.height
  checks.push({ what: 'size', passed: sized, describe: decoded ? `The image is ${decoded.width}×${decoded.height}; ${expected.width}×${expected.height} was drawn.` : 'The image could not be decoded.' })
  // A picture where every pixel is the same colour is a blank page, whatever its size says: the drawing never arrived.
  let drawn = false
  if (decoded) {
    const pixels = decoded.bgra
    for (let i = 4; i + 3 < pixels.length && !drawn; i += 4) {
      drawn = pixels[i] !== pixels[0] || pixels[i + 1] !== pixels[1] || pixels[i + 2] !== pixels[2] || pixels[i + 3] !== pixels[3]
    }
  }
  checks.push({ what: 'drawn', passed: drawn, describe: drawn ? 'The image has a drawing in it, not one flat colour.' : 'The image is one flat colour: nothing was drawn.' })
  return { ok: checks.every((one) => one.passed), checks, reimported: decoded ? { rows: decoded.height, columns: decoded.width } : null, differences: [] }
}

export class ArtifactService {
  private readonly o: ArtifactServiceOptions
  /** Every file this service wrote outside its own store since it started. The only paths `artifact.reveal` will touch. */
  private readonly written = new Set<string>()

  constructor(options: ArtifactServiceOptions) {
    this.o = options
  }

  /**
   * One operation, and -- when the request says which chat it came from -- the artifact it made marked with that chat.
   *
   * The mark is put on here, in one place, rather than threaded through every operation: whatever an operation keeps,
   * a new artifact or a new version, comes back as a record, and a record made on behalf of a conversation belongs to
   * it. An artifact that already belongs to a conversation keeps the one it has.
   */
  async run(profileId: string, request: unknown, signal?: AbortSignal, progress?: (message: string) => void): Promise<ArtifactResult> {
    const result = await this.dispatch(profileId, request, signal, progress)
    const conversationId = typeof request === 'object' && request !== null ? (request as Record<string, unknown>).conversationId : undefined
    if (!result.ok || !isConversationId(conversationId)) return result
    const value = result.value as { record?: ArtifactRecord } | null
    const record = value && typeof value === 'object' ? value.record : undefined
    if (!record || !isArtifactId(record.artifactId) || record.conversationId) return result
    const stamped: ArtifactRecord = { ...record, conversationId }
    await this.o.store.writeRecord(profileId, stamped)
    return { ...result, value: { ...(value as Record<string, unknown>), record: stamped } }
  }

  private async dispatch(profileId: string, request: unknown, signal?: AbortSignal, progress?: (message: string) => void): Promise<ArtifactResult> {
    const req = (typeof request === 'object' && request !== null ? request : {}) as Record<string, unknown>
    const operation = str(req.operation, 60)
    const fail = (error: string, message: string, detail?: unknown): ArtifactResult => ({
      ok: false,
      operation,
      error,
      message,
      ...(detail !== undefined ? { detail } : {})
    })

    // `hasOwnProperty`, not indexing: `OPERATIONS['constructor']` is a function, and a function is truthy.
    if (!Object.prototype.hasOwnProperty.call(OPERATIONS, operation)) {
      return fail('unknown-operation', `Orbis has no artifact operation called "${operation || '(nothing)'}".`)
    }

    try {
      switch (operation) {
        case 'artifact.kinds':
          return { ok: true, operation, value: this.kinds() }
        case 'artifact.list': {
          // With a conversation named, only what was made in it: that is the list "it" and "the report" are resolved against.
          const within = isConversationId(req.within) ? req.within : null
          const all = await this.o.store.list(profileId)
          return { ok: true, operation, value: (within ? all.filter((one) => one.conversationId === within) : all).map((one) => ({ record: one, ref: refOf(one) })) }
        }
        case 'artifact.create':
          return await this.create(profileId, operation, req, fail)
        case 'artifact.generate':
          return await this.generate(profileId, operation, req, fail, signal, progress)
        case 'artifact.import':
          return await this.import(profileId, operation, req, fail)
        case 'artifact.analyse':
          return await this.analyse(profileId, operation, req, fail)
        case 'artifact.read':
          return await this.read(profileId, operation, req, fail)
        case 'artifact.export':
          return await this.export(profileId, operation, req, fail, 'dialog')
        case 'artifact.download':
          return await this.export(profileId, operation, req, fail, 'downloads')
        case 'artifact.reveal': {
          const path = str(req.path, 1000)
          // Not "any path a renderer names": only a file this service wrote itself, in this run of Orbis.
          if (!this.written.has(path)) return fail('bad-input', 'Orbis can only show a file it saved itself, in this session.')
          if (!this.o.reveal) return fail('unavailable', 'Showing a file in its folder is not available here.')
          await this.o.reveal(path, req.open === true)
          return { ok: true, operation, value: { path, opened: req.open === true } }
        }
        case 'artifact.remove': {
          const artifactId = str(req.artifactId, 60)
          if (!isArtifactId(artifactId)) return fail('bad-input', 'That is not an artifact id.')
          return { ok: true, operation, value: { removed: await this.o.store.remove(profileId, artifactId) } }
        }
        case 'artifact.update':
          return await this.update(profileId, operation, req, fail)
        case 'artifact.restore':
          return await this.restore(profileId, operation, req, fail)
        case 'artifact.versions': {
          const record = await this.existing(profileId, req, fail)
          if ('ok' in record) return record
          return { ok: true, operation, value: { current: summaryOf(record), versions: record.versions, derivedFrom: record.derivedFrom } }
        }
        case 'artifact.rename': {
          const record = await this.existing(profileId, req, fail)
          if ('ok' in record) return record
          const title = str(req.title, LIMITS.title).trim()
          if (title === '') return fail('bad-input', 'A name is needed.')
          const renamed: ArtifactRecord = { ...record, title, updatedAt: this.o.now() }
          await this.o.store.writeRecord(profileId, renamed)
          return { ok: true, operation, value: { record: renamed, ref: refOf(renamed) } }
        }
        case 'artifact.duplicate':
          return await this.duplicate(profileId, operation, req, fail)
        case 'artifact.search':
          return { ok: true, operation, value: await this.search(profileId, str(req.query, 200)) }
        case 'artifact.chart':
          return await this.chart(profileId, operation, req, fail, signal)
        case 'artifact.asDocument':
          return await this.asDocument(profileId, operation, req, fail)
        case 'artifact.transform':
          return await this.transform(profileId, operation, req, fail, signal)
        case 'artifact.join':
          return await this.join(profileId, operation, req, fail)
        case 'artifact.templates':
          return { ok: true, operation, value: listTemplates() }
        case 'artifact.languages':
          return { ok: true, operation, value: LANGUAGES.map((one) => ({ id: one.id, name: one.name, extension: one.extensions[0], checked: one.check !== null })) }
        case 'artifact.fromTemplate':
          return await this.fromTemplate(profileId, operation, req, fail)
        case 'artifact.revise':
          return await this.revise(profileId, operation, req, fail, signal)
        case 'artifact.extractTable':
          return await this.extract(profileId, operation, req, fail)
        case 'artifact.place':
          return await this.place(profileId, operation, req, fail)
        default:
          return fail('unknown-operation', `Orbis has no artifact operation called "${operation}".`)
      }
    } catch (err) {
      // The person is told it did not work; the reason is written down here, because a fault nobody can read is a
      // fault nobody can fix.
      console.error(`[artifacts] ${operation} failed`, err)
      return fail('failed', err instanceof Error && err.message.length < 200 ? err.message : 'That did not work.')
    }
  }

  /**
   * What the secret gate reads: the file as it will be written, and the plain words it was made from.
   *
   * Both, because the written form can split what the words hold whole. A key with bold in the middle of it is two
   * pieces of Markdown and one key; a long label on a flowchart is wrapped onto two lines of a drawing. The gate looks
   * for keys by their shape, so it has to be shown them in one piece.
   */
  private wordsOf(body: ArtifactBody, rendered: Rendered): string {
    switch (body.kind) {
      case 'document':
        return `${rendered.scan}\n${toText(body.document)}`
      case 'diagram':
        return `${rendered.scan}\n${[...body.diagram.objects.map((one) => one.text), ...body.diagram.connectors.map((one) => one.text)].join('\n')}`
      case 'plot':
        return `${rendered.scan}\n${[body.plot.title, body.plot.x.label, body.plot.y.label, ...body.plot.series.map((one) => one.label)].join('\n')}`
      default:
        return rendered.scan
    }
  }

  /** The kinds table, minus any format this copy of Orbis cannot actually produce. */
  private kinds(): ReturnType<typeof describeKinds> {
    return describeKinds().map((kind) => ({ ...kind, writes: kind.writes.filter((one) => this.canProduce(one.format)) }))
  }

  private canProduce(format: FormatId): boolean {
    if (format === 'pdf') return typeof this.o.renderPdf === 'function'
    if (format === 'png') return typeof this.o.renderPng === 'function'
    return true
  }

  /** The formats a kind can leave as, here and now, for the chooser. */
  private formatsFor(kind: ArtifactKindId): { format: FormatId; name: string; extension: string; limitations: readonly string[] }[] {
    return ARTIFACT_KINDS[kind].writes
      .filter((format) => this.canProduce(format))
      .map((format) => ({ format, name: FORMATS[format].name, extension: extensionFor(format), limitations: FORMATS[format].limitations }))
  }

  // ---------------------------------------------------------------- the body, from text

  private bodyFrom(kind: ArtifactKindId, text: string, source: string, title: string, language = ''): ArtifactBody | { error: string; message: string } {
    if (kind === 'table') {
      // A table written the way a chat reply writes one -- pipes and a ruled line under the headings -- is read as
      // that table. Handed to the delimited reader it would come out as one column of lines with pipes in them.
      if (MARKDOWN_TABLE.test(text)) {
        const read = fromMarkdown(text, 'b')
        if (!isDocumentError(read)) {
          const holder = emptyDocument('document', title)
          holder.blocks = read.blocks
          const first = extractTable(holder, 1, source)
          if (!isDataError(first)) return { kind: 'table', table: first }
        }
      }
      const parsed = parseDelimited(text)
      if (isDataError(parsed)) return { error: 'parse', message: parsed.message }
      const table: Table = { ...parsed.table, source }
      return { kind: 'table', table }
    }
    // A drawing is never pasted: a chart comes from a table's numbers and a diagram from a description. Falling through
    // to the document reader here would quietly keep the pasted text as a document called a chart.
    if (kind === 'plot') return { error: 'bad-input', message: 'A chart is drawn from a table. Open or paste the table, then choose the columns to draw.' }
    if (kind === 'diagram') return { error: 'bad-input', message: 'A diagram is made by describing it to Orion, not pasted.' }
    if (kind === 'code') {
      // Which language: said outright, or read from a title that ends like a file name ("report.py").
      const found = languageById(language) ?? languageForFile(title)
      if (!found) return { error: 'bad-input', message: `Say which language it is. Orbis knows: ${LANGUAGES.map((one) => one.name).join(', ')}.` }
      if (text.trim() === '') return { error: 'bad-input', message: 'There is no code to keep.' }
      if (text.length > CODE_LIMITS.characters) return { error: 'too-large', message: `That is ${text.length.toLocaleString('en')} characters, past the ${CODE_LIMITS.characters.toLocaleString('en')} one file may hold.` }
      return { kind: 'code', code: { language: found.id, source: text } }
    }
    const parsed = fromMarkdown(text, 'b')
    if (isDocumentError(parsed)) return { error: 'parse', message: parsed.message }
    const document: StructuredDocument = emptyDocument('document', title)
    document.blocks = parsed.blocks
    document.metadata.source = source
    return { kind: 'document', document }
  }

  private async render(body: ArtifactBody, format: FormatId, title = '', profileId: string | null = null): Promise<Rendered | { error: string; message: string }> {
    if (body.kind === 'code') {
      if (format !== 'code') return { error: 'encode', message: `Code is saved as the ${languageById(body.code.language)?.name ?? 'source'} file it is, not as ${format}.` }
      const bytes = encode(body.code.source)
      return { bytes, text: body.code.source, scan: body.code.source, format, hash: hashOf(bytes), loss: { lossy: false, losses: [], carries: FORMATS.code.carries }, notes: [] }
    }
    if (body.kind === 'plot' || body.kind === 'diagram') {
      const made = body.kind === 'plot' ? (body.as === 'pie' ? pieToSvg(body.plot) : plotToSvg(body.plot)) : diagramToSvg(body.diagram)
      const loss = lossFor(format, { formatting: true })
      if (isInterchangeError(loss)) return { error: 'encode', message: loss.message }
      if (format === 'svg') {
        return { bytes: encode(made.svg), text: made.svg, scan: made.svg, format, hash: hashOf(encode(made.svg)), loss, notes: made.notes }
      }
      if (format === 'png') {
        if (!this.o.renderPng) return { error: 'unavailable', message: 'Drawing to PNG is not available in this copy of Orbis.' }
        const size = svgSize(made.svg)
        const bytes = await this.o.renderPng(made.svg, size.width, size.height)
        return { bytes, text: null, scan: made.svg, format, hash: hashOf(bytes), loss, notes: made.notes, size }
      }
      return { error: 'encode', message: `A ${ARTIFACT_KINDS[body.kind].name.toLowerCase()} is not written as ${format}.` }
    }
    if (body.kind === 'table' && format === 'xlsx') {
      const loss = lossFor('xlsx', { units: body.table.columns.some((one) => one.unit !== null), types: true, metadata: body.table.source !== '', hierarchy: false })
      if (isInterchangeError(loss)) return { error: 'encode', message: loss.message }
      // The sheet is named after the artifact: a workbook whose one sheet is called "Sheet1" tells nobody anything.
      const made = await writeXlsx(body.table, title || 'Table')
      return { bytes: made.bytes, text: null, scan: toDelimited(body.table), format, hash: hashOf(made.bytes), loss, notes: [...made.notes, ...loss.losses.map((one) => one.describe)] }
    }
    if (body.kind === 'document' && (format === 'docx' || format === 'pptx')) {
      const loss = lossFor(format, { formatting: true, metadata: true, hierarchy: true })
      if (isInterchangeError(loss)) return { error: 'encode', message: loss.message }
      // Word and slides hold pixels, so each figure is drawn once at its own size and handed over.
      const figures = await this.figuresOf(profileId, body.document)
      const pictures = new Map<string, Picture>()
      const notes = [...figures.notes]
      if (figures.drawings.size > 0 && !this.o.renderPng) {
        notes.push('The figures are written as their descriptions: drawing them as pictures is not available in this copy of Orbis.')
      } else {
        for (const [blockId, drawing] of figures.drawings) {
          const size = svgSize(drawing.svg)
          pictures.set(blockId, { png: await this.o.renderPng!(drawing.svg, size.width, size.height), ...size })
        }
      }
      const made = format === 'docx' ? await writeDocx(body.document, pictures) : await writePptx(body.document, pictures)
      return { bytes: made.bytes, text: null, scan: toText(body.document), format, hash: hashOf(made.bytes), loss, notes: [...notes, ...made.notes, ...loss.losses.map((one) => one.describe)], count: made.count, pictures: made.pictures ?? 0 }
    }
    if (body.kind === 'table') {
      /*
       * JSON always carries the columns.
       *
       * A table with no rows yet -- a tracker somebody has just asked for -- written as a bare array of objects is
       * `[]`: two bytes, and the columns, types and units that were the whole point are gone. With the metadata it
       * is {columns, source, rows}, which is also the only form in which "JSON carries units" is actually true.
       */
      const result = exportTable(body.table, { format, includeMetadata: format === 'json' })
      if (isInterchangeError(result)) return { error: 'encode', message: result.message }
      return { bytes: encode(result.text), text: result.text, scan: result.text, format, hash: result.hash, loss: result.loss, notes: result.notes }
    }
    if (format === 'pdf') {
      if (!this.o.renderPdf) return { error: 'unavailable', message: 'PDF printing is not available in this copy of Orbis.' }
      const loss = lossFor('pdf', { formatting: true, metadata: true, hierarchy: true })
      if (isInterchangeError(loss)) return { error: 'encode', message: loss.message }
      // The print window fetches nothing, so the HTML it is handed says so in its own policy -- and the figures are
      // inside it as drawings, not addresses.
      const figures = await this.figuresOf(profileId, body.document)
      const made = toHtml(figures.shown, { forPrint: true })
      const bytes = await this.o.renderPdf(made.html)
      // The secret gate reads the words, not the drawings: a chart inlined as base64 is long, opaque, and not text.
      return { bytes, text: null, scan: toText(body.document), format, hash: hashOf(bytes), loss, notes: [...figures.notes, ...made.notes, ...loss.losses.map((one) => one.describe)] }
    }
    if (format === 'html') {
      const figures = await this.figuresOf(profileId, body.document)
      const result = exportDocument(figures.shown, format)
      if (isInterchangeError(result)) return { error: 'encode', message: result.message }
      return { bytes: encode(result.text), text: result.text, scan: toText(body.document), format, hash: result.hash, loss: result.loss, notes: [...figures.notes, ...result.notes] }
    }
    const result = exportDocument(body.document, format)
    if (isInterchangeError(result)) return { error: 'encode', message: result.message }
    // Markdown and plain text hold words. A figure is its description there, and the note says so.
    const pointing = body.document.blocks.filter((one) => one.kind === 'image' && FIGURE_REF.test(one.source)).length
    const figureNote = pointing > 0 && format !== ARTIFACT_KINDS.document.stores ? [`${pointing} figure${pointing === 1 ? ' is' : 's are'} written as ${pointing === 1 ? 'its' : 'their'} description: this format holds words, not pictures. Save as PDF, Word, slides or HTML to have ${pointing === 1 ? 'it' : 'them'} drawn in.`] : []
    return { bytes: encode(result.text), text: result.text, scan: result.text, format, hash: result.hash, loss: result.loss, notes: [...figureNote, ...result.notes] }
  }

  /** The written file, checked against what was meant to be written and against what it came from. */
  private async verify(body: ArtifactBody, rendered: Rendered, readBack: Uint8Array): Promise<VerifyResult> {
    const shape = { bytes: rendered.bytes.length, hash: rendered.hash }
    if (rendered.format === 'pdf') return verifyPdfFile(shape, readBack)
    if (rendered.format === 'svg') return verifySvgFile(shape, readBack)
    if (rendered.format === 'code') return verifySourceFile({ ...shape, text: rendered.text ?? '' }, readBack)
    if (rendered.format === 'png') return verifyPngFile({ ...shape, width: rendered.size?.width ?? 0, height: rendered.size?.height ?? 0 }, readBack)
    if (rendered.format === 'xlsx' && body.kind === 'table') return verifyXlsx(body.table, shape, readBack)
    if (rendered.format === 'docx' && body.kind === 'document') return verifyDocx({ ...shape, pictures: rendered.pictures ?? 0 }, readBack)
    if (rendered.format === 'pptx' && body.kind === 'document') return verifyPptx({ ...shape, slides: rendered.count ?? 0, pictures: rendered.pictures ?? 0 }, readBack)
    const expected: ExportResult = {
      text: rendered.text ?? '',
      format: rendered.format,
      bytes: rendered.bytes.length,
      hash: rendered.hash,
      rows: 0,
      loss: rendered.loss,
      notes: rendered.notes
    }
    if (body.kind === 'table') return verifyTableFile(body.table, expected, readBack)
    if (body.kind === 'document') return verifyDocumentFile(body.document.blocks.length, expected, readBack)
    // A drawing stored as svg: the generic checks above already covered it, but every kind must say what it verified.
    return verifySvgFile({ bytes: rendered.bytes.length, hash: rendered.hash }, readBack)
  }

  private shapeOf(body: ArtifactBody): { rows: number; columns: number } {
    switch (body.kind) {
      case 'table':
        return { rows: body.table.rows.length, columns: body.table.columns.length }
      case 'document':
        return { rows: body.document.blocks.length, columns: 0 }
      case 'plot':
        return { rows: body.plot.series.reduce((n, one) => n + one.segments.reduce((m, s) => m + s.points.length, 0), 0), columns: body.plot.series.length }
      case 'diagram':
        return { rows: body.diagram.objects.length, columns: body.diagram.connectors.length }
      case 'code':
        return { rows: lineCount(body.code.source), columns: 0 }
    }
  }

  // ---------------------------------------------------------------- anything, as a document

  /**
   * A table, a chart, a diagram or a code file put into a new document.
   *
   * This is how "export the spreadsheet as PDF" and "put the chart in a Word file" are real conversions and not a
   * file with a different name: a table becomes a document's own table, row for row; a chart or a diagram becomes a
   * figure that points at it; code becomes a code block. Nothing is summarised, rewritten or left out without a
   * sentence saying so. The document remembers what it was made from.
   */
  private async asDocument(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
  ): Promise<ArtifactResult> {
    const record = await this.existing(profileId, req, fail)
    if ('ok' in record) return record
    if (record.kind === 'document') return fail('bad-input', `"${record.title}" is already a document. It can be saved as PDF, Word or slides as it is.`)
    const body = await this.bodyOf(profileId, record)
    if (!body) return fail('not-found', 'The artifact is listed but its source is missing.')

    const title = str(req.title, LIMITS.title).trim() || record.title
    const source = `"${record.title}" (as a document)`
    const document = emptyDocument('document', title)
    document.metadata.source = source
    const notes: string[] = []
    let n = 0
    const id = (): string => `b-${++n}`
    document.blocks.push({ id: id(), sectionId: '', kind: 'heading', level: 1, content: [inline(title)] })

    if (body.kind === 'table') {
      const table = body.table
      const columns = table.columns.slice(0, DOCUMENT_LIMITS.tableColumns)
      if (columns.length < table.columns.length) notes.push(`The first ${columns.length} of ${table.columns.length} columns are in the document; a document's table holds no more.`)
      const numeric = (type: string): boolean => type === 'number' || type === 'integer' || type === 'quantity'
      const cell = (value: string, header: boolean, right: boolean): TableCell => ({ content: [inline(value)], colSpan: 1, rowSpan: 1, header, align: right ? 'right' : 'left' })
      const heading = columns.map((one) => cell(one.name, true, numeric(one.type)))
      // A table too long for one of a document's tables is carried on in the next, heading repeated. No row is dropped.
      const perTable = DOCUMENT_LIMITS.tableRows - 1
      const parts = Math.max(1, Math.ceil(table.rows.length / perTable))
      for (let part = 0; part < parts; part++) {
        const rows = table.rows.slice(part * perTable, (part + 1) * perTable)
        document.blocks.push({
          id: id(),
          sectionId: '',
          kind: 'table',
          columns: columns.length,
          rows: [heading, ...rows.map((row) => columns.map((column, at) => cell(cellOut(row.cells[at] ?? null, column), false, numeric(column.type))))],
          caption: parts === 1 ? '' : `Rows ${(part * perTable + 1).toLocaleString('en')} to ${(part * perTable + rows.length).toLocaleString('en')}`,
          label: ''
        })
      }
      notes.push(`Every one of the ${rowsOf(table.rows.length)} of "${record.title}" (version ${record.version}) is in the document, as they were. Nothing was summarised or rewritten.`)
    } else if (body.kind === 'plot' || body.kind === 'diagram') {
      document.blocks.push({ id: id(), sectionId: '', kind: 'image', source: `artifact:${record.artifactId}`, alt: record.title.replace(/[\[\]\r\n]+/g, ' ').trim(), caption: record.title.replace(/[*\r\n]+/g, '').trim(), label: '' })
      notes.push(`The figure is "${record.title}". It follows it: saved as PDF, Word, slides or HTML, the document shows it as it is at that moment.`)
    } else if (body.kind === 'code') {
      document.blocks.push({ id: id(), sectionId: '', kind: 'code', language: body.code.language, source: body.code.source, showLineNumbers: false })
      notes.push(`The ${languageById(body.code.language)?.name ?? body.code.language} file "${record.title}" (version ${record.version}), character for character.`)
    }

    return this.keep(
      profileId,
      operation,
      { kind: 'document', document },
      { title, source, notes, acceptSecrets: req.acceptSecrets === true, derivedFrom: { artifactId: record.artifactId, versionId: record.versionId, title: record.title } },
      fail
    )
  }

  // ---------------------------------------------------------------- figures

  /**
   * The figures in a document that point at a chart or a diagram, looked up.
   *
   * A figure is a reference, not a copy: the document says which artifact it shows and the drawing is read from that
   * artifact when the document is written out. So a chart redrawn after its table changed is the chart the report
   * shows the next time it is saved, and a figure whose artifact has gone is written as its description with a note
   * saying so -- never as a blank and never as the last picture anybody happened to have.
   *
   * `shown` is the document with each such figure's address replaced by the drawing itself, which is what a format
   * that can hold a drawing is given. `drawings` is the same by block, for the formats that need pixels.
   */
  private async figuresOf(profileId: string | null, document: StructuredDocument): Promise<{ shown: StructuredDocument; drawings: Map<string, { svg: string; title: string }>; notes: string[] }> {
    const drawings = new Map<string, { svg: string; title: string }>()
    const notes: string[] = []
    if (profileId === null) return { shown: document, drawings, notes }
    let missing = 0
    const blocks: StructuredDocument['blocks'] = []
    for (const block of document.blocks) {
      const ref = block.kind === 'image' ? FIGURE_REF.exec(block.source) : null
      if (block.kind !== 'image' || !ref) {
        blocks.push(block)
        continue
      }
      const record = await this.o.store.readRecord(profileId, ref[1])
      const bytes = record && (record.kind === 'plot' || record.kind === 'diagram') ? await this.o.store.readFile(profileId, record.artifactId, record.file) : null
      const svg = bytes ? decode(bytes) : ''
      if (!record || !svg.startsWith('<svg')) {
        missing += 1
        blocks.push(block)
        continue
      }
      drawings.set(block.id, { svg, title: record.title })
      blocks.push({ ...block, source: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}` })
      notes.push(`The figure "${block.caption || block.alt || record.title}" is "${record.title}" as it is now (version ${record.version}).`)
    }
    if (missing > 0) notes.push(`${missing} figure${missing === 1 ? ' points' : 's point'} at something that is no longer in Create, so ${missing === 1 ? 'its description is' : 'their descriptions are'} written instead.`)
    return { shown: { ...document, blocks }, drawings, notes }
  }

  /** A chart or a diagram put into a document as a figure, at the end, as a new version of the document. */
  private async place(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
  ): Promise<ArtifactResult> {
    const record = await this.existing(profileId, req, fail)
    if ('ok' in record) return record
    if (record.kind !== 'document') return fail('bad-input', 'A figure is put into a document.')
    const picture = await this.existing(profileId, { artifactId: req.figureId }, fail)
    if ('ok' in picture) return picture
    if (picture.kind !== 'plot' && picture.kind !== 'diagram') return fail('bad-input', `"${picture.title}" is a ${ARTIFACT_KINDS[picture.kind].name.toLowerCase()}. A figure is a chart or a diagram.`)
    const body = await this.bodyOf(profileId, record)
    if (!body || body.kind !== 'document') return fail('not-found', 'The artifact is listed but its source is missing.')
    const taken = new Set(body.document.blocks.map((one) => one.id))
    let id = `figure-${body.document.blocks.filter((one) => one.kind === 'image').length + 1}`
    for (let n = 2; taken.has(id); n++) id = `figure-${body.document.blocks.length + n}`
    // A caption is one line of plain words: anything that would read as markup in the stored copy is taken out.
    const caption = (str(req.caption, 200).trim() || picture.title)
      .replace(/[*\r\n]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    const alt = picture.title
      .replace(/[\[\]\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const document: StructuredDocument = {
      ...body.document,
      blocks: [...body.document.blocks, { id, sectionId: '', kind: 'image', source: `artifact:${picture.artifactId}`, alt, caption, label: '' }]
    }
    return this.keep(
      profileId,
      operation,
      { kind: 'document', document },
      {
        title: record.title,
        source: record.source,
        notes: [`"${picture.title}" was added as a figure. The figure follows it: saved as PDF, Word, slides or HTML, this document shows "${picture.title}" as it is at that moment.`],
        acceptSecrets: req.acceptSecrets === true,
        existing: record,
        reason: `Added the figure "${picture.title}".`
      },
      fail
    )
  }

  // ---------------------------------------------------------------- a table out of a document

  /** One of a document's tables kept as a table of its own, which remembers the document it came from. */
  private async extract(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
  ): Promise<ArtifactResult> {
    const record = await this.existing(profileId, req, fail)
    if ('ok' in record) return record
    if (record.kind !== 'document') return fail('bad-input', 'A table is taken out of a document.')
    const body = await this.bodyOf(profileId, record)
    if (!body || body.kind !== 'document') return fail('not-found', 'The artifact is listed but its source is missing.')
    const index = typeof req.index === 'number' ? req.index : 1
    const source = `"${record.title}" (table ${index})`
    const table = extractTable(body.document, index, source)
    if (isDataError(table)) return fail('bad-input', table.message)
    const described = tablesIn(body.document)[index - 1]
    const title = str(req.title, LIMITS.title).trim() || described?.caption.slice(0, LIMITS.title) || `${record.title} — table ${index}`
    return this.keep(
      profileId,
      operation,
      { kind: 'table', table },
      {
        title,
        source,
        notes: [
          `Taken from table ${index} of "${record.title}" (version ${record.version}): ${rowsOf(table.rows.length)}, ${table.columns.length} columns.`,
          'What each column holds (a number, a date, a category) was worked out from its values. Nothing was filled in: a blank in the document is a blank here.'
        ],
        acceptSecrets: req.acceptSecrets === true,
        derivedFrom: { artifactId: record.artifactId, versionId: record.versionId, title: record.title }
      },
      fail
    )
  }

  // ---------------------------------------------------------------- templates and revision

  /** A new artifact started from a template. Nothing in it needs a model, a connection or a key. */
  private async fromTemplate(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
  ): Promise<ArtifactResult> {
    const id = str(req.templateId, 60)
    const template = templateById(id)
    if (!template) return fail('not-found', `There is no template called "${id || '(nothing)'}".`)
    const title = str(req.title, LIMITS.title).trim() || template.name
    const source = `template: ${template.name}`
    const notes = [`Started from the "${template.name}" template. It is structure only: every row and every "(fill in)" is yours to write.`]
    if (template.kind === 'table') {
      const table = buildTable(
        template.columns.map((one) => one.name),
        [],
        { source, types: template.columns.map((one) => one.type), units: template.columns.map((one) => one.unit) }
      )
      if (isDataError(table)) return fail('failed', table.message)
      return this.keep(profileId, operation, { kind: 'table', table }, { title, source, notes, acceptSecrets: false }, fail)
    }
    const body = this.bodyFrom('document', template.markdown, source, title)
    if ('error' in body) return fail(body.error, body.message)
    return this.keep(profileId, operation, body, { title, source, notes, acceptSecrets: false }, fail)
  }

  /**
   * A document or a flowchart changed by an instruction.
   *
   * Orion is handed the whole thing and gives the whole thing back, which then goes through the same builders and the
   * same read-back as anything else. Something too long to hand over whole is refused rather than cut: a model given
   * the first part of a report rewrites the first part and the rest is gone, and nothing about the result says so.
   * The version before is kept, and the note says how much there was before and after, so a revision that quietly
   * dropped half of it is visible at a glance.
   */
  private async revise(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult,
    signal?: AbortSignal
  ): Promise<ArtifactResult> {
    const record = await this.existing(profileId, req, fail)
    if ('ok' in record) return record
    if (record.kind === 'table') return fail('bad-input', 'A table is changed with steps, so that every number is worked out by Orbis: use "Change this table".')
    if (record.kind === 'plot') return fail('bad-input', 'A chart is drawn from its table. Change the table, then draw the chart again.')
    if (!this.o.generation) return fail('unavailable', 'Orion is not set up on this computer, so there is nothing to revise it with. It can still be replaced by pasting.')
    const request = str(req.request, 2000).trim()
    if (request === '') return fail('bad-input', 'Say what to change.')
    const body = await this.bodyOf(profileId, record)
    if (!body || body.kind !== record.kind) return fail('not-found', 'The artifact is listed but its source is missing.')

    const current =
      body.kind === 'document'
        ? toMarkdown(body.document)
        : body.kind === 'diagram'
          ? JSON.stringify({
              nodes: body.diagram.objects.map((one) => ({ id: one.id, label: one.text, shape: one.type })),
              edges: body.diagram.connectors.map((one) => ({ from: one.from, to: one.to, label: one.text }))
            })
          : body.kind === 'code'
            ? body.code.source
            : ''
    if (current.length > LIMITS.revise) {
      return fail('too-large', `This is ${current.length.toLocaleString('en')} characters, past the ${LIMITS.revise.toLocaleString('en')} Orion can be handed whole. Cutting it would lose the rest without saying so, so it was not sent. It can still be replaced by pasting.`)
    }

    const outcome = await this.o.generation.revise(record.kind, record.title, current, request, body.kind === 'code' ? body.code.language : '', signal)
    // Stopped while Orion was rewriting it: the version there was is still the current one.
    if (signal?.aborted || outcome.failed === STOPPED) return fail('cancelled', 'Stopped. Nothing was changed.')
    if (!outcome.body) {
      const errors = outcome.problems.filter((one) => one.severity === 'error').map((one) => one.message)
      return fail(outcome.failed ? 'unavailable' : 'not-made', outcome.failed ?? errors[0] ?? 'Orion did not give back something Orbis could keep.', { attempts: outcome.attempts })
    }
    const before = this.shapeOf(body)
    const after = this.shapeOf(outcome.body)
    const counted = (shape: { rows: number; columns: number }): string => (record.kind === 'document' ? `${shape.rows} blocks` : record.kind === 'code' ? `${shape.rows} lines` : `${shape.rows} boxes and ${shape.columns} arrows`)
    const notes =
      record.kind === 'code'
        ? [`Rewritten by a model from: "${request.slice(0, 200)}". Orbis has not run it and cannot say that it works: read it before you run it.`, ...outcome.notes.slice(1), `Before: ${counted(before)}. After: ${counted(after)}. The version before is kept.`]
        : record.kind === 'document'
        ? [`Rewritten by a model from: "${request.slice(0, 200)}". Any figure in it was written, not measured or computed by Orbis.`, `Before: ${counted(before)}. After: ${counted(after)}. The version before is kept.`]
        : [`Redrawn from: "${request.slice(0, 200)}". The boxes and arrows were chosen by a model; where they sit was worked out by Orbis.`, `Before: ${counted(before)}. After: ${counted(after)}. The version before is kept.`]
    return this.keep(profileId, operation, outcome.body, { title: record.title, source: record.source, notes, acceptSecrets: req.acceptSecrets === true, existing: record, reason: request.slice(0, 300) }, fail)
  }

  // ---------------------------------------------------------------- transform

  /**
   * A table changed by steps.
   *
   * The steps come from the caller, or from a sentence Orion turns into steps -- having been shown the column names
   * and none of the data. Either way they go through `readSteps` and are run by the table engine; what each step did
   * is kept with the result as a note, count by count. By default the result is a new version of the same table, so
   * the one before is still there to go back to; `as: 'new'` keeps it as a separate table that remembers its origin.
   */
  private async transform(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult,
    signal?: AbortSignal
  ): Promise<ArtifactResult> {
    const record = await this.existing(profileId, req, fail)
    if ('ok' in record) return record
    if (record.kind !== 'table') return fail('bad-input', 'Only a table can be changed this way.')
    const body = await this.bodyOf(profileId, record)
    if (!body || body.kind !== 'table') return fail('not-found', 'The artifact is listed but its source is missing.')
    const table = body.table

    let steps: TransformStep[]
    let planned: string | null = null
    const sentence = str(req.request, 2000).trim()
    if (req.steps !== undefined) {
      const read = readSteps(req.steps)
      if (read.problems.length > 0) return fail('bad-input', read.problems[0], { problems: read.problems })
      steps = read.steps
    } else if (sentence !== '') {
      if (!this.o.generation) return fail('unavailable', 'Orion is not set up on this computer, so a change has to be given as steps.')
      const outcome = await this.o.generation.planSteps(sentence, table.columns, (candidate) => {
        const tried = applySteps(table, candidate)
        return isTransformFailure(tried) ? `Step ${tried.step} (${tried.op}) cannot run: ${tried.message}` : null
      }, signal)
      if (signal?.aborted || outcome.failed === STOPPED) return fail('cancelled', 'Stopped. Nothing was changed.')
      if (!outcome.steps) {
        return fail(outcome.failed ? 'unavailable' : 'not-made', outcome.failed ?? outcome.problems[0] ?? 'Orion did not give steps that work.', { attempts: outcome.attempts })
      }
      steps = outcome.steps
      planned = sentence
    } else {
      return fail('bad-input', 'Say what to change, or give the steps.')
    }

    const result = applySteps(table, steps)
    if (isTransformFailure(result)) return fail('bad-input', `Step ${result.step} (${result.op}) did not work: ${result.message}`, { step: result.step })

    const notes = [
      ...(planned ? [`The steps were chosen by a model from: "${planned.slice(0, 200)}". It was shown the column names, not the data; every number was worked out by Orbis.`] : []),
      ...result.notes
    ]
    const asNew = str(req.as, 10) === 'new'
    const kept = asNew
      ? await this.keep(
          profileId,
          operation,
          { kind: 'table', table: { ...result.table, source: `"${record.title}" (changed)` } },
          {
            title: str(req.title, LIMITS.title).trim() || `${record.title} (changed)`,
            source: `"${record.title}" (changed)`,
            notes,
            acceptSecrets: req.acceptSecrets === true,
            derivedFrom: { artifactId: record.artifactId, versionId: record.versionId, title: record.title }
          },
          fail
        )
      : await this.keep(
          profileId,
          operation,
          { kind: 'table', table: result.table },
          { title: record.title, source: record.source, notes, acceptSecrets: req.acceptSecrets === true, existing: record, reason: (planned ?? result.notes.join(' ')).slice(0, 300) },
          fail
        )
    if (!kept.ok) return kept
    return { ...kept, value: { ...(kept.value as Record<string, unknown>), steps, did: result.notes } }
  }

  /**
   * Two tables joined on a column.
   *
   * Always a new table: a join is the operation most likely to change the size of a table without a word, so the
   * counts -- how many rows on each side found a partner, which keys repeat -- are kept with the result as notes.
   */
  private async join(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
  ): Promise<ArtifactResult> {
    const left = await this.existing(profileId, req, fail)
    if ('ok' in left) return left
    const right = await this.existing(profileId, { artifactId: req.withArtifactId }, fail)
    if ('ok' in right) return right
    if (left.kind !== 'table' || right.kind !== 'table') return fail('bad-input', 'Both have to be tables.')
    const leftBody = await this.bodyOf(profileId, left)
    const rightBody = await this.bodyOf(profileId, right)
    if (!leftBody || leftBody.kind !== 'table' || !rightBody || rightBody.kind !== 'table') return fail('not-found', 'One of the tables is listed but its source is missing.')

    const find = (table: Table, name: string): Column | null =>
      table.columns.find((one) => one.id === name) ?? table.columns.find((one) => one.name.toLowerCase() === name.toLowerCase()) ?? null
    const on = str(req.on, 120).trim()
    const withOn = str(req.withOn, 120).trim() || on
    const leftKey = find(leftBody.table, on)
    const rightKey = find(rightBody.table, withOn)
    if (!leftKey) return fail('bad-input', `"${left.title}" has no column called "${on}". Its columns are: ${leftBody.table.columns.map((one) => one.name).join(', ')}.`)
    if (!rightKey) return fail('bad-input', `"${right.title}" has no column called "${withOn}". Its columns are: ${rightBody.table.columns.map((one) => one.name).join(', ')}.`)
    const wanted = str(req.kind, 10).toLowerCase()
    const kind: JoinKind = (JOIN_KINDS as readonly string[]).includes(wanted) ? (wanted as JoinKind) : 'inner'

    const joined = joinTables(leftBody.table, rightBody.table, leftKey.id, rightKey.id, kind)
    if (isDataError(joined)) return fail('bad-input', joined.message)
    const title = str(req.title, LIMITS.title).trim() || `${left.title} + ${right.title}`
    const source = `"${left.title}" joined with "${right.title}"`
    const notes = [
      `Joined "${left.title}" (${rowsOf(leftBody.table.rows.length)}) with "${right.title}" (${rowsOf(rightBody.table.rows.length)}) where ${leftKey.name} = ${rightKey.name}, keeping ${kind === 'inner' ? 'only rows with a partner' : kind === 'left' ? `every row of "${left.title}"` : 'every row of both'}.`,
      `${rowsOf(joined.matchedLeft)} of "${left.title}" found a partner and ${joined.unmatchedLeft.toLocaleString('en')} did not; ${rowsOf(joined.matchedRight)} of "${right.title}" found a partner and ${joined.unmatchedRight.toLocaleString('en')} did not.`,
      ...(joined.duplicateKeys.length ? [`These values appear more than once on a side, so their rows were multiplied: ${joined.duplicateKeys.slice(0, 12).join(', ')}${joined.duplicateKeys.length > 12 ? ', …' : ''}.`] : []),
      ...joined.notes
    ]
    return this.keep(
      profileId,
      operation,
      { kind: 'table', table: { ...joined.table, source } },
      { title, source, notes, acceptSecrets: req.acceptSecrets === true, derivedFrom: { artifactId: left.artifactId, versionId: left.versionId, title: left.title } },
      fail
    )
  }

  // ---------------------------------------------------------------- chart

  /**
   * A chart from a table's columns.
   *
   * The numbers are the table's own and the axes are the plot engine's. A column of dates or categories on the x
   * axis is drawn in row order with its own values as the tick labels, because the engine's axes are numeric and a
   * date in milliseconds is not something a person reads. Every row where a value could not be read is left out and
   * counted.
   */
  private async chart(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult,
    signal?: AbortSignal
  ): Promise<ArtifactResult> {
    const record = await this.existing(profileId, req, fail)
    if ('ok' in record) return record
    if (record.kind !== 'table') return fail('bad-input', 'A chart is made from a table.')
    const body = await this.bodyOf(profileId, record)
    if (!body || body.kind !== 'table') return fail('not-found', 'The artifact is listed but its source is missing.')
    const table = body.table

    // Asked for in words rather than by column: Orion names the columns, having seen their names and types and none
    // of the numbers, and the plan is tried against the real table before it is accepted.
    if (typeof req.x !== 'string' && typeof req.request === 'string') {
      if (!this.o.generation) return fail('unavailable', 'Orion is not set up on this computer, so the columns to draw have to be chosen by hand.')
      const outcome = await this.o.generation.planChart(
        str(req.request, 2000),
        table.columns,
        (plan) => {
          const numbers = (name: string): number => {
            const at = table.columns.findIndex((one) => one.name === name)
            return table.rows.filter((row) => asNumber(row.cells[at] ?? null) !== null).length
          }
          const empty = plan.y.filter((name) => numbers(name) === 0)
          return empty.length > 0 ? `${empty.map((one) => `"${one}"`).join(', ')} ${empty.length === 1 ? 'has' : 'have'} no values that can be read as numbers, so there is nothing to draw. Choose columns that hold numbers.` : null
        },
        signal
      )
      if (signal?.aborted || outcome.failed === STOPPED) return fail('cancelled', 'Stopped. Nothing was drawn.')
      if (!outcome.plan) return fail(outcome.failed ? 'unavailable' : 'not-made', outcome.failed ?? outcome.problems[0] ?? 'Orion did not choose columns that can be drawn.', { attempts: outcome.attempts })
      // The kind the person named is the kind that is drawn. A model choosing the columns does not get to turn a pie
      // into bars; if the pie cannot be drawn, the reason is said below instead of something else being drawn quietly.
      const kind = typeof req.kind === 'string' && req.kind !== '' ? req.kind : (chartKindSaid(str(req.request, 2000)) ?? outcome.plan.kind)
      return this.chart(profileId, operation, { ...req, x: outcome.plan.x, y: kind === 'pie' ? outcome.plan.y.slice(0, 1) : outcome.plan.y, kind, request: undefined }, fail, signal)
    }

    const find = (name: string): { column: Column; index: number } | null => {
      const index = table.columns.findIndex((one) => one.id === name || one.name.toLowerCase() === name.toLowerCase())
      return index < 0 ? null : { column: table.columns[index], index }
    }
    const xName = str(req.x, 120)
    const x = find(xName)
    if (!x) return fail('bad-input', `There is no column called "${xName}". The columns are: ${table.columns.map((one) => one.name).join(', ')}.`)
    const yNames = (Array.isArray(req.y) ? req.y : [req.y]).filter((one): one is string => typeof one === 'string').slice(0, 8)
    const ys = yNames.map((name) => ({ name, found: find(name) }))
    const missing = ys.filter((one) => one.found === null).map((one) => one.name)
    if (ys.length === 0 || missing.length > 0) {
      return fail('bad-input', ys.length === 0 ? 'Choose at least one column to draw.' : `There is no column called ${missing.map((one) => `"${one}"`).join(', ')}.`)
    }
    const kind = str(req.kind, 20).toLowerCase()
    // A pie is one series of bars drawn round a circle: the numbers and the axes are the plot engine's either way.
    const pie = kind === 'pie'
    const seriesKind: SeriesKind = pie ? 'bar' : (SERIES_KINDS as readonly string[]).includes(kind) ? (kind as SeriesKind) : 'line'
    if (pie && ys.length !== 1) return fail('bad-input', 'A pie shows the shares of one column. Choose one column of amounts, or ask for bars to compare several.')
    if (pie && table.rows.length > PIE_LIMITS.slices) {
      return fail('bad-input', `A pie with ${table.rows.length} slices cannot be read: ${PIE_LIMITS.slices} is the most. Total the table by a category first, or ask for bars.`)
    }

    // X: numeric columns are drawn as numbers; dates and categories in row order, with the values as tick labels.
    const numericX = x.column.type === 'number' || x.column.type === 'integer' || x.column.type === 'quantity'
    const xValues = table.rows.map((row, i) => (numericX ? asNumber(row.cells[x.index] ?? null) : i))
    const notes: string[] = []
    const series: Series[] = []
    for (const y of ys) {
      const found = y.found!
      const points: { x: number; y: number }[] = []
      let skipped = 0
      table.rows.forEach((row, i) => {
        const xv = xValues[i]
        const yv = asNumber(row.cells[found.index] ?? null)
        if (xv === null || yv === null) skipped += 1
        else points.push({ x: xv, y: yv })
      })
      if (points.length === 0) return fail('bad-input', `"${found.column.name}" has no values that can be read as numbers.`)
      if (skipped > 0) notes.push(`"${found.column.name}": ${skipped} row${skipped === 1 ? '' : 's'} left out because the value could not be read as a number.`)
      series.push(seriesFromPoints(found.column.id, found.column.name, points, { kind: seriesKind, unit: found.column.unit, provenance: record.source.startsWith('file:') ? 'imported' : 'unknown' }))
    }

    const title = `${ys.map((one) => one.found!.column.name).join(', ')} by ${x.column.name}`
    const made = buildPlot('chart', series, { title, x: { label: x.column.name, unit: numericX ? x.column.unit : null }, y: { label: ys.length === 1 ? ys[0].found!.column.name : '', unit: ys.length === 1 ? ys[0].found!.column.unit : null } })
    if (isPlotError(made)) return fail('bad-input', made.message)

    let plot = made
    if (!numericX) {
      // Row order on the axis, labelled by what is in the column. Every k-th label when there are too many to read.
      const every = pie ? 1 : Math.max(1, Math.ceil(table.rows.length / 12))
      const ticks = table.rows.map((row, i) => {
        const cell = row.cells[x.index] ?? null
        const label = x.column.type === 'date' && typeof cell === 'number' ? formatDate(cell) : String(cell ?? '')
        return { value: i, label: i % every === 0 ? label : '', major: i % every === 0 }
      })
      plot = { ...made, x: { ...made.x, ticks, label: x.column.name } }
      notes.push(`"${x.column.name}" is drawn in row order, with its values as the labels.`)
    }

    if (pie) {
      const problem = pieProblem(plot)
      if (problem) return fail('bad-input', problem)
    }
    const drawnAs = pie ? 'a pie: each slice is its share of the total' : seriesKind === 'bar' ? 'bars' : seriesKind === 'scatter' ? 'points' : seriesKind === 'area' ? 'an area' : seriesKind === 'step' ? 'steps' : 'a line'

    // Asked to redraw a chart that is already there ("make it a bar chart"): the result is that chart's next version,
    // so a document that shows it shows the new drawing, and the old one can be brought back.
    let replaced: ArtifactRecord | undefined
    if (typeof req.replace === 'string') {
      const before = await this.existing(profileId, { artifactId: req.replace }, fail)
      if ('ok' in before) return before
      if (before.kind !== 'plot') return fail('bad-input', `"${before.title}" is not a chart, so a chart cannot take its place.`)
      replaced = before
    }
    return this.keep(
      profileId,
      operation,
      pie ? { kind: 'plot', plot, as: 'pie' } : { kind: 'plot', plot },
      {
        title,
        source: `"${record.title}" (its numbers)`,
        notes: [`Drawn from the table "${record.title}" (version ${record.version}): ${ys.map((one) => one.found!.column.name).join(', ')} ${pie ? 'by' : 'against'} ${x.column.name}, as ${drawnAs}.`, ...notes],
        acceptSecrets: true,
        derivedFrom: { artifactId: record.artifactId, versionId: record.versionId, title: record.title },
        ...(replaced ? { existing: replaced, reason: `Redrawn: ${title}, as ${pie ? 'a pie' : seriesKind}.` } : {})
      },
      fail
    )
  }

  // ---------------------------------------------------------------- create

  private async create(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
  ): Promise<ArtifactResult> {
    const kind = str(req.kind, 40)
    if (!isArtifactKindId(kind)) {
      return fail('bad-input', `Orbis cannot create "${kind || '(nothing)'}". It can create: ${Object.keys(ARTIFACT_KINDS).join(', ')}.`)
    }
    if (typeof req.text !== 'string') return fail('bad-input', 'There is no text to make it from.')
    if (req.text.length > LIMITS.text) {
      return fail('too-large', `That is ${req.text.length.toLocaleString('en')} characters, past the ${LIMITS.text.toLocaleString('en')} one artifact can be made from at once.`)
    }
    const title = str(req.title, LIMITS.title).trim() || (kind === 'table' ? 'Table' : kind === 'code' ? 'Code' : 'Document')
    const source = str(req.source, 200) || 'pasted'
    const acceptSecrets = req.acceptSecrets === true

    const body = this.bodyFrom(kind, req.text, source, title, str(req.language, 40))
    if ('error' in body) return fail(body.error, body.message)
    // Code says what Orbis could tell about it, and that it was not run. Nothing else needs a note.
    const notes = body.kind === 'code' ? [checkSyntax(body.code.language, body.code.source, compileJavaScript).message] : []
    return this.keep(profileId, operation, body, { title, source, notes, acceptSecrets }, fail)
  }

  // ---------------------------------------------------------------- generate

  /**
   * Something made from a sentence.
   *
   * Orion decides what and writes it; everything from the proposal onwards is the same deterministic path pasted text
   * takes, with the provenance written into the record. A failure says what the model got wrong, attempt by attempt,
   * because "could not make it" sends a person guessing and "columns[2] has no name" does not.
   */
  private async generate(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult,
    signal?: AbortSignal,
    progress?: (message: string) => void
  ): Promise<ArtifactResult> {
    if (!this.o.generation) return fail('unavailable', 'Orion is not set up on this computer, so there is nothing to write it with.')
    const request = str(req.request, 4000).trim()
    if (request === '') return fail('bad-input', 'Say what you want made.')
    const acceptSecrets = req.acceptSecrets === true

    const wanted = str(req.kind, 20)
    // A document asked for at length is planned and written a part at a time, because one answer from a model is a
    // few pages and would be handed over as if it were the whole thing.
    const long = wanted === 'document' || wanted === '' ? longDocumentAsked(request) : null
    const outcome = long
      ? await this.o.generation.generateLong(request, { parts: long.parts, short: long.short, context: str(req.context, 20_000), signal, progress })
      : await this.o.generation.generate(request, { context: str(req.context, 20_000), signal, ...(isArtifactKindId(wanted) && ARTIFACT_KINDS[wanted].orionMayName ? { kind: wanted } : {}) })
    // Stopped while Orion was writing: nothing has been kept yet, and nothing is.
    if (signal?.aborted || outcome.failed === STOPPED) return fail('cancelled', 'Stopped. Nothing was made.')
    if (!outcome.body || !outcome.intent) {
      const first = outcome.failed ?? outcome.problems.find((p) => p.severity === 'error')?.message ?? 'Orion did not write something Orbis could keep.'
      return fail('not-made', first, { attempts: outcome.attempts, problems: outcome.problems.map((p) => p.message) })
    }
    return this.keep(profileId, operation, outcome.body, { title: outcome.intent.title, source: `Orion, asked for: ${request.slice(0, 160)}`, notes: outcome.notes, acceptSecrets }, fail)
  }

  // ---------------------------------------------------------------- import

  /** A file the person chose, read into a table or a document and kept with what was lost said. */
  private async import(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
  ): Promise<ArtifactResult> {
    if (!this.o.chooseSource) return fail('unavailable', 'Opening a file is not available here.')
    const path = await this.o.chooseSource()
    if (path === null) return fail('cancelled', 'Nothing was opened.')
    const read = this.o.readFile ?? (async (p: string) => new Uint8Array(await readFromDisk(p)))
    let bytes: Uint8Array
    try {
      bytes = await read(path)
    } catch {
      return fail('file', 'That file could not be read.')
    }
    const name = path.replace(/^.*[\\/]/, '')
    const imported = await importFile(name, bytes)
    if ('error' in imported) return fail(imported.error, imported.message)
    return this.keep(profileId, operation, imported.body, { title: imported.title, source: imported.source, notes: imported.notes, acceptSecrets: req.acceptSecrets === true }, fail)
  }

  /**
   * A file whose bytes the main process already has -- an attachment on a chat message -- read and kept.
   *
   * Not an operation: there is no way to reach this from the window. `artifact.import` asks the person which file
   * through a dialog; this is for the one case where they have already said, by attaching it, and a second dialog
   * would be asking twice.
   */
  async importBytes(profileId: string, name: string, bytes: Uint8Array, about: { conversationId?: string; acceptSecrets?: boolean } = {}): Promise<ArtifactResult> {
    const operation = 'artifact.import'
    const fail = (error: string, message: string, detail?: unknown): ArtifactResult => ({ ok: false, operation, error, message, ...(detail !== undefined ? { detail } : {}) })
    const imported = await importFile(name.replace(/^.*[\\/]/, '').slice(0, 200), bytes)
    if ('error' in imported) return fail(imported.error, imported.message)
    const kept = await this.keep(profileId, operation, imported.body, { title: imported.title, source: imported.source, notes: imported.notes, acceptSecrets: about.acceptSecrets === true }, fail)
    if (!kept.ok || !isConversationId(about.conversationId)) return kept
    const record = (kept.value as { record: ArtifactRecord }).record
    const stamped: ArtifactRecord = { ...record, conversationId: about.conversationId }
    await this.o.store.writeRecord(profileId, stamped)
    return { ...kept, value: { ...(kept.value as Record<string, unknown>), record: stamped } }
  }

  /**
   * What an artifact holds, as words a model can be handed -- with every figure worked out here first.
   *
   * For a question in the chat about something that was made ("what is the highest expense?"). A model shown rows
   * and asked for a total adds them up in its head and is sometimes wrong, and a model shown the first hundred rows
   * of a thousand answers about a hundred. So for a table the counts, sums, smallest, largest and mean of every
   * number column are computed over ALL the rows and written out as facts, the row each extreme sits in is named,
   * and the sample of rows says how many there are beyond it. Bounded: this goes into a prompt.
   *
   * Not an operation. The window never needs it; it is what the main process hands to Orion.
   */
  async contextOf(profileId: string, artifactId: string, limit = 6000): Promise<{ title: string; kind: ArtifactKindId; version: number; text: string } | null> {
    if (!isArtifactId(artifactId)) return null
    const record = await this.o.store.readRecord(profileId, artifactId)
    if (!record) return null
    const body = await this.bodyOf(profileId, record)
    if (!body) return null
    const lines: string[] = []
    if (body.kind === 'table') {
      const table = body.table
      const shown = table.columns.slice(0, 30)
      lines.push(`A table called "${record.title}" with ${rowsOf(table.rows.length)} and ${table.columns.length} columns: ${shown.map((one) => `${one.name} (${one.type}${one.unit ? `, in ${one.unit.display}` : ''})`).join(', ')}.`)
      if (table.rows.length > 0) lines.push('', 'Worked out by Orbis over ALL the rows. Use these figures as they are; do not add rows up yourself:')
      const rowAs = (at: number): string => shown.map((column, c) => `${column.name}=${cellOut(table.rows[at].cells[c] ?? null, column)}`).join(', ')
      const tidy = (value: number): string => String(Number(value.toPrecision(12)))
      shown.forEach((column, c) => {
        if (table.rows.length === 0) return
        if (column.type === 'number' || column.type === 'integer' || column.type === 'quantity') {
          let count = 0
          let sum = 0
          let low = Number.POSITIVE_INFINITY
          let high = Number.NEGATIVE_INFINITY
          let lowAt = -1
          let highAt = -1
          table.rows.forEach((row, at) => {
            const value = asNumber(row.cells[c] ?? null)
            if (value === null) return
            count += 1
            sum += value
            if (value < low) [low, lowAt] = [value, at]
            if (value > high) [high, highAt] = [value, at]
          })
          if (count === 0) lines.push(`- ${column.name}: no values that are numbers.`)
          else lines.push(`- ${column.name}: ${count} values, sum ${tidy(sum)}, mean ${tidy(sum / count)}, smallest ${tidy(low)} (row: ${rowAs(lowAt)}), largest ${tidy(high)} (row: ${rowAs(highAt)})${count < table.rows.length ? `, ${table.rows.length - count} empty` : ''}.`)
        } else if (column.type === 'category' || column.type === 'text' || column.type === 'boolean') {
          const counts = new Map<string, number>()
          for (const row of table.rows) {
            const value = cellOut(row.cells[c] ?? null, column)
            if (value !== '') counts.set(value, (counts.get(value) ?? 0) + 1)
          }
          if (counts.size > 0 && counts.size <= Math.max(12, table.rows.length / 2)) {
            const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
            lines.push(`- ${column.name}: ${counts.size} different values; the most frequent: ${top.map(([value, n]) => `${value} (${n})`).join(', ')}.`)
          }
        }
      })
      const sample = Math.min(table.rows.length, 40)
      if (sample > 0) {
        lines.push('', sample < table.rows.length ? `The first ${sample} of ${rowsOf(table.rows.length)} (the rest are NOT shown; say so if the answer would need them):` : `Every row:`)
        for (let at = 0; at < sample; at++) lines.push(rowAs(at))
      }
    } else if (body.kind === 'document') {
      lines.push(`A document called "${record.title}":`, '', toText(body.document))
    } else if (body.kind === 'code') {
      lines.push(`A ${languageById(body.code.language)?.name ?? body.code.language} file called "${record.title}" (${lineCount(body.code.source)} lines). Orbis has not run it:`, '', body.code.source)
    } else if (body.kind === 'diagram') {
      const label = new Map(body.diagram.objects.map((one) => [one.id, one.text]))
      lines.push(`A flowchart called "${record.title}" with ${body.diagram.objects.length} boxes:`, ...body.diagram.objects.map((one) => `- ${one.text} (${one.type})`), 'Arrows:', ...body.diagram.connectors.map((one) => `- ${label.get(one.from) ?? one.from} -> ${label.get(one.to) ?? one.to}${one.text ? ` [${one.text}]` : ''}`))
    } else {
      lines.push(`A chart called "${record.title}": ${body.plot.series.map((one) => one.label).join(', ')} against ${body.plot.x.label || 'the bottom axis'}.`, ...record.notes)
    }
    const text = lines.join('\n')
    return { title: record.title, kind: record.kind, version: record.version, text: text.length > limit ? `${text.slice(0, limit)}\n[... cut here: ${text.length - limit} more characters are not shown ...]` : text }
  }

  // ---------------------------------------------------------------- analyse

  /** A table analysed by the data engines, and the write-up kept as a document whose every figure was computed. */
  private async analyse(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
  ): Promise<ArtifactResult> {
    const artifactId = str(req.artifactId, 60)
    if (!isArtifactId(artifactId)) return fail('bad-input', 'That is not an artifact id.')
    const record = await this.o.store.readRecord(profileId, artifactId)
    if (!record) return fail('not-found', 'There is no artifact with that id.')
    if (record.kind !== 'table') return fail('bad-input', 'Only a table can be analysed this way.')
    const sourceBytes = await this.o.store.readFile(profileId, artifactId, SOURCE_FILE)
    if (!sourceBytes) return fail('not-found', 'The artifact is listed but its source is missing.')
    const body = JSON.parse(decode(sourceBytes)) as ArtifactBody
    if (body.kind !== 'table') return fail('failed', 'The artifact is damaged: its source is not the kind its record says.')

    const analysis = analyseTable(body.table)
    const document = analysisDocument(analysis, record.title)
    const kept = await this.keep(
      profileId,
      operation,
      { kind: 'document', document },
      {
        title: document.metadata.title,
        source: document.metadata.source,
        notes: [`Every figure was computed by Orbis from "${record.title}" (${record.artifactId}). Nothing in it was written by a model.`],
        acceptSecrets: req.acceptSecrets === true
      },
      fail
    )
    if (!kept.ok) return kept
    return { ok: true, operation, value: { ...(kept.value as Record<string, unknown>), headlines: analysis.headlines, findings: analysis.findings.length, from: artifactId } }
  }

  // ---------------------------------------------------------------- existing

  /** The record an operation names, or the refusal to hand back. */
  private async existing(profileId: string, req: Record<string, unknown>, fail: (error: string, message: string) => ArtifactResult): Promise<ArtifactRecord | ArtifactResult> {
    const artifactId = str(req.artifactId, 60)
    if (!isArtifactId(artifactId)) return fail('bad-input', 'That is not an artifact id.')
    const record = await this.o.store.readRecord(profileId, artifactId)
    return record ?? fail('not-found', 'There is no artifact with that id.')
  }

  /** An artifact's body, from the source of its current version. */
  private async bodyOf(profileId: string, record: ArtifactRecord): Promise<ArtifactBody | null> {
    const sourceBytes = await this.o.store.readFile(profileId, record.artifactId, SOURCE_FILE)
    if (!sourceBytes) return null
    const body = JSON.parse(decode(sourceBytes)) as ArtifactBody
    return body.kind === record.kind ? body : null
  }

  // ---------------------------------------------------------------- update, restore, duplicate

  /** New text for an existing artifact, kept as its next version. The version before it stays, files and all. */
  private async update(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
  ): Promise<ArtifactResult> {
    const record = await this.existing(profileId, req, fail)
    if ('ok' in record) return record
    if (typeof req.text !== 'string' || req.text.trim() === '') return fail('bad-input', 'There is no text to replace it with.')
    if (req.text.length > LIMITS.text) return fail('too-large', `That is ${req.text.length.toLocaleString('en')} characters, past the ${LIMITS.text.toLocaleString('en')} one artifact can be made from at once.`)
    const body = this.bodyFrom(record.kind, req.text, 'pasted', record.title)
    if ('error' in body) return fail(body.error, body.message)
    return this.keep(profileId, operation, body, { title: record.title, source: 'pasted', notes: [], acceptSecrets: req.acceptSecrets === true, existing: record, reason: str(req.reason, 300) || 'Replaced with new text.' }, fail)
  }

  /** An earlier version made current again -- as a new version, so the history only grows. */
  private async restore(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
  ): Promise<ArtifactResult> {
    const record = await this.existing(profileId, req, fail)
    if ('ok' in record) return record
    const versionId = str(req.versionId, 60)
    const wanted = record.versions.find((one) => one.versionId === versionId)
    if (!isVersionId(versionId) || !wanted) return fail('not-found', 'There is no such earlier version of this artifact.')
    const sourceBytes = await this.o.store.readVersionFile(profileId, record.artifactId, versionId, SOURCE_FILE)
    if (!sourceBytes) return fail('not-found', `Version ${wanted.version} is listed but its files are missing.`)
    const body = JSON.parse(decode(sourceBytes)) as ArtifactBody
    if (body.kind !== record.kind) return fail('failed', 'That version is not the kind this artifact is.')
    return this.keep(
      profileId,
      operation,
      body,
      { title: record.title, source: record.source, notes: [`Restored from version ${wanted.version}.`], acceptSecrets: req.acceptSecrets === true, existing: record, reason: `Restored version ${wanted.version}.` },
      fail
    )
  }

  /** A new artifact with the same content, which remembers where it came from. */
  private async duplicate(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
  ): Promise<ArtifactResult> {
    const record = await this.existing(profileId, req, fail)
    if ('ok' in record) return record
    const body = await this.bodyOf(profileId, record)
    if (!body) return fail('not-found', 'The artifact is listed but its source is missing.')
    return this.keep(
      profileId,
      operation,
      body,
      {
        title: `Copy of ${record.title}`.slice(0, LIMITS.title),
        source: `"${record.title}" (copied)`,
        notes: [...record.notes, `A copy of "${record.title}", version ${record.version}.`],
        acceptSecrets: true,
        derivedFrom: { artifactId: record.artifactId, versionId: record.versionId, title: record.title }
      },
      fail
    )
  }

  // ---------------------------------------------------------------- search

  /** Artifacts whose name, notes, source or content hold every word asked for, with where the words were found. */
  private async search(profileId: string, query: string): Promise<{ record: ArtifactRecord; ref: ReturnType<typeof refOf>; where: 'title' | 'notes' | 'content'; excerpt: string }[]> {
    const words = query.toLowerCase().split(/\s+/).filter((one) => one !== '')
    if (words.length === 0) return []
    const out: { record: ArtifactRecord; ref: ReturnType<typeof refOf>; where: 'title' | 'notes' | 'content'; excerpt: string }[] = []
    const records = (await this.o.store.list(profileId)).slice(0, 500)
    for (const record of records) {
      const title = record.title.toLowerCase()
      const about = `${record.source} ${record.notes.join(' ')} ${record.kind}`.toLowerCase()
      if (words.every((one) => title.includes(one))) {
        out.push({ record, ref: refOf(record), where: 'title', excerpt: record.title })
        continue
      }
      if (words.every((one) => title.includes(one) || about.includes(one))) {
        out.push({ record, ref: refOf(record), where: 'notes', excerpt: record.notes.find((n) => words.some((w) => n.toLowerCase().includes(w))) ?? record.source })
        continue
      }
      const bytes = await this.o.store.readFile(profileId, record.artifactId, record.file)
      if (!bytes) continue
      const text = decode(bytes.subarray(0, LIMITS.preview))
      const lower = text.toLowerCase()
      if (!words.every((one) => lower.includes(one))) continue
      const at = lower.indexOf(words[0])
      const excerpt = text.slice(Math.max(0, at - 70), Math.min(text.length, at + words[0].length + 90)).replace(/\s+/g, ' ').trim()
      out.push({ record, ref: refOf(record), where: 'content', excerpt: `…${excerpt}…` })
      if (out.length >= 50) break
    }
    return out
  }

  // ---------------------------------------------------------------- keep

  /**
   * A body kept under the profile, read back, and checked. The one path every made thing goes down.
   *
   * With `existing`, it is the next version of that artifact: the record before it becomes an entry in the history
   * and its files stay where the store moved them. Without, it is a new artifact. Either way nothing is reported as
   * kept until the stored copy has been read back and checked -- and a new version that fails that check is thrown
   * away and the version before it made current again, so an artifact is never left pointing at a copy that lies.
   */
  private async keep(
    profileId: string,
    operation: string,
    body: ArtifactBody,
    about: { title: string; source: string; notes: string[]; acceptSecrets: boolean; existing?: ArtifactRecord; reason?: string; derivedFrom?: ArtifactRecord['derivedFrom'] },
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
  ): Promise<ArtifactResult> {
    const { title, source, acceptSecrets, existing } = about
    const kind = body.kind
    const format = ARTIFACT_KINDS[kind].stores
    const rendered = await this.render(body, format, title, profileId)
    if ('error' in rendered) return fail(rendered.error, rendered.message)

    const ext = body.kind === 'code' ? extensionForLanguage(body.code.language) : extensionFor(format)
    const gate = gateForWrite(`${safeName(title)}${ext}`, this.wordsOf(body, rendered), acceptSecrets)
    if (!gate.ok) return fail('secrets', gate.message, { findings: gate.findings })

    const now = this.o.now()
    const file = `${CONTENT_PREFIX}${ext}`
    const record: ArtifactRecord = {
      artifactId: existing ? existing.artifactId : makeArtifactId(this.o.random()),
      versionId: makeVersionId(this.o.random()),
      version: existing ? existing.version + 1 : 1,
      versions: existing ? [...existing.versions, summaryOf(existing)] : [],
      reason: about.reason ?? '',
      derivedFrom: about.derivedFrom ?? existing?.derivedFrom ?? null,
      kind,
      title,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      format,
      file,
      bytes: rendered.bytes.length,
      hash: rendered.hash,
      loss: rendered.loss,
      // Not verified yet. The record is written with this, and replaced only once the read-back has passed.
      verified: { ok: false, checks: [], reimported: null, differences: ['Not yet read back.'] },
      source,
      shape: this.shapeOf(body),
      tags: existing ? existing.tags : [],
      notes: [...about.notes, ...rendered.notes.filter((one) => !about.notes.includes(one))],
      // A new version stays in the conversation the artifact was made in, whoever asked for the change.
      ...(existing?.conversationId ? { conversationId: existing.conversationId } : {})
    }

    await this.o.store.write(profileId, record, [
      { name: SOURCE_FILE, bytes: encode(JSON.stringify(body)) },
      { name: file, bytes: rendered.bytes }
    ])

    const readBack = await this.o.store.readFile(profileId, record.artifactId, file)
    const verified = readBack
      ? await this.verify(body, rendered, readBack)
      : { ok: false, checks: [{ what: 'written', passed: false, describe: 'The stored file could not be read back.' }], reimported: null, differences: [] }
    if (!verified.ok) {
      // Not kept. A copy that does not read back is not an artifact. A new artifact is removed; a new version is
      // thrown away and the version before it put back, because that one was fine and a library entry pointing at
      // a copy that lies would be a lie that lasts.
      if (existing) await this.o.store.discardCurrent(profileId, record.artifactId, existing.versionId)
      else await this.o.store.remove(profileId, record.artifactId)
      return fail('verify', `It was written and read back, and the copy did not match: ${verified.checks.filter((one) => !one.passed).map((one) => one.describe).join(' ')}`, { verified })
    }

    const kept: ArtifactRecord = { ...record, verified }
    await this.o.store.writeRecord(profileId, kept)
    return { ok: true, operation, value: { record: kept, ref: refOf(kept), notes: kept.notes } }
  }

  // ---------------------------------------------------------------- read

  private async read(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
  ): Promise<ArtifactResult> {
    const artifactId = str(req.artifactId, 60)
    if (!isArtifactId(artifactId)) return fail('bad-input', 'That is not an artifact id.')
    const record = await this.o.store.readRecord(profileId, artifactId)
    if (!record) return fail('not-found', 'There is no artifact with that id.')
    const bytes = await this.o.store.readFile(profileId, artifactId, record.file)
    const text = bytes ? decode(bytes) : ''
    // A table's columns, so a chart can be asked for by name without the renderer parsing the stored copy.
    let columns: { id: string; name: string; type: string; formula: string }[] = []
    // The first rows as a person reads them -- dates as dates, quantities with their unit -- so the screen shows a
    // table and not the JSON it is kept as. Bounded: a look, not a second copy.
    let grid: { rows: string[][]; total: number } | null = null
    // The tables a document holds, so each can be offered to be taken out.
    let tables: DocumentTable[] = []
    if (record.kind === 'document') {
      const body = await this.bodyOf(profileId, record)
      if (body && body.kind === 'document') tables = tablesIn(body.document).slice(0, 40)
    }
    // For code: which language, so the screen can name it and the save button can show the right extension.
    let code: { language: string; name: string; extension: string } | null = null
    if (record.kind === 'code') {
      const body = await this.bodyOf(profileId, record)
      if (body && body.kind === 'code') code = { language: body.code.language, name: languageById(body.code.language)?.name ?? body.code.language, extension: extensionForLanguage(body.code.language) }
    }
    if (record.kind === 'table') {
      const body = await this.bodyOf(profileId, record)
      if (body && body.kind === 'table') {
        const table = body.table
        columns = table.columns.map((one) => ({ id: one.id, name: one.name, type: one.type, formula: formulaName(one.name) }))
        grid = {
          rows: table.rows.slice(0, LIMITS.gridRows).map((row) => table.columns.slice(0, LIMITS.gridColumns).map((column, at) => cellOut(row.cells[at] ?? null, column).slice(0, LIMITS.gridCell))),
          total: table.rows.length
        }
      }
    }
    return {
      ok: true,
      operation,
      value: {
        record,
        ref: refOf(record),
        preview: text.slice(0, LIMITS.preview),
        truncated: text.length > LIMITS.preview,
        columns,
        grid,
        tables,
        code,
        // Every format this kind can be exported as here, with what each one drops, so the chooser can say so up front.
        formats: code ? this.formatsFor(record.kind).map((one) => ({ ...one, name: code.name, extension: code.extension })) : this.formatsFor(record.kind)
      }
    }
  }

  // ---------------------------------------------------------------- export

  /**
   * An artifact written out as a file and checked.
   *
   * Two ways to say where. Through the dialog, the person picks the place. To Downloads, Orbis picks it: the folder
   * the system calls Downloads and a name nothing there already has, which is what "download" means everywhere else
   * and needs no window. In neither does a path come from the interface.
   */
  private async export(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult,
    to: 'dialog' | 'downloads'
  ): Promise<ArtifactResult> {
    const artifactId = str(req.artifactId, 60)
    if (!isArtifactId(artifactId)) return fail('bad-input', 'That is not an artifact id.')
    const record = await this.o.store.readRecord(profileId, artifactId)
    if (!record) return fail('not-found', 'There is no artifact with that id.')

    const format = str(req.format, 20) || record.format
    if (!canWrite(record.kind, format) || !this.canProduce(format)) {
      const offered = this.formatsFor(record.kind).map((one) => one.format)
      return fail('bad-input', `A ${ARTIFACT_KINDS[record.kind].name.toLowerCase()} cannot be saved as "${format}" here. It can be saved as: ${offered.join(', ')}.`)
    }
    const acceptSecrets = req.acceptSecrets === true

    const sourceBytes = await this.o.store.readFile(profileId, artifactId, SOURCE_FILE)
    if (!sourceBytes) return fail('not-found', 'The artifact is listed but its source is missing.')
    const body = JSON.parse(decode(sourceBytes)) as ArtifactBody
    if (body.kind !== record.kind) return fail('failed', 'The artifact is damaged: its source is not the kind its record says.')

    const rendered = await this.render(body, format, record.title, profileId)
    if ('error' in rendered) return fail(rendered.error, rendered.message)

    const ext = body.kind === 'code' ? extensionForLanguage(body.code.language) : extensionFor(format)
    const base = safeName(record.title)
    const gate = gateForWrite(`${base}${ext}`, this.wordsOf(body, rendered), acceptSecrets)
    if (!gate.ok) return fail('secrets', gate.message, { findings: gate.findings })

    let path: string | null
    if (to === 'downloads') {
      if (!this.o.downloadsDir) return fail('unavailable', 'Downloading is not available here. It can still be saved with "Save as".')
      const folder = this.o.downloadsDir()
      // Never over something that is already there: "Report.pdf", then "Report (2).pdf".
      path = join(folder, unique(base, ext, (candidate) => existsSync(join(folder, candidate))))
    } else {
      path = await this.o.chooseDestination({
        title: `Save ${record.title}`,
        defaultName: `${base}${ext}`,
        filters: [{ name: body.kind === 'code' ? (languageById(body.code.language)?.name ?? FORMATS[format].name) : FORMATS[format].name, extensions: [ext.slice(1)] }]
      })
    }
    if (path === null) return fail('cancelled', 'Nothing was written.')

    await (this.o.writeFile ?? writeToDisk)(path, rendered.bytes)
    this.written.add(path)
    const readBack = await (this.o.readFile ?? (async (p: string) => new Uint8Array(await readFromDisk(p))))(path)
    const verified = await this.verify(body, rendered, readBack)

    const outcome: ExportOutcome = { artifactId, format, path, bytes: rendered.bytes.length, hash: rendered.hash, loss: rendered.loss, verified }
    if (!verified.ok) {
      // The file exists where the person chose; deleting it from under them would be worse than saying what is wrong.
      return fail('verify', `The file was written but did not read back correctly: ${verified.checks.filter((one) => !one.passed).map((one) => one.describe).join(' ')}`, outcome)
    }
    return { ok: true, operation, value: { ...outcome, notes: rendered.notes } }
  }
}
