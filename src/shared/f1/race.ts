/**
 * The rest of a session's record: positions through the race, weather, race-control messages, overtakes, and the
 * championship table OpenF1 keeps for a meeting.
 */
import type { F1Lap } from './types.ts'

type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (v !== null && typeof v === 'object' ? (v as Json) : null)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null
}
const ms = (iso: string | null): number | null => {
  if (!iso) return null
  const n = Date.parse(iso)
  return Number.isFinite(n) ? n : null
}

export interface PositionChange {
  driverNumber: number
  /** Epoch ms. */
  t: number
  position: number
}

export function normalizePositions(payload: unknown): PositionChange[] {
  const out: PositionChange[] = []
  for (const raw of arr(payload)) {
    const p = obj(raw)
    const d = num(p?.driver_number)
    const pos = num(p?.position)
    const t = ms(str(p?.date))
    if (!p || d === null || pos === null || t === null) continue
    out.push({ driverNumber: d, t, position: pos })
  }
  return out.sort((a, b) => a.t - b.t)
}

/**
 * Each driver's position at the end of every lap: the last reported position at or before the moment that driver
 * began the next lap. A lap with no position report before it is left out, not guessed.
 */
export function positionByLap(changes: PositionChange[], laps: F1Lap[]): Map<number, { lap: number; position: number }[]> {
  const byDriver = new Map<number, PositionChange[]>()
  for (const c of changes) {
    const l = byDriver.get(c.driverNumber) ?? []
    l.push(c)
    byDriver.set(c.driverNumber, l)
  }
  const result = new Map<number, { lap: number; position: number }[]>()
  const lapsByDriver = new Map<number, F1Lap[]>()
  for (const l of laps) {
    const a = lapsByDriver.get(l.driverNumber) ?? []
    a.push(l)
    lapsByDriver.set(l.driverNumber, a)
  }
  for (const [driver, ds] of lapsByDriver) {
    const ch = byDriver.get(driver) ?? []
    if (ch.length === 0) continue
    const ordered = ds.slice().sort((a, b) => a.lap - b.lap)
    const rows: { lap: number; position: number }[] = []
    for (let i = 0; i < ordered.length; i++) {
      const nextStart = ordered[i + 1] ? ms(ordered[i + 1].startedAt) : null
      const endsAt = nextStart ?? (ordered[i].startedAt && ordered[i].duration !== null ? (ms(ordered[i].startedAt) as number) + (ordered[i].duration as number) * 1000 : null)
      if (endsAt === null) continue
      let pos: number | null = null
      for (const c of ch) {
        if (c.t <= endsAt) pos = c.position
        else break
      }
      if (pos !== null) rows.push({ lap: ordered[i].lap, position: pos })
    }
    result.set(driver, rows)
  }
  return result
}

export interface WeatherPoint {
  t: number
  airTemp: number | null
  trackTemp: number | null
  humidity: number | null
  pressure: number | null
  windSpeed: number | null
  windDirection: number | null
  rainfall: boolean | null
}

export function normalizeWeather(payload: unknown): WeatherPoint[] {
  const out: WeatherPoint[] = []
  for (const raw of arr(payload)) {
    const w = obj(raw)
    const t = ms(str(w?.date))
    if (!w || t === null) continue
    const r = num(w.rainfall)
    out.push({
      t,
      airTemp: num(w.air_temperature),
      trackTemp: num(w.track_temperature),
      humidity: num(w.humidity),
      pressure: num(w.pressure),
      windSpeed: num(w.wind_speed),
      windDirection: num(w.wind_direction),
      rainfall: r === null ? null : r > 0
    })
  }
  return out.sort((a, b) => a.t - b.t)
}

export interface RaceControlEntry {
  t: number | null
  lap: number | null
  category: string | null
  flag: string | null
  scope: string | null
  sector: number | null
  driverNumber: number | null
  message: string
}

export function normalizeRaceControl(payload: unknown): RaceControlEntry[] {
  const out: RaceControlEntry[] = []
  for (const raw of arr(payload)) {
    const m = obj(raw)
    const message = str(m?.message)
    if (!m || !message) continue
    out.push({
      t: ms(str(m.date)),
      lap: num(m.lap_number),
      category: str(m.category),
      flag: str(m.flag),
      scope: str(m.scope),
      sector: num(m.sector),
      driverNumber: num(m.driver_number),
      message
    })
  }
  return out.sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
}

export interface Overtake {
  t: number
  overtaking: number
  overtaken: number
  position: number | null
}

export function normalizeOvertakes(payload: unknown): Overtake[] {
  const out: Overtake[] = []
  for (const raw of arr(payload)) {
    const o = obj(raw)
    const a = num(o?.overtaking_driver_number)
    const b = num(o?.overtaken_driver_number)
    const t = ms(str(o?.date))
    if (!o || a === null || b === null || t === null) continue
    out.push({ t, overtaking: a, overtaken: b, position: num(o.position) })
  }
  return out.sort((x, y) => x.t - y.t)
}

export interface SessionResultRow {
  driverNumber: number
  position: number | null
  laps: number | null
  points: number | null
  dnf: boolean
  dns: boolean
  dsq: boolean
  /** Seconds, or an array of segment times for qualifying: kept as given. */
  duration: number | number[] | null
  gapToLeader: number | string | null
}

export function normalizeSessionResult(payload: unknown): SessionResultRow[] {
  const out: SessionResultRow[] = []
  for (const raw of arr(payload)) {
    const r = obj(raw)
    const d = num(r?.driver_number)
    if (!r || d === null) continue
    const dur = r.duration
    out.push({
      driverNumber: d,
      position: num(r.position),
      laps: num(r.number_of_laps),
      points: num(r.points),
      dnf: r.dnf === true,
      dns: r.dns === true,
      dsq: r.dsq === true,
      duration: Array.isArray(dur) ? dur.map((x) => num(x)).filter((x): x is number => x !== null) : num(dur),
      gapToLeader: typeof r.gap_to_leader === 'string' ? r.gap_to_leader : num(r.gap_to_leader)
    })
  }
  return out.sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
}

export interface StartingGridRow {
  driverNumber: number
  position: number
  lapTime: number | null
}

export function normalizeStartingGrid(payload: unknown): StartingGridRow[] {
  const out: StartingGridRow[] = []
  for (const raw of arr(payload)) {
    const r = obj(raw)
    const d = num(r?.driver_number)
    const p = num(r?.position)
    if (!r || d === null || p === null) continue
    out.push({ driverNumber: d, position: p, lapTime: num(r.lap_duration) })
  }
  return out.sort((a, b) => a.position - b.position)
}

/** Gaps: one reading per driver per `everyMs`, so a race's 28,000 readings become a few thousand. */
export interface GapPoint {
  driverNumber: number
  t: number
  /** Seconds to the leader, or null when the provider gave text such as "1 LAP". */
  gapToLeader: number | null
  /** Text the provider gave when it was not a number ("1 LAP"). */
  gapText: string | null
  interval: number | null
}

export function normalizeIntervals(payload: unknown, everyMs = 15_000): GapPoint[] {
  const last = new Map<number, number>()
  const out: GapPoint[] = []
  for (const raw of arr(payload)) {
    const g = obj(raw)
    const d = num(g?.driver_number)
    const t = ms(str(g?.date))
    if (!g || d === null || t === null) continue
    if (t - (last.get(d) ?? -Infinity) < everyMs) continue
    last.set(d, t)
    const gl = g.gap_to_leader
    out.push({
      driverNumber: d,
      t,
      gapToLeader: num(gl),
      gapText: typeof gl === 'string' && num(gl) === null ? gl : null,
      interval: num(g.interval)
    })
  }
  return out
}

export interface ChampionshipRow {
  driverNumber: number
  positionStart: number | null
  positionCurrent: number | null
  pointsStart: number | null
  pointsCurrent: number | null
}

export function normalizeChampionship(payload: unknown): ChampionshipRow[] {
  const out: ChampionshipRow[] = []
  for (const raw of arr(payload)) {
    const r = obj(raw)
    const d = num(r?.driver_number)
    if (!r || d === null) continue
    out.push({
      driverNumber: d,
      positionStart: num(r.position_start),
      positionCurrent: num(r.position_current),
      pointsStart: num(r.points_start),
      pointsCurrent: num(r.points_current)
    })
  }
  return out.sort((a, b) => (a.positionCurrent ?? 999) - (b.positionCurrent ?? 999))
}

export interface NeutralisedPeriod {
  kind: 'safety-car' | 'virtual-safety-car' | 'red-flag'
  startLap: number | null
  endLap: number | null
  startT: number | null
  endT: number | null
  /** True when the end was never reported (the session ended first, or the message was missing). */
  open: boolean
}

/**
 * Safety-car, virtual-safety-car and red-flag periods, read from race-control messages. A period begins at a
 * "deployed" or "red flag" message and ends at the message that ends it; one never ended is marked open.
 * Only these exact message families are used, so an unrelated message cannot start a period.
 */
export function neutralisations(messages: RaceControlEntry[]): NeutralisedPeriod[] {
  const out: NeutralisedPeriod[] = []
  let open: NeutralisedPeriod | null = null
  const begin = (kind: NeutralisedPeriod['kind'], m: RaceControlEntry): void => {
    if (open && open.kind === kind) return
    if (open) close(m)
    open = { kind, startLap: m.lap, endLap: null, startT: m.t, endT: null, open: true }
  }
  const close = (m: RaceControlEntry): void => {
    if (!open) return
    open.endLap = m.lap
    open.endT = m.t
    open.open = false
    out.push(open)
    open = null
  }
  for (const m of messages) {
    const text = m.message.toUpperCase()
    if (/^(VIRTUAL SAFETY CAR|VSC) DEPLOYED/.test(text)) begin('virtual-safety-car', m)
    else if (/^(VIRTUAL SAFETY CAR|VSC) ENDING/.test(text)) {
      if (open && (open as NeutralisedPeriod).kind === 'virtual-safety-car') close(m)
    } else if (/^(SAFETY CAR|SC) DEPLOYED/.test(text)) begin('safety-car', m)
    else if (/^SAFETY CAR IN THIS LAP/.test(text)) {
      // "In this lap" is the announcement that it comes in; the period ends when the track is green again, which is
      // the next "CLEAR" message, so it is left open until then.
    } else if (/^RED FLAG/.test(text) || m.flag === 'RED') begin('red-flag', m)
    else if (open && (/^TRACK CLEAR|^CLEAR/.test(text) || (m.flag === 'GREEN' && (m.scope === 'Track' || m.scope === null)) || /^GREEN LIGHT/.test(text))) {
      if ((open as NeutralisedPeriod).kind === 'safety-car' && !(m.flag === 'GREEN' && m.scope === 'Track') && !/^TRACK CLEAR|^CLEAR/.test(text)) continue
      close(m)
    }
  }
  if (open) out.push(open)
  return out
}
