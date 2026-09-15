import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
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
  LoaderCircle,
  Maximize2,
  Minimize2,
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
import type { BrowserPermissionRequest, BrowserShortcutEvent } from '../../../shared/types'
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
import type { TabGroup, TabMenuAction } from './TabContextMenu'

type Webview = HTMLElement & {
  setAudioMuted(muted: boolean): void
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  reloadIgnoringCache(): void
  stop(): void
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
  onPageChange?(page: { url: string; title: string } | null): void
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
const createTab = (url = ''): Tab => ({ id: newId(), url, title: url || 'New tab', loading: Boolean(url), back: false, forward: false, mobile: false, zoom: 1, generation: 0, seq: tabSeq++ })

const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url)
const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

const SESSION_KEY = 'orbis.browser.session'
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
  onLoadingChange
}: Props): React.JSX.Element {
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
  const [rememberPermission, setRememberPermission] = useState(false)
  /** A page went fullscreen (a video, say): the page fills the window. */
  const [htmlFullscreen, setHtmlFullscreen] = useState(false)
  /** The web pages open when the browser was last used, offered on the new tab page. */
  const [lastSession, setLastSession] = useState(lastSessionUrls)
  /** The mode to return to when F11 fullscreen ends. */
  const fullscreenRestore = useRef<BrowserMode | null>(null)
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

  const openTab = useCallback((url = '', activate = true) => {
    const tab = createTab(url)
    setTabs((list) => [...list, tab])
    if (activate) setActiveId(tab.id)
  }, [])

  useEffect(() => store('orbis.browser.width', String(width)), [width])
  // Ctrl+click and middle-click open links in the background; other links and "Open link in new tab" switch to them.
  useEffect(() => window.api.onBrowserNewTab((url, options) => openTab(url, !options.background)), [openTab])

  // The open web pages, so they can be restored next time.
  const tabUrls = tabs.map((t) => t.url).filter(isWebUrl)
  const tabUrlsKey = tabUrls.join('\n')
  useEffect(() => {
    if (tabUrls.length) store(SESSION_KEY, JSON.stringify(tabUrls.slice(0, 20)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabUrlsKey])

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
      webview.loadURL(url).catch(() => undefined)
    } else {
      patch(tabId, { url, title: url, loading: true, error: undefined })
    }
  }

  useEffect(() => {
    onPageChange?.(active.url ? { url: active.url, title: active.title } : null)
  }, [active.url, active.title, onPageChange])

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
    if (closing?.url) setClosedTabs((list) => [...list, { url: closing.url, title: closing.title, index }].slice(-25))
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
    const closedNow = tabs.flatMap((t, index) => (closing.has(t.id) && t.url ? [{ url: t.url, title: t.title, index }] : []))
    if (closedNow.length) setClosedTabs((list) => [...list, ...closedNow].slice(-25))
    const rest = tabs.filter((t) => !closing.has(t.id))
    if (!rest.length) return onClose()
    setTabs(rest)
    if (closing.has(activeId)) focusTab(rest[Math.min(tabs.findIndex((t) => t.id === activeId), rest.length - 1)])
  }

  const GROUP_COLORS = ['#3fd8ff', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#f87171', '#60a5fa']

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
      case 'new-group': {
        const group: TabGroup = { id: newId(), name: `Group ${groups.length + 1}`, color: GROUP_COLORS[groups.length % GROUP_COLORS.length] }
        setGroups((list) => [...list, group])
        patch(id, { groupId: group.id })
        return
      }
      case 'group': {
        patch(id, { groupId: action.groupId })
        // The tab joins the others in its group.
        const last = tabs.map((t) => t.groupId).lastIndexOf(action.groupId)
        if (last >= 0 && !tab.pinned) moveTab(id, Math.max(pinnedCount, last > index ? last : last + 1))
        return
      }
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
        const copy: Tab = { ...createTab(tab.url), title: tab.title, favicon: tab.favicon, customTitle: tab.customTitle, customIcon: tab.customIcon, groupId: tab.groupId, pinned: tab.pinned, mobile: tab.mobile }
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
    if (active.url) openTab(first)
    else navigate(first)
    for (const url of rest) openTab(url, false)
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

  const toggleMobile = (): void => {
    const mobile = !active.mobile
    patch(active.id, { mobile })
    const webview = view()
    if (!webview) return
    webview.setUserAgent(mobile ? MOBILE_UA : DESKTOP_UA)
    webview.reload()
  }

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

  const toggleFullPage = (): void => {
    if (mode === 'full') return onModeChange(restoreMode.current)
    restoreMode.current = mode
    onModeChange('full')
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
        if (active.crashed) return restartTab(active.id)
        if (active.error && hasPage) return navigate(active.url)
        if (event.action === 'reload') webview?.reload()
        else webview?.reloadIgnoringCache()
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

  const className = ['browser-panel', mode, hidden ? 'to-chat' : '', resizing ? 'resizing' : '', picking ? 'picking' : '', htmlFullscreen ? 'html-fullscreen' : ''].filter(Boolean).join(' ')
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
            {groupStarts && (
              <span className="tab-group-chip" style={{ '--group-color': group.color } as React.CSSProperties} title={`Group: ${group.name}`}>
                {group.name}
              </span>
            )}
            <div
              role="tab"
              aria-selected={tab.id === active.id}
              aria-label={`${name}${tab.pinned ? ', pinned' : ''}${group ? `, in ${group.name}` : ''}${muted ? ', muted' : tab.audible ? ', playing sound' : ''}`}
              tabIndex={tab.id === active.id ? 0 : -1}
              className={`browser-tab${tab.id === active.id ? ' active' : ''}${tab.pinned ? ' pinned' : ''}${group ? ' grouped' : ''}${split && (split.left === tab.id || split.right === tab.id) ? ' split' : ''}`}
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
          <button
            type="button"
            className="b-icon"
            aria-label={mode === 'full' ? 'Exit full page' : 'Full page'}
            title={mode === 'full' ? 'Exit full page' : 'Full page'}
            onClick={toggleFullPage}
          >
            {mode === 'full' ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button type="button" className="b-icon" aria-label="Close browser" title="Close" onClick={onClose}>
            <X size={17} />
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
                  key={`${tab.id}:${tab.generation}`}
                  tab={tab}
                  active={tab.id === active.id}
                  split={split?.left === tab.id ? 'left' : split?.right === tab.id ? 'right' : undefined}
                  muted={mutedHosts.includes(hostOf(tab.url))}
                  onActivate={setActiveId}
                  onRegister={registerView}
                  onUpdate={patch}
                  onFound={onFound}
                  onNavigated={onNavigated}
                  onFullscreen={setHtmlFullscreen}
                />
              )
          )}
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
          <div className="browser-newtab">
            <OrbisMark size={40} />
            <button type="button" className="browser-newtab-hint" onClick={focusUrlBar}>
              <Search size={15} />
              Type a URL or search in the bar above
            </button>
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
        {hasPage && active.error && (
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

function TabView({ tab, active, split, muted, onActivate, onRegister, onUpdate, onFound, onNavigated, onFullscreen }: TabViewProps): React.JSX.Element {
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
          onUpdate(id, { url: webview.getURL(), error: undefined, ...history() })
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
            onUpdate(id, { loading: false, url: event.validatedURL || webview.getURL(), error: `${event.errorDescription || 'The page failed to load'} (${event.errorCode})` })
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
      partition="persist:browser"
      useragent={tab.mobile ? MOBILE_UA : DESKTOP_UA}
      className={`browser-view${active ? ' active' : ''}${split ? ` split-${split}` : ''}${tab.mobile && !split ? ' mobile' : ''}`}
      {...POPUPS}
    />
  )
}
