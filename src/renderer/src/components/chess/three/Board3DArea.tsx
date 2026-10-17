import { useMemo, useState } from 'react'
import { Button, EmptyState } from '../../../ui'
import { Board } from '../Board'
import { Board3D } from './Board3D'
import type { Diagnostic, Route } from './support'
import { START_FEN, outcome, type ChessMove } from '../../../../../shared/chess/rules'
import { fenAt, movePairs, type StoredGame } from '../../../../../shared/chess/model'
import './board3d.css'
import { useSurface } from '../../../lib/surfaces'
import { simpleAreaSurface } from '../chessSurfaces'
import { FirstIcon, LastIcon, NextIcon, PrevIcon } from '../icons'

/**
 * The 3D board, and the way to it.
 *
 * `Board3D` and the ten modules under `three/` were written, tested nine ways, and imported by nothing: the 3D board
 * had never been drawn on screen once. This is its home. It is deliberately a small screen -- a board, a way through
 * the moves of whatever is open, and the switch back to the flat board -- because the 3D view is an extra and must
 * never be the only way to see a position. `Board3D` says so itself and carries the switch for exactly this reason.
 *
 * Nothing here decides anything about chess. Which squares a piece may go to, and whether a game is over, both come
 * from `rules.ts`, the same module the flat board asks, so the two boards cannot disagree.
 */

export interface Board3DAreaProps {
  /** The game to show, when one is open. With none, the board sits at the starting position and takes moves. */
  game: StoredGame | null
  onNotify?: (text: string) => void
}

export function Board3DArea({ game, onNotify }: Board3DAreaProps): React.JSX.Element {
  const [route, setRoute] = useState<Route>('3d')
  const [orientation, setOrientation] = useState<'w' | 'b'>('w')
  const [ply, setPly] = useState(0)
  const [loose, setLoose] = useState<ChessMove[]>([])
  const [seen, setSeen] = useState<Diagnostic | null>(null)

  // Never point past the moves that really exist.
  const here = game ? Math.max(0, Math.min(ply, game.moves.length)) : loose.length
  const fen = game ? fenAt(game, here) : (loose.length ? loose[loose.length - 1].after : START_FEN)
  const played = game ? game.moves.slice(0, here).map((m) => m.san) : loose.map((m) => m.san)
  const state = useMemo(() => outcome(fen, played), [fen, played])
  const last = game
    ? (here > 0 ? game.moves[here - 1] : null)
    : (loose.length ? loose[loose.length - 1] : null)
  const lastMove = last ? { from: last.uci.slice(0, 2), to: last.uci.slice(2, 4) } : null

  /** A move on the board. With a game open the board is for looking, so a move is only taken on a loose board. */
  const onMove = (move: ChessMove): void => {
    if (game) return
    setLoose((moves) => [...moves, move])
  }

  const shared = {
    fen,
    orientation,
    interactive: !game && !state.over,
    lastMove,
    onMove,
    label: game ? `${game.meta.white.name ?? 'White'} against ${game.meta.black.name ?? 'Black'}` : 'A board to play with'
  }

  /*
   * What Orbis itself may do here: which board is drawn, which way up it is, and where in the game it stands.
   */
  useSurface(
    simpleAreaSurface({
      id: 'board3d',
      name: 'Board in 3D',
      about: 'The same board, drawn in three dimensions, with the flat one always one press away.',
      keywords: ['3d', 'three dimensions', 'board', 'view'],
      controls: {
        view: {
          name: 'Which board',
          spec: { type: 'string', description: '3d is the board drawn in three dimensions; flat is the ordinary one.', enum: ['3d', 'flat'] },
          get: () => route,
          set: (value) => setRoute(String(value) === 'flat' ? 'flat' : '3d'),
          default: '3d'
        },
        orientation: {
          name: 'Which way up the board is',
          spec: { type: 'string', description: 'Whose pieces are at the bottom: w or b.', enum: ['w', 'b'] },
          get: () => orientation,
          set: (value) => setOrientation(String(value) === 'b' ? 'b' : 'w')
        },
        move: {
          name: 'Move',
          spec: { type: 'integer', description: 'How far through the open game the board stands, counted in single moves.', min: 0 },
          get: () => here,
          set: (value) => setPly(Number(value)),
          writable: () => (game ? true : 'No game is open, so there are no moves to step through. Open one from the Library first.')
        }
      },
      state: () => ({ view: route, move: here, moves: game ? game.moves.length : loose.length, game: game ? game.id : null, over: state.over })
    })
  )

  return (
    <div className="cw-3da-area">
      <header className="cw-3da-head">
        <h3 className="cw-3da-title">{game ? shared.label : 'The board in three dimensions'}</h3>
        <p className="cw-3da-meta">
          {game
            ? 'Looking through a game. Use the arrows below.'
            : 'Nothing is open, so this board is yours to push pieces around on. Open a game in the Library to look through one here.'}
        </p>
      </header>

      <div className="cw-3da-stage">
        {route === '3d'
          ? <Board3D {...shared} view={route} onViewChange={setRoute} onDiagnostic={setSeen} />
          : (
              <div className="cw-3da-flat">
                <Board fen={shared.fen} orientation={orientation} interactive={shared.interactive} lastMove={lastMove} onMove={onMove} />
                <Button size="tiny" onClick={() => setRoute('3d')}>Back to the 3D board</Button>
              </div>
            )}
      </div>

      <div className="cw-3da-under">
        <Button size="tiny" onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}>Turn the board</Button>
        {game && (
          <div className="cw-3da-nav" role="group" aria-label="Move through the game">
            <Button size="tiny" disabled={here === 0} onClick={() => setPly(0)} aria-label="First move"><FirstIcon /></Button>
            <Button size="tiny" disabled={here === 0} onClick={() => setPly(here - 1)} aria-label="Previous move"><PrevIcon /></Button>
            <Button size="tiny" disabled={here >= game.moves.length} onClick={() => setPly(here + 1)} aria-label="Next move"><NextIcon /></Button>
            <Button size="tiny" disabled={here >= game.moves.length} onClick={() => setPly(game.moves.length)} aria-label="Last move"><LastIcon /></Button>
          </div>
        )}
        {!game && loose.length > 0 && (
          <Button size="tiny" onClick={() => { setLoose([]); onNotify?.('The board is back to the start.') }}>Start again</Button>
        )}
        <span className="cw-3da-state" role="status">
          {state.over
            ? state.reason === 'checkmate' ? `Checkmate — ${state.result}` : `Drawn — ${state.reason.replace(/-/g, ' ')}`
            : `${fen.split(' ')[1] === 'w' ? 'White' : 'Black'} to move${state.check ? ', in check' : ''}`}
        </span>
      </div>

      {game && game.moves.length > 0 && (
        <ol className="cw-3da-moves" aria-label="Moves">
          {movePairs(game).map((row) => (
            <li key={row.number}>
              <span className="cw-3da-num">{row.number}.</span>
              {row.white && (
                <button type="button" className={`cw-3da-move${here === row.whitePly ? ' is-now' : ''}`} onClick={() => setPly(row.whitePly ?? 0)}>
                  {row.white.san}
                </button>
              )}
              {row.black && (
                <button type="button" className={`cw-3da-move${here === row.blackPly ? ' is-now' : ''}`} onClick={() => setPly(row.blackPly ?? 0)}>
                  {row.black.san}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      {game && game.moves.length === 0 && <EmptyState>This game has no moves saved yet.</EmptyState>}

      {/* What really happened, counted by the view itself rather than claimed here. */}
      {seen && (
        <p className="cw-3da-diag">
          {seen.route === 'flat'
            ? 'The 3D board could not be drawn on this computer, so the flat board is being shown instead.'
            : `Drawing with ${seen.api === 'webgl2' ? 'WebGL 2' : 'WebGL'}: ${seen.meshes} shapes, ${seen.triangles.toLocaleString()} triangles, ${seen.frames.toLocaleString()} frames so far.`}
          {seen.trouble !== 'none' && ` Reported: ${seen.trouble.replace(/-/g, ' ')}.`}
        </p>
      )}
    </div>
  )
}
