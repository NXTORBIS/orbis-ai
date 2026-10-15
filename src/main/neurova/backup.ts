// Backup and restore of every project in a profile. Reads and copies; never edits the live projects or their audio.
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { Project } from '../../shared/neurova/project.ts'

export const BACKUP_SCHEMA = 1

export interface BackupStorage {
  listProjects(): Promise<Project[]>
  writeProject(p: Project): Promise<void>
  /** The folder holding a project's audio (artifact.file is relative to it). */
  audioDir(projectId: string): string
}

export interface ManifestFile { path: string; sha256: string; bytes: number; projectId: string }
export interface Manifest { schema: number; createdAt: number; projectIds: string[]; files: ManifestFile[] }

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')
const unsafe = (p: unknown): boolean =>
  typeof p !== 'string' || p.length === 0 || /^([a-zA-Z]:|[\\/])/.test(p) || p.split(/[\\/]/).some((s) => s === '..' || s === '' || s === '.')
const validId = (id: unknown): boolean => typeof id === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(id)
const dateStamp = (t: number): string => new Date(t).toISOString().slice(0, 10)

export async function backupAll(storage: BackupStorage, parent: string, now = Date.now()): Promise<{ dir: string; manifest: Manifest; skipped: string[] }> {
  const projects = await storage.listProjects()
  let dir = join(parent, `neurova-backup-${dateStamp(now)}`)
  for (let n = 2; await stat(dir).then(() => true, () => false); n++) dir = join(parent, `neurova-backup-${dateStamp(now)}-${n}`)
  await mkdir(join(dir, 'projects'), { recursive: true })
  const files: ManifestFile[] = []
  const skipped: string[] = []
  for (const p of projects) {
    if (!validId(p.id)) { skipped.push(String(p.id)); continue }
    const json = Buffer.from(JSON.stringify(p, null, 2))
    await writeFile(join(dir, 'projects', `${p.id}.json`), json)
    files.push({ path: `projects/${p.id}.json`, sha256: sha(json), bytes: json.length, projectId: p.id })
    for (const a of p.artifacts) {
      if (unsafe(a.file)) { skipped.push(`${p.id}/${a.file}`); continue }
      try {
        const bytes = await readFile(join(storage.audioDir(p.id), a.file))
        const rel = `audio/${p.id}/${a.file.replace(/\\/g, '/')}`
        const target = join(dir, ...rel.split('/'))
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, bytes)
        files.push({ path: rel, sha256: sha(bytes), bytes: bytes.length, projectId: p.id })
      } catch { skipped.push(`${p.id}/${a.file}`) }
    }
  }
  const manifest: Manifest = { schema: BACKUP_SCHEMA, createdAt: now, projectIds: projects.filter((p) => validId(p.id)).map((p) => p.id), files }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return { dir, manifest, skipped }
}

export interface VerifyReport { ok: boolean; manifest?: Manifest; problem?: string; missing: string[]; corrupt: string[]; extra: string[]; unsafe: string[] }

async function walk(root: string, rel = ''): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await walk(root, r)))
    else out.push(r)
  }
  return out
}

export async function verifyBackup(dir: string): Promise<VerifyReport> {
  const rep: VerifyReport = { ok: false, missing: [], corrupt: [], extra: [], unsafe: [] }
  let manifest: Manifest
  try {
    manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Manifest
  } catch { rep.problem = 'The backup has no readable manifest.'; return rep }
  if (manifest?.schema !== BACKUP_SCHEMA || !Array.isArray(manifest.files) || !Array.isArray(manifest.projectIds)) { rep.problem = 'The backup is from an unknown version.'; return rep }
  rep.manifest = manifest
  const root = resolve(dir)
  const listed = new Set<string>()
  for (const f of manifest.files) {
    if (unsafe(f?.path) || !resolve(root, f.path).startsWith(root + sep)) { rep.unsafe.push(String(f?.path)); continue }
    listed.add(f.path)
    try {
      const b = await readFile(join(root, f.path))
      if (sha(b) !== f.sha256 || b.length !== f.bytes) rep.corrupt.push(f.path)
    } catch { rep.missing.push(f.path) }
  }
  try {
    for (const p of await walk(root)) if (p !== 'manifest.json' && !listed.has(p)) rep.extra.push(p)
  } catch { /* an unreadable folder shows up as missing files */ }
  rep.ok = !rep.missing.length && !rep.corrupt.length && !rep.unsafe.length && !rep.extra.length
  return rep
}

export interface RestoreReport { ok: boolean; reason?: string; restored: Array<{ from: string; to: string }>; refused: string[] }

/** Restores each project whose own files verify; an id that already exists is restored under a new id. */
export async function restoreBackup(dir: string, target: BackupStorage, newId: (old: string) => string = (o) => `${o}-r${Math.random().toString(36).slice(2, 8)}`): Promise<RestoreReport> {
  const v = await verifyBackup(dir)
  const out: RestoreReport = { ok: false, restored: [], refused: [] }
  if (!v.manifest) { out.reason = v.problem; return out }
  if (v.unsafe.length) { out.reason = 'The backup lists paths outside itself, so nothing was restored.'; out.refused = v.unsafe; return out }
  const bad = new Set([...v.missing, ...v.corrupt])
  const existing = new Set((await target.listProjects()).map((p) => p.id))
  for (const id of v.manifest.projectIds) {
    if (!validId(id)) { out.refused.push(String(id)); continue }
    const mine = v.manifest.files.filter((f) => f.projectId === id)
    const hit = mine.filter((f) => bad.has(f.path))
    if (!mine.some((f) => f.path === `projects/${id}.json`) || hit.length) { out.refused.push(...(hit.length ? hit.map((f) => f.path) : [id])); continue }
    const project = JSON.parse(await readFile(join(dir, 'projects', `${id}.json`), 'utf8')) as Project
    let to = id
    while (existing.has(to)) to = newId(id)
    existing.add(to)
    for (const f of mine) {
      if (!f.path.startsWith('audio/')) continue
      const rel = f.path.split('/').slice(2).join('/')
      const dest = join(target.audioDir(to), ...rel.split('/'))
      await mkdir(dirname(dest), { recursive: true })
      await copyFile(join(dir, ...f.path.split('/')), dest)
    }
    await target.writeProject({ ...project, id: to })
    out.restored.push({ from: id, to })
  }
  out.ok = out.restored.length > 0 && out.refused.length === 0
  if (!out.ok && !out.reason) out.reason = out.refused.length ? 'Some files were damaged or missing and were not restored.' : 'There was nothing to restore.'
  return out
}
