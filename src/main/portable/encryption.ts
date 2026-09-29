/**
 * Encrypting a portable profile package.
 *
 * No new cryptography. The key derivation, the cipher and the key wrapping are the vault's, reused as they are:
 * scrypt at the vault's work factor, AES-256-GCM, and a random content key wrapped by the password. Inventing a
 * scheme for this would mean a second thing to get right, and the first one is already reviewed and tested.
 *
 * ## What is and is not encrypted
 *
 * The manifest is **not**. It has to be readable before a password is asked for, so that a person can see what a
 * package contains and decide whether to type one — and so that a package from a newer Orbis can be refused by
 * looking at it rather than by failing to decrypt it. `manifest.ts` is built on the rule that nothing private goes
 * in there, and this file is why that rule exists.
 *
 * Everything else is sealed **per entry** rather than as one blob. Three reasons, in order of importance:
 *
 * 1. A damaged entry costs that entry. Sealing the whole payload at once means one flipped bit anywhere loses all of
 *    it, and a transfer package is exactly the thing that gets copied over a flaky connection.
 * 2. Each entry gets its own nonce, which is the whole of GCM's safety.
 * 3. An entry can be read without holding the whole package in memory.
 *
 * ## Why each entry is bound to its own path
 *
 * The package id and the entry's canonical path go in as additional authenticated data. Without that, the sealed
 * bytes of one entry are valid sealed bytes for any entry: somebody could move `settings.json` over `account.json`
 * inside the archive and every checksum and tag would still verify, because both really were sealed with this key.
 * Binding the path makes an entry decrypt only where it belongs, and binding the package id stops an entry being
 * carried between two packages made with the same password.
 *
 * Node's AES-GCM takes additional data through `setAAD`, so this is the cipher being used as intended rather than
 * anything new.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { judgePassword } from '../../shared/passwordStrength.ts'
import { KDF, unwrapKey, wipe, wrapKey, type Wrapped } from '../vault/crypto.ts'

/** The framing version. Bumping it means old packages need a reader that knows the old framing. */
export const SEAL_VERSION = 1

/** Eight bytes at the front of every sealed entry, so a reader can tell sealed bytes from plain ones. */
const MAGIC = Buffer.from('ORBSEAL\u0001', 'latin1')
const NONCE_BYTES = 12
const TAG_BYTES = 16
const HEADER_BYTES = MAGIC.length + NONCE_BYTES + TAG_BYTES

export interface EncryptionError {
  error: 'wrong-password' | 'weak-password' | 'not-sealed' | 'altered' | 'unsupported' | 'invalid-argument'
  message: string
}

export const isEncryptionError = (value: unknown): value is EncryptionError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: EncryptionError['error'], message: string): EncryptionError => ({ error, message })

/**
 * How a package is protected, as it appears in the package itself.
 *
 * Holds no key and no password — only the salt and the work factor needed to derive the wrapping key again, and the
 * content key sealed under it. Reading this record tells an attacker the cost of guessing and nothing else.
 */
export interface PackageProtection {
  version: number
  method: 'password'
  /** Random, per package. Bound into every entry so entries cannot travel between packages. */
  packageId: string
  wrapped: Wrapped
  /** The work factor in words, so a person can see what protects it without reading the numbers. */
  describe: string
}

/** A fresh content key. Random, never derived from anything a person chose. */
export const newContentKey = (): Buffer => randomBytes(32)

/**
 * Wraps a fresh content key under a password.
 *
 * The password is judged first and a weak one is refused. That is not paternalism about the user's own data: this
 * package is the thing that leaves the machine, and its password is the only thing between it and whoever picks up
 * the drive it is on. Everything else Orbis protects is also behind the operating system's own account.
 */
export async function protectPackage(password: string): Promise<{ key: Buffer; protection: PackageProtection } | EncryptionError> {
  if (typeof password !== 'string') return fail('invalid-argument', 'A password is required.')
  const verdict = judgePassword(password)
  if (!verdict.ok) {
    return fail('weak-password', `${verdict.problem} A package password protects a file that will leave this machine, where nothing else is guarding it.`)
  }
  const key = newContentKey()
  const wrapped = await wrapKey(password, key)
  return {
    key,
    protection: {
      version: SEAL_VERSION,
      method: 'password',
      packageId: randomBytes(16).toString('hex'),
      wrapped,
      describe: `AES-256-GCM, with the key derived from the password by scrypt at N=${wrapped.n}, r=${wrapped.r}, p=${wrapped.p}. Each file is sealed separately and bound to its own path.`
    }
  }
}

/**
 * Recovers the content key from a password.
 *
 * A wrong password and an altered wrapping record are the same answer, because GCM cannot tell them apart and
 * neither should anything built on it. The message says both rather than guessing which.
 */
export async function unlockPackage(password: string, protection: PackageProtection): Promise<Buffer | EncryptionError> {
  if (typeof password !== 'string' || password === '') return fail('invalid-argument', 'A password is required.')
  if (!isProtection(protection)) return fail('unsupported', 'This package does not say how it is protected, so there is nothing to unlock it with.')
  if (protection.version > SEAL_VERSION) {
    return fail(
      'unsupported',
      `This package was sealed by a newer version of Orbis (format ${protection.version}; this one reads up to ${SEAL_VERSION}). Update Orbis on this machine and import it again — opening it with an older reader would mean guessing at a format that has changed.`
    )
  }
  if (protection.method !== 'password') {
    return fail('unsupported', `This package is protected by "${String(protection.method)}", which this version of Orbis does not know how to open.`)
  }
  const key = await unwrapKey(password, protection.wrapped)
  if (key === null) {
    return fail('wrong-password', 'That password does not open this package. The same answer covers an altered package: the two cannot be told apart, and treating one as the other would be a guess.')
  }
  return key
}

/** Whether a value read out of a package is shaped like a protection record. It came from a file, so it is checked. */
export function isProtection(value: unknown): value is PackageProtection {
  if (typeof value !== 'object' || value === null) return false
  const one = value as Record<string, unknown>
  if (typeof one.version !== 'number' || typeof one.packageId !== 'string' || one.packageId === '') return false
  const wrapped = one.wrapped
  if (typeof wrapped !== 'object' || wrapped === null) return false
  const w = wrapped as Record<string, unknown>
  return (
    typeof w.salt === 'string' &&
    typeof w.nonce === 'string' &&
    typeof w.data === 'string' &&
    typeof w.tag === 'string' &&
    typeof w.n === 'number' &&
    typeof w.r === 'number' &&
    typeof w.p === 'number'
  )
}

const additionalData = (packageId: string, path: string): Buffer => Buffer.from(`${packageId}\u0000${path}`, 'utf8')

/**
 * Seals one entry.
 *
 * The result is framed rather than returned as three fields, because it goes into a ZIP entry as bytes and a
 * base64 envelope would add a third to the size of every file in the package.
 */
export function sealEntry(key: Buffer, packageId: string, path: string, plaintext: Buffer): Buffer | EncryptionError {
  if (key.length !== 32) return fail('invalid-argument', 'The content key must be 32 bytes.')
  if (typeof path !== 'string' || path === '') return fail('invalid-argument', 'An entry needs a path to be bound to.')
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(additionalData(packageId, path))
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), data])
}

/**
 * Opens one entry, or says why not.
 *
 * `altered` here covers every way the bytes can fail to verify: a corrupted transfer, a deliberately edited package,
 * or an entry lifted from a different path or a different package. They are one answer because the tag proves the
 * bytes are not what was sealed and cannot say which of those happened.
 */
export function openEntry(key: Buffer, packageId: string, path: string, sealed: Buffer): Buffer | EncryptionError {
  if (key.length !== 32) return fail('invalid-argument', 'The content key must be 32 bytes.')
  if (sealed.length < HEADER_BYTES) return fail('not-sealed', `The entry "${path}" is too short to be a sealed entry.`)
  if (!sealed.subarray(0, MAGIC.length).equals(MAGIC)) {
    return fail('not-sealed', `The entry "${path}" is not sealed. An encrypted package whose entries are not sealed has been tampered with or built wrongly, and is not opened either way.`)
  }
  const nonce = sealed.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES)
  const tag = sealed.subarray(MAGIC.length + NONCE_BYTES, HEADER_BYTES)
  const data = sealed.subarray(HEADER_BYTES)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAAD(additionalData(packageId, path))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()])
  } catch {
    return fail(
      'altered',
      `The entry "${path}" does not verify. Either the package was damaged in transit, or it was altered, or this entry came from somewhere else in the package. Nothing is returned half-decrypted.`
    )
  }
}

/** True when these bytes carry the sealed framing. Used to tell an encrypted package from a plain one, per entry. */
export const looksSealed = (bytes: Buffer): boolean =>
  bytes.length >= HEADER_BYTES && bytes.subarray(0, MAGIC.length).equals(MAGIC)

/** How much larger a sealed entry is than its contents. Fixed, so an export can estimate space before doing the work. */
export const SEAL_OVERHEAD_BYTES = HEADER_BYTES

/** What protecting a package costs, in words, for the screen that asks for the password. */
export const PROTECTION_NOTES: readonly string[] = Object.freeze([
  `The password is turned into a key by scrypt at N=${KDF.N}, which takes about a quarter of a second and 64 MB of memory here. That cost is paid once when you open the package and once per guess by anyone trying to.`,
  'Orbis cannot recover this password. There is no copy of it and no way back into the package without it — that is what makes the package safe to carry, and it means a forgotten password loses the package.',
  'Each file in the package is sealed separately and bound to its own name, so an entry cannot be swapped for another even by someone who has the password.'
])

/** Wipes a content key once an export or import has finished with it. */
export const forgetKey = (key: Buffer | null): void => {
  wipe(key)
}
