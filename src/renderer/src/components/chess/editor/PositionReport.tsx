import {
  promotionsNeeded, summarise,
  type PositionInspection
} from '../../../../../shared/chess/variants'
import type { Side } from '../../../../../shared/chess/evaluation'
import { SIDE_NAME } from './PiecePalette'

/**
 * What is wrong with this position, and what is merely unusual about it.
 *
 * The two lists are never merged, and that is the whole design. A position with nine pawns and a position that took
 * three promotions to build are both "unusual" if you squint, and they deserve opposite answers: the first cannot be
 * studied because it is not chess, and the second is the ordinary shape of a composed study and must be accepted
 * without an argument. A single list of "problems" would make a person doubt a perfectly good study, or trust a board
 * that is not a position.
 *
 * Nothing here is softened and nothing is hidden. If Orbis cannot say whether a position was reachable, it says that
 * too, rather than implying a clean bill of health.
 */

export interface PositionReportProps {
  look: PositionInspection
  /** What reading a pasted FEN had to fill in or drop. Empty unless a FEN was just read. */
  reading: readonly string[]
}

function materialLine(look: PositionInspection, side: Side): string {
  const mine = look.material[side]
  const promotions = promotionsNeeded(mine)
  const bits = [`${mine.men} ${mine.men === 1 ? 'man' : 'men'}`, `${mine.p} ${mine.p === 1 ? 'pawn' : 'pawns'}`]
  if (promotions > 0) bits.push(`${promotions} promoted ${promotions === 1 ? 'pawn' : 'pawns'} at least`)
  return `${SIDE_NAME[side]}: ${bits.join(', ')}`
}

export function PositionReport({ look, reading }: PositionReportProps): React.JSX.Element {
  return (
    <div className="cw-ed-report">
      <p className={`cw-ed-verdict${look.legal ? '' : ' is-wrong'}`} role="status">{summarise(look)}</p>

      {look.faults.length > 0 && (
        <section className="cw-ed-block is-wrong" aria-label="Why this is not a chess position">
          <h4 className="cw-ed-block-title">Not a chess position</h4>
          <ul className="cw-ed-faults">
            {look.faults.map((fault) => (
              <li key={`${fault.kind}-${fault.squares.join('')}-${fault.message.slice(0, 24)}`}>
                {fault.message}
                {fault.squares.length > 0 && <span className="cw-ed-where"> {fault.squares.join(', ')}</span>}
              </li>
            ))}
          </ul>
          <p className="cw-ed-note">
            Nothing has been changed to make this work. The position is exactly as you built it, and it stays that way
            until you change it.
          </p>
        </section>
      )}

      {look.legal && look.unreachable.length > 0 && (
        <section className="cw-ed-block is-odd" aria-label="Legal, and no game could have reached it">
          <h4 className="cw-ed-block-title">Legal, and no game could have reached it</h4>
          <ul className="cw-ed-faults">
            {look.unreachable.map((note) => <li key={note.kind + note.message.slice(0, 24)}>{note.message}</li>)}
          </ul>
          <p className="cw-ed-note">
            That is allowed. A composed position — a study, a puzzle, an ending to practise — is nearly always like
            this, and Orbis will study, analyse and keep it exactly as it stands.
          </p>
        </section>
      )}

      {look.legal && look.unreachable.length === 0 && (
        <p className="cw-ed-note">
          Nothing found says this position could not have been played to. Orbis checks a short list of things that are
          certainly impossible — armies that need too many promoted pawns, pawns that must have captured more men than
          are missing, clocks that contradict the move number — and it cannot prove that a position really did occur in
          a game.
        </p>
      )}

      {reading.length > 0 && (
        <section className="cw-ed-block" aria-label="What reading that position changed">
          <h4 className="cw-ed-block-title">What reading that position changed</h4>
          <ul className="cw-ed-faults">
            {reading.map((note) => <li key={note.slice(0, 40)}>{note}</li>)}
          </ul>
        </section>
      )}

      <dl className="cw-ed-facts">
        <div>
          <dt>Side to move</dt>
          <dd>{SIDE_NAME[look.turn]}{look.check ? ', in check' : ''}</dd>
        </div>
        <div>
          <dt>Moves available</dt>
          {/* A dash, never a zero: no number at all and "no legal moves" are different answers. */}
          <dd>{look.moves === null ? '—' : look.moves}</dd>
        </div>
        <div>
          <dt>Men</dt>
          <dd>{materialLine(look, 'w')}<br />{materialLine(look, 'b')}</dd>
        </div>
      </dl>
    </div>
  )
}

export default PositionReport
