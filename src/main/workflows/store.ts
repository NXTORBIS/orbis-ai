import { promises as fs } from 'node:fs'
import { openStored } from '../storedFile.ts'
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
 * What a workflow file has to be for this version of Orbis to use it.
 *
 * Failing this counts as a file Orbis could not make sense of, so it stays out of the library and nothing may be
 * written over it -- it used to be dropped as quietly as a file that was not there, which left the person's workflow
 * out of their library with the next save free to land on top of it.
 *
 * Checked after the file has parsed, though, and deliberately not moved aside. A format number this version has never
 * heard of is not damage: it is a workflow a newer Orbis wrote, and Orbis read the number out of it, so it understood
 * the file well enough to know it is not for this version. `skillManager.ts` and `vault/store.ts` already reach that
 * conclusion for the same case, and the two have to agree, because a skill is two files: its details in `skills/` and
 * its workflow here. Moving the workflow aside while the details stayed meant opening the newer Orbis again found a
 * skill with no workflow under it and dropped it from the library -- the workflow renamed out from under the only
 * version that could still read it. A file that will not parse at all is the other case, and that one is moved aside.
 */
const usableWorkflow = (w: Workflow | null): boolean => !!w && w.format === WORKFLOW_FORMAT && typeof w.id === 'string' && Array.isArray(w.steps)

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
   *
   * A damaged file that could not even be moved aside lands here too, for the same reason: it is still sitting there
   * and still not understood.
   */
  private readonly unreadable = new Set<string>()

  /**
   * Files that read and parsed and are not something this Orbis understands -- a workflow saved by a newer version.
   *
   * Kept apart from `unreadable` because the two give opposite answers to "ask again". A file held open for a
   * moment may be perfectly readable a second later, so a refusal to delete it has to be re-decided against the
   * file. A file from a newer Orbis reads perfectly every time and must still never be deleted -- it has to still
   * be there after the next update -- so re-asking about one of those would delete it.
   */
  private readonly foreign = new Set<string>()

  private write(path: string, data: unknown): Promise<void> {
    if (this.unreadable.has(path) || this.foreign.has(path)) {
      /*
       * Refused, and the mark is NOT cleared on the way out.
       *
       * It used to be, on the argument that every caller reads before it writes, so the next read would put the mark
       * back and refusing would cost only this one save. Both halves of that are wrong here, because two of these
       * files are cached: `list()` fills `cache` and `runs()` fills `runsCache` with the fallback the damaged file
       * handed back, and nothing reads that path again for the rest of the session. So the mark was never put back,
       * and save number two went straight through. Measured on a workflow file that could be read and could not be
       * moved aside -- a backup program holding it, which is why the move failed: save one was refused and cleared
       * the mark, save two wrote a blank workflow over the real one, with no copy kept anywhere. The mark is cleared
       * in `read()`, and only when the file has actually read cleanly, which is the one place that knows that.
       *
       * Refusing stays silent and writes nothing. `tabLockStore.ts` and `accountSecurity.ts` throw at this point,
       * because a tab password or an account password reported saved and not saved cannot be got back; what goes
       * through here is mostly bookkeeping Orbis does for itself, and the callers are not built to hear about it --
       * `engine.ts:482` saves a checkpoint with no `catch` on it at all, and `engine.ts:541` records a run in the
       * middle of finishing one, so throwing would turn a file something else has open into an unhandled rejection
       * and a run that never reports that it finished.
       */
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

  /**
   * Deletes one of these files, unless it is one Orbis could not make sense of.
   *
   * `fs.rm` used to be called straight from the two places that delete, so none of the refusing above applied to
   * them: a checkpoint that could be read, could not be parsed and could not be moved aside was deleted outright the
   * moment its run ended, which is the one outcome `storedFile.ts` exists to prevent. Deleting is the only thing in
   * this store that cannot be taken back, so it is the last place that should have been left out.
   *
   * Silent, like the write above, and for the same reason: the caller is the engine finishing a run, not somebody
   * waiting to be told. The file stays on the disk and the next read decides again.
   *
   * **The file is asked about now, not taken from the mark.** The mark is set by a read and cleared by a read, and
   * `remove()` does not read a workflow's versions before deleting them -- so somebody who opened a version history
   * while something held the file for a moment left the mark set for the rest of the session, and "delete this
   * workflow" then silently left `versions/<id>.json` on the disk while the window reported it deleted. What is in
   * that file is not a stub: it is every earlier definition of the workflow, with its `set` step values and its
   * variables, and only `exportWorkflow` scrubs secrets -- nothing scrubs this.
   *
   * So a refusal to delete has to mean the file is unreadable *now*. One read per delete, which cannot spin.
   */
  private async erase(path: string): Promise<void> {
    // Never, and without asking: it reads perfectly and will keep doing so, and it has to still be there after the
    // next update.
    if (this.foreign.has(path)) return
    if (this.unreadable.has(path)) {
      const opened = await openStored<unknown>(path, (text) => JSON.parse(text) as unknown, () => null)
      if (!opened.mayWrite) return
      this.unreadable.delete(path)
    }
    await fs.rm(path, { force: true }).catch(() => {
      // Held open: EPERM or EBUSY, which `force` does not swallow. Marked so the next read decides again, rather
      // than thrown -- the caller is the engine finishing a run and has nowhere to put it.
      this.unreadable.add(path)
    })
  }

  /**
   * Reads one of these files, with the damaged case kept apart from the absent one.
   *
   * The parse used to sit in its own `try` that fell back to the same empty value a missing file gives, so a workflow
   * file that was half written -- Orbis stopped mid-save, the disk filled, a copy caught it part way -- read as no
   * workflow at all and the next save put the empty value on top of it. A truncated file reads perfectly well; it
   * just does not parse, which is why that case has to be told apart from the file not being there.
   *
   * `openStored` is the one place that knows the four cases, and all four are answered separately here:
   *
   *  - not there: the fallback, and saving is allowed.
   *  - read and understood: the value, and saving is allowed.
   *  - read and would not parse: `openStored` has already moved it aside under its own name, so the words are still
   *    on the disk and this name is free to use again.
   *  - still there and not understood: it could not be read at all, or it could not be moved aside, or `check` says
   *    it is not a file this version knows. The path goes in `unreadable` and saves to it are refused, because
   *    something is there and Orbis does not know what.
   *
   * This is also the only place the mark is taken off a path, and only on a file that has just read cleanly. The
   * refusal in `write()` used to take it off instead, which is the fault described there.
   *
   * `check` is for the shape, and it runs out here rather than inside the parse so that a file failing it is kept
   * where it is -- see `usableWorkflow`.
   */
  private async read<T>(path: string, fallback: T, check?: (value: T) => boolean): Promise<T> {
    // What the file held, when it was there and did parse. Kept because `openStored` reports a missing file and a
    // clean read the same way, and running `check` on the fallback a missing file gives back would mark a name
    // unwritable for the rest of the session on the grounds that nothing is using it.
    const held: { value?: T } = {}
    const parse = (text: string): T => {
      const value = JSON.parse(text) as T
      // `null`, a number, a bare string: it parsed, and there is nothing in it that could ever be one of these files.
      // Thrown, so it goes down the damaged path with the rest of the rubbish rather than being kept where it is as
      // something a later Orbis might still want. Only a caller with a shape in mind can say that much, which is why
      // this sits with `check` rather than applying to every file in here.
      if (check && (!value || typeof value !== 'object')) throw new Error('Not one of these files at all.')
      held.value = value
      return value
    }
    const opened = await openStored<T>(path, parse, () => fallback)
    if (!opened.mayWrite) {
      this.unreadable.add(path)
      return fallback
    }
    if (opened.wasDamaged) {
      this.unreadable.delete(path)
      return fallback
    }
    if (check && held.value !== undefined && !check(held.value)) {
      // It read, it parsed, and it is not one of ours. Almost always a workflow a newer Orbis saved.
      this.foreign.add(path)
      this.unreadable.delete(path)
      return fallback
    }
    this.unreadable.delete(path)
    this.foreign.delete(path)
    return opened.value
  }

  // ---------------------------------------------------------------- workflows

  async list(): Promise<Workflow[]> {
    if (!this.cache) {
      this.cache = new Map()
      const names = await fs.readdir(this.file('items')).catch(() => [] as string[])
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const w = await this.read<Workflow | null>(this.file('items', name), null, usableWorkflow)
        if (w) this.cache.set(w.id, w)
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
    await Promise.all([this.erase(this.file('items', `${id}.json`)), this.erase(this.file('versions', `${id}.json`)), this.forgetSecrets(id)])
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
    if (ID.test(runId)) await this.erase(this.file('checkpoints', `${runId}.json`))
  }

  /** Runs that were in progress when Orbis last closed. */
  async checkpoints(): Promise<WorkflowCheckpoint[]> {
    const names = await fs.readdir(this.file('checkpoints')).catch(() => [] as string[])
    const out: WorkflowCheckpoint[] = []
    for (const name of names) {
      // Only the checkpoints, not what has been moved aside -- the same filter `list()` uses on its own folder, and
      // this folder needs it for a reason that only appeared once anything was moved aside at all: a quarantined
      // file was read back, failed to parse again and was quarantined again, so every single call that asked what
      // was interrupted put another `.unreadable-` stamp on the end of the name. The words survived each time; the
      // name grew by thirty-odd characters a call until the disk would not take it.
      if (!name.endsWith('.json')) continue
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
