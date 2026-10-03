import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import {
  agreedToSend,
  isPicturesError,
  looksScanned,
  pagePicturesIn,
  readPictures,
  SCANNED_LIMITS,
  type PagePicture,
  type PictureReaderDeps,
  type ReadOutcome,
  type SeenWords
} from './scanned.ts'

/*
 * The PDFs in here are built by hand, byte for byte, because that is the only way to be sure what the reader is being
 * given: a scanner's output is one photograph per page inside a file whose cross-reference table is often wrong, and a
 * fixture read out of some other library would be testing that library instead.
 */

const latin = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1')
const bytesOf = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'latin1'))

/** A small but real JPEG: the start marker, a JFIF header, filler, and the end marker. */
function jpeg(size = 80): Uint8Array {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]
  const filler = Array.from({ length: Math.max(0, size - head.length - 2) }, (_, i) => (i % 240) + 1)
  return new Uint8Array([...head, ...filler, 0xff, 0xd9])
}

/** One object, numbered, as it is written in the file. */
const pdf = (objects: [number, string][], trailer: string, header = '%PDF-1.7\n'): Uint8Array =>
  bytesOf(`${header}${objects.map(([num, body]) => `${num} 0 obj\n${body}\nendobj\n`).join('')}trailer\n${trailer}\n%%EOF\n`)

const imageObject = (data: Uint8Array, width: number, height: number, filter = '/DCTDecode'): string =>
  `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter ${filter} /Length ${data.length} >>\nstream\n${latin(data)}\nendstream`

const pageObject = (parent: number, image: number): string =>
  `<< /Type /Page /Parent ${parent} 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 ${image} 0 R >> >> >>`

/** A scan of `pages` pages, each page one JPEG, with the page tree spelled out. */
function scan(pages: number): Uint8Array {
  const objects: [number, string][] = [
    [1, `<< /Type /Catalog /Pages 2 0 R >>`],
    [2, `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ')}] /Count ${pages} >>`]
  ]
  for (let i = 0; i < pages; i++) objects.push([3 + i, pageObject(2, 3 + pages + i)])
  for (let i = 0; i < pages; i++) objects.push([3 + pages + i, imageObject(jpeg(120 + i), 1700, 2200)])
  return pdf(objects, '<< /Root 1 0 R >>')
}

const pictures = (bytes: Uint8Array): PagePicture[] => {
  const out = pagePicturesIn(bytes)
  if (isPicturesError(out)) throw new Error(`${out.error}: ${out.message}`)
  return out.pictures
}

// ---------------------------------------------------------------- lifting the pictures out

test('a one-page scan gives up its JPEG, with the size the PDF declares', () => {
  const out = pagePicturesIn(scan(1))
  assert.ok(!isPicturesError(out))
  if (isPicturesError(out)) return
  assert.equal(out.pictures.length, 1)
  assert.equal(out.pictures[0].page, 1)
  assert.equal(out.pictures[0].width, 1700)
  assert.equal(out.pictures[0].height, 2200)
  assert.equal(out.pictures[0].bytes[0], 0xff)
  assert.equal(out.pictures[0].bytes[1], 0xd8)
  assert.equal(out.pictures[0].bytes.length, 120)
  assert.ok(/order the PDF shows its pages/.test(out.note), out.note)
  assert.deepEqual(out.skipped, [])
})

test('the page tree decides the order, not where the pictures sit in the file', () => {
  // Page 1 points at the LAST image object and page 2 at the first, so file order would come back reversed.
  const first = jpeg(200)
  const second = jpeg(300)
  const bytes = pdf(
    [
      [1, '<< /Type /Catalog /Pages 2 0 R >>'],
      [2, '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>'],
      [3, pageObject(2, 6)],
      [4, pageObject(2, 5)],
      [5, imageObject(second, 1000, 1400)],
      [6, imageObject(first, 1700, 2200)]
    ],
    '<< /Root 1 0 R >>'
  )
  const out = pictures(bytes)
  assert.deepEqual(out.map((one) => one.page), [1, 2])
  assert.equal(out[0].bytes.length, first.length)
  assert.equal(out[1].bytes.length, second.length)
})

test('a page tree hidden in a compressed object stream is still followed', () => {
  const pages = '<< /Type /Pages /Kids [4 0 R] /Count 1 >>'
  const page = pageObject(3, 5)
  const body = `${pages} ${page}`
  const head = `3 0 4 ${pages.length + 1} `
  const packed = new Uint8Array(deflateSync(Buffer.from(head + body, 'latin1')))
  const bytes = pdf(
    [
      [1, '<< /Type /Catalog /Pages 3 0 R >>'],
      [2, `<< /Type /ObjStm /N 2 /First ${head.length} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n${latin(packed)}\nendstream`],
      [5, imageObject(jpeg(150), 1700, 2200)]
    ],
    '<< /Root 1 0 R >>'
  )
  const out = pagePicturesIn(bytes)
  assert.ok(!isPicturesError(out))
  if (isPicturesError(out)) return
  assert.equal(out.pictures.length, 1)
  assert.equal(out.pictures[0].page, 1, 'the page came out of the object stream')
  assert.ok(/order the PDF shows its pages/.test(out.note), out.note)
})

test('with no page tree to follow the pictures are in file order, and the note says so', () => {
  const bytes = pdf([[1, imageObject(jpeg(150), 1700, 2200)], [2, imageObject(jpeg(160), 1700, 2200)]], '<< /Size 3 >>')
  const out = pagePicturesIn(bytes)
  assert.ok(!isPicturesError(out))
  if (isPicturesError(out)) return
  assert.equal(out.pictures.length, 2)
  assert.deepEqual(out.pictures.map((one) => one.page), [1, 2])
  assert.ok(/did not say which picture belongs to which page/.test(out.note), out.note)
})

test('a locked PDF is refused in words, and nothing is lifted out of it', () => {
  const bytes = pdf([[1, imageObject(jpeg(), 1700, 2200)]], '<< /Root 1 0 R /Encrypt 9 0 R >>')
  const out = pagePicturesIn(bytes)
  assert.ok(isPicturesError(out))
  if (!isPicturesError(out)) return
  assert.equal(out.error, 'encrypted')
  assert.ok(/locked/.test(out.message), out.message)
})

test('a file that does not begin as a PDF is refused', () => {
  const out = pagePicturesIn(bytesOf('just some text, honestly'))
  assert.ok(isPicturesError(out))
  if (!isPicturesError(out)) return
  assert.ok(/does not begin the way a PDF does/.test(out.message))
})

test('an empty file is refused', () => {
  const out = pagePicturesIn(new Uint8Array())
  assert.ok(isPicturesError(out))
})

test('JPEG 2000, fax and JBIG2 scans are counted and named, never dropped quietly', () => {
  const bytes = pdf(
    [
      [1, imageObject(jpeg(90), 1700, 2200, '/JPXDecode')],
      [2, imageObject(jpeg(90), 1700, 2200, '/JPXDecode')],
      [3, imageObject(jpeg(90), 1700, 2200, '/CCITTFaxDecode')],
      [4, imageObject(jpeg(90), 1700, 2200, '/JBIG2Decode')]
    ],
    '<< /Size 5 >>'
  )
  const out = pagePicturesIn(bytes)
  assert.ok(!isPicturesError(out))
  if (isPicturesError(out)) return
  assert.equal(out.pictures.length, 0)
  const said = out.skipped.join(' ')
  assert.ok(/2 pages are stored as JPEG 2000/.test(said), said)
  assert.ok(/fax/.test(said), said)
  assert.ok(/JBIG2/.test(said), said)
  assert.equal(out.skipped.filter((one) => /cannot read/.test(one)).length, 3)
  assert.ok(/No page picture could be lifted out/.test(out.note))
})

test('a page stored as raw pixels is named rather than passed off as a photograph', () => {
  const bytes = pdf([[1, imageObject(jpeg(90), 1700, 2200, '/FlateDecode')]], '<< /Size 2 >>')
  const out = pagePicturesIn(bytes)
  assert.ok(!isPicturesError(out))
  if (isPicturesError(out)) return
  assert.equal(out.pictures.length, 0)
  assert.equal(out.skipped.join(' '), '1 picture in it is raw pixels rather than photographs, which Orbis cannot turn into a page picture to read.')
})

test('something called an image that does not begin as a JPEG is not handed on as one', () => {
  const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
  const bytes = pdf([[1, imageObject(junk, 1700, 2200)]], '<< /Size 2 >>')
  const out = pagePicturesIn(bytes)
  assert.ok(!isPicturesError(out))
  if (isPicturesError(out)) return
  assert.equal(out.pictures.length, 0)
  assert.equal(out.skipped.join(' '), '1 picture in it is not beginning the way a JPEG does.')
})

test('a stream with an indirect length is still read to its end', () => {
  const data = jpeg(140)
  const bytes = pdf(
    [
      [1, '<< /Type /Catalog /Pages 2 0 R >>'],
      [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
      [3, pageObject(2, 4)],
      [4, `<< /Type /XObject /Subtype /Image /Width 800 /Height 1000 /Filter /DCTDecode /Length 5 0 R >>\nstream\n${latin(data)}\nendstream`],
      [5, `${data.length}`]
    ],
    '<< /Root 1 0 R >>'
  )
  const out = pictures(bytes)
  assert.equal(out.length, 1)
  assert.equal(out[0].bytes.length, data.length)
})

test('a JPEG the writer also deflated is unwrapped once', () => {
  const data = jpeg(130)
  const packed = new Uint8Array(deflateSync(Buffer.from(data)))
  const bytes = pdf(
    [
      [
        1,
        `<< /Type /XObject /Subtype /Image /Width 900 /Height 1200 /Filter [/FlateDecode /DCTDecode] /Length ${packed.length} >>\nstream\n${latin(packed)}\nendstream`
      ]
    ],
    '<< /Size 2 >>'
  )
  const out = pictures(bytes)
  assert.equal(out.length, 1)
  assert.equal(out[0].bytes.length, data.length)
  assert.equal(out[0].bytes[0], 0xff)
})

// ---------------------------------------------------------------- is it a scan at all?

test('little text and one big picture a page is a scan; text in it is not', () => {
  const shots = pictures(scan(3))
  assert.equal(looksScanned({ pages: 3, characters: 0 }, shots).scanned, true)
  assert.equal(looksScanned({ pages: 3, characters: 14 }, shots).scanned, true, 'a stray watermark is still a scan')
  const withText = looksScanned({ pages: 3, characters: 9000 }, shots)
  assert.equal(withText.scanned, false)
  assert.ok(/has text in it to read/.test(withText.why), withText.why)
})

test('one photograph in a twenty-page report is not a scan', () => {
  const only = pictures(scan(1))
  const out = looksScanned({ pages: 20, characters: 0 }, only)
  assert.equal(out.scanned, false)
  assert.ok(/no page-sized picture on 19 of its 20 pages/.test(out.why), out.why)
})

test('a small picture is not a page', () => {
  const small: PagePicture[] = [{ page: 1, bytes: jpeg(400), width: 64, height: 64 }]
  assert.equal(looksScanned({ pages: 1, characters: 0 }, small).scanned, false)
})

test('looksScanned refuses to answer when the page count is not known', () => {
  assert.equal(looksScanned({ pages: 0, characters: 0 }, []).scanned, false)
})

// ---------------------------------------------------------------- reading them, only with a yes

const shot = (page: number): PagePicture => ({ page, bytes: jpeg(120), width: 1700, height: 2200 })

/** The sentence a refusal came back with, whichever kind of refusal it is. */
const said = (out: ReadOutcome): string => (out.ok ? '' : out.needs === 'consent' ? out.ask : out.message)

/** A stand-in for the vision call that records what it was shown. */
function fakeEyes(answer: (at: number, page: number) => SeenWords): PictureReaderDeps & { sent: number[]; told: string[] } {
  const sent: number[] = []
  const told: string[] = []
  return {
    sent,
    told,
    concurrency: 2,
    see: async (picture, instruction) => {
      told.push(instruction)
      const at = sent.length
      sent.push(picture.bytes.length)
      assert.equal(picture.mediaType, 'image/jpeg')
      return answer(at, at + 1)
    }
  }
}

test('without a yes nothing is sent, and the words to ask with come back', async () => {
  const eyes = fakeEyes(() => ({ words: 'never asked' }))
  const out = await readPictures([shot(1), shot(2), shot(3)], eyes, undefined)
  assert.equal(out.ok, false)
  if (out.ok) return
  assert.equal(out.needs, 'consent')
  if (out.needs !== 'consent') return
  assert.equal(out.pages, 3)
  assert.equal(out.to, 'Mistral')
  assert.ok(/3 pages are pictures/.test(out.ask), out.ask)
  assert.ok(/all 3 pictures/.test(out.ask), out.ask)
  assert.ok(/Mistral, the service whose key is in your settings/.test(out.ask), out.ask)
  assert.ok(/Nothing is sent unless you say yes\./.test(out.ask), out.ask)
  assert.ok(/may be wrong/.test(out.ask), out.ask)
  assert.deepEqual(eyes.sent, [], 'not one picture left the computer')
})

test('a yes given for some other service is not a yes for this one', async () => {
  const eyes = fakeEyes(() => ({ words: 'never asked' }))
  for (const said of [{ agreed: true, to: 'Groq' }, { agreed: 'yes', to: 'Mistral' }, { to: 'Mistral' }, true, 'yes']) {
    assert.equal(agreedToSend(said), false)
    const out = await readPictures([shot(1)], eyes, said)
    assert.equal(out.ok, false)
    if (!out.ok) assert.equal(out.needs, 'consent')
  }
  assert.deepEqual(eyes.sent, [])
  assert.equal(agreedToSend({ agreed: true, to: 'Mistral' }), true)
})

test('with a yes the pages are read in order, with a heading each and the note at the top', async () => {
  const eyes = fakeEyes((at) => ({ words: `Words from page ${at + 1}.\n\nA second paragraph.` }))
  const out = await readPictures([shot(1), shot(2)], eyes, { agreed: true, to: 'Mistral' })
  assert.equal(out.ok, true)
  if (!out.ok) return
  assert.deepEqual(out.read, [1, 2])
  assert.deepEqual(out.notRead, [])
  assert.equal(out.table, null)
  const blocks = out.blocks ?? []
  assert.equal(blocks[0].kind, 'callout')
  if (blocks[0].kind === 'callout') assert.ok(/read from pictures of the pages by a model \(Mistral\)/.test(blocks[0].content.map((one) => ('text' in one ? one.text : '')).join('')))
  const headings = blocks.filter((one) => one.kind === 'heading').map((one) => (one.kind === 'heading' ? one.content.map((part) => ('text' in part ? part.text : '')).join('') : ''))
  assert.deepEqual(headings, ['Page 1', 'Page 2'])
  assert.equal(blocks.filter((one) => one.kind === 'paragraph').length, 4, 'two paragraphs a page')
  assert.ok(out.notes.some((one) => /may be wrong/.test(one)))
  assert.ok(out.notes.some((one) => /Read 2 of 2 pages/.test(one)))
  assert.ok(out.notes.some((one) => /table must not be taken out of this/.test(one)))
})

test('a page the model could not read is recorded as not read, and nothing is put in its place', async () => {
  const eyes = fakeEyes((at) => (at === 1 ? { failed: 'the service was busy' } : at === 2 ? { words: 'NO WORDS' } : { words: 'Page one.' }))
  const out = await readPictures([shot(1), shot(2), shot(3)], eyes, { agreed: true, to: 'Mistral' })
  assert.equal(out.ok, true)
  if (!out.ok) return
  assert.deepEqual(out.read, [1])
  assert.deepEqual(out.notRead, [
    { page: 2, why: 'the service was busy' },
    { page: 3, why: 'the model could not read anything on it' }
  ])
  const words = (out.blocks ?? [])
    .flatMap((one) => (one.kind === 'paragraph' ? one.content.map((part) => ('text' in part ? part.text : '')) : []))
    .join(' ')
  assert.ok(/Page one\./.test(words))
  assert.equal(words.match(/could not read this page/g)?.length, 2)
  assert.ok(!/NO WORDS/.test(words), 'the model saying it read nothing is not kept as the page')
  assert.ok(out.notes.some((one) => /2 pages came back with nothing Orbis could use \(2, 3\)/.test(one)), out.notes.join(' | '))
})

test('when no page could be read nothing is made, and the reason is the one the service gave', async () => {
  const eyes = fakeEyes(() => ({ failed: 'Orbis has no key for Mistral' }))
  const out = await readPictures([shot(1), shot(2)], eyes, { agreed: true, to: 'Mistral' })
  assert.equal(out.ok, false)
  if (out.ok) return
  assert.equal(out.needs, null)
  if (out.needs !== null) return
  assert.ok(/Nothing was read: Orbis has no key for Mistral/.test(out.message), out.message)
  assert.ok(/Nothing was kept/.test(out.message))
})

test('with nothing on this computer that can see, nothing is sent and nothing is guessed', async () => {
  const eyes = fakeEyes(() => ({ words: 'never asked' }))
  const out = await readPictures([shot(1)], { ...eyes, cannotSee: 'Looking at an image needs Mistral, and Orbis has no key for it.' }, { agreed: true, to: 'Mistral' })
  assert.equal(out.ok, false)
  if (out.ok) return
  assert.equal(out.needs, null)
  if (out.needs !== null) return
  assert.ok(/no key for it/.test(out.message))
  assert.deepEqual(eyes.sent, [])
})

test('past the cap the rest of the pages are named as not read', async () => {
  const many = Array.from({ length: SCANNED_LIMITS.read + 4 }, (_, i) => shot(i + 1))
  const eyes = fakeEyes((at) => ({ words: `Page ${at + 1}` }))
  let last = { read: 0, of: 0 }
  const out = await readPictures(many, { ...eyes, onProgress: (read, of) => (last = { read, of }) }, { agreed: true, to: 'Mistral' })
  assert.equal(out.ok, true)
  if (!out.ok) return
  assert.equal(eyes.sent.length, SCANNED_LIMITS.read)
  assert.equal(out.read.length, SCANNED_LIMITS.read)
  assert.deepEqual(last, { read: SCANNED_LIMITS.read, of: SCANNED_LIMITS.read })
  const said = out.notes.join(' | ')
  assert.ok(new RegExp(`Only the first ${SCANNED_LIMITS.read} pages were sent`).test(said), said)
  assert.ok(/4 pages were not read: 21, 22, 23, 24/.test(said), said)
})

test('stopping part-way keeps nothing', async () => {
  const stop = new AbortController()
  const eyes = fakeEyes(() => {
    stop.abort()
    return { words: 'half of it' }
  })
  const out = await readPictures([shot(1), shot(2), shot(3)], { ...eyes, concurrency: 1, signal: stop.signal }, { agreed: true, to: 'Mistral' })
  assert.equal(out.ok, false)
  assert.ok(/Stopped/.test(said(out)))
})

// ---------------------------------------------------------------- one picture into a table

test('a table is only made when the model really answered with a ruled table', async () => {
  const eyes = fakeEyes(() => ({ words: 'It looks like a table of monthly rent and food costs, with rent around 1200 and food around 300.' }))
  const out = await readPictures([shot(1)], eyes, { agreed: true, to: 'Mistral' }, { want: 'table' })
  assert.equal(out.ok, false)
  if (out.ok) return
  assert.equal(out.needs, null)
  if (out.needs !== null) return
  assert.ok(/did not answer with a table/.test(out.message), out.message)
  assert.ok(/will not guess at rows and columns/.test(out.message))
})

test('a ruled table is read cell for cell, and says every cell came from a model', async () => {
  const eyes = fakeEyes(() => ({
    words: 'Here it is:\n\n| Item | Amount |\n| --- | --- |\n| Rent | 1200 |\n| Food | 300 |\n\nThat is the whole table.'
  }))
  const out = await readPictures([shot(1)], eyes, { agreed: true, to: 'Mistral' }, { want: 'table', source: 'file: receipt.jpg' })
  assert.equal(out.ok, true)
  if (!out.ok) return
  assert.equal(out.blocks, null)
  const table = out.table
  assert.ok(table)
  if (!table) return
  assert.deepEqual(table.columns.map((one) => one.name), ['Item', 'Amount'])
  assert.equal(table.columns[1].type, 'integer')
  assert.equal(table.rows.length, 2)
  assert.deepEqual(table.rows.map((row) => row.cells[0]), ['Rent', 'Food'])
  assert.equal(table.source, 'file: receipt.jpg')
  assert.ok(out.notes.some((one) => /Orbis did not compute any of it/.test(one)), out.notes.join(' | '))
  assert.ok(eyes.told[0].includes('Do not add a row, a column, a total'), eyes.told[0])
})

test('a heading row with nothing under it is not a table', async () => {
  const eyes = fakeEyes(() => ({ words: '| Item | Amount |\n| --- | --- |' }))
  const out = await readPictures([shot(1)], eyes, { agreed: true, to: 'Mistral' }, { want: 'table' })
  assert.equal(out.ok, false)
  assert.ok(/no rows under it/.test(said(out)))
})

test('the model saying there is no table is not turned into one', async () => {
  const eyes = fakeEyes(() => ({ words: 'NO TABLE' }))
  const out = await readPictures([shot(1)], eyes, { agreed: true, to: 'Mistral' }, { want: 'table' })
  assert.equal(out.ok, false)
  assert.ok(/Nothing was read/.test(said(out)), said(out))
})

test('several pictures are never joined into one table', async () => {
  const eyes = fakeEyes(() => ({ words: '| a | b |\n| --- | --- |\n| 1 | 2 |' }))
  const out = await readPictures([shot(1), shot(2)], eyes, { agreed: true, to: 'Mistral' }, { want: 'table' })
  assert.equal(out.ok, false)
  assert.ok(/A table is read from one picture/.test(said(out)), said(out))
  assert.deepEqual(eyes.sent, [], 'refused before anything was sent')
})

test('a picture on its own is asked about as a picture, not as pages', async () => {
  const eyes = fakeEyes(() => ({ words: 'never asked' }))
  const out = await readPictures([shot(1)], eyes, null, { want: 'table' })
  assert.equal(out.ok, false)
  if (out.ok || out.needs !== 'consent') return
  assert.ok(/This picture has to be read by a model/.test(out.ask), out.ask)
  assert.ok(/Nothing is sent unless you say yes\./.test(out.ask))
})

test('nothing to read is said rather than asked about', async () => {
  const eyes = fakeEyes(() => ({ words: 'never asked' }))
  const out = await readPictures([], eyes, { agreed: true, to: 'Mistral' })
  assert.equal(out.ok, false)
  if (out.ok) return
  assert.equal(out.needs, null)
  if (out.needs === null) assert.ok(/no picture here to read/.test(out.message))
})
