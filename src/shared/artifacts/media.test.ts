import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeMedia,
  familyOf,
  isMediaRefusal,
  mediaBodyOf,
  mediaExtension,
  mediaFileName,
  mediaIn,
  mediaLength,
  mediaName,
  readMedia,
  verifyMedia,
  MEDIA_FORMATS,
  MEDIA_LIMITS,
  type MediaFacts
} from './media.ts'

/*
 * Every file in this test is built here, byte by byte, out of the real format's own header. Nothing is read from
 * disk and no fixture is checked in: a header written out in the test is a header a reader of the test can check
 * against the specification, and a 20-byte PNG proves the same thing a photograph would.
 */

const bytes = (...parts: (Uint8Array | number[])[]): Uint8Array => {
  const list = parts.map((one) => (Array.isArray(one) ? new Uint8Array(one) : one))
  const out = new Uint8Array(list.reduce((n, one) => n + one.length, 0))
  let at = 0
  for (const one of list) {
    out.set(one, at)
    at += one.length
  }
  return out
}

const be32 = (value: number): number[] => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
const le32 = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
const be16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff]
const le16 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff]
const le24 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]
const chars = (text: string): number[] => [...text].map((one) => one.charCodeAt(0))
const zeros = (count: number): number[] => new Array(count).fill(0)

// ---------------------------------------------------------------- pictures

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = (data: Uint8Array): number => {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A real PNG chunk, with its real CRC, so these are files a picture program would open. */
const chunk = (type: string, data: number[]): Uint8Array => {
  const body = bytes(chars(type), data)
  return bytes(be32(data.length), body, be32(crc32(body)))
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const png = (width: number, height: number): Uint8Array =>
  bytes(PNG_SIGNATURE, chunk('IHDR', [...be32(width), ...be32(height), 8, 2, 0, 0, 0]), chunk('IEND', []))

const jpeg = (width: number, height: number): Uint8Array =>
  bytes(
    [0xff, 0xd8],
    [0xff, 0xe0, 0x00, 0x10],
    chars('JFIF'),
    [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    // Start of frame: eight bits a sample, then the height and the width, then one component.
    [0xff, 0xc0, 0x00, 0x0b, 0x08],
    be16(height),
    be16(width),
    [0x01, 0x01, 0x11, 0x00],
    [0xff, 0xd9]
  )

const gif = (width: number, height: number): Uint8Array => bytes(chars('GIF89a'), le16(width), le16(height), [0xf7, 0x00, 0x00], [0x3b])

const riff = (kind: string, body: Uint8Array): Uint8Array => bytes(chars('RIFF'), le32(body.length + 4), chars(kind), body)

const webpVp8x = (width: number, height: number): Uint8Array =>
  riff('WEBP', bytes(chars('VP8X'), le32(10), [0x10, 0, 0, 0], le24(width - 1), le24(height - 1)))

const webpVp8l = (width: number, height: number): Uint8Array => {
  const packed = (width - 1) | ((height - 1) << 14)
  return riff('WEBP', bytes(chars('VP8L'), le32(5), [0x2f], le32(packed)))
}

const webpVp8 = (width: number, height: number): Uint8Array =>
  riff('WEBP', bytes(chars('VP8 '), le32(14), [0x00, 0x00, 0x00], [0x9d, 0x01, 0x2a], le16(width), le16(height)))

const bmp = (width: number, height: number): Uint8Array =>
  bytes(chars('BM'), le32(54 + 4), zeros(4), le32(54), le32(40), le32(width), le32(height), le16(1), le16(24), zeros(24), zeros(4))

// ---------------------------------------------------------------- sounds

const wav = (dataBytes: number, rate = 8000, channels = 1, bits = 8): Uint8Array => {
  const byteRate = (rate * channels * bits) / 8
  const fmt = bytes(chars('fmt '), le32(16), le16(1), le16(channels), le32(rate), le32(byteRate), le16((channels * bits) / 8), le16(bits))
  const data = bytes(chars('data'), le32(dataBytes), new Uint8Array(dataBytes))
  return riff('WAVE', bytes(fmt, data))
}

const flac = (rate: number, samples: number): Uint8Array => {
  const high = Math.floor(samples / 4294967296) & 0x0f
  const info = [
    ...le16(4096),
    ...le16(4096),
    ...zeros(6),
    (rate >> 12) & 0xff,
    (rate >> 4) & 0xff,
    ((rate & 0x0f) << 4) | (1 << 1) | 0,
    (0x0f << 4) | high,
    ...be32(samples >>> 0),
    ...zeros(16)
  ]
  return bytes(chars('fLaC'), [0x00, 0x00, 0x00, 0x22], info)
}

/** One MPEG 1 Layer III frame header: 128 kbps, 44,100 Hz, joint stereo. 417 bytes a frame. */
const MP3_FRAME = [0xff, 0xfb, 0x90, 0x64]
const MP3_FRAME_BYTES = 417

const mp3WithXing = (frames: number): Uint8Array => {
  const head = bytes(MP3_FRAME, zeros(32), chars('Xing'), be32(1), be32(frames))
  return bytes(head, new Uint8Array(MP3_FRAME_BYTES - head.length))
}

const mp3Constant = (frames: number): Uint8Array => {
  const parts: Uint8Array[] = []
  for (let i = 0; i < frames; i++) parts.push(bytes(MP3_FRAME, new Uint8Array(MP3_FRAME_BYTES - 4)))
  return bytes(...parts)
}

const aac = (frames: number, length = 32): Uint8Array => {
  const header = [0xff, 0xf1, 0x50, 0x40 | ((length >> 11) & 3), (length >> 3) & 0xff, ((length & 7) << 5) | 0x1f, 0xfc]
  const parts: Uint8Array[] = []
  for (let i = 0; i < frames; i++) parts.push(bytes(header, new Uint8Array(length - header.length)))
  return bytes(...parts)
}

const oggPage = (granule: number, payload: Uint8Array, first: boolean): Uint8Array =>
  bytes(
    chars('OggS'),
    [0, first ? 0x02 : 0x04],
    le32(granule >>> 0),
    le32(Math.floor(granule / 4294967296)),
    le32(1),
    le32(first ? 0 : 1),
    le32(0),
    [1],
    [payload.length & 0xff],
    payload
  )

const oggOpus = (seconds: number): Uint8Array => {
  const preSkip = 312
  const head = bytes(chars('OpusHead'), [1, 2], le16(preSkip), le32(48000), le16(0), [0])
  return bytes(oggPage(0, head, true), oggPage(seconds * 48000 + preSkip, new Uint8Array(0), false))
}

const oggVorbis = (seconds: number, rate = 44100): Uint8Array => {
  const head = bytes([0x01], chars('vorbis'), le32(0), [2], le32(rate), zeros(16))
  return bytes(oggPage(0, head, true), oggPage(seconds * rate, new Uint8Array(0), false))
}

const oggTheora = (): Uint8Array => {
  const head = bytes([0x80], chars('theora'), zeros(32))
  return bytes(oggPage(0, head, true))
}

// ---------------------------------------------------------------- MP4 and WebM

const box = (type: string, body: Uint8Array | number[]): Uint8Array => {
  const data = Array.isArray(body) ? new Uint8Array(body) : body
  return bytes(be32(data.length + 8), chars(type), data)
}

const mvhd = (timescale: number, duration: number): Uint8Array => box('mvhd', [...zeros(4), ...zeros(8), ...be32(timescale), ...be32(duration), ...zeros(80)])

const trak = (handler: string, width = 0, height = 0): Uint8Array => {
  const tkhd = box('tkhd', [...zeros(4), ...zeros(12), ...zeros(4), ...zeros(4), ...zeros(8), ...zeros(8), ...zeros(36), ...be32(width * 65536), ...be32(height * 65536)])
  const hdlr = box('hdlr', [...zeros(4), ...zeros(4), ...chars(handler), ...zeros(12), 0])
  return box('trak', bytes(tkhd, box('mdia', hdlr)))
}

const mp4 = (brand: string, tracks: Uint8Array[], timescale = 1000, duration = 4000): Uint8Array =>
  bytes(box('ftyp', [...chars(brand), ...zeros(4)]), box('moov', bytes(mvhd(timescale, duration), ...tracks)))

/** An EBML element: its id as it is written, then its length, then its contents. */
const ebml = (id: number[], body: Uint8Array | number[]): Uint8Array => {
  const data = Array.isArray(body) ? new Uint8Array(body) : body
  const size = data.length < 0x7f ? [0x80 | data.length] : [0x40 | (data.length >> 8), data.length & 0xff]
  return bytes(id, size, data)
}

const ebmlFloat = (value: number): number[] => {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setFloat64(0, value)
  return [...out]
}

const webm = (about: { docType?: string; durationTicks?: number | null; scale?: number; width?: number; height?: number; sound?: boolean }): Uint8Array => {
  const docType = about.docType ?? 'webm'
  const header = ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], chars(docType)))
  const info = ebml(
    [0x15, 0x49, 0xa9, 0x66],
    bytes(ebml([0x2a, 0xd7, 0xb1], be32(about.scale ?? 1_000_000)), ...(about.durationTicks != null ? [ebml([0x44, 0x89], ebmlFloat(about.durationTicks))] : []))
  )
  const entries: Uint8Array[] = []
  if (about.width != null) {
    entries.push(ebml([0xae], bytes(ebml([0x83], [1]), ebml([0xe0], bytes(ebml([0xb0], be16(about.width)), ebml([0xba], be16(about.height ?? 0)))))))
  }
  if (about.sound) entries.push(ebml([0xae], ebml([0x83], [2])))
  const tracks = ebml([0x16, 0x54, 0xae, 0x6b], bytes(...entries))
  return bytes(header, ebml([0x18, 0x53, 0x80, 0x67], bytes(info, tracks)))
}

const facts = (file: Uint8Array): MediaFacts => {
  const read = readMedia(file)
  if (isMediaRefusal(read)) throw new Error(`expected a file, got a refusal: ${read.message}`)
  return read
}

const refusal = (file: Uint8Array): { error: string; message: string } => {
  const read = readMedia(file)
  if (!isMediaRefusal(read)) throw new Error('expected a refusal')
  return read
}

// ---------------------------------------------------------------- pictures

test('a PNG gives its kind, its format and the size in its own header', () => {
  const read = facts(png(1920, 1080))
  assert.equal(read.kind, 'image')
  assert.equal(read.format, 'png')
  assert.equal(read.mediaType, 'image/png')
  assert.equal(read.width, 1920)
  assert.equal(read.height, 1080)
  assert.equal(read.durationMs, null)
  assert.equal(read.bytes, png(1920, 1080).length)
  assert.match(read.notes.join(' '), /byte for byte/)
})

test('a JPEG is measured from its start-of-frame marker, not from its extension', () => {
  const read = facts(jpeg(640, 480))
  assert.equal(read.format, 'jpeg')
  assert.equal(read.width, 640)
  assert.equal(read.height, 480)
})

test('a GIF is measured, and the note says Orbis does not touch its frames', () => {
  const read = facts(gif(320, 200))
  assert.equal(read.format, 'gif')
  assert.deepEqual([read.width, read.height], [320, 200])
  assert.match(read.notes.join(' '), /several frames/)
})

test('all three WebP headers are read', () => {
  assert.deepEqual([facts(webpVp8x(800, 600)).width, facts(webpVp8x(800, 600)).height], [800, 600])
  assert.deepEqual([facts(webpVp8l(64, 48)).width, facts(webpVp8l(64, 48)).height], [64, 48])
  assert.deepEqual([facts(webpVp8(1024, 768)).width, facts(webpVp8(1024, 768)).height], [1024, 768])
  assert.equal(facts(webpVp8x(800, 600)).format, 'webp')
})

test('a BMP written bottom up and one written top down are both the same number of rows', () => {
  assert.equal(facts(bmp(100, 50)).height, 50)
  assert.equal(facts(bmp(100, -50)).height, 50)
  assert.equal(facts(bmp(100, 50)).format, 'bmp')
})

test('a RIFF file that is neither a WebP nor a WAV is not media', () => {
  assert.equal(refusal(riff('AVI ', bytes(zeros(32)))).error, 'not-media')
})

// ---------------------------------------------------------------- sounds

test('a WAV is as long as its sound divided by its rate', () => {
  const read = facts(wav(12_000))
  assert.equal(read.kind, 'audio')
  assert.equal(read.format, 'wav')
  assert.equal(read.durationMs, 1500)
  assert.equal(read.width, null)
})

test('a WAV cut off mid-recording is as long as the sound that is really there', () => {
  const whole = wav(12_000)
  const read = facts(whole.subarray(0, whole.length - 6000))
  assert.equal(read.durationMs, 750)
})

test('a WAV with no format chunk is damaged, and says so', () => {
  const read = refusal(riff('WAVE', bytes(chars('data'), le32(100), new Uint8Array(100))))
  assert.equal(read.error, 'damaged')
  assert.match(read.message, /WAV sound/)
})

test('a FLAC is as long as the samples it declares', () => {
  const read = facts(flac(44100, 44100 * 3))
  assert.equal(read.format, 'flac')
  assert.equal(read.durationMs, 3000)
})

test('a FLAC that declares no sample count says the length is not known', () => {
  const read = facts(flac(44100, 0))
  assert.equal(read.durationMs, null)
  assert.match(read.notes.join(' '), /^Length not known/)
})

test('an MP3 that counts its own frames is exactly that long', () => {
  const read = facts(mp3WithXing(7350))
  assert.equal(read.kind, 'audio')
  assert.equal(read.format, 'mp3')
  assert.equal(read.durationMs, 192_000)
})

test('an MP3 with an ID3 tag in front of it is still found', () => {
  const tagged = bytes(chars('ID3'), [3, 0, 0], [0, 0, 0, 10], zeros(10), mp3WithXing(100))
  assert.equal(facts(tagged).durationMs, facts(mp3WithXing(100)).durationMs)
})

test('an MP3 with no count but frames all one size is worked out from its bitrate', () => {
  const read = facts(mp3Constant(10))
  assert.equal(read.durationMs, 261)
})

test('an MP3 whose frames are different sizes says the length is not known rather than averaging', () => {
  // The second frame declares 192 kbps where the first declared 128: nothing here can be divided.
  const other = bytes([0xff, 0xfb, 0xc0, 0x64], new Uint8Array(MP3_FRAME_BYTES - 4))
  const read = facts(bytes(bytes(MP3_FRAME, new Uint8Array(MP3_FRAME_BYTES - 4)), other))
  assert.equal(read.durationMs, null)
  assert.match(read.notes.join(' '), /Length not known/)
})

test('an AAC stream is as long as its frames counted', () => {
  const read = facts(aac(10))
  assert.equal(read.format, 'aac')
  assert.equal(read.durationMs, 232)
})

test('an Ogg Opus file takes its length from its last page, less the samples it throws away', () => {
  const read = facts(oggOpus(5))
  assert.equal(read.kind, 'audio')
  assert.equal(read.format, 'ogg')
  assert.equal(read.durationMs, 5000)
})

test('an Ogg Vorbis file takes its length from its last page and its own rate', () => {
  assert.equal(facts(oggVorbis(2)).durationMs, 2000)
})

test('an Ogg whose last page is not where the file ends says the length is not known', () => {
  // "OggS" turning up inside a payload must not be mistaken for the last page and read as a length.
  const read = facts(bytes(oggOpus(5), chars('OggS and some rubbish after the end')))
  assert.equal(read.durationMs, null)
  assert.match(read.notes.join(' '), /Length not known/)
})

test('a video inside an Ogg file is refused by name', () => {
  const read = refusal(oggTheora())
  assert.equal(read.error, 'not-media')
  assert.match(read.message, /video inside an Ogg/)
})

// ---------------------------------------------------------------- MP4, M4A, QuickTime, WebM

test('an MP4 with a picture track is a video, measured and timed from its own boxes', () => {
  const read = facts(mp4('isom', [trak('vide', 1280, 720), trak('soun')]))
  assert.equal(read.kind, 'video')
  assert.equal(read.format, 'mp4')
  assert.deepEqual([read.width, read.height], [1280, 720])
  assert.equal(read.durationMs, 4000)
})

test('a QuickTime brand is a QuickTime video', () => {
  assert.equal(facts(mp4('qt  ', [trak('vide', 640, 360)])).format, 'mov')
})

test('an MP4 with sound and no picture is a sound file, and says it is sound only', () => {
  const read = facts(mp4('M4A ', [trak('soun')]))
  assert.equal(read.kind, 'audio')
  assert.equal(read.format, 'm4a')
  assert.equal(read.width, null)
  assert.match(read.notes.join(' '), /Sound only/)
})

test('an MP4 with no movie header is damaged, and nothing is guessed from the file name', () => {
  const read = refusal(box('ftyp', [...chars('isom'), ...zeros(4)]))
  assert.equal(read.error, 'damaged')
  assert.match(read.message, /no movie header/)
})

test('an MP4 with neither a picture nor a sound track is damaged', () => {
  assert.equal(refusal(mp4('isom', [trak('sbtl')])).error, 'damaged')
})

test('an MP4 whose header says it does not know its length says so too', () => {
  const read = facts(mp4('isom', [trak('vide', 320, 240)], 1000, 0xffffffff))
  assert.equal(read.durationMs, null)
  assert.match(read.notes.join(' '), /Length not known/)
})

test('a WebM is read from its EBML elements', () => {
  const read = facts(webm({ durationTicks: 5000, width: 640, height: 480 }))
  assert.equal(read.kind, 'video')
  assert.equal(read.format, 'webm')
  assert.deepEqual([read.width, read.height], [640, 480])
  assert.equal(read.durationMs, 5000)
})

test('a WebM with no length in it says the length is not known', () => {
  const read = facts(webm({ durationTicks: null, width: 320, height: 240 }))
  assert.equal(read.durationMs, null)
  assert.match(read.notes.join(' '), /Length not known/)
})

test('a WebM with sound and no picture is a sound file, with its own media type', () => {
  const read = facts(webm({ durationTicks: 1000, sound: true }))
  assert.equal(read.kind, 'audio')
  assert.equal(read.mediaType, 'audio/webm')
  assert.equal(mediaName(read), 'WebM sound')
})

test('a Matroska file is refused by name rather than kept as a WebM', () => {
  const read = refusal(webm({ docType: 'matroska', durationTicks: 1000, width: 320, height: 240 }))
  assert.equal(read.error, 'not-media')
  assert.match(read.message, /Matroska/)
})

test('a WebM with no tracks at all is damaged', () => {
  assert.equal(refusal(webm({ durationTicks: 1000 })).error, 'damaged')
})

// ---------------------------------------------------------------- the refusals

test('an empty file, and a file of nothing in particular, are both refused in plain words', () => {
  assert.equal(refusal(new Uint8Array(0)).error, 'not-media')
  const read = refusal(bytes(chars('this is just some writing, not a picture at all')))
  assert.equal(read.error, 'not-media')
  assert.match(read.message, /Pictures: PNG, JPEG, GIF, WebP, BMP/)
})

test('an SVG is refused as markup, with the reason said', () => {
  const read = refusal(bytes(chars('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')))
  assert.equal(read.error, 'not-media')
  assert.match(read.message, /markup rather than a picture file/)
})

test('a PNG with no IHDR, and one that says it is nothing wide, are damaged', () => {
  assert.equal(refusal(bytes(PNG_SIGNATURE, chunk('IDAT', zeros(16)))).error, 'damaged')
  const read = refusal(png(0, 100))
  assert.equal(read.error, 'damaged')
  assert.match(read.message, /does not say how big/)
})

test('a JPEG with no start-of-frame marker is damaged', () => {
  assert.equal(refusal(bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], chars('JFIF'), zeros(12), [0xff, 0xd9])).error, 'damaged')
})

test('a header that claims an impossible size is not trusted', () => {
  const read = refusal(png(100_000, 100_000))
  assert.equal(read.error, 'damaged')
  assert.match(read.message, /cannot be trusted/)
})

test('a file past the ceiling for its kind is refused with both numbers in the sentence', () => {
  const big = new Uint8Array(MEDIA_LIMITS.image.bytes + 1)
  big.set(gif(10, 10), 0)
  const read = refusal(big)
  assert.equal(read.error, 'too-large')
  assert.match(read.message, /32\.0 MB Orbis keeps/)
})

test('a length longer than any real recording is dropped rather than shown', () => {
  // One byte a second, ninety thousand bytes: the header says twenty-five hours, which nothing here believes.
  const read = facts(wav(90_000, 1, 1, 8))
  assert.equal(read.durationMs, null)
  assert.match(read.notes.join(' '), /longer than any real recording/)
})

test('the ceilings are frozen, and sit under the 50 MB one opened file may be', () => {
  assert.equal(Object.isFrozen(MEDIA_LIMITS), true)
  assert.equal(Object.isFrozen(MEDIA_LIMITS.image), true)
  for (const kind of ['image', 'audio', 'video'] as const) assert.ok(MEDIA_LIMITS[kind].bytes < 50 * 1024 * 1024)
  assert.equal(Object.isFrozen(MEDIA_FORMATS), true)
  assert.equal(Object.isFrozen(MEDIA_FORMATS.png), true)
})

test('the family a file belongs to comes from its bytes', () => {
  assert.equal(familyOf(png(2, 2)), 'png')
  assert.equal(familyOf(jpeg(2, 2)), 'jpeg')
  assert.equal(familyOf(wav(8)), 'wav')
  assert.equal(familyOf(webpVp8x(2, 2)), 'webp')
  assert.equal(familyOf(bytes(chars('nothing at all here'))), null)
})

// ---------------------------------------------------------------- the words

test('a card gets one line that says what the thing is', () => {
  assert.equal(describeMedia(facts(png(1920, 1080))), `PNG picture, 1,920 × 1,080, ${png(1920, 1080).length} B`)
  assert.equal(describeMedia(facts(mp3WithXing(7350))), 'MP3 sound, 3 min 12 s')
  assert.equal(describeMedia(facts(mp4('isom', [trak('vide', 1280, 720)]))), 'MP4 video, 1,280 × 720, 4 s')
})

test('a length reads the way a person says one', () => {
  assert.equal(mediaLength(500), '0.5 s')
  assert.equal(mediaLength(45_000), '45 s')
  assert.equal(mediaLength(180_000), '3 min')
  assert.equal(mediaLength(192_000), '3 min 12 s')
  assert.equal(mediaLength(3_600_000), '1 h')
  assert.equal(mediaLength(3_864_000), '1 h 4 min')
})

test('a sound with no length falls back to saying how big it is', () => {
  assert.equal(describeMedia(facts(flac(44100, 0))), `FLAC sound, ${flac(44100, 0).length} B`)
})

test('a file name is the title made safe plus the extension the bytes earned', () => {
  assert.equal(mediaFileName('Holiday: the good one', 'jpeg'), 'Holiday the good one.jpg')
  assert.equal(mediaFileName('   ', 'png'), 'Picture.png')
  assert.equal(mediaExtension('mov'), '.mov')
})

// ---------------------------------------------------------------- the stored record

test('what is stored is the facts and where it came from, and no bytes', () => {
  const read = facts(png(320, 240))
  const body = mediaBodyOf(read, 'file: holiday.png')
  assert.equal(body.kind, 'image')
  const source = mediaIn(body)
  assert.equal(source.from, 'file: holiday.png')
  assert.deepEqual([source.width, source.height], [320, 240])
  assert.equal(source.hash, read.hash)
  // The whole record is a few hundred bytes of text, whatever the picture weighs.
  assert.ok(JSON.stringify(body).length < 1200)
  assert.equal(JSON.stringify(body).includes('base64'), false)
})

test('a sound and a video are kept under their own kinds', () => {
  assert.equal(mediaBodyOf(facts(wav(12_000)), 'file: a.wav').kind, 'audio')
  assert.equal(mediaBodyOf(facts(mp4('isom', [trak('vide', 2, 2)])), 'file: a.mp4').kind, 'video')
})

// ---------------------------------------------------------------- read back and checked

test('the same bytes read back pass every named check', () => {
  const file = png(1920, 1080)
  const read = facts(file)
  const result = verifyMedia(read, file)
  assert.equal(result.ok, true)
  assert.deepEqual(
    result.checks.map((one) => one.what),
    ['written', 'checksum', 'signature', 'read again', 'size']
  )
  assert.deepEqual(result.reimported, { rows: 1080, columns: 1920 })
})

test('one byte changed in the middle keeps the length and the signature and fails the checksum', () => {
  const file = png(64, 64)
  const read = facts(file)
  const changed = Uint8Array.from(file)
  changed[changed.length - 6] ^= 0xff
  const result = verifyMedia(read, changed)
  assert.equal(result.ok, false)
  assert.equal(result.checks.find((one) => one.what === 'checksum')?.passed, false)
  assert.equal(result.checks.find((one) => one.what === 'written')?.passed, true)
  assert.equal(result.checks.find((one) => one.what === 'signature')?.passed, true)
})

test('a file truncated on the way to disk fails on its length', () => {
  const file = png(64, 64)
  const read = facts(file)
  const result = verifyMedia(read, file.subarray(0, file.length - 4))
  assert.equal(result.ok, false)
  assert.equal(result.checks.find((one) => one.what === 'written')?.passed, false)
})

test('a file that is no longer the same kind fails on being read again', () => {
  const read = facts(png(64, 64))
  const result = verifyMedia(read, gif(64, 64))
  assert.equal(result.ok, false)
  assert.equal(result.checks.find((one) => one.what === 'read again')?.passed, false)
  assert.match(result.checks.find((one) => one.what === 'read again')!.describe, /GIF picture, not a PNG picture/)
})

test('a file with the right length and the wrong size fails on the size', () => {
  const read = facts(png(64, 64))
  const other = png(32, 128)
  const result = verifyMedia({ ...read, bytes: other.length, hash: facts(other).hash, signature: facts(other).signature }, other)
  assert.equal(result.ok, false)
  assert.equal(result.checks.find((one) => one.what === 'size')?.passed, false)
  assert.match(result.differences.join(' '), /size the file declares changed/)
})

test('a recording cut short fails on its length, in seconds a person reads', () => {
  const file = wav(12_000)
  const read = facts(file)
  const short = file.subarray(0, file.length - 6000)
  const result = verifyMedia({ ...read, bytes: short.length, hash: facts(short).hash, signature: facts(short).signature }, short)
  assert.equal(result.ok, false)
  const length = result.checks.find((one) => one.what === 'length')!
  assert.equal(length.passed, false)
  assert.match(length.describe, /750 ms|0\.8 s|750/)
})

test('what was never known is said to have not been checked, rather than passing quietly', () => {
  const file = flac(44100, 0)
  const result = verifyMedia(facts(file), file)
  assert.equal(result.ok, true)
  assert.match(result.checks.find((one) => one.what === 'length')!.describe, /never said how long/)
  assert.match(result.checks.find((one) => one.what === 'size')!.describe, /never said how big/)
})

test('a file read back as something that is not media at all fails and says what happened', () => {
  const result = verifyMedia(facts(png(8, 8)), bytes(chars('the disk gave back something else entirely')))
  assert.equal(result.ok, false)
  assert.match(result.checks.find((one) => one.what === 'read again')!.describe, /no longer a PNG picture/)
})
