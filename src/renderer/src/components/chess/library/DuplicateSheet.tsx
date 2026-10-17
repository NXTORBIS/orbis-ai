import { useMemo } from 'react'
import { Button, Modal } from '../../../ui'
import type { StoredGame } from '../../../../../shared/chess/model'
import { duplicateGroups, gameLine, gameTitle } from '../../../../../shared/chess/library'
import './library.css'

/**
 * Games that have arrived twice.
 *
 * The one rule this sheet exists to keep is that it never offers to delete anything it is not sure about. Two kinds
 * of thing come back from `duplicateGroups` and they are shown differently on purpose:
 *
 *   - **The same game, twice.** The records agree about everything either of them says, so keeping one loses
 *     nothing. The extra copies can be picked in one press.
 *   - **The same moves, different games.** Two players really can reach the same position by the same route in two
 *     different tournaments, and short games especially. These are listed with the fields they disagree about, and
 *     there is no button that selects them, because there is nothing here that knows which one is wrong.
 *
 * Picking here only builds a selection. The removing is done by the ordinary delete, which asks first and says what
 * it will take.
 */
export interface DuplicateSheetProps {
  games: StoredGame[]
  /** Hands back the ids of the extra copies, to become the selection in the list behind this sheet. */
  onPick: (ids: string[]) => void
  onClose: () => void
}

export function DuplicateSheet({ games, onPick, onClose }: DuplicateSheetProps): React.JSX.Element {
  const groups = useMemo(() => duplicateGroups(games), [games])
  const byId = useMemo(() => new Map(games.map((one) => [one.id, one])), [games])

  const copies = groups.filter((group) => group.verdict === 'same-game')
  const lookalikes = groups.filter((group) => group.verdict === 'same-moves')
  /** Everything but the first of each set of copies: what could go without losing a game. */
  const extras = copies.flatMap((group) => group.ids.slice(1))

  const named = (id: string): { title: string; line: string } => {
    const game = byId.get(id)
    return game ? { title: gameTitle(game), line: gameLine(game) } : { title: 'A game that is no longer here', line: '' }
  }

  return (
    <Modal label="Games that have arrived twice" title="Games that have arrived twice" onClose={onClose}>
      <div className="cw-lb-sheet">
        {groups.length === 0 ? (
          <p>
            Nothing in your {games.length === 1 ? 'one game' : `${games.length} games`} shares its moves with anything
            else, so there is nothing here to tidy up.
          </p>
        ) : (
          <>
            <p className="cw-lb-sheet-faint">
              Looked at {games.length} games. Games with no moves are not compared: an empty board matches every other
              empty board, which would offer to delete every new board you have ever opened.
            </p>

            {copies.length > 0 && (
              <>
                <p>{copies.length === 1 ? 'One game is here more than once' : `${copies.length} games are here more than once`}</p>
                <ul className="cw-lb-sheet-list" aria-label="The same game more than once">
                  {copies.map((group) => (
                    <li key={group.ids.join('-')} className="cw-lb-dup">
                      <span className="cw-lb-dup-kind">{group.ids.length} copies, and they agree</span>
                      <strong>{named(group.ids[0]).title}</strong>
                      <span className="cw-lb-sheet-faint">{named(group.ids[0]).line}</span>
                      {group.because.map((line) => (
                        <span key={line} className="cw-lb-sheet-faint">{line}</span>
                      ))}
                    </li>
                  ))}
                </ul>
                <div className="cw-lb-sheet-actions">
                  <Button
                    size="small"
                    kind="primary"
                    onClick={() => onPick(extras)}
                  >
                    Pick the {extras.length === 1 ? 'one extra copy' : `${extras.length} extra copies`}
                  </Button>
                </div>
              </>
            )}

            {lookalikes.length > 0 && (
              <>
                <p>
                  {lookalikes.length === 1
                    ? 'One set of games shares its moves without being the same game'
                    : `${lookalikes.length} sets of games share their moves without being the same game`}
                </p>
                <ul className="cw-lb-sheet-list" aria-label="Games that share moves but are not the same game">
                  {lookalikes.map((group) => (
                    <li key={group.ids.join('-')} className="cw-lb-dup is-careful">
                      <span className="cw-lb-dup-kind">Same moves, and they disagree</span>
                      {group.ids.map((id) => (
                        <span key={id}>
                          <strong>{named(id).title}</strong>
                          <span className="cw-lb-sheet-faint"> — {named(id).line}</span>
                        </span>
                      ))}
                      {group.conflicts.map((conflict) => (
                        <span key={conflict.field} className="cw-lb-sheet-faint">
                          {conflict.field}: “{conflict.a}” against “{conflict.b}”
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
                <p className="cw-lb-sheet-faint">
                  Nothing is picked for you here. Two games can share every move and still be two games, and only you
                  know which record is the one to keep.
                </p>
              </>
            )}
          </>
        )}

        <div className="cw-lb-sheet-actions">
          <Button size="small" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  )
}
