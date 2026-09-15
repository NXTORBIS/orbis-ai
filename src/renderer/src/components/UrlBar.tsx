import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Clock,
  Globe,
  Image as ImageIcon,
  LoaderCircle,
  Lock,
  Newspaper,
  PanelTop,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  Video,
  X
} from 'lucide-react'
import { sameUrl } from '../../../shared/research'
import { buildSuggestions, isAddress, pickKey, queryKey, recentSuggestions, toUrl } from '../../../shared/omnibox'
import type { OmniSuggestion } from '../../../shared/omnibox'
import type { BrowserLibrarySnapshot } from '../../../shared/types'
import type { NoticeKind } from '../App'
import OrionAnswer from './OrionAnswer'

interface Props {
  /** The Orbis browser's current page URL, or empty when no page is open. */
  url: string
  /** The current page's title, for bookmarking. */
  title?: string
  onNavigate(input: string, options?: { newTab?: boolean }): void
  /** The active tab's page is loading. */
  loading?: boolean
  /** The browser is open but the user went back to the chat. */
  browserHidden?: boolean
  onShowBrowser?(): void
  /** The browser size preference control. */
  sizeControl?: ReactNode
  /** Questions Orion researched in saved chats. */
  research?: { question: string; at: number }[]
  /** The current chat is incognito: nothing personal is suggested or remembered. */
  incognito?: boolean
  searchSuggestions?: boolean
  personalizedSuggestions?: boolean
  /** The model and assistant that answer Ctrl+Enter questions. */
  askModel: string
  askPersona: string
  onNotify(message: string, kind?: NoticeKind): void
}

const EMPTY_LIBRARY: BrowserLibrarySnapshot = { history: [], bookmarks: [], downloads: [], permissions: {}, searches: [], picks: {} }
const CACHE_SIZE = 200

/** Remembers recent prediction responses so retyping or backspacing shows them instantly. */
function useCache(): { get(key: string): string[] | undefined; set(key: string, items: string[]): void } {
  const map = useRef(new Map<string, string[]>())
  return useMemo(
    () => ({
      get: (key) => map.current.get(key),
      set: (key, items) => {
        map.current.delete(key)
        map.current.set(key, items)
        if (map.current.size > CACHE_SIZE) map.current.delete(map.current.keys().next().value!)
      }
    }),
    []
  )
}

/**
 * Fetches predictions for the latest text after a pause. Only the newest request may update the list, so a slow
 * answer for "a" never replaces the one for "ai m".
 */
function usePredictions(text: string, enabled: boolean, delay: number, minLength: number, fetcher: (q: string) => Promise<string[]>): { query: string; items: string[] } {
  const [result, setResult] = useState({ query: '', items: [] as string[] })
  const cache = useCache()
  const latest = useRef(0)
  useEffect(() => {
    const q = text.replace(/\s+/g, ' ').trim()
    const id = ++latest.current
    if (!enabled || q.length < minLength || /^https?:\/\//i.test(q)) return
    const key = q.toLowerCase()
    const hit = cache.get(key)
    if (hit) {
      setResult({ query: q, items: hit })
      return
    }
    const timer = setTimeout(() => {
      void fetcher(q)
        .catch(() => [])
        .then((items) => {
          cache.set(key, items)
          if (latest.current === id) setResult({ query: q, items })
        })
    }, delay)
    return () => clearTimeout(timer)
  }, [text, enabled, delay, minLength, fetcher, cache])
  // While newer results are on their way, keep only older ones that still fit what is typed.
  const typed = queryKey(text)
  return useMemo(() => ({ query: result.query, items: typed ? result.items.filter((item) => queryKey(item).startsWith(typed)) : [] }), [result, typed])
}

const fetchWeb = (q: string): Promise<string[]> => window.api.webSuggestions(q)
const fetchOrion = (q: string): Promise<string[]> => (isAddress(q) ? Promise.resolve([]) : window.api.predictQueries(q))

function Favicon({ url, fallback }: { url: string; fallback: ReactNode }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  let origin = ''
  try {
    origin = new URL(url).origin
  } catch {
    // Not a web address: the fallback icon is used.
  }
  if (failed || !/^https?:/.test(origin)) return <>{fallback}</>
  return <img className="omni-favicon" src={`${origin}/favicon.ico`} alt="" width={14} height={14} onError={() => setFailed(true)} />
}

function SuggestionIcon({ item }: { item: OmniSuggestion }): React.JSX.Element {
  const size = 14
  switch (item.kind) {
    case 'query':
      return <Search size={size} />
    case 'search':
      return <Clock size={size} />
    case 'research':
      return <BookOpen size={size} />
    case 'orion':
      return <Sparkles size={size} />
    case 'web':
      return item.url ? <Favicon url={item.url} fallback={<Globe size={size} />} /> : <Search size={size} />
    case 'bookmark':
      return <Favicon url={item.url ?? ''} fallback={<Bookmark size={size} />} />
    case 'vertical': {
      const url = item.url ?? ''
      if (url.includes('tbm=nws')) return <Newspaper size={size} />
      if (url.includes('tbm=isch')) return <ImageIcon size={size} />
      if (url.includes('tbm=vid')) return <Video size={size} />
      return <ShoppingBag size={size} />
    }
    case 'site':
      return <Favicon url={item.url ?? ''} fallback={<Search size={size} />} />
    default:
      return <Favicon url={item.url ?? ''} fallback={<Globe size={size} />} />
  }
}

/** Shows the typed part plainly and the predicted rest in bold, like a completion. */
function Highlight({ text, typed }: { text: string; typed: string }): React.JSX.Element {
  const t = typed.trim()
  if (!t || !text.toLowerCase().startsWith(t.toLowerCase()) || text.length === t.length) return <>{text}</>
  return (
    <>
      <span className="omni-typed">{text.slice(0, t.length)}</span>
      <b>{text.slice(t.length)}</b>
    </>
  )
}

/**
 * The browser's one address bar, above the header. It opens addresses, runs searches, and predicts what the user
 * wants from their history, recent searches, bookmarks, Orion research, the search engine and Orion. Enter opens in
 * Orbis, Ctrl+Enter asks Orion, Shift+Enter opens in the system's default browser; these keys only apply while the bar
 * has focus. Otherwise it always shows the page the browser is really on. Ctrl+L, Alt+D and F6 in the browser focus it.
 */
export default function UrlBar({
  url,
  title = '',
  onNavigate,
  loading,
  browserHidden,
  onShowBrowser,
  sizeControl,
  research = [],
  incognito = false,
  searchSuggestions = true,
  personalizedSuggestions = true,
  askModel,
  askPersona,
  onNotify
}: Props): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  /** The user has typed since focusing: their text wins until they submit, press Escape or leave the field. */
  const [editing, setEditing] = useState(false)
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState(false)
  /** -1: nothing chosen with the arrows. */
  const [selected, setSelected] = useState(-1)
  /** False right after deleting, so the inline completion doesn't reappear under the caret. */
  const [inline, setInline] = useState(true)
  const [library, setLibrary] = useState<BrowserLibrarySnapshot>(EMPTY_LIBRARY)
  /** A question sent to Orion with Ctrl+Enter; a new id asks again even with the same words. */
  const [ask, setAsk] = useState<{ id: number; question: string; page?: { url: string; title: string } } | null>(null)

  useEffect(() => {
    const focus = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('orbis:focus-url', focus)
    return () => window.removeEventListener('orbis:focus-url', focus)
  }, [])

  useEffect(() => {
    void window.api.getBrowserLibrary().then(setLibrary)
    return window.api.onBrowserLibrary(setLibrary)
  }, [])

  const personalized = personalizedSuggestions && !incognito
  const typing = editing && typed.trim() !== ''
  const web = usePredictions(typing ? typed : '', searchSuggestions, 90, 1, fetchWeb)
  const orion = usePredictions(typing ? typed : '', searchSuggestions, 450, 3, fetchOrion)

  const sources = useMemo(
    () => ({
      history: library.history,
      bookmarks: library.bookmarks,
      searches: library.searches,
      picks: library.picks,
      research,
      web: web.items,
      orion: orion.items,
      now: Date.now(),
      personalized,
      currentUrl: url
    }),
    [library, research, web.items, orion.items, personalized, url]
  )
  const result = useMemo(() => (typing ? buildSuggestions(typed, sources, 8, inline) : { items: recentSuggestions(sources), completion: null }), [typing, typed, sources, inline])
  const items = open ? result.items : []
  const choice = selected >= 0 && selected < items.length ? selected : typing && items.length ? 0 : -1
  const active = choice >= 0 ? items[choice] : undefined
  const completion = typing && choice === 0 && result.completion?.toLowerCase().startsWith(typed.toLowerCase()) ? typed + result.completion.slice(typed.length) : null
  const shown = active && !(typing && choice === 0) ? (active.url ?? active.query ?? active.text) : editing ? (completion ?? typed) : url

  // The completed part stays selected, so typing on replaces it and Backspace removes it.
  useLayoutEffect(() => {
    const input = inputRef.current
    if (input && completion && document.activeElement === input) input.setSelectionRange(typed.length, completion.length)
  }, [completion, typed])

  const onWebPage = /^https?:\/\//i.test(url)
  const secure = /^https:\/\//i.test(url)
  const bookmarked = onWebPage && library.bookmarks.some((b) => sameUrl(b.url, url))

  const close = (): void => {
    setOpen(false)
    setEditing(false)
    setTyped('')
    setSelected(-1)
    inputRef.current?.blur()
  }

  const learn = (item: OmniSuggestion): void => {
    if (!incognito && personalizedSuggestions) void window.api.recordSuggestionPick(pickKey(item))
  }

  const go = (item: OmniSuggestion, newTab = false): void => {
    learn(item)
    if (item.url) onNavigate(item.url, { newTab })
    else {
      const query = item.query ?? item.text
      if (!incognito && !isAddress(query)) void window.api.recordSearch(query)
      onNavigate(query, { newTab })
    }
    close()
  }

  const submit = (newTab: boolean): void => {
    if (active) return go(active, newTab)
    const text = shown.trim()
    if (!text) return
    onNavigate(text, { newTab })
    close()
  }

  /** Ctrl+Enter: the typed words (or the chosen suggestion's) go to Orion, and the answer shows over the browser. */
  const askOrion = (): void => {
    const picked = active && !(typing && choice === 0) ? active : undefined
    const question = (picked ? (picked.query ?? picked.text) : editing ? typed : shown).trim()
    if (!question) return
    if (picked) learn(picked)
    setAsk({ id: Date.now(), question, page: onWebPage ? { url, title } : undefined })
    close()
  }

  /** Shift+Enter: the destination opens in the system's default browser; on failure the typed text stays. */
  const openInDefaultBrowser = (): void => {
    const destination = active ? (active.url ?? toUrl(active.query ?? active.text)) : shown.trim() ? toUrl(shown) : ''
    if (!destination) return
    if (active) learn(active)
    window.api.openExternal(destination).then(close, () => onNotify("Couldn't open your default browser. Check that one is set in Windows settings, then try again.", 'error'))
  }

  const remove = (item: OmniSuggestion): void => {
    if (item.removable === 'history' && item.url) void window.api.removeHistory(item.url)
    if (item.removable === 'search') void window.api.removeSearch(item.query ?? item.text)
    setSelected((s) => Math.max(-1, Math.min(s, items.length - 2)))
  }

  const listOpen = open && items.length > 0

  return (
    <div className={`url-strip${loading ? ' loading' : ''}`}>
      <form
        className="url-form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          submit(false)
        }}
      >
        {loading ? (
          <LoaderCircle size={14} className="spin" aria-label="Loading" />
        ) : onWebPage && !editing ? (
          <span className={`url-security${secure ? ' secure' : ' insecure'}`} title={secure ? 'Connection is secure (HTTPS)' : 'Not secure: this page is not using HTTPS'}>
            {secure ? <Lock size={13} aria-label="Secure connection" /> : <span>Not secure</span>}
          </span>
        ) : (
          <Globe size={14} aria-hidden="true" />
        )}
        <input
          ref={inputRef}
          value={shown}
          placeholder="Search, type a URL, or Ctrl+Enter to ask Orion"
          aria-label="Type a URL"
          aria-keyshortcuts="Control+Enter Shift+Enter"
          role="combobox"
          aria-autocomplete="both"
          aria-expanded={listOpen}
          aria-controls="omni-list"
          aria-activedescendant={listOpen && choice >= 0 ? `omni-${choice}` : undefined}
          spellCheck={false}
          autoComplete="off"
          onFocus={(e) => {
            e.currentTarget.select()
            setOpen(true)
          }}
          onBlur={() => {
            setOpen(false)
            setEditing(false)
            setTyped('')
            setSelected(-1)
          }}
          onChange={(e) => {
            const inputType = (e.nativeEvent as InputEvent).inputType ?? ''
            setInline(!inputType.startsWith('delete'))
            setEditing(true)
            setTyped(e.target.value)
            setSelected(-1)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              if (!open) return setOpen(true)
              if (!items.length) return
              const step = e.key === 'ArrowDown' ? 1 : -1
              const floor = typing ? 0 : -1
              const next = choice + step
              setSelected(next > items.length - 1 ? floor : next < floor ? items.length - 1 : next)
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
              e.preventDefault()
              askOrion()
            } else if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault()
              openInDefaultBrowser()
            } else if (e.key === 'Enter' && e.altKey) {
              e.preventDefault()
              submit(true)
            } else if (e.key === 'Tab' && completion && !e.shiftKey) {
              e.preventDefault()
              setTyped(completion)
              setInline(false)
            } else if (e.key === 'Delete' && e.shiftKey && active?.removable) {
              e.preventDefault()
              remove(active)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              if (listOpen && (selected >= 0 || completion)) {
                setSelected(-1)
                setInline(false)
              } else if (listOpen) setOpen(false)
              else {
                setEditing(false)
                setTyped('')
                e.currentTarget.blur()
              }
            }
          }}
        />
        {onWebPage && !browserHidden && (
          <button
            type="button"
            className={`url-star${bookmarked ? ' on' : ''}`}
            aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
            aria-pressed={bookmarked}
            title={bookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)'}
            onClick={() => void window.api.toggleBookmark(url, title)}
          >
            <Star size={14} />
          </button>
        )}
        <button type="submit" className="url-go" aria-label="Open in Orbis browser" title="Open in Orbis browser" disabled={!shown.trim()}>
          <ArrowUpRight size={14} />
        </button>
        {listOpen && (
          <div className="omni popover glass" id="omni-list" role="listbox" aria-label="Suggestions" onMouseDown={(e) => e.preventDefault()}>
            {items.map((item, i) => (
              <Fragment key={item.id}>
                {!typing && item.section && item.section !== items[i - 1]?.section && (
                  <div className="omni-section" role="presentation">
                    {item.section}
                  </div>
                )}
                <div
                  id={`omni-${i}`}
                  role="option"
                  aria-selected={i === choice}
                  className={`omni-item omni-${item.kind}${i === choice ? ' selected' : ''}`}
                  onClick={(e) => (e.shiftKey ? (setSelected(i), openInDefaultBrowser()) : go(item, e.ctrlKey || e.metaKey))}
                  onAuxClick={(e) => e.button === 1 && go(item, true)}
                >
                  <span className="omni-icon">
                    <SuggestionIcon item={item} />
                  </span>
                  <span className="omni-text">
                    <span className="omni-main">
                      <Highlight text={item.text} typed={typing ? typed : ''} />
                    </span>
                    {item.detail && <span className="omni-detail">{item.detail}</span>}
                  </span>
                  {item.bookmarked && <Star size={12} className="omni-star" aria-label="Bookmarked" />}
                  {item.removable && (
                    <button
                      type="button"
                      className="omni-remove"
                      aria-label={`Remove “${item.text}” from ${item.removable === 'search' ? 'recent searches' : 'history'}`}
                      title={`Remove from ${item.removable === 'search' ? 'recent searches' : 'history'} (Shift+Delete)`}
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation()
                        remove(item)
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </Fragment>
            ))}
            <div className="omni-foot">
              <span className="omni-keys" aria-hidden="true">
                <kbd>Enter</kbd> open <kbd>Ctrl+Enter</kbd> ask Orion <kbd>Shift+Enter</kbd> default browser
              </span>
              {!typing && library.searches.length > 0 && personalized && (
                <button type="button" tabIndex={-1} onClick={() => void window.api.clearSearches()}>
                  Clear recent searches
                </button>
              )}
            </div>
          </div>
        )}
      </form>
      {ask && <OrionAnswer key={ask.id} question={ask.question} page={ask.page} model={askModel} persona={askPersona} onClose={() => setAsk(null)} />}
      {browserHidden && (
        <button type="button" className="url-return" onClick={onShowBrowser} title="Back to the open browser, right where you left it">
          <PanelTop size={13} />
          Return to browser
        </button>
      )}
      {sizeControl}
    </div>
  )
}
