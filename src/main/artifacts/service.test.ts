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
  /** What the next open dialog answers. Null is "cancelled". */
  nextSource: string | null
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
  const h: Harness = { service: null as unknown as ArtifactService, dir, nextDestination: null, nextSource: null, corrupt: false, printed: [] }
  let counter = 0
  h.service = new ArtifactService({
    store: new ArtifactStore({ userData: dir }),
    now: () => 1000,
    random: () => (++counter).toString(16).padStart(32, '0'),
    chooseDestination: async () => h.nextDestination,
    chooseSource: async () => h.nextSource,
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
    // It is really on disk, under the profile, in the file the record names -- columns and all, not a bare array.
    const stored = JSON.parse(await readFile(join(dir, 'artifacts', record.artifactId, 'current', 'content.json'), 'utf8')) as { columns: { name: string; type: string }[]; rows: unknown[] }
    assert.deepEqual(stored.columns.map((one) => `${one.name}:${one.type}`), ['name:text', 'age:integer'])
    assert.equal(stored.rows.length, 2)
    const listed = ok<{ ref: { artifactId: string } }[]>(await service.run('default', { operation: 'artifact.list' }))
    assert.equal(listed[0].ref.artifactId, record.artifactId)
  }))

test('a table with no rows keeps its columns, which are the whole artifact', () =>
  withService(async ({ service, dir }) => {
    const value = ok(await service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Empty tracker', text: 'date,category,amount\n' }))
    const record = value.record as { artifactId: string; bytes: number; shape: { rows: number; columns: number } }
    assert.deepEqual(record.shape, { rows: 0, columns: 3 })
    assert.ok(record.bytes > 20, `a header-only table is not two bytes (got ${record.bytes})`)
    const stored = JSON.parse(await readFile(join(dir, 'artifacts', record.artifactId, 'current', 'content.json'), 'utf8')) as { columns: { name: string }[] }
    assert.deepEqual(stored.columns.map((one) => one.name), ['date', 'category', 'amount'])
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
    assert.deepEqual(value.formats.map((one) => one.format), ['csv', 'xlsx', 'tsv', 'json', 'ndjson', 'markdown', 'text'])
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
    assert.deepEqual(read.formats.map((one) => one.format), ['markdown', 'html', 'pdf', 'docx', 'pptx', 'text'])

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

test('a table saves as a workbook that re-opens with the same rows, columns and headings', () =>
  withService(async (h) => {
    const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Sites', text: 'date,site,mwh\n2026-10-01,HQ,412\n2026-10-02,Depot,288\n' }))
    h.nextDestination = join(h.dir, 'Sites.xlsx')
    const out = ok(await h.service.run('default', { operation: 'artifact.export', artifactId: (made.record as { artifactId: string }).artifactId, format: 'xlsx' })) as {
      verified: { ok: boolean; checks: { what: string; passed: boolean }[]; reimported: { rows: number; columns: number } | null }
    }
    assert.equal(out.verified.ok, true, JSON.stringify(out.verified.checks))
    assert.deepEqual(out.verified.checks.map((one) => one.what), ['written', 'checksum', 'opens', 'round trip'])
    assert.deepEqual(out.verified.reimported, { rows: 2, columns: 3 })
    assert.equal((await readFile(h.nextDestination))[0], 0x50)
  }))

test('a document saves as Word and as a deck, each opened as the package it is', () =>
  withService(async (h) => {
    const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'Plan', text: '# Plan\n\nIntro.\n\n## Week 1\n\n- read\n- practise\n' }))
    const artifactId = (made.record as { artifactId: string }).artifactId
    h.nextDestination = join(h.dir, 'Plan.docx')
    const word = ok(await h.service.run('default', { operation: 'artifact.export', artifactId, format: 'docx' })) as { verified: { ok: boolean; checks: { what: string }[] } }
    assert.equal(word.verified.ok, true, JSON.stringify(word.verified.checks))
    assert.ok(word.verified.checks.some((one) => one.what === 'paragraphs'))
    h.nextDestination = join(h.dir, 'Plan.pptx')
    const deck = ok(await h.service.run('default', { operation: 'artifact.export', artifactId, format: 'pptx' })) as { verified: { ok: boolean; checks: { what: string }[]; reimported: { rows: number } | null } }
    assert.equal(deck.verified.ok, true, JSON.stringify(deck.verified.checks))
    // Title slide, Plan, Week 1.
    assert.equal(deck.verified.reimported?.rows, 3)
  }))

test('a file the person chose is read, kept with what the reader said, and can then be analysed into a computed report', () =>
  withService(async (h) => {
    const path = join(h.dir, 'readings.csv')
    await writeFile(path, 'date,site,mwh,solar\n2026-10-01,HQ,412,96\n2026-10-02,Depot,288,12\n2026-10-03,Warehouse,530,140\n2026-10-04,HQ,415,99\n')
    h.nextSource = path
    const imported = ok(await h.service.run('default', { operation: 'artifact.import' }))
    const record = imported.record as { artifactId: string; title: string; kind: string; source: string; notes: string[]; shape: { rows: number; columns: number } }
    assert.equal(record.kind, 'table')
    assert.equal(record.title, 'readings')
    assert.equal(record.source, 'file: readings.csv')
    assert.deepEqual(record.shape, { rows: 4, columns: 4 })
    assert.ok(record.notes.length > 0, 'the parser decisions are kept as notes')

    const analysed = ok(await h.service.run('default', { operation: 'artifact.analyse', artifactId: record.artifactId }))
    const report = analysed.record as { kind: string; title: string; notes: string[]; verified: { ok: boolean } }
    assert.equal(report.kind, 'document')
    assert.equal(report.title, 'Analysis of readings')
    assert.equal(report.verified.ok, true)
    assert.ok(report.notes.some((one) => /computed by Orbis/.test(one)))
    assert.ok((analysed.findings as number) >= 4)
    assert.equal(analysed.from, record.artifactId)
    // Only a table can be analysed.
    const wrong = await h.service.run('default', { operation: 'artifact.analyse', artifactId: (analysed.record as { artifactId: string }).artifactId })
    assert.equal(wrong.ok, false)
  }))

test('a cancelled open dialog opens nothing and says so', () =>
  withService(async (h) => {
    h.nextSource = null
    const result = await h.service.run('default', { operation: 'artifact.import' })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'cancelled')
  }))

test('replacing an artifact makes a new version, keeps the old one, and restoring brings it back as a newer one', () =>
  withService(async (h) => {
    const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Readings', text: 'a,b\n1,2\n' }))
    const v1 = made.record as { artifactId: string; versionId: string; version: number }
    assert.equal(v1.version, 1)

    const updated = ok(await h.service.run('default', { operation: 'artifact.update', artifactId: v1.artifactId, text: 'a,b\n1,2\n3,4\n', reason: 'added a row' }))
    const v2 = updated.record as { artifactId: string; versionId: string; version: number; versions: { versionId: string; version: number }[]; reason: string; shape: { rows: number }; createdAt: number; updatedAt: number }
    assert.equal(v2.artifactId, v1.artifactId)
    assert.equal(v2.version, 2)
    assert.equal(v2.reason, 'added a row')
    assert.equal(v2.shape.rows, 2)
    assert.deepEqual(v2.versions.map((one) => one.version), [1])
    assert.equal(v2.versions[0].versionId, v1.versionId)

    const versions = ok<{ current: { version: number }; versions: { version: number }[] }>(await h.service.run('default', { operation: 'artifact.versions', artifactId: v1.artifactId }))
    assert.equal(versions.current.version, 2)
    assert.equal(versions.versions.length, 1)
    // The library lists one artifact, not two.
    assert.equal(ok<unknown[]>(await h.service.run('default', { operation: 'artifact.list' })).length, 1)

    const restored = ok(await h.service.run('default', { operation: 'artifact.restore', artifactId: v1.artifactId, versionId: v1.versionId }))
    const v3 = restored.record as { version: number; shape: { rows: number }; reason: string; versions: { version: number }[]; notes: string[] }
    assert.equal(v3.version, 3)
    assert.equal(v3.shape.rows, 1, 'version 3 has version 1 content')
    assert.match(v3.reason, /Restored version 1/)
    assert.deepEqual(v3.versions.map((one) => one.version), [1, 2])
    assert.ok(v3.notes.some((one) => /Restored from version 1/.test(one)))

    const nope = await h.service.run('default', { operation: 'artifact.restore', artifactId: v1.artifactId, versionId: 'v' + 'f'.repeat(32) })
    assert.equal(nope.ok, false)
  }))

test('a rename is not a version, and a duplicate is a new artifact that remembers its origin', () =>
  withService(async (h) => {
    const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'Draft', text: '# Draft\n\nText.\n' }))
    const id = (made.record as { artifactId: string; versionId: string }).artifactId
    const renamed = ok(await h.service.run('default', { operation: 'artifact.rename', artifactId: id, title: 'Final' }))
    assert.equal((renamed.record as { title: string; version: number }).title, 'Final')
    assert.equal((renamed.record as { version: number }).version, 1)
    const copy = ok(await h.service.run('default', { operation: 'artifact.duplicate', artifactId: id }))
    const c = copy.record as { artifactId: string; title: string; derivedFrom: { artifactId: string; title: string } | null; version: number }
    assert.notEqual(c.artifactId, id)
    assert.equal(c.title, 'Copy of Final')
    assert.equal(c.derivedFrom?.artifactId, id)
    assert.equal(c.derivedFrom?.title, 'Final')
    assert.equal(c.version, 1)
    assert.equal((copy.record as { source: string }).source, '"Final" (copied)')
    assert.equal(ok<unknown[]>(await h.service.run('default', { operation: 'artifact.list' })).length, 2)
  }))

test('search finds by name, by notes and by content, and says which', () =>
  withService(async (h) => {
    await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'Energy report', text: '# Energy\n\nThe warehouse result is worth repeating.\n' })
    await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Sites', text: 'site,mwh\nWarehouse,530\nDepot,288\n' })
    const byTitle = ok<{ where: string; record: { title: string } }[]>(await h.service.run('default', { operation: 'artifact.search', query: 'energy' }))
    assert.deepEqual(byTitle.map((one) => [one.record.title, one.where]), [['Energy report', 'title']])
    const byContent = ok<{ where: string; record: { title: string }; excerpt: string }[]>(await h.service.run('default', { operation: 'artifact.search', query: 'warehouse' }))
    assert.deepEqual(byContent.map((one) => one.record.title).sort(), ['Energy report', 'Sites'])
    assert.ok(byContent.every((one) => one.where === 'content' && /warehouse/i.test(one.excerpt)))
    assert.deepEqual(ok<unknown[]>(await h.service.run('default', { operation: 'artifact.search', query: 'nothing here' })), [])
    assert.deepEqual(ok<unknown[]>(await h.service.run('default', { operation: 'artifact.search', query: '' })), [])
  }))

test('without a print engine, PDF is simply not offered', () =>
  withService(
    async (h) => {
      const kinds = ok<{ id: string; writes: { format: string }[] }[]>(await h.service.run('default', { operation: 'artifact.kinds' }))
      assert.deepEqual(kinds.find((one) => one.id === 'document')?.writes.map((one) => one.format), ['markdown', 'html', 'docx', 'pptx', 'text'])
      const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'document', text: 'x\n' }))
      const result = await h.service.run('default', { operation: 'artifact.export', artifactId: (made.record as { artifactId: string }).artifactId, format: 'pdf' })
      assert.equal(result.ok, false)
      if (!result.ok) assert.match(result.message, /can be saved as: markdown, html, docx, pptx, text/)
    },
    { pdf: false }
  ))
