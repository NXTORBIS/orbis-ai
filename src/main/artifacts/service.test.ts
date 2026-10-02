import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactService, ARTIFACT_OPERATIONS, type ArtifactResult } from './service.ts'
import { ArtifactStore } from './store.ts'

/*
 * The service against a real folder and a stand-in for the save dialog. The dialog is the one thing that cannot run
 * here; everything else -- the write, the read-back, the checks -- is the real code path.
 */

const KEY = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'

interface Harness {
  service: ArtifactService
  dir: string
  /** What the next save dialog answers. Null is "cancelled". */
  nextDestination: string | null
  /** Replaces what is written at a path, to simulate a disk that lied. */
  corrupt: boolean
  /** What the stand-in print engine was handed, so a test can see the HTML that would have been printed. */
  printed: string[]
}

/** A stand-in print engine: a PDF-shaped file with one page per heading, so the page count means something. */
const fakePdf = (html: string): Uint8Array => {
  const pages = Math.max(1, (html.match(/<h[1-6]/g) ?? []).length)
  const objects = Array.from({ length: pages }, (_, i) => `${i + 3} 0 obj << /Type /Page >> endobj`).join('\n')
  return new TextEncoder().encode(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n2 0 obj << /Type /Pages /Count ${pages} >> endobj\n${objects}\n%%EOF`)
}

const withService = async (run: (h: Harness) => Promise<void>, options: { pdf?: boolean } = { pdf: true }): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-artifact-service-'))
  const h: Harness = { service: null as unknown as ArtifactService, dir, nextDestination: null, corrupt: false, printed: [] }
  let counter = 0
  h.service = new ArtifactService({
    store: new ArtifactStore({ userData: dir }),
    now: () => 1000,
    random: () => (++counter).toString(16).padStart(32, '0'),
    chooseDestination: async () => h.nextDestination,
    ...(options.pdf === false
      ? {}
      : {
          renderPdf: async (html: string) => {
            h.printed.push(html)
            return fakePdf(html)
          }
        }),
    writeFile: async (path, bytes) => {
      await writeFile(path, h.corrupt ? bytes.slice(0, Math.max(1, bytes.length - 3)) : bytes)
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

test('the operations are a fixed list and an unknown one is refused by name', () =>
  withService(async ({ service }) => {
    assert.ok(ARTIFACT_OPERATIONS.includes('artifact.create'))
    const result = await service.run('default', { operation: 'artifact.constructor' })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'unknown-operation')
    const none = await service.run('default', {})
    assert.equal(none.ok, false)
    const ctor = await service.run('default', { operation: 'constructor' })
    assert.equal(ctor.ok, false)
  }))

test('what Orbis can create comes from the table', () =>
  withService(async ({ service }) => {
    const kinds = ok<{ id: string }[]>(await service.run('default', { operation: 'artifact.kinds' }))
    assert.deepEqual(kinds.map((one) => one.id), ['table', 'document'])
  }))

test('a table pasted as CSV is kept, read back from disk, and verified before it is reported', () =>
  withService(async ({ service, dir }) => {
    const value = ok(await service.run('default', { operation: 'artifact.create', kind: 'table', title: 'People', text: 'name,age\nalice,30\nbob,41\n' }))
    const record = value.record as { artifactId: string; verified: { ok: boolean; checks: { what: string }[] }; shape: { rows: number; columns: number }; format: string }
    assert.equal(record.verified.ok, true)
    assert.ok(record.verified.checks.some((one) => one.what === 'round trip'))
    assert.deepEqual(record.shape, { rows: 2, columns: 2 })
    assert.equal(record.format, 'json')
    // It is really on disk, under the profile, in the file the record names.
    const stored = await readFile(join(dir, 'artifacts', record.artifactId, 'content.json'), 'utf8')
    assert.ok(stored.includes('alice'))
    const listed = ok<{ ref: { artifactId: string } }[]>(await service.run('default', { operation: 'artifact.list' }))
    assert.equal(listed[0].ref.artifactId, record.artifactId)
  }))

test('a document pasted as Markdown is kept as Markdown', () =>
  withService(async ({ service }) => {
    const value = ok(await service.run('default', { operation: 'artifact.create', kind: 'document', title: 'Notes', text: '# Heading\n\nA paragraph.\n' }))
    const record = value.record as { format: string; shape: { rows: number }; verified: { ok: boolean } }
    assert.equal(record.format, 'markdown')
    assert.equal(record.shape.rows, 2)
    assert.equal(record.verified.ok, true)
  }))

test('text with a key in it is refused, the key is not quoted, and nothing is kept', () =>
  withService(async ({ service }) => {
    const result = await service.run('default', { operation: 'artifact.create', kind: 'table', text: `name,token\nalice,${KEY}\n` })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error, 'secrets')
      assert.equal(result.message.includes(KEY), false)
    }
    const listed = ok<unknown[]>(await service.run('default', { operation: 'artifact.list' }))
    assert.equal(listed.length, 0)
    // Shown the finding and still wanting it, a person can have it.
    const accepted = await service.run('default', { operation: 'artifact.create', kind: 'table', text: `name,token\nalice,${KEY}\n`, acceptSecrets: true })
    assert.equal(accepted.ok, true)
  }))

test('an export goes where the dialog said, is read back, and the loss is named up front', () =>
  withService(async (h) => {
    const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'People', text: 'name,age\nalice,30\n' }))
    const artifactId = (made.record as { artifactId: string }).artifactId
    h.nextDestination = join(h.dir, 'People.csv')
    const out = ok(await h.service.run('default', { operation: 'artifact.export', artifactId, format: 'csv' })) as {
      path: string
      verified: { ok: boolean; checks: { what: string; passed: boolean }[] }
      loss: { lossy: boolean }
    }
    assert.equal(out.path, h.nextDestination)
    assert.equal(out.verified.ok, true)
    assert.ok(out.verified.checks.every((one) => one.passed))
    // `toDelimited` writes no trailing newline; what is on disk is exactly what it produced.
    assert.equal(await readFile(h.nextDestination, 'utf8'), 'name,age\nalice,30')
  }))

test('a cancelled dialog writes nothing and says so', () =>
  withService(async (h) => {
    const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'table', text: 'a,b\n1,2\n' }))
    h.nextDestination = null
    const result = await h.service.run('default', { operation: 'artifact.export', artifactId: (made.record as { artifactId: string }).artifactId })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'cancelled')
  }))

test('a format the kind cannot be written in is refused with the ones it can', () =>
  withService(async (h) => {
    const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'document', text: 'hello\n' }))
    const result = await h.service.run('default', { operation: 'artifact.export', artifactId: (made.record as { artifactId: string }).artifactId, format: 'csv' })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.message, /can be saved as: markdown/)
  }))

test('a file that does not read back as written is reported as a failure, with the path', () =>
  withService(async (h) => {
    const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'table', text: 'a,b\n1,2\n3,4\n' }))
    h.nextDestination = join(h.dir, 'short.csv')
    h.corrupt = true
    const result = await h.service.run('default', { operation: 'artifact.export', artifactId: (made.record as { artifactId: string }).artifactId, format: 'csv' })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error, 'verify')
      const detail = result.detail as { path: string; verified: { ok: boolean } }
      assert.equal(detail.path, h.nextDestination)
      assert.equal(detail.verified.ok, false)
    }
  }))

test('reading gives a bounded preview and the formats it can leave as', () =>
  withService(async (h) => {
    const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'table', text: 'a,b\n1,2\n' }))
    const value = ok(await h.service.run('default', { operation: 'artifact.read', artifactId: (made.record as { artifactId: string }).artifactId })) as {
      preview: string
      formats: { format: string }[]
    }
    assert.ok(value.preview.length > 0)
    assert.deepEqual(value.formats.map((one) => one.format), ['csv', 'tsv', 'json', 'ndjson', 'markdown', 'text'])
  }))

test('a document saves as HTML with its paragraphs in it, read back through the HTML importer', () =>
  withService(async (h) => {
    const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'Report', text: '# Report\n\nA finding.\n\n- one\n- two\n' }))
    h.nextDestination = join(h.dir, 'Report.html')
    const out = ok(await h.service.run('default', { operation: 'artifact.export', artifactId: (made.record as { artifactId: string }).artifactId, format: 'html' })) as {
      verified: { ok: boolean; checks: { what: string; passed: boolean }[] }
    }
    assert.equal(out.verified.ok, true, JSON.stringify(out.verified.checks))
    const html = await readFile(h.nextDestination, 'utf8')
    assert.ok(html.startsWith('<!doctype html>'))
    assert.ok(html.includes('A finding.'))
    assert.equal(html.includes('Content-Security-Policy'), false, 'a file a person opens is not given the print policy')
  }))

test('a document saves as PDF through the print engine, from HTML that forbids every fetch, and the PDF is checked', () =>
  withService(async (h) => {
    const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'Printed', text: '# One\n\nText.\n\n## Two\n\nMore.\n' }))
    const artifactId = (made.record as { artifactId: string }).artifactId
    const read = ok(await h.service.run('default', { operation: 'artifact.read', artifactId })) as { formats: { format: string }[] }
    assert.deepEqual(read.formats.map((one) => one.format), ['markdown', 'html', 'pdf', 'text'])

    h.nextDestination = join(h.dir, 'Printed.pdf')
    const out = ok(await h.service.run('default', { operation: 'artifact.export', artifactId, format: 'pdf' })) as {
      verified: { ok: boolean; checks: { what: string; passed: boolean }[]; reimported: { rows: number } | null }
      loss: { lossy: boolean }
    }
    assert.equal(out.verified.ok, true, JSON.stringify(out.verified.checks))
    assert.deepEqual(out.verified.checks.map((one) => one.what), ['written', 'checksum', 'pdf', 'pages'])
    assert.equal(out.verified.reimported?.rows, 2)
    assert.equal(h.printed.length, 1)
    assert.ok(h.printed[0].includes("default-src 'none'"), 'the print engine is handed HTML with the no-fetch policy')
    const bytes = await readFile(h.nextDestination)
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-')
  }))

test('without a print engine, PDF is simply not offered', () =>
  withService(
    async (h) => {
      const kinds = ok<{ id: string; writes: { format: string }[] }[]>(await h.service.run('default', { operation: 'artifact.kinds' }))
      assert.deepEqual(kinds.find((one) => one.id === 'document')?.writes.map((one) => one.format), ['markdown', 'html', 'text'])
      const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'document', text: 'x\n' }))
      const result = await h.service.run('default', { operation: 'artifact.export', artifactId: (made.record as { artifactId: string }).artifactId, format: 'pdf' })
      assert.equal(result.ok, false)
      if (!result.ok) assert.match(result.message, /can be saved as: markdown, html, text/)
    },
    { pdf: false }
  ))
