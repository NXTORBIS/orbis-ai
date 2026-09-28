import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountSecurity } from './accountSecurity.ts'
import { TabLockFailure, TabLockStore, cooldownFor } from './tabLockStore.ts'
import { dataDirFor } from '../shared/profiles.ts'

const ACCOUNT = 'quiet harbour lamp'
const TAB = 'lantern gravel window'
const OTHER = 'seven red bicycles ride'

/** scrypt is deliberately slow, and these tests use the real thing. */
const SLOW = { timeout: 180_000 }

interface Bench {
  dir: string
  accounts: AccountSecurity
  locks: TabLockStore
}

const bench = async (withAccount = true): Promise<Bench> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-tablock-'))
  const accounts = new AccountSecurity(dir)
  const locks = new TabLockStore(dir, accounts)
  if (withAccount) await accounts.create('default', ACCOUNT, 'Nishanth')
  return { dir, accounts, locks }
}

const lockFile = (dir: string): string => join(dir, dataDirFor('default'), 'tab-locks.json')

// ================================================================ making a credential

test('a tab password can be made, and its tabs are then open', SLOW, async () => {
  const { locks } = await bench()
  const group = await locks.createGroup('default', 'Personal', TAB)
  assert.equal(group.name, 'Personal')
  assert.equal(group.open, true, 'they just chose it and typed it twice')
  assert.equal(group.recoverable, true, 'the account was open, so the account password can reset it')
  assert.equal(locks.isOpen('default', group.id), true)
})

test('a weak tab password is refused', SLOW, async () => {
  const { locks } = await bench()
  await assert.rejects(
    () => locks.createGroup('default', 'Personal', 'password1234'),
    (err: TabLockFailure) => err.code === 'weak-password'
  )
  assert.deepEqual(await locks.groups('default'), [], 'and nothing was written')
})

test('two credentials cannot share a name', SLOW, async () => {
  const { locks } = await bench()
  await locks.createGroup('default', 'Personal', TAB)
  await assert.rejects(
    () => locks.createGroup('default', 'personal', OTHER),
    (err: TabLockFailure) => err.code === 'already-exists'
  )
})

test('a credential needs a name', SLOW, async () => {
  const { locks } = await bench()
  await assert.rejects(() => locks.createGroup('default', '   ', TAB), (err: TabLockFailure) => err.code === 'bad-input')
})

// ================================================================ the two passwords are different things

test('the account password does not open a locked tab', SLOW, async () => {
  const { locks } = await bench()
  const group = await locks.createGroup('default', 'Personal', TAB)
  locks.closeAll()

  // The whole point of having two. Knowing the account password is not knowing the tab password.
  await assert.rejects(
    () => locks.unlockGroup('default', group.id, ACCOUNT),
    (err: TabLockFailure) => err.code === 'wrong-password'
  )
  assert.equal(locks.isOpen('default', group.id), false)

  await locks.unlockGroup('default', group.id, TAB)
  assert.equal(locks.isOpen('default', group.id), true)
})

test('the tab password does not open the account', SLOW, async () => {
  const { locks, accounts } = await bench()
  await locks.createGroup('default', 'Personal', TAB)
  accounts.lock()
  assert.equal(await accounts.verify('default', TAB), false)
  assert.equal(await accounts.verify('default', ACCOUNT), true)
})

// ================================================================ nothing in plaintext

test('neither password is anywhere in what is written to disk', SLOW, async () => {
  const { locks, dir } = await bench()
  await locks.createGroup('default', 'Personal', TAB)
  const written = await readFile(lockFile(dir), 'utf8')

  // Checked against the *values*, not the raw text: a field name like `windowBlur` contains "window", and a test that
  // cannot tell a key from a value fails for the wrong reason and teaches nothing.
  const values: string[] = []
  const walk = (node: unknown): void => {
    if (typeof node === 'string') values.push(node.toLowerCase())
    else if (Array.isArray(node)) node.forEach(walk)
    else if (node && typeof node === 'object') Object.values(node).forEach(walk)
  }
  walk(JSON.parse(written))
  const everything = values.join(' ')

  for (const secret of [TAB, ACCOUNT]) {
    assert.ok(!written.includes(secret), `the password "${secret}" is on disk`)
    for (const word of secret.split(' ')) {
      assert.ok(!everything.includes(word), `the word "${word}" appears in a stored value`)
    }
  }
  // What is there: a name the person chose, a policy, and two wrapped keys.
  const file = JSON.parse(written)
  assert.equal(file.groups.length, 1)
  assert.ok(file.groups[0].password.salt && file.groups[0].password.data)
  assert.ok(file.groups[0].recovery.salt && file.groups[0].recovery.data)
  assert.notEqual(file.groups[0].password.salt, file.groups[0].recovery.salt, 'separately salted')
})

// ================================================================ opening

test('the right password opens it, the wrong one does not, and a restart does not inherit being open', SLOW, async () => {
  const { locks, dir, accounts } = await bench()
  const group = await locks.createGroup('default', 'Personal', TAB)

  const afterRestart = new TabLockStore(dir, new AccountSecurity(dir))
  assert.equal(afterRestart.isOpen('default', group.id), false, 'a restart locks everything again')

  await assert.rejects(
    () => afterRestart.unlockGroup('default', group.id, OTHER),
    (err: TabLockFailure) => err.code === 'wrong-password'
  )
  await afterRestart.unlockGroup('default', group.id, TAB)
  assert.equal(afterRestart.isOpen('default', group.id), true)
  void accounts
})

test('closing one credential does not close another', SLOW, async () => {
  const { locks } = await bench()
  const one = await locks.createGroup('default', 'Personal', TAB)
  const two = await locks.createGroup('default', 'Work', OTHER)
  locks.close(one.id)
  assert.equal(locks.isOpen('default', one.id), false)
  assert.equal(locks.isOpen('default', two.id), true)
})

test('guessing a tab password is made slow, and never permanently locks the tabs out', SLOW, async () => {
  const { locks } = await bench()
  const group = await locks.createGroup('default', 'Personal', TAB)
  locks.closeAll()

  const at = 5_000_000
  for (let i = 0; i < 4; i++) {
    await assert.rejects(
      () => locks.unlockGroup('default', group.id, OTHER, at + i),
      (err: TabLockFailure) => err.code === 'wrong-password'
    )
  }
  await assert.rejects(
    () => locks.unlockGroup('default', group.id, TAB, at + 4),
    (err: TabLockFailure) => err.code === 'cooling-down' && err.waitMs > 0
  )
  await locks.unlockGroup('default', group.id, TAB, at + 4 + cooldownFor(4) + 1)
  assert.equal(locks.isOpen('default', group.id), true)
})

test('a failed guess at one credential does not cool down another', SLOW, async () => {
  const { locks } = await bench()
  const one = await locks.createGroup('default', 'Personal', TAB)
  const two = await locks.createGroup('default', 'Work', OTHER)
  locks.closeAll()
  for (let i = 0; i < 5; i++) {
    await locks.unlockGroup('default', one.id, 'wrong wrong wrong', 1000 + i).catch(() => undefined)
  }
  // The other one is untouched.
  await locks.unlockGroup('default', two.id, OTHER, 1010)
  assert.equal(locks.isOpen('default', two.id), true)
})

// ================================================================ changing

test('changing a tab password keeps the same key, so no tab is disturbed', SLOW, async () => {
  const { locks } = await bench()
  const group = await locks.createGroup('default', 'Personal', TAB)
  await locks.changeGroupPassword('default', group.id, TAB, OTHER)

  locks.closeAll()
  await assert.rejects(
    () => locks.unlockGroup('default', group.id, TAB),
    (err: TabLockFailure) => err.code === 'wrong-password'
  )
  await locks.unlockGroup('default', group.id, OTHER)
  // And recovery still works afterwards, which is what proves the key was kept rather than replaced.
  const summary = (await locks.groups('default'))[0]
  assert.equal(summary.recoverable, true)
})

test('the current tab password is required to change it', SLOW, async () => {
  const { locks } = await bench()
  const group = await locks.createGroup('default', 'Personal', TAB)
  await assert.rejects(
    () => locks.changeGroupPassword('default', group.id, OTHER, 'a different phrase here'),
    (err: TabLockFailure) => err.code === 'wrong-password'
  )
  locks.closeAll()
  await locks.unlockGroup('default', group.id, TAB)
})

// ================================================================ forgetting it

test('the account password authorises a new tab password without revealing the old one', SLOW, async () => {
  const { locks } = await bench()
  const group = await locks.createGroup('default', 'Personal', TAB)
  locks.closeAll()

  await locks.resetGroupPassword('default', group.id, ACCOUNT, OTHER)

  // The new one works.
  locks.closeAll()
  await locks.unlockGroup('default', group.id, OTHER)
  assert.equal(locks.isOpen('default', group.id), true)

  // The old one does not. Nothing anywhere said what it was.
  locks.closeAll()
  await assert.rejects(
    () => locks.unlockGroup('default', group.id, TAB),
    (err: TabLockFailure) => err.code === 'wrong-password'
  )
})

test('the wrong account password does not authorise a reset', SLOW, async () => {
  const { locks } = await bench()
  const group = await locks.createGroup('default', 'Personal', TAB)
  await assert.rejects(
    () => locks.resetGroupPassword('default', group.id, 'not the account password', OTHER),
    (err: TabLockFailure) => err.code === 'wrong-password'
  )
  // And the original tab password still works, so the failed attempt changed nothing.
  locks.closeAll()
  await locks.unlockGroup('default', group.id, TAB)
})

test('a credential made without an open account says it cannot be recovered, rather than pretending', SLOW, async () => {
  // No account password at all: locking a tab must still work, but recovery genuinely cannot.
  const { locks } = await bench(false)
  const group = await locks.createGroup('default', 'Personal', TAB)
  assert.equal(group.recoverable, false)

  await assert.rejects(
    () => locks.resetGroupPassword('default', group.id, ACCOUNT, OTHER),
    (err: TabLockFailure) => err.code === 'no-recovery'
  )
  // And the tabs are still protected by the password that does exist.
  locks.closeAll()
  await locks.unlockGroup('default', group.id, TAB)
})

test('a credential gains recovery the first time its password is changed with the account open', SLOW, async () => {
  const { locks, accounts } = await bench(false)
  const group = await locks.createGroup('default', 'Personal', TAB)
  assert.equal(group.recoverable, false)

  // The person later sets an account password, then changes the tab password.
  await accounts.create('default', ACCOUNT, 'Nishanth')
  await locks.changeGroupPassword('default', group.id, TAB, OTHER)
  assert.equal((await locks.groups('default'))[0].recoverable, true)

  // And recovery now genuinely works.
  locks.closeAll()
  await locks.resetGroupPassword('default', group.id, ACCOUNT, 'another good phrase here')
  locks.closeAll()
  await locks.unlockGroup('default', group.id, 'another good phrase here')
})

test('a weak replacement is refused, by both routes', SLOW, async () => {
  const { locks } = await bench()
  const group = await locks.createGroup('default', 'Personal', TAB)
  await assert.rejects(
    () => locks.changeGroupPassword('default', group.id, TAB, 'qwerty'),
    (err: TabLockFailure) => err.code === 'weak-password'
  )
  await assert.rejects(
    () => locks.resetGroupPassword('default', group.id, ACCOUNT, 'qwerty'),
    (err: TabLockFailure) => err.code === 'weak-password'
  )
})

// ================================================================ removing

test('removing a credential needs its password, and takes its rules with it', SLOW, async () => {
  const { locks } = await bench()
  const group = await locks.createGroup('default', 'Personal', TAB)
  await locks.addRule('default', { pattern: 'bank.example', groupId: group.id })
  assert.equal((await locks.rules('default')).length, 1)

  // Removing it unprotects every tab it covered, so it costs what unlocking costs.
  await assert.rejects(
    () => locks.removeGroup('default', group.id, OTHER),
    (err: TabLockFailure) => err.code === 'wrong-password'
  )
  await locks.removeGroup('default', group.id, TAB)
  assert.deepEqual(await locks.groups('default'), [])
  assert.deepEqual(await locks.rules('default'), [], 'a rule pointing at nothing is not left behind')
  assert.equal(locks.isOpen('default', group.id), false)
})

// ================================================================ rules

test('a rule must name a site Orbis can match and a credential that exists', SLOW, async () => {
  const { locks } = await bench()
  const group = await locks.createGroup('default', 'Personal', TAB)

  await assert.rejects(
    () => locks.addRule('default', { pattern: 'not a host', groupId: group.id }),
    (err: TabLockFailure) => err.code === 'bad-input'
  )
  await assert.rejects(
    () => locks.addRule('default', { pattern: 'bank.example', groupId: 'nothing' }),
    (err: TabLockFailure) => err.code === 'no-group'
  )
  const rules = await locks.addRule('default', { pattern: 'https://Bank.Example/', groupId: group.id })
  assert.equal(rules[0].pattern, 'bank.example', 'and it is tidied on the way in')
})

test('rules can be removed and replaced wholesale, and never point at a missing credential', SLOW, async () => {
  const { locks } = await bench()
  const group = await locks.createGroup('default', 'Personal', TAB)
  const added = await locks.addRule('default', { pattern: 'bank.example', groupId: group.id })
  assert.equal((await locks.removeRule('default', added[0].id)).length, 0)

  const set = await locks.setRules('default', [
    { id: 'a', pattern: 'one.example', groupId: group.id },
    { id: 'b', pattern: 'two.example', groupId: 'a credential that does not exist' }
  ])
  assert.equal(set.length, 1, 'the one pointing at nothing was dropped')
  assert.equal(set[0].pattern, 'one.example')
})

// ================================================================ surviving a restart

test('what was locked when Orbis closed is recognised again, without the address being written down', SLOW, async () => {
  const { locks, dir } = await bench()
  const group = await locks.createGroup('default', 'Personal', TAB)
  await locks.rememberLockedOnClose('default', [
    { groupId: group.id, url: 'https://bank.example/account' },
    { groupId: 'nothing', url: 'https://other.example/' }
  ])

  const afterRestart = new TabLockStore(dir, new AccountSecurity(dir))
  const remembered = await afterRestart.lockedOnClose('default')
  assert.equal(remembered.length, 1, 'only tabs whose credential still exists')
  // A mark, not an address. The mark is the whole point: the file must not be a readable list of what somebody had open.
  assert.ok(!JSON.stringify(remembered).includes('bank.example'))

  // And it still recognises the address when it is handed one.
  const found = await afterRestart.recogniseLocked('default', [
    'https://bank.example/account',
    'https://news.example/'
  ])
  assert.equal(found.get('https://bank.example/account'), group.id)
  assert.equal(found.has('https://news.example/'), false)
  // Not even nearly: one character different is a different mark.
  assert.equal((await afterRestart.recogniseLocked('default', ['https://bank.example/accounts'])).size, 0)

  await afterRestart.forgetLockedOnClose('default')
  assert.deepEqual(await afterRestart.lockedOnClose('default'), [])
  assert.equal((await afterRestart.recogniseLocked('default', ['https://bank.example/account'])).size, 0)
})

test('the mark is keyed per profile, so the same address marks differently in two of them', SLOW, async () => {
  // Otherwise the marks would be comparable across profiles, and comparing them would say "these two identities visited
  // the same private page" -- which is exactly the kind of thing separate profiles exist to prevent.
  const { locks } = await bench()
  const one = await locks.createGroup('default', 'Personal', TAB)
  const two = await locks.createGroup('second', 'Personal', TAB)
  await locks.rememberLockedOnClose('default', [{ groupId: one.id, url: 'https://bank.example/account' }])
  await locks.rememberLockedOnClose('second', [{ groupId: two.id, url: 'https://bank.example/account' }])
  const a = await locks.lockedOnClose('default')
  const b = await locks.lockedOnClose('second')
  assert.notEqual(a[0].mark, b[0].mark)
})

// ================================================================ policies

test('a profile default and a per-credential policy are both kept', SLOW, async () => {
  const { locks } = await bench()
  await locks.setDefaultPolicy('default', { inactivity: 60_000, tabSwitch: 0 })
  const fallback = await locks.defaultPolicy('default')
  assert.equal(fallback.inactivity, 60_000)
  assert.equal(fallback.tabSwitch, 0)

  // A new credential starts from the profile default...
  const group = await locks.createGroup('default', 'Personal', TAB)
  assert.equal(group.policy.inactivity, 60_000)

  // ...and can then differ from it.
  const next = await locks.setGroupPolicy('default', group.id, { inactivity: 5_000 })
  assert.equal(next.inactivity, 5_000)
  assert.equal(next.tabSwitch, 0, 'and keeps the rest')
  assert.equal((await locks.defaultPolicy('default')).inactivity, 60_000, 'the profile default is unchanged')
})

test('a policy from elsewhere cannot make a locked tab reveal itself by accident', SLOW, async () => {
  const { locks } = await bench()
  const group = await locks.createGroup('default', 'Personal', TAB, { hideUrl: 'no', label: '' })
  // A non-boolean keeps the private default; a blank label keeps the generic one.
  assert.equal(group.policy.hideUrl, true)
  assert.equal(group.policy.label, 'Locked Tab')
})

// ================================================================ profile isolation

test("one profile's credentials are invisible and unusable from another", SLOW, async () => {
  const { locks, accounts, dir } = await bench()
  await accounts.create('work', 'lantern gravel harbour', 'Work')
  const mine = await locks.createGroup('default', 'Personal', TAB)
  const theirs = await locks.createGroup('work', 'Work things', OTHER)

  assert.deepEqual((await locks.groups('default')).map((g) => g.name), ['Personal'])
  assert.deepEqual((await locks.groups('work')).map((g) => g.name), ['Work things'])

  // A group id from one profile is not a group in the other.
  await assert.rejects(
    () => locks.unlockGroup('work', mine.id, TAB),
    (err: TabLockFailure) => err.code === 'no-group'
  )
  await assert.rejects(
    () => locks.unlockGroup('default', theirs.id, OTHER),
    (err: TabLockFailure) => err.code === 'no-group'
  )
  void dir
})

test('switching profile closes everything that was open', SLOW, async () => {
  const { locks } = await bench()
  const group = await locks.createGroup('default', 'Personal', TAB)
  assert.equal(locks.isOpen('default', group.id), true)
  locks.closeAll()
  assert.equal(locks.isOpen('default', group.id), false)
})

test('a credential opened for one profile is not open for another with the same id', SLOW, async () => {
  const { locks, accounts } = await bench()
  await accounts.create('work', 'lantern gravel harbour', 'Work')
  const mine = await locks.createGroup('default', 'Personal', TAB)
  // Opening something in the other profile must not leave the first profile's group open.
  await locks.createGroup('work', 'Work things', OTHER)
  assert.equal(locks.isOpen('default', mine.id), false, 'the profile changed, so everything closed')
})
