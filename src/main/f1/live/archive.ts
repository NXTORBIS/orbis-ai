/**
 * The recorded form of the same feeds: one text file per feed per session, each line a time offset and a change.
 *
 *   00:03:10.603{"Status":"1","Message":"AllClear"}
 *
 * Reading these lets a finished session be replayed through exactly the code that handles a live one, and gives the
 * merge and the snapshot real recorded changes to be tested against. Two of the feeds (`CarData.z`, `Position.z`) are
 * compressed: base64 of a raw deflate stream holding JSON.
 */
import { inflateRawSync } from 'node:zlib'

export interface TimedChange {
  /** Milliseconds from the start of the recording. */
  t: number
  data: unknown
}

/** "01:09:00.051" -> 4140051. Null for anything that is not that shape. */
export function parseOffset(text: string): number | null {
  const m = /^(\d+):(\d{2}):(\d{2})\.(\d{3})$/.exec(text)
  if (!m) return null
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4])
}

/** Parses a whole .jsonStream file. Unreadable lines are skipped, not fatal; the byte-order mark is ignored. */
export function parseJsonStream(text: string): TimedChange[] {
  const out: TimedChange[] = []
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (const line of body.split(/\r?\n/)) {
    if (line.length < 13) continue
    const t = parseOffset(line.slice(0, 12))
    if (t === null) continue
    const rest = line.slice(12)
    try {
      out.push({ t, data: JSON.parse(rest) })
    } catch {
      // a damaged line; the rest of the file is still good
    }
  }
  return out
}

/** Decodes one compressed feed value (a JSON string of base64 deflate) into the JSON it holds, or null. */
export function decodeCompressed(value: unknown): unknown {
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(inflateRawSync(Buffer.from(value, 'base64')).toString('utf8'))
  } catch {
    return null
  }
}

/** A car's position on the circuit, in the feed's own units (roughly tenths of a metre). */
export interface CarPoint {
  /** Milliseconds from the start of the recording. */
  t: number
  x: number
  y: number
  z: number
  onTrack: boolean
}

export interface CarTelemetryPoint {
  t: number
  speed: number | null
  rpm: number | null
  gear: number | null
  throttle: number | null
  brake: number | null
  /** 0..14 as the feed encodes it; 10, 12 and 14 mean the flap is open. */
  drs: number | null
}

const UTC_MS = (iso: unknown): number | null => {
  if (typeof iso !== 'string') return null
  const n = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`)
  return Number.isFinite(n) ? n : null
}

/**
 * Position.z -> points per car. Each stream line holds a batch of timestamped entries; the first entry of a batch is
 * placed at the line's offset and the rest keep their real spacing from it.
 */
export function carPointsFrom(changes: TimedChange[]): Map<string, CarPoint[]> {
  const cars = new Map<string, CarPoint[]>()
  for (const c of changes) {
    const decoded = decodeCompressed(c.data) as { Position?: { Timestamp?: unknown; Entries?: Record<string, { Status?: string; X?: number; Y?: number; Z?: number }> }[] } | null
    const batch = decoded?.Position
    if (!Array.isArray(batch)) continue
    const first = UTC_MS(batch[0]?.Timestamp)
    for (const entry of batch) {
      const at = UTC_MS(entry.Timestamp)
      const t = c.t + (first !== null && at !== null ? at - first : 0)
      for (const [number, p] of Object.entries(entry.Entries ?? {})) {
        if (typeof p.X !== 'number' || typeof p.Y !== 'number') continue
        let arr = cars.get(number)
        if (!arr) cars.set(number, (arr = []))
        arr.push({ t, x: p.X, y: p.Y, z: typeof p.Z === 'number' ? p.Z : 0, onTrack: p.Status === 'OnTrack' })
      }
    }
  }
  return cars
}

export function carTelemetryFrom(changes: TimedChange[]): Map<string, CarTelemetryPoint[]> {
  const cars = new Map<string, CarTelemetryPoint[]>()
  for (const c of changes) {
    const decoded = decodeCompressed(c.data) as { Entries?: { Utc?: unknown; Cars?: Record<string, { Channels?: Record<string, number> }> }[] } | null
    const batch = decoded?.Entries
    if (!Array.isArray(batch)) continue
    const first = UTC_MS(batch[0]?.Utc)
    for (const entry of batch) {
      const at = UTC_MS(entry.Utc)
      const t = c.t + (first !== null && at !== null ? at - first : 0)
      for (const [number, car] of Object.entries(entry.Cars ?? {})) {
        const ch = car.Channels ?? {}
        let arr = cars.get(number)
        if (!arr) cars.set(number, (arr = []))
        const n = (k: string): number | null => (typeof ch[k] === 'number' ? ch[k] : null)
        arr.push({ t, rpm: n('0'), speed: n('2'), gear: n('3'), throttle: n('4'), brake: n('5'), drs: n('45') })
      }
    }
  }
  return cars
}

/** Index of the last point at or before `t` (binary search), or -1 when every point is later. */
export function lastAtOrBefore(points: { t: number }[], t: number): number {
  let lo = 0
  let hi = points.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].t <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}
