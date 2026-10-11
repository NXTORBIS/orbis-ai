import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkflowStore } from './store.ts'
import { newWorkflow } from '../../shared/workflows.ts'
import { DEFAULT_PROFILE_ID, dataDirFor } from '../../shared/profiles.ts'

test('each profile keeps its own workflows, versions and run history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-wf-'))
  try {
    const store = new WorkflowStore(dir)
    await store.save(newWorkflow('Default profile skill', 'wf-default'))
    await store.recordRun({ runId: 'r1', workflowId: 'wf-default', workflowName: 'x', version: 1, source: 'automation', trigger: 'manual', status: 'completed', startedAt: 1, finishedAt: 2, durationMs: 1, stepsRun: 1, steps: [] })
    assert.ok(existsSync(join(dir, dataDirFor(DEFAULT_PROFILE_ID), 'workflows', 'items', 'wf-default.json')), 'the default profile keeps its old folder')

    store.useProfile('work')
    assert.equal(store.profile, 'work')
    assert.deepEqual(await store.list(), [], 'another profile sees none of them')
    assert.deepEqual(await store.runs(), [])
    await store.save(newWorkflow('Work profile skill', 'wf-work'))

    store.useProfile(DEFAULT_PROFILE_ID)
    assert.deepEqual((await store.list()).map((w) => w.id), ['wf-default'])
    assert.equal((await store.runs()).length, 1)

    // A fresh store opened on the other profile reads it back from disk.
    const reopened = new WorkflowStore(dir, undefined, 'work')
    assert.deepEqual((await reopened.list()).map((w) => w.id), ['wf-work'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a workflow file that will not parse is moved aside, not written over', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-wf-'))
  try {
    const items = join(dir, dataDirFor(DEFAULT_PROFILE_ID), 'workflows', 'items')
    mkdirSync(items, { recursive: true })
    // Half a file: what Orbis stopping mid-save leaves behind. It reads perfectly well and does not parse.
    const path = join(items, 'wf-half.json')
    writeFileSync(path, '{"format":1,"id":"wf-half","name":"Pay the invoices","steps":[{"kind":"op')

    const store = new WorkflowStore(dir)
    assert.deepEqual(await store.list(), [], 'the library carries on without it')
    const moved = readdirSync(items).filter((name) => name.includes('.unreadable-'))
    assert.equal(moved.length, 1, 'the original words are still on the disk')
    assert.ok(readFileSync(join(items, moved[0]), 'utf8').includes('Pay the invoices'), 'and they are the words that were there')

    // Only now may that name be used again. It used to be writable straight away, with nothing kept.
    await store.save(newWorkflow('Pay the invoices', 'wf-half'))
    assert.deepEqual((await new WorkflowStore(dir).list()).map((w) => w.name), ['Pay the invoices'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a workflow saved by a newer Orbis is kept, not quietly dropped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-wf-'))
  try {
    const items = join(dir, dataDirFor(DEFAULT_PROFILE_ID), 'workflows', 'items')
    mkdirSync(items, { recursive: true })
    // A format number this version has never heard of. Perfectly good JSON, so only the format check catches it.
    writeFileSync(join(items, 'wf-future.json'), JSON.stringify({ ...newWorkflow('From a newer Orbis', 'wf-future'), format: 99 }))

    assert.deepEqual(await new WorkflowStore(dir).list(), [], 'this version does not pretend to understand it')
    const moved = readdirSync(items).filter((name) => name.includes('.unreadable-'))
    assert.equal(moved.length, 1, 'it was moved aside rather than left for the next save to land on')
    assert.ok(readFileSync(join(items, moved[0]), 'utf8').includes('From a newer Orbis'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a run history that will not parse is moved aside, and a missing one just starts empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-wf-'))
  try {
    const home = join(dir, dataDirFor(DEFAULT_PROFILE_ID), 'workflows')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'runs.json'), '[{"runId":"r1","workflowId":"wf-1"')

    const store = new WorkflowStore(dir)
    assert.deepEqual(await store.runs(), [])
    assert.equal(readdirSync(home).filter((name) => name.includes('.unreadable-')).length, 1, 'the history that was there is still there')
    await store.recordRun({ runId: 'r2', workflowId: 'wf-1', workflowName: 'x', version: 1, source: 'automation', trigger: 'manual', status: 'completed', startedAt: 1, finishedAt: 2, durationMs: 1, stepsRun: 1, steps: [] })
    assert.deepEqual((await new WorkflowStore(dir).runs()).map((r) => r.runId), ['r2'])

    // No file at all is the other case, and it must stay as it was: defaults, and saving allowed.
    const empty = mkdtempSync(join(tmpdir(), 'orbis-wf-'))
    try {
      const fresh = new WorkflowStore(empty)
      assert.deepEqual(await fresh.runs(), [])
      assert.deepEqual(await fresh.versions('wf-1'), [])
      assert.deepEqual(await fresh.checkpoints(), [])
      await fresh.save(newWorkflow('First one', 'wf-first'))
      assert.ok(existsSync(join(empty, dataDirFor(DEFAULT_PROFILE_ID), 'workflows', 'items', 'wf-first.json')), 'nothing was quarantined and the save went through')
      assert.equal(readdirSync(join(empty, dataDirFor(DEFAULT_PROFILE_ID), 'workflows', 'items')).filter((n) => n.includes('.unreadable-')).length, 0)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
