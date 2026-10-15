import type { FbEvent, FbMatch, FbStandingRow, FbStatus, FbTeam } from './types.ts'

/** How long after kickoff a not-yet-finished match is still treated as "probably under way" (90 + break + added + extra). */
export const INFERRED_LIVE_WINDOW_MS = 165 * 60_000

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
/** A count the provider sent as a number or a numeric string; anything else is "not supplied". */
export const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** A UTC instant. OpenLigaDB gives `…Z`; TheSportsDB gives a UTC timestamp without one. A value that is not a date is null. */
export function utcIso(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`
  const t = Date.parse(withZone)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

// ---- OpenLigaDB ------------------------------------------------------------------------------------------------------------

function olTeam(v: unknown): FbTeam | null {
  const t = rec(v)
  const id = t ? num(t.teamId) : null
  const name = t ? str(t.teamName) : null
  if (!t || id === null || !name) return null
  return { id: `openligadb:${id}`, name, short: str(t.shortName), badge: str(t.teamIconUrl) }
}

/**
 * One OpenLigaDB match. It has no "live" flag: a match is `finished` or it is not. So "not finished and kicked off a
 * short while ago" is *inferred* to be live, and is marked as inferred; no minute is invented for it.
 */
export function normalizeOpenLigaMatch(raw: unknown, now: number): FbMatch | null {
  const m = rec(raw)
  if (!m) return null
  const id = num(m.matchID)
  const home = olTeam(m.team1)
  const away = olTeam(m.team2)
  if (id === null || !home || !away) return null
  const kickoff = utcIso(m.matchDateTimeUTC) ?? utcIso(m.matchDateTime)
  const finished = m.matchIsFinished === true
  const results = arr(m.matchResults).map(rec).filter((r): r is Record<string, unknown> => r !== null)
  // "After 90 minutes" is the final result; a later extra-time/penalty result outranks it by its order.
  const final = [...results].sort((a, b) => (num(b.resultOrderID) ?? 0) - (num(a.resultOrderID) ?? 0)).find((r) => /final|after|end/i.test(String(r.resultTypeKind ?? r.resultName ?? ''))) ?? null
  const half = results.find((r) => /half/i.test(String(r.resultTypeKind ?? r.resultName ?? ''))) ?? null

  const goals = arr(m.goals).map(rec).filter((g): g is Record<string, unknown> => g !== null)
  const events: FbEvent[] = []
  let prev = { home: 0, away: 0 }
  const ordered = [...goals].sort((a, b) => (num(a.goalID) ?? 0) - (num(b.goalID) ?? 0))
  for (const g of ordered) {
    const gid = num(g.goalID)
    const h = num(g.scoreTeam1)
    const a = num(g.scoreTeam2)
    // Which side scored is read from which score went up: an own goal's "scoring team" is ambiguous in the feed.
    let side: 'home' | 'away' | null = null
    // A goal entry whose running score did not move is not a goal by the provider's own count (a placeholder or a
    // withdrawn entry in a community-edited feed): kept and marked, so it is explained rather than silently dropped.
    let moved = true
    if (h !== null && a !== null) {
      moved = h > prev.home || a > prev.away
      if (h > prev.home && a === prev.away) side = 'home'
      else if (a > prev.away && h === prev.home) side = 'away'
      if (moved) prev = { home: h, away: a }
    }
    if (side === null && moved) {
      const sid = num(g.scoringTeamId)
      if (sid !== null) side = `openligadb:${sid}` === home.id ? 'home' : `openligadb:${sid}` === away.id ? 'away' : null
    }
    events.push({
      id: gid !== null ? `openligadb:${id}:goal:${gid}` : `openligadb:${id}:goal:${events.length}`,
      kind: g.isOwnGoal === true ? 'own-goal' : g.isPenalty === true ? 'penalty-goal' : 'goal',
      minute: num(g.matchMinute),
      side,
      player: str(g.goalGetterName),
      scoreAfter: h !== null && a !== null ? { home: h, away: a } : null,
      overtime: g.isOvertime === true,
      revoked: !moved
    })
  }

  let status: FbStatus
  let liveBasis: FbMatch['liveBasis'] = null
  const t = kickoff ? Date.parse(kickoff) : NaN
  if (finished) status = 'finished'
  else if (!Number.isNaN(t) && t > now) status = 'scheduled'
  else if (!Number.isNaN(t) && now - t <= INFERRED_LIVE_WINDOW_MS) {
    status = 'in-play'
    liveBasis = 'inferred'
  } else status = Number.isNaN(t) ? 'unknown' : 'unknown'

  // A running score is the last goal's; a finished match's is its result. A match not started has no score (null, not 0).
  const last = events.length ? events[events.length - 1].scoreAfter : null
  let score: FbMatch['score']
  if (final && num(final.pointsTeam1) !== null && num(final.pointsTeam2) !== null) score = { home: num(final.pointsTeam1), away: num(final.pointsTeam2) }
  else if (last) score = { home: last.home, away: last.away }
  else if (status === 'in-play') score = { home: 0, away: 0 }
  else score = { home: null, away: null }

  const lg = rec(m.group)
  const league = str(m.leagueName)
  return {
    key: `openligadb:${id}`,
    provider: 'openligadb',
    competition: { id: `openligadb:${str(m.leagueShortcut) ?? num(m.leagueId) ?? '?'}`, name: league ?? 'Competition', season: num(m.leagueSeason) === null ? null : String(num(m.leagueSeason)) },
    round: lg ? str(lg.groupName) : null,
    kickoff,
    home,
    away,
    status,
    statusRaw: finished ? 'matchIsFinished' : 'matchIsFinished=false',
    liveBasis,
    minute: null,
    score,
    halfTime: half && num(half.pointsTeam1) !== null && num(half.pointsTeam2) !== null ? { home: num(half.pointsTeam1) as number, away: num(half.pointsTeam2) as number } : null,
    events,
    eventsAvailable: true,
    venue: rec(m.location) ? str(rec(m.location)?.locationStadium) ?? str(rec(m.location)?.locationCity) : null,
    sourceUpdatedAt: utcIso(m.lastUpdateDateTime)
  }
}

export const normalizeOpenLigaMatches = (payload: unknown, now: number): FbMatch[] =>
  arr(payload)
    .map((r) => normalizeOpenLigaMatch(r, now))
    .filter((m): m is FbMatch => m !== null)

export function normalizeOpenLigaTable(payload: unknown): FbStandingRow[] {
  const rows: FbStandingRow[] = []
  for (const r of arr(payload)) {
    const t = rec(r)
    const id = t ? num(t.teamInfoId) : null
    const name = t ? str(t.teamName) : null
    if (!t || id === null || !name) continue
    const played = num(t.matches)
    const won = num(t.won)
    const drawn = num(t.draw)
    const lost = num(t.lost)
    const gf = num(t.goals)
    const ga = num(t.opponentGoals)
    const points = num(t.points)
    if (played === null || won === null || drawn === null || lost === null || gf === null || ga === null || points === null) continue
    rows.push({
      position: null,
      team: { id: `openligadb:${id}`, name, short: str(t.shortName), badge: str(t.teamIconUrl) },
      played,
      won,
      drawn,
      lost,
      goalsFor: gf,
      goalsAgainst: ga,
      goalDifference: num(t.goalDiff) ?? gf - ga,
      points,
      form: null,
      note: null
    })
  }
  // The feed arrives in table order; the position is that order, not a guess.
  rows.forEach((r, i) => (r.position = i + 1))
  return rows
}

// ---- TheSportsDB -----------------------------------------------------------------------------------------------------------

const TSDB_STATUS: Record<string, FbStatus> = {
  NS: 'scheduled',
  TBD: 'scheduled',
  '1H': 'first-half',
  HT: 'half-time',
  '2H': 'second-half',
  ET: 'extra-time',
  BT: 'extra-time',
  P: 'penalties',
  PEN: 'penalties',
  LIVE: 'in-play',
  INT: 'in-play',
  FT: 'finished',
  AET: 'finished',
  AP: 'finished',
  'MATCH FINISHED': 'finished',
  'NOT STARTED': 'scheduled',
  PST: 'postponed',
  POSTPONED: 'postponed',
  CANC: 'cancelled',
  CANCELLED: 'cancelled',
  SUSP: 'suspended',
  ABD: 'abandoned',
  AWD: 'finished',
  WO: 'finished'
}

/** The provider's word to our status. An unknown word stays `unknown` (and is kept in `statusRaw`), never guessed. */
export function mapSportsDbStatus(raw: unknown, postponed?: unknown): FbStatus {
  if (typeof postponed === 'string' && postponed.toLowerCase() === 'yes') return 'postponed'
  const s = str(raw)
  if (!s) return 'unknown'
  return TSDB_STATUS[s.toUpperCase()] ?? 'unknown'
}

function sdTeam(id: unknown, name: unknown, badge: unknown): FbTeam | null {
  const n = str(name)
  const i = str(id)
  if (!n || !i) return null
  const b = str(badge)
  return { id: `thesportsdb:${i}`, name: n, short: null, badge: b }
}

/** A live-score row, or a past/next event row: they share most field names. */
export function normalizeSportsDbMatch(raw: unknown): FbMatch | null {
  const e = rec(raw)
  if (!e) return null
  const id = str(e.idEvent)
  const home = sdTeam(e.idHomeTeam, e.strHomeTeam, e.strHomeTeamBadge)
  const away = sdTeam(e.idAwayTeam, e.strAwayTeam, e.strAwayTeamBadge)
  if (!id || !home || !away) return null
  const status = mapSportsDbStatus(e.strStatus, e.strPostponed)
  const live = LIVE.has(status)
  const minute = live ? num(String(e.strProgress ?? '').replace(/\+.*$/, '')) : null
  const h = num(e.intHomeScore)
  const a = num(e.intAwayScore)
  const kickoff = utcIso(e.strTimestamp) ?? (str(e.dateEvent) && str(e.strTime) ? utcIso(`${str(e.dateEvent)}T${str(e.strTime)}`) : null)
  const season = str(e.strSeason)
  return {
    key: `thesportsdb:${id}`,
    provider: 'thesportsdb',
    competition: { id: `thesportsdb:${str(e.idLeague) ?? '?'}`, name: str(e.strLeague) ?? 'Competition', season },
    round: num(e.intRound) === null ? null : `Round ${num(e.intRound)}`,
    kickoff,
    home,
    away,
    status,
    statusRaw: str(e.strStatus),
    liveBasis: live ? 'reported' : null,
    minute,
    score: { home: h, away: a },
    halfTime: null,
    events: [],
    // The free endpoints carry the score and status but no goal list, so "no events" would be a false statement.
    eventsAvailable: false,
    venue: str(e.strVenue),
    sourceUpdatedAt: utcIso(e.updated)
  }
}
const LIVE = new Set<FbStatus>(['first-half', 'half-time', 'second-half', 'extra-time', 'penalties', 'in-play'])

export const normalizeSportsDbMatches = (payload: unknown, key: 'livescore' | 'events'): FbMatch[] =>
  arr(rec(payload)?.[key])
    .map(normalizeSportsDbMatch)
    .filter((m): m is FbMatch => m !== null)

export function normalizeSportsDbTable(payload: unknown): FbStandingRow[] {
  const out: FbStandingRow[] = []
  for (const r of arr(rec(payload)?.table)) {
    const t = rec(r)
    if (!t) continue
    const team = sdTeam(t.idTeam, t.strTeam, t.strBadge)
    const p = num(t.intPlayed)
    const w = num(t.intWin)
    const d = num(t.intDraw)
    const l = num(t.intLoss)
    const gf = num(t.intGoalsFor)
    const ga = num(t.intGoalsAgainst)
    const pts = num(t.intPoints)
    if (!team || p === null || w === null || d === null || l === null || gf === null || ga === null || pts === null) continue
    out.push({
      position: num(t.intRank),
      team,
      played: p,
      won: w,
      drawn: d,
      lost: l,
      goalsFor: gf,
      goalsAgainst: ga,
      goalDifference: num(t.intGoalDifference) ?? gf - ga,
      points: pts,
      form: str(t.strForm),
      note: str(t.strDescription)
    })
  }
  return out.sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
}
