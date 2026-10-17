import {
  NO_PLAYING_RATING, monthWords, scoreShare, tallyWords, type ArchiveNumbers, type GroupTally, type MonthTally,
  type Tally
} from '../../../../../shared/chess/archive'

/**
 * Your numbers, every one of them counted off your own saved games.
 *
 * There is no figure on this screen that is not a count of something in the archive, and there is no figure that
 * stands in for one that could not be counted. Where something cannot be worked out, the screen says so in a
 * sentence and says how many games are behind the gap -- "412 of your games do not say how they ended" is a real
 * answer and tells a person what to do about it. A chart with an invented bar in it would be worse than no chart.
 *
 * The arithmetic is in `src/shared/chess/archive.ts` and is tested there. This file draws it.
 */

/** A share drawn as a bar. Nothing to measure means stripes and no bar, never a bar at nought. */
function Bar({ tally }: { tally: Tally }): React.JSX.Element {
  if (tally.decided === 0) {
    return <span className="cw-lb-bar is-nothing" title="No game in this group has a result, so there is nothing to measure." aria-hidden="true" />
  }
  const w = (tally.wins / tally.decided) * 100
  const d = (tally.draws / tally.decided) * 100
  const l = (tally.losses / tally.decided) * 100
  return (
    <span className="cw-lb-bar" aria-hidden="true">
      <span className="cw-lb-bar-w" style={{ width: `${w}%` }} />
      <span className="cw-lb-bar-d" style={{ width: `${d}%` }} />
      <span className="cw-lb-bar-l" style={{ width: `${l}%` }} />
    </span>
  )
}

const percent = (tally: Tally): string => {
  const share = scoreShare(tally)
  return share === null ? '—' : `${Math.round(share * 100)}%`
}

/** One headline: a name, the bar, the score and the counts said in words for anybody who cannot see the bar. */
function Head({ name, tally }: { name: string; tally: Tally }): React.JSX.Element {
  return (
    <div className="cw-lb-head">
      <span className="cw-lb-head-name">{name}</span>
      <span className="cw-lb-head-n">{tally.played}</span>
      <Bar tally={tally} />
      <span className="cw-lb-head-score">{percent(tally)}</span>
      <span className="cw-lb-sr">{tallyWords(tally)}</span>
    </div>
  )
}

/** Results month by month. Only months with games are drawn, so there are no empty bars standing for nothing. */
function OverTime({ months }: { months: readonly MonthTally[] }): React.JSX.Element {
  const tallest = months.reduce((most, one) => Math.max(most, one.played), 0)
  return (
    <ol className="cw-lb-months" aria-label="Results month by month">
      {months.map((one) => (
        <li key={one.month} className="cw-lb-month" title={`${monthWords(one.month)}: ${tallyWords(one)}`}>
          <span className="cw-lb-month-stack" aria-hidden="true" style={{ height: `${Math.max(4, (one.played / tallest) * 100)}%` }}>
            <span className="cw-lb-month-w" style={{ flexGrow: one.wins }} />
            <span className="cw-lb-month-d" style={{ flexGrow: one.draws }} />
            <span className="cw-lb-month-l" style={{ flexGrow: one.losses }} />
            <span className="cw-lb-month-u" style={{ flexGrow: one.unfinished }} />
          </span>
          <span className="cw-lb-month-name">{one.month.slice(5)}</span>
          <span className="cw-lb-sr">{monthWords(one.month)}: {tallyWords(one)}</span>
        </li>
      ))}
    </ol>
  )
}

function Groups({ list, label, limit = 8 }: { list: readonly GroupTally[]; label: string; limit?: number }): React.JSX.Element {
  return (
    <table className="cw-lb-grouptable" aria-label={label}>
      <thead>
        <tr><th scope="col">{label}</th><th scope="col">Games</th><th scope="col">W–D–L</th><th scope="col">Score</th></tr>
      </thead>
      <tbody>
        {list.slice(0, limit).map((one) => (
          <tr key={`${one.code}|${one.label}`}>
            <th scope="row">
              {one.code && <span className="cw-lb-eco">{one.code}</span>}
              {one.label}
            </th>
            <td className="cw-lb-mono">{one.played}</td>
            <td className="cw-lb-wdl">
              <span className="cw-lb-mono">{one.wins}–{one.draws}–{one.losses}</span>
              <Bar tally={one} />
            </td>
            <td className="cw-lb-mono">{percent(one)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export interface NumbersPanelProps {
  numbers: ArchiveNumbers
  /** Who the figures are about, said at the top so nothing is anonymous. */
  whoWords: string
  /** Put a game on the board. Used by the best-wins list, so every row here leads somewhere. */
  onSelect: (id: string) => void
}

export function NumbersPanel({ numbers, whoWords, onSelect }: NumbersPanelProps): React.JSX.Element {
  const n = numbers
  return (
    <div className="cw-lb-numbers">
      <section className="cw-lb-card">
        <h3 className="cw-lb-card-title">Your record</h3>
        <p className="cw-lb-about">{whoWords}</p>
        <Head name="Everything" tally={n.all} />
        <Head name="As White" tally={n.asWhite} />
        <Head name="As Black" tally={n.asBlack} />
        <ul className="cw-lb-facts">
          <li><span>Games counted</span><strong>{n.counted}</strong></li>
          <li><span>Longest run of wins</span><strong>{n.longestWinStreak}</strong></li>
          <li><span>On now</span><strong>{n.currentWinStreak}</strong></li>
          <li><span>Average length</span><strong>{n.averageMoves === null ? '—' : `${n.averageMoves} moves`}</strong></li>
        </ul>
        {n.sideNotRecorded > 0 && (
          <p className="cw-lb-gap">
            {n.sideNotRecorded} {n.sideNotRecorded === 1 ? 'game is' : 'games are'} not counted above, because
            {n.sideNotRecorded === 1 ? ' its record does not' : ' their records do not'} say which side you were.
            Picking a different name at the top may count {n.sideNotRecorded === 1 ? 'it' : 'them'}.
          </p>
        )}
      </section>

      <section className="cw-lb-card">
        <h3 className="cw-lb-card-title">Month by month</h3>
        {n.overTime.length === 0
          ? <p className="cw-lb-gap">None of your counted games carries a month, so there is nothing to put on a timeline.</p>
          : <OverTime months={n.overTime} />}
        {n.undated > 0 && (
          <p className="cw-lb-gap">
            {n.undated} {n.undated === 1 ? 'game has' : 'games have'} no month written down, so
            {n.undated === 1 ? ' it is' : ' they are'} in none of these bars.
          </p>
        )}
      </section>

      <section className="cw-lb-card">
        <h3 className="cw-lb-card-title">By opening</h3>
        {n.byOpening.length === 0
          ? <p className="cw-lb-gap">No counted game has an opening name, from its own file or from the openings dataset.</p>
          : <Groups list={n.byOpening} label="Opening" />}
        {n.openingNotNamed > 0 && (
          <p className="cw-lb-gap">{n.openingNotNamed} counted {n.openingNotNamed === 1 ? 'game is' : 'games are'} in no group: nothing names the opening.</p>
        )}
      </section>

      <section className="cw-lb-card">
        <h3 className="cw-lb-card-title">How they ended</h3>
        {n.byEnding.length === 0
          ? <p className="cw-lb-gap">No counted game says how it ended beyond the result itself.</p>
          : <Groups list={n.byEnding} label="Ending" />}
        {n.endingNotRecorded > 0 && (
          <p className="cw-lb-gap">{n.endingNotRecorded} counted {n.endingNotRecorded === 1 ? 'game does' : 'games do'} not say how it ended.</p>
        )}
      </section>

      <section className="cw-lb-card">
        <h3 className="cw-lb-card-title">Your best wins</h3>
        {n.bestWins.length === 0
          ? (
            <p className="cw-lb-gap">
              {n.ratingsRecorded === 0
                ? 'None of your games records a rating for the other player, so there is no measure of which win was the best one. Nothing is ranked here by guesswork.'
                : 'None of the games with a recorded opponent rating is a win yet.'}
            </p>
          )
          : (
            <ol className="cw-lb-wins">
              {n.bestWins.map((row) => (
                <li key={row.id}>
                  <button type="button" className="cw-lb-win" onClick={() => onSelect(row.id)}>
                    <span className="cw-lb-mono">{row.opponentRating}</span>
                    <span>{row.opponent ?? 'an unnamed player'}</span>
                    <span className="cw-lb-faint">{row.date.text || 'no date'}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        <p className="cw-lb-about">
          Ranked by the rating written in the game record, which is the only measure of an opponent Orbis has.
          {n.ratingsRecorded} of {n.counted} counted games carry one.
        </p>
      </section>

      <section className="cw-lb-card">
        <h3 className="cw-lb-card-title">Marks on your moves</h3>
        {n.marks.length === 0
          ? (
            <p className="cw-lb-gap">
              None of your games carries a mark on one of your own moves. These counts come from the ? and ?? marks
              written in the game files themselves, so a game nobody has annotated adds nothing. To have a move
              judged, open a game in Game Review, where the engine measures it.
            </p>
          )
          : (
            <>
              <ul className="cw-lb-marks">
                {n.marks.map((one) => (
                  <li key={one.symbol}>
                    <span className="cw-lb-mark">{one.symbol}</span>
                    <span>{one.meaning}</span>
                    <strong>{one.count}</strong>
                    <span className="cw-lb-faint">in {one.games} {one.games === 1 ? 'game' : 'games'}</span>
                  </li>
                ))}
              </ul>
              <p className="cw-lb-about">
                Counted from the marks written in the game files, on your moves only. {n.markedGames} of {n.counted}
                {' '}counted games carry any. Nothing here is Orbis's own judgement of a move.
              </p>
            </>
          )}
      </section>

      <section className="cw-lb-card">
        <h3 className="cw-lb-card-title">A rating</h3>
        <p className="cw-lb-gap">{NO_PLAYING_RATING}</p>
      </section>
    </div>
  )
}

export default NumbersPanel
