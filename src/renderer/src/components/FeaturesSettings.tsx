import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle, Check, Lock } from 'lucide-react'
import { SearchBox, Segmented } from '../ui'
import { SURFACE_GROUPS, type Surface } from '../lib/featureRows'
import type { FeatureVisibility } from '../lib/useFeatureVisibility'
import { ESSENTIAL_IDS, OPTIONAL_IDS, STARTING_IDS, featureState, isEssential, type VisibilityChoice } from '../../../shared/featureVisibility'
import { rankFindables } from '../../../shared/settingsSearch'
import './featuresSettings.css'

/**
 * Which of Orbis's screens are in your menu.
 *
 * Orbis grew to nineteen feature screens in one flat list, beside the browser, Files, Chance and Settings. Everything
 * was offered to everybody, so the menu was too long to scan and most of it was something the person in front of it
 * had no use for. The first run now asks what somebody is here for; this is where they change their mind afterwards,
 * which is the half that decides whether the choice feels safe to make at all.
 *
 * ## The three things this screen has to say out loud
 *
 * **Why nine rows have no switch.** The chat, the browser, Files, Settings and the palette are how a person reaches
 * everything else, including this screen, so a choice that could hide one is a choice nobody could undo. Notes, the
 * clipboard, Workspaces and Schedules are running whether their screen is on view or not. A greyed row with nothing
 * said about it reads as broken, so they sit under their own heading, the heading says why, and each one wears
 * "Always on" rather than a switch that will not move.
 *
 * **Nothing is deleted.** This is the fear that stops people tidying anything up, and it is said beside the switches
 * rather than in a help page. A hidden screen keeps every byte: its notes, its boards, its games, its prices.
 *
 * **A feature that is on and not working is not drawn as healthy.** Two of those are real, and both are shown as
 * trouble rather than as a tick: a screen switched on that this version of Orbis has nothing to open, and a screen
 * switched on that is still not in the menu because what it leads to is off — the Arena with both sports away. The
 * standing rule is that Orbis never claims something works when it does not.
 *
 * ## What it decides
 *
 * Nothing. What exists, what is essential, what depends on what and the sentence for each all come from
 * `shared/featureVisibility.ts`; the groups are the ones the first-run step itself draws; and the saved choice is the
 * window's one copy, handed in, so switching something here changes the sidebar in the same breath. A refusal means
 * the save did not happen, so it is shown and the old value stays on screen — a switch that reports success and
 * changed nothing is the one failure worth more than all the others.
 */

type Showing = 'all' | 'on' | 'off'

/** A row as the search sees it: a name, a line about it, and the other words somebody might look for it by. */
interface Findable extends Surface {
  blurb: string
}

const findable = (one: Surface): Findable => ({ ...one, blurb: one.hint })

export default function FeaturesSettings({ visibility }: { visibility: FeatureVisibility }): React.JSX.Element {
  /** The last switch that did not land, beside the row somebody pressed. */
  const [refused, setRefused] = useState<{ id: string; why: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [showing, setShowing] = useState<Showing>('all')

  const choice = visibility.choice

  const keep = useCallback(
    async (work: Promise<{ refused: string | null }>, id: string): Promise<void> => {
      setBusy(true)
      setRefused(null)
      try {
        const answer = await work
        // Beside the row rather than at the top: a refusal with no row attached reads as a general failure.
        if (answer.refused) setRefused({ id, why: answer.refused })
      } catch {
        setRefused({ id, why: 'Orbis could not save that change.' })
      } finally {
        setBusy(false)
      }
    },
    []
  )

  const toggle = useCallback((id: string, on: boolean): void => void keep(visibility.set(id, on), id), [keep, visibility])
  const chooseAll = useCallback((ids: readonly string[]): void => void keep(visibility.choose(ids), ''), [keep, visibility])

  /** Every row, searched and filtered, still under its own heading. */
  const groups = useMemo(() => {
    const wanted = (one: Surface): boolean => {
      if (showing === 'all') return true
      // An essential is on and can never be off, so "off" never offers one and "on" always does.
      const on = featureState(one.id, choice).chosen
      return showing === 'on' ? on : !on
    }
    return SURFACE_GROUPS.map((group) => ({
      ...group,
      items: rankFindables(group.items.filter(wanted).map(findable), query)
    })).filter((group) => group.items.length > 0)
  }, [choice, query, showing])

  const chosenCount = OPTIONAL_IDS.filter((id) => featureState(id, choice).chosen).length
  const suggested = STARTING_IDS.filter((id) => !isEssential(id))
  const locked = choice?.fromNewer === true
  const stuck = busy || locked || choice === null

  return (
    <section className="setting feat">
      <div className="setting-label">
        <h3>What is in your menu</h3>
        <p>
          Orbis has {OPTIONAL_IDS.length + ESSENTIAL_IDS.length} screens. Pick the ones you want to see; the rest stay
          in Orbis, out of the way, and come back the moment you switch them on.
        </p>
      </div>

      {/*
        The sentence that decides whether anybody uses this screen.

        People do not switch things off because they are not sure what they are losing. Said here, beside the
        switches, rather than somewhere it could be read afterwards.
      */}
      <p className="feat-promise">
        <Check size={14} aria-hidden="true" />
        <span>
          Switching something off only takes it out of your menu. <b>Nothing is deleted</b> — every note, board, game,
          course and saved price stays exactly where it is, and switching it back on shows all of it again.
        </span>
      </p>

      {/*
        A file Orbis could not make sense of is reported and left alone. Saying so matters: what somebody otherwise
        imagines is that their choices were quietly reset, and they were not.
      */}
      {visibility.notes.length > 0 && (
        <div className="feat-trouble" role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          <div>
            <p>Orbis could not read part of what you had chosen:</p>
            <ul>
              {visibility.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <p>Nothing was replaced, so nothing else you chose has been lost.</p>
          </div>
        </div>
      )}

      {locked && (
        <p className="feat-trouble" role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>
            A newer version of Orbis saved which features you see, and this version will not write over it — that
            would lose whatever the newer one knew. The list below is what you have; open Orbis in the newer version
            to change it.
          </span>
        </p>
      )}

      {choice === null && (
        <p className="feat-trouble" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>
            Orbis has not been able to read which features you have showing, so nothing can be switched here yet. The
            rows below say what Orbis has; none of them has been changed.
          </span>
        </p>
      )}

      <div className="feat-bar">
        <SearchBox value={query} onChange={setQuery} label="Search features" placeholder="Search by name or by what it does" small />
        <Segmented
          label="Which features to list"
          className="feat-seg"
          value={showing}
          onChange={setShowing}
          options={[
            { value: 'all', label: 'All' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' }
          ]}
        />
      </div>

      <p className="feat-count">
        <span>
          {chosenCount} of {OPTIONAL_IDS.length} switched on, and {ESSENTIAL_IDS.length} that are always there.
        </span>
        <button type="button" className="feat-link" disabled={stuck} onClick={() => chooseAll([...OPTIONAL_IDS])}>
          Turn everything on
        </button>
        <button type="button" className="feat-link" disabled={stuck} onClick={() => chooseAll([...suggested])}>
          Back to the suggested few
        </button>
      </p>

      {refused && refused.id === '' && (
        <p className="feat-trouble" role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{refused.why} Nothing was changed.</span>
        </p>
      )}

      {groups.length === 0 ? (
        <p className="view-empty">Nothing matches “{query.trim()}”.</p>
      ) : (
        groups.map((group) => (
          <div className="feat-group" key={group.id}>
            <h4>{group.label}</h4>
            <p className="feat-group-blurb">{group.blurb}</p>
            <ul>
              {group.items.map((one) => (
                <Row
                  key={one.id}
                  one={one}
                  choice={choice}
                  stuck={stuck}
                  refused={refused?.id === one.id ? refused.why : null}
                  onToggle={toggle}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  )
}

/**
 * One feature.
 *
 * Works out nothing about itself: whether it is on, whether it is showing, and the sentence for why it is not all
 * come from `featureState`, which is the only thing in Orbis that answers that question.
 */
function Row({
  one,
  choice,
  stuck,
  refused,
  onToggle
}: {
  one: Surface
  choice: VisibilityChoice | null
  stuck: boolean
  refused: string | null
  onToggle(id: string, on: boolean): void
}): React.JSX.Element {
  const state = featureState(one.id, choice)
  const Icon = one.icon
  /* On, and still not working. Both of these are drawn as trouble rather than as a feature that is fine. */
  const broken = one.missing ?? (state.chosen && !state.visible ? state.hiddenBecause : null)

  return (
    <li className={['feat-row', state.essential ? 'is-fixed' : '', broken ? 'is-broken' : ''].filter((bit) => bit !== '').join(' ')}>
      <Icon size={16} aria-hidden="true" className="feat-icon" />
      <div className="feat-what">
        <span className="feat-name">{one.label}</span>
        <span className="feat-hint">{one.hint}</span>

        {broken && (
          <span className="feat-row-trouble">
            <AlertTriangle size={13} aria-hidden="true" />
            <span>{broken}</span>
          </span>
        )}

        {/*
          What else goes with it. On the row rather than in a confirmation, because it is the part somebody has not
          thought of: hiding Markets has to take the price strip too, or they have hidden Markets and are still
          looking at Markets.
        */}
        {!state.essential && state.chosen && one.alsoHides.length > 0 && (
          <span className="feat-also">Switching this off also removes {one.alsoHides.join(', ')}.</span>
        )}

        {refused && (
          <span className="feat-row-trouble" role="alert">
            <AlertTriangle size={13} aria-hidden="true" />
            <span>{refused} Nothing was changed.</span>
          </span>
        )}
      </div>

      {state.essential ? (
        /* Not a switch that will not move. A control somebody cannot use looks like a fault; this says what it is. */
        <span className="feat-fixed" title="Part of Orbis rather than a feature you choose, so there is no switch for it.">
          <Lock size={12} aria-hidden="true" />
          Always on
        </span>
      ) : (
        <label className="switch feat-switch" title={state.chosen ? `Switch ${one.label} off` : `Switch ${one.label} on`}>
          <input
            type="checkbox"
            checked={state.chosen}
            disabled={stuck}
            aria-label={`Show ${one.label}`}
            onChange={(event) => onToggle(one.id, event.target.checked)}
          />
          <span />
        </label>
      )}
    </li>
  )
}
