import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { inspectWav, MAX_WAV_BYTES, type AudioInfo } from '../../shared/neurova/audio.ts'
import { applyOp, envelope, estimateTempo, type Op, type Tempo } from '../../shared/neurova/process.ts'
import { decodeWav, encodeWav16 } from '../../shared/neurova/wav.ts'
import {
  addVersion, newProject, normalizeProject, removeVersion, restoreVersion, safeFileName, safeRelative, selectVersion,
  type Artifact, type Project
} from '../../shared/neurova/project.ts'
import { Collection, personalFile, profileFile } from '../storage/jsonFile.ts'
import { DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'

const MAX_PACKAGE_FILES = 500

export class NeurovaStore {
  private readonly projects: Collection<Project>
  private profileId = DEFAULT_PROFILE_ID

  private readonly userData: string

  constructor(userData: string) {
    this.userData = userData
    this.projects = new Collection<Project>(personalFile(userData, DEFAULT_PROFILE_ID, 'neurova-projects.json'), normalizeProject, 500)
  }

  async useProfile(profileId: string): Promise<void> {
    this.profileId = profileId
    await this.projects.usePath(personalFile(this.userData, profileId, 'neurova-projects.json'))
  }

  onChange(l: () => void): () => void { return this.projects.onChange(l) }
  flush(): Promise<void> { return this.projects.flush() }

  private dir(projectId: string): string {
    if (!/^[A-Za-z0-9-]{1,80}$/.test(projectId)) throw new Error('Not a project.')
    return profileFile(this.userData, this.profileId, 'neurova', projectId)
  }

  /** A project's audio file, refused if it would resolve anywhere outside the project's own folder. */
  private audioPath(projectId: string, artifact: Artifact): string {
    const root = resolve(this.dir(projectId))
    const full = resolve(root, artifact.file)
    if (!safeRelative(artifact.file) || !full.startsWith(root + sep)) throw new Error('That file is outside the project.')
    return full
  }

  async list(): Promise<Project[]> {
    return (await this.projects.all()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): Promise<Project | null> { return this.projects.get(id) }

  private async need(id: string): Promise<Project> {
    const p = await this.projects.get(id)
    if (!p) throw new Error('That project no longer exists.')
    return p
  }

  create(title: string, brief = '', lyrics = ''): Promise<Project> {
    return this.projects.put(newProject(randomUUID(), title, brief, lyrics))
  }

  async update(id: string, patch: { title?: string; brief?: string; lyrics?: string }): Promise<Project> {
    const p = await this.need(id)
    return this.projects.put({
      ...p,
      title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim().slice(0, 120) : p.title,
      brief: typeof patch.brief === 'string' ? patch.brief.slice(0, 20000) : p.brief,
      lyrics: typeof patch.lyrics === 'string' ? patch.lyrics.slice(0, 50000) : p.lyrics,
      updatedAt: Date.now()
    })
  }

  /** Audio is deleted only if it was this project's own copy. The person's original file is never touched. */
  async remove(id: string): Promise<boolean> {
    const p = await this.projects.get(id)
    if (!p) return false
    await this.projects.remove(id)
    await rm(this.dir(id), { recursive: true, force: true })
    return true
  }

  async importAudio(projectId: string, sourcePath: string, name?: string, note?: string, source: 'imported' | 'generated' = 'imported'): Promise<{ project: Project; info: AudioInfo }> {
    const p = await this.need(projectId)
    const st = await stat(sourcePath)
    if (!st.isFile()) throw new Error('That is not a file.')
    if (st.size > MAX_WAV_BYTES) throw new Error('That file is too large.')
    const bytes = await readFile(sourcePath)
    const result = inspectWav(bytes)
    if (!result.ok) throw new Error(result.reason)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const existing = p.artifacts.find((a) => a.sha256 === sha256)
    const artifactId = existing?.id ?? randomUUID()
    const file = `audio/${artifactId}.wav`
    if (!existing) {
      const target = join(this.dir(projectId), file)
      await mkdir(join(this.dir(projectId), 'audio'), { recursive: true })
      const tmp = `${target}.tmp`
      await writeFile(tmp, bytes)
      await rename(tmp, target)
    }
    const artifact: Artifact = existing ?? {
      id: artifactId, file, sha256, bytes: bytes.length, durationSec: result.info.durationSec,
      sampleRate: result.info.sampleRate, channels: result.info.channels, bitDepth: result.info.bitDepth,
      source, createdAt: Date.now()
    }
    const next = addVersion(p, { versionId: randomUUID(), name: name || basename(sourcePath).replace(/\.[^.]+$/, ''), note, artifact })
    return { project: await this.projects.put(next), info: result.info }
  }

  /** Measured again from the stored file each time; results are not cached against a changed file. */
  async analyse(projectId: string, artifactId: string): Promise<AudioInfo> {
    const p = await this.need(projectId)
    const a = p.artifacts.find((x) => x.id === artifactId)
    if (!a) throw new Error('That audio is not part of this project.')
    const bytes = await readFile(this.audioPath(projectId, a))
    if (createHash('sha256').update(bytes).digest('hex') !== a.sha256) throw new Error('This audio file has changed since it was added.')
    const r = inspectWav(bytes)
    if (!r.ok) throw new Error(r.reason)
    return r.info
  }

  async select(projectId: string, versionId: string): Promise<Project> {
    return this.projects.put(selectVersion(await this.need(projectId), versionId))
  }

  async restore(projectId: string, versionId: string): Promise<Project> {
    return this.projects.put(restoreVersion(await this.need(projectId), versionId, randomUUID()))
  }

  async removeVersion(projectId: string, versionId: string): Promise<Project> {
    const { project, orphaned } = removeVersion(await this.need(projectId), versionId)
    const saved = await this.projects.put(project)
    for (const a of orphaned) await rm(this.audioPath(projectId, a), { force: true })
    return saved
  }

  private async loadAudio(projectId: string, artifactId: string): Promise<{ bytes: Buffer; artifact: Artifact; project: Project }> {
    const project = await this.need(projectId)
    const artifact = project.artifacts.find((x) => x.id === artifactId)
    if (!artifact) throw new Error('That audio is not part of this project.')
    const bytes = await readFile(this.audioPath(projectId, artifact))
    if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('This audio file has changed since it was added.')
    return { bytes, artifact, project }
  }

  /** Applies one explicit operation and stores the result as a NEW version; the source version is untouched. */
  async process(projectId: string, versionId: string, op: Op): Promise<{ project: Project; note: string; clamped: number }> {
    const p0 = await this.need(projectId)
    const v = p0.versions.find((x) => x.id === versionId)
    if (!v) throw new Error('That version no longer exists.')
    const { bytes, artifact, project } = await this.loadAudio(projectId, v.artifactId)
    const decoded = decodeWav(bytes)
    if (!decoded) throw new Error('This file could not be decoded.')
    const r = applyOp(decoded, op)
    if (!r.ok) throw new Error(r.reason)
    const enc = encodeWav16(r.audio)
    const check = inspectWav(enc.bytes)
    if (!check.ok) throw new Error('The result did not pass validation, so it was not saved.')
    const sha256 = createHash('sha256').update(enc.bytes).digest('hex')
    const id = randomUUID()
    const file = `audio/${id}.wav`
    await mkdir(join(this.dir(projectId), 'audio'), { recursive: true })
    const target = join(this.dir(projectId), file)
    await writeFile(`${target}.tmp`, enc.bytes)
    await rename(`${target}.tmp`, target)
    const derived: Artifact = {
      id, file, sha256, bytes: enc.bytes.length, durationSec: check.info.durationSec, sampleRate: check.info.sampleRate,
      channels: check.info.channels, bitDepth: 16, source: 'processed', derivedFrom: { artifactId: artifact.id, operation: r.note }, createdAt: Date.now()
    }
    const next = addVersion({ ...project, selectedVersionId: v.id }, { versionId: randomUUID(), name: `${v.name} - ${r.note}`, note: r.note, artifact: derived })
    return { project: await this.projects.put(next), note: r.note, clamped: enc.clamped }
  }

  async tempo(projectId: string, artifactId: string): Promise<Tempo | null> {
    const { bytes } = await this.loadAudio(projectId, artifactId)
    const d = decodeWav(bytes)
    return d ? estimateTempo(d) : null
  }

  async waveform(projectId: string, artifactId: string, buckets = 200): Promise<number[]> {
    const { bytes } = await this.loadAudio(projectId, artifactId)
    const d = decodeWav(bytes)
    return d ? envelope(d, Math.min(1000, Math.max(10, buckets))) : []
  }

  /** Copies the version's audio to a folder the person chose. Never overwrites; verifies the copy by hash. */
  async exportVersion(projectId: string, versionId: string, folder: string): Promise<string> {
    const p = await this.need(projectId)
    const v = p.versions.find((x) => x.id === versionId)
    const a = v && p.artifacts.find((x) => x.id === v.artifactId)
    if (!v || !a) throw new Error('That version has no audio.')
    const from = this.audioPath(projectId, a)
    const wanted = safeFileName(`${p.title} - ${v.name}`, 'wav')
    let dest = join(folder, wanted)
    for (let n = 2; await stat(dest).then(() => true, () => false); n++) dest = join(folder, wanted.replace(/\.wav$/, ` (${n}).wav`))
    await copyFile(from, dest)
    const copy = createHash('sha256').update(await readFile(dest)).digest('hex')
    if (copy !== a.sha256) { await rm(dest, { force: true }); throw new Error('The exported copy did not match the original, so it was removed.') }
    return dest
  }

  /** A folder holding project.json and its audio, for moving a project to another machine. */
  async exportPackage(projectId: string, parent: string): Promise<string> {
    const p = await this.need(projectId)
    const root = join(parent, safeFileName(p.title, 'neurova'))
    await mkdir(join(root, 'audio'), { recursive: true })
    for (const a of p.artifacts) await copyFile(this.audioPath(projectId, a), join(root, a.file))
    await writeFile(join(root, 'project.json'), JSON.stringify({ format: 'neurova-project', version: 1, project: p }, null, 2))
    return root
  }

  /** Imported as a new project with a new id, so it can never replace an existing one. Every file is re-measured. */
  async importPackage(root: string): Promise<Project> {
    const manifest = JSON.parse(await readFile(join(root, 'project.json'), 'utf8')) as { format?: string; project?: unknown }
    if (manifest.format !== 'neurova-project') throw new Error('This is not a NEUROVA project.')
    const src = normalizeProject(manifest.project)
    if (!src) throw new Error('The project file is damaged.')
    if (src.artifacts.length > MAX_PACKAGE_FILES) throw new Error('This project holds too many files.')
    const id = randomUUID()
    const rootResolved = resolve(root)
    const dir = this.dir(id)
    await mkdir(join(dir, 'audio'), { recursive: true })
    const kept: Artifact[] = []
    for (const a of src.artifacts) {
      const from = resolve(rootResolved, a.file)
      if (!from.startsWith(rootResolved + sep)) continue
      const bytes = await readFile(from).catch(() => null)
      if (!bytes || createHash('sha256').update(bytes).digest('hex') !== a.sha256 || !inspectWav(bytes).ok) continue
      await writeFile(join(dir, a.file), bytes)
      kept.push(a)
    }
    const ids = new Set(kept.map((a) => a.id))
    const versions = src.versions.filter((v) => ids.has(v.artifactId))
    if (!versions.length && src.versions.length) { await rm(dir, { recursive: true, force: true }); throw new Error('None of the audio in this project could be verified.') }
    const project = normalizeProject({ ...src, id, artifacts: kept, versions, updatedAt: Date.now() }) as Project
    return this.projects.put(project)
  }

  /** Files in a project's folder that no artifact refers to, e.g. after a crash. Reported, never deleted unasked. */
  async strays(projectId: string): Promise<string[]> {
    const p = await this.need(projectId)
    const known = new Set(p.artifacts.map((a) => basename(a.file)))
    const found = await readdir(join(this.dir(projectId), 'audio')).catch(() => [] as string[])
    return found.filter((f) => !known.has(f))
  }
}
