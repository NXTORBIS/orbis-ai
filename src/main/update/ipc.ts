import type { BrowserWindow } from 'electron'

import { plainHandle } from '../ipc/handle.ts'
import type { UpdateManager } from './manager.ts'

/**
 * What the window asks about updating Orbis.
 *
 * Six channels, and all six go through `updates()` rather than holding the manager: it is built partway through
 * starting up, after these are registered, so a manager captured here would be null for the life of the process
 * and every one of them would answer null for ever. Asked at the moment of the call, "not ready yet" lasts only
 * as long as it is true.
 *
 * Null is the answer while there is no manager, deliberately, rather than an error: on a build with no update
 * endpoint configured there is nothing to say, and a window told "that failed" would show somebody a problem they
 * do not have.
 */

export interface UpdateIpcOptions {
  /** The update manager, or null while there is not one yet. */
  updates(): UpdateManager | null
  getWindow(): BrowserWindow | null
}

export function registerUpdateIpc(o: UpdateIpcOptions): void {
  const handle = plainHandle(o)

  handle('update:status', () => {
    const updates = o.updates()
    return updates ? { status: updates.getStatus(), settings: updates.getSettings(), history: updates.getUpdateHistory() } : null
  })
  handle('update:check', () => o.updates()?.checkForUpdates() ?? null)
  handle('update:download', () => o.updates()?.downloadUpdate() ?? null)
  handle('update:cancel-download', () => {
    const updates = o.updates()
    updates?.cancelDownload()
    return updates?.getStatus() ?? null
  })
  handle('update:restart-and-update', () => o.updates()?.restartAndUpdate() ?? null)
  handle('update:settings', (_event, patch: unknown) =>
    o.updates()?.setSettings((patch ?? {}) as Parameters<UpdateManager['setSettings']>[0]) ?? null
  )
}
