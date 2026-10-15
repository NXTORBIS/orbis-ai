/** What is on in the next day across the Arena, picked from what the providers returned. Pure. */
import type { FbMatch } from './football/types.ts'

export interface TonightMatch {
  key: string
  title: string
  kickoff: string
  at: number
  competition: string
}

const DAY = 24 * 3600_000

/** Scheduled matches with a known kick-off in the next 24 hours, soonest first, at most `limit`. */
export function tonightMatches(matches: FbMatch[], now: number, limit = 5): TonightMatch[] {
  const out: TonightMatch[] = []
  for (const m of matches) {
    if (m.status !== 'scheduled' || !m.kickoff) continue
    const at = Date.parse(m.kickoff)
    if (Number.isNaN(at) || at < now || at > now + DAY) continue
    out.push({ key: m.key, title: `${m.home.name} v ${m.away.name}`, kickoff: m.kickoff, at, competition: m.competition.name })
  }
  return out.sort((a, b) => a.at - b.at).slice(0, limit)
}

/** The next F1 session within a day, or null. A date with no time of day is skipped: it cannot be counted to. */
export function tonightSession(
  sessions: { name: string; startsAt: string | null; race: string }[],
  now: number
): { name: string; race: string; at: number } | null {
  let best: { name: string; race: string; at: number } | null = null
  for (const s of sessions) {
    if (!s.startsAt || s.startsAt.length <= 10) continue
    const at = Date.parse(s.startsAt)
    if (Number.isNaN(at) || at < now || at > now + DAY) continue
    if (!best || at < best.at) best = { name: s.name, race: s.race, at }
  }
  return best
}
