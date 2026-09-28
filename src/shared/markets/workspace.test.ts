import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_COLUMNS,
  allWatched,
  cleanInstrument,
  cleanTicker,
  cleanTickerGroup,
  cleanWatchlist,
  cleanWorkspace,
  DEFAULT_COLUMNS,
  DEFAULT_TICKER,
  EMPTY_WORKSPACE,
  TICKER_FIELDS,
  TICKER_HEIGHTS,
  tickerInstrumentIds
} from './workspace.ts'

/**
 * What somebody has set up.
 *
 * Almost every test here is about reading a file that is wrong in some way, because a configuration file is the easiest
 * thing to get into an application and nothing in one can be trusted. The rule throughout: an unrecognised value is
 * dropped or clamped, never half-accepted, and never allowed to produce a shape the rest of the code did not expect.
 */

const instrument = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  instrumentId: 'binance:crypto:binance:btcusdt',
  symbol: 'BTCUSDT',
  name: 'BTC / USDT',
  assetType: 'crypto',
  exchange: 'binance',
  currency: 'USDT',
  provider: 'binance',
  ...over
})

// ---------------------------------------------------------------- instruments

test('an instrument survives a round trip', () => {
  const read = cleanInstrument(instrument())
  assert.equal(read?.instrumentId, 'binance:crypto:binance:btcusdt')
  assert.equal(read?.symbol, 'BTCUSDT')
  assert.equal(read?.assetType, 'crypto')
  assert.equal(read?.currency, 'USDT')
})

test('an instrument without what makes it one is refused', () => {
  assert.equal(cleanInstrument(null), null)
  assert.equal(cleanInstrument({}), null)
  assert.equal(cleanInstrument(instrument({ instrumentId: '' })), null)
  assert.equal(cleanInstrument(instrument({ symbol: '' })), null)
  assert.equal(cleanInstrument(instrument({ provider: '' })), null)
})

test('an unknown asset type falls back to the patient one, not the impatient one', () => {
  // The asset type decides when a price is called stale. Falling back to crypto's one minute would mark a stock stale
  // at lunchtime; falling back to a stock's ten minutes at worst shows a crypto price as fresh slightly too long.
  assert.equal(cleanInstrument(instrument({ assetType: 'magic-beans' }))?.assetType, 'stock')
})

// ---------------------------------------------------------------- watchlists

test('a watchlist keeps its items and de-duplicates them', () => {
  const list = cleanWatchlist({
    id: 'w1',
    name: 'My crypto',
    items: [{ instrument: instrument() }, { instrument: instrument() }, { instrument: instrument({ instrumentId: 'a:b:c:d', symbol: 'ETH' }) }]
  })
  assert.equal(list?.items.length, 2)
  assert.equal(list?.name, 'My crypto')
})

test('a watchlist item that is not an instrument is dropped without taking the list with it', () => {
  const list = cleanWatchlist({ id: 'w1', items: [null, 'nope', { instrument: {} }, { instrument: instrument() }] })
  assert.equal(list?.items.length, 1)
})

test('a watchlist with no id is not a watchlist', () => {
  assert.equal(cleanWatchlist({ name: 'nameless' }), null)
  assert.equal(cleanWatchlist(null), null)
})

test('an unnamed watchlist still has a name to show', () => {
  assert.equal(cleanWatchlist({ id: 'w1' })?.name, 'Watchlist')
})

test('an unknown column is dropped, and no columns at all means the usual ones', () => {
  const odd = cleanWatchlist({ id: 'w1', columns: ['symbol', 'tea-leaves', 'price'] })
  assert.deepEqual(odd?.columns, ['symbol', 'price'])
  assert.deepEqual(cleanWatchlist({ id: 'w1' })?.columns, DEFAULT_COLUMNS)
  assert.deepEqual(cleanWatchlist({ id: 'w1', columns: ['nonsense'] })?.columns, DEFAULT_COLUMNS)
})

test('sorting by a column that does not exist sorts by symbol instead', () => {
  assert.equal(cleanWatchlist({ id: 'w1', sortBy: 'vibes' })?.sortBy, 'symbol')
  assert.equal(cleanWatchlist({ id: 'w1', sortBy: 'volume' })?.sortBy, 'volume')
})

test('every default column is a real column', () => {
  for (const column of DEFAULT_COLUMNS) {
    assert.ok(ALL_COLUMNS.includes(column), `${column} is not a column`)
  }
})

// ---------------------------------------------------------------- the ticker

test('the ticker is off until somebody asks', () => {
  // A market strip nobody wanted is a permanent band across the bottom of their browser.
  assert.equal(DEFAULT_TICKER.enabled, false)
  assert.equal(cleanTicker(undefined).enabled, false)
})

test('a speed outside what can be read is clamped', () => {
  assert.equal(cleanTicker({ speed: 100000 }).speed, 400)
  assert.equal(cleanTicker({ speed: 0 }).speed, 5)
  assert.equal(cleanTicker({ speed: 'fast' }).speed, DEFAULT_TICKER.speed)
})

test('an active group that no longer exists falls back to one that does', () => {
  const ticker = cleanTicker({
    enabled: true,
    activeGroupId: 'gone',
    groups: [{ id: 'g1', name: 'Crypto', instrumentIds: ['a:b:c:d'] }]
  })
  assert.equal(ticker.activeGroupId, 'g1')
})

test('with no groups at all there is no active group, rather than a dangling one', () => {
  assert.equal(cleanTicker({ enabled: true, activeGroupId: 'gone', groups: [] }).activeGroupId, '')
})

test('a group de-duplicates its instruments', () => {
  const group = cleanTickerGroup({ id: 'g1', instrumentIds: ['a', 'a', 'b'] })
  assert.deepEqual(group?.instrumentIds, ['a', 'b'])
})

test('an unknown ticker field is dropped, and none at all means the usual ones', () => {
  assert.deepEqual(cleanTicker({ fields: ['price', 'astrology'] }).fields, ['price'])
  assert.deepEqual(cleanTicker({ fields: [] }).fields, DEFAULT_TICKER.fields)
  for (const field of DEFAULT_TICKER.fields) {
    assert.ok(TICKER_FIELDS.includes(field))
  }
})

test('every size has a height, so the strip always knows how tall to be', () => {
  for (const size of ['compact', 'normal', 'expanded'] as const) {
    assert.ok(TICKER_HEIGHTS[size] > 0)
  }
  assert.ok(TICKER_HEIGHTS.compact < TICKER_HEIGHTS.normal)
  assert.ok(TICKER_HEIGHTS.normal < TICKER_HEIGHTS.expanded)
})

test('an unknown size is the smallest one', () => {
  assert.equal(cleanTicker({ size: 'enormous' }).size, 'compact')
})

test('which instruments the ticker shows is its active group, and nothing when it is off', () => {
  const ticker = cleanTicker({
    enabled: true,
    activeGroupId: 'g2',
    groups: [
      { id: 'g1', name: 'A', instrumentIds: ['a'] },
      { id: 'g2', name: 'B', instrumentIds: ['b', 'c'] }
    ]
  })
  assert.deepEqual(tickerInstrumentIds(ticker), ['b', 'c'])
  assert.deepEqual(tickerInstrumentIds({ ...ticker, enabled: false }), [])
})

// ---------------------------------------------------------------- the whole thing

test('a workspace read from nothing is an empty one, not a throw', () => {
  for (const nonsense of [null, undefined, 42, 'workspace', []]) {
    const read = cleanWorkspace(nonsense, 5)
    assert.deepEqual(read.watchlists, [])
    assert.deepEqual(read.alerts, [])
    assert.equal(read.ticker.enabled, false)
    assert.equal(read.updatedAt, 5)
  }
})

test('a workspace keeps what it can and drops what it cannot', () => {
  const read = cleanWorkspace({
    version: 1,
    watchlists: [{ id: 'w1', items: [{ instrument: instrument() }] }, null, { noId: true }],
    ticker: { enabled: true, groups: [{ id: 'g1', instrumentIds: ['binance:crypto:binance:btcusdt'] }] },
    alerts: [
      { id: 'a1', instrumentId: 'binance:crypto:binance:btcusdt', comparison: 'above', value: 100000 },
      { nonsense: true }
    ],
    known: [instrument(), 'nope']
  })
  assert.equal(read.watchlists.length, 1)
  assert.equal(read.ticker.groups.length, 1)
  assert.equal(read.alerts.length, 1)
  assert.equal(read.known.length, 1)
})

test('duplicate ids are kept once, first one wins', () => {
  const read = cleanWorkspace({
    watchlists: [
      { id: 'w1', name: 'First' },
      { id: 'w1', name: 'Second' }
    ]
  })
  assert.equal(read.watchlists.length, 1)
  assert.equal(read.watchlists[0].name, 'First')
})

test('everything being watched is the ticker, the lists and the live alerts together', () => {
  const workspace = cleanWorkspace({
    watchlists: [{ id: 'w1', items: [{ instrument: instrument({ instrumentId: 'p:crypto:e:one', symbol: 'ONE' }) }] }],
    ticker: { enabled: true, groups: [{ id: 'g1', instrumentIds: ['p:crypto:e:two'] }] },
    alerts: [
      { id: 'a1', instrumentId: 'p:crypto:e:three', comparison: 'above', value: 1 },
      { id: 'a2', instrumentId: 'p:crypto:e:four', comparison: 'above', value: 1, enabled: false }
    ]
  })
  const watched = allWatched(workspace).sort()
  assert.deepEqual(watched, ['p:crypto:e:one', 'p:crypto:e:three', 'p:crypto:e:two'])
  // A switched-off alert is not a reason to hold a subscription.
  assert.ok(!watched.includes('p:crypto:e:four'))
})

test('the same instrument in two places is watched once', () => {
  const workspace = cleanWorkspace({
    watchlists: [{ id: 'w1', items: [{ instrument: instrument() }] }],
    ticker: { enabled: true, groups: [{ id: 'g1', instrumentIds: ['binance:crypto:binance:btcusdt'] }] }
  })
  assert.deepEqual(allWatched(workspace), ['binance:crypto:binance:btcusdt'])
})

test('a ticker that is off is not a reason to subscribe to its group', () => {
  const workspace = cleanWorkspace({
    ticker: { enabled: false, groups: [{ id: 'g1', instrumentIds: ['a:b:c:d'] }] }
  })
  assert.deepEqual(allWatched(workspace), [])
})

test('an empty workspace watches nothing', () => {
  assert.deepEqual(allWatched(EMPTY_WORKSPACE), [])
})

// ---------------------------------------------------------------- the master switch

test('Markets off is a reason to watch nothing, whatever the lists still say', () => {
  const workspace = cleanWorkspace({
    enabled: false,
    watchlists: [{ id: 'w1', items: [{ instrument: instrument() }] }],
    ticker: { enabled: true, groups: [{ id: 'g1', instrumentIds: ['a:b:c:d'] }] },
    alerts: [{ id: 'a1', instrumentId: 'a:b:c:e', comparison: 'above', value: 1 }]
  })
  // Anything else would leave a socket open for a feature the person switched off.
  assert.deepEqual(allWatched(workspace), [])
})

test('switching Markets off keeps every choice', () => {
  const workspace = cleanWorkspace({
    enabled: false,
    watchlists: [{ id: 'w1', name: 'Core', items: [{ instrument: instrument() }] }],
    ticker: { enabled: true, groups: [{ id: 'g1', name: 'Main', instrumentIds: ['a:b:c:d'] }] },
    alerts: [{ id: 'a1', instrumentId: 'a:b:c:e', comparison: 'above', value: 1 }]
  })
  // A switch that quietly discarded them would be a reset wearing a switch's label.
  assert.equal(workspace.enabled, false)
  assert.equal(workspace.watchlists.length, 1)
  assert.equal(workspace.watchlists[0].items.length, 1)
  assert.equal(workspace.ticker.groups.length, 1)
  assert.equal(workspace.ticker.enabled, true)
  assert.equal(workspace.alerts.length, 1)
})

test('a file written before the switch existed reads as Markets working', () => {
  // The honest reading of a missing setting is the behaviour the file already had.
  assert.equal(cleanWorkspace({ watchlists: [] }).enabled, true)
  assert.equal(cleanWorkspace({ enabled: 'yes' }).enabled, true)
  assert.equal(cleanWorkspace({ enabled: false }).enabled, false)
})
