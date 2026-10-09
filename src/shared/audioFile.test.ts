import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { AUDIO_ENDINGS, readAudioFacts, sniff } from './audioFile.ts'

/**
 * These build real files, byte by byte, rather than standing in for them.
 *
 * A tag reader that is tested against something shaped roughly like an MP3 passes and then reads nothing from a real
 * one, so every case here lays out the actual structure: a synch-safe ID3 size, a real MPEG frame header, a Xing
 * header at the right offset after the side information, an `mvhd` with its own time scale, a FLAC STREAMINFO with
 * twenty bits of sample rate spanning three bytes. If the parser is wrong, these fail.
 */

const bytes = (...values: (number | number[] | string | Uint8Array)[]): Uint8Array => {
  const out: number[] = []
  for (const value of values) {
    if (typeof value === 'number') out.push(value & 0xff)
    else if (typeof value === 'string') for (const char of value) out.push(char.charCodeAt(0) & 0xff)
    // One at a time: spreading a long array into `push` overflows the stack, which is how the WAV case first failed.
    else for (const n of value) out.push(n & 0xff)
  }
  return new Uint8Array(out)
}

const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const be24 = (n: number): number[] => [(n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const be16 = (n: number): number[] => [(n >>> 8) & 0xff, n & 0xff]
const le32 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
/** Seven bits per byte, the way ID3 writes a size so it can never look like audio. */
const synchSafe = (n: number): number[] => [(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f]

// ---------------------------------------------------------------- MP3

/** One ID3v2.3 text frame. */
const textFrame = (name: string, text: string): Uint8Array => {
  const body = bytes(0x03, text) // 0x03 = UTF-8
  return bytes(name, be32(body.length), [0, 0], body)
}

const id3 = (...frames: Uint8Array[]): Uint8Array => {
  const body = bytes(...frames)
  return bytes('ID3', [3, 0], 0x00, synchSafe(body.length), body)
}

/**
 * A 128 kbps, 44.1 kHz, stereo, MPEG-1 Layer III frame: 417 bytes, 1152 samples.
 * 0xFF 0xFB = all sync bits, MPEG-1, Layer III, no CRC. 0x90 = 128 kbps at 44.1 kHz. 0x00 = stereo.
 */
const mp3Frame = (fill = 0): Uint8Array => bytes([0xff, 0xfb, 0x90, 0x00], new Uint8Array(413).fill(fill))

/** The same frame, with a Xing header written where a decoder looks for it: after 32 bytes of side information. */
const mp3FrameWithXing = (frames: number): Uint8Array => {
  const head = bytes([0xff, 0xfb, 0x90, 0x00])
  const side = new Uint8Array(32)
  const xing = bytes('Xing', be32(0x01), be32(frames))
  const padding = new Uint8Array(417 - head.length - side.length - xing.length)
  return bytes(head, side, xing, padding)
}

test('an MP3 is recognised by its bytes, and its tags are read', () => {
  const file = bytes(
    id3(textFrame('TIT2', 'Blinding Lights'), textFrame('TPE1', 'The Weeknd'), textFrame('TALB', 'After Hours'), textFrame('TRCK', '9/14'), textFrame('TYER', '2020'), textFrame('TCON', 'Synthwave')),
    mp3Frame()
  )
  assert.equal(sniff(file), 'mp3')
  const facts = readAudioFacts(file)
  assert.equal(facts.tags.title, 'Blinding Lights')
  assert.equal(facts.tags.artist, 'The Weeknd')
  assert.equal(facts.tags.album, 'After Hours')
  assert.equal(facts.tags.trackNumber, 9, '"9/14" means the ninth')
  assert.equal(facts.tags.year, 2020)
  assert.equal(facts.tags.genre, 'Synthwave')
})

test('the length of an MP3 comes from the encoder when it wrote one, exactly', () => {
  // 7000 frames of 1152 samples at 44100 = 182.857... seconds.
  const facts = readAudioFacts(bytes(id3(textFrame('TIT2', 'x')), mp3FrameWithXing(7000)))
  assert.ok(facts.duration)
  assert.ok(Math.abs(facts.duration! - (7000 * 1152) / 44100) < 0.01, String(facts.duration))
})

test('without a header the frames are counted, never worked out from the file size', () => {
  const file = bytes(id3(textFrame('TIT2', 'x')), mp3Frame(1), mp3Frame(2), mp3Frame(3))
  const facts = readAudioFacts(file)
  const perFrame = 1152 / 44100
  assert.ok(Math.abs((facts.duration ?? 0) - 3 * perFrame) < 0.001, String(facts.duration))

  // Padding the file out with silence that is not audio must not lengthen it.
  const padded = bytes(file, new Uint8Array(50_000).fill(0))
  assert.ok(Math.abs((readAudioFacts(padded).duration ?? 0) - 3 * perFrame) < 0.001, 'the file size is not the length')
})

test('artwork is read out of an APIC frame, with the picture\'s own bytes', () => {
  const picture = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
  const apicBody = bytes(0x00, 'image/jpeg', 0x00, 0x03, 'Cover', 0x00, picture)
  const apic = bytes('APIC', be32(apicBody.length), [0, 0], apicBody)
  const facts = readAudioFacts(bytes(id3(textFrame('TIT2', 'x'), apic), mp3Frame()))
  assert.equal(facts.artwork?.mime, 'image/jpeg')
  assert.deepEqual([...(facts.artwork?.bytes ?? [])], [...picture])
})

test('a 2.4 tag whose size was written the wrong way is still read', () => {
  // Some encoders write a plain size where 2.4 asks for a synch-safe one. A reader that cannot cope loses the tags.
  const body = bytes(0x03, 'Starboy')
  const frame = bytes('TIT2', be32(body.length), [0, 0], body)
  const tag = bytes('ID3', [4, 0], 0x00, synchSafe(frame.length), frame)
  assert.equal(readAudioFacts(bytes(tag, mp3Frame())).tags.title, 'Starboy')
})

test('a Latin-1 tag and a UTF-16 tag both come back as the words they hold', () => {
  const latin = bytes('TIT2', be32(5), [0, 0], 0x00, 'Café')
  // UTF-16 little-endian with a byte-order mark, which is what Windows encoders write.
  const utf16Body = bytes(0x01, [0xff, 0xfe], 0x43, 0x00, 0x61, 0x00, 0x66, 0x00, 0xe9, 0x00)
  const utf16 = bytes('TPE1', be32(utf16Body.length), [0, 0], utf16Body)
  const facts = readAudioFacts(bytes(id3(latin, utf16), mp3Frame()))
  assert.equal(facts.tags.title, 'Café')
  assert.equal(facts.tags.artist, 'Café')
})

// ---------------------------------------------------------------- MP4 / M4A

const box = (type: string, ...content: (number | number[] | string | Uint8Array)[]): Uint8Array => {
  const body = bytes(...content)
  return bytes(be32(body.length + 8), type, body)
}

const ilstItem = (type: string, kind: number, ...value: (number | number[] | string | Uint8Array)[]): Uint8Array =>
  box(type, box('data', be32(kind), be32(0), bytes(...value)))

test('an M4A gives an exact length from its time scale, and the tags iTunes writes', () => {
  const picture = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9])
  const file = bytes(
    box('ftyp', 'M4A ', be32(0)),
    box(
      'moov',
      // mvhd version 0: four bytes of version/flags, created, modified, then the scale and the count.
      box('mvhd', be32(0), be32(0), be32(0), be32(1000), be32(201_500)),
      box(
        'udta',
        box(
          'meta',
          be32(0),
          box(
            'ilst',
            ilstItem('©nam', 1, 'Save Your Tears'),
            ilstItem('©ART', 1, 'The Weeknd'),
            ilstItem('©alb', 1, 'After Hours'),
            ilstItem('©day', 1, '2020-03-20'),
            ilstItem('trkn', 0, be16(0), be16(11), be16(14), be16(0)),
            ilstItem('covr', 14, picture)
          )
        )
      )
    )
  )
  assert.equal(sniff(file), 'mp4')
  const facts = readAudioFacts(file)
  assert.ok(Math.abs((facts.duration ?? 0) - 201.5) < 0.001, String(facts.duration))
  assert.equal(facts.tags.title, 'Save Your Tears')
  assert.equal(facts.tags.artist, 'The Weeknd')
  assert.equal(facts.tags.year, 2020, 'a date becomes the year it is in')
  assert.equal(facts.tags.trackNumber, 11)
  assert.equal(facts.artwork?.mime, 'image/png')
  assert.deepEqual([...(facts.artwork?.bytes ?? [])], [...picture])
})

test('an MP4 inside a file called .mp3 is read as an MP4, because the name is never consulted', () => {
  const file = bytes(box('ftyp', 'M4A ', be32(0)), box('moov', box('mvhd', be32(0), be32(0), be32(0), be32(600), be32(6000))))
  assert.equal(sniff(file), 'mp4')
  assert.equal(readAudioFacts(file).duration, 10)
})

// ---------------------------------------------------------------- FLAC

const vorbisComments = (...lines: string[]): Uint8Array => {
  const vendor = 'orbis'
  const parts: Uint8Array[] = [bytes(le32(vendor.length), vendor), bytes(le32(lines.length))]
  for (const line of lines) {
    const encoded = new TextEncoder().encode(line)
    parts.push(bytes(le32(encoded.length), encoded))
  }
  return bytes(...parts)
}

test('a FLAC gives its length to the sample, its comments, and its picture', () => {
  // STREAMINFO: sample rate is twenty bits starting half way through byte 12; total samples is thirty-six bits.
  const rate = 44100
  const samples = 8_820_000 // exactly 200 seconds
  const streamInfo = bytes(
    be16(4096),
    be16(4096),
    be24(0),
    be24(0),
    // rate (20 bits) | channels-1 (3) | bits-1 (5) | samples (36)
    (rate >>> 12) & 0xff,
    (rate >>> 4) & 0xff,
    ((rate & 0x0f) << 4) | (1 << 1) | 0,
    Math.floor(samples / 2 ** 32) & 0x0f,
    be32(samples >>> 0),
    new Uint8Array(16)
  )
  const comments = vorbisComments('TITLE=After Hours', 'ARTIST=The Weeknd', 'ALBUM=After Hours', 'DATE=2020', 'TRACKNUMBER=14')
  const picture = new Uint8Array([0xff, 0xd8, 7, 7, 7])
  const pictureBlock = bytes(be32(3), be32(10), 'image/jpeg', be32(0), new Uint8Array(16), be32(picture.length), picture)
  const file = bytes(
    'fLaC',
    0x00,
    be24(streamInfo.length),
    streamInfo,
    0x04,
    be24(comments.length),
    comments,
    0x86,
    be24(pictureBlock.length),
    pictureBlock
  )
  assert.equal(sniff(file), 'flac')
  const facts = readAudioFacts(file)
  assert.ok(Math.abs((facts.duration ?? 0) - 200) < 0.0001, String(facts.duration))
  assert.equal(facts.tags.title, 'After Hours')
  assert.equal(facts.tags.trackNumber, 14)
  assert.equal(facts.tags.year, 2020)
  assert.deepEqual([...(facts.artwork?.bytes ?? [])], [...picture])
})

// ---------------------------------------------------------------- OGG

const oggPage = (granule: number, body: Uint8Array): Uint8Array => {
  const segments: number[] = []
  let left = body.length
  while (left >= 255) {
    segments.push(255)
    left -= 255
  }
  segments.push(left)
  return bytes('OggS', 0x00, 0x00, le32(granule), le32(0), le32(0), le32(0), le32(0), segments.length, segments, body)
}

test('an OGG Vorbis gives its length from the last page and its names from the comment header', () => {
  const identification = bytes(0x01, 'vorbis', le32(0), 0x02, le32(48000))
  const comments = bytes(0x03, 'vorbis', vorbisComments('TITLE=Starboy', 'ARTIST=The Weeknd'))
  // 48000 samples per second, so a granule of 4 800 000 is one hundred seconds.
  const file = bytes(oggPage(0, identification), oggPage(0, comments), oggPage(4_800_000, new Uint8Array(10)))
  assert.equal(sniff(file), 'ogg')
  const facts = readAudioFacts(file)
  assert.equal(facts.tags.title, 'Starboy')
  assert.ok(Math.abs((facts.duration ?? 0) - 100) < 0.001, String(facts.duration))
})

test('an Opus file is counted at 48 kHz whatever it was encoded at', () => {
  const head = bytes('OpusHead', 0x01, 0x02, be16(0), le32(16000), be16(0), 0x00)
  const tags = bytes('OpusTags', vorbisComments('TITLE=Quiet'))
  const file = bytes(oggPage(0, head), oggPage(0, tags), oggPage(960_000, new Uint8Array(4)))
  const facts = readAudioFacts(file)
  assert.equal(facts.tags.title, 'Quiet')
  assert.ok(Math.abs((facts.duration ?? 0) - 20) < 0.001, String(facts.duration))
})

// ---------------------------------------------------------------- WAV

test('a WAV gives its length from the data it actually holds', () => {
  const byteRate = 44100 * 2 * 2
  const audio = new Uint8Array(byteRate * 3) // three seconds
  const fmt = bytes(be16(0), le32(0), le32(byteRate), le32(0), be32(0))
  const file = bytes(
    'RIFF',
    le32(0),
    'WAVE',
    'fmt ',
    le32(16),
    bytes([1, 0], [2, 0], le32(44100), le32(byteRate), [4, 0], [16, 0]),
    'data',
    le32(audio.length),
    audio
  )
  void fmt
  assert.equal(sniff(file), 'wav')
  assert.ok(Math.abs((readAudioFacts(file).duration ?? 0) - 3) < 0.01, String(readAudioFacts(file).duration))
})

// ---------------------------------------------------------------- what is not an audio file

test('something that is not audio says so, rather than being added as a healthy track', () => {
  const facts = readAudioFacts(new TextEncoder().encode('This is a text file, not a song at all.'))
  assert.equal(facts.kind, 'unknown')
  assert.equal(facts.duration, null)
  assert.match(facts.problem ?? '', /not an audio file Orbis can read/)
})

test('a file that stops half way gives back what was read and says the rest could not be', () => {
  const file = bytes(id3(textFrame('TIT2', 'Half a song')), [0xff, 0xfb])
  const facts = readAudioFacts(file)
  assert.equal(facts.tags.title, 'Half a song', 'the tag was whole, so it is kept')
  assert.equal(facts.duration, null, 'and the length is not known, rather than zero')
  assert.match(facts.problem ?? '', /length of this file could not be read/)
})

test('nothing throws, whatever the bytes are', () => {
  for (const file of [new Uint8Array(0), new Uint8Array(3), new Uint8Array(200).fill(0xff), bytes('ID3', [3, 0], 0, synchSafe(99999))]) {
    const facts = readAudioFacts(file)
    assert.ok(typeof facts.kind === 'string')
    assert.ok(facts.duration === null || facts.duration >= 0)
  }
})

test('the endings offered in a picker are the kinds that are actually read', () => {
  assert.ok(AUDIO_ENDINGS.includes('mp3'))
  assert.ok(AUDIO_ENDINGS.includes('flac'))
  assert.ok(AUDIO_ENDINGS.includes('opus'))
  assert.equal(AUDIO_ENDINGS.includes('wma' as never), false, 'nothing is offered that Orbis cannot read')
})
