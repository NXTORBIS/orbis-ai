import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  accountMargin,
  cleanLeverage,
  cleanMargin,
  MARGIN_ASSUMPTIONS,
  marginOf,
  MAX_LEVERAGE,
  wouldLiquidate,
  type MarginSettings
} from './margin.ts'
import type { PaperPosition } from './paper.ts'

const position = (patch: Partial<PaperPosition> = {}): PaperPosition => ({
  instrumentId: 'binance-futures:future:binance-futures:btcusdt',
  quantity: 1,
  averagePrice: 100,
  feesPaid: 0,
  openedAt: 0,
  ...patch
})

const settings = (patch: Partial<MarginSettings> = {}): MarginSettings => ({
  enabled: true,
  leverage: 10,
  maintenanceRate: 0.005,
  ...patch
})

// ---------------------------------------------------------------- off by default

test('margin is off unless somebody turns it on', () => {
  assert.equal(cleanMargin(null).enabled, false)
  assert.equal(cleanMargin(null).leverage, 1)
  assert.equal(cleanMargin({ leverage: 10 }).enabled, false)
})

test('leverage is clamped, so a file cannot ask for a thousand times', () => {
  assert.equal(cleanLeverage(0), 1)
  assert.equal(cleanLeverage(-5), 1)
  assert.equal(cleanLeverage(1000), MAX_LEVERAGE)
  assert.equal(cleanLeverage(Number.NaN), 1)
  assert.equal(cleanLeverage('10' as unknown), 1)
})

test('a nonsense maintenance rate falls back to the model’s own', () => {
  assert.equal(cleanMargin({ maintenanceRate: 0 }).maintenanceRate, 0.005)
  assert.equal(cleanMargin({ maintenanceRate: 5 }).maintenanceRate, 0.005)
  assert.equal(cleanMargin({ maintenanceRate: 0.01 }).maintenanceRate, 0.01)
})

// ---------------------------------------------------------------- the rule that matters

test('an unleveraged position has no liquidation price, because it cannot be liquidated', () => {
  const spot = marginOf(position(), 100, settings({ enabled: false }))
  assert.equal(spot?.liquidationPrice, null)
  assert.equal(spot?.distanceFraction, null)

  // Leverage of exactly 1 is the same thing.
  const one = marginOf(position(), 100, settings({ leverage: 1 }))
  assert.equal(one?.liquidationPrice, null)
})

test('a leveraged long has a liquidation price below its entry, and a short above', () => {
  const long = marginOf(position({ quantity: 1, averagePrice: 100 }), 100, settings({ leverage: 10 }))
  assert.ok(long?.liquidationPrice !== null && long!.liquidationPrice! < 100)
  assert.ok(long!.liquidationPrice! > 80)

  const short = marginOf(position({ quantity: -1, averagePrice: 100 }), 100, settings({ leverage: 10 }))
  assert.ok(short?.liquidationPrice !== null && short!.liquidationPrice! > 100)
})

test('more leverage puts the liquidation price closer', () => {
  const gentle = marginOf(position(), 100, settings({ leverage: 2 }))!.liquidationPrice!
  const sharp = marginOf(position(), 100, settings({ leverage: 20 }))!.liquidationPrice!
  assert.ok(sharp > gentle, `${sharp} should be nearer 100 than ${gentle}`)
})

test('the liquidation price is where equity actually meets maintenance margin', () => {
  const held = position({ quantity: 2, averagePrice: 100 })
  const config = settings({ leverage: 5 })
  const price = marginOf(held, 100, config)!.liquidationPrice!
  // At that price, the model says it goes -- and a hair above it, it does not.
  assert.equal(wouldLiquidate(held, price, config), true)
  assert.equal(wouldLiquidate(held, price * 1.02, config), false)
})

test('an unleveraged position is never liquidated, whatever the price does', () => {
  assert.equal(wouldLiquidate(position(), 1, settings({ enabled: false })), false)
  assert.equal(wouldLiquidate(position(), 0.0001, settings({ leverage: 1 })), false)
})

// ---------------------------------------------------------------- the arithmetic

test('margin, notional and unrealised are what they say', () => {
  const long = marginOf(position({ quantity: 2, averagePrice: 100 }), 110, settings({ leverage: 4 }))
  assert.equal(long?.notional, 220)
  // Entry value over leverage: 200 / 4.
  assert.equal(long?.initialMargin, 50)
  assert.equal(long?.unrealised, 20)
  assert.equal(long?.equity, 70)
})

test('a short gains when the price falls', () => {
  const short = marginOf(position({ quantity: -2, averagePrice: 100 }), 90, settings({ leverage: 4 }))
  assert.equal(short?.unrealised, 20)
})

test('a position with no price is not valued at zero', () => {
  assert.equal(marginOf(position(), null, settings()), null)
  assert.equal(marginOf(position(), Number.NaN, settings()), null)
  assert.equal(marginOf(position({ quantity: 0 }), 100, settings()), null)
})

// ---------------------------------------------------------------- the account

test('the account nets longs against shorts, and grosses them for exposure', () => {
  const prices = new Map([
    ['a', 100],
    ['b', 100]
  ])
  const result = accountMargin(
    [position({ instrumentId: 'a', quantity: 2 }), position({ instrumentId: 'b', quantity: -1 })],
    1000,
    prices,
    settings({ leverage: 10 })
  )
  assert.equal(result.grossNotional, 300)
  assert.equal(result.netNotional, 100)
  assert.ok(result.effectiveLeverage !== null && result.effectiveLeverage > 0)
})

test('an unvaluable position is named rather than counted as nothing', () => {
  const result = accountMargin([position({ instrumentId: 'a' })], 500, new Map([['a', null]]), settings())
  assert.deepEqual(result.missingPrices, ['a'])
  assert.equal(result.grossNotional, 0)
  // And the cash is still the cash: a missing price is not a loss.
  assert.equal(result.equity, 500)
})

test('an account with nothing to maintain has no margin ratio, rather than an infinite one', () => {
  const result = accountMargin([], 1000, new Map(), settings({ enabled: false }))
  assert.equal(result.marginRatio, null)
  // Nothing held is no exposure, which is zero times leverage rather than an unknown.
  assert.equal(result.effectiveLeverage, 0)
  assert.equal(result.equity, 1000)
})

test('the account names the positions this model says would be closed out', () => {
  // The liquidation price for a 10x long from 100 is about 90.45, so 90 is past it and 91 is not.
  const prices = new Map([['a', 90]])
  const result = accountMargin(
    [position({ instrumentId: 'a', quantity: 1, averagePrice: 100 })],
    0,
    prices,
    settings({ leverage: 10 })
  )
  assert.deepEqual(result.atRisk, ['a'])
  const safe = accountMargin(
    [position({ instrumentId: 'a', quantity: 1, averagePrice: 100 })],
    0,
    new Map([['a', 91]]),
    settings({ leverage: 10 })
  )
  assert.deepEqual(safe.atRisk, [])
})

// ---------------------------------------------------------------- what it admits to

test('the assumptions say outright that this is not an exchange’s calculation', () => {
  const text = MARGIN_ASSUMPTIONS.join(' ').toLowerCase()
  assert.ok(text.includes('simulated by orbis'))
  assert.ok(text.includes('not the price at which a real exchange'))
  assert.ok(MARGIN_ASSUMPTIONS.length >= 4)
})
