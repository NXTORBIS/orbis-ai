/**
 * The archive's yearly index (livetiming.formula1.com/static/{year}/Index.json) -> the sessions that can be replayed.
 */
type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

export interface ArchiveSession {
  year: number
  meeting: string
  country: string | null
  circuit: string | null
  name: string
  type: string | null
  /** Local start, as the archive gives it (no zone). */
  startDate: string | null
  /** The path the recorded feeds live under, "2026/2026-10-11_Singapore_Grand_Prix/2026-10-11_Race/". */
  path: string
}

export function normalizeArchiveIndex(payload: unknown): ArchiveSession[] {
  const root = obj(payload)
  const year = typeof root?.Year === 'number' ? root.Year : Number(root?.Year)
  const out: ArchiveSession[] = []
  for (const m of Array.isArray(root?.Meetings) ? (root.Meetings as unknown[]) : []) {
    const meeting = obj(m)
    if (!meeting) continue
    const circuit = obj(meeting.Circuit)
    const country = obj(meeting.Country)
    for (const s of Array.isArray(meeting.Sessions) ? (meeting.Sessions as unknown[]) : []) {
      const session = obj(s)
      const path = str(session?.Path)
      // Only paths of the shape the replay loader accepts; anything else is not offered.
      if (!session || !path || !/^\d{4}\/[\w.-]+\/[\w.-]+\/$/.test(path)) continue
      out.push({
        year: Number.isFinite(year) ? year : Number(path.slice(0, 4)),
        meeting: str(meeting.Name) ?? 'Meeting',
        country: str(country?.Name),
        circuit: str(circuit?.ShortName),
        name: str(session.Name) ?? 'Session',
        type: str(session.Type),
        startDate: str(session.StartDate),
        path
      })
    }
  }
  return out.sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))
}
