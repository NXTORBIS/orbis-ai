import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle, Ban, Check, ChevronDown, ChevronRight, CircleHelp, Lightbulb, Minus, Plus, Scale, Sparkles, TrendingUp } from 'lucide-react'
import type { ChatDecision } from '../../../../shared/types'
import type { VerdictRow } from '../../../../shared/choose/explain'
import type { Change } from '../../../../shared/choose/update'
import './choose.css'

/**
 * A decision in the conversation.
 *
 * ## It is a reply, not a dashboard
 *
 * What shows by default is what somebody asked for: the answer, why, what it costs, and anything that would
 * change it. The table, the figures and the working are one click away and start closed. The brief for this was
 * explicit about it, and it is also the right shape -- a comparison that fills the screen stops being part of a
 * conversation and becomes a screen you are now in.
 *
 * ## Nothing here calculates anything
 *
 * Every number on this card was worked out in the main process from a validated structure, and arrived whole.
 * This file sorts rows and draws bars. The one thing it does send back is a *change* -- a slider moved, an option
 * dropped -- and that goes through exactly the same checks as a change somebody typed, which is why the controls
 * cannot put the decision into a state a sentence could not.
 *
 * ## The marks on the figures are the point
 *
 * A figure that is a guess is marked as a guess. An option Orion suggested rather than one that was named is
 * marked as a suggestion. An option that breaks a hard requirement is struck through and says which one. A score
 * with a lot unknown behind it shows as a range instead of a number. All of that is on the card rather than in a
 * footnote, because the alternative is a table of numbers that all look equally solid.
 */

export default function DecisionCard({
  held,
  onChange,
  onExplain,
  onKeep
}: {
  held: ChatDecision
  /**
   * Sends a change -- from a slider or a button -- to be applied and recalculated.
   *
   * The decision's own id goes with it. A conversation can hold more than one comparison, and without the id the
   * buttons on this card would change whichever one was touched most recently.
   */
  onChange?(decisionId: string, changes: Change[]): void
  /** Asks for more of this decision's working, in words. */
  onExplain?(decisionId: string, of: 'everything' | 'why-not' | 'how-it-worked' | 'what-would-change-it'): void
  /** Keeps this decision. */
  onKeep?(decisionId: string): void
}): React.JSX.Element {
  const { verdict } = held
  const [open, setOpen] = useState(held.showDetail === true)
  const [tuning, setTuning] = useState(false)

  const rows = useMemo(() => [...verdict.rows].sort((a, b) => a.place - b.place), [verdict.rows])
  /** The things being weighed, taken from the first row so the header and every row agree on the order. */
  const criteria = rows[0]?.parts ?? []

  const importance = useCallback(
    (criterionId: string, times: number) => {
      onChange?.(verdict.decisionId, [{ kind: 'importance', criterionId, times, says: times > 1 ? 'it matters more' : 'it matters less' }])
    },
    [onChange, verdict.decisionId]
  )

  const steady =
    verdict.steadiness === 'steady'
      ? 'The answer holds'
      : verdict.steadiness === 'somewhat-sensitive'
        ? 'Fairly close'
        : verdict.steadiness === 'very-sensitive'
          ? 'Could easily go the other way'
          : 'No clear winner'

  return (
    <section className="dc-card" aria-label={`Comparison: ${verdict.title}`}>
      <header className="dc-head">
        <span className="dc-mark" aria-hidden="true">
          <Scale size={15} />
        </span>
        <span className="dc-title">
          <strong>{verdict.leads ? verdict.leads.name : 'No clear answer'}</strong>
          <span>{verdict.title}</span>
        </span>
        <span className={`dc-steady dc-hold-${verdict.steadiness}`}>{steady}</span>
      </header>

      {held.scenario && (
        <p className="dc-whatif">
          <Sparkles size={13} aria-hidden="true" />
          <span>
            A what-if: <strong>{held.scenario}</strong>. Your own figures are untouched.
            {held.difference?.sameAnswer ? ' It makes no difference to the answer.' : held.difference?.leaderChanged ? ' It changes the answer.' : ''}
          </span>
        </p>
      )}

      {held.applied && held.applied.length > 0 && (
        <ul className="dc-applied">
          {held.applied.map((one) => (
            <li key={one}>
              <Check size={12} aria-hidden="true" />
              {one}
            </li>
          ))}
        </ul>
      )}
      {held.refused && held.refused.length > 0 && (
        <ul className="dc-applied dc-refused">
          {held.refused.map((one) => (
            <li key={one}>
              <Ban size={12} aria-hidden="true" />
              {one}
            </li>
          ))}
        </ul>
      )}

      {verdict.says !== '' && <p className="dc-says">{verdict.says}</p>}
      {verdict.says === '' && verdict.noLeader && <p className="dc-says">{verdict.noLeader}</p>}

      {verdict.nothingIsFeasible && (
        <p className="dc-warn">
          <AlertTriangle size={13} aria-hidden="true" />
          <span>Nothing here clears everything you said it has to, so none of these is being recommended.</span>
        </p>
      )}
      {verdict.careful && (
        <p className="dc-warn">
          <AlertTriangle size={13} aria-hidden="true" />
          <span>This is worth putting to somebody qualified as well. What is here is a way of laying it out, not advice.</span>
        </p>
      )}

      {/*
        Why the answer is not top of the table, when it is not. Above the rows on purpose: it has to be read
        before the thing it explains, and it must not be inside the part of the card that starts closed.
      */}
      {verdict.whyNotFirst && (
        <p className="dc-warn">
          <AlertTriangle size={13} aria-hidden="true" />
          <span>{verdict.whyNotFirst}</span>
        </p>
      )}

      {/* The ranking, always shown: it is the answer, not the working. */}
      <ol className="dc-rows">
        {rows.map((one) => (
          <Row key={one.alternativeId} row={one} leader={verdict.leads?.alternativeId === one.alternativeId} />
        ))}
      </ol>

      {verdict.tradeOff && (
        <p className="dc-line">
          <strong>What it costs:</strong> {verdict.tradeOff}.
        </p>
      )}
      {verdict.uncertainty && (
        <p className="dc-line">
          <strong>What could change it:</strong> {verdict.uncertainty}
        </p>
      )}
      {verdict.nextStep && (
        <p className="dc-next">
          <Lightbulb size={13} aria-hidden="true" />
          <span>{verdict.nextStep}</span>
        </p>
      )}

      {verdict.ask && (
        <p className="dc-ask">
          <CircleHelp size={13} aria-hidden="true" />
          <span>{verdict.ask}</span>
        </p>
      )}

      <div className="dc-buttons">
        <button type="button" className="dc-btn" onClick={() => setOpen((was) => !was)} aria-expanded={open}>
          {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          {open ? 'Hide the working' : 'Show the working'}
        </button>
        {onChange && criteria.length > 0 && (
          <button type="button" className="dc-btn" onClick={() => setTuning((was) => !was)} aria-expanded={tuning}>
            <TrendingUp size={13} aria-hidden="true" />
            {tuning ? 'Done' : 'Change what matters'}
          </button>
        )}
        {onExplain && (
          <button type="button" className="dc-btn" onClick={() => onExplain(verdict.decisionId, 'why-not')}>
            Why not the others?
          </button>
        )}
        {onExplain && verdict.uncertainty && (
          <button type="button" className="dc-btn" onClick={() => onExplain(verdict.decisionId, 'what-would-change-it')}>
            What would change it?
          </button>
        )}
        {onKeep && (
          <button type="button" className="dc-btn" onClick={() => onKeep(verdict.decisionId)}>
            Keep this
          </button>
        )}
      </div>

      {/*
        The importance controls.

        Each one sends a real change and the whole thing is worked out again -- there is no preview mode and no
        local copy of the weights, because a slider that moves a number on screen without moving the decision is
        the kind of control that makes people stop trusting the card.
      */}
      {tuning && onChange && (
        <div className="dc-tune">
          {criteria.map((one) => (
            <div className="dc-tune-row" key={one.criterionId}>
              <span className="dc-tune-name">{one.name}</span>
              <span className="dc-tune-bar" aria-hidden="true">
                <span style={{ width: `${Math.round(one.weight * 100)}%` }} />
              </span>
              <span className="dc-tune-pc">{Math.round(one.weight * 100)}%</span>
              <button type="button" className="dc-step" onClick={() => importance(one.criterionId, 0.6)} aria-label={`${one.name} matters less`}>
                <Minus size={12} />
              </button>
              <button type="button" className="dc-step" onClick={() => importance(one.criterionId, 1.7)} aria-label={`${one.name} matters more`}>
                <Plus size={12} />
              </button>
            </div>
          ))}
          <p className="dc-tune-note">Each change is worked out again straight away. Say &ldquo;go back to how it was&rdquo; to undo.</p>
        </div>
      )}

      {open && (
        <div className="dc-detail">
          {criteria.length > 0 && (
            <div className="dc-table" role="table" aria-label="How each option scored on each thing">
              <div className="dc-tr dc-th" role="row">
                <span role="columnheader">Option</span>
                {criteria.map((one) => (
                  <span role="columnheader" key={one.criterionId} title={`${Math.round(one.weight * 100)}% of the weight`}>
                    {one.name}
                    <i>{Math.round(one.weight * 100)}%</i>
                  </span>
                ))}
              </div>
              {rows.map((row) => (
                <div className="dc-tr" role="row" key={row.alternativeId}>
                  <span role="cell" className="dc-cell-name">
                    {row.name}
                  </span>
                  {row.parts.map((part) => (
                    <span role="cell" key={part.criterionId} className={part.raw === null ? 'dc-cell dc-nothing' : 'dc-cell'}>
                      {part.raw === null ? (
                        <em>not known</em>
                      ) : (
                        <>
                          {trim(part.raw)}
                          {part.unit ? <small> {part.unit}</small> : null}
                          {part.guessed ? <b title="a guess, not a measurement">?</b> : null}
                        </>
                      )}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}

          <p className="dc-how">{verdict.howItWorked}</p>

          {verdict.notes.length > 0 && (
            <ul className="dc-notes">
              {verdict.notes.map((one) => (
                <li key={one}>{one}</li>
              ))}
            </ul>
          )}

          {verdict.assumptions.length > 0 && (
            <div className="dc-block">
              <h4>Taken as true</h4>
              <ul>
                {verdict.assumptions.map((one) => (
                  <li key={one}>{one}</li>
                ))}
              </ul>
            </div>
          )}

          {verdict.gaps.length > 0 && (
            <div className="dc-block">
              <h4>Still not known</h4>
              <ul>
                {verdict.gaps.map((one) => (
                  <li key={one.asks}>
                    {one.asks}
                    <span className={`dc-worth dc-${one.worth ?? 'not-tested'}`}>
                      {one.worth === 'would-decide-it'
                        ? 'would decide it'
                        : one.worth === 'could-change-it'
                          ? 'could change it'
                          : one.worth === 'would-not-change-it'
                            ? 'would not change the answer'
                            : 'not tested'}
                    </span>
                    {one.howToFind ? <em> {one.howToFind}</em> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {onExplain && (
            <div className="dc-buttons">
              <button type="button" className="dc-btn" onClick={() => onExplain(verdict.decisionId, 'everything')}>
                Talk me through all of it
              </button>
              <button type="button" className="dc-btn" onClick={() => onExplain(verdict.decisionId, 'how-it-worked')}>
                How was this worked out?
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** One option's row: its place, its name, its bar and what is wrong with it. */
function Row({ row, leader }: { row: VerdictRow; leader: boolean }): React.JSX.Element {
  const ruledOut = row.feasible === 'fails'
  return (
    <li className={`dc-row${leader ? ' dc-leads' : ''}${ruledOut ? ' dc-out' : ''}`}>
      <span className="dc-place">{ruledOut ? <Ban size={12} aria-hidden="true" /> : row.place}</span>
      <span className="dc-name">
        <strong>{row.name}</strong>
        <span className="dc-tags">
          {row.suggested && <em className="dc-tag">a suggestion</em>}
          {row.tied && !ruledOut && <em className="dc-tag">tied</em>}
          {row.feasible === 'unknown' && <em className="dc-tag dc-tag-warn">cannot tell yet</em>}
          {row.feasible === 'conditional' && <em className="dc-tag dc-tag-warn">only just</em>}
          {row.known < 100 && <em className="dc-tag">{row.known}% known</em>}
        </span>
        {ruledOut && row.breaks.length > 0 && <span className="dc-breaks">Ruled out: {row.breaks.join('; ')}</span>}
      </span>
      {/*
        The bar is the score, and the lighter part behind it is the range -- how high this option could go if what
        is unknown about it turned out well. An option judged on half of what matters shows a wide band, which is
        the honest picture of a figure resting on half the evidence.
      */}
      <span className="dc-bar" aria-hidden="true">
        {row.range && <span className="dc-band" style={{ left: `${row.range.low}%`, width: `${Math.max(1, row.range.high - row.range.low)}%` }} />}
        <span className="dc-fill" style={{ width: `${row.outOf100}%` }} />
      </span>
      <span className="dc-score">{row.range ? `${row.range.low}–${row.range.high}` : row.outOf100}</span>
    </li>
  )
}

/** A number as somebody would write it. No trailing zeroes and no invented precision. */
function trim(value: number): string {
  if (Number.isInteger(value)) return String(value)
  if (Math.abs(value) >= 100) return String(Math.round(value))
  return String(Math.round(value * 10) / 10)
}
