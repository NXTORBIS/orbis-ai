/**
 * Paper trading: a simulation, and honest about being one.
 *
 * Deterministic arithmetic on real prices. Given the same orders and the same quotes it produces the same fills every
 * time, which is what makes a paper record worth reviewing -- a simulation that answered differently on Tuesday would
 * teach nobody anything.
 *
 * The assumptions are written down rather than hidden, because a paper result is only useful if you know what it assumed:
 *
 *  - A **market order** fills at the price on offer, plus slippage. Not at the mid, and not at the last trade: a buyer
 *    pays the ask.
 *  - A **limit order** fills only when the market reaches the limit, and then fills *at the limit* -- never better. A
 *    simulation that filled better than asked would flatter every strategy that used one.
 *  - **Slippage** is a fraction of the price, applied against the trader. Zero is allowed and is the wrong default: a
 *    strategy that only works with perfect fills does not work.
 *  - **Fees** are a fraction of the value, charged on both sides.
 *  - **No partial fills against depth.** The order book is not simulated, so a large order does not walk it. That
 *    flatters large orders, and is stated rather than quietly assumed.
 *  - **A closed market does not fill.** Crypto is always open; a stock order placed at midnight waits.
 *
 * Nothing here talks to a broker, and there is nowhere for a credential to go.
 */

import type { MarketStatus, QuoteView } from './instrument.ts'

export type Side = 'buy' | 'sell'
export type OrderType = 'market' | 'limit' | 'stop' | 'stop-limit'
export type OrderState = 'pending' | 'filled' | 'cancelled' | 'rejected'

export interface PaperOrder {
  id: string
  instrumentId: string
  side: Side
  type: OrderType
  /** How many units. Always positive; `side` carries the direction. */
  quantity: number
  /** For limit and stop-limit: the worst acceptable price. */
  limitPrice?: number
  /** For stop and stop-limit: the price that turns it into an order. */
  stopPrice?: number
  state: OrderState
  placedAt: number
  filledAt?: number
  /** What it actually filled at, including slippage. */
  filledPrice?: number
  /** What it cost in fees. */
  fee?: number
  /** Why it was rejected, when it was. */
  reason?: string
}

export interface PaperPosition {
  instrumentId: string
  /** Positive for long, negative for short. */
  quantity: number
  /** The weighted average of what it was opened at. */
  averagePrice: number
  /** Fees paid so far on this position, which are part of its cost. */
  feesPaid: number
  openedAt: number
}

export interface PaperFill {
  orderId: string
  instrumentId: string
  side: Side
  quantity: number
  price: number
  fee: number
  at: number
  /** Realised profit or loss, when this fill closed part of a position. */
  realised: number
}

export interface PaperAccount {
  /** What it started with, so a return can be worked out. */
  startingCash: number
  cash: number
  positions: PaperPosition[]
  orders: PaperOrder[]
  fills: PaperFill[]
  currency: string
}

export interface PaperSettings {
  /** A fraction of the price, against the trader. 0.0005 is five basis points. */
  slippage: number
  /** A fraction of the value, each side. */
  feeRate: number
  /** Whether shorting is allowed. Off by default: a simulation that allows it silently teaches the wrong lesson. */
  allowShort: boolean
}

export const DEFAULT_SETTINGS: PaperSettings = {
  // Not zero. A strategy that only works with perfect fills does not work, and a default of zero hides that.
  slippage: 0.0005,
  feeRate: 0.001,
  allowShort: false
}

export const newAccount = (startingCash: number, currency = 'USD'): PaperAccount => ({
  startingCash,
  cash: startingCash,
  positions: [],
  orders: [],
  fills: [],
  currency
})

/** What this simulation assumed, in words, so a result is never read without them. */
export const ASSUMPTIONS: string[] = [
  'Market orders fill at the price on offer, plus slippage against you.',
  'Limit orders fill at your limit, never better.',
  'Fees are charged on both sides.',
  'Orders are not matched against real order-book depth, so a large order is not slowed by the market.',
  'Orders on a closed market wait until it opens.',
  'No borrowing, no margin and no interest.'
]

/** The price a side would actually pay, from the best information the quote has. */
function priceFor(side: Side, quote: QuoteView, slippage: number): number | null {
  // The ask for a buyer and the bid for a seller. Falling back to the last trade when the feed has no book, which is
  // honest but slightly optimistic -- and is why slippage exists.
  const base = side === 'buy' ? (quote.ask ?? quote.last) : (quote.bid ?? quote.last)
  if (base === null || !Number.isFinite(base) || base <= 0) return null
  const drift = base * Math.abs(slippage)
  return side === 'buy' ? base + drift : base - drift
}

/**
 * Whether what is left of a position is nothing.
 *
 * A billionth of what was held is rounding, not a holding. Relative rather than absolute because quantities here span
 * fractions of a bitcoin and millions of a token, and one absolute threshold cannot be right for both.
 */
export const isFlat = (remaining: number, was: number): boolean => {
  if (remaining === 0) return true
  if (!Number.isFinite(remaining)) return false
  return Math.abs(remaining) <= Math.abs(was) * 1e-9
}

const tradable = (status: MarketStatus): boolean =>
  status === 'open' || status === 'always-open' || status === 'pre-market' || status === 'after-hours'

export interface Outcome {
  account: PaperAccount
  /** What happened, for the journal and for the interface to say. */
  detail: string
  order: PaperOrder
}

/**
 * Places an order.
 *
 * Refused rather than queued when it cannot be afforded, when the quantity is not a quantity, or when it would open a
 * short and shorting is off. Refusing is the point: an order that silently became a negative cash balance would make every
 * number after it meaningless.
 */
export function place(
  account: PaperAccount,
  order: Omit<PaperOrder, 'state' | 'placedAt'> & { placedAt: number },
  quote: QuoteView | null,
  settings: PaperSettings = DEFAULT_SETTINGS
): Outcome {
  const reject = (reason: string): Outcome => {
    const rejected: PaperOrder = { ...order, state: 'rejected', reason }
    return { account: { ...account, orders: [...account.orders, rejected] }, detail: reason, order: rejected }
  }

  if (!Number.isFinite(order.quantity) || order.quantity <= 0) {
    return reject('A quantity has to be a positive number.')
  }
  if ((order.type === 'limit' || order.type === 'stop-limit') && !Number.isFinite(order.limitPrice ?? Number.NaN)) {
    return reject('A limit order needs a limit price.')
  }
  if ((order.type === 'stop' || order.type === 'stop-limit') && !Number.isFinite(order.stopPrice ?? Number.NaN)) {
    return reject('A stop order needs a stop price.')
  }
  if (!quote || quote.last === null) {
    return reject('There is no price for this, so nothing can be simulated against it.')
  }

  const held = account.positions.find((p) => p.instrumentId === order.instrumentId)
  const heldQuantity = held?.quantity ?? 0
  if (order.side === 'sell' && !settings.allowShort && heldQuantity < order.quantity) {
    return reject(
      heldQuantity <= 0
        ? 'There is nothing to sell, and shorting is switched off in the paper settings.'
        : `Only ${heldQuantity} held, and shorting is switched off in the paper settings.`
    )
  }

  const pending: PaperOrder = { ...order, state: 'pending' }
  // A market order on an open market fills at once; everything else waits to be looked at again.
  const next = { ...account, orders: [...account.orders, pending] }
  if (order.type !== 'market' || !tradable(quote.marketStatus)) {
    const detail =
      order.type === 'market'
        ? 'The market is closed, so this waits until it opens.'
        : 'Waiting for the market to reach it.'
    return { account: next, detail, order: pending }
  }
  return fillOne(next, pending, quote, settings, order.placedAt)
}

/**
 * Looks at every waiting order against a price, and fills the ones that are due.
 *
 * Called on each quote. Deterministic in its order -- oldest first -- so two runs of the same data produce the same
 * account, which is what makes a paper history worth reviewing.
 */
export function onQuote(
  account: PaperAccount,
  quote: QuoteView,
  at: number,
  settings: PaperSettings = DEFAULT_SETTINGS
): { account: PaperAccount; fills: PaperFill[] } {
  if (quote.last === null || !tradable(quote.marketStatus)) return { account, fills: [] }
  let working = account
  const fills: PaperFill[] = []
  const waiting = account.orders
    .filter((o) => o.state === 'pending' && o.instrumentId === quote.instrumentId)
    .sort((a, b) => a.placedAt - b.placedAt)

  for (const order of waiting) {
    if (!due(order, quote)) continue
    const outcome = fillOne(working, order, quote, settings, at)
    working = outcome.account
    const fill = working.fills[working.fills.length - 1]
    if (fill && fill.orderId === order.id) fills.push(fill)
  }
  return { account: working, fills }
}

/** Whether a waiting order's condition has been met. */
function due(order: PaperOrder, quote: QuoteView): boolean {
  const last = quote.last
  if (last === null) return false
  switch (order.type) {
    case 'market':
      return true
    case 'limit':
      // A buy limit fills when the price comes down to it; a sell limit when it rises to it.
      return order.side === 'buy' ? last <= (order.limitPrice as number) : last >= (order.limitPrice as number)
    case 'stop':
      // A stop is the other way round: it triggers when the price moves against the position.
      return order.side === 'buy' ? last >= (order.stopPrice as number) : last <= (order.stopPrice as number)
    case 'stop-limit': {
      const triggered = order.side === 'buy' ? last >= (order.stopPrice as number) : last <= (order.stopPrice as number)
      if (!triggered) return false
      return order.side === 'buy' ? last <= (order.limitPrice as number) : last >= (order.limitPrice as number)
    }
  }
}

/** Fills one order, moving the cash and the position. */
function fillOne(
  account: PaperAccount,
  order: PaperOrder,
  quote: QuoteView,
  settings: PaperSettings,
  at: number
): Outcome {
  const market = priceFor(order.side, quote, settings.slippage)
  if (market === null) {
    const rejected: PaperOrder = { ...order, state: 'rejected', reason: 'There is no price to fill against.' }
    return {
      account: { ...account, orders: account.orders.map((o) => (o.id === order.id ? rejected : o)) },
      detail: rejected.reason as string,
      order: rejected
    }
  }

  /*
   * A resting limit fills at its limit. Exactly, not better and not worse.
   *
   * A real broker would sometimes fill better, and simulating that is the classic way a backtest lies: the price that
   * gapped through your limit in one tick is a price you would not have caught. Assuming the limit is the conservative
   * choice and the one this simulation documents, and slippage does not apply -- a resting order is not chasing anything.
   *
   * The first version of this used `Math.min` for a buy, which filled at whatever the market had gapped to. Every strategy
   * that used a limit looked better than it was, and nothing said so.
   */
  const price =
    order.type === 'limit' || order.type === 'stop-limit' ? (order.limitPrice as number) : market

  const value = price * order.quantity
  const fee = value * Math.abs(settings.feeRate)

  if (order.side === 'buy' && value + fee > account.cash + 1e-9) {
    const rejected: PaperOrder = {
      ...order,
      state: 'rejected',
      reason: `That needs ${(value + fee).toFixed(2)} and there is ${account.cash.toFixed(2)}.`
    }
    return {
      account: { ...account, orders: account.orders.map((o) => (o.id === order.id ? rejected : o)) },
      detail: rejected.reason as string,
      order: rejected
    }
  }

  const held = account.positions.find((p) => p.instrumentId === order.instrumentId)
  const signed = order.side === 'buy' ? order.quantity : -order.quantity
  let realised = 0
  let positions = account.positions

  if (!held || held.quantity === 0) {
    positions = [
      ...account.positions.filter((p) => p.instrumentId !== order.instrumentId),
      { instrumentId: order.instrumentId, quantity: signed, averagePrice: price, feesPaid: fee, openedAt: at }
    ]
  } else if (Math.sign(held.quantity) === Math.sign(signed)) {
    // Adding to a position: the average moves, and nothing is realised.
    const total = held.quantity + signed
    positions = account.positions.map((p) =>
      p.instrumentId !== order.instrumentId
        ? p
        : {
            ...p,
            quantity: total,
            averagePrice: (held.averagePrice * held.quantity + price * signed) / total,
            feesPaid: p.feesPaid + fee
          }
    )
  } else {
    // Closing some or all of it: the part that closes is realised at the difference from the average.
    const closing = Math.min(Math.abs(signed), Math.abs(held.quantity))
    realised =
      held.quantity > 0 ? (price - held.averagePrice) * closing : (held.averagePrice - price) * closing
    const left = held.quantity + signed
    positions =
      // Flat, allowing for the fact that binary floating point does not make 0.05 + 0.001 come to exactly 0.051. Selling
      // everything left a position of about 4e-18 units, which was drawn in the holdings table, priced, counted in
      // exposure, and then refused a later sale on the grounds that only 4e-18 was held. The tolerance is relative to the
      // position, so it means the same thing for a tenth of a bitcoin as for a million tokens.
      isFlat(left, held.quantity)
        ? account.positions.filter((p) => p.instrumentId !== order.instrumentId)
        : account.positions.map((p) =>
            p.instrumentId !== order.instrumentId
              ? p
              : {
                  ...p,
                  quantity: left,
                  // Flipping through zero opens a new position at this price; reducing keeps the old average.
                  averagePrice: Math.sign(left) === Math.sign(held.quantity) ? p.averagePrice : price,
                  feesPaid: p.feesPaid + fee
                }
          )
  }

  const filled: PaperOrder = { ...order, state: 'filled', filledAt: at, filledPrice: price, fee }
  const fill: PaperFill = {
    orderId: order.id,
    instrumentId: order.instrumentId,
    side: order.side,
    quantity: order.quantity,
    price,
    fee,
    at,
    realised
  }
  return {
    account: {
      ...account,
      // Cash out for a buy, in for a sell; the fee always out.
      cash: account.cash + (order.side === 'buy' ? -value : value) - fee,
      positions,
      orders: account.orders.map((o) => (o.id === order.id ? filled : o)),
      fills: [...account.fills, fill]
    },
    detail: `Filled ${order.quantity} at ${price.toFixed(2)}${fee > 0 ? `, fee ${fee.toFixed(2)}` : ''}.`,
    order: filled
  }
}

export function cancel(account: PaperAccount, orderId: string): PaperAccount {
  return {
    ...account,
    orders: account.orders.map((o) => (o.id === orderId && o.state === 'pending' ? { ...o, state: 'cancelled' } : o))
  }
}

export interface AccountValue {
  cash: number
  /** What the open positions are worth at the prices given. */
  positionsValue: number
  total: number
  /** Profit or loss on open positions, at those prices. */
  unrealised: number
  /** Profit or loss already taken. */
  realised: number
  /** Fees paid over the account's life. */
  fees: number
  /** Total return against what it started with, as a percentage. */
  returnPercent: number
  /** Instruments with no price, so a total is never presented as complete when it is not. */
  missingPrices: string[]
}

/**
 * What the account is worth.
 *
 * Instruments with no price are listed rather than valued at zero or at what they cost. A total that quietly treated a
 * missing price as the purchase price would be a portfolio value that never moved, and one that treated it as zero would
 * be a loss that never happened -- so the total covers what is known and says what it could not include.
 */
export function valueOf(account: PaperAccount, prices: Map<string, number | null>): AccountValue {
  let positionsValue = 0
  let unrealised = 0
  const missingPrices: string[] = []
  for (const position of account.positions) {
    const price = prices.get(position.instrumentId) ?? null
    if (price === null || !Number.isFinite(price)) {
      missingPrices.push(position.instrumentId)
      continue
    }
    positionsValue += price * position.quantity
    unrealised +=
      position.quantity > 0
        ? (price - position.averagePrice) * position.quantity
        : (position.averagePrice - price) * Math.abs(position.quantity)
  }
  const realised = account.fills.reduce((total, f) => total + f.realised, 0)
  const fees = account.fills.reduce((total, f) => total + f.fee, 0)
  const total = account.cash + positionsValue
  return {
    cash: account.cash,
    positionsValue,
    total,
    unrealised,
    realised,
    fees,
    returnPercent:
      account.startingCash > 0 ? ((total - account.startingCash) / account.startingCash) * 100 : 0,
    missingPrices
  }
}
