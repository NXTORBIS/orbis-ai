import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  analyse,
  breakEvensOf,
  legValueAtExpiry,
  netDebit,
  payoffAt,
  payoffWithUnderlying,
  STRATEGIES,
  strategyTemplate,
  type Leg
} from './options.ts'

/**
 * Options payoffs.
 *
 * A payoff at expiry is the one thing about an option that can be stated without a model, so these are checked against
 * arithmetic done by hand. The tests about `null` matter most: an unbounded profit reported as a number would be a specific,
 * confident, wrong figure that is really just the width of the chart.
 */

/**
 * Close enough.
 *
 * The maxima come from sampling the curve at fractional prices, so they land a few parts in 10^15 off the round number hand
 * arithmetic gives. Asserting the exact float would be asserting the sampling step rather than the payoff.
 */
const near = (actual: number | null, expected: number, what: string): void => {
  assert.ok(actual !== null, `${what} was null`)
  assert.ok(Math.abs((actual as number) - expected) < 1e-6, `${what} was ${actual}, expected about ${expected}`)
}

const leg = (over: Partial<Leg> = {}): Leg => ({
  kind: 'call',
  side: 'buy',
  strike: 100,
  premium: 5,
  quantity: 1,
  contractSize: 100,
  ...over
})

// ---------------------------------------------------------------- one leg

test('a long call is worth its intrinsic value less the premium', () => {
  const call = leg()
  // At 120: intrinsic 20, less the 5 premium, times 100 units.
  assert.equal(legValueAtExpiry(call, 120), 1500)
  // At the strike: nothing intrinsic, so the premium is the loss.
  assert.equal(legValueAtExpiry(call, 100), -500)
  // Below the strike it cannot get worse than the premium.
  assert.equal(legValueAtExpiry(call, 50), -500)
})

test('a long put is the mirror', () => {
  const put = leg({ kind: 'put' })
  assert.equal(legValueAtExpiry(put, 80), 1500)
  assert.equal(legValueAtExpiry(put, 100), -500)
  assert.equal(legValueAtExpiry(put, 150), -500)
})

test('a sold leg is the other side of the same trade', () => {
  const sold = leg({ side: 'sell' })
  assert.equal(legValueAtExpiry(sold, 120), -1500)
  assert.equal(legValueAtExpiry(sold, 100), 500, 'the premium is kept')
  assert.equal(legValueAtExpiry(sold, 50), 500)
})

test('the contract size multiplies everything', () => {
  assert.equal(legValueAtExpiry(leg({ contractSize: 1 }), 120), 15)
  assert.equal(legValueAtExpiry(leg({ contractSize: 1000 }), 120), 15_000)
})

test('quantity multiplies too', () => {
  assert.equal(legValueAtExpiry(leg({ quantity: 3 }), 120), 4500)
})

// ---------------------------------------------------------------- what it cost

test('a bought position is a debit and a sold one a credit', () => {
  assert.equal(netDebit([leg()]), 500)
  assert.equal(netDebit([leg({ side: 'sell' })]), -500)
})

test('a spread nets the two premiums', () => {
  // Buy the 100 for 5, sell the 110 for 2: a debit of 3.
  const spread = [leg({ strike: 100, premium: 5 }), leg({ strike: 110, premium: 2, side: 'sell' })]
  assert.equal(netDebit(spread), 300)
})

// ---------------------------------------------------------------- the bounded strategies

test('a bull call spread caps both sides, and both match hand arithmetic', () => {
  const spread = [leg({ strike: 100, premium: 5 }), leg({ strike: 110, premium: 2, side: 'sell' })]
  const result = analyse(spread)
  // Best case, above 110: the 10 spread less the 3 net debit, times 100.
  near(result.maxProfit, 700, 'max profit')
  // Worst case, below 100: the net debit.
  near(result.maxLoss, -300, 'max loss')
  // Break-even is the lower strike plus the net debit per unit.
  assert.equal(result.breakEvens.length, 1)
  assert.ok(Math.abs(result.breakEvens[0] - 103) < 0.01)
  assert.deepEqual(result.notes, [], 'nothing is unbounded, so nothing is noted')
})

test('a bear put spread is the mirror', () => {
  const spread = [leg({ kind: 'put', strike: 110, premium: 6 }), leg({ kind: 'put', strike: 100, premium: 2, side: 'sell' })]
  const result = analyse(spread)
  near(result.maxProfit, 600, 'max profit')
  near(result.maxLoss, -400, 'max loss')
  assert.ok(Math.abs(result.breakEvens[0] - 106) < 0.01)
})

test('an iron condor profits between the middle strikes and is capped everywhere', () => {
  const condor = [
    leg({ kind: 'put', strike: 90, premium: 1, side: 'buy' }),
    leg({ kind: 'put', strike: 95, premium: 2, side: 'sell' }),
    leg({ kind: 'call', strike: 105, premium: 2, side: 'sell' }),
    leg({ kind: 'call', strike: 110, premium: 1, side: 'buy' })
  ]
  const result = analyse(condor)
  // A net credit of 2 a unit.
  assert.equal(netDebit(condor), -200)
  near(result.maxProfit, 200, 'max profit')
  // The widest wing is 5, less the 2 credit.
  near(result.maxLoss, -300, 'max loss')
  assert.equal(result.breakEvens.length, 2, 'a condor breaks even twice')
  assert.deepEqual(result.notes, [], 'both sides are covered')
})

// ---------------------------------------------------------------- the unbounded ones

test('a naked long call has no maximum profit, and says so rather than guessing one', () => {
  // The whole point. A number here would just be the width of the chart.
  const result = analyse([leg()])
  assert.equal(result.maxProfit, null)
  assert.equal(result.maxLoss, -500)
  assert.ok(result.notes.some((n) => /unbounded above/.test(n)))
})

test('a naked short call has no maximum loss', () => {
  const result = analyse([leg({ side: 'sell' })])
  assert.equal(result.maxLoss, null)
  assert.equal(result.maxProfit, 500)
  assert.ok(result.notes.some((n) => /Loss is unbounded/.test(n)))
})

test('a straddle is unbounded above and bounded below', () => {
  const straddle = [leg({ kind: 'call', premium: 5 }), leg({ kind: 'put', premium: 5 })]
  const result = analyse(straddle)
  assert.equal(result.maxProfit, null, 'the call side has no ceiling')
  // The worst case is both expiring worthless at the strike: both premiums.
  near(result.maxLoss, -1000, 'max loss')
  assert.equal(result.breakEvens.length, 2)
})

test('a short put’s largest loss is at an underlying price of zero, and is found there', () => {
  const result = analyse([leg({ kind: 'put', side: 'sell', strike: 100, premium: 5 })])
  // At zero: the strike less the premium, times 100.
  assert.equal(result.maxLoss, -9500)
  assert.ok(result.notes.some((n) => /price of zero/.test(n)))
})

// ---------------------------------------------------------------- break-evens

test('break-evens are found by walking the payoff, so an unusual combination still works', () => {
  // A ratio spread: nobody would write algebra for this, and the walk handles it anyway.
  const ratio = [leg({ strike: 100, premium: 5 }), leg({ strike: 110, premium: 2, side: 'sell', quantity: 2 })]
  const evens = breakEvensOf(ratio, 50, 200)
  assert.ok(evens.length >= 1)
  for (const price of evens) {
    assert.ok(Math.abs(payoffAt(ratio, price)) < 1, `the payoff at ${price} is not near zero`)
  }
})

test('a position that never breaks even reports none', () => {
  // A call spread bought for more than its width can never be worth anything: it is always a loss.
  const doomed = [leg({ strike: 100, premium: 20 }), leg({ strike: 110, premium: 2, side: 'sell' })]
  assert.deepEqual(analyse(doomed).breakEvens, [])
})

test('break-evens are not reported hundreds of times over a flat stretch', () => {
  const spread = [leg({ strike: 100, premium: 5 }), leg({ strike: 110, premium: 5, side: 'sell' })]
  const evens = analyse(spread).breakEvens
  assert.ok(evens.length <= 2, `got ${evens.length}`)
})

// ---------------------------------------------------------------- with the underlying

test('a covered call caps the upside at the strike', () => {
  const held = { side: 'buy' as const, entryPrice: 100, quantity: 100 }
  const sold = [leg({ strike: 110, premium: 3, side: 'sell' })]
  // At 105: the shares gained 500, and the call expires worthless so its premium is kept.
  assert.equal(payoffWithUnderlying(sold, held, 105), 500 + 300)
  // At 130: the shares gained 3000, but the call lost 2000 net of its premium.
  assert.equal(payoffWithUnderlying(sold, held, 130), 3000 - 1700)
  // Which is the same as at 110 plus nothing: the upside is capped.
  assert.equal(payoffWithUnderlying(sold, held, 130), payoffWithUnderlying(sold, held, 110))
})

test('a protective put floors the downside', () => {
  const held = { side: 'buy' as const, entryPrice: 100, quantity: 100 }
  const insurance = [leg({ kind: 'put', strike: 90, premium: 2 })]
  // At 50 the shares lost 5000, but the put made 3800.
  assert.equal(payoffWithUnderlying(insurance, held, 50), -5000 + 3800)
  // And no worse at 10 than at 50 plus the extra share loss being offset.
  assert.equal(payoffWithUnderlying(insurance, held, 10), payoffWithUnderlying(insurance, held, 50))
})

test('without an underlying position it is just the options', () => {
  assert.equal(payoffWithUnderlying([leg()], null, 120), payoffAt([leg()], 120))
})

// ---------------------------------------------------------------- refusals

test('no legs is no analysis, not a zero payoff', () => {
  const result = analyse([])
  assert.deepEqual(result.curve, [])
  assert.equal(result.maxProfit, null)
  assert.ok(result.notes.length > 0)
})

test('a leg with nonsense in it is refused rather than drawn', () => {
  for (const bad of [{ strike: 0 }, { strike: Number.NaN }, { premium: -1 }, { quantity: 0 }, { contractSize: 0 }]) {
    const result = analyse([leg(bad)])
    assert.deepEqual(result.curve, [], `${JSON.stringify(bad)} produced a curve`)
    assert.ok(result.notes.length > 0)
  }
})

// ---------------------------------------------------------------- the catalogue

test('every strategy says what it is and how many strikes it needs', () => {
  for (const strategy of STRATEGIES) {
    assert.ok(strategy.label.length > 0)
    assert.ok(strategy.strikes.length > 0, `${strategy.name} needs no strikes?`)
    assert.ok(strategy.about.length > 20, `${strategy.name} explains too little`)
    assert.equal(strategyTemplate(strategy.name)?.label, strategy.label)
  }
})

test('the calendar spread is honest that an expiry payoff cannot describe it', () => {
  // It depends on time and volatility. Offering a two-line payoff for it would be a picture that is wrong about the thing
  // the strategy is for.
  const calendar = strategyTemplate('calendar-spread')
  assert.match(calendar?.about ?? '', /time and volatility/)
})

test('the curve is sampled across a real range and is monotonic in price', () => {
  const result = analyse([leg()], { from: 50, to: 150, steps: 100 })
  assert.equal(result.curve.length, 101)
  assert.equal(result.curve[0].price, 50)
  assert.equal(result.curve[100].price, 150)
  for (let i = 1; i < result.curve.length; i++) {
    assert.ok(result.curve[i].price > result.curve[i - 1].price)
  }
})
