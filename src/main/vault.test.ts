import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { SecretsVault, VaultFailure } from './vault/store.ts'
import { newVaultKey, open, seal, unwrapKey, wrapKey } from './vault/crypto.ts'
import { alphabet, checkMasterPassword, makePassword, matchesSearch, readSecretInput, strengthBits, summarize } from '../shared/vault.ts'
import type { SecretDetail } from '../shared/vault'

const PASSWORD = 'correct horse battery staple'
const withVault = async (run: (vault: SecretsVault, dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-vault-'))
  try {
    await run(new SecretsVault(dir), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------- the cryptography

test('what is sealed can be opened with the right key, and with nothing else', () => {
  const key = newVaultKey()
  const sealed = seal(key, Buffer.from('a real secret', 'utf8'))
  assert.equal(open(key, sealed)?.toString('utf8'), 'a real secret')
  assert.equal(open(newVaultKey(), sealed), null, 'another key opens nothing')

  // Nothing comes back half-decrypted when the bytes have been meddled with.
  assert.equal(open(key, { ...sealed, data: Buffer.from('tampered').toString('base64') }), null)
  assert.equal(open(key, { ...sealed, tag: Buffer.alloc(16).toString('base64') }), null)
})

test('sealing the same thing twice never produces the same bytes', () => {
  const key = newVaultKey()
  const once = seal(key, Buffer.from('same', 'utf8'))
  const twice = seal(key, Buffer.from('same', 'utf8'))
  assert.notEqual(once.nonce, twice.nonce, 'a fresh nonce every time is the whole of GCM’s safety')
  assert.notEqual(once.data, twice.data)
})

test('a password unwraps the vault key, and a wrong one unwraps nothing', async () => {
  const key = newVaultKey()
  const wrapped = await wrapKey(PASSWORD, key)

  assert.ok(Buffer.compare((await unwrapKey(PASSWORD, wrapped))!, key) === 0)
  assert.equal(await unwrapKey('correct horse battery stapl', wrapped), null)
  assert.equal(await unwrapKey('', wrapped), null)

  // What is stored contains neither the password nor the key.
  const stored = JSON.stringify(wrapped)
  assert.ok(!stored.includes(PASSWORD))
  assert.ok(!stored.includes(key.toString('base64')))
})

// ---------------------------------------------------------------- a vault on disk

test('a new vault is created locked to its password, and nothing readable is written', async () => {
  await withVault(async (vault, dir) => {
    await vault.create('default', PASSWORD)
    await vault.add('default', { kind: 'apiKey', name: 'Groq API', provider: 'Groq', value: 'gsk-super-secret-value' })

    const onDisk = await readFile(join(dir, 'secrets.vault'), 'utf8')
    assert.ok(!onDisk.includes('gsk-super-secret-value'), 'the value is not on disk')
    assert.ok(!onDisk.includes('Groq API'), 'nor is what it is called')
    assert.ok(!onDisk.includes(PASSWORD), 'nor is the master password')

    const status = await vault.status('default')
    assert.equal(status.exists, true)
    assert.equal(status.unlocked, true)
    assert.equal(status.count, 1)
  })
})

test('a locked vault says nothing about what is in it', async () => {
  await withVault(async (vault) => {
    await vault.create('default', PASSWORD)
    await vault.add('default', { kind: 'apiKey', name: 'Groq API', value: 'gsk-secret' })
    vault.lock()

    assert.throws(() => vault.list('default'), (e: VaultFailure) => e.code === 'locked')
    assert.throws(() => vault.reveal('default', 'anything'), (e: VaultFailure) => e.code === 'locked')
    const status = await vault.status('default')
    assert.equal(status.unlocked, false)
    assert.equal(status.count, undefined, 'not even how many there are')
  })
})

test('the right password opens it again; the wrong one does not, and says only that', async () => {
  await withVault(async (vault) => {
    await vault.create('default', PASSWORD)
    await vault.add('default', { kind: 'password', name: 'GitHub', username: 'me', value: 'hunter2' })
    vault.lock()

    await assert.rejects(() => vault.unlock('default', 'not the password'), (e: VaultFailure) => e.code === 'wrong-password')
    assert.equal(vault.isUnlocked('default'), false, 'a failed attempt does not leave it ajar')

    await vault.unlock('default', PASSWORD)
    assert.equal(vault.reveal('default', vault.list('default')[0].id).value, 'hunter2')
  })
})

test('a list says what a secret is for, and never what it is', async () => {
  await withVault(async (vault) => {
    await vault.create('default', PASSWORD)
    await vault.add('default', { kind: 'apiKey', name: 'Groq API', provider: 'Groq', value: 'gsk-do-not-show-me', notes: 'private note', favorite: true })

    const listed = JSON.stringify(vault.list('default'))
    assert.ok(listed.includes('Groq API') && listed.includes('Groq'), 'it can be found by what it is for')
    assert.ok(!listed.includes('gsk-do-not-show-me'), 'the value is not in the list')
    assert.ok(!listed.includes('private note'), 'nor are the notes')
  })
})

test('every kind of secret can be kept, changed and taken away', async () => {
  await withVault(async (vault) => {
    await vault.create('default', PASSWORD)
    for (const secret of [
      { kind: 'apiKey', name: 'Groq', provider: 'Groq', value: 'gsk-1' },
      { kind: 'password', name: 'Mail', website: 'mail.example', username: 'me', value: 'p1' },
      { kind: 'login', name: 'Bank', username: 'me', value: 'p2' },
      { kind: 'note', name: 'Notes', value: 'something private' },
      { kind: 'recoveryCode', name: 'Codes', value: '111-222\n333-444' },
      { kind: 'custom', name: 'Other', value: '', fields: [{ name: 'Seed phrase', value: 'a b c' }] }
    ]) {
      await vault.add('default', secret)
    }
    assert.equal(vault.list('default').length, 6)

    const mail = vault.list('default').find((s) => s.name === 'Mail')!
    await vault.update('default', mail.id, { kind: 'password', name: 'Mail', website: 'mail.example', username: 'me', value: 'changed' })
    assert.equal(vault.reveal('default', mail.id).value, 'changed')
    assert.ok(vault.reveal('default', mail.id).updatedAt >= mail.createdAt)

    await vault.remove('default', mail.id)
    assert.equal(vault.list('default').length, 5)
    assert.throws(() => vault.reveal('default', mail.id), (e: VaultFailure) => e.code === 'not-found')
  })
})

test('an old value does not survive an edit anywhere on disk', async () => {
  await withVault(async (vault, dir) => {
    await vault.create('default', PASSWORD)
    const added = await vault.add('default', { kind: 'note', name: 'Note', value: 'THE-OLD-VALUE' })
    await vault.update('default', added.id, { kind: 'note', name: 'Note', value: 'the new value' })

    const onDisk = await readFile(join(dir, 'secrets.vault'), 'utf8')
    assert.ok(!onDisk.includes('THE-OLD-VALUE'))
    // And it is genuinely gone, not merely unreadable in the blob.
    vault.lock()
    await vault.unlock('default', PASSWORD)
    assert.equal(vault.reveal('default', added.id).value, 'the new value')
  })
})

test('changing the master password keeps every secret, and the old password stops working', async () => {
  await withVault(async (vault) => {
    await vault.create('default', PASSWORD)
    const added = await vault.add('default', { kind: 'apiKey', name: 'Groq', value: 'gsk-keep-me' })

    await vault.changeMasterPassword('default', PASSWORD, 'a different master password')
    assert.equal(vault.reveal('default', added.id).value, 'gsk-keep-me', 'the secrets are untouched')

    vault.lock()
    await assert.rejects(() => vault.unlock('default', PASSWORD), (e: VaultFailure) => e.code === 'wrong-password')
    await vault.unlock('default', 'a different master password')
    assert.equal(vault.reveal('default', added.id).value, 'gsk-keep-me')

    await assert.rejects(() => vault.changeMasterPassword('default', 'wrong', 'x'), (e: VaultFailure) => e.code === 'wrong-password')
  })
})

test('recovery really opens the vault, rather than pretending to', async () => {
  await withVault(async (vault) => {
    await vault.create('default', PASSWORD, { question: 'What was your first phone?', answer: 'Nokia 3310' })
    const added = await vault.add('default', { kind: 'note', name: 'Note', value: 'survives recovery' })
    vault.lock()

    assert.equal(await vault.recoveryQuestion('default'), 'What was your first phone?')
    await assert.rejects(() => vault.recover('default', 'a wrong answer', 'new password here'), (e: VaultFailure) => e.code === 'wrong-answer')

    // The answer is compared forgivingly about spacing and case, because that is not what is being remembered.
    await vault.recover('default', '  nokia   3310 ', 'a brand new master password')
    assert.equal(vault.reveal('default', added.id).value, 'survives recovery', 'the secrets came back, not a fresh empty vault')

    vault.lock()
    await vault.unlock('default', 'a brand new master password')
    assert.equal(vault.list('default').length, 1)
  })
})

test('a vault with no way back in says so rather than offering a false hope', async () => {
  await withVault(async (vault) => {
    await vault.create('default', PASSWORD)
    assert.equal(await vault.recoveryQuestion('default'), null)
    assert.equal((await vault.status('default')).hasRecovery, false)
    await assert.rejects(() => vault.recover('default', 'anything', 'new password here'), (e: VaultFailure) => e.code === 'no-recovery')
  })
})

test('the way back in can only be changed by somebody who knows the password', async () => {
  await withVault(async (vault) => {
    await vault.create('default', PASSWORD)
    await assert.rejects(() => vault.setRecovery('default', 'wrong', { question: 'q', answer: 'a' }), (e: VaultFailure) => e.code === 'wrong-password')

    await vault.setRecovery('default', PASSWORD, { question: 'First pet?', answer: 'Rex' })
    assert.equal(await vault.recoveryQuestion('default'), 'First pet?')

    await vault.setRecovery('default', PASSWORD, null)
    assert.equal((await vault.status('default')).hasRecovery, false, 'and it can be taken away again')
  })
})

test('the answer to the recovery question is never written down', async () => {
  await withVault(async (vault, dir) => {
    await vault.create('default', PASSWORD, { question: 'What was your first phone?', answer: 'Nokia 3310' })
    const onDisk = await readFile(join(dir, 'secrets.vault'), 'utf8')
    assert.ok(onDisk.includes('What was your first phone?'), 'the question is the user’s own words and is not secret')
    assert.ok(!onDisk.toLowerCase().includes('nokia'), 'the answer is not there in any form')
  })
})

test('one profile cannot open another profile’s vault', async () => {
  await withVault(async (vault) => {
    await vault.create('default', PASSWORD)
    await vault.add('default', { kind: 'note', name: 'Personal', value: 'mine alone' })

    await vault.create('work', 'a completely different password')
    await vault.add('work', { kind: 'note', name: 'Work', value: 'the other one' })

    // Unlocked for "work" says nothing about "default", whatever is asked.
    assert.deepEqual(vault.list('work').map((s) => s.name), ['Work'])
    assert.throws(() => vault.list('default'), (e: VaultFailure) => e.code === 'locked')

    // And the other profile's password does not open this one.
    vault.lock()
    await assert.rejects(() => vault.unlock('work', PASSWORD), (e: VaultFailure) => e.code === 'wrong-password')
    await vault.unlock('default', PASSWORD)
    assert.deepEqual(vault.list('default').map((s) => s.name), ['Personal'])
  })
})

test('deleting the vault needs the password, and takes everything with it', async () => {
  await withVault(async (vault, dir) => {
    await vault.create('default', PASSWORD)
    await vault.add('default', { kind: 'note', name: 'Note', value: 'gone soon' })

    await assert.rejects(() => vault.destroy('default', 'wrong'), (e: VaultFailure) => e.code === 'wrong-password')
    await vault.destroy('default', PASSWORD)

    assert.equal((await vault.status('default')).exists, false)
    await assert.rejects(readFile(join(dir, 'secrets.vault'), 'utf8'))
    await assert.rejects(() => vault.unlock('default', PASSWORD), (e: VaultFailure) => e.code === 'no-vault')
  })
})

test('the vault locks itself, and forgets everything when it does', async () => {
  await withVault(async (vault) => {
    await vault.create('default', PASSWORD)
    await vault.add('default', { kind: 'note', name: 'Note', value: 'x' })
    await vault.setAutoLock('default', PASSWORD, 0)

    let toldItLocked = false
    vault.whenLocked(() => (toldItLocked = true))
    await vault.unlock('default', PASSWORD)
    assert.equal(vault.isUnlocked('default'), true)

    await new Promise((r) => setTimeout(r, 1400))
    assert.equal(vault.isUnlocked('default'), false, 'it locked itself')
    assert.equal(toldItLocked, true, 'and said so, so the window can clear what it was showing')
    assert.throws(() => vault.list('default'), (e: VaultFailure) => e.code === 'locked')
  })
})

test('a vault cannot be made twice for the same profile', async () => {
  await withVault(async (vault) => {
    await vault.create('default', PASSWORD)
    await assert.rejects(() => vault.create('default', 'another'), (e: VaultFailure) => e.code === 'already-exists')
  })
})

// ---------------------------------------------------------------- the password generator

test('a generated password is drawn only from what was asked for', () => {
  const random = (n: number): Uint8Array => randomBytes(n)
  for (const options of [
    { length: 24, uppercase: true, lowercase: false, numbers: false, symbols: false, avoidAmbiguous: false },
    { length: 16, uppercase: false, lowercase: false, numbers: true, symbols: false, avoidAmbiguous: false },
    { length: 32, uppercase: true, lowercase: true, numbers: true, symbols: true, avoidAmbiguous: false }
  ]) {
    const password = makePassword(options, random)
    assert.equal(password.length, options.length)
    const allowed = new Set(alphabet(options))
    assert.ok([...password].every((c) => allowed.has(c)), `${password} uses only what was asked for`)
  }
})

test('the characters people misread can be left out', () => {
  const options = { length: 60, uppercase: true, lowercase: true, numbers: true, symbols: false, avoidAmbiguous: true }
  const password = makePassword(options, (n) => randomBytes(n))
  assert.ok(!/[O0l1I]/.test(password), password)
})

test('every character is equally likely, rather than the first few being commoner', () => {
  // A modulus of a random byte quietly favours the start of the alphabet. Over many draws that shows up as a skew.
  const options = { length: 128, uppercase: false, lowercase: false, numbers: false, symbols: false, avoidAmbiguous: false, extra: 'abcdefghij' }
  const counts = new Map<string, number>()
  let drawn = 0
  for (let i = 0; i < 160; i++) {
    for (const c of makePassword(options, (n) => randomBytes(n))) {
      counts.set(c, (counts.get(c) ?? 0) + 1)
      drawn++
    }
  }
  assert.equal(counts.size, 10)
  const expected = drawn / 10
  for (const [char, count] of counts) {
    assert.ok(Math.abs(count - expected) < expected * 0.2, `${char} came up ${count} times, expected about ${expected}`)
  }
})

test('asking for nothing gives nothing, rather than a password of one character repeated', () => {
  assert.equal(makePassword({ length: 20, uppercase: false, lowercase: false, numbers: false, symbols: false, avoidAmbiguous: false }, (n) => randomBytes(n)), '')
})

test('how hard a password is to guess is said in bits', () => {
  const options = { length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true, avoidAmbiguous: false }
  assert.ok(strengthBits(makePassword(options, (n) => randomBytes(n)), options) > 120)
})

// ---------------------------------------------------------------- what may be stored, and found

test('a master password has to be one worth having', () => {
  assert.match(checkMasterPassword('short') ?? '', /at least/)
  assert.match(checkMasterPassword('') ?? '', /Enter a master password/)
  assert.equal(checkMasterPassword('a long enough password'), null)
})

test('nonsense from the window is refused rather than stored', () => {
  assert.equal(readSecretInput(null), null)
  assert.equal(readSecretInput({}), null, 'nothing to store')
  assert.equal(readSecretInput({ name: '   ' }), null)
  const read = readSecretInput({ kind: 'not a kind', name: '  Groq  ', value: 'gsk-1', tags: ['a', 'a', 'b'] })
  assert.equal(read?.kind, 'custom', 'a kind that does not exist becomes the general one')
  assert.equal(read?.name, 'Groq')
  assert.deepEqual(read?.tags, ['a', 'b'])
})

test('searching looks at what a secret says about itself, never at the secret', () => {
  const detail: SecretDetail = {
    id: '1', kind: 'apiKey', name: 'Groq API', provider: 'Groq', tags: ['work'], favorite: false,
    createdAt: 0, updatedAt: 0, value: 'gsk-unmistakable-value', notes: 'a private note'
  }
  const summary = summarize(detail)
  assert.equal(matchesSearch(summary, 'groq'), true)
  assert.equal(matchesSearch(summary, 'work'), true)
  assert.equal(matchesSearch(summary, 'api key'), true, 'the kind, said the way it is shown')
  assert.equal(matchesSearch(summary, 'unmistakable'), false, 'the value is not searched')
  assert.equal(matchesSearch(summary, 'private note'), false, 'nor are the notes')
})
