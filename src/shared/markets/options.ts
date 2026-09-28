/**
 * Options strategies, worked out arithmetically.
 *
 * A payoff at expiry is addition and subtraction, and that is all this does. No model, no volatility surface, no estimate:
 * given the legs and a price for the underlying, the value of the position at expiry is exactly determined, and that is the
 * one thing about options that can be stated without a model.
 *
 * What is deliberately **not** here: pricing an option before expiry, or Greeks. Both need a model -- Black-Scholes at
 * least -- and a model needs an implied volatility, which comes from a provider. Rather than implement a model and feed it
 * a guessed volatility, Greeks are taken from the provider that quotes them, and this file stays arithmetic. A delta this
 * file invented would look exactly like a delta from an exchange, and be worthless.
 */

export type OptionKind = 'call' | 'put'
export type LegSide = 'buy' | 'sell'

export interface Leg {
  kind: OptionKind
  side: LegSide
  strike: number
  /** What one contract cost or raised, per unit of the underlying. */
  premium: number
  /** How many contracts. Always positive; `side` carries the direction. */
  quantity: number
  /** How many units of the underlying one contract covers. 100 for most listed equity options. */
  contractSize: number
}

export interface Payoff {
  /** The underlying price this was worked out at. */
  price: number
  /** The position's profit or loss there, in currency. */
  profit: number
}

export interface StrategyResult {
  /** What it cost to open: positive when paid, negative when received. */
  netDebit: number
  maxProfit: number | null
  maxLoss: number | null
  /** Where it breaks even. Several for the spreads that have more than one. */
  breakEvens: number[]
  /** The payoff across a range, for drawing. */
  curve: Payoff[]
  /** Anything that could not be determined, and why. */
  notes: string[]
}

/** What one leg is worth at expiry, for a given underlying price. */
export function legValueAtExpiry(leg: Leg, underlying: number): number {
  const intrinsic = leg.kind === 'call' ? Math.max(0, underlying - leg.strike) : Math.max(0, leg.strike - underlying)
  const units = leg.quantity * leg.contractSize
  // A bought leg gains its intrinsic value and has paid the premium; a sold leg is the mirror.
  return leg.side === 'buy' ? (intrinsic - leg.premium) * units : (leg.premium - intrinsic) * units
}

/** The whole position at expiry, at one price. */
export const payoffAt = (legs: Leg[], underlying: number): number =>
  legs.reduce((total, leg) => total + legValueAtExpiry(leg, underlying), 0)

/** What opening the position cost. Positive for a debit, negative for a credit. */
export const netDebit = (legs: Leg[]): number =>
  legs.reduce(
    (total, leg) => total + (leg.side === 'buy' ? 1 : -1) * leg.premium * leg.quantity * leg.contractSize,
    0
  )

/**
 * A strategy, worked out.
 *
 * The curve is sampled across a range around the strikes, and the extremes are examined separately -- because the maximum
 * profit of a naked call is unbounded and no sampling finds that. `null` is returned for an unbounded side rather than the
 * largest number the sampling happened to reach, which would be a specific, wrong, reassuring figure.
 */
export function analyse(legs: Leg[], options: { from?: number; to?: number; steps?: number } = {}): StrategyResult {
  const notes: string[] = []
  if (legs.length === 0) {
    return { netDebit: 0, maxProfit: null, maxLoss: null, breakEvens: [], curve: [], notes: ['No legs.'] }
  }
  const valid = legs.every(
    (l) =>
      Number.isFinite(l.strike) &&
      l.strike > 0 &&
      Number.isFinite(l.premium) &&
      l.premium >= 0 &&
      Number.isFinite(l.quantity) &&
      l.quantity > 0 &&
      Number.isFinite(l.contractSize) &&
      l.contractSize > 0
  )
  if (!valid) {
    return {
      netDebit: 0,
      maxProfit: null,
      maxLoss: null,
      breakEvens: [],
      curve: [],
      notes: ['Every leg needs a strike, a premium, a quantity and a contract size.']
    }
  }

  const strikes = legs.map((l) => l.strike)
  const low = options.from ?? Math.max(0, Math.min(...strikes) * 0.5)
  const high = options.to ?? Math.max(...strikes) * 1.5
  const steps = Math.min(2000, Math.max(20, options.steps ?? 200))

  const curve: Payoff[] = []
  for (let i = 0; i <= steps; i++) {
    const price = low + ((high - low) * i) / steps
    curve.push({ price, profit: payoffAt(legs, price) })
  }

  /*
   * Whether either side is unbounded.
   *
   * At a very high underlying price the position's slope is the net of the call legs; at zero it is the net of the puts.
   * A slope that does not flatten means that side has no maximum, and `null` says so. Sampling would instead report
   * whatever the edge of the range happened to be -- a precise number that is simply the width of the chart.
   */
  const callSlope = legs
    .filter((l) => l.kind === 'call')
    .reduce((total, l) => total + (l.side === 'buy' ? 1 : -1) * l.quantity * l.contractSize, 0)
  const putSlope = legs
    .filter((l) => l.kind === 'put')
    .reduce((total, l) => total + (l.side === 'buy' ? 1 : -1) * l.quantity * l.contractSize, 0)

  const sampled = curve.map((p) => p.profit)
  let maxProfit: number | null = Math.max(...sampled)
  let maxLoss: number | null = Math.min(...sampled)

  if (callSlope > 0) {
    maxProfit = null
    notes.push('Profit is unbounded above: the position is net long calls.')
  }
  if (callSlope < 0) {
    maxLoss = null
    notes.push('Loss is unbounded above: the position is net short calls.')
  }
  if (putSlope > 0) {
    // A long put's profit is capped at the strike, so this only matters against an already-unbounded max.
    const atZero = payoffAt(legs, 0)
    if (maxProfit !== null) maxProfit = Math.max(maxProfit, atZero)
  }
  if (putSlope < 0 && maxLoss !== null) {
    maxLoss = Math.min(maxLoss, payoffAt(legs, 0))
    notes.push('The largest loss below is at an underlying price of zero.')
  }

  return { netDebit: netDebit(legs), maxProfit, maxLoss, breakEvens: breakEvensOf(legs, low, high), curve, notes }
}

/**
 * Where the position breaks even.
 *
 * Found by walking the payoff and looking for sign changes, then narrowing each one -- rather than by algebra per strategy,
 * which would need a case for every combination and would be wrong for the ones nobody thought of. The payoff is piecewise
 * linear, so a bisection lands exactly.
 */
export function breakEvensOf(legs: Leg[], from: number, to: number, steps = 2000): number[] {
  const out: number[] = []
  let previousPrice = from
  let previous = payoffAt(legs, from)
  /*
   * Whether the payoff is currently sitting exactly at zero.
   *
   * A spread bought for exactly its width is worth nothing over a whole stretch of prices, not at one point -- so every
   * sample across that stretch is a break-even, and reporting each of them gives hundreds of them. The start of the run is
   * the useful answer; the rest is the same fact repeated.
   */
  let inZeroRun = previous === 0
  if (inZeroRun) out.push(from)

  for (let i = 1; i <= steps; i++) {
    const price = from + ((to - from) * i) / steps
    const value = payoffAt(legs, price)
    if (value === 0) {
      if (!inZeroRun) {
        out.push(price)
        inZeroRun = true
      }
      previousPrice = price
      previous = value
      continue
    }
    inZeroRun = false
    if ((previous < 0 && value > 0) || (previous > 0 && value < 0)) {
      // Narrow it: thirty halvings puts it well inside a penny.
      let lowPrice = previousPrice
      let highPrice = price
      for (let n = 0; n < 30; n++) {
        const middle = (lowPrice + highPrice) / 2
        if (Math.sign(payoffAt(legs, middle)) === Math.sign(previous)) lowPrice = middle
        else highPrice = middle
      }
      out.push((lowPrice + highPrice) / 2)
    }
    previousPrice = price
    previous = value
  }
  // Round to sensible precision and de-duplicate: a flat stretch at zero would otherwise produce hundreds.
  const seen = new Set<string>()
  return out.filter((p) => {
    const key = p.toFixed(4)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export type StrategyName =
  | 'long-call'
  | 'long-put'
  | 'covered-call'
  | 'protective-put'
  | 'bull-call-spread'
  | 'bear-put-spread'
  | 'straddle'
  | 'strangle'
  | 'iron-condor'
  | 'calendar-spread'

export interface StrategyTemplate {
  name: StrategyName
  label: string
  /** How many strikes it needs, and what each is for. */
  strikes: string[]
  about: string
}

/**
 * The strategies the builder offers.
 *
 * `calendar-spread` is listed but described honestly: its value depends on time and volatility, which an expiry payoff
 * cannot show. Offering it with a two-line payoff would be offering a picture that is wrong about the thing the strategy is
 * for.
 */
export const STRATEGIES: StrategyTemplate[] = [
  { name: 'long-call', label: 'Long call', strikes: ['Strike'], about: 'Profit above the strike, limited to the premium below it.' },
  { name: 'long-put', label: 'Long put', strikes: ['Strike'], about: 'Profit below the strike, limited to the premium above it.' },
  {
    name: 'covered-call',
    label: 'Covered call',
    strikes: ['Strike'],
    about: 'Holding the underlying and selling a call against it. Income, capped upside.'
  },
  {
    name: 'protective-put',
    label: 'Protective put',
    strikes: ['Strike'],
    about: 'Holding the underlying and buying a put. Insurance, at the cost of the premium.'
  },
  { name: 'bull-call-spread', label: 'Bull call spread', strikes: ['Buy', 'Sell'], about: 'Both profit and loss are capped.' },
  { name: 'bear-put-spread', label: 'Bear put spread', strikes: ['Buy', 'Sell'], about: 'Both profit and loss are capped.' },
  { name: 'straddle', label: 'Straddle', strikes: ['Strike'], about: 'A call and a put at the same strike: a bet on movement either way.' },
  { name: 'strangle', label: 'Strangle', strikes: ['Put', 'Call'], about: 'Like a straddle, wider and cheaper.' },
  {
    name: 'iron-condor',
    label: 'Iron condor',
    strikes: ['Put buy', 'Put sell', 'Call sell', 'Call buy'],
    about: 'Profit if the underlying stays between the middle strikes. Everything capped.'
  },
  {
    name: 'calendar-spread',
    label: 'Calendar spread',
    strikes: ['Strike'],
    about:
      'Two expiries at one strike. Its value depends on time and volatility, so an expiry payoff cannot describe it -- the near leg is shown at its own expiry only.'
  }
]

export const strategyTemplate = (name: StrategyName): StrategyTemplate | undefined =>
  STRATEGIES.find((s) => s.name === name)

/** The underlying held as a position, for the strategies that include it. Modelled as a leg-like line. */
export interface UnderlyingLeg {
  side: LegSide
  entryPrice: number
  quantity: number
}

/** A payoff including the underlying, for a covered call or a protective put. */
export function payoffWithUnderlying(legs: Leg[], underlyingLeg: UnderlyingLeg | null, price: number): number {
  const options = payoffAt(legs, price)
  if (!underlyingLeg) return options
  const direction = underlyingLeg.side === 'buy' ? 1 : -1
  return options + (price - underlyingLeg.entryPrice) * underlyingLeg.quantity * direction
}
