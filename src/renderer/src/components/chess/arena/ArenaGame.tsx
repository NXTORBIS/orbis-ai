import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChessStage } from '../ChessStage'
import { MoveList, MoveNav } from '../MoveList'
import { OpponentPicker } from './OpponentPicker'
import { useChessPrefs } from '../settings/chessSettingsStore'
import { playChessSound } from '../settings/chessSound'
import { Button, Segmented } from '../../../ui'
import type { NoticeKind } from '../../../lib/notices'
import { useSurface } from '../../../lib/surfaces'
import { playSurface } from '../chessSurfaces'
import { START_FEN, moveNumber, sideToMove, type ChessMove, type PieceLetter } from '../../../../../shared/chess/rules'
import { fenAt } from '../../../../../shared/chess/model'
import { type Score } from '../../../../../shared/chess/evaluation'
import { clampPly } from '../../../../../shared/chess/moveList'
import { premoveStatus, premoveWords, type Premove } from '../../../../../shared/chess/premove'
import {
  barFor,
  browsing,
  browsingWords,
  clockFamilies,
  colourWords,
  setupChips
} from '../../../../../shared/chess/playSetup'
import {
  describeOpponent,
  opponent,
  type AdvertisedOption,
  type OpponentId
} from '../../../../../shared/chess/opponents'
import { formatForSettings } from '../../../../../shared/chess/settings'
import {
  ASSISTANCE_LEVELS,
  STANDARD_SETUP,
  STRENGTH_NOTE,
  acceptDraw,
  addRemark,
  assistance,
  clearHint,
  declineDraw,
  difficulty,
  engineAnswered,
  engineAsked,
  engineFailed,
  engineShouldAcceptDraw,
  engineTurn,
  engineTurnRequest,
  hintAsked,
  hintRequest,
  pointsFor,
  metaFor,
  movesFor,
  offerDraw,
  pause,
  playMove,
  readEngineUpdate,
  resign,
  resume,
  revealHint,
  setupProblems,
  sourceFor,
  startArena,
  summaryOf,
  takeBack,
  thinkingLine,
  tick,
  withdrawDraw,
  yourTurn,
  type ArenaSetup,
  type ArenaState,
  type Assistance,
  type Difficulty
} from '../../../../../shared/chess/arena'
import {
  describeTimeControl,
  formatClock,
  lowTimeAt,
  remainingAt,
  spentAt,
  timeControlById
} from '../../../../../shared/chess/clock'
import { COMMENTARY_STYLES, remarkOn, type CommentaryStyle, type Judgement } from '../../../../../shared/chess/commentary'
import './play.css'

/**
 * Playing a real game against the engine.
 *
 * The screen owns none of the chess. Whose turn it is, whether a move may be played, when the engine must think,
 * what the clock says and how the game ends all come from `arena.ts` and `clock.ts`, which are pure and tested;
 * this draws the answers and sends the engine's searches off. That split is what makes it possible to know the
 * rules are right without opening the window, and it is why there is no second opinion about anything here.
 *
 * Four things it is careful about.
 *
 * **Time is read from a monotonic source.** `performance.now()`, never `Date.now()` and never the redraw rate. A
 * timer every fifth of a second is only there to make the clock move on screen: it tells the session what time it
 * is and the session works the rest out, so a window that stops redrawing comes back to the right clock rather
 * than a slow one.
 *
 * **An answer is matched before it is used.** Every analysis update carries the request it belongs to and the
 * position it was about. Anything that does not match what this screen is waiting for is dropped. The session
 * refuses it as well, so a mismatch has to get past two checks that do not trust each other.
 *
 * **The engine is asked once a turn.** The session refuses a second ask for a position it has already asked
 * about, and a ref here refuses one in the gap before that state has landed. React renders twice in development;
 * without both guards that is two searches and two moves for one turn.
 *
 * **A judgement needs two real evaluations.** The commentary may call a move a mistake only from the engine's own
 * numbers for the position before it and the position after it, both from searches that really ran and both deep
 * enough to quote. Until both exist, the remark is about what the board plainly shows and nothing more.
 */

export interface ArenaGameProps {
  onNotify: (text: string, kind?: NoticeKind) => void
  /** Called with the stored game's id when the person asks to look at the game they have just played. */
  onStudy?: (gameId: string) => void
}

interface EngineStatus {
  state: string
  detail: string
  name?: string
  version?: string
  /**
   * What the engine advertised about itself. The opponent cards need it to say whether the strength this screen
   * offers will really be set, so an engine with no strength dial cannot be presented as nine opponents.
   */
  options?: AdvertisedOption[]
}

/** What a settled search said about one position. The material a judgement is made of. */
interface Known {
  score: Score
  depth: number
  bestUci?: string
}

const monotonic = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const plainly = (err: unknown): string =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : 'That did not work.'

/** The engine can be played against unless it is missing or still arriving. A failure is recoverable. */
const canPlay = (status: EngineStatus | null): boolean =>
  status !== null && status.state !== 'not-installed' && status.state !== 'installing'


/** How often this screen asks the engine about one position before it stops and says so. */
const MAX_TRIES = 4

export function ArenaGame({ onNotify, onStudy }: ArenaGameProps): React.JSX.Element {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)

  // The setup, kept while a game is played so "play again" does not ask everything twice.
  const [side, setSide] = useState<ArenaSetup['side']>(STANDARD_SETUP.side)
  const [level, setLevel] = useState<Difficulty>(STANDARD_SETUP.difficulty)
  const [controlId, setControlId] = useState(STANDARD_SETUP.control.id)
  const [help, setHelp] = useState<Assistance>(STANDARD_SETUP.assistance)
  const [style, setStyle] = useState<CommentaryStyle>(STANDARD_SETUP.commentary)

  /** The named opponent, when one has been chosen from the list. Null means the five-level setting is used. */
  const [opponentId, setOpponentId] = useState<OpponentId | null>(null)

  const [game, setGame] = useState<ArenaState | null>(null)
  /** The board's own settings: whether the bar is wanted at all, which sounds play, how a score is written. */
  const prefs = useChessPrefs()
  /** The bar can also be put away for this game without changing the setting. */
  const [barOn, setBarOn] = useState(true)
  /** The move held while it is the engine's turn. The board holds it; the rules are only asked when it falls due. */
  const [premoveHeld, setPremoveHeld] = useState<Premove | null>(null)
  /** Which move is being looked at. Null means the game as it is, which is the only place a move can be played. */
  const [viewPly, setViewPly] = useState<number | null>(null)
  const [orientation, setOrientation] = useState<'w' | 'b'>('w')
  const [confirmResign, setConfirmResign] = useState(false)
  const [, setClockNow] = useState(() => monotonic())
  /** The search that is running, depth by depth, and only ever for the position it names. */
  const [live, setLive] = useState<{ fen: string; score: Score; depth: number | null; bound: 'lower' | 'upper' | null } | null>(null)

  /*
   * The game as it is this instant.
   *
   * An analysis answer arrives on a channel, outside React's own flow, and has to be judged against the game as
   * it is now rather than as it was when the listener was made. Every change goes through `apply`, which keeps
   * this and the state in step.
   */
  const gameRef = useRef<ArenaState | null>(null)
  /** What the engine has already been asked, so the gap before `askedAtPly` lands cannot be asked into. */
  const askRef = useRef('')
  const attemptRef = useRef(0)
  /*
   * How often this screen has asked about one position by itself.
   *
   * An engine that answers with a move that cannot be played is a real failure mode, and a screen that simply
   * asks again turns it into an endless loop with a spinner on it. After `MAX_TRIES` it stops and leaves the
   * reason and a button, so the person is told rather than left watching.
   */
  const triesRef = useRef({ ply: -1, count: 0 })
  /** What a settled search said about each position. This is what a judgement of a move is made from. */
  const knownRef = useRef(new Map<string, Known>())
  /** The id of the stored game, so a game is created once and saved over. */
  const savedRef = useRef('')
  const savingRef = useRef<Promise<void>>(Promise.resolve())
  const saveProblemRef = useRef(false)
  const lastRemarkRef = useRef<string | null>(null)

  const engineName = status?.name
  const apply = useCallback((next: ArenaState | null): void => {
    gameRef.current = next
    setGame(next)
  }, [])

  // ---------------------------------------------------------------- the engine's status

  const refresh = useCallback(async (): Promise<EngineStatus | null> => {
    try {
      const got = (await window.api.chessEngineStatus()) as EngineStatus
      setStatus(got)
      return got
    } catch {
      setStatus(null)
      return null
    }
  }, [])

  useEffect(() => {
    void refresh()
    const offProgress = window.api.onChessEngineProgress((message: string) => setProgress(message))
    const offChanged = window.api.onChessEngineChanged(() => {
      setInstalling(false)
      setProgress(null)
      void refresh()
    })
    return () => {
      offProgress()
      offChanged()
    }
  }, [refresh])

  /*
   * While the engine is arriving, its status is asked for again every couple of seconds.
   *
   * There is a push channel for progress and one for "it changed", and none for "it failed". Without this, an
   * install that cannot finish leaves a button saying "Setting up…" for ever, which looks exactly like a program
   * that has stopped working.
   */
  useEffect(() => {
    if (!installing) return undefined
    const id = window.setInterval(() => {
      void refresh().then((got) => {
        if (!got) return
        if (got.state === 'failed') {
          setInstalling(false)
          setProgress(null)
          onNotify(got.detail || 'The engine could not be set up.', 'error')
        } else if (got.state !== 'installing') {
          setInstalling(false)
          setProgress(null)
        }
      })
    }, 2000)
    return () => window.clearInterval(id)
  }, [installing, refresh, onNotify])

  const install = useCallback(async (): Promise<void> => {
    setInstalling(true)
    setProgress('Asking upstream for the engine…')
    try {
      await window.api.chessEngineInstall()
    } catch (err) {
      setInstalling(false)
      setProgress(null)
      onNotify(plainly(err), 'error')
    }
  }, [onNotify])

  // ---------------------------------------------------------------- saving

  const save = useCallback(
    (state: ArenaState): void => {
      if (!state.moves.length) return
      const meta = metaFor(state, engineName ? { engineName } : {}) as unknown as Record<string, unknown>
      savingRef.current = savingRef.current.then(async () => {
        try {
          if (!savedRef.current) {
            const created = await window.api.chessCreate({
              source: sourceFor(state, engineName) as unknown,
              startFen: state.startFen,
              meta,
              variant: 'standard'
            })
            savedRef.current = created.id
            const current = gameRef.current
            if (current) apply({ ...current, gameId: created.id })
          }
          await window.api.chessSaveMoves(savedRef.current, movesFor(state) as unknown[], meta)
        } catch (err) {
          // Said once. A message for every move of a game that cannot be saved is worse than useless.
          if (!saveProblemRef.current) {
            saveProblemRef.current = true
            onNotify(`The game is being played but could not be saved: ${plainly(err)}`, 'error')
          }
        }
      })
    },
    [apply, engineName, onNotify]
  )

  // ---------------------------------------------------------------- what is said about a move

  /**
   * A remark about the move just played.
   *
   * `judgement` is only ever passed when two real searches exist for the two positions either side of the move.
   * With none, the remark is about what the board shows, and often there is no remark at all.
   */
  const remarkFor = useCallback((state: ArenaState, judgement?: Judgement): ArenaState => {
    if (state.setup.commentary === 'silent') return state
    const last = state.moves.at(-1)
    if (!last) return state
    const before = state.moves.length >= 2 ? state.moves[state.moves.length - 2].fen : state.startFen
    const remark = remarkOn(
      {
        move: { before, uci: last.uci, history: state.history, ply: state.moves.length },
        human: state.human,
        ...(judgement ? { judgement } : {})
      },
      state.setup.commentary,
      { last: lastRemarkRef.current }
    )
    if (!remark) return state
    // An engine remark is only worth adding on top of one already made about the same move.
    if (judgement && remark.from !== 'engine') return state
    lastRemarkRef.current = remark.id
    return addRemark(state, { ply: state.moves.length, text: remark.text, from: remark.from, id: remark.id })
  }, [])

  /**
   * The person's last move, judged from the engine's own numbers.
   *
   * Both ends have to exist: the engine's settled score for the position before the move, and its settled score
   * for the position after it. The first comes from the search that chose the engine's previous move, the second
   * from the search that has just finished. Without both, nothing is judged.
   */
  const judgeHuman = useCallback(
    (state: ArenaState): ArenaState => {
      const last = state.moves.at(-1)
      if (!last) return state
      // The side to move now is the one that did not just move.
      if (sideToMove(state.fen) !== state.engine) return state
      const beforeFen = state.moves.length >= 2 ? state.moves[state.moves.length - 2].fen : state.startFen
      const before = knownRef.current.get(beforeFen)
      const after = knownRef.current.get(state.fen)
      if (!before || !after) return state
      return remarkFor(state, {
        before: before.score,
        after: after.score,
        depth: Math.min(before.depth, after.depth),
        ...(before.bestUci ? { bestUci: before.bestUci } : {})
      })
    },
    [remarkFor]
  )

  // ---------------------------------------------------------------- the engine's answers

  useEffect(() => {
    const offAnalysis = window.api.onChessAnalysis((raw: unknown) => {
      const update = readEngineUpdate(raw)
      if (!update) return
      const current = gameRef.current
      const waiting = current?.thinking
      // Not what this screen is waiting for. Nothing is relabelled and nothing is shown under another position.
      if (!current || !waiting || update.requestId !== waiting.requestId || update.fen !== waiting.fen) return

      if (!update.complete) {
        setLive({ fen: update.fen, score: update.score, depth: update.depth, bound: update.bound })
        return
      }
      setLive(null)
      // A settled score, for later. A bound is a limit rather than a verdict, so it is not recorded as one.
      if (update.score.kind !== 'none' && update.bound === null && update.depth !== null) {
        knownRef.current.set(update.fen, {
          score: update.score,
          depth: update.depth,
          ...(update.bestmove ? { bestUci: update.bestmove } : {})
        })
      }

      if (waiting.purpose === 'hint') {
        const shown = revealHint(current, { requestId: update.requestId, fen: update.fen, bestmove: update.bestmove }, monotonic())
        apply(shown.state)
        if (!shown.ok) onNotify(shown.problem, 'error')
        return
      }

      const judged = judgeHuman(current)
      const step = engineAnswered(judged, update, { now: monotonic(), roll: Math.random() })
      if (!step.ok) {
        attemptRef.current += 1
        apply(engineFailed(step.state, step.problem))
        onNotify(step.problem, 'error')
        return
      }
      const next = step.move ? remarkFor(step.state) : step.state
      apply(next)
      save(next)
    })

    const offFailed = window.api.onChessAnalysisFailed((failure: { id: string; fen: string; message: string }) => {
      const current = gameRef.current
      if (!current?.thinking || current.thinking.requestId !== failure.id) return
      attemptRef.current += 1
      setLive(null)
      apply(engineFailed(current, failure.message || 'The engine stopped.'))
      onNotify(failure.message || 'The engine stopped while it was thinking.', 'error')
    })

    return () => {
      offAnalysis()
      offFailed()
    }
  }, [apply, judgeHuman, onNotify, remarkFor, save])

  // ---------------------------------------------------------------- the engine's turn

  useEffect(() => {
    if (!game || game.finish || !canPlay(status)) return
    if (!engineTurn(game)) return
    const key = `${game.moves.length}:${attemptRef.current}`
    if (askRef.current === key) return
    if (triesRef.current.ply !== game.moves.length) triesRef.current = { ply: game.moves.length, count: 0 }
    if (triesRef.current.count >= MAX_TRIES) return
    const request = engineTurnRequest(game, `arena-${game.startedAt}-${game.moves.length}-${attemptRef.current}`, monotonic())
    if (!request) return
    askRef.current = key
    triesRef.current.count += 1
    const asked = engineAsked(game, request, monotonic())
    apply(asked)
    void window.api.chessAnalyse(request).catch((err: unknown) => {
      attemptRef.current += 1
      const why = plainly(err)
      apply(engineFailed(gameRef.current ?? asked, why))
      onNotify(why, 'error')
    })
  }, [game, status, apply, onNotify])

  // ---------------------------------------------------------------- the clock on screen

  useEffect(() => {
    if (!game || game.finish || game.clock.paused) return undefined
    const id = window.setInterval(() => {
      const now = monotonic()
      setClockNow(now)
      const current = gameRef.current
      if (!current || current.finish) return
      const ticked = tick(current, now)
      // Only when something really changed: the clock on screen is redrawn from the stamp, not from this.
      if (ticked !== current) {
        apply(ticked)
        if (ticked.finish) save(ticked)
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [game, apply, save])

  /*
   * Leaving the screen stops our own search, and only ours.
   *
   * By id, never `stopAnalysis()` with nothing: that stops whatever is running, which may be a search some other
   * part of Orbis is waiting on.
   */
  useEffect(
    () => () => {
      const waiting = gameRef.current?.thinking
      if (waiting) void window.api.chessStopAnalysis(waiting.requestId).catch(() => undefined)
    },
    []
  )

  // ---------------------------------------------------------------- starting and finishing

  const setup = useMemo<ArenaSetup>(
    () => ({
      side,
      // A named opponent from the list wins over the older five-level setting, which is what `arena.ts` expects:
      // it turns whichever was given into one level, so there is one path through the game either way.
      ...(opponentId ? { opponent: opponentId } : {}),
      difficulty: level,
      control: timeControlById(controlId) ?? STANDARD_SETUP.control,
      assistance: help,
      commentary: style,
      startFen: STANDARD_SETUP.startFen
    }),
    [side, opponentId, level, controlId, help, style]
  )

  const problems = useMemo(() => setupProblems(setup), [setup])

  const begin = useCallback(
    (which: ArenaSetup) => {
      const trouble = setupProblems(which)
      if (trouble.length) {
        onNotify(trouble[0].reason, 'error')
        return
      }
      askRef.current = ''
      attemptRef.current = 0
      triesRef.current = { ply: -1, count: 0 }
      knownRef.current = new Map()
      savedRef.current = ''
      saveProblemRef.current = false
      lastRemarkRef.current = null
      setLive(null)
      setConfirmResign(false)
      setPremoveHeld(null)
      setViewPly(null)
      setBarOn(true)
      const fresh = startArena(which, { now: monotonic(), roll: Math.random() })
      setOrientation(fresh.human)
      apply(fresh)
    },
    [apply, onNotify]
  )

  const finishNow = useCallback(
    (next: ArenaState, said?: string) => {
      apply(next)
      if (said) onNotify(said)
      if (next.finish) save(next)
    },
    [apply, onNotify, save]
  )

  // ---------------------------------------------------------------- what the person does

  const onBoardMove = useCallback(
    (move: ChessMove) => {
      const current = gameRef.current
      if (!current) return
      const step = playMove(
        current,
        { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) },
        'you',
        monotonic()
      )
      if (!step.ok) {
        onNotify(step.problem, 'error')
        return
      }
      /*
       * A hint that was still being worked out is stopped.
       *
       * The engine runs one search at a time, so a hint nobody is waiting for any more would make the engine's
       * own move wait behind it. The answer is dropped either way -- the session cleared what it was waiting for
       * -- but the engine should not spend a second on it.
       */
      if (current.thinking?.purpose === 'hint') {
        void window.api.chessStopAnalysis(current.thinking.requestId).catch(() => undefined)
      }
      const next = step.move ? remarkFor(step.state) : step.state
      apply(next)
      save(next)
    },
    [apply, onNotify, remarkFor, save]
  )

  const askHint = useCallback(() => {
    const current = gameRef.current
    if (!current) return
    const request = hintRequest(current, `arena-hint-${Date.now()}-${current.moves.length}`)
    if (!request) {
      onNotify(
        current.setup.assistance === 'none'
          ? 'This game was set up with no help, so there are no hints in it.'
          : 'A hint is only given on your own turn, and not while the engine is thinking.'
      )
      return
    }
    apply(hintAsked(current, request, monotonic()))
    void window.api.chessAnalyse(request).catch((err: unknown) => {
      const why = plainly(err)
      apply(engineFailed(gameRef.current ?? current, why))
      onNotify(why, 'error')
    })
  }, [apply, onNotify])

  const doResign = useCallback(() => {
    const current = gameRef.current
    if (!current) return
    const step = resign(current, 'you', monotonic())
    setConfirmResign(false)
    if (!step.ok) {
      onNotify(step.problem)
      return
    }
    finishNow(step.state, 'You resigned.')
  }, [finishNow, onNotify])

  /**
   * Offering a draw.
   *
   * The offer is recorded first, which is what makes it an offer. The engine then answers from the only evidence
   * there is -- the rules, and its own settled search of this position when one exists. With nothing to go on it
   * declines and says so, rather than deciding by a coin toss dressed up as judgement.
   */
  const doOfferDraw = useCallback(() => {
    const current = gameRef.current
    if (!current) return
    const offered = offerDraw(current, 'you', monotonic())
    if (!offered.ok) {
      onNotify(offered.problem)
      return
    }
    apply(offered.state)
    const known = knownRef.current.get(offered.state.fen)
    const verdict = engineShouldAcceptDraw(offered.state, known ? { score: known.score, depth: known.depth } : undefined)
    if (verdict.accept) {
      const agreed = acceptDraw(offered.state, 'engine', monotonic())
      if (agreed.ok) finishNow(agreed.state, `The engine accepted the draw: ${verdict.because}.`)
      return
    }
    const declined = declineDraw(offered.state, 'engine')
    if (declined.ok) {
      apply(declined.state)
      onNotify(`The engine declined the draw — ${verdict.because}.`)
    }
  }, [apply, finishNow, onNotify])

  const answerTheirOffer = useCallback(
    (accept: boolean) => {
      const current = gameRef.current
      if (!current) return
      const step = accept ? acceptDraw(current, 'you', monotonic()) : declineDraw(current, 'you')
      if (!step.ok) {
        onNotify(step.problem)
        return
      }
      if (accept) finishNow(step.state, 'Draw agreed.')
      else apply(step.state)
    },
    [apply, finishNow, onNotify]
  )

  const retryEngine = useCallback(() => {
    const current = gameRef.current
    if (!current) return
    attemptRef.current += 1
    askRef.current = ''
    // Asked for by the person, so the automatic cap starts again.
    triesRef.current = { ply: current.moves.length, count: 0 }
    apply({ ...current, problem: null })
  }, [apply])

  // ---------------------------------------------------------------- what Orbis itself may do here

  /**
   * Starting a game on Orbis's own say-so.
   *
   * The same handler the two start buttons call, with the pickers set first when an opponent, a colour or a clock
   * was named -- so what is on screen and what is being played are the same thing, which they would not be if this
   * built a setup of its own and started it. The setup is checked before anything is shown, so a position that
   * cannot be played from is refused with the reason rather than half-starting.
   */
  const startForOrbis = useCallback(
    (chosen: { opponent?: Difficulty; colour?: ArenaSetup['side']; clock?: string }): { opponent: string; colour: string; clock: string } => {
      const next: ArenaSetup = {
        ...setup,
        ...(chosen.colour === undefined ? {} : { side: chosen.colour }),
        ...(chosen.opponent === undefined ? {} : { difficulty: chosen.opponent }),
        ...(chosen.clock === undefined ? {} : { control: timeControlById(chosen.clock) ?? setup.control })
      }
      const trouble = setupProblems(next)
      if (trouble.length) throw new Error(trouble[0].reason)
      if (chosen.colour !== undefined) setSide(chosen.colour)
      if (chosen.opponent !== undefined) setLevel(chosen.opponent)
      if (chosen.clock !== undefined) setControlId(next.control.id)
      begin(next)
      return { opponent: difficulty(next.difficulty).name, colour: next.side, clock: next.control.label }
    },
    [setup, begin]
  )

  useSurface(
    playSurface({
      // The screen's own live game rather than the render's copy of it, so what Orbis reads back after starting a
      // game, resigning or pausing is the game as it now is.
      game: () => gameRef.current,
      setup: () => setup,
      setColour: setSide,
      setOpponent: setLevel,
      setClock: setControlId,
      setHelp,
      setCommentary: setStyle,
      orientation: () => orientation,
      setOrientation,
      start: startForOrbis,
      whyNoEngine: () =>
        canPlay(status)
          ? null
          : status
            ? status.detail || `The engine is ${status.state}.`
            : 'The chess engine has not been set up on this computer yet, so there is no opponent.',
      pause: (wanted) => {
        const current = gameRef.current
        if (!current) return
        apply(wanted ? pause(current, monotonic()) : resume(current, monotonic()))
      },
      resign: doResign,
      offerDraw: doOfferDraw,
      hint: askHint,
      changeSetup: () => apply(null)
    })
  )

  // ---------------------------------------------------------------- the sounds, the premove, looking back

  /*
   * The sound for the move just played, whoever played it.
   *
   * Done here rather than in the two places a move is made, because there are three ways the position changes --
   * your move, the engine's move, a premove falling due -- and a sound in each of them is three chances for one of
   * them to be silent. What is played is read from the notation the rules wrote, so it says what really happened.
   */
  const soundedRef = useRef(-1)
  useEffect(() => {
    if (!game) {
      soundedRef.current = -1
      return
    }
    const count = game.moves.length
    if (count === soundedRef.current) return
    const grew = count > soundedRef.current
    soundedRef.current = count
    if (!grew || count === 0) return
    playChessSound(soundFor(game.moves[count - 1].san), prefs)
  }, [game, prefs])

  const endedRef = useRef(false)
  useEffect(() => {
    if (!game?.finish) {
      endedRef.current = false
      return
    }
    if (endedRef.current) return
    endedRef.current = true
    playChessSound('end', prefs)
  }, [game, prefs])

  /*
   * A premove falling due.
   *
   * The board never plays one: it only holds it. When the engine has moved and it is your turn again, the rules
   * are asked about the move for the first time, in the position that now exists. If they refuse it, it is
   * dropped and said out loud -- never nudged into a nearby legal move, which would be a move you did not make.
   */
  useEffect(() => {
    if (!game || game.finish) return
    const held = premoveHeld
    if (!held) return
    if (premoveStatus(held, sideToMove(game.fen), game.human) !== 'due') return
    const step = playMove(
      game,
      { from: held.from, to: held.to, ...(held.promotion ? { promotion: held.promotion as PieceLetter } : {}) },
      'you',
      monotonic()
    )
    setPremoveHeld(null)
    if (!step.ok) {
      onNotify(premoveWords(held, 'dropped'))
      return
    }
    const next = step.move ? remarkFor(step.state) : step.state
    apply(next)
    save(next)
  }, [game, premoveHeld, apply, onNotify, remarkFor, save])

  /** Taking your last move back, and the engine's reply with it. The clock is not put back, and it says so. */
  const doTakeBack = useCallback(() => {
    const current = gameRef.current
    if (!current) return
    const step = takeBack(current, monotonic())
    if (!step.ok) {
      onNotify(step.problem)
      return
    }
    if (step.stopSearch) void window.api.chessStopAnalysis(step.stopSearch).catch(() => undefined)
    // The engine must be askable again about a position it has already been asked about once.
    askRef.current = ''
    attemptRef.current += 1
    setPremoveHeld(null)
    setViewPly(null)
    apply(step.state)
    save(step.state)
    onNotify(step.says)
  }, [apply, onNotify, save])

  // ---------------------------------------------------------------- drawing it

  if (!game) {
    return (
      <ArenaSetupPanel
        status={status}
        installing={installing}
        progress={progress}
        side={side}
        setSide={setSide}
        opponentId={opponentId}
        setOpponentId={setOpponentId}
        controlId={controlId}
        setControlId={setControlId}
        help={help}
        setHelp={setHelp}
        style={style}
        setStyle={setStyle}
        problems={problems.map((one) => one.reason)}
        onInstall={() => void install()}
        onStart={() => begin(setup)}
        onStandard={() => begin(STANDARD_SETUP)}
      />
    )
  }

  const now = monotonic()
  const left = remainingAt(game.clock, now)
  const used = spentAt(game.clock, now)
  const summary = summaryOf(game, { now, ...(engineName ? { engineName } : {}) })
  const turn = sideToMove(game.fen)
  const thinking = thinkingLine(game, now)
  const offer = game.drawOffer
  const theirOffer = offer && offer.by === 'engine' ? offer : null
  const yourOffer = offer && offer.by === 'you' ? offer : null
  const hintSquares = game.hint?.uci ? [game.hint.uci.slice(0, 2), game.hint.uci.slice(2, 4)] : []

  const total = game.moves.length
  const ply = viewPly === null ? total : clampPly(viewPly, total)
  const looking = browsing(ply, total)
  const shownFen = looking ? fenAt({ startFen: game.startFen, moves: game.moves }, ply) : game.fen
  const shownLast = ply > 0 ? game.moves[ply - 1] : null
  const san = game.moves.map((one) => one.san)

  // What the engine really said about the position on screen: the search running now, or a settled one from before.
  const running = live && live.fen === shownFen ? { score: live.score, fen: live.fen } : null
  const settled = knownRef.current.get(shownFen)
  const reading = running ?? (settled ? { score: settled.score, fen: shownFen } : null)
  const bar = barFor({
    wanted: prefs.analysis.evalBar && barOn,
    fen: shownFen,
    score: reading ? { ...reading, text: formatForSettings(reading.score, prefs, sideToMove(shownFen)) } : null
  })

  const playable = !looking && yourTurn(game)
  const jump = (next: number): void => setViewPly(next >= total ? null : clampPly(next, total))

  const strip = (which: 'w' | 'b'): React.JSX.Element => (
    <PlayerStrip
      name={which === game.human ? 'You' : (game.opponent ? game.opponent.name : difficulty(game.setup.difficulty).name)}
      side={which}
      you={which === game.human}
      time={left ? formatClock(left[which]) : null}
      spent={formatClock(used[which])}
      turn={turn === which && !game.finish}
      low={Boolean(left) && lowTimeAt(game.clock, which, now)}
      flagged={game.clock.flagged === which}
      points={pointsFor(shownFen, which)}
    />
  )

  return (
    <div className="cw-pl-root">
      <ChessStage
        className="cw-pl-stage"
        label="Your game against the engine"
        board={{
          fen: shownFen,
          orientation,
          interactive: playable,
          lastMove: shownLast ? { from: shownLast.uci.slice(0, 2), to: shownLast.uci.slice(2, 4) } : null,
          onMove: onBoardMove,
          highlight: hintSquares,
          you: game.human,
          premove: premoveHeld,
          onPremove: setPremoveHeld,
          evalBar: bar,
          label: 'Your game against the engine'
        }}
        above={strip(orientation === 'w' ? 'b' : 'w')}
        below={
          <>
            {strip(orientation)}
            <div className="cw-pl-under">
              <MoveNav ply={ply} total={total} onJump={jump} onFlip={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}>
                {!game.finish && (
                  <button
                    type="button"
                    className="cw-nav-btn"
                    title={game.clock.paused ? 'Carry on' : 'Pause the clock'}
                    aria-label={game.clock.paused ? 'Carry on' : 'Pause the clock'}
                    onClick={() => apply(game.clock.paused ? resume(game, monotonic()) : pause(game, monotonic()))}
                  >
                    {game.clock.paused ? 'Play' : 'Pause'}
                  </button>
                )}
              </MoveNav>
              <span className="cw-pl-state" role="status">
                {game.finish
                  ? (summary?.headline ?? 'The game is over.')
                  : (browsingWords(ply, total) ??
                    (game.clock.paused
                      ? 'Paused. The clock is charged to nobody.'
                      : premoveHeld
                        ? `${premoveHeld.from} to ${premoveHeld.to} is held, and will be played when it is your turn if the rules allow it.`
                        : yourTurn(game)
                          ? 'Your move.'
                          : (thinking ?? 'The engine is moving.')))}
              </span>
            </div>
          </>
        }
        right={
          <div className="cw-pl-side">
            {game.finish && summary ? (
              <div className="cw-pl-over" role="status">
                <h4 className="cw-pl-overhead">{summary.headline}</h4>
                <p className="cw-pl-overdetail">{summary.detail}</p>
                <dl className="cw-pl-facts">
                  <div><dt>Result</dt><dd>{summary.result}</dd></div>
                  <div><dt>Moves</dt><dd>{summary.moves}</dd></div>
                  <div><dt>Opponent</dt><dd>{game.opponent ? game.opponent.name : summary.level.name}</dd></div>
                  <div><dt>Clock</dt><dd>{summary.timeControl}</dd></div>
                  <div><dt>Your time</dt><dd>{formatClock(summary.spent[game.human])}</dd></div>
                  <div><dt>Its time</dt><dd>{formatClock(summary.spent[game.engine])}</dd></div>
                  {game.takenBack > 0 && (
                    <div><dt>Taken back</dt><dd>{game.takenBack === 1 ? 'One move' : `${game.takenBack} moves`}</dd></div>
                  )}
                  {summary.assisted && (
                    <div><dt>Hints</dt><dd>{summary.hintsTaken === 1 ? 'One' : summary.hintsTaken}</dd></div>
                  )}
                </dl>
                <div className="cw-pl-row">
                  <Button size="small" kind="primary" onClick={() => begin(game.setup)}>Play again</Button>
                  {game.gameId && onStudy && (
                    /*
                     * Straight into the report on the game just played. The Study screen is where the report lives
                     * -- it draws the classified moves, the accuracy and the graph -- so this opens that game there
                     * rather than sending somebody off to find it in the Library.
                     */
                    <Button size="small" onClick={() => onStudy(game.gameId)}>Open the game report</Button>
                  )}
                  <Button size="small" kind="quiet" onClick={() => apply(null)}>Change the setup</Button>
                </div>
                {!game.gameId && (
                  <p className="cw-pl-note">
                    {game.moves.length === 0
                      ? 'No moves were played, so there is no game to keep and no report to open.'
                      : 'This game could not be saved, so there is no report to open. The reason was said when it happened.'}
                  </p>
                )}
                <p className="cw-pl-note">{STRENGTH_NOTE}</p>
              </div>
            ) : (
              <div className="cw-pl-controls">
                <div className="cw-pl-row">
                  {confirmResign ? (
                    <>
                      <Button size="small" kind="danger" onClick={doResign}>Yes, resign</Button>
                      <Button size="small" kind="quiet" onClick={() => setConfirmResign(false)}>Keep playing</Button>
                    </>
                  ) : (
                    <Button size="small" kind="danger" onClick={() => setConfirmResign(true)}>Resign</Button>
                  )}
                  {yourOffer ? (
                    <Button
                      size="small"
                      onClick={() => {
                        const step = withdrawDraw(game, 'you')
                        if (step.ok) apply(step.state)
                        else onNotify(step.problem)
                      }}
                    >
                      Take the offer back
                    </Button>
                  ) : (
                    <Button size="small" onClick={doOfferDraw} disabled={Boolean(theirOffer)}>Offer a draw</Button>
                  )}
                  <Button size="small" onClick={doTakeBack} disabled={total === 0}>Take a move back</Button>
                  {game.setup.assistance !== 'none' && (
                    <Button size="small" onClick={askHint} disabled={!yourTurn(game) || game.thinking !== null}>
                      {game.thinking?.purpose === 'hint' ? 'Asking' : 'Hint'}
                    </Button>
                  )}
                  {prefs.analysis.evalBar && (
                    <Button size="small" kind="quiet" onClick={() => setBarOn((on) => !on)}>
                      {barOn ? 'Hide the bar' : 'Show the bar'}
                    </Button>
                  )}
                </div>

                <div className="cw-pl-chips">
                  {setupChips({
                    opponent: game.opponent ? game.opponent.name : difficulty(game.setup.difficulty).name,
                    ...(game.opponent ? { opponentAbout: describeOpponent(game.opponent) } : {}),
                    colour: game.setup.side,
                    clock: game.setup.control,
                    clockAbout: describeTimeControl(game.setup.control),
                    help: assistance(game.setup.assistance).name,
                    helpAbout: assistance(game.setup.assistance).about
                  }).map((chip) => (
                    <span key={chip.label} className="cw-pl-chip" {...(chip.title ? { title: chip.title } : {})}>
                      <b>{chip.label}</b>
                      {chip.value}
                    </span>
                  ))}
                </div>
                {/* Which colour you really got, which is the one thing the "Either" choice never used to say. */}
                <p className="cw-pl-note">{colourWords(game.setup.side, game.human)}</p>

                {theirOffer && (
                  <div className="cw-pl-offer" role="status">
                    <p>The engine has offered a draw. Nothing happens until you answer.</p>
                    <div className="cw-pl-row">
                      <Button size="tiny" onClick={() => answerTheirOffer(true)}>Accept</Button>
                      <Button size="tiny" kind="quiet" onClick={() => answerTheirOffer(false)}>Decline</Button>
                    </div>
                  </div>
                )}
                {yourOffer && <p className="cw-pl-note">Your draw offer is waiting. Playing on takes it back.</p>}

                {game.hint && (
                  <div className="cw-pl-hint" role="status">
                    <p>{game.hint.text}</p>
                    <Button size="tiny" kind="quiet" onClick={() => apply(clearHint(game))}>Put it away</Button>
                  </div>
                )}

                {game.problem && (
                  <div className="cw-pl-problem" role="alert">
                    <p>{game.problem}</p>
                    {engineTurn(game) && !game.thinking && (
                      <Button size="tiny" onClick={retryEngine}>Ask the engine again</Button>
                    )}
                  </div>
                )}
              </div>
            )}

            <MoveList
              className="cw-pl-moves"
              moves={san}
              ply={ply}
              onJump={jump}
              firstSide={sideToMove(game.startFen)}
              firstNumber={moveNumber(game.startFen)}
              empty="No moves yet."
            />

            {game.setup.commentary !== 'silent' && game.remarks.length > 0 && (
              <ul className="cw-pl-remarks" aria-label="Commentary" aria-live="polite">
                {game.remarks
                  .slice()
                  .reverse()
                  .map((remark, index) => (
                    <li key={`${remark.ply}-${remark.id}-${index}`} className={remark.from === 'engine' ? 'is-engine' : ''}>
                      {remark.text}
                      {remark.from === 'engine' && <small> from the engine own numbers</small>}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        }
      />
    </div>
  )
}

/**
 * Which of the generated sounds a move gets, read from the notation the rules wrote.
 *
 * Castling is a move sound with its own voice; it shares the move switch, so somebody who turns move sounds off
 * does not suddenly hear castling.
 */
function soundFor(san: string): 'move' | 'capture' | 'castle' | 'check' {
  if (san.startsWith('O-O')) return 'castle'
  if (san.includes('+') || san.includes('#')) return 'check'
  if (san.includes('x')) return 'capture'
  return 'move'
}

// ---------------------------------------------------------------- one player's line above or below the board

interface PlayerStripProps {
  name: string
  side: 'w' | 'b'
  you: boolean
  /** The clock, or null in an untimed game -- in which case what was spent is shown instead. */
  time: string | null
  spent: string
  turn: boolean
  low: boolean
  flagged: boolean
  /** What this side's pieces are worth in the position on screen, counted by the rules. */
  points: number
}

/**
 * Who is playing, which colour, and their clock.
 *
 * Whose turn it is is said three ways -- a disc, a ring and the words in the name -- because state is never colour
 * alone. The number beside the name is the material count from `pointsFor`, which counts the pieces really on the
 * board; it is not a rating, and there is nothing on this screen pretending to be one.
 */
function PlayerStrip(p: PlayerStripProps): React.JSX.Element {
  const classes = [
    'cw-pl-player',
    p.turn ? 'is-turn' : '',
    p.low ? 'is-low' : '',
    p.flagged ? 'is-flagged' : '',
    p.you ? 'is-you' : ''
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes}>
      <span className={`cw-pl-disc is-${p.side}`} aria-hidden="true" />
      <span className="cw-pl-name">
        {p.name}
        <small>
          {p.side === 'w' ? 'White' : 'Black'}
          {p.turn ? ' - to move' : ''}
        </small>
      </span>
      <span className="cw-pl-points" title="What this side's pieces are worth in the position on screen">
        {p.points}
      </span>
      <span className="cw-pl-time" aria-label={`${p.you ? 'Your' : 'The engine'} clock`}>
        {p.time ?? p.spent}
        {p.time === null && <small>used</small>}
      </span>
      {p.flagged && <span className="cw-pl-flag">Flag fell</span>}
    </div>
  )
}

// ---------------------------------------------------------------- setting a game up

interface SetupPanelProps {
  status: EngineStatus | null
  installing: boolean
  progress: string | null
  side: ArenaSetup['side']
  setSide: (value: ArenaSetup['side']) => void
  opponentId: OpponentId | null
  setOpponentId: (value: OpponentId) => void
  controlId: string
  setControlId: (value: string) => void
  help: Assistance
  setHelp: (value: Assistance) => void
  style: CommentaryStyle
  setStyle: (value: CommentaryStyle) => void
  problems: string[]
  onInstall: () => void
  onStart: () => void
  onStandard: () => void
}

/**
 * Choosing an opponent, a colour and a clock, with the board already on screen.
 *
 * The board is here because this is the chess screen, and the position you are about to play from is the thing
 * worth looking at. It is the same shared layout the game itself uses, so the board is the same size before and
 * after the game starts rather than appearing from nowhere.
 *
 * What used to be four labelled drop-downs with a paragraph of explanation under each is now: a list of opponents
 * whose cards are built by `opponents.ts` out of the settings that will really be sent, a grid of clocks grouped
 * into bullet, blitz, rapid and classical, and two rows of pills. Nothing honest was dropped -- the long wording is
 * on the control it is about, as its tooltip, instead of being four paragraphs above the board.
 */
function ArenaSetupPanel(p: SetupPanelProps): React.JSX.Element {
  const ready = canPlay(p.status)
  const families = useMemo(() => clockFamilies(), [])
  const control = timeControlById(p.controlId) ?? STANDARD_SETUP.control
  const engineLine = p.status
    ? p.status.state === 'ready'
      ? `${p.status.name ?? 'The engine'} is ready.`
      : p.status.detail || p.status.state
    : 'The chess engine has not been set up on this computer yet.'
  const engineOptions = (p.status?.options ?? []) as readonly AdvertisedOption[]
  const chosen = p.opponentId ? opponent(p.opponentId) : null

  return (
    <div className="cw-pl-root">
      <ChessStage
        className="cw-pl-setup"
        label="The position a new game starts from"
        board={{
          fen: START_FEN,
          orientation: p.side === 'b' ? 'b' : 'w',
          interactive: false,
          label: 'The position a new game starts from'
        }}
        above={
          <div className="cw-pl-setuptop">
            <h3 className="cw-pl-heading">Play the engine</h3>
            <span className={`cw-pl-engine${ready ? '' : ' is-missing'}`} role="status">
              <span className={`cw-pl-dot${ready ? ' is-on' : ''}`} aria-hidden="true" />
              {engineLine}
            </span>
          </div>
        }
        below={
          <div className="cw-pl-setupbottom">
            <Button size="small" kind="primary" disabled={!ready || p.problems.length > 0} onClick={p.onStart}>
              {chosen ? `Play ${chosen.name}` : 'Start the game'}
            </Button>
            <Button
              size="small"
              disabled={!ready}
              onClick={p.onStandard}
              title="White, club strength, ten minutes each, no help, a friendly coach"
            >
              The standard game
            </Button>
            {p.problems.length > 0 && (
              <span className="cw-pl-problem" role="alert">
                {p.problems[0]}
              </span>
            )}
            {!ready && <span className="cw-pl-note">There is no opponent until the engine is on this computer.</span>}
          </div>
        }
        left={
          <div className="cw-pl-opponents">
            <h4 className="cw-pl-title">Who you play</h4>
            {/* The cards, the place in the list and the caveat about what the engine really applies are all its own. */}
            <OpponentPicker chosen={p.opponentId} onChoose={p.setOpponentId} engineOptions={engineOptions} />
          </div>
        }
        right={
          <div className="cw-pl-choices">
            {!ready && (
              <div className="cw-pl-install">
                <p className="cw-pl-note">
                  Orbis plays through Stockfish, a separate free program under its own licence, so it is not part of
                  the Orbis download. It is fetched once, onto this computer, when you ask for it.
                </p>
                <Button size="small" kind="primary" busy={p.installing} busyLabel="Setting up" onClick={p.onInstall}>
                  Set up the chess engine
                </Button>
                {p.progress && <p className="cw-pl-note">{p.progress}</p>}
              </div>
            )}

            <h4 className="cw-pl-title">Your colour</h4>
            <Segmented
              label="Your colour"
              value={p.side}
              onChange={p.setSide}
              className="cw-pl-seg"
              optionClass="cw-pl-segbtn"
              options={[
                { value: 'w', label: 'White', name: 'Play White' },
                { value: 'b', label: 'Black', name: 'Play Black' },
                { value: 'random', label: 'Either', name: 'Let Orbis choose' }
              ]}
            />
            {/* "Either" is a real choice, so it says what it will do rather than looking like a button that did nothing. */}
            <p className="cw-pl-note">
              {p.side === 'random'
                ? 'Orbis picks a colour when the game starts, and the game says which one you were given.'
                : `You will play ${p.side === 'w' ? 'White' : 'Black'}, and the board starts that way up.`}
            </p>

            <h4 className="cw-pl-title">The clock</h4>
            <div className="cw-pl-clocks">
              {families.map((family) => (
                <div key={family.kind} className="cw-pl-family">
                  <span className="cw-pl-familyname">{family.name}</span>
                  <div className="cw-pl-times">
                    {family.controls.map((one) => (
                      <button
                        key={one.id}
                        type="button"
                        className="cw-pl-time-btn"
                        aria-pressed={p.controlId === one.id}
                        title={describeTimeControl(one)}
                        onClick={() => p.setControlId(one.id)}
                      >
                        {one.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="cw-pl-note">{describeTimeControl(control)}</p>

            <h4 className="cw-pl-title">How much help</h4>
            <div className="cw-pl-pills" role="group" aria-label="How much help">
              {ASSISTANCE_LEVELS.map((one) => (
                <button
                  key={one.id}
                  type="button"
                  className="cw-pl-pill"
                  aria-pressed={p.help === one.id}
                  title={`${one.about} What it reveals: ${one.reveals}`}
                  onClick={() => p.setHelp(one.id)}
                >
                  {one.name}
                </button>
              ))}
            </div>

            <h4 className="cw-pl-title">What it says as you play</h4>
            <div className="cw-pl-pills" role="group" aria-label="What it says as you play">
              {COMMENTARY_STYLES.map((one) => (
                <button
                  key={one.id}
                  type="button"
                  className="cw-pl-pill"
                  aria-pressed={p.style === one.id}
                  title={one.about}
                  onClick={() => p.setStyle(one.id)}
                >
                  {one.name}
                </button>
              ))}
            </div>
          </div>
        }
      />
    </div>
  )
}

export default ArenaGame
