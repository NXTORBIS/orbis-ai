import { playerLabel } from '../../../../../shared/chess/liveView'
import type { PlayerInfo } from '../../../../../shared/chess/model'

/**
 * A player, showing exactly what the source gave and nothing else.
 *
 * The whole of this component is one rule: **a missing part stays missing, and says that it is missing.** No "?"
 * for a name, no "Unrated" for a rating nobody sent, no blank where a person would wonder whether the rating is
 * zero. Where there is no name the player's colour is shown instead, in the style that marks it as a role rather
 * than a name, and it carries the explanation for anybody hovering or listening.
 *
 * It matters more here than almost anywhere else in Orbis. Half the boards in a club broadcast arrive with no
 * ratings and some with no names, and a screen that writes "? (0)" has turned the provider's silence into a claim
 * about two real people.
 */
export interface LivePlayerProps {
  player?: PlayerInfo
  role: 'White' | 'Black'
  /** The big treatment, for the two names beside the board rather than a row in a list. */
  big?: boolean
}

export function LivePlayer({ player, role, big = false }: LivePlayerProps): React.JSX.Element {
  const label = playerLabel(player, role)
  return (
    <span className={big ? 'cw-live-who is-big' : 'cw-live-who'}>
      {label.title && <span className="cw-live-title">{label.title}</span>}
      {label.name
        ? <span className="cw-live-name">{label.name}</span>
        : (
          <span className="cw-live-noname" title={`The source does not give this player's name, so ${role.toLowerCase()} is shown instead.`}>
            {role}
          </span>
        )}
      {label.rating !== null && <span className="cw-live-rating">{label.rating}</span>}
    </span>
  )
}
