import { Clock, Flame, Gamepad2, Trophy } from 'lucide-react'
import type { GameId } from '../../../shared/offlineGames'
import { gameInfo } from '../../../shared/offlineGames'
import type { DayRules } from '../../../shared/games/calendar'
import type { KeptArcade } from '../../../shared/games/kept'
import { spellScore, spellTime } from '../../../shared/games/kept'
import { arcadeStats, daysPlayed, gameBoard, topByTime } from '../../../shared/games/boards'
import { KEEP_PLAYS } from '../../../shared/games/record'

/**
 * The boards: what you have done across the arcade, and what you have done at one game.
 *
 * Every figure here is counted from the record rather than kept beside it. Nothing is stored as "most played" or
 * "best day" -- those are read off the same rows the arcade already has, so there is one answer to each question
 * instead of two that drift apart the first time a read drops a row.
 *
 * Local only, and that is the point rather than a limitation. There is no account, nothing is sent anywhere, and a
 * high score here is a fact about this profile on this computer.
 *
 * ## Where a figure covers less than everything, it says so
 *
 * The run list keeps four hundred runs one by one and adds the older ones up, and the summary it adds them up into
 * carries plays and finishes but not seconds -- a run's length is on the run. So once somebody has played more than
 * four hundred times, "time played" covers the runs still kept. That is said on the screen rather than left for
 * somebody to discover when the figure stops going up.
 */

const spellWhen = (at: number | undefined): string => (at !== undefined && at > 0 ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—')

export function ArcadeStats({ kept, rules, onOpen }: { kept: KeptArcade; rules: DayRules; onOpen(id: GameId): void }): React.JSX.Element {
  const stats = arcadeStats(kept, rules)
  const top = topByTime(kept, 5)
  const days = daysPlayed(kept, rules)

  if (stats.plays === 0) {
    return (
      <div className="og-stats">
        <p className="og-muted">
          Nothing played yet. Finish a game and your best score, your last runs and how long you have played will all be here — kept in this profile on this computer, and nowhere else.
        </p>
      </div>
    )
  }

  return (
    <div className="og-stats">
      <div className="og-tiles">
        <div className="og-tile">
          <small>Games finished</small>
          <b>
            {stats.gamesFinished} of {stats.gamesAvailable}
          </b>
          <span className="og-muted">{stats.gamesPlayed} opened</span>
        </div>
        <div className="og-tile">
          <small>Runs finished</small>
          <b>{stats.finished.toLocaleString()}</b>
          <span className="og-muted">{stats.plays.toLocaleString()} started</span>
        </div>
        <div className="og-tile">
          <small>Time played</small>
          <b>
            <Clock size={13} aria-hidden /> {spellTime(stats.ms)}
          </b>
          {stats.rolledUp && <span className="og-muted">across your last {KEEP_PLAYS} runs</span>}
        </div>
        {stats.mostPlayed && (
          <div className="og-tile">
            <small>You play this most</small>
            <b>{stats.mostPlayed.name}</b>
            <span className="og-muted">{spellTime(stats.mostPlayed.ms)}</span>
          </div>
        )}
        {stats.mostFinished && (
          <div className="og-tile">
            <small>You finish this most</small>
            <b>{stats.mostFinished.name}</b>
            <span className="og-muted">
              {stats.mostFinished.finished} run{stats.mostFinished.finished === 1 ? '' : 's'}
            </span>
          </div>
        )}
        {stats.bestDay && (
          <div className="og-tile">
            <small>Your best day</small>
            <b>{stats.bestDay.label}</b>
            <span className="og-muted">
              {stats.bestDay.ms > 0 ? `${spellTime(stats.bestDay.ms)} · ` : ''}
              {stats.bestDay.finished} run{stats.bestDay.finished === 1 ? '' : 's'}
            </span>
          </div>
        )}
        <div className="og-tile">
          <small>Days played</small>
          <b>
            <Flame size={13} aria-hidden /> {stats.days}
          </b>
          {days[0] && <span className="og-muted">last on {days[0].label}</span>}
        </div>
      </div>

      {top.length > 0 && (
        <div className="og-top">
          <small>Where the time goes</small>
          {top.map((one) => (
            <button key={one.gameId} type="button" className="og-top-row" onClick={() => onOpen(one.gameId)}>
              <span className="og-top-name">
                <span aria-hidden>{gameInfo(one.gameId).icon}</span> {one.name}
              </span>
              {/* A share of the longest, so the top row is always full and the rest are read against it. */}
              <span className="og-bar" aria-hidden>
                <span style={{ width: `${Math.round((one.ms / Math.max(1, top[0].ms)) * 100)}%` }} />
              </span>
              <span className="og-muted">
                {spellTime(one.ms)} · {one.finished} run{one.finished === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** One game's own board: the best, the average of what is kept, and the last ten runs. */
export function GameBoard({ kept, gameId }: { kept: KeptArcade; gameId: GameId }): React.JSX.Element {
  const board = gameBoard(kept, gameId, 10)
  const game = gameInfo(gameId)
  if (board.plays === 0) {
    return <p className="og-muted">You have not played {game.name} yet.</p>
  }
  return (
    <div className="og-board">
      <div className="og-tiles">
        <div className="og-tile">
          <small>Best</small>
          <b>
            <Trophy size={13} aria-hidden /> {board.best === undefined ? '—' : spellScore(gameId, board.best)}
          </b>
          <span className="og-muted">{spellWhen(board.bestAt)}</span>
        </div>
        <div className="og-tile">
          <small>Runs finished</small>
          <b>
            <Gamepad2 size={13} aria-hidden /> {board.finished.toLocaleString()}
          </b>
          <span className="og-muted">{board.plays.toLocaleString()} started</span>
        </div>
        <div className="og-tile">
          <small>Time played</small>
          <b>
            <Clock size={13} aria-hidden /> {spellTime(board.ms)}
          </b>
          {board.rolledUp && <span className="og-muted">over the runs still kept</span>}
        </div>
        {board.averageOfRecent !== undefined && (
          <div className="og-tile">
            <small>Average of your last {board.runs.filter((one) => one.finished).length}</small>
            <b>{spellScore(gameId, board.averageOfRecent)}</b>
          </div>
        )}
        {board.hardFinished > 0 && (
          <div className="og-tile">
            <small>Finished on hard</small>
            <b>{board.hardFinished.toLocaleString()}</b>
          </div>
        )}
      </div>
      {board.runs.length > 0 ? (
        <ol className="og-runs" aria-label={`Your last ${board.runs.length} games of ${game.name}`}>
          {board.runs.map((run) => (
            <li key={run.id}>
              <b>{run.finished ? spellScore(gameId, run.score) : 'Left part way'}</b>
              <span className="og-muted">{spellWhen(run.at)}</span>
              <span className="og-muted">{run.difficulty}</span>
              <span className="og-muted">{run.seconds === undefined ? '' : spellTime(run.seconds * 1000)}</span>
            </li>
          ))}
        </ol>
      ) : (
        /* A score carried over from the window's own copy is real and has no runs behind it. Saying so is better
           than drawing an empty list as though ten games had scored nothing. */
        <p className="og-muted">
          Your best score was kept before the arcade recorded each run, so there is nothing to list yet. Your next game will be here.
        </p>
      )}
    </div>
  )
}
