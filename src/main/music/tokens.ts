import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { dataDirFor, DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'
import type { SecretStorePort } from '../platform.ts'

/**
 * Where a music service's permission is kept.
 *
 * ## Encrypted by the operating system, one file per profile
 *
 * The same `SecretStorePort` the API keys use, which is DPAPI on Windows and the Keychain on a Mac. A token on
 * disk is readable only by this account, and on a machine that cannot encrypt, **nothing is stored at all** — the
 * connection stays signed out and says why, which is better than a plaintext token somebody did not know about.
 *
 * ## Nothing outside this file ever sees a token
 *
 * There is deliberately no method that returns one. `authorizationFor` hands back a finished header value, and
 * the only caller is the request code in this folder. No token reaches the renderer, a browser page, Orion, a
 * log line or an error message — `describe` exists so a screen can say something true without being given the
 * secret to say it with.
 *
 * ## Passwords are never involved
 *
 * Orbis never asks for a music account's password. Signing in happens on the service's own page and what comes
 * back is a token with a scope and an expiry. There is no code path here that accepts a password, by design.
 */

export interface StoredToken {
  sourceId: string
  /** Seconds since the epoch when the access token stops working, when the service said. */
  expiresAt: number | null
  /** What the service actually granted, which is what capability detection is checked against. */
  scopes: readonly string[]
  account: string | null
  savedAt: number
}

interface OnDisk {
  sourceId: string
  access: string
  refresh: string | null
  expiresAt: number | null
  scopes: string[]
  account: string | null
  savedAt: number
}

const tokenFile = (userData: string, profileId: string): string =>
  join(userData, dataDirFor(profileId), 'music', 'connections.secret')

export class MusicTokens {
  private readonly secrets: SecretStorePort
  private readonly userData: string
  private profileId = DEFAULT_PROFILE_ID
  /** Held in memory only for the life of the process, so a request does not decrypt the file every time. */
  private cache: Map<string, OnDisk> | null = null

  constructor(userData: string, secrets: SecretStorePort) {
    this.userData = userData
    this.secrets = secrets
  }

  async useProfile(profileId: string): Promise<void> {
    if (profileId === this.profileId) return
    this.profileId = profileId
    // Dropped rather than carried: one person's permissions must never be used under another's profile.
    this.cache = null
  }

  /** Whether this computer can keep a token at all. The connection card says so when it cannot. */
  available(): boolean {
    try {
      return this.secrets.available()
    } catch {
      return false
    }
  }

  private async load(): Promise<Map<string, OnDisk>> {
    if (this.cache) return this.cache
    const held = new Map<string, OnDisk>()
    this.cache = held
    if (!this.available()) return held
    let bytes: Buffer
    try {
      bytes = await fs.readFile(tokenFile(this.userData, this.profileId))
    } catch {
      return held
    }
    try {
      const plain = this.secrets.decrypt(bytes)
      const rows = JSON.parse(plain)
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (!row || typeof row !== 'object') continue
          const one = row as Record<string, unknown>
          if (typeof one.sourceId !== 'string' || typeof one.access !== 'string') continue
          held.set(one.sourceId, {
            sourceId: one.sourceId,
            access: one.access,
            refresh: typeof one.refresh === 'string' ? one.refresh : null,
            expiresAt: typeof one.expiresAt === 'number' ? one.expiresAt : null,
            scopes: Array.isArray(one.scopes) ? one.scopes.filter((two): two is string => typeof two === 'string') : [],
            account: typeof one.account === 'string' ? one.account : null,
            savedAt: typeof one.savedAt === 'number' ? one.savedAt : 0
          })
        }
      }
    } catch {
      /*
       * Unreadable is not the same as absent.
       *
       * A file this account cannot decrypt — copied from another machine, or written before a profile change —
       * is left exactly where it is. Overwriting it would destroy a permission that a correct key could still
       * read, so the connection simply shows as signed out.
       */
      return held
    }
    return held
  }

  private async save(held: Map<string, OnDisk>): Promise<boolean> {
    if (!this.available()) return false
    const path = tokenFile(this.userData, this.profileId)
    await fs.mkdir(join(path, '..'), { recursive: true })
    const sealed = this.secrets.encrypt(JSON.stringify([...held.values()]))
    const temporary = `${path}.tmp`
    await fs.writeFile(temporary, sealed, { mode: 0o600 })
    await fs.rename(temporary, path)
    return true
  }

  /** Keeps what a sign-in returned. Returns false when this computer cannot encrypt, and stores nothing. */
  async keep(one: {
    sourceId: string
    access: string
    refresh?: string | null
    expiresAt?: number | null
    scopes?: readonly string[]
    account?: string | null
  }, now: number): Promise<boolean> {
    if (!this.available()) return false
    const held = await this.load()
    held.set(one.sourceId, {
      sourceId: one.sourceId,
      access: one.access,
      refresh: one.refresh ?? null,
      expiresAt: one.expiresAt ?? null,
      scopes: [...(one.scopes ?? [])],
      account: one.account ?? null,
      savedAt: now
    })
    return this.save(held)
  }

  /** What a screen may know: never the token, only whether there is one and what it covers. */
  async describe(sourceId: string): Promise<StoredToken | null> {
    const held = await this.load()
    const one = held.get(sourceId)
    if (!one) return null
    return { sourceId, expiresAt: one.expiresAt, scopes: one.scopes, account: one.account, savedAt: one.savedAt }
  }

  async have(sourceId: string): Promise<boolean> {
    return (await this.load()).has(sourceId)
  }

  /**
   * A finished `Authorization` header value, for the request code only.
   *
   * Null when there is nothing stored or the permission has run out. The caller then refreshes or asks the person
   * to sign in again — it never gets a stale token to try anyway.
   */
  async authorizationFor(sourceId: string, now: number): Promise<string | null> {
    const held = await this.load()
    const one = held.get(sourceId)
    if (!one) return null
    if (one.expiresAt !== null && one.expiresAt <= now) return null
    return `Bearer ${one.access}`
  }

  /** The refresh token, for the one place that trades it for a new access token. */
  async refreshTokenFor(sourceId: string): Promise<string | null> {
    const held = await this.load()
    return held.get(sourceId)?.refresh ?? null
  }

  /** Signing out. The file is rewritten without that source rather than merely marked. */
  async forget(sourceId: string): Promise<boolean> {
    const held = await this.load()
    if (!held.delete(sourceId)) return false
    if (held.size === 0) {
      // Nothing left to keep, so the file goes rather than sitting there as an empty encrypted list.
      await fs.rm(tokenFile(this.userData, this.profileId), { force: true }).catch(() => undefined)
      return true
    }
    return this.save(held)
  }

  async forgetEverything(): Promise<void> {
    this.cache = new Map()
    await fs.rm(tokenFile(this.userData, this.profileId), { force: true }).catch(() => undefined)
  }
}
