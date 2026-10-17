import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Curriculum } from '../../../../../shared/chess/lessons'
import {
  decodeProgress, emptyProgress, writeProgress, type AcademyProgress
} from '../../../../../shared/chess/academyPath'
import { coalesced, firstRead, markCarried, reason, windowStore } from '../keeping'

/**
 * Where Academy progress is kept, and what happens when it cannot be.
 *
 * ## In the profile
 *
 * `personal/chess-academy.json`, through `window.api.chessAcademy()` and `window.api.chessSaveAcademy()`. It has a
 * file of its own rather than sharing the training one, because it is rewritten every time somebody moves through a
 * lesson and because it is the only part of the record tied to a curriculum.
 *
 * It used to be in this window's own storage under one key, which meant two people sharing one profile shared one
 * Academy record, a profile carried to another machine did not carry it, and it was in no profile export. That copy
 * is brought across once, on the first read of a profile that has nothing in it, and then left where it is --
 * `firstRead` in `keeping.ts` has the conditions and the reasons for each of them.
 *
 * ## The store keeps the record whole; this file is where the curriculum is applied
 *
 * `decodeProgress` drops records whose lesson or task this curriculum no longer has, and says so. That belongs here,
 * where the curriculum is: the store on the other side deliberately does not do it, because a lesson being renamed
 * must not delete the attempts somebody made at it. So what comes back across the boundary is the record as it was
 * saved, and it is read against the curriculum in use here.
 *
 * ## It can fail, and then it says so
 *
 * A file that is there and could not be read comes back with `refused` set, nothing is written over it, and the
 * sentence is shown. A save that failed is **reported to the screen** rather than swallowed: a lesson player that
 * looks like it is saving and is not is worse than one that says it cannot save.
 */

/** The key the record used to live under. Read once for the carry-over, and never written again. */
export const ACADEMY_KEY = 'orbis.chess.academy.v1'

export interface Storage {
  progress: AcademyProgress
  /** Change it. The new value is sent shortly after; a burst of changes becomes one message. */
  update: (change: (held: AcademyProgress) => AcademyProgress) => void
  /**
   * The value as it stands now, rather than as it stood when the render started.
   *
   * Two attempts can finish in one tick -- a task reports its record, and the record reschedules a card -- and
   * reading `progress` out of a closure would make the second change overwrite the first.
   */
  latest: () => AcademyProgress
  /** What could not be read out of the saved value, in plain words. */
  repaired: readonly string[]
  /** Why nothing is being saved, when nothing is. Null when saving works. */
  saveProblem: string | null
  /** True before the first read has happened. Nothing about `progress` means anything yet while it is true. */
  loading: boolean
  /** What was brought across from this window's own storage on the first read. Null nearly always. */
  carried: string | null
  /** Forget everything. Only ever called from a control that says what it does. */
  forget: () => void
}

export function useAcademyProgress(curriculum: Curriculum): Storage {
  const [progress, setProgress] = useState<AcademyProgress>(() => emptyProgress(curriculum))
  const [repaired, setRepaired] = useState<readonly string[]>([])
  const [saveProblem, setSaveProblem] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [carried, setCarried] = useState<string | null>(null)
  // The latest value, for a writer that must not depend on the render it was created in.
  const held = useRef(progress)
  held.current = progress
  /** False while the file is there and unreadable, which is when nothing may be written. */
  const mayWrite = useRef(true)
  /**
   * The curriculum as it stands now.
   *
   * The sender below is made once and kept for the life of the screen, so reading `curriculum` out of the render it
   * was made in would stamp every later save with the first one it ever saw.
   */
  const against = useRef(curriculum)
  against.current = curriculum

  /*
   * One message for a burst of changes. Opening a lesson, finishing a task and rescheduling the card it belongs to
   * are three changes in one tick, and each of them used to be a `setItem` that cost nothing.
   */
  const sender = useRef(
    coalesced<AcademyProgress>(async (next) => {
      try {
        // Stamped by `writeProgress`, which is the one place that decides what a saved record claims about the
        // content version it was earned against. Read back as an object because that is what the channel takes.
        const stamped = JSON.parse(writeProgress(next, against.current, Date.now())) as AcademyProgress
        const answer = await window.api.chessSaveAcademy(stamped)
        setSaveProblem(
          answer.refused === null
            ? null
            : `${answer.refused} What you do now will count while the Academy is open, and will be gone when you close it.`
        )
      } catch (err) {
        setSaveProblem(`Your progress was not saved (${reason(err)}). What you do now will count while the Academy is open, and will be gone when you close it.`)
      }
    })
  )

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const answer = await firstRead<AcademyProgress>({
        key: ACADEMY_KEY,
        what: 'Academy progress',
        read: () => window.api.chessAcademy(),
        save: (value) => window.api.chessSaveAcademy(value),
        // Nothing recorded at all: no attempts, nothing read, no cards, nothing marked as already known and no place
        // left off at. A record for another curriculum is not nothing, so it is never written over.
        isEmpty: (one) =>
          one.records.length === 0 &&
          one.reading.length === 0 &&
          one.cards.length === 0 &&
          one.skipped.length === 0 &&
          one.place === null,
        fromBrowser: (text) => {
          try {
            return JSON.parse(text) as AcademyProgress
          } catch {
            // Something is there that is not readable. It is left exactly as it is and said, never read as nothing.
            return null
          }
        },
        storage: windowStore(),
        now: Date.now
      })
      // The curriculum is applied here, not in the store. `decodeProgress` is what drops a record whose task this
      // curriculum no longer has, and what writes the sentences saying so.
      const read = decodeProgress(answer.value, curriculum, Date.now())
      mayWrite.current = answer.refused === null
      held.current = read.progress
      setProgress(read.progress)
      setRepaired([...answer.notes, ...read.repaired])
      setSaveProblem(answer.refused)
      setCarried(answer.carried)
      setLoading(false)
    } catch (err) {
      mayWrite.current = false
      setLoading(false)
      setSaveProblem(`Orbis could not read what you have done so far (${reason(err)}), so nothing is being saved either. What is stored has not been touched.`)
    }
  }, [curriculum])

  useEffect(() => {
    void load()
    // A different profile is a different record, so it is read again rather than left on screen.
    const stop = window.api.onProfileChanged(() => void load())
    const leaving = (): void => {
      void sender.current.flush()
    }
    window.addEventListener('pagehide', leaving)
    return () => {
      stop()
      window.removeEventListener('pagehide', leaving)
      // What is waiting goes before the screen does.
      void sender.current.flush()
    }
  }, [load])

  const update = useCallback((change: (one: AcademyProgress) => AcademyProgress): void => {
    const next = change(held.current)
    held.current = next
    setProgress(next)
    // Nothing is written over a file Orbis could not read. The screen keeps working and says why.
    if (mayWrite.current) sender.current.queue(next)
  }, [])

  const latest = useCallback((): AcademyProgress => held.current, [])

  const forget = useCallback((): void => {
    const next = emptyProgress(curriculum)
    held.current = next
    setProgress(next)
    setRepaired([])
    setCarried(null)
    // Written rather than removed: forgetting is a change to the record like any other, and it has to land in the
    // profile. The copy in this window's own storage is left alone -- deleting somebody's older copy is not this
    // button's job -- but its claim is settled here, so an emptied record cannot be refilled from it on the next
    // launch. A button that said "forget" and then brought it all back would be the worst of both.
    if (mayWrite.current) {
      markCarried(windowStore(), ACADEMY_KEY, Date.now())
      sender.current.drop()
      sender.current.queue(next)
      void sender.current.flush()
    }
  }, [curriculum])

  return useMemo(
    () => ({ progress, update, latest, repaired, saveProblem, loading, carried, forget }),
    [progress, update, latest, repaired, saveProblem, loading, carried, forget]
  )
}
