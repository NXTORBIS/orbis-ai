import { profileHandle } from '../ipc/handle.ts'
import type { BrowserWindow } from 'electron'
import type { FeatureVisibilityStore, VisibilityAnswer } from './store.ts'

/**
 * How the Orbis window asks which features it should show, and says one has been switched.
 *
 * Three channels, no more. Everything about *which* features exist, what is essential, what depends on what and what
 * a hidden one is called is shared code (`src/shared/featureVisibility.ts`) and needs no channel at all -- a channel
 * for a computed answer would be a second answer to a question that already has one, and two answers is exactly how
 * the window and the browser drifted nine features apart.
 *
 * Only this file knows about Electron, so the store underneath stays plain code that can be tested without a window
 * and could move to the browser later (`src/main/portability.test.ts` is what keeps that true).
 *
 * Every channel takes `unknown` and checks it, and the profile is read at the moment of the call rather than
 * captured: somebody may switch profile at any time, and a captured id would answer the new profile's question out
 * of the old profile's choices.
 */

export interface FeatureVisibilityIpcOptions {
  store: FeatureVisibilityStore
  profileId(): Promise<string>
  getWindow(): BrowserWindow | null
}

export function registerFeatureVisibilityIpc(o: FeatureVisibilityIpcOptions): void {
  const handle = profileHandle(o)

  /** What this profile has showing, with anything that could not be read said out loud. */
  handle('features:visibility', (): Promise<VisibilityAnswer> => o.store.read())

  /**
   * One switch. The answer is what was really stored, so a screen showing it is showing the truth -- and `refused`
   * set means the save did not happen, however it looked.
   */
  handle('features:set-visible', (_id, feature: unknown, on: unknown): Promise<VisibilityAnswer> => o.store.set(feature, on))

  /** The whole set at once: the picker, and the first-run step. */
  handle('features:choose-visible', (_id, ids: unknown): Promise<VisibilityAnswer> => o.store.choose(ids))
}
