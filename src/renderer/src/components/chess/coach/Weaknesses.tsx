import { Button } from '../../../ui'
import { ACTIVITIES, activePlan, dismissedPlan, type StudyPlan, type WeaknessProfile } from '../../../../../shared/chess/coach'

/**
 * What the record shows, with the record shown next to it.
 *
 * Every weakness is drawn with the observations it rests on -- how many times, out of how many chances -- because a
 * list of confident sentences with no counts behind them is indistinguishable from a horoscope. The refusals get the
 * same room as the findings: "not enough games yet to tell, three of the five needed" is the most useful thing this
 * screen can say in its first week, and hiding it would leave the screen looking merely empty.
 */

const percent = (rate: number): string => `${Math.round(rate * 100)}%`

export function Weaknesses({
  profile,
  plan,
  onRestore
}: {
  profile: WeaknessProfile
  plan: StudyPlan
  onRestore: (id: string) => void
}): React.JSX.Element {
  const showing = new Set(activePlan(plan).map((one) => one.weaknessId).filter((one): one is string => one !== undefined))
  const asideIds = new Map(dismissedPlan(plan).filter((one) => one.weaknessId !== undefined).map((one) => [one.weaknessId as string, one.id]))

  return (
    <div className="cw-co-pane">
      <p className="cw-co-lead" role="status">{profile.says}</p>

      {profile.weaknesses.length > 0 && (
        <>
          <h4 className="cw-co-title">What the record shows</h4>
          <p className="cw-co-dim">
            In the order they are worth looking at, which is not an order of size: these rates are not on one scale and
            nothing here pretends they are.
          </p>
          <ul className="cw-co-weaknesses">
            {profile.weaknesses.map((weakness) => {
              const aside = asideIds.get(weakness.id)
              return (
                <li key={weakness.id} className="cw-co-weakness">
                  <div className="cw-co-weakness-top">
                    <strong>{weakness.label}</strong>
                    <span className="cw-co-rate">{percent(weakness.rate)}</span>
                  </div>
                  <p className="cw-co-because">{weakness.because}</p>
                  <ul className="cw-co-evidence">
                    {weakness.evidence.map((observation, index) => (
                      <li key={`${weakness.id}-${index}`}>
                        <span className="cw-co-count">{observation.hits} of {observation.of}</span>
                        <span className="cw-co-dim">{observation.says}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="cw-co-dim">{weakness.explain}</p>
                  <p className="cw-co-works-on">
                    Worked on by: <strong>{ACTIVITIES[weakness.activity].label}</strong>. What would show whether it
                    helped: {ACTIVITIES[weakness.activity].records}.
                  </p>
                  {aside !== undefined
                    ? (
                      <p className="cw-co-aside-note">
                        You put this aside on your plan.
                        <Button size="tiny" kind="quiet" onClick={() => onRestore(aside)}>Put it back</Button>
                      </p>
                    )
                    : showing.has(weakness.id)
                      ? <p className="cw-co-dim">On your study plan.</p>
                      : null}
                </li>
              )
            })}
          </ul>
        </>
      )}

      {profile.refusals.length > 0 && (
        <>
          <h4 className="cw-co-title">What cannot be told yet</h4>
          <ul className="cw-co-refusals">
            {profile.refusals.map((refusal, index) => (
              <li key={`${refusal.about}-${index}`}>
                <strong>{refusal.about}</strong>
                <span>{refusal.says}</span>
                <span className="cw-co-dim">{refusal.have} of {refusal.need} needed</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h4 className="cw-co-title">What this is not</h4>
      <ul className="cw-co-caveats">
        {profile.cannotSay.map((line, index) => <li key={`cannot-${index}`}>{line}</li>)}
      </ul>

      <details className="cw-co-numbers">
        <summary>What was counted, and how a phase is decided</summary>
        <ul className="cw-co-counted">
          <li>{profile.counted.games} games analysed deeply enough to count</li>
          <li>{profile.counted.judgedMoves} of your own moves the engine could judge</li>
          <li>{profile.counted.unjudgedMoves} of your own moves it could not judge, left out of every rate</li>
          <li>{profile.counted.trainingAttempts} training attempts</li>
          <li>{profile.counted.reviewAttempts} review attempts</li>
          <li>{profile.counted.openingAttempts} opening lines played back from memory</li>
        </ul>
        <p className="cw-co-dim">{profile.phaseRule}</p>
      </details>
    </div>
  )
}
