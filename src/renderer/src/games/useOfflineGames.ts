import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { KeptArcade } from '../../../shared/games/kept'
import { emptyKept, isEmptyKept, keptFromWindowStorage } from '../../../shared/games/kept'
import type { DayRules } from '../../../shared/games/calendar'
import { coalesced, firstRead, reason, windowStore } from '../components/chess/keeping'

/**
 * How the arcade keeps what you have done, now that the profile is where it goes.
 *
 * Everything -- high scores, favourites, what you played last, the preferences, the games left part way through and
 * every run you have finished -- used to be one `localStorage` key. That has three consequences nobody chose: a
 * second Orbis window keeps its own high scores, two people sharing a computer share one table, and a profile taken
 * to another machine arrives with nothing played. It is one file in the profile now, behind `arcade:record` and
 * `arcade:save`.
 *
 * The machinery is Chess World's, imported rather than copied. `components/chess/keeping.ts` already holds the three
 * careful parts -- the one-off carry-over from window storage, the write coalescer with its two timers, and the
 * reason the carry-over marker lives in window storage rather than in the profile -- and copying three hundred lines
 * of that care into a second file is how two versions of it end up disagreeing. The marker's key name is chess's
 * because it is a key already written on people's computers: one map, one entry per old storage key, and renaming it
 * would make every carry-over happen a second time.
 *
 * ## Three states, because they are three different sentences
 *
 * `record` is **null until the profile has answered**. Not defaults, not zeros: defaults drawn before the answer
 * arrives are indistinguishable from "your high scores are gone", and flashing that at somebody with a year of
 * scores is the worst thing any of this could do. Then either the profile had nothing (defaults, and nothing said),
 * or it had something it could not read (`refused` set -- show it, and write nothing).
 *
 * ## The old copy is never deleted
 *
 * It is brought across once, into one profile, and left exactly where it is. Somebody who goes back to an older
 * Orbis finds their scores, and a copy nobody reads costs nothing.
 */

/** Where the window's own copy is, and still is. Never written to again, and never removed. */
export const WINDOW_KEY = 'orbis.offlineGames'

export interface ArcadeKeeping {
  /** Null until the profile has answered. Show that it is reading; never show defaults. */
  record: KeptArcade | null
  /** True while the first read is in flight. */
  reading: boolean
  /** Everything in the record that could not be read, in sentences written to be shown. */
  notes: readonly string[]
  /** Set when the file is there and could not be read, which means nothing may be written over it. Show it. */
  refused: string | null
  /** Set when a save did not happen. Show it: the change is on screen and is not being kept. */
  saveProblem: string | null
  /** What was brought across from this window's storage, in a sentence. Null when nothing was. */
  carried: string | null
}

interface Held extends ArcadeKeeping {
  /** False when nothing may be written, so a change is shown and not sent. */
  canKeep: boolean
}

const EMPTY: Held = { record: null, reading: false, notes: [], refused: null, saveProblem: null, carried: null, canKeep: false }

let state: Held = EMPTY
let loaded = false

const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((one) => one())
const set = (patch: Partial<Held>): void => {
  state = { ...state, ...patch }
  emit()
}

/**
 * Whether the arcade can reach the profile at all.
 *
 * It always can in the Orbis window, where the preload puts these two calls there before the renderer runs. The
 * check is here so that if this screen is ever drawn somewhere without them, the games still work on the window's
 * own copy and say plainly that scores are not following anybody.
 */
const reachable = (): boolean => typeof window.api?.arcadeRecord === 'function' && typeof window.api?.arcadeSave === 'function'

const NO_PROFILE =
  'Orbis cannot reach your profile from here, so your scores are being kept for this window only and will not follow you to another one.'

/**
 * This machine's own mark, made once by the window.
 *
 * `record.ts` uses it so the day's challenge is the same for this machine on this day and different on another, with
 * nothing sent anywhere to arrange it. Made here because the main process must not be the thing that decides it: a
 * profile carried to another computer should keep the challenges it was already working through, which means the
 * mark belongs to the record rather than to the machine the record happens to be on.
 */
const newInstallId = (): string => {
  try {
    return crypto.randomUUID()
  } catch {
    // No crypto (an old embedder, a locked-down context). Any stable-enough value will do: it only has to differ
    // between installations, and a day's challenge is not a secret.
    return `arcade-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
  }
}

// ---------------------------------------------------------------- sending

/**
 * The record on its way to the profile.
 *
 * Coalesced, because the arcade changes it a lot -- a run finishes, a favourite is starred, a puzzle game saves its
 * board every move -- and each change is now a message across the boundary and a write to a file rather than a
 * `localStorage.setItem` that costs nothing.
 *
 * The answer is applied back only when nothing else is waiting. The store's answer is what was really stored, which
 * is the truth worth showing; applying it while another change is queued would put the older record back on screen
 * for as long as the next send takes.
 */
const sender = coalesced<KeptArcade>(async (record) => {
  try {
    const answer = await window.api.arcadeSave(record)
    if (answer.refused !== null) {
      set({ saveProblem: answer.refused, canKeep: false })
      return
    }
    set({
      saveProblem: null,
      notes: answer.notes,
      ...(sender.waiting() ? {} : { record: answer.value })
    })
  } catch (err) {
    set({ saveProblem: `Your scores were not saved (${reason(err)}), so what you have just done will last only as long as this visit.` })
  }
})

// ---------------------------------------------------------------- reading

async function load(): Promise<void> {
  loaded = true
  sender.drop()
  set({ ...EMPTY, reading: true })
  if (!reachable()) {
    // No way to ask the profile. The window's own copy is read instead, and nothing is written anywhere until there
    // is somewhere to write it.
    const text = windowStore().get(WINDOW_KEY)
    const old = text === null ? null : keptFromWindowStorage(text)
    set({ record: old ?? emptyKept(), reading: false, notes: [NO_PROFILE], canKeep: false })
    return
  }
  try {
    const answer = await firstRead<KeptArcade>({
      key: WINDOW_KEY,
      what: 'game scores',
      read: () => window.api.arcadeRecord(),
      save: (record) => window.api.arcadeSave(record),
      // Nothing anybody chose: no scores, no runs, no favourites, no saved games, no goal, and the preferences as
      // they come. An old copy has as good a claim on a file with nothing in it as on one that was never written.
      isEmpty: isEmptyKept,
      // Null means there is something in window storage that could not be read. `firstRead` then leaves it exactly
      // where it is and says so, rather than bringing nothing across silently.
      fromBrowser: (text) => keptFromWindowStorage(text, newInstallId()),
      storage: windowStore(),
      now: Date.now
    })
    const read = answer.value
    set({
      record: read,
      reading: false,
      notes: answer.notes,
      refused: answer.refused,
      saveProblem: null,
      carried: answer.carried,
      canKeep: answer.refused === null
    })
    /*
     * The machine's mark, given to a record that has none.
     *
     * Saved rather than held in memory, because a mark that changed on every launch would give a different day's
     * challenge every time somebody opened the arcade -- and a challenge that moves under you is one nobody can
     * finish. It is written only when the file may be written, so a record that could not be read is left alone.
     */
    if (answer.refused === null && read.record.installId === '') {
      keepArcade({ ...read, record: { ...read.record, installId: newInstallId() } })
    }
  } catch (err) {
    // Asked for, and the question could not be put. The arcade works on an empty record and says why; nothing is
    // written, because nothing is known about what is there.
    set({
      record: emptyKept(),
      reading: false,
      refused: `Your scores could not be read (${reason(err)}). Nothing has been written over them.`,
      canKeep: false
    })
  }
}

/**
 * The record after a change, saved unless saving would write over something unreadable.
 *
 * The change is always shown. That is deliberate: a starred favourite that silently does not star looks like a
 * broken button, and the refusal is already on screen saying why nothing is being kept.
 */
export function keepArcade(next: KeptArcade): void {
  set({ record: next })
  if (!state.canKeep) return
  sender.queue(next)
}

/** Sends what is waiting now. Called when the screen goes away and when the window is closing. */
export const flushArcade = (): Promise<void> => sender.flush()

/**
 * When a day begins, for everything in the arcade that counts days.
 *
 * The hour comes from the record, because somebody who plays at one in the morning will want it moved. The offset is
 * read from **this** window rather than from the record, because it belongs to wherever Orbis is running now: a
 * profile carried from one time zone to another should count days where its owner is, not where the file was
 * written. `calendar.ts` says why it is a fixed offset rather than a zone name.
 */
export const dayRulesFor = (record: KeptArcade | null): DayRules => ({
  offsetMinutes: -new Date().getTimezoneOffset(),
  dayStartHour: record?.dayStartHour ?? 0
})

// ---------------------------------------------------------------- the hook

/**
 * The arcade's record and a way to change it.
 *
 * `update` is given the record as it is now rather than as it was when the component last drew, because a game can
 * finish while the library is open and both want to write. It does nothing before the first read has landed: there
 * is no record yet to change, and writing defaults over a profile nobody has read from is the one mistake this whole
 * file exists to prevent.
 */
export function useOfflineGames(): ArcadeKeeping & { update: (change: (record: KeptArcade) => KeptArcade) => void } {
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state
  )
  useEffect(() => {
    if (!loaded) void load()
    // A different profile is a different record, so it is read again rather than left on screen.
    const stop = window.api?.onProfileChanged?.(() => {
      loaded = true
      void load()
    })
    const leaving = (): void => {
      void sender.flush()
    }
    window.addEventListener('pagehide', leaving)
    return () => {
      stop?.()
      window.removeEventListener('pagehide', leaving)
      // What is waiting goes before the screen does.
      void sender.flush()
    }
  }, [])
  const update = useCallback((change: (record: KeptArcade) => KeptArcade) => {
    if (state.record === null) return
    keepArcade(change(state.record))
  }, [])
  // Named one by one rather than spread, so `canKeep` -- which is this file's business and not a screen's -- cannot
  // leak out and become something a screen reads instead of `refused`.
  return {
    record: snapshot.record,
    reading: snapshot.reading,
    notes: snapshot.notes,
    refused: snapshot.refused,
    saveProblem: snapshot.saveProblem,
    carried: snapshot.carried,
    update
  }
}
