import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, EmptyState, Surface } from '../../ui'
import type { NoticeKind } from '../../lib/notices'
import { Board } from './Board'
import { START_FEN, outcome, type ChessMove } from '../../../../shared/chess/rules'
import { fenAt, movePairs, type GameMove, type StoredGame } from '../../../../shared/chess/model'
import './chess.css'

/**
 * Chess World.
 *
 * Four places to be, and the board is the same board in all of them: Play against the engine, Study a game you have,
 * Library of everything you own, and Live for tournaments being broadcast. What each one may do with a game is not a
 * matter of which screen you are on -- it is `SESSION_RIGHTS` in the model -- so a game you are watching cannot be
 * played and a puzzle cannot be resigned (Sections 019, 022).
 */

type Tab = 'play' | 'study' | 'library' | 'live'

const TABS: { id: Tab; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'study', label: 'Study' },
  { id: 'library', label: 'Library' },
  { id: 'live', label: 'Live' }
]

interface EngineStatus { state: string; detail: string; name?: string; version?: string }

export default function ChessView({ onClose, onNotify }: { onClose: () => void; onNotify: (text: string, kind?: NoticeKind) => void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('play')
  const [games, setGames] = useState<StoredGame[]>([])
  const [engine, setEngine] = useState<EngineStatus | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [ply, setPly] = useState(0)
  const [orientation, setOrientation] = useState<'w' | 'b'>('w')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => setGames(await window.api.chessGames()), [])

  useEffect(() => {
    void load().catch(() => undefined)
    void window.api.chessEngineStatus().then(setEngine).catch(() => setEngine(null))
  }, [load])

  const open = useMemo(() => games.find((g) => g.id === openId) ?? null, [games, openId])
  // Never point past the moves that are really saved: the save comes back a moment after the move is played.
  const here = open ? Math.max(0, Math.min(ply, open.moves.length)) : 0
  const fen = open ? fenAt(open, here) : START_FEN
  const state = useMemo(() => outcome(fen, open ? open.moves.slice(0, here).map((m) => m.san) : []), [fen, open, here])
  const lastMove = open && here > 0 ? open.moves[here - 1] : null

  const run = async (work: () => Promise<void>, done?: string): Promise<void> => {
    setBusy(true)
    try {
      await work()
      await load()
      if (done) onNotify(done)
    } catch (err) {
      onNotify(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'That did not work.', 'error')
    } finally {
      setBusy(false)
    }
  }

  /** A move the person made on the board. It is already legal; it is added to the game being studied. */
  const onMove = (move: ChessMove): void => {
    if (!open) return
    const next: GameMove[] = [...open.moves.slice(0, here), { san: move.san, uci: move.uci, fen: move.after }]
    void run(async () => {
      await window.api.chessSaveMoves(open.id, next, {})
      setPly(next.length)
    })
  }

  const engineLine = engine
    ? engine.state === 'ready'
      ? `${engine.name ?? 'The engine'} is ready.`
      : engine.detail
    : 'The chess engine has not been set up on this computer yet.'

  return (
    <Surface title="Chess World" onClose={onClose} className="cw-view">
      <div className="cw-body">
        <nav className="cw-tabs" role="tablist" aria-label="Chess World">
          {TABS.map((one) => (
            <button key={one.id} type="button" role="tab" aria-selected={tab === one.id} className="cw-tab" onClick={() => setTab(one.id)}>
              {one.label}
            </button>
          ))}
        </nav>

        <div className="cw-main">
          <section className="cw-boardside" aria-label="Board">
            <Board
              fen={fen}
              orientation={orientation}
              interactive={Boolean(open) && !state.over}
              lastMove={lastMove ? { from: lastMove.uci.slice(0, 2), to: lastMove.uci.slice(2, 4) } : null}
              onMove={onMove}
            />
            <div className="cw-under">
              <Button size="tiny" onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}>Turn the board</Button>
              <div className="cw-nav" role="group" aria-label="Move through the game">
                <Button size="tiny" disabled={!open || here === 0} onClick={() => setPly(0)} aria-label="First move">⏮</Button>
                <Button size="tiny" disabled={!open || here === 0} onClick={() => setPly(here - 1)} aria-label="Previous move">◀</Button>
                <Button size="tiny" disabled={!open || here >= (open?.moves.length ?? 0)} onClick={() => setPly(here + 1)} aria-label="Next move">▶</Button>
                <Button size="tiny" disabled={!open || here >= (open?.moves.length ?? 0)} onClick={() => setPly(open?.moves.length ?? 0)} aria-label="Last move">⏭</Button>
              </div>
              <span className="cw-state">
                {state.over
                  ? state.reason === 'checkmate' ? `Checkmate — ${state.result}` : `Drawn — ${state.reason.replace('-', ' ')}`
                  : `${fen.split(' ')[1] === 'w' ? 'White' : 'Black'} to move${state.check ? ', in check' : ''}`}
              </span>
            </div>
          </section>

          <aside className="cw-panel">
            {tab === 'play' && (
              <div className="cw-pane">
                <h3>Play</h3>
                <p className="cw-engine" role="status">{engineLine}</p>
                {engine?.state !== 'ready' && (
                  <>
                    <p className="cw-faint">
                      Orbis plays through Stockfish, which is a separate free program under its own licence, so it is
                      not part of the Orbis download. It is fetched once, onto this computer, when you ask for it.
                    </p>
                    <Button size="small" disabled={busy} onClick={() => void run(async () => { await window.api.chessEngineInstall() }, 'Setting the engine up.')}>
                      Set up the chess engine
                    </Button>
                  </>
                )}
                <div className="cw-row">
                  <Button
                    size="small"
                    kind="primary"
                    disabled={busy}
                    onClick={() => void run(async () => {
                      const game = await window.api.chessCreate({ source: { kind: 'custom-position' }, meta: { white: { name: 'You' }, black: { name: 'You' } } })
                      setOpenId(game.id)
                      setPly(0)
                      setTab('study')
                    }, 'A new board is ready.')}
                  >
                    New board
                  </Button>
                  <Button size="small" disabled={busy} onClick={() => void run(async () => {
                    const summary = await window.api.chessImportPgn()
                    if (summary) onNotify(`${summary.imported} brought in, ${summary.skippedDuplicates} already here, ${summary.failed.length} could not be read.`)
                  })}>Bring in a PGN file</Button>
                </div>
                <p className="cw-faint">
                  A game against the engine needs the engine. Until it is set up, you can still set up a board, play
                  both sides, bring in games and look through them.
                </p>
              </div>
            )}

            {tab === 'study' && (
              open ? (
                <div className="cw-pane">
                  <h3>{open.meta.white.name ?? 'White'} vs {open.meta.black.name ?? 'Black'}</h3>
                  <p className="cw-faint">{[open.meta.event, open.meta.date, open.meta.result].filter(Boolean).join(' · ')}</p>
                  <ol className="cw-moves" aria-label="Moves">
                    {movePairs(open).map((row) => (
                      <li key={row.number}>
                        <span className="cw-num">{row.number}.</span>
                        {row.white && <button type="button" className={`cw-move${here === row.whitePly ? ' is-now' : ''}`} onClick={() => setPly(row.whitePly ?? 0)}>{row.white.san}</button>}
                        {row.black && <button type="button" className={`cw-move${here === row.blackPly ? ' is-now' : ''}`} onClick={() => setPly(row.blackPly ?? 0)}>{row.black.san}</button>}
                      </li>
                    ))}
                  </ol>
                  {!open.moves.length && <p className="cw-faint">No moves yet. Play one on the board.</p>}
                  <div className="cw-row">
                    <Button size="tiny" disabled={busy} onClick={() => void run(async () => {
                      const path = await window.api.chessExportPgn([open.id])
                      if (path) onNotify(`Saved to ${path}`)
                    })}>Save as PGN</Button>
                    <Button size="tiny" kind="danger" disabled={busy} onClick={() => void run(async () => { await window.api.chessRemove(open.id); setOpenId(null) }, 'Game removed.')}>Remove</Button>
                  </div>
                </div>
              ) : <EmptyState>Nothing is open. Pick a game in the Library, or start a new board in Play.</EmptyState>
            )}

            {tab === 'library' && (
              <div className="cw-pane">
                <h3>Your games</h3>
                {games.length === 0
                  ? <EmptyState>No games yet. Bring in a PGN file, or start a board and play one.</EmptyState>
                  : (
                    <ul className="cw-list">
                      {games.map((game) => (
                        <li key={game.id}>
                          <button type="button" className={`cw-item${game.id === openId ? ' is-open' : ''}`} onClick={() => { setOpenId(game.id); setPly(0); setTab('study') }}>
                            <strong>{game.meta.white.name ?? 'White'} vs {game.meta.black.name ?? 'Black'}</strong>
                            <small>{[game.meta.event, game.meta.date, `${game.moves.length} moves`, game.meta.result].filter(Boolean).join(' · ')}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            )}

            {tab === 'live' && (
              <div className="cw-pane">
                <h3>Live</h3>
                <p className="cw-faint">
                  Following tournaments that are being broadcast publicly is still being built. Nothing is shown here
                  until it comes from a real broadcast.
                </p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </Surface>
  )
}
