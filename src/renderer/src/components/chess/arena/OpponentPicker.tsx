import { useMemo } from 'react'
import { Button } from '../../../ui'
import {
  LADDER_NOTE,
  RATING_NOTE,
  STYLE_NOTE,
  handicapReach,
  ladder,
  opponentLines,
  type AdvertisedOption,
  type OpponentId
} from '../../../../../shared/chess/opponents'
import './opponentPicker.css'

/**
 * Choosing who to play against.
 *
 * It draws the list in `opponents.ts` and nothing else: it decides no strength, holds no state of its own, and the
 * sentence under each name is built by that module out of the settings that will really be sent. Everything this
 * screen could get wrong is a thing it does not do.
 *
 * Two things it is careful about.
 *
 * **The number beside a name is a place in the list.** "3 of 9", small and grey. Not a rating -- Orbis has played
 * no rated games and has none to show -- and the note above the list says so in words rather than leaving somebody
 * to work it out from the absence of one.
 *
 * **It says when the strength will not really be set.** An opponent's strength is the engine's own Skill Level, and
 * an engine that does not publish that option is never sent it. So this asks `handicapReach` what the engine in
 * front of it really offers and prints the answer on the card. Without that, a list of nine opponents on an engine
 * with no strength dial would be nine thinking times with nine confident labels. An engine that has not shaken
 * hands yet says exactly that -- which is not the same answer as "it has not got one".
 */

export interface OpponentPickerProps {
  /** The opponent chosen now, or null before one has been. */
  chosen: OpponentId | null
  onChoose: (id: OpponentId) => void
  /**
   * What the engine advertised about itself, from `chess:engine-status` (`status.options`).
   *
   * Empty or left out means Orbis has not asked it yet, and the cards say so rather than claiming the strength will
   * be set. Pass it through unchanged; this does not need any other part of the status.
   */
  engineOptions?: readonly AdvertisedOption[]
  /** Pressed to start the game. Left out and no start button is drawn, so this can be used inside a bigger setup. */
  onStart?: (id: OpponentId) => void
  /** Stops the start button while a game is being set up. */
  busy?: boolean
}

/** One shared empty list, so "the engine has not been asked yet" does not rebuild the cards on every redraw. */
const NOTHING_ADVERTISED: readonly AdvertisedOption[] = Object.freeze([])

export function OpponentPicker(p: OpponentPickerProps): React.JSX.Element {
  const options = p.engineOptions ?? NOTHING_ADVERTISED
  const rows = useMemo(() => {
    const all = ladder()
    return all.map((one) => ({
      one,
      said: opponentLines(one),
      reach: handicapReach(one, options),
      place: `${one.rung} of ${all.length}`
    }))
  }, [options])
  const chosenRow = rows.find((row) => row.one.id === p.chosen)

  return (
    <div className="cw-opp">
      <div className="cw-opp-notes">
        <p>{RATING_NOTE}</p>
        <p>{STYLE_NOTE}</p>
        <p>{LADDER_NOTE}</p>
      </div>

      <div className="cw-opp-list" role="group" aria-label="Who to play against">
        {rows.map(({ one, said, reach, place }) => (
          <button
            key={one.id}
            type="button"
            className="cw-opp-card"
            aria-pressed={p.chosen === one.id}
            onClick={() => p.onChoose(one.id)}
          >
            <span className="cw-opp-top">
              <span className="cw-opp-name">{said.name}</span>
              {/* Its place in the list, said in words so it cannot be mistaken for a score. */}
              <span className="cw-opp-rung">{place}</span>
            </span>
            <span className="cw-opp-strength">{said.strength}</span>
            <span className="cw-opp-style">{said.style}</span>
            <span className="cw-opp-setting">What is set: {said.setting}</span>
            {/*
              * Anything other than "this will be set exactly as the list says" is printed.
              *
              * Including "nothing has been asked of the engine yet", because a card that quietly says nothing in
              * that case reads as a promise.
              */}
            {reach.kind !== 'applies' && reach.kind !== 'nothing-to-apply' && (
              <span className="cw-opp-caveat">{reach.says}</span>
            )}
          </button>
        ))}
      </div>

      {p.onStart && (
        <div className="cw-opp-start">
          <Button
            kind="primary"
            disabled={!chosenRow || p.busy === true}
            onClick={() => {
              if (chosenRow) p.onStart?.(chosenRow.one.id)
            }}
          >
            {chosenRow ? `Play ${chosenRow.said.name}` : 'Choose someone to play'}
          </Button>
          {chosenRow && <span className="cw-opp-chosen">{chosenRow.said.setting}</span>}
        </div>
      )}
    </div>
  )
}
