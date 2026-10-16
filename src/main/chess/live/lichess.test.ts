import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { LiveDiagnostic, LivePayload } from '../../../shared/chess/live.ts'
import {
  LichessBroadcasts,
  createLichessBroadcasts,
  describeError,
  gameIdFromPgnTags,
  lichessProviderPort,
  payloadsFromPgn,
  readClockSeconds,
  readResult,
  splitPgnGames,
  type FetchLike,
  type LiveFetchResponse
} from './lichess.ts'

/**
 * The Lichess adapter, against recorded responses and an injected fetch.
 *
 * ---------------------------------------------------------------------------------------------------------------
 * FIXTURE PROVENANCE -- every fixture below is a recording of the real service, taken on 16 October 2026.
 *
 *  RECORDED_GAME_PGN   one game, verbatim, from
 *                        GET https://lichess.org/api/stream/broadcast/round/Cd33Pm6w.pgn
 *                      (36th NATO Chess Championship 2026, round 7, board 39). Transfer-Encoding was chunked and
 *                      the Content-Type was application/x-chess-pgn.
 *
 *  RECORDED_ROUND_JSON the body of
 *                        GET https://lichess.org/api/broadcast/-/-/oJfQJpmu
 *                      (FIDE World U7-U17 Championships 2026 | O17, round 5), trimmed to two of its 27 games and
 *                      with the long `tour.info` and `photos` left out. Everything kept is verbatim -- including
 *                      `round.delay: 600`, which no published schema documents but the service really sends, and
 *                      the `clock` values of 273000, which are centiseconds.
 *
 *  RECORDED_NDJSON     two lines of
 *                        GET https://lichess.org/api/broadcast?nb=3
 *                      Content-Type: application/x-ndjson; charset=utf-8. Trimmed to two rounds per tournament.
 *                      Note that neither line carries `group`, and that `finished` appears beside `finishedAt` --
 *                      the published schema marks `finished` deprecated, so this adapter reads `finishedAt`.
 *
 * Where a test needs a value the recordings did not happen to contain -- the typographic "½-½" that the published
 * `status` schema documents, or a schema that has changed -- it is built by altering a recording, and says so.
 * ---------------------------------------------------------------------------------------------------------------
 */

const RECORDED_GAME_PGN = `[Event "Round 7: Wagenaar, Harm Theo - Cirkvencic, Franci"]
[Site "https://lichess.org/broadcast/36th-nato-chess-championship-2026/round-7/Cd33Pm6w/4am6EXRb"]
[Date "2026.10.16"]
[Round "7.39"]
[White "Wagenaar, Harm Theo"]
[Black "Cirkvencic, Franci"]
[Result "1/2-1/2"]
[WhiteElo "1860"]
[WhiteFideId "1008293"]
[BlackElo "1966"]
[BlackFideId "14600528"]
[TimeControl "90+30"]
[Variant "Standard"]
[ECO "A46"]
[Opening "Indian Defense: London System"]
[UTCDate "2026.10.16"]
[UTCTime "05:32:26"]
[BroadcastName "36th NATO Chess Championship 2026"]
[BroadcastURL "https://lichess.org/broadcast/36th-nato-chess-championship-2026/round-7/Cd33Pm6w"]
[GameURL "https://lichess.org/broadcast/36th-nato-chess-championship-2026/round-7/Cd33Pm6w/4am6EXRb"]

1. d4 { [%eval 0.15] [%clk 1:30:50] } 1... Nf6 { [%eval 0.15] [%clk 1:30:38] } 2. Nf3 { [%eval 0.11] [%clk 1:31:09] } 2... e6 { [%eval 0.14] [%clk 1:30:56] } 3. Bf4 { [%eval 0.1] [%clk 1:30:23] } 3... c5 { [%eval 0.1] [%clk 1:30:49] } 4. e3 { [%eval 0.0] [%clk 1:30:43] } 4... d5 { [%eval 0.14] [%clk 1:29:45] } 1/2-1/2

`

/** The same recording, cut short after two moves and left unfinished, as a stream chunk boundary would leave it. */
const RECORDED_GAME_PARTIAL = RECORDED_GAME_PGN.slice(0, RECORDED_GAME_PGN.indexOf('3. Bf4'))

const RECORDED_ROUND_JSON = JSON.stringify({
  round: {
    id: 'oJfQJpmu',
    name: 'Round 5',
    slug: 'round-5',
    startsAt: 1792137600000,
    url: 'https://lichess.org/broadcast/fide-world-u7-u17-championships-2026-o17/round-5/oJfQJpmu',
    delay: 600
  },
  tour: {
    id: 'zK5CoVvF',
    name: 'FIDE World U7-U17 Championships 2026 | O17',
    slug: 'fide-world-u7-u17-championships-2026-o17',
    info: { format: '11-round Swiss', tc: '45 min + 30 sec / move', location: 'Roquetas de Mar. Almería. Spain' },
    createdAt: 1791811660066,
    url: 'https://lichess.org/broadcast/fide-world-u7-u17-championships-2026-o17/zK5CoVvF',
    tier: 4,
    dates: [1791966600000, 1792504800000]
  },
  study: { writeable: false, features: { chat: true, computer: true, explorer: true } },
  games: [
    {
      id: 'piF74x35',
      name: 'Nainys, Zanas - Morkunas, Gustas',
      players: [
        { name: 'Nainys, Zanas', title: 'FM', rating: 2301, fideId: 12844098, fed: 'LTU', clock: 273000 },
        { name: 'Morkunas, Gustas', title: 'FM', rating: 2335, fideId: 12831026, fed: 'LTU', clock: 273000 }
      ],
      status: '*'
    },
    {
      id: 'BVhC8xSt',
      name: 'Medhus, Vitus Bondo - Beristenov, Kair',
      players: [
        { name: 'Medhus, Vitus Bondo', title: 'IM', rating: 2394, fideId: 1462547, fed: 'DEN', clock: 273000 },
        { name: 'Beristenov, Kair', title: 'FM', rating: 2307, fideId: 13777831, fed: 'KAZ', clock: 273000 }
      ],
      status: '*'
    }
  ],
  photos: {},
  isSubscribed: false
})

const RECORDED_NDJSON = [
  JSON.stringify({
    tour: {
      id: 'jJzJv14g',
      name: 'German Bundesliga 2026/27 (Schachbundesliga)',
      slug: 'german-bundesliga-202627-schachbundesliga',
      info: { format: '16-team round-robin', tc: '90 min / 40 moves + 30 min + 30 sec / move', location: 'Germany' },
      createdAt: 1791000000000,
      url: 'https://lichess.org/broadcast/german-bundesliga-202627-schachbundesliga/jJzJv14g',
      tier: 5,
      dates: [1791555300000]
    },
    rounds: [
      { id: 'dppuxRu1', name: 'Round 1', slug: 'round-1', finishedAt: 1791592008187, finished: true, startsAt: 1791555300000, url: 'https://lichess.org/broadcast/german-bundesliga-202627-schachbundesliga/round-1/dppuxRu1' },
      { id: 'Fj6C4C8U', name: 'Round 2', slug: 'round-2', ongoing: true, startsAt: 1791641700000, url: 'https://lichess.org/broadcast/german-bundesliga-202627-schachbundesliga/round-2/Fj6C4C8U' }
    ],
    defaultRoundId: 'Fj6C4C8U'
  }),
  JSON.stringify({
    tour: {
      id: 'zK5CoVvF',
      name: 'FIDE World U7-U17 Championships 2026 | O17',
      slug: 'fide-world-u7-u17-championships-2026-o17',
      info: {},
      createdAt: 1791811660066,
      url: 'https://lichess.org/broadcast/fide-world-u7-u17-championships-2026-o17/zK5CoVvF',
      tier: 4,
      dates: [1791966600000, 1792504800000]
    },
    rounds: [{ id: 'oJfQJpmu', name: 'Round 5', slug: 'round-5', startsAt: 1792137600000, url: 'https://lichess.org/broadcast/x/round-5/oJfQJpmu' }],
    defaultRoundId: 'oJfQJpmu'
  })
].join('\n')

// ---- a fetch that can be told exactly what to do -----------------------------------------------------------------

interface Reply {
  status?: number
  body?: string
  /** For the stream: the chunks to deliver, in order. A function receives the abort signal. */
  chunks?: (signal?: AbortSignal) => AsyncIterable<Uint8Array | string>
  /** Throw instead of answering. */
  throws?: Error
  /** Never answer, so the request's own timeout is what ends it. */
  hang?: boolean
}

interface Rig {
  fetchFn: FetchLike
  calls: string[]
  /** The most requests that were ever in the air at the same time. */
  peakConcurrency: number
  reply: (fn: (url: string, n: number) => Reply) => void
  headers: Record<string, string>[]
}

function rig(initial?: (url: string, n: number) => Reply): Rig {
  let responder = initial ?? ((): Reply => ({ body: '{}' }))
  let inFlight = 0
  const state: Rig = {
    calls: [],
    peakConcurrency: 0,
    headers: [],
    reply: (fn) => {
      responder = fn
    },
    fetchFn: async (url, init) => {
      const n = state.calls.length
      state.calls.push(url)
      state.headers.push(init?.headers ?? {})
      inFlight += 1
      state.peakConcurrency = Math.max(state.peakConcurrency, inFlight)
      try {
        const reply = responder(url, n)
        if (reply.throws) throw reply.throws
        if (reply.hang) {
          await new Promise<never>((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
          })
        }
        const body = reply.body ?? ''
        const res: LiveFetchResponse = {
          ok: (reply.status ?? 200) >= 200 && (reply.status ?? 200) < 300,
          status: reply.status ?? 200,
          headers: { get: () => null },
          text: async () => body,
          ...(reply.chunks ? { body: reply.chunks(init?.signal) } : {})
        }
        return res
      } finally {
        inFlight -= 1
      }
    }
  }
  return state
}

const adapter = (r: Rig, o: Partial<Parameters<typeof createLichessBroadcasts>[0]> = {}): LichessBroadcasts =>
  createLichessBroadcasts({
    fetchFn: r.fetchFn,
    now: () => 1_792_000_000_000,
    sleep: async () => undefined,
    random: () => 0.5,
    timeoutMs: 50,
    ...o
  })

const chunksOf = (...parts: (string | Uint8Array)[]) =>
  async function* (): AsyncIterable<string | Uint8Array> {
    for (const part of parts) yield part
  }

// ---- framing a chunked PGN stream --------------------------------------------------------------------------------

test('a complete recorded game is framed out of the stream; a partial one is held back', () => {
  const whole = splitPgnGames(RECORDED_GAME_PGN)
  assert.equal(whole.games.length, 1)
  assert.equal(whole.rest, '')
  assert.match(whole.games[0], /^\[Event "Round 7/)

  // Half a game is worse than no game: it parses and is silently missing its end.
  const partial = splitPgnGames(RECORDED_GAME_PARTIAL)
  assert.deepEqual(partial.games, [])
  assert.equal(partial.rest, RECORDED_GAME_PARTIAL)
})

test('two games in one chunk are framed as two, and a trailing partial waits for the rest', () => {
  const buffer = RECORDED_GAME_PGN + RECORDED_GAME_PGN + RECORDED_GAME_PARTIAL
  const { games, rest } = splitPgnGames(buffer)
  assert.equal(games.length, 2)
  assert.equal(rest, RECORDED_GAME_PARTIAL)
  // Feeding the rest of that third game completes it.
  const finished = splitPgnGames(rest + RECORDED_GAME_PGN.slice(RECORDED_GAME_PGN.indexOf('3. Bf4')))
  assert.equal(finished.games.length, 1)
  assert.equal(finished.rest, '')
})

test('an ongoing game, whose result token is "*", is framed just the same', () => {
  const ongoing = RECORDED_GAME_PGN.replace('[Result "1/2-1/2"]', '[Result "*"]').replace(' 1/2-1/2\n', ' *\n')
  const { games, rest } = splitPgnGames(ongoing)
  assert.equal(games.length, 1)
  assert.equal(rest, '')
})

test('a buffer with nothing game-shaped in it yields nothing and keeps what it was given', () => {
  assert.deepEqual(splitPgnGames('\n\n  \n'), { games: [], rest: '\n\n  \n' })
})

test('the game id comes out of the links the broadcast PGN carries', () => {
  assert.equal(gameIdFromPgnTags({ gameUrl: 'https://lichess.org/broadcast/a/round-7/Cd33Pm6w/4am6EXRb' }), '4am6EXRb')
  assert.equal(gameIdFromPgnTags({ site: 'https://lichess.org/broadcast/a/round-7/Cd33Pm6w/4am6EXRb/' }), '4am6EXRb')
  assert.equal(gameIdFromPgnTags({ site: 'https://example.test/' }), undefined)
  assert.equal(gameIdFromPgnTags({}), undefined)
})

// ---- the recorded game, read ---------------------------------------------------------------------------------------

test('the recorded game becomes a snapshot payload with only what its PGN actually said', () => {
  const { payloads, problems } = payloadsFromPgn(RECORDED_GAME_PGN, { eventId: 'Cd33Pm6w', receivedAt: 1_792_000_000_000 })
  assert.deepEqual(problems, [])
  assert.equal(payloads.length, 1)
  const p = payloads[0]
  // Every game is a snapshot, because that is what the provider sends. This label is what stops a game being
  // appended to itself.
  assert.equal(p.kind, 'snapshot')
  assert.equal(p.provider, 'lichess')
  assert.equal(p.providerGameId, '4am6EXRb')
  assert.equal(p.eventId, 'Cd33Pm6w')
  assert.equal(p.eventName, '36th NATO Chess Championship 2026')
  assert.equal(p.round, '7.39')
  assert.equal(p.result, '1/2-1/2')
  assert.equal(p.status, 'finished')
  assert.ok(p.white)
  assert.equal(p.white.name, 'Wagenaar, Harm Theo')
  assert.equal(p.white.rating, 1860)
  // This recording carries no title tags, and none is invented.
  assert.equal('title' in (p.white ?? {}), false)
  assert.equal(p.moves.length, 8)
  assert.deepEqual(p.moves.map((m) => m.san), ['d4', 'Nf6', 'Nf3', 'e6', 'Bf4', 'c5', 'e3', 'd5'])
  // The clocks are the last reading of each side: 1:30:43 and 1:29:45 from the recording.
  assert.deepEqual(p.clocks, { white: 5443, black: 5385 })
  // Lichess's PGN carries no per-move wall-clock, so nothing pretends to be the provider's own timestamp.
  assert.equal('sourceTimestamp' in p, false)
})

test('the documented eval and clock comments are kept as the source wrote them, not reinterpreted', () => {
  const { payloads } = payloadsFromPgn(RECORDED_GAME_PGN, { eventId: 'Cd33Pm6w', receivedAt: 1 })
  assert.match(payloads[0].moves[0].comment ?? '', /%eval 0\.15/)
  assert.equal(payloads[0].moves[0].clock, 5450)
})

test('a game with no link in it is reported and left out, never guessed at', () => {
  const anonymous = RECORDED_GAME_PGN.replace(/^\[Site .*$/m, '[Site "?"]').replace(/^\[GameURL .*$/m, '')
  const { payloads, problems } = payloadsFromPgn(anonymous, { eventId: 'Cd33Pm6w', receivedAt: 1 })
  assert.deepEqual(payloads, [])
  assert.equal(problems.length, 1)
  assert.equal(problems[0].kind, 'pgn')
  assert.equal(problems[0].field, 'GameURL')
  assert.match(problems[0].message, /which game it is/)
})

test('one unplayable game does not cost the readable games beside it', () => {
  // Qh4 is not playable here: the queen's diagonal out of d8 is blocked by its own knight on f6. Both links have to
  // be rewritten, because the id is read from GameURL first and from Site only as a fallback.
  const broken = RECORDED_GAME_PGN.replace('4... d5', '4... Qh4').replaceAll('/4am6EXRb"]', '/BROKENid"]')
  const { payloads, problems } = payloadsFromPgn(broken + RECORDED_GAME_PGN, { eventId: 'Cd33Pm6w', receivedAt: 1 })
  assert.equal(payloads.length, 1, 'the good game still arrives')
  assert.equal(payloads[0].providerGameId, '4am6EXRb')
  const illegal = problems.find((p) => p.message.includes('BROKENid'))
  assert.ok(illegal, 'the unplayable game is named')
  assert.equal(illegal.kind, 'pgn')
})

// ---- the two undocumented-unit traps ------------------------------------------------------------------------------

test('a draw is read whether it is spelt 1/2-1/2 or the typographic half the JSON schema documents', () => {
  assert.equal(readResult('1/2-1/2'), '1/2-1/2')
  // The published `status` schema documents this spelling. Reading only the PGN one would turn every drawn game
  // in a listing into "no result yet", which looks exactly like a feed that is working.
  assert.equal(readResult('½-½'), '1/2-1/2')
  assert.equal(readResult('1-0'), '1-0')
  assert.equal(readResult('*'), '*')
  assert.equal(readResult('something else'), undefined)
  assert.equal(readResult(undefined), undefined)
})

test('the provider clock is centiseconds, and an implausible one is refused rather than shown', () => {
  // 273000 is what the recording carries for a game whose TimeControl is "45+30": 2730 seconds is exactly
  // 45 minutes plus the 30-second increment, which is what fixes the unit the schema does not document.
  assert.equal(readClockSeconds(273000), 2730)
  assert.equal(readClockSeconds(0), 0)
  assert.equal(readClockSeconds(-5), undefined)
  assert.equal(readClockSeconds(undefined), undefined)
  // More than a day of thinking time is a unit this adapter has guessed wrong about, so it declines to show it.
  assert.equal(readClockSeconds(900_000_000), undefined)
})

test("a refusal in the body is recognised even when it arrives under the PGN content type", () => {
  assert.equal(describeError('{"error":"Please only run 2 request(s) at a time"}'), 'Please only run 2 request(s) at a time')
  assert.equal(describeError('[Event "x"]'), null)
  assert.equal(describeError('{}'), null)
  assert.equal(describeError('not json'), null)
})

// ---- discovery ------------------------------------------------------------------------------------------------------

test('the recorded NDJSON listing is read into tournaments and their rounds', async () => {
  const r = rig(() => ({ body: RECORDED_NDJSON }))
  const got = await adapter(r).official({ max: 3 })
  assert.ok(got.ok)
  assert.equal(got.value.tournaments.length, 2)
  assert.deepEqual(got.value.warnings, [])
  const first = got.value.tournaments[0]
  assert.equal(first.tour.name, 'German Bundesliga 2026/27 (Schachbundesliga)')
  assert.equal(first.tour.info?.timeControl, '90 min / 40 moves + 30 min + 30 sec / move')
  assert.equal(first.defaultRoundId, 'Fj6C4C8U')
  assert.equal(first.rounds.length, 2)
  // `finishedAt` is what is read; the `finished` boolean beside it is deprecated in the provider's own schema.
  assert.equal(first.rounds[0].finishedAt, 1791592008187)
  assert.equal(first.rounds[1].ongoing, true)
  assert.match(r.calls[0], /\/api\/broadcast\?nb=3$/)
  assert.equal(r.headers[0].Accept, 'application/x-ndjson')
})

test('asking only for live broadcasts uses the documented filter', async () => {
  const r = rig(() => ({ body: RECORDED_NDJSON }))
  await adapter(r).official({ max: 500, onlyLive: true })
  // `nb` is clamped to the documented maximum of 100 rather than sent as asked.
  assert.match(r.calls[0], /nb=100&live=true$/)
})

test('one unreadable line in a listing is a warning, not a failure', async () => {
  const r = rig(() => ({ body: `${RECORDED_NDJSON}\n{"tour":{"name":"no id"}}\nnot json at all` }))
  const got = await adapter(r).official()
  assert.ok(got.ok)
  assert.equal(got.value.tournaments.length, 2, 'the readable tournaments still arrive')
  assert.equal(got.value.warnings.length, 2)
  assert.ok(got.value.warnings.every((w) => w.kind === 'schema'))
})

test('a listing where nothing can be read is a schema fault, said as one', async () => {
  const r = rig(() => ({ body: '{"tournament":{"id":"x"}}\n{"tournament":{"id":"y"}}' }))
  const got = await adapter(r).official()
  assert.ok(!got.ok)
  assert.equal(got.diagnostic.kind, 'schema')
  assert.equal(got.diagnostic.field, 'tour')
  assert.match(got.diagnostic.message, /shape of its answer has probably changed/)
})

test('an empty listing is an empty listing, not a fault', async () => {
  const r = rig(() => ({ body: '\n' }))
  const got = await adapter(r).official()
  assert.ok(got.ok)
  assert.deepEqual(got.value.tournaments, [])
})

test('the featured listing reads active and past, and ignores the deprecated always-empty upcoming', async () => {
  const body = JSON.stringify({
    active: [{ group: 'A series', tour: JSON.parse(RECORDED_NDJSON.split('\n')[0]).tour, round: { id: 'Fj6C4C8U', name: 'Round 2', slug: 'round-2', ongoing: true, url: 'u' } }],
    upcoming: [],
    past: { currentPage: 1, maxPerPage: 20, currentPageResults: [], previousPage: null, nextPage: null }
  })
  const r = rig(() => ({ body }))
  const got = await adapter(r).top()
  assert.ok(got.ok)
  assert.equal(got.value.active.length, 1)
  // `group` is a plain string here and an object on the single-tournament endpoint; both give a usable name.
  assert.equal(got.value.active[0].tour.groupName, 'A series')
  assert.deepEqual(got.value.past, [])
  assert.match(r.calls[0], /\/api\/broadcast\/top\?page=1$/)
})

// ---- one round ------------------------------------------------------------------------------------------------------

test('the recorded round is read, with its games, its clocks in seconds and its undocumented delay', async () => {
  const r = rig(() => ({ body: RECORDED_ROUND_JSON }))
  const got = await adapter(r).round('oJfQJpmu')
  assert.ok(got.ok)
  // The slugs in the documented path are decoration, so "-" is sent for both.
  assert.match(r.calls[0], /\/api\/broadcast\/-\/-\/oJfQJpmu$/)
  assert.equal(got.value.round.name, 'Round 5')
  // Not documented on any read response, but really sent, and it decides whether anything may be called live.
  assert.equal(got.value.round.delaySeconds, 600)
  assert.equal(got.value.tour.tier, 4)
  assert.equal(got.value.games.length, 2)
  const game = got.value.games[0]
  assert.equal(game.id, 'piF74x35')
  assert.equal(game.white.name, 'Nainys, Zanas')
  assert.equal(game.white.title, 'FM')
  assert.equal(game.white.rating, 2301)
  assert.deepEqual(game.clocks, { white: 2730, black: 2730 })
  assert.equal(game.result, '*')
  assert.deepEqual(got.value.warnings, [])
})

test('a round with no startsAt, no ongoing and no finishedAt is unknown, not scheduled', async () => {
  const body = JSON.stringify({
    ...JSON.parse(RECORDED_ROUND_JSON),
    round: { id: 'oJfQJpmu', name: 'Round 5', slug: 'round-5', url: 'u' }
  })
  const r = rig(() => ({ body }))
  const got = await adapter(r).round('oJfQJpmu')
  assert.ok(got.ok)
  assert.equal(got.value.round.delaySeconds, undefined)
  assert.equal(got.value.games[0].status, 'unknown')
})

test('a drawn game in a listing is read from the typographic half the schema documents', async () => {
  // The recording's games were all ongoing; this alters one to the documented drawn value.
  const recorded = JSON.parse(RECORDED_ROUND_JSON)
  recorded.games[0].status = '½-½'
  const r = rig(() => ({ body: JSON.stringify(recorded) }))
  const got = await adapter(r).round('oJfQJpmu')
  assert.ok(got.ok)
  assert.equal(got.value.games[0].result, '1/2-1/2')
  assert.equal(got.value.games[0].status, 'finished')
})

test('an unreadable game is left out of the list and reported, and the round still loads', async () => {
  const recorded = JSON.parse(RECORDED_ROUND_JSON)
  recorded.games.push({ name: 'a game with no id' })
  const r = rig(() => ({ body: JSON.stringify(recorded) }))
  const got = await adapter(r).round('oJfQJpmu')
  assert.ok(got.ok)
  assert.equal(got.value.games.length, 2)
  assert.equal(got.value.warnings.length, 1)
  assert.equal(got.value.warnings[0].field, 'games[]')
})

test('a round whose shape has changed degrades to a schema diagnostic and never falls back to scraping', async () => {
  const r = rig(() => ({ body: JSON.stringify({ roundInfo: { id: 'oJfQJpmu' }, tour: { id: 'x', name: 'y', slug: 'z' } }) }))
  const a = adapter(r)
  const got = await a.round('oJfQJpmu')
  assert.ok(!got.ok)
  assert.equal(got.diagnostic.kind, 'schema')
  assert.equal(got.diagnostic.field, 'round')
  // Exactly one request was made. No HTML page was fetched, no second guess was taken.
  assert.equal(r.calls.length, 1)
  assert.ok(r.calls.every((url) => url.startsWith('https://lichess.org/api/')))
})

test('an id that is not a Lichess broadcast id is refused without troubling the provider', async () => {
  const r = rig(() => ({ body: RECORDED_ROUND_JSON }))
  const a = adapter(r)
  for (const bad of ['', 'short', 'way-too-long-id', '../../etc']) {
    const got = await a.round(bad)
    assert.ok(!got.ok, `"${bad}" should be refused`)
    assert.equal(got.diagnostic.field, 'broadcastRoundId')
  }
  assert.equal(r.calls.length, 0, 'nothing was asked of the provider')
})

// ---- rate limiting, timeouts, de-duplication, the breaker -----------------------------------------------------------

test('a 429 is honoured by waiting, and the next request is not even sent', async () => {
  const r = rig(() => ({ status: 429, body: '{"error":"Please only run 2 request(s) at a time"}' }))
  const a = adapter(r)
  const first = await a.round('oJfQJpmu')
  assert.ok(!first.ok)
  assert.equal(first.diagnostic.kind, 'rate-limit')
  assert.equal(first.diagnostic.status, 429)
  assert.match(first.diagnostic.message, /only run 2 request/)
  assert.equal(a.health().circuitOpen, true)
  assert.equal(a.health().openForMs, 60_000, 'the documented wait is a minute')

  const second = await a.round('oJfQJpmu')
  assert.ok(!second.ok)
  assert.equal(second.diagnostic.kind, 'circuit-open')
  assert.equal(r.calls.length, 1, 'hammering a provider that just asked for fewer requests is the one thing not to do')
})

test('a 200 whose body is an error object is a refusal, not a game', async () => {
  // Observed on the PGN endpoint, which serves application/x-chess-pgn and yet answers this.
  const r = rig(() => ({ status: 200, body: '{"error":"Please only run 2 request(s) at a time"}' }))
  const got = await adapter(r).roundPgn('oJfQJpmu')
  assert.ok(!got.ok)
  assert.equal(got.diagnostic.kind, 'rate-limit')
})

test('a provider that does not answer is a timeout, said as one', async () => {
  const r = rig(() => ({ hang: true }))
  const got = await adapter(r, { timeoutMs: 20 }).round('oJfQJpmu')
  assert.ok(!got.ok)
  assert.equal(got.diagnostic.kind, 'timeout')
  assert.match(got.diagnostic.message, /did not answer within/)
})

test('a network failure is a network fault, and keeps the provider name on it', async () => {
  const r = rig(() => ({ throws: new Error('getaddrinfo ENOTFOUND lichess.org') }))
  const got = await adapter(r).round('oJfQJpmu')
  assert.ok(!got.ok)
  assert.equal(got.diagnostic.kind, 'network')
  assert.equal(got.diagnostic.provider, 'lichess')
  assert.match(got.diagnostic.message, /ENOTFOUND/)
})

test('the same question asked twice at once costs one request', async () => {
  let served = 0
  const r = rig(() => {
    served += 1
    return { body: RECORDED_ROUND_JSON }
  })
  const a = adapter(r)
  const [one, two] = await Promise.all([a.round('oJfQJpmu'), a.round('oJfQJpmu')])
  assert.ok(one.ok)
  assert.ok(two.ok)
  assert.equal(served, 1)
  assert.equal(r.calls.length, 1)
})

test('requests go one at a time, because the provider documents that they must', async () => {
  const r = rig(() => ({ body: RECORDED_ROUND_JSON }))
  const a = adapter(r)
  await Promise.all([a.round('oJfQJpmu'), a.round('BVhC8xSt'), a.round('piF74x35'), a.official()])
  assert.equal(r.calls.length, 4)
  assert.equal(r.peakConcurrency, 1, 'two requests were in the air at once')
})

test('a provider that keeps failing is left alone for a while instead of being asked again', async () => {
  const r = rig(() => ({ throws: new Error('down') }))
  const a = adapter(r, { breakerThreshold: 3, breakerCooldownMs: 30_000 })
  for (let i = 0; i < 3; i++) await a.round('oJfQJpmu')
  assert.equal(r.calls.length, 3)
  assert.equal(a.health().consecutiveFailures, 3)
  assert.equal(a.health().circuitOpen, true)
  const blocked = await a.round('oJfQJpmu')
  assert.ok(!blocked.ok)
  assert.equal(blocked.diagnostic.kind, 'circuit-open')
  assert.equal(r.calls.length, 3, 'no further request was made while the circuit is open')
})

test('one good answer closes the circuit again', async () => {
  let fail = true
  const r = rig(() => (fail ? { throws: new Error('down') } : { body: RECORDED_ROUND_JSON }))
  const a = adapter(r, { breakerThreshold: 10 })
  await a.round('oJfQJpmu')
  assert.equal(a.health().consecutiveFailures, 1)
  fail = false
  const ok = await a.round('BVhC8xSt')
  assert.ok(ok.ok)
  assert.equal(a.health().consecutiveFailures, 0)
  assert.equal(a.health().circuitOpen, false)
})

test('a token and a user agent are sent as headers, and never in the address', async () => {
  const r = rig(() => ({ body: RECORDED_ROUND_JSON }))
  await adapter(r, { token: 'lip_secret', userAgent: 'Orbis/1.0' }).round('oJfQJpmu')
  assert.equal(r.headers[0].Authorization, 'Bearer lip_secret')
  assert.equal(r.headers[0]['User-Agent'], 'Orbis/1.0')
  assert.ok(!r.calls[0].includes('lip_secret'), 'a token must never appear in a URL')
})

// ---- the live stream -------------------------------------------------------------------------------------------------

function collect(): { payloads: LivePayload[]; diagnostics: LiveDiagnostic[]; states: string[]; handlers: Parameters<LichessBroadcasts['subscribeRound']>[1] } {
  const payloads: LivePayload[] = []
  const diagnostics: LiveDiagnostic[] = []
  const states: string[] = []
  return {
    payloads,
    diagnostics,
    states,
    handlers: {
      onPayloads: (p) => payloads.push(...p),
      onDiagnostic: (d) => diagnostics.push(d),
      onState: (s) => states.push(s)
    }
  }
}

test('the stream yields a payload per game, and uses the documented clocks and comments parameters', async () => {
  const r = rig(() => ({ chunks: chunksOf(RECORDED_GAME_PGN + RECORDED_GAME_PGN) }))
  const sink = collect()
  const sub = adapter(r).subscribeRound('Cd33Pm6w', sink.handlers, { maxReconnects: 0 })
  await sub.done
  assert.equal(sink.payloads.length, 2)
  assert.equal(sink.payloads[0].providerGameId, '4am6EXRb')
  assert.equal(sink.payloads[0].kind, 'snapshot')
  assert.match(r.calls[0], /\/api\/stream\/broadcast\/round\/Cd33Pm6w\.pgn\?clocks=true&comments=true$/)
  assert.ok(sink.states.includes('open'))
})

test('a game split across chunk boundaries is only emitted once it is whole', async () => {
  const half = Math.floor(RECORDED_GAME_PGN.length / 2)
  const r = rig(() => ({ chunks: chunksOf(RECORDED_GAME_PGN.slice(0, half), RECORDED_GAME_PGN.slice(half)) }))
  const sink = collect()
  await adapter(r).subscribeRound('Cd33Pm6w', sink.handlers, { maxReconnects: 0 }).done
  assert.equal(sink.payloads.length, 1, 'exactly one game, not a fragment and then a game')
  assert.equal(sink.payloads[0].moves.length, 8)
})

test('a byte-encoded stream reads the same as a text one, including across a split multi-byte character', async () => {
  // "Almería" in a player name: the two bytes of the accented letter are deliberately put in different chunks.
  // Both occurrences are replaced, because the name appears in the Event tag before it appears in the Black tag.
  const withAccent = RECORDED_GAME_PGN.replaceAll('Cirkvencic, Franci', 'Almería, José')
  const bytes = new TextEncoder().encode(withAccent)
  const cut = bytes.indexOf(0xc3) + 1
  const r = rig(() => ({ chunks: chunksOf(bytes.slice(0, cut), bytes.slice(cut)) }))
  const sink = collect()
  await adapter(r).subscribeRound('Cd33Pm6w', sink.handlers, { maxReconnects: 0 }).done
  assert.equal(sink.payloads.length, 1)
  assert.equal(sink.payloads[0].black?.name, 'Almería, José')
})

test('a refusal arriving inside the stream body stops it and is reported as a rate limit', async () => {
  const r = rig(() => ({ chunks: chunksOf('{"error":"Please only run 2 request(s) at a time"}') }))
  const sink = collect()
  await adapter(r).subscribeRound('Cd33Pm6w', sink.handlers, { maxReconnects: 0 }).done
  assert.deepEqual(sink.payloads, [])
  assert.equal(sink.diagnostics.some((d) => d.kind === 'rate-limit'), true)
})

test('a 429 on the stream waits the documented minute before the round is followed again', async () => {
  const r = rig(() => ({ status: 429, body: '{"error":"Please only run 2 request(s) at a time"}' }))
  const a = adapter(r)
  const sink = collect()
  await a.subscribeRound('Cd33Pm6w', sink.handlers, { maxReconnects: 0 }).done
  assert.equal(sink.diagnostics[0].kind, 'rate-limit')
  assert.ok(a.health().openForMs >= 60_000)
})

test('a dropped stream is retried, with a bounded jittered wait, and then given up on', async () => {
  const waits: number[] = []
  const r = rig(() => ({ throws: new Error('socket hang up') }))
  const a = createLichessBroadcasts({
    fetchFn: r.fetchFn,
    now: () => 1_792_000_000_000,
    sleep: async (ms) => {
      waits.push(ms)
    },
    random: () => 1,
    breakerThreshold: 99
  })
  const sink = collect()
  await a.subscribeRound('Cd33Pm6w', sink.handlers, { maxReconnects: 3 }).done
  assert.equal(r.calls.length, 4, 'the first attempt plus three retries')
  assert.ok(sink.states.includes('failed'))
  // Doubling, and capped: 2s, 4s, 8s with the jitter multiplier at its maximum.
  assert.deepEqual(waits, [2_000, 4_000, 8_000])
})

test('the jitter really varies the wait, so many clients do not reconnect in the same instant', async () => {
  const waitsFor = async (random: number): Promise<number[]> => {
    const waits: number[] = []
    const r = rig(() => ({ throws: new Error('socket hang up') }))
    const a = createLichessBroadcasts({ fetchFn: r.fetchFn, now: () => 1, sleep: async (ms) => void waits.push(ms), random: () => random, breakerThreshold: 99 })
    await a.subscribeRound('Cd33Pm6w', collect().handlers, { maxReconnects: 2 }).done
    return waits
  }
  const low = await waitsFor(0)
  const high = await waitsFor(1)
  assert.deepEqual(low, [1_000, 2_000])
  assert.deepEqual(high, [2_000, 4_000])
})

test('a stream that is stopped delivers nothing more and does not try to reconnect', async () => {
  let opened = 0
  const r = rig(() => {
    opened += 1
    return {
      chunks: (signal) =>
        (async function* () {
          yield RECORDED_GAME_PGN
          await new Promise<void>((resolve) => {
            if (signal?.aborted) return resolve()
            signal?.addEventListener('abort', () => resolve())
          })
        })()
    }
  })
  const sink = collect()
  const a = adapter(r)
  const sub = a.subscribeRound('Cd33Pm6w', sink.handlers, { maxReconnects: 5 })
  // Let the first game through, then stop.
  await new Promise((resolve) => setTimeout(resolve, 10))
  const delivered = sink.payloads.length
  sub.stop()
  await sub.done
  assert.equal(sink.payloads.length, delivered)
  assert.equal(opened, 1, 'a stopped subscription must not reconnect')
  assert.ok(sink.states.includes('stopped'))
  // Stopping twice is safe.
  sub.stop()
})

test('a silent connection is treated as lost once the idle timeout passes', async () => {
  const r = rig(() => ({
    chunks: (signal) =>
      (async function* () {
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()))
      })()
  }))
  const sink = collect()
  await adapter(r, { idleTimeoutMs: 20 }).subscribeRound('Cd33Pm6w', sink.handlers, { maxReconnects: 0 }).done
  assert.ok(sink.diagnostics.some((d) => d.kind === 'timeout'), 'the idle connection is reported as a timeout')
})

test('an accepted request with no stream to read is reported rather than silently doing nothing', async () => {
  const r = rig(() => ({ status: 200, body: '' }))
  const sink = collect()
  await adapter(r).subscribeRound('Cd33Pm6w', sink.handlers, { maxReconnects: 0 }).done
  assert.equal(sink.diagnostics[0].kind, 'network')
  assert.match(sink.diagnostics[0].message, /no stream to read/)
})

test('a bad round id is refused before any connection is opened', async () => {
  const r = rig(() => ({ chunks: chunksOf(RECORDED_GAME_PGN) }))
  const sink = collect()
  const sub = adapter(r).subscribeRound('nope', sink.handlers)
  await sub.done
  assert.equal(r.calls.length, 0)
  assert.equal(sink.diagnostics[0].kind, 'schema')
  assert.ok(sink.states.includes('failed'))
})

// ---- the adapter wearing the manager's shape ------------------------------------------------------------------------

test('the provider port flattens each tournament to the round a person means', async () => {
  const r = rig(() => ({ body: RECORDED_NDJSON }))
  const port = lichessProviderPort(adapter(r))
  const got = await port.discover({ max: 3 })
  assert.ok(got.ok)
  assert.equal(got.value.events.length, 2)
  // The first recording's defaultRoundId names round 2, which is the one under way.
  assert.equal(got.value.events[0].eventId, 'Fj6C4C8U')
  assert.equal(got.value.events[0].status, 'live')
  assert.match(got.value.events[0].name, /German Bundesliga.*Round 2/)
  assert.equal(got.value.events[0].tier, 5)
  assert.equal(got.value.events[1].eventId, 'oJfQJpmu')
  assert.equal(got.value.events[1].status, 'scheduled')
})

test('the provider port lists a round’s games without opening anything', async () => {
  const r = rig(() => ({ body: RECORDED_ROUND_JSON }))
  const port = lichessProviderPort(adapter(r))
  const got = await port.games('oJfQJpmu')
  assert.ok(got.ok)
  assert.equal(got.value.event.eventId, 'oJfQJpmu')
  assert.equal(got.value.event.delaySeconds, 600)
  assert.equal(got.value.games.length, 2)
  assert.equal(got.value.games[0].providerGameId, 'piF74x35')
  assert.equal(got.value.games[0].white.title, 'FM')
  // One plain request. Listing is not following.
  assert.equal(r.calls.length, 1)
  assert.ok(!r.calls[0].includes('/stream/'))
})

test('a listing fault reaches the port as the same diagnostic, not as an empty list', async () => {
  const r = rig(() => ({ status: 503, body: '' }))
  const got = await lichessProviderPort(adapter(r)).discover({})
  assert.ok(!got.ok)
  assert.equal(got.diagnostic.kind, 'http')
  assert.equal(got.diagnostic.status, 503)
})
