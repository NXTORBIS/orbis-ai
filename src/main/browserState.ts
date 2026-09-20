import { hexOfGroupColor } from './browserGroupColors.ts'
import type { ControlGroup, ControlTab, WindowBrowserState } from '../shared/browserControl.ts'
import type { WindowControl } from './browserControl/window.ts'
import type { ChromiumControl } from './chromium/service.ts'

/** What the app knows about the browser when it is not running: nothing is open. */
export function closedBrowserState(): WindowBrowserState {
  return {
    open: false,
    hidden: false,
    mode: null,
    tabs: [],
    groups: [],
    activeTabId: null,
    previousTabId: null,
    closedTabs: [],
    split: null,
    find: { open: false, text: '', activeMatch: 0, matches: 0 },
    addressBar: { value: '', editing: false, focused: false, suggestions: [] },
    panel: null,
    permissionRequests: [],
    updatedAt: Date.now()
  }
}

/** What the extension knows of each tab beyond the tab list the agent follows, and of the tab groups. */
export interface TabDetails {
  tabs: Record<string, { index: number; pinned: boolean; muted: boolean; audible: boolean; incognito: boolean; loading: boolean; groupId: number }>
  groups: { id: number; title: string; color: string; collapsed: boolean }[]
}

/** Read in the browser's extension worker: the parts of `chrome.tabs` and `chrome.tabGroups` the tab list does not carry. */
export const TAB_DETAILS = `(async () => {
  const tabs = await chrome.tabs.query({});
  const groups = chrome.tabGroups ? await chrome.tabGroups.query({}) : [];
  const byId = {};
  for (const t of tabs) byId[String(t.id)] = { index: t.index, pinned: !!t.pinned, muted: !!(t.mutedInfo && t.mutedInfo.muted), audible: !!t.audible, incognito: !!t.incognito, loading: t.status === 'loading', groupId: typeof t.groupId === 'number' ? t.groupId : -1 };
  return { tabs: byId, groups: groups.map((g) => ({ id: g.id, title: g.title || '', color: g.color, collapsed: !!g.collapsed })) };
})()`

/** Chromium's own tab list, in the shape the control layer, workspaces and workflow triggers read. Only what the browser reports is filled in. */
export function browserStateFrom(pages: { state: { tabs: { id: string; active: boolean; webContentsId?: number; url: string; title: string }[] } }, details?: TabDetails): WindowBrowserState {
  const groupKey = (id: number): string => `g${id}`
  const tabs: ControlTab[] = pages.state.tabs.map((t, position) => {
    const d = details?.tabs[t.id]
    return {
      id: t.id,
      index: d?.index ?? position,
      webContentsId: t.webContentsId ?? null,
      url: t.url,
      title: t.title,
      loading: d?.loading ?? false,
      canGoBack: false,
      canGoForward: false,
      pinned: d?.pinned ?? false,
      private: d?.incognito ?? false,
      muted: d?.muted ?? false,
      audible: d?.audible ?? false,
      groupId: d && d.groupId >= 0 ? groupKey(d.groupId) : null,
      zoom: 1,
      error: null,
      crashed: false,
      active: t.active
    }
  })
  const groups: ControlGroup[] = (details?.groups ?? []).map((g) => ({ id: groupKey(g.id), name: g.title, color: hexOfGroupColor(g.color), collapsed: g.collapsed, tabIds: tabs.filter((t) => t.groupId === groupKey(g.id)).map((t) => t.id) }))
  return { ...closedBrowserState(), open: true, tabs, groups, activeTabId: tabs.find((t) => t.active)?.id ?? null }
}

/**
 * Keeps `windowControl.state` equal to Chromium's real tabs: read when the browser starts and again whenever the browser reports
 * that its tabs changed (its own events, never a timer). Returns what stops following.
 */
export async function followChromiumTabs(service: ChromiumControl, windowControl: WindowControl, onChange: () => void = () => undefined): Promise<() => void> {
  let stopped = false
  let previous: string | null = null
  const publish = async (): Promise<void> => {
    await service.pages.refresh()
    const details = await service.bridge.run<TabDetails>(TAB_DETAILS).catch((): undefined => undefined)
    if (stopped) return
    const next = browserStateFrom(service.pages, details)
    // "The tab I was just using": the tab that was active before this one, if it is still open.
    const before = windowControl.state?.activeTabId
    if (before && next.activeTabId && before !== next.activeTabId && next.tabs.some((t) => t.id === before)) previous = before
    windowControl.setState({ ...next, previousTabId: previous && next.tabs.some((t) => t.id === previous) ? previous : null })
    onChange()
  }
  await publish()
  const stop = await service.bridge.watch(() => void publish())
  return () => {
    stopped = true
    stop()
    windowControl.setState(closedBrowserState())
  }
}
