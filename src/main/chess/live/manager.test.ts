import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { LiveDiagnostic, LivePayload, WrittenMove } from '../../../shared/chess/live.ts'
import {
  createLiveChessManager,
  type ConnectionState,
  type LiveChange,
  type LiveEventSummary,
  type LiveGameSummary,
  type LiveProviderPort,
  type SubscriptionHandle
} from './manager.ts'

/**
 * The manager, against a stand-in provider.
 *
 * ---------------------------------------------------------------------------------------------------------------
 * FIXTURE PROVENANCE
 *
 * The game, the players and the ratings below are from the same recording the other two test files use: a delivery
 * of GET https://lichess.org/api/stream/broadcast/round/Cd33Pm6w.pgn on 16 October 2026, round 7 board 39 of the
 * 36th NATO Chess Championship 2026 (Wagenaar, Harm Theo 1860 - Cirkvencic, Franci 1966).
 *
 * The provider itself is a stand-in rather than a recording, because what is under test here is the manager's own
 * behaviour -- whether listing opens connections, whether a retired subscription can still speak, whether a burst
 * becomes one change. Those are answered by controlling exactly when a provider calls back, which no recording can
 * do. The Lichess adapter's conformance to this port is tested in `lichess.test.ts`.
 * ---------------------------------------------------------------------------------------------------------------
 */

const RECORDED_SAN = ['d4', 'Nf6', 'Nf3', 'e6', 'Bf4', 'c5', 'e3', 'd5']
const written = (sans: string[]): WrittenMove[] => sans.map((san) => ({ san }))

function payload(o: Partial<LivePayload> = {}): LivePayload {
  return {
    provider: 'stand-in',
    providerGameId: '4am6EXRb',
    eventId: 'Cd33Pm6w',
    eventName: '36th NATO Chess Championship 2026',
    round: '7.39',
    white: { name: 'Wagenaar, Harm Theo', rating: 1860 },
    black: { name: 'Cirkvencic, Franci', rating: 1966 },
    moves: written(RECORDED_SAN.slice(0, 4)),
    kind: 'snapshot',
    result: '*',
    status: 'live',
    receivedAt: 1_792_000_000_000,
    ...o
  }
}

const EVENT: LiveEventSummary = {
  provider: 'stand-in',
  eventId: 'Cd33Pm6w',
  name: '36th NATO Chess Championship 2026 — Round 7',
  status: 'live',
  delaySeconds: 600
}

const GAME: LiveGameSummary = {
  provider: 'stand-in',
  providerGameId: '4am6EXRb',
  eventId: 'Cd33Pm6w',
  name: 'Wagenaar, Harm Theo - Cirkvencic, Franci',
  white: { name: 'Wagenaar, Harm Theo', rating: 1860 },
  black: { name: 'Cirkvencic, Franci', rating: 1966 },
  status: 'live',
  result: '*'
}

/** A provider whose every callback happens exactly when a test says so. */
interface StandIn {
  port: LiveProviderPort
  discoveries: number
  gameLists: number
  subscriptions: { eventId: string; stopped: boolean; send: (payloads: LivePayload[]) => void; state: (s: ConnectionState) => void; fault: (d: LiveDiagnostic) => void }[]
  failDiscover?: LiveDiagnostic
}

function standIn(): StandIn {
  const s: StandIn = {
    discoveries: 0,
    gameLists: 0,
    subscriptions: [],
    port: {
      name: 'stand-in',
      discover: async () => {
        s.discoveries += 1
        if (s.failDiscover) return { ok: false, diagnostic: s.failDiscover }
        return { ok: true, value: { events: [EVENT], warnings: [] } }
      },
      games: async () => {
        s.gameLists += 1
        return { ok: true, value: { event: EVENT, games: [GAME], warnings: [] } }
      },
      subscribe: (eventId, handlers): SubscriptionHandle => {
        const entry = {
          eventId,
          stopped: false,
          send: (payloads: LivePayload[]) => handlers.onPayloads(payloads),
          state: (state: ConnectionState) => handlers.onState?.(state),
          fault: (d: LiveDiagnostic) => handlers.onDiagnostic?.(d)
        }
        s.subscriptions.push(entry)
        return {
          stop: () => {
            entry.stopped = true
          },
          done: Promise.resolve()
        }
      }
    }
  }
  return s
}

/** A manager whose clock and timer a test drives by hand. */
function rig(o: { coalesceMs?: number; maxGames?: number; discoveryTtlMs?: number } = {}) {
  let clock = 1_792_000_000_000
  const timers: { fn: () => void; ms: number }[] = []
  const changes: LiveChange[] = []
  const diagnostics: LiveDiagnostic[] = []
  const states: string[] = []
  const provider = standIn()
  const manager = createLiveChessManager({
    now: () => clock,
    coalesceMs: o.coalesceMs ?? 250,
    ...(o.maxGames !== undefined ? { maxGames: o.maxGames } : {}),
    ...(o.discoveryTtlMs !== undefined ? { discoveryTtlMs: o.discoveryTtlMs } : {}),
    setTimer: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length - 1
    },
    clearTimer: (handle) => {
      const index = handle as number
      if (timers[index]) timers[index] = { fn: () => undefined, ms: 0 }
    },
    onChange: (c) => changes.push(c),
    onDiagnostic: (d) => diagnostics.push(d),
    onState: (s) => states.push(s)
  })
  manager.register(provider.port)
  return {
    manager,
    provider,
    changes,
    diagnostics,
    states,
    timers,
    advance: (ms: number) => (clock += ms),
    /** Runs every timer that is waiting, which is what the coalescing window ending looks like. */
    tick: () => {
      const waiting = timers.splice(0, timers.length)
      for (const t of waiting) t.fn()
    }
  }
}

// ---- listing is not following ----------------------------------------------------------------------------------

test('listing what is on opens no connection at all', async () => {
  const r = rig()
  const got = await r.manager.refresh('stand-in')
  assert.ok(got.ok)
  assert.equal(got.value.length, 1)
  assert.equal(got.value[0].eventId, 'Cd33Pm6w')
  const games = await r.manager.listGames('stand-in', 'Cd33Pm6w')
  assert.ok(games.ok)
  assert.equal(games.value.games.length, 1)
  // The whole point: forty tournaments can be shown without forty connections to a provider that limits them.
  assert.equal(r.provider.subscriptions.length, 0)
  assert.equal(r.manager.following(), null)
})

test('a listing that is still fresh is reused, and a person pressing refresh really refreshes', async () => {
  const r = rig({ discoveryTtlMs: 60_000 })
  await r.manager.refresh('stand-in')
  await r.manager.refresh('stand-in')
  assert.equal(r.provider.discoveries, 1, 'three screens asking at once cost one request')
  await r.manager.refresh('stand-in', { force: true })
  assert.equal(r.provider.discoveries, 2)
  r.advance(60_001)
  await r.manager.refresh('stand-in')
  assert.equal(r.provider.discoveries, 3)
})

test('different questions get different listings rather than one answering for the other', async () => {
  const r = rig()
  await r.manager.refresh('stand-in', { onlyLive: true })
  await r.manager.refresh('stand-in', { onlyLive: false })
  assert.equal(r.provider.discoveries, 2)
})

test('when a listing fails, an older one is offered rather than an empty page, and the fault is still reported', async () => {
  const r = rig({ discoveryTtlMs: 0 })
  await r.manager.refresh('stand-in')
  r.provider.failDiscover = { provider: 'stand-in', operation: 'discovery', kind: 'network', message: 'no route to host', at: 1 }
  const got = await r.manager.refresh('stand-in')
  assert.ok(got.ok, 'the last good listing still comes back')
  assert.equal(got.value.length, 1)
  assert.equal(r.diagnostics.length, 1, 'and nobody is told it was fresh')
  assert.equal(r.diagnostics[0].kind, 'network')
})

test('a first listing that fails fails, rather than pretending there is nothing on', async () => {
  const r = rig()
  r.provider.failDiscover = { provider: 'stand-in', operation: 'discovery', kind: 'network', message: 'no route to host', at: 1 }
  const got = await r.manager.refresh('stand-in')
  assert.ok(!got.ok)
  assert.equal(got.diagnostic.kind, 'network')
})

test('a provider nobody registered is refused by name', async () => {
  const r = rig()
  const got = await r.manager.refresh('chess.com')
  assert.ok(!got.ok)
  assert.match(got.diagnostic.message, /no "chess\.com" provider/)
  const followed = r.manager.follow('chess.com', 'x')
  assert.ok(!followed.ok)
})

// ---- following, and the generation token -------------------------------------------------------------------------

test('following opens one subscription, and following the same thing again does not open a second', () => {
  const r = rig()
  const first = r.manager.follow('stand-in', 'Cd33Pm6w')
  assert.ok(first.ok)
  assert.equal(r.provider.subscriptions.length, 1)
  // A screen re-rendering must not drop and remake a connection to a provider that limits connections.
  const again = r.manager.follow('stand-in', 'Cd33Pm6w')
  assert.ok(again.ok)
  assert.equal(again.value.generation, first.value.generation)
  assert.equal(r.provider.subscriptions.length, 1)
  assert.deepEqual(r.manager.following(), { provider: 'stand-in', eventId: 'Cd33Pm6w', generation: first.value.generation, state: 'connecting' })
})

test('switching rounds stops the old subscription before the new one starts', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  r.manager.follow('stand-in', 'oJfQJpmu')
  assert.equal(r.provider.subscriptions.length, 2)
  assert.equal(r.provider.subscriptions[0].stopped, true)
  assert.equal(r.provider.subscriptions[1].stopped, false)
  assert.equal(r.manager.following()?.eventId, 'oJfQJpmu')
})

test('a late delivery from a round nobody is watching any more cannot touch the board', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  const old = r.provider.subscriptions[0]
  old.send([payload()])
  r.tick()
  assert.equal(r.manager.health().games, 1)

  r.manager.follow('stand-in', 'oJfQJpmu')
  assert.equal(r.manager.health().games, 0, 'switching rounds clears the board')

  // The old stream was already winding down and still had a chunk in flight. It arrives now.
  old.send([payload({ moves: written(RECORDED_SAN) })])
  r.tick()
  assert.equal(r.manager.health().games, 0, 'a retired subscription must not be able to put a game on the board')
  assert.equal(r.manager.health().lateDropped, 1, 'and the drop is counted rather than happening in silence')
  assert.equal(r.changes.length, 1, 'only the first, legitimate change was ever reported')
})

test('a retired subscription cannot report faults or connection states either', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  const old = r.provider.subscriptions[0]
  r.manager.unfollow()
  old.fault({ provider: 'stand-in', operation: 'x', kind: 'network', message: 'from a dead stream', at: 1 })
  old.state('open')
  assert.equal(r.diagnostics.length, 0)
  assert.equal(r.states.includes('open'), false)
})

test('what decides whether a delivery counts is the subscription it came from, not the id written on it', () => {
  // Worth pinning down, because the two are easy to confuse. A provider may legitimately label a game with a
  // different event -- Lichess's group and tour streams both carry games from several rounds -- so the payload's
  // own eventId is not a reason to refuse it. What is refused is a *subscription* that has been retired, which the
  // generation check covers and which the test above proves.
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  r.provider.subscriptions[0].send([payload({ eventId: 'A-DIFFERENT-ROUND' })])
  r.tick()
  assert.equal(r.manager.health().games, 1)
  assert.equal(r.manager.all()[0].eventId, 'A-DIFFERENT-ROUND', 'and the game keeps the event the provider gave it')
})

test('unfollowing clears the board, unless it is asked to keep it', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  r.provider.subscriptions[0].send([payload()])
  r.tick()
  assert.equal(r.manager.health().games, 1)
  r.manager.unfollow()
  assert.equal(r.manager.health().games, 0)
  assert.equal(r.manager.following(), null)
  assert.ok(r.states.includes('stopped'))

  r.manager.follow('stand-in', 'Cd33Pm6w')
  r.provider.subscriptions[1].send([payload()])
  r.tick()
  r.manager.unfollow(true)
  assert.equal(r.manager.health().games, 1, 'the last position stays on screen when that is what was asked for')
})

test('the connection state the provider reports is what the manager reports', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  r.provider.subscriptions[0].state('open')
  assert.equal(r.manager.following()?.state, 'open')
  r.provider.subscriptions[0].state('reconnecting')
  assert.equal(r.manager.following()?.state, 'reconnecting')
  assert.deepEqual(r.states, ['open', 'reconnecting'])
})

// ---- bursts -------------------------------------------------------------------------------------------------------

test('a round of sixty games arriving at once is one change, not sixty', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  const burst = Array.from({ length: 60 }, (_, i) => payload({ providerGameId: `game${String(i).padStart(4, '0')}` }))
  r.provider.subscriptions[0].send(burst)
  assert.equal(r.changes.length, 0, 'nothing is reported until the window closes')
  r.tick()
  assert.equal(r.changes.length, 1)
  assert.equal(r.changes[0].games.length, 60)
  assert.equal(r.manager.health().games, 60)
  assert.equal(r.manager.health().batches, 1)
})

test('several snapshots of one game in a burst collapse to the newest, and the game is not doubled', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  const sub = r.provider.subscriptions[0]
  // Three snapshots of the same game, each a move further on. A snapshot is the whole truth, so only the last matters.
  sub.send([payload({ moves: written(RECORDED_SAN.slice(0, 4)) })])
  sub.send([payload({ moves: written(RECORDED_SAN.slice(0, 6)) })])
  sub.send([payload({ moves: written(RECORDED_SAN) })])
  r.tick()
  assert.equal(r.changes.length, 1)
  assert.equal(r.changes[0].games.length, 1)
  assert.equal(r.changes[0].games[0].moves.length, 8, 'not 18')
  assert.deepEqual(r.changes[0].games[0].moves.map((m) => m.san), RECORDED_SAN)
})

test('several deltas of one game in a burst are all applied, in order, and never collapsed', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  const sub = r.provider.subscriptions[0]
  sub.send([payload({ kind: 'snapshot', moves: written(RECORDED_SAN.slice(0, 4)) })])
  r.tick()
  // A delta is only a fragment. Collapsing two of them by keeping the newest would throw a move away.
  sub.send([payload({ kind: 'update', moves: written(['Bf4']) })])
  sub.send([payload({ kind: 'update', moves: written(['c5']) })])
  r.tick()
  const record = r.manager.all()[0]
  assert.equal(record.moves.length, 6)
  assert.deepEqual(record.moves.map((m) => m.san), RECORDED_SAN.slice(0, 6))
})

test('with no coalescing window, each delivery is reported as it arrives', () => {
  const r = rig({ coalesceMs: 0 })
  r.manager.follow('stand-in', 'Cd33Pm6w')
  r.provider.subscriptions[0].send([payload()])
  r.provider.subscriptions[0].send([payload({ moves: written(RECORDED_SAN) })])
  assert.equal(r.changes.length, 2)
  assert.equal(r.timers.length, 0, 'and no timer is used at all')
})

test('a burst still waiting when the round is switched is thrown away, not applied to the new round', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  r.provider.subscriptions[0].send([payload()])
  assert.equal(r.manager.health().pending, 1)
  r.manager.follow('stand-in', 'oJfQJpmu')
  assert.equal(r.manager.health().pending, 0)
  r.tick()
  assert.equal(r.manager.health().games, 0)
  assert.equal(r.changes.length, 0)
})

// ---- what the model decides, as the manager sees it ---------------------------------------------------------------

test('a game missed while disconnected is recovered from the next snapshot, and only the new moves count', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  const sub = r.provider.subscriptions[0]
  sub.send([payload({ moves: written(RECORDED_SAN.slice(0, 4)) })])
  r.tick()
  assert.equal(r.changes[0].outcomes['stand-in:4am6EXRb'], 'created')

  // The connection drops and comes back; the provider re-sends the whole game, now four moves further on.
  sub.state('reconnecting')
  sub.state('open')
  sub.send([payload({ moves: written(RECORDED_SAN), result: '1/2-1/2', status: 'finished' })])
  r.tick()
  assert.equal(r.changes.length, 2)
  assert.equal(r.changes[1].outcomes['stand-in:4am6EXRb'], 'advanced')
  assert.equal(r.changes[1].games[0].moves.length, 8)
  assert.equal(r.changes[1].games[0].result, '1/2-1/2')
})

test('an older snapshot arriving late is noted and does not rewind the board', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  const sub = r.provider.subscriptions[0]
  sub.send([payload({ moves: written(RECORDED_SAN), result: '1/2-1/2', status: 'finished' })])
  r.tick()
  sub.send([payload({ moves: written(RECORDED_SAN.slice(0, 4)), result: '*' })])
  r.tick()
  const record = r.manager.all()[0]
  assert.equal(record.moves.length, 8)
  assert.equal(record.result, '1/2-1/2')
  const last = r.changes[r.changes.length - 1]
  assert.equal(last.outcomes['stand-in:4am6EXRb'], 'out-of-order')
  assert.ok(last.notes.some((n) => /older copy/.test(n)))
  assert.equal(last.games.length, 0, 'nothing changed, so nothing is offered as changed')
})

test('a repeated delivery is recognised by its id and reported as a duplicate', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  const sub = r.provider.subscriptions[0]
  sub.send([payload({ deliveryId: 'e-1' })])
  r.tick()
  sub.send([payload({ deliveryId: 'e-1', moves: written(RECORDED_SAN) })])
  r.tick()
  assert.equal(r.manager.all()[0].moves.length, 4)
  assert.equal(r.changes[r.changes.length - 1].outcomes['stand-in:4am6EXRb'], 'duplicate')
})

test('a result being overruled comes through as a correction, with a note saying so', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  const sub = r.provider.subscriptions[0]
  sub.send([payload({ moves: written(RECORDED_SAN), result: '1-0', status: 'finished' })])
  r.tick()
  sub.send([payload({ moves: written(RECORDED_SAN), result: '1/2-1/2', status: 'finished' })])
  r.tick()
  const last = r.changes[r.changes.length - 1]
  assert.equal(last.outcomes['stand-in:4am6EXRb'], 'corrected')
  assert.ok(last.notes.some((n) => /corrected from 1-0 to 1\/2-1\/2/.test(n)))
  assert.equal(r.manager.all()[0].result, '1/2-1/2')
})

test('a payload whose moves cannot be played is reported and no game is put on the board for it', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  r.provider.subscriptions[0].send([payload({ moves: written(['d4', 'Qh4']) })])
  r.tick()
  assert.equal(r.manager.health().games, 0)
  assert.equal(r.diagnostics.length, 1)
  assert.equal(r.diagnostics[0].kind, 'pgn')
  assert.match(r.diagnostics[0].operation, /game 4am6EXRb/)
})

test('a round claiming more games than Orbis will follow is capped, and says so', () => {
  const r = rig({ maxGames: 3 })
  r.manager.follow('stand-in', 'Cd33Pm6w')
  r.provider.subscriptions[0].send(Array.from({ length: 10 }, (_, i) => payload({ providerGameId: `game${i}` })))
  r.tick()
  assert.equal(r.manager.health().games, 3)
  assert.ok(r.diagnostics.some((d) => /more than 3 games/.test(d.message)))
})

// ---- reading what is held -------------------------------------------------------------------------------------------

test('a view says how old the game is and where each clock came from', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  // Eight plies played, so White is to move and White's is the clock that is running.
  r.provider.subscriptions[0].send([payload({ moves: written(RECORDED_SAN), clocks: { white: 5443, black: 5385 } })])
  r.tick()
  r.advance(30_000)

  const plain = r.manager.view('stand-in:4am6EXRb')
  assert.ok(plain)
  assert.equal(plain.freshness, 'live')
  assert.equal(plain.clocks.white?.origin, 'extrapolated')
  assert.equal(plain.clocks.white?.seconds, 5443 - 30)
  assert.equal(plain.clocks.black?.origin, 'received')
  assert.equal(plain.clocks.black?.seconds, 5385)

  // The same game, told that this broadcast is on the ten-minute embargo the round declared.
  const embargoed = r.manager.view('stand-in:4am6EXRb', { delaySeconds: EVENT.delaySeconds })
  assert.ok(embargoed)
  assert.equal(embargoed.freshness, 'delayed', 'an embargoed broadcast is never called live')

  // And asked for readings only, nothing is worked out.
  const received = r.manager.view('stand-in:4am6EXRb', { extrapolate: false })
  assert.ok(received)
  assert.equal(received.clocks.white?.origin, 'received')
  assert.equal(received.clocks.white?.seconds, 5443)
})

test('a game nobody is holding has no view, rather than an empty one', () => {
  const r = rig()
  assert.equal(r.manager.view('stand-in:nothing'), null)
})

test('an unknown provider name on a payload still keys the game by that provider', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  r.provider.subscriptions[0].send([payload({ provider: 'lichess' })])
  r.tick()
  assert.equal(r.manager.all()[0].id, 'lichess:4am6EXRb')
})

test('the games come back in a stable order, so a list does not reshuffle as moves arrive', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  const sub = r.provider.subscriptions[0]
  sub.send([
    payload({ providerGameId: 'c', round: '7.10' }),
    payload({ providerGameId: 'a', round: '7.2' }),
    payload({ providerGameId: 'b', round: '7.1' })
  ])
  r.tick()
  // Board order, read as numbers rather than as text, so board 10 comes after board 2.
  assert.deepEqual(r.manager.all().map((g) => g.round), ['7.1', '7.2', '7.10'])
  sub.send([payload({ providerGameId: 'a', round: '7.2', moves: written(RECORDED_SAN) })])
  r.tick()
  assert.deepEqual(r.manager.all().map((g) => g.round), ['7.1', '7.2', '7.10'])
})

test('the counters add up, for when somebody reports that the board froze', () => {
  const r = rig()
  r.manager.follow('stand-in', 'Cd33Pm6w')
  r.provider.subscriptions[0].send([payload(), payload({ providerGameId: 'other' })])
  r.tick()
  const health = r.manager.health()
  assert.equal(health.games, 2)
  assert.equal(health.payloads, 2)
  assert.equal(health.batches, 1)
  assert.equal(health.pending, 0)
  assert.equal(health.lateDropped, 0)
  assert.ok(health.generation > 0)
  assert.deepEqual(r.manager.providerNames(), ['stand-in'])
})
