import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export type ListCategory = 'ads' | 'trackers' | 'annoyances' | 'orbis'

export interface CatalogList {
  id: string
  name: string
  category: ListCategory
  /** Downloaded and updated at runtime. */
  url?: string
  /** Shipped with Orbis only (resources/adblock), versioned with the app. */
  file?: string
}

export interface Catalog {
  version: number
  minFilters: number
  updateIntervalHours: number
  resources: { id: string; name: string; url: string }
  lists: CatalogList[]
}

export interface StoredList {
  file: string
  checksum: string
  bytes: number
  rules?: number
  updatedAt?: number
  source?: 'bundled' | 'downloaded'
}

/** Describes one complete set of filter lists on disk. */
export interface Manifest {
  version: string
  updatedAt?: number
  /** Last time Orbis checked for updates, whether or not anything changed. */
  checkedAt?: number
  lists: Record<string, StoredList>
}

export interface LoadedFilters {
  manifest: Manifest
  /** List id → text (including the scriptlet resources and bundled-only lists). */
  texts: Map<string, string>
  /** Set when the stored lists were damaged and an earlier or bundled version was used instead. */
  recovered?: string
  canRollback: boolean
}

export interface UpdateResult {
  updated: string[]
  unchanged: string[]
  failed: { id: string; reason: string }[]
  version: string
}

export const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex')

/** Rule lines in a list: everything except blank lines, comments ("!", "# ") and "[Adblock Plus]" headers. */
export function countRules(text: string): number {
  let rules = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line && !line.startsWith('!') && !line.startsWith('[') && !/^#(?![#@?$%])/.test(line)) rules++
  }
  return rules
}

/** Why a downloaded list can't be used, or null when it's fine. */
export function validateList(text: string, kind: 'list' | 'resources', minRules: number, previousRules?: number): string | null {
  if (!text.trim()) return 'the download was empty'
  if (/^\s*<(!doctype|html|head|body)\b/i.test(text)) return 'got a web page instead of a filter list'
  if (kind === 'resources') {
    try {
      const parsed = JSON.parse(text) as unknown
      return parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0 ? null : 'the resources file has no entries'
    } catch {
      return 'the resources file is not valid JSON'
    }
  }
  const rules = countRules(text)
  if (rules < minRules) return `it has only ${rules} rules`
  // A list that shrank by more than half is far more likely cut off than genuinely rewritten.
  if (previousRules && rules < previousRules * 0.5) return `it has only ${rules} rules, less than half of the ${previousRules} before (probably cut off)`
  return null
}

type SetRead = { ok: true; manifest: Manifest; texts: Map<string, string> } | { ok: false; missing: boolean; error: string }

/**
 * Filter lists on disk: the current set, the previous set (for rollback and recovery) and compiled engine caches.
 * Updates are written to a staging folder and swapped in whole, so a failed or partial update never replaces
 * working lists. Damaged lists are detected by checksum and replaced by the previous or the bundled set.
 */
export class FilterStore {
  private readonly o: { dir: string; bundledDir: string; catalog: Catalog; fetchFn: FetchFn; now?: () => number }

  constructor(options: { dir: string; bundledDir: string; catalog: Catalog; fetchFn: FetchFn; now?: () => number }) {
    this.o = options
  }

  private get currentDir(): string {
    return join(this.o.dir, 'current')
  }
  private get previousDir(): string {
    return join(this.o.dir, 'previous')
  }
  private get stagingDir(): string {
    return join(this.o.dir, 'staging')
  }
  private get enginesDir(): string {
    return join(this.o.dir, 'engines')
  }
  private now(): number {
    return this.o.now?.() ?? Date.now()
  }
  /** Lists that are downloaded, plus the scriptlet resources. */
  private get downloadable(): { id: string; url: string; kind: 'list' | 'resources' }[] {
    return [
      ...this.o.catalog.lists.filter((l): l is CatalogList & { url: string } => Boolean(l.url)).map((l) => ({ id: l.id, url: l.url, kind: 'list' as const })),
      { id: this.o.catalog.resources.id, url: this.o.catalog.resources.url, kind: 'resources' as const }
    ]
  }

  private async readSet(base: string): Promise<SetRead> {
    let manifest: Manifest
    try {
      manifest = JSON.parse(await readFile(join(base, 'manifest.json'), 'utf8')) as Manifest
    } catch (err) {
      const missing = (err as NodeJS.ErrnoException).code === 'ENOENT'
      return { ok: false, missing, error: missing ? 'no filter lists yet' : 'the list manifest is damaged' }
    }
    const texts = new Map<string, string>()
    for (const { id } of this.downloadable) {
      const entry = manifest.lists?.[id]
      if (!entry) return { ok: false, missing: false, error: `${id} is missing` }
      try {
        const text = await readFile(join(base, 'lists', entry.file), 'utf8')
        if (sha256(text) !== entry.checksum) return { ok: false, missing: false, error: `${id} is damaged (checksum mismatch)` }
        texts.set(id, text)
      } catch {
        return { ok: false, missing: false, error: `${id} can't be read` }
      }
    }
    return { ok: true, manifest, texts }
  }

  private async writeSet(base: string, manifest: Manifest, texts: Map<string, string>): Promise<void> {
    await rm(base, { recursive: true, force: true })
    await mkdir(join(base, 'lists'), { recursive: true })
    for (const { id } of this.downloadable) await writeFile(join(base, 'lists', manifest.lists[id].file), texts.get(id) ?? '')
    await writeFile(join(base, 'manifest.json'), JSON.stringify(manifest, null, 2))
  }

  private async exists(base: string): Promise<boolean> {
    try {
      await readFile(join(base, 'manifest.json'))
      return true
    } catch {
      return false
    }
  }

  /** Lists shipped with the app only, read fresh from the bundle on every load. */
  private async addBundledOnly(texts: Map<string, string>): Promise<void> {
    for (const list of this.o.catalog.lists) {
      if (!list.file || list.url) continue
      try {
        texts.set(list.id, await readFile(join(this.o.bundledDir, list.file), 'utf8'))
      } catch {
        // A missing bundled-only list just isn't loaded.
      }
    }
  }

  /** The current lists; damaged lists fall back to the previous version, then to the lists that ship with Orbis. */
  async load(): Promise<LoadedFilters> {
    await rm(this.stagingDir, { recursive: true, force: true })
    const current = await this.readSet(this.currentDir)
    let recovered: string | undefined
    let chosen: { manifest: Manifest; texts: Map<string, string> }
    if (current.ok) {
      chosen = current
    } else {
      const previous = await this.readSet(this.previousDir)
      if (previous.ok) {
        await rm(this.currentDir, { recursive: true, force: true })
        await rename(this.previousDir, this.currentDir)
        recovered = `The filter lists were damaged (${current.error}), so Orbis went back to the previous version.`
        chosen = previous
      } else {
        const bundled = await this.readSet(this.o.bundledDir)
        if (!bundled.ok) throw new Error(`No usable filter lists: ${bundled.error}`)
        const updatedAt = Date.parse(bundled.manifest.version) || this.now()
        const manifest: Manifest = {
          version: bundled.manifest.version,
          updatedAt,
          lists: Object.fromEntries(
            Object.entries(bundled.manifest.lists).map(([id, entry]) => [id, { ...entry, rules: entry.rules ?? countRules(bundled.texts.get(id) ?? ''), updatedAt, source: 'bundled' as const }])
          )
        }
        await this.writeSet(this.currentDir, manifest, bundled.texts)
        if (!current.missing) recovered = `The filter lists were damaged (${current.error}), so Orbis restored the lists that ship with it.`
        chosen = { manifest, texts: bundled.texts }
      }
    }
    await this.addBundledOnly(chosen.texts)
    return { manifest: chosen.manifest, texts: chosen.texts, recovered, canRollback: await this.exists(this.previousDir) }
  }

  /**
   * Downloads every list, keeps only valid ones, and installs a new version when something changed.
   * The version it replaces is kept for rollback. Lists that fail keep their current copy.
   */
  async update(): Promise<UpdateResult> {
    const base = await this.load()
    const texts = new Map(base.texts)
    const manifest: Manifest = { ...base.manifest, lists: { ...base.manifest.lists } }
    const result: UpdateResult = { updated: [], unchanged: [], failed: [], version: base.manifest.version }
    const now = this.now()
    await Promise.all(
      this.downloadable.map(async (item) => {
        try {
          const res = await this.o.fetchFn(item.url, { signal: AbortSignal.timeout(60_000) })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const text = await res.text()
          const previous = base.manifest.lists[item.id]
          const problem = validateList(text, item.kind, this.o.catalog.minFilters, previous?.rules)
          if (problem) throw new Error(problem)
          const checksum = sha256(text)
          if (checksum === previous?.checksum) {
            result.unchanged.push(item.id)
            return
          }
          texts.set(item.id, text)
          manifest.lists[item.id] = { file: `${item.id}.txt`, checksum, bytes: Buffer.byteLength(text), rules: item.kind === 'list' ? countRules(text) : undefined, updatedAt: now, source: 'downloaded' }
          result.updated.push(item.id)
        } catch (err) {
          result.failed.push({ id: item.id, reason: err instanceof Error ? err.message : String(err) })
        }
      })
    )
    if (!result.updated.length) {
      // Nothing new: just remember when this was checked.
      await writeFile(join(this.currentDir, 'manifest.json'), JSON.stringify({ ...base.manifest, checkedAt: now }, null, 2))
      return result
    }
    manifest.version = new Date(now).toISOString()
    manifest.updatedAt = now
    manifest.checkedAt = now
    await this.writeSet(this.stagingDir, manifest, texts)
    await rm(this.previousDir, { recursive: true, force: true })
    await rename(this.currentDir, this.previousDir)
    await rename(this.stagingDir, this.currentDir)
    result.version = manifest.version
    return result
  }

  /** Swaps the current and previous versions. */
  async rollback(): Promise<void> {
    if (!(await this.exists(this.previousDir))) throw new Error('There is no earlier version of the filter lists to go back to.')
    const swap = join(this.o.dir, 'swap')
    await rm(swap, { recursive: true, force: true })
    await rename(this.currentDir, swap)
    await rename(this.previousDir, this.currentDir)
    await rename(swap, this.previousDir)
  }

  async readEngine(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(join(this.enginesDir, `${key}.bin`)))
    } catch {
      return null
    }
  }

  /** Saves a compiled engine and removes caches for lists that are no longer in use. */
  async writeEngine(key: string, bytes: Uint8Array, keep: string[]): Promise<void> {
    await mkdir(this.enginesDir, { recursive: true })
    await writeFile(join(this.enginesDir, `${key}.bin`), bytes)
    for (const file of await readdir(this.enginesDir)) {
      if (!keep.includes(file.replace(/\.bin$/, ''))) await rm(join(this.enginesDir, file), { force: true })
    }
  }

  async discardEngine(key: string): Promise<void> {
    await rm(join(this.enginesDir, `${key}.bin`), { force: true })
  }
}
