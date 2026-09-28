import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateLevels,
  BookKeeper,
  cumulative,
  gridsFor,
  imbalance,
  touchOf,
  viewFromSnapshot,
  walkBook,
  type BookDelta,
  type BookSnapshot
} from './orderbook.ts'

const ID = 'binance-futures:future:binance-futures:btcusdt'

const snapshot = (patch: Partial<BookSnapshot> = {}): BookSnapshot => ({
  instrumentId: ID,
  lastUpdateId: 100,
  bids: [
    { price: 84_500, size: 2 },
    { price: 84_499, size: 5 }
  ],
  asks: [
    { price: 84_501, size: 1 },
    { price: 84_502, size: 4 }
  ],
  timestamp: 1000,
  source: 'test',
  ...patch
})

const delta = (patch: Partial<BookDelta> = {}): BookDelta => ({
  instrumentId: ID,
  firstUpdateId: 101,
  lastUpdateId: 101,
  bids: [],
  asks: [],
  timestamp: 1100,
  ...patch
})

// ---------------------------------------------------------------- nothing before a snapshot

test('a book with no snapshot has nothing to show and says so', () => {
  const book = new BookKeeper(ID)
  assert.equal(book.needsSnapshot(), true)
  const view = book.view()
  assert.equal(view.state, 'empty')
  assert.deepEqual(view.bids, [])
})

test('updates arriving before the snapshot are held, not lost', () => {
  const book = new BookKeeper(ID)
  assert.equal(book.apply(delta({ bids: [{ price: 84_500, size: 9 }] })), false)
  assert.equal(book.view().buffered, 1)
  assert.equal(book.view().problem, 'no-snapshot')

  // The snapshot arrives, and the held update is applied on top of it.
  book.snapshot(snapshot())
  assert.equal(book.view().state, 'live')
  assert.equal(book.view().bids[0].size, 9)
  assert.equal(book.view().buffered, 0)
})

test('a held update the snapshot already includes is not applied twice', () => {
  const book = new BookKeeper(ID)
  // Update 95 is older than the snapshot's 100, so the snapshot already reflects it.
  book.apply(delta({ firstUpdateId: 95, lastUpdateId: 95, bids: [{ price: 84_500, size: 99 }] }))
  book.snapshot(snapshot())
  assert.equal(book.view().bids[0].size, 2)
})

test('the buffer is bounded, so a snapshot that never arrives cannot grow it without limit', () => {
  const book = new BookKeeper(ID, { maxPending: 3 })
  for (let i = 0; i < 10; i++) book.apply(delta({ firstUpdateId: 200 + i, lastUpdateId: 200 + i }))
  assert.equal(book.view().buffered, 3)
  assert.equal(book.view().dropped, 7)
})

// ---------------------------------------------------------------- applying updates

test('a snapshot replaces the book rather than merging into it', () => {
  const book = new BookKeeper(ID)
  book.snapshot(snapshot())
  book.snapshot(snapshot({ lastUpdateId: 200, bids: [{ price: 84_400, size: 1 }], asks: [] }))
  const view = book.view()
  // 84,500 is gone, because the venue's new statement of the whole book does not mention it.
  assert.equal(view.bids.length, 1)
  assert.equal(view.bids[0].price, 84_400)
  assert.deepEqual(view.asks, [])
})

test('a level set to zero is removed, not stored as a level with nothing at it', () => {
  const book = new BookKeeper(ID)
  book.snapshot(snapshot())
  book.apply(delta({ bids: [{ price: 84_499, size: 0 }] }))
  assert.deepEqual(
    book.view().bids.map((one) => one.price),
    [84_500]
  )
})

test('bids read highest first and asks lowest first, whatever order they arrived in', () => {
  const book = new BookKeeper(ID)
  book.snapshot(
    snapshot({
      bids: [
        { price: 84_400, size: 1 },
        { price: 84_500, size: 1 }
      ],
      asks: [
        { price: 84_600, size: 1 },
        { price: 84_501, size: 1 }
      ]
    })
  )
  const view = book.view()
  assert.deepEqual(
    view.bids.map((one) => one.price),
    [84_500, 84_400]
  )
  assert.deepEqual(
    view.asks.map((one) => one.price),
    [84_501, 84_600]
  )
})

test('an update already applied is dropped rather than applied twice', () => {
  const book = new BookKeeper(ID)
  book.snapshot(snapshot())
  assert.equal(book.apply(delta({ firstUpdateId: 101, lastUpdateId: 101, bids: [{ price: 84_500, size: 3 }] })), true)
  assert.equal(book.apply(delta({ firstUpdateId: 101, lastUpdateId: 101, bids: [{ price: 84_500, size: 7 }] })), false)
  assert.equal(book.view().bids[0].size, 3)
  assert.equal(book.view().dropped, 1)
  // A duplicate is not a break in continuity.
  assert.equal(book.view().state, 'live')
})

test('an older update cannot undo a newer one', () => {
  const book = new BookKeeper(ID)
  book.snapshot(snapshot())
  book.apply(delta({ firstUpdateId: 101, lastUpdateId: 110, bids: [{ price: 84_500, size: 3 }] }))
  assert.equal(book.apply(delta({ firstUpdateId: 105, lastUpdateId: 105, bids: [{ price: 84_500, size: 99 }] })), false)
  assert.equal(book.view().bids[0].size, 3)
})

// ---------------------------------------------------------------- the reason this file exists

test('a missed update breaks the book rather than being applied over the hole', () => {
  const book = new BookKeeper(ID)
  book.snapshot(snapshot())
  // The snapshot is current to 100; this message starts at 105, so 101–104 were missed.
  assert.equal(book.apply(delta({ firstUpdateId: 105, lastUpdateId: 106 })), false)
  const view = book.view()
  assert.equal(view.state, 'resyncing')
  assert.equal(view.problem, 'gap')
  assert.equal(view.resyncs, 1)
  // And a fresh snapshot is now needed, rather than the book carrying on as though nothing happened.
  assert.equal(book.needsSnapshot(), true)
})

test('a broken book refuses further updates until a snapshot arrives', () => {
  const book = new BookKeeper(ID)
  book.snapshot(snapshot())
  book.apply(delta({ firstUpdateId: 105, lastUpdateId: 106 }))
  assert.equal(book.apply(delta({ firstUpdateId: 107, lastUpdateId: 107, bids: [{ price: 84_500, size: 42 }] })), false)
  // Held for after the resync, not applied to a book that is out of date.
  assert.equal(book.view().bids[0].size, 2)

  book.snapshot(snapshot({ lastUpdateId: 106 }))
  assert.equal(book.view().state, 'live')
  assert.equal(book.view().bids[0].size, 42)
})

test('the first message after a snapshot may straddle it, and that is not a gap', () => {
  // Found by running this against the real stream, not by a test: the message in flight when a snapshot is taken starts
  // before the snapshot's id and ends after it, so the id it says it follows is older than the snapshot. Checking that
  // field against the snapshot rejected the one message that is always correct, and the book reported a gap within a
  // second of connecting.
  const book = new BookKeeper(ID)
  book.snapshot(snapshot({ lastUpdateId: 100 }))
  assert.equal(
    book.apply(delta({ firstUpdateId: 98, lastUpdateId: 104, previousUpdateId: 97, bids: [{ price: 84_500, size: 6 }] })),
    true
  )
  assert.equal(book.view().state, 'live')
  assert.equal(book.view().problem, null)
  assert.equal(book.view().bids[0].size, 6)
})

test('a first message that starts beyond the snapshot is still a gap', () => {
  const book = new BookKeeper(ID)
  book.snapshot(snapshot({ lastUpdateId: 100 }))
  // Begins at 105, so 101–104 were genuinely missed. The straddle allowance does not excuse this.
  assert.equal(book.apply(delta({ firstUpdateId: 105, lastUpdateId: 110, previousUpdateId: 104 })), false)
  assert.equal(book.view().problem, 'gap')
})

test('from the second message on, the venue’s stated predecessor is the check used', () => {
  const book = new BookKeeper(ID)
  book.snapshot(snapshot({ lastUpdateId: 100 }))
  // The straddling first message, accepted.
  assert.equal(book.apply(delta({ firstUpdateId: 99, lastUpdateId: 101, previousUpdateId: 98 })), true)
  // Now the check bites: this one says it follows 105, and we hold 101.
  assert.equal(book.apply(delta({ firstUpdateId: 106, lastUpdateId: 106, previousUpdateId: 105 })), false)
  assert.equal(book.view().problem, 'gap')
})

test('a message that correctly states its predecessor is applied', () => {
  const book = new BookKeeper(ID)
  book.snapshot(snapshot())
  assert.equal(
    book.apply(delta({ firstUpdateId: 101, lastUpdateId: 105, previousUpdateId: 100, bids: [{ price: 84_500, size: 8 }] })),
    true
  )
  assert.equal(book.view().bids[0].size, 8)
  assert.equal(book.view().lastUpdateId, 105)
})

test('a crossed book is treated as broken, whatever the sequence numbers said', () => {
  const book = new BookKeeper(ID)
  book.snapshot(snapshot())
  // Perfectly contiguous, and it puts a bid above the best ask. That cannot be a book.
  assert.equal(book.apply(delta({ firstUpdateId: 101, lastUpdateId: 101, bids: [{ price: 84_600, size: 1 }] })), false)
  assert.equal(book.view().state, 'resyncing')
  assert.equal(book.view().problem, 'crossed')
})

test('a venue with no sequence numbers is still followed, without false gap reports', () => {
  const book = new BookKeeper(ID)
  book.snapshot(snapshot({ lastUpdateId: null }))
  assert.equal(book.apply(delta({ firstUpdateId: null, lastUpdateId: null, bids: [{ price: 84_500, size: 6 }] })), true)
  assert.equal(book.view().state, 'live')
  assert.equal(book.view().problem, null)
  assert.equal(book.view().bids[0].size, 6)
})

test('a dropped stream needs a snapshot, because what happened while it was down is unknown', () => {
  const book = new BookKeeper(ID)
  book.snapshot(snapshot())
  book.disconnected()
  assert.equal(book.needsSnapshot(), true)
  assert.equal(book.view().state, 'resyncing')
})

test('an update for another instrument is ignored entirely', () => {
  const book = new BookKeeper(ID)
  book.snapshot(snapshot())
  assert.equal(book.apply(delta({ instrumentId: 'something:else:1:2', bids: [{ price: 1, size: 1 }] })), false)
  assert.equal(book.view().bids.length, 2)
})

test('a malformed level is refused rather than stored', () => {
  const book = new BookKeeper(ID)
  book.snapshot(snapshot())
  book.apply(
    delta({
      bids: [
        { price: Number.NaN, size: 1 },
        { price: 84_498, size: Number.POSITIVE_INFINITY },
        { price: -5, size: 1 }
      ]
    })
  )
  assert.equal(book.view().bids.length, 2)
  for (const level of book.view().bids) {
    assert.ok(Number.isFinite(level.price) && Number.isFinite(level.size))
  }
})

test('a depth limit shows the top of the book without discarding the rest', () => {
  const book = new BookKeeper(ID)
  book.snapshot(
    snapshot({
      bids: [
        { price: 84_500, size: 1 },
        { price: 84_499, size: 1 },
        { price: 84_498, size: 1 }
      ]
    })
  )
  assert.equal(book.view(2).bids.length, 2)
  assert.equal(book.view().bids.length, 3)
})

// ---------------------------------------------------------------- the touch

test('the touch is the best of each side, with the gap and the middle', () => {
  const touch = touchOf({ bids: [{ price: 84_500, size: 2 }], asks: [{ price: 84_502, size: 1 }] })
  assert.equal(touch.bid, 84_500)
  assert.equal(touch.ask, 84_502)
  assert.equal(touch.spread, 2)
  assert.equal(touch.mid, 84_501)
  assert.ok(touch.spreadFraction !== null && touch.spreadFraction > 0)
})

test('one side alone has no mid and no spread, rather than the other side used as a stand-in', () => {
  const onlyBids = touchOf({ bids: [{ price: 84_500, size: 2 }], asks: [] })
  assert.equal(onlyBids.bid, 84_500)
  assert.equal(onlyBids.ask, null)
  assert.equal(onlyBids.mid, null)
  assert.equal(onlyBids.spread, null)
})

test('a crossed book yields no spread, rather than a negative one shown as a figure', () => {
  const crossed = touchOf({ bids: [{ price: 84_600, size: 1 }], asks: [{ price: 84_500, size: 1 }] })
  assert.equal(crossed.spread, null)
  assert.equal(crossed.mid, null)
})

// ---------------------------------------------------------------- cumulative depth

test('depth accumulates outward from the best price', () => {
  const levels = cumulative(
    [
      { price: 84_500, size: 1 },
      { price: 84_499, size: 2 },
      { price: 84_498, size: 3 }
    ],
    84_501
  )
  assert.deepEqual(
    levels.map((one) => one.cumulativeSize),
    [1, 3, 6]
  )
  assert.equal(Math.round(levels[0].cumulativeNotional), 84_500)
  // Distance from the mid, as a fraction, so it is comparable across markets.
  assert.ok(levels[2].distance !== null && levels[2].distance > 0)
})

test('with no mid there is no distance, and the totals still add up', () => {
  const levels = cumulative([{ price: 100, size: 2 }], null)
  assert.equal(levels[0].distance, null)
  assert.equal(levels[0].cumulativeNotional, 200)
})

// ---------------------------------------------------------------- aggregation

test('bids round down and asks round up, so a bucket never claims a better price than its orders', () => {
  const bids = aggregateLevels(
    [
      { price: 84_509, size: 1 },
      { price: 84_501, size: 2 }
    ],
    10,
    'bid'
  )
  assert.equal(bids.length, 1)
  assert.equal(bids[0].price, 84_500)
  assert.equal(bids[0].size, 3)
  assert.equal(bids[0].count, 2)

  const asks = aggregateLevels(
    [
      { price: 84_501, size: 1 },
      { price: 84_509, size: 2 }
    ],
    10,
    'ask'
  )
  assert.equal(asks.length, 1)
  assert.equal(asks[0].price, 84_510)
})

test('aggregation does not split one price across two buckets', () => {
  const levels = aggregateLevels(
    [
      { price: 0.3, size: 1 },
      { price: 0.34, size: 1 }
    ],
    0.1,
    'bid'
  )
  assert.equal(levels.length, 1)
  assert.equal(levels[0].count, 2)
})

test('an invalid grid aggregates nothing rather than into one enormous level', () => {
  assert.deepEqual(aggregateLevels([{ price: 1, size: 1 }], 0, 'bid'), [])
})

// ---------------------------------------------------------------- imbalance

test('imbalance counts only what is within range of the mid', () => {
  const result = imbalance(
    {
      bids: [
        { price: 84_500, size: 1 },
        // Far below: outside a 0.1% band and not counted.
        { price: 80_000, size: 100 }
      ],
      asks: [{ price: 84_502, size: 1 }]
    },
    0.001
  )
  assert.equal(Math.round(result.bidNotional), 84_500)
  assert.equal(Math.round(result.askNotional), 84_502)
  assert.ok(result.ratio !== null && result.ratio > 0.99 && result.ratio < 1.01)
})

test('nothing on one side means no ratio, because a ratio against nothing measures nothing', () => {
  const result = imbalance({ bids: [{ price: 100, size: 1 }], asks: [] }, 0.01)
  assert.equal(result.ratio, null)
  assert.equal(result.bidShare, null)
})

// ---------------------------------------------------------------- walking the book

test('walking the book gives the average price the resting orders would actually give', () => {
  const result = walkBook(
    [
      { price: 100, size: 1 },
      { price: 101, size: 1 }
    ],
    2
  )
  assert.equal(result?.averagePrice, 100.5)
  assert.equal(result?.filled, 2)
  assert.ok(result?.slippageFraction !== null && (result?.slippageFraction ?? 0) > 0)
})

test('a size the book cannot fill is refused, not answered from a partial fill', () => {
  // The bug this prevents: averaging over 1 unit and presenting it as the cost of 10.
  assert.equal(walkBook([{ price: 100, size: 1 }], 10), null)
  assert.equal(walkBook([], 1), null)
  assert.equal(walkBook([{ price: 100, size: 1 }], 0), null)
})

// ---------------------------------------------------------------- grids and snapshots

test('price grids suit the market they came from', () => {
  const bitcoin = gridsFor(84_500)
  assert.ok(bitcoin.includes(100))
  const token = gridsFor(0.000012)
  assert.ok(token.every((one) => one < 0.001))
  // No price, no grids -- rather than grids that would put the whole book in one bucket.
  assert.deepEqual(gridsFor(null), [])
  assert.deepEqual(gridsFor(0), [])
})

test('a polled snapshot is a complete book, sorted, with nothing claimed about continuity', () => {
  const view = viewFromSnapshot({
    instrumentId: ID,
    bids: [
      { price: 84_400, size: 1 },
      { price: 84_500, size: 1 }
    ],
    asks: [{ price: 84_501, size: 1 }],
    timestamp: 5000,
    source: 'binance'
  })
  assert.equal(view.state, 'live')
  assert.equal(view.bids[0].price, 84_500)
  assert.equal(view.lastUpdateId, null)
  assert.equal(view.resyncs, 0)
})
