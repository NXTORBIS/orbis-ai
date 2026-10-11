/**
 * Where generated Pages live between one opening and the next.
 *
 * A file of its own, beside the Pages settings rather than inside it. The settings file is read on every question the
 * Pages screen asks -- what is favourited, what has been opened, what has been granted -- and a generated Page is a
 * whole document with a history behind it. Putting them together would mean reading every version of every Page ever
 * built in order to find out whether somebody starred a calculator.
 *
 * ## What is kept, and what is not
 *
 * Kept: the version graph for each Page -- every version's specification, manifest and document, which one is
 * published, and what each one was asked to be. That is what makes going back to a version exact rather than another
 * guess.
 *
 * Not kept: the model's raw answers past the session they belong to, and sessions past the week `generation.ts` gives
 * them. Neither is evidence about a Page that works; they are evidence about one that did not, and that stops being
 * useful quickly.
 *
 * ## Reading it is not trusting it
 *
 * This is a JSON file on disk, so it is a file that can be edited -- by somebody experimenting, by a sync tool, by
 * something that went wrong. Everything read back goes through `cleanGraph`, which drops anything it does not
 * recognise rather than repairing it, and a Page whose document does not survive that is not offered. The alternative
 * is a Page in the library that fails when somebody opens it, and that is worse than one that is missing.
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { openStored } from '../storedFile.ts'
import fs from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { check, type PageDocument } from '../../shared/pages/builder.ts'
import { isExpired, RESTING, type GenerationSession, type Stage } from '../../shared/pages/generation.ts'
import { manifestToJson, readManifest, type PageManifest } from '../../shared/pages/manifest.ts'
import { checkSpec, type PageSpec } from '../../shared/pages/spec.ts'
import { VERSION_LIMITS, type PageVersionNode, type VersionGraph, type VersionState } from '../../shared/pages/versioning.ts'

/** Where a profile's data lives, mirroring how `store.ts` decides it. */
const dataDirFor = (profileId: string): string => (profileId === 'default' ? '' : join('profiles', profileId))

const FILE = join('pages', 'generated.json')
const FLUSH_MS = 1500

export const GENERATED_LIMITS = Object.freeze({
  /** How many generated Pages one profile may keep. */
  pages: 200,
  /** How many sessions are remembered, over and above the week they live for. */
  sessions: 40
})

interface Saved {
  graphs: VersionGraph[]
  sessions: GenerationSession[]
}

/**
 * A profile with no generated Pages, made fresh each time.
 *
 * A function rather than a constant, for the same reason as `pages/store.ts`: `{ ...EMPTY }` copies one level,
 * so every profile would share the same two arrays and anything that changed one in place would change them all.
 */
const empty = (): Saved => ({ graphs: [], sessions: [] })

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const STATES: ReadonlySet<string> = new Set<VersionState>(['draft', 'published', 'superseded', 'withdrawn'])
const STAGES: ReadonlySet<string> = new Set<Stage>(['resolving', 'planning', 'compiling', 'validating', 'trying', 'ready', 'failed', 'cancelled'])

/**
 * One version, read back from disk.
 *
 * The manifest goes through `readManifest` and the document through `check`, which are the same two gates a Page
 * registered from anywhere else passes. Nothing is special-cased for having been written by this application
 * earlier: a file is a file, and the version of Orbis that wrote it may not be the version reading it.
 */
function cleanNode(raw: unknown, operations: Readonly<Record<string, string>>): PageVersionNode | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.versionId !== 'string' || raw.versionId.length === 0 || raw.versionId.length > 64) return null
  if (raw.parentVersionId !== null && typeof raw.parentVersionId !== 'string') return null
  if (!STATES.has(String(raw.state))) return null
  if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) return null

  const manifest = readManifest(raw.manifest)
  if ('problems' in manifest) return null
  if (!isPlainObject(raw.document)) return null
  const document = raw.document as unknown as PageDocument
  if (!Array.isArray(document.fields) || !Array.isArray(document.components) || !Array.isArray(document.computations)) return null
  if (!check(document).canRun) return null

  const spec = checkSpec(raw.spec, operations)
  if (!spec.usable || spec.normalised === null) return null

  return {
    versionId: raw.versionId,
    parentVersionId: raw.parentVersionId as string | null,
    version: manifest.manifest.version,
    state: raw.state as VersionState,
    reason: typeof raw.reason === 'string' ? raw.reason.slice(0, VERSION_LIMITS.reasonLength) : null,
    createdAt: raw.createdAt,
    spec: spec.normalised as PageSpec,
    manifest: manifest.manifest as PageManifest,
    document
  }
}

export function cleanGraph(raw: unknown, operations: Readonly<Record<string, string>>): VersionGraph | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.pageId !== 'string' || raw.pageId.length === 0) return null
  if (!Array.isArray(raw.nodes)) return null
  const nodes = raw.nodes.map((one) => cleanNode(one, operations)).filter((one): one is PageVersionNode => one !== null)
  if (nodes.length === 0) return null
  const ids = new Set(nodes.map((one) => one.versionId))
  const published = typeof raw.publishedVersionId === 'string' && ids.has(raw.publishedVersionId) ? raw.publishedVersionId : null
  return {
    pageId: raw.pageId,
    forkedFrom: typeof raw.forkedFrom === 'string' ? raw.forkedFrom.slice(0, 200) : null,
    publishedVersionId: published,
    nodes: nodes.map((one) =>
      // A node claiming to be published when the graph says something else is corrected rather than believed. Two
      // published versions would leave one address with two answers.
      one.state === 'published' && one.versionId !== published ? { ...one, state: 'superseded' as const } : one
    )
  }
}

function cleanSession(raw: unknown): GenerationSession | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.sessionId !== 'string' || typeof raw.request !== 'string' || typeof raw.profileId !== 'string') return null
  if (!STAGES.has(String(raw.stage))) return null
  if (typeof raw.startedAt !== 'number' || typeof raw.updatedAt !== 'number') return null
  return {
    sessionId: raw.sessionId.slice(0, 40),
    request: raw.request.slice(0, 400),
    profileId: raw.profileId.slice(0, 64),
    startedAt: raw.startedAt,
    updatedAt: raw.updatedAt,
    stage: raw.stage as Stage,
    attempts: typeof raw.attempts === 'number' && raw.attempts > 0 ? Math.min(20, Math.round(raw.attempts)) : 1,
    // The parts that only matter while a session is running are not read back. A session found on disk is one that
    // was interrupted or finished, and in both cases it starts again from the ladder.
    resolution: null,
    raw: typeof raw.raw === 'string' ? raw.raw.slice(0, 100_000) : null,
    spec: null,
    built: null,
    validation: null,
    failure: isPlainObject(raw.failure) && typeof raw.failure.message === 'string'
      ? { code: 'gave-up', message: raw.failure.message.slice(0, 300), problems: [] }
      : null,
    history: Array.isArray(raw.history)
      ? raw.history
          .filter((one): one is Record<string, unknown> => isPlainObject(one) && STAGES.has(String(one.stage)) && typeof one.at === 'number')
          .slice(-40)
          .map((one) => ({ stage: one.stage as Stage, at: one.at as number, note: String(one.note ?? '').slice(0, 300) }))
      : []
  }
}

export function cleanSaved(raw: unknown, operations: Readonly<Record<string, string>>): Saved {
  if (!isPlainObject(raw)) return empty()
  const graphs = Array.isArray(raw.graphs)
    ? raw.graphs.map((one) => cleanGraph(one, operations)).filter((one): one is VersionGraph => one !== null)
    : []
  const sessions = Array.isArray(raw.sessions)
    ? raw.sessions.map(cleanSession).filter((one): one is GenerationSession => one !== null)
    : []
  return { graphs: graphs.slice(0, GENERATED_LIMITS.pages), sessions: sessions.slice(-GENERATED_LIMITS.sessions) }
}

/**
 * The file, in the form it is written in.
 *
 * Every manifest goes out through `manifestToJson`, because that is the form `readManifest` reads one back from. A
 * manifest in memory holds its version as three numbers, and `JSON.stringify` writes that out as an object, which
 * `readManifest` refuses -- so `cleanNode` dropped every version on the way back in and the whole library came back
 * empty. Writing the built object was silent, total loss: build three Pages, restart Orbis, and they were gone,
 * because the file was perfectly good JSON that said nothing this store would accept.
 */
const asWritten = (saved: Saved): string =>
  JSON.stringify({
    ...saved,
    graphs: saved.graphs.map((graph) => ({
      ...graph,
      nodes: graph.nodes.map((one) => ({ ...one, manifest: manifestToJson(one.manifest) }))
    }))
  })

export class GeneratedStore {
  private readonly root: string
  private readonly operations: Readonly<Record<string, string>>
  private readonly cache = new Map<string, Saved>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly dirty = new Set<string>()

  constructor(userDataPath: string, operations: Readonly<Record<string, string>>) {
    this.root = userDataPath
    this.operations = operations
  }

  private fileFor(profileId: string): string {
    return join(this.root, dataDirFor(profileId), FILE)
  }

  private async read(profileId: string): Promise<Saved> {
    const held = this.cache.get(profileId)
    if (held) return held
    // The parse belongs inside `openStored`, not in a `try` of our own. It used to sit in the same `try` as the read,
    // which made a file that is there but not valid JSON -- a write interrupted by a power cut, a half-finished sync --
    // look exactly like no file at all: an empty library in memory, the mark that refuses writes cleared, and the next
    // Page built renamed that emptiness over every Page this profile had ever generated, every version of each of them,
    // with nothing kept anywhere. `openStored` tells the two apart: a damaged file is moved aside under its own name
    // first, so the words are still on the disk, and only then may anything be written. When it could not even be
    // moved, `mayWrite` is false and this store refuses to write at all, because something is there and Orbis does not
    // know what.
    const opened = await openStored(
      this.fileFor(profileId),
      (text) => cleanSaved(JSON.parse(text), this.operations),
      empty
    )
    if (opened.mayWrite) this.unreadable.delete(profileId)
    else this.unreadable.add(profileId)
    this.cache.set(profileId, opened.value)
    return opened.value
  }

  /**
   * Profiles whose file may not be written over: there is one, and it was neither read nor moved out of the way.
   *
   * Set from `mayWrite` rather than worked out here, so the rule lives in one place. It stays set until the file is
   * looked at again, which is the next time this profile's cache is empty.
   */
  private readonly unreadable = new Set<string>()
  /**
   * The same read, for something that is about to change this profile's file.
   *
   * A read that is only going to be shown can happily hand back defaults for a file Orbis could not make sense of.
   * A read that is about to be followed by a save cannot: the save will be refused, and the method would have
   * already returned the new favourite, the saved project, `true` -- so the screen says it saved and nothing was
   * written. Somebody loses a Page's work and is told the opposite, which is worse than being told it failed.
   *
   * So the refusal happens here, before anything is changed, and the window hears a failure.
   */
  private async readForWrite(profileId: string): Promise<Saved> {
    const saved = await this.read(profileId)
    if (this.unreadable.has(profileId)) {
      throw new Error('Orbis could not make sense of this profile\u2019s Pages file, so nothing was changed. It has been left exactly as it is.')
    }
    return saved
  }


  private touch(profileId: string): void {
    this.dirty.add(profileId)
    const existing = this.timers.get(profileId)
    if (existing) clearTimeout(existing)
    this.timers.set(
      profileId,
      setTimeout(() => {
        void this.flushOne(profileId)
      }, FLUSH_MS)
    )
  }

  private async flushOne(profileId: string): Promise<void> {
    const timer = this.timers.get(profileId)
    if (timer) clearTimeout(timer)
    this.timers.delete(profileId)
    if (!this.dirty.delete(profileId)) return
    const saved = this.cache.get(profileId)
    if (!saved) return
    if (this.unreadable.has(profileId)) {
      // A file is there that Orbis could not read: it holds what this profile has decided and what it has made,
      // so it is left alone and looked at again next time rather than written over with defaults. The mark is not
      // cleared here -- clearing it let the very next save through a moment later, which is the write this whole
      // branch exists to stop.
      return
    }
    const file = this.fileFor(profileId)
    await fs.mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.tmp`
    // Write beside, then move: an interrupted write leaves the old file rather than half of the new one.
    await fs.writeFile(temporary, asWritten(saved), 'utf8')
    await fs.rename(temporary, file)
  }

  async flush(): Promise<void> {
    await Promise.all([...this.dirty].map((profileId) => this.flushOne(profileId)))
  }

  flushSync(): void {
    for (const profileId of [...this.dirty]) {
      const saved = this.cache.get(profileId)
      if (!saved) continue
      if (this.unreadable.has(profileId)) {
        // The same rule as the timed write, because quitting is not a reason to overwrite something Orbis never
        // understood. Losing the last few seconds of a session is recoverable; this is not.
        continue
      }
      try {
        const file = this.fileFor(profileId)
        mkdirSync(dirname(file), { recursive: true })
        const temporary = `${file}.tmp`
        writeFileSync(temporary, asWritten(saved), 'utf8')
        renameSync(temporary, file)
      } catch {
        // The very end of the process. There is nowhere to report this and nothing that could act on it.
      }
    }
    this.dirty.clear()
  }

  // ---------------------------------------------------------------- Pages

  async graphs(profileId: string): Promise<readonly VersionGraph[]> {
    return (await this.read(profileId)).graphs
  }

  async graph(profileId: string, pageId: string): Promise<VersionGraph | null> {
    return (await this.graphs(profileId)).find((one) => one.pageId === pageId) ?? null
  }

  /**
   * A version graph written down.
   *
   * Replaces the whole graph for that Page rather than merging, because the caller holds the authority on what the
   * history is -- `versioning.ts` produced it, and a merge here would be a second opinion about a structure that has
   * exactly one correct answer.
   */
  async putGraph(profileId: string, graph: VersionGraph): Promise<{ saved: boolean; message: string }> {
    const saved = await this.readForWrite(profileId)
    const existing = saved.graphs.findIndex((one) => one.pageId === graph.pageId)
    if (existing === -1 && saved.graphs.length >= GENERATED_LIMITS.pages) {
      return {
        saved: false,
        message: `There are already ${GENERATED_LIMITS.pages} Pages built here. Delete one before building another.`
      }
    }
    const graphs = existing === -1 ? [...saved.graphs, graph] : saved.graphs.map((one, i) => (i === existing ? graph : one))
    this.cache.set(profileId, { ...saved, graphs })
    this.touch(profileId)
    return { saved: true, message: '' }
  }

  async deleteGraph(profileId: string, pageId: string): Promise<boolean> {
    const saved = await this.readForWrite(profileId)
    const graphs = saved.graphs.filter((one) => one.pageId !== pageId)
    if (graphs.length === saved.graphs.length) return false
    this.cache.set(profileId, { ...saved, graphs })
    this.touch(profileId)
    return true
  }

  // ---------------------------------------------------------------- sessions

  async sessions(profileId: string, now: number): Promise<readonly GenerationSession[]> {
    // The plain read, not `readForWrite`: this is bookkeeping, not something somebody asked for. Failing to
    // record it must never stop the thing it was recording -- a damaged Pages file would otherwise mean no Page
    // would open at all. Nothing is written either, because the write is still refused further down.
    const saved = await this.read(profileId)
    const live = saved.sessions.filter((one) => !isExpired(one, now))
    if (live.length !== saved.sessions.length) {
      this.cache.set(profileId, { ...saved, sessions: live })
      this.touch(profileId)
    }
    return live
  }

  async putSession(profileId: string, session: GenerationSession): Promise<void> {
    // The plain read, not `readForWrite`: this is bookkeeping, not something somebody asked for. Failing to
    // record it must never stop the thing it was recording -- a damaged Pages file would otherwise mean no Page
    // would open at all. Nothing is written either, because the write is still refused further down.
    const saved = await this.read(profileId)
    const existing = saved.sessions.findIndex((one) => one.sessionId === session.sessionId)
    const sessions =
      existing === -1
        ? [...saved.sessions, session].slice(-GENERATED_LIMITS.sessions)
        : saved.sessions.map((one, i) => (i === existing ? session : one))
    this.cache.set(profileId, { ...saved, sessions })
    this.touch(profileId)
  }

  /** Sessions that were interrupted, for whoever decides what to do about them. */
  async interrupted(profileId: string, now: number): Promise<readonly GenerationSession[]> {
    return (await this.sessions(profileId, now)).filter((one) => !RESTING.has(one.stage))
  }

  forget(profileId?: string): void {
    if (profileId === undefined) {
      this.cache.clear()
      return
    }
    this.cache.delete(profileId)
  }
}
