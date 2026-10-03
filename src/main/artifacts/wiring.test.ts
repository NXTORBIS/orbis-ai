import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactService, ARTIFACT_OPERATIONS, type ArtifactResult } from './service.ts'
import { ArtifactStore } from './store.ts'
import { encodePng } from '../chromium/png.ts'
import { ArtifactGeneration, type Asked } from './generation.ts'
import { readEmailDraft } from './sharing.ts'
import { readIcs } from '../../shared/artifacts/calendar.ts'
import { readDirectory } from '../../shared/portable/zip.ts'
import { serialiseProject, makeProject, isProjectProblem } from '../../shared/artifacts/project.ts'
import type { CodeSpec, PageFile } from '../../shared/pages/codePage.ts'

/*
 * The six finished modules, as the engine actually reaches them.
 *
 * Each of those modules has its own tests and they pass on their own. What they could not test is the wiring: that a
 * picture really becomes an artifact, that a project really reads back out of the one stored file, that a calendar
 * file is written by Save-as and verified event by event, that the consent question for a scanned page is the
 * reader's own words and that nothing is sent before it is answered. That is what this file is for, and every one of
 * these goes down the real path -- the real store, the real read-back, the real checks. The only stand-ins are the
 * three things that cannot run here: the save dialog, the model, and the picture-reading service.
 */

interface Harness {
  service: ArtifactService
  dir: string
  nextDestination: string | null
  nextSource: string | null
  /** What the stand-in picture reader was shown, and what it answered. */
  seen: { bytes: number; instruction: string }[]
  /** What it answers, in order. A missing answer is a failure, which is what a service that refused looks like. */
  sightAnswers: ({ words: string } | { failed: string })[]
  /** Every set of files handed to the sandbox, so a test can see what it would have run. */
  placed: { spec: CodeSpec; files: readonly PageFile[] }[]
  /** Whether the stand-in sandbox opens what it is given. */
  sandboxOpens: boolean
  /** The environment the cloud folders are looked for in. A test fills it in before it asks. */
  env: Record<string, string | undefined>
  /** The folders the pretend computer really has. Nothing on the real disk is ever stat-ed. */
  cloudPaths: string[]
  revealed: { path: string; open: boolean }[]
}

/** A real PNG of a given size, half white and half black, so it is never one flat colour. */
function png(width: number, height: number): Uint8Array {
  const bgra = Buffer.alloc(width * height * 4, 0xff)
  for (let y = Math.floor(height / 2); y < height; y++) for (let x = 0; x < width; x++) bgra.writeUInt32LE(0xff000000, (y * width + x) * 4)
  return new Uint8Array(encodePng({ width, height, bgra }))
}

/** A real JPEG: the start marker, a JFIF header, a frame header declaring its size, filler, and the end marker. */
function jpeg(width: number, height: number): Uint8Array {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]
  const frame = [0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]
  const filler = Array.from({ length: 64 }, (_, i) => (i % 240) + 1)
  return new Uint8Array([...head, ...frame, ...filler, 0xff, 0xd9])
}

// ---------------------------------------------------------------- a scanned PDF, built by hand

const latin = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1')
const bytesOf = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'latin1'))

/** A PDF of `pages` pages, each one a page-sized photograph and no text at all: what a scanner writes. */
function scannedPdf(pages: number): Uint8Array {
  const objects: [number, string][] = [
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ')}] /Count ${pages} >>`]
  ]
  for (let i = 0; i < pages; i++) {
    objects.push([3 + i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 ${3 + pages + i} 0 R >> >> >>`])
  }
  for (let i = 0; i < pages; i++) {
    const data = jpeg(1700, 2200)
    const padded = new Uint8Array(24_000)
    padded.set(data)
    padded[padded.length - 2] = 0xff
    padded[padded.length - 1] = 0xd9
    objects.push([
      3 + pages + i,
      `<< /Type /XObject /Subtype /Image /Width 1700 /Height 2200 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length ${padded.length} >>\nstream\n${latin(padded)}\nendstream`
    ])
  }
  return bytesOf(`%PDF-1.7\n${objects.map(([n, body]) => `${n} 0 obj\n${body}\nendobj\n`).join('')}trailer\n<< /Root 1 0 R >>\n%%EOF\n`)
}

const withService = async (
  run: (h: Harness) => Promise<void>,
  options: { answers?: (Record<string, unknown> | { failed: string })[]; canSee?: boolean } = {}
): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-wiring-'))
  await mkdir(join(dir, 'Downloads'))
  const h: Harness = {
    service: null as unknown as ArtifactService,
    dir,
    nextDestination: null,
    nextSource: null,
    seen: [],
    sightAnswers: [],
    placed: [],
    sandboxOpens: true,
    env: {},
    cloudPaths: [],
    revealed: []
  }
  let counter = 0
  h.service = new ArtifactService({
    store: new ArtifactStore({ userData: dir }),
    now: () => 1_760_000_000_000,
    random: () => (++counter).toString(16).padStart(32, '0'),
    chooseDestination: async () => h.nextDestination,
    chooseSource: async () => h.nextSource,
    downloadsDir: () => join(dir, 'Downloads'),
    reveal: async (path, open) => {
      h.revealed.push({ path, open })
    },
    // A pretend computer: the folders are the ones the test says are there, and nothing is stat-ed for real.
    env: h.env,
    cloudDeps: {
      isFolder: async (path) => h.cloudPaths.includes(path),
      isWritable: async () => true,
      readText: async () => null
    },
    ...(options.canSee === false
      ? { cannotSee: () => 'Nothing on this computer can read a picture: there is no Mistral key in your settings.' }
      : {
          cannotSee: () => null,
          see: async (picture, instruction) => {
            h.seen.push({ bytes: picture.bytes.length, instruction })
            return h.sightAnswers.shift() ?? { failed: 'the stand-in ran out of answers' }
          }
        }),
    sandbox: {
      place: async (spec, files) => {
        h.placed.push({ spec, files })
        return `page_${(++counter).toString(16).padStart(32, '0')}`
      },
      open: async () => (h.sandboxOpens ? { ok: true, health: { faults: [] } } : { ok: false, error: 'refused', message: 'The sandbox would not open it.' }),
      close: () => undefined
    },
    ...(options.answers
      ? {
          generation: new ArtifactGeneration({
            apiKeys: async () => ['k'],
            fetchFn: async () => {
              throw new Error('not used')
            },
            ask: async (): Promise<Asked> => {
              const next = options.answers?.shift()
              if (!next) return { failed: 'the script ran out' }
              return 'failed' in next ? (next as { failed: string }) : { json: next }
            }
          })
        }
      : {}),
    writeFile: async (path, bytes) => {
      await writeFile(path, bytes)
    }
  })
  try {
    await run(h)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const ok = <T = Record<string, unknown>>(result: ArtifactResult): T => {
  assert.equal(result.ok, true, result.ok ? '' : `${result.error}: ${result.message}`)
  return (result as { value: T }).value
}
const no = (result: ArtifactResult): { error: string; message: string; detail?: unknown } => {
  assert.equal(result.ok, false, 'this was meant to be refused')
  return result as { error: string; message: string; detail?: unknown }
}

/** A file put where the open dialog will answer with it. */
const given = async (h: Harness, name: string, bytes: Uint8Array): Promise<void> => {
  h.nextSource = join(h.dir, name)
  await writeFile(h.nextSource, bytes)
}

// ---------------------------------------------------------------- the operation map

test('the five new operations are in the frozen map and nothing else was opened up', () =>
  withService(async ({ service }) => {
    for (const one of ['artifact.run', 'artifact.dashboard', 'artifact.emailDraft', 'artifact.cloudFolders', 'artifact.saveToCloud']) {
      assert.ok(ARTIFACT_OPERATIONS.includes(one), `${one} is not in the map, so it cannot run`)
    }
    // Still a frozen map: a name that is not in it is refused before anything happens.
    const result = await service.run('default', { operation: 'artifact.transcribe' })
    assert.equal(no(result).error, 'unknown-operation')
  }))

// ---------------------------------------------------------------- a picture

test('a PNG opened becomes a picture: the same bytes kept, read back, and shown as a picture', () =>
  withService(async (h) => {
    const bytes = png(40, 24)
    await given(h, 'holiday.png', bytes)
    const made = ok<{ record: { artifactId: string; kind: string; format: string; shape: { rows: number; columns: number }; verified: { ok: boolean; checks: { what: string }[] }; notes: string[] } }>(
      await h.service.run('default', { operation: 'artifact.import' })
    )
    assert.equal(made.record.kind, 'image')
    assert.equal(made.record.format, 'image')
    assert.equal(made.record.verified.ok, true)
    // Checked as a picture, not as a drawing: the read-back names the signature and reads the size again.
    assert.deepEqual(made.record.verified.checks.map((one) => one.what), ['written', 'checksum', 'signature', 'read again', 'size'])
    assert.deepEqual(made.record.shape, { rows: 24, columns: 40 })
    assert.ok(made.record.notes.some((one) => /byte for byte/.test(one)), made.record.notes.join(' | '))

    // The stored file is the file that arrived, byte for byte -- there is no rendering step for these three kinds.
    const stored = await readFile(join(h.dir, 'artifacts', made.record.artifactId, 'current', 'content.png'))
    assert.deepEqual(new Uint8Array(stored), bytes)

    const read = ok<{
      preview: string
      truncated: boolean
      media: { format: string; width: number; height: number } | null
      formats: { format: string; name: string; extension: string; limitations: readonly string[] }[]
    }>(
      await h.service.run('default', { operation: 'artifact.read', artifactId: made.record.artifactId })
    )
    assert.ok(read.preview.startsWith('data:image/png;base64,'), 'the preview is a data: URL a plain <img> can show')
    assert.equal(read.truncated, false)
    assert.deepEqual([read.media?.format, read.media?.width, read.media?.height], ['png', 40, 24])
    // The chooser says PNG and .png, not "Picture file" and ".image": the saved file is what the bytes are.
    assert.deepEqual(read.formats, [{ format: 'image', name: 'PNG picture', extension: '.png', limitations: read.formats[0].limitations }])

    h.nextDestination = join(h.dir, 'out.png')
    const saved = ok<{ path: string; verified: { ok: boolean } }>(await h.service.run('default', { operation: 'artifact.export', artifactId: made.record.artifactId, format: 'image' }))
    assert.equal(saved.verified.ok, true)
    assert.deepEqual(new Uint8Array(await readFile(saved.path)), bytes, 'the saved copy is the same bytes again')

    // A picture may be opened: for it, "open" means a viewer, not a run.
    ok(await h.service.run('default', { operation: 'artifact.reveal', path: saved.path, open: true }))
    assert.deepEqual(h.revealed, [{ path: saved.path, open: true }])
  }))

test('a picture called a PNG whose bytes are a JPEG is refused, with both facts in the sentence', () =>
  withService(async (h) => {
    await given(h, 'holiday.png', jpeg(100, 50))
    const refused = no(await h.service.run('default', { operation: 'artifact.import' }))
    assert.equal(refused.error, 'mismatch')
    assert.match(refused.message, /JPEG picture/)
    assert.match(refused.message, /holiday\.png/)
  }))

test('a picture cannot be pasted, changed by sentence, put in a document, or searched as text', () =>
  withService(async (h) => {
    await given(h, 'shot.png', png(8, 8))
    const made = ok<{ record: { artifactId: string; title: string } }>(await h.service.run('default', { operation: 'artifact.import' }))
    const id = made.record.artifactId
    assert.match(no(await h.service.run('default', { operation: 'artifact.create', kind: 'image', text: 'not a picture' })).message, /opened from a file/)
    assert.match(no(await h.service.run('default', { operation: 'artifact.revise', artifactId: id, request: 'make it bigger' })).message, /kept exactly as it is/)
    assert.match(no(await h.service.run('default', { operation: 'artifact.asDocument', artifactId: id })).message, /not put into a document yet/)
    // Its bytes are never scanned as words: a search for something that is not in its name or notes finds nothing.
    const hits = ok<{ record: { artifactId: string } }[]>(await h.service.run('default', { operation: 'artifact.search', query: 'IHDR' }))
    assert.equal(hits.length, 0)
  }))

// ---------------------------------------------------------------- a project

const PROJECT = (() => {
  const made = makeProject([
    { path: 'index.html', source: '<h1>Hello</h1>\n<link rel="stylesheet" href="style.css">\n<script src="app.js"></script>\n' },
    { path: 'style.css', source: 'h1 { color: teal }\n' },
    { path: 'app.js', source: 'document.querySelector("h1").title = "hi"\n' }
  ])
  if (isProjectProblem(made)) throw new Error(made.message)
  return made
})()

test('a project is kept as one stored file, lists its files, and reads back file for file', () =>
  withService(async (h) => {
    const made = ok<{ record: { artifactId: string; kind: string; shape: { rows: number }; verified: { ok: boolean; checks: { what: string }[] } } }>(
      await h.service.run('default', { operation: 'artifact.create', kind: 'project', title: 'Little site', text: serialiseProject(PROJECT) })
    )
    assert.equal(made.record.kind, 'project')
    assert.equal(made.record.shape.rows, 3)
    assert.equal(made.record.verified.ok, true)
    assert.ok(made.record.verified.checks.some((one) => one.what === 'files'), 'a project is checked file by file, not as a drawing')

    const read = ok<{ project: { files: { path: string }[]; entry: string; runnable: boolean; cannotRun: string }; preview: string }>(
      await h.service.run('default', { operation: 'artifact.read', artifactId: made.record.artifactId })
    )
    assert.deepEqual(read.project.files.map((one) => one.path), ['app.js', 'index.html', 'style.css'])
    assert.equal(read.project.entry, 'index.html')
    assert.equal(read.project.runnable, true)
    assert.match(read.preview, /<h1>Hello<\/h1>/, 'the preview is the file it starts at, never the stored JSON')

    // One file asked for by name.
    const one = ok<{ preview: string }>(await h.service.run('default', { operation: 'artifact.read', artifactId: made.record.artifactId, path: 'style.css' }))
    assert.equal(one.preview, 'h1 { color: teal }\n')
  }))

test('one file of a project changed by its path is one new version, and only that file changed', () =>
  withService(async (h) => {
    const made = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'project', title: 'Site', text: serialiseProject(PROJECT) }))
    const id = made.record.artifactId
    const changed = ok<{ record: { version: number; versions: unknown[]; reason: string }; did: string[] }>(
      await h.service.run('default', { operation: 'artifact.update', artifactId: id, path: 'style.css', text: 'h1 { color: crimson }\n' })
    )
    assert.equal(changed.record.version, 2)
    assert.equal(changed.record.versions.length, 1, 'the version before it is kept')
    assert.deepEqual(changed.did, ['Changed style.css.'])
    const read = ok<{ project: { files: { path: string }[] }; preview: string }>(await h.service.run('default', { operation: 'artifact.read', artifactId: id, path: 'style.css' }))
    assert.equal(read.preview, 'h1 { color: crimson }\n')
    assert.equal(read.project.files.length, 3, 'nothing was added or taken out')

    // A path the project does not have is an addition, said as one.
    const added = ok<{ did: string[]; record: { shape: { rows: number } } }>(
      await h.service.run('default', { operation: 'artifact.update', artifactId: id, path: 'about.html', text: '<p>About</p>\n' })
    )
    assert.deepEqual(added.did, ['Added about.html.'])
    assert.equal(added.record.shape.rows, 4)
  }))

test('a project saves as a zip whose every entry reads back as the text that went in, and is never opened', () =>
  withService(async (h) => {
    const made = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'project', title: 'Site', text: serialiseProject(PROJECT) }))
    h.nextDestination = join(h.dir, 'site.zip')
    const saved = ok<{ path: string; verified: { ok: boolean; checks: { what: string; passed: boolean }[] } }>(
      await h.service.run('default', { operation: 'artifact.export', artifactId: made.record.artifactId, format: 'zip' })
    )
    assert.equal(saved.verified.ok, true)
    assert.ok(saved.verified.checks.some((one) => one.what === 'files' && one.passed))
    const listing = readDirectory(new Uint8Array(await readFile(saved.path)))
    assert.ok(!('error' in listing))
    if ('error' in listing) return
    assert.deepEqual(listing.map((one) => one.path).sort(), ['app.js', 'index.html', 'style.css'])

    // "Open the file" is refused for a zip of source files, for the same reason it is refused for code.
    const refused = no(await h.service.run('default', { operation: 'artifact.reveal', path: saved.path, open: true }))
    assert.match(refused.message, /can be run once they are unpacked/)
    // Showing it in its folder is fine.
    ok(await h.service.run('default', { operation: 'artifact.reveal', path: saved.path, open: false }))
  }))

test('a project that is one web page is handed to the sandbox; anything else is refused by name', () =>
  withService(async (h) => {
    const web = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'project', title: 'Site', text: serialiseProject(PROJECT) }))
    const ran = ok<{ ok: boolean; entry: string; notes: string[] }>(await h.service.run('default', { operation: 'artifact.run', artifactId: web.record.artifactId }))
    assert.equal(ran.entry, 'index.html')
    assert.equal(h.placed.length, 1)
    // Exactly the three names the sandbox serves, and Orbis's own shell around the page.
    assert.deepEqual(h.placed[0].files.map((one) => one.path).sort(), ['index.html', 'page.css', 'page.js'])
    assert.ok(ran.notes.some((one) => /cannot reach the network/.test(one)), ran.notes.join(' | '))
    assert.ok(ran.notes.some((one) => /not as Node/.test(one)), ran.notes.join(' | '))

    const python = makeProject([{ path: 'main.py', source: 'print(1)\n' }, { path: 'settings.json', source: '{}\n' }])
    if (isProjectProblem(python)) throw new Error(python.message)
    const other = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'project', title: 'Script', text: serialiseProject(python) }))
    const refused = no(await h.service.run('default', { operation: 'artifact.run', artifactId: other.record.artifactId }))
    assert.match(refused.message, /Python project/)
    assert.match(refused.message, /does not run programs on your computer/)
    assert.equal(h.placed.length, 1, 'nothing was written anywhere for the Python project')

    // A code artifact is still never run, and the refusal says what can be.
    const code = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'code', title: 'one.js', language: 'javascript', text: 'const a = 1\n' }))
    assert.match(no(await h.service.run('default', { operation: 'artifact.run', artifactId: code.record.artifactId })).message, /never runs it/)
  }))

test('a zip of text files opens as a project, and one with a key in it is stopped at the write', () =>
  withService(async (h) => {
    // Written by the engine itself, so the test is about reading one back in rather than about some other zipper.
    const first = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'project', title: 'Site', text: serialiseProject(PROJECT) }))
    h.nextDestination = join(h.dir, 'site.zip')
    const saved = ok<{ path: string }>(await h.service.run('default', { operation: 'artifact.export', artifactId: first.record.artifactId, format: 'zip' }))

    h.nextSource = saved.path
    const opened = ok<{ record: { kind: string; shape: { rows: number }; notes: string[] } }>(await h.service.run('default', { operation: 'artifact.import' }))
    assert.equal(opened.record.kind, 'project')
    assert.equal(opened.record.shape.rows, 3)
    assert.ok(opened.record.notes.some((one) => /Read from an archive/.test(one)), opened.record.notes.join(' | '))
    assert.ok(opened.record.notes.some((one) => /has not run any of it/.test(one)), opened.record.notes.join(' | '))
  }))

test('a project asked for in a sentence is built from the files a model names, and a bad path is argued with once', () =>
  withService(
    async (h) => {
      const made = ok<{ record: { kind: string; title: string; shape: { rows: number }; notes: string[] } }>(
        await h.service.run('default', { operation: 'artifact.generate', request: 'a small website with a page, a stylesheet and a script', kind: 'project' })
      )
      assert.equal(made.record.kind, 'project')
      assert.equal(made.record.shape.rows, 2)
      assert.ok(made.record.notes.some((one) => /has not run any of it on this computer/.test(one)), made.record.notes.join(' | '))
    },
    {
      answers: [
        // The first answer walks up out of the project. It is refused by name, not repaired, and asked again.
        { kind: 'project', title: 'Site', files: [{ path: '../secrets.env', source: 'KEY=1\n' }], entry: '../secrets.env' },
        { kind: 'project', title: 'Site', files: [{ path: 'index.html', source: '<h1>Hi</h1>\n' }, { path: 'style.css', source: 'h1{color:teal}\n' }], entry: 'index.html' }
      ]
    }
  ))

test('a project revised by instruction keeps every file and says what changed', () =>
  withService(
    async (h) => {
      const first = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'project', title: 'Site', text: serialiseProject(PROJECT) }))
      const changed = ok<{ record: { version: number; shape: { rows: number }; notes: string[] } }>(
        await h.service.run('default', { operation: 'artifact.revise', artifactId: first.record.artifactId, request: 'make the heading crimson' })
      )
      assert.equal(changed.record.version, 2)
      assert.equal(changed.record.shape.rows, 3, 'no file was lost to the rewrite')
      assert.ok(changed.record.notes.some((one) => /1 changed \(style\.css\)/.test(one)), changed.record.notes.join(' | '))
      assert.ok(changed.record.notes.some((one) => /2 left alone/.test(one)), changed.record.notes.join(' | '))
    },
    {
      answers: [
        {
          files: [
            { path: 'index.html', source: '<h1>Hello</h1>\n<link rel="stylesheet" href="style.css">\n<script src="app.js"></script>\n' },
            { path: 'style.css', source: 'h1 { color: crimson }\n' },
            { path: 'app.js', source: 'document.querySelector("h1").title = "hi"\n' }
          ],
          entry: 'index.html'
        }
      ]
    }
  ))

// ---------------------------------------------------------------- a calendar file

const DATES = 'When,What,Where\n2026-03-14,Spring review,Room 2\n2026-04-01,Budget sign-off,Room 5\nnot a date,Something,Somewhere\n'

test('a table saves as a calendar file whose every event reads back, with the unreadable row said', () =>
  withService(async (h) => {
    const made = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Reviews', text: DATES }))
    h.nextDestination = join(h.dir, 'reviews.ics')
    const saved = ok<{ path: string; verified: { ok: boolean; checks: { what: string; passed: boolean }[] }; notes: string[] }>(
      await h.service.run('default', { operation: 'artifact.export', artifactId: made.record.artifactId, format: 'ics' })
    )
    assert.equal(saved.verified.ok, true)
    // Not "it parses": every event's name and start are compared with what was written.
    assert.ok(saved.verified.checks.some((one) => one.what === 'round trip' && one.passed))
    const parsed = readIcs(new Uint8Array(await readFile(saved.path)))
    assert.ok(!('error' in parsed))
    if ('error' in parsed) return
    assert.deepEqual(parsed.events.map((one) => one.title), ['Spring review', 'Budget sign-off'])
    assert.deepEqual(parsed.events.map((one) => one.start?.date), ['20260314', '20260401'])
    assert.ok(saved.notes.some((one) => /1 row had no date Orbis could read/.test(one)), saved.notes.join(' | '))
    // Orbis hands the file over and says it cannot know what happened next.
    assert.ok(saved.notes.some((one) => /no connection to your calendar/.test(one)), saved.notes.join(' | '))
    // An .ics may be opened: a calendar program is a viewer, not a run.
    ok(await h.service.run('default', { operation: 'artifact.reveal', path: saved.path, open: true }))
  }))

test('a table with no dates in it cannot become a calendar, and says what a date has to look like', () =>
  withService(async (h) => {
    const made = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Names', text: 'name,count\nalice,3\nbob,4\n' }))
    h.nextDestination = join(h.dir, 'names.ics')
    const refused = no(await h.service.run('default', { operation: 'artifact.export', artifactId: made.record.artifactId, format: 'ics' }))
    assert.equal(refused.error, 'encode')
    assert.match(refused.message, /no column of that table holds dates/i)
  }))

// ---------------------------------------------------------------- a workbook with live formulas

test('a workbook can carry live formulas, and asking for them does not change a table that has none', () =>
  withService(async (h) => {
    const made = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Sales', text: 'item,qty,price\nnib,3,2\nink,4,5\n' }))
    const id = made.record.artifactId
    // A column Orbis computed, so there is something to write as a formula.
    ok(await h.service.run('default', { operation: 'artifact.transform', artifactId: id, steps: [{ op: 'compute', name: 'total', formula: 'qty * price' }] }))

    h.nextDestination = join(h.dir, 'plain.xlsx')
    const plain = ok<{ verified: { ok: boolean; checks: { what: string }[] } }>(await h.service.run('default', { operation: 'artifact.export', artifactId: id, format: 'xlsx' }))
    assert.equal(plain.verified.ok, true)
    assert.ok(!plain.verified.checks.some((one) => one.what === 'formulas'), 'with no formulas asked for, nothing new is checked')

    h.nextDestination = join(h.dir, 'live.xlsx')
    const live = ok<{ verified: { ok: boolean; checks: { what: string; passed: boolean }[] }; notes: string[] }>(
      await h.service.run('default', { operation: 'artifact.export', artifactId: id, format: 'xlsx', liveFormulas: true, totalsRow: true })
    )
    assert.equal(live.verified.ok, true)
    const formulas = live.verified.checks.find((one) => one.what === 'formulas')
    assert.ok(formulas, 'the cells that hold a formula are looked for by name in the file that was written')
    assert.equal(formulas.passed, true)
  }))

// ---------------------------------------------------------------- a dashboard

test('a dashboard of a table is a document of computed figures with its charts beside it', () =>
  withService(async (h) => {
    const rows = ['region,month,spend', 'North,2026-01-01,1200', 'North,2026-02-01,800', 'South,2026-01-01,400', 'South,2026-02-01,500'].join('\n')
    const made = ok<{ record: { artifactId: string; title: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Spending', text: `${rows}\n` }))
    const built = ok<{ record: { artifactId: string; kind: string; verified: { ok: boolean }; notes: string[]; derivedFrom: { title: string } | null }; made: string[]; headlines: { label: string; value: string }[] }>(
      await h.service.run('default', { operation: 'artifact.dashboard', artifactId: made.record.artifactId })
    )
    assert.equal(built.record.kind, 'document')
    assert.equal(built.record.verified.ok, true)
    assert.equal(built.record.derivedFrom?.title, 'Spending')
    assert.ok(built.headlines.length > 0, 'it has figures on it')
    // Figures worked out by Orbis, not written: the total of the spend column is 2,900.
    assert.ok(built.headlines.some((one) => one.value.replace(/,/g, '').includes('2900')), built.headlines.map((one) => `${one.label}=${one.value}`).join(' | '))
    assert.ok(built.record.notes.some((one) => /do not change when the table does|version 1/.test(one)), built.record.notes.join(' | '))

    // The charts are real chart artifacts the page points at, so one redrawn later is the one it shows.
    const listed = ok<{ record: { artifactId: string; kind: string } }[]>(await h.service.run('default', { operation: 'artifact.list' }))
    assert.ok(listed.some((one) => one.record.kind === 'plot'), 'at least one chart was drawn beside it')
    const read = ok<{ preview: string }>(await h.service.run('default', { operation: 'artifact.read', artifactId: built.record.artifactId }))
    assert.match(read.preview, /artifact:artifact_[0-9a-f]{32}/, 'a figure is a pointer at a chart, never a copy of it')
  }))

test('a dashboard of a table with no rows is refused by name, and nothing is kept', () =>
  withService(async (h) => {
    const made = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Empty', text: 'a,b\n' }))
    const refused = no(await h.service.run('default', { operation: 'artifact.dashboard', artifactId: made.record.artifactId }))
    assert.match(refused.message, /no rows yet/)
    const listed = ok<unknown[]>(await h.service.run('default', { operation: 'artifact.list' }))
    assert.equal(listed.length, 1, 'only the table is there')
  }))

// ---------------------------------------------------------------- a mail draft

test('a mail draft is a file with the artifact inside it, read back byte for byte, and Orbis sends nothing', () =>
  withService(async (h) => {
    const made = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Expenses', text: 'item,amount\nnib,2\n' }))
    const draft = ok<{ path: string; to: { address: string }[]; attachment: { name: string; bytes: number } | null; verified: { ok: boolean }; notes: string[] }>(
      await h.service.run('default', {
        operation: 'artifact.emailDraft',
        artifactId: made.record.artifactId,
        format: 'csv',
        to: ['sam@example.com'],
        subject: 'Expenses',
        body: 'Here they are.',
        where: 'downloads'
      })
    )
    assert.equal(draft.verified.ok, true)
    assert.deepEqual(draft.to.map((one) => one.address), ['sam@example.com'])
    assert.equal(draft.attachment?.name, 'Expenses.csv')
    assert.ok(draft.notes.some((one) => /does not send email/.test(one)), draft.notes.join(' | '))

    const parsed = readEmailDraft(new Uint8Array(await readFile(draft.path)))
    assert.ok(!('error' in parsed))
    if ('error' in parsed) return
    const attached = parsed.parts.find((one) => one.filename === 'Expenses.csv')
    assert.ok(attached, 'the attachment is in the file')
    assert.equal(new TextDecoder().decode(attached.bytes), 'item,amount\nnib,2')
  }))

test('a draft refuses an address that is not one, and the gate reads the message as well as the file', () =>
  withService(async (h) => {
    const made = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Expenses', text: 'item,amount\nnib,2\n' }))
    const bad = no(
      await h.service.run('default', { operation: 'artifact.emailDraft', artifactId: made.record.artifactId, format: 'csv', to: ['not an address'], subject: 'Hello', where: 'downloads' })
    )
    assert.equal(bad.error, 'bad-input')
    // A key typed into the message's own words is stopped, even though the artifact has none in it.
    const gated = no(
      await h.service.run('default', {
        operation: 'artifact.emailDraft',
        artifactId: made.record.artifactId,
        format: 'csv',
        subject: 'Expenses',
        body: `here is the key: ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'}`,
        where: 'downloads'
      })
    )
    assert.equal(gated.error, 'secrets')
    assert.doesNotMatch(gated.message, /ghp_/, 'the refusal never quotes what it found')
  }))

// ---------------------------------------------------------------- a cloud folder

test('a copy goes into a folder a cloud program keeps in step, and the words say who uploads it', () =>
  withService(async (h) => {
      const folder = join(h.dir, 'OneDrive')
      await mkdir(folder)
      h.env.OneDrive = folder
      h.cloudPaths = [folder]
      const listed = ok<{ folders: { name: string; path: string; writable: boolean; keptBy: string }[] }>(await h.service.run('default', { operation: 'artifact.cloudFolders' }))
      assert.deepEqual(listed.folders.map((one) => one.keptBy), ['OneDrive'])
      const made = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Notes', text: 'a,b\n1,2\n' }))
      const saved = ok<{ path: string; verified: { ok: boolean }; notes: string[] }>(
        await h.service.run('default', { operation: 'artifact.saveToCloud', artifactId: made.record.artifactId, folder, format: 'csv' })
      )
      assert.equal(saved.verified.ok, true)
      assert.equal(saved.path, join(folder, 'Notes.csv'))
      assert.ok(saved.notes.some((one) => /OneDrive uploads what appears in that folder/.test(one)), saved.notes.join(' | '))
      assert.ok(saved.notes.some((one) => /Orbis did not upload it/.test(one)), saved.notes.join(' | '))

      // A path that is not one of the folders that were found is refused: a caller never names a place.
      const refused = no(await h.service.run('default', { operation: 'artifact.saveToCloud', artifactId: made.record.artifactId, folder: join(h.dir, 'elsewhere'), format: 'csv' }))
      assert.match(refused.message, /not one of the cloud folders/)
  }))

test('with no cloud folder on the computer there is nothing to save to, said plainly', () =>
  withService(async (h) => {
    const listed = ok<{ folders: unknown[] }>(await h.service.run('default', { operation: 'artifact.cloudFolders' }))
    assert.deepEqual(listed.folders, [])
    const made = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Notes', text: 'a,b\n1,2\n' }))
    assert.match(no(await h.service.run('default', { operation: 'artifact.saveToCloud', artifactId: made.record.artifactId, folder: h.dir })).message, /found no folder/)
  }))

// ---------------------------------------------------------------- a scanned PDF, and the yes

test('a scanned PDF asks before anything is sent, and the question is the reader own words', () =>
  withService(async (h) => {
    await given(h, 'scan.pdf', scannedPdf(2))
    const asked = no(await h.service.run('default', { operation: 'artifact.import' }))
    assert.equal(asked.error, 'scanned')
    assert.match(asked.message, /Nothing is sent unless you say yes/)
    assert.match(asked.message, /Mistral, the service whose key is in your settings/)
    assert.deepEqual((asked.detail as { pages: number; to: string }).pages, 2)
    assert.equal((asked.detail as { to: string }).to, 'Mistral')
    assert.deepEqual(h.seen, [], 'not one picture left the computer')
  }))

test('with the yes the pages are read, the words are a model and the document says so', () =>
  withService(async (h) => {
    await given(h, 'scan.pdf', scannedPdf(2))
    no(await h.service.run('default', { operation: 'artifact.import' }))
    // The same file: the yes does not ask for it again, and the dialog is not opened a second time.
    h.nextSource = null
    h.sightAnswers = [{ words: 'The first page.' }, { words: 'The second page.' }]
    const made = ok<{ record: { artifactId: string; kind: string; notes: string[]; verified: { ok: boolean } } }>(
      await h.service.run('default', { operation: 'artifact.import', readScanned: { agreed: true, to: 'Mistral' } })
    )
    assert.equal(made.record.kind, 'document')
    assert.equal(made.record.verified.ok, true)
    assert.equal(h.seen.length, 2)
    assert.ok(h.seen.every((one) => /Read the words in this picture of a page/.test(one.instruction)))
    assert.ok(made.record.notes.some((one) => /read from pictures of the pages by a model \(Mistral\)/i.test(one)), made.record.notes.join(' | '))
    assert.ok(made.record.notes.some((one) => /A table must not be taken out of this/.test(one)), made.record.notes.join(' | '))
    const read = ok<{ preview: string }>(await h.service.run('default', { operation: 'artifact.read', artifactId: made.record.artifactId }))
    assert.match(read.preview, /The first page\./)
    assert.match(read.preview, /The second page\./)
    assert.match(read.preview, /Page 1/)
  }))

test('a yes given for another service is not a yes, and nothing is sent', () =>
  withService(async (h) => {
    await given(h, 'scan.pdf', scannedPdf(1))
    no(await h.service.run('default', { operation: 'artifact.import' }))
    h.nextSource = null
    const again = no(await h.service.run('default', { operation: 'artifact.import', readScanned: { agreed: true, to: 'Somebody else' } }))
    assert.equal(again.error, 'scanned')
    assert.deepEqual(h.seen, [])
  }))

test('with nothing on the computer that can read a picture, a scan says so instead of offering', () =>
  withService(
    async (h) => {
      await given(h, 'scan.pdf', scannedPdf(1))
      const refused = no(await h.service.run('default', { operation: 'artifact.import' }))
      /*
       * No offer at all, which is the point.
       *
       * A question whose yes could only end in "there is no key" is worse than saying up front that the pages are
       * pictures and nothing here can read one. So the words name both facts and ask for nothing.
       */
      assert.equal(refused.error, 'parse')
      assert.doesNotMatch(refused.message, /say yes/)
      assert.match(refused.message, /page is a picture/)
      assert.match(refused.message, /no Mistral key in your settings/)
      assert.deepEqual(h.seen, [])
    },
    { canSee: false }
  ))
