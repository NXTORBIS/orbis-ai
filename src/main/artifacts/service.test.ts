import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactService, ARTIFACT_OPERATIONS, chartKindSaid, type ArtifactResult } from './service.ts'
import { ArtifactStore } from './store.ts'
import { encodePng } from '../chromium/png.ts'
import { ArtifactGeneration, type Asked } from './generation.ts'

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
  /** Makes the stand-in drawing window hand back a blank page, to simulate a drawing that never painted. */
  blank: boolean
  /** What the stand-in for Orion was asked, when a test gave it answers. */
  asked: { system: string; user: string }[]
  /** What was shown in its folder or opened, in order. */
  revealed: { path: string; open: boolean }[]
}

/** A stand-in print engine: a PDF-shaped file with one page per heading, so the page count means something. */
const fakePdf = (html: string): Uint8Array => {
  const pages = Math.max(1, (html.match(/<h[1-6]/g) ?? []).length)
  const objects = Array.from({ length: pages }, (_, i) => `${i + 3} 0 obj << /Type /Page >> endobj`).join('\n')
  return new TextEncoder().encode(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n2 0 obj << /Type /Pages /Count ${pages} >> endobj\n${objects}\n%%EOF`)
}

/** A stand-in for the drawing window: a real PNG of the asked-for size, white with one dark line across it. */
const fakePng = (svg: string, width: number, height: number): Uint8Array => {
  const bgra = Buffer.alloc(width * height * 4, 0xff)
  // An SVG with nothing in it draws nothing, which is how a test asks for a blank page.
  if (/<(path|rect|circle|line|polygon|text)[\s/>]/.test(svg)) {
    const row = Math.floor(height / 2) * width * 4
    for (let x = 0; x < width; x++) bgra.writeUInt32LE(0xff000000, row + x * 4)
  }
  return new Uint8Array(encodePng({ width, height, bgra }))
}

const withService = async (run: (h: Harness) => Promise<void>, options: { pdf?: boolean; png?: boolean; answers?: (Record<string, unknown> | { failed: string })[] } = { pdf: true, png: true }): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-artifact-service-'))
  await mkdir(join(dir, 'Downloads'))
  const h: Harness = { service: null as unknown as ArtifactService, dir, nextDestination: null, nextSource: null, corrupt: false, printed: [], blank: false, asked: [], revealed: [] }
  let counter = 0
  h.service = new ArtifactService({
    store: new ArtifactStore({ userData: dir }),
    now: () => 1000,
    random: () => (++counter).toString(16).padStart(32, '0'),
    chooseDestination: async () => h.nextDestination,
    chooseSource: async () => h.nextSource,
    // The test's own folder stands in for Downloads, so nothing is written anywhere a person would find it.
    downloadsDir: () => join(dir, 'Downloads'),
    reveal: async (path: string, open: boolean) => {
      h.revealed.push({ path, open })
    },
    ...(options.pdf === false
      ? {}
      : {
          renderPdf: async (html: string) => {
            h.printed.push(html)
            return fakePdf(html)
          }
        }),
    ...(options.answers
      ? {
          generation: new ArtifactGeneration({
            apiKeys: async () => ['k'],
            fetchFn: async () => {
              throw new Error('not used')
            },
            ask: async (system, user): Promise<Asked> => {
              h.asked.push({ system, user })
              const next = options.answers?.shift()
              if (!next) return { failed: 'the script ran out' }
              return 'failed' in next ? (next as { failed: string }) : { json: next }
            }
          })
        }
      : {}),
    ...(options.png === false ? {} : { renderPng: async (svg: string, width: number, height: number) => fakePng(h.blank ? '' : svg, width, height) }),
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
    assert.deepEqual(kinds.map((one) => one.id), ['table', 'document', 'plot', 'diagram', 'code'])
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
    { pdf: false, png: true }
  ))

const READINGS = 'date,site,mwh,solar\n2026-10-01,HQ,412,96\n2026-10-02,Depot,288,12\n2026-10-03,Warehouse,530,140\n2026-10-04,HQ,415,99\n'

test('a chart is drawn from a table by column name, remembers the table, and saves as SVG and PNG that read back', () =>
  withService(async (h) => {
    const table = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Readings', text: READINGS }))
    const tableId = (table.record as { artifactId: string }).artifactId
    const read = ok<{ columns: { id: string; name: string; type: string }[] }>(await h.service.run('default', { operation: 'artifact.read', artifactId: tableId }))
    assert.deepEqual(read.columns.map((one) => one.name), ['date', 'site', 'mwh', 'solar'])

    const chart = ok(await h.service.run('default', { operation: 'artifact.chart', artifactId: tableId, x: 'date', y: ['mwh', 'solar'], kind: 'bar' }))
    const record = chart.record as { artifactId: string; kind: string; title: string; format: string; derivedFrom: { artifactId: string } | null; verified: { ok: boolean; checks: { what: string }[] }; shape: { rows: number; columns: number }; notes: string[] }
    assert.equal(record.kind, 'plot')
    assert.equal(record.format, 'svg')
    assert.equal(record.title, 'mwh, solar by date')
    assert.equal(record.derivedFrom?.artifactId, tableId)
    assert.equal(record.verified.ok, true)
    assert.deepEqual(record.verified.checks.map((one) => one.what), ['written', 'checksum', 'svg', 'drawn'])
    assert.deepEqual(record.shape, { rows: 8, columns: 2 }, 'eight points across two series')
    assert.ok(record.notes.some((one) => /row order/.test(one)), 'a date axis is drawn in row order and says so')

    const preview = ok<{ preview: string }>(await h.service.run('default', { operation: 'artifact.read', artifactId: record.artifactId }))
    assert.ok(preview.preview.startsWith('<svg'))
    assert.ok(preview.preview.includes('2026-10-03'), 'the dates are the tick labels')

    h.nextDestination = join(h.dir, 'chart.svg')
    const svg = ok<{ path: string; verified: { ok: boolean } }>(await h.service.run('default', { operation: 'artifact.export', artifactId: record.artifactId, format: 'svg' }))
    assert.equal(svg.verified.ok, true)
    assert.match(await readFile(svg.path, 'utf8'), /^<svg/)

    h.nextDestination = join(h.dir, 'chart.png')
    const png = ok<{ path: string; verified: { ok: boolean; checks: { what: string; passed: boolean }[] } }>(await h.service.run('default', { operation: 'artifact.export', artifactId: record.artifactId, format: 'png' }))
    assert.equal(png.verified.ok, true, JSON.stringify(png.verified.checks))
    assert.deepEqual(png.verified.checks.map((one) => one.what), ['written', 'checksum', 'png', 'size', 'drawn'])
    const bytes = await readFile(png.path)
    assert.equal(bytes[1], 0x50)

    // A picture that came back as one flat colour is a failure with its path, not a saved chart.
    h.blank = true
    h.nextDestination = join(h.dir, 'blank.png')
    const blank = await h.service.run('default', { operation: 'artifact.export', artifactId: record.artifactId, format: 'png' })
    assert.equal(blank.ok, false)
    if (!blank.ok) {
      const detail = blank.detail as { verified?: { checks: { what: string; passed: boolean }[] } } | undefined
      assert.equal(detail?.verified?.checks.find((one) => one.what === 'drawn')?.passed, false, JSON.stringify(blank))
    }
  }))

test('a chart with a numeric x axis uses the numbers, and a bad column or a non-table is refused by name', () =>
  withService(async (h) => {
    const table = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Fit', text: 'x,y,label\n1,2,a\n2,4,b\n3,6.5,c\n4,8,d\n' }))
    const tableId = (table.record as { artifactId: string }).artifactId
    const chart = ok(await h.service.run('default', { operation: 'artifact.chart', artifactId: tableId, x: 'x', y: 'y', kind: 'scatter' }))
    const record = chart.record as { artifactId: string; notes: string[]; shape: { rows: number } }
    assert.equal(record.notes.some((one) => /row order/.test(one)), false)
    assert.equal(record.shape.rows, 4)

    const missing = await h.service.run('default', { operation: 'artifact.chart', artifactId: tableId, x: 'x', y: ['nope'] })
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.match(missing.message, /no column called "nope"/)
    const words = await h.service.run('default', { operation: 'artifact.chart', artifactId: tableId, x: 'x', y: ['label'] })
    assert.equal(words.ok, false)
    if (!words.ok) assert.match(words.message, /no values that can be read as numbers/)
    const notTable = await h.service.run('default', { operation: 'artifact.chart', artifactId: record.artifactId, x: 'x', y: ['y'] })
    assert.equal(notTable.ok, false)
    if (!notTable.ok) assert.match(notTable.message, /made from a table/)
  }))

test('a drawing cannot be pasted in, and without a drawing window PNG is simply not offered', () =>
  withService(
    async (h) => {
      const pasted = await h.service.run('default', { operation: 'artifact.create', kind: 'plot', text: '<svg></svg>' })
      assert.equal(pasted.ok, false)
      const kinds = ok<{ id: string; writes: { format: string }[] }[]>(await h.service.run('default', { operation: 'artifact.kinds' }))
      assert.deepEqual(kinds.find((one) => one.id === 'plot')?.writes.map((one) => one.format), ['svg'])
      assert.deepEqual(kinds.find((one) => one.id === 'diagram')?.writes.map((one) => one.format), ['svg'])
    },
    { pdf: true, png: false }
  ))

const SITES = 'site,region,manager\nHQ,North,Asha\nDepot,South,Ben\nLab,East,Chen\n'

test('a table is changed by steps into a new version, with what each step did kept as notes, and the old one still there', () =>
  withService(async (h) => {
    const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Readings', text: READINGS }))
    const id = (made.record as { artifactId: string }).artifactId
    const changed = ok<{ record: { artifactId: string; version: number; versions: { version: number }[]; reason: string; notes: string[]; shape: { rows: number; columns: number }; verified: { ok: boolean } }; did: string[]; steps: unknown[] }>(
      await h.service.run('default', {
        operation: 'artifact.transform',
        artifactId: id,
        steps: [
          { op: 'filter', where: [{ column: 'site', is: 'equals', value: 'HQ' }] },
          { op: 'compute', name: 'solar share', formula: 'solar / mwh * 100' },
          { op: 'sort', by: [{ column: 'mwh', descending: true }] }
        ]
      })
    )
    assert.equal(changed.record.artifactId, id, 'the same table')
    assert.equal(changed.record.version, 2)
    assert.equal(changed.record.versions.length, 1, 'version 1 is still there to go back to')
    assert.deepEqual(changed.record.shape, { rows: 2, columns: 5 })
    assert.equal(changed.record.verified.ok, true)
    assert.equal(changed.did.length, 3)
    assert.equal(changed.did[0], 'Kept 2 of 4 rows where site is "HQ".')
    assert.match(changed.did[1], /"solar share" = solar \/ mwh \* 100: computed for 2 of 2 rows\./)
    assert.deepEqual(changed.record.notes, changed.did)
    assert.equal(changed.steps.length, 3)
    const read = ok<{ preview: string; columns: { name: string }[] }>(await h.service.run('default', { operation: 'artifact.read', artifactId: id }))
    assert.deepEqual(read.columns.map((one) => one.name), ['date', 'site', 'mwh', 'solar', 'solar share'])
    assert.ok(read.preview.includes('415'), 'the larger HQ reading is there')
    assert.equal(read.preview.includes('Depot'), false, 'and the rows filtered out are not')
  }))

test('a change kept as a new table leaves the original alone and remembers it; a bad step changes nothing and says which', () =>
  withService(async (h) => {
    const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Readings', text: READINGS }))
    const id = (made.record as { artifactId: string }).artifactId
    const totals = ok<{ record: { artifactId: string; title: string; version: number; derivedFrom: { artifactId: string } | null; shape: { rows: number; columns: number } } }>(
      await h.service.run('default', { operation: 'artifact.transform', artifactId: id, as: 'new', title: 'By site', steps: [{ op: 'group', by: ['site'], totals: [{ column: 'mwh', how: 'sum' }] }] })
    )
    assert.notEqual(totals.record.artifactId, id)
    assert.equal(totals.record.title, 'By site')
    assert.equal(totals.record.derivedFrom?.artifactId, id)
    assert.deepEqual(totals.record.shape, { rows: 3, columns: 2 })

    const bad = await h.service.run('default', { operation: 'artifact.transform', artifactId: id, steps: [{ op: 'sort', by: ['mwh'] }, { op: 'drop', columns: ['wind'] }] })
    assert.equal(bad.ok, false)
    if (!bad.ok) assert.match(bad.message, /^Step 2 \(drop\) did not work: There is no column called "wind"/)
    const malformed = await h.service.run('default', { operation: 'artifact.transform', artifactId: id, steps: [{ op: 'pivot' }] })
    assert.equal(malformed.ok, false)
    if (!malformed.ok) assert.match(malformed.message, /steps\[0\] has "op": "pivot"/)
    const still = ok<{ record: { version: number; shape: { rows: number } } }>(await h.service.run('default', { operation: 'artifact.read', artifactId: id }))
    assert.equal(still.record.version, 1, 'neither failure made a version')
    assert.equal(still.record.shape.rows, 4)

    const none = await h.service.run('default', { operation: 'artifact.transform', artifactId: id, request: 'only HQ' })
    assert.equal(none.ok, false)
    if (!none.ok) assert.match(none.message, /Orion is not set up/)
    const nothing = await h.service.run('default', { operation: 'artifact.transform', artifactId: id })
    assert.equal(nothing.ok, false)
  }))

test('a sentence becomes steps: Orion sees the column names and none of the data, and an engine refusal is argued with once', () =>
  withService(
    async (h) => {
      const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Readings', text: READINGS }))
      const id = (made.record as { artifactId: string }).artifactId
      const changed = ok<{ record: { version: number; notes: string[]; reason: string; shape: { rows: number } }; did: string[] }>(
        await h.service.run('default', { operation: 'artifact.transform', artifactId: id, request: 'the two biggest readings' })
      )
      assert.equal(h.asked.length, 2, 'the first plan named a column that is not there, so it was asked again')
      assert.ok(h.asked[0].system.includes('mwh: '), 'the column names were given')
      assert.equal(h.asked[0].system.includes('412'), false, 'the data was not')
      assert.equal(h.asked[0].system.includes('Warehouse'), false)
      assert.match(h.asked[1].user, /Step 1 \(sort\) cannot run: There is no column called "energy"/)
      assert.equal(changed.record.version, 2)
      assert.equal(changed.record.shape.rows, 2)
      assert.equal(changed.record.reason, 'the two biggest readings')
      assert.match(changed.record.notes[0], /steps were chosen by a model from: "the two biggest readings"\. It was shown the column names, not the data/)
      assert.equal(changed.did[1], 'Kept the first 2 of 4 rows.')

      // A model that says it cannot is believed: its reason is the answer and nothing is changed.
      const cannot = await h.service.run('default', { operation: 'artifact.transform', artifactId: id, request: 'translate the site names into French' })
      assert.equal(cannot.ok, false)
      if (!cannot.ok) assert.match(cannot.message, /cannot be done with the steps Orbis has: Translating text is not one of the steps\./)
    },
    {
      pdf: true,
      png: true,
      answers: [
        { steps: [{ op: 'sort', by: [{ column: 'energy', descending: true }] }, { op: 'limit', rows: 2 }] },
        { steps: [{ op: 'sort', by: [{ column: 'mwh', descending: true }] }, { op: 'limit', rows: 2 }] },
        { steps: [], cannot: 'Translating text is not one of the steps.' }
      ]
    }
  ))

test('two tables are joined on a column into a new table, and the rows that found no partner are counted', () =>
  withService(async (h) => {
    const readings = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Readings', text: READINGS }))
    const sites = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Sites', text: SITES }))
    const left = (readings.record as { artifactId: string }).artifactId
    const right = (sites.record as { artifactId: string }).artifactId
    const joined = ok<{ record: { artifactId: string; title: string; notes: string[]; derivedFrom: { artifactId: string } | null; shape: { rows: number; columns: number }; verified: { ok: boolean } } }>(
      await h.service.run('default', { operation: 'artifact.join', artifactId: left, withArtifactId: right, on: 'site', kind: 'left' })
    )
    assert.equal(joined.record.title, 'Readings + Sites')
    assert.equal(joined.record.derivedFrom?.artifactId, left)
    assert.equal(joined.record.shape.rows, 4, 'a left join keeps every reading')
    assert.equal(joined.record.verified.ok, true)
    assert.match(joined.record.notes[0], /Joined "Readings" \(4 rows\) with "Sites" \(3 rows\) where site = site, keeping every row of "Readings"\./)
    assert.match(joined.record.notes[1], /3 rows of "Readings" found a partner and 1 did not; 2 rows of "Sites" found a partner and 1 did not\./)
    const grid = ok<{ grid: { rows: string[][]; total: number } }>(await h.service.run('default', { operation: 'artifact.read', artifactId: joined.record.artifactId })).grid
    assert.equal(grid.total, 4)
    assert.equal(grid.rows[0][0], '2026-10-01', 'a date reads as a date, not as a count of milliseconds')
    assert.ok(grid.rows.some((row) => row.includes('Asha')), 'the joined-in columns are there')
    assert.ok(grid.rows.some((row) => row.includes('Warehouse') && row[row.length - 1] === ''), 'a row with no partner has empty cells, not invented ones')
    assert.ok(joined.record.notes.some((one) => /more than once/.test(one) && /HQ/.test(one)), 'HQ appears twice in the readings, and that is said')

    const missing = await h.service.run('default', { operation: 'artifact.join', artifactId: left, withArtifactId: right, on: 'site', withOn: 'location' })
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.match(missing.message, /"Sites" has no column called "location"\. Its columns are: site, region, manager\./)
  }))

test('a template starts a table with its typed columns and no rows, or a document with its headings, and needs no model', () =>
  withService(async (h) => {
    const listed = ok<{ id: string; kind: string; name: string; group: string }[]>(await h.service.run('default', { operation: 'artifact.templates' }))
    assert.ok(listed.length >= 15)
    assert.ok(listed.some((one) => one.id === 'budget' && one.kind === 'table'))

    const budget = ok<{ record: { artifactId: string; title: string; kind: string; source: string; notes: string[]; shape: { rows: number; columns: number }; verified: { ok: boolean } } }>(
      await h.service.run('default', { operation: 'artifact.fromTemplate', templateId: 'budget' })
    )
    assert.equal(budget.record.kind, 'table')
    assert.equal(budget.record.title, 'Monthly budget')
    assert.equal(budget.record.source, 'template: Monthly budget')
    assert.deepEqual(budget.record.shape, { rows: 0, columns: 5 })
    assert.equal(budget.record.verified.ok, true)
    assert.match(budget.record.notes[0], /structure only/)
    const read = ok<{ columns: { name: string; type: string }[]; grid: { total: number } }>(await h.service.run('default', { operation: 'artifact.read', artifactId: budget.record.artifactId }))
    assert.deepEqual(read.columns.map((one) => `${one.name}:${one.type}`), ['Date:date', 'Category:category', 'Description:text', 'Amount:number', 'Paid by:category'])
    assert.equal(read.grid.total, 0)

    const notes = ok<{ record: { kind: string; title: string; shape: { rows: number } } }>(await h.service.run('default', { operation: 'artifact.fromTemplate', templateId: 'meeting-notes', title: 'Monday sync' }))
    assert.equal(notes.record.kind, 'document')
    assert.equal(notes.record.title, 'Monday sync')
    assert.ok(notes.record.shape.rows >= 8)

    const none = await h.service.run('default', { operation: 'artifact.fromTemplate', templateId: 'spaceship' })
    assert.equal(none.ok, false)
    if (!none.ok) assert.match(none.message, /no template called "spaceship"/)
  }))

test('a document is revised by an instruction into a new version; the kind and title stay Orbis\'s and the old version is kept', () =>
  withService(
    async (h) => {
      const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'Plan', text: '# Plan\n\nShip it.\n\n## Risks\n\n- None yet.\n' }))
      const id = (made.record as { artifactId: string }).artifactId
      const revised = ok<{ record: { artifactId: string; title: string; kind: string; version: number; versions: unknown[]; reason: string; notes: string[]; shape: { rows: number } } }>(
        await h.service.run('default', { operation: 'artifact.revise', artifactId: id, request: 'add a section on what it costs' })
      )
      assert.equal(revised.record.artifactId, id)
      assert.equal(revised.record.kind, 'document', 'an answer that tried to be a table is still read as the document it was asked for')
      assert.equal(revised.record.title, 'Plan', 'and the title is not the model\'s to change')
      assert.equal(revised.record.version, 2)
      assert.equal(revised.record.versions.length, 1)
      assert.equal(revised.record.reason, 'add a section on what it costs')
      assert.match(revised.record.notes[0], /Rewritten by a model from: "add a section on what it costs"\. Any figure in it was written, not measured/)
      assert.match(revised.record.notes[1], /Before: 4 blocks\. After: 6 blocks\. The version before is kept\./)
      assert.ok(h.asked[0].user.includes('## Risks'), 'the whole document was handed over')
      assert.ok(h.asked[0].user.endsWith('The change asked for: add a section on what it costs'))
      const preview = ok<{ preview: string }>(await h.service.run('default', { operation: 'artifact.read', artifactId: id })).preview
      assert.ok(preview.includes('## Cost') && preview.includes('(fill in)') && preview.includes('- None yet.'))

      // Nothing usable back, twice: no version is made and the attempts say why.
      const failed = await h.service.run('default', { operation: 'artifact.revise', artifactId: id, request: 'make it rhyme' })
      assert.equal(failed.ok, false)
      if (!failed.ok) {
        assert.equal(failed.error, 'not-made')
        assert.equal((failed.detail as { attempts: unknown[] }).attempts.length, 2)
      }
      const still = ok<{ record: { version: number } }>(await h.service.run('default', { operation: 'artifact.read', artifactId: id }))
      assert.equal(still.record.version, 2)
    },
    {
      pdf: true,
      png: true,
      answers: [
        { kind: 'table', title: 'Something else', columns: ['a'], markdown: '# Plan\n\nShip it.\n\n## Risks\n\n- None yet.\n\n## Cost\n\n(fill in)\n' },
        { markdown: '' },
        { text: 'roses are red' }
      ]
    }
  ))

test('a flowchart is revised the same way, and what cannot be revised says what to do instead', () =>
  withService(
    async (h) => {
      const flow = ok<{ record: { artifactId: string; kind: string; shape: { rows: number; columns: number } } }>(await h.service.run('default', { operation: 'artifact.generate', request: 'a flowchart for signing in' }))
      assert.equal(flow.record.kind, 'diagram')
      assert.deepEqual(flow.record.shape, { rows: 2, columns: 1 })
      const revised = ok<{ record: { version: number; notes: string[]; shape: { rows: number; columns: number } } }>(await h.service.run('default', { operation: 'artifact.revise', artifactId: flow.record.artifactId, request: 'add a check in the middle' }))
      assert.equal(revised.record.version, 2)
      assert.deepEqual(revised.record.shape, { rows: 3, columns: 3 })
      assert.match(revised.record.notes[1], /Before: 2 boxes and 1 arrows\. After: 3 boxes and 3 arrows\./)
      assert.ok(h.asked[1].user.includes('"label":"Start"'), 'the boxes it has now were handed over')

      const table = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'T', text: 'a,b\n1,2\n' }))
      const refused = await h.service.run('default', { operation: 'artifact.revise', artifactId: (table.record as { artifactId: string }).artifactId, request: 'double b' })
      assert.equal(refused.ok, false)
      if (!refused.ok) assert.match(refused.message, /use "Change this table"/)

      // Too long to hand over whole: refused, not cut.
      const long = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'Long', text: `# Long\n\n${'A sentence that goes on. '.repeat(700)}\n` }))
      const tooLong = await h.service.run('default', { operation: 'artifact.revise', artifactId: (long.record as { artifactId: string }).artifactId, request: 'shorten it' })
      assert.equal(tooLong.ok, false)
      if (!tooLong.ok) {
        assert.equal(tooLong.error, 'too-large')
        assert.match(tooLong.message, /Cutting it would lose the rest without saying so, so it was not sent/)
      }
      assert.equal(h.asked.length, 2, 'and Orion was never asked')
    },
    {
      pdf: true,
      png: true,
      answers: [
        { kind: 'diagram', title: 'Sign in', nodes: [{ id: 'a', label: 'Start', shape: 'start' }, { id: 'b', label: 'Done', shape: 'end' }], edges: [{ from: 'a', to: 'b' }] },
        { nodes: [{ id: 'a', label: 'Start', shape: 'start' }, { id: 'c', label: 'Right?', shape: 'decision' }, { id: 'b', label: 'Done', shape: 'end' }], edges: [{ from: 'a', to: 'c' }, { from: 'c', to: 'b', label: 'yes' }, { from: 'c', to: 'a', label: 'no' }] }
      ]
    }
  ))

test('without Orion, revising says so and nothing is changed', () =>
  withService(async (h) => {
    const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'Plan', text: '# Plan\n\nShip it.\n' }))
    const result = await h.service.run('default', { operation: 'artifact.revise', artifactId: (made.record as { artifactId: string }).artifactId, request: 'longer' })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.message, /Orion is not set up on this computer.*It can still be replaced by pasting/)
  }))

test('a table inside a document is taken out as a table that remembers the document, and can then be changed like any other', () =>
  withService(async (h) => {
    const report = '# Energy\n\nWords.\n\n| Site | Used | Solar |\n| --- | --- | --- |\n| HQ | 412 | 96 |\n| Depot | 288 | 12 |\n| Warehouse | 530 | |\n\n*Readings by site*\n'
    const made = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'Energy report', text: report }))
    const id = (made.record as { artifactId: string }).artifactId
    const read = ok<{ tables: { index: number; caption: string; rows: number; columns: number; headings: string[] }[] }>(await h.service.run('default', { operation: 'artifact.read', artifactId: id }))
    assert.deepEqual(read.tables, [{ index: 1, caption: 'Readings by site', rows: 3, columns: 3, headings: ['Site', 'Used', 'Solar'] }])

    const taken = ok<{ record: { artifactId: string; kind: string; title: string; derivedFrom: { artifactId: string } | null; notes: string[]; shape: { rows: number; columns: number }; verified: { ok: boolean } } }>(
      await h.service.run('default', { operation: 'artifact.extractTable', artifactId: id, index: 1 })
    )
    assert.equal(taken.record.kind, 'table')
    assert.equal(taken.record.title, 'Readings by site', 'named by its caption')
    assert.equal(taken.record.derivedFrom?.artifactId, id)
    assert.deepEqual(taken.record.shape, { rows: 3, columns: 3 })
    assert.equal(taken.record.verified.ok, true)
    assert.match(taken.record.notes[0], /Taken from table 1 of "Energy report" \(version 1\): 3 rows, 3 columns\./)

    const totalled = ok<{ did: string[] }>(await h.service.run('default', { operation: 'artifact.transform', artifactId: taken.record.artifactId, steps: [{ op: 'compute', name: 'share', formula: 'solar / used' }] }))
    assert.match(totalled.did[0], /computed for 2 of 3 rows; 1 row left empty because an input had no number/)

    const none = await h.service.run('default', { operation: 'artifact.extractTable', artifactId: id, index: 2 })
    assert.equal(none.ok, false)
    if (!none.ok) assert.match(none.message, /has 1 table; there is no table 2/)
    const wrong = await h.service.run('default', { operation: 'artifact.extractTable', artifactId: taken.record.artifactId })
    assert.equal(wrong.ok, false)
  }))

test('code is kept character for character with its language, says what could be checked, and saves with the language\'s extension', () =>
  withService(async (h) => {
    const source = 'import os\n\nfor name in os.listdir("."):\n    print(name)\n'
    const made = ok<{ record: { artifactId: string; kind: string; format: string; notes: string[]; shape: { rows: number; columns: number }; verified: { ok: boolean; checks: { what: string }[] } } }>(
      await h.service.run('default', { operation: 'artifact.create', kind: 'code', title: 'List files', language: 'python', text: source })
    )
    assert.equal(made.record.kind, 'code')
    assert.equal(made.record.format, 'code')
    assert.deepEqual(made.record.shape, { rows: 4, columns: 0 })
    assert.equal(made.record.verified.ok, true)
    assert.deepEqual(made.record.verified.checks.map((one) => one.what), ['written', 'checksum', 'same text'])
    assert.match(made.record.notes[0], /no checker for Python, so this was not checked\. It was not run\./)

    const read = ok<{ preview: string; code: { language: string; name: string; extension: string }; formats: { format: string; name: string; extension: string }[] }>(
      await h.service.run('default', { operation: 'artifact.read', artifactId: made.record.artifactId })
    )
    assert.equal(read.preview, source, 'not a character changed')
    assert.deepEqual(read.code, { language: 'python', name: 'Python', extension: '.py' })
    assert.deepEqual(read.formats.map((one) => `${one.name} ${one.extension}`), ['Python .py'])

    h.nextDestination = join(h.dir, 'list.py')
    const saved = ok<{ path: string; verified: { ok: boolean } }>(await h.service.run('default', { operation: 'artifact.export', artifactId: made.record.artifactId }))
    assert.equal(saved.verified.ok, true)
    assert.equal(await readFile(saved.path, 'utf8'), source)

    // The language can come from a title that ends like a file name; with neither, it is asked for.
    const named = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'code', title: 'settings.json', text: '{"a": 1}' }))
    const settings = ok<{ code: { language: string }; record: { notes: string[] } }>(await h.service.run('default', { operation: 'artifact.read', artifactId: named.record.artifactId }))
    assert.equal(settings.code.language, 'json')
    assert.equal(settings.record.notes[0], 'It reads as JSON.')
    const nameless = await h.service.run('default', { operation: 'artifact.create', kind: 'code', title: 'Something', text: 'x = 1' })
    assert.equal(nameless.ok, false)
    if (!nameless.ok) assert.match(nameless.message, /Say which language it is/)

    // A pasted file that does not read is still the person\'s file: it is kept, and the note says what is wrong.
    const broken = ok<{ record: { notes: string[]; verified: { ok: boolean } } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'code', title: 'Broken', language: 'javascript', text: 'function f( {' }))
    assert.equal(broken.record.verified.ok, true, 'it was written faithfully')
    assert.match(broken.record.notes[0], /does not compile as JavaScript/)

    // A key in the code is stopped at the same gate as anywhere else.
    const leaky = await h.service.run('default', { operation: 'artifact.create', kind: 'code', title: 'Deploy', language: 'shell', text: `export TOKEN=${KEY}\n` })
    assert.equal(leaky.ok, false)
    if (!leaky.ok) assert.equal(leaky.error, 'secrets')
  }))

test('a source file is opened as code, and Orion-written code that does not read is sent back once', () =>
  withService(
    async (h) => {
      const path = join(h.dir, 'totals.sql')
      await writeFile(path, 'SELECT site, SUM(mwh) FROM readings GROUP BY site;\n')
      h.nextSource = path
      const imported = ok<{ record: { kind: string; title: string; source: string; notes: string[]; shape: { rows: number } } }>(await h.service.run('default', { operation: 'artifact.import' }))
      assert.equal(imported.record.kind, 'code')
      assert.equal(imported.record.title, 'totals')
      assert.equal(imported.record.source, 'file: totals.sql')
      assert.equal(imported.record.shape.rows, 1)
      assert.match(imported.record.notes[0], /Kept exactly as it was in the file\. Orbis did not run it\./)

      const generated = ok<{ record: { artifactId: string; kind: string; notes: string[] } }>(await h.service.run('default', { operation: 'artifact.generate', request: 'a settings file with a name and a port' }))
      assert.equal(generated.record.kind, 'code')
      assert.equal(h.asked.length, 2, 'the first answer did not read as JSON, so it was asked again')
      assert.match(h.asked[1].user, /It does not read as JSON/)
      assert.match(generated.record.notes[0], /Written by a model from your request\. Orbis has not run it and cannot say that it works/)
      assert.equal(generated.record.notes[1], 'It reads as JSON.')

      const revised = ok<{ record: { version: number; notes: string[]; shape: { rows: number } } }>(await h.service.run('default', { operation: 'artifact.revise', artifactId: generated.record.artifactId, request: 'add a debug flag' }))
      assert.equal(revised.record.version, 2)
      assert.match(revised.record.notes[0], /Rewritten by a model from: "add a debug flag"\. Orbis has not run it/)
      assert.equal(revised.record.notes[1], 'It reads as JSON.')
      assert.match(revised.record.notes[2], /Before: 4 lines\. After: 5 lines\. The version before is kept\./)
      assert.ok(h.asked[2].system.includes('JSON file'), 'the language was named to the model')
    },
    {
      pdf: true,
      png: true,
      answers: [
        { kind: 'code', title: 'Settings', language: 'json', code: '{\n  "name": "orbis",\n  "port": 8080,\n}' },
        { kind: 'code', title: 'Settings', language: 'json', code: '{\n  "name": "orbis",\n  "port": 8080\n}' },
        { code: '{\n  "name": "orbis",\n  "port": 8080,\n  "debug": false\n}' }
      ]
    }
  ))

test('a chart put into a document is a figure that follows the chart, and is drawn into HTML, PDF, Word and slides', () =>
  withService(async (h) => {
    const table = ok(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Readings', text: READINGS }))
    const chart = ok<{ record: { artifactId: string; title: string } }>(await h.service.run('default', { operation: 'artifact.chart', artifactId: (table.record as { artifactId: string }).artifactId, x: 'date', y: ['mwh'], kind: 'bar' }))
    const report = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'Energy report', text: '# Energy report\n\nWhat was used, by day.\n' }))
    const id = report.record.artifactId

    const placed = ok<{ record: { version: number; reason: string; notes: string[]; shape: { rows: number }; verified: { ok: boolean } } }>(
      await h.service.run('default', { operation: 'artifact.place', artifactId: id, figureId: chart.record.artifactId, caption: 'Energy used *each* day' })
    )
    assert.equal(placed.record.version, 2)
    assert.equal(placed.record.shape.rows, 3, 'the figure is one more block')
    assert.equal(placed.record.verified.ok, true, 'and the kept copy reads back with it')
    assert.equal(placed.record.reason, 'Added the figure "mwh by date".')
    const kept = ok<{ preview: string }>(await h.service.run('default', { operation: 'artifact.read', artifactId: id })).preview
    assert.ok(kept.includes(`![mwh by date](artifact:${chart.record.artifactId})`), 'the document says which chart, it does not copy it')
    assert.ok(kept.includes('*Energy used each day*'), 'a caption is plain words: the stars typed into it are not kept as markup')

    h.nextDestination = join(h.dir, 'report.html')
    const html = ok<{ path: string; notes: string[]; verified: { ok: boolean } }>(await h.service.run('default', { operation: 'artifact.export', artifactId: id, format: 'html' }))
    const page = await readFile(html.path, 'utf8')
    assert.ok(page.includes('<img src="data:image/svg+xml;base64,'), 'the drawing is inside the page')
    assert.equal(page.includes('artifact:'), false)
    assert.ok(html.notes.some((one) => /The figure "Energy used each day" is "mwh by date" as it is now \(version 1\)\./.test(one)))

    h.nextDestination = join(h.dir, 'report.pdf')
    ok(await h.service.run('default', { operation: 'artifact.export', artifactId: id, format: 'pdf' }))
    assert.ok(h.printed[h.printed.length - 1].includes('data:image/svg+xml;base64,'), 'the print engine was handed the drawing, not an address')

    h.nextDestination = join(h.dir, 'report.docx')
    const word = ok<{ verified: { ok: boolean; checks: { what: string; describe: string }[] } }>(await h.service.run('default', { operation: 'artifact.export', artifactId: id, format: 'docx' }))
    assert.equal(word.verified.ok, true)
    assert.match(word.verified.checks.find((one) => one.what === 'pictures')!.describe, /holds 1 picture; 1 was put in/)

    h.nextDestination = join(h.dir, 'report.pptx')
    const deck = ok<{ verified: { ok: boolean; checks: { what: string }[] } }>(await h.service.run('default', { operation: 'artifact.export', artifactId: id, format: 'pptx' }))
    assert.equal(deck.verified.ok, true)
    assert.ok(deck.verified.checks.some((one) => one.what === 'pictures'))

    h.nextDestination = join(h.dir, 'report.txt')
    const text = ok<{ path: string; notes: string[] }>(await h.service.run('default', { operation: 'artifact.export', artifactId: id, format: 'text' }))
    assert.ok(text.notes.some((one) => /1 figure is written as its description: this format holds words, not pictures/.test(one)))
    assert.ok((await readFile(text.path, 'utf8')).includes('mwh by date'))

    // The chart is removed: the figure is written as its description and the note says why. Nothing is drawn from memory.
    ok(await h.service.run('default', { operation: 'artifact.remove', artifactId: chart.record.artifactId }))
    h.nextDestination = join(h.dir, 'after.html')
    const after = ok<{ path: string; notes: string[] }>(await h.service.run('default', { operation: 'artifact.export', artifactId: id, format: 'html' }))
    assert.equal((await readFile(after.path, 'utf8')).includes('data:image/svg+xml'), false)
    assert.ok(after.notes.some((one) => /1 figure points at something that is no longer in Create, so its description is written instead/.test(one)))

    // Only a chart or a diagram is a figure, and only a document takes one.
    const notPicture = await h.service.run('default', { operation: 'artifact.place', artifactId: id, figureId: (table.record as { artifactId: string }).artifactId })
    assert.equal(notPicture.ok, false)
    if (!notPicture.ok) assert.match(notPicture.message, /"Readings" is a table\. A figure is a chart or a diagram\./)
  }))

test('a download goes to the Downloads folder under a name of its own, is checked, and only such a file can be shown or opened', () =>
  withService(async (h) => {
    const made = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Monthly: expenses?', text: 'date,amount\n2026-10-01,12.5\n' }))
    const id = made.record.artifactId

    const first = ok<{ path: string; format: string; bytes: number; verified: { ok: boolean } }>(await h.service.run('default', { operation: 'artifact.download', artifactId: id, format: 'xlsx' }))
    assert.equal(first.path, join(h.dir, 'Downloads', 'Monthly expenses.xlsx'), 'the name is the title made safe, with the format\'s own extension')
    assert.equal(first.verified.ok, true)
    assert.equal((await readFile(first.path)).length, first.bytes)
    assert.equal((await readFile(first.path)).subarray(0, 2).toString('latin1'), 'PK', 'a real workbook, not text with a new name')

    // Never over what is already there.
    const second = ok<{ path: string }>(await h.service.run('default', { operation: 'artifact.download', artifactId: id, format: 'xlsx' }))
    assert.equal(second.path, join(h.dir, 'Downloads', 'Monthly expenses (2).xlsx'))
    const csv = ok<{ path: string }>(await h.service.run('default', { operation: 'artifact.download', artifactId: id, format: 'csv' }))
    assert.equal((await readFile(csv.path, 'utf8')).trim(), 'date,amount\n2026-10-01,12.5')

    // A format the kind is not written in is refused before anything is written.
    const wrong = await h.service.run('default', { operation: 'artifact.download', artifactId: id, format: 'pptx' })
    assert.equal(wrong.ok, false)

    ok(await h.service.run('default', { operation: 'artifact.reveal', path: first.path }))
    ok(await h.service.run('default', { operation: 'artifact.reveal', path: csv.path, open: true }))
    assert.deepEqual(h.revealed, [{ path: first.path, open: false }, { path: csv.path, open: true }])
    // A path the interface made up is not a file Orbis saved, whatever it points at.
    for (const path of [join(h.dir, 'Downloads'), 'C:\\Windows\\System32\\cmd.exe', first.path + '/../other', '']) {
      const refused = await h.service.run('default', { operation: 'artifact.reveal', path, open: true })
      assert.equal(refused.ok, false, path)
    }
    assert.equal(h.revealed.length, 2)
  }))

test('what is made on behalf of a conversation belongs to it, keeps belonging through new versions, and can be listed by it', () =>
  withService(async (h) => {
    const a = ok<{ record: { artifactId: string; conversationId?: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'A', text: 'x,y\n1,2\n3,4\n', conversationId: 'chat_one' }))
    assert.equal(a.record.conversationId, 'chat_one')
    const b = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'B', text: '# B\n', conversationId: 'chat_two' }))
    const loose = ok<{ record: { artifactId: string; conversationId?: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'C', text: '# C\n' }))
    assert.equal(loose.record.conversationId, undefined)

    // A new version made from a different conversation does not move it.
    const changed = ok<{ record: { version: number; conversationId?: string } }>(await h.service.run('default', { operation: 'artifact.transform', artifactId: a.record.artifactId, steps: [{ op: 'sort', by: ['y'] }], conversationId: 'chat_two' }))
    assert.equal(changed.record.version, 2)
    assert.equal(changed.record.conversationId, 'chat_one')
    // Something derived in another conversation belongs to the conversation that made it.
    const chart = ok<{ record: { conversationId?: string } }>(await h.service.run('default', { operation: 'artifact.chart', artifactId: a.record.artifactId, x: 'x', y: ['y'], conversationId: 'chat_two' }))
    assert.equal(chart.record.conversationId, 'chat_two')

    const inOne = ok<{ record: { title: string } }[]>(await h.service.run('default', { operation: 'artifact.list', within: 'chat_one' }))
    assert.deepEqual(inOne.map((one) => one.record.title), ['A'])
    const inTwo = ok<{ record: { artifactId: string } }[]>(await h.service.run('default', { operation: 'artifact.list', within: 'chat_two' }))
    assert.equal(inTwo.length, 2)
    assert.ok(inTwo.some((one) => one.record.artifactId === b.record.artifactId))
    assert.equal(ok<unknown[]>(await h.service.run('default', { operation: 'artifact.list' })).length, 4)

    // An id that is not an id is not kept: it would become part of a record on disk.
    const odd = ok<{ record: { conversationId?: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'D', text: '# D\n', conversationId: '../../etc' }))
    assert.equal(odd.record.conversationId, undefined)
  }))

test('a stopped request makes nothing and changes nothing', () =>
  withService(
    async (h) => {
      const stop = new AbortController()
      stop.abort()
      const made = await h.service.run('default', { operation: 'artifact.generate', request: 'a budget' }, stop.signal)
      assert.equal(made.ok, false)
      if (!made.ok) assert.equal(made.error, 'cancelled')
      assert.equal(ok<unknown[]>(await h.service.run('default', { operation: 'artifact.list' })).length, 0, 'nothing was kept')

      const doc = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'Plan', text: '# Plan\n' }))
      const revised = await h.service.run('default', { operation: 'artifact.revise', artifactId: doc.record.artifactId, request: 'longer' }, stop.signal)
      assert.equal(revised.ok, false)
      if (!revised.ok) assert.match(revised.message, /Stopped\. Nothing was changed\./)
      const still = ok<{ record: { version: number } }>(await h.service.run('default', { operation: 'artifact.read', artifactId: doc.record.artifactId }))
      assert.equal(still.record.version, 1)
    },
    { pdf: true, png: true, answers: [{ kind: 'table', title: 'Budget', columns: ['a'] }, { markdown: '# Plan\n\nMore.\n' }] }
  ))

test('a chart asked for in words is drawn from columns Orion names, having seen no numbers, and a column with none is argued with once', () =>
  withService(
    async (h) => {
      const made = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Readings', text: READINGS }))
      const chart = ok<{ record: { kind: string; title: string; shape: { rows: number; columns: number }; verified: { ok: boolean } } }>(
        await h.service.run('default', { operation: 'artifact.chart', artifactId: made.record.artifactId, request: 'a bar chart of energy by day' })
      )
      assert.equal(chart.record.kind, 'plot')
      assert.equal(chart.record.title, 'mwh by date')
      assert.equal(chart.record.verified.ok, true)
      assert.equal(h.asked.length, 2, 'the first plan drew a column of words, so it was asked again')
      assert.ok(h.asked[0].system.includes('mwh: ') && !h.asked[0].system.includes('412'), 'column names were shown, numbers were not')
      assert.match(h.asked[1].user, /"site" has no values that can be read as numbers/)

      // A name that is not a column never reaches the engine.
      const lost = await h.service.run('default', { operation: 'artifact.chart', artifactId: made.record.artifactId, request: 'wind against date' })
      assert.equal(lost.ok, false)
      if (!lost.ok) assert.match(lost.message, /"y" names "wind", which is not one of the columns: date, site, mwh, solar\./)
      const cannot = await h.service.run('default', { operation: 'artifact.chart', artifactId: made.record.artifactId, request: 'a map of the sites' })
      assert.equal(cannot.ok, false)
      if (!cannot.ok) assert.match(cannot.message, /cannot be drawn from this table: There is nowhere on a chart for a map\./)
    },
    {
      pdf: true,
      png: true,
      answers: [
        { x: 'date', y: ['site'], kind: 'bar' },
        { x: 'Date', y: ['mwh'], kind: 'bar' },
        { x: 'date', y: ['wind'] },
        { x: 'date', y: ['wind'] },
        { cannot: 'There is nowhere on a chart for a map.' }
      ]
    }
  ))

test('a table, a chart and a code file each become a document that can leave as PDF or Word, with nothing rewritten', () =>
  withService(async (h) => {
    const table = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Readings', text: READINGS }))
    const asDoc = ok<{ record: { artifactId: string; kind: string; title: string; derivedFrom: { artifactId: string } | null; notes: string[]; verified: { ok: boolean } } }>(
      await h.service.run('default', { operation: 'artifact.asDocument', artifactId: table.record.artifactId })
    )
    assert.equal(asDoc.record.kind, 'document')
    assert.equal(asDoc.record.title, 'Readings')
    assert.equal(asDoc.record.derivedFrom?.artifactId, table.record.artifactId)
    assert.equal(asDoc.record.verified.ok, true)
    assert.match(asDoc.record.notes[0], /Every one of the 4 rows of "Readings" \(version 1\) is in the document, as they were/)
    const read = ok<{ preview: string; tables: { rows: number; columns: number; headings: string[] }[] }>(await h.service.run('default', { operation: 'artifact.read', artifactId: asDoc.record.artifactId }))
    assert.deepEqual(read.tables.map((one) => [one.rows, one.columns]), [[4, 4]])
    assert.deepEqual(read.tables[0].headings, ['date', 'site', 'mwh', 'solar'])
    assert.ok(read.preview.includes('| 2026-10-03 | Warehouse | 530 | 140 |'), 'a date is a date and every value is there')

    const pdf = ok<{ path: string; verified: { ok: boolean } }>(await h.service.run('default', { operation: 'artifact.download', artifactId: asDoc.record.artifactId, format: 'pdf' }))
    assert.equal(pdf.verified.ok, true)
    assert.ok(pdf.path.endsWith('Readings.pdf'))
    assert.ok(h.printed[h.printed.length - 1].includes('Warehouse'))

    const chart = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.chart', artifactId: table.record.artifactId, x: 'date', y: ['mwh'], kind: 'bar' }))
    const chartDoc = ok<{ record: { artifactId: string; shape: { rows: number } } }>(await h.service.run('default', { operation: 'artifact.asDocument', artifactId: chart.record.artifactId }))
    assert.equal(chartDoc.record.shape.rows, 2, 'a heading and the figure')
    const word = ok<{ verified: { ok: boolean; checks: { what: string }[] } }>(await h.service.run('default', { operation: 'artifact.download', artifactId: chartDoc.record.artifactId, format: 'docx' }))
    assert.equal(word.verified.ok, true)
    assert.ok(word.verified.checks.some((one) => one.what === 'pictures'), 'the Word file holds the chart as a picture')

    const code = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'code', title: 'List files', language: 'python', text: 'import os\nprint(os.listdir("."))\n' }))
    const codeDoc = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.asDocument', artifactId: code.record.artifactId }))
    const kept = ok<{ preview: string }>(await h.service.run('default', { operation: 'artifact.read', artifactId: codeDoc.record.artifactId })).preview
    assert.ok(kept.includes('```python') && kept.includes('print(os.listdir("."))'))

    const already = await h.service.run('default', { operation: 'artifact.asDocument', artifactId: asDoc.record.artifactId })
    assert.equal(already.ok, false)
    if (!already.ok) assert.match(already.message, /already a document/)
  }))

test('a key cannot hide behind formatting: an underscore in a word stays one, and bold in the middle of a key does not split it', () =>
  withService(async (h) => {
    // The underscore in the key used to be read as the start of italics, which changed the stored text and let it through.
    const plain = await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'Deploy', text: `# Deploy\n\nUse the token ${KEY} to push.\n` })
    assert.equal(plain.ok, false)
    if (!plain.ok) assert.equal(plain.error, 'secrets')

    const split = await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'Deploy', text: `# Deploy\n\nUse ghp_**${KEY.slice(4, 20)}**${KEY.slice(20)} to push.\n` })
    assert.equal(split.ok, false, 'the words are read as well as the Markdown')
    if (!split.ok) assert.equal(split.error, 'secrets')

    // And ordinary words with underscores are kept exactly, with nothing turned into italics.
    const kept = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'document', title: 'Names', text: 'The file_name and the other_name, and 2 * 3 * 4.\n' }))
    const read = ok<{ preview: string }>(await h.service.run('default', { operation: 'artifact.read', artifactId: kept.record.artifactId }))
    assert.equal(read.preview.trim(), 'The file_name and the other_name, and 2 * 3 * 4.')
    assert.equal(ok<unknown[]>(await h.service.run('default', { operation: 'artifact.list' })).length, 1)
  }))

const SPEND = 'category,amount,last year\nRent,1200,1100\nFood,450,500\nTravel,150,90\nOther,200,210\n'

test('a pie is drawn from one column of amounts, kept as a chart that says it is a pie, and saved as a file that reads back', () =>
  withService(async (h) => {
    const table = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Spend', text: SPEND }))
    const tableId = table.record.artifactId
    const pie = ok<{ record: { artifactId: string; kind: string; title: string; verified: { ok: boolean }; notes: string[] } }>(await h.service.run('default', { operation: 'artifact.chart', artifactId: tableId, x: 'category', y: ['amount'], kind: 'pie' }))
    assert.equal(pie.record.kind, 'plot')
    assert.equal(pie.record.verified.ok, true)
    assert.match(pie.record.notes[0], /amount by category, as a pie: each slice is its share of the total\./)
    const read = ok<{ preview: string }>(await h.service.run('default', { operation: 'artifact.read', artifactId: pie.record.artifactId }))
    assert.equal((read.preview.match(/<path /g) ?? []).length, 4, 'four slices')
    for (const said of ['>Rent</text>', '1,200  ·  60.0%', '450  ·  22.5%', '150  ·  7.5%', '200  ·  10.0%', 'amount: 2,000 in all']) assert.ok(read.preview.includes(said), said)

    const saved = ok<{ path: string; verified: { ok: boolean } }>(await h.service.run('default', { operation: 'artifact.download', artifactId: pie.record.artifactId, format: 'svg' }))
    assert.equal(saved.verified.ok, true)
    assert.match(await readFile(saved.path, 'utf8'), /60\.0%/)

    // Two columns are not shares of one whole, and neither is a table too long to read as slices.
    const two = await h.service.run('default', { operation: 'artifact.chart', artifactId: tableId, x: 'category', y: ['amount', 'last year'], kind: 'pie' })
    assert.equal(two.ok, false)
    if (!two.ok) assert.match(two.message, /shares of one column/)
    const long = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Long', text: `name,n\n${Array.from({ length: 13 }, (_, i) => `r${i},${i + 1}`).join('\n')}\n` }))
    const tooMany = await h.service.run('default', { operation: 'artifact.chart', artifactId: long.record.artifactId, x: 'name', y: ['n'], kind: 'pie' })
    assert.equal(tooMany.ok, false)
    if (!tooMany.ok) assert.match(tooMany.message, /13 slices cannot be read: 12 is the most\. Total the table by a category first, or ask for bars\./)
    const negative = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Net', text: 'name,n\na,5\nb,-2\n' }))
    const below = await h.service.run('default', { operation: 'artifact.chart', artifactId: negative.record.artifactId, x: 'name', y: ['n'], kind: 'pie' })
    assert.equal(below.ok, false)
    if (!below.ok) assert.match(below.message, /below zero/)
  }))

test('the kind of chart the person named is the kind drawn, whatever the model choosing the columns preferred', () =>
  withService(
    async (h) => {
      const table = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Spend', text: SPEND }))
      // The model offers bars and two columns. The person said pie.
      const pie = ok<{ record: { artifactId: string; notes: string[] } }>(await h.service.run('default', { operation: 'artifact.chart', artifactId: table.record.artifactId, request: 'a pie chart of what I spend' }))
      assert.match(pie.record.notes[0], /as a pie/)
      // And redrawn as bars when bars are asked for, as the same chart's next version.
      const bars = ok<{ record: { artifactId: string; version: number; notes: string[] } }>(await h.service.run('default', { operation: 'artifact.chart', artifactId: table.record.artifactId, request: 'make it a bar chart', replace: pie.record.artifactId }))
      assert.equal(bars.record.artifactId, pie.record.artifactId)
      assert.equal(bars.record.version, 2)
      assert.match(bars.record.notes[0], /as bars/)
      const read = ok<{ preview: string }>(await h.service.run('default', { operation: 'artifact.read', artifactId: bars.record.artifactId }))
      assert.equal(read.preview.includes('in all'), false, 'the pie is gone; these are bars on axes')

      assert.equal(chartKindSaid('a pie chart of what I spend'), 'pie')
      assert.equal(chartKindSaid('make it a bar chart'), 'bar')
      assert.equal(chartKindSaid('show revenue over time'), null)
      assert.equal(chartKindSaid('a bar or a pie, whichever is clearer'), null, 'two named is nobody\'s decision')
    },
    {
      pdf: true,
      png: true,
      answers: [
        { x: 'category', y: ['amount', 'last year'], kind: 'bar' },
        { x: 'category', y: ['amount'], kind: 'line' }
      ]
    }
  ))

test('a document asked for at length is written in parts and kept as one document; a short one is still one answer', () =>
  withService(
    async (h) => {
      const long = ok<{ record: { artifactId: string; kind: string; title: string; notes: string[]; shape: { rows: number } } }>(await h.service.run('default', { operation: 'artifact.generate', request: 'a detailed report on remote work', kind: 'document' }))
      assert.equal(long.record.kind, 'document')
      assert.equal(long.record.title, 'Remote work')
      assert.match(long.record.notes[0], /in 3 parts, from an outline/)
      const read = ok<{ preview: string }>(await h.service.run('default', { operation: 'artifact.read', artifactId: long.record.artifactId }))
      assert.match(read.preview, /^# Remote work\n\n## Why\n\n[\s\S]*\n\n## How\n\n[\s\S]*\n\n## Next\n\n/)

      const short = ok<{ record: { notes: string[] } }>(await h.service.run('default', { operation: 'artifact.generate', request: 'a short note about lunch', kind: 'document' }))
      assert.equal(short.record.notes.some((one) => /parts/.test(one)), false)
      assert.equal(h.asked.length, 5, 'an outline, three parts, and one answer for the short one')
    },
    {
      pdf: true,
      png: true,
      answers: [
        { title: 'Remote work', purpose: 'p', parts: [{ heading: 'Why', brief: 'a' }, { heading: 'How', brief: 'b' }, { heading: 'Next', brief: 'c' }] },
        { markdown: 'It matters because people work better when they choose where. '.repeat(3) },
        { markdown: 'Start with one team and one day a week, then widen it slowly. '.repeat(3) },
        { markdown: 'Watch for isolation, and for meetings that grow to fill the day. '.repeat(3) },
        { kind: 'document', title: 'Lunch', markdown: '# Lunch\n\nSoup today.\n' }
      ]
    }
  ))

test('"Open" never runs code: a code file is shown in its folder, and it is saved under its own name once', () =>
  withService(async (h) => {
    const script = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'code', language: 'batch', title: 'setup', text: 'echo hello\r\n' }))
    const saved = ok<{ path: string }>(await h.service.run('default', { operation: 'artifact.download', artifactId: script.record.artifactId }))
    assert.match(saved.path, /setup\.bat$/)
    const open = await h.service.run('default', { operation: 'artifact.reveal', path: saved.path, open: true })
    assert.equal(open.ok, false)
    if (!open.ok) assert.match(open.message, /does not open a code file, because opening one can run it/)
    assert.deepEqual(h.revealed, [], 'nothing was handed to the computer to open')
    ok(await h.service.run('default', { operation: 'artifact.reveal', path: saved.path }))
    assert.deepEqual(h.revealed, [{ path: saved.path, open: false }])

    // A table's file is opened as before.
    const table = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'T', text: 'a,b\n1,2\n' }))
    const csv = ok<{ path: string }>(await h.service.run('default', { operation: 'artifact.download', artifactId: table.record.artifactId, format: 'csv' }))
    ok(await h.service.run('default', { operation: 'artifact.reveal', path: csv.path, open: true }))
    assert.equal(h.revealed.length, 2)

    // "report.py" is saved as report.py.
    const named = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'code', title: 'report.py', text: 'print(1)\n' }))
    const py = ok<{ path: string }>(await h.service.run('default', { operation: 'artifact.download', artifactId: named.record.artifactId }))
    assert.match(py.path, /[\\/]report\.py$/)
  }))

test('a table written with bars is kept cell for cell, and a second table in the text is said to have been left', () =>
  withService(async (h) => {
    const text = '| Item | Range | Site | Sum | Args |\n|---|---|---|---|---|\n| A | $5-$10 | [Example](https://example.com) | 2*3*4 | *args, **kwargs |\n| a \\| b | x | y | z | w |\n\nAnd another:\n\n| p | q |\n|---|---|\n| 1 | 2 |\n'
    const made = ok<{ record: { artifactId: string; notes: string[] } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Cells', text }))
    const read = ok<{ grid: { rows: string[][] }; columns: { name: string }[] }>(await h.service.run('default', { operation: 'artifact.read', artifactId: made.record.artifactId }))
    assert.deepEqual(read.columns.map((one) => one.name), ['Item', 'Range', 'Site', 'Sum', 'Args'])
    assert.deepEqual(read.grid.rows, [['A', '$5-$10', '[Example](https://example.com)', '2*3*4', '*args, **kwargs'], ['a | b', 'x', 'y', 'z', 'w']])
    assert.ok(made.record.notes.some((one) => /The text held 2 tables\. This is the first; the others were not kept\./.test(one)))
  }))

test('amounts in different units are not added up, and a table too long for a document says so plainly', () =>
  withService(async (h) => {
    const mixed = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Weights', text: 'item,weight\na,200 g\nb,1.5 kg\nc,750 g\n' }))
    const held = await h.service.contextOf('default', mixed.record.artifactId)
    assert.ok(held)
    assert.match(held!.text, /weight: the values are in different units \(.*g.*kg.*\), so Orbis gives no total, smallest or largest for it/)
    assert.equal(/sum 951\.5/.test(held!.text), false)
    assert.equal(held!.cut, false)

    const same = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Lengths', text: 'leg,distance\na,5 km\nb,2 km\n' }))
    assert.match((await h.service.contextOf('default', same.record.artifactId))!.text, /distance: 2 values, sum 7 km, mean 3\.5 km, smallest 2 km .* largest 5 km/)

    const long = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Long', text: `a,b,c,d,e\n${Array.from({ length: 3000 }, (_, i) => `row number ${i},some words here,${i},more words to fill,${i * 3}`).join('\n')}\n` }))
    assert.equal((await h.service.contextOf('default', long.record.artifactId))!.cut, true, 'only the first rows are shown, and that is said')
    const tooLong = await h.service.run('default', { operation: 'artifact.asDocument', artifactId: long.record.artifactId })
    assert.equal(tooLong.ok, false)
    if (!tooLong.ok) {
      assert.equal(tooLong.error, 'too-large')
      assert.match(tooLong.message, /"Long" is too long to put into one document: it comes to [\d,]+ characters, and a document holds 200,000\./)
    }
  }))

test('a script with a fence in it, and a table with a bar in a cell, both go into a document and come back whole', () =>
  withService(async (h) => {
    const script = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'code', language: 'javascript', title: 'md', text: 'const md = `\n```js\nx\n```\n`\n' }))
    const asDoc = ok<{ record: { verified: { ok: boolean } } }>(await h.service.run('default', { operation: 'artifact.asDocument', artifactId: script.record.artifactId }))
    assert.equal(asDoc.record.verified.ok, true)

    const pipes = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Pipes', text: 'command,meaning\n"ls | wc -l",count files\n"*args*",stars kept\n' }))
    const doc = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.asDocument', artifactId: pipes.record.artifactId }))
    const read = ok<{ preview: string }>(await h.service.run('default', { operation: 'artifact.read', artifactId: doc.record.artifactId }))
    assert.ok(read.preview.includes('ls \\| wc -l'), read.preview)
    const back = ok<{ record: { artifactId: string } }>(await h.service.run('default', { operation: 'artifact.extractTable', artifactId: doc.record.artifactId, index: 1 }))
    const grid = ok<{ grid: { rows: string[][] } }>(await h.service.run('default', { operation: 'artifact.read', artifactId: back.record.artifactId }))
    assert.deepEqual(grid.grid.rows, [['ls | wc -l', 'count files'], ['*args*', 'stars kept']], 'taken out again, every cell is what it was')
  }))

test('only something a request made is filed under its conversation: looking at a thing does not move it', () =>
  withService(async (h) => {
    const made = ok<{ record: { artifactId: string; conversationId?: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Mine', text: 'a\n1\n' }))
    const read = ok<{ record: { conversationId?: string } }>(await h.service.run('default', { operation: 'artifact.read', artifactId: made.record.artifactId, conversationId: 'convX' }))
    assert.equal(read.record.conversationId, undefined)
    assert.deepEqual(ok<unknown[]>(await h.service.run('default', { operation: 'artifact.list', within: 'convX' })), [])
    const inChat = ok<{ record: { conversationId?: string } }>(await h.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Theirs', text: 'a\n1\n', conversationId: 'convX' }))
    assert.equal(inChat.record.conversationId, 'convX')
  }))
