import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
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
