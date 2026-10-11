import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'

import { failureFor, fromOrbisWindow, type WindowSource } from './senderCheck.ts'

/**
 * The one place a message from the window is checked before anything acts on it.
 *
 * This check was written thirteen times, in thirteen files, with ten different bodies. That is not duplication for
 * its own sake -- it is a **security** check with ten versions, so a correction to it lands in one of thirteen
 * places and no single file tells you whether yours is the good one. The differences were real:
 *
 *  - Only one tested `isDestroyed()` before reading `webContents` (see `senderCheck.ts`).
 *  - The failure message cap was 160, 200 or 300 characters depending on the file.
 *  - One refused by returning `{ error: 'refused' }` and the rest by throwing, so the window had two different
 *    shapes of "no" to handle depending on which feature it had asked.
 *  - The copy actually used in production for the nine `recall:*` channels had **no `try`/`catch` at all**, so a
 *    thrown error reached the renderer raw -- while the careful version beside it, with the catch, was exported and
 *    imported by nothing.
 *
 * One implementation, two shapes. Both come back as a function called `handle`, which matters beyond taste:
 * `ipcMapping.test.ts` finds channels by looking for that literal beside a helper named exactly `handle` with no
 * dot before it. A factory reached as `o.handle(...)` would make every channel in the file invisible to the guard
 * that checks they are all written down -- which is how a hundred and twenty-three of them went missing once
 * already.
 */

export type PlainHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/**
 * Channels that answer for the whole application rather than for one profile.
 *
 * Synchronous and throwing: a refusal is an exception, which `ipcRenderer.invoke` turns into a rejected promise on
 * the other side. Nothing is caught here, so a handler's own error stays the handler's own business.
 */
export function plainHandle(o: WindowSource): (channel: string, handler: PlainHandler) => void {
  return (channel, handler) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!fromOrbisWindow(o, event)) throw new Error('Not allowed.')
      return handler(event, ...args)
    })
  }
}

export interface ProfileHandleOptions extends WindowSource {
  /** Which profile is active, asked at the moment of the call and never captured earlier. */
  profileId(): Promise<string>
  /**
   * Turns a thrown error into an answer, for features whose failures carry a code the window acts on -- a cooldown,
   * a wrong password, a lock that has not cleared yet. Return undefined to fall through to the ordinary shape.
   */
  failure?(err: unknown): unknown
}

export type ProfileHandler = (profileId: string, ...args: unknown[]) => unknown

/**
 * Channels that answer for the active profile.
 *
 * The profile is read at the moment of the call, not once when the handler is registered: somebody may switch
 * profile at any time, and a captured id would answer the new profile's question out of the old profile's data.
 */
export function profileHandle(o: ProfileHandleOptions): (channel: string, run: ProfileHandler) => void {
  return (channel, run) => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!fromOrbisWindow(o, event)) throw new Error('Not allowed.')
      try {
        return await run(await o.profileId(), ...args)
      } catch (err) {
        const own = o.failure?.(err)
        return own === undefined ? failureFor(err) : own
      }
    })
  }
}

export { failureFor, fromOrbisWindow, MESSAGE_LIMIT } from './senderCheck.ts'
export type { WindowSource } from './senderCheck.ts'
