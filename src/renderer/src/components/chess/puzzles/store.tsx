import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  emptyStore, readStore, writeStore, type PuzzleStore
} from '../../../../../shared/chess/puzzles'
import { addRunRecord, type RunRecord } from '../../../../../shared/chess/puzzleRun'
import { coalesced, firstRead, reason, windowStore } from '../keeping'

/**
 * Where the puzzle collection is kept, and what happens when it cannot be read.
 *
 * ## In the profile
 *
 * `personal/chess-training.json`, through `window.api.chessTraining()` and `window.api.chessSaveTraining()`. The
 * collection shares that file with the exercises, the review schedule, the attempt records and the puzzle ratings,
 * which are the things written at the same moments as it; this screen reads the file, changes the collection in it
 * and writes the file back, leaving the other four exactly as they came.
 *
 * It used to be in this window's own storage, which belongs to the computer rather than to the profile and does not
 * travel with a profile export. That copy is brought across once, on the first read of a profile that has nothing,
 * and then left where it is -- `firstRead` in `keeping.ts` has the conditions and the reasons.
 *
 * ## Unreadable is not missing
 *
 * The one rule this file exists for. Every store in Orbis that has ever lost somebody's data lost it the same way: it
 * could not parse what was there, treated that as "there is nothing here", and wrote its defaults on top. So the
 * store on the other side of the boundary answers with `refused` set when the file is there and could not be read,
 * and when it does:
 *
 *   - the collection on screen starts from nothing, so the screen still works;
 *   - **nothing is ever written**, so what is really stored stays exactly where it is;
 *   - the reason is shown, so somebody can decide what to do about it.
 *
 * `readProblem` is that sentence. It is written to be shown as it stands.
 *
 * ## One message for a burst, not one per change
 *
 * A write used to be one `setItem`, which costs nothing. It is now a message across the boundary and a file, so
 * changes are coalesced: the newest collection is sent and the ones in between are not. What is waiting is sent when
 * the screen goes away and when the window is closing, which is the one thing this costs over writing straight to
 * storage.
 */

/** The key the collection used to live under. Read once for the carry-over, and never written again. */
const KEY = 'orbis.chess.puzzles.v1'

/**
 * The two things this screen keeps, read and written together.
 *
 * They are in one file and they are changed at the same moments -- a run finishes, which writes a run record and an
 * attempt against every puzzle it served -- so sending them separately would mean two messages for one event and
 * two chances for the second one to be the one that fails.
 */
export interface Kept {
  puzzles: PuzzleStore
  /** Finished runs of the timed modes, oldest first. */
  runs: readonly RunRecord[]
}

export interface StoreState {
  store: PuzzleStore
  /** Finished runs of the timed modes, oldest first. Empty while `loading`. */
  runs: readonly RunRecord[]
  /** True until the profile has answered. Nothing about `store` means anything yet while this is true. */
  loading: boolean
  /** Set when there is something stored that could not be read. Nothing is written while this is set. */
  readProblem: string | null
  /** Set when saving failed. The collection is still correct for this visit. */
  saveProblem: string | null
  /** Things inside the stored collection that could not be read, kept apart from the collection being unreadable. */
  dropped: readonly string[]
  /** False when nothing can be kept, so nothing pretends it was. */
  canKeep: boolean
  /** What was brought across from this window's own storage on the first read. Null nearly always. */
  carried: string | null
}

const empty = (): StoreState => ({
  store: emptyStore(),
  runs: [],
  loading: true,
  readProblem: null,
  saveProblem: null,
  dropped: [],
  canKeep: true,
  carried: null
})

let state: StoreState = empty()
let loaded = false
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((one) => one())

const set = (patch: Partial<StoreState>): void => {
  state = { ...state, ...patch }
  emit()
}

/**
 * The collection and the runs on their way to the profile.
 *
 * The whole training file is read first and written back with only these two replaced, so saving a puzzle cannot
 * wipe the review schedule or the attempt records that live in the same file.
 */
const sender = coalesced<Kept>(async (kept) => {
  try {
    const held = await window.api.chessTraining()
    if (held.refused !== null) {
      set({ readProblem: held.refused, saveProblem: null })
      return
    }
    const answer = await window.api.chessSaveTraining({ ...held.value, puzzles: writeStore(kept.puzzles), runs: kept.runs })
    set({ saveProblem: answer.refused, dropped: answer.notes })
  } catch (err) {
    set({ saveProblem: `Your puzzles were not saved (${reason(err)}), so what you have just done will last only as long as this visit.` })
  }
})

async function load(): Promise<void> {
  loaded = true
  set({ loading: true })
  try {
    const answer = await firstRead<Kept>({
      key: KEY,
      what: 'puzzles and how you have got on with them',
      read: async () => {
        const held = await window.api.chessTraining()
        return { value: { puzzles: held.value.puzzles, runs: held.value.runs ?? [] }, notes: held.notes, refused: held.refused }
      },
      save: async (kept) => {
        const held = await window.api.chessTraining()
        const answer = await window.api.chessSaveTraining({ ...held.value, puzzles: writeStore(kept.puzzles), runs: kept.runs })
        return { value: { puzzles: answer.value.puzzles, runs: answer.value.runs ?? [] }, notes: answer.notes, refused: answer.refused }
      },
      // Nothing kept: no puzzles, no history, no day fixed, no runs and a rating nothing has moved. An old copy has
      // as good a claim on a file with nothing in it as on one that was never written.
      isEmpty: (one) =>
        one.puzzles.puzzles.length === 0 &&
        Object.keys(one.puzzles.records).length === 0 &&
        Object.keys(one.puzzles.daily).length === 0 &&
        one.runs.length === 0 &&
        one.puzzles.person.finished === 0,
      fromBrowser: (text) => {
        const read = readStore(text)
        // `unreadable` means there is something there Orbis could not make sense of. It is left alone and reported,
        // never read as an empty collection. The old window copy never held runs; there were none to hold.
        return read.kind === 'unreadable' ? null : { puzzles: read.store, runs: [] }
      },
      storage: windowStore(),
      now: Date.now
    })
    set({
      store: answer.value.puzzles,
      runs: answer.value.runs,
      loading: false,
      readProblem: answer.refused,
      saveProblem: null,
      dropped: answer.notes,
      canKeep: answer.refused === null,
      carried: answer.carried
    })
  } catch (err) {
    // Asked for, and the question could not be put. The screen works on an empty collection and says why; nothing is
    // written, because nothing is known about what is there.
    set({
      loading: false,
      readProblem: `Your puzzles could not be read (${reason(err)}). Nothing has been written over them.`,
      canKeep: false
    })
  }
}

/** The collection after a change, saved unless saving would write over something unreadable. */
export function save(next: PuzzleStore, runs: readonly RunRecord[] = state.runs): void {
  set({ store: next, runs })
  if (state.readProblem !== null) return
  if (!state.canKeep) return
  sender.queue({ puzzles: next, runs })
}

/**
 * The collection, and a way to change it.
 *
 * `update` takes the collection as it is now rather than as it was when the component last drew, because a scan can
 * finish while somebody is solving and both want to write.
 */
export function usePuzzleStore(): StoreState & {
  update: (change: (store: PuzzleStore) => PuzzleStore) => void
  /** A finished run kept, with the collection it left behind in the same message. */
  keepRun: (record: RunRecord, store?: PuzzleStore) => void
} {
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state
  )
  useEffect(() => {
    if (!loaded) void load()
    // A different profile is a different collection, so it is read again rather than kept on screen.
    const stop = window.api.onProfileChanged(() => {
      loaded = true
      void load()
    })
    const leaving = (): void => {
      void sender.flush()
    }
    window.addEventListener('pagehide', leaving)
    return () => {
      stop()
      window.removeEventListener('pagehide', leaving)
      // What is waiting goes before the screen does.
      void sender.flush()
    }
  }, [])
  const update = useCallback((change: (store: PuzzleStore) => PuzzleStore) => {
    save(change(state.store))
  }, [])
  /*
   * A finished run.
   *
   * `store` is there so the collection a run left behind -- an attempt recorded against every puzzle it served --
   * goes in the same message as the run record. Two messages would mean a run that counted and attempts that did
   * not, or the other way round.
   */
  const keepRun = useCallback((record: RunRecord, store?: PuzzleStore) => {
    save(store ?? state.store, addRunRecord(state.runs, record))
  }, [])
  return { ...snapshot, update, keepRun }
}

/** For the tests a screen cannot do: start again from nothing. Not reachable from the interface. */
export function resetForTesting(): void {
  sender.drop()
  state = empty()
  loaded = false
}
