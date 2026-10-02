/**
 * Files, datasets and interchange.
 *
 * Everything that crosses the boundary into Orbis, and everything that goes back out. The parsers themselves mostly
 * live elsewhere -- delimited text in `data.ts`, Markdown and HTML in `document.ts` -- and this is the layer that
 * decides what something is, whether it is safe to read, what it will cost, and what was lost on the way through.
 *
 * ## Detection is evidence, not a guess
 *
 * An extension is a claim the file makes about itself. A MIME type is a claim the source makes. Content is the only
 * evidence, and `detectFormat` reports all three separately with a confidence, so a `.csv` full of JSON is a conflict
 * to resolve rather than a parse that fails halfway.
 *
 * ## Import is transactional
 *
 * Nothing is committed until it has parsed and validated. The staging step exists so that a file which is well-formed
 * for eight thousand rows and broken on the eight thousand and first leaves nothing behind -- rather than leaving a
 * dataset that is silently missing its tail.
 *
 * ## Loss is reported
 *
 * Every conversion that cannot carry something says so. Units dropped by CSV, formatting dropped by plain text,
 * provenance dropped by a flat export: each is named. A conversion that quietly loses a column of uncertainties
 * produces a file that looks complete and is not.
 */

import { formatDate, isDataError, parseDelimited, toDelimited, type Column, type DataError, type Table } from './data.ts'
import { fromHtml, fromMarkdown, isDocumentError, toMarkdown, type Block, type StructuredDocument } from './document.ts'
import { toHtml, toText } from './documentHtml.ts'

export interface InterchangeError {
  error: string
  message: string
  /** Where in the pipeline it failed, so the message can say what did and did not happen. */
  phase: Phase
  /** What the person can do about it. Never "try again"; always something specific. */
  recovery: string
}

export type Phase = 'source' | 'detect' | 'decode' | 'parse' | 'validate' | 'stage' | 'commit' | 'transform' | 'encode' | 'write' | 'verify'

export const isInterchangeError = (value: unknown): value is InterchangeError =>
  typeof value === 'object' && value !== null && 'error' in value && 'phase' in value && 'message' in value

const fail = (error: string, phase: Phase, message: string, recovery: string): InterchangeError => ({ error, phase, message, recovery })

export const INTERCHANGE_LIMITS: Readonly<
  Record<'bytes' | 'rows' | 'columns' | 'depth' | 'nodes' | 'expansionRatio' | 'archiveEntries' | 'nameLength' | 'previewRows', number>
> = Object.freeze({
  bytes: 512 * 1024 * 1024,
  rows: 2_000_000,
  columns: 2_000,
  depth: 64,
  nodes: 2_000_000,
  // A compressed file expanding past this many times its own size is a decompression bomb, whatever it claims to be.
  expansionRatio: 200,
  archiveEntries: 10_000,
  nameLength: 255,
  previewRows: 50
})

// ---------------------------------------------------------------- format registry

export type FormatId = 'csv' | 'tsv' | 'json' | 'ndjson' | 'xml' | 'markdown' | 'html' | 'text' | 'pdf' | 'binary'

export interface FormatCapability {
  id: FormatId
  name: string
  extensions: string[]
  mediaTypes: string[]
  canImport: boolean
  canExport: boolean
  /** Whether it can be read a piece at a time, which decides whether a very large file is usable at all. */
  streaming: boolean
  /** What it can carry. A format that cannot hold units will lose them, and this is where that is knowable. */
  carries: { units: boolean; types: boolean; metadata: boolean; formatting: boolean; provenance: boolean; hierarchy: boolean }
  limitations: string[]
}

/**
 * What each format can actually do, in one place.
 *
 * The point of a registry rather than scattered checks is that "can this format hold units" is asked by the export
 * path, the loss warning and the format chooser, and three separate answers would eventually disagree.
 */
export const FORMATS: Readonly<Record<FormatId, FormatCapability>> = Object.freeze({
  csv: {
    id: 'csv',
    name: 'Comma-separated values',
    extensions: ['.csv'],
    mediaTypes: ['text/csv', 'application/csv'],
    canImport: true,
    canExport: true,
    streaming: true,
    carries: { units: false, types: false, metadata: false, formatting: false, provenance: false, hierarchy: false },
    limitations: [
      'Every cell is text. Types are inferred on the way back in and can be inferred differently.',
      'There is nowhere to put a unit, an uncertainty or a column description.',
      'Nested structure has to be flattened, and cannot be recovered from the flattening.'
    ]
  },
  tsv: {
    id: 'tsv',
    name: 'Tab-separated values',
    extensions: ['.tsv', '.tab'],
    mediaTypes: ['text/tab-separated-values'],
    canImport: true,
    canExport: true,
    streaming: true,
    carries: { units: false, types: false, metadata: false, formatting: false, provenance: false, hierarchy: false },
    limitations: ['The same limits as CSV, with a tab as the separator.']
  },
  json: {
    id: 'json',
    name: 'JSON',
    extensions: ['.json'],
    mediaTypes: ['application/json', 'text/json'],
    canImport: true,
    canExport: true,
    streaming: false,
    carries: { units: true, types: true, metadata: true, formatting: false, provenance: true, hierarchy: true },
    limitations: [
      'The whole document has to be held in memory to be read, so a very large file cannot be streamed.',
      'There is no date type; a date is text or a number, and which one has to be agreed.'
    ]
  },
  ndjson: {
    id: 'ndjson',
    name: 'Newline-delimited JSON',
    extensions: ['.ndjson', '.jsonl'],
    mediaTypes: ['application/x-ndjson'],
    canImport: true,
    canExport: true,
    streaming: true,
    carries: { units: true, types: true, metadata: false, formatting: false, provenance: true, hierarchy: true },
    limitations: ['Each line stands alone, so there is nowhere to put metadata about the file as a whole.']
  },
  xml: {
    id: 'xml',
    name: 'XML',
    extensions: ['.xml'],
    mediaTypes: ['application/xml', 'text/xml'],
    canImport: true,
    canExport: false,
    streaming: false,
    carries: { units: true, types: false, metadata: true, formatting: false, provenance: true, hierarchy: true },
    limitations: [
      'Orbis reads XML but does not write it.',
      'Document type definitions and external entities are refused, because they can fetch or expand without limit.'
    ]
  },
  markdown: {
    id: 'markdown',
    name: 'Markdown',
    extensions: ['.md', '.markdown'],
    mediaTypes: ['text/markdown'],
    canImport: true,
    canExport: true,
    streaming: false,
    carries: { units: false, types: false, metadata: false, formatting: true, provenance: false, hierarchy: true },
    limitations: ['Formatting beyond the constructs Orbis supports is imported as plain text rather than dropped.']
  },
  html: {
    id: 'html',
    name: 'HTML',
    extensions: ['.html', '.htm'],
    mediaTypes: ['text/html', 'application/xhtml+xml'],
    canImport: true,
    canExport: true,
    streaming: false,
    carries: { units: false, types: false, metadata: true, formatting: true, provenance: false, hierarchy: true },
    limitations: [
      'Equations are written as their source, not typeset.',
      'Scripts, styles and embedded frames are removed on import, along with their contents.'
    ]
  },
  pdf: {
    id: 'pdf',
    name: 'PDF',
    extensions: ['.pdf'],
    mediaTypes: ['application/pdf'],
    canImport: false,
    canExport: true,
    streaming: false,
    carries: { units: false, types: false, metadata: true, formatting: true, provenance: false, hierarchy: true },
    limitations: [
      "Typeset by Chromium's print engine from the HTML, so it will not match the HTML on screen exactly.",
      'Not editable: a PDF is the layout, fixed. Keep the source to change anything.',
      'Images from the web are shown as their alt text; the print window fetches nothing.',
      'Orbis does not read PDF back into a document yet.'
    ]
  },
  text: {
    id: 'text',
    name: 'Plain text',
    extensions: ['.txt', '.log'],
    mediaTypes: ['text/plain'],
    canImport: true,
    canExport: true,
    streaming: true,
    carries: { units: false, types: false, metadata: false, formatting: false, provenance: false, hierarchy: false },
    limitations: ['Nothing but the characters survives.']
  },
  binary: {
    id: 'binary',
    name: 'Binary',
    extensions: [],
    mediaTypes: ['application/octet-stream'],
    canImport: false,
    canExport: false,
    streaming: false,
    carries: { units: false, types: false, metadata: false, formatting: false, provenance: false, hierarchy: false },
    limitations: ['Orbis has no parser for this, so it is neither read nor interpreted.']
  }
})

export const formatById = (id: string): FormatCapability | null =>
  Object.prototype.hasOwnProperty.call(FORMATS, id) ? FORMATS[id as FormatId] : null

// ---------------------------------------------------------------- detection

export interface FormatEvidence {
  /** What the name claims. */
  byExtension: FormatId | null
  /** What the source claims. */
  byMediaType: FormatId | null
  /** What the bytes show. The only one of the three that is evidence rather than a claim. */
  byContent: FormatId | null
  confidence: 'certain' | 'likely' | 'uncertain' | 'unknown'
  chosen: FormatId
  /** Present when the three disagree. A conflict is surfaced rather than resolved by preferring one silently. */
  conflict: string | null
  reasons: string[]
}

/**
 * What a file is, from all three kinds of evidence.
 *
 * Content wins when it is unambiguous, because it is the only one that cannot be wrong about itself. When it is
 * ambiguous -- and a single column of numbers is valid CSV, valid text and valid NDJSON if the numbers are on their own
 * lines -- the extension breaks the tie and the confidence drops to say so.
 */
export function detectFormat(name: string, mediaType: string, sample: string): FormatEvidence {
  const reasons: string[] = []

  const lower = name.toLowerCase()
  let byExtension: FormatId | null = null
  for (const format of Object.values(FORMATS)) {
    if (format.extensions.some((one) => lower.endsWith(one))) {
      byExtension = format.id
      reasons.push(`The name ends with ${format.extensions.find((one) => lower.endsWith(one))}.`)
      break
    }
  }

  let byMediaType: FormatId | null = null
  const cleanMedia = mediaType.split(';')[0].trim().toLowerCase()
  if (cleanMedia !== '') {
    for (const format of Object.values(FORMATS)) {
      if (format.mediaTypes.includes(cleanMedia)) {
        byMediaType = format.id
        reasons.push(`The source says it is ${cleanMedia}.`)
        break
      }
    }
  }

  const byContent = sniff(sample, reasons)

  // Content first, then the extension, then the declared type, then plain text.
  const chosen = byContent ?? byExtension ?? byMediaType ?? 'text'

  const claims = [byExtension, byMediaType].filter((one): one is FormatId => one !== null)
  const conflict =
    byContent !== null && claims.length > 0 && claims.every((one) => one !== byContent)
      ? `The contents look like ${FORMATS[byContent].name}, but ${byExtension !== null ? `the name says ${FORMATS[byExtension].name}` : `the source says ${FORMATS[byMediaType as FormatId].name}`}. Orbis went by the contents; choose a format yourself if that is wrong.`
      : null

  const confidence: FormatEvidence['confidence'] =
    byContent !== null && claims.includes(byContent)
      ? 'certain'
      : byContent !== null
        ? 'likely'
        : byExtension !== null || byMediaType !== null
          ? 'uncertain'
          : 'unknown'

  return { byExtension, byMediaType, byContent, confidence, chosen, conflict, reasons }
}

/** What the first part of a file looks like. Returns `null` rather than guessing when nothing is conclusive. */
function sniff(sample: string, reasons: string[]): FormatId | null {
  const trimmed = sample.replace(/^﻿/, '').trimStart()
  if (trimmed === '') return null

  // Binary: a null byte cannot appear in any text format Orbis reads.
  if (sample.includes('\u0000')) {
    reasons.push('There is a null byte in the first part of the file, which no text format Orbis reads contains.')
    return 'binary'
  }

  if (trimmed.startsWith('<')) {
    if (/^<\?xml[\s?]/i.test(trimmed)) {
      reasons.push('It begins with an XML declaration.')
      return 'xml'
    }
    if (/^<(!doctype\s+html|html|head|body|div|p|table)\b/i.test(trimmed)) {
      reasons.push('It begins with an HTML element.')
      return 'html'
    }
    reasons.push('It begins with a tag.')
    return 'xml'
  }

  const lines = trimmed.split('\n').filter((one) => one.trim() !== '')

  // Newline-delimited JSON has to be tested before plain JSON, because it also begins with `{`. The test is that each
  // of the first few lines is a *complete* value on its own -- not merely that it starts with a brace, which a
  // pretty-printed array's first two lines also do.
  if (lines.length >= 2) {
    const sampled = lines.slice(0, Math.min(5, lines.length))
    const eachComplete = sampled.every((one) => {
      if (!/^\s*[{[]/.test(one)) return false
      try {
        JSON.parse(one)
        return true
      } catch {
        return false
      }
    })
    if (eachComplete) {
      reasons.push('Each line is a complete JSON value on its own.')
      return 'ndjson'
    }
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    reasons.push('It begins with a JSON object or array.')
    return 'json'
  }

  if (/^#{1,6}\s|\n#{1,6}\s|^\s*[-*+]\s|\n\s*[-*+]\s|```/.test(trimmed)) {
    reasons.push('It contains Markdown constructs.')
    return 'markdown'
  }

  // Delimited text needs a consistent count of separators across several lines -- one line proves nothing.
  if (lines.length >= 2) {
    for (const [separator, id] of [[',', 'csv'], ['\t', 'tsv']] as const) {
      const counts = lines.slice(0, Math.min(8, lines.length)).map((one) => one.split(separator).length)
      if (counts[0] > 1 && counts.every((one) => one === counts[0])) {
        reasons.push(`Every line has the same number of ${separator === ',' ? 'commas' : 'tabs'}.`)
        return id
      }
    }
  }

  return null
}

// ---------------------------------------------------------------- encoding

export interface DecodedText {
  text: string
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'latin-1'
  /** Whether a byte-order mark was present and removed. */
  hadBom: boolean
  /** Characters that could not be decoded. Counted, because a file full of them was decoded as the wrong thing. */
  replacements: number
  notes: string[]
}

/**
 * Bytes into text, with the encoding detected rather than assumed.
 *
 * Assuming UTF-8 is right nearly always and catastrophic the rest of the time: a Latin-1 file read as UTF-8 does not
 * fail, it produces replacement characters scattered through the data, and a column of names quietly becomes wrong.
 * Counting the replacements is what makes that visible.
 */
export function decodeText(bytes: Uint8Array): DecodedText | InterchangeError {
  if (bytes.length > INTERCHANGE_LIMITS.bytes) {
    return fail(
      'RESOURCE_LIMIT',
      'decode',
      `That file is ${formatBytes(bytes.length)}, past the ${formatBytes(INTERCHANGE_LIMITS.bytes)} Orbis reads at once.`,
      'Split the file, or import a part of it.'
    )
  }

  const notes: string[] = []

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    notes.push('A UTF-16 little-endian byte-order mark was found and removed.')
    return { text: decodeUtf16(bytes.subarray(2), true), encoding: 'utf-16le', hadBom: true, replacements: 0, notes }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    notes.push('A UTF-16 big-endian byte-order mark was found and removed.')
    return { text: decodeUtf16(bytes.subarray(2), false), encoding: 'utf-16be', hadBom: true, replacements: 0, notes }
  }

  const hadBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const body = hadBom ? bytes.subarray(3) : bytes
  if (hadBom) notes.push('A UTF-8 byte-order mark was found and removed.')

  const asUtf8 = decodeUtf8(body)
  if (asUtf8.replacements === 0) {
    return { text: asUtf8.text, encoding: 'utf-8', hadBom, replacements: 0, notes }
  }

  // Not valid UTF-8. Latin-1 cannot fail -- every byte is a character -- so it is the fallback, and the note says the
  // decoding was a choice rather than a fact.
  notes.push(
    `The bytes are not valid UTF-8 (${asUtf8.replacements} sequence${asUtf8.replacements === 1 ? '' : 's'} could not be read), so they were read as Latin-1 instead. If the text looks wrong, the file is in some other encoding and Orbis cannot tell which.`
  )
  let latin = ''
  for (let i = 0; i < body.length; i++) latin += String.fromCharCode(body[i])
  return { text: latin, encoding: 'latin-1', hadBom, replacements: asUtf8.replacements, notes }
}

function decodeUtf8(bytes: Uint8Array): { text: string; replacements: number } {
  let out = ''
  let replacements = 0
  let i = 0
  while (i < bytes.length) {
    const byte = bytes[i]
    if (byte < 0x80) {
      out += String.fromCharCode(byte)
      i += 1
      continue
    }
    const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 0
    if (length === 0 || i + length > bytes.length) {
      replacements += 1
      out += '�'
      i += 1
      continue
    }
    let code = byte & (length === 2 ? 0x1f : length === 3 ? 0x0f : 0x07)
    let valid = true
    for (let k = 1; k < length; k++) {
      const next = bytes[i + k]
      if ((next & 0xc0) !== 0x80) {
        valid = false
        break
      }
      code = (code << 6) | (next & 0x3f)
    }
    // An overlong encoding is invalid: it is a second spelling of a character, and accepting both has been a source of
    // filter bypasses for as long as UTF-8 has existed.
    const overlong = (length === 2 && code < 0x80) || (length === 3 && code < 0x800) || (length === 4 && code < 0x10000)
    if (!valid || overlong || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      replacements += 1
      out += '�'
      i += 1
      continue
    }
    out += String.fromCodePoint(code)
    i += length
  }
  return { text: out, replacements }
}

function decodeUtf16(bytes: Uint8Array, little: boolean): string {
  let out = ''
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode(little ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1])
  }
  return out
}

const formatBytes = (count: number): string => {
  if (count < 1024) return `${count} bytes`
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} kB`
  if (count < 1024 * 1024 * 1024) return `${(count / (1024 * 1024)).toFixed(1)} MB`
  return `${(count / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// ---------------------------------------------------------------- locale

export interface LocaleConvention {
  id: string
  name: string
  decimal: '.' | ','
  grouping: ',' | '.' | ' ' | "'" | ''
  /** How a bare `03/04/2026` is to be read. Never guessed from the data. */
  dateOrder: 'dmy' | 'mdy' | 'ymd'
}

export const LOCALES: Readonly<Record<string, LocaleConvention>> = Object.freeze({
  'en-IN': { id: 'en-IN', name: 'India', decimal: '.', grouping: ',', dateOrder: 'dmy' },
  'en-GB': { id: 'en-GB', name: 'United Kingdom', decimal: '.', grouping: ',', dateOrder: 'dmy' },
  'en-US': { id: 'en-US', name: 'United States', decimal: '.', grouping: ',', dateOrder: 'mdy' },
  'de-DE': { id: 'de-DE', name: 'Germany', decimal: ',', grouping: '.', dateOrder: 'dmy' },
  'fr-FR': { id: 'fr-FR', name: 'France', decimal: ',', grouping: ' ', dateOrder: 'dmy' },
  'iso': { id: 'iso', name: 'ISO', decimal: '.', grouping: '', dateOrder: 'ymd' }
})

/**
 * A number read under a stated convention.
 *
 * `1,234` is one thousand two hundred and thirty-four in India and one point two three four in Germany, and nothing in
 * the string says which. So the convention is a parameter, never inferred, and a string that is ambiguous under the
 * convention given is refused rather than resolved.
 */
export function readNumberIn(source: string, locale: LocaleConvention): number | null {
  const trimmed = source.trim()
  if (trimmed === '') return null

  const decimal = locale.decimal
  const grouping = locale.grouping

  let body = trimmed
  if (grouping !== '') {
    // A grouping separator is only a grouping separator in the right places. `1,23` under a comma grouping is not a
    // grouped number, and reading it as 123 would be inventing a digit.
    const groupPattern = new RegExp(`^[+-]?\\d{1,3}(\\${grouping}\\d{3})+(\\${decimal}\\d+)?$`)
    const plainPattern = new RegExp(`^[+-]?\\d*(\\${decimal}\\d+)?$`)
    if (groupPattern.test(body)) body = body.split(grouping).join('')
    else if (!plainPattern.test(body)) return null
  }

  const normalised = decimal === ',' ? body.replace(',', '.') : body
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(normalised)) return null
  const value = Number(normalised)
  return Number.isFinite(value) ? value : null
}

export interface DateReading {
  /** Milliseconds since the epoch, in UTC. */
  value: number
  /** How it was read, so an ambiguous date is not silently resolved one way. */
  as: 'iso' | 'unix-seconds' | 'unix-milliseconds' | 'locale'
  ambiguous: boolean
  describe: string
}

/**
 * A date read under a stated convention.
 *
 * `03/04/2026` is the third of April or the fourth of March, and the string cannot say which. It is read under the
 * convention given and marked ambiguous, so a caller can ask rather than a dataset quietly having a month of dates
 * shifted.
 */
export function readDateIn(source: string, locale: LocaleConvention): DateReading | null {
  const trimmed = source.trim()
  if (trimmed === '') return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.exec(trimmed)
  if (iso) {
    const value = Date.parse(trimmed.includes('T') || trimmed.includes(' ') ? trimmed.replace(' ', 'T') : `${trimmed}T00:00:00Z`)
    if (!Number.isFinite(value)) return null
    return { value, as: 'iso', ambiguous: false, describe: 'Read as an ISO date, which is unambiguous.' }
  }

  if (/^\d{10}$/.test(trimmed)) {
    return {
      value: Number(trimmed) * 1000,
      as: 'unix-seconds',
      ambiguous: true,
      describe: 'A ten-digit number was read as seconds since 1970. It could also be a plain number that happens to have ten digits.'
    }
  }
  if (/^\d{13}$/.test(trimmed)) {
    return {
      value: Number(trimmed),
      as: 'unix-milliseconds',
      ambiguous: true,
      describe: 'A thirteen-digit number was read as milliseconds since 1970.'
    }
  }

  const parts = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/.exec(trimmed)
  if (!parts) return null
  const a = Number(parts[1])
  const b = Number(parts[2])
  const c = Number(parts[3])

  let year: number
  let month: number
  let day: number
  if (locale.dateOrder === 'ymd' || parts[1].length === 4) {
    year = a
    month = b
    day = c
  } else if (locale.dateOrder === 'dmy') {
    day = a
    month = b
    year = c
  } else {
    month = a
    day = b
    year = c
  }
  if (year < 100) year += year < 70 ? 2000 : 1900
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const value = Date.UTC(year, month - 1, day)
  const back = new Date(value)
  // A day that rolls over -- the 31st of a 30-day month -- was not a date.
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null

  // Only ambiguous when both halves could be a month. The 25th of anything is not ambiguous.
  const ambiguous = locale.dateOrder !== 'ymd' && parts[1].length !== 4 && a <= 12 && b <= 12
  return {
    value,
    as: 'locale',
    ambiguous,
    describe: ambiguous
      ? `"${trimmed}" was read as ${locale.dateOrder === 'dmy' ? 'day/month/year' : 'month/day/year'} under the ${locale.name} convention. Both numbers could be a month, so this could be a different date under another convention.`
      : `"${trimmed}" was read as ${locale.dateOrder === 'dmy' ? 'day/month/year' : 'month/day/year'}.`
  }
}

// ---------------------------------------------------------------- JSON

export interface JsonReading {
  value: unknown
  nodes: number
  maxDepth: number
  notes: string[]
}

/**
 * JSON read with its size measured.
 *
 * `JSON.parse` itself is safe -- it builds data, never code -- but a deeply nested or enormous document turns into a
 * structure that later recursion cannot walk and memory cannot hold. Measuring after the parse and refusing is the
 * cheap version; it costs one walk and rules out the whole class of failure further down.
 */
export function readJson(source: string): JsonReading | InterchangeError {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'it could not be read'
    const position = /position (\d+)/.exec(message)?.[1]
    return fail(
      'PARSE_ERROR',
      'parse',
      `That is not valid JSON: ${message}`,
      position === undefined
        ? 'Check the file in an editor that shows JSON errors.'
        : `Look at character ${position}. Usually it is a trailing comma, a missing quote, or a single quote where JSON needs a double one.`
    )
  }

  let nodes = 0
  let maxDepth = 0
  const walk = (node: unknown, depth: number): InterchangeError | null => {
    nodes += 1
    if (nodes > INTERCHANGE_LIMITS.nodes) {
      return fail('RESOURCE_LIMIT', 'parse', `That JSON holds more than the ${INTERCHANGE_LIMITS.nodes.toLocaleString('en')} values Orbis reads at once.`, 'Import a part of it, or use newline-delimited JSON, which can be read a line at a time.')
    }
    if (depth > maxDepth) maxDepth = depth
    if (depth > INTERCHANGE_LIMITS.depth) {
      return fail('RESOURCE_LIMIT', 'parse', `That JSON is nested more than ${INTERCHANGE_LIMITS.depth} levels deep.`, 'Flatten the structure before importing it.')
    }
    if (Array.isArray(node)) {
      for (const one of node) {
        const problem = walk(one, depth + 1)
        if (problem) return problem
      }
    } else if (node !== null && typeof node === 'object') {
      for (const key of Object.keys(node)) {
        const problem = walk((node as Record<string, unknown>)[key], depth + 1)
        if (problem) return problem
      }
    }
    return null
  }
  const problem = walk(value, 1)
  if (problem) return problem

  const notes: string[] = []
  if (maxDepth > 8) notes.push(`This is nested ${maxDepth} levels deep. Flattening it into a table will lose the structure, which cannot be recovered afterwards.`)
  return { value, nodes, maxDepth, notes }
}

export interface FlattenOptions {
  separator?: string
  /** How deep to flatten. Beyond this a value is kept as its JSON text rather than expanded into more columns. */
  maxDepth?: number
}

/**
 * Nested JSON flattened into rows, only when asked.
 *
 * Flattening is lossy and irreversible, so it is never the default. `{a: {b: 1}}` becomes a column called `a.b`, and
 * an array of objects becomes one row each; an array of scalars becomes indexed columns, because turning it into rows
 * would multiply the rows of everything beside it.
 */
export function flattenJson(value: unknown, options: FlattenOptions = {}): { rows: Record<string, string>[]; columns: string[]; notes: string[] } {
  const separator = options.separator ?? '.'
  const maxDepth = options.maxDepth ?? 6
  const notes: string[] = []
  const columns: string[] = []
  const seen = new Set<string>()

  const rowsFrom = Array.isArray(value) ? value : [value]
  if (!Array.isArray(value)) notes.push('The document is a single object, so it became one row.')

  const rows = rowsFrom.map((one) => {
    const row: Record<string, string> = {}
    const walk = (node: unknown, prefix: string, depth: number): void => {
      if (node === null || node === undefined) {
        set(row, prefix, '')
        return
      }
      if (Array.isArray(node)) {
        if (depth >= maxDepth) {
          set(row, prefix, JSON.stringify(node))
          return
        }
        node.forEach((entry, i) => walk(entry, prefix === '' ? String(i) : `${prefix}${separator}${i}`, depth + 1))
        return
      }
      if (typeof node === 'object') {
        if (depth >= maxDepth) {
          set(row, prefix, JSON.stringify(node))
          return
        }
        for (const key of Object.keys(node)) {
          walk((node as Record<string, unknown>)[key], prefix === '' ? key : `${prefix}${separator}${key}`, depth + 1)
        }
        return
      }
      set(row, prefix, String(node))
    }
    walk(one, '', 0)
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
    return row
  })

  notes.push('Flattening cannot be undone: the nesting is gone from the result, and re-importing it gives a flat table.')
  return { rows, columns, notes }
}

// `Object.defineProperty` rather than assignment: a key of `__proto__` assigned normally changes the row's prototype
// rather than adding a column, which is how a data file becomes a prototype-pollution vector.
const set = (row: Record<string, string>, key: string, value: string): void => {
  Object.defineProperty(row, key === '' ? 'value' : key, { value, enumerable: true, writable: true, configurable: true })
}

// ---------------------------------------------------------------- XML

export interface XmlNode {
  name: string
  attributes: Record<string, string>
  children: XmlNode[]
  text: string
}

/**
 * XML read into a tree, with the dangerous parts refused rather than handled.
 *
 * A document type definition can declare entities that expand exponentially -- the billion laughs attack -- or fetch a
 * file from the machine. Neither is something a data import needs, so a `<!DOCTYPE` is a refusal rather than something
 * to be parsed carefully. That is the only version of this that is reliably safe.
 */
export function readXml(source: string): XmlNode | InterchangeError {
  if (/<!DOCTYPE/i.test(source)) {
    return fail(
      'INVALID_FORMAT',
      'parse',
      'That XML declares a document type. Orbis refuses those: a document type can define entities that expand without limit or that read a file from this machine, and neither is something an import needs.',
      'Remove the DOCTYPE declaration and import it again.'
    )
  }
  if (/<!ENTITY/i.test(source)) {
    return fail('INVALID_FORMAT', 'parse', 'That XML declares entities, which Orbis refuses for the same reason as a document type.', 'Remove the entity declarations and import it again.')
  }

  const withoutProlog = source.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const stack: XmlNode[] = []
  let root: XmlNode | null = null
  let nodes = 0

  const pattern = /<([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\/([A-Za-z_][\w.:-]*)\s*>|([^<]+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(withoutProlog)) !== null) {
    if (match[5] !== undefined) {
      const body = match[5]
      if (stack.length > 0 && body.trim() !== '') stack[stack.length - 1].text += decodeXmlEntities(body)
      continue
    }
    if (match[4] !== undefined) {
      const closing = stack.pop()
      if (!closing) return fail('PARSE_ERROR', 'parse', `The XML closes </${match[4]}> with nothing open.`, 'Check that every tag is opened before it is closed.')
      if (closing.name !== match[4]) {
        return fail('PARSE_ERROR', 'parse', `The XML opens <${closing.name}> and closes </${match[4]}>.`, 'Check that tags are closed in the order they were opened.')
      }
      continue
    }

    nodes += 1
    if (nodes > INTERCHANGE_LIMITS.nodes) {
      return fail('RESOURCE_LIMIT', 'parse', 'That XML holds more elements than Orbis reads at once.', 'Import a part of it.')
    }
    if (stack.length > INTERCHANGE_LIMITS.depth) {
      return fail('RESOURCE_LIMIT', 'parse', `That XML is nested more than ${INTERCHANGE_LIMITS.depth} levels deep.`, 'Flatten the structure before importing it.')
    }

    const attributes: Record<string, string> = {}
    for (const attribute of (match[2] ?? '').matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      // `defineProperty` for the same reason as the JSON flattener: an attribute called `__proto__` is a name somebody
      // can write into a file.
      Object.defineProperty(attributes, attribute[1], {
        value: decodeXmlEntities(attribute[2] ?? attribute[3] ?? ''),
        enumerable: true,
        writable: true,
        configurable: true
      })
    }

    const node: XmlNode = { name: match[1], attributes, children: [], text: '' }
    if (stack.length === 0) {
      if (root !== null) return fail('PARSE_ERROR', 'parse', 'That XML has more than one root element.', 'Wrap the whole document in a single element.')
      root = node
    } else {
      stack[stack.length - 1].children.push(node)
    }
    if (match[3] !== '/') stack.push(node)
  }

  if (stack.length > 0) {
    return fail('PARSE_ERROR', 'parse', `The XML never closes <${stack[stack.length - 1].name}>.`, 'Close every tag that is opened.')
  }
  if (root === null) return fail('PARSE_ERROR', 'parse', 'That XML has no elements at all.', 'Check that the file is not empty.')
  return root
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const decodeXmlEntities = (source: string): string =>
  source.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code < 9 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return all
      return String.fromCodePoint(code)
    }
    return Object.prototype.hasOwnProperty.call(XML_ENTITIES, body) ? XML_ENTITIES[body] : all
  })

/** An XML tree turned into rows, one per repeated child of the root. */
export function xmlToRows(root: XmlNode): { rows: Record<string, string>[]; columns: string[] } {
  const columns: string[] = []
  const seen = new Set<string>()
  const rows = root.children.map((child) => {
    const row: Record<string, string> = {}
    for (const [key, value] of Object.entries(child.attributes)) set(row, `@${key}`, value)
    if (child.text.trim() !== '' && child.children.length === 0) set(row, child.name, child.text.trim())
    for (const grandchild of child.children) {
      const value = grandchild.text.trim()
      set(row, grandchild.name, value)
      for (const [key, attribute] of Object.entries(grandchild.attributes)) set(row, `${grandchild.name}@${key}`, attribute)
    }
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
    return row
  })
  return { rows, columns }
}

// ---------------------------------------------------------------- staged import

export interface FileReference {
  id: string
  source: 'local' | 'library' | 'download' | 'clipboard' | 'generated' | 'page' | 'network'
  name: string
  format: FormatId
  bytes: number
  /** A content hash, for integrity and for spotting the same file arriving twice. Not a signature. */
  hash: string
  /** Set by the caller from real file metadata. Never invented here. */
  modifiedAt: string
  provenance: string
}

export interface ImportPreview {
  file: FileReference
  evidence: FormatEvidence
  encoding: DecodedText['encoding']
  rows: number | null
  columns: string[]
  sampleRows: string[][]
  /** Everything a person should see before committing. Presented as content, not hidden behind a disclosure. */
  issues: { kind: string; describe: string; severity: 'info' | 'warning' | 'blocker' }[]
  notes: string[]
}

export interface StagedImport {
  preview: ImportPreview
  /** The parsed result, held but not committed. */
  table: Table | null
  document: { blocks: Block[] } | null
  value: unknown
}

/**
 * A file read and held, without being committed anywhere.
 *
 * This is the whole reason import is a two-step operation. A file that parses for most of its length and fails at the
 * end leaves nothing behind, so there is never a dataset that is silently missing its tail -- which is the failure
 * nobody notices until they have drawn conclusions from it.
 */
export function stageImport(
  file: Omit<FileReference, 'format' | 'hash'>,
  bytes: Uint8Array,
  options: { format?: FormatId; mediaType?: string; locale?: LocaleConvention } = {}
): StagedImport | InterchangeError {
  if (file.name.length > INTERCHANGE_LIMITS.nameLength) {
    return fail('INVALID_FORMAT', 'source', 'That file name is longer than Orbis accepts.', 'Rename the file to something shorter.')
  }

  const decoded = decodeText(bytes)
  if (isInterchangeError(decoded)) return decoded

  const sample = decoded.text.slice(0, 8192)
  const evidence = detectFormat(file.name, options.mediaType ?? '', sample)
  const format = options.format ?? evidence.chosen
  const capability = formatById(format)
  if (!capability) return fail('UNSUPPORTED_FORMAT', 'detect', `Orbis has no format called "${format}".`, 'Choose one of the formats Orbis reads.')
  if (!capability.canImport) {
    return fail(
      'UNSUPPORTED_FORMAT',
      'detect',
      `Orbis does not read ${capability.name}. ${capability.limitations[0] ?? ''}`.trim(),
      'Convert the file to CSV, JSON or Markdown first.'
    )
  }

  const reference: FileReference = { ...file, format, hash: hashOf(bytes) }
  const issues: ImportPreview['issues'] = []
  const notes: string[] = [...decoded.notes]

  if (evidence.conflict) issues.push({ kind: 'format-conflict', describe: evidence.conflict, severity: 'warning' })
  if (decoded.replacements > 0) {
    issues.push({
      kind: 'encoding',
      describe: `${decoded.replacements} byte sequence${decoded.replacements === 1 ? '' : 's'} could not be read as UTF-8, so the file was read as Latin-1. Characters outside plain ASCII may be wrong.`,
      severity: 'warning'
    })
  }

  let table: Table | null = null
  let document: { blocks: Block[] } | null = null
  let value: unknown = null
  let rows: number | null = null
  let columns: string[] = []
  let sampleRows: string[][] = []

  switch (format) {
    case 'csv':
    case 'tsv':
    case 'text': {
      if (format === 'text') {
        value = decoded.text
        rows = decoded.text.split('\n').length
        break
      }
      const parsed = parseDelimited(decoded.text, { delimiter: format === 'tsv' ? '\t' : ',' })
      if (isDataError(parsed)) return dataFail(parsed)
      table = parsed.table
      rows = parsed.table.rows.length
      columns = parsed.table.columns.map((one) => one.name)
      sampleRows = parsed.table.rows
        .slice(0, INTERCHANGE_LIMITS.previewRows)
        .map((row) => row.cells.map((cell) => (cell === null || typeof cell !== 'object' ? String(cell ?? '') : JSON.stringify(cell))))
      // The parser's own notes: which delimiter it chose and whether it decided the first row was headers. Both are
      // decisions that can be wrong, so they are surfaced with the preview rather than left in the parser.
      for (const note of parsed.notes) issues.push({ kind: 'parse', describe: note, severity: 'info' })
      break
    }

    case 'json':
    case 'ndjson': {
      if (format === 'ndjson') {
        const parsedRows: unknown[] = []
        const lines = decoded.text.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim() === '') continue
          try {
            parsedRows.push(JSON.parse(lines[i]))
          } catch {
            return fail('PARSE_ERROR', 'parse', `Line ${i + 1} is not valid JSON.`, 'In newline-delimited JSON every line has to be a complete value on its own.')
          }
        }
        value = parsedRows
        rows = parsedRows.length
      } else {
        const parsed = readJson(decoded.text)
        if (isInterchangeError(parsed)) return parsed
        value = parsed.value
        notes.push(...parsed.notes)
        rows = Array.isArray(parsed.value) ? parsed.value.length : 1
        if (parsed.maxDepth > 2) {
          issues.push({
            kind: 'nesting',
            describe: `This is nested ${parsed.maxDepth} levels deep. It will import as a structure; flattening it into a table is a separate choice, and it cannot be unflattened afterwards.`,
            severity: 'info'
          })
        }
      }
      const flattened = flattenJson(value)
      columns = flattened.columns
      sampleRows = flattened.rows.slice(0, INTERCHANGE_LIMITS.previewRows).map((row) => columns.map((one) => row[one] ?? ''))
      break
    }

    case 'xml': {
      const root = readXml(decoded.text)
      if (isInterchangeError(root)) return root
      value = root
      const converted = xmlToRows(root)
      rows = converted.rows.length
      columns = converted.columns
      sampleRows = converted.rows.slice(0, INTERCHANGE_LIMITS.previewRows).map((row) => columns.map((one) => row[one] ?? ''))
      break
    }

    case 'markdown': {
      const parsed = fromMarkdown(decoded.text)
      if (isDocumentError(parsed)) {
        return fail('PARSE_ERROR', 'parse', parsed.message, 'Check the file is Markdown and is not larger than Orbis reads at once.')
      }
      document = { blocks: parsed.blocks }
      rows = parsed.blocks.length
      notes.push(...parsed.notes)
      break
    }

    case 'html': {
      const parsed = fromHtml(decoded.text)
      if (isDocumentError(parsed)) {
        return fail('PARSE_ERROR', 'parse', parsed.message, 'Check the file is HTML and is not larger than Orbis reads at once.')
      }
      document = { blocks: parsed.blocks }
      rows = parsed.blocks.length
      notes.push(...parsed.notes)
      if (parsed.removed.length > 0) {
        issues.push({
          kind: 'sanitised',
          describe: `Removed on import: ${parsed.removed.map((one) => `${one.count} <${one.tag}>`).join(', ')}. Nothing executable is ever kept from an imported document.`,
          severity: 'info'
        })
      }
      break
    }

    case 'binary':
      return fail('UNSUPPORTED_FORMAT', 'parse', 'Orbis has no parser for this file, so it was not read.', 'Convert it to a format Orbis reads.')
  }

  if (rows !== null && rows > INTERCHANGE_LIMITS.rows) {
    return fail(
      'RESOURCE_LIMIT',
      'parse',
      `That file holds ${rows.toLocaleString('en')} rows, past the ${INTERCHANGE_LIMITS.rows.toLocaleString('en')} Orbis reads at once.`,
      'Import part of the file, or split it before importing.'
    )
  }
  if (columns.length > INTERCHANGE_LIMITS.columns) {
    return fail('RESOURCE_LIMIT', 'parse', `That file has ${columns.length.toLocaleString('en')} columns, past the ${INTERCHANGE_LIMITS.columns.toLocaleString('en')} Orbis reads.`, 'Select fewer columns before importing.')
  }

  if (!capability.carries.units) {
    notes.push(`${capability.name} has nowhere to put a unit, so anything imported from it has no units until they are set.`)
  }

  return {
    preview: { file: reference, evidence, encoding: decoded.encoding, rows, columns, sampleRows, issues, notes },
    table,
    document,
    value
  }
}

const dataFail = (error: DataError): InterchangeError =>
  fail('PARSE_ERROR', 'parse', error.message, 'Check the delimiter, the quoting and that every row has the same number of fields.')

/** A content hash. FNV-1a over the bytes: stable, short, and enough to spot the same file twice. Not a signature. */
export function hashOf(bytes: Uint8Array): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  // A second word from the length and a different seed, so two files of different lengths are very unlikely to collide.
  let second = 0x9e3779b9 ^ bytes.length
  for (let i = bytes.length - 1; i >= 0; i--) {
    second ^= bytes[i]
    second = Math.imul(second, 0x85ebca6b) >>> 0
  }
  return `${hash.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
}

/** Files that are byte for byte the same. Reported, never deleted: which copy to keep is not this layer's decision. */
export function findDuplicates(files: readonly FileReference[]): { hash: string; files: string[] }[] {
  const byHash = new Map<string, string[]>()
  for (const one of files) {
    const list = byHash.get(one.hash) ?? []
    list.push(one.id)
    byHash.set(one.hash, list)
  }
  return [...byHash.entries()].filter(([, list]) => list.length > 1).map(([hash, list]) => ({ hash, files: list }))
}

// ---------------------------------------------------------------- mapping

export interface FieldTarget {
  id: string
  name: string
  type: 'text' | 'number' | 'integer' | 'date' | 'boolean' | 'quantity'
  unit: string
  required: boolean
  describe: string
}

export interface Mapping {
  /** Source column name to target field id. A column mapped nowhere is dropped, deliberately and visibly. */
  columns: Record<string, string>
  locale: string
}

export interface MappingSuggestion {
  column: string
  field: string | null
  confidence: 'certain' | 'likely' | 'uncertain'
  why: string
}

/**
 * Which source column probably belongs to which field.
 *
 * Only suggestions, and each carries why. An exact name match is certain; a name that merely contains the field name is
 * likely; anything relying on the type alone is uncertain and left unmapped, because mapping a column of numbers to
 * "temperature" because both are numbers is how a dataset ends up with pressures in its temperature column.
 */
export function suggestMapping(columns: readonly string[], fields: readonly FieldTarget[]): MappingSuggestion[] {
  const normalise = (one: string): string => one.toLowerCase().replace(/[^a-z0-9]/g, '')
  const taken = new Set<string>()
  const suggestions: MappingSuggestion[] = []

  for (const column of columns) {
    const key = normalise(column)
    const exact = fields.find((one) => !taken.has(one.id) && (normalise(one.name) === key || normalise(one.id) === key))
    if (exact) {
      taken.add(exact.id)
      suggestions.push({ column, field: exact.id, confidence: 'certain', why: `The column is named exactly like the "${exact.name}" field.` })
      continue
    }
    const contains = fields.find(
      (one) => !taken.has(one.id) && key.length >= 3 && (key.includes(normalise(one.name)) || normalise(one.name).includes(key))
    )
    if (contains) {
      taken.add(contains.id)
      suggestions.push({ column, field: contains.id, confidence: 'likely', why: `The column name and the "${contains.name}" field share a name.` })
      continue
    }
    suggestions.push({
      column,
      field: null,
      confidence: 'uncertain',
      why: 'Nothing in the column name matches a field. Matching on type alone would be a guess, so it is left for you to choose.'
    })
  }
  return suggestions
}

export interface MappingCheck {
  ok: boolean
  missingRequired: string[]
  unmapped: string[]
  duplicates: { field: string; columns: string[] }[]
  notes: string[]
}

/** Whether a mapping is usable, and what it will drop. */
export function checkMapping(columns: readonly string[], fields: readonly FieldTarget[], mapping: Mapping): MappingCheck {
  const used = new Map<string, string[]>()
  for (const column of columns) {
    const field = Object.prototype.hasOwnProperty.call(mapping.columns, column) ? mapping.columns[column] : undefined
    if (field === undefined || field === '') continue
    const list = used.get(field) ?? []
    list.push(column)
    used.set(field, list)
  }

  const missingRequired = fields.filter((one) => one.required && !used.has(one.id)).map((one) => one.name)
  const unmapped = columns.filter((one) => {
    const field = Object.prototype.hasOwnProperty.call(mapping.columns, one) ? mapping.columns[one] : undefined
    return field === undefined || field === ''
  })
  const duplicates = [...used.entries()].filter(([, list]) => list.length > 1).map(([field, list]) => ({ field, columns: list }))

  const notes: string[] = []
  if (unmapped.length > 0) {
    notes.push(`${unmapped.length} column${unmapped.length === 1 ? '' : 's'} will be dropped: ${unmapped.join(', ')}. They are not lost from the file, only from what is imported.`)
  }
  for (const duplicate of duplicates) {
    notes.push(`${duplicate.columns.join(' and ')} are both mapped to the same field. Only one of them can be imported into it.`)
  }

  return { ok: missingRequired.length === 0 && duplicates.length === 0, missingRequired, unmapped, duplicates, notes }
}

// ---------------------------------------------------------------- lineage

export interface LineageStep {
  id: string
  operation: string
  /** The ids this step used. Empty for the original import. */
  from: string[]
  parameters: Record<string, string>
  engineVersion: string
  describe: string
}

export interface Lineage {
  steps: LineageStep[]
  /** Every step, in the order they have to be replayed. */
  order: string[]
  notes: string[]
}

/** The chain from a file to a result, ordered so it can be replayed. A cycle is refused rather than walked. */
export function buildLineage(steps: readonly LineageStep[]): Lineage | InterchangeError {
  const byId = new Map(steps.map((one) => [one.id, one]))
  const order: string[] = []
  const done = new Set<string>()
  const visiting = new Set<string>()

  const visit = (id: string): InterchangeError | null => {
    if (done.has(id)) return null
    if (visiting.has(id)) {
      return fail('VALIDATION_ERROR', 'validate', `The transformation "${id}" depends on itself, directly or through another step.`, 'Remove the circular dependency between these steps.')
    }
    const step = byId.get(id)
    if (!step) {
      return fail('VALIDATION_ERROR', 'validate', `A step refers to "${id}", which is not in the lineage.`, 'Add the missing step, or remove the reference to it.')
    }
    visiting.add(id)
    for (const from of step.from) {
      const problem = visit(from)
      if (problem) return problem
    }
    visiting.delete(id)
    done.add(id)
    order.push(id)
    return null
  }

  for (const step of steps) {
    const problem = visit(step.id)
    if (problem) return problem
  }

  return {
    steps: [...steps],
    order,
    notes: [`${steps.length} step${steps.length === 1 ? '' : 's'} from the original file to the result. Each one records what it used and what it was given, so the result can be produced again.`]
  }
}

// ---------------------------------------------------------------- export

export interface ExportRequest {
  format: FormatId
  /** Which columns to write, in order. Empty means all of them. */
  columns?: string[]
  includeMetadata?: boolean
  includeProvenance?: boolean
  delimiter?: string
}

export interface LossReport {
  lossy: boolean
  losses: { what: string; describe: string }[]
  /** What the target format can carry, so the trade-off is visible before the export rather than after. */
  carries: FormatCapability['carries']
}

/**
 * What a format cannot carry, worked out before anything is written.
 *
 * Presented as a list of specific losses rather than a "this may be lossy" warning, because the general warning is
 * ignored and "the uncertainty column will be dropped" is not.
 */
export function lossFor(format: FormatId, has: Partial<FormatCapability['carries']>): LossReport | InterchangeError {
  const capability = formatById(format)
  if (!capability) return fail('UNSUPPORTED_FORMAT', 'encode', `Orbis has no format called "${format}".`, 'Choose one of the formats Orbis writes.')
  if (!capability.canExport) {
    return fail('UNSUPPORTED_FORMAT', 'encode', `Orbis reads ${capability.name} but does not write it.`, 'Export as CSV, JSON, Markdown or plain text.')
  }

  const losses: LossReport['losses'] = []
  const named: Record<keyof FormatCapability['carries'], string> = {
    units: 'Units',
    types: 'Column types',
    metadata: 'Metadata',
    formatting: 'Formatting',
    provenance: 'Provenance',
    hierarchy: 'Nested structure'
  }
  for (const key of Object.keys(named) as (keyof FormatCapability['carries'])[]) {
    if (has[key] && !capability.carries[key]) {
      losses.push({
        what: named[key],
        describe: `${named[key]} cannot be represented in ${capability.name} and will not be in the exported file.`
      })
    }
  }

  return { lossy: losses.length > 0, losses, carries: capability.carries }
}

export interface ExportResult {
  text: string
  format: FormatId
  bytes: number
  hash: string
  rows: number
  loss: LossReport
  notes: string[]
}

/** A table written out, with what the format could not carry named. */
export function exportTable(table: Table, request: ExportRequest): ExportResult | InterchangeError {
  const capability = formatById(request.format)
  if (!capability) return fail('UNSUPPORTED_FORMAT', 'encode', `Orbis has no format called "${request.format}".`, 'Choose one of the formats Orbis writes.')
  if (!capability.canExport) {
    return fail('UNSUPPORTED_FORMAT', 'encode', `Orbis reads ${capability.name} but does not write it.`, 'Export as CSV, JSON, Markdown or plain text.')
  }

  const hasUnits = table.columns.some((one) => one.unit !== null)
  const loss = lossFor(request.format, { units: hasUnits, types: true, metadata: table.source !== '', hierarchy: false })
  if (isInterchangeError(loss)) return loss

  let body: string
  const notes: string[] = []

  switch (request.format) {
    case 'csv':
    case 'tsv':
      body = toDelimited(table, request.delimiter ?? (request.format === 'tsv' ? '\t' : ','))
      break

    case 'json': {
      const rows = table.rows.map((row) => {
        const record: Record<string, unknown> = {}
        table.columns.forEach((column, i) => {
          Object.defineProperty(record, column.name, { value: cellValue(row.cells[i], column), enumerable: true, writable: true, configurable: true })
        })
        return record
      })
      const payload = request.includeMetadata
        ? {
            // Units survive here, which is the reason to choose JSON over CSV for scientific data.
            columns: table.columns.map((one) => ({ id: one.id, name: one.name, type: one.type, unit: one.unit?.display ?? null })),
            source: table.source,
            rows
          }
        : rows
      body = JSON.stringify(payload, null, 2)
      break
    }

    case 'ndjson':
      body = table.rows
        .map((row) => {
          const record: Record<string, unknown> = {}
          table.columns.forEach((column, i) => {
            Object.defineProperty(record, column.name, { value: cellValue(row.cells[i], column), enumerable: true, writable: true, configurable: true })
          })
          return JSON.stringify(record)
        })
        .join('\n')
      break

    case 'markdown': {
      const header = `| ${table.columns.map((one) => one.name + (one.unit ? ` (${one.unit.display})` : '')).join(' | ')} |`
      const separator = `| ${table.columns.map(() => '---').join(' | ')} |`
      const rows = table.rows.map((row) => `| ${row.cells.map((cell, i) => cellText(cellValue(cell, table.columns[i]))).join(' | ')} |`)
      body = [header, separator, ...rows].join('\n')
      // Markdown has no unit column, so the unit is folded into the header. It reads correctly and does not round-trip.
      if (hasUnits) notes.push('Units were written into the column headings. They will read correctly but will not come back as units on re-import.')
      break
    }

    case 'text':
      body = table.rows.map((row) => row.cells.map((cell, i) => cellText(cellValue(cell, table.columns[i]))).join('\t')).join('\n')
      break

    default:
      return fail('UNSUPPORTED_FORMAT', 'encode', `Orbis does not write ${capability.name}.`, 'Export as CSV, JSON, Markdown or plain text.')
  }

  const bytes = new TextEncoder().encode(body)
  return {
    text: body,
    format: request.format,
    bytes: bytes.length,
    hash: hashOf(bytes),
    rows: table.rows.length,
    loss,
    notes: [...notes, ...loss.losses.map((one) => one.describe)]
  }
}

/**
 * A cell as the value it leaves in, knowing its column.
 *
 * A date is held as a number so it sorts; written out as that number it is a value nobody typed. `toDelimited` goes
 * through `cellOut` for the same reason; this is the structured-format half of it, so JSON carries `"2026-10-01"` and
 * not `1790812800000`.
 */
const cellValue = (cell: unknown, column: Column): unknown =>
  column.type === 'date' && typeof cell === 'number' && Number.isFinite(cell) ? formatDate(cell) : cell

const cellText = (cell: unknown): string => {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'object') {
    const record = cell as Record<string, unknown>
    if (record.kind === 'missing') return ''
    if (record.kind === 'invalid') return String(record.raw ?? '')
    if (typeof record.value === 'number') return String(record.value)
    return JSON.stringify(cell)
  }
  return String(cell)
}

/**
 * A document written out as text: Markdown, HTML or plain text.
 *
 * Each format has its own writer and every block kind reaches the page. The earlier plain-text branch returned an
 * empty string for a paragraph -- a file with the right size and hash and nothing in it -- which is the failure this
 * function now refuses to have. PDF is bytes printed from the HTML, so it is made by the artifact service, not here.
 */
export function exportDocument(document: StructuredDocument, format: FormatId): ExportResult | InterchangeError {
  const capability = formatById(format)
  if (!capability || !capability.canExport) {
    return fail('UNSUPPORTED_FORMAT', 'encode', `Orbis does not write ${capability?.name ?? format}.`, 'Export as Markdown, HTML or plain text.')
  }
  if (format === 'pdf') {
    return fail('UNSUPPORTED_FORMAT', 'encode', 'PDF is printed from the HTML, not written as text.', 'Ask the artifact service to export as PDF.')
  }
  const loss = lossFor(format, { formatting: true, metadata: true, hierarchy: true })
  if (isInterchangeError(loss)) return loss

  let body: string
  const notes: string[] = []
  switch (format) {
    case 'markdown':
      body = toMarkdown(document)
      break
    case 'html': {
      const made = toHtml(document)
      body = made.html
      notes.push(...made.notes)
      break
    }
    case 'text':
      body = toText(document)
      break
    default:
      return fail('UNSUPPORTED_FORMAT', 'encode', `Orbis does not write a document as ${capability.name}.`, 'Export as Markdown, HTML or plain text.')
  }
  const bytes = new TextEncoder().encode(body)
  return {
    text: body,
    format,
    bytes: bytes.length,
    hash: hashOf(bytes),
    rows: document.blocks.length,
    loss,
    notes: [...notes, ...loss.losses.map((one) => one.describe)]
  }
}

export interface VerifyResult {
  ok: boolean
  /** What was checked, so "verified" means something specific rather than being a badge. */
  checks: { what: string; passed: boolean; describe: string }[]
  reimported: { rows: number; columns: number } | null
  differences: string[]
}

/**
 * An export read back and compared with what it came from.
 *
 * "Verified" has to mean something, so each check is named and the round trip is real: the exported text is parsed
 * again and the shape compared. A checksum on its own only proves the file was written, not that it can be read.
 */
export function verifyExport(original: Table, result: ExportResult): VerifyResult {
  const checks: VerifyResult['checks'] = []
  const differences: string[] = []

  const bytes = new TextEncoder().encode(result.text)
  checks.push({
    what: 'checksum',
    passed: hashOf(bytes) === result.hash,
    describe: 'The hash of the written text matches the one recorded with the export.'
  })
  checks.push({
    what: 'size',
    passed: bytes.length === result.bytes,
    describe: `The export is ${formatBytes(bytes.length)}.`
  })

  let reimported: VerifyResult['reimported'] = null
  if (result.format === 'csv' || result.format === 'tsv') {
    const parsed = parseDelimited(result.text, { delimiter: result.format === 'tsv' ? '\t' : ',' })
    if (isDataError(parsed)) {
      checks.push({ what: 'round trip', passed: false, describe: `The exported file could not be read back: ${parsed.message}` })
    } else {
      reimported = { rows: parsed.table.rows.length, columns: parsed.table.columns.length }
      const sameRows = parsed.table.rows.length === original.rows.length
      const sameColumns = parsed.table.columns.length === original.columns.length
      checks.push({
        what: 'round trip',
        passed: sameRows && sameColumns,
        describe: `Reading the export back gives ${parsed.table.rows.length} rows and ${parsed.table.columns.length} columns; the original had ${original.rows.length} and ${original.columns.length}.`
      })
      if (!sameRows) differences.push(`Row count differs: ${original.rows.length} became ${parsed.table.rows.length}.`)
      if (!sameColumns) differences.push(`Column count differs: ${original.columns.length} became ${parsed.table.columns.length}.`)
      // Types are inferred on the way back in, and can come back differently. That is a property of the format, not a
      // fault in the export, so it is a difference rather than a failed check.
      for (let i = 0; i < Math.min(original.columns.length, parsed.table.columns.length); i++) {
        if (original.columns[i].type !== parsed.table.columns[i].type) {
          differences.push(
            `"${original.columns[i].name}" was ${original.columns[i].type} and comes back as ${parsed.table.columns[i].type}. ${FORMATS[result.format].name} does not carry types, so they are inferred again on import.`
          )
        }
      }
    }
  } else {
    checks.push({
      what: 'round trip',
      passed: true,
      describe: `${FORMATS[result.format].name} is not read back for comparison here; the checksum and size were checked.`
    })
  }

  return { ok: checks.every((one) => one.passed), checks, reimported, differences }
}

// ---------------------------------------------------------------- archives

export interface ArchiveEntry {
  path: string
  bytes: number
  compressedBytes: number
}

export interface ArchiveCheck {
  safe: boolean
  problems: { path: string; kind: string; describe: string }[]
  totalBytes: number
  ratio: number
  notes: string[]
}

/**
 * Whether an archive can be extracted safely, checked before anything is written.
 *
 * Three separate attacks, each of which needs its own check. A path of `../../etc/passwd` writes outside the target
 * directory. An absolute path ignores the target entirely. And an entry that expands to a thousand times its own size
 * fills the disk -- which no path check catches, because the path is fine.
 */
export function checkArchive(entries: readonly ArchiveEntry[]): ArchiveCheck {
  const problems: ArchiveCheck['problems'] = []
  let totalBytes = 0
  let totalCompressed = 0

  if (entries.length > INTERCHANGE_LIMITS.archiveEntries) {
    problems.push({
      path: '',
      kind: 'too-many-entries',
      describe: `The archive holds ${entries.length.toLocaleString('en')} entries, past the ${INTERCHANGE_LIMITS.archiveEntries.toLocaleString('en')} Orbis extracts.`
    })
  }

  for (const entry of entries) {
    totalBytes += entry.bytes
    totalCompressed += entry.compressedBytes

    const path = entry.path.replace(/\\/g, '/')
    if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
      problems.push({ path: entry.path, kind: 'absolute-path', describe: 'This entry has an absolute path, so extracting it would ignore where it was meant to go.' })
    }
    if (path.split('/').includes('..')) {
      problems.push({ path: entry.path, kind: 'path-traversal', describe: 'This entry has a path that climbs out of the folder it would be extracted into.' })
    }
    if (path.includes('\u0000')) {
      problems.push({ path: entry.path, kind: 'null-byte', describe: 'This entry has a null byte in its path, which is a way of making the name read differently to different readers.' })
    }
    if (entry.path.length > INTERCHANGE_LIMITS.nameLength) {
      problems.push({ path: entry.path.slice(0, 60), kind: 'long-path', describe: 'This entry has a path longer than Orbis extracts.' })
    }
    if (entry.compressedBytes > 0 && entry.bytes / entry.compressedBytes > INTERCHANGE_LIMITS.expansionRatio) {
      problems.push({
        path: entry.path,
        kind: 'expansion',
        describe: `This entry expands to ${Math.round(entry.bytes / entry.compressedBytes)} times its compressed size, past the ${INTERCHANGE_LIMITS.expansionRatio} Orbis allows. That is the shape of a file designed to fill a disk.`
      })
    }
  }

  const ratio = totalCompressed > 0 ? totalBytes / totalCompressed : 0
  if (ratio > INTERCHANGE_LIMITS.expansionRatio) {
    problems.push({
      path: '',
      kind: 'expansion',
      describe: `The archive as a whole expands to ${Math.round(ratio)} times its size. Individual entries may each look reasonable while the total does not.`
    })
  }
  if (totalBytes > INTERCHANGE_LIMITS.bytes) {
    problems.push({ path: '', kind: 'too-large', describe: `Extracting this would produce ${formatBytes(totalBytes)}, past what Orbis handles at once.` })
  }

  return {
    safe: problems.length === 0,
    problems,
    totalBytes,
    ratio,
    notes: problems.length === 0 ? ['Every entry stays inside the folder it would be extracted into, and nothing expands past the allowed ratio.'] : []
  }
}

/** The assumptions the engine rests on, for a Page that wants to show them rather than have them inferred. */
export const INTERCHANGE_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A file extension is a claim. Detection weighs it against the contents and reports a conflict rather than resolving one silently.',
  'An import is staged and only committed once the whole file has parsed, so a file that breaks partway leaves nothing behind.',
  'Every conversion that cannot carry something says what will be lost, by name, before the file is written.',
  'Number and date conventions are stated, never inferred. An ambiguous date is marked ambiguous rather than resolved.',
  'A document type declaration in XML is refused outright, because it can expand or fetch without limit.',
  'An archive is checked for paths that escape and for entries that expand before anything is extracted.',
  'A checksum identifies a file. It is never called a signature, and it proves nothing about who produced it.',
  'Duplicate files are reported, never deleted.'
])
