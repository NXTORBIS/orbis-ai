import type { PieceLetter } from '../../../../../shared/chess/rules'
import type { Side } from '../../../../../shared/chess/evaluation'
import { Piece } from '../pieces'

/**
 * What to put on the board next.
 *
 * Three kinds of tool and no fourth: a man to place, an eraser, and a hand that moves whatever is already there. The
 * hand is the one worth explaining -- it moves a piece from any square to any other with no regard for the rules,
 * which is the whole point of an editor. A board that only offered legal moves could never be used to set up a
 * position that no game reached, and composed positions are most of what people set up by hand.
 */

export type EditorTool =
  | { kind: 'move' }
  | { kind: 'erase' }
  | { kind: 'piece'; type: PieceLetter; color: Side }

/*
 * The pieces here were the standard chess characters, and the comment said Board.tsx drew them the same way. It
 * does not any more: a piece is a drawn shape now (`../pieces`), so the editor drew letters beside a board of
 * pictures. Both now come from the same place, which is the only way they can go on matching.
 */

export const PIECE_NAME: Record<PieceLetter, string> = {
  k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn'
}

export const SIDE_NAME: Record<Side, string> = { w: 'White', b: 'Black' }

const ORDER: PieceLetter[] = ['k', 'q', 'r', 'b', 'n', 'p']

export const describeTool = (tool: EditorTool): string => {
  if (tool.kind === 'move') return 'Moving pieces that are already on the board'
  if (tool.kind === 'erase') return 'Taking pieces off the board'
  return `Placing a ${SIDE_NAME[tool.color].toLowerCase()} ${PIECE_NAME[tool.type]}`
}

export interface PiecePaletteProps {
  tool: EditorTool
  onPick: (tool: EditorTool) => void
}

const same = (a: EditorTool, b: EditorTool): boolean =>
  a.kind === b.kind && (a.kind !== 'piece' || b.kind !== 'piece' || (a.type === b.type && a.color === b.color))

export function PiecePalette({ tool, onPick }: PiecePaletteProps): React.JSX.Element {
  const row = (color: Side): React.JSX.Element => (
    <div className="cw-ed-row" role="group" aria-label={`${SIDE_NAME[color]} pieces`}>
      {ORDER.map((type) => {
        const mine: EditorTool = { kind: 'piece', type, color }
        const chosen = same(tool, mine)
        return (
          <button
            key={`${color}${type}`}
            type="button"
            className={`cw-ed-swatch${chosen ? ' is-chosen' : ''}`}
            aria-pressed={chosen}
            onClick={() => onPick(mine)}
          >
            <Piece color={color} type={type} className="cw-ed-man" />
            <span className="cw-ed-swatch-name">{`${SIDE_NAME[color]} ${PIECE_NAME[type]}`}</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="cw-ed-palette">
      {row('w')}
      {row('b')}
      <div className="cw-ed-row" role="group" aria-label="Tools">
        <button
          type="button"
          className={`cw-ed-tool${tool.kind === 'move' ? ' is-chosen' : ''}`}
          aria-pressed={tool.kind === 'move'}
          onClick={() => onPick({ kind: 'move' })}
        >
          Move a piece
        </button>
        <button
          type="button"
          className={`cw-ed-tool${tool.kind === 'erase' ? ' is-chosen' : ''}`}
          aria-pressed={tool.kind === 'erase'}
          onClick={() => onPick({ kind: 'erase' })}
        >
          Take a piece off
        </button>
      </div>
      <p className="cw-ed-hint" role="status">{describeTool(tool)}. A right-click on a square always takes a piece off.</p>
    </div>
  )
}

export default PiecePalette
