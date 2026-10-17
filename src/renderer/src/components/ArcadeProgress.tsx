import { useMemo, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronUp, Flame, Info, Lock, Play, Shuffle, Target, Trophy } from 'lucide-react'
import type { GameId } from '../../../shared/offlineGames'
import { GAMES, gameInfo } from '../../../shared/offlineGames'
import { arcadeBoard } from '../../../shared/games/arcade'
import type { DayRules } from '../../../shared/games/calendar'
import type { ChallengeStanding } from '../../../shared/games/daily'
import type { KeptArcade } from '../../../shared/games/kept'

/**
 * How you are getting on: the level and what it cost, the day's challenge, the run of days, where each game stands,
 * and what has opened.
 *
 * Every figure is shown with the rule it came from, because that is the whole bargain -- the arcade may keep a number
 * about you only if you can read how it was worked out. The rules live beside the arithmetic in `src/shared/games/`
 * and this screen asks for them rather than restating them, so a rule cannot be changed in one place and go on being
 * described the old way in the other.
 *
 * Nothing is drawn as nought. A game never played has no standing, not an empty bar; a challenge that has not been
 * earned yet is not shown greyed out with somebody else's progress in it; and an unlock says what it takes and what
 * it will do rather than teasing.
 *
 * ## Worked out once, from the record
 *
 * The board is one pass over the record. It is held between renders because the library around it re-sorts thirty-two
 * cards on every keystroke in the search box, and the run of days is a hundred and twenty days of counting.
 */

interface Props {
  kept: KeptArcade
  rules: DayRules
  /** Which goal the run of days is held to. */
  onGoal(id: string): void
  /** Opens a game. `run` carries the day's seed, for a game that lays its board out from one. */
  onPlay(gameId: GameId, run?: { seed: number | null; challengeId: string }): void
}

function Why({ label, lines }: { label: string; lines: readonly string[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <span className="og-why">
      <button
        type="button"
        className="og-icon-btn small"
        aria-expanded={open}
        aria-label={open ? `Hide how ${label} is worked out` : `How ${label} is worked out`}
        onClick={() => setOpen((v) => !v)}
      >
        <Info size={13} />
      </button>
      {open && (
        <ul className="og-why-list">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </span>
  )
}

const Bar = ({ fraction }: { fraction: number }): React.JSX.Element => (
  <span className="og-bar" aria-hidden>
    <span className="og-bar-fill" style={{ width: `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` }} />
  </span>
)

function Challenge({ standing, onPlay }: { standing: ChallengeStanding; onPlay: Props['onPlay'] }): React.JSX.Element {
  const { challenge } = standing
  return (
    <div className={`og-chal${standing.complete ? ' done' : ''}`}>
      <div className="og-chal-top">
        <b>{challenge.label}</b>
        {standing.complete && <span className="og-chal-done">Done</span>}
      </div>
      <p className="og-muted">{challenge.why}</p>
      <Bar fraction={standing.fraction} />
      <p className="og-muted">
        {standing.says} <Why label="this challenge" lines={[challenge.rule, challenge.says]} />
      </p>
      {challenge.gameId && (
        <button
          type="button"
          className="og-btn small primary"
          onClick={() => onPlay(challenge.gameId!, { seed: challenge.seed, challengeId: challenge.id })}
        >
          <Play size={13} /> Play {gameInfo(challenge.gameId).name}
          {challenge.fixedLayout ? " (today's board)" : ''}
        </button>
      )}
    </div>
  )
}

export function ArcadeProgress({ kept, rules, onGoal, onPlay }: Props): React.JSX.Element {
  const [more, setMore] = useState(false)
  const board = useMemo(
    () => arcadeBoard({ record: kept.record, now: Date.now(), rules, goalId: kept.goalId ?? undefined, libraryGames: GAMES.length }),
    [kept.record, kept.goalId, rules]
  )
  const { level } = board.progression

  return (
    <section className="og-prog" aria-label="How you are getting on">
      <div className="og-prog-top">
        <div className="og-prog-card">
          <span className="og-prog-rank">
            <Trophy size={14} /> {level.rank.name}
          </span>
          <b className="og-prog-number">Level {level.level}</b>
          <Bar fraction={level.fraction} />
          <p className="og-muted">
            {level.says} <Why label="the level" lines={[level.rule, ...level.pointRules]} />
          </p>
          {level.nextRank && (
            <p className="og-muted">
              {level.nextRank.name} at level {level.nextRank.from}.
            </p>
          )}
        </div>

        <div className="og-prog-card">
          <span className="og-prog-rank">
            <Flame size={14} /> {board.goal.label}
          </span>
          <b className="og-prog-number">
            {board.streak.current} {board.streak.current === 1 ? 'day' : 'days'}
          </b>
          <p className="og-muted">
            {board.streak.says} <Why label="the run of days" lines={[board.goal.rule, ...board.streakRules, ...board.calendarRules]} />
          </p>
          <p className="og-muted">
            Today {board.todayGoal.done} of {board.todayGoal.target}. Longest run {board.streak.longest}
            {board.streak.coversFrom === null ? '.' : ', over the days still kept one by one.'}
          </p>
          {board.goalChoices.length > 1 && (
            <label className="og-setting">
              <span>Hold the run to</span>
              <select value={board.goal.id} onChange={(e) => onGoal(e.target.value)}>
                {board.goalChoices.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {board.goalNotOpen && <p className="og-muted">That goal has not opened yet, so the simple one is being counted.</p>}
        </div>
      </div>

      {board.challenges.length > 0 ? (
        <div className="og-prog-block">
          <h4>
            <CalendarDays size={14} /> {board.today.label}
          </h4>
          <div className="og-chal-row">
            {board.challenges.map((one) => (
              <Challenge key={one.challenge.id} standing={one} onPlay={onPlay} />
            ))}
          </div>
        </div>
      ) : (
        <p className="og-muted">{board.says}</p>
      )}

      <button type="button" className="og-btn small" aria-expanded={more} onClick={() => setMore((v) => !v)}>
        {more ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {more ? 'Less' : 'What opens, and where each game stands'}
      </button>

      {more && (
        <>
          {board.mixed && (
            <div className="og-prog-block">
              <h4>
                <Shuffle size={14} /> Today&apos;s mixed round
              </h4>
              <p className="og-muted">Five games picked by today&apos;s seed, in this order. The same five all day.</p>
              <div className="og-recent-row">
                {board.mixed.map((id, at) => (
                  <button key={id} type="button" className="og-chip" onClick={() => onPlay(id)}>
                    {at + 1}. <span aria-hidden>{gameInfo(id).icon}</span> {gameInfo(id).name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {board.pastDays && (
            <div className="og-prog-block">
              <h4>
                <CalendarDays size={14} /> The last seven days
              </h4>
              <p className="og-muted">
                Each day&apos;s challenge is worked out from that day&apos;s own date, so an old one can still be played exactly as it was.
              </p>
              <ul className="og-past">
                {board.pastDays.map(({ day, standings }) => (
                  <li key={day.key}>
                    <span className="og-past-day">{day.label}</span>
                    {standings.map((one) => (
                      <span key={one.challenge.id} className="og-past-chal">
                        <span aria-hidden>{one.complete ? '✓' : '·'}</span> {one.challenge.label}
                        {one.challenge.gameId && (
                          <button
                            type="button"
                            className="og-btn small"
                            onClick={() => onPlay(one.challenge.gameId!, { seed: one.challenge.seed, challengeId: one.challenge.id })}
                          >
                            Play
                          </button>
                        )}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="og-prog-block">
            <h4>
              <Target size={14} /> What opens as you play
            </h4>
            <ul className="og-unlocks">
              {board.unlocks.map(({ unlock, open, done, target, fraction, says }) => (
                <li key={unlock.id} className={open ? 'open' : undefined}>
                  <span className="og-unlock-name">
                    {open ? <Trophy size={13} /> : <Lock size={13} />} {unlock.label}
                  </span>
                  <span className="og-muted">{says}</span>
                  {!open && (
                    <>
                      <Bar fraction={fraction} />
                      <span className="og-muted">
                        {done} of {target}. Then: {unlock.does}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {board.progression.mastery.length > 0 && (
            <div className="og-prog-block">
              <h4>
                <Trophy size={14} /> Where each game stands
              </h4>
              <p className="og-muted">
                {board.progression.says} A game you have never opened is not listed, because there is nothing measured to list.
              </p>
              <table className="og-mastery">
                <thead>
                  <tr>
                    <th scope="col">Game</th>
                    <th scope="col">Standing</th>
                    <th scope="col">Finished</th>
                    <th scope="col">Records beaten</th>
                    <th scope="col">What is next</th>
                  </tr>
                </thead>
                <tbody>
                  {board.progression.mastery.map((one) => (
                    <tr key={one.gameId}>
                      <th scope="row">
                        <span aria-hidden>{gameInfo(one.gameId).icon}</span> {gameInfo(one.gameId).name}
                      </th>
                      <td>{one.label}</td>
                      <td>
                        {one.summary.finished} of {one.summary.plays}
                      </td>
                      <td>{one.summary.bests}</td>
                      <td className="og-muted">
                        {one.next
                          ? `${one.next.label}: ${one.next.needs
                              .filter((need) => need.done < need.target)
                              .map((need) => `${need.done} of ${need.target} ${need.label}`)
                              .join(', ')}`
                          : 'Nothing further to reach.'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default ArcadeProgress
