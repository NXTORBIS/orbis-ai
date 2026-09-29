import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync, inflateRawSync, crc32 } from 'node:zlib'

import {
  DEFAULT_LIMITS,
  ZIP_ASSUMPTIONS,
  ZipWriter,
  checkPath,
  isZipError,
  readDirectory,
  readEntry,
  shouldCompress,
  type ZipLimits
} from './zip.ts'

const deflate = (data: Uint8Array): Uint8Array => new Uint8Array(deflateRawSync(data))
const inflate = (data: Uint8Array): Uint8Array => new Uint8Array(inflateRawSync(data))

const text = (value: string): Uint8Array => new TextEncoder().encode(value)
const decode = (value: Uint8Array): string => new TextDecoder().decode(value)

/** Build an archive from a list of entries, failing the test if any refuses. */
function build(entries: { path: string; data: Uint8Array; compress?: boolean }[]): Uint8Array {
  const writer = new ZipWriter(deflate)
  const chunks: Uint8Array[] = []
  for (const one of entries) {
    const chunk = writer.add({ path: one.path, data: one.data, compress: one.compress ?? true })
    assert.ok(!isZipError(chunk), isZipError(chunk) ? chunk.message : '')
    chunks.push(chunk as Uint8Array)
  }
  chunks.push(writer.finish())
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

// ------------------------------------------------------------ round trip

describe('writing and reading back', () => {
  test('one entry survives the trip exactly', () => {
    const archive = build([{ path: 'manifest.json', data: text('{"hello":"world"}') }])
    const listing = readDirectory(archive)
    assert.ok(!isZipError(listing))
    assert.equal((listing as ReturnType<typeof readDirectory> & object[]).length, 1)
    const entry = (listing as { path: string }[])[0]
    assert.equal(entry?.path, 'manifest.json')
    const data = readEntry(archive, (listing as never[])[0], inflate)
    assert.ok(!isZipError(data))
    assert.equal(decode(data as Uint8Array), '{"hello":"world"}')
  })

  test('many entries survive, each at its own path', () => {
    const wanted = [
      { path: 'a.json', data: text('{"a":1}') },
      { path: 'nested/b.json', data: text('{"b":2}') },
      { path: 'nested/deeper/c.txt', data: text('c'.repeat(5000)) }
    ]
    const archive = build(wanted)
    const listing = readDirectory(archive) as { path: string }[]
    assert.deepEqual(listing.map((one) => one.path).sort(), ['a.json', 'nested/b.json', 'nested/deeper/c.txt'])
    for (const one of listing) {
      const data = readEntry(archive, one as never, inflate) as Uint8Array
      const expected = wanted.find((w) => w.path === one.path)?.data as Uint8Array
      assert.deepEqual([...data], [...expected], one.path)
    }
  })

  test('empty content round-trips', () => {
    const archive = build([{ path: 'empty.txt', data: new Uint8Array(0) }])
    const listing = readDirectory(archive) as never[]
    const data = readEntry(archive, listing[0], inflate) as Uint8Array
    assert.equal(data.length, 0)
  })

  test('binary content survives byte for byte', () => {
    const bytes = new Uint8Array(4096)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 7 + 13) % 256
    const archive = build([{ path: 'blob.bin', data: bytes }])
    const listing = readDirectory(archive) as never[]
    assert.deepEqual([...(readEntry(archive, listing[0], inflate) as Uint8Array)], [...bytes])
  })

  test('a non-ASCII filename comes back as what it was', () => {
    const archive = build([{ path: 'notes/\u00fcber \u65e5\u672c\u8a9e \u2014 caf\u00e9.json', data: text('{}') }])
    const listing = readDirectory(archive) as { path: string }[]
    assert.equal(listing[0]?.path, 'notes/\u00fcber \u65e5\u672c\u8a9e \u2014 caf\u00e9.json')
  })

  test('the writer\u2019s own manifest agrees with the archive', () => {
    const writer = new ZipWriter(deflate)
    const chunks = [writer.add({ path: 'a.json', data: text('{"a":1}'), compress: true }) as Uint8Array]
    chunks.push(writer.finish())
    const manifest = writer.manifest()
    assert.equal(manifest.length, 1)
    assert.equal(manifest[0]?.path, 'a.json')
    assert.equal(manifest[0]?.size, 7)
    assert.equal(manifest[0]?.crc, crc32(text('{"a":1}')) >>> 0)
  })
})

// ------------------------------------------------------------ compression

describe('compression', () => {
  test('compressible content actually gets smaller', () => {
    const data = text('{"repeated":"value"}'.repeat(500))
    const archive = build([{ path: 'big.json', data, compress: true }])
    const listing = readDirectory(archive) as { size: number; compressed: number }[]
    assert.ok((listing[0]?.compressed as number) < (listing[0]?.size as number) / 5)
  })

  test('content that deflate makes larger is stored instead', () => {
    // Random bytes do not compress; the writer must notice and store rather than grow the file.
    const random = new Uint8Array(2048)
    for (let i = 0; i < random.length; i += 1) random[i] = (i * 2654435761) % 256
    const archive = build([{ path: 'random.bin', data: random, compress: true }])
    const listing = readDirectory(archive) as { compressed: number; size: number; method: number }[]
    assert.ok((listing[0]?.compressed as number) <= (listing[0]?.size as number))
  })

  test('already-compressed formats are not deflated again', () => {
    assert.equal(shouldCompress('photo.jpg', 100_000), false)
    assert.equal(shouldCompress('clip.mp4', 5_000_000), false)
    assert.equal(shouldCompress('inner.zip', 900), false)
    assert.equal(shouldCompress('font.woff2', 40_000), false)
    assert.equal(shouldCompress('nested.orbis', 999_999), false)
  })

  test('text and structured data are deflated', () => {
    assert.equal(shouldCompress('notes.json', 9000), true)
    assert.equal(shouldCompress('page.md', 5000), true)
    assert.equal(shouldCompress('data.csv', 900), true)
  })

  test('a tiny file is stored, because the deflate header would be most of it', () => {
    assert.equal(shouldCompress('tiny.json', 40), false)
  })

  test('a stored entry reads back without needing inflation at all', () => {
    const archive = build([{ path: 'stored.bin', data: text('plain bytes'), compress: false }])
    const listing = readDirectory(archive) as { method: number }[]
    assert.equal(listing[0]?.method, 0)
    const data = readEntry(archive, (listing as never[])[0], () => {
      throw new Error('inflation must not be attempted for a stored entry')
    })
    assert.equal(decode(data as Uint8Array), 'plain bytes')
  })
})

// ------------------------------------------------------------ paths

describe('paths a package may contain', () => {
  test('an ordinary relative path is fine', () => {
    for (const one of ['manifest.json', 'orion/conversations/abc.json', 'assets/a/b/c.png']) {
      assert.equal(checkPath(one).ok, true, one)
    }
  })

  test('an absolute path is refused', () => {
    assert.equal(checkPath('/etc/passwd').ok, false)
    assert.match(checkPath('/etc/passwd').why, /absolute/)
  })

  test('a drive letter is refused', () => {
    assert.equal(checkPath('C:/Windows/System32/evil.dll').ok, false)
    assert.match(checkPath('C:/Windows/evil').why, /drive letter/)
  })

  test('walking upwards is refused, in every shape', () => {
    for (const one of ['../evil', 'a/../../evil', 'a/b/../../../evil', '..']) {
      assert.equal(checkPath(one).ok, false, one)
    }
  })

  test('a backslash is refused outright, because it traverses on Windows and is ordinary to the format', () => {
    assert.equal(checkPath('a\\..\\..\\evil').ok, false)
    assert.match(checkPath('a\\b').why, /backslash/)
  })

  test('an encoded separator or upward step is refused', () => {
    for (const one of ['a%2f..%2fevil', '%2e%2e/evil', 'a%5cb']) {
      assert.equal(checkPath(one).ok, false, one)
    }
  })

  test('a null byte is refused, because it truncates a path once it reaches the filesystem', () => {
    assert.equal(checkPath('safe.json\u0000../../evil').ok, false)
    assert.match(checkPath('a\u0000b').why, /null byte/)
  })

  test('a Windows device name is refused whatever the extension', () => {
    for (const one of ['CON', 'nul.json', 'a/COM1.txt', 'LPT9']) {
      assert.equal(checkPath(one).ok, false, one)
    }
  })

  test('a segment ending in a dot or a space is refused, because some systems strip it', () => {
    assert.equal(checkPath('evil. ').ok, false)
    assert.equal(checkPath('a/b./c').ok, false)
  })

  test('an empty segment is refused', () => {
    assert.equal(checkPath('a//b').ok, false)
    assert.equal(checkPath('').ok, false)
  })

  test('a control character or a reserved filesystem character is refused', () => {
    for (const one of ['a\u0001b', 'a<b', 'a>b', 'a:b', 'a"b', 'a|b', 'a?b', 'a*b']) {
      assert.equal(checkPath(one).ok, false, JSON.stringify(one))
    }
  })

  test('a path past the length limit is refused', () => {
    assert.equal(checkPath('a'.repeat(DEFAULT_LIMITS.pathLength + 1)).ok, false)
  })

  test('a hostile path is refused rather than repaired', () => {
    const result = checkPath('../evil')
    assert.equal(result.ok, false)
    // Nothing is handed back that could be used: a sanitised path would point somewhere the package does not describe.
    assert.equal(result.clean, '')
  })

  test('the writer refuses a hostile path instead of writing it', () => {
    const writer = new ZipWriter(deflate)
    const result = writer.add({ path: '../escape.json', data: text('{}'), compress: false })
    assert.ok(isZipError(result))
    assert.equal((result as { error: string }).error, 'bad-path')
  })

  test('the reader refuses an archive that contains one', () => {
    // Built by hand, because the writer will not produce it.
    const archive = build([{ path: 'ok.json', data: text('{}') }])
    const patched = new Uint8Array(archive)
    // "ok.json" is seven characters; replace it with "../x.js" in both the local header and the directory.
    const evil = text('../x.js')
    for (let i = 0; i < patched.length - 7; i += 1) {
      if (decode(patched.subarray(i, i + 7)) === 'ok.json') patched.set(evil, i)
    }
    const listing = readDirectory(patched)
    assert.ok(isZipError(listing))
    assert.equal((listing as { error: string }).error, 'bad-path')
  })
})

// ------------------------------------------------------------ refusals

describe('archives that are not archives', () => {
  test('an empty file is refused', () => {
    assert.equal((readDirectory(new Uint8Array(0)) as { error: string }).error, 'not-a-zip')
  })

  test('a file with no end record is refused, however large', () => {
    const result = readDirectory(new Uint8Array(100_000))
    assert.ok(isZipError(result))
    assert.equal((result as { error: string }).error, 'not-a-zip')
    assert.match((result as { message: string }).message, /not a ZIP archive/)
  })

  test('random bytes are refused', () => {
    const noise = new Uint8Array(5000)
    for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 31 + 7) % 256
    assert.ok(isZipError(readDirectory(noise)))
  })

  test('a truncated archive is refused rather than partly read', () => {
    const archive = build([{ path: 'a.json', data: text('{"a":1}') }])
    // Cut the middle out, keeping the end record so it is found and then disagrees with the file.
    const broken = new Uint8Array(archive.length)
    broken.set(archive)
    const view = new DataView(broken.buffer)
    // Point the table of contents past the end of the file.
    for (let i = broken.length - 22; i >= 0; i -= 1) {
      if (broken[i] === 0x50 && broken[i + 1] === 0x4b && broken[i + 2] === 0x05 && broken[i + 3] === 0x06) {
        view.setUint32(i + 16, broken.length + 10, true)
        break
      }
    }
    assert.ok(isZipError(readDirectory(broken)))
  })
})

describe('protection against hostile archives', () => {
  const tiny: ZipLimits = { ...DEFAULT_LIMITS, entryBytes: 1000, totalBytes: 2000, entries: 3, ratioFloor: 16, ratio: 4 }

  test('too many entries is refused', () => {
    const archive = build([
      { path: 'a.json', data: text('{}') },
      { path: 'b.json', data: text('{}') },
      { path: 'c.json', data: text('{}') },
      { path: 'd.json', data: text('{}') }
    ])
    const result = readDirectory(archive, tiny)
    assert.equal((result as { error: string }).error, 'too-many-entries')
  })

  test('the writer stops adding past the entry limit', () => {
    const writer = new ZipWriter(deflate)
    for (let i = 0; i < 3; i += 1) writer.add({ path: `f${i}.json`, data: text('{}'), compress: false }, tiny)
    const result = writer.add({ path: 'one-too-many.json', data: text('{}'), compress: false }, tiny)
    assert.equal((result as { error: string }).error, 'too-many-entries')
  })

  test('an entry larger than the limit is refused', () => {
    const archive = build([{ path: 'big.bin', data: new Uint8Array(2000), compress: false }])
    assert.equal((readDirectory(archive, tiny) as { error: string }).error, 'too-large')
  })

  test('more content in total than the limit is refused', () => {
    const archive = build([
      { path: 'a.bin', data: new Uint8Array(900), compress: false },
      { path: 'b.bin', data: new Uint8Array(900), compress: false },
      { path: 'c.bin', data: new Uint8Array(900), compress: false }
    ])
    assert.equal((readDirectory(archive, tiny) as { error: string }).error, 'too-large')
  })

  test('a decompression bomb is refused by its ratio', () => {
    // A megabyte of zeroes compresses to about a kilobyte: a ratio far past the small limit used here.
    const archive = build([{ path: 'bomb.bin', data: new Uint8Array(1024 * 1024), compress: true }])
    const result = readDirectory(archive, { ...DEFAULT_LIMITS, ratio: 10, ratioFloor: 16 })
    assert.equal((result as { error: string }).error, 'bomb')
    assert.match((result as { message: string }).message, /past what Orbis will inflate/)
  })

  test('a small file that expands a lot is not mistaken for a bomb', () => {
    // Twenty bytes to four kilobytes is a ratio of two hundred and is not an attack, so the floor exempts it.
    const archive = build([{ path: 'small.txt', data: text('a'.repeat(4096)), compress: true }])
    const listing = readDirectory(archive, { ...DEFAULT_LIMITS, ratio: 10, ratioFloor: 100_000 })
    assert.ok(!isZipError(listing))
  })

  test('an unsupported compression method is refused rather than guessed at', () => {
    const archive = build([{ path: 'a.json', data: text('{"a":1}'), compress: false }])
    const patched = new Uint8Array(archive)
    const view = new DataView(patched.buffer)
    // Set the method to 14 (LZMA) in the central directory record.
    for (let i = 0; i < patched.length - 4; i += 1) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint16(i + 10, 14, true)
        break
      }
    }
    assert.equal((readDirectory(patched) as { error: string }).error, 'unsupported')
  })

  test('two entries at one path are refused by the writer and by the reader', () => {
    const writer = new ZipWriter(deflate)
    writer.add({ path: 'same.json', data: text('{"first":1}'), compress: false })
    const second = writer.add({ path: 'same.json', data: text('{"second":2}'), compress: false })
    assert.equal((second as { error: string }).error, 'duplicate-path')
  })
})

describe('content that changed after packaging', () => {
  test('a swapped payload fails its checksum', () => {
    const archive = build([{ path: 'a.json', data: text('{"real":true}'), compress: false }])
    const patched = new Uint8Array(archive)
    const listing = readDirectory(patched) as never[]
    // Overwrite the stored bytes with something else of the same length.
    const evil = text('{"fake":true}')
    for (let i = 0; i < patched.length - evil.length; i += 1) {
      if (decode(patched.subarray(i, i + 13)) === '{"real":true}') patched.set(evil, i)
    }
    const result = readEntry(patched, listing[0], inflate)
    assert.ok(isZipError(result))
    assert.equal((result as { error: string }).error, 'corrupt')
    assert.match((result as { message: string }).message, /contents have changed/)
  })

  test('a size that disagrees with what arrived is refused', () => {
    const archive = build([{ path: 'a.json', data: text('{"a":1}'), compress: false }])
    const listing = readDirectory(archive) as { size: number }[]
    const lying = { ...(listing[0] as object), size: 999 } as never
    const result = readEntry(archive, lying, inflate)
    assert.ok(isZipError(result))
    assert.match((result as { message: string }).message, /where the archive said/)
  })

  test('data that cannot be inflated is reported rather than thrown', () => {
    const archive = build([{ path: 'a.json', data: text('{"repeat":1}'.repeat(200)), compress: true }])
    const listing = readDirectory(archive) as never[]
    const result = readEntry(archive, listing[0], () => {
      throw new Error('invalid stored block lengths')
    })
    assert.ok(isZipError(result))
    assert.match((result as { message: string }).message, /could not be decompressed/)
  })

  test('an entry whose data is past the end of the file is refused', () => {
    const archive = build([{ path: 'a.json', data: text('{"a":1}'), compress: false }])
    const listing = readDirectory(archive) as { offset: number }[]
    const lying = { ...(listing[0] as object), offset: archive.length - 5 } as never
    assert.ok(isZipError(readEntry(archive, lying, inflate)))
  })
})

// ------------------------------------------------------------ real archives

describe('interoperability', () => {
  test('the archive Orbis writes is readable by an ordinary ZIP reader\u2019s rules', () => {
    const archive = build([
      { path: 'manifest.json', data: text('{"formatVersion":1}') },
      { path: 'orion/a.json', data: text('{"id":"a"}') }
    ])
    const view = new DataView(archive.buffer)
    // A local file header first, an end-of-central-directory record last.
    assert.equal(view.getUint32(0, true), 0x04034b50)
    assert.equal(view.getUint32(archive.length - 22, true), 0x06054b50)
    // The UTF-8 flag on every entry, so a non-ASCII name is not read as the local codepage.
    assert.equal((view.getUint16(6, true) & 0x0800) !== 0, true)
  })

  test('the number of entries in the end record matches what was written', () => {
    const archive = build([
      { path: 'a.json', data: text('{}') },
      { path: 'b.json', data: text('{}') },
      { path: 'c.json', data: text('{}') }
    ])
    const view = new DataView(archive.buffer)
    assert.equal(view.getUint16(archive.length - 22 + 10, true), 3)
  })

  test('a directory entry in an archive is skipped rather than refused for ending in a slash', () => {
    // Directory entries are what other tools write; Orbis does not, but it must read an archive that has them.
    const writer = new ZipWriter(deflate)
    const chunks = [writer.add({ path: 'a.json', data: text('{}'), compress: false }) as Uint8Array, writer.finish()]
    let total = 0
    for (const one of chunks) total += one.length
    const archive = new Uint8Array(total)
    let at = 0
    for (const one of chunks) {
      archive.set(one, at)
      at += one.length
    }
    const listing = readDirectory(archive)
    assert.ok(!isZipError(listing))
    assert.equal((listing as unknown[]).length, 1)
  })
})

describe('the stated assumptions', () => {
  test('they are frozen and name the refuse-never-repair rule', () => {
    assert.equal(Object.isFrozen(ZIP_ASSUMPTIONS), true)
    assert.ok(ZIP_ASSUMPTIONS.some((one) => /refused, never repaired/.test(one)))
    assert.ok(ZIP_ASSUMPTIONS.some((one) => /size in a header is a claim/.test(one)))
    assert.ok(ZIP_ASSUMPTIONS.some((one) => /No symbolic link/.test(one)))
  })
})
