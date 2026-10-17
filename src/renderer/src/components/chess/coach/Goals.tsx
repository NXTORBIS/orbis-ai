import { Button } from '../../../ui'
import type { ChallengeBoard, ChallengeStanding, GoalStanding } from '../../../../../shared/chess/challenges'

/**
 * Goals, challenges, the run of days, and the switch that turns the lot off.
 *
 * Two things are deliberate. Every bar carries the rule it is counted by, reachable in a line underneath, because a
 * bar at two-thirds with no stated rule invites an argument nobody can settle. And the switch is at the top rather
 * than buried in a settings screen: this is the part of the coach most likely to be unwanted, and `challenges.ts`
 * computes nothing at all when it is off, so turning it off costs nothing and loses nothing.
 */

function Bar({ done, target, fraction }: { done: number; target: number; fraction: number }): React.JSX.Element {
  return (
    <div
      className="cw-co-bar-track"
      role="progressbar"
      aria-valuenow={Math.min(done, target)}
      aria-valuemin={0}
      aria-valuemax={target}
      aria-label={`${done} of ${target}`}
    >
      <span className="cw-co-bar-fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
    </div>
  )
}

function StandingRow({ standing, label, why }: { standing: GoalStanding; label: string; why?: string }): React.JSX.Element {
  return (
    <li className={`cw-co-goal${standing.complete ? ' cw-co-done' : ''}`}>
      <div className="cw-co-goal-top">
        <strong>{label}</strong>
        <span className="cw-co-count">{standing.done} / {standing.target}</span>
      </div>
      <Bar done={standing.done} target={standing.target} fraction={standing.fraction} />
      {why && <p className="cw-co-dim">{why}</p>}
      <p className="cw-co-dim">{standing.says}</p>
      <details className="cw-co-numbers">
        <summary>How this is counted</summary>
        <p className="cw-co-dim">{standing.goal.rule}</p>
        <ul className="cw-co-counted">
          <li>{standing.counted} sittings counted</li>
          <li>{standing.ignored.noWork} opened again without producing anything</li>
          <li>{standing.ignored.duplicate} duplicate records of one sitting</li>
          <li>{standing.ignored.future} timed later than now</li>
          <li>{standing.ignored.otherPeriod} from another {standing.goal.period}</li>
          <li>{standing.ignored.otherActivity} at something this goal is not about</li>
        </ul>
      </details>
    </li>
  )
}

const challengeRows = (list: readonly ChallengeStanding[]): React.JSX.Element[] =>
  list.map((one) => <StandingRow key={one.challenge.id} standing={one.standing} label={one.challenge.label} why={one.challenge.why} />)

export function Goals({
  board,
  onSwitch
}: {
  board: ChallengeBoard
  onSwitch: (on: boolean) => void
}): React.JSX.Element {
  return (
    <div className="cw-co-pane">
      <div className="cw-co-switch">
        <Button size="small" on={board.on} onClick={() => onSwitch(!board.on)}>
          {board.on ? 'Goals and challenges are on' : 'Goals and challenges are off'}
        </Button>
        <span className="cw-co-dim">{board.on ? 'Press to switch them off.' : 'Press to switch them on.'}</span>
      </div>

      {!board.on
        ? (
          <>
            <p className="cw-co-lead" role="status">{board.says}</p>
            <ul className="cw-co-caveats">
              {board.offMeans.map((line, index) => <li key={`off-${index}`}>{line}</li>)}
            </ul>
          </>
        )
        : (
          <>
            <p className="cw-co-lead" role="status">{board.says}</p>

            {board.streak && (
              <section className="cw-co-streak" aria-label="Your run of days">
                <p className="cw-co-streak-top">
                  <strong className="cw-co-streak-number">{board.streak.current}</strong>
                  <span>{board.streak.current === 1 ? 'day in a row' : 'days in a row'}</span>
                  <span className="cw-co-dim">longest in the last {board.streak.looked} days: {board.streak.longest}</span>
                </p>
                <p className="cw-co-dim">{board.streak.says}</p>
                <ol className="cw-co-days" aria-label="The last fortnight, newest first">
                  {board.streak.periods.slice(0, 14).map((day) => (
                    <li
                      key={day.key}
                      className={`cw-co-day${day.met ? ' cw-co-met' : ''}${day.current ? ' cw-co-today' : ''}`}
                      title={`${day.label}: ${day.done} of ${board.streak?.goal.target ?? 0}${day.current ? ', still open' : ''}`}
                    >
                      <span className="cw-co-day-name">{day.label.split(' ').slice(0, 2).join(' ')}</span>
                      <span className="cw-co-day-count">{day.done}</span>
                    </li>
                  ))}
                </ol>
                <details className="cw-co-numbers">
                  <summary>What a run cannot be got from</summary>
                  <ul className="cw-co-caveats">
                    {board.streakRules.map((line, index) => <li key={`sr-${index}`}>{line}</li>)}
                  </ul>
                  <ul className="cw-co-counted">
                    <li>{board.streak.ignored.noWork} sittings produced nothing</li>
                    <li>{board.streak.ignored.duplicate} duplicate records</li>
                    <li>{board.streak.ignored.future} timed later than now</li>
                    <li>{board.streak.ignored.lateRecord} written down after their own day had closed</li>
                    <li>{board.streak.ignored.otherActivity} at something that is not practice</li>
                  </ul>
                </details>
              </section>
            )}

            <h4 className="cw-co-title">Today — {board.today.label}</h4>
            <ul className="cw-co-goals">{challengeRows(board.daily)}</ul>

            {board.fromPlan.length > 0 && (
              <>
                <h4 className="cw-co-title">From your study plan</h4>
                <ul className="cw-co-goals">{challengeRows(board.fromPlan)}</ul>
              </>
            )}

            <h4 className="cw-co-title">This week — {board.thisWeek.label}</h4>
            <ul className="cw-co-goals">{challengeRows(board.weekly)}</ul>

            <h4 className="cw-co-title">Standing goals</h4>
            <ul className="cw-co-goals">
              {board.goals.map((one) => <StandingRow key={one.goal.id} standing={one} label={one.goal.label} />)}
            </ul>

            <h4 className="cw-co-title">Achievements</h4>
            <ul className="cw-co-achievements">
              {board.achievements.map((one) => (
                <li key={one.achievement.id} className={one.met ? 'cw-co-met' : ''}>
                  <div className="cw-co-goal-top">
                    <strong>{one.achievement.label}</strong>
                    <span className="cw-co-count">{one.done} / {one.target}</span>
                  </div>
                  <Bar done={one.done} target={one.target} fraction={one.target > 0 ? one.done / one.target : 0} />
                  <p className="cw-co-dim">{one.achievement.condition}</p>
                </li>
              ))}
            </ul>

            <details className="cw-co-numbers">
              <summary>When a day begins and ends</summary>
              <ul className="cw-co-caveats">
                {board.dayRules.map((line, index) => <li key={`dr-${index}`}>{line}</li>)}
              </ul>
            </details>
          </>
        )}
    </div>
  )
}
