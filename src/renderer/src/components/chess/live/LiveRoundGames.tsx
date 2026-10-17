import { LivePlayer } from './LivePlayer'
import { freshnessBadge, resultWords, statusWords, type MergedGame } from '../../../../../shared/chess/liveView'

/**
 * The games of one round, and the way to move between them.
 *
 * Board order is the provider's order and is kept exactly: board 1 is board 1 because the provider said so, not
 * because of how many moves have arrived. A list that re-sorted itself as moves came in would move the row
 * somebody was about to click.
 *
 * Three states a row can be in, all of them real and none of them hidden:
 *
 *   - **nothing has arrived yet** -- the game is listed and the feed has sent nothing for it. Said as "no moves
 *     yet", which is true, rather than shown as a game standing in its opening position.
 *   - **moves have arrived** -- how many, and how current they are.
 *   - **the feed carries it and the listing did not** -- kept, and marked, because it is a real game being played
 *     and the listing was simply fetched a minute earlier.
 */
export interface LiveRoundGamesProps {
  games: readonly MergedGame[]
  chosenId: string | null
  onChoose: (id: string) => void
  /** Games the provider's listing carried that could not be read. */
  unreadableListed: number
  /** Games the feed carried that could not be read. */
  unreadableHeld: number
  now: number
  /** The embargo the provider declared on this round, where it declared one. */
  delaySeconds?: number
}

export function LiveRoundGames({
  games, chosenId, onChoose, unreadableListed, unreadableHeld, now, delaySeconds
}: LiveRoundGamesProps): React.JSX.Element {
  return (
    <div className="cw-live-boards">
      <h4 className="cw-live-sub">Games in this round</h4>
      {games.length === 0
        ? <p className="cw-live-quiet">The provider lists no games in this round.</p>
        : (
          <ul className="cw-live-gamelist">
            {games.map((game, index) => {
              const moves = game.record?.moves.length ?? 0
              const badge = game.record
                ? freshnessBadge({ record: game.record, now, ...(delaySeconds !== undefined ? { delaySeconds } : {}) })
                : null
              return (
                <li key={game.id}>
                  <button
                    type="button"
                    className={`cw-live-gamerow${game.id === chosenId ? ' is-watching' : ''}`}
                    aria-current={game.id === chosenId ? 'true' : undefined}
                    onClick={() => onChoose(game.id)}
                  >
                    <span className="cw-live-boardno" aria-hidden="true">{index + 1}</span>
                    <span className="cw-live-pair">
                      <LivePlayer player={game.white} role="White" />
                      <span className="cw-live-vs" aria-hidden="true">–</span>
                      <LivePlayer player={game.black} role="Black" />
                    </span>
                    <small className="cw-live-gamefacts">
                      {game.result === '*' ? statusWords(game.status) : resultWords(game.result)}
                      {' · '}
                      {/* "No moves yet" is the truth about a listed game nothing has arrived for. */}
                      {moves === 0 ? 'no moves yet' : `${moves} move${moves === 1 ? '' : 's'}`}
                      {badge && badge.state !== 'live' ? ` · ${badge.word.toLowerCase()}` : ''}
                      {game.listing === null ? ' · not in the round list' : ''}
                    </small>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      {(unreadableListed > 0 || unreadableHeld > 0) && (
        <p className="cw-live-warn">
          {unreadableListed > 0 && `${unreadableListed} game${unreadableListed === 1 ? '' : 's'} in the provider's list could not be read. `}
          {unreadableHeld > 0 && `${unreadableHeld} game${unreadableHeld === 1 ? '' : 's'} arriving on the feed could not be read. `}
          Nothing was guessed at in their place.
        </p>
      )}
    </div>
  )
}
