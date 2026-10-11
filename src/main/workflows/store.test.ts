import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkflowStore } from './store.ts'
import { newWorkflow } from '../../shared/workflows.ts'
import type { WorkflowRunSummary } from '../../shared/workflows'
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

test('a workflow saved by a newer Orbis is left exactly where that Orbis put it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-wf-'))
  try {
    const items = join(dir, dataDirFor(DEFAULT_PROFILE_ID), 'workflows', 'items')
    mkdirSync(items, { recursive: true })
    // A format number this version has never heard of. Perfectly good JSON, so only the format check catches it.
    const future = join(items, 'wf-future.json')
    writeFileSync(future, JSON.stringify({ ...newWorkflow('From a newer Orbis', 'wf-future'), format: 99 }))

    const store = new WorkflowStore(dir)
    assert.deepEqual(await store.list(), [], 'this version does not pretend to understand it')
    // Not renamed: the newer Orbis has to find its workflow where it left it, and its skill's details are kept by
    // `skillManager` for the same reason. Moving this half aside leaves that half pointing at nothing.
    assert.deepEqual(readdirSync(items), ['wf-future.json'], 'and does not move it out from under the version that wrote it')

    // The name is refused instead, so a save cannot land on it either.
    await store.save(newWorkflow('Pay the invoices', 'wf-future'))
    assert.ok(readFileSync(future, 'utf8').includes('From a newer Orbis'), 'nothing was written over it')

    // Rubbish that happens to be JSON is the other case, and that one really is damage: moved aside, name freed.
    writeFileSync(join(items, 'wf-junk.json'), '12345')
    assert.deepEqual(await new WorkflowStore(dir).list(), [])
    const moved = readdirSync(items).filter((name) => name.includes('.unreadable-'))
    assert.deepEqual(moved.map((name) => name.split('.json')[0]), ['wf-junk'], 'only the rubbish was moved')
    assert.equal(readFileSync(join(items, moved[0]), 'utf8'), '12345', 'and even that is still on the disk')
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

/**
 * A folder where one of these files should be stands in for the case that actually loses data -- something else
 * holding the file, which reads perfectly well and will not rename, so the file is damaged and cannot be moved
 * aside. Both arrive here as "it is there and Orbis could not read it", and only this one happens the same way on
 * every machine every time.
 */
const unreadableFileAt = (path: string, keep: string): void => {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'kept.txt'), keep)
}

test('a second save cannot write over a file the first save refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-wf-'))
  try {
    const home = join(dir, dataDirFor(DEFAULT_PROFILE_ID), 'workflows')
    mkdirSync(home, { recursive: true })
    const runs = join(home, 'runs.json')
    unreadableFileAt(runs, 'the only history there is')

    const store = new WorkflowStore(dir)
    const run = (runId: string): WorkflowRunSummary => ({ runId, workflowId: 'wf-1', workflowName: 'x', version: 1, source: 'automation', trigger: 'manual', status: 'completed', startedAt: 1, finishedAt: 2, durationMs: 1, stepsRun: 1, steps: [] })
    assert.deepEqual(await store.runs(), [], 'the history reads as empty, and that empty must not be written')

    // Two runs in one session is ordinary, and the history is cached, so nothing reads this path again in between.
    // The first save used to clear the mark on its way out and the second one wrote straight over the file.
    await store.recordRun(run('r1'))
    await store.recordRun(run('r2')).catch((err: unknown) => assert.fail(`the second save should be refused too, not attempted: ${String(err)}`))
    assert.equal(existsSync(`${runs}.tmp`), false, 'nothing was written beside it either')
    assert.deepEqual(readdirSync(runs), ['kept.txt'], 'and what was there is untouched')

    // Same again for a workflow itself, which is the file that exists nowhere else.
    const items = join(home, 'items')
    mkdirSync(items)
    const half = join(items, 'wf-half.json')
    unreadableFileAt(half, 'Pay the invoices')
    const fresh = new WorkflowStore(dir)
    assert.deepEqual(await fresh.list(), [])
    await fresh.save(newWorkflow('Pay the invoices', 'wf-half'))
    await fresh.save(newWorkflow('Pay the invoices', 'wf-half')).catch((err: unknown) => assert.fail(`the second save should be refused too: ${String(err)}`))
    assert.equal(existsSync(`${half}.tmp`), false, 'no blank workflow was written where the real one is')
    assert.deepEqual(readdirSync(half), ['kept.txt'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('nothing Orbis could not read is deleted, including on the paths that went round the guard', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-wf-'))
  try {
    const home = join(dir, dataDirFor(DEFAULT_PROFILE_ID), 'workflows')
    const items = join(home, 'items')
    mkdirSync(items, { recursive: true })
    const future = join(items, 'wf-future.json')
    writeFileSync(future, JSON.stringify({ ...newWorkflow('From a newer Orbis', 'wf-future'), format: 99 }))
    const checkpoints = join(home, 'checkpoints')
    mkdirSync(checkpoints)
    const bad = join(checkpoints, 'r-bad.json')
    unreadableFileAt(bad, 'half a checkpoint')
    writeFileSync(join(checkpoints, 'r-good.json'), JSON.stringify({ runId: 'r-good', workflowId: 'wf-1', version: 1, nextTopIndex: 1, variables: {}, inputs: {}, savedAt: 5 }))

    const store = new WorkflowStore(dir)
    assert.deepEqual(await store.list(), [])
    // Removing used to delete the file with `fs.rm` straight, so none of the refusing applied to it at all.
    await store.remove('wf-future')
    assert.ok(existsSync(future), 'a workflow this version cannot read is refused, not deleted')

    assert.deepEqual((await store.checkpoints()).map((c) => c.runId), ['r-good'])
    // The engine clears a checkpoint by run id the moment the run ends, for every run, read or not.
    await store.clearCheckpoint('r-bad').catch((err: unknown) => assert.fail(`clearing a checkpoint it could not read should be refused, not attempted: ${String(err)}`))
    assert.ok(existsSync(bad), 'and that cannot take away the one Orbis never managed to read')

    // One it could read is still cleared, so refusing has not stopped the ordinary case.
    await store.clearCheckpoint('r-good')
    assert.equal(existsSync(join(checkpoints, 'r-good.json')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a checkpoint that was moved aside is not moved aside again on every look', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-wf-'))
  try {
    const checkpoints = join(dir, dataDirFor(DEFAULT_PROFILE_ID), 'workflows', 'checkpoints')
    mkdirSync(checkpoints, { recursive: true })
    writeFileSync(join(checkpoints, 'r1.json'), '{"runId":"r1","savedAt"')

    // Asked three times, as Orbis asks it: once at startup, and again whenever somebody looks at what was
    // interrupted. This folder is read by name, so it used to read back the copy it had just moved aside.
    const store = new WorkflowStore(dir)
    for (let look = 0; look < 3; look++) assert.deepEqual(await store.checkpoints(), [])
    const moved = readdirSync(checkpoints)
    assert.equal(moved.length, 1, 'one copy, not one per look')
    assert.equal(moved[0].split('.unreadable-').length, 2, 'and one stamp on its name, not three')
    assert.equal(readFileSync(join(checkpoints, moved[0]), 'utf8'), '{"runId":"r1","savedAt"')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('deleting a workflow really deletes its history, even after a moment of the file being held', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-wf-'))
  try {
    const store = new WorkflowStore(dir)
    const made = await store.save(newWorkflow('Monday report', 'wf-x'), 'first')
    // A change to the definition, not the name: a library-only change makes no version.
    await store.save({ ...made, variables: { ...made.variables, note: 'revised' } }, 'second')
    const home = join(dir, dataDirFor(DEFAULT_PROFILE_ID), 'workflows')
    const history = join(home, 'versions', 'wf-x.json')
    assert.ok(existsSync(history), 'the earlier definition is kept')
    const real = readFileSync(history, 'utf8')

    // Somebody opens the version history while a backup holds that one file for a fifth of a second. The history
    // shows empty and the path is marked. Then the lock clears.
    rmSync(history)
    mkdirSync(history)
    assert.deepEqual(await store.versions('wf-x'), [], 'nothing could be read, so the history looks empty')
    rmSync(history, { recursive: true })
    writeFileSync(history, real)

    // Deleting used to consult the mark set a moment ago and refuse -- silently, while the window reported the
    // workflow deleted. What was left behind is every earlier definition of it, with its step values and variables.
    await store.remove('wf-x')
    assert.equal(existsSync(history), false, 'the history goes with the workflow')
    assert.equal(existsSync(join(home, 'items', 'wf-x.json')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
