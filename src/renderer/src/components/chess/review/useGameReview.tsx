import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fenAt, type StoredGame } from '../../../../../shared/chess/model'
import { positionKey } from '../../../../../shared/chess/rules'
import {
  evaluationFromWatch, jump, openSession, recordEvaluation,
  type AnalysisSession, type EngineWatch
} from '../../../../../shared/chess/analysis'
import {
  AWARD_RULES, linesFrom, reviewFromSession,
  type GameReview, type PositionLines
} from '../../../../../shared/chess/review'
import type { StudyRun } from '../../../../../shared/chess/study'
import { useEngineAnalysis, type EngineAnalysis } from '../analysis/useEngineAnalysis'
import { useStudySave, type StudyKeeping } from '../analysis/useStudySave'

/**
 * The window's side of Game Review.
 *
 * Nearly all of it is already built, and this is mostly about not building it again. The game opens as an analysis
 * session, exactly as the Studio opens it, and `useStudySave` puts back whatever was saved about it -- so a game
 * somebody has already gone over is reviewed from the numbers that are already there, with no engine involved at
 * all. `reviewFromSession` reads those numbers off the session's own nodes, and a pass run here records what it
 * finds on the same nodes, which is what makes it kept.
 *
 * ## Why this pass is measured in depth and not in time
 *
 * The Studio's whole-game pass is budgeted in time: a short look everywhere, then longer on the positions where the
 * numbers moved. That is the right shape for finding candidates, and the wrong shape here, for one reason. Calling a
 * move the only move that holds means comparing the engine's best line with its second-best, and two lines can only
 * be ranked against each other when they were searched to the same depth -- which a search stopped by a clock cannot
 * promise. So every position in a review is searched to the same depth, and the awards are askable everywhere or
 * nowhere rather than in whichever positions the clock happened to favour.
 *
 * A ceiling in milliseconds is sent with the depth, because one position in a hundred can take minutes at depth 20
 * and a review must be able to finish. Where the ceiling bites, the iteration is cut short, the two lines end up at
 * different depths, and the award for that move comes back unsettled -- which is the honest outcome, and the reason
 * nothing here has to guess.
 */

/** The depths a review can be run at. Below 12 nothing a coach would believe comes out of it. */
export const REVIEW_DEPTHS: readonly number[] = Object.freeze([12, 16, 20])

/** How long one position may take, whatever the depth asks for. A review that cannot finish is not a review. */
export const POSITION_CEILING_MS = 20_000

/** Lines asked for at every position: enough to rank a best against a second best, with one to spare. */
export const REVIEW_LINES = Math.max(AWARD_RULES.linesNeeded, 3)

export interface ReviewRun {
  running: boolean
  done: number
  total: number
  /** Positions that already had a search this deep or deeper and were not searched again. */
  skipped: number
  /** True when the pass was stopped before it finished. */
  stopped: boolean
  /** What the pass is doing, or what it did, in words meant to be shown as they are. */
  note: string | null
  /** The depth it was run at. */
  depth: number | null
}

const IDLE: ReviewRun = { running: false, done: 0, total: 0, skipped: 0, stopped: false, note: null, depth: null }

export interface GameReviewState {
  session: AnalysisSession
  review: GameReview
  keeping: StudyKeeping
  engine: EngineAnalysis
  run: ReviewRun
  depth: number
  setDepth: (depth: number) => void
  /** Where the board is: the position after this many moves. */
  ply: number
  jumpTo: (ply: number) => void
  start: () => void
  cancel: () => void
  canRun: boolean
  /** Why a pass cannot be run, when it cannot. Null when it can. */
  whyNot: string | null
  /** The passes kept with this game's analysis, so a figure can say which search produced it. */
  runs: readonly StudyRun[]
  /** The ranked lines the pass found, by position. Kept for as long as the screen is open, for the line after a move. */
  alternatives: readonly PositionLines[]
}

export function useGameReview(o: { game: StoredGame; atPly?: number }): GameReviewState {
  const { game } = o
  const [session, setSession] = useState<AnalysisSession>(() => openSession(game))
  const [alternatives, setAlternatives] = useState<readonly PositionLines[]>([])
  const [run, setRun] = useState<ReviewRun>(IDLE)
  const [depth, setDepth] = useState<number>(REVIEW_DEPTHS[1])
  const engine = useEngineAnalysis()
  const running = useRef(false)
  // The loop reads the session it is adding to, which the state it sets is one render behind. The ref is the truth.
  const live = useRef(session)
  live.current = session

  const keeping = useStudySave({ game, session, onSession: setSession, ...(o.atPly === undefined ? {} : { atPly: o.atPly }) })

  const key = `${game.id}:${game.fingerprint}:${game.moves.length}`
  useEffect(() => {
    // A different game is a different review. The ranked lines belong to the old one and nothing may carry them over.
    running.current = false
    setAlternatives([])
    setRun(IDLE)
  }, [key])

  useEffect(() => () => { running.current = false }, [])

  const review = useMemo(
    () => reviewFromSession(session, { alternatives }),
    [session, alternatives]
  )

  const ply = session.original.indexOf(session.cursor)

  const jumpTo = useCallback((to: number) => {
    setSession((s) => {
      const nodeId = s.original[Math.max(0, Math.min(to, s.original.length - 1))]
      return nodeId ? jump(s, nodeId) : s
    })
  }, [])

  /**
   * The pass.
   *
   * Every position of the game, in order, at one depth, asking for several lines. A position that already has a
   * search this deep is left alone and counted -- a review run twice costs nothing the second time, and a game
   * analysed in the Studio is most of the way there before this starts.
   */
  const start = useCallback((): void => {
    if (running.current) return
    const wanted = depth
    const plies = game.moves.length
    const held = live.current
    const todo: number[] = []
    let skipped = 0
    for (let at = 0; at <= plies; at++) {
      const nodeId = held.original[at]
      const found = nodeId ? held.evaluations[nodeId] : null
      // Deep enough already, and not a bound: nothing to gain by asking again.
      if (found && found.depth !== null && found.depth >= wanted && !found.provisional) skipped += 1
      else todo.push(at)
    }
    if (!todo.length) {
      setRun({
        running: false,
        done: 0,
        total: 0,
        skipped,
        stopped: false,
        depth: wanted,
        note: `Every one of the ${skipped} positions had already been searched ${wanted} deep or deeper, so nothing was asked again.`
          + ' The awards need the engine\'s other moves in a position, which are not kept with a game, so raise the depth to have them looked for.'
      })
      return
    }

    running.current = true
    const startedAt = Date.now()
    setRun({
      running: true,
      done: 0,
      total: todo.length,
      skipped,
      stopped: false,
      depth: wanted,
      note: `Searching ${todo.length} position${todo.length === 1 ? '' : 's'} to depth ${wanted}, asking for ${REVIEW_LINES} lines at each.`
        + (skipped ? ` ${skipped} already had a search this deep.` : '')
        + ' How long that takes depends on the positions and on this computer, so it is not predicted here.'
    })

    const got: PositionLines[] = []
    let answered = 0

    const record = (at: number, asked: string, watch: EngineWatch): void => {
      const found = evaluationFromWatch(watch, engine.status?.name, Date.now())
      if (!found || positionKey(found.fen) !== positionKey(asked)) return
      answered += 1
      setSession((s) => {
        const nodeId = s.original[at]
        return nodeId ? recordEvaluation(s, nodeId, found) : s
      })
      // The ranked lines are what an award rests on, and nothing writes them to disk, so they live for as long as
      // this screen is open and no longer. A score the engine never produced is not a line.
      const lines = watch.lines.filter((one) => one.score.kind !== 'none' && one.pvUci.length > 0)
      if (lines.length) got.push(linesFrom(at, asked, lines))
    }

    const sweep = async (): Promise<void> => {
      let done = 0
      for (const at of todo) {
        if (!running.current) break
        const fen = fenAt(game, at)
        const watch = await engine.runOne({ fen, multipv: REVIEW_LINES, depth: wanted, movetime: POSITION_CEILING_MS })
        record(at, fen, watch)
        done += 1
        setAlternatives([...got])
        setRun((s) => ({ ...s, done }))
      }
      const stopped = !running.current
      running.current = false
      const spent = Math.round((Date.now() - startedAt) / 1000)
      const note = (stopped
        ? `Stopped after ${done} of ${todo.length} positions. What was searched is kept; the rest is not analysed.`
        : `Finished: ${done} position${done === 1 ? '' : 's'} searched to depth ${wanted} in ${spent} second${spent === 1 ? '' : 's'}.`)
        + (answered < done ? ` ${done - answered} search${done - answered === 1 ? '' : 'es'} came back about another position and were not used.` : '')
        + (skipped ? ` ${skipped} position${skipped === 1 ? '' : 's'} already had a search this deep.` : '')
      setRun({ running: false, done, total: todo.length, skipped, stopped, depth: wanted, note })
      // A pass is recorded as what it was. A stopped pass called finished would make the figures it feeds look like
      // an account of the whole game.
      keeping.addRun({
        id: `review-${startedAt.toString(36)}`,
        startedAt,
        finishedAt: Date.now(),
        engine: engine.status?.name ?? null,
        asked: { positions: todo.length, quickMs: 0, deepMs: POSITION_CEILING_MS, lines: REVIEW_LINES },
        answered,
        complete: !stopped,
        notes: [
          note,
          `Game Review: every position searched to depth ${wanted}, asking for ${REVIEW_LINES} lines at each.`
            + ` This pass was measured in depth and not in time, so the ${POSITION_CEILING_MS / 1000} seconds recorded with it are the most one`
            + ' position was allowed, not a budget it spent. There was no quick pass.'
        ]
      })
    }

    void sweep()
  }, [depth, game, engine, keeping])

  const cancel = useCallback((): void => {
    running.current = false
    engine.stop()
  }, [engine])

  const canRun = engine.ready && engine.bridged && !engine.running && !run.running
  const whyNot = !engine.ready
    ? 'There is no chess engine on this computer yet, so a game cannot be searched. A game that was analysed before still reviews from the numbers that were kept.'
    : !engine.bridged
      ? 'The engine is installed, but this build of the window cannot receive its answers, so a pass would produce nothing.'
      : engine.running
        ? 'The engine is busy with another search.'
        : null

  return {
    session,
    review,
    keeping,
    engine,
    run,
    depth,
    setDepth,
    ply: ply >= 0 ? ply : 0,
    jumpTo,
    start,
    cancel,
    canRun,
    whyNot,
    runs: keeping.runs,
    alternatives
  }
}
