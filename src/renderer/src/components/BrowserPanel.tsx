import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Code,
  Copy,
  EllipsisVertical,
  ExternalLink,
  Globe,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MousePointer2,
  PanelRight,
  Pencil,
  PictureInPicture2,
  Plus,
  RotateCw,
  Search,
  Smartphone,
  Trash2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { NoticeKind } from '../App'
import { copyText, newId } from '../lib/utils'
import { useDismiss } from '../lib/useDismiss'
import { OrbisMark } from './Brand'

type Webview = HTMLElement & {
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  getURL(): string
  loadURL(url: string): Promise<void>
  setUserAgent(userAgent: string): void
  setZoomFactor(factor: number): void
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean }): number
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  capturePage(): Promise<{ toDataURL(): string; isEmpty(): boolean }>
  openDevTools(): void
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

function toUrl(input: string): string {
  const text = input.trim()
  if (/^https?:\/\//i.test(text)) return text
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/\S*)?$/i.test(text)) return `http://${text}`
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(text)) return `https://${text}`
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`
}

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

const createTab = (url = ''): Tab => ({ id: newId(), url, title: url || 'New tab', loading: Boolean(url), back: false, forward: false, mobile: false, zoom: 1 })

export default function BrowserPanel({ onClose, onEditScreenshot, onNotify }: Props): React.JSX.Element {
  const [firstTab] = useState(createTab)
  const [tabs, setTabs] = useState<Tab[]>([firstTab])
  const [activeId, setActiveId] = useState(firstTab.id)
  const [address, setAddress] = useState('')
  const [typing, setTyping] = useState(false)
  const [layout, setLayout] = useState<'dock' | 'float'>(() => (stored('orbis.browser.layout') === 'float' ? 'float' : 'dock'))
  const [maximized, setMaximized] = useState(false)
  const [width, setWidth] = useState(() => Number(stored('orbis.browser.width')) || 560)
  const [resizing, setResizing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [findResult, setFindResult] = useState<{ active: number; total: number } | null>(null)
  const [picking, setPicking] = useState(false)
  const views = useRef(new Map<string, Webview>())
  const addressRef = useRef<HTMLInputElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useDismiss(menuRef, menuOpen, () => setMenuOpen(false))

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]
  const view = (): Webview | undefined => views.current.get(active.id)
  const hasPage = Boolean(active.url)

  const patch = useCallback((id: string, changes: Partial<Tab>) => {
    setTabs((list) => list.map((t) => (t.id === id ? { ...t, ...changes } : t)))
  }, [])

  const openTab = useCallback((url = '') => {
    const tab = createTab(url)
    setTabs((list) => [...list, tab])
    setActiveId(tab.id)
  }, [])

  useEffect(() => store('orbis.browser.layout', layout), [layout])
  useEffect(() => store('orbis.browser.width', String(width)), [width])
  useEffect(() => window.api.onBrowserNewTab((url) => openTab(url)), [openTab])

  useEffect(() => {
    if (!typing) setAddress(active.url)
  }, [active.id, active.url, typing])

  useEffect(() => {
    if (!active.url) requestAnimationFrame(() => addressRef.current?.focus())
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
    setTyping(false)
    addressRef.current?.blur()
    const webview = views.current.get(tabId)
    if (webview) {
      patch(tabId, { error: undefined })
      webview.loadURL(url).catch(() => undefined)
    } else {
      patch(tabId, { url, title: url, loading: true, error: undefined })
    }
  }

  const closeTab = (id: string): void => {
    const index = tabs.findIndex((t) => t.id === id)
    const rest = tabs.filter((t) => t.id !== id)
    if (!rest.length) return onClose()
    setTabs(rest)
    if (id === activeId) setActiveId(rest[Math.min(index, rest.length - 1)].id)
  }

  const setZoom = (zoom: number): void => {
    patch(active.id, { zoom })
    view()?.setZoomFactor(zoom)
  }
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

  const menuAction = (action: () => void): (() => void) => () => {
    action()
    setMenuOpen(false)
  }

  const className = ['browser-panel', maximized ? 'maximized' : layout, resizing ? 'resizing' : '', picking ? 'picking' : ''].filter(Boolean).join(' ')

  return (
    <section
      className={className}
      style={!maximized && layout === 'dock' ? { width } : undefined}
      aria-label="Browser"
      onKeyDown={(e) => {
        if (e.key === 'F5') {
          e.preventDefault()
          view()?.reload()
          return
        }
        if (!(e.ctrlKey || e.metaKey)) return
        const key = e.key.toLowerCase()
        if (key === 't') {
          e.preventDefault()
          openTab()
        } else if (key === 'w') {
          e.preventDefault()
          closeTab(active.id)
        } else if (key === 'l') {
          e.preventDefault()
          addressRef.current?.focus()
          addressRef.current?.select()
        } else if (key === 'f') {
          e.preventDefault()
          openFind()
        }
      }}
    >
      {!maximized && layout === 'dock' && <div className="browser-resizer" onPointerDown={startResize} aria-hidden="true" />}

      <div className="browser-tabs-row">
        <div className="browser-tabs" role="tablist">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === active.id}
              tabIndex={0}
              className={`browser-tab${tab.id === active.id ? ' active' : ''}`}
              title={tab.title}
              onClick={() => setActiveId(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) closeTab(tab.id)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setActiveId(tab.id)
              }}
            >
              {tab.loading ? (
                <LoaderCircle size={14} className="tab-icon spin" />
              ) : tab.favicon ? (
                <img className="tab-icon" src={tab.favicon} alt="" onError={() => patch(tab.id, { favicon: undefined })} />
              ) : (
                <Globe size={14} className="tab-icon" />
              )}
              <span className="truncate">{tab.title || 'New tab'}</span>
              <button
                type="button"
                className="browser-tab-close"
                aria-label={`Close ${tab.title || 'tab'}`}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button type="button" className="b-icon" aria-label="New tab" title="New tab (Ctrl+T)" onClick={() => openTab()}>
            <Plus size={17} />
          </button>
        </div>

        <div className="browser-window-actions">
          <button
            type="button"
            className="b-icon"
            aria-label={layout === 'dock' ? 'Float browser' : 'Dock browser'}
            title={layout === 'dock' ? 'Float as a window' : 'Dock beside the chat'}
            onClick={() => {
              setMaximized(false)
              setLayout(layout === 'dock' ? 'float' : 'dock')
            }}
          >
            <PanelRight size={16} />
          </button>
          <div className="browser-menu-anchor" ref={menuRef}>
            <button type="button" className="b-icon" aria-label="More options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              <EllipsisVertical size={16} />
            </button>
            {menuOpen && (
              <div className="popover glass browser-menu" role="menu">
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
                <button type="button" role="menuitem" className="menu-item" disabled={!hasPage} onClick={openFind}>
                  <Search size={14} />
                  Find in page
                  <kbd>Ctrl+F</kbd>
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
                <button type="button" role="menuitem" className="menu-item" disabled={!hasPage} onClick={menuAction(() => view()?.openDevTools())}>
                  <Code size={14} />
                  Developer tools
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
          <button type="button" className="b-icon" aria-label={maximized ? 'Restore' : 'Maximize'} title={maximized ? 'Restore' : 'Maximize'} onClick={() => setMaximized((m) => !m)}>
            {maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button type="button" className="b-icon" aria-label="Close browser" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
      </div>

      <div className="browser-nav-row">
        <button type="button" className="b-icon" aria-label="Back" title="Back" disabled={!active.back} onClick={() => view()?.goBack()}>
          <ArrowLeft size={16} />
        </button>
        <button type="button" className="b-icon" aria-label="Forward" title="Forward" disabled={!active.forward} onClick={() => view()?.goForward()}>
          <ArrowRight size={16} />
        </button>
        <button
          type="button"
          className="b-icon"
          aria-label={active.loading ? 'Stop' : 'Reload'}
          title={active.loading ? 'Stop' : 'Reload (F5)'}
          disabled={!hasPage}
          onClick={() => (active.loading ? view()?.stop() : view()?.reload())}
        >
          {active.loading ? <X size={16} /> : <RotateCw size={15} />}
        </button>
        <input
          ref={addressRef}
          className="browser-address"
          value={address}
          placeholder="Type a URL"
          aria-label="Address"
          spellCheck={false}
          onChange={(e) => {
            setTyping(true)
            setAddress(e.target.value)
          }}
          onFocus={(e) => e.target.select()}
          onBlur={() => setTyping(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate(address)
            if (e.key === 'Escape') {
              setTyping(false)
              setAddress(active.url)
              e.currentTarget.blur()
            }
          }}
        />
        <button type="button" className="b-icon" aria-label="Mark up page" title="Screenshot and mark up" disabled={!hasPage} onClick={() => void markup()}>
          <Pencil size={15} />
        </button>
        <button
          type="button"
          className={`b-icon${picking ? ' active' : ''}`}
          aria-label="Pick an element"
          aria-pressed={picking}
          title={picking ? 'Cancel picking (Esc)' : 'Pick an element to ask Orbis about'}
          disabled={!hasPage}
          onClick={() => void pick()}
        >
          <MousePointer2 size={15} />
        </button>
        <button
          type="button"
          className={`b-icon${active.mobile ? ' active' : ''}`}
          aria-label="Mobile view"
          aria-pressed={active.mobile}
          title={active.mobile ? 'Back to desktop view' : 'Mobile view'}
          disabled={!hasPage}
          onClick={toggleMobile}
        >
          <Smartphone size={15} />
        </button>
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
        {active.loading && <div className="browser-loading-bar" />}
        {tabs.map(
          (tab) =>
            tab.url && <TabView key={tab.id} tab={tab} active={tab.id === active.id} onRegister={registerView} onUpdate={patch} onFound={onFound} />
        )}
        {!hasPage && (
          <div className="browser-newtab">
            <OrbisMark size={44} />
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const input = new FormData(e.currentTarget).get('q')
                if (typeof input === 'string') navigate(input)
              }}
            >
              <Search size={16} />
              <input name="q" placeholder="Search Google or type a URL" aria-label="Search Google or type a URL" autoComplete="off" />
            </form>
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
            <b>This page can't be reached</b>
            <span>{active.error}</span>
            <button type="button" className="browser-retry" onClick={() => navigate(active.url)}>
              Try again
            </button>
          </div>
        )}
        {resizing && <div className="browser-drag-shield" />}
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
}

function TabView({ tab, active, onRegister, onUpdate, onFound }: TabViewProps): React.JSX.Element {
  const ref = useRef<Webview | null>(null)
  // src is only read on mount; later navigation goes through loadURL so React never reloads the page.
  const [src] = useState(tab.url)
  const onFoundRef = useRef(onFound)
  onFoundRef.current = onFound

  useEffect(() => {
    const webview = ref.current
    if (!webview) return
    const id = tab.id
    onRegister(id, webview)
    const history = (): Partial<Tab> => ({ back: webview.canGoBack(), forward: webview.canGoForward() })
    const listeners: [string, (e: Event) => void][] = [
      ['did-navigate', () => onUpdate(id, { url: webview.getURL(), error: undefined, ...history() })],
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
      className={`browser-view${active ? ' active' : ''}${tab.mobile ? ' mobile' : ''}`}
      {...POPUPS}
    />
  )
}
