/**
 * Risk, calculated.
 *
 * Arithmetic, all of it, on real numbers a person supplied or a provider gave. Nothing here is a forecast and nothing here
 * is a recommendation: a position size is a division, a Sharpe ratio is a mean over a standard deviation, and a drawdown is
 * a maximum. Every function says what it assumed, because a risk number without its assumptions is worse than no number --
 * it looks like a fact.
 *
 * Two things are refused rather than fudged:
 *
 *  - **A calculation that has no answer returns null.** A Sharpe ratio on three days of data, a correlation between a
 *    series and a flat line, a position size with a stop at the entry price. Returning zero, or a plausible-looking
 *    number, is how a risk figure comes to be trusted when it means nothing.
 *  - **Nothing is annualised without being told the period.** A daily Sharpe ratio multiplied by the square root of 252 is
 *    a different number from an hourly one, and guessing which it is makes the result off by a factor of five.
 */

// ---------------------------------------------------------------- position sizing

export interface PositionSizeInput {
  /** The whole account, in its currency. */
  accountValue: number
  /** How much of it is being risked on this trade, as a percentage. */
  riskPercent: number
  entryPrice: number
  stopPrice: number
  /** What each unit costs to trade, both sides. Optional; reduces what can be bought. */
  feePerUnit?: number
}

export interface PositionSize {
  /** How much money is at risk if the stop is hit. */
  riskAmount: number
  /** What one unit loses between entry and stop. */
  riskPerUnit: number
  /** How many units that allows. Whole units, rounded down: a fraction of a share is not a share. */
  units: number
  /** What the position costs at entry. */
  positionValue: number
  /** That, as a percentage of the account, so somebody can see the concentration before they take it. */
  positionPercent: number
  /** Null when the numbers do not allow an answer, with the reason. */
  problem: string | null
}

/**
 * How much to buy for a given risk.
 *
 * The whole calculation is `risk / risk-per-unit`, and the care is all in the edges: a stop at the entry has no risk per
 * unit and therefore allows an infinite position, which is the one answer this must never give.
 */
export function positionSize(input: PositionSizeInput): PositionSize {
  const empty = (problem: string): PositionSize => ({
    riskAmount: 0,
    riskPerUnit: 0,
    units: 0,
    positionValue: 0,
    positionPercent: 0,
    problem
  })
  const { accountValue, riskPercent, entryPrice, stopPrice } = input
  if (![accountValue, riskPercent, entryPrice, stopPrice].every((n) => Number.isFinite(n))) {
    return empty('Every value has to be a number.')
  }
  if (accountValue <= 0) return empty('The account has to be worth something.')
  if (riskPercent <= 0 || riskPercent > 100) return empty('Risk has to be between 0 and 100 per cent.')
  if (entryPrice <= 0) return empty('The entry price has to be above zero.')
  if (stopPrice === entryPrice) {
    // Without this, the division below is by zero and the answer is an unlimited position.
    return empty('The stop cannot be at the entry price: there would be no risk to size against.')
  }

  const riskAmount = accountValue * (riskPercent / 100)
  const riskPerUnit = Math.abs(entryPrice - stopPrice) + Math.abs(input.feePerUnit ?? 0)
  if (riskPerUnit <= 0) return empty('There is no risk per unit to size against.')
  const units = Math.floor(riskAmount / riskPerUnit)
  const positionValue = units * entryPrice
  return {
    riskAmount,
    riskPerUnit,
    units,
    positionValue,
    positionPercent: (positionValue / accountValue) * 100,
    problem: units === 0 ? 'That risk does not allow even one unit.' : null
  }
}

/** The reward against the risk, from three prices. Null when the stop is at the entry. */
export function riskReward(entry: number, stop: number, target: number): number | null {
  if (![entry, stop, target].every((n) => Number.isFinite(n))) return null
  const risk = Math.abs(entry - stop)
  if (risk === 0) return null
  return Math.abs(target - entry) / risk
}

export interface LeverageInput {
  capital: number
  leverage: number
  entryPrice: number
  /** How far the price may move against the position before the margin is gone, as a fraction. */
  maintenanceMargin?: number
}

export interface LeverageResult {
  positionValue: number
  units: number
  margin: number
  /** Where the position would be liquidated, on the stated assumptions. Null when it cannot be worked out. */
  liquidationPrice: number | null
  assumptions: string[]
}

/**
 * What leverage does to a position.
 *
 * The liquidation price is the part that matters and the part most easily got wrong, so the assumption behind it is
 * returned with it: this is the simple case -- an isolated position, no funding, no fees, and a maintenance requirement as
 * a fraction of the position. A real exchange's formula differs, and the result says so rather than implying otherwise.
 */
export function leverage(input: LeverageInput): LeverageResult {
  const assumptions = [
    'An isolated position, with nothing else sharing its margin.',
    'No funding payments, no fees and no interest.',
    'Liquidation when the loss reaches the margin less the maintenance requirement.',
    "Your exchange's own formula may differ."
  ]
  const { capital, leverage: multiple, entryPrice } = input
  if (![capital, multiple, entryPrice].every((n) => Number.isFinite(n)) || capital <= 0 || multiple <= 0 || entryPrice <= 0) {
    return { positionValue: 0, units: 0, margin: 0, liquidationPrice: null, assumptions }
  }
  const positionValue = capital * multiple
  const units = positionValue / entryPrice
  const maintenance = Math.min(0.9, Math.max(0, input.maintenanceMargin ?? 0.005))
  // The price at which the loss equals the margin minus what must be maintained.
  const move = (1 - maintenance) / multiple
  return {
    positionValue,
    units,
    margin: capital,
    liquidationPrice: entryPrice * (1 - move),
    assumptions
  }
}

// ---------------------------------------------------------------- series statistics

/** Returns from a series of values: each period's change as a fraction. */
export function returnsOf(values: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] === 0 || !Number.isFinite(values[i]) || !Number.isFinite(values[i - 1])) continue
    out.push((values[i] - values[i - 1]) / values[i - 1])
  }
  return out
}

const mean = (values: number[]): number => values.reduce((total, v) => total + v, 0) / values.length

/** The sample standard deviation. Null below two values, where it is not defined. */
export function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null
  const m = mean(values)
  const variance = values.reduce((total, v) => total + (v - m) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

/**
 * Whether a deviation is really zero.
 *
 * Not `sd === 0`. Sixty copies of 0.01 have a standard deviation of about 5e-18 rather than nothing, because adding them up
 * and dividing does not land exactly -- and dividing by 5e-18 turns a flat series into a Sharpe ratio of three times ten to
 * the sixteenth. Compared against the size of the numbers involved, because a tolerance that is absolute is wrong for
 * returns measured in thousandths.
 */
const isFlat = (sd: number, values: number[]): boolean => {
  const scale = Math.max(...values.map((v) => Math.abs(v)), 1e-12)
  return sd <= scale * 1e-12
}

/** How many periods of this length there are in a year, for annualising. */
export const PERIODS_PER_YEAR = { daily: 252, weekly: 52, monthly: 12, hourly: 252 * 6.5 } as const

export type Periodicity = keyof typeof PERIODS_PER_YEAR

/**
 * The Sharpe ratio: return above the risk-free rate, per unit of volatility.
 *
 * `periodicity` is required rather than assumed, because annualising a daily series and an hourly one by the same factor is
 * wrong by more than two times. `riskFree` is a yearly rate and is converted to the period.
 *
 * Null on fewer than 30 returns: a Sharpe ratio from a fortnight is noise with a number on it.
 */
export function sharpe(returns: number[], periodicity: Periodicity, riskFreeYearly = 0): number | null {
  if (returns.length < 30) return null
  const periods = PERIODS_PER_YEAR[periodicity]
  const perPeriod = riskFreeYearly / periods
  const sd = standardDeviation(returns)
  if (sd === null || isFlat(sd, returns)) return null
  return ((mean(returns) - perPeriod) / sd) * Math.sqrt(periods)
}

/**
 * The Sortino ratio: like Sharpe, but only counting the volatility that went against you.
 *
 * Null when nothing went against you -- which is not an infinitely good ratio, it is a sample too short to say anything.
 */
export function sortino(returns: number[], periodicity: Periodicity, riskFreeYearly = 0): number | null {
  if (returns.length < 30) return null
  const periods = PERIODS_PER_YEAR[periodicity]
  const perPeriod = riskFreeYearly / periods
  const downside = returns.filter((r) => r < perPeriod).map((r) => (r - perPeriod) ** 2)
  if (downside.length === 0) return null
  const deviation = Math.sqrt(downside.reduce((total, v) => total + v, 0) / returns.length)
  if (isFlat(deviation, returns)) return null
  return ((mean(returns) - perPeriod) / deviation) * Math.sqrt(periods)
}

export interface Drawdown {
  /** The largest peak-to-trough fall, as a positive percentage. */
  maxPercent: number
  /** Where the peak was, and where the trough was, as indices into the series. */
  peakIndex: number
  troughIndex: number
  /** How long it lasted, in periods. */
  lengthPeriods: number
}

/** The worst fall from a high. Zero on a series that only rises, which is the right answer and not a missing one. */
export function maxDrawdown(values: number[]): Drawdown {
  let peak = Number.NEGATIVE_INFINITY
  let peakAt = 0
  let worst = 0
  let worstPeak = 0
  let worstTrough = 0
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (!Number.isFinite(value)) continue
    if (value > peak) {
      peak = value
      peakAt = i
    }
    if (peak > 0) {
      const fall = ((peak - value) / peak) * 100
      if (fall > worst) {
        worst = fall
        worstPeak = peakAt
        worstTrough = i
      }
    }
  }
  return {
    maxPercent: worst,
    peakIndex: worstPeak,
    troughIndex: worstTrough,
    lengthPeriods: Math.max(0, worstTrough - worstPeak)
  }
}

/**
 * Pearson correlation between two series.
 *
 * Null when either series never moves: a flat line has no correlation with anything, and reporting 0 would suggest it had
 * been measured and found independent. The series are truncated to the shorter of the two, so a pair with different
 * histories is compared over the part they share rather than silently misaligned.
 */
export function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length)
  if (n < 2) return null
  const x = a.slice(a.length - n)
  const y = b.slice(b.length - n)
  const mx = mean(x)
  const my = mean(y)
  let top = 0
  let leftSum = 0
  let rightSum = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx
    const dy = y[i] - my
    top += dx * dy
    leftSum += dx * dx
    rightSum += dy * dy
  }
  if (leftSum === 0 || rightSum === 0) return null
  return top / Math.sqrt(leftSum * rightSum)
}

/** Every pair's correlation, as a square matrix in the order given. The diagonal is 1 where a series has any movement. */
export function correlationMatrix(series: { name: string; values: number[] }[]): {
  names: string[]
  matrix: (number | null)[][]
} {
  const returns = series.map((s) => returnsOf(s.values))
  return {
    names: series.map((s) => s.name),
    matrix: returns.map((a) => returns.map((b) => correlation(a, b)))
  }
}

/**
 * Beta against a benchmark: how much this moves for a given move in that.
 *
 * Null when the benchmark never moves, because dividing by its variance would be dividing by zero -- and a beta against
 * something that did not move is not a large number, it is an undefined one.
 */
export function beta(assetReturns: number[], benchmarkReturns: number[]): number | null {
  const n = Math.min(assetReturns.length, benchmarkReturns.length)
  if (n < 2) return null
  const x = benchmarkReturns.slice(benchmarkReturns.length - n)
  const y = assetReturns.slice(assetReturns.length - n)
  const mx = mean(x)
  const my = mean(y)
  let covariance = 0
  let variance = 0
  for (let i = 0; i < n; i++) {
    covariance += (x[i] - mx) * (y[i] - my)
    variance += (x[i] - mx) ** 2
  }
  if (variance === 0) return null
  return covariance / variance
}

export interface Concentration {
  /** The largest single holding, as a percentage of the total. */
  largestPercent: number
  /** How many holdings make up half of it. */
  holdingsForHalf: number
  /** The Herfindahl index: 1 is everything in one thing, near 0 is spread very wide. */
  herfindahl: number
}

/** How concentrated a set of holdings is. All three measures, because each hides something the others show. */
export function concentration(values: number[]): Concentration | null {
  const positive = values.filter((v) => Number.isFinite(v) && v > 0)
  const total = positive.reduce((sum, v) => sum + v, 0)
  if (total <= 0) return null
  const shares = positive.map((v) => v / total).sort((a, b) => b - a)
  let running = 0
  let holdingsForHalf = 0
  for (const share of shares) {
    running += share
    holdingsForHalf++
    if (running >= 0.5) break
  }
  return {
    largestPercent: shares[0] * 100,
    holdingsForHalf,
    herfindahl: shares.reduce((sum, s) => sum + s * s, 0)
  }
}

/** A crypto position's outcome, from entry to exit. Fees both sides, leverage optional. */
export function positionOutcome(input: {
  entryPrice: number
  exitPrice: number
  quantity: number
  side: 'long' | 'short'
  feeRate?: number
  leverage?: number
}): { profit: number; profitPercent: number | null; fees: number; problem: string | null } {
  const { entryPrice, exitPrice, quantity, side } = input
  if (![entryPrice, exitPrice, quantity].every((n) => Number.isFinite(n)) || entryPrice <= 0 || quantity <= 0) {
    return { profit: 0, profitPercent: null, fees: 0, problem: 'Every value has to be a positive number.' }
  }
  const rate = Math.abs(input.feeRate ?? 0)
  const fees = (entryPrice + exitPrice) * quantity * rate
  const gross = side === 'long' ? (exitPrice - entryPrice) * quantity : (entryPrice - exitPrice) * quantity
  const profit = gross - fees
  // Against the margin actually put up, which is what leverage changes.
  const committed = (entryPrice * quantity) / Math.max(1, input.leverage ?? 1)
  return {
    profit,
    profitPercent: committed > 0 ? (profit / committed) * 100 : null,
    fees,
    problem: null
  }
}
