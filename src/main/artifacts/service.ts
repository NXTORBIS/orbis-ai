import { readFile as readFromDisk, writeFile as writeToDisk } from 'node:fs/promises'
import { isDataError, parseDelimited, type Table } from '../../shared/compute/data.ts'
import { emptyDocument, fromMarkdown, isDocumentError, type StructuredDocument } from '../../shared/compute/document.ts'
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
  isVersionId,
  makeArtifactId,
  makeVersionId,
  refOf,
  summaryOf,
  type ArtifactBody,
  type ArtifactRecord,
  type ExportOutcome
} from '../../shared/artifacts/model.ts'
import { safeName } from '../../shared/artifacts/naming.ts'
import { gateForWrite } from '../../shared/artifacts/secrets.ts'
import { verifyDocumentFile, verifyPdfFile, verifyTableFile } from '../../shared/artifacts/validate.ts'
import type { ArtifactGeneration } from './generation.ts'
import { importFile } from './importing.ts'
import { verifyDocx, verifyPptx, verifyXlsx, writeDocx, writePptx, writeXlsx } from './office.ts'
import { ArtifactStore, CONTENT_PREFIX, SOURCE_FILE } from './store.ts'
import { toDelimited } from '../../shared/compute/data.ts'
import { toText } from '../../shared/compute/documentHtml.ts'
import { analyseTable, analysisDocument } from '../../shared/artifacts/analysis.ts'
import { diagramToSvg, plotToSvg, verifySvgFile } from '../../shared/artifacts/svg.ts'
import { asNumber, formatDate, type Column } from '../../shared/compute/data.ts'
import { buildPlot, isPlotError, seriesFromPoints, type Series, type SeriesKind } from '../../shared/compute/plot.ts'
import { decodePng } from '../chromium/png.ts'
import { cellOut, joinTables, type JoinKind } from '../../shared/compute/data.ts'
import { applySteps, formulaName, isTransformFailure, readSteps, type TransformStep } from '../../shared/artifacts/transform.ts'

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
  'artifact.join': 'Two tables joined on a column, with how many rows on each side found a partner.'
})

const JOIN_KINDS: readonly JoinKind[] = Object.freeze(['inner', 'left', 'full'])

const SERIES_KINDS: readonly SeriesKind[] = Object.freeze(['line', 'bar', 'scatter', 'area', 'step'])

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
}

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

  constructor(options: ArtifactServiceOptions) {
    this.o = options
  }

  async run(profileId: string, request: unknown): Promise<ArtifactResult> {
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
        case 'artifact.list':
          return { ok: true, operation, value: (await this.o.store.list(profileId)).map((one) => ({ record: one, ref: refOf(one) })) }
        case 'artifact.create':
          return await this.create(profileId, operation, req, fail)
        case 'artifact.generate':
          return await this.generate(profileId, operation, req, fail)
        case 'artifact.import':
          return await this.import(profileId, operation, req, fail)
        case 'artifact.analyse':
          return await this.analyse(profileId, operation, req, fail)
        case 'artifact.read':
          return await this.read(profileId, operation, req, fail)
        case 'artifact.export':
          return await this.export(profileId, operation, req, fail)
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
          return await this.chart(profileId, operation, req, fail)
        case 'artifact.transform':
          return await this.transform(profileId, operation, req, fail)
        case 'artifact.join':
          return await this.join(profileId, operation, req, fail)
        default:
          return fail('unknown-operation', `Orbis has no artifact operation called "${operation}".`)
      }
    } catch (err) {
      return fail('failed', err instanceof Error && err.message.length < 200 ? err.message : 'That did not work.')
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

  private bodyFrom(kind: ArtifactKindId, text: string, source: string, title: string): ArtifactBody | { error: string; message: string } {
    if (kind === 'table') {
      const parsed = parseDelimited(text)
      if (isDataError(parsed)) return { error: 'parse', message: parsed.message }
      const table: Table = { ...parsed.table, source }
      return { kind: 'table', table }
    }
    // A drawing is never pasted: a chart comes from a table's numbers and a diagram from a description. Falling through
    // to the document reader here would quietly keep the pasted text as a document called a chart.
    if (kind === 'plot') return { error: 'bad-input', message: 'A chart is drawn from a table. Open or paste the table, then choose the columns to draw.' }
    if (kind === 'diagram') return { error: 'bad-input', message: 'A diagram is made by describing it to Orion, not pasted.' }
    const parsed = fromMarkdown(text, 'b')
    if (isDocumentError(parsed)) return { error: 'parse', message: parsed.message }
    const document: StructuredDocument = emptyDocument('document', title)
    document.blocks = parsed.blocks
    document.metadata.source = source
    return { kind: 'document', document }
  }

  private async render(body: ArtifactBody, format: FormatId, title = ''): Promise<Rendered | { error: string; message: string }> {
    if (body.kind === 'plot' || body.kind === 'diagram') {
      const made = body.kind === 'plot' ? plotToSvg(body.plot) : diagramToSvg(body.diagram)
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
      const made = format === 'docx' ? await writeDocx(body.document) : await writePptx(body.document)
      return { bytes: made.bytes, text: null, scan: toText(body.document), format, hash: hashOf(made.bytes), loss, notes: [...made.notes, ...loss.losses.map((one) => one.describe)], count: made.count }
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
      // The print window fetches nothing, so the HTML it is handed says so in its own policy.
      const made = toHtml(body.document, { forPrint: true })
      const bytes = await this.o.renderPdf(made.html)
      return { bytes, text: null, scan: made.html, format, hash: hashOf(bytes), loss, notes: [...made.notes, ...loss.losses.map((one) => one.describe)] }
    }
    const result = exportDocument(body.document, format)
    if (isInterchangeError(result)) return { error: 'encode', message: result.message }
    return { bytes: encode(result.text), text: result.text, scan: result.text, format, hash: result.hash, loss: result.loss, notes: result.notes }
  }

  /** The written file, checked against what was meant to be written and against what it came from. */
  private async verify(body: ArtifactBody, rendered: Rendered, readBack: Uint8Array): Promise<VerifyResult> {
    const shape = { bytes: rendered.bytes.length, hash: rendered.hash }
    if (rendered.format === 'pdf') return verifyPdfFile(shape, readBack)
    if (rendered.format === 'svg') return verifySvgFile(shape, readBack)
    if (rendered.format === 'png') return verifyPngFile({ ...shape, width: rendered.size?.width ?? 0, height: rendered.size?.height ?? 0 }, readBack)
    if (rendered.format === 'xlsx' && body.kind === 'table') return verifyXlsx(body.table, shape, readBack)
    if (rendered.format === 'docx' && body.kind === 'document') return verifyDocx(shape, readBack)
    if (rendered.format === 'pptx' && body.kind === 'document') return verifyPptx({ ...shape, slides: rendered.count ?? 0 }, readBack)
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
    }
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
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
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
      })
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
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
  ): Promise<ArtifactResult> {
    const record = await this.existing(profileId, req, fail)
    if ('ok' in record) return record
    if (record.kind !== 'table') return fail('bad-input', 'A chart is made from a table.')
    const body = await this.bodyOf(profileId, record)
    if (!body || body.kind !== 'table') return fail('not-found', 'The artifact is listed but its source is missing.')
    const table = body.table

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
    const seriesKind: SeriesKind = (SERIES_KINDS as readonly string[]).includes(kind) ? (kind as SeriesKind) : 'line'

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
      const every = Math.max(1, Math.ceil(table.rows.length / 12))
      const ticks = table.rows.map((row, i) => {
        const cell = row.cells[x.index] ?? null
        const label = x.column.type === 'date' && typeof cell === 'number' ? formatDate(cell) : String(cell ?? '')
        return { value: i, label: i % every === 0 ? label : '', major: i % every === 0 }
      })
      plot = { ...made, x: { ...made.x, ticks, label: x.column.name } }
      notes.push(`"${x.column.name}" is drawn in row order, with its values as the labels.`)
    }

    return this.keep(
      profileId,
      operation,
      { kind: 'plot', plot },
      {
        title,
        source: `"${record.title}" (its numbers)`,
        notes: [`Drawn from the table "${record.title}" (version ${record.version}): ${ys.map((one) => one.found!.column.name).join(', ')} against ${x.column.name}.`, ...notes],
        acceptSecrets: true,
        derivedFrom: { artifactId: record.artifactId, versionId: record.versionId, title: record.title }
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
    const title = str(req.title, LIMITS.title).trim() || (kind === 'table' ? 'Table' : 'Document')
    const source = str(req.source, 200) || 'pasted'
    const acceptSecrets = req.acceptSecrets === true

    const body = this.bodyFrom(kind, req.text, source, title)
    if ('error' in body) return fail(body.error, body.message)
    return this.keep(profileId, operation, body, { title, source, notes: [], acceptSecrets }, fail)
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
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
  ): Promise<ArtifactResult> {
    if (!this.o.generation) return fail('unavailable', 'Orion is not set up on this computer, so there is nothing to write it with.')
    const request = str(req.request, 4000).trim()
    if (request === '') return fail('bad-input', 'Say what you want made.')
    const acceptSecrets = req.acceptSecrets === true

    const outcome = await this.o.generation.generate(request)
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
    const rendered = await this.render(body, format, title)
    if ('error' in rendered) return fail(rendered.error, rendered.message)

    const ext = extensionFor(format)
    const gate = gateForWrite(`${safeName(title)}${ext}`, rendered.scan, acceptSecrets)
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
      notes: [...about.notes, ...rendered.notes.filter((one) => !about.notes.includes(one))]
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
        // Every format this kind can be exported as here, with what each one drops, so the chooser can say so up front.
        formats: this.formatsFor(record.kind)
      }
    }
  }

  // ---------------------------------------------------------------- export

  private async export(
    profileId: string,
    operation: string,
    req: Record<string, unknown>,
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
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

    const rendered = await this.render(body, format, record.title)
    if ('error' in rendered) return fail(rendered.error, rendered.message)

    const ext = extensionFor(format)
    const base = safeName(record.title)
    const gate = gateForWrite(`${base}${ext}`, rendered.scan, acceptSecrets)
    if (!gate.ok) return fail('secrets', gate.message, { findings: gate.findings })

    const path = await this.o.chooseDestination({
      title: `Save ${record.title}`,
      defaultName: `${base}${ext}`,
      filters: [{ name: FORMATS[format].name, extensions: [ext.slice(1)] }]
    })
    if (path === null) return fail('cancelled', 'Nothing was written.')

    await (this.o.writeFile ?? writeToDisk)(path, rendered.bytes)
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
