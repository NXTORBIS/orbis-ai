import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Clock,
  Code,
  Copy,
  Download,
  EllipsisVertical,
  Expand,
  ExternalLink,
  FileCode,
  Globe,
  HatGlasses,
  LoaderCircle,
  MousePointer2,
  PanelRight,
  Pencil,
  PictureInPicture2,
  Plus,
  Printer,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Smartphone,
  Star,
  Trash2,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { NoticeKind } from '../App'
import type { BrowserPermissionRequest, BrowserShortcutEvent, DeviceRequest } from '../../../shared/types'
import BrowserLibraryPanel from './BrowserLibraryPanel'
import type { ClosedTab, LibraryTab } from './BrowserLibraryPanel'
import { copyText, newId } from '../lib/utils'
import { useDismiss } from '../lib/useDismiss'
import { OrbisMark } from './Brand'
import BrowserOrb from './BrowserOrb'
import AdBlockSection from './AdBlockSection'
import type { BrowserOrbProps } from './BrowserOrb'
import type { BrowserMode } from '../lib/browserSize'
import { sameUrl } from '../../../shared/research'
import { toUrl } from '../../../shared/omnibox'
import TabContextMenu, { TabEditDialog } from './TabContextMenu'
import ShortcutsGrid from './ShortcutsGrid'
import WidgetHost, { useWidgets } from './widgets/WidgetHost'
// Only ever seen when a site asks for a device, so it is fetched then rather than at startup.
const DeviceChooser = lazy(() => import('./DeviceChooser'))
import ExtensionsToolbar from './ExtensionsToolbar'
import ExtensionPrompts from './ExtensionPrompts'
import type { ExtensionWindowRequest, ReportedBrowserTab } from '../../../shared/types'
import type { TabGroup, TabMenuAction } from './TabContextMenu'
import { bool, failure, int, num, readResult, reportControlState, str, unverified, useControlRendered, useControlScope, verified, waitUntil } from '../lib/browserControl'
import type { WindowCapability } from '../lib/browserControl'
import type { ControlTab, ControlTarget } from '../../../shared/browserControl'
import { classifyLoadFailure } from '../../../shared/offlineGames'

// The offline page and its games load only when a page first fails for lack of a connection.
const OfflineGames = lazy(() => import('./OfflineGames'))

type Webview = HTMLElement & {
  setAudioMuted(muted: boolean): void
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  reloadIgnoringCache(): void
  stop(): void
  isLoading(): boolean
  print(): Promise<void>
  isDevToolsOpened(): boolean
  closeDevTools(): void
  getURL(): string
  loadURL(url: string): Promise<void>
  setUserAgent(userAgent: string): void
  setZoomFactor(factor: number): void
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean }): number
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  capturePage(): Promise<{ toDataURL(): string; isEmpty(): boolean }>
  openDevTools(): void
  getWebContentsId(): number
}

interface Tab {
  id: string
  url: string
  title: string
  favicon?: string
  loading: boolean
  back: boolean
  forward: boolean
  mobile: boolean
  zoom: number
  error?: string
  /** The last load failed for lack of a connection (not an HTTP error): the offline page shows until a page loads. */
  offline?: { code: number; url: string }
  /** The page's process crashed; reloading starts a fresh page. */
  crashed?: boolean
  /** Bumped to start the tab's page over after a crash. */
  generation: number
  /** Creation order: pages stay in this order in the DOM, since moving a page element would reload it. */
  seq: number
  /** Shown as just its icon, at the front of the tab strip. */
  pinned?: boolean
  groupId?: string
  /** The user's own name and emoji icon for the tab, shown instead of the page's. */
  customTitle?: string
  customIcon?: string
  /** The page is playing sound. */
  audible?: boolean
  /** A private tab: an in-memory session shared by private tabs, no history, wiped when the last one closes. */
  private?: boolean
  /** Muted on its own (an extension's chrome.tabs.update), apart from "Mute site". */
  muted?: boolean
}

interface PickResult {
  tag: string
  text: string
  html: string
  url: string
  title: string
}

interface Props {
  onClose(): void
  onEditScreenshot(src: string, title: string): void
  onNotify(text: string, kind?: NoticeKind): void
  /** A chat request waiting for the tab Orbis should control. */
  agentRequest?: string | null
  onAgentTarget?(requestId: string, webContentsId: number | null): void
  /** Orbis is operating the browser right now. */
  agentActive?: boolean
  onStopAgent?(): void
  /** A running automation's verified progress, shown on the banner. */
  agentStatus?: string
  onPauseAgent?(): void
  /** Reports the active tab's page, so chat requests can refer to it. */
  onPageChange?(page: { tabId: string; url: string; title: string; private?: boolean } | null): void
  /**
   * An address to open, from the URL bar (the active tab) or a link or research source (a new tab, or the tab already
   * showing it); `more` opens further pages as background tabs. A new id means a new request.
   */
  navigation?: { url: string; id: number; newTab?: boolean; more?: string[] } | null
  /** The floating Orbis assistant shown over the page. */
  orb?: BrowserOrbProps
  /** Full page over the content area, a sized window, or docked beside the chat. */
  mode: BrowserMode
  onModeChange(mode: BrowserMode): void
  /** The window's size in window mode. */
  windowSize: { width: number; height: number }
  /** Called while the window is being resized, and once more with `final` when the drag ends. */
  onWindowResize(width: number, height: number, final: boolean): void
  /** Back at the chat: the browser keeps its tabs and pages, just out of sight. */
  hidden?: boolean
  onBackToChat(): void
  /** Reports whether the active tab's page is loading, for the URL bar. */
  onLoadingChange?(loading: boolean): void
  /** Opens one of Orbis's own panels (notes, tasks, clipboard, whiteboard, workspaces), asked for by a widget. */
  onOpenOrbisView?(name: string): void
}

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
// Some sites (Google included) serve a degraded page to user agents that mention Electron.
const DESKTOP_UA = navigator.userAgent.replace(/\s(Electron|nxtorbis-ai|Orbis)\/\S+/gi, '')
const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
const QUICK_LINKS = [
  { label: 'Google', url: 'https://www.google.com' },
  { label: 'YouTube', url: 'https://www.youtube.com' },
  { label: 'GitHub', url: 'https://github.com' },
  { label: 'Wikipedia', url: 'https://www.wikipedia.org' }
]
/** Google's page for sign-ins it refuses in embedded browsers. */
const GOOGLE_SIGNIN_REJECTED = /^https:\/\/accounts\.google\.com\/(?:[^?#]*\/)?(?:signin\/)?rejected/i
const GOOGLE_SIGNIN_URL = 'https://accounts.google.com/'
// Webviews only honour allowpopups when it's present at attach time, and React's typings want a boolean.
const POPUPS = { allowpopups: 'true' } as object

const PICK_SCRIPT = `new Promise((resolve) => {
  const box = document.createElement('div')
  Object.assign(box.style, { position: 'fixed', zIndex: '2147483647', pointerEvents: 'none', border: '2px solid #3fd8ff', background: 'rgba(63,216,255,0.14)', borderRadius: '4px', boxShadow: '0 0 0 1px rgba(0,0,0,0.25)' })
  document.documentElement.appendChild(box)
  let current = null
  const move = (e) => { current = e.target; const r = current.getBoundingClientRect(); Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }) }
  const done = (value) => { document.removeEventListener('mousemove', move, true); document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true); box.remove(); delete window.__orbisCancelPick; resolve(value) }
  const click = (e) => { e.preventDefault(); e.stopPropagation(); const el = current || e.target; done({ tag: el.tagName.toLowerCase(), text: (el.innerText || el.getAttribute('alt') || el.getAttribute('aria-label') || '').trim().slice(0, 2000), html: el.outerHTML.slice(0, 1500), url: location.href, title: document.title }) }
  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null) } }
  window.__orbisCancelPick = () => done(null)
  document.addEventListener('mousemove', move, true)
  document.addEventListener('click', click, true)
  document.addEventListener('keydown', key, true)
})`

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable; the panel just won't remember this.
  }
}

/** Moves focus to the URL bar above the header, the browser's single address bar. */
const focusUrlBar = (): void => void window.dispatchEvent(new Event('orbis:focus-url'))

let tabSeq = 0
const createTab = (url = '', isPrivate = false): Tab => ({
  id: newId(),
  url,
  title: url || (isPrivate ? 'Private tab' : 'New tab'),
  loading: Boolean(url),
  back: false,
  forward: false,
  mobile: false,
  zoom: 1,
  generation: 0,
  seq: tabSeq++,
  ...(isPrivate ? { private: true } : {})
})

/** The in-memory session private tabs share; main allows only this and the saved browser session. */
const PRIVATE_PARTITION = 'orbis-private'

const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url)
const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

const SESSION_KEY = 'orbis.browser.session'

/** Each profile remembers its own pages and groups; the first profile keeps the keys Orbis has always used. */
const keyFor = (base: string, profileId: string): string => (profileId === 'default' ? base : `${base}.${profileId}`)
const ZOOM_KEY = 'orbis.browser.zoom'

/** Zoom is remembered per site, like other browsers. */
function storedZoom(url: string): number {
  const host = hostOf(url)
  if (!host) return 1
  try {
    const zoom = (JSON.parse(stored(ZOOM_KEY) ?? '{}') as Record<string, unknown>)[host]
    return typeof zoom === 'number' && zoom >= 0.25 && zoom <= 5 ? zoom : 1
  } catch {
    return 1
  }
}

function storeZoom(url: string, zoom: number): void {
  const host = hostOf(url)
  if (!host) return
  let map: Record<string, number> = {}
  try {
    map = JSON.parse(stored(ZOOM_KEY) ?? '{}') as Record<string, number>
  } catch {
    map = {}
  }
  if (Math.abs(zoom - 1) < 0.001) delete map[host]
  else map[host] = zoom
  store(ZOOM_KEY, JSON.stringify(map))
}

const GROUPS_KEY = 'orbis.browser.groups'

/** The tab groups open last time, by the pages in them, so restoring the session brings the groups back too. */
function lastSessionGroups(): { name: string; color: string; collapsed: boolean; urls: string[] }[] {
  try {
    const groups: unknown = JSON.parse(stored(GROUPS_KEY) ?? '[]')
    return Array.isArray(groups)
      ? groups
          .filter((g): g is { name: string; color: string; collapsed?: boolean; urls: string[] } => Boolean(g) && typeof g.name === 'string' && typeof g.color === 'string' && Array.isArray(g.urls))
          .map((g) => ({ name: g.name.slice(0, 40), color: g.color, collapsed: g.collapsed === true, urls: g.urls.filter((u) => typeof u === 'string' && isWebUrl(u)) }))
      : []
  } catch {
    return []
  }
}

function lastSessionUrls(): string[] {
  try {
    const urls: unknown = JSON.parse(stored(SESSION_KEY) ?? '[]')
    return Array.isArray(urls) ? urls.filter((u): u is string => typeof u === 'string' && isWebUrl(u)).slice(0, 20) : []
  } catch {
    return []
  }
}

export default function BrowserPanel({
  onClose,
  onEditScreenshot,
  onNotify,
  agentRequest,
  onAgentTarget,
  agentActive,
  onStopAgent,
  agentStatus,
  onPauseAgent,
  onPageChange,
  navigation,
  orb,
  mode,
  onModeChange,
  windowSize,
  onWindowResize,
  hidden,
  onBackToChat,
  onLoadingChange,
  onOpenOrbisView
}: Props): React.JSX.Element {
  const widgets = useWidgets()
  const [firstTab] = useState(createTab)
  const [tabs, setTabs] = useState<Tab[]>([firstTab])
  const [activeId, setActiveId] = useState(firstTab.id)
  /** The mode Exit full page returns to. */
  const restoreMode = useRef<BrowserMode>(mode === 'full' ? 'window' : mode)
  /** The last navigation request handled; an empty tab about to load one shouldn't pull focus to the URL bar. */
  const handledNavigation = useRef<number | undefined>(undefined)
  const [width, setWidth] = useState(() => Number(stored('orbis.browser.width')) || 560)
  const [resizing, setResizing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [findResult, setFindResult] = useState<{ active: number; total: number } | null>(null)
  const [picking, setPicking] = useState(false)
  /** An ad redirect ad blocking stopped in a tab, offered to open anyway. */
  const [blockedNav, setBlockedNav] = useState<{ tabId: string; url: string; reason: string } | null>(null)
  /** Tabs closed in this session, newest last, for Ctrl+Shift+T and the library. */
  const [closedTabs, setClosedTabs] = useState<ClosedTab[]>([])
  const [library, setLibrary] = useState<LibraryTab | null>(null)
  /** Sites waiting for an answer to a permission request, oldest first. */
  const [permissions, setPermissions] = useState<BrowserPermissionRequest[]>([])
  const [deviceRequest, setDeviceRequest] = useState<DeviceRequest | null>(null)
  const [rememberPermission, setRememberPermission] = useState(false)
  /** A page went fullscreen (a video, say): the page fills the window. */
  const [htmlFullscreen, setHtmlFullscreen] = useState(false)
  /** The web pages open when the browser was last used, offered on the new tab page. */
  const [lastSession, setLastSession] = useState(lastSessionUrls)
  /** The mode to return to when F11 fullscreen ends. */
  const fullscreenRestore = useRef<BrowserMode | null>(null)
  /** The Orbis window is fullscreen (F11). With the browser at full page, the tab bar and address bar tuck away above the top edge. */
  const [windowFullscreen, setWindowFullscreen] = useState(false)
  /** The pointer reached the very top edge: the tucked-away tab bar and address bar are showing. */
  const [tabsRevealed, setTabsRevealed] = useState(false)
  /** When the bars were last revealed: page pointer reports still in flight from before don't hide them straight away. */
  const revealedAt = useRef(0)
  const dragTab = useRef<string | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const onNotifyRef = useRef(onNotify)
  onNotifyRef.current = onNotify
  const views = useRef(new Map<string, Webview>())
  const findRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useDismiss(menuRef, menuOpen, () => setMenuOpen(false))

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]
  const view = (): Webview | undefined => views.current.get(active.id)
  const hasPage = Boolean(active.url)

  const patch = useCallback((id: string, changes: Partial<Tab>) => {
    setTabs((list) => list.map((t) => (t.id === id ? { ...t, ...changes } : t)))
  }, [])

  /** Adds a tab (at the end, or at an index, pinned tabs staying in front) and returns it. Every way of opening a tab uses this. */
  /**
   * The tabs as they stand, including changes made earlier in this same turn. Opening and closing several tabs at once
   * (restoring a workspace, say) must build on each other rather than each starting from what the last render saw.
   */
  const tabsRef = useRef<Tab[]>(tabs)
  tabsRef.current = tabs
  const applyTabs = useCallback((change: (list: Tab[]) => Tab[]): Tab[] => {
    const next = change(tabsRef.current)
    tabsRef.current = next
    setTabs(next)
    return next
  }, [])

  /**
   * The profile in use. Its partition is what ordinary tabs browse in, so cookies and logins are separate per profile;
   * private tabs always use the private session. When the profile changes, its own pages are put back.
   */
  const [profile, setProfile] = useState<{ id: string; partition: string }>({ id: 'default', partition: 'persist:browser' })
  const profileRef = useRef('default')
  profileRef.current = profile.id

  const addTab = useCallback(
    (url: string, options: { activate?: boolean; private?: boolean; index?: number; pinned?: boolean } = {}): Tab => {
      const tab: Tab = { ...createTab(url, options.private === true), ...(options.pinned ? { pinned: true } : {}) }
      applyTabs((list) => {
        const next = [...list]
        const pinnedCount = list.filter((t) => t.pinned).length
        const at = typeof options.index === 'number' ? Math.max(options.pinned ? 0 : pinnedCount, Math.min(options.index, next.length)) : next.length
        next.splice(at, 0, tab)
        return next
      })
      if (options.activate !== false) setActiveId(tab.id)
      return tab
    },
    [applyTabs]
  )

  const openTab = useCallback((url = '', activate = true, isPrivate = false) => void addTab(url, { activate, private: isPrivate }), [addTab])

  useEffect(() => {
    void window.api.listProfiles().then(({ activeId, partition }) => setProfile({ id: activeId, partition }))
    return window.api.onProfileChanged((change) => {
      setProfile({ id: change.profile.id, partition: change.partition })
      // The pages of the profile being left stay with it; the new profile's own pages come back.
      const saved: string[] = (() => {
        try {
          const raw: unknown = JSON.parse(stored(keyFor(SESSION_KEY, change.profile.id)) ?? '[]')
          return Array.isArray(raw) ? raw.filter((url): url is string => typeof url === 'string' && isWebUrl(url)).slice(0, 20) : []
        } catch {
          return []
        }
      })()
      const fresh = saved.length ? saved.map((url) => createTab(url)) : [createTab('')]
      setGroups([])
      setSplit(null)
      applyTabs(() => fresh)
      setActiveId(fresh[0].id)
    })
  }, [applyTabs])

  useEffect(() => store('orbis.browser.width', String(width)), [width])
  // Ctrl+click and middle-click open links in the background; other links and "Open link in new tab" switch to them.
  useEffect(() => window.api.onBrowserNewTab((url, options) => openTab(url, !options.background)), [openTab])

  // The open web pages, so they can be restored next time.
  const tabUrls = tabs.filter((t) => !t.private).map((t) => t.url).filter(isWebUrl)
  const tabUrlsKey = tabUrls.join('\n')
  useEffect(() => {
    if (tabUrls.length) store(keyFor(SESSION_KEY, profileRef.current), JSON.stringify(tabUrls.slice(0, 20)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabUrlsKey])

  // Closing the last private tab (or the browser, with private tabs open) wipes their in-memory session.
  // The window's real fullscreen state from the main process (a maximized window the size of the screen isn't fullscreen).
  useEffect(() => {
    void window.api.isWindowFullscreen().then(setWindowFullscreen)
    return window.api.onWindowFullscreen(setWindowFullscreen)
  }, [])

  // Immersive (fullscreen at full page): the bars slide back up once the pointer is over the page again or the page is
  // clicked, unless the address bar is being typed in or a menu is open.
  useEffect(() => {
    const root = document.documentElement
    if (!(windowFullscreen && mode === 'full' && !hidden && !htmlFullscreen)) {
      delete root.dataset.browserImmersive
      setTabsRevealed(false)
      return
    }
    root.dataset.browserImmersive = ''
    const busy = (): boolean => 'dropdownOpen' in root.dataset || Boolean(document.querySelector('.url-strip:focus-within'))
    const inBars = (target: EventTarget | null): boolean => target instanceof Element && Boolean(target.closest('.browser-tabs-row, .url-strip, .browser-tab-reveal, .popover'))
    // The bars cover the top 72px once shown; while they slide in, the pointer at the top edge can briefly be over the
    // page, which must not hide them again.
    const onOver = (e: MouseEvent): void => {
      if (e.clientY > 76 && !inBars(e.target) && !busy()) setTabsRevealed(false)
    }
    const onFocusOut = (): void => {
      window.setTimeout(() => {
        if (!busy() && !document.querySelector('.browser-tabs-row:hover, .url-strip:hover')) setTabsRevealed(false)
      }, 0)
    }
    // Moving from the bars onto the page: the page (a separate view) takes the pointer, so the window's document hears
    // nothing more; the bars themselves still get mouseleave, which is what tucks them away.
    const onLeaveBars = (e: MouseEvent): void => {
      if (e.clientY <= 76 || busy()) return
      window.setTimeout(() => {
        if (!busy() && !document.querySelector('.browser-tabs-row:hover, .url-strip:hover, .popover:hover')) setTabsRevealed(false)
      }, 0)
    }
    const bars = [...document.querySelectorAll<HTMLElement>('.browser-tabs-row, .url-strip')]
    for (const bar of bars) bar.addEventListener('mouseleave', onLeaveBars)
    document.addEventListener('mouseover', onOver)
    document.addEventListener('focusout', onFocusOut)
    const stopPagePointer = window.api.onPagePointer(() => {
      if (!('dropdownOpen' in root.dataset)) setTabsRevealed(false)
    })
    // The pointer moved inside the page itself: it has left the bars.
    const stopPageMove = window.api.onPagePointerMove(() => {
      if (!busy() && Date.now() - revealedAt.current > 500) setTabsRevealed(false)
    })
    return () => {
      stopPageMove()
      for (const bar of bars) bar.removeEventListener('mouseleave', onLeaveBars)
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('focusout', onFocusOut)
      stopPagePointer()
      delete root.dataset.browserImmersive
    }
  }, [windowFullscreen, mode, hidden, htmlFullscreen])

  useEffect(() => {
    const root = document.documentElement
    if (tabsRevealed) root.dataset.tabsRevealed = ''
    else delete root.dataset.tabsRevealed
    // Page pointer movement is only needed (and only sent) while the bars are showing.
    window.api.watchPagePointerMoves(tabsRevealed)
    return () => {
      delete root.dataset.tabsRevealed
      window.api.watchPagePointerMoves(false)
    }
  }, [tabsRevealed])

  // The address bar's Summarize button reads the active tab's page as rendered, so signed-in and private pages work too.
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => {
    const onRead = (e: Event): void => {
      const { resolve } = (e as CustomEvent<{ resolve(page: { title: string; text: string } | null): void }>).detail
      const tab = activeRef.current
      const webview = views.current.get(tab.id)
      if (!webview || !tab.url) return resolve(null)
      webview
        .executeJavaScript(
          `(() => {
            const main = document.querySelector('main, article, [role="main"]');
            const root = main && main.innerText.trim().length > 400 ? main : document.body;
            const text = ((root && root.innerText) || '').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
            return { title: document.title, text: text.slice(0, 16000) };
          })()`
        )
        .then((page) => resolve(page as { title: string; text: string }), () => resolve(null))
    }
    window.addEventListener('orbis:read-page', onRead)
    return () => window.removeEventListener('orbis:read-page', onRead)
  }, [])

  /** chrome.action.openPopup from an extension: the toolbar opens that extension's popup. */
  const [extensionPopup, setExtensionPopup] = useState<string | null>(null)

  const extensionRequest = useRef<(request: ExtensionWindowRequest) => Promise<number | null>>(async () => null)
  extensionRequest.current = async (request) => {
    const byPage = (pageId: number): Tab | undefined =>
      tabs.find((t) => {
        try {
          return views.current.get(t.id)?.getWebContentsId() === pageId
        } catch {
          return false
        }
      })
    switch (request.kind) {
      case 'create-tab': {
        const tab = addTab(request.url ?? '', { activate: request.active, index: request.index, pinned: request.pinned })
        if (!request.url) return null
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 100))
          try {
            const id = views.current.get(tab.id)?.getWebContentsId()
            if (id) return id
          } catch {
            // Not attached yet.
          }
        }
        return null
      }
      case 'update-tab': {
        const tab = byPage(request.tabId)
        if (!tab) return null
        if (request.url) navigate(request.url, tab.id)
        if (request.active) setActiveId(tab.id)
        if (typeof request.pinned === 'boolean' && Boolean(tab.pinned) !== request.pinned) tabAction(tab.id, { type: 'pin' })
        if (typeof request.muted === 'boolean') patch(tab.id, { muted: request.muted })
        return request.tabId
      }
      case 'remove-tabs':
        closeTabs(request.tabIds.map(byPage).filter((t): t is Tab => Boolean(t)).map((t) => t.id))
        return null
      case 'move-tab': {
        const tab = byPage(request.tabId)
        if (tab) moveTab(tab.id, Math.max(0, Math.min(request.index, tabs.length - 1)))
        return null
      }
      case 'open-popup':
        setExtensionPopup(request.extensionId)
        return null
    }
  }
  useEffect(
    () =>
      window.api.onExtensionWindowRequest(({ requestId, request }) => {
        void extensionRequest.current(request).then(
          (result) => window.api.answerExtensionWindowRequest(requestId, result),
          () => window.api.answerExtensionWindowRequest(requestId, null)
        )
      }),
    []
  )

  const hasPrivate = tabs.some((t) => t.private)
  const hadPrivate = useRef(false)
  useEffect(() => {
    if (hadPrivate.current && !hasPrivate) void window.api.clearPrivateBrowsing()
    hadPrivate.current = hasPrivate
  }, [hasPrivate])
  useEffect(
    () => () => {
      if (hadPrivate.current) void window.api.clearPrivateBrowsing()
    },
    []
  )

  // Shortcuts apply only while the browser or its URL bar has focus, so Orion's chat and the rest of Orbis keep their keys.
  useEffect(() => {
    let timer = 0
    const report = (): void => {
      const el = document.activeElement
      const focused = !hidden && el !== null && el !== document.body && (Boolean(sectionRef.current?.contains(el)) || Boolean(el.closest('.url-strip')))
      window.api.setBrowserFocus(focused)
    }
    const later = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(report, 0)
    }
    report()
    document.addEventListener('focusin', report)
    document.addEventListener('focusout', later)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('focusin', report)
      document.removeEventListener('focusout', later)
      window.api.setBrowserFocus(false)
    }
  }, [hidden])

  // A site asking to use a device it can see. A second request while one is open replaces it, which is how Bluetooth
  // arrives: Chromium asks again each time it finds another device.
  useEffect(() => {
    const off = window.api.onDeviceRequest((request) => setDeviceRequest(request))
    const offAnswered = window.api.onDeviceAnswered((id) => setDeviceRequest((current) => (current?.id === id ? null : current)))
    return () => {
      off()
      offAnswered()
    }
  }, [])

  useEffect(
    () =>
      window.api.onBrowserPermission((request) => {
        setPermissions((list) => [...list, request])
        // The main process declines requests nobody answers after two minutes.
        window.setTimeout(() => setPermissions((list) => list.filter((r) => r.id !== request.id)), 120_000)
      }),
    []
  )

  useEffect(
    () =>
      window.api.onBrowserDownload(({ type, download }) => {
        if (type === 'started') onNotifyRef.current(`Downloading ${download.filename}. Ctrl+J shows downloads.`)
        else if (download.state === 'completed') onNotifyRef.current(`Downloaded ${download.filename} to your Downloads folder.`)
        else if (download.state === 'interrupted') onNotifyRef.current(`Couldn't finish downloading ${download.filename}.`, 'warn')
      }),
    []
  )

  useEffect(
    () =>
      window.api.onAdBlockEvent((event) => {
        if (event.type !== 'navigation-blocked') return
        const tab = [...views.current.entries()].find(([, webview]) => {
          try {
            return webview.getWebContentsId() === event.webContentsId
          } catch {
            return false
          }
        })
        if (tab) setBlockedNav({ tabId: tab[0], url: event.url, reason: event.reason })
      }),
    []
  )

  // The URL bar above the header is the browser's only address bar: it shows this tab's page and its loading state.
  useEffect(() => {
    onLoadingChange?.(Boolean(active.url) && active.loading)
  }, [active.url, active.loading, onLoadingChange])

  useEffect(() => {
    if (!active.url && !hidden && navigation?.id === handledNavigation.current) requestAnimationFrame(focusUrlBar)
    setPicking(false)
    setFindResult(null)
  }, [active.id, active.url])

  const registerView = useCallback((id: string, webview: Webview | null) => {
    if (webview) views.current.set(id, webview)
    else views.current.delete(id)
  }, [])

  const onFound = useCallback(
    (id: string, result: { activeMatchOrdinal: number; matches: number }) => {
      if (id === activeId) setFindResult({ active: result.activeMatchOrdinal, total: result.matches })
    },
    [activeId]
  )

  const navigate = (input: string, tabId = active.id): void => {
    if (!input.trim()) return
    const url = toUrl(input)
    const webview = views.current.get(tabId)
    if (webview) {
      patch(tabId, { error: undefined })
      try {
        void webview.loadURL(url).catch(() => undefined)
        return
      } catch {
        // The view is on screen but not ready yet (a tab that has only just appeared, after a profile switch say):
        // the address goes on the tab instead, and the view loads it as soon as it is.
      }
    }
    patch(tabId, { url, title: url, loading: true, error: undefined })
  }

  useEffect(() => {
    // Sent for blank tabs too (with an empty url), so the address bar can keep each tab's typed text apart.
    onPageChange?.({ tabId: active.id, url: active.url, title: active.title, ...(active.private ? { private: true } : {}) })
  }, [active.id, active.url, active.title, active.private, onPageChange])

  // Addresses typed in the URL bar open in the active tab. Links and sources open beside it, reusing a tab already showing
  // the page, so opening a source never loses the page the user was on.
  useEffect(() => {
    if (!navigation) return
    handledNavigation.current = navigation.id
    const known = (input: string): Tab | undefined => tabs.find((t) => t.url && sameUrl(t.url, toUrl(input)))
    const first = known(navigation.url)
    if (first) setActiveId(first.id)
    else if (navigation.newTab && active.url) openTab(toUrl(navigation.url))
    else navigate(navigation.url)
    for (const extra of navigation.more ?? []) if (!known(extra) && !sameUrl(toUrl(extra), toUrl(navigation.url))) openTab(toUrl(extra), false)
    // Only a new request (new id) navigates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation?.id])

  // Hands the active tab to Orbis. An empty tab starts on Google so there is a page to work in.
  useEffect(() => {
    if (!agentRequest) return
    let cancelled = false
    const tabId = active.id
    if (!active.url) navigate('https://www.google.com', tabId)
    const started = Date.now()
    const poll = (): void => {
      if (cancelled) return
      let id: number | null = null
      try {
        // Throws until the tab's page has attached.
        id = views.current.get(tabId)?.getWebContentsId() ?? null
      } catch {
        id = null
      }
      if (id !== null) return onAgentTarget?.(agentRequest, id)
      if (Date.now() - started > 15_000) return onAgentTarget?.(agentRequest, null)
      window.setTimeout(poll, 150)
    }
    poll()
    return () => {
      cancelled = true
    }
    // Only a new request should start a hand-over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentRequest])

  /** Switches to a tab and puts the keyboard in it: its page, or the URL bar for a new tab. */
  const focusTab = (tab: Tab | undefined): void => {
    if (!tab) return
    setActiveId(tab.id)
    requestAnimationFrame(() => (tab.url ? views.current.get(tab.id)?.focus() : focusUrlBar()))
  }

  const closeTab = (id: string): void => {
    const index = tabs.findIndex((t) => t.id === id)
    const closing = tabs[index]
    if (closing?.url && !closing.private) setClosedTabs((list) => [...list, { url: closing.url, title: closing.title, index }].slice(-25))
    const rest = tabs.filter((t) => t.id !== id)
    if (!rest.length) return onClose()
    setTabs(rest)
    if (id === activeId) focusTab(rest[Math.min(index, rest.length - 1)])
  }

  /** Reopens a closed tab where it was; without a position, the most recently closed. */
  const reopenTab = (position = closedTabs.length - 1): void => {
    const closed = closedTabs[position]
    if (!closed) return
    setClosedTabs((list) => list.filter((_, i) => i !== position))
    const tab = { ...createTab(closed.url), title: closed.title || closed.url }
    setTabs((list) => {
      const next = [...list]
      next.splice(Math.min(closed.index, next.length), 0, tab)
      return next
    })
    focusTab(tab)
  }

  const moveTab = (id: string, to: number): void => {
    setTabs((list) => {
      const from = list.findIndex((t) => t.id === id)
      if (from < 0 || to < 0 || to >= list.length || from === to) return list
      const next = [...list]
      const [tab] = next.splice(from, 1)
      next.splice(to, 0, tab)
      return next
    })
  }

  const [groups, setGroups] = useState<TabGroup[]>([])
  /** Two tabs shown side by side. */
  const [split, setSplit] = useState<{ left: string; right: string } | null>(null)
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [editTab, setEditTab] = useState<{ id: string; x: number; y: number } | null>(null)
  /** Sites muted with "Mute site": every tab on them is silent. */
  const [mutedHosts, setMutedHosts] = useState<string[]>([])
  const [bookmarkUrls, setBookmarkUrls] = useState<string[]>([])

  /** The tab that was active before the current one ("the tab I was just using"). */
  const previousTab = useRef<string | null>(null)
  const lastActive = useRef(activeId)
  useEffect(() => {
    if (lastActive.current === activeId) return
    previousTab.current = lastActive.current
    lastActive.current = activeId
  }, [activeId])

  // The open groups are saved with the session (by their pages), so restoring it brings them back.
  const groupsKey = JSON.stringify(groups.map((g) => [g.name, g.color, g.collapsed, tabs.filter((t) => t.groupId === g.id && !t.private && isWebUrl(t.url)).map((t) => t.url)]))
  useEffect(() => {
    if (!tabUrls.length) return
    store(keyFor(GROUPS_KEY, profileRef.current), JSON.stringify(groups.map((g) => ({ name: g.name, color: g.color, collapsed: Boolean(g.collapsed), urls: tabs.filter((t) => t.groupId === g.id && !t.private && isWebUrl(t.url)).map((t) => t.url) })).filter((g) => g.urls.length)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsKey])

  // Chrome extensions and the Browser Control Layer see Orbis's tabs; extensions don't see private tabs (they can't run
  // in their in-memory session). A tab's page id is its WebContents id, known once the page has attached. Reported
  // whenever the tabs change, never on a timer (except a short retry while a page is still attaching).
  useEffect(() => {
    let timer = 0
    const report = (): void => {
      const visible: ReportedBrowserTab[] = []
      const controlTabs: ControlTab[] = []
      let pending = false
      tabs.forEach((tab, index) => {
        let id: number | null = null
        try {
          id = views.current.get(tab.id)?.getWebContentsId() ?? null
        } catch {
          id = null
        }
        if (tab.url && id === null) pending = true
        const muted = Boolean(tab.muted) || mutedHosts.includes(hostOf(tab.url))
        controlTabs.push({
          id: tab.id,
          index,
          webContentsId: id,
          url: tab.url,
          title: tab.customTitle || tab.title,
          loading: Boolean(tab.url) && tab.loading,
          canGoBack: tab.back,
          canGoForward: tab.forward,
          pinned: Boolean(tab.pinned),
          private: Boolean(tab.private),
          muted,
          audible: Boolean(tab.audible),
          groupId: tab.groupId ?? null,
          zoom: tab.zoom,
          error: tab.error ?? null,
          crashed: Boolean(tab.crashed),
          active: tab.id === activeId
        })
        if (tab.private || !tab.url || id === null) return
        visible.push({
          id,
          index: visible.length,
          url: tab.url,
          title: tab.customTitle || tab.title,
          ...(tab.favicon ? { favIconUrl: tab.favicon } : {}),
          active: tab.id === activeId,
          pinned: Boolean(tab.pinned),
          audible: Boolean(tab.audible),
          muted,
          loading: tab.loading
        })
      })
      window.api.reportBrowserTabs(visible)
      reportControlState({
        open: true,
        tabs: controlTabs,
        activeTabId: activeId,
        previousTabId: previousTab.current,
        groups: groups.map((g) => ({ id: g.id, name: g.name, color: g.color, collapsed: Boolean(g.collapsed), tabIds: tabs.filter((t) => t.groupId === g.id).map((t) => t.id) })),
        closedTabs,
        split,
        find: { open: findOpen, text: findText, activeMatch: findResult?.active ?? 0, matches: findResult?.total ?? 0 },
        panel: library,
        permissionRequests: permissions.map(({ id, origin, permission, label }) => ({ id, origin, permission, label }))
      })
      if (pending) timer = window.setTimeout(report, 400)
    }
    report()
    return () => window.clearTimeout(timer)
  }, [tabs, activeId, mutedHosts, groups, closedTabs, split, findOpen, findText, findResult, library, permissions])
  useEffect(
    () => () => {
      window.api.reportBrowserTabs([])
      reportControlState({ open: false, tabs: [], groups: [], activeTabId: null, previousTabId: null, closedTabs: [], split: null, find: { open: false, text: '', activeMatch: 0, matches: 0 }, panel: null, permissionRequests: [] })
    },
    []
  )
  // A site's request answered elsewhere (through the control layer) leaves the prompt too.
  useEffect(() => window.api.onBrowserPermissionAnswered((id) => setPermissions((list) => list.filter((r) => r.id !== id))), [])

  useEffect(() => {
    const take = (library: { bookmarks: { url: string }[] }): void => setBookmarkUrls(library.bookmarks.map((b) => b.url))
    void window.api.getBrowserLibrary().then(take)
    return window.api.onBrowserLibrary(take)
  }, [])

  // Split view ends when one of its tabs closes or a tab outside it is chosen; empty groups disappear.
  useEffect(() => {
    if (split && (![split.left, split.right].includes(activeId) || !tabs.some((t) => t.id === split.left) || !tabs.some((t) => t.id === split.right))) setSplit(null)
    setGroups((list) => (list.every((g) => tabs.some((t) => t.groupId === g.id)) ? list : list.filter((g) => tabs.some((t) => t.groupId === g.id))))
  }, [tabs, activeId, split])

  const closeTabs = (ids: string[]): void => {
    const closing = new Set(ids)
    if (!closing.size) return
    const current = tabsRef.current
    const closedNow = current.flatMap((t, index) => (closing.has(t.id) && t.url && !t.private ? [{ url: t.url, title: t.title, index }] : []))
    if (closedNow.length) setClosedTabs((list) => [...list, ...closedNow].slice(-25))
    const rest = current.filter((t) => !closing.has(t.id))
    if (!rest.length) return onClose()
    applyTabs(() => rest)
    if (closing.has(activeId)) focusTab(rest[Math.min(current.findIndex((t) => t.id === activeId), rest.length - 1)])
  }

  const GROUP_COLORS = ['#3fd8ff', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#f87171', '#60a5fa']
  /** The group whose name is being edited in the tab strip. */
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null)

  /** Puts tabs in a group: pinned tabs keep their place, the others join the group's tabs (or go to the end). */
  const addTabsToGroup = (tabIds: string[], groupId: string): void => {
    setTabs((list) => {
      const marked = list.map((t) => (tabIds.includes(t.id) ? { ...t, groupId } : t))
      const moving = marked.filter((t) => tabIds.includes(t.id) && !t.pinned)
      if (!moving.length) return marked
      const rest = marked.filter((t) => !moving.includes(t))
      const last = rest.map((t) => t.groupId).lastIndexOf(groupId)
      rest.splice(Math.max(rest.filter((t) => t.pinned).length, last >= 0 ? last + 1 : rest.length), 0, ...moving)
      return rest
    })
  }
  const createGroup = (tabIds: string[], name?: string, color?: string): TabGroup => {
    const group: TabGroup = { id: newId(), name: name?.replace(/\s+/g, ' ').trim().slice(0, 40) || `Group ${groups.length + 1}`, color: color ?? GROUP_COLORS[groups.length % GROUP_COLORS.length] }
    setGroups((list) => [...list, group])
    addTabsToGroup(tabIds, group.id)
    return group
  }
  const renameGroup = (groupId: string, name: string): void => {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 40)
    if (clean) setGroups((list) => list.map((g) => (g.id === groupId ? { ...g, name: clean } : g)))
  }
  const setGroupCollapsed = (groupId: string, collapsed: boolean): void => setGroups((list) => list.map((g) => (g.id === groupId ? { ...g, collapsed } : g)))
  /** Ungroups every tab in a group; the empty group then goes away. */
  const deleteGroup = (groupId: string): void => {
    setTabs((list) => list.map((t) => (t.groupId === groupId ? { ...t, groupId: undefined } : t)))
    setGroups((list) => list.filter((g) => g.id !== groupId))
  }
  /** Moves a group's tabs together to a position among the other tabs. */
  const moveGroup = (groupId: string, index: number): void => {
    setTabs((list) => {
      const block = list.filter((t) => t.groupId === groupId && !t.pinned)
      if (!block.length) return list
      const rest = list.filter((t) => !block.includes(t))
      rest.splice(Math.max(rest.filter((t) => t.pinned).length, Math.min(index, rest.length)), 0, ...block)
      return rest
    })
  }
  /** Reloads a tab; a crashed tab starts over and a failed page is loaded again. */
  const reloadTab = (tab: Tab, hard = false): boolean => {
    if (tab.crashed) {
      restartTab(tab.id)
      return true
    }
    if (tab.error && tab.url) {
      navigate(tab.url, tab.id)
      return true
    }
    const webview = views.current.get(tab.id)
    if (!webview) return false
    if (hard) webview.reloadIgnoringCache()
    else webview.reload()
    return true
  }
  /** Mobile or desktop view for a tab (reloads it with the matching user agent). */
  const setMobile = (tabId: string, mobile: boolean): void => {
    patch(tabId, { mobile })
    const webview = views.current.get(tabId)
    if (!webview) return
    webview.setUserAgent(mobile ? MOBILE_UA : DESKTOP_UA)
    webview.reload()
  }

  const tabAction = (id: string, action: TabMenuAction): void => {
    const tab = tabs.find((t) => t.id === id)
    if (!tab) return
    const index = tabs.indexOf(tab)
    const pinnedCount = tabs.filter((t) => t.pinned).length
    switch (action.type) {
      case 'pin':
        // Pinned tabs gather at the front; unpinning puts the tab just after them.
        setTabs((list) => {
          const current = list.find((t) => t.id === id)
          if (!current) return list
          const rest = list.filter((t) => t.id !== id)
          rest.splice(
            rest.filter((t) => t.pinned).length,
            0,
            { ...current, pinned: !current.pinned }
          )
          return rest
        })
        return
      case 'split': {
        if (id !== active.id) {
          setSplit({ left: active.id, right: id })
          setActiveId(id)
          return
        }
        const partner = tabs.find((t) => t.id !== id && t.url)
        if (partner) {
          setSplit({ left: id, right: partner.id })
          return
        }
        const fresh = createTab()
        setTabs((list) => [...list, fresh])
        setSplit({ left: id, right: fresh.id })
        setActiveId(fresh.id)
        requestAnimationFrame(focusUrlBar)
        return
      }
      case 'unsplit':
        setSplit(null)
        return
      case 'new-group':
        createGroup([id])
        return
      case 'group':
        // The tab joins the others in its group.
        addTabsToGroup([id], action.groupId)
        return
      case 'ungroup':
        patch(id, { groupId: undefined })
        return
      case 'bookmark':
        void window.api.toggleBookmark(tab.url, tab.customTitle || tab.title).then((on) => onNotify(on ? 'Tab bookmarked.' : 'Bookmark removed.'))
        return
      case 'copy':
        void copyText(tab.url).then(() => onNotify('Link copied.'))
        return
      case 'edit':
        setEditTab({ id, x: tabMenu?.x ?? 80, y: tabMenu?.y ?? 40 })
        return
      case 'move':
        if (action.to === 'window') {
          void window.api.popOutBrowser(tab.url).then((opened) => {
            if (opened) closeTabs([id])
            else onNotify("Couldn't open a new window for this tab.")
          })
        } else if (action.to === 'start') moveTab(id, tab.pinned ? 0 : pinnedCount)
        else moveTab(id, tab.pinned ? pinnedCount - 1 : tabs.length - 1)
        return
      case 'reload':
        views.current.get(id)?.reload()
        return
      case 'duplicate': {
        const copy: Tab = { ...createTab(tab.url), title: tab.title, favicon: tab.favicon, customTitle: tab.customTitle, customIcon: tab.customIcon, groupId: tab.groupId, pinned: tab.pinned, mobile: tab.mobile, private: tab.private }
        setTabs((list) => {
          const at = list.findIndex((t) => t.id === id)
          const next = [...list]
          next.splice(at + 1, 0, copy)
          return next
        })
        setActiveId(copy.id)
        return
      }
      case 'mute': {
        const host = hostOf(tab.url)
        if (host) setMutedHosts((list) => (list.includes(host) ? list.filter((h) => h !== host) : [...list, host]))
        return
      }
      case 'close':
        closeTabs([id])
        return
      case 'close-others':
        closeTabs(tabs.filter((t) => t.id !== id && !t.pinned).map((t) => t.id))
        setActiveId(id)
        return
      case 'close-right':
        closeTabs(tabs.slice(index + 1).filter((t) => !t.pinned).map((t) => t.id))
        if (tabs.slice(index + 1).some((t) => t.id === activeId && !t.pinned)) setActiveId(id)
        return
    }
  }

  const openTabMenu = (id: string, x: number, y: number): void => {
    setEditTab(null)
    setTabMenu({ id, x, y })
  }

  /** Starts a crashed tab's page over. */
  const restartTab = (id: string): void => {
    setTabs((list) => list.map((t) => (t.id === id ? { ...t, generation: t.generation + 1, crashed: false, error: undefined, loading: true } : t)))
  }

  /** Pages from last time that aren't open now. */
  const restorable = lastSession.filter((url) => !tabs.some((t) => t.url && sameUrl(t.url, url)))
  const restoreSession = (): void => {
    const [first, ...rest] = restorable
    setLastSession([])
    if (!first) return
    // Groups from last time come back with their pages.
    const groupOf = new Map<string, TabGroup>()
    const restoredGroups: TabGroup[] = []
    for (const saved of lastSessionGroups()) {
      const group: TabGroup = { id: newId(), name: saved.name, color: saved.color, collapsed: saved.collapsed }
      const urls = saved.urls.filter((url) => restorable.includes(url) && !groupOf.has(url))
      for (const url of urls) groupOf.set(url, group)
      if (urls.length) restoredGroups.push(group)
    }
    if (restoredGroups.length) setGroups((list) => [...list, ...restoredGroups])
    const grouped = (tab: Tab): Tab => (groupOf.has(tab.url) ? { ...tab, groupId: groupOf.get(tab.url)!.id } : tab)
    if (active.url) addTab(first, {})
    else navigate(first)
    if (groupOf.has(first)) {
      if (active.url) setTabs((list) => list.map((t, i) => (i === list.length - 1 && t.url === first ? grouped(t) : t)))
      else patch(active.id, { groupId: groupOf.get(first)!.id })
    }
    const others = rest.map((url) => grouped(createTab(url)))
    if (others.length) setTabs((list) => [...list, ...others])
  }

  const answerPermission = (allow: boolean): void => {
    const request = permissions[0]
    if (!request) return
    void window.api.answerBrowserPermission(request.id, allow, rememberPermission)
    setPermissions((list) => list.filter((r) => r.id !== request.id))
    setRememberPermission(false)
  }

  const setZoom = (zoom: number): void => {
    patch(active.id, { zoom })
    view()?.setZoomFactor(zoom)
    storeZoom(active.url, zoom)
  }

  /** A tab arrived at a page: it gets the zoom remembered for that site. */
  const onNavigated = useCallback(
    (id: string, url: string) => {
      const zoom = storedZoom(url)
      views.current.get(id)?.setZoomFactor(zoom)
      patch(id, { zoom })
    },
    [patch]
  )
  const stepZoom = (direction: 1 | -1): void => {
    const index = ZOOM_STEPS.findIndex((z) => z >= active.zoom - 0.001)
    setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (index === -1 ? 4 : index) + direction))])
  }

  const openFind = (): void => {
    if (!hasPage) return
    setFindOpen(true)
    setMenuOpen(false)
    requestAnimationFrame(() => findRef.current?.select())
  }
  const closeFind = (): void => {
    view()?.stopFindInPage('clearSelection')
    setFindOpen(false)
    setFindResult(null)
  }
  /** `step` moves between matches of the current search; without it a new search starts. */
  const find = (text: string, forward = true, step = false): void => {
    const webview = view()
    if (!webview) return
    if (!text) {
      webview.stopFindInPage('clearSelection')
      return setFindResult(null)
    }
    // Electron's findNext means "begin a new find session", the reverse of what the name suggests.
    webview.findInPage(text, { forward, findNext: !step })
  }

  const markup = async (): Promise<void> => {
    const webview = view()
    if (!webview) return onNotify('Open a page first, then mark it up.', 'warn')
    try {
      const image = await webview.capturePage()
      if (image.isEmpty()) throw new Error('empty capture')
      onEditScreenshot(image.toDataURL(), active.title || active.url)
    } catch {
      onNotify("Couldn't capture this page.", 'error')
    }
  }

  const pick = async (): Promise<void> => {
    const webview = view()
    if (!webview) return onNotify('Open a page first, then pick an element.', 'warn')
    if (picking) {
      void webview.executeJavaScript('window.__orbisCancelPick && window.__orbisCancelPick()').catch(() => undefined)
      return
    }
    setPicking(true)
    try {
      const result = (await webview.executeJavaScript(PICK_SCRIPT, true)) as PickResult | null
      if (!result) return
      const body = (result.text || result.html).split('\n').filter((line) => line.trim()).slice(0, 25)
      const quote = body.map((line) => `> ${line}`).join('\n')
      window.dispatchEvent(new CustomEvent('orbis:compose', { detail: `From "${result.title || result.url}" (${result.url}), this <${result.tag}> element:\n${quote}\n\n` }))
      onNotify('Added the selected element to your message.')
    } catch {
      onNotify("Couldn't pick from this page.", 'error')
    } finally {
      setPicking(false)
    }
  }

  const toggleMobile = (): void => setMobile(active.id, !active.mobile)

  const startResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    setResizing(true)
    const move = (ev: PointerEvent): void => setWidth(Math.round(Math.min(Math.max(340, startWidth + startX - ev.clientX), window.innerWidth - 420)))
    const up = (): void => {
      setResizing(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // The window sits at the bottom right, so dragging its top-left corner up and left makes it bigger.
  // Only the element's size changes: the page adapts to the new viewport without reloading.
  const startWindowResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const { width: startWidth, height: startHeight } = windowSize
    let last = { width: startWidth, height: startHeight }
    setResizing(true)
    const move = (ev: PointerEvent): void => {
      last = { width: startWidth + startX - ev.clientX, height: startHeight + startY - ev.clientY }
      onWindowResize(last.width, last.height, false)
    }
    const up = (): void => {
      setResizing(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onWindowResize(last.width, last.height, true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const menuAction = (action: () => void): (() => void) => () => {
    action()
    setMenuOpen(false)
  }

  /** F11: the Orbis window goes fullscreen with the browser at full page; again restores both. */
  const toggleFullscreen = async (): Promise<void> => {
    const on = await window.api.setWindowFullscreen()
    if (on && mode !== 'full') {
      fullscreenRestore.current = mode
      restoreMode.current = mode
      onModeChange('full')
    } else if (!on && fullscreenRestore.current) {
      onModeChange(fullscreenRestore.current)
      fullscreenRestore.current = null
    }
  }

  const toggleLibrary = (tab: LibraryTab): void => {
    setMenuOpen(false)
    setLibrary((current) => (current === tab ? null : tab))
  }

  const toggleBookmark = async (): Promise<void> => {
    if (!isWebUrl(active.url)) return
    const on = await window.api.toggleBookmark(active.url, active.title)
    onNotify(on ? 'Bookmarked this page.' : 'Removed the bookmark.')
  }

  const bookmarkAll = async (): Promise<void> => {
    const pages = tabs.filter((t) => isWebUrl(t.url)).map((t) => ({ url: t.url, title: t.title }))
    if (!pages.length) return
    const added = await window.api.addBookmarks(pages)
    onNotify(added ? `Bookmarked ${added} tab${added === 1 ? '' : 's'}.` : 'All open tabs are already bookmarked.')
  }

  const savePage = async (): Promise<void> => {
    const webview = view()
    if (!webview || !isWebUrl(active.url)) return
    try {
      if (await window.api.savePage(webview.getWebContentsId())) onNotify('Saved the page to your computer.')
    } catch {
      onNotify("Couldn't save this page.", 'error')
    }
  }

  const viewSource = (): void => {
    if (isWebUrl(active.url)) openTab(`view-source:${active.url}`)
  }

  const toggleDevTools = (): void => {
    const webview = view()
    if (!webview) return
    if (webview.isDevToolsOpened()) webview.closeDevTools()
    else webview.openDevTools()
  }

  /** Every browser shortcut, delivered once from the main process; the latest state is always used. */
  const runShortcut = (event: BrowserShortcutEvent): void => {
    if (hidden) return
    const index = tabs.findIndex((t) => t.id === active.id)
    const webview = view()
    const findStep = (forward: boolean): void => (findOpen && findText ? find(findText, forward, true) : openFind())
    switch (event.action) {
      case 'new-tab':
        return openTab()
      case 'new-private-tab':
        openTab('', true, true)
        requestAnimationFrame(focusUrlBar)
        return
      case 'close-tab':
        return closeTab(active.id)
      case 'reopen-tab':
        return reopenTab()
      case 'next-tab':
        return focusTab(tabs[(index + 1) % tabs.length])
      case 'prev-tab':
        return focusTab(tabs[(index - 1 + tabs.length) % tabs.length])
      case 'select-tab':
        return focusTab(tabs[(event.index ?? 1) - 1])
      case 'last-tab':
        return focusTab(tabs[tabs.length - 1])
      case 'move-tab-left':
        return moveTab(active.id, index - 1)
      case 'move-tab-right':
        return moveTab(active.id, index + 1)
      case 'back':
        if (webview?.canGoBack()) webview.goBack()
        return
      case 'forward':
        if (webview?.canGoForward()) webview.goForward()
        return
      case 'reload':
      case 'hard-reload':
        if (hasPage) reloadTab(active, event.action === 'hard-reload')
        return
      case 'stop':
        if (active.loading) webview?.stop()
        return
      case 'focus-url':
        return focusUrlBar()
      case 'find':
        return openFind()
      case 'find-next':
        return findStep(true)
      case 'find-prev':
        return findStep(false)
      case 'zoom-in':
        if (hasPage) stepZoom(1)
        return
      case 'zoom-out':
        if (hasPage) stepZoom(-1)
        return
      case 'zoom-reset':
        if (hasPage) setZoom(1)
        return
      case 'fullscreen':
        return void toggleFullscreen()
      case 'history':
      case 'downloads':
      case 'bookmarks':
        return toggleLibrary(event.action)
      case 'bookmark':
        return void toggleBookmark()
      case 'bookmark-all':
        return void bookmarkAll()
      case 'print':
        if (hasPage) void webview?.print().catch(() => undefined)
        return
      case 'save-page':
        return void savePage()
      case 'view-source':
        return viewSource()
      case 'devtools':
        return toggleDevTools()
    }
  }
  const runShortcutRef = useRef(runShortcut)
  runShortcutRef.current = runShortcut
  useEffect(() => window.api.onBrowserShortcut((event) => runShortcutRef.current(event)), [])

  // ---------------------------------------------------------------- Browser Control Layer: this panel's capabilities
  // Each one calls the same function the panel's own buttons, menus and shortcuts use, then checks the panel's real state.

  const live = useRef({ tabs, activeId, groups, closedTabs, split, findOpen, findResult, library, mutedHosts })
  live.current = { tabs, activeId, groups, closedTabs, split, findOpen, findResult, library, mutedHosts }
  const liveTab = (id: string): Tab | undefined => live.current.tabs.find((t) => t.id === id)
  const viewLoading = (id: string): boolean => {
    try {
      return views.current.get(id)?.isLoading() === true
    } catch {
      return false
    }
  }
  /** The tab a command means: its tabId, the command's target (tab or page id), or the active tab. */
  const tabFor = (params: Record<string, unknown>, target: ControlTarget | null): Tab | null => {
    const id = typeof params.tabId === 'string' ? params.tabId : target?.tabId
    if (id) return tabs.find((t) => t.id === id) ?? null
    if (typeof target?.webContentsId === 'number') {
      return (
        tabs.find((t) => {
          try {
            return views.current.get(t.id)?.getWebContentsId() === target.webContentsId
          } catch {
            return false
          }
        }) ?? null
      )
    }
    return active
  }
  const TAB_ID = str('Tab id from the browser state (default: the active tab).')
  const NO_TAB = failure('not-found', 'There is no such tab. Read the browser state for the current tab ids.', true)
  /** Waits for a tab's navigation to start and finish; resolves the tab as it ended up. */
  const settleTab = async (id: string, before: { url: string }): Promise<Tab | undefined> => {
    await waitUntil(() => {
      const t = liveTab(id)
      return !t || t.loading || viewLoading(id) || t.url !== before.url || Boolean(t.error)
    }, 5000)
    await waitUntil(() => {
      const t = liveTab(id)
      return !t || (!t.loading && !viewLoading(id))
    }, 45_000)
    return liveTab(id)
  }
  const loadOutcome = (tab: Tab | undefined, what: string) =>
    !tab
      ? failure('not-found', 'The tab closed.', false)
      : tab.error
        ? failure('failed', `${what}: the page couldn't be loaded (${tab.error}).`, true)
        : verified(`${what}: ${tab.url} loaded${tab.title ? ` (“${tab.title}”)` : ''}.`, { tabId: tab.id, url: tab.url, title: tab.title })

  const capabilities: WindowCapability[] = [
    {
      id: 'tabs.create',
      domain: 'tabs',
      name: 'Open a tab',
      description: 'Opens a new tab: blank, or at an address or search text; in the foreground or background, private, pinned, at a position, in a group.',
      params: { url: str('Address or search text (default: a blank tab).'), active: bool('Switch to it (default true).'), private: bool('A private tab.'), pinned: bool('Pinned.'), index: int('Position (0 = first).'), groupId: str('Add it to this group.') },
      mutates: true,
      run: async (p) => {
        const input = typeof p.url === 'string' ? p.url.trim() : ''
        const url = input ? (/^(view-source:https?:|chrome-extension:)/i.test(input) ? input : toUrl(input)) : ''
        if (url && !/^(https?:|view-source:https?:|chrome-extension:)/i.test(url)) return failure('invalid-params', 'Only web pages can be opened in a tab.')
        const tab = addTab(url, { activate: p.active !== false, private: p.private === true, index: typeof p.index === 'number' ? p.index : undefined, pinned: p.pinned === true })
        if (typeof p.groupId === 'string') addTabsToGroup([tab.id], p.groupId)
        const ok = await waitUntil(() => Boolean(liveTab(tab.id)) && (p.active === false || live.current.activeId === tab.id))
        return ok ? verified(`Opened tab ${tab.id}${url ? ` at ${url}` : ''}.`, { tabId: tab.id, url }) : unverified('The tab did not appear.', { tabId: tab.id })
      }
    },
    {
      id: 'browser.openWorkspace',
      domain: 'browser',
      name: 'Open a workspace',
      description: 'Opens a saved set of pages and groups. With replace, the pages that are open and not part of it are closed first.',
      params: {
        tabs: { type: 'array', description: 'The pages: url, title, pinned, group, active.', required: true },
        groups: { type: 'array', description: 'The groups: name, color, collapsed.' },
        replace: { type: 'boolean', description: 'Close the pages that are not part of it (default true).' }
      },
      mutates: true,
      run: async (p) => {
        const wanted = (Array.isArray(p.tabs) ? p.tabs : []).filter((t): t is { url: string; title?: string; pinned?: boolean; group?: string; active?: boolean } => Boolean(t) && typeof (t as { url?: unknown }).url === 'string')
        if (!wanted.length) return failure('invalid-params', 'That workspace has no pages in it.')
        const replace = p.replace !== false
        const before = live.current.tabs
        // Pages already open are kept as they are, so switching back does not reload everything.
        const openAlready = new Map(before.map((t) => [t.url, t]))
        const used: string[] = []
        const madeGroups = new Map<string, string>()
        for (const want of wanted) {
          const existing = openAlready.get(want.url)
          const id = existing ? existing.id : addTab(want.url, { activate: false, pinned: want.pinned === true }).id
          used.push(id)
          if (want.pinned && !existing?.pinned) setTabs((list) => list.map((t) => (t.id === id ? { ...t, pinned: true } : t)))
          if (want.group) {
            let groupId = madeGroups.get(want.group)
            if (!groupId) {
              const details = (Array.isArray(p.groups) ? p.groups : []).find((g) => (g as { name?: string })?.name === want.group) as { color?: string; collapsed?: boolean } | undefined
              const group = createGroup([], want.group, details?.color)
              groupId = group.id
              madeGroups.set(want.group, groupId)
              if (details?.collapsed) setGroupCollapsed(groupId, true)
            }
            addTabsToGroup([id], groupId)
          }
        }
        if (replace) {
          // Private tabs are never part of a workspace, and are never closed by switching to one.
          const extra = before.filter((t) => !used.includes(t.id) && !t.private).map((t) => t.id)
          if (extra.length) closeTabs(extra)
        }
        const activeWanted = wanted.find((t) => t.active) ?? wanted[0]
        const activeId = used[wanted.indexOf(activeWanted)] ?? used[0]
        const activeTab = live.current.tabs.find((t) => t.id === activeId)
        if (activeTab) focusTab(activeTab)
        const ok = await waitUntil(() => used.every((id) => live.current.tabs.some((t) => t.id === id)) && (!replace || live.current.tabs.every((t) => used.includes(t.id) || t.private)))
        return ok
          ? verified(`Opened ${used.length} page${used.length === 1 ? '' : 's'}${madeGroups.size ? ` in ${madeGroups.size} group${madeGroups.size === 1 ? '' : 's'}` : ''}.`, { tabIds: used, groups: [...madeGroups.keys()] })
          : unverified('The workspace did not open fully.', { tabIds: used })
      }
    },
    {
      id: 'tabs.close',
      domain: 'tabs',
      name: 'Close a tab',
      description: 'Closes a tab (closing the last tab closes the browser). Use browser state previousTabId for "the tab I was just using".',
      params: { tabId: TAB_ID },
      mutates: true,
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        if (!tab) return NO_TAB
        const last = tabs.length === 1
        closeTabs([tab.id])
        if (last) return verified('Closed the last tab, which closes the browser.', { tabId: tab.id, browserClosed: true })
        const ok = await waitUntil(() => !liveTab(tab.id))
        return ok ? verified(`Closed “${tab.customTitle || tab.title}”.`, { tabId: tab.id }) : unverified('The tab is still open.')
      }
    },
    {
      id: 'tabs.closeOthers',
      domain: 'tabs',
      name: 'Close other tabs',
      description: 'Closes every unpinned tab except this one.',
      params: { tabId: TAB_ID },
      mutates: true,
      confirmation: 'always',
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        if (!tab) return NO_TAB
        tabAction(tab.id, { type: 'close-others' })
        const ok = await waitUntil(() => live.current.tabs.every((t) => t.id === tab.id || t.pinned))
        return ok ? verified(`Only “${tab.title}” and pinned tabs remain.`) : unverified('Other tabs are still open.')
      }
    },
    {
      id: 'tabs.closeRight',
      domain: 'tabs',
      name: 'Close tabs to the right',
      description: 'Closes the unpinned tabs to the right of this one.',
      params: { tabId: TAB_ID },
      mutates: true,
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        if (!tab) return NO_TAB
        const doomed = tabs.slice(tabs.indexOf(tab) + 1).filter((t) => !t.pinned).map((t) => t.id)
        tabAction(tab.id, { type: 'close-right' })
        const ok = await waitUntil(() => doomed.every((id) => !liveTab(id)))
        return ok ? verified(`Closed ${doomed.length} tab${doomed.length === 1 ? '' : 's'}.`) : unverified('Some of those tabs are still open.')
      }
    },
    {
      id: 'tabs.reopen',
      domain: 'tabs',
      name: 'Reopen a closed tab',
      description: 'Reopens a recently closed tab where it was (default: the most recently closed; see closedTabs in the browser state).',
      params: { position: int('Position in closedTabs (default: the last one).') },
      mutates: true,
      run: async (p) => {
        if (!closedTabs.length) return failure('not-found', 'No tabs were closed in this session.')
        const position = typeof p.position === 'number' ? p.position : closedTabs.length - 1
        const closed = closedTabs[position]
        if (!closed) return failure('invalid-params', 'There is no closed tab at that position.')
        const before = tabs.length
        reopenTab(position)
        const ok = await waitUntil(() => live.current.tabs.length > before)
        const reopened = live.current.tabs.find((t) => t.url === closed.url)
        return ok ? verified(`Reopened ${closed.url}.`, { tabId: reopened?.id, url: closed.url }) : unverified('The tab did not come back.')
      }
    },
    {
      id: 'tabs.activate',
      domain: 'tabs',
      name: 'Switch to a tab',
      description: 'Makes a tab the active one.',
      params: { tabId: str('The tab id.', true) },
      mutates: true,
      run: async (p) => {
        const tab = tabs.find((t) => t.id === p.tabId)
        if (!tab) return NO_TAB
        focusTab(tab)
        const ok = await waitUntil(() => live.current.activeId === tab.id)
        return ok ? verified(`Switched to “${tab.customTitle || tab.title}”.`, { tabId: tab.id }) : unverified('The tab is not active.')
      }
    },
    {
      id: 'tabs.activatePrevious',
      domain: 'tabs',
      name: 'Switch to the previous tab',
      description: 'Switches back to the tab that was active before the current one.',
      params: {},
      mutates: true,
      run: async () => {
        const tab = tabs.find((t) => t.id === previousTab.current)
        if (!tab) return failure('not-found', 'There is no previously used tab that is still open.')
        focusTab(tab)
        const ok = await waitUntil(() => live.current.activeId === tab.id)
        return ok ? verified(`Switched back to “${tab.customTitle || tab.title}”.`, { tabId: tab.id }) : unverified('The tab is not active.')
      }
    },
    ...(['activate', 'close'] as const).map(
      (verb): WindowCapability => ({
        id: verb === 'activate' ? 'tabs.activateMatching' : 'tabs.closeMatching',
        domain: 'tabs',
        name: verb === 'activate' ? 'Switch to a tab by its page' : 'Close a tab by its page',
        description: `${verb === 'activate' ? 'Switches to' : 'Closes'} the tab whose address or title contains some text (for workflows, where tab ids change between runs). When several tabs match, it says which and asks for an index${verb === 'close' ? ' (or all: true)' : ''}.`,
        params: { urlContains: str('Text in the address.'), titleContains: str('Text in the title.'), index: int('Which match (0 = first), when several match.'), ...(verb === 'close' ? { all: bool('Close every match.') } : {}) },
        mutates: true,
        run: async (p) => {
          const url = typeof p.urlContains === 'string' ? p.urlContains.toLowerCase() : ''
          const title = typeof p.titleContains === 'string' ? p.titleContains.toLowerCase() : ''
          if (!url && !title) return failure('invalid-params', 'Give urlContains or titleContains.')
          const matches = tabs.filter((t) => (!url || t.url.toLowerCase().includes(url)) && (!title || (t.customTitle || t.title).toLowerCase().includes(title)))
          if (!matches.length) return failure('not-found', `No tab matches. Open tabs: ${tabs.map((t) => t.url || 'blank').join(', ')}.`, true)
          const everyMatch = verb === 'close' && p.all === true
          if (matches.length > 1 && typeof p.index !== 'number' && !everyMatch) {
            return failure('invalid-params', `${matches.length} tabs match: ${matches.map((t, i) => `${i}: ${t.customTitle || t.title} (${t.url})`).join('; ')}. Say which with index.`, false)
          }
          const chosen = everyMatch ? matches : [matches[Math.max(0, Math.min(Number(p.index ?? 0), matches.length - 1))]]
          if (verb === 'activate') {
            focusTab(chosen[0])
            const ok = await waitUntil(() => live.current.activeId === chosen[0].id)
            return ok ? verified(`Switched to “${chosen[0].customTitle || chosen[0].title}”.`, { tabId: chosen[0].id, url: chosen[0].url }) : unverified('The tab is not active.')
          }
          const closingLast = chosen.length === tabs.length
          closeTabs(chosen.map((t) => t.id))
          if (closingLast) return verified('Closed the last tabs, which closes the browser.', { closed: chosen.length })
          const ok = await waitUntil(() => chosen.every((t) => !liveTab(t.id)))
          return ok ? verified(`Closed ${chosen.length} tab${chosen.length === 1 ? '' : 's'}.`, { closed: chosen.length }) : unverified('A matching tab is still open.')
        }
      })
    ),
    {
      id: 'tabs.move',
      domain: 'tabs',
      name: 'Move a tab',
      description: 'Moves a tab to a position in the tab strip (0 = first).',
      params: { tabId: TAB_ID, index: int('The new position.', true) },
      mutates: true,
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        if (!tab) return NO_TAB
        const index = Math.max(0, Math.min(Number(p.index), tabs.length - 1))
        moveTab(tab.id, index)
        const ok = await waitUntil(() => live.current.tabs.findIndex((t) => t.id === tab.id) === index)
        return ok ? verified(`Moved to position ${index}.`, { tabId: tab.id, index }) : unverified(`The tab is at position ${live.current.tabs.findIndex((t) => t.id === tab.id)}.`)
      }
    },
    {
      id: 'tabs.duplicate',
      domain: 'tabs',
      name: 'Duplicate a tab',
      description: 'Opens a copy of a tab next to it.',
      params: { tabId: TAB_ID },
      mutates: true,
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        if (!tab) return NO_TAB
        const before = new Set(tabs.map((t) => t.id))
        tabAction(tab.id, { type: 'duplicate' })
        const ok = await waitUntil(() => live.current.tabs.some((t) => !before.has(t.id) && t.url === tab.url))
        const copy = live.current.tabs.find((t) => !before.has(t.id))
        return ok ? verified(`Duplicated as tab ${copy?.id}.`, { tabId: copy?.id }) : unverified('No copy appeared.')
      }
    },
    {
      id: 'tabs.pin',
      domain: 'tabs',
      name: 'Pin or unpin a tab',
      description: 'Pins a tab to the front of the tab strip, or unpins it.',
      params: { tabId: TAB_ID, pinned: bool('Pin (true) or unpin (false).', true) },
      mutates: true,
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        if (!tab) return NO_TAB
        if (Boolean(tab.pinned) !== p.pinned) tabAction(tab.id, { type: 'pin' })
        const ok = await waitUntil(() => Boolean(liveTab(tab.id)?.pinned) === p.pinned)
        return ok ? verified(`The tab is ${p.pinned ? 'pinned' : 'unpinned'}.`) : unverified('The pin did not change.')
      }
    },
    {
      id: 'tabs.mute',
      domain: 'tabs',
      name: 'Mute or unmute a tab',
      description: "Mutes or unmutes one tab's sound.",
      params: { tabId: TAB_ID, muted: bool('Mute (true) or unmute (false).', true) },
      mutates: true,
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        if (!tab) return NO_TAB
        patch(tab.id, { muted: p.muted === true })
        const ok = await waitUntil(() => Boolean(liveTab(tab.id)?.muted) === p.muted)
        return ok ? verified(`The tab is ${p.muted ? 'muted' : 'unmuted'}.`) : unverified('The tab sound did not change.')
      }
    },
    {
      id: 'tabs.muteSite',
      domain: 'tabs',
      name: 'Mute or unmute a site',
      description: "Mutes (or unmutes) every tab on the tab's site, as “Mute site” does.",
      params: { tabId: TAB_ID, muted: bool('Mute (true) or unmute (false).', true) },
      mutates: true,
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        const host = tab ? hostOf(tab.url) : ''
        if (!tab || !host) return failure('invalid-params', 'That tab has no site open.')
        if (mutedHosts.includes(host) !== p.muted) tabAction(tab.id, { type: 'mute' })
        const ok = await waitUntil(() => live.current.mutedHosts.includes(host) === p.muted)
        return ok ? verified(`${host} is ${p.muted ? 'muted' : 'unmuted'}.`) : unverified('The site sound did not change.')
      }
    },
    {
      id: 'tabs.rename',
      domain: 'tabs',
      name: 'Rename a tab',
      description: 'Gives a tab your own name and emoji icon (empty values bring back the page’s own).',
      params: { tabId: TAB_ID, title: str('The name.'), icon: str('An emoji.') },
      mutates: true,
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        if (!tab) return NO_TAB
        const customTitle = typeof p.title === 'string' ? p.title.trim().slice(0, 80) || undefined : tab.customTitle
        const customIcon = typeof p.icon === 'string' ? p.icon.trim().slice(0, 8) || undefined : tab.customIcon
        patch(tab.id, { customTitle, customIcon })
        const ok = await waitUntil(() => liveTab(tab.id)?.customTitle === customTitle && liveTab(tab.id)?.customIcon === customIcon)
        return ok ? verified(`The tab shows “${customTitle ?? tab.title}”.`) : unverified('The name did not change.')
      }
    },
    {
      id: 'tabs.split',
      domain: 'tabs',
      name: 'Split view',
      description: 'Shows a tab side by side with the active tab (or ends split view with on: false).',
      params: { tabId: TAB_ID, on: bool('false ends split view.') },
      mutates: true,
      run: async (p, { target }) => {
        if (p.on === false) {
          setSplit(null)
          const ok = await waitUntil(() => !live.current.split)
          return ok ? verified('Split view ended.') : unverified('Split view is still on.')
        }
        const tab = tabFor(p, target)
        if (!tab) return NO_TAB
        tabAction(tab.id, { type: 'split' })
        const ok = await waitUntil(() => Boolean(live.current.split && (live.current.split.left === tab.id || live.current.split.right === tab.id)))
        return ok ? verified('The tabs are side by side.', live.current.split) : unverified('Split view did not start.')
      }
    },
    {
      id: 'tabs.mobileView',
      domain: 'tabs',
      name: 'Mobile or desktop view',
      description: 'Shows a tab as a phone would (mobile user agent and width) or as desktop; reloads the page.',
      params: { tabId: TAB_ID, mobile: bool('Mobile (true) or desktop (false).', true) },
      mutates: true,
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        if (!tab || !tab.url) return NO_TAB
        setMobile(tab.id, p.mobile === true)
        const ok = await waitUntil(() => liveTab(tab.id)?.mobile === p.mobile)
        return ok ? verified(`The tab is in ${p.mobile ? 'mobile' : 'desktop'} view.`) : unverified('The view did not change.')
      }
    },
    {
      id: 'navigation.go',
      domain: 'navigation',
      name: 'Open an address or search',
      description: 'Loads an address, or searches for text, in a tab, and waits until it has loaded or failed (redirects followed; see navigation.info for details).',
      params: { url: str('An address or search text.', true), tabId: TAB_ID },
      mutates: true,
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        if (!tab) return NO_TAB
        const input = String(p.url ?? '').trim()
        if (!input) return failure('invalid-params', 'Give an address or search text.')
        if (!tab.id) return NO_TAB
        const before = { url: tab.url }
        navigate(input, tab.id)
        return loadOutcome(await settleTab(tab.id, before), 'Opened')
      }
    },
    {
      id: 'navigation.back',
      domain: 'navigation',
      name: 'Go back',
      description: "Goes back in a tab's history and waits for the page.",
      params: { tabId: TAB_ID },
      mutates: true,
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        if (!tab) return NO_TAB
        const webview = views.current.get(tab.id)
        if (!webview || !webview.canGoBack()) return failure('unavailable', 'There is no previous page in this tab.')
        const before = { url: tab.url }
        webview.goBack()
        return loadOutcome(await settleTab(tab.id, before), 'Went back')
      }
    },
    {
      id: 'navigation.forward',
      domain: 'navigation',
      name: 'Go forward',
      description: "Goes forward in a tab's history and waits for the page.",
      params: { tabId: TAB_ID },
      mutates: true,
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        if (!tab) return NO_TAB
        const webview = views.current.get(tab.id)
        if (!webview || !webview.canGoForward()) return failure('unavailable', 'There is no next page in this tab.')
        const before = { url: tab.url }
        webview.goForward()
        return loadOutcome(await settleTab(tab.id, before), 'Went forward')
      }
    },
    {
      id: 'navigation.reload',
      domain: 'navigation',
      name: 'Reload',
      description: 'Reloads a tab (hard: bypassing the cache); a crashed tab starts over. Waits for the page.',
      params: { tabId: TAB_ID, hard: bool('Bypass the cache.') },
      mutates: true,
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        if (!tab || !tab.url) return failure('unavailable', 'That tab has no page to reload.')
        if (!reloadTab(tab, p.hard === true)) return failure('unavailable', 'The page is not ready yet.', true)
        const started = await waitUntil(() => Boolean(liveTab(tab.id)?.loading) || viewLoading(tab.id), 3000)
        if (!started) return unverified('The reload did not start.')
        await waitUntil(() => !liveTab(tab.id)?.loading && !viewLoading(tab.id), 45_000)
        return loadOutcome(liveTab(tab.id), p.hard ? 'Hard reloaded' : 'Reloaded')
      }
    },
    {
      id: 'navigation.stop',
      domain: 'navigation',
      name: 'Stop loading',
      description: 'Stops a tab that is loading.',
      params: { tabId: TAB_ID },
      mutates: true,
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        const webview = tab ? views.current.get(tab.id) : undefined
        if (!tab || !webview) return NO_TAB
        if (!tab.loading && !viewLoading(tab.id)) return verified('The tab was not loading.')
        webview.stop()
        const ok = await waitUntil(() => !liveTab(tab.id)?.loading && !viewLoading(tab.id), 3000)
        return ok ? verified('Stopped loading.') : unverified('It is still loading.')
      }
    },
    {
      id: 'navigation.openExternal',
      domain: 'navigation',
      name: 'Open in the default browser',
      description: "Opens a tab's page (or an address) in the system's default browser.",
      params: { url: str('An address (default: the tab’s page).'), tabId: TAB_ID },
      mutates: true,
      run: async (p, { target }) => {
        const url = typeof p.url === 'string' && p.url ? toUrl(p.url) : tabFor(p, target)?.url
        if (!url || !isWebUrl(url)) return failure('invalid-params', 'There is no web page to open.')
        await window.api.openExternal(url)
        return verified(`Handed ${url} to the default browser.`)
      }
    },
    {
      id: 'groups.create',
      domain: 'groups',
      name: 'Create a tab group',
      description: 'Puts tabs in a new group with a name and color.',
      params: { tabIds: { type: 'array', description: 'Tab ids (default: the active tab).' }, name: str('Group name.'), color: str('A CSS color, e.g. #34d399.') },
      mutates: true,
      run: async (p) => {
        const ids = (Array.isArray(p.tabIds) ? p.tabIds.map(String) : [active.id]).filter((id) => tabs.some((t) => t.id === id))
        if (!ids.length) return NO_TAB
        const group = createGroup(ids, typeof p.name === 'string' ? p.name : undefined, typeof p.color === 'string' ? p.color : undefined)
        const ok = await waitUntil(() => live.current.groups.some((g) => g.id === group.id) && ids.every((id) => liveTab(id)?.groupId === group.id))
        return ok ? verified(`Created “${group.name}” with ${ids.length} tab${ids.length === 1 ? '' : 's'}.`, { groupId: group.id }) : unverified('The group was not created.')
      }
    },
    {
      id: 'groups.rename',
      domain: 'groups',
      name: 'Rename a group',
      description: 'Renames a tab group (and optionally recolors it).',
      params: { groupId: str('The group id.', true), name: str('New name.', true), color: str('New color.') },
      mutates: true,
      run: async (p) => {
        if (!groups.some((g) => g.id === p.groupId)) return failure('not-found', 'There is no such group.', true)
        renameGroup(String(p.groupId), String(p.name))
        if (typeof p.color === 'string') setGroups((list) => list.map((g) => (g.id === p.groupId ? { ...g, color: String(p.color) } : g)))
        const want = String(p.name).replace(/\s+/g, ' ').trim().slice(0, 40)
        const ok = await waitUntil(() => live.current.groups.find((g) => g.id === p.groupId)?.name === want)
        return ok ? verified(`The group is called “${want}”.`) : unverified('The name did not change.')
      }
    },
    {
      id: 'groups.collapse',
      domain: 'groups',
      name: 'Collapse or expand a group',
      description: 'Collapses a group to its name in the tab strip, or expands it.',
      params: { groupId: str('The group id.', true), collapsed: bool('Collapse (true) or expand (false).', true) },
      mutates: true,
      run: async (p) => {
        if (!groups.some((g) => g.id === p.groupId)) return failure('not-found', 'There is no such group.', true)
        setGroupCollapsed(String(p.groupId), p.collapsed === true)
        const ok = await waitUntil(() => Boolean(live.current.groups.find((g) => g.id === p.groupId)?.collapsed) === p.collapsed)
        return ok ? verified(`The group is ${p.collapsed ? 'collapsed' : 'expanded'}.`) : unverified('The group did not change.')
      }
    },
    {
      id: 'groups.delete',
      domain: 'groups',
      name: 'Ungroup',
      description: 'Removes a group; its tabs stay open, ungrouped.',
      params: { groupId: str('The group id.', true) },
      mutates: true,
      run: async (p) => {
        if (!groups.some((g) => g.id === p.groupId)) return failure('not-found', 'There is no such group.', true)
        deleteGroup(String(p.groupId))
        const ok = await waitUntil(() => !live.current.tabs.some((t) => t.groupId === p.groupId) && !live.current.groups.some((g) => g.id === p.groupId))
        return ok ? verified('The group is gone; its tabs are still open.') : unverified('Tabs are still in the group.')
      }
    },
    {
      id: 'groups.addTab',
      domain: 'groups',
      name: 'Add a tab to a group',
      description: 'Moves a tab into a group (next to its other tabs); also moves a tab from one group to another.',
      params: { groupId: str('The group id.', true), tabId: TAB_ID },
      mutates: true,
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        if (!tab) return NO_TAB
        if (!groups.some((g) => g.id === p.groupId)) return failure('not-found', 'There is no such group.', true)
        addTabsToGroup([tab.id], String(p.groupId))
        const ok = await waitUntil(() => liveTab(tab.id)?.groupId === p.groupId)
        return ok ? verified('The tab is in the group.') : unverified('The tab is not in the group.')
      }
    },
    {
      id: 'groups.removeTab',
      domain: 'groups',
      name: 'Remove a tab from its group',
      description: 'Takes a tab out of its group.',
      params: { tabId: TAB_ID },
      mutates: true,
      run: async (p, { target }) => {
        const tab = tabFor(p, target)
        if (!tab) return NO_TAB
        tabAction(tab.id, { type: 'ungroup' })
        const ok = await waitUntil(() => !liveTab(tab.id)?.groupId)
        return ok ? verified('The tab is no longer grouped.') : unverified('The tab is still grouped.')
      }
    },
    {
      id: 'groups.move',
      domain: 'groups',
      name: 'Move a group',
      description: "Moves a group's tabs together to a position in the tab strip.",
      params: { groupId: str('The group id.', true), index: int('Position among the other tabs.', true) },
      mutates: true,
      run: async (p) => {
        if (!groups.some((g) => g.id === p.groupId)) return failure('not-found', 'There is no such group.', true)
        const rest = tabs.filter((t) => !(t.groupId === p.groupId && !t.pinned))
        const expected = Math.max(rest.filter((t) => t.pinned).length, Math.min(Number(p.index), rest.length))
        moveGroup(String(p.groupId), Number(p.index))
        const ok = await waitUntil(() => live.current.tabs.findIndex((t) => t.groupId === p.groupId) === expected)
        const first = live.current.tabs.findIndex((t) => t.groupId === p.groupId)
        return ok ? verified(`The group starts at position ${first}.`, { index: first }) : unverified(`The group is at position ${first}.`, { index: first })
      }
    },
    {
      id: 'find.open',
      domain: 'find',
      name: 'Find in page',
      description: 'Opens the find bar and searches the active page for text; reports how many matches there are.',
      params: { text: str('Text to find.') },
      mutates: true,
      requires: ['web-page'],
      run: async (p) => {
        if (!hasPage) return failure('unavailable', 'Open a page first.')
        openFind()
        if (typeof p.text === 'string' && p.text) {
          setFindText(p.text)
          find(p.text)
          const found = await waitUntil(() => live.current.findResult !== null, 3000)
          const r = live.current.findResult
          return found ? verified(`${r?.total ?? 0} match${r?.total === 1 ? '' : 'es'} for “${p.text}”.`, { matches: r?.total ?? 0, activeMatch: r?.active ?? 0 }) : verified(`No matches for “${p.text}”.`, { matches: 0 })
        }
        const ok = await waitUntil(() => live.current.findOpen)
        return ok ? verified('The find bar is open.') : unverified('The find bar did not open.')
      }
    },
    ...(['next', 'previous'] as const).map(
      (direction): WindowCapability => ({
        id: `find.${direction}`,
        domain: 'find',
        name: direction === 'next' ? 'Next match' : 'Previous match',
        description: `Moves to the ${direction} match of the current search.`,
        params: {},
        mutates: true,
        requires: ['web-page'],
        run: async () => {
          if (!findOpen || !findText) return failure('unavailable', 'Nothing is being searched. Use find.open first.', true)
          const before = findResult?.active
          find(findText, direction === 'next', true)
          await waitUntil(() => live.current.findResult?.active !== before || (live.current.findResult?.total ?? 0) <= 1, 2000)
          const r = live.current.findResult
          return verified(`Match ${r?.active ?? 0} of ${r?.total ?? 0}.`, { activeMatch: r?.active ?? 0, matches: r?.total ?? 0 })
        }
      })
    ),
    {
      id: 'find.close',
      domain: 'find',
      name: 'Close find',
      description: 'Closes the find bar and clears the highlights.',
      params: {},
      mutates: true,
      run: async () => {
        closeFind()
        const ok = await waitUntil(() => !live.current.findOpen)
        return ok ? verified('The find bar is closed.') : unverified('The find bar is still open.')
      }
    },
    {
      id: 'zoom.set',
      domain: 'zoom',
      name: 'Zoom',
      description: 'Zooms the active page: in, out, reset, or to a factor (0.5-2). Zoom is remembered per site.',
      params: { action: str('in, out or reset', false, { enum: ['in', 'out', 'reset'] }), factor: num('A zoom factor such as 1.25.') },
      mutates: true,
      requires: ['web-page'],
      run: async (p) => {
        if (!hasPage) return failure('unavailable', 'Open a page first.')
        if (typeof p.factor === 'number') setZoom(Math.min(5, Math.max(0.25, p.factor)))
        else if (p.action === 'in') stepZoom(1)
        else if (p.action === 'out') stepZoom(-1)
        else if (p.action === 'reset') setZoom(1)
        else return failure('invalid-params', 'Give action (in, out, reset) or factor.')
        const before = active.zoom
        const expectChange = !(p.action === 'reset' && before === 1) && !(typeof p.factor === 'number' && p.factor === before)
        await waitUntil(() => !expectChange || liveTab(active.id)?.zoom !== before, 1500)
        const now = liveTab(active.id)?.zoom ?? before
        return verified(`Zoom is ${Math.round(now * 100)}%.`, { zoom: now })
      }
    },
    {
      id: 'browser.showPanel',
      domain: 'browser',
      name: 'Show a browser panel',
      description: 'Opens the History, Downloads, Bookmarks or Recently closed panel, or closes it (none).',
      params: { panel: str('history, downloads, bookmarks, closed or none', true, { enum: ['history', 'downloads', 'bookmarks', 'closed', 'none'] }) },
      mutates: true,
      run: async (p) => {
        const panel = p.panel === 'none' ? null : (p.panel as LibraryTab)
        setMenuOpen(false)
        setLibrary(panel)
        const ok = await waitUntil(() => live.current.library === panel)
        return ok ? verified(panel ? `The ${panel} panel is open.` : 'The panel is closed.') : unverified('The panel did not change.')
      }
    },
    {
      id: 'browser.restoreSession',
      domain: 'browser',
      name: 'Restore last session',
      description: 'Reopens the pages (and tab groups) that were open when the browser was last used.',
      params: {},
      mutates: true,
      run: async () => {
        if (!restorable.length) return failure('not-found', 'There is nothing from last time to restore.')
        const count = restorable.length
        restoreSession()
        const ok = await waitUntil(() => restorable.every((url) => live.current.tabs.some((t) => t.url && sameUrl(t.url, url))), 3000)
        return ok ? verified(`Restored ${count} tab${count === 1 ? '' : 's'}.`) : unverified('Not every page came back.')
      }
    },
    {
      id: 'tabs.list',
      domain: 'tabs',
      name: 'List tabs',
      description: 'Every tab with its id, position, address, title, loading state, pin, group, sound and zoom.',
      params: {},
      mutates: false,
      run: () => readResult(tabs.map((t, index) => ({ id: t.id, index, url: t.url, title: t.customTitle || t.title, active: t.id === activeId, loading: t.loading, pinned: Boolean(t.pinned), private: Boolean(t.private), groupId: t.groupId ?? null, muted: Boolean(t.muted) || mutedHosts.includes(hostOf(t.url)), zoom: t.zoom, error: t.error ?? null })))
    }
  ]
  useControlScope('browser-panel', capabilities)
  useControlRendered()

  const immersive = windowFullscreen && mode === 'full' && !hidden && !htmlFullscreen
  const className = ['browser-panel', mode, hidden ? 'to-chat' : '', resizing ? 'resizing' : '', picking ? 'picking' : '', htmlFullscreen ? 'html-fullscreen' : '', immersive ? 'immersive' : ''].filter(Boolean).join(' ')
  const modeLabel = mode === 'full' ? 'Full page' : mode === 'dock' ? 'Docked' : `${windowSize.width} × ${windowSize.height}`

  return (
    <section
      ref={sectionRef}
      className={className}
      style={mode === 'dock' ? { width } : mode === 'window' ? { width: windowSize.width, height: windowSize.height } : undefined}
      aria-label="Browser"
      aria-hidden={hidden || undefined}
      inert={hidden}
      data-mode={mode}
    >
      {mode === 'dock' && <div className="browser-resizer" onPointerDown={startResize} aria-hidden="true" />}
      {mode === 'window' && <div className="browser-window-grip" onPointerDown={startWindowResize} title="Drag to resize" aria-hidden="true" />}

      {immersive && (
        <div
          className="browser-tab-reveal"
          aria-hidden="true"
          onMouseEnter={() => {
            revealedAt.current = Date.now()
            setTabsRevealed(true)
          }}
        />
      )}
      <div className="browser-tabs-row">
        <button type="button" className="browser-back-chat" title="Back to the Orbis chat. The browser stays open" onClick={onBackToChat}>
          <ArrowLeft size={15} />
          <span>Chat</span>
        </button>
        <div className="browser-nav">
          <button type="button" className="b-icon" aria-label="Back" title="Back" disabled={!active.back} onClick={() => view()?.goBack()}>
            <ArrowLeft size={15} />
          </button>
          <button type="button" className="b-icon" aria-label="Forward" title="Forward" disabled={!active.forward} onClick={() => view()?.goForward()}>
            <ArrowRight size={15} />
          </button>
          <button
            type="button"
            className="b-icon"
            aria-label={active.loading ? 'Stop' : 'Reload'}
            title={active.loading ? 'Stop loading' : 'Reload (F5)'}
            disabled={!hasPage}
            onClick={() => (active.loading ? view()?.stop() : view()?.reload())}
          >
            {active.loading ? <X size={15} /> : <RotateCw size={14} />}
          </button>
        </div>
        <div className="browser-tabs" role="tablist">
          {tabs.map((tab, i) => {
            const group = tab.groupId ? groups.find((g) => g.id === tab.groupId) : undefined
            const groupStarts = group && tabs[i - 1]?.groupId !== group.id
            const name = tab.customTitle || tab.title || 'New tab'
            const muted = mutedHosts.includes(hostOf(tab.url))
            return (
            <Fragment key={tab.id}>
            {groupStarts &&
              (renamingGroup === group.id ? (
                <input
                  className="tab-group-chip tab-group-rename"
                  style={{ '--group-color': group.color } as React.CSSProperties}
                  aria-label="Group name"
                  defaultValue={group.name}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    renameGroup(group.id, e.currentTarget.value)
                    setRenamingGroup(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    else if (e.key === 'Escape') setRenamingGroup(null)
                  }}
                />
              ) : (
                <span
                  className={`tab-group-chip${group.collapsed ? ' collapsed' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-expanded={!group.collapsed}
                  aria-label={`Group ${group.name}, ${group.collapsed ? 'collapsed' : 'expanded'}`}
                  style={{ '--group-color': group.color } as React.CSSProperties}
                  title={`${group.name}: click to ${group.collapsed ? 'expand' : 'collapse'}, double-click to rename`}
                  onClick={() => setGroupCollapsed(group.id, !group.collapsed)}
                  onDoubleClick={() => setRenamingGroup(group.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setGroupCollapsed(group.id, !group.collapsed)
                    } else if (e.key === 'F2') setRenamingGroup(group.id)
                  }}
                >
                  {group.name}
                  <button
                    type="button"
                    className="tab-group-ungroup"
                    aria-label={`Ungroup ${group.name}`}
                    title="Ungroup"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteGroup(group.id)
                    }}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            {!(group?.collapsed && tab.id !== active.id) && (
            <div
              role="tab"
              aria-selected={tab.id === active.id}
              aria-label={`${name}${tab.pinned ? ', pinned' : ''}${group ? `, in ${group.name}` : ''}${muted ? ', muted' : tab.audible ? ', playing sound' : ''}`}
              tabIndex={tab.id === active.id ? 0 : -1}
              className={`browser-tab${tab.id === active.id ? ' active' : ''}${tab.pinned ? ' pinned' : ''}${group ? ' grouped' : ''}${tab.private ? ' private' : ''}${split && (split.left === tab.id || split.right === tab.id) ? ' split' : ''}`}
              style={group ? ({ '--group-color': group.color } as React.CSSProperties) : undefined}
              title={name}
              draggable
              onClick={() => setActiveId(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                openTabMenu(tab.id, e.clientX, e.clientY)
              }}
              onAuxClick={(e) => {
                if (e.button === 1) closeTab(tab.id)
              }}
              onDragStart={(e) => {
                dragTab.current = tab.id
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (dragTab.current) e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                const from = dragTab.current
                dragTab.current = null
                if (from && from !== tab.id) moveTab(from, i)
              }}
              onDragEnd={() => {
                dragTab.current = null
              }}
              onKeyDown={(e) => {
                // Arrow keys move between tabs, as in a tab list; Delete closes the tab.
                const siblings = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])]
                const go = (to: number): void => {
                  e.preventDefault()
                  const target = tabs[to]
                  if (!target) return
                  setActiveId(target.id)
                  siblings[to]?.focus()
                }
                if (e.key === 'Enter' || e.key === ' ') go(i)
                else if (e.key === 'ArrowRight') go((i + 1) % tabs.length)
                else if (e.key === 'ArrowLeft') go((i - 1 + tabs.length) % tabs.length)
                else if (e.key === 'Home') go(0)
                else if (e.key === 'End') go(tabs.length - 1)
                else if (e.key === 'Delete') {
                  e.preventDefault()
                  closeTab(tab.id)
                } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                  e.preventDefault()
                  const box = e.currentTarget.getBoundingClientRect()
                  openTabMenu(tab.id, box.left, box.bottom + 4)
                }
              }}
            >
              {tab.loading ? (
                <LoaderCircle size={14} className="tab-icon spin" />
              ) : tab.customIcon ? (
                <span className="tab-emoji" aria-hidden="true">
                  {tab.customIcon}
                </span>
              ) : tab.favicon ? (
                <img className="tab-icon" src={tab.favicon} alt="" onError={() => patch(tab.id, { favicon: undefined })} />
              ) : (
                <Globe size={14} className="tab-icon" />
              )}
              <span className="truncate">{name}</span>
              {tab.private && !tab.pinned && <HatGlasses size={12} className="tab-private-icon" aria-label="Private tab" />}
              {(muted || tab.audible) && !tab.pinned && (
                <span className="tab-audio" title={muted ? 'Site muted' : 'Playing sound'}>
                  {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                </span>
              )}
              <button
                type="button"
                className="browser-tab-close"
                aria-label={`Close ${name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
              >
                <X size={12} />
              </button>
            </div>
            )}
            </Fragment>
            )
          })}
          <button type="button" className="b-icon" aria-label="New tab" title="New tab (Ctrl+T)" onClick={() => openTab()}>
            <Plus size={17} />
          </button>
        </div>

        {agentActive && (
          <div className="browser-agent-banner" role="status">
            <OrbisMark size={14} />
            <span className="truncate" title={`Orbis is using this tab${agentStatus ? ` · ${agentStatus}` : ''}`}>
              Orbis is using this tab
              {agentStatus ? ` · ${agentStatus}` : ''}
            </span>
            {onPauseAgent && (
              <button type="button" onClick={onPauseAgent}>
                Pause
              </button>
            )}
            <button type="button" onClick={onStopAgent}>
              Stop
            </button>
          </div>
        )}

        <div className="browser-window-actions">
          <ExtensionsToolbar requestedPopup={extensionPopup} onPopupShown={() => setExtensionPopup(null)} onOpenTab={(url) => openTab(url)} onNotify={onNotify} />
          <span className="browser-mode-badge" role="status" title="How the browser is shown now. Change the size next to the URL bar">
            {modeLabel}
          </span>
          <button
            type="button"
            className={`b-icon${mode === 'dock' ? ' active' : ''}`}
            aria-label={mode === 'dock' ? 'Undock browser' : 'Dock browser'}
            aria-pressed={mode === 'dock'}
            title={mode === 'dock' ? 'Show as a window' : 'Dock beside the chat'}
            onClick={() => onModeChange(mode === 'dock' ? 'window' : 'dock')}
          >
            <PanelRight size={16} />
          </button>
          <div className="browser-menu-anchor" ref={menuRef}>
            <button type="button" className="b-icon" aria-label="More options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              <EllipsisVertical size={16} />
            </button>
            {menuOpen && (
              <div className="popover glass browser-menu" role="menu">
                <AdBlockSection
                  pageUrl={active.url}
                  getWebContentsId={() => {
                    try {
                      return view()?.getWebContentsId() ?? null
                    } catch {
                      return null
                    }
                  }}
                />
                <button type="button" role="menuitem" className="menu-item" disabled={!hasPage} onClick={menuAction(() => void markup())}>
                  <Pencil size={14} />
                  Screenshot and mark up
                </button>
                <button type="button" role="menuitem" className="menu-item" disabled={!hasPage} onClick={menuAction(() => void pick())}>
                  <MousePointer2 size={14} />
                  {picking ? 'Cancel picking' : 'Pick an element to ask Orbis'}
                </button>
                <button type="button" role="menuitemcheckbox" aria-checked={active.mobile} className="menu-item" disabled={!hasPage} onClick={menuAction(toggleMobile)}>
                  <Smartphone size={14} />
                  {active.mobile ? 'Back to desktop view' : 'Mobile view'}
                </button>
                <button type="button" role="menuitem" className="menu-item" disabled={!hasPage} onClick={menuAction(() => void window.api.openExternal(active.url))}>
                  <ExternalLink size={14} />
                  Open in default browser
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  disabled={!hasPage}
                  onClick={menuAction(() => void copyText(active.url).then(() => onNotify('Link copied.')))}
                >
                  <Copy size={14} />
                  Copy link
                </button>
                <button type="button" role="menuitem" className="menu-item" disabled={!isWebUrl(active.url)} onClick={menuAction(() => void toggleBookmark())}>
                  <Star size={14} />
                  Bookmark this page
                  <kbd>Ctrl+D</kbd>
                </button>
                <button type="button" role="menuitem" className="menu-item" onClick={() => toggleLibrary('bookmarks')}>
                  <Bookmark size={14} />
                  Bookmarks
                  <kbd>Ctrl+Shift+B</kbd>
                </button>
                <button type="button" role="menuitem" className="menu-item" onClick={() => toggleLibrary('history')}>
                  <Clock size={14} />
                  History
                  <kbd>Ctrl+H</kbd>
                </button>
                <button type="button" role="menuitem" className="menu-item" onClick={() => toggleLibrary('downloads')}>
                  <Download size={14} />
                  Downloads
                  <kbd>Ctrl+J</kbd>
                </button>
                <button type="button" role="menuitem" className="menu-item" onClick={() => toggleLibrary('closed')}>
                  <RotateCcw size={14} />
                  Recently closed tabs
                  <kbd>Ctrl+Shift+T</kbd>
                </button>
                {restorable.length > 0 && (
                  <button type="button" role="menuitem" className="menu-item" title={restorable.join('\n')} onClick={menuAction(restoreSession)}>
                    <RotateCcw size={14} />
                    Restore last session ({restorable.length} tab{restorable.length === 1 ? '' : 's'})
                  </button>
                )}
                <button type="button" role="menuitem" className="menu-item" disabled={!hasPage} onClick={openFind}>
                  <Search size={14} />
                  Find in page
                  <kbd>Ctrl+F</kbd>
                </button>
                <button type="button" role="menuitem" className="menu-item" disabled={!hasPage} onClick={menuAction(() => void view()?.print().catch(() => undefined))}>
                  <Printer size={14} />
                  Print
                  <kbd>Ctrl+P</kbd>
                </button>
                <button type="button" role="menuitem" className="menu-item" disabled={!isWebUrl(active.url)} onClick={menuAction(() => void savePage())}>
                  <Save size={14} />
                  Save page as
                  <kbd>Ctrl+S</kbd>
                </button>
                <button type="button" role="menuitem" className="menu-item" disabled={!isWebUrl(active.url)} onClick={menuAction(viewSource)}>
                  <FileCode size={14} />
                  View page source
                  <kbd>Ctrl+U</kbd>
                </button>
                <button type="button" role="menuitem" className="menu-item" onClick={menuAction(() => void toggleFullscreen())}>
                  <Expand size={14} />
                  Fullscreen
                  <kbd>F11</kbd>
                </button>
                <div className="browser-zoom-row">
                  <span>Zoom</span>
                  <button type="button" className="b-icon" aria-label="Zoom out" disabled={!hasPage} onClick={() => stepZoom(-1)}>
                    <ZoomOut size={14} />
                  </button>
                  <button type="button" className="browser-zoom-value" aria-label="Reset zoom" title="Reset zoom" disabled={!hasPage} onClick={() => setZoom(1)}>
                    {Math.round(active.zoom * 100)}%
                  </button>
                  <button type="button" className="b-icon" aria-label="Zoom in" disabled={!hasPage} onClick={() => stepZoom(1)}>
                    <ZoomIn size={14} />
                  </button>
                </div>
                <button type="button" role="menuitem" className="menu-item" disabled={!hasPage} onClick={menuAction(toggleDevTools)}>
                  <Code size={14} />
                  Developer tools
                  <kbd>F12</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item danger"
                  onClick={menuAction(() => void window.api.clearBrowserData().then(() => onNotify('Browsing data cleared.')))}
                >
                  <Trash2 size={14} />
                  Clear browsing data
                </button>
              </div>
            )}
          </div>
          <span className="b-sep" />
          <button
            type="button"
            className="b-icon"
            aria-label="Pop out"
            title="Open in a separate window"
            disabled={!hasPage}
            onClick={() => void window.api.popOutBrowser(active.url)}
          >
            <PictureInPicture2 size={16} />
          </button>
        </div>
      </div>

      {findOpen && (
        <div className="browser-find">
          <Search size={14} />
          <input
            ref={findRef}
            value={findText}
            placeholder="Find in page"
            aria-label="Find in page"
            onChange={(e) => {
              setFindText(e.target.value)
              find(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') find(findText, !e.shiftKey, true)
              if (e.key === 'Escape') closeFind()
            }}
          />
          <span>{findResult ? `${findResult.active}/${findResult.total}` : ''}</span>
          <button type="button" className="b-icon" aria-label="Previous match" onClick={() => find(findText, false, true)}>
            <ChevronUp size={15} />
          </button>
          <button type="button" className="b-icon" aria-label="Next match" onClick={() => find(findText, true, true)}>
            <ChevronDown size={15} />
          </button>
          <button type="button" className="b-icon" aria-label="Close find" onClick={closeFind}>
            <X size={15} />
          </button>
        </div>
      )}

      <div className="browser-body">
        {hasPage && GOOGLE_SIGNIN_REJECTED.test(active.url) && (
          <div className="browser-signin-notice" role="alert">
            <p>
              <b>Google doesn't allow signing in inside apps' built-in browsers.</b>{' '}
              <span>This is Google's own security rule for every app, not a problem with your account. Sign in with your usual browser instead.</span>
            </p>
            <button type="button" className="primary" onClick={() => void window.api.openExternal(GOOGLE_SIGNIN_URL)}>
              Sign in with your browser
            </button>
            {active.back && (
              <button type="button" onClick={() => view()?.goBack()}>
                Go back
              </button>
            )}
          </div>
        )}
        {blockedNav && blockedNav.tabId === active.id && (
          <div className="browser-blocked-nav" role="status">
            <span className="truncate" title={blockedNav.url}>
              Blocked an ad redirect: {blockedNav.reason}.
            </span>
            <button
              type="button"
              onClick={() => {
                const { tabId, url } = blockedNav
                setBlockedNav(null)
                void window.api.allowAdBlockResource(url).then(() => views.current.get(tabId)?.loadURL(url).catch(() => undefined))
              }}
            >
              Open anyway
            </button>
            <button type="button" className="b-icon" aria-label="Dismiss" onClick={() => setBlockedNav(null)}>
              <X size={13} />
            </button>
          </div>
        )}
        {deviceRequest && (
          <Suspense fallback={null}>
            <DeviceChooser
              request={deviceRequest}
              onAnswer={(deviceId) => {
                void window.api.answerDeviceRequest(deviceRequest.id, deviceId)
                setDeviceRequest(null)
              }}
            />
          </Suspense>
        )}
        {permissions[0] && (
          <div className="browser-permission" role="alertdialog" aria-label="Site permission request">
            <Globe size={14} />
            <span className="truncate" title={permissions[0].origin}>
              <b>{hostOf(permissions[0].origin) || permissions[0].origin}</b> wants to {permissions[0].label}
            </span>
            <label className="browser-permission-remember">
              <input type="checkbox" checked={rememberPermission} onChange={(e) => setRememberPermission(e.target.checked)} />
              Remember
            </label>
            <button type="button" onClick={() => answerPermission(false)}>
              Block
            </button>
            <button type="button" className="primary" onClick={() => answerPermission(true)}>
              Allow
            </button>
          </div>
        )}
        {library && (
          <BrowserLibraryPanel
            tab={library}
            onTab={setLibrary}
            onClose={() => setLibrary(null)}
            onOpen={(url) => {
              setLibrary(null)
              if (active.url) openTab(url)
              else navigate(url)
            }}
            closedTabs={closedTabs}
            onReopen={(position) => {
              setLibrary(null)
              reopenTab(position)
            }}
          />
        )}
        {hasPage && orb && <BrowserOrb {...orb} />}
        {active.loading && <div className="browser-loading-bar" />}
        {[...tabs]
          .sort((a, b) => a.seq - b.seq)
          .map(
            (tab) =>
              tab.url && (
                <TabView
                  partition={profile.partition}
                  key={`${tab.id}:${tab.generation}:${tab.private ? PRIVATE_PARTITION : profile.partition}`}
                  tab={tab}
                  active={tab.id === active.id}
                  split={split?.left === tab.id ? 'left' : split?.right === tab.id ? 'right' : undefined}
                  muted={Boolean(tab.muted) || mutedHosts.includes(hostOf(tab.url))}
                  onActivate={setActiveId}
                  onRegister={registerView}
                  onUpdate={patch}
                  onFound={onFound}
                  onNavigated={onNavigated}
                  onFullscreen={setHtmlFullscreen}
                />
              )
          )}
        <ExtensionPrompts />
        {split && (
          <div className="browser-split-divider">
            <button type="button" className="browser-split-close" aria-label="Close split view" title="Close split view" onClick={() => setSplit(null)}>
              <X size={12} />
            </button>
          </div>
        )}
        {tabMenu &&
          (() => {
            const tab = tabs.find((t) => t.id === tabMenu.id)
            if (!tab) return null
            const index = tabs.indexOf(tab)
            return (
              <TabContextMenu
                x={tabMenu.x}
                y={tabMenu.y}
                tab={tab}
                groups={groups}
                inSplit={Boolean(split && (split.left === tab.id || split.right === tab.id))}
                bookmarked={bookmarkUrls.some((u) => sameUrl(u, tab.url))}
                muted={mutedHosts.includes(hostOf(tab.url))}
                hasOthers={tabs.some((t) => t.id !== tab.id && !t.pinned)}
                hasRight={tabs.slice(index + 1).some((t) => !t.pinned)}
                isFirst={index === (tab.pinned ? 0 : tabs.filter((t) => t.pinned).length)}
                isLast={index === (tab.pinned ? tabs.filter((t) => t.pinned).length - 1 : tabs.length - 1)}
                onAction={(action) => tabAction(tab.id, action)}
                onClose={() => setTabMenu(null)}
              />
            )
          })()}
        {editTab &&
          (() => {
            const tab = tabs.find((t) => t.id === editTab.id)
            if (!tab) return null
            return (
              <TabEditDialog
                x={editTab.x}
                y={editTab.y}
                name={tab.customTitle ?? ''}
                icon={tab.customIcon ?? ''}
                pageTitle={tab.title}
                onSave={(customTitle, customIcon) => {
                  patch(tab.id, { customTitle: customTitle || undefined, customIcon: customIcon || undefined })
                  setEditTab(null)
                }}
                onCancel={() => setEditTab(null)}
              />
            )
          })()}
        {!hasPage && (
          <div className="browser-newtab" style={widgets.wallpaper && !active.private ? { background: widgets.wallpaper } : undefined}>
            <OrbisMark size={40} />
            {active.private && (
              <p className="browser-private-note">
                <HatGlasses size={16} aria-hidden="true" />
                You’re in a private tab. Pages you visit aren’t saved to history, and cookies and site data are deleted when you close your last private tab. Downloads and bookmarks you make are kept.
              </p>
            )}
            <button type="button" className="browser-newtab-hint" onClick={focusUrlBar}>
              <Search size={15} />
              Type a URL or search in the bar above
            </button>
            <ShortcutsGrid onOpen={(url) => navigate(url)} />
            {widgets.on && !active.private && (
              <WidgetHost
                widgets={widgets.widgets}
                onChange={widgets.save}
                onOpen={(what) => (what.kind === 'url' ? navigate(what.value) : onOpenOrbisView?.(what.value))}
              />
            )}
            {restorable.length > 0 && tabs.length === 1 && (
              <button type="button" className="browser-retry browser-restore" onClick={restoreSession} title={restorable.join('\n')}>
                <RotateCcw size={13} />
                Restore {restorable.length} tab{restorable.length === 1 ? '' : 's'} from last time
              </button>
            )}
            <div className="browser-quick">
              {QUICK_LINKS.map((link) => (
                <button key={link.url} type="button" onClick={() => navigate(link.url)}>
                  {link.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* One offline page per tab, so each keeps its own game; only the shown tab's plays. */}
        {tabs
          .filter((t) => t.offline)
          .map((t) => {
            const failure = classifyLoadFailure(t.offline!.code)
            return (
              <div key={`offline-${t.id}`} className="browser-offline" hidden={t.id !== activeId}>
                <Suspense fallback={null}>
                  <OfflineGames url={t.offline!.url} kind={failure.kind} reason={failure.reason} active={t.id === activeId} retrying={t.loading} onRetry={() => navigate(t.offline!.url, t.id)} />
                </Suspense>
              </div>
            )
          })}
        {hasPage && active.error && !active.offline && (
          <div className="browser-error">
            <Globe size={28} />
            <b>{active.crashed ? 'This tab crashed' : "This page can't be reached"}</b>
            <span>{active.error}</span>
            <button type="button" className="browser-retry" onClick={() => (active.crashed ? restartTab(active.id) : navigate(active.url))}>
              {active.crashed ? 'Reload tab' : 'Try again'}
            </button>
          </div>
        )}
        {resizing && <div className={`browser-drag-shield${mode === 'window' ? ' corner' : ''}`} />}
      </div>
    </section>
  )
}

interface TabViewProps {
  /** The session ordinary tabs browse in: the profile in use. */
  partition: string
  tab: Tab
  active: boolean
  onRegister(id: string, webview: Webview | null): void
  onUpdate(id: string, changes: Partial<Tab>): void
  onFound(id: string, result: { activeMatchOrdinal: number; matches: number }): void
  /** The tab arrived at a new page. */
  onNavigated(id: string, url: string): void
  /** The page entered or left fullscreen (a video's fullscreen button, say). */
  onFullscreen(on: boolean): void
  /** Which side of split view this tab fills. */
  split?: 'left' | 'right'
  /** Its site is muted. */
  muted: boolean
  /** The user clicked into this page (in split view, that makes it the active tab). */
  onActivate(id: string): void
}

function TabView({ tab, active, split, muted, partition, onActivate, onRegister, onUpdate, onFound, onNavigated, onFullscreen }: TabViewProps): React.JSX.Element {
  const ref = useRef<Webview | null>(null)
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate

  // Muting only works once the page is ready, so it is applied again on every dom-ready.
  useEffect(() => {
    try {
      ref.current?.setAudioMuted(muted)
    } catch {
      // Not ready yet; dom-ready applies it.
    }
  }, [muted])

  useEffect(() => {
    const webview = ref.current
    if (!webview) return
    const id = tab.id
    const apply = (): void => {
      try {
        webview.setAudioMuted(mutedRef.current)
      } catch {
        // The page went away.
      }
    }
    const listeners: [string, () => void][] = [
      ['dom-ready', apply],
      ['media-started-playing', () => onUpdate(id, { audible: true })],
      ['media-paused', () => onUpdate(id, { audible: false })],
      ['did-start-navigation', () => onUpdate(id, { audible: false })],
      ['focus', () => onActivateRef.current(id)]
    ]
    for (const [name, listener] of listeners) webview.addEventListener(name, listener)
    return () => {
      for (const [name, listener] of listeners) webview.removeEventListener(name, listener)
    }
  }, [tab.id, onUpdate])
  // src is only read on mount; later navigation goes through loadURL so React never reloads the page.
  const [src] = useState(tab.url)
  const onFoundRef = useRef(onFound)
  onFoundRef.current = onFound
  const onNavigatedRef = useRef(onNavigated)
  onNavigatedRef.current = onNavigated
  const onFullscreenRef = useRef(onFullscreen)
  onFullscreenRef.current = onFullscreen

  useEffect(() => {
    const webview = ref.current
    if (!webview) return
    const id = tab.id
    onRegister(id, webview)
    const history = (): Partial<Tab> => ({ back: webview.canGoBack(), forward: webview.canGoForward() })
    const listeners: [string, (e: Event) => void][] = [
      [
        'did-navigate',
        () => {
          onUpdate(id, { url: webview.getURL(), error: undefined, offline: undefined, ...history() })
          onNavigatedRef.current(id, webview.getURL())
        }
      ],
      [
        'render-process-gone',
        () => {
          onUpdate(id, { loading: false, crashed: true, error: 'Something went wrong while showing this page. Reloading starts it again.' })
          onFullscreenRef.current(false)
        }
      ],
      ['enter-html-full-screen', () => onFullscreenRef.current(true)],
      ['leave-html-full-screen', () => onFullscreenRef.current(false)],
      ['did-navigate-in-page', () => onUpdate(id, { url: webview.getURL(), ...history() })],
      ['page-title-updated', (e) => onUpdate(id, { title: (e as Event & { title: string }).title })],
      ['page-favicon-updated', (e) => onUpdate(id, { favicon: (e as Event & { favicons: string[] }).favicons[0] })],
      ['did-start-loading', () => onUpdate(id, { loading: true })],
      ['did-stop-loading', () => onUpdate(id, { loading: false, ...history() })],
      [
        'did-fail-load',
        (e) => {
          const event = e as Event & { errorCode: number; errorDescription: string; isMainFrame: boolean; validatedURL: string }
          // -3 is an aborted load, e.g. the user navigated away before it finished.
          if (event.isMainFrame && event.errorCode !== -3) {
            const failedUrl = event.validatedURL || webview.getURL()
            onUpdate(id, {
              loading: false,
              url: failedUrl,
              error: `${event.errorDescription || 'The page failed to load'} (${event.errorCode})`,
              offline: classifyLoadFailure(event.errorCode).offline ? { code: event.errorCode, url: failedUrl } : undefined
            })
          }
        }
      ],
      ['found-in-page', (e) => onFoundRef.current(id, (e as Event & { result: { activeMatchOrdinal: number; matches: number } }).result)]
    ]
    for (const [name, listener] of listeners) webview.addEventListener(name, listener)
    return () => {
      for (const [name, listener] of listeners) webview.removeEventListener(name, listener)
      onRegister(id, null)
    }
  }, [tab.id, onRegister, onUpdate])

  return (
    <webview
      ref={ref as React.Ref<HTMLWebViewElement>}
      src={src}
      partition={tab.private ? PRIVATE_PARTITION : partition}
      useragent={tab.mobile ? MOBILE_UA : DESKTOP_UA}
      className={`browser-view${active ? ' active' : ''}${split ? ` split-${split}` : ''}${tab.mobile && !split ? ' mobile' : ''}`}
      {...POPUPS}
    />
  )
}
