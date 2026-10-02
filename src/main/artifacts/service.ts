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
  makeArtifactId,
  refOf,
  type ArtifactBody,
  type ArtifactRecord,
  type ExportOutcome
} from '../../shared/artifacts/model.ts'
import { safeName } from '../../shared/artifacts/naming.ts'
import { gateForWrite } from '../../shared/artifacts/secrets.ts'
import { verifyDocumentFile, verifyPdfFile, verifyTableFile } from '../../shared/artifacts/validate.ts'
import type { ArtifactGeneration } from './generation.ts'
import { ArtifactStore, CONTENT_PREFIX, SOURCE_FILE } from './store.ts'

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
  preview: 1024 * 1024
})

/** Every operation this door answers. An operation missing from here cannot run, by construction. */
const OPERATIONS: Readonly<Record<string, string>> = Object.freeze({
  'artifact.kinds': 'What Orbis can create, and in which formats.',
  'artifact.create': 'Make an artifact from text, keep it, and check the kept copy.',
  'artifact.generate': 'Make an artifact from a sentence: Orion decides what and writes it, Orbis builds, keeps and checks it.',
  'artifact.list': 'Every artifact in this profile.',
  'artifact.read': 'One artifact, with a bounded preview of its content.',
  'artifact.export': 'Write an artifact to a file the person chooses, then check the file.',
  'artifact.remove': 'Remove an artifact and its files.'
})

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
  /**
   * A page of HTML printed to PDF bytes, by a print engine that lives outside this file.
   *
   * Optional, and absent is a working state: a copy of Orbis with no print engine leaves PDF out of what it offers
   * rather than offering a button that fails.
   */
  renderPdf?(html: string): Promise<Uint8Array>
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
  /** The text form, when there is one. A PDF has none, and its HTML is what gets scanned instead. */
  text: string | null
  /** What the secret gate reads. The text, or for a PDF the HTML it was printed from. */
  scan: string
  format: FormatId
  hash: string
  loss: LossReport
  notes: string[]
}

const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')
const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

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
        case 'artifact.read':
          return await this.read(profileId, operation, req, fail)
        case 'artifact.export':
          return await this.export(profileId, operation, req, fail)
        case 'artifact.remove': {
          const artifactId = str(req.artifactId, 60)
          if (!isArtifactId(artifactId)) return fail('bad-input', 'That is not an artifact id.')
          return { ok: true, operation, value: { removed: await this.o.store.remove(profileId, artifactId) } }
        }
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
    return format !== 'pdf' || typeof this.o.renderPdf === 'function'
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
    const parsed = fromMarkdown(text, 'b')
    if (isDocumentError(parsed)) return { error: 'parse', message: parsed.message }
    const document: StructuredDocument = emptyDocument('document', title)
    document.blocks = parsed.blocks
    document.metadata.source = source
    return { kind: 'document', document }
  }

  private async render(body: ArtifactBody, format: FormatId): Promise<Rendered | { error: string; message: string }> {
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
  private verify(body: ArtifactBody, rendered: Rendered, readBack: Uint8Array): VerifyResult {
    if (rendered.format === 'pdf') return verifyPdfFile({ bytes: rendered.bytes.length, hash: rendered.hash }, readBack)
    const expected: ExportResult = {
      text: rendered.text ?? '',
      format: rendered.format,
      bytes: rendered.bytes.length,
      hash: rendered.hash,
      rows: 0,
      loss: rendered.loss,
      notes: rendered.notes
    }
    return body.kind === 'table' ? verifyTableFile(body.table, expected, readBack) : verifyDocumentFile(body.document.blocks.length, expected, readBack)
  }

  private shapeOf(body: ArtifactBody): { rows: number; columns: number } {
    return body.kind === 'table'
      ? { rows: body.table.rows.length, columns: body.table.columns.length }
      : { rows: body.document.blocks.length, columns: 0 }
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

  // ---------------------------------------------------------------- keep

  /** A body kept under the profile, read back, and checked. The one path every made thing goes down. */
  private async keep(
    profileId: string,
    operation: string,
    body: ArtifactBody,
    about: { title: string; source: string; notes: string[]; acceptSecrets: boolean },
    fail: (error: string, message: string, detail?: unknown) => ArtifactResult
  ): Promise<ArtifactResult> {
    const { title, source, acceptSecrets } = about
    const kind = body.kind
    const format = ARTIFACT_KINDS[kind].stores
    const rendered = await this.render(body, format)
    if ('error' in rendered) return fail(rendered.error, rendered.message)

    const ext = extensionFor(format)
    const gate = gateForWrite(`${safeName(title)}${ext}`, rendered.scan, acceptSecrets)
    if (!gate.ok) return fail('secrets', gate.message, { findings: gate.findings })

    const now = this.o.now()
    const file = `${CONTENT_PREFIX}${ext}`
    const record: ArtifactRecord = {
      artifactId: makeArtifactId(this.o.random()),
      kind,
      title,
      createdAt: now,
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
      tags: [],
      notes: [...about.notes, ...rendered.notes.filter((one) => !about.notes.includes(one))]
    }

    await this.o.store.write(profileId, record, [
      { name: SOURCE_FILE, bytes: encode(JSON.stringify(body)) },
      { name: file, bytes: rendered.bytes }
    ])

    const readBack = await this.o.store.readFile(profileId, record.artifactId, file)
    const verified = readBack
      ? this.verify(body, rendered, readBack)
      : { ok: false, checks: [{ what: 'written', passed: false, describe: 'The stored file could not be read back.' }], reimported: null, differences: [] }
    if (!verified.ok) {
      // Not kept. An artifact whose stored copy does not read back is not an artifact, and a library entry pointing at
      // it would be a lie that lasts.
      await this.o.store.remove(profileId, record.artifactId)
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
    return {
      ok: true,
      operation,
      value: {
        record,
        ref: refOf(record),
        preview: text.slice(0, LIMITS.preview),
        truncated: text.length > LIMITS.preview,
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

    const rendered = await this.render(body, format)
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
    const verified = this.verify(body, rendered, readBack)

    const outcome: ExportOutcome = { artifactId, format, path, bytes: rendered.bytes.length, hash: rendered.hash, loss: rendered.loss, verified }
    if (!verified.ok) {
      // The file exists where the person chose; deleting it from under them would be worse than saying what is wrong.
      return fail('verify', `The file was written but did not read back correctly: ${verified.checks.filter((one) => !one.passed).map((one) => one.describe).join(' ')}`, outcome)
    }
    return { ok: true, operation, value: { ...outcome, notes: rendered.notes } }
  }
}
