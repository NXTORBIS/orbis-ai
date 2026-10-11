import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron'

/**
 * Who is allowed to ask, and what is said back when something goes wrong.
 *
 * Separate from `handle.ts` because nothing here imports Electron at run time -- the two types above are erased --
 * so these two decisions can be tested without starting an application. They are the two that were actually
 * DIFFERENT between the thirteen hand-written copies of this check, which is what makes them worth testing:
 *
 *  - Only one of the thirteen tested `isDestroyed()` before reading `webContents`.
 *  - The cap on a failure message was 160 in one file, 200 in another and 300 in a third, for the same sentence
 *    shown in the same place.
 */

export interface WindowSource {
  getWindow(): BrowserWindow | null
}

/**
 * Whether a message really came from the Orbis window.
 *
 * The destroyed test comes first, and it is not a detail. A `BrowserWindow` that has been closed is still an
 * object, and reading `webContents` from it throws -- so a message arriving while the window is going away would
 * turn a refusal into an uncaught error in the main process, which is the same fault that put "A JavaScript error
 * occurred in the main process" on screen from the permission handlers. Twelve of the thirteen copies were one
 * closing window away from it.
 */
export function fromOrbisWindow(o: WindowSource, event: Pick<IpcMainInvokeEvent | IpcMainEvent, 'sender'>): boolean {
  const win = o.getWindow()
  if (!win || win.isDestroyed()) return false
  return event.sender === win.webContents
}

/** How long a failure message may be before it is replaced with a plain sentence. */
export const MESSAGE_LIMIT = 200

/**
 * What the window is told when a handler throws.
 *
 * A code it can act on and a sentence it can show, and never the underlying message beyond a sensible length --
 * because a long one is almost never a sentence. It is a file path, a provider's URL or a stack, and none of those
 * belong in the window.
 */
export function failureFor(err: unknown): { error: string; message: string } {
  const message = err instanceof Error && err.message.length < MESSAGE_LIMIT ? err.message : 'That did not work.'
  return { error: 'failed', message }
}
