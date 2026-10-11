import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { basename } from 'node:path'
import { damageNote, openStored } from '../storedFile.ts'

/**
 * One file per profile, held in memory, written a moment after it changes.
 *
 * The other store in this folder, `JsonFile`, is one file that moves between profiles when the profile changes.
 * This is the other arrangement: several profiles' files open at once, each with its own contents, its own
 * pending write and its own timer. Markets, Pages, generated Pages and Tab Lock each need that -- the window can
 * be showing one profile while a background job finishes writing another's -- and each of them had written the
 * same hundred lines to get it.
 *
 * ## The four rules it exists to keep in one place
 *
 * **A file that could not be read is never written over.** On Windows a file is unreadable for a moment often
 * enough to matter: antivirus has it open, a backup is copying it, the last process still holds a handle. The
 * reader hands back defaults so the application keeps working, and `unreadable` remembers that nothing may be
 * written to that path until it has been read. Overwriting is not recoverable; refusing is.
 *
 * **A refused write is reported as a refusal, before anything changes.** `forWrite` throws rather than handing
 * back a copy somebody is about to edit. Without that, a save that will be refused has already returned the new
 * favourite and `true`, so the screen says it saved and nothing was written -- which is worse than being told it
 * failed, because nobody goes looking.
 *
 * **A write is never half a file.** Written beside and renamed over, so an interruption leaves the old file.
 *
 * **Quitting is not a reason to overwrite something nobody understood.** `flushSync` keeps the same refusal.
 */

export interface ProfileJsonFileOptions<T> {
  /** Where this profile's file is. */
  fileFor(profileId: string): string
  /** A fresh empty value. A function, not a constant: a shared object would be shared between profiles. */
  empty(): T
  /** Reads the file's text. Throwing means the file is damaged, which moves it aside rather than over. */
  parse(text: string): T
  /** The text to write. Defaults to plain JSON. */
  write?(value: T): string
  /** How long after a change to write, in milliseconds. */
  delayMs?: number
  /** What to say when a profile's file could not be read and a change was refused. */
  refusal?(profileId: string): string
  /** What to call this in a message about a damaged file. Defaults to the file's own name. */
  what?: string
}

const DEFAULT_DELAY = 400

export class ProfileJsonFile<T> {
  private readonly o: ProfileJsonFileOptions<T>

  private readonly cache = new Map<string, T>()

  private readonly dirty = new Set<string>()

  private readonly timers = new Map<string, NodeJS.Timeout>()

  /**
   * Profiles whose file may not be written over: one is there, and it was neither read nor moved out of the way.
   *
   * Set from `mayWrite` rather than worked out here, so the rule lives in `storedFile.ts` alone. It stays set
   * until the file is looked at again, which is the next time this profile's cache is empty.
   */
  private readonly unreadable = new Set<string>()

  /**
   * Reads already in flight, by profile.
   *
   * Two things asking for the same profile at the same time is ordinary -- a screen opening while a background job
   * finishes -- and without this both would open the file. For a damaged file that means quarantining it twice,
   * and the second rename finds nothing there and reports that it could not be moved, which turns a file that was
   * saved into one that may not be written.
   */
  private readonly reading = new Map<string, Promise<T>>()

  /** What went wrong opening each profile's file, in words somebody would recognise. Only the ones that went wrong. */
  private readonly damage = new Map<string, string>()

  constructor(options: ProfileJsonFileOptions<T>) {
    this.o = options
  }

  /** This profile's contents, read once and then held. Never throws: a file that cannot be read gives defaults. */
  async read(profileId: string): Promise<T> {
    const held = this.cache.get(profileId)
    if (held !== undefined) return held
    const already = this.reading.get(profileId)
    if (already) return already

    const opening = (async (): Promise<T> => {
      const opened = await openStored(this.o.fileFor(profileId), (text) => this.o.parse(text), this.o.empty)
      if (opened.mayWrite) this.unreadable.delete(profileId)
      else this.unreadable.add(profileId)
      const note = damageNote(opened, this.o.what ?? basename(this.o.fileFor(profileId)))
      if (note) this.damage.set(profileId, note)
      else this.damage.delete(profileId)
      this.cache.set(profileId, opened.value)
      return opened.value
    })()

    this.reading.set(profileId, opening)
    try {
      return await opening
    } finally {
      this.reading.delete(profileId)
    }
  }

  /**
   * What went wrong opening this profile's file, in plain words. Null when nothing did.
   *
   * Kept because throwing it away and remembering only "may I write" leaves a damaged file looking exactly like a
   * brand-new profile: no lists, no record, and nothing anywhere mentioning the `.unreadable-` file holding the
   * real contents in the same folder. Answers from the last read, so it is worth asking after one.
   */
  problem(profileId: string): string | null {
    return this.damage.get(profileId) ?? null
  }

  /**
   * The same read, for something that is about to change this profile's file.
   *
   * A read that will only be shown can happily hand back defaults for a file Orbis could not make sense of. A read
   * that is about to be followed by a save cannot, because the save will be refused and the caller will already
   * have reported success.
   */
  async forWrite(profileId: string): Promise<T> {
    const value = await this.read(profileId)
    if (this.unreadable.has(profileId)) throw new Error(this.o.refusal?.(profileId) ?? REFUSAL)
    return value
  }

  /** Whether this profile's file may be written at all. Null until it has been looked at. */
  writable(profileId: string): boolean | null {
    if (!this.cache.has(profileId)) return null
    return !this.unreadable.has(profileId)
  }

  /** Replaces this profile's contents and arranges for the file to be written shortly. */
  set(profileId: string, value: T): void {
    this.cache.set(profileId, value)
    this.touch(profileId)
  }

  /**
   * Reads for writing, hands the value to `change`, and keeps whatever comes back.
   *
   * The usual way to change one of these. `change` may return nothing, which keeps the value it was given -- for
   * the stores that edit in place.
   */
  async change<R>(profileId: string, change: (value: T) => R | Promise<R>): Promise<R> {
    const value = await this.forWrite(profileId)
    const result = await change(value)
    this.touch(profileId)
    return result
  }

  /** Marks this profile as having something to write, and restarts its timer. */
  touch(profileId: string): void {
    this.dirty.add(profileId)
    const already = this.timers.get(profileId)
    if (already) clearTimeout(already)
    this.timers.set(
      profileId,
      setTimeout(() => void this.flushOne(profileId), this.o.delayMs ?? DEFAULT_DELAY)
    )
  }

  /** Forgets what is held for one profile, so the next read looks at the file again. Anything pending is written first. */
  async forget(profileId: string): Promise<void> {
    await this.flushOne(profileId)
    this.cache.delete(profileId)
    this.unreadable.delete(profileId)
  }

  /**
   * Throws away what is held, without writing it.
   *
   * For a profile that has been deleted, and for tests. Deliberately separate from `forget`: writing out a file
   * for a profile somebody has just removed is the one case where flushing first is wrong.
   */
  drop(profileId?: string): void {
    const forOne = (id: string): void => {
      const timer = this.timers.get(id)
      if (timer) clearTimeout(timer)
      this.timers.delete(id)
      this.dirty.delete(id)
      this.cache.delete(id)
      this.unreadable.delete(id)
    }
    if (profileId === undefined) for (const id of [...this.cache.keys(), ...this.timers.keys()]) forOne(id)
    else forOne(profileId)
  }

  private async flushOne(profileId: string): Promise<void> {
    const timer = this.timers.get(profileId)
    if (timer) clearTimeout(timer)
    this.timers.delete(profileId)
    if (!this.dirty.delete(profileId)) return
    const value = this.cache.get(profileId)
    if (value === undefined) return
    /*
     * A file is there that Orbis could not read. It holds what this profile decided, so it is left alone and
     * looked at again next time rather than written over with defaults. The mark is deliberately not cleared
     * here: clearing it let the very next save through a moment later, which is the write this branch exists
     * to stop.
     */
    if (this.unreadable.has(profileId)) return

    const file = this.o.fileFor(profileId)
    await fs.mkdir(dirname(file), { recursive: true })
    const beside = `${file}.tmp`
    // Written beside, then moved over: an interrupted write leaves the old file rather than half of the new one.
    await fs.writeFile(beside, this.text(value), { encoding: 'utf8', mode: 0o600 })
    await fs.rename(beside, file)
  }

  /** Writes everything pending, and waits for it. Used before quitting and by tests. */
  async flush(): Promise<void> {
    await Promise.all([...this.dirty].map((profileId) => this.flushOne(profileId)))
  }

  /**
   * The same, without waiting, for the very end of the process.
   *
   * Nothing is reported, because there is nowhere left to report it and nothing that could act on it.
   */
  flushSync(): void {
    for (const profileId of [...this.dirty]) {
      const value = this.cache.get(profileId)
      if (value === undefined) continue
      // Quitting is not a reason to overwrite something Orbis never understood.
      if (this.unreadable.has(profileId)) continue
      try {
        const file = this.o.fileFor(profileId)
        mkdirSync(dirname(file), { recursive: true })
        const beside = `${file}.tmp`
        writeFileSync(beside, this.text(value), { encoding: 'utf8', mode: 0o600 })
        renameSync(beside, file)
        this.dirty.delete(profileId)
      } catch {
        // Nowhere to say so.
      }
    }
  }

  private text(value: T): string {
    return this.o.write ? this.o.write(value) : JSON.stringify(value)
  }
}

const REFUSAL =
  'Orbis could not make sense of this profile’s file, so nothing was changed. It has been left exactly as it is.'
