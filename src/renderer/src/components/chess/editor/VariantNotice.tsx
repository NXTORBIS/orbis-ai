import { useMemo, useState } from 'react'
import {
  identifyVariant, playableVariants, refuse, refusedVariants,
  type VariantRecord
} from '../../../../../shared/chess/variants'

/**
 * Which games Orbis plays, said out loud.
 *
 * This sits with the position editor because the editor is where the question comes up: somebody who can put a rook
 * anywhere will sooner or later try to set up Chess960, and finding out afterwards that Orbis quietly treated it as
 * ordinary chess would be worse than being told now.
 *
 * The list is generated from the registry rather than written here, so it cannot drift away from what the code
 * actually does. A variant appearing in this list with "nothing" beside it is not an apology -- it is the honest
 * answer, and the alternative is a program that pretends to play a game it does not know the rules of.
 */

const can = (record: VariantRecord): string => {
  const parts = [
    record.support.play ? 'play' : '',
    record.support.analyse ? 'analyse' : '',
    record.support.import ? 'read games' : '',
    record.support.export ? 'write games' : ''
  ].filter((one) => one !== '')
  return parts.length ? parts.join(', ') : 'nothing'
}

export function VariantNotice(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const played = useMemo(playableVariants, [])
  const refused = useMemo(refusedVariants, [])

  const asked = name.trim()
  const identity = asked ? identifyVariant(asked) : null
  const why = asked ? refuse(asked, 'play') : null

  return (
    <section className="cw-ed-variants" aria-label="Which games Orbis plays">
      <h4 className="cw-ed-block-title">Which games Orbis plays</h4>
      <p className="cw-ed-note">
        {played.map((one) => one.name).join(', ')} — and only that. Orbis has one set of rules. A game that says it is
        something else is refused and kept as it was written; it is never read as ordinary chess, because the moves
        would look fine and the game would be wrong.
      </p>

      <label className="cw-ed-ask" htmlFor="cw-ed-variant-ask">Check a name</label>
      <input
        id="cw-ed-variant-ask"
        className="cw-ed-text"
        type="text"
        value={name}
        placeholder="Chess960, Crazyhouse, From Position…"
        onChange={(event) => setName(event.target.value)}
      />
      {asked !== '' && (
        <p className={`cw-ed-answer${why ? ' is-wrong' : ''}`} role="status">
          {identity && identity.kind === 'standard'
            ? `“${asked}” is ordinary chess. Orbis can play it, analyse it, read it and write it.`
            : why}
        </p>
      )}

      <button type="button" className="cw-ed-disclose" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        {open ? 'Hide the variants Orbis refuses' : `Show the ${refused.length} variants Orbis refuses`}
      </button>
      {open && (
        <ul className="cw-ed-variant-list">
          {refused.map((record) => (
            <li key={record.id}>
              <strong>{record.name}</strong>
              <span className="cw-ed-can">Orbis can: {can(record)}</span>
              <span className="cw-ed-note">{record.differs}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="cw-ed-note">
        A name that is not on that list is refused as well. An unfamiliar name is not evidence that the moves are
        ordinary chess.
      </p>
    </section>
  )
}

export default VariantNotice
