import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountSecurity } from '../accountSecurity.ts'
import { TabLockStore } from '../tabLockStore.ts'
import { TabLockWatcher } from '../tabLockWatcher.ts'
import { BrowserControl } from '../browserControl/registry.ts'
import { SWEEPING_CAPABILITIES, reconcile, tabIdFor } from './reconcile.ts'
import { DEFAULT_POLICY, POLICY_PRESETS, type TabLockPolicy } from '../../shared/tabLock.ts'

/**
 * Tab Lock, whole, against real files.
 *
 * Every piece has its own tests. This is the one that answers the question those cannot: put together the way `ipc.ts`
 * puts them together, does a locked tab actually stay shut? It uses the real credential store on a real temporary
 * directory, the real control layer with a real capability that reads a page, and the real watcher -- and then walks
 * through what somebody would actually do.
 *
 * Nothing here is a stand-in except the browser itself, which is a list of rows exactly as the extension reports them.
 */

const PROFILE = 'profile-1'
const ACCOUNT = 'correct horse battery staple'
const TAB_PASSWORD = 'quiet morning harbour light'

/** The whole feature, assembled the way the wiring assembles it. */
const build = async (): Promise<{
  dir: string
  accounts: AccountSecurity
  store: TabLockStore
  watcher: TabLockWatcher
  control: BrowserControl
  reads: () => number
  /** Reads the credentials and policies again, exactly as every one of the wiring's handlers does after a change. */
  refresh: () => Promise<void>
  read: (tabId?: number) => Promise<{ ok: boolean; code?: string }>
  list: () => Promise<unknown>
  setRows: (rows: { id: string; url: string; title: string; active: boolean }[]) => void
  changes: { tabId: number; locked: boolean }[]
  cleanUp: () => Promise<void>
}> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-tablock-'))
  const accounts = new AccountSecurity(dir)
  const store = new TabLockStore(dir, accounts)

  let rows: { id: string; url: string; title: string; active: boolean }[] = []
  let seen = new Map<number, string>()
  let reads = 0
  const changes: { tabId: number; locked: boolean }[] = []

  let groups: Map<string, TabLockPolicy> = new Map()
  let fallback: TabLockPolicy = DEFAULT_POLICY

  const watcher = new TabLockWatcher({
    config: () => ({ groups, rules: [], fallback }),
    isGroupOpen: (groupId) => store.isOpen(PROFILE, groupId),
    onChanged: (tabId, locked) => changes.push({ tabId, locked })
  })

  const refresh = async (): Promise<void> => {
    groups = new Map((await store.groups(PROFILE)).map((g) => [g.id, g.policy]))
    fallback = await store.defaultPolicy(PROFILE)
  }
  await refresh()

  const control = new BrowserControl()

  // A capability that really reads a page. What it returns is the thing that must never come back for a locked tab.
  control.register({
    id: 'page.read',
    domain: 'page',
    name: 'Read the page',
    description: 'The text of the page',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => {
      reads++
      return { text: 'Statement: balance £41,203.55, sort code 04-00-04' }
    }
  })

  const redactRows = <T extends { id: string; url: string; title: string }>(input: T[]): (T & { locked: boolean })[] =>
    input.map((row) => {
      const tabId = Number(row.id)
      if (!Number.isFinite(tabId) || !watcher.isLocked(tabId)) return { ...row, locked: false }
      const safe = watcher.describe({ tabId, url: row.url, title: row.title })
      return { ...row, url: '', title: safe.title, locked: true }
    })

  control.registerState('tabs', () => redactRows(rows))
  control.register({
    id: 'tabs.list',
    domain: 'tabs',
    name: 'List tabs',
    description: 'Every tab',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => redactRows(rows)
  })

  // Exactly the gate from `ipc.ts`.
  control.useLockedTabCheck((capability, params, target) => {
    if (SWEEPING_CAPABILITIES.has(capability)) return { locked: false }
    return watcher.wouldTouchLocked(tabIdFor(params, target))
  })

  const setRows = (next: typeof rows): void => {
    rows = next
    const change = reconcile(seen, next)
    seen = change.after
    for (const tabId of change.gone) watcher.forget(tabId)
    if (change.active !== null && change.active !== watcher.active()) watcher.activated(change.active)
  }

  return {
    dir,
    accounts,
    store,
    watcher,
    control,
    reads: () => reads,
    refresh,
    read: async (tabId) => {
      const result = await control.execute(
        { capability: 'page.read', params: {}, target: tabId === undefined ? {} : { tabId: String(tabId) } },
        { source: 'orion', confirm: async () => true }
      )
      return { ok: result.ok, code: result.error?.code }
    },
    list: async () => {
      const result = await control.execute(
        { capability: 'tabs.list', params: {}, target: {} },
        { source: 'orion', confirm: async () => true }
      )
      return result.data
    },
    setRows,
    changes,
    cleanUp: async () => {
      watcher.stop()
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  }
}

// ---------------------------------------------------------------- the whole thing, once through

test('a tab is protected, shut, opened with its password, and shut again', async () => {
  const w = await build()
  try {
    await w.accounts.create(PROFILE, ACCOUNT, 'Nishanth')
    const group = await w.store.createGroup(PROFILE, 'Banking', TAB_PASSWORD, POLICY_PRESETS.maximum)
    await w.refresh()
    assert.equal(group.recoverable, true, 'the account was open, so this one can be reset')

    w.setRows([
      { id: '1', url: 'https://news.example/', title: 'The news', active: false },
      { id: '2', url: 'https://bank.example/statement', title: 'Statement — £41,203.55', active: true }
    ])

    // Before anything is protected, reading works. This matters: if it did not, the rest would prove nothing.
    assert.equal((await w.read(2)).ok, true)
    const readsBefore = w.reads()

    w.watcher.protect(2, group.id)
    assert.equal(w.watcher.policyFor(2).tabSwitch, 0, 'this credential is on maximum, so leaving a tab locks it at once')

    // 1. Orion cannot read it, and the page was not read to find that out.
    const refused = await w.read(2)
    assert.equal(refused.ok, false)
    assert.equal(refused.code, 'tab-locked')
    assert.equal(w.reads(), readsBefore, 'the page was never read')

    // 2. The other tab is untouched. A lock on one tab is not a lock on the browser.
    assert.equal((await w.read(1)).ok, true)

    // 3. The listing still has both tabs, and gives away nothing about the locked one.
    const listed = JSON.stringify(await w.list())
    assert.ok(listed.includes('news.example'), 'the unlocked tab is still listed properly')
    for (const giveaway of ['bank.example', '41,203', 'Statement']) {
      assert.ok(!listed.includes(giveaway), `"${giveaway}" leaked into the tab list`)
    }

    // 4. The wrong password does not open it.
    await assert.rejects(() => w.store.unlockGroup(PROFILE, group.id, 'not the password'))
    assert.equal(w.watcher.isLocked(2), true)
    assert.equal((await w.read(2)).ok, false)

    // 5. The right one does.
    await w.store.unlockGroup(PROFILE, group.id, TAB_PASSWORD)
    w.watcher.markUnlocked(2)
    const allowed = await w.read(2)
    assert.equal(allowed.ok, true, 'once opened, it is an ordinary tab again')
    assert.ok(JSON.stringify(await w.list()).includes('bank.example'))

    // 6. And it shuts again by itself. This group is on "maximum", so looking at another tab is enough.
    w.setRows([
      { id: '1', url: 'https://news.example/', title: 'The news', active: true },
      { id: '2', url: 'https://bank.example/statement', title: 'Statement — £41,203.55', active: false }
    ])
    assert.equal(w.watcher.isLocked(2), true, 'switching away locked it')
    assert.equal((await w.read(2)).ok, false)
  } finally {
    await w.cleanUp()
  }
})

test('a command that names no tab is refused when the tab in front is the locked one', async () => {
  // The case that would otherwise be the hole: most capabilities act on whatever is in front, and name nothing.
  const w = await build()
  try {
    await w.accounts.create(PROFILE, ACCOUNT)
    const group = await w.store.createGroup(PROFILE, 'Banking', TAB_PASSWORD)
    await w.refresh()
    w.setRows([{ id: '2', url: 'https://bank.example/', title: 'Bank', active: true }])
    w.watcher.protect(2, group.id)

    const said = await w.read() // no tab named
    assert.equal(said.ok, false)
    assert.equal(said.code, 'tab-locked')
    assert.equal(w.reads(), 0)
  } finally {
    await w.cleanUp()
  }
})

test('closing the tab password shuts every tab it covers, with nothing walking the tab list', async () => {
  const w = await build()
  try {
    await w.accounts.create(PROFILE, ACCOUNT)
    const group = await w.store.createGroup(PROFILE, 'Banking', TAB_PASSWORD)
    await w.refresh()
    await w.store.unlockGroup(PROFILE, group.id, TAB_PASSWORD)
    w.setRows([
      { id: '2', url: 'https://bank.example/', title: 'Bank', active: true },
      { id: '3', url: 'https://broker.example/', title: 'Broker', active: false }
    ])
    w.watcher.protect(2, group.id, false)
    w.watcher.protect(3, group.id, false)
    assert.equal((await w.read(2)).ok, true)

    w.store.close(group.id)

    assert.equal((await w.read(2)).ok, false)
    assert.equal((await w.read(3)).ok, false)
  } finally {
    await w.cleanUp()
  }
})

test('a forgotten tab password is reset with the account password, and the tabs are still protected after', async () => {
  const w = await build()
  try {
    await w.accounts.create(PROFILE, ACCOUNT)
    const group = await w.store.createGroup(PROFILE, 'Banking', TAB_PASSWORD)
    await w.refresh()
    w.setRows([{ id: '2', url: 'https://bank.example/', title: 'Bank', active: true }])
    w.watcher.protect(2, group.id)

    // Forgotten. The account password is the way back, and it is the only one.
    await assert.rejects(() => w.store.resetGroupPassword(PROFILE, group.id, 'not the account password', 'a brand new tab phrase'))
    await w.store.resetGroupPassword(PROFILE, group.id, ACCOUNT, 'a brand new tab phrase')

    // The old one is gone, the new one works, and the tab did not quietly become unprotected along the way.
    await assert.rejects(() => w.store.unlockGroup(PROFILE, group.id, TAB_PASSWORD))
    assert.equal((await w.read(2)).ok, false)
    await w.store.unlockGroup(PROFILE, group.id, 'a brand new tab phrase')
    w.watcher.markUnlocked(2)
    assert.equal((await w.read(2)).ok, true)
  } finally {
    await w.cleanUp()
  }
})

test('the computer locking shuts everything protected, whatever was open', async () => {
  const w = await build()
  try {
    await w.accounts.create(PROFILE, ACCOUNT)
    const group = await w.store.createGroup(PROFILE, 'Banking', TAB_PASSWORD)
    await w.refresh()
    await w.store.unlockGroup(PROFILE, group.id, TAB_PASSWORD)
    w.setRows([{ id: '2', url: 'https://bank.example/', title: 'Bank', active: true }])
    w.watcher.protect(2, group.id, false)
    assert.equal((await w.read(2)).ok, true)

    assert.equal(w.watcher.systemLocked(), 1)
    assert.equal((await w.read(2)).ok, false)
  } finally {
    await w.cleanUp()
  }
})

test('nothing readable is written to disk: not a password, not a site, not a title', async () => {
  const w = await build()
  try {
    await w.accounts.create(PROFILE, ACCOUNT, 'Nishanth')
    const group = await w.store.createGroup(PROFILE, 'Banking', TAB_PASSWORD)
    await w.store.addRule(PROFILE, { pattern: 'bank.example', groupId: group.id, enabled: true })
    await w.store.rememberLockedOnClose(PROFILE, [{ groupId: group.id, url: 'https://bank.example/statement' }])

    const file = JSON.parse(await readFile(join(w.dir, 'profiles', PROFILE, 'tab-locks.json'), 'utf8').catch(async () => {
      // The store decides its own path per profile; find it rather than assuming one.
      const { readdir } = await import('node:fs/promises')
      const walk = async (dir: string): Promise<string | null> => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name)
          if (entry.isDirectory()) {
            const found = await walk(path)
            if (found) return found
          } else if (entry.name === 'tab-locks.json') return path
        }
        return null
      }
      const found = await walk(w.dir)
      assert.ok(found, 'the credential file was written somewhere')
      return readFile(found, 'utf8')
    }))

    /** Every string the file holds, values only -- the keys are the schema and are meant to be readable. */
    const values: string[] = []
    const walk = (value: unknown): void => {
      if (typeof value === 'string') values.push(value)
      else if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') Object.values(value).forEach(walk)
    }
    walk(file)
    const all = values.join(' ').toLowerCase()

    for (const secret of [TAB_PASSWORD, ACCOUNT, 'nishanth']) {
      assert.ok(!all.includes(secret.toLowerCase()), `"${secret}" is readable on disk`)
    }
    // A rule is a site the person typed in, so it is meant to be there. What must not be there is a page they visited:
    // the path of the locked tab appears nowhere, because what is kept is a keyed mark of it.
    assert.ok(!all.includes('statement'), 'the address of a locked tab was written down in the clear')
    assert.ok(!all.includes('bank.example/statement'), 'the full address of a locked tab is on disk')
    // And the record is genuinely there -- this is not passing because nothing was written.
    const remembered = await w.store.lockedOnClose(PROFILE)
    assert.equal(remembered.length, 1)
    assert.equal(
      (await w.store.recogniseLocked(PROFILE, ['https://bank.example/statement'])).get('https://bank.example/statement'),
      group.id,
      'and it can still be recognised from an address Orbis already has'
    )
  } finally {
    await w.cleanUp()
  }
})
