import { hashOf, type VerifyResult } from '../compute/interchange.ts'
import { safeName } from './naming.ts'

/**
 * A picture, a sound or a video, read from its own first bytes.
 *
 * These three kinds are unlike every other thing Create keeps. A table, a document, a chart and a code file have a
 * model behind them: the stored file is written out of that model, and can be written again. A picture has no model.
 * The bytes *are* the artifact. So the rule here is the opposite of the rule everywhere else: the file is kept exactly
 * as it arrived, byte for byte, and Orbis never re-encodes it, re-sizes it, converts it or writes it out of anything.
 *
 * What is read is only what the container says about itself in its own header -- how wide a picture is, how long a
 * recording is -- which is a few hundred bytes of arithmetic and no decoding at all. Nothing is decoded, played,
 * transcoded, uploaded or handed to another program. An animated GIF, a multi-page TIFF-like WebP, a video with five
 * audio tracks: each is kept as it is, and the note says that is what happened.
 *
 * When the header does not say, the answer is `null` and a note saying the length or the size is not known. A length
 * worked out from an average bitrate would be a guess, and a guess shown as a fact is the failure this engine exists
 * to avoid. An extension is never trusted on its own either: a file called `holiday.png` whose bytes are a JPEG is
 * refused, by name, rather than kept under a lie.
 *
 * SVG is deliberately not here. It is markup -- text with tags -- and Orbis already keeps its own drawings as SVG from
 * a model it can redraw. An SVG someone opens is a document-shaped thing, not an opaque picture file, and keeping it
 * as one would mean running an unread file's markup through a picture path. It is refused with that said.
 *
 * Pure: bytes in, facts out. No Electron, no `fs`, no `Buffer`.
 */

// ---------------------------------------------------------------- what there is

export type MediaKindId = 'image' | 'audio' | 'video'

export type MediaFormatId =
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'bmp'
  | 'mp3'
  | 'wav'
  | 'ogg'
  | 'flac'
  | 'm4a'
  | 'aac'
  | 'mp4'
  | 'webm'
  | 'mov'

/**
 * The container families the signature reader can tell apart. Several of them hold more than one format: an MP4 box
 * tree is an MP4, a QuickTime film or an M4A depending on its tracks, and EBML is a WebM or a Matroska.
 */
export type MediaFamily = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'mp3' | 'wav' | 'flac' | 'aac' | 'ogg' | 'mp4' | 'ebml' | 'svg'

export interface MediaFormat {
  id: MediaFormatId
  /** What the format is called in one or two words, with the kind word added when it is shown. */
  label: string
  /** The kind a file of this format usually is. A container that can hold either is settled by its tracks. */
  kind: MediaKindId
  /** Every extension a file of this format is normally called. The first is the one a saved copy gets. */
  extensions: readonly string[]
  mediaType: string
  /** What Orbis can read out of this container without decoding it, in plain words. */
  reads: readonly string[]
}

export const MEDIA_FORMATS: Readonly<Record<MediaFormatId, MediaFormat>> = Object.freeze({
  png: Object.freeze({ id: 'png', label: 'PNG', kind: 'image', extensions: Object.freeze(['.png']), mediaType: 'image/png', reads: Object.freeze(['width and height, from its header']) }),
  jpeg: Object.freeze({ id: 'jpeg', label: 'JPEG', kind: 'image', extensions: Object.freeze(['.jpg', '.jpeg', '.jpe', '.jfif']), mediaType: 'image/jpeg', reads: Object.freeze(['width and height, from the frame header']) }),
  gif: Object.freeze({ id: 'gif', label: 'GIF', kind: 'image', extensions: Object.freeze(['.gif']), mediaType: 'image/gif', reads: Object.freeze(['width and height, from its header']) }),
  webp: Object.freeze({ id: 'webp', label: 'WebP', kind: 'image', extensions: Object.freeze(['.webp']), mediaType: 'image/webp', reads: Object.freeze(['width and height, from its VP8, VP8L or VP8X header']) }),
  bmp: Object.freeze({ id: 'bmp', label: 'BMP', kind: 'image', extensions: Object.freeze(['.bmp', '.dib']), mediaType: 'image/bmp', reads: Object.freeze(['width and height, from its info header']) }),
  mp3: Object.freeze({ id: 'mp3', label: 'MP3', kind: 'audio', extensions: Object.freeze(['.mp3']), mediaType: 'audio/mpeg', reads: Object.freeze(['length, when the file counts its own frames or every frame is the same size']) }),
  wav: Object.freeze({ id: 'wav', label: 'WAV', kind: 'audio', extensions: Object.freeze(['.wav', '.wave']), mediaType: 'audio/wav', reads: Object.freeze(['length, from the size of its sound and its rate']) }),
  ogg: Object.freeze({ id: 'ogg', label: 'Ogg', kind: 'audio', extensions: Object.freeze(['.ogg', '.oga', '.opus']), mediaType: 'audio/ogg', reads: Object.freeze(['length, from the position stamped on its last page']) }),
  flac: Object.freeze({ id: 'flac', label: 'FLAC', kind: 'audio', extensions: Object.freeze(['.flac']), mediaType: 'audio/flac', reads: Object.freeze(['length, from the number of samples it declares']) }),
  m4a: Object.freeze({ id: 'm4a', label: 'M4A', kind: 'audio', extensions: Object.freeze(['.m4a', '.m4b']), mediaType: 'audio/mp4', reads: Object.freeze(['length, from the movie header']) }),
  aac: Object.freeze({ id: 'aac', label: 'AAC', kind: 'audio', extensions: Object.freeze(['.aac']), mediaType: 'audio/aac', reads: Object.freeze(['length, by counting its frames when there are not too many']) }),
  mp4: Object.freeze({ id: 'mp4', label: 'MP4', kind: 'video', extensions: Object.freeze(['.mp4', '.m4v']), mediaType: 'video/mp4', reads: Object.freeze(['length, from the movie header', 'width and height, from the picture track']) }),
  webm: Object.freeze({ id: 'webm', label: 'WebM', kind: 'video', extensions: Object.freeze(['.webm']), mediaType: 'video/webm', reads: Object.freeze(['length, when the file declares one', 'width and height, from the picture track']) }),
  mov: Object.freeze({ id: 'mov', label: 'QuickTime', kind: 'video', extensions: Object.freeze(['.mov', '.qt']), mediaType: 'video/quicktime', reads: Object.freeze(['length, from the movie header', 'width and height, from the picture track']) })
})

export const MEDIA_FORMAT_IDS: readonly MediaFormatId[] = Object.freeze(Object.keys(MEDIA_FORMATS) as MediaFormatId[])

/**
 * The ceilings, and why each one is where it is.
 *
 * The byte ceilings sit under the 50 MB one file the person opens may be (`IMPORT_LIMITS.bytes` in
 * src/main/artifacts/importing.ts), so the open path refuses a huge file before this module ever sees it and the two
 * limits cannot disagree about the same file. They are well under the 200 MB a dictation recording may be
 * (`MAX_AUDIO_BYTES` in src/shared/voiceInput.ts): that is a recording being transcribed and thrown away, and this is
 * a file kept forever, copied again for every version.
 *
 * The dimension ceilings are not about pictures that exist; they are about headers that lie. A header claiming
 * 2,000,000 x 2,000,000 is a damaged or hostile file, and the honest answer is to say so rather than to pass the
 * number on. The length ceiling is the same thing for time.
 */
export const MEDIA_LIMITS = Object.freeze({
  image: Object.freeze({ bytes: 32 * 1024 * 1024, width: 30_000, height: 30_000, pixels: 200_000_000 }),
  audio: Object.freeze({ bytes: 48 * 1024 * 1024, durationMs: 24 * 60 * 60 * 1000 }),
  video: Object.freeze({ bytes: 48 * 1024 * 1024, width: 16_384, height: 16_384, durationMs: 24 * 60 * 60 * 1000 }),
  /** The most a picture may be before the card shows words instead of the picture. Nothing larger crosses to a window. */
  previewBytes: 512 * 1024,
  /** How many bytes of the start are kept as the signature, and compared again after writing. */
  signatureBytes: 16,
  /** Ceilings on the reading itself, so a damaged file cannot make the reader walk forever. */
  boxes: 4000,
  elements: 8000,
  frames: 300_000,
  /** How far back from the end the last Ogg page is looked for. */
  tailBytes: 262_144
})

/** What each kind is called and what it is, for the kinds table, the card and the model's instructions. */
export const MEDIA_KIND_WORDS: Readonly<Record<MediaKindId, { name: string; describe: string; word: string }>> = Object.freeze({
  image: Object.freeze({
    name: 'Picture',
    word: 'picture',
    describe: 'A picture kept exactly as its file is -- PNG, JPEG, GIF, WebP or BMP. Orbis reads its size from the file itself, never re-encodes it, and cannot change it by sentence.'
  }),
  audio: Object.freeze({
    name: 'Sound',
    word: 'sound',
    describe: 'A sound file kept exactly as it is -- MP3, WAV, Ogg, FLAC, M4A or AAC. Orbis reads its length from the file itself when the file says, never plays or converts it, and cannot change it by sentence.'
  }),
  video: Object.freeze({
    name: 'Video',
    word: 'video',
    describe: 'A video kept exactly as it is -- MP4, WebM or QuickTime. Orbis reads its size and length from the file itself when the file says, never plays or converts it, and cannot change it by sentence.'
  })
})

export const MEDIA_KIND_IDS: readonly MediaKindId[] = Object.freeze(['image', 'audio', 'video'])

export const isMediaKindId = (value: unknown): value is MediaKindId =>
  value === 'image' || value === 'audio' || value === 'video'

/** Every extension this module knows, and the family its bytes must be in. The cross-check between name and bytes. */
export const MEDIA_EXTENSIONS: Readonly<Record<string, MediaFamily>> = Object.freeze({
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.jpe': 'jpeg',
  '.jfif': 'jpeg',
  '.gif': 'gif',
  '.webp': 'webp',
  '.bmp': 'bmp',
  '.dib': 'bmp',
  '.mp3': 'mp3',
  '.wav': 'wav',
  '.wave': 'wav',
  '.flac': 'flac',
  '.aac': 'aac',
  '.ogg': 'ogg',
  '.oga': 'ogg',
  '.opus': 'ogg',
  '.mp4': 'mp4',
  '.m4v': 'mp4',
  '.m4a': 'mp4',
  '.m4b': 'mp4',
  '.mov': 'mp4',
  '.qt': 'mp4',
  '.webm': 'ebml',
  '.mkv': 'ebml',
  '.svg': 'svg'
})

// ---------------------------------------------------------------- the answer, and the refusals

export interface MediaFacts {
  kind: MediaKindId
  format: MediaFormatId
  /** The type the stored bytes are, for saving them and for an <img> that is handed them. */
  mediaType: string
  bytes: number
  /** The same content hash every other artifact uses. Short, stable, not a signature (see interchange.ts). */
  hash: string
  /** The first bytes as hex: what "it still begins the way one of these begins" is checked against. */
  signature: string
  width: number | null
  height: number | null
  durationMs: number | null
  /** What was read and what was not, in plain words. Kept with the artifact. */
  notes: readonly string[]
}

export type MediaProblem = 'not-media' | 'too-large' | 'damaged' | 'mismatch'

export interface MediaRefusal {
  error: MediaProblem
  message: string
}

export type MediaOutcome = MediaFacts | MediaRefusal

export const isMediaRefusal = (value: MediaOutcome): value is MediaRefusal =>
  typeof (value as MediaRefusal).error === 'string'

const refuse = (error: MediaProblem, message: string): MediaRefusal => ({ error, message })

/** What a kind's own note always says, so no picture, sound or video is ever kept without it. */
const KEPT_AS_IT_IS: Readonly<Record<MediaKindId, string>> = Object.freeze({
  image: 'Kept exactly as the file was, byte for byte. Orbis did not open the picture, change its size or re-encode it.',
  audio: 'Kept exactly as the file was, byte for byte. Orbis did not play it, convert it or send it anywhere.',
  video: 'Kept exactly as the file was, byte for byte. Orbis did not play it, convert it or send it anywhere.'
})

const LENGTH_UNKNOWN = 'Length not known: this file does not say how long it is, and Orbis does not decode it to find out.'

// ---------------------------------------------------------------- reading bytes

const has = (bytes: Uint8Array, at: number, count: number): boolean => at >= 0 && at + count <= bytes.length

const u16be = (bytes: Uint8Array, at: number): number => (bytes[at] << 8) | bytes[at + 1]
const u16le = (bytes: Uint8Array, at: number): number => bytes[at] | (bytes[at + 1] << 8)
const u24le = (bytes: Uint8Array, at: number): number => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)
const u32be = (bytes: Uint8Array, at: number): number => (bytes[at] * 0x1000000 + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]) >>> 0
const u32le = (bytes: Uint8Array, at: number): number => (bytes[at] + (bytes[at + 1] << 8) + (bytes[at + 2] << 16) + bytes[at + 3] * 0x1000000) >>> 0
const i32le = (bytes: Uint8Array, at: number): number => u32le(bytes, at) | 0
/** Eight bytes as one number. Past 2^53 it stops being exact, which no length or size here ever reaches. */
const u64le = (bytes: Uint8Array, at: number): number => u32le(bytes, at) + u32le(bytes, at + 4) * 4294967296

const ascii = (bytes: Uint8Array, at: number, count: number): string => {
  if (!has(bytes, at, count)) return ''
  let out = ''
  for (let i = 0; i < count; i++) out += String.fromCharCode(bytes[at + i])
  return out
}

const hex = (bytes: Uint8Array, count: number): string => {
  let out = ''
  for (let i = 0; i < Math.min(count, bytes.length); i++) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

/** The first bytes of a file as hex, bounded. What `verifyMedia` compares a file on disk against. */
export const signatureOf = (bytes: Uint8Array): string => hex(bytes, MEDIA_LIMITS.signatureBytes)

/**
 * Which family a file's own bytes put it in, or null.
 *
 * Order matters in two places. RIFF is the container of both WebP and WAV, and only its fourth word says which. And
 * an AAC stream and an MP3 frame both begin with eleven set bits: AAC's layer field is the one MPEG audio reserves,
 * so it is tested first and an MP3 is only an MP3 once that has failed.
 */
export function familyOf(bytes: Uint8Array): MediaFamily | null {
  const b = bytes
  if (b.length < 12) return null
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  const head6 = ascii(b, 0, 6)
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif'
  if (ascii(b, 0, 4) === 'RIFF') {
    const kind = ascii(b, 8, 4)
    if (kind === 'WEBP') return 'webp'
    if (kind === 'WAVE') return 'wav'
    return null
  }
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp'
  if (ascii(b, 0, 4) === 'fLaC') return 'flac'
  if (ascii(b, 0, 4) === 'OggS') return 'ogg'
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'ebml'
  if (ascii(b, 4, 4) === 'ftyp') return 'mp4'
  if (ascii(b, 0, 3) === 'ID3') return 'mp3'
  // A raw stream with no tag in front of it: the first frame's own sync word.
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'aac'
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && ((b[1] >> 1) & 3) !== 0 && ((b[1] >> 3) & 3) !== 1) return 'mp3'
  // Markup, not a picture file. Told apart here so the refusal can say what it is rather than "not a picture".
  const start = ascii(b, 0, Math.min(300, b.length)).trimStart().toLowerCase()
  if (start.startsWith('<svg') || (start.startsWith('<?xml') && start.includes('<svg'))) return 'svg'
  return null
}

// ---------------------------------------------------------------- pictures

const png = (b: Uint8Array): { width: number; height: number } | null => {
  // IHDR is the first chunk of every PNG, by the format's own rule.
  if (!has(b, 24, 0) || ascii(b, 12, 4) !== 'IHDR') return null
  const width = u32be(b, 16)
  const height = u32be(b, 20)
  return width > 0 && height > 0 ? { width, height } : null
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

/** A JPEG's size is in whichever start-of-frame marker comes first; everything before it is skipped by its length. */
const jpeg = (b: Uint8Array): { width: number; height: number } | null => {
  let at = 2
  for (let seen = 0; seen < MEDIA_LIMITS.boxes && has(b, at, 4); seen++) {
    if (b[at] !== 0xff) return null
    const marker = b[at + 1]
    // Fill bytes between markers are allowed, and the standalone markers carry no length.
    if (marker === 0xff) {
      at += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2
      continue
    }
    const length = u16be(b, at + 2)
    if (length < 2) return null
    if (SOF.has(marker)) {
      if (!has(b, at + 9, 0)) return null
      const height = u16be(b, at + 5)
      const width = u16be(b, at + 7)
      return width > 0 && height > 0 ? { width, height } : null
    }
    at += 2 + length
  }
  return null
}

const gif = (b: Uint8Array): { width: number; height: number } | null => {
  const width = u16le(b, 6)
  const height = u16le(b, 8)
  return width > 0 && height > 0 ? { width, height } : null
}

/** WebP keeps its size in whichever of its three headers it was written with. */
const webp = (b: Uint8Array): { width: number; height: number } | null => {
  const chunk = ascii(b, 12, 4)
  if (chunk === 'VP8X' && has(b, 30, 0)) {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
  }
  if (chunk === 'VP8 ' && has(b, 30, 0) && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  }
  if (chunk === 'VP8L' && has(b, 25, 0) && b[20] === 0x2f) {
    const packed = u32le(b, 21)
    return { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1 }
  }
  return null
}

/** A BMP's height is signed: a negative one means the rows were written top down, and it is still that many rows. */
const bmp = (b: Uint8Array): { width: number; height: number } | null => {
  if (!has(b, 26, 0)) return null
  const headerSize = u32le(b, 14)
  if (headerSize === 12) {
    const width = u16le(b, 18)
    const height = u16le(b, 20)
    return width > 0 && height > 0 ? { width, height } : null
  }
  const width = i32le(b, 18)
  const height = Math.abs(i32le(b, 22))
  return width > 0 && height > 0 ? { width, height } : null
}

// ---------------------------------------------------------------- WAV

const wav = (b: Uint8Array): { durationMs: number | null; note: string | null } | null => {
  let at = 12
  let byteRate = 0
  let dataBytes = -1
  let channels = 0
  let rate = 0
  for (let seen = 0; seen < MEDIA_LIMITS.boxes && has(b, at, 8); seen++) {
    const id = ascii(b, at, 4)
    const size = u32le(b, at + 4)
    const body = at + 8
    if (id === 'fmt ' && has(b, body, 16)) {
      channels = u16le(b, body + 2)
      rate = u32le(b, body + 4)
      byteRate = u32le(b, body + 8)
    }
    if (id === 'data') {
      // A file that was cut off mid-recording declares more sound than it holds. What is there is what is there.
      const left = b.length - body
      dataBytes = size === 0 || size > left ? left : size
    }
    if (size === 0 && id !== 'data') break
    // Chunks are padded to an even length.
    at = body + size + (size % 2)
  }
  if (byteRate === 0 && (channels === 0 || rate === 0)) return null
  if (dataBytes < 0) return null
  if (byteRate === 0) return { durationMs: null, note: LENGTH_UNKNOWN }
  return { durationMs: Math.round((dataBytes / byteRate) * 1000), note: null }
}

// ---------------------------------------------------------------- FLAC

/** The sample rate and the number of samples a FLAC stream declares about itself, from its first metadata block. */
const flacStreamInfo = (b: Uint8Array, at: number): { rate: number; samples: number } | null => {
  if (!has(b, at, 18)) return null
  const rate = (b[at + 10] << 12) | (b[at + 11] << 4) | (b[at + 12] >> 4)
  const samples = (b[at + 13] & 0x0f) * 4294967296 + u32be(b, at + 14)
  return rate > 0 ? { rate, samples } : null
}

const flac = (b: Uint8Array): { durationMs: number | null; note: string | null } | null => {
  // The first metadata block of a FLAC file is STREAMINFO, by the format's own rule: type 0, 34 bytes.
  if (!has(b, 8, 0) || (b[4] & 0x7f) !== 0) return null
  const info = flacStreamInfo(b, 8)
  if (!info) return null
  if (info.samples === 0) return { durationMs: null, note: `${LENGTH_UNKNOWN} (it declares no sample count.)` }
  return { durationMs: Math.round((info.samples / info.rate) * 1000), note: null }
}

// ---------------------------------------------------------------- MP3

const MP3_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
const MP3_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
const MP3_RATES: Readonly<Record<number, readonly number[]>> = Object.freeze({ 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] })

interface Mp3Header {
  version: number
  bitrate: number
  rate: number
  samplesPerFrame: number
  frameLength: number
  mono: boolean
  index: number
}

/** One MPEG audio frame header, or null when these four bytes are not one. Layer III only, which is what MP3 means. */
function mp3Header(b: Uint8Array, at: number): Mp3Header | null {
  if (!has(b, at, 4)) return null
  if (b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return null
  const version = (b[at + 1] >> 3) & 3
  const layer = (b[at + 1] >> 1) & 3
  if (version === 1 || layer !== 1) return null
  const index = (b[at + 2] >> 4) & 0x0f
  const rateIndex = (b[at + 2] >> 2) & 3
  if (index === 0 || index === 15 || rateIndex === 3) return null
  const rates = MP3_RATES[version]
  if (!rates) return null
  const rate = rates[rateIndex]
  const bitrate = (version === 3 ? MP3_BITRATES_V1_L3 : MP3_BITRATES_V2_L3)[index]
  if (bitrate === 0) return null
  const padding = (b[at + 2] >> 1) & 1
  const samplesPerFrame = version === 3 ? 1152 : 576
  const frameLength = Math.floor(((version === 3 ? 144000 : 72000) * bitrate) / rate) + padding
  return { version, bitrate, rate, samplesPerFrame, frameLength, mono: ((b[at + 3] >> 6) & 3) === 3, index }
}

/**
 * How long an MP3 is, when the file can say exactly.
 *
 * Three ways, in order of how much they are worth. A Xing or Info header counts the frames the encoder wrote, which
 * is the length whatever the bitrates were. A VBRI header does the same. Failing both, a file whose frames all
 * declare the same bitrate is constant: the sound divided by the rate is the length. A file with no count and
 * frames of different sizes could only be averaged, so it says it does not know.
 */
function mp3(b: Uint8Array): { durationMs: number | null; note: string | null } | null {
  let start = 0
  if (ascii(b, 0, 3) === 'ID3' && has(b, 10, 0)) {
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)
    start = 10 + size + ((b[5] & 0x10) !== 0 ? 10 : 0)
  }
  // The first real frame. A little rubbish between the tag and the sound is common.
  let at = -1
  for (let i = start; i < Math.min(b.length - 4, start + 65536); i++) {
    if (mp3Header(b, i)) {
      at = i
      break
    }
  }
  if (at < 0) return null
  const first = mp3Header(b, at)!
  // Where the sound ends: an ID3v1 tag at the very end is a tag, not sound.
  const end = b.length >= 128 && ascii(b, b.length - 128, 3) === 'TAG' ? b.length - 128 : b.length

  const sideInfo = first.version === 3 ? (first.mono ? 17 : 32) : first.mono ? 9 : 17
  const tagAt = at + 4 + sideInfo
  const tag = ascii(b, tagAt, 4)
  if ((tag === 'Xing' || tag === 'Info') && has(b, tagAt + 8, 0)) {
    const flags = u32be(b, tagAt + 4)
    if ((flags & 1) !== 0) {
      const frames = u32be(b, tagAt + 8)
      if (frames > 0) return { durationMs: Math.round((frames * first.samplesPerFrame * 1000) / first.rate), note: null }
    }
  }
  if (ascii(b, at + 4 + 32, 4) === 'VBRI' && has(b, at + 4 + 32 + 18, 0)) {
    const frames = u32be(b, at + 4 + 32 + 14)
    if (frames > 0) return { durationMs: Math.round((frames * first.samplesPerFrame * 1000) / first.rate), note: null }
  }

  let walk = at
  let frames = 0
  let constant = true
  while (walk + 4 <= end && frames < MEDIA_LIMITS.frames) {
    const header = mp3Header(b, walk)
    if (!header) break
    if (header.index !== first.index || header.rate !== first.rate) {
      constant = false
      break
    }
    walk += header.frameLength
    frames += 1
  }
  if (!constant || frames === 0) {
    return { durationMs: null, note: `${LENGTH_UNKNOWN} (its frames are not all the same size and it carries no frame count.)` }
  }
  return { durationMs: Math.round(((end - at) * 8000) / (first.bitrate * 1000)), note: null }
}

// ---------------------------------------------------------------- AAC

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350, 0, 0, 0]

/** An ADTS stream has no header of its own: the length is the frames counted, when there are not too many to count. */
function aac(b: Uint8Array): { durationMs: number | null; note: string | null } | null {
  if (!has(b, 7, 0)) return null
  const rate = AAC_RATES[(b[2] >> 2) & 0x0f]
  if (rate === 0) return null
  let at = 0
  let frames = 0
  while (at + 7 <= b.length && frames <= MEDIA_LIMITS.frames) {
    if (b[at] !== 0xff || (b[at + 1] & 0xf6) !== 0xf0) break
    const length = ((b[at + 3] & 3) << 11) | (b[at + 4] << 3) | (b[at + 5] >> 5)
    if (length < 7) break
    at += length
    frames += 1
  }
  if (frames === 0) return null
  if (at < b.length - 8 || frames > MEDIA_LIMITS.frames) {
    return { durationMs: null, note: `${LENGTH_UNKNOWN} (an AAC stream has no header, and this one has more frames than Orbis counts.)` }
  }
  return { durationMs: Math.round((frames * 1024 * 1000) / rate), note: null }
}

// ---------------------------------------------------------------- Ogg

/**
 * How long an Ogg file is: the position stamped on its last page, divided by its rate.
 *
 * Every Ogg page carries how far into the sound it ends, so the last page is the length. It is read from the end
 * rather than by walking every page, which is the same answer for a hundredth of the work.
 */
function ogg(b: Uint8Array): { kind: MediaKindId; durationMs: number | null; note: string | null } | { refusal: MediaRefusal } | null {
  if (!has(b, 27, 0)) return null
  const payload = 27 + b[26]
  if (!has(b, payload, 8)) return null
  let rate = 0
  let preSkip = 0
  if (b[payload] === 0x01 && ascii(b, payload + 1, 6) === 'vorbis') {
    rate = u32le(b, payload + 12)
  } else if (ascii(b, payload, 8) === 'OpusHead') {
    // Opus stamps its pages at 48 kHz whatever it was recorded at, and the first samples are thrown away.
    rate = 48000
    preSkip = u16le(b, payload + 10)
  } else if (b[payload] === 0x7f && ascii(b, payload + 1, 4) === 'FLAC') {
    const info = flacStreamInfo(b, payload + 13)
    rate = info ? info.rate : 0
  } else if (b[payload] === 0x80 && ascii(b, payload + 1, 6) === 'theora') {
    return { refusal: refuse('not-media', 'That is a video inside an Ogg file. Orbis keeps a video as MP4, WebM or QuickTime, not as Ogg.') }
  } else {
    return null
  }
  if (rate <= 0) return null

  // The last page, found from the end. "OggS" can appear inside a payload by chance, so a candidate counts only
  // when it is really a page header -- version 0, no unknown flags -- and when the page it describes ends exactly
  // where the file does, which is true of the last page of every whole Ogg file and of no run of bytes inside one.
  let granule = -1
  const floor = Math.max(0, b.length - MEDIA_LIMITS.tailBytes)
  for (let at = b.length - 27; at >= floor; at--) {
    if (b[at] !== 0x4f || ascii(b, at, 4) !== 'OggS' || b[at + 4] !== 0 || (b[at + 5] & 0xf8) !== 0) continue
    const segments = b[at + 26]
    if (!has(b, at + 27, segments)) continue
    let page = 27 + segments
    for (let i = 0; i < segments; i++) page += b[at + 27 + i]
    if (at + page !== b.length) continue
    granule = u64le(b, at + 6)
    break
  }
  if (granule < 0) return { kind: 'audio', durationMs: null, note: LENGTH_UNKNOWN }
  const samples = Math.max(0, granule - preSkip)
  return { kind: 'audio', durationMs: Math.round((samples / rate) * 1000), note: null }
}

// ---------------------------------------------------------------- MP4, M4A and QuickTime

interface Box {
  type: string
  at: number
  end: number
}

/** The boxes of an MP4 at one level. Bounded, and a box that runs off the end is clamped rather than trusted. */
function boxesIn(b: Uint8Array, from: number, to: number, budget: { left: number }): Box[] {
  const out: Box[] = []
  let at = from
  while (at + 8 <= to && budget.left > 0) {
    budget.left -= 1
    let size = u32be(b, at)
    const type = ascii(b, at + 4, 4)
    let head = 8
    if (size === 1) {
      if (at + 16 > to || u32be(b, at + 8) !== 0) return out
      size = u32be(b, at + 12)
      head = 16
    } else if (size === 0) {
      size = to - at
    }
    if (size < head) return out
    out.push({ type, at: at + head, end: Math.min(to, at + size) })
    if (at + size > to) return out
    at += size
  }
  return out
}

const child = (b: Uint8Array, box: Box, type: string, budget: { left: number }): Box | null =>
  boxesIn(b, box.at, box.end, budget).find((one) => one.type === type) ?? null

const descend = (b: Uint8Array, box: Box, path: readonly string[], budget: { left: number }): Box | null => {
  let here: Box | null = box
  for (const step of path) {
    if (!here) return null
    here = child(b, here, step, budget)
  }
  return here
}

function mp4(b: Uint8Array): { kind: MediaKindId; format: MediaFormatId; width: number | null; height: number | null; durationMs: number | null; notes: string[] } | { refusal: MediaRefusal } | null {
  const budget = { left: MEDIA_LIMITS.boxes }
  const top = boxesIn(b, 0, b.length, budget)
  const moov = top.find((one) => one.type === 'moov')
  if (!moov) {
    return { refusal: refuse('damaged', 'That file begins like an MP4 but has no movie header in it, so Orbis cannot tell what is inside. It was not kept.') }
  }
  const brand = ascii(b, 8, 4)
  const notes: string[] = []

  // The movie header holds the length, in units of its own rate. Version 1 writes the two times as 64-bit numbers,
  // which pushes the rate and the length eight bytes further along.
  let durationMs: number | null = null
  const mvhd = child(b, moov, 'mvhd', budget)
  if (mvhd && has(b, mvhd.at, 4)) {
    const version = b[mvhd.at]
    let timescale = 0
    let ticks = 0
    if (version === 1 && has(b, mvhd.at + 32, 0)) {
      timescale = u32be(b, mvhd.at + 20)
      ticks = u32be(b, mvhd.at + 24) * 4294967296 + u32be(b, mvhd.at + 28)
    } else if (version === 0 && has(b, mvhd.at + 20, 0)) {
      timescale = u32be(b, mvhd.at + 12)
      ticks = u32be(b, mvhd.at + 16)
    }
    // 0xffffffff is what a file writes when it does not know its own length.
    if (timescale > 0 && ticks > 0 && ticks !== 0xffffffff) durationMs = Math.round((ticks / timescale) * 1000)
  }

  let picture: Box | null = null
  let sound = false
  for (const trak of boxesIn(b, moov.at, moov.end, budget).filter((one) => one.type === 'trak')) {
    const hdlr = descend(b, trak, ['mdia', 'hdlr'], budget)
    const handler = hdlr ? ascii(b, hdlr.at + 8, 4) : ''
    if (handler === 'vide' && !picture) picture = trak
    if (handler === 'soun') sound = true
  }
  if (!picture && !sound) {
    return { refusal: refuse('damaged', 'That MP4 file has no picture track and no sound track in it that Orbis could find. It was not kept.') }
  }

  let width: number | null = null
  let height: number | null = null
  if (picture) {
    const tkhd = child(b, picture, 'tkhd', budget)
    if (tkhd && tkhd.end - tkhd.at >= 8) {
      const w = u32be(b, tkhd.end - 8) / 65536
      const h = u32be(b, tkhd.end - 4) / 65536
      if (w >= 1 && h >= 1) {
        width = Math.round(w)
        height = Math.round(h)
      }
    }
    if (width === null) {
      // A track whose header says nothing: the size the picture was coded at, from the first sample description.
      const stsd = descend(b, picture, ['mdia', 'minf', 'stbl', 'stsd'], budget)
      const entry = stsd ? boxesIn(b, stsd.at + 8, stsd.end, budget)[0] : null
      if (entry && has(b, entry.at + 28, 0)) {
        const w = u16be(b, entry.at + 24)
        const h = u16be(b, entry.at + 26)
        if (w > 0 && h > 0) {
          width = w
          height = h
        }
      }
    }
    if (width === null) notes.push('The picture track does not say how big the picture is, and Orbis does not decode it to find out.')
  }

  const kind: MediaKindId = picture ? 'video' : 'audio'
  const format: MediaFormatId = picture ? (brand === 'qt  ' ? 'mov' : 'mp4') : 'm4a'
  if (!picture) notes.push('Sound only: there is no picture track in this file.')
  if (durationMs === null) notes.push(LENGTH_UNKNOWN)
  return { kind, format, width, height, durationMs, notes }
}

// ---------------------------------------------------------------- WebM and Matroska

const EBML_CONTAINERS: ReadonlySet<number> = new Set([0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0])

const ebmlId = (b: Uint8Array, at: number): { id: number; length: number } | null => {
  if (!has(b, at, 1)) return null
  const first = b[at]
  const length = first & 0x80 ? 1 : first & 0x40 ? 2 : first & 0x20 ? 3 : first & 0x10 ? 4 : 0
  if (length === 0 || !has(b, at, length)) return null
  let id = 0
  for (let i = 0; i < length; i++) id = id * 256 + b[at + i]
  return { id, length }
}

const ebmlSize = (b: Uint8Array, at: number): { size: number; length: number; unknown: boolean } | null => {
  if (!has(b, at, 1)) return null
  const first = b[at]
  let length = 0
  for (let i = 0; i < 8; i++) {
    if (first & (0x80 >> i)) {
      length = i + 1
      break
    }
  }
  if (length === 0 || !has(b, at, length)) return null
  let size = first & (0xff >> length)
  let ones = size === (0xff >> length)
  for (let i = 1; i < length; i++) {
    size = size * 256 + b[at + i]
    if (b[at + i] !== 0xff) ones = false
  }
  return { size, length, unknown: ones }
}

const ebmlUint = (b: Uint8Array, at: number, end: number): number => {
  let value = 0
  for (let i = at; i < end && i < at + 8; i++) value = value * 256 + b[i]
  return value
}

const ebmlFloat = (b: Uint8Array, at: number, end: number): number | null => {
  const length = end - at
  if (length !== 4 && length !== 8) return null
  const view = new DataView(b.buffer, b.byteOffset + at, length)
  return length === 4 ? view.getFloat32(0) : view.getFloat64(0)
}

function webm(b: Uint8Array): { kind: MediaKindId; width: number | null; height: number | null; durationMs: number | null; notes: string[] } | { refusal: MediaRefusal } | null {
  let docType = ''
  let timecodeScale = 1_000_000
  let ticks: number | null = null
  let video = false
  let sound = false
  let width: number | null = null
  let height: number | null = null
  let inVideo = 0
  const budget = { left: MEDIA_LIMITS.elements }

  const scan = (from: number, to: number, depth: number): void => {
    let at = from
    while (at < to && budget.left > 0) {
      budget.left -= 1
      const id = ebmlId(b, at)
      if (!id) return
      const size = ebmlSize(b, at + id.length)
      if (!size) return
      const start = at + id.length + size.length
      const end = size.unknown ? to : Math.min(to, start + size.size)
      if (end < start) return
      if (id.id === 0x4282) docType = ascii(b, start, Math.min(16, end - start)).replace(/\0+$/, '')
      if (id.id === 0x2ad7b1) timecodeScale = ebmlUint(b, start, end) || timecodeScale
      if (id.id === 0x4489) ticks = ebmlFloat(b, start, end)
      if (id.id === 0x83) {
        const type = ebmlUint(b, start, end)
        if (type === 1) video = true
        if (type === 2) sound = true
      }
      if (id.id === 0xb0 && inVideo > 0) width = ebmlUint(b, start, end) || width
      if (id.id === 0xba && inVideo > 0) height = ebmlUint(b, start, end) || height
      if (EBML_CONTAINERS.has(id.id) && depth < 6) {
        if (id.id === 0xe0) inVideo += 1
        scan(start, end, depth + 1)
        if (id.id === 0xe0) inVideo -= 1
      }
      if (size.unknown) return
      at = start + size.size
    }
  }
  scan(0, b.length, 0)

  if (docType !== '' && docType !== 'webm') {
    return { refusal: refuse('not-media', `That is a ${docType === 'matroska' ? 'Matroska (.mkv)' : docType} file. Orbis keeps a video as MP4, WebM or QuickTime; it does not keep this one.`) }
  }
  if (!video && !sound) {
    return { refusal: refuse('damaged', 'That WebM file has no picture track and no sound track in it that Orbis could find. It was not kept.') }
  }
  const notes: string[] = []
  const durationMs = ticks !== null && ticks > 0 ? Math.round((ticks * timecodeScale) / 1_000_000) : null
  if (durationMs === null) notes.push(`${LENGTH_UNKNOWN} (a WebM written as it was recorded often has no length in it.)`)
  if (video && (width === null || height === null)) notes.push('The picture track does not say how big the picture is, and Orbis does not decode it to find out.')
  if (!video) notes.push('Sound only: there is no picture track in this file.')
  return { kind: video ? 'video' : 'audio', width: video ? width : null, height: video ? height : null, durationMs, notes }
}

// ---------------------------------------------------------------- the door

const NOT_MEDIA =
  'That is not a picture, a sound or a video Orbis keeps. Pictures: PNG, JPEG, GIF, WebP, BMP. Sounds: MP3, WAV, Ogg, FLAC, M4A, AAC. Videos: MP4, WebM, QuickTime.'

const formatBytes = (count: number): string => {
  if (count < 1024) return `${count} B`
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} KB`
  return `${(count / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Everything a file says about itself, or a refusal in plain words.
 *
 * The file's own bytes decide what it is; the name it came under is not consulted here at all (that cross-check is
 * `inspectMedia` in src/main/artifacts/media.ts, which knows the name). Nothing is decoded: every number below was
 * read out of a header.
 */
export function readMedia(bytes: Uint8Array): MediaOutcome {
  if (bytes.length === 0) return refuse('not-media', 'The file is empty.')
  const family = familyOf(bytes)
  if (family === null) return refuse('not-media', NOT_MEDIA)
  if (family === 'svg') {
    return refuse('not-media', 'That is an SVG, which is markup rather than a picture file. Orbis keeps the drawings it makes itself as SVG; it does not keep one as a picture.')
  }

  let kind: MediaKindId
  let format: MediaFormatId
  let width: number | null = null
  let height: number | null = null
  let durationMs: number | null = null
  const notes: string[] = []

  if (family === 'png' || family === 'jpeg' || family === 'gif' || family === 'webp' || family === 'bmp') {
    kind = 'image'
    format = family
    const size = family === 'png' ? png(bytes) : family === 'jpeg' ? jpeg(bytes) : family === 'gif' ? gif(bytes) : family === 'webp' ? webp(bytes) : bmp(bytes)
    if (!size) {
      return refuse('damaged', `That file begins like a ${MEDIA_FORMATS[format].label} picture, but its header does not say how big the picture is. A picture Orbis cannot measure is a picture it cannot check, so it was not kept.`)
    }
    width = size.width
    height = size.height
    if (family === 'gif') notes.push('A GIF may hold several frames. It is kept exactly as it is, and Orbis does not read or change the frames.')
    if (family === 'webp') notes.push('A WebP may hold an animation. It is kept exactly as it is, and Orbis does not read or change the frames.')
  } else if (family === 'wav' || family === 'flac' || family === 'mp3' || family === 'aac') {
    kind = 'audio'
    format = family
    const read = family === 'wav' ? wav(bytes) : family === 'flac' ? flac(bytes) : family === 'mp3' ? mp3(bytes) : aac(bytes)
    if (!read) {
      return refuse('damaged', `That file begins like a ${MEDIA_FORMATS[format].label} sound, but the rest of its header could not be read. It was not kept.`)
    }
    durationMs = read.durationMs
    if (read.note) notes.push(read.note)
  } else if (family === 'ogg') {
    const read = ogg(bytes)
    if (!read) return refuse('damaged', 'That file begins like an Ogg file, but Orbis could not tell what kind of sound is in it. It was not kept.')
    if ('refusal' in read) return read.refusal
    kind = 'audio'
    format = 'ogg'
    durationMs = read.durationMs
    if (read.note) notes.push(read.note)
  } else if (family === 'mp4') {
    const read = mp4(bytes)
    if (!read) return refuse('damaged', 'That file begins like an MP4 file, but its boxes could not be read. It was not kept.')
    if ('refusal' in read) return read.refusal
    kind = read.kind
    format = read.format
    width = read.width
    height = read.height
    durationMs = read.durationMs
    notes.push(...read.notes)
  } else {
    const read = webm(bytes)
    if (!read) return refuse('damaged', 'That file begins like a WebM file, but its elements could not be read. It was not kept.')
    if ('refusal' in read) return read.refusal
    kind = read.kind
    format = 'webm'
    width = read.width
    height = read.height
    durationMs = read.durationMs
    notes.push(...read.notes)
  }

  // The ceilings. Checked after reading, because what the header declares is the thing being judged.
  const ceiling = MEDIA_LIMITS[kind]
  if (bytes.length > ceiling.bytes) {
    return refuse('too-large', `That ${MEDIA_KIND_WORDS[kind].word} is ${formatBytes(bytes.length)}, past the ${formatBytes(ceiling.bytes)} Orbis keeps for one ${MEDIA_KIND_WORDS[kind].word}.`)
  }
  if (width !== null && height !== null && 'width' in ceiling) {
    if (width > ceiling.width || height > ceiling.height || width * height > (kind === 'image' ? MEDIA_LIMITS.image.pixels : ceiling.width * ceiling.height)) {
      return refuse('damaged', `That file says it is ${width.toLocaleString('en')} × ${height.toLocaleString('en')}, which is larger than any real ${MEDIA_KIND_WORDS[kind].word}. Its header cannot be trusted, so it was not kept.`)
    }
  }
  if (kind !== 'image' && durationMs !== null && (durationMs < 0 || durationMs > MEDIA_LIMITS[kind].durationMs)) {
    durationMs = null
    notes.push(`${LENGTH_UNKNOWN} (the length it declares is longer than any real recording, so it is not shown.)`)
  }

  const mediaType = kind === 'audio' && format === 'webm' ? 'audio/webm' : MEDIA_FORMATS[format].mediaType
  notes.push(KEPT_AS_IT_IS[kind])
  return {
    kind,
    format,
    mediaType,
    bytes: bytes.length,
    hash: hashOf(bytes),
    signature: signatureOf(bytes),
    width,
    height,
    durationMs,
    notes
  }
}

// ---------------------------------------------------------------- words

/** "PNG picture", "WebM sound": the format and the kind, so an audio-only WebM is not called a video. */
export const mediaName = (facts: { format: MediaFormatId; kind: MediaKindId }): string =>
  `${MEDIA_FORMATS[facts.format].label} ${MEDIA_KIND_WORDS[facts.kind].word}`

/** A length a person reads: "3 min 12 s", "1 h 4 min", "0.4 s". */
export function mediaLength(durationMs: number): string {
  const total = Math.max(0, Math.round(durationMs / 1000))
  if (durationMs < 1000) return `${(durationMs / 1000).toFixed(1)} s`
  if (total < 60) return `${total} s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`
  const hours = Math.floor(minutes / 60)
  const left = minutes % 60
  return left === 0 ? `${hours} h` : `${hours} h ${left} min`
}

/**
 * One line for a card: "PNG picture, 1920 × 1080, 2.1 MB"; "MP3 sound, 3 min 12 s".
 *
 * A picture always says how big the file is, because that is what a person decides about a picture. A sound or a
 * video says how long it is, and falls back to its size when the file would not say.
 */
export function describeMedia(facts: MediaFacts): string {
  const parts = [mediaName(facts)]
  if (facts.width !== null && facts.height !== null) parts.push(`${facts.width.toLocaleString('en')} × ${facts.height.toLocaleString('en')}`)
  if (facts.durationMs !== null) parts.push(mediaLength(facts.durationMs))
  if (facts.kind === 'image' || facts.durationMs === null) parts.push(formatBytes(facts.bytes))
  return parts.join(', ')
}

/** The extension a stored copy of this format gets. Never taken from the name a file arrived under. */
export const mediaExtension = (format: MediaFormatId): string => MEDIA_FORMATS[format].extensions[0]

/** A name a file can have: the artifact's title made safe, with the extension its own bytes earned. */
export const mediaFileName = (title: string, format: MediaFormatId): string =>
  `${safeName(title, MEDIA_KIND_WORDS[MEDIA_FORMATS[format].kind].name)}${mediaExtension(format)}`

// ---------------------------------------------------------------- what is stored

/**
 * The artifact's source record: everything about the file except the file.
 *
 * This is what goes in `source.json`, and it is metadata only -- a few hundred bytes of plain text. The bytes
 * themselves are the content file beside it, written once and never written again. That is the one place these three
 * kinds differ from every other kind in Create, where the source record is the artifact and the content file is a
 * copy made from it. Here the content file *is* the artifact, and this record is what is known about it.
 *
 * Keeping it as text rather than as base64 is deliberate. A 20 MB picture inlined as base64 would be a 27 MB JSON
 * string parsed again on every read, every save and every search, for no gain.
 */
export interface MediaSource {
  kind: MediaKindId
  format: MediaFormatId
  mediaType: string
  bytes: number
  hash: string
  signature: string
  width: number | null
  height: number | null
  durationMs: number | null
  /** Where the bytes came from, in the words a person would use: "file: holiday.png", "made in the chat from: …". */
  from: string
  /** What was read and what was not. Carried into the artifact's notes. */
  notes: readonly string[]
}

export type MediaBody =
  | { kind: 'image'; image: MediaSource }
  | { kind: 'audio'; audio: MediaSource }
  | { kind: 'video'; video: MediaSource }

/**
 * Whether a tagged body is one of these three.
 *
 * `isMediaKindId` answers about a string, which is what a record's `kind` is. This answers about the body itself, so
 * the compiler narrows the union -- which is the difference between a branch that reads `body.image` and a branch
 * the compiler lets fall through to the document writer.
 */
export const isMediaBody = (body: { kind: string }): body is MediaBody => isMediaKindId(body.kind)

/** The record inside a media body, whichever of the three it is. */
export const mediaIn = (body: MediaBody): MediaSource =>
  body.kind === 'image' ? body.image : body.kind === 'audio' ? body.audio : body.video

export const mediaSourceOf = (facts: MediaFacts, from: string): MediaSource => ({
  kind: facts.kind,
  format: facts.format,
  mediaType: facts.mediaType,
  bytes: facts.bytes,
  hash: facts.hash,
  signature: facts.signature,
  width: facts.width,
  height: facts.height,
  durationMs: facts.durationMs,
  from,
  notes: [...facts.notes]
})

export function mediaBodyOf(facts: MediaFacts, from: string): MediaBody {
  const source = mediaSourceOf(facts, from)
  if (facts.kind === 'image') return { kind: 'image', image: source }
  if (facts.kind === 'audio') return { kind: 'audio', audio: source }
  return { kind: 'video', video: source }
}

// ---------------------------------------------------------------- read back and checked

/** What the written file is expected to be. A `MediaFacts` and a `MediaSource` both are one. */
export interface MediaExpectation {
  kind: MediaKindId
  format: MediaFormatId
  bytes: number
  hash: string
  signature: string
  width: number | null
  height: number | null
  durationMs: number | null
}

/**
 * The stored file, read back from disk and checked against what was written.
 *
 * Five things are asked, and each is named so "verified" is a list a person can read. It is the same length. It has
 * the same hash. It still begins with the bytes one of these begins with. Read again from scratch it is still the
 * same kind and format. And it still says the same size and the same length -- which is the check that matters here,
 * because a copy that was truncated in the middle keeps its first bytes and loses its last ones.
 *
 * Where the header never carried a size or a length, the check says that, rather than quietly passing.
 */
export function verifyMedia(expected: MediaExpectation, readBack: Uint8Array): VerifyResult {
  const label = mediaName(expected)
  const checks: VerifyResult['checks'] = [
    {
      what: 'written',
      passed: readBack.length === expected.bytes,
      describe: `The file on disk is ${formatBytes(readBack.length)}; ${formatBytes(expected.bytes)} was written.`
    },
    {
      what: 'checksum',
      passed: hashOf(readBack) === expected.hash,
      describe: 'The hash of the file on disk matches the one recorded when it was written.'
    },
    {
      what: 'signature',
      passed: signatureOf(readBack) === expected.signature,
      describe: signatureOf(readBack) === expected.signature ? `The file still begins with the bytes a ${label} begins with.` : `The file does not begin the way the ${label} that was written began.`
    }
  ]

  const again = readMedia(readBack)
  if (isMediaRefusal(again)) {
    checks.push({ what: 'read again', passed: false, describe: `Read back from disk it is no longer a ${label}: ${again.message}` })
    return { ok: false, checks, reimported: null, differences: ['The file on disk could not be read as the kind it was written as.'] }
  }
  const same = again.kind === expected.kind && again.format === expected.format
  checks.push({
    what: 'read again',
    passed: same,
    describe: same ? `Read back from disk and measured again, it is still a ${label}.` : `Read back from disk it is a ${mediaName(again)}, not a ${label}.`
  })

  const differences: string[] = []
  if (expected.width !== null && expected.height !== null) {
    const sized = again.width === expected.width && again.height === expected.height
    checks.push({
      what: 'size',
      passed: sized,
      describe: sized
        ? `It is ${expected.width.toLocaleString('en')} × ${expected.height.toLocaleString('en')}, as it was.`
        : `It says it is ${again.width === null ? 'no size at all' : `${again.width.toLocaleString('en')} × ${again.height?.toLocaleString('en')}`}; ${expected.width.toLocaleString('en')} × ${expected.height.toLocaleString('en')} was written.`
    })
    if (!sized) differences.push('The size the file declares changed between writing it and reading it back.')
  } else {
    checks.push({ what: 'size', passed: true, describe: 'This file never said how big it is, so there was nothing to check the size against.' })
  }

  if (expected.durationMs !== null) {
    const timed = again.durationMs === expected.durationMs
    checks.push({
      what: 'length',
      passed: timed,
      describe: timed ? `It is ${mediaLength(expected.durationMs)} long, as it was.` : `It now says ${again.durationMs === null ? 'nothing about its length' : mediaLength(again.durationMs)}; ${mediaLength(expected.durationMs)} was written.`
    })
    if (!timed) differences.push('The length the file declares changed between writing it and reading it back.')
  } else if (expected.kind !== 'image') {
    checks.push({ what: 'length', passed: true, describe: 'This file never said how long it is, so there was nothing to check the length against.' })
  }

  return {
    ok: checks.every((one) => one.passed),
    checks,
    reimported: again.width !== null && again.height !== null ? { rows: again.height, columns: again.width } : null,
    differences
  }
}
