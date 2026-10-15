/**
 * Lap and sector times. One place, so the table, the cards and any export say the same thing.
 *
 * Times travel as seconds (a number) and are only turned into text at the edge. Comparing "1:36.201" with "59.9" as
 * strings sorts them wrongly, which is the mistake this file exists to prevent.
 */

/** "1:36.201" for 96.201 s; "59.900" under a minute; "–" for a missing time. Millisecond precision is kept. */
export function formatLapTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '–'
  const totalMs = Math.round(seconds * 1000)
  const minutes = Math.floor(totalMs / 60000)
  const rest = totalMs - minutes * 60000
  const secs = Math.floor(rest / 1000)
  const ms = rest - secs * 1000
  const tail = `${String(secs).padStart(minutes > 0 ? 2 : 1, '0')}.${String(ms).padStart(3, '0')}`
  return minutes > 0 ? `${minutes}:${tail}` : tail
}

/** Parses "1:36.201", "59.9", or "1:42:00.785" (a race time) to seconds. Anything else is null, never 0. */
export function parseLapTime(text: string | null | undefined): number | null {
  if (typeof text !== 'string') return null
  const t = text.trim()
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null
  const parts = t.split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return null
  return parts.reduce((total, n) => total * 60 + n, 0)
}

/**
 * A difference to a reference time, with an explicit sign: "+0.312" is slower than the reference, "-0.150" faster.
 * Null when either side is missing: a delta against nothing is not zero.
 */
export function formatDelta(seconds: number | null | undefined, reference: number | null | undefined): string {
  if (seconds === null || seconds === undefined || reference === null || reference === undefined) return '–'
  if (!Number.isFinite(seconds) || !Number.isFinite(reference)) return '–'
  const d = Math.round((seconds - reference) * 1000) / 1000
  if (d === 0) return '0.000'
  return `${d > 0 ? '+' : '-'}${Math.abs(d).toFixed(3)}`
}

/** Ascending, with missing values last whichever way it is read. */
export function compareTimes(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((x, y) => x - y)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((t, v) => t + v, 0) / values.length : null
}
