/**
 * Provider payloads -> the models in types.ts.
 *
 * Pure and defensive: a provider that changes a field produces `null` or a skipped row here, not a crash in a view.
 * Nothing in this file touches the network.
 */
import { mean, median } from './time.ts'
import type {
  F1ConstructorStanding,
  F1Driver,
  F1DriverStanding,
  F1Lap,
  F1LapStats,
  F1Race,
  F1RaceResult,
  F1ResultRow,
  F1Session,
  F1Standings,
  F1TimingDriver
} from './types.ts'

type Json = Record<string, unknown>

const obj = (v: unknown): Json | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** "2026-03-08" + "04:00:00Z" -> an ISO instant, or null when there is no date. A date with no time is date-only. */
function instant(date: unknown, time: unknown): string | null {
  const d = str(date)
  if (!d) return null
  const t = str(time)
  return t ? `${d}T${t.endsWith('Z') ? t : `${t}Z`}` : d
}

// ---- Jolpica (Ergast-compatible) -------------------------------------------------------------------------------------------------

function driverOf(raw: unknown): F1Driver {
  const d = obj(raw) ?? {}
  const given = str(d.givenName) ?? ''
  const family = str(d.familyName) ?? ''
  return {
    id: str(d.driverId),
    code: str(d.code),
    number: num(d.permanentNumber),
    name: `${given} ${family}`.trim() || (str(d.driverId) ?? 'Unknown driver'),
    nationality: str(d.nationality)
  }
}

function constructorOf(raw: unknown): { id: string | null; name: string; colour: null } {
  const c = obj(raw) ?? {}
  return { id: str(c.constructorId), name: str(c.name) ?? 'Unknown constructor', colour: null }
}

function raceOf(raw: unknown): F1Race | null {
  const r = obj(raw)
  if (!r) return null
  const season = num(r.season)
  const round = num(r.round)
  const circuit = obj(r.Circuit)
  if (season === null || round === null || !circuit) return null
  const location = obj(circuit.Location) ?? {}
  const named: [string, string][] = [
    ['FirstPractice', 'Practice 1'],
    ['SecondPractice', 'Practice 2'],
    ['ThirdPractice', 'Practice 3'],
    ['SprintQualifying', 'Sprint Qualifying'],
    ['SprintShootout', 'Sprint Shootout'],
    ['Sprint', 'Sprint'],
    ['Qualifying', 'Qualifying']
  ]
  const sessions = named
    .map(([key, name]) => {
      const s = obj(r[key])
      return s ? { name, startsAt: instant(s.date, s.time) } : null
    })
    .filter((s): s is { name: string; startsAt: string | null } => s !== null)
    .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''))
  return {
    season,
    round,
    name: str(r.raceName) ?? `Round ${round}`,
    circuitId: str(circuit.circuitId) ?? '',
    circuitName: str(circuit.circuitName) ?? 'Unknown circuit',
    locality: str(location.locality),
    country: str(location.country),
    lat: num(location.lat),
    long: num(location.long),
    startsAt: instant(r.date, r.time),
    sessions
  }
}

/** Jolpica `.../{season}.json` -> the calendar. */
export function normalizeSchedule(payload: unknown): F1Race[] {
  const races = arr(obj(obj(payload)?.MRData)?.RaceTable && obj(obj(obj(payload)?.MRData)?.RaceTable)?.Races)
  return races.map(raceOf).filter((r): r is F1Race => r !== null).sort((a, b) => a.round - b.round)
}

/** Jolpica `.../{season}/{round}/results.json` -> one race's classification. Null when the round has no results yet. */
export function normalizeResults(payload: unknown): F1RaceResult | null {
  const table = obj(obj(obj(payload)?.MRData)?.RaceTable)
  const first = obj(arr(table?.Races)[0])
  if (!first) return null
  const race = raceOf(first)
  if (!race) return null
  const rows: F1ResultRow[] = []
  for (const raw of arr(first.Results)) {
    const r = obj(raw)
    if (!r) continue
    const time = obj(r.Time)
    const fl = obj(r.FastestLap)
    const flTime = obj(fl?.Time)
    rows.push({
      position: num(r.position),
      positionText: str(r.positionText) ?? '',
      driver: driverOf(r.Driver),
      constructor: constructorOf(r.Constructor),
      grid: num(r.grid),
      laps: num(r.laps),
      status: str(r.status) ?? '',
      points: num(r.points) ?? 0,
      timeText: str(time?.time),
      fastestLap: fl ? { rank: num(fl.rank), lap: num(fl.lap), timeText: str(flTime?.time) } : null
    })
  }
  return { race, rows }
}

function standingsList(payload: unknown): Json | null {
  const table = obj(obj(obj(payload)?.MRData)?.StandingsTable)
  return obj(arr(table?.StandingsLists)[0])
}

export function normalizeDriverStandings(payload: unknown): F1Standings<F1DriverStanding> | null {
  const list = standingsList(payload)
  if (!list) return null
  const season = num(list.season)
  const round = num(list.round)
  if (season === null || round === null) return null
  const rows: F1DriverStanding[] = []
  for (const raw of arr(list.DriverStandings)) {
    const s = obj(raw)
    const position = num(s?.position)
    if (!s || position === null) continue
    rows.push({
      position,
      positionText: str(s.positionText) ?? String(position),
      points: num(s.points) ?? 0,
      wins: num(s.wins) ?? 0,
      driver: driverOf(s.Driver),
      constructors: arr(s.Constructors).map(constructorOf)
    })
  }
  return { season, round, rows }
}

export function normalizeConstructorStandings(payload: unknown): F1Standings<F1ConstructorStanding> | null {
  const list = standingsList(payload)
  if (!list) return null
  const season = num(list.season)
  const round = num(list.round)
  if (season === null || round === null) return null
  const rows: F1ConstructorStanding[] = []
  for (const raw of arr(list.ConstructorStandings)) {
    const s = obj(raw)
    const position = num(s?.position)
    if (!s || position === null) continue
    rows.push({
      position,
      positionText: str(s.positionText) ?? String(position),
      points: num(s.points) ?? 0,
      wins: num(s.wins) ?? 0,
      constructor: constructorOf(s.Constructor)
    })
  }
  return { season, round, rows }
}

// ---- OpenF1 -----------------------------------------------------------------------------------------------------------------------

export function normalizeSessions(payload: unknown): F1Session[] {
  const out: F1Session[] = []
  for (const raw of arr(payload)) {
    const s = obj(raw)
    const key = num(s?.session_key)
    const start = str(s?.date_start)
    const end = str(s?.date_end)
    if (!s || key === null || !start || !end) continue
    out.push({
      key,
      meetingKey: num(s.meeting_key) ?? 0,
      name: str(s.session_name) ?? 'Session',
      type: str(s.session_type) ?? '',
      startsAt: start,
      endsAt: end,
      circuitName: str(s.circuit_short_name) ?? str(s.location) ?? '',
      country: str(s.country_name),
      year: num(s.year) ?? Number(start.slice(0, 4))
    })
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}

export function normalizeTimingDrivers(payload: unknown): F1TimingDriver[] {
  const byNumber = new Map<number, F1TimingDriver>()
  for (const raw of arr(payload)) {
    const d = obj(raw)
    const number = num(d?.driver_number)
    if (!d || number === null) continue
    byNumber.set(number, {
      number,
      code: str(d.name_acronym) ?? String(number),
      name: str(d.full_name) ?? str(d.broadcast_name) ?? `Driver ${number}`,
      team: str(d.team_name),
      colour: str(d.team_colour)
    })
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number)
}

export function normalizeLaps(payload: unknown): F1Lap[] {
  const laps: F1Lap[] = []
  for (const raw of arr(payload)) {
    const l = obj(raw)
    const driverNumber = num(l?.driver_number)
    const lap = num(l?.lap_number)
    if (!l || driverNumber === null || lap === null) continue
    const duration = num(l.lap_duration)
    laps.push({
      driverNumber,
      lap,
      startedAt: str(l.date_start),
      // A duration of 0 or less is not a lap time.
      duration: duration !== null && duration > 0 ? duration : null,
      sectors: [num(l.duration_sector_1), num(l.duration_sector_2), num(l.duration_sector_3)],
      speeds: { i1: num(l.i1_speed), i2: num(l.i2_speed), finishLine: num(l.st_speed) },
      isPitOut: l.is_pit_out_lap === true
    })
  }
  return laps.sort((a, b) => a.driverNumber - b.driverNumber || a.lap - b.lap)
}

/**
 * Per-driver figures from laps.
 *
 * Eligible = has a recorded duration and is not an out-lap. That is a deliberate, documented rule for "representative
 * pace"; the best lap is taken over the same set, so a pit-out lap cannot be the headline number.
 */
export function lapStats(laps: F1Lap[], driverNumber: number): F1LapStats {
  const mine = laps.filter((l) => l.driverNumber === driverNumber)
  const eligible = mine.filter((l) => l.duration !== null && !l.isPitOut)
  const durations = eligible.map((l) => l.duration as number)
  let best: F1LapStats['best'] = null
  for (const l of eligible) {
    if (best === null || (l.duration as number) < best.duration) best = { lap: l.lap, duration: l.duration as number }
  }
  const bestOf = (i: 0 | 1 | 2): number | null => {
    const v = eligible.map((l) => l.sectors[i]).filter((x): x is number => x !== null && x > 0)
    return v.length ? Math.min(...v) : null
  }
  return {
    driverNumber,
    lapsRecorded: mine.length,
    lapsEligible: eligible.length,
    best,
    median: median(durations),
    average: mean(durations),
    bestSectors: [bestOf(0), bestOf(1), bestOf(2)]
  }
}

/** The fastest eligible lap in the whole session and who set it, or null. */
export function sessionBest(laps: F1Lap[]): { driverNumber: number; lap: number; duration: number } | null {
  let best: { driverNumber: number; lap: number; duration: number } | null = null
  for (const l of laps) {
    if (l.duration === null || l.isPitOut) continue
    if (best === null || l.duration < best.duration) best = { driverNumber: l.driverNumber, lap: l.lap, duration: l.duration }
  }
  return best
}

/** The best sector time of each sector across every driver, for the purple/green sector colouring. */
export function sessionBestSectors(laps: F1Lap[]): [number | null, number | null, number | null] {
  const out: [number | null, number | null, number | null] = [null, null, null]
  for (const l of laps) {
    if (l.isPitOut) continue
    for (const i of [0, 1, 2] as const) {
      const s = l.sectors[i]
      if (s !== null && s > 0 && (out[i] === null || s < (out[i] as number))) out[i] = s
    }
  }
  return out
}
