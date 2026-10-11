import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecurityLog } from './securityLog.ts'
import { dataDirFor } from '../shared/profiles.ts'
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

// ================================================================ a log that was not understood

/** Where a profile's log lives, without having to go looking for it. */
const logFile = (dir: string, profileId = 'default'): string => join(dir, dataDirFor(profileId), 'security-log.json')

/** The names of anything quarantined beside the log, newest first. */
const movedAside = async (dir: string): Promise<string[]> =>
  (await readdir(join(dir, dataDirFor('default'))))
    .filter((name) => name.startsWith('security-log.json.unreadable-'))
    .sort()
    .reverse()

/** Whether a half-finished write was left behind. Nothing removes it, so its absence means no write was attempted. */
const triedToWrite = async (dir: string): Promise<boolean> =>
  (await readdir(join(dir, dataDirFor('default')))).includes('security-log.json.tmp')

test('a truncated log is kept, not read as "nothing happened"', async () => {
  const w = await bench()
  try {
    w.log.record('default', { kind: 'FAILED_ACCOUNT_UNLOCK', at: 1_700_000_000_000 })
    w.log.record('default', { kind: 'TAB_PASSWORD_RESET', password: 'Banking', at: 1_700_000_001_000 })
    await w.log.flush()
    // What a write interrupted by a power cut leaves behind: readable, nearly all there, and not JSON.
    const whole = await readFile(logFile(w.dir), 'utf8')
    const cut = whole.slice(0, whole.length - 10)
    await writeFile(logFile(w.dir), cut)

    // Orbis starts again and logs one thing of its own.
    const after = new SecurityLog(w.dir)
    after.record('default', { kind: 'ACCOUNT_UNLOCKED' })
    await after.flush()
    after.stop()

    // What is shown is only this session, because the rest cannot be made sense of...
    assert.deepEqual((await after.all('default')).map((e) => e.kind), ['ACCOUNT_UNLOCKED'])

    // ...but the attempts somebody needed to see are still on the disk, byte for byte, under their own name. This is
    // the whole point: before, those two events were silently replaced by the single one above, and the short list
    // read as the complete record.
    const kept = await movedAside(w.dir)
    assert.equal(kept.length, 1, 'the damaged log was moved aside, not overwritten')
    const bytes = await readFile(join(w.dir, dataDirFor('default'), kept[0]), 'utf8')
    assert.equal(bytes, cut, 'byte for byte what was there')
    assert.match(bytes, /FAILED_ACCOUNT_UNLOCK/, 'including the wrong password nobody would otherwise know about')
    assert.match(bytes, /Banking/)

    // And once it is safely aside the log really does start again, so this is not passing because nothing was written.
    assert.match(await readFile(logFile(w.dir), 'utf8'), /ACCOUNT_UNLOCKED/)
  } finally {
    await w.cleanUp()
  }
})

test('a log in a shape this Orbis does not know is kept too, rather than treated as absent', async () => {
  const w = await bench()
  try {
    // What a newer Orbis might leave: good JSON, and not a list of events this one has ever heard of. Treating it as
    // "no log yet" is the same loss as a truncated file, so it takes the same path.
    const newer = '{"version":2,"events":[{"kind":"SCREEN_RECORDED","at":1700000000000}]}'
    await writeFile(logFile(w.dir), newer)

    w.log.record('default', { kind: 'TAB_LOCKED' })
    await w.log.flush()

    const kept = await movedAside(w.dir)
    assert.equal(kept.length, 1, 'kept rather than replaced')
    assert.equal(await readFile(join(w.dir, dataDirFor('default'), kept[0]), 'utf8'), newer)
    assert.match(await readFile(logFile(w.dir), 'utf8'), /TAB_LOCKED/, 'and this Orbis carried on')
  } finally {
    await w.cleanUp()
  }
})

test('a list of events none of which are events is damage, not an empty log', async () => {
  const w = await bench()
  try {
    const foreign = '[{"event":"locked","when":"yesterday"}]'
    await writeFile(logFile(w.dir), foreign)
    w.log.record('default', { kind: 'PANIC_LOCK' })
    await w.log.flush()
    const kept = await movedAside(w.dir)
    assert.equal(kept.length, 1)
    assert.equal(await readFile(join(w.dir, dataDirFor('default'), kept[0]), 'utf8'), foreign)
  } finally {
    await w.cleanUp()
  }
})

test('a log that could not be read is not written over, not even by the flush after', async () => {
  const w = await bench()
  try {
    // A directory where the log is expected cannot be read, and the reason is not "there is no log". It stands in for
    // the real case -- a backup tool holding the file open -- which cannot be made to happen reliably in a test.
    await mkdir(logFile(w.dir))

    w.log.record('default', { kind: 'TAB_LOCKED' })
    await w.log.flush()
    // The refusal used to be dropped by the very flush that obeyed it, and nothing put it back, so the next flush
    // wrote the short list anyway. One and a half seconds of protection.
    w.log.record('default', { kind: 'PANIC_LOCK' })
    await w.log.flush()

    assert.equal((await stat(logFile(w.dir))).isDirectory(), true, 'it was left exactly as it is')
    assert.equal(await triedToWrite(w.dir), false, 'and no write was attempted at all')
    assert.equal((await movedAside(w.dir)).length, 0, 'nor moved aside, because it may be perfectly good')
  } finally {
    await w.cleanUp()
  }
})

test('clearing a log that could not be read does not then allow it to be written over', async () => {
  const w = await bench()
  try {
    await mkdir(logFile(w.dir))
    // Clearing removes the file. This one resists being removed, so it is still there and still not understood, and
    // forgetting that is how the next flush would write over it.
    await w.log.clear('default')
    w.log.record('default', { kind: 'TAB_LOCKED' })
    await w.log.flush()
    w.log.record('default', { kind: 'PANIC_LOCK' })
    await w.log.flush()
    assert.equal((await stat(logFile(w.dir))).isDirectory(), true)
    assert.equal(await triedToWrite(w.dir), false)
  } finally {
    await w.cleanUp()
  }
})

test('no log yet is still no log yet: nothing to show, and a write is allowed', async () => {
  const w = await bench()
  try {
    assert.deepEqual(await w.log.all('default'), [])
    assert.equal((await movedAside(w.dir)).length, 0, 'nothing was moved aside, because nothing was there')
    w.log.record('default', { kind: 'ACCOUNT_CREATED' })
    await w.log.flush()
    assert.match(await readFile(logFile(w.dir), 'utf8'), /ACCOUNT_CREATED/, 'the write was allowed')
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
