import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  SEAL_OVERHEAD_BYTES,
  SEAL_VERSION,
  isEncryptionError,
  isProtection,
  looksSealed,
  newContentKey,
  openEntry,
  PROTECTION_NOTES,
  protectPackage,
  sealEntry,
  unlockPackage,
  type EncryptionError,
  type PackageProtection
} from './encryption.ts'

const ok = <T>(value: T): Exclude<T, EncryptionError> => {
  assert.ok(!isEncryptionError(value), isEncryptionError(value) ? value.message : '')
  return value as Exclude<T, EncryptionError>
}

/** Long enough and varied enough to pass the strength check, and not a phrase anybody would choose. */
const GOOD = 'harbour-lantern-quiet-42'
const OTHER = 'different-anchor-blue-77'

describe('protecting a package', () => {
  it('wraps a fresh key that the password opens', async () => {
    const made = ok(await protectPackage(GOOD))
    const back = ok(await unlockPackage(GOOD, made.protection))
    assert.deepEqual([...back], [...made.key])
  })

  it('gives every package its own key and its own id', async () => {
    const one = ok(await protectPackage(GOOD))
    const other = ok(await protectPackage(GOOD))
    assert.notDeepEqual([...one.key], [...other.key])
    assert.notEqual(one.protection.packageId, other.protection.packageId)
  })

  it('refuses a weak password, and says why it matters here', async () => {
    const result = await protectPackage('password1')
    assert.ok(isEncryptionError(result))
    assert.equal(result.error, 'weak-password')
    assert.match(result.message, /will leave this machine/)
  })

  it('refuses the wrong password without saying which kind of wrong', async () => {
    const made = ok(await protectPackage(GOOD))
    const result = await unlockPackage(OTHER, made.protection)
    assert.ok(isEncryptionError(result))
    assert.equal(result.error, 'wrong-password')
    assert.match(result.message, /cannot be told apart/)
  })

  it('refuses an empty password rather than deriving from one', async () => {
    const made = ok(await protectPackage(GOOD))
    assert.ok(isEncryptionError(await unlockPackage('', made.protection)))
  })

  it('keeps no password and no key in the record it writes', async () => {
    const made = ok(await protectPackage(GOOD))
    const written = JSON.stringify(made.protection)
    assert.ok(!written.includes(GOOD))
    assert.ok(!written.includes(made.key.toString('base64')))
    assert.ok(!written.includes(made.key.toString('hex')))
  })

  it('records the work factor so a package made today opens when the numbers are raised', async () => {
    const made = ok(await protectPackage(GOOD))
    assert.ok(made.protection.wrapped.n > 1)
    assert.ok(made.protection.wrapped.r > 0)
    assert.match(made.protection.describe, /scrypt/)
  })

  it('refuses a package sealed by a newer Orbis rather than guessing at its format', async () => {
    const made = ok(await protectPackage(GOOD))
    const newer: PackageProtection = { ...made.protection, version: SEAL_VERSION + 1 }
    const result = await unlockPackage(GOOD, newer)
    assert.ok(isEncryptionError(result))
    assert.equal(result.error, 'unsupported')
    assert.match(result.message, /Update Orbis on this machine/)
  })

  it('refuses a method it does not know', async () => {
    const made = ok(await protectPackage(GOOD))
    const odd = { ...made.protection, method: 'magic' } as unknown as PackageProtection
    const result = await unlockPackage(GOOD, odd)
    assert.ok(isEncryptionError(result))
    assert.equal(result.error, 'unsupported')
  })

  it('checks the shape of a record that came out of a file', () => {
    assert.equal(isProtection(null), false)
    assert.equal(isProtection({}), false)
    assert.equal(isProtection({ version: 1, packageId: 'a', wrapped: {} }), false)
    assert.equal(
      isProtection({ version: 1, packageId: 'a', wrapped: { salt: 's', nonce: 'n', data: 'd', tag: 't', n: 1, r: 8, p: 1 } }),
      true
    )
  })

  it('says what the protection costs, for the screen that asks for a password', () => {
    assert.ok(PROTECTION_NOTES.length >= 3)
    assert.ok(PROTECTION_NOTES.some((one) => /cannot recover this password/.test(one)))
  })
})

describe('sealing an entry', () => {
  const key = newContentKey()
  const packageId = 'abcdef0123456789'
  const plaintext = Buffer.from('the quick brown fox jumps over the lazy dog', 'utf8')

  it('round-trips', () => {
    const sealed = ok(sealEntry(key, packageId, 'data/notes.json', plaintext))
    const back = ok(openEntry(key, packageId, 'data/notes.json', sealed))
    assert.equal(back.toString('utf8'), plaintext.toString('utf8'))
  })

  it('round-trips empty contents', () => {
    const sealed = ok(sealEntry(key, packageId, 'data/empty', Buffer.alloc(0)))
    assert.equal(ok(openEntry(key, packageId, 'data/empty', sealed)).length, 0)
  })

  it('round-trips bytes that are not text', () => {
    const binary = Buffer.from([0, 255, 128, 13, 10, 0, 7])
    const sealed = ok(sealEntry(key, packageId, 'data/blob', binary))
    assert.deepEqual([...ok(openEntry(key, packageId, 'data/blob', sealed))], [...binary])
  })

  it('uses a fresh nonce every time, so the same bytes never seal the same way', () => {
    const one = ok(sealEntry(key, packageId, 'data/notes.json', plaintext))
    const other = ok(sealEntry(key, packageId, 'data/notes.json', plaintext))
    assert.notEqual(one.toString('base64'), other.toString('base64'))
    // And both still open.
    assert.equal(ok(openEntry(key, packageId, 'data/notes.json', one)).toString('utf8'), plaintext.toString('utf8'))
    assert.equal(ok(openEntry(key, packageId, 'data/notes.json', other)).toString('utf8'), plaintext.toString('utf8'))
  })

  it('refuses an entry moved to another path inside the same package', () => {
    // The attack this exists to stop: swap the sealed settings over the sealed account, keeping every checksum valid.
    const sealed = ok(sealEntry(key, packageId, 'data/settings.json', plaintext))
    const result = openEntry(key, packageId, 'data/account.json', sealed)
    assert.ok(isEncryptionError(result))
    assert.equal(result.error, 'altered')
    assert.match(result.message, /came from somewhere else in the package/)
  })

  it('refuses an entry carried into another package made with the same password', () => {
    const sealed = ok(sealEntry(key, packageId, 'data/notes.json', plaintext))
    const result = openEntry(key, 'a-different-package-id', 'data/notes.json', sealed)
    assert.ok(isEncryptionError(result))
    assert.equal(result.error, 'altered')
  })

  it('refuses an entry sealed under a different key', () => {
    const sealed = ok(sealEntry(key, packageId, 'data/notes.json', plaintext))
    const result = openEntry(newContentKey(), packageId, 'data/notes.json', sealed)
    assert.ok(isEncryptionError(result))
    assert.equal(result.error, 'altered')
  })

  it('refuses an entry with one bit changed', () => {
    const sealed = ok(sealEntry(key, packageId, 'data/notes.json', plaintext))
    const tampered = Buffer.from(sealed)
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1
    const result = openEntry(key, packageId, 'data/notes.json', tampered)
    assert.ok(isEncryptionError(result))
    assert.equal(result.error, 'altered')
  })

  it('refuses an entry with a changed tag', () => {
    const sealed = ok(sealEntry(key, packageId, 'data/notes.json', plaintext))
    const tampered = Buffer.from(sealed)
    tampered[10] = (tampered[10] ?? 0) ^ 0xff
    assert.ok(isEncryptionError(openEntry(key, packageId, 'data/notes.json', tampered)))
  })

  it('refuses plain bytes where sealed ones belong', () => {
    const result = openEntry(key, packageId, 'data/notes.json', plaintext)
    assert.ok(isEncryptionError(result))
    assert.equal(result.error, 'not-sealed')
    assert.match(result.message, /tampered with or built wrongly/)
  })

  it('refuses bytes too short to be an entry at all', () => {
    const result = openEntry(key, packageId, 'data/notes.json', Buffer.from([1, 2, 3]))
    assert.ok(isEncryptionError(result))
    assert.equal(result.error, 'not-sealed')
  })

  it('refuses a key of the wrong length', () => {
    assert.ok(isEncryptionError(sealEntry(Buffer.alloc(16), packageId, 'a', plaintext)))
    assert.ok(isEncryptionError(openEntry(Buffer.alloc(16), packageId, 'a', Buffer.alloc(64))))
  })

  it('refuses to seal an entry with no path to bind it to', () => {
    assert.ok(isEncryptionError(sealEntry(key, packageId, '', plaintext)))
  })

  it('recognises its own framing', () => {
    const sealed = ok(sealEntry(key, packageId, 'a', plaintext))
    assert.equal(looksSealed(sealed), true)
    assert.equal(looksSealed(plaintext), false)
    assert.equal(looksSealed(Buffer.alloc(0)), false)
  })

  it('costs a fixed and known amount of space per entry', () => {
    const sealed = ok(sealEntry(key, packageId, 'a', plaintext))
    assert.equal(sealed.length, plaintext.length + SEAL_OVERHEAD_BYTES)
  })

  it('does not leave the plaintext visible in the sealed bytes', () => {
    const secret = Buffer.from('an api key that must not appear in the output at all', 'utf8')
    const sealed = ok(sealEntry(key, packageId, 'data/secret', secret))
    assert.ok(!sealed.includes(secret))
    assert.ok(!sealed.toString('latin1').includes('api key'))
  })
})

describe('the whole path, password to plaintext', () => {
  it('seals with the key a password produced and opens it with the same password', async () => {
    const made = ok(await protectPackage(GOOD))
    const bytes = Buffer.from(JSON.stringify({ notes: ['one', 'two'] }), 'utf8')
    const sealed = ok(sealEntry(made.key, made.protection.packageId, 'data/notes.json', bytes))

    // A different session: only the protection record and the password survive.
    const reopened = ok(await unlockPackage(GOOD, made.protection))
    const back = ok(openEntry(reopened, made.protection.packageId, 'data/notes.json', sealed))
    assert.deepEqual(JSON.parse(back.toString('utf8')), { notes: ['one', 'two'] })
  })

  it('cannot open the entry with a package id from another package', async () => {
    const made = ok(await protectPackage(GOOD))
    const other = ok(await protectPackage(GOOD))
    const sealed = ok(sealEntry(made.key, made.protection.packageId, 'data/notes.json', Buffer.from('x')))
    assert.ok(isEncryptionError(openEntry(made.key, other.protection.packageId, 'data/notes.json', sealed)))
  })
})
