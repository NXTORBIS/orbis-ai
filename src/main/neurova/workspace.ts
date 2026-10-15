import { Collection, personalFile } from '../storage/jsonFile.ts'
import { DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'
import type { ApprovalRecord } from '../../shared/neurova/approval.ts'
import { emptyMemory, importMemory, exportMemory, type Memory } from '../../shared/neurova/memory.ts'
import type { Plan } from '../../shared/neurova/plan.ts'

export interface Feedback { preference: 'strong' | 'prefer' | null; rejected: boolean; finalist: boolean; note: string }

export interface ExportRecord { at: number; versionId: string; path: string; format: string }

/** Everything about a project that is not the audio or its versions: the plan, decisions, feedback, approvals. */
export interface Workspace {
  /** The project id this belongs to. */
  id: string
  plan: Plan | null
  memory: Memory
  /** Keyed by version id. */
  feedback: Record<string, Feedback>
  /** Keyed by artifact sha256, so an approval stays with the exact audio it was given to. */
  approvals: ApprovalRecord
  dismissed: string[]
  exports: ExportRecord[]
  /** Results of expensive analysis, keyed by `analysis.cacheKey`. A changed file or analyser has a different key. */
  analysis: Record<string, unknown>
  originalLyrics: string | null
  updatedAt: number
}

const str = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '')

export function emptyWorkspace(id: string): Workspace {
  return { id, plan: null, memory: emptyMemory(), feedback: {}, approvals: {}, dismissed: [], exports: [], analysis: {}, originalLyrics: null, updatedAt: 0 }
}

export function normalizeWorkspace(raw: unknown): Workspace | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id, 80)
  if (!id) return null
  const base = emptyWorkspace(id)
  const fb: Record<string, Feedback> = {}
  for (const [k, v] of Object.entries((r.feedback ?? {}) as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    fb[str(k, 80)] = { preference: o.preference === 'strong' || o.preference === 'prefer' ? o.preference : null, rejected: o.rejected === true, finalist: o.finalist === true, note: str(o.note, 2000) }
  }
  const approvals: ApprovalRecord = {}
  for (const [k, v] of Object.entries((r.approvals ?? {}) as Record<string, unknown>)) {
    const o = v as Record<string, unknown> | null
    if (/^[0-9a-f]{64}$/.test(k) && o && ['draft', 'review', 'approved', 'exported'].includes(String(o.state))) {
      approvals[k] = { state: o.state as 'draft', at: typeof o.at === 'number' ? o.at : 0, by: typeof o.by === 'string' ? o.by.slice(0, 80) : undefined, note: typeof o.note === 'string' ? o.note.slice(0, 500) : undefined }
    }
  }
  const memory = typeof r.memory === 'object' && r.memory ? importMemory(JSON.stringify(r.memory)).memory : base.memory
  const exports = (Array.isArray(r.exports) ? r.exports : []).slice(-200).flatMap((e): ExportRecord[] => {
    const o = e as Record<string, unknown>
    return o && typeof o.path === 'string' && typeof o.versionId === 'string' ? [{ at: Number(o.at) || 0, versionId: o.versionId.slice(0, 80), path: o.path.slice(0, 500), format: str(o.format, 12) }] : []
  })
  const plan = r.plan && typeof r.plan === 'object' && Array.isArray((r.plan as Plan).sections) ? (r.plan as Plan) : null
  return {
    id, plan, memory, feedback: fb, approvals,
    dismissed: (Array.isArray(r.dismissed) ? r.dismissed : []).filter((x): x is string => typeof x === 'string').slice(0, 200),
    exports,
    analysis: r.analysis && typeof r.analysis === 'object' ? (r.analysis as Record<string, unknown>) : {},
    originalLyrics: typeof r.originalLyrics === 'string' ? r.originalLyrics.slice(0, 50000) : null,
    updatedAt: Number(r.updatedAt) || 0
  }
}

export class WorkspaceStore {
  private readonly items: Collection<Workspace>
  private readonly userData: string

  constructor(userData: string) {
    this.userData = userData
    this.items = new Collection<Workspace>(personalFile(userData, DEFAULT_PROFILE_ID, 'neurova-workspaces.json'), normalizeWorkspace, 500)
  }

  async useProfile(profileId: string): Promise<void> {
    await this.items.usePath(personalFile(this.userData, profileId, 'neurova-workspaces.json'))
  }

  async get(projectId: string): Promise<Workspace> {
    return (await this.items.get(projectId)) ?? emptyWorkspace(projectId)
  }

  async save(w: Workspace): Promise<Workspace> {
    const trimmed = Object.keys(w.analysis).length > 60 ? Object.fromEntries(Object.entries(w.analysis).slice(-60)) : w.analysis
    return this.items.put({ ...w, analysis: trimmed, updatedAt: Date.now() })
  }

  remove(projectId: string): Promise<boolean> { return this.items.remove(projectId) }
  flush(): Promise<void> { return this.items.flush() }
  exportMemory(w: Workspace): string { return exportMemory(w.memory) }
}
