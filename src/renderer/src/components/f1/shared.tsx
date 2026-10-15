import { Download, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { emptyPrefs, sanitizePrefs, type F1Prefs } from '../../../../shared/f1/extras'
import { safeFileName, toCsv } from '../../../../shared/f1/csv'
import type { F1Answer } from '../../../../shared/f1/types'

export type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; answer: Extract<F1Answer<T>, { ok: true }> }

/** Asks the main process and keeps the answer, an in-progress marker, or the reason it failed. */
export function useF1<T>(ask: (() => Promise<unknown>) | null, deps: unknown[]): [Load<T>, () => void] {
  const [load, setLoad] = useState<Load<T>>({ state: 'loading' })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!ask) return
    let live = true
    setLoad({ state: 'loading' })
    ask()
      .then((raw) => {
        if (!live) return
        const a = raw as F1Answer<T>
        setLoad(a.ok ? { state: 'ready', answer: a } : { state: 'error', message: a.message })
      })
      .catch((e: unknown) => live && setLoad({ state: 'error', message: e instanceof Error ? e.message : String(e) }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return [load, () => setTick((t) => t + 1)]
}

export const PROVIDER_NAME = { jolpica: 'Jolpica-F1', openf1: 'OpenF1', f1archive: 'F1 live-timing archive', openmeteo: 'Open-Meteo' } as const

export function SourceLine({ load, retry }: { load: Load<unknown>; retry: () => void }): React.JSX.Element | null {
  if (load.state !== 'ready') return null
  const { source, freshness } = load.answer
  const at = new Date(source.retrievedAt)
  const words = { fresh: 'just fetched', cached: 'from this session’s cache', stale: 'OLD: the provider could not be reached, showing the last answer' }[freshness]
  return (
    <p className={`f1-source is-${freshness}`}>
      {PROVIDER_NAME[source.provider]} · {words} · {at.toLocaleString()}
      <button type="button" className="f1-link" onClick={retry}>
        <RefreshCw size={12} /> Refresh
      </button>
    </p>
  )
}

export function Waiting({ load, retry, what }: { load: Load<unknown>; retry: () => void; what: string }): React.JSX.Element | null {
  if (load.state === 'loading') return <p className="f1-note">Loading {what}…</p>
  if (load.state === 'error')
    return (
      <div className="f1-note f1-bad" role="alert">
        <p>Could not load {what}.</p>
        <small>{load.message}</small>
        <button type="button" className="f1-btn" onClick={retry}>
          <RefreshCw size={14} /> Try again
        </button>
      </div>
    )
  return null
}

export const when = (iso: string | null): string => {
  if (!iso) return 'Time to be confirmed'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : iso.length <= 10 ? d.toLocaleDateString() : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}


/**
 * Saves a table as a CSV file through the browser's own download. Only what is on the screen is written, with its
 * column names; missing values are empty cells.
 */
export function ExportButton({ name, header, rows }: { name: string; header: string[]; rows: (string | number | boolean | null | undefined)[][] }): React.JSX.Element {
  const run = (): void => {
    const blob = new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeFileName(name)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
  return (
    <button type="button" className="f1-btn" onClick={run} disabled={rows.length === 0} title="Save this table as a CSV file">
      <Download size={14} /> Export CSV
    </button>
  )
}

/*
 * What this profile keeps for F1 (the watchlist and the alert switches). It lives in the main process, one file per
 * profile, so the background monitor can read it with this screen closed; every panel shares one copy here.
 */
let current: F1Prefs = emptyPrefs()
let loaded = false
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())
const LEGACY_WATCH = 'orbis.f1.watchlist'

async function savePrefs(next: F1Prefs): Promise<void> {
  current = sanitizePrefs(next)
  emit()
  try {
    const a = (await window.api.f1PrefsSet(current)) as { ok: boolean; data?: F1Prefs }
    if (a.ok && a.data) current = sanitizePrefs(a.data)
  } catch {
    // kept for this visit
  }
  emit()
}

async function loadPrefs(): Promise<void> {
  try {
    const a = (await window.api.f1Prefs()) as { ok: boolean; data?: F1Prefs }
    if (a.ok && a.data) current = sanitizePrefs(a.data)
  } catch {
    // the screen still works, with defaults
  }
  // A watchlist kept by the first version (this window's storage) moves into the profile once.
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY_WATCH) ?? 'null') as unknown
    if (Array.isArray(old)) {
      localStorage.removeItem(LEGACY_WATCH)
      await savePrefs({ ...current, watchlist: [...new Set([...current.watchlist, ...old.filter((x): x is string => typeof x === 'string')])] })
    }
  } catch {
    // nothing to move
  }
  loaded = true
  emit()
}

export function usePrefs(): { prefs: F1Prefs; setAlert(kind: 'sessions' | 'results', on: boolean): void; setLead(minutes: number): void } {
  const prefs = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
  useEffect(() => {
    if (!loaded) void loadPrefs()
  }, [])
  return {
    prefs,
    setAlert: (kind, on) => void savePrefs({ ...current, alerts: { ...current.alerts, [kind]: on } }),
    setLead: (minutes) => void savePrefs({ ...current, leadMinutes: minutes })
  }
}

/** A short list of favourite drivers, kept in this profile (and read by the result alerts). */
export function useWatchlist(): { ids: string[]; has: (id: string) => boolean; toggle: (id: string) => void } {
  const { prefs } = usePrefs()
  const ids = prefs.watchlist
  const toggle = useCallback((id: string) => {
    void savePrefs({ ...current, watchlist: current.watchlist.includes(id) ? current.watchlist.filter((x) => x !== id) : [...current.watchlist, id].slice(0, 50) })
  }, [])
  return { ids, has: (id) => ids.includes(id), toggle }
}

const NOTE_PREFIX = 'orbis.f1.note.'

/** A private note for one subject (a session, a lap). Stored on this computer only, never sent anywhere. */
export function Notes({ id, label }: { id: string; label: string }): React.JSX.Element {
  const key = NOTE_PREFIX + id
  const read = (): string => {
    try {
      return localStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  }
  const [text, setText] = useState(read)
  useEffect(() => setText(read()), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="f1-notes">
      {label}
      <textarea
        value={text}
        placeholder="Only you can see this. It is kept on this computer."
        maxLength={4000}
        onChange={(e) => {
          setText(e.target.value)
          try {
            if (e.target.value) localStorage.setItem(key, e.target.value)
            else localStorage.removeItem(key)
          } catch {
            // storage unavailable: the note lasts for this visit only
          }
        }}
      />
    </label>
  )
}

export interface SavedComparison {
  name: string
  sessionKey: number
  sessionLabel: string
  a: { driver: number; lap: number }
  b: { driver: number; lap: number } | null
}

const CMP_KEY = 'orbis.f1.comparisons'

export function useSavedComparisons(): { items: SavedComparison[]; save: (c: SavedComparison) => void; remove: (name: string) => void } {
  const read = (): SavedComparison[] => {
    try {
      const v = JSON.parse(localStorage.getItem(CMP_KEY) ?? '[]')
      return Array.isArray(v) ? v.filter((x) => x && typeof x.name === 'string' && Number.isInteger(x.sessionKey)).slice(0, 40) : []
    } catch {
      return []
    }
  }
  const [items, setItems] = useState<SavedComparison[]>(read)
  const write = (next: SavedComparison[]): void => {
    setItems(next)
    try {
      localStorage.setItem(CMP_KEY, JSON.stringify(next))
    } catch {
      // not kept beyond this visit
    }
  }
  return {
    items,
    save: (c) => write([c, ...items.filter((x) => x.name !== c.name)].slice(0, 40)),
    remove: (name) => write(items.filter((x) => x.name !== name))
  }
}
