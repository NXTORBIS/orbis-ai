import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, EmptyState, Segmented } from '../../../ui'
import { acceptUpdate, bestLine, readUpdate, watchFor, type EngineWatch } from '../../../../../shared/chess/analysis'
import { fenAt, type StoredGame } from '../../../../../shared/chess/model'
import {
  SKIP_WORDS, generateFromGame, mateAt, plyRange, scanCost,
  type Candidate, type EngineSettings, type GenEval, type Generated, type GenerateOptions, type GenerateResult,
  type Rejected, type Skipped, type SkipReason, type SourceGame
} from '../../../../../shared/chess/puzzleGen'
import { THEME_LABEL, isFact, type Puzzle } from '../../../../../shared/chess/puzzles'

/**
 * Making puzzles out of your own games.
 *
 * ## There are two ways, and one of them needs nothing installed
 *
 * **Looking for mates** is a search over the rules themselves. It needs no engine, nothing downloaded and no
 * network, and what it finds is *proved*: `forcedMateTree` answers every defence by construction, so the puzzle is
 * checked before anybody sees it. It costs about three milliseconds a position for a mate in one and about a
 * quarter of a second for a mate in two, which is why it runs one position at a time with a progress bar and a
 * stop button rather than freezing the screen for twenty seconds.
 *
 * **Asking the engine** finds the other kind of moment -- a move that gave up material, a win that was there. It
 * needs Stockfish set up, and it needs the engine's answers to reach this screen.
 *
 * ## The engine route is only offered when it can actually work
 *
 * The engine answers arrive in the main process and are sent on as events. Whether those events reach a screen is
 * not something this area can add, so this component **asks** before offering the button: if the bridge is not
 * there, the engine route is not drawn at all and the reason is said in a sentence. A button that cannot work is
 * worse than no button.
 */

type Route = 'mates' | 'engine'

interface Bridge {
  onChessAnalysis: (listener: (value: unknown) => void) => () => void
  onChessAnalysisFailed?: (listener: (value: unknown) => void) => () => void
}

/** Whether the engine's answers can reach this screen at all. Asked, never assumed. */
function analysisBridge(): Bridge | null {
  const api = window.api as unknown as Partial<Bridge>
  return typeof api.onChessAnalysis === 'function' ? (api as Bridge) : null
}

interface Progress { done: number; total: number; what: string }

export interface MakerProps {
  /** Called with the puzzles somebody chose to keep. */
  onKeep: (puzzles: Puzzle[]) => void
  onNotify?: (text: string, kind?: 'error' | 'info') => void
  /** Ids already in the collection, so a puzzle that is already there is not offered again. */
  have: ReadonlySet<string>
}

const MATE_DEPTHS: { value: '1' | '2'; label: string; name: string }[] = [
  { value: '1', label: 'Mate in one', name: 'Look for mates in one move' },
  { value: '2', label: 'Up to mate in two', name: 'Look for mates in up to two of your own moves' }
]

export function Maker({ onKeep, onNotify, have }: MakerProps): React.JSX.Element {
  const [games, setGames] = useState<StoredGame[] | null>(null)
  const [gameId, setGameId] = useState<string | null>(null)
  const [route, setRoute] = useState<Route>('mates')
  const [depth, setDepth] = useState<'1' | '2'>('1')
  const [engineMs, setEngineMs] = useState<'400' | '1000' | '2500'>('1000')
  const [engineReady, setEngineReady] = useState<boolean | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [problem, setProblem] = useState<string | null>(null)
  const stop = useRef(false)
  const bridge = useMemo(() => analysisBridge(), [])

  useEffect(() => {
    let alive = true
    void window.api.chessGames()
      .then((list) => { if (alive) setGames(list) })
      .catch(() => { if (alive) { setGames([]); setProblem('Your saved games could not be read, so there is nothing to make puzzles from.') } })
    void window.api.chessEngineStatus()
      .then((status) => { if (alive) setEngineReady(status.state === 'ready') })
      .catch(() => { if (alive) setEngineReady(false) })
    return () => { alive = false }
  }, [])

  const game = useMemo(() => games?.find((one) => one.id === gameId) ?? null, [games, gameId])
  const cost = useMemo(
    () => (game ? scanCost(game, { now: Date.now(), mateDepth: Number(depth) }) : null),
    [game, depth]
  )
  const engineCost = useMemo(() => {
    if (!game) return null
    const positions = game.moves.length + 1
    const seconds = Math.round((positions * Number(engineMs)) / 1000)
    return { positions, seconds }
  }, [game, engineMs])

  /** The rules-only sweep, one position at a time so the screen keeps drawing. */
  const runMates = useCallback(async (source: SourceGame): Promise<void> => {
    const options: GenerateOptions = { now: Date.now(), mateDepth: Number(depth), onlyMissed: true }
    const plies = plyRange(source, options)
    const candidates: Candidate[] = []
    for (const [index, ply] of plies.entries()) {
      if (stop.current) break
      setProgress({ done: index, total: plies.length, what: `Looking at position ${index + 1} of ${plies.length}` })
      candidates.push(mateAt(source, ply, options))
      // One turn of the event loop between positions. Without it a mate-in-two sweep locks the window.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    setResult(gather(source.id, source.moves.length, candidates, [], stop.current ? 'stopped' : 'finished'))
  }, [depth])

  /** The engine sweep: ask about every position, then hand the answers to the pure layer. */
  const runEngine = useCallback(async (source: SourceGame, link: Bridge): Promise<void> => {
    const movetime = Number(engineMs)
    const settings: EngineSettings = { movetime, multipv: 3 }
    const plies = plyRange(source, { now: Date.now() })
    const evaluations: GenEval[] = []
    let watch: EngineWatch = watchFor('', '')
    let settle: ((value: 'done' | 'failed') => void) | null = null

    const offUpdate = link.onChessAnalysis((value) => {
      const update = readUpdate(value)
      if (!update) return
      watch = acceptUpdate(watch, update)
      if (watch.complete && settle) settle('done')
    })
    const offFailed = link.onChessAnalysisFailed?.((value) => {
      const failure = value as { id?: string; message?: string }
      if (failure?.id === watch.requestId && settle) settle('failed')
    }) ?? (() => undefined)

    try {
      for (const [index, ply] of plies.entries()) {
        if (stop.current) break
        const fen = fenAt(source, ply)
        setProgress({ done: index, total: plies.length, what: `The engine is looking at position ${index + 1} of ${plies.length}` })
        const id = `pz-${source.id}-${ply}-${Date.now()}`
        watch = watchFor(id, fen)
        const answer = await new Promise<'done' | 'failed' | 'timeout'>((resolve) => {
          settle = resolve
          const timer = setTimeout(() => resolve('timeout'), movetime + 20_000)
          void window.api.chessAnalyse({ id, fen, multipv: 3, movetime }).catch(() => {
            clearTimeout(timer)
            resolve('failed')
          })
        })
        settle = null
        if (answer !== 'done') {
          setProblem(answer === 'timeout'
            ? 'The engine stopped answering, so the sweep was cut short. What it did say has been used.'
            : 'The engine could not finish, so the sweep was cut short. What it did say has been used.')
          break
        }
        const best = bestLine(watch)
        if (!best) continue
        evaluations.push({
          ply,
          fen,
          score: best.score,
          depth: best.depth,
          bestmove: watch.bestmove ?? null,
          pvUci: best.pvUci,
          ...(best.bound !== null ? { provisional: true } : {}),
          alternatives: watch.lines
            .filter((line) => line.pvUci.length > 0)
            .map((line) => ({ uci: line.pvUci[0], score: line.score }))
        })
      }
    } finally {
      offUpdate()
      offFailed()
      void window.api.chessStopAnalysis().catch(() => undefined)
    }

    setResult(generateFromGame(source, evaluations, { now: Date.now(), engine: settings, includeShallow: false }))
  }, [engineMs])

  const start = (): void => {
    if (!game) return
    stop.current = false
    setProblem(null)
    setResult(null)
    setChosen(new Set())
    setProgress({ done: 0, total: 1, what: 'Starting' })
    const work = route === 'engine' && bridge ? runEngine(game, bridge) : runMates(game)
    void work
      .catch(() => setProblem('Something went wrong while looking through the game. Nothing was added.'))
      .finally(() => setProgress(null))
  }

  const fresh = useMemo(
    () => (result?.generated ?? []).filter((one) => !have.has(one.puzzle.id)),
    [result, have]
  )
  const alreadyHere = (result?.generated.length ?? 0) - fresh.length

  const keep = (): void => {
    const picked = fresh.filter((one) => chosen.has(one.puzzle.id)).map((one) => one.puzzle)
    if (picked.length === 0) return
    onKeep(picked)
    onNotify?.(`${picked.length} ${picked.length === 1 ? 'puzzle' : 'puzzles'} kept.`)
    setChosen(new Set())
  }

  return (
    <div className="cw-pz-maker">
      <h3>Make puzzles from your own games</h3>

      {games === null && <p className="cw-pz-faint">Reading your games…</p>}
      {games !== null && games.length === 0 && (
        <EmptyState>
          There are no saved games to make puzzles from yet. Bring in a PGN file, or play a game and save it, and
          the moments worth looking at again will be in here.
        </EmptyState>
      )}

      {games !== null && games.length > 0 && (
        <>
          <label className="cw-pz-pick">
            <span>Which game</span>
            <select className="cw-pz-select" value={gameId ?? ''} onChange={(event) => { setGameId(event.target.value || null); setResult(null) }}>
              <option value="">Pick a game…</option>
              {games.map((one) => (
                <option key={one.id} value={one.id}>
                  {[one.meta.white.name ?? 'White', 'vs', one.meta.black.name ?? 'Black', '·', `${one.moves.length} moves`, one.meta.date ?? ''].filter(Boolean).join(' ')}
                </option>
              ))}
            </select>
          </label>

          <Segmented
            label="How to look through it"
            className="cw-pz-routes"
            optionClass="cw-pz-route"
            value={route}
            options={bridge
              ? [
                  { value: 'mates' as Route, label: 'Look for mates', name: 'Look for forced mates using the rules alone' },
                  { value: 'engine' as Route, label: 'Ask the engine', name: 'Ask Stockfish about every position', disabled: engineReady !== true, why: engineReady === true ? undefined : 'The chess engine is not set up on this computer yet.' }
                ]
              : [{ value: 'mates' as Route, label: 'Look for mates', name: 'Look for forced mates using the rules alone' }]}
            onChange={(value) => { setRoute(value); setResult(null) }}
          />

          {route === 'mates' && (
            <>
              <Segmented
                label="How far to look"
                className="cw-pz-depths"
                optionClass="cw-pz-depth"
                value={depth}
                options={MATE_DEPTHS}
                onChange={(value) => { setDepth(value); setResult(null) }}
              />
              <p className="cw-pz-faint">
                This is a search over the rules of chess, not an engine. Nothing is downloaded and nothing is guessed:
                every mate it finds is a mate, with every defence answered, so the puzzle is checked before you see it.
                {cost ? ` ${cost.says}` : ''}
              </p>
            </>
          )}

          {route === 'engine' && bridge && (
            <>
              <Segmented
                label="How long the engine thinks about each position"
                className="cw-pz-depths"
                optionClass="cw-pz-depth"
                value={engineMs}
                options={[
                  { value: '400' as const, label: 'Quick', name: 'About four tenths of a second a position' },
                  { value: '1000' as const, label: 'Normal', name: 'About a second a position' },
                  { value: '2500' as const, label: 'Careful', name: 'About two and a half seconds a position' }
                ]}
                onChange={(value) => { setEngineMs(value); setResult(null) }}
              />
              <p className="cw-pz-faint">
                {engineCost
                  ? `${engineCost.positions} positions, so roughly ${engineCost.seconds} seconds. You can stop it.`
                  : 'Pick a game first.'}
                {' '}A moment the engine points at is only turned into a puzzle when the rules can prove the answer —
                a forced mate, or material that can be counted. Anything else is skipped and said so.
              </p>
            </>
          )}

          {!bridge && (
            <p className="cw-pz-faint">
              Asking the engine is not available from this screen in this build. The engine runs, and it answers, but
              its answers are sent to the window on a channel this screen has no way to listen on. Looking for mates
              needs no engine and works now.
            </p>
          )}

          <div className="cw-pz-row">
            <Button size="small" kind="primary" disabled={!game || progress !== null} onClick={start}>
              {progress ? 'Looking…' : 'Look through this game'}
            </Button>
            {progress && <Button size="small" kind="quiet" onClick={() => { stop.current = true }}>Stop</Button>}
          </div>

          {progress && (
            <div className="cw-pz-progress">
              <progress value={progress.done} max={Math.max(1, progress.total)} />
              <span>{progress.what}</span>
            </div>
          )}

          {problem && <p className="cw-pz-why" role="status">{problem}</p>}

          {result && (
            <div className="cw-pz-found">
              <p className="cw-pz-says" role="status">{result.says}</p>
              {alreadyHere > 0 && <p className="cw-pz-faint">{alreadyHere} of them {alreadyHere === 1 ? 'is' : 'are'} already in your collection.</p>}

              {fresh.length === 0
                ? (
                  <EmptyState>
                    Nothing new came out of this game. The list below says what was looked at and why each position
                    gave nothing — a position with one legal move is not a puzzle, and neither is a recapture nobody
                    has to find.
                  </EmptyState>
                )
                : (
                  <>
                    <div className="cw-pz-row">
                      <Button size="tiny" onClick={() => setChosen(new Set(fresh.map((one) => one.puzzle.id)))}>Choose all</Button>
                      <Button size="tiny" kind="quiet" onClick={() => setChosen(new Set())}>Choose none</Button>
                      <Button size="small" kind="primary" disabled={chosen.size === 0} onClick={keep}>
                        Keep {chosen.size || ''} {chosen.size === 1 ? 'puzzle' : 'puzzles'}
                      </Button>
                    </div>
                    <ul className="cw-pz-madelist">
                      {fresh.map((one) => <MadeRow key={one.puzzle.id} made={one} on={chosen.has(one.puzzle.id)} onToggle={() => setChosen((held) => {
                        const next = new Set(held)
                        if (next.has(one.puzzle.id)) next.delete(one.puzzle.id)
                        else next.add(one.puzzle.id)
                        return next
                      })} />)}
                    </ul>
                  </>
                )}

              <WhyNothing skipped={result.skipped} rejected={result.rejected} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function MadeRow({ made, on, onToggle }: { made: Generated; on: boolean; onToggle: () => void }): React.JSX.Element {
  const facts = made.puzzle.themes.filter(isFact).map((claim) => THEME_LABEL[claim.theme])
  return (
    <li className="cw-pz-made">
      <label className="cw-pz-made-pick">
        <input type="checkbox" checked={on} onChange={onToggle} />
        <span>
          <strong>Move {made.moment.number}{made.moment.side === 'b' ? '…' : '.'}</strong>
          {made.moment.playedSan ? ` ${made.moment.playedSan} was played.` : ''}
          {' '}{made.puzzle.exercise.prompt}
        </span>
      </label>
      <p className="cw-pz-faint">{facts.length ? facts.join(', ') : 'Not classified'} · {made.says}</p>
    </li>
  )
}

/** Why the positions that gave nothing gave nothing, grouped, because a list of eighty lines helps nobody. */
function WhyNothing({ skipped, rejected }: { skipped: readonly Skipped[]; rejected: readonly Rejected[] }): React.JSX.Element | null {
  const groups = useMemo(() => {
    const counted = new Map<SkipReason, number>()
    for (const one of skipped) counted.set(one.reason, (counted.get(one.reason) ?? 0) + 1)
    return [...counted.entries()].sort((a, b) => b[1] - a[1])
  }, [skipped])
  if (groups.length === 0 && rejected.length === 0) return null
  return (
    <details className="cw-pz-whynot">
      <summary>What was looked at, and what it gave</summary>
      <ul>
        {groups.map(([reason, count]) => (
          <li key={reason}>{count} {count === 1 ? 'position' : 'positions'}: {SKIP_WORDS[reason].toLowerCase()}.</li>
        ))}
      </ul>
      {rejected.length > 0 && (
        <>
          <p className="cw-pz-why">
            {rejected.length} {rejected.length === 1 ? 'moment was' : 'moments were'} thrown out because the solution
            did not hold up when it was checked. That is a fault worth knowing about:
          </p>
          <ul className="cw-pz-problems">
            {rejected.slice(0, 5).map((one) => <li key={one.ply}>Move {one.ply}: {one.problems[0] ?? one.says}</li>)}
          </ul>
        </>
      )}
    </details>
  )
}

/** The same shape `generateFromGame` returns, from candidates gathered one at a time. */
function gather(gameId: string, plies: number, candidates: readonly Candidate[], ignored: { ply: number; reason: string }[], how: 'finished' | 'stopped'): GenerateResult {
  const generated: Generated[] = []
  const rejected: Rejected[] = []
  const skipped: Skipped[] = []
  for (const candidate of candidates) {
    if (candidate.kind === 'puzzle') generated.push(candidate.made)
    else if (candidate.kind === 'rejected') rejected.push(candidate.rejected)
    else skipped.push(candidate.skipped)
  }
  const verified = generated.filter((one) => one.puzzle.exercise.verification.status === 'verified').length
  const parts = [
    generated.length === 0
      ? 'No puzzles came out of this game.'
      : `${generated.length} ${generated.length === 1 ? 'puzzle' : 'puzzles'} made, ${verified} of them checked by the rules.`,
    rejected.length ? `${rejected.length} ${rejected.length === 1 ? 'moment was' : 'moments were'} thrown out because the solution did not hold up.` : '',
    how === 'stopped' ? `Stopped after ${candidates.length} ${candidates.length === 1 ? 'position' : 'positions'}, so the rest of the game has not been looked at.` : ''
  ].filter(Boolean)
  return {
    gameId,
    generated,
    rejected,
    skipped,
    coverage: { plies, considered: candidates.length, evaluated: 0, shallow: 0, ignored },
    says: parts.join(' ')
  }
}

export default Maker
