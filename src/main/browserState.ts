import type { ControlTab, WindowBrowserState } from '../shared/browserControl.ts'
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

/** Chromium's own tab list, in the shape the control layer, workspaces and workflow triggers read. Only what the browser reports is filled in. */
export function browserStateFrom(pages: { state: { tabs: { id: string; active: boolean; webContentsId?: number; url: string; title: string }[] } }): WindowBrowserState {
  const tabs: ControlTab[] = pages.state.tabs.map((t, index) => ({
    id: t.id,
    index,
    webContentsId: t.webContentsId ?? null,
    url: t.url,
    title: t.title,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    pinned: false,
    private: false,
    muted: false,
    audible: false,
    groupId: null,
    zoom: 1,
    error: null,
    crashed: false,
    active: t.active
  }))
  return { ...closedBrowserState(), open: true, tabs, activeTabId: tabs.find((t) => t.active)?.id ?? null }
}

/**
 * Keeps `windowControl.state` equal to Chromium's real tabs: read when the browser starts and again whenever the browser reports
 * that its tabs changed (its own events, never a timer). Returns what stops following.
 */
export async function followChromiumTabs(service: ChromiumControl, windowControl: WindowControl, onChange: () => void = () => undefined): Promise<() => void> {
  let stopped = false
  const publish = async (): Promise<void> => {
    await service.pages.refresh()
    if (stopped) return
    windowControl.setState(browserStateFrom(service.pages))
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
