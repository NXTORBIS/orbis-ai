/**
 * How a Chess World screen keeps what it has, now that the profile is where it goes.
 *
 * Three screens kept their own record in this window's own storage, because there was nowhere else for it: the
 * settings, the puzzle collection and the Academy. There is somewhere else now -- five files in the profile, behind
 * `window.api.chessSettings()` and the nine channels beside it -- and this is the part of that move the three
 * screens have in common.
 *
 * Nothing here touches the document or React, so all of it can be tested with `node --test`. The window's own
 * storage is reached through `BrowserStore` and the channels through two functions, both handed in.
 *
 * ## Three states, because they are three different sentences
 *
 * Reading the profile takes a moment, and that moment is the whole reason this file exists. A screen must be able to
 * tell apart:
 *
 *   **not read yet** -- show that it is reading. Not zeros, not defaults, not an empty state. Defaults drawn before
 *   the answer arrives are indistinguishable from "your record is gone", and a screen that flashes the second one at
 *   somebody who has months of work is the worst thing any of this could do.
 *
 *   **read, and there was nothing** -- a profile that has never kept this. Defaults, and nothing said about it.
 *
 *   **read, and it could not be read** -- the file is there and Orbis could not make sense of it. The store has
 *   already left it alone and said why in a sentence written to be shown. **Show it**, and write nothing: that
 *   sentence is the whole point of the store refusing.
 *
 * ## Bringing the old copy across
 *
 * `firstRead` does it once, and the care is all in the conditions. See its own note.
 */

// ---------------------------------------------------------------- what an answer looks like

/** What the channels answer with. The same shape for a read and for a save; `src/shared/chess/kept.ts` says why. */
export interface Answer<T> {
  value: T
  notes: readonly string[]
  refused: string | null
}

/** The same, plus what was brought across from this window's storage on the way. */
export interface FirstRead<T> extends Answer<T> {
  /** What was brought across, in a sentence to show. Null when nothing was. */
  carried: string | null
}

// ---------------------------------------------------------------- this window's own storage

/**
 * This window's storage, reached in a way that cannot throw.
 *
 * `localStorage` throws on *access* in a private window and with site data blocked -- not on read, on touching it at
 * all -- so every call is wrapped and `reachable` is the answer to "is there any point asking".
 */
export interface BrowserStore {
  get(key: string): string | null
  /** True when it really was written. */
  set(key: string, value: string): boolean
  remove(key: string): void
  /** False when this window will not let Orbis use its storage at all. */
  reachable: boolean
}

let held: BrowserStore | null = null

/** This window's storage, made once. Whether it can be reached is asked once rather than on every read. */
export function windowStore(): BrowserStore {
  if (held === null) held = openWindowStore()
  return held
}

function openWindowStore(): BrowserStore {
  let reachable = true
  try {
    // Touching it is the test. A window with site data blocked throws here rather than returning nothing.
    window.localStorage.getItem('orbis.chess.reachable')
  } catch {
    reachable = false
  }
  return {
    reachable,
    get: (key) => {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return null
      }
    },
    set: (key, value) => {
      try {
        window.localStorage.setItem(key, value)
        return true
      } catch {
        // Blocked, or full. Either way it was not written, and the caller is entitled to know that.
        return false
      }
    },
    remove: (key) => {
      try {
        window.localStorage.removeItem(key)
      } catch {
        // Nothing to remove, or storage is unreachable, which the caller has already been told.
      }
    }
  }
}

// ---------------------------------------------------------------- bringing the old copy across

/**
 * Where it is recorded that an old copy has already been brought into a profile.
 *
 * **In this window's storage, deliberately, and not in the profile.** The thing being moved is one copy belonging to
 * this computer -- `localStorage` is per window origin and knows nothing about profiles -- so the record of having
 * moved it belongs in the same place, where every profile can see it. Put that record in the profile instead and the
 * second profile to open Chess World finds no record of its own, helps itself to the same copy, and ends up holding
 * the first person's puzzle history. That is the one outcome this whole mechanism exists to prevent.
 */
export const CARRIED_KEY = 'orbis.chess.carried.v1'

/** Which old copies have been brought across, and when. Junk in this key is read as nothing having been. */
function carriedAlready(storage: BrowserStore): Record<string, number> {
  const text = storage.get(CARRIED_KEY)
  if (text === null) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function record(storage: BrowserStore, key: string, at: number): boolean {
  const held = carriedAlready(storage)
  return storage.set(CARRIED_KEY, JSON.stringify({ ...held, [key]: at }))
}

/**
 * Settles the old copy's claim without moving it.
 *
 * For "forget everything", which is the one place where a profile becoming empty is somebody's decision rather than
 * its state. Without this, a record emptied on purpose is an empty profile with an unsettled old copy beside it, and
 * the next launch would bring that copy back -- which is the opposite of what the button said it would do.
 */
export function markCarried(storage: BrowserStore, key: string, at: number): void {
  record(storage, key, at)
}

function unrecord(storage: BrowserStore, key: string): void {
  const held = carriedAlready(storage)
  delete held[key]
  storage.set(CARRIED_KEY, JSON.stringify(held))
}

/**
 * The first read of one of the five profile files, bringing the old window-storage copy in if there is room for it.
 *
 * The conditions, each with the thing it stops:
 *
 * **The profile's file could not be read** -- nothing is brought across and nothing is written. The file is there and
 * holds what somebody decided; writing an old copy over it would be exactly the loss the store refuses to allow.
 *
 * **The profile already holds something** -- nothing is brought across. Not "the file is missing" but "there is
 * nothing in it", because a file that exists and is empty has the same claim on an old copy as one that was never
 * written: if the profile has no puzzles and this window has a year of them, they should be in the profile.
 *
 * **It has been brought across before** -- nothing is brought across, however empty the profile is. This is the
 * profile-switch guard, and it is also what stops a carry-over resurrecting a collection somebody deleted.
 *
 * **The old copy cannot be read** -- nothing is brought across, it is left exactly where it is, and that is said.
 *
 * The move is **recorded before it is sent and taken back if the send was refused.** Recording first, because a move
 * that cannot be recorded would be made again for the next profile that opened Chess World, and handing one person's
 * record to another is worse than leaving it where it is. Taken back on a refusal, because nothing landed, so there
 * is nothing to protect -- and the next launch should try again.
 *
 * The old copy is **never removed**. Two reasons: somebody who goes back to an older Orbis would otherwise find their
 * record gone, and a copy nobody is reading costs nothing.
 */
export async function firstRead<T>(o: {
  /** The window-storage key the old copy is under. */
  key: string
  /** What this is, in the words somebody would use, for the sentences below. */
  what: string
  read: () => Promise<Answer<T>>
  save: (value: T) => Promise<Answer<T>>
  /** True when the profile holds nothing at all, so there is room to bring the old copy in. */
  isEmpty: (value: T) => boolean
  /** The old copy in the shape the profile wants, or null when the stored text could not be read. */
  fromBrowser: (text: string) => T | null
  storage: BrowserStore
  now: () => number
}): Promise<FirstRead<T>> {
  const answer = await o.read()
  const plain = { ...answer, carried: null }
  if (answer.refused !== null) return plain
  if (!o.isEmpty(answer.value)) return plain
  if (!o.storage.reachable) return plain
  if (carriedAlready(o.storage)[o.key] !== undefined) return plain

  const text = o.storage.get(o.key)
  if (text === null || text.trim() === '') return plain

  const old = o.fromBrowser(text)
  if (old === null) {
    return {
      ...plain,
      notes: [
        ...answer.notes,
        `There is something kept for your ${o.what} in this window's own storage and Orbis could not read it, so nothing was brought into this profile. It has been left exactly as it is.`
      ]
    }
  }

  if (!record(o.storage, o.key, o.now())) {
    return {
      ...plain,
      notes: [
        ...answer.notes,
        `Your ${o.what} are still kept in this window's own storage and could not be moved into this profile, because Orbis cannot write to that storage to record the move. Nothing has been lost; it is all still there.`
      ]
    }
  }

  let saved: Answer<T>
  try {
    saved = await o.save(old)
  } catch (err) {
    unrecord(o.storage, o.key)
    return {
      ...plain,
      notes: [...answer.notes, `Your ${o.what} could not be moved into this profile (${reason(err)}). They are still in this window's own storage and Orbis will try again next time.`]
    }
  }
  if (saved.refused !== null) {
    unrecord(o.storage, o.key)
    return { ...saved, carried: null }
  }
  return {
    ...saved,
    carried: `Your ${o.what} have been brought into this profile from this window's own storage, where Chess World used to keep them. The old copy has been left where it is.`
  }
}

/** An error in words somebody could read, with the channel's own wrapping taken off the front. */
export function reason(err: unknown): string {
  if (!(err instanceof Error)) return 'no reason was given'
  return err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

// ---------------------------------------------------------------- not one message per change

/**
 * Sends the newest value and nothing in between.
 *
 * The screens change their record a lot -- a solved puzzle, a lesson block, a slider being dragged -- and each change
 * used to be one `localStorage.setItem`, which costs nothing. Each one is now a message across the boundary and a
 * write to a file, so sending one per change would be a round trip per keypress-worth of work.
 *
 * Two timers rather than one. The short one restarts on every change, so a burst collapses into a single send. The
 * long one does **not** restart, so a stream of changes that never pauses still lands at least every `maxDelayMs`
 * rather than being held for as long as somebody keeps working. A debounce without that second timer is how a
 * forty-minute session saves nothing at all.
 *
 * `flush` is what a screen calls when it goes away or the window is closing, which is the one gap this introduces
 * over writing straight to storage: a value held in the short timer is a value not yet sent.
 */
export interface Coalesced<T> {
  /** Replaces whatever is waiting. */
  queue(value: T): void
  /** Sends what is waiting now, and waits for it. */
  flush(): Promise<void>
  /** Throws away what is waiting without sending it. For tests, and for a record being started again. */
  drop(): void
  /** True when something is waiting to be sent. */
  waiting(): boolean
}

export function coalesced<T>(send: (value: T) => Promise<void>, o: { delayMs?: number; maxDelayMs?: number } = {}): Coalesced<T> {
  const delayMs = o.delayMs ?? 400
  const maxDelayMs = o.maxDelayMs ?? 2500
  let pending: { value: T } | null = null
  let short: ReturnType<typeof setTimeout> | null = null
  let long: ReturnType<typeof setTimeout> | null = null
  /** Sends are chained, so two of them can never arrive out of the order they were made in. */
  let sending: Promise<void> = Promise.resolve()

  const clear = (): void => {
    if (short !== null) {
      clearTimeout(short)
      short = null
    }
    if (long !== null) {
      clearTimeout(long)
      long = null
    }
  }

  const go = (): Promise<void> => {
    clear()
    const held = pending
    pending = null
    if (held === null) return sending
    sending = sending.then(() => send(held.value)).catch(() => undefined)
    return sending
  }

  return {
    queue: (value) => {
      pending = { value }
      if (short !== null) clearTimeout(short)
      short = setTimeout(() => void go(), delayMs)
      if (long === null) long = setTimeout(() => void go(), maxDelayMs)
    },
    flush: () => go(),
    drop: () => {
      clear()
      pending = null
    },
    waiting: () => pending !== null
  }
}
