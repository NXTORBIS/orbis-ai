/**
 * Orbis Arena -> F1: the later additions. Circuit records across seasons, the qualifying explorer, a constructor's
 * season, team radio, a weather forecast, estimated corner positions, shareable reports, and what a profile keeps
 * (watchlist, alert switches). Same rules as the rest: a value a source did not give is `null`, nothing is invented.
 */

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
const driverName = (raw: unknown): { id: string | null; code: string | null; name: string } => {
  const d = obj(raw) ?? {}
  const name = `${str(d.givenName) ?? ''} ${str(d.familyName) ?? ''}`.trim()
  return { id: str(d.driverId), code: str(d.code), name: name || (str(d.driverId) ?? 'Unknown driver') }
}
const races = (payload: unknown): unknown[] => arr(obj(obj(obj(payload)?.MRData)?.RaceTable)?.Races)

// ---- circuit records -------------------------------------------------------------------------------------------------------

export interface CircuitRecord {
  season: number
  round: number
  race: string
  driver: string
  constructor: string
  lap: number | null
  timeText: string | null
  /** Seconds, parsed from `m:ss.mmm`; null when the text is not a lap time. */
  seconds: number | null
  avgSpeedKph: number | null
}

export function parseLapText(t: string | null): number | null {
  if (!t) return null
  const m = /^(?:(\d+):)?(\d{1,2})\.(\d{1,3})$/.exec(t.trim())
  if (!m) return null
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]) + Number(m[3].padEnd(3, '0')) / 1000
}

/** Jolpica `circuits/{id}/fastest/1/results.json`: the fastest lap of each race run there, newest first. */
export function normalizeCircuitRecords(payload: unknown): CircuitRecord[] {
  const out: CircuitRecord[] = []
  for (const r of races(payload)) {
    const race = obj(r)
    const season = num(race?.season)
    const round = num(race?.round)
    const row = obj(arr(race?.Results)[0])
    if (!race || season === null || round === null || !row) continue
    const fl = obj(row.FastestLap)
    const text = str(obj(fl?.Time)?.time)
    out.push({
      season,
      round,
      race: str(race.raceName) ?? `Round ${round}`,
      driver: driverName(row.Driver).name,
      constructor: str(obj(row.Constructor)?.name) ?? 'Unknown constructor',
      lap: num(fl?.lap),
      timeText: text,
      seconds: parseLapText(text),
      avgSpeedKph: num(obj(fl?.AverageSpeed)?.speed)
    })
  }
  return out.sort((a, b) => b.season - a.season)
}

/** The quickest of the listed laps, or null when none has a readable time. Ties keep the earlier race. */
export function circuitRecord(rows: CircuitRecord[]): CircuitRecord | null {
  let best: CircuitRecord | null = null
  for (const r of rows) if (r.seconds !== null && (best === null || r.seconds < (best.seconds as number) || (r.seconds === best.seconds && r.season < best.season))) best = r
  return best
}

// ---- qualifying ------------------------------------------------------------------------------------------------------------

export interface QualifyingLine {
  position: number | null
  driver: string
  code: string | null
  constructor: string
  q1: string | null
  q2: string | null
  q3: string | null
  /** The deepest session reached: 3 (the top ten shootout), 2, 1 or null when no time is listed. */
  reached: 1 | 2 | 3 | null
}
export interface QualifyingSession {
  season: number
  round: number
  race: string
  circuit: string
  lines: QualifyingLine[]
}

export function normalizeQualifyingSession(payload: unknown): QualifyingSession | null {
  const race = obj(races(payload)[0])
  const season = num(race?.season)
  const round = num(race?.round)
  if (!race || season === null || round === null) return null
  const lines: QualifyingLine[] = []
  for (const raw of arr(race.QualifyingResults)) {
    const x = obj(raw)
    if (!x) continue
    const d = driverName(x.Driver)
    const q1 = str(x.Q1)
    const q2 = str(x.Q2)
    const q3 = str(x.Q3)
    lines.push({ position: num(x.position), driver: d.name, code: d.code, constructor: str(obj(x.Constructor)?.name) ?? 'Unknown constructor', q1, q2, q3, reached: q3 ? 3 : q2 ? 2 : q1 ? 1 : null })
  }
  return { season, round, race: str(race.raceName) ?? `Round ${round}`, circuit: str(obj(race.Circuit)?.circuitName) ?? 'Unknown circuit', lines }
}

// ---- a constructor's season ------------------------------------------------------------------------------------------------

export interface ConstructorRound {
  round: number
  race: string
  entries: { driver: string; position: number | null; positionText: string; grid: number | null; points: number; status: string }[]
  points: number
}

/** Jolpica `{season}/constructors/{id}/results.json`: both cars at every race, with the team's points per round. */
export function normalizeConstructorSeason(payload: unknown): ConstructorRound[] {
  const out: ConstructorRound[] = []
  for (const r of races(payload)) {
    const race = obj(r)
    const round = num(race?.round)
    if (!race || round === null) continue
    const entries = arr(race.Results)
      .map(obj)
      .filter((x): x is Json => x !== null)
      .map((x) => ({ driver: driverName(x.Driver).name, position: num(x.position), positionText: str(x.positionText) ?? '', grid: num(x.grid), points: num(x.points) ?? 0, status: str(x.status) ?? '' }))
    out.push({ round, race: str(race.raceName) ?? `Round ${round}`, entries, points: entries.reduce((t, e) => t + e.points, 0) })
  }
  return out.sort((a, b) => a.round - b.round)
}

// ---- team radio ------------------------------------------------------------------------------------------------------------

export interface RadioClip {
  driverNumber: number
  at: string
  url: string
}

const RADIO_HOST = /^https:\/\/livetiming\.formula1\.com\//

/** OpenF1 `team_radio`. Only addresses on F1's own live-timing host are kept, so a record can never point the player elsewhere. */
export function normalizeTeamRadio(payload: unknown): RadioClip[] {
  const out: RadioClip[] = []
  for (const raw of arr(payload)) {
    const x = obj(raw)
    const n = num(x?.driver_number)
    const at = str(x?.date)
    const url = str(x?.recording_url)
    if (n === null || !at || !url || !RADIO_HOST.test(url) || Number.isNaN(Date.parse(at))) continue
    out.push({ driverNumber: n, at, url })
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

// ---- forecast --------------------------------------------------------------------------------------------------------------

export interface Forecast {
  /** The hour the figures are for (UTC ISO). */
  at: string
  temperatureC: number | null
  rainChancePct: number | null
  windKph: number | null
  cloudPct: number | null
}

/** Open-Meteo hourly arrays -> the hour nearest `target`. Null when the target is outside what the forecast covers. */
export function pickForecast(payload: unknown, target: string): Forecast | null {
  const h = obj(obj(payload)?.hourly)
  const times = arr(h?.time)
  const t = Date.parse(target)
  if (!h || Number.isNaN(t) || times.length === 0) return null
  let best = -1
  let gap = Infinity
  times.forEach((x, i) => {
    const ms = Date.parse(`${String(x)}${String(x).endsWith('Z') ? '' : 'Z'}`)
    if (!Number.isNaN(ms) && Math.abs(ms - t) < gap) {
      gap = Math.abs(ms - t)
      best = i
    }
  })
  if (best < 0 || gap > 90 * 60_000) return null
  const at = (k: string): number | null => num(arr(h[k])[best])
  return { at: new Date(Date.parse(`${String(times[best])}${String(times[best]).endsWith('Z') ? '' : 'Z'}`)).toISOString(), temperatureC: at('temperature_2m'), rainChancePct: at('precipitation_probability'), windKph: at('wind_speed_10m'), cloudPct: at('cloud_cover') }
}

// ---- corners, estimated ----------------------------------------------------------------------------------------------------

export interface Corner {
  number: number
  x: number
  y: number
}

/**
 * Corner positions *estimated* from the shape of the lap. The providers publish no corner numbers, so this finds
 * where the path turns sharply and numbers those places in driving order from the start. It is a drawing aid: the
 * numbers will not always match the circuit's official ones, and the screen says so.
 */
export function estimateCorners(outline: { x: number; y: number }[], opts: { minTurnDeg?: number } = {}): Corner[] {
  const pts = outline.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  if (pts.length < 40) return []
  const minTurn = ((opts.minTurnDeg ?? 40) * Math.PI) / 180
  // Resample by arc length so a corner is judged by distance driven, not by how many samples fell in it.
  const seg: number[] = [0]
  for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  const total = seg[seg.length - 1]
  if (total <= 0) return []
  const N = 360
  const at = (d: number): { x: number; y: number } => {
    let lo = 0
    let hi = seg.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (seg[mid] <= d) lo = mid
      else hi = mid
    }
    const f = seg[hi] === seg[lo] ? 0 : (d - seg[lo]) / (seg[hi] - seg[lo])
    return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * f, y: pts[lo].y + (pts[hi].y - pts[lo].y) * f }
  }
  const res = Array.from({ length: N }, (_, i) => at((total * i) / N))
  const heading = (i: number): number => {
    const a = res[i % N]
    const b = res[(i + 1) % N]
    return Math.atan2(b.y - a.y, b.x - a.x)
  }
  // A lap is a loop; a trace that does not come back to its start is open, and its two ends are not a corner.
  const closed = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < total * 0.05
  const turn = (i: number): number => {
    if (!closed && (i % N === 0 || i % N === N - 1)) return 0
    let d = heading(i) - heading(i - 1 + N)
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    return d
  }
  // Turning accumulated over a short window, so a long sweeper counts once and a kink does not count at all.
  const W = 6
  const score: number[] = []
  for (let i = 0; i < N; i++) {
    let s = 0
    for (let k = 0; k < W; k++) s += turn(i + k)
    score.push(s)
  }
  const corners: Corner[] = []
  let i = 0
  while (i < N) {
    if (Math.abs(score[i]) >= minTurn) {
      let j = i
      let peak = i
      while (j < N && Math.abs(score[j]) >= minTurn * 0.6 && Math.sign(score[j]) === Math.sign(score[i])) {
        if (Math.abs(score[j]) > Math.abs(score[peak])) peak = j
        j++
      }
      const mid = res[(peak + (W >> 1)) % N]
      corners.push({ number: corners.length + 1, x: mid.x, y: mid.y })
      i = j + 3
    } else i++
  }
  return corners
}

// ---- what a profile keeps --------------------------------------------------------------------------------------------------

export interface F1Prefs {
  /** Driver ids (Jolpica) the person watches. */
  watchlist: string[]
  alerts: { sessions: boolean; results: boolean }
  /** Minutes before a session to say it is starting. */
  leadMinutes: number
}
export const emptyPrefs = (): F1Prefs => ({ watchlist: [], alerts: { sessions: true, results: true }, leadMinutes: 15 })

export function sanitizePrefs(raw: unknown): F1Prefs {
  const r = obj(raw) ?? {}
  const ids = arr(r.watchlist)
    .filter((x): x is string => typeof x === 'string' && /^[a-z0-9_]{1,60}$/.test(x))
    .slice(0, 50)
  const a = obj(r.alerts) ?? {}
  const lead = num(r.leadMinutes)
  return {
    watchlist: [...new Set(ids)],
    alerts: { sessions: typeof a.sessions === 'boolean' ? a.sessions : true, results: typeof a.results === 'boolean' ? a.results : true },
    leadMinutes: lead !== null && [5, 15, 30, 60].includes(lead) ? lead : 15
  }
}

// ---- a shareable report ----------------------------------------------------------------------------------------------------

export interface ReportSection {
  heading: string
  note?: string
  header?: string[]
  rows?: (string | number | null)[][]
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * One self-contained HTML page (no script, no external resource) that opens anywhere and prints cleanly to PDF.
 * Everything is escaped; a missing value is an em dash. It says where the data came from and when it was made.
 */
export function reportHtml(title: string, sections: ReportSection[], meta: { source: string; madeAt: string }): string {
  const body = sections
    .map((s) => {
      const table =
        s.header && s.rows
          ? `<table><thead><tr>${s.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${s.rows.map((r) => `<tr>${r.map((c) => `<td>${c === null || c === '' ? '—' : esc(String(c))}</td>`).join('')}</tr>`).join('')}</tbody></table>`
          : ''
      return `<section><h2>${esc(s.heading)}</h2>${s.note ? `<p class="n">${esc(s.note)}</p>` : ''}${table}</section>`
    })
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:14px/1.5 system-ui,Segoe UI,sans-serif;max-width:900px;margin:32px auto;padding:0 20px;color:#111}h1{font-size:22px}h2{font-size:16px;margin-top:26px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #ddd}th{background:#f3f3f3}.n,.f{color:#555;font-size:12px}@media print{body{margin:0}}</style></head><body><h1>${esc(title)}</h1>${body}<p class="f">Source: ${esc(meta.source)} · made with Orbis ${esc(meta.madeAt)}</p></body></html>`
}
