import { Fragment, lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  Clock,
  Copy,
  FileText,
  Globe,
  Image as ImageIcon,
  LoaderCircle,
  Lock,
  Newspaper,
  ArrowLeft,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  Video,
  Workflow as WorkflowIcon,
  X
} from 'lucide-react'
import { sameUrl } from '../../../shared/research'
import { buildSuggestions, isAddress, pickKey, queryKey, recentSuggestions, toUrl } from '../../../shared/omnibox'
import type { OmniSuggestion } from '../../../shared/omnibox'
import type { BrowserLibrarySnapshot } from '../../../shared/types'
import type { NoticeKind } from '../App'
import OrionAnswer from './OrionAnswer'

// The quick Workflows panel (and the run dialog it uses) loads the first time the button is opened.
const WorkflowQuickPanel = lazy(() => import('./WorkflowQuickPanel'))
import { useDismiss, useDropdownOpen } from '../lib/useDismiss'
import { bool, failure, int, readResult, reportControlState, str, unverified, useControlRendered, useControlScope, verified, waitUntil } from '../lib/browserControl'

interface Props {
  /** The Orbis browser's current page URL, or empty when no page is open. */
  url: string
  /** The current page's title, for bookmarking. */
  title?: string
  /** The active browser tab. Each tab keeps its own half-typed text, restored when the user comes back to it. */
  tabKey?: string
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
  /** The current chat is incognito (or the tab is private): nothing personal is suggested or remembered. */
  incognito?: boolean
  searchSuggestions?: boolean
  personalizedSuggestions?: boolean
  /** The model and assistant that answer Ctrl+Enter questions. */
  askModel: string
  onNotify(message: string, kind?: NoticeKind): void
  /** Opens the full Workflows screen from the quick panel. */
  onOpenWorkflows?(): void
}

const EMPTY_LIBRARY: BrowserLibrarySnapshot = { history: [], bookmarks: [], downloads: [], permissions: {}, searches: [], picks: {}, shortcuts: [], readingList: [], savedPages: [], screenshots: [] }
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

/** Asks the browser panel for the active tab's rendered title and text; null when there is no readable page. */
function readActivePage(): Promise<{ title: string; text: string } | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (page: { title: string; text: string } | null): void => {
      if (settled) return
      settled = true
      resolve(page)
    }
    window.dispatchEvent(new CustomEvent('orbis:read-page', { detail: { resolve: finish } }))
    setTimeout(() => finish(null), 8000)
  })
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
 * has focus. Half-typed text belongs to the tab it was typed in: switching tabs and back restores it exactly.
 * Otherwise it always shows the page the browser is really on. Ctrl+L, Ctrl+E, Alt+D and F6 focus it.
 */
export default function UrlBar({
  url,
  title = '',
  tabKey = '',
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
  onNotify,
  onOpenWorkflows
}: Props): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  /** The shown text is the user's own (a draft), not the page's address. */
  const [editing, setEditing] = useState(false)
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState(false)
  /** -1: nothing chosen with the arrows. */
  const [selected, setSelected] = useState(-1)
  /** False right after deleting, so the inline completion doesn't reappear under the caret. */
  const [inline, setInline] = useState(true)
  const [library, setLibrary] = useState<BrowserLibrarySnapshot>(EMPTY_LIBRARY)
  /** A question sent to Orion with Ctrl+Enter; a new id asks again even with the same words. */
  const [ask, setAsk] = useState<{ id: number; question: string; page?: { url: string; title: string }; context?: string } | null>(null)
  /** The Summarize button is reading the page. */
  const [summarizing, setSummarizing] = useState(false)
  /** The Copy button just copied the address (shows a check for a moment). */
  const [copied, setCopied] = useState(false)
  /** The Workflows button's panel, and how many workflow runs are going on right now (shown on the button). */
  const [workflowsOpen, setWorkflowsOpen] = useState(false)
  /** Where the Workflows button was when it was pressed, so its panel hangs from it wherever the browser sits. */
  const [workflowsAnchor, setWorkflowsAnchor] = useState<{ left: number; right: number; bottom: number } | null>(null)
  const [runningWorkflows, setRunningWorkflows] = useState(0)
  const [recordingWorkflow, setRecordingWorkflow] = useState(false)
  const workflowsRef = useRef<HTMLDivElement>(null)
  const workflowsPanelRef = useRef<HTMLDivElement>(null)
  /** Half-typed text per tab, kept until it is submitted, dismissed with Esc, or the tab navigates elsewhere. */
  const drafts = useRef(new Map<string, string>())

  useDismiss([workflowsRef, workflowsPanelRef], workflowsOpen, () => setWorkflowsOpen(false))

  // How many workflows are running, for the button's badge: counted when something actually changes.
  useEffect(() => {
    const count = (): void =>
      void window.api.getWorkflowLibrary().then((library) => {
        setRunningWorkflows(library.active.length)
        setRecordingWorkflow(library.recording.active)
      })
    count()
    const offs = [
      window.api.onWorkflowRunUpdate(count),
      window.api.onWorkflowRunFinished(count),
      window.api.onWorkflowsChanged(count),
      window.api.onWorkflowRecording((state) => setRecordingWorkflow(Boolean(state?.active)))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const saveDraft = (value: string): void => {
    if (value) drafts.current.set(tabKey, value)
    else drafts.current.delete(tabKey)
  }

  // Switching tabs shows that tab's own draft (or its address), exactly as it was left.
  const shownTab = useRef(tabKey)
  useEffect(() => {
    if (shownTab.current === tabKey) return
    shownTab.current = tabKey
    const draft = drafts.current.get(tabKey) ?? ''
    setTyped(draft)
    setEditing(Boolean(draft))
    setSelected(-1)
    setInline(false)
  }, [tabKey])

  // The tab went to another page while the user wasn't typing: its old draft no longer applies.
  const shownUrl = useRef({ tabKey, url })
  useEffect(() => {
    const previous = shownUrl.current
    shownUrl.current = { tabKey, url }
    if (previous.tabKey !== tabKey || previous.url === url || document.activeElement === inputRef.current) return
    drafts.current.delete(tabKey)
    setTyped('')
    setEditing(false)
  }, [tabKey, url])

  useEffect(() => {
    const focus = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('orbis:focus-url', focus)
    return () => window.removeEventListener('orbis:focus-url', focus)
  }, [])

  // A page opened or started loading: the suggestions are done, unless the user is typing in the bar right now.
  const typingRef = useRef(false)
  typingRef.current = editing && document.activeElement === inputRef.current
  useEffect(() => {
    if (!typingRef.current) setOpen(false)
  }, [url, loading, tabKey])

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

  /** Done with the typed text (submitted or dismissed): the tab's draft goes and the bar shows the page again. */
  const close = (): void => {
    drafts.current.delete(tabKey)
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

  /** Summarize: the open page's text, as it is rendered in the tab, goes to Orion; the summary shows over the page. */
  const summarizePage = (): void => {
    if (!onWebPage || summarizing) return
    setSummarizing(true)
    void readActivePage()
      .then((page) => {
        if (!page?.text.trim()) return onNotify("Couldn't read this page's text to summarize it.", 'warn')
        setAsk({ id: Date.now(), question: `Summarize: ${page.title || title || url}`, page: { url, title: page.title || title }, context: page.text })
      })
      .finally(() => setSummarizing(false))
  }

  /** Copy: the open page's full address goes to the clipboard. */
  const copyUrl = (): void => {
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => onNotify("Couldn't copy the address.", 'error')
    )
  }

  const remove = (item: OmniSuggestion): void => {
    if (item.removable === 'history' && item.url) void window.api.removeHistory(item.url)
    if (item.removable === 'search') void window.api.removeSearch(item.query ?? item.text)
    setSelected((s) => Math.max(-1, Math.min(s, items.length - 2)))
  }

  const listOpen = open && items.length > 0
  useDropdownOpen(listOpen)

  // ---------------------------------------------------------------- Browser Control Layer: the address bar
  // The one address bar, driven through the same functions typing, Enter, Ctrl+Enter, Shift+Enter and clicks use.
  const bar = useRef({ typed, editing, shown, items, ask })
  bar.current = { typed, editing, shown, items, ask }
  const actions = useRef({ submit, go, askOrion, openInDefaultBrowser })
  actions.current = { submit, go, askOrion, openInDefaultBrowser }
  useEffect(() => {
    reportControlState({
      addressBar: {
        value: shown,
        editing,
        focused: document.activeElement === inputRef.current,
        suggestions: open ? items.map((item, index) => ({ index, kind: item.kind, text: item.text, ...(item.url ? { url: item.url } : {}) })) : []
      }
    })
  }, [shown, editing, items, open])
  /** Puts text in the bar as if typed: it becomes the tab's draft and suggestions open. */
  const typeText = async (text: string): Promise<boolean> => {
    inputRef.current?.focus()
    setEditing(true)
    setTyped(text)
    saveDraft(text)
    setSelected(-1)
    setInline(false)
    setOpen(true)
    return waitUntil(() => bar.current.typed === text && bar.current.editing)
  }
  useControlRendered()
  useControlScope('address-bar', [
    {
      id: 'addressBar.focus',
      domain: 'addressBar',
      name: 'Focus the address bar',
      description: 'Puts the keyboard in the address bar with its text selected (as Ctrl+L does).',
      params: {},
      mutates: true,
      run: async () => {
        inputRef.current?.focus()
        const ok = await waitUntil(() => document.activeElement === inputRef.current)
        return ok ? verified('The address bar has focus.') : unverified("The address bar didn't take focus.")
      }
    },
    {
      id: 'addressBar.read',
      domain: 'addressBar',
      name: 'Read the address bar',
      description: 'What the address bar shows (the page address, or typed text), whether it is being edited, and its suggestions.',
      params: {},
      mutates: false,
      run: () => readResult({ value: shown, editing, typed: editing ? typed : '', completion, suggestions: items.map((item, index) => ({ index, kind: item.kind, text: item.text, url: item.url, detail: item.detail })) })
    },
    {
      id: 'addressBar.set',
      domain: 'addressBar',
      name: 'Type in the address bar',
      description: "Replaces the address bar's text (suggestions update as for typing). Submit it with addressBar.submit.",
      params: { text: str('The text.', true, { sensitive: true }) },
      mutates: true,
      run: async (p) => ((await typeText(String(p.text))) ? verified('The address bar holds the text.') : unverified("The address bar doesn't hold the text."))
    },
    {
      id: 'addressBar.append',
      domain: 'addressBar',
      name: 'Add to the address bar text',
      description: 'Adds text to the end of what the address bar shows.',
      params: { text: str('The text to add.', true, { sensitive: true }) },
      mutates: true,
      run: async (p) => ((await typeText(`${bar.current.editing ? bar.current.typed : bar.current.shown}${String(p.text)}`)) ? verified('Added to the address bar.') : unverified('The text was not added.'))
    },
    {
      id: 'addressBar.clear',
      domain: 'addressBar',
      name: 'Clear the address bar',
      description: 'Empties the address bar for typing.',
      params: {},
      mutates: true,
      run: async () => ((await typeText('')) ? verified('The address bar is empty.') : unverified('The address bar is not empty.'))
    },
    {
      id: 'addressBar.submit',
      domain: 'addressBar',
      name: 'Submit the address bar',
      description: 'Opens what the address bar holds, as Enter does (the top suggestion when typing), in this tab or a new one; optionally types text first.',
      params: { text: str('Type this first.', false, { sensitive: true }), newTab: bool('Open in a new tab (Alt+Enter).') },
      mutates: true,
      run: async (p) => {
        if (typeof p.text === 'string' && !(await typeText(p.text))) return failure('failed', "Couldn't type into the address bar.", true)
        if (!bar.current.shown.trim()) return failure('invalid-params', 'The address bar is empty.')
        const value = bar.current.editing ? bar.current.typed : bar.current.shown
        actions.current.submit(p.newTab === true)
        const ok = await waitUntil(() => !bar.current.editing, 1500)
        return ok ? verified(`Opened “${value}” in the browser${p.newTab ? ' in a new tab' : ''}.`, { value }) : unverified('The address bar did not submit.')
      }
    },
    {
      id: 'addressBar.suggestions',
      domain: 'addressBar',
      name: 'Address bar suggestions',
      description: 'The suggestions shown for what is typed (history, bookmarks, searches, web and Orion predictions), after giving predictions a moment.',
      params: { waitMs: int('Wait this long for web predictions (default 600).') },
      mutates: false,
      run: async (p) => {
        await new Promise((resolve) => setTimeout(resolve, Math.min(Number(p.waitMs ?? 600), 3000)))
        return readResult(bar.current.items.map((item, index) => ({ index, kind: item.kind, text: item.text, url: item.url, detail: item.detail })))
      }
    },
    {
      id: 'addressBar.chooseSuggestion',
      domain: 'addressBar',
      name: 'Choose a suggestion',
      description: 'Opens one of the address bar suggestions (by index from addressBar.suggestions), as clicking it does.',
      params: { index: int('The suggestion index.', true), newTab: bool('Open in a new tab.') },
      mutates: true,
      run: async (p) => {
        const item = bar.current.items[Number(p.index)]
        if (!item) return failure('not-found', 'There is no suggestion at that index. Read addressBar.suggestions.', true)
        actions.current.go(item, p.newTab === true)
        const ok = await waitUntil(() => !bar.current.editing, 1500)
        return ok ? verified(`Opened “${item.text}”.`, { text: item.text, url: item.url }) : unverified('The suggestion did not open.')
      }
    },
    {
      id: 'addressBar.askOrion',
      domain: 'addressBar',
      name: 'Ask Orion from the address bar',
      description: "Asks Orion the address bar's text (or given text), as Ctrl+Enter does; the answer shows over the page.",
      params: { text: str('The question (default: what is typed).') },
      mutates: true,
      run: async (p) => {
        if (typeof p.text === 'string' && !(await typeText(p.text))) return failure('failed', "Couldn't type into the address bar.", true)
        const before = bar.current.ask?.id
        actions.current.askOrion()
        const ok = await waitUntil(() => Boolean(bar.current.ask && bar.current.ask.id !== before), 1500)
        return ok ? verified(`Asked Orion: “${bar.current.ask?.question}”.`) : unverified('Nothing was asked (the bar may be empty).')
      }
    },
    {
      id: 'addressBar.openInDefaultBrowser',
      domain: 'addressBar',
      name: 'Open in the default browser from the address bar',
      description: "Opens the address bar's text (or given text) in the system's default browser, as Shift+Enter does.",
      params: { text: str('Type this first.') },
      mutates: true,
      run: async (p) => {
        if (typeof p.text === 'string' && !(await typeText(p.text))) return failure('failed', "Couldn't type into the address bar.", true)
        if (!bar.current.shown.trim()) return failure('invalid-params', 'The address bar is empty.')
        actions.current.openInDefaultBrowser()
        const ok = await waitUntil(() => !bar.current.editing, 3000)
        return ok ? verified('Handed to the default browser.') : unverified('The default browser did not take it.')
      }
    }
  ])

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
          // Focus alone (after opening a page, Ctrl+L/Ctrl+E, a new tab) only selects the text; the list opens when the
          // user clicks into the bar, types or presses the arrow keys.
          onFocus={(e) => e.currentTarget.select()}
          onMouseDown={() => setOpen(true)}
          onBlur={() => {
            // Leaving the bar (clicking a tab, the page, anywhere) keeps what was typed; only an empty bar goes back to the address.
            setOpen(false)
            setSelected(-1)
            if (!typed) setEditing(false)
          }}
          onChange={(e) => {
            const inputType = (e.nativeEvent as InputEvent).inputType ?? ''
            setInline(!inputType.startsWith('delete'))
            setEditing(true)
            setTyped(e.target.value)
            saveDraft(e.target.value)
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
              saveDraft(completion)
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
              else close()
            }
          }}
        />
        {onWebPage && !browserHidden && (
          <button
            type="button"
            className={`url-star url-copy${copied ? ' copied' : ''}`}
            aria-label={copied ? 'Address copied' : 'Copy address'}
            title={copied ? 'Copied' : 'Copy address'}
            onClick={copyUrl}
          >
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          </button>
        )}
        {onWebPage && !browserHidden && (
          <button
            type="button"
            className="url-star url-summarize"
            aria-label="Summarize this page"
            title="Summarize this page with Orion"
            aria-busy={summarizing}
            disabled={summarizing}
            onClick={summarizePage}
          >
            {summarizing ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
          </button>
        )}
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
        <div className="url-workflows" ref={workflowsRef}>
          <button
            type="button"
            className={`url-star${workflowsOpen ? ' on' : ''}`}
            aria-label="Workflows"
            aria-haspopup="dialog"
            aria-expanded={workflowsOpen}
            title={recordingWorkflow ? 'Workflows: recording what you do' : runningWorkflows ? `Workflows (${runningWorkflows} running)` : 'Workflows: run, record, manage'}
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect()
              setWorkflowsAnchor({ left: box.left, right: box.right, bottom: box.bottom })
              setWorkflowsOpen((open) => !open)
            }}
          >
            <WorkflowIcon size={14} aria-hidden="true" />
            {(runningWorkflows > 0 || recordingWorkflow) && <span className={`url-workflows-badge${recordingWorkflow ? ' recording' : ''}`} aria-hidden="true" />}
          </button>
          {workflowsOpen && workflowsAnchor && (
            <Suspense fallback={null}>
              <WorkflowQuickPanel url={url} anchor={workflowsAnchor} panelRef={workflowsPanelRef} onClose={() => setWorkflowsOpen(false)} onOpenLibrary={() => onOpenWorkflows?.()} onNotify={onNotify} />
            </Suspense>
          )}
        </div>
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
      {ask && <OrionAnswer key={ask.id} question={ask.question} page={ask.page} context={ask.context} model={askModel} onClose={() => setAsk(null)} />}
      {browserHidden && (
        <button type="button" className="url-return" onClick={onShowBrowser} title="Back to the open browser, right where you left it">
          <ArrowLeft size={13} />
          <span>Browser</span>
        </button>
      )}
      {sizeControl}
    </div>
  )
}
