/**
 * Two decisions the wiring needs, kept out of it so they can be tested without Electron.
 *
 * `ipc.ts` registers channels, listens to the power monitor and holds a window; none of that runs in a test. What is
 * worth testing is exactly this: which tab a command would act on, and what a single "something changed" from the
 * browser actually means. Both have been the source of the kind of bug where a lock is quietly not applied.
 */

/** A tab as the browser reports it: ids are Chromium's, which are numbers it hands out afresh each run. */
export interface BrowserTabRow {
  id: string
  url: string
  title: string
  active: boolean
}

/**
 * Capabilities that act on every tab at once, where "no tab named" does not mean "the tab in front".
 *
 * These are not refused for a locked tab -- they are redacted, so a locked tab appears as a locked tab rather than the
 * whole listing being withheld. Refusing them would mean one locked tab hid every other tab from Orion, which is worse
 * than useless: it is wrong in a way that looks like a bug rather than like privacy.
 */
export const SWEEPING_CAPABILITIES: ReadonlySet<string> = new Set([
  'tabs.list',
  'tabs.closeOthers',
  'windows.list',
  'session.restore'
])

/**
 * Which tab a command would act on, or null for "whichever is in front".
 *
 * Three ways a capability names a tab, because there are three in the code: `target.tabId`, a `tabId` parameter, and a
 * `tab` parameter. A gate that understood only one of them would be a gate with two ways round it.
 */
export function tabIdFor(
  params: Record<string, unknown>,
  target: { tabId?: string } | undefined
): number | null {
  const raw = target?.tabId ?? params.tabId ?? params.tab
  if (raw === undefined || raw === null || raw === '') return null
  // Deliberately not `Number(raw)` alone: `Number([])` is 0 and `Number(' ')` is 0, and a command that named tab
  // "nothing" must not be treated as naming tab 0 -- which could be a real, unlocked tab.
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  if (typeof raw === 'string' && raw.trim() === '') return null
  const n = typeof raw === 'number' ? raw : Number(raw.trim())
  return Number.isFinite(n) && Number.isInteger(n) ? n : null
}

export interface Reconciled {
  /** Tabs that are new, or have gone somewhere else. The rules get a look at each. */
  moved: { tabId: number; url: string; title: string }[]
  /** Tabs that no longer exist. */
  gone: number[]
  /** The tab in front, if there is one. */
  active: number | null
  /** What to compare against next time. */
  after: Map<number, string>
}

/**
 * What a single "something changed" from the browser actually means.
 *
 * The extension reports one signal for switched, opened, closed and navigated -- so this works out which happened by
 * comparing with what was seen last, rather than asking the browser to tell it four different things. A row whose id is
 * not a number is dropped: an id Orbis cannot match is an id it cannot protect, and pretending otherwise would mean
 * quietly treating an unknown tab as safe.
 */
export function reconcile(before: Map<number, string>, rows: BrowserTabRow[]): Reconciled {
  const after = new Map<number, string>()
  const moved: Reconciled['moved'] = []
  let active: number | null = null

  for (const row of rows) {
    const tabId = Number(row.id)
    if (!Number.isFinite(tabId) || !Number.isInteger(tabId)) continue
    after.set(tabId, row.url)
    if (before.get(tabId) !== row.url) moved.push({ tabId, url: row.url, title: row.title })
    if (row.active) active = tabId
  }

  const gone = [...before.keys()].filter((tabId) => !after.has(tabId))
  return { moved, gone, active, after }
}
