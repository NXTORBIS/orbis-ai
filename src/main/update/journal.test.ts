import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_ATTEMPTS, readTransaction, recoveryFor, UpdateJournal } from './journal.ts'
import type { UpdateStep, UpdateTransaction } from './journal.ts'

const transaction = (patch: Partial<UpdateTransaction> = {}): UpdateTransaction => ({
  id: 'u1',
  step: 'update-started',
  fromVersion: '1.0.0',
  toVersion: '1.1.0',
  packagePath: 'C:/updates/orbis-1.1.0.exe',
  rollbackPackagePath: 'C:/updates/orbis-1.0.0.exe',
  startedAt: 1000,
  updatedAt: 1000,
  attempts: 1,
  ...patch
})

async function withTemp<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-journal-'))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
}

test('nothing recorded means nothing to recover', () => {
  assert.deepEqual(recoveryFor(null), { action: 'none' })
  assert.deepEqual(recoveryFor(transaction({ step: 'completed' })), { action: 'none' })
  assert.deepEqual(recoveryFor(transaction({ step: 'rolled-back' })), { action: 'none' })
})

test('an update interrupted before anything was replaced simply goes again', () => {
  for (const step of ['update-started', 'package-verified', 'staged'] as UpdateStep[]) {
    const recovery = recoveryFor(transaction({ step }))
    assert.equal(recovery.action, 'retry-install', `${step} left the installed Orbis untouched`)
  }
})

test('an update interrupted while it was being installed puts the old version back', () => {
  const recovery = recoveryFor(transaction({ step: 'install-started' }))
  assert.equal(recovery.action, 'roll-back')
  assert.match(recovery.action === 'roll-back' ? recovery.reason : '', /while the update was being installed/)
  assert.equal(recovery.action === 'roll-back' ? recovery.transaction.rollbackPackagePath : null, 'C:/updates/orbis-1.0.0.exe')
})

test('an update that was installed but never shown to work is checked before it is trusted', () => {
  for (const step of ['install-completed', 'validation-started', 'validation-completed'] as UpdateStep[]) {
    assert.equal(recoveryFor(transaction({ step })).action, 'validate', `${step} still has to prove itself`)
  }
})

test('an update that keeps failing is given up rather than retried on every start', () => {
  const recovery = recoveryFor(transaction({ step: 'install-started', attempts: MAX_ATTEMPTS }))
  assert.equal(recovery.action, 'give-up')
  assert.match(recovery.action === 'give-up' ? recovery.reason : '', new RegExp(`${MAX_ATTEMPTS} times`))
})

test('a record that does not make sense is ignored rather than acted on', () => {
  assert.equal(readTransaction(null), null)
  assert.equal(readTransaction({ step: 'install-started' }), null, 'no id')
  assert.equal(readTransaction({ ...transaction(), step: 'halfway' }), null, 'a step Orbis does not have')
  assert.equal(readTransaction({ ...transaction(), toVersion: 5 }), null)
  assert.equal(readTransaction({ ...transaction(), packagePath: undefined }), null)

  const read = readTransaction({ ...transaction(), attempts: -4 })
  assert.equal(read?.attempts, 0, 'an impossible count is brought back into range')
})

test('each step is written down before it is taken, and survives being read back', async () => {
  await withTemp(async (dir) => {
    const journal = new UpdateJournal(dir)
    assert.equal(await journal.read(), null)

    const started = await journal.begin({ id: 'u1', fromVersion: '1.0.0', toVersion: '1.1.0', packagePath: 'p.exe', rollbackPackagePath: 'old.exe' })
    assert.equal(started.step, 'update-started')
    assert.equal(started.attempts, 1)

    await journal.record('package-verified')
    await journal.record('install-started')
    const reopened = await new UpdateJournal(dir).read()
    assert.equal(reopened?.step, 'install-started', 'the record is on disk, not in memory')
    assert.equal(reopened?.toVersion, '1.1.0')

    await journal.clear()
    assert.equal(await journal.read(), null)
  })
})

test('trying the same update again counts the attempts, so a broken one cannot loop for ever', async () => {
  await withTemp(async (dir) => {
    const journal = new UpdateJournal(dir)
    const details = { id: 'u1', fromVersion: '1.0.0', toVersion: '1.1.0', packagePath: 'p.exe', rollbackPackagePath: null }
    assert.equal((await journal.begin(details)).attempts, 1)
    assert.equal((await journal.begin(details)).attempts, 2)
    const third = await journal.begin(details)
    assert.equal(third.attempts, 3)
    assert.equal(recoveryFor({ ...third, step: 'install-started' }).action, 'give-up')

    // A different release starts its own count rather than inheriting the failures of another.
    const other = await journal.begin({ ...details, toVersion: '1.2.0' })
    assert.equal(other.attempts, 1)
  })
})

test('a record damaged by a crash mid-write is ignored, and the update is not acted on half-way', async () => {
  await withTemp(async (dir) => {
    const journal = new UpdateJournal(dir)
    await journal.begin({ id: 'u1', fromVersion: '1.0.0', toVersion: '1.1.0', packagePath: 'p.exe', rollbackPackagePath: null })
    // What a half-written file looks like.
    await writeFile(join(dir, 'update-transaction.json'), '{"id":"u1","step":"install-star')
    assert.equal(await journal.read(), null)
    assert.deepEqual(recoveryFor(await journal.read()), { action: 'none' })
  })
})

test('writing goes through a temporary file, so a crash leaves the previous record rather than half of a new one', async () => {
  await withTemp(async (dir) => {
    const journal = new UpdateJournal(dir)
    await journal.begin({ id: 'u1', fromVersion: '1.0.0', toVersion: '1.1.0', packagePath: 'p.exe', rollbackPackagePath: null })
    await journal.record('staged')
    const onDisk = JSON.parse(await readFile(join(dir, 'update-transaction.json'), 'utf8'))
    assert.equal(onDisk.step, 'staged')
    // Nothing is left behind from the writing itself.
    await assert.rejects(() => readFile(join(dir, 'update-transaction.json.writing')))
  })
})

test('recording a step when no update is under way changes nothing', async () => {
  await withTemp(async (dir) => {
    const journal = new UpdateJournal(dir)
    assert.equal(await journal.record('install-started'), null)
    assert.equal(await journal.read(), null)
  })
})
