import { crc32 } from 'node:zlib'

/**
 * The ZIP container the `.orbis` package is, written and read here rather than taken from a library.
 *
 * Not because writing one is fun. Because the security properties of reading an archive somebody else made are the
 * whole problem, and they have to be in the reader rather than in a check afterwards. A path is rejected while its
 * header is being parsed, not after a file has been written somewhere. A size limit stops a decompression bomb during
 * inflation, not after it has filled the disk. `node:zlib` already provides raw deflate, which is exactly what ZIP's
 * method 8 is, so the rest is the container format.
 *
 * ## What this refuses, and why
 *
 * An archive is untrusted input. Every one of these has been used against real software:
 *
 * - **An absolute path** (`/etc/passwd`, `C:\Windows\...`) writes outside the staging folder.
 * - **A traversal** (`../../..`) does the same with relative steps, including the encoded and mixed-separator forms.
 * - **A backslash** is a separator on Windows and an ordinary character in the ZIP spec, so `a\..\..\b` looks
 *   traversal-free to a reader splitting on `/` and is a traversal on the machine that extracts it.
 * - **A decompression bomb** is a few kilobytes that inflate to terabytes. The limit is on the output, checked while
 *   inflating, because a limit checked afterwards has already allocated the memory.
 * - **A lying header.** The declared uncompressed size is a claim in a file an attacker wrote. It is used to *reject*
 *   early and never to trust: the real size is counted as the bytes arrive.
 * - **A null byte** truncates a path in some filesystem calls, so `safe.json\0../../evil` can pass a check and land
 *   somewhere else.
 * - **A reserved Windows name** (`CON`, `NUL`, `COM1`) is a device, not a file, and writing to one has effects.
 *
 * ## What it does not do
 *
 * No encryption. ZIP's own encryption is weak and its successors are inconsistently implemented; the package encrypts
 * its payload with the same scrypt-and-AES-GCM path the Secrets Vault uses, above this layer. No symbolic links, no
 * permissions, no ownership: a package carries content, and anything that describes the machine it came from is
 * exactly what should not travel.
 */

// ---------------------------------------------------------------- limits

export interface ZipLimits {
  /** The largest a single entry may inflate to. */
  entryBytes: number
  /** The largest everything may inflate to together. */
  totalBytes: number
  /** How many entries an archive may contain. */
  entries: number
  /**
   * The most an entry may inflate relative to its compressed size before it is refused.
   *
   * Deflate manages about 1000:1 on pathological input and rarely passes 10:1 on anything real, so this is generous
   * for honest data and still stops the classic bomb. Applied only above a floor, because a 20-byte file that inflates
   * to 4KB is a ratio of 200 and is not an attack.
   */
  ratio: number
  /** Below this many compressed bytes the ratio is not applied. */
  ratioFloor: number
  /** The longest a path inside the archive may be. */
  pathLength: number
}

export const DEFAULT_LIMITS: Readonly<ZipLimits> = Object.freeze({
  entryBytes: 4 * 1024 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024 * 1024,
  entries: 500_000,
  ratio: 2000,
  ratioFloor: 4096,
  pathLength: 512
})

export interface ZipError {
  error:
    | 'not-a-zip'
    | 'truncated'
    | 'unsupported'
    | 'bad-path'
    | 'too-many-entries'
    | 'too-large'
    | 'bomb'
    | 'corrupt'
    | 'duplicate-path'
  message: string
}

export const isZipError = (value: unknown): value is ZipError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: ZipError['error'], message: string): ZipError => ({ error, message })

// ---------------------------------------------------------------- paths

/** Windows treats these as devices whatever the extension, so a file with one of these stems is refused. */
const RESERVED = new Set(['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'])

export interface PathCheck {
  ok: boolean
  /** The path as it will be used, when it is usable. */
  clean: string
  why: string
}

/**
 * Whether a path from inside an archive may be written.
 *
 * Every rule here refuses rather than repairs. Sanitising a hostile path -- stripping the `..`, replacing the
 * backslash -- produces a path that is safe and is not the one in the archive, which means the entry the manifest
 * refers to is now at a different place. Refusing keeps the package and the extraction honest with each other.
 */
export function checkPath(raw: string, limits: ZipLimits = DEFAULT_LIMITS): PathCheck {
  const no = (why: string): PathCheck => ({ ok: false, clean: '', why })

  if (raw.length === 0) return no('the entry has no name')
  if (raw.length > limits.pathLength) return no(`the entry name is longer than the ${limits.pathLength} characters allowed`)
  if (raw.includes('\u0000')) return no('the entry name contains a null byte, which can truncate a path once it reaches the filesystem')
  // Checked before any splitting: a backslash is a separator on Windows and an ordinary character to the ZIP spec, so
  // a reader that splits on "/" alone sees no traversal in a path that traverses when it is extracted.
  if (raw.includes('\\')) return no('the entry name contains a backslash, which is a directory separator on some systems and an ordinary character in the archive')
  if (raw.startsWith('/')) return no('the entry name is an absolute path')
  if (/^[A-Za-z]:/.test(raw)) return no('the entry name begins with a drive letter')
  // The percent-encoded forms, in case anything downstream decodes before joining.
  if (/%2e%2e|%2f|%5c/i.test(raw)) return no('the entry name contains an encoded separator or an encoded upward step')

  const parts = raw.split('/')
  for (const part of parts) {
    if (part === '') return no('the entry name has an empty path segment')
    if (part === '.' || part === '..') return no('the entry name contains a step that walks up or stays put')
    // Windows strips trailing dots and spaces, so "evil. " and "evil" become the same file after a check on the first.
    if (part.endsWith('.') || part.endsWith(' ')) return no('a path segment ends with a dot or a space, which some systems strip')
    const stem = (part.split('.')[0] ?? '').toLowerCase()
    if (RESERVED.has(stem)) return no(`"${part}" names a system device rather than a file`)
    // eslint-disable-next-line no-control-regex
    if (/[\u0001-\u001f<>:"|?*]/.test(part)) return no('a path segment contains a character a filesystem cannot hold')
  }

  return { ok: true, clean: raw, why: '' }
}

// ---------------------------------------------------------------- writing

export interface ZipEntry {
  /** Relative, forward slashes, already checked. */
  path: string
  data: Uint8Array
  /**
   * Whether to compress.
   *
   * Left to the caller, because the caller knows what the bytes are. Deflating a JPEG spends processor time to make
   * the file very slightly larger; deflating JSON commonly takes it to a fifth. `shouldCompress` decides from the
   * name where the caller has no better information.
   */
  compress: boolean
  /** Milliseconds. Written into the archive's own timestamp field, which has two-second resolution. */
  modified?: number
}

/** Formats that are already compressed, where deflating again costs time and saves nothing. */
const ALREADY_COMPRESSED = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic',
  'mp4', 'webm', 'mov', 'mkv', 'avi',
  'mp3', 'aac', 'ogg', 'opus', 'flac', 'm4a',
  'zip', 'gz', 'bz2', 'xz', 'zst', '7z', 'rar',
  'woff', 'woff2', 'pdf', 'orbis'
])

/** Whether a file with this name is worth deflating. */
export function shouldCompress(path: string, size: number): boolean {
  // Below a few hundred bytes the deflate header is a meaningful share of the result.
  if (size < 256) return false
  const extension = (path.split('.').pop() ?? '').toLowerCase()
  return !ALREADY_COMPRESSED.has(extension)
}

const METHOD_STORE = 0
const METHOD_DEFLATE = 8
const ZIP64_LIMIT = 0xffffffff

/** MS-DOS date and time, which is what a ZIP header holds: two-second resolution, from 1980. */
function dosTime(at: number): { time: number; date: number } {
  const d = new Date(at)
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (Math.floor(d.getSeconds() / 2) & 0x1f) | ((d.getMinutes() & 0x3f) << 5) | ((d.getHours() & 0x1f) << 11),
    date: (d.getDate() & 0x1f) | (((d.getMonth() + 1) & 0x0f) << 5) | (((year - 1980) & 0x7f) << 9)
  }
}

interface Written {
  path: string
  crc: number
  compressed: number
  uncompressed: number
  method: number
  offset: number
  time: number
  date: number
}

/**
 * A ZIP archive, built entry by entry.
 *
 * Entries are handed out as chunks rather than accumulated, so a package larger than memory can be written straight to
 * a file. The central directory is the only thing held, and that is one small record per entry.
 */
export class ZipWriter {
  #entries: Written[] = []
  #offset = 0
  #paths = new Set<string>()
  #deflate: (data: Uint8Array) => Uint8Array

  /**
   * @param deflateRawSync Injected so this file needs no Node-only import and can be tested with a stub. In the app it
   * is `zlib.deflateRawSync`.
   */
  constructor(deflateRawSync: (data: Uint8Array) => Uint8Array) {
    this.#deflate = deflateRawSync
  }

  /** The bytes for one entry, or an error when the entry cannot go in. */
  add(entry: ZipEntry, limits: ZipLimits = DEFAULT_LIMITS): Uint8Array | ZipError {
    const check = checkPath(entry.path, limits)
    if (!check.ok) return fail('bad-path', `That entry cannot be added: ${check.why}.`)
    if (this.#paths.has(entry.path)) {
      // Two entries at one path makes extraction order decide which one survives, which is not something a package
      // should leave to chance.
      return fail('duplicate-path', `The archive already has an entry at "${entry.path}".`)
    }
    if (this.#entries.length >= limits.entries) return fail('too-many-entries', `An archive holds at most ${limits.entries.toLocaleString('en')} entries.`)

    const raw = entry.data
    const compressed = entry.compress ? this.#deflate(raw) : raw
    // Deflate occasionally makes a file larger. Storing it then is smaller and faster to read.
    const useDeflate = entry.compress && compressed.length < raw.length
    const payload = useDeflate ? compressed : raw
    const { time, date } = dosTime(entry.modified ?? 0)

    const name = new TextEncoder().encode(entry.path)
    const crc = crc32(raw) >>> 0

    const header = new DataView(new ArrayBuffer(30))
    header.setUint32(0, 0x04034b50, true)
    // Version 4.5 when a Zip64 field is needed, 2.0 otherwise.
    const needsZip64 = raw.length > ZIP64_LIMIT || payload.length > ZIP64_LIMIT || this.#offset > ZIP64_LIMIT
    header.setUint16(4, needsZip64 ? 45 : 20, true)
    // Bit 11: the name is UTF-8. Set always, so a non-ASCII filename is read back as what it was.
    header.setUint16(6, 0x0800, true)
    header.setUint16(8, useDeflate ? METHOD_DEFLATE : METHOD_STORE, true)
    header.setUint16(10, time, true)
    header.setUint16(12, date, true)
    header.setUint32(14, crc, true)
    header.setUint32(18, needsZip64 ? ZIP64_LIMIT : payload.length, true)
    header.setUint32(22, needsZip64 ? ZIP64_LIMIT : raw.length, true)
    header.setUint16(26, name.length, true)

    const extra = needsZip64 ? zip64Extra(raw.length, payload.length) : new Uint8Array(0)
    header.setUint16(28, extra.length, true)

    const out = new Uint8Array(30 + name.length + extra.length + payload.length)
    out.set(new Uint8Array(header.buffer), 0)
    out.set(name, 30)
    out.set(extra, 30 + name.length)
    out.set(payload, 30 + name.length + extra.length)

    this.#entries.push({
      path: entry.path,
      crc,
      compressed: payload.length,
      uncompressed: raw.length,
      method: useDeflate ? METHOD_DEFLATE : METHOD_STORE,
      offset: this.#offset,
      time,
      date
    })
    this.#paths.add(entry.path)
    this.#offset += out.length
    return out
  }

  /** The central directory and the end record. Written after every entry. */
  finish(): Uint8Array {
    const chunks: Uint8Array[] = []
    const start = this.#offset

    for (const one of this.#entries) {
      const name = new TextEncoder().encode(one.path)
      const needsZip64 = one.uncompressed > ZIP64_LIMIT || one.compressed > ZIP64_LIMIT || one.offset > ZIP64_LIMIT
      const extra = needsZip64 ? zip64Extra(one.uncompressed, one.compressed, one.offset) : new Uint8Array(0)

      const record = new DataView(new ArrayBuffer(46))
      record.setUint32(0, 0x02014b50, true)
      record.setUint16(4, needsZip64 ? 45 : 20, true)
      record.setUint16(6, needsZip64 ? 45 : 20, true)
      record.setUint16(8, 0x0800, true)
      record.setUint16(10, one.method, true)
      record.setUint16(12, one.time, true)
      record.setUint16(14, one.date, true)
      record.setUint32(16, one.crc, true)
      record.setUint32(20, needsZip64 ? ZIP64_LIMIT : one.compressed, true)
      record.setUint32(24, needsZip64 ? ZIP64_LIMIT : one.uncompressed, true)
      record.setUint16(28, name.length, true)
      record.setUint16(30, extra.length, true)
      record.setUint32(42, needsZip64 ? ZIP64_LIMIT : one.offset, true)

      const block = new Uint8Array(46 + name.length + extra.length)
      block.set(new Uint8Array(record.buffer), 0)
      block.set(name, 46)
      block.set(extra, 46 + name.length)
      chunks.push(block)
      this.#offset += block.length
    }

    const size = this.#offset - start
    const end = new DataView(new ArrayBuffer(22))
    end.setUint32(0, 0x06054b50, true)
    end.setUint16(8, Math.min(this.#entries.length, 0xffff), true)
    end.setUint16(10, Math.min(this.#entries.length, 0xffff), true)
    end.setUint32(12, Math.min(size, ZIP64_LIMIT), true)
    end.setUint32(16, Math.min(start, ZIP64_LIMIT), true)
    chunks.push(new Uint8Array(end.buffer))

    let total = 0
    for (const one of chunks) total += one.length
    const out = new Uint8Array(total)
    let at = 0
    for (const one of chunks) {
      out.set(one, at)
      at += one.length
    }
    return out
  }

  /** What has been added, for a manifest that has to agree with the archive. */
  manifest(): { path: string; size: number; compressed: number; crc: number }[] {
    return this.#entries.map((one) => ({ path: one.path, size: one.uncompressed, compressed: one.compressed, crc: one.crc }))
  }
}

function zip64Extra(uncompressed: number, compressed: number, offset?: number): Uint8Array {
  const fields = offset === undefined ? 2 : 3
  const view = new DataView(new ArrayBuffer(4 + fields * 8))
  view.setUint16(0, 0x0001, true)
  view.setUint16(2, fields * 8, true)
  setBigUint(view, 4, uncompressed)
  setBigUint(view, 12, compressed)
  if (offset !== undefined) setBigUint(view, 20, offset)
  return new Uint8Array(view.buffer)
}

const setBigUint = (view: DataView, at: number, value: number): void => view.setBigUint64(at, BigInt(Math.max(0, Math.floor(value))), true)
const getBigUint = (view: DataView, at: number): number => Number(view.getBigUint64(at, true))

// ---------------------------------------------------------------- reading

export interface ZipListing {
  path: string
  size: number
  compressed: number
  crc: number
  method: number
  /** Where the entry's local header starts. */
  offset: number
  modified: number
}

/**
 * The archive's table of contents, read from the central directory.
 *
 * The central directory rather than by walking the local headers, because the central directory is what the format
 * says is authoritative and because walking gives an attacker a second, disagreeing view of the same archive. Every
 * path is checked here, so a hostile entry is refused before anything reads its bytes.
 */
export function readDirectory(archive: Uint8Array, limits: ZipLimits = DEFAULT_LIMITS): ZipListing[] | ZipError {
  if (archive.length < 22) return fail('not-a-zip', 'The file is too small to be an archive.')

  // The end record is last, but a comment may follow it, so it is searched for backwards.
  let end = -1
  const from = Math.max(0, archive.length - 22 - 0xffff)
  for (let i = archive.length - 22; i >= from; i -= 1) {
    if (archive[i] === 0x50 && archive[i + 1] === 0x4b && archive[i + 2] === 0x05 && archive[i + 3] === 0x06) {
      end = i
      break
    }
  }
  if (end === -1) return fail('not-a-zip', 'This file has no archive end record, so it is not a ZIP archive.')

  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  let count = view.getUint16(end + 10, true)
  let directoryAt = view.getUint32(end + 16, true)

  // Zip64: the 32-bit fields are saturated and the real ones are in a locator before the end record.
  if (count === 0xffff || directoryAt === ZIP64_LIMIT) {
    const locator = end - 20
    if (locator < 0 || view.getUint32(locator, true) !== 0x07064b50) {
      return fail('corrupt', 'This archive says it is a Zip64 archive and has no Zip64 locator.')
    }
    const zip64At = getBigUint(view, locator + 8)
    if (zip64At + 56 > archive.length || view.getUint32(zip64At, true) !== 0x06064b50) {
      return fail('corrupt', 'This archive\u2019s Zip64 end record is missing or not where it says it is.')
    }
    count = getBigUint(view, zip64At + 32)
    directoryAt = getBigUint(view, zip64At + 48)
  }

  if (count > limits.entries) return fail('too-many-entries', `This archive declares ${count.toLocaleString('en')} entries, past the ${limits.entries.toLocaleString('en')} allowed.`)
  if (directoryAt >= archive.length) return fail('corrupt', 'This archive\u2019s table of contents is not inside the file.')

  const out: ZipListing[] = []
  const seen = new Set<string>()
  let at = directoryAt
  let declaredTotal = 0

  for (let i = 0; i < count; i += 1) {
    if (at + 46 > archive.length) return fail('truncated', 'This archive\u2019s table of contents ends part-way through an entry.')
    if (view.getUint32(at, true) !== 0x02014b50) return fail('corrupt', `Entry ${i + 1} of the table of contents does not begin where it should.`)

    const method = view.getUint16(at + 10, true)
    const crc = view.getUint32(at + 16, true)
    let compressed = view.getUint32(at + 20, true)
    let size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    let offset = view.getUint32(at + 42, true)
    const time = view.getUint16(at + 12, true)
    const date = view.getUint16(at + 14, true)

    if (at + 46 + nameLength + extraLength + commentLength > archive.length) {
      return fail('truncated', `Entry ${i + 1} claims a name or extra field that runs past the end of the file.`)
    }

    const raw = new TextDecoder('utf-8', { fatal: false }).decode(archive.subarray(at + 46, at + 46 + nameLength))

    // Zip64 values override the saturated 32-bit ones, in the order the spec fixes.
    if (size === ZIP64_LIMIT || compressed === ZIP64_LIMIT || offset === ZIP64_LIMIT) {
      const extraStart = at + 46 + nameLength
      let cursor = extraStart
      let found = false
      while (cursor + 4 <= extraStart + extraLength) {
        const tag = view.getUint16(cursor, true)
        const length = view.getUint16(cursor + 2, true)
        if (cursor + 4 + length > extraStart + extraLength) break
        if (tag === 0x0001) {
          let field = cursor + 4
          if (size === ZIP64_LIMIT && field + 8 <= cursor + 4 + length) {
            size = getBigUint(view, field)
            field += 8
          }
          if (compressed === ZIP64_LIMIT && field + 8 <= cursor + 4 + length) {
            compressed = getBigUint(view, field)
            field += 8
          }
          if (offset === ZIP64_LIMIT && field + 8 <= cursor + 4 + length) offset = getBigUint(view, field)
          found = true
          break
        }
        cursor += 4 + length
      }
      if (!found) return fail('corrupt', `Entry ${i + 1} saturates its 32-bit sizes and carries no Zip64 field.`)
    }

    // A directory entry: nothing is extracted for one, so it is skipped rather than refused for ending in a slash.
    const isDirectory = raw.endsWith('/') && size === 0
    if (!isDirectory) {
      const check = checkPath(raw, limits)
      if (!check.ok) return fail('bad-path', `This archive contains an entry that cannot be extracted safely: ${check.why}.`)
      if (seen.has(raw)) return fail('duplicate-path', `This archive has two entries at "${raw}", so which one survives would depend on the order they were read.`)
      seen.add(raw)

      if (method !== METHOD_STORE && method !== METHOD_DEFLATE) {
        return fail('unsupported', `Entry "${raw}" uses compression method ${method}, which Orbis does not read.`)
      }
      if (size > limits.entryBytes) return fail('too-large', `Entry "${raw}" declares ${size.toLocaleString('en')} bytes, past the limit for one entry.`)
      if (offset + 30 > archive.length) return fail('corrupt', `Entry "${raw}" says its data is past the end of the file.`)

      // The ratio is checked on the *declared* size here, only to refuse early. The real check is on the bytes that
      // actually arrive during inflation, because this number is a claim in a file somebody else wrote.
      if (compressed >= limits.ratioFloor && size / Math.max(1, compressed) > limits.ratio) {
        return fail('bomb', `Entry "${raw}" claims to expand ${Math.round(size / Math.max(1, compressed))} times, which is past what Orbis will inflate.`)
      }

      declaredTotal += size
      if (declaredTotal > limits.totalBytes) return fail('too-large', 'This archive declares more content than Orbis will extract.')

      out.push({ path: raw, size, compressed, crc, method, offset, modified: fromDosTime(date, time) })
    }

    at += 46 + nameLength + extraLength + commentLength
  }

  return out
}

function fromDosTime(date: number, time: number): number {
  if (date === 0 && time === 0) return 0
  const year = 1980 + ((date >> 9) & 0x7f)
  const month = ((date >> 5) & 0x0f) - 1
  const day = date & 0x1f
  const hours = (time >> 11) & 0x1f
  const minutes = (time >> 5) & 0x3f
  const seconds = (time & 0x1f) * 2
  const at = new Date(year, month, day, hours, minutes, seconds).getTime()
  return Number.isFinite(at) ? at : 0
}

/**
 * One entry's bytes.
 *
 * The declared size is checked against what actually arrived, and so is the CRC. A reader that trusted the header
 * would accept a file whose contents had been swapped for something else of a different length.
 */
export function readEntry(
  archive: Uint8Array,
  listing: ZipListing,
  inflateRawSync: (data: Uint8Array) => Uint8Array,
  limits: ZipLimits = DEFAULT_LIMITS
): Uint8Array | ZipError {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  if (listing.offset + 30 > archive.length) return fail('corrupt', `The data for "${listing.path}" is not in the file.`)
  if (view.getUint32(listing.offset, true) !== 0x04034b50) return fail('corrupt', `The data for "${listing.path}" does not begin with an entry header.`)

  const nameLength = view.getUint16(listing.offset + 26, true)
  const extraLength = view.getUint16(listing.offset + 28, true)
  const dataAt = listing.offset + 30 + nameLength + extraLength
  if (dataAt + listing.compressed > archive.length) return fail('truncated', `The data for "${listing.path}" runs past the end of the file.`)

  const payload = archive.subarray(dataAt, dataAt + listing.compressed)

  let out: Uint8Array
  if (listing.method === METHOD_STORE) out = payload
  else {
    try {
      out = inflateRawSync(payload)
    } catch (err) {
      return fail('corrupt', `The data for "${listing.path}" could not be decompressed: ${err instanceof Error ? err.message : 'unknown reason'}.`)
    }
  }

  // The size that actually arrived, against the size the header claimed. The claim is not evidence.
  if (out.length > limits.entryBytes) return fail('too-large', `"${listing.path}" inflated to ${out.length.toLocaleString('en')} bytes, past the limit for one entry.`)
  if (out.length !== listing.size) {
    return fail('corrupt', `"${listing.path}" inflated to ${out.length.toLocaleString('en')} bytes where the archive said ${listing.size.toLocaleString('en')}.`)
  }
  if ((crc32(out) >>> 0) !== listing.crc) return fail('corrupt', `"${listing.path}" does not match its checksum, so its contents have changed since the archive was made.`)

  return out
}

/** The assumptions this container rests on, shown rather than implied. */
export const ZIP_ASSUMPTIONS: readonly string[] = Object.freeze([
  'An archive is untrusted input. Every path is checked while the table of contents is read, before any bytes are extracted.',
  'A hostile path is refused, never repaired: sanitising one produces a path that is safe and is not the one the package refers to.',
  'A backslash is refused outright, because it separates directories on some systems and is an ordinary character to the format.',
  'The size in a header is a claim. It is used to refuse early and never to trust; the real size is what arrives.',
  'Every entry\u2019s checksum is verified after inflation, so contents swapped after packaging are caught.',
  'Two entries at one path are refused, because otherwise the extraction order decides which survives.',
  'A decompression ratio limit applies above a floor, so a small file that expands a lot is not mistaken for an attack.',
  'Nothing is encrypted at this layer: ZIP\u2019s own encryption is weak, and the package seals its payload above this with the same path the Secrets Vault uses.',
  'No symbolic link, permission or ownership is written or read. Those describe the machine the package came from, which is what must not travel.'
])
