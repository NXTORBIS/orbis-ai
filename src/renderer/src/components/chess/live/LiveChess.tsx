import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Segmented } from '../../../ui'
import type { NoticeKind } from '../../../lib/notices'
import { LiveDashboard } from './LiveDashboard'
import { LiveFault } from './LiveFault'
import { LiveRoundGames } from './LiveRoundGames'
import { LiveViewer, WaitingBoard } from './LiveViewer'
import type { LiveDiagnostic } from '../../../../../shared/chess/live'
import {
  compareLines,
  correctionWords,
  dateRangeWords,
  delayWords,
  faultWords,
  firstWorthWatching,
  isWebLink,
  mergeGames,
  providerWords,
  readDiagnostic,
  readEventGames,
  readEvents,
  readFollow,
  readLiveState,
  roundShortName,
  statusWords,
  tournamentOf,
  unreadableEvents,
  worthShowing,
  type LiveAnswer,
  type LiveEventView,
  type LiveGameListing,
  type LiveStateView
} from '../../../../../shared/chess/liveView'
import './live.css'
import { useSurface } from '../../../lib/surfaces'
import { simpleAreaSurface } from '../chessSurfaces'

/**
 * Live Chess: tournaments somebody else is playing, right now.
 *
 * Two places to be. The **dashboard** is what a provider says it is carrying, and nothing else — no list that was
 * not fetched, no tournament that is not really being broadcast. Opening one goes to the **round**, which is the
 * viewer for one game plus the way to move between the games of that round without going back.
 *
 * ## The three rules that shape the code rather than the screen
 *
 * **Listing is not following.** Asking what is on is a plain request. Following opens a connection to a provider
 * that documents a limit of one request at a time, so exactly one round is ever followed, following starts when a
 * round is opened and stops when it is left or this screen goes away. That is also why the dashboard shows a game
 * count only for rounds Orbis has really opened: counting forty rounds would mean forty requests to find out
 * something the provider's own list does not carry.
 *
 * **An answer that is in flight does not know the person moved on.** Every asynchronous answer here is checked
 * against the round it was asked about before it is allowed to change anything — a mirror of the generation rule
 * the manager keeps in the main process, for the same reason: a board showing a game from the round you just left
 * looks exactly like a bug in the chess rather than one in the plumbing.
 *
 * **The tip is a place, not an index.** Where the board is is held as "wherever the game has got to" (null) or a
 * ply somebody walked back to. Holding the tip as a number would mean either dragging a reader forward under
 * their hands when a move arrives, or leaving the board stuck one move behind for ever.
 *
 * ## How it gets its data, and the one gap
 *
 * The main process pushes `chess:live-changed` and `chess:live-diagnostic` when a game moves and when a provider
 * misbehaves. Nothing in `src/preload/index.ts` subscribes to either, so **the window cannot receive them yet**;
 * they are picked up here if a bridge for them ever appears, and until then this screen asks `chess:live-state`
 * every couple of seconds instead. That poll costs nothing on the network — it reads what the main process is
 * already holding in memory, and the connection to the provider is a single long-lived stream either way. What is
 * genuinely lost without the push channel is the provider's *own* account of a correction, which is why
 * corrections are worked out again here by comparing the lines.
 */

/**
 * The provider asked.
 *
 * There is one live source wired into Orbis — Lichess broadcasts — and the channel defaults to it, so this is the
 * name it is asked by. Every provider name *shown* comes from the answers instead, so the day a second one is
 * registered the screen is already saying whose data it is.
 */
const PROVIDER = 'lichess'

/** How many tournaments to ask for. The channel clamps this to 100; forty is more than a page's worth. */
const WANTED = 40

/** How often what the main process holds is read back. Not a network request: it reads memory. */
const POLL_MS = 2_000

const EMPTY: LiveStateView = { following: null, games: [], reported: {}, health: null, unreadable: 0 }

type EventsAnswer = LiveAnswer<LiveEventView[]>
type RoundAnswer = LiveAnswer<{ event: LiveEventView; games: LiveGameListing[]; unreadable: number }>

/** An Electron invoke failure said plainly, with the remote-method wrapper taken off the front. */
const said = (err: unknown, fallback: string): string =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || fallback
    : fallback

/**
 * The push channels, if they are ever bridged.
 *
 * Declared as optional rather than added to `window.api`'s own type, because the bridge is not this area's to
 * change. Feature-detected at run time, so this screen gets faster the day the two listeners are added and is
 * correct today without them.
 */
interface PushBridge {
  onChessLiveChanged?: (listener: (value: unknown) => void) => () => void
  onChessLiveDiagnostic?: (listener: (value: unknown) => void) => () => void
}

export interface LiveChessProps {
  /** Said back to the person. Optional, so this screen works mounted on its own. */
  onNotify?: (text: string, kind?: NoticeKind) => void
  /**
   * Opens a game that is now in the person's own library, by its stored id.
   *
   * Optional, and when it is left out the "keep it and open it for study" button is not shown at all rather than
   * shown doing nothing.
   */
  onStudy?: (storedGameId: string) => void
}

export default function LiveChess({ onNotify, onStudy }: LiveChessProps): React.JSX.Element {
  const [events, setEvents] = useState<EventsAnswer | null>(null)
  const [eventsUnreadable, setEventsUnreadable] = useState(0)
  const [listing, setListing] = useState(false)

  const [round, setRound] = useState<LiveEventView | null>(null)
  const [roundAnswer, setRoundAnswer] = useState<RoundAnswer | null>(null)
  const [roundLoading, setRoundLoading] = useState(false)
  const [followFault, setFollowFault] = useState<Extract<EventsAnswer, { ok: false }> | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})

  const [live, setLive] = useState<LiveStateView>(EMPTY)
  const [lastCheck, setLastCheck] = useState<number | null>(null)
  const [pollFault, setPollFault] = useState<string | null>(null)

  const [gameId, setGameId] = useState<string | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const [orientation, setOrientation] = useState<'w' | 'b'>('w')
  const [corrections, setCorrections] = useState<Record<string, string>>({})
  const [keeping, setKeeping] = useState(false)
  const [diagnostics, setDiagnostics] = useState<LiveDiagnostic[]>([])

  const [now, setNow] = useState(() => Date.now())

  /*
   * The callbacks, held in a ref.
   *
   * The effects below would otherwise list them as dependencies, and a parent that passes a fresh arrow each
   * render would make every one of them tear down and set up again on every render -- which for the polling
   * effect means a connection's worth of work per keystroke somewhere else on the screen.
   */
  const notify = useRef(onNotify)
  useEffect(() => { notify.current = onNotify }, [onNotify])

  /** The round every asynchronous answer is checked against. Raised whenever the round changes. */
  const ask = useRef(0)
  /** The move list last seen per game, so a provider changing a published move can be noticed. */
  const lines = useRef(new Map<string, string[]>())
  /** Whether a poll is already in the air, so a slow answer cannot stack up behind itself. */
  const polling = useRef(false)

  const watching = gameId !== null && round !== null

  // A clock has to be redrawn every second to be a clock. A dashboard of ages does not.
  useEffect(() => {
    const every = watching ? 1_000 : 15_000
    const timer = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(timer)
  }, [watching])

  const loadEvents = useCallback(async (force: boolean): Promise<void> => {
    setListing(true)
    try {
      const raw = await window.api.chessLiveEvents(PROVIDER, { max: WANTED, ...(force ? { force: true } : {}) })
      setEvents(readEvents(raw))
      setEventsUnreadable(unreadableEvents(raw))
    } catch (err) {
      setEvents({ ok: false, reason: said(err, 'Orbis could not ask what is being broadcast.') })
      setEventsUnreadable(0)
    } finally {
      setListing(false)
    }
  }, [])

  useEffect(() => { void loadEvents(false) }, [loadEvents])

  /*
   * Opening a round: list it, then follow it.
   *
   * In that order, and never the other way round. A round whose games cannot even be listed is not worth opening
   * a connection to a rate-limited provider for.
   */
  useEffect(() => {
    if (!round) return
    const token = ++ask.current
    const { provider, eventId } = round
    const mine = (): boolean => token === ask.current
    setRoundAnswer(null)
    setRoundLoading(true)
    setFollowFault(null)
    setPollFault(null)
    setLive(EMPTY)
    setGameId(null)
    setAt(null)
    setCorrections({})
    lines.current = new Map()

    void (async () => {
      try {
        const raw = await window.api.chessLiveGames(provider, eventId)
        if (!mine()) return
        const answer = readEventGames(raw)
        setRoundAnswer(answer)
        if (answer.ok) setCounts((held) => ({ ...held, [eventId]: answer.value.games.length }))
      } catch (err) {
        if (!mine()) return
        setRoundAnswer({ ok: false, reason: said(err, 'Orbis could not ask for this round.') })
      } finally {
        if (mine()) setRoundLoading(false)
      }
      if (!mine()) return
      try {
        const answer = readFollow(await window.api.chessLiveFollow(provider, eventId))
        if (!mine()) return
        if (!answer.ok) setFollowFault(answer)
      } catch (err) {
        if (mine()) setFollowFault({ ok: false, reason: said(err, 'Orbis could not start following this round.') })
      }
    })()

    return () => {
      /*
       * Leaving the round stops the connection.
       *
       * The token is raised first so that an answer already in flight cannot reach the screen, and unfollowing is
       * done even though following a different round would have done it anyway: this cleanup also runs when the
       * screen itself goes away, and a stream left open behind a closed screen is a connection to a provider
       * nobody is watching.
       */
      ask.current += 1
      void window.api.chessLiveUnfollow().catch(() => undefined)
    }
  }, [round])

  const poll = useCallback(async (eventId: string, token: number): Promise<void> => {
    if (polling.current) return
    polling.current = true
    try {
      const state = readLiveState(await window.api.chessLiveState())
      if (token !== ask.current) return
      /*
       * An answer about a round nobody is on any more must not reach the screen.
       *
       * This is the manager's own generation rule mirrored on this side, because the answer was in flight while
       * the person moved on, and the games in it belong to the round they left.
       */
      if (state.following && state.following.eventId !== eventId) return
      setLive(state)
      setLastCheck(Date.now())
      setPollFault(null)
    } catch (err) {
      if (token === ask.current) setPollFault(said(err, 'Orbis could not read what it is holding.'))
    } finally {
      polling.current = false
    }
  }, [])

  useEffect(() => {
    if (!round) return
    const eventId = round.eventId
    const token = ask.current
    void poll(eventId, token)
    const timer = setInterval(() => void poll(eventId, token), POLL_MS)
    return () => clearInterval(timer)
  }, [round, poll])

  /*
   * The push channels, used if they are ever bridged.
   *
   * Nothing in the preload bridge subscribes to `chess:live-changed` or `chess:live-diagnostic` today, so this
   * attaches nothing and the poll above is what keeps the screen current. It is written this way so that adding
   * the two listeners to the bridge is the only change needed to make this screen react the moment a move lands.
   */
  useEffect(() => {
    const bridge = window.api as unknown as PushBridge
    const offs: (() => void)[] = []
    if (round && typeof bridge.onChessLiveChanged === 'function') {
      const eventId = round.eventId
      const token = ask.current
      offs.push(bridge.onChessLiveChanged(() => void poll(eventId, token)))
    }
    if (typeof bridge.onChessLiveDiagnostic === 'function') {
      offs.push(bridge.onChessLiveDiagnostic((raw) => {
        const one = readDiagnostic(raw)
        // A cancelled request is what switching rounds does. Reporting it would teach people to ignore the rest.
        if (one && worthShowing(one)) setDiagnostics((held) => [one, ...held].slice(0, 4))
      }))
    }
    return () => { for (const off of offs) off() }
  }, [round, poll])

  const games = useMemo(
    () => mergeGames(roundAnswer && roundAnswer.ok ? roundAnswer.value.games : [], live.games),
    [roundAnswer, live.games]
  )

  // Opening a round shows a game straight away rather than an empty board waiting to be chosen from.
  useEffect(() => {
    if (!round || gameId !== null || games.length === 0) return
    setGameId(firstWorthWatching(games))
  }, [round, gameId, games])

  /*
   * A provider changing a move it had already published.
   *
   * Worked out by comparing the line now held against the line last seen, because the main process's own account
   * of this arrives on a channel the window cannot hear. It is the one change a watcher must not miss: the moves
   * on screen quietly become a different game, and the move somebody was looking at is now a different move.
   */
  useEffect(() => {
    const held = lines.current
    const next = new Map<string, string[]>()
    const found: Record<string, string> = {}
    for (const record of live.games) {
      const after = record.moves.map((m) => m.uci)
      next.set(record.id, after)
      const before = held.get(record.id)
      if (!before) continue
      const words = correctionWords(compareLines(before.map((uci) => ({ uci })), record.moves), record.startFen)
      if (words) found[record.id] = words
    }
    lines.current = next
    const ids = Object.keys(found)
    if (!ids.length) return
    setCorrections((old) => ({ ...old, ...found }))
    const mine = gameId ? found[gameId] : undefined
    if (mine) notify.current?.(mine, 'warn')
  }, [live.games, gameId])

  const openLink = useCallback((url: string): void => {
    // The address came out of a provider's answer, so it is checked before it reaches the system browser.
    if (!isWebLink(url)) return
    void window.api.openExternal(url).catch(() => undefined)
  }, [])

  const chosen = useMemo(() => games.find((one) => one.id === gameId) ?? null, [games, gameId])

  /*
   * The other rounds of this tournament, from the listing that is already in hand.
   *
   * Exactly the rounds the provider listed and no others. There is no channel for "every round of tournament X" --
   * the one in the window flattens each tournament to the round it is featuring -- so a tournament usually has one
   * round here and the strip below does not appear. It is not padded out with rounds that were not listed.
   */
  const siblings = useMemo(
    () => (round && events && events.ok ? tournamentOf(events.value, round.eventId)?.rounds ?? [] : []),
    [events, round]
  )

  const keep = useCallback(async (then: ((id: string) => void) | null): Promise<void> => {
    if (!chosen) return
    setKeeping(true)
    try {
      const saved = await window.api.chessLiveSave(chosen.id)
      notify.current?.(
        then
          ? 'Kept in your games, and opened for study.'
          : 'Kept in your games. It is in the Library now.'
      )
      then?.(saved.id)
    } catch (err) {
      notify.current?.(said(err, 'That game could not be kept.'), 'error')
    } finally {
      setKeeping(false)
    }
  }, [chosen])

  const connection = live.following?.state ?? null

  /*
   * What Orbis itself may do here. Nothing on this screen holds a value Orbis can set: which tournament is being
   * watched is chosen from a list that comes off the network, and a round that has not arrived cannot be named.
   * What it can do is say what is really being watched and whether the connection is live.
   */
  useSurface(
    simpleAreaSurface({
      id: 'live',
      name: 'Live',
      about: 'Tournaments being broadcast publicly. Nothing here can be set; what is listed comes off the network.',
      keywords: ['live', 'broadcast', 'tournament', 'watch', 'stream'],
      state: () => ({
        watching: round !== null,
        connection,
        game: gameId,
        problem: pollFault,
        // Null until something has really been asked for, rather than a time nobody checked at.
        lastChecked: lastCheck
      })
    })
  )

  if (!round) {
    return (
      <div className="cw-live">
        <LiveDashboard
          answer={events}
          loading={listing}
          unreadable={eventsUnreadable}
          counts={counts}
          provider={PROVIDER}
          onOpen={setRound}
          onRefresh={() => void loadEvents(true)}
          onOpenLink={openLink}
        />
      </div>
    )
  }

  const dates = dateRangeWords(
    { ...(round.startsAt !== undefined ? { from: round.startsAt } : {}), ...(round.finishedAt !== undefined ? { to: round.finishedAt } : {}) },
    (ms) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  )
  const embargo = delayWords(round.delaySeconds)

  /*
   * The games of this round, made once.
   *
   * It goes in the column beside the board while a game is being watched, and stands on its own when there is no
   * position to draw. Built here rather than twice below so the two places cannot disagree about what is in the
   * round.
   */
  const roundGames = (
    <LiveRoundGames
      games={games}
      chosenId={gameId}
      onChoose={(id) => { setGameId(id); setAt(null) }}
      unreadableListed={roundAnswer && roundAnswer.ok ? roundAnswer.value.unreadable : 0}
      unreadableHeld={live.unreadable}
      now={now}
      {...(round.delaySeconds !== undefined ? { delaySeconds: round.delaySeconds } : {})}
    />
  )

  return (
    <div className="cw-live">
      <div className="cw-live-bar">
        <Button size="tiny" onClick={() => setRound(null)}>← All tournaments</Button>
        <div className="cw-live-barwords">
          <p className="cw-live-event">{round.name}</p>
          <p className="cw-live-quiet">
            {statusWords(round.status)} · {providerWords(round.provider)}
            {dates ? ` · ${dates}` : ' · times not given'}
          </p>
        </div>
      </div>

      {/* Only ever rendered when the provider listed more than one round of this tournament: `Segmented` returns
          nothing for a single option, which is exactly right -- one choice is not a choice. */}
      <Segmented
        label="Round"
        className="cw-live-roundstrip"
        optionClass="cw-live-roundtab"
        value={round.eventId}
        options={siblings.map((one) => ({ value: one.eventId, label: roundShortName(one), name: one.name }))}
        onChange={(eventId) => {
          const next = siblings.find((one) => one.eventId === eventId)
          if (next) setRound(next)
        }}
      />

      {embargo && <p className="cw-live-warn">{embargo}</p>}

      {followFault && <LiveFault fault={followFault} about="This round" />}
      {pollFault && <p className="cw-live-warn" role="alert">{pollFault}</p>}
      {diagnostics.map((one) => (
        <p className="cw-live-warn" role="alert" key={`${one.at}-${one.operation}-${one.message}`}>
          {one.message} {faultWords({ reason: one.message, kind: one.kind, ...(one.status !== undefined ? { status: one.status } : {}) }).next}
        </p>
      ))}
      {live.health && live.health.lateDropped > 0 && (
        <p className="cw-live-quiet">
          {live.health.lateDropped} update{live.health.lateDropped === 1 ? '' : 's'} arrived for a round that was no
          longer being followed and were thrown away. That is the plumbing working, not a fault in the chess.
        </p>
      )}

      {roundAnswer && !roundAnswer.ok
        ? <LiveFault fault={roundAnswer} about="This round" action={<Button size="small" onClick={() => setRound({ ...round })}>Try again</Button>} />
        : (
          /*
           * The round body.
           *
           * A game that has really arrived takes the whole room: the viewer is the shared stage, so the board is
           * the biggest thing on the screen and the list of the round's other games is the column beside it. Only
           * when there is nothing to put on a board does the list stand on its own -- which is the one case where
           * a screen of rows is the honest answer, because nothing has arrived to draw.
           */
          chosen && chosen.record
            ? (
              <div className="cw-live-round-body is-watching">
                <LiveViewer
                  game={chosen}
                  round={round}
                  now={now}
                  at={at}
                  onAt={setAt}
                  orientation={orientation}
                  onFlip={() => setOrientation((one) => (one === 'w' ? 'b' : 'w'))}
                  connection={connection}
                  lastCheck={lastCheck}
                  correction={corrections[chosen.id] ?? null}
                  keeping={keeping}
                  onKeep={() => void keep(null)}
                  onKeepAndStudy={onStudy ? () => void keep(onStudy) : null}
                  games={roundGames}
                />
              </div>
            )
            : (
              <div className="cw-live-round-body">
                <div className="cw-live-watchside">
                  {chosen
                    ? (
                      <LiveViewer
                        game={chosen}
                        round={round}
                        now={now}
                        at={at}
                        onAt={setAt}
                        orientation={orientation}
                        onFlip={() => setOrientation((one) => (one === 'w' ? 'b' : 'w'))}
                        connection={connection}
                        lastCheck={lastCheck}
                        correction={corrections[chosen.id] ?? null}
                        keeping={keeping}
                        onKeep={() => void keep(null)}
                        onKeepAndStudy={onStudy ? () => void keep(onStudy) : null}
                      />
                    )
                    : (
                      <WaitingBoard
                        label={`${round.name}, no game chosen`}
                        title={round.name}
                        words={roundLoading
                          ? `Asking ${providerWords(round.provider)} what is in this round…`
                          : 'The provider lists no games in this round, so there is nothing to watch.'}
                        connection={connection}
                      />
                    )}
                </div>
                {roundGames}
              </div>
            )
        )}
    </div>
  )
}
