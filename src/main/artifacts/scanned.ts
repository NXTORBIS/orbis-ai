import { inflateRawSync, inflateSync } from 'node:zlib'
import { buildTable, isDataError, type Table } from '../../shared/compute/data.ts'
import { isRuledRow, splitRow, text, type Block } from '../../shared/compute/document.ts'
import { hasRuledTable, tableTextIn } from './chat.ts'

/**
 * A PDF that is pictures of pages, and a picture of a page or a table.
 *
 * `readPdf` in importing.ts reads a PDF's text layer. A scan has no text layer, so it ends at one honest sentence:
 * the PDF is a picture of text and Orbis does not read pictures of text. This is the other half of that sentence.
 *
 * Two things had to be true before it could be built honestly. The first is that a scanned PDF almost always holds
 * one photograph per page, stored inside the file as a JPEG (`/Subtype /Image` with `/Filter /DCTDecode`), and those
 * bytes are liftable exactly as they are -- no rendering library, no native module, nothing to package. That is what
 * `pagePicturesIn` does: it walks the file's objects, follows the page tree so a picture is named by the page it
 * belongs to, and hands back the JPEGs. A scan stored some other way -- JPEG 2000, a CCITT fax, JBIG2, raw pixels --
 * is counted and named rather than quietly dropped, because "0 pages read" with no reason is the failure nobody can
 * act on.
 *
 * The second is that reading the words means a model, and the only model here with eyes is Mistral's, reached with
 * the person's own key from settings. So the pictures leave the computer. Speech was deliberately kept local; this
 * cannot be, and that difference is the whole reason `readPictures` refuses to send anything without a consent value
 * the caller got from the person for this file, and hands back the exact words to ask with. Nothing is sent to find
 * out whether sending would work.
 *
 * What comes back is a model's reading and says so, everywhere: in the note at the top of the document, in the
 * artifact's notes, and page by page where a page could not be read. A page that came back empty stays empty. And a
 * table is only ever made when the model's answer really is a ruled table -- checked with the same reader the chat
 * uses on a reply -- because a table whose cells were written by a model, looking like a table Orbis computed, is
 * the one outcome this file exists to prevent.
 *
 * Nothing in a PDF is run, nothing is fetched, and no word read off a page is logged.
 */

export const SCANNED_LIMITS = Object.freeze({
  /** Objects walked in one PDF. Past this the file is not a scan, it is a database. */
  objects: 50_000,
  /** Characters of one object's dictionary kept for reading. */
  dictChars: 8_000,
  /** Page pictures lifted out of one PDF. */
  pictures: 200,
  /** Bytes of one page picture. */
  bytesPerPicture: 12 * 1024 * 1024,
  /** Bytes of every page picture together. */
  totalBytes: 64 * 1024 * 1024,
  /** Pages sent to be read in one go. The rest are named as not read. */
  read: 20,
  /** Pictures in the air at once. The model that can see allows one request every two seconds. */
  lanes: 2,
  /** Characters taken from one page's answer. */
  wordsPerPage: 20_000
})

/** One page's picture, lifted out of the PDF exactly as it was stored. */
export interface PagePicture {
  /** The page it belongs to, counted from 1. */
  page: number
  bytes: Uint8Array
  width: number
  height: number
}

export interface PagePictures {
  pictures: PagePicture[]
  /** What was in the file and could not be lifted out, in sentences. */
  skipped: string[]
  /** How the pictures were ordered, and what was left behind. */
  note: string
}

export type PicturesOutcome = PagePictures | { error: string; message: string }

export const isPicturesError = (value: PicturesOutcome): value is { error: string; message: string } => 'error' in value

// ---------------------------------------------------------------- walking a PDF's objects

/** One `N G obj … endobj` in the file: its dictionary, and where its stream's bytes are. */
interface RawObject {
  dict: string
  /** The first byte of the stream, when there is one. */
  from: number
  /** The `endobj` that closes it, so a stream with an unusable /Length still has an end. */
  to: number
  stream: boolean
}

/** Where an object's stream data begins, relative to the object's body. `endstream` is not a match: no word boundary. */
function streamAt(body: string): number {
  const found = /\bstream\r\n|\bstream\n|\bstream\r/.exec(body)
  return found ? found.index + found[0].length : -1
}

/**
 * Every object in the file, by number.
 *
 * Scanned rather than read through the cross-reference table, because a scanner survives a file whose xref is wrong
 * -- which is most PDFs a scanner produced. The scan jumps past each object's `endobj`, so the bytes of a photograph
 * are never searched for something that looks like the start of an object.
 */
function scanObjects(all: string): Map<number, RawObject> {
  const out = new Map<number, RawObject>()
  const pattern = /(\d{1,10})\s+(\d{1,5})\s+obj\b/g
  let found: RegExpExecArray | null
  while ((found = pattern.exec(all)) !== null) {
    if (out.size >= SCANNED_LIMITS.objects) break
    const num = Number(found[1])
    const bodyAt = found.index + found[0].length
    const closed = all.indexOf('endobj', bodyAt)
    const to = closed < 0 ? all.length : closed
    const body = all.slice(bodyAt, Math.min(to, bodyAt + SCANNED_LIMITS.dictChars))
    const at = streamAt(body)
    out.set(num, at < 0 ? { dict: body, from: 0, to, stream: false } : { dict: body.slice(0, at), from: bodyAt + at, to, stream: true })
    pattern.lastIndex = to + 'endobj'.length
  }
  return out
}

/** A stream's declared length, following an indirect one. Null when the file does not say usably. */
function lengthOf(dict: string, objects: Map<number, RawObject>): number | null {
  const indirect = /\/Length\s+(\d+)\s+\d+\s+R\b/.exec(dict)
  if (indirect) {
    const target = objects.get(Number(indirect[1]))
    const value = target && !target.stream ? /^\s*(\d+)/.exec(target.dict) : null
    return value ? Number(value[1]) : null
  }
  const direct = /\/Length\s+(\d+)/.exec(dict)
  return direct ? Number(direct[1]) : null
}

/** An object's stream bytes: by its declared length, or back from `endstream` when the length cannot be used. */
function streamBytes(all: string, bytes: Uint8Array, record: RawObject, objects: Map<number, RawObject>): Uint8Array {
  const length = lengthOf(record.dict, objects)
  if (length !== null && length > 0 && record.from + length <= record.to) return bytes.subarray(record.from, record.from + length)
  const closed = all.lastIndexOf('endstream', record.to)
  let end = closed > record.from ? closed : record.to
  while (end > record.from && (all[end - 1] === '\n' || all[end - 1] === '\r')) end -= 1
  return bytes.subarray(record.from, end)
}

/** The names in a `/Filter`, in the order they were applied. */
function filtersOf(dict: string): string[] {
  const one = /\/Filter\s*\/([A-Za-z0-9]+)/.exec(dict)
  if (one) return [one[1]]
  const list = /\/Filter\s*\[([^\]]*)\]/.exec(dict)
  return list ? [...list[1].matchAll(/\/([A-Za-z0-9]+)/g)].map((m) => m[1]) : []
}

/** Deflate, either wrapped the way PDFs are meant to wrap it or raw, which some writers produce anyway. */
function inflateAny(data: Uint8Array): Uint8Array | null {
  try {
    return new Uint8Array(inflateSync(data))
  } catch {
    try {
      return new Uint8Array(inflateRawSync(data))
    } catch {
      return null
    }
  }
}

/**
 * The value of one key in a dictionary, as the characters it is written with.
 *
 * Enough of a reader for what this file asks: a nested dictionary with its brackets matched, an array, a reference,
 * a name or a number. Not a PDF parser, and it does not pretend to be one -- where it cannot find its way the page
 * order falls back to the order of the file and the note says so.
 */
function valueOf(dict: string, key: string): string | null {
  const at = dict.indexOf(key)
  if (at < 0) return null
  let i = at + key.length
  while (i < dict.length && /\s/.test(dict[i])) i += 1
  if (dict.startsWith('<<', i)) {
    let depth = 0
    for (let j = i; j < dict.length - 1; j++) {
      if (dict[j] === '<' && dict[j + 1] === '<') {
        depth += 1
        j += 1
      } else if (dict[j] === '>' && dict[j + 1] === '>') {
        depth -= 1
        j += 1
        if (depth === 0) return dict.slice(i, j + 1)
      }
    }
    return null
  }
  if (dict.startsWith('[', i)) {
    const close = dict.indexOf(']', i)
    return close < 0 ? null : dict.slice(i, close + 1)
  }
  const token = /^(\d+\s+\d+\s+R|\/[A-Za-z0-9#.+-]+|[-\d.]+)/.exec(dict.slice(i))
  return token ? token[0] : null
}

/** A value that may be `N 0 R`, as the dictionary it points at. */
function follow(value: string | null, objects: Map<number, RawObject>): string | null {
  if (value === null) return null
  const ref = /^(\d+)\s+\d+\s+R$/.exec(value.trim())
  if (!ref) return value
  return objects.get(Number(ref[1]))?.dict ?? null
}

const refsIn = (value: string): number[] => [...value.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]))

const isPages = (dict: string): boolean => /\/Type\s*\/Pages\b/.test(dict)
const isPage = (dict: string): boolean => /\/Type\s*\/Page(?![a-zA-Z])/.test(dict)
const isImage = (dict: string): boolean => /\/Subtype\s*\/Image\b/.test(dict)

/**
 * The objects inside a compressed object stream, added to the map.
 *
 * A PDF saved by anything recent keeps its page tree in `/Type /ObjStm`, deflated. Without this the pages are
 * invisible and every scan reads as "the file did not say which picture belongs to which page" -- true of the
 * scanner, not of the file.
 */
function expandObjectStreams(all: string, bytes: Uint8Array, objects: Map<number, RawObject>): void {
  const streams = [...objects.entries()].filter(([, one]) => one.stream && /\/Type\s*\/ObjStm\b/.test(one.dict))
  for (const [, record] of streams) {
    const raw = streamBytes(all, bytes, record, objects)
    const filters = filtersOf(record.dict)
    const data = filters.includes('FlateDecode') ? inflateAny(raw) : filters.length === 0 ? raw : null
    if (!data) continue
    const content = Buffer.from(data).toString('latin1')
    const count = Number(/\/N\s+(\d+)/.exec(record.dict)?.[1] ?? 0)
    const first = Number(/\/First\s+(\d+)/.exec(record.dict)?.[1] ?? -1)
    if (count <= 0 || first < 0 || first > content.length) continue
    const numbers = [...content.slice(0, first).matchAll(/(\d+)/g)].map((m) => Number(m[1]))
    const pairs: { num: number; at: number }[] = []
    for (let i = 0; i + 1 < numbers.length && pairs.length < count; i += 2) pairs.push({ num: numbers[i], at: numbers[i + 1] })
    for (let i = 0; i < pairs.length; i++) {
      const from = first + pairs[i].at
      const to = i + 1 < pairs.length ? first + pairs[i + 1].at : content.length
      if (from >= to || from > content.length) continue
      if (objects.has(pairs[i].num)) continue
      objects.set(pairs[i].num, { dict: content.slice(from, Math.min(to, from + SCANNED_LIMITS.dictChars)), from: 0, to: 0, stream: false })
    }
  }
}

/** The page objects in the order the PDF shows them, or null when the tree could not be followed. */
function pagesInOrder(objects: Map<number, RawObject>): number[] | null {
  const trailerRoot = [...objects.entries()].find(([, one]) => /\/Type\s*\/Catalog\b/.test(one.dict))
  const fromCatalog = trailerRoot ? follow(valueOf(trailerRoot[1].dict, '/Pages'), objects) : null
  const rootDict =
    fromCatalog ??
    [...objects.values()].filter((one) => isPages(one.dict) && !/\/Parent\b/.test(one.dict)).map((one) => one.dict)[0] ??
    null
  if (rootDict === null) return null

  const order: number[] = []
  const seen = new Set<string>()
  const walk = (dict: string, depth: number): void => {
    if (depth > 32 || order.length >= SCANNED_LIMITS.pictures * 2) return
    const kids = valueOf(dict, '/Kids')
    if (kids === null) return
    for (const num of refsIn(kids)) {
      if (seen.has(String(num))) continue
      seen.add(String(num))
      const kid = objects.get(num)
      if (!kid) continue
      if (isPages(kid.dict)) walk(kid.dict, depth + 1)
      else if (isPage(kid.dict)) order.push(num)
    }
  }
  walk(rootDict, 0)
  return order.length > 0 ? order : null
}

/** A page's resources, following `/Parent` for the ones it inherits. */
function resourcesOf(num: number, objects: Map<number, RawObject>): string | null {
  let at: number | null = num
  for (let depth = 0; depth < 8 && at !== null; depth++) {
    const record: RawObject | undefined = objects.get(at)
    if (!record) return null
    const own = follow(valueOf(record.dict, '/Resources'), objects)
    if (own !== null) return own
    const parent = /\/Parent\s+(\d+)\s+\d+\s+R/.exec(record.dict)
    at = parent ? Number(parent[1]) : null
  }
  return null
}

// ---------------------------------------------------------------- lifting the page pictures out

/** The scans Orbis cannot turn into a picture, and what each is called in plain words. */
const CANNOT_READ: Readonly<Record<string, string>> = Object.freeze({
  JPXDecode: 'JPEG 2000',
  CCITTFaxDecode: 'a black and white fax scan (CCITT)',
  JBIG2Decode: 'a JBIG2 scan'
})

/** The other reasons a picture inside the file is not a page picture Orbis can hand to a model. */
const RAW_PIXELS = 'raw pixels rather than photographs, which Orbis cannot turn into a page picture to read'
const PACKED = 'packed in a way Orbis cannot unpack'
const NOT_A_JPEG = 'not beginning the way a JPEG does'

const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

const sized = (dict: string, key: string): number => {
  const found = new RegExp(`${key}\\s+(\\d+)`).exec(dict)
  return found ? Number(found[1]) : 0
}

/**
 * The page pictures inside a PDF, lifted out as the JPEGs they are.
 *
 * In page order where the page tree allows it, otherwise in the order they sit in the file, which the note says.
 */
export function pagePicturesIn(pdfBytes: Uint8Array): PicturesOutcome {
  if (pdfBytes.length === 0) return { error: 'parse', message: 'The file is empty.' }
  const all = Buffer.from(pdfBytes).toString('latin1')
  if (!all.slice(0, 1024).includes('%PDF-')) {
    return { error: 'parse', message: 'That file does not begin the way a PDF does, so Orbis did not open it.' }
  }
  // A locked PDF's pages are encrypted bytes. Lifting them out would produce files no reader can open, so it is
  // refused here rather than attempted and reported as an unreadable scan.
  if (/\/Encrypt\b/.test(all)) {
    return { error: 'encrypted', message: 'This PDF is locked: it says its contents are encrypted. Orbis cannot open a locked PDF, so no page was read.' }
  }

  const objects = scanObjects(all)
  if (objects.size === 0) return { error: 'parse', message: 'Orbis could not find anything inside that PDF.' }
  expandObjectStreams(all, pdfBytes, objects)

  const order = pagesInOrder(objects)
  const pageOf = new Map<number, number>()
  if (order) {
    order.forEach((num, at) => {
      const resources = resourcesOf(num, objects)
      const xobjects = resources === null ? null : follow(valueOf(resources, '/XObject'), objects)
      if (xobjects === null) return
      for (const ref of refsIn(xobjects)) {
        const target = objects.get(ref)
        if (target && isImage(target.dict) && !pageOf.has(ref)) pageOf.set(ref, at + 1)
      }
    })
  }

  const images = [...objects.entries()].filter(([, one]) => one.stream && isImage(one.dict)).sort((a, b) => a[0] - b[0])
  const ordered = pageOf.size > 0
  /** Scans in a format Orbis cannot read, by what that format is called. */
  const cannot = new Map<string, number>()
  /** Everything else that was in the file and is not a page picture, by why. */
  const others = new Map<string, number>()
  const count = (what: string): void => {
    cannot.set(what, (cannot.get(what) ?? 0) + 1)
  }
  const other = (why: string): void => {
    others.set(why, (others.get(why) ?? 0) + 1)
  }
  const pictures: PagePicture[] = []
  let total = 0
  let pastTotal = 0
  let pastPictures = 0

  images.forEach(([num, record], at) => {
    const filters = filtersOf(record.dict)
    const refused = filters.find((one) => Object.prototype.hasOwnProperty.call(CANNOT_READ, one))
    if (refused) {
      count(CANNOT_READ[refused])
      return
    }
    if (!filters.includes('DCTDecode')) {
      other(RAW_PIXELS)
      return
    }
    const raw = streamBytes(all, pdfBytes, record, objects)
    // A JPEG the file also deflated: unwrap that one layer. Anything else between is a packing Orbis does not undo.
    const unwrapped = filters[0] === 'DCTDecode' ? raw : filters.length === 2 && filters[0] === 'FlateDecode' ? inflateAny(raw) : null
    if (!unwrapped) {
      other(PACKED)
      return
    }
    if (unwrapped.length < 4 || unwrapped[0] !== 0xff || unwrapped[1] !== 0xd8) {
      other(NOT_A_JPEG)
      return
    }
    if (unwrapped.length > SCANNED_LIMITS.bytesPerPicture) {
      other(`past the ${megabytes(SCANNED_LIMITS.bytesPerPicture)} Orbis lifts out of a PDF in one picture`)
      return
    }
    if (pictures.length >= SCANNED_LIMITS.pictures) {
      pastPictures += 1
      return
    }
    if (total + unwrapped.length > SCANNED_LIMITS.totalBytes) {
      pastTotal += 1
      return
    }
    total += unwrapped.length
    pictures.push({
      page: pageOf.get(num) ?? at + 1,
      bytes: unwrapped,
      width: sized(record.dict, '/Width'),
      height: sized(record.dict, '/Height')
    })
  })

  pictures.sort((a, b) => a.page - b.page)
  const skipped = [
    ...[...cannot.entries()].map(([what, n]) => `${n} ${n === 1 ? 'page is' : 'pages are'} stored as ${what}, which is a kind of scan Orbis cannot read.`),
    ...[...others.entries()].map(([why, n]) => `${n} ${n === 1 ? 'picture in it is' : 'pictures in it are'} ${why}.`)
  ]
  if (pastPictures > 0) skipped.push(`${pastPictures} more page pictures were left behind: Orbis lifts out at most ${SCANNED_LIMITS.pictures} from one PDF.`)
  if (pastTotal > 0) skipped.push(`${pastTotal} page pictures were left behind after ${megabytes(SCANNED_LIMITS.totalBytes)} of pictures.`)

  const where = ordered
    ? 'The pictures are in the order the PDF shows its pages.'
    : 'The PDF did not say which picture belongs to which page, so they are in the order they sit in the file and the page numbers are Orbis counting them.'
  const note = pictures.length === 0 ? 'No page picture could be lifted out of this PDF.' : `${pictures.length} page ${pictures.length === 1 ? 'picture' : 'pictures'} lifted out of the PDF, as stored. ${where}`
  return { pictures, skipped, note }
}

// ---------------------------------------------------------------- is this PDF pictures of pages?

/** What the text-layer reader got out of the PDF, which is the other half of the question. */
export interface PdfTextSoFar {
  /** Pages the reader looked at. */
  pages: number
  /** Characters of text it found in all of them. */
  characters: number
}

/**
 * Whether this PDF is pictures of pages rather than a document with pictures in it.
 *
 * Two things have to hold, and neither on its own is enough. There is little or no text -- a scan sometimes carries a
 * stray label or a watermark with a text layer, so "none at all" is too strict and "any at all" is too loose; forty
 * characters a page is a page with nothing on it. And there is about one large picture per page: a report with one
 * photograph on page three is not a scan, and a page picture is page-sized.
 */
export function looksScanned(said: PdfTextSoFar, pictures: readonly PagePicture[]): { scanned: boolean; why: string } {
  if (said.pages <= 0) return { scanned: false, why: 'Orbis does not know how many pages the PDF has.' }
  const perPage = said.characters / said.pages
  const large = pictures.filter((one) => (one.width >= 400 && one.height >= 400) || one.bytes.length >= 20_000)
  const covered = new Set(large.map((one) => one.page)).size
  const enough = covered >= Math.ceil(said.pages * 0.6)
  const quiet = perPage < 40
  if (!quiet) return { scanned: false, why: `The PDF has text in it to read: about ${Math.round(perPage)} characters a page.` }
  if (!enough) {
    return {
      scanned: false,
      why: `The PDF has almost no text, and no page-sized picture on ${said.pages - covered} of its ${said.pages} pages either, so there is nothing for Orbis to read.`
    }
  }
  return { scanned: true, why: `The PDF has almost no text and one page-sized picture on ${covered} of its ${said.pages} pages, which is what a scan looks like.` }
}

// ---------------------------------------------------------------- reading the pictures

export type SeenWords = { words: string } | { failed: string }

export interface PictureReaderDeps {
  /** The vision call: one picture and one instruction in, the model's words out. Handed in, never built here. */
  see(picture: { bytes: Uint8Array; mediaType: string }, instruction: string): Promise<SeenWords>
  /** Why nothing on this computer can look at a picture, when nothing can. Checked before anything is sent. */
  cannotSee?: string | null
  /** Pictures in the air at once. Two by default. */
  concurrency?: number
  /** Called as each page comes back, for "Read 3 of 12 pages". */
  onProgress?(read: number, of: number): void
  signal?: AbortSignal
}

/**
 * The person's yes, for this file.
 *
 * Not a setting, not a remembered preference, and never set by code: a value the caller got from the person after
 * showing them `askToSend`'s words. `to` names where the pictures go, so a yes given for one service is not a yes
 * for another one later.
 */
export interface SendingConsent {
  agreed: true
  to: 'Mistral'
}

export const agreedToSend = (value: unknown): value is SendingConsent =>
  typeof value === 'object' && value !== null && (value as { agreed?: unknown }).agreed === true && (value as { to?: unknown }).to === 'Mistral'

export interface ReadOptions {
  /** Document blocks, which is the default, or a table -- and a table is read from one picture only. */
  want?: 'document' | 'table'
  /** Where the table says it came from. */
  source?: string
}

export interface PicturesAsk {
  ok: false
  needs: 'consent'
  /** The words to ask the person with, exactly as they should be shown. */
  ask: string
  pages: number
  to: 'Mistral'
}

export interface PicturesRefused {
  ok: false
  needs: null
  message: string
}

export interface PicturesRead {
  ok: true
  /** Document blocks, when words were wanted. Null when a table was. */
  blocks: Block[] | null
  /** The table, when one was asked for and the model's answer really was a ruled table. */
  table: Table | null
  /** The pages whose words were read, in page order. */
  read: number[]
  notRead: { page: number; why: string }[]
  notes: string[]
}

export type ReadOutcome = PicturesRead | PicturesAsk | PicturesRefused

/** The note that goes at the top of anything read this way, and into its notes. There is one copy of this sentence. */
export const READ_BY_A_MODEL =
  'The words below were read from pictures of the pages by a model (Mistral). They may be wrong, and nothing was checked against the page.'

const TABLE_BY_A_MODEL =
  "Every cell here is a model's reading of a picture. Orbis did not compute any of it, and no number in it has been checked against the page."

/** What the model is told when it is shown a page. Written to get the words and nothing else. */
export const PAGE_INSTRUCTION = `Read the words in this picture of a page.

Write out the text exactly as it appears, in reading order, and nothing else. Do not describe the picture, do not explain it, do not summarise it, and do not add a single word that is not written on the page. Keep the line breaks you see. If there are no words you can read, answer exactly: NO WORDS`

/** What the model is told when a table is wanted. The answer is checked against the table reader, so the shape matters. */
export const TABLE_INSTRUCTION = `Read the table in this picture.

Answer with the table and nothing else, written as a Markdown table: a heading row, then a row of dashes under it, then one row per line, with the cells between bars. Copy every cell exactly as it is written. Do not add a row, a column, a total or a value that is not in the picture, and do not tidy the numbers. If there is no table you can read, answer exactly: NO TABLE`

const NOTHING = /^no (words|table)\.?$/i

/** The words to ask the person with, before anything leaves the computer. */
export function askToSend(pages: number, what: 'pages' | 'picture'): string {
  const where = 'Mistral, the service whose key is in your settings'
  if (what === 'picture') {
    return `This picture has to be read by a model: Orbis would send it to ${where}, and keep what comes back as the text. The words would be that model's reading of the picture, so they may be wrong. Nothing is sent unless you say yes.`
  }
  const count = `${pages} ${pages === 1 ? 'page' : 'pages'}`
  return `This PDF has no words in it to read -- its ${count} are pictures. To read them, Orbis would send ${pages === 1 ? 'that picture' : `all ${pages} pictures`} to ${where}, one at a time, and keep what comes back as the text. The words would be that model's reading of the pictures, so they may be wrong. Nothing is sent unless you say yes.`
}

/** One page's answer split into paragraphs: a blank line starts a new one, and the lines inside one are joined. */
function paragraphsOf(words: string): string[] {
  return words
    .slice(0, SCANNED_LIMITS.wordsPerPage)
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((one) => one.replace(/\s*\n\s*/g, ' ').trim())
    .filter((one) => one !== '')
}

/** The rows of a ruled Markdown table, cell for cell, with the ruled line itself left out. */
function rowsOfRuledTable(answer: string): string[][] {
  return tableTextIn(answer)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.includes('|') && !isRuledRow(line))
    .map(splitRow)
    .filter((row) => row.some((cell) => cell !== ''))
}

/**
 * Pictures of pages read into words, once the person has said yes.
 *
 * Refuses three ways before anything is sent: nothing here can see, there is nothing to read, or the person has not
 * said yes -- and the last of those hands back the words to ask with rather than a code a caller has to translate.
 * Then the pictures go one at a time, as many at once as the model's rate allows, capped, with the pages past the cap
 * named as not read. A page the model could not read is recorded as not read; nothing is put in its place.
 */
export async function readPictures(
  pictures: readonly PagePicture[],
  deps: PictureReaderDeps,
  consent: unknown,
  options: ReadOptions = {}
): Promise<ReadOutcome> {
  const want = options.want ?? 'document'
  if (deps.cannotSee) return { ok: false, needs: null, message: deps.cannotSee }
  if (pictures.length === 0) return { ok: false, needs: null, message: 'There is no picture here to read.' }
  if (want === 'table' && pictures.length !== 1) {
    return {
      ok: false,
      needs: null,
      message: 'A table is read from one picture. Orbis will not join the tables on several pages into one, because it cannot tell whether they are the same table.'
    }
  }
  if (!agreedToSend(consent)) {
    return { ok: false, needs: 'consent', ask: askToSend(pictures.length, want === 'table' ? 'picture' : 'pages'), pages: pictures.length, to: 'Mistral' }
  }

  const sending = pictures.slice(0, want === 'table' ? 1 : SCANNED_LIMITS.read)
  const beyond = pictures.slice(sending.length)
  const instruction = want === 'table' ? TABLE_INSTRUCTION : PAGE_INSTRUCTION
  const answers: (SeenWords | null)[] = new Array(sending.length).fill(null)
  let next = 0
  let done = 0
  const lane = async (): Promise<void> => {
    for (;;) {
      const at = next++
      if (at >= sending.length || deps.signal?.aborted) return
      try {
        answers[at] = await deps.see({ bytes: sending[at].bytes, mediaType: 'image/jpeg' }, instruction)
      } catch (err) {
        answers[at] = { failed: err instanceof Error ? err.message.slice(0, 160) : 'the picture could not be sent' }
      }
      done += 1
      deps.onProgress?.(done, sending.length)
    }
  }
  const lanes = Math.max(1, Math.min(4, deps.concurrency ?? SCANNED_LIMITS.lanes))
  await Promise.all(Array.from({ length: Math.min(lanes, sending.length) }, lane))
  if (deps.signal?.aborted) return { ok: false, needs: null, message: 'Stopped. Nothing was read and nothing was kept.' }

  const read: number[] = []
  const notRead: { page: number; why: string }[] = []
  const wordsFor: { page: number; words: string }[] = []
  let refusal: string | null = null
  sending.forEach((picture, at) => {
    const answer = answers[at]
    if (answer === null) {
      notRead.push({ page: picture.page, why: 'it was never sent' })
      return
    }
    if ('failed' in answer) {
      refusal ??= answer.failed
      notRead.push({ page: picture.page, why: answer.failed })
      return
    }
    const words = answer.words.trim()
    if (words === '' || NOTHING.test(words)) {
      notRead.push({ page: picture.page, why: 'the model could not read anything on it' })
      return
    }
    read.push(picture.page)
    wordsFor.push({ page: picture.page, words })
  })

  if (wordsFor.length === 0) {
    const why = refusal ?? 'the model could not read anything on any of them'
    return { ok: false, needs: null, message: `Nothing was read: ${why}. Nothing was kept.` }
  }

  const notes: string[] = []
  if (want === 'table') {
    const answer = wordsFor[0].words
    // The one guard that matters. A model asked for a table and answering in sentences would otherwise become a
    // spreadsheet of whatever those sentences split into -- cells nobody wrote, in a table that looks computed.
    if (!hasRuledTable(answer)) {
      return {
        ok: false,
        needs: null,
        message: 'The model did not answer with a table, so Orbis made nothing. It will not guess at rows and columns from a description of a table.'
      }
    }
    const rows = rowsOfRuledTable(answer)
    if (rows.length < 2) {
      return { ok: false, needs: null, message: 'The model answered with a table that has a heading row and no rows under it, so Orbis made nothing.' }
    }
    const table = buildTable(rows[0], rows.slice(1), { source: options.source ?? 'read from a picture by a model' })
    if (isDataError(table)) return { ok: false, needs: null, message: table.message }
    notes.push(TABLE_BY_A_MODEL, `${rows.length - 1} ${rows.length === 2 ? 'row was' : 'rows were'} read from the picture.`)
    return { ok: true, blocks: null, table, read, notRead, notes }
  }

  const blocks: Block[] = []
  let n = 0
  const id = (): string => `v-${++n}`
  blocks.push({ id: id(), sectionId: '', kind: 'callout', tone: 'warning', title: 'Read from pictures', content: [text(READ_BY_A_MODEL)] })
  for (const picture of sending) {
    const found = wordsFor.find((one) => one.page === picture.page)
    blocks.push({ id: id(), sectionId: '', kind: 'heading', level: 2, content: [text(`Page ${picture.page}`)] })
    if (!found) {
      blocks.push({ id: id(), sectionId: '', kind: 'paragraph', content: [text('Orbis could not read this page. Nothing has been put in its place.')] })
      continue
    }
    for (const paragraph of paragraphsOf(found.words)) {
      blocks.push({ id: id(), sectionId: '', kind: 'paragraph', content: [text(paragraph)] })
    }
  }

  notes.push(READ_BY_A_MODEL)
  notes.push(`Read ${read.length} of ${pictures.length} ${pictures.length === 1 ? 'page' : 'pages'}. A blank line in what the model read starts a new paragraph; single line breaks are joined.`)
  if (beyond.length > 0) {
    notes.push(
      `Only the first ${sending.length} pages were sent to be read, which is the most Orbis reads this way in one go. ${beyond.length} ${beyond.length === 1 ? 'page was' : 'pages were'} not read: ${beyond.map((one) => one.page).join(', ')}.`
    )
  }
  if (notRead.length > 0) {
    notes.push(`${notRead.length} ${notRead.length === 1 ? 'page' : 'pages'} came back with nothing Orbis could use (${notRead.map((one) => one.page).join(', ')}). Nothing was filled in for them.`)
  }
  notes.push('A table must not be taken out of this: its words were written by a model, and a table made from them would look like figures Orbis had computed.')
  return { ok: true, blocks, table: null, read, notRead, notes }
}
