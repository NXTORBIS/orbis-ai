import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Segmented } from '../../../ui'
import type { NoticeKind } from '../../../lib/notices'
import { useSurface } from '../../../lib/surfaces'
import { moveTreeSurface, notesSurface, studySurface } from '../chessSurfaces'
import { ChessStage } from '../ChessStage'
import { PositionPanel } from './PositionPanel'
import { EvalGraph } from './EvalGraph'
import { MoveTree } from './MoveTree'
import { Notes } from './Notes'
import { ReportPanel, type SweepState } from './ReportPanel'
import { DEFAULT_ENGINE_SETTINGS, EnginePanel, type EngineSettings } from './EnginePanel'
import { Lines } from './Lines'
import { useEngineAnalysis } from './useEngineAnalysis'
import { useChessPrefs } from '../settings/chessSettingsStore'
import { useStudySave } from './useStudySave'
import { outcome, positionKey, type ChessMove, type PieceLetter } from '../../../../../shared/chess/rules'
import { buildMoves, newGame, SESSION_RIGHTS, type StoredGame } from '../../../../../shared/chess/model'
import { depthWords, type LoadedPosition } from '../../../../../shared/chess/analysisBoard'
import type { Mark } from '../../../../../shared/chess/marks'
import { formatScore, type MoveClass, type Score } from '../../../../../shared/chess/evaluation'
import { describeSave, labelBranch, writeStudyPgn, type StudyRun } from '../../../../../shared/chess/study'
import {
  addMove, annotate, annotationOf, bestLine, canPromote, clearAnnotation, cursorFen, evaluationFromWatch, first,
  flattenLine, last, leaveBranch, next, onMainLine, openSession, pendingUndo, planDeeper, planQuickPass, plyOf,
  prev, promote, recordEvaluation, removeLine, reportFromSession, sourceComment, undo,
  type AnalysisSession, type EngineWatch, type PositionEval
} from '../../../../../shared/chess/analysis'
import './analysis.css'

/**
 * Analysis Studio.
 *
 * The game on the left, what is known about it on the right. Everything that happens here happens to a session --
 * a tree of lines over the game, with notes and evaluations hung off its nodes -- and never to the game itself. Try
 * fifteen ideas, promote one of them, take it back: the record in the Library is the same record it was
 * (Sections 101-130).
 *
 * The screen is honest about three different kinds of nothing, because they are not the same nothing:
 *
 *   - no engine on the computer, which the panel says and offers to fix;
 *   - an engine whose answers this build cannot receive, which the panel also says, in those words;
 *   - a position nobody has analysed, which is a hole in the graph and an unnamed move in the list.
 */

type Panel = 'moves' | 'lines' | 'engine' | 'report' | 'position'

const PANELS: { value: Panel; label: string }[] = [
  { value: 'moves', label: 'Moves' },
  { value: 'lines', label: 'Lines' },
  { value: 'engine', label: 'Engine' },
  { value: 'report', label: 'Report' },
  { value: 'position', label: 'Position' }
]

/** A scratch board: a position or a game somebody pasted, held by the screen and saved nowhere. */
interface Scratch {
  game: StoredGame
  session: AnalysisSession
  kind: 'fen' | 'pgn'
  name: string | null
  notes: string[]
}

/** How long a first look at a position is worth. Short on purpose: it is for finding candidates, not for judging. */
const QUICK_MS = 300

/** One empty list, shared. A fresh `[]` each render would make the board think its marks had changed every time. */
const NOTHING_DRAWN: readonly Mark[] = Object.freeze([])

export interface AnalysisStudioProps {
  game: StoredGame
  /**
   * The move to start on, when the studio was opened about a particular one.
   *
   * The position search finds a position in a game and offers a button per move -- "24… Nf3" -- and every one of
   * those used to land on the first move of the game, because a session opens at the root and nothing carried the
   * move across. Which move it was is half of what that screen found.
   */
  atPly?: number
  onNotify?: (text: string, kind?: NoticeKind) => void
}

export default function AnalysisStudio({ game, atPly, onNotify }: AnalysisStudioProps): React.JSX.Element {
  // Read, never written: this screen honours the chess settings and does not change them.
  const prefs = useChessPrefs()
  const [owned, setOwned] = useState<AnalysisSession>(() => openSession(game))
  const [scratch, setScratch] = useState<Scratch | null>(null)
  const [panel, setPanel] = useState<Panel>('moves')
  const [orientation, setOrientation] = useState<'w' | 'b'>('w')
  const [settings, setSettings] = useState<EngineSettings>(DEFAULT_ENGINE_SETTINGS)
  const [sweep, setSweep] = useState<SweepState>({ running: false, done: 0, total: 0, note: null })
  const [said, setSaid] = useState<string | null>(null)
  const engine = useEngineAnalysis()
  const sweeping = useRef(false)

  /*
   * Two boards, one screen: your game, and a scratch board.
   *
   * Everything below reads `session` and writes through `setSession`, and which of the two it lands on is this
   * flag. It is a ref rather than a piece of state because `setSession` is handed to things that must not be
   * rebuilt every time the board changes, and a stale copy of it writing a move into the wrong session is exactly
   * the kind of fault that would be impossible to see.
   *
   * The study save below is given the owned session and the owned setter directly. That is what keeps a pasted
   * position out of your profile: nothing about a scratch board ever reaches it.
   */
  const onScratch = useRef(false)
  onScratch.current = scratch !== null
  const session = scratch ? scratch.session : owned
  const setSession = useCallback((next: AnalysisSession | ((s: AnalysisSession) => AnalysisSession)): void => {
    const apply = (held: AnalysisSession): AnalysisSession => (typeof next === 'function' ? next(held) : next)
    if (onScratch.current) setScratch((held) => (held ? { ...held, session: apply(held.session) } : held))
    else setOwned(apply)
  }, [])

  /** Putting a pasted position or game on the board, as a scratch board that is saved nowhere. */
  const loadScratch = useCallback((loaded: LoadedPosition): void => {
    const built = buildMoves(loaded.startFen, loaded.moves.map((san) => ({ san })))
    const notes = [...loaded.notes]
    if (!built.ok && built.failedAt) {
      notes.push(`"${built.failedAt.move}" could not be played, so the board stops before it.`)
    }
    const base = newGame({
      id: 'scratch',
      profileId: game.profileId,
      source: { kind: 'custom-position' },
      startFen: loaded.startFen,
      ...(loaded.name ? { meta: { event: loaded.name } } : {}),
      now: Date.now()
    })
    const made: StoredGame = { ...base, moves: built.moves }
    onScratch.current = true
    setScratch({ game: made, session: openSession(made), kind: loaded.kind, name: loaded.name, notes })
    setPanel('moves')
  }, [game.profileId])

  const leaveScratch = useCallback((): void => {
    onScratch.current = false
    setScratch(null)
  }, [])

  /*
   * What was saved about this game, put back on it -- and kept as the person works.
   *
   * This is also what opens the session again when the game itself changes in the store: a game that changed is a
   * different game to look at, and lines tried against the old moves would hang off positions it no longer reaches.
   * `restoreStudy` refuses to graft a saved tree onto a game whose moves have moved for exactly that reason, and
   * says so instead.
   */
  const keeping = useStudySave({ game, session: owned, onSession: setOwned, ...(atPly === undefined ? {} : { atPly }) })
  const key = `${game.id}:${game.fingerprint}:${game.moves.length}`
  useEffect(() => {
    setSweep({ running: false, done: 0, total: 0, note: null })
  }, [key])

  useEffect(() => () => { sweeping.current = false }, [])

  const fen = cursorFen(session)
  const node = session.tree.nodes[session.cursor]
  const rows = useMemo(() => flattenLine(session), [session])
  const report = useMemo(() => reportFromSession(session), [session])
  const state = useMemo(() => outcome(fen), [fen])
  const rights = SESSION_RIGHTS.analysis

  const marks = useMemo(() => {
    const out: Record<string, MoveClass> = {}
    for (const row of report.moves) {
      const nodeId = session.original[row.ply]
      if (nodeId && row.klass !== 'unclear') out[nodeId] = row.klass
    }
    return out
  }, [report, session.original])

  /*
   * The arrows and coloured squares somebody draws on the board.
   *
   * The board has always been able to draw them, and no screen in Chess World ever gave it anywhere to put them --
   * so `onMarksChange` was a prop nobody passed, every board in Chess World refused to be drawn on, and the four keys
   * the keyboard sheet advertises for it (M, C, X and Delete) did nothing anywhere. `Board.tsx` is explicit about it:
   * "a board given no onMarksChange draws the marks it is handed and cannot be drawn on". This is the somewhere.
   *
   * Kept against the position rather than against the board, because that is what a drawing is about: step forward
   * and back through the line and the arrows you drew on each position are still on it. Held for as long as the
   * screen is open and not written to the profile -- `useStudySave` keeps the lines and the notes, and claiming to
   * keep these as well without writing them would be the same kind of lie this fixes.
   */
  const [drawings, setDrawings] = useState<Readonly<Record<string, readonly Mark[]>>>({})
  const drawingKey = positionKey(fen)
  const drawnHere = drawings[drawingKey] ?? NOTHING_DRAWN
  const onDraw = useCallback((next: Mark[]): void => {
    setDrawings((was) => ({ ...was, [drawingKey]: next }))
  }, [drawingKey])

  // The bar prefers what the engine is saying about this very position right now, and falls back to what was
  // recorded earlier. It never shows a number calculated somewhere else.
  const liveLine = engine.watch.fen && positionKey(engine.watch.fen) === positionKey(fen) ? bestLine(engine.watch) : null
  const recorded = session.evaluations[session.cursor] ?? null
  const shown: Score = liveLine && liveLine.score.kind !== 'none' ? liveLine.score : recorded ? recorded.score : { kind: 'none' }

  const cursorPly = session.original.indexOf(session.cursor)
  const here = plyOf(session, session.cursor)
  const lastMove = node?.move ?? null

  const say = (text: string, kind?: NoticeKind): void => {
    setSaid(text)
    onNotify?.(text, kind)
  }

  // Taken out of the hook's value on its own, so the sweep below does not depend on an object that changes identity
  // on every redraw. `addRun` itself never changes.
  const addRun = keeping.addRun

  const onMove = (move: ChessMove): void => {
    if (!rights.variations) return
    const added = addMove(session, { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) })
    if (!added) return
    setSession(added.session)
    if (!added.existing && !session.original.includes(added.nodeId)) {
      say(`${move.san} added as a line. The game itself is unchanged.`)
    }
  }

  /** Recording what the engine just said about the position on the board. */
  useEffect(() => {
    if (!engine.watch.complete || !engine.watch.fen) return
    const found = evaluationFromWatch(engine.watch, engine.status?.name, Date.now())
    if (!found) return
    setSession((s) => {
      const nodeId = positionKey(cursorFen(s)) === positionKey(found.fen) ? s.cursor : null
      return nodeId ? recordEvaluation(s, nodeId, found) : s
    })
  }, [engine.watch, engine.status?.name])

  // Opened about a particular move: go there once, and never argue with where the person has moved to since.
  // The dependencies are two numbers and a string, so this cannot re-run on an unrelated redraw.
  useEffect(() => {
    if (atPly === undefined) return
    setOwned((s) => {
      const nodeId = s.original[Math.max(0, Math.min(atPly, s.original.length - 1))]
      return nodeId && s.tree.nodes[nodeId] ? { ...s, cursor: nodeId } : s
    })
  }, [atPly, game.id])

  const jump = (nodeId: string): void => setSession((s) => ({ ...s, cursor: s.tree.nodes[nodeId] ? nodeId : s.cursor }))
  const jumpPly = (ply: number): void => {
    const nodeId = session.original[Math.max(0, Math.min(ply, session.original.length - 1))]
    if (nodeId) jump(nodeId)
  }

  const doPromote = (): void => {
    if (!canPromote(session, session.cursor)) return
    setSession(promote(session, session.cursor))
    say('That line is now the main line. The game as played is still in the list, as a variation.')
  }

  const doRemove = (): void => {
    const result = removeLine(session, session.cursor)
    if (result.refused) { say(result.refused, 'error'); return }
    setSession(result.session)
    say(`${result.removed.length} move${result.removed.length === 1 ? '' : 's'} removed. Undo puts them back.`)
  }

  const doUndo = (): void => {
    const result = undo(session)
    if (!result.what) return
    setSession(result.session)
    say(`Took back ${result.what}.`)
  }

  const saveNote = (patch: { text?: string; nags?: string[] }): void => {
    setSession((s) => annotate(s, s.cursor, patch, Date.now()))
  }

  const nameLine = (nodeId: string, label: string): void => {
    setSession((s) => labelBranch(s, nodeId, label))
    say(label.trim() ? `That line is now called "${label.trim()}".` : 'That line has no name now.')
  }

  /**
   * The analysis as a PGN, on the clipboard, with what PGN cannot carry said out loud.
   *
   * It is never called a complete export, because it is not one: the engine's answers do not survive the trip, and a
   * score written into a comment without the depth behind it would read as a settled judgement. `writeStudyPgn`
   * returns the list of what is left out, and it is shown rather than filed away (Section 129).
   */
  const copyStudy = (): void => {
    const written = writeStudyPgn(session)
    void navigator.clipboard.writeText(written.text).then(
      () => say(`Copied. What PGN cannot carry: ${written.omitted.join(' ')}`),
      () => say('Orbis could not put it on the clipboard.', 'error')
    )
  }

  const install = (): void => {
    void window.api.chessEngineInstall()
      .then(() => say('Setting the engine up. It will say so here when it is ready; press Check again.'))
      .catch((err: unknown) => say(err instanceof Error ? err.message : 'The engine could not be set up.', 'error'))
  }

  /**
   * Going over the whole game.
   *
   * A quick look at every position the budget reaches, then a proper search of the positions where the numbers
   * moved. The plan is worked out before anything runs and its own account of what it is skipping is shown, so a
   * sweep that cannot cover the game says which part it gave up rather than quietly covering less.
   */
  const runSweep = useCallback(async (): Promise<void> => {
    // A scratch board is not one of your games, so a pass over it would have nowhere to be recorded.
    if (sweeping.current || onScratch.current) return
    const positions = game.moves.length + 1
    const totalMs = Math.max(QUICK_MS * 2, QUICK_MS * positions * 2)
    const budget = {
      totalMs,
      quickMs: QUICK_MS,
      deepMs: settings.limit === 'time' ? settings.movetime : 2000,
      deepShare: 0.5,
      multipv: 1,
      deepMultipv: settings.lines
    }
    /*
     * One name for the whole pass, used for both halves of it.
     *
     * It is what the request ids are built from, so an answer can be matched to the pass that asked for it, and it
     * is what the run is filed under with the analysis -- so a report reopened next week can say which pass produced
     * its numbers rather than looking like the result of a search nobody has run (Section 158).
     */
    const runId = `sweep-${Date.now().toString(36)}`
    const startedAt = Date.now()
    const quick = planQuickPass(game, budget, runId)
    sweeping.current = true
    // The sweep is budgeted in time, whatever the panel's own limit is set to: a budget for a whole game cannot be
    // made of depths, because a depth does not say how long it will take. This says so rather than leaving the
    // panel's "Depth" setting looking as though it were being used here.
    const shape = `A ${QUICK_MS}ms look at each position first, then ${budget.deepMs}ms on the ones where the numbers moved.`
    setSweep({ running: true, done: 0, total: quick.steps.length, note: [shape, ...quick.notes].join(' ') })

    const got: PositionEval[] = []
    const record = (ply: number, fenAsked: string, watch: EngineWatch): void => {
      const found = evaluationFromWatch(watch, engine.status?.name, Date.now())
      if (!found || positionKey(found.fen) !== positionKey(fenAsked)) return
      got.push({
        ply,
        fen: found.fen,
        score: found.score,
        depth: found.depth,
        ...(found.bestmove !== undefined ? { bestmove: found.bestmove } : {}),
        ...(found.pvUci ? { pvUci: found.pvUci } : {}),
        ...(found.provisional !== undefined ? { provisional: found.provisional } : {})
      })
      setSession((s) => {
        const nodeId = s.original[ply]
        return nodeId ? recordEvaluation(s, nodeId, found) : s
      })
    }

    let done = 0
    for (const step of quick.steps) {
      if (!sweeping.current) break
      const watch = await engine.runOne({ fen: step.fen, multipv: 1, ...(step.limits.movetime ? { movetime: step.limits.movetime } : {}) })
      record(step.ply, step.fen, watch)
      done += 1
      setSweep((s) => ({ ...s, done }))
    }

    const stamp = (answered: number, complete: boolean, notes: string[]): StudyRun => ({
      id: runId,
      startedAt,
      finishedAt: Date.now(),
      engine: engine.status?.name ?? null,
      asked: { positions: quick.steps.length, quickMs: quick.msEach, deepMs: budget.deepMs, lines: settings.lines },
      answered,
      complete,
      notes
    })

    if (!sweeping.current) {
      const note = `Stopped after ${done} positions. What was searched is kept; the rest is not analysed.`
      setSweep({ running: false, done, total: quick.steps.length, note })
      // A pass that was stopped is recorded as stopped. Calling it finished would make the report it feeds look like
      // an account of the whole game.
      addRun(stamp(got.length, false, [note, ...quick.notes]))
      return
    }

    const deep = planDeeper(game, budget, got, runId)
    setSweep((s) => ({ ...s, total: quick.steps.length + deep.steps.length, note: deep.notes.join(' ') }))
    for (const step of deep.steps) {
      if (!sweeping.current) break
      const watch = await engine.runOne({
        fen: step.fen,
        multipv: step.multipv,
        ...(step.limits.movetime ? { movetime: step.limits.movetime } : {})
      })
      record(step.ply, step.fen, watch)
      done += 1
      setSweep((s) => ({ ...s, done }))
    }

    const stopped = !sweeping.current
    sweeping.current = false
    const notes = [
      stopped ? `Stopped after ${done} searches.` : `Finished: ${done} searches.`,
      ...quick.notes,
      ...deep.notes,
      ...(deep.notDeepened.length ? [`${deep.notDeepened.length} candidate moves were not searched again for want of time.`] : [])
    ]
    setSweep({ running: false, done, total: quick.steps.length + deep.steps.length, note: notes.join(' ') })
    addRun(stamp(got.length, !stopped && deep.notDeepened.length === 0, notes))
  }, [game, settings, engine, addRun])

  const cancelSweep = (): void => {
    sweeping.current = false
    engine.stop()
  }

  const cursorRow = rows.find((row) => row.nodeId === session.cursor) ?? null
  const about = cursorRow ? `${cursorRow.number}${cursorRow.side === 'w' ? '.' : '…'}${cursorRow.san}` : 'the starting position'

  const canSweep = engine.ready && engine.bridged && !engine.running && scratch === null
  const whyNot = scratch !== null
    ? 'This is a scratch board, so there is nowhere to file a whole-game pass. Ask the engine about single positions here, or save the game to your Library first.'
    : !engine.ready
    ? 'There is no chess engine on this computer yet, so a whole-game pass cannot be run. The board, your lines and your notes all work without one.'
    : !engine.bridged
      ? 'The engine is installed, but this build of the window cannot receive its answers, so a whole-game pass would produce nothing.'
      : engine.running
        ? 'The engine is busy with the position on the board.'
        : null

  /*
   * What Orbis itself may do on this screen: the three panels, as three screens of their own.
   *
   * The studio holds the session, so the move list and the notes are declared here rather than inside their own
   * components -- they are this screen's state and this screen's handlers either way, and a declaration beside the
   * state it reads cannot drift from it. Both say `showing` so that a panel on a tab nobody is looking at is
   * reported as not in front of anybody rather than as missing: its controls still work, which is the truth.
   *
   * The engine panel declares itself, in `EnginePanel.tsx`, because it really is only there while it is the panel
   * on screen -- and this screen names it as something it can open, with the control that opens it.
   */
  useSurface(
    studySurface({
      game: () => ({ id: game.id, moves: game.moves.length, white: game.meta.white.name ?? null, black: game.meta.black.name ?? null }),
      panel: () => panel,
      setPanel,
      orientation: () => orientation,
      setOrientation,
      evaluated: () => Object.keys(session.evaluations).length,
      sweep: () => sweep,
      whyNoSweep: () => (canSweep ? null : whyNot),
      review: runSweep,
      stopReview: cancelSweep,
      saving: () => describeSave(keeping.state)
    })
  )

  useSurface(
    moveTreeSurface({
      rows: () => rows,
      ply: () => cursorPly,
      moves: () => game.moves.length,
      goToPly: jumpPly,
      back: () => setSession(prev(session)),
      forward: () => setSession(next(session)),
      toStart: () => setSession(first(session)),
      toEnd: () => setSession(last(session)),
      onMainLine: () => onMainLine(session),
      canGoOn: () => Boolean(node?.children.length),
      leaveBranch: () => setSession(leaveBranch(session)),
      canPromote: () => canPromote(session, session.cursor),
      promote: doPromote,
      removeLine: doRemove,
      undoable: () => pendingUndo(session),
      undo: doUndo,
      copyPgn: copyStudy,
      showing: () => panel === 'moves'
    })
  )

  useSurface(
    notesSurface({
      text: () => annotationOf(session, session.cursor)?.text ?? '',
      save: (text) => saveNote({ text }),
      clear: () => setSession(clearAnnotation(session, session.cursor, Date.now())),
      about: () => about,
      fromTheGame: () => sourceComment(session, session.cursor),
      showing: () => panel === 'moves'
    })
  )

  /**
   * Walking into one of the engine's lines.
   *
   * Each move of a line is a button, and pressing the third one plays the first three into the session as a
   * variation. The rules are asked for every one of them -- a line is checked move by move rather than trusted
   * because the engine sent it -- so a line that stops being legal part way stops the walk there.
   */
  const followLine = (uci: readonly string[], upTo: number): void => {
    if (!rights.variations) return
    setSession((s) => {
      let walked = s
      for (let index = 0; index < upTo && index < uci.length; index += 1) {
        const step = uci[index]
        const promotion = step.slice(4, 5)
        const added = addMove(walked, { from: step.slice(0, 2), to: step.slice(2, 4), ...(promotion ? { promotion: promotion as PieceLetter } : {}) })
        if (!added) break
        walked = { ...added.session, cursor: added.nodeId }
      }
      return walked
    })
  }

  const result = (scratch ? scratch.game : game).meta.result
  const names = {
    white: (scratch ? scratch.game : game).meta.white.name ?? null,
    black: (scratch ? scratch.game : game).meta.black.name ?? null
  }
  const liveDepth = liveLine ? depthWords(liveLine.depth) : null

  /*
   * The strip above the board: who played, how it ended, and what the engine is saying about the position in
   * front of you.
   *
   * A name nobody recorded is not drawn at all. A score nothing has calculated is a dash, not a zero: the chip
   * reads the score the board's own strip is reading, so the two cannot disagree.
   */
  const above = (
    <div className="cw-an-strip">
      {names.black && <span className="cw-an-player">{names.black} <small>Black</small></span>}
      {names.white && <span className="cw-an-player">{names.white} <small>White</small></span>}
      {result !== '*' && <span className="cw-an-result">{result}</span>}
      {scratch && <span className="cw-an-scratchchip" title="Pasted here, and saved nowhere">Scratch board</span>}
      <span className="cw-an-turnchip">
        {state.over
          ? state.reason === 'checkmate' ? `Checkmate — ${state.result}` : `Drawn — ${state.reason.replace(/-/g, ' ')}`
          : `${fen.split(' ')[1] === 'w' ? 'White' : 'Black'} to move${state.check ? ', in check' : ''}`}
      </span>
      <span className={`cw-an-scorechip${shown.kind === 'none' ? ' is-unknown' : ''}`} title={shown.kind === 'none' ? 'Nothing has been calculated for this position.' : 'From White’s point of view'}>
        {shown.kind === 'none' ? '—' : formatScore(shown)}
        {liveDepth && <small>{liveDepth}</small>}
      </span>
    </div>
  )

  /* Under the board: the buttons that walk the line, and the graph of what has really been calculated. */
  const below = (
    <>
      <div className="cw-nav" role="group" aria-label="Walk the line">
        <button type="button" className="cw-nav-btn" title="The starting position" aria-label="The starting position" disabled={here === 0} onClick={() => setSession(first(session))}>⏮</button>
        <button type="button" className="cw-nav-btn" title="Back one move" aria-label="Back one move" disabled={here === 0} onClick={() => setSession(prev(session))}>◀</button>
        <button type="button" className="cw-nav-btn" title="Forward one move" aria-label="Forward one move" disabled={!node?.children.length} onClick={() => setSession(next(session))}>▶</button>
        <button type="button" className="cw-nav-btn" title="The end of this line" aria-label="The end of this line" disabled={!node?.children.length} onClick={() => setSession(last(session))}>⏭</button>
        <button type="button" className="cw-nav-btn" title="Turn the board round" aria-label="Turn the board round" onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}>⇅</button>
        {!onMainLine(session) && (
          <button type="button" className="cw-nav-btn cw-an-wide" onClick={() => setSession(leaveBranch(session))}>Back to the main line</button>
        )}
      </div>
      <EvalGraph points={report.graph} cursorPly={cursorPly >= 0 ? cursorPly : null} onPick={jumpPly} />
    </>
  )

  const right = (
    <>
      <Segmented
        label="What to show"
        className="cw-an-tabs"
        optionClass="cw-an-tab"
        litClass="on"
        value={panel}
        options={PANELS}
        onChange={setPanel}
      />

      {session.note && <p className="cw-an-warn">{session.note}</p>}

      {/*
        * Where the saving stands, always on screen.
        *
        * It is a line of text rather than a button because there is nothing to press: the lines and the notes are
        * kept as they are made. What it must never do is say "saved" when nothing was written, which is why
        * `describeSave` reads the refusal out of the state rather than the screen assuming a save landed.
        */}
      <p className={`cw-an-keep${keeping.state.kind === 'refused' ? ' is-refused' : ''}`} role="status">
        {scratch
          ? 'A scratch board. Nothing on it is being saved; your game is waiting under the Position tab.'
          : describeSave(keeping.state)}
        {!scratch && keeping.restored && (keeping.counts.branches > 0 || keeping.counts.notes > 0 || keeping.counts.evaluations > 0) && (
          <span className="cw-an-depth">
            {' '}Put back: {keeping.counts.branches} branch{keeping.counts.branches === 1 ? '' : 'es'},{' '}
            {keeping.counts.notes} note{keeping.counts.notes === 1 ? '' : 's'},{' '}
            {keeping.counts.evaluations} engine answer{keeping.counts.evaluations === 1 ? '' : 's'}.
          </span>
        )}
      </p>
      {keeping.notes.length > 0 && (
        <>
          <ul className="cw-an-ignored" aria-label="What could not be read or put back">
            {keeping.notes.map((one) => <li key={one}>{one}</li>)}
          </ul>
          <div className="cw-an-row">
            <Button size="tiny" onClick={keeping.clearNotes}>I have read that</Button>
          </div>
        </>
      )}

      {panel === 'moves' && (
        <>
          <MoveTree rows={rows} cursor={session.cursor} onJump={jump} marks={marks} original={session.original} />
          <div className="cw-an-row">
            <Button size="tiny" disabled={!canPromote(session, session.cursor)} onClick={doPromote}>Make this the main line</Button>
            <Button size="tiny" disabled={session.cursor === session.tree.rootId} onClick={doRemove}>Remove this line</Button>
            <Button size="tiny" disabled={!pendingUndo(session)} onClick={doUndo}>
              {pendingUndo(session) ? `Undo ${pendingUndo(session)}` : 'Undo'}
            </Button>
            <Button size="tiny" onClick={copyStudy}>Copy as PGN</Button>
            {/*
              * This used to be a paragraph under the move list. It says something true and worth knowing once, so
              * it is a mark you can hover and read rather than three lines of explanation above the controls.
              */}
            <span className="cw-an-hint" title="Lines you try here are yours to explore and are never written into the game. The game as played stays marked in the list even after another line has been promoted over it.">
              What happens to the game?
            </span>
          </div>
          <Notes
            about={about}
            nodeId={session.cursor}
            annotation={annotationOf(session, session.cursor)}
            sourceComment={sourceComment(session, session.cursor)}
            onSave={saveNote}
            onClear={() => setSession(clearAnnotation(session, session.cursor, Date.now()))}
          />
        </>
      )}

      {panel === 'lines' && (
        <Lines session={session} orientation={orientation} onJump={jump} onLabel={nameLine} />
      )}

      {panel === 'engine' && (
        <EnginePanel
          engine={engine}
          fen={fen}
          settings={settings}
          onSettings={setSettings}
          onInstall={install}
          busy={sweep.running}
          onFollow={rights.variations ? followLine : undefined}
        />
      )}

      {panel === 'report' && (
        <ReportPanel
          report={report}
          onJump={jumpPly}
          sweep={sweep}
          onSweep={() => { void runSweep() }}
          onCancel={cancelSweep}
          canSweep={canSweep}
          whyNot={whyNot}
          runs={keeping.runs}
          engineNow={engine.status?.name ?? null}
        />
      )}

      {panel === 'position' && (
        <PositionPanel
          fen={fen}
          pgn={() => writeStudyPgn(session)}
          onLoad={loadScratch}
          onSay={(text, bad) => say(text, bad ? 'error' : undefined)}
          scratch={scratch ? { kind: scratch.kind, name: scratch.name, notes: scratch.notes } : null}
          onLeaveScratch={leaveScratch}
        />
      )}

      {said && <p className="cw-an-said" role="status">{said}</p>}
    </>
  )

  /*
   * The board is the biggest thing on the screen, and it is `ChessStage` that makes it so.
   *
   * This screen used to draw the board itself, inside a column that also held the nav, the graph and whatever text
   * sat under it -- so the board was sized by that text and settled at about 357 pixels whatever the window did.
   * The stage measures the room and hands the board a pixel size, and the panel beside it is a column that gives
   * way rather than one the board has to fit around.
   */
  return (
    <ChessStage
      className="cw-an-stage"
      label="Analysis board"
      above={above}
      below={below}
      right={right}
      board={{
        fen,
        orientation,
        interactive: rights.variations && !state.over,
        lastMove: lastMove ? { from: lastMove.uci.slice(0, 2), to: lastMove.uci.slice(2, 4) } : null,
        onMove,
        marks: drawnHere,
        onMarksChange: onDraw,
        // "The bar beside the board" in the settings really is this bar: turned off, no strip is drawn at all.
        evalBar: prefs.analysis.evalBar ? { score: shown } : null,
        label: 'Analysis board'
      }}
    />
  )
}
