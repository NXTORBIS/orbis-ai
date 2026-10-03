import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  importMedia,
  inspectMedia,
  mediaContext,
  mediaFromDataUrl,
  mediaPreview,
  mediaRendered,
  previewRefusal,
  isMediaRefusal,
  mediaIn,
  MEDIA_LIMITS,
  type MediaFacts,
  type MediaImport
} from './media.ts'

/* The files here are built by hand out of each format's own header, the same way the shared test does it. */

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
const chars = (text: string): number[] => [...text].map((one) => one.charCodeAt(0))
const zeros = (count: number): number[] => new Array(count).fill(0)

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

const chunk = (type: string, data: number[]): Uint8Array => {
  const body = bytes(chars(type), data)
  return bytes(be32(data.length), body, be32(crc32(body)))
}

const png = (width: number, height: number, pad = 0): Uint8Array =>
  bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunk('IHDR', [...be32(width), ...be32(height), 8, 2, 0, 0, 0]), chunk('IDAT', zeros(pad)), chunk('IEND', []))

const jpeg = (width: number, height: number): Uint8Array =>
  bytes([0xff, 0xd8], [0xff, 0xe0, 0x00, 0x10], chars('JFIF'), [0, 1, 1, 0, 0, 1, 0, 1, 0, 0], [0xff, 0xc0, 0x00, 0x0b, 0x08], be16(height), be16(width), [0x01, 0x01, 0x11, 0x00], [0xff, 0xd9])

const wav = (dataBytes: number): Uint8Array => {
  const fmt = bytes(chars('fmt '), le32(16), le16(1), le16(1), le32(8000), le32(8000), le16(1), le16(8))
  const data = bytes(chars('data'), le32(dataBytes), new Uint8Array(dataBytes))
  const body = bytes(fmt, data)
  return bytes(chars('RIFF'), le32(body.length + 4), chars('WAVE'), body)
}

const box = (type: string, body: Uint8Array | number[]): Uint8Array => {
  const data = Array.isArray(body) ? new Uint8Array(body) : body
  return bytes(be32(data.length + 8), chars(type), data)
}

const soundOnlyMp4 = (): Uint8Array => {
  const tkhd = box('tkhd', [...zeros(4), ...zeros(12), ...zeros(4), ...zeros(4), ...zeros(8), ...zeros(8), ...zeros(36), ...zeros(8)])
  const hdlr = box('hdlr', [...zeros(4), ...zeros(4), ...chars('soun'), ...zeros(12), 0])
  const trak = box('trak', bytes(tkhd, box('mdia', hdlr)))
  const mvhd = box('mvhd', [...zeros(4), ...zeros(8), ...be32(1000), ...be32(2000), ...zeros(80)])
  return bytes(box('ftyp', [...chars('M4A '), ...zeros(4)]), box('moov', bytes(mvhd, trak)))
}

const kept = (value: MediaImport | { error: string; message: string }): MediaImport => {
  if ('error' in value) throw new Error(`expected it to be kept, got: ${value.message}`)
  return value
}

const turnedAway = (value: { error: string; message: string } | unknown): { error: string; message: string } => {
  if (!value || typeof value !== 'object' || !('error' in value)) throw new Error('expected a refusal')
  return value as { error: string; message: string }
}

const read = (file: Uint8Array, name = 'x.png'): MediaFacts => {
  const facts = inspectMedia(name, file)
  if (isMediaRefusal(facts)) throw new Error(facts.message)
  return facts
}

// ---------------------------------------------------------------- the name against the bytes

test('a file whose name and bytes agree is read from its bytes', () => {
  const facts = read(png(800, 600), 'holiday.png')
  assert.equal(facts.format, 'png')
  assert.deepEqual([facts.width, facts.height], [800, 600])
})

test('a file whose name says one thing and whose bytes say another is refused, and the sentence says both', () => {
  const refusal = turnedAway(inspectMedia('holiday.png', jpeg(640, 480)))
  assert.equal(refusal.error, 'mismatch')
  assert.match(refusal.message, /holiday\.png/)
  assert.match(refusal.message, /JPEG picture/)
  assert.match(refusal.message, /\.jpg/)
})

test('a video file called a picture is refused the same way', () => {
  assert.equal(turnedAway(inspectMedia('clip.mp4', png(10, 10))).error, 'mismatch')
})

test('the MP4 family is one check: a sound-only MP4 called .m4a, .mp4 or .mov is all the same file', () => {
  for (const name of ['voice.m4a', 'voice.mp4', 'voice.mov']) {
    const facts = read(soundOnlyMp4(), name)
    assert.equal(facts.kind, 'audio')
    assert.equal(facts.format, 'm4a')
  }
})

test('a name that says nothing is accepted on the bytes, with a note saying that is what happened', () => {
  const made = kept(importMedia('IMG_0421', png(64, 64)))
  assert.match(made.notes.join(' '), /went by its first bytes/)
  assert.equal(mediaIn(made.body).format, 'png')
})

test('an SVG is still refused here, by the shared reader, before any name is looked at', () => {
  assert.equal(turnedAway(inspectMedia('logo.svg', bytes(chars('<svg width="8" height="8"></svg>')))).error, 'not-media')
})

// ---------------------------------------------------------------- what the engine is handed

test('a file read in gives a body, a title, where it came from, and the very bytes that arrived', () => {
  const file = png(1920, 1080)
  const made = kept(importMedia('Sunset over the bay.png', file))
  assert.equal(made.body.kind, 'image')
  assert.equal(made.title, 'Sunset over the bay')
  assert.equal(made.source, 'file: Sunset over the bay.png')
  assert.equal(made.format, 'png')
  assert.equal(made.bytes, file)
  assert.equal(made.describe, `PNG picture, 1,920 × 1,080, ${file.length} B`)
  assert.equal(made.notes[0], made.describe)
  assert.match(made.notes.join(' '), /byte for byte/)
})

test('a title given outright is the title, and a sound keeps its own kind', () => {
  const made = kept(importMedia('rec 12.wav', wav(8000), { title: 'The meeting' }))
  assert.equal(made.title, 'The meeting')
  assert.equal(made.body.kind, 'audio')
  assert.equal(mediaIn(made.body).durationMs, 1000)
})

test('a name a filesystem would not take is made safe without changing the bytes', () => {
  const made = kept(importMedia('holiday: the good one?.png', png(8, 8)))
  assert.equal(made.title, 'holiday the good one')
  assert.equal(made.bytes.length, png(8, 8).length)
})

// ---------------------------------------------------------------- a picture made in the chat

test('a picture made in the chat becomes one of these, with where it came from written down', () => {
  const file = png(768, 768)
  const url = `data:image/png;base64,${Buffer.from(file).toString('base64')}`
  const made = kept(mediaFromDataUrl(url, { title: 'a dragon reading a map', from: 'made in the chat from: a dragon reading a map' }))
  assert.equal(made.body.kind, 'image')
  assert.equal(made.title, 'a dragon reading a map')
  assert.equal(made.source, 'made in the chat from: a dragon reading a map')
  assert.deepEqual([...made.bytes], [...file])
})

test('what the data URL claims it is does not matter: the bytes are read', () => {
  const url = `data:image/png;base64,${Buffer.from(jpeg(512, 512)).toString('base64')}`
  const made = kept(mediaFromDataUrl(url, { title: 'a cat', from: 'made in the chat from: a cat' }))
  assert.equal(mediaIn(made.body).format, 'jpeg')
  assert.equal(mediaIn(made.body).mediaType, 'image/jpeg')
})

test('anything that is not one of the four picture types the chat makes is refused', () => {
  assert.equal(turnedAway(mediaFromDataUrl('data:image/tiff;base64,AAAA', { from: 'x' })).error, 'not-media')
  assert.equal(turnedAway(mediaFromDataUrl('https://example.com/cat.png', { from: 'x' })).error, 'not-media')
  assert.equal(turnedAway(mediaFromDataUrl('', { from: 'x' })).error, 'not-media')
})

// ---------------------------------------------------------------- what reaches the screen

test('a small picture gets a bounded preview, the same shape a drawing gets today', () => {
  const file = png(64, 64)
  const source = mediaIn(kept(importMedia('a.png', file)).body)
  const preview = mediaPreview(source, file)
  assert.match(preview, /^data:image\/png;base64,/)
  assert.equal(preview.slice('data:image/png;base64,'.length), Buffer.from(file).toString('base64'))
  assert.equal(previewRefusal(source), '')
})

test('a picture past the preview ceiling gets no preview, and the reason is said in words', () => {
  const file = png(64, 64, MEDIA_LIMITS.previewBytes)
  const source = mediaIn(kept(importMedia('big.png', file)).body)
  assert.equal(mediaPreview(source, file), '')
  assert.match(previewRefusal(source), /too large to show here/)
})

test('a sound and a video never hand their bytes to a window, and say why', () => {
  const file = wav(8000)
  const source = mediaIn(kept(importMedia('a.wav', file)).body)
  assert.equal(mediaPreview(source, file), '')
  assert.match(previewRefusal(source), /does not play it/)
  const clip = mediaIn(kept(importMedia('a.mp4', soundOnlyMp4())).body)
  assert.equal(mediaPreview(clip, soundOnlyMp4()), '')
})

// ---------------------------------------------------------------- the one write

test('what is handed to the write is the bytes unchanged, and words with no bytes in them', () => {
  const file = png(320, 240)
  const made = kept(importMedia('holiday.png', file))
  const rendered = mediaRendered(made.body, made.bytes, made.title)
  assert.equal(rendered.bytes, file)
  assert.equal(rendered.text, null)
  assert.equal(rendered.format, 'image')
  assert.equal(rendered.hash, mediaIn(made.body).hash)
  assert.deepEqual(rendered.size, { width: 320, height: 240 })
  assert.match(rendered.scan, /holiday/)
  assert.match(rendered.scan, /file: holiday\.png/)
  // The secret gate reads this. A picture's bytes have no words in them, and scanning them would only misfire.
  assert.equal(rendered.scan.includes('\u0089'), false)
  assert.ok(rendered.scan.length < 1000)
})

test('nothing is reported as lost, because nothing is converted', () => {
  const made = kept(importMedia('holiday.png', png(8, 8)))
  const rendered = mediaRendered(made.body, made.bytes)
  assert.equal(rendered.loss.lossy, false)
  assert.deepEqual(rendered.loss.losses, [])
})

test('a sound and a video are written with no size, because they have none to check', () => {
  const made = kept(importMedia('a.wav', wav(8000)))
  const rendered = mediaRendered(made.body, made.bytes)
  assert.equal(rendered.size, undefined)
  assert.equal(rendered.format, 'audio')
})

// ---------------------------------------------------------------- answering a question about one

test('a question about one of these is answered from the file, and says Orbis has not looked inside', () => {
  const made = kept(importMedia('holiday.png', png(1920, 1080)))
  const words = mediaContext(mediaIn(made.body), made.title)
  assert.match(words, /PNG picture/)
  assert.match(words, /1920 × 1080/)
  assert.match(words, /has not looked inside/)
  assert.match(words, /file: holiday\.png/)
})

test('a sound says it does not know how big it is rather than making a number up', () => {
  const made = kept(importMedia('a.wav', wav(8000)))
  const words = mediaContext(mediaIn(made.body), made.title)
  assert.match(words, /does not say how big it is/)
  assert.match(words, /Length: 1 seconds/)
})
