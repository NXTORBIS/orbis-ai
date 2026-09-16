import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * The cryptography behind the secrets vault.
 *
 * Nothing here is invented. Keys are derived from a password with scrypt and data is sealed with AES-256-GCM, both
 * from Node's own library: a vault is not the place to be clever.
 *
 * The arrangement is the ordinary one, and it is what makes recovery and changing a password possible at all:
 *
 *   master password --scrypt--> a key that wraps ----\
 *                                                     >--- one random vault key --- AES-GCM ---> the secrets
 *   recovery answer --scrypt--> a key that wraps ----/
 *
 * The vault key is random and never leaves this process. The password does not encrypt the secrets; it only unwraps
 * the key that does. So changing the password rewraps one small thing rather than re-encrypting everything, and the
 * recovery answer can unwrap the very same key — which is why recovery here is real rather than a screen that pretends.
 *
 * Neither the password nor the recovery answer is stored in any form that can be turned back into them. What is stored
 * is a salt and a wrapped key; if the wrapping opens, the answer was right, and if it does not, it was not.
 */

const scryptAsync = promisify(scrypt) as (password: string | Buffer, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>

/** Deliberately slow. These cost roughly a quarter of a second and about 64 MB, which is cheap once and dear a billion times. */
export const KDF: { N: number; r: number; p: number; keyLength: number; maxmem: number } = { N: 1 << 16, r: 8, p: 1, keyLength: 32, maxmem: 128 * 1024 * 1024 }

const KEY_BYTES = 32
const SALT_BYTES = 16
const NONCE_BYTES = 12

/** Something sealed: the nonce it was sealed with, the sealed bytes, and the tag that proves it was not altered. */
export interface Sealed {
  nonce: string
  data: string
  tag: string
}

/** A key wrapped by a password or an answer: the salt it was derived with, and the wrapped key. */
export interface Wrapped extends Sealed {
  salt: string
  /** The work factor used, so a vault made today still opens when the numbers are raised tomorrow. */
  n: number
  r: number
  p: number
}

const b64 = (buffer: Buffer): string => buffer.toString('base64')
const un64 = (text: string): Buffer => Buffer.from(text, 'base64')

/** A key from a password. Slow on purpose. */
async function deriveKey(secret: string, salt: Buffer, params = KDF): Promise<Buffer> {
  return scryptAsync(Buffer.from(secret.normalize('NFKC'), 'utf8'), salt, KDF.keyLength, { N: params.N, r: params.r, p: params.p, maxmem: KDF.maxmem })
}

/** Seals bytes with a key. The nonce is fresh every time, which is the whole of GCM's safety. */
export function seal(key: Buffer, plaintext: Buffer): Sealed {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { nonce: b64(nonce), data: b64(data), tag: b64(cipher.getAuthTag()) }
}

/**
 * Opens what was sealed, or returns null.
 *
 * Null means the key was wrong or the bytes were altered; GCM cannot tell those apart and neither should anything
 * built on it. Nothing is returned half-decrypted.
 */
export function open(key: Buffer, sealed: Sealed): Buffer | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, un64(sealed.nonce))
    decipher.setAuthTag(un64(sealed.tag))
    return Buffer.concat([decipher.update(un64(sealed.data)), decipher.final()])
  } catch {
    return null
  }
}

/** A new vault key: random, never derived from anything a person chose. */
export const newVaultKey = (): Buffer => randomBytes(KEY_BYTES)

/** Wraps the vault key so that this password, and only this password, can unwrap it. */
export async function wrapKey(secret: string, vaultKey: Buffer): Promise<Wrapped> {
  const salt = randomBytes(SALT_BYTES)
  const wrapping = await deriveKey(secret, salt)
  const sealed = seal(wrapping, vaultKey)
  wipe(wrapping)
  return { ...sealed, salt: b64(salt), n: KDF.N, r: KDF.r, p: KDF.p }
}

/** The vault key back, or null when the password or answer was wrong. */
export async function unwrapKey(secret: string, wrapped: Wrapped): Promise<Buffer | null> {
  const wrapping = await deriveKey(secret, un64(wrapped.salt), { N: wrapped.n, r: wrapped.r, p: wrapped.p, keyLength: KEY_BYTES, maxmem: KDF.maxmem })
  const key = open(wrapping, wrapped)
  wipe(wrapping)
  return key
}

/**
 * Overwrites a key in memory once it is finished with.
 *
 * Not a guarantee — a garbage-collected runtime may have copied it — but the copy this process is holding is gone,
 * which is the difference between a key that lingers until the process exits and one that does not.
 */
export function wipe(...buffers: (Buffer | null | undefined)[]): void {
  for (const buffer of buffers) if (buffer) buffer.fill(0)
}

/** Comparing two secrets without leaking, by how long it took, how much of them matched. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export { randomBytes }
