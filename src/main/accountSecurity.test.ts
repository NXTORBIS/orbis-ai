import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountFailure, AccountSecurity, cooldownFor } from './accountSecurity.ts'
import { dataDirFor } from '../shared/profiles.ts'

const GOOD = 'quiet harbour lamp'
const OTHER = 'lantern gravel window'

const fresh = async (): Promise<{ security: AccountSecurity; dir: string }> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-account-'))
  return { security: new AccountSecurity(dir), dir }
}

const lockFile = (dir: string, profileId: string): string =>
  join(dir, dataDirFor(profileId), 'account.lock')

/** scrypt at these settings is deliberately slow; a handful of derivations per test is the cost of testing the real thing. */
const SLOW = { timeout: 120_000 }

// ---------------------------------------------------------------- an account with no password

test('an account made before passwords existed has none, and is not locked out by that', SLOW, async () => {
  const { security } = await fresh()
  assert.equal(await security.hasPassword('default'), false)
  const status = await security.status('default')
  assert.equal(status.hasPassword, false)
  assert.equal(status.unlocked, true, 'nothing to unlock, so nothing is withheld')
})

test('unlocking an account that has no password says so rather than letting anything through', SLOW, async () => {
  const { security } = await fresh()
  await assert.rejects(() => security.unlock('default', GOOD), (err: AccountFailure) => err.code === 'no-account')
})

// ---------------------------------------------------------------- making one

test('a password can be set, and the account is then open', SLOW, async () => {
  const { security } = await fresh()
  await security.create('default', GOOD, 'Nishanth')
  assert.equal(await security.hasPassword('default'), true)
  assert.equal(security.isUnlocked('default'), true, 'they just typed it twice; asking again would be theatre')
})

test('a weak password is refused, with the reason', SLOW, async () => {
  const { security } = await fresh()
  await assert.rejects(
    () => security.create('default', 'password1234'),
    (err: AccountFailure) => err.code === 'weak-password' && /anyone would try/.test(err.message)
  )
  assert.equal(await security.hasPassword('default'), false, 'and nothing was written')
})

test('a second password cannot be set over the first', SLOW, async () => {
  const { security } = await fresh()
  await security.create('default', GOOD)
  await assert.rejects(() => security.create('default', OTHER), (err: AccountFailure) => err.code === 'already-exists')
  // And the original still opens, so the attempt changed nothing.
  security.lock()
  await security.unlock('default', GOOD)
  assert.equal(security.isUnlocked('default'), true)
})

// ---------------------------------------------------------------- nothing in plaintext

test('the password is nowhere in what is written to disk', SLOW, async () => {
  const { security, dir } = await fresh()
  await security.create('default', GOOD)
  const written = await readFile(lockFile(dir, 'default'), 'utf8')

  assert.ok(!written.includes(GOOD), 'not the password')
  for (const word of GOOD.split(' ')) {
    assert.ok(!written.includes(word), `not the word "${word}" either`)
  }
  // What is there is a salt, a wrapped key, and the work factor it was made with.
  const file = JSON.parse(written)
  assert.equal(file.version, 1)
  assert.ok(file.password.salt && file.password.data && file.password.tag)
  assert.ok(file.password.n >= 1 << 15, 'and scrypt was asked to work hard')
  assert.equal(Object.keys(file).sort().join(','), 'createdAt,failures,lastFailureAt,password,updatedAt,version')
})

test('only the one file is written, and only where it belongs', SLOW, async () => {
  const { security, dir } = await fresh()
  await security.create('default', GOOD)
  const written = await readdir(dir)
  assert.deepEqual(written, ['account.lock'], 'no stray temporary file left behind')
})

// ---------------------------------------------------------------- opening it

test('the right password opens it and the wrong one does not', SLOW, async () => {
  const { security } = await fresh()
  await security.create('default', GOOD)
  security.lock()
  assert.equal(security.isUnlocked('default'), false)

  await assert.rejects(
    () => security.unlock('default', OTHER),
    (err: AccountFailure) => err.code === 'wrong-password'
  )
  assert.equal(security.isUnlocked('default'), false, 'a wrong guess does not open it')

  await security.unlock('default', GOOD)
  assert.equal(security.isUnlocked('default'), true)
})

test('a password survives being written and read back by a different instance', SLOW, async () => {
  const { security, dir } = await fresh()
  await security.create('default', GOOD)

  // A new instance reads only what is on disk, which is what a restart is.
  const afterRestart = new AccountSecurity(dir)
  assert.equal(await afterRestart.hasPassword('default'), true)
  assert.equal(afterRestart.isUnlocked('default'), false, 'a restart does not inherit being unlocked')
  await afterRestart.unlock('default', GOOD)
  assert.equal(afterRestart.isUnlocked('default'), true)
})

test('verifying checks without unlocking', SLOW, async () => {
  const { security } = await fresh()
  await security.create('default', GOOD)
  security.lock()
  assert.equal(await security.verify('default', GOOD), true)
  assert.equal(security.isUnlocked('default'), false, 'verifying is asking, not entering')
  assert.equal(await security.verify('default', OTHER), false)
})

// ---------------------------------------------------------------- guessing

test('guessing is allowed a few times, then made slow', SLOW, async () => {
  const { security } = await fresh()
  await security.create('default', GOOD)
  security.lock()

  // The first few are free, because people mistype.
  const at = 1_000_000
  for (let i = 0; i < 4; i++) {
    await assert.rejects(
      () => security.unlock('default', OTHER, at + i),
      (err: AccountFailure) => err.code === 'wrong-password'
    )
  }
  // The fifth is refused for being too soon rather than for being wrong.
  await assert.rejects(
    () => security.unlock('default', GOOD, at + 4),
    (err: AccountFailure) => err.code === 'cooling-down' && err.waitMs > 0
  )
  // Once waited out, the right password still works. A forgotten password must never become lost data.
  await security.unlock('default', GOOD, at + 4 + cooldownFor(4) + 1)
  assert.equal(security.isUnlocked('default'), true)
})

test('the cooldown is bounded, so an account can never be locked out for ever', () => {
  assert.equal(cooldownFor(0), 0)
  assert.ok(cooldownFor(4) > 0)
  assert.ok(cooldownFor(50) <= 300_000)
  assert.equal(cooldownFor(50), cooldownFor(5000), 'it stops growing')
})

test('a success clears the count, and the count survives a restart', SLOW, async () => {
  const { security, dir } = await fresh()
  await security.create('default', GOOD)
  security.lock()
  await assert.rejects(() => security.unlock('default', OTHER, 1000))
  assert.equal((await security.status('default', 1000)).failures, 1)

  // A restart must not hand an attacker a fresh set of free guesses.
  const afterRestart = new AccountSecurity(dir)
  assert.equal((await afterRestart.status('default', 1000)).failures, 1)

  await afterRestart.unlock('default', GOOD, 2000)
  assert.equal((await afterRestart.status('default', 2000)).failures, 0)
})

// ---------------------------------------------------------------- changing it

test('changing the password keeps the same account key, so nothing protected is lost', SLOW, async () => {
  const { security } = await fresh()
  await security.create('default', GOOD)

  // Something wrapped by the account key before the change.
  const secret = Buffer.from('a tab lock key', 'utf8')
  const wrapped = await security.wrapWithAccount('default', secret)

  await security.change('default', GOOD, OTHER)

  // The old password no longer opens it; the new one does.
  security.lock()
  await assert.rejects(() => security.unlock('default', GOOD), (err: AccountFailure) => err.code === 'wrong-password')
  await security.unlock('default', OTHER)

  // And the thing wrapped before the change still opens, which is the whole point of wrapping a key rather than
  // encrypting with the password.
  const back = await security.unwrapWithAccount('default', wrapped)
  assert.ok(back)
  assert.equal(back.toString('utf8'), 'a tab lock key')
})

test('the current password is required to change it', SLOW, async () => {
  const { security } = await fresh()
  await security.create('default', GOOD)
  await assert.rejects(
    () => security.change('default', OTHER, 'lantern gravel harbour'),
    (err: AccountFailure) => err.code === 'wrong-password'
  )
  // And the original still works, so the failed attempt changed nothing.
  security.lock()
  await security.unlock('default', GOOD)
})

test('a weak new password is refused before the old one is even checked', SLOW, async () => {
  const { security } = await fresh()
  await security.create('default', GOOD)
  await assert.rejects(
    () => security.change('default', GOOD, 'qwerty'),
    (err: AccountFailure) => err.code === 'weak-password'
  )
  security.lock()
  await security.unlock('default', GOOD, 0)
})

// ---------------------------------------------------------------- being a recovery root

test('the account key can wrap another credential, and only while the account is open', SLOW, async () => {
  const { security } = await fresh()
  await security.create('default', GOOD)

  const tabKey = Buffer.from('0123456789abcdef', 'utf8')
  const wrapped = await security.wrapWithAccount('default', tabKey)
  const back = await security.unwrapWithAccount('default', wrapped)
  assert.ok(back)
  assert.deepEqual(back, tabKey)

  security.lock()
  await assert.rejects(() => security.unwrapWithAccount('default', wrapped))
  assert.throws(() => security.wrapWithAccount('default', tabKey))
})

// ---------------------------------------------------------------- one profile cannot open another

test("one profile's password does not open another's account", SLOW, async () => {
  const { security } = await fresh()
  await security.create('default', GOOD)
  await security.create('work', OTHER)

  security.lock()
  await assert.rejects(() => security.unlock('work', GOOD), (err: AccountFailure) => err.code === 'wrong-password')
  await security.unlock('work', OTHER)
  assert.equal(security.isUnlocked('work'), true)
  assert.equal(security.isUnlocked('default'), false, 'and opening one does not open the other')
})

test('profiles keep separate files', SLOW, async () => {
  const { security, dir } = await fresh()
  await security.create('default', GOOD)
  await security.create('work', OTHER)
  const one = await readFile(lockFile(dir, 'default'), 'utf8')
  const two = await readFile(lockFile(dir, 'work'), 'utf8')
  assert.notEqual(one, two)
  assert.notEqual(JSON.parse(one).password.salt, JSON.parse(two).password.salt, 'and separate salts')
})

test('the same password in two profiles produces different stored bytes', SLOW, async () => {
  const { security, dir } = await fresh()
  await security.create('default', GOOD)
  await security.create('work', GOOD)
  const one = JSON.parse(await readFile(lockFile(dir, 'default'), 'utf8'))
  const two = JSON.parse(await readFile(lockFile(dir, 'work'), 'utf8'))
  // A per-account salt is why: without it, identical passwords would be visibly identical on disk.
  assert.notEqual(one.password.salt, two.password.salt)
  assert.notEqual(one.password.data, two.password.data)
})

// ---------------------------------------------------------------- a file that is there and not understood

/** Whatever was moved aside, by the name quarantine gives it. */
const movedAside = async (dir: string): Promise<string[]> =>
  (await readdir(dir)).filter((name) => name.includes('.unreadable-'))

test('a password file damaged into nonsense is moved aside, and the bytes are still there', SLOW, async () => {
  const { security, dir } = await fresh()
  await security.create('default', GOOD)

  // What a half-written file looks like: perfectly readable, and not JSON any more. This is the case that used to
  // read as "no password set" -- and the next save renamed defaults over the only copy of the wrapped key.
  const damaged = (await readFile(lockFile(dir, 'default'), 'utf8')).slice(0, 40)
  await writeFile(lockFile(dir, 'default'), damaged, 'utf8')

  const afterRestart = new AccountSecurity(dir)
  assert.equal(await afterRestart.hasPassword('default'), false, 'there is no password file this Orbis can use')

  const aside = await movedAside(dir)
  assert.equal(aside.length, 1, 'it was moved aside rather than left to be written over')
  assert.equal(await readFile(join(dir, aside[0]), 'utf8'), damaged, 'and every byte of it is still on the disk')

  // And Orbis is usable again: a password file nobody can read must not become a profile nobody can ever open.
  await afterRestart.create('default', OTHER)
  assert.equal(afterRestart.isUnlocked('default'), true)
  assert.equal(aside.length, (await movedAside(dir)).length, 'the copy that was put aside stays put')
})

test('a password file from a newer version of Orbis is not an account with no password', SLOW, async () => {
  const { security, dir } = await fresh()
  await security.create('default', GOOD)
  const real = JSON.parse(await readFile(lockFile(dir, 'default'), 'utf8'))
  await writeFile(lockFile(dir, 'default'), JSON.stringify({ ...real, version: 2 }), 'utf8')
  const onDisk = await readFile(lockFile(dir, 'default'), 'utf8')

  const afterDowngrade = new AccountSecurity(dir)
  assert.equal(await afterDowngrade.hasPassword('default'), false, 'this build cannot open it')
  assert.equal(afterDowngrade.unreadableFor('default'), true, 'but it knows something is there')

  await assert.rejects(
    () => afterDowngrade.create('default', OTHER),
    (err: AccountFailure) => err.code === 'io' && /newer version/.test(err.message)
  )
  assert.equal(await readFile(lockFile(dir, 'default'), 'utf8'), onDisk, 'and the file is exactly as it was')
  assert.deepEqual(await movedAside(dir), [], 'still where the newer Orbis left it, so that Orbis still works')
})

test('a password file Orbis does not understand refuses the write instead of replacing it', SLOW, async () => {
  const { security, dir } = await fresh()
  const onDisk = JSON.stringify({ version: 1, somethingElse: true })
  await writeFile(lockFile(dir, 'default'), onDisk, 'utf8')

  assert.equal(await security.hasPassword('default'), false)
  await assert.rejects(() => security.create('default', GOOD), (err: AccountFailure) => err.code === 'io')
  assert.equal(await readFile(lockFile(dir, 'default'), 'utf8'), onDisk)
  assert.deepEqual(await movedAside(dir), [])
})

test('a password file that cannot be read at all is left alone and never written over', SLOW, async () => {
  const { security, dir } = await fresh()
  // Something is at that path and it cannot be read -- which on Windows is routinely true for a moment anyway, when
  // antivirus or a backup program has the file open.
  await mkdir(lockFile(dir, 'default'), { recursive: true })

  assert.equal(await security.hasPassword('default'), false)
  assert.equal(security.unreadableFor('default'), true)
  await assert.rejects(() => security.create('default', GOOD), (err: AccountFailure) => err.code === 'io')
  assert.deepEqual(await movedAside(dir), [], 'and nothing was moved either')
})

test('no password file at all still means defaults, and a password may still be set', SLOW, async () => {
  const { security, dir } = await fresh()
  assert.equal(await security.hasPassword('default'), false)
  assert.equal(security.unreadableFor('default'), false, 'nothing is there, so nothing is at risk')
  assert.equal((await security.status('default')).hasPassword, false)

  await security.create('default', GOOD)
  assert.equal(await security.hasPassword('default'), true, 'a missing file is still the one case that may be written')
  assert.deepEqual(await movedAside(dir), [], 'and nothing was moved aside on the way')
})
