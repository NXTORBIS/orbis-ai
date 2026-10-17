import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  addAttempt, emptyStore, readTraining, writeTraining,
  type TrainingAttempt, type TrainingSettings, type TrainingStore
} from '../../../../../shared/chess/trainingView'
import { keepLocalChanges } from '../../../../../shared/chess/trainingMerge'
import { coalesced, reason } from '../keeping'

/**
 * Where the Calculation Gym and the Blindfold screens keep what happened.
 *
 * ## In the profile, in the training file
 *
 * `personal/chess-training.json`, through `window.api.chessTraining()` and `window.api.chessSaveTraining()` -- the
 * same file the puzzle collection, the exercises, the review schedule and the attempt records live in, because
 * these are written at the same moments as those. This screen reads the file, replaces its own part of it and
 * writes the whole thing back, leaving every other part exactly as it came.
 *
 * Its own part is one field, `view`, holding the text `writeTraining` produces. `kept.ts` has the reasons; the
 * short version is that `trainingView.ts` was written to read and write its store as text, with every field checked
 * on the way in, and that reader is the tested one -- so there is one answer to "what did this person do" rather
 * than two that can disagree. It is deliberately **not** filed under `attempts`: a `TrainingRecord` has nowhere to
 * put `strict`, and whether the board was kept away is the only thing a blindfold record is about.
 *
 * ## Unreadable is not missing
 *
 * Three different things can be wrong, and they are kept apart because only one of them is safe to write after:
 *
 *   - **the file could not be read** (`refused` came back set). Nothing is written, ever. The screens still work on
 *     an empty record for this visit.
 *   - **the file was read and our own field is not text.** Something put a value there this screen does not
 *     understand. It is reported and left alone -- writing over it would destroy the only copy.
 *   - **our field is text and `readTraining` would not take it** -- not JSON, or written by a newer Orbis. That
 *     reader already answers with `safeToWrite: false` and its own sentence, and both are passed straight through.
 *
 * Every one of those ends the same way: the record on screen starts empty so the screen works, and **nothing is
 * saved**. Orbis has lost people's data before by treating "I cannot read this" as "there is nothing here".
 */

export interface TrainingState {
  store: TrainingStore
  /** True until the profile has answered. Nothing about `store` means anything while this is true. */
  loading: boolean
  /** Set when there is something stored that could not be read. Nothing is written while this is set. */
  readProblem: string | null
  /** Set when saving failed. What is on screen is still right for this visit. */
  saveProblem: string | null
  /** Things inside the file that could not be read, kept apart from the file being unreadable. */
  dropped: readonly string[]
  /** False when nothing can be kept, so nothing pretends it was. */
  canKeep: boolean
}

const empty = (): TrainingState => ({
  store: emptyStore(),
  loading: true,
  readProblem: null,
  saveProblem: null,
  dropped: [],
  canKeep: true
})

let state: TrainingState = empty()
let loaded = false
/*
 * How many changes have been made in this window, ever.
 *
 * A read of the file takes a moment, and until it answers the screens work on an empty record so they work at all.
 * Anything changed in that moment used to be put straight back by the read when it landed -- press "Less" as the
 * screen appears and it went back to 20 seconds, which is a control that worked and looked dead. `load` notes this
 * number before it asks and compares it after, and `keepLocalChanges` decides what the record should then be.
 */
let changes = 0
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((one) => one())

const set = (patch: Partial<TrainingState>): void => {
  state = { ...state, ...patch }
  emit()
}

/**
 * The record on its way to the profile.
 *
 * The whole training file is read first and written back with only our own field replaced, so recording a blindfold
 * round cannot wipe the puzzle collection or the review schedule that live in the same file. The read is checked
 * again here, not just at load: the file can have become unreadable since, and a save that went ahead anyway would
 * be the one failure nobody goes back to look for.
 */
const sender = coalesced<TrainingStore>(async (store) => {
  try {
    const held = await window.api.chessTraining()
    if (held.refused !== null) {
      set({ readProblem: held.refused, canKeep: false })
      return
    }
    const answer = await window.api.chessSaveTraining({ ...held.value, view: writeTraining(store) })
    set({ saveProblem: answer.refused, dropped: answer.notes })
  } catch (err) {
    set({
      saveProblem: `What you have just done was not saved (${reason(err)}), so it will last only as long as this visit.`
    })
  }
})

async function load(mine = true): Promise<void> {
  loaded = true
  const before = changes
  // Whether anything changed while this read was in flight, and whether it is this person's to keep. A read after a
  // profile change is a different person's record, so what is on screen belongs to the person who has gone.
  const keepers = (read: TrainingStore): TrainingStore =>
    keepLocalChanges(read, state.store, mine && changes !== before)
  set({ loading: true })
  try {
    const held = await window.api.chessTraining()
    if (held.refused !== null) {
      set({ store: emptyStore(), loading: false, readProblem: held.refused, canKeep: false, dropped: held.notes })
      return
    }
    const raw = (held.value as { view?: unknown }).view
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      // There is something there and it is not what this screen writes. Left exactly as it is.
      set({
        store: emptyStore(),
        loading: false,
        readProblem:
          'Something is saved for these trainers that this screen cannot make sense of, so this visit starts empty. It is being left exactly as it is rather than written over.',
        canKeep: false,
        dropped: held.notes
      })
      return
    }
    const read = readTraining(typeof raw === 'string' ? raw : null)
    set({
      store: keepers(read.store),
      loading: false,
      // `note` covers both "some of it could not be read" and "none of it could". `safeToWrite` says which.
      readProblem: read.safeToWrite ? null : read.note,
      saveProblem: null,
      dropped: read.safeToWrite && read.note ? [read.note, ...held.notes] : held.notes,
      canKeep: read.safeToWrite
    })
  } catch (err) {
    set({
      store: emptyStore(),
      loading: false,
      readProblem: `What these trainers had recorded could not be read (${reason(err)}). Nothing has been written over it.`,
      canKeep: false
    })
  }
}

/** The record after a change, saved unless saving would write over something unreadable. */
export function save(next: TrainingStore): void {
  changes += 1
  set({ store: next })
  if (state.readProblem !== null) return
  if (!state.canKeep) return
  sender.queue(next)
}

export interface TrainingHandle extends TrainingState {
  /** One more attempt. Append-only: `addAttempt` keeps the first go and trims the middle, never the first. */
  record: (attempt: TrainingAttempt) => void
  /** The settings, changed. */
  settings: (change: Partial<TrainingSettings>) => void
}

/**
 * The record, and the two ways either screen changes it.
 *
 * Both take the record as it is now rather than as it was when the component last drew, because the gym and the
 * blindfold screen are the same store and either can be the one that wrote last.
 */
export function useTrainingStore(): TrainingHandle {
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
    const stop = window.api.onProfileChanged(() => {
      loaded = true
      void load(false)
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

  const record = useCallback((attempt: TrainingAttempt) => {
    save(addAttempt(state.store, attempt))
  }, [])

  const settings = useCallback((change: Partial<TrainingSettings>) => {
    save({ ...state.store, settings: { ...state.store.settings, ...change } })
  }, [])

  return { ...snapshot, record, settings }
}

/** For the tests a screen cannot do: start again from nothing. Not reachable from the interface. */
export function resetForTesting(): void {
  sender.drop()
  state = empty()
  loaded = false
  changes = 0
}
