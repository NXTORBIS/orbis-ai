/**
 * Saved Orion Search sessions: research that is still there tomorrow.
 *
 * A session is kept as the session itself — the questions, answers, sources and conditions exactly as they were — so
 * picking it up again is continuing it, not reconstructing it. What is saved is only ever read from what the session
 * really holds; nothing here makes up a source or an answer.
 */
import type { OrionSearchSession, SearchSource, SearchTurn } from './orionSearch.ts'
import { sessionTitle } from './orionSearch.ts'

export const SEARCH_SESSION_FORMAT = 1
export const MAX_SAVED_TURNS = 60
export const MAX_SAVED_SOURCES = 120

export interface SavedSearchSummary {
  id: string
  title: string
  topic: string
  turns: number
  sources: number
  startedAt: number
  updatedAt: number
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')
const time = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/**
 * A session as it may be stored: checked field by field, cut to size, and refused if it is not a session at all.
 * Sources that are not web addresses are dropped, since a saved search must never become a way to store a link that
 * runs something when opened.
 */
export function normalizeSearchSession(raw: unknown, profileId: string): OrionSearchSession | null {
  const r = raw as Partial<OrionSearchSession> | null
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(r.id)) return null
  const turns: SearchTurn[] = (Array.isArray(r.turns) ? r.turns : [])
    .map((t) => ({
      id: text(t?.id, 80) || 'turn',
      question: text(t?.question, 2000),
      answer: text(t?.answer, 20_000),
      used: (Array.isArray(t?.used) ? t.used : []).filter((n): n is number => Number.isInteger(n) && n >= 0).slice(0, 50),
      researched: t?.researched === true,
      at: time(t?.at),
      ...(Array.isArray(t?.queries) ? { queries: t.queries.map((q) => text(q, 300)).filter(Boolean).slice(0, 3) } : {}),
      ...(Array.isArray(t?.invalidCitations) && t.invalidCitations.length ? { invalidCitations: t.invalidCitations.filter((n): n is number => Number.isInteger(n)).slice(0, 20) } : {}),
      ...(t?.uncited === true ? { uncited: true } : {})
    }))
    .filter((t) => t.question && t.answer)
    .slice(-MAX_SAVED_TURNS)
  if (!turns.length) return null
  const sources: SearchSource[] = []
  for (const s of Array.isArray(r.sources) ? r.sources : []) {
    const url = safeUrl(s?.url)
    if (!url) continue
    sources.push({ url, title: text(s?.title, 300) || url, snippet: text(s?.snippet, 600), site: text(s?.site, 200), turn: Number.isInteger(s?.turn) ? (s.turn as number) : 0 })
    if (sources.length >= MAX_SAVED_SOURCES) break
  }
  return {
    id: r.id,
    profileId,
    topic: text(r.topic, 300) || turns[0].question.slice(0, 300),
    turns,
    sources,
    entities: (Array.isArray(r.entities) ? r.entities : []).map((e) => text(e, 80)).filter(Boolean).slice(0, 24),
    constraints: (Array.isArray(r.constraints) ? r.constraints : []).map((c) => text(c, 300)).filter(Boolean).slice(0, 12),
    startedAt: time(r.startedAt) || turns[0].at,
    updatedAt: time(r.updatedAt) || turns[turns.length - 1].at
  }
}

export function summarize(session: OrionSearchSession): SavedSearchSummary {
  return {
    id: session.id,
    title: sessionTitle(session),
    topic: session.topic,
    turns: session.turns.length,
    sources: session.sources.length,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt
  }
}

/** Everything a session can be found by: its topic, what was asked and answered, what it is about and where it looked. */
export function searchableText(session: OrionSearchSession): string {
  return [session.topic, ...session.entities, ...session.constraints, ...session.turns.flatMap((t) => [t.question, t.answer]), ...session.sources.map((s) => `${s.title} ${s.site}`)]
    .join('\n')
    .slice(0, 200_000)
}

/**
 * "Continue my research on Chromium", "resume the search about electric cars": a request to pick up earlier research
 * rather than start new research. Returns what it was about, or null.
 */
export function resumeRequest(query: string): string | null {
  const match = /^\s*(?:please\s+)?(?:continue|resume|pick up|go back to|reopen|open)\s+(?:my|the|our)?\s*(?:earlier\s+|previous\s+|last\s+)?(?:research|search(?:es)?|session)\s+(?:on|about|into|for|regarding)\s+(.{2,120}?)\s*[.?!]*$/i.exec(query)
  return match ? match[1].trim() : null
}
