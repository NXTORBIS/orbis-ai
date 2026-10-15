import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { plainHandle } from '../ipc/handle.ts'
import type { BrowserWindow } from 'electron'
import { inspectWav } from '../../shared/neurova/audio.ts'
import { cacheKey, endingKind, estimateKey, estimateSections, loudnessLufsApprox, truePeakDb } from '../../shared/neurova/analysis.ts'
import { bandEnergy } from '../../shared/neurova/bands.ts'
import { diagnostics } from '../../shared/neurova/audit.ts'
import { canMove, setApproval, stateOf, type ApprovalState } from '../../shared/neurova/approval.ts'
import { rank, type Candidate, type Evidence } from '../../shared/neurova/candidates.ts'
import { understand, correct as correctIntent } from '../../shared/neurova/intent2.ts'
import { parseLyrics } from '../../shared/neurova/lyrics.ts'
import { add as addMemory, correct as correctMemory, rejectSuggestion, type Kind, type Scope } from '../../shared/neurova/memory.ts'
import { edit, proposePlan, undo, validate, type Edit } from '../../shared/neurova/plan.ts'
import { estimateTempo } from '../../shared/neurova/process.ts'
import { describeDiff, reviseBrief } from '../../shared/neurova/revision.ts'
import { searchProjects } from '../../shared/neurova/search.ts'
import { decodeWav } from '../../shared/neurova/wav.ts'
import { backupAll, restoreBackup, verifyBackup } from './backup.ts'
import { addToMusic, registerWithFiles, type FilesCatalogApi, type MusicImportApi } from './integrations.ts'
import type { NeurovaStore } from './store.ts'
import type { WorkspaceStore, Feedback } from './workspace.ts'

export interface Ipc2Options {
  store: NeurovaStore
  workspaces: WorkspaceStore
  getWindow(): BrowserWindow | null
  send(channel: string, ...args: unknown[]): void
  pick(kind: 'audio' | 'folder'): Promise<string | null>
  /** The real Orbis Music library; null while Music is not running. */
  music(): MusicImportApi | null
  /** The real Orbis Files catalogue; null while Files is not running. */
  filesCatalog(): FilesCatalogApi | null
}

const str = (v: unknown, n = 500): string => (typeof v === 'string' ? v.slice(0, n) : '')
const ANALYSER = 'neurova-deep'
const ANALYSER_VERSION = '1'

export function registerNeurovaIpc2(o: Ipc2Options): void {
  const handle = plainHandle(o)

  const project = async (id: unknown) => {
    const p = await o.store.get(str(id, 80))
    if (!p) throw new Error('That project no longer exists.')
    return p
  }

  handle('neurova:workspace', (_e, id) => o.workspaces.get(str(id, 80)))
  /** Raw audio of one stored artifact for the in-app player. Path comes only from the store; capped at 200 MB. */
  handle('neurova:audio-bytes', async (_e, id, artifactId) => {
    const p = await project(id)
    const a = p.artifacts.find((x) => x.id === str(artifactId, 80))
    if (!a) throw new Error('That audio is not part of this project.')
    const path = o.store.audioPathFor(p.id, a)
    if ((await stat(path)).size > 200 * 1024 * 1024) throw new Error('This audio file is larger than 200 MB and cannot be played here.')
    const b = await readFile(path)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  })

  handle('neurova:plan-propose', async (_e, id) => {
    const p = await project(id)
    const w = await o.workspaces.get(p.id)
    const doc = p.lyrics.trim() ? parseLyrics(p.lyrics) : null
    const intent = understand(p.brief, { lyrics: p.lyrics })
    const plan = proposePlan(doc, intent.instrumental === true)
    return o.workspaces.save({ ...w, plan, originalLyrics: w.originalLyrics ?? (p.lyrics || null) })
  })

  handle('neurova:plan-edit', async (_e, id, e) => {
    const w = await o.workspaces.get(str(id, 80))
    if (!w.plan) return { workspace: w, reason: 'There is no plan yet.' }
    const r = edit(w.plan, e as Edit)
    if (!r.ok) return { workspace: w, reason: r.reason }
    return { workspace: await o.workspaces.save({ ...w, plan: r.plan }), reason: null }
  })

  handle('neurova:plan-undo', async (_e, id) => {
    const w = await o.workspaces.get(str(id, 80))
    return w.plan ? o.workspaces.save({ ...w, plan: undo(w.plan) }) : w
  })

  handle('neurova:plan-findings', async (_e, id) => {
    const p = await project(id)
    const w = await o.workspaces.get(p.id)
    if (!w.plan) return []
    const doc = p.lyrics.trim() ? parseLyrics(p.lyrics) : null
    return validate(w.plan, doc, understand(p.brief, { lyrics: p.lyrics }).instrumental === true)
  })

  handle('neurova:feedback', async (_e, id, versionId, patch) => {
    const w = await o.workspaces.get(str(id, 80))
    const cur: Feedback = w.feedback[str(versionId, 80)] ?? { preference: null, rejected: false, finalist: false, note: '' }
    const p = (patch ?? {}) as Partial<Feedback>
    const next: Feedback = {
      preference: p.preference === 'strong' || p.preference === 'prefer' ? p.preference : p.preference === null ? null : cur.preference,
      rejected: typeof p.rejected === 'boolean' ? p.rejected : cur.rejected,
      finalist: typeof p.finalist === 'boolean' ? p.finalist : cur.finalist,
      note: typeof p.note === 'string' ? p.note.slice(0, 2000) : cur.note
    }
    return o.workspaces.save({ ...w, feedback: { ...w.feedback, [str(versionId, 80)]: next } })
  })

  handle('neurova:approve', async (_e, id, versionId, to, note) => {
    const p = await project(id)
    const v = p.versions.find((x) => x.id === str(versionId, 80))
    const a = v && p.artifacts.find((x) => x.id === v.artifactId)
    if (!v || !a) throw new Error('That version has no audio.')
    const w = await o.workspaces.get(p.id)
    const target = str(to, 12) as ApprovalState
    if (!canMove(stateOf(w.approvals, a.sha256), target)) throw new Error('That change of state is not allowed from where this version is.')
    const r = setApproval(w.approvals, a.sha256, target, Date.now(), undefined, str(note, 500) || undefined)
    if (!r.ok) throw new Error(r.reason)
    return o.workspaces.save({ ...w, approvals: r.record })
  })

  handle('neurova:dismiss', async (_e, id, diagId, on) => {
    const w = await o.workspaces.get(str(id, 80))
    const set = new Set(w.dismissed)
    if (on === false) set.delete(str(diagId, 80))
    else set.add(str(diagId, 80))
    return o.workspaces.save({ ...w, dismissed: [...set] })
  })

  /** Heavier measurements, computed from the stored audio and cached against the exact file and analyser version. */
  handle('neurova:deep-analysis', async (_e, id, artifactId) => {
    const p = await project(id)
    const a = p.artifacts.find((x) => x.id === str(artifactId, 80))
    if (!a) throw new Error('That audio is not part of this project.')
    const key = cacheKey({ sha256: a.sha256, analyzer: ANALYSER, version: ANALYSER_VERSION })
    const w = await o.workspaces.get(p.id)
    const hit = w.analysis[key]
    if (hit) return { cached: true, ...(hit as object) }
    const bytes = await readFile(o.store.audioPathFor(p.id, a))
    if (createHash('sha256').update(bytes).digest('hex') !== a.sha256) throw new Error('This audio file has changed since it was added.')
    const info = inspectWav(bytes)
    const d = decodeWav(bytes)
    if (!info.ok || !d) throw new Error(info.ok ? 'This file could not be decoded.' : info.reason)
    const tempo = estimateTempo(d)
    const ending = endingKind(d)
    const result = {
      info: info.info,
      tempo,
      key: estimateKey(d),
      sections: estimateSections(d),
      truePeak: truePeakDb(d),
      loudness: loudnessLufsApprox(d),
      bands: bandEnergy(d),
      ending,
      diagnostics: diagnostics(info.info, tempo, 'ok' in ending && ending.ok === false ? null : (ending as never))
    }
    await o.workspaces.save({ ...w, analysis: { ...w.analysis, [key]: result } })
    return { cached: false, ...result }
  })

  /** Ordering of versions by evidence that exists. Unknown is never a pass; nothing here scores musical quality. */
  handle('neurova:rank', async (_e, id) => {
    const p = await project(id)
    const w = await o.workspaces.get(p.id)
    const criteria = ['audio-valid', 'no-clipping', 'length-near-target']
    const evidence: Evidence[] = []
    const cands: Candidate[] = []
    for (const v of p.versions) {
      const a = p.artifacts.find((x) => x.id === v.artifactId)
      const fb = w.feedback[v.id]
      cands.push({ id: v.id, sha256: a?.sha256, preference: fb?.preference ?? null, rejected: fb?.rejected === true })
      if (!a) continue
      let valid: Evidence['status'] = 'unknown'
      let clip: Evidence['status'] = 'unknown'
      try {
        const info = inspectWav(await readFile(o.store.audioPathFor(p.id, a)))
        valid = info.ok ? 'verified' : 'violation'
        if (info.ok) clip = info.info.clippedSamples === 0 ? 'verified' : 'possible-deviation'
      } catch { /* missing file stays unknown */ }
      evidence.push({ candidate: v.id, criterion: 'audio-valid', status: valid })
      evidence.push({ candidate: v.id, criterion: 'no-clipping', status: clip })
      const target = w.plan?.targetSec
      evidence.push({ candidate: v.id, criterion: 'length-near-target', status: target ? (Math.abs(a.durationSec - target) / target <= 0.15 ? 'verified' : 'possible-deviation') : 'unknown' })
    }
    return { ranking: rank(cands, evidence, criteria, ['audio-valid']), evidence, criteria }
  })

  handle('neurova:search', async (_e, query, includeLyrics) => searchProjects(await o.store.list(), str(query, 200), { includeLyrics: includeLyrics === true, limit: 50 }))

  handle('neurova:understand', (_e, text, lyrics) => understand(str(text, 20000), { lyrics: str(lyrics, 50000) || undefined }))
  handle('neurova:correct-intent', (_e, text, correction) => correctIntent(understand(str(text, 20000)), str(correction, 500)))

  handle('neurova:revise', async (_e, id, request) => {
    const p = await project(id)
    const w = await o.workspaces.get(p.id)
    const base = understand(p.brief, { lyrics: p.lyrics })
    const locked = w.memory.records.filter((r) => r.status === 'active' && r.kind === 'hard-constraint').map((r) => r.text)
    const brief = reviseBrief({ base, request: str(request, 2000), locked })
    const next = understand(`${p.brief}. ${str(request, 2000)}`, { lyrics: p.lyrics })
    return { brief, diff: describeDiff(base, next) }
  })

  handle('neurova:memory', async (_e, id, op, a, b, c) => {
    const w = await o.workspaces.get(str(id, 80))
    const now = Date.now()
    const r =
      op === 'add' ? addMemory(w.memory, { scope: str(a, 12) as Scope, kind: str(b, 20) as Kind, text: str(c, 500), createdAt: now })
      : op === 'correct' ? correctMemory(w.memory, str(a, 40), str(b, 500), now)
      : rejectSuggestion(w.memory, str(a, 40))
    if (!r.ok) throw new Error(r.reason)
    return o.workspaces.save({ ...w, memory: r.memory })
  })

  handle('neurova:add-to-music', async (_e, id, versionId) => {
    const lib = o.music()
    if (!lib) return { ok: false, reason: 'Orbis Music is not running.' }
    const p = await project(id)
    const v = p.versions.find((x) => x.id === str(versionId, 80))
    const a = v && p.artifacts.find((x) => x.id === v.artifactId)
    if (!v || !a) return { ok: false, reason: 'That version has no audio.' }
    return addToMusic({ musicLibrary: lib, artifactPath: o.store.audioPathFor(p.id, a), sha256: a.sha256, title: `${p.title} - ${v.name}`, projectTitle: p.title, versionName: v.name }, { readFile })
  })

  handle('neurova:register-with-files', async (_e, id, versionId) => {
    const p = await project(id)
    const v = p.versions.find((x) => x.id === str(versionId, 80))
    const a = v && p.artifacts.find((x) => x.id === v.artifactId)
    if (!v || !a) return { ok: false, reason: 'That version has no audio.' }
    return registerWithFiles({ catalog: o.filesCatalog(), artifactPath: o.store.audioPathFor(p.id, a), sha256: a.sha256, projectTitle: p.title, versionName: v.name, brief: p.brief }, { readFile })
  })

  const storage = {
    listProjects: () => o.store.list(),
    writeProject: (pr: Awaited<ReturnType<NeurovaStore['list']>>[number]) => o.store.restoreProject(pr),
    audioDir: (projectId: string) => join(o.store.projectDir(projectId))
  }

  handle('neurova:backup', async () => {
    const folder = await o.pick('folder')
    if (!folder) return null
    const r = await backupAll(storage, folder)
    const v = await verifyBackup(r.dir)
    return { dir: r.dir, projects: r.manifest.projectIds.length, files: r.manifest.files.length, skipped: r.skipped, verified: v.ok }
  })

  handle('neurova:restore', async () => {
    const folder = await o.pick('folder')
    if (!folder) return null
    const v = await verifyBackup(folder)
    if (!v.ok) return { ok: false, reason: v.problem ?? 'The backup did not verify.', missing: v.missing, corrupt: v.corrupt, restored: [] }
    const r = await restoreBackup(folder, storage)
    return { ok: r.ok, reason: r.reason ?? null, missing: [], corrupt: [], restored: r.restored }
  })
}
