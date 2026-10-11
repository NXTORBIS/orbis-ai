import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compile, isCompileError } from '../../shared/pages/compiler.ts'
import { SPEC_VERSION, type PageSpec } from '../../shared/pages/spec.ts'
import { publish, startGraph, type VersionGraph } from '../../shared/pages/versioning.ts'
import { manifestToJson } from '../../shared/pages/manifest.ts'
import { cleanGraph, cleanSaved, GeneratedStore, GENERATED_LIMITS } from './generatedStore.ts'

const OPERATIONS: Readonly<Record<string, string>> = Object.freeze({ 'motion.projectile': 'computation.physics' })

const spec: PageSpec = {
  specVersion: SPEC_VERSION,
  title: 'Projectile Range',
  purpose: 'Work out how far something thrown at an angle travels before it lands.',
  inputs: [
    { name: 'speed', kind: 'number', label: 'Launch speed', initial: 20, minimum: 1, maximum: 200 },
    { name: 'angle', kind: 'number', label: 'Launch angle', initial: 45, minimum: 1, maximum: 89 }
  ],
  steps: [
    {
      name: 'flight',
      operation: 'motion.projectile',
      arguments: { speed: { input: 'speed' }, angle: { input: 'angle' }, gravity: { value: 9.81 } },
      when: 'change'
    }
  ],
  outputs: [{ name: 'range', label: 'How far it goes', display: 'statistic', step: 'flight', pick: 'range' }],
  sections: [
    { title: 'The throw', members: ['speed', 'angle'] },
    { title: 'Where it lands', members: ['range'] }
  ],
  notes: ['There is no air resistance in this calculation.'],
  keywords: ['projectile', 'range']
}

const built = (): { graph: VersionGraph; asJson: Record<string, unknown> } => {
  const compiled = compile(spec, { operations: OPERATIONS, pageId: 'page_a1b2c3d4e5f6a7b8c9d0e1f2' })
  assert.ok(!isCompileError(compiled))
  const graph = startGraph({
    pageId: compiled.manifest.pageId,
    versionId: 'v1',
    spec: compiled.spec,
    manifest: compiled.manifest,
    document: compiled.document,
    now: 1000
  })
  const published = publish(graph, 'v1')
  assert.ok(!('error' in published))
  // How it is actually written: JSON, with the manifest in the form a manifest travels in.
  const asJson = JSON.parse(
    JSON.stringify({
      ...published,
      nodes: published.nodes.map((one) => ({ ...one, manifest: manifestToJson(one.manifest) }))
    })
  ) as Record<string, unknown>
  return { graph: published, asJson }
}

describe('reading a graph back', () => {
  it('returns what was written', () => {
    const { graph, asJson } = built()
    const read = cleanGraph(asJson, OPERATIONS)
    assert.ok(read !== null)
    assert.equal(read.pageId, graph.pageId)
    assert.equal(read.publishedVersionId, 'v1')
    assert.equal(read.nodes.length, 1)
    assert.deepEqual(read.nodes[0].document, graph.nodes[0].document)
    assert.equal(read.nodes[0].spec.title, 'Projectile Range')
  })

  it('refuses a version whose document would not run', () => {
    // The file is a file, and this is what a hand-edited one looks like. A Page that appears in the library and fails
    // when somebody opens it is worse than one that is missing.
    const { asJson } = built()
    const nodes = asJson.nodes as Record<string, unknown>[]
    ;(nodes[0].document as { computations: { operation: string }[] }).computations[0].operation = ''
    assert.equal(cleanGraph(asJson, OPERATIONS), null)
  })

  it('refuses a version whose manifest does not validate', () => {
    const { asJson } = built()
    const nodes = asJson.nodes as Record<string, unknown>[]
    ;(nodes[0].manifest as Record<string, unknown>).capabilities = ['secrets.read']
    assert.equal(cleanGraph(asJson, OPERATIONS), null)
  })

  it('refuses a version whose specification uses something Orbis does not have', () => {
    const { asJson } = built()
    const nodes = asJson.nodes as Record<string, unknown>[]
    ;((nodes[0].spec as Record<string, unknown>).steps as Record<string, unknown>[])[0].operation = 'secrets.read'
    assert.equal(cleanGraph(asJson, OPERATIONS), null)
  })

  it('drops a bad version and keeps the good ones, rather than losing the whole Page', () => {
    const { asJson } = built()
    const nodes = asJson.nodes as Record<string, unknown>[]
    asJson.nodes = [{ ...nodes[0], versionId: 'v0', state: 'superseded', createdAt: 900, document: 'not a document' }, nodes[0]]
    const read = cleanGraph(asJson, OPERATIONS)
    assert.ok(read !== null)
    assert.deepEqual(read.nodes.map((one) => one.versionId), ['v1'])
  })

  it('corrects a file claiming two versions are published', () => {
    // One address cannot have two answers. The graph's own `publishedVersionId` is the authority, and a node
    // disagreeing with it is demoted rather than believed.
    const { asJson } = built()
    const nodes = asJson.nodes as Record<string, unknown>[]
    asJson.nodes = [nodes[0], { ...nodes[0], versionId: 'v2', createdAt: 2000, state: 'published' }]
    const read = cleanGraph(asJson, OPERATIONS)
    assert.ok(read !== null)
    assert.equal(read.nodes.filter((one) => one.state === 'published').length, 1)
    assert.equal(read.nodes.find((one) => one.state === 'published')?.versionId, 'v1')
  })

  it('forgets a published id that names nothing', () => {
    const { asJson } = built()
    asJson.publishedVersionId = 'v9'
    const read = cleanGraph(asJson, OPERATIONS)
    assert.ok(read !== null)
    assert.equal(read.publishedVersionId, null)
  })

  it('refuses a graph with nothing left in it', () => {
    const { asJson } = built()
    asJson.nodes = []
    assert.equal(cleanGraph(asJson, OPERATIONS), null)
    assert.equal(cleanGraph({ pageId: 'page_a1b2c3d4e5f6a7b8c9d0e1f2' }, OPERATIONS), null)
    assert.equal(cleanGraph(null, OPERATIONS), null)
    assert.equal(cleanGraph('a graph', OPERATIONS), null)
  })
})

describe('reading the whole file back', () => {
  it('survives a file that is not what it should be', () => {
    for (const rubbish of [null, 'text', 42, [], { graphs: 'no' }, { graphs: [null, 1, 'two'] }]) {
      const read = cleanSaved(rubbish, OPERATIONS)
      assert.deepEqual(read.graphs, [])
      assert.deepEqual(read.sessions, [])
    }
  })

  it('caps how many Pages one profile keeps', () => {
    const { asJson } = built()
    const many = new Array(GENERATED_LIMITS.pages + 20).fill(0).map((_, i) => ({ ...asJson, pageId: `page_${String(i).padStart(20, '0')}` }))
    assert.equal(cleanSaved({ graphs: many, sessions: [] }, OPERATIONS).graphs.length, GENERATED_LIMITS.pages)
  })

  it('reads a session back without the parts that only meant something while it was running', () => {
    const session = {
      sessionId: 's1',
      request: 'projectile range',
      profileId: 'p1',
      startedAt: 1000,
      updatedAt: 2000,
      stage: 'planning',
      attempts: 2,
      raw: '{"specVersion":1}',
      spec: { specVersion: 1 },
      built: { manifest: {}, document: {} },
      validation: { passed: true },
      history: [{ stage: 'resolving', at: 1000, note: 'looking' }]
    }
    const read = cleanSaved({ graphs: [], sessions: [session] }, OPERATIONS)
    assert.equal(read.sessions.length, 1)
    assert.equal(read.sessions[0].stage, 'planning')
    assert.equal(read.sessions[0].attempts, 2)
    assert.equal(read.sessions[0].raw, '{"specVersion":1}')
    // A session found on disk starts again from the ladder, so what it had half-built is not carried back.
    assert.equal(read.sessions[0].spec, null)
    assert.equal(read.sessions[0].built, null)
    assert.equal(read.sessions[0].validation, null)
    assert.equal(read.sessions[0].resolution, null)
  })

  it('refuses a session in a stage that does not exist', () => {
    const read = cleanSaved(
      { graphs: [], sessions: [{ sessionId: 's1', request: 'r', profileId: 'p', startedAt: 1, updatedAt: 2, stage: 'uploading' }] },
      OPERATIONS
    )
    assert.deepEqual(read.sessions, [])
  })

  it('caps how many sessions are remembered', () => {
    const one = { sessionId: 's', request: 'r', profileId: 'p', startedAt: 1, updatedAt: 2, stage: 'failed' }
    const many = new Array(GENERATED_LIMITS.sessions + 30).fill(0).map((_, i) => ({ ...one, sessionId: `s${i}` }))
    const read = cleanSaved({ graphs: [], sessions: many }, OPERATIONS)
    assert.equal(read.sessions.length, GENERATED_LIMITS.sessions)
    // The newest are the ones kept.
    assert.equal(read.sessions.at(-1)?.sessionId, `s${many.length - 1}`)
  })
})

/**
 * The file on disk, in the four states it can really be in.
 *
 * Everything above is `cleanSaved` on a value somebody handed it. These are about the file: no file, a file that reads
 * and makes sense, a file that reads and does not, and a file that cannot be read at all. Three of those used to be
 * treated as one, and the middle one is the one that lost Pages -- a write interrupted half-way leaves bytes that are
 * perfectly readable and not JSON, and calling that "there is nothing here" meant starting empty and then renaming
 * that emptiness over every Page the person had built.
 */
describe('the file on disk', () => {
  const PROFILE = 'default'
  const fileIn = (dir: string): string => join(dir, 'pages', 'generated.json')

  /** Copies of a damaged file, by the name `quarantine()` gives them. */
  const movedAside = async (dir: string): Promise<string[]> =>
    (await readdir(join(dir, 'pages'))).filter((name) => name.startsWith('generated.json.unreadable-'))

  async function withDir(body: (dir: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'orbis-generated-store-'))
    try {
      await body(dir)
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  }

  it('reads back a Page it wrote, which is what surviving a restart means', async () => {
    await withDir(async (dir) => {
      const { graph } = built()
      const before = new GeneratedStore(dir, OPERATIONS)
      assert.deepEqual(await before.putGraph(PROFILE, graph), { saved: true, message: '' })
      await before.flush()

      // The whole point of writing the file. It used to come back empty: a manifest holds its version as three numbers
      // in memory, `JSON.stringify` wrote that out as an object, and every version was then dropped on the way in.
      const after = new GeneratedStore(dir, OPERATIONS)
      const read = await after.graphs(PROFILE)
      assert.equal(read.length, 1)
      assert.equal(read[0].pageId, graph.pageId)
      assert.equal(read[0].publishedVersionId, 'v1')
      assert.deepEqual(await movedAside(dir), [])
    })
  })

  it('moves a half-written file aside, and its words are still on the disk afterwards', async () => {
    await withDir(async (dir) => {
      // Exactly what a write interrupted half-way leaves behind: readable, and not JSON.
      const half = '{"graphs":[{"pageId":"page_a1b2c3d4e5f6a7b8c9d0e1f2","nodes":[{"versionId":"v1","man'
      await mkdir(join(dir, 'pages'), { recursive: true })
      await writeFile(fileIn(dir), half, 'utf8')

      const store = new GeneratedStore(dir, OPERATIONS)
      assert.deepEqual(await store.graphs(PROFILE), [])

      const moved = await movedAside(dir)
      assert.equal(moved.length, 1)
      assert.equal(await readFile(join(dir, 'pages', moved[0]), 'utf8'), half)

      // Moved rather than overwritten, so this session may now save normally.
      await store.putGraph(PROFILE, built().graph)
      await store.flush()
      const written = JSON.parse(await readFile(fileIn(dir), 'utf8')) as { graphs: unknown[] }
      assert.equal(written.graphs.length, 1)
      assert.equal((await movedAside(dir)).length, 1)
    })
  })

/**
 * `refused` rather than a bare call: a save that cannot be written now says so.
 *
 * These three used to call `setFavourite`/`putGraph` and ignore the answer, because the answer was the new value --
 * the store changed its cache, returned happily, and only the write at the end was refused. So the screen said it
 * saved and nothing had been written. The refusal happens at the read now, before anything is changed.
 */
const refused = async (save: () => Promise<unknown>): Promise<void> => {
  await assert.rejects(save, /could not make sense of/)
}

  it('never writes over a file that is there and cannot be read, however many saves follow', async () => {
    await withDir(async (dir) => {
      // A directory where the file should be is a file that exists and cannot be read -- EISDIR, not ENOENT -- which
      // is the same answer Orbis gets on Windows for the moment something else is holding the real file open.
      await mkdir(fileIn(dir), { recursive: true })

      const store = new GeneratedStore(dir, OPERATIONS)
      assert.deepEqual(await store.graphs(PROFILE), [])

      await refused(() => store.putGraph(PROFILE, built().graph))
      await store.flush()
      // Nothing moved, nothing written beside it, nothing left half-written: only the thing that was in the way.
      assert.deepEqual(await readdir(join(dir, 'pages')), ['generated.json'])

      // And again. The refusal used to clear itself on the way out, so the second save went through and did the damage
      // the first one had just avoided.
      await refused(() => store.putGraph(PROFILE, { ...built().graph, pageId: 'page_c1b2c3d4e5f6a7b8c9d0e1f2' }))
      await store.flush()
      assert.deepEqual(await readdir(join(dir, 'pages')), ['generated.json'])

      // Including on the way out of the process.
      await refused(() => store.putGraph(PROFILE, { ...built().graph, pageId: 'page_d1b2c3d4e5f6a7b8c9d0e1f2' }))
      store.flushSync()
      assert.deepEqual(await readdir(join(dir, 'pages')), ['generated.json'])
    })
  })

  it('still starts empty when there is no file, and still writes one', async () => {
    await withDir(async (dir) => {
      const store = new GeneratedStore(dir, OPERATIONS)
      assert.deepEqual(await store.graphs(PROFILE), [])
      assert.deepEqual(await store.sessions(PROFILE, 1000), [])

      await store.putGraph(PROFILE, built().graph)
      await store.flush()
      const written = JSON.parse(await readFile(fileIn(dir), 'utf8')) as { graphs: unknown[] }
      assert.equal(written.graphs.length, 1)
      // Nothing was moved aside, because there was nothing there to move.
      assert.deepEqual(await movedAside(dir), [])
    })
  })
})
