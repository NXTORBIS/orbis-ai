import { promises as fs } from 'node:fs'
import { readStored } from './storedFile.ts'
import { dirname, join } from 'node:path'
import { dataDirFor } from '../shared/profiles.ts'
import {
  cleanSecurityEvent,
  cleanSecurityEvents,
  MAX_SECURITY_EVENTS,
  type SecurityEvent
} from '../shared/securityEvents.ts'

/**
 * What Orbis records about its own security.
 *
 * Per profile, on this computer, and nowhere else. The shape an event may have is fixed in `shared/securityEvents.ts` and
 * enforced on the way in, so this file cannot hold an address, a page or a credential even if something tried to put one
 * there.
 *
 * Two things shape the design. Recording must not make the thing being recorded wait -- a security log that cost a disk
 * write per tab switch would be a safety setting with a cost, and those get switched off -- so `record` returns nothing
 * and the write is batched. And an event recorded a moment before Orbis quits must not be the one that is lost, so the
 * in-memory list is authoritative from the instant `record` returns: what is on disk is caught up with, not waited for.
 */

const FILE = 'security-log.json'
/** How long a write waits for company. Short enough that a crash loses almost nothing, long enough to batch a burst. */
const FLUSH_MS = 1500

export class SecurityLog {
  private readonly userData: string
  /** The list, authoritative. Holds events recorded before the file was read, and gains the file's on top of them. */
  private readonly events = new Map<string, SecurityEvent[]>()
  /** The read of each profile's file, once. Held as a promise so two records in the same tick do not read it twice. */
  private readonly reading = new Map<string, Promise<void>>()
  private readonly dirty = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly now: () => number

  constructor(userData: string, now: () => number = Date.now) {
    this.userData = userData
    this.now = now
  }

  private path(profileId: string): string {
    return join(this.userData, dataDirFor(profileId), FILE)
  }

  private list(profileId: string): SecurityEvent[] {
    const found = this.events.get(profileId)
    if (found) return found
    const made: SecurityEvent[] = []
    this.events.set(profileId, made)
    return made
  }

  /**
   * Catches up with what is on disk.
   *
   * Merged into whatever is already in memory rather than replacing it, because something may have been recorded while
   * this was reading -- and the thing recorded a moment ago is exactly the thing worth keeping.
   */
  /** Profiles whose log file is there and could not be read. A shorter log is never written over those. */
  private readonly unreadable = new Set<string>()

  private read(profileId: string): Promise<void> {
    const already = this.reading.get(profileId)
    if (already) return already
    const job = (async () => {
      let fromDisk: SecurityEvent[] = []
      try {
        const stored = await readStored(this.path(profileId))
        if (stored.kind === 'unreadable') this.unreadable.add(profileId)
        else this.unreadable.delete(profileId)
        fromDisk = stored.kind === 'read' ? cleanSecurityEvents(JSON.parse(stored.text)) : []
      } catch {
        // No log yet, or one that cannot be read. An empty log is the right answer to both: this is a record of what
        // happened, and a record that cannot be read has nothing to say.
        fromDisk = []
      }
      const merged = [...this.list(profileId), ...fromDisk]
      merged.sort((a, b) => b.at - a.at)
      if (merged.length > MAX_SECURITY_EVENTS) merged.length = MAX_SECURITY_EVENTS
      this.events.set(profileId, merged)
    })()
    this.reading.set(profileId, job)
    return job
  }

  /**
   * Records something.
   *
   * Returns nothing, and cannot be awaited: that is the point. It cleans the event now -- which is what enforces the
   * shape -- puts it in the list now, and writes it later.
   */
  record(profileId: string, raw: unknown): void {
    const event = cleanSecurityEvent(raw, this.now())
    if (!event || !profileId) return
    const events = this.list(profileId)
    events.unshift(event)
    if (events.length > MAX_SECURITY_EVENTS) events.length = MAX_SECURITY_EVENTS
    this.dirty.add(profileId)
    // Started, not waited for. By the time it finishes this event is already in the list it merges into.
    void this.read(profileId)
    this.arm()
  }

  private arm(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, FLUSH_MS)
    this.timer.unref?.()
  }

  /** Writes whatever is waiting. Called on the timer, when the profile changes, and before quitting. */
  async flush(): Promise<void> {
    const pending = [...this.dirty]
    this.dirty.clear()
    for (const profileId of pending) {
      // The file first, so a flush never writes a list that is missing what was already on disk.
      await this.read(profileId)
      const events = this.events.get(profileId) ?? []
      const path = this.path(profileId)
      try {
        await fs.mkdir(dirname(path), { recursive: true })
        // Beside and renamed over, so a log is never half-written. Mode 0600 because although it holds no secret, it does
        // say when somebody was at their computer, and that is theirs.
        // A log that could not be read is left alone: it is the record of what happened, and a shorter one
        // written over it is worse than a gap in what is shown.
        if (this.unreadable.has(profileId)) {
          this.unreadable.delete(profileId)
          continue
        }
        await fs.writeFile(`${path}.tmp`, JSON.stringify(events), { mode: 0o600 })
        await fs.rename(`${path}.tmp`, path)
      } catch {
        // A log that cannot be written is not a reason to stop. It goes back as dirty so the next flush tries again.
        this.dirty.add(profileId)
      }
    }
  }

  async all(profileId: string): Promise<SecurityEvent[]> {
    await this.read(profileId)
    return [...(this.events.get(profileId) ?? [])]
  }

  /** Everything forgotten, on purpose, because somebody asked. */
  async clear(profileId: string): Promise<void> {
    await this.read(profileId)
    this.events.set(profileId, [])
    this.dirty.delete(profileId)
    // The file itself, rather than an empty list in it: "cleared" should leave nothing to read.
    await fs.rm(this.path(profileId), { force: true }).catch(() => undefined)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
