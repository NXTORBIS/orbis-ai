import { access, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'
import { hashOf, type VerifyResult } from '../../shared/compute/interchange.ts'
import { safeName } from '../../shared/artifacts/naming.ts'

/**
 * Handing something to the programs a person already has: their mail program, and the folders their cloud program
 * keeps in step.
 *
 * Orbis has no account anywhere. It cannot sign in to a mail service, it has no permission to send as anybody, and
 * there is no Orbis server to put a file on. So nothing here sends anything. What it does instead is make the two
 * files that let the person do it themselves, and say so in words that cannot be mistaken for "sent":
 *
 *   - **A mail draft** is a `.eml` file: a complete message, RFC 5322, with the file attached inside it as MIME. Open
 *     it and the computer's own mail program opens it as an unsent draft -- that is what the `X-Unsent` header is
 *     for -- with the address, the subject, the words and the attachment already in place. Pressing Send is the
 *     person's own act, in their own program, under their own account.
 *   - **A cloud folder** is a folder. OneDrive, Dropbox, Google Drive and iCloud Drive each keep one on this
 *     computer and upload what appears in it. "Save to OneDrive" is therefore an ordinary save into an ordinary
 *     folder, and the uploading is done by that program, not by Orbis. Which folders exist is found from the
 *     environment and from each program's own pointer file -- never by signing in to anything, and never by reading
 *     what is inside the folder.
 *
 * Two things this file refuses rather than guesses at: an address that is not an address, and an attachment past the
 * size a message can carry. Both are said in plain words with the reason.
 *
 * Every filesystem call arrives as an injected dependency, so what is on this computer can be tested with a map.
 */

export const EMAIL_LIMITS = Object.freeze({
  subject: 300,
  /** Characters of the message's own words. A long document belongs in the attachment, not in the body. */
  body: 200_000,
  recipients: 50,
  address: 320,
  /** Characters of a display name or an attached file's name. */
  name: 200,
  /**
   * Bytes of one attachment before Orbis refuses.
   *
   * Base64 makes a file about a third bigger on the way into a message, and most mail services stop at 25 MB for the
   * whole message -- so 18 MB of file is about 24 MB of message, and anything more would be built and then bounced.
   */
  attachmentBytes: 18 * 1024 * 1024,
  /** What mail services commonly allow for a whole message. Said to a person, not enforced by anyone here. */
  serviceBytes: 25 * 1024 * 1024,
  /** Columns a base64 body is wrapped at. MIME says 76 at the most. */
  wrap: 76,
  /** Characters a header line is folded at. 78 is the recommendation; 998 is the hard limit. */
  header: 78
})

export interface SharingError {
  error: 'bad-address' | 'bad-media-type' | 'too-large' | 'invalid-argument' | 'parse' | 'no-folder'
  message: string
}

export const isSharingError = (value: unknown): value is SharingError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

// ---------------------------------------------------------------- addresses

export interface MailAddress {
  /** The name in front of the address, when there was one. */
  display: string
  address: string
}

const LOCAL = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?'
const ADDRESS = new RegExp(`^${LOCAL}@(?:${LABEL}\\.)+[A-Za-z]{2,63}$`)
const WITH_NAME = /^(?:"((?:[^"\\]|\\.)*)"\s*|([^<>]*))<([^<>]*)>$/

/**
 * One address, from what a person typed.
 *
 * `sam@example.com`, `Sam Reed <sam@example.com>` and `"Reed, Sam" <sam@example.com>` are all read. Anything else is
 * refused, including the near misses -- no dot in the domain, a space in the middle, two at signs -- because an
 * address Orbis corrected on somebody's behalf is a message that goes to the wrong person or to nobody at all.
 *
 * A carriage return or a line feed anywhere in it is refused on sight: a header holding one would end the header and
 * the rest of what was typed would become part of the message's own instructions.
 */
export function readAddress(raw: string): MailAddress | null {
  const text = String(raw ?? '').trim()
  if (text === '' || text.length > EMAIL_LIMITS.address + EMAIL_LIMITS.name + 4) return null
  if (/[\r\n\u0000]/.test(text)) return null
  const named = WITH_NAME.exec(text)
  if (named) {
    const display = (named[1] !== undefined ? named[1].replace(/\\(.)/g, '$1') : (named[2] ?? '')).trim()
    const address = named[3].trim()
    if (display.length > EMAIL_LIMITS.name) return null
    return ADDRESS.test(address) && address.length <= EMAIL_LIMITS.address ? { display, address } : null
  }
  return ADDRESS.test(text) && text.length <= EMAIL_LIMITS.address ? { display: '', address: text } : null
}

/** Every address in a list, or the first one that is not an address, said by name. */
function readAddresses(raw: readonly string[] | string | undefined, what: string): MailAddress[] | SharingError {
  if (raw === undefined || raw === null) return []
  const list = (typeof raw === 'string' ? raw.split(/[,;]/) : [...raw]).map((one) => String(one ?? '').trim()).filter((one) => one !== '')
  if (list.length > EMAIL_LIMITS.recipients) {
    return { error: 'invalid-argument', message: `A draft can hold ${EMAIL_LIMITS.recipients} addresses in ${what}; ${list.length} were given.` }
  }
  const out: MailAddress[] = []
  for (const one of list) {
    const read = readAddress(one)
    if (!read) return { error: 'bad-address', message: `"${one.slice(0, 80)}" is not an email address Orbis can use. Write it as sam@example.com.` }
    out.push(read)
  }
  return out
}

// ---------------------------------------------------------------- headers

const ASCII_PRINTABLE = /^[\x20-\x7e]*$/
const encoder = new TextEncoder()

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

/**
 * Text that is not plain ASCII, written the one way a header may carry it: encoded words, RFC 2047.
 *
 * Each word is `=?UTF-8?B?…?=` and may be 75 characters at the most, which leaves 45 bytes of text inside it. The
 * split walks back off a continuation byte so an accented letter is never cut in half between two words -- a reader
 * decodes each word on its own, so a character split across two of them is lost rather than rejoined.
 */
export function encodedWords(text: string): string[] {
  const bytes = encoder.encode(text)
  const out: string[] = []
  let at = 0
  while (at < bytes.length) {
    let end = Math.min(bytes.length, at + 45)
    while (end > at + 1 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
    out.push(`=?UTF-8?B?${base64(bytes.subarray(at, end))}?=`)
    at = end
  }
  return out
}

/**
 * A header's encoded words read back, so what was written can be compared with what was asked for.
 *
 * The whitespace between two encoded words beside each other goes first. It is there because a long value had to be
 * split across lines, not because anybody typed a space -- leaving it in puts a space into the middle of a word.
 */
export function decodeWords(value: string): string {
  return value.replace(/(\?=)\s+(=\?)/g, '$1$2').replace(/=\?([A-Za-z0-9_-]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset: string, how: string, payload: string) => {
    if (!/^utf-?8$/i.test(charset)) return whole
    if (how.toLowerCase() === 'b') return Buffer.from(payload, 'base64').toString('utf8')
    const bytes = Buffer.from(
      payload.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
      'latin1'
    )
    return bytes.toString('utf8')
  })
}

/** Plain ASCII words folded at the recommended width, so a long subject is not one enormous line. */
function foldAscii(name: string, value: string): string {
  const lines: string[] = []
  let line = `${name}:`
  for (const word of value.split(/ +/)) {
    if (line !== `${name}:` && line.length + 1 + word.length > EMAIL_LIMITS.header) {
      lines.push(line)
      line = ` ${word}`
    } else {
      line += ` ${word}`
    }
  }
  lines.push(line)
  return lines.join('\r\n')
}

/** One header line, encoded if it has to be and folded if it is long. */
export function headerLine(name: string, value: string): string {
  const text = String(value ?? '').replace(/[\r\n]+/g, ' ').trim()
  if (ASCII_PRINTABLE.test(text)) return foldAscii(name, text)
  return `${name}: ${encodedWords(text).join('\r\n ')}`
}

/** An address as a header writes it: the name encoded or quoted if it needs to be, then the address in angles. */
function addressText(one: MailAddress): string {
  if (one.display === '') return one.address
  if (!ASCII_PRINTABLE.test(one.display)) return `${encodedWords(one.display).join(' ')} <${one.address}>`
  if (/[",:;<>@\\[\]()]/.test(one.display)) return `"${one.display.replace(/([\\"])/g, '\\$1')}" <${one.address}>`
  return `${one.display} <${one.address}>`
}

/** A list of addresses, one to a line when they do not fit on one. */
function addressHeader(name: string, list: readonly MailAddress[]): string {
  const items = list.map(addressText)
  const oneLine = `${name}: ${items.join(', ')}`
  if (oneLine.length <= EMAIL_LIMITS.header && ASCII_PRINTABLE.test(oneLine)) return oneLine
  return `${name}: ${items.join(',\r\n ')}`
}

const DAYS = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
const MONTHS = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
const pad = (value: number): string => String(value).padStart(2, '0')

/** The date a draft was written, as RFC 5322 writes one. Always UTC, so it is the same on every computer. */
export function mailDate(now: number): string {
  const at = new Date(now)
  return `${DAYS[at.getUTCDay()]}, ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())} +0000`
}

// ---------------------------------------------------------------- the attachment

const MEDIA_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,70}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,70}$/
/** The characters RFC 2231 lets a parameter value carry unencoded. Everything else is written as a percent escape. */
const ATTR_CHAR = /^[A-Za-z0-9!#$&+\-.^_`|~]$/

/** A file name in a header: quoted when it is plain, and percent-encoded UTF-8 when it is not (RFC 2231). */
export function filenameParameters(name: string): string {
  if (ASCII_PRINTABLE.test(name) && !/["\\;]/.test(name)) return `filename="${name}"`
  let encoded = ''
  for (const byte of encoder.encode(name)) {
    const character = String.fromCharCode(byte)
    encoded += ATTR_CHAR.test(character) ? character : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return `filename*=UTF-8''${encoded}`
}

/** Base64 wrapped at 76 columns: 57 bytes make exactly 76 characters, so no line is ever over. */
export function base64Lines(bytes: Uint8Array): string[] {
  const out: string[] = []
  const step = (EMAIL_LIMITS.wrap / 4) * 3
  for (let at = 0; at < bytes.length; at += step) out.push(base64(bytes.subarray(at, at + step)))
  return out
}

const formatBytes = (count: number): string => {
  if (count < 1024) return `${count} B`
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} KB`
  return `${(count / (1024 * 1024)).toFixed(1)} MB`
}

// ---------------------------------------------------------------- the draft

export interface EmailAttachment {
  name: string
  mediaType: string
  bytes: Uint8Array
}

export interface EmailDraftRequest {
  to?: readonly string[] | string
  cc?: readonly string[] | string
  subject: string
  body: string
  attachment?: EmailAttachment | null
  /** When the draft was written, for the Date header. Passed in so the same draft twice is the same bytes. */
  now: number
  /** The MIME boundary. Given by a test; otherwise derived from what is in the message. */
  boundary?: string
}

export interface EmailDraft {
  bytes: Uint8Array
  text: string
  hash: string
  /** A name for the file, extension included. */
  name: string
  mediaType: 'message/rfc822'
  to: MailAddress[]
  cc: MailAddress[]
  subject: string
  attachment: { name: string; mediaType: string; bytes: number; encoded: number } | null
  /** What a person is told, including that Orbis sends nothing. */
  notes: string[]
}

/**
 * A mail draft as a file, with the artifact attached inside it.
 *
 * Built in one pass with no library, because what a message is made of is four small rules -- CRLF line endings,
 * headers folded, text that is not ASCII in encoded words, and every part base64 -- and a library would be a
 * dependency to carry for them. The boundary cannot appear inside either part: both parts are base64, whose alphabet
 * has no underscore, and the boundary has one. That is checked anyway before the file is returned.
 */
export function buildEmailDraft(request: EmailDraftRequest): EmailDraft | SharingError {
  const subject = String(request.subject ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, EMAIL_LIMITS.subject)
  if (subject === '') return { error: 'invalid-argument', message: 'A draft needs a subject.' }
  const body = String(request.body ?? '')
  if (body.length > EMAIL_LIMITS.body) {
    return { error: 'too-large', message: `The message's own words are ${body.length} characters; ${EMAIL_LIMITS.body} is the most a draft carries. Put the long part in the attachment.` }
  }

  const to = readAddresses(request.to, 'the To line')
  if (isSharingError(to)) return to
  const cc = readAddresses(request.cc, 'the Cc line')
  if (isSharingError(cc)) return cc

  const notes: string[] = []
  let attachment: EmailDraft['attachment'] = null
  let attachmentName = ''
  if (request.attachment) {
    const given = request.attachment
    if (!(given.bytes instanceof Uint8Array)) return { error: 'invalid-argument', message: 'The attachment has no bytes to attach.' }
    if (given.bytes.length === 0) return { error: 'invalid-argument', message: 'The attachment is empty, so there is nothing to attach.' }
    if (!MEDIA_TYPE.test(String(given.mediaType ?? ''))) {
      return { error: 'bad-media-type', message: `"${String(given.mediaType ?? '').slice(0, 60)}" is not a file type Orbis can label an attachment with.` }
    }
    if (given.bytes.length > EMAIL_LIMITS.attachmentBytes) {
      return {
        error: 'too-large',
        message: `That file is ${formatBytes(given.bytes.length)}. A message can carry about ${formatBytes(EMAIL_LIMITS.attachmentBytes)}: attaching makes a file roughly a third bigger, and most mail services refuse a message over ${formatBytes(EMAIL_LIMITS.serviceBytes)}. Save the file and send a link to it instead.`
      }
    }
    attachmentName = safeName(String(given.name ?? '').slice(0, EMAIL_LIMITS.name), 'attachment')
    const encoded = Math.ceil(given.bytes.length / 3) * 4
    attachment = { name: attachmentName, mediaType: given.mediaType, bytes: given.bytes.length, encoded }
    if (encoded > EMAIL_LIMITS.serviceBytes) {
      notes.push(`Attached, the file is about ${formatBytes(encoded)} inside the message. Many mail services stop at ${formatBytes(EMAIL_LIMITS.serviceBytes)}, so this one may be refused when you send it.`)
    }
  }

  const boundary = request.boundary ?? `----=_Orbis_${hashOf(encoder.encode(`${request.now}|${subject}|${body.length}|${attachment ? `${attachment.name}|${attachment.bytes}` : 'none'}`))}`
  if (!/^[A-Za-z0-9'()+_,\-./:=?]{1,70}$/.test(boundary)) {
    return { error: 'invalid-argument', message: 'That boundary cannot be used in a message.' }
  }

  const lines: string[] = ['MIME-Version: 1.0', `Date: ${mailDate(request.now)}`]
  // The header that makes a mail program open this as a draft to send rather than as a message already received.
  lines.push('X-Unsent: 1')
  if (to.length > 0) lines.push(addressHeader('To', to))
  if (cc.length > 0) lines.push(addressHeader('Cc', cc))
  lines.push(headerLine('Subject', subject))

  const bodyLines = base64Lines(encoder.encode(body))
  if (attachment && request.attachment) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
    lines.push('')
    lines.push(`--${boundary}`)
    lines.push('Content-Type: text/plain; charset="utf-8"')
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(...bodyLines)
    lines.push(`--${boundary}`)
    // The legacy `name` is written only when it is plain ASCII; the one that counts is `filename` below.
    lines.push(`Content-Type: ${attachment.mediaType}${ASCII_PRINTABLE.test(attachmentName) && !/["\\;]/.test(attachmentName) ? `; name="${attachmentName}"` : ''}`)
    lines.push('Content-Transfer-Encoding: base64')
    lines.push(`Content-Disposition: attachment;\r\n ${filenameParameters(attachmentName)}`)
    lines.push('')
    lines.push(...base64Lines(request.attachment.bytes))
    lines.push(`--${boundary}--`)
  } else {
    lines.push('Content-Type: text/plain; charset="utf-8"')
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(...bodyLines)
  }

  const text = `${lines.join('\r\n')}\r\n`
  if (attachment && text.split(`--${boundary}`).length !== 4) {
    return { error: 'invalid-argument', message: 'The message could not be built safely: its separator appears in what was being attached.' }
  }
  const bytes = encoder.encode(text)

  const where = to.length > 0 ? to.map((one) => one.address).join(', ') : 'whoever you address it to'
  notes.unshift(
    `Orbis does not send email and has no mail account. This is a draft file: open it and your own mail program opens it ready to send to ${where}, from your own account. Nothing leaves this computer until you press Send there.`
  )
  if (attachment) notes.push(`"${attachment.name}" is inside the draft, so you do not have to attach it yourself.`)
  if (to.length === 0) notes.push('No address was given, so the draft opens with the To line empty.')

  return {
    bytes,
    text,
    hash: hashOf(bytes),
    name: `${safeName(subject, 'Draft')}.eml`,
    mediaType: 'message/rfc822',
    to,
    cc,
    subject,
    attachment,
    notes
  }
}

// ---------------------------------------------------------------- reading a draft back

export interface EmailPart {
  mediaType: string
  filename: string | null
  encoding: string
  bytes: Uint8Array
}

export interface ParsedEmail {
  /** Header names lowercased, values unfolded and with their encoded words decoded. */
  headers: Record<string, string>
  parts: EmailPart[]
}

/** Folded header lines joined again, and each header's name lowercased so a lookup cannot miss on case. */
function readHeaders(block: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null)
  const unfolded: string[] = []
  for (const line of block.split('\r\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) unfolded[unfolded.length - 1] += line.replace(/^[ \t]+/, ' ')
    else unfolded.push(line)
  }
  for (const line of unfolded) {
    const at = line.indexOf(':')
    if (at < 0) continue
    out[line.slice(0, at).trim().toLowerCase()] = decodeWords(line.slice(at + 1).trim())
  }
  return out
}

const parameterOf = (value: string, name: string): string | null => {
  const extended = new RegExp(`${name}\\*=([^;]+)`, 'i').exec(value)
  if (extended) {
    const found = /^(?:[^']*)'(?:[^']*)'(.*)$/.exec(extended[1].trim())
    const raw = (found ? found[1] : extended[1]).trim()
    return Buffer.from(raw.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1').toString('utf8')
  }
  const plain = new RegExp(`${name}=("([^"]*)"|[^;\\s]+)`, 'i').exec(value)
  return plain ? (plain[2] ?? plain[1]) : null
}

const decodePart = (encoding: string, body: string): Uint8Array =>
  encoding.toLowerCase() === 'base64' ? new Uint8Array(Buffer.from(body.replace(/[\r\n]+/g, ''), 'base64')) : encoder.encode(body)

/**
 * A `.eml` file read back into its headers and its parts.
 *
 * Only as much of the format as this file writes: one level of multipart, base64 or plain parts, no nested
 * multiparts, no quoted-printable except in a header's encoded words. That is enough to prove a draft Orbis wrote
 * holds what it was asked to hold, which is the only reason this reader exists.
 */
export function readEmailDraft(source: Uint8Array | string): ParsedEmail | SharingError {
  const text = (typeof source === 'string' ? source : new TextDecoder('utf-8', { fatal: false }).decode(source)).replace(/\r?\n/g, '\r\n')
  const split = text.indexOf('\r\n\r\n')
  if (split < 0) return { error: 'parse', message: 'That file is not a message: it has no blank line between its headers and its body.' }
  const headers = readHeaders(text.slice(0, split))
  const body = text.slice(split + 4)
  const contentType = headers['content-type'] ?? 'text/plain'

  if (!/^multipart\//i.test(contentType)) {
    return {
      headers,
      parts: [{ mediaType: contentType.split(';')[0].trim(), filename: null, encoding: headers['content-transfer-encoding'] ?? '7bit', bytes: decodePart(headers['content-transfer-encoding'] ?? '', body) }]
    }
  }

  const boundary = parameterOf(contentType, 'boundary')
  if (!boundary) return { error: 'parse', message: 'The message says it has several parts but does not say what separates them.' }
  const parts: EmailPart[] = []
  const pieces = body.split(`--${boundary}`)
  for (const piece of pieces.slice(1)) {
    if (piece.startsWith('--')) break
    const trimmed = piece.replace(/^\r\n/, '')
    const at = trimmed.indexOf('\r\n\r\n')
    if (at < 0) continue
    const partHeaders = readHeaders(trimmed.slice(0, at))
    const partBody = trimmed.slice(at + 4).replace(/\r\n$/, '')
    const partType = partHeaders['content-type'] ?? 'text/plain'
    const encoding = partHeaders['content-transfer-encoding'] ?? '7bit'
    parts.push({
      mediaType: partType.split(';')[0].trim(),
      filename: parameterOf(partHeaders['content-disposition'] ?? '', 'filename') ?? parameterOf(partType, 'name'),
      encoding,
      bytes: decodePart(encoding, partBody)
    })
  }
  return { headers, parts }
}

/**
 * The draft read back and compared with what it was asked to hold.
 *
 * Not "it parses": the attachment is decoded and compared byte for byte with the file that went in, because a draft
 * that opens with a corrupt attachment is worse than one that was never made -- it gets sent.
 */
export function verifyEmailDraft(draft: EmailDraft, readBack: Uint8Array, attached?: Uint8Array, expected?: { bytes: number; hash: string }): VerifyResult {
  const checks: VerifyResult['checks'] = []
  const differences: string[] = []
  if (expected) {
    checks.push({ what: 'written', passed: readBack.length === expected.bytes, describe: `The file on disk is ${formatBytes(readBack.length)}; ${formatBytes(expected.bytes)} was written.` })
    checks.push({ what: 'checksum', passed: hashOf(readBack) === expected.hash, describe: 'The hash of the file on disk matches the one recorded when it was written.' })
  }

  const parsed = readEmailDraft(readBack)
  if (isSharingError(parsed)) {
    checks.push({ what: 'message', passed: false, describe: `The file could not be read back as a message: ${parsed.message}` })
    return { ok: false, checks, reimported: null, differences }
  }
  checks.push({ what: 'message', passed: true, describe: `The file reads back as a message with ${parsed.parts.length} part${parsed.parts.length === 1 ? '' : 's'}.` })
  checks.push({
    what: 'draft',
    passed: (parsed.headers['x-unsent'] ?? '') === '1',
    describe: (parsed.headers['x-unsent'] ?? '') === '1' ? 'The message is marked unsent, so a mail program opens it as a draft to send.' : 'The message is not marked unsent.'
  })

  const subjectBack = parsed.headers.subject ?? ''
  const sameSubject = subjectBack === draft.subject
  if (!sameSubject) differences.push(`The subject read back as "${subjectBack}" rather than "${draft.subject}".`)
  const toBack = parsed.headers.to ?? ''
  const addressesFound = draft.to.every((one) => toBack.includes(one.address))
  if (!addressesFound) differences.push(`The To line read back as "${toBack}".`)
  checks.push({
    what: 'headers',
    passed: sameSubject && addressesFound,
    describe: sameSubject && addressesFound ? `The subject and ${draft.to.length === 1 ? 'the address' : `all ${draft.to.length} addresses`} read back as they were written.` : 'The subject or the addresses did not read back as they were written.'
  })

  if (draft.attachment) {
    const part = parsed.parts.find((one) => one.filename !== null)
    if (!part) {
      checks.push({ what: 'attachment', passed: false, describe: 'The file was attached, but no attached part could be found reading the message back.' })
    } else {
      const sameName = part.filename === draft.attachment.name
      const sameSize = part.bytes.length === draft.attachment.bytes
      const sameBytes = attached ? hashOf(part.bytes) === hashOf(attached) : sameSize
      if (!sameName) differences.push(`The attachment's name read back as "${part.filename}".`)
      if (!sameSize) differences.push(`The attachment read back as ${part.bytes.length} bytes; ${draft.attachment.bytes} went in.`)
      else if (!sameBytes) differences.push('The attachment read back as the right length but not the same bytes.')
      checks.push({
        what: 'attachment',
        passed: sameName && sameSize && sameBytes,
        describe: sameName && sameSize && sameBytes ? `"${part.filename}" came back out of the message as the same ${formatBytes(part.bytes.length)}${attached ? ', byte for byte' : ''}.` : 'The attachment did not come back out of the message unchanged.'
      })
    }
  }

  return { ok: checks.every((one) => one.passed), checks, reimported: { rows: parsed.parts.length, columns: 0 }, differences }
}

// ---------------------------------------------------------------- cloud folders on this computer

export interface CloudFolder {
  id: string
  /** What to call it on screen: the folder's own name, which is what the cloud program named it. */
  name: string
  path: string
  /** Whether Orbis could write into it. A folder it cannot write into is still listed, saying so. */
  writable: boolean
  /** The program that keeps it in step, named in the words shown beside it. */
  keptBy: string
}

export interface CloudDeps {
  /** Whether the path is a folder that exists. Nothing inside it is read. */
  isFolder(path: string): Promise<boolean>
  isWritable(path: string): Promise<boolean>
  /** One small pointer file a cloud program writes to say where its folder is. Null when there is none. */
  readText(path: string): Promise<string | null>
}

export const CLOUD_LIMITS = Object.freeze({
  folders: 20,
  /** Bytes of a cloud program's own pointer file that will be read. They are a few hundred. */
  pointer: 64 * 1024
})

/** The drive letters a mounted cloud drive could be on. A to C are the floppy drives and the system drive. */
const LETTERS = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/**
 * The folders on this computer that a cloud program keeps in step.
 *
 * Found the way each program says to find it, and no other way:
 *
 *   - **OneDrive** writes its folder into the environment: `OneDrive`, and `OneDriveConsumer` and
 *     `OneDriveCommercial` when somebody has both a personal and a work account signed in.
 *   - **Dropbox** writes a small `info.json` under the user's own application data saying where each account's
 *     folder is. That one file is read; nothing in the Dropbox folder is.
 *   - **Google Drive for desktop** mounts a drive with `My Drive` inside it, or puts a folder of that name in the
 *     user's own folder when it is set to mirror.
 *   - **iCloud Drive** puts `iCloudDrive` in the user's own folder.
 *
 * Nothing here signs in to anything, asks anything over the network, or reads what is in any of these folders. A
 * folder that is not really there is not listed, so "Save to OneDrive" is never offered to somebody who has no
 * OneDrive.
 */
export async function cloudFolders(env: Record<string, string | undefined>, deps: CloudDeps): Promise<CloudFolder[]> {
  const out: CloudFolder[] = []
  const seen = new Set<string>()
  const home = env.USERPROFILE ?? env.HOME ?? ''

  const add = async (id: string, path: string | undefined | null, keptBy: string, name?: string): Promise<void> => {
    if (!path || out.length >= CLOUD_LIMITS.folders) return
    const trimmed = path.replace(/[\\/]+$/, '')
    const key = trimmed.toLowerCase()
    if (seen.has(key)) return
    if (!(await deps.isFolder(path))) return
    seen.add(key)
    out.push({ id, name: name ?? (basename(trimmed) || id), path, writable: await deps.isWritable(path), keptBy })
  }

  for (const variable of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) await add('onedrive', env[variable], 'OneDrive')

  // Dropbox's own pointer file. Only `path` is taken from it, and the account name is used only as a label.
  for (const root of [env.APPDATA, env.LOCALAPPDATA]) {
    if (!root) continue
    const raw = await deps.readText(join(root, 'Dropbox', 'info.json'))
    if (!raw) continue
    let parsed: unknown = null
    try {
      parsed = JSON.parse(raw.slice(0, CLOUD_LIMITS.pointer))
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    for (const [account, value] of Object.entries(parsed as Record<string, unknown>)) {
      const path = typeof value === 'object' && value !== null ? (value as { path?: unknown }).path : null
      if (typeof path !== 'string') continue
      await add('dropbox', path, 'Dropbox', account === 'personal' || account === 'business' ? `Dropbox (${account})` : 'Dropbox')
    }
  }

  for (const letter of LETTERS) await add('googledrive', `${letter}:\\My Drive`, 'Google Drive for desktop', 'Google Drive')
  if (home !== '') {
    await add('googledrive', join(home, 'My Drive'), 'Google Drive for desktop', 'Google Drive')
    await add('googledrive', join(home, 'Google Drive'), 'Google Drive for desktop', 'Google Drive')
    await add('icloud', join(home, 'iCloudDrive'), 'iCloud', 'iCloud Drive')
    await add('icloud', join(home, 'iCloud Drive'), 'iCloud', 'iCloud Drive')
  }
  return out
}

/** The real thing, for the main process. Everything it does is a stat, an access check, or one small file read. */
export function nodeCloudDeps(): CloudDeps {
  return {
    async isFolder(path) {
      try {
        return (await stat(path)).isDirectory()
      } catch {
        return false
      }
    },
    async isWritable(path) {
      try {
        await access(path, constants.W_OK)
        return true
      } catch {
        return false
      }
    },
    async readText(path) {
      try {
        const bytes = await readFile(path)
        return bytes.length > CLOUD_LIMITS.pointer ? null : bytes.toString('utf8')
      } catch {
        return null
      }
    }
  }
}

/** One of the folders that were found, by the path a caller named. Never a path a caller invented. */
export function cloudFolderAt(folders: readonly CloudFolder[], path: string): CloudFolder | SharingError {
  const wanted = String(path ?? '').replace(/[\\/]+$/, '').toLowerCase()
  const found = folders.find((one) => one.path.replace(/[\\/]+$/, '').toLowerCase() === wanted)
  if (!found) return { error: 'no-folder', message: 'That is not one of the cloud folders Orbis found on this computer.' }
  if (!found.writable) return { error: 'no-folder', message: `Orbis cannot write into ${found.name}. Check that the folder is not read-only and that ${found.keptBy} is running.` }
  return found
}

/** The words shown after a copy has been saved into a cloud folder. The uploading is somebody else's doing. */
export function cloudSaveNote(folder: CloudFolder, fileName: string): string {
  return `"${fileName}" was saved into ${folder.name} on this computer. ${folder.keptBy} uploads what appears in that folder, so it will go up when it next syncs -- Orbis did not upload it, has no account there, and cannot tell you when it has finished.`
}
