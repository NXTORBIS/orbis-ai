/**
 * Orbis Arena -> Football: statements, replay steps, a position-based lineup arrangement and a calendar, all computed
 * from records already on screen. Every statement says what it is based on; nothing is inferred beyond the records.
 */
import { clockLabel, teamResults } from './logic.ts'
import type { FbMatch } from './types.ts'
import type { FbLineupPlayer } from './extras.ts'

const done = (m: FbMatch): m is FbMatch & { score: { home: number; away: number } } => m.status === 'finished' && m.score.home !== null && m.score.away !== null

// ---- a match in words -------------------------------------------------------------------------------------------------------

/**
 * A deterministic account of a match from its recorded score and goals. It names only what is recorded: no emotion,
 * no tactics, no "turning point". A match with no goal list gets the result alone.
 */
export function narrative(m: FbMatch, now = Date.now()): string {
  const h = m.home.name
  const a = m.away.name
  if (m.status === 'scheduled') return `${h} play ${a}${m.kickoff ? ` on ${new Date(m.kickoff).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ''}. It has not started.`
  if (m.status === 'postponed' || m.status === 'cancelled' || m.status === 'abandoned' || m.status === 'suspended') return `${h} v ${a} is ${m.status}.`
  if (m.score.home === null || m.score.away === null) return `${h} v ${a}: no score is recorded.`
  const state = m.status === 'finished' ? 'finished' : `is ${clockLabel(m, now).toLowerCase()}`
  const head = `${h} ${m.score.home}–${m.score.away} ${a} ${state === 'finished' ? '(full-time)' : `(${state})`}.`
  const goals = m.events.filter((e) => !e.revoked)
  if (!m.eventsAvailable) return `${head} This provider gives the score without a goal list.`
  if (goals.length === 0) return `${head}${m.score.home + m.score.away === 0 ? ' No goals.' : ' The goals are not listed.'}`
  const first = goals[0]
  const who = (e: (typeof goals)[number]): string => `${e.player ?? 'a player'}${e.kind === 'penalty-goal' ? ' (penalty)' : e.kind === 'own-goal' ? ' (own goal)' : ''}`
  const side = (e: (typeof goals)[number]): string => (e.side === 'home' ? h : e.side === 'away' ? a : 'a side')
  const parts = [`${side(first)} scored first${first.minute !== null ? ` in minute ${first.minute}` : ''}, through ${who(first)}.`]
  // Lead changes only when every goal says which side scored and what the score became.
  if (goals.every((e) => e.side !== null)) {
    let lead: 'home' | 'away' | null = null
    let changes = 0
    let hs = 0
    let as = 0
    for (const e of goals) {
      if (e.side === 'home') hs++
      else as++
      const now2 = hs > as ? 'home' : as > hs ? 'away' : null
      if (lead !== null && now2 !== null && now2 !== lead) changes++
      if (now2 !== null) lead = now2
    }
    if (changes > 0) parts.push(`The lead changed hands ${changes} time${changes === 1 ? '' : 's'}.`)
  }
  const late = goals.filter((e) => e.minute !== null && e.minute >= 85)
  if (late.length) parts.push(`${late.length} goal${late.length === 1 ? '' : 's'} came from minute 85 on.`)
  if (m.halfTime) parts.push(`Half-time: ${m.halfTime.home}–${m.halfTime.away}.`)
  const listed = goals.length
  if (listed < m.score.home + m.score.away) parts.push(`Only ${listed} of ${m.score.home + m.score.away} goals are listed.`)
  return `${head} ${parts.join(' ')}`
}

// ---- replay -----------------------------------------------------------------------------------------------------------------

export interface ReplayStep {
  index: number
  label: string
  minute: number | null
  score: { home: number; away: number }
  event: FbMatch['events'][number] | null
}

/**
 * The match as the recorded goals walk it: kick-off, then one step per goal with the score after it. The score is the
 * provider's `scoreAfter` when it gave one, otherwise counted from the sides. Returns [] when the goal list cannot
 * support a replay (no list, or a goal with neither a side nor a score).
 */
export function replaySteps(m: FbMatch): ReplayStep[] {
  if (!m.eventsAvailable) return []
  const goals = m.events.filter((e) => !e.revoked)
  if (goals.some((e) => e.side === null && e.scoreAfter === null)) return []
  const steps: ReplayStep[] = [{ index: 0, label: 'Kick-off', minute: 0, score: { home: 0, away: 0 }, event: null }]
  let hs = 0
  let as = 0
  for (const e of goals) {
    if (e.scoreAfter) {
      hs = e.scoreAfter.home
      as = e.scoreAfter.away
    } else if (e.side === 'home') hs++
    else as++
    steps.push({ index: steps.length, label: `${e.minute === null ? '?' : `${e.minute}′`} ${e.player ?? 'Goal'}${e.kind === 'penalty-goal' ? ' (pen.)' : e.kind === 'own-goal' ? ' (own goal)' : ''}`, minute: e.minute, score: { home: hs, away: as }, event: e })
  }
  return steps
}

// ---- statements about a season ----------------------------------------------------------------------------------------------

export interface Insight {
  text: string
  /** What it was counted from, so it can be checked. */
  basis: string
}

/**
 * Facts counted from a season's finished matches. A sample under five matches says nothing. These are descriptions of
 * what happened: no causes, no forecasts.
 */
export function seasonInsights(matches: FbMatch[]): Insight[] {
  const played = matches.filter(done)
  if (played.length < 5) return []
  const out: Insight[] = []
  const basis = `${played.length} finished matches`
  const most = [...played].sort((a, b) => b.score.home + b.score.away - (a.score.home + a.score.away) || Date.parse(b.kickoff ?? '') - Date.parse(a.kickoff ?? ''))[0]
  out.push({ text: `Highest-scoring match: ${most.home.name} ${most.score.home}–${most.score.away} ${most.away.name} (${most.score.home + most.score.away} goals).`, basis })
  const big = [...played].sort((a, b) => Math.abs(b.score.home - b.score.away) - Math.abs(a.score.home - a.score.away))[0]
  if (Math.abs(big.score.home - big.score.away) >= 3) out.push({ text: `Biggest margin: ${big.home.name} ${big.score.home}–${big.score.away} ${big.away.name}.`, basis })
  const teams = new Map<string, string>()
  for (const m of played) {
    teams.set(m.home.id, m.home.name)
    teams.set(m.away.id, m.away.name)
  }
  let unbeaten: { name: string; n: number } | null = null
  let wins: { name: string; n: number } | null = null
  for (const [id, name] of teams) {
    const r = teamResults(id, played) // newest first
    let u = 0
    for (const x of r) {
      if (x.result === 'L') break
      u++
    }
    let w = 0
    for (const x of r) {
      if (x.result !== 'W') break
      w++
    }
    if (u >= 4 && (!unbeaten || u > unbeaten.n)) unbeaten = { name, n: u }
    if (w >= 3 && (!wins || w > wins.n)) wins = { name, n: w }
  }
  const u2 = unbeaten as { name: string; n: number } | null
  const w2 = wins as { name: string; n: number } | null
  if (u2) out.push({ text: `${u2.name} are unbeaten in their last ${u2.n} matches.`, basis: `their results in ${basis}` })
  if (w2) out.push({ text: `${w2.name} have won their last ${w2.n} matches.`, basis: `their results in ${basis}` })
  const homeWins = played.filter((m) => m.score.home > m.score.away).length
  out.push({ text: `Home sides won ${homeWins} of ${played.length} matches (${Math.round((homeWins / played.length) * 100)}%).`, basis })
  return out
}

// ---- trend ------------------------------------------------------------------------------------------------------------------

/** Points per match over a rolling window, oldest first. A window needs its full length: earlier points are not drawn. */
export function rollingPoints(entries: { result: 'W' | 'D' | 'L' }[], window: number): { n: number; ppm: number }[] {
  const pts = entries.map((e) => (e.result === 'W' ? 3 : e.result === 'D' ? 1 : 0))
  const out: { n: number; ppm: number }[] = []
  for (let i = window - 1; i < pts.length; i++) {
    let s = 0
    for (let k = i - window + 1; k <= i; k++) s += pts[k]
    out.push({ n: i + 1, ppm: s / window })
  }
  return out
}

// ---- a lineup on a pitch ----------------------------------------------------------------------------------------------------

export interface PlacedPlayer {
  player: FbLineupPlayer
  /** 0-100 across the pitch (own goal at 0, the other end at 100) and 0-100 up the pitch width. */
  x: number
  y: number
}

const ROLE: { re: RegExp; x: number; y: number }[] = [
  { re: /goalkeeper|keeper/i, x: 6, y: 50 },
  { re: /left.?back|left wing.?back/i, x: 24, y: 14 },
  { re: /right.?back|right wing.?back/i, x: 24, y: 86 },
  { re: /centre.?back|center.?back|sweeper/i, x: 22, y: 50 },
  { re: /defensive mid/i, x: 38, y: 50 },
  { re: /left mid|left wing(?!.?back)|left winger/i, x: 58, y: 14 },
  { re: /right mid|right wing(?!.?back)|right winger/i, x: 58, y: 86 },
  { re: /attacking mid/i, x: 68, y: 50 },
  { re: /central mid|centre mid|center mid|midfield/i, x: 50, y: 50 },
  { re: /second striker|secondary striker/i, x: 76, y: 50 },
  { re: /centre.?forward|center.?forward|striker|forward/i, x: 86, y: 50 }
]

/**
 * Where to draw returned players, from their position *names* only. This is a display arrangement, not where anyone
 * stood: the feed gives no coordinates and no formation. Players sharing a role are spread across the width so none
 * hide another. Players with no readable role are not drawn (the list beside the pitch still names them).
 */
export function arrangeLineup(players: FbLineupPlayer[], side: 'home' | 'away'): { placed: PlacedPlayer[]; unplaced: FbLineupPlayer[] } {
  const starters = players.filter((p) => !p.substitute && p.side === side)
  const groups = new Map<string, { role: (typeof ROLE)[number]; list: FbLineupPlayer[] }>()
  const unplaced: FbLineupPlayer[] = []
  for (const p of starters) {
    const role = ROLE.find((r) => r.re.test(p.position ?? ''))
    if (!role) {
      unplaced.push(p)
      continue
    }
    const k = `${role.x}-${role.y}`
    const g = groups.get(k) ?? { role, list: [] }
    g.list.push(p)
    groups.set(k, g)
  }
  const placed: PlacedPlayer[] = []
  for (const g of groups.values()) {
    const n = g.list.length
    g.list.forEach((p, i) => {
      // Several players in one role fan out across the width around the role's own line.
      const y = n === 1 ? g.role.y : 18 + (64 * (i + 0.5)) / n
      placed.push({ player: p, x: side === 'home' ? g.role.x : 100 - g.role.x, y })
    })
  }
  return { placed, unplaced }
}

// ---- a calendar -------------------------------------------------------------------------------------------------------------

/** Matches grouped by their local calendar day (the day a person sees, not the provider's UTC day). */
export function byLocalDay(matches: FbMatch[], timeZone?: string): Map<string, FbMatch[]> {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const out = new Map<string, FbMatch[]>()
  for (const m of matches) {
    if (!m.kickoff || Number.isNaN(Date.parse(m.kickoff))) continue
    const day = fmt.format(new Date(m.kickoff))
    out.set(day, [...(out.get(day) ?? []), m])
  }
  for (const [k, v] of out) out.set(k, v.sort((a, b) => Date.parse(a.kickoff as string) - Date.parse(b.kickoff as string)))
  return out
}
