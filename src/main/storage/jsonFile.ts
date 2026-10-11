import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { damageNote, openStored } from '../storedFile.ts'
import { dataDirFor } from '../../shared/profiles.ts'

/**
 * The small JSON store the rest of Orbis is built on.
 *
 * Everything is held in memory, written atomically, and written at most a few times a second however fast somebody
 * types. It began life in `personal/` for notes and tasks; twelve features use it now -- courses, music, student,
 * ambient, native apps, notifications, decisions and the rest -- which is why it lives here instead.
 *
 * ## Four cases on opening, and only one of them writes
 *
 * `storedFile.ts` decides which: missing means start from defaults and write; readable and parsable means use it;
 * readable and not parsable means move it aside first and then write; and unreadable means use the defaults and
 * **never write**, because something is there that nobody has read. On Windows a file is routinely unreadable for a
 * moment -- antivirus has it open, a backup is copying it -- and the old behaviour renamed defaults over real data.
 *
 * ## The path is taken at flush time, not at queue time
 *
 * A write queued before a profile switch has to land in the profile it came from. `flush` reads `this.path` into a
 * local before the write starts, so changing profiles midway cannot send one person's notes into another's folder.
 *
 * ## Versioning
 *
 * A file may be written as `{ v, data }`. Both shapes are read: a bare value is treated as version 1, which is what
 * every file written before this existed is. `migrate` is given the raw contents and the version they were written
 * at, and returns something the parser can read. A version from the future is left alone -- a newer Orbis wrote it,
 * and reading it anyway would mean writing back a worse copy.
 */

const WRITE_DELAY = 200

export interface JsonFileOptions {
  /** The shape this code writes. Files without one are treated as version 1. */
  version?: number
  /** Brings an older file forward. Given the raw contents and the version they were written at. */
  migrate?: (raw: unknown, from: number) => unknown
}

export class JsonFile<T> {
  private value: T | null = null
  private writing: Promise<void> = Promise.resolve()
  private timer: NodeJS.Timeout | null = null
  private dirty = false
  /**
   * Whether this file may be written over. Null until the file has been looked at.
   *
   * Reading used to be `try { ... } catch { defaults }`, which makes a file that could not be read look exactly like
   * one that is not there -- and on Windows a file is routinely unreadable for a moment while something else holds it.
   * The next write then put defaults over real data. False means something is there that was not understood, so
   * nothing is written at all until it can be read.
   */
  private writable: boolean | null = null
  /** What to tell somebody, if anything went wrong opening it. */
  private damage: string | null = null

  private path: string
  private readonly fallback: () => T
  private readonly parse: (raw: unknown) => T
  private readonly version: number
  private readonly migrate: ((raw: unknown, from: number) => unknown) | null

  constructor(path: string, fallback: () => T, parse: (raw: unknown) => T, options: JsonFileOptions = {}) {
    this.path = path
    this.fallback = fallback
    this.parse = parse
    this.version = options.version ?? 1
    this.migrate = options.migrate ?? null
  }

  /**
   * Reads one file's text into a value, bringing an older shape forward on the way.
   *
   * Throwing is how `openStored` is told the file is damaged rather than merely unreadable, so a file this code
   * cannot make sense of -- including one written by a newer Orbis -- throws from here and is moved aside rather
   * than silently replaced.
   */
  private fromText(text: string): T {
    const parsed: unknown = JSON.parse(text)
    const wrapped =
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && typeof (parsed as { v?: unknown }).v === 'number'
        ? (parsed as { v: number; data?: unknown })
        : null

    // No wrapper: every file written before versioning existed, which is version 1 by definition.
    if (!wrapped) return this.parse(this.migrate && this.version > 1 ? this.migrate(parsed, 1) : parsed)

    if (wrapped.v > this.version) {
      throw new Error(`written by a newer Orbis (version ${wrapped.v}, this one reads ${this.version})`)
    }
    return this.parse(wrapped.v < this.version && this.migrate ? this.migrate(wrapped.data, wrapped.v) : wrapped.data)
  }

  /** Looks at the file once, and decides from that whether it may ever be written over. */
  private async open(): Promise<void> {
    if (this.writable !== null) return
    const opened = await openStored(this.path, (text) => this.fromText(text), this.fallback)
    this.writable = opened.mayWrite
    this.damage = damageNote(opened, basename(this.path))
    if (this.value === null) this.value = opened.value
  }

  /** What went wrong opening this file, in plain words. Null when nothing did. */
  problem(): string | null {
    return this.damage
  }

  async read(): Promise<T> {
    await this.open()
    if (this.value === null) this.value = this.fallback()
    return this.value
  }

  /** Replaces the contents; the file is written shortly after. */
  async write(value: T): Promise<T> {
    this.value = value
    this.dirty = true
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), WRITE_DELAY)
    return value
  }

  /**
   * Moves to another file: what is pending is written to the file it belongs to first, then the new one is read on
   * next use. Used when the profile changes, so one profile's notes can never be saved into another's.
   */
  async usePath(path: string): Promise<void> {
    if (path === this.path) return
    await this.flush()
    this.path = path
    this.value = null
    // A different file: whether it can be read is a different question.
    this.writable = null
    this.damage = null
  }

  /** Writes now and waits for it (used before quitting, and by tests). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty || this.value === null) return this.writing
    await this.open()
    if (this.writable === false) {
      // Something is there and Orbis could not read it. Refusing is recoverable -- the lock clears, the copy finishes
      // -- and overwriting is not, so what is pending stays pending and is tried again on the next save. The question
      // is asked again next time rather than answered from this one, which is what lets a cleared lock get through.
      this.writable = null
      return this.writing
    }
    this.dirty = false
    // Wrapped only when there is a version worth recording, so a store that never asked for one keeps its old file
    // shape exactly and an older Orbis can still read what this one writes.
    const data = JSON.stringify(this.version > 1 ? { v: this.version, data: this.value } : this.value)
    // The path is taken now, with the data: a write still queued when the file changes must land where it came from.
    const path = this.path
    this.writing = this.writing.then(async () => {
      await fs.mkdir(dirname(path), { recursive: true })
      // Readable by this account only: these files hold notes, clipboard history and whatever else is personal.
      await fs.writeFile(`${path}.tmp`, data, { mode: 0o600 })
      await fs.rename(`${path}.tmp`, path)
    })
    return this.writing.catch(() => undefined)
  }
}

/** A list of items with ids, kept in one file. */
export class Collection<T extends { id: string }> {
  private readonly file: JsonFile<T[]>
  private readonly listeners = new Set<() => void>()

  private readonly normalize: (raw: unknown) => T | null
  private readonly limit: number

  constructor(path: string, normalize: (raw: unknown) => T | null, limit = 5000, options: JsonFileOptions = {}) {
    this.normalize = normalize
    this.limit = limit
    this.file = new JsonFile<T[]>(
      path,
      () => [],
      (raw) => (Array.isArray(raw) ? raw.map((item) => this.normalize(item)).filter((item): item is T => item !== null).slice(0, this.limit) : []),
      options
    )
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener()
  }

  all(): Promise<T[]> {
    return this.file.read()
  }

  async get(id: string): Promise<T | null> {
    return (await this.all()).find((item) => item.id === id) ?? null
  }

  /** Adds or replaces one item, after checking it. Returns what was stored. */
  async put(raw: unknown): Promise<T> {
    const item = this.normalize(raw)
    if (!item) throw new Error('That item is missing what it needs to be saved.')
    const items = await this.all()
    const index = items.findIndex((x) => x.id === item.id)
    const next = index >= 0 ? items.map((x, i) => (i === index ? item : x)) : [item, ...items].slice(0, this.limit)
    await this.file.write(next)
    this.changed()
    return item
  }

  async remove(id: string): Promise<boolean> {
    const items = await this.all()
    const next = items.filter((item) => item.id !== id)
    if (next.length === items.length) return false
    await this.file.write(next)
    this.changed()
    return true
  }

  /** Replaces everything (reordering, bulk edits, imports). */
  async replace(items: unknown[]): Promise<T[]> {
    const clean = items.map((item) => this.normalize(item)).filter((item): item is T => item !== null).slice(0, this.limit)
    await this.file.write(clean)
    this.changed()
    return clean
  }

  /** Changes several items at once, keeping one write. */
  async update(change: (items: T[]) => T[]): Promise<T[]> {
    const next = change(await this.all()).map((item) => this.normalize(item)).filter((item): item is T => item !== null)
    await this.file.write(next)
    this.changed()
    return next
  }

  flush(): Promise<void> {
    return this.file.flush()
  }

  /** Moves to another file, and tells listeners, since everything they showed has changed. */
  async usePath(path: string): Promise<void> {
    await this.file.usePath(path)
    this.changed()
  }
}

/** Where a profile's personal data lives. The default profile keeps the folder it always used. */
export function personalFile(userData: string, profileId: string, name: string): string {
  return join(userData, dataDirFor(profileId), 'personal', name)
}

/**
 * Where one profile's file for a feature lives: `<userData>/<profile>/<feature>/<name>`.
 *
 * Here so a store says which profile's file it wants rather than each one working out the path, which is how
 * `dataDirFor` ended up imported by sixteen files and redefined locally by a seventeenth.
 */
export function profileFile(userData: string, profileId: string, feature: string, name: string): string {
  return join(userData, dataDirFor(profileId), feature, name)
}
