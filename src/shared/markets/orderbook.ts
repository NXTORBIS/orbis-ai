import type { OrderBook, OrderBookLevel } from './provider.ts'

/**
 * An order book kept correct across a stream of incremental updates.
 *
 * A depth stream sends changes, not states: "there are now 3.2 at 84,500", "there is nothing at 84,499 any more". Applying
 * those to a snapshot works only while none of them is missed — and the moment one is, every number in the book is quietly
 * wrong while looking entirely normal. That failure is what this file exists to prevent.
 *
 * The rule: **a book that cannot prove it is continuous is not shown as current.** Sequence numbers are checked on every
 * update; a gap marks the book invalid and asks for a fresh snapshot, and until that arrives the book says it is
 * resynchronising rather than presenting stale depth as live. Guessing that one missed update probably did not matter is
 * how an order book comes to show liquidity that is not there.
 *
 * Everything else here — cumulative depth, price aggregation, imbalance — is computed from the book and never stored, so
 * there is exactly one copy of the truth and no way for a derived figure to drift from it.
 */

export type BookState =
  /** No snapshot yet. Nothing to show. */
  | 'empty'
  /** A snapshot has arrived and updates are being applied in order. */
  | 'live'
  /** Continuity was broken. What is held is out of date and a fresh snapshot has been asked for. */
  | 'resyncing'

/** One incremental change, as a venue publishes it. */
export interface BookDelta {
  instrumentId: string
  /** The first update this message covers. Venues that publish a range use both. */
  firstUpdateId: number | null
  /** The last update this message covers. Null from a venue that publishes no sequence at all. */
  lastUpdateId: number | null
  /** The previous message's last id, where the venue states it. The strongest continuity check there is. */
  previousUpdateId?: number | null
  /** Levels to set. A size of zero removes the level. */
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  timestamp: number
}

export interface BookSnapshot {
  instrumentId: string
  /** The update id the snapshot is current as of. Null from a venue that publishes none. */
  lastUpdateId: number | null
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  timestamp: number
  source: string
}

/** Why a book stopped being trustworthy, for the panel to say and the diagnostics to count. */
export type BookProblem = 'gap' | 'out-of-order' | 'crossed' | 'no-snapshot'

export interface BookView {
  instrumentId: string
  state: BookState
  /** Highest first. */
  bids: OrderBookLevel[]
  /** Lowest first. */
  asks: OrderBookLevel[]
  timestamp: number
  source: string
  /** The last update applied, for diagnostics. */
  lastUpdateId: number | null
  /** How many messages were dropped as stale or duplicate. */
  dropped: number
  /** How many times continuity broke and a resync was needed. */
  resyncs: number
  /** What went wrong most recently, or null. */
  problem: BookProblem | null
  /** Updates held while waiting for a snapshot to apply them to. */
  buffered: number
}

/**
 * One instrument's book.
 *
 * Deliberately a class with mutable maps rather than an immutable structure rebuilt per update: a busy pair sends dozens
 * of changes a second across hundreds of levels, and copying the whole book each time is the difference between a panel
 * that keeps up and one that does not. The view is built on demand, sorted, for the renderer.
 */
export class BookKeeper {
  readonly instrumentId: string
  private bids = new Map<number, number>()
  private asks = new Map<number, number>()
  private lastUpdateId: number | null = null
  private state: BookState = 'empty'
  private source = ''
  private stamp = 0
  private droppedCount = 0
  private resyncCount = 0
  private lastProblem: BookProblem | null = null
  /**
   * Updates that arrived before the snapshot they belong to.
   *
   * A venue's stream starts before the snapshot request completes, so the first updates describe a book Orbis does not
   * have yet. Held, then applied in order once it does — which is the documented way to start one of these without a hole
   * at the beginning. Bounded, because a snapshot that never arrives must not grow this without limit.
   */
  private pending: BookDelta[] = []
  private readonly maxPending: number
  /**
   * Whether a delta has been applied since the last snapshot.
   *
   * The first one is a special case and has to be. A venue's depth messages carry a range, and the message that was in
   * flight when the snapshot was taken *straddles* it: it starts before the snapshot's id and ends after. Its "follows
   * message N" field therefore names something older than the snapshot, which is correct and is not a gap.
   *
   * Checking `previousUpdateId` against the snapshot id rejected exactly that message. Every unit test passed, because
   * none of them modelled a straddling first event; the real stream reported a gap within a second of connecting.
   */
  private appliedSinceSnapshot = false

  constructor(instrumentId: string, options: { maxPending?: number } = {}) {
    this.instrumentId = instrumentId
    this.maxPending = Math.max(1, options.maxPending ?? 500)
  }

  /** Whether a fresh snapshot is needed. True before the first one and after any break in continuity. */
  needsSnapshot(): boolean {
    return this.state !== 'live'
  }

  /**
   * Applies a snapshot, discarding whatever was held.
   *
   * Discarding rather than merging: a snapshot is the venue's own statement of the whole book, and keeping a level it did
   * not mention would be keeping a level the venue says is gone.
   */
  snapshot(snapshot: BookSnapshot): void {
    this.bids = new Map()
    this.asks = new Map()
    for (const level of snapshot.bids) this.set(this.bids, level)
    for (const level of snapshot.asks) this.set(this.asks, level)
    this.lastUpdateId = snapshot.lastUpdateId
    this.source = snapshot.source
    this.stamp = snapshot.timestamp
    this.state = 'live'
    this.lastProblem = null
    this.appliedSinceSnapshot = false

    // Anything buffered while the snapshot was in flight, in order, and only what the snapshot does not already include.
    const held = this.pending
    this.pending = []
    for (const delta of held.sort((a, b) => (a.lastUpdateId ?? 0) - (b.lastUpdateId ?? 0))) {
      if (snapshot.lastUpdateId !== null && delta.lastUpdateId !== null && delta.lastUpdateId <= snapshot.lastUpdateId) {
        continue
      }
      this.apply(delta)
    }
  }

  /**
   * Applies one incremental update.
   *
   * Returns true when it was applied. False means it was refused — stale, duplicate, or leaving a gap — and the reason is
   * on the view. A refused update never half-applies: the checks all happen before a single level is touched.
   */
  apply(delta: BookDelta): boolean {
    if (delta.instrumentId !== this.instrumentId) return false

    if (this.state !== 'live') {
      // No book to apply to yet. Held rather than dropped, so the first moments of a stream are not lost.
      if (this.pending.length < this.maxPending) this.pending.push(delta)
      else this.droppedCount += 1
      if (this.state === 'empty') this.lastProblem = 'no-snapshot'
      return false
    }

    if (this.lastUpdateId !== null && delta.lastUpdateId !== null) {
      // Already applied, or older than what is held. Not an error and not news.
      if (delta.lastUpdateId <= this.lastUpdateId) {
        this.droppedCount += 1
        return false
      }
      if (!this.appliedSinceSnapshot) {
        // The first message after a snapshot. It is the one that was in flight when the snapshot was taken, so it starts
        // before the snapshot's id and ends after it -- which is what makes it the right message and not a gap. Only its
        // start is checked: beginning past the snapshot means a message was genuinely missed.
        if (delta.firstUpdateId !== null && delta.firstUpdateId > this.lastUpdateId + 1) {
          this.break_('gap')
          return false
        }
      } else if (delta.previousUpdateId !== undefined && delta.previousUpdateId !== null) {
        // From here on the venue states which message each one follows, which is the strongest check there is.
        if (delta.previousUpdateId !== this.lastUpdateId) {
          this.break_('gap')
          return false
        }
      } else if (delta.firstUpdateId !== null && delta.firstUpdateId > this.lastUpdateId + 1) {
        // A message starting beyond the next id means one was missed. The book is no longer provably the venue's.
        this.break_('gap')
        return false
      }
    }

    for (const level of delta.bids) this.set(this.bids, level)
    for (const level of delta.asks) this.set(this.asks, level)
    if (delta.lastUpdateId !== null) this.lastUpdateId = delta.lastUpdateId
    this.stamp = Math.max(this.stamp, delta.timestamp)

    // A book where the best bid is above the best ask cannot be a book. Something was missed, whatever the ids said.
    const best = this.best()
    if (best.bid !== null && best.ask !== null && best.bid > best.ask) {
      this.break_('crossed')
      return false
    }
    this.lastProblem = null
    this.appliedSinceSnapshot = true
    return true
  }

  /** Marks the book untrustworthy and asks for a snapshot. */
  private break_(problem: BookProblem): void {
    this.state = 'resyncing'
    this.lastProblem = problem
    this.resyncCount += 1
    // What is held is no longer provably the venue's book. Kept only so the panel can show it as out of date, never as
    // current: `state` is what every reader checks.
  }

  /** Marks the book as needing a snapshot, for a stream that dropped. */
  disconnected(): void {
    if (this.state === 'live') {
      this.state = 'resyncing'
      this.lastProblem = 'gap'
    }
  }

  private set(side: Map<number, number>, level: OrderBookLevel): void {
    if (!Number.isFinite(level.price) || level.price <= 0) return
    if (!Number.isFinite(level.size) || level.size < 0) return
    // Zero means the venue says this level is gone. Removed, not stored as a level with nothing at it.
    if (level.size === 0) side.delete(level.price)
    else side.set(level.price, level.size)
  }

  private best(): { bid: number | null; ask: number | null } {
    let bid: number | null = null
    let ask: number | null = null
    for (const price of this.bids.keys()) if (bid === null || price > bid) bid = price
    for (const price of this.asks.keys()) if (ask === null || price < ask) ask = price
    return { bid, ask }
  }

  /** The book as a screen should read it. Built on demand: there is one copy of the truth and this is a view of it. */
  view(depth = 0): BookView {
    const bids = [...this.bids.entries()]
      .map(([price, size]) => ({ price, size }))
      .sort((a, b) => b.price - a.price)
    const asks = [...this.asks.entries()]
      .map(([price, size]) => ({ price, size }))
      .sort((a, b) => a.price - b.price)
    return {
      instrumentId: this.instrumentId,
      state: this.state,
      bids: depth > 0 ? bids.slice(0, depth) : bids,
      asks: depth > 0 ? asks.slice(0, depth) : asks,
      timestamp: this.stamp,
      source: this.source,
      lastUpdateId: this.lastUpdateId,
      dropped: this.droppedCount,
      resyncs: this.resyncCount,
      problem: this.lastProblem,
      buffered: this.pending.length
    }
  }
}

// ---------------------------------------------------------------- derived, from the book only

/** The best prices, the gap between them, and the middle. Null where a side is empty. */
export interface Touch {
  bid: number | null
  ask: number | null
  bidSize: number | null
  askSize: number | null
  /** Ask minus bid. Null without both. */
  spread: number | null
  /** The spread as a fraction of the mid. Null without both, or when the mid is not a usable denominator. */
  spreadFraction: number | null
  /** The midpoint. Null without both sides — never one side used as a stand-in. */
  mid: number | null
}

export function touchOf(book: { bids: OrderBookLevel[]; asks: OrderBookLevel[] }): Touch {
  const bid = book.bids[0] ?? null
  const ask = book.asks[0] ?? null
  const bidPrice = bid?.price ?? null
  const askPrice = ask?.price ?? null
  const usable = bidPrice !== null && askPrice !== null && askPrice >= bidPrice
  const mid = usable ? (bidPrice + askPrice) / 2 : null
  const spread = usable ? askPrice - bidPrice : null
  return {
    bid: bidPrice,
    ask: askPrice,
    bidSize: bid?.size ?? null,
    askSize: ask?.size ?? null,
    spread,
    // A crossed book is not a negative spread to be displayed; it is a book with something wrong with it.
    spreadFraction: spread !== null && mid !== null && mid > 0 ? spread / mid : null,
    mid
  }
}

export interface DepthLevel extends OrderBookLevel {
  /** Everything at this price and better, in base units. */
  cumulativeSize: number
  /** The same, in the quote currency. */
  cumulativeNotional: number
  /** How far this price is from the mid, as a fraction. Null without a mid. */
  distance: number | null
}

/**
 * One side with its running totals.
 *
 * Accumulated outward from the best price, which is the only order that makes the totals mean anything: "how much can I
 * trade before the price reaches here".
 */
export function cumulative(levels: readonly OrderBookLevel[], mid: number | null): DepthLevel[] {
  let size = 0
  let notional = 0
  const out: DepthLevel[] = []
  for (const level of levels) {
    if (!Number.isFinite(level.price) || !Number.isFinite(level.size)) continue
    size += level.size
    notional += level.price * level.size
    out.push({
      price: level.price,
      size: level.size,
      cumulativeSize: size,
      cumulativeNotional: notional,
      distance: mid !== null && mid > 0 ? Math.abs(level.price - mid) / mid : null
    })
  }
  return out
}

/**
 * Levels grouped onto a price grid.
 *
 * A presentation layer: the raw book is untouched, and the result says how many levels went into each bucket. Bids round
 * down and asks round up, so a bucket never claims a better price than any order actually in it.
 */
export function aggregateLevels(
  levels: readonly OrderBookLevel[],
  bucket: number,
  side: 'bid' | 'ask'
): (OrderBookLevel & { count: number })[] {
  if (!Number.isFinite(bucket) || bucket <= 0) return []
  const grid = new Map<number, { price: number; size: number; count: number }>()
  for (const level of levels) {
    if (!Number.isFinite(level.price) || level.price <= 0 || !Number.isFinite(level.size) || level.size <= 0) continue
    const quotient = level.price / bucket
    // The nudge is the same one the tape uses: 0.3 / 0.1 is 2.9999999999999996, and without it a price lands one bucket
    // below its own.
    const nudged = quotient + Math.abs(quotient) * 1e-9 + 1e-12
    const index = side === 'bid' ? Math.floor(nudged) : Math.ceil(nudged - Math.abs(quotient) * 2e-9 - 2e-12)
    const key = Number((index * bucket).toFixed(10))
    const held = grid.get(key) ?? { price: key, size: 0, count: 0 }
    held.size += level.size
    held.count += 1
    grid.set(key, held)
  }
  const out = [...grid.values()]
  return side === 'bid' ? out.sort((a, b) => b.price - a.price) : out.sort((a, b) => a.price - b.price)
}

/**
 * How lopsided the resting size is near the touch.
 *
 * Within `distance` of the mid, as a fraction — so "within 0.5%" is comparable between a market at 84,000 and one at 0.4.
 * Null when either side has nothing in range, because a ratio against nothing is not a measure of imbalance.
 */
export function imbalance(
  book: { bids: OrderBookLevel[]; asks: OrderBookLevel[] },
  distance: number
): { bidNotional: number; askNotional: number; ratio: number | null; bidShare: number | null } {
  const touch = touchOf(book)
  const mid = touch.mid
  if (mid === null || !(distance > 0)) return { bidNotional: 0, askNotional: 0, ratio: null, bidShare: null }
  const low = mid * (1 - distance)
  const high = mid * (1 + distance)
  let bidNotional = 0
  let askNotional = 0
  for (const level of book.bids) if (level.price >= low) bidNotional += level.price * level.size
  for (const level of book.asks) if (level.price <= high) askNotional += level.price * level.size
  const total = bidNotional + askNotional
  return {
    bidNotional,
    askNotional,
    ratio: askNotional > 0 ? bidNotional / askNotional : null,
    bidShare: total > 0 ? bidNotional / total : null
  }
}

/**
 * What it would cost to trade a given size right now, walking the book.
 *
 * The average price the resting orders would give, and how far that is from the touch. Null when the book does not hold
 * enough to fill the size — which is the honest answer, and far better than an average taken over a partial fill and
 * presented as the cost of the whole.
 */
export function walkBook(
  levels: readonly OrderBookLevel[],
  size: number
): { averagePrice: number; filled: number; slippageFraction: number | null } | null {
  if (!(size > 0) || levels.length === 0) return null
  const touch = levels[0].price
  let remaining = size
  let cost = 0
  for (const level of levels) {
    if (remaining <= 0) break
    const take = Math.min(remaining, level.size)
    cost += take * level.price
    remaining -= take
  }
  // Not enough resting depth. Refused rather than answered from a partial fill.
  if (remaining > 0) return null
  const averagePrice = cost / size
  return {
    averagePrice,
    filled: size,
    slippageFraction: touch > 0 ? Math.abs(averagePrice - touch) / touch : null
  }
}

/** The depth choices a panel offers. Each is a real number of levels a venue will serve. */
export const BOOK_DEPTHS = [5, 10, 20, 50, 100] as const

/**
 * Sensible price grids for a market, from its own price.
 *
 * Powers of ten around a thousandth of the price, so the options suit bitcoin and a sub-cent token alike. Empty when
 * there is no price to derive them from, rather than a list of grids that would put the whole book in one bucket.
 */
export function gridsFor(price: number | null | undefined): number[] {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return []
  const base = Math.floor(Math.log10(price)) - 3
  return [0, 1, 2, 3].map((step) => 10 ** (base + step))
}

/** A whole book from a provider snapshot, for a venue with no incremental stream. */
export function viewFromSnapshot(book: OrderBook): BookView {
  return {
    instrumentId: book.instrumentId,
    // A polled snapshot is as live as the poll. It is not proven continuous, but nothing was missed either: there is
    // nothing to miss, because every read is the whole book.
    state: 'live',
    bids: [...book.bids].sort((a, b) => b.price - a.price),
    asks: [...book.asks].sort((a, b) => a.price - b.price),
    timestamp: book.timestamp,
    source: book.source,
    lastUpdateId: null,
    dropped: 0,
    resyncs: 0,
    problem: null,
    buffered: 0
  }
}
