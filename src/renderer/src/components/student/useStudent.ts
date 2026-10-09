import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StudentSnapshot } from '../../../../shared/student/types'

/**
 * Talking to Orbis Student from the interface.
 *
 * One hook, so there is one copy of the snapshot on screen at a time. Several components all asking for their own
 * would be several answers that disagree with each other for a moment -- and the one they disagree about is a timer,
 * which is the one a person would notice.
 *
 * The timer is handled separately from everything else, and deliberately: the seconds come from the snapshot, but
 * between snapshots they are counted locally so the display moves every second without Orbis being asked sixty times
 * a minute. The local count never becomes the truth -- the next snapshot replaces it, so a drifting browser clock
 * cannot make the timer wrong, only briefly out of step.
 */

export type Call = <T = unknown>(op: string, a?: unknown, b?: unknown, c?: unknown) => Promise<T>

export interface Catalogue {
  levels: Record<string, { label: string; blurb: string; blocked: readonly string[]; enforce: string; locked: boolean }>
  presets: readonly { id: string; label: string; minutes: number; level: 'light' | 'focus' | 'deep'; breaks: { focusMinutes: number; breakMinutes: number; blocks: number; autoResume: boolean }; blurb: string }[]
  pomodoro: Record<string, { label: string; plan: { focusMinutes: number; breakMinutes: number; blocks: number; autoResume: boolean }; minutes: number }>
  quests: readonly { id: string; period: string; title: string; target: number; xp: number }[]
  achievements: readonly { id: string; title: string; blurb: string; category: string; threshold: number; xp: number }[]
  cosmetics: readonly { id: string; label: string; kind: string; level: number | null }[]
  sounds: readonly { id: string; label: string; blurb: string; needsFile: boolean; unavailable?: string }[]
  playableSounds: readonly string[]
  atmospheres: readonly { id: string; label: string; blurb: string; mix: { layers: Record<string, number> }; environment: string }[]
  environments: readonly { id: string; label: string; blurb: string; look: { tint: string; depth: string; motion: string } }[]
  widgets: readonly { id: string; label: string; blurb: string }[]
  resetScopes: readonly { id: string; label: string; blurb: string }[]
  categories: Record<string, string>
  bands: Record<string, string>
  mistakeKinds: Record<string, string>
}

const api = (): { student: Call; onStudentChanged(listener: () => void): () => void } =>
  window.api as unknown as { student: Call; onStudentChanged(listener: () => void): () => void }

export function useStudent(): {
  snapshot: StudentSnapshot | null
  catalogue: Catalogue | null
  /** Seconds elapsed and remaining, moving every second between snapshots. */
  ticking: { elapsed: number; remaining: number; through: number } | null
  call: Call
  refresh(): Promise<void>
  problems: string[]
} {
  const [snapshot, setSnapshot] = useState<StudentSnapshot | null>(null)
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [drift, setDrift] = useState(0)
  const takenAt = useRef(Date.now())

  const call = useCallback<Call>(async (op, a, b, c) => {
    return (await api().student(op, a, b, c)) as never
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const next = (await call<StudentSnapshot>('snapshot')) ?? null
    takenAt.current = Date.now()
    setDrift(0)
    setSnapshot(next)
  }, [call])

  useEffect(() => {
    void refresh()
    void call<Catalogue>('catalogue').then((one) => setCatalogue(one ?? null))
    void call<string[]>('problems').then((one) => setProblems(Array.isArray(one) ? one : []))
    // Orbis says when anything changed, rather than the interface asking on a timer.
    return api().onStudentChanged(() => void refresh())
  }, [call, refresh])

  const running = snapshot?.timer?.state === 'active'
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setDrift(Math.round((Date.now() - takenAt.current) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [running, snapshot?.session?.id])

  const ticking = useMemo(() => {
    const timer = snapshot?.timer
    if (!timer) return null
    // Only while actually focusing: a paused or broken session must not appear to be counting.
    const extra = timer.state === 'active' ? drift : 0
    const elapsed = Math.min(timer.plannedSeconds, timer.elapsed + extra)
    return {
      elapsed,
      remaining: Math.max(0, timer.plannedSeconds - elapsed),
      through: timer.plannedSeconds > 0 ? Math.min(1, elapsed / timer.plannedSeconds) : 0
    }
  }, [snapshot?.timer, drift])

  return { snapshot, catalogue, ticking, call, refresh, problems }
}

/** A clock, the way a person reads one. The same shape the main process uses, so they never disagree. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function spell(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  if (whole < 60) return `${whole}s`
  const h = Math.floor(whole / 3600)
  const m = Math.round((whole % 3600) / 60)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

/** A date the way this computer writes dates. */
export function onDay(at: number | null): string {
  return at === null ? '' : new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function atTime(at: number | null): string {
  return at === null ? '' : new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** A whole number with the separators this computer uses. */
export function count(value: number): string {
  return Math.round(value).toLocaleString()
}

/** Whether this person has asked for less movement, from the system or from their own Student settings. */
export function useReducedMotion(preference: boolean): boolean {
  const [system, setSystem] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setSystem(query.matches)
    const onChange = (): void => setSystem(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return system || preference
}
