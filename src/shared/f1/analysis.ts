/**
 * Orbis Arena -> F1: the analysis the intelligence screens share. Pure functions over rows the providers already gave:
 * form, consistency, percentiles, constructor contribution and comparison, championship lead, all-time champions, a
 * data-coverage registry, a stint projection with its uncertainty, and a plan sensitivity table.
 *
 * Rules that run through it: a metric is `null` (not 0) when its sample is too small to mean anything; a percentile is
 * only given within a population that is big enough; a projection always carries the spread of the laps it came from.
 */
import { evaluatePlan, linearTrend, type PlanAssumptions, type PlanStint } from './strategy.ts'
import type { SeasonRow } from './season.ts'

const mean = (v: number[]): number | null => (v.length ? v.reduce((t, x) => t + x, 0) / v.length : null)
const median = (v: number[]): number | null => {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const stdev = (v: number[]): number | null => {
  if (v.length < 3) return null
  const m = mean(v) as number
  return Math.sqrt(v.reduce((t, x) => t + (x - m) ** 2, 0) / (v.length - 1))
}

const gp = (rows: SeasonRow[]): SeasonRow[] => rows.filter((r) => !r.sprint)

// ---- a driver ---------------------------------------------------------------------------------------------------------------

export interface FormEntry {
  round: number
  raceName: string
  positionText: string
  position: number | null
  classified: boolean
  grid: number | null
}

/** The last `n` Grand Prix of a driver, newest first. A retirement stays in the list as what it was. */
export function driverForm(rows: SeasonRow[], driverId: string, n = 5): FormEntry[] {
  return gp(rows)
    .filter((r) => r.driverId === driverId)
    .sort((a, b) => b.round - a.round)
    .slice(0, n)
    .map((r) => ({ round: r.round, raceName: r.raceName, positionText: r.positionText, position: r.position, classified: r.classified, grid: r.grid }))
}

export interface Consistency {
  n: number
  mean: number | null
  median: number | null
  stdev: number | null
  best: number | null
  worst: number | null
  /** Mean of (grid − finish) over classified races that started from a real grid slot; positive = places gained. */
  avgGain: number | null
  bestGain: { raceName: string; places: number } | null
  worstLoss: { raceName: string; places: number } | null
}

/** How steady a driver's finishes were. Only classified finishes count; a pit-lane start (grid 0) has no gain. */
export function driverConsistency(rows: SeasonRow[], driverId: string): Consistency {
  const mine = gp(rows).filter((r) => r.driverId === driverId && r.classified && r.position !== null)
  const finishes = mine.map((r) => r.position as number)
  const gains = mine.filter((r) => r.grid !== null && r.grid > 0).map((r) => ({ raceName: r.raceName, places: (r.grid as number) - (r.position as number) }))
  const best = gains.reduce<{ raceName: string; places: number } | null>((b, g) => (b === null || g.places > b.places ? g : b), null)
  const worst = gains.reduce<{ raceName: string; places: number } | null>((b, g) => (b === null || g.places < b.places ? g : b), null)
  return {
    n: finishes.length,
    mean: mean(finishes),
    median: median(finishes),
    stdev: stdev(finishes),
    best: finishes.length ? Math.min(...finishes) : null,
    worst: finishes.length ? Math.max(...finishes) : null,
    avgGain: mean(gains.map((g) => g.places)),
    bestGain: best && best.places > 0 ? best : null,
    worstLoss: worst && worst.places < 0 ? worst : null
  }
}

export interface PercentileRow {
  driverId: string
  name: string
  entries: number
  /** 0-100, higher is better. Null when the driver has too few entries to be placed. */
  finish: number | null
  points: number | null
  grid: number | null
}

/**
 * Where each driver stands among the season's drivers, by average finish, points per race and average grid. A driver
 * needs `minEntries` Grands Prix to be placed, and the population itself must have at least five such drivers.
 */
export function seasonPercentiles(rows: SeasonRow[], minEntries = 3): PercentileRow[] {
  const by = new Map<string, SeasonRow[]>()
  for (const r of rows) by.set(r.driverId, [...(by.get(r.driverId) ?? []), r])
  const stats = [...by].map(([id, rs]) => {
    const g = gp(rs)
    const fin = g.filter((r) => r.classified && r.position !== null).map((r) => r.position as number)
    const grid = g.map((r) => r.grid).filter((x): x is number => x !== null && x > 0)
    return { id, name: rs[0].driverName, entries: g.length, avgFinish: mean(fin), ppr: g.length ? rs.reduce((t, r) => t + r.points, 0) / g.length : null, avgGrid: mean(grid), nFin: fin.length, nGrid: grid.length }
  })
  const ok = stats.filter((s) => s.entries >= minEntries)
  const place = (values: { id: string; v: number }[], id: string, higherBetter: boolean): number | null => {
    if (values.length < 5) return null
    const me = values.find((x) => x.id === id)
    if (!me) return null
    let below = 0
    for (const o of values) if (o.id !== id) below += higherBetter ? (o.v < me.v ? 1 : o.v === me.v ? 0.5 : 0) : o.v > me.v ? 1 : o.v === me.v ? 0.5 : 0
    return Math.round((below / (values.length - 1)) * 100)
  }
  const fin = ok.filter((s) => s.avgFinish !== null && s.nFin >= minEntries).map((s) => ({ id: s.id, v: s.avgFinish as number }))
  const ppr = ok.filter((s) => s.ppr !== null).map((s) => ({ id: s.id, v: s.ppr as number }))
  const grd = ok.filter((s) => s.avgGrid !== null && s.nGrid >= minEntries).map((s) => ({ id: s.id, v: s.avgGrid as number }))
  return stats.map((s) => ({
    driverId: s.id,
    name: s.name,
    entries: s.entries,
    finish: place(fin, s.id, false),
    points: place(ppr, s.id, true),
    grid: place(grd, s.id, false)
  }))
}

// ---- a constructor ----------------------------------------------------------------------------------------------------------

export interface Contribution {
  driverId: string
  name: string
  points: number
  /** Share of the team's points, 0-1; null when the team has scored nothing. */
  share: number | null
  entries: number
}

export function constructorContribution(rows: SeasonRow[], constructorId: string): { total: number; drivers: Contribution[] } {
  const mine = rows.filter((r) => r.constructorId === constructorId)
  const total = mine.reduce((t, r) => t + r.points, 0)
  const by = new Map<string, Contribution>()
  for (const r of mine) {
    const c = by.get(r.driverId) ?? { driverId: r.driverId, name: r.driverName, points: 0, share: null, entries: 0 }
    c.points += r.points
    if (!r.sprint) c.entries += 1
    by.set(r.driverId, c)
  }
  const drivers = [...by.values()].map((c) => ({ ...c, share: total > 0 ? c.points / total : null })).sort((a, b) => b.points - a.points)
  return { total, drivers }
}

export interface ConstructorDuel {
  rounds: number
  aPoints: number
  bPoints: number
  /** Rounds where one team's best classified finish was better. Rounds with no classified finish for either side are not counted. */
  aAhead: number
  bAhead: number
  level: number
  avgGridA: number | null
  avgGridB: number | null
}

export function constructorDuel(rows: SeasonRow[], a: string, b: string): ConstructorDuel {
  const g = gp(rows)
  const best = (id: string, round: number): number | null => {
    const v = g.filter((r) => r.constructorId === id && r.round === round && r.classified && r.position !== null).map((r) => r.position as number)
    return v.length ? Math.min(...v) : null
  }
  const rounds = [...new Set(g.filter((r) => r.constructorId === a || r.constructorId === b).map((r) => r.round))].sort((x, y) => x - y)
  const d: ConstructorDuel = { rounds: rounds.length, aPoints: 0, bPoints: 0, aAhead: 0, bAhead: 0, level: 0, avgGridA: null, avgGridB: null }
  for (const r of rows) {
    if (r.constructorId === a) d.aPoints += r.points
    if (r.constructorId === b) d.bPoints += r.points
  }
  for (const round of rounds) {
    const x = best(a, round)
    const y = best(b, round)
    if (x === null || y === null) continue
    if (x < y) d.aAhead++
    else if (y < x) d.bAhead++
    else d.level++
  }
  const grid = (id: string): number | null => mean(g.filter((r) => r.constructorId === id && r.grid !== null && r.grid > 0).map((r) => r.grid as number))
  d.avgGridA = grid(a)
  d.avgGridB = grid(b)
  return d
}

// ---- the championship -------------------------------------------------------------------------------------------------------

/** Gap to the current leader after each round, for the given drivers (0 for the leader). Built from the progression's own totals. */
export function leadGaps(progress: Map<string, { name: string; points: { round: number; total: number }[] }>, ids: string[]): Map<string, { round: number; gap: number }[]> {
  const rounds = new Set<number>()
  for (const p of progress.values()) for (const x of p.points) rounds.add(x.round)
  const out = new Map<string, { round: number; gap: number }[]>()
  for (const id of ids) out.set(id, [])
  for (const round of [...rounds].sort((a, b) => a - b)) {
    let lead = 0
    for (const p of progress.values()) {
      const t = p.points.find((x) => x.round === round)?.total ?? 0
      if (t > lead) lead = t
    }
    for (const id of ids) {
      const t = progress.get(id)?.points.find((x) => x.round === round)?.total
      if (t !== undefined) out.get(id)?.push({ round, gap: lead - t })
    }
  }
  return out
}

/** Championship position after each round (1 = leader). Ties share the better position, which is what a points table shows. */
export function positionProgression(progress: Map<string, { name: string; points: { round: number; total: number }[] }>, ids: string[]): Map<string, { round: number; position: number }[]> {
  const rounds = new Set<number>()
  for (const p of progress.values()) for (const x of p.points) rounds.add(x.round)
  const out = new Map<string, { round: number; position: number }[]>()
  for (const id of ids) out.set(id, [])
  for (const round of [...rounds].sort((a, b) => a - b)) {
    const totals = [...progress].map(([id, p]) => ({ id, t: p.points.find((x) => x.round === round)?.total ?? 0 }))
    for (const id of ids) {
      const me = totals.find((x) => x.id === id)
      if (!me) continue
      out.get(id)?.push({ round, position: 1 + totals.filter((o) => o.t > me.t).length })
    }
  }
  return out
}

// ---- all-time champions -----------------------------------------------------------------------------------------------------

export interface ChampionRow {
  season: number
  /** Rounds in the season when the table was taken (the last one). */
  rounds: number
  name: string
  team: string | null
  points: number
  wins: number
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

/** Jolpica `driverStandings/{n}.json` or `constructorStandings/{n}.json` across every season -> one row per season. */
export function normalizeChampions(payload: unknown, kind: 'driver' | 'constructor'): ChampionRow[] {
  const lists = arr(obj(obj(obj(payload)?.MRData)?.StandingsTable)?.StandingsLists)
  const out: ChampionRow[] = []
  for (const l of lists) {
    const list = obj(l)
    const season = num(list?.season)
    const round = num(list?.round)
    const row = obj(arr(kind === 'driver' ? list?.DriverStandings : list?.ConstructorStandings)[0])
    if (!list || season === null || !row) continue
    let name = 'Unknown'
    let team: string | null = null
    if (kind === 'driver') {
      const d = obj(row.Driver) ?? {}
      name = `${typeof d.givenName === 'string' ? d.givenName : ''} ${typeof d.familyName === 'string' ? d.familyName : ''}`.trim() || 'Unknown'
      const c = obj(arr(row.Constructors)[0])
      team = typeof c?.name === 'string' ? c.name : null
    } else {
      const c = obj(row.Constructor)
      name = typeof c?.name === 'string' ? c.name : 'Unknown'
    }
    out.push({ season, rounds: round ?? 0, name, team, points: num(row.points) ?? 0, wins: num(row.wins) ?? 0 })
  }
  return out.sort((a, b) => b.season - a.season)
}

/** Titles per name, most first. */
export function titleCounts(rows: ChampionRow[]): { name: string; titles: number; seasons: number[] }[] {
  const m = new Map<string, number[]>()
  for (const r of rows) m.set(r.name, [...(m.get(r.name) ?? []), r.season])
  return [...m].map(([name, seasons]) => ({ name, titles: seasons.length, seasons: seasons.sort((a, b) => a - b) })).sort((a, b) => b.titles - a.titles || a.seasons[0] - b.seasons[0])
}

// ---- pit stops --------------------------------------------------------------------------------------------------------------

export interface TeamPitLine {
  team: string
  stops: number
  /** Median time in the pit lane (s). */
  median: number | null
  best: number | null
}

/** Pit-lane time by team. A stop with no measured pit-lane time is left out of the median, not counted as 0. */
export function pitStopsByTeam(stops: { driverNumber: number; laneDuration: number | null }[], teamOf: (driverNumber: number) => string | null): TeamPitLine[] {
  const by = new Map<string, number[]>()
  const count = new Map<string, number>()
  for (const s of stops) {
    const team = teamOf(s.driverNumber) ?? 'Unknown team'
    count.set(team, (count.get(team) ?? 0) + 1)
    if (s.laneDuration !== null) by.set(team, [...(by.get(team) ?? []), s.laneDuration])
  }
  return [...count].map(([team, n]) => ({ team, stops: n, median: median(by.get(team) ?? []), best: (by.get(team) ?? []).length ? Math.min(...(by.get(team) as number[])) : null })).sort((a, b) => (a.median ?? 999) - (b.median ?? 999))
}

/**
 * Stops that are far slower than the rest (beyond the upper quartile by 1.5 interquartile ranges). Needs at least
 * eight measured stops. A flag is not a verdict: a drive-through, a red flag or a stop for a repair looks the same.
 */
export function slowStops(stops: { driverNumber: number; lap: number; laneDuration: number | null }[]): { driverNumber: number; lap: number; laneDuration: number }[] {
  const v = stops.filter((s): s is { driverNumber: number; lap: number; laneDuration: number } => s.laneDuration !== null)
  if (v.length < 8) return []
  const s = v.map((x) => x.laneDuration).sort((a, b) => a - b)
  const q = (p: number): number => {
    const i = (s.length - 1) * p
    const lo = Math.floor(i)
    return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo)
  }
  const fence = q(0.75) + 1.5 * (q(0.75) - q(0.25))
  return v.filter((x) => x.laneDuration > fence).sort((a, b) => b.laneDuration - a.laneDuration)
}

// ---- what data exists for which era -----------------------------------------------------------------------------------------

export interface CoverageItem {
  what: string
  from: number
  to: number | null
  source: string
  note: string
}

/** Where each kind of data begins. These are the provider's own start years, checked against its API, not a promise of completeness. */
export const COVERAGE: readonly CoverageItem[] = [
  { what: 'Race results and driver standings', from: 1950, to: null, source: 'Jolpica-F1', note: 'Every season of the championship.' },
  { what: 'Constructors’ standings', from: 1958, to: null, source: 'Jolpica-F1', note: 'The constructors’ title began in 1958.' },
  { what: 'Qualifying results', from: 1994, to: null, source: 'Jolpica-F1', note: 'Earlier qualifying is not in the provider’s data.' },
  { what: 'Lap times', from: 1996, to: null, source: 'Jolpica-F1', note: 'Per-lap times for the race, no sectors.' },
  { what: 'Fastest laps', from: 2004, to: null, source: 'Jolpica-F1', note: 'Used for circuit records.' },
  { what: 'Pit stops', from: 2011, to: null, source: 'Jolpica-F1', note: 'Stop number, lap and duration.' },
  { what: 'Sprint results', from: 2021, to: null, source: 'Jolpica-F1', note: 'Sprint points count to the championship.' },
  { what: 'Live-timing archive and replay', from: 2018, to: null, source: 'F1 live-timing archive', note: 'Unofficial feed; the recorded session replays through the live screen.' },
  { what: 'Sector times, car telemetry, tyre stints, team radio', from: 2023, to: null, source: 'OpenF1', note: 'Free historical data starts in 2023.' }
]

export const coverageFor = (season: number): CoverageItem[] => COVERAGE.filter((c) => season >= c.from && (c.to === null || season <= c.to))

// ---- projection and sensitivity ---------------------------------------------------------------------------------------------

export interface Projection {
  /** Laps of tyre age from the last observed lap. */
  points: { age: number; seconds: number; low: number; high: number }[]
  perLap: number
  r2: number
  /** One standard deviation of the observed laps about the line. */
  spread: number
  n: number
}

/**
 * Carries a stint's trend of lap time against tyre age forward `ahead` laps, with a band of ±1.96 residual standard
 * deviations. It assumes the next laps behave like the ones seen (no traffic, no safety car, no fuel-effect model), and
 * the band is only the spread of the laps seen, so it is a description of the trend, not a prediction of the race.
 * Null when fewer than eight laps, or the trend explains almost nothing (r² under 0.1).
 */
export function projectStint(ages: number[], times: number[], ahead = 8): Projection | null {
  if (ages.length < 8 || ages.length !== times.length) return null
  const t = linearTrend(ages, times)
  if (!t || t.r2 < 0.1) return null
  const mx = ages.reduce((a, b) => a + b, 0) / ages.length
  const my = times.reduce((a, b) => a + b, 0) / times.length
  const intercept = my - t.slope * mx
  const resid = ages.map((x, i) => times[i] - (intercept + t.slope * x))
  const spread = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / Math.max(1, ages.length - 2))
  const last = Math.max(...ages)
  const points = Array.from({ length: ahead }, (_, i) => {
    const age = last + i + 1
    const seconds = intercept + t.slope * age
    return { age, seconds, low: seconds - 1.96 * spread, high: seconds + 1.96 * spread }
  })
  return { points, perLap: t.slope, r2: t.r2, spread, n: ages.length }
}

export interface Sensitivity {
  label: string
  /** Total race time minus the base plan's, in seconds. */
  delta: number
}

/** What a plan's total does when one assumption moves: pit loss ±2 s, and every compound's wear ±0.02 s per lap. */
export function planSensitivity(plan: PlanStint[], a: PlanAssumptions): { base: number; rows: Sensitivity[] } | null {
  const base = evaluatePlan(plan, a)
  if (base.missing.length) return null
  const run = (m: PlanAssumptions): number => evaluatePlan(plan, m).totalSeconds - base.totalSeconds
  const wear = (d: number): Record<string, number> => Object.fromEntries(Object.entries(a.wear).map(([k, v]) => [k, v + d]))
  return {
    base: base.totalSeconds,
    rows: [
      { label: 'Pit stop 2 s slower', delta: run({ ...a, pitLoss: a.pitLoss + 2 }) },
      { label: 'Pit stop 2 s quicker', delta: run({ ...a, pitLoss: Math.max(0, a.pitLoss - 2) }) },
      { label: 'Tyres wear 0.02 s/lap faster', delta: run({ ...a, wear: wear(0.02) }) },
      { label: 'Tyres wear 0.02 s/lap slower', delta: run({ ...a, wear: wear(-0.02) }) }
    ]
  }
}

export interface CompoundLine {
  compound: string
  stints: number
  laps: number
  /** Mean of the stints' median lap times. */
  pace: number | null
  /** Median of the stints' wear trends (s per lap of age); null when none had a usable trend. */
  wear: number | null
}

/** Compounds side by side, from per-stint pace results. A compound with no usable stint shows nulls, not zeros. */
export function compoundComparison(stints: { compound: string; median: number | null; laps: number; trend: number | null }[]): CompoundLine[] {
  const by = new Map<string, typeof stints>()
  for (const s of stints) by.set(s.compound, [...(by.get(s.compound) ?? []), s])
  return [...by].map(([compound, list]) => ({
    compound,
    stints: list.length,
    laps: list.reduce((t, s) => t + s.laps, 0),
    pace: mean(list.map((s) => s.median).filter((x): x is number => x !== null)),
    wear: median(list.map((s) => s.trend).filter((x): x is number => x !== null))
  }))
}
