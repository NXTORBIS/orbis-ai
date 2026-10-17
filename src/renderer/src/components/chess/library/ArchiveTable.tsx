import { ArrowDown, ArrowUp, Star } from 'lucide-react'
import { COLUMN_WORDS, OUTCOME_WORDS, type ArchiveColumn, type ArchiveRow } from '../../../../../shared/chess/archive'

/**
 * Every saved game as a real table: one row per game, one column per thing the record actually says.
 *
 * It replaces a list of sentences about games. A sentence cannot be sorted, cannot be scanned down, and cannot be
 * compared with the sentence above it, and this screen is for finding one game among hundreds.
 *
 * Two things it will not do:
 *
 * **It never fills a cell in.** A game with no date has a dash in the date column and the dash has a title saying
 * the record does not say. A guessed date in a date column is worse than an empty one, because it can be sorted.
 *
 * **It never says which side you were unless that is known.** The colour column shows a dash and the result column
 * says "no result" rather than calling an unattributable game a loss.
 */

export interface ArchiveTableProps {
  rows: readonly ArchiveRow[]
  /** The columns to draw, in order. The screen decides, because a narrow table drops the thin ones. */
  columns: readonly ArchiveColumn[]
  column: ArchiveColumn
  direction: 'up' | 'down'
  onSort: (column: ArchiveColumn) => void
  /** Which game the board is showing. */
  selected: string | null
  onSelect: (id: string) => void
  /** Opening a game in the analysis board, which is what a double press does. */
  onOpen: (id: string) => void
  picked: ReadonlySet<string>
  onPick: (id: string, want: boolean, shiftHeld: boolean) => void
  onStar: (id: string, favourite: boolean) => void
  busy?: boolean
}

/** A dash that says why it is a dash, rather than an empty cell that looks like a bug. */
function NotSaid({ about }: { about: string }): React.JSX.Element {
  return <span className="cw-lb-nil" title={`The record does not say ${about}.`}>—</span>
}

function cell(row: ArchiveRow, column: ArchiveColumn): React.JSX.Element {
  switch (column) {
    case 'date':
      // Shown exactly as the file wrote it, half-written dates included: "2026.??.??" is a real answer.
      return row.date.text ? <span className="cw-lb-mono">{row.date.text}</span> : <NotSaid about="when this was played" />
    case 'opponent':
      return row.side === null
        ? <NotSaid about="which player you were, so it cannot say who the other one was" />
        : row.opponent
          ? <span className="cw-lb-cell-name">{row.opponent}</span>
          : <NotSaid about="who you played" />
    case 'colour':
      return row.side === null
        ? <NotSaid about="which side you were" />
        : (
          <span className="cw-lb-colour">
            <span className={`cw-lb-disc${row.side === 'b' ? ' is-black' : ''}`} aria-hidden="true" />
            {row.side === 'w' ? 'White' : 'Black'}
          </span>
        )
    case 'outcome':
      return (
        <span className={`cw-lb-outcome is-${row.outcome}`}>
          {/* A letter as well as a colour, because colour alone is not a state. */}
          <span className="cw-lb-outcome-mark" aria-hidden="true">
            {row.outcome === 'win' ? 'W' : row.outcome === 'loss' ? 'L' : row.outcome === 'draw' ? '=' : '·'}
          </span>
          {OUTCOME_WORDS[row.outcome]}
        </span>
      )
    case 'opening':
      return row.opening === null
        ? <NotSaid about="which opening this was, and no position in it is in the openings dataset" />
        : (
          <span
            className="cw-lb-cell-opening"
            title={row.opening.from === 'file' ? 'Named by the game file itself.' : 'Named by matching a position in the game against the openings dataset.'}
          >
            {row.opening.eco && <span className="cw-lb-eco">{row.opening.eco}</span>}
            {row.opening.name || 'Named only by its code'}
          </span>
        )
    case 'moves':
      return <span className="cw-lb-mono">{row.moves}</span>
    case 'ended':
      return row.ended ? <span>{row.ended}</span> : <NotSaid about="how it ended, beyond the result" />
    case 'rating':
      return row.opponentRating === null
        ? <NotSaid about="a rating for the other player" />
        : <span className="cw-lb-mono">{row.opponentRating}</span>
    default:
      return <NotSaid about="this" />
  }
}

export function ArchiveTable({
  rows, columns, column, direction, onSort, selected, onSelect, onOpen, picked, onPick, onStar, busy = false
}: ArchiveTableProps): React.JSX.Element {
  return (
    <div className="cw-lb-tablebox">
      <table className="cw-lb-table">
        <caption className="cw-lb-table-caption">
          Your saved games. Press a row to put it on the board; press it twice to open it.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="cw-lb-th-pick"><span className="cw-lb-sr">Picked</span></th>
            <th scope="col" className="cw-lb-th-star"><span className="cw-lb-sr">Starred</span></th>
            {columns.map((each) => (
              <th
                key={each}
                scope="col"
                aria-sort={column === each ? (direction === 'up' ? 'ascending' : 'descending') : 'none'}
              >
                <button type="button" className="cw-lb-sortbtn" onClick={() => onSort(each)}>
                  {COLUMN_WORDS[each]}
                  {column === each && (direction === 'up'
                    ? <ArrowUp size={11} aria-hidden="true" />
                    : <ArrowDown size={11} aria-hidden="true" />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={`cw-lb-tr${row.id === selected ? ' is-on' : ''}${picked.has(row.id) ? ' is-picked' : ''}`}
              aria-selected={row.id === selected}
              onClick={() => onSelect(row.id)}
              onDoubleClick={() => onOpen(row.id)}
            >
              <td className="cw-lb-td-pick">
                {/* Its own control. A row where one press both picked and opened is how the wrong games get deleted. */}
                <input
                  type="checkbox"
                  checked={picked.has(row.id)}
                  disabled={busy}
                  aria-label={`Pick this game${row.opponent ? ` against ${row.opponent}` : ''}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onPick(row.id, !picked.has(row.id), event.shiftKey)
                  }}
                  onChange={() => undefined}
                />
              </td>
              <td className="cw-lb-td-star">
                <button
                  type="button"
                  className={`cw-lb-star${row.game.favourite ? ' is-on' : ''}`}
                  disabled={busy}
                  aria-pressed={row.game.favourite === true}
                  aria-label={row.game.favourite ? 'Remove the star from this game' : 'Star this game'}
                  onClick={(event) => {
                    event.stopPropagation()
                    onStar(row.id, !row.game.favourite)
                  }}
                >
                  <Star size={12} aria-hidden="true" />
                </button>
              </td>
              {columns.map((each) => (
                <td key={each} className={`cw-lb-td-${each}`}>{cell(row, each)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default ArchiveTable
