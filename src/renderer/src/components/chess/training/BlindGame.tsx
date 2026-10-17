import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Segmented } from '../../../ui'
import { TrainStage } from './TrainStage'
import { Mic } from './Mic'
import {
  DIFFICULTIES, difficulty, engineAnswered, engineAsked, engineFailed, engineTurn, engineTurnRequest, playMove,
  readEngineUpdate, resign, setupProblems, startArena, yourTurn,
  type ArenaSetup, type ArenaState, type Difficulty, type SideChoice
} from '../../../../../shared/chess/arena'
import { UNTIMED } from '../../../../../shared/chess/clock'
import { START_FEN } from '../../../../../shared/chess/rules'
import {
  GAME_MODES, NO_LOOKS, announce, enterGameMove, gameMode, gameView, looksSay, noteLook, sayGamePosition,
  type BlindGameMode, type GamePhase, type Looks
} from '../../../../../shared/chess/blindGame'
import { attemptId, type TrainingAttempt } from '../../../../../shared/chess/trainingView'
import { hearMove } from '../../../../../shared/chess/spoken'
import type { NoticeKind } from '../../../lib/notices'

/**
 * A whole game against the engine with the board hidden (Section 225).
 *
 * The game is `arena.ts` -- the same session, the same engine, the same legal-move checking as a normal game. This
 * screen does not play chess and does not decide what is legal; it hides the board, announces the moves and counts
 * what was given away.
 *
 * ## Four things it refuses to do
 *
 * **It does not draw the board.** `gameView` is asked on every render and a board appears only when it hands back a
 * position -- while a look is being held, in the mode that allows looks, or when the game is over. There is no
 * other route from a position to the markup.
 *
 * **It does not guess at a move.** `enterGameMove` asks `readMove`, which asks the rules. A move that could be two
 * different legal moves comes back as a question with the ways of writing it, and nothing is played until one is
 * picked. With no board in front of somebody, "Nd2" with two knights able to reach it is an easy thing to write.
 *
 * **It does not hide the help it gave.** Every look is counted before the board is shown, and the count is on
 * screen and in the record. `unassisted` is false for the whole game the moment one is taken, and it is false in
 * the modes that list the moves even with no looks at all.
 *
 * **It does not run a clock.** A blindfold game is untimed, because a clock running while somebody holds a position
 * in their head measures their typing.
 */

const SIDE_OPTIONS: readonly { value: SideChoice; label: string }[] = [
  { value: 'w', label: 'White' },
  { value: 'b', label: 'Black' },
  { value: 'random', label: 'Either' }
]

/**
 * The strength settings, read off the arena's own list rather than written out here.
 *
 * `DifficultyLevel.id` is `Difficulty | OpponentId`, because the arena reuses that shape for its named opponents
 * as well as for its five settings. `DIFFICULTIES` holds only the five, and `difficulty()` is what proves it: it
 * answers with the level belonging to a `Difficulty` id, so an entry that comes back as itself is one of the five
 * and an entry that does not is something else. Reading them off the list means a sixth setting turns up here
 * without anybody having to remember to add it.
 */
const LEVEL_OPTIONS: readonly { value: Difficulty; label: string }[] = DIFFICULTIES.flatMap((one) => {
  const id = one.id as Difficulty
  return difficulty(id) === one ? [{ value: id, label: one.name }] : []
})

/** Milliseconds, from a clock that only goes forwards, for the engine's own think time. */
const monotonic = (): number => (typeof performance !== 'undefined' ? Math.round(performance.timeOrigin + performance.now()) : Date.now())

/** How many times one position may be asked about before the screen stops asking. The arena's own guard, repeated. */
const MOST_TRIES = 3

export interface BlindGameProps {
  onNotify?: (text: string, kind?: NoticeKind) => void
  /** Given the record when a game finishes, so the screen that keeps things can keep it. */
  onFinished?: (attempt: TrainingAttempt) => void
}

export function BlindGame({ onNotify, onFinished }: BlindGameProps = {}): React.JSX.Element {
  const [side, setSide] = useState<SideChoice>('w')
  const [level, setLevel] = useState<Difficulty>('gentle')
  const [mode, setMode] = useState<BlindGameMode>('with-list')
  const [game, setGame] = useState<ArenaState | null>(null)
  const [looks, setLooks] = useState<Looks>(NO_LOOKS)
  const [looking, setLooking] = useState(false)
  const [said, setSaid] = useState<string[]>([])
  const [typed, setTyped] = useState('')
  const [problem, setProblem] = useState<{ says: string; suggest: readonly string[]; asking: boolean } | null>(null)
  const [writtenOut, setWrittenOut] = useState<string | null>(null)

  const gameRef = useRef<ArenaState | null>(null)
  const askedRef = useRef('')
  const triesRef = useRef({ ply: -1, count: 0 })
  const attemptRef = useRef(0)
  const recordedRef = useRef(false)

  const apply = useCallback((next: ArenaState): void => {
    gameRef.current = next
    setGame(next)
  }, [])

  const phase: GamePhase = game === null ? 'setup' : game.finish !== null ? 'over' : 'playing'
  const rules = gameMode(mode)

  /** Whether the board may be on screen, asked afresh on every render. */
  const view = useMemo(
    () => gameView({ mode, phase, looking, fen: game?.fen ?? START_FEN, looks }),
    [mode, phase, looking, game?.fen, looks]
  )

  const setup = useMemo<ArenaSetup>(() => ({
    side,
    difficulty: level,
    // Untimed on purpose. A clock running while somebody holds the position in their head measures their typing.
    control: UNTIMED,
    // No hints: a hint in a blindfold game is the engine's move, which is the game.
    assistance: 'none',
    commentary: 'silent',
    startFen: START_FEN
  }), [side, level])

  const begin = useCallback((): void => {
    const trouble = setupProblems(setup)
    if (trouble.length > 0) {
      onNotify?.(trouble[0].reason, 'error')
      return
    }
    askedRef.current = ''
    attemptRef.current = 0
    triesRef.current = { ply: -1, count: 0 }
    recordedRef.current = false
    setLooks(NO_LOOKS)
    setLooking(false)
    setSaid([])
    setTyped('')
    setProblem(null)
    setWrittenOut(null)
    apply(startArena(setup, { now: monotonic(), roll: Math.random() }))
  }, [setup, apply, onNotify])

  // ---------------------------------------------------------------- the engine's answers

  useEffect(() => {
    const offAnalysis = window.api.onChessAnalysis((raw: unknown) => {
      const update = readEngineUpdate(raw)
      if (!update || !update.complete) return
      const current = gameRef.current
      const waiting = current?.thinking
      // Not what this screen is waiting for. An answer about another position is not late information, it is a
      // move in the wrong game.
      if (!current || !waiting || update.requestId !== waiting.requestId || update.fen !== waiting.fen) return
      const step = engineAnswered(current, update, { now: monotonic(), roll: Math.random() })
      if (!step.ok) {
        attemptRef.current += 1
        apply(engineFailed(step.state, step.problem))
        onNotify?.(step.problem, 'error')
        return
      }
      apply(step.state)
      const played = step.move
      if (played) {
        const before = step.state.moves.length >= 2 ? step.state.moves[step.state.moves.length - 2].fen : step.state.startFen
        const words = announce(before, played.uci)
        if (words) setSaid((lines) => [...lines, words])
      }
    })

    const offFailed = window.api.onChessAnalysisFailed((failure: { id: string; fen: string; message: string }) => {
      const current = gameRef.current
      if (!current?.thinking || current.thinking.requestId !== failure.id) return
      attemptRef.current += 1
      apply(engineFailed(current, failure.message || 'The engine stopped.'))
      onNotify?.(failure.message || 'The engine stopped while it was thinking.', 'error')
    })

    return () => {
      offAnalysis()
      offFailed()
    }
  }, [apply, onNotify])

  // The engine's turn. Asked exactly once per position, which is what `askedRef` and the arena's own guard do.
  useEffect(() => {
    if (!game || game.finish !== null) return
    if (!engineTurn(game)) return
    const key = `${game.moves.length}:${attemptRef.current}`
    if (askedRef.current === key) return
    if (triesRef.current.ply !== game.moves.length) triesRef.current = { ply: game.moves.length, count: 0 }
    if (triesRef.current.count >= MOST_TRIES) return
    const request = engineTurnRequest(game, `blind-${game.startedAt}-${game.moves.length}-${attemptRef.current}`, monotonic())
    if (!request) return
    askedRef.current = key
    triesRef.current.count += 1
    const asked = engineAsked(game, request, monotonic())
    apply(asked)
    void window.api.chessAnalyse(request).catch((err: unknown) => {
      attemptRef.current += 1
      const why = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The engine could not be asked.'
      apply(engineFailed(gameRef.current ?? asked, why))
      onNotify?.(why, 'error')
    })
  }, [game, apply, onNotify])

  /* Leaving the screen stops our own search, by id and never "whatever is running". */
  useEffect(
    () => () => {
      const waiting = gameRef.current?.thinking
      if (waiting) void window.api.chessStopAnalysis(waiting.requestId).catch(() => undefined)
    },
    []
  )

  // ---------------------------------------------------------------- the person's move

  const play = useCallback((text: string): void => {
    const current = gameRef.current
    if (!current || current.finish !== null) return
    if (!yourTurn(current)) {
      setProblem({ says: 'It is not your turn yet.', suggest: [], asking: false })
      return
    }
    const entry = enterGameMove(current.fen, text)
    if (entry.uci === null) {
      setProblem({ says: entry.says, suggest: entry.suggest, asking: entry.asking })
      return
    }
    const step = playMove(
      current,
      { from: entry.uci.slice(0, 2), to: entry.uci.slice(2, 4), ...(entry.uci.length > 4 ? { promotion: entry.uci[4] as 'q' | 'r' | 'b' | 'n' } : {}) },
      'you',
      monotonic()
    )
    if (!step.ok) {
      setProblem({ says: step.problem, suggest: [], asking: false })
      return
    }
    const words = announce(current.fen, entry.uci)
    if (words) setSaid((lines) => [...lines, words])
    setTyped('')
    setProblem(null)
    setWrittenOut(null)
    apply(step.state)
  }, [apply])

  /** A look at the board. Counted first, so the board cannot be shown without the look being recorded. */
  const startLooking = useCallback((): void => {
    if (!rules.mayLook || game === null || game.finish !== null) return
    setLooks((now) => noteLook(now, game.moves.length))
    setLooking(true)
  }, [rules.mayLook, game])

  const stopLooking = useCallback((): void => setLooking(false), [])

  /** The position in words. Every square named, so it counts as a look exactly like showing the board. */
  const writeItOut = useCallback((): void => {
    if (!rules.mayLook || game === null) return
    setLooks((now) => noteLook(now, game.moves.length))
    setWrittenOut(sayGamePosition(game.fen))
  }, [rules.mayLook, game])

  const giveUp = useCallback((): void => {
    const current = gameRef.current
    if (!current || current.finish !== null) return
    const step = resign(current, 'you', monotonic())
    if (!step.ok) {
      onNotify?.(step.problem, 'error')
      return
    }
    apply(step.state)
  }, [apply, onNotify])

  // The game's record, written once, when it finishes.
  useEffect(() => {
    if (!game?.finish || recordedRef.current) return
    recordedRef.current = true
    const now = Date.now()
    onFinished?.({
      id: attemptId(now),
      at: now,
      area: 'blindfold',
      item: 'game',
      // The one fact the record is about: was the board really kept away for the whole game.
      strict: view.clean,
      verdict: `${game.finish.forYou === 'win' ? 'You won' : game.finish.forYou === 'loss' ? 'You lost' : 'Drawn'} (${game.finish.reason}). ${looksSay(mode, looks)}`,
      passed: game.finish.forYou === 'win',
      right: game.moves.filter((_, at) => at % 2 === (game.human === 'w' ? 0 : 1)).length,
      outOf: game.moves.length,
      ...(game.startedAt > 0 ? { ms: Math.max(0, now - game.startedAt) } : {})
    })
  }, [game, view.clean, mode, looks, onFinished])

  if (game === null) {
    return (
      <div className="cw-tr-setup">
        <p className="cw-tr-says">
          A whole game against Orbis's engine with the board hidden. It is the same game as anywhere else in Chess
          World -- the same engine, the same rules -- and untimed, because a clock running while you hold the
          position in your head would be measuring your typing.
        </p>
        <Segmented
          label="Which side you play"
          className="cw-tr-seg"
          optionClass="cw-tr-tab"
          litClass="on"
          value={side}
          options={SIDE_OPTIONS}
          onChange={setSide}
        />
        <Segmented
          label="How strong the opponent is"
          className="cw-tr-seg"
          optionClass="cw-tr-tab"
          litClass="on"
          value={level}
          options={LEVEL_OPTIONS}
          onChange={setLevel}
        />
        <Segmented
          label="What is allowed on screen"
          className="cw-tr-seg"
          optionClass="cw-tr-tab"
          litClass="on"
          value={mode}
          options={GAME_MODES.map((one) => ({ value: one.id, label: one.title }))}
          onChange={setMode}
        />
        <p className="cw-tr-note">{rules.asks}</p>
        <div className="cw-tr-go">
          <Button kind="primary" onClick={begin}>Start the game</Button>
        </div>
      </div>
    )
  }

  const myTurn = yourTurn(game)

  return (
    // The board, or the place it is not, through the Train group's own arrangement: a position goes to the shared
    // layout and gets a board as large as the room allows, where this was a 420-pixel column. The empty square is
    // drawn at the same size, which matters more here than anywhere -- in this game the board comes and goes every
    // time somebody holds the look button down, and a layout that jumped each time would be unusable.
    <TrainStage
      label="The game"
      className="cw-tr-stage"
      board={view.boardFen !== null
        ? { fen: view.boardFen, orientation: game.human, interactive: false, label: view.label }
        : null}
      away={{ label: view.label, because: view.because }}
      below={
        <>
        {view.lookButton && game.finish === null && (
          <div className="cw-tr-looks">
            <Button
              size="small"
              on={looking}
              onPointerDown={startLooking}
              onPointerUp={stopLooking}
              onPointerLeave={stopLooking}
              onBlur={stopLooking}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') startLooking() }}
              onKeyUp={stopLooking}
            >
              Look at the board
            </Button>
            <Button size="small" kind="quiet" onClick={writeItOut}>Write the position out</Button>
            <p className="cw-tr-faint">
              {looks.count === 0
                ? 'No looks yet. Each one is counted and said with the result.'
                : `${looks.count === 1 ? 'One look' : `${looks.count} looks`} so far.`}
            </p>
          </div>
        )}
        {writtenOut !== null && <p className="cw-tr-readout" role="status">{writtenOut}</p>}
        </>
      }
      right={<div className="cw-tr-aside">
        <p className="cw-tr-state" role="status">
          {game.finish !== null
            ? `${game.finish.forYou === 'win' ? 'You won' : game.finish.forYou === 'loss' ? 'You lost' : 'Drawn'} — ${game.finish.reason}.`
            : game.thinking !== null
              ? 'The engine is thinking.'
              : myTurn
                ? 'Your move. Write it or say it.'
                : 'Waiting for the engine.'}
        </p>
        {game.problem !== null && <p className="cw-tr-warn" role="status">{game.problem}</p>}

        {game.finish === null && (
          <>
            <div className="cw-tr-enter">
              <label className="cw-tr-enter-field">
                <span className="cw-tr-enter-name">Your move</span>
                <input
                  className="cw-tr-enter-box"
                  value={typed}
                  placeholder="Nf3, exd5, O-O"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={!myTurn}
                  onChange={(event) => setTyped(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    play(typed)
                  }}
                />
              </label>
              <Button size="small" kind="primary" disabled={!myTurn || typed.trim() === ''} onClick={() => play(typed)}>
                Play it
              </Button>
            </div>
            <Mic
              inputId="cw-blind-game"
              label="Speak your move"
              disabled={!myTurn}
              hear={(spoken) => hearMove(game.fen, spoken)}
              onHeard={(text) => play(text)}
            />
          </>
        )}

        {problem !== null && (
          <div className="cw-tr-fault cw-tr-fault-notation" role="status">
            <p className="cw-tr-fault-kind">{problem.asking ? 'Which did you mean?' : 'That move was not played.'}</p>
            <p className="cw-tr-fault-says">{problem.says}</p>
            {problem.suggest.length > 0 && (
              <div className="cw-tr-fault-try" role="group" aria-label="Did you mean">
                {problem.suggest.slice(0, 6).map((one) => (
                  <Button key={one} size="tiny" onClick={() => play(one)}>{one}</Button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* The moves are announced as they happen either way. Whether they stay on screen is the mode's decision. */}
        {said.length > 0 && (
          <ul className="cw-tr-said" aria-label="The moves as they were announced">
            {(view.moveList ? said : said.slice(-1)).map((line, index) => (
              <li key={`${index}-${line.slice(0, 16)}`}>{line}</li>
            ))}
          </ul>
        )}
        {!view.moveList && game.finish === null && (
          <p className="cw-tr-faint">
            Only the last move stays on screen. In this mode the game is yours to hold.
          </p>
        )}

        <div className="cw-tr-controls">
          {game.finish === null
            ? <Button size="small" kind="danger" onClick={giveUp}>Give up</Button>
            : <Button size="small" kind="primary" onClick={() => setGame(null)}>Another game</Button>}
        </div>

        {game.finish !== null && <p className="cw-tr-worth">{looksSay(mode, looks)}</p>}
      </div>}
    />
  )
}

export default BlindGame
