import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  gatherEvidence, isYourGame,
  type AnalysisCoverage, type EvidenceSources, type GatheredEvidence
} from '../../../../../shared/chess/evidence'
import type { CoachEvidence } from '../../../../../shared/chess/coach'
import type { StoredGame } from '../../../../../shared/chess/model'
import type { StoredStudy } from '../../../../../shared/chess/study'
import {
  NEVER_READ, failedReading, finishedReading, startedReading, type RefreshState
} from '../../../../../shared/chess/coachRefresh'
import { reason } from '../keeping'

/**
 * Fetching what the coach reads, out of the profile.
 *
 * All the thinking is in `src/shared/chess/evidence.ts`, which is pure and tested. This is the part that cannot be:
 * four reads across the boundary and one per analysed game, and the three states a read has.
 *
 * ## Three states, because they are three different sentences
 *
 *   **not read yet** -- `loading`. The coach must say it is reading, not show zeros. Zeros drawn before the answer
 *   arrives are indistinguishable from "nothing you have done was recorded", which is the one thing this whole
 *   pipeline exists to stop the screen saying.
 *
 *   **read, and there was nothing** -- an ordinary empty profile. No evidence, and the coverage says so.
 *
 *   **read, and it could not be read** -- the file is there and Orbis could not make sense of it. The store has
 *   already left it alone and said why in a sentence written to be shown. That file is handed to the gatherer as
 *   `null`, which is not the same as leaving it out, and the sentence is shown.
 *
 * ## Nothing here writes
 *
 * The coach only ever reads. There is no save path in this file at all, which is why the "unreadable is not missing"
 * hazard cannot arise here: nothing can be written over a file that could not be read because nothing is written.
 */

/** How many games' analyses are asked for. More than the number of analyses the profile keeps, so it never bites. */
const ASK_AT_MOST = 600

/**
 * How long one read of the profile may take before it is called stuck.
 *
 * Without a limit, a read whose channel never answers keeps the screen on "Reading..." for ever, which is exactly the
 * fault the owner reported. After this long the read fails and says so, and "Try again" is offered.
 */
const READ_DEADLINE_MS = 20_000

/** Races a read against the deadline. Settles with the read's answer, or throws a sentence saying it timed out. */
function withDeadline<T>(what: string, pending: Promise<T>, ms: number = READ_DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer from ${what} after ${Math.round(ms / 1000)} seconds`)),
      ms
    )
  })
  return Promise.race([pending, late]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

export interface CoachEvidenceState extends GatheredEvidence {
  /** True until the profile has answered. Nothing else here means anything yet while it is true. */
  loading: boolean
  /** What could not be read, in sentences meant to be shown as they are. */
  problems: readonly string[]
  /**
   * Where the reading has got to: not started, running, finished at a moment, or failed with a reason.
   *
   * The screen needs all four. "Bring up to date" used to leave the coach saying it was still reading for ever,
   * because a read that threw anywhere outside the two guarded calls below left `loading` true and nothing ever
   * turned it off again. So the end of a read is recorded in one place now, whichever way it ended.
   */
  refresh: RefreshState
  /** Read it all again. */
  reload: () => void
}

/** What a read of one file came back with: the value, or null when it is there and could not be read. */
async function readFile<T>(
  what: string,
  read: () => Promise<{ value: T; notes: readonly string[]; refused: string | null }>,
  problems: string[]
): Promise<T | null> {
  try {
    const answer = await withDeadline(what, read())
    if (answer.refused !== null) {
      problems.push(answer.refused)
      return null
    }
    // Records inside the file the store could not read. They are left out of what it answered with, so they have to
    // be shown: a figure quietly short of a few hundred attempts is how somebody loses part of their history and
    // never finds out which part.
    for (const note of answer.notes) problems.push(note)
    return answer.value
  } catch (err) {
    problems.push(`Your ${what} could not be read (${reason(err)}), so nothing from ${what} is counted here. Nothing has been written over.`)
    return null
  }
}

/** The saved analyses for the games handed in, asked for one game at a time because that is the channel there is. */
async function readStudies(
  games: readonly StoredGame[],
  problems: string[]
): Promise<readonly StoredStudy[] | null> {
  const mine = games.filter(isYourGame).slice(0, ASK_AT_MOST)
  if (mine.length < games.filter(isYourGame).length) {
    problems.push(`You have more saved games than the ${ASK_AT_MOST} most recent, and only those were looked at for a `
      + 'saved analysis. Anything older is not counted here.')
  }
  if (mine.length === 0) return []
  try {
    const answers = await withDeadline(
      'your saved analyses',
      Promise.all(mine.map((game) => window.api.chessStudy(game.id)))
    )
    const refused = answers.find((one) => one.refused !== null)
    // One refusal is the whole file refusing: they all come out of the same one. Reporting it once is the honest
    // count, and the gatherer is told the file could not be read rather than that there are no analyses.
    if (refused) {
      problems.push(refused.refused as string)
      return null
    }
    // Records inside the file that could not be read. Every answer carries the same list, because they all come out
    // of one file, so they are reduced to one of each rather than repeated once per game.
    for (const note of new Set(answers.flatMap((one) => one.notes))) problems.push(note)
    return answers.flatMap((one) => (one.value === null ? [] : [one.value]))
  } catch (err) {
    problems.push(`Your saved analyses could not be read (${reason(err)}), so nothing from your own games is counted here. Nothing has been written over.`)
    return null
  }
}

const NOTHING: CoachEvidence = {}

const UNREAD: AnalysisCoverage = {
  gamesKnown: false,
  yours: 0,
  others: 0,
  analysed: 0,
  notAnalysed: 0,
  deepEnough: 0,
  tooShallow: 0,
  sideUnknown: 0,
  withoutAGame: 0,
  withoutEngineAnswers: 0,
  staleGame: 0,
  says: 'Still reading what you have done.'
}

/**
 * Everything the coach reads, for the games handed in.
 *
 * `games` is the Library as the host already has it, so the coach is never a second answer to "which games are
 * there". The read is redone when the games change -- by id and fingerprint, not by the identity of the array, or
 * every render would start another one.
 */
export function useCoachEvidence(games?: readonly StoredGame[]): CoachEvidenceState {
  const key = useMemo(
    () => (games === undefined ? null : games.map((one) => `${one.id}:${one.fingerprint}`).join(',')),
    [games]
  )
  const latest = useRef(games)
  latest.current = games

  const [state, setState] = useState<{ got: GatheredEvidence | null; problems: readonly string[]; loading: boolean }>(
    { got: null, problems: [], loading: true }
  )
  const [again, setAgain] = useState(0)
  const [refresh, setRefresh] = useState<RefreshState>(NEVER_READ)

  useEffect(() => {
    let live = true
    setState((held) => ({ ...held, loading: true }))
    setRefresh((held) => startedReading(held, Date.now()))
    const run = async (): Promise<void> => {
      const problems: string[] = []
      const here = latest.current ?? []
      const [training, openings, academy, studies] = await Promise.all([
        readFile('puzzles and training records', () => window.api.chessTraining(), problems),
        readFile('opening repertoire', () => window.api.chessOpenings(), problems),
        readFile('Academy record', () => window.api.chessAcademy(), problems),
        readStudies(here, problems)
      ])
      if (!live) return
      const sources: EvidenceSources = {
        ...(latest.current === undefined ? {} : { games: here }),
        studies,
        training,
        openings,
        academy
      }
      setState({ got: gatherEvidence(sources), problems, loading: false })
      setRefresh((held) => finishedReading(held, Date.now()))
    }
    /*
     * The read ends here whichever way it ends, and that is the whole fix.
     *
     * Before this, anything thrown outside the four guarded calls -- the channel missing, the gatherer tripping over
     * one odd record -- left `loading` true, and the coach said "Still reading what you have done." for the rest of
     * the session however many times anybody pressed the button. A screen that cannot finish has to say it could not
     * finish; the figures stay as they were and the reason is shown.
     */
    void run().catch((err: unknown) => {
      if (!live) return
      const why = `Your record could not be read (${reason(err)}), so nothing on this screen has changed. Nothing has `
        + 'been written over.'
      setState((held) => ({ got: held.got, problems: [...held.problems, why], loading: false }))
      setRefresh((held) => failedReading(held, Date.now(), why))
    })
    return () => { live = false }
  }, [key, again])

  const reload = useCallback(() => setAgain((n) => n + 1), [])

  // A different profile is a different person's record, so it is read again rather than left on screen.
  useEffect(() => window.api.onProfileChanged(() => setAgain((n) => n + 1)), [])

  return {
    evidence: state.got?.evidence ?? NOTHING,
    completions: state.got?.completions ?? [],
    coverage: state.got?.coverage ?? UNREAD,
    notes: state.got?.notes ?? [],
    empty: state.got?.empty ?? true,
    loading: state.loading,
    problems: state.problems,
    refresh,
    reload
  }
}
