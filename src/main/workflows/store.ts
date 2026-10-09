import { promises as fs } from 'node:fs'
import { readStored } from '../storedFile.ts'
import { nullPlatform } from '../platform.ts'
import type { SecretStorePort } from '../platform'
import { join } from 'node:path'
import { DEFAULT_PROFILE_ID, dataDirFor } from '../../shared/profiles.ts'
import type { Workflow, WorkflowCheckpoint, WorkflowRunSummary, WorkflowVersion } from '../../shared/workflows'
import { WORKFLOW_FORMAT } from '../../shared/workflows.ts'

export type { WorkflowCheckpoint, WorkflowVersion }

const MAX_VERSIONS = 50
const MAX_RUNS = 500
const ID = /^[A-Za-z0-9_-]{1,80}$/

/**
 * Where workflows live on disk (under the user's data folder): each workflow in its own file, its earlier versions,
 * the execution history, checkpoints of runs in progress, and secret inputs the user chose to remember (encrypted with
 * the operating system's protection). Writes are atomic and serialized per file.
 */
export class WorkflowStore {
  private readonly userData: string
  /** Whose workflows these are. Each profile keeps its own library, versions, run history and remembered secrets. */
  private profileId: string
  private dir: string
  private readonly queues = new Map<string, Promise<void>>()
  private cache: Map<string, Workflow> | null = null
  private runsCache: WorkflowRunSummary[] | null = null

  /**
   * Secrets are kept only where the machine can encrypt them. Which machine that is — Electron's today, Chromium's
   * tomorrow — is handed in rather than imported, so this file stays free of either.
   */
  private readonly secretStore: SecretStorePort

  constructor(userData: string, secretStore: SecretStorePort = nullPlatform().secrets, profileId: string = DEFAULT_PROFILE_ID) {
    this.userData = userData
    this.profileId = profileId
    // The default profile keeps the folder workflows have always been in.
    this.dir = join(userData, dataDirFor(profileId), 'workflows')
    this.secretStore = secretStore
  }

  get profile(): string {
    return this.profileId
  }

  /**
   * Switches to another profile's workflows.
   *
   * Workflows used to be one library for the whole application, so a workflow — and now a learned skill — made in one
   * profile turned up in every other. They belong to the profile that made them. Writes already queued keep the paths
   * they were queued with, so a switch part way through a save cannot put one profile's workflow in another's folder.
   */
  useProfile(profileId: string): void {
    if (profileId === this.profileId) return
    this.profileId = profileId
    this.dir = join(this.userData, dataDirFor(profileId), 'workflows')
    this.cache = null
    this.runsCache = null
  }

  private file(...parts: string[]): string {
    return join(this.dir, ...parts)
  }

  /**
   * Files that are there and could not be read, which must not be written over.
   *
   * Reading used to treat "could not be read" and "is not there" as the same thing, so a workflow file something
   * else had open for a moment looked like no workflow at all -- and the next save wrote an empty one over it.
   * Workflow files hold what a workflow was told to remember, which does not exist anywhere else.
   */
  private readonly unreadable = new Set<string>()

  private write(path: string, data: unknown): Promise<void> {
    if (this.unreadable.has(path)) {
      // Looked at again next time: a lock clears, a copy finishes, and refusing costs only this one save.
      this.unreadable.delete(path)
      return Promise.resolve()
    }
    const run = (this.queues.get(path) ?? Promise.resolve()).then(async () => {
      await fs.mkdir(join(path, '..'), { recursive: true })
      // Readable by this account only.
      await fs.writeFile(`${path}.tmp`, JSON.stringify(data), { mode: 0o600 })
      await fs.rename(`${path}.tmp`, path)
    })
    this.queues.set(path, run.catch(() => undefined))
    return run
  }

  private async read<T>(path: string, fallback: T): Promise<T> {
    const stored = await readStored(path)
    if (stored.kind === 'unreadable') {
      // There is a file; Orbis just could not read it. Carry on from the fallback, but never write over it.
      this.unreadable.add(path)
      return fallback
    }
    if (stored.kind === 'missing') return fallback
    try {
      return JSON.parse(stored.text) as T
    } catch {
      return fallback
    }
  }

  // ---------------------------------------------------------------- workflows

  async list(): Promise<Workflow[]> {
    if (!this.cache) {
      this.cache = new Map()
      const names = await fs.readdir(this.file('items')).catch(() => [] as string[])
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const w = await this.read<Workflow | null>(this.file('items', name), null)
        if (w && w.format === WORKFLOW_FORMAT && typeof w.id === 'string' && Array.isArray(w.steps)) this.cache.set(w.id, w)
      }
    }
    return [...this.cache.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  }

  async get(id: string): Promise<Workflow | null> {
    await this.list()
    return this.cache!.get(id) ?? null
  }

  /**
   * Saves a workflow. When its definition changed, the previous definition becomes a version and the version number
   * goes up; library-only changes (favorite, pinned, tags, name) don't create versions.
   */
  async save(workflow: Workflow, note?: string): Promise<Workflow> {
    if (!ID.test(workflow.id)) throw new Error('Invalid workflow id.')
    const previous = await this.get(workflow.id)
    const definition = (w: Workflow): string => JSON.stringify([w.steps, w.inputs, w.outputs, w.variables, w.settings, w.trigger])
    let next: Workflow = { ...workflow, updatedAt: Date.now() }
    if (previous && definition(previous) !== definition(workflow)) {
      const versions = await this.versions(workflow.id)
      versions.push({ version: previous.version, savedAt: previous.updatedAt, note, workflow: previous })
      await this.write(this.file('versions', `${workflow.id}.json`), versions.slice(-MAX_VERSIONS))
      next = { ...next, version: previous.version + 1 }
    } else if (previous) next = { ...next, version: previous.version }
    this.cache!.set(next.id, next)
    await this.write(this.file('items', `${next.id}.json`), next)
    return next
  }

  async remove(id: string): Promise<void> {
    if (!ID.test(id)) throw new Error('Invalid workflow id.')
    await this.list()
    this.cache!.delete(id)
    await Promise.all([fs.rm(this.file('items', `${id}.json`), { force: true }), fs.rm(this.file('versions', `${id}.json`), { force: true }), this.forgetSecrets(id)])
  }

  async versions(id: string): Promise<WorkflowVersion[]> {
    return ID.test(id) ? this.read<WorkflowVersion[]>(this.file('versions', `${id}.json`), []) : []
  }

  /** Brings back an earlier version as the current one (the current one is kept as a version too). */
  async restoreVersion(id: string, version: number): Promise<Workflow> {
    const current = await this.get(id)
    const found = (await this.versions(id)).find((v) => v.version === version)
    if (!current || !found) throw new Error('That version does not exist.')
    return this.save({ ...found.workflow, id, name: current.name, favorite: current.favorite, pinned: current.pinned, version: current.version }, `Restored version ${version}`)
  }

  // ---------------------------------------------------------------- execution history

  async runs(workflowId?: string): Promise<WorkflowRunSummary[]> {
    if (!this.runsCache) this.runsCache = await this.read<WorkflowRunSummary[]>(this.file('runs.json'), [])
    return workflowId ? this.runsCache.filter((r) => r.workflowId === workflowId) : [...this.runsCache]
  }

  async recordRun(summary: WorkflowRunSummary): Promise<void> {
    const runs = await this.runs()
    this.runsCache = [summary, ...runs.filter((r) => r.runId !== summary.runId)].slice(0, MAX_RUNS)
    await this.write(this.file('runs.json'), this.runsCache)
  }

  // ---------------------------------------------------------------- checkpoints

  async saveCheckpoint(checkpoint: WorkflowCheckpoint): Promise<void> {
    if (ID.test(checkpoint.runId)) await this.write(this.file('checkpoints', `${checkpoint.runId}.json`), checkpoint)
  }

  async clearCheckpoint(runId: string): Promise<void> {
    if (ID.test(runId)) await fs.rm(this.file('checkpoints', `${runId}.json`), { force: true })
  }

  /** Runs that were in progress when Orbis last closed. */
  async checkpoints(): Promise<WorkflowCheckpoint[]> {
    const names = await fs.readdir(this.file('checkpoints')).catch(() => [] as string[])
    const out: WorkflowCheckpoint[] = []
    for (const name of names) {
      const cp = await this.read<WorkflowCheckpoint | null>(this.file('checkpoints', name), null)
      if (cp && typeof cp.runId === 'string') out.push(cp)
    }
    return out.sort((a, b) => b.savedAt - a.savedAt)
  }

  // ---------------------------------------------------------------- secrets (only when the user asks to remember them)

  private async secrets(): Promise<Record<string, string>> {
    return this.read<Record<string, string>>(this.file('secrets.json'), {})
  }

  canRememberSecrets(): boolean {
    return this.secretStore.available()
  }

  async rememberSecret(workflowId: string, name: string, value: string): Promise<void> {
    if (!this.secretStore.available()) throw new Error("This computer can't encrypt stored secrets, so Orbis won't keep them. Enter them each run.")
    const all = await this.secrets()
    all[`${workflowId}:${name}`] = this.secretStore.encrypt(value).toString('base64')
    await this.write(this.file('secrets.json'), all)
  }

  async secret(workflowId: string, name: string): Promise<string | null> {
    const stored = (await this.secrets())[`${workflowId}:${name}`]
    if (!stored || !this.secretStore.available()) return null
    try {
      return this.secretStore.decrypt(Buffer.from(stored, 'base64'))
    } catch {
      return null
    }
  }

  async rememberedSecretNames(workflowId: string): Promise<string[]> {
    return Object.keys(await this.secrets())
      .filter((key) => key.startsWith(`${workflowId}:`))
      .map((key) => key.slice(workflowId.length + 1))
  }

  async forgetSecrets(workflowId: string, name?: string): Promise<void> {
    const all = await this.secrets()
    const kept = Object.fromEntries(Object.entries(all).filter(([key]) => (name ? key !== `${workflowId}:${name}` : !key.startsWith(`${workflowId}:`))))
    if (Object.keys(kept).length !== Object.keys(all).length) await this.write(this.file('secrets.json'), kept)
  }
}
