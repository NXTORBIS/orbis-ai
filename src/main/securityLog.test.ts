import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecurityLog } from './securityLog.ts'
import { MAX_SECURITY_EVENTS } from '../shared/securityEvents.ts'

/**
 * The security log, against real files.
 *
 * Two things matter here beyond "it records what happened": that nothing forbidden reaches the disk, and that recording
 * something never makes the thing being recorded wait. The second is why `record` returns nothing and takes no await.
 */

const bench = async (): Promise<{ log: SecurityLog; dir: string; cleanUp: () => Promise<void> }> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-seclog-'))
  const log = new SecurityLog(dir)
  return {
    log,
    dir,
    cleanUp: async () => {
      log.stop()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

/** Where the log for a profile ended up, whatever the store decided to call the folder. */
const find = async (dir: string): Promise<string> => {
  const { readdir } = await import('node:fs/promises')
  const walk = async (at: string): Promise<string | null> => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) {
        const found = await walk(path)
        if (found) return found
      } else if (entry.name === 'security-log.json') {
        return path
      }
    }
    return null
  }
  const found = await walk(dir)
  assert.ok(found, 'no log was written')
  return found
}

test('an event is recorded and read back', async () => {
  const w = await bench()
  try {
    w.log.record('default', { kind: 'TAB_LOCKED', tabId: 4, password: 'Banking' })
    await w.log.flush()
    const events = await w.log.all('default')
    assert.equal(events.length, 1)
    assert.equal(events[0].kind, 'TAB_LOCKED')
    assert.equal(events[0].tabId, 4)
    assert.ok(events[0].at > 0, 'it was stamped')
  } finally {
    await w.cleanUp()
  }
})

test('nothing forbidden reaches the disk, even when it is offered', async () => {
  const w = await bench()
  try {
    w.log.record('default', {
      kind: 'TAB_UNLOCKED',
      tabId: 4,
      password: 'Banking',
      url: 'https://bank.example/statement',
      title: 'Current account — £41,203.55',
      plaintext: 'correct horse battery staple'
    })
    await w.log.flush()
    const written = await readFile(await find(w.dir), 'utf8')
    for (const giveaway of ['bank.example', '41,203', 'correct horse', 'Current account', 'statement']) {
      assert.ok(!written.includes(giveaway), `"${giveaway}" is on disk`)
    }
    // And the parts that are allowed really are there, so this is not passing because nothing was written.
    assert.ok(written.includes('TAB_UNLOCKED'))
    assert.ok(written.includes('Banking'))
  } finally {
    await w.cleanUp()
  }
})

test('an event that is not one is not recorded', async () => {
  const w = await bench()
  try {
    w.log.record('default', { kind: 'DEFINITELY_NOT_A_KIND' })
    w.log.record('default', null)
    w.log.record('default', 'TAB_LOCKED')
    await w.log.flush()
    assert.deepEqual(await w.log.all('default'), [])
  } finally {
    await w.cleanUp()
  }
})

test('an event with no profile goes nowhere rather than into a shared file', async () => {
  const w = await bench()
  try {
    w.log.record('', { kind: 'TAB_LOCKED' })
    await w.log.flush()
    assert.deepEqual(await w.log.all('default'), [])
  } finally {
    await w.cleanUp()
  }
})

test('newest first, so the interesting end is the top', async () => {
  const w = await bench()
  try {
    for (const kind of ['TAB_LOCKED', 'TAB_UNLOCKED', 'PANIC_LOCK'] as const) {
      w.log.record('default', { kind })
      // A real clock, so the order comes from when they happened rather than from the order they were added.
      await new Promise((r) => setTimeout(r, 2))
    }
    await w.log.flush()
    assert.deepEqual(
      (await w.log.all('default')).map((e) => e.kind),
      ['PANIC_LOCK', 'TAB_UNLOCKED', 'TAB_LOCKED']
    )
  } finally {
    await w.cleanUp()
  }
})

test('the log survives a restart', async () => {
  const w = await bench()
  try {
    w.log.record('default', { kind: 'TAB_PASSWORD_CREATED', password: 'Banking' })
    await w.log.flush()

    const after = new SecurityLog(w.dir)
    const events = await after.all('default')
    assert.equal(events.length, 1)
    assert.equal(events[0].password, 'Banking')
    after.stop()
  } finally {
    await w.cleanUp()
  }
})

test('one profile’s log is not another’s', async () => {
  const w = await bench()
  try {
    w.log.record('one', { kind: 'TAB_LOCKED', password: 'Personal' })
    w.log.record('two', { kind: 'PANIC_LOCK' })
    await w.log.flush()
    assert.deepEqual((await w.log.all('one')).map((e) => e.kind), ['TAB_LOCKED'])
    assert.deepEqual((await w.log.all('two')).map((e) => e.kind), ['PANIC_LOCK'])
    assert.ok(!JSON.stringify(await w.log.all('two')).includes('Personal'))
  } finally {
    await w.cleanUp()
  }
})

test('it stops growing, and the oldest are what go', async () => {
  const w = await bench()
  try {
    for (let i = 0; i < MAX_SECURITY_EVENTS + 40; i++) {
      w.log.record('default', { kind: 'TAB_LOCKED', at: 1_000_000 + i, tabId: i })
    }
    await w.log.flush()
    const events = await w.log.all('default')
    assert.equal(events.length, MAX_SECURITY_EVENTS)
    assert.equal(events[0].tabId, MAX_SECURITY_EVENTS + 39, 'the newest is first')
    assert.ok(
      events.every((e) => (e.tabId ?? 0) >= 40),
      'the oldest were the ones dropped'
    )
  } finally {
    await w.cleanUp()
  }
})

test('clearing leaves nothing to read, not an empty list in a file', async () => {
  const w = await bench()
  try {
    w.log.record('default', { kind: 'TAB_LOCKED', password: 'Banking' })
    await w.log.flush()
    const path = await find(w.dir)

    await w.log.clear('default')
    assert.deepEqual(await w.log.all('default'), [])
    await assert.rejects(() => readFile(path, 'utf8'), 'the file is still there')
  } finally {
    await w.cleanUp()
  }
})

test('recording does not make the caller wait', () => {
  // `record` returns nothing at all. Nothing about locking a tab should wait for a log, and a signature that cannot be
  // awaited is the way to be sure of that.
  const log = new SecurityLog(tmpdir())
  const returned = log.record('default', { kind: 'TAB_LOCKED' })
  assert.equal(returned, undefined)
  log.stop()
})
