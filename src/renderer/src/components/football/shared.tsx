import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useReducedMotion } from './MatchViews'
import { emptyFollows, sanitizeFollows, type FbFollows, type FbSavedView, type FbUi } from '../../../../shared/football/follows'
import { clockLabel, freshnessLabel, reconcileScore } from '../../../../shared/football/logic'
import { isLive, type FbAnswer, type FbMatch, type FbSource } from '../../../../shared/football/types'

export type Load<T> = { state: 'loading' } | { state: 'error'; message: string; reason: string } | { state: 'ready'; answer: Extract<FbAnswer<T>, { ok: true }>; at: number }

/** Asks the main process; keeps the answer, a marker, or the reason it failed. `everyMs` re-asks quietly (the old answer stays on screen). */
export function useFb<T>(ask: (() => Promise<unknown>) | null, deps: unknown[], everyMs = 0): [Load<T>, () => void] {
  const [load, setLoad] = useState<Load<T>>({ state: 'loading' })
  const [tick, setTick] = useState(0)
  const first = useRef(true)
  useEffect(() => {
    if (!ask) return
    let live = true
    if (first.current || tick === 0) setLoad({ state: 'loading' })
    first.current = false
    const run = (): void => {
      ask()
        .then((raw) => {
          if (!live) return
          const a = raw as FbAnswer<T>
          if (a.ok) setLoad({ state: 'ready', answer: a, at: Date.now() })
          else setLoad((cur) => (cur.state === 'ready' ? cur : { state: 'error', message: a.message, reason: a.reason }))
        })
        .catch((e: unknown) => live && setLoad((cur) => (cur.state === 'ready' ? cur : { state: 'error', message: e instanceof Error ? e.message : String(e), reason: 'offline' })))
    }
    run()
    const timer = everyMs > 0 ? setInterval(run, everyMs) : null
    return () => {
      live = false
      if (timer) clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return [load, useCallback(() => setTick((t) => t + 1), [])]
}

const PROVIDER_NAME = { openligadb: 'OpenLigaDB', thesportsdb: 'TheSportsDB' } as const

export function SourceLine({ load, retry }: { load: Load<unknown>; retry: () => void }): React.JSX.Element | null {
  if (load.state !== 'ready') return null
  const { sources, freshness, notes } = load.answer
  const names = [...new Set(sources.map((s: FbSource) => PROVIDER_NAME[s.provider]))].join(' + ')
  const newest = sources.map((s: FbSource) => s.retrievedAt).sort().pop() ?? ''
  const words = { fresh: 'just fetched', cached: 'from this session’s cache', stale: 'OLD: the provider could not be reached, showing the last answer' }[freshness]
  return (
    <p className={`fb-source is-${freshness}`}>
      {names} · {words} · received {newest ? new Date(newest).toLocaleTimeString() : '–'}
      <button type="button" className="fb-link" onClick={retry}>
        <RefreshCw size={12} /> Refresh
      </button>
      {notes.map((n) => (
        <small key={n}>{n}</small>
      ))}
    </p>
  )
}

export function Waiting({ load, retry, what }: { load: Load<unknown>; retry: () => void; what: string }): React.JSX.Element | null {
  if (load.state === 'loading') return <p className="fb-note">Loading {what}…</p>
  if (load.state === 'error')
    return (
      <div className="fb-note fb-bad" role="alert">
        <p>{load.reason === 'unsupported' ? load.message : `Could not load ${what}.`}</p>
        {load.reason !== 'unsupported' && <small>{load.message}</small>}
        <button type="button" className="fb-btn" onClick={retry}>
          <RefreshCw size={14} /> Try again
        </button>
      </div>
    )
  return null
}

const WORDS: Record<string, string> = { live: 'Live', delayed: 'Delayed', stale: 'Out of date', cached: 'Cached', final: 'Final', unavailable: 'Unavailable' }

/** One word for how current a match is, from when Orbis last received it (never from a clock counting up on its own). */
export function Fresh({ match, load }: { match: FbMatch; load: Load<unknown> }): React.JSX.Element | null {
  if (load.state !== 'ready') return null
  const label = freshnessLabel({ freshness: load.answer.freshness, retrievedAt: load.answer.sources[0]?.retrievedAt ?? new Date(load.at).toISOString(), now: Date.now(), match })
  return <span className={`fb-fresh is-${label}`}>{WORDS[label]}</span>
}

/*
 * What this profile follows. It lives in the main process (one file per profile) so the background monitor can read it
 * and notify while this screen is closed; every panel shares one copy here and sees a change at once.
 */
let current: FbFollows = emptyFollows()
let loaded = false
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())
const LEGACY = 'orbis.football.follow'

async function loadFollows(): Promise<void> {
  try {
    const a = (await window.api.footballFollows()) as { ok: boolean; data?: FbFollows }
    if (a.ok && a.data) current = sanitizeFollows(a.data)
  } catch {
    // the screen still works, empty
  }
  // Follows kept by the first version (this window's storage) move over once, as keys without names.
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY) ?? 'null') as { teams?: unknown; pins?: unknown } | null
    if (old) {
      const names = (id: unknown): string => String(id)
      const teams = Array.isArray(old.teams) ? old.teams.filter((t): t is string => typeof t === 'string').map((id) => ({ id, name: names(id) })) : []
      const pins = Array.isArray(old.pins) ? old.pins.filter((k): k is string => typeof k === 'string').map((key) => ({ key, title: key })) : []
      localStorage.removeItem(LEGACY)
      if (teams.length + pins.length) await save({ ...current, teams: [...current.teams, ...teams], pins: [...current.pins, ...pins] })
    }
  } catch {
    // nothing to migrate
  }
  loaded = true
  emit()
}

async function save(next: FbFollows): Promise<void> {
  current = sanitizeFollows(next)
  emit()
  try {
    const a = (await window.api.footballFollowsSet(current)) as { ok: boolean; data?: FbFollows }
    if (a.ok && a.data) current = sanitizeFollows(a.data)
  } catch {
    // kept for this visit
  }
  emit()
}

export interface FollowsApi {
  data: FbFollows
  teams: string[]
  pins: string[]
  toggleTeam(id: string, name: string): void
  togglePin(key: string, title: string): void
  hasReminder(key: string): number | null
  setReminder(key: string, title: string, kickoff: string, minutes: number | null): void
  setAlert(kind: 'goals' | 'kickoff' | 'fulltime', on: boolean): void
  saveView(v: Omit<FbSavedView, 'id'>): void
  deleteView(id: string): void
  setUi(patch: Partial<FbUi>): void
  viewed(key: string, title: string): void
}

export function useFollows(): FollowsApi {
  const data = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
  useEffect(() => {
    if (!loaded) void loadFollows()
  }, [])
  const flip = <T,>(l: T[], same: (x: T) => boolean, item: T): T[] => (l.some(same) ? l.filter((x) => !same(x)) : [...l, item])
  return {
    data,
    teams: data.teams.map((t) => t.id),
    pins: data.pins.map((p) => p.key),
    toggleTeam: (id, name) => void save({ ...current, teams: flip(current.teams, (t) => t.id === id, { id, name }) }),
    togglePin: (key, title) => void save({ ...current, pins: flip(current.pins, (p) => p.key === key, { key, title }) }),
    hasReminder: (key) => current.reminders.find((r) => r.key === key)?.minutes ?? null,
    setReminder: (key, title, kickoff, minutes) => {
      const rest = current.reminders.filter((r) => r.key !== key)
      void save({ ...current, reminders: minutes === null ? rest : [...rest, { key, title, kickoff, minutes }] })
    },
    setAlert: (kind, on) => void save({ ...current, alerts: { ...current.alerts, [kind]: on } }),
    saveView: (v) => void save({ ...current, views: [...current.views, { ...v, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }] }),
    deleteView: (id) => void save({ ...current, views: current.views.filter((v) => v.id !== id) }),
    setUi: (patch) => void save({ ...current, ui: { ...current.ui, ...patch } }),
    viewed: (key, title) => {
      if (current.ui.recent[0]?.key === key) return
      void save({ ...current, ui: { ...current.ui, recent: [{ key, title }, ...current.ui.recent.filter((r) => r.key !== key)].slice(0, 8) } })
    }
  }
}

export function Crest({ url, name }: { url: string | null; name: string }): React.JSX.Element {
  const [bad, setBad] = useState(false)
  if (!url || bad) return <span className="fb-crest is-none" aria-hidden="true">{name.slice(0, 1)}</span>
  return <img className="fb-crest" src={url} alt="" loading="lazy" onError={() => setBad(true)} referrerPolicy="no-referrer" />
}

export function MatchRow({ m, onOpen, pinned, selected }: { m: FbMatch; onOpen: (key: string) => void; pinned?: boolean; selected?: boolean }): React.JSX.Element {
  const { data } = useFollows()
  const reduce = useReducedMotion(data.ui.reduceMotion)
  const live = isLive(m.status)
  const h = m.score.home
  const a = m.score.away
  const score = h === null || a === null ? '–' : `${h} : ${a}`
  // A score that changes while the row is on screen flips the digit that changed, and a goal sends a ripple out from
  // it. For a team you follow (or a match you pinned) it also says GOAL. A row that first appears with a score does none
  // of this: opening the screen on a match at 2-1 is not a goal.
  const prev = useRef({ h, a })
  const [flip, setFlip] = useState<{ h: boolean; a: boolean; goal: boolean } | null>(null)
  const followed = data.teams.some((t) => t.id === m.home.id || t.id === m.away.id) || data.pins.some((p) => p.key === m.key)
  useEffect(() => {
    const p = prev.current
    if (p.h === h && p.a === a) return
    const goal = (h ?? 0) + (a ?? 0) > (p.h ?? 0) + (p.a ?? 0)
    prev.current = { h, a }
    if (reduce) return
    setFlip({ h: h !== p.h, a: a !== p.a, goal })
    const t = setTimeout(() => setFlip(null), 3000)
    return () => clearTimeout(t)
  }, [h, a, reduce])
  const clock = clockLabel(m, Date.now(), data.ui.timeZone)
  return (
    <li>
      <button type="button" className={`fb-row${live ? ' is-live' : ''}${selected ? ' is-on' : ''}${data.ui.compact ? ' is-compact' : ''}`} onClick={() => onOpen(m.key)} aria-label={`${m.home.name} against ${m.away.name}, ${score}, ${clock}`}>
        <span className="fb-team is-home">
          {m.home.name}
          <Crest url={m.home.badge} name={m.home.name} />
        </span>
        <span className={`fb-score${flip ? ' is-pulse' : ''}${flip?.goal && followed ? ' is-goal' : ''}`}>
          {h === null || a === null ? (
            '–'
          ) : (
            <>
              <span key={`h${h}`} className={`fb-digit${flip?.h ? ' is-flip' : ''}`}>
                {h}
              </span>
              <span className="fb-colon">:</span>
              <span key={`a${a}`} className={`fb-digit${flip?.a ? ' is-flip' : ''}`}>
                {a}
              </span>
            </>
          )}
          {flip?.goal && <i className="fb-ripple" aria-hidden="true" />}
          {flip?.goal && followed && <b className="fb-goal-tag">GOAL</b>}
        </span>
        <span className="fb-team">
          <Crest url={m.away.badge} name={m.away.name} />
          {m.away.name}
        </span>
        <span className="fb-clock">
          {live && <i className="fb-dot" aria-hidden="true" />}
          {clock}
          {m.liveBasis === 'inferred' && <small>inferred</small>}
        </span>
        <small className="fb-meta">
          {m.competition.name}
          {m.round ? ` · ${m.round}` : ''}
          {pinned ? ' · pinned' : ''}
          {reconcileScore(m).state === 'conflict' ? ' · score and goals disagree' : ''}
        </small>
      </button>
    </li>
  )
}
