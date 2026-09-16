import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { nullPlatform } from './platform.ts'
import type { SecretStorePort } from './platform'
import { join } from 'node:path'
import { googleProvider } from './auth'
import type { OAuthProvider, SecretStore } from './auth'

// Baked in at build time from ORBIS_GOOGLE_CLIENT_ID / ORBIS_GOOGLE_CLIENT_SECRET (see electron.vite.config.ts).
declare const __ORBIS_GOOGLE__: { clientId: string; clientSecret: string }

/** The sign-in provider this build is set up for, or null when no client ID was provided. */
export function configuredProvider(): OAuthProvider | null {
  const google = typeof __ORBIS_GOOGLE__ === 'undefined' ? null : __ORBIS_GOOGLE__
  return google?.clientId ? googleProvider(google.clientId, google.clientSecret) : null
}

/**
 * The account session, encrypted by the operating system for the signed-in user. When encryption isn't available
 * nothing is written: the session lasts only while Orbis runs.
 */
export function protectedSessionFile(dir: string, secrets: SecretStorePort = nullPlatform().secrets): SecretStore {
  const file = join(dir, 'account-session.bin')
  return {
    async load() {
      try {
        if (!secrets.available()) return null
        return secrets.decrypt(await readFile(file))
      } catch {
        return null
      }
    },
    async save(value) {
      if (!secrets.available()) return false
      await mkdir(dir, { recursive: true })
      const temp = `${file}.tmp`
      await writeFile(temp, secrets.encrypt(value), { mode: 0o600 })
      await rename(temp, file)
      return true
    },
    async clear() {
      await rm(file, { force: true }).catch(() => undefined)
      await rm(`${file}.tmp`, { force: true }).catch(() => undefined)
    }
  }
}
