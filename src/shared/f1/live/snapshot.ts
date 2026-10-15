/**
 * The raw, merged feed state -> the one object the live timing screen renders.
 *
 * Every field that the feed did not supply is null. Nothing here guesses: a gap that is not in the feed is not
 * computed from positions, and a tyre that is not reported is "unknown", not inferred from lap times.
 */
import { parseLapTime } from '../time.ts'
import type { RawFeedState } from './merge.ts'

type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : obj(v) ? Object.values(obj(v) as Json) : [])
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const flag = (v: unknown): boolean => v === true
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export type SectorMark = 'overall' | 'personal' | 'none'

export interface LiveSector {
  /** Seconds, or null when the sector has no value yet this lap. */
  time: number | null
  mark: SectorMark
}

export interface LiveTyre {
  compound: string | null
  /** Laps on this set when the feed was last told, including laps before the stint began (a used set). */
  laps: number | null
  isNew: boolean | null
  stint: number
}

export interface LiveDriverRow {
  number: string
  code: string
  name: string
  team: string | null
  colour: string | null
  position: number | null
  /** The text the feed gave for the gap: "+12.345", "1L" or "LAP 5", kept exactly as it came. */
  gapToLeader: string | null
  interval: string | null
  lastLap: { time: number | null; mark: SectorMark }
  bestLap: { time: number | null; lap: number | null }
  sectors: [LiveSector, LiveSector, LiveSector]
  /** Speed-trap readings in km/h: intermediate 1, intermediate 2, finish line, longest straight. */
  speeds: { i1: number | null; i2: number | null; fl: number | null; st: number | null }
  laps: number | null
  pitStops: number | null
  inPit: boolean
  pitOut: boolean
  retired: boolean
  stopped: boolean
  tyre: LiveTyre | null
  stints: LiveTyre[]
  grid: number | null
}

export interface LiveRaceControl {
  utc: string | null
  lap: number | null
  category: string | null
  flag: string | null
  scope: string | null
  sector: number | null
  driver: string | null
  message: string
}

export interface LiveSnapshot {
  session: {
    meeting: string | null
    name: string | null
    type: string | null
    circuit: string | null
    country: string | null
    /** The feed's own path for the session, useful to find its archive. */
    path: string | null
  }
  /** "Started", "Finished", "Finalised", "Ends", "Aborted", "Inactive" ... exactly as the feed says. */
  sessionStatus: string | null
  /** Track state in words: "AllClear", "Yellow", "SCDeployed", "VSCDeployed", "Red" ... */
  trackStatus: { code: string | null; message: string | null }
  clock: { remaining: string | null; extrapolating: boolean | null; utc: string | null }
  lap: { current: number | null; total: number | null }
  weather: {
    airTemp: number | null
    trackTemp: number | null
    humidity: number | null
    pressure: number | null
    windSpeed: number | null
    windDirection: number | null
    rainfall: boolean | null
  }
  drivers: LiveDriverRow[]
  raceControl: LiveRaceControl[]
  /** The feed's own last heartbeat time, when it sent one. */
  heartbeatUtc: string | null
}

function mark(overall: unknown, personal: unknown): SectorMark {
  if (flag(overall)) return 'overall'
  if (flag(personal)) return 'personal'
  return 'none'
}

export function buildSnapshot(raw: RawFeedState): LiveSnapshot {
  const info = obj(raw.SessionInfo) ?? {}
  const meeting = obj(info.Meeting) ?? {}
  const circuit = obj(meeting.Circuit) ?? {}
  const country = obj(meeting.Country) ?? {}
  const status = obj(raw.SessionStatus)
  const track = obj(raw.TrackStatus)
  const clock = obj(raw.ExtrapolatedClock)
  const laps = obj(raw.LapCount)
  const weather = obj(raw.WeatherData)
  const driverList = obj(raw.DriverList) ?? {}
  const timing = obj(obj(raw.TimingData)?.Lines) ?? {}
  const app = obj(obj(raw.TimingAppData)?.Lines) ?? {}

  const numbers = new Set<string>([...Object.keys(timing), ...Object.keys(driverList).filter((k) => /^\d+$/.test(k))])
  const drivers: LiveDriverRow[] = []
  for (const n of numbers) {
    const d = obj(driverList[n]) ?? {}
    const t = obj(timing[n]) ?? {}
    const a = obj(app[n]) ?? {}
    const sectorsRaw = list(t.Sectors)
    const sector = (i: number): LiveSector => {
      const s = obj(sectorsRaw[i]) ?? {}
      return { time: parseLapTime(str(s.Value)), mark: mark(s.OverallFastest, s.PersonalFastest) }
    }
    const speeds = obj(t.Speeds) ?? {}
    const speed = (k: string): number | null => num(obj(speeds[k])?.Value)
    const last = obj(t.LastLapTime) ?? {}
    const best = obj(t.BestLapTime) ?? {}
    const stints: LiveTyre[] = list(a.Stints).map((s, i) => {
      const x = obj(s) ?? {}
      const c = str(x.Compound)
      const total = num(x.TotalLaps)
      const start = num(x.StartLaps)
      return {
        compound: c && c !== 'UNKNOWN' ? c : null,
        laps: total ?? start,
        isNew: typeof x.New === 'string' ? x.New === 'true' : typeof x.New === 'boolean' ? x.New : null,
        stint: i + 1
      }
    })
    drivers.push({
      number: n,
      code: str(d.Tla) ?? n,
      name: str(d.FullName) ?? str(d.BroadcastName) ?? `Driver ${n}`,
      team: str(d.TeamName),
      colour: str(d.TeamColour),
      position: num(t.Position) ?? num(t.Line),
      gapToLeader: str(t.GapToLeader),
      interval: str(obj(t.IntervalToPositionAhead)?.Value),
      lastLap: { time: parseLapTime(str(last.Value)), mark: mark(last.OverallFastest, last.PersonalFastest) },
      bestLap: { time: parseLapTime(str(best.Value)), lap: num(best.Lap) },
      sectors: [sector(0), sector(1), sector(2)],
      speeds: { i1: speed('I1'), i2: speed('I2'), fl: speed('FL'), st: speed('ST') },
      laps: num(t.NumberOfLaps),
      pitStops: num(t.NumberOfPitStops),
      inPit: flag(t.InPit),
      pitOut: flag(t.PitOut),
      retired: flag(t.Retired),
      stopped: flag(t.Stopped),
      tyre: stints.length ? stints[stints.length - 1] : null,
      stints,
      grid: num(a.GridPos)
    })
  }
  drivers.sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || Number(a.number) - Number(b.number))

  const messages = list(obj(raw.RaceControlMessages)?.Messages)
    .map((m): LiveRaceControl | null => {
      const x = obj(m)
      const message = str(x?.Message)
      if (!x || !message) return null
      return {
        utc: str(x.Utc),
        lap: num(x.Lap),
        category: str(x.Category),
        flag: str(x.Flag),
        scope: str(x.Scope),
        sector: num(x.Sector),
        driver: str(x.RacingNumber),
        message
      }
    })
    .filter((m): m is LiveRaceControl => m !== null)

  return {
    session: {
      meeting: str(meeting.Name),
      name: str(info.Name),
      type: str(info.Type),
      circuit: str(circuit.ShortName),
      country: str(country.Name),
      path: str(info.Path)
    },
    sessionStatus: str(status?.Status) ?? str(info.SessionStatus),
    trackStatus: { code: str(track?.Status), message: str(track?.Message) },
    clock: { remaining: str(clock?.Remaining), extrapolating: typeof clock?.Extrapolating === 'boolean' ? clock.Extrapolating : null, utc: str(clock?.Utc) },
    lap: { current: num(laps?.CurrentLap), total: num(laps?.TotalLaps) },
    weather: {
      airTemp: num(weather?.AirTemp),
      trackTemp: num(weather?.TrackTemp),
      humidity: num(weather?.Humidity),
      pressure: num(weather?.Pressure),
      windSpeed: num(weather?.WindSpeed),
      windDirection: num(weather?.WindDirection),
      rainfall: weather && weather.Rainfall !== undefined ? num(weather.Rainfall) !== 0 && num(weather.Rainfall) !== null : null
    },
    drivers,
    raceControl: messages,
    heartbeatUtc: str(obj(raw.Heartbeat)?.Utc)
  }
}
