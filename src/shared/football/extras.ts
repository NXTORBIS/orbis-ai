/**
 * Orbis Arena -> Football: what TheSportsDB's public key adds to a match and to a team. Measured: each of these lists is
 * cut to the first few entries by the key (five lineup players, five timeline items, five statistics, ten squad
 * members), so every one of them carries `partial` and the screen says "the first N the provider returns". Nothing
 * here is completed from guesses: a missing list stays missing.
 */

type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' && v !== 'NULL' ? v.trim() : null)
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

export interface FbLineupPlayer {
  name: string
  side: 'home' | 'away' | null
  position: string | null
  number: number | null
  substitute: boolean
  team: string | null
}

export type FbTimelineKind = 'goal' | 'card' | 'substitution' | 'var' | 'other'
export interface FbTimelineItem {
  id: string
  kind: FbTimelineKind
  detail: string
  minute: number | null
  side: 'home' | 'away' | null
  player: string | null
  /** For a substitution, the player coming on (the provider's "assist" slot); for a goal, the assist. */
  other: string | null
  team: string | null
}

export interface FbStat {
  name: string
  home: number | null
  away: number | null
}

export interface FbMatchExtras {
  lineup: FbLineupPlayer[]
  timeline: FbTimelineItem[]
  stats: FbStat[]
  /** The key returned a full-looking page (5 items): more may exist than were returned. */
  partial: boolean
}

const side = (v: unknown): 'home' | 'away' | null => (v === 'Yes' ? 'home' : v === 'No' ? 'away' : null)

export function normalizeLineup(payload: unknown): FbLineupPlayer[] {
  const out: FbLineupPlayer[] = []
  for (const raw of arr(obj(payload)?.lineup)) {
    const x = obj(raw)
    const name = str(x?.strPlayer)
    if (!x || !name) continue
    out.push({ name, side: side(x.strHome), position: str(x.strPosition), number: num(x.intSquadNumber), substitute: x.strSubstitute === 'Yes', team: str(x.strTeam) })
  }
  return out
}

function kindOf(t: string | null): FbTimelineKind {
  const s = (t ?? '').toLowerCase()
  if (s.includes('goal')) return 'goal'
  if (s.includes('card')) return 'card'
  if (s.startsWith('subst')) return 'substitution'
  if (s.includes('var')) return 'var'
  return 'other'
}

export function normalizeTimeline(payload: unknown): FbTimelineItem[] {
  const out: FbTimelineItem[] = []
  for (const raw of arr(obj(payload)?.timeline)) {
    const x = obj(raw)
    const id = str(x?.idTimeline)
    if (!x || !id) continue
    const kind = kindOf(str(x.strTimeline))
    out.push({
      id: `thesportsdb:${id}`,
      kind,
      detail: str(x.strTimelineDetail) ?? str(x.strTimeline) ?? '',
      minute: num(x.intTime),
      side: side(x.strHome),
      player: str(x.strPlayer),
      other: str(x.strAssist),
      team: str(x.strTeam)
    })
  }
  return out.sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999))
}

export function normalizeEventStats(payload: unknown): FbStat[] {
  const out: FbStat[] = []
  for (const raw of arr(obj(payload)?.eventstats)) {
    const x = obj(raw)
    const name = str(x?.strStat)
    if (!x || !name) continue
    out.push({ name, home: num(x.intHome), away: num(x.intAway) })
  }
  return out
}

/**
 * Home and away shares of a statistic, for a bar. A pair where either number is missing has no bar (null), and a pair
 * of zeros has none either: a missing value is not "0%".
 */
export function statShare(s: FbStat): { home: number; away: number } | null {
  if (s.home === null || s.away === null) return null
  const t = s.home + s.away
  if (t <= 0) return null
  return { home: s.home / t, away: s.away / t }
}

export interface FbTeamProfile {
  id: string
  name: string
  badge: string | null
  country: string | null
  league: string | null
  stadium: string | null
  capacity: number | null
  location: string | null
  formed: number | null
  website: string | null
  description: string | null
  squad: { name: string; position: string | null; number: number | null; nationality: string | null; status: string | null }[]
  squadPartial: boolean
}

export function normalizeTeam(payload: unknown): Omit<FbTeamProfile, 'squad' | 'squadPartial'> | null {
  const t = obj(arr(obj(payload)?.teams)[0])
  const id = str(t?.idTeam)
  const name = str(t?.strTeam)
  if (!t || !id || !name) return null
  const site = str(t.strWebsite)
  return {
    id: `thesportsdb:${id}`,
    name,
    badge: str(t.strBadge),
    country: str(t.strCountry),
    league: str(t.strLeague),
    stadium: str(t.strStadium),
    capacity: num(t.intStadiumCapacity),
    location: str(t.strLocation) ?? str(t.strStadiumLocation),
    formed: num(t.intFormedYear),
    website: site ? (/^https?:\/\//.test(site) ? site : `https://${site}`) : null,
    description: str(t.strDescriptionEN)?.slice(0, 900) ?? null
  }
}

export function normalizeSquad(payload: unknown): FbTeamProfile['squad'] {
  const out: FbTeamProfile['squad'] = []
  for (const raw of arr(obj(payload)?.player)) {
    const x = obj(raw)
    const name = str(x?.strPlayer)
    if (!x || !name) continue
    out.push({ name, position: str(x.strPosition), number: num(x.strNumber), nationality: str(x.strNationality), status: str(x.strStatus) })
  }
  return out
}
