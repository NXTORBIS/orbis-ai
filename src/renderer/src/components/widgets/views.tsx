import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clipboard, Copy, Download, ExternalLink, Gamepad2, LayoutGrid, NotebookPen, Pause, PenLine, Play, Quote as QuoteIcon, RotateCcw } from 'lucide-react'
import type { WidgetInstance } from '../../../../shared/widgets'
import type { Task } from '../../../../shared/tasks'
import type { Note } from '../../../../shared/notes'
import type { ClipItem } from '../../../../shared/clipboardHistory'
import { GAMES, gameInfo, gameOfTheDay } from '../../../../shared/offlineGames'
import { loadOfflineGames } from '../../games/useOfflineGames'
import type { FeedItem, Weather } from '../../../../shared/widgetData'
import { ago, greeting, mergeFeeds, parseFeedList, parseWorldClocks, recentSites, temperatureIn, timeIn } from '../../../../shared/widgetData'

/**
 * What each widget shows. Every one of these reads something Orbis really holds — your tasks, notes, bookmarks,
 * downloads, tabs, clipboard, boards, workspaces or game scores — and acting in a widget really acts: ticking a task off
 * here ticks it off everywhere.
 */

export interface WidgetViewProps {
  instance: WidgetInstance
  onOpen(what: { kind: 'url' | 'view'; value: string }): void
}

type WidgetView = (props: WidgetViewProps) => React.JSX.Element

const number = (instance: WidgetInstance, name: string, fallback: number): number => {
  const value = instance.settings[name]
  return typeof value === 'number' ? value : fallback
}
const text = (instance: WidgetInstance, name: string, fallback = ''): string => {
  const value = instance.settings[name]
  return typeof value === 'string' ? value : fallback
}
const flag = (instance: WidgetInstance, name: string, fallback = false): boolean => {
  const value = instance.settings[name]
  return typeof value === 'boolean' ? value : fallback
}

const Empty = ({ children }: { children: React.ReactNode }): React.JSX.Element => <p className="wg-empty view-muted">{children}</p>

// ---------------------------------------------------------------- time

const Clock: WidgetView = ({ instance }) => {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), flag(instance, 'seconds') ? 1000 : 20_000)
    return () => window.clearInterval(timer)
  }, [instance])
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(flag(instance, 'seconds') ? { second: '2-digit' } : {}), hour12: flag(instance, 'hour12') })
  return (
    <div className="wg-clock">
      <b>{time}</b>
      {flag(instance, 'date', true) && <small className="view-muted">{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</small>}
    </div>
  )
}

const Countdown: WidgetView = ({ instance }) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const target = text(instance, 'date')
  const when = target ? new Date(`${target}T00:00:00`).getTime() : NaN
  if (!target || Number.isNaN(when)) return <Empty>Set a date in this widget’s settings.</Empty>
  const days = Math.ceil((when - now) / 86_400_000)
  return (
    <div className="wg-clock">
      <b>{days > 0 ? days : days === 0 ? 'Today' : `${Math.abs(days)} ago`}</b>
      <small className="view-muted">
        {days > 0 ? `day${days === 1 ? '' : 's'} until ` : ''}
        {text(instance, 'title', 'it')}
      </small>
    </div>
  )
}

const Timer: WidgetView = ({ instance }) => {
  const focus = number(instance, 'minutes', 25) * 60_000
  const rest = number(instance, 'breakMinutes', 5) * 60_000
  const [phase, setPhase] = useState<'focus' | 'rest'>('focus')
  const [left, setLeft] = useState(focus)
  const [running, setRunning] = useState(false)
  const endsAt = useRef(0)

  useEffect(() => {
    if (!running) return
    endsAt.current = Date.now() + left
    const tick = window.setInterval(() => {
      const remaining = endsAt.current - Date.now()
      if (remaining > 0) return setLeft(remaining)
      // One stretch finished: the next one is ready, but it does not start by itself.
      window.clearInterval(tick)
      setRunning(false)
      setPhase((current) => (current === 'focus' ? 'rest' : 'focus'))
      setLeft(phase === 'focus' ? rest : focus)
    }, 250)
    return () => window.clearInterval(tick)
  }, [running]) // eslint-disable-line react-hooks/exhaustive-deps

  const minutes = Math.floor(left / 60_000)
  const seconds = Math.floor((left % 60_000) / 1000)
  return (
    <div className="wg-timer">
      <b>{`${minutes}:${String(seconds).padStart(2, '0')}`}</b>
      <small className="view-muted">{phase === 'focus' ? 'Focus' : 'Rest'}</small>
      <span className="wg-row">
        <button type="button" className="queue-btn small" onClick={() => setRunning((r) => !r)}>
          {running ? <Pause size={12} /> : <Play size={12} />} {running ? 'Pause' : 'Start'}
        </button>
        <button
          type="button"
          className="queue-btn small"
          onClick={() => {
            setRunning(false)
            setPhase('focus')
            setLeft(focus)
          }}
        >
          <RotateCcw size={12} /> Reset
        </button>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------- your own things

const Tasks: WidgetView = ({ instance, onOpen }) => {
  const [tasks, setTasks] = useState<Task[]>([])
  const view = text(instance, 'view', 'today') as 'today' | 'overdue' | 'flagged' | 'all'
  const limit = number(instance, 'limit', 5)

  const load = useCallback(() => void window.api.listTasks({ view, sort: 'due' }).then(setTasks), [view])
  useEffect(() => {
    load()
    return window.api.onTasksChanged(load)
  }, [load])

  const shown = tasks.slice(0, limit)
  if (!shown.length) {
    return (
      <div className="wg-empty-action">
        <Empty>{view === 'today' ? 'Nothing due today.' : 'Nothing here.'}</Empty>
        <button type="button" className="queue-btn small" onClick={() => onOpen({ kind: 'view', value: 'tasks' })}>
          Open tasks
        </button>
      </div>
    )
  }
  return (
    <ul className="wg-list">
      {shown.map((task) => (
        <li key={task.id}>
          <button type="button" className="wg-check" aria-label={`Mark “${task.title}” done`} onClick={() => void window.api.completeTask(task.id, true)}>
            <Check size={11} />
          </button>
          <button type="button" className="wg-line" onClick={() => onOpen({ kind: 'view', value: 'tasks' })}>
            {task.title}
          </button>
          {task.due !== undefined && <small className="view-muted">{new Date(task.due).toLocaleDateString([], { day: 'numeric', month: 'short' })}</small>}
        </li>
      ))}
    </ul>
  )
}

const Notes: WidgetView = ({ instance, onOpen }) => {
  const [notes, setNotes] = useState<Note[]>([])
  const limit = number(instance, 'limit', 4)
  const load = useCallback(() => void window.api.listNotes({}).then(setNotes), [])
  useEffect(() => {
    load()
    return window.api.onNotesChanged(load)
  }, [load])

  if (!notes.length) {
    return (
      <div className="wg-empty-action">
        <Empty>No notes yet.</Empty>
        <button type="button" className="queue-btn small" onClick={() => void window.api.createNote({}).then(() => onOpen({ kind: 'view', value: 'notes' }))}>
          <NotebookPen size={12} /> Write one
        </button>
      </div>
    )
  }
  return (
    <ul className="wg-list">
      {notes.slice(0, limit).map((note) => (
        <li key={note.id}>
          <button type="button" className="wg-line" onClick={() => onOpen({ kind: 'view', value: 'notes' })}>
            {note.title || note.body.split('\n')[0] || 'Untitled note'}
          </button>
        </li>
      ))}
    </ul>
  )
}

const Whiteboards: WidgetView = ({ instance, onOpen }) => {
  const [boards, setBoards] = useState<{ id: string; name: string; count: number }[]>([])
  const load = useCallback(() => void window.api.listBoards().then((list) => setBoards(list.map((b) => ({ id: b.id, name: b.name, count: b.count })))), [])
  useEffect(() => {
    load()
    return window.api.onBoardsChanged(load)
  }, [load])

  if (!boards.length) return <Empty>No boards yet.</Empty>
  return (
    <ul className="wg-list">
      {boards.slice(0, number(instance, 'limit', 3)).map((board) => (
        <li key={board.id}>
          <button type="button" className="wg-line" onClick={() => onOpen({ kind: 'view', value: 'whiteboard' })}>
            <PenLine size={12} /> {board.name}
          </button>
          <small className="view-muted">{board.count}</small>
        </li>
      ))}
    </ul>
  )
}

const Clips: WidgetView = ({ instance }) => {
  const [clips, setClips] = useState<ClipItem[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  const load = useCallback(() => void window.api.clipboardHistory().then(setClips), [])
  useEffect(() => {
    load()
    return window.api.onClipboardChanged(load)
  }, [load])

  if (!clips.length) return <Empty>Nothing copied yet.</Empty>
  return (
    <ul className="wg-list">
      {clips.slice(0, number(instance, 'limit', 4)).map((clip) => (
        <li key={clip.id}>
          <button
            type="button"
            className="wg-line"
            title="Copy this again"
            onClick={() =>
              void window.api.useClip(clip.id).then(() => {
                setCopied(clip.id)
                window.setTimeout(() => setCopied((id) => (id === clip.id ? null : id)), 1200)
              })
            }
          >
            {copied === clip.id ? <Check size={12} /> : <Clipboard size={12} />} {clip.preview}
          </button>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------- the browser

const Bookmarks: WidgetView = ({ instance, onOpen }) => {
  const [bookmarks, setBookmarks] = useState<{ url: string; title: string }[]>([])
  useEffect(() => {
    const take = (library: { bookmarks?: { url: string; title: string }[] }): void => setBookmarks(library.bookmarks ?? [])
    void window.api.getBrowserLibrary().then(take)
    return window.api.onBrowserLibrary(take)
  }, [])

  if (!bookmarks.length) return <Empty>No bookmarks yet.</Empty>
  return (
    <ul className="wg-list">
      {bookmarks.slice(0, number(instance, 'limit', 6)).map((bookmark) => (
        <li key={bookmark.url}>
          <button type="button" className="wg-line" onClick={() => onOpen({ kind: 'url', value: bookmark.url })}>
            <ExternalLink size={12} /> {bookmark.title || bookmark.url}
          </button>
        </li>
      ))}
    </ul>
  )
}

const Downloads: WidgetView = ({ instance }) => {
  const [downloads, setDownloads] = useState<{ id: string; filename: string; state: string; received?: number; total?: number }[]>([])
  useEffect(() => {
    const take = (library: { downloads?: typeof downloads }): void => setDownloads(library.downloads ?? [])
    void window.api.getBrowserLibrary().then(take)
    return window.api.onBrowserLibrary(take)
  }, [])

  if (!downloads.length) return <Empty>Nothing downloaded yet.</Empty>
  return (
    <ul className="wg-list">
      {downloads.slice(0, number(instance, 'limit', 4)).map((download) => (
        <li key={download.id}>
          <button type="button" className="wg-line" title="Show this file" onClick={() => void window.api.downloadAction(download.id, 'show')}>
            <Download size={12} /> {download.filename}
          </button>
          <small className="view-muted">{download.state === 'completed' ? 'done' : download.state}</small>
        </li>
      ))}
    </ul>
  )
}

const Tabs: WidgetView = ({ instance, onOpen }) => {
  const [state, setState] = useState<{ tabs: { id: string; url: string; title: string }[]; groups: unknown[] }>({ tabs: [], groups: [] })
  useEffect(() => {
    const read = (): void => void window.api.getControlState(['browser']).then((s) => {
      const browser = (s as Record<string, { tabs?: unknown[]; groups?: unknown[] }>).browser
      setState({ tabs: (browser?.tabs ?? []) as { id: string; url: string; title: string }[], groups: browser?.groups ?? [] })
    })
    read()
    const timer = window.setInterval(read, 4000)
    return () => window.clearInterval(timer)
  }, [])

  if (!state.tabs.length) return <Empty>No tabs open.</Empty>
  return (
    <>
      <p className="wg-big">
        {state.tabs.length} tab{state.tabs.length === 1 ? '' : 's'}
        {state.groups.length ? `, ${state.groups.length} group${state.groups.length === 1 ? '' : 's'}` : ''}
      </p>
      <ul className="wg-list">
        {state.tabs.slice(0, number(instance, 'limit', 5)).map((tab) => (
          <li key={tab.id}>
            <button type="button" className="wg-line" onClick={() => void window.api.executeControl({ capability: 'tabs.activate', params: { tabId: tab.id } })}>
              {tab.title || tab.url}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="queue-btn small" onClick={() => onOpen({ kind: 'view', value: 'workspaces' })}>
        Save these as a workspace
      </button>
    </>
  )
}

const Workspaces: WidgetView = ({ onOpen }) => {
  const [spaces, setSpaces] = useState<{ id: string; name: string; summary: { tabs: number } }[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const load = useCallback(() => void window.api.listWorkspaces().then(({ workspaces, currentId: current }) => (setSpaces(workspaces), setCurrentId(current))), [])
  useEffect(() => {
    load()
    return window.api.onWorkspacesChanged(load)
  }, [load])

  if (!spaces.length) {
    return (
      <div className="wg-empty-action">
        <Empty>No workspaces yet.</Empty>
        <button type="button" className="queue-btn small" onClick={() => onOpen({ kind: 'view', value: 'workspaces' })}>
          <LayoutGrid size={12} /> Save the open pages
        </button>
      </div>
    )
  }
  return (
    <ul className="wg-list">
      {spaces.map((space) => (
        <li key={space.id}>
          <button type="button" className="wg-line" onClick={() => void window.api.openWorkspace(space.id, true)}>
            {space.name}
            {space.id === currentId ? ' · open' : ''}
          </button>
          <small className="view-muted">{space.summary.tabs}</small>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------- odds and ends

/** Lines kept on this computer. Nothing is fetched, and the same one shows all day. */
const QUOTES: { text: string; who: string }[] = [
  { text: 'The way to get started is to quit talking and begin doing.', who: 'Walt Disney' },
  { text: 'Simplicity is the soul of efficiency.', who: 'Austin Freeman' },
  { text: 'It always seems impossible until it’s done.', who: 'Nelson Mandela' },
  { text: 'What we know is a drop, what we don’t know is an ocean.', who: 'Isaac Newton' },
  { text: 'Make it work, make it right, make it fast.', who: 'Kent Beck' },
  { text: 'An ounce of practice is worth more than tons of preaching.', who: 'Mahatma Gandhi' },
  { text: 'Perfection is achieved when there is nothing left to take away.', who: 'Antoine de Saint-Exupéry' },
  { text: 'The best time to plant a tree was twenty years ago. The second best time is now.', who: 'Proverb' }
]

const Quote: WidgetView = ({ instance }) => {
  const rotation = text(instance, 'rotation', 'daily')
  const [nudge, setNudge] = useState(0)
  const quote = useMemo(() => {
    if (rotation === 'manual') return QUOTES[nudge % QUOTES.length]
    const key = rotation === 'daily' ? new Date().toDateString() : String(performance.timeOrigin)
    let hash = 2166136261
    for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619)
    return QUOTES[(hash >>> 0) % QUOTES.length]
  }, [rotation, nudge])

  return (
    <div className="wg-quote">
      <QuoteIcon size={13} aria-hidden="true" />
      <p>{quote.text}</p>
      <small className="view-muted">{quote.who}</small>
      {rotation === 'manual' && (
        <button type="button" className="queue-btn small" onClick={() => setNudge((n) => n + 1)}>
          Another
        </button>
      )}
    </div>
  )
}

const Games: WidgetView = () => {
  const data = useMemo(() => loadOfflineGames(), [])
  const daily = gameInfo(gameOfTheDay(new Date()))
  const best = Object.entries(data.scores)
    .map(([id, record]) => ({ game: GAMES.find((g) => g.id === id), record }))
    .filter((x) => x.game)
    .sort((a, b) => (b.record?.plays ?? 0) - (a.record?.plays ?? 0))
    .slice(0, 2)

  return (
    <div className="wg-games">
      <p className="wg-big">
        <span aria-hidden="true">{daily.icon}</span> {daily.name}
      </p>
      <small className="view-muted">Today’s game, for when a page won’t load</small>
      {best.length > 0 && (
        <ul className="wg-list">
          {best.map(({ game, record }) => (
            <li key={game!.id}>
              <span className="wg-line">
                <Gamepad2 size={12} /> {game!.name}
              </span>
              <small className="view-muted">best {record!.best}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Works out what is typed, using only the four operations, brackets and percentages: nothing is evaluated as code. */
export function calculate(input: string): { value: number | null; error?: string } {
  const cleaned = input.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '')
  if (!cleaned) return { value: null }
  if (!/^[0-9+\-*/().%]+$/.test(cleaned)) return { value: null, error: 'Only numbers and + - × ÷ ( ) %' }
  let at = 0
  const peek = (): string => cleaned[at] ?? ''
  const eat = (char: string): boolean => (peek() === char ? (at++, true) : false)
  const number_ = (): number => {
    if (eat('(')) {
      const value = expression()
      if (!eat(')')) throw new Error('A bracket is not closed')
      return value
    }
    const sign = eat('-') ? -1 : (eat('+'), 1)
    const start = at
    while (/[0-9.]/.test(peek())) at++
    if (start === at) throw new Error('Something is missing')
    const value = Number(cleaned.slice(start, at))
    if (Number.isNaN(value)) throw new Error('That is not a number')
    return sign * (eat('%') ? value / 100 : value)
  }
  const term = (): number => {
    let value = number_()
    for (;;) {
      if (eat('*')) value *= number_()
      else if (eat('/')) {
        const divisor = number_()
        if (divisor === 0) throw new Error('Cannot divide by zero')
        value /= divisor
      } else return value
    }
  }
  function expression(): number {
    let value = term()
    for (;;) {
      if (eat('+')) value += term()
      else if (eat('-')) value -= term()
      else return value
    }
  }
  try {
    const value = expression()
    if (at !== cleaned.length) throw new Error('That cannot be worked out')
    return { value }
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : 'That cannot be worked out' }
  }
}

const Calculator: WidgetView = () => {
  const [input, setInput] = useState('')
  const result = calculate(input)
  return (
    <div className="wg-calc">
      <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="12 * (3 + 4)" aria-label="What to work out" />
      <b>{result.value !== null ? Number(result.value.toFixed(10)).toLocaleString() : ''}</b>
      {result.error && input && <small className="view-muted">{result.error}</small>}
      {result.value !== null && (
        <button type="button" className="queue-btn small" onClick={() => void navigator.clipboard.writeText(String(result.value))}>
          <Copy size={12} /> Copy
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- time elsewhere, and a greeting

/**
 * Something that changes by the minute, redrawn at the turn of the minute, and caught up when the window comes back
 * into view. Nothing here shows seconds, so nothing here ticks every second.
 */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer = 0
    const tick = (): void => {
      setNow(new Date())
      timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50)
    }
    timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50)
    const visible = (): void => {
      if (!document.hidden) setNow(new Date())
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])
  return now
}

const Greeting: WidgetView = ({ instance }) => {
  const now = useMinute()
  return (
    <div className="wg-greeting">
      <b>{greeting(now, text(instance, 'name'))}</b>
      {flag(instance, 'date', true) && <small className="view-muted">{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</small>}
    </div>
  )
}

const WorldClocks: WidgetView = ({ instance }) => {
  const now = useMinute()
  const { clocks, unknown } = useMemo(() => parseWorldClocks(text(instance, 'zones')), [instance])
  const hour12 = flag(instance, 'hour12')
  if (!clocks.length) {
    return <Empty>{unknown.length ? `Orbis does not know the time zone “${unknown[0]}”. Use a name like Europe/London.` : 'Add places in this widget’s settings.'}</Empty>
  }
  return (
    <>
      <ul className="wg-list wg-world">
        {clocks.map((clock) => {
          const there = timeIn(clock.zone, now, hour12)
          const hours = Math.abs(there.offsetFromHere) / 60
          return (
            <li key={`${clock.label}-${clock.zone}`} className="wg-world-row">
              <span>{clock.label}</span>
              <b>{there.time}</b>
              <small className="view-muted">
                {there.day}
                {there.offsetFromHere === 0 ? '' : ` · ${there.offsetFromHere > 0 ? '+' : '−'}${hours % 1 ? hours.toFixed(1) : hours}h`}
              </small>
            </li>
          )
        })}
      </ul>
      {unknown.length > 0 && <small className="view-muted">Not recognised: {unknown.join(', ')}</small>}
    </>
  )
}

// ---------------------------------------------------------------- from outside

type Loaded<T> = { state: 'loading' } | { state: 'ready'; data: T; fetchedAt: number; stale: boolean } | { state: 'failed'; reason: string }
type Answer<T> = { ok: true; data: T; fetchedAt: number; stale: boolean } | { ok: false; reason: string }

/**
 * Data from the main process, which fetches and caches it.
 *
 * Asked for when the widget appears and again on its refresh interval — cheap, because the main process answers from
 * its cache until the data is really stale — and never while the window is out of sight. Nothing is shown until
 * something real has arrived, and a refresh that fails keeps what was on screen, marked as old, rather than blanking it.
 */
function useSourced<T>(load: () => Promise<Answer<T>>, key: string, everyMs: number): [Loaded<T>, () => void] {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: 'loading' })
  const [round, setRound] = useState(0)
  const latest = useRef(load)
  latest.current = load

  useEffect(() => {
    let alive = true
    const run = (): void => {
      if (document.hidden) return
      void latest
        .current()
        .then((result) => {
          if (!alive) return
          setLoaded((was) =>
            result.ok
              ? { state: 'ready', data: result.data, fetchedAt: result.fetchedAt, stale: result.stale }
              : was.state === 'ready'
                ? { ...was, stale: true }
                : { state: 'failed', reason: result.reason }
          )
        })
        .catch(() => {
          if (alive) setLoaded((was) => (was.state === 'ready' ? { ...was, stale: true } : { state: 'failed', reason: 'Orbis could not ask for this.' }))
        })
    }
    run()
    const timer = window.setInterval(run, Math.max(60_000, everyMs))
    const visible = (): void => {
      if (!document.hidden) run()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [key, everyMs, round])

  const refresh = useCallback(() => {
    setLoaded({ state: 'loading' })
    setRound((n) => n + 1)
  }, [])
  return [loaded, refresh]
}

const Freshness = ({ fetchedAt, stale, onRefresh }: { fetchedAt: number; stale: boolean; onRefresh(): void }): React.JSX.Element => (
  <small className={`wg-fresh view-muted${stale ? ' stale' : ''}`}>
    {stale ? `Could not update · last updated ${ago(fetchedAt)}` : `Updated ${ago(fetchedAt)}`}
    <button type="button" className="wg-icon" aria-label="Refresh" onClick={onRefresh}>
      <RotateCcw size={11} />
    </button>
  </small>
)

const Unavailable = ({ reason, onRetry }: { reason: string; onRetry(): void }): React.JSX.Element => (
  <div className="wg-failed-soft" role="status">
    <Empty>{reason}</Empty>
    <button type="button" className="queue-btn small" onClick={onRetry}>
      <RotateCcw size={12} /> Try again
    </button>
  </div>
)

const WeatherView: WidgetView = ({ instance }) => {
  const city = text(instance, 'city').trim()
  const unit = text(instance, 'unit', 'c') === 'f' ? 'f' : 'c'
  const [loaded, refresh] = useSourced<Weather>(() => window.api.widgetWeather(city), city, 30 * 60_000)

  if (!city) return <Empty>Choose a city in this widget’s settings.</Empty>
  if (loaded.state === 'loading') return <Empty>Loading the weather for {city}…</Empty>
  if (loaded.state === 'failed') return <Unavailable reason={loaded.reason} onRetry={refresh} />
  const weather = loaded.data
  return (
    <div className="wg-weather">
      <div className="wg-weather-now">
        <b>{temperatureIn(weather.now.temperature, unit)}</b>
        <span>
          {weather.now.condition}
          <small className="view-muted">{weather.place}</small>
        </span>
      </div>
      <small className="view-muted">
        {weather.high !== undefined && weather.low !== undefined ? `Next 24 hours: ${temperatureIn(weather.low, unit)} to ${temperatureIn(weather.high, unit)}` : ''}
        {weather.now.humidity !== undefined ? ` · Humidity ${weather.now.humidity}%` : ''}
        {weather.now.windSpeed !== undefined ? ` · Wind ${weather.now.windSpeed} m/s` : ''}
      </small>
      {flag(instance, 'hours', true) && weather.hours.length > 0 && instance.size !== 'small' && (
        <ul className="wg-weather-hours">
          {weather.hours.slice(0, 5).map((hour) => (
            <li key={hour.at} title={hour.condition}>
              <small className="view-muted">{new Date(hour.at).toLocaleTimeString([], { hour: 'numeric' })}</small>
              <b>{temperatureIn(hour.temperature, unit)}</b>
            </li>
          ))}
        </ul>
      )}
      <Freshness fetchedAt={loaded.fetchedAt} stale={loaded.stale} onRefresh={refresh} />
      <small className="wg-attribution view-muted">{weather.attribution} · Places © OpenStreetMap contributors</small>
    </div>
  )
}

const News: WidgetView = ({ instance, onOpen }) => {
  const feeds = useMemo(() => parseFeedList(text(instance, 'feeds')), [instance])
  const limit = number(instance, 'limit', 6)
  const [loaded, refresh] = useSourced<FeedItem[]>(
    async () => {
      const results = await Promise.all(feeds.map((url) => window.api.widgetFeed(url)))
      const good = results.flatMap((r) => (r.ok ? [r] : []))
      if (!good.length) {
        const firstFailure = results.find((r) => !r.ok)
        return { ok: false as const, reason: firstFailure && !firstFailure.ok ? firstFailure.reason : 'No feeds could be read.' }
      }
      return {
        ok: true as const,
        data: mergeFeeds(good.map((r) => r.data), limit),
        fetchedAt: Math.min(...good.map((r) => r.fetchedAt)),
        // Some feeds answering and some not is still worth saying.
        stale: good.some((r) => r.stale) || good.length < results.length
      }
    },
    `${feeds.join(' ')}|${limit}`,
    20 * 60_000
  )

  if (!feeds.length) return <Empty>Add the address of an RSS or Atom feed in this widget’s settings.</Empty>
  if (loaded.state === 'loading') return <Empty>Loading headlines…</Empty>
  if (loaded.state === 'failed') return <Unavailable reason={loaded.reason} onRetry={refresh} />
  if (!loaded.data.length) return <Empty>These feeds have no headlines right now.</Empty>
  return (
    <>
      <ul className="wg-list">
        {loaded.data.map((item) => (
          <li key={item.url}>
            {/* Opened through Orbis's own navigation, in the browser, like any other link. */}
            <button type="button" className="wg-line wg-news" onClick={() => onOpen({ kind: 'url', value: item.url })}>
              <span>{item.title}</span>
              <small className="view-muted">
                {item.source}
                {item.publishedAt ? ` · ${ago(item.publishedAt)}` : ''}
              </small>
            </button>
          </li>
        ))}
      </ul>
      <Freshness fetchedAt={loaded.fetchedAt} stale={loaded.stale} onRefresh={refresh} />
    </>
  )
}

const Recent: WidgetView = ({ instance, onOpen }) => {
  const [history, setHistory] = useState<{ url: string; title: string; visitedAt: number }[]>([])
  useEffect(() => {
    const take = (library: { history?: { url: string; title: string; visitedAt: number }[] }): void => setHistory(library.history ?? [])
    void window.api.getBrowserLibrary().then(take)
    // Follows history as it changes, so a site visited a moment ago is here without reopening the tab.
    return window.api.onBrowserLibrary(take)
  }, [])
  const sites = useMemo(() => recentSites(history, number(instance, 'limit', 6)), [history, instance])

  if (!sites.length) return <Empty>No sites visited yet.</Empty>
  return (
    <ul className="wg-list">
      {sites.map((site) => (
        <li key={site.host}>
          <button type="button" className="wg-line" onClick={() => onOpen({ kind: 'url', value: site.url })} title={site.url}>
            <ExternalLink size={12} /> <span>{site.title}</span>
            <small className="view-muted">{site.host}</small>
          </button>
        </li>
      ))}
    </ul>
  )
}

export const WIDGET_VIEWS: Record<string, WidgetView> = {
  clock: Clock,
  countdown: Countdown,
  timer: Timer,
  tasks: Tasks,
  notes: Notes,
  whiteboard: Whiteboards,
  clipboard: Clips,
  bookmarks: Bookmarks,
  downloads: Downloads,
  tabs: Tabs,
  workspaces: Workspaces,
  quote: Quote,
  games: Games,
  calculator: Calculator,
  greeting: Greeting,
  worldclock: WorldClocks,
  weather: WeatherView,
  news: News,
  recent: Recent
}
