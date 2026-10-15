/**
 * A season as a list of result rows: the basis of driver profiles, head-to-head comparisons and championship
 * progression. Everything here is derived from the provider's own rows, and says how.
 */

type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export interface SeasonRow {
  season: number
  round: number
  raceName: string
  /** Whether this row is from a sprint rather than the Grand Prix. */
  sprint: boolean
  driverId: string
  driverCode: string | null
  driverName: string
  constructorId: string
  constructorName: string
  position: number | null
  positionText: string
  grid: number | null
  points: number
  status: string
  laps: number | null
  /** Rank of the fastest lap among all fastest laps of the race (1 is the quickest), when the provider gave it. */
  fastestLapRank: number | null
  /** True when the provider lists this driver as classified (a finishing position and a "Finished" or "+N Lap(s)" status). */
  classified: boolean
}

/** One page of Jolpica results or sprint results -> rows. Several pages are concatenated by the caller. */
export function normalizeSeasonRows(payload: unknown, sprint: boolean): SeasonRow[] {
  const races = arr(obj(obj(obj(payload)?.MRData)?.RaceTable)?.Races)
  const out: SeasonRow[] = []
  for (const r of races) {
    const race = obj(r)
    const season = num(race?.season)
    const round = num(race?.round)
    if (!race || season === null || round === null) continue
    for (const raw of arr(sprint ? race.SprintResults : race.Results)) {
      const x = obj(raw)
      const d = obj(x?.Driver)
      const c = obj(x?.Constructor)
      const driverId = str(d?.driverId)
      if (!x || !d || !driverId) continue
      const status = str(x.status) ?? ''
      const pos = num(x.position)
      const fl = obj(x.FastestLap)
      out.push({
        season,
        round,
        raceName: str(race.raceName) ?? `Round ${round}`,
        sprint,
        driverId,
        driverCode: str(d.code),
        driverName: `${str(d.givenName) ?? ''} ${str(d.familyName) ?? ''}`.trim() || driverId,
        constructorId: str(c?.constructorId) ?? 'unknown',
        constructorName: str(c?.name) ?? 'Unknown',
        position: pos,
        positionText: str(x.positionText) ?? '',
        grid: num(x.grid),
        points: num(x.points) ?? 0,
        status,
        laps: num(x.laps),
        fastestLapRank: num(fl?.rank),
        classified: pos !== null && /^(Finished|\+\d+ Lap)/.test(status)
      })
    }
  }
  return out
}

export interface QualifyingRow {
  season: number
  round: number
  driverId: string
  constructorId: string
  position: number | null
  q1: string | null
  q2: string | null
  q3: string | null
}

export function normalizeQualifying(payload: unknown): QualifyingRow[] {
  const races = arr(obj(obj(obj(payload)?.MRData)?.RaceTable)?.Races)
  const out: QualifyingRow[] = []
  for (const r of races) {
    const race = obj(r)
    const season = num(race?.season)
    const round = num(race?.round)
    if (!race || season === null || round === null) continue
    for (const raw of arr(race.QualifyingResults)) {
      const x = obj(raw)
      const driverId = str(obj(x?.Driver)?.driverId)
      if (!x || !driverId) continue
      out.push({
        season,
        round,
        driverId,
        constructorId: str(obj(x.Constructor)?.constructorId) ?? 'unknown',
        position: num(x.position),
        q1: str(x.Q1),
        q2: str(x.Q2),
        q3: str(x.Q3)
      })
    }
  }
  return out
}

export interface CareerSeason {
  season: number
  position: number | null
  points: number
  wins: number
  constructors: string[]
}

/** `/drivers/{id}/driverStandings.json` -> one line per season: where the driver finished the year. */
export function normalizeCareer(payload: unknown): CareerSeason[] {
  const lists = arr(obj(obj(obj(payload)?.MRData)?.StandingsTable)?.StandingsLists)
  const out: CareerSeason[] = []
  for (const l of lists) {
    const list = obj(l)
    const season = num(list?.season)
    const s = obj(arr(list?.DriverStandings)[0])
    if (!list || season === null || !s) continue
    out.push({
      season,
      position: num(s.position),
      points: num(s.points) ?? 0,
      wins: num(s.wins) ?? 0,
      constructors: arr(s.Constructors).map((c) => str(obj(c)?.name)).filter((n): n is string => n !== null)
    })
  }
  return out.sort((a, b) => a.season - b.season)
}

// ---- derived figures -------------------------------------------------------------------------------------------------------------

export interface DriverSeasonStats {
  driverId: string
  entries: number
  wins: number
  podiums: number
  points: number
  /** Points per race (Grand Prix only, entries counted). */
  pointsPerRace: number | null
  poles: number
  dnfs: number
  /** Mean of classified finishing positions; null when the driver was never classified. */
  avgFinish: number | null
  /** Mean grid slot of starts that had one (pit-lane starts, grid 0, are left out). */
  avgGrid: number | null
  bestFinish: number | null
}

/** Sprint points count towards the championship total; the other figures are Grand Prix only. */
export function driverSeasonStats(rows: SeasonRow[], driverId: string, qualifying: QualifyingRow[] = []): DriverSeasonStats {
  const gp = rows.filter((r) => r.driverId === driverId && !r.sprint)
  const sprint = rows.filter((r) => r.driverId === driverId && r.sprint)
  const finishes = gp.filter((r) => r.classified).map((r) => r.position as number)
  const grids = gp.map((r) => r.grid).filter((g): g is number => g !== null && g > 0)
  const poles = qualifying.length ? qualifying.filter((q) => q.driverId === driverId && q.position === 1).length : gp.filter((r) => r.grid === 1).length
  const points = gp.reduce((t, r) => t + r.points, 0) + sprint.reduce((t, r) => t + r.points, 0)
  return {
    driverId,
    entries: gp.length,
    wins: gp.filter((r) => r.position === 1).length,
    podiums: gp.filter((r) => r.position !== null && r.position <= 3).length,
    points,
    pointsPerRace: gp.length ? points / gp.length : null,
    poles,
    dnfs: gp.filter((r) => !r.classified).length,
    avgFinish: finishes.length ? finishes.reduce((t, v) => t + v, 0) / finishes.length : null,
    avgGrid: grids.length ? grids.reduce((t, v) => t + v, 0) / grids.length : null,
    bestFinish: finishes.length ? Math.min(...finishes) : null
  }
}

export interface HeadToHead {
  /** Rounds where both drivers drove for the same constructor and both have a comparable result. */
  qualifying: { rounds: number; a: number; b: number }
  race: { rounds: number; a: number; b: number }
  /** Rounds in which they were teammates at all. */
  sharedRounds: number
}

/**
 * Teammate comparison. A round only counts when BOTH drove for the same constructor in it. Qualifying compares
 * classification positions; the race compares finishing positions where both were classified, because a retirement is
 * not a comparable finish. Ties do not occur in either, and a round with a missing side is simply not counted.
 */
export function headToHead(rows: SeasonRow[], qualifying: QualifyingRow[], a: string, b: string): HeadToHead {
  const gp = rows.filter((r) => !r.sprint)
  const byRound = new Map<number, { a?: SeasonRow; b?: SeasonRow }>()
  for (const r of gp) {
    if (r.driverId !== a && r.driverId !== b) continue
    const e = byRound.get(r.round) ?? {}
    if (r.driverId === a) e.a = r
    else e.b = r
    byRound.set(r.round, e)
  }
  const shared = new Map<number, true>()
  const out: HeadToHead = { qualifying: { rounds: 0, a: 0, b: 0 }, race: { rounds: 0, a: 0, b: 0 }, sharedRounds: 0 }
  for (const [round, e] of byRound) {
    if (!e.a || !e.b || e.a.constructorId !== e.b.constructorId) continue
    shared.set(round, true)
    if (e.a.classified && e.b.classified) {
      out.race.rounds += 1
      if ((e.a.position as number) < (e.b.position as number)) out.race.a += 1
      else out.race.b += 1
    }
  }
  out.sharedRounds = shared.size
  const qa = new Map<number, number>()
  const qb = new Map<number, number>()
  for (const q of qualifying) {
    if (!shared.has(q.round) || q.position === null) continue
    if (q.driverId === a) qa.set(q.round, q.position)
    if (q.driverId === b) qb.set(q.round, q.position)
  }
  for (const [round, pa] of qa) {
    const pb = qb.get(round)
    if (pb === undefined) continue
    out.qualifying.rounds += 1
    if (pa < pb) out.qualifying.a += 1
    else out.qualifying.b += 1
  }
  return out
}

export interface ProgressionPoint {
  round: number
  raceName: string
  /** Points scored in this round (race plus sprint). */
  scored: number
  /** Running total after this round. */
  total: number
}

/** Cumulative points by round for each driver or constructor, from the rows' own points. Rounds with no row are skipped. */
export function pointsProgression(rows: SeasonRow[], by: 'driver' | 'constructor'): Map<string, { name: string; points: ProgressionPoint[] }> {
  const names = new Map<string, string>()
  const perRound = new Map<string, Map<number, { raceName: string; pts: number }>>()
  for (const r of rows) {
    const key = by === 'driver' ? r.driverId : r.constructorId
    names.set(key, by === 'driver' ? r.driverName : r.constructorName)
    const m = perRound.get(key) ?? new Map()
    const e = m.get(r.round) ?? { raceName: r.raceName, pts: 0 }
    e.pts += r.points
    m.set(r.round, e)
    perRound.set(key, m)
  }
  const rounds = [...new Set(rows.map((r) => r.round))].sort((a, b) => a - b)
  const raceNames = new Map(rows.map((r) => [r.round, r.raceName]))
  const out = new Map<string, { name: string; points: ProgressionPoint[] }>()
  for (const [key, m] of perRound) {
    let total = 0
    const points: ProgressionPoint[] = []
    for (const round of rounds) {
      const e = m.get(round)
      total += e?.pts ?? 0
      points.push({ round, raceName: raceNames.get(round) ?? `Round ${round}`, scored: e?.pts ?? 0, total })
    }
    out.set(key, { name: names.get(key) ?? key, points })
  }
  return out
}
