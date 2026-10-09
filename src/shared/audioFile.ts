/**
 * Reading an audio file: what kind it is, what it says about itself, and how long it is.
 *
 * Written out rather than taken from a library, for two reasons. The licences Orbis may use are narrow, and most tag
 * readers are not in them. And more importantly, every number here has to be read out of the file: a length that was
 * guessed from the file size and a bitrate is wrong for every variable-bitrate file ever made, and a length Orbis is
 * unsure of must come back as "I do not know" rather than as a number somebody will see on a progress bar.
 *
 * Four kinds of file are read, which between them cover what a person is likely to have:
 *
 * - **MP3** -- ID3v2 tags at the front, and a length from the Xing/Info or VBRI header when the encoder left one, or
 *   from counting frames when it did not. Never from the file size.
 * - **MP4 / M4A / AAC** -- `moov/mvhd` for the length (a count of units and the units per second, so it is exact) and
 *   the `ilst` tags iTunes writes.
 * - **FLAC** -- STREAMINFO carries the sample count and the rate, which is the length to the sample. Vorbis comments
 *   for the names, and a PICTURE block for the artwork.
 * - **OGG / Opus** -- the comment header for the names, and the last page's granule position for the length.
 *
 * Nothing here trusts the file's name. A `.mp3` holding an MP4 is read as an MP4, and a file holding neither comes
 * back as unsupported -- which is the honest answer and the one that stops a broken file being added as a healthy
 * track.
 */

export type AudioKind = 'mp3' | 'mp4' | 'flac' | 'ogg' | 'wav' | 'unknown'

export interface AudioTags {
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  genre?: string
  year?: number
  trackNumber?: number
  discNumber?: number
}

export interface AudioArtwork {
  /** The picture's own bytes, exactly as the file holds them. */
  bytes: Uint8Array
  mime: string
}

export interface AudioFacts {
  kind: AudioKind
  /** Seconds, read from the file. Null when the file does not say and it cannot be counted. */
  duration: number | null
  tags: AudioTags
  artwork: AudioArtwork | null
  /** What could not be read, when something could not. For showing, not for guessing with. */
  problem?: string
}

// ---------------------------------------------------------------- reading bytes

const ascii = (bytes: Uint8Array, at: number, length: number): string => {
  let out = ''
  for (let i = at; i < at + length && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i])
  return out
}

const be32 = (b: Uint8Array, at: number): number => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
const be24 = (b: Uint8Array, at: number): number => (b[at] << 16) | (b[at + 1] << 8) | b[at + 2]
const be16 = (b: Uint8Array, at: number): number => (b[at] << 8) | b[at + 1]
const le32 = (b: Uint8Array, at: number): number => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
const be64 = (b: Uint8Array, at: number): number => be32(b, at) * 2 ** 32 + be32(b, at + 4)
const le64 = (b: Uint8Array, at: number): number => le32(b, at) + le32(b, at + 4) * 2 ** 32

const utf8 = (bytes: Uint8Array): string => new TextDecoder('utf-8', { fatal: false }).decode(bytes)
const utf16 = (bytes: Uint8Array): string => new TextDecoder('utf-16', { fatal: false }).decode(bytes)
const latin1 = (bytes: Uint8Array): string => new TextDecoder('latin1', { fatal: false }).decode(bytes)

/** Tidies a tag: no stray zero bytes, no surrounding space, and nothing absurdly long. */
const tidy = (text: string): string | undefined => {
  const out = text.replace(/\u0000+$/g, '').replace(/\u0000/g, ' ').trim()
  return out && out.length <= 400 ? out : undefined
}

/** "3/12" and "3" both mean three. */
const firstNumber = (text: string | undefined): number | undefined => {
  if (!text) return undefined
  const found = /^(\d{1,4})/.exec(text.trim())
  const n = found ? Number(found[1]) : NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** A year out of a date, however the file writes it. */
const year = (text: string | undefined): number | undefined => {
  if (!text) return undefined
  const found = /(\d{4})/.exec(text)
  const n = found ? Number(found[1]) : NaN
  return n >= 1877 && n <= 2200 ? n : undefined
}

// ---------------------------------------------------------------- which kind of file this is

/** What the bytes say the file is. The name is never consulted. */
export function sniff(bytes: Uint8Array): AudioKind {
  if (bytes.length < 12) return 'unknown'
  if (ascii(bytes, 0, 4) === 'fLaC') return 'flac'
  if (ascii(bytes, 0, 4) === 'OggS') return 'ogg'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'wav'
  if (ascii(bytes, 4, 4) === 'ftyp') return 'mp4'
  if (ascii(bytes, 0, 3) === 'ID3') {
    // An ID3 tag can sit in front of anything. What follows it decides.
    const after = id3End(bytes)
    if (after < bytes.length - 12) {
      const inner = sniff(bytes.subarray(after))
      if (inner !== 'unknown') return inner
    }
    return 'mp3'
  }
  // A bare MP3 frame: eleven set bits, and a layer and version that exist.
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x18) !== 0x08 && (bytes[1] & 0x06) !== 0) return 'mp3'
  return 'unknown'
}

/** Where an ID3v2 tag at the front of a file ends. */
function id3End(bytes: Uint8Array): number {
  if (ascii(bytes, 0, 3) !== 'ID3' || bytes.length < 10) return 0
  // A synch-safe size: seven bits per byte, so the size can never look like a frame header.
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f)
  const footer = (bytes[5] & 0x10) !== 0 ? 10 : 0
  return 10 + size + footer
}

// ---------------------------------------------------------------- ID3v2 (MP3)

const ID3_FIELDS: Record<string, keyof AudioTags> = {
  TIT2: 'title',
  TT2: 'title',
  TPE1: 'artist',
  TP1: 'artist',
  TALB: 'album',
  TAL: 'album',
  TPE2: 'albumArtist',
  TP2: 'albumArtist',
  TCON: 'genre',
  TCO: 'genre',
  TRCK: 'trackNumber',
  TRK: 'trackNumber',
  TPOS: 'discNumber',
  TPA: 'discNumber',
  TYER: 'year',
  TYE: 'year',
  TDRC: 'year',
  TDRL: 'year'
}

/** The text of an ID3 text frame, in whichever of the four encodings it used. */
function id3Text(body: Uint8Array): string {
  if (body.length === 0) return ''
  const encoding = body[0]
  const rest = body.subarray(1)
  if (encoding === 0) return latin1(rest)
  if (encoding === 1 || encoding === 2) return utf16(rest)
  return utf8(rest)
}

function readId3(bytes: Uint8Array): { tags: AudioTags; artwork: AudioArtwork | null } {
  const tags: AudioTags = {}
  let artwork: AudioArtwork | null = null
  if (ascii(bytes, 0, 3) !== 'ID3' || bytes.length < 10) return { tags, artwork }
  const version = bytes[3]
  const end = Math.min(id3End(bytes), bytes.length)
  // Version 2.2 uses three-letter names and three-byte sizes; 2.3 and 2.4 use four of each.
  const nameLength = version <= 2 ? 3 : 4
  const headerLength = version <= 2 ? 6 : 10
  let at = 10
  while (at + headerLength <= end) {
    const name = ascii(bytes, at, nameLength)
    if (!/^[A-Z0-9]{3,4}$/.test(name)) break
    const size =
      version <= 2
        ? be24(bytes, at + 3)
        : version === 4
          ? // 2.4 sizes are synch-safe as well. Some encoders get this wrong, so a size that overruns is read the
            // other way before giving up.
            (() => {
              const safe = ((bytes[at + 4] & 0x7f) << 21) | ((bytes[at + 5] & 0x7f) << 14) | ((bytes[at + 6] & 0x7f) << 7) | (bytes[at + 7] & 0x7f)
              const plain = be32(bytes, at + 4)
              return at + headerLength + safe <= end ? safe : plain
            })()
          : be32(bytes, at + 4)
    if (size <= 0 || at + headerLength + size > end) break
    const body = bytes.subarray(at + headerLength, at + headerLength + size)
    const field = ID3_FIELDS[name]
    if (field) {
      const text = tidy(id3Text(body))
      if (text) {
        if (field === 'year') tags.year = year(text)
        else if (field === 'trackNumber') tags.trackNumber = firstNumber(text)
        else if (field === 'discNumber') tags.discNumber = firstNumber(text)
        else tags[field] = text as never
      }
    } else if ((name === 'APIC' || name === 'PIC') && !artwork) {
      artwork = readApic(body, name === 'PIC')
    }
    at += headerLength + size
  }
  return { tags, artwork }
}

/** A picture out of an APIC frame. */
function readApic(body: Uint8Array, old: boolean): AudioArtwork | null {
  if (body.length < 5) return null
  let at = 1
  let mime: string
  if (old) {
    // 2.2 writes a three-letter kind ("JPG") rather than a media type.
    const kind = ascii(body, at, 3).toLowerCase()
    mime = kind === 'png' ? 'image/png' : 'image/jpeg'
    at += 3
  } else {
    const end = body.indexOf(0, at)
    if (end < 0) return null
    mime = ascii(body, at, end - at) || 'image/jpeg'
    at = end + 1
  }
  at += 1 // the picture's kind: front cover, back cover and so on
  // Then a description, ending in a zero byte -- two of them when the text is UTF-16.
  const wide = body[0] === 1 || body[0] === 2
  if (wide) {
    while (at + 1 < body.length && !(body[at] === 0 && body[at + 1] === 0)) at += 2
    at += 2
  } else {
    while (at < body.length && body[at] !== 0) at += 1
    at += 1
  }
  if (at >= body.length) return null
  return { bytes: body.subarray(at), mime }
}

// ---------------------------------------------------------------- how long an MP3 is

const MPEG_RATES = [
  // Layer III, MPEG 1 then MPEG 2/2.5, in thousands of bits per second.
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
]
const MPEG_SAMPLE_RATES = [
  [44100, 48000, 32000],
  [22050, 24000, 16000],
  [11025, 12000, 8000]
]

interface Frame {
  samples: number
  sampleRate: number
  bytes: number
  offset: number
  version: number
  channels: number
}

/** One MPEG audio frame at this position, or null when there is not one. */
function frameAt(bytes: Uint8Array, at: number): Frame | null {
  if (at + 4 > bytes.length) return null
  if (bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null
  const versionBits = (bytes[at + 1] >> 3) & 0x03
  if (versionBits === 1) return null
  const layer = (bytes[at + 1] >> 1) & 0x03
  if (layer === 0) return null
  const rateIndex = (bytes[at + 2] >> 4) & 0x0f
  const sampleIndex = (bytes[at + 2] >> 2) & 0x03
  if (rateIndex === 0 || rateIndex === 15 || sampleIndex === 3) return null
  const mpeg2 = versionBits !== 3
  const bitrate = MPEG_RATES[mpeg2 ? 1 : 0][rateIndex] * 1000
  const sampleRate = MPEG_SAMPLE_RATES[versionBits === 3 ? 0 : versionBits === 2 ? 1 : 2][sampleIndex]
  if (!bitrate || !sampleRate) return null
  const padding = (bytes[at + 2] >> 1) & 0x01
  const samples = layer === 3 ? 384 : layer === 2 ? 1152 : mpeg2 ? 576 : 1152
  const size = layer === 3 ? Math.floor((12 * bitrate) / sampleRate + padding) * 4 : Math.floor((samples / 8) * (bitrate / sampleRate)) + padding
  if (size < 4) return null
  const channels = ((bytes[at + 3] >> 6) & 0x03) === 3 ? 1 : 2
  return { samples, sampleRate, bytes: size, offset: at, version: versionBits, channels }
}

/**
 * How long an MP3 is.
 *
 * The encoder usually writes the answer into the first frame -- a Xing, Info or VBRI header with the number of frames
 * in it -- and that is exact. Without one, the frames are counted. Either way the number comes from the audio. The
 * usual shortcut, file size divided by bitrate, is wrong by minutes on a variable-bitrate file, so it is not used.
 */
function mp3Duration(bytes: Uint8Array, from: number): number | null {
  let at = from
  // Find the first real frame: some files have rubbish between the tag and the audio.
  for (let tries = 0; tries < 8192 && at < bytes.length - 4; tries += 1) {
    const frame = frameAt(bytes, at)
    if (frame) break
    at += 1
  }
  const first = frameAt(bytes, at)
  if (!first) return null

  const perFrame = first.samples / first.sampleRate
  // Xing/Info sits after the side information; VBRI always 32 bytes in.
  const sideInfo = first.version === 3 ? (first.channels === 1 ? 17 : 32) : first.channels === 1 ? 9 : 17
  for (const [tag, offset] of [
    ['Xing', 4 + sideInfo],
    ['Info', 4 + sideInfo],
    ['VBRI', 36]
  ] as const) {
    const mark = at + offset
    if (mark + 12 > bytes.length || ascii(bytes, mark, 4) !== tag) continue
    if (tag === 'VBRI') {
      const frames = be32(bytes, mark + 14)
      if (frames > 0) return frames * perFrame
      continue
    }
    const flags = be32(bytes, mark + 4)
    if ((flags & 1) === 0) continue
    const frames = be32(bytes, mark + 8)
    if (frames > 0) return frames * perFrame
  }

  // No header: count them. Bounded, because a file that is mostly not audio should not be walked for ever.
  let seconds = 0
  let frames = 0
  while (at + 4 <= bytes.length && frames < 2_000_000) {
    const frame = frameAt(bytes, at)
    if (!frame) {
      at += 1
      continue
    }
    seconds += frame.samples / frame.sampleRate
    frames += 1
    at += frame.bytes
  }
  return frames > 0 ? seconds : null
}

// ---------------------------------------------------------------- MP4 / M4A

const MP4_FIELDS: Record<string, keyof AudioTags> = {
  '©nam': 'title',
  '©ART': 'artist',
  '©alb': 'album',
  aART: 'albumArtist',
  '©gen': 'genre',
  '©day': 'year',
  trkn: 'trackNumber',
  disk: 'discNumber'
}

interface Box {
  type: string
  start: number
  end: number
}

/** The boxes directly inside this range. MP4 is boxes all the way down. */
function boxes(bytes: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = []
  let at = from
  while (at + 8 <= to) {
    let size = be32(bytes, at)
    const type = ascii(bytes, at + 4, 4)
    let head = 8
    if (size === 1) {
      if (at + 16 > to) break
      size = be64(bytes, at + 8)
      head = 16
    } else if (size === 0) {
      size = to - at
    }
    if (size < head || at + size > to) {
      // A box that claims more than there is: the file is cut short. What was read is still good.
      out.push({ type, start: at + head, end: to })
      break
    }
    out.push({ type, start: at + head, end: at + size })
    at += size
  }
  return out
}

const findBox = (within: Box[], type: string): Box | undefined => within.find((box) => box.type === type)

function readMp4(bytes: Uint8Array): { tags: AudioTags; artwork: AudioArtwork | null; duration: number | null } {
  const tags: AudioTags = {}
  let artwork: AudioArtwork | null = null
  let duration: number | null = null

  const top = boxes(bytes, 0, bytes.length)
  const moov = findBox(top, 'moov')
  if (!moov) return { tags, artwork, duration }
  const inMoov = boxes(bytes, moov.start, moov.end)

  const mvhd = findBox(inMoov, 'mvhd')
  if (mvhd) {
    const version = bytes[mvhd.start]
    // A count of time units and how many of them make a second: exact, not a rounded number of seconds.
    const scale = version === 1 ? be32(bytes, mvhd.start + 20) : be32(bytes, mvhd.start + 12)
    const units = version === 1 ? be64(bytes, mvhd.start + 24) : be32(bytes, mvhd.start + 16)
    if (scale > 0 && units > 0) duration = units / scale
  }

  const udta = findBox(inMoov, 'udta')
  const meta = udta ? findBox(boxes(bytes, udta.start, udta.end), 'meta') : undefined
  if (meta) {
    // `meta` has four bytes of version and flags before its children.
    const ilst = findBox(boxes(bytes, meta.start + 4, meta.end), 'ilst')
    if (ilst) {
      for (const item of boxes(bytes, ilst.start, ilst.end)) {
        const data = findBox(boxes(bytes, item.start, item.end), 'data')
        if (!data) continue
        // Eight bytes of kind and locale, then the value.
        const kind = be32(bytes, data.start) & 0xffffff
        const body = bytes.subarray(data.start + 8, data.end)
        if (item.type === 'covr') {
          if (!artwork && body.length > 0) artwork = { bytes: body, mime: kind === 13 ? 'image/jpeg' : kind === 14 ? 'image/png' : 'image/jpeg' }
          continue
        }
        const field = MP4_FIELDS[item.type]
        if (!field) continue
        if (field === 'trackNumber' || field === 'discNumber') {
          // Two numbers: which one, and how many altogether.
          if (body.length >= 4) {
            const which = be16(body, 2)
            if (which > 0) tags[field] = which
          }
          continue
        }
        const text = tidy(utf8(body))
        if (!text) continue
        if (field === 'year') tags.year = year(text)
        else tags[field] = text as never
      }
    }
  }
  return { tags, artwork, duration }
}

// ---------------------------------------------------------------- FLAC

const VORBIS_FIELDS: Record<string, keyof AudioTags> = {
  TITLE: 'title',
  ARTIST: 'artist',
  ALBUM: 'album',
  ALBUMARTIST: 'albumArtist',
  GENRE: 'genre',
  DATE: 'year',
  YEAR: 'year',
  TRACKNUMBER: 'trackNumber',
  DISCNUMBER: 'discNumber'
}

/** Vorbis comments: a count, then "NAME=value" strings with their own lengths. Used by FLAC and by OGG. */
function readVorbisComments(bytes: Uint8Array, from: number, to: number): AudioTags {
  const tags: AudioTags = {}
  let at = from
  if (at + 4 > to) return tags
  const vendor = le32(bytes, at)
  at += 4 + vendor
  if (at + 4 > to) return tags
  const count = le32(bytes, at)
  at += 4
  for (let i = 0; i < count && at + 4 <= to; i += 1) {
    const length = le32(bytes, at)
    at += 4
    if (length < 0 || at + length > to) break
    const line = utf8(bytes.subarray(at, at + length))
    at += length
    const split = line.indexOf('=')
    if (split <= 0) continue
    const field = VORBIS_FIELDS[line.slice(0, split).toUpperCase()]
    if (!field) continue
    const text = tidy(line.slice(split + 1))
    if (!text) continue
    if (field === 'year') tags.year = year(text)
    else if (field === 'trackNumber') tags.trackNumber = firstNumber(text)
    else if (field === 'discNumber') tags.discNumber = firstNumber(text)
    else tags[field] = text as never
  }
  return tags
}

function readFlac(bytes: Uint8Array): { tags: AudioTags; artwork: AudioArtwork | null; duration: number | null } {
  let tags: AudioTags = {}
  let artwork: AudioArtwork | null = null
  let duration: number | null = null
  let at = 4
  for (let blocks = 0; blocks < 256 && at + 4 <= bytes.length; blocks += 1) {
    const last = (bytes[at] & 0x80) !== 0
    const type = bytes[at] & 0x7f
    const size = be24(bytes, at + 1)
    const start = at + 4
    const end = Math.min(start + size, bytes.length)
    if (type === 0 && end - start >= 18) {
      // STREAMINFO: twenty bits of sample rate and thirty-six of total samples. Exact to the sample.
      const rate = (bytes[start + 10] << 12) | (bytes[start + 11] << 4) | (bytes[start + 12] >> 4)
      const samples = (bytes[start + 13] & 0x0f) * 2 ** 32 + be32(bytes, start + 14)
      if (rate > 0 && samples > 0) duration = samples / rate
    } else if (type === 4) {
      tags = { ...readVorbisComments(bytes, start, end), ...tags }
    } else if (type === 6 && !artwork && end - start > 32) {
      // PICTURE: a kind, then a media type and a description with their own lengths, then the picture.
      let p = start + 4
      const mimeLength = be32(bytes, p)
      p += 4
      const mime = ascii(bytes, p, mimeLength) || 'image/jpeg'
      p += mimeLength
      const descriptionLength = be32(bytes, p)
      p += 4 + descriptionLength
      p += 16 // width, height, depth, colours
      const dataLength = be32(bytes, p)
      p += 4
      if (dataLength > 0 && p + dataLength <= end) artwork = { bytes: bytes.subarray(p, p + dataLength), mime }
    }
    at = end
    if (last) break
  }
  return { tags, artwork, duration }
}

// ---------------------------------------------------------------- OGG / Opus

function readOgg(bytes: Uint8Array): { tags: AudioTags; artwork: AudioArtwork | null; duration: number | null } {
  let tags: AudioTags = {}
  let duration: number | null = null
  let rate = 0
  let lastGranule = 0
  let at = 0
  // Pages: "OggS", then the granule position, then the segment table that says how long the page is.
  for (let pages = 0; pages < 20_000 && at + 27 <= bytes.length; pages += 1) {
    if (ascii(bytes, at, 4) !== 'OggS') break
    const granule = le64(bytes, at + 6)
    const segments = bytes[at + 26]
    const tableEnd = at + 27 + segments
    if (tableEnd > bytes.length) break
    let bodyLength = 0
    for (let i = 0; i < segments; i += 1) bodyLength += bytes[tableEnd - segments + i]
    const body = bytes.subarray(tableEnd, Math.min(tableEnd + bodyLength, bytes.length))
    if (granule > 0 && granule < Number.MAX_SAFE_INTEGER) lastGranule = granule

    if (body.length > 8) {
      if (ascii(body, 0, 5) === '\u0001vorb') {
        rate = le32(body, 12)
      } else if (ascii(body, 0, 8) === 'OpusHead') {
        // Opus granules are always counted at 48 kHz, whatever the file was encoded at.
        rate = 48000
      } else if (ascii(body, 0, 7) === '\u0003vorbis') {
        tags = { ...readVorbisComments(body, 7, body.length), ...tags }
      } else if (ascii(body, 0, 8) === 'OpusTags') {
        tags = { ...readVorbisComments(body, 8, body.length), ...tags }
      }
    }
    at = tableEnd + bodyLength
  }
  if (rate > 0 && lastGranule > 0) duration = lastGranule / rate
  return { tags, artwork: null, duration }
}

// ---------------------------------------------------------------- WAV

function readWav(bytes: Uint8Array): { tags: AudioTags; artwork: AudioArtwork | null; duration: number | null } {
  let duration: number | null = null
  let byteRate = 0
  let at = 12
  while (at + 8 <= bytes.length) {
    const type = ascii(bytes, at, 4)
    const size = le32(bytes, at + 4)
    const start = at + 8
    if (type === 'fmt ' && start + 16 <= bytes.length) byteRate = le32(bytes, start + 8)
    // The data chunk's own length divided by the bytes per second: exact for uncompressed audio.
    if (type === 'data' && byteRate > 0) duration = Math.min(size, bytes.length - start) / byteRate
    if (size <= 0) break
    at = start + size + (size % 2)
  }
  return { tags: {}, artwork: null, duration }
}

// ---------------------------------------------------------------- everything, together

/**
 * Everything the file says about itself.
 *
 * Never throws: a file that is damaged half way through gives back what was read before the damage, and says what
 * went wrong. A duration of null means the file did not say -- which is shown as a blank, never as zero and never as
 * a number worked out from the file's size.
 */
export function readAudioFacts(bytes: Uint8Array): AudioFacts {
  const kind = sniff(bytes)
  try {
    switch (kind) {
      case 'mp3': {
        const { tags, artwork } = readId3(bytes)
        const duration = mp3Duration(bytes, id3End(bytes))
        return { kind, duration, tags, artwork, problem: duration === null ? 'The length of this file could not be read.' : undefined }
      }
      case 'mp4': {
        const { tags, artwork, duration } = readMp4(bytes)
        return { kind, duration, tags, artwork }
      }
      case 'flac': {
        const { tags, artwork, duration } = readFlac(bytes)
        return { kind, duration, tags, artwork }
      }
      case 'ogg': {
        const { tags, artwork, duration } = readOgg(bytes)
        return { kind, duration, tags, artwork }
      }
      case 'wav': {
        const { tags, artwork, duration } = readWav(bytes)
        return { kind, duration, tags, artwork }
      }
      default:
        return { kind: 'unknown', duration: null, tags: {}, artwork: null, problem: 'This is not an audio file Orbis can read.' }
    }
  } catch (err) {
    // Whatever was understood before it went wrong is still worth having; the rest is said plainly.
    return { kind, duration: null, tags: {}, artwork: null, problem: `This file could not be read fully: ${err instanceof Error ? err.message : 'it is damaged'}.` }
  }
}

/** The endings Orbis offers in a file picker. The bytes still decide what a file actually is. */
export const AUDIO_ENDINGS = ['mp3', 'm4a', 'mp4', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'wave'] as const

/** Whether this computer's browser engine can be expected to play this kind. FLAC and Opus are read either way. */
export const PLAYABLE_KINDS: readonly AudioKind[] = ['mp3', 'mp4', 'flac', 'ogg', 'wav']
