import { isLive, type FbEvent, type FbFreshness, type FbMatch, type FbStandingRow, type FbStatus } from './types.ts'

// ---- status ----------------------------------------------------------------------------------------------------------------

const RANK: Record<FbStatus, number> = {
  scheduled: 0,
  'first-half': 1,
  'in-play': 1,
  'half-time': 2,
  'second-half': 3,
  'extra-time': 4,
  penalties: 5,
  finished: 6,
  postponed: -1,
  suspended: -1,
  abandoned: -1,
  cancelled: -1,
  unknown: -2
}

/**
 * Whether a newer-looking record may replace the one held. A match does not un-finish and does not go back a period
 * because a slow response arrived late. A provider's own correction (a later `sourceUpdatedAt`) is the exception.
 */
export function acceptStatus(prev: FbMatch | null, next: FbMatch): { accept: boolean; reason: string } {
  if (!prev) return { accept: true, reason: 'first sight' }
  if (next.status === 'unknown') return { accept: false, reason: 'the provider status was not understood; the last known one is kept' }
  const newer = next.sourceUpdatedAt !== null && prev.sourceUpdatedAt !== null && Date.parse(next.sourceUpdatedAt) > Date.parse(prev.sourceUpdatedAt)
  if (prev.status === 'finished' && next.status !== 'finished') return newer ? { accept: true, reason: 'provider correction' } : { accept: false, reason: 'a finished match is not reopened by an older answer' }
  const a = RANK[prev.status]
  const b = RANK[next.status]
  if (a >= 0 && b >= 0 && b < a) return newer ? { accept: true, reason: 'provider correction' } : { accept: false, reason: 'a stale answer would move the match back a period' }
  return { accept: true, reason: 'forward or equal' }
}

/** The words for where a match is. A minute appears only when the provider reported one. */
export function clockLabel(m: FbMatch, now: number, timeZone?: string | null): string {
  switch (m.status) {
    case 'scheduled':
      return m.kickoff ? new Date(m.kickoff).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: timeZone ?? undefined }) : 'Kickoff not set'
    case 'half-time':
      return 'Half-time'
    case 'finished':
      return 'Full-time'
    case 'penalties':
      return 'Penalty shoot-out'
    case 'postponed':
      return 'Postponed'
    case 'suspended':
      return 'Suspended'
    case 'abandoned':
      return 'Abandoned'
    case 'cancelled':
      return 'Cancelled'
    case 'unknown':
      return m.kickoff && Date.parse(m.kickoff) < now ? 'Result not recorded yet' : 'Status unknown'
    default: {
      if (m.minute !== null) return `${m.minute}′`
      if (m.liveBasis === 'inferred' && m.kickoff) return `Probably under way · kicked off ${Math.max(0, Math.round((now - Date.parse(m.kickoff)) / 60_000))} min ago`
      return isLive(m.status) ? 'In play' : '–'
    }
  }
}

// ---- events and score ------------------------------------------------------------------------------------------------------

const fingerprint = (e: FbEvent): string => `${e.kind}|${e.minute ?? '?'}|${e.side ?? '?'}|${e.player ?? '?'}|${e.scoreAfter ? `${e.scoreAfter.home}-${e.scoreAfter.away}` : '?'}`

/** One entry per goal: by id when the provider gives one, otherwise by a conservative fingerprint. Order is by minute, then arrival. */
export function normalizeEvents(events: FbEvent[]): FbEvent[] {
  const seen = new Set<string>()
  const out: FbEvent[] = []
  for (const e of events) {
    const k = e.id || fingerprint(e)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.minute ?? 999) - (b.e.minute ?? 999) || a.i - b.i)
    .map((x) => x.e)
}

export interface ScoreCheck {
  /** `agrees`: events add up to the reported score. `incomplete`: fewer goals listed than scored. `conflict`: more, or the wrong side. */
  state: 'agrees' | 'incomplete' | 'conflict' | 'not-applicable'
  detail: string
}

/** Compares the reported score with the goals listed. The reported score stays the one shown; this only says whether the list backs it up. */
export function reconcileScore(m: FbMatch): ScoreCheck {
  if (!m.eventsAvailable) return { state: 'not-applicable', detail: 'This provider gives the score without a goal list.' }
  if (m.score.home === null || m.score.away === null) return { state: 'not-applicable', detail: 'No score yet.' }
  const counted = { home: 0, away: 0 }
  for (const e of m.events) {
    if (e.revoked || e.side === null) continue
    counted[e.side] += 1
  }
  const unplaced = m.events.filter((e) => !e.revoked && e.side === null).length
  const listed = counted.home + counted.away + unplaced
  const total = m.score.home + m.score.away
  if (listed === total && counted.home === m.score.home && counted.away === m.score.away) return { state: 'agrees', detail: 'The goals listed add up to the score.' }
  if (listed < total) return { state: 'incomplete', detail: `${listed} of ${total} goals are listed; the score is the provider’s reported one.` }
  if (listed === total) return { state: 'conflict', detail: `${listed} goals are listed, but not by the sides the score gives (${counted.home}–${counted.away} listed against ${m.score.home}–${m.score.away}).` }
  return { state: 'conflict', detail: `${listed} goals are listed but the score adds up to ${total}.` }
}

export type FbChange =
  | { kind: 'kickoff'; match: FbMatch }
  | { kind: 'goal'; match: FbMatch; event: FbEvent | null; score: { home: number; away: number } }
  | { kind: 'goal-withdrawn'; match: FbMatch; event: FbEvent }
  | { kind: 'half-time'; match: FbMatch }
  | { kind: 'full-time'; match: FbMatch }
  | { kind: 'status'; match: FbMatch; from: FbStatus }
  | { kind: 'score-correction'; match: FbMatch; from: { home: number; away: number } }

/**
 * What truly changed between two accepted records of one match. A first sight is not a change (opening the window on a
 * match that is 2-1 must not play a goal), and the same goal seen again is not a new one.
 */
export function diffMatch(prev: FbMatch | null, next: FbMatch): FbChange[] {
  if (!prev) return []
  const out: FbChange[] = []
  if (prev.status !== next.status) {
    if (prev.status === 'scheduled' && isLive(next.status)) out.push({ kind: 'kickoff', match: next })
    else if (next.status === 'half-time') out.push({ kind: 'half-time', match: next })
    else if (next.status === 'finished') out.push({ kind: 'full-time', match: next })
    else out.push({ kind: 'status', match: next, from: prev.status })
  }
  const prevIds = new Set(prev.events.map((e) => e.id))
  const prevScore = prev.score
  const hp = prevScore.home ?? 0
  const ap = prevScore.away ?? 0
  const hn = next.score.home ?? 0
  const an = next.score.away ?? 0
  if (hn + an > hp + ap) {
    const fresh = next.events.filter((e) => !prevIds.has(e.id) && !e.revoked)
    if (fresh.length) for (const e of fresh) out.push({ kind: 'goal', match: next, event: e, score: e.scoreAfter ?? { home: hn, away: an } })
    else out.push({ kind: 'goal', match: next, event: null, score: { home: hn, away: an } })
  } else if (hn !== hp || an !== ap) {
    // The score went down or changed shape: a correction, never a celebration.
    out.push({ kind: 'score-correction', match: next, from: { home: hp, away: ap } })
  }
  for (const e of next.events) if (e.revoked && prev.events.some((p) => p.id === e.id && !p.revoked)) out.push({ kind: 'goal-withdrawn', match: next, event: e })
  return out
}

// ---- freshness -------------------------------------------------------------------------------------------------------------

export type FbFreshnessLabel = 'live' | 'delayed' | 'stale' | 'cached' | 'final' | 'unavailable'

/**
 * How current what is on screen is. Age is time since Orbis last *received* it; a recently downloaded answer can still
 * describe an old moment, so a provider-supplied update time is shown separately by the screen and never replaces this.
 */
export function freshnessLabel(opts: { freshness: FbFreshness; retrievedAt: string; now: number; match?: FbMatch | null; pollMs?: number }): FbFreshnessLabel {
  const age = opts.now - Date.parse(opts.retrievedAt)
  if (Number.isNaN(age)) return 'unavailable'
  if (opts.match && opts.match.status === 'finished') return opts.freshness === 'stale' ? 'stale' : 'final'
  if (opts.freshness === 'stale') return 'stale'
  const poll = opts.pollMs ?? 30_000
  if (opts.match && isLive(opts.match.status)) return age <= poll * 3 ? 'live' : age <= poll * 10 ? 'delayed' : 'stale'
  return opts.freshness === 'cached' ? 'cached' : 'live'
}

// ---- tables and analysis ---------------------------------------------------------------------------------------------------

const done = (m: FbMatch): m is FbMatch & { score: { home: number; away: number } } => m.status === 'finished' && m.score.home !== null && m.score.away !== null

/**
 * A table from finished matches only. Order: points, goal difference, goals for, then name. Head-to-head and fair-play
 * tie-breaks are *not* applied (they differ by competition), so a locally built table is labelled as that.
 */
export function computeTable(matches: FbMatch[]): FbStandingRow[] {
  const rows = new Map<string, FbStandingRow>()
  const row = (t: FbMatch['home']): FbStandingRow => {
    let r = rows.get(t.id)
    if (!r) {
      r = { position: null, team: t, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, form: null, note: null }
      rows.set(t.id, r)
    }
    return r
  }
  const seen = new Set<string>()
  for (const m of matches) {
    if (!done(m) || seen.has(m.key)) continue
    seen.add(m.key)
    const h = row(m.home)
    const a = row(m.away)
    h.played++
    a.played++
    h.goalsFor += m.score.home
    h.goalsAgainst += m.score.away
    a.goalsFor += m.score.away
    a.goalsAgainst += m.score.home
    if (m.score.home > m.score.away) {
      h.won++
      a.lost++
      h.points += 3
    } else if (m.score.home < m.score.away) {
      a.won++
      h.lost++
      a.points += 3
    } else {
      h.drawn++
      a.drawn++
      h.points++
      a.points++
    }
  }
  const out = [...rows.values()]
  for (const r of out) r.goalDifference = r.goalsFor - r.goalsAgainst
  out.sort((x, y) => y.points - x.points || y.goalDifference - x.goalDifference || y.goalsFor - x.goalsFor || x.team.name.localeCompare(y.team.name))
  out.forEach((r, i) => (r.position = i + 1))
  return out
}

export interface FormEntry {
  match: FbMatch
  result: 'W' | 'D' | 'L'
  venue: 'home' | 'away'
  for: number
  against: number
}

/** A team's completed matches, newest first. Postponed, abandoned and unfinished matches are not results. */
export function teamResults(teamId: string, matches: FbMatch[]): FormEntry[] {
  const out: FormEntry[] = []
  const seen = new Set<string>()
  for (const m of matches) {
    if (!done(m) || seen.has(m.key)) continue
    const home = m.home.id === teamId
    const away = m.away.id === teamId
    if (!home && !away) continue
    seen.add(m.key)
    const f = home ? m.score.home : m.score.away
    const a = home ? m.score.away : m.score.home
    out.push({ match: m, result: f > a ? 'W' : f < a ? 'L' : 'D', venue: home ? 'home' : 'away', for: f, against: a })
  }
  return out.sort((x, y) => Date.parse(y.match.kickoff ?? '') - Date.parse(x.match.kickoff ?? ''))
}

export interface Split {
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  points: number
  /** Per-match rates; `null` when nothing was played (not 0). */
  pointsPerMatch: number | null
  goalsForPerMatch: number | null
  goalsAgainstPerMatch: number | null
  cleanSheets: number
}

export function split(entries: FormEntry[]): Split {
  const s = { played: entries.length, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, cleanSheets: 0 }
  for (const e of entries) {
    s.goalsFor += e.for
    s.goalsAgainst += e.against
    if (e.against === 0) s.cleanSheets++
    if (e.result === 'W') {
      s.won++
      s.points += 3
    } else if (e.result === 'D') {
      s.drawn++
      s.points += 1
    } else s.lost++
  }
  const n = s.played
  return { ...s, pointsPerMatch: n ? s.points / n : null, goalsForPerMatch: n ? s.goalsFor / n : null, goalsAgainstPerMatch: n ? s.goalsAgainst / n : null }
}

export interface HeadToHead {
  meetings: FbMatch[]
  aWins: number
  bWins: number
  draws: number
  aGoals: number
  bGoals: number
}

/** Past meetings of two team ids *as the provider names them*. Two providers' ids are never treated as one team. */
export function headToHead(a: string, b: string, matches: FbMatch[]): HeadToHead {
  const meetings = matches.filter((m) => done(m) && ((m.home.id === a && m.away.id === b) || (m.home.id === b && m.away.id === a)))
  const uniq = [...new Map(meetings.map((m) => [m.key, m])).values()].sort((x, y) => Date.parse(y.kickoff ?? '') - Date.parse(x.kickoff ?? ''))
  const r: HeadToHead = { meetings: uniq, aWins: 0, bWins: 0, draws: 0, aGoals: 0, bGoals: 0 }
  for (const m of uniq) {
    const ah = m.home.id === a
    const af = (ah ? m.score.home : m.score.away) as number
    const bf = (ah ? m.score.away : m.score.home) as number
    r.aGoals += af
    r.bGoals += bf
    if (af > bf) r.aWins++
    else if (af < bf) r.bWins++
    else r.draws++
  }
  return r
}

export interface GoalTiming {
  buckets: { label: string; from: number; to: number; goals: number }[]
  /** Goals with no minute recorded, left out of the buckets. */
  unplaced: number
  matches: number
  matchesWithEvents: number
}

/** Goals by minute band from the provider's own minutes. Goals after 90 are "90+" (added time and extra time are not told apart). */
export function goalTiming(matches: FbMatch[]): GoalTiming {
  const edges = [0, 15, 30, 45, 60, 75, 90]
  const buckets = edges.map((from, i) => ({ label: i === edges.length - 1 ? '90+' : `${from + (i === 0 ? 0 : 1)}–${edges[i + 1]}`, from, to: i === edges.length - 1 ? Infinity : edges[i + 1], goals: 0 }))
  let unplaced = 0
  let withEvents = 0
  let n = 0
  for (const m of matches) {
    if (!done(m) || !m.eventsAvailable) continue
    n++
    if (m.events.length) withEvents++
    for (const e of m.events) {
      if (e.revoked) continue
      if (e.minute === null) {
        unplaced++
        continue
      }
      const b = e.minute > 90 ? buckets[buckets.length - 1] : buckets.find((x) => e.minute! > x.from && e.minute! <= x.to) ?? buckets[0]
      b.goals++
    }
  }
  return { buckets, unplaced, matches: n, matchesWithEvents: withEvents }
}

export interface Distribution {
  matches: number
  homeWins: number
  draws: number
  awayWins: number
  goals: number
  goalsPerMatch: number | null
  scorelines: { score: string; count: number }[]
}

export function resultDistribution(matches: FbMatch[]): Distribution {
  const d = { matches: 0, homeWins: 0, draws: 0, awayWins: 0, goals: 0 }
  const lines = new Map<string, number>()
  const seen = new Set<string>()
  for (const m of matches) {
    if (!done(m) || seen.has(m.key)) continue
    seen.add(m.key)
    d.matches++
    d.goals += m.score.home + m.score.away
    if (m.score.home > m.score.away) d.homeWins++
    else if (m.score.home < m.score.away) d.awayWins++
    else d.draws++
    const k = `${m.score.home}–${m.score.away}`
    lines.set(k, (lines.get(k) ?? 0) + 1)
  }
  return { ...d, goalsPerMatch: d.matches ? d.goals / d.matches : null, scorelines: [...lines].map(([score, count]) => ({ score, count })).sort((a, b) => b.count - a.count).slice(0, 8) }
}

export interface Scorer {
  player: string
  team: string
  goals: number
  penalties: number
}

/** Goals by player from goal events (own goals are not credited to the scorer). Only matches that list events count. */
export function topScorers(matches: FbMatch[]): { scorers: Scorer[]; matchesCounted: number } {
  const map = new Map<string, Scorer>()
  let counted = 0
  for (const m of matches) {
    if (!m.eventsAvailable) continue
    counted++
    for (const e of m.events) {
      if (e.revoked || e.kind === 'own-goal' || !e.player) continue
      const team = e.side === 'home' ? m.home.name : e.side === 'away' ? m.away.name : '?'
      const k = `${e.player}|${team}`
      const s = map.get(k) ?? { player: e.player, team, goals: 0, penalties: 0 }
      s.goals++
      if (e.kind === 'penalty-goal') s.penalties++
      map.set(k, s)
    }
  }
  return { scorers: [...map.values()].sort((a, b) => b.goals - a.goals || a.player.localeCompare(b.player)), matchesCounted: counted }
}

// ---- an experimental outcome model -----------------------------------------------------------------------------------------

export interface Outcome {
  home: number
  draw: number
  away: number
}

const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1))
const pois = (k: number, l: number): number => (Math.exp(-l) * l ** k) / fact(k)

/**
 * Independent-Poisson goals from attack/defence strengths fitted on *earlier* matches only. Returns null until every
 * team has played enough (`minPlayed`), so a probability is never made up from nothing.
 */
export function poissonOutcome(history: FbMatch[], home: string, away: string, minPlayed = 3): Outcome | null {
  const played = history.filter(done)
  if (played.length < 10) return null
  const n = played.length
  const avgHome = played.reduce((s, m) => s + m.score.home, 0) / n
  const avgAway = played.reduce((s, m) => s + m.score.away, 0) / n
  const stat = (id: string): { gf: number; ga: number; n: number } => {
    const t = { gf: 0, ga: 0, n: 0 }
    for (const m of played) {
      if (m.home.id === id) {
        t.gf += m.score.home
        t.ga += m.score.away
        t.n++
      } else if (m.away.id === id) {
        t.gf += m.score.away
        t.ga += m.score.home
        t.n++
      }
    }
    return t
  }
  const h = stat(home)
  const a = stat(away)
  if (h.n < minPlayed || a.n < minPlayed) return null
  const avg = (avgHome + avgAway) / 2
  if (avg <= 0) return null
  const lh = Math.max(0.05, (h.gf / h.n / avg) * (a.ga / a.n / avg) * avgHome)
  const la = Math.max(0.05, (a.gf / a.n / avg) * (h.ga / h.n / avg) * avgAway)
  let ph = 0
  let pd = 0
  let pa = 0
  for (let i = 0; i <= 10; i++)
    for (let j = 0; j <= 10; j++) {
      const p = pois(i, lh) * pois(j, la)
      if (i > j) ph += p
      else if (i === j) pd += p
      else pa += p
    }
  const s = ph + pd + pa
  return { home: ph / s, draw: pd / s, away: pa / s }
}

export interface ModelEvaluation {
  evaluated: number
  modelBrier: number
  baselineBrier: number
  /** Whether the model scored better (lower) than "always predict the historical home/draw/away rates". */
  beatsBaseline: boolean
}

/**
 * Walk-forward evaluation: each finished match is predicted using only matches kicked off before it, and the
 * three-outcome Brier score is compared with the historical-frequency baseline. Returns null with too little data.
 */
export function evaluateModel(matches: FbMatch[]): ModelEvaluation | null {
  const played = matches.filter(done).filter((m) => m.kickoff).sort((a, b) => Date.parse(a.kickoff!) - Date.parse(b.kickoff!))
  let n = 0
  let mb = 0
  let bb = 0
  for (let i = 0; i < played.length; i++) {
    const prior = played.slice(0, i)
    if (prior.length < 30) continue
    const m = played[i]
    const p = poissonOutcome(prior, m.home.id, m.away.id)
    if (!p) continue
    const hw = prior.filter((x) => x.score.home! > x.score.away!).length / prior.length
    const dr = prior.filter((x) => x.score.home === x.score.away).length / prior.length
    const base: Outcome = { home: hw, draw: dr, away: 1 - hw - dr }
    const actual: Outcome = { home: m.score.home! > m.score.away! ? 1 : 0, draw: m.score.home === m.score.away ? 1 : 0, away: m.score.home! < m.score.away! ? 1 : 0 }
    const br = (q: Outcome): number => (q.home - actual.home) ** 2 + (q.draw - actual.draw) ** 2 + (q.away - actual.away) ** 2
    mb += br(p)
    bb += br(base)
    n++
  }
  if (n < 20) return null
  return { evaluated: n, modelBrier: mb / n, baselineBrier: bb / n, beatsBaseline: mb < bb }
}
