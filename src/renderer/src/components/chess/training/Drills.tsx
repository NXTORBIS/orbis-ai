import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChessStage } from '../ChessStage'
import { Button, EmptyState, Segmented } from '../../../ui'
import { useTrainingStore } from './store'
import {
  drillItem, drillSetup, drillStanding, drillSummary, drillVerdictText, endgameDrills, gameDrills, judgeDrill,
  type DrillDefinition, type DrillGame, type DrillVerdict
} from '../../../../../shared/chess/drills'
import { attemptId, attemptsFor } from '../../../../../shared/chess/trainingView'
import {
  DIFFICULTIES, engineAnswered, engineAsked, engineFailed, engineTurn, engineTurnRequest, pause, playMove,
  readEngineUpdate, startArena, thinkingLine, tick, yourTurn,
  type ArenaState, type Difficulty as EngineLevel
} from '../../../../../shared/chess/arena'
import { describeTimeControl, formatClock, remainingAt } from '../../../../../shared/chess/clock'
import type { ChessMove } from '../../../../../shared/chess/rules'
import type { Side } from '../../../../../shared/chess/evaluation'
import type { NoticeKind } from '../../../lib/notices'
import './drills.css'

/**
 * Drills: a position played out against the engine until you convert it, from either side, as often as you like.
 *
 * The screen owns none of the chess and none of the judging. `arena.ts` runs the game -- whose turn it is, when the
 * engine must think, what the clock says, and the refusal to accept anything after a game is over -- and
 * `drills.ts` says whether the objective has been met, which it mostly does by asking the Endgame Lab. This file
 * lays them out and sends the engine's searches off.
 *
 * Four things it is careful about, each copied deliberately from the Arena because each is a real bug otherwise.
 *
 * **The engine is asked once a turn.** The session refuses a second ask for a position it has already asked about,
 * and a ref here refuses one in the gap before that state has landed. React renders twice in development; without
 * both guards that is two searches and two moves for one turn.
 *
 * **An answer is matched before it is used.** Every update carries the request it belongs to and the position it
 * was about, and anything that does not match what this screen is waiting for is dropped.
 *
 * **A finished drill stops.** The moment the objective is met or gone, the engine is not asked again and the clock
 * is paused -- which is an honest arena operation rather than a faked finish. A drill where the engine kept playing
 * after the mate was missed would quietly turn the review into another go.
 *
 * **The record is filed once.** Guarded on the game's own start time, so a redraw files nothing and a restart files
 * its own.
 */

export interface DrillsProps {
  onNotify?: (text: string, kind?: NoticeKind) => void
}

interface EngineStatus {
  state: string
  detail: string
  name?: string
  version?: string
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

type Shelf = 'endgame-lab' | 'your-game'

const SHELVES: readonly { value: Shelf; label: string }[] = [
  { value: 'endgame-lab', label: 'The Endgame Lab' },
  { value: 'your-game', label: 'Your own games' }
]

const SIDE_OPTIONS: readonly { value: Side; label: string }[] = [
  { value: 'w', label: 'I was White' },
  { value: 'b', label: 'I was Black' }
]

const TERMINAL: readonly DrillVerdict['state'][] = ['converted', 'missed', 'unclear']

export function Drills({ onNotify }: DrillsProps = {}): React.JSX.Element {
  const kept = useTrainingStore()
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [shelf, setShelf] = useState<Shelf>('endgame-lab')
  const [level, setLevel] = useState<EngineLevel>('club')
  const [yourSide, setYourSide] = useState<Side>('w')
  const [games, setGames] = useState<DrillGame[] | null>(null)
  const [gamesProblem, setGamesProblem] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [game, setGame] = useState<ArenaState | null>(null)
  const [clockNow, setClockNow] = useState(() => monotonic())

  const gameRef = useRef<ArenaState | null>(null)
  const askRef = useRef('')
  const attemptRef = useRef(0)
  const triesRef = useRef({ ply: -1, count: 0 })
  const filed = useRef('')

  const apply = useCallback((next: ArenaState) => {
    gameRef.current = next
    setGame(next)
  }, [])

  // ---------------------------------------------------------------- the engine, and your games

  useEffect(() => {
    let alive = true
    const read = async (): Promise<void> => {
      try {
        const got = (await window.api.chessEngineStatus()) as EngineStatus
        if (alive) setStatus(got)
      } catch {
        if (alive) setStatus({ state: 'unknown', detail: 'Orbis could not tell whether the engine is here.' })
      }
    }
    void read()
    const offProgress = window.api.onChessEngineProgress((message: string) => setProgress(message))
    const offChanged = window.api.onChessEngineChanged(() => {
      setProgress(null)
      void read()
    })
    return () => {
      alive = false
      offProgress()
      offChanged()
    }
  }, [])

  useEffect(() => {
    let alive = true
    const read = async (): Promise<void> => {
      try {
        const stored = await window.api.chessGames()
        if (!alive) return
        setGames(
          stored.map((one) => ({
            id: one.id,
            startFen: one.startFen,
            moves: one.moves.map((move) => ({ san: move.san, fen: move.fen })),
            result: one.meta.result,
            you: yourSide,
            title: titleOf(one)
          }))
        )
      } catch (err) {
        if (alive) setGamesProblem(`Your own games could not be read (${plainly(err)}).`)
      }
    }
    void read()
    const off = window.api.onChessGamesChanged(() => void read())
    // A different profile is a different set of games, so they are read again rather than left on screen.
    const offProfile = window.api.onProfileChanged(() => {
      setGames(null)
      setChosen(null)
      setGame(null)
      gameRef.current = null
      void read()
    })
    return () => {
      alive = false
      off()
      offProfile()
    }
  }, [yourSide])

  // ---------------------------------------------------------------- the list

  const lab = useMemo(() => endgameDrills(), [])
  const mine = useMemo(() => (games === null ? null : gameDrills(games)), [games])
  const shown = shelf === 'endgame-lab' ? lab : mine
  const drills = shown?.drills ?? []
  const drill = useMemo(() => drills.find((one) => one.id === chosen) ?? null, [drills, chosen])

  const verdict = useMemo(() => (drill && game ? judgeDrill(drill, game) : null), [drill, game])
  const over = verdict !== null && TERMINAL.includes(verdict.state)
  const standing = useMemo(
    () => (drill ? drillStanding(attemptsFor(kept.store, 'drill', drillItem(drill, level))) : null),
    [drill, level, kept.store]
  )
  const summary = useMemo(() => drillSummary(kept.store.attempts), [kept.store.attempts])

  const begin = useCallback((pick: DrillDefinition) => {
    askRef.current = ''
    attemptRef.current = 0
    triesRef.current = { ply: -1, count: 0 }
    const now = monotonic()
    setClockNow(now)
    apply(startArena(drillSetup(pick, { level }), { now }))
  }, [apply, level])

  const choose = useCallback((pick: DrillDefinition) => {
    setChosen(pick.id)
    begin(pick)
  }, [begin])

  // ---------------------------------------------------------------- the engine's answers

  useEffect(() => {
    const offAnalysis = window.api.onChessAnalysis((raw: unknown) => {
      const update = readEngineUpdate(raw)
      if (!update) return
      const current = gameRef.current
      const waiting = current?.thinking
      // Not what this screen is waiting for. Nothing is relabelled and nothing is played under another position.
      if (!current || !waiting || update.requestId !== waiting.requestId || update.fen !== waiting.fen) return
      if (!update.complete) return
      const step = engineAnswered(current, update, { now: monotonic(), roll: Math.random() })
      if (!step.ok) {
        attemptRef.current += 1
        apply(engineFailed(step.state, step.problem))
        onNotify?.(step.problem, 'error')
        return
      }
      apply(step.state)
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

  // ---------------------------------------------------------------- the engine's turn

  useEffect(() => {
    if (!game || game.finish || over || !canPlay(status)) return
    if (!engineTurn(game)) return
    const key = `${game.moves.length}:${attemptRef.current}`
    if (askRef.current === key) return
    if (triesRef.current.ply !== game.moves.length) triesRef.current = { ply: game.moves.length, count: 0 }
    if (triesRef.current.count >= MAX_TRIES) return
    const request = engineTurnRequest(game, `drill-${game.startedAt}-${game.moves.length}-${attemptRef.current}`, monotonic())
    if (!request) return
    askRef.current = key
    triesRef.current.count += 1
    const asked = engineAsked(game, request, monotonic())
    apply(asked)
    void window.api.chessAnalyse(request).catch((err: unknown) => {
      attemptRef.current += 1
      const why = plainly(err)
      apply(engineFailed(gameRef.current ?? asked, why))
      onNotify?.(why, 'error')
    })
  }, [game, status, over, apply, onNotify])

  // ---------------------------------------------------------------- the clock, and stopping

  useEffect(() => {
    if (!game || game.finish || over || game.clock.paused) return undefined
    const id = window.setInterval(() => {
      const now = monotonic()
      setClockNow(now)
      const current = gameRef.current
      if (current && !current.finish) apply(tick(current, now))
    }, 250)
    return () => window.clearInterval(id)
  }, [game, over, apply])

  /* The drill is over: the engine is not asked again, and the clock is charged to nobody. */
  useEffect(() => {
    if (!over || !game || game.clock.paused) return
    if (game.thinking) void window.api.chessStopAnalysis(game.thinking.requestId).catch(() => undefined)
    apply(pause(game, monotonic()))
  }, [over, game, apply])

  // ---------------------------------------------------------------- the record

  useEffect(() => {
    if (!drill || !game || !verdict || !over) return
    const key = `${drill.id}:${game.startedAt}`
    if (filed.current === key) return
    filed.current = key
    const at = Date.now()
    kept.record({
      id: attemptId(at),
      at,
      area: 'drill',
      item: drillItem(drill, level),
      // A drill is never strict: the board is on screen and being played on, which is what a drill is.
      strict: false,
      verdict: drillVerdictText(drill, verdict, level),
      passed: verdict.state === 'converted',
      right: verdict.yourMoves,
      ...(verdict.allowed !== null ? { outOf: verdict.allowed } : {}),
      hints: game.hintsTaken,
      ms: Math.max(0, Math.round(monotonic() - game.startedAt))
    })
    onNotify?.(verdict.state === 'converted' ? `Converted: ${drill.title}` : verdict.says, 'info')
  }, [drill, game, verdict, over, level, kept, onNotify])

  const onBoardMove = useCallback((move: ChessMove) => {
    const current = gameRef.current
    if (!current || over) return
    const step = playMove(
      current,
      { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) },
      'you',
      monotonic()
    )
    if (!step.ok) {
      onNotify?.(step.problem, 'error')
      return
    }
    apply(step.state)
  }, [apply, onNotify, over])

  const install = useCallback(async () => {
    setInstalling(true)
    try {
      await window.api.chessEngineInstall()
    } catch (err) {
      onNotify?.(plainly(err), 'error')
    } finally {
      setInstalling(false)
    }
  }, [onNotify])

  // ---------------------------------------------------------------- the screen

  const left = game ? remainingAt(game.clock, clockNow) : null
  const lastMove = game && game.moves.length > 0 ? game.moves[game.moves.length - 1] : null

  return (
    <div className="cw-dr">
      <aside className="cw-dr-side" aria-label="Positions to drill">
        <Segmented<Shelf>
          value={shelf}
          options={SHELVES}
          onChange={(next) => { setShelf(next); setChosen(null); setGame(null); gameRef.current = null }}
          label="Where the positions come from"
          className="cw-dr-seg"
          optionClass="cw-dr-tab"
        />

        <Segmented<EngineLevel>
          value={level}
          options={DIFFICULTIES.map((one) => ({ value: one.id, label: one.name, why: one.about }))}
          onChange={(next) => { setLevel(next); if (drill) begin(drill) }}
          label="How strong the opponent is"
          className="cw-dr-seg"
          optionClass="cw-dr-tab"
        />
        <p className="cw-dr-says">
          Converting against one level says nothing about another, so each level keeps its own count.
        </p>

        {shelf === 'your-game' && (
          <>
            <Segmented<Side>
              value={yourSide}
              options={SIDE_OPTIONS}
              onChange={(next) => { setYourSide(next); setChosen(null); setGame(null); gameRef.current = null }}
              label="Which side you were"
              className="cw-dr-seg"
              optionClass="cw-dr-tab"
            />
            <p className="cw-dr-says">
              Orbis does not record which side you played in a stored game, so say which you were and these are
              worked out from that.
            </p>
          </>
        )}

        <p className="cw-dr-says">{shown?.says ?? 'Your own games are still being read.'}</p>
        {gamesProblem !== null && <p className="cw-dr-warn" role="status">{gamesProblem}</p>}

        {drills.length === 0 ? (
          <EmptyState>
            {shelf === 'endgame-lab'
              ? 'No endings are being offered, which should not happen. The reasons are below.'
              : 'None of your games has a position to drill yet. A game you lost or drew, with an ending in it, is what this looks for.'}
          </EmptyState>
        ) : (
          <ul className="cw-dr-items">
            {drills.map((one) => {
              const record = drillStanding(attemptsFor(kept.store, 'drill', drillItem(one, level)))
              return (
                <li key={one.id}>
                  <button
                    type="button"
                    className={`cw-dr-item${one.id === chosen ? ' cw-dr-item-on' : ''}`}
                    onClick={() => choose(one)}
                  >
                    <strong>{one.title}</strong>
                    <small>{one.about}</small>
                    <small>{record.says}</small>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {(shown?.refused.length ?? 0) > 0 && (
          <details className="cw-dr-refused">
            <summary>{shown?.refused.length} not offered</summary>
            <ul>
              {shown?.refused.map((one) => (
                <li key={one.id}>{one.says}</li>
              ))}
            </ul>
          </details>
        )}

        <p className="cw-dr-says">{summary.says}</p>
        {kept.readProblem !== null && <p className="cw-dr-warn" role="status">{kept.readProblem}</p>}
        {kept.saveProblem !== null && <p className="cw-dr-warn" role="status">{kept.saveProblem}</p>}
      </aside>

      <section className="cw-dr-main" aria-label="The drill">
        {!canPlay(status) ? (
          <EmptyState
            action={
              <Button kind="primary" size="small" busy={installing} busyLabel="Fetching…" onClick={() => void install()}>
                Get the engine
              </Button>
            }
          >
            A drill is played against a real engine, and there is not one here yet.{' '}
            {progress ?? status?.detail ?? 'Stockfish is a separate program under its own licence, so Orbis fetches it rather than carrying it.'}
          </EmptyState>
        ) : !drill || !game ? (
          // "from the list", not "on the left": narrow, the list is above rather than beside.
          <EmptyState>Pick a position from the list and play it out.</EmptyState>
        ) : (
          <>
            <div className="cw-dr-head">
              <h4 className="cw-dr-title">{drill.title}</h4>
              <p className="cw-dr-objective">{drill.objective}</p>
            </div>

            {/*
              * The board, through the shared layout, which measures the room and hands it a real pixel size. It
              * used to be a column beside a panel with no width of its own, which is how it ended up about 357
              * pixels wide however large the window was. The panel is now the stage's right column, so the board
              * takes the room that is left over rather than the other way round.
              */}
            <ChessStage
              label={`${drill.title}. ${drill.objective}`}
              className="cw-dr-stage"
              board={{
                fen: game.fen,
                orientation: drill.you,
                interactive: yourTurn(game) && !over,
                lastMove: lastMove ? { from: lastMove.uci.slice(0, 2), to: lastMove.uci.slice(2, 4) } : null,
                onMove: onBoardMove,
                highlight: over ? [] : [...(drill.entry?.marks ?? [])],
                label: `${drill.title}. ${drill.objective}`
              }}
              below={
                <>
                <div className="cw-dr-under">
                  <span className="cw-dr-state" role="status">
                    {over
                      ? verdict?.says
                      : game.finish
                        ? (game.finish.termination ?? 'The game is over.')
                        : yourTurn(game)
                          ? 'Your move.'
                          : (thinkingLine(game, clockNow) ?? 'The engine’s move.')}
                  </span>
                  <span className="cw-dr-clock">
                    {left ? `${formatClock(left[drill.you])} left` : describeTimeControl(game.setup.control)}
                  </span>
                </div>
                <div className="cw-dr-controls">
                  <Button size="small" kind={over ? 'primary' : 'normal'} onClick={() => begin(drill)}>
                    {over ? 'Go again' : 'Start again'}
                  </Button>
                </div>
                {game.problem !== null && <p className="cw-dr-warn" role="status">{game.problem}</p>}
                </>
              }

              right={<div className="cw-dr-aside">
                <dl className="cw-dr-figures">
                  <div>
                    <dt>Your moves</dt>
                    <dd>{verdict?.yourMoves ?? 0}</dd>
                  </div>
                  <div>
                    <dt>{drill.role === 'defend' ? 'Of their moves' : 'Moves allowed'}</dt>
                    <dd>
                      {drill.role === 'defend'
                        ? `${verdict?.theirMoves ?? 0}${verdict?.allowed === null || verdict?.allowed === undefined ? '' : ` of ${verdict.allowed}`}`
                        : (verdict?.allowed ?? 'no limit')}
                    </dd>
                  </div>
                  <div>
                    <dt>Converted</dt>
                    <dd>{standing ? `${standing.converted} of ${standing.tries}` : '—'}</dd>
                  </div>
                </dl>

                {verdict !== null && (
                  <p className={`cw-dr-verdict cw-dr-verdict-${verdict.state}`} role="status">
                    {verdict.says}
                  </p>
                )}

                {drill.method !== null && <p className="cw-dr-method">{drill.method}</p>}

                <ul className="cw-dr-caveats">
                  {(verdict?.caveats ?? []).map((one) => (
                    <li key={one}>{one}</li>
                  ))}
                </ul>

                <details className="cw-dr-where">
                  <summary>Where this position came from</summary>
                  <p>{drill.provenance}</p>
                </details>

                {standing !== null && standing.tries > 0 && (
                  <p className="cw-dr-says">
                    {standing.firstConverted === true
                      ? 'You converted it the first time you saw it.'
                      : 'The first go is kept separately: it is the one that says whether you could do it without having seen it.'}
                  </p>
                )}
              </div>}
            />
          </>
        )}
      </section>
    </div>
  )
}

/** What to call a stored game in the list. Nothing is filled in that the record does not say. */
function titleOf(one: { meta: { white?: { name?: string }; black?: { name?: string }; date?: string; event?: string; opening?: string } }): string {
  const white = one.meta.white?.name
  const black = one.meta.black?.name
  const names = white || black ? `${white ?? 'somebody'} against ${black ?? 'somebody'}` : (one.meta.event ?? 'A game')
  const when = one.meta.date && !one.meta.date.includes('?') ? ` — ${one.meta.date}` : ''
  const opening = one.meta.opening ? ` (${one.meta.opening})` : ''
  return `${names}${when}${opening}`.slice(0, 90)
}
