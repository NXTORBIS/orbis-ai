import { useCallback, useEffect, useRef, useState } from 'react'
import type { StoredGame } from '../../../../../shared/chess/model'
import { sessionProblems, type AnalysisSession } from '../../../../../shared/chess/analysis'
import {
  STUDY_CAPS, restoreStudy, studyDigest, studyFromSession, worthKeeping,
  type SaveState, type StudyRun
} from '../../../../../shared/chess/study'

/**
 * Keeping what somebody works out in Analysis Studio, without being asked to.
 *
 * Before this, a session lived in one component's state. Explore six lines, write three notes, run a twenty-minute
 * pass over the game, change area -- and all of it was gone, with no warning and nothing to recover. The game was
 * never in danger; the work on top of it never survived (Sections 103, 158).
 *
 * Four things this has to get right, and each of them is a way it could be worse than not saving at all:
 *
 *   - **Nothing is written before the saved analysis has been looked for.** A screen that saved as soon as it opened
 *     would write a fresh, empty session over the real one in the first second, every time. Nothing is sent until
 *     the read comes back, which is what `ready` is.
 *
 *   - **A save is sent for a change, not for a keystroke.** The note box, the board and a whole-game pass all change
 *     the session many times a second. What would be written is named first -- `studyDigest` -- and a save whose
 *     record is identical to the last one that landed is not sent at all.
 *
 *   - **What is pending when the screen closes is still written.** That was the whole bug: the work was lost by
 *     changing area. The timer is cleared on the way out and the write is sent immediately, and the same is tried
 *     when the window itself is closing.
 *
 *   - **A refusal is not a save.** `refused` on the answer means nothing was written, and the line on screen says
 *     so in those words rather than "saved". A screen that says it saved when it did not is the worst failure here,
 *     because nobody goes back to check.
 */

/** How long after the last change a save is sent. The store waits another fifth of a second before it writes. */
const SETTLE_MS = 1200

/**
 * The longest a change may sit waiting, however much else is happening.
 *
 * A whole-game pass records an evaluation every second or two for twenty minutes, and each one restarts the settling
 * timer -- so without this, a pass that never pauses would never be written, and a pass interrupted at minute
 * nineteen would have kept nothing. Section 109 asks for the completed part of an interrupted pass to be there
 * afterwards, and this is what makes that true without a write for every position.
 */
const AT_MOST_MS = 15_000

export interface StudyKeeping {
  state: SaveState
  /** True once this game's saved analysis has been looked for. Nothing is written before it is. */
  ready: boolean
  /** True when something was found and put back onto the game. */
  restored: boolean
  /** What came back, so the screen can say so rather than leaving it to be noticed. */
  counts: { branches: number; notes: number; evaluations: number }
  /** What could not be read or could not be put back, in sentences meant to be shown as they are. */
  notes: readonly string[]
  /** The passes of the engine kept with this analysis, oldest first (Section 158). */
  runs: readonly StudyRun[]
  /** Records a finished pass, which is kept with the analysis so a report can say where it came from. */
  addRun: (run: StudyRun) => void
  /** Puts the list of what could not be read away, once somebody has read it. */
  clearNotes: () => void
}

const plainly = (err: unknown): string =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : 'Orbis could not save your lines and notes.'

export function useStudySave(o: {
  game: StoredGame
  session: AnalysisSession
  /** Called with the session to show: the game with whatever was saved about it put back on. */
  onSession: (session: AnalysisSession) => void
  /** The move the studio was opened about, when it was. The restored place does not argue with it. */
  atPly?: number
}): StudyKeeping {
  const [state, setState] = useState<SaveState>({ kind: 'reading' })
  const [ready, setReady] = useState(false)
  const [restored, setRestored] = useState(false)
  const [counts, setCounts] = useState({ branches: 0, notes: 0, evaluations: 0 })
  const [notes, setNotes] = useState<readonly string[]>([])
  const [runs, setRuns] = useState<readonly StudyRun[]>([])

  /*
   * The callback, the game and the runs are held in refs as well.
   *
   * The reading effect must run when the game changes and at no other time. Depending on the callback or on the game
   * object itself would re-run it on every redraw of the parent -- which is how a screen elsewhere in Orbis ended up
   * reloading its whole conversation on each render -- and here it would also throw away whatever the person had
   * explored since.
   */
  const hand = useRef(o.onSession)
  hand.current = o.onSession
  const game = useRef(o.game)
  game.current = o.game
  const held = useRef<readonly StudyRun[]>(runs)
  held.current = runs

  /** The last record that really landed, by name, so an unchanged session is never written again. */
  const landed = useRef<string | null>(null)
  /** True once something has been saved or found for this game: a removal of everything must be written too. */
  const existed = useRef(false)
  const pending = useRef<ReturnType<typeof studyFromSession> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** When the oldest change still waiting arrived. Null when nothing is waiting. */
  const waiting = useRef<number | null>(null)
  const bridged = typeof window.api.chessStudy === 'function' && typeof window.api.chessSaveStudy === 'function'

  const write = useCallback(async (): Promise<void> => {
    const study = pending.current
    if (!study || !bridged) return
    pending.current = null
    // Nothing is waiting any more, so the next change gets the full settling time rather than being written at once.
    waiting.current = null
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    /*
     * Whether this answer still belongs on the screen.
     *
     * A save can be in flight while somebody opens another game, and "saved" written under that game would be a
     * claim about the wrong work. The record is still written -- it belongs to the game it came from -- but nothing
     * is said about it here once the screen has moved on.
     */
    const mine = (): boolean => game.current.id === study.gameId
    if (mine()) setState({ kind: 'saving' })
    try {
      const answer = await window.api.chessSaveStudy(study)
      if (!mine()) return
      if (answer.refused) {
        // Nothing was written. The record stays pending, so the next change tries again.
        pending.current = study
        setState({ kind: 'refused', why: answer.refused })
        setNotes((before) => [...answer.notes.filter((one) => !before.includes(one)), ...before])
        return
      }
      // The answer is what was really stored, so that is what is named. Anything the reader tidied on the way in
      // means one more save later, which is better than this believing a record the file does not hold.
      landed.current = studyDigest(answer.value ?? study)
      existed.current = true
      setState({ kind: 'saved', at: Date.now() })
      if (answer.notes.length) setNotes((before) => [...answer.notes.filter((one) => !before.includes(one)), ...before])
    } catch (err) {
      pending.current = study
      if (mine()) setState({ kind: 'refused', why: plainly(err) })
    }
  }, [bridged])

  // Looking for what was saved about this game, and putting it back on.
  const key = `${o.game.id}:${o.game.fingerprint}:${o.game.moves.length}`
  useEffect(() => {
    let alive = true
    // Anything waiting belongs to the game that is on its way out, and is written to that game before this one is
    // read. Clearing it instead would lose the last thing somebody did before they changed game.
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (pending.current) void write()
    landed.current = null
    existed.current = false
    pending.current = null
    waiting.current = null
    setReady(false)
    setRestored(false)
    setNotes([])
    setRuns([])
    setCounts({ branches: 0, notes: 0, evaluations: 0 })
    if (!bridged) {
      setState({ kind: 'refused', why: 'This build of the window cannot save your lines and notes, so nothing you do here will be kept. The game itself is safe.' })
      return
    }
    setState({ kind: 'reading' })
    void window.api.chessStudy(o.game.id).then(
      (answer) => {
        if (!alive) return
        const put = restoreStudy(game.current, answer.value ?? null)
        let session = put.session
        /*
         * Where the person asked to be is where they go.
         *
         * The studio can be opened about one move -- the position search offers a button per move -- and the place
         * saved with the analysis would otherwise land on top of it a moment after the screen appeared.
         */
        if (o.atPly !== undefined) {
          const at = session.original[Math.max(0, Math.min(o.atPly, session.original.length - 1))]
          if (at && session.tree.nodes[at]) session = { ...session, cursor: at }
        }
        hand.current(session)
        existed.current = answer.value !== null
        setRestored(put.restored)
        setCounts(put.counts)
        setRuns(answer.value?.runs ?? [])
        /*
         * The tree is checked once, here, where a saved record has just been put back on a game.
         *
         * This is the moment Section 130 is about -- a study is checked when it is loaded -- and it is the only
         * moment it is worth doing: `sessionProblems` plays every move in the tree through the rules, which is far
         * too much work to repeat on every redraw while somebody is exploring.
         */
        const problems = put.restored ? sessionProblems(session) : []
        setNotes([...answer.notes, ...put.notes, ...problems])
        // Named as it stands, so putting it back is not immediately written out again -- and so a record that came
        // back damaged is left on the disk as it is until the person changes something.
        landed.current = studyDigest(studyFromSession(session, 0, answer.value?.runs ?? []))
        setReady(true)
        if (answer.refused) {
          setState({ kind: 'refused', why: answer.refused })
          return
        }
        setState(answer.value ? { kind: 'saved', at: answer.value.savedAt } : { kind: 'empty' })
      },
      (err: unknown) => {
        if (!alive) return
        // The read failed, so what is on the disk is unknown. Writing now could put a fresh session over real work.
        setState({ kind: 'refused', why: `Orbis could not look for what you had saved about this game, so nothing will be written over it: ${plainly(err)}` })
      }
    )
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, bridged, o.atPly])

  // Scheduling a save when what would be written has changed.
  useEffect(() => {
    if (!ready || !bridged) return
    if (!worthKeeping(o.session) && !existed.current) return
    const study = studyFromSession(o.session, Date.now(), held.current)
    if (studyDigest(study) === landed.current) return
    pending.current = study
    setState({ kind: 'pending' })
    if (waiting.current === null) waiting.current = Date.now()
    if (timer.current) clearTimeout(timer.current)
    // Something has been waiting too long: write it now rather than let a run of changes keep putting it off.
    if (Date.now() - waiting.current >= AT_MOST_MS) {
      waiting.current = null
      void write()
      return
    }
    timer.current = setTimeout(() => { void write() }, SETTLE_MS)
  }, [o.session, runs, ready, bridged, write])

  // On the way out: what is pending is written now rather than lost with the screen.
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (pending.current) void write()
  }, [write])

  // And the same when the window itself is closing.
  useEffect(() => {
    const leaving = (): void => { if (pending.current) void write() }
    window.addEventListener('beforeunload', leaving)
    return () => window.removeEventListener('beforeunload', leaving)
  }, [write])

  const addRun = useCallback((run: StudyRun) => {
    setRuns((before) => [...before, run].slice(-STUDY_CAPS.runs))
  }, [])

  const clearNotes = useCallback(() => setNotes([]), [])

  return { state, ready, restored, counts, notes, runs, addRun, clearNotes }
}
