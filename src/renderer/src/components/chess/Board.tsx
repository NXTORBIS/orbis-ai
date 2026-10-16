import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyMove, boardSquares, destinationsFrom, needsPromotion, outcome, sideToMove, type ChessMove, type PieceLetter } from '../../../../shared/chess/rules'
import './board.css'

/**
 * The board.
 *
 * It draws the position it is given and asks for moves; it does not decide anything about chess. Every square it
 * offers comes from the rules, so a square that would leave the king in check is never offered, and a move it sends
 * upward has already been checked against this exact position (Sections 031, 037).
 *
 * It can be played with the mouse or the keyboard: arrow keys walk the squares, Enter picks a piece up and puts it
 * down, Escape lets go (Section 272).
 */

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']

/** The pieces, drawn with the standard chess characters so no image files are needed and nothing is licensed. */
const GLYPH: Record<string, string> = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟'
}

const NAMES: Record<PieceLetter, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' }

export interface BoardProps {
  fen: string
  /** Which way up. 'w' puts White at the bottom. */
  orientation?: 'w' | 'b'
  /** False for a game you are only watching, or one that has finished. */
  interactive?: boolean
  /** The move just played, to mark where it came from and went. */
  lastMove?: { from: string; to: string } | null
  /** Called with a move that is already legal in this position. */
  onMove?: (move: ChessMove) => void
  showCoordinates?: boolean
  showLegal?: boolean
  /** Squares to mark, for lessons and puzzles. */
  highlight?: string[]
  label?: string
}

export function Board({
  fen, orientation = 'w', interactive = true, lastMove = null, onMove,
  showCoordinates = true, showLegal = true, highlight = [], label = 'Chess board'
}: BoardProps): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const [cursor, setCursor] = useState('e4')
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null)
  const root = useRef<HTMLDivElement>(null)

  const pieces = useMemo(() => boardSquares(fen), [fen])
  const bySquare = useMemo(() => new Map(pieces.map((p) => [p.square, p])), [pieces])
  const turn = sideToMove(fen)
  const legal = useMemo(() => (selected ? destinationsFrom(fen, selected) : []), [fen, selected])
  const legalTo = useMemo(() => new Set(legal.map((m) => m.to)), [legal])
  const inCheckSquare = useMemo(() => {
    // The king that is attacked, so it can be marked. Asked of the rules, not guessed from the look of the board.
    const state = outcome(fen)
    const inCheck = state.over ? state.reason === 'checkmate' : state.check
    if (!inCheck) return null
    return pieces.find((p) => p.type === 'k' && p.color === turn)?.square ?? null
  }, [pieces, turn, fen])

  // A new position means nothing is held any more.
  useEffect(() => { setSelected(null); setPromotion(null) }, [fen])

  const files = orientation === 'w' ? FILES : [...FILES].reverse()
  const ranks = orientation === 'w' ? RANKS : [...RANKS].reverse()

  const play = useCallback((from: string, to: string, piece?: PieceLetter): void => {
    const made = applyMove(fen, { from, to, ...(piece ? { promotion: piece } : {}) })
    if (!made) return
    setSelected(null)
    setPromotion(null)
    onMove?.(made)
  }, [fen, onMove])

  const choose = useCallback((square: string): void => {
    if (!interactive) return
    const piece = bySquare.get(square)
    if (selected && legalTo.has(square)) {
      if (needsPromotion(fen, selected, square)) { setPromotion({ from: selected, to: square }); return }
      play(selected, square)
      return
    }
    // Picking up one of your own pieces; anything else lets go.
    if (piece && piece.color === turn) setSelected(square === selected ? null : square)
    else setSelected(null)
  }, [interactive, bySquare, selected, legalTo, fen, play, turn])

  const onKey = (e: React.KeyboardEvent): void => {
    const fileIndex = files.indexOf(cursor[0])
    const rankIndex = ranks.indexOf(cursor[1])
    const move = (df: number, dr: number): void => {
      const f = Math.max(0, Math.min(7, fileIndex + df))
      const r = Math.max(0, Math.min(7, rankIndex + dr))
      setCursor(`${files[f]}${ranks[r]}`)
    }
    if (e.key === 'ArrowRight') { e.preventDefault(); move(1, 0) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1, 0) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(0, -1) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(0, 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(cursor) }
    else if (e.key === 'Escape' && selected) { e.preventDefault(); setSelected(null) }
  }

  const describe = (square: string): string => {
    const piece = bySquare.get(square)
    const what = piece ? `${piece.color === 'w' ? 'white' : 'black'} ${NAMES[piece.type]}` : 'empty'
    const extra = [
      selected === square ? 'picked up' : '',
      legalTo.has(square) ? 'can move here' : '',
      lastMove && (lastMove.from === square || lastMove.to === square) ? 'last move' : ''
    ].filter(Boolean).join(', ')
    return `${square}, ${what}${extra ? `, ${extra}` : ''}`
  }

  return (
    <div className="cw-board-wrap">
      <div
        ref={root}
        className={`cw-board${orientation === 'b' ? ' flipped' : ''}`}
        role="grid"
        aria-label={`${label}. ${turn === 'w' ? 'White' : 'Black'} to move.`}
        tabIndex={interactive ? 0 : -1}
        onKeyDown={interactive ? onKey : undefined}
      >
        {ranks.map((rank) => (
          <div className="cw-rank" role="row" key={rank}>
            {files.map((file) => {
              const square = `${file}${rank}`
              const piece = bySquare.get(square)
              const dark = (FILES.indexOf(file) + Number(rank)) % 2 === 0
              const classes = [
                'cw-sq',
                dark ? 'dark' : 'light',
                selected === square ? 'is-selected' : '',
                showLegal && legalTo.has(square) ? (piece ? 'is-target' : 'is-legal') : '',
                lastMove && (lastMove.from === square || lastMove.to === square) ? 'is-last' : '',
                highlight.includes(square) ? 'is-marked' : '',
                inCheckSquare === square ? 'is-check' : '',
                interactive && cursor === square ? 'is-cursor' : ''
              ].filter(Boolean).join(' ')
              return (
                <button
                  type="button"
                  role="gridcell"
                  key={square}
                  className={classes}
                  aria-label={describe(square)}
                  tabIndex={-1}
                  disabled={!interactive}
                  onClick={() => { setCursor(square); choose(square) }}
                >
                  {piece && <span className={`cw-piece ${piece.color}`} aria-hidden="true">{GLYPH[`${piece.color}${piece.type}`]}</span>}
                  {showCoordinates && file === files[0] && <span className="cw-coord rank" aria-hidden="true">{rank}</span>}
                  {showCoordinates && rank === ranks[7] && <span className="cw-coord file" aria-hidden="true">{file}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      {promotion && (
        <div className="cw-promo" role="dialog" aria-label="Choose a piece">
          <p>Make it a</p>
          <div className="cw-promo-row">
            {(['q', 'r', 'b', 'n'] as PieceLetter[]).map((piece) => (
              <button key={piece} type="button" className="cw-promo-btn" onClick={() => play(promotion.from, promotion.to, piece)} aria-label={NAMES[piece]}>
                <span aria-hidden="true">{GLYPH[`${turn}${piece}`]}</span>
                <small>{NAMES[piece]}</small>
              </button>
            ))}
          </div>
          <button type="button" className="cw-promo-cancel" onClick={() => setPromotion(null)}>Cancel</button>
        </div>
      )}
    </div>
  )
}

export default Board
