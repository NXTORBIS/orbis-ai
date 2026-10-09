import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import { damageNote, openStored } from '../storedFile.ts'
import { dirname, join } from 'node:path'
import { dataDirFor } from '../../shared/profiles.ts'

/**
 * Small JSON stores for the things a person keeps in Orbis (notes, tasks, clipboard history and, later, boards and
 * workspaces): everything is held in memory, written atomically, and written at most a few times a second no matter how
 * fast someone types. Anything unreadable on disk is dropped rather than breaking the feature.
 */

const WRITE_DELAY = 200

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

  constructor(path: string, fallback: () => T, parse: (raw: unknown) => T) {
    this.path = path
    this.fallback = fallback
    this.parse = parse
  }

  /** Looks at the file once, and decides from that whether it may ever be written over. */
  private async open(): Promise<void> {
    if (this.writable !== null) return
    const opened = await openStored(this.path, (text) => this.parse(JSON.parse(text)), this.fallback)
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
    const data = JSON.stringify(this.value)
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

  constructor(path: string, normalize: (raw: unknown) => T | null, limit = 5000) {
    this.normalize = normalize
    this.limit = limit
    this.file = new JsonFile<T[]>(
      path,
      () => [],
      (raw) => (Array.isArray(raw) ? raw.map((item) => this.normalize(item)).filter((item): item is T => item !== null).slice(0, this.limit) : [])
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
