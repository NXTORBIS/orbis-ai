// NEUROVA projects: a brief, the audio kept for it, and versions that point at that audio.
// Nothing here edits audio or removes a version's source; every change adds a record.

export interface Artifact {
  id: string
  /** Path relative to the project's own folder. Never absolute, never contains `..`. */
  file: string
  sha256: string
  bytes: number
  durationSec: number
  sampleRate: number
  channels: number
  bitDepth: number
  /** Where the audio came from. `generated` is reserved for an engine that has really produced it. */
  source: 'imported' | 'generated'
  createdAt: number
}

export interface Version {
  id: string
  name: string
  artifactId: string
  parentId: string | null
  kind: 'first' | 'revision' | 'restore'
  /** What was asked for this version, in the user's own words. */
  note: string
  createdAt: number
}

export interface Project {
  id: string
  title: string
  /** The original brief, kept exactly as typed. */
  brief: string
  lyrics: string
  createdAt: number
  updatedAt: number
  artifacts: Artifact[]
  versions: Version[]
  selectedVersionId: string | null
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export const safeRelative = (p: string): boolean =>
  p.length > 0 && p.length < 260 && !/^([a-zA-Z]:|[\\/])/.test(p) && !p.split(/[\\/]/).some((s) => s === '..' || s === '') && !/[<>:"|?*\0]/.test(p)

export function newProject(id: string, title: string, brief = '', lyrics = '', now = Date.now()): Project {
  return { id, title: title.trim().slice(0, 120) || 'Untitled song', brief, lyrics, createdAt: now, updatedAt: now, artifacts: [], versions: [], selectedVersionId: null }
}

export function normalizeProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id, 80)
  if (!id) return null
  const artifacts = (Array.isArray(r.artifacts) ? r.artifacts : [])
    .map((a): Artifact | null => {
      const o = (a ?? {}) as Record<string, unknown>
      const file = str(o.file, 260)
      const aid = str(o.id, 80)
      if (!aid || !safeRelative(file)) return null
      return { id: aid, file, sha256: str(o.sha256, 64), bytes: num(o.bytes), durationSec: num(o.durationSec), sampleRate: num(o.sampleRate), channels: num(o.channels), bitDepth: num(o.bitDepth), source: o.source === 'generated' ? 'generated' : 'imported', createdAt: num(o.createdAt) }
    })
    .filter((a): a is Artifact => a !== null)
  const known = new Set(artifacts.map((a) => a.id))
  const versions = (Array.isArray(r.versions) ? r.versions : [])
    .map((x): Version | null => {
      const o = (x ?? {}) as Record<string, unknown>
      const vid = str(o.id, 80)
      const artifactId = str(o.artifactId, 80)
      if (!vid || !known.has(artifactId)) return null
      const kind = o.kind === 'revision' || o.kind === 'restore' ? o.kind : 'first'
      return { id: vid, name: str(o.name, 120) || 'Version', artifactId, parentId: typeof o.parentId === 'string' ? o.parentId : null, kind, note: str(o.note, 2000), createdAt: num(o.createdAt) }
    })
    .filter((v): v is Version => v !== null)
  const sel = str(r.selectedVersionId, 80)
  return {
    id,
    title: str(r.title, 120) || 'Untitled song',
    brief: str(r.brief, 20000),
    lyrics: str(r.lyrics, 50000),
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
    artifacts,
    versions,
    selectedVersionId: versions.some((v) => v.id === sel) ? sel : null
  }
}

export interface AddInput { versionId: string; name?: string; note?: string; artifact: Artifact; now?: number }

/** Adds audio as a new version. The previous selection stays as the parent; nothing is overwritten. */
export function addVersion(p: Project, i: AddInput): Project {
  const now = i.now ?? Date.now()
  const parentId = p.selectedVersionId
  const dup = p.artifacts.find((a) => a.sha256 && a.sha256 === i.artifact.sha256)
  const artifact = dup ?? i.artifact
  const v: Version = {
    id: i.versionId,
    name: (i.name ?? '').trim().slice(0, 120) || `Version ${p.versions.length + 1}`,
    artifactId: artifact.id,
    parentId,
    kind: parentId ? 'revision' : 'first',
    note: (i.note ?? '').slice(0, 2000),
    createdAt: now
  }
  return {
    ...p,
    artifacts: dup ? p.artifacts : [...p.artifacts, artifact],
    versions: [...p.versions, v],
    selectedVersionId: v.id,
    updatedAt: now
  }
}

/** Going back adds a new version pointing at the older audio. Later versions are left alone. */
export function restoreVersion(p: Project, sourceId: string, newId: string, now = Date.now()): Project {
  const src = p.versions.find((v) => v.id === sourceId)
  if (!src) return p
  const v: Version = { id: newId, name: `${src.name} (restored)`, artifactId: src.artifactId, parentId: p.selectedVersionId, kind: 'restore', note: `Restored from "${src.name}".`, createdAt: now }
  return { ...p, versions: [...p.versions, v], selectedVersionId: v.id, updatedAt: now }
}

export function selectVersion(p: Project, id: string, now = Date.now()): Project {
  return p.versions.some((v) => v.id === id) ? { ...p, selectedVersionId: id, updatedAt: now } : p
}

/** Removes a version record. Audio no version uses any more is reported so the store can delete exactly that. */
export function removeVersion(p: Project, id: string, now = Date.now()): { project: Project; orphaned: Artifact[] } {
  if (!p.versions.some((v) => v.id === id)) return { project: p, orphaned: [] }
  const target = p.versions.find((v) => v.id === id)!
  const versions = p.versions.filter((v) => v.id !== id).map((v) => (v.parentId === id ? { ...v, parentId: target.parentId } : v))
  const used = new Set(versions.map((v) => v.artifactId))
  const orphaned = p.artifacts.filter((a) => !used.has(a.id))
  return {
    project: {
      ...p,
      versions,
      artifacts: p.artifacts.filter((a) => used.has(a.id)),
      selectedVersionId: p.selectedVersionId === id ? (versions[versions.length - 1]?.id ?? null) : p.selectedVersionId,
      updatedAt: now
    },
    orphaned
  }
}

export interface Difference { field: string; a: string | number; b: string | number }

/** Only facts stored for both artifacts are compared; a missing value is not treated as zero. */
export function compareArtifacts(a: Artifact, b: Artifact): Difference[] {
  const out: Difference[] = []
  const f = (field: string, x: string | number, y: string | number): void => { if (x !== y) out.push({ field, a: x, b: y }) }
  f('duration', +a.durationSec.toFixed(2), +b.durationSec.toFixed(2))
  f('sampleRate', a.sampleRate, b.sampleRate)
  f('channels', a.channels, b.channels)
  f('bitDepth', a.bitDepth, b.bitDepth)
  f('bytes', a.bytes, b.bytes)
  return out
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

/** A name that is safe on Windows. The title itself stays as typed in the project. */
export function safeFileName(title: string, ext: string): string {
  let base = title.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').replace(/^\.+/, '').trim().slice(0, 100)
  if (!base || RESERVED.test(base)) base = `song-${base || 'export'}`
  return `${base}.${ext.replace(/[^a-z0-9]/gi, '').toLowerCase()}`
}
