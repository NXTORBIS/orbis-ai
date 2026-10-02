import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserControl } from '../browserControl/registry.ts'
import { registerArtifactCapabilities } from './capabilities.ts'
import { ArtifactGeneration, type Asked } from './generation.ts'
import { ArtifactService } from './service.ts'
import { ArtifactStore } from './store.ts'

/*
 * The Orb's way in, against the real registry, the real service and a real folder. Only Orion is a stand-in.
 */

const approve = async (): Promise<boolean> => true

const setUp = async (answers: Record<string, unknown>[]): Promise<{ control: BrowserControl; service: ArtifactService; done(): Promise<void> }> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-artifact-caps-'))
  let n = 0
  const service = new ArtifactService({
    store: new ArtifactStore({ userData: dir }),
    now: () => 1000,
    random: () => (++n).toString(16).padStart(32, '0'),
    chooseDestination: async () => null,
    generation: new ArtifactGeneration({
      apiKeys: async () => ['k'],
      fetchFn: async () => {
        throw new Error('not used')
      },
      ask: async (): Promise<Asked> => {
        const next = answers.shift()
        return next ? { json: next } : { failed: 'the script ran out' }
      }
    })
  })
  const control = new BrowserControl()
  registerArtifactCapabilities(control, { service, profileId: async () => 'default' })
  return { control, service, done: () => rm(dir, { recursive: true, force: true }) }
}

test('every artifact capability has an id short enough for the planner to be shown, and says whether it changes anything', async () => {
  const { control, done } = await setUp([])
  try {
    const listed = control.list({ domain: 'artifacts' })
    assert.deepEqual(listed.map((one) => one.id).sort(), ['artifact.change', 'artifact.chart', 'artifact.list', 'artifact.make', 'artifact.revise'])
    for (const one of listed) assert.ok(one.id.length <= 16, `${one.id} is too long: the planner is shown the shortest ids first and cut off`)
    assert.equal(listed.find((one) => one.id === 'artifact.list')?.mutates, false)
    for (const id of ['artifact.make', 'artifact.change', 'artifact.chart', 'artifact.revise']) assert.equal(listed.find((one) => one.id === id)?.mutates, true, id)
  } finally {
    await done()
  }
})

test('the Orb changes a table and draws a chart from it, and each is confirmed by reading the library again', async () => {
  const { control, service, done } = await setUp([{ steps: [{ op: 'filter', where: [{ column: 'site', is: 'equals', value: 'HQ' }] }, { op: 'sort', by: [{ column: 'mwh', descending: true }] }] }])
  try {
    const made = await service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Readings', text: 'date,site,mwh\n2026-10-01,HQ,412\n2026-10-02,Depot,288\n2026-10-04,HQ,415\n' })
    assert.equal(made.ok, true)
    const id = (made as { value: { record: { artifactId: string } } }).value.record.artifactId

    const change = await control.execute({ capability: 'artifact.change', params: { artifactId: id, request: 'only HQ, biggest first' }, source: 'orion' }, { confirm: approve })
    assert.equal(change.ok, true, JSON.stringify(change.error))
    assert.equal(change.verification?.verified, true)
    assert.match(change.verification?.detail ?? '', /"Readings" is in the library at version 2/)
    const did = (change.data as { did: string[] }).did
    assert.equal(did[0], 'Kept 2 of 3 rows where site is "HQ".')

    const chart = await control.execute({ capability: 'artifact.chart', params: { artifactId: id, x: 'date', y: 'mwh', kind: 'bar' }, source: 'orion' }, { confirm: approve })
    assert.equal(chart.ok, true, JSON.stringify(chart.error))
    assert.equal(chart.verification?.verified, true)
    assert.equal((chart.data as { kind: string }).kind, 'plot')

    const list = await control.execute({ capability: 'artifact.list' }, { confirm: approve })
    assert.equal((list.data as { count: number }).count, 2)

    // A column that is not there is the engine's own sentence, not a silent nothing.
    const bad = await control.execute({ capability: 'artifact.chart', params: { artifactId: id, x: 'date', y: 'wind' }, source: 'orion' }, { confirm: approve })
    assert.equal(bad.ok, false)
    assert.match(bad.error?.message ?? '', /no column called "wind"/)
    const empty = await control.execute({ capability: 'artifact.change', params: { artifactId: id, request: '  ' }, source: 'orion' }, { confirm: approve })
    assert.equal(empty.ok, false)
  } finally {
    await done()
  }
})

test('the Orb revises a document, and is told to use the table capability for a table', async () => {
  const { control, service, done } = await setUp([{ markdown: '# Plan\n\nShip it.\n\n## Risks\n\n- (fill in)\n' }])
  try {
    const made = await service.run('default', { operation: 'artifact.create', kind: 'document', title: 'Plan', text: '# Plan\n\nShip it.\n' })
    const id = (made as { value: { record: { artifactId: string } } }).value.record.artifactId
    const revised = await control.execute({ capability: 'artifact.revise', params: { artifactId: id, request: 'add a risks section' }, source: 'orion' }, { confirm: approve })
    assert.equal(revised.ok, true, JSON.stringify(revised.error))
    assert.equal(revised.verification?.verified, true)
    assert.equal((revised.data as { version: number }).version, 2)

    const table = await service.run('default', { operation: 'artifact.create', kind: 'table', title: 'T', text: 'a,b\n1,2\n' })
    const wrong = await control.execute({ capability: 'artifact.revise', params: { artifactId: (table as { value: { record: { artifactId: string } } }).value.record.artifactId, request: 'double b' }, source: 'orion' }, { confirm: approve })
    assert.equal(wrong.ok, false)
    assert.match(wrong.error?.message ?? '', /Change this table/)
  } finally {
    await done()
  }
})
