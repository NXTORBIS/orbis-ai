import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  beta,
  concentration,
  correlation,
  correlationMatrix,
  leverage,
  maxDrawdown,
  PERIODS_PER_YEAR,
  positionOutcome,
  positionSize,
  returnsOf,
  riskReward,
  sharpe,
  sortino,
  standardDeviation
} from './risk.ts'

/**
 * Risk arithmetic.
 *
 * Every test with `null` in it is the important kind. A risk number that cannot be calculated must not come back as zero or
 * as something plausible, because a risk figure is trusted: "your maximum position is 8,000 units" from a stop at the entry
 * price would be acted on.
 */

// ---------------------------------------------------------------- position sizing

test('a position size is the risk divided by the risk per unit, in whole units', () => {
  // 1% of 100,000 is 1,000. A stop 20 below a 500 entry risks 20 a unit. 1,000 / 20 = 50.
  const size = positionSize({ accountValue: 100_000, riskPercent: 1, entryPrice: 500, stopPrice: 480 })
  assert.equal(size.riskAmount, 1000)
  assert.equal(size.riskPerUnit, 20)
  assert.equal(size.units, 50)
  assert.equal(size.positionValue, 25_000)
  assert.equal(size.positionPercent, 25)
  assert.equal(size.problem, null)
})

test('a stop at the entry price is refused, not answered with an unlimited position', () => {
  // The one answer this must never give. Without the guard the division is by zero.
  const size = positionSize({ accountValue: 100_000, riskPercent: 1, entryPrice: 500, stopPrice: 500 })
  assert.equal(size.units, 0)
  assert.match(size.problem ?? '', /no risk to size against/)
})

test('a stop above the entry is sized the same way, because risk has no direction', () => {
  const short = positionSize({ accountValue: 100_000, riskPercent: 1, entryPrice: 480, stopPrice: 500 })
  assert.equal(short.riskPerUnit, 20)
  assert.equal(short.units, 50)
})

test('fees per unit reduce how much can be bought', () => {
  const withFees = positionSize({ accountValue: 100_000, riskPercent: 1, entryPrice: 500, stopPrice: 480, feePerUnit: 5 })
  assert.equal(withFees.riskPerUnit, 25)
  assert.equal(withFees.units, 40)
})

test('units are whole, because a fraction of a share is not a share', () => {
  const size = positionSize({ accountValue: 1000, riskPercent: 1, entryPrice: 100, stopPrice: 97 })
  // 10 / 3 = 3.33
  assert.equal(size.units, 3)
})

test('a risk too small for even one unit says so rather than reporting zero silently', () => {
  const size = positionSize({ accountValue: 100, riskPercent: 1, entryPrice: 5000, stopPrice: 4000 })
  assert.equal(size.units, 0)
  assert.match(size.problem ?? '', /not allow even one unit/)
})

test('nonsense inputs are refused one by one', () => {
  const base = { accountValue: 100_000, riskPercent: 1, entryPrice: 500, stopPrice: 480 }
  assert.ok(positionSize({ ...base, accountValue: 0 }).problem)
  assert.ok(positionSize({ ...base, accountValue: -1 }).problem)
  assert.ok(positionSize({ ...base, riskPercent: 0 }).problem)
  assert.ok(positionSize({ ...base, riskPercent: 101 }).problem)
  assert.ok(positionSize({ ...base, entryPrice: 0 }).problem)
  assert.ok(positionSize({ ...base, entryPrice: Number.NaN }).problem)
})

test('reward against risk is a ratio, and undefined when there is no risk', () => {
  // Entry 100, stop 90, target 130: risk 10, reward 30.
  assert.equal(riskReward(100, 90, 130), 3)
  assert.equal(riskReward(100, 100, 130), null)
  assert.equal(riskReward(100, 90, Number.NaN), null)
})

// ---------------------------------------------------------------- leverage

test('leverage multiplies the position and states what it assumed', () => {
  const result = leverage({ capital: 1000, leverage: 10, entryPrice: 100 })
  assert.equal(result.positionValue, 10_000)
  assert.equal(result.units, 100)
  assert.equal(result.margin, 1000)
  assert.ok(result.assumptions.length >= 3)
  assert.ok(result.assumptions.some((a) => /formula may differ/i.test(a)))
})

test('the liquidation price is below the entry for a long, and closer at higher leverage', () => {
  const ten = leverage({ capital: 1000, leverage: 10, entryPrice: 100 })
  const twenty = leverage({ capital: 1000, leverage: 20, entryPrice: 100 })
  assert.ok((ten.liquidationPrice as number) < 100)
  assert.ok((twenty.liquidationPrice as number) > (ten.liquidationPrice as number), 'more leverage liquidates sooner')
})

test('nonsense leverage gives no liquidation price rather than a misleading one', () => {
  assert.equal(leverage({ capital: 0, leverage: 10, entryPrice: 100 }).liquidationPrice, null)
  assert.equal(leverage({ capital: 1000, leverage: 0, entryPrice: 100 }).liquidationPrice, null)
  assert.equal(leverage({ capital: 1000, leverage: 10, entryPrice: 0 }).liquidationPrice, null)
})

// ---------------------------------------------------------------- series statistics

test('returns are each period’s change as a fraction', () => {
  assert.deepEqual(returnsOf([100, 110, 99]), [0.1, -0.1])
})

test('a zero in the series does not produce an infinite return', () => {
  assert.deepEqual(returnsOf([0, 100]), [])
})

test('a standard deviation needs two values', () => {
  assert.equal(standardDeviation([5]), null)
  assert.equal(standardDeviation([]), null)
  // The sample standard deviation of 1 and 3 is sqrt(2).
  assert.ok(Math.abs((standardDeviation([1, 3]) as number) - Math.SQRT2) < 1e-12)
})

test('a flat series has no deviation', () => {
  assert.equal(standardDeviation([5, 5, 5]), 0)
})

// ---------------------------------------------------------------- Sharpe and Sortino

test('a Sharpe ratio from too little data is null, not noise with a number on it', () => {
  const twoWeeks = Array.from({ length: 10 }, () => 0.01)
  assert.equal(sharpe(twoWeeks, 'daily'), null)
})

test('a Sharpe ratio needs volatility, and is null without it', () => {
  // A series with no deviation at all: dividing by it would be dividing by zero.
  assert.equal(sharpe(new Array(60).fill(0.01), 'daily'), null)
})

test('the annualisation factor depends on the period, which is why it must be given', () => {
  // The same returns, annualised two different ways, are two different numbers -- off by more than two times.
  const returns = Array.from({ length: 300 }, (_v, i) => (i % 3 === 0 ? 0.02 : -0.005))
  const daily = sharpe(returns, 'daily') as number
  const monthly = sharpe(returns, 'monthly') as number
  assert.ok(daily !== null && monthly !== null)
  assert.ok(Math.abs(daily / monthly - Math.sqrt(252 / 12)) < 1e-9)
})

test('a risk-free rate is subtracted, so a higher one gives a lower ratio', () => {
  const returns = Array.from({ length: 300 }, (_v, i) => (i % 3 === 0 ? 0.02 : -0.005))
  const none = sharpe(returns, 'daily', 0) as number
  const some = sharpe(returns, 'daily', 0.05) as number
  assert.ok(some < none)
})

test('Sortino only counts what went against you, so it is higher than Sharpe for an upward series', () => {
  const returns = Array.from({ length: 200 }, (_v, i) => (i % 5 === 0 ? -0.005 : 0.01))
  const s = sharpe(returns, 'daily') as number
  const so = sortino(returns, 'daily') as number
  assert.ok(s !== null && so !== null)
  assert.ok(so > s)
})

test('Sortino on a series that never fell is null, not infinitely good', () => {
  assert.equal(sortino(new Array(60).fill(0.01), 'daily'), null)
})

test('every periodicity has a real factor', () => {
  for (const key of ['daily', 'weekly', 'monthly', 'hourly'] as const) {
    assert.ok(PERIODS_PER_YEAR[key] > 0)
  }
})

// ---------------------------------------------------------------- drawdown

test('the worst drawdown is the largest fall from a high, with where it happened', () => {
  // 100 up to 120, down to 90: a fall of 25% from the peak.
  const down = maxDrawdown([100, 120, 110, 90, 95])
  assert.equal(down.maxPercent, 25)
  assert.equal(down.peakIndex, 1)
  assert.equal(down.troughIndex, 3)
  assert.equal(down.lengthPeriods, 2)
})

test('a series that only rises has no drawdown, which is the right answer', () => {
  assert.equal(maxDrawdown([1, 2, 3, 4]).maxPercent, 0)
})

test('a later, deeper fall wins over an earlier shallow one', () => {
  const down = maxDrawdown([100, 95, 100, 200, 100])
  assert.equal(down.maxPercent, 50)
  assert.equal(down.peakIndex, 3)
})

// ---------------------------------------------------------------- correlation

test('a series correlates perfectly with itself, and inversely with its negative', () => {
  const a = [1, 2, 3, 4, 5]
  assert.ok(Math.abs((correlation(a, a) as number) - 1) < 1e-12)
  assert.ok(Math.abs((correlation(a, a.map((v) => -v)) as number) + 1) < 1e-12)
})

test('a flat line correlates with nothing, and says so with null rather than zero', () => {
  // Zero would suggest it had been measured and found independent.
  assert.equal(correlation([1, 2, 3], [5, 5, 5]), null)
  assert.equal(correlation([5, 5, 5], [5, 5, 5]), null)
})

test('two series of different lengths are compared over the part they share', () => {
  const long = [9, 9, 1, 2, 3]
  const short = [1, 2, 3]
  assert.ok(Math.abs((correlation(long, short) as number) - 1) < 1e-12)
})

test('a correlation matrix correlates returns, not price levels', () => {
  /*
   * The distinction that catches people out. [1,2,3,4] and [4,3,2,1] look perfectly inverse as *prices*, but their returns
   * are [+100%, +50%, +33%] and [-25%, -33%, -50%] -- both declining -- so on returns they are positively correlated. This
   * matrix is about returns, which is the right basis for a portfolio, and the test says so rather than asserting the
   * price-level intuition.
   */
  const together = correlationMatrix([
    { name: 'A', values: [1, 2, 3, 4] },
    { name: 'B', values: [4, 3, 2, 1] }
  ])
  assert.deepEqual(together.names, ['A', 'B'])
  assert.ok(Math.abs((together.matrix[0][0] as number) - 1) < 1e-12)
  assert.ok((together.matrix[0][1] as number) > 0, 'their returns both decline')

  // Genuinely opposite returns: one gains on the days the other loses.
  const opposed = correlationMatrix([
    { name: 'up', values: [100, 110, 99, 109, 98] },
    { name: 'down', values: [100, 91, 101, 92, 102] }
  ])
  assert.ok((opposed.matrix[0][1] as number) < -0.9, 'these really are inverse')
})

// ---------------------------------------------------------------- beta

test('beta against itself is 1, and against a doubled benchmark is a half', () => {
  const benchmark = [0.01, -0.02, 0.03, -0.01, 0.02]
  assert.ok(Math.abs((beta(benchmark, benchmark) as number) - 1) < 1e-12)
  const doubled = benchmark.map((r) => r * 2)
  assert.ok(Math.abs((beta(benchmark, doubled) as number) - 0.5) < 1e-12)
})

test('beta against a benchmark that never moved is undefined, not enormous', () => {
  assert.equal(beta([0.01, 0.02], [0, 0]), null)
  assert.equal(beta([0.01], [0.01]), null)
})

// ---------------------------------------------------------------- concentration

test('concentration reports the largest, how few make up half, and how spread it is', () => {
  const spread = concentration([25, 25, 25, 25])
  assert.equal(spread?.largestPercent, 25)
  assert.equal(spread?.holdingsForHalf, 2)
  assert.ok(Math.abs((spread?.herfindahl as number) - 0.25) < 1e-12)

  const lopsided = concentration([97, 1, 1, 1])
  assert.equal(lopsided?.largestPercent, 97)
  assert.equal(lopsided?.holdingsForHalf, 1)
  assert.ok((lopsided?.herfindahl as number) > 0.9)
})

test('nothing held has no concentration', () => {
  assert.equal(concentration([]), null)
  assert.equal(concentration([0, 0]), null)
  assert.equal(concentration([-5]), null)
})

// ---------------------------------------------------------------- a position's outcome

test('a long makes money when the price rises, less its fees', () => {
  const out = positionOutcome({ entryPrice: 100, exitPrice: 110, quantity: 2, side: 'long', feeRate: 0.001 })
  // Gross 20, fees (100 + 110) * 2 * 0.001 = 0.42
  assert.ok(Math.abs(out.profit - 19.58) < 1e-9)
  assert.ok(Math.abs(out.fees - 0.42) < 1e-9)
})

test('a short makes money when the price falls', () => {
  const out = positionOutcome({ entryPrice: 100, exitPrice: 90, quantity: 1, side: 'short' })
  assert.equal(out.profit, 10)
})

test('leverage is what the return is measured against', () => {
  const plain = positionOutcome({ entryPrice: 100, exitPrice: 110, quantity: 1, side: 'long' })
  const levered = positionOutcome({ entryPrice: 100, exitPrice: 110, quantity: 1, side: 'long', leverage: 10 })
  assert.equal(plain.profit, levered.profit, 'the money made is the same')
  assert.equal(plain.profitPercent, 10)
  assert.equal(levered.profitPercent, 100, 'but against a tenth of the capital')
})

test('nonsense gives no outcome rather than a wrong one', () => {
  assert.ok(positionOutcome({ entryPrice: 0, exitPrice: 1, quantity: 1, side: 'long' }).problem)
  assert.ok(positionOutcome({ entryPrice: 1, exitPrice: 1, quantity: 0, side: 'long' }).problem)
  assert.ok(positionOutcome({ entryPrice: Number.NaN, exitPrice: 1, quantity: 1, side: 'long' }).problem)
})
