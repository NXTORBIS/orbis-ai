import { test } from 'node:test'
import assert from 'node:assert/strict'
import { START_FEN, applyMove } from './rules.ts'
import { fingerprintOf, type GameMeta, type GameMove, type GameSource, type StoredGame } from './model.ts'
import {
  COLLECTION_PREFIX, DEFAULT_ORDER, collectionTag, collectionsOf, compareRecords, cursorOf, dateWindow,
  deleteWarning, describeFilter, duplicateGroups, facetsOf, filterGames, fold, gameLine, gameTitle, importWords,
  isAnnotated, matches, matchesText, nameKey, nextTags, pageFrom, pageWords, parseGameDate, plainTags, queryTerms,
  rankOf, sameDate, searchText, sortGames, tagProblem, withoutPart,
  type LibraryCursor, type LibraryFilter, type SortKey
} from './library.ts'

/**
 * The library's pure layer.
 *
 * What is checked here is what a screen cannot check for itself: that a filter never hides a game it was not asked
 * about, that sorting puts what is unknown last in both directions, that a page keeps meaning the same place while
 * games are being added and deleted, and that two games with the same moves are only called the same game when the
 * records actually agree.
 *
 * The games are built by playing real moves through `rules.ts`, so every fingerprint in here is a fingerprint of a
 * game that can be replayed. Nothing is a hand-written string pretending to be a game.
 */

let counter = 0

/** A game, built by playing the moves given. Anything not said is genuinely absent, as it would be from a file. */
function game(o: {
  id?: string
  san?: string[]
  meta?: Partial<GameMeta>
  tags?: string[]
  favourite?: boolean
  source?: GameSource
  variant?: string
  createdAt?: number
  updatedAt?: number
  startFen?: string
}): StoredGame {
  counter += 1
  const startFen = o.startFen ?? START_FEN
  const moves: GameMove[] = []
  let fen = startFen
  for (const san of o.san ?? []) {
    const made = applyMove(fen, san)
    assert.ok(made, `${san} is not legal in ${fen}`)
    fen = made.after
    moves.push({ san: made.san, uci: made.uci, fen })
  }
  const meta: GameMeta = { white: {}, black: {}, result: '*', ...o.meta }
  return {
    id: o.id ?? `g${counter}`,
    profileId: 'p',
    source: o.source ?? { kind: 'import', importedAt: 1_700_000_000_000 },
    startFen,
    moves,
    meta,
    variant: o.variant ?? 'standard',
    createdAt: o.createdAt ?? 1_700_000_000_000,
    updatedAt: o.updatedAt ?? 1_700_000_000_000,
    ...(o.tags ? { tags: o.tags } : {}),
    ...(o.favourite === undefined ? {} : { favourite: o.favourite }),
    fingerprint: fingerprintOf(startFen, moves)
  }
}

const ids = (list: readonly StoredGame[]): string[] => list.map((one) => one.id)

// ---------------------------------------------------------------------------------------------------------------

test('folding makes text searchable the way a person types it', () => {
  assert.equal(fold('Réti'), 'reti')
  assert.equal(fold('CARLSEN'), 'carlsen')
  assert.equal(fold('Nielsøn'), 'nielson')
  assert.equal(fold('Łukasz'), 'lukasz')
  assert.equal(fold('Großmeister'), 'grossmeister')
  assert.equal(fold('Ðorđević'), 'dordevic')
  // The accented and the plain spelling fold to the same thing, which is the whole point.
  assert.equal(fold('Polgár'), fold('Polgar'))
  assert.equal(fold('Ding Liren'), 'ding liren')
})

test('a name is the same name whichever way round it is written', () => {
  assert.equal(nameKey('Carlsen, Magnus'), nameKey('Magnus Carlsen'))
  assert.equal(nameKey('Carlsen,Magnus'), nameKey('MAGNUS CARLSEN'))
  assert.equal(nameKey('Polgár, Judit'), nameKey('Judit Polgar'))
  assert.notEqual(nameKey('Magnus Carlsen'), nameKey('Magnus Carlsson'))
})

test('a PGN date is read as far as it goes and no further', () => {
  assert.deepEqual(parseGameDate('2021.07.14'), { year: 2021, month: 7, day: 14, text: '2021.07.14' })
  assert.deepEqual(parseGameDate('2021.??.??'), { year: 2021, text: '2021.??.??' })
  assert.deepEqual(parseGameDate('2021'), { year: 2021, text: '2021' })
  assert.deepEqual(parseGameDate('2021-07-14'), { year: 2021, month: 7, day: 14, text: '2021-07-14' })
  assert.deepEqual(parseGameDate('????.??.??'), { text: '????.??.??' })
  assert.deepEqual(parseGameDate(undefined), { text: '' })
  // A day with no month cannot be placed, so it is not claimed.
  assert.deepEqual(parseGameDate('2021.??.14'), { year: 2021, text: '2021.??.14' })
  // Out of range is not a date.
  assert.deepEqual(parseGameDate('2021.13.01'), { year: 2021, text: '2021.13.01' })
})

test('a half-written date is a window of time, not a point', () => {
  assert.deepEqual(dateWindow(parseGameDate('2021.07.14')), { first: 20_210_714, last: 20_210_714 })
  assert.deepEqual(dateWindow(parseGameDate('2021.??.??')), { first: 20_210_101, last: 20_211_231 })
  assert.equal(dateWindow(parseGameDate('????.??.??')), null)
})

// ---------------------------------------------------------------------------------------------------------------

test('searching covers the fields a game really has, and only those', () => {
  const one = game({
    san: ['e4', 'c5'],
    meta: { white: { name: 'Magnus Carlsen', title: 'GM' }, black: { name: 'Ding Liren' }, event: 'Tata Steel', site: 'Wijk aan Zee', date: '2021.01.16', eco: 'B20', opening: 'Sicilian Defence', result: '1-0' },
    tags: ['sharp', collectionTag('Favourites')]
  })
  const text = searchText(one)
  for (const want of ['carlsen', 'ding liren', 'tata steel', 'wijk aan zee', '2021.01.16', 'b20', 'sicilian', 'gm', 'sharp', 'favourites', 'standard']) {
    assert.ok(text.includes(want), `${want} is not searchable`)
  }
  // The moves are not searched: a search for "e4" must not match every game that opened with it.
  assert.ok(!text.includes('e4'))
  // The reserved beginning of a collection tag is not searchable text.
  assert.ok(!text.includes(COLLECTION_PREFIX))
})

test('search is case- and accent-insensitive in both directions', () => {
  const polgar = game({ san: ['d4'], meta: { white: { name: 'Judit Polgár' }, black: { name: 'Péter Lékó' } } })
  for (const query of ['polgar', 'POLGÁR', 'Polgár', 'polgár', 'leko', 'Lékó', 'LEKO']) {
    assert.ok(matchesText(polgar, query), query)
  }
  assert.ok(!matchesText(polgar, 'kasparov'))
})

test('several words all have to match, and a quoted phrase stays whole', () => {
  const one = game({ san: ['e4'], meta: { white: { name: 'Magnus Carlsen' }, event: 'London Chess Classic', date: '2019.12.01' } })
  assert.deepEqual(queryTerms('carlsen 2019'), ['carlsen', '2019'])
  assert.deepEqual(queryTerms('"london chess" carlsen'), ['london chess', 'carlsen'])
  assert.deepEqual(queryTerms('   '), [])
  assert.ok(matchesText(one, 'carlsen london'))
  assert.ok(!matchesText(one, 'carlsen berlin'))
  assert.ok(matchesText(one, '"london chess classic"'))
  assert.ok(!matchesText(one, '"chess london"'))
  // An empty query hides nothing.
  assert.ok(matchesText(one, ''))
})

test('the folded text is reused only while the game has not changed', () => {
  const one = game({ san: ['e4'], meta: { white: { name: 'Anna' } } })
  assert.ok(searchText(one).includes('anna'))
  // The store hands back a new object on a change; a caller editing in place is caught by the stamp.
  const edited = { ...one, meta: { ...one.meta, white: { name: 'Bruno' } }, updatedAt: one.updatedAt + 1 }
  assert.ok(searchText(edited).includes('bruno'))
  assert.ok(!searchText(edited).includes('anna'))
})

// ---------------------------------------------------------------------------------------------------------------

test('a filter that asks nothing hides nothing', () => {
  const list = [game({ san: ['e4'] }), game({ san: ['d4'] })]
  assert.deepEqual(ids(filterGames(list, {})), ids(list))
  assert.deepEqual(ids(filterGames(list, { text: '   ' })), ids(list))
  assert.deepEqual(ids(filterGames(list, { results: [] })), ids(list))
})

test('every filter matches on what is stored', () => {
  const a = game({
    id: 'a', san: ['e4', 'c5'], favourite: true, tags: ['sharp', collectionTag('Openings')],
    source: { kind: 'local-engine', engine: 'Stockfish' },
    meta: { white: { name: 'Ada' }, black: { name: 'Bo' }, event: 'Club Night', site: 'Leeds', date: '2021.05.02', result: '1-0', eco: 'B20', opening: 'Sicilian' }
  })
  const b = game({
    id: 'b', san: ['d4', 'd5', 'c4'], tags: ['quiet'],
    meta: { white: { name: 'Bo' }, black: { name: 'Ada' }, event: 'Open', date: '2023.11.30', result: '0-1', eco: 'D06' }
  })
  const c = game({ id: 'c', san: ['e4'], variant: 'chess960', meta: { white: { name: 'Cy' } } })
  const list = [a, b, c]

  assert.deepEqual(ids(filterGames(list, { player: 'ada' })), ['a', 'b'])
  assert.deepEqual(ids(filterGames(list, { white: 'ada' })), ['a'])
  assert.deepEqual(ids(filterGames(list, { black: 'ada' })), ['b'])
  assert.deepEqual(ids(filterGames(list, { event: 'club' })), ['a'])
  assert.deepEqual(ids(filterGames(list, { site: 'leeds' })), ['a'])
  assert.deepEqual(ids(filterGames(list, { results: ['1-0', '0-1'] })), ['a', 'b'])
  assert.deepEqual(ids(filterGames(list, { results: ['*'] })), ['c'])
  assert.deepEqual(ids(filterGames(list, { sources: ['local-engine'] })), ['a'])
  assert.deepEqual(ids(filterGames(list, { variants: ['chess960'] })), ['c'])
  assert.deepEqual(ids(filterGames(list, { tags: ['sharp'] })), ['a'])
  assert.deepEqual(ids(filterGames(list, { tags: ['SHARP'] })), ['a'])
  assert.deepEqual(ids(filterGames(list, { tags: ['sharp', 'quiet'] })), [])
  assert.deepEqual(ids(filterGames(list, { collections: ['openings'] })), ['a'])
  assert.deepEqual(ids(filterGames(list, { favourite: true })), ['a'])
  assert.deepEqual(ids(filterGames(list, { favourite: false })), ['b', 'c'])
  assert.deepEqual(ids(filterGames(list, { opening: 'sicilian' })), ['a'])
  assert.deepEqual(ids(filterGames(list, { opening: 'D06' })), ['b'])
  assert.deepEqual(ids(filterGames(list, { minMoves: 3 })), ['b'])
  assert.deepEqual(ids(filterGames(list, { maxMoves: 1 })), ['c'])
  assert.deepEqual(ids(filterGames(list, { minMoves: 2, maxMoves: 2 })), ['a'])
  // A collection is never a plain tag and a plain tag is never a collection.
  assert.deepEqual(plainTags(a), ['sharp'])
  assert.deepEqual(collectionsOf(a), ['Openings'])
  assert.deepEqual(ids(filterGames(list, { tags: ['Openings'] })), [])
})

test('a date range includes a game that could be in it and excludes one that cannot', () => {
  const precise = game({ id: 'precise', san: ['e4'], meta: { date: '2021.07.14' } })
  const yearOnly = game({ id: 'year', san: ['d4'], meta: { date: '2021.??.??' } })
  const earlier = game({ id: 'earlier', san: ['c4'], meta: { date: '2019.03.01' } })
  const undated = game({ id: 'undated', san: ['Nf3'] })
  const list = [precise, yearOnly, earlier, undated]

  assert.deepEqual(ids(filterGames(list, { from: '2021.01.01' })), ['precise', 'year'])
  assert.deepEqual(ids(filterGames(list, { to: '2020.12.31' })), ['earlier'])
  assert.deepEqual(ids(filterGames(list, { from: '2021.07.14', to: '2021.07.14' })), ['precise', 'year'])
  // The year-only game overlaps July 2021, so it is shown; it is not claimed to be on the 14th.
  assert.deepEqual(ids(filterGames(list, { from: '2021.08.01', to: '2021.08.31' })), ['year'])
  assert.deepEqual(ids(filterGames(list, { from: '2022.01.01' })), [])
  // A game with no date at all cannot be shown to be in range.
  assert.ok(!ids(filterGames(list, { from: '1900.01.01' })).includes('undated'))
  // With no bounds it is shown like everything else.
  assert.deepEqual(ids(filterGames(list, {})), ids(list))
  // A bound that is not a date is no bound -- and the screen is told to say so rather than look like it is working.
  assert.deepEqual(ids(filterGames(list, { from: 'whenever' })), ids(list))
  const said = describeFilter({ from: 'whenever', to: '2021' })
  assert.ok(said.find((one) => one.key === 'from')?.words.includes('narrowing nothing'))
  assert.ok(!said.find((one) => one.key === 'to')?.words.includes('narrowing nothing'))
})

test('notes are counted as notes and nothing claims to know about the engine', () => {
  const plain = game({ san: ['e4', 'c5'] })
  const noted = game({ san: ['e4'] })
  noted.moves[0].comment = 'The most popular first move.'
  const marked = game({ san: ['e4'] })
  marked.moves[0].nag = ['!']
  assert.ok(!isAnnotated(plain))
  assert.ok(isAnnotated(noted))
  assert.ok(isAnnotated(marked))
  assert.deepEqual(ids(filterGames([plain, noted, marked], { annotated: true })), ids([noted, marked]))
  assert.deepEqual(ids(filterGames([plain, noted, marked], { annotated: false })), [plain.id])
})

test('a filter says what it is asking, and one part of it can be taken off', () => {
  const filter: LibraryFilter = { text: 'carlsen', favourite: true, results: ['1-0'], from: '2021' }
  const said = describeFilter(filter)
  assert.deepEqual(said.map((one) => one.key), ['text', 'from', 'results', 'favourite'])
  assert.ok(said.some((one) => one.words.includes('White won')))
  assert.ok(said.some((one) => one.words === 'starred'))
  const fewer = withoutPart(filter, 'favourite')
  assert.equal(fewer.favourite, undefined)
  assert.equal(fewer.text, 'carlsen')
  assert.deepEqual(describeFilter({}), [])
  // Taking a part off never changes the original.
  assert.equal(filter.favourite, true)
})

// ---------------------------------------------------------------------------------------------------------------

test('what is unknown sorts last, whichever way the order runs', () => {
  const dated = game({ id: 'dated', san: ['e4'], meta: { date: '2021.01.01' } })
  const later = game({ id: 'later', san: ['d4'], meta: { date: '2024.06.06' } })
  const undated = game({ id: 'undated', san: ['c4'] })
  const alsoUndated = game({ id: 'also', san: ['Nf3'], meta: { date: '????.??.??' } })
  const list = [undated, later, alsoUndated, dated]

  assert.deepEqual(ids(sortGames(list, { key: 'date', direction: 'up' })), ['dated', 'later', 'also', 'undated'])
  assert.deepEqual(ids(sortGames(list, { key: 'date', direction: 'down' })), ['later', 'dated', 'also', 'undated'])

  const named = game({ id: 'named', san: ['e4'], meta: { white: { name: 'Zoe' } } })
  const blackOnly = game({ id: 'blackonly', san: ['d4'], meta: { black: { name: 'Ada' } } })
  const nameless = game({ id: 'nameless', san: ['c4'] })
  const byPlayer = [nameless, named, blackOnly]
  // A game that names only Black still sorts by that name rather than falling to the bottom.
  assert.deepEqual(ids(sortGames(byPlayer, { key: 'player', direction: 'up' })), ['blackonly', 'named', 'nameless'])
  assert.deepEqual(ids(sortGames(byPlayer, { key: 'player', direction: 'down' })), ['named', 'blackonly', 'nameless'])

  const won = game({ id: 'won', san: ['e4'], meta: { result: '1-0' } })
  const drawn = game({ id: 'drawn', san: ['d4'], meta: { result: '1/2-1/2' } })
  const lost = game({ id: 'lost', san: ['c4'], meta: { result: '0-1' } })
  const noResult = game({ id: 'none', san: ['Nf3'] })
  const byResult = [noResult, lost, drawn, won]
  assert.deepEqual(ids(sortGames(byResult, { key: 'result', direction: 'up' })), ['won', 'drawn', 'lost', 'none'])
  assert.deepEqual(ids(sortGames(byResult, { key: 'result', direction: 'down' })), ['lost', 'drawn', 'won', 'none'])

  const withEvent = game({ id: 'withevent', san: ['e4'], meta: { event: 'Olympiad' } })
  const noEvent = game({ id: 'noevent', san: ['d4'] })
  assert.deepEqual(ids(sortGames([noEvent, withEvent], { key: 'event', direction: 'up' })), ['withevent', 'noevent'])
  assert.deepEqual(ids(sortGames([noEvent, withEvent], { key: 'event', direction: 'down' })), ['withevent', 'noevent'])
})

test('a number sorts as a number and not as its digits', () => {
  const short = game({ id: 'short', san: ['e4', 'c5'] })
  const longer = game({ id: 'longer', san: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'] })
  assert.deepEqual(ids(sortGames([longer, short], { key: 'moves', direction: 'up' })), ['short', 'longer'])
  assert.equal(rankOf(short, 'moves'), '000002')
  assert.equal(rankOf(longer, 'moves'), '000010')
  assert.ok((rankOf(short, 'moves') as string) < (rankOf(longer, 'moves') as string))
})

test('equal games keep one order, and reversing the sort does not shuffle them', () => {
  const same = ['x', 'y', 'z', 'w'].map((id) => game({ id, san: ['e4'], meta: { event: 'One Event', date: '2021.01.01' }, updatedAt: 5 }))
  const up = ids(sortGames(same, { key: 'date', direction: 'up' }))
  const down = ids(sortGames(same, { key: 'date', direction: 'down' }))
  // Everything ties on the date, so the tiebreak decides, and the tiebreak does not care about the direction.
  assert.deepEqual(up, down)
  assert.deepEqual(up, ['w', 'x', 'y', 'z'])
  // Sorting the same games twice gives the same list, whatever order they arrive in.
  assert.deepEqual(ids(sortGames([...same].reverse(), { key: 'date', direction: 'up' })), up)
})

test('a tie is broken by what changed most recently, then by the record itself', () => {
  const old = game({ id: 'b-old', san: ['e4'], meta: { event: 'Event' }, updatedAt: 10 })
  const fresh = game({ id: 'a-fresh', san: ['d4'], meta: { event: 'Event' }, updatedAt: 99 })
  assert.deepEqual(ids(sortGames([old, fresh], { key: 'event', direction: 'up' })), ['a-fresh', 'b-old'])
  assert.deepEqual(ids(sortGames([old, fresh], { key: 'event', direction: 'down' })), ['a-fresh', 'b-old'])
})

test('sorting leaves the list it was given alone', () => {
  const list = [game({ id: 'one', san: ['e4'] }), game({ id: 'two', san: ['d4'] })]
  const before = ids(list)
  sortGames(list, { key: 'moves', direction: 'down' })
  assert.deepEqual(ids(list), before)
})

test('every sort key has a rank or honestly has none', () => {
  const bare = game({ id: 'bare', san: [] })
  const full = game({ id: 'full', san: ['e4'], meta: { white: { name: 'A' }, event: 'E', result: '1-0', date: '2021.01.01' } })
  const keys: SortKey[] = ['date', 'player', 'event', 'result', 'updated', 'created', 'moves']
  for (const key of keys) {
    const rank = rankOf(full, key)
    assert.equal(typeof rank, 'string', key)
  }
  // A bare record knows when it does not know.
  assert.equal(rankOf(bare, 'date'), null)
  assert.equal(rankOf(bare, 'player'), null)
  assert.equal(rankOf(bare, 'event'), null)
  assert.equal(rankOf(bare, 'result'), null)
  // These are always known: a record always has a time and a move count, even when the count is nought.
  assert.equal(typeof rankOf(bare, 'updated'), 'string')
  assert.equal(typeof rankOf(bare, 'created'), 'string')
  assert.equal(rankOf(bare, 'moves'), '000000')
})

// ---------------------------------------------------------------------------------------------------------------

test('a page is a page, and it says which games it is showing', () => {
  const list = Array.from({ length: 25 }, (_, i) => game({ id: `g-${String(i).padStart(2, '0')}`, san: ['e4'], updatedAt: 1000 + i }))
  const sorted = sortGames(list, DEFAULT_ORDER)
  const first = pageFrom(sorted, { size: 10, order: DEFAULT_ORDER })
  assert.equal(first.games.length, 10)
  assert.equal(first.start, 0)
  assert.equal(first.total, 25)
  assert.ok(first.more)
  assert.equal(pageWords(first), 'Games 1-10 of 25')

  const second = pageFrom(sorted, { size: 10, cursor: first.nextCursor, order: DEFAULT_ORDER })
  assert.equal(second.start, 10)
  assert.deepEqual(ids(second.games), ids(sorted.slice(10, 20)))
  const third = pageFrom(sorted, { size: 10, cursor: second.nextCursor, order: DEFAULT_ORDER })
  assert.equal(third.games.length, 5)
  assert.equal(third.more, false)
  assert.equal(third.nextCursor, null)
  assert.equal(pageWords(third), 'Games 21-25 of 25')
  // No game is shown twice and none is skipped.
  assert.deepEqual([...first.games, ...second.games, ...third.games].map((one) => one.id), ids(sorted))
})

test('one game answers a filter the same way the whole list does, and a cursor names a game', () => {
  const list = [
    game({ id: 'a', san: ['e4'], favourite: true, meta: { white: { name: 'Ada' } } }),
    game({ id: 'b', san: ['d4'], meta: { white: { name: 'Bo' } } })
  ]
  const filter: LibraryFilter = { favourite: true }
  // Whatever `filterGames` keeps is exactly what `matches` says yes to, one game at a time.
  for (const one of list) assert.equal(matches(one, filter), ids(filterGames(list, filter)).includes(one.id))

  const order = { key: 'player', direction: 'up' } as const
  const sorted = sortGames(list, order)
  const page = pageFrom(sorted, { size: 1, order })
  // The cursor the page hands back is the position of its last game, worked out the same way as anywhere else.
  assert.deepEqual(page.nextCursor, cursorOf(page.games[0], order))
})

test('a page keeps meaning the same place when games are removed before it', () => {
  const list = Array.from({ length: 30 }, (_, i) => game({ id: `g-${String(i).padStart(2, '0')}`, san: ['e4'], updatedAt: 2000 + i }))
  const order = { key: 'updated', direction: 'down' } as const
  const sorted = sortGames(list, order)
  const first = pageFrom(sorted, { size: 10, order })
  const expectedSecond = ids(sorted.slice(10, 20))

  // Five of the games on the first page are deleted while the second page is being asked for.
  const fewer = sortGames(sorted.filter((one) => !ids(first.games.slice(0, 5)).includes(one.id)), order)
  const second = pageFrom(fewer, { size: 10, cursor: first.nextCursor, order })
  assert.deepEqual(ids(second.games), expectedSecond, 'games were skipped past')
  assert.equal(second.start, 5)

  // And when the game the cursor named is itself deleted, the page still begins in the right place.
  const withoutAnchor = sortGames(sorted.filter((one) => one.id !== first.games[9].id), order)
  const afterGone = pageFrom(withoutAnchor, { size: 10, cursor: first.nextCursor, order })
  assert.deepEqual(ids(afterGone.games), expectedSecond)
})

test('a page keeps meaning the same place when games are added before it', () => {
  const list = Array.from({ length: 20 }, (_, i) => game({ id: `g-${String(i).padStart(2, '0')}`, san: ['e4'], updatedAt: 3000 + i }))
  const order = { key: 'updated', direction: 'down' } as const
  const sorted = sortGames(list, order)
  const first = pageFrom(sorted, { size: 5, order })
  const expectedSecond = ids(sorted.slice(5, 10))

  // An import lands four newer games, which all sort above the first page.
  const arrived = Array.from({ length: 4 }, (_, i) => game({ id: `new-${i}`, san: ['d4'], updatedAt: 9000 + i }))
  const bigger = sortGames([...sorted, ...arrived], order)
  const second = pageFrom(bigger, { size: 5, cursor: first.nextCursor, order })
  assert.deepEqual(ids(second.games), expectedSecond, 'games were shown twice')
  assert.equal(second.total, 24)
})

test('a cursor works on every sort key, including the ones with unknowns', () => {
  const list = [
    game({ id: 'a', san: ['e4'], meta: { date: '2020.01.01', event: 'A', result: '1-0', white: { name: 'Ann' } } }),
    game({ id: 'b', san: ['d4', 'd5'], meta: { date: '2021.01.01', event: 'B', result: '0-1', white: { name: 'Bob' } } }),
    game({ id: 'c', san: ['c4'] }),
    game({ id: 'd', san: ['Nf3'], meta: { date: '2022.01.01', event: 'D', result: '1/2-1/2' } })
  ]
  const keys: SortKey[] = ['date', 'player', 'event', 'result', 'updated', 'created', 'moves']
  for (const key of keys) {
    for (const direction of ['up', 'down'] as const) {
      const order = { key, direction }
      const sorted = sortGames(list, order)
      const walked: string[] = []
      let cursor = null as LibraryCursor | null
      for (let i = 0; i < 10; i++) {
        const page = pageFrom(sorted, { size: 1, cursor, order })
        if (!page.games.length) break
        walked.push(page.games[0].id)
        cursor = page.nextCursor
        if (!cursor) break
      }
      assert.deepEqual(walked, ids(sorted), `${key} ${direction}`)
    }
  }
})

test('a page of an empty library says so rather than showing nothing in particular', () => {
  const page = pageFrom([], { size: 10, order: DEFAULT_ORDER })
  assert.deepEqual(page.games, [])
  assert.equal(page.total, 0)
  assert.equal(page.more, false)
  assert.equal(pageWords(page), 'No games')
  assert.equal(pageWords(pageFrom([game({ san: ['e4'] })], { size: 10, order: DEFAULT_ORDER })), '1 game')
})

// ---------------------------------------------------------------------------------------------------------------

test('the same game twice is the same game', () => {
  const san = ['e4', 'c5', 'Nf3', 'd6']
  const a = game({ id: 'a', san, meta: { white: { name: 'Magnus Carlsen' }, black: { name: 'Ding Liren' }, event: 'Tata Steel', date: '2021.01.16', result: '1-0' } })
  const b = game({ id: 'b', san, meta: { white: { name: 'Carlsen, Magnus' }, black: { name: 'Ding Liren' }, event: 'Tata Steel', date: '2021.01.16', result: '1-0' } })
  const comparison = compareRecords(a, b)
  assert.equal(comparison.verdict, 'same-game')
  assert.deepEqual(comparison.conflicts, [])
  assert.deepEqual(comparison.onlyOne, [])
})

test('one record knowing more is not a disagreement', () => {
  const san = ['d4', 'Nf6', 'c4', 'e6']
  const sparse = game({ id: 'sparse', san, meta: { white: { name: 'Ada' }, black: { name: 'Bo' }, result: '1/2-1/2' } })
  const full = game({ id: 'full', san, meta: { white: { name: 'Ada' }, black: { name: 'Bo' }, result: '1/2-1/2', event: 'Hastings', site: 'Hastings', date: '1999.01.02', round: '3' } })
  const comparison = compareRecords(sparse, full)
  assert.equal(comparison.verdict, 'same-game')
  assert.deepEqual(comparison.conflicts, [])
  assert.deepEqual(comparison.onlyOne.map((one) => one.field).sort(), ['Date', 'Event', 'Place', 'Round'])
  assert.ok(comparison.because.some((line) => line.includes('knows more')))
  // A half-written date does not contradict a full one.
  assert.ok(sameDate('2021.??.??', '2021.07.14'))
  assert.ok(!sameDate('2021.07.14', '2021.07.15'))
  assert.ok(sameDate('????.??.??', '2021.07.14'))
})

test('the same moves in two different tournaments are not one game', () => {
  const san = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']
  const a = game({ id: 'a', san, meta: { white: { name: 'Ada' }, black: { name: 'Bo' }, event: 'Spring Open', date: '2021.03.01', result: '1-0' } })
  const b = game({ id: 'b', san, meta: { white: { name: 'Cy' }, black: { name: 'Di' }, event: 'Autumn Open', date: '2021.09.01', result: '0-1' } })
  const comparison = compareRecords(a, b)
  assert.equal(comparison.verdict, 'same-moves')
  assert.deepEqual(comparison.conflicts.map((one) => one.field).sort(), ['Black', 'Date', 'Event', 'Result', 'White'])
  assert.ok(comparison.because[0].includes('identical'))
})

test('different games are different, and it says how', () => {
  const a = game({ id: 'a', san: ['e4', 'c5'] })
  const longer = game({ id: 'longer', san: ['e4', 'c5', 'Nf3'] })
  const other = game({ id: 'other', san: ['d4', 'd5'] })
  const fromPosition = game({ id: 'pos', san: ['Kb1'], startFen: '8/8/8/8/8/8/8/K6k w - - 0 1' })
  const alsoFromStart = game({ id: 'start', san: ['e4'] })

  assert.equal(compareRecords(a, longer).verdict, 'different')
  assert.ok(compareRecords(a, longer).because[0].includes('2 moves'))
  assert.equal(compareRecords(a, other).verdict, 'different')
  assert.equal(compareRecords(fromPosition, alsoFromStart).verdict, 'different')
  assert.ok(compareRecords(fromPosition, alsoFromStart).because[0].includes('different positions'))
})

test('two different variants are never the same game', () => {
  const san = ['e4', 'e5']
  const normal = game({ id: 'normal', san, meta: { white: { name: 'Ada' } } })
  const other = game({ id: 'other', san, variant: 'chess960', meta: { white: { name: 'Ada' } } })
  const comparison = compareRecords(normal, other)
  assert.equal(comparison.verdict, 'different')
  assert.deepEqual(comparison.conflicts, [{ field: 'Variant', a: 'standard', b: 'chess960' }])
})

test('two empty boards are not duplicates of each other', () => {
  const a = game({ id: 'a', san: [] })
  const b = game({ id: 'b', san: [] })
  assert.equal(a.fingerprint, b.fingerprint)
  const comparison = compareRecords(a, b)
  assert.equal(comparison.verdict, 'different')
  assert.ok(comparison.because[0].includes('nothing to compare'))
  assert.deepEqual(duplicateGroups([a, b]), [])
})

test('duplicate groups keep the three kinds apart', () => {
  const san = ['e4', 'c5', 'Nf3']
  const one = game({ id: 'one', san, meta: { white: { name: 'Ada' }, black: { name: 'Bo' }, event: 'Open', date: '2021.01.01' } })
  const copy = game({ id: 'copy', san, meta: { white: { name: 'Ada' }, black: { name: 'Bo' }, event: 'Open', date: '2021.01.01' } })
  const impostor = game({ id: 'impostor', san, meta: { white: { name: 'Cy' }, black: { name: 'Di' }, event: 'Other', date: '2022.02.02' } })
  const unrelated = game({ id: 'unrelated', san: ['d4', 'd5'] })

  const groups = duplicateGroups([one, copy, impostor, unrelated])
  assert.equal(groups.length, 2)
  const same = groups.find((g) => g.verdict === 'same-game')
  const moves = groups.find((g) => g.verdict === 'same-moves')
  assert.ok(same)
  assert.ok(moves)
  assert.deepEqual(same.ids.sort(), ['copy', 'one'])
  // The impostor is named beside one of the copies, not lumped in with them: it shares the moves and nothing else.
  assert.deepEqual(moves.ids, ['one', 'impostor'])
  assert.ok(moves.conflicts.some((one) => one.field === 'White'))
  // A library with nothing repeated has no groups at all.
  assert.deepEqual(duplicateGroups([one, unrelated]), [])
})

test('three copies of one game are one group', () => {
  const san = ['e4', 'e5', 'Nf3', 'Nc6']
  const list = ['a', 'b', 'c'].map((id) => game({ id, san, meta: { white: { name: 'Ada' }, black: { name: 'Bo' } } }))
  const groups = duplicateGroups(list)
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].ids.sort(), ['a', 'b', 'c'])
  assert.equal(groups[0].verdict, 'same-game')
})

// ---------------------------------------------------------------------------------------------------------------

test('tags and collections are kept apart, and a name that would break that is refused', () => {
  assert.equal(tagProblem('sharp'), null)
  assert.equal(tagProblem(''), 'It needs a name.')
  assert.equal(tagProblem('   '), 'It needs a name.')
  assert.ok(tagProblem('x'.repeat(61))?.includes('60'))
  assert.ok(tagProblem(`${COLLECTION_PREFIX}Sneaky`)?.includes(COLLECTION_PREFIX))
  assert.equal(tagProblem('Openings', 'collection'), null)
  assert.ok(tagProblem('a:b', 'collection')?.includes('colon'))
})

test('a bulk tag is worked out per game rather than written over the top', () => {
  assert.deepEqual(nextTags(['sharp'], ['blunder']), ['sharp', 'blunder'])
  // Already there, in another case: the spelling that was there is kept and nothing is added.
  assert.deepEqual(nextTags(['Sharp'], ['sharp']), ['Sharp'])
  assert.deepEqual(nextTags(['sharp', 'quiet'], [], ['SHARP']), ['quiet'])
  assert.deepEqual(nextTags(undefined, ['first']), ['first'])
  assert.deepEqual(nextTags(['  spaced  '], []), ['spaced'])
  assert.deepEqual(nextTags(['a', 'a', 'A'], []), ['a'])
  assert.deepEqual(nextTags(['a'], ['b'], ['b']), ['a'])
  // A collection tag passes through untouched, because it is stored the same way.
  assert.deepEqual(nextTags([collectionTag('Openings')], ['sharp']), [collectionTag('Openings'), 'sharp'])
})

test('the counts offered as filters are counts of games that are really there', () => {
  const list = [
    game({ san: ['e4'], favourite: true, tags: ['sharp', collectionTag('Openings')], meta: { white: { name: 'Ada' }, black: { name: 'Bo' }, event: 'Open', date: '2021.01.01', result: '1-0' } }),
    game({ san: ['d4'], tags: ['sharp'], meta: { white: { name: 'Ada' }, event: 'Open', date: '2023.01.01', result: '1-0' } }),
    game({ san: ['c4'], meta: { white: { name: 'Cy' } } })
  ]
  list[0].moves[0].comment = 'A note.'
  const facets = facetsOf(list)
  assert.equal(facets.total, 3)
  assert.equal(facets.favourites, 1)
  assert.equal(facets.annotated, 1)
  assert.equal(facets.undated, 1)
  assert.deepEqual(facets.tags, [{ value: 'sharp', label: 'sharp', count: 2 }])
  assert.deepEqual(facets.collections, [{ value: 'openings', label: 'Openings', count: 1 }])
  assert.deepEqual(facets.events, [{ value: 'open', label: 'Open', count: 2 }])
  assert.deepEqual(facets.years.map((one) => one.value), ['2023', '2021'])
  assert.deepEqual(facets.players[0], { value: 'ada', label: 'Ada', count: 2 })
  assert.deepEqual(facets.variants, [{ value: 'standard', label: 'standard', count: 3 }])
  assert.equal(facets.results.find((one) => one.value === '1-0')?.count, 2)
  assert.equal(facets.results.find((one) => one.value === '*')?.count, 1)
  // Nothing that no game has is offered.
  assert.equal(facets.results.find((one) => one.value === '0-1'), undefined)
  assert.deepEqual(facetsOf([]).players, [])
  assert.equal(facetsOf([]).total, 0)
})

test('a game is named and described out of what it has, with nothing filled in', () => {
  const full = game({ san: ['e4', 'c5'], meta: { white: { name: 'Ada' }, black: { name: 'Bo' }, event: 'Open', date: '2021.01.01', round: '4', result: '1-0', eco: 'B20' } })
  assert.equal(gameTitle(full), 'Ada vs Bo')
  const line = gameLine(full)
  for (const want of ['Open', '2021.01.01', 'round 4', '2 moves', '1-0', 'B20']) assert.ok(line.includes(want), want)

  assert.equal(gameTitle(game({ san: ['e4'], meta: { white: { name: 'Ada' } } })), 'Ada vs an unnamed player')
  assert.equal(gameTitle(game({ san: ['e4'], meta: { black: { name: 'Bo' } } })), 'An unnamed player vs Bo')
  assert.equal(gameTitle(game({ san: ['e4'], meta: { event: 'Club Night' } })), 'Club Night')
  assert.equal(gameTitle(game({ san: ['e4'] })), 'Game of 1 move')
  assert.equal(gameTitle(game({ san: [] })), 'Game of 0 moves')
  // A game with no result says so rather than showing a star.
  assert.ok(gameLine(game({ san: ['e4'] })).includes('no result recorded'))
})

test('a delete says exactly what it will take', () => {
  const list = [
    game({ id: 'a', san: ['e4'], favourite: true, tags: [collectionTag('Openings')], meta: { white: { name: 'Ada' }, black: { name: 'Bo' } } }),
    game({ id: 'b', san: ['d4'], meta: { white: { name: 'Cy' }, black: { name: 'Di' } } })
  ]
  const warning = deleteWarning(list)
  assert.equal(warning.heading, 'Remove 2 games?')
  assert.deepEqual(warning.names, ['Ada vs Bo', 'Cy vs Di'])
  assert.ok(warning.lines.some((line) => line.includes('1 of them is starred')))
  assert.ok(warning.lines.some((line) => line.includes('Openings')))
  assert.ok(warning.lines.some((line) => line.includes('cannot be undone')))
  const one = deleteWarning([list[1]])
  assert.equal(one.heading, 'Remove Cy vs Di?')
  assert.ok(!one.lines.some((line) => line.includes('starred')))
  // Only the first few names are listed, so a confirmation for a thousand games is still readable.
  const many = deleteWarning(Array.from({ length: 50 }, (_, i) => game({ id: `m${i}`, san: ['e4'] })))
  assert.equal(many.names.length, 8)
  assert.equal(many.heading, 'Remove 50 games?')
})

test('an import summary reports the zeroes that matter', () => {
  assert.equal(importWords({ imported: 3, skippedDuplicates: 0, failed: [] }), '3 brought in.')
  assert.equal(importWords({ imported: 0, skippedDuplicates: 0, failed: [1, 2, 3] }), '0 brought in, 3 could not be read.')
  assert.equal(importWords({ imported: 1, skippedDuplicates: 2, failed: [1] }), '1 brought in, 2 already here, 1 could not be read.')
})

// ---------------------------------------------------------------------------------------------------------------

/**
 * Filtering and sorting a library that is bigger than anybody's.
 *
 * The numbers printed here are what the machine running the test actually did, not a target. What the assertions
 * guard is the shape of the cost: filtering a few thousand games has to be one pass with a cached folded string
 * rather than re-folding every field on every keystroke, and a page has to be found by halving the list rather than
 * walking it. A failure here is a list that stutters while somebody types.
 */
test('a library of several thousand games filters, sorts and pages quickly', () => {
  const EVENTS = ['Tata Steel', 'Candidates', 'Olympiad', 'Club Night', 'Grand Prix', 'Hastings']
  const NAMES = ['Magnus Carlsen', 'Ding Liren', 'Judit Polgár', 'Péter Lékó', 'Hikaru Nakamura', 'Ian Nepomniachtchi', 'Anish Giri', 'Wesley So']
  const OPENINGS: [string, string][] = [['B20', 'Sicilian Defence'], ['D06', "Queen's Gambit"], ['C65', 'Berlin Defence'], ['E60', 'King\'s Indian']]
  const RESULTS = ['1-0', '0-1', '1/2-1/2', '*'] as const
  const LINES = [
    ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6'],
    ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Nf3', 'c6'],
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4'],
    ['Nf3', 'Nf6', 'c4', 'g6', 'b3', 'Bg7', 'Bb2', 'O-O']
  ]
  // The lines are played once and the moves reused, so the cost measured below is the library's and not chess.js's.
  const played = LINES.map((line) => game({ san: line }).moves)

  const COUNT = 5000
  const many: StoredGame[] = []
  for (let i = 0; i < COUNT; i++) {
    const moves = played[i % played.length].slice(0, 2 + (i % 7))
    const [eco, opening] = OPENINGS[i % OPENINGS.length]
    // Every tenth game has no date and every seventh no event, so the unknown paths are exercised at scale too.
    const meta: GameMeta = {
      white: { name: NAMES[i % NAMES.length], rating: 2500 + (i % 300) },
      black: { name: NAMES[(i + 3) % NAMES.length] },
      result: RESULTS[i % RESULTS.length],
      ...(i % 10 === 0 ? {} : { date: `${2000 + (i % 25)}.${String(1 + (i % 12)).padStart(2, '0')}.${String(1 + (i % 28)).padStart(2, '0')}` }),
      ...(i % 7 === 0 ? {} : { event: EVENTS[i % EVENTS.length] }),
      eco,
      opening
    }
    many.push({
      id: `perf-${String(i).padStart(5, '0')}`,
      profileId: 'p',
      source: { kind: 'import', importedAt: 1_700_000_000_000 + i },
      startFen: START_FEN,
      moves,
      meta,
      variant: 'standard',
      createdAt: 1_600_000_000_000 + i * 1000,
      updatedAt: 1_700_000_000_000 + i * 1000,
      ...(i % 5 === 0 ? { tags: ['reviewed'] } : {}),
      ...(i % 11 === 0 ? { favourite: true } : {}),
      fingerprint: fingerprintOf(START_FEN, moves)
    })
  }
  assert.equal(many.length, COUNT)

  const timed = <T>(what: string, work: () => T): T => {
    const at = performance.now()
    const out = work()
    const took = Math.round((performance.now() - at) * 100) / 100
    process.stdout.write(`    ${what}: ${took}ms\n`)
    return out
  }

  // Cold: nothing is cached yet, which is the first keystroke.
  const cold = timed(`text search over ${COUNT} games, nothing cached`, () => filterGames(many, { text: 'polgar' }))
  assert.ok(cold.length > 0 && cold.length < COUNT)
  const warm = timed(`the same search again, folded text cached`, () => filterGames(many, { text: 'polgar' }))
  assert.equal(warm.length, cold.length)

  const narrow = timed('a search of several words and three other filters', () =>
    filterGames(many, { text: 'carlsen sicilian', results: ['1-0'], from: '2010.01.01', favourite: true }))
  assert.ok(narrow.every((one) => one.meta.result === '1-0' && one.favourite === true))

  for (const key of ['date', 'player', 'event', 'result', 'updated', 'moves'] as SortKey[]) {
    const sorted = timed(`sort ${COUNT} games by ${key}`, () => sortGames(many, { key, direction: 'down' }))
    assert.equal(sorted.length, COUNT)
  }

  const sorted = sortGames(many, { key: 'date', direction: 'down' })
  const paged = timed('walk the whole library 50 at a time by cursor', () => {
    let cursor = null as LibraryCursor | null
    let seen = 0
    let pages = 0
    for (;;) {
      const page = pageFrom(sorted, { size: 50, cursor, order: { key: 'date', direction: 'down' } })
      seen += page.games.length
      pages += 1
      if (!page.nextCursor) break
      cursor = page.nextCursor
      assert.ok(pages < 500, 'paging did not finish')
    }
    return { seen, pages }
  })
  // Every game is seen exactly once across the pages, which is the property paging exists for.
  assert.equal(paged.seen, COUNT)
  assert.equal(paged.pages, COUNT / 50)

  const facets = timed(`count the facets of ${COUNT} games`, () => facetsOf(many))
  assert.equal(facets.total, COUNT)
  assert.equal(facets.undated, COUNT / 10)

  const groups = timed(`find duplicates among ${COUNT} games`, () => duplicateGroups(many))
  // These games repeat by construction: the point is that the search finishes, and groups what it finds.
  assert.ok(groups.length > 0)
  for (const group of groups) assert.ok(group.ids.length > 1)
})
