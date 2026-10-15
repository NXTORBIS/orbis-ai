// Project-scoped creative memory as pure reducers. History is never deleted, only superseded.

export type Scope = 'candidate' | 'version' | 'project'
export type Kind = 'hard-constraint' | 'soft-preference' | 'observation' | 'suggestion' | 'decision'
export type Status = 'active' | 'superseded' | 'rejected'
export interface MemoryRecord { id: string; scope: Scope; kind: Kind; text: string; status: Status; createdAt: number; supersedes?: string }
export interface Memory { version: 1; records: MemoryRecord[]; rejectedSuggestions: string[] }
export type Result = { ok: true; memory: Memory; id?: string } | { ok: false; memory: Memory; reason: string }

const SCOPES: Scope[] = ['candidate', 'version', 'project']
const KINDS: Kind[] = ['hard-constraint', 'soft-preference', 'observation', 'suggestion', 'decision']
const STATUSES: Status[] = ['active', 'superseded', 'rejected']
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

export const emptyMemory = (): Memory => ({ version: 1, records: [], rejectedSuggestions: [] })
const nextId = (m: Memory) => 'm' + (m.records.length + 1)

export function add(m: Memory, r: { scope: Scope; kind: Kind; text: string; createdAt: number }): Result {
  if (!SCOPES.includes(r.scope) || !KINDS.includes(r.kind)) return { ok: false, memory: m, reason: 'Unknown scope or kind.' }
  if (!r.text.trim()) return { ok: false, memory: m, reason: 'Empty text.' }
  if (r.kind === 'suggestion' && m.rejectedSuggestions.includes(norm(r.text))) return { ok: false, memory: m, reason: 'This suggestion was rejected before and will not be offered again.' }
  const id = nextId(m)
  return { ok: true, id, memory: { ...m, records: [...m.records, { id, scope: r.scope, kind: r.kind, text: r.text.trim(), status: 'active', createdAt: r.createdAt }] } }
}

export function correct(m: Memory, id: string, text: string, createdAt: number): Result {
  const old = m.records.find((x) => x.id === id)
  if (!old) return { ok: false, memory: m, reason: 'No such record.' }
  if (old.status !== 'active') return { ok: false, memory: m, reason: 'Only an active record can be corrected.' }
  if (!text.trim()) return { ok: false, memory: m, reason: 'Empty text.' }
  const nid = nextId(m)
  const records = m.records.map((x) => (x.id === id ? { ...x, status: 'superseded' as Status } : x))
  records.push({ id: nid, scope: old.scope, kind: old.kind, text: text.trim(), status: 'active', createdAt, supersedes: id })
  return { ok: true, id: nid, memory: { ...m, records } }
}

export function rejectSuggestion(m: Memory, id: string): Result {
  const r = m.records.find((x) => x.id === id)
  if (!r) return { ok: false, memory: m, reason: 'No such record.' }
  if (r.kind !== 'suggestion') return { ok: false, memory: m, reason: 'Only suggestions can be rejected.' }
  const n = norm(r.text)
  return { ok: true, memory: { ...m, records: m.records.map((x) => (x.id === id ? { ...x, status: 'rejected' as Status } : x)), rejectedSuggestions: m.rejectedSuggestions.includes(n) ? m.rejectedSuggestions : [...m.rejectedSuggestions, n] } }
}

export const active = (m: Memory, scope?: Scope): MemoryRecord[] => m.records.filter((r) => r.status === 'active' && (scope === undefined || r.scope === scope))

export interface Influence { id: string; text: string; kind: Kind; why: string }
/** Which active records plausibly shaped a compiled request. Matching is by shared words, so it is an explanation, not proof. */
export function explainInfluence(m: Memory, compiledText: string): Influence[] {
  const hay = ' ' + norm(compiledText) + ' '
  const out: Influence[] = []
  for (const r of active(m)) {
    if (r.kind === 'observation') continue
    const words = norm(r.text).split(' ').filter((w) => w.length > 3)
    const hit = words.filter((w) => hay.includes(' ' + w))
    if (hit.length && hit.length >= Math.ceil(words.length / 2)) out.push({ id: r.id, text: r.text, kind: r.kind, why: 'Shares "' + hit.join('", "') + '" with the compiled request.' })
    else if (r.kind === 'hard-constraint') out.push({ id: r.id, text: r.text, kind: r.kind, why: 'Hard constraint applied to every request in scope; not found as wording in the compiled text.' })
  }
  return out
}

export const exportMemory = (m: Memory): string => JSON.stringify(m)

export function importMemory(json: string): { memory: Memory; rejected: { index: number; reason: string }[]; error?: string } {
  const memory = emptyMemory()
  const rejected: { index: number; reason: string }[] = []
  let data: unknown
  try { data = JSON.parse(json) } catch { return { memory, rejected, error: 'Not valid JSON.' } }
  const o = data as { version?: unknown; records?: unknown; rejectedSuggestions?: unknown }
  if (!o || typeof o !== 'object' || o.version !== 1 || !Array.isArray(o.records)) return { memory, rejected, error: 'Unrecognised memory format.' }
  const ids = new Set<string>()
  o.records.forEach((x, index) => {
    const r = x as Partial<MemoryRecord> | null
    const bad = (reason: string) => rejected.push({ index, reason })
    if (!r || typeof r !== 'object') return bad('Not an object.')
    if (typeof r.id !== 'string' || !r.id) return bad('Missing id.')
    if (ids.has(r.id)) return bad('Duplicate id.')
    if (!SCOPES.includes(r.scope as Scope)) return bad('Unknown scope.')
    if (!KINDS.includes(r.kind as Kind)) return bad('Unknown kind.')
    if (!STATUSES.includes(r.status as Status)) return bad('Unknown status.')
    if (typeof r.text !== 'string' || !r.text.trim()) return bad('Missing text.')
    if (typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt)) return bad('Bad createdAt.')
    if (r.supersedes !== undefined && typeof r.supersedes !== 'string') return bad('Bad supersedes.')
    ids.add(r.id)
    memory.records.push({ id: r.id, scope: r.scope as Scope, kind: r.kind as Kind, text: r.text, status: r.status as Status, createdAt: r.createdAt, ...(r.supersedes ? { supersedes: r.supersedes } : {}) })
  })
  if (Array.isArray(o.rejectedSuggestions)) memory.rejectedSuggestions = o.rejectedSuggestions.filter((s): s is string => typeof s === 'string')
  for (const r of memory.records) if (r.status === 'rejected' && r.kind === 'suggestion' && !memory.rejectedSuggestions.includes(norm(r.text))) memory.rejectedSuggestions.push(norm(r.text))
  return { memory, rejected }
}
