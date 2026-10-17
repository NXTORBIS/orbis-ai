import { useMemo } from 'react'
import { Button } from '../../../ui'
import { ChessStage } from '../ChessStage'
import { MoveList, MoveNav, type MoveNote } from '../MoveList'
import { LivePlayer } from './LivePlayer'
import { clockDisplay, type LiveGameRecord } from '../../../../../shared/chess/live'
import type { PlayerInfo } from '../../../../../shared/chess/model'
import { START_FEN, outcome } from '../../../../../shared/chess/rules'
import {
  agoWords,
  clockPair,
  connectionWords,
  formatClock,
  freshnessBadge,
  keepability,
  providerWords,
  resultWords,
  statusWords,
  viewerPosition,
  type ClockFace,
  type ConnectionState,
  type LiveEventView,
  type MergedGame
} from '../../../../../shared/chess/liveView'

/**
 * Watching one game.
 *
 * Watching is not playing: the board is handed `interactive={false}`, so there is no way to make a move on a game
 * two other people are playing. That is a rule about what a session is rather than about which screen you are on
 * (`SESSION_RIGHTS.watch` in the model says the same thing), and the board itself is the same board the rest of
 * Chess World uses -- and now at the same size, because the whole screen is the shared stage. It used to be a
 * column of its own two levels down inside the Live screen, which is how the board came to be the smallest thing
 * on a screen whose only subject is a board.
 *
 * Four things on this screen are claims about the world, and each is kept honest by saying where it came from:
 *
 *   - **The position.** Either the latest Orbis holds, or one somebody walked back to. The second is marked, in
 *     words and not only in colour, and there is always one obvious way back to the latest.
 *   - **How current the latest is.** From `freshness` in the ingestion layer, asked against now and against the
 *     embargo the provider declared on its own broadcast. A stale position is never shown as the current one.
 *   - **The clocks.** Shown only when the source sent them, beside the two names and again beside the move they
 *     were sent with. The side to move is counted down from the last reading, and that value is labelled as
 *     counted, because a clock worked out by subtraction and a clock a provider sent are different claims.
 *   - **The connection.** What it is doing, and when anything was last heard.
 *
 * Nothing here animates. An animation is a promise that something is happening, and in a classical game nothing
 * happens for twenty minutes at a time -- a pulsing dot over a feed that has gone quiet is the most convincing
 * lie a screen of this kind can tell.
 */

export interface LiveViewerProps {
  game: MergedGame
  /** The round as the provider's listing gave it, for the event name and the declared embargo. */
  round: LiveEventView
  now: number
  /** Where the board is: a ply, or null for wherever the game has got to. */
  at: number | null
  onAt: (at: number | null) => void
  orientation: 'w' | 'b'
  onFlip: () => void
  connection: ConnectionState | null
  /** When Orbis last read what the main process is holding. */
  lastCheck: number | null
  /** A correction the provider has published, when one has been noticed for this game. */
  correction: string | null
  keeping: boolean
  onKeep: () => void
  /** Left out when there is nowhere to open a game for study, so that no dead control is shown. */
  onKeepAndStudy: (() => void) | null
  /**
   * The other games of this round, for the column beside the board. Handed in rather than drawn here, because
   * which games there are belongs to the round and not to the one game being watched.
   */
  games?: React.ReactNode
}

/** One side's clock, saying where its value came from. Null when the source has sent no clock for that side. */
function Clock({ face }: { face: ClockFace | null }): React.JSX.Element | null {
  if (!face) return null
  return (
    <span className={`cw-live-clock${face.counted ? ' is-counted' : ''}`} title={face.note}>
      <span className="cw-live-clock-time">{face.text}</span>
      {face.counted && <small className="cw-live-counted">counted here</small>}
    </span>
  )
}

interface SideProps {
  player: PlayerInfo
  role: 'White' | 'Black'
  face: ClockFace | null
}

function Side({ player, role, face }: SideProps): React.JSX.Element {
  return (
    <div className="cw-live-side">
      <LivePlayer player={player} role={role} big />
      <Clock face={face} />
    </div>
  )
}

/**
 * A game the round lists and the feed has sent nothing for.
 *
 * It gets no board. Drawing the opening position for it would be a board nobody is sitting at, and somebody would
 * read it as a game that has not started when what is true is that nothing has reached us.
 */
/*
 * A board with no live game behind it.
 *
 * The owner's complaint was that Live showed no board at all until a game had moves. A screen with no board is a page
 * of text, so this draws the ordinary starting position, at the same size as a live game, and says in words that it
 * is NOT a live position. The board is never made to look as though a game is being played when nothing has arrived.
 */
export function WaitingBoard({
  label,
  title,
  words,
  connection,
  right
}: {
  label: string
  title: string
  words: string
  connection: ConnectionState | null
  right?: React.ReactNode
}): React.JSX.Element {
  return (
    <ChessStage
      className="cw-live-stage is-waiting"
      label={label}
      board={{
        fen: START_FEN,
        orientation: 'w',
        interactive: false,
        lastMove: null,
        label: `${title}: the starting position, no live moves yet`
      }}
      above={
        <div className="cw-live-badge is-unsure" role="status">
          <span className="cw-live-dot" aria-hidden="true" />
          <strong>No live moves yet</strong>
          <span>The starting position is shown, not a live one.</span>
        </div>
      }
      below={<p className="cw-live-state">{connectionWords(connection)}.</p>}
      right={
        <div className="cw-live-where">
          <p className="cw-live-event">{title}</p>
          <p className="cw-live-quiet">{words}</p>
          {right}
        </div>
      }
    />
  )
}

function Waiting({ game, connection }: { game: MergedGame; connection: ConnectionState | null }): React.JSX.Element {
  return (
    <WaitingBoard
      label={`${game.name}, nothing received yet`}
      title={game.name}
      words="This game is in the round's list and nothing has arrived for it yet."
      connection={connection}
    />
  )
}

function Watching({ record, ...props }: LiveViewerProps & { record: LiveGameRecord }): React.JSX.Element {
  const { game, round, now, at, onAt, orientation, onFlip, connection, lastCheck, correction, keeping, onKeep, onKeepAndStudy, games } = props
  const delay = round.delaySeconds
  const position = viewerPosition(record, at)
  const badge = freshnessBadge({ record, now, ...(delay !== undefined ? { delaySeconds: delay } : {}) })
  const clocks = clockPair(clockDisplay({ record, now }))
  const keep = keepability(record)
  const state = useMemo(
    () => outcome(position.fen, record.moves.slice(0, position.ply).map((m) => m.san)),
    [position.fen, position.ply, record.moves]
  )

  /*
   * The clock beside each move, where the source sent one.
   *
   * It is the figure the provider published with that move and nothing else: a move the source sent no clock for
   * carries no mark at all, rather than a dash that would read as a clock at zero. Lichess's broadcast PGN often
   * carries no per-move clocks, so most games show none of these, which is the truth about the feed.
   */
  const notes = useMemo(() => {
    const out: Record<number, MoveNote> = {}
    record.moves.forEach((move, index) => {
      if (move.clock === undefined) return
      out[index + 1] = { symbol: formatClock(move.clock), title: `${formatClock(move.clock)} left, as the source sent it`, kind: 'clock' }
    })
    return out
  }, [record.moves])

  const san = useMemo(() => record.moves.map((move) => move.san), [record.moves])

  const whiteSide: SideProps = { player: game.white, role: 'White', face: clocks.white }
  const blackSide: SideProps = { player: game.black, role: 'Black', face: clocks.black }
  // Whoever is not at the bottom is at the top, which is what turning the board means.
  const top = orientation === 'w' ? blackSide : whiteSide
  const bottom = orientation === 'w' ? whiteSide : blackSide

  const eventLine = [record.eventName ?? round.tournamentName, record.round ?? round.name]
    .filter((one): one is string => Boolean(one))
    .join(' · ')

  const above = (
    <div className="cw-live-above">
      <div className={`cw-live-badge is-${badge.state}`} role="status">
        <span className="cw-live-dot" aria-hidden="true" />
        <strong>{badge.word}</strong>
        <span>{badge.note}</span>
      </div>
      {correction && <p className="cw-live-correction" role="alert">{correction}</p>}
      {position.historical && (
        <p className="cw-live-past" role="status">
          Past position — move {position.ply} of {position.total}. This is not the position on the board over
          there: {position.behind} later move{position.behind === 1 ? ' has' : 's have'} arrived.
        </p>
      )}
      <Side {...top} />
    </div>
  )

  const below = (
    <div className="cw-live-below">
      <Side {...bottom} />
      <MoveNav ply={position.ply} total={position.total} onJump={(to) => onAt(to)} onFlip={onFlip}>
        {/*
         * "Back to the live position" is not the same control as "last move", and is deliberately separate: it
         * puts the board back to following the game, so the next move that arrives moves it again. Walking to the
         * last move with the arrow leaves the board parked on a ply that merely happens to be the last one.
         */}
        <Button
          size="tiny"
          kind={position.historical ? 'primary' : 'normal'}
          disabled={!position.historical && at === null}
          onClick={() => onAt(null)}
        >
          Back to the live position
        </Button>
      </MoveNav>
      <p className="cw-live-state" role="status">
        {record.result !== '*'
          ? `${resultWords(record.result)} — ${record.result}`
          : state.over
            ? state.reason === 'checkmate'
              ? `Checkmate on the board — ${state.result}. The provider has not announced a result yet.`
              : `Drawn on the board — ${state.reason.replace(/-/g, ' ')}. The provider has not announced a result yet.`
            : `${position.fen.split(' ')[1] === 'w' ? 'White' : 'Black'} to move${state.check ? ', in check' : ''} · ${statusWords(record.status).toLowerCase()}`}
      </p>
    </div>
  )

  const side = (
    <>
      <div className="cw-live-where">
        <p className="cw-live-event">{eventLine || round.name}</p>
        <p className="cw-live-quiet">
          {providerWords(record.provider)} · {connectionWords(connection)}
        </p>
        <p className="cw-live-quiet">
          {/*
           * Two different "last"s, and they are not the same question. One is when a move last arrived from the
           * provider, which is about the tournament. The other is when Orbis last looked at what it holds, which
           * is about Orbis. A screen showing only the second looks healthy while the feed is dead.
           */}
          Last move arrived {agoWords(record.receivedAt, now)} · Orbis last checked {agoWords(lastCheck ?? undefined, now)}
        </p>
      </div>

      <MoveList
        moves={san}
        ply={position.ply}
        onJump={(to) => onAt(to)}
        notes={notes}
        className="cw-live-movelist"
        empty="No moves have arrived for this game yet."
      />

      <p className="cw-live-quiet">
        {clocks.none
          ? 'The source does not send clocks for this game, so none are shown.'
          : clocks.anyCounted
            ? `The clock marked “counted here” is worked out by this computer from the last reading that arrived${clocks.at === null ? '' : ` (${agoWords(clocks.at, now)})`}. It is not a value the source is sending, and it stops at nought rather than claiming a flag has fallen.`
            : 'Both clocks are shown exactly as the source sent them.'}
      </p>

      <div className="cw-live-keep">
        <p className="cw-live-quiet">{keep.note}</p>
        <div className="cw-live-keeprow">
          <Button size="small" disabled={!keep.can} busy={keeping} busyLabel="Keeping…" onClick={onKeep}>
            {keep.label}
          </Button>
          {onKeepAndStudy && (
            <Button size="small" kind="primary" disabled={!keep.can} busy={keeping} busyLabel="Keeping…" onClick={onKeepAndStudy}>
              Keep it and open it for study
            </Button>
          )}
        </div>
      </div>
    </>
  )

  return (
    <ChessStage
      className={`cw-live-stage${position.historical ? ' is-past' : ''}`}
      label={`${game.name}, being watched`}
      board={{
        fen: position.fen,
        orientation,
        interactive: false,
        lastMove: position.lastMove,
        label: `${game.name}, being watched`
      }}
      above={above}
      below={below}
      {...(games ? { left: games } : {})}
      right={side}
    />
  )
}

export function LiveViewer(props: LiveViewerProps): React.JSX.Element {
  // Split in two so that the hooks in `Watching` are never reached conditionally: a game with no record yet is a
  // different component, not an early return inside this one.
  return props.game.record
    ? <Watching {...props} record={props.game.record} />
    : <Waiting game={props.game} connection={props.connection} />
}
