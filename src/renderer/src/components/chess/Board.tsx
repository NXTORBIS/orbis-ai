import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyMove, boardSquares, destinationsFrom, needsPromotion, outcome, sideToMove, type BoardSquare, type ChessMove, type PieceLetter } from '../../../../shared/chess/rules'
import { barReading, hasFill, topShare } from '../../../../shared/chess/evalBar'
import type { Score } from '../../../../shared/chess/evaluation'
import {
  ARROW_GRID, arrowMark, arrowShape, colourFor, describeMarks, markOn, nextColour, squareMark, toggle,
  type Mark, type MarkColour
} from '../../../../shared/chess/marks'
import { canSetPremove, nextPremove, premoveSquares, type Premove } from '../../../../shared/chess/premove'
import { SLIDE_MS, slidesFor } from '../../../../shared/chess/pieceSlide'
import { Piece } from './pieces'
import './board.css'

/**
 * The board.
 *
 * It draws the position it is given and asks for moves; it does not decide anything about chess. Every square it
 * offers comes from the rules, so a square that would leave the king in check is never offered, and a move it sends
 * upward has already been checked against this exact position (Sections 031, 037).
 *
 * ## How big it is
 *
 * It is as big as it is told to be, and that is a change. It used to size itself -- `width: min(72vh, 100%)` --
 * inside a wrapper that was shrink-to-fit, so the percentage resolved against a box whose width had come from
 * whatever text happened to sit under the board, and it settled at about 357 pixels however large the window got.
 * Now a screen measures the space it has and passes `size`, and the board is exactly that many pixels square.
 * `ChessStage` does the measuring for every area, so no area has to get it right by hand. A board given no `size`
 * fills the width of its parent instead, which is still far better than shrink-to-fit and is what the areas that
 * have not moved to the stage yet get.
 *
 * ## Four ways to move a piece
 *
 * **Click.** Pick up, put down. **Drag.** Hold the piece and let it go on the square you want; the piece follows
 * the pointer and the square under it is ringed. **Keyboard.** Arrow keys walk the squares, Enter picks up and
 * puts down, Escape lets go. **Premove.** While it is the other side's turn, a move you make is held rather than
 * played, and the screen plays it when your turn comes -- after asking the rules again, because a premove is never
 * played without being checked against the position that actually arrived (`premove.ts` holds that rule).
 *
 * ## Three things it does besides drawing the position
 *
 * **Arrows and coloured squares.** Right-drag draws an arrow, right-click colours a square, a held modifier picks
 * the colour, and a plain left click takes them all off again. The board does not keep them: they belong to the
 * position, not to this widget, so they arrive as a prop and a change goes back up to whoever owns the position.
 *
 * **The bar beside the board.** Given a score, the board draws the evaluation strip. A score nothing has worked out
 * is not a bar at the middle -- `evalBar.ts` holds that rule and the refusals round it.
 *
 * **A piece slides to its square.** What slides is worked out by `pieceSlide.ts` from the two positions and the
 * move the board was told about, and it animates nothing at all unless those three agree. A machine asking for
 * less movement gets none: the keyframes are behind `prefers-reduced-motion` in the stylesheet.
 *
 * All of it is additive. A screen that passes none of it gets exactly the board it got before.
 */

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']

/*
 * The pieces used to be the standard chess characters -- `♞`, `♚` -- which needed no files and licensed nothing,
 * and looked like what they were: font glyphs, drawn at whatever weight the computer's font chose, different on
 * every machine. They are shapes now; see `pieces.tsx`, which draws them and says why they are drawn there rather
 * than taken from one of the well-known sets.
 */

const NAMES: Record<PieceLetter, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' }

/** Does this machine want less movement? Watched rather than read once, because it can be changed while running. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof matchMedia !== 'function') return false
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** Where a piece starts from, in squares, as the screen is showing the board. */
interface Step {
  dx: number
  dy: number
}

/** A piece being carried by the pointer: where it came from, where the pointer is, and what is under it. */
interface Lift {
  from: string
  /** Where the pointer is, as a share of the board's width and height, so it needs no pixels. */
  x: number
  y: number
  over: string | null
  /** True once the pointer has travelled far enough that this is a drag and not a click. */
  moved: boolean
}

export interface BoardProps {
  fen: string
  /** Which way up. 'w' puts White at the bottom. */
  orientation?: 'w' | 'b'
  /** False for a game you are only watching, or one that has finished. */
  interactive?: boolean
  /**
   * How many pixels square to draw the board, measured by whoever laid it out. Left out, the board fills the width
   * of its parent -- which is only right when that parent has a width of its own.
   */
  size?: number | null
  /** Put on the wrapper, for an area that needs to place the board in its own grid. */
  className?: string
  /** The move just played, to mark where it came from and went. */
  lastMove?: { from: string; to: string } | null
  /** Called with a move that is already legal in this position. */
  onMove?: (move: ChessMove) => void
  /**
   * Which side the person is playing, when they are playing one of them. It decides one thing only: whether a move
   * made while it is the other side's turn is held as a premove. Left out, there are no premoves.
   */
  you?: 'w' | 'b' | null
  /** The premove being held, drawn on the two squares it is between. */
  premove?: Premove | null
  /** Called when the person sets a premove up or takes it off. Without it the board holds none. */
  onPremove?: (held: Premove | null) => void
  showCoordinates?: boolean
  showLegal?: boolean
  /** Squares to mark, for lessons and puzzles. */
  highlight?: string[]
  /**
   * The arrows and coloured squares drawn on *this* position, which the board draws and does not keep.
   * Whoever owns the position keeps them: by node in a study, by `positionKey(fen)` anywhere else.
   */
  marks?: readonly Mark[]
  /**
   * What is drawn now, after a drawing or a clearing. Without this the board cannot be drawn on at all, which is
   * what every screen that has nowhere to keep a mark gets.
   */
  onMarksChange?: (marks: Mark[]) => void
  /**
   * The engine's score, for the strip beside the board. Null or left out draws no strip, which is how the "bar
   * beside the board" setting is honoured -- a screen whose person has turned it off passes null.
   *
   * `text` is the score written the way that person asked to read it (`formatForSettings`); without it the board
   * writes it plainly.
   */
  evalBar?: { score: Score; text?: string } | null
  label?: string
}

/** How far the pointer has to travel, as a share of one square, before it counts as a drag rather than a click. */
const DRAG_THRESHOLD = 0.18

export function Board({
  fen, orientation = 'w', interactive = true, size = null, className, lastMove = null, onMove,
  you = null, premove = null, onPremove,
  showCoordinates = true, showLegal = true, highlight = [], marks = [], onMarksChange,
  evalBar = null, label = 'Chess board'
}: BoardProps): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const [cursor, setCursor] = useState('e4')
  const [promotion, setPromotion] = useState<{ from: string; to: string; premove?: boolean } | null>(null)
  /** Which colour the keyboard draws in. The mouse takes its colour from what is held down instead. */
  const [colour, setColour] = useState<MarkColour>('green')
  /** The arrow being dragged with the mouse, and the half-finished one the keyboard has started. */
  const [drag, setDrag] = useState<{ from: string; to: string; colour: MarkColour } | null>(null)
  const [arrowFrom, setArrowFrom] = useState<string | null>(null)
  /** The piece being carried by the pointer. */
  const [lift, setLift] = useState<Lift | null>(null)
  /** What to say under the board: a refusal, or what has just changed. */
  const [said, setSaid] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  /** A drag that ended in a move must not also be read as a click on the square it was let go on. */
  const swallowClick = useRef(false)
  const reduced = useReducedMotion()

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

  /** Whether a move made now is held as a premove instead of being played. */
  const premoving = typeof onPremove === 'function' && canSetPremove({ turn, you, playable: interactive })
  /** Whose piece you may pick up: your own while premoving, otherwise whoever is to move. */
  const movingSide = premoving && you !== null ? you : turn
  const premoveMarked = useMemo(() => new Set(premoveSquares(premove)), [premove])

  // A new position means nothing is held any more, and a half-drawn arrow belonged to the position you were on.
  useEffect(() => { setSelected(null); setPromotion(null); setArrowFrom(null); setSaid(null); setLift(null) }, [fen])

  /*
   * How tall the board is, for the strip beside it, kept up to date while the window is resized. Watched rather
   * than read once: a board changes size with the window, with the panel beside it and with the text size, and a
   * strip left at the height the board was when it first appeared would be a bar that does not line up with the
   * board it is reading.
   */
  const wantsBar = evalBar !== null && evalBar !== undefined
  const [boardHeight, setBoardHeight] = useState<number | null>(null)
  useEffect(() => {
    const element = root.current
    if (!wantsBar || !element || typeof ResizeObserver !== 'function') return
    const watch = new ResizeObserver(() => setBoardHeight(element.getBoundingClientRect().height))
    watch.observe(element)
    return () => watch.disconnect()
  }, [wantsBar])

  const files = orientation === 'w' ? FILES : [...FILES].reverse()
  const ranks = orientation === 'w' ? RANKS : [...RANKS].reverse()

  /*
   * What is sliding, worked out the moment the position changes rather than after it has been drawn.
   *
   * A piece that is first painted on its new square and only then told to animate flashes at its destination for
   * one frame and jumps back, which looks worse than not animating at all. React allows exactly this -- setting
   * state while rendering, when a prop has changed -- and re-renders before anything reaches the screen, so the
   * first frame a person sees already has the piece at the square it is coming from.
   */
  const [slide, setSlide] = useState<{ steps: Map<string, Step>; stamp: number } | null>(null)
  const shown = useRef<{ fen: string; pieces: BoardSquare[] } | null>(null)
  if (shown.current === null) {
    shown.current = { fen, pieces }
  } else if (shown.current.fen !== fen) {
    const was = shown.current
    shown.current = { fen, pieces }
    const steps = new Map<string, Step>()
    if (!reduced) {
      // The board's own axes are the screen's: flipping it reverses both, which is the whole of what orientation
      // does to a movement.
      const flip = orientation === 'w' ? 1 : -1
      for (const one of slidesFor(was.pieces, pieces, lastMove)) {
        const dx = (FILES.indexOf(one.from[0]) - FILES.indexOf(one.to[0])) * flip
        const dy = (Number(one.to[1]) - Number(one.from[1])) * flip
        if (dx !== 0 || dy !== 0) steps.set(one.to, { dx, dy })
      }
    }
    setSlide(steps.size > 0 ? { steps, stamp: Date.now() } : null)
  }

  const play = useCallback((from: string, to: string, piece?: PieceLetter): void => {
    const made = applyMove(fen, { from, to, ...(piece ? { promotion: piece } : {}) })
    if (!made) return
    setSelected(null)
    setPromotion(null)
    onMove?.(made)
  }, [fen, onMove])

  /** Hold a move for your turn. The rules are asked again when it is played, not now. */
  const hold = useCallback((from: string, to: string, piece?: PieceLetter): void => {
    if (!onPremove) return
    setSelected(null)
    setPromotion(null)
    const held = nextPremove(premove, from, to, piece)
    onPremove(held)
    setSaid(held === null ? 'Your held move was taken off.' : `${from} to ${to} is held until it is your turn.`)
  }, [onPremove, premove])

  /**
   * Put a piece down on a square, whichever way it was picked up.
   *
   * There are two answers and they are kept apart: while it is the other side's turn the move is *held*, and the
   * rules are not asked at all -- the position it will be played into does not exist yet. On your own turn it is
   * played, which means the rules have already said it is legal.
   */
  const putDown = useCallback((from: string, to: string): boolean => {
    if (premoving) {
      // A pawn going to the far rank still has to be asked about, because there will be nobody to ask later.
      if (bySquare.get(from)?.type === 'p' && (to[1] === '8' || to[1] === '1')) {
        setPromotion({ from, to, premove: true })
        return true
      }
      hold(from, to)
      return true
    }
    if (!legalTo.has(to)) return false
    if (needsPromotion(fen, from, to)) { setPromotion({ from, to }); return true }
    play(from, to)
    return true
  }, [premoving, bySquare, hold, legalTo, fen, play])

  const choose = useCallback((square: string): void => {
    if (!interactive) return
    const piece = bySquare.get(square)
    if (selected && selected !== square && putDown(selected, square)) return
    // Picking up one of your own pieces; anything else lets go.
    if (piece && piece.color === movingSide) setSelected(square === selected ? null : square)
    else setSelected(null)
  }, [interactive, bySquare, selected, putDown, movingSide])

  // ---------------------------------------------------------------- arrows and coloured squares

  /** A board nobody can keep a mark for cannot be drawn on: there would be nowhere for the drawing to go. */
  const canDraw = typeof onMarksChange === 'function'

  const draw = useCallback((mark: Mark | null): void => {
    if (!mark || !onMarksChange) return
    const next = toggle(marks, mark)
    setSaid(next.note)
    if (next.note === null) onMarksChange(next.marks)
  }, [marks, onMarksChange])

  const clearDrawn = useCallback((): void => {
    setArrowFrom(null)
    setSaid(null)
    if (marks.length > 0) onMarksChange?.([])
  }, [marks, onMarksChange])

  /**
   * Where a pointer is on the board, as a share of its width and height.
   *
   * Measured from the board itself rather than from what the pointer landed on, so dragging and drawing work the
   * same whether or not the square under the pointer is a button that can be clicked.
   */
  const spotAt = useCallback((at: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const box = root.current?.getBoundingClientRect()
    if (!box || box.width <= 0 || box.height <= 0) return null
    return { x: (at.clientX - box.left) / box.width, y: (at.clientY - box.top) / box.height }
  }, [])

  const squareAt = useCallback((at: { clientX: number; clientY: number }): string | null => {
    const spot = spotAt(at)
    if (!spot) return null
    const file = Math.floor(spot.x * 8)
    const rank = Math.floor(spot.y * 8)
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null
    return `${files[file]}${ranks[rank]}`
  }, [spotAt, files, ranks])

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button === 2) {
      if (!canDraw) return
      const square = squareAt(e)
      if (!square) return
      e.preventDefault()
      setDrag({ from: square, to: square, colour: colourFor(e) })
      // Held, so the drag survives the pointer leaving the board on its way to the square it points at.
      try { root.current?.setPointerCapture(e.pointerId) } catch { /* a pointer that has already gone */ }
      return
    }
    if (e.button !== 0) return
    // The way a mouse gets rid of a drawing, and the same way every chess site does it.
    if (canDraw && marks.length > 0) clearDrawn()
    if (!interactive) return
    const spot = spotAt(e)
    const square = squareAt(e)
    if (!spot || !square) return
    const piece = bySquare.get(square)
    // Picking a piece up to carry it. A square with nothing of yours on it is a plain click and is left to onClick.
    if (!piece || piece.color !== movingSide) return
    setCursor(square)
    // Picking the piece up here is what lets a drag start without a click first. The click that follows this
    // pointer press is therefore the same act, and is swallowed -- unless the piece was already picked up, in
    // which case the click is somebody putting it back down again.
    swallowClick.current = selected !== square
    setSelected(square)
    setLift({ from: square, x: spot.x, y: spot.y, over: square, moved: false })
    try { root.current?.setPointerCapture(e.pointerId) } catch { /* a pointer that has already gone */ }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (drag) {
      const square = squareAt(e)
      const picked = colourFor(e)
      if (square && (square !== drag.to || picked !== drag.colour)) setDrag({ from: drag.from, to: square, colour: picked })
      return
    }
    if (!lift) return
    const spot = spotAt(e)
    if (!spot) return
    const travelled = Math.hypot(spot.x - lift.x, spot.y - lift.y) * 8
    setLift({
      from: lift.from,
      x: spot.x,
      y: spot.y,
      over: squareAt(e),
      moved: lift.moved || travelled > DRAG_THRESHOLD
    })
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    if (drag) {
      const square = squareAt(e)
      const started = drag.from
      setDrag(null)
      try { root.current?.releasePointerCapture(e.pointerId) } catch { /* already released */ }
      // Let go away from the board and nothing is drawn: it is how a drawing is thought better of halfway through.
      if (!square) return
      const picked = colourFor(e)
      draw(square === started ? squareMark(started, picked) : arrowMark(started, square, picked))
      return
    }
    if (!lift) return
    const carried = lift
    setLift(null)
    try { root.current?.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    const square = squareAt(e)
    // A piece let go where it was picked up, or off the board, goes back. It stays picked up, so the next click
    // can put it down -- which is what makes dragging and clicking one habit rather than two.
    if (!carried.moved || square === null || square === carried.from) return
    swallowClick.current = true
    if (!putDown(carried.from, square)) setSaid(`${carried.from} to ${square} is not a move in this position.`)
  }

  const onKey = (e: React.KeyboardEvent): void => {
    /*
     * A bare key, or one with Shift. The window's own handler does nothing unless Ctrl or Cmd is held, and the
     * native menu owns a dozen Ctrl chords, so Ctrl+M has to go past the board rather than be taken by it -- which
     * is also what the keys sheet says these chords are: `M`, not `Ctrl+M`.
     */
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey
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
    else if (e.key === 'Escape') {
      // A half-drawn arrow goes first: it is the thing most recently started.
      if (arrowFrom) { e.preventDefault(); setArrowFrom(null); setSaid(null) }
      else if (selected) { e.preventDefault(); setSelected(null) }
      else if (premove && onPremove) { e.preventDefault(); onPremove(null); setSaid('Your held move was taken off.') }
    }
    // The keyboard's half of drawing. It has no modifier to hold while it presses a key, so the colour is a
    // standing choice that C walks through.
    else if (canDraw && plain && e.key.toLowerCase() === 'm') { e.preventDefault(); draw(squareMark(cursor, colour)) }
    else if (canDraw && plain && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      const next = nextColour(colour)
      setColour(next)
      setSaid(`Arrows and squares are drawn in ${next} now.`)
    }
    else if (canDraw && plain && e.key.toLowerCase() === 'x') {
      e.preventDefault()
      if (!arrowFrom) { setArrowFrom(cursor); setSaid(null) }
      else if (arrowFrom === cursor) { setArrowFrom(null) }
      else { draw(arrowMark(arrowFrom, cursor, colour)); setArrowFrom(null) }
    }
    else if (canDraw && plain && e.key === 'Delete') { e.preventDefault(); clearDrawn() }
  }

  const describe = (square: string): string => {
    const piece = bySquare.get(square)
    const what = piece ? `${piece.color === 'w' ? 'white' : 'black'} ${NAMES[piece.type]}` : 'empty'
    const drawn = markOn(marks, square)
    const extra = [
      selected === square ? 'picked up' : '',
      legalTo.has(square) ? (piece ? 'can be taken' : 'can move here') : '',
      lastMove && (lastMove.from === square || lastMove.to === square) ? 'last move' : '',
      premoveMarked.has(square) ? 'your held move' : '',
      // Both of these are a colour on the screen and nothing else, so each one is said as well (Section 271).
      inCheckSquare === square ? 'in check' : '',
      highlight.includes(square) ? 'marked' : '',
      drawn ? `you have marked this ${drawn.colour}` : '',
      arrowFrom === square ? 'an arrow starts here' : ''
    ].filter(Boolean).join(', ')
    return `${square}, ${what}${extra ? `, ${extra}` : ''}`
  }

  // What is drawn, as a line under the board: a refusal first, then a half-drawn arrow, then what is there.
  const list = marks.length <= 3 ? describeMarks(marks) : `${marks.length} arrows and squares are drawn here. Delete takes them off.`
  const note = said
    ?? (arrowFrom ? `An arrow from ${arrowFrom}. Press X on the square it points at, or Escape to drop it.` : (canDraw ? list : null))

  const bar = evalBar ? barReading(evalBar.score, { text: evalBar.text, toMove: turn }) : null
  const drawnArrows = useMemo(
    () => marks.flatMap((one) => {
      if (one.kind !== 'arrow') return []
      const shape = arrowShape(one, files, ranks)
      return shape ? [shape] : []
    }),
    [marks, files, ranks]
  )
  /*
   * The arrow being dragged, drawn while the mouse is still down and in the colour whatever is held down now means.
   * It is kept apart from the marks on purpose: it is not one of them until the pointer comes up, so letting go
   * outside the board leaves nothing behind.
   */
  const preview = useMemo(() => {
    if (!drag) return null
    const made = arrowMark(drag.from, drag.to, drag.colour)
    return made ? arrowShape(made, files, ranks) : null
  }, [drag, files, ranks])

  /*
   * The arrows sit over the squares in their own layer, measured in squares rather than pixels: eight by eight,
   * whatever size the board is on the screen. It is inside the board and taken out of the flow, so it covers
   * exactly the squares and cannot pull the grid about; it takes no pointer events, so a drawing never gets in the
   * way of a move; and it is hidden from a screen reader, because a picture inside a grid of squares is not
   * something a reader can make sense of. The line under the board says the same thing in words.
   */
  const overlay = (drawnArrows.length > 0 || preview) && (
    <svg className="cw-drawn-arrows" viewBox={`0 0 ${ARROW_GRID} ${ARROW_GRID}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {[...drawnArrows, ...(preview ? [preview] : [])].map((one, index) => (
        <g key={`${one.start.x},${one.start.y}-${one.head[0].x},${one.head[0].y}-${index}`} className={`cw-arrow is-${one.colour}`}>
          {/* A path, not a line: a knight's arrow bends, so the shaft is two legs and a corner. */}
          <polyline points={one.shaft.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" />
          <polygon points={one.head.map((point) => `${point.x},${point.y}`).join(' ')} />
        </g>
      ))}
    </svg>
  )

  const carried = lift && lift.moved ? bySquare.get(lift.from) ?? null : null

  const board = (
    <div
      ref={root}
      className={`cw-board${orientation === 'b' ? ' flipped' : ''}${canDraw ? ' can-draw' : ''}${lift ? ' is-lifting' : ''}`}
      role="grid"
      aria-label={`${label}. ${turn === 'w' ? 'White' : 'Black'} to move.`}
      tabIndex={interactive ? 0 : -1}
      style={size === null ? undefined : { width: `${size}px`, height: `${size}px` }}
      onKeyDown={interactive ? onKey : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { setDrag(null); setLift(null) }}
      onContextMenu={canDraw ? (e) => e.preventDefault() : undefined}
    >
      {ranks.map((rank) => (
        <div className="cw-rank" role="row" key={rank}>
          {files.map((file) => {
            const square = `${file}${rank}`
            const piece = bySquare.get(square)
            const dark = (FILES.indexOf(file) + Number(rank)) % 2 === 0
            const drawn = markOn(marks, square)
            const step = slide?.steps.get(square)
            const hidden = carried !== null && lift !== null && lift.from === square
            const classes = [
              'cw-sq',
              dark ? 'dark' : 'light',
              selected === square ? 'is-selected' : '',
              showLegal && legalTo.has(square) ? (piece ? 'is-target' : 'is-legal') : '',
              lastMove && (lastMove.from === square || lastMove.to === square) ? 'is-last' : '',
              premoveMarked.has(square) ? 'is-premove' : '',
              highlight.includes(square) ? 'is-marked' : '',
              inCheckSquare === square ? 'is-check' : '',
              carried !== null && lift?.over === square ? 'is-over' : '',
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
                onClick={() => {
                  // A drag that ended in a move already put the piece down; the click that follows is the same act.
                  if (swallowClick.current) { swallowClick.current = false; return }
                  setCursor(square)
                  choose(square)
                }}
              >
                {/* A square somebody has coloured. The ring's pattern says which colour it is without the colour. */}
                {drawn && <span className={`cw-drawn-sq is-${drawn.colour}`} aria-hidden="true" />}
                {/* Where an arrow has been started from with the keyboard, waiting for the square it points at.
                    It is a child rather than a class on the square, because the ring that says where the keyboard
                    cursor is takes over the square's outline and its shadow entirely. */}
                {arrowFrom === square && <span className="cw-drawn-start" aria-hidden="true" />}
                {/*
                  * A piece on its way to this square travels in a wrapper that fills the square exactly, so the
                  * piece inside is drawn at precisely the size it always is -- `Piece`'s own `style` prop is how
                  * heavily it is outlined, not a place to put a transform. The key carries the move's stamp, which
                  * is what makes the next move's slide start again rather than being the same animation still
                  * running.
                  */}
                {piece && !hidden && step && (
                  <span
                    key={`slide-${slide?.stamp}`}
                    className="cw-slider"
                    style={{ '--cw-dx': String(step.dx), '--cw-dy': String(step.dy), '--cw-slide': `${SLIDE_MS}ms` } as React.CSSProperties}
                  >
                    <Piece color={piece.color} type={piece.type} className="cw-piece" />
                  </span>
                )}
                {piece && !hidden && !step && <Piece color={piece.color} type={piece.type} className="cw-piece" />}
                {inCheckSquare === square && <span className="cw-check-badge" aria-hidden="true">+</span>}
                {showCoordinates && file === files[0] && <span className="cw-coord rank" aria-hidden="true">{rank}</span>}
                {showCoordinates && rank === ranks[7] && <span className="cw-coord file" aria-hidden="true">{file}</span>}
              </button>
            )
          })}
        </div>
      ))}
      {overlay}
      {/*
        * The piece in your hand. It is placed where the pointer is as a share of the board rather than in pixels,
        * so it follows the pointer at any board size and needs no measurement of its own, and it takes no pointer
        * events so the square under it is still the square the pointer is over.
        */}
      {carried && lift && (
        <span
          className="cw-carried"
          style={{ left: `${lift.x * 100}%`, top: `${lift.y * 100}%` }}
          aria-hidden="true"
        >
          <Piece color={carried.color} type={carried.type} className="cw-piece" />
        </span>
      )}
    </div>
  )

  /*
   * The strip stands beside the board and is given the board's own height.
   *
   * The height is the one measurement in this component that CSS could not produce: the strip cannot be as tall as
   * the wrapper -- the wrapper is as tall as the board *and* the line of words under it, and a bar 4% taller than
   * the board it belongs to is a bar reading 4% wrong -- and it cannot be a child of the board, which clips what it
   * draws to its own rounded corners.
   */
  const strip = bar && (
    <div
      className={`cw-board-eval${orientation === 'b' ? ' flipped' : ''}${hasFill(bar) ? '' : ' is-unknown'}`}
      role="img"
      aria-label={bar.say}
      title={bar.say}
      style={boardHeight === null ? undefined : { height: `${boardHeight}px`, bottom: 'auto' }}
    >
      {hasFill(bar) && <span className="cw-board-eval-top" style={{ height: `${topShare(bar, orientation)}%` }} />}
      {/* The number as well as the picture: a filled strip is a length and a colour, and neither is readable by
          somebody who cannot see them (Sections 271, 275). */}
      <span className="cw-board-eval-text">{bar.shown}</span>
    </div>
  )

  return (
    <div className={`cw-board-wrap${bar ? ' has-eval' : ''}${size === null ? '' : ' is-sized'}${className ? ` ${className}` : ''}`}>
      {strip}
      {board}
      {note && <p className="cw-board-note">{note}</p>}
      {promotion && (
        <div className="cw-promo" role="dialog" aria-label="Choose a piece">
          <p>{promotion.premove ? 'Make it a, when the move is played' : 'Make it a'}</p>
          <div className="cw-promo-row">
            {(['q', 'r', 'b', 'n'] as PieceLetter[]).map((piece) => (
              <button
                key={piece}
                type="button"
                className="cw-promo-btn"
                onClick={() => (promotion.premove ? hold(promotion.from, promotion.to, piece) : play(promotion.from, promotion.to, piece))}
                aria-label={NAMES[piece]}
              >
                <Piece color={promotion.premove && you !== null ? you : turn} type={piece} className="cw-promo-piece" />
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
