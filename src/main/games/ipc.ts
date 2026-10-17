import type { ArcadeStore } from './arcadeStore.ts'

/**
 * The window's way in to the arcade's scores.
 *
 * Two channels, which is the same shape as each of Chess World's six files: one to read and one to save. Not one
 * channel with a verb -- reading a record and writing one have different answers, and a verb in the payload means
 * one handler deciding which of two rules applies.
 *
 * There is deliberately no channel for the leaderboard, the statistics or "what you play most". Every one of those
 * is worked out from the record in `src/shared/games/arcade.ts`, which the window imports directly: a channel for a
 * figure that is computed from something the window already has would be a second answer to a question that already
 * has one, and the two would disagree the first time a read dropped a row.
 *
 * Only this file knows about Electron, so the store underneath stays plain code that can be tested without a window.
 * The save takes `unknown` and the store checks it against the same reader the file goes through: a renderer is not
 * trusted to send the right shape.
 */
export interface ArcadeIpcOptions {
  store: ArcadeStore
  handle: <A extends unknown[]>(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: A) => unknown) => void
}

export function registerArcadeIpc(o: ArcadeIpcOptions): void {
  const { store, handle } = o

  /** The scores, the runs, the days and the preferences. `refused` set means the file could not be read. */
  handle('arcade:record', () => store.read())

  /**
   * Keeping them.
   *
   * The answer is what was really stored rather than what arrived, and `refused` being set means **nothing was
   * written**. A screen that shows a new best score without looking at `refused` is a screen that lies about saving.
   */
  handle('arcade:save', (_e, record: unknown) => store.save(record))
}
