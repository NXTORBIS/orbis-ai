import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTabLockHandlers, type TabLockDeps } from './tabLock.ts'
import { HelperError } from './server.ts'

/**
 * What the browser's lock surface may ask Orbis.
 *
 * The surface is a page. It is treated as one: it names a tab and offers a password, and it is told only whether that
 * worked. These tests are about that boundary -- that a refusal carries a code and nothing of the credential, that a
 * message from further in is never repeated verbatim, and that what comes back says nothing about the page.
 */

const deps = (over: Partial<TabLockDeps> = {}): { d: TabLockDeps; calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    d: {
      surface: async (tabId) => {
        calls.push(`surface:${tabId}`)
        return { label: 'Locked Tab', recoverable: true, locked: true }
      },
      unlock: async (tabId, password) => {
        calls.push(`unlock:${tabId}`)
        if (password !== 'the right one') {
          throw Object.assign(new Error('wrong'), { code: 'wrong-password' })
        }
      },
      recover: async (tabId, account, next) => {
        calls.push(`recover:${tabId}`)
        if (account !== 'account password') {
          throw Object.assign(new Error('wrong'), { code: 'wrong-password' })
        }
        void next
      },
      lockActiveTab: async () => {
        calls.push('lockActiveTab')
        return { locked: true }
      },
      lockAll: async () => {
        calls.push('lockAll')
        return { locked: 3 }
      },
      lockProfile: async () => {
        calls.push('lockProfile')
      },
      ...over
    }
  }
}

const ctx = {} as Parameters<ReturnType<typeof createTabLockHandlers>[string]>[1]

const call = async (
  handlers: Record<string, (a: unknown[], c: typeof ctx) => unknown>,
  channel: string,
  args: unknown[]
): Promise<unknown> => handlers[channel](args, ctx)

const refusal = async (
  handlers: Record<string, (a: unknown[], c: typeof ctx) => unknown>,
  channel: string,
  args: unknown[]
): Promise<HelperError> => {
  try {
    await handlers[channel](args, ctx)
  } catch (err) {
    assert.ok(err instanceof HelperError, `threw something that is not a HelperError: ${String(err)}`)
    return err
  }
  throw new Error('it did not refuse')
}

// ---------------------------------------------------------------- what the surface is told

test('the surface is told a label and whether recovery is possible, and nothing else', async () => {
  const { d } = deps()
  const said = (await call(createTabLockHandlers(() => d), 'tabLock:surface', [7])) as Record<string, unknown>
  assert.deepEqual(said, { label: 'Locked Tab', recoverable: true, locked: true } as Record<string, unknown>)
  // No address, no title, no group name. The page that draws the lock screen is not told what it is hiding.
  for (const key of ['url', 'title', 'group', 'site', 'host']) {
    assert.equal(said[key], undefined, `it was told "${key}"`)
  }
})

test('recovery that is not possible is said so, rather than offered and then refused', async () => {
  const { d } = deps({ surface: async () => ({ label: 'Locked Tab', recoverable: false, locked: true }) })
  const said = (await call(createTabLockHandlers(() => d), 'tabLock:surface', [7])) as { recoverable: boolean }
  assert.equal(said.recoverable, false)
})

// ---------------------------------------------------------------- the password

test('the right password is accepted', async () => {
  const { d, calls } = deps()
  const said = await call(createTabLockHandlers(() => d), 'tabLock:unlock', [7, 'the right one'])
  assert.deepEqual(said, { ok: true })
  assert.deepEqual(calls, ['unlock:7'])
})

test('the wrong one is refused with a code the page can act on', async () => {
  const { d } = deps()
  const err = await refusal(createTabLockHandlers(() => d), 'tabLock:unlock', [7, 'guessing'])
  assert.equal(err.code, 'wrong-password')
  assert.match(err.message, /not the password for this tab/i)
})

test('a cooldown is reported as one, so the page can say how long to wait', async () => {
  const { d } = deps({
    unlock: async () => {
      throw Object.assign(new Error('wait'), { code: 'cooling-down', waitMs: 30_000 })
    }
  })
  const err = await refusal(createTabLockHandlers(() => d), 'tabLock:unlock', [7, 'guessing'])
  assert.equal(err.code, 'cooling-down')
})

test('an unrecognised failure is not repeated verbatim', async () => {
  // A message from further in could hold a value -- a path, a name, part of something typed. What comes back is a
  // sentence this file wrote.
  const { d } = deps({
    unlock: async () => {
      throw new Error('scrypt failed on key material a1b2c3 for user Nishanth')
    }
  })
  const err = await refusal(createTabLockHandlers(() => d), 'tabLock:unlock', [7, 'x'])
  assert.equal(err.code, 'failed')
  assert.ok(!err.message.includes('a1b2c3'))
  assert.ok(!err.message.includes('Nishanth'))
  assert.ok(!err.message.includes('scrypt'))
})

// ---------------------------------------------------------------- recovery

test('the account password authorises a new tab password', async () => {
  const { d, calls } = deps()
  const said = await call(createTabLockHandlers(() => d), 'tabLock:recover', [7, 'account password', 'a new long phrase'])
  assert.deepEqual(said, { ok: true })
  assert.deepEqual(calls, ['recover:7'])
})

test('the wrong account password does not authorise anything', async () => {
  const { d, calls } = deps()
  const err = await refusal(createTabLockHandlers(() => d), 'tabLock:recover', [7, 'guessing', 'a new long phrase'])
  assert.equal(err.code, 'wrong-password')
  assert.deepEqual(calls, ['recover:7'])
})

test('nothing here ever answers with the old password', async () => {
  const { d } = deps()
  const said = JSON.stringify(
    await call(createTabLockHandlers(() => d), 'tabLock:recover', [7, 'account password', 'a new long phrase'])
  )
  assert.equal(said, '{"ok":true}')
})

// ---------------------------------------------------------------- what is refused before it reaches the store

test('a tab id that is not one is refused before any key derivation happens', async () => {
  const { d, calls } = deps()
  const handlers = createTabLockHandlers(() => d)
  for (const nonsense of [undefined, null, '', 'abc', 0, -1, 1.5, {}, []]) {
    const err = await refusal(handlers, 'tabLock:unlock', [nonsense, 'the right one'])
    assert.equal(err.code, 'bad-request', `${JSON.stringify(nonsense)} was accepted`)
  }
  assert.deepEqual(calls, [], 'nothing reached the store')
})

test('an empty password is refused, and an enormous one never reaches the key derivation', async () => {
  const { d, calls } = deps()
  const handlers = createTabLockHandlers(() => d)
  assert.equal((await refusal(handlers, 'tabLock:unlock', [7, ''])).code, 'bad-request')
  assert.equal((await refusal(handlers, 'tabLock:unlock', [7, 'x'.repeat(300)])).code, 'bad-request')
  assert.equal((await refusal(handlers, 'tabLock:unlock', [7, 42])).code, 'bad-request')
  assert.deepEqual(calls, [])
})

test('with Orbis not ready, the surface is told to try again rather than told nothing is locked', async () => {
  // The difference matters: "cannot ask" must never read as "there is nothing to unlock".
  const handlers = createTabLockHandlers(() => null)
  assert.equal((await refusal(handlers, 'tabLock:surface', [7])).code, 'unavailable')
  assert.equal((await refusal(handlers, 'tabLock:unlock', [7, 'x'.repeat(20)])).code, 'unavailable')
})

// ---------------------------------------------------------------- the locking commands

test('the three locking commands take no arguments at all', async () => {
  // "This tab" and "everything" are things Orbis already knows. Letting a page name a tab here would let it lock one it
  // had no business knowing about.
  const { d, calls } = deps()
  const handlers = createTabLockHandlers(() => d)
  assert.deepEqual(await call(handlers, 'security:lockTab', [99, 'ignored']), { locked: true })
  assert.deepEqual(await call(handlers, 'security:lockAll', []), { locked: 3 })
  assert.deepEqual(await call(handlers, 'security:lockProfile', []), { ok: true })
  assert.deepEqual(calls, ['lockActiveTab', 'lockAll', 'lockProfile'])
})

test('a tab with no tab password says so rather than being protected on somebody’s behalf', async () => {
  const { d } = deps({
    lockActiveTab: async () => ({ locked: false, reason: 'This tab has no tab password yet.' })
  })
  const said = (await call(createTabLockHandlers(() => d), 'security:lockTab', [])) as { locked: boolean }
  assert.equal(said.locked, false)
})

test('there is no channel here that unlocks anything', () => {
  const { d } = deps()
  const channels = Object.keys(createTabLockHandlers(() => d))
  const opening = channels.filter((c) => /unlock|open|reveal/i.test(c))
  // `tabLock:unlock` is the one, and it is the person typing their own password into the lock screen.
  assert.deepEqual(opening, ['tabLock:unlock'])
  assert.ok(!channels.includes('security:unlockAll'))
  assert.ok(!channels.includes('security:unlockProfile'))
})
