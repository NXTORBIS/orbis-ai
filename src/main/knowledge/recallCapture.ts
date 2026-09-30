import { pageKey, shouldRemember } from '../../shared/recall.ts'
import type { RecallSettings } from '../../shared/recall.ts'

/**
 * Deciding which pages are worth reading into the index, and when.
 *
 * The browser tells Orbis about its tabs every time anything changes -- a new tab, a navigation, a title arriving, a
 * switch between two tabs already open. That is far too often to read a page on, and most of those moments are not
 * somebody reading anything: flicking through six tabs looking for one is six navigations and no reading at all.
 *
 * So this is the judgement in between, kept away from Electron and from SQLite so it can be tested as what it is -- a
 * set of rules about when a page counts as read:
 *
 *  - **Only the tab in front.** A page loading in a background tab is a page nobody has looked at yet.
 *  - **Only once it has been there a while.** A tab has to stay in front for a few seconds before it counts, which is
 *    what separates reading something from passing over it on the way somewhere else.
 *  - **Only once it has finished loading**, because half a page indexed under the whole page's name is worse than
 *    nothing.
 *  - **Not again straight away.** A page already read is left alone for an hour, so sitting on one article all
 *    afternoon is one read rather than hundreds.
 *
 * Everything about *whether a page may be kept at all* -- private tabs, blocked sites, sign-in pages -- belongs to
 * `shouldRemember` in the shared layer and is not repeated here. This file only decides *when to bother looking*.
 */

/** How long a tab must be the one in front before what is on it counts as read. */
export const DWELL_MS = 4_000

/** How long before a page already in the index is worth reading again. */
export const REREAD_AFTER_MS = 60 * 60_000

export interface CaptureTab {
  id: string
  active: boolean
  url: string
  title: string
  loading: boolean
  private: boolean
}

export interface CaptureDecision {
  /** Whether to read this tab's text now. */
  read: boolean
  /** Why not, for the interface that explains why a page is not in somebody's history. */
  reason?: string
}

/**
 * Whether the tab in front is worth reading right now.
 *
 * Pure: it is told the time, when the tab arrived in front and when this page was last indexed, and answers. The caller
 * holds all of that; nothing here reaches for a clock or a database.
 */
export function shouldReadNow(
  tab: CaptureTab | undefined,
  settings: RecallSettings,
  state: { now: number; inFrontSince: number | null; lastIndexedAt: number | null }
): CaptureDecision {
  if (!settings.enabled) return { read: false, reason: 'Page memory is off.' }
  if (!tab) return { read: false, reason: 'No tab in front.' }
  if (!tab.active) return { read: false, reason: 'Not the tab in front.' }
  if (tab.private && settings.skipPrivate) return { read: false, reason: 'Read in a private tab.' }
  if (tab.loading) return { read: false, reason: 'Still loading.' }

  /**
   * The same refusals the store would make, asked before reading rather than after.
   *
   * Reading a page costs a round trip into the browser and up to a hundred thousand characters back, so asking a
   * sign-in page for its text and then throwing the answer away would be the expensive way to decline.
   *
   * The text is not known yet, so it is stood in for by something long enough to pass the length rule -- the real text
   * is checked properly by the store when it arrives.
   */
  const allowed = shouldRemember({ url: tab.url, title: tab.title, text: 'x'.repeat(settings.minChars) }, settings, {
    private: tab.private,
    loading: tab.loading
  })
  if (!allowed.keep) return { read: false, reason: allowed.reason }

  if (state.inFrontSince === null) return { read: false, reason: 'Only just opened.' }
  if (state.now - state.inFrontSince < DWELL_MS) return { read: false, reason: 'Not looked at for long enough yet.' }
  if (state.lastIndexedAt !== null && state.now - state.lastIndexedAt < REREAD_AFTER_MS) {
    return { read: false, reason: 'Already saved recently.' }
  }
  return { read: true }
}

/**
 * Keeps track of which page has been in front and for how long.
 *
 * A small amount of state, and the only state this feature keeps outside the database. It is here rather than inline in
 * the main process so the timing rules can be tested without a browser.
 */
export class FrontTabWatch {
  private key: string | null = null
  private since: number | null = null

  /** Tells the watch what is in front now, and returns how long the current page has been there. */
  saw(tab: CaptureTab | undefined, now: number): number | null {
    if (!tab || !tab.active || !tab.url) {
      this.key = null
      this.since = null
      return null
    }
    /**
     * Keyed by the page rather than by the tab.
     *
     * Navigating a tab to somewhere else starts the clock again, which is right -- the new page has not been read for
     * four seconds just because the tab it is in has been open for four seconds. Switching away and back also starts it
     * again, which is a deliberate simplification: it costs a re-read of something already indexed, and the store
     * refuses that within the hour anyway.
     */
    const key = `${tab.id}:${pageKey(tab.url)}`
    if (key !== this.key) {
      this.key = key
      this.since = now
    }
    return this.since
  }

  /** Forgets what was in front, so the next tab starts its own clock. Used when the browser closes. */
  reset(): void {
    this.key = null
    this.since = null
  }

  get current(): string | null {
    return this.key
  }
}
