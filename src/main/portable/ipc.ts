/**
 * The channels the transfer screen talks to, and the only place this feature touches the real disk.
 *
 * Everything below the IPC layer takes its filesystem as a parameter, which is what lets the exporter and importer
 * be tested against a profile made of a Map. This file is where those parameters get filled in with the actual
 * directories, and where the one thing a renderer must never be handed is kept out of reach.
 *
 * ## What never crosses this boundary
 *
 * The package password. It arrives from the renderer, it is used to derive a key, and it is never stored, never
 * logged and never returned. The content key never leaves this process at all. An error about a wrong password says
 * it was wrong and nothing else — no hint about the right one, no partial match, no timing difference worth having.
 *
 * ## Why the renderer picks the file and this picks the bytes
 *
 * The renderer sends a path chosen from the system dialog. This file reads and writes it. A renderer that could send
 * arbitrary bytes to an arbitrary path would be a way to write anywhere on disk, so the export writes only to the
 * path the dialog returned and the import reads only the file the person chose.
 */

import { profileHandle } from '../ipc/handle.ts'
import { dialog, type BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

import { dataDirFor } from '../../shared/profiles.ts'
import { CATEGORIES, EVERYTHING, EXCLUDED, REGISTRY_ASSUMPTIONS, actionsAfterImport } from '../../shared/portable/registry.ts'
import { MANIFEST_ASSUMPTIONS } from '../../shared/portable/manifest.ts'
import { ZIP_ASSUMPTIONS } from '../../shared/portable/zip.ts'
import { PROTECTION_NOTES } from './encryption.ts'
import {
  estimate,
  exportProfile,
  isExportError,
  needsPassword,
  type ExportDeps,
  type ExportProgress
} from './exporter.ts'
import {
  checkRecovery,
  clearRecovery,
  importPackage,
  inspect,
  isImportError,
  type ImportDeps
} from './importer.ts'
import type { ImportMode } from './providers.ts'

export interface PortableIpcOptions {
  /** The Electron user-data directory. */
  userData: string
  /** The profile the window is showing. */
  profileId(): Promise<string>
  getWindow(): BrowserWindow | null
  appVersion: string
}

/** Progress is pushed rather than polled, because an export of a large profile takes long enough to watch. */
export const PORTABLE_PROGRESS_CHANNEL = 'portable:progress'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const platformOf = (): 'win32' | 'darwin' | 'linux' | 'unknown' =>
  process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux' ? process.platform : 'unknown'

/** Turns a scope into the directory it lives in. */
function rootFor(userData: string, profileId: string, scope: 'profile' | 'app'): string {
  return scope === 'app' ? userData : join(userData, dataDirFor(profileId))
}

/** Lists every file under a storage path, relative to the scope root, with forward slashes. */
async function listUnder(root: string, storagePath: string): Promise<{ path: string; bytes: number; modified: number }[]> {
  const absolute = join(root, storagePath)
  let info
  try {
    info = await stat(absolute)
  } catch {
    return []
  }
  if (info.isFile()) {
    return [{ path: storagePath.replaceAll('\\', '/'), bytes: info.size, modified: info.mtimeMs }]
  }
  if (!info.isDirectory()) return []

  const out: { path: string; bytes: number; modified: number }[] = []
  const walk = async (directory: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const one = await stat(full)
        out.push({ path: relative(root, full).split(sep).join('/'), bytes: one.size, modified: one.mtimeMs })
      } catch {
        // Gone between the listing and the stat. The export records it as unreadable when it comes to read it.
      }
    }
  }
  await walk(absolute)
  return out
}

function exportDeps(o: PortableIpcOptions, profileId: string): ExportDeps {
  return {
    list: async (scope, storagePath) => listUnder(rootFor(o.userData, profileId, scope), storagePath),
    read: async (scope, path) => {
      try {
        return await readFile(join(rootFor(o.userData, profileId, scope), path))
      } catch {
        return null
      }
    },
    write: async (destination, bytes) => {
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, bytes)
    },
    freeSpace: async (destination) => {
      try {
        const info = await statfs(dirname(destination))
        return info.bavail * info.bsize
      } catch {
        return null
      }
    },
    deflateRawSync: (data) => deflateRawSync(data),
    inflateRawSync: (data) => inflateRawSync(data),
    sha256,
    now: () => Date.now(),
    appVersion: o.appVersion,
    platform: platformOf()
  }
}

function importDeps(o: PortableIpcOptions, profileId: string): ImportDeps {
  return {
    read: async (scope, path) => {
      try {
        return await readFile(join(rootFor(o.userData, profileId, scope), path))
      } catch {
        return null
      }
    },
    write: async (scope, path, bytes) => {
      const full = join(rootFor(o.userData, profileId, scope), path)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, bytes)
    },
    remove: async (scope, path) => {
      await rm(join(rootFor(o.userData, profileId, scope), path), { force: true })
    },
    exists: async (scope, path) => {
      try {
        await stat(join(rootFor(o.userData, profileId, scope), path))
        return true
      } catch {
        return false
      }
    },
    inflateRawSync: (data) => inflateRawSync(data),
    sha256,
    now: () => Date.now(),
    appVersion: o.appVersion
  }
}

/** What a transfer screen needs to draw itself, with nothing in it that has to be fetched separately. */
export interface TransferState {
  categories: {
    id: string
    label: string
    describe: string
    portability: string
    sensitivity: string
    canTravel: boolean
    mergeable: boolean
    requiresReauthentication: boolean
    userAction: string | null
    why: string | null
  }[]
  everything: string[]
  excluded: { id: string; label: string; why: string }[]
  protectionNotes: string[]
  assumptions: string[]
}

export function registerPortableIpc(o: PortableIpcOptions): void {
  /** The run in flight, so it can be cancelled and so two cannot overlap. */
  let running: { kind: 'export' | 'import'; cancel: boolean } | null = null

  // A sentence, from `ipc/handle.ts`: never a path from inside the profile and never anything derived from the
  // password. This copy allowed 300 characters, which is long enough to be a path. 200 everywhere now.
  const handle = profileHandle(o)

  const send = (progress: ExportProgress | { stage: string; category: string | null; message: string }): void => {
    o.getWindow()?.webContents.send(PORTABLE_PROGRESS_CHANNEL, progress)
  }

  const text = (value: unknown, max = 4096): string => (typeof value === 'string' ? value.slice(0, max) : '')
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string').slice(0, 200) : []

  /**
   * Where to put the package.
   *
   * The dialog runs here rather than a path arriving from the renderer, which is the difference between writing where
   * the person pointed and writing anywhere a renderer asks for.
   */
  handle('portable:choose-destination', async (_profileId, request) => {
    const one = (request ?? {}) as Record<string, unknown>
    const suggested = (text(one.name, 80) || 'orbis-profile').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
    const win = o.getWindow()
    const options = {
      title: 'Save Orbis profile package',
      defaultPath: `${suggested || 'orbis-profile'}.orbis`,
      filters: [{ name: 'Orbis profile package', extensions: ['orbis'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    return result.canceled || !result.filePath ? { path: null } : { path: result.filePath }
  })

  handle('portable:choose-package', async () => {
    const win = o.getWindow()
    const options = {
      title: 'Open Orbis profile package',
      properties: ['openFile' as const],
      filters: [
        { name: 'Orbis profile package', extensions: ['orbis'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const picked = result.canceled ? null : (result.filePaths[0] ?? null)
    return { path: picked }
  })

  handle('portable:state', (): TransferState => {
    const excludedIds = new Set(EXCLUDED.map((one) => one.id))
    return {
      categories: CATEGORIES.map((one) => ({
        id: one.id,
        label: one.label,
        describe: one.describe,
        portability: one.portability,
        sensitivity: one.sensitivity,
        canTravel: !excludedIds.has(one.id),
        mergeable: one.mergeable,
        requiresReauthentication: one.requiresReauthentication,
        userAction: one.userAction,
        why: one.why
      })),
      everything: [...EVERYTHING],
      excluded: EXCLUDED.map((one) => ({ id: one.id, label: one.label, why: one.why ?? 'Belongs to this machine.' })),
      protectionNotes: [...PROTECTION_NOTES],
      assumptions: [...REGISTRY_ASSUMPTIONS, ...MANIFEST_ASSUMPTIONS, ...ZIP_ASSUMPTIONS]
    }
  })

  handle('portable:needs-password', (_profileId, request) => {
    const one = (request ?? {}) as Record<string, unknown>
    return needsPassword(list(one.categoryIds))
  })

  handle('portable:estimate', async (profileId, request) => {
    const one = (request ?? {}) as Record<string, unknown>
    const result = await estimate(
      {
        profileId,
        profileName: text(one.profileName, 200),
        categoryIds: list(one.categoryIds),
        purpose: 'transfer',
        password: null,
        destination: text(one.destination)
      },
      exportDeps(o, profileId)
    )
    return isExportError(result) ? { error: result.error, message: result.message } : result
  })

  handle('portable:export', async (profileId, request) => {
    if (running !== null) return { error: 'busy', message: `An ${running.kind} is already running. Wait for it to finish or stop it first.` }
    const one = (request ?? {}) as Record<string, unknown>
    running = { kind: 'export', cancel: false }
    try {
      const result = await exportProfile(
        {
          profileId,
          profileName: text(one.profileName, 200),
          categoryIds: list(one.categoryIds),
          purpose: one.purpose === 'backup' || one.purpose === 'snapshot' ? one.purpose : 'transfer',
          // Read, used, and never kept: it is not stored on this object and not returned in any answer.
          password: typeof one.password === 'string' && one.password !== '' ? one.password : null,
          destination: text(one.destination)
        },
        exportDeps(o, profileId),
        {
          shouldCancel: () => running?.cancel === true,
          onProgress: send
        }
      )
      return isExportError(result) ? { error: result.error, message: result.message } : result
    } finally {
      running = null
    }
  })

  handle('portable:inspect', async (profileId, request) => {
    const one = (request ?? {}) as Record<string, unknown>
    const path = text(one.path)
    let bytes: Buffer
    try {
      bytes = await readFile(path)
    } catch (err) {
      return { error: 'unreadable', message: `That file could not be opened: ${err instanceof Error ? err.message : String(err)}` }
    }
    const looked = inspect(bytes, importDeps(o, profileId))
    if (isImportError(looked)) return { error: looked.error, message: looked.message }
    // The protection record is not sent on: the renderer has no use for a wrapped key and no business holding one.
    return {
      manifest: looked.manifest,
      summary: looked.summary,
      compatibility: looked.compatibility,
      encrypted: looked.encrypted,
      blocking: looked.blocking,
      notes: looked.notes,
      sizeBytes: bytes.length
    }
  })

  handle('portable:import', async (profileId, request) => {
    if (running !== null) return { error: 'busy', message: `An ${running.kind} is already running. Wait for it to finish or stop it first.` }
    const one = (request ?? {}) as Record<string, unknown>
    const path = text(one.path)
    let bytes: Buffer
    try {
      bytes = await readFile(path)
    } catch (err) {
      return { error: 'unreadable', message: `That file could not be opened: ${err instanceof Error ? err.message : String(err)}` }
    }
    running = { kind: 'import', cancel: false }
    try {
      const mode: ImportMode = one.mode === 'merge' ? 'merge' : 'replace'
      const result = await importPackage(
        bytes,
        {
          categoryIds: list(one.categoryIds),
          mode,
          password: typeof one.password === 'string' && one.password !== '' ? one.password : null
        },
        importDeps(o, profileId),
        { shouldCancel: () => running?.cancel === true, onProgress: send }
      )
      if (isImportError(result)) return { error: result.error, message: result.message, rolledBack: result.rolledBack ?? null }
      return { ...result, actionsAfterImport: actionsAfterImport(result.categories.filter((c) => c.status === 'applied').map((c) => c.categoryId)) }
    } finally {
      running = null
    }
  })

  handle('portable:cancel', () => {
    if (running === null) return { cancelled: false, message: 'Nothing is running.' }
    running.cancel = true
    return { cancelled: true, message: `Stopping the ${running.kind}.` }
  })

  handle('portable:recovery', async (profileId) => checkRecovery(importDeps(o, profileId)))

  handle('portable:recovery-clear', async (profileId) => {
    await clearRecovery(importDeps(o, profileId))
    return { cleared: true }
  })
}
