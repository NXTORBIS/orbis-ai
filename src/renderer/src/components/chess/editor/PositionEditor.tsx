import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Field } from '../../../ui'
import { copyText } from '../../../lib/utils'
import type { NoticeKind } from '../../../lib/notices'
import { Board } from '../Board'
import { START_FEN } from '../../../../../shared/chess/rules'
import type { StoredGame } from '../../../../../shared/chess/model'
import type { Side } from '../../../../../shared/chess/evaluation'
import {
  CASTLING_FLAGS, clearBoard, draftToFen, emptyDraft, inspectPosition, mirrorDraft, movePiece, placePiece, readFen,
  startDraft, withCastling, withClocks, withEnPassant, withTurn,
  type CastlingFlag, type PositionDraft
} from '../../../../../shared/chess/variants'
import { useSurface } from '../../../lib/surfaces'
import { editorSurface } from '../chessSurfaces'
import { PiecePalette, PIECE_NAME, SIDE_NAME, type EditorTool } from './PiecePalette'
import { Piece } from '../pieces'
import { PositionReport } from './PositionReport'
import { VariantNotice } from './VariantNotice'
import './editor.css'

/**
 * Setting a position up by hand.
 *
 * ## The board is the board
 *
 * `Board.tsx` draws the squares, the colours, the coordinates and the marks, exactly as it does everywhere else in
 * Chess World. It is handed an empty board here and the men are drawn in a layer over it, for one reason: the board
 * only offers legal moves, and an editor exists to put a king on a square no move could ever reach. So the squares
 * come from the board and the clicks and the men come from this layer. There is no second board, no second idea of
 * which corner is a1, and no second set of rules -- whether the result is a position at all is asked of
 * `shared/chess/variants.ts`, which asks `rules.ts`.
 *
 * ## Nothing is inferred and nothing is fixed
 *
 * The side to move, the castling rights, the en passant square and both clocks are whatever the person set. Orbis
 * never works them out from where the pieces stand: a rook on h1 is not permission to castle, and a pawn on e4 is not
 * evidence that it moved there last. When what has been set contradicts the board, the editor says exactly which part
 * contradicts which -- and leaves it alone. A position that has been quietly corrected is a position nobody asked
 * for, and the correction is invisible afterwards.
 *
 * ## Two kinds of wrong
 *
 * "Not a chess position" and "a position no game could have reached" are kept apart everywhere, because the second is
 * the normal state of a composed study and must not look like a fault. Only the first stops a position being opened.
 */

/**
 * What the underlying board is drawn from.
 *
 * It will not load -- a position needs a king each -- which is exactly what is wanted: `boardSquares` gives nothing
 * back, the board draws sixty-four empty squares, and every man on screen is one this editor put there.
 */
const EMPTY_BOARD = '8/8/8/8/8/8/8/8 w - - 0 1'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']

const CASTLING_LABEL: Record<CastlingFlag, string> = {
  K: 'White, king’s side (O-O)',
  Q: 'White, queen’s side (O-O-O)',
  k: 'Black, king’s side (O-O)',
  q: 'Black, queen’s side (O-O-O)'
}

/** The electron wrapper around an error message says nothing a person needs; the message inside it does. */
const plainly = (err: unknown): string =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : 'That did not work.'

/**
 * The position the editor opens on.
 *
 * A FEN that cannot be read gives the opening position rather than half a board, and the box shows what is really on
 * the board from the first frame -- it is not filled in afterwards, because a box that starts empty and fills itself
 * looks like something loading.
 */
function openingDraft(initialFen: string | undefined): PositionDraft {
  if (!initialFen) return startDraft()
  const reading = readFen(initialFen)
  return reading.ok ? reading.draft : startDraft()
}

export interface PositionEditorProps {
  /** Where to start from. The opening position when nothing is given. */
  initialFen?: string
  /** Handed the game Orbis made, once a position has been opened for study. */
  onOpened?: (game: StoredGame) => void
  onNotify?: (text: string, kind?: NoticeKind) => void
}

export function PositionEditor({ initialFen, onOpened, onNotify }: PositionEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState<PositionDraft>(() => openingDraft(initialFen))
  const [past, setPast] = useState<PositionDraft[]>([])
  const [future, setFuture] = useState<PositionDraft[]>([])
  const [tool, setTool] = useState<EditorTool>({ kind: 'move' })
  const [holding, setHolding] = useState<string | null>(null)
  const [cursor, setCursor] = useState('e4')
  const [orientation, setOrientation] = useState<Side>('w')
  const [fenText, setFenText] = useState(() => draftToFen(openingDraft(initialFen)))
  const [reading, setReading] = useState<readonly string[]>([])
  const [readProblem, setReadProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const fen = useMemo(() => draftToFen(draft), [draft])
  const look = useMemo(() => inspectPosition(fen), [fen])
  const at = useMemo(() => new Map(draft.pieces.map((one) => [one.square, one])), [draft.pieces])
  const marked = useMemo(() => [...new Set(look.faults.flatMap((one) => one.squares))], [look.faults])

  // The box always shows the position as it now stands. Editing the board is a reason to refresh it; typing in the box
  // changes nothing until it is read, which is why reading is a button and not an afterthought.
  useEffect(() => { setFenText(fen) }, [fen])

  /** Every change goes through here, so undo is simply the list of positions this one came from. */
  const edit = useCallback((next: PositionDraft): void => {
    if (draftToFen(next) === fen) return
    setPast((before) => [...before.slice(-119), draft])
    setFuture([])
    setReading([])
    setDraft(next)
  }, [draft, fen])

  const undo = (): void => {
    if (!past.length) return
    setFuture([draft, ...future].slice(0, 120))
    setDraft(past[past.length - 1])
    setPast(past.slice(0, -1))
    setHolding(null)
  }

  const redo = (): void => {
    if (!future.length) return
    setPast([...past.slice(-119), draft])
    setDraft(future[0])
    setFuture(future.slice(1))
    setHolding(null)
  }

  const onSquare = (square: string): void => {
    if (tool.kind === 'erase') { edit(placePiece(draft, square, null)); return }
    if (tool.kind === 'piece') { edit(placePiece(draft, square, { type: tool.type, color: tool.color })); return }
    // The hand: pick a man up, put him down anywhere at all. No rule is consulted, which is the point.
    if (holding === null) { if (at.has(square)) setHolding(square); return }
    if (holding === square) { setHolding(null); return }
    edit(movePiece(draft, holding, square))
    setHolding(null)
  }

  const files = orientation === 'w' ? FILES : [...FILES].reverse()
  const ranks = orientation === 'w' ? RANKS : [...RANKS].reverse()

  const onKey = (event: React.KeyboardEvent): void => {
    // Worked out from where the cursor was a moment ago rather than from where this render thinks it is: holding an
    // arrow key down sends several presses before anything is drawn, and every one of them has to count.
    const step = (df: number, dr: number): void => {
      setCursor((was) => {
        const f = Math.max(0, Math.min(7, files.indexOf(was[0]) + df))
        const r = Math.max(0, Math.min(7, ranks.indexOf(was[1]) + dr))
        return `${files[f]}${ranks[r]}`
      })
    }
    if (event.key === 'ArrowRight') { event.preventDefault(); step(1, 0) }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1, 0) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); step(0, -1) }
    else if (event.key === 'ArrowDown') { event.preventDefault(); step(0, 1) }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSquare(cursor) }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); edit(placePiece(draft, cursor, null)) }
    else if (event.key === 'Escape' && holding) { event.preventDefault(); setHolding(null) }
  }

  const describe = (square: string): string => {
    const man = at.get(square)
    const what = man ? `${SIDE_NAME[man.color].toLowerCase()} ${PIECE_NAME[man.type]}` : 'empty'
    const extra = [
      holding === square ? 'picked up' : '',
      marked.includes(square) ? 'marked, something is wrong here' : ''
    ].filter((one) => one !== '').join(', ')
    return `${square}, ${what}${extra ? `, ${extra}` : ''}`
  }

  /**
   * Reads a position out of text and puts it on the board.
   *
   * The button hands it what is in the box; Orbis hands it a position directly. One function either way, so there is
   * one answer to "is that a position" and one place the board is changed from text.
   */
  const readText = (text: string): { ok: boolean; reason?: string; notes: readonly string[] } => {
    const result = readFen(text)
    if (!result.ok) {
      // The board is left exactly as it was. Half a position is worse than none.
      const reason = result.reason ?? 'That is not a position.'
      setReadProblem(reason)
      setReading([])
      return { ok: false, reason, notes: [] }
    }
    setReadProblem(null)
    setPast((before) => [...before.slice(-119), draft])
    setFuture([])
    setDraft(result.draft)
    setHolding(null)
    setReading(result.notes)
    setFenText(text)
    return { ok: true, notes: result.notes }
  }

  const read = (): void => void readText(fenText)

  const canCreate = typeof window.api?.chessCreate === 'function'

  const openForStudy = async (): Promise<StoredGame> => {
    if (!look.legal) throw new Error(`This is not a chess position yet. ${look.faults.map((one) => one.message).join(' ')}`)
    if (!canCreate) throw new Error('This copy of Orbis has no way to store a game, so the position cannot be opened. Copying it as text still works.')
    setBusy(true)
    try {
      const game = await window.api.chessCreate({
        source: { kind: 'custom-position' },
        startFen: fen,
        variant: 'standard'
      })
      if (!game) throw new Error('Orbis did not make anything for that position.')
      /*
       * The position is checked on the way back, not assumed.
       *
       * The channel that stores a game drops a starting position it cannot load and uses the ordinary one instead. If
       * that ever happened to a position this editor judged legal, the person would be looking at a board they did not
       * build, so it is said rather than shown.
       */
      if (game.startFen !== fen) {
        throw new Error(
          'Orbis stored a game, but with the ordinary starting position rather than the one you built. Nothing here has changed; the new game is in your Library if you want to remove it.'
        )
      }
      onNotify?.('The position is open for study.')
      onOpened?.(game)
      return game
    } finally {
      setBusy(false)
    }
  }

  /** The tools, as their names in a path: the hand, the rubber, and a colour and a kind for a man. */
  const PIECE_LETTERS = ['k', 'q', 'r', 'b', 'n', 'p'] as const
  const toolFor = (id: string): EditorTool | null => {
    if (id === 'move') return { kind: 'move' }
    if (id === 'erase') return { kind: 'erase' }
    const colour = id[0] === 'w' ? 'w' : id[0] === 'b' ? 'b' : null
    const letter = PIECE_LETTERS.find((one) => one === id.slice(1))
    return colour && letter ? { kind: 'piece', type: letter, color: colour } : null
  }
  const toolId = (one: EditorTool): string => (one.kind === 'piece' ? `${one.color}${one.type}` : one.kind)

  /*
   * What Orbis itself may do here.
   *
   * Every setter below is the function a click on this screen already calls, through the same `edit` that keeps the
   * undo list: setting the position reads it the way the Read button does, and putting a man on a square is the same
   * `placePiece` a click with a piece tool in hand does. Nothing here works anything out from the board -- the side
   * to move, the castling rights and the en passant square are set, exactly as the panel says.
   */
  useSurface(
    editorSurface({
      fen: () => fen,
      setFen: (text) => {
        const got = readText(text)
        if (!got.ok) throw new Error(got.reason ?? 'That is not a position.')
      },
      look: () => ({ legal: look.legal, faults: look.faults.map((one) => ({ kind: one.kind, says: one.message })), unreachable: look.unreachable.map((one) => one.message) }),
      turn: () => draft.turn,
      setTurn: (side) => edit(withTurn(draft, side)),
      castling: () => draft.castling,
      setCastling: (flags) => {
        let next = draft
        for (const flag of CASTLING_FLAGS) next = withCastling(next, flag, flags.includes(flag))
        edit(next)
      },
      enPassant: () => draft.enPassant,
      setEnPassant: (square) => edit(withEnPassant(draft, square)),
      halfmove: () => draft.halfmove,
      fullmove: () => draft.fullmove,
      setClocks: (halfmove, fullmove) => edit(withClocks(draft, halfmove, fullmove)),
      tool: () => toolId(tool),
      setTool: (id) => {
        const next = toolFor(id)
        if (!next) throw new Error(`There is no tool called “${id}”.`)
        setTool(next)
        setHolding(null)
      },
      orientation: () => orientation,
      setOrientation,
      place: (square, piece) => {
        if (!/^[a-h][1-8]$/.test(square)) throw new Error(`“${square}” is not a square on the board.`)
        if (piece === null) {
          edit(placePiece(draft, square, null))
          return
        }
        const man = toolFor(piece)
        if (!man || man.kind !== 'piece') throw new Error(`“${piece}” is not a piece. Say a colour and a kind, as in "wk" or "bp".`)
        edit(placePiece(draft, square, { type: man.type, color: man.color }))
      },
      openingPosition: () => edit(startDraft()),
      clearBoard: () => edit(clearBoard(draft)),
      swapColours: () => edit(mirrorDraft(draft)),
      undo,
      canUndo: () => past.length > 0,
      redo,
      canRedo: () => future.length > 0,
      openForStudy: async () => {
        const game = await openForStudy()
        return { id: game.id, startFen: game.startFen }
      },
      whyNotStore: () =>
        !look.legal
          ? `This is not a chess position yet, so it cannot be stored. ${look.faults.map((one) => one.message).join(' ')}`
          : !canCreate
            ? 'This copy of Orbis has no way to store a game. Copying the position as text still works.'
            : null
    })
  )

  const copy = async (): Promise<void> => {
    await copyText(fen)
    onNotify?.(look.legal ? 'The position has been copied.' : 'The position has been copied, as it stands.')
  }

  const castlingProblem = look.faults.some((one) => one.kind === 'castling-king' || one.kind === 'castling-rook')
  const enPassantProblem = look.faults.some((one) => one.kind.startsWith('en-passant'))

  return (
    <div className="cw-ed-view">
      <div className="cw-ed-main">
        <section className="cw-ed-boardside" aria-label="The position">
          <div className="cw-ed-stage">
            {/*
              * Drawn, not announced. The squares underneath come from the board everything else in Chess World uses;
              * the grid over them is the one that holds the men and answers to the keyboard, so only that one has a
              * name for anything listening.
              */}
            <div className="cw-ed-under" aria-hidden="true">
              <Board
                fen={EMPTY_BOARD}
                orientation={orientation}
                interactive={false}
                showLegal={false}
                showCoordinates
                highlight={marked}
                label="Board"
              />
            </div>
            <div
              className="cw-ed-squares"
              role="grid"
              aria-label={`Position being set up. ${SIDE_NAME[look.turn]} to move.`}
              onKeyDown={onKey}
            >
              {ranks.map((rank) => (
                <div className="cw-ed-rank" role="row" key={rank}>
                  {files.map((file) => {
                    const square = `${file}${rank}`
                    const man = at.get(square)
                    const classes = [
                      'cw-ed-sq',
                      holding === square ? 'is-held' : '',
                      cursor === square ? 'is-cursor' : ''
                    ].filter((one) => one !== '').join(' ')
                    return (
                      <button
                        type="button"
                        role="gridcell"
                        key={square}
                        className={classes}
                        aria-label={describe(square)}
                        tabIndex={cursor === square ? 0 : -1}
                        onFocus={() => setCursor(square)}
                        onClick={() => { setCursor(square); onSquare(square) }}
                        onContextMenu={(event) => { event.preventDefault(); setCursor(square); edit(placePiece(draft, square, null)) }}
                      >
                        {man && <Piece color={man.color} type={man.type} className="cw-ed-man" />}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="cw-ed-under-board">
            <Button size="tiny" onClick={() => setOrientation((was) => (was === 'w' ? 'b' : 'w'))}>Turn the board</Button>
            <Button size="tiny" disabled={!past.length} onClick={undo}>Undo</Button>
            <Button size="tiny" disabled={!future.length} onClick={redo}>Redo</Button>
            <Button size="tiny" onClick={() => edit(startDraft())}>Opening position</Button>
            <Button size="tiny" onClick={() => edit(clearBoard(draft))}>Clear the board</Button>
            <Button size="tiny" onClick={() => edit(emptyDraft())}>Start again</Button>
            <Button size="tiny" onClick={() => edit(mirrorDraft(draft))}>Swap the colours</Button>
          </div>

          <PiecePalette tool={tool} onPick={(next) => { setTool(next); setHolding(null) }} />
        </section>

        <aside className="cw-ed-panel">
          <fieldset className="cw-ed-group">
            <legend className="cw-ed-label">Side to move</legend>
            <div className="cw-ed-row">
              {(['w', 'b'] as Side[]).map((side) => (
                <label key={side} className="cw-ed-check">
                  <input
                    type="radio"
                    name="cw-ed-turn"
                    checked={draft.turn === side}
                    onChange={() => edit(withTurn(draft, side))}
                  />
                  {SIDE_NAME[side]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="cw-ed-group">
            <legend className="cw-ed-label">Castling rights</legend>
            <div className="cw-ed-column">
              {CASTLING_FLAGS.map((flag) => (
                <label key={flag} className="cw-ed-check">
                  <input
                    type="checkbox"
                    checked={draft.castling.includes(flag)}
                    onChange={(event) => edit(withCastling(draft, flag, event.target.checked))}
                  />
                  {CASTLING_LABEL[flag]}
                </label>
              ))}
            </div>
            <p className={`cw-ed-note${castlingProblem ? ' is-wrong' : ''}`}>
              {castlingProblem
                ? 'These rights do not match the board. The reason is below; nothing has been changed for you.'
                : 'Set by you, never worked out from where the rooks are standing.'}
            </p>
          </fieldset>

          <Field
            label="En passant square"
            className="cw-ed-group"
            labelClassName="cw-ed-label"
            hintClassName="cw-ed-note"
            hint="The square a pawn that has just moved two can be taken on. Left empty unless you set it."
            problem={enPassantProblem ? 'This square does not match the board. The reason is below.' : undefined}
          >
            {(wiring) => (
              <select
                {...wiring}
                className="cw-ed-select"
                value={draft.enPassant}
                onChange={(event) => edit(withEnPassant(draft, event.target.value))}
              >
                <option value="-">None</option>
                <optgroup label="Third row — a white pawn has just pushed two">
                  {FILES.map((file) => <option key={`${file}3`} value={`${file}3`}>{`${file}3`}</option>)}
                </optgroup>
                <optgroup label="Sixth row — a black pawn has just pushed two">
                  {FILES.map((file) => <option key={`${file}6`} value={`${file}6`}>{`${file}6`}</option>)}
                </optgroup>
              </select>
            )}
          </Field>

          <div className="cw-ed-row">
            <Field label="Moves since a capture or a pawn move" className="cw-ed-group" labelClassName="cw-ed-label">
              {(wiring) => (
                <input
                  {...wiring}
                  className="cw-ed-text is-number"
                  type="number"
                  min={0}
                  value={draft.halfmove}
                  onChange={(event) => edit(withClocks(draft, Number(event.target.value), draft.fullmove))}
                />
              )}
            </Field>
            <Field label="Move number" className="cw-ed-group" labelClassName="cw-ed-label">
              {(wiring) => (
                <input
                  {...wiring}
                  className="cw-ed-text is-number"
                  type="number"
                  min={1}
                  value={draft.fullmove}
                  onChange={(event) => edit(withClocks(draft, draft.halfmove, Number(event.target.value)))}
                />
              )}
            </Field>
          </div>

          <Field
            label="Position as text (FEN)"
            className="cw-ed-group"
            labelClassName="cw-ed-label"
            hintClassName="cw-ed-note"
            hint="Paste one in and press Read. Nothing on the board changes until you do."
            problem={readProblem ?? undefined}
          >
            {(wiring) => (
              <input
                {...wiring}
                className="cw-ed-text is-fen"
                type="text"
                spellCheck={false}
                value={fenText}
                onChange={(event) => { setFenText(event.target.value); setReadProblem(null) }}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); read() } }}
              />
            )}
          </Field>
          <div className="cw-ed-row">
            <Button size="tiny" disabled={fenText.trim() === '' || fenText === fen} onClick={read}>Read this position</Button>
            <Button size="tiny" onClick={() => { void copy() }}>Copy</Button>
          </div>

          <PositionReport look={look} reading={reading} />

          <div className="cw-ed-actions">
            <Button
              kind="primary"
              size="small"
              busy={busy}
              busyLabel="Opening…"
              disabled={!look.legal || !canCreate}
              // The reason is said here rather than inside, so that Orbis asking for the same thing is given the
              // reason back instead of a notice somebody else's screen would have shown.
              onClick={() => { void openForStudy().catch((err: unknown) => onNotify?.(plainly(err), 'error')) }}
            >
              Open this position for study
            </Button>
            {!look.legal && (
              <p className="cw-ed-note is-wrong">
                This cannot be opened until it is a chess position. What is wrong with it is listed above.
              </p>
            )}
            {look.legal && !canCreate && (
              <p className="cw-ed-note is-wrong">
                This copy of Orbis has no way to store a game, so the position cannot be opened here. Copying it as
                text still works.
              </p>
            )}
            {look.legal && canCreate && fen === START_FEN && (
              <p className="cw-ed-note">This is the ordinary opening position.</p>
            )}
          </div>

          <VariantNotice />
        </aside>
      </div>
    </div>
  )
}

export default PositionEditor
