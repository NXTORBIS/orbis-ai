import { promises as fs } from 'node:fs'
import { openStored } from './storedFile.ts'
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

/**
 * What a log file says, or a throw.
 *
 * It throws rather than shrugging, and that is the point: `openStored` reads a throw as damage, which moves the file
 * aside with its bytes intact before anything is written in its place. A file that holds something other than a list of
 * events is one of three things -- half of a rename a crash interrupted, a truncated write, or a log a newer Orbis
 * wrote in a shape this one has never heard of -- and all three are a file worth keeping, not a file worth replacing
 * with whatever this session happened to log.
 *
 * A list that held entries and yielded no events is the same case. `cleanSecurityEvents` drops what it does not
 * recognise, so a newer Orbis's log would otherwise arrive here as an empty list and read as "nothing happened".
 */
function readLog(text: string): SecurityEvent[] {
  const raw: unknown = JSON.parse(text)
  if (!Array.isArray(raw)) throw new Error('a security log is a list of events')
  const events = cleanSecurityEvents(raw)
  if (raw.length > 0 && events.length === 0) throw new Error('nothing in this log is an event Orbis knows')
  return events
}

export class SecurityLog {
  private readonly userData: string
  /** The list, authoritative. Holds events recorded before the file was read, and gains the file's on top of them. */
  private readonly events = new Map<string, SecurityEvent[]>()
  /** The read of each profile's file, once. Held as a promise so two records in the same tick do not read it twice. */
  private readonly reading = new Map<string, Promise<void>>()
  private readonly dirty = new Set<string>()
  /** Profiles whose log file is there and was not understood. A shorter log is never written over those. */
  private readonly unreadable = new Set<string>()
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
  private read(profileId: string): Promise<void> {
    const already = this.reading.get(profileId)
    if (already) return already
    const job = (async () => {
      // Through `openStored` rather than a read with the parse inside the same `try`, because the two ways a file can
      // fail want opposite things done and that one `try` made them identical. A log that is merely unreadable -- a
      // backup tool holding it open -- must be left alone. A log that is there and cannot be made sense of is moved
      // aside first, with its bytes kept, and only then may a new one be written where it was. Lumping either in with
      // "no log yet" truncated the trail to whatever this session happened to log, which is the worst failure a
      // security log has: the short list still reads as complete, so nobody knows to look for the rest.
      const opened = await openStored<SecurityEvent[]>(this.path(profileId), readLog, () => [], this.now())
      if (opened.mayWrite) this.unreadable.delete(profileId)
      else this.unreadable.add(profileId)
      const merged = [...this.list(profileId), ...opened.value]
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
      // A log that could not be read is left alone: it is the record of what happened, and a shorter one written over
      // it is worse than a gap in what is shown. The refusal used to be dropped as soon as one flush had skipped, and
      // because the read is only ever done once per profile nothing put it back -- so the flush after that wrote the
      // short list over the file regardless, and the refusal protected the log for a second and a half.
      if (this.unreadable.has(profileId)) continue
      const events = this.events.get(profileId) ?? []
      const path = this.path(profileId)
      try {
        await fs.mkdir(dirname(path), { recursive: true })
        // Beside and renamed over, so a log is never half-written. Mode 0600 because although it holds no secret, it does
        // say when somebody was at their computer, and that is theirs.
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
    const gone = await fs
      .rm(this.path(profileId), { force: true })
      .then(() => true)
      .catch(() => false)
    // Nothing is there now, so the refusal has nothing left to protect and this profile can be written again. Only on
    // a removal that worked: if the file resisted being deleted it is still there and still not understood, and
    // forgetting that is how the next flush would write over it.
    if (gone) this.unreadable.delete(profileId)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
