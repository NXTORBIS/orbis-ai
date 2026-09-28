import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ASSUMPTIONS,
  cancel,
  DEFAULT_SETTINGS,
  isFlat,
  newAccount,
  onQuote,
  place,
  valueOf,
  type PaperAccount,
  type PaperOrder,
  type PaperSettings
} from './paper.ts'
import type { QuoteView } from './instrument.ts'

/**
 * Paper trading.
 *
 * Determinism is the property being tested: the same orders against the same prices must always produce the same account,
 * because a paper record that answered differently on Tuesday teaches nobody anything.
 *
 * The rest is about the simulation not flattering the trader. Filling a limit better than asked, ignoring fees, or
 * treating a missing price as the purchase price would each make every strategy look better than it is, and each is easy
 * to do by accident.
 */

const ID = 'binance:crypto:binance:btcusdt'

const quote = (over: Partial<QuoteView> = {}): QuoteView => ({
  instrumentId: ID,
  last: 100,
  previousClose: 100,
  change: 0,
  changePercent: 0,
  bid: 99.5,
  ask: 100.5,
  volume: null,
  dayHigh: null,
  dayLow: null,
  timestamp: 1_000_000,
  delayedByMs: 0,
  marketStatus: 'always-open',
  source: 'Fake',
  freshness: 'real-time',
  ageMs: 0,
  ...over
})

const order = (over: Partial<PaperOrder> & { placedAt?: number } = {}): Omit<PaperOrder, 'state' | 'placedAt'> & { placedAt: number } => ({
  id: 'o1',
  instrumentId: ID,
  side: 'buy',
  type: 'market',
  quantity: 1,
  placedAt: 1,
  ...over
})

const clean: PaperSettings = { slippage: 0, feeRate: 0, allowShort: false }

// ---------------------------------------------------------------- the assumptions are stated

test('the simulation says what it assumed', () => {
  // A paper result is only useful with its assumptions, so they are part of the module rather than a comment somewhere.
  assert.ok(ASSUMPTIONS.length >= 5)
  assert.ok(ASSUMPTIONS.some((a) => /slippage/i.test(a)))
  assert.ok(ASSUMPTIONS.some((a) => /never better/i.test(a)))
  assert.ok(ASSUMPTIONS.some((a) => /fees/i.test(a)))
  assert.ok(ASSUMPTIONS.some((a) => /depth/i.test(a)))
})

test('slippage is not zero by default, because a strategy that needs perfect fills does not work', () => {
  assert.ok(DEFAULT_SETTINGS.slippage > 0)
  assert.ok(DEFAULT_SETTINGS.feeRate > 0)
  // And shorting is off, because a simulation that allows it silently teaches the wrong lesson.
  assert.equal(DEFAULT_SETTINGS.allowShort, false)
})

// ---------------------------------------------------------------- market orders

test('a buyer pays the ask, not the mid and not the last trade', () => {
  const outcome = place(newAccount(1000), order(), quote(), clean)
  assert.equal(outcome.order.state, 'filled')
  assert.equal(outcome.order.filledPrice, 100.5)
  assert.equal(outcome.account.cash, 1000 - 100.5)
})

test('a seller receives the bid', () => {
  let account = place(newAccount(1000), order(), quote(), clean).account
  account = place(account, order({ id: 'o2', side: 'sell' }), quote(), clean).account
  const sell = account.orders.find((o) => o.id === 'o2')
  assert.equal(sell?.filledPrice, 99.5)
})

test('slippage goes against the trader, both ways', () => {
  const settings: PaperSettings = { slippage: 0.01, feeRate: 0, allowShort: false }
  const bought = place(newAccount(1000), order(), quote(), settings)
  // The ask, plus one per cent.
  assert.equal(bought.order.filledPrice, 100.5 * 1.01)
  const sold = place(bought.account, order({ id: 'o2', side: 'sell' }), quote(), settings)
  assert.equal(sold.order.filledPrice, 99.5 * 0.99)
})

test('fees are charged on both sides and come out of cash', () => {
  const settings: PaperSettings = { slippage: 0, feeRate: 0.01, allowShort: false }
  const bought = place(newAccount(1000), order(), quote(), settings)
  assert.equal(bought.order.fee, 100.5 * 0.01)
  assert.equal(bought.account.cash, 1000 - 100.5 - 100.5 * 0.01)
  const sold = place(bought.account, order({ id: 'o2', side: 'sell' }), quote(), settings)
  assert.ok((sold.order.fee as number) > 0, 'the sell was charged too')
})

test('a feed with no book falls back to the last trade, which is what slippage is for', () => {
  const outcome = place(newAccount(1000), order(), quote({ bid: null, ask: null, last: 100 }), clean)
  assert.equal(outcome.order.filledPrice, 100)
})

// ---------------------------------------------------------------- refusals

test('an order that cannot be afforded is refused, not turned into negative cash', () => {
  const outcome = place(newAccount(50), order({ quantity: 1 }), quote(), clean)
  assert.equal(outcome.order.state, 'rejected')
  assert.match(outcome.detail, /needs 100.50 and there is 50.00/)
  assert.equal(outcome.account.cash, 50, 'the cash did not move')
})

test('a quantity that is not one is refused', () => {
  for (const quantity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const outcome = place(newAccount(1000), order({ quantity }), quote(), clean)
    assert.equal(outcome.order.state, 'rejected', `${quantity} was accepted`)
  }
})

test('selling what is not held is refused while shorting is off, and says how much is held', () => {
  const empty = place(newAccount(1000), order({ side: 'sell' }), quote(), clean)
  assert.equal(empty.order.state, 'rejected')
  assert.match(empty.detail, /nothing to sell/)

  const bought = place(newAccount(1000), order({ quantity: 1 }), quote(), clean).account
  const tooMany = place(bought, order({ id: 'o2', side: 'sell', quantity: 5 }), quote(), clean)
  assert.equal(tooMany.order.state, 'rejected')
  assert.match(tooMany.detail, /Only 1 held/)
})

test('shorting works when it is switched on', () => {
  const settings: PaperSettings = { slippage: 0, feeRate: 0, allowShort: true }
  const outcome = place(newAccount(1000), order({ side: 'sell' }), quote(), settings)
  assert.equal(outcome.order.state, 'filled')
  assert.equal(outcome.account.positions[0].quantity, -1)
  assert.equal(outcome.account.cash, 1000 + 99.5, 'a short receives the proceeds')
})

test('an order with no price to fill against is refused rather than guessed at', () => {
  const outcome = place(newAccount(1000), order(), quote({ last: null, bid: null, ask: null }), clean)
  assert.equal(outcome.order.state, 'rejected')
  assert.match(outcome.detail, /no price/)
})

test('a limit order without a limit, or a stop without a stop, is refused', () => {
  assert.equal(place(newAccount(1000), order({ type: 'limit' }), quote(), clean).order.state, 'rejected')
  assert.equal(place(newAccount(1000), order({ type: 'stop' }), quote(), clean).order.state, 'rejected')
})

// ---------------------------------------------------------------- waiting orders

test('a limit order waits, and fills at the limit rather than better', () => {
  // Filling better than asked would flatter every strategy that used a limit.
  const placed = place(newAccount(1000), order({ type: 'limit', limitPrice: 90 }), quote(), clean)
  assert.equal(placed.order.state, 'pending')

  // The price falls well past the limit: it still fills at 90.
  const { account, fills } = onQuote(placed.account, quote({ last: 80, bid: 79.5, ask: 80.5 }), 2, clean)
  assert.equal(fills.length, 1)
  assert.equal(fills[0].price, 90)
  assert.equal(account.orders[0].state, 'filled')
})

test('a limit order that is not reached stays waiting', () => {
  const placed = place(newAccount(1000), order({ type: 'limit', limitPrice: 90 }), quote(), clean)
  const { account, fills } = onQuote(placed.account, quote({ last: 95 }), 2, clean)
  assert.deepEqual(fills, [])
  assert.equal(account.orders[0].state, 'pending')
})

test('a sell limit fills when the price rises to it', () => {
  let account = place(newAccount(1000), order(), quote(), clean).account
  account = place(account, order({ id: 'o2', side: 'sell', type: 'limit', limitPrice: 120 }), quote(), clean).account
  const low = onQuote(account, quote({ last: 110 }), 2, clean)
  assert.deepEqual(low.fills, [])
  const high = onQuote(account, quote({ last: 130, bid: 129.5, ask: 130.5 }), 3, clean)
  assert.equal(high.fills[0].price, 120)
})

test('a stop triggers when the price moves against the position', () => {
  let account = place(newAccount(1000), order(), quote(), clean).account
  // A protective stop below the entry.
  account = place(account, order({ id: 'o2', side: 'sell', type: 'stop', stopPrice: 90 }), quote(), clean).account
  assert.deepEqual(onQuote(account, quote({ last: 95 }), 2, clean).fills, [])
  const stopped = onQuote(account, quote({ last: 89, bid: 88.5, ask: 89.5 }), 3, clean)
  assert.equal(stopped.fills.length, 1)
  assert.equal(stopped.fills[0].price, 88.5, 'a stop becomes a market order and takes the bid')
})

test('a stop-limit needs both its conditions', () => {
  let account = place(newAccount(1000), order(), quote(), clean).account
  account = place(
    account,
    order({ id: 'o2', side: 'sell', type: 'stop-limit', stopPrice: 90, limitPrice: 88 }),
    quote(),
    clean
  ).account
  // Triggered but below the limit: no fill.
  assert.deepEqual(onQuote(account, quote({ last: 85, bid: 84.5, ask: 85.5 }), 2, clean).fills, [])
  // Triggered and within the limit.
  const filled = onQuote(account, quote({ last: 89, bid: 88.5, ask: 89.5 }), 3, clean)
  assert.equal(filled.fills.length, 1)
})

test('an order on a closed market waits until it opens', () => {
  const placed = place(newAccount(1000), order(), quote({ marketStatus: 'closed' }), clean)
  assert.equal(placed.order.state, 'pending')
  assert.match(placed.detail, /closed/)
  assert.deepEqual(onQuote(placed.account, quote({ marketStatus: 'closed' }), 2, clean).fills, [])
  const opened = onQuote(placed.account, quote({ marketStatus: 'open' }), 3, clean)
  assert.equal(opened.fills.length, 1)
})

test('a cancelled order does not fill', () => {
  const placed = place(newAccount(1000), order({ type: 'limit', limitPrice: 90 }), quote(), clean)
  const cancelled = cancel(placed.account, 'o1')
  assert.equal(cancelled.orders[0].state, 'cancelled')
  assert.deepEqual(onQuote(cancelled, quote({ last: 80 }), 2, clean).fills, [])
})

test('cancelling an order that has already filled does nothing to it', () => {
  const filled = place(newAccount(1000), order(), quote(), clean).account
  assert.equal(cancel(filled, 'o1').orders[0].state, 'filled')
})

// ---------------------------------------------------------------- positions

test('buying twice averages the price', () => {
  let account = place(newAccount(10000), order({ quantity: 1 }), quote({ ask: 100 }), clean).account
  account = place(account, order({ id: 'o2', quantity: 1 }), quote({ ask: 200 }), clean).account
  const position = account.positions[0]
  assert.equal(position.quantity, 2)
  assert.equal(position.averagePrice, 150)
})

test('selling part of a position realises part of the profit and keeps the average', () => {
  let account = place(newAccount(10000), order({ quantity: 4 }), quote({ ask: 100 }), clean).account
  const sold = place(account, order({ id: 'o2', side: 'sell', quantity: 2 }), quote({ bid: 150 }), clean)
  account = sold.account
  // Two units at 50 above the average.
  assert.equal(account.fills[1].realised, 100)
  assert.equal(account.positions[0].quantity, 2)
  assert.equal(account.positions[0].averagePrice, 100, 'the average of what is left is unchanged')
})

test('closing a position entirely removes it', () => {
  let account = place(newAccount(10000), order({ quantity: 2 }), quote({ ask: 100 }), clean).account
  account = place(account, order({ id: 'o2', side: 'sell', quantity: 2 }), quote({ bid: 120 }), clean).account
  assert.deepEqual(account.positions, [])
  assert.equal(account.fills[1].realised, 40)
})

test('a loss is realised as a loss', () => {
  let account = place(newAccount(10000), order({ quantity: 1 }), quote({ ask: 100 }), clean).account
  account = place(account, order({ id: 'o2', side: 'sell', quantity: 1 }), quote({ bid: 80 }), clean).account
  assert.equal(account.fills[1].realised, -20)
})

test('a short that is bought back realises the right way round', () => {
  const settings: PaperSettings = { slippage: 0, feeRate: 0, allowShort: true }
  let account = place(newAccount(10000), order({ side: 'sell', quantity: 1 }), quote({ bid: 100 }), settings).account
  account = place(account, order({ id: 'o2', side: 'buy', quantity: 1 }), quote({ ask: 80 }), settings).account
  // Sold at 100, bought back at 80: a profit of 20.
  assert.equal(account.fills[1].realised, 20)
  assert.deepEqual(account.positions, [])
})

// ---------------------------------------------------------------- what it is worth

test('the account value is cash plus what the positions are worth', () => {
  const account = place(newAccount(10000), order({ quantity: 2 }), quote({ ask: 100 }), clean).account
  const value = valueOf(account, new Map([[ID, 150]]))
  assert.equal(value.cash, 10000 - 200)
  assert.equal(value.positionsValue, 300)
  assert.equal(value.total, 10100)
  assert.equal(value.unrealised, 100)
  assert.ok(Math.abs(value.returnPercent - 1) < 1e-9)
})

test('an instrument with no price is listed rather than valued at zero or at cost', () => {
  // Valuing it at cost would give a portfolio that never moves; at zero, a loss that never happened.
  const account = place(newAccount(10000), order({ quantity: 2 }), quote({ ask: 100 }), clean).account
  const value = valueOf(account, new Map([[ID, null]]))
  assert.deepEqual(value.missingPrices, [ID])
  assert.equal(value.positionsValue, 0)
  assert.equal(value.total, value.cash, 'the total covers only what is known')
})

test('realised profit and fees are counted over the whole life of the account', () => {
  const settings: PaperSettings = { slippage: 0, feeRate: 0.01, allowShort: false }
  let account = place(newAccount(10000), order({ quantity: 1 }), quote({ ask: 100 }), settings).account
  account = place(account, order({ id: 'o2', side: 'sell', quantity: 1 }), quote({ bid: 120 }), settings).account
  const value = valueOf(account, new Map())
  assert.equal(value.realised, 20)
  assert.ok(value.fees > 0)
})

// ---------------------------------------------------------------- determinism

test('the same orders against the same prices give the same account, every time', () => {
  // The property that makes a paper record worth reviewing.
  const run = (): PaperAccount => {
    let account = newAccount(10000)
    account = place(account, order({ id: 'a', quantity: 3 }), quote({ ask: 100 }), DEFAULT_SETTINGS).account
    account = place(account, order({ id: 'b', type: 'limit', limitPrice: 90, quantity: 2 }), quote(), DEFAULT_SETTINGS).account
    account = onQuote(account, quote({ last: 85, bid: 84.5, ask: 85.5 }), 5, DEFAULT_SETTINGS).account
    account = place(account, order({ id: 'c', side: 'sell', quantity: 4 }), quote({ bid: 130 }), DEFAULT_SETTINGS).account
    return account
  }
  assert.deepEqual(run(), run())
})

test('waiting orders are filled oldest first, so the result does not depend on chance', () => {
  let account = newAccount(10000)
  account = place(account, order({ id: 'first', type: 'limit', limitPrice: 95, quantity: 1, placedAt: 1 }), quote(), clean).account
  account = place(account, order({ id: 'second', type: 'limit', limitPrice: 95, quantity: 1, placedAt: 2 }), quote(), clean).account
  const { fills } = onQuote(account, quote({ last: 90, bid: 89.5, ask: 90.5 }), 3, clean)
  assert.deepEqual(
    fills.map((f) => f.orderId),
    ['first', 'second']
  )
})

test('a quote for a different instrument fills nothing', () => {
  const placed = place(newAccount(1000), order({ type: 'limit', limitPrice: 90 }), quote(), clean)
  const other = onQuote(placed.account, quote({ instrumentId: 'binance:crypto:binance:ethusdt', last: 10 }), 2, clean)
  assert.deepEqual(other.fills, [])
})

// ---------------------------------------------------------------- rounding

test('selling everything closes the position, even when the arithmetic does not land on zero', () => {
  // 0.05 + 0.001 is 0.051000000000000004 in binary, so selling 0.051 once left a position of about 4e-18 units. It was
  // drawn in the holdings table, priced, counted in exposure, and then refused a later sale on the grounds that only
  // 4e-18 was held.
  let account = newAccount(10_000)
  const settings = { slippage: 0, feeRate: 0, allowShort: false }
  account = place(account, order({ side: 'buy', quantity: 0.05 }), quote({ last: 100, ask: 100, bid: 100 }), settings).account
  account = place(account, order({ side: 'buy', quantity: 0.001 }), quote({ last: 100, ask: 100, bid: 100 }), settings).account
  assert.equal(account.positions.length, 1)

  account = place(account, order({ side: 'sell', quantity: 0.051 }), quote({ last: 100, ask: 100, bid: 100 }), settings).account
  assert.deepEqual(account.positions, [])
})

test('a real remainder is still a position', () => {
  // The tolerance must not swallow something somebody actually holds.
  let account = newAccount(10_000)
  const settings = { slippage: 0, feeRate: 0, allowShort: false }
  account = place(account, order({ side: 'buy', quantity: 2 }), quote({ last: 100, ask: 100, bid: 100 }), settings).account
  account = place(account, order({ side: 'sell', quantity: 1.9999 }), quote({ last: 100, ask: 100, bid: 100 }), settings).account
  assert.equal(account.positions.length, 1)
  assert.ok(Math.abs(account.positions[0].quantity - 0.0001) < 1e-12, `left ${account.positions[0].quantity}`)
})

test('what counts as flat scales with the position', () => {
  assert.equal(isFlat(0, 5), true)
  // A billionth of what was held is rounding, not a holding.
  assert.equal(isFlat(4e-18, 0.051), true)
  assert.equal(isFlat(0.0001, 2), false)
  // The same relative rule for a million tokens as for a tenth of a coin.
  assert.equal(isFlat(0.0005, 1_000_000), true)
  assert.equal(isFlat(1, 1_000_000), false)
  assert.equal(isFlat(Number.NaN, 1), false)
})
