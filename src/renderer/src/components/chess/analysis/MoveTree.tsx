import { CLASS_LABEL, formatScore, type MoveClass } from '../../../../../shared/chess/evaluation'
import type { LineRow } from '../../../../../shared/chess/analysis'

/**
 * The move list: the game down the middle, the lines somebody tried indented beside it.
 *
 * Which is which is not inferred here. `main` and `nesting` come off the tree, so a branch that has been promoted
 * looks like the main line because it *is* the main line, and the game as played is still in the list as the
 * variation it has become (Sections 105, 121).
 */

/** A short mark for a named move. Nothing is shown for a move that was not judged: a blank is the honest mark. */
const MARK: Record<MoveClass, string> = {
  best: '✓',
  excellent: '',
  good: '',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
  'missed-mate': '#',
  unclear: ''
}

export interface MoveTreeProps {
  rows: LineRow[]
  cursor: string
  onJump: (nodeId: string) => void
  /** What the report calls each move, by node id. Only the moves it could judge are in here. */
  marks: Record<string, MoveClass>
  /** The original game's nodes, so a promoted line does not make the real game look like an invention. */
  original: string[]
}

export function MoveTree({ rows, cursor, onJump, marks, original }: MoveTreeProps): React.JSX.Element {
  if (!rows.length) {
    return <p className="cw-an-empty">No moves yet. Play one on the board to start a line.</p>
  }
  const originalSet = new Set(original)
  return (
    <ol className="cw-an-moves" aria-label="Moves, with variations">
      {rows.map((row) => {
        const mark = marks[row.nodeId] ?? 'unclear'
        const classes = [
          'cw-an-move',
          row.main ? 'is-main' : 'is-branch',
          row.nodeId === cursor ? 'is-here' : '',
          mark === 'blunder' || mark === 'missed-mate' ? 'is-bad' : mark === 'mistake' ? 'is-poor' : ''
        ].filter(Boolean).join(' ')
        const described = [
          `${row.number}${row.side === 'w' ? '.' : '…'}${row.san}`,
          row.main ? 'main line' : `variation, ${row.nesting} deep`,
          !row.main && originalSet.has(row.nodeId) ? 'played in the game' : '',
          mark !== 'unclear' ? CLASS_LABEL[mark] : '',
          row.annotation?.text ? 'has a note' : ''
        ].filter(Boolean).join(', ')
        return (
          <li
            key={row.nodeId}
            className={`cw-an-mv${row.main ? '' : ' is-branch'}`}
            style={{ paddingInlineStart: `${row.nesting * 14}px` }}
          >
            {row.startsBranch && <span className="cw-an-open" aria-hidden="true">(</span>}
            {(row.side === 'w' || row.startsBranch) && (
              <span className="cw-an-number">{row.number}{row.side === 'w' ? '.' : '…'}</span>
            )}
            <button type="button" className={classes} onClick={() => onJump(row.nodeId)} aria-label={described}>
              {row.san}
              {MARK[mark] && <span className="cw-an-mark" aria-hidden="true">{MARK[mark]}</span>}
              {row.annotation?.nags?.length ? <span className="cw-an-nag" aria-hidden="true">{row.annotation.nags.join('')}</span> : null}
            </button>
            {row.evaluation && <span className="cw-an-score" aria-hidden="true">{formatScore(row.evaluation.score)}</span>}
            {row.annotation?.text && <span className="cw-an-note-dot" aria-hidden="true" title={row.annotation.text}>●</span>}
            {!row.main && originalSet.has(row.nodeId) && <span className="cw-an-played">played</span>}
            {row.closes > 0 && <span className="cw-an-close" aria-hidden="true">{')'.repeat(row.closes)}</span>}
          </li>
        )
      })}
    </ol>
  )
}
